import { describe, it, expect } from "vitest";
import { HeuristicAgent } from "../agent/heuristic-agent.js";
import {
  BattleStateSnapshot,
  ARENA_PRESETS,
} from "../engine/types.js";

// ── Helpers ────────────────────────────────────────────

function makeSnapshot(
  chars: {
    id: string; name: string; team: string; class: string; level: number;
    hp: number; maxHp: number; ac: number; speed: number;
    str: number; dex: number; con: number; int: number; wis: number; cha: number;
    proficiencyBonus: number;
    spellSlots: Record<number, { total: number; used: number }>;
    position: { x: number; y: number };
    spells: any[];
    inventory: any[];
    features: any[];
    weapon: any;
    statusEffects: any[];
    isDefending: boolean;
    savingThrowProfs: string[];
    concentrationSpellId?: string;
    resistances?: string[];
    vulnerabilities?: string[];
    immunities?: string[];
  }[]
): BattleStateSnapshot {
  return {
    characters: chars.map(c => ({
      resistances: [], vulnerabilities: [], immunities: [], concentrationSpellId: undefined, reactionUsed: false, deathSaveSuccesses: 0, deathSaveFailures: 0, layOnHandsPool: 25, equippedShield: false, ...c,
    })),
    turnNumber: 1,
    phase: "ongoing",
    arena: ARENA_PRESETS.medium,
  };
}

function makeCharSnapshot(overrides: Record<string, any> = {}) {
  const defaultChar = {
    id: "w1",
    name: "Alpha",
    team: "red",
    class: "warrior",
    level: 5,
    hp: 49,
    maxHp: 49,
    ac: 16,
    speed: 30,
    str: 17, dex: 14, con: 16, int: 8, wis: 12, cha: 10,
    proficiencyBonus: 3,
    spellSlots: {} as Record<number, { total: number; used: number }>,
    position: { x: 10, y: 30 } as { x: number; y: number },
    spells: [] as any[],
    inventory: [] as any[],
    features: [
      { id: "extra_attack", name: "Extra Attack", description: "", usesPerBattle: 0, usesRemaining: 0 },
    ] as any[],
    weapon: { name: "Greatsword", damageDice: "2d6", abilityMod: "str", range: 5 },
    statusEffects: [] as any[],
    isDefending: false,
    savingThrowProfs: ["str", "con"],
  };
  return { ...defaultChar, ...overrides };
}

