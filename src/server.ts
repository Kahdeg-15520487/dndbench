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
import { LLMAgent } from "./agent/llm-agent.js";
import type {
  Character,
  CharacterClass,
  CombatAction,
  BattleStateSnapshot,
  BattlePhase,
} from "./engine/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";
const PORT = parseInt(process.env.PORT || "") || (isDev ? 3001 : 3000);

// ── Express ─────────────────────────────────────────────

const app = express();
const server = createServer(app);

// Serve built Vue frontend (production)
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
  enemyMode?: string; // "mock" | "llm"
  action?: {
    type: string;
    spellId?: string;
    itemId?: string;
    target?: string;
  };
}

interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

class GameSession {
  private ws: WebSocket;
  private player?: Character;
  private enemy?: Character;
  private llmAgent?: LLMAgent;
  private turnNumber = 0;
  private finished = false;
  private turnOrder: "player_first" | "enemy_first" | null = null;

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
          if (!this.finished && this.player && this.enemy) {
            this.handlePlayerAction(msg);
          }
          break;
      }
    } catch (err: any) {
      this.send("error", { message: err.message || "Invalid message" });
    }
  }

  // ── Start Battle ─────────────────────────────────────

  private startBattle(msg: ClientMessage) {
    const playerClass = (msg.class || "warrior") as CharacterClass;
    const validClasses: CharacterClass[] = [
      "warrior",
      "mage",
      "rogue",
      "paladin",
    ];
    if (!validClasses.includes(playerClass)) {
      this.send("error", { message: "Invalid class" });
      return;
    }

    // Enemy gets a random different class
    const otherClasses = validClasses.filter((c) => c !== playerClass);
    const enemyClass =
      otherClasses[Math.floor(Math.random() * otherClasses.length)];

    const playerName = msg.name?.trim() || "Hero";
    this.player = createCharacter("player", playerName, playerClass);
    this.enemy = createCharacter("enemy", "AI Opponent", enemyClass);

    const provider = msg.enemyMode === "llm" ? "openai-compatible" : "mock";
    this.llmAgent = new LLMAgent({
      name: "AI Opponent",
      character: this.enemy,
      provider: provider as "openai-compatible" | "mock",
      model: "gpt-4o-mini",
    });

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

    // Start first turn
    this.nextTurn();
  }

  // ── Turn Management ──────────────────────────────────

  private nextTurn() {
    if (this.finished) return;
    this.turnNumber++;

    const order = determineTurnOrder([this.player!, this.enemy!]);
    const playerFirst = order[0].id === this.player!.id;
    this.turnOrder = playerFirst ? "player_first" : "enemy_first";

    this.send("turn_start", {
      turnNumber: this.turnNumber,
      state: this.getState(),
    });

    if (playerFirst) {
      this.sendPlayerTurn();
    } else {
      this.send("info", {
        narrative: `⚡ ${this.enemy!.name} is faster and acts first!`,
      });
      this.executeEnemyTurn(() => {
        if (!this.finished) this.sendPlayerTurn();
      });
    }
  }

  private sendPlayerTurn() {
    // Check freeze
    if (this.hasStatus(this.player!, "freeze")) {
      this.send("status", {
        narrative: `❄️ You are frozen solid and cannot move!`,
      });
      this.tickAndProcess(this.player!);
      if (this.checkBattleEnd()) return;
      // Continue with the other phase
      if (this.turnOrder === "player_first" && !this.finished) {
        this.executeEnemyTurn(() => {
          if (!this.finished) this.nextTurn();
        });
      } else {
        if (!this.finished) this.nextTurn();
      }
      return;
    }

    this.send("your_turn", {
      state: this.getState(),
      turnNumber: this.turnNumber,
    });
  }

  // ── Player Action ────────────────────────────────────

  private handlePlayerAction(msg: ClientMessage) {
    if (!msg.action) return;

    const raw = msg.action;
    const action: CombatAction = {
      type: raw.type as CombatAction["type"],
      actorId: this.player!.id,
      targetId:
        raw.target === "self" ? this.player!.id : this.enemy!.id,
      spellId: raw.spellId as any,
      itemId: raw.itemId as any,
    };

    // Resolve player action
    const result = resolveAction(this.player!, this.enemy!, action);
    this.send("action_result", {
      narrative: result.narrative,
      result,
      state: this.getState(),
      turnNumber: this.turnNumber,
    });

    this.tickAndProcess(this.player!);
    if (this.checkBattleEnd()) return;

    // If player went first, enemy still needs to act
    if (this.turnOrder === "player_first" && !this.finished) {
      this.executeEnemyTurn(() => {
        if (!this.finished) this.nextTurn();
      });
    } else {
      // Turn complete
      if (!this.finished) this.nextTurn();
    }
  }

  // ── Enemy Turn ───────────────────────────────────────

  private executeEnemyTurn(callback: () => void) {
    // Check freeze
    if (this.hasStatus(this.enemy!, "freeze")) {
      this.send("status", {
        narrative: `❄️ ${this.enemy!.name} is frozen and cannot move!`,
      });
      this.tickAndProcess(this.enemy!);
      if (this.checkBattleEnd()) return;
      callback();
      return;
    }

    this.send("enemy_thinking", { turnNumber: this.turnNumber });

    const snapshot = this.getState();
    this.llmAgent!
      .getAction(snapshot)
      .then((action) => {
        if (this.finished) return;

        const result = resolveAction(this.enemy!, this.player!, action);
        this.tickAndProcess(this.enemy!);

        this.send("enemy_result", {
          narrative: result.narrative,
          result,
          state: this.getState(),
          turnNumber: this.turnNumber,
        });

        this.checkBattleEnd();
        callback();
      })
      .catch((err) => {
        console.error("Enemy turn error:", err);
        // Fallback: just attack
        const result = resolveAction(this.enemy!, this.player!, {
          type: "attack",
          actorId: this.enemy!.id,
          targetId: this.player!.id,
        });
        this.send("enemy_result", {
          narrative: result.narrative,
          result,
          state: this.getState(),
        });
        this.checkBattleEnd();
        callback();
      });
  }

  // ── Helpers ──────────────────────────────────────────

  private tickAndProcess(character: Character) {
    tickCooldowns(character);
    const narratives = processStatusEffects(character);
    narratives.forEach((n) => {
      this.send("status", { narrative: n });
    });
    // Also process status on the other character
    const other =
      character.id === this.player!.id ? this.enemy! : this.player!;
    const otherN = processStatusEffects(other);
    otherN.forEach((n) => {
      this.send("status", { narrative: n });
    });
  }

  private hasStatus(character: Character, type: string): boolean {
    return character.statusEffects.some((e) => e.type === type);
  }

  private checkBattleEnd(): boolean {
    if (this.player!.stats.hp <= 0) {
      this.finished = true;
      this.send("battle_end", {
        winner: "enemy",
        reason: `${this.player!.name} has been defeated!`,
        state: this.getState(),
      });
      return true;
    }
    if (this.enemy!.stats.hp <= 0) {
      this.finished = true;
      this.send("battle_end", {
        winner: "player",
        reason: `${this.enemy!.name} has been defeated!`,
        state: this.getState(),
      });
      return true;
    }
    // Turn limit
    if (this.turnNumber >= 50) {
      this.finished = true;
      this.send("battle_end", {
        winner: "draw",
        reason: "Turn limit reached — it's a draw!",
        state: this.getState(),
      });
      return true;
    }
    return false;
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
  }
}

// ── Connection Handling ─────────────────────────────────

const sessions = new Map<WebSocket, GameSession>();

wss.on("connection", (ws) => {
  const session = new GameSession(ws);
  sessions.set(ws, session);

  ws.on("message", (data) => {
    session.handleMessage(data.toString());
  });

  ws.on("close", () => {
    session.destroy();
    sessions.delete(ws);
  });

  // Send welcome
  ws.send(
    JSON.stringify({
      type: "connected",
      message: "Connected to RPG Arena!",
    })
  );
});

// ── Start ───────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(
    `\n⚔️  RPG Arena Server running on http://localhost:${PORT}` +
      (isDev ? `\n   (Frontend dev server should be on http://localhost:3000)` : "") +
      `\n`
  );
});
