// Core RPG Types — D&D 5e Mechanics
import type { DiceRoll } from "./dice.js";

// ── Ability Scores ──
export type AbilityName = "str" | "dex" | "con" | "int" | "wis" | "cha";

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

// ── Stats ──
export interface Stats {
  maxHp: number;
  hp: number;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  ac: number;
  proficiencyBonus: number;
  speed: number;
}

// ── Status Effects ──
export type StatusEffectType =
  | "burn" | "freeze" | "poison" | "shield" | "defending"
  | "haste" | "slow" | "regen" | "blind" | "paralyzed";

export interface StatusEffect {
  type: StatusEffectType;
  turnsRemaining: number;
  potency: number;
  sourceId: string;
}

// ── Spell Slots ──
export interface SpellSlotInfo { total: number; used: number; }
export type SpellSlotGrid = Record<number, SpellSlotInfo>;

export function hasSpellSlot(slots: SpellSlotGrid, level: number): boolean {
  if (level === 0) return true;
  const s = slots[level];
  return s != null && s.used < s.total;
}

export function consumeSpellSlot(slots: SpellSlotGrid, level: number): boolean {
  if (level === 0) return true;
  const s = slots[level];
  if (!s || s.used >= s.total) return false;
  s.used++;
  return true;
}

export function remainingSlots(slots: SpellSlotGrid, level: number): number {
  const s = slots[level];
  return s ? s.total - s.used : 0;
}

export function totalRemainingSlots(slots: SpellSlotGrid): number {
  let t = 0;
  for (const k of Object.keys(slots)) t += remainingSlots(slots, Number(k));
  return t;
}

export function formatSpellSlots(slots: SpellSlotGrid): string {
  const parts: string[] = [];
  const ord = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
  for (const k of Object.keys(slots)) {
    const lv = Number(k);
    const s = slots[lv];
    if (s.total > 0) parts.push(ord[lv] + ":" + (s.total - s.used) + "/" + s.total);
  }
  return parts.join(" ") || "None";
}

// ── Spells ──
export type SpellId =
  | "fire_bolt" | "magic_missile" | "shield" | "thunderwave"
  | "scorching_ray" | "hold_person" | "fireball" | "lightning_bolt"
  | "cure_wounds" | "shield_of_faith";

export interface Spell {
  id: SpellId;
  name: string;
  description: string;
  level: number;
  range: number;
  type: "damage" | "heal" | "buff";
  target: "enemy" | "self";
  attackRoll?: boolean;
  saveAbility?: AbilityName;
  halfDamageOnSave?: boolean;
  damageDice?: string;
  damageType?: string;
  healDice?: string;
  healAbilityMod?: AbilityName;
  castingAbility: AbilityName;
  statusEffect?: { type: StatusEffectType; potency: number; duration: number };
  cooldown: number;
  currentCooldown: number;
}

// ── Weapons ──
export interface WeaponDef {
  name: string;
  damageDice: string;
  abilityMod: AbilityName;
  range: number;
  properties: string[];
}

// ── Class Features ──
export type ClassFeatureId =
  | "extra_attack" | "sneak_attack" | "second_wind" | "action_surge"
  | "divine_smite" | "lay_on_hands" | "evasion" | "cunning_action" | "arcane_recovery";

export interface ClassFeature {
  id: ClassFeatureId;
  name: string;
  description: string;
  usesPerBattle: number;
  usesRemaining: number;
}

// ── Items ──
export type ItemId =
  | "health_potion" | "greater_health_potion" | "antidote" | "bomb" | "elixir";

export interface InventoryItem {
  id: ItemId;
  name: string;
  description: string;
  quantity: number;
  type: "heal_hp" | "cure" | "damage" | "full_restore";
  potency: number;
  range: number;
}

// ── Arena / Position ──
export interface Position { x: number; y: number; }
export interface MoveVector { dx: number; dy: number; }

export interface ArenaConfig {
  width: number;
  height: number;
  label: string;
}

