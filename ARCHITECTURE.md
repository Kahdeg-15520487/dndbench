# Arena01 — Architecture Reference (Rebuild Guide)

> Distilled from the full codebase. Everything you need to rebuild from scratch.

---

## 1. What It Is

A **D&D 5e combat engine** where AI agents (LLM, heuristic, boss-scripted, human) battle each other.
Two front-ends: a **CLI** and a **Web Dashboard**. One back-end: a **Node.js/TypeScript Express server**.

The system has three distinct modes:

| Mode | Description | Entry Point |
|------|-------------|-------------|
| **CLI Battle** | Run a single battle from the terminal | `src/index.ts` |
| **Tournament Dashboard** | ELO round-robin tournament with web UI | `src/index.ts --serve-reports` → `tournament-server.ts` |
| **Web Game Server** | Play battles in the browser (1v1, boss exam, scenarios) | `src/server.ts` |

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ESM, ES2022 target) |
| Runtime | Node.js 22+ |
| Web Framework | Express 5 |
| Real-time (Game Server) | WebSocket (`ws` library) |
| Real-time (Tournament) | Server-Sent Events (SSE) |
| Frontend | Vue 3 (Composition API, `<script setup>`) + Vite |
| Database | PostgreSQL 16 (with in-memory fallback) |
| LLM Integration | OpenAI-compatible API via `@mariozechner/pi-coding-agent` SDK |
| Testing | Vitest |
| Rendering | `canvas` (node-canvas) for battlefield images, `gif-encoder-2` for animated GIFs |
| CLI | `chalk` for colored terminal output |
| Validation | `zod` + `@sinclair/typebox` |
| Markdown | `marked` for report HTML conversion |

---

## 3. Core Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ENTRY POINTS                                 │
│                                                                     │
│  index.ts (CLI)              server.ts (Web Game)                    │
│  ├── CLI battles             ├── Express REST API                   │
│  ├── Tournaments             ├── WebSocket Game Server              │
│  └── Boss Exams              └── Serves Vue SPA (production)        │
│                                                                     │
│  tournament-server.ts (Tournament Dashboard)                        │
│  ├── Express REST API                                               │
│  └── SSE Live Stream                                                │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BATTLE RUNNER                                  │
│                   (arena/battle-runner.ts)                          │
│                                                                     │
│  - Orchestrates turns (initiative order by DEX)                    │
│  - Calls agent.getAction(state) → awaits CombatAction              │
│  - Calls engine.resolveAction() → CombatResult                     │
│  - Emits BattleEvents to subscribed renderers                      │
│  - Runs to completion, returns BattleLog                           │
│                                                                     │
│  Only knows about IAgent interface. Doesn't care if agent          │
│  is human, LLM, heuristic, or boss.                                │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │                                  │
           ▼                                  ▼
┌─────────────────────┐          ┌─────────────────────────────────┐
│   AGENTS            │          │   GAME ENGINE                    │
│   (agent/)          │          │   (engine/)                      │
│                     │          │                                  │
│  IAgent (interface) │          │  combat.ts — resolveAction()     │
│  ├─ HeuristicAgent  │          │    d20 attack rolls vs AC        │
│  ├─ LLMAgent        │          │    saving throws                 │
│  ├─ HumanAgent      │          │    spell slot consumption        │
│  └─ BossAgent       │          │    status effect processing      │
│                     │          │    reaction system (AoO, etc.)   │
│  All implement:     │          │                                  │
│  - getAction(state) │          │  dice.ts — seeded PRNG           │
│  - onBattleStart()  │          │    deterministic & replayable    │
│  - onActionResult() │          │                                  │
│  - onBattleEnd()    │          │  types.ts — all type definitions │
│  - destroy()        │          │                                  │
│                     │          │  characters.ts — character factory│
│  LLM Agent uses:    │          │    4 class presets (Level 5)     │
│  tools/definitions  │          │                                  │
│  (observe → act)    │          │  bosses.ts — 5 boss stat blocks  │
└─────────────────────┘          └─────────────────────────────────┘
           │                                  │
           ▼                                  ▼
