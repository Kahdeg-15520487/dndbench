// ─────────────────────────────────────────────────────────
//  Battle Runner — generic multi-unit battle engine
// ─────────────────────────────────────────────────────────
//
//  Supports any scenario: 1v1, 2v2, raid boss, FFA.
//  Teams are determined by the `team` field on Character.
//  Battle ends when:
//    - last_team_standing: only one team has living members
//    - last_unit_standing: only one unit alive (FFA)
//    - turn limit reached: draw
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
  ArenaConfig,
  WinCondition,
  Position,
} from "../engine/types.js";
import {
  resolveAction,
  resolveMove,
  processStatusEffects,
  tickCooldowns,
  createSnapshot,
  determineTurnOrder,
  ARENA_PRESETS,
  ARENA_DEFAULT,
  defaultStartPositions,
  generateStartPositions,
  DiceRoller,
} from "../engine/index.js";
import { IAgent } from "../agent/interface.js";
import { LLMAgent } from "../agent/llm-agent.js";

// ── Battle Events (for frontend rendering) ──────────────

export type BattleEvent =
  | { type: "battle_start"; characters: Character[]; arena: ArenaConfig }
  | { type: "turn_start"; turnNumber: number; actorId: string }
  | { type: "move"; actorId: string; from: Position; to: Position; distance: number }
  | { type: "action_chosen"; actorId: string; action: CombatAction }
  | { type: "action_result"; actorId: string; targetId: string; result: CombatResult }
  | { type: "status_tick"; characterId: string; narratives: string[] }
  | { type: "health_bars"; characters: Character[] }
  | { type: "character_defeated"; characterId: string }
  | { type: "battle_end"; winner?: string; winningTeam?: string; reason: string };

export type BattleEventHandler = (event: BattleEvent) => void;

export interface BattleConfig {
  maxTurns: number;
  /** ms between turns — 0 for no delay (used when human is playing) */
  turnDelayMs: number;
  eventHandler?: BattleEventHandler;
  /** Arena configuration — auto-picked by participant count if not provided */
  arena?: ArenaConfig;
  /** When does the battle end? Default: "last_team_standing" */
  winCondition?: WinCondition;
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
  private arena: ArenaConfig;
  private winCondition: WinCondition;
  private log: BattleLog;
  private dice: DiceRoller;
  private turnNumber = 0;
  private finished = false;
  private winner?: string;         // winning character id
  private winningTeam?: string;    // winning team tag

  constructor(
    characters: Character[],
    agents: IAgent[],
    config?: Partial<BattleConfig>
  ) {
    this.characters = characters;
    this.agents = agents;
    this.agentMap = new Map(agents.map((a) => [a.id, a]));
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.arena = this.config.arena ?? ARENA_DEFAULT;
    this.winCondition = this.config.winCondition ?? "last_team_standing";
    const diceSeed = Math.floor(Math.random() * 2147483647);
    this.dice = new DiceRoller(diceSeed);
    this.log = {
      turns: [],
      totalTurns: 0,
      startTime: new Date().toISOString(),
      arena: this.arena,
      diceSeed,
    };

    // Set starting positions for any character that hasn't been placed
    this.initializePositions();
  }

  /** Characters (mutable — runner mutates hp/mp/status during battle) */
  getCharacters(): Character[] { return this.characters; }

  /** Living characters only */
  getLiving(): Character[] { return this.characters.filter(c => c.stats.hp > 0); }

  /** Agents */
  getAgents(): IAgent[] { return this.agents; }

  /** Run the full battle to completion */
  async run(): Promise<BattleLog> {
    const snapshot = createSnapshot(this.characters, 0, "ongoing", this.arena);

    // Notify all agents
    for (const agent of this.agents) {
      await agent.onBattleStart?.(snapshot);
    }

    this.emit({ type: "battle_start", characters: this.characters, arena: this.arena });

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
    this.log.winner = this.winningTeam ?? this.winner;
    this.log.totalTurns = this.turnNumber;
    return this.log;
  }

  // ── Position Initialization ─────────────────────────

  private initializePositions() {
    const unplaced = this.characters.filter(c => c.position.x === 0 && c.position.y === 0);

    if (unplaced.length === 0) return; // all manually placed

    // For 2-character 1v1, use classic left/right
    if (this.characters.length === 2) {
      const [a, b] = defaultStartPositions(this.arena);
      if (this.characters[0].position.x === 0) this.characters[0].position = { ...a };
      if (this.characters[1].position.x === 0) this.characters[1].position = { ...b };
      return;
    }

    // For N characters, use team-aware formation
    const positions = generateStartPositions(
      this.characters.map(c => ({ team: c.team })),
      this.arena,
    );
    for (let i = 0; i < this.characters.length; i++) {
      if (this.characters[i].position.x === 0 && this.characters[i].position.y === 0) {
        this.characters[i].position = { ...positions[i] };
      }
    }
  }

  // ── Turn Execution ──────────────────────────────────

