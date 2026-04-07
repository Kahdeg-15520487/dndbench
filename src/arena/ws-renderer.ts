// ─────────────────────────────────────────────────────────
//  WebSocket Renderer — forwards battle events to browser
// ─────────────────────────────────────────────────────────

import type { BattleEvent, BattleEventHandler } from "./battle-runner.js";
import type { WebSocket } from "ws";
import type { Character } from "../engine/types.js";

/**
 * Create an event handler that forwards battle events as JSON
 * messages over a WebSocket connection.
 *
 * Protocol — all messages are `{ type: string, ...data }`:
 *
 *   Server → Client:
 *     connected        — connection established
 *     battle_start     — battle initialized, includes full state + arena
 *     turn_start       — a character's turn begins
 *     your_turn        — human player needs to choose action
 *     enemy_thinking   — AI/LLM turn is resolving
 *     move             — character moved on battlefield
 *     action_chosen    — what action was chosen
 *     action_result    — a player action resolved
 *     enemy_result     — enemy action resolved
 *     status           — status effect tick
 *     state_update     — full character state after each action
 *     battle_end       — battle concluded
 *     error            — something went wrong
 *
 *   Client → Server:
 *     start_battle     — initiate a new 1v1 battle
 *     start_scenario   — initiate N-unit scenario
 *     start_boss_exam  — initiate boss exam
 *     action           — human submits their action choice
 */
export function createWsRenderer(
  ws: WebSocket,
  humanCharacterIds: string | string[] = "player",
): BattleEventHandler {
  const humanIds = Array.isArray(humanCharacterIds) ? humanCharacterIds : [humanCharacterIds];

  return (event: BattleEvent) => {
    switch (event.type) {
      case "battle_start":
        send("battle_start", {
          humanIds,
          arena: event.arena,
          characters: event.characters.map(serializeCharacter),
        });
        send("info", {
          narrative: `⚔️ Battle begins! ${event.characters.map((c) => `${c.name} (${c.class})`).join(" vs ")}`,
        });
        break;

      case "turn_start": {
        const isHuman = humanIds.includes(event.actorId);
        send("turn_start", {
          turnNumber: event.turnNumber,
          actorId: event.actorId,
        });
        if (isHuman) {
          send("your_turn", {
            turnNumber: event.turnNumber,
            actorId: event.actorId,
          });
        } else {
          send("enemy_thinking", { turnNumber: event.turnNumber, actorId: event.actorId });
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
        const isHuman = humanIds.includes(event.actorId);
        send("action_chosen", {
          actorId: event.actorId,
          action: event.action,
          actionLabel: formatAction(event.action),
          isHuman,
        });
        break;
      }

      case "action_result": {
        const isHuman = humanIds.includes(event.actorId);
        const type = isHuman ? "action_result" : "enemy_result";
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
        send("character_defeated", {
          characterId: event.characterId,
        });
        break;

      case "battle_end":
        send("battle_end", {
          winner: event.winner || "draw",
          reason: event.reason,
          winningTeam: (event as any).winningTeam || event.winner,
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

function serializeCharacter(char: Character) {
  return {
    id: char.id,
    name: char.name,
    team: char.team,
    class: char.class,
    hp: char.stats.hp,
    maxHp: char.stats.maxHp,
    ac: char.stats.ac,
    str: char.stats.str,
    dex: char.stats.dex,
    con: char.stats.con,
    int: char.stats.int,
    wis: char.stats.wis,
    cha: char.stats.cha,
    speed: char.stats.speed,
    proficiencyBonus: char.stats.proficiencyBonus,
    statusEffects: char.statusEffects.map((e) => ({ type: e.type, turnsRemaining: e.turnsRemaining })),
    isDefending: char.isDefending,
    position: char.position,
    spells: char.spells.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      level: s.level,
      damageDice: s.damageDice,
      range: s.range,
      currentCooldown: s.currentCooldown,
    })),
    inventory: char.inventory.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity })),
    spellSlots: serializeSpellSlots(char.spellSlots),
  };
}

function serializeSpellSlots(slots: Record<number, { total: number; used: number }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [level, info] of Object.entries(slots)) {
    if (info.total > 0) result[level] = info.total - info.used;
  }
  return result;
}
