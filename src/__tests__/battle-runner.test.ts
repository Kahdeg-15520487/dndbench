import { describe, it, expect, vi } from "vitest";
import { createCharacter } from "../engine/characters.js";
import { createBoss } from "../engine/bosses.js";
import { BattleRunner, BattleEvent } from "../arena/battle-runner.js";
import { ARENA_PRESETS } from "../engine/types.js";
import { HeuristicAgent } from "../agent/heuristic-agent.js";

describe("BattleRunner", () => {
  it("runs a 1v1 battle to completion", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage],
      [agentW, agentM],
      { turnDelayMs: 0, arena: ARENA_PRESETS.medium, maxTurns: 50 },
    );

    const log = await runner.run();
    expect(log.totalTurns).toBeGreaterThan(0);
    expect(log.winner).toBeDefined();
    expect(log.turns.length).toBeGreaterThan(0);
    expect(log.endTime).toBeDefined();
  });

  it("emits battle_start and battle_end events", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage],
      [agentW, agentM],
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.medium,
        maxTurns: 50,
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();

    expect(events.find(e => e.type === "battle_start")).toBeDefined();
    expect(events.find(e => e.type === "battle_end")).toBeDefined();
  });

  it("emits character_defeated when someone dies", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage],
      [agentW, agentM],
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.medium,
        maxTurns: 50,
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();

    const defeated = events.filter(e => e.type === "character_defeated");
    expect(defeated.length).toBeGreaterThanOrEqual(1);
  });

  it("2v2 battle produces a winner", async () => {
    const chars = [
      createCharacter("w1", "Alpha", "warrior", { x: 10, y: 20 }, "red"),
      createCharacter("m1", "Beta", "mage", { x: 10, y: 40 }, "red"),
      createCharacter("r1", "Gamma", "rogue", { x: 90, y: 20 }, "blue"),
      createCharacter("p1", "Delta", "paladin", { x: 90, y: 40 }, "blue"),
    ];
    const agents = chars.map(c => new HeuristicAgent(c.id, c.name));

    const runner = new BattleRunner(chars, agents, {
      turnDelayMs: 0,
      arena: ARENA_PRESETS.large,
      maxTurns: 100,
    });

    const log = await runner.run();
    expect(log.winner).toBeDefined();
    expect(log.totalTurns).toBeGreaterThan(0);
  });

  it("win condition: last_unit_standing (FFA)", async () => {
    const chars = [
      createCharacter("a", "Fighter", "warrior", { x: 10, y: 20 }, "red"),
      createCharacter("b", "Wizard", "mage", { x: 90, y: 20 }, "blue"),
      createCharacter("c", "Thief", "rogue", { x: 50, y: 10 }, "green"),
    ];
    const agents = chars.map(c => new HeuristicAgent(c.id, c.name));

    const runner = new BattleRunner(chars, agents, {
      turnDelayMs: 0,
      arena: ARENA_PRESETS.medium,
      maxTurns: 100,
      winCondition: "last_unit_standing",
    });

    const log = await runner.run();
    // With FFA and friendly fire, one should eventually win
    expect(log.winner).toBeDefined();
  });

  it("respects maxTurns limit", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");

    const runner = new BattleRunner(
      [warrior, mage],
      [agentW, agentM],
      { turnDelayMs: 0, arena: ARENA_PRESETS.medium, maxTurns: 3 },
    );

    const log = await runner.run();
    expect(log.totalTurns).toBeLessThanOrEqual(3);
  });

  it("places characters in default positions when (0,0)", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior"); // pos = (0,0)
    const mage = createCharacter("m1", "Beta", "mage"); // pos = (0,0)
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage],
      [agentW, agentM],
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.medium,
        maxTurns: 5,
        eventHandler: (e) => events.push(e),
      },
    );

    // After construction, positions should be set
    expect(warrior.position.x).not.toBe(0);
    expect(mage.position.x).not.toBe(0);
  });
});
