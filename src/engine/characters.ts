// ─────────────────────────────────────────────────────────
//  Character Presets & Factory — D&D 5e Level 5
// ─────────────────────────────────────────────────────────
import {
  Character, CharacterClass, Spell, InventoryItem, Stats,
  SpellId, ItemId, SpellSlotGrid, WeaponDef, ClassFeature,
  ClassFeatureId, AbilityName, abilityModifier,
} from "./types.js";

const PROF_BONUS = 3;

function calcHp(hitDie: number, levels: number, conScore: number): number {
  const conMod = abilityModifier(conScore);
  return hitDie + conMod + (levels - 1) * (Math.floor(hitDie / 2) + 1 + conMod);
}

// ═══════════════════════════════════════════════════════
//  Class Presets — Level 5 D&D 5e
// ═══════════════════════════════════════════════════════

interface ClassPreset {
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  hitDie: number;
  ac: number;
  speed: number;
  weapon: WeaponDef;
  spellSlots: SpellSlotGrid;
  spells: SpellId[];
  features: { id: ClassFeatureId; usesPerBattle: number }[];
  savingThrowProfs: AbilityName[];
  items: { id: ItemId; qty: number }[];
}

export const CLASS_PRESETS: Record<CharacterClass, ClassPreset> = {
  warrior: {
    abilities: { str: 17, dex: 14, con: 16, int: 8, wis: 12, cha: 10 },
    hitDie: 10, ac: 16, speed: 30,
    weapon: { name: "Greatsword", damageDice: "2d6", abilityMod: "str", range: 5, properties: ["heavy", "two-handed"] },
    spellSlots: {},
    spells: [],
    features: [
      { id: "extra_attack", usesPerBattle: 0 },
      { id: "second_wind", usesPerBattle: 1 },
      { id: "action_surge", usesPerBattle: 1 },
    ],
    savingThrowProfs: ["str", "con"],
    items: [{ id: "health_potion", qty: 3 }, { id: "greater_health_potion", qty: 1 }, { id: "bomb", qty: 2 }],
  },
  mage: {
    abilities: { str: 8, dex: 14, con: 13, int: 17, wis: 12, cha: 10 },
    hitDie: 6, ac: 12, speed: 30,
    weapon: { name: "Quarterstaff", damageDice: "1d6", abilityMod: "str", range: 5, properties: ["versatile"] },
    spellSlots: { 1: { total: 4, used: 0 }, 2: { total: 3, used: 0 }, 3: { total: 2, used: 0 } },
    spells: ["fire_bolt", "magic_missile", "shield", "thunderwave", "scorching_ray", "hold_person", "fireball", "lightning_bolt"],
    features: [{ id: "arcane_recovery", usesPerBattle: 1 }],
    savingThrowProfs: ["int", "wis"],
    items: [{ id: "health_potion", qty: 2 }, { id: "greater_health_potion", qty: 1 }, { id: "bomb", qty: 1 }],
  },
  rogue: {
    abilities: { str: 10, dex: 17, con: 14, int: 13, wis: 12, cha: 8 },
    hitDie: 8, ac: 15, speed: 30,
    weapon: { name: "Rapier", damageDice: "1d8", abilityMod: "dex", range: 5, properties: ["finesse"] },
    spellSlots: {},
    spells: [],
    features: [
      { id: "sneak_attack", usesPerBattle: 0 },
      { id: "evasion", usesPerBattle: 0 },
      { id: "cunning_action", usesPerBattle: 0 },
    ],
    savingThrowProfs: ["dex", "int"],
    items: [{ id: "health_potion", qty: 2 }, { id: "greater_health_potion", qty: 1 }, { id: "bomb", qty: 2 }, { id: "antidote", qty: 1 }],
  },
  paladin: {
    abilities: { str: 17, dex: 8, con: 14, int: 10, wis: 13, cha: 15 },
    hitDie: 10, ac: 18, speed: 30,
    weapon: { name: "Longsword", damageDice: "1d8", abilityMod: "str", range: 5, properties: ["versatile"] },
    spellSlots: { 1: { total: 4, used: 0 }, 2: { total: 2, used: 0 } },
    spells: ["cure_wounds", "shield_of_faith"],
    features: [
      { id: "extra_attack", usesPerBattle: 0 },
      { id: "divine_smite", usesPerBattle: 0 },
      { id: "lay_on_hands", usesPerBattle: 1 },
    ],
    savingThrowProfs: ["wis", "cha"],
    items: [{ id: "health_potion", qty: 3 }, { id: "greater_health_potion", qty: 1 }, { id: "elixir", qty: 1 }],
  },
};

