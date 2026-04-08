// ─────────────────────────────────────────────────────────
//  Tournament Server — Web UI for ELO tournaments
// ─────────────────────────────────────────────────────────
//
//  Single Express app that serves:
//    GET  /                       — Dashboard (setup + live + reports)
//    GET  /api/models             — List models from LLM endpoint
//    POST /api/tournament/start   — Start a tournament
//    POST /api/tournament/abort   — Abort running tournament
//    GET  /api/tournament/events  — SSE stream for live progress
//    GET  /api/tournament/status  — Current tournament state
//    GET  /api/reports            — List saved report files
//    GET  /report/{*path}         — View a markdown report as HTML
// ─────────────────────────────────────────────────────────

import express from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TournamentRunner, type TournamentEvent, type TournamentResult, HEURISTIC_BASELINE } from "./tournament.js";
import { HeuristicAgent } from "../agent/heuristic-agent.js";
import { saveTournamentReport } from "./tournament-report.js";
import { markdownToHtml } from "./report-viewer.js";

// ── State ───────────────────────────────────────────────

// ── State ───────────────────────────────────────────────

let currentRunner: TournamentRunner | null = null;
let currentResult: TournamentResult | null = null;
let isRunning = false;
let aborted = false;
const sseClients: express.Response[] = [];
let eventBuffer: string[] = [];

// ── History persistence ─────────────────────────────────

interface HistoryEntry {
  id: string;
  date: string;
  models: string[];
  winner: string;
  stats: { model: string; elo: number; wins: number; losses: number; draws: number }[];
  runDir?: string;
  reportFiles: string[];
  result?: any; // Full TournamentResult (optional for backward compat)
}

