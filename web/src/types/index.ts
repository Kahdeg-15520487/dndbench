// Tournament types
export interface Tournament {
  id: number;
  status: 'pending' | 'running' | 'completed' | 'aborted';
  config: { models: string[]; bestOf: number; maxTurns: number; kFactor: number };
  result: any | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Game {
  id: number;
  tournamentId: number | null;
  gameIndex: number;
  participantA: string;
  participantB: string;
  classA: string;
  classB: string;
  winner: string | null;
  winnerTeam: string | null;
  totalTurns: number | null;
  durationMs: number | null;
}

export interface TrainingRecord {
  id: number;
  gameId: number;
  turnNumber: number;
  actorId: string;
  actorName: string;
  actorClass: string;
  actorTeam: string | null;
  actorType: 'llm' | 'heuristic' | 'human' | 'boss';
  stateSnapshot: any;
  thinkingSteps: any[] | null;
  action: any;
  actionResult: any;
  actionTimedOut: boolean;
  actionWasBad: boolean;
}

export interface TrainingStats {
  totalRecords: number;
  totalGames: number;
  badActions: number;
  timedOut: number;
  badActionRate: number;
  byActorType: Record<string, number>;
  byActorClass: Record<string, number>;
  byActorName: Record<string, number>;
}

export interface LLMConfig {
  id: number;
  name: string;
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  isDefault: boolean;
}

export interface BossProfile {
  id: string;
  name: string;
  emoji: string;
  title: string;
  tier: number;
  description: string;
  stats: { hp: number; ac: number; str: number; dex: number; spd: number };
}

export interface EloRating {
  name: string;
  elo: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

// Battle state types (for WebSocket messages)
export interface CharState {
  id: string;
  name: string;
  team: string;
  class: string;
  hp: number;
  maxHp: number;
  ac: number;
  statusEffects: { type: string; turnsRemaining: number }[];
  position?: { x: number; y: number };
  spells: { id: string; name: string; currentCooldown: number }[];
  inventory: { id: string; name: string; quantity: number }[];
  spellSlots?: Record<string, number>;
}

export interface ChatMessage {
  id: number;
  type: 'system' | 'player' | 'enemy' | 'status' | 'info' | 'error' | 'thinking';
  text: string;
}
