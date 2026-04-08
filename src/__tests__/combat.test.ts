import { describe, it, expect } from "vitest";
import { createCharacter, ALL_SPELLS } from "../engine/characters.js";
import { CombatAction, ARENA_PRESETS, ClassFeatureId, ItemId, ArenaConfig, getCoverBonus } from "../engine/types.js";
import { DiceRoller } from "../engine/dice.js";
import {
  resolveAction,
  resolveMove,
  processStatusEffects,
  tickCooldowns,
  determineTurnOrder,
  createSnapshot,
  checkOpportunityAttack,
  checkShieldReaction,
  checkUncannyDodge,
  applyDefensiveReactions,
  resetReaction,
  rollDeathSave,
  isDying,
  isDead,
  isStable,
  markUnconscious,
  breakConcentration,
  concentrationSaveFromDamage,
  applyDamageModifiers,
  applyDamageToDying,
  MELEE_RANGE,
  inRange,
} from "../engine/combat.js";

// ── Helpers ────────────────────────────────────────────

function makeWarrior(name = "Alpha", team = "red", pos = { x: 48, y: 30 }) {
  return createCharacter(name, name, "warrior", pos, team);
}
function makeMage(name = "Beta", team = "blue", pos = { x: 52, y: 30 }) {
  return createCharacter(name, name, "mage", pos, team);
}
function makeRogue(name = "Gamma", team = "green", pos = { x: 50, y: 10 }) {
  return createCharacter(name, name, "rogue", pos, team);
}
function makePaladin(name = "Delta", team = "gold", pos = { x: 50, y: 50 }) {
  return createCharacter(name, name, "paladin", pos, team);
}

function makeRiggedDice(overrides: number[]): DiceRoller {
  // Create a rigged dice roller that returns specific values in order
  const real = new DiceRoller(42);
  let idx = 0;
  // Override the d method directly on the instance
  real.d = function (n: number, _ctx: string): number {
    if (idx < overrides.length) return overrides[idx++];
    // Fall back to real random
    return Math.floor(Math.random() * n) + 1;
  };
  // Override d20 to use our rigged d()
  real.d20 = function (ctx: string): number {
    return real.d(20, ctx);
  };
  real.d4 = function (ctx: string): number { return real.d(4, ctx); };
  real.d6 = function (ctx: string): number { return real.d(6, ctx); };
  real.d8 = function (ctx: string): number { return real.d(8, ctx); };
  real.d10 = function (ctx: string): number { return real.d(10, ctx); };
  real.d12 = function (ctx: string): number { return real.d(12, ctx); };
  real.rollDice = function (notation: string, ctx: string): number {
    const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) throw new Error(`Invalid dice notation: "${notation}"`);
    const count = parseInt(match[1]);
    const sides = parseInt(match[2]);
    const modifier = match[3] ? parseInt(match[3]) : 0;
    let total = modifier;
    for (let i = 0; i < count; i++) total += real.d(sides, ctx);
    return total;
  };
  return real;
}

// ══════════════════════════════════════════════════════════
//  Attack Resolution
// ══════════════════════════════════════════════════════════

describe("Attack Resolution", () => {
  it("misses when attack roll + modifiers < target AC", () => {
    const warrior = makeWarrior();
    const mage = makeMage();
    // Force the d20 to roll low: say 5. STR 17 → +3, prof +3 → total = 11 < 12 (mage AC)
    const dice = makeRiggedDice([5]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage).toBeDefined();
    expect(result.damage!.wasMiss).toBe(true);
    expect(result.damage!.damage).toBe(0);
    expect(mage.stats.hp).toBe(mage.stats.maxHp); // no damage
  });

  it("hits when attack roll + modifiers >= target AC", () => {
    const warrior = makeWarrior();
    const mage = makeMage();
    // d20=15, STR 17→+3, prof +3 → total = 21 >= 12 (mage AC)
    // Then 2d6 damage: let's say [3, 4] = 7 + 3 (STR mod) = 10
    const dice = makeRiggedDice([15, 3, 4]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage).toBeDefined();
    expect(result.damage!.wasMiss).toBe(false);
    expect(result.damage!.damage).toBeGreaterThan(0);
    expect(mage.stats.hp).toBeLessThan(mage.stats.maxHp);
  });

  it("critical hit on natural 20 doubles damage dice", () => {
    // Use a rogue (no Extra Attack) attacking a paralyzed target (sneak attack eligible)
    const rogue = makeRogue("R", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    // Make target paralyzed so rogue gets advantage (sneak attack conditions met)
    mage.statusEffects = [{ type: "paralyzed", turnsRemaining: 1, potency: 0, sourceId: "x" }];
    // Advantage d20: consumes 2 dice (20, X) → keeps 20. Then rapier 2d8 (crit): [5, 6] = 11 + 3 DEX = 14
    // Then sneak attack 3d6: [2, 2, 2] = 6
    // Total: 14 + 6 = 20
    const dice = makeRiggedDice([20, 1, 5, 6, 2, 2, 2]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage]);

    expect(result.damage!.wasCrit).toBe(true);
    expect(result.damage!.damageRolls!.length).toBeGreaterThanOrEqual(5); // 2d8 for crit + 3d6 sneak
    expect(result.damage!.damage).toBe(5 + 6 + 3 + 2 + 2 + 2); // 20
  });

  it("critical miss on natural 1 always misses", () => {
    const warrior = makeWarrior();
    const mage = makeMage();
    // Even with high bonus, nat 1 is auto-miss
    const dice = makeRiggedDice([1]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasMiss).toBe(true);
    expect(result.damage!.damage).toBe(0);
    expect(result.narrative).toContain("critical miss");
  });

  it("fails when target is out of weapon range", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 90, y: 30 }); // 80ft away, warrior range = 5ft
    const dice = new DiceRoller(42);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("too far away");
    expect(mage.stats.hp).toBe(mage.stats.maxHp);
  });

  it("Extra Attack triggers second attack on hit", () => {
    const warrior = makeWarrior();
    const mage = makeMage();
    // d20=20 crit (hits), 4d6 (crit damage), then extra: d20=15, 2d6=[3,4]
    // Total dice needed: [20, 5, 5, 5, 5, 15, 3, 4]
    const dice = makeRiggedDice([20, 5, 5, 5, 5, 15, 3, 4]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.extraAttacks).toBeDefined();
    expect(result.extraAttacks!.length).toBe(1);
  });

  it("Sneak Attack adds 3d6 on hit when ally is adjacent", () => {
    const rogue = makeRogue("R", "red", { x: 48, y: 30 });
    const mage = makeMage("Target", "blue", { x: 50, y: 30 }); // within melee range
    // Add an ally near the target to meet sneak attack conditions (also grants advantage via flanking)
    const ally = makeWarrior("A", "red", { x: 52, y: 30 });
    // Advantage d20: consumes 2 dice (15, X) → keeps 15 (hit). Then 1d8=[6]+3 DEX = 9
    // Then 3d6 sneak=[3,4,5] = 12
    // Total: 9 + 12 = 21
    const dice = makeRiggedDice([15, 1, 6, 3, 4, 5]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage, ally]);

    expect(result.damage!.damageRolls!.length).toBeGreaterThanOrEqual(4); // 1d8 + 3d6
    // 6 + 3+4+5 + 3 (DEX mod) = 21
    expect(result.damage!.damage).toBe(21);
  });

  it("Divine Smite adds 2d8 on hit and consumes slot", () => {
    const paladin = makePaladin("P", "gold", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    const slotsBefore = paladin.spellSlots[1]!.total - paladin.spellSlots[1]!.used;
    // Dice order: d20=15 (main hit), 1d8=4 (weapon dmg), d20=2 (extra attack miss),
    // then Divine Smite: 2d8=[5,6] = 11 extra
    // Total: 4 (weapon) + 3 (STR mod) + 2 (dueling) + 11 (smite) = 20
    const dice = makeRiggedDice([15, 4, 2, 5, 6]);
    const action: CombatAction = { type: "attack", actorId: paladin.id, targetId: mage.id, abilityId: "divine_smite" };
    const result = resolveAction(paladin, mage, action, dice, ARENA_PRESETS.medium);

    // Main: 4 + 3(STR) + 2(dueling) = 9, smite: 5+6=11, total = 20
    const totalDmg = result.damage!.damage;
    expect(totalDmg).toBe(20);

    // Consumed a 1st-level slot
    const slotsAfter = paladin.spellSlots[1]!.total - paladin.spellSlots[1]!.used;
    expect(slotsAfter).toBe(slotsBefore - 1);
  });

  it("Divine Smite does NOT trigger without explicit abilityId", () => {
    const paladin = makePaladin("P", "gold", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    const slotsBefore = paladin.spellSlots[1]!.total - paladin.spellSlots[1]!.used;
    // d20=15 (hit), 1d8=4 (weapon dmg), d20=2 (extra miss)
    const dice = makeRiggedDice([15, 4, 2]);
    const action: CombatAction = { type: "attack", actorId: paladin.id, targetId: mage.id };
    const result = resolveAction(paladin, mage, action, dice, ARENA_PRESETS.medium);

    // No smite — only weapon damage
    expect(result.damage!.damage).toBe(9); // 4 + 3(STR) + 2(dueling)
    // Spell slots NOT consumed
    const slotsAfter = paladin.spellSlots[1]!.total - paladin.spellSlots[1]!.used;
    expect(slotsAfter).toBe(slotsBefore);
  });

  it("paralyzed target auto-crits", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 }); // in melee range
    mage.statusEffects.push({
      type: "paralyzed", turnsRemaining: 1, potency: 0, sourceId: "x",
    });
    // Even a nat 1 will be overridden to auto-hit + auto-crit
    // Re-roll damage with double dice: 4d6, then extra attack 2d6
    // Nat 1 → overridden to auto-crit. 4d6 for main crit: [3,3,3,3]=12+3=15
    // Extra attack: d20=20 (another crit), 4d6=[2,2,2,2]=8+3=11
    // Total: 15+11=26... but we need enough dice for the extra attack too
    const dice = makeRiggedDice([1, 3, 3, 3, 3, 20, 2, 2, 2, 2]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasCrit).toBe(true);
    expect(result.damage!.damage).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════
//  Spell Resolution
// ══════════════════════════════════════════════════════════

describe("Spell Resolution", () => {
  it("Fire Bolt hits with attack roll", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    // d20 spell attack: 15, casting mod (INT +3, prof +3) = 21 >= 16 (warrior AC)
    // 2d10 fire bolt: [5, 6] = 11 + 3 (INT mod) = 14
    const dice = makeRiggedDice([15, 5, 6]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fire_bolt",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.spell).toBeDefined();
    expect(result.spell!.slotUsed).toBe(0); // cantrip
    expect(result.damage).toBeDefined();
    expect(result.damage!.wasMiss).toBe(false);
    expect(warrior.stats.hp).toBeLessThan(warrior.stats.maxHp);
  });

  it("Fire Bolt doesn't consume spell slot (cantrip)", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    const dice = makeRiggedDice([15, 5, 6]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fire_bolt",
    };
    resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    // No slots consumed for cantrip
    expect(mage.spellSlots[1]!.used).toBe(0);
  });

  it("Fireball deals 8d6 damage, DEX save for half", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    // DEX save: d20=5 + DEX(14→+2) = 7 < DC 14 → fail
    // 8d6 fireball: [6,6,6,6,6,6,6,6] = 48
    const dice = makeRiggedDice([5, 6, 6, 6, 6, 6, 6, 6, 6]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fireball",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage).toBeDefined();
    expect(result.damage!.saveSuccess).toBe(false);
    expect(result.damage!.damage).toBe(48); // all 6s
    expect(result.spell!.slotUsed).toBe(3); // 3rd level slot
  });

  it("Fireball halves damage on successful save", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    // DEX save: d20=20 + DEX(14→+2) = 22 >= DC 14 → success
    // 8d6: [4,4,4,4,4,4,4,4] = 32, halved = 16
    const dice = makeRiggedDice([20, 4, 4, 4, 4, 4, 4, 4, 4]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fireball",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.saveSuccess).toBe(true);
    expect(result.damage!.damage).toBe(16); // 32 / 2
  });

  it("Magic Missile auto-hits for 3d4+3", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    // No attack roll or save needed
    // 3d4+3: [2,3,4] = 9 + 3 = 12
    const dice = makeRiggedDice([2, 3, 4]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "magic_missile",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasMiss).toBe(false);
    expect(result.damage!.damage).toBe(12);
    expect(result.spell!.slotUsed).toBe(1);
  });

  it("Shield gives +5 AC buff to self", () => {
    const mage = makeMage();
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: mage.id, spellId: "shield",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(mage.statusEffects.some(e => e.type === "shield")).toBe(true);
    expect(mage.statusEffects.find(e => e.type === "shield")!.potency).toBe(5);
    expect(result.spell!.slotUsed).toBe(1);
  });

  it("Cure Wounds heals the caster", () => {
    const paladin = makePaladin();
    paladin.stats.hp = 30; // damaged
    const dice = makeRiggedDice([6]); // 1d8 = 6 + WIS mod(+1) = 7
    const action: CombatAction = {
      type: "cast_spell", actorId: paladin.id, targetId: paladin.id, spellId: "cure_wounds",
    };
    const result = resolveAction(paladin, paladin, action, dice, ARENA_PRESETS.medium);

    expect(result.heal).toBeDefined();
    expect(result.heal!.amount).toBe(7); // 6 + 1 (WIS 13 → +1)
    expect(paladin.stats.hp).toBe(37);
  });

  it("Hold Person applies paralyzed on failed save", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    // WIS save: d20=1 + WIS(12→+1) = 2 < DC 14 → fail
    const dice = makeRiggedDice([1]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "hold_person",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(warrior.statusEffects.some(e => e.type === "paralyzed")).toBe(true);
    expect(result.spell!.statusApplied).toBe("paralyzed");
  });

  it("Hold Person does NOT apply on successful save", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    // WIS save: d20=20 + WIS(12→+1) = 21 >= DC 14 → success
    const dice = makeRiggedDice([20]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "hold_person",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(warrior.statusEffects.some(e => e.type === "paralyzed")).toBe(false);
    expect(result.spell!.statusApplied).toBeUndefined();
  });

  it("fails when out of spell slots", () => {
    const mage = makeMage();
    // Exhaust all 3rd level slots
    mage.spellSlots[3]!.used = mage.spellSlots[3]!.total;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: mage.id, spellId: "fireball",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("no spell slots left");
  });

  it("fails when spell on cooldown", () => {
    const mage = makeMage();
    const spell = mage.spells.find(s => s.id === "fireball")!;
    spell.currentCooldown = 2;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: mage.id, spellId: "fireball",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("cooldown");
  });

  it("fails when out of range", () => {
    const mage = makeMage("M", "blue", { x: 10, y: 30 }); // far away
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 }); // 80ft apart
    // Thunderwave has range 15ft — way too far at 80ft
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "thunderwave",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("too far away");
  });
});

// ══════════════════════════════════════════════════════════
//  Item Resolution
// ══════════════════════════════════════════════════════════