function loadHistory(historyFile: string): HistoryEntry[] {
  try {
    const raw = fs.readFileSync(historyFile, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveHistory(historyFile: string, entry: HistoryEntry): void {
  const hist = loadHistory(historyFile);
  hist.unshift(entry); // newest first
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify(hist, null, 2), "utf-8");
}

// ── ELO rating persistence ────────────────────────────────

interface SavedRating {
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  lastSeen: string;
}

function loadRatings(ratingsFile: string): Record<string, SavedRating> {
  try {
    const raw = fs.readFileSync(ratingsFile, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveRatings(ratingsFile: string, ratings: Record<string, SavedRating>): void {
  fs.mkdirSync(path.dirname(ratingsFile), { recursive: true });
  fs.writeFileSync(ratingsFile, JSON.stringify(ratings, null, 2), "utf-8");
}

function updateSavedRatings(ratingsFile: string, modelStats: any[]): void {
  const ratings = loadRatings(ratingsFile);
  for (const s of modelStats) {
    const existing = ratings[s.model];
    if (existing) {
      existing.elo = s.elo;
      existing.wins += s.wins;
      existing.losses += s.losses;
      existing.draws += s.draws;
      existing.matches += s.matchesPlayed;
      existing.lastSeen = new Date().toISOString();
    } else {
      ratings[s.model] = {
        elo: s.elo,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        matches: s.matchesPlayed,
        lastSeen: new Date().toISOString(),
      };
    }
  }
  saveRatings(ratingsFile, ratings);
}

function getInitialElos(ratingsFile: string, models: string[]): Record<string, number> {
  const ratings = loadRatings(ratingsFile);
  const result: Record<string, number> = {};
  for (const m of models) {
    result[m] = ratings[m]?.elo ?? 1000;
  }
  return result;
}

// ── SSE helper ──────────────────────────────────────────

function broadcast(event: TournamentEvent | { type: string; [key: string]: unknown }): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  eventBuffer.push(data);
  for (const res of sseClients) {
    try { res.write(data); } catch { /* client disconnected */ }
  }
}

function removeSseClient(res: express.Response): void {
  const idx = sseClients.indexOf(res);
  if (idx >= 0) sseClients.splice(idx, 1);
}

// ── Create App ──────────────────────────────────────────

export function createTournamentApp(options: {
  baseURL: string;
  apiKey: string;
  outputDir: string;
  /** When true, use HeuristicAgent for all models (testing mode, no LLM needed) */
  testMode?: boolean;
}): express.Application {
  const app = express();
  app.use(express.json());

  const reportDir = path.resolve(options.outputDir);
  const historyFile = path.join(reportDir, "history.json");
  const ratingsFile = path.join(reportDir, "ratings.json");

  // ── API: List available models from LLM endpoint ──
  app.get("/api/models", async (_req, res) => {
    if (options.testMode) {
      res.json({ models: ["Alice", "Bob", "Charlie"], testMode: true });
      return;
    }
    try {
      const resp = await fetch(`${options.baseURL}/models`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as any;
      const models: string[] = (data.data ?? data.models ?? [])
        .map((m: any) => m.id)
        .filter((id: string) => typeof id === "string");
      res.json({ models });
    } catch (err: any) {
      res.json({ models: [], error: err.message });
    }
  });

  // ── API: Health check for LLM endpoint ──
  app.get("/api/health", async (_req, res) => {
    try {
      const start = Date.now();
      const resp = await fetch(`${options.baseURL}/models`, { signal: AbortSignal.timeout(5000) });
      const latency = Date.now() - start;
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as any;
      const modelCount = (data.data ?? data.models ?? []).length;
      res.json({ status: "ok", latency: `${latency}ms`, models: modelCount, url: options.baseURL });
    } catch (err: any) {
      res.status(503).json({ status: "error", error: err.message, url: options.baseURL });
    }
  });

  // ── API: Start tournament ──
  app.post("/api/tournament/start", async (req, res) => {
    if (isRunning) {
      res.status(409).json({ error: "Tournament already running" });
      return;
    }
    if (!req.body.models || req.body.models.length < 1) {
      res.status(400).json({ error: "Need at least 1 model" });
      return;
    }
    const bestOf = req.body.bestOf ?? 5;
    const maxTurns = req.body.maxTurns ?? 30;
    const kFactor = req.body.kFactor ?? 32;
    if (bestOf < 1 || bestOf > 99) {
      res.status(400).json({ error: "bestOf must be between 1 and 99" });
      return;
    }
    if (maxTurns < 1 || maxTurns > 999) {
      res.status(400).json({ error: "maxTurns must be between 1 and 999" });
      return;
    }
    if (kFactor < 1 || kFactor > 100) {
      res.status(400).json({ error: "kFactor must be between 1 and 100" });
      return;
    }

    isRunning = true;
    eventBuffer = [];
    aborted = false;
    currentResult = null;
    const initialElos = getInitialElos(ratingsFile, req.body.models);
    currentRunner = new TournamentRunner({
      models: req.body.models,
      bestOf,
      includeHeuristic: req.body.includeHeuristic ?? true,
      baseURL: options.baseURL,
      apiKey: options.apiKey,
      turnDelayMs: 0,
      maxTurns,
      kFactor,
      outputDir: options.outputDir,
      initialElos,
      ...(options.testMode ? { agentFactory: (_m: string, id: string, name: string) => new HeuristicAgent(id, name) } : {}),
    });

    // Wire event handler → SSE broadcast
    currentRunner.onEvent(broadcast);

    res.json({ status: "started" });

    // Run in background
    try {
      currentResult = await currentRunner.run();
      if (!aborted) {
        const { runDir, paths } = saveTournamentReport(currentResult, options.outputDir);
        broadcast({ type: "reports_saved", paths });

        // Persist to history
        const sorted = [...currentResult.stats].sort((a, b) => b.elo - a.elo);
        saveHistory(historyFile, {
          id: currentResult.startTime.replace(/[:.]/g, "-"),
          date: currentResult.startTime,
          models: currentResult.stats.map(s => s.model),
          winner: sorted[0]?.model ?? "—",
          stats: sorted.map(s => ({ model: s.model, elo: s.elo, wins: s.wins, losses: s.losses, draws: s.draws })),
          runDir,
          reportFiles: paths.map(p => path.relative(reportDir, p).replace(/\\/g, "/")),
          result: currentResult,
        });
        // Persist ELO ratings
        updateSavedRatings(ratingsFile, currentResult.stats);
      }
    } catch (err: any) {
      broadcast({ type: "tournament_error", error: err.message });
    } finally {
      isRunning = false;
    }
  });

  // ── API: Abort tournament ──
  app.post("/api/tournament/abort", (_req, res) => {
    if (!isRunning) {
      res.status(400).json({ error: "No tournament running" });
      return;
    }
    aborted = true;
    if (currentRunner) currentRunner.abort();
    broadcast({ type: "tournament_aborted" });
    res.json({ status: "aborted" });
    isRunning = false;
  });

  // ── API: Reset state ──
  app.post("/api/tournament/reset", (_req, res) => {
    if (isRunning) {
      res.status(409).json({ error: "Cannot reset while tournament is running" });
      return;
    }
    currentResult = null;
    currentRunner = null;
    res.json({ status: "reset" });
  });

  // ── API: Retry a specific matchup from last tournament result ──
  app.post("/api/tournament/retry/:matchupIdx", async (req, res) => {
    if (isRunning) {
      res.status(409).json({ error: "Tournament already running" });
      return;
    }
    if (!currentResult) {
      res.status(400).json({ error: "No completed tournament to retry from" });
      return;
    }
    const idx = parseInt(req.params.matchupIdx, 10);
    if (isNaN(idx) || idx < 0 || idx >= currentResult.matchups.length) {
      res.status(400).json({ error: `Invalid matchup index ${idx}` });
      return;
    }
    const matchup = currentResult.matchups[idx];

    // Start a Bo1 quick duel for just this pair
    const { bestOf, maxTurns, kFactor, agentFactory, outputDir } = currentResult.config;
    const runner = new TournamentRunner({
      models: [matchup.modelA, matchup.modelB],
      bestOf: bestOf || 1,
      maxTurns: maxTurns || 30,
      kFactor: kFactor || 32,
      agentFactory: agentFactory || undefined,
      outputDir: outputDir || undefined,
    });

    // Wire event handlers
    runner.onEvent((event: TournamentEvent) => {
      broadcast(event);
    });

    isRunning = true;
    aborted = false;
    currentRunner = runner;
    res.json({ status: "started", modelA: matchup.modelA, modelB: matchup.modelB });

    try {
      const result = await runner.run();
      currentResult = result;
      if (outputDir) {
        try { saveTournamentReport(result, outputDir); } catch (_e) { /* ignore */ }
      }
    } catch (err: any) {
      broadcast({ type: "tournament_aborted", reason: err.message });
    } finally {
      isRunning = false;
      currentRunner = null;
    }
  });

  // ── API: Current status ──
  app.get("/api/tournament/status", (_req, res) => {
    res.json({
      isRunning,
      hasResult: currentResult !== null,
      result: currentResult ? {
        startTime: currentResult.startTime,
        endTime: currentResult.endTime,
        stats: currentResult.stats,
        matchups: currentResult.matchups.map(m => ({
          modelA: m.modelA, modelB: m.modelB,
          winsA: m.winsA, winsB: m.winsB, draws: m.draws,
          games: m.games.map(g => ({
            gameNumber: g.gameNumber, classA: g.classA, classB: g.classB,
            winner: g.winner, turns: g.turns, durationMs: g.durationMs,
            error: g.error,
          })),
        })),
      } : null,
    });
  });

  // ── API: Replay past SSE events (for page reload) ──
  app.get("/api/tournament/events/replay", (_req, res) => {
    res.json({ events: eventBuffer.map(d => JSON.parse(d.replace('data: ', '').replace('\n\n', ''))) });
  });

  // ── API: SSE event stream ──
  app.get("/api/tournament/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    sseClients.push(res);
    req.on("close", () => removeSseClient(res));
  });

  // ── API: Tournament history ──
  app.get("/api/history", (_req, res) => {
    const hist = loadHistory(historyFile);
    res.json({ history: hist });
  });

  // ── API: Get specific history entry ──
  app.get("/api/history/:id", (req, res) => {
    const hist = loadHistory(historyFile);
    const entry = hist.find(h => h.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: "History entry not found" });
      return;
    }
    res.json(entry);
  });

  // ── API: Get persisted ELO ratings ──
  app.get("/api/ratings", (_req, res) => {
    const ratings = loadRatings(ratingsFile);
    res.json({ ratings });
  });

  // ── API: Export current tournament as JSON ──
  app.get("/api/export/json", (_req, res) => {
    if (!currentResult) {
      res.status(404).json({ error: "No tournament result available" });
      return;
    }
    res.setHeader("Content-Disposition", `attachment; filename="tournament_${currentResult.startTime.replace(/[:.]/g, "-")}.json"`);
    res.json(currentResult);
  });

  // ── API: Export current tournament as CSV ──
  app.get("/api/export/csv", (_req, res) => {
    if (!currentResult) {
      res.status(404).json({ error: "No tournament result available" });
      return;
    }
    const lines: string[] = [];
    // ELO rankings
    lines.push("Rank,Model,ELO,Wins,Losses,Draws,Matches,Win%,BadActions");
    const sorted = [...currentResult.stats].sort((a, b) => b.elo - a.elo);
    sorted.forEach((s, i) => {
      const winPct = s.matchesPlayed > 0 ? ((s.wins / s.matchesPlayed) * 100).toFixed(1) : "0";
      lines.push(`${i + 1},"${s.model}",${s.elo},${s.wins},${s.losses},${s.draws},${s.matchesPlayed},${winPct},${s.totalBadActions}`);
    });
    lines.push("");
    // Matchup results
    lines.push("ModelA,ModelB,WinsA,WinsB,Draws");
    currentResult.matchups.forEach(m => {
      lines.push(`"${m.modelA}","${m.modelB}",${m.winsA},${m.winsB},${m.draws}`);
    });
    lines.push("");
    // Per-game results
    lines.push("Matchup,Game,ClassA,ClassB,Winner,Turns,BadA,BadB");
    currentResult.matchups.forEach(m => {
      m.games.forEach(g => {
        const winner = g.winner === "A" ? m.modelA : g.winner === "B" ? m.modelB : "draw";
        lines.push(`"${m.modelA} vs ${m.modelB}",${g.gameNumber},${g.classA},${g.classB},"${winner}",${g.turns},${g.statsA.badActions},${g.statsB.badActions}`);
      });
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="tournament_${currentResult.startTime.replace(/[:.]/g, "-")}.csv"`);
    res.send(lines.join("\n"));
  });

  // ── API: List saved report files ──
  app.get("/api/reports", (_req, res) => {
    if (!fs.existsSync(reportDir)) {
      res.json({ reports: [] });
      return;
    }
    try {
      const reports: { name: string; path: string; size: number; modified: string }[] = [];

      // Scan top-level files (legacy) and per-run subdirectories
      const entries = fs.readdirSync(reportDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const stat = fs.statSync(path.join(reportDir, entry.name));
          reports.push({ name: entry.name, path: entry.name, size: stat.size, modified: stat.mtime.toISOString() });
        } else if (entry.isDirectory() && entry.name.startsWith("run-")) {
          const subDir = path.join(reportDir, entry.name);
          for (const f of fs.readdirSync(subDir).filter(f => f.endsWith(".md"))) {
            const relPath = entry.name + "/" + f;
            const stat = fs.statSync(path.join(subDir, f));
            reports.push({ name: relPath, path: relPath, size: stat.size, modified: stat.mtime.toISOString() });
          }
        }
      }
      reports.sort((a, b) => b.modified.localeCompare(a.modified));
      res.json({ reports });
    } catch {
      res.json({ reports: [] });
    }
  });

  // ── API: Get game turn log ──
  app.get("/api/game/:matchupIdx/:gameIdx", (req, res) => {
    if (!currentResult) {
      res.status(404).json({ error: "No tournament result yet" });
      return;
    }
    const mi = parseInt(req.params.matchupIdx, 10);
    const gi = parseInt(req.params.gameIdx, 10);
    const matchup = currentResult.matchups[mi];
    if (!matchup) {
      res.status(404).json({ error: "Matchup not found" });
      return;
    }
    const game = matchup.games[gi];
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    res.json({
      modelA: game.modelA,
      modelB: game.modelB,
      classA: game.classA,
      classB: game.classB,
      winner: game.winner,
      turns: game.turns,
      durationMs: game.durationMs,
      turnLog: game.turnLog ?? [],
    });
  });

  // ── API: Export game turn log as CSV ──
  app.get("/api/game/:matchupIdx/:gameIdx/export", (req, res) => {
    if (!currentResult) {
      res.status(404).json({ error: "No tournament result yet" });
      return;
    }
    const mi = parseInt(req.params.matchupIdx, 10);
    const gi = parseInt(req.params.gameIdx, 10);
    const matchup = currentResult.matchups[mi];
    if (!matchup) { res.status(404).json({ error: "Matchup not found" }); return; }
    const game = matchup.games[gi];
    if (!game) { res.status(404).json({ error: "Game not found" }); return; }
    const lines: string[] = ["Turn,Actor,Narrative,HpA,MaxHpA,HpB,MaxHpB"];
    for (const t of (game.turnLog ?? [])) {
      lines.push(`${t.turnNumber},"${t.actorName}","${(t.narrative || "").replace(/"/g, '""')}",${t.hpA},${t.maxHpA},${t.hpB},${t.maxHpB}`);
    }
    const filename = `game_${matchup.modelA}_vs_${matchup.modelB}_${game.gameNumber}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(lines.join("\n"));
  });

  // ── Report viewer ──
  app.get("/report/{*path}", (req, res) => {
    const rawPath = req.params.path;
    const relPath = Array.isArray(rawPath) ? rawPath.join("/") : (rawPath ?? "");
    const fullPath = path.join(reportDir, relPath);
    if (!fullPath.startsWith(reportDir)) { res.status(403).send("Forbidden"); return; }
    if (!fs.existsSync(fullPath)) { res.status(404).send("Not found"); return; }
    const md = fs.readFileSync(fullPath, "utf-8");
    res.setHeader("Content-Type", "text/html").send(markdownToHtml(md));
  });

  // ── Dashboard ──
  app.get("/", (_req, res) => {
    res.setHeader("Content-Type", "text/html").send(DASHBOARD_HTML);
  });

  return app;
}

/** Start the tournament server */
export async function startTournamentServer(options: {
  port: number;
  baseURL: string;
  apiKey: string;
  outputDir: string;
  testMode?: boolean;
}): Promise<Server> {
  const app = createTournamentApp({
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    outputDir: options.outputDir,
    testMode: options.testMode,
  });
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(options.port, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = () => {
    // Close all SSE connections
    for (const res of sseClients) {
      try { res.end(); } catch { /* already closed */ }
    }
    sseClients.length = 0;
    server.closeAllConnections();
    server.close(() => process.exit(0));
    // Force exit after 3s if server doesn't close
    setTimeout(() => process.exit(0), 3000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}

// ── Dashboard HTML ──────────────────────────────────────
// HEURISTIC_BASELINE is substituted into the dashboard HTML via string replace.

const DASHBOARD_HTML = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard.html"),
  "utf-8"
).replace("${HB}", HEURISTIC_BASELINE);


