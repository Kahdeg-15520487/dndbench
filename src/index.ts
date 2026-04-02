#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────
//  Arena CLI — Main entry point
// ─────────────────────────────────────────────────────────

import { createCharacter } from "./engine/characters.js";
import { HeuristicAgent, LLMAgent } from "./agent/index.js";
import type { IAgent } from "./agent/index.js";
import { BattleRunner } from "./arena/battle-runner.js";
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
  mode: string; // "llm" | "mock" | "mixed" | "human"
  maxTurns: number;
  delay: number;
  outputFile?: string;
  verbose: boolean;
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
    verbose: true,
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
      case "--quiet": opts.verbose = false; break;
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
  --max-turns <n>       Maximum turns before draw (default: 30)
  --delay <ms>          Delay between turns in ms (default: 1500)
  --output, -o <file>   Save battle log to JSON file
  --quiet               Suppress battle output
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

  // Create battle runner
  const runner = new BattleRunner([char1, char2], [agent1, agent2], {
    maxTurns: opts.maxTurns,
    turnDelayMs: opts.delay,
    verbose: opts.verbose,
  });

  // Run the battle
  const log = await runner.run();

  // Save log if requested
  if (opts.outputFile) {
    const outPath = path.resolve(opts.outputFile);
    fs.writeFileSync(outPath, JSON.stringify(log, null, 2));
    if (opts.verbose) {
      console.log(chalk.gray(`Battle log saved to ${outPath}`));
    }
  }

  // Print summary
  if (opts.verbose) {
    console.log("═".repeat(60));
    console.log(chalk.bold("  BATTLE SUMMARY"));
    console.log("═".repeat(60));
    console.log(`  Winner: ${log.winner ? chalk.bold.green(log.winner) : chalk.yellow("Draw")}`);
    console.log(`  Total Turns: ${log.totalTurns}`);
    console.log(`  Duration: ${log.startTime} → ${log.endTime}`);
    console.log("═".repeat(60) + "\n");
  }
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
