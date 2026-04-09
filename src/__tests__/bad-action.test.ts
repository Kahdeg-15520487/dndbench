// ─────────────────────────────────────────────────────────
//  Bad Action Detection Tests
//  Tests that combat.ts sets badAction reason codes correctly
// ─────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { resolveAction } from "../engine/combat.js";
import { createCharacter } from "../engine/characters.js";
import { DiceRoller } from "../engine/dice.js";
import { ARENA_PRESETS } from "../engine/types.js";
import type { CombatAction, Character } from "../engine/types.js";

function makeWarrior(name = "Alpha", pos = { x: 5, y: 5 }): Character {
  return createCharacter("w1", name, "warrior", pos, "red");
}

function makeMage(name = "Beta", pos = { x: 85, y: 5 }): Character {
  return createCharacter("m1", name, "mage", pos, "blue");
}

describe("Bad Action Reason Codes", () => {
  const dice = new DiceRoller(42);
  const arena = ARENA_PRESETS.medium;

  it("sets badAction='out_of_range' for melee attack on distant target", () => {
    const attacker = makeWarrior("Alpha", { x: 5, y: 5 });
    const target = makeMage("Beta", { x: 85, y: 5 });
    const action: CombatAction = { type: "attack", actorId: "w1", targetId: "m1" };
    const result = resolveAction(attacker, target, action, dice, arena, [attacker, target]);
    expect(result.badAction).toBe("out_of_range");
  });

  it("sets badAction='unknown_spell' for non-existent spell", () => {
    const attacker = makeMage("Alpha", { x: 5, y: 5 });
    const target = makeMage("Beta", { x: 85, y: 5 });
    const action: CombatAction = { type: "cast_spell", actorId: "w1", targetId: "m1", spellId: "nonexistent_spell" };
    const result = resolveAction(attacker, target, action, dice, arena, [attacker, target]);
    expect(result.badAction).toBe("unknown_spell");
  });

  it("sets badAction='timeout' for timed-out action", () => {
    const attacker = makeWarrior("Alpha", { x: 5, y: 5 });
    const target = makeMage("Beta", { x: 85, y: 5 });
    const action: CombatAction = { type: "wait", actorId: "w1", timedOut: true };
    const result = resolveAction(attacker, target, action, dice, arena, [attacker, target]);
    expect(result.badAction).toBe("timeout");
    expect(result.narrative).toContain("dazed");
  });

  it("sets badAction='no_ability' for unknown ability", () => {
    const attacker = makeWarrior("Alpha", { x: 40, y: 30 });
    const target = makeMage("Beta", { x: 50, y: 30 });
    const action: CombatAction = { type: "class_ability", actorId: "w1", targetId: "m1", abilityId: "nonexistent_ability" };
    const result = resolveAction(attacker, target, action, dice, arena, [attacker, target]);
    expect(result.badAction).toBe("no_ability");
  });

  it("sets badAction='no_item' for unknown item", () => {
    const attacker = makeWarrior("Alpha", { x: 40, y: 30 });
    const target = makeMage("Beta", { x: 50, y: 30 });
    const action: CombatAction = { type: "use_item", actorId: "w1", targetId: "m1", itemId: "nonexistent_item" };
    const result = resolveAction(attacker, target, action, dice, arena, [attacker, target]);
    expect(result.badAction).toBe("no_item");
  });

  it("sets no badAction for a valid attack in range", () => {
    const attacker = makeWarrior("Alpha", { x: 40, y: 30 });
    const target = makeMage("Beta", { x: 42, y: 30 }); // 2ft apart, melee range
    const action: CombatAction = { type: "attack", actorId: "w1", targetId: "m1" };
    const result = resolveAction(attacker, target, action, dice, arena, [attacker, target]);
    expect(result.badAction).toBeUndefined();
  });

  it("sets no badAction for defend action", () => {
    const attacker = makeWarrior("Alpha", { x: 40, y: 30 });
    const target = makeMage("Beta", { x: 50, y: 30 });
    const action: CombatAction = { type: "defend", actorId: "w1" };
    const result = resolveAction(attacker, target, action, dice, arena, [attacker, target]);
    expect(result.badAction).toBeUndefined();
  });
});