export const ARENA_PRESETS: Record<string, ArenaConfig> = {
  small:      { width: 60,  height: 40,  label: "Small Arena" },
  medium:     { width: 100, height: 60,  label: "Arena" },
  large:      { width: 140, height: 80,  label: "Large Arena" },
  boss_room:  { width: 120, height: 80,  label: "Boss Room" },
  grand:      { width: 180, height: 100, label: "Grand Colosseum" },
};

export const ARENA_DEFAULT = ARENA_PRESETS.medium;

export function autoArenaPreset(count: number): ArenaConfig {
  if (count <= 2) return ARENA_PRESETS.medium;
  if (count <= 4) return ARENA_PRESETS.large;
  return ARENA_PRESETS.grand;
}

export function defaultStartPositions(arena: ArenaConfig): [Position, Position] {
  return [
    { x: 10, y: arena.height / 2 },
    { x: arena.width - 10, y: arena.height / 2 },
  ];
}

export function generateStartPositions(
  participants: { team: string }[],
  arena: ArenaConfig,
): Position[] {
  const teams = [...new Set(participants.map(p => p.team))];
  const margin = 10;

  if (teams.length === participants.length) {
    const cx = arena.width / 2;
    const cy = arena.height / 2;
    const radius = Math.min(arena.width, arena.height) * 0.35;
    return participants.map((_, i) => {
      const angle = (2 * Math.PI * i) / participants.length - Math.PI / 2;
      return { x: Math.round(cx + Math.cos(angle) * radius), y: Math.round(cy + Math.sin(angle) * radius) };
    });
  }

  const positions: Position[] = [];
  for (let ti = 0; ti < teams.length; ti++) {
    const teamMembers = participants.filter(p => p.team === teams[ti]);
    const count = teamMembers.length;
    const xBase = teams.length === 2
      ? (ti === 0 ? margin : arena.width - margin)
      : margin + (arena.width - 2 * margin) * (ti / (teams.length - 1));
    const ySpacing = Math.min((arena.height - 2 * margin) / Math.max(count, 1), 8);
    const yStart = arena.height / 2 - (count - 1) * ySpacing / 2;
    for (let mi = 0; mi < count; mi++) {
      positions.push({ x: Math.round(xBase), y: Math.round(yStart + mi * ySpacing) });
    }
  }
  return positions;
}

export function maxMovePerTurn(speed: number): number {
  return speed;
}

export function distance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function moveToward(from: Position, to: Position, maxMove: number): MoveVector | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 0.5) return undefined;
  const scale = Math.min(1, maxMove / dist);
  return { dx: Math.round(dx * scale), dy: Math.round(dy * scale) };
}

// ── Character ──
export type CharacterClass = "warrior" | "mage" | "rogue" | "paladin";
export type BossId = "goblin_king" | "dark_wizard" | "ancient_dragon" | "lich_lord" | "demon_lord";

export interface Character {
  id: string;
  name: string;
  team: string;
  class: CharacterClass | "boss";
  level: number;
  stats: Stats;
  statusEffects: StatusEffect[];
  spells: Spell[];
  inventory: InventoryItem[];
  isDefending: boolean;
  actionHistory: string[];
  position: Position;
  // D&D 5e additions
  spellSlots: SpellSlotGrid;
  weapon: WeaponDef;
  features: ClassFeature[];
  savingThrowProfs: AbilityName[];
}

// ── Combat Types ──
export type ActionType =
  | "attack" | "defend" | "cast_spell" | "use_item"
  | "wait" | "flee" | "class_ability" | "dash";

export interface CombatAction {
  type: ActionType;
  actorId: string;
  targetId?: string;
  spellId?: string;
  itemId?: string;
  abilityId?: string;
  move?: MoveVector;
}

export interface DamageResult {
  damage: number;
  wasCrit: boolean;
  wasMiss: boolean;
  effective: "normal";
  targetHp: number;
  targetMaxHp: number;
  statusApplied?: StatusEffectType;
  attackRoll?: number;
  attackTotal?: number;
  targetAc?: number;
  damageRolls?: number[];
  saveRoll?: number;
  saveDc?: number;
  saveSuccess?: boolean;
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
  slotUsed?: number;
  slotsRemaining?: Record<number, number>;
  cooldownRemaining: number;
  statusApplied?: StatusEffectType;
}

