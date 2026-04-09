#!/usr/bin/env npx tsx
// ─────────────────────────────────────────────────────────
//  Arena CLI — Main entry point
// ─────────────────────────────────────────────────────────
//
//  CLI is just a renderer. BattleRunner is the engine.
//  Same runner powers WebSocket games in server.ts.
//
//  Supports any scenario via --participants:
//    "Name,role,team,agentType[,model]"
//  Legacy --a1/--a2 flags still work for quick 1v1.
// ─────────────────────────────────────────────────────────

import { createCharacter } from "./engine/characters.js";
import { createBoss, getBossProfile, BOSS_ORDER } from "./engine/bosses.js";
import { HeuristicAgent, LLMAgent, BossAgent } from "./agent/index.js";
import type { IAgent } from "./agent/index.js";
import { BattleRunner } from "./arena/battle-runner.js";
import { createCliRenderer, createCliThinkingHandler, printBattleSummary } from "./arena/cli-renderer.js";
import { saveReplay } from "./arena/replay.js";
import { TournamentRunner } from "./arena/tournament.js";
import { saveTournamentReport } from "./arena/tournament-report.js";
import {
  type ParticipantConfig,
  type AgentType,
  type CharacterRole,
  type ArenaConfig,
  autoArenaPreset,
  ARENA_PRESETS,
} from "./engine/types.js";
import chalk from "chalk";
import fs from "fs";
import path from "path";

// ── CLI Args ────────────────────────────────────────────

const args = process.argv.slice(2);

interface CliOptions {
  // Legacy 1v1 flags
  agent1Class: string;
  agent1Name: string;
  agent1Model: string;
  agent2Class: string;
  agent2Name: string;
  agent2Model: string;
  mode: string;

  // Scenario flags
  participants: string[];       // --participants "Name,role,team,agent[,model]"
  arena: string;                // --arena small|medium|large|boss_room|grand
  winCondition: string;         // --win last_team_standing|last_unit_standing

  // Tournament flags
  tournament: boolean;
  tournamentModels: string[];   // --tournament-models "ModelA" "ModelB" ...
  tournamentBestOf: number;
  tournamentHeuristic: boolean;
  tournamentKFactor: number;
  tournamentOutputDir: string;

  serveReports: boolean;
  serveReportsPort: number;
  testMode: boolean;

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
    participants: [],
    arena: "",
    winCondition: "last_team_standing",
    maxTurns: 30,
    delay: 1500,
    bossExam: false,
    tournament: false,
    tournamentModels: [],
    tournamentBestOf: 5,
    tournamentHeuristic: false,
    tournamentKFactor: 32,
    tournamentOutputDir: "tournament",
    serveReports: false,
    serveReportsPort: 8050,
    testMode: false,
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
      case "--arena": opts.arena = args[++i]; break;
      case "--win": opts.winCondition = args[++i]; break;
      case "--participants": case "-p":
        // Collect all following args until next flag
        while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          opts.participants.push(args[++i]);
        }
        break;
      case "--tournament": opts.tournament = true; break;
      case "--tournament-models": case "-tm":
        while (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          opts.tournamentModels.push(args[++i]);
        }
        break;
      case "--tournament-best-of": opts.tournamentBestOf = parseInt(args[++i]); break;
      case "--tournament-heuristic": opts.tournamentHeuristic = true; break;
      case "--tournament-k-factor": opts.tournamentKFactor = parseInt(args[++i]); break;
      case "--tournament-output": opts.tournamentOutputDir = args[++i]; break;
      case "--serve-reports": opts.serveReports = true; break;
      case "--serve-reports-port": opts.serveReportsPort = parseInt(args[++i]); break;
      case "--test-mode": opts.testMode = true; break;
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

═══ Scenario Mode (any battle configuration) ═══

  -p, --participants <spec> [<spec> ...]
      Each spec: "Name,Role,Team,AgentType[,Model]"
      Role: warrior, mage, rogue, paladin, or boss ID (goblin_king, dark_wizard, etc.)
      Team: any string — same team = allies (e.g. "red", "blue", "boss")
      AgentType: heuristic, llm, human, boss
      Model: LLM model name (only for agentType "llm")

  --arena <preset>        Arena size: small, medium, large, boss_room, grand
                          (default: auto-picked by participant count)
  --win <condition>       Win condition: last_team_standing (default), last_unit_standing (FFA)

