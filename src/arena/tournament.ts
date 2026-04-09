// ─────────────────────────────────────────────────────────
//  Tournament Runner — ELO Round-Robin Arena
// ─────────────────────────────────────────────────────────
//
//  Takes a list of LLM model names (+ optional heuristic baseline)
//  and runs a round-robin tournament. Each matchup is best-of-N.
//
//  Emits structured events for CLI and web UI consumption.
// ─────────────────────────────────────────────────────────

import { createCharacter } from "../engine/characters.js";
import { LLMAgent } from "../agent/llm-agent.js";
import { HeuristicAgent } from "../agent/heuristic-agent.js";
import type { IAgent } from "../agent/interface.js";
import { BattleRunner, type BattleEvent, type BattleEventHandler } from "./battle-runner.js";
import {
  ModelStats,
  createModelStats,
  updateStatsAfterMatch,
} from "./elo.js";

// ── Sentinel ────────────────────────────────────────────

/** Special model name for the heuristic baseline */
export const HEURISTIC_BASELINE = "heuristic-baseline";

// ── Config ──────────────────────────────────────────────

export interface TournamentConfig {
  models: string[];
  bestOf: number;
  baseURL: string;
  apiKey: string;
  turnDelayMs: number;
  maxTurns: number;
  kFactor: number;
  classes: Array<[string, string]>;
  outputDir: string;
  /** Optional factory override for testing (e.g., use HeuristicAgent for all models) */
  agentFactory?: (model: string, id: string, name: string, charClass: string) => IAgent;
  /** Optional initial ELO ratings for models (model → ELO) */
  initialElos?: Record<string, number>;
}

const DEFAULT_CONFIG: Partial<TournamentConfig> = {
  bestOf: 5,
  turnDelayMs: 0,
  maxTurns: 30,
  kFactor: 32,
  apiKey: "no-key",
  outputDir: "tournament",
  classes: [
    ["warrior", "mage"],
    ["mage", "warrior"],
    ["rogue", "paladin"],
    ["paladin", "rogue"],
    ["warrior", "mage"],
  ],
};

// ── Structured Events ──────────────────────────────────

export type TournamentEvent =
  | { type: "tournament_start"; totalMatchups: number; totalGames: number; participants: string[] }
  | { type: "matchup_start"; matchupNum: number; totalMatchups: number; modelA: string; modelB: string }
  | { type: "game_start"; gameNum: number; totalGames: number; modelA: string; modelB: string; classA: string; classB: string }
  | { type: "turn"; gameNum: number; narrative: string; turnNumber: number; actionType: TurnActionType; hpA: number; hpB: number; maxHpA: number; maxHpB: number; badAction?: string; attackRoll?: number; attackTotal?: number; targetAc?: number; saveRoll?: number; saveDc?: number; saveSuccess?: boolean; damageRolls?: number[]; wasCrit?: boolean; damageTotal?: number }
  | { type: "game_end"; gameNum: number; game: GameResult; eloA: number; eloB: number }
  | { type: "matchup_end"; matchupNum: number; modelA: string; modelB: string; winsA: number; winsB: number; draws: number }
  | { type: "tournament_aborted"; reason: string }
  | { type: "tournament_end"; result: TournamentResult };

export type TournamentEventHandler = (event: TournamentEvent) => void;

// ── Result Types ────────────────────────────────────────

export interface TournamentResult {
  config: TournamentConfig;
  startTime: string;
  endTime: string;
  stats: ModelStats[];
  matchups: MatchupResult[];
}

export interface MatchupResult {
  modelA: string;
  modelB: string;
  winsA: number;
  winsB: number;
  draws: number;
  games: GameResult[];
}

export type TurnActionType =
  | "action"       // Main action (attack, cast_spell, use_item, defend, wait, dash, etc.)
  | "move"          // Movement resolved
  | "reaction"      // Reaction triggered (opportunity attack, counterspell)
  | "bonus_action"  // Bonus action (action surge extra action, off-hand attack, etc.)
  | "status"        // Status effect tick / aura damage
  | "death_save";    // Death saving throw

export interface GameTurnLog {
  turnNumber: number;
  actorId: string;
  actorName: string;
  /** Kind of action: action, move, reaction, bonus_action, status, death_save */
  actionType: TurnActionType;
  narrative: string;
  hpA: number;
  hpB: number;
  maxHpA: number;
  maxHpB: number;
  badAction?: string;
  // Structured mechanics data from CombatResult
  attackRoll?: number;
  attackTotal?: number;
  targetAc?: number;
  saveRoll?: number;
  saveDc?: number;
  saveSuccess?: boolean;
  damageRolls?: number[];
  wasCrit?: boolean;
  damageTotal?: number;
}

