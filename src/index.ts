#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────
//  Arena CLI — Main entry point
// ─────────────────────────────────────────────────────────
//
//  CLI is just a renderer. BattleRunner is the engine.
//  Same runner powers WebSocket games in server.ts.
// ─────────────────────────────────────────────────────────

import { createCharacter } from "./engine/characters.js";
import { createBoss, getBossProfile, getAllBossProfiles, BOSS_RUSH_ORDER } from "./engine/bosses.js";
import { HeuristicAgent, LLMAgent, BossAgent } from "./agent/index.js";
import type { IAgent } from "./agent/index.js";
import { BattleRunner } from "./arena/battle-runner.js";
import { createCliRenderer, printBattleSummary } from "./arena/cli-renderer.js";
import { saveReplay } from "./arena/replay.js";
import chalk from "chalk";
import fs from "fs";
import path from "path";

// ── CLI Args ────────────────────────────────────────────

const args = process.argv.slice(2);

interface CliOptions {
  agent1Class: string;
  agent1Name: string;
  agent1Model: string;
  agent2Class: string;
  agent2Name: string;
  agent2Model: string;
  mode: string;
  maxTurns: number;
  delay: number;
  outputFile?: string;
  bossExam: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    agent1Class: "warrior",
    agent1Name: "Alpha",
    agent1Model: "gpt-4o-mini",
    agent2Class: "mage",
    agent2Name: "Beta",
    agent2Model: "gpt-4o-mini",
    mode: "mock",
    maxTurns: 30,
    delay: 1500,
    bossExam: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--a1-class": opts.agent1Class = args[++i]; break;
      case "--a1-name": opts.agent1Name = args[++i]; break;
      case "--a1-model": opts.agent1Model = args[++i]; break;
      case "--a2-class": opts.agent2Class = args[++i]; break;
      case "--a2-name": opts.agent2Name = args[++i]; break;
      case "--a2-model": opts.agent2Model = args[++i]; break;
      case "--mode": opts.mode = args[++i]; break;
      case "--max-turns": opts.maxTurns = parseInt(args[++i]); break;
      case "--delay": opts.delay = parseInt(args[++i]); break;
      case "--output": case "-o": opts.outputFile = args[++i]; break;
      case "--boss-exam": opts.bossExam = true; break;
      case "--help": case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(chalk.bold(`
⚔️  RPG Arena — LLM Agent Battle System

Usage: npx tsx src/index.ts [options]

Agent Types:
  --mode mock      Both agents use heuristic AI (default)
  --mode llm       Both agents use OpenAI-compatible LLM
  --mode mixed     Agent 1 = LLM, Agent 2 = heuristic

Options:
  --a1-class <class>    Agent 1 class: warrior, mage, rogue, paladin (default: warrior)
  --a1-name <name>      Agent 1 name (default: Alpha)
  --a1-model <model>    Agent 1 LLM model (default: gpt-4o-mini)
  --a2-class <class>    Agent 2 class (default: mage)
  --a2-name <name>      Agent 2 name (default: Beta)
  --a2-model <model>    Agent 2 LLM model (default: gpt-4o-mini)
  --mode <mode>         Battle mode (default: mock)
  --boss-exam           Boss Exam mode: fight all 5 bosses, graded at end
  --max-turns <n>       Maximum turns before draw (default: 30)
  --delay <ms>          Delay between turns in ms (default: 1500)
  --output, -o <file>   Save battle log to JSON file
  --help, -h            Show this help

Environment:
  LLM_API_KEY    API key (not needed for local providers like Ollama)
  LLM_BASE_URL   Base URL (default: https://api.openai.com/v1)

Examples:
  # Quick mock battle
  npx tsx src/index.ts --mode mock --delay 500

  # LLM vs LLM
  npx tsx src/index.ts --mode llm --a1-model gpt-4o-mini --a2-model gpt-4o

  # LLM vs LLM via Ollama (local)
  LLM_BASE_URL=http://localhost:11434/v1 npx tsx src/index.ts --mode llm --a1-model llama3 --a2-model mistral

  # Mixed: LLM agent vs heuristic AI
  npx tsx src/index.ts --mode mixed --a1-model gpt-4o-mini

  # Save battle log
  npx tsx src/index.ts --mode mock -o battle-log.json
`));
}

// ── Agent Factory ───────────────────────────────────────

function createAgent(
  mode: "llm" | "mock",
  charId: string,
  charName: string,
  charClass: string,
  model: string
): IAgent {
  if (mode === "llm") {
    return new LLMAgent({
      id: charId,
      name: charName,
      characterClass: charClass,
      model,
      apiKey: process.env.LLM_API_KEY || "no-key",
      baseURL: process.env.LLM_BASE_URL || "http://localhost:8008/v1",
    });
  }
  return new HeuristicAgent(charId, charName);
}

// ── Main ────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(args);

  if (opts.bossExam) {
    await runBossExam(opts);
  } else {
    await run1v1(opts);
  }
}

// ── Boss Exam ──────────────────────────────────────────

