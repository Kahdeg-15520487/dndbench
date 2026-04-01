// ─────────────────────────────────────────────────────────
//  Web Game Server — Express + WebSocket
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
  BattlePhase,
  CombatResult,
} from "./engine/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";
const PORT = parseInt(process.env.PORT || "") || (isDev ? 3001 : 3000);

// ── Express ─────────────────────────────────────────────

const app = express();
const server = createServer(app);

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
  action?: {
    type: string;
    spellId?: string;
    itemId?: string;
    target?: string;
  };
}

/**
 * A single WebSocket connection = a single battle session.
 *
 * The GameSession creates a HumanAgent for the player and an
 * IAgent (Heuristic or LLM) for the enemy, then drives the
 * battle loop using the same engine the CLI uses.
 */
class GameSession {
  private ws: WebSocket;
  private player?: Character;
  private enemy?: Character;
  private humanAgent?: HumanAgent;
  private enemyAgent?: IAgent;
  private turnNumber = 0;
  private finished = false;
  private battlePromise?: Promise<void>;

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

  private startBattle(msg: ClientMessage) {
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
    this.enemyAgent = this.createEnemyAgent(msg.enemyMode || "mock", enemyClass);

    this.turnNumber = 0;
    this.finished = false;

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

    // Run the battle loop
    this.battlePromise = this.runBattleLoop();
  }

  private createEnemyAgent(mode: string, charClass: CharacterClass): IAgent {
    if (mode === "llm") {
      return new LLMAgent({
        id: "enemy",
        name: "AI Opponent",
        characterClass: charClass,
        model: "gpt-4o-mini",
      });
    }
    return new HeuristicAgent("enemy", "AI Opponent");
  }

  // ── Battle Loop ─────────────────────────────────────

  private async runBattleLoop() {
    try {
      // Notify agents
      const snapshot = this.getState();
      this.humanAgent!.onBattleStart?.(snapshot);
      this.enemyAgent!.onBattleStart?.(snapshot);

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

          // ── Ask agent for action (the unified interface) ──
          if (isPlayer) {
            // Tell the UI it's the human's turn
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

          // Resolve
          const result = resolveAction(character, target, action);

          // Notify agents
          this.humanAgent!.onActionResult?.(result);
          this.enemyAgent!.onActionResult?.(result);

          // Send result to UI
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

          // Process status + cooldowns
          tickCooldowns(character);
          const pStatus = processStatusEffects(character);
          const tStatus = processStatusEffects(target);
          [...pStatus, ...tStatus].forEach((n) => this.send("status", { narrative: n }));

          // Check flee
          if (result.fledSuccessfully) {
            this.endBattle(target.id, `${character.name} fled!`);
            break;
          }

          // Check defeat
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

      // Turn limit
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

    // This resolves the Promise in HumanAgent.getAction()
    this.humanAgent.submitAction(action);
  }

  // ── Helpers ─────────────────────────────────────────

  private endBattle(winner: string | undefined, reason: string) {
    this.finished = true;
    this.send("battle_end", { winner: winner || "draw", reason, state: this.getState() });
    this.humanAgent?.onBattleEnd?.(winner, reason);
    this.enemyAgent?.onBattleEnd?.(winner, reason);
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

server.listen(PORT, () => {
  console.log(
    `\n⚔️  RPG Arena Server running on http://localhost:${PORT}` +
      (isDev ? `\n   (Frontend dev server should be on http://localhost:3000)` : "") +
      `\n`
  );
});
