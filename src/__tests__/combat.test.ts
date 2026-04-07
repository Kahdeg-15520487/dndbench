import { describe, it, expect, beforeEach } from "vitest";
import { createCharacter } from "../engine/characters.js";
import { Character, CombatAction, ARENA_PRESETS } from "../engine/types.js";
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
  real.d = function (n: number, ctx: string): number {
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
    expect(result.damage!.damageRolls.length).toBeGreaterThanOrEqual(2); // 2d8 for crit
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

    expect(result.damage!.damageRolls.length).toBeGreaterThanOrEqual(4); // 1d8 + 3d6
    // 6 + 3+4+5 + 3 (DEX mod) = 21
    expect(result.damage!.damage).toBe(21);
  });

  it("Divine Smite adds 2d8 on hit and consumes slot", () => {
    const paladin = makePaladin("P", "gold", { x: 48, y: 30 });
    const mage = makeMage("M", "blue", { x: 52, y: 30 });
    const slotsBefore = paladin.spellSlots[1]!.total - paladin.spellSlots[1]!.used;
    // d20=15 (hit), 1d8 weapon=[4], +3 STR = 7 damage
    // Divine Smite: 2d8=[5,6] = 11 extra
    // Extra Attack: d20=10 (miss, 10+3+3=16 >= 12 AC... hmm, let's make it clearly miss)
    // Actually 10+3+3=16 >= 12, so that hits too. Let's make extra attack miss:
    // d20=2, 2+3+3=8 < 12 = miss. No damage dice needed.
    const dice = makeRiggedDice([15, 4, 5, 6, 2]);
    const action: CombatAction = { type: "attack", actorId: paladin.id, targetId: mage.id };
    const result = resolveAction(paladin, mage, action, dice, ARENA_PRESETS.medium);

    // Main attack damage: 4 (weapon) + 3 (STR) + 5 + 6 (smite) = 18
    // Extra attack: miss, no damage
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
    const slotsBefore = Object.keys(mage.spellSlots).length;
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
    const acBefore = mage.stats.ac;
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
    const mage = makeMage("M", "blue", { x: 10, y: 30 }); // same position
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
