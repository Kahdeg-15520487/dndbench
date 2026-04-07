// ─────────────────────────────────────────────────────────
//  CLI Renderer — prints battle events to terminal
// ─────────────────────────────────────────────────────────

import type { BattleEvent, BattleEventHandler } from "./battle-runner.js";
import type { Character, CombatAction } from "../engine/types.js";
import type { IAgent } from "../agent/interface.js";
import chalk from "chalk";

// ── Character name cache ────────────────────────────────
const charNames = new Map<string, string>();

/** Track the current acting character (set by turn_start) */
let currentActorId = "";

/**
 * Create a thinking callback for LLM agents (CLI mode).
 * Only prints thinking for the currently acting character.
 */
export function createCliThinkingHandler(): (step: import("../engine/types.js").ThinkingStep) => void {
  return (step) => {
    // This callback is agent-specific, so it's already scoped to the right actor.
    // Just print indented thinking lines.
    switch (step.type) {
      case "thinking":
        console.log(chalk.gray(`    💭 ${step.text}`));
        break;
      case "tool_call": {
        const paramStr = step.toolParams
          ? Object.entries(step.toolParams)
              .filter(([_, v]) => v != null)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(", ")
          : "";
        console.log(chalk.gray(`    🔧 ${step.toolName}${paramStr ? `(${paramStr})` : ""}`));
        break;
      }
      case "tool_result":
        // Only show non-action tool results (action results are shown via narrative)
        console.log(chalk.gray(`      ↳ ${step.text}`));
        break;
    }
  };
}

/**
 * Create an event handler that renders to the terminal with chalk.
 *
 * Buffers action_chosen + move events, then prints a combined
 * one-line summary when action_result arrives.
 */