  /**
   * Execute one full turn (all living agents act, ordered by speed).
   */
  private async executeTurn(): Promise<void> {
    this.turnNumber++;
    const living = this.getLiving();
    const order = determineTurnOrder(living, this.dice);

    for (const character of order) {
      if (this.finished) break;
      // Re-check alive — someone may have died earlier this turn
      if (character.stats.hp <= 0) continue;

      const agent = this.agentMap.get(character.id);
      if (!agent) continue;

      this.emit({ type: "turn_start", turnNumber: this.turnNumber, actorId: character.id });

      const snapshot = createSnapshot(
        this.getLiving(),
        this.turnNumber,
        "ongoing",
        this.arena,
      );

      // Check if frozen or paralyzed
      if (character.statusEffects.some((e) => e.type === "freeze" || e.type === "paralyzed")) {
        const frozenResult: CombatResult = {
          action: { type: "wait", actorId: character.id },
          actorId: character.id,
          narrative: `❄️ ${character.name} is frozen/paralyzed and cannot act!`,
        };
        // Pick any living non-ally for event targetId
        const anyEnemy = this.findEnemy(character);
        this.emit({ type: "action_result", actorId: character.id, targetId: anyEnemy?.id ?? character.id, result: frozenResult });
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

      // ── Resolve movement ──
      let moveResult: CombatResult["move"];
      if (action.move) {
        const mv = resolveMove(character, action.move, this.arena);
        moveResult = mv;
        this.emit({
          type: "move",
          actorId: character.id,
          from: mv.from,
          to: mv.to,
          distance: mv.distanceMoved,
        });
      }

      // ── Resolve target ──
      const target = this.resolveTarget(character, action);

      // For self-targeting actions (shield, heal, wait, defend), the target IS the actor
      const spell = action.type === "cast_spell"
        ? character.spells.find(s => s.id === action.spellId)
        : null;
      const actionTarget = (spell?.target === "self" || action.type === "defend" || action.type === "wait")
        ? character
        : target;

      const result = resolveAction(character, actionTarget, action, this.dice, this.arena);

      // Attach move result
      if (moveResult) result.move = moveResult;

      this.emit({ type: "action_result", actorId: character.id, targetId: target.id, result });

      // Notify actor and target agents
      agent.onActionResult?.(result);
      if (target.id !== character.id) {
        this.agentMap.get(target.id)?.onActionResult?.(result);
      }

      // Process status effects on actor and target
      this.processAllStatusEffects(character, target);

      // Tick cooldowns
      tickCooldowns(character);

      // Log the turn
      this.log.turns.push({
        turnNumber: this.turnNumber,
        actorId: character.id,
        results: [result],
        stateSnapshot: createSnapshot(this.characters, this.turnNumber, this.finished ? "finished" : "ongoing", this.arena),
        thinkingSteps,
      });

      // Check for flee
      if (result.fledSuccessfully) {
        this.finished = true;
        this.winner = target.id;
        this.winningTeam = target.team;
        this.emit({ type: "character_defeated", characterId: character.id });
        this.emit({ type: "battle_end", winner: this.winner, winningTeam: this.winningTeam, reason: `${character.name} fled!` });
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

  // ── Target Resolution ───────────────────────────────

  /** Resolve the target of an action, respecting explicit targetId or defaulting */
  private resolveTarget(actor: Character, action: CombatAction): Character {
    // If action specifies a target, look it up
    if (action.targetId) {
      const target = this.characters.find(c => c.id === action.targetId);
      if (target && target.stats.hp > 0) return target;
    }

    // Fallback: pick first living non-ally (enemy)
    const enemy = this.findEnemy(actor);
    if (enemy) return enemy;

    // No enemies left — self-target (shouldn't happen in normal flow)
    return actor;
  }

  /** Find the nearest living enemy (different team) */
  private findEnemy(character: Character): Character | undefined {
    const enemies = this.getLiving().filter(c => c.team !== character.team);
    if (enemies.length === 0) return undefined;

    // Pick nearest enemy
    let nearest = enemies[0];
    let nearestDist = Infinity;
    for (const e of enemies) {
      const dx = e.position.x - character.position.x;
      const dy = e.position.y - character.position.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = e;
      }
    }
    return nearest;
  }

  // ── Defeat Checks ───────────────────────────────────

  private checkDefeat(actor: Character, target: Character): boolean {
    // Check if anyone died from that action
    const dead: Character[] = [];
    if (target.stats.hp <= 0 && target.id !== actor.id) dead.push(target);
    // Friendly fire: actor could die from... well not from their own action normally,
    // but status effects could kill them. Check next status tick.

    for (const d of dead) {
      this.emit({ type: "character_defeated", characterId: d.id });
    }

    // Check win condition
    const living = this.getLiving();

    if (this.winCondition === "last_unit_standing") {
      // FFA: only one left
      if (living.length <= 1) {
        this.finished = true;
        this.winner = living[0]?.id;
        this.winningTeam = living[0]?.team;
        this.emit({
          type: "battle_end",
          winner: this.winner,
          winningTeam: this.winningTeam,
          reason: living.length === 1
            ? `${living[0].name} is the last one standing!`
            : "Everyone is dead — draw!",
        });
        return true;
      }
    } else {
      // last_team_standing: check if only one team has living members
      const livingTeams = new Set(living.map(c => c.team));
      if (livingTeams.size <= 1) {
        this.finished = true;
        const survivingTeam = [...livingTeams][0];
        this.winningTeam = survivingTeam;
        this.winner = living[0]?.id; // first living member
        this.emit({
          type: "battle_end",
          winner: this.winner,
          winningTeam: this.winningTeam,
          reason: survivingTeam
            ? `Team "${survivingTeam}" wins! All enemies defeated!`
            : "Mutual destruction — draw!",
        });
        return true;
      }
    }

    return false;
  }

  // ── Helpers ─────────────────────────────────────────

  private processAllStatusEffects(character: Character, target: Character) {
    // Process status on all living characters each tick
    for (const c of this.getLiving()) {
      const narratives = processStatusEffects(c);
      if (narratives.length > 0) {
        this.emit({ type: "status_tick", characterId: c.id, narratives });
      }
    }
  }

  private emit(event: BattleEvent): void {
    this.config.eventHandler?.(event);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
