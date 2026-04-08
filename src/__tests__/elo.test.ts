// ─────────────────────────────────────────────────────────
//  ELO Rating System Tests
// ─────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  expectedScore,
  updateElo,
  createModelStats,
  updateStatsAfterMatch,
  isBadAction,
} from "../arena/elo.js";

describe("ELO Rating System", () => {
  // ── expectedScore ──

  describe("expectedScore", () => {
    it("returns 0.5 for equal ratings", () => {
      expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 5);
    });

    it("returns >0.5 when player A is higher rated", () => {
      expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
    });

    it("returns <0.5 when player A is lower rated", () => {
      expect(expectedScore(1000, 1200)).toBeLessThan(0.5);
    });

    it("is symmetric: E_A + E_B = 1", () => {
      const eA = expectedScore(1200, 1000);
      const eB = expectedScore(1000, 1200);
      expect(eA + eB).toBeCloseTo(1.0, 5);
    });

    it("approaches 1 for very high rating difference", () => {
      expect(expectedScore(2000, 1000)).toBeGreaterThan(0.99);
    });

    it("approaches 0 for very low rating difference", () => {
      expect(expectedScore(1000, 2000)).toBeLessThan(0.01);
    });

    it("is monotonically increasing in rating A", () => {
      const e1 = expectedScore(1000, 1000);
      const e2 = expectedScore(1100, 1000);
      const e3 = expectedScore(1200, 1000);
      expect(e1).toBeLessThan(e2);
      expect(e2).toBeLessThan(e3);
    });

    it("uses standard 400-point formula", () => {
      // 200-point difference → E_A ≈ 0.759
      expect(expectedScore(1200, 1000)).toBeCloseTo(0.7597, 2);
    });
  });

  // ── updateElo ──

  describe("updateElo", () => {
    it("both stay at 1000 on a draw", () => {
      const [a, b] = updateElo(1000, 1000, 0.5);
      expect(a).toBe(1000);
      expect(b).toBe(1000);
    });

    it("winner gains, loser loses on equal ratings", () => {
      const [a, b] = updateElo(1000, 1000, 1); // A wins
      expect(a).toBeGreaterThan(1000);
      expect(b).toBeLessThan(1000);
      // Equal exchange (since E was 0.5 for both)
      expect(a - 1000).toBe(1000 - b);
    });

    it("favorite gains little from beating underdog", () => {
      const [a] = updateElo(1500, 1000, 1); // A is heavy favorite
      expect(a - 1500).toBeLessThan(8);
    });

    it("underdog gains a lot from beating favorite", () => {
      const [, b] = updateElo(1500, 1000, 0); // B (underdog) wins
      expect(b - 1000).toBeGreaterThan(20);
    });

    it("respects custom K-factor", () => {
      const [a1] = updateElo(1000, 1000, 1, 32);
      const [a2] = updateElo(1000, 1000, 1, 64);
      expect(a2 - 1000).toBeGreaterThan(a1 - 1000);
    });

    it("total ELO is conserved (zero-sum)", () => {
      const [a, b] = updateElo(1200, 800, 1, 32);
      expect(a + b).toBe(2000);
    });

    it("returns integers (rounded)", () => {
      const [a, b] = updateElo(1234, 1567, 0.5, 17);
      expect(Number.isInteger(a)).toBe(true);
      expect(Number.isInteger(b)).toBe(true);
    });

    it("losing player ELO can go below 0 with extreme K-factor", () => {
      // K=1000, huge rating gap, upset
      const [, b] = updateElo(3000, 100, 1, 1000);
      // B loses very little since they were expected to lose
      expect(b).toBeLessThan(200);
    });
  });

  // ── createModelStats ──

  describe("createModelStats", () => {
    it("creates stats with default ELO 1000", () => {
      const stats = createModelStats("test-model");
      expect(stats.model).toBe("test-model");
      expect(stats.elo).toBe(1000);
      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(0);
      expect(stats.draws).toBe(0);
      expect(stats.matchesPlayed).toBe(0);
    });

    it("creates stats with custom initial ELO", () => {
      const stats = createModelStats("test-model", 1200);
      expect(stats.elo).toBe(1200);
    });

    it("marks heuristic flag correctly", () => {
      const h = createModelStats("heur", 1000, true);
      const m = createModelStats("llm", 1000, false);
      expect(h.isHeuristic).toBe(true);
      expect(m.isHeuristic).toBe(false);
    });

    it("initializes all class stats to zero", () => {
      const stats = createModelStats("test");
      expect(stats.battlesAsWarrior).toBe(0);
      expect(stats.battlesAsMage).toBe(0);
      expect(stats.battlesAsRogue).toBe(0);
      expect(stats.battlesAsPaladin).toBe(0);
      expect(stats.winsAsWarrior).toBe(0);
      expect(stats.winsAsMage).toBe(0);
      expect(stats.winsAsRogue).toBe(0);
      expect(stats.winsAsPaladin).toBe(0);
    });

    it("initializes turn/action stats to zero", () => {
      const stats = createModelStats("test");
      expect(stats.totalTurns).toBe(0);
      expect(stats.totalToolCalls).toBe(0);
      expect(stats.totalBadActions).toBe(0);
    });
  });

  // ── updateStatsAfterMatch ──

  describe("updateStatsAfterMatch", () => {
    it("updates wins/losses for A winning", () => {
      const a = createModelStats("A");
      const b = createModelStats("B");
      updateStatsAfterMatch(a, b, 1); // A wins
      expect(a.wins).toBe(1);
      expect(b.losses).toBe(1);
      expect(a.losses).toBe(0);
      expect(b.wins).toBe(0);
    });

    it("updates wins/losses for B winning", () => {
      const a = createModelStats("A");
      const b = createModelStats("B");
      updateStatsAfterMatch(a, b, 0); // B wins
      expect(a.losses).toBe(1);
      expect(b.wins).toBe(1);
    });

    it("updates draws for a draw", () => {
      const a = createModelStats("A");
      const b = createModelStats("B");
      updateStatsAfterMatch(a, b, 0.5);
      expect(a.draws).toBe(1);
      expect(b.draws).toBe(1);
    });

    it("increments matchesPlayed", () => {
      const a = createModelStats("A");
      const b = createModelStats("B");
      updateStatsAfterMatch(a, b, 1);
      expect(a.matchesPlayed).toBe(1);
      expect(b.matchesPlayed).toBe(1);
    });

    it("updates ELO ratings", () => {
      const a = createModelStats("A", 1000);
      const b = createModelStats("B", 1000);
      updateStatsAfterMatch(a, b, 1);
      expect(a.elo).toBeGreaterThan(1000);
      expect(b.elo).toBeLessThan(1000);
    });

    it("accumulates over multiple matches", () => {
      const a = createModelStats("A", 1000);
      const b = createModelStats("B", 1000);
      updateStatsAfterMatch(a, b, 1);
      updateStatsAfterMatch(a, b, 1);
      updateStatsAfterMatch(a, b, 0); // B wins
      expect(a.matchesPlayed).toBe(3);
      expect(b.matchesPlayed).toBe(3);
      expect(a.wins).toBe(2);
      expect(b.wins).toBe(1);
    });
  });

  // ── isBadAction ──

  describe("isBadAction", () => {
    it("detects 'too far away'", () => {
      expect(isBadAction("The target is too far away to attack")).toBe(true);
    });

    it("detects 'no target'", () => {
      expect(isBadAction("There is no target in range")).toBe(true);
    });

    it("detects 'unknown spell'", () => {
      expect(isBadAction("That is an unknown spell")).toBe(true);
    });

    it("detects 'doesn't have that item'", () => {
      expect(isBadAction("The character doesn't have that item")).toBe(true);
    });

    it("detects 'no uses remaining'", () => {
      expect(isBadAction("Ability has no uses remaining")).toBe(true);
    });

    it("detects 'is on cooldown'", () => {
      expect(isBadAction("Fireball is on cooldown")).toBe(true);
    });

    it("detects 'no spell slots left'", () => {
      expect(isBadAction("You have no spell slots left")).toBe(true);
    });

    it("detects 'doesn't have ability'", () => {
      expect(isBadAction("Rogue doesn't have ability: Divine Smite")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(isBadAction("TOO FAR AWAY")).toBe(true);
      expect(isBadAction("Unknown Spell")).toBe(true);
    });

    it("returns false for valid actions", () => {
      expect(isBadAction("Alpha attacks Beta with a longsword for 12 damage")).toBe(false);
      expect(isBadAction("Beta casts Fireball at Alpha")).toBe(false);
      expect(isBadAction("Alpha uses a health potion and recovers 10 HP")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isBadAction("")).toBe(false);
    });

    it("detects partial matches in longer narrative", () => {
      expect(isBadAction("Alpha tries to attack but is too far away from the target")).toBe(true);
    });
  });
});
