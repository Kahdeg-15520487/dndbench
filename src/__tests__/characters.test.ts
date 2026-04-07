import { describe, it, expect } from "vitest";
import { createCharacter, ALL_SPELLS, CLASS_PRESETS } from "../engine/characters.js";

describe("createCharacter", () => {
  it("creates a warrior with correct stats", () => {
    const w = createCharacter("w1", "Alpha", "warrior", { x: 10, y: 30 }, "red");
    expect(w.id).toBe("w1");
    expect(w.name).toBe("Alpha");
    expect(w.team).toBe("red");
    expect(w.class).toBe("warrior");
    expect(w.level).toBe(5);

    // STR 17 → mod +3, CON 16 → mod +3
    // HP: 10 + 3 + 4 * (5 + 3) = 49
    expect(w.stats.hp).toBe(49);
    expect(w.stats.maxHp).toBe(49);
    expect(w.stats.str).toBe(17);
    expect(w.stats.ac).toBe(16);
    expect(w.stats.proficiencyBonus).toBe(3);
    expect(w.stats.speed).toBe(30);
  });

  it("creates a mage with spell slots", () => {
    const m = createCharacter("m1", "Merlin", "mage", { x: 90, y: 30 }, "blue");
    expect(m.stats.int).toBe(17);
    expect(m.stats.ac).toBe(12);
    // HP: 6 + 1 (INT 17→+3 wait, CON 13→+1) → hitDie 6, conMod +1 = 6+1 + 4*(3+1) = 27
    expect(m.stats.hp).toBe(27);

    // Spell slots: 1st:4, 2nd:3, 3rd:2
    expect(m.spellSlots[1]).toEqual({ total: 4, used: 0 });
    expect(m.spellSlots[2]).toEqual({ total: 3, used: 0 });
    expect(m.spellSlots[3]).toEqual({ total: 2, used: 0 });

    // 8 spells
    expect(m.spells).toHaveLength(8);
    expect(m.spells.map(s => s.id)).toContain("fire_bolt");
    expect(m.spells.map(s => s.id)).toContain("fireball");
  });

  it("creates a rogue with Sneak Attack", () => {
    const r = createCharacter("r1", "Shadow", "rogue", { x: 50, y: 10 }, "green");
    expect(r.stats.dex).toBe(17);
    expect(r.stats.ac).toBe(15);
    expect(r.features.some(f => f.id === "sneak_attack")).toBe(true);
    expect(r.features.some(f => f.id === "evasion")).toBe(true);
    expect(r.weapon.name).toBe("Rapier");
    expect(r.weapon.damageDice).toBe("1d8");
  });

  it("creates a paladin with Divine Smite", () => {
    const p = createCharacter("p1", "Helios", "paladin", { x: 50, y: 50 }, "gold");
    expect(p.stats.str).toBe(17);
    expect(p.stats.ac).toBe(18);
    expect(p.features.some(f => f.id === "divine_smite")).toBe(true);
    expect(p.features.some(f => f.id === "lay_on_hands")).toBe(true);
    // Spell slots: 1st:4, 2nd:2
    expect(p.spellSlots[1]).toEqual({ total: 4, used: 0 });
    expect(p.spellSlots[2]).toEqual({ total: 2, used: 0 });
  });

  it("copies position correctly", () => {
    const c = createCharacter("test", "Test", "warrior", { x: 42, y: 13 });
    expect(c.position).toEqual({ x: 42, y: 13 });
  });

  it("starts at full HP with no status effects", () => {
    const c = createCharacter("test", "Test", "warrior");
    expect(c.stats.hp).toBe(c.stats.maxHp);
    expect(c.statusEffects).toHaveLength(0);
    expect(c.isDefending).toBe(false);
    expect(c.actionHistory).toHaveLength(0);
  });

  it("features have correct usesRemaining", () => {
    const w = createCharacter("w1", "Test", "warrior");
    const sw = w.features.find(f => f.id === "second_wind");
    expect(sw!.usesPerBattle).toBe(1);
    expect(sw!.usesRemaining).toBe(1);

    const ea = w.features.find(f => f.id === "extra_attack");
    expect(ea!.usesPerBattle).toBe(0); // passive
    expect(ea!.usesRemaining).toBe(0);
  });

  it("spells start with zero cooldown", () => {
    const m = createCharacter("m1", "Test", "mage");
    for (const s of m.spells) {
      expect(s.currentCooldown).toBe(0);
    }
  });

  it("inventory has correct quantities", () => {
    const w = createCharacter("w1", "Test", "warrior");
    const hp = w.inventory.find(i => i.id === "health_potion");
    expect(hp!.quantity).toBe(3);
    const ghp = w.inventory.find(i => i.id === "greater_health_potion");
    expect(ghp!.quantity).toBe(1);
    const bomb = w.inventory.find(i => i.id === "bomb");
    expect(bomb!.quantity).toBe(2);
  });

  it("default team is 'a'", () => {
    const c = createCharacter("test", "Test", "warrior");
    expect(c.team).toBe("a");
  });

  it("default position is (0,0)", () => {
    const c = createCharacter("test", "Test", "warrior");
    expect(c.position).toEqual({ x: 0, y: 0 });
  });
});

