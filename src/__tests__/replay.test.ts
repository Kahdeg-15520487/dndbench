// ─────────────────────────────────────────────────────────
//  Replay Tests
// ─────────────────────────────────────────────────────────

import { describe, it, expect, afterAll } from "vitest";
import { saveReplay } from "../arena/replay.js";
import { createCharacter } from "../engine/characters.js";
import type { BattleLog } from "../engine/types.js";
import { HeuristicAgent } from "../agent/heuristic-agent.js";
import { BattleRunner } from "../arena/battle-runner.js";
import fs from "fs";

const REPLAY_DIR = "test-replays";

afterAll(() => {
  // Clean up test replays
  if (fs.existsSync(REPLAY_DIR)) {
    fs.rmSync(REPLAY_DIR, { recursive: true });
  }
});

function makeSimpleLog(overrides?: Partial<BattleLog>): BattleLog {
  return {
    turns: [],
    totalTurns: 3,
    startTime: "2026-01-01T00:00:00Z",
    endTime: "2026-01-01T00:01:00Z",
    winner: "unit1",
    arena: { label: "Medium", width: 100, height: 100 },
    ...overrides,
  };
}

describe("Replay", () => {
  it("saves a markdown replay file", () => {
    const w = createCharacter("unit1", "Alice", "warrior", undefined, "red");
    const m = createCharacter("unit2", "Bob", "mage", undefined, "blue");
    const log = makeSimpleLog();

    const agents = [
      new HeuristicAgent("unit1", "Alice"),
      new HeuristicAgent("unit2", "Bob"),
    ];

    const filePath = saveReplay(log, [w, m], agents, REPLAY_DIR);

    expect(fs.existsSync(filePath)).toBe(true);
    const md = fs.readFileSync(filePath, "utf-8");
    expect(md).toContain("Alice (warrior) vs Bob (mage)");
    expect(md).toContain("Winner");
    expect(md).toContain("Turns");
    expect(md).toContain("Medium");
  });

  it("includes turn actions in the replay", async () => {
    const w = createCharacter("unit1", "Alpha", "warrior", undefined, "red");
    const m = createCharacter("unit2", "Beta", "mage", undefined, "blue");

    // Use the actual BattleRunner to get a real log with proper snapshot format
    const runner = new BattleRunner(
      [w, m],
      [new HeuristicAgent("unit1", "Alpha"), new HeuristicAgent("unit2", "Beta")],
      { maxTurns: 2 },
    );
    const log = await runner.run();

    const agents = [
      new HeuristicAgent("unit1", "Alpha"),
      new HeuristicAgent("unit2", "Beta"),
    ];

    const filePath = saveReplay(log, [w, m], agents, REPLAY_DIR);
    const md = fs.readFileSync(filePath, "utf-8");

    // Should have at least some turn content
    expect(md).toContain("Turn 1");
    expect(md).toContain("Alpha");
    expect(md).toContain("Beta");
  });

  it("handles draw (no winner)", () => {
    const w = createCharacter("unit1", "X", "warrior", undefined, "red");
    const m = createCharacter("unit2", "Y", "mage", undefined, "blue");
    const log = makeSimpleLog({ winner: undefined });

    const agents = [
      new HeuristicAgent("unit1", "X"),
      new HeuristicAgent("unit2", "Y"),
    ];

    const filePath = saveReplay(log, [w, m], agents, REPLAY_DIR);
    const md = fs.readFileSync(filePath, "utf-8");

    expect(md).toContain("Draw");
  });

  it("generates unique filenames", () => {
    const w = createCharacter("unit1", "A", "warrior", undefined, "red");
    const m = createCharacter("unit2", "B", "mage", undefined, "blue");
    const log1 = makeSimpleLog({ startTime: "2026-01-01T00:00:00Z" });
    const log2 = makeSimpleLog({ startTime: "2026-01-01T00:01:00Z" });

    const agents = [
      new HeuristicAgent("unit1", "A"),
      new HeuristicAgent("unit2", "B"),
    ];

    const path1 = saveReplay(log1, [w, m], agents, REPLAY_DIR);
    const path2 = saveReplay(log2, [w, m], agents, REPLAY_DIR);

    expect(path1).not.toBe(path2);
  });
});
