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
  speed: number;      // turn order + dodge chance + movement speed
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
  range: number;          // max distance to target (0 = melee, Infinity = unlimited)
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
  range: number; // max distance to target (0 = self-use, Infinity = unlimited)
}

// ── Arena / Position ────────────────────────────────────

/** 2D float position on the battlefield */
export interface Position {
  x: number;
  y: number;
}

/** Movement vector (dx, dy) — clamped to character's maxMovePerTurn */
export interface MoveVector {
  dx: number;
  dy: number;
}

/** Arena configuration — defines the battlefield */
export interface ArenaConfig {
  width: number;   // arena width in units
  height: number;  // arena height in units
  label: string;   // "Arena" or boss name
}

/** Predefined arena sizes — auto-scales with participant count via autoArenaPreset() */
export const ARENA_PRESETS: Record<string, ArenaConfig> = {
  small:      { width: 16, height: 10, label: "Small Arena" },
  medium:     { width: 20, height: 12, label: "Arena" },
  large:      { width: 28, height: 16, label: "Large Arena" },
  boss_room:  { width: 24, height: 16, label: "Boss Room" },
  grand:      { width: 36, height: 20, label: "Grand Colosseum" },
};

/** Default alias for backward compat */
export const ARENA_DEFAULT = ARENA_PRESETS.medium;

/** Pick arena preset based on participant count */
export function autoArenaPreset(participantCount: number): ArenaConfig {
  if (participantCount <= 2) return ARENA_PRESETS.medium;
  if (participantCount <= 4) return ARENA_PRESETS.large;
  return ARENA_PRESETS.grand;
}

/** Default starting positions for 1v1 */
export function defaultStartPositions(arena: ArenaConfig): [Position, Position] {
  return [
    { x: 4, y: arena.height / 2 },
    { x: arena.width - 4, y: arena.height / 2 },
  ];
}

/**
 * Generate starting positions for N participants split into teams.
 * Teams are spaced evenly along opposing edges.
 * Same-team members are spread vertically.
 */
export function generateStartPositions(
  participants: { team: string }[],
  arena: ArenaConfig
): Position[] {
  const uniqueTeams = [...new Set(participants.map(p => p.team))];
  const teamCount = uniqueTeams.length;
  const margin = 3;

  // FFA: spread everyone in a circle
  if (teamCount === participantCount(participants.length)) {
    const cx = arena.width / 2;
    const cy = arena.height / 2;
    const radius = Math.min(arena.width, arena.height) * 0.35;
    return participants.map((_, i) => {
      const angle = (2 * Math.PI * i) / participants.length - Math.PI / 2;
      return {
        x: Math.round((cx + Math.cos(angle) * radius) * 10) / 10,
        y: Math.round((cy + Math.sin(angle) * radius) * 10) / 10,
      };
    });
  }

  // Team-based: spread teams along x-axis
  // For 2 teams: left vs right. For 3+: evenly spaced.
  const positions: Position[] = [];
  for (let ti = 0; ti < uniqueTeams.length; ti++) {
    const team = uniqueTeams[ti];
    const teamMembers = participants.filter(p => p.team === team);
    const count = teamMembers.length;

    // X position: spread teams across arena width
    const xBase = teamCount === 2
      ? (ti === 0 ? margin : arena.width - margin)
      : margin + (arena.width - 2 * margin) * (ti / (teamCount - 1));

    // Y positions: spread members vertically, centered
    const ySpacing = Math.min(
      (arena.height - 2 * margin) / Math.max(count, 1),
      3.0  // max 3 units apart
    );
    const yStart = arena.height / 2 - (count - 1) * ySpacing / 2;

    for (let mi = 0; mi < count; mi++) {
      positions.push({
        x: Math.round(xBase * 10) / 10,
        y: Math.round((yStart + mi * ySpacing) * 10) / 10,
      });
    }
  }

  return positions;
}

/** Helper to avoid circular ref */
function participantCount(n: number): number { return n; }

/** Max movement per turn based on speed stat */
export function maxMovePerTurn(speed: number): number {
  return 1.0 + speed * 0.15; // speed 10 → 2.5 units/turn, speed 22 → 4.3 units/turn
}

/** Distance between two positions */
export function distance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Compute a movement vector toward a target, clamped to max distance */
export function moveToward(from: Position, to: Position, maxMove: number): MoveVector | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= 0.1) return undefined; // already there
  const scale = Math.min(1, maxMove / dist);
  return { dx: Math.round(dx * scale * 10) / 10, dy: Math.round(dy * scale * 10) / 10 };
}