describe("ALL_SPELLS", () => {
  it("has all 10 spells", () => {
    const ids = Object.keys(ALL_SPELLS);
    expect(ids).toHaveLength(10);
  });

  it("each spell has required fields", () => {
    for (const [id, spell] of Object.entries(ALL_SPELLS)) {
      expect(spell.id).toBe(id as any);
      expect(spell.name).toBeTruthy();
      expect(spell.level).toBeGreaterThanOrEqual(0);
      expect(spell.range).toBeGreaterThanOrEqual(0);
      expect(["damage", "heal", "buff"]).toContain(spell.type);
      expect(["enemy", "self"]).toContain(spell.target);
      expect(spell.castingAbility).toBeTruthy();
    }
  });

  it("fire_bolt is a cantrip (level 0)", () => {
    expect(ALL_SPELLS.fire_bolt.level).toBe(0);
    expect(ALL_SPELLS.fire_bolt.attackRoll).toBe(true);
    expect(ALL_SPELLS.fire_bolt.damageDice).toBe("2d10");
  });

  it("fireball is level 3 with DEX save", () => {
    expect(ALL_SPELLS.fireball.level).toBe(3);
    expect(ALL_SPELLS.fireball.saveAbility).toBe("dex");
    expect(ALL_SPELLS.fireball.damageDice).toBe("8d6");
    expect(ALL_SPELLS.fireball.halfDamageOnSave).toBe(true);
  });

  it("magic_missile auto-hits (no attackRoll, no save)", () => {
    expect(ALL_SPELLS.magic_missile.attackRoll).toBeFalsy();
    expect(ALL_SPELLS.magic_missile.saveAbility).toBeFalsy();
  });

  it("shield is a buff targeting self", () => {
    expect(ALL_SPELLS.shield.type).toBe("buff");
    expect(ALL_SPELLS.shield.target).toBe("self");
    expect(ALL_SPELLS.shield.statusEffect?.type).toBe("shield");
    expect(ALL_SPELLS.shield.statusEffect?.potency).toBe(5);
  });

  it("hold_person applies paralyzed status", () => {
    expect(ALL_SPELLS.hold_person.statusEffect?.type).toBe("paralyzed");
    expect(ALL_SPELLS.hold_person.saveAbility).toBe("wis");
  });

  it("cure_wounds is a heal spell", () => {
    expect(ALL_SPELLS.cure_wounds.type).toBe("heal");
    expect(ALL_SPELLS.cure_wounds.healDice).toBe("1d8");
    expect(ALL_SPELLS.cure_wounds.target).toBe("self");
  });
});

describe("CLASS_PRESETS", () => {
  it("has 4 classes", () => {
    expect(Object.keys(CLASS_PRESETS)).toHaveLength(4);
    expect(Object.keys(CLASS_PRESETS)).toContain("warrior");
    expect(Object.keys(CLASS_PRESETS)).toContain("mage");
    expect(Object.keys(CLASS_PRESETS)).toContain("rogue");
    expect(Object.keys(CLASS_PRESETS)).toContain("paladin");
  });

  it("all classes have valid ability scores (3-20)", () => {
    for (const [cls, preset] of Object.entries(CLASS_PRESETS)) {
      const ab = preset.abilities;
      for (const [key, val] of Object.entries(ab)) {
        expect(val).toBeGreaterThanOrEqual(3);
        expect(val).toBeLessThanOrEqual(20);
      }
    }
  });

  it("all classes have AC > 0 and speed > 0", () => {
    for (const preset of Object.values(CLASS_PRESETS)) {
      expect(preset.ac).toBeGreaterThan(0);
      expect(preset.speed).toBeGreaterThan(0);
    }
  });
});
