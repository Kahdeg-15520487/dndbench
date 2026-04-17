// ─────────────────────────────────────────────────────────
//  Database — PostgreSQL connection, auto-migration, queries
//
//  Falls back to in-memory storage if Postgres is unavailable.
// ─────────────────────────────────────────────────────────

import pg from "pg";
const { Pool } = pg;

// ── Connection ──────────────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://arena:arena@localhost:5432/arena01";

let pool: pg.Pool | null = null;
let dbAvailable = false;

// ── In-memory fallback ──────────────────────────────────

let memConfigs: (LLMConfig & { id: number })[] = [];
let memBattleLogs: BattleLogRow[] = [];
let memNextConfigId = 1;
let memNextLogId = 1;
let memTournaments: any[] = [];
let memGames: any[] = [];
let memTrainingRecords: any[] = [];
let memNextTournamentId = 1;
let memNextGameId = 1;
let memNextTrainingId = 1;

// ── Auto-Migrate ────────────────────────────────────────

export async function migrate(): Promise<void> {
  try {
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query("SELECT 1");
    dbAvailable = true;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS llm_configs (
        id          SERIAL PRIMARY KEY,
        name        TEXT    NOT NULL UNIQUE,
        provider    TEXT    NOT NULL DEFAULT 'openai-compatible',
        model       TEXT    NOT NULL,
        api_key     TEXT,
        base_url    TEXT,
        is_default  BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS battle_logs (
        id          SERIAL PRIMARY KEY,
        player_name TEXT,
        player_class TEXT,
        enemy_class  TEXT,
        enemy_mode   TEXT    NOT NULL DEFAULT 'mock',
        winner       TEXT,
        turns        INT,
        duration_ms  INT,
        log_json     JSONB,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );

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
    `);
    console.log(`  DB migrated ✓`);
  } catch (err: any) {
    dbAvailable = false;
    pool = null;
    console.log(`  DB unavailable (${err.code || err.message}), using in-memory storage`);
  }
}

// ── Types ───────────────────────────────────────────────

export interface LLMConfig {
  id: number;
  name: string;
  provider: string;
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BattleLogRow {
  id: number;
  playerName: string | null;
  playerClass: string | null;
  enemyClass: string | null;
  enemyMode: string;
  winner: string | null;
  turns: number | null;
  durationMs: number | null;
  logJson: any;
  createdAt: Date;
}

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

// ── LLM Config CRUD ────────────────────────────────────

export async function listLLMConfigs(): Promise<LLMConfig[]> {
  if (!dbAvailable) {
    return memConfigs.map(({ apiKey, ...rest }) => rest);
  }
  const { rows } = await pool!.query(
    `SELECT id, name, provider, model, api_key, base_url, is_default, created_at, updated_at
     FROM llm_configs ORDER BY is_default DESC, name`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    model: r.model,
    apiKey: r.api_key,
    baseUrl: r.base_url,
    isDefault: r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getLLMConfig(id: number): Promise<LLMConfig | null> {
  if (!dbAvailable) {
    const c = memConfigs.find(c => c.id === id);
    if (!c) return null;
    const { apiKey, ...rest } = c;
    return rest;
  }
  const { rows } = await pool!.query(
    `SELECT id, name, provider, model, api_key, base_url, is_default, created_at, updated_at
     FROM llm_configs WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    model: r.model,
    apiKey: r.api_key,
    baseUrl: r.base_url,
    isDefault: r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getDefaultLLMConfig(): Promise<LLMConfig | null> {
  if (!dbAvailable) {
    const c = memConfigs.find(c => c.isDefault);
    if (!c) return memConfigs[0] || null;
    const { apiKey, ...rest } = c;
    return rest;
  }
  const { rows } = await pool!.query(
    `SELECT id, name, provider, model, api_key, base_url, is_default, created_at, updated_at
     FROM llm_configs WHERE is_default = true LIMIT 1`
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    model: r.model,
    apiKey: r.api_key,
    baseUrl: r.base_url,
    isDefault: r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CreateLLMConfigInput {
  name: string;
  provider?: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  isDefault?: boolean;
}

export async function createLLMConfig(input: CreateLLMConfigInput): Promise<LLMConfig> {
  if (!dbAvailable) {
    if (input.isDefault) {
      memConfigs.forEach(c => c.isDefault = false);
    }
    const c: LLMConfig & { id: number } = {
      id: memNextConfigId++,
      name: input.name,
      provider: input.provider || "openai-compatible",
      model: input.model,
      apiKey: input.apiKey || null,
      baseUrl: input.baseUrl || null,
      isDefault: input.isDefault ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    memConfigs.push(c);
    const { apiKey, ...rest } = c;
    return rest;
  }
  // If this is set as default, clear other defaults first
  if (input.isDefault) {
    await pool!.query(`UPDATE llm_configs SET is_default = false`);
  }

  const { rows } = await pool!.query(
    `INSERT INTO llm_configs (name, provider, model, api_key, base_url, is_default)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, provider, model, api_key, base_url, is_default, created_at, updated_at`,
    [
      input.name,
      input.provider || "openai-compatible",
      input.model,
      input.apiKey || null,
      input.baseUrl || null,
      input.isDefault ?? false,
    ]
  );
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    model: r.model,
    apiKey: r.api_key,
    baseUrl: r.base_url,
    isDefault: r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function updateLLMConfig(
  id: number,
  input: Partial<CreateLLMConfigInput>
): Promise<LLMConfig | null> {
  if (!dbAvailable) {
    const idx = memConfigs.findIndex(c => c.id === id);
    if (idx === -1) return null;
    const c = memConfigs[idx];
    if (input.isDefault) {
      memConfigs.forEach(c => c.isDefault = false);
    }
    if (input.name !== undefined) c.name = input.name;
    if (input.provider !== undefined) c.provider = input.provider;
    if (input.model !== undefined) c.model = input.model;
    if (input.apiKey !== undefined) c.apiKey = input.apiKey;
    if (input.baseUrl !== undefined) c.baseUrl = input.baseUrl;
    if (input.isDefault !== undefined) c.isDefault = input.isDefault;
    c.updatedAt = new Date();
    const { apiKey, ...rest } = c;
    return rest;
  }
  // If setting as default, clear others
  if (input.isDefault) {
    await pool!.query(`UPDATE llm_configs SET is_default = false`);
  }

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;

  for (const [key, col] of [
    ["name", "name"],
    ["provider", "provider"],
    ["model", "model"],
    ["apiKey", "api_key"],
    ["baseUrl", "base_url"],
    ["isDefault", "is_default"],
  ] as const) {
    if (key in input) {
      sets.push(`${col} = $${i++}`);
      vals.push((input as any)[key] ?? null);
    }
  }

  if (sets.length === 0) return getLLMConfig(id);

  sets.push(`updated_at = now()`);
  vals.push(id);

  const { rows } = await pool!.query(
    `UPDATE llm_configs SET ${sets.join(", ")} WHERE id = $${vals.length}
     RETURNING id, name, provider, model, api_key, base_url, is_default, created_at, updated_at`,
    vals
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    model: r.model,
    apiKey: r.api_key,
    baseUrl: r.base_url,
    isDefault: r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function deleteLLMConfig(id: number): Promise<boolean> {
  if (!dbAvailable) {
    const idx = memConfigs.findIndex(c => c.id === id);
    if (idx === -1) return false;
    memConfigs.splice(idx, 1);
    return true;
  }
  const { rowCount } = await pool!.query(`DELETE FROM llm_configs WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

// ── Battle Logs ────────────────────────────────────────

export async function saveBattleLog(log: {
  playerName?: string;
  playerClass?: string;
  enemyClass?: string;
  enemyMode: string;
  winner?: string;
  turns?: number;
  durationMs?: number;
  logJson?: any;
}): Promise<number> {
  if (!dbAvailable) {
    const id = memNextLogId++;
    memBattleLogs.push({
      id,
      playerName: log.playerName ?? null,
      playerClass: log.playerClass ?? null,
      enemyClass: log.enemyClass ?? null,
      enemyMode: log.enemyMode,
      winner: log.winner ?? null,
      turns: log.turns ?? null,
      durationMs: log.durationMs ?? null,
      logJson: log.logJson,
      createdAt: new Date(),
    });
    return id;
  }
  const { rows } = await pool!.query(
    `INSERT INTO battle_logs (player_name, player_class, enemy_class, enemy_mode, winner, turns, duration_ms, log_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [log.playerName, log.playerClass, log.enemyClass, log.enemyMode, log.winner, log.turns, log.durationMs, JSON.stringify(log.logJson)]
  );
  return rows[0].id;
}

export async function listBattleLogs(limit = 50): Promise<BattleLogRow[]> {
  if (!dbAvailable) {
    return memBattleLogs.slice(-limit).reverse();
  }
  const { rows } = await pool!.query(
    `SELECT id, player_name, player_class, enemy_class, enemy_mode, winner, turns, duration_ms, log_json, created_at
     FROM battle_logs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    id: r.id,
    playerName: r.player_name,
    playerClass: r.player_class,
    enemyClass: r.enemy_class,
    enemyMode: r.enemy_mode,
    winner: r.winner,
    turns: r.turns,
    durationMs: r.duration_ms,
    logJson: r.log_json,
    createdAt: r.created_at,
  }));
}

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
  const headers = ['id', 'game_id', 'turn_number', 'actor_id', 'actor_name', 'actor_class', 'actor_team', 'actor_type', 'action_timed_out', 'action_was_bad', 'created_at'];
  const rows = records.map(r => headers.map(h => {
    const val = (r as any)[h];
    if (val === null || val === undefined) return '';
    if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
    return String(val);
  }).join(','));
  return [headers.join(','), ...rows].join('\n');
}

// ── Pool shutdown ──────────────────────────────────────

export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
}
