// ─────────────────────────────────────────────────────────
//  Boss Agent — phase-based AI with boss-specific tactics
// ─────────────────────────────────────────────────────────

import { IAgent } from "./interface.js";
import {
  BattleStateSnapshot,
  CombatAction,
  CombatResult,
  BossId,
  MoveVector,
  distance,
  moveToward,
} from "../engine/types.js";
import { MELEE_RANGE } from "../engine/combat.js";

type Phase = "normal" | "enraged" | "desperate";

export class BossAgent implements IAgent {
  readonly type = "heuristic" as const; // uses heuristic type for rendering

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
    const me = snapshot.characters.find((c) => c.id === this.id)!;
    const enemy = snapshot.characters.find((c) => c.id !== this.id)!;
    const hpPct = me.hp / me.maxHp;
    const phase: Phase = hpPct > 0.5 ? "normal" : hpPct > 0.25 ? "enraged" : "desperate";
    const dist = distance(me.position, enemy.position);
    const maxMove = 1.0 + 10 * 0.15; // rough speed estimate

    // Helper: add movement toward enemy if out of range
    const withMove = (action: CombatAction, requiredRange: number): CombatAction => {
      if (dist > requiredRange) {
        const move = moveToward(me.position, enemy.position, maxMove);
        if (move) action.move = move;
      }
      return action;
    };

    // Store helpers for use in boss-specific AI
    this._dist = dist;
    this._maxMove = maxMove;
    this._me = me;
    this._enemy = enemy;
    this._withMove = withMove;

    // ── Desperate (<25% HP) — survive at all costs ─────────
    if (phase === "desperate") {
      // Use elixir if available
      const elixir = me.inventory.find((i) => i.id === "elixir" && i.quantity > 0);
      if (elixir) return { type: "use_item", actorId: this.id, itemId: "elixir" };

      // Heal spell if available
      const healSpell = me.spells.find(
        (s) => s.id === "heal" && s.currentCooldown === 0 && me.mp >= s.mpCost
      );
      if (healSpell) return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "heal" };

      // Health potion
      const potion = me.inventory.find((i) => i.id === "health_potion" && i.quantity > 0);
      if (potion) return { type: "use_item", actorId: this.id, itemId: "health_potion" };

