// ─────────────────────────────────────────────────────────
//  Boss Definitions — D&D 5e Monster Stat Blocks
// ─────────────────────────────────────────────────────────
import {
  Character, Stats, Spell, SpellId, InventoryItem, ItemId,
  BossId, SpellSlotGrid, WeaponDef, ClassFeature, ClassFeatureId, AbilityName,
} from "./types.js";
import { ALL_SPELLS } from "./characters.js";

const PROF_BONUS = 3;

function mod(score: number): number {
  return Math.floor((score - 10) / 2);
}

// ═══════════════════════════════════════════════════════
//  Boss Profiles — 5 tiers of increasing difficulty
// ═══════════════════════════════════════════════════════

interface BossProfile {
  id: BossId;
  name: string;
  emoji: string;
  title: string;
  tier: number;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  ac: number;
  speed: number;
  hp: number;
  weapon: WeaponDef;
  spellSlots: SpellSlotGrid;
  spells: SpellId[];
  features: { id: ClassFeatureId; usesPerBattle: number }[];
  items: { id: ItemId; qty: number }[];
  description: string;
}

const BOSSES: BossProfile[] = [
  {
    id: "goblin_king",
    name: "Goblin King",
    emoji: "👑",
    title: "King of the Swamp",
    tier: 1,
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 12 },
    ac: 15, speed: 30, hp: 65,
    weapon: { name: "Scimitar", damageDice: "1d6", abilityMod: "str", range: 5, properties: ["finesse"] },
    spellSlots: {},
    spells: [],
    features: [
      { id: "extra_attack", usesPerBattle: 0 },
      { id: "second_wind", usesPerBattle: 1 },
    ],
    items: [{ id: "health_potion", qty: 2 }, { id: "bomb", qty: 2 }],
    description: "A cunning goblin chieftain with poisoned blades and explosives.",
  },
  {
    id: "dark_wizard",
    name: "Dark Wizard",
    emoji: "🧙",
    title: "Master of Arcane",
    tier: 2,
    abilities: { str: 6, dex: 14, con: 12, int: 18, wis: 14, cha: 12 },
    ac: 13, speed: 30, hp: 60,
    weapon: { name: "Quarterstaff", damageDice: "1d6", abilityMod: "str", range: 5, properties: ["versatile"] },
    spellSlots: { 1: { total: 4, used: 0 }, 2: { total: 3, used: 0 }, 3: { total: 2, used: 0 } },
    spells: ["fire_bolt", "magic_missile", "shield", "thunderwave", "scorching_ray", "hold_person", "fireball"],
    features: [{ id: "arcane_recovery", usesPerBattle: 1 }],
    items: [{ id: "health_potion", qty: 2 }, { id: "greater_health_potion", qty: 1 }],
    description: "A powerful sorcerer wielding devastating magic. Glass cannon with Fireball.",
  },
  {
    id: "ancient_dragon",
    name: "Ancient Dragon",
    emoji: "🐉",
    title: "Terror of the Skies",
    tier: 3,
    abilities: { str: 24, dex: 10, con: 22, int: 14, wis: 16, cha: 18 },
    ac: 20, speed: 40, hp: 200,
    weapon: { name: "Bite", damageDice: "2d10", abilityMod: "str", range: 10, properties: ["reach"] },
    spellSlots: {},
    spells: [],
    features: [
      { id: "extra_attack", usesPerBattle: 0 },
      { id: "action_surge", usesPerBattle: 1 },
    ],
    items: [],
    description: "An enormous dragon with devastating multiattack and breath weapon.",
  },
  {
    id: "lich_lord",
    name: "Lich Lord",
    emoji: "💀",
    title: "Eternal Necromancer",
    tier: 4,
    abilities: { str: 8, dex: 14, con: 16, int: 22, wis: 18, cha: 20 },
    ac: 17, speed: 30, hp: 135,
    weapon: { name: "Necrotic Touch", damageDice: "1d8", abilityMod: "int", range: 5, properties: ["magical"] },
    spellSlots: { 1: { total: 4, used: 0 }, 2: { total: 3, used: 0 }, 3: { total: 3, used: 0 } },
    spells: ["fire_bolt", "magic_missile", "shield", "thunderwave", "scorching_ray", "hold_person", "fireball", "lightning_bolt"],
    features: [{ id: "arcane_recovery", usesPerBattle: 1 }],
    items: [{ id: "health_potion", qty: 3 }],
    description: "An undead archmage with immense magical power and spell slots.",
  },
  {
    id: "demon_lord",
    name: "Demon Lord",
    emoji: "👹",
    title: "Lord of the Abyss",
    tier: 5,
    abilities: { str: 26, dex: 14, con: 24, int: 16, wis: 18, cha: 22 },
    ac: 22, speed: 40, hp: 300,
    weapon: { name: "Flaming Greatsword", damageDice: "3d6", abilityMod: "str", range: 10, properties: ["heavy", "reach", "magical"] },
    spellSlots: { 1: { total: 4, used: 0 }, 2: { total: 3, used: 0 }, 3: { total: 3, used: 0 } },
    spells: ["fire_bolt", "fireball", "lightning_bolt", "shield"],
    features: [
      { id: "extra_attack", usesPerBattle: 0 },
      { id: "action_surge", usesPerBattle: 2 },
      { id: "second_wind", usesPerBattle: 2 },
    ],
    items: [],
    description: "An apex predator from the Abyss. Immense HP, AC, and devastating attacks.",
  },
];

