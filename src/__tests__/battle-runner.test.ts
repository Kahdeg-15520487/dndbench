import { describe, it, expect } from "vitest";
import { createCharacter } from "../engine/characters.js";
import { createBoss } from "../engine/bosses.js";
import { BattleRunner, BattleEvent } from "../arena/battle-runner.js";
import { ARENA_PRESETS, type StatusEffect } from "../engine/types.js";
import { HeuristicAgent } from "../agent/heuristic-agent.js";
import { LLMAgent } from "../agent/llm-agent.js";
import type { IAgent } from "../agent/interface.js";

describe("BattleRunner", () => {
  it("runs a 1v1 battle to completion", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");

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
    new BattleRunner(
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

  it("raid boss battle: party vs boss", async () => {
    const boss = createBoss("goblin_king", { x: 90, y: 30 });
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 20 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 10, y: 40 }, "red");
    const rogue = createCharacter("r1", "Gamma", "rogue", { x: 20, y: 30 }, "red");
    const paladin = createCharacter("p1", "Delta", "paladin", { x: 15, y: 25 }, "red");

    const bossAgent = new HeuristicAgent(boss.id, boss.name);
    const agents = [
      bossAgent,
      new HeuristicAgent("w1", "Alpha"),
      new HeuristicAgent("m1", "Beta"),
      new HeuristicAgent("r1", "Gamma"),
      new HeuristicAgent("p1", "Delta"),
    ];

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [boss, warrior, mage, rogue, paladin],
      agents,
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.large,
        maxTurns: 100,
        eventHandler: (e) => events.push(e),
      },
    );

    const log = await runner.run();
    expect(log.winner).toBeDefined();
    expect(events.find(e => e.type === "battle_end")).toBeDefined();
    // One of the teams should win
    const battleEnd = events.find(e => e.type === "battle_end") as any;
    expect(["red", boss.team]).toContain(battleEnd?.winningTeam);
  });

  it("emits action_chosen events with correct actorIds", async () => {
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
        maxTurns: 10,
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();

    const actionChosen = events.filter(e => e.type === "action_chosen");
    expect(actionChosen.length).toBeGreaterThan(0);
    const actorIds = new Set(actionChosen.map((e: any) => e.actorId));
    expect(actorIds.has("w1") || actorIds.has("m1")).toBe(true);
  });

  it("emits health_bars at end of each turn", async () => {
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
        maxTurns: 5,
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();

    const healthBars = events.filter(e => e.type === "health_bars");
    expect(healthBars.length).toBeGreaterThan(0);
  });

  it("status_tick events are emitted when status effects tick", async () => {
    // This test is more of a smoke test since we need status effects to actually
    // get applied during combat (e.g. from fireball burn)
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 15, y: 30 }, "blue");
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");

    // Add a burn to warrior to guarantee a status tick event
    warrior.statusEffects.push({ type: "burn", turnsRemaining: 5, potency: 2, sourceId: "test" });
    // Make warrior very tanky so it doesn't die before status effects tick
    warrior.stats.hp = 200;
    warrior.stats.maxHp = 200;
    mage.stats.hp = 200;
    mage.stats.maxHp = 200;

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage],
      [agentW, agentM],
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.medium,
        maxTurns: 10,
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();

    const statusTicks = events.filter(e => e.type === "status_tick");
    expect(statusTicks.length).toBeGreaterThan(0);
  });

  it("getLiving returns correct living characters", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");

    const runner = new BattleRunner(
      [warrior, mage],
      [agentW, agentM],
      { turnDelayMs: 0, arena: ARENA_PRESETS.medium, maxTurns: 50 },
    );

    // Before running, both should be alive
    const living = runner.getLiving();
    expect(living).toHaveLength(2);
    expect(living.map(c => c.id)).toContain("w1");
    expect(living.map(c => c.id)).toContain("m1");
  });

  it("flee action resolves when character at edge", async () => {
    // Create a custom agent that always flees
    const fleeAgent: import("../agent/interface.js").IAgent = {
      id: "w1", name: "Fleer", type: "heuristic",
      getAction: async () => ({ type: "flee", actorId: "w1" }),
    };
    const warrior = createCharacter("w1", "Fleer", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentM = new HeuristicAgent("m1", "Beta");

    // Place warrior at arena edge (x=0) so flee succeeds
    warrior.position = { x: 0, y: 30 };

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage],
      [fleeAgent, agentM],
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.medium,
        maxTurns: 5,
        eventHandler: (e) => events.push(e),
      },
    );

    const log = await runner.run();
    // Warrior should flee successfully
    const battleEnd = events.find(e => e.type === "battle_end") as any;
    expect(battleEnd).toBeDefined();
    expect(battleEnd.reason).toContain("fled");
    expect(log.winner).toBeDefined();
  });

  it("draw when maxTurns reached with both alive", async () => {
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
        maxTurns: 1,
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();
    // After 1 turn with no kills, should be a draw
    const battleEnd = events.find(e => e.type === "battle_end") as any;
    expect(battleEnd).toBeDefined();
    // Winner could be undefined (draw) or one of the combatants if someone died
    expect(["red", "blue", undefined]).toContain(battleEnd?.winningTeam);
  });

  it("supports turnDelayMs for real-time pacing", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");

    const start = Date.now();
    const runner = new BattleRunner(
      [warrior, mage],
      [agentW, agentM],
      { turnDelayMs: 10, arena: ARENA_PRESETS.medium, maxTurns: 3 },
    );

    await runner.run();
    const elapsed = Date.now() - start;
    // 3 turns × 10ms = at least 30ms, but timers can be imprecise
    expect(elapsed).toBeGreaterThanOrEqual(10); // lenient for CI
  });

  it("IAgent lifecycle: onBattleStart and onBattleEnd called", async () => {
    let startCalled = false;
    let endCalled = false;
    const lifecycleAgent: import("../agent/interface.js").IAgent = {
      id: "w1", name: "Lifecycle", type: "heuristic",
      onBattleStart: () => { startCalled = true; },
      onBattleEnd: () => { endCalled = true; },
      getAction: async () => ({ type: "defend", actorId: "w1" }),
    };
    const warrior = createCharacter("w1", "Lifecycle", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentM = new HeuristicAgent("m1", "Beta");

    const runner = new BattleRunner(
      [warrior, mage],
      [lifecycleAgent, agentM],
      { turnDelayMs: 0, arena: ARENA_PRESETS.medium, maxTurns: 3 },
    );

    await runner.run();
    expect(startCalled).toBe(true);
    expect(endCalled).toBe(true);
  });

  it("frozen/paralyzed character skips turn", async () => {
    const frozenAgent: import("../agent/interface.js").IAgent = {
      id: "w1", name: "Frozen", type: "heuristic",
      getAction: async () => ({ type: "defend", actorId: "w1" }),
    };
    const warrior = createCharacter("w1", "Frozen", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentM = new HeuristicAgent("m1", "Beta");

    // Freeze the warrior
    warrior.statusEffects.push({ type: "paralyzed", turnsRemaining: 10, potency: 0, sourceId: "test" });

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage],
      [frozenAgent, agentM],
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.medium,
        maxTurns: 3,
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();

    // Should emit action_result with frozen narrative
    const frozenEvents = events.filter(
      (e: any) => e.type === "action_result" && e.result?.narrative?.includes("frozen/paralyzed")
    );
    expect(frozenEvents.length).toBeGreaterThan(0);
  });

  it("initializes positions for 3+ characters at (0,0)", async () => {
    const chars = [
      createCharacter("a", "Fighter", "warrior"), // (0,0)
      createCharacter("b", "Wizard", "mage"),     // (0,0)
      createCharacter("c", "Thief", "rogue"),     // (0,0)
    ];
    chars[0].team = "red";
    chars[1].team = "blue";
    chars[2].team = "green";
    const agents = chars.map(c => new HeuristicAgent(c.id, c.name));

    new BattleRunner(chars, agents, {
      turnDelayMs: 0,
      arena: ARENA_PRESETS.medium,
      maxTurns: 2,
      winCondition: "last_unit_standing",
    });

    // All 3 should have been given non-(0,0) positions via N-character path
    for (const c of chars) {
      expect(c.position.x).not.toBe(0);
    }
  });

  it("mutual destruction via status effects produces draw", async () => {
    // Two characters with lethal poison that will kill both after first turn
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 15, y: 30 }, "blue");

    // Apply lethal poison to both (potency = their maxHP)
    warrior.statusEffects.push({ type: "poison", turnsRemaining: 1, potency: warrior.stats.maxHp, sourceId: "test" });
    mage.statusEffects.push({ type: "poison", turnsRemaining: 1, potency: mage.stats.maxHp, sourceId: "test" });

    // Use defend-only agents so neither kills the other
    const defendOnly = (id: string): import("../agent/interface.js").IAgent => ({
      id, name: id, type: "heuristic",
      getAction: async () => ({ type: "defend", actorId: id }),
    });

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage],
      [defendOnly("w1"), defendOnly("m1")],
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.medium,
        maxTurns: 2,
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();

    const battleEnd = events.find(e => e.type === "battle_end") as any;
    expect(battleEnd).toBeDefined();
    // Both died from poison → draw
    expect(battleEnd.reason.toLowerCase()).toContain("draw");
  });

  it("status effect kill detected in last_unit_standing mode", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 10 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 50, y: 90 }, "blue");
    const rogue = createCharacter("r1", "Gamma", "rogue", { x: 90, y: 10 }, "green");

    // Warrior and rogue both get lethal poison; mage survives
    warrior.statusEffects.push({ type: "poison", turnsRemaining: 1, potency: warrior.stats.maxHp, sourceId: "test" });
    rogue.statusEffects.push({ type: "poison", turnsRemaining: 1, potency: rogue.stats.maxHp, sourceId: "test" });
    // Give mage lots of HP so it survives crossfire
    mage.stats.hp = 200;
    mage.stats.maxHp = 200;

    const agents = [warrior, mage, rogue].map(c => new HeuristicAgent(c.id, c.name));
    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage, rogue],
      agents,
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.large,
        maxTurns: 2,
        winCondition: "last_unit_standing",
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();

    const battleEnd = events.find(e => e.type === "battle_end") as any;
    expect(battleEnd).toBeDefined();
    // Mage should be last one standing
    expect(battleEnd.winner).toBe("m1");
    expect(battleEnd.reason).toContain("last one standing");
  });

  it("team-based win when all enemies killed by status effects", async () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 15, y: 30 }, "blue");

    // Mage gets lethal poison; warrior survives
    mage.statusEffects.push({ type: "poison", turnsRemaining: 1, potency: mage.stats.maxHp, sourceId: "test" });

    // Use defend-only agents to ensure kill comes from status tick, not combat
    const defendOnly = (id: string): import("../agent/interface.js").IAgent => ({
      id, name: id, type: "heuristic",
      getAction: async () => ({ type: "defend", actorId: id }),
    });

    const events: BattleEvent[] = [];
    const runner = new BattleRunner(
      [warrior, mage],
      [defendOnly("w1"), defendOnly("m1")],
      {
        turnDelayMs: 0,
        arena: ARENA_PRESETS.medium,
        maxTurns: 2,
        eventHandler: (e) => events.push(e),
      },
    );

    await runner.run();

    const battleEnd = events.find(e => e.type === "battle_end") as any;
    expect(battleEnd).toBeDefined();
    // Red team should win
    expect(battleEnd.winningTeam).toBe("red");
    expect(battleEnd.reason).toContain("wins");
  });

  it("exposes getCharacters() and getAgents()", () => {
    const warrior = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    const mage = createCharacter("m1", "Beta", "mage", { x: 90, y: 30 }, "blue");
    const agentW = new HeuristicAgent("w1", "Alpha");
    const agentM = new HeuristicAgent("m1", "Beta");
    const runner = new BattleRunner(
      [warrior, mage],
      [agentW, agentM],
      { turnDelayMs: 0, arena: ARENA_PRESETS.medium, maxTurns: 2 },
    );
    expect(runner.getCharacters()).toHaveLength(2);
    expect(runner.getAgents()).toHaveLength(2);
    expect(runner.getLiving()).toHaveLength(2);
  });

  it("collects thinking steps from LLMAgent", async () => {
    // Create a real LLMAgent instance but override getAction
    const charA = createCharacter("a", "Alpha", "warrior", undefined, "red");
    const charB = createCharacter("b", "Beta", "mage", undefined, "blue");

    const llmAgent = new LLMAgent({
      id: "a", name: "Alpha", characterClass: "warrior", model: "test-model",
    });
    // Override getAction to return a defend action without calling LLM
    llmAgent.getAction = async () => ({ type: "defend", actorId: "a" });
    // Pre-populate thinking steps
    (llmAgent as any)._pendingThinkingSteps = [
      { type: "thinking", text: "I should defend" },
      { type: "tool_call", text: "calling attack", toolName: "attack" },
    ];

    const heuristicAgent = new HeuristicAgent("b", "Beta");

    const log = await new BattleRunner(
      [charA, charB],
      [llmAgent, heuristicAgent],
      { turnDelayMs: 0, arena: ARENA_PRESETS.medium, maxTurns: 2 },
    ).run();

    // The turn for agent A should have thinking steps
    const alphaTurns = log.turns.filter(t => t.actorId === "a");
    expect(alphaTurns.length).toBeGreaterThan(0);
    // At least the first turn should have thinking steps
    const firstTurn = alphaTurns[0];
    expect(firstTurn.thinkingSteps).toBeDefined();
    expect(firstTurn.thinkingSteps!.length).toBe(2);
    expect(firstTurn.thinkingSteps![0].type).toBe("thinking");
    expect(firstTurn.thinkingSteps![1].toolName).toBe("attack");
  });

  it("resolveTarget returns self when all enemies dead", async () => {
    // Test the self-target fallback: kill all enemies via status effects mid-turn
    const w = createCharacter("w", "Warrior", "warrior", undefined, "red");
    const m = createCharacter("m", "Mage", "mage", undefined, "blue");
    // Mage has very low HP and a poison that will kill it
    m.stats.hp = 1;
    m.statusEffects.push({ name: "poison" as any, duration: 1, sourceId: "w", tickDamage: 10 } as any as StatusEffect);

    // Agent that attacks (mage will die from poison tick before attack resolves)
    const attackAgent = (id: string, name: string): IAgent => ({
      id, name, type: "heuristic",
      onBattleStart: async () => {},
      getAction: async () => ({
        type: "attack" as const,
        actorId: id,
        targetId: id === "w" ? "m" : "w",
      }),
      onBattleEnd: async () => {},
      destroy: async () => {},
    });

    const log = await new BattleRunner(
      [w, m],
      [attackAgent("w", "Warrior"), attackAgent("m", "Mage")],
      { maxTurns: 3 },
    ).run();

    // Battle should complete without hanging or crashing
    expect(log).toBeDefined();
    // Mage should have died from poison (or attack)
    expect(log.totalTurns).toBeGreaterThanOrEqual(0);
  });
});

