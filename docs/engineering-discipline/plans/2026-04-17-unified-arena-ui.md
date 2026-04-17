# Unified Arena UI — Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Replace all 3 UI surfaces (Vue SPA, Tournament Dashboard, CLI) with a single unified Vue 3 web app that provides tournament management, human-vs-agent play, and comprehensive training data collection/export.

**Architecture:** A single Express server serves both the REST/SSE/WebSocket API and the new Vue 3 SPA. The SPA uses Vue Router for navigation, Pinia for state management, and a shared API client. Training data is collected automatically from every battle (tournament or human play) and stored in PostgreSQL (with in-memory fallback). The CLI becomes a thin wrapper that calls the same engine functions the web server uses — no private CLI-only implementations.

**Tech Stack:**
- **Frontend:** Vue 3 (Composition API, `<script setup>`), Vue Router 4, Pinia, Vite
- **Backend:** Express 5, WebSocket (ws), SSE, PostgreSQL 16 (in-memory fallback)
- **Existing (unchanged):** Battle engine, agent system, dice, characters, bosses, combat resolver, ELO, replay
- **Build:** Vite for frontend, tsx for backend dev, Docker for production

**Work Scope:**
- **In scope:** Unified Vue 3 SPA (Dashboard, Tournaments, Play, Data, Settings views), consolidated backend server, training data DB schema + API, training data viewer/exporter, CLI refactor to thin wrapper
- **Out of scope:** Game engine changes (combat, agents, dice — all existing), new game modes, mobile native app, user authentication (future), fine-tuning pipeline (future — this plan only collects/exportes the data)

---

## File Structure Mapping

### New files to create

| File | Responsibility |
|------|---------------|
| `src/server.ts` | **Rewrite** — consolidated server (Express + WebSocket + SSE + SPA serving) |
| `src/db/index.ts` | **Modify** — add training data tables to migrate() + new query functions |
| `src/index.ts` | **Modify** — CLI refactored to thin wrapper calling shared engine |
| `web/src/main.ts` | **Rewrite** — Pinia + Router initialization |
| `web/src/App.vue` | **Rewrite** — layout shell with router-view, sidebar nav |
| `web/src/router/index.ts` | Vue Router config (5 routes) |
| `web/src/stores/tournament.ts` | Pinia store — tournament state, SSE connection |
| `web/src/stores/game.ts` | Pinia store — live battle state, WebSocket connection |
| `web/src/stores/settings.ts` | Pinia store — LLM configs, preferences |
| `web/src/stores/data.ts` | Pinia store — training data queries, filters |
| `web/src/api/client.ts` | Fetch wrapper with error handling, base URL |
| `web/src/api/tournaments.ts` | Tournament API calls |
| `web/src/api/games.ts` | Game/replay API calls |
| `web/src/api/training.ts` | Training data API calls |
| `web/src/api/llm-configs.ts` | LLM config CRUD API calls |
| `web/src/composables/useWebSocket.ts` | WebSocket connection with reconnect + heartbeat |
| `web/src/composables/useSSE.ts` | SSE connection with reconnect + buffer replay |
| `web/src/types/index.ts` | Shared TypeScript interfaces (API responses, battle state, training records) |
| `web/src/views/DashboardView.vue` | Overview: recent tournaments, ELO leaderboard, quick actions |
| `web/src/views/TournamentsView.vue` | Tournament list + create form |
| `web/src/views/TournamentLiveView.vue` | Live tournament view (SSE) |
| `web/src/views/PlayView.vue` | Play arena: setup + live battle (WebSocket) |
| `web/src/views/DataView.vue` | Training data browser + exporter |
| `web/src/views/SettingsView.vue` | LLM config CRUD, preferences |
| `web/src/components/layout/AppSidebar.vue` | Navigation sidebar |
| `web/src/components/layout/AppHeader.vue` | Top bar with connection status |
| `web/src/components/tournament/TournamentCard.vue` | Tournament list item |
| `web/src/components/tournament/TournamentCreateForm.vue` | Create tournament form |
| `web/src/components/tournament/EloTable.vue` | ELO rankings table |
| `web/src/components/tournament/MatchupMatrix.vue` | Head-to-head matrix |
| `web/src/components/play/PlaySetup.vue` | Battle setup (class, enemy, mode) |
| `web/src/components/play/BattleView.vue` | Live battle UI (replaces old BattleView.vue) |
| `web/src/components/play/ActionPanel.vue` | Action buttons + spell/item picker + target selector |
| `web/src/components/play/BattleLog.vue` | Chat-style narrative log |
| `web/src/components/play/StatusPanel.vue` | Character cards with HP, status effects, spell slots |
| `web/src/components/play/BattlefieldCanvas.vue` | Canvas battlefield renderer |
| `web/src/components/data/TrainingTable.vue` | Training records data table with filters |
| `web/src/components/data/DatasetExporter.vue` | Export UI (JSONL, CSV, fine-tuning formats) |
| `web/src/components/common/HealthBar.vue` | Reusable HP bar component |
| `web/src/components/common/LoadingSpinner.vue` | Loading state component |
| `web/src/components/common/ErrorBanner.vue` | Error display component |
| `web/src/components/common/EmptyState.vue` | Empty state placeholder |
| `web/src/style.css` | **Rewrite** — unified design system (single palette, accessibility-first) |

### Files to delete (after migration)

| File | Reason |
|------|--------|
| `web/src/components/SetupScreen.vue` | Replaced by PlaySetup.vue |
| `web/src/components/BattleView.vue` | Replaced by play/BattleView.vue |
| `src/arena/tournament-server.ts` | Merged into src/server.ts |
| `src/arena/dashboard.html` | Replaced by Vue SPA |

### Files unchanged

| File | Reason |
|------|--------|
| `src/engine/*` | Game engine — no changes needed |
| `src/agent/*` | Agent system — no changes needed |
| `src/arena/battle-runner.ts` | Battle orchestration — no changes needed |
| `src/arena/elo.ts` | ELO system — no changes needed |
| `src/arena/replay.ts` | Replay generation — no changes needed |
| `src/arena/tournament.ts` | Tournament runner — no changes needed |
| `src/arena/cli-renderer.ts` | CLI renderer — kept for CLI use |
| `src/arena/battlefield-renderer.ts` | Canvas renderer — reused in web |
| `src/tools/definitions.ts` | LLM tool definitions — no changes |

---

## Verification Strategy

- **Level:** test-suite
- **Command:** `npx vitest run`
- **What it validates:** All 394+ existing tests still pass after changes. New tests added for training data queries and consolidated API endpoints.

---

## Task 1: Training Data Database Schema

**Dependencies:** None
**Files:**
- Modify: `src/db/index.ts`

- [ ] **Step 1: Add training data tables to migrate()**

In `src/db/index.ts`, inside the `migrate()` function's `pool.query(...)` call, add these tables after the existing `battle_logs` table:

```sql
CREATE TABLE IF NOT EXISTS tournaments (
  id          SERIAL PRIMARY KEY,
  status      TEXT    NOT NULL DEFAULT 'pending',
  config      JSONB   NOT NULL,
  result      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at  TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS games (
  id            SERIAL PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL,
  game_index    INTEGER NOT NULL DEFAULT 0,
  participant_a TEXT    NOT NULL,
  participant_b TEXT    NOT NULL,
  class_a       TEXT    NOT NULL,
  class_b       TEXT    NOT NULL,
  winner        TEXT,
  winner_team   TEXT,
  total_turns   INTEGER,
  duration_ms   INTEGER,
  battle_log    JSONB   NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_records (
  id              SERIAL PRIMARY KEY,
  game_id         INTEGER REFERENCES games(id) ON DELETE CASCADE,
  turn_number     INTEGER NOT NULL,
  actor_id        TEXT    NOT NULL,
  actor_name      TEXT    NOT NULL,
  actor_class     TEXT    NOT NULL,
  actor_team      TEXT,
  actor_type      TEXT    NOT NULL DEFAULT 'heuristic',
  state_snapshot  JSONB   NOT NULL,
  thinking_steps  JSONB,
  action          JSONB   NOT NULL,
  action_result   JSONB   NOT NULL,
  action_timed_out BOOLEAN NOT NULL DEFAULT false,
  action_was_bad  BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_games_tournament ON games(tournament_id);
CREATE INDEX IF NOT EXISTS idx_training_game ON training_records(game_id);
CREATE INDEX IF NOT EXISTS idx_training_actor_type ON training_records(actor_type);
CREATE INDEX IF NOT EXISTS idx_training_created ON training_records(created_at);
```

Also add in-memory fallback arrays (following existing pattern):
```typescript
let memTournaments: any[] = [];
let memGames: any[] = [];
let memTrainingRecords: any[] = [];
let memNextTournamentId = 1;
let memNextGameId = 1;
let memNextTrainingId = 1;
```

- [ ] **Step 2: Add TypeScript interfaces**

After the existing `BattleLogRow` interface, add:

```typescript
export interface TournamentRow {
  id: number;
  status: 'pending' | 'running' | 'completed' | 'aborted';
  config: {
    models: string[];
    bestOf: number;
    maxTurns: number;
    kFactor: number;
  };
  result: any | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface GameRow {
  id: number;
  tournamentId: number | null;
  gameIndex: number;
  participantA: string;
  participantB: string;
  classA: string;
  classB: string;
  winner: string | null;
  winnerTeam: string | null;
  totalTurns: number | null;
  durationMs: number | null;
  battleLog: any;
  createdAt: Date;
}

export interface TrainingRecordRow {
  id: number;
  gameId: number;
  turnNumber: number;
  actorId: string;
  actorName: string;
  actorClass: string;
  actorTeam: string | null;
  actorType: 'llm' | 'heuristic' | 'human' | 'boss';
  stateSnapshot: any;
  thinkingSteps: any | null;
  action: any;
  actionResult: any;
  actionTimedOut: boolean;
  actionWasBad: boolean;
  createdAt: Date;
}
```

- [ ] **Step 3: Add CRUD functions for tournaments**

Add these functions to `src/db/index.ts`:

```typescript
// ── Tournaments ──────────────────────────────────────

export async function createTournament(config: TournamentRow['config']): Promise<number> {
  if (!dbAvailable) {
    const id = memNextTournamentId++;
    memTournaments.push({ id, status: 'pending', config, result: null, createdAt: new Date(), startedAt: null, completedAt: null });
    return id;
  }
  const { rows } = await pool!.query(
    `INSERT INTO tournaments (config) VALUES ($1) RETURNING id`,
    [JSON.stringify(config)]
  );
  return rows[0].id;
}

export async function updateTournament(id: number, updates: { status?: string; result?: any; started_at?: Date; completed_at?: Date }): Promise<boolean> {
  if (!dbAvailable) {
    const t = memTournaments.find(t => t.id === id);
    if (!t) return false;
    if (updates.status) t.status = updates.status;
    if (updates.result !== undefined) t.result = updates.result;
    if (updates.started_at) t.startedAt = updates.started_at;
    if (updates.completed_at) t.completedAt = updates.completed_at;
    return true;
  }
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (updates.status) { sets.push(`status = $${i++}`); vals.push(updates.status); }
  if (updates.result !== undefined) { sets.push(`result = $${i++}`); vals.push(JSON.stringify(updates.result)); }
  if (updates.started_at) { sets.push(`started_at = $${i++}`); vals.push(updates.started_at); }
  if (updates.completed_at) { sets.push(`completed_at = $${i++}`); vals.push(updates.completed_at); }
  if (sets.length === 0) return true;
  vals.push(id);
  const { rowCount } = await pool!.query(`UPDATE tournaments SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  return (rowCount ?? 0) > 0;
}

export async function listTournaments(limit = 50, offset = 0): Promise<TournamentRow[]> {
  if (!dbAvailable) return memTournaments.slice(offset, offset + limit).reverse();
  const { rows } = await pool!.query(
    `SELECT id, status, config, result, created_at, started_at, completed_at FROM tournaments ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map(r => ({
    id: r.id, status: r.status, config: r.config, result: r.result,
    createdAt: r.created_at, startedAt: r.started_at, completedAt: r.completed_at,
  }));
}

export async function getTournament(id: number): Promise<TournamentRow | null> {
  if (!dbAvailable) return memTournaments.find(t => t.id === id) || null;
  const { rows } = await pool!.query(`SELECT * FROM tournaments WHERE id = $1`, [id]);
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, status: r.status, config: r.config, result: r.result, createdAt: r.created_at, startedAt: r.started_at, completedAt: r.completed_at };
}
```

- [ ] **Step 4: Add CRUD functions for games**

```typescript
// ── Games ────────────────────────────────────────────

export async function saveGame(game: Omit<GameRow, 'id' | 'createdAt'>): Promise<number> {
  if (!dbAvailable) {
    const id = memNextGameId++;
    memGames.push({ ...game, id, createdAt: new Date() });
    return id;
  }
  const { rows } = await pool!.query(
    `INSERT INTO games (tournament_id, game_index, participant_a, participant_b, class_a, class_b, winner, winner_team, total_turns, duration_ms, battle_log)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [game.tournamentId, game.gameIndex, game.participantA, game.participantB, game.classA, game.classB,
     game.winner, game.winnerTeam, game.totalTurns, game.durationMs, JSON.stringify(game.battleLog)]
  );
  return rows[0].id;
}

