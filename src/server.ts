// ─────────────────────────────────────────────────────────
//  Web Game Server — Express + WebSocket + PostgreSQL
// ─────────────────────────────────────────────────────────

import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import { createCharacter } from "./engine/characters.js";
import {
  resolveAction,
  processStatusEffects,
  tickCooldowns,
  createSnapshot,
  determineTurnOrder,
} from "./engine/index.js";
import { IAgent, HeuristicAgent, LLMAgent, HumanAgent } from "./agent/index.js";
import type {
  Character,
  CharacterClass,
  CombatAction,
  BattleStateSnapshot,
  CombatResult,
} from "./engine/types.js";
import * as db from "./db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";
const PORT = parseInt(process.env.PORT || "") || (isDev ? 3001 : 3000);

// ── Express ─────────────────────────────────────────────

const app = express();
app.use(express.json());

const server = createServer(app);

// ── REST API: LLM Configs ───────────────────────────────

// List all configs
app.get("/api/llm-configs", async (_req, res) => {
  try {
    const configs = await db.listLLMConfigs();
    // Mask API keys for listing
    res.json(configs.map(c => ({
      ...c,
      apiKey: c.apiKey ? "••••" + c.apiKey.slice(-4) : null,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single config (includes full API key — needed to create LLM agent)
app.get("/api/llm-configs/:id", async (req, res) => {
  try {
    const config = await db.getLLMConfig(parseInt(req.params.id));
    if (!config) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Mask API key here too — server reads it internally
    res.json({
      ...config,
      apiKey: config.apiKey ? "••••" + config.apiKey.slice(-4) : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create config
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

// Update config
app.patch("/api/llm-configs/:id", async (req, res) => {
  try {
    const config = await db.updateLLMConfig(parseInt(req.params.id), req.body);
    if (!config) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      ...config,
      apiKey: config.apiKey ? "••••" + config.apiKey.slice(-4) : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete config
app.delete("/api/llm-configs/:id", async (req, res) => {
  try {
    const deleted = await db.deleteLLMConfig(parseInt(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
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
 */
class GameSession {
  private ws: WebSocket;
  private player?: Character;
  private enemy?: Character;
  private humanAgent?: HumanAgent;
  private enemyAgent?: IAgent;
  private turnNumber = 0;
  private finished = false;
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

  // ── Start ───────────────────────────────────────────

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

    this.player = createCharacter("player", playerName, playerClass);
    this.enemy = createCharacter("enemy", "AI Opponent", enemyClass);

    // Create agents
    this.humanAgent = new HumanAgent("player", playerName);
    this.enemyAgent = await this.createEnemyAgent(
      msg.enemyMode || "mock",
      enemyClass,
      msg.llmConfigId
    );

    this.turnNumber = 0;
    this.finished = false;
    this.startTime = Date.now();

    this.send("battle_start", {
      playerId: this.player.id,
      enemyId: this.enemy.id,
      playerClass: this.player.class,
      enemyClass: this.enemy.class,
      state: this.getState(),
    });

    this.send("info", {
      narrative: `⚔️ Battle begins! ${this.player.name} (${this.player.class}) vs ${this.enemy.name} (${this.enemy.class})`,
    });

    this.runBattleLoop();
  }

  private async createEnemyAgent(
    mode: string,
    charClass: CharacterClass,
    llmConfigId?: number
  ): Promise<IAgent> {
    if (mode === "llm") {
      // Try to load config from DB
      let config = llmConfigId
        ? await db.getLLMConfig(llmConfigId)
        : await db.getDefaultLLMConfig();

      // Fallback to env vars or defaults
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

  // ── Battle Loop ─────────────────────────────────────

  private async runBattleLoop() {
    try {
      const snapshot = this.getState();
      this.humanAgent!.onBattleStart?.(snapshot);
      if (this.enemyAgent!.onBattleStart) {
        await this.enemyAgent!.onBattleStart(snapshot);
      }

      while (!this.finished && this.turnNumber < 50) {
        this.turnNumber++;
        const order = determineTurnOrder([this.player!, this.enemy!]);

        for (const character of order) {
          if (this.finished) break;

          const isPlayer = character.id === "player";
          const agent = isPlayer ? this.humanAgent! : this.enemyAgent!;
          const target = isPlayer ? this.enemy! : this.player!;

          this.send("turn_start", {
            turnNumber: this.turnNumber,
            state: this.getState(),
          });

          // Check freeze
          if (character.statusEffects.some((e) => e.type === "freeze")) {
            this.send("status", {
              narrative: `❄️ ${character.name} is frozen and cannot act!`,
            });
            tickCooldowns(character);
            continue;
          }

          // Ask agent for action
          if (isPlayer) {
            this.send("your_turn", {
              state: this.getState(),
              turnNumber: this.turnNumber,
            });
          } else {
            this.send("enemy_thinking", { turnNumber: this.turnNumber });
          }

          const currentSnapshot = this.getState();
          const action = await agent.getAction(currentSnapshot);

          if (this.finished) break;

          const result = resolveAction(character, target, action);

          this.humanAgent!.onActionResult?.(result);
          this.enemyAgent!.onActionResult?.(result);

          if (isPlayer) {
            this.send("action_result", {
              narrative: result.narrative,
              result,
              state: this.getState(),
              turnNumber: this.turnNumber,
            });
          } else {
            this.send("enemy_result", {
              narrative: result.narrative,
              result,
              state: this.getState(),
              turnNumber: this.turnNumber,
            });
          }

          tickCooldowns(character);
          const pStatus = processStatusEffects(character);
          const tStatus = processStatusEffects(target);
          [...pStatus, ...tStatus].forEach((n) => this.send("status", { narrative: n }));

          if (result.fledSuccessfully) {
            this.endBattle(target.id, `${character.name} fled!`);
            break;
          }

          if (target.stats.hp <= 0) {
            this.endBattle(character.id, `${target.name} has been defeated!`);
            break;
          }
          if (character.stats.hp <= 0) {
            this.endBattle(target.id, `${character.name} collapsed!`);
            break;
          }
        }
      }

      if (!this.finished) {
        this.endBattle(undefined, "Turn limit reached — it's a draw!");
      }
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
      spellId: raw.spellId as any,
      itemId: raw.itemId as any,
    };

    this.humanAgent.submitAction(action);
  }

  // ── Helpers ─────────────────────────────────────────

  private endBattle(winner: string | undefined, reason: string) {
    this.finished = true;
    this.send("battle_end", { winner: winner || "draw", reason, state: this.getState() });
    this.humanAgent?.onBattleEnd?.(winner, reason);
    this.enemyAgent?.onBattleEnd?.(winner, reason);

    // Save battle log to DB (fire-and-forget)
    const durationMs = Date.now() - this.startTime;
    db.saveBattleLog({
      playerName: this.player?.name,
      playerClass: this.player?.class,
      enemyClass: this.enemy?.class,
      enemyMode: this.enemyAgent?.type === "llm" ? "llm" : "mock",
      winner: winner || undefined,
      turns: this.turnNumber,
      durationMs,
    }).catch((err) => console.error("Failed to save battle log:", err.message));
  }

  private getState(): BattleStateSnapshot {
    return createSnapshot(
      [this.player!, this.enemy!],
      this.turnNumber,
      this.finished ? "finished" : "ongoing"
    );
  }

  private send(type: string, data: Record<string, unknown> = {}) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  destroy() {
    this.finished = true;
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
  // Connect to DB and run migrations
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
