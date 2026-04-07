// ─────────────────────────────────────────────────────────
//  Boss Agent — phase-based AI for D&D 5e boss monsters
//  Uses spell slots, attack rolls, and class abilities.
//  Supports multi-enemy battles (raid encounters).
// ─────────────────────────────────────────────────────────

import { IAgent } from "./interface.js";
import {
  BattleStateSnapshot,
  CombatAction,
  CombatResult,
  BossId,
  distance,
  moveToward,
  totalRemainingSlots,
} from "../engine/types.js";
import { MELEE_RANGE } from "../engine/combat.js";

type Phase = "normal" | "enraged" | "desperate";

export class BossAgent implements IAgent {
  readonly type = "heuristic" as const;

  private bossId: BossId;

  constructor(
    public readonly id: string,
    public readonly name: string,
    bossId: BossId,
  ) {
    this.bossId = bossId;
  }

  onBattleStart(): void {}

  async getAction(snapshot: BattleStateSnapshot): Promise<CombatAction> {
    const me = snapshot.characters.find(c => c.id === this.id)!;
    const enemies = snapshot.characters.filter(c => c.team !== me.team);

    if (enemies.length === 0) return { type: "wait", actorId: this.id };

    const hpPct = me.hp / me.maxHp;
    const phase: Phase = hpPct > 0.5 ? "normal" : hpPct > 0.25 ? "enraged" : "desperate";
    const target = this.pickTarget(me, enemies);
    const dist = distance(me.position, target.position);
    const maxMove = me.speed || 30;
    const slots = totalRemainingSlots(me.spellSlots);

    const withMove = (action: CombatAction, requiredRange: number): CombatAction => {
      if (dist > requiredRange) {
        const move = moveToward(me.position, target.position, maxMove);
        if (move) action.move = move;
      }
      return action;
    };

    // Store context for helper methods
    this._ctx = { me, target, enemies, dist, maxMove, withMove, slots, phase };

    // ── Desperate (<25% HP) ──
    if (phase === "desperate") {
      const elixir = me.inventory.find(i => i.id === "elixir" && i.quantity > 0);
      if (elixir) return { type: "use_item", actorId: this.id, itemId: "elixir" };

      const gPot = me.inventory.find(i => i.id === "greater_health_potion" && i.quantity > 0);
      if (gPot) return { type: "use_item", actorId: this.id, itemId: "greater_health_potion" };

      const pot = me.inventory.find(i => i.id === "health_potion" && i.quantity > 0);
      if (pot) return { type: "use_item", actorId: this.id, itemId: "health_potion" };

      const shieldSpell = this.readySpell(me, "shield");
      if (shieldSpell && !me.statusEffects.some(e => e.type === "shield")) {
        return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "shield" };
      }

      // Use second_wind if available
      const sw = me.features.find(f => f.id === "second_wind" && f.usesRemaining > 0);
      if (sw) return { type: "class_ability", actorId: this.id, abilityId: "second_wind" };

      return { type: "defend", actorId: this.id };
    }