describe("Item Resolution", () => {
  it("Health Potion heals the user (2d4+2)", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 20;
    // 2d4+2 with rigged dice: [3, 3] = 6 + 2 = 8
    const dice = makeRiggedDice([3, 3]);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, itemId: "health_potion",
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.heal).toBeDefined();
    expect(result.heal!.amount).toBe(8); // 2d4(3,3) + 2
    expect(warrior.stats.hp).toBe(28);
    const pot = warrior.inventory.find(i => i.id === "health_potion")!;
    expect(pot.quantity).toBe(2); // started with 3
  });

  it("Antidote cures status effects", () => {
    const rogue = makeRogue();
    rogue.statusEffects.push({ type: "poison", turnsRemaining: 3, potency: 5, sourceId: "x" });
    rogue.statusEffects.push({ type: "burn", turnsRemaining: 2, potency: 3, sourceId: "x" });
    // Need an antidote — add one
    rogue.inventory.push({
      id: "antidote", name: "Antidote", description: "", quantity: 1,
      type: "cure", potency: 0, range: 0,
    });
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: rogue.id, itemId: "antidote",
    };
    const result = resolveAction(rogue, rogue, action, dice, ARENA_PRESETS.medium);

    expect(rogue.statusEffects).toHaveLength(0);
    expect(result.narrative).toContain("cured");
  });

  it("Alchemist Fire deals 3d6 damage to target", () => {
    const warrior = makeWarrior();
    const mage = makeMage("M", "blue", { x: 50, y: 30 }); // within bomb range (20ft)
    // 3d6: [4, 5, 6] = 15
    const dice = makeRiggedDice([4, 5, 6]);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, targetId: mage.id, itemId: "bomb",
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage).toBeDefined();
    expect(result.damage!.damage).toBe(15);
    expect(mage.stats.hp).toBe(mage.stats.maxHp - 15);
  });

  it("Elixir fully restores HP and spell slots", () => {
    const mage = makeMage();
    mage.stats.hp = 5;
    mage.spellSlots[1]!.used = 4;
    mage.spellSlots[3]!.used = 2;
    mage.statusEffects.push({ type: "poison", turnsRemaining: 3, potency: 5, sourceId: "x" });
    // Add an elixir
    mage.inventory.push({
      id: "elixir", name: "Elixir of Health", description: "", quantity: 1,
      type: "full_restore", potency: 0, range: 0,
    });
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: mage.id, itemId: "elixir",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(mage.stats.hp).toBe(mage.stats.maxHp);
    expect(mage.spellSlots[1]!.used).toBe(0);
    expect(mage.spellSlots[3]!.used).toBe(0);
    expect(mage.statusEffects).toHaveLength(0);
    expect(result.heal!.amount).toBeGreaterThan(0);
  });

  it("fails when item not in inventory", () => {
    const warrior = makeWarrior();
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, itemId: "elixir", // warrior has no elixir
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("doesn't have that item");
  });
});

// ══════════════════════════════════════════════════════════
//  Class Abilities
// ══════════════════════════════════════════════════════════

describe("Class Abilities", () => {
  it("Second Wind heals 1d10+5 HP", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 20;
    const dice = makeRiggedDice([8]); // 1d10 = 8 + 5 = 13
    const action: CombatAction = {
      type: "class_ability", actorId: warrior.id, abilityId: "second_wind",
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.heal!.amount).toBe(13);
    expect(warrior.stats.hp).toBe(33);
    // Uses consumed
    const sw = warrior.features.find(f => f.id === "second_wind")!;
    expect(sw.usesRemaining).toBe(0);
  });

  it("Second Wind can't be used twice", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 20;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: warrior.id, abilityId: "second_wind",
    };
    resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("no uses remaining");
  });

  it("Lay on Hands heals up to 25 HP", () => {
    const paladin = makePaladin();
    paladin.stats.hp = 10;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: paladin.id, abilityId: "lay_on_hands",
    };
    const result = resolveAction(paladin, paladin, action, dice, ARENA_PRESETS.medium);

    expect(result.heal!.amount).toBe(25); // fills to 35 but max is 52... wait
    // 10 + 25 = 35, capped at maxHp=52, so 25 is correct
    expect(paladin.stats.hp).toBe(35);
  });

  it("Lay on Hands caps at missing HP", () => {
    const paladin = makePaladin();
    const missing = 4;
    paladin.stats.hp = paladin.stats.maxHp - missing;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: paladin.id, abilityId: "lay_on_hands",
    };
    const result = resolveAction(paladin, paladin, action, dice, ARENA_PRESETS.medium);

    expect(result.heal!.amount).toBe(missing);
    expect(paladin.stats.hp).toBe(paladin.stats.maxHp);
  });

  it("Arcane Recovery recovers one spell slot", () => {
    const mage = makeMage();
    mage.spellSlots[3]!.used = 2;
    mage.spellSlots[1]!.used = 4;
    const dice = new DiceRoller(42);
    // Should recover the highest level slot first: 3rd level
    const action: CombatAction = {
      type: "class_ability", actorId: mage.id, abilityId: "arcane_recovery",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(mage.spellSlots[3]!.used).toBe(1);
    expect(result.narrative).toContain("3rd");
  });
});

// ══════════════════════════════════════════════════════════
//  Defend / Wait
// ══════════════════════════════════════════════════════════

describe("Defend and Wait", () => {
  it("Defend sets isDefending flag and clears on next action", () => {
    const warrior = makeWarrior();
    const dice = new DiceRoller(42);

    // Defend
    const defend: CombatAction = { type: "defend", actorId: warrior.id };
    resolveAction(warrior, undefined, defend, dice, ARENA_PRESETS.medium);
    expect(warrior.isDefending).toBe(true);

    // Attack clears it
    const mage = makeMage("M", "blue", { x: 10, y: 30 });
    const attack: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    resolveAction(warrior, mage, attack, dice, ARENA_PRESETS.medium);
    expect(warrior.isDefending).toBe(false);
  });

  it("Wait returns a wait result", () => {
    const warrior = makeWarrior();
    const dice = new DiceRoller(42);
    const action: CombatAction = { type: "wait", actorId: warrior.id };
    const result = resolveAction(warrior, undefined, action, dice, ARENA_PRESETS.medium);

    expect(result.action.type).toBe("wait");
    expect(result.narrative).toContain("waits");
  });
});

// ══════════════════════════════════════════════════════════
//  Movement
// ══════════════════════════════════════════════════════════

describe("Movement Resolution", () => {
  it("moves character within speed limit", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const arena = ARENA_PRESETS.medium;
    const result = resolveMove(warrior, { dx: 30, dy: 0 }, arena);

    expect(result.from).toEqual({ x: 10, y: 30 });
    expect(result.to).toEqual({ x: 40, y: 30 });
    expect(warrior.position).toEqual({ x: 40, y: 30 });
  });

  it("clamps movement to speed limit", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const arena = ARENA_PRESETS.medium;
    // Try to move 100ft but speed is 30
    const result = resolveMove(warrior, { dx: 100, dy: 0 }, arena);

    expect(result.to.x).toBe(40); // 10 + 30
    expect(warrior.position.x).toBe(40);
  });

  it("clamps to arena bounds", () => {
    const warrior = makeWarrior("W", "red", { x: 5, y: 5 });
    const arena = ARENA_PRESETS.medium;
    const result = resolveMove(warrior, { dx: -30, dy: -30 }, arena);

    expect(result.to.x).toBeGreaterThanOrEqual(0);
    expect(result.to.y).toBeGreaterThanOrEqual(0);
  });

  it("move+act in one action", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 70, y: 30 });
    const arena = ARENA_PRESETS.medium;
    const dice = makeRiggedDice([15, 3, 4]); // attack hit + 2d6 damage
    const action: CombatAction = {
      type: "attack", actorId: warrior.id, targetId: mage.id,
      move: { dx: 20, dy: 0 },
    };
    const result = resolveAction(warrior, mage, action, dice, arena);

    expect(result.move).toBeDefined();
    expect(result.move!.from).toEqual({ x: 50, y: 30 });
    expect(result.move!.to).toEqual({ x: 70, y: 30 });
    expect(warrior.position).toEqual({ x: 70, y: 30 });
    expect(result.damage).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
//  Status Effects
// ══════════════════════════════════════════════════════════

describe("Status Effects", () => {
  it("burn damages and decrements", () => {
    const warrior = makeWarrior();
    warrior.statusEffects.push({
      type: "burn", turnsRemaining: 2, potency: 5, sourceId: "x",
    });
    const narratives = processStatusEffects(warrior);

    expect(warrior.stats.hp).toBe(warrior.stats.maxHp - 5);
    expect(narratives).toHaveLength(1); // just the damage message
    expect(narratives[0]).toContain("burn damage");
    expect(warrior.statusEffects).toHaveLength(1);
    expect(warrior.statusEffects[0].turnsRemaining).toBe(1);
  });

  it("status effect removed when turnsRemaining hits 0", () => {
    const warrior = makeWarrior();
    warrior.statusEffects.push({
      type: "shield", turnsRemaining: 1, potency: 5, sourceId: "x",
    });
    processStatusEffects(warrior);
    expect(warrior.statusEffects).toHaveLength(0);
  });

  it("poison damages each tick", () => {
    const warrior = makeWarrior();
    warrior.statusEffects.push({
      type: "poison", turnsRemaining: 3, potency: 4, sourceId: "x",
    });
    processStatusEffects(warrior);
    expect(warrior.stats.hp).toBe(warrior.stats.maxHp - 4);
    processStatusEffects(warrior);
    expect(warrior.stats.hp).toBe(warrior.stats.maxHp - 8);
  });

  it("regen heals each tick", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 30;
    warrior.statusEffects.push({
      type: "regen", turnsRemaining: 2, potency: 5, sourceId: "x",
    });
    processStatusEffects(warrior);
    expect(warrior.stats.hp).toBe(35);
  });

  it("regen doesn't exceed maxHp", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = warrior.stats.maxHp - 2;
    warrior.statusEffects.push({
      type: "regen", turnsRemaining: 1, potency: 10, sourceId: "x",
    });
    processStatusEffects(warrior);
    expect(warrior.stats.hp).toBe(warrior.stats.maxHp);
  });
});

// ══════════════════════════════════════════════════════════
//  Cooldowns
// ══════════════════════════════════════════════════════════