export async function listGames(tournamentId?: number, limit = 100): Promise<GameRow[]> {
  if (!dbAvailable) {
    const games = tournamentId ? memGames.filter(g => g.tournamentId === tournamentId) : memGames;
    return games.slice(-limit).reverse();
  }
  const { rows } = tournamentId
    ? await pool!.query(`SELECT * FROM games WHERE tournament_id = $1 ORDER BY game_index`, [tournamentId])
    : await pool!.query(`SELECT * FROM games ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map(r => ({
    id: r.id, tournamentId: r.tournament_id, gameIndex: r.game_index,
    participantA: r.participant_a, participantB: r.participant_b,
    classA: r.class_a, classB: r.class_b,
    winner: r.winner, winnerTeam: r.winner_team,
    totalTurns: r.total_turns, durationMs: r.duration_ms,
    battleLog: r.battle_log, createdAt: r.created_at,
  }));
}

export async function getGame(id: number): Promise<GameRow | null> {
  if (!dbAvailable) return memGames.find(g => g.id === id) || null;
  const { rows } = await pool!.query(`SELECT * FROM games WHERE id = $1`, [id]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, tournamentId: r.tournament_id, gameIndex: r.game_index,
    participantA: r.participant_a, participantB: r.participant_b,
    classA: r.class_a, classB: r.class_b,
    winner: r.winner, winnerTeam: r.winner_team,
    totalTurns: r.total_turns, durationMs: r.duration_ms,
    battleLog: r.battle_log, createdAt: r.created_at,
  };
}
```

- [ ] **Step 5: Add CRUD functions for training records**

```typescript
// ── Training Records ─────────────────────────────────

export async function saveTrainingRecords(records: Omit<TrainingRecordRow, 'id' | 'createdAt'>[]): Promise<number> {
  if (!dbAvailable) {
    for (const r of records) {
      memTrainingRecords.push({ ...r, id: memNextTrainingId++, createdAt: new Date() });
    }
    return records.length;
  }
  const client = await pool!.connect();
  try {
    await client.query('BEGIN');
    let count = 0;
    for (const r of records) {
      await client.query(
        `INSERT INTO training_records (game_id, turn_number, actor_id, actor_name, actor_class, actor_team, actor_type, state_snapshot, thinking_steps, action, action_result, action_timed_out, action_was_bad)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [r.gameId, r.turnNumber, r.actorId, r.actorName, r.actorClass, r.actorTeam, r.actorType,
         JSON.stringify(r.stateSnapshot), r.thinkingSteps ? JSON.stringify(r.thinkingSteps) : null,
         JSON.stringify(r.action), JSON.stringify(r.actionResult), r.actionTimedOut, r.actionWasBad]
      );
      count++;
    }
    await client.query('COMMIT');
    return count;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function listTrainingRecords(filters: {
  gameId?: number;
  actorType?: string;
  actorName?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ records: TrainingRecordRow[]; total: number }> {
  const { gameId, actorType, actorName, limit = 100, offset = 0 } = filters;
  if (!dbAvailable) {
    let records = memTrainingRecords;
    if (gameId) records = records.filter(r => r.gameId === gameId);
    if (actorType) records = records.filter(r => r.actorType === actorType);
    if (actorName) records = records.filter(r => r.actorName === actorName);
    return { records: records.slice(offset, offset + limit), total: records.length };
  }
  const conditions: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (gameId) { conditions.push(`game_id = $${i++}`); vals.push(gameId); }
  if (actorType) { conditions.push(`actor_type = $${i++}`); vals.push(actorType); }
  if (actorName) { conditions.push(`actor_name = $${i++}`); vals.push(actorName); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [{ rows: countRows }] = await pool!.query(`SELECT COUNT(*) as c FROM training_records ${where}`, vals);
  const [{ rows }] = await pool!.query(
    `SELECT * FROM training_records ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...vals, limit, offset]
  );
  return {
    total: parseInt(countRows[0].c),
    records: rows.map(r => ({
      id: r.id, gameId: r.game_id, turnNumber: r.turn_number,
      actorId: r.actor_id, actorName: r.actor_name, actorClass: r.actor_class,
      actorTeam: r.actor_team, actorType: r.actor_type,
      stateSnapshot: r.state_snapshot, thinkingSteps: r.thinking_steps,
      action: r.action, actionResult: r.action_result,
      actionTimedOut: r.action_timed_out, actionWasBad: r.action_was_bad,
      createdAt: r.created_at,
    })),
  };
}

export async function exportTrainingRecords(format: 'jsonl' | 'csv', filters: Parameters<typeof listTrainingRecords>[0]): Promise<string> {
  const { records } = await listTrainingRecords({ ...filters, limit: 100000 });
  if (format === 'jsonl') {
    return records.map(r => JSON.stringify(r)).join('\n');
  }
  // CSV
  const headers = ['id', 'game_id', 'turn_number', 'actor_id', 'actor_name', 'actor_class', 'actor_team', 'actor_type', 'action_timed_out', 'action_was_bad', 'created_at'];
  const rows = records.map(r => headers.map(h => {
    const val = (r as any)[h];
    if (val === null || val === undefined) return '';
    if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
    return String(val);
  }).join(','));
  return [headers.join(','), ...rows].join('\n');
}
```

- [ ] **Step 6: Run existing tests to verify no regression**

Run: `npx vitest run`
Expected: All existing tests pass (no changes to existing queries).

- [ ] **Step 7: Commit**

```bash
git add src/db/index.ts
git commit -m "feat: add training data schema (tournaments, games, training_records)"
```

---

## Task 2: Training Data Collection Hook

**Dependencies:** Task 1
**Files:**
- Create: `src/arena/training-collector.ts`
- Modify: `src/arena/battle-runner.ts` (add event emission for training data)

- [ ] **Step 1: Create training collector module**

Create `src/arena/training-collector.ts`:

```typescript
// Collects training records from a BattleLog after battle completes.
// Called by the server after BattleRunner.run() finishes.

import type { BattleLog, TurnResult, CombatResult, CombatAction } from "../engine/types.js";
import type { LLMAgent } from "../agent/llm-agent.js";
import type { Character } from "../engine/types.js";
import * as db from "../db/index.js";

interface RawTrainingRecord {
  gameId: number;
  turnNumber: number;
  actorId: string;
  actorName: string;
  actorClass: string;
  actorTeam: string | null;
  actorType: 'llm' | 'heuristic' | 'human' | 'boss';
  stateSnapshot: object;
  thinkingSteps: object[] | null;
  action: object;
  actionResult: object;
  actionTimedOut: boolean;
  actionWasBad: boolean;
}

function getAgentType(actorId: string, agents: Array<{ id: string; constructor?: { name: string } }>): RawTrainingRecord['actorType'] {
  const agent = agents.find(a => a.id === actorId);
  if (!agent) return 'heuristic';
  const name = agent.constructor?.name || '';
  if (name.includes('LLM')) return 'llm';
  if (name.includes('Human')) return 'human';
  if (name.includes('Boss')) return 'boss';
  return 'heuristic';
}

function extractThinkingSteps(result: TurnResult): object[] | null {
  return (result.thinkingSteps && result.thinkingSteps.length > 0)
    ? result.thinkingSteps.map(s => ({
        type: s.type,
        toolName: s.toolName,
        text: s.text,
      }))
    : null;
}

function buildStateSnapshot(char: Character, allChars: Character[], turnResult: TurnResult): object {
  return {
    actor: {
      id: char.id,
      name: char.name,
      class: char.class,
      hp: char.hp,
      maxHp: char.stats.maxHp,
      ac: char.stats.ac,
      position: char.position,
      statusEffects: char.statusEffects.map(e => ({ type: e.type, turnsRemaining: e.turnsRemaining })),
      spellSlots: char.spellSlots,
      concentrationSpellId: char.concentrationSpellId,
    },
    allies: allChars
      .filter(c => c.team === char.team && c.id !== char.id && c.hp > 0)
      .map(c => ({ id: c.id, name: c.name, hp: c.hp, maxHp: c.stats.maxHp, position: c.position })),
    enemies: allChars
      .filter(c => c.team !== char.team && c.hp > 0)
      .map(c => ({ id: c.id, name: c.name, hp: c.hp, maxHp: c.stats.maxHp, ac: c.stats.ac, position: c.position })),
    turnNumber: turnResult.turnNumber,
  };
}

export async function collectTrainingData(
  gameId: number,
  log: BattleLog,
  agents: Array<{ id: string; constructor?: { name: string } }>
): Promise<number> {
  const records: RawTrainingRecord[] = [];

  for (const turn of log.turns) {
    for (const result of turn.results) {
      const actorType = getAgentType(turn.actorId, agents);
      const actorChar = log.stateSnapshot?.characters?.find((c: Character) => c.id === turn.actorId);
      if (!actorChar) continue;

      const stateSnapshot = turn.stateSnapshot
        ? buildStateSnapshot(
            turn.stateSnapshot.characters.find((c: Character) => c.id === turn.actorId),
            turn.stateSnapshot.characters,
            turn
          )
        : {};

      records.push({
        gameId,
        turnNumber: turn.turnNumber,
        actorId: turn.actorId,
        actorName: actorChar.name || turn.actorId,
        actorClass: actorChar.class || 'unknown',
        actorTeam: actorChar.team || null,
        actorType,
        stateSnapshot,
        thinkingSteps: extractThinkingSteps(turn),
        action: result.action,
        actionResult: result.result || {},
        actionTimedOut: result.action?.timedOut || false,
        actionWasBad: !!result.result?.badAction,
      });
    }
  }

  if (records.length === 0) return 0;
  return db.saveTrainingRecords(records);
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `npx tsc --noEmit src/arena/training-collector.ts`
Expected: No errors (imports resolve to existing types).

- [ ] **Step 3: Commit**

```bash
git add src/arena/training-collector.ts
git commit -m "feat: add training data collector module"
```

---

## Task 3: Consolidated Backend Server

**Dependencies:** Task 1, Task 2
**Files:**
- Rewrite: `src/server.ts`
- Delete after: `src/arena/tournament-server.ts` (merged into server.ts)

This is the largest task. The new `src/server.ts` merges the REST APIs from both `server.ts` (LLM configs, battle logs, bosses) and `tournament-server.ts` (tournament management, SSE streaming, model discovery, history, reports), plus adds new training data endpoints and WebSocket game sessions.

- [ ] **Step 1: Create the new server scaffold**

Create the new `src/server.ts` with this structure. The file should contain:

1. **Imports** — all from existing modules
2. **Express app** with CORS, JSON parsing
3. **HTTP server** with WebSocket upgrade
4. **REST API routes** (all consolidated)
5. **SSE endpoint** for tournament streaming
6. **WebSocket handler** for live battles
7. **SPA serving** in production
8. **Startup** with DB migration

Key imports:
```typescript
import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { TournamentRunner, type TournamentEvent, type TournamentResult, HEURISTIC_BASELINE } from "./arena/tournament.js";
import { HeuristicAgent } from "./agent/heuristic-agent.js";
import { LLMAgent } from "./agent/llm-agent.js";
import { HumanAgent } from "./agent/human-agent.js";
import { BossAgent } from "./agent/boss-agent.js";
import { createCharacter, createBoss, getAllBosses } from "./engine/characters.js";
import { createBoss as createBossEntity, getBossProfile, BOSS_ORDER } from "./engine/bosses.js";
import { BattleRunner } from "./arena/battle-runner.js";
import { createWsRenderer } from "./arena/ws-renderer.js";
import { saveReplay } from "./arena/replay.js";
import { collectTrainingData } from "./arena/training-collector.js";
import * as db from "./db/index.js";
```

- [ ] **Step 2: Implement consolidated REST API**

The server should expose these endpoints (merged from both old servers):

**LLM Configs** (from old server.ts):
```
GET    /api/llm-configs
GET    /api/llm-configs/:id
POST   /api/llm-configs
PATCH  /api/llm-configs/:id
DELETE /api/llm-configs/:id
```

**Tournaments** (merged from old tournament-server.ts + new DB):
```
GET    /api/tournaments                    — list (with pagination)
GET    /api/tournaments/:id                — get single
POST   /api/tournaments                    — create (returns id)
POST   /api/tournaments/:id/start          — start tournament run
POST   /api/tournaments/:id/abort          — abort
GET    /api/tournaments/:id/status         — live status
GET    /api/tournaments/:id/events         — SSE stream
GET    /api/tournaments/:id/games          — list games for tournament
```

**Games** (new):
```
GET    /api/games/:id                      — get single game
GET    /api/games/:id/training             — get training records for game
```

**Training Data** (new):
```
GET    /api/training                       — list records (with filters: gameId, actorType, actorName)
GET    /api/training/export?format=jsonl    — export JSONL
GET    /api/training/export?format=csv     — export CSV
GET    /api/training/stats                 — aggregate stats (total records, by actor type, by game)
```

**Battle** (from old server.ts, kept for human play via WebSocket):
```
GET    /api/bosses                         — list boss profiles
GET    /api/battle-logs                    — recent battle logs
```

**Model Discovery** (from old tournament-server.ts):
```
GET    /api/models                         — discover models from LLM endpoint
GET    /api/health                         — check LLM endpoint health
```

**ELO Ratings** (from old tournament-server.ts):
```
GET    /api/ratings                        — persisted ELO ratings
```

- [ ] **Step 3: Implement tournament start handler with training data collection**

The `POST /api/tournaments/:id/start` handler should:
1. Load tournament config from DB
2. Create TournamentRunner (same as old tournament-server.ts)
3. On each game complete: save game to DB via `db.saveGame()`, then call `collectTrainingData(gameId, battleLog, agents)`
4. On tournament complete: save result to DB via `db.updateTournament()`
5. Emit SSE events to all connected clients (same event types as old tournament-server.ts: `tournament_start`, `matchup_start`, `turn`, `game_end`, `tournament_end`)
6. Emit `training_saved` event after each game's training data is collected

- [ ] **Step 4: Implement WebSocket game sessions (for Play view)**

The WebSocket handler should support these messages (same protocol as old server.ts but with training data collection added):

**Client → Server:**
- `{ type: "start_battle", name, class, enemyMode, llmConfigId?, scenario? }`
- `{ type: "start_scenario", participants, arena, winCondition }`
- `{ type: "start_boss_exam", class, enemyMode, llmConfigId? }`
- `{ type: "action", action: CombatAction }`

**Server → Client:**
All existing messages from old server.ts, plus:
- `{ type: "training_saved", gameId, recordCount }` — after battle ends and training data is saved

On battle end, the server should:
1. Save game to DB: `db.saveGame({ tournamentId: null, participantA, participantB, classA, classB, winner, totalTurns, durationMs, battleLog })`
2. Collect training data: `collectTrainingData(gameId, log, agents)`
3. Send `training_saved` event to client

- [ ] **Step 5: Implement SPA serving**

In production mode, serve the built Vue SPA:
```typescript
if (!isDev) {
  const distPath = path.join(__dirname, '..', 'web', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
```

- [ ] **Step 6: Verify server starts and all endpoints respond**

Run: `npx tsx src/server.ts &` then test:
```bash
curl -s http://localhost:3001/api/tournaments | head -20
curl -s http://localhost:3001/api/llm-configs | head -20
curl -s http://localhost:3001/api/training/stats | head -20
curl -s http://localhost:3001/api/bosses | head -20
```
Expected: All return valid JSON (possibly empty arrays).

- [ ] **Step 7: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/server.ts
git commit -m "feat: consolidated backend server (REST + SSE + WebSocket + training data)"
```

---

## Task 4: Vue SPA Foundation

**Dependencies:** Task 3
**Files:**
- Create: `web/src/main.ts`, `web/src/App.vue`, `web/src/router/index.ts`, `web/src/types/index.ts`
- Create: `web/src/api/client.ts`, `web/src/api/tournaments.ts`, `web/src/api/games.ts`, `web/src/api/training.ts`, `web/src/api/llm-configs.ts`
- Create: `web/src/stores/settings.ts`, `web/src/stores/tournament.ts`, `web/src/stores/game.ts`, `web/src/stores/data.ts`
- Create: `web/src/composables/useWebSocket.ts`, `web/src/composables/useSSE.ts`
- Create: `web/src/components/layout/AppSidebar.vue`, `web/src/components/layout/AppHeader.vue`
- Create: `web/src/components/common/LoadingSpinner.vue`, `web/src/components/common/ErrorBanner.vue`, `web/src/components/common/EmptyState.vue`, `web/src/components/common/HealthBar.vue`
- Rewrite: `web/src/style.css`
- Install: `vue-router`, `pinia`

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd web && npm install vue-router@4 pinia
```

- [ ] **Step 2: Create shared types**

Create `web/src/types/index.ts` with TypeScript interfaces matching all API responses. These types will be used by stores and components.

Key interfaces to define:
```typescript
// API response types matching server endpoints
export interface Tournament { id: number; status: string; config: TournamentConfig; result: TournamentResult | null; createdAt: string; startedAt: string | null; completedAt: string | null; }
export interface TournamentConfig { models: string[]; bestOf: number; maxTurns: number; kFactor: number; }
export interface Game { id: number; tournamentId: number | null; gameIndex: number; participantA: string; participantB: string; classA: string; classB: string; winner: string | null; totalTurns: number | null; durationMs: number | null; }
export interface TrainingRecord { id: number; gameId: number; turnNumber: number; actorId: string; actorName: string; actorClass: string; actorTeam: string | null; actorType: string; stateSnapshot: any; thinkingSteps: any[] | null; action: any; actionResult: any; actionTimedOut: boolean; actionWasBad: boolean; }
export interface LLMConfig { id: number; name: string; provider: string; model: string; apiKey: string | null; baseUrl: string | null; isDefault: boolean; }
export interface BossProfile { id: string; name: string; tier: number; hp: number; ac: number; }

// Battle state types (for WebSocket messages)
export interface CharState { id: string; name: string; team: string; class: string; hp: number; maxHp: number; ac: number; statusEffects: { type: string; turnsRemaining: number }[]; position?: { x: number; y: number }; spells: { id: string; name: string; currentCooldown: number }[]; inventory: { id: string; name: string; quantity: number }[]; spellSlots?: Record<string, number>; }
export interface ChatMessage { id: number; type: 'system' | 'player' | 'enemy' | 'status' | 'info' | 'error' | 'thinking'; text: string; }
```

- [ ] **Step 3: Create API client**

Create `web/src/api/client.ts` — a fetch wrapper:
```typescript
const BASE_URL = import.meta.env.VITE_API_URL || '';

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText);
  }
  return res.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
```

Create `web/src/api/tournaments.ts`, `web/src/api/games.ts`, `web/src/api/training.ts`, `web/src/api/llm-configs.ts` — each file exports functions that call `api()` with the correct paths. Follow the endpoint list from Task 3.

- [ ] **Step 4: Create Pinia stores**

Create 4 Pinia stores following this pattern (example for settings store):

`web/src/stores/settings.ts`:
```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { LLMConfig } from '../types';
import * as api from '../api/llm-configs';

export const useSettingsStore = defineStore('settings', () => {
  const configs = ref<LLMConfig[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const defaultConfig = computed(() => configs.value.find(c => c.isDefault) || configs.value[0] || null);

  async function fetchConfigs() { /* ... */ }
  async function createConfig(input: any) { /* ... */ }
  async function updateConfig(id: number, input: any) { /* ... */ }
  async function deleteConfig(id: number) { /* ... */ }

  return { configs, loading, error, defaultConfig, fetchConfigs, createConfig, updateConfig, deleteConfig };
});
```

Create `web/src/stores/tournament.ts` — manages tournament list, current tournament, SSE connection.
Create `web/src/stores/game.ts` — manages live battle state, WebSocket connection, chat messages.
Create `web/src/stores/data.ts` — manages training record queries, filters, pagination.

- [ ] **Step 5: Create composables**

Create `web/src/composables/useWebSocket.ts`:
- Connects to `/ws` with WebSocket
- Implements exponential-backoff reconnect (1s, 2s, 4s… up to 30s)
- Implements heartbeat ping/pong (ping every 30s, expect pong within 5s)
- Emits `connected`, `disconnected`, `message` events
- Wraps JSON.parse in try/catch (fixes audit finding W-01)

Create `web/src/composables/useSSE.ts`:
- Connects to SSE endpoint
- Implements auto-reconnect with event buffer replay
- Emits parsed events
- Provides `connected` ref for UI status

- [ ] **Step 6: Create Vue Router config**

Create `web/src/router/index.ts`:
```typescript
import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/tournaments', name: 'tournaments', component: () => import('../views/TournamentsView.vue') },
  { path: '/tournaments/:id/live', name: 'tournament-live', component: () => import('../views/TournamentLiveView.vue') },
  { path: '/play', name: 'play', component: () => import('../views/PlayView.vue') },
  { path: '/data', name: 'data', component: () => import('../views/DataView.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
```

- [ ] **Step 7: Create App.vue layout shell**

Create `web/src/App.vue` with:
- AppSidebar (left nav with route links: Dashboard, Tournaments, Play, Data, Settings)
- AppHeader (top bar with connection status indicator)
- `<router-view>` for main content
- ErrorBanner (global error display)
- LoadingSpinner (global loading state)

- [ ] **Step 8: Create layout components**

Create `web/src/components/layout/AppSidebar.vue`:
- Navigation links with icons: 🏠 Dashboard, 🏆 Tournaments, ⚔️ Play, 📊 Data, ⚙️ Settings
- Active route highlighting
- Collapsible on mobile
- Uses `<router-link>` with `active-class`

Create `web/src/components/layout/AppHeader.vue`:
- Shows current page title
- WebSocket connection status (🟢 connected / 🔴 disconnected / 🟡 reconnecting)
- Training data collection indicator (shows count of records collected in current session)

- [ ] **Step 9: Create common components**

Create `web/src/components/common/LoadingSpinner.vue`:
- CSS-only spinner (respects `prefers-reduced-motion`)
- Size prop (sm/md/lg)
- Optional label text

Create `web/src/components/common/ErrorBanner.vue`:
- Props: `message`, `dismissible`
- Red/orange/yellow styling by severity
- Close button
- Uses `aria-live="assertive"` for accessibility

Create `web/src/components/common/EmptyState.vue`:
- Props: `icon` (emoji), `title`, `description`, `actionLabel`, `actionCallback`
- Centered layout

Create `web/src/components/common/HealthBar.vue`:
- Props: `current`, `max`, `label`, `showText`
- Color transitions: green (>60%) → yellow (30-60%) → red (<30%)
- Animated width transition
- Accessible: `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`

- [ ] **Step 10: Create unified design system (style.css)**

Rewrite `web/src/style.css` with a single design system:

```css
:root {
  /* Single palette — aligned across the entire app */
  --bg: #0d1117;
  --bg-card: #161b22;
  --bg-hover: #1c2129;
  --surface: #21262d;
  --border: #30363d;
  --text: #e6edf3;
  --text-dim: #8b949e;
  --text-bright: #ffffff;

  /* Accent — single blue used everywhere */
  --accent: #58a6ff;
  --accent-dim: #1f6feb;
  --accent-hover: #79c0ff;

  /* Semantic colours */
  --success: #3fb950;
  --warning: #d29922;
  --danger: #f85149;

  /* HP colours */
  --hp-high: #3fb950;
  --hp-mid: #d29922;
  --hp-low: #f85149;

  /* Typography */
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", "Fira Code", monospace;
  --text-xs: 0.75rem;
  --text-sm: 0.8125rem;
  --text-base: 0.875rem;
  --text-lg: 1rem;
  --text-xl: 1.25rem;

  /* Spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* Focus visible */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Base styles */
body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  margin: 0;
  min-height: 100vh;
}

/* Layout */
.app-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-rows: auto 1fr;
  min-height: 100vh;
}

.app-sidebar { grid-row: 1 / -1; }
.app-header { grid-column: 2; }
.app-main { grid-column: 2; padding: var(--space-6); overflow-y: auto; }

@media (max-width: 768px) {
  .app-layout {
    grid-template-columns: 1fr;
  }
  .app-sidebar { display: none; }
  .app-header { grid-column: 1; }
  .app-main { grid-column: 1; }
}

/* Cards */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
  line-height: 1.4;
  min-height: 36px;
}

.btn-primary { background: var(--accent-dim); color: white; }
.btn-primary:hover { background: var(--accent); }
.btn-ghost { background: transparent; color: var(--text); border-color: var(--border); }
.btn-ghost:hover { background: var(--bg-hover); }
.btn-danger { background: var(--danger); color: white; }
.btn-danger:hover { opacity: 0.9; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Tables */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.data-table th, .data-table td {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
}
.data-table th {
  font-weight: 600;
  color: var(--text-dim);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.data-table tbody tr:hover { background: var(--bg-hover); }

/* Form elements */
.form-group { margin-bottom: var(--space-4); }
.form-label { display: block; font-size: var(--text-sm); font-weight: 500; margin-bottom: var(--space-1); color: var(--text-dim); }
.form-input, .form-select {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: var(--text-base);
}
.form-input:focus, .form-select:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
}
```

- [ ] **Step 11: Rewrite main.ts with Pinia + Router**

Create `web/src/main.ts`:
```typescript
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
```

- [ ] **Step 12: Create placeholder views**

Create minimal placeholder views for all 6 routes so the app renders without errors:

`web/src/views/DashboardView.vue` — `<div class="card"><h1>Dashboard</h1><p>Coming soon</p></div>`
`web/src/views/TournamentsView.vue` — same pattern
`web/src/views/TournamentLiveView.vue` — same
`web/src/views/PlayView.vue` — same
`web/src/views/DataView.vue` — same
`web/src/views/SettingsView.vue` — same

- [ ] **Step 13: Verify SPA builds and serves**

Run:
```bash
cd web && npm run build
npx tsx src/server.ts &
curl -s http://localhost:3001/ | head -5
```
Expected: Vue SPA index.html served with script/link tags.

- [ ] **Step 14: Run existing tests**

Run: `npx vitest run`
Expected: All pass.

- [ ] **Step 15: Commit**

```bash
git add web/ src/server.ts
git commit -m "feat: Vue SPA foundation (router, stores, API client, design system)"
```

---

## Task 5: Dashboard View

**Dependencies:** Task 4
**Files:**
- Modify: `web/src/views/DashboardView.vue` (replace placeholder)
- Create: `web/src/components/tournament/TournamentCard.vue`
- Create: `web/src/components/tournament/EloTable.vue`

- [ ] **Step 1: Implement DashboardView**

The dashboard shows:
1. **Quick stats row** — 3 cards: Total Tournaments, Total Games, Training Records (with icons)
2. **Recent Tournaments** — last 5 tournaments as TournamentCard components, link to full list
3. **ELO Leaderboard** — top 10 ELO ratings from `GET /api/ratings`, shown as EloTable
4. **Quick actions** — buttons: "New Tournament", "Play Now", "View Data"

Each section loads data from the Pinia stores (which call the API client).

- [ ] **Step 2: Implement TournamentCard**

Props: `tournament: Tournament`
Shows: status badge (pending/running/completed/aborted), model count, date, ELO delta (if completed)
Links to tournament detail/live view.

- [ ] **Step 3: Implement EloTable**

Fetches from `GET /api/ratings`.
Shows: rank, model name, ELO rating, games played, win rate.
Sortable by clicking column headers.
Top 3 get 🥇🥈🥉 medals.

- [ ] **Step 4: Verify in browser**

Run dev mode: `cd web && npm run dev`
Navigate to `http://localhost:3000/`
Expected: Dashboard renders with stats, recent tournaments, ELO table, quick actions.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/DashboardView.vue web/src/components/tournament/
git commit -m "feat: dashboard view with stats, recent tournaments, ELO leaderboard"
```

---

## Task 6: Tournament List + Create

**Dependencies:** Task 4
**Files:**
- Modify: `web/src/views/TournamentsView.vue` (replace placeholder)
- Create: `web/src/components/tournament/TournamentCreateForm.vue`

- [ ] **Step 1: Implement TournamentsView**

Two-panel layout:
1. **Left: Tournament list** — paginated table of all tournaments (status, models, date, result summary). Click to navigate to live/detail view.
2. **Right: Create form** — TournamentCreateForm component

- [ ] **Step 2: Implement TournamentCreateForm**

Fields:
- **Models** — chip selector with auto-discovery from `GET /api/models`. Include "Heuristic AI" as a baseline with tooltip explaining it. Minimum 2 models required.
- **Best of** — radio: 1 (Quick), 3 (Standard), 5, 7, 11 (Marathon)
- **Max turns** — number input (default 30)
- **K-factor** — number input (default 32) with tooltip: "Higher = faster ELO changes per game"

UX fixes from audit:
- Show loading state while models are being discovered
- Show error state if model discovery fails
- Disable "Start" until ≥2 models selected
- Show warning before Marathon: "This will run ~N games and may take a while"
- Highlight active preset
- Validation: minimum 2 models

On submit: `POST /api/tournaments` → navigate to `/tournaments/:id/live`

- [ ] **Step 3: Verify in browser**

Navigate to `http://localhost:3000/tournaments`
Expected: Tournament list loads. Create form works. Model chips are selectable.

- [ ] **Step 4: Commit**

```bash
git add web/src/views/TournamentsView.vue web/src/components/tournament/TournamentCreateForm.vue
git commit -m "feat: tournament list and create form"
```

---

## Task 7: Tournament Live View

**Dependencies:** Task 6
**Files:**
- Modify: `web/src/views/TournamentLiveView.vue` (replace placeholder)
- Create: `web/src/components/tournament/MatchupMatrix.vue`

- [ ] **Step 1: Implement TournamentLiveView**

Three sections:
1. **Status bar** — tournament status, progress bar, timer, SSE connection indicator
2. **Live log** — scrolling game narratives via SSE (using `useSSE` composable)
3. **Results panel** — ELO table (live-updating), matchup progress, final summary

SSE event handling:
- `tournament_start` → show "Tournament started" banner
- `matchup_start` → update current matchup display
- `turn` → append narrative to log (using `insertAdjacentHTML` pattern, NOT `innerHTML +=`)
- `game_end` → update ELO table, matchup progress
- `tournament_end` → show final results, enable "View Data" link
- `training_saved` → show "📊 N training records collected" badge

- [ ] **Step 2: Implement MatchupMatrix**

Props: `matchups: Array<{ modelA, modelB, result }>`
Head-to-head grid with:
- Cell color: green (A won), red (B won), yellow (draw)
- Cell content: "2-1" format (wins for each)
- Title tooltips with full model names
- Row/column totals
- Icons ✓/✗ alongside colors for color-blind accessibility (audit finding A-02)

- [ ] **Step 3: Verify with a live tournament**

1. Create a tournament with 2 heuristic models, Bo1
2. Navigate to live view
3. Watch SSE events stream in
4. Verify ELO table updates
5. Verify training_saved event shows record count
6. Check training records in DB after completion

- [ ] **Step 4: Commit**

```bash
git add web/src/views/TournamentLiveView.vue web/src/components/tournament/MatchupMatrix.vue
git commit -m "feat: tournament live view with SSE, ELO, matchup matrix"
```

---

## Task 8: Play Arena (Setup + Battle)

**Dependencies:** Task 4
**Files:**
- Modify: `web/src/views/PlayView.vue` (replace placeholder)
- Create: `web/src/components/play/PlaySetup.vue`
- Create: `web/src/components/play/BattleView.vue`
- Create: `web/src/components/play/ActionPanel.vue`
- Create: `web/src/components/play/BattleLog.vue`
- Create: `web/src/components/play/StatusPanel.vue`
- Create: `web/src/components/play/BattlefieldCanvas.vue`

This is the second-largest task. It replaces both the old SetupScreen.vue and BattleView.vue.

- [ ] **Step 1: Implement PlayView**

Parent view that manages the phase state:
- `setup` → renders PlaySetup
- `battle` | `boss_exam` → renders BattleView
- `ended` → renders BattleView with results overlay

- [ ] **Step 2: Implement PlaySetup**

Configures a battle (1-match tournament). Fields:
- **Player name** — text input
- **Class** — 4 class cards (Warrior, Mage, Rogue, Paladin) with stats preview. Click to select.
- **Enemy mode** — toggle: "Heuristic AI" (default) or "LLM". When LLM selected, show LLM config dropdown.
- **Arena** — select or "Auto"
- **Start Battle** button

On submit: connects WebSocket and sends `start_battle` message.

UX fixes from audit:
- Loading state for LLM config fetch
- Error state if fetch fails
- Disable start if LLM mode selected but no config
- Class cards show spell list on hover/click (audit finding X-09)
- Arena auto-selection shows computed size hint

- [ ] **Step 3: Implement BattleView**

Layout:
```
┌─────────────────────────────────────────┐
│ AppHeader (back button, connection, turn)│
├──────────────┬──────────────────────────┤
│              │                          │
│  StatusPanel │   BattlefieldCanvas      │
│  (HP bars,   │   (canvas grid)          │
│   status FX, │                          │
│   spell slots│                          │
│   inventory) │                          │
│              │                          │
├──────────────┴──────────────────────────┤
│  BattleLog (chat-style narrative)        │
├─────────────────────────────────────────┤
│  ActionPanel (buttons + target picker)   │
└─────────────────────────────────────────┘
```

WebSocket integration via `useWebSocket` composable:
- Connects on mount, reconnects on disconnect
- Sends actions via WebSocket
- Receives and dispatches server messages

Message handling:
- `battle_start` → initialize characters, switch to battle phase
- `turn_start` → update turn indicator, highlight active character
- `your_turn` → enable ActionPanel
- `enemy_thinking` / `enemy_thinking_step` → show thinking panel with friendly labels (audit finding B-07)
- `move` → update canvas positions
- `action_chosen` → show action label
- `action_result` → append narrative to BattleLog
- `state_update` → update StatusPanel HP/effects
- `battle_end` → show results, enable "Play Again" / "View Data"
- `training_saved` → show "📊 N records collected" badge

UX fixes from audit:
- Show disconnect banner when WebSocket drops (B-01)
- Handle page refresh → detect and show "Session ended" message (B-02)
- Derive winner from humanIds for scenario mode (B-03)
- Reset actionMode when myTurn changes (B-06)
- Auto-scroll respects user scroll position (B-09)
- Show "Preparing next fight…" between boss fights (B-12)
- Back to setup option during battle (G-08)

- [ ] **Step 4: Implement ActionPanel**

Action buttons (full grid, fixing audit finding B-05 — add missing actions):
- ⚔️ Attack → target picker appears (fixes B-04 — multi-target)
- 🛡️ Defend
- ✨ Cast Spell → spell sub-panel (with slot cost + description, fixes B-08)
- 🧪 Use Item → item sub-panel
- ⚡ Dash (NEW — was missing)
- 🏃 Flee (with confirmation dialog, fixes B-13)
- 💪 Grapple / Shove (NEW — in "Special" flyout)

Target picker: when an action needs a target, show living characters as selectable cards (fixes B-04).

- [ ] **Step 5: Implement StatusPanel**

- Character card with: name, class icon, HP bar (HealthBar component), AC, position
- Status effects with emoji + turn count (fixes B-11)
- Spell slots display (e.g., "1st: 3/4, 2nd: 1/3")
- Active character highlight (your turn vs enemy turn vs ally turn, fixes B-10)
- Death save display for downed characters
- Concentration indicator

- [ ] **Step 6: Implement BattleLog**

- Chat-style scrollable container
- `aria-live="polite"` for screen readers (fixes A-03)
- Auto-scroll with user scroll detection (fixes B-09)
- Message types styled differently: system (dim), player (blue), enemy (red), status (yellow), error (red banner)
- Enemy thinking steps shown with friendly labels, not raw tool names (fixes B-07)

- [ ] **Step 7: Implement BattlefieldCanvas**

- HTML5 canvas showing arena grid
- Character positions as colored circles with initials
- Cover objects as rectangles
- Movement arrows
- `role="img"` and dynamic `aria-label` (fixes A-04)
- Responsive sizing (fills container width)

- [ ] **Step 8: Verify full play flow in browser**

1. Navigate to `/play`
2. Select class, click Start
3. Verify battle starts, HP bars update, actions work
4. Verify training_saved badge appears after battle
5. Verify training records in DB
6. Test disconnect: stop server, verify banner appears, restart server, verify reconnect

- [ ] **Step 9: Commit**

```bash
git add web/src/views/PlayView.vue web/src/components/play/
git commit -m "feat: play arena with full battle UI, all actions, training data collection"
```

---

## Task 9: Training Data Viewer

**Dependencies:** Task 5
**Files:**
- Modify: `web/src/views/DataView.vue` (replace placeholder)
- Create: `web/src/components/data/TrainingTable.vue`
- Create: `web/src/components/data/DatasetExporter.vue`

- [ ] **Step 1: Implement DataView**

Two-panel layout:
1. **Filters sidebar** — filter by game ID, actor type (LLM/Human/Heuristic/Boss), actor name, date range
2. **Main content** — tabbed: "Records" (TrainingTable) | "Export" (DatasetExporter)

- [ ] **Step 2: Implement TrainingTable**

Paginated data table showing training records:
- Columns: Game, Turn, Actor, Class, Action Type, Result, Timed Out, Bad Action
- Click row to expand: shows full state snapshot, thinking steps, action details
- Sortable columns
- Filters applied from sidebar
- Shows total count and pagination

- [ ] **Step 3: Implement DatasetExporter**

Export options:
- **JSONL** — one JSON object per line (standard for LLM fine-tuning)
- **CSV** — spreadsheet format
- **Fine-tuning format** — structured `{system, user, assistant}` conversation pairs derived from state→thinking→action chain

For fine-tuning format, transform each training record where `actorType === 'llm'` into:
```json
{
  "messages": [
    { "role": "system", "content": "<battle state description>" },
    { "role": "assistant", "content": "<thinking steps + action>" }
  ]
}
```

Show preview of first 3 records before download.

- [ ] **Step 4: Verify in browser**

1. Run a tournament to generate training data
2. Navigate to `/data`
3. Verify records appear in table
4. Verify filters work
5. Export JSONL and verify content
6. Export fine-tuning format and verify structure

- [ ] **Step 5: Commit**

```bash
git add web/src/views/DataView.vue web/src/components/data/
git commit -m "feat: training data viewer and dataset exporter"
```

---

## Task 10: Settings View (LLM Config CRUD)

**Dependencies:** Task 4
**Files:**
- Modify: `web/src/views/SettingsView.vue` (replace placeholder)

- [ ] **Step 1: Implement SettingsView**

Two sections:
1. **LLM Configurations** — full CRUD table
2. **Display Preferences** — (future placeholder)

LLM Config table:
- Columns: Name, Provider, Model, Base URL, Default badge, Actions (Edit/Delete)
- "Add Configuration" button → inline form below table
- **Edit** button → same inline form pre-populated, submits PATCH (fixes audit finding S-03)
- **Delete** button → confirmation dialog (fixes audit finding G-05)
- **Set as Default** toggle
- Error banner on API failure (fixes audit finding S-04)
- Loading spinner during fetch (fixes audit finding S-02)

- [ ] **Step 2: Verify in browser**

1. Navigate to `/settings`
2. Create a new LLM config
3. Edit it (verify PATCH works)
4. Delete it (verify confirmation dialog)
5. Verify error handling (try invalid base URL)

- [ ] **Step 3: Commit**

```bash
git add web/src/views/SettingsView.vue
git commit -m "feat: settings view with full LLM config CRUD"
```

---

## Task 11: CLI Refactor

**Dependencies:** Task 3
**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Audit CLI for private implementations**

Read `src/index.ts` and identify any logic that is CLI-only (not available via the web server or shared modules). Flag any business logic that should be extracted.

Expected finding: The CLI calls engine/agent functions directly (createCharacter, createAgentFor, BattleRunner, etc.) — this is correct. It should continue to do so. The CLI should NOT duplicate any server logic.

- [ ] **Step 2: Add training data collection to CLI battles**

After each CLI battle completes, call `collectTrainingData()` to save training records to the DB. This ensures CLI battles also contribute to the training dataset.

In `runScenario`, `run1v1`, and `runBossExam`, after `runner.run()` returns:
```typescript
const gameId = await db.saveGame({
  tournamentId: null,
  gameIndex: 0,
  participantA: charA.name,
  participantB: charB.name,
  classA: charA.class,
  classB: charB.class,
  winner: log.winner,
  totalTurns: log.totalTurns,
  durationMs: Date.now() - log.startTime,
  battleLog: log,
});
const recordCount = await collectTrainingData(gameId, log, agents);
console.log(chalk.dim(`  📊 ${recordCount} training records saved`));
```

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: CLI collects training data alongside web battles"
```

---

## Task 12: Cleanup — Remove Old UIs

**Dependencies:** Tasks 3, 4, 7, 8
**Files:**
- Delete: `src/arena/tournament-server.ts`
- Delete: `src/arena/dashboard.html`
- Delete: `web/src/components/SetupScreen.vue`
- Delete: `web/src/components/BattleView.vue`

- [ ] **Step 1: Verify old files are no longer imported**

Search for imports of deleted files:
```bash
grep -r "tournament-server" src/ --include="*.ts"
grep -r "dashboard.html" src/ --include="*.ts"
grep -r "SetupScreen" web/src/ --include="*.vue" --include="*.ts"
grep -r "BattleView" web/src/components/ --include="*.vue" --include="*.ts"
```
Expected: No matches (all references removed in earlier tasks).

- [ ] **Step 2: Delete old files**

```bash
rm src/arena/tournament-server.ts src/arena/dashboard.html
rm web/src/components/SetupScreen.vue web/src/components/BattleView.vue
```

- [ ] **Step 3: Update package.json scripts**

Update npm scripts to reflect the new architecture:
- `dev` → `tsx src/server.ts` (single server, Vite proxies to it)
- `web` → `cd web && npm run build && cd .. && tsx src/server.ts`
- `dashboard` → remove (functionality absorbed into unified app)
- `dashboard:test` → remove

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All pass.

- [ ] **Step 5: Verify SPA works end-to-end**

```bash
cd web && npm run build && cd ..
npx tsx src/server.ts &
curl -s http://localhost:3001/api/tournaments
curl -s http://localhost:3001/api/training/stats
curl -s http://localhost:3001/ | grep -o '<title>.*</title>'
```
Expected: All endpoints respond, SPA HTML served.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove old UI surfaces (tournament-server, dashboard.html, old Vue components)"
```

---

## Task 13 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS. No regressions from pre-existing tests.

- [ ] **Step 2: Verify unified SPA builds**

Run: `cd web && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Verify all API endpoints**

Start server: `npx tsx src/server.ts &`

Test all endpoint groups:
```bash
# Tournaments
curl -s http://localhost:3001/api/tournaments
curl -s -X POST http://localhost:3001/api/tournaments -H 'Content-Type: application/json' -d '{"models":["heuristic"],"bestOf":1,"maxTurns":30,"kFactor":32}'

# Training data
curl -s http://localhost:3001/api/training/stats
curl -s http://localhost:3001/api/training?limit=5
curl -s "http://localhost:3001/api/training/export?format=jsonl&limit=2"

# LLM Configs
curl -s http://localhost:3001/api/llm-configs

# Static files
curl -s http://localhost:3001/ | head -3
```
Expected: All return valid responses.

- [ ] **Step 4: Verify plan success criteria**

Check each criterion:
- [ ] Single unified Vue 3 SPA serves at `/` with all views
- [ ] Tournament management: create, run (SSE), view results, ELO tracking
- [ ] Play arena: human vs agent battles via WebSocket with all actions
- [ ] Training data collected automatically from every battle (tournament and play)
- [ ] Training data browsable and exportable (JSONL, CSV, fine-tuning format)
- [ ] LLM config CRUD with edit capability
- [ ] WebSocket reconnect + heartbeat implemented
- [ ] SSE reconnect with buffer replay implemented
- [ ] `prefers-reduced-motion` respected
- [ ] `:focus-visible` styles on all interactive elements
- [ ] ARIA attributes on canvas and live regions
- [ ] CLI collects training data to same DB as web
- [ ] Old UIs (tournament-server.ts, dashboard.html) deleted
- [ ] All pre-existing tests pass

- [ ] **Step 5: Verify no old files remain**

```bash
ls src/arena/tournament-server.ts 2>&1   # should fail
ls src/arena/dashboard.html 2>&1        # should fail
ls web/src/components/SetupScreen.vue 2>&1  # should fail
ls web/src/components/BattleView.vue   2>&1  # should fail
```
Expected: All "No such file or directory".
