// ─────────────────────────────────────────────────────────
//  Agent Interface — unified contract for all participants
// ─────────────────────────────────────────────────────────

import { BattleStateSnapshot, CombatAction, CombatResult } from "../engine/types.js";

/**
 * Every participant in the arena implements this interface.
 *
 * The battle engine only knows about IAgent. It doesn't care whether
 * the participant is a heuristic script, an LLM, or a human at a keyboard.
 *
 * Lifecycle:
 *   1. constructor()       — create the agent
 *   2. onBattleStart()     — notify battle is starting
 *   3. getAction(state)    — ask for next move (may take ms or minutes)
 *   4. onActionResult()    — notify what happened
 *   5. onBattleEnd()       — notify battle is over
 *   6. destroy()           — cleanup
 *
 * For each turn, the engine calls getAction() and awaits the result.
 * - HeuristicAgent: resolves instantly
 * - LLMAgent: resolves after agentic loop (observe → think → act)
 * - HumanAgent: resolves when the human clicks a button
 */
export interface IAgent {
  /** Unique ID matching the Character ID */
  readonly id: string;

  /** Display name */
  readonly name: string;

  /** Human-readable type for logging/UI */
  readonly type: "heuristic" | "llm" | "human";

  /**
   * Called once when the battle begins.
   * Use for setup, initial analysis, etc.
   */
  onBattleStart?(state: BattleStateSnapshot): void | Promise<void>;

  /**
   * Core method: decide your next action.
   *
   * The engine awaits this — it can resolve instantly (heuristic),
   * after a multi-step LLM loop, or when a human clicks a button.
   *
   * @param state Full battle state snapshot
   * @returns The combat action to execute
   */
  getAction(state: BattleStateSnapshot): Promise<CombatAction>;

  /**
   * Called after every action resolves (yours or the enemy's).
   * Use to update internal state, conversation history, etc.
   */
  onActionResult?(result: CombatResult): void;

  /**
   * Called when the battle ends.
   */
  onBattleEnd?(winner: string | undefined, reason: string): void;

  /**
   * Cleanup. Called on disconnect / battle reset.
   */
  destroy?(): void;
}
