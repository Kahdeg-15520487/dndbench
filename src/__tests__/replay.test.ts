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

  it("renders thinking steps in replay", () => {
    const w = createCharacter("unit1", "Alice", "warrior", undefined, "red");
    const m = createCharacter("unit2", "Bob", "mage", undefined, "blue");
    const log: BattleLog = {
      turns: [{
        turnNumber: 1,
        actorId: "unit2",
        results: [{
          action: { type: "cast_spell", actorId: "unit2", targetId: "unit1", spellId: "fire_bolt" },
          actorId: "unit2",
          targetId: "unit1",
          narrative: "Bob casts Fire Bolt at Alice for 8 damage!",
        }],
        stateSnapshot: {
          characters: [
            { id: "unit1", name: "Alice", team: "red", class: "warrior", level: 5, hp: 40, maxHp: 55, ac: 16, speed: 30, position: { x: 10, y: 30 }, statusEffects: [], spellSlots: {}, inventory: [], isDefending: false } as any,
            { id: "unit2", name: "Bob", team: "blue", class: "mage", level: 5, hp: 24, maxHp: 24, ac: 12, speed: 30, position: { x: 90, y: 30 }, statusEffects: [], spellSlots: {}, inventory: [], isDefending: false } as any,
          ],
          turnNumber: 1, phase: "action" as any, arena: { width: 100, height: 100, label: "Medium" },
        },
        thinkingSteps: [
          { type: "thinking", text: "I should attack the warrior" },
          { type: "tool_call", toolName: "attack", text: "", toolParams: { target: "unit1" } },
          { type: "tool_result", toolName: "attack", text: "Hit for 8 damage" },
        ],
      }],
      totalTurns: 1,
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2026-01-01T00:01:00Z",
      winner: "unit2",
      arena: { label: "Medium", width: 100, height: 100 },
    };
    const agents = [new HeuristicAgent("unit1", "Alice"), new HeuristicAgent("unit2", "Bob")];
    const path = saveReplay(log, [w, m], agents, REPLAY_DIR);
    const content = fs.readFileSync(path, "utf-8");
    expect(content).toContain("Thinking process");
    expect(content).toContain("🔧 attack");
    expect(content).toContain("I should attack");
  });
});