      // Shield
      const shieldSpell = me.spells.find(
        (s) => s.id === "shield" && s.currentCooldown === 0 && me.mp >= s.mpCost
          && !me.statusEffects.some((e) => e.type === "shield")
      );
      if (shieldSpell) return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "shield" };

      // Drain for survival
      const drainSpell = me.spells.find(
        (s) => s.id === "drain" && s.currentCooldown === 0 && me.mp >= s.mpCost
      );
      if (drainSpell) return this.cast("drain", enemy.id);

      // Defend
      return { type: "defend", actorId: this.id };
    }

    // ── Boss-specific tactics (normal + enraged) ───────────

    switch (this.bossId) {
      case "goblin_king":
        return this.goblinKingAI(me, enemy, phase);
      case "dark_wizard":
        return this.darkWizardAI(me, enemy, phase);
      case "ancient_dragon":
        return this.ancientDragonAI(me, enemy, phase);
      case "lich_lord":
        return this.lichLordAI(me, enemy, phase);
      case "demon_lord":
        return this.demonLordAI(me, enemy, phase);
    }
  }

  // ── Goblin King: brute force + poison + bombs ──────────

  private goblinKingAI(me: BattleStateSnapshot["characters"][0], enemy: BattleStateSnapshot["characters"][0], phase: Phase): CombatAction {
    // Enraged: throw bombs
    if (phase === "enraged") {
      const bomb = me.inventory.find((i) => i.id === "bomb" && i.quantity > 0);
      if (bomb && Math.random() > 0.3) return this._withMove({ type: "use_item", actorId: this.id, itemId: "bomb" }, 6);
    }

    // Poison if enemy not poisoned
    const poisonSpell = this.readySpell(me, "poison");
    const enemyNotPoisoned = !enemy.statusEffects.some((e) => e.type === "poison");
    if (poisonSpell && enemyNotPoisoned) return this.cast(poisonSpell.id, enemy.id);

    // Fire for damage
    const fire = this.readySpell(me, "fire");
    if (fire && me.mp >= fire.mpCost + 5) return this.cast(fire.id, enemy.id);

    // Bomb for burst
    const bomb = me.inventory.find((i) => i.id === "bomb" && i.quantity > 0);
    if (bomb && Math.random() > 0.6) return this._withMove({ type: "use_item", actorId: this.id, itemId: "bomb" }, 6);

    return this.attackEnemy();
  }

  // ── Dark Wizard: cast strongest spell available ────────

  private darkWizardAI(me: BattleStateSnapshot["characters"][0], enemy: BattleStateSnapshot["characters"][0], phase: Phase): CombatAction {
    // Mana management: use mana potion if low
    if (me.mp < 20) {
      const manaPot = me.inventory.find((i) => i.id === "mana_potion" && i.quantity > 0);
      if (manaPot) return { type: "use_item", actorId: this.id, itemId: "mana_potion" };
    }

    // Enraged: go for Meteor
    if (phase === "enraged") {
      const meteor = this.readySpell(me, "meteor");
      if (meteor) return this.cast(meteor.id, enemy.id);
    }

    // Cast strongest available spell (sorted by basePower desc)
    const spellPriority: string[] = ["meteor", "lightning", "drain", "ice", "fire", "poison"];
    for (const sid of spellPriority) {
      const spell = this.readySpell(me, sid);
      if (spell) return this.cast(spell.id, enemy.id);
    }

    // Drain for sustain when hurt
    if (me.hp < me.maxHp * 0.6) {
      const drain = this.readySpell(me, "drain");
      if (drain) return this.cast(drain.id, enemy.id);
    }

    return this.attackEnemy();
  }

  // ── Ancient Dragon: alternating fire/physical + shield ─

  private ancientDragonAI(me: BattleStateSnapshot["characters"][0], enemy: BattleStateSnapshot["characters"][0], phase: Phase): CombatAction {
    // Shield when enraged and not already shielded
    if (phase === "enraged" && !me.statusEffects.some((e) => e.type === "shield")) {
      const shield = this.readySpell(me, "shield");
      if (shield && Math.random() > 0.5) return this.cast(shield.id, this.id);
    }

    // Meteor when available
    const meteor = this.readySpell(me, "meteor");
    if (meteor && Math.random() > 0.4) return this.cast(meteor.id, enemy.id);

    // Fire + Lightning rotation
    const fire = this.readySpell(me, "fire");
    const lightning = this.readySpell(me, "lightning");

    if (fire && lightning) {
      return this.cast(Math.random() > 0.5 ? fire.id : lightning.id, enemy.id);
    }
    if (fire) return this.cast(fire.id, enemy.id);
    if (lightning) return this.cast(lightning.id, enemy.id);

    // Fallback to powerful physical attacks
    return this.attackEnemy();
  }

  // ── Lich Lord: heal, drain, debuff, nuke ──────────────

  private lichLordAI(me: BattleStateSnapshot["characters"][0], enemy: BattleStateSnapshot["characters"][0], phase: Phase): CombatAction {
    // Heal when below 60%
    if (me.hp < me.maxHp * 0.6) {
      const heal = this.readySpell(me, "heal");
      if (heal) return this.cast(heal.id, this.id);

      const potion = me.inventory.find((i) => i.id === "health_potion" && i.quantity > 0);
      if (potion) return { type: "use_item", actorId: this.id, itemId: "health_potion" };
    }

    // Poison enemy if not poisoned
    const poison = this.readySpell(me, "poison");
    if (poison && !enemy.statusEffects.some((e) => e.type === "poison")) {
      return this.cast(poison.id, enemy.id);
    }

    // Mana management
    if (me.mp < 25) {
      const manaPot = me.inventory.find((i) => i.id === "mana_potion" && i.quantity > 0);
      if (manaPot) return { type: "use_item", actorId: this.id, itemId: "mana_potion" };
    }

    // Enraged: Drain + Meteor combo
    if (phase === "enraged") {
      const drain = this.readySpell(me, "drain");
      if (drain && me.hp < me.maxHp * 0.7) return this.cast(drain.id, enemy.id);

      const meteor = this.readySpell(me, "meteor");
      if (meteor) return this.cast(meteor.id, enemy.id);
    }

    // Cast strongest spell
    const spellPriority: string[] = ["meteor", "lightning", "ice", "drain", "fire"];
    for (const sid of spellPriority) {
      const spell = this.readySpell(me, sid);
      if (spell) return this.cast(spell.id, enemy.id);
    }

    return this.attackEnemy();
  }

  // ── Demon Lord: adaptive strategy ─────────────────────

  private demonLordAI(me: BattleStateSnapshot["characters"][0], enemy: BattleStateSnapshot["characters"][0], phase: Phase): CombatAction {
    // Shield if not shielded and enraged
    if (phase === "enraged" && !me.statusEffects.some((e) => e.type === "shield")) {
      const shield = this.readySpell(me, "shield");
      if (shield && Math.random() > 0.6) return this.cast(shield.id, this.id);
    }

    // Poison if enemy not poisoned
    const poison = this.readySpell(me, "poison");
    if (poison && !enemy.statusEffects.some((e) => e.type === "poison") && Math.random() > 0.4) {
      return this.cast(poison.id, enemy.id);
    }

    // Drain when hurt
    if (me.hp < me.maxHp * 0.65) {
      const drain = this.readySpell(me, "drain");
      if (drain) return this.cast(drain.id, enemy.id);
    }

    // Meteor for massive damage
    const meteor = this.readySpell(me, "meteor");
    if (meteor && Math.random() > 0.3) return this.cast(meteor.id, enemy.id);

    // Lightning for consistent damage
    const lightning = this.readySpell(me, "lightning");
    if (lightning) return this.cast(lightning.id, enemy.id);

    // Fire as bread and butter
    const fire = this.readySpell(me, "fire");
    if (fire) return this.cast(fire.id, enemy.id);

    // Ice for freeze
    const ice = this.readySpell(me, "ice");
    if (ice && Math.random() > 0.5) return this.cast(ice.id, enemy.id);

    // Physical attack with high STR
    return this.attackEnemy();
  }

  // ── Helpers ──────────────────────────────────────────

  private _dist = 0;
  private _maxMove = 0;
  private _me!: BattleStateSnapshot["characters"][0];
  private _enemy!: BattleStateSnapshot["characters"][0];
  private _withMove: ((action: CombatAction, requiredRange: number) => CombatAction) = (a) => a;

  private readySpell(me: BattleStateSnapshot["characters"][0], spellId: string) {
    return me.spells.find(
      (s) => s.id === spellId && s.currentCooldown === 0 && me.mp >= s.mpCost
    ) || undefined;
  }

  private cast(spellId: string, targetId: string): CombatAction {
    const spell = this._me.spells.find(s => s.id === spellId);
    const range = spell?.range ?? MELEE_RANGE;
    return this._withMove(
      { type: "cast_spell", actorId: this.id, targetId, spellId },
      spell?.target === "self" ? 0 : range
    );
  }

  private attackEnemy(): CombatAction {
    return this._withMove(
      { type: "attack", actorId: this.id, targetId: this._enemy.id },
      MELEE_RANGE
    );
  }

  onActionResult(_result: CombatResult): void {}
  onBattleEnd(_winner?: string, _reason?: string): void {}
  destroy(): void {}
}