export interface ItemResult { itemName: string; effect: string; value: number; remaining: number; }
export interface AbilityResult { name: string; description: string; value: number; }
export interface MoveResult { from: Position; to: Position; distanceMoved: number; outOfRange?: boolean; }

export interface CombatResult {
  action: CombatAction; actorId: string; targetId?: string; narrative: string;
  move?: MoveResult; damage?: DamageResult; extraAttacks?: DamageResult[];
  heal?: HealResult; spell?: SpellResult; item?: ItemResult; abilityResult?: AbilityResult;
  fled?: boolean; fledSuccessfully?: boolean;
}

export interface TurnResult {
  turnNumber: number; actorId: string; results: CombatResult[];
  stateSnapshot: BattleStateSnapshot; thinkingSteps?: ThinkingStep[]; diceLog?: DiceRoll[];
}

export interface ThinkingStep {
  type: "thinking" | "tool_call" | "tool_result";
  text: string; toolName?: string; toolParams?: any; toolResult?: string;
}

export interface BattleStateSnapshot {
  characters: {
    id: string; name: string; team: string; class: string; level: number;
    hp: number; maxHp: number; ac: number; speed: number;
    str: number; dex: number; con: number; int: number; wis: number; cha: number;
    proficiencyBonus: number;
    spellSlots: Record<number, SpellSlotInfo>;
    statusEffects: { type: StatusEffectType; turnsRemaining: number }[];
    isDefending: boolean; position: Position;
    spells: { id: string; name: string; type: string; description: string; target: string; level: number; range: number; cooldown: number; currentCooldown: number; castingAbility: string; damageDice?: string; healDice?: string; attackRoll?: boolean; saveAbility?: string; statusEffect?: { type: string; potency: number; duration: number } }[];
    inventory: { id: string; name: string; description: string; quantity: number; type: string; potency: number; range: number }[];
    features: { id: string; name: string; description: string; usesPerBattle: number; usesRemaining: number }[];
    weapon: { name: string; damageDice: string; abilityMod: string; range: number };
    savingThrowProfs: string[];
  }[];
  turnNumber: number; phase: BattlePhase; arena: ArenaConfig;
}

export type BattlePhase = "ongoing" | "finished";

export interface BattleLog {
  turns: TurnResult[]; winner?: string; totalTurns: number;
  startTime: string; endTime?: string; arena: ArenaConfig; diceSeed?: number;
}

export interface ToolDefinition {
  name: string; description: string;
  parameters: Record<string, { type: string; description: string; enum?: string[]; required?: boolean }>;
}

export type AgentType = "heuristic" | "llm" | "human" | "boss";
export type CharacterRole = CharacterClass | BossId;

export interface ParticipantConfig {
  name: string; team: string; role: CharacterRole;
  agent: AgentType; model?: string; position?: Position;
}

export type WinCondition = "last_team_standing" | "last_unit_standing";

export interface BattleScenario {
  participants: ParticipantConfig[]; arena: ArenaConfig;
  winCondition?: WinCondition; maxTurns?: number;
}

export const TEAM_COLORS: Record<string, string> = {
  a: "#4488ff", b: "#ff4444", red: "#ff4444", blue: "#4488ff",
  boss: "#aa44ff", raid: "#44cc88", players: "#44cc88",
  1: "#ff6666", 2: "#66aaff", 3: "#66ff66", 4: "#ffaa44",
  5: "#ff66ff", 6: "#66ffff", 7: "#ffff66", 8: "#cc88ff",
};

export function getTeamColor(team: string): string {
  if (TEAM_COLORS[team]) return TEAM_COLORS[team];
  let hash = 0;
  for (let i = 0; i < team.length; i++) hash = team.charCodeAt(i) + ((hash << 5) - hash);
  return "hsl(" + (Math.abs(hash) % 360) + ",70%,55%)";
}
