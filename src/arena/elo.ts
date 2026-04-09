// ─────────────────────────────────────────────────────────
//  ELO Rating System & Model Statistics
// ─────────────────────────────────────────────────────────
//
//  Standard ELO with configurable K-factor.
//  Tracks per-model battle statistics:
//    - Wins / losses / draws
//    - Tool call efficiency (successful vs bad actions)
//    - Average tool calls per turn
//    - Bad actions: attack out of range, cast out of range, etc.
// ─────────────────────────────────────────────────────────

export interface ModelStats {
  model: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  matchesPlayed: number;

  // Per-turn stats (accumulated across all turns in all battles)
  totalTurns: number;           // total turns this model has taken
  totalToolCalls: number;       // total tool calls made
  totalBadActions: number;      // actions that "don't make sense"

  // Battle outcomes by class
  battlesAsWarrior: number;
  battlesAsMage: number;
  battlesAsRogue: number;
  battlesAsPaladin: number;
  winsAsWarrior: number;
  winsAsMage: number;
  winsAsRogue: number;
  winsAsPaladin: number;

  // Is this the heuristic baseline?
  isHeuristic: boolean;
}

export function createModelStats(model: string, initialElo = 1000, isHeuristic = false): ModelStats {
  return {
    model,
    elo: initialElo,
    wins: 0,
    losses: 0,
    draws: 0,
    matchesPlayed: 0,
    totalTurns: 0,
    totalToolCalls: 0,
    totalBadActions: 0,
    battlesAsWarrior: 0,
    battlesAsMage: 0,
    battlesAsRogue: 0,
    battlesAsPaladin: 0,
    winsAsWarrior: 0,
    winsAsMage: 0,
    winsAsRogue: 0,
    winsAsPaladin: 0,
    isHeuristic,
  };
}

// ── ELO Calculation ─────────────────────────────────────

const DEFAULT_K_FACTOR = 32;

/**
 * Calculate expected score for player A against player B.
 * E_A = 1 / (1 + 10^((R_B - R_A) / 400))
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Update ELO ratings after a match.
 * Returns [newRatingA, newRatingB].
 *
 * scoreA: 1 = A wins, 0 = B wins, 0.5 = draw
 */
export function updateElo(
  ratingA: number,
  ratingB: number,
  scoreA: number,
  kFactor: number = DEFAULT_K_FACTOR,
): [number, number] {
  const eA = expectedScore(ratingA, ratingB);
  const eB = 1 - eA;
  const scoreB = 1 - scoreA;

  const newA = Math.round(ratingA + kFactor * (scoreA - eA));
  const newB = Math.round(ratingB + kFactor * (scoreB - eB));

  return [newA, newB];
}

/**
 * Update stats for both models after a match.
 * scoreA: 1 = A wins, 0 = B wins, 0.5 = draw
 */
export function updateStatsAfterMatch(
  statsA: ModelStats,
  statsB: ModelStats,
  scoreA: number,
  kFactor: number = DEFAULT_K_FACTOR,
): void {
  const [newEloA, newEloB] = updateElo(statsA.elo, statsB.elo, scoreA, kFactor);
  statsA.elo = newEloA;
  statsB.elo = newEloB;

  statsA.matchesPlayed++;
  statsB.matchesPlayed++;

  if (scoreA === 1) {
    statsA.wins++;
    statsB.losses++;
  } else if (scoreA === 0) {
    statsA.losses++;
    statsB.wins++;
  } else {
    statsA.draws++;
    statsB.draws++;
  }
}

// ── Bad action detection ────────────────────────────────

/**
 * Analyze a combat result to detect "bad" actions.
 * Returns true if the action was obviously suboptimal.
 */
/** @deprecated Use result.badAction field from CombatResult instead */
export function isBadAction(narrative: string): boolean {
  const lower = narrative.toLowerCase();
  if (lower.includes("too far away")) return true;
  if (lower.includes("no target")) return true;
  if (lower.includes("unknown spell")) return true;
  if (lower.includes("doesn't have that item")) return true;
  if (lower.includes("no uses remaining")) return true;
  if (lower.includes("is on cooldown")) return true;
  if (lower.includes("no spell slots left")) return true;
  if (lower.includes("doesn't have ability")) return true;
  return false;
}
