// ─────────────────────────────────────────────────────────
//  Heuristic Agent — rule-based AI, no LLM needed
// ─────────────────────────────────────────────────────────

import { IAgent } from "./interface.js";
import {
  BattleStateSnapshot,
  CombatAction,
  CombatResult,
} from "../engine/types.js";

export class HeuristicAgent implements IAgent {
  readonly type = "heuristic" as const;

  constructor(
    public readonly id: string,
    public readonly name: string,
    private config?: { personality?: "aggressive" | "defensive" | "balanced" }
  ) {}

  onBattleStart(): void {}

  async getAction(snapshot: BattleStateSnapshot): Promise<CombatAction> {
    const me = snapshot.characters.find((c) => c.id === this.id)!;
    const enemy = snapshot.characters.find((c) => c.id !== this.id)!;

    // ── Low HP — prioritize survival ───────────────────
    if (me.hp < me.maxHp * 0.3) {
      // Try heal spell
      const healSpell = me.spells.find(
        (s) => s.id === "heal" && s.currentCooldown === 0
      );
      if (healSpell && me.mp >= 15) {
        return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "heal" };
      }
      // Try health potion
      const potion = me.inventory.find(
        (i) => i.id === "health_potion" && i.quantity > 0
      );
      if (potion) {
        return { type: "use_item", actorId: this.id, itemId: "health_potion" };
      }
      // Try elixir
      const elixir = me.inventory.find(
        (i) => i.id === "elixir" && i.quantity > 0
      );
      if (elixir) {
        return { type: "use_item", actorId: this.id, itemId: "elixir" };
      }
      // Last resort: defend
      if (Math.random() > 0.5) {
        return { type: "defend", actorId: this.id };
      }
    }

    // ── Medium HP — use items strategically ────────────
    if (me.hp < me.maxHp * 0.5) {
      const potion = me.inventory.find(
        (i) => i.id === "health_potion" && i.quantity > 0
      );
      if (potion && Math.random() > 0.6) {
        return { type: "use_item", actorId: this.id, itemId: "health_potion" };
      }
    }

    // ── Bomb if enemy healthy ──────────────────────────
    const bomb = me.inventory.find((i) => i.id === "bomb" && i.quantity > 0);
    if (bomb && enemy.hp > enemy.maxHp * 0.5 && Math.random() > 0.6) {
      return { type: "use_item", actorId: this.id, itemId: "bomb" };
    }

    // ── Poison for attrition ──────────────────────────
    const poisonSpell = me.spells.find(
      (s) =>
        s.id === "poison" &&
        s.currentCooldown === 0 &&
        me.mp >= s.mpCost
    );
    const enemyNotPoisoned = !enemy.statusEffects.some(
      (e) => e.type === "poison"
    );
    if (poisonSpell && enemyNotPoisoned && Math.random() > 0.5) {
      return {
        type: "cast_spell",
        actorId: this.id,
        targetId: enemy.id,
        spellId: "poison",
      };
    }

    // ── Cast damage spells ─────────────────────────────
    const dmgSpells = me.spells.filter(
      (s) =>
        (s.type === "damage" || s.type === "drain") &&
        s.currentCooldown === 0 &&
        me.mp >= s.mpCost
    );
    if (dmgSpells.length > 0 && Math.random() > 0.3) {
      const spell = dmgSpells[Math.floor(Math.random() * dmgSpells.length)];
      return {
        type: "cast_spell",
        actorId: this.id,
        targetId: enemy.id,
        spellId: spell.id,
      };
    }

    // ── Shield if low MP ──────────────────────────────
    const shieldSpell = me.spells.find(
      (s) =>
        s.id === "shield" &&
        s.currentCooldown === 0 &&
        me.mp >= s.mpCost &&
        !me.statusEffects.some((e) => e.type === "shield")
    );
    if (shieldSpell && Math.random() > 0.7) {
      return {
        type: "cast_spell",
        actorId: this.id,
        targetId: this.id,
        spellId: "shield",
      };
    }

    // ── Defend sometimes ──────────────────────────────
    if (Math.random() > 0.85) {
      return { type: "defend", actorId: this.id };
    }

    // ── Default: attack ───────────────────────────────
    return { type: "attack", actorId: this.id, targetId: enemy.id };
  }

  onActionResult(_result: CombatResult): void {}

  onBattleEnd(): void {}

  destroy(): void {}
}
