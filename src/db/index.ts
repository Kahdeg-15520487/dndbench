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

// ── Pool shutdown ──────────────────────────────────────

export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
}
