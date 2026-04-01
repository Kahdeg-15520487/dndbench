// ─────────────────────────────────────────────────────────
//  Battle Runner — orchestrates the full fight
// ─────────────────────────────────────────────────────────
//
//  The runner only knows about IAgent. It calls getAction()
//  and awaits — whether it resolves in 1ms (heuristic),
//  2s (LLM agentic loop), or 30s (human thinking) doesn't matter.
// ─────────────────────────────────────────────────────────

import {
  Character,
  CombatAction,
  BattleLog,
  TurnResult,
  BattlePhase,
  CombatResult,
} from "../engine/types.js";
import {
  resolveAction,
  processStatusEffects,
  tickCooldowns,
  createSnapshot,
  determineTurnOrder,
} from "../engine/index.js";
import { IAgent } from "../agent/interface.js";
import chalk from "chalk";

// ── Battle Events (for logging/observing) ───────────────

export type BattleEvent =
  | { type: "battle_start"; characters: Character[] }
  | { type: "turn_start"; turnNumber: number; actorId: string }
  | { type: "action_chosen"; actorId: string; action: CombatAction }
  | { type: "action_result"; result: CombatResult }
  | { type: "status_tick"; characterId: string; narratives: string[] }
  | { type: "character_defeated"; characterId: string }
  | { type: "battle_end"; winner?: string; reason: string };

export type BattleEventHandler = (event: BattleEvent) => void;

export interface BattleConfig {
  maxTurns: number;
  turnDelayMs: number;
  eventHandler?: BattleEventHandler;
  verbose: boolean;
}

const DEFAULT_CONFIG: BattleConfig = {
  maxTurns: 50,
  turnDelayMs: 1500,
  verbose: true,
};

// ── Runner ──────────────────────────────────────────────

export class BattleRunner {
  private characters: Character[];
  private agents: IAgent[];
  private agentMap: Map<string, IAgent>; // characterId → agent
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

  /**
   * Run the full battle to completion.
   * Works with any IAgent implementation — heuristic, LLM, or human.
   */
  async run(): Promise<BattleLog> {
    const snapshot = createSnapshot(this.characters, 0, "ongoing");

    // Notify all agents
    for (const agent of this.agents) {
      agent.onBattleStart?.(snapshot);
    }

    this.emit({ type: "battle_start", characters: this.characters });

    if (this.config.verbose) {
      this.printBattleStart();
    }

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
      if (this.config.verbose) {
        console.log(chalk.yellow("\n⏰ TIME UP — The battle ends in a draw!\n"));
      }
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

    // Determine turn order based on speed
    const order = determineTurnOrder(this.characters);

    for (const character of order) {
      if (this.finished) break;

      const agent = this.agentMap.get(character.id);
      if (!agent) continue;

      this.emit({ type: "turn_start", turnNumber: this.turnNumber, actorId: character.id });

      if (this.config.verbose) {
        this.printTurnHeader(character, agent);
      }

      // Get snapshot for this moment
      const snapshot = createSnapshot(
        this.characters,
        this.turnNumber,
        this.finished ? "finished" : "ongoing"
      );

      // Check if frozen — skip turn
      if (character.statusEffects.some((e) => e.type === "freeze")) {
        const frozenResult: CombatResult = {
          action: { type: "wait", actorId: character.id },
          actorId: character.id,
          narrative: `❄️ ${character.name} is frozen and cannot act!`,
        };

        if (this.config.verbose) {
          console.log(chalk.cyan(`  ${frozenResult.narrative}\n`));
        }

        this.emitActionResult(frozenResult, agent);
        tickCooldowns(character);
        continue;
      }

      // ── Ask the agent for its action (the core abstraction) ──
      const action = await agent.getAction(snapshot);
      this.emit({ type: "action_chosen", actorId: character.id, action });

      // Resolve action in engine
      const target = this.getTarget(character);
      const result = resolveAction(character, target, action);

      this.emitActionResult(result, agent);

      if (this.config.verbose) {
        this.printActionResult(result);
      }

      // Check for flee
      if (result.fledSuccessfully) {
        this.finished = true;
        this.winner = target.id;
        this.emit({
          type: "battle_end",
          winner: this.winner,
          reason: `${character.name} fled the battle!`,
        });
        if (this.config.verbose) {
          console.log(chalk.yellow(`\n🏃 ${character.name} fled! ${target.name} wins!\n`));
        }
        break;
      }

      // Process status effects
      this.processAllStatusEffects(character, target);

      // Tick cooldowns
      tickCooldowns(character);

      // Check for defeat
      if (this.checkDefeat(character, target)) break;

      // Log the turn
      this.log.turns.push({
        turnNumber: this.turnNumber,
        actorId: character.id,
        results: [result],
        stateSnapshot: createSnapshot(this.characters, this.turnNumber, "ongoing"),
      });
    }

    // Print health bars
    if (this.config.verbose && !this.finished) {
      this.printHealthBars();
    }
  }

