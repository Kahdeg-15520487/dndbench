// ─────────────────────────────────────────────────────────
//  Web Game Server — Express + WebSocket + PostgreSQL
// ─────────────────────────────────────────────────────────
//
//  All battle logic lives in BattleRunner. This server is just
//  a transport layer: WebSocket messages in → BattleRunner,
//  BattleRunner events out → WebSocket messages to browser.
// ─────────────────────────────────────────────────────────

import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import { createCharacter } from "./engine/characters.js";
import { IAgent, HeuristicAgent, LLMAgent, HumanAgent } from "./agent/index.js";
import type { Character, CharacterClass, CombatAction } from "./engine/types.js";
import { BattleRunner } from "./arena/battle-runner.js";
import { createWsRenderer } from "./arena/ws-renderer.js";
import { saveReplay } from "./arena/replay.js";
import * as db from "./db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";
const PORT = parseInt(process.env.PORT || "") || (isDev ? 3001 : 3000);

// ── Express ─────────────────────────────────────────────

const app = express();
app.use(express.json());

const server = createServer(app);

// ── REST API: LLM Configs ───────────────────────────────

app.get("/api/llm-configs", async (_req, res) => {
  try {
    const configs = await db.listLLMConfigs();
    res.json(configs.map(c => ({
      ...c,
      apiKey: c.apiKey ? "••••" + c.apiKey.slice(-4) : null,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/llm-configs/:id", async (req, res) => {
  try {
    const config = await db.getLLMConfig(parseInt(req.params.id));
    if (!config) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      ...config,
      apiKey: config.apiKey ? "••••" + config.apiKey.slice(-4) : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/llm-configs", async (req, res) => {
  try {
    const config = await db.createLLMConfig(req.body);
    res.status(201).json({
      ...config,
      apiKey: config.apiKey ? "••••" + config.apiKey.slice(-4) : null,
    });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: `Config "${req.body.name}" already exists` });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/llm-configs/:id", async (req, res) => {
  try {
    const config = await db.updateLLMConfig(parseInt(req.params.id), req.body);
    if (!config) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      ...config,
      apiKey: config.apiKey ? "••••" + config.apiKey.slice(-4) : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/llm-configs/:id", async (req, res) => {
  try {
    const deleted = await db.deleteLLMConfig(parseInt(req.params.id));
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── REST API: Battle Logs ───────────────────────────────

app.get("/api/battle-logs", async (_req, res) => {
  try {
    const logs = await db.listBattleLogs();
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Static Files (production) ───────────────────────────

const staticPath = path.join(__dirname, "../web/dist");
if (fs.existsSync(staticPath)) {
  app.use(express.static(staticPath));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });
}

// ── WebSocket Game Server ───────────────────────────────

const wss = new WebSocketServer({ server });

interface ClientMessage {
  type: "start_battle" | "action";
  name?: string;
  class?: string;
  enemyMode?: string;
  llmConfigId?: number;
  action?: {
    type: string;
    spellId?: string;
    itemId?: string;
    target?: string;
  };
}

/**
 * A single WebSocket connection = a single battle session.
 * Thin wrapper: wires BattleRunner → WS renderer → browser.
 */
class GameSession {
  private ws: WebSocket;
  private humanAgent?: HumanAgent;
  private enemyAgent?: IAgent;
  private runner?: BattleRunner;
  private playerChar?: Character;
  private enemyChar?: Character;
  private startTime = 0;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  handleMessage(raw: string) {
    try {
      const msg: ClientMessage = JSON.parse(raw);
      switch (msg.type) {
        case "start_battle":
          this.startBattle(msg);
          break;
        case "action":
          this.handleHumanAction(msg);
          break;
      }
    } catch (err: any) {
      this.send("error", { message: err.message || "Invalid message" });
    }
  }

  // ── Start Battle ─────────────────────────────────────

  private async startBattle(msg: ClientMessage) {
    const playerClass = (msg.class || "warrior") as CharacterClass;
    const validClasses: CharacterClass[] = ["warrior", "mage", "rogue", "paladin"];
    if (!validClasses.includes(playerClass)) {
      this.send("error", { message: "Invalid class" });
      return;
    }

    const otherClasses = validClasses.filter((c) => c !== playerClass);
    const enemyClass = otherClasses[Math.floor(Math.random() * otherClasses.length)];
    const playerName = msg.name?.trim() || "Hero";

    this.playerChar = createCharacter("player", playerName, playerClass);
    this.enemyChar = createCharacter("enemy", "AI Opponent", enemyClass);

    this.humanAgent = new HumanAgent("player", playerName);
    this.enemyAgent = await this.createEnemyAgent(
      msg.enemyMode || "mock",
      enemyClass,
      msg.llmConfigId
    );

    this.startTime = Date.now();

    // Wire: BattleRunner → WS renderer → browser
    const wsRenderer = createWsRenderer(this.ws, "player");

    this.runner = new BattleRunner(
      [this.playerChar, this.enemyChar],
      [this.humanAgent, this.enemyAgent],
      {
        maxTurns: 50,
        turnDelayMs: 0, // no artificial delay for real-time play
        eventHandler: wsRenderer,
      }
    );

    // Run battle in background — human agent resolves when browser sends action
    this.runBattle();
  }

  private async runBattle() {
    try {
      const log = await this.runner!.run();

      // Save replay
      const replayPath = saveReplay(log, this.runner!.getCharacters(), this.runner!.getAgents());
      console.error(`Replay saved to ${replayPath}`);

      // Save battle log to DB
      const durationMs = Date.now() - this.startTime;
      db.saveBattleLog({
        playerName: this.playerChar?.name,
        playerClass: this.playerChar?.class,
        enemyClass: this.enemyChar?.class,
        enemyMode: this.enemyAgent?.type === "llm" ? "llm" : "mock",
        winner: log.winner || undefined,
        turns: log.totalTurns,
        durationMs,
      }).catch((err) => console.error("Failed to save battle log:", err.message));

    } catch (err: any) {
      console.error("Battle loop error:", err);
      this.send("error", { message: `Battle error: ${err.message}` });
    }
  }

  // ── Human Input ─────────────────────────────────────

  private handleHumanAction(msg: ClientMessage) {
    if (!msg.action || !this.humanAgent) return;

    const raw = msg.action;
    const action: CombatAction = {
      type: raw.type as CombatAction["type"],
      actorId: "player",
      targetId: raw.target === "self" ? "player" : "enemy",
      spellId: raw.spellId,
      itemId: raw.itemId,
    };

    this.humanAgent.submitAction(action);
  }

  // ── Agent Factory ───────────────────────────────────

  private async createEnemyAgent(
    mode: string,
    charClass: CharacterClass,
    llmConfigId?: number
  ): Promise<IAgent> {
    if (mode === "llm") {
      let config = llmConfigId
        ? await db.getLLMConfig(llmConfigId)
        : await db.getDefaultLLMConfig();

      const model = config?.model || process.env.LLM_MODEL || "gpt-4o-mini";
      const apiKey = config?.apiKey || process.env.LLM_API_KEY || "sk-placeholder";
      const baseUrl = config?.baseUrl || process.env.LLM_BASE_URL || "https://api.openai.com/v1";

      return new LLMAgent({
        id: "enemy",
        name: "AI Opponent",
        characterClass: charClass,
        model,
        apiKey,
        baseURL: baseUrl,
      });
    }
    return new HeuristicAgent("enemy", "AI Opponent");
  }

  // ── Helpers ─────────────────────────────────────────

  private send(type: string, data: Record<string, unknown> = {}) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  destroy() {
    this.humanAgent?.destroy();
    this.enemyAgent?.destroy?.();
  }
}

// ── Connection Handling ─────────────────────────────────

const sessions = new Map<WebSocket, GameSession>();

wss.on("connection", (ws) => {
  const session = new GameSession(ws);
  sessions.set(ws, session);

  ws.on("message", (data) => session.handleMessage(data.toString()));

  ws.on("close", () => {
    session.destroy();
    sessions.delete(ws);
  });

  ws.send(JSON.stringify({ type: "connected", message: "Connected to RPG Arena!" }));
});

// ── Start ───────────────────────────────────────────────

async function main() {
  console.log("Connecting to database...");
  await db.migrate();

  server.listen(PORT, () => {
    console.log(
      `\n⚔️  RPG Arena Server running on http://localhost:${PORT}` +
        (isDev ? `\n   (Frontend dev server should be on http://localhost:3000)` : "") +
        `\n`
    );
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
