// ─────────────────────────────────────────────────────────
//  Full Tournament Pipeline Tests (heuristic-vs-heuristic)
// ─────────────────────────────────────────────────────────
//
//  Uses the agentFactory override to run actual games with
//  HeuristicAgent — no LLM needed. Tests the complete
//  tournament → report → ELO pipeline.
// ─────────────────────────────────────────────────────────

import { describe, it, expect, afterEach } from "vitest";
import { TournamentRunner, HEURISTIC_BASELINE, type TournamentEvent } from "../arena/tournament.js";
import { HeuristicAgent } from "../agent/heuristic-agent.js";
import type { IAgent } from "../agent/interface.js";
import { saveTournamentReport } from "../arena/tournament-report.js";
import { markdownToHtml } from "../arena/report-viewer.js";
import fs from "fs";
import path from "path";

const TEST_DIR = path.join(process.cwd(), "test-pipeline-reports");

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// Factory that always returns HeuristicAgent regardless of model name
function heuristicFactory(_model: string, id: string, name: string): IAgent {
  return new HeuristicAgent(id, name);
}

describe("Tournament Pipeline (heuristic-only)", () => {
  it("runs a 2-model tournament with agentFactory", async () => {
    const events: TournamentEvent[] = [];

    const runner = new TournamentRunner({
      models: ["fake-model-a", "fake-model-b"],
      bestOf: 3,
      turnDelayMs: 0,
      maxTurns: 20,
      outputDir: TEST_DIR,
      agentFactory: heuristicFactory,
    });

    runner.onEvent((e) => events.push(e));
    const result = await runner.run();

    // ── Event sequence ──
    const types = events.map(e => e.type);
    expect(types[0]).toBe("tournament_start");
    expect(types[types.length - 1]).toBe("tournament_end");
    expect(types).toContain("matchup_start");
    expect(types).toContain("game_start");
    expect(types).toContain("game_end");
    expect(types).toContain("matchup_end");

    // ── Tournament result ──
    expect(result.stats).toHaveLength(2);
    expect(result.matchups).toHaveLength(1);
    expect(result.stats.reduce((s, st) => s + st.matchesPlayed, 0)).toBe(6); // 3 games * 2 models
  }, 30000);

  it("runs a 3-model round-robin (3 matchups)", async () => {
    const runner = new TournamentRunner({
      models: ["a", "b", "c"],
      bestOf: 1,
      turnDelayMs: 0,
      maxTurns: 15,
      outputDir: TEST_DIR,
      agentFactory: heuristicFactory,
    });

    const result = await runner.run();

    // C(3,2) = 3 matchups
    expect(result.matchups).toHaveLength(3);
    expect(result.stats).toHaveLength(3);

    // Every model plays 2 games (against the other 2)
    for (const s of result.stats) {
      expect(s.matchesPlayed).toBe(2);
    }
  }, 30000);

  it("tracks ELO changes after games", async () => {
    const runner = new TournamentRunner({
      models: ["model-a", "model-b"],
      bestOf: 5,
      turnDelayMs: 0,
      maxTurns: 20,
      outputDir: TEST_DIR,
      agentFactory: heuristicFactory,
    });

    const result = await runner.run();

    // ELOs should have changed from initial 1000
    const elos = result.stats.map(s => s.elo);
    // At least one should be different from 1000
    expect(elos.some(e => e !== 1000)).toBe(true);
  }, 30000);

  it("emits correct ELO updates in game_end events", async () => {
    const gameEndEvents: TournamentEvent[] = [];

    const runner = new TournamentRunner({
      models: ["a", "b"],
      bestOf: 2,
      turnDelayMs: 0,
      maxTurns: 15,
      outputDir: TEST_DIR,
      agentFactory: heuristicFactory,
    });

    runner.onEvent((e) => {
      if (e.type === "game_end") gameEndEvents.push(e);
    });

    await runner.run();

    // Should have 2 game_end events
    expect(gameEndEvents).toHaveLength(2);

    // Each should have ELO data
    for (const e of gameEndEvents) {
      if (e.type === "game_end") {
        expect(typeof e.eloA).toBe("number");
        expect(typeof e.eloB).toBe("number");
        expect(e.game).toBeDefined();
        expect(e.game.winner).toBeDefined();
        expect(e.game.turns).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it("emits turn events with narratives during games", async () => {
    const runner = new TournamentRunner({
      models: ["x", "y"],
      bestOf: 1,
      maxTurns: 10,
      turnDelayMs: 0,
      kFactor: 32,
      outputDir: "test-reports",
      agentFactory: heuristicFactory,
    });

    const turnEvents: any[] = [];
    runner.onEvent(e => {
      if (e.type === "turn") turnEvents.push(e);
    });

    await runner.run();
    expect(turnEvents.length).toBeGreaterThan(0);
    // Each turn event should have a narrative
    for (const t of turnEvents) {
      expect(t.narrative).toBeTruthy();
      expect(typeof t.narrative).toBe("string");
      expect(t.gameNum).toBe(1);
      expect(t.turnNumber).toBeGreaterThan(0);
      expect(t.hpA).toBeGreaterThanOrEqual(0);
      expect(t.hpB).toBeGreaterThanOrEqual(0);
    }
  }, 30000);

  it("includes turnLog in game results", async () => {
    const runner = new TournamentRunner({
      models: ["x", "y"],
      bestOf: 1,
      maxTurns: 10,
      turnDelayMs: 0,
      kFactor: 32,
      outputDir: "test-reports",
      agentFactory: heuristicFactory,
    });

    const result = await runner.run();
    expect(result.matchups.length).toBe(1);
    const game = result.matchups[0].games[0];
    expect(game.turnLog).toBeDefined();
    expect(game.turnLog!.length).toBeGreaterThan(0);
    const entry = game.turnLog![0];
    expect(entry.turnNumber).toBeGreaterThan(0);
    expect(entry.actorId).toBeTruthy();
    expect(entry.narrative).toBeTruthy();
    expect(entry.hpA).toBeGreaterThanOrEqual(0);
    expect(entry.hpB).toBeGreaterThanOrEqual(0);
    expect(entry.maxHpA).toBeGreaterThan(0);
    expect(entry.maxHpB).toBeGreaterThan(0);
    expect(entry.actorName).toBeTruthy();
  }, 30000);

  it("produces valid report files", async () => {
    const runner = new TournamentRunner({
      models: ["a", "b"],
      bestOf: 1,
      turnDelayMs: 0,
      maxTurns: 15,
      outputDir: TEST_DIR,
      agentFactory: heuristicFactory,
    });

    const result = await runner.run();
    const { paths } = saveTournamentReport(result, TEST_DIR);

    // Should produce matchup report + summary + JSON data
    expect(paths.length).toBe(3);
    for (const p of paths) {
      expect(fs.existsSync(p)).toBe(true);
      const content = fs.readFileSync(p, "utf-8");
      expect(content.length).toBeGreaterThan(100);
    }

    // Summary should contain ELO rankings
    const summary = paths.find(p => p.includes("tournament_summary"))!;
    const content = fs.readFileSync(summary, "utf-8");
    expect(content).toContain("ELO Rankings");
  }, 30000);

  it("handles model with heuristic baseline included", async () => {
    const runner = new TournamentRunner({
      models: ["llm-model", "heuristic-baseline"],
      bestOf: 1,
      turnDelayMs: 0,
      maxTurns: 15,
      outputDir: TEST_DIR,
      agentFactory: heuristicFactory,
    });

    const result = await runner.run();

    // 2 participants = 1 matchup
    expect(result.stats).toHaveLength(2);
    expect(result.matchups).toHaveLength(1);

    const names = result.stats.map(s => s.model);
    expect(names).toContain("llm-model");
    expect(names).toContain(HEURISTIC_BASELINE);

    // Heuristic baseline should be flagged
    const h = result.stats.find(s => s.model === HEURISTIC_BASELINE)!;
    expect(h.isHeuristic).toBe(true);
  }, 30000);

  it("game results have valid winner field", async () => {
    const runner = new TournamentRunner({
      models: ["a", "b"],
      bestOf: 3,
      turnDelayMs: 0,
      maxTurns: 15,
      outputDir: TEST_DIR,
      agentFactory: heuristicFactory,
    });

    const result = await runner.run();

    for (const matchup of result.matchups) {
      expect(matchup.winsA + matchup.winsB + matchup.draws).toBe(3);
      for (const game of matchup.games) {
        expect(["A", "B", "draw"]).toContain(game.winner);
        expect(typeof game.turns).toBe("number");
        expect(game.turns).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it("class rotation works correctly", async () => {
    const runner = new TournamentRunner({
      models: ["a", "b"],
      bestOf: 5,
      turnDelayMs: 0,
      maxTurns: 15,
      outputDir: TEST_DIR,
      agentFactory: heuristicFactory,
    });

    const result = await runner.run();
    const matchup = result.matchups[0];
    const classPairs = matchup.games.map(g => [g.classA, g.classB] as [string, string]);

    // Default rotation: warrior/mage → mage/warrior → rogue/paladin → paladin/rogue → warrior/mage
    expect(classPairs[0]).toEqual(["warrior", "mage"]);
    expect(classPairs[1]).toEqual(["mage", "warrior"]);
    expect(classPairs[2]).toEqual(["rogue", "paladin"]);
    expect(classPairs[3]).toEqual(["paladin", "rogue"]);
    expect(classPairs[4]).toEqual(["warrior", "mage"]);
  }, 30000);

  it("respects initialElos config — ELO starts from custom values", async () => {
    const dir = TEST_DIR + "/init-elo-test";
    const runner = new TournamentRunner({
      models: ["Alpha", "Beta"],
      bestOf: 1,
      turnDelayMs: 0,
      maxTurns: 5,
      outputDir: dir,
      agentFactory: heuristicFactory,
      initialElos: { Alpha: 1200, Beta: 800 },
    });

    const events: TournamentEvent[] = [];
    runner.onEvent((e) => events.push(e));
    const result = await runner.run();

    // The first game_end event should show ELOs starting from the initial values
    const gameEnd = events.find(e => e.type === "game_end");
    if (gameEnd && gameEnd.type === "game_end") {
      // Alpha should be around 1200 area, Beta around 800
      // After 1 game, ELOs shift by ~32, so Alpha ~ 1232/1168, Beta ~ 832/768
      expect(gameEnd.eloA).toBeGreaterThan(1100);
      expect(gameEnd.eloB).toBeLessThan(900);
    }

    // The final stats should reflect the initial ELOs as a starting point
    const alphaStats = result.stats.find(s => s.model === "Alpha");
    const betaStats = result.stats.find(s => s.model === "Beta");
    expect(alphaStats).toBeDefined();
    expect(betaStats).toBeDefined();
    expect(alphaStats!.elo).toBeGreaterThan(1150);
    expect(betaStats!.elo).toBeLessThan(850);
  }, 30000);

  it("recovers from game errors gracefully", async () => {
    let callCount = 0;
    const failingFactory = (_m: string, id: string, name: string) => {
      callCount++;
      const agent = new HeuristicAgent(id, name);
      if (callCount === 1) {
        // Make getAction throw for the first agent — simulates LLM timeout
        agent.getAction = async () => {
          throw new Error("Simulated LLM timeout");
        };
      }
      return agent;
    };

    const runner = new TournamentRunner({
      models: ["Alpha", "Beta"],
      bestOf: 1,
      turnDelayMs: 0,
      maxTurns: 5,
      outputDir: TEST_DIR + "/error-test",
      agentFactory: failingFactory,
    });

    // Should not throw even if a game errors
    const result = await runner.run();
    expect(result).toBeDefined();
    expect(result.matchups.length).toBeGreaterThan(0);
    // Game should still have been recorded (as draw on error)
    const game = result.matchups[0].games[0];
    expect(game).toBeDefined();
    expect(game.error).toBeDefined();
    expect(game.error).toContain("Simulated LLM timeout");
  }, 30000);

  it("full pipeline: tournament → report → HTML export", async () => {
    const outputDir = TEST_DIR + "/pipeline-full";
    const runner = new TournamentRunner({
      models: ["Alpha", "Beta"],
      bestOf: 3,
      turnDelayMs: 0,
      maxTurns: 10,
      outputDir,
      agentFactory: heuristicFactory,
    });

    // 1. Run tournament
    const result = await runner.run();
    expect(result).toBeDefined();
    expect(result.matchups.length).toBe(1); // 2 models = 1 matchup
    expect(result.stats.length).toBe(2);
    expect(result.startTime).toBeTruthy();
    expect(result.endTime).toBeTruthy();

    // Verify duration tracking
    for (const matchup of result.matchups) {
      for (const game of matchup.games) {
        expect(game.durationMs).toBeDefined();
        expect(game.durationMs!).toBeGreaterThanOrEqual(0);
      }
    }

    // 2. Generate report
    const reportDir = outputDir;
    fs.mkdirSync(reportDir, { recursive: true });
    const { paths: reportFiles } = saveTournamentReport(result, reportDir);
    expect(reportFiles.length).toBeGreaterThan(0);

    // Verify report files exist on disk
    for (const rf of reportFiles) {
      expect(fs.existsSync(rf)).toBe(true);
      const content = fs.readFileSync(rf, "utf-8");
      expect(content.length).toBeGreaterThan(100);

      // Skip JSON data file for HTML conversion
      if (rf.endsWith(".json")) continue;

      // 3. Convert to HTML
      const html = markdownToHtml(content);
      expect(html).toContain("<"); // should be HTML, not raw markdown
      expect(html.length).toBeGreaterThan(content.length); // HTML wrapper adds tags
    }

    // 4. Verify report content has key sections
    const summaryReport = fs.readFileSync(reportFiles.find(p => p.includes("tournament_summary"))!, "utf-8");
    expect(summaryReport).toContain("ELO Rankings");
    expect(summaryReport).toContain("Matchup");

    // 5. Verify ELO stats are sorted (highest first)
    const sortedStats = [...result.stats].sort((a, b) => b.elo - a.elo);
    expect(result.stats[0].elo).toBe(sortedStats[0].elo);
  }, 30000);

  it("recovers from matchup-level errors", async () => {
    // Factory that throws on game 2+ (after first game succeeds)
    let agentCount = 0;
    const crashFactory = (_m: string, id: string, name: string) => {
      agentCount++;
      const agent = new HeuristicAgent(id, name);
      const origRun = agent.getAction.bind(agent);
      // Agent 1 of game 2+ throws
      if (agentCount > 2) {
        agent.getAction = async () => {
          throw new Error("Matchup crash");
        };
      } else {
        agent.getAction = origRun;
      }
      return agent;
    };

    const runner = new TournamentRunner({
      models: ["Alpha", "Beta"],
      bestOf: 3,
      turnDelayMs: 0,
      maxTurns: 3,
      outputDir: TEST_DIR + "/matchup-error-test",
      agentFactory: crashFactory,
    });

    const result = await runner.run();
    expect(result).toBeDefined();
    // Should have at least 1 matchup
    expect(result.matchups.length).toBe(1);
    // First game should succeed, later ones may error
    expect(result.matchups[0].games.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it("abort stops tournament between matchups", async () => {
    // Use 4 models = 6 matchups. Abort after the first matchup ends.
    const events: TournamentEvent[] = [];
    let matchupCount = 0;

    const runner = new TournamentRunner({
      models: ["A", "B", "C", "D"],
      bestOf: 1,
      turnDelayMs: 0,
      maxTurns: 3,
      outputDir: TEST_DIR + "/abort-test",
      agentFactory: heuristicFactory,
    });

    runner.onEvent((e) => {
      events.push(e);
      if (e.type === "matchup_end") {
        matchupCount++;
        if (matchupCount === 1) {
          runner.abort();
        }
      }
    });

    const result = await runner.run();
    // Tournament should have stopped early
    expect(result).toBeDefined();
    // Should have fewer matchups than the full 6
    expect(result.matchups.length).toBeLessThan(6);
    expect(result.matchups.length).toBeGreaterThanOrEqual(1);
    // Should have emitted tournament_aborted event
    expect(events.some(e => e.type === "tournament_aborted")).toBe(true);
  }, 30000);
});