// ── Character (extended with position) ──────────────────

export interface Character {
  id: string;
  name: string;
  team: string;           // arbitrary team tag — same team = allies
  class: CharacterClass;
  stats: Stats;
  statusEffects: StatusEffect[];
  spells: Spell[];
  inventory: InventoryItem[];
  isDefending: boolean;
  actionHistory: string[]; // last N action names
  position: Position;      // 2D position on the battlefield
}

export type CharacterClass = "warrior" | "mage" | "rogue" | "paladin";

export type BossId =
  | "goblin_king"
  | "dark_wizard"
  | "ancient_dragon"
  | "lich_lord"
  | "demon_lord";

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

/** A full turn action: optional move + mandatory action */
export interface CombatAction {
  type: ActionType;
  actorId: string;
  targetId?: string;      // who to target
  spellId?: string;
  itemId?: string;
  move?: MoveVector;      // movement before acting (optional)
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

export interface MoveResult {
  from: Position;
  to: Position;
  distanceMoved: number;
  outOfRange?: boolean; // if true, the action part was blocked by range
}

export interface CombatResult {
  action: CombatAction;
  actorId: string;
  targetId?: string;
  narrative: string;
  move?: MoveResult;     // movement resolution (present if move was requested)
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
  thinkingSteps?: ThinkingStep[];
}

export interface ThinkingStep {
  type: "thinking" | "tool_call" | "tool_result";
  text: string;
  toolName?: string;
  toolParams?: any;
  toolResult?: string;
}

export interface BattleStateSnapshot {
  characters: {
    id: string;
    name: string;
    team: string;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    statusEffects: { type: StatusEffectType; turnsRemaining: number }[];
    isDefending: boolean;
    position: Position;
    spells: { id: string; name: string; type: string; description: string; target: string; mpCost: number; basePower: number; range: number; cooldown: number; currentCooldown: number; statusEffect?: { type: string; chance: number; potency: number; duration: number } }[];
    inventory: { id: string; name: string; description: string; quantity: number; type: string; potency: number; range: number }[];
  }[];
  turnNumber: number;
  phase: BattlePhase;
  arena: ArenaConfig;
}

export type BattlePhase = "ongoing" | "finished";

export interface BattleLog {
  turns: TurnResult[];
  winner?: string;
  totalTurns: number;
  startTime: string;
  endTime?: string;
  arena: ArenaConfig;
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

// ── Scenario / Team Types ───────────────────────────────

/** What kind of agent controls this participant */
export type AgentType = "heuristic" | "llm" | "human" | "boss";

/** What role to play as */
export type CharacterRole = CharacterClass | BossId;

/** One fighter in a scenario */
export interface ParticipantConfig {
  name: string;               // display name used for targeting (e.g. "Alpha")
  team: string;               // arbitrary team tag — same team = allies (e.g. "red", "blue")
  role: CharacterRole;        // warrior, mage, rogue, paladin, or a BossId
  agent: AgentType;           // who controls this participant
  model?: string;             // LLM model name (only for agent: "llm")
  position?: Position;        // override spawn position; auto-assigned if omitted
}

/** Win condition for the battle */
export type WinCondition =
  | "last_team_standing"       // default: when only one team has living members
  | "last_unit_standing";      // FFA: when only one unit is alive

/** Complete battle configuration — any scenario can be described with this */
export interface BattleScenario {
  participants: ParticipantConfig[];
  arena: ArenaConfig;
  winCondition?: WinCondition;  // default: last_team_standing
  maxTurns?: number;            // default: 50
}

/** Team colors for rendering */
export const TEAM_COLORS: Record<string, string> = {
  a: "#4488ff",
  b: "#ff4444",
  red: "#ff4444",
  blue: "#4488ff",
  boss: "#aa44ff",
  raid: "#44cc88",
  players: "#44cc88",
  1: "#ff6666",
  2: "#66aaff",
  3: "#66ff66",
  4: "#ffaa44",
  5: "#ff66ff",
  6: "#66ffff",
  7: "#ffff66",
  8: "#cc88ff",
};

/** Get team color, with fallback hash for unknown team names */
export function getTeamColor(team: string): string {
  if (TEAM_COLORS[team]) return TEAM_COLORS[team];
  // Deterministic hash for unknown team names
  let hash = 0;
  for (let i = 0; i < team.length; i++) hash = team.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 70%, 55%)`;
}