    // ── Boss-specific AI ──
    switch (this.bossId) {
      case "goblin_king": return this.goblinKingAI();
      case "dark_wizard": return this.darkWizardAI();
      case "ancient_dragon": return this.ancientDragonAI();
      case "lich_lord": return this.lichLordAI();
      case "demon_lord": return this.demonLordAI();
    }
  }

  // ── Target Selection ──

  private pickTarget(
    me: BattleStateSnapshot["characters"][0],
    enemies: BattleStateSnapshot["characters"],
  ): BattleStateSnapshot["characters"][0] {
    const sorted = [...enemies].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    if (Math.random() < 0.6) return sorted[0];
    let nearest = enemies[0];
    let nearestDist = Infinity;
    for (const e of enemies) {
      const d = distance(me.position, e.position);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    return nearest;
  }

  // ── Goblin King: melee + bombs ──

  private goblinKingAI(): CombatAction {
    const { me, target, withMove } = this._ctx;

    const bomb = me.inventory.find(i => i.id === "bomb" && i.quantity > 0);
    if (bomb && Math.random() > 0.5) {
      return withMove({ type: "use_item", actorId: this.id, targetId: target.id, itemId: "bomb" }, 20);
    }

    const sw = me.features.find(f => f.id === "second_wind" && f.usesRemaining > 0);
    if (sw && me.hp < me.maxHp * 0.4) {
      return { type: "class_ability", actorId: this.id, abilityId: "second_wind" };
    }

    return withMove({ type: "attack", actorId: this.id, targetId: target.id }, MELEE_RANGE);
  }

  // ── Dark Wizard: spell-heavy, cast biggest available ──

  private darkWizardAI(): CombatAction {
    const { me, target, withMove, slots } = this._ctx;

    // Arcane Recovery if out of slots
    const ar = me.features.find(f => f.id === "arcane_recovery" && f.usesRemaining > 0);
    if (ar && slots === 0) {
      return { type: "class_ability", actorId: this.id, abilityId: "arcane_recovery" };
    }

    // Cast biggest damage spell
    const dmgSpells = me.spells
      .filter(s => s.type === "damage" && s.currentCooldown === 0 && s.level > 0)
      .sort((a, b) => b.level - a.level);

    if (dmgSpells.length > 0 && slots > 0) {
      const spell = dmgSpells[0];
      return withMove({
        type: "cast_spell", actorId: this.id, targetId: target.id, spellId: spell.id as any,
      }, spell.range);
    }

    // Fall back to cantrip
    const cantrip = me.spells.find(s => s.level === 0 && s.currentCooldown === 0);
    if (cantrip) {
      return withMove({
        type: "cast_spell", actorId: this.id, targetId: target.id, spellId: cantrip.id as any,
      }, cantrip.range);
    }

    return withMove({ type: "attack", actorId: this.id, targetId: target.id }, MELEE_RANGE);
  }

  // ── Ancient Dragon: melee monster with fire ──

  private ancientDragonAI(): CombatAction {
    const { me, target, withMove, phase } = this._ctx;

    // Action Surge in enraged phase
    const as = me.features.find(f => f.id === "action_surge" && f.usesRemaining > 0);
    if (as && phase === "enraged" && Math.random() > 0.5) {
      return { type: "class_ability", actorId: this.id, abilityId: "action_surge" };
    }

    return withMove({ type: "attack", actorId: this.id, targetId: target.id }, MELEE_RANGE);
  }

  // ── Lich Lord: spellcaster with healing ──

  private lichLordAI(): CombatAction {
    const { me, target, withMove, slots, phase } = this._ctx;

    // Heal if needed
    if (me.hp < me.maxHp * 0.5) {
      const potion = me.inventory.find(i => i.id === "health_potion" && i.quantity > 0);
      if (potion) return { type: "use_item", actorId: this.id, itemId: "health_potion" };
    }

    // Arcane Recovery if low on slots
    const ar = me.features.find(f => f.id === "arcane_recovery" && f.usesRemaining > 0);
    if (ar && slots <= 2) {
      return { type: "class_ability", actorId: this.id, abilityId: "arcane_recovery" };
    }

    // Hold Person on enemies
    const holdPerson = this.readySpell(me, "hold_person");
    if (holdPerson && Math.random() > 0.6) {
      return withMove({
        type: "cast_spell", actorId: this.id, targetId: target.id, spellId: "hold_person",
      }, holdPerson.range);
    }

    // Cast biggest damage spell
    const dmgSpells = me.spells
      .filter(s => s.type === "damage" && s.currentCooldown === 0 && s.level > 0)
      .sort((a, b) => b.level - a.level);

    if (dmgSpells.length > 0 && slots > 0) {
      const spell = dmgSpells[0];
      return withMove({
        type: "cast_spell", actorId: this.id, targetId: target.id, spellId: spell.id as any,
      }, spell.range);
    }

    // Cantrip fallback
    const cantrip = me.spells.find(s => s.level === 0 && s.currentCooldown === 0);
    if (cantrip) {
      return withMove({
        type: "cast_spell", actorId: this.id, targetId: target.id, spellId: cantrip.id as any,
      }, cantrip.range);
    }

    return withMove({ type: "attack", actorId: this.id, targetId: target.id }, MELEE_RANGE);
  }

  // ── Demon Lord: physical powerhouse with spells ──

  private demonLordAI(): CombatAction {
    const { me, target, withMove, slots, phase } = this._ctx;

    // Action Surge
    const as = me.features.find(f => f.id === "action_surge" && f.usesRemaining > 0);
    if (as && phase === "enraged") {
      return { type: "class_ability", actorId: this.id, abilityId: "action_surge" };
    }

    // Shield if taking damage
    const shieldSpell = this.readySpell(me, "shield");
    if (shieldSpell && !me.statusEffects.some(e => e.type === "shield") && Math.random() > 0.7) {
      return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "shield" };
    }

    // Fireball if available and enraged
    const fireball = this.readySpell(me, "fireball");
    if (fireball && slots > 0 && phase === "enraged") {
      return withMove({
        type: "cast_spell", actorId: this.id, targetId: target.id, spellId: "fireball",
      }, fireball.range);
    }

    // Second Wind for healing
    const sw = me.features.find(f => f.id === "second_wind" && f.usesRemaining > 0);
    if (sw && me.hp < me.maxHp * 0.5) {
      return { type: "class_ability", actorId: this.id, abilityId: "second_wind" };
    }

    return withMove({ type: "attack", actorId: this.id, targetId: target.id }, MELEE_RANGE);
  }

  // ── Helpers ──

  private _ctx: {
    me: BattleStateSnapshot["characters"][0];
    target: BattleStateSnapshot["characters"][0];
    enemies: BattleStateSnapshot["characters"];
    dist: number;
    maxMove: number;
    withMove: (action: CombatAction, requiredRange: number) => CombatAction;
    slots: number;
    phase: Phase;
  } = {
    me: null as any, target: null as any, enemies: [],
    dist: 0, maxMove: 30,
    withMove: (a) => a, slots: 0, phase: "normal",
  };

  private readySpell(me: BattleStateSnapshot["characters"][0], spellId: string) {
    return me.spells.find(s => s.id === spellId && s.currentCooldown === 0) || undefined;
  }

  onActionResult(_result: CombatResult): void {}
  onBattleEnd(_winner?: string, _reason?: string): void {}
  destroy(): void {}
}
