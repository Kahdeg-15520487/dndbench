// ─────────────────────────────────────────────────────────
//  Battle Runner — orchestrates the full fight
// ─────────────────────────────────────────────────────────

import {
  Character,
  CombatAction,
  BattleLog,
  TurnResult,
  BattlePhase,
} from "../engine/types.js";
import {
  resolveAction,
  processStatusEffects,
  tickCooldowns,
  createSnapshot,
  determineTurnOrder,
} from "../engine/index.js";
import { LLMAgent } from "../agent/llm-agent.js";
import chalk from "chalk";

// ── Battle Events (for logging/observing) ───────────────

export type BattleEvent =
  | { type: "battle_start"; characters: Character[] }
  | { type: "turn_start"; turnNumber: number; actorId: string }
  | { type: "action_chosen"; actorId: string; action: CombatAction }
  | { type: "action_result"; result: any }
  | { type: "status_tick"; characterId: string; narratives: string[] }
  | { type: "character_defeated"; characterId: string }
  | { type: "battle_end"; winner?: string; reason: string };

export type BattleEventHandler = (event: BattleEvent) => void;

export interface BattleConfig {
  maxTurns: number;
  turnDelayMs: number; // delay between turns for dramatic effect
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
  private agents: LLMAgent[];
  private config: BattleConfig;
  private log: BattleLog;
  private turnNumber = 0;
  private finished = false;
  private winner?: string;

  constructor(
    characters: Character[],
    agents: LLMAgent[],
    config?: Partial<BattleConfig>
  ) {
    this.characters = characters;
    this.agents = agents;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = {
      turns: [],
      totalTurns: 0,
      startTime: new Date().toISOString(),
    };
  }

