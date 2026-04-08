import { describe, it, expect } from "vitest";
import {
  abilityModifier,
  hasSpellSlot,
  consumeSpellSlot,
  remainingSlots,
  totalRemainingSlots,
  formatSpellSlots,
  distance,
  moveToward,
  maxMovePerTurn,
  generateStartPositions,
  autoArenaPreset,
  getTeamColor,
  defaultStartPositions,
  ARENA_PRESETS,
} from "../engine/types.js";

describe("abilityModifier", () => {
  it("computes (score - 10) / 2 rounded down", () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(12)).toBe(1);
    expect(abilityModifier(14)).toBe(2);
    expect(abilityModifier(17)).toBe(3);
    expect(abilityModifier(20)).toBe(5);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(30)).toBe(10);
  });
});

describe("Spell Slots", () => {
  const makeSlots = (map: Record<number, [number, number]>) => {
    const result: Record<number, { total: number; used: number }> = {};
    for (const [k, [total, used]] of Object.entries(map)) {
      result[Number(k)] = { total, used };
    }
    return result;
  };

  it("hasSpellSlot returns true for cantrips (level 0)", () => {
    expect(hasSpellSlot({}, 0)).toBe(true);
  });

  it("hasSpellSlot returns true when slots available", () => {
    const slots = makeSlots({ 1: [4, 2], 3: [2, 0] });
    expect(hasSpellSlot(slots, 1)).toBe(true);
    expect(hasSpellSlot(slots, 3)).toBe(true);
  });

  it("hasSpellSlot returns false when all used", () => {
    const slots = makeSlots({ 1: [4, 4] });
    expect(hasSpellSlot(slots, 1)).toBe(false);
  });

  it("hasSpellSlot returns false for missing level", () => {
    const slots = makeSlots({ 1: [4, 0] });
    expect(hasSpellSlot(slots, 3)).toBe(false);
  });

  it("consumeSpellSlot decrements remaining", () => {
    const slots = makeSlots({ 1: [4, 0] });
    expect(consumeSpellSlot(slots, 1)).toBe(true);
    expect(slots[1].used).toBe(1);
    expect(consumeSpellSlot(slots, 1)).toBe(true);
    expect(slots[1].used).toBe(2);
  });

  it("consumeSpellSlot returns false when empty", () => {
    const slots = makeSlots({ 1: [1, 1] });
    expect(consumeSpellSlot(slots, 1)).toBe(false);
  });

  it("consumeSpellSlot always returns true for cantrips", () => {
    expect(consumeSpellSlot({}, 0)).toBe(true);
  });

  it("remainingSlots computes total - used", () => {
    const slots = makeSlots({ 1: [4, 1], 2: [3, 0], 3: [2, 2] });
    expect(remainingSlots(slots, 1)).toBe(3);
    expect(remainingSlots(slots, 2)).toBe(3);
    expect(remainingSlots(slots, 3)).toBe(0);
    expect(remainingSlots(slots, 5)).toBe(0); // missing level
  });

  it("totalRemainingSlots sums all levels", () => {
    const slots = makeSlots({ 1: [4, 1], 2: [3, 0], 3: [2, 1] });
    expect(totalRemainingSlots(slots)).toBe(3 + 3 + 1); // 7
  });

  it("totalRemainingSlots returns 0 for empty grid", () => {
    expect(totalRemainingSlots({})).toBe(0);
  });

  it("formatSpellSlots formats correctly", () => {
    const slots = makeSlots({ 1: [4, 1], 2: [3, 0], 3: [2, 2] });
    const formatted = formatSpellSlots(slots);
    expect(formatted).toContain("1st:3/4");
    expect(formatted).toContain("2nd:3/3");
    expect(formatted).toContain("3rd:0/2");
  });

  it("formatSpellSlots returns 'None' for empty grid", () => {
    expect(formatSpellSlots({})).toBe("None");
  });
});

