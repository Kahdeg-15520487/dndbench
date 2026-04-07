// ─────────────────────────────────────────────────────────
//  Heuristic Agent — rule-based AI for D&D 5e
//  Uses spell slots, attack rolls, class abilities.
//  Supports multi-unit battles with team-aware targeting.
// ─────────────────────────────────────────────────────────

import { IAgent } from "./interface.js";
import {
  BattleStateSnapshot,
  CombatAction,
  CombatResult,
  distance,
  moveToward,
  remainingSlots,
  totalRemainingSlots,
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

    if (enemies.length === 0) {
      return { type: "wait", actorId: this.id };
    }

    const target = this.pickTarget(me, enemies);
    const dist = distance(me.position, target.position);
    const maxMove = me.speed || 30;

    const withMove = (action: CombatAction, requiredRange: number): CombatAction => {
      if (dist > requiredRange) {
        const move = moveToward(me.position, target.position, maxMove);
        if (move) action.move = move;
      }
      return action;
    };

    // ── Class abilities ──
    const secondWind = me.features.find(f => f.id === "second_wind" && f.usesRemaining > 0);
    if (secondWind && me.hp < me.maxHp * 0.4) {
      return { type: "class_ability", actorId: this.id, abilityId: "second_wind" };
    }

    const layOnHands = me.features.find(f => f.id === "lay_on_hands" && f.usesRemaining > 0);
    if (layOnHands && me.hp < me.maxHp * 0.3) {
      return { type: "class_ability", actorId: this.id, abilityId: "lay_on_hands" };
    }

    // ── Low HP — use items ──
    if (me.hp < me.maxHp * 0.3) {
      const potion = me.inventory.find(i => i.id === "greater_health_potion" && i.quantity > 0);
      if (potion) return { type: "use_item", actorId: this.id, itemId: "greater_health_potion" };

      const hpPot = me.inventory.find(i => i.id === "health_potion" && i.quantity > 0);
      if (hpPot) return { type: "use_item", actorId: this.id, itemId: "health_potion" };

      const elixir = me.inventory.find(i => i.id === "elixir" && i.quantity > 0);
      if (elixir) return { type: "use_item", actorId: this.id, itemId: "elixir" };

      if (Math.random() > 0.5) return { type: "defend", actorId: this.id };
    }

    // ── Medium HP — consider healing ──
    if (me.hp < me.maxHp * 0.5) {
      const healSpell = me.spells.find(
        s => s.type === "heal" && s.currentCooldown === 0 && s.level > 0
      );
      const hasSlots = healSpell && totalRemainingSlots(me.spellSlots) > 0;
      if (hasSlots && Math.random() > 0.4) {
        return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: healSpell!.id };
      }
    }

    // ── Bomb if target healthy ──
    const bomb = me.inventory.find(i => i.id === "bomb" && i.quantity > 0);
    if (bomb && target.hp > target.maxHp * 0.5 && dist <= 20 && Math.random() > 0.6) {
      return { type: "use_item", actorId: this.id, targetId: target.id, itemId: "bomb" };
    }

    // ── Cast damage spells (if we have slots for that level) ──
    const slots = totalRemainingSlots(me.spellSlots);
    if (slots > 0) {
      // Prioritize highest-level damage spells that we have slots for
      const dmgSpells = me.spells
        .filter(s => s.type === "damage" && s.currentCooldown === 0 && s.level > 0
          && remainingSlots(me.spellSlots, s.level) > 0)
        .sort((a, b) => b.level - a.level);

      // Cantrips are always available
      const cantrips = me.spells
        .filter(s => s.type === "damage" && s.currentCooldown === 0 && s.level === 0);

      // Use big spell if available and in range
      if (dmgSpells.length > 0 && Math.random() > 0.3) {
        const spell = dmgSpells[0];
        return withMove({
          type: "cast_spell",
          actorId: this.id,
          targetId: target.id,
          spellId: spell.id as any,
        }, spell.range);
      }

      // Fall back to cantrips
      if (cantrips.length > 0 && Math.random() > 0.4) {
        const spell = cantrips[0];
        return withMove({
          type: "cast_spell",
          actorId: this.id,
          targetId: target.id,
          spellId: spell.id as any,
        }, spell.range);
      }
    } else {
      // No slots — use cantrips only
      const cantrips = me.spells
        .filter(s => s.type === "damage" && s.currentCooldown === 0 && s.level === 0);
      if (cantrips.length > 0 && Math.random() > 0.3) {
        const spell = cantrips[0];
        return withMove({
          type: "cast_spell",
          actorId: this.id,
          targetId: target.id,
          spellId: spell.id as any,
        }, spell.range);
      }
    }

    // ── Shield if being attacked ──
    const shieldSpell = me.spells.find(
      s => s.id === "shield" && s.currentCooldown === 0 && slots > 0
        && !me.statusEffects.some(e => e.type === "shield")
    );
    if (shieldSpell && Math.random() > 0.7) {
      return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "shield" };
    }

    // ── Defend sometimes ──
    if (Math.random() > 0.85) {
      return { type: "defend", actorId: this.id };
    }

    // ── Default: weapon attack ──
    return withMove(
      { type: "attack", actorId: this.id, targetId: target.id },
      MELEE_RANGE,
    );
  }

  private pickTarget(
    me: BattleStateSnapshot["characters"][0],
    enemies: BattleStateSnapshot["characters"],
  ): BattleStateSnapshot["characters"][0] {
    const sorted = [...enemies].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    if (Math.random() < 0.7) return sorted[0];
    return enemies[Math.floor(Math.random() * enemies.length)];
  }

  onActionResult(_result: CombatResult): void {}
  onBattleEnd(_winner?: string, _reason?: string): void {}
  destroy(): void {}
}