async function runBossExam(opts: CliOptions) {
  const validClasses = ["warrior", "mage", "rogue", "paladin"];
  if (!validClasses.includes(opts.agent1Class)) {
    console.error(chalk.red("Invalid class. Choose from: warrior, mage, rogue, paladin"));
    process.exit(1);
  }

  const agentMode = opts.mode === "mock" ? "mock" : "llm";
  const results: { bossName: string; won: boolean; turns: number }[] = [];

  console.log(chalk.bold.cyan("\n👹 BOSS EXAM — Fight 5 bosses of increasing difficulty!\n"));
  console.log(`  Agent: ${opts.agent1Name} (${opts.agent1Class}) [${agentMode === 'llm' ? '🧠 LLM' : '🤖 Mock'}]`);
  console.log(chalk.dim(`  ${"─".repeat(50)}\n`));

  for (let i = 0; i < BOSS_RUSH_ORDER.length; i++) {
    const bossId = BOSS_RUSH_ORDER[i];
    const bossProfile = getBossProfile(bossId);

    console.log(chalk.bold.yellow(`━━━ Boss ${i + 1}/${BOSS_RUSH_ORDER.length}: ${bossProfile.emoji} ${bossProfile.name} — ${bossProfile.title} ━━━`));
    console.log(chalk.dim(`  HP:${bossProfile.stats.maxHp} MP:${bossProfile.stats.maxMp} STR:${bossProfile.stats.strength} DEF:${bossProfile.stats.defense} MAG:${bossProfile.stats.magic} SPD:${bossProfile.stats.speed}`));
    console.log();

    // Fresh character each fight
    const playerChar = createCharacter("agent1", opts.agent1Name, opts.agent1Class as any);
    const bossChar = createBoss(bossId);

    const agent1 = createAgent(agentMode, playerChar.id, playerChar.name, playerChar.class, opts.agent1Model);
    const bossAgent = new BossAgent("boss", bossProfile.name, bossId);

    const agentMap = new Map<string, IAgent>([
      [playerChar.id, agent1],
      [bossChar.id, bossAgent],
    ]);
    const cliRenderer = createCliRenderer(agentMap);

    const runner = new BattleRunner([playerChar, bossChar], [agent1, bossAgent], {
      maxTurns: opts.maxTurns,
      turnDelayMs: opts.delay,
      eventHandler: cliRenderer,
    });

    const log = await runner.run();
    const won = log.winner === "agent1";
    results.push({ bossName: bossProfile.name, won, turns: log.totalTurns });

    saveReplay(log, runner.getCharacters(), runner.getAgents());

    console.log();
    console.log(won
      ? chalk.green(`  ✅ ${bossProfile.name} defeated! (${log.totalTurns} turns)`)
      : chalk.red(`  ❌ Defeated by ${bossProfile.name}! (${log.totalTurns} turns)`)
    );
    console.log();
  }

  // Scorecard
  const wins = results.filter((r) => r.won).length;
  const total = results.length;
  const grade = gradeBossExam(wins, total);

  const gradeColors: Record<string, string> = { S: "gold", A: "green", B: "blue", C: "magenta", D: "yellow", F: "red" };
  console.log(chalk.bold.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(chalk.bold.cyan("  📋 BOSS EXAM RESULTS"));
  console.log(chalk.bold.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));

  for (const r of results) {
    const icon = r.won ? chalk.green("✅") : chalk.red("❌");
    console.log(`  ${icon} ${r.bossName.padEnd(18)} ${r.turns} turns`);
  }

  console.log(chalk.dim("  ────────────────────────────────────────────────"));
  console.log(chalk.bold(`  Score: ${wins}/${total}  Grade: ${grade}`));
  console.log();
}

function gradeBossExam(wins: number, total: number): string {
  const pct = wins / total;
  if (pct >= 1.0) return "S";
  if (pct >= 0.8) return "A";
  if (pct >= 0.6) return "B";
  if (pct >= 0.4) return "C";
  if (pct >= 0.2) return "D";
  return "F";
}

// ── 1v1 Battle ─────────────────────────────────────────

async function run1v1(opts: CliOptions) {
  const validClasses = ["warrior", "mage", "rogue", "paladin"];
  if (!validClasses.includes(opts.agent1Class) || !validClasses.includes(opts.agent2Class)) {
    console.error(chalk.red("Invalid class. Choose from: warrior, mage, rogue, paladin"));
    process.exit(1);
  }

  // Create characters
  const char1 = createCharacter("agent1", opts.agent1Name, opts.agent1Class as any);
  const char2 = createCharacter("agent2", opts.agent2Name, opts.agent2Class as any);

  // Create agents based on mode
  const agent1Mode = opts.mode === "mock" ? "mock" : "llm";
  const agent2Mode = opts.mode === "llm" ? "llm" : "mock";

  const agent1 = createAgent(agent1Mode, char1.id, char1.name, char1.class, opts.agent1Model);
  const agent2 = createAgent(agent2Mode, char2.id, char2.name, char2.class, opts.agent2Model);

  // Create renderer
  const agentMap = new Map<string, IAgent>([
    [char1.id, agent1],
    [char2.id, agent2],
  ]);
  const cliRenderer = createCliRenderer(agentMap);

  // Run battle through the engine
  const runner = new BattleRunner([char1, char2], [agent1, agent2], {
    maxTurns: opts.maxTurns,
    turnDelayMs: opts.delay,
    eventHandler: cliRenderer,
  });

  const log = await runner.run();

  // Save markdown replay (always)
  const replayPath = saveReplay(log, runner.getCharacters(), runner.getAgents());

  // Save JSON log if requested
  if (opts.outputFile) {
    const outPath = path.resolve(opts.outputFile);
    fs.writeFileSync(outPath, JSON.stringify(log, null, 2));
  }

  // Summary
  printBattleSummary(log.winner, log.totalTurns, log.startTime, log.endTime, replayPath);
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
