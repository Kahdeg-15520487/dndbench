import { describe, it, expect } from "vitest";
import { createCharacter } from "../engine/characters.js";
import { CombatAction, ARENA_PRESETS, ClassFeatureId, ItemId } from "../engine/types.js";
import { DiceRoller } from "../engine/dice.js";
import {
  resolveAction,
  resolveMove,
  processStatusEffects,
  tickCooldowns,
  determineTurnOrder,
  createSnapshot,
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
    // Use a rogue (no Extra Attack) for predictable dice usage
    const rogue = makeRogue("R", "red", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    // d20=20 (crit), then rapier 1d8 doubled to 2d8: [5, 6] = 11 + 3 (DEX mod) = 14
    // Then sneak attack 3d6: [2, 2, 2] = 6
    // Total: 11 + 3 + 6 = 20
    const dice = makeRiggedDice([20, 5, 6, 2, 2, 2]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasCrit).toBe(true);
    expect(result.damage!.damageRolls!.length).toBeGreaterThanOrEqual(2); // 2d8 for crit
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

  it("Sneak Attack adds 3d6 on hit", () => {
    const rogue = makeRogue();
    const mage = makeMage("Target", "blue", { x: 50, y: 10 }); // same position
    // d20=15 (hit), 1d8=[6], then 3d6 sneak=[3,4,5]
    const dice = makeRiggedDice([15, 6, 3, 4, 5]);
    const action: CombatAction = { type: "attack", actorId: rogue.id, targetId: mage.id };
    const result = resolveAction(rogue, mage, action, dice, ARENA_PRESETS.medium);

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
    // Total: 4 (weapon) + 3 (STR mod) + 11 (smite) = 18
    const dice = makeRiggedDice([15, 4, 2, 5, 6]);
    const action: CombatAction = { type: "attack", actorId: paladin.id, targetId: mage.id };
    const result = resolveAction(paladin, mage, action, dice, ARENA_PRESETS.medium);

    // Main: 4 (weapon) + 3 (STR) = 7, smite: 5+6=11, total = 18
    // Extra attack: d20=2 → 2+3+3=8 < 12 AC → miss, no damage
    const totalDmg = result.damage!.damage;
    expect(totalDmg).toBe(18);

    // Consumed a 1st-level slot
    const slotsAfter = paladin.spellSlots[1]!.total - paladin.spellSlots[1]!.used;
    expect(slotsAfter).toBe(slotsBefore - 1);
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
    expect(result.damage!.saveSuccess).toBe(false);
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
  it("Health Potion heals the user", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = 20;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, itemId: "health_potion",
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.heal).toBeDefined();
    expect(result.heal!.amount).toBe(7); // potency
    expect(warrior.stats.hp).toBe(27);
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
  it("Greater Health Potion heals 14 HP (potency)", () => {
    const mage = makeMage();
    mage.stats.hp = 10;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: mage.id, itemId: "greater_health_potion",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.heal!.amount).toBe(14);
    expect(mage.stats.hp).toBe(24);
    const pot = mage.inventory.find(i => i.id === "greater_health_potion")!;
    expect(pot.quantity).toBe(0);
  });

  it("Health Potion doesn't overheal", () => {
    const warrior = makeWarrior();
    warrior.stats.hp = warrior.stats.maxHp - 3; // missing 3 HP
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "use_item", actorId: warrior.id, itemId: "health_potion",
    };
    const result = resolveAction(warrior, warrior, action, dice, ARENA_PRESETS.medium);

    // Potion heals 7 but only 3 missing
    expect(warrior.stats.hp).toBe(warrior.stats.maxHp);
    expect(result.heal!.amount).toBe(7); // potion always heals its potency
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
  it("hits with spell attack roll", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // d20=20 (crit!), scorching ray 6d6 doubled to 12d6 on crit: [4,4,4,4,4,4,4,4,4,4,4,4] = 48 + 3 (INT mod) = 51
    const dice = makeRiggedDice([20, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "scorching_ray",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasCrit).toBe(true);
    expect(result.damage!.damage).toBe(51); // 12*4 + 3 INT mod
    expect(result.spell!.slotUsed).toBe(2);
  });

  it("misses when attack roll is low", () => {
    const mage = makeMage("M", "red", { x: 50, y: 30 });
    const warrior = makeWarrior("W", "blue", { x: 50, y: 30 });
    // d20=1 → natural 1 → auto-miss
    const dice = makeRiggedDice([1]);
    const action: CombatAction = {
      type: "cast_spell", actorId: mage.id, targetId: warrior.id, spellId: "scorching_ray",
    };
    const result = resolveAction(mage, warrior, action, dice, ARENA_PRESETS.medium);

    expect(result.damage!.wasMiss).toBe(true);
    expect(result.damage!.damage).toBe(0);
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
    // Add a level 4 slot and use it
    (mage.spellSlots as any)[4] = { total: 1, used: 1 };
    mage.spellSlots[1]!.used = 0;
    mage.spellSlots[2]!.used = 0;
    mage.spellSlots[3]!.used = 0;
    const dice = new DiceRoller(42);
    const action: CombatAction = {
      type: "class_ability", actorId: mage.id, abilityId: "arcane_recovery",
    };
    const result = resolveAction(mage, mage, action, dice, ARENA_PRESETS.medium);

    expect(result.narrative).toContain("4th");
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

    expect(result.damage!.saveSuccess).toBe(false);
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

    expect(result.damage!.saveSuccess).toBe(true);
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