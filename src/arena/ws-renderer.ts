// ─────────────────────────────────────────────────────────
//  WebSocket Renderer — forwards battle events to browser
// ─────────────────────────────────────────────────────────

import type { BattleEvent, BattleEventHandler } from "./battle-runner.js";
import type { WebSocket } from "ws";
import {
  BattleStateSnapshot,
  CombatResult,
  CombatAction,
  ArenaConfig,
} from "../engine/types.js";
import {
  createSnapshot,
} from "../engine/index.js";

/**
 * Create an event handler that forwards battle events as JSON
 * messages over a WebSocket connection.
 *
 * Protocol — all messages are `{ type: string, ...data }`:
 *
 *   Server → Client:
 *     connected        — connection established
 *     battle_start     — battle initialized, includes full state
 *     turn_start       — a character's turn begins
 *     your_turn        — human player needs to choose action
 *     enemy_thinking   — AI/LLM turn is resolving
 *     action_result    — a player action resolved
 *     enemy_result     — enemy action resolved
 *     status           — status effect tick
 *     battle_end       — battle concluded
 *     error            — something went wrong
 *
 *   Client → Server:
 *     start_battle     — initiate a new battle
 *     action           — human submits their action choice
 */
export function createWsRenderer(
  ws: WebSocket,
  playerCharacterId: string,
  enemyCharacterId: string = "enemy"
): BattleEventHandler {
  return (event: BattleEvent) => {
    switch (event.type) {
      case "battle_start":
        send("battle_start", {
          playerId: playerCharacterId,
          enemyId: enemyCharacterId,
          playerClass: event.characters.find((c) => c.id === playerCharacterId)?.class || "",
          enemyClass: event.characters.find((c) => c.id === enemyCharacterId)?.class || "boss",
          arena: event.arena,
          characters: event.characters.map(serializeCharacter),
        });
        send("info", {
          narrative: `⚔️ Battle begins! ${event.characters.map((c) => `${c.name} (${c.class})`).join(" vs ")}`,
        });
        break;

      case "turn_start": {
        const isPlayer = event.actorId === playerCharacterId;
        send("turn_start", {
          turnNumber: event.turnNumber,
          actorId: event.actorId,
        });
        if (!isPlayer) {
          send("enemy_thinking", { turnNumber: event.turnNumber });
        }
        break;
      }

      case "move":
        send("move", {
          actorId: event.actorId,
          from: event.from,
          to: event.to,
          distance: event.distance,
        });
        break;

      case "action_chosen": {
        const isPlayer = event.actorId === playerCharacterId;
        send("action_chosen", {
          actorId: event.actorId,
          action: event.action,
          actionLabel: formatAction(event.action),
        });
        if (isPlayer) {
          // confirm to player what they chose
        }
        break;
      }

      case "action_result": {
        const isPlayer = event.actorId === playerCharacterId;
        const type = isPlayer ? "action_result" : "enemy_result";
        send(type, {
          narrative: event.result.narrative,
          result: event.result,
          actorId: event.actorId,
          targetId: event.targetId,
          actionLabel: formatAction(event.result.action),
        });
        break;
      }

      case "status_tick":
        event.narratives.forEach((n) => send("status", { narrative: n }));
        break;

      case "health_bars":
        send("state_update", {
          characters: event.characters.map(serializeCharacter),
        });
        break;

      case "character_defeated":
        // will be followed by battle_end
        break;

      case "battle_end":
        send("battle_end", {
          winner: event.winner || "draw",
          reason: event.reason,
        });
        break;
    }
  };

  function send(type: string, data: Record<string, unknown> = {}) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({ type, ...data }));
    }
  }
}

// ── Helpers ─────────────────────────────────────────────

function formatAction(action: import("../engine/types.js").CombatAction): string {
  const parts: string[] = [action.type];
  if (action.spellId) parts.push(`spell="${action.spellId}"`);
  if (action.itemId) parts.push(`item="${action.itemId}"`);
  if (action.targetId) parts.push(`target="${action.targetId}"`);
  return parts.join(" ");
}

// ── Serialization ──────────────────────────────────────

import type { Character } from "../engine/types.js";

function serializeCharacter(char: Character) {
  return {
    id: char.id,
    name: char.name,
    class: char.class,
    hp: char.stats.hp,
    maxHp: char.stats.maxHp,
    mp: char.stats.mp,
    maxMp: char.stats.maxMp,
    strength: char.stats.strength,
    defense: char.stats.defense,
    magic: char.stats.magic,
    speed: char.stats.speed,
    luck: char.stats.luck,
    statusEffects: char.statusEffects.map((e) => ({ type: e.type, turnsRemaining: e.turnsRemaining })),
    isDefending: char.isDefending,
    position: char.position,
    spells: char.spells.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      mpCost: s.mpCost,
      basePower: s.basePower,
      range: s.range,
      currentCooldown: s.currentCooldown,
    })),
    inventory: char.inventory.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity })),
  };
}

/**
 * Build a BattleStateSnapshot from a set of characters.
 * Used by GameSession to send state alongside events.
 */
export function buildSnapshot(
  characters: Character[],
  turnNumber: number,
  phase: "ongoing" | "finished",
  arena: ArenaConfig
): BattleStateSnapshot {
  return createSnapshot(characters, turnNumber, phase, arena);
}
