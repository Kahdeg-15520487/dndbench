// ─────────────────────────────────────────────────────────
//  Core RPG Types
// ─────────────────────────────────────────────────────────

export interface Stats {
  maxHp: number;
  hp: number;
  maxMp: number;
  mp: number;
  strength: number;   // physical damage
  defense: number;    // physical mitigation
  magic: number;      // spell power
  speed: number;      // turn order + dodge chance
  luck: number;       // crit chance
}

export type StatusEffectType =
  | "burn"
  | "freeze"
  | "poison"
  | "shield"
  | "defending"
  | "haste"
  | "slow"
  | "regen"
  | "blind";

export interface StatusEffect {
  type: StatusEffectType;
  turnsRemaining: number;
  potency: number; // effect-specific magnitude
  sourceId: string; // who applied it
}

export type SpellId =
  | "fire"
  | "ice"
  | "lightning"
  | "heal"
  | "shield"
  | "poison"
  | "drain"
  | "meteor";

export interface Spell {
  id: SpellId;
  name: string;
  description: string;
  mpCost: number;
  cooldown: number;        // turns of cooldown after use (0 = no cooldown)
  currentCooldown: number; // remaining cooldown
  type: "damage" | "heal" | "buff" | "debuff" | "drain";
  target: "enemy" | "self";
  basePower: number;
  statusEffect?: {
    type: StatusEffectType;
    chance: number;   // 0.0–1.0
    potency: number;
    duration: number;
  };
}

export type ItemId =
  | "health_potion"
  | "mana_potion"
  | "antidote"
  | "bomb"
  | "elixir";

export interface InventoryItem {
  id: ItemId;
  name: string;
  description: string;
  quantity: number;
  type: "heal_hp" | "heal_mp" | "cure" | "damage" | "full_restore";
  potency: number;
}

export interface Character {
  id: string;
  name: string;
  class: CharacterClass;
  stats: Stats;
  statusEffects: StatusEffect[];
  spells: Spell[];
  inventory: InventoryItem[];
  isDefending: boolean;
  actionHistory: string[]; // last N action names
}

export type CharacterClass = "warrior" | "mage" | "rogue" | "paladin";

// ─────────────────────────────────────────────────────────
//  Combat Types
// ─────────────────────────────────────────────────────────

export type ActionType =
  | "attack"
  | "defend"
  | "cast_spell"
  | "use_item"
  | "wait"
  | "flee";

export interface CombatAction {
  type: ActionType;
  actorId: string;
  targetId?: string;      // who to target
  spellId?: SpellId;
  itemId?: ItemId;
}

export interface DamageResult {
  damage: number;
  wasCrit: boolean;
  wasMiss: boolean;
  effective: "normal" | "super" | "not_very";
  targetHp: number;
  targetMaxHp: number;
  statusApplied?: StatusEffectType;
}

export interface HealResult {
  amount: number;
  targetHp: number;
  targetMaxHp: number;
}

export interface SpellResult {
  spellName: string;
  damage?: DamageResult;
  heal?: HealResult;
  mpRemaining: number;
  statusApplied?: StatusEffectType;
  cooldownRemaining: number;
}

export interface ItemResult {
  itemName: string;
  effect: string;
  value: number;
  remaining: number;
}

export interface CombatResult {
  action: CombatAction;
  actorId: string;
  targetId?: string;
  narrative: string;
  damage?: DamageResult;
  heal?: HealResult;
  spell?: SpellResult;
  item?: ItemResult;
  fled?: boolean;
  fledSuccessfully?: boolean;
}

export interface TurnResult {
  turnNumber: number;
  actorId: string;
  results: CombatResult[];
  stateSnapshot: BattleStateSnapshot;
}

export interface BattleStateSnapshot {
  characters: {
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    statusEffects: { type: StatusEffectType; turnsRemaining: number }[];
    isDefending: boolean;
    spells: { id: string; name: string; currentCooldown: number }[];
    inventory: { id: string; name: string; quantity: number }[];
  }[];
  turnNumber: number;
  phase: BattlePhase;
}

export type BattlePhase = "ongoing" | "finished";

export interface BattleLog {
  turns: TurnResult[];
  winner?: string;
  totalTurns: number;
  startTime: string;
  endTime?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    enum?: string[];
    required?: boolean;
  }>;
}
