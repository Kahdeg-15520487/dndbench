import { describe, it, expect } from "vitest";
import { DiceRoller } from "../engine/dice.js";

describe("DiceRoller", () => {
  it("produces deterministic rolls for a given seed", () => {
    const a = new DiceRoller(42);
    const b = new DiceRoller(42);
    for (let i = 0; i < 50; i++) {
      expect(a.d20("test")).toBe(b.d20("test"));
    }
  });

  it("different seeds produce different sequences", () => {
    const a = new DiceRoller(1);
    const b = new DiceRoller(2);
    const rollsA = Array.from({ length: 20 }, () => a.d20("test"));
    const rollsB = Array.from({ length: 20 }, () => b.d20("test"));
    expect(rollsA).not.toEqual(rollsB);
  });

  it("d20 returns values in [1, 20]", () => {
    const dice = new DiceRoller(123);
    for (let i = 0; i < 100; i++) {
      const r = dice.d20("test");
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(20);
    }
  });

  it("d(n) returns values in [1, n]", () => {
    const dice = new DiceRoller(456);
    for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
      for (let i = 0; i < 50; i++) {
        const r = dice.d(sides, `d${sides} test`);
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(sides);
      }
    }
  });

  it("rollDice handles standard notation", () => {
    const dice = new DiceRoller(789);
    // 2d6: min 2, max 12
    const r1 = dice.rollDice("2d6", "test");
    expect(r1).toBeGreaterThanOrEqual(2);
    expect(r1).toBeLessThanOrEqual(12);

    // 1d20: same as d20
    const r2 = dice.rollDice("1d20", "test");
    expect(r2).toBeGreaterThanOrEqual(1);
    expect(r2).toBeLessThanOrEqual(20);
  });

  it("rollDice handles modifier notation", () => {
    const dice = new DiceRoller(999);
    // 3d4+3: min 6, max 15
    const r = dice.rollDice("3d4+3", "test");
    expect(r).toBeGreaterThanOrEqual(6);
    expect(r).toBeLessThanOrEqual(15);

    // 1d8-1: min 0, max 7
    const r2 = dice.rollDice("1d8-1", "test");
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(r2).toBeLessThanOrEqual(7);
  });

  it("rollDice throws on invalid notation", () => {
    const dice = new DiceRoller(1);
    expect(() => dice.rollDice("invalid", "test")).toThrow();
    expect(() => dice.rollDice("d6", "test")).toThrow();
    expect(() => dice.rollDice("2d", "test")).toThrow();
  });

  it("rollDiceDetailed returns individual rolls", () => {
    const dice = new DiceRoller(111);
    const result = dice.rollDiceDetailed("4d6", "test");
    expect(result.rolls).toHaveLength(4);
    expect(result.total).toBe(result.rolls.reduce((a, b) => a + b, 0));
    for (const r of result.rolls) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });

  it("rollDiceDetailed with modifier", () => {
    const dice = new DiceRoller(222);
    const result = dice.rollDiceDetailed("2d10+5", "test");
    expect(result.rolls).toHaveLength(2);
    expect(result.total).toBe(result.rolls.reduce((a, b) => a + b, 0) + 5);
  });

  it("logs all rolls", () => {
    const dice = new DiceRoller(333);
    dice.d20("attack");
    dice.d6("damage");
    dice.d(4, "bonus");
    const log = dice.getLog();
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ die: 20, context: "attack" });
    expect(log[1]).toMatchObject({ die: 6, context: "damage" });
    expect(log[2]).toMatchObject({ die: 4, context: "bonus" });
  });

  it("clearLog resets state and re-seeds", () => {
    const dice = new DiceRoller(444);
    const first = dice.d20("test");
    dice.clearLog();
    const after = dice.d20("test");
    // After clearLog, the PRNG re-seeds so same value expected
    expect(first).toBe(after);
    expect(dice.getLog()).toHaveLength(1);
    expect(dice.getRollCount()).toBe(1);
  });

  it("roll numbers are sequential", () => {
    const dice = new DiceRoller(555);
    dice.d20("a");
    dice.d6("b");
    dice.d(8, "c");
    const log = dice.getLog();
    expect(log[0].rollNumber).toBe(1);
    expect(log[1].rollNumber).toBe(2);
    expect(log[2].rollNumber).toBe(3);
  });
});