describe("distance", () => {
  it("computes Euclidean distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
    expect(distance({ x: 10, y: 30 }, { x: 10, y: 30 })).toBe(0);
    expect(distance({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(10);
  });

  it("computes diagonal distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(Math.SQRT2);
  });
});

describe("moveToward", () => {
  it("returns undefined when already at target (dist <= 0.5)", () => {
    expect(moveToward({ x: 10, y: 10 }, { x: 10, y: 10 }, 30)).toBeUndefined();
    expect(moveToward({ x: 10, y: 10 }, { x: 10.3, y: 10.3 }, 30)).toBeUndefined();
  });

  it("moves exactly to target when within maxMove", () => {
    const move = moveToward({ x: 0, y: 0 }, { x: 20, y: 0 }, 30);
    expect(move).toEqual({ dx: 20, dy: 0 });
  });

  it("clamps to maxMove when target is far", () => {
    const move = moveToward({ x: 0, y: 0 }, { x: 100, y: 0 }, 30);
    expect(move).toEqual({ dx: 30, dy: 0 });
  });

  it("moves diagonally toward target", () => {
    const move = moveToward({ x: 0, y: 0 }, { x: 30, y: 30 }, 30);
    expect(move).toBeDefined();
    // Should move ~30ft diagonally (magnitude ≈ 30)
    const mag = Math.sqrt(move!.dx ** 2 + move!.dy ** 2);
    expect(mag).toBeCloseTo(30, 0);
  });

  it("handles negative direction", () => {
    const move = moveToward({ x: 50, y: 30 }, { x: 20, y: 30 }, 30);
    expect(move).toEqual({ dx: -30, dy: 0 });
  });
});

describe("maxMovePerTurn", () => {
  it("returns speed value", () => {
    expect(maxMovePerTurn(30)).toBe(30);
    expect(maxMovePerTurn(40)).toBe(40);
  });
});

describe("autoArenaPreset", () => {
  it("returns medium for 2 or fewer", () => {
    expect(autoArenaPreset(1)).toBe(ARENA_PRESETS.medium);
    expect(autoArenaPreset(2)).toBe(ARENA_PRESETS.medium);
  });

  it("returns large for 3-4", () => {
    expect(autoArenaPreset(3)).toBe(ARENA_PRESETS.large);
    expect(autoArenaPreset(4)).toBe(ARENA_PRESETS.large);
  });

  it("returns grand for 5+", () => {
    expect(autoArenaPreset(5)).toBe(ARENA_PRESETS.grand);
    expect(autoArenaPreset(10)).toBe(ARENA_PRESETS.grand);
  });
});

describe("generateStartPositions", () => {
  it("generates positions for each participant", () => {
    const participants = [
      { team: "red" }, { team: "red" },
      { team: "blue" }, { team: "blue" },
    ];
    const arena = ARENA_PRESETS.medium;
    const positions = generateStartPositions(participants, arena);
    expect(positions).toHaveLength(4);

    // All positions within arena bounds
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(arena.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(arena.height);
    }
  });

  it("generates circular layout for FFA (all unique teams)", () => {
    const participants = [
      { team: "a" }, { team: "b" }, { team: "c" }, { team: "d" },
    ];
    const arena = ARENA_PRESETS.medium;
    const positions = generateStartPositions(participants, arena);
    expect(positions).toHaveLength(4);
    // No two positions should be identical
    const unique = new Set(positions.map(p => `${p.x},${p.y}`));
    expect(unique.size).toBe(4);
  });
});

describe("defaultStartPositions", () => {
  it("returns two positions at opposite sides of arena", () => {
    const arena = ARENA_PRESETS.medium; // 100x60
    const [a, b] = defaultStartPositions(arena);
    expect(a.x).toBe(10);
    expect(a.y).toBe(30); // height / 2
    expect(b.x).toBe(90); // width - 10
    expect(b.y).toBe(30);
  });

  it("adapts to arena size", () => {
    const arena = ARENA_PRESETS.small; // 60x40
    const [a, b] = defaultStartPositions(arena);
    expect(a.x).toBe(10);
    expect(a.y).toBe(20); // 40 / 2
    expect(b.x).toBe(50); // 60 - 10
    expect(b.y).toBe(20);
  });
});

describe("generateStartPositions", () => {
  it("places 1v1 FFA in circular layout", () => {
    const participants = [
      { id: "a", team: "red", position: { x: 0, y: 0 } },
      { id: "b", team: "blue", position: { x: 0, y: 0 } },
    ];
    const positions = generateStartPositions(participants, ARENA_PRESETS.medium);
    expect(positions).toHaveLength(2);
    // With 2 participants (each unique team = FFA), circular layout is used
    // Two points opposite on a circle → same x, different y
    expect(positions[0].x).toBe(50);
    expect(positions[0].y).not.toBe(positions[1].y);
  });

  it("places 3+ teams spread across arena", () => {
    const participants = [
      { id: "a", team: "red", position: { x: 0, y: 0 } },
      { id: "b", team: "blue", position: { x: 0, y: 0 } },
      { id: "c", team: "green", position: { x: 0, y: 0 } },
    ];
    const positions = generateStartPositions(participants, ARENA_PRESETS.medium);
    expect(positions).toHaveLength(3);
    // 3 unique teams → circular layout (each is own team)
    // Should be spread around a circle
    const xs = positions.map(p => p.x);
    // They should not all be the same point
    expect(new Set(xs).size).toBeGreaterThan(1);
  });

  it("spreads multiple members of same team vertically", () => {
    const participants = [
      { id: "a1", team: "red", position: { x: 0, y: 0 } },
      { id: "a2", team: "red", position: { x: 0, y: 0 } },
      { id: "b1", team: "blue", position: { x: 0, y: 0 } },
      { id: "b2", team: "blue", position: { x: 0, y: 0 } },
    ];
    const positions = generateStartPositions(participants, ARENA_PRESETS.medium);
    // 2 teams with 2 members each → uses team layout
    // team 0 at x=10, team 1 at x=90
    expect(positions[0].x).toBe(10); // red team left
    expect(positions[1].x).toBe(10); // red team left
    expect(positions[2].x).toBe(90); // blue team right
    expect(positions[3].x).toBe(90); // blue team right
    // y values should be spread (not all same)
    expect(positions[0].y).not.toBe(positions[1].y);
    expect(positions[2].y).not.toBe(positions[3].y);
  });

  it("spreads 3 teams horizontally across arena", () => {
    const participants = [
      { id: "a1", team: "red", position: { x: 0, y: 0 } },
      { id: "b1", team: "blue", position: { x: 0, y: 0 } },
      { id: "g1", team: "green", position: { x: 0, y: 0 } },
      { id: "g2", team: "green", position: { x: 0, y: 0 } },
    ];
    const positions = generateStartPositions(participants, ARENA_PRESETS.medium);
    expect(positions).toHaveLength(4);
    // 3 teams → not circular (since green has 2 members, teams.length !== participants.length)
    // Red(ti=0) at x=10, Blue(ti=1) at x=50, Green(ti=2) at x=90
    const redX = positions[0].x;
    const blueX = positions[1].x;
    const greenXs = [positions[2].x, positions[3].x];
    expect(redX).toBe(10);
    expect(blueX).toBe(50);
    // Green team at right side
    expect(greenXs[0]).toBe(90);
    // Both green members should have same x
    expect(greenXs[0]).toBe(greenXs[1]);
    // Green members should be spread in y
    expect(positions[2].y).not.toBe(positions[3].y);
  });
});

describe("formatSpellSlots ordinal formatting", () => {
  it("formats slots with ordinal suffixes (1st, 2nd, 3rd, 4th)", () => {
    const slots: any = {
      1: { total: 4, used: 2 },
      2: { total: 3, used: 0 },
      3: { total: 2, used: 1 },
      4: { total: 1, used: 0 },
    };
    const result = formatSpellSlots(slots);
    expect(result).toContain("1st");
    expect(result).toContain("2nd");
    expect(result).toContain("3rd");
    expect(result).toContain("4th");
  });

  it("returns 'None' when all slots are empty", () => {
    const result = formatSpellSlots({});
    expect(result).toBe("None");
  });

  it("skips slots with total 0", () => {
    const slots: any = {
      1: { total: 0, used: 0 },
    };
    const result = formatSpellSlots(slots);
    expect(result).toBe("None");
  });
});

describe("getTeamColor", () => {
  it("returns known colors", () => {
    expect(getTeamColor("red")).toBe("#ff4444");
    expect(getTeamColor("blue")).toBe("#4488ff");
    expect(getTeamColor("boss")).toBe("#aa44ff");
  });

  it("returns deterministic color for unknown teams", () => {
    const c1 = getTeamColor("custom_team_xyz");
    const c2 = getTeamColor("custom_team_xyz");
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^hsl\(/);
  });
});