┌─────────────────────┐          ┌─────────────────────────────────┐
│   LLM API           │          │   RENDERERS / OUTPUT             │
│   (OpenAI-compat)   │          │   (arena/)                       │
│                     │          │                                  │
│  Any provider:      │          │  cli-renderer.ts — terminal      │
│  - OpenAI           │          │  ws-renderer.ts — WebSocket JSON │
│  - Ollama           │          │  battlefield-renderer.ts — canvas│
│  - LM Studio        │          │  replay.ts — markdown + GIF      │
│  - Groq             │          │                                  │
│  - Together         │          │  elo.ts — ELO rating system      │
│  - llama.cpp        │          │  tournament.ts — round-robin     │
│  - Local models     │          │  tournament-report.ts — markdown │
│                     │          │  tournament-server.ts — Express  │
└─────────────────────┘          └─────────────────────────────────┘
```

---

## 4. Data Model (Core Types)

### 4.1 Character

```
Character {
  id, name, team, class (warrior|mage|rogue|paladin|boss), level
  stats: { maxHp, hp, str, dex, con, int, wis, cha, ac, proficiencyBonus, speed }
  position: { x, y }
  statusEffects: StatusEffect[]
  spells: Spell[]
  inventory: InventoryItem[]
  spellSlots: Record<level, { total, used }>
  weapon: WeaponDef
  features: ClassFeature[]
  fightingStyle?, equippedShield, savingThrowProfs[]
  concentrationSpellId?, reactionUsed
  deathSaveSuccesses, deathSaveFailures, layOnHandsPool
  resistances[], vulnerabilities[], immunities[]
  isDefending, actionHistory[]
}
```

### 4.2 Combat Actions

```
CombatAction {
  type: "attack" | "defend" | "cast_spell" | "use_item" | "wait"
      | "flee" | "class_ability" | "dash" | "grapple" | "shove"
  actorId, targetId?, spellId?, itemId?, abilityId?
  move?: { dx, dy }
  bonusAction?: { type, targetId?, variant? }
  timedOut?: boolean
}
```

### 4.3 Combat Results

```
CombatResult {
  action: CombatAction
  narrative: string          // Human-readable description
  move?: MoveResult
  damage?: DamageResult      // { damage, wasCrit, wasMiss, attackRoll, targetAc, damageRolls, ... }
  heal?: HealResult
  spell?: SpellResult
  item?: ItemResult
  abilityResult?: AbilityResult
  reaction?: ReactionResult  // AoO, shield spell, uncanny dodge
  badAction?: string         // Reason if action was invalid
  fled?, fledSuccessfully?
}
```

### 4.4 Battle Log

```
BattleLog {
  turns: TurnResult[]     // { turnNumber, actorId, results[], stateSnapshot, thinkingSteps? }
  winner?, totalTurns, startTime, endTime, arena, diceSeed?, endReason?
}
```

---

## 5. Agent System (The Key Abstraction)

### The IAgent Interface

```typescript
interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly type: "heuristic" | "llm" | "human" | "boss";

  onBattleStart?(state: BattleStateSnapshot): void | Promise<void>;
  getAction(state: BattleStateSnapshot): Promise<CombatAction>;
  onActionResult?(result: CombatResult): void;
  onBattleEnd?(winner?: string, reason?: string): void;
  destroy?(): void;
}
```

**The BattleRunner only knows about this interface.** It calls `getAction()`, awaits the result, and resolves the action. The agent can be:
- **HeuristicAgent** — instant, rule-based decisions
- **LLMAgent** — multi-step agentic loop (observe → think → act via tool calls)
- **HumanAgent** — Promise resolves when the human clicks a button
- **BossAgent** — scripted per boss profile

### LLM Agent Flow (per turn)

```
Engine calls getAction(state)
  → Build system prompt with full battle state
  → Start agentic loop (up to 5 iterations):
      1. Send messages + tools to LLM
      2. Observation tools (free, loop continues):
           inspect_self, inspect_enemy, estimate_distance,
           review_spells, review_inventory
      3. Action tools (commits turn, loop ends):
           attack, defend, cast_spell, use_item, dash, flee
  → Return the committed CombatAction
