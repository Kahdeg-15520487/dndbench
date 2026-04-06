// ─────────────────────────────────────────────────────────
//  Battle Runner — single battle engine for all frontends
// ─────────────────────────────────────────────────────────
//
//  The runner only knows about IAgent. It calls getAction()
//  and awaits — whether it resolves in 1ms (heuristic),
//  2s (LLM agentic loop), or 30s (human thinking) doesn't matter.
//
//  Frontends (CLI, WebSocket) subscribe to BattleEvents and
//  render however they like. Replay is always generated from
//  the BattleLog after run() completes.
// ─────────────────────────────────────────────────────────

import {
  Character,
  CombatAction,
  BattleLog,
  TurnResult,
  BattlePhase,
  CombatResult,
  ThinkingStep,
} from "../engine/types.js";
import {
  resolveAction,
  processStatusEffects,
  tickCooldowns,
  createSnapshot,
  determineTurnOrder,
} from "../engine/index.js";
import { IAgent } from "../agent/interface.js";
import { LLMAgent } from "../agent/llm-agent.js";

// ── Battle Events (for frontend rendering) ──────────────

export type BattleEvent =
  | { type: "battle_start"; characters: Character[] }
  | { type: "turn_start"; turnNumber: number; actorId: string }
  | { type: "action_chosen"; actorId: string; action: CombatAction }
  | { type: "action_result"; actorId: string; targetId: string; result: CombatResult }
  | { type: "status_tick"; characterId: string; narratives: string[] }
  | { type: "health_bars"; characters: Character[] }
  | { type: "character_defeated"; characterId: string }
  | { type: "battle_end"; winner?: string; reason: string };

export type BattleEventHandler = (event: BattleEvent) => void;

export interface BattleConfig {
  maxTurns: number;
  /** ms between turns — 0 for no delay (used when human is playing) */
  turnDelayMs: number;
  eventHandler?: BattleEventHandler;
}

const DEFAULT_CONFIG: BattleConfig = {
  maxTurns: 50,
  turnDelayMs: 1500,
};

// ── Runner ──────────────────────────────────────────────

export class BattleRunner {
  private characters: Character[];
  private agents: IAgent[];
  private agentMap: Map<string, IAgent>;
  private config: BattleConfig;
  private log: BattleLog;
  private turnNumber = 0;
  private finished = false;
  private winner?: string;

  constructor(
    characters: Character[],
    agents: IAgent[],
    config?: Partial<BattleConfig>
  ) {
    this.characters = characters;
    this.agents = agents;
    this.agentMap = new Map(agents.map((a) => [a.id, a]));
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = {
      turns: [],
      totalTurns: 0,
      startTime: new Date().toISOString(),
    };
  }

  /** Characters (mutable — runner mutates hp/mp/status during battle) */
  getCharacters(): Character[] { return this.characters; }

  /** Agents */
  getAgents(): IAgent[] { return this.agents; }

  /**
   * Run the full battle to completion.
   * Works with any IAgent implementation — heuristic, LLM, or human.
   */
  async run(): Promise<BattleLog> {
    const snapshot = createSnapshot(this.characters, 0, "ongoing");

    // Notify all agents
    for (const agent of this.agents) {
      await agent.onBattleStart?.(snapshot);
    }

    this.emit({ type: "battle_start", characters: this.characters });

    while (!this.finished && this.turnNumber < this.config.maxTurns) {
      await this.executeTurn();
      if (this.config.turnDelayMs > 0 && !this.finished) {
        await this.delay(this.config.turnDelayMs);
      }
    }

    if (!this.finished) {
      this.winner = undefined;
      this.emit({
        type: "battle_end",
        winner: undefined,
        reason: "Turn limit reached — draw!",
      });
    }

    // Notify all agents
    for (const agent of this.agents) {
      agent.onBattleEnd?.(this.winner, this.log.turns.at(-1)?.results?.[0]?.narrative || "Battle over");
    }

    this.log.endTime = new Date().toISOString();
    this.log.winner = this.winner;
    this.log.totalTurns = this.turnNumber;
    return this.log;
  }