  // ── Helpers ─────────────────────────────────────────

  private emitActionResult(result: CombatResult, agent: IAgent) {
    this.emit({ type: "action_result", result });
    agent.onActionResult?.(result);
  }

  private processAllStatusEffects(character: Character, target: Character) {
    const narratives = processStatusEffects(character);
    if (narratives.length > 0) {
      this.emit({ type: "status_tick", characterId: character.id, narratives });
      if (this.config.verbose) {
        narratives.forEach((n) => console.log(chalk.gray(`  ${n}`)));
      }
    }
    const targetNarratives = processStatusEffects(target);
    if (targetNarratives.length > 0) {
      this.emit({ type: "status_tick", characterId: target.id, narratives: targetNarratives });
      if (this.config.verbose) {
        targetNarratives.forEach((n) => console.log(chalk.gray(`  ${n}`)));
      }
    }
  }

  private checkDefeat(character: Character, target: Character): boolean {
    if (target.stats.hp <= 0) {
      this.finished = true;
      this.winner = character.id;
      this.emit({ type: "character_defeated", characterId: target.id });
      this.emit({ type: "battle_end", winner: this.winner, reason: `${target.name} has been defeated!` });
      if (this.config.verbose) {
        console.log(chalk.red(`\n💀 ${target.name} has been defeated! ${character.name} WINS!\n`));
      }
      return true;
    }
    if (character.stats.hp <= 0) {
      this.finished = true;
      this.winner = target.id;
      this.emit({ type: "character_defeated", characterId: character.id });
      this.emit({ type: "battle_end", winner: this.winner, reason: `${character.name} collapsed!` });
      if (this.config.verbose) {
        console.log(chalk.red(`\n💀 ${character.name} collapsed! ${target.name} WINS!\n`));
      }
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

  // ── Display ─────────────────────────────────────────

  private printBattleStart(): void {
    console.log("\n" + "═".repeat(60));
    console.log(chalk.bold.red("  ⚔️  RPG ARENA BATTLE  ⚔️"));
    console.log("═".repeat(60) + "\n");

    for (const char of this.characters) {
      const agent = this.agentMap.get(char.id);
      const agentType = agent?.type || "unknown";
      const typeLabel: Record<string, string> = {
        heuristic: "🤖 AI",
        llm: "🧠 LLM",
        human: "👤 Human",
      };
      console.log(
        `  ${chalk.bold(char.name)} (${char.class}) [${typeLabel[agentType] || agentType}]` +
          `  HP: ${chalk.green(char.stats.hp)}/${char.stats.maxHp}` +
          `  MP: ${chalk.blue(char.stats.mp)}/${char.stats.maxMp}` +
          `  STR:${char.stats.strength} DEF:${char.stats.defense}` +
          ` MAG:${char.stats.magic} SPD:${char.stats.speed} LCK:${char.stats.luck}`
      );
      console.log(`    Spells: ${char.spells.map((s) => s.name).join(", ")}`);
      console.log(`    Items: ${char.inventory.map((i) => `${i.name} x${i.quantity}`).join(", ")}`);
      console.log();
    }

    console.log("─".repeat(60) + "\n");
  }

  private printTurnHeader(character: Character, agent: IAgent): void {
    const typeEmoji: Record<string, string> = {
      heuristic: "🤖",
      llm: "🧠",
      human: "👤",
    };
    console.log(
      chalk.bold(
        `\n── Turn ${this.turnNumber}: ${character.name}'s Action ${typeEmoji[agent.type] || ""} ──`
      )
    );
  }

  private printActionResult(result: CombatResult): void {
    console.log(`  ${result.narrative}`);
    if (result.damage && result.damage.damage > 0) {
      const d = result.damage;
      console.log(
        chalk.gray(
          `    → ${d.damage} dmg${d.wasCrit ? " (CRIT)" : ""}${d.wasMiss ? " (MISS)" : ""} | Target HP: ${d.targetHp}/${d.targetMaxHp}`
        )
      );
    }
    if (result.spell) {
      const s = result.spell;
      if (s.mpRemaining !== undefined) {
        console.log(chalk.gray(`    → MP remaining: ${s.mpRemaining}`));
      }
    }
    console.log();
  }

  private printHealthBars(): void {
    console.log(chalk.bold("  Health:"));
    for (const char of this.characters) {
      const hpPct = char.stats.hp / char.stats.maxHp;
      const barLen = 20;
      const filled = Math.round(hpPct * barLen);
      const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
      const color = hpPct > 0.6 ? chalk.green : hpPct > 0.3 ? chalk.yellow : chalk.red;

      console.log(
        `  ${char.name}: ${color(bar)} ${char.stats.hp}/${char.stats.maxHp} HP | ${char.stats.mp}/${char.stats.maxMp} MP` +
          (char.statusEffects.length > 0 ? ` | ${char.statusEffects.map((e) => e.type).join(", ")}` : "")
      );
    }
    console.log();
  }
}
