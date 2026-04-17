// ─────────────────────────────────────────────────────────
//  Consolidated Backend Server
//  REST API + SSE + WebSocket + Training Data
// ─────────────────────────────────────────────────────────
//
//  Merges:
//    - Web game server (LLM configs, WebSocket battles, bosses, battle logs)
//    - Tournament server (tournaments, SSE events, model discovery, history, ratings)
//    - Training data endpoints (list, export, stats)
// ─────────────────────────────────────────────────────────

import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import { createCharacter } from "./engine/characters.js";
import { createBoss, getBossProfile, getAllBosses, BOSS_ORDER } from "./engine/bosses.js";
import { IAgent, HeuristicAgent, LLMAgent, HumanAgent, BossAgent } from "./agent/index.js";
import type { Character, CharacterClass, CombatAction, BossId, BattleLog } from "./engine/types.js";
import { BattleRunner } from "./arena/battle-runner.js";
import { createWsRenderer } from "./arena/ws-renderer.js";
import { saveReplay } from "./arena/replay.js";
import { TournamentRunner, type TournamentEvent, type TournamentResult, HEURISTIC_BASELINE } from "./arena/tournament.js";
import { saveTournamentReport } from "./arena/tournament-report.js";
import { markdownToHtml } from "./arena/report-viewer.js";
import { collectTrainingData } from "./arena/training-collector.js";
import * as db from "./db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";
const PORT = parseInt(process.env.PORT || "") || (isDev ? 3001 : 3000);

// ── Express ─────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS for dev mode (Vite on :3000 → API on :3001)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

const server = createServer(app);

// ── State ───────────────────────────────────────────────

let currentRunner: TournamentRunner | null = null;
let currentResult: TournamentResult | null = null;
let isRunning = false;
let aborted = false;
const sseClients: express.Response[] = [];
let eventBuffer: string[] = [];

// ── File persistence (history, ratings) ─────────────────

const DATA_DIR = path.join(__dirname, "arena", "data");
const historyFile = path.join(DATA_DIR, "history.json");
const ratingsFile = path.join(DATA_DIR, "ratings.json");

