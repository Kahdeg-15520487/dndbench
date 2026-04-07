import { describe, it, expect } from "vitest";
import { createBoss, getAllBosses, BOSS_ORDER, getBossProfile } from "../engine/bosses.js";

describe("Boss Definitions", () => {
  it("has 5 bosses in correct order", () => {
    expect(BOSS_ORDER).toHaveLength(5);
    expect(BOSS_ORDER).toEqual([
      "goblin_king", "dark_wizard", "ancient_dragon", "lich_lord", "demon_lord",
    ]);
  });

  it("getAllBosses returns 5 profiles", () => {
    const bosses = getAllBosses();
    expect(bosses).toHaveLength(5);
    expect(bosses.map(b => b.id)).toEqual(BOSS_ORDER);
  });

  it("tiers increase from 1 to 5", () => {
    const bosses = getAllBosses();
    for (let i = 0; i < bosses.length; i++) {
      expect(bosses[i].tier).toBe(i + 1);
    }
  });

  it("HP and AC scale with tier", () => {
    const bosses = getAllBosses();
    // Demon Lord should have more HP than Goblin King
    expect(bosses[4].hp).toBeGreaterThan(bosses[0].hp);
    expect(bosses[4].ac).toBeGreaterThan(bosses[0].ac);
  });

  it("getBossProfile returns correct profile", () => {
    const gk = getBossProfile("goblin_king");
    expect(gk).toBeDefined();
    expect(gk!.name).toBe("Goblin King");
    expect(gk!.tier).toBe(1);
  });

  it("getBossProfile returns undefined for unknown id", () => {
    expect(getBossProfile("unknown_boss" as any)).toBeUndefined();
  });
});

describe("createBoss", () => {
  it("creates Goblin King with correct stats", () => {
    const boss = createBoss("goblin_king", { x: 50, y: 30 }, "boss");
    expect(boss.id).toBe("goblin_king");
    expect(boss.name).toBe("Goblin King");
    expect(boss.team).toBe("boss");
    expect(boss.class).toBe("boss");
    expect(boss.stats.ac).toBe(15);
    expect(boss.stats.hp).toBe(65);
    expect(boss.stats.maxHp).toBe(65);
    expect(boss.stats.str).toBe(16);
    expect(boss.weapon.name).toBe("Scimitar");
    expect(boss.position).toEqual({ x: 50, y: 30 });
  });

  it("creates Ancient Dragon with correct stats", () => {
    const boss = createBoss("ancient_dragon", { x: 60, y: 40 }, "b");
    expect(boss.stats.ac).toBe(20);
    expect(boss.stats.hp).toBe(200);
    expect(boss.stats.str).toBe(24);
    expect(boss.stats.con).toBe(22);
    expect(boss.weapon.damageDice).toBe("2d10");
    expect(boss.weapon.range).toBe(10); // reach weapon
  });

  it("creates Demon Lord with correct stats", () => {
    const boss = createBoss("demon_lord", { x: 60, y: 40 });
    expect(boss.stats.ac).toBe(22);
    expect(boss.stats.hp).toBe(300);
    expect(boss.weapon.damageDice).toBe("3d6");
    expect(boss.features.some(f => f.id === "extra_attack")).toBe(true);
    expect(boss.features.some(f => f.id === "action_surge")).toBe(true);
  });

  it("Dark Wizard has spell slots and spells", () => {
    const boss = createBoss("dark_wizard", { x: 90, y: 30 });
    expect(boss.spellSlots[1]).toEqual({ total: 4, used: 0 });
    expect(boss.spellSlots[2]).toEqual({ total: 3, used: 0 });
    expect(boss.spellSlots[3]).toEqual({ total: 2, used: 0 });
    expect(boss.spells.length).toBeGreaterThan(0);
    expect(boss.spells.map(s => s.id)).toContain("fireball");
  });

  it("Lich Lord has all spell slots", () => {
    const boss = createBoss("lich_lord", { x: 60, y: 30 });
    expect(boss.spellSlots[1]).toEqual({ total: 4, used: 0 });
    expect(boss.spellSlots[2]).toEqual({ total: 3, used: 0 });
    expect(boss.spellSlots[3]).toEqual({ total: 3, used: 0 });
    expect(boss.spells).toHaveLength(8);
  });

  it("throws for unknown boss id", () => {
    expect(() => createBoss("unknown" as any)).toThrow();
  });

  it("default team is 'boss'", () => {
    const boss = createBoss("goblin_king", { x: 50, y: 30 });
    expect(boss.team).toBe("boss");
  });

  it("default position is (0,0)", () => {
    const boss = createBoss("goblin_king");
    expect(boss.position).toEqual({ x: 0, y: 0 });
  });

  it("bosses start at full HP with no status effects", () => {
    for (const id of BOSS_ORDER) {
      const boss = createBoss(id, { x: 50, y: 30 });
      expect(boss.stats.hp).toBe(boss.stats.maxHp);
      expect(boss.statusEffects).toHaveLength(0);
    }
  });
});
