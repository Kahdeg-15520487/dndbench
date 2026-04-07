// ─────────────────────────────────────────────────────────
//  Boss Definitions — 5 tiers of increasing difficulty
// ─────────────────────────────────────────────────────────

import {
  Character,
  Stats,
  Spell,
  SpellId,
  InventoryItem,
  ItemId,
  BossId,
} from "./types.js";
import { ALL_SPELLS } from "./characters.js";

// ── Boss Profiles ───────────────────────────────────────

interface BossProfile {
  id: BossId;
  name: string;
  emoji: string;
  title: string;
  tier: number;
  stats: Omit<Stats, "hp" | "mp"> & { maxHp: number; maxMp: number };
  spells: SpellId[];
  inventory: { id: ItemId; qty: number }[];
  description: string;
}

const BOSSES: BossProfile[] = [
  {
    id: "goblin_king",
    name: "Goblin King",
    emoji: "👑",
    title: "King of the Swamp",
    tier: 1,
    stats: { maxHp: 150, maxMp: 30, strength: 16, defense: 12, magic: 5, speed: 8, luck: 12 },
    spells: ["fire", "poison"],
    inventory: [
      { id: "health_potion", qty: 2 },
      { id: "bomb", qty: 2 },
    ],
    description: "A cunning goblin chieftain with poisoned blades and explosives.",
  },
  {
    id: "dark_wizard",
    name: "Dark Wizard",
    emoji: "🧙",
    title: "Master of Arcane",
    tier: 2,
    stats: { maxHp: 130, maxMp: 150, strength: 5, defense: 8, magic: 26, speed: 14, luck: 14 },
    spells: ["fire", "ice", "lightning", "poison", "drain", "meteor"],
    inventory: [
      { id: "mana_potion", qty: 3 },
      { id: "health_potion", qty: 1 },
    ],
    description: "A powerful sorcerer wielding devastating magic. Glass cannon with Meteor.",
  },
  {
    id: "ancient_dragon",
    name: "Ancient Dragon",
    emoji: "🐉",
    title: "Scourge of the Realm",
    tier: 3,
    stats: { maxHp: 280, maxMp: 80, strength: 24, defense: 20, magic: 18, speed: 16, luck: 10 },
    spells: ["fire", "lightning", "shield", "meteor"],
    inventory: [
      { id: "health_potion", qty: 3 },
    ],
    description: "An ancient wyrm with impenetrable scales and fiery breath.",
  },
  {
    id: "lich_lord",
    name: "Lich Lord",
    emoji: "💀",
    title: "The Undying",
    tier: 4,
    stats: { maxHp: 200, maxMp: 200, strength: 8, defense: 15, magic: 28, speed: 12, luck: 15 },
    spells: ["fire", "ice", "lightning", "heal", "shield", "poison", "drain", "meteor"],
    inventory: [
      { id: "mana_potion", qty: 4 },
      { id: "health_potion", qty: 2 },
      { id: "elixir", qty: 1 },
    ],
    description: "An undead archmage with all 8 spells and limitless mana. Never stays dead.",
  },
  {
    id: "demon_lord",
    name: "Demon Lord",
    emoji: "😈",
    title: "End of All Things",
    tier: 5,
    stats: { maxHp: 400, maxMp: 150, strength: 22, defense: 18, magic: 24, speed: 18, luck: 15 },
    spells: ["fire", "ice", "lightning", "poison", "drain", "meteor"],
    inventory: [
      { id: "health_potion", qty: 5 },
      { id: "mana_potion", qty: 3 },
      { id: "elixir", qty: 1 },
    ],
    description: "The ultimate adversary. Immense power, cunning strategy, no weakness.",
  },
];

// ── Item definitions (reuse from characters.ts) ──────────

const ALL_ITEMS: Record<ItemId, Omit<InventoryItem, "quantity">> = {
  health_potion: { id: "health_potion", name: "Health Potion", description: "Restore 40 HP.", type: "heal_hp", potency: 40, range: 0 },
  mana_potion: { id: "mana_potion", name: "Mana Potion", description: "Restore 30 MP.", type: "heal_mp", potency: 30, range: 0 },
  antidote: { id: "antidote", name: "Antidote", description: "Cure all status effects.", type: "cure", potency: 0, range: 0 },
  bomb: { id: "bomb", name: "Bomb", description: "Deal 35 fixed damage to the enemy.", type: "damage", potency: 35, range: 6 },
  elixir: { id: "elixir", name: "Elixir", description: "Fully restore HP and MP.", type: "full_restore", potency: 0, range: 0 },
};

// ── Factory ─────────────────────────────────────────────

export function createBoss(bossId: BossId): Character {
  const profile = BOSSES.find((b) => b.id === bossId);
  if (!profile) throw new Error(`Unknown boss: ${bossId}`);

  const stats: Stats = {
    maxHp: profile.stats.maxHp,
    hp: profile.stats.maxHp,
    maxMp: profile.stats.maxMp,
    mp: profile.stats.maxMp,
    strength: profile.stats.strength,
    defense: profile.stats.defense,
    magic: profile.stats.magic,
    speed: profile.stats.speed,
    luck: profile.stats.luck,
  };

  const spells: Spell[] = profile.spells.map((sid) => ({
    ...ALL_SPELLS[sid],
    currentCooldown: 0,
  }));

  const inventory: InventoryItem[] = profile.inventory.map((entry) => ({
    ...ALL_ITEMS[entry.id],
    quantity: entry.qty,
  }));

  return {
    id: "boss",
    name: profile.name,
    team: "boss",
    class: "boss" as any, // bosses don't have a standard class
    stats,
    statusEffects: [],
    spells,
    inventory,
    isDefending: false,
    actionHistory: [],
    position: { x: 0, y: 0 },
  };
}

export function getBossProfile(bossId: BossId): BossProfile {
  const p = BOSSES.find((b) => b.id === bossId);
  if (!p) throw new Error(`Unknown boss: ${bossId}`);
  return p;
}

export function getAllBossProfiles(): BossProfile[] {
  return [...BOSSES];
}

/** Boss order for boss rush mode */
export const BOSS_RUSH_ORDER: BossId[] = [
  "goblin_king",
  "dark_wizard",
  "ancient_dragon",
  "lich_lord",
  "demon_lord",
];