  /**
   * Run the full battle to completion
   */
  async run(): Promise<BattleLog> {
    this.emit({
      type: "battle_start",
      characters: this.characters,
    });

    if (this.config.verbose) {
      this.printBattleStart();
    }

    while (!this.finished && this.turnNumber < this.config.maxTurns) {
      await this.executeTurn();
      if (this.config.turnDelayMs > 0) {
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

    this.log.endTime = new Date().toISOString();
    this.log.winner = this.winner;
    this.log.totalTurns = this.turnNumber;
    return this.log;
  }

  /**
   * Execute one full turn (both agents act, ordered by speed)
   */
  private async executeTurn(): Promise<void> {
    this.turnNumber++;
    const turnResults: TurnResult[] = [];

    // Determine turn order based on speed
    const order = determineTurnOrder(this.characters);

    for (const character of order) {
      if (this.finished) break;

      const agent = this.agents.find((a) => {
        // Match by character id
        return (a as any).config?.character?.id === character.id;
      });
      if (!agent) continue;

      this.emit({ type: "turn_start", turnNumber: this.turnNumber, actorId: character.id });

      if (this.config.verbose) {
        this.printTurnHeader(character);
      }

      // Get action from agent
      const snapshot = createSnapshot(
        this.characters,
        this.turnNumber,
        this.finished ? "finished" : "ongoing"
      );

      // Check if frozen — skip turn
      if (character.statusEffects.some((e) => e.type === "freeze")) {
        const frozenResult = resolveAction(
          character,
          this.getTarget(character),
          { type: "wait", actorId: character.id }
        );
        frozenResult.narrative = `❄️ ${character.name} is frozen and cannot act!`;

        if (this.config.verbose) {
          console.log(chalk.cyan(`  ${frozenResult.narrative}\n`));
        }

        turnResults.push({
          turnNumber: this.turnNumber,
          actorId: character.id,
          results: [frozenResult],
          stateSnapshot: createSnapshot(
            this.characters,
            this.turnNumber,
            "ongoing"
          ),
        });

        tickCooldowns(character);
        continue;
      }

      const action = await agent.getAction(snapshot);
      this.emit({ type: "action_chosen", actorId: character.id, action });

      // Resolve action
      const target = this.getTarget(character);
      const result = resolveAction(character, target, action);
      this.emit({ type: "action_result", result });

      if (this.config.verbose) {
        this.printActionResult(result);
      }

      // Check for flee
      if (result.fledSuccessfully) {
        this.finished = true;
        this.winner = target.id; // the one who didn't flee wins
        this.emit({
          type: "battle_end",
          winner: this.winner,
          reason: `${character.name} fled the battle!`,
        });
        if (this.config.verbose) {
          console.log(
            chalk.yellow(`\n🏃 ${character.name} fled! ${target.name} wins!\n`)
          );
        }
        break;
      }

      // Process status effects
      const statusNarratives = processStatusEffects(character);
      if (statusNarratives.length > 0) {
        this.emit({
          type: "status_tick",
          characterId: character.id,
          narratives: statusNarratives,
        });
        if (this.config.verbose) {
          statusNarratives.forEach((n) => console.log(chalk.gray(`  ${n}`)));
        }
      }

      // Process status effects on target too
      const targetStatusNarratives = processStatusEffects(target);
      if (targetStatusNarratives.length > 0 && this.config.verbose) {
        targetStatusNarratives.forEach((n) => console.log(chalk.gray(`  ${n}`)));
      }

      // Tick cooldowns
      tickCooldowns(character);

      // Check for defeat
      if (target.stats.hp <= 0) {
        this.finished = true;
        this.winner = character.id;
        this.emit({
          type: "character_defeated",
          characterId: target.id,
        });
        this.emit({
          type: "battle_end",
          winner: this.winner,
          reason: `${target.name} has been defeated!`,
        });
        if (this.config.verbose) {
          console.log(
            chalk.red(`\n💀 ${target.name} has been defeated! ${character.name} WINS!\n`)
          );
        }
        break;
      }

      // Also check if attacker died from reflected damage or other effects
      if (character.stats.hp <= 0) {
        this.finished = true;
        this.winner = target.id;
        this.emit({
          type: "character_defeated",
          characterId: character.id,
        });
        this.emit({
          type: "battle_end",
          winner: this.winner,
          reason: `${character.name} collapsed!`,
        });
        if (this.config.verbose) {
          console.log(
            chalk.red(`\n💀 ${character.name} collapsed! ${target.name} WINS!\n`)
          );
        }
        break;
      }

      turnResults.push({
        turnNumber: this.turnNumber,
        actorId: character.id,
        results: [result],
        stateSnapshot: createSnapshot(
          this.characters,
          this.turnNumber,
          "ongoing"
        ),
      });

      // Add result to agent's conversation history
      agent.addResult(result.narrative);
    }

    this.log.turns.push(...turnResults);

    // Print health bars
    if (this.config.verbose && !this.finished) {
      this.printHealthBars();
    }
  }

  // ── Helpers ─────────────────────────────────────────

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
      console.log(
        `  ${chalk.bold(char.name)} (${char.class})` +
          `  HP: ${chalk.green(char.stats.hp)}/${char.stats.maxHp}` +
          `  MP: ${chalk.blue(char.stats.mp)}/${char.stats.maxMp}` +
          `  STR:${char.stats.strength} DEF:${char.stats.defense}` +
          ` MAG:${char.stats.magic} SPD:${char.stats.speed} LCK:${char.stats.luck}`
      );
      console.log(
        `    Spells: ${char.spells.map((s) => s.name).join(", ")}`
      );
      console.log(
        `    Items: ${char.inventory.map((i) => `${i.name} x${i.quantity}`).join(", ")}`
      );
      console.log();
    }

    console.log("─".repeat(60) + "\n");
  }

  private printTurnHeader(character: Character): void {
    console.log(
      chalk.bold(
        `\n── Turn ${this.turnNumber}: ${character.name}'s Action ──`
      )
    );
  }

  private printActionResult(result: any): void {
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
      const bar =
        "█".repeat(filled) + "░".repeat(barLen - filled);
      const color =
        hpPct > 0.6 ? chalk.green : hpPct > 0.3 ? chalk.yellow : chalk.red;

      console.log(
        `  ${char.name}: ${color(bar)} ${char.stats.hp}/${char.stats.maxHp} HP | ${char.stats.mp}/${char.stats.maxMp} MP` +
          (char.statusEffects.length > 0
            ? ` | ${char.statusEffects.map((e) => e.type).join(", ")}`
            : "")
      );
    }
    console.log();
  }
}