describe("HeuristicAgent", () => {
  it("returns attack or defend when in melee range", async () => {
    const agent = new HeuristicAgent("w1", "Alpha");
    const me = makeCharSnapshot();
    const enemy = makeCharSnapshot({
      id: "m1", name: "Beta", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      position: { x: 12, y: 30 },
    });

    const snapshot = makeSnapshot([me, enemy]);
    const action = await agent.getAction(snapshot);

    // Warrior in melee range with full HP typically attacks or defends
    expect(["attack", "defend", "shove", "grapple"]).toContain(action.type);
    expect(action.actorId).toBe("w1");
  });

  it("includes move when out of range", async () => {
    const agent = new HeuristicAgent("w1", "Alpha");
    const me = makeCharSnapshot({ position: { x: 10, y: 30 } });
    const enemy = makeCharSnapshot({
      id: "m1", name: "Beta", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      position: { x: 90, y: 30 }, // 80ft away
    });

    // Run multiple times since agent has random behavior
    let dashCount = 0;
    for (let i = 0; i < 20; i++) {
      const snapshot = makeSnapshot([me, enemy]);
      const action = await agent.getAction(snapshot);
      if (action.type === "dash") dashCount++;
    }
    // When far from melee range, should frequently dash to close the gap
    expect(dashCount).toBeGreaterThan(5);
  });

  it("uses Second Wind when low HP", async () => {
    const agent = new HeuristicAgent("w1", "Alpha");
    const me = makeCharSnapshot({
      hp: 10, maxHp: 49, // ~20% HP
      features: [
        { id: "second_wind", name: "Second Wind", description: "", usesPerBattle: 1, usesRemaining: 1 },
        { id: "extra_attack", name: "Extra Attack", description: "", usesPerBattle: 0, usesRemaining: 0 },
      ],
    });
    const enemy = makeCharSnapshot({
      id: "m1", name: "Beta", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      position: { x: 12, y: 30 },
    });

    const snapshot = makeSnapshot([me, enemy]);
    const action = await agent.getAction(snapshot);

    expect(action.type).toBe("class_ability");
    expect(action.abilityId).toBe("second_wind");
  });

  it("uses health potion when very low HP and no abilities", async () => {
    const agent = new HeuristicAgent("w1", "Alpha");
    const me = makeCharSnapshot({
      hp: 5, maxHp: 49, // ~10% HP
      features: [], // No healing abilities
      inventory: [
        { id: "health_potion", name: "Potion of Healing", description: "", quantity: 3, type: "heal_hp", potency: 7, range: 0 },
      ],
    });
    const enemy = makeCharSnapshot({
      id: "m1", name: "Beta", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      position: { x: 12, y: 30 },
    });

    const snapshot = makeSnapshot([me, enemy]);
    const action = await agent.getAction(snapshot);

    expect(action.type).toBe("use_item");
    expect(["health_potion", "greater_health_potion", "elixir", "defend"]).toContain(action.itemId || action.type);
  });

  it("waits when no enemies remain", async () => {
    const agent = new HeuristicAgent("w1", "Alpha");
    const me = makeCharSnapshot();

    const snapshot = makeSnapshot([me]); // only me, no enemies
    const action = await agent.getAction(snapshot);

    expect(action.type).toBe("wait");
  });

  it("returns correct id and name", () => {
    const agent = new HeuristicAgent("test_id", "TestName");
    expect(agent.id).toBe("test_id");
    expect(agent.name).toBe("TestName");
    expect(agent.type).toBe("heuristic");
  });

  it("implements IAgent lifecycle methods without error", () => {
    const agent = new HeuristicAgent("w1", "Alpha");
    // These should not throw
    expect(() => agent.onBattleStart()).not.toThrow();
    expect(() => agent.onActionResult({} as any)).not.toThrow();
    expect(() => agent.onBattleEnd("winner", "reason")).not.toThrow();
    expect(() => agent.destroy()).not.toThrow();
  });

  it("cast_spell when mage has spell slots and damage spells", async () => {
    const agent = new HeuristicAgent("m1", "Merlin");
    const me = makeCharSnapshot({
      id: "m1", name: "Merlin", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      int: 17, dex: 14,
      spellSlots: { 1: { total: 4, used: 0 }, 2: { total: 3, used: 0 }, 3: { total: 2, used: 0 } },
      spells: [
        { id: "fire_bolt", name: "Fire Bolt", type: "damage", target: "enemy", level: 0, range: 120, cooldown: 0, currentCooldown: 0, castingAbility: "int", damageDice: "2d10", attackRoll: true },
        { id: "fireball", name: "Fireball", type: "damage", target: "enemy", level: 3, range: 150, cooldown: 4, currentCooldown: 0, castingAbility: "int", damageDice: "8d6", saveAbility: "dex" },
        { id: "magic_missile", name: "Magic Missile", type: "damage", target: "enemy", level: 1, range: 120, cooldown: 0, currentCooldown: 0, castingAbility: "int", damageDice: "3d4+3" },
      ],
      features: [{ id: "arcane_recovery", name: "Arcane Recovery", description: "", usesPerBattle: 1, usesRemaining: 1 }],
    });
    const enemy = makeCharSnapshot({
      id: "w1", name: "Alpha", team: "red",
      hp: 49, maxHp: 49, ac: 16,
      position: { x: 90, y: 30 },
    });

    let spellCount = 0;
    for (let i = 0; i < 20; i++) {
      const snapshot = makeSnapshot([me, enemy]);
      for (const s of me.spells) s.currentCooldown = 0;
      const action = await agent.getAction(snapshot);
      if (action.type === "cast_spell") spellCount++;
    }
    expect(spellCount).toBeGreaterThan(5);
  });

  it("uses cantrips when out of spell slots", async () => {
    const agent = new HeuristicAgent("m1", "Merlin");
    const me = makeCharSnapshot({
      id: "m1", name: "Merlin", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      int: 17, dex: 14,
      spellSlots: {}, // no slots
      spells: [
        { id: "fire_bolt", name: "Fire Bolt", type: "damage", target: "enemy", level: 0, range: 120, cooldown: 0, currentCooldown: 0, castingAbility: "int", damageDice: "2d10", attackRoll: true },
      ],
      features: [],
    });
    const enemy = makeCharSnapshot({
      id: "w1", name: "Alpha", team: "red",
      hp: 49, maxHp: 49, ac: 16,
      position: { x: 12, y: 30 },
    });

    let cantripCount = 0;
    for (let i = 0; i < 20; i++) {
      const snapshot = makeSnapshot([me, enemy]);
      const action = await agent.getAction(snapshot);
      if (action.type === "cast_spell" && action.spellId === "fire_bolt") cantripCount++;
    }
    // Should frequently use cantrip since no slots available
    expect(cantripCount).toBeGreaterThan(3);
  });

  it("uses Lay on Hands when HP below 30%", async () => {
    const agent = new HeuristicAgent("p1", "Pally");
    const me = makeCharSnapshot({
      id: "p1", name: "Pally", team: "red",
      hp: 8, maxHp: 44, // ~18%
      features: [
        { id: "lay_on_hands", name: "Lay on Hands", description: "", usesPerBattle: 1, usesRemaining: 1 },
      ],
      inventory: [],
    });
    const enemy = makeCharSnapshot({
      id: "m1", name: "Mage", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      position: { x: 12, y: 30 },
    });

    const snapshot = makeSnapshot([me, enemy]);
    const action = await agent.getAction(snapshot);

    expect(action.type).toBe("class_ability");
    expect(action.abilityId).toBe("lay_on_hands");
  });

  it("uses bomb when enemy is healthy and in range", async () => {
    const agent = new HeuristicAgent("w1", "Alpha");
    const me = makeCharSnapshot({
      id: "w1", name: "Alpha", team: "red",
      hp: 49, maxHp: 49, // full HP
      features: [],
      inventory: [
        { id: "bomb", name: "Bomb", description: "", quantity: 1, type: "damage", potency: 10, range: 20 },
      ],
      position: { x: 10, y: 30 },
    });
    const enemy = makeCharSnapshot({
      id: "m1", name: "Mage", team: "blue",
      hp: 27, maxHp: 27, // full HP
      position: { x: 25, y: 30 }, // 15ft away, within bomb range
    });

    let bombCount = 0;
    for (let i = 0; i < 30; i++) {
      const snapshot = makeSnapshot([me, enemy]);
      me.inventory[0].quantity = 1;
      const action = await agent.getAction(snapshot);
      if (action.type === "use_item" && action.itemId === "bomb") bombCount++;
    }
    // Bomb used sometimes when enemy healthy and in range
    expect(bombCount).toBeGreaterThan(0);
  });

  it("falls back to defend when no spells/items available", async () => {
    const agent = new HeuristicAgent("w1", "Alpha");
    const me = makeCharSnapshot({
      id: "w1", name: "Alpha", team: "red",
      hp: 10, maxHp: 49, // ~20% HP, triggers low-HP defend
      features: [],
      inventory: [],
      spells: [],
      position: { x: 10, y: 30 },
    });
    const enemy = makeCharSnapshot({
      id: "m1", name: "Mage", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      position: { x: 12, y: 30 },
    });

    let defendCount = 0;
    for (let i = 0; i < 30; i++) {
      const snapshot = makeSnapshot([me, enemy]);
      const action = await agent.getAction(snapshot);
      if (action.type === "defend") defendCount++;
    }
    // Low HP with no items → 50% chance defend
    expect(defendCount).toBeGreaterThan(3);
  });

  it("supports personality config", () => {
    const agent = new HeuristicAgent("w1", "Alpha", { personality: "aggressive" });
    expect(agent.id).toBe("w1");
    expect(agent.name).toBe("Alpha");
  });

  it("uses shield spell when available and not already shielded", async () => {
    const agent = new HeuristicAgent("m1", "Merlin");
    const me = makeCharSnapshot({
      id: "m1", name: "Merlin", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      int: 17, dex: 14,
      spellSlots: { 1: { total: 4, used: 0 } },
      spells: [
        { id: "fire_bolt", name: "Fire Bolt", type: "damage", target: "enemy", level: 0, range: 120, cooldown: 0, currentCooldown: 0, castingAbility: "int", damageDice: "2d10", attackRoll: true },
        { id: "shield", name: "Shield", type: "buff", target: "self", level: 1, range: 0, cooldown: 0, currentCooldown: 0, castingAbility: "int" },
      ],
      features: [],
    });
    const enemy = makeCharSnapshot({
      id: "w1", name: "Alpha", team: "red",
      hp: 49, maxHp: 49, ac: 16,
      position: { x: 12, y: 30 },
    });

    let shieldCount = 0;
    for (let i = 0; i < 100; i++) {
      const snapshot = makeSnapshot([me, enemy]);
      me.spells[1].currentCooldown = 0;
      me.statusEffects = [];
      const action = await agent.getAction(snapshot);
      if (action.type === "cast_spell" && action.spellId === "shield") shieldCount++;
    }
    // Shield has ~30% chance, but only reached when no damage spell casts
    // With 100 iterations, should see at least a few
    expect(shieldCount).toBeGreaterThan(0);
  });

  it("uses heal spell when at medium HP", async () => {
    const agent = new HeuristicAgent("p1", "Pally");
    const me = makeCharSnapshot({
      id: "p1", name: "Pally", team: "red",
      hp: 20, maxHp: 44, // ~45% HP
      wis: 13,
      spellSlots: { 1: { total: 4, used: 0 }, 2: { total: 2, used: 0 } },
      spells: [
        { id: "cure_wounds", name: "Cure Wounds", type: "heal", target: "self", level: 1, range: 5, cooldown: 0, currentCooldown: 0, castingAbility: "wis", healDice: "1d8" },
        { id: "shield_of_faith", name: "Shield of Faith", type: "buff", target: "self", level: 1, range: 0, cooldown: 0, currentCooldown: 0, castingAbility: "cha" },
      ],
      features: [
        { id: "extra_attack", name: "Extra Attack", description: "", usesPerBattle: 0, usesRemaining: 0 },
        { id: "divine_smite", name: "Divine Smite", description: "", usesPerBattle: 0, usesRemaining: 0 },
        { id: "lay_on_hands", name: "Lay on Hands", description: "", usesPerBattle: 1, usesRemaining: 1 },
      ],
      inventory: [],
    });
    const enemy = makeCharSnapshot({
      id: "m1", name: "Mage", team: "blue",
      hp: 27, maxHp: 27, ac: 12,
      position: { x: 12, y: 30 },
    });

    let healCount = 0;
    for (let i = 0; i < 50; i++) {
      const snapshot = makeSnapshot([me, enemy]);
      me.spells[0].currentCooldown = 0;
      const action = await agent.getAction(snapshot);
      if (action.type === "cast_spell" && action.spellId === "cure_wounds") healCount++;
    }
    // Should sometimes use heal spell (60% chance when available)
    expect(healCount).toBeGreaterThan(5);
  });
});