```

---

## 6. Battle Flow (Step by Step)

```
1. Create Characters (createCharacter or createBoss)
2. Create Agents (matching each character)
3. Create BattleRunner(characters, agents, config)
4. runner.run()
   a. onBattleStart() — notify all agents
   b. Loop until finished:
      i.   Determine turn order (DEX, ties broken by dice)
      ii.  For each living character:
           - Reset reactions
           - Roll death saves for dying characters
           - Process Spirit Guardians aura damage
           - Check frozen/paralyzed → skip turn
           - await agent.getAction(snapshot)
           - resolveMove() → check opportunity attacks
           - resolveTarget() → find enemy
           - resolveAction(actor, target, action, dice, arena, allChars)
           - Concentration check if target took damage
           - tickCooldowns()
           - Check defeat (HP ≤ 0 → unconscious/death saves)
           - Action Surge? → grant extra action
      iii. Process round-end status effects (burn, poison, etc.)
      iv.  Check battle end conditions
   c. onBattleEnd() — notify all agents
5. Return BattleLog
```

### Win Conditions
- `last_team_standing` — only one team has conscious members (default)
- `last_unit_standing` — only one unit alive (FFA mode)
- Turn limit reached → draw (with sudden-death decay damage)

---

## 7. Game Modes & User Flows

### Mode 1: CLI Battle (`src/index.ts`)

```
User runs CLI command with args
  → Parse args (participants, arena, mode, etc.)
  → Create characters + agents
  → Create BattleRunner with CliRenderer
  → runner.run() — CliRenderer prints colored output per turn
  → Save replay (markdown + battlefield images)
  → Print battle summary
```

**Participant spec format:** `"Name,Role,Team,AgentType[,Model]"`
- Role: warrior, mage, rogue, paladin, or boss ID
- AgentType: heuristic, llm, human, boss
- Model: LLM model name (only for llm type)

### Mode 2: Tournament Dashboard (`tournament-server.ts`)

```
Browser opens http://localhost:8050
  → Setup Tab: Select models (auto-discovered from LLM endpoint), configure best-of, K-factor
  → POST /api/tournament/start
      → Server creates TournamentRunner
      → Runs round-robin: every model pair plays best-of-N
      → Class rotation: warrior/mage, mage/warrior, rogue/paladin, paladin/rogue per game
      → SSE stream: /api/tournament/events
  → Live Tab: Watch real-time battle narratives, HP bars, ELO rankings
  → Reports Tab: Final rankings, matchup matrix, class breakdown, game replays
  → Results saved to disk (markdown report + JSON data)
  → ELO ratings persist across sessions (ratings.json)
  → Tournament history persists (history.json)
```

**Tournament REST API:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/models` | GET | List LLM models from endpoint |
| `/api/health` | GET | Check LLM endpoint reachability |
| `/api/tournament/start` | POST | Start tournament (body: { models, bestOf, maxTurns, kFactor }) |
| `/api/tournament/abort` | POST | Cancel running tournament |
| `/api/tournament/reset` | POST | Clear state |
| `/api/tournament/retry/:idx` | POST | Re-run a specific matchup |
| `/api/tournament/status` | GET | Current tournament state |
| `/api/tournament/events` | GET | SSE live stream |
| `/api/tournament/events/replay` | GET | Replay buffered events (for page reload) |
| `/api/history` | GET | List past tournaments |
| `/api/history/:id` | GET | Specific tournament details |
| `/api/ratings` | GET | Persisted ELO ratings |
| `/api/reports` | GET | List saved report files |
| `/api/game/:mi/:gi` | GET | Game turn log for replay viewer |
| `/api/export/json` | GET | Download tournament as JSON |
| `/api/export/csv` | GET | Download tournament as CSV |