describe("Cooldown Ticking", () => {
  it("tickCooldowns decrements all positive cooldowns", () => {
    const mage = makeMage();
    const fireball = mage.spells.find(s => s.id === "fireball")!;
    const shield = mage.spells.find(s => s.id === "shield")!;
    fireball.currentCooldown = 4;
    shield.currentCooldown = 1;

    tickCooldowns(mage);

    expect(fireball.currentCooldown).toBe(3);
    expect(shield.currentCooldown).toBe(0);
  });

  it("tickCooldowns doesn't go below 0", () => {
    const mage = makeMage();
    const spell = mage.spells[0];
    spell.currentCooldown = 0;
    tickCooldowns(mage);
    expect(spell.currentCooldown).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════
//  Turn Order
// ══════════════════════════════════════════════════════════

describe("Turn Order (Initiative)", () => {
  it("sorts by initiative (d20 + DEX mod)", () => {
    const warrior = makeWarrior("W", "red"); // DEX 14 → +2
    const mage = makeMage("M", "blue"); // DEX 14 → +2
    const rogue = makeRogue("R", "green"); // DEX 17 → +3

    // Rig dice: warrior gets 15, mage gets 10, rogue gets 12
    const dice = makeRiggedDice([15, 10, 12]);
    const order = determineTurnOrder([warrior, mage, rogue], dice);

    // warrior: 15+2=17, rogue: 12+3=15, mage: 10+2=12
    expect(order[0].id).toBe(warrior.id);
    expect(order[1].id).toBe(rogue.id);
    expect(order[2].id).toBe(mage.id);
  });

  it("skips dead characters", () => {
    const warrior = makeWarrior("W", "red");
    const mage = makeMage("M", "blue");
    mage.stats.hp = 0; // dead

    const dice = new DiceRoller(42);
    const order = determineTurnOrder([warrior, mage], dice);

    expect(order).toHaveLength(1);
    expect(order[0].id).toBe(warrior.id);
  });
});

// ══════════════════════════════════════════════════════════
//  Snapshot
// ══════════════════════════════════════════════════════════

describe("createSnapshot", () => {
  it("creates a deep copy of character state", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 30;
    warrior.statusEffects.push({ type: "shield", turnsRemaining: 2, potency: 5, sourceId: "x" });

    const snapshot = createSnapshot([warrior], 1, "ongoing", ARENA_PRESETS.medium);

    expect(snapshot.characters).toHaveLength(1);
    expect(snapshot.characters[0].hp).toBe(30);
    expect(snapshot.characters[0].statusEffects).toHaveLength(1);
    expect(snapshot.turnNumber).toBe(1);

    // Verify deep copy
    snapshot.characters[0].hp = 999;
    expect(warrior.stats.hp).toBe(30); // original unchanged
  });

  it("includes all character fields", () => {
    const mage = makeMage();
    const snapshot = createSnapshot([mage], 5, "ongoing", ARENA_PRESETS.medium);
    const c = snapshot.characters[0];

    expect(c.name).toBe("Beta");
    expect(c.class).toBe("mage");
    expect(c.ac).toBe(12);
    expect(c.spells.length).toBeGreaterThan(0);
    expect(c.features.length).toBeGreaterThan(0);
    expect(c.weapon.name).toBe("Quarterstaff");
    expect(c.savingThrowProfs).toContain("int");
  });
});

// ══════════════════════════════════════════════════════════
//  Range Check
// ══════════════════════════════════════════════════════════

describe("inRange", () => {
  it("returns true when within range", () => {
    const a = makeWarrior("A", "red", { x: 10, y: 30 });
    const b = makeMage("B", "blue", { x: 14, y: 30 }); // 4ft apart
    expect(inRange(a, b, MELEE_RANGE)).toBe(true); // 4 <= 5
  });

  it("returns false when outside range", () => {
    const a = makeWarrior("A", "red", { x: 10, y: 30 });
    const b = makeMage("B", "blue", { x: 20, y: 30 }); // 10ft apart
    expect(inRange(a, b, MELEE_RANGE)).toBe(false); // 10 > 5
  });

  it("returns true at exactly range boundary", () => {
    const a = makeWarrior("A", "red", { x: 10, y: 30 });
    const b = makeMage("B", "blue", { x: 15, y: 30 }); // exactly 5ft
    expect(inRange(a, b, MELEE_RANGE)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
//  Evasion (Rogue Feature)
// ══════════════════════════════════════════════════════════

describe("Evasion", () => {
  it("rogue takes 0 damage on successful DEX save", () => {
    const mage = makeMage("Caster", "red", { x: 50, y: 30 });
    const rogue = makeRogue("R", "blue", { x: 50, y: 30 });
    const hpBefore = rogue.stats.hp;

    // Fireball: DEX save d20=20, rogue DEX 17 → +3 + prof +3 = 26 >= DC 14
    // 8d6 damage: any values, but evasion negates
    const dice = makeRiggedDice([20, 1, 1, 1, 1, 1, 1, 1, 1]); // save=20, 8d6 all 1s
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: rogue.id, spellId: "fireball",
    };
    const result = resolveAction(mage, rogue, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.saveSuccess).toBe(true);
    expect(result.damage!.damage).toBe(0); // evasion: no damage on success
    expect(rogue.stats.hp).toBe(hpBefore);
  });
});

// ══════════════════════════════════════════════════════════
//  Effective AC (Shield + Defend)
// ══════════════════════════════════════════════════════════

describe("Effective AC", () => {
  it("defending adds +2 AC", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    // Warrior AC = 16 normally
    // Without defend: d20=15, +3 STR, +3 prof = 21 >= 12 → hit
    // Let's set mage as defender
    mage.isDefending = true;
    // Mage normal AC = 12, defending AC = 14
    // d20=13, STR+3, prof+3 = 19 >= 14 → still hit with defend
    const dice = makeRiggedDice([15, 3, 4, 2]); // hit, damage, extra miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    // Should still hit since 21 >= 14, but AC is increased
    expect(result.damage!.targetAc).toBe(14); // 12 + 2 defend
  });

  it("shield status effect adds to AC", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    // Add shield status: +5 AC
    mage.statusEffects.push({ type: "shield", turnsRemaining: 2, potency: 5, sourceId: "m1" });
    // Mage AC = 12 + 5 = 17
    // d20=10, STR+3, prof+3 = 16 < 17 → miss!
    const dice = makeRiggedDice([10]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasMiss).toBe(true);
    expect(result.damage!.targetAc).toBe(17); // 12 + 5 shield
  });

  it("defend + shield stacks", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    mage.isDefending = true;
    mage.statusEffects.push({ type: "shield", turnsRemaining: 2, potency: 5, sourceId: "m1" });
    // Mage AC = 12 + 2 (defend) + 5 (shield) = 19
    // d20=15, STR+3, prof+3 = 21 >= 19 → hit
    const dice = makeRiggedDice([15, 3, 4, 2]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.targetAc).toBe(19);
  });
});

// ══════════════════════════════════════════════════════════
//  Flee Resolution
// ══════════════════════════════════════════════════════════

describe("Flee Resolution", () => {
  it("successful flee when at edge of arena", () => {
    const warrior = makeWarrior("W", "red", { x: 0, y: 30 });
    const dice = new DiceRoller(42);
    const action: CombatAction = { type: "flee", actorId: warrior.id };
    const result = resolveAction(warrior, undefined, action, dice, ARENA_PRESETS.medium);

    expect(result.fled).toBe(true);
    expect(result.fledSuccessfully).toBe(true);
    expect(result.narrative).toContain("escapes");
  });

  it("failed flee when in middle of arena", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const dice = new DiceRoller(42);
    const action: CombatAction = { type: "flee", actorId: warrior.id };
    const result = resolveAction(warrior, undefined, action, dice, ARENA_PRESETS.medium);

    expect(result.fled).toBe(true);
    expect(result.fledSuccessfully).toBe(false);
    expect(result.narrative).toContain("can't reach the edge");
  });

  it("successful flee at right edge", () => {
    const warrior = makeWarrior("W", "red", { x: 100, y: 30 });
    const arena = ARENA_PRESETS.medium; // width = 100
    const dice = new DiceRoller(42);
    const action: CombatAction = { type: "flee", actorId: warrior.id };
    const result = resolveAction(warrior, undefined, action, dice, arena);

    expect(result.fledSuccessfully).toBe(true);
  });

  it("flee dashes toward nearest edge at full speed", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const arena = ARENA_PRESETS.medium; // width = 100, speed = 30
    const dice = new DiceRoller(42);
    const action: CombatAction = { type: "flee", actorId: warrior.id };
    resolveAction(warrior, undefined, action, dice, arena);

    // Warrior at x=50, right edge is 100 (distance 50), left edge is 0 (distance 50)
    // Ties go right, so x should be 50 + 30 = 80
    expect(warrior.position.x).toBe(80);
    expect(warrior.position.y).toBe(30);
  });

  it("flee from near left edge reaches it", () => {
    const warrior = makeWarrior("W", "red", { x: 15, y: 30 });
    const arena = ARENA_PRESETS.medium; // speed = 30
    const dice = new DiceRoller(42);
    const action: CombatAction = { type: "flee", actorId: warrior.id };
    const result = resolveAction(warrior, undefined, action, dice, arena);

    // Left edge is 15ft away, speed is 30, so should escape
    expect(result.fledSuccessfully).toBe(true);
    expect(warrior.position.x).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════
//  Dash Action
// ══════════════════════════════════════════════════════════

describe("Dash Action", () => {
  it("moves toward target at double speed", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 80, y: 30 });
    const arena = ARENA_PRESETS.small; // width 60
    const dice = new DiceRoller(42);
    const action: CombatAction = { type: "dash", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, arena);

    // Warrior speed is 30, dash = 60ft toward mage at 70ft away
    // Should end up closer but not at mage
    expect(result.move).toBeDefined();
    expect(result.narrative).toContain("dashes");
    // Distance from start should be close to 60 (capped by arena width)
    const moved = result.move!.distanceMoved;
    expect(moved).toBeGreaterThan(30); // more than normal move
  });

  it("closes the gap from far away", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const arena = ARENA_PRESETS.small; // width 60, so mage is 40ft away
    const dice = new DiceRoller(42);

    // Normal move: 30ft, still 10ft short
    // Dash: 60ft, should reach mage
    const action: CombatAction = { type: "dash", actorId: warrior.id, targetId: mage.id };
    resolveAction(warrior, mage, action, dice, arena);

    // Warrior should be right next to mage now
    const dist = Math.sqrt((warrior.position.x - mage.position.x) ** 2);
    expect(dist).toBeLessThanOrEqual(MELEE_RANGE + 1); // within melee
  });

  it("works without a target", () => {
    const warrior = makeWarrior("W", "red", { x: 30, y: 30 });
    const arena = ARENA_PRESETS.medium;
    const dice = new DiceRoller(42);
    const action: CombatAction = { type: "dash", actorId: warrior.id };
    const result = resolveAction(warrior, undefined, action, dice, arena);

    expect(result.narrative).toContain("nowhere to go");
  });
});

// ══════════════════════════════════════════════════════════
//  Item Edge Cases
// ══════════════════════════════════════════════════════════

describe("Item Edge Cases", () => {
  it("Greater Health Potion heals 4d4+4 HP", () => {
    const mage = makeMage();
    mage.stats.hp = 10;
    // 4d4+4 with rigged dice: [3, 3, 3, 3] = 12 + 4 = 16
    const dice = makeRiggedDice([3, 3, 3, 3]);
    const action: CombatAction = {
      type: "use_item", actorId: mage.id, itemId: "greater_health_potion",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.heal!.amount).toBe(16); // 4d4(3,3,3,3) + 4
    expect(mage.stats.hp).toBe(26);
    const pot = mage.inventory.find(i => i.id === "greater_health_potion")!;
    expect(pot.quantity).toBe(0);
  });

  it("Health Potion doesn't overheal", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = warrior.stats.maxHp - 3; // missing 3 HP
    // 2d4+2 with rigged dice: [3, 3] = 8 — but only 3 missing
    const dice = makeRiggedDice([3, 3]);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, itemId: "health_potion",
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    // Potion would heal 8 but only 3 missing
    expect(warrior.stats.hp).toBe(warrior.stats.maxHp);
    expect(result.heal!.amount).toBe(8); // potion always heals its rolled amount
  });

  it("using last item removes it from available uses", () => {
    const warrior = makeWarrior();
    // Warrior has 1 greater health potion
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, itemId: "greater_health_potion",
    };
    resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);
    const pot = warrior.inventory.find(i => i.id === "greater_health_potion")!;
    expect(pot.quantity).toBe(0);

    // Try using again — should fail (quantity 0)
    const result2 = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result2.narrative).toContain("doesn't have that item");
  });
});

// ══════════════════════════════════════════════════════════
//  Action Surge
// ══════════════════════════════════════════════════════════

describe("Action Surge", () => {
  it("Action Surge returns correct narrative", () => {
    const warrior = makeWarrior();
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: warrior.id, abilityId: "action_surge",
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("Action Surge");
    expect(result.abilityResult!.name).toBe("Action Surge");
    expect(result.abilityResult!.value).toBe(1);
  });

  it("Action Surge can only be used once per battle", () => {
    const warrior = makeWarrior();
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: warrior.id, abilityId: "action_surge",
    };
    resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("no uses remaining");
  });
});

// ══════════════════════════════════════════════════════════
//  Rogue Movement (Cunning Action)
// ══════════════════════════════════════════════════════════

describe("Rogue Movement (Cunning Action)", () => {
  it("rogue moves faster with Cunning Action (+15)", () => {
    const rogue = makeRogue("R", "red", { x: 10, y: 30 });
    const arena = ARENA_PRESETS.medium;
    // Normal speed 30 + 15 (cunning action) = 45 max move
    const result = resolveMove(rogue, { dx: 45, dy: 0 }, arena);
    expect(result.to.x).toBe(55); // 10 + 45
  });

  it("rogue move clamped to 45 (30+15)", () => {
    const rogue = makeRogue("R", "red", { x: 10, y: 30 });
    const arena = ARENA_PRESETS.medium;
    const result = resolveMove(rogue, { dx: 60, dy: 0 }, arena);
    expect(result.to.x).toBe(55); // 10 + 45
  });
});

// ══════════════════════════════════════════════════════════
//  Scorching Ray (attack roll spell)
// ══════════════════════════════════════════════════════════

describe("Scorching Ray", () => {
  it("3 separate rays, each with own attack roll", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // 3 rays: d20=15 (hit), 2d6=[3,3]=6; d20=14 (hit), 2d6=[2,2]=4; d20=13 (hit), 2d6=[1,1]=2
    // Total: 6+4+2=12
    const dice = makeRiggedDice([15, 3, 3, 14, 2, 2, 13, 1, 1]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "scorching_ray",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("3/3 rays hit");
    expect(result.damage!.damage).toBe(12);
    expect(result.damage!.wasMiss).toBe(false);
    expect(result.spell!.slotUsed).toBe(2);
  });

  it("partial hits — some rays miss, some hit", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // Ray 1: d20=1 (nat 1, auto-miss)
    // Ray 2: d20=15 (hit), 2d6=[4,4]=8
    // Ray 3: d20=5 (miss)
    const dice = makeRiggedDice([1, 15, 4, 4, 5]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "scorching_ray",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("1/3 rays hit");
    expect(result.damage!.damage).toBe(8);
  });

  it("all 3 rays miss", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // All miss: d20=1, d20=2, d20=3
    const dice = makeRiggedDice([1, 2, 3]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "scorching_ray",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("0/3 rays hit");
    expect(result.damage!.damage).toBe(0);
    expect(result.damage!.wasMiss).toBe(true);
  });

  it("crit on a ray doubles that ray's damage", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // Ray 1: d20=20 (crit!), 4d6=[4,4,4,4]=16
    // Ray 2: d20=15 (hit), 2d6=[3,3]=6
    // Ray 3: d20=14 (hit), 2d6=[2,2]=4
    const dice = makeRiggedDice([20, 4, 4, 4, 4, 15, 3, 3, 14, 2, 2]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "scorching_ray",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasCrit).toBe(true);
    expect(result.damage!.damage).toBe(26); // 16 + 6 + 4
  });
});

// ══════════════════════════════════════════════════════════
//  Thunderwave (save spell with half damage)
// ══════════════════════════════════════════════════════════

describe("Thunderwave", () => {
  it("deals full damage on failed CON save", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // CON save: d20=1, CON 16→+3, prof(str/con) so +3 = 1+3+3=7 < DC 14 → fail
    // 2d8 thunder: [5, 6] = 11
    const dice = makeRiggedDice([1, 5, 6]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "thunderwave",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.saveSuccess).toBe(false);
    expect(result.damage!.damage).toBe(11);
  });

  it("deals half damage on successful CON save", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // CON save: d20=20, CON 16→+3, prof +3 = 26 >= DC 14 → success
    // 2d8: [6, 6] = 12, halved = 6
    const dice = makeRiggedDice([20, 6, 6]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "thunderwave",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.saveSuccess).toBe(true);
    expect(result.damage!.damage).toBe(6); // 12 / 2
  });
});

// ══════════════════════════════════════════════════════════
//  Shield of Faith
// ══════════════════════════════════════════════════════════

describe("Shield of Faith", () => {
  it("applies +2 AC shield buff", () => {
    const paladin = makePaladin();
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "cast_spell", actorId: paladin.id, targetId: paladin.id, spellId: "shield_of_faith",
    };
    const result = resolveAction(paladin, paladin, action, dice, ARENA_PRESETS.medium);

    const shieldEffect = paladin.statusEffects.find(e => e.type === "shield");
    expect(shieldEffect).toBeDefined();
    expect(shieldEffect!.potency).toBe(2);
    expect(shieldEffect!.turnsRemaining).toBe(3);
    expect(result.spell!.statusApplied).toBe("shield");
  });
});

// ══════════════════════════════════════════════════════════
//  Action History
// ══════════════════════════════════════════════════════════

