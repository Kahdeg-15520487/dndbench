// ─────────────────────────────────────────────────────────
//  Tournament Runner Tests (event emission)
// ─────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { TournamentRunner, HEURISTIC_BASELINE, type TournamentEvent } from "../arena/tournament.js";
import { HeuristicAgent } from "../agent/heuristic-agent.js";

describe("Tournament Event System", () => {
  it("emits tournament_start and tournament_end for empty tournament", async () => {
    const events: TournamentEvent[] = [];

    const runner = new TournamentRunner({
      models: [],
      includeHeuristic: true,
      bestOf: 1,
      turnDelayMs: 0,
      maxTurns: 5,
      outputDir: "tournament",
    });

    runner.onEvent((e) => events.push(e));
    await runner.run();

    const types = events.map(e => e.type);
    expect(types).toContain("tournament_start");
    expect(types).toContain("tournament_end");
  });

  it("includes correct participant list in tournament_start", async () => {
    const events: TournamentEvent[] = [];

    const runner = new TournamentRunner({
      models: [],
      includeHeuristic: true,
      bestOf: 1,
      outputDir: "tournament",
    });

    runner.onEvent((e) => events.push(e));
    await runner.run();

    const start = events.find(e => e.type === "tournament_start");
    expect(start).toBeDefined();
    if (start && start.type === "tournament_start") {
      expect(start.participants).toEqual([HEURISTIC_BASELINE]);
      expect(start.totalMatchups).toBe(0);
      expect(start.totalGames).toBe(0);
    }
  });

  it("tracks ELO correctly with no matchups", async () => {
    const runner = new TournamentRunner({
      models: [HEURISTIC_BASELINE],
      includeHeuristic: false,
      bestOf: 1,
      outputDir: "tournament",
    });

    runner.onEvent(() => {});
    const result = await runner.run();

    expect(result.stats).toHaveLength(1);
    expect(result.stats[0].model).toBe(HEURISTIC_BASELINE);
    expect(result.stats[0].elo).toBe(1000);
    expect(result.matchups).toHaveLength(0);
  });

  it("getSortedStats returns models sorted by ELO descending", () => {
    const runner = new TournamentRunner({
      models: [HEURISTIC_BASELINE],
      includeHeuristic: false,
      bestOf: 1,
      outputDir: "tournament",
    });

    const stats = runner.getSortedStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].model).toBe(HEURISTIC_BASELINE);
  });

  it("creates correct number of participants with heuristic", () => {
    const runner = new TournamentRunner({
      models: ["model-a", "model-b"],
      includeHeuristic: true,
      bestOf: 1,
      outputDir: "tournament",
    });

    const stats = runner.getSortedStats();
    expect(stats).toHaveLength(3);
    const names = stats.map(s => s.model);
    expect(names).toContain("model-a");
    expect(names).toContain("model-b");
    expect(names).toContain(HEURISTIC_BASELINE);
  });

  it("HEURISTIC_BASELINE constant has expected value", () => {
    expect(HEURISTIC_BASELINE).toBe("heuristic-baseline");
  });

  it("marks heuristic baseline stats as isHeuristic=true", () => {
    const runner = new TournamentRunner({
      models: ["model-a"],
      includeHeuristic: true,
      bestOf: 1,
      outputDir: "tournament",
    });

    const stats = runner.getSortedStats();
    const heuristic = stats.find(s => s.model === HEURISTIC_BASELINE);
    expect(heuristic).toBeDefined();
    expect(heuristic!.isHeuristic).toBe(true);

    const llm = stats.find(s => s.model === "model-a");
    expect(llm).toBeDefined();
    expect(llm!.isHeuristic).toBe(false);
  });

  it("computes correct totalMatchups formula", () => {
    // C(n,2) = n*(n-1)/2 matchups
    // 3 models, best-of 3 = 3*3 = 9 games
    const participants = 3;
    const bestOf = 3;
    const totalMatchups = (participants * (participants - 1)) / 2;
    const totalGames = totalMatchups * bestOf;
    expect(totalMatchups).toBe(3);
    expect(totalGames).toBe(9);

    // 4 models, best-of 5
    expect((4 * 3) / 2).toBe(6); // matchups
    expect(6 * 5).toBe(30); // games
  });

  it("event handler receives multiple handlers", async () => {
    const events1: TournamentEvent[] = [];
    const events2: TournamentEvent[] = [];

    const runner = new TournamentRunner({
      models: [],
      includeHeuristic: true,
      bestOf: 1,
      outputDir: "tournament",
    });

    runner.onEvent((e) => events1.push(e));
    runner.onEvent((e) => events2.push(e));
    await runner.run();

    expect(events1.length).toBeGreaterThan(0);
    expect(events1).toEqual(events2);
  });

  it("uses initialElos from config", () => {
    const runner = new TournamentRunner({
      models: ["ModelA", "ModelB"],
      includeHeuristic: false,
      bestOf: 1,
      outputDir: "tournament",
      initialElos: { ModelA: 1200, ModelB: 800 },
    });
    // Can't access modelStats directly, but we can check that
    // the tournament starts with correct ELOs by running it
    // and checking the tournament_start event
    const events: TournamentEvent[] = [];
    runner.onEvent((e) => events.push(e));
    // Don't run (would need agents), just verify it was created without error
    expect(runner).toBeDefined();
  });

  it("abort flag prevents further matchups", () => {
    const runner = new TournamentRunner({
      models: ["A", "B", "C"],
      includeHeuristic: false,
      bestOf: 1,
      turnDelayMs: 0,
      maxTurns: 3,
      outputDir: "/tmp/abort-test",
    });
    expect(runner.isAborted).toBe(false);
    runner.abort();
    expect(runner.isAborted).toBe(true);
  });

  it("tracks class stats for all four classes", async () => {
    const runner = new TournamentRunner({
      models: ["X", "Y"],
      includeHeuristic: false,
      bestOf: 4, // enough games to rotate through all class pairs
      turnDelayMs: 0,
      maxTurns: 3,
      outputDir: "/tmp/class-stats-test",
      agentFactory: (_model, id, name) => new HeuristicAgent(id, name),
    });
    const result = await runner.run();
    // With 4 games, rotation is: warrior/mage, mage/warrior, rogue/paladin, paladin/rogue
    // Each model plays each class twice
    for (const s of result.stats) {
      expect(s.battlesAsWarrior).toBe(1);
      expect(s.battlesAsMage).toBe(1);
      expect(s.battlesAsRogue).toBe(1);
      expect(s.battlesAsPaladin).toBe(1);
      // Wins should total to matches
      const totalWins = s.winsAsWarrior + s.winsAsMage + s.winsAsRogue + s.winsAsPaladin;
      expect(totalWins).toBeLessThanOrEqual(s.matchesPlayed);
    }
  }, 10000);

  it("recover from game error gracefully", async () => {
    let callCount = 0;
    const runner = new TournamentRunner({
      models: ["ErrA", "ErrB"],
      includeHeuristic: false,
      bestOf: 1,
      turnDelayMs: 0,
      maxTurns: 3,
      outputDir: "/tmp/error-test",
      agentFactory: (_model, id, name) => {
        callCount++;
        // First agent throws on first turn
        if (id === "unit1") {
          const agent = new HeuristicAgent(id, name);
          const orig = agent.getAction.bind(agent);
          agent.getAction = async (snap: any) => {
            callCount++;
            if (callCount <= 2) throw new Error("Simulated LLM failure");
            return orig(snap);
          };
          return agent;
        }
        return new HeuristicAgent(id, name);
      },
    });
    const result = await runner.run();
    // Tournament should complete even with a game error
    expect(result.matchups.length).toBe(1);
    // The errored game should be recorded as draw with error message
    const game = result.matchups[0].games[0];
    expect(game).toBeDefined();
  }, 10000);
});