export function createCliRenderer(
  agentMap: Map<string, IAgent>
): BattleEventHandler {
  // Buffer for current turn's action + move
  let pendingAction: CombatAction | null = null;
  let pendingMove: { dx: number; dy: number } | null = null;

  return (event: BattleEvent) => {
    switch (event.type) {
      case "battle_start":
        event.characters.forEach((c) => charNames.set(c.id, c.name));
        printBattleStart(event.characters, agentMap);
        break;

      case "turn_start": {
        // Reset buffer for new turn
        pendingAction = null;
        pendingMove = null;

        const name = charNames.get(event.actorId) ?? event.actorId;
        const agent = agentMap.get(event.actorId);
        const emoji: Record<string, string> = { heuristic: "🤖", llm: "🧠", human: "👤" };
        console.log(
          chalk.bold(`\n── Turn ${event.turnNumber}: ${name}'s Action ${emoji[agent?.type ?? ""] ?? ""} ──`)
        );
        break;
      }

      case "move": {
        // Buffer the move delta
        pendingMove = {
          dx: +(event.to.x - event.from.x).toFixed(1),
          dy: +(event.to.y - event.from.y).toFixed(1),
        };
        break;
      }

      case "action_chosen":
        // Buffer the action (don't print yet)
        pendingAction = event.action;
        break;

      case "action_result": {
        // Print combined summary line, then the narrative
        printTurnSummary(pendingAction, pendingMove);
        printActionResult(event.result);
        pendingAction = null;
        pendingMove = null;
        break;
      }

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

// ── Turn Summary (combines action + move into one line) ──

function describeAction(action: CombatAction): string {
  const targetName = action.targetId ? (charNames.get(action.targetId) ?? action.targetId) : null;

  switch (action.type) {
    case "attack":
      return targetName ? `attacks ${targetName}` : "attacks";
    case "cast_spell":
      return targetName
        ? `casts ${action.spellId} on ${targetName}`
        : `casts ${action.spellId ?? "a spell"}`;
    case "use_item":
      return targetName
        ? `uses ${action.itemId} on ${targetName}`
        : `uses ${action.itemId ?? "an item"}`;
    case "defend":
      return "defends";
    case "wait":
      return "waits";
    case "flee":
      return "flees";
    default:
      return action.type;
  }
}

function printTurnSummary(action: CombatAction | null, move: { dx: number; dy: number } | null): void {
  if (!action) return;

  const actorName = charNames.get(action.actorId) ?? action.actorId;
  const actionDesc = describeAction(action);

  if (move) {
    console.log(
      chalk.cyan(`  → ${actorName} moves (${move.dx}, ${move.dy}) → ${actionDesc}`)
    );
  } else {
    console.log(chalk.cyan(`  → ${actorName} ${actionDesc}`));
  }
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
      `  ${chalk.bold(char.name)} (${char.class}) [${typeLabel[agent?.type || ""] || "unknown"}]`
    );
    console.log(`    HP: ${chalk.green(char.stats.hp)}/${char.stats.maxHp}   AC: ${chalk.yellow(char.stats.ac)}   SPD: ${char.stats.speed}ft`);
    console.log(`    STR: ${char.stats.str}  DEX: ${char.stats.dex}  CON: ${char.stats.con}  INT: ${char.stats.int}  WIS: ${char.stats.wis}  CHA: ${char.stats.cha}`);
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
  if (result.spell?.slotUsed !== undefined) {
    console.log(chalk.gray(`    → Spell slot used: ${result.spell.slotUsed}${result.spell.slotsRemaining ? `, remaining: ${JSON.stringify(result.spell.slotsRemaining)}` : ""}`));
  }
  console.log();
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function padVisual(str: string, width: number): string {
  const visual = stripAnsi(str);
  const padding = Math.max(0, width - visual.length);
  return str + " ".repeat(padding);
}

function printHealthBars(characters: Character[]): void {
  // Column widths (visual chars between │ │)
  const COL_NAME = 12;
  const COL_STAT = 20;  // bar(10) + " " + "NNN/NNN"
  const COL_AC   = 6;   // "AC NN"
  const COL_POS  = 11;

  const top    = `  ┌${"─".repeat(COL_NAME)}┬${"─".repeat(COL_STAT)}┬${"─".repeat(COL_AC)}┬${"─".repeat(COL_POS)}┐`;
  const header = `  │${padVisual(" Name", COL_NAME)}│${padVisual(" HP", COL_STAT)}│${padVisual(" AC", COL_AC)}│${padVisual(" Position", COL_POS)}│`;
  const sep    = `  ├${"─".repeat(COL_NAME)}┼${"─".repeat(COL_STAT)}┼${"─".repeat(COL_AC)}┼${"─".repeat(COL_POS)}┤`;
  const bottom = `  └${"─".repeat(COL_NAME)}┴${"─".repeat(COL_STAT)}┴${"─".repeat(COL_AC)}┴${"─".repeat(COL_POS)}┘`;

  console.log(chalk.bold("\n" + top));
  console.log(chalk.bold(header));
  console.log(chalk.bold(sep));

  for (const char of characters) {
    const hpPct = char.stats.maxHp > 0 ? char.stats.hp / char.stats.maxHp : 0;
    const barLen = 10;
    const hpFilled = Math.round(hpPct * barLen);
    const hpBar = "█".repeat(hpFilled) + "░".repeat(barLen - hpFilled);
    const hpColor = hpPct > 0.6 ? chalk.green : hpPct > 0.3 ? chalk.yellow : chalk.red;
    const hpText = `${char.stats.hp}/${char.stats.maxHp}`;

    const ac = padVisual(chalk.yellow(" AC " + char.stats.ac), COL_AC);

    const pos = char.position ? `(${char.position.x.toFixed(1)},${char.position.y.toFixed(1)})` : "(?,?)";
    const status = char.statusEffects.length > 0 ? chalk.gray(` [${char.statusEffects.map((e) => e.type).join(", ")}]`) : "";

    const name = chalk.bold(char.name);
    const hp = padVisual(hpColor(hpBar) + " " + hpText, COL_STAT);

    console.log(`  │${padVisual(" " + name, COL_NAME)}│${hp}│${ac}│${padVisual(" " + pos, COL_POS)}│${status}`);
  }
  console.log(chalk.bold(bottom + "\n"));
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
