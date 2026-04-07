// Engine barrel exports
export {
  createCharacter,
  CLASS_PRESETS,
  ALL_SPELLS,
  ALL_ITEMS,
} from "./characters.js";

export {
  createBoss,
  getBossProfile,
  getAllBosses,
  BOSS_ORDER,
} from "./bosses.js";

export {
  resolveAction,
  resolveMove,
  processStatusEffects,
  tickCooldowns,
  createSnapshot,
  determineTurnOrder,
  inRange,
  MELEE_RANGE,
} from "./combat.js";

export {
  DiceRoller,
  type DiceRoll,
} from "./dice.js";

export {
  // Types
  type AbilityName,
  type Stats,
  type StatusEffectType,
  type StatusEffect,
  type SpellSlotInfo,
  type SpellSlotGrid,
  type SpellId,
  type Spell,
  type ItemId,
  type InventoryItem,
  type WeaponDef,
  type ClassFeatureId,
  type ClassFeature,
  type Position,
  type MoveVector,
  type ArenaConfig,
  type Character,
  type CharacterClass,
  type BossId,
  type ActionType,
  type CombatAction,
  type DamageResult,
  type HealResult,
  type SpellResult,
  type ItemResult,
  type AbilityResult,
  type MoveResult,
  type CombatResult,
  type TurnResult,
  type ThinkingStep,
  type BattleStateSnapshot,
  type BattlePhase,
  type BattleLog,
  type ToolDefinition,
  type AgentType,
  type CharacterRole,
  type ParticipantConfig,
  type WinCondition,
  type BattleScenario,
  // Constants
  ARENA_PRESETS,
  ARENA_DEFAULT,
  TEAM_COLORS,
  // Functions
  abilityModifier,
  hasSpellSlot,
  consumeSpellSlot,
  remainingSlots,
  totalRemainingSlots,
  formatSpellSlots,
  autoArenaPreset,
  defaultStartPositions,
  generateStartPositions,
  maxMovePerTurn,
  distance,
  moveToward,
  getTeamColor,
} from "./types.js";