  /**
   * Execute one full turn (all agents act, ordered by speed).
   */
  private async executeTurn(): Promise<void> {
    this.turnNumber++;
    const order = determineTurnOrder(this.characters);

    for (const character of order) {
      if (this.finished) break;

      const agent = this.agentMap.get(character.id);
      if (!agent) continue;

      this.emit({ type: "turn_start", turnNumber: this.turnNumber, actorId: character.id });

      const snapshot = createSnapshot(
        this.characters,
        this.turnNumber,
        "ongoing"
      );

      // Check if frozen
      if (character.statusEffects.some((e) => e.type === "freeze")) {
        const frozenResult: CombatResult = {
          action: { type: "wait", actorId: character.id },
          actorId: character.id,
          narrative: `❄️ ${character.name} is frozen and cannot act!`,
        };
        const target = this.getTarget(character);
        this.emit({ type: "action_result", actorId: character.id, targetId: target.id, result: frozenResult });
        agent.onActionResult?.(frozenResult);
        tickCooldowns(character);
        continue;
      }

      // ── Ask the agent for its action (the core abstraction) ──
      const action = await agent.getAction(snapshot);
      
      // Collect thinking steps from LLM agents
      let thinkingSteps: ThinkingStep[] | undefined;
      if (agent instanceof LLMAgent) {
        thinkingSteps = agent.consumeThinkingSteps();
      }
      
      this.emit({ type: "action_chosen", actorId: character.id, action });

      // Resolve action in engine
      const target = this.getTarget(character);

      // For self-targeting actions (shield, heal), the target is the actor
      const spellTarget = action.type === "cast_spell"
        ? character.spells.find(s => s.id === action.spellId)
        : null;
      const resolveTarget = (spellTarget?.target === "self" || action.type === "defend" || action.type === "wait")
        ? character
        : target;

      const result = resolveAction(character, resolveTarget, action);

      this.emit({ type: "action_result", actorId: character.id, targetId: target.id, result });
      agent.onActionResult?.(result);
      this.agentMap.get(target.id)?.onActionResult?.(result);

      // Process status effects
      this.processAllStatusEffects(character, target);

      // Tick cooldowns
      tickCooldowns(character);

      // Log the turn (before defeat check so killing blows are recorded)
      this.log.turns.push({
        turnNumber: this.turnNumber,
        actorId: character.id,
        results: [result],
        stateSnapshot: createSnapshot(this.characters, this.turnNumber, this.finished ? "finished" : "ongoing"),
        thinkingSteps,
      });

      // Check for flee
      if (result.fledSuccessfully) {
        this.finished = true;
        this.winner = target.id;
        this.emit({ type: "character_defeated", characterId: character.id });
        this.emit({ type: "battle_end", winner: this.winner, reason: `${character.name} fled!` });
        break;
      }

      // Check for defeat
      if (this.checkDefeat(character, target)) break;
    }

    // Emit health bars at end of turn
    if (!this.finished) {
      this.emit({ type: "health_bars", characters: this.characters });
    }
  }

  // ── Helpers ─────────────────────────────────────────

  private processAllStatusEffects(character: Character, target: Character) {
    const narratives = processStatusEffects(character);
    if (narratives.length > 0) {
      this.emit({ type: "status_tick", characterId: character.id, narratives });
    }
    const targetNarratives = processStatusEffects(target);
    if (targetNarratives.length > 0) {
      this.emit({ type: "status_tick", characterId: target.id, narratives: targetNarratives });
    }
  }

  private checkDefeat(character: Character, target: Character): boolean {
    if (target.stats.hp <= 0) {
      this.finished = true;
      this.winner = character.id;
      this.emit({ type: "character_defeated", characterId: target.id });
      this.emit({ type: "battle_end", winner: this.winner, reason: `${target.name} has been defeated!` });
      return true;
    }
    if (character.stats.hp <= 0) {
      this.finished = true;
      this.winner = target.id;
      this.emit({ type: "character_defeated", characterId: character.id });
      this.emit({ type: "battle_end", winner: this.winner, reason: `${character.name} collapsed!` });
      return true;
    }
    return false;
  }

  private getTarget(character: Character): Character {
    return this.characters.find((c) => c.id !== character.id)!;
  }

  private emit(event: BattleEvent): void {
    this.config.eventHandler?.(event);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
