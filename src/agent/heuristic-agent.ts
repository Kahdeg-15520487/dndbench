// ─────────────────────────────────────────────────────────
//  Heuristic Agent — rule-based AI, no LLM needed
//  Supports multi-unit battles with team-aware targeting.
// ─────────────────────────────────────────────────────────

import { IAgent } from "./interface.js";
import {
  BattleStateSnapshot,
  CombatAction,
  CombatResult,
  distance,
  moveToward,
} from "../engine/types.js";
import { MELEE_RANGE } from "../engine/combat.js";

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
    const enemies = snapshot.characters.filter((c) => c.team !== me.team);
    const allies = snapshot.characters.filter((c) => c.team === me.team && c.id !== me.id);

    // No enemies — do nothing
    if (enemies.length === 0) {
      return { type: "wait", actorId: this.id };
    }

    // Pick target: lowest HP% enemy (focus fire)
    const target = this.pickTarget(me, enemies);
    const dist = distance(me.position, target.position);
    const maxMove = 1.0 + 10 * 0.15; // rough speed estimate

    // Helper: add movement toward target if out of range
    const withMove = (action: CombatAction, requiredRange: number): CombatAction => {
      if (dist > requiredRange) {
        const move = moveToward(me.position, target.position, maxMove);
        if (move) action.move = move;
      }
      return action;
    };

    // ── Low HP — prioritize survival ───────────────────
    if (me.hp < me.maxHp * 0.3) {
      const healSpell = me.spells.find(
        (s) => s.id === "heal" && s.currentCooldown === 0
      );
      if (healSpell && me.mp >= 15) {
        return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "heal" };
      }
      const potion = me.inventory.find(
        (i) => i.id === "health_potion" && i.quantity > 0
      );
      if (potion) {
        return { type: "use_item", actorId: this.id, itemId: "health_potion" };
      }
      const elixir = me.inventory.find(
        (i) => i.id === "elixir" && i.quantity > 0
      );
      if (elixir) {
        return { type: "use_item", actorId: this.id, itemId: "elixir" };
      }
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

    // ── Bomb if target healthy ──────────────────────────
    const bomb = me.inventory.find((i) => i.id === "bomb" && i.quantity > 0);
    if (bomb && target.hp > target.maxHp * 0.5 && Math.random() > 0.6) {
      return withMove(
        { type: "use_item", actorId: this.id, targetId: target.id, itemId: "bomb" },
        6,
      );
    }

    // ── Poison for attrition ───────────────────────────
    const poisonSpell = me.spells.find(
      (s) => s.id === "poison" && s.currentCooldown === 0 && me.mp >= s.mpCost
    );
    const targetNotPoisoned = !target.statusEffects.some((e) => e.type === "poison");
    if (poisonSpell && targetNotPoisoned && Math.random() > 0.5) {
      return withMove({
        type: "cast_spell",
        actorId: this.id,
        targetId: target.id,
        spellId: "poison",
      }, poisonSpell.range);
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
      return withMove({
        type: "cast_spell",
        actorId: this.id,
        targetId: target.id,
        spellId: spell.id as any,
      }, spell.range);
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

    // ── Default: attack target ────────────────────────
    return withMove(
      { type: "attack", actorId: this.id, targetId: target.id },
      MELEE_RANGE,
    );
  }

  /** Pick target: focus-fire lowest HP% enemy */
  private pickTarget(
    me: BattleStateSnapshot["characters"][0],
    enemies: BattleStateSnapshot["characters"],
  ): BattleStateSnapshot["characters"][0] {
    // Sort by HP% ascending — weakest first
    const sorted = [...enemies].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    // 70% chance: focus weakest. 30%: random
    if (Math.random() < 0.7) return sorted[0];
    return enemies[Math.floor(Math.random() * enemies.length)];
  }

  onActionResult(_result: CombatResult): void {}
  onBattleEnd(_winner?: string, _reason?: string): void {}
  destroy(): void {}
}