### Mode 3: Web Game Server (`src/server.ts`)

```
Browser connects via WebSocket
  → SetupScreen.vue: Choose name, class, enemy mode (mock/LLM), or scenario
  → Send start_battle / start_scenario / start_boss_exam
  → Server creates GameSession
    - Creates characters + agents
    - HumanAgent for player(s), HeuristicAgent/LLMAgent for AI
    - BattleRunner with WsRenderer
  → Real-time WebSocket messages:
    Server→Client: battle_start, turn_start, your_turn, move,
                   action_chosen, action_result, state_update, battle_end
    Client→Server: action { type, spellId, itemId, target }
  → Battle ends → save replay + battle log to DB
```

**Game Server REST API:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/llm-configs` | GET/POST | List / create LLM configurations |
| `/api/llm-configs/:id` | GET/PATCH/DELETE | CRUD for LLM configs |
| `/api/battle-logs` | GET | List recent battle logs |
| `/api/bosses` | GET | List boss profiles |

**WebSocket Protocol (Server→Client):**

| Message | Data |
|---------|------|
| `connected` | — |
| `battle_start` | `{ humanIds, arena, characters[] }` |
| `turn_start` | `{ turnNumber, actorId }` |
| `your_turn` | — (human player's turn) |
| `enemy_thinking` | — |
| `enemy_thinking_step` | `{ type, text, toolName, toolResult }` |
| `move` | `{ actorId, from, to, distance }` |
| `action_chosen` | `{ actorId, action, actionLabel }` |
| `action_result` | `{ narrative, characters[] }` |
| `state_update` | `{ characters[] }` |
| `battle_end` | `{ winner, reason }` |
| `boss_exam_start` | `{ bosses[] }` |
| `boss_exam_fight_start` | `{ bossIndex, bossId, bossName, ... }` |
| `boss_exam_fight_end` | `{ won, turns }` |
| `boss_exam_scorecard` | `{ results, completed, total, wins, grade }` |

---

## 8. D&D 5e Mechanics Implemented

### 8.1 Classes (Level 5)

| Class | HP | AC | Key Stats | Features |
|-------|----|----|-----------|----------|
| Warrior | ~49 | 16 | STR 17, CON 16 | Extra Attack, Second Wind, Action Surge, Great Weapon Fighting |
| Mage | ~27 | 12 | INT 17, DEX 14 | Spell Slots 4/3/2, Arcane Recovery, 16+ spells |
| Rogue | ~33 | 15 | DEX 17, CON 14 | Sneak Attack 3d6, Uncanny Dodge, Cunning Action |
| Paladin | ~52 | 18 | STR 17, CHA 15 | Divine Smite, Lay on Hands (25hp pool), Spell Slots 4/2 |

### 8.2 Spells (25 total)

**Cantrips:** Fire Bolt (2d10), Eldritch Blast, Ray of Frost

**1st Level:** Magic Missile (auto-hit 3d4+3), Shield (+5 AC reaction), Thunderwave, Cure Wounds, Healing Word, Shield of Faith (+2 AC concentration), Misty Step

**2nd Level:** Scorching Ray (3 rays), Hold Person (paralyzed), Counterspell (reaction), Bless, Web, Invisibility, Mirror Image

**3rd Level:** Fireball (8d6 AoE), Lightning Bolt (8d6 line), Haste, Slow, Dispel Magic, Spirit Guardians (3d8 aura)

**Reactions:** Shield, Counterspell, Absorb Elements

### 8.3 Combat Mechanics
- d20 attack roll + ability mod + proficiency vs AC
- Critical hits on natural 20 (double damage dice)
- Saving throws (STR/DEX/CON/INT/WIS/CHA)
- Advantage/Disadvantage system
- Spell slot management (consume on cast, Arcane Recovery to restore)
- Concentration mechanic (one concentration spell at a time, DC 10 or half damage)
- Death saves (unconscious at 0 HP, 3 successes = stable, 3 failures = dead, nat 20 = revive to 1 HP)
- Reactions: Attack of Opportunity (enemy leaves melee range), Shield spell, Uncanny Dodge
- Bonus actions: Cunning Action, Two-Weapon Fighting, Healing Word
- Status effects: burn, poison, paralyzed, frozen, shielded, haste, slow, invisible, blinded, frightened, restrained, grappled, prone, stunned, unconscious, spirit_guardians, mirror_image, absorb_elements, decay
- Cover system: half cover (+2 AC), three-quarters cover (+5 AC) from arena terrain
- Grapple/Shove mechanics
- Weapon properties: versatile, finesse, reach, two-handed, heavy

### 8.4 Items
- Health Potion (2d4+2), Greater Health Potion (4d4+4)
- Antidote (cures poison/paralyzed), Bomb (3d6, 20ft range), Elixir (full restore)

### 8.5 Bosses (5 tiers)

| Boss | Tier | HP | AC | Special |
|------|------|----|----|---------|
| Goblin King | 1 | 65 | 15 | Pack Tactics |
| Dark Wizard | 2 | 80 | 13 | Spell casting |
| Ancient Dragon | 3 | 130 | 19 | Multiattack, Breath Weapon |
| Lich Lord | 4 | 100 | 17 | Legendary magic |
| Demon Lord | 5 | 150 | 20 | All abilities |

---

## 9. Database Schema

```sql
CREATE TABLE llm_configs (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  provider    TEXT NOT NULL DEFAULT 'openai-compatible',
  model       TEXT NOT NULL,
  api_key     TEXT,
  base_url    TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE battle_logs (
  id          SERIAL PRIMARY KEY,
  player_name TEXT,
  player_class TEXT,
  enemy_class  TEXT,
  enemy_mode   TEXT NOT NULL DEFAULT 'mock',
  winner       TEXT,
  turns        INT,
  duration_ms  INT,
  log_json     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Note:** The DB module (`db/index.ts`) falls back to in-memory storage if PostgreSQL is unavailable. This makes the system fully functional without a database.

---

## 10. File Structure (Rebuild Order)

```
Phase 1: Engine Foundation
  src/engine/types.ts          — All type definitions, arena presets, positions
  src/engine/dice.ts           — Seeded PRNG (DiceRoller)
  src/engine/characters.ts     — Character factory, class presets, spell/item definitions
  src/engine/bosses.ts         — 5 boss stat blocks
  src/engine/combat.ts         — Core combat resolver (resolveAction, resolveMove, etc.)
  src/engine/index.ts          — Barrel exports

Phase 2: Agent System
  src/agent/interface.ts       — IAgent interface
  src/agent/heuristic-agent.ts — Rule-based AI
  src/agent/human-agent.ts     — Promise-based, resolves on submitAction()
  src/agent/boss-agent.ts      — Scripted per boss profile
  src/agent/llm-agent.ts       — LLM agentic loop via pi SDK
  src/tools/definitions.ts     — Tool schemas for LLM function calling
  src/agent/index.ts           — Barrel exports

Phase 3: Battle Orchestration
  src/arena/battle-runner.ts   — Turn loop, event emission, defeat checks
  src/arena/elo.ts             — ELO rating system
  src/arena/replay.ts          — Markdown + battlefield image replay generation
  src/arena/cli-renderer.ts    — Terminal output (chalk)
  src/arena/ws-renderer.ts     — WebSocket JSON message forwarding
  src/arena/battlefield-renderer.ts — Canvas-based battlefield image generation

Phase 4: Tournament System
  src/arena/tournament.ts           — Round-robin runner with ELO tracking
  src/arena/tournament-report.ts    — Markdown report generation
  src/arena/report-viewer.ts        — Markdown → HTML conversion
  src/arena/tournament-server.ts    — Express server + SSE + dashboard HTML
  src/arena/dashboard.html          — Full SPA (setup/live/reports tabs)

Phase 5: Web Game Server
  src/db/index.ts              — PostgreSQL + in-memory fallback
  src/server.ts                — Express + WebSocket + GameSession
  web/                         — Vue 3 SPA
    web/index.html
    web/vite.config.ts
    web/src/main.ts
    web/src/App.vue            — Root component, WebSocket management
    web/src/components/SetupScreen.vue  — Battle setup UI
    web/src/components/BattleView.vue   — Live battle UI

Phase 6: Entry Points
  src/index.ts                — CLI entry point (all modes)
```

---

## 11. Key Component Interactions

### Interaction 1: Running a Single Battle

```
createCharacter() ──→ Character
createAgentFor() ──→ IAgent (Heuristic/LLM/Human/Boss)
BattleRunner(characters, agents, { eventHandler: renderer })
  └─ run()
       ├─ agent.getAction(snapshot) ──→ await CombatAction
       ├─ resolveAction(actor, target, action, dice, arena, chars) ──→ CombatResult
       ├─ eventHandler(BattleEvent) ──→ renderer prints/sends
       └─ return BattleLog
saveReplay(log, characters, agents) ──→ markdown file
```

### Interaction 2: LLM Agent Turn

```
LLMAgent.getAction(snapshot)
  ├─ Build system prompt (class, stats, spells, position, enemy info)
  ├─ createAgentSession(model, apiKey, baseURL, tools, resourceLoader)
  ├─ session.prompt(battle state as user message)
  ├─ Loop (max 5 iterations):
  │    ├─ LLM calls observation tool → return data, continue
  │    └─ LLM calls action tool → capture CombatAction, break
  └─ return CombatAction
```

### Interaction 3: Human Agent Turn

```
HumanAgent.getAction(snapshot)
  └─ return new Promise(resolve => pendingResolver = resolve)
       ... battle runner awaits ...
       human clicks button in browser
       └─ WebSocket sends { type: "action", action: {...} }
            └─ GameSession.handleHumanAction()
                 └─ humanAgent.submitAction(action)
                      └─ pendingResolver(action)  ← Promise resolves
```

### Interaction 4: Tournament

```
POST /api/tournament/start { models: [...], bestOf: 5 }
  └─ TournamentRunner(models, config)
       └─ run()
            ├─ For each model pair (round-robin):
            │    └─ runMatchup(modelA, modelB)
            │         └─ For each game (best-of-N):
            │              ├─ Pick class pair from rotation
            │              ├─ createCharacter() × 2
            │              ├─ createAgent() × 2 (LLM or Heuristic)
            │              ├─ BattleRunner.run()
            │              ├─ updateStatsAfterMatch() — ELO update
            │              └─ emit SSE events → browser
            └─ saveTournamentReport() → markdown + JSON
                 ├─ saveHistory() → history.json
                 └─ updateSavedRatings() → ratings.json
```

### Interaction 5: Web Game Session

```
WebSocket connect → GameSession created
  ├─ Client: { type: "start_battle", name, class, enemyMode }
  │    └─ Server creates Character + HumanAgent + EnemyAgent
  │         └─ BattleRunner.run()
  │              └─ WsRenderer forwards events:
  │                   ├─ "battle_start" → client initializes UI
  │                   ├─ "turn_start" + "your_turn" → client shows action buttons
  │                   ├─ Client: { type: "action", action: { type: "attack", target: "enemy" } }
  │                   │    └─ HumanAgent.submitAction() → Promise resolves
  │                   ├─ "action_result" → client shows narrative
  │                   └─ "battle_end" → client shows result
  │
  ├─ Client: { type: "start_scenario", participants: [...], arena, winCondition }
  │    └─ N-unit battle (supports multiple humans, teams, bosses)
  │
  └─ Client: { type: "start_boss_exam", class, enemyMode }
       └─ Sequential 5-boss fights with scorecard
```

---

## 12. Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://arena:arena@localhost:5432/arena01` | PostgreSQL connection |
| `LLM_API_KEY` | `no-key` | OpenAI-compatible API key |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | LLM API endpoint |
| `LLM_MODEL` | `gpt-4o-mini` | Default model name |
| `PORT` | 3000 (prod) / 3001 (dev) | Server port |
| `NODE_ENV` | — | `production` disables dev features |

### Docker

- `docker-compose.yml`: PostgreSQL 16 + App container
- `Dockerfile`: Multi-stage build (build web → production runtime)

### NPM Scripts

| Script | Purpose |
|--------|---------|
| `start` | Run CLI default |
| `battle:mock` | Quick mock battle |
| `battle:llm` | 1v1 LLM battle |
| `dashboard` | Tournament dashboard with LLM |
| `dashboard:test` | Tournament dashboard (heuristic only) |
| `dev` | Dev mode: DB + server + Vite concurrently |
| `build:web` | Build Vue SPA |
| `web` | Build + production server |
| `test` | Run Vitest |

---

## 13. Frontend Components (Vue 3)

### App.vue
- Root component, manages WebSocket connection
- Routes between SetupScreen and BattleView based on `phase`
- Handles all server messages and maintains game state

### SetupScreen.vue
- Player name, class selection (4 classes with stats preview)
- Enemy mode (Mock AI / LLM)
- LLM config selector (fetched from `/api/llm-configs`)
- Game mode tabs: 1v1, Boss Exam, Scenario (N-unit)
- Scenario builder: add participants, set teams, choose arena

### BattleView.vue
- Character cards (HP bars, AC, status effects, spell slots)
- Action buttons: Attack, Defend, Cast Spell, Use Item, Dash, Flee
- Spell/item selector (contextual based on availability)
- Battle log (chat-style messages)
- Battlefield minimap (position visualization)
- Enemy thinking visualization (streamed tool calls)
- Boss exam scorecard overlay

---

## 14. Tournament Dashboard (Single HTML File)

The tournament dashboard at `src/arena/dashboard.html` is a **self-contained SPA** (no Vue, no build step). It has three tabs:

### Setup Tab
- Model auto-discovery from LLM endpoint
- ELO ratings display (from persisted ratings.json)
- Config presets: Quick (Bo1), Standard (Bo5), Marathon (Bo11)
- Shareable tournament URLs (config in query params)
- Client-side + server-side validation

### Live Tab
- Real-time battle narrative via SSE
- Color-coded HP bars per turn
- ELO ranking table with live updates
- ELO history sparkline chart (canvas)
- Matchup bracket with progress bars
- Collapsible game details
- Tournament timer with ETA
- Confetti + sound on completion

### Reports Tab
- Final ELO rankings
- Head-to-head matrix (color-coded)
- Class performance breakdown
- Per-game replay viewer with HP bars
- Turn-by-turn mechanics data (dice rolls, saves, crits)
- Tournament history (persisted)
- Export as JSON/CSV
- Comparison mode (two tournaments side-by-side)

---

## 15. Testing

- **394 tests** across 13 test files
- **~87% coverage** (statements/lines)
- Key pattern: `makeRiggedDice([4, 3, 2, 1])` for deterministic combat tests
- Pipeline tests use `HeuristicAgent` via `agentFactory` — no LLM needed
- Tournament integration tests run full heuristic-vs-heuristic tournaments
- Test files mirror source structure: `combat.test.ts`, `battle-runner.test.ts`, etc.

---

## 16. Persistence

| Data | Storage | Format |
|------|---------|--------|
| Battle replays | `replays/` directory | Markdown + PNG/GIF images |
| Tournament reports | `tournament/run-{id}/` | Markdown + JSON (tournament_data.json) |
| ELO ratings | `tournament/ratings.json` | JSON (accumulates across sessions) |
| Tournament history | `tournament/history.json` | JSON array |
| LLM configurations | PostgreSQL `llm_configs` | SQL (in-memory fallback) |
| Battle logs | PostgreSQL `battle_logs` | SQL (in-memory fallback) |