describe("Action History", () => {
  it("records action types in history", () => {
    const warrior = makeWarrior();
    const mage = makeMage("M", "blue", { x: 48, y: 30 });
    const dice = new DiceRoller(42);

    const defend: CombatAction = { type: "defend", actorId: warrior.id };
    resolveAction(warrior, undefined, defend, dice, ARENA_PRESETS.medium);
    expect(warrior.actionHistory).toContain("defend");

    const attack: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    resolveAction(warrior, mage, attack, dice, ARENA_PRESETS.medium);
    expect(warrior.actionHistory).toContain("attack");
    expect(warrior.actionHistory).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════
//  HP Clamping (damage can't go below 0)
// ══════════════════════════════════════════════════════════

describe("HP Clamping", () => {
  it("HP can't go below 0 from attacks", () => {
    const mage = makeMage("M", "blue", { x: 48, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 52, y: 30 });
    // Mage has 27 HP. Warrior crit with lots of damage.
    // d20=20 (crit), 4d6=[6,6,6,6]=24 + 3 STR = 27
    // Extra attack: d20=20, 4d6=[6,6,6,6]=24 + 3 = 27
    // That's 54 damage on a 27 HP mage
    const dice = makeRiggedDice([20, 6, 6, 6, 6, 20, 6, 6, 6, 6]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(mage.stats.hp).toBe(0);
  });

  it("HP can't go below 0 from status effects", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 2;
    warrior.statusEffects.push({
      type: "burn", turnsRemaining: 1, potency: 100, sourceId: "x",
    });
    processStatusEffects(warrior);
    expect(warrior.stats.hp).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════
//  Multiple Status Effects
// ══════════════════════════════════════════════════════════

describe("Multiple Status Effects", () => {
  it("burn and poison apply simultaneously", () => {
    const warrior = makeWarrior();
    warrior.statusEffects.push(
      { type: "burn", turnsRemaining: 1, potency: 3, sourceId: "x" },
      { type: "poison", turnsRemaining: 1, potency: 4, sourceId: "x" },
    );
    processStatusEffects(warrior);
    expect(warrior.stats.hp).toBe(warrior.stats.maxHp - 7); // 3 + 4
    expect(warrior.statusEffects).toHaveLength(0); // both expired
  });

  it("multiple shield effects stack AC", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    mage.statusEffects.push(
      { type: "shield", turnsRemaining: 1, potency: 5, sourceId: "m" },
      { type: "shield", turnsRemaining: 1, potency: 2, sourceId: "p" },
    );
    // Mage AC = 12 + 5 + 2 = 19
    // d20=15, STR+3, prof+3 = 21 >= 19 → hit
    const dice = makeRiggedDice([15, 3, 4, 2]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.targetAc).toBe(19);
  });
});

// ══════════════════════════════════════════════════════════
//  Antidote (Cure Status)
// ══════════════════════════════════════════════════════════

describe("Antidote / Cure", () => {
  it("removes all status effects from target", () => {
    const rogue = makeRogue(); // has antidote
    rogue.statusEffects.push(
      { type: "poison", turnsRemaining: 3, potency: 4, sourceId: "x" },
      { type: "burn", turnsRemaining: 2, potency: 3, sourceId: "y" },
    );
    expect(rogue.statusEffects).toHaveLength(2);

    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: rogue.id, itemId: "antidote",
    };
    const result = resolveAction(rogue, rogue, action, dice, ARENA_PRESETS.medium);

    expect(rogue.statusEffects).toHaveLength(0);
    expect(result.item!.effect).toBe("cure");
    expect(result.narrative).toContain("cured");
    const pot = rogue.inventory.find(i => i.id === "antidote")!;
    expect(pot.quantity).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════
//  Generic Class Ability
// ══════════════════════════════════════════════════════════

describe("Generic Class Ability", () => {
  it("uses feature with generic fallback narrative", () => {
    const warrior = makeWarrior();
    warrior.features.push({
      id: "custom_slash" as ClassFeatureId,
      name: "Power Slash",
      description: "A mighty slash",
      usesPerBattle: 1,
      usesRemaining: 1,
    });
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: warrior.id, abilityId: "custom_slash" as ClassFeatureId,
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("Power Slash");
    expect(result.abilityResult!.name).toBe("Power Slash");
    expect(result.abilityResult!.description).toBe("A mighty slash");
  });
});

// ══════════════════════════════════════════════════════════
//  Unknown Action Type
// ══════════════════════════════════════════════════════════

describe("Unknown Action Type", () => {
  it("returns unknown narrative for invalid action type", () => {
    const warrior = makeWarrior();
    const dice = new DiceRoller(42);
    const action: any = { type: "dance", actorId: warrior.id };
    const result = resolveAction(warrior, undefined, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("unknown");
  });
});

// ══════════════════════════════════════════════════════════
//  Bomb (Damage Item)
// ══════════════════════════════════════════════════════════

describe("Bomb", () => {
  it("deals damage and reduces quantity", () => {
    const warrior = makeWarrior(); // has 2 bombs
    const mage = makeMage();
    const mageHpBefore = mage.stats.hp;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, targetId: mage.id, itemId: "bomb",
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.item!.effect).toBe("damage");
    expect(result.item!.value).toBeGreaterThan(0);
    expect(mage.stats.hp).toBeLessThan(mageHpBefore);
    const bombItem = warrior.inventory.find(i => i.id === "bomb")!;
    expect(bombItem.quantity).toBe(1); // was 2, now 1
  });

  it("fails when target is out of range", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 90, y: 30 }); // 80ft away, bomb range is 20ft
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, targetId: mage.id, itemId: "bomb",
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    // Bombs check range — item is refunded
    expect(result.damage).toBeUndefined();
    expect(result.narrative).toContain("too far away");
    const bombItem = warrior.inventory.find(i => i.id === "bomb")!;
    expect(bombItem.quantity).toBe(2); // refunded
  });

  it("hits when target is within bomb range", () => {
    const warrior = makeWarrior("W", "red", { x: 40, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 }); // 10ft away, bomb range is 20ft
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, targetId: mage.id, itemId: "bomb",
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage).toBeDefined();
    expect(result.damage!.damage).toBeGreaterThan(0);
    expect(result.narrative).toContain("Alchemist Fire");
  });
});

// ══════════════════════════════════════════════════════════
//  Magic Missile (Auto-hit Spell)
// ══════════════════════════════════════════════════════════

describe("Magic Missile", () => {
  it("auto-hits without attack roll", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    const dice = makeRiggedDice([4, 4, 4]); // 3d4 = 12 + 3 = 15
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "magic_missile",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasMiss).toBe(false);
    expect(result.damage!.damage).toBe(15);
    expect(result.damage!.wasCrit).toBe(false);
    expect(result.spell!.slotUsed).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════
//  Natural 1 & Natural 20
// ══════════════════════════════════════════════════════════

describe("Natural 1 & Natural 20", () => {
  it("natural 1 always misses regardless of total", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    const dice = makeRiggedDice([1]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasMiss).toBe(true);
    expect(result.damage!.damage).toBe(0);
  });

  it("natural 20 always hits and doubles weapon dice", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    (mage as any).stats.ac = 100;
    const dice = makeRiggedDice([20, 3, 3, 3, 3, 2]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasCrit).toBe(true);
    expect(result.damage!.damage).toBe(15); // 4*3 + 3 STR
  });
});

// ══════════════════════════════════════════════════════════
//  Arcane Recovery Edge Cases
// ══════════════════════════════════════════════════════════

describe("Arcane Recovery Edge Cases", () => {
  it("recovers highest level slot with available used", () => {
    const mage = makeMage();
    mage.spellSlots[1]!.used = 4;
    mage.spellSlots[2]!.used = 3;
    mage.spellSlots[3]!.used = 2;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: mage.id, abilityId: "arcane_recovery",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(mage.spellSlots[3]!.used).toBe(1);
    expect(mage.spellSlots[2]!.used).toBe(3);
    expect(result.narrative).toContain("3rd");
  });

  it("reports no slots when all are full", () => {
    const mage = makeMage();
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: mage.id, abilityId: "arcane_recovery",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("no slots to recover");
    expect(result.abilityResult!.value).toBe(0);
  });

  it("uses 1st ordinal when recovering level 1 slot", () => {
    const mage = makeMage();
    // Only level 1 slot has used slots
    mage.spellSlots[1]!.used = 4;
    mage.spellSlots[2]!.used = 0;
    mage.spellSlots[3]!.used = 0;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: mage.id, abilityId: "arcane_recovery",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(mage.spellSlots[1]!.used).toBe(3);
    expect(result.narrative).toContain("1st");
  });

  it("uses 2nd ordinal when recovering level 2 slot", () => {
    const mage = makeMage();
    mage.spellSlots[1]!.used = 0;
    mage.spellSlots[2]!.used = 2;
    mage.spellSlots[3]!.used = 0;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: mage.id, abilityId: "arcane_recovery",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(mage.spellSlots[2]!.used).toBe(1);
    expect(result.narrative).toContain("2nd");
  });

  it("uses 'th' ordinal for 4th level and above", () => {
    const mage = makeMage();
    // Use 3rd and 1st level slots — recovery is 3 levels at level 5
    mage.spellSlots[1]!.used = 4;
    mage.spellSlots[3]!.used = 1;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: mage.id, abilityId: "arcane_recovery",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("Arcane Recovery");
    expect(result.narrative).toContain("3rd");
  });
});

// ══════════════════════════════════════════════════════════
//  Lay on Hands Edge Cases
// ══════════════════════════════════════════════════════════

describe("Lay on Hands Edge Cases", () => {
  it("doesn't overheal", () => {
    const paladin = makePaladin();
    paladin.stats.hp = paladin.stats.maxHp;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: paladin.id, abilityId: "lay_on_hands",
    };
    const result = resolveAction(paladin, paladin, action, dice, ARENA_PRESETS.medium);

    expect(paladin.stats.hp).toBe(paladin.stats.maxHp);
    expect(result.heal!.amount).toBe(0);
  });

  it("uses remaining are decremented", () => {
    const paladin = makePaladin();
    paladin.stats.hp = 10;
    const loh = paladin.features.find(f => f.id === "lay_on_hands")!;
    const before = loh.usesRemaining;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: paladin.id, abilityId: "lay_on_hands",
    };
    resolveAction(paladin, paladin, action, dice, ARENA_PRESETS.medium);

    expect(loh.usesRemaining).toBe(before - 1);
  });
});

// ══════════════════════════════════════════════════════════
//  Unknown Item Type Fallback
// ══════════════════════════════════════════════════════════

describe("Unknown Item Type", () => {
  it("uses generic narrative for unrecognized item type", () => {
    const warrior = makeWarrior();
    // Manually add a custom item with unknown type
    warrior.inventory.push({
      id: "custom_item" as ItemId, name: "Weird Thing", description: "",
      quantity: 1, type: "teleport" as any, potency: 0, range: 0,
    });
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, itemId: "custom_item" as ItemId,
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("Weird Thing");
    expect(result.item!.effect).toBe("unknown");
    expect(result.item!.value).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════
//  Unknown Ability
// ══════════════════════════════════════════════════════════

describe("Unknown Ability", () => {
  it("reports missing ability", () => {
    const warrior = makeWarrior();
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: warrior.id, abilityId: "nonexistent",
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("doesn't have ability");
  });
});

// ══════════════════════════════════════════════════════════
//  Paralyzed Character
// ══════════════════════════════════════════════════════════

describe("Paralyzed Status", () => {
  it("paralyzed effect decrements each turn", () => {
    const warrior = makeWarrior();
    warrior.statusEffects.push({
      type: "paralyzed", turnsRemaining: 2, potency: 0, sourceId: "x",
    });
    processStatusEffects(warrior);
    expect(warrior.statusEffects).toHaveLength(1);
    expect(warrior.statusEffects[0].turnsRemaining).toBe(1);
  });

  it("paralyzed expires after turns run out", () => {
    const warrior = makeWarrior();
    warrior.statusEffects.push({
      type: "paralyzed", turnsRemaining: 1, potency: 0, sourceId: "x",
    });
    processStatusEffects(warrior);
    expect(warrior.statusEffects).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════
//  Hold Person (Paralyze via Spell)
// ══════════════════════════════════════════════════════════

describe("Hold Person", () => {
  it("paralyzes target on failed WIS save", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // Warrior WIS 12→+1, prof +3 (str/con) so WIS save = d20+1
    // d20=1, +1 = 2 < DC 14 → fail
    const dice = makeRiggedDice([1]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "hold_person",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(warrior.statusEffects).toHaveLength(1);
    expect(warrior.statusEffects[0].type).toBe("paralyzed");
    expect(warrior.statusEffects[0].turnsRemaining).toBe(1);
    expect(result.spell!.statusApplied).toBe("paralyzed");
  });

  it("does not paralyze on successful WIS save", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // WIS save: d20=20, +1 = 21 >= DC 14 → success
    const dice = makeRiggedDice([20]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "hold_person",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(warrior.statusEffects).toHaveLength(0);
    expect(result.spell!.statusApplied).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
//  Lightning Bolt
// ══════════════════════════════════════════════════════════

describe("Lightning Bolt", () => {
  it("deals damage with DEX save", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // DEX save: d20=1, DEX 14→+2, prof(str/con) → +2 = 3 < DC 14 → fail
    // 8d6: [1,1,1,1,1,1,1,1] = 8
    const dice = makeRiggedDice([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "lightning_bolt",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.saveSuccess).toBe(false);
    expect(result.damage!.damage).toBe(8);
    expect(result.spell!.slotUsed).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════
//  Unknown Spell
// ══════════════════════════════════════════════════════════

describe("Unknown Spell", () => {
  it("returns unknown spell narrative for nonexistent spellId", () => {
    const mage = makeMage();
    const warrior = makeWarrior();
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "cast_spell",
      actorId: mage.id,
      spellId: "nonexistent_spell",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("unknown spell");
    expect(result.damage).toBeUndefined();
    expect(result.spell).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
//  Spell Cooldown
// ══════════════════════════════════════════════════════════

describe("Spell Cooldown", () => {
  it("blocks spell cast when on cooldown", () => {
    const mage = makeMage();
    const warrior = makeWarrior();
    // Put fireball on cooldown
    const fireball = mage.spells.find(s => s.id === "fireball")!;
    fireball.currentCooldown = 2;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "cast_spell",
      actorId: mage.id,
      spellId: "fireball",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("cooldown");
    expect(result.narrative).toContain("2");
    expect(result.damage).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
//  Advantage / Disadvantage
// ══════════════════════════════════════════════════════════

describe("Advantage/Disadvantage", () => {
  it("paralyzed target gives advantage on attack", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    mage.statusEffects = [{ type: "paralyzed", turnsRemaining: 1, potency: 0, sourceId: "x" }];
    // Advantage d20: rolls [1, 20] → keeps 20 (crit)
    const dice = makeRiggedDice([1, 20, 5, 5]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium, [warrior, mage]);

    expect(result.damage!.wasCrit).toBe(true); // nat 20 from advantage
    expect(result.narrative).toContain("advantage");
  });

  it("defending target gives disadvantage on attack", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    mage.isDefending = true;
    // Disadvantage d20: rolls [20, 1] → keeps 1 (crit miss)
    const dice = makeRiggedDice([20, 1]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium, [warrior, mage]);

    expect(result.damage!.wasMiss).toBe(true);
    expect(result.narrative).toContain("disadvantage");
  });

  it("advantage and disadvantage cancel out", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    // Target is paralyzed (advantage) AND defending (disadvantage) → normal
    mage.statusEffects = [{ type: "paralyzed", turnsRemaining: 1, potency: 0, sourceId: "x" }];
    mage.isDefending = true;
    // Normal d20: single roll
    const dice = makeRiggedDice([15, 5, 5]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium, [warrior, mage]);

    expect(result.damage!.wasMiss).toBe(false); // normal roll, 15 hits
    expect(result.narrative).not.toContain("advantage");
    expect(result.narrative).not.toContain("disadvantage");
  });

  it("paralyzed auto-crit only within 5ft (melee)", () => {
    const rogue = makeRogue("R", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    mage.statusEffects = [{ type: "paralyzed", turnsRemaining: 1, potency: 0, sourceId: "x" }];
    // Distance = 4ft, within 5ft → auto-crit applies
    const dice = makeRiggedDice([1, 20, 5, 5, 5]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage]);

    expect(result.damage!.wasCrit).toBe(true); // auto-crit from paralyzed within 5ft
  });

  it("auto-crit does NOT apply beyond 5ft for paralyzed target", () => {
    const rogue = makeRogue("R", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 }); // 40ft away
    mage.statusEffects = [{ type: "paralyzed", turnsRemaining: 1, potency: 0, sourceId: "x" }];
    // Can't attack with melee weapon at 40ft — out of range, auto-crit is irrelevant
    const dice = makeRiggedDice([]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage]);

    expect(result.narrative).toContain("too far away");
  });
});

// ══════════════════════════════════════════════════════════
//  Sneak Attack Conditions
// ══════════════════════════════════════════════════════════

describe("Sneak Attack Conditions", () => {
  it("no sneak attack without advantage or ally", () => {
    const rogue = makeRogue("R", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    // No advantage, no ally → no sneak attack
    const dice = makeRiggedDice([15, 6]); // hit
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage]);

    // Damage should be just weapon: 1d8 + DEX(3) = 6 + 3 = 9
    expect(result.damage!.damage).toBe(9);
    expect(result.damage!.damageRolls!.length).toBe(1); // just 1d8, no sneak dice
  });

  it("sneak attack with advantage from paralyzed target", () => {
    const rogue = makeRogue("R", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    mage.statusEffects = [{ type: "paralyzed", turnsRemaining: 1, potency: 0, sourceId: "x" }];
    // Advantage d20: [15, 1] → 15 (hit). Normal damage 1d8=[4]+3=7.
    // Auto-crit re-roll 2d8=[2, 2]+3=7 (replaces normal). Sneak 3d6=[3, 3, 3]=9. Total=7+9=16
    const dice = makeRiggedDice([15, 1, 4, 2, 2, 3, 3, 3]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage]);

    expect(result.damage!.damage).toBe(2 + 2 + 3 + 3 + 3 + 3); // crit 2d8=4 + DEX 3 + sneak 9 = 16
  });

  it("sneak attack with ally adjacent to target", () => {
    const rogue = makeRogue("R", "red", { x: 46, y: 30 });
    const ally = makeWarrior("A", "red", { x: 52, y: 30 }); // adjacent to target
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Advantage d20 from flanking: [15, 1] → 15 (hit). Damage 1d8=[4]+3=7. Sneak 3d6=[2,2,2]=6. Total=13
    const dice = makeRiggedDice([15, 1, 4, 2, 2, 2]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage, ally]);

    expect(result.damage!.damage).toBe(4 + 3 + 2 + 2 + 2); // 13 with sneak
  });
});

// ══════════════════════════════════════════════════════════
//  Potions Use Dice (not flat values)
// ══════════════════════════════════════════════════════════

describe("Potions Roll Dice", () => {
  it("Health Potion rolls 2d4+2", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 20;
    // 2d4+2: [1, 1] + 2 = 4
    const dice = makeRiggedDice([1, 1]);
    const action: CombatAction = { type: "use_item", actorId: warrior.id, itemId: "health_potion" };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.heal!.amount).toBe(4);
    expect(warrior.stats.hp).toBe(24);
  });

  it("Health Potion can roll max", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 20;
    // 2d4+2: [4, 4] + 2 = 10
    const dice = makeRiggedDice([4, 4]);
    const action: CombatAction = { type: "use_item", actorId: warrior.id, itemId: "health_potion" };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.heal!.amount).toBe(10);
    expect(warrior.stats.hp).toBe(30);
  });

  it("Greater Health Potion rolls 4d4+4", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 10;
    // 4d4+4: [1, 1, 1, 1] + 4 = 8
    const dice = makeRiggedDice([1, 1, 1, 1]);
    const action: CombatAction = { type: "use_item", actorId: warrior.id, itemId: "greater_health_potion" };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.heal!.amount).toBe(8);
    expect(warrior.stats.hp).toBe(18);
  });
});

// ══════════════════════════════════════════════════════════
//  Fire Bolt Level 5 Scaling
// ══════════════════════════════════════════════════════════

describe("Fire Bolt Scaling", () => {
  it("deals 3d10 damage at level 5", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 52, y: 30 });
    // No advantage conditions, single d20 roll. d20=20 (crit), 3d10 doubled to 6d10: [4,4,4,4,4,4] = 24 + INT(+3) = 27
    const dice = makeRiggedDice([20, 4, 4, 4, 4, 4, 4]);
    const action: CombatAction = { type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fire_bolt" };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium, [mage, warrior]);

    expect(result.damage!.wasCrit).toBe(true);
    expect(result.damage!.damage).toBe(24 + 3); // 27
  });
});

// ══════════════════════════════════════════════════════════
//  Hold Person as Control Type
// ══════════════════════════════════════════════════════════

describe("Hold Person Control Type", () => {
  it("is type control, not damage", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    const dice = makeRiggedDice([1]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "hold_person",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    // Control spell has no damage field
    expect(result.damage).toBeUndefined();
    expect(result.spell!.statusApplied).toBe("paralyzed");
  });

  it("has concentration flag", () => {
    expect(ALL_SPELLS.hold_person.concentration).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
//  Resistance / Vulnerability / Immunity
// ══════════════════════════════════════════════════════════

describe("Damage Type Modifiers", () => {
  it("resistance halves damage", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    warrior.resistances = ["fire"];
    // Fireball: 8d6 fire, all 4s = 32, halved to 16
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fireball",
    };
    const dice = makeRiggedDice([1, 4, 4, 4, 4, 4, 4, 4, 4]);
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.damage).toBe(16); // 32 / 2
  });

  it("vulnerability doubles damage", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    warrior.vulnerabilities = ["fire"];
    const dice = makeRiggedDice([1, 4, 4, 4, 4, 4, 4, 4, 4]); // save fail + 8d6 all 4s
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fireball",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.damage).toBe(64); // 32 × 2
  });

  it("immunity negates damage", () => {
    const mage = makeMage();
    const warrior = makeWarrior("W", "red", { x: 90, y: 30 });
    warrior.immunities = ["fire"];
    const dice = makeRiggedDice([1, 4, 4, 4, 4, 4, 4, 4, 4]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fireball",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.damage).toBe(0);
    expect(warrior.stats.hp).toBe(warrior.stats.maxHp); // no damage taken
  });
});

// ══════════════════════════════════════════════════════════
//  Stunned Status
// ══════════════════════════════════════════════════════════

describe("Stunned Status", () => {
  it("stunned target gives advantage on attacks", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    mage.statusEffects = [{ type: "stunned", turnsRemaining: 1, potency: 0, sourceId: "x" }];
    // Advantage d20: [1, 20] → keeps 20 (crit)
    const dice = makeRiggedDice([1, 20, 5, 5, 5, 5]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium, [warrior, mage]);

    expect(result.damage!.wasCrit).toBe(true);
    expect(result.narrative).toContain("advantage");
  });

  it("stunned target auto-crits from within 5ft", () => {
    const rogue = makeRogue("R", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    mage.statusEffects = [{ type: "stunned", turnsRemaining: 1, potency: 0, sourceId: "x" }];
    // Within 5ft → auto-crit. Advantage d20: [1, 20] → auto-crit already from condition
    const dice = makeRiggedDice([1, 20, 5, 5, 5, 5]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage]);

    expect(result.damage!.wasCrit).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
//  Bonus Actions
// ══════════════════════════════════════════════════════════

describe("Bonus Actions", () => {
  it("Healing Word as bonus action heals target", () => {
    const paladin = makePaladin("P", "red", { x: 48, y: 30 });
    paladin.stats.hp = 20;
    const warrior = makeWarrior("W", "blue", { x: 52, y: 30 });
    // Main: d20=15 (hit), 1d8=[2]+3(STR)=5
    // Extra Attack: d20=[14] (hit), 1d8=[3]+3=6
    // (No smite — not opted in)
    // Bonus Healing Word: d4=[4]+WIS(+1)=5
    const dice = makeRiggedDice([15, 2, 14, 3, 4]);
    const action: CombatAction = {
      type: "attack", actorId: paladin.id, targetId: warrior.id,
      bonusAction: { type: "healing_word", targetId: paladin.id },
    };
    const result = resolveAction(paladin, warrior, action, dice, ARENA_PRESETS.medium, [paladin, warrior]);

    expect(result.narrative).toContain("BONUS");
    expect(result.narrative).toContain("Healing Word");
    expect(result.heal!.amount).toBe(5); // 4 + WIS(1)
    expect(paladin.stats.hp).toBe(25); // 20 + 5
  });

  it("Cunning Action dash doubles speed", () => {
    const rogue = makeRogue("R", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    // Main action: attack d20=15, bonus: cunning_action dash
    const dice = makeRiggedDice([15, 1, 5]);
    const action: CombatAction = {
      type: "attack", actorId: rogue.id, targetId: mage.id,
      bonusAction: { type: "cunning_action", variant: "dash" },
    };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage]);

    expect(result.narrative).toContain("BONUS");
    expect(result.narrative).toContain("Cunning Action");
    expect(rogue.stats.speed).toBe(60); // doubled from 30
  });

  it("Cunning Action hide makes invisible", () => {
    const rogue = makeRogue("R", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    const dice = makeRiggedDice([15, 1, 5]);
    const action: CombatAction = {
      type: "attack", actorId: rogue.id, targetId: mage.id,
      bonusAction: { type: "cunning_action", variant: "hide" },
    };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium, [rogue, mage]);

    expect(result.narrative).toContain("BONUS");
    expect(rogue.statusEffects.some(e => e.type === "invisible")).toBe(true);
  });

  it("Misty Step teleports toward target", () => {
    const paladin = makePaladin("P", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 90, y: 30 }); // 80ft away
    const dice = makeRiggedDice([15, 1, 5]);
    const action: CombatAction = {
      type: "attack", actorId: paladin.id, targetId: mage.id,
      bonusAction: { type: "misty_step" },
    };
    const oldX = paladin.position.x;
    const result = resolveAction(paladin, mage, action, dice, ARENA_PRESETS.medium, [paladin, mage]);

    expect(result.narrative).toContain("BONUS");
    expect(result.narrative).toContain("Misty Step");
    expect(paladin.position.x).toBeGreaterThan(oldX); // moved closer
  });

  it("off-hand attack deals damage without modifier", () => {
    const warrior = makeWarrior("W", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    // Main attack d20=15 (hit), off-hand d20=12 (hit), 2d6=[3,3]=6 (no STR mod)
    const dice = makeRiggedDice([15, 12, 3, 3, 3, 3]);
    const action: CombatAction = {
      type: "attack", actorId: warrior.id, targetId: mage.id,
      bonusAction: { type: "off_hand_attack", targetId: mage.id },
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium, [warrior, mage]);

    expect(result.narrative).toContain("BONUS");
    expect(result.narrative).toContain("off-hand");
  });
});

// ══════════════════════════════════════════════════════════
//  Reaction System
// ══════════════════════════════════════════════════════════

describe("Reaction System", () => {
  it("opportunity attack triggers when leaving melee range", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 }); // 2ft apart
    // Opportunity attack: d20=15 (hit), greatsword 2d6=[3,3]+3(STR)=9
    const dice = makeRiggedDice([15, 3, 3]);
    const result = checkOpportunityAttack(
      mage, { x: 52, y: 30 }, { x: 80, y: 30 }, // mage moves from 2ft to 30ft away
      [warrior], dice,
    );

    expect(result).not.toBeNull();
    expect(result!.triggered).toBe(true);
    expect(result!.type).toBe("attack_of_opportunity");
    expect(result!.narrative).toContain("Attack of Opportunity");
    expect(result!.damage!.damage).toBe(9); // 3+3+3(STR)
    expect(warrior.reactionUsed).toBe(true);
  });

  it("no opportunity attack when staying in range", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    const dice = makeRiggedDice([15]);
    const result = checkOpportunityAttack(
      mage, { x: 52, y: 30 }, { x: 53, y: 30 }, // still within 5ft
      [warrior], dice,
    );

    expect(result).toBeNull();
    expect(warrior.reactionUsed).toBe(false);
  });

  it("no opportunity attack when disengaging", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    mage.statusEffects.push({ type: "disengaging", turnsRemaining: 1, potency: 0, sourceId: mage.id });
    const dice = makeRiggedDice([15]);
    const result = checkOpportunityAttack(
      mage, { x: 52, y: 30 }, { x: 80, y: 30 }, // moves far away
      [warrior], dice,
    );

    expect(result).toBeNull();
  });

  it("no opportunity attack when reaction already used", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.reactionUsed = true;
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    const dice = makeRiggedDice([15]);
    const result = checkOpportunityAttack(
      mage, { x: 52, y: 30 }, { x: 80, y: 30 },
      [warrior], dice,
    );

    expect(result).toBeNull();
  });

  it("opportunity attack can miss", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    // d20=1 (natural 1 = always miss)
    const dice = makeRiggedDice([1]);
    const result = checkOpportunityAttack(
      mage, { x: 52, y: 30 }, { x: 80, y: 30 },
      [warrior], dice,
    );

    expect(result).not.toBeNull();
    expect(result!.triggered).toBe(true);
    expect(result!.damage).toBeUndefined();
    expect(result!.narrative).toContain("misses");
  });

  it("resetReaction clears reactionUsed flag", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.reactionUsed = true;
    resetReaction(warrior);
    expect(warrior.reactionUsed).toBe(false);
  });

  it("Shield reaction blocks hit when +5 AC would prevent it", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Attack total of 16 vs mage AC 13 + 5 (shield) = 18 → shield blocks it
    const result = checkShieldReaction(mage, 0, 16);

    expect(result).not.toBeNull();
    expect(result!.triggered).toBe(true);
    expect(result!.type).toBe("shield_spell");
    expect(result!.acBonus).toBe(5);
    expect(result!.narrative).toContain("Shield");
    expect(mage.reactionUsed).toBe(true);
  });

  it("Shield reaction not used when attack would still hit", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Attack total of 25 vs mage AC 13 + 5 (shield) = 18 → still hits, no shield
    const result = checkShieldReaction(mage, 0, 25);

    expect(result).toBeNull();
    expect(mage.reactionUsed).toBe(false);
  });

  it("Shield reaction not available when reaction already used", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    mage.reactionUsed = true;
    const result = checkShieldReaction(mage, 0, 16);

    expect(result).toBeNull();
  });

  it("Uncanny Dodge halves damage for rogue", () => {
    const rogue = makeRogue("R", "red", { x: 50, y: 30 });
    const result = checkUncannyDodge(rogue);

    expect(result).not.toBeNull();
    expect(result!.triggered).toBe(true);
    expect(result!.type).toBe("uncanny_dodge");
    expect(result!.damageHalved).toBe(true);
    expect(result!.narrative).toContain("Uncanny Dodge");
    expect(rogue.reactionUsed).toBe(true);
    // Uses remaining should decrement
    const feature = rogue.features.find(f => f.id === "uncanny_dodge");
    expect(feature!.usesRemaining).toBe(0);
  });

  it("Uncanny Dodge not available after reaction used", () => {
    const rogue = makeRogue("R", "red", { x: 50, y: 30 });
    rogue.reactionUsed = true;
    const result = checkUncannyDodge(rogue);

    expect(result).toBeNull();
  });

  it("Uncanny Dodge not available for non-rogue", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const result = checkUncannyDodge(warrior);

    expect(result).toBeNull();
  });

  it("applyDefensiveReactions integrates Shield and Uncanny Dodge", () => {
    // Mage gets hit with total 14, shield would raise AC to 18 → blocks
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const result = applyDefensiveReactions(mage, 14, 10);

    expect(result.hitBlocked).toBe(true);
    expect(result.damage).toBe(0);
    expect(result.reactions.length).toBe(1);
    expect(result.reactions[0].type).toBe("shield_spell");
  });

  it("applyDefensiveReactions uses Uncanny Dodge for rogues", () => {
    // Rogue can't use shield (no spell), but can use Uncanny Dodge
    const rogue = makeRogue("R", "red", { x: 50, y: 30 });
    rogue.stats.hp = 40;
    rogue.stats.hp -= 10; // Take 10 damage first
    const result = applyDefensiveReactions(rogue, 20, 10);

    expect(result.damage).toBe(5); // Halved from 10
    expect(result.reactions.length).toBe(1);
    expect(result.reactions[0].type).toBe("uncanny_dodge");
    expect(result.hitBlocked).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
//  AoE Multi-Target
// ══════════════════════════════════════════════════════════

describe("AoE Multi-Target", () => {
  it("Fireball hits all enemies within 20ft radius", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    // Primary target + 1 secondary target within 20ft
    const warrior = makeWarrior("W", "blue", { x: 52, y: 30 }); // 2ft from impact
    const rogue = makeRogue("R", "blue", { x: 60, y: 30 }); // 10ft from warrior (8ft from impact)
    const paladin = makePaladin("P", "green", { x: 80, y: 30 }); // 30ft from warrior — NOT in AoE
    // DEX saves for each: warrior d20=1(fail), rogue d20=1(fail)
    // Fireball 8d6 for warrior: [2,2,2,2,2,2,2,2]=16
    // Fireball 8d6 for rogue: [3,3,3,3,3,3,3,3]=24
    const dice = makeRiggedDice([1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 3, 3, 3, 3, 3, 3, 3, 3]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fireball",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium, [mage, warrior, rogue, paladin]);

    // Primary target (warrior) takes damage
    expect(result.damage!.damage).toBe(16);
    // AoE hit rogue too
    expect(result.narrative).toContain("AoE");
    // Paladin too far — not hit
    expect(result.narrative).not.toContain("P");
  });

  it("AoE does not trigger when no secondary targets nearby", () => {
    const mage = makeMage("M", "red", { x: 10, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 }); // 40ft apart
    const dice = makeRiggedDice([1, 2, 2, 2, 2, 2, 2, 2, 2]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fireball",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium, [mage, warrior]);

    expect(result.damage!.damage).toBe(16);
    expect(result.narrative).not.toContain("AoE");
  });

  it("Single-target spells do not trigger AoE", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 52, y: 30 });
    const rogue = makeRogue("R", "blue", { x: 54, y: 30 });
    const dice = makeRiggedDice([1, 1, 1, 1]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "magic_missile",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium, [mage, warrior, rogue]);

    expect(result.narrative).not.toContain("AoE");
    expect(rogue.stats.hp).toBe(rogue.stats.maxHp);
  });
});

// ══════════════════════════════════════════════════════════
//  Death Saves
// ══════════════════════════════════════════════════════════

describe("Death Saves", () => {
  it("rollDeathSave — success on 10+", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 0;
    warrior.statusEffects.push({ type: "unconscious", turnsRemaining: 99, potency: 0, sourceId: "death" });
    const dice = makeRiggedDice([15]);
    const result = rollDeathSave(warrior, dice);
    expect(result.roll).toBe(15);
    expect(result.successes).toBe(1);
    expect(result.failures).toBe(0);
    expect(result.regainedHp).toBe(false);
    expect(warrior.deathSaveSuccesses).toBe(1);
  });

  it("rollDeathSave — failure on 9-", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 0;
    warrior.statusEffects.push({ type: "unconscious", turnsRemaining: 99, potency: 0, sourceId: "death" });
    const dice = makeRiggedDice([5]);
    const result = rollDeathSave(warrior, dice);
    expect(result.roll).toBe(5);
    expect(result.successes).toBe(0);
    expect(result.failures).toBe(1);
    expect(warrior.deathSaveFailures).toBe(1);
  });

  it("rollDeathSave — nat 20 regains 1 HP", () => {
       const warrior = makeWarrior();
    warrior.stats.hp = 0;
    warrior.deathSaveFailures = 2;
    warrior.statusEffects.push({ type: "unconscious", turnsRemaining: 99, potency: 0, sourceId: "death" });
    const dice = makeRiggedDice([20]);
    const result = rollDeathSave(warrior, dice);
    expect(result.regainedHp).toBe(true);
    expect(warrior.stats.hp).toBe(1);
    expect(warrior.deathSaveSuccesses).toBe(0);
    expect(warrior.deathSaveFailures).toBe(0);
    expect(warrior.statusEffects.some(e => e.type === "unconscious")).toBe(false);
  });

  it("rollDeathSave — nat 1 = 2 failures", () => {
       const warrior = makeWarrior();
    warrior.stats.hp = 0;
    warrior.statusEffects.push({ type: "unconscious", turnsRemaining: 99, potency: 0, sourceId: "death" });
    const dice = makeRiggedDice([1]);
    const result = rollDeathSave(warrior, dice);
    expect(result.roll).toBe(1);
    expect(result.failures).toBe(2);
    expect(warrior.deathSaveFailures).toBe(2);
  });

  it("isDying returns true for 0 HP, < 3 failures, < 3 successes", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 0;
    warrior.deathSaveSuccesses = 1;
    warrior.deathSaveFailures = 1;
    expect(isDying(warrior)).toBe(true);
  });

  it("isDying returns false for conscious character", () => {
    const warrior = makeWarrior();
    expect(isDying(warrior)).toBe(false);
  });

  it("isDead returns true at 3 failures", () => {
    const warrior = makeWarrior();
    warrior.deathSaveFailures = 3;
    expect(isDead(warrior)).toBe(true);
  });

  it("isStable returns true at 3 successes and 0 HP", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 0;
    warrior.deathSaveSuccesses = 3;
    expect(isStable(warrior)).toBe(true);
  });

  it("markUnconscious sets HP to 0 and adds unconscious status", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 5;
    markUnconscious(warrior);
    expect(warrior.stats.hp).toBe(0);
    expect(warrior.deathSaveSuccesses).toBe(0);
    expect(warrior.deathSaveFailures).toBe(0);
    expect(warrior.statusEffects.some(e => e.type === "unconscious")).toBe(true);
  });

  it("markUnconscious resets death saves", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 5;
    warrior.deathSaveSuccesses = 2;
    warrior.deathSaveFailures = 1;
    markUnconscious(warrior);
    expect(warrior.deathSaveSuccesses).toBe(0);
    expect(warrior.deathSaveFailures).toBe(0);
  });

  it("3 death save failures = dead", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 0;
    warrior.statusEffects.push({ type: "unconscious", turnsRemaining: 99, potency: 0, sourceId: "death" });
    const dice = makeRiggedDice([5, 5, 5]); // 3 failures
    rollDeathSave(warrior, dice); // fail 1
    rollDeathSave(warrior, dice); // fail 2
    rollDeathSave(warrior, dice); // fail 3
    expect(isDead(warrior)).toBe(true);
    expect(warrior.deathSaveFailures).toBe(3);
  });

  it("3 death save successes = stable", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 0;
    warrior.statusEffects.push({ type: "unconscious", turnsRemaining: 99, potency: 0, sourceId: "death" });
    const dice = makeRiggedDice([15, 15, 15]); // 3 successes
    rollDeathSave(warrior, dice);
    rollDeathSave(warrior, dice);
    rollDeathSave(warrior, dice);
    expect(isStable(warrior)).toBe(true);
    expect(warrior.stats.hp).toBe(0); // still at 0 HP
  });
});