export interface GameResult {
  gameNumber: number;
  modelA: string;
  modelB: string;
  classA: string;
  classB: string;
  winner: "A" | "B" | "draw";
  winningModel: string;
  turns: number;
  statsA: GameModelStats;
  statsB: GameModelStats;
  turnLog?: GameTurnLog[];
  error?: string;
  durationMs?: number;
  /** How the game ended (e.g. "Turn limit reached", "Character defeated", etc.) */
  endReason?: string;
}

export interface GameModelStats {
  toolCalls: number;
  badActions: number;
  turns: number;
  avgToolCallsPerTurn: number;
  badActionRate: number;
}

// ── Tournament Runner ──────────────────────────────────

export class TournamentRunner {
  private config: TournamentConfig;
  private modelStats: Map<string, ModelStats> = new Map();
  private matchupResults: MatchupResult[] = [];
  private eventHandlers: TournamentEventHandler[] = [];
  private aborted = false;

  constructor(config: Partial<TournamentConfig> & { models: string[] }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as TournamentConfig;
    for (const model of this.config.models) {
      const initElo = this.config.initialElos?.[model] ?? 1000;
      const isH = model === HEURISTIC_BASELINE;
      this.modelStats.set(model, createModelStats(model, initElo, isH));
    }
  }

  /** Subscribe to structured tournament events */
  onEvent(handler: TournamentEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /** Abort the tournament — will stop after current game completes */
  abort(): void {
    this.aborted = true;
  }

  /** Check if tournament has been aborted */
  get isAborted(): boolean {
    return this.aborted;
  }

  private emit(event: TournamentEvent): void {
    for (const h of this.eventHandlers) {
      h(event);
    }
  }

  private getParticipants(): string[] {
    return [...this.config.models];
  }

  /** Run the full round-robin tournament */
  async run(): Promise<TournamentResult> {
    const participants = this.getParticipants();
    const totalMatchups = (participants.length * (participants.length - 1)) / 2;
    const totalGames = totalMatchups * this.config.bestOf;
    const startTime = new Date().toISOString();

    this.emit({ type: "tournament_start", totalMatchups, totalGames, participants });

    let matchupNum = 0;
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        matchupNum++;
        const modelA = participants[i];
        const modelB = participants[j];

        this.emit({ type: "matchup_start", matchupNum, totalMatchups, modelA, modelB });

        if (this.aborted) {
          this.emit({ type: "tournament_aborted", reason: "User cancelled" });
          break;
        }

        let result: MatchupResult;
        try {
          result = await this.runMatchup(modelA, modelB);
        } catch (err: any) {
          // Matchup crashed — count as draw
          result = { modelA, modelB, winsA: 0, winsB: 0, draws: this.config.bestOf, games: [] };
        }
        this.matchupResults.push(result);

        this.emit({
          type: "matchup_end", matchupNum,
          modelA, modelB,
          winsA: result.winsA, winsB: result.winsB, draws: result.draws,
        });
      }
    }

    const endTime = new Date().toISOString();
    const stats = this.getSortedStats();
    const tournamentResult: TournamentResult = {
      config: this.config, startTime, endTime, stats,
      matchups: this.matchupResults,
    };

