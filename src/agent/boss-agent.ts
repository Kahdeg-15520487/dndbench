// ─────────────────────────────────────────────────────────
//  Boss Agent — phase-based AI with boss-specific tactics
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
    const enemies = snapshot.characters.filter((c) => c.team !== me.team);

    if (enemies.length === 0) {
      return { type: "wait", actorId: this.id };
    }

    const hpPct = me.hp / me.maxHp;
    const phase: Phase = hpPct > 0.5 ? "normal" : hpPct > 0.25 ? "enraged" : "desperate";

    // Pick primary target (weakest enemy by HP%)
    const target = this.pickTarget(me, enemies);
    const dist = distance(me.position, target.position);
    const maxMove = 1.0 + 10 * 0.15;

    const withMove = (action: CombatAction, requiredRange: number): CombatAction => {
      if (dist > requiredRange) {
        const move = moveToward(me.position, target.position, maxMove);
        if (move) action.move = move;
      }
      return action;
    };

    // Store helpers for boss-specific AI
    this._dist = dist;
    this._maxMove = maxMove;
    this._me = me;
    this._enemy = target;
    this._enemies = enemies;
    this._withMove = withMove;

    // ── Desperate (<25% HP) — survive at all costs ─────────
    if (phase === "desperate") {
      const elixir = me.inventory.find((i) => i.id === "elixir" && i.quantity > 0);
      if (elixir) return { type: "use_item", actorId: this.id, itemId: "elixir" };

      const healSpell = me.spells.find(
        (s) => s.id === "heal" && s.currentCooldown === 0 && me.mp >= s.mpCost
      );
      if (healSpell) return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "heal" };

      const potion = me.inventory.find((i) => i.id === "health_potion" && i.quantity > 0);
      if (potion) return { type: "use_item", actorId: this.id, itemId: "health_potion" };

      const shieldSpell = me.spells.find(
        (s) => s.id === "shield" && s.currentCooldown === 0 && me.mp >= s.mpCost
          && !me.statusEffects.some((e) => e.type === "shield")
      );
      if (shieldSpell) return { type: "cast_spell", actorId: this.id, targetId: this.id, spellId: "shield" };

      const drainSpell = me.spells.find(
        (s) => s.id === "drain" && s.currentCooldown === 0 && me.mp >= s.mpCost
      );
      if (drainSpell) return this.cast("drain", target.id);

      return { type: "defend", actorId: this.id };
    }

    // ── Boss-specific tactics (normal + enraged) ───────────
    switch (this.bossId) {
      case "goblin_king":
        return this.goblinKingAI(me, target, enemies, phase);
      case "dark_wizard":
        return this.darkWizardAI(me, target, enemies, phase);
      case "ancient_dragon":
        return this.ancientDragonAI(me, target, enemies, phase);
      case "lich_lord":
        return this.lichLordAI(me, target, enemies, phase);
      case "demon_lord":
        return this.demonLordAI(me, target, enemies, phase);
    }
  }

  // ── Target Selection ────────────────────────────────

  /** Focus-fire weakest, occasionally swap to nearest */
  private pickTarget(
    me: BattleStateSnapshot["characters"][0],
    enemies: BattleStateSnapshot["characters"],
  ): BattleStateSnapshot["characters"][0] {
    // Sort by HP% ascending
    const sorted = [...enemies].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    // 60% focus weakest, 40% nearest
    if (Math.random() < 0.6) return sorted[0];
    // Nearest enemy
    let nearest = enemies[0];
    let nearestDist = Infinity;
    for (const e of enemies) {
      const d = distance(me.position, e.position);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    return nearest;
  }

  // ── Goblin King: brute force + poison + bombs ──────────

  private goblinKingAI(me: BattleStateSnapshot["characters"][0], target: BattleStateSnapshot["characters"][0], _enemies: BattleStateSnapshot["characters"], phase: Phase): CombatAction {
    if (phase === "enraged") {
      const bomb = me.inventory.find((i) => i.id === "bomb" && i.quantity > 0);
      if (bomb && Math.random() > 0.3) return this._withMove({ type: "use_item", actorId: this.id, targetId: target.id, itemId: "bomb" }, 6);
    }

    const poisonSpell = this.readySpell(me, "poison");
    const targetNotPoisoned = !target.statusEffects.some((e) => e.type === "poison");
    if (poisonSpell && targetNotPoisoned) return this.cast(poisonSpell.id, target.id);

    const fire = this.readySpell(me, "fire");
    if (fire && me.mp >= fire.mpCost + 5) return this.cast(fire.id, target.id);

    const bomb = me.inventory.find((i) => i.id === "bomb" && i.quantity > 0);
    if (bomb && Math.random() > 0.6) return this._withMove({ type: "use_item", actorId: this.id, targetId: target.id, itemId: "bomb" }, 6);

    return this.attackEnemy();
  }

  // ── Dark Wizard: cast strongest spell available ────────

  private darkWizardAI(me: BattleStateSnapshot["characters"][0], target: BattleStateSnapshot["characters"][0], _enemies: BattleStateSnapshot["characters"], phase: Phase): CombatAction {
    if (me.mp < 20) {
      const manaPot = me.inventory.find((i) => i.id === "mana_potion" && i.quantity > 0);
      if (manaPot) return { type: "use_item", actorId: this.id, itemId: "mana_potion" };
    }

    if (phase === "enraged") {
      const meteor = this.readySpell(me, "meteor");
      if (meteor) return this.cast(meteor.id, target.id);
    }

    const spellPriority: string[] = ["meteor", "lightning", "drain", "ice", "fire", "poison"];
    for (const sid of spellPriority) {
      const spell = this.readySpell(me, sid);
      if (spell) return this.cast(spell.id, target.id);
    }

    if (me.hp < me.maxHp * 0.6) {
      const drain = this.readySpell(me, "drain");
      if (drain) return this.cast(drain.id, target.id);
    }

    return this.attackEnemy();
  }

  // ── Ancient Dragon: alternating fire/physical + shield ─

  private ancientDragonAI(me: BattleStateSnapshot["characters"][0], target: BattleStateSnapshot["characters"][0], _enemies: BattleStateSnapshot["characters"], phase: Phase): CombatAction {
    if (phase === "enraged" && !me.statusEffects.some((e) => e.type === "shield")) {
      const shield = this.readySpell(me, "shield");
      if (shield && Math.random() > 0.5) return this.cast(shield.id, this.id);
    }

    const meteor = this.readySpell(me, "meteor");
    if (meteor && Math.random() > 0.4) return this.cast(meteor.id, target.id);

    const fire = this.readySpell(me, "fire");
    const lightning = this.readySpell(me, "lightning");

    if (fire && lightning) {
      return this.cast(Math.random() > 0.5 ? fire.id : lightning.id, target.id);
    }
    if (fire) return this.cast(fire.id, target.id);
    if (lightning) return this.cast(lightning.id, target.id);

    return this.attackEnemy();
  }

  // ── Lich Lord: heal, drain, debuff, nuke ──────────────

  private lichLordAI(me: BattleStateSnapshot["characters"][0], target: BattleStateSnapshot["characters"][0], _enemies: BattleStateSnapshot["characters"], phase: Phase): CombatAction {
    if (me.hp < me.maxHp * 0.6) {
      const heal = this.readySpell(me, "heal");
      if (heal) return this.cast(heal.id, this.id);

      const potion = me.inventory.find((i) => i.id === "health_potion" && i.quantity > 0);
      if (potion) return { type: "use_item", actorId: this.id, itemId: "health_potion" };
    }

    const poison = this.readySpell(me, "poison");
    if (poison && !target.statusEffects.some((e) => e.type === "poison")) {
      return this.cast(poison.id, target.id);
    }

    if (me.mp < 25) {
      const manaPot = me.inventory.find((i) => i.id === "mana_potion" && i.quantity > 0);
      if (manaPot) return { type: "use_item", actorId: this.id, itemId: "mana_potion" };
    }

    if (phase === "enraged") {
      const drain = this.readySpell(me, "drain");
      if (drain && me.hp < me.maxHp * 0.7) return this.cast(drain.id, target.id);

      const meteor = this.readySpell(me, "meteor");
      if (meteor) return this.cast(meteor.id, target.id);
    }

    const spellPriority: string[] = ["meteor", "lightning", "ice", "drain", "fire"];
    for (const sid of spellPriority) {
      const spell = this.readySpell(me, sid);
      if (spell) return this.cast(spell.id, target.id);
    }

    return this.attackEnemy();
  }

  // ── Demon Lord: adaptive strategy ─────────────────────

  private demonLordAI(me: BattleStateSnapshot["characters"][0], target: BattleStateSnapshot["characters"][0], _enemies: BattleStateSnapshot["characters"], phase: Phase): CombatAction {
    if (phase === "enraged" && !me.statusEffects.some((e) => e.type === "shield")) {
      const shield = this.readySpell(me, "shield");
      if (shield && Math.random() > 0.6) return this.cast(shield.id, this.id);
    }

    const poison = this.readySpell(me, "poison");
    if (poison && !target.statusEffects.some((e) => e.type === "poison") && Math.random() > 0.4) {
      return this.cast(poison.id, target.id);
    }

    if (me.hp < me.maxHp * 0.65) {
      const drain = this.readySpell(me, "drain");
      if (drain) return this.cast(drain.id, target.id);
    }

    const meteor = this.readySpell(me, "meteor");
    if (meteor && Math.random() > 0.3) return this.cast(meteor.id, target.id);

    const lightning = this.readySpell(me, "lightning");
    if (lightning) return this.cast(lightning.id, target.id);

    const fire = this.readySpell(me, "fire");
    if (fire) return this.cast(fire.id, target.id);

    const ice = this.readySpell(me, "ice");
    if (ice && Math.random() > 0.5) return this.cast(ice.id, target.id);

    return this.attackEnemy();
  }

  // ── Helpers ──────────────────────────────────────────

  private _dist = 0;
  private _maxMove = 0;
  private _me!: BattleStateSnapshot["characters"][0];
  private _enemy!: BattleStateSnapshot["characters"][0];
  private _enemies: BattleStateSnapshot["characters"] = [];
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
      spell?.target === "self" ? 0 : range,
    );
  }

  private attackEnemy(): CombatAction {
    return this._withMove(
      { type: "attack", actorId: this.id, targetId: this._enemy.id },
      MELEE_RANGE,
    );
  }

  onActionResult(_result: CombatResult): void {}
  onBattleEnd(_winner?: string, _reason?: string): void {}
  destroy(): void {}
}
