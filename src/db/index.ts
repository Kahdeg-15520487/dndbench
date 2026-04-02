// ─────────────────────────────────────────────────────────
//  Database — PostgreSQL connection, auto-migration, queries
// ─────────────────────────────────────────────────────────

import pg from "pg";
const { Pool } = pg;

// ── Connection ──────────────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://arena:arena@localhost:5432/arena01";

const pool = new Pool({ connectionString: DATABASE_URL });

// ── Auto-Migrate ────────────────────────────────────────

export async function migrate(): Promise<void> {
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
  const { rows } = await pool.query(
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
  const { rows } = await pool.query(
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
  const { rows } = await pool.query(
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
  // If this is set as default, clear other defaults first
  if (input.isDefault) {
    await pool.query(`UPDATE llm_configs SET is_default = false`);
  }

  const { rows } = await pool.query(
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
  // If setting as default, clear others
  if (input.isDefault) {
    await pool.query(`UPDATE llm_configs SET is_default = false`);
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

  const { rows } = await pool.query(
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
  const { rowCount } = await pool.query(`DELETE FROM llm_configs WHERE id = $1`, [id]);
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
  const { rows } = await pool.query(
    `INSERT INTO battle_logs (player_name, player_class, enemy_class, enemy_mode, winner, turns, duration_ms, log_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [log.playerName, log.playerClass, log.enemyClass, log.enemyMode, log.winner, log.turns, log.durationMs, JSON.stringify(log.logJson)]
  );
  return rows[0].id;
}

export async function listBattleLogs(limit = 50): Promise<BattleLogRow[]> {
  const { rows } = await pool.query(
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
  await pool.end();
}