// ═══════════════════════════════════════════════════════
//  Spell Definitions — D&D 5e
// ═══════════════════════════════════════════════════════

const ALL_SPELLS: Record<SpellId, Omit<Spell, "currentCooldown">> = {
  fire_bolt: {
    id: "fire_bolt", name: "Fire Bolt", level: 0, range: 120,
    type: "damage", target: "enemy",
    description: "A bolt of fire. 2d10 fire damage. Ranged spell attack.",
    attackRoll: true, damageDice: "2d10", damageType: "fire",
    castingAbility: "int", cooldown: 0,
  },
  magic_missile: {
    id: "magic_missile", name: "Magic Missile", level: 1, range: 120,
    type: "damage", target: "enemy",
    description: "Three force darts. 3d4+3 force damage. Auto-hit.",
    damageDice: "3d4+3", damageType: "force",
    castingAbility: "int", cooldown: 0,
  },
  shield: {
    id: "shield", name: "Shield", level: 1, range: 0,
    type: "buff", target: "self",
    description: "Magical barrier. +5 AC for 2 turns.",
    castingAbility: "int", cooldown: 2,
    statusEffect: { type: "shield", potency: 5, duration: 2 },
  },
  thunderwave: {
    id: "thunderwave", name: "Thunderwave", level: 1, range: 15,
    type: "damage", target: "enemy",
    description: "Wave of thunder. 2d8 thunder. CON save for half.",
    saveAbility: "con", halfDamageOnSave: true,
    damageDice: "2d8", damageType: "thunder",
    castingAbility: "int", cooldown: 1,
  },
  cure_wounds: {
    id: "cure_wounds", name: "Cure Wounds", level: 1, range: 5,
    type: "heal", target: "self",
    description: "Heal 1d8+WIS mod HP. Touch range.",
    healDice: "1d8", healAbilityMod: "wis",
    castingAbility: "wis", cooldown: 1,
  },
  shield_of_faith: {
    id: "shield_of_faith", name: "Shield of Faith", level: 1, range: 0,
    type: "buff", target: "self",
    description: "Aura of protection. +2 AC for 3 turns.",
    castingAbility: "cha", cooldown: 3,
    statusEffect: { type: "shield", potency: 2, duration: 3 },
  },
  scorching_ray: {
    id: "scorching_ray", name: "Scorching Ray", level: 2, range: 120,
    type: "damage", target: "enemy",
    description: "Three rays of fire. 6d6 fire. Ranged spell attack.",
    attackRoll: true, damageDice: "6d6", damageType: "fire",
    castingAbility: "int", cooldown: 2,
  },
  hold_person: {
    id: "hold_person", name: "Hold Person", level: 2, range: 60,
    type: "damage", target: "enemy",
    description: "Paralyze target. WIS save or paralyzed 1 turn.",
    saveAbility: "wis", halfDamageOnSave: false,
    castingAbility: "int", cooldown: 3,
    statusEffect: { type: "paralyzed", potency: 0, duration: 1 },
  },
  fireball: {
    id: "fireball", name: "Fireball", level: 3, range: 150,
    type: "damage", target: "enemy",
    description: "Explosion of fire. 8d6 fire. DEX save for half.",
    saveAbility: "dex", halfDamageOnSave: true,
    damageDice: "8d6", damageType: "fire",
    castingAbility: "int", cooldown: 4,
  },
  lightning_bolt: {
    id: "lightning_bolt", name: "Lightning Bolt", level: 3, range: 100,
    type: "damage", target: "enemy",
    description: "Line of lightning. 8d6 lightning. DEX save for half.",
    saveAbility: "dex", halfDamageOnSave: true,
    damageDice: "8d6", damageType: "lightning",
    castingAbility: "int", cooldown: 4,
  },
};

// ═══════════════════════════════════════════════════════
//  Item Definitions
// ═══════════════════════════════════════════════════════

