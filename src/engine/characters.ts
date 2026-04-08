// ─────────────────────────────────────────────────────────
//  Character Presets & Factory — D&D 5e Level 5
// ─────────────────────────────────────────────────────────
import {
  Character, CharacterClass, Spell, InventoryItem, Stats,
  SpellId, ItemId, SpellSlotGrid, WeaponDef, ClassFeature,
  ClassFeatureId, AbilityName, FightingStyle, abilityModifier,
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
  fightingStyle?: FightingStyle;
  equippedShield: boolean;
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
    fightingStyle: "great_weapon_fighting",
    equippedShield: false,
    items: [{ id: "health_potion", qty: 3 }, { id: "greater_health_potion", qty: 1 }, { id: "bomb", qty: 2 }],
  },
  mage: {
    abilities: { str: 8, dex: 14, con: 13, int: 17, wis: 12, cha: 10 },
    hitDie: 6, ac: 12, speed: 30,
    weapon: { name: "Quarterstaff", damageDice: "1d6", versatileDice: "1d8", abilityMod: "str", range: 5, properties: ["versatile"] },
    spellSlots: { 1: { total: 4, used: 0 }, 2: { total: 3, used: 0 }, 3: { total: 2, used: 0 } },
    spells: ["fire_bolt", "magic_missile", "shield", "thunderwave", "scorching_ray", "hold_person", "fireball", "lightning_bolt", "ray_of_frost", "web", "haste", "slow", "invisibility", "mirror_image", "absorb_elements", "dispel_magic"],
    features: [{ id: "arcane_recovery", usesPerBattle: 1 }],
    savingThrowProfs: ["int", "wis"],
    equippedShield: false,
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
      { id: "uncanny_dodge", usesPerBattle: 1 },
    ],
    savingThrowProfs: ["dex", "int"],
    equippedShield: false,
    items: [{ id: "health_potion", qty: 2 }, { id: "greater_health_potion", qty: 1 }, { id: "bomb", qty: 2 }, { id: "antidote", qty: 1 }],
  },
  paladin: {
    abilities: { str: 17, dex: 8, con: 14, int: 10, wis: 13, cha: 15 },
    hitDie: 10, ac: 18, speed: 30,
    weapon: { name: "Longsword", damageDice: "1d8", versatileDice: "1d10", abilityMod: "str", range: 5, properties: ["versatile"] },
    spellSlots: { 1: { total: 4, used: 0 }, 2: { total: 2, used: 0 } },
    spells: ["cure_wounds", "shield_of_faith", "healing_word", "misty_step", "bless"],
    features: [
      { id: "extra_attack", usesPerBattle: 0 },
      { id: "divine_smite", usesPerBattle: 0 },
      { id: "lay_on_hands", usesPerBattle: 1 },
    ],
    savingThrowProfs: ["wis", "cha"],
    fightingStyle: "dueling",
    equippedShield: true,
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
    description: "A bolt of fire. 3d10 fire damage at level 5. Ranged spell attack.",
    attackRoll: true, damageDice: "3d10", damageType: "fire",
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
    description: "Magical barrier. +5 AC until start of your next turn.",
    castingAbility: "int", cooldown: 2,
    statusEffect: { type: "shield", potency: 5, duration: 1 },
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
    description: "Three rays of fire, each dealing 2d6 fire. Ranged spell attack.",
    attackRoll: true, damageDice: "2d6", damageType: "fire",
    castingAbility: "int", cooldown: 2,
  },
  hold_person: {
    id: "hold_person", name: "Hold Person", level: 2, range: 60,
    type: "control", target: "enemy",
    description: "Paralyze target. WIS save or paralyzed 1 turn. Concentration.",
    saveAbility: "wis",
    castingAbility: "int", cooldown: 3,
    statusEffect: { type: "paralyzed", potency: 0, duration: 1 },
    concentration: true,
  },
  fireball: {
    id: "fireball", name: "Fireball", level: 3, range: 150,
    type: "damage", target: "enemy",
    description: "Explosion of fire. 8d6 fire. DEX save for half. 20ft radius AoE.",
    saveAbility: "dex", halfDamageOnSave: true,
    damageDice: "8d6", damageType: "fire",
    castingAbility: "int", cooldown: 4,
    aoeRadius: 20,
  },
  lightning_bolt: {
    id: "lightning_bolt", name: "Lightning Bolt", level: 3, range: 100,
    type: "damage", target: "enemy",
    description: "Line of lightning. 8d6 lightning. DEX save for half. 30ft wide AoE.",
    saveAbility: "dex", halfDamageOnSave: true,
    damageDice: "8d6", damageType: "lightning",
    castingAbility: "int", cooldown: 4,
    aoeRadius: 30,
  },
  healing_word: {
    id: "healing_word", name: "Healing Word", level: 1, range: 60,
    type: "heal", target: "self",
    description: "Bonus action heal. 1d4+WIS mod HP.",
    healDice: "1d4", healAbilityMod: "wis",
    castingAbility: "wis", cooldown: 1,
    bonusAction: true,
  },
  misty_step: {
    id: "misty_step", name: "Misty Step", level: 2, range: 0,
    type: "buff", target: "self",
    description: "Bonus action teleport. Teleport up to 30ft to an unoccupied space.",
    castingAbility: "cha", cooldown: 3,
    bonusAction: true,
  },
  // ── New Spells ──
  ray_of_frost: {
    id: "ray_of_frost", name: "Ray of Frost", level: 0, range: 60,
    type: "damage", target: "enemy",
    description: "Frigid beam. 1d8 cold damage. Reduces target speed by 10ft.",
    attackRoll: true, damageDice: "1d8", damageType: "cold",
    castingAbility: "int", cooldown: 0,
  },
  eldritch_blast: {
    id: "eldritch_blast", name: "Eldritch Blast", level: 0, range: 120,
    type: "damage", target: "enemy",
    description: "Blast of crackling energy. 2 beams at level 5, each 1d10 force. Ranged spell attack.",
    attackRoll: true, damageDice: "1d10", damageType: "force",
    castingAbility: "cha", cooldown: 0,
  },
  counterspell: {
    id: "counterspell", name: "Counterspell", level: 3, range: 60,
    type: "control", target: "enemy",
    description: "Reaction. Interrupt a spell. DC 15 ability check for level 4+ spells.",
    castingAbility: "int", cooldown: 3,
    reaction: true,
  },
  bless: {
    id: "bless", name: "Bless", level: 1, range: 30,
    type: "buff", target: "self",
    description: "Divine favor. Add d4 to attack rolls and saving throws for 3 turns. Concentration.",
    castingAbility: "wis", cooldown: 3,
    statusEffect: { type: "bless", potency: 4, duration: 3 },
    concentration: true,
  },
  bane: {
    id: "bane", name: "Bane", level: 1, range: 30,
    type: "control", target: "enemy",
    description: "Curses target. Subtract d4 from attack rolls and saving throws for 3 turns. WIS save. Concentration.",
    saveAbility: "wis",
    castingAbility: "cha", cooldown: 3,
    statusEffect: { type: "bane", potency: 4, duration: 3 },
    concentration: true,
  },
  web: {
    id: "web", name: "Web", level: 2, range: 60,
    type: "control", target: "enemy",
    description: "Sticky webs. DEX save or restrained. 3 turns. Concentration.",
    saveAbility: "dex",
    castingAbility: "int", cooldown: 3,
    statusEffect: { type: "restrained", potency: 0, duration: 3 },
    concentration: true,
  },
  spirit_guardians: {
    id: "spirit_guardians", name: "Spirit Guardians", level: 3, range: 0,
    type: "buff", target: "self",
    description: "Spectral guardians. 3d8 radiant/holy damage aura for 3 turns. Concentration.",
    castingAbility: "wis", cooldown: 4,
    statusEffect: { type: "spirit_guardians", potency: 8, duration: 3 },
    concentration: true,
  },
  haste: {
    id: "haste", name: "Haste", level: 3, range: 30,
    type: "buff", target: "self",
    description: "Double speed, +2 AC, advantage on DEX saves. Loses a turn when it ends. Concentration.",
    castingAbility: "int", cooldown: 5,
    statusEffect: { type: "haste", potency: 0, duration: 10 },
    concentration: true,
  },
  slow: {
    id: "slow", name: "Slow", level: 3, range: 120,
    type: "control", target: "enemy",
    description: "Target speed halved, -2 AC, no reactions. WIS save negates. Concentration.",
    castingAbility: "int", cooldown: 5, saveAbility: "wis",
    statusEffect: { type: "slow", potency: 0, duration: 10 },
    concentration: true,
  },
  invisibility: {
    id: "invisibility", name: "Invisibility", level: 2, range: 0,
    type: "buff", target: "self",
    description: "You become invisible. Attacks against you have disadvantage, your attacks have advantage. Ends when you attack or cast.",
    castingAbility: "int", cooldown: 8,
    statusEffect: { type: "invisible", potency: 0, duration: 10 },
    concentration: true,
  },
  mirror_image: {
    id: "mirror_image", name: "Mirror Image", level: 2, range: 0,
    type: "buff", target: "self",
    description: "Create 3 illusory duplicates. Attacks against you have a chance to hit a duplicate instead.",
    castingAbility: "int", cooldown: 6,
    statusEffect: { type: "mirror_image", potency: 3, duration: 60 },
  },
  absorb_elements: {
    id: "absorb_elements", name: "Absorb Elements", level: 1, range: 0,
    type: "buff", target: "self",
    description: "Reaction: When you take damage, gain resistance to that damage type until start of next turn.",
    castingAbility: "int", cooldown: 4, reaction: true,
    statusEffect: { type: "absorb_elements", potency: 0, duration: 1 },
  },
  dispel_magic: {
    id: "dispel_magic", name: "Dispel Magic", level: 3, range: 120,
    type: "control", target: "enemy",
    description: "End all magical effects on target. Ends concentration spells and removes status effects.",
    castingAbility: "int", cooldown: 5,
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
  evasion: "Evasion", cunning_action: "Cunning Action", uncanny_dodge: "Uncanny Dodge",
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
  uncanny_dodge: "Use reaction to halve damage from one attack.",
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
    fightingStyle: preset.fightingStyle,
    equippedShield: preset.equippedShield,
    isDefending: false,
    actionHistory: [],
    position: { ...position },
    concentrationSpellId: undefined,
    reactionUsed: false,
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    layOnHandsPool: 25,
    resistances: [],
    vulnerabilities: [],
    immunities: [],
  };
}

export { ALL_SPELLS, ALL_ITEMS };