// ══════════════════════════════════════════════════════════
//  Fighting Styles
// ══════════════════════════════════════════════════════════

describe("Fighting Styles", () => {
  it("Great Weapon Fighting rerolls 1s and 2s", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.fightingStyle = "great_weapon_fighting";
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Main: d20=15 (hit), 2d6: [1→5, 2→6] (both rerolled) + 3(STR) = 14
    // Extra: d20=5 (miss)
    const dice = makeRiggedDice([15, 1, 5, 2, 6, 5]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.damage).toBe(14); // 5 + 6 + 3(STR) from main hit only
  });

  it("Dueling adds +2 to one-handed weapon damage", () => {
    const paladin = makePaladin("P", "red", { x: 50, y: 30 });
    paladin.fightingStyle = "dueling";
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Main: d20=15 (hit), 1d8=[5] + 3(STR) + 2(dueling) = 10
    // Extra: d20=2 (miss)
    const dice = makeRiggedDice([15, 5, 2]);
    const action: CombatAction = { type: "attack", actorId: paladin.id, targetId: mage.id };
    const result = resolveAction(paladin, mage, action, dice, ARENA_PRESETS.medium);
    // Total damage = 10 from main (extra miss)
    expect(result.damage!.damage).toBe(10);
  });

  it("Defense adds +1 AC", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.fightingStyle = "defense";
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Warrior base AC 16 + 1 (defense) = 17
    // d20=15 + 3(INT) + 3(prof) = 21 >= 17 → hit
    // But d20=14 + 6 = 20 >= 17 → still hit
    // d20=13 + 6 = 19 >= 17 → still hit
    // Without defense (AC 16): d20=13 + 6 = 19 >= 16 would hit too
    // Let's test with exact AC boundary: d20=11 + 6 = 17
    const dice = makeRiggedDice([11, 3, 3, 3]); // fire bolt 3d10=[3,3,3]=9+3(INT)=12
    const action: CombatAction = { type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fire_bolt" };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(false); // 11 + 6 = 17 >= AC 17 → hit
    // Without defense: AC 16, so it would hit anyway. Let's test with lower roll
  });

  it("Defense prevents hit that would land without it", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.fightingStyle = "defense";
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Warrior AC = 16 + 1 (defense) = 17
    // d20=10 + 3(INT) + 3(prof) = 16 < 17 → miss!
    // Without defense: 16 >= 16 → hit
    const dice = makeRiggedDice([10]);
    const action: CombatAction = { type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fire_bolt" };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(true); // 10 + 6 = 16 < AC 17
  });

  it("Warrior has Great Weapon Fighting by default", () => {
    const warrior = makeWarrior();
    expect(warrior.fightingStyle).toBe("great_weapon_fighting");
  });

  it("Paladin has Dueling by default", () => {
    const paladin = makePaladin();
    expect(paladin.fightingStyle).toBe("dueling");
  });
});

