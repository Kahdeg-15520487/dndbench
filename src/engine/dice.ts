// ─────────────────────────────────────────────────────────
//  Seeded Dice Roller — single PRNG source for all combat
// ─────────────────────────────────────────────────────────

import type { AdvantageMode } from "./types.js";

//
//  Every dice roll in combat comes from this one seeded PRNG.
//  All rolls are logged and can be replayed.
//
//  Usage:
//    const dice = new DiceRoller(42);
//    const attackRoll = dice.d20("Alpha attacks Beta");
//    const damage = dice.rollDice("2d6+4", "Greatsword damage");
//
//  The seed makes battles deterministic and replayable.
// ─────────────────────────────────────────────────────────

/** A single dice roll, logged for replay/debugging */
export interface DiceRoll {
  /** Sequential roll number within this battle */
  rollNumber: number;
  /** Sides on the die (20 for d20, 6 for d6, etc.) */
  die: number;
  /** Raw die result (1–die) */
  result: number;
  /** Human-readable context string */
  context: string;
  /** Timestamp relative to battle start (ms) */
  timestamp: number;
}

/**
 * Seeded pseudo-random number generator using mulberry32.
 * Fast, deterministic, good statistical properties for games.
 */
export class DiceRoller {
  private state: number;
  private rollLog: DiceRoll[] = [];
  private rollNumber = 0;
  private startTime: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.state = seed >>> 0; // ensure unsigned 32-bit
    this.startTime = Date.now();
  }

  /** Raw PRNG output in [0, 1) */
  private next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Roll a die with n sides (1 to n). Logs the roll. */
  d(n: number, context: string): number {
    const result = Math.floor(this.next() * n) + 1;
    this.rollNumber++;
    const roll: DiceRoll = {
      rollNumber: this.rollNumber,
      die: n,
      result,
      context,
      timestamp: Date.now() - this.startTime,
    };
    this.rollLog.push(roll);
    return result;
  }

  /** Roll a d20 (the most common roll in D&D) */
  d20(context: string): number {
    return this.d(20, context);
  }

  /** Roll a d20 with advantage or disadvantage.
   *  advantage: roll 2d20, take higher
   *  disadvantage: roll 2d20, take lower
   *  normal: roll 1d20
   *  Returns { result, discarded } so callers can see both rolls.
   */
  d20WithAdvantage(mode: AdvantageMode, context: string): { result: number; discarded?: number } {
    if (mode === "normal") {
      return { result: this.d(20, context) };
    }
    const r1 = this.d(20, context + " (roll 1)");
    const r2 = this.d(20, context + " (roll 2)");
    if (mode === "advantage") {
      return r1 >= r2 ? { result: r1, discarded: r2 } : { result: r2, discarded: r1 };
    }
    // disadvantage: take lower
    return r1 <= r2 ? { result: r1, discarded: r2 } : { result: r2, discarded: r1 };
  }

  /** Roll a d4 */
  d4(context: string): number {
    return this.d(4, context);
  }

  /** Roll a d6 */
  d6(context: string): number {
    return this.d(6, context);
  }

  /** Roll a d8 */
  d8(context: string): number {
    return this.d(8, context);
  }

  /** Roll a d10 */
  d10(context: string): number {
    return this.d(10, context);
  }

  /** Roll a d12 */
  d12(context: string): number {
    return this.d(12, context);
  }

  /**
   * Roll dice using standard D&D notation.
   * Examples: "2d6", "3d8", "1d20", "4d6+3"
   * Returns the total sum.
   */
  rollDice(notation: string, context: string): number {
    // Parse: [Nd]S[+M] or [Nd]S[-M]
    const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) throw new Error(`Invalid dice notation: "${notation}"`);

    const count = parseInt(match[1]);
    const sides = parseInt(match[2]);
    const modifier = match[3] ? parseInt(match[3]) : 0;

    let total = modifier;
    for (let i = 0; i < count; i++) {
      total += this.d(sides, context);
    }
    return total;
  }

  /**
   * Roll multiple dice and return individual results + total.
   * Useful for critical hits where you need to see each die.
   */
  rollDiceDetailed(notation: string, context: string): { rolls: number[]; total: number } {
    const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!match) throw new Error(`Invalid dice notation: "${notation}"`);

    const count = parseInt(match[1]);
    const sides = parseInt(match[2]);
    const modifier = match[3] ? parseInt(match[3]) : 0;

    const rolls: number[] = [];
    for (let i = 0; i < count; i++) {
      rolls.push(this.d(sides, context));
    }
    return { rolls, total: rolls.reduce((a, b) => a + b, 0) + modifier };
  }

  /** Get all logged rolls */
  getLog(): DiceRoll[] {
    return [...this.rollLog];
  }

  /** Get roll count */
  getRollCount(): number {
    return this.rollNumber;
  }

  /** Clear the log (e.g., between battles) */
  clearLog(): void {
    this.rollLog = [];
    this.rollNumber = 0;
    this.state = this.seed >>> 0;
    this.startTime = Date.now();
  }

  /** Format the roll log for display */
  formatLog(): string {
    return this.rollLog
      .map(r => `  #${r.rollNumber} d${r.die} = ${r.result}  (${r.context})`)
      .join("\n");
  }
}
