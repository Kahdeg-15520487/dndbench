// ─────────────────────────────────────────────────────────
//  Character Presets & Factory
// ─────────────────────────────────────────────────────────

import {
  Character,
  CharacterClass,
  Spell,
  InventoryItem,
  Stats,
  SpellId,
  ItemId,
} from "./types.js";

// ── Base Stat Profiles ──────────────────────────────────

const CLASS_STATS: Record<CharacterClass, { baseHp: number; baseMp: number; strength: number; defense: number; magic: number; speed: number; luck: number }> = {
  warrior: {
    baseHp: 120,
    baseMp: 30,
    strength: 18,
    defense: 15,
    magic: 5,
    speed: 10,
    luck: 8,
  },
  mage: {
    baseHp: 70,
    baseMp: 100,
    strength: 5,
    defense: 7,
    magic: 22,
    speed: 12,
    luck: 10,
  },
  rogue: {
    baseHp: 85,
    baseMp: 50,
    strength: 14,
    defense: 9,
    magic: 8,
    speed: 22,
    luck: 18,
  },
  paladin: {
    baseHp: 110,
    baseMp: 60,
    strength: 13,
    defense: 18,
    magic: 12,
    speed: 8,
    luck: 10,
  },
};

// ── Spell Definitions ───────────────────────────────────

const ALL_SPELLS: Record<SpellId, Omit<Spell, "currentCooldown">> = {
  fire: {
    id: "fire",
    name: "Fire",
    description: "Hurl a fireball at the enemy. Chance to burn.",
    mpCost: 12,
    cooldown: 0,
    type: "damage",
    target: "enemy",
    basePower: 28,
    statusEffect: { type: "burn", chance: 0.35, potency: 5, duration: 3 },
  },
  ice: {
    id: "ice",
    name: "Ice",
    description: "Strike with ice shards. Chance to freeze (skip turn).",
    mpCost: 14,
    cooldown: 1,
    type: "damage",
    target: "enemy",
    basePower: 24,
    statusEffect: { type: "freeze", chance: 0.25, potency: 0, duration: 1 },
  },
  lightning: {
    id: "lightning",
    name: "Lightning",
    description: "High damage lightning bolt. Ignores some defense.",
    mpCost: 18,
    cooldown: 2,
    type: "damage",
    target: "enemy",
    basePower: 40,
  },
  heal: {
    id: "heal",
    name: "Heal",
    description: "Restore HP based on magic power.",
    mpCost: 15,
    cooldown: 1,
    type: "heal",
    target: "self",
    basePower: 35,
  },
  shield: {
    id: "shield",
    name: "Shield",
    description: "Magical shield that boosts defense for several turns.",
    mpCost: 10,
    cooldown: 3,
    type: "buff",
    target: "self",
    basePower: 0,
    statusEffect: { type: "shield", chance: 1.0, potency: 12, duration: 3 },
  },
  poison: {
    id: "poison",
    name: "Poison",
    description: "Poison the enemy for damage over time.",
    mpCost: 10,
    cooldown: 0,
    type: "debuff",
    target: "enemy",
    basePower: 10,
    statusEffect: { type: "poison", chance: 0.7, potency: 6, duration: 4 },
  },
  drain: {
    id: "drain",
    name: "Drain",
    description: "Steal life force from the enemy. Damage + self heal.",
    mpCost: 16,
    cooldown: 2,
    type: "drain",
    target: "enemy",
    basePower: 22,
  },
  meteor: {
    id: "meteor",
    name: "Meteor",
    description: "Devastating AoE meteor strike. Very high cost and cooldown.",
    mpCost: 35,
    cooldown: 5,
    type: "damage",
    target: "enemy",
    basePower: 65,
    statusEffect: { type: "burn", chance: 0.5, potency: 8, duration: 2 },
  },
};

const CLASS_SPELLS: Record<CharacterClass, SpellId[]> = {
  warrior: ["fire", "shield", "heal", "drain"],
  mage: ["fire", "ice", "lightning", "heal", "shield", "poison", "drain", "meteor"],
  rogue: ["poison", "ice", "drain", "shield"],
  paladin: ["heal", "shield", "fire", "drain", "lightning"],
};

// ── Item Definitions ────────────────────────────────────

const ALL_ITEMS: Record<ItemId, Omit<InventoryItem, "quantity">> = {
  health_potion: {
    id: "health_potion",
    name: "Health Potion",
    description: "Restore 40 HP.",
    type: "heal_hp",
    potency: 40,
  },
  mana_potion: {
    id: "mana_potion",
    name: "Mana Potion",
    description: "Restore 30 MP.",
    type: "heal_mp",
    potency: 30,
  },
  antidote: {
    id: "antidote",
    name: "Antidote",
    description: "Cure all status effects.",
    type: "cure",
    potency: 0,
  },
  bomb: {
    id: "bomb",
    name: "Bomb",
    description: "Deal 35 fixed damage to the enemy.",
    type: "damage",
    potency: 35,
  },
  elixir: {
    id: "elixir",
    name: "Elixir",
    description: "Fully restore HP and MP.",
    type: "full_restore",
    potency: 0,
  },
};

const CLASS_INVENTORY: Record<CharacterClass, { id: ItemId; qty: number }[]> = {
  warrior: [
    { id: "health_potion", qty: 3 },
    { id: "mana_potion", qty: 1 },
    { id: "bomb", qty: 2 },
  ],
  mage: [
    { id: "health_potion", qty: 2 },
    { id: "mana_potion", qty: 3 },
    { id: "bomb", qty: 1 },
  ],
  rogue: [
    { id: "health_potion", qty: 2 },
    { id: "mana_potion", qty: 2 },
    { id: "bomb", qty: 2 },
    { id: "antidote", qty: 1 },
  ],
  paladin: [
    { id: "health_potion", qty: 3 },
    { id: "mana_potion", qty: 2 },
    { id: "elixir", qty: 1 },
  ],
};

// ── Factory ─────────────────────────────────────────────

export function createCharacter(
  id: string,
  name: string,
  charClass: CharacterClass
): Character {
  const profile = CLASS_STATS[charClass];

  const stats: Stats = {
    maxHp: profile.baseHp,
    hp: profile.baseHp,
    maxMp: profile.baseMp,
    mp: profile.baseMp,
    strength: profile.strength,
    defense: profile.defense,
    magic: profile.magic,
    speed: profile.speed,
    luck: profile.luck,
  };

  const spells: Spell[] = CLASS_SPELLS[charClass].map((sid) => ({
    ...ALL_SPELLS[sid],
    currentCooldown: 0,
  }));

  const inventory: InventoryItem[] = CLASS_INVENTORY[charClass].map((entry) => ({
    ...ALL_ITEMS[entry.id],
    quantity: entry.qty,
  }));

  return {
    id,
    name,
    class: charClass,
    stats,
    statusEffects: [],
    spells,
    inventory,
    isDefending: false,
    actionHistory: [],
  };
}

export { ALL_SPELLS };