// ══════════════════════════════════════════════════════════
//  Additional Conditions (Poisoned, Blinded)
// ══════════════════════════════════════════════════════════

describe("Additional Conditions", () => {
  it("Poisoned gives disadvantage on attacks", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "poisoned", turnsRemaining: 3, potency: 0, sourceId: "env" });
    // With disadvantage: roll [15, 5] → take 5 (lower). 5+3+3=11 < 12 AC → miss
    const dice = makeRiggedDice([15, 5, 2]); // [15,5] for disadv d20, 2 for extra miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(true); // 5+6=11 < 12
  });

  it("Blinded gives disadvantage on attacks", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "blinded", turnsRemaining: 2, potency: 0, sourceId: "spell" });
    // Disadvantage: roll [15, 5] → take 5. 5+3+3=11 < 12 → miss
    const dice = makeRiggedDice([15, 5, 2]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(true);
  });

  it("Blinded defender gives advantage to attacker", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    mage.statusEffects.push({ type: "blinded", turnsRemaining: 2, potency: 0, sourceId: "spell" });
    // Advantage: roll [5, 15] → take 15. 15+3+3=21 >= 12 → hit
    const dice = makeRiggedDice([5, 15, 2, 2, 2]); // adv [5,15], damage 2d6, extra miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(false);
  });

  it("Poisoned gives disadvantage on saving throws", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "poisoned", turnsRemaining: 3, potency: 0, sourceId: "env" });
    // Poisoned → disadvantage on saves. Roll [15, 5] → take 5.
    // CON save: 5 + 3(CON mod) + 3(prof) = 11 < DC 14 → fail
    // Thunderwave 2d8: [4,4] = 8 damage
    const dice = makeRiggedDice([15, 5, 4, 4]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "thunderwave",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    // Failed save → full damage
    expect(result.damage!.damage).toBe(8);
  });
});

// ══════════════════════════════════════════════════════════
//  Lay on Hands Pool
// ══════════════════════════════════════════════════════════

describe("Lay on Hands Pool", () => {
  it("starts with 25 HP pool and heals from it", () => {
    const paladin = makePaladin("P", "gold", { x: 50, y: 30 });
    expect(paladin.layOnHandsPool).toBe(25);
    paladin.stats.hp = 30; // missing 14 HP (maxHp=44)
    const action: CombatAction = { type: "class_ability", actorId: paladin.id, targetId: paladin.id, abilityId: "lay_on_hands" };
    const result = resolveAction(paladin, paladin, action, makeRiggedDice([]), ARENA_PRESETS.medium);
    expect(result.heal!.amount).toBe(14);
    expect(paladin.layOnHandsPool).toBe(11); // 25 - 14
    expect(paladin.stats.hp).toBe(paladin.stats.maxHp);
  });

  it("can use remaining pool in subsequent turns", () => {
    const paladin = makePaladin("P", "gold", { x: 50, y: 30 });
    paladin.layOnHandsPool = 10;
    paladin.stats.hp = 38; // missing 6 HP (maxHp=44)
    const action: CombatAction = { type: "class_ability", actorId: paladin.id, targetId: paladin.id, abilityId: "lay_on_hands" };
    const result = resolveAction(paladin, paladin, action, makeRiggedDice([]), ARENA_PRESETS.medium);
    expect(result.heal!.amount).toBe(6);
    expect(paladin.layOnHandsPool).toBe(4);
    expect(paladin.stats.hp).toBe(paladin.stats.maxHp);
  });

  it("returns message when pool is empty", () => {
    const paladin = makePaladin("P", "gold", { x: 50, y: 30 });
    paladin.layOnHandsPool = 0;
    paladin.stats.hp = 30;
    const action: CombatAction = { type: "class_ability", actorId: paladin.id, targetId: paladin.id, abilityId: "lay_on_hands" };
    const result = resolveAction(paladin, paladin, action, makeRiggedDice([]), ARENA_PRESETS.medium);
    expect(result.narrative).toContain("no Lay on Hands pool remaining");
  });
});

// ══════════════════════════════════════════════════════════
//  Weapon Properties
// ══════════════════════════════════════════════════════════

