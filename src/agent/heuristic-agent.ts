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
    _config?: { personality?: "aggressive" | "defensive" | "balanced" }
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
          && remainingSlots(me.spellSlots, s.level) > 0
      );
      if (healSpell && Math.random() > 0.4) {
        return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: healSpell.id };
      }
    }

    // ── Bomb if target healthy ──
    const bomb = me.inventory.find(i => i.id === "bomb" && i.quantity > 0);
    if (bomb && target.hp > target.maxHp * 0.5 && dist <= 20 && Math.random() > 0.6) {
      return { type: "use_item", actorId: this.id, targetId: target.id, itemId: "bomb" };
    }

    // ── Action Surge if in melee range and target alive ──
    const actionSurge = me.features.find(f => f.id === "action_surge" && f.usesRemaining > 0);
    if (actionSurge && dist <= MELEE_RANGE && target.hp > 0 && Math.random() > 0.3) {
      return { type: "class_ability", actorId: this.id, abilityId: "action_surge" };
    }

    // ── Cast damage spells (if we have slots for that level) ──
    const slots = totalRemainingSlots(me.spellSlots);
    if (slots > 0) {
      // Try control spells first (Web) to restrain enemy
      const controlSpells = me.spells
        .filter(s => s.type === "control" && s.currentCooldown === 0 && s.level > 0
          && remainingSlots(me.spellSlots, s.level) > 0
          && !target.statusEffects.some(e => e.type === "restrained"));
      if (controlSpells.length > 0 && Math.random() > 0.6) {
        const spell = controlSpells[0];
        return withMove({
          type: "cast_spell",
          actorId: this.id,
          targetId: target.id,
          spellId: spell.id,
        }, spell.range);
      }

      // Try Haste on self if healthy
      const hasteSpell = me.spells.find(
        s => s.id === "haste" && s.currentCooldown === 0 && remainingSlots(me.spellSlots, s.level) > 0
          && !me.statusEffects.some(e => e.type === "haste")
      );
      if (hasteSpell && me.hp > me.maxHp * 0.7 && Math.random() > 0.7) {
        return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "haste" };
      }

      // Try Slow on enemy if they're not already slowed
      const slowSpell = me.spells.find(
        s => s.id === "slow" && s.currentCooldown === 0 && remainingSlots(me.spellSlots, s.level) > 0
          && !target.statusEffects.some(e => e.type === "slow")
      );
      if (slowSpell && Math.random() > 0.6) {
        return withMove({
          type: "cast_spell",
          actorId: this.id,
          targetId: target.id,
          spellId: "slow",
        }, slowSpell.range);
      }

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
          spellId: spell.id,
        }, spell.range);
      }

      // Fall back to cantrips
      if (cantrips.length > 0 && Math.random() > 0.4) {
        const spell = cantrips[0];
        return withMove({
          type: "cast_spell",
          actorId: this.id,
          targetId: target.id,
          spellId: spell.id,
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
          spellId: spell.id,
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

    // ── Dash if out of melee range and can't close with a normal move ──
    if (dist > maxMove + MELEE_RANGE) {
      return { type: "dash", actorId: this.id, targetId: target.id };
    }

    // ── Shove if in melee and target isn't prone (for advantage) ──
    if (dist <= MELEE_RANGE && !target.statusEffects.some(e => e.type === "prone")
        && Math.random() > 0.85) {
      return { type: "shove", actorId: this.id, targetId: target.id };
    }

    // ── Grapple enemy spellcasters to prevent movement ──
    if (dist <= MELEE_RANGE && !target.statusEffects.some(e => e.type === "grappled")
        && target.ac >= 14 && Math.random() > 0.9) {
      return { type: "grapple", actorId: this.id, targetId: target.id };
    }

    // ── Default: weapon attack (with optional bonus action) ──
    const baseAction: CombatAction = { type: "attack", actorId: this.id, targetId: target.id };

    // Paladin: Divine Smite when in melee, target alive, and has spell slots
    const canSmite = me.features.some(f => f.id === "divine_smite") && dist <= MELEE_RANGE;
    if (canSmite && totalRemainingSlots(me.spellSlots) > 0 && target.hp > 0 && Math.random() > 0.3) {
      baseAction.abilityId = "divine_smite";
    }

    // Paladin: Healing Word as bonus action when wounded
    const hwSpell = me.spells.find(s => s.id === "healing_word" && s.bonusAction
      && s.currentCooldown === 0 && remainingSlots(me.spellSlots, s.level) > 0);
    if (hwSpell && me.hp < me.maxHp * 0.7 && Math.random() > 0.4) {
      baseAction.bonusAction = { type: "healing_word", targetId: this.id };
    }

    // Paladin: Misty Step when far from target
    const msSpell = me.spells.find(s => s.id === "misty_step" && s.bonusAction
      && s.currentCooldown === 0 && remainingSlots(me.spellSlots, s.level) > 0);
    if (msSpell && dist > MELEE_RANGE * 2 && !baseAction.bonusAction && Math.random() > 0.5) {
      baseAction.bonusAction = { type: "misty_step" };
    }

    // Rogue: Cunning Action when out of range (dash to close distance, still use action to attack)
    const cunningAction = me.features.find(f => f.id === "cunning_action");
    if (cunningAction && dist > MELEE_RANGE && !baseAction.bonusAction && Math.random() > 0.4) {
      baseAction.bonusAction = { type: "cunning_action", variant: "dash" };
    }

    return withMove(baseAction, MELEE_RANGE);
  }

  private pickTarget(
    _me: BattleStateSnapshot["characters"][0],
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