    this.emit({ type: "tournament_end", result: tournamentResult });
    return tournamentResult;
  }

  private async runMatchup(modelA: string, modelB: string): Promise<MatchupResult> {
    const result: MatchupResult = { modelA, modelB, winsA: 0, winsB: 0, draws: 0, games: [] };

    for (let game = 0; game < this.config.bestOf; game++) {
      const classPair = this.config.classes[game % this.config.classes.length];
      const classA = classPair[0];
      const classB = classPair[1];

      this.emit({
        type: "game_start",
        gameNum: game + 1, totalGames: this.config.bestOf,
        modelA, modelB, classA, classB,
      });

      let gameResult: GameResult;
      try {
        gameResult = await this.runGame(modelA, modelB, classA, classB, game + 1);
      } catch (err: any) {
        // Game crashed — award win to opponent as default
        gameResult = {
          gameNumber: game + 1, modelA, modelB, classA, classB,
          winner: "draw", winningModel: "",
          turns: 0, statsA: { toolCalls: 0, badActions: 0, turns: 0, avgToolCallsPerTurn: 0, badActionRate: 0 },
          statsB: { toolCalls: 0, badActions: 0, turns: 0, avgToolCallsPerTurn: 0, badActionRate: 0 },
          turnLog: [],
          error: err.message || String(err),
        };
        this.emit({ type: "game_end", game: gameResult, eloA: this.modelStats.get(modelA)!.elo, eloB: this.modelStats.get(modelB)!.elo, gameNum: game + 1 });
      }
      result.games.push(gameResult);

      if (gameResult.winner === "A") result.winsA++;
      else if (gameResult.winner === "B") result.winsB++;
      else result.draws++;

      // Update ELO
      const statsA = this.modelStats.get(modelA)!;
      const statsB = this.modelStats.get(modelB)!;
      const scoreA = gameResult.winner === "A" ? 1 : gameResult.winner === "B" ? 0 : 0.5;
      updateStatsAfterMatch(statsA, statsB, scoreA, this.config.kFactor);

      // Accumulate stats
      statsA.totalTurns += gameResult.statsA.turns;
      statsA.totalToolCalls += gameResult.statsA.toolCalls;
      statsA.totalBadActions += gameResult.statsA.badActions;
      statsB.totalTurns += gameResult.statsB.turns;
      statsB.totalToolCalls += gameResult.statsB.toolCalls;
      statsB.totalBadActions += gameResult.statsB.badActions;

      this.incrementClassStats(statsA, classA, gameResult.winner === "A");
      this.incrementClassStats(statsB, classB, gameResult.winner === "B");

      this.emit({
        type: "game_end", gameNum: game + 1, game: gameResult,
        eloA: statsA.elo, eloB: statsB.elo,
      });
    }

    return result;
  }

  private async runGame(
    modelA: string, modelB: string,
    classA: string, classB: string, gameNumber: number,
  ): Promise<GameResult> {
    const gameStartTime = Date.now();
    const idA = "unit1";
    const idB = "unit2";
    const charA = createCharacter(idA, modelA, classA as any, undefined, "red");
    const charB = createCharacter(idB, modelB, classB as any, undefined, "blue");

    const tracking = {
      A: { toolCalls: 0, badActions: 0, turns: 0 },
      B: { toolCalls: 0, badActions: 0, turns: 0 },
    };

    const agentA = this.createAgent(modelA, idA, modelA, classA);
    const agentB = this.createAgent(modelB, idB, modelB, classB);

    let roundNumber = 0;
    let endReason = "";
    const emitTurn = (narrative: string, actionType: TurnActionType, extra?: Partial<TournamentEvent & { type: "turn" }>) => {
      this.emit({
        type: "turn",
        gameNum: gameNumber,
        narrative,
        turnNumber: roundNumber,
        actionType,
        hpA: charA.stats.hp, hpB: charB.stats.hp,
        maxHpA: charA.stats.maxHp, maxHpB: charB.stats.maxHp,
        ...extra,
      });
    };
    const eventHandler: BattleEventHandler = (event: BattleEvent) => {
      // Track round number from turn_start
      if (event.type === "turn_start") {
        roundNumber = event.turnNumber;
      }
      if (event.type === "action_chosen") {
        const key = event.actorId === idA ? "A" : "B";
        tracking[key].turns++;
      }
      // Forward movement
      if (event.type === "move") {
        const actorName = event.actorId === idA ? modelA : modelB;
        emitTurn(
          `🏃 ${actorName} moves ${event.distance.toFixed(1)}ft`,
          "move",
        );
      }
      // Forward action narratives to tournament subscribers
      if (event.type === "action_result" && event.result.narrative) {
        const dmg = event.result.damage;
        const isReaction = !!event.result.reaction;
        const isBonusAction = event.result.action.type === "class_ability" && event.result.action.abilityId === "action_surge";
        // Spirit Guardians / aura damage → status
        const isStatusAura = event.result.action.type === "cast_spell" && event.result.action.spellId === "spirit_guardians";
        let actionType: TurnActionType = "action";
        if (isReaction) actionType = "reaction";
        else if (isBonusAction) actionType = "bonus_action";
        else if (isStatusAura) actionType = "status";
        emitTurn(event.result.narrative, actionType, {
          badAction: event.result.badAction,
          attackRoll: dmg?.attackRoll,
          attackTotal: dmg?.attackTotal,
          targetAc: dmg?.targetAc,
          saveRoll: dmg?.saveRoll,
          saveDc: dmg?.saveDc,
          saveSuccess: dmg?.saveSuccess,
          damageRolls: dmg?.damageRolls,
          wasCrit: dmg?.wasCrit,
          damageTotal: dmg?.damage,
        });
      }
      // Forward death saves
      if (event.type === "death_save") {
        const actorName = event.characterId === idA ? modelA : modelB;
        emitTurn(event.narrative, "death_save");
      }
      if (event.type === "battle_end") {
        endReason = event.reason;
      }
    };

    const runner = new BattleRunner([charA, charB], [agentA, agentB], {
      maxTurns: this.config.maxTurns,
      turnDelayMs: this.config.turnDelayMs,
      eventHandler,
    });

    const log = await runner.run();

    for (const turn of log.turns) {
      const key = turn.actorId === idA ? "A" : "B";
      if (turn.thinkingSteps) {
        for (const step of turn.thinkingSteps) {
          if (step.type === "tool_call") tracking[key].toolCalls++;
        }
      }
      for (const result of turn.results) {
        if (result.badAction) tracking[key].badActions++;
      }
    }

    let winner: "A" | "B" | "draw" = "draw";
    let winningModel = "draw";
    if (log.winner === "red" || log.winner === "a") { winner = "A"; winningModel = modelA; }
    else if (log.winner === "blue" || log.winner === "b") { winner = "B"; winningModel = modelB; }

    const computeAvg = (t: typeof tracking.A): GameModelStats => ({
      toolCalls: t.toolCalls, badActions: t.badActions, turns: t.turns,
      avgToolCallsPerTurn: t.turns > 0 ? t.toolCalls / t.turns : 0,
      badActionRate: t.turns > 0 ? t.badActions / t.turns : 0,
    });

    // Build simplified turn log from battle log
    const turnLog: GameTurnLog[] = [];
    for (const turn of log.turns) {
      const snapA = turn.stateSnapshot.characters.find(c => c.id === idA);
      const snapB = turn.stateSnapshot.characters.find(c => c.id === idB);
      const actorSnap = turn.actorId === idA ? snapA : snapB;
      for (const result of turn.results) {
        if (!result.narrative) continue;
        const dmg = result.damage;
        // Determine action type
        let actionType: TurnActionType = "action";
        if (result.reaction) actionType = "reaction";
        else if (result.action.type === "class_ability" && result.action.abilityId === "action_surge") actionType = "bonus_action";
        // Emit movement entry before the action that caused it
        if (result.move) {
          turnLog.push({
            turnNumber: turn.turnNumber,
            actorId: turn.actorId,
            actorName: actorSnap?.name ?? turn.actorId,
            actionType: "move",
            narrative: `🏃 ${actorSnap?.name ?? turn.actorId} moves ${result.move.distanceMoved.toFixed(1)}ft`,
            hpA: snapA?.hp ?? 0, hpB: snapB?.hp ?? 0,
            maxHpA: snapA?.maxHp ?? 1, maxHpB: snapB?.maxHp ?? 1,
          });
        }
        turnLog.push({
          turnNumber: turn.turnNumber,
          actorId: turn.actorId,
          actorName: actorSnap?.name ?? turn.actorId,
          actionType,
          narrative: result.narrative,
          hpA: snapA?.hp ?? 0, hpB: snapB?.hp ?? 0,
          maxHpA: snapA?.maxHp ?? 1, maxHpB: snapB?.maxHp ?? 1,
          badAction: result.badAction,
          attackRoll: dmg?.attackRoll,
          attackTotal: dmg?.attackTotal,
          targetAc: dmg?.targetAc,
          saveRoll: dmg?.saveRoll,
          saveDc: dmg?.saveDc,
          saveSuccess: dmg?.saveSuccess,
          damageRolls: dmg?.damageRolls,
          wasCrit: dmg?.wasCrit,
          damageTotal: dmg?.damage,
        });
      }
    }

    return {
      gameNumber, modelA, modelB, classA, classB,
      winner, winningModel, turns: log.totalTurns,
      statsA: computeAvg(tracking.A), statsB: computeAvg(tracking.B),
      turnLog,
      durationMs: Date.now() - gameStartTime,
      endReason: endReason || undefined,
    };
  }

  private createAgent(model: string, id: string, name: string, charClass: string): IAgent {
    if (this.config.agentFactory) return this.config.agentFactory(model, id, name, charClass);
    if (model === HEURISTIC_BASELINE) return new HeuristicAgent(id, name);
    return new LLMAgent({
      id, name, characterClass: charClass, model,
      apiKey: this.config.apiKey, baseURL: this.config.baseURL,
    });
  }

  private incrementClassStats(stats: ModelStats, charClass: string, won: boolean): void {
    switch (charClass) {
      case "warrior": stats.battlesAsWarrior++; if (won) stats.winsAsWarrior++; break;
      case "mage": stats.battlesAsMage++; if (won) stats.winsAsMage++; break;
      case "rogue": stats.battlesAsRogue++; if (won) stats.winsAsRogue++; break;
      case "paladin": stats.battlesAsPaladin++; if (won) stats.winsAsPaladin++; break;
    }
  }

  getSortedStats(): ModelStats[] {
    return [...this.modelStats.values()].sort((a, b) => b.elo - a.elo);
  }
}
