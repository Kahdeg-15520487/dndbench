// ─────────────────────────────────────────────────────────
//  CLI Renderer — prints battle events to terminal
// ─────────────────────────────────────────────────────────

import type { BattleEvent, BattleEventHandler } from "./battle-runner.js";
import type { Character } from "../engine/types.js";
import type { IAgent } from "../agent/interface.js";
import chalk from "chalk";

// ── Character name cache ────────────────────────────────
const charNames = new Map<string, string>();

/**
 * Create an event handler that renders to the terminal with chalk.
 */
export function createCliRenderer(
  agentMap: Map<string, IAgent>
): BattleEventHandler {
  return (event: BattleEvent) => {
    switch (event.type) {
      case "battle_start":
        event.characters.forEach((c) => charNames.set(c.id, c.name));
        printBattleStart(event.characters, agentMap);
        break;

      case "turn_start": {
        const name = charNames.get(event.actorId) ?? event.actorId;
        const agent = agentMap.get(event.actorId);
        const emoji: Record<string, string> = { heuristic: "🤖", llm: "🧠", human: "👤" };
        console.log(
          chalk.bold(`\n── Turn ${event.turnNumber}: ${name}'s Action ${emoji[agent?.type ?? ""] ?? ""} ──`)
        );
        break;
      }

      case "action_result":
        printActionResult(event.result);
        break;

      case "status_tick":
        event.narratives.forEach((n) => console.log(chalk.gray(`  ${n}`)));
        break;

      case "health_bars":
        printHealthBars(event.characters);
        break;

      case "battle_end":
        if (event.winner) {
          console.log(chalk.red(`\n💀 Battle over! ${event.reason}\n`));
        } else {
          console.log(chalk.yellow("\n⏰ TIME UP — The battle ends in a draw!\n"));
        }
        break;
    }
  };
}

// ── Display helpers ─────────────────────────────────────

function printBattleStart(characters: Character[], agentMap: Map<string, IAgent>): void {
  console.log("\n" + "═".repeat(60));
  console.log(chalk.bold.red("  ⚔️  RPG ARENA BATTLE  ⚔️"));
  console.log("═".repeat(60) + "\n");

  for (const char of characters) {
    const agent = agentMap.get(char.id);
    const typeLabel: Record<string, string> = {
      heuristic: "🤖 AI",
      llm: "🧠 LLM",
      human: "👤 Human",
    };
    console.log(
      `  ${chalk.bold(char.name)} (${char.class}) [${typeLabel[agent?.type || ""] || "unknown"}]` +
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

function printActionResult(result: import("../engine/types.js").CombatResult): void {
  console.log(`  ${result.narrative}`);
  if (result.damage && result.damage.damage > 0) {
    const d = result.damage;
    console.log(
      chalk.gray(
        `    → ${d.damage} dmg${d.wasCrit ? " (CRIT)" : ""}${d.wasMiss ? " (MISS)" : ""} | Target HP: ${d.targetHp}/${d.targetMaxHp}`
      )
    );
  }
  if (result.spell?.mpRemaining !== undefined) {
    console.log(chalk.gray(`    → MP remaining: ${result.spell.mpRemaining}`));
  }
  console.log();
}

function printHealthBars(characters: Character[]): void {
  console.log(chalk.bold("  Health:"));
  for (const char of characters) {
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

// ── Summary (called after run()) ────────────────────────

export function printBattleSummary(
  winner: string | undefined,
  totalTurns: number,
  startTime: string,
  endTime: string | undefined,
  replayPath?: string
): void {
  console.log("═".repeat(60));
  console.log(chalk.bold("  BATTLE SUMMARY"));
  console.log("═".repeat(60));
  console.log(`  Winner: ${winner ? chalk.bold.green(winner) : chalk.yellow("Draw")}`);
  console.log(`  Total Turns: ${totalTurns}`);
  console.log(`  Duration: ${startTime} → ${endTime ?? "N/A"}`);
  if (replayPath) {
    console.log(`  Replay: ${chalk.cyan(replayPath)}`);
  }
  console.log("═".repeat(60) + "\n");
}