const ALL_ITEMS: Record<ItemId, Omit<InventoryItem, "quantity">> = {
  health_potion: {
    id: "health_potion", name: "Potion of Healing",
    description: "Heal 2d4+2 HP.", type: "heal_hp", potency: 7, range: 0,
  },
  greater_health_potion: {
    id: "greater_health_potion", name: "Potion of Greater Healing",
    description: "Heal 4d4+4 HP.", type: "heal_hp", potency: 14, range: 0,
  },
  antidote: {
    id: "antidote", name: "Antidote",
    description: "Cure all status effects.", type: "cure", potency: 0, range: 0,
  },
  bomb: {
    id: "bomb", name: "Alchemist Fire",
    description: "Deal 3d6 fire damage. Range 20ft.", type: "damage", potency: 0, range: 20,
  },
  elixir: {
    id: "elixir", name: "Elixir of Health",
    description: "Fully restore HP and spell slots.", type: "full_restore", potency: 0, range: 0,
  },
};

// ═══════════════════════════════════════════════════════
//  Feature Descriptions
// ═══════════════════════════════════════════════════════

const FEATURE_NAMES: Record<ClassFeatureId, string> = {
  extra_attack: "Extra Attack", sneak_attack: "Sneak Attack",
  second_wind: "Second Wind", action_surge: "Action Surge",
  divine_smite: "Divine Smite", lay_on_hands: "Lay on Hands",
  evasion: "Evasion", cunning_action: "Cunning Action",
  arcane_recovery: "Arcane Recovery",
};

const FEATURE_DESCS: Record<ClassFeatureId, string> = {
  extra_attack: "Attack twice per Attack action.",
  sneak_attack: "+3d6 damage on first hit each turn.",
  second_wind: "Heal 1d10+5 HP. 1/battle.",
  action_surge: "Take an extra action. 1/battle.",
  divine_smite: "+2d8 radiant damage on weapon hit (uses spell slot).",
  lay_on_hands: "Heal up to 25 HP from pool. 1/battle.",
  evasion: "Half damage on failed DEX save, none on success.",
  cunning_action: "Bonus action Dash/Disengage.",
  arcane_recovery: "Recover spell slots once per battle.",
};

// ═══════════════════════════════════════════════════════
//  Factory — create a Level 5 character
// ═══════════════════════════════════════════════════════

export function createCharacter(
  id: string,
  name: string,
  charClass: CharacterClass,
  position: { x: number; y: number } = { x: 0, y: 0 },
  team: string = "a",
): Character {
  const preset = CLASS_PRESETS[charClass];
  const ab = preset.abilities;
  const maxHp = calcHp(preset.hitDie, 5, ab.con);

  const stats: Stats = {
    maxHp, hp: maxHp,
    str: ab.str, dex: ab.dex, con: ab.con,
    int: ab.int, wis: ab.wis, cha: ab.cha,
    ac: preset.ac,
    proficiencyBonus: PROF_BONUS,
    speed: preset.speed,
  };

  const spells: Spell[] = preset.spells.map(sid => ({
    ...ALL_SPELLS[sid],
    currentCooldown: 0,
  }));

  const spellSlots: SpellSlotGrid = {};
  for (const [k, v] of Object.entries(preset.spellSlots)) {
    spellSlots[Number(k)] = { total: v.total, used: 0 };
  }

  const inventory: InventoryItem[] = preset.items.map(entry => ({
    ...ALL_ITEMS[entry.id],
    quantity: entry.qty,
  }));

  const features: ClassFeature[] = preset.features.map(f => ({
    id: f.id,
    name: FEATURE_NAMES[f.id],
    description: FEATURE_DESCS[f.id],
    usesPerBattle: f.usesPerBattle,
    usesRemaining: f.usesPerBattle,
  }));

  return {
    id, name, team,
    class: charClass,
    level: 5,
    stats,
    statusEffects: [],
    spells,
    spellSlots,
    inventory,
    weapon: preset.weapon,
    features,
    savingThrowProfs: preset.savingThrowProfs,
    isDefending: false,
    actionHistory: [],
    position: { ...position },
  };
}

export { ALL_SPELLS, ALL_ITEMS };