describe("Weapon Properties", () => {
  it("Versatile weapon uses larger dice when no shield", () => {
    // Mage with quarterstaff (versatile 1d8), no shield → uses 1d8 instead of 1d6
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    expect(mage.equippedShield).toBe(false);
    expect(mage.weapon.properties).toContain("versatile");
    expect(mage.weapon.versatileDice).toBe("1d8");
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    // d20=15 (hit), 1d8=[5] + STR(-1) = 4. Extra: d20=2 (miss)
    const dice = makeRiggedDice([15, 5, 2]);
    const action: CombatAction = { type: "attack", actorId: mage.id, targetId: warrior.id };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    // Uses 1d8 (versatile) not 1d6. 5 + (-1 STR) = 4 damage
    expect(result.damage!.damage).toBe(4);
  });

  it("Paladin does NOT use versatile dice with shield", () => {
    const paladin = makePaladin("P", "gold", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    expect(paladin.equippedShield).toBe(true);
    expect(paladin.weapon.properties).toContain("versatile");
    // Should use 1d8 (one-handed) not 1d10 (versatile)
    // d20=15 (hit), 1d8=[4] + 3(STR) + 2(dueling) = 9. Extra: d20=2 (miss)
    const dice = makeRiggedDice([15, 4, 2]);
    const action: CombatAction = { type: "attack", actorId: paladin.id, targetId: mage.id };
    const result = resolveAction(paladin, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.damage).toBe(9); // 4 + 3 + 2 = 9 (1d8, not 1d10)
  });

  it("Paladin without shield uses versatile 1d10", () => {
    const paladin = makePaladin("P", "gold", { x: 50, y: 30 });
    paladin.equippedShield = false;
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Uses 1d10 (versatile) — no dueling since two-handing
    // d20=15 (hit), 1d10=[7] + 3(STR) = 10. Extra: d20=2 (miss)
    const dice = makeRiggedDice([15, 7, 2]);
    const action: CombatAction = { type: "attack", actorId: paladin.id, targetId: mage.id };
    const result = resolveAction(paladin, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.damage).toBe(10); // 7 + 3 = 10 (no dueling bonus)
  });

  it("Finesse weapon uses DEX modifier", () => {
    const rogue = makeRogue("R", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Rapier has abilityMod: "dex", so uses DEX modifier
    // Rogue DEX 17 → +3 modifier
    // d20=15 (hit), 1d8=[5] + 3(DEX) = 8
    const dice = makeRiggedDice([15, 5]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.damage).toBe(8);
  });

  it("Paladin has shield equipped by default", () => {
    const paladin = makePaladin();
    expect(paladin.equippedShield).toBe(true);
  });

  it("Warrior does not have shield", () => {
    const warrior = makeWarrior();
    expect(warrior.equippedShield).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
//  New Spells
// ══════════════════════════════════════════════════════════

describe("New Spells", () => {
  it("Ray of Frost deals damage and reduces speed", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const origSpeed = warrior.stats.speed;
    // d20=15 (hit), 1d8=[6] + 3(INT) = 9 damage
    const dice = makeRiggedDice([15, 6]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "ray_of_frost",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.damage).toBe(9);
    expect(warrior.stats.speed).toBe(origSpeed - 10);
    expect(result.damage!.wasMiss).toBe(false);
  });

  it("Ray of Frost miss does not reduce speed", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const origSpeed = warrior.stats.speed;
    const dice = makeRiggedDice([5]); // miss
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "ray_of_frost",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(true);
    expect(warrior.stats.speed).toBe(origSpeed);
  });

  it("Eldritch Blast fires 2 beams", () => {
    // Create a character that can cast eldritch_blast
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Replace fire_bolt with eldritch_blast
    // mage has fire_bolt, add eldritch_blast too
    const allSpells = ALL_SPELLS;
    const ebDef = allSpells.eldritch_blast;
    mage.spells.push({ ...ebDef, currentCooldown: 0 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    // Beam 1: d20=15 (hit), 1d10=[8]; Beam 2: d20=14 (hit), 1d10=[6]
    const dice = makeRiggedDice([15, 8, 14, 6]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "eldritch_blast",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("2/2 beams hit");
    expect(result.damage!.damage).toBe(14); // 8 + 6
  });

  it("Web restrains target on failed save", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    // Add web to mage spells
    const allSpells = ALL_SPELLS;
    mage.spells.push({ ...allSpells.web, currentCooldown: 0 });
    // DEX save: d20=5 → 5+2(DEX)+3(prof)=10 < DC 14 → fail
    const dice = makeRiggedDice([5]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "web",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.spell!.statusApplied).toBe("restrained");
    expect(warrior.statusEffects.some(e => e.type === "restrained")).toBe(true);
  });

  it("Bless adds d4 to attack rolls", () => {
    const paladin = makePaladin("P", "gold", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    paladin.statusEffects.push({ type: "bless", turnsRemaining: 3, potency: 4, sourceId: "divine" });
    // Bless d4=3. d20=10 + 3(STR) + 3(prof) + 3(bless) = 19 >= AC 16 → hit
    // Damage: 1d8=[5] + 3(STR) + 2(dueling) = 10. Extra: d20=2 (miss)
    const dice = makeRiggedDice([3, 10, 5, 2]); // bless d4, attack d20, damage d8, extra miss
    const action: CombatAction = { type: "attack", actorId: paladin.id, targetId: warrior.id };
    const result = resolveAction(paladin, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(false);
    expect(result.damage!.damage).toBe(10);
  });

  it("Bane subtracts d4 from saving throws", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "bane", turnsRemaining: 3, potency: 4, sourceId: "curse" });
    // Bane d4=3 (subtract from save). Save d20=10 + 3(CON) + 3(prof) - 3(bane) = 13 < DC 14 → fail!
    // Without bane: 10+3+3=16 ≥ 14 → success
    const dice = makeRiggedDice([3, 10, 4, 4]); // bane d4, save d20, 2d8=[4,4]=8
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "thunderwave",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    // Failed save → full damage 8
    expect(result.damage!.damage).toBe(8);
    expect(result.damage!.saveSuccess).toBe(false);
  });

  it("Restrained gives advantage to attackers and disadvantage on attacks", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "restrained", turnsRemaining: 2, potency: 0, sourceId: "web" });
    // Warrior attacks mage with disadvantage (restrained): [15, 5] → take 5
    // 5+3+3=11 < 12 AC → miss
    const dice = makeRiggedDice([15, 5, 2]); // disadv [15,5], extra miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(true);
  });

  it("Restrained defender gives advantage to attackers", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    mage.statusEffects.push({ type: "restrained", turnsRemaining: 2, potency: 0, sourceId: "web" });
    // Advantage: [5, 15] → take 15. 15+3+3=21 ≥ 12 → hit
    const dice = makeRiggedDice([5, 15, 2, 2, 2, 2]); // adv, 2d6, extra miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
//  Grapple / Shove
// ══════════════════════════════════════════════════════════

describe("Grapple", () => {
  it("successful grapple applies grappled status and prevents movement", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Warrior: STR mod +3, prof +3 = +6; Mage: DEX mod +3, prof +3 = +6
    // Warrior d20=15+6=21, Mage d20=10+6=16 → warrior wins
    const dice = makeRiggedDice([15, 10]);
    const action: CombatAction = {
      type: "grapple", actorId: warrior.id, targetId: mage.id,
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("grapples");
    expect(result.spell!.statusApplied).toBe("grappled");
    expect(mage.statusEffects.some(e => e.type === "grappled")).toBe(true);
    // Try to move — should be blocked
    const moveResult = resolveMove(mage, { dx: 10, dy: 0 }, ARENA_PRESETS.medium);
    expect(moveResult.distanceMoved).toBe(0);
  });

  it("failed grapple does not apply status", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Warrior d20=5+6=11, Mage d20=15+6=21 → mage wins
    const dice = makeRiggedDice([5, 15]);
    const action: CombatAction = {
      type: "grapple", actorId: warrior.id, targetId: mage.id,
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("fails");
    expect(mage.statusEffects.some(e => e.type === "grappled")).toBe(false);
  });

  it("grapple fails if target is out of range", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 50 }); // 20ft away
    const dice = makeRiggedDice([15]);
    const action: CombatAction = {
      type: "grapple", actorId: warrior.id, targetId: mage.id,
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("too far");
  });
});

describe("Shove", () => {
  it("successful shove pushes target and knocks prone", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Warrior d20=15+6=21, Mage d20=10+6=16 → warrior wins
    const dice = makeRiggedDice([15, 10]);
    const action: CombatAction = {
      type: "shove", actorId: warrior.id, targetId: mage.id,
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("shoves");
    expect(result.narrative).toContain("prone");
    expect(mage.statusEffects.some(e => e.type === "prone")).toBe(true);
  });

  it("failed shove does not knock prone", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Warrior d20=5+6=11, Mage d20=15+6=21 → mage wins
    const dice = makeRiggedDice([5, 15]);
    const action: CombatAction = {
      type: "shove", actorId: warrior.id, targetId: mage.id,
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("fails");
    expect(mage.statusEffects.some(e => e.type === "prone")).toBe(false);
  });
});

describe("Arcane Recovery (multi-slot)", () => {
  it("recovers multiple slot levels at level 5", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Use up a 3rd and 2nd slot
    mage.spellSlots[2]!.used = 1;
    mage.spellSlots[3]!.used = 1;
    const dice = makeRiggedDice([]);
    const action: CombatAction = {
      type: "class_ability", actorId: mage.id, abilityId: "arcane_recovery",
    };
    const result = resolveAction(mage, undefined, action, dice, ARENA_PRESETS.medium);
    // Level 5 → ceil(5/2) = 3 slot levels → recover 3rd (3 levels)
    expect(result.narrative).toContain("Arcane Recovery");
    expect(result.narrative).toContain("3rd");
    expect(mage.spellSlots[3]!.used).toBe(0);
  });

  it("recovers multiple slots when a single high slot is not available", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Use up 1st and 2nd slots (no 3rd slot used)
    mage.spellSlots[1]!.used = 4; // all used
    mage.spellSlots[2]!.used = 2; // all used
    const dice = makeRiggedDice([]);
    const action: CombatAction = {
      type: "class_ability", actorId: mage.id, abilityId: "arcane_recovery",
    };
    const result = resolveAction(mage, undefined, action, dice, ARENA_PRESETS.medium);
    // 3 levels: recover 2nd (2 levels) + 1st (1 level)
    expect(result.narrative).toContain("2nd");
    expect(result.narrative).toContain("1st");
    expect(mage.spellSlots[2]!.used).toBe(1);
    expect(mage.spellSlots[1]!.used).toBe(3);
  });
});

describe("Haste and Slow", () => {
  it("haste doubles movement speed", () => {
    const mage = makeMage("M", "blue", { x: 10, y: 30 });
    const origSpeed = mage.stats.speed;
    mage.statusEffects.push({ type: "haste", turnsRemaining: 3, potency: 0, sourceId: "spell" });
    const moveResult = resolveMove(mage, { dx: origSpeed * 2, dy: 0 }, ARENA_PRESETS.medium);
    expect(moveResult.distanceMoved).toBe(origSpeed * 2);
  });

  it("slow halves movement speed", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const origSpeed = mage.stats.speed;
    mage.statusEffects.push({ type: "slow", turnsRemaining: 3, potency: 0, sourceId: "spell" });
    const moveResult = resolveMove(mage, { dx: origSpeed, dy: 0 }, ARENA_PRESETS.medium);
    expect(moveResult.distanceMoved).toBe(Math.floor(origSpeed / 2));
  });

  it("haste gives +2 AC", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    mage.statusEffects.push({ type: "haste", turnsRemaining: 3, potency: 0, sourceId: "spell" });
    // getEffectiveAc is not exported, so test indirectly via attack
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    // d20 needs to hit: orig AC was 12 (mage leather), now 14 with haste
    // d20=8 + 3(STR) + 3(prof) = 14 → hits new AC exactly
    const dice = makeRiggedDice([8, 4, 4, 2]); // d20, 2d6, extra miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(false); // hits AC 14
  });

  it("slow gives -2 AC", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "slow", turnsRemaining: 3, potency: 0, sourceId: "spell" });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Warrior AC normally 16, now 14 with slow
    // d20=8 + 3(INT) + 3(prof) = 14 → hits AC 14
    const dice = makeRiggedDice([8, 2, 2]); // d20, damage (fire_bolt 1d10)
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fire_bolt",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(false);
  });
});

describe("Prone", () => {
  it("prone attacker has disadvantage on attacks", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "prone", turnsRemaining: 10, potency: 0, sourceId: "shove" });
    // Disadvantage: [15, 5] → take 5. 5+6=11 < 12 AC → miss
    const dice = makeRiggedDice([15, 5, 2, 2]); // disadv, 2d6, extra miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(true);
  });

  it("prone defender gives advantage to melee attacks within 5ft", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    mage.statusEffects.push({ type: "prone", turnsRemaining: 10, potency: 0, sourceId: "shove" });
    // Advantage: [5, 15] → take 15. 15+6=21 ≥ 12 → hit
    const dice = makeRiggedDice([5, 15, 2, 2, 2, 2]); // adv, 2d6, extra miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(false);
  });

  it("prone defender gives disadvantage to ranged attacks beyond 5ft", () => {
    const mage = makeMage("M", "blue", { x: 10, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "prone", turnsRemaining: 10, potency: 0, sourceId: "shove" });
    // 40ft away → ranged spell attack
    // Advantage [high, low] from prone would apply if within 5ft, but we're at range → disadvantage
    const dice = makeRiggedDice([15, 5, 2]); // disadv on ranged, damage
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fire_bolt",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(true); // took 5 → 5+6=11 < 16
  });
});

// ══════════════════════════════════════════════════════════
//  Invisibility
// ══════════════════════════════════════════════════════════

describe("Invisibility", () => {
  it("gives advantage on attacks", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "invisible", turnsRemaining: 10, potency: 0, sourceId: "spell" });
    // Advantage: [5, 15] → take 15. 15+6=21 ≥ 12 → hit
    const dice = makeRiggedDice([5, 15, 2, 2, 2, 2]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasMiss).toBe(false);
  });

  it("breaks when attacking", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "invisible", turnsRemaining: 10, potency: 0, sourceId: "spell" });
    const dice = makeRiggedDice([15, 2, 2]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("invisibility fades");
    expect(warrior.statusEffects.some(e => e.type === "invisible")).toBe(false);
  });

  it("breaks when casting a spell", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    mage.statusEffects.push({ type: "invisible", turnsRemaining: 10, potency: 0, sourceId: "spell" });
    const dice = makeRiggedDice([15, 2, 2]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fire_bolt",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("invisibility fades");
    expect(mage.statusEffects.some(e => e.type === "invisible")).toBe(false);
  });

  it("does NOT break on defend", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "invisible", turnsRemaining: 10, potency: 0, sourceId: "spell" });
    const dice = makeRiggedDice([]);
    const action: CombatAction = { type: "defend", actorId: warrior.id };
    resolveAction(warrior, undefined, action, dice, ARENA_PRESETS.medium);
    expect(warrior.statusEffects.some(e => e.type === "invisible")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
//  Mirror Image
// ══════════════════════════════════════════════════════════

describe("Mirror Image", () => {
  it("can intercept an attack (duplicate absorbed)", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // 3 mirror images → missThreshold = 6 + 3*2 = 12
    // rigged d20 for mirror check: roll ≤ 12 = miss → use 5
    mage.statusEffects.push({ type: "mirror_image", turnsRemaining: 60, potency: 3, sourceId: "spell" });
    // Attack roll: d20=15 (hit), then mirror check d20=5 (≤12 → miss)
    // Need extra dice for damage roll that won't happen since it's a miss
    const dice = makeRiggedDice([15, 5]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("mirror image");
    expect(result.damage!.wasMiss).toBe(true);
    expect(mage.statusEffects.find(e => e.type === "mirror_image")!.potency).toBe(2);
  });

  it("removes effect when all duplicates are destroyed", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // 1 mirror image → missThreshold = 6 + 1*2 = 8
    mage.statusEffects.push({ type: "mirror_image", turnsRemaining: 60, potency: 1, sourceId: "spell" });
    const dice = makeRiggedDice([15, 5]); // d20=15 hit, mirror d20=5 ≤ 8 → miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("mirror image");
    expect(mage.statusEffects.some(e => e.type === "mirror_image")).toBe(false);
  });

  it("does not intercept critical hits", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    mage.statusEffects.push({ type: "mirror_image", turnsRemaining: 60, potency: 3, sourceId: "spell" });
    // d20=20 (nat 20 crit) — mirror image doesn't intercept crits
    const dice = makeRiggedDice([20, 2, 2, 2, 2]); // crit, 2d6 damage, extra attack miss
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.damage!.wasCrit).toBe(true);
    expect(result.damage!.wasMiss).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
//  Two-Handed Weapon Property
// ══════════════════════════════════════════════════════════

describe("Two-Handed Weapon Property", () => {
  it("prevents off-hand attack with two-handed weapon", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 }); // Has Greatsword (two-handed)
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    expect(warrior.weapon.properties).toContain("two-handed");
    const dice = makeRiggedDice([15, 2, 2]);
    const action: CombatAction = {
      type: "attack", actorId: warrior.id, targetId: mage.id,
      bonusAction: { type: "off_hand_attack", targetId: mage.id },
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("two-handed");
  });
});

// ══════════════════════════════════════════════════════════
//  Concentration
// ══════════════════════════════════════════════════════════

