// ─────────────────────────────────────────────────────────
//  Human Agent — Promise-based, resolves on human input
// ─────────────────────────────────────────────────────────
//
//  The engine calls getAction() and awaits the Promise.
//  The Promise resolves when the human submits their action
//  via the WebSocket UI (or any caller that calls submitAction()).
//
//  This means the battle runner treats humans identically to
//  any other agent — it just waits longer for the answer.
// ─────────────────────────────────────────────────────────

import { IAgent } from "./interface.js";
import {
  BattleStateSnapshot,
  CombatAction,
  CombatResult,
} from "../engine/types.js";

export class HumanAgent implements IAgent {
  readonly type = "human" as const;

  /** Resolves when the human submits an action */
  private pendingResolver: ((action: CombatAction) => void) | null = null;

  /** Latest state snapshot (for UI to read if needed) */
  private currentState: BattleStateSnapshot | null = null;

  /** Callback to notify the outside world that we're waiting for input */
  private onWaitingForInput?: (state: BattleStateSnapshot) => void;

  constructor(
    public readonly id: string,
    public readonly name: string,
    opts?: { onWaitingForInput?: (state: BattleStateSnapshot) => void }
  ) {
    this.onWaitingForInput = opts?.onWaitingForInput;
  }

  onBattleStart(state: BattleStateSnapshot): void {
    this.currentState = state;
  }

  async getAction(snapshot: BattleStateSnapshot): Promise<CombatAction> {
    this.currentState = snapshot;

    // Notify that we're waiting (used by server to send "your_turn" to client)
    this.onWaitingForInput?.(snapshot);

    // Return a promise that resolves when submitAction() is called
    return new Promise<CombatAction>((resolve) => {
      this.pendingResolver = resolve;
    });
  }

  /**
   * Submit an action from the human (called by WebSocket handler, CLI, etc.)
   * Resolves the pending getAction() promise.
   */
  submitAction(action: CombatAction): void {
    if (this.pendingResolver) {
      const resolver = this.pendingResolver;
      this.pendingResolver = null;
      resolver(action);
    }
  }

  /**
   * Check if we're currently waiting for human input.
   */
  get isWaiting(): boolean {
    return this.pendingResolver !== null;
  }

  onActionResult(_result: CombatResult): void {}

  onBattleEnd(_winner?: string, _reason?: string): void {
    // If battle ends while waiting for input, resolve with a no-op
    if (this.pendingResolver) {
      const resolver = this.pendingResolver;
      this.pendingResolver = null;
      resolver({ type: "wait", actorId: this.id });
    }
  }

  destroy(): void {
    if (this.pendingResolver) {
      this.pendingResolver({ type: "wait", actorId: this.id });
      this.pendingResolver = null;
    }
  }
}
