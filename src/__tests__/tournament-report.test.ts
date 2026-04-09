// ─────────────────────────────────────────────────────────
//  Tournament Report Tests
// ─────────────────────────────────────────────────────────

import { describe, it, expect, afterEach } from "vitest";
import { saveTournamentReport } from "../arena/tournament-report.js";
import type { TournamentResult, MatchupResult, GameResult } from "../arena/tournament.js";
import { HEURISTIC_BASELINE } from "../arena/tournament.js";
import { createModelStats } from "../arena/elo.js";
import fs from "fs";
import path from "path";

const TEST_DIR = path.join(process.cwd(), "test-tournament-reports");

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeGameResult(overrides: Partial<GameResult> = {}): GameResult {
  return {
    gameNumber: 1,
    modelA: "model-a",
    modelB: "model-b",
    classA: "warrior",
    classB: "mage",
    winner: "A",
    winningModel: "model-a",
    turns: 8,
    statsA: { toolCalls: 5, badActions: 1, turns: 8, avgToolCallsPerTurn: 0.625, badActionRate: 0.125 },
    statsB: { toolCalls: 6, badActions: 2, turns: 8, avgToolCallsPerTurn: 0.75, badActionRate: 0.25 },
    ...overrides,
  };
}

function makeMatchupResult(overrides: Partial<MatchupResult> = {}): MatchupResult {
  return {
    modelA: "model-a",
    modelB: "model-b",
    winsA: 3,
    winsB: 2,
    draws: 0,
    games: [
      makeGameResult({ gameNumber: 1, winner: "A" }),
      makeGameResult({ gameNumber: 2, winner: "B", classA: "mage", classB: "warrior" }),
      makeGameResult({ gameNumber: 3, winner: "A" }),
      makeGameResult({ gameNumber: 4, winner: "B", classA: "rogue", classB: "paladin" }),
      makeGameResult({ gameNumber: 5, winner: "A", classA: "paladin", classB: "rogue" }),
    ],
    ...overrides,
  };
}

function makeTournamentResult(overrides: Partial<TournamentResult> = {}): TournamentResult {
  const statsA = createModelStats("model-a");
  statsA.elo = 1020;
  statsA.wins = 3;
  statsA.losses = 2;
  statsA.matchesPlayed = 5;
  statsA.totalTurns = 40;
  statsA.totalToolCalls = 25;
  statsA.totalBadActions = 3;

  const statsB = createModelStats("model-b");
  statsB.elo = 980;
  statsB.wins = 2;
  statsB.losses = 3;
  statsB.matchesPlayed = 5;
  statsB.totalTurns = 40;
  statsB.totalToolCalls = 28;
  statsB.totalBadActions = 5;

  return {
    config: {
      models: ["model-a", "model-b"],
      bestOf: 5,
      baseURL: "http://localhost:8008/v1",
      apiKey: "no-key",
      turnDelayMs: 0,
      maxTurns: 30,
      kFactor: 32,
      classes: [["warrior", "mage"]],
      outputDir: "tournament",
    },
    startTime: "2025-01-15T10:00:00.000Z",
    endTime: "2025-01-15T10:30:00.000Z",
    stats: [statsA, statsB],
    matchups: [makeMatchupResult()],
    ...overrides,
  };
}