interface HistoryEntry {
  id: string;
  date: string;
  models: string[];
  winner: string;
  stats: { model: string; elo: number; wins: number; losses: number; draws: number }[];
  runDir?: string;
  reportFiles: string[];
  result?: any;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = fs.readFileSync(historyFile, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveHistoryEntry(entry: HistoryEntry): void {
  const hist = loadHistory();
  hist.unshift(entry);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify(hist, null, 2), "utf-8");
}

interface SavedRating {
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  lastSeen: string;
}

function loadRatings(): Record<string, SavedRating> {
  try {
    const raw = fs.readFileSync(ratingsFile, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveRatingsToFile(ratings: Record<string, SavedRating>): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ratingsFile, JSON.stringify(ratings, null, 2), "utf-8");
}

function updateSavedRatings(modelStats: any[]): void {
  const ratings = loadRatings();
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
  saveRatingsToFile(ratings);
}

function getInitialElos(models: string[]): Record<string, number> {
  const ratings = loadRatings();
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

// ── Helper: load tournament result from disk ────────────

const OUTPUT_DIR = path.join(__dirname, "..", "tournament");

function loadResultFromDisk(runDir: string): TournamentResult | null {
  const jsonPath = path.join(OUTPUT_DIR, runDir, "tournament_data.json");
  try {
    if (fs.existsSync(jsonPath)) {
      const raw = fs.readFileSync(jsonPath, "utf-8");
      return JSON.parse(raw) as TournamentResult;
    }
  } catch { /* ignore */ }
  return null;
}

// ── Mask API key helper ────────────────────────────────

function maskApiKey(apiKey: string | null | undefined): string | null {
  return apiKey ? "••••" + apiKey.slice(-4) : null;
}

// ════════════════════════════════════════════════════════
//  REST API: LLM Configs
// ════════════════════════════════════════════════════════

app.get("/api/llm-configs", async (_req, res) => {
  try {
    const configs = await db.listLLMConfigs();
    res.json(configs.map(c => ({
      ...c,
      apiKey: maskApiKey(c.apiKey),
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/llm-configs/:id", async (req, res) => {
  try {
    const config = await db.getLLMConfig(parseInt(req.params.id));
    if (!config) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      ...config,
      apiKey: maskApiKey(config.apiKey),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/llm-configs", async (req, res) => {
  try {
    const config = await db.createLLMConfig(req.body);
    res.status(201).json({
      ...config,
      apiKey: maskApiKey(config.apiKey),
    });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: `Config "${req.body.name}" already exists` });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/llm-configs/:id", async (req, res) => {
  try {
    const config = await db.updateLLMConfig(parseInt(req.params.id), req.body);
    if (!config) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      ...config,
      apiKey: maskApiKey(config.apiKey),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/llm-configs/:id", async (req, res) => {
  try {
    const deleted = await db.deleteLLMConfig(parseInt(req.params.id));
    if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
//  REST API: Tournaments
// ════════════════════════════════════════════════════════

app.get("/api/tournaments", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const tournaments = await db.listTournaments(limit, offset);
    res.json(tournaments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tournaments/:id", async (req, res) => {
  try {
    const tournament = await db.getTournament(parseInt(req.params.id));
    if (!tournament) { res.status(404).json({ error: "Not found" }); return; }
    res.json(tournament);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tournaments", async (req, res) => {
  try {
    const { models, bestOf = 5, maxTurns = 30, kFactor = 32 } = req.body;
    if (!models || models.length < 1) {
      res.status(400).json({ error: "Need at least 1 model" });
      return;
    }
    const id = await db.createTournament({ models, bestOf, maxTurns, kFactor });
    res.status(201).json({ id, status: "pending" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tournaments/:id/start", async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.id);
    const tournament = await db.getTournament(tournamentId);
    if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
    if (tournament.status !== "pending") {
      res.status(409).json({ error: `Tournament is ${tournament.status}` });
      return;
    }
    if (isRunning) {
      res.status(409).json({ error: "Another tournament already running" });
      return;
    }

    const config = tournament.config;
    const baseURL = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    const apiKey = process.env.LLM_API_KEY || "sk-placeholder";
    const outputDir = OUTPUT_DIR;

    isRunning = true;
    eventBuffer = [];
    aborted = false;
    currentResult = null;

    const initialElos = getInitialElos(config.models);
    currentRunner = new TournamentRunner({
      models: config.models,
      bestOf: config.bestOf,
      baseURL,
      apiKey,
      turnDelayMs: 0,
      maxTurns: config.maxTurns,
      kFactor: config.kFactor,
      outputDir,
      initialElos,
    });

    currentRunner.onEvent(broadcast);

    await db.updateTournament(tournamentId, { status: "running", started_at: new Date() });

    res.json({ status: "started", tournamentId });

    // Run tournament asynchronously
    try {
      currentResult = await currentRunner.run();
      if (!aborted) {
        const { runDir, paths } = saveTournamentReport(currentResult, outputDir);
        broadcast({ type: "reports_saved", paths });

        const sorted = [...currentResult.stats].sort((a, b) => b.elo - a.elo);
        saveHistoryEntry({
          id: currentResult.startTime.replace(/[:.]/g, "-"),
          date: currentResult.startTime,
          models: currentResult.stats.map(s => s.model),
          winner: sorted[0]?.model ?? "—",
          stats: sorted.map(s => ({ model: s.model, elo: s.elo, wins: s.wins, losses: s.losses, draws: s.draws })),
          runDir,
          reportFiles: paths.map(p => path.relative(outputDir, p).replace(/\\/g, "/")),
          result: currentResult,
        });
        updateSavedRatings(currentResult.stats);

        // Save games from tournament to DB
        let gameIndex = 0;
        for (const matchup of currentResult.matchups) {
          for (const game of matchup.games) {
            const winner = game.winner === "A" ? matchup.modelA : game.winner === "B" ? matchup.modelB : "draw";
            const gameId = await db.saveGame({
              tournamentId,
              gameIndex,
              participantA: matchup.modelA,
              participantB: matchup.modelB,
              classA: game.classA,
              classB: game.classB,
              winner,
              winnerTeam: null,
              totalTurns: game.turns,
              durationMs: game.durationMs,
              battleLog: game,
            });

            // Collect training data for each game
            if (game.turnLog && game.turnLog.length > 0) {
              const actorTypes: Record<string, string> = {
                unit1: game.modelA === HEURISTIC_BASELINE ? "heuristic" : "llm",
                unit2: game.modelB === HEURISTIC_BASELINE ? "heuristic" : "llm",
              };
              // Convert turn log to BattleLog format for collector
              const trainingLog: BattleLog = {
                turns: (game.turnLog as any[]).map(t => ({
                  actorId: t.actorId,
                  turnNumber: t.turnNumber,
                  stateSnapshot: { characters: [] },
                  results: [{
                    action: { type: "unknown" },
                    narrative: t.narrative,
                    badAction: t.badAction,
                  }],
                  thinkingSteps: [],
                })),
                winner,
                totalTurns: game.turns,
                startTime: currentResult.startTime,
                endTime: currentResult.endTime,
                arena: { width: 600, height: 400, obstacles: [], preset: "plains" },
              };
              await collectTrainingData(gameId, trainingLog, actorTypes);
            }

            gameIndex++;
          }
        }

        await db.updateTournament(tournamentId, {
          status: "completed",
          result: currentResult,
          completed_at: new Date(),
        });
      }
    } catch (err: any) {
      broadcast({ type: "tournament_error", error: err.message });
      await db.updateTournament(tournamentId, { status: "aborted" });
    } finally {
      isRunning = false;
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tournaments/:id/abort", async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.id);
    if (!isRunning) {
      res.status(400).json({ error: "No tournament running" });
      return;
    }
    aborted = true;
    if (currentRunner) currentRunner.abort();
    broadcast({ type: "tournament_aborted" });
    await db.updateTournament(tournamentId, { status: "aborted", completed_at: new Date() });
    res.json({ status: "aborted" });
    isRunning = false;
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tournaments/:id/status", async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.id);
    const tournament = await db.getTournament(tournamentId);
    if (!tournament) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      id: tournament.id,
      status: tournament.status,
      isRunning,
      config: tournament.config,
      result: tournament.result,
      createdAt: tournament.createdAt,
      startedAt: tournament.startedAt,
      completedAt: tournament.completedAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tournaments/:id/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Replay buffered events for reconnect
  for (const data of eventBuffer) {
    res.write(data);
  }

  sseClients.push(res);
  req.on("close", () => removeSseClient(res));
});

app.get("/api/tournaments/:id/games", async (req, res) => {
  try {
    const tournamentId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit as string) || 100;
    const games = await db.listGames(tournamentId, limit);
    res.json(games);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
//  REST API: Games
// ════════════════════════════════════════════════════════

app.get("/api/games/:id", async (req, res) => {
  try {
    const game = await db.getGame(parseInt(req.params.id));
    if (!game) { res.status(404).json({ error: "Not found" }); return; }
    res.json(game);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/games/:id/training", async (req, res) => {
  try {
    const gameId = parseInt(req.params.id);
    const { records, total } = await db.listTrainingRecords({ gameId });
    res.json({ records, total });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
//  REST API: Training Data
// ════════════════════════════════════════════════════════

app.get("/api/training", async (req, res) => {
  try {
    const filters: Parameters<typeof db.listTrainingRecords>[0] = {};
    if (req.query.gameId) filters.gameId = parseInt(req.query.gameId as string);
    if (req.query.actorType) filters.actorType = req.query.actorType as string;
    if (req.query.actorName) filters.actorName = req.query.actorName as string;
    if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
    if (req.query.offset) filters.offset = parseInt(req.query.offset as string);
    const result = await db.listTrainingRecords(filters);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/training/export", async (req, res) => {
  try {
    const format = (req.query.format as string) === "csv" ? "csv" as const : "jsonl" as const;
    const filters: Parameters<typeof db.listTrainingRecords>[0] = {};
    if (req.query.gameId) filters.gameId = parseInt(req.query.gameId as string);
    if (req.query.actorType) filters.actorType = req.query.actorType as string;
    if (req.query.actorName) filters.actorName = req.query.actorName as string;
    const content = await db.exportTrainingRecords(format, filters);
    if (format === "jsonl") {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Content-Disposition", `attachment; filename="training_export.jsonl"`);
    } else {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="training_export.csv"`);
    }
    res.send(content);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/training/stats", async (_req, res) => {
  try {
    const { records, total } = await db.listTrainingRecords({ limit: 1 });
    // Get aggregate stats
    const allRecords = await db.listTrainingRecords({ limit: 100000 });
    const recordsList = allRecords.records;

    const byActorType: Record<string, number> = {};
    const byActorClass: Record<string, number> = {};
    const byActorName: Record<string, number> = {};
    let totalBadActions = 0;
    let totalTimedOut = 0;
    const gamesSet = new Set<number>();

    for (const r of recordsList) {
      byActorType[r.actorType] = (byActorType[r.actorType] || 0) + 1;
      byActorClass[r.actorClass] = (byActorClass[r.actorClass] || 0) + 1;
      byActorName[r.actorName] = (byActorName[r.actorName] || 0) + 1;
      if (r.actionWasBad) totalBadActions++;
      if (r.actionTimedOut) totalTimedOut++;
      gamesSet.add(r.gameId);
    }

    res.json({
      totalRecords: allRecords.total,
      totalGames: gamesSet.size,
      badActions: totalBadActions,
      timedOut: totalTimedOut,
      badActionRate: allRecords.total > 0 ? totalBadActions / allRecords.total : 0,
      byActorType,
      byActorClass,
      byActorName,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
//  REST API: Bosses & Battle Logs
// ════════════════════════════════════════════════════════

app.get("/api/bosses", (_req, res) => {
  const profiles = getAllBosses();
  res.json(profiles.map(p => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    title: p.title,
    tier: p.tier,
    description: p.description,
    stats: {
      hp: p.hp,
      ac: p.ac,
      str: p.abilities.str,
      dex: p.abilities.dex,
      spd: p.speed,
    },
  })));
});

app.get("/api/battle-logs", async (_req, res) => {
  try {
    const logs = await db.listBattleLogs();
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
//  REST API: Model Discovery & Health
// ════════════════════════════════════════════════════════

app.get("/api/models", async (_req, res) => {
  try {
    const baseURL = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    const resp = await fetch(`${baseURL}/models`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as any;
    const models: string[] = (data.data ?? data.models ?? [])
      .map((m: any) => m.id)
      .filter((id: string) => typeof id === "string" && id !== "default");
    if (!models.includes(HEURISTIC_BASELINE)) models.push(HEURISTIC_BASELINE);
    res.json({ models });
  } catch (err: any) {
    res.json({ models: [], error: err.message });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    const baseURL = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    const start = Date.now();
    const resp = await fetch(`${baseURL}/models`, { signal: AbortSignal.timeout(5000) });
    const latency = Date.now() - start;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as any;
    const modelCount = (data.data ?? data.models ?? []).length;
    res.json({ status: "ok", latency: `${latency}ms`, models: modelCount, url: baseURL });
  } catch (err: any) {
    res.status(503).json({ status: "error", error: err.message, url: process.env.LLM_BASE_URL || "https://api.openai.com/v1" });
  }
});

// ════════════════════════════════════════════════════════
//  REST API: ELO Ratings
// ════════════════════════════════════════════════════════

app.get("/api/ratings", (_req, res) => {
  const ratings = loadRatings();
  res.json({ ratings });
});

// ════════════════════════════════════════════════════════
//  REST API: History (from tournament-server)
// ════════════════════════════════════════════════════════

app.get("/api/history", (_req, res) => {
  const hist = loadHistory();
  res.json({ history: hist });
});

app.get("/api/history/:id", (req, res) => {
  const hist = loadHistory();
  const entry = hist.find(h => h.id === req.params.id);
  if (!entry) {
    res.status(404).json({ error: "History entry not found" });
    return;
  }
  res.json(entry);
});

// ════════════════════════════════════════════════════════
//  REST API: Reports & Exports (from tournament-server)
// ════════════════════════════════════════════════════════

app.get("/api/reports", (_req, res) => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    res.json({ reports: [] });
    return;
  }
  try {
    const reports: { name: string; path: string; size: number; modified: string }[] = [];
    const entries = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const stat = fs.statSync(path.join(OUTPUT_DIR, entry.name));
        reports.push({ name: entry.name, path: entry.name, size: stat.size, modified: stat.mtime.toISOString() });
      } else if (entry.isDirectory() && entry.name.startsWith("run-")) {
        const subDir = path.join(OUTPUT_DIR, entry.name);
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

app.get("/api/export/json", (_req, res) => {
  let result = currentResult;
  let startTime = result?.startTime;
  if (!result) {
    const history = loadHistory();
    if (history.length > 0) {
      const latest = history[history.length - 1];
      result = loadResultFromDisk(latest.id);
      startTime = latest.date;
    }
  }
  if (!result) {
    res.status(404).json({ error: "No tournament result available" });
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="tournament_${(startTime ?? "unknown").replace(/[:.]/g, "-")}.json"`);
  res.json(result);
});

app.get("/api/export/csv", (_req, res) => {
  let result = currentResult;
  let startTime = result?.startTime;
  if (!result) {
    const history = loadHistory();
    if (history.length > 0) {
      const latest = history[history.length - 1];
      result = loadResultFromDisk(latest.id);
      startTime = latest.date;
    }
  }
  if (!result) {
    res.status(404).json({ error: "No tournament result available" });
    return;
  }
  const lines: string[] = [];
  lines.push("Rank,Model,ELO,Wins,Losses,Draws,Matches,Win%,BadActions");
  const sorted = [...result.stats].sort((a, b) => b.elo - a.elo);
  sorted.forEach((s, i) => {
    const winPct = s.matchesPlayed > 0 ? ((s.wins / s.matchesPlayed) * 100).toFixed(1) : "0";
    lines.push(`${i + 1},"${s.model}",${s.elo},${s.wins},${s.losses},${s.draws},${s.matchesPlayed},${winPct},${s.totalBadActions}`);
  });
  lines.push("");
  lines.push("ModelA,ModelB,WinsA,WinsB,Draws");
  result.matchups.forEach(m => {
    lines.push(`"${m.modelA}","${m.modelB}",${m.winsA},${m.winsB},${m.draws}`);
  });
  lines.push("");
  lines.push("Matchup,Game,ClassA,ClassB,Winner,Turns,BadA,BadB");
  result.matchups.forEach(m => {
    m.games.forEach(g => {
      const winner = g.winner === "A" ? m.modelA : g.winner === "B" ? m.modelB : "draw";
      lines.push(`"${m.modelA} vs ${m.modelB}",${g.gameNumber},${g.classA},${g.classB},"${winner}",${g.turns},${g.statsA.badActions},${g.statsB.badActions}`);
    });
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="tournament_${(startTime ?? "unknown").replace(/[:.]/g, "-")}.csv"`);
  res.send(lines.join("\n"));
});

app.get("/report/{*path}", (req, res) => {
  const rawPath = req.params.path;
  const relPath = Array.isArray(rawPath) ? rawPath.join("/") : (rawPath ?? "");
  const fullPath = path.join(OUTPUT_DIR, relPath);
  if (!fullPath.startsWith(OUTPUT_DIR)) { res.status(403).send("Forbidden"); return; }
  if (!fs.existsSync(fullPath)) { res.status(404).send("Not found"); return; }
  const md = fs.readFileSync(fullPath, "utf-8");
  res.setHeader("Content-Type", "text/html").send(markdownToHtml(md));
});

// ── Static Files (production) ───────────────────────────

const staticPath = path.join(__dirname, "../web/dist");
if (fs.existsSync(staticPath)) {
  app.use(express.static(staticPath));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });
}

// ════════════════════════════════════════════════════════
//  WebSocket Game Server
// ════════════════════════════════════════════════════════

const wss = new WebSocketServer({ server, path: "/ws" });

interface ClientMessage {
  type: "start_battle" | "start_boss_exam" | "start_scenario" | "action";
  name?: string;
  class?: string;
  enemyMode?: string;
  llmConfigId?: number;
  bossId?: string;
  action?: {
    type: string;
    spellId?: string;
    itemId?: string;
    target?: string;
  };
  participants?: Array<{
    name: string;
    role: string;
    team: string;
    agent: string;
    model?: string;
  }>;
  arena?: string;
  winCondition?: string;
}

/**
 * A single WebSocket connection = a game session.
 *
 * Modes:
 *  - "1v1":       One battle, player (human) vs AI
 *  - "boss_exam": Agent fights each of 5 bosses as separate tests
 */
class GameSession {
  private ws: WebSocket;
  /** All human agents, keyed by character ID */
  private humanAgents = new Map<string, HumanAgent>();
  private enemyAgent?: IAgent;
  private runner?: BattleRunner;
  private playerChar?: Character;
  private enemyChar?: Character;
  private startTime = 0;

  // Scenario mode state
  private scenarioCharacters?: Character[];
  private scenarioAgents?: IAgent[];

  // Boss exam state
  private bossExamActive = false;
  private bossExamConfig?: {
    name: string;
    charClass: CharacterClass;
    mode: "llm" | "mock";
    llmConfigId?: number;
  };
  private bossExamResults: { bossId: BossId; bossName: string; won: boolean; turns: number }[] = [];
  private bossExamIndex = 0;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  handleMessage(raw: string) {
    try {
      const msg: ClientMessage = JSON.parse(raw);
      switch (msg.type) {
        case "start_battle":
          this.startBattle(msg);
          break;
        case "start_boss_exam":
          this.startBossExam(msg);
          break;
        case "start_scenario":
          this.startScenario(msg);
          break;
        case "action":
          this.handleHumanAction(msg);
          break;
      }
    } catch (err: any) {
      this.send("error", { message: err.message || "Invalid message" });
    }
  }

  // ── 1v1 Battle ─────────────────────────────────────

  private async startBattle(msg: ClientMessage) {
    const playerClass = (msg.class || "warrior") as CharacterClass;
    const validClasses: CharacterClass[] = ["warrior", "mage", "rogue", "paladin"];
    if (!validClasses.includes(playerClass)) {
      this.send("error", { message: "Invalid class" });
      return;
    }

    const otherClasses = validClasses.filter((c) => c !== playerClass);
    const enemyClass = otherClasses[Math.floor(Math.random() * otherClasses.length)];
    const playerName = msg.name?.trim() || "Hero";

    this.playerChar = createCharacter("player", playerName, playerClass);
    this.enemyChar = createCharacter("enemy", "AI Opponent", enemyClass);

    this.humanAgents.clear();
    this.humanAgents.set("player", new HumanAgent("player", playerName));
    this.enemyAgent = await this.createEnemyAgent(
      msg.enemyMode || "mock",
      enemyClass,
      msg.llmConfigId
    );

    const humanAgent1v1 = this.humanAgents.get("player")!;
    this.startTime = Date.now();

    const wsRenderer = createWsRenderer(this.ws, "player");

    this.runner = new BattleRunner(
      [this.playerChar, this.enemyChar],
      [humanAgent1v1, this.enemyAgent],
      {
        maxTurns: 50,
        turnDelayMs: 0,
        eventHandler: wsRenderer,
      }
    );

    this.runBattle("player", "enemy", playerClass, this.playerChar!.name, this.enemyChar!.name);
  }

  // ── Boss Exam ──────────────────────────────────────

  private async startBossExam(msg: ClientMessage) {
    const playerClass = (msg.class || "warrior") as CharacterClass;
    const validClasses: CharacterClass[] = ["warrior", "mage", "rogue", "paladin"];
    if (!validClasses.includes(playerClass)) {
      this.send("error", { message: "Invalid class" });
      return;
    }

    const playerName = msg.name?.trim() || "Hero";

    this.bossExamActive = true;
    this.bossExamConfig = {
      name: playerName,
      charClass: playerClass,
      mode: (msg.enemyMode as "llm" | "mock") || "mock",
      llmConfigId: msg.llmConfigId,
    };
    this.bossExamResults = [];
    this.bossExamIndex = 0;

    this.send("boss_exam_start", {
      bosses: BOSS_ORDER.map((id) => {
        const p = getBossProfile(id)!;
        return { id: p.id, name: p.name, emoji: p.emoji, title: p.title };
      }),
    });

    await this.runNextBossExam();
  }

  private async runNextBossExam() {
    if (this.bossExamIndex >= BOSS_ORDER.length) {
      this.sendBossExamResults();
      return;
    }

    const bossId = BOSS_ORDER[this.bossExamIndex];
    const bossProfile = getBossProfile(bossId)!;
    const config = this.bossExamConfig!;

    this.playerChar = createCharacter("player", config.name, config.charClass);
    this.enemyChar = createBoss(bossId);

    this.send("boss_exam_fight_start", {
      bossIndex: this.bossExamIndex,
      bossId: bossProfile.id,
      bossName: bossProfile.name,
      bossEmoji: bossProfile.emoji,
      bossTitle: bossProfile.title,
      totalBosses: BOSS_ORDER.length,
    });

    this.humanAgents.clear();
    this.humanAgents.set("player", new HumanAgent("player", config.name));
    this.enemyAgent = new BossAgent("boss", bossProfile.name, bossId);

    const humanAgentBoss = this.humanAgents.get("player")!;
    this.startTime = Date.now();

    const wsRenderer = createWsRenderer(this.ws, "player");

    this.runner = new BattleRunner(
      [this.playerChar, this.enemyChar],
      [humanAgentBoss, this.enemyAgent],
      {
        maxTurns: 50,
        turnDelayMs: 0,
        eventHandler: wsRenderer,
      }
    );

    const log = await this.runner.run();

    const won = log.winner === "player";
    this.bossExamResults.push({
      bossId,
      bossName: bossProfile.name,
      won,
      turns: log.totalTurns,
    });

    this.send("boss_exam_fight_end", {
      bossIndex: this.bossExamIndex,
      bossId,
      bossName: bossProfile.name,
      won,
      turns: log.totalTurns,
      totalBosses: BOSS_ORDER.length,
    });

    const replayPath = saveReplay(log, this.runner.getCharacters(), this.runner.getAgents());
    console.error(`Boss exam replay: ${replayPath}`);

    // Save boss exam game to DB + collect training data
    const agents = this.runner.getAgents();
    const actorTypes: Record<string, string> = {};
    for (const agent of agents) {
      const name = agent.constructor.name;
      let type = 'heuristic';
      if (name.includes('LLM')) type = 'llm';
      else if (name.includes('Human')) type = 'human';
      else if (name.includes('Boss')) type = 'boss';
      actorTypes[agent.id] = type;
    }
    const winner = won ? config.name : bossProfile.name;
    const gameId = await db.saveGame({
      tournamentId: null,
      gameIndex: this.bossExamIndex,
      participantA: config.name,
      participantB: bossProfile.name,
      classA: config.charClass,
      classB: "boss",
      winner,
      winnerTeam: null,
      totalTurns: log.totalTurns,
      durationMs: Date.now() - this.startTime,
      battleLog: log,
    });
    const recordCount = await collectTrainingData(gameId, log, actorTypes);
    this.send("training_saved", { gameId, recordCount });

    this.bossExamIndex++;

    this.sendBossExamResults();

    if (this.bossExamIndex < BOSS_ORDER.length) {
      setTimeout(() => this.runNextBossExam(), 2000);
    }
  }

  private sendBossExamResults() {
    const total = BOSS_ORDER.length;
    const completed = this.bossExamResults.length;
    const wins = this.bossExamResults.filter((r) => r.won).length;
    const allDone = completed >= total;

    this.send("boss_exam_scorecard", {
      results: this.bossExamResults,
      completed,
      total,
      wins,
      allDone,
      grade: this.gradeBossExam(wins, total),
    });

    if (allDone) {
      db.saveBattleLog({
        playerName: this.bossExamConfig?.name,
        playerClass: this.bossExamConfig?.charClass,
        enemyClass: "boss_exam",
        enemyMode: "boss_exam",
        winner: wins >= 3 ? "player" : "boss",
        turns: this.bossExamResults.reduce((s, r) => s + r.turns, 0),
        durationMs: Date.now() - this.startTime,
      }).catch(() => {});
    }
  }

  private gradeBossExam(wins: number, total: number): string {
    const pct = wins / total;
    if (pct >= 1.0) return "S";
    if (pct >= 0.8) return "A";
    if (pct >= 0.6) return "B";
    if (pct >= 0.4) return "C";
    if (pct >= 0.2) return "D";
    return "F";
  }

  // ── Scenario Mode (N-unit battle) ──────────────────

  private async startScenario(msg: ClientMessage) {
    const participantConfigs = msg.participants;
    if (!participantConfigs || participantConfigs.length < 2) {
      this.send("error", { message: "Need at least 2 participants" });
      return;
    }

    const BOSS_IDS = new Set(["goblin_king", "dark_wizard", "ancient_dragon", "lich_lord", "demon_lord"]);
    const CLASS_IDS = new Set(["warrior", "mage", "rogue", "paladin"]);

    const characters: Character[] = [];
    const agents: IAgent[] = [];
    const humanIds: string[] = [];

    for (let i = 0; i < participantConfigs.length; i++) {
      const cfg = participantConfigs[i];
      const id = `unit${i + 1}`;

      if (!CLASS_IDS.has(cfg.role) && !BOSS_IDS.has(cfg.role)) {
        this.send("error", { message: `Invalid role: ${cfg.role}` });
        return;
      }

      let char: Character;
      if (BOSS_IDS.has(cfg.role)) {
        char = createBoss(cfg.role as any);
        char.name = cfg.name;
        char.team = cfg.team;
      } else {
        char = createCharacter(id, cfg.name, cfg.role as any, { x: 0, y: 0 }, cfg.team);
      }
      characters.push(char);

      let agent: IAgent;
      switch (cfg.agent) {
        case "human": {
          const human = new HumanAgent(id, cfg.name);
          humanIds.push(id);
          agent = human;
          this.humanAgents.set(id, human);
          break;
        }
        case "llm": {
          agent = await this.createLLMAgent(id, cfg.name, cfg.role, cfg.model, msg.llmConfigId);
          break;
        }
        case "boss": {
          agent = new BossAgent(id, cfg.name, cfg.role as any);
          break;
        }
        default: {
          agent = new HeuristicAgent(id, cfg.name);
          break;
        }
      }
      agents.push(agent);
    }

    const { ARENA_PRESETS, autoArenaPreset } = await import("./engine/types.js");
    const arena = msg.arena && ARENA_PRESETS[msg.arena as keyof typeof ARENA_PRESETS]
      ? ARENA_PRESETS[msg.arena as keyof typeof ARENA_PRESETS]
      : autoArenaPreset(participantConfigs.length);

    this.startTime = Date.now();

    const wsRenderer = createWsRenderer(this.ws, humanIds.length > 0 ? humanIds : "player");

    this.runner = new BattleRunner(characters, agents, {
      maxTurns: 50,
      turnDelayMs: 0,
      eventHandler: wsRenderer,
      arena,
      winCondition: msg.winCondition as any,
    });

    this.playerChar = characters[0];
    this.enemyChar = characters[characters.length > 1 ? 1 : 0];
    this.scenarioCharacters = characters;
    this.scenarioAgents = agents;

    this.runBattle("scenario", "scenario", characters[0].class, characters[0].name, characters.length > 1 ? characters[1].name : "");
  }

  // ── Shared Battle Runner ───────────────────────────

  private async runBattle(humanId: string, enemyId: string, humanClass: CharacterClass, humanName: string, enemyName: string) {
    try {
      const log = await this.runner!.run();

      const replayPath = saveReplay(log, this.runner!.getCharacters(), this.runner!.getAgents());
      console.error(`Replay saved to ${replayPath}`);

      const durationMs = Date.now() - this.startTime;
      db.saveBattleLog({
        playerName: this.playerChar?.name,
        playerClass: this.playerChar?.class,
        enemyClass: this.enemyChar?.class,
        enemyMode: this.enemyAgent?.type === "llm" ? "llm" : "mock",
        winner: log.winner || undefined,
        turns: log.totalTurns,
        durationMs,
      }).catch((err) => console.error("Failed to save battle log:", err.message));

      // Save game to DB and collect training data
      const agents = this.runner!.getAgents();
      const actorTypes: Record<string, string> = {};
      for (const agent of agents) {
        const name = agent.constructor.name;
        let type = 'heuristic';
        if (name.includes('LLM')) type = 'llm';
        else if (name.includes('Human')) type = 'human';
        else if (name.includes('Boss')) type = 'boss';
        actorTypes[agent.id] = type;
      }
      const winner = log.winner || "draw";
      const gameId = await db.saveGame({
        tournamentId: null,
        gameIndex: 0,
        participantA: humanName,
        participantB: enemyName,
        classA: humanClass,
        classB: this.enemyChar?.class || "unknown",
        winner,
        winnerTeam: null,
        totalTurns: log.totalTurns,
        durationMs: Date.now() - this.startTime,
        battleLog: log,
      });
      const recordCount = await collectTrainingData(gameId, log, actorTypes);
      this.send("training_saved", { gameId, recordCount });

    } catch (err: any) {
      console.error("Battle loop error:", err);
      this.send("error", { message: `Battle error: ${err.message}` });
    }
  }

  // ── Human Input ─────────────────────────────────────

  private handleHumanAction(msg: ClientMessage) {
    if (!msg.action) return;

    const raw = msg.action;

    let waitingAgent: HumanAgent | undefined;
    let actorId: string = "";

    if (this.humanAgents.size === 0) return;

    if (this.humanAgents.size === 1) {
      waitingAgent = this.humanAgents.values().next().value;
      actorId = waitingAgent!.id;
    } else {
      for (const [id, agent] of this.humanAgents) {
        if (agent.isWaiting) {
          waitingAgent = agent;
          actorId = id;
          break;
        }
      }
      if (!waitingAgent) {
        waitingAgent = this.humanAgents.values().next().value;
        actorId = waitingAgent!.id;
      }
    }

    let targetId: string | undefined;
    if (raw.target === "self") {
      targetId = actorId;
    } else if (raw.target) {
      const chars = this.scenarioCharacters || (this.playerChar && this.enemyChar ? [this.playerChar, this.enemyChar] : []);
      const found = chars.find((c) => c.name.toLowerCase() === raw.target!.toLowerCase());
      targetId = found?.id ?? raw.target;
    } else {
      targetId = this.bossExamActive ? "boss" : "enemy";
    }

    const action: CombatAction = {
      type: raw.type as CombatAction["type"],
      actorId,
      targetId,
      spellId: raw.spellId,
      itemId: raw.itemId,
      move: (raw as any).move_dx !== undefined || (raw as any).move_dy !== undefined
        ? { dx: (raw as any).move_dx || 0, dy: (raw as any).move_dy || 0 }
        : undefined,
    };

    waitingAgent!.submitAction(action);
  }

  // ── Agent Factory ───────────────────────────────────

  private async createEnemyAgent(
    mode: string,
    charClass: CharacterClass,
    llmConfigId?: number
  ): Promise<IAgent> {
    if (mode === "llm") {
      let config = llmConfigId
        ? await db.getLLMConfig(llmConfigId)
        : await db.getDefaultLLMConfig();

      const model = config?.model || process.env.LLM_MODEL || "gpt-4o-mini";
      const apiKey = config?.apiKey || process.env.LLM_API_KEY || "sk-placeholder";
      const baseUrl = config?.baseUrl || process.env.LLM_BASE_URL || "https://api.openai.com/v1";

      return new LLMAgent({
        id: "enemy",
        name: "AI Opponent",
        characterClass: charClass,
        model,
        apiKey,
        baseURL: baseUrl,
        onThinking: (step) => {
          this.send("enemy_thinking_step", {
            type: step.type,
            text: step.text,
            toolName: step.toolName,
            toolResult: step.toolResult,
          });
        },
      });
    }
    return new HeuristicAgent("enemy", "AI Opponent");
  }

  private async createLLMAgent(
    id: string,
    name: string,
    charClass: string,
    model?: string,
    llmConfigId?: number,
  ): Promise<IAgent> {
    let config = llmConfigId
      ? await db.getLLMConfig(llmConfigId)
      : await db.getDefaultLLMConfig();

    const finalModel = model || config?.model || process.env.LLM_MODEL || "gpt-4o-mini";
    const apiKey = config?.apiKey || process.env.LLM_API_KEY || "sk-placeholder";
    const baseUrl = config?.baseUrl || process.env.LLM_BASE_URL || "https://api.openai.com/v1";

    return new LLMAgent({
      id,
      name,
      characterClass: charClass,
      model: finalModel,
      apiKey,
      baseURL: baseUrl,
      onThinking: (step) => {
        this.send("enemy_thinking_step", {
          type: step.type,
          text: step.text,
          toolName: step.toolName,
          toolResult: step.toolResult,
        });
      },
    });
  }

  // ── Helpers ─────────────────────────────────────────

  private send(type: string, data: Record<string, unknown> = {}) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  destroy() {
    for (const agent of this.humanAgents.values()) {
      agent.destroy();
    }
    this.humanAgents.clear();
    this.enemyAgent?.destroy?.();
    if (this.scenarioAgents) {
      for (const agent of this.scenarioAgents) {
        if (!this.humanAgents.has(agent.id) && agent !== this.enemyAgent) {
          agent.destroy?.();
        }
      }
    }
  }
}

// ── Connection Handling ─────────────────────────────────

const sessions = new Map<WebSocket, GameSession>();

wss.on("connection", (ws) => {
  const session = new GameSession(ws);
  sessions.set(ws, session);

  ws.on("message", (data) => session.handleMessage(data.toString()));

  ws.on("close", () => {
    session.destroy();
    sessions.delete(ws);
  });

  ws.send(JSON.stringify({ type: "connected", message: "Connected to RPG Arena!" }));
});

// ── Start ───────────────────────────────────────────────

async function main() {
  console.log("Connecting to database...");
  await db.migrate();

  server.listen(PORT, () => {
    console.log(
      `\n⚔️  RPG Arena Server running on http://localhost:${PORT}` +
        (isDev ? `\n   (Frontend dev server should be on http://localhost:3000)` : "") +
        `\n`
    );
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