═══ Legacy 1v1 Flags ═══

  --mode mock             Both agents use heuristic AI (default)
  --mode llm              Both agents use OpenAI-compatible LLM
  --mode mixed            Agent 1 = LLM, Agent 2 = heuristic

  --a1-class <class>      Agent 1 class: warrior, mage, rogue, paladin (default: warrior)
  --a1-name <name>        Agent 1 name (default: Alpha)
  --a1-model <model>      Agent 1 LLM model (default: gpt-4o-mini)
  --a2-class <class>      Agent 2 class (default: mage)
  --a2-name <name>        Agent 2 name (default: Beta)
  --a2-model <model>      Agent 2 LLM model (default: gpt-4o-mini)

═══ General ═══

  --boss-exam             Boss Exam: fight all 5 bosses, graded at end
  --max-turns <n>         Maximum turns before draw (default: 30)
  --delay <ms>            Delay between turns in ms (default: 1500)
  --output, -o <file>     Save battle log to JSON file
  --help, -h              Show this help

═══ Tournament Mode ═══

  --tournament            Run ELO round-robin tournament
  -tm, --tournament-models <model> [<model> ...]
                          LLM models to compete (space-separated)
  --tournament-best-of <n> Games per matchup (default: 5)
  --tournament-heuristic       Include heuristic baseline in the tournament
  --tournament-k-factor <n> ELO K-factor (default: 32)
  --tournament-output <dir> Output directory (default: tournament/)

  --serve-reports          Start tournament web dashboard
  --serve-reports-port <n> Port for web dashboard (default: 8050)
  --test-mode              Use heuristic agents (no LLM needed) for dashboard testing

Environment:
  LLM_API_KEY    API key (not needed for local providers like Ollama)
  LLM_BASE_URL   Base URL (default: https://api.openai.com/v1)

Examples:
  # Classic 1v1 (legacy flags)
  npx tsx src/index.ts --mode mock --delay 500

  # 1v1 with participants
  npx tsx src/index.ts -p "Alpha,warrior,red,llm" "Beta,mage,blue,llm"

  # 2v2 team battle
  npx tsx src/index.ts -p \\
    "Tank,warrior,red,llm" "Nuke,mage,red,llm" \\
    "Blade,rogue,blue,llm" "Heals,paladin,blue,llm"

  # Raid: 4 players vs Ancient Dragon
  npx tsx src/index.ts -p \\
    "Tank,paladin,raid,llm" "DPS,rogue,raid,llm" \\
    "Mage,mage,raid,llm" "Bruiser,warrior,raid,llm" \\
    "Dragon,ancient_dragon,boss,boss" \\
    --arena boss_room

  # FFA: 4 players, last one standing
  npx tsx src/index.ts -p \\
    "A,warrior,a,llm" "B,mage,b,llm" \\
    "C,rogue,c,llm" "D,paladin,d,llm" \\
    --win last_unit_standing

  # Boss exam
  npx tsx src/index.ts --boss-exam --a1-class mage --mode llm --a1-model qwen3

  # Tournament: 3 models + heuristic baseline, best of 5
  npx tsx src/index.ts --tournament -tm gemma-4-26b qwen3 cydonia-24b

  # Tournament: no heuristic baseline, custom K-factor
  npx tsx src/index.ts --tournament -tm modelA modelB --tournament-heuristic --tournament-k-factor 24
`));
}

// ── Parse Participant Spec ──────────────────────────────

const BOSS_IDS = new Set(["goblin_king", "dark_wizard", "ancient_dragon", "lich_lord", "demon_lord"]);
const CLASS_IDS = new Set(["warrior", "mage", "rogue", "paladin"]);

function parseParticipantSpec(spec: string): ParticipantConfig {
  const parts = spec.split(",").map(s => s.trim());
  if (parts.length < 4) {
    console.error(chalk.red(`Invalid participant spec (need 4-5 comma-separated values): "${spec}"`));
    console.error(chalk.dim(`  Format: "Name,Role,Team,AgentType[,Model]"`));
    process.exit(1);
  }

  const [name, role, team, agentStr, model] = parts;

  // Validate role
  if (!CLASS_IDS.has(role) && !BOSS_IDS.has(role)) {
    console.error(chalk.red(`Invalid role "${role}". Must be warrior, mage, rogue, paladin, or a boss ID.`));
    process.exit(1);
  }

  // Validate agent type
  const agentType = agentStr as AgentType;
  if (!["heuristic", "llm", "human", "boss"].includes(agentType)) {
    console.error(chalk.red(`Invalid agent type "${agentType}". Must be heuristic, llm, human, or boss.`));
    process.exit(1);
  }

  // If agent is "llm" and no model provided, use default
  const finalModel = agentType === "llm"
    ? (model || process.env.LLM_MODEL || "gpt-4o-mini")
    : undefined;

  return {
    name,
    team,
    role: role as CharacterRole,
    agent: agentType,
    model: finalModel,
  };
}

// ── Agent Factory ───────────────────────────────────────

function createAgentFor(
  agentType: AgentType,
  id: string,
  name: string,
  charClass: string,
  model?: string,
  bossId?: string,
  onThinking?: (step: any) => void,
): IAgent {
  switch (agentType) {
    case "llm":
      return new LLMAgent({
        id,
        name,
        characterClass: charClass,
        model: model || "gpt-4o-mini",
        apiKey: process.env.LLM_API_KEY || "no-key",
        baseURL: process.env.LLM_BASE_URL || "http://localhost:8008/v1",
        onThinking,
      });
    case "boss":
      return new BossAgent(id, name, bossId as any);
    case "human":
      // Human agent not yet implemented — fall back to heuristic
      return new HeuristicAgent(id, name);
    case "heuristic":
    default:
      return new HeuristicAgent(id, name);
  }
}

// ── Main ────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(args);

  if (opts.serveReports) {
    await serveReports(opts);
  } else if (opts.tournament || opts.tournamentModels.length > 0) {
    await runTournament(opts);
  } else if (opts.bossExam) {
    await runBossExam(opts);
  } else if (opts.participants.length > 0) {
    await runScenario(opts);
  } else {
    await run1v1(opts);
  }
}

// ── Serve Reports Mode ────────────────────────────────

async function serveReports(opts: CliOptions) {
  const { startTournamentServer } = await import("./arena/tournament-server.js");

  if (opts.testMode) {
    console.log(chalk.yellow("  ⚠️  Test mode: using heuristic agents (no LLM needed)"));
  }

  await startTournamentServer({
    port: opts.serveReportsPort,
    baseURL: process.env.LLM_BASE_URL || "http://localhost:8008/v1",
    apiKey: process.env.LLM_API_KEY || "no-key",
    outputDir: opts.tournamentOutputDir,
    testMode: opts.testMode,
  });

  console.log(chalk.bold.cyan(`\n⚔️  Tournament Dashboard: http://localhost:${opts.serveReportsPort}\n`));
  console.log(chalk.dim("  Setup tournaments, monitor live, and view reports"));
  console.log(chalk.dim("  Press Ctrl+C to stop\n"));
}

// ── Tournament Mode ────────────────────────────────────

function label(model: string): string {
  return model === "heuristic-baseline" ? "🤖 heuristic" : model;
}

async function runTournament(opts: CliOptions) {
  if (opts.tournamentModels.length < 1) {
    console.error(chalk.red("Need at least 1 model for tournament. Use -tm ModelA ModelB ..."));
    process.exit(1);
  }

  const runner = new TournamentRunner({
    models: opts.tournamentHeuristic
      ? [...opts.tournamentModels, "heuristic-baseline"]
      : opts.tournamentModels,
    bestOf: opts.tournamentBestOf,
    baseURL: process.env.LLM_BASE_URL || "http://localhost:8008/v1",
    apiKey: process.env.LLM_API_KEY || "no-key",
    turnDelayMs: 0,
    maxTurns: opts.maxTurns,
    kFactor: opts.tournamentKFactor,
    outputDir: opts.tournamentOutputDir,
  });

  // Log to console
  runner.onEvent((event) => {
    switch (event.type) {
      case "tournament_start":
        console.log(chalk.bold.cyan("\n🏆  ELO TOURNAMENT  🏆\n"));
        break;
      case "matchup_start":
        console.log(chalk.bold.yellow(`━━━ ${label(event.modelA)} vs ${label(event.modelB)} ━━━`));
        break;
      case "game_start":
        console.log(chalk.dim(`  Game ${event.gameNum}: ${event.classA} vs ${event.classB}`));
        break;
      case "game_end":
        const g = event.game;
        const w = g.winner === "A" ? g.modelA : g.winner === "B" ? g.modelB : "draw";
        console.log(chalk.dim(`    → ${label(w)} wins in ${g.turns} turns  ELO: ${label(g.modelA)}=${event.eloA}  ${label(g.modelB)}=${event.eloB}`));
        break;
      case "matchup_end":
        console.log(chalk.dim(`  Series: ${label(event.modelA)} ${event.winsA}-${event.winsB} ${label(event.modelB)}`));
        break;
      case "tournament_end":
        break;
    }
  });

  const result = await runner.run();

  // Save reports
  const { paths } = saveTournamentReport(result, opts.tournamentOutputDir);
  console.log("");
  console.log(chalk.bold.cyan("══════════════════════════════════════════════════"));
  console.log(chalk.bold.cyan("  📁 Reports saved:"));
  for (const p of paths) {
    console.log(chalk.dim(`     ${p}`));
  }
  console.log(chalk.bold.cyan("══════════════════════════════════════════════════"));
}

// ── Scenario Battle (generic N-participant) ─────────────

async function runScenario(opts: CliOptions) {
  const configs = opts.participants.map(parseParticipantSpec);

  if (configs.length < 2) {
    console.error(chalk.red("Need at least 2 participants for a battle."));
    process.exit(1);
  }

  // Check for duplicate names
  const names = configs.map(c => c.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    console.error(chalk.red(`Duplicate participant names: ${dupes.join(", ")}. Each name must be unique.`));
    process.exit(1);
  }

  // Build characters and agents
  const characters = configs.map((cfg, i) => {
    const id = `unit${i + 1}`;
    if (BOSS_IDS.has(cfg.role)) {
      return createBoss(cfg.role as any);
    }
    return createCharacter(id, cfg.name, cfg.role as any, { x: 0, y: 0 }, cfg.team);
  });

  // Fix boss character names/ids to match participant config
  const thinkingHandler = createCliThinkingHandler();
  const agents: IAgent[] = configs.map((cfg, i) => {
    const id = characters[i].id;
    // Override boss name if specified
    if (BOSS_IDS.has(cfg.role)) {
      characters[i].name = cfg.name;
      characters[i].team = cfg.team;
    }
    return createAgentFor(cfg.agent, id, cfg.name, characters[i].class, cfg.model, undefined, thinkingHandler);
  });

  // Pick arena
  const arena: ArenaConfig = opts.arena && ARENA_PRESETS[opts.arena]
    ? ARENA_PRESETS[opts.arena]
    : autoArenaPreset(configs.length);

  // Print battle header
  console.log(chalk.bold.cyan("\n⚔️  RPG ARENA BATTLE\n"));
  const teams = new Set(configs.map(c => c.team));
  if (teams.size === configs.length) {
    console.log(chalk.bold("  Mode: Free-For-All (last unit standing)\n"));
  } else {
    for (const team of teams) {
      const members = configs.filter(c => c.team === team);
      console.log(chalk.bold(`  Team "${team}": `) + members.map(m =>
        `${m.name} (${m.role}) [${m.agent === 'llm' ? '🧠' : '🤖'}]`
      ).join(", "));
    }
    console.log();
  }

  // Create renderer and run
  const agentMap = new Map<string, IAgent>(agents.map(a => [a.id, a]));
  const cliRenderer = createCliRenderer(agentMap);

  const runner = new BattleRunner(characters, agents, {
    maxTurns: opts.maxTurns,
    turnDelayMs: opts.delay,
    eventHandler: cliRenderer,
    arena,
    winCondition: opts.winCondition as any,
  });

  const log = await runner.run();
  const replayPath = saveReplay(log, runner.getCharacters(), runner.getAgents());

  if (opts.outputFile) {
    const outPath = path.resolve(opts.outputFile);
    fs.writeFileSync(outPath, JSON.stringify(log, null, 2));
  }

  printBattleSummary(log.winner, log.totalTurns, log.startTime, log.endTime, replayPath);
}

// ── Boss Exam ──────────────────────────────────────────

async function runBossExam(opts: CliOptions) {
  const validClasses = ["warrior", "mage", "rogue", "paladin"];
  if (!validClasses.includes(opts.agent1Class)) {
    console.error(chalk.red("Invalid class. Choose from: warrior, mage, rogue, paladin"));
    process.exit(1);
  }

  const agentMode = opts.mode === "mock" ? "mock" : "llm";
  const thinkingHandler = createCliThinkingHandler();
  const results: { bossName: string; won: boolean; turns: number }[] = [];

  console.log(chalk.bold.cyan("\n👹 BOSS EXAM — Fight 5 bosses of increasing difficulty!\n"));
  console.log(`  Agent: ${opts.agent1Name} (${opts.agent1Class}) [${agentMode === 'llm' ? '🧠 LLM' : '🤖 Mock'}]`);
  console.log(chalk.dim(`  ${"─".repeat(50)}\n`));

  for (let i = 0; i < BOSS_ORDER.length; i++) {
    const bossId = BOSS_ORDER[i];
    const bossProfile = getBossProfile(bossId)!;

    console.log(chalk.bold.yellow(`━━━ Boss ${i + 1}/${BOSS_ORDER.length}: ${bossProfile.emoji} ${bossProfile.name} — ${bossProfile.title} ━━━`));
    console.log(chalk.dim(`  HP:${bossProfile.hp} AC:${bossProfile.ac} STR:${bossProfile.abilities.str} DEX:${bossProfile.abilities.dex} SPD:${bossProfile.speed}ft`));
    console.log();

    // Fresh character each fight
    const playerChar = createCharacter("agent1", opts.agent1Name, opts.agent1Class as any);
    const bossChar = createBoss(bossId);

    const agent1 = createAgentFor(agentMode as any, playerChar.id, playerChar.name, playerChar.class, opts.agent1Model, undefined, thinkingHandler);
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
      arena: ARENA_PRESETS.boss_room,
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

// ── 1v1 Battle (legacy) ────────────────────────────────

async function run1v1(opts: CliOptions) {
  const validClasses = ["warrior", "mage", "rogue", "paladin"];
  if (!validClasses.includes(opts.agent1Class) || !validClasses.includes(opts.agent2Class)) {
    console.error(chalk.red("Invalid class. Choose from: warrior, mage, rogue, paladin"));
    process.exit(1);
  }

  const char1 = createCharacter("agent1", opts.agent1Name, opts.agent1Class as any, undefined, "a");
  const char2 = createCharacter("agent2", opts.agent2Name, opts.agent2Class as any, undefined, "b");

  const agent1Mode = opts.mode === "mock" ? "mock" : "llm";
  const agent2Mode = opts.mode === "llm" ? "llm" : "mock";
  const thinkingHandler = createCliThinkingHandler();

  const agent1 = createAgentFor(agent1Mode as any, char1.id, char1.name, char1.class, opts.agent1Model, undefined, thinkingHandler);
  const agent2 = createAgentFor(agent2Mode as any, char2.id, char2.name, char2.class, opts.agent2Model, undefined, thinkingHandler);

  const agentMap = new Map<string, IAgent>([
    [char1.id, agent1],
    [char2.id, agent2],
  ]);
  const cliRenderer = createCliRenderer(agentMap);

  const runner = new BattleRunner([char1, char2], [agent1, agent2], {
    maxTurns: opts.maxTurns,
    turnDelayMs: opts.delay,
    eventHandler: cliRenderer,
  });

  const log = await runner.run();
  const replayPath = saveReplay(log, runner.getCharacters(), runner.getAgents());

  if (opts.outputFile) {
    const outPath = path.resolve(opts.outputFile);
    fs.writeFileSync(outPath, JSON.stringify(log, null, 2));
  }

  printBattleSummary(log.winner, log.totalTurns, log.startTime, log.endTime, replayPath);
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