describe("Tournament Report", () => {
  // ── saveTournamentReport ──

  describe("saveTournamentReport", () => {
    it("creates output directory", () => {
      saveTournamentReport(makeTournamentResult(), TEST_DIR);
      expect(fs.existsSync(TEST_DIR)).toBe(true);
    });

    it("returns paths to all report files", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        expect(fs.existsSync(p)).toBe(true);
      }
    });

    it("creates tournament_summary.md", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const summaryPath = paths.find(p => p.includes("tournament_summary"));
      expect(summaryPath).toBeDefined();
    });

    it("creates matchup report files", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const matchupPath = paths.find(p => p.includes("matchup_"));
      expect(matchupPath).toBeDefined();
    });

    it("generates valid markdown content in summary", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const summaryPath = paths.find(p => p.includes("tournament_summary"))!;
      const content = fs.readFileSync(summaryPath, "utf-8");

      expect(content).toContain("# 🏆 Tournament Summary");
      expect(content).toContain("## 📊 ELO Rankings");
      expect(content).toContain("model-a");
      expect(content).toContain("model-b");
    });

    it("includes ELO rankings in summary", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const summaryPath = paths.find(p => p.includes("tournament_summary"))!;
      const content = fs.readFileSync(summaryPath, "utf-8");

      expect(content).toContain("1020");
      expect(content).toContain("980");
    });

    it("includes matchup matrix in summary", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const summaryPath = paths.find(p => p.includes("tournament_summary"))!;
      const content = fs.readFileSync(summaryPath, "utf-8");

      expect(content).toContain("## 🔄 Matchup Matrix");
    });

    it("includes class performance in summary", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const summaryPath = paths.find(p => p.includes("tournament_summary"))!;
      const content = fs.readFileSync(summaryPath, "utf-8");

      expect(content).toContain("## ⚔️ Class Performance");
    });

    it("includes all matchups in summary", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const summaryPath = paths.find(p => p.includes("tournament_summary"))!;
      const content = fs.readFileSync(summaryPath, "utf-8");

      expect(content).toContain("## 📋 All Matchups");
      expect(content).toContain("model-a vs model-b");
    });
  });

  // ── Matchup report content ──

  describe("matchup report", () => {
    it("includes game-by-game details", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const matchupPath = paths.find(p => p.includes("matchup_"))!;
      const content = fs.readFileSync(matchupPath, "utf-8");

      expect(content).toContain("## Game Details");
      expect(content).toContain("Game 1");
      expect(content).toContain("warrior vs mage");
    });

    it("includes summary table", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const matchupPath = paths.find(p => p.includes("matchup_"))!;
      const content = fs.readFileSync(matchupPath, "utf-8");

      expect(content).toContain("## Summary");
    });

    it("includes aggregate stats", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const matchupPath = paths.find(p => p.includes("matchup_"))!;
      const content = fs.readFileSync(matchupPath, "utf-8");

      expect(content).toContain("## Aggregate Stats");
      expect(content).toContain("Tool Calls");
    });

    it("declares matchup winner", () => {
      const { paths } = saveTournamentReport(makeTournamentResult(), TEST_DIR);
      const matchupPath = paths.find(p => p.includes("matchup_"))!;
      const content = fs.readFileSync(matchupPath, "utf-8");

      expect(content).toContain("wins the matchup");
    });
  });

  // ── Edge cases ──

  describe("edge cases", () => {
    it("handles tournament with draws", () => {
      const result = makeTournamentResult({
        matchups: [makeMatchupResult({
          winsA: 2, winsB: 2, draws: 1,
          games: [
            makeGameResult({ gameNumber: 1, winner: "A" }),
            makeGameResult({ gameNumber: 2, winner: "B" }),
            makeGameResult({ gameNumber: 3, winner: "draw", winningModel: "draw" }),
            makeGameResult({ gameNumber: 4, winner: "A" }),
            makeGameResult({ gameNumber: 5, winner: "B" }),
          ],
        })],
      });

      const { paths } = saveTournamentReport(result, TEST_DIR);
      const summaryPath = paths.find(p => p.includes("tournament_summary"))!;
      const content = fs.readFileSync(summaryPath, "utf-8");
      expect(content).toContain("**Winner**: Draw");
    });

    it("handles heuristic baseline labels", () => {
      const statsH = createModelStats(HEURISTIC_BASELINE, 1000, true);
      const statsM = createModelStats("gpt-4o");
      statsM.elo = 1020;

      const result = makeTournamentResult({
        stats: [statsM, statsH],
        matchups: [makeMatchupResult({
          modelA: "gpt-4o",
          modelB: HEURISTIC_BASELINE,
        })],
      });

      const { paths } = saveTournamentReport(result, TEST_DIR);
      const summaryPath = paths.find(p => p.includes("tournament_summary"))!;
      const content = fs.readFileSync(summaryPath, "utf-8");
      expect(content).toContain("🤖");
    });

    it("handles multiple matchups", () => {
      const statsA = createModelStats("a");
      const statsB = createModelStats("b");
      const statsC = createModelStats("c");

      const result = makeTournamentResult({
        stats: [statsA, statsB, statsC],
        matchups: [
          makeMatchupResult({ modelA: "a", modelB: "b" }),
          makeMatchupResult({ modelA: "a", modelB: "c" }),
          makeMatchupResult({ modelA: "b", modelB: "c" }),
        ],
      });

      const { paths } = saveTournamentReport(result, TEST_DIR);
      expect(paths.filter(p => p.includes("matchup_"))).toHaveLength(3);
    });

    it("sanitizes model names in filenames", () => {
      const result = makeTournamentResult({
        matchups: [makeMatchupResult({
          modelA: "gpt-4o-mini-2024/guidance",
          modelB: "llama@3.1:70b",
        })],
      });

      const { paths } = saveTournamentReport(result, TEST_DIR);
      const matchupPath = paths.find(p => p.includes("matchup_"))!;
      // Filename should have special chars replaced
      expect(matchupPath).not.toContain("@");
    });
  });
});