const BOSS_MAP = new Map(BOSSES.map(b => [b.id, b]));

export function getBossProfile(id: BossId): BossProfile | undefined {
  return BOSS_MAP.get(id);
}

export function getAllBosses(): BossProfile[] {
  return [...BOSSES];
}

export const BOSS_ORDER: BossId[] = [
  "goblin_king", "dark_wizard", "ancient_dragon", "lich_lord", "demon_lord",
];

// ═══════════════════════════════════════════════════════
//  Factory — create a boss character
// ═══════════════════════════════════════════════════════

export function createBoss(
  id: BossId,
  position: { x: number; y: number } = { x: 0, y: 0 },
  team: string = "boss",
): Character {
  const profile = BOSS_MAP.get(id);
  if (!profile) throw new Error("Unknown boss: " + id);

  const ab = profile.abilities;

  const stats: Stats = {
    maxHp: profile.hp,
    hp: profile.hp,
    str: ab.str, dex: ab.dex, con: ab.con,
    int: ab.int, wis: ab.wis, cha: ab.cha,
    ac: profile.ac,
    proficiencyBonus: PROF_BONUS,
    speed: profile.speed,
  };

  const spells: Spell[] = profile.spells.map(sid => {
    const base = ALL_SPELLS[sid];
    if (!base) throw new Error("Unknown spell for boss: " + sid);
    return { ...base, currentCooldown: 0 };
  });

  const spellSlots: SpellSlotGrid = {};
  for (const [k, v] of Object.entries(profile.spellSlots)) {
    spellSlots[Number(k)] = { total: v.total, used: 0 };
  }

  const inventory: InventoryItem[] = profile.items.map(entry => ({
    id: entry.id,
    name: entry.id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    description: "",
    quantity: entry.qty,
    type: entry.id === "health_potion" || entry.id === "greater_health_potion" ? "heal_hp" as const
      : entry.id === "bomb" ? "damage" as const
      : "heal_hp" as const,
    potency: entry.id === "health_potion" ? 7 : entry.id === "greater_health_potion" ? 14 : 0,
    range: entry.id === "bomb" ? 20 : 0,
  }));

  const features: ClassFeature[] = profile.features.map(f => ({
    id: f.id,
    name: f.id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    description: "",
    usesPerBattle: f.usesPerBattle,
    usesRemaining: f.usesPerBattle,
  }));

  return {
    id: profile.id,
    name: profile.name,
    team,
    class: "boss",
    level: 5 + profile.tier * 2,
    stats,
    statusEffects: [],
    spells,
    spellSlots,
    inventory,
    weapon: profile.weapon,
    features,
    savingThrowProfs: ["con", "wis"],
    isDefending: false,
    actionHistory: [],
    position: { ...position },
  };
}