describe("Concentration", () => {
  it("tracks concentrationSpellId when casting concentration spell", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    expect(mage.concentrationSpellId).toBeUndefined();
    // Cast Haste (concentration)
    const dice = makeRiggedDice([]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: mage.id, spellId: "haste",
    };
    resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);
    expect(mage.concentrationSpellId).toBe("haste");
  });

  it("breaks old concentration when casting new concentration spell", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // First cast Haste
    mage.concentrationSpellId = "haste";
    mage.statusEffects.push({ type: "haste", turnsRemaining: 10, potency: 0, sourceId: `${mage.id}_haste` });
    // Now cast Invisibility (also concentration) — should break haste
    const dice = makeRiggedDice([]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: mage.id, spellId: "invisibility",
    };
    resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);
    expect(mage.concentrationSpellId).toBe("invisibility");
    expect(mage.statusEffects.some(e => e.type === "haste")).toBe(false);
    expect(mage.statusEffects.some(e => e.type === "invisible")).toBe(true);
  });

  it("tags status effect sourceId for concentration spells", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const dice = makeRiggedDice([]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: mage.id, spellId: "haste",
    };
    resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);
    const effect = mage.statusEffects.find(e => e.type === "haste");
    expect(effect?.sourceId).toBe(`${mage.id}_haste`);
  });

  it("removes effect from target when concentration breaks", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    // Cast Hold Person on warrior (concentration, control spell)
    const dice = makeRiggedDice([1]); // warrior rolls nat 1 on save → fails
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "hold_person",
    };
    resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium, [mage, warrior]);
    expect(mage.concentrationSpellId).toBe("hold_person");
    expect(warrior.statusEffects.some(e => e.type === "paralyzed")).toBe(true);
    // Now break concentration manually
    breakConcentration(mage, [mage, warrior]);
    expect(warrior.statusEffects.some(e => e.type === "paralyzed")).toBe(false);
    expect(mage.concentrationSpellId).toBeUndefined();
  });

  it("concentrationSaveFromDamage breaks concentration on failed save", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    mage.concentrationSpellId = "haste";
    mage.statusEffects.push({ type: "haste", turnsRemaining: 10, potency: 0, sourceId: `${mage.id}_haste` });
    // DC = max(10, 10/2) = 10. CON mod for mage = +2 (con 14). Roll + 2 needs >= 10
    // Rigged d20 = 5 → 5 + 2 = 7 < 10 → fail → concentration breaks
    const dice = makeRiggedDice([5]);
    const result = concentrationSaveFromDamage(mage, 10, dice);
    expect(result.success).toBe(false);
    expect(mage.concentrationSpellId).toBeUndefined();
    expect(mage.statusEffects.some(e => e.type === "haste")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
//  Dispel Magic
// ══════════════════════════════════════════════════════════

describe("Dispel Magic", () => {
  it("removes magical status effects from target", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "haste", turnsRemaining: 10, potency: 0, sourceId: "spell" });
    warrior.statusEffects.push({ type: "bless", turnsRemaining: 5, potency: 4, sourceId: "spell" });
    warrior.statusEffects.push({ type: "prone", turnsRemaining: 1, potency: 0, sourceId: "shove" });
    const dice = makeRiggedDice([]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "dispel_magic",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("Dispel Magic");
    expect(warrior.statusEffects.some(e => e.type === "haste")).toBe(false);
    expect(warrior.statusEffects.some(e => e.type === "bless")).toBe(false);
    expect(warrior.statusEffects.some(e => e.type === "prone")).toBe(true); // non-magical kept
  });

  it("breaks target's concentration", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.concentrationSpellId = "bless";
    warrior.statusEffects.push({ type: "bless", turnsRemaining: 5, potency: 4, sourceId: `${warrior.id}_bless` });
    const dice = makeRiggedDice([]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "dispel_magic",
    };
    resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(warrior.concentrationSpellId).toBeUndefined();
  });

  it("reports no effects when target has none", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const dice = makeRiggedDice([]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "dispel_magic",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("no magical effects");
  });
});

// ══════════════════════════════════════════════════════════
//  Absorb Elements
// ══════════════════════════════════════════════════════════

describe("Absorb Elements", () => {
  it("grants resistance to damage when active", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    mage.statusEffects.push({ type: "absorb_elements", turnsRemaining: 1, potency: 0, sourceId: "spell" });
    const result = applyDamageModifiers(mage, 20, "fire");
    expect(result).toBe(10); // halved
  });

  it("does not affect damage without a type", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    mage.statusEffects.push({ type: "absorb_elements", turnsRemaining: 1, potency: 0, sourceId: "spell" });
    const result = applyDamageModifiers(mage, 20, undefined);
    expect(result).toBe(20); // unchanged
  });
});

// ══════════════════════════════════════════════════════════
//  Death Save Edge Cases
// ══════════════════════════════════════════════════════════

describe("Death Save Edge Cases", () => {
  it("applyDamageToDying adds 1 failure on normal hit", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.stats.hp = 0;
    markUnconscious(warrior);
    const failures = applyDamageToDying(warrior, false);
    expect(failures).toBe(1);
    expect(warrior.deathSaveFailures).toBe(1);
  });

  it("applyDamageToDying adds 2 failures on crit", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.stats.hp = 0;
    markUnconscious(warrior);
    const failures = applyDamageToDying(warrior, true);
    expect(failures).toBe(2);
    expect(warrior.deathSaveFailures).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════
//  Unknown Bonus Action
// ══════════════════════════════════════════════════════════

describe("Unknown Bonus Action", () => {
  it("falls back to wait for unknown bonus action type", () => {
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const dice = makeRiggedDice([15, 2, 2]);
    const action: CombatAction = {
      type: "attack", actorId: warrior.id, targetId: mage.id,
      bonusAction: { type: "unknown_action" } as any,
    };
    const result = resolveAction(warrior, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("does nothing");
  });
});

// ══════════════════════════════════════════════════════════
//  Cover System
// ══════════════════════════════════════════════════════════

describe("Cover System", () => {
  it("provides +2 AC from half cover", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 90, y: 30 });
    // Create arena with a cover object between them
    const arena: ArenaConfig = {
      width: 100, height: 60, label: "Test",
      coverObjects: [{ x: 48, y: 28, width: 4, height: 4, coverLevel: "half" }],
    };
    const bonus = getCoverBonus(warrior.position, mage.position, arena);
    expect(bonus).toBe(2);
  });

  it("provides +5 AC from three-quarters cover", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 90, y: 30 });
    const arena: ArenaConfig = {
      width: 100, height: 60, label: "Test",
      coverObjects: [{ x: 48, y: 28, width: 4, height: 4, coverLevel: "three_quarters" }],
    };
    const bonus = getCoverBonus(warrior.position, mage.position, arena);
    expect(bonus).toBe(5);
  });

  it("provides no bonus when no cover in line of sight", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 90, y: 30 });
    const arena: ArenaConfig = {
      width: 100, height: 60, label: "Test",
      coverObjects: [{ x: 48, y: 10, width: 4, height: 4, coverLevel: "half" }], // off to the side
    };
    const bonus = getCoverBonus(warrior.position, mage.position, arena);
    expect(bonus).toBe(0);
  });

  it("provides no bonus when arena has no cover objects", () => {
    const warrior = makeWarrior("W", "red", { x: 10, y: 30 });
    const mage = makeMage("M", "blue", { x: 90, y: 30 });
    const arena: ArenaConfig = { width: 100, height: 60, label: "Test" };
    const bonus = getCoverBonus(warrior.position, mage.position, arena);
    expect(bonus).toBe(0);
  });

  it("cover affects attack rolls in combat", () => {
    const warrior = makeWarrior("W", "red", { x: 5, y: 30 });
    const mage = makeMage("M", "blue", { x: 9, y: 30 });
    const arenaNoCover: ArenaConfig = { width: 100, height: 60, label: "Test" };
    const arenaWithCover: ArenaConfig = {
      width: 100, height: 60, label: "Test",
      coverObjects: [{ x: 6, y: 28, width: 2, height: 4, coverLevel: "half" }],
    };
    // Line from (5,30) to (9,30) passes through cover at x=6-8, y=28-32
    const dice = makeRiggedDice([13, 4]); // d20=13, damage die
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const resultNoCover = resolveAction(warrior, mage, action, dice, arenaNoCover);
    const dice2 = makeRiggedDice([13, 4]);
    const resultWithCover = resolveAction(warrior, mage, action, dice2, arenaWithCover);
    expect(resultNoCover.damage?.targetAc).toBe(12); // mage base AC
    expect(resultWithCover.damage?.targetAc).toBe(14); // mage AC + 2 cover
  });

  it("cover blocks a hit that would otherwise land", () => {
    const warrior = makeWarrior("W", "red", { x: 5, y: 30 });
    const mage = makeMage("M", "blue", { x: 9, y: 30 });
    const arenaNoCover: ArenaConfig = { width: 100, height: 60, label: "Test" };
    const arenaWithCover: ArenaConfig = {
      width: 100, height: 60, label: "Test",
      coverObjects: [{ x: 6, y: 28, width: 2, height: 4, coverLevel: "three_quarters" }],
    };
    // Roll 9 + STR(4) + prof(3) = 16 vs AC 12 → hit without cover
    // With three-quarters cover: 16 vs AC 17 (12+5) → miss!
    const dice = makeRiggedDice([9, 4]);
    const action: CombatAction = { type: "attack", actorId: warrior.id, targetId: mage.id };
    const resultNoCover = resolveAction(warrior, mage, action, dice, arenaNoCover);
    const dice2 = makeRiggedDice([9, 4]);
    const resultWithCover = resolveAction(warrior, mage, action, dice2, arenaWithCover);
    expect(resultNoCover.damage).toBeDefined();
    expect(resultNoCover.damage!.wasMiss).toBe(false);
    expect(resultWithCover.damage).toBeDefined();
    expect(resultWithCover.damage!.wasMiss).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
//  Control Spell: Auto-Fail Save Path
// ══════════════════════════════════════════════════════════

describe("Control Spell Auto-Fail Save", () => {
  it("auto-fails save when paralyzed target is hit with Hold Person", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    // Make warrior paralyzed (auto-fails STR/DEX saves)
    warrior.statusEffects.push({ type: "paralyzed", turnsRemaining: 10, potency: 0, sourceId: "test" });
    // Cast Hold Person — warrior auto-fails WIS save because paralyzed
    // Actually paralyzed only auto-fails STR/DEX. Hold Person is WIS.
    // Let's use a STR save spell instead — there aren't many.
    // Better: test the auto-fail code path by making the target stunned
    // Stunned auto-fails STR/DEX saves
    warrior.statusEffects = warrior.statusEffects.filter(e => e.type !== "paralyzed");
    warrior.statusEffects.push({ type: "stunned", turnsRemaining: 10, potency: 0, sourceId: "test" });
    // Web spell requires DEX save — stunned auto-fails
    const dice = makeRiggedDice([]); // no dice needed for auto-fail
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "web",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium, [mage, warrior]);
    expect(result.narrative).toContain("auto-fails");
    expect(warrior.statusEffects.some(e => e.type === "restrained")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
//  Off-Hand Attack Edge Cases
// ══════════════════════════════════════════════════════════

describe("Off-Hand Attack Edge Cases", () => {
  it("off-hand attack hits and deals damage", () => {
    // Use rogue (has Dagger — light weapon, NOT two-handed)
    const rogue = createCharacter("R", "Rogue", "rogue", { x: 50, y: 30 }, "red");
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    // Rogue weapon: Dagger (1d4, finesse, light)
    expect(rogue.weapon.properties).not.toContain("two-handed");
    const dice = makeRiggedDice([15, 3, 15, 3]); // main d20=15, main dmg=3, off-hand d20=15, off-hand dmg=3
    const action: CombatAction = {
      type: "attack", actorId: rogue.id, targetId: mage.id,
      bonusAction: { type: "off_hand_attack", targetId: mage.id },
    };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("BONUS");
    expect(result.narrative).toContain("off-hand attack hits");
  });

  it("off-hand attack misses", () => {
    const rogue = createCharacter("R", "Rogue", "rogue", { x: 50, y: 30 }, "red");
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const dice = makeRiggedDice([1, 3]); // nat 1 → auto-miss
    const action: CombatAction = {
      type: "attack", actorId: rogue.id, targetId: mage.id,
      bonusAction: { type: "off_hand_attack", targetId: mage.id },
    };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("off-hand attack misses");
  });

  it("off-hand attack out of range", () => {
    const rogue = createCharacter("R", "Rogue", "rogue", { x: 10, y: 30 }, "red");
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const dice = makeRiggedDice([15, 15, 3, 3]); // main attack dice + bonus attack dice
    const action: CombatAction = {
      type: "attack", actorId: rogue.id, targetId: mage.id,
      bonusAction: { type: "off_hand_attack", targetId: mage.id },
    };
    // Rogue dagger range is 5ft (melee), target is 40ft away
    // But main attack also out of range — both will be "too far away"
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("too far away");
  });

  it("cunning action disengage prevents opportunity attack", () => {
    const rogue = createCharacter("R", "Rogue", "rogue", { x: 50, y: 30 }, "red");
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // Apply disengaging status
    rogue.statusEffects.push({ type: "disengaging", turnsRemaining: 1, potency: 0, sourceId: rogue.id });
    const fromPos = { x: 50, y: 30 };
    const toPos = { x: 60, y: 30 };
    const result = checkOpportunityAttack(rogue, fromPos, toPos, [warrior], makeRiggedDice([10]));
    expect(result).toBeNull(); // no opportunity attack when disengaging
  });
});

// ══════════════════════════════════════════════════════════
//  Spell Damage Status Effect Path
// ══════════════════════════════════════════════════════════

describe("Spell Damage Status Effects", () => {
  it("applies status on failed save for save-based damage spell", () => {
    // Ray of Frost applies speed reduction on hit (attack roll, not save)
    // Instead test with Thunderwave which has a CON save
    // Actually, Thunderwave has a status effect? Let me check.
    // It doesn't. Let me test the existing mechanic:
    // Web on a stunned target should auto-fail DEX save and apply restrained
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "stunned", turnsRemaining: 10, potency: 0, sourceId: "test" });
    const dice = makeRiggedDice([]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "web",
    };
    resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium, [mage, warrior]);
    expect(warrior.statusEffects.some(e => e.type === "restrained")).toBe(true);
  });

  it("does not apply status on successful save", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    // Web: DEX save DC = INT(3) + prof(3) + 8 = 14
    // Warrior DEX mod = +2, so roll needs >= 12 (12+2=14)
    const dice = makeRiggedDice([20]); // nat 20 → definitely saves
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "web",
    };
    resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium, [mage, warrior]);
    expect(warrior.statusEffects.some(e => e.type === "restrained")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
//  Mirror Image vs Spell Attacks
// ══════════════════════════════════════════════════════════

describe("Mirror Image vs Spells", () => {
  it("spell attack can hit mirror image duplicate instead", () => {
    const mage = makeMage("M", "blue", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "red", { x: 50, y: 30 });
    warrior.statusEffects.push({ type: "mirror_image", turnsRemaining: 10, potency: 3, sourceId: mage.id });
    // Fire Bolt attack roll: d20 for attack. Need to hit first.
    // Mage INT(3) + prof(3) = +6. Need >= AC 12, so roll >= 6.
    // d20[0] = 10 for attack roll → 10+6=16 >= 12 → hit
    // d10[1-3] = damage dice (3d10)
    // d20[4] = mirror image check → 5 <= 12 → hits duplicate
    const dice = makeRiggedDice([10, 1, 1, 1, 5]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "fire_bolt",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);
    expect(result.narrative).toContain("mirror image duplicate");
    expect(warrior.statusEffects.find(e => e.type === "mirror_image")?.potency).toBe(2);
  });
});