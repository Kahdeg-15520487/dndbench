// ─────────────────────────────────────────────────────────
//  Tournament Reports — Markdown generation
// ─────────────────────────────────────────────────────────
//
//  Generates two report types:
//    1. Matchup report: best-of-N games between two models
//    2. Tournament report: final ELO rankings + all matchups
//
//  Reports are saved to the tournament output directory.
// ─────────────────────────────────────────────────────────

import type { TournamentResult, MatchupResult, GameResult } from "./tournament.js";
import { HEURISTIC_BASELINE } from "./tournament.js";
import fs from "fs";
import path from "path";

// ── Public API ──────────────────────────────────────────

/**
 * Save a complete tournament report.
 * Returns paths to [tournamentReport, ...matchupReports].
 */
export function saveTournamentReport(
  result: TournamentResult,
  outputDir?: string,
): { runDir: string; paths: string[] } {
  const baseDir = outputDir ?? result.config.outputDir;
  fs.mkdirSync(baseDir, { recursive: true });

  // Create per-run subdirectory: run-2026-04-08T09-27-00
  const runName = "run-" + result.startTime.replace(/[:.]/g, "-");
  const dir = path.join(baseDir, runName);
  fs.mkdirSync(dir, { recursive: true });

  const paths: string[] = [];

  // 1. Save each matchup report
  for (const matchup of result.matchups) {
    const p = saveMatchupReport(matchup, result, dir);
    paths.push(p);
  }

  // 2. Save tournament summary report
  const summaryPath = path.join(dir, "tournament_summary.md");
  const md = renderTournamentSummary(result);
  fs.writeFileSync(summaryPath, md, "utf-8");
  paths.push(summaryPath);

  // 3. Save full tournament data as JSON (for replay persistence)
  const jsonPath = path.join(dir, "tournament_data.json");
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  paths.push(jsonPath);

  return { runDir: runName, paths };
}

// ── Matchup Report ──────────────────────────────────────

function saveMatchupReport(matchup: MatchupResult, result: TournamentResult, dir: string): string {
  const nameA = modelLabel(matchup.modelA);
  const nameB = modelLabel(matchup.modelB);
  const filename = `matchup_${sanitize(nameA)}_vs_${sanitize(nameB)}.md`;
  const filePath = path.join(dir, filename);

  const md = renderMatchupReport(matchup, result);
  fs.writeFileSync(filePath, md, "utf-8");
  return filePath;
}

function renderMatchupReport(matchup: MatchupResult, result: TournamentResult): string {
  const lines: string[] = [];
  const nameA = modelLabel(matchup.modelA);
  const nameB = modelLabel(matchup.modelB);

  lines.push(`# 🏆 Matchup: ${nameA} vs ${nameB}`);
  lines.push("");
  lines.push(`**Best of ${result.config.bestOf}**  |  K-factor: ${result.config.kFactor}`);
  lines.push("");

  // ── Summary table ──
  lines.push("## Summary");
  lines.push("");
  lines.push("| | Games Won | Draws | Final ELO |");
  lines.push("|---|---|---|---|");

  const eloA = result.stats.find(s => s.model === matchup.modelA);
  const eloB = result.stats.find(s => s.model === matchup.modelB);

  lines.push(`| **${nameA}** | ${matchup.winsA} | ${matchup.draws} | ${eloA?.elo ?? "—"} |`);
  lines.push(`| **${nameB}** | ${matchup.winsB} | ${matchup.draws} | ${eloB?.elo ?? "—"} |`);
  lines.push("");

  if (matchup.winsA > matchup.winsB) {
    lines.push(`> **${nameA} wins the matchup ${matchup.winsA}-${matchup.winsB}!**`);
  } else if (matchup.winsB > matchup.winsA) {
    lines.push(`> **${nameB} wins the matchup ${matchup.winsB}-${matchup.winsA}!**`);
  } else {
    lines.push(`> **Matchup tied ${matchup.winsA}-${matchup.winsB}!**`);
  }
  lines.push("");

  // ── Game-by-game breakdown ──
  lines.push("---");
  lines.push("");
  lines.push("## Game Details");
  lines.push("");

  for (const game of matchup.games) {
    const gNameA = modelLabel(game.modelA);
    const gNameB = modelLabel(game.modelB);
    const winnerLabel = game.winner === "A" ? gNameA : game.winner === "B" ? gNameB : "Draw";
    const resultIcon = game.winner === "draw" ? "🤝" : "⚔️";

    lines.push(`### ${resultIcon} Game ${game.gameNumber}: ${game.classA} vs ${game.classB}`);
    lines.push("");
    lines.push(`| | ${gNameA} | ${gNameB} |`);
    lines.push("|---|---|---|");
    lines.push(`| **Class** | ${game.classA} | ${game.classB} |`);
    lines.push(`| **Result** | ${game.winner === "A" ? "✅ WIN" : game.winner === "B" ? "❌ LOSS" : "🤝 DRAW"} | ${game.winner === "B" ? "✅ WIN" : game.winner === "A" ? "❌ LOSS" : "🤝 DRAW"} |`);
    lines.push(`| **Turns** | ${game.statsA.turns} | ${game.statsB.turns} |`);
    lines.push(`| **Tool Calls** | ${game.statsA.toolCalls} | ${game.statsB.toolCalls} |`);
    lines.push(`| **Avg Tools/Turn** | ${game.statsA.avgToolCallsPerTurn.toFixed(1)} | ${game.statsB.avgToolCallsPerTurn.toFixed(1)} |`);
    lines.push(`| **Bad Actions** | ${game.statsA.badActions} (${(game.statsA.badActionRate * 100).toFixed(0)}%) | ${game.statsB.badActions} (${(game.statsB.badActionRate * 100).toFixed(0)}%) |`);
    lines.push("");
    lines.push(`- **Winner**: ${winnerLabel} in ${game.turns} turns` + (game.durationMs ? ` (${(game.durationMs / 1000).toFixed(1)}s)` : ''));
    if (game.error) lines.push(`- **⚠️ Error**: ${game.error}`);
    lines.push("");
  }

  // ── Aggregate stats ──
  lines.push("---");
  lines.push("");
  lines.push("## Aggregate Stats");
  lines.push("");

  const aggA = aggregateGameStats(matchup.games, "A");
  const aggB = aggregateGameStats(matchup.games, "B");

  lines.push("| Metric | " + ` ${nameA} | ${nameB} |`);
  lines.push("|---|---|---|");
  lines.push(`| Total Tool Calls | ${aggA.toolCalls} | ${aggB.toolCalls} |`);
  lines.push(`| Avg Tools/Turn | ${aggA.avgToolCalls.toFixed(1)} | ${aggB.avgToolCalls.toFixed(1)} |`);
  lines.push(`| Total Bad Actions | ${aggA.badActions} | ${aggB.badActions} |`);
  lines.push(`| Bad Action Rate | ${(aggA.badRate * 100).toFixed(1)}% | ${(aggB.badRate * 100).toFixed(1)}% |`);
  lines.push(`| Total Turns Played | ${aggA.turns} | ${aggB.turns} |`);
  lines.push(`| Avg Turns/Game | ${aggA.avgTurns.toFixed(1)} | ${aggB.avgTurns.toFixed(1)} |`);
  lines.push("");

  return lines.join("\n");
}

// ── Tournament Summary ──────────────────────────────────

function renderTournamentSummary(result: TournamentResult): string {
  const lines: string[] = [];

  lines.push("# 🏆 Tournament Summary");
  lines.push("");
  lines.push(`**Date**: ${result.startTime.slice(0, 10)}`);
  lines.push(`**Duration**: ${result.startTime.slice(11, 19)} → ${result.endTime.slice(11, 19)}`);
  lines.push(`**Participants**: ${result.stats.length}  |  **Best of**: ${result.config.bestOf}  |  **K-factor**: ${result.config.kFactor}`);
  lines.push("");

  // ── ELO Rankings ──
  lines.push("## 📊 ELO Rankings");
  lines.push("");
  lines.push("| Rank | Model | ELO | W | L | D | Win% | Bad Actions | Avg Tools/Turn |");
  lines.push("|---|---|---|---|---|---|---|---|---|");

  const sorted = [...result.stats].sort((a, b) => b.elo - a.elo);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const rank = i + 1;
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}.`;
    const label = s.isHeuristic ? `🤖 ${s.model}` : s.model;
    const winPct = s.matchesPlayed > 0 ? ((s.wins / s.matchesPlayed) * 100).toFixed(0) : "—";
    const badPct = s.totalTurns > 0
      ? `${s.totalBadActions} (${((s.totalBadActions / s.totalTurns) * 100).toFixed(1)}%)`
      : "—";
    const avgTools = s.totalTurns > 0
      ? (s.totalToolCalls / s.totalTurns).toFixed(1)
      : "—";

    lines.push(`| ${medal} | ${label} | ${s.elo} | ${s.wins} | ${s.losses} | ${s.draws} | ${winPct}% | ${badPct} | ${avgTools} |`);
  }
  lines.push("");

  // ── Matchup Matrix ──
  lines.push("## 🔄 Matchup Matrix");
  lines.push("");
  renderMatchupMatrix(lines, result);
  lines.push("");

  // ── Class Performance ──
  lines.push("## ⚔️ Class Performance by Model");
  lines.push("");
  lines.push("| Model | Warrior | Mage | Rogue | Paladin |");
  lines.push("|---|---|---|---|---|");
  for (const s of sorted) {
    const label = s.isHeuristic ? `🤖 ${s.model}` : s.model;
    const w = s.battlesAsWarrior > 0 ? `${s.winsAsWarrior}/${s.battlesAsWarrior}` : "—";
    const m = s.battlesAsMage > 0 ? `${s.winsAsMage}/${s.battlesAsMage}` : "—";
    const r = s.battlesAsRogue > 0 ? `${s.winsAsRogue}/${s.battlesAsRogue}` : "—";
    const p = s.battlesAsPaladin > 0 ? `${s.winsAsPaladin}/${s.battlesAsPaladin}` : "—";
    lines.push(`| ${label} | ${w} | ${m} | ${r} | ${p} |`);
  }
  lines.push("");

  // ── Matchup Summaries ──
  lines.push("---");
  lines.push("");
  lines.push("## 📋 All Matchups");
  lines.push("");

  for (const matchup of result.matchups) {
    const nameA = modelLabel(matchup.modelA);
    const nameB = modelLabel(matchup.modelB);
    const winner = matchup.winsA > matchup.winsB ? nameA : matchup.winsB > matchup.winsA ? nameB : "Draw";

    lines.push(`### ${nameA} vs ${nameB}`);
    lines.push("");
    lines.push(`- **Result**: ${nameA} **${matchup.winsA}** - ${matchup.winsB} ${nameB} (${matchup.draws} draws)`);
    lines.push(`- **Winner**: ${winner}`);

    // Game summary table
    lines.push("");
    lines.push("| Game | Classes | Winner | Turns | Duration | Bad A | Bad B |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const game of matchup.games) {
      const gWinner = game.winner === "A" ? nameA : game.winner === "B" ? nameB : "Draw";
      const dur = game.durationMs ? (game.durationMs / 1000).toFixed(1) + 's' : '—';
      lines.push(`| ${game.gameNumber} | ${game.classA} vs ${game.classB} | ${gWinner} | ${game.turns} | ${dur} | ${game.statsA.badActions} | ${game.statsB.badActions} |`);
    }
    lines.push("");
  }

  // ── Footer ──
  lines.push("---");
  lines.push("");
  lines.push(`*Report generated at ${new Date().toISOString()}*`);
  lines.push("");

  return lines.join("\n");
}

// ── Matchup Matrix ──────────────────────────────────────

function renderMatchupMatrix(lines: string[], result: TournamentResult): void {
  const participants = [...result.stats].sort((a, b) => b.elo - a.elo);

  // Header
  const shortNames = participants.map(s => s.isHeuristic ? "🤖heur" : truncate(s.model, 10));
  lines.push("| | " + shortNames.join(" | ") + " |");
  lines.push("|---|" + participants.map(() => "---").join("|") + "|");

  // Rows
  for (let i = 0; i < participants.length; i++) {
    const rowName = shortNames[i];
    const cells: string[] = [];
    for (let j = 0; j < participants.length; j++) {
      if (i === j) {
        cells.push("—");
      } else {
        const matchup = findMatchup(result, participants[i].model, participants[j].model);
        if (matchup) {
          const isA = matchup.modelA === participants[i].model;
          const wins = isA ? matchup.winsA : matchup.winsB;
          const losses = isA ? matchup.winsB : matchup.winsA;
          const draws = matchup.draws;
          cells.push(`${wins}W-${losses}L${draws > 0 ? `-${draws}D` : ""}`);
        } else {
          cells.push("?");
        }
      }
    }
    lines.push(`| **${rowName}** | ${cells.join(" | ")} |`);
  }
}

function findMatchup(result: TournamentResult, modelA: string, modelB: string): MatchupResult | undefined {
  return result.matchups.find(m =>
    (m.modelA === modelA && m.modelB === modelB) ||
    (m.modelA === modelB && m.modelB === modelA)
  );
}

// ── Helpers ─────────────────────────────────────────────

function modelLabel(model: string): string {
  return model === HEURISTIC_BASELINE ? "🤖 Heuristic Baseline" : model;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

interface AggStats {
  toolCalls: number;
  badActions: number;
  turns: number;
  avgToolCalls: number;
  badRate: number;
  avgTurns: number;
}

function aggregateGameStats(games: GameResult[], side: "A" | "B"): AggStats {
  let toolCalls = 0, badActions = 0, turns = 0;
  for (const g of games) {
    const s = side === "A" ? g.statsA : g.statsB;
    toolCalls += s.toolCalls;
    badActions += s.badActions;
    turns += s.turns;
  }
  return {
    toolCalls,
    badActions,
    turns,
    avgToolCalls: turns > 0 ? toolCalls / turns : 0,
    badRate: turns > 0 ? badActions / turns : 0,
    avgTurns: games.length > 0 ? turns / games.length : 0,
  };
}
