# ⚔️ D&D Bench — LLM Agent Battle Arena

A **D&D 5e combat engine** where LLM agents battle each other using tool calls. Run 1v1 duels, team battles, boss raids, or full **ELO round-robin tournaments** with a web dashboard.

Works with **any OpenAI-compatible API** — llama.cpp, Ollama, LM Studio, OpenAI, Groq, Together, etc.

## Features

- 🎲 **D&D 5e Combat** — d20 attack rolls, AC, saving throws, spell slots, status effects
- ⚔️ **4 Classes** — Warrior, Mage, Rogue, Paladin — each with unique abilities
- 🐉 **5 Boss Encounters** — Goblin King → Demon Lord (tier-based scaling)
- 🏟️ **ELO Tournaments** — Round-robin matchups with configurable best-of-N
- 📊 **Web Dashboard** — Setup, live monitoring (SSE), reports, history persistence
- 🤖 **Multiple Agent Types** — LLM (agentic loop), Heuristic (rule-based), Human (browser UI), Boss
- 📋 **Tournament Reports** — Markdown reports with matchup matrix, class performance, ELO rankings
- 🔄 **Class Rotation** — Each matchup cycles through warrior/mage/rogue/paladin pairs
- 📈 **Persistent ELO** — Ratings accumulate across sessions via `ratings.json`
- 🎮 **Game Replay** — Turn-by-turn narrative viewer with HP bar visualization

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Battle Runner                           │
│         (orchestrator — only knows IAgent)                  │
│                                                             │
│   agent.getAction(state)  ──── awaits ────┐                │
│                                          │                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│   │ HeuristicAgent│  │   LLMAgent   │  │  BossAgent   │    │
│   │  🤖 instant   │  │ 🧠 agentic   │  │ 🐉 scripted  │    │
│   │  rule-based   │  │  observe→act │  │  boss logic  │    │
│   │  decisions    │  │  multi-step  │  │  per profile  │    │
│   └──────────────┘  └──────────────┘  └──────────────┘    │
│          │                  │                  │             │
│          └──────────────────┼──────────────────┘             │
│                             ▼                                │
│              ┌───────────────────────┐                      │
│              │     Game Engine       │                      │
│              │  • Combat Resolver    │                      │
│              │  • Dice (rigged/test) │                      │
│              │  • Status Effects     │                      │
│              │  • Spell Slots        │                      │
│              │  • D&D 5e Mechanics   │                      │
│              └───────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### The IAgent Interface

Every battle participant implements the same interface:

```typescript
interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly type: "heuristic" | "llm" | "human" | "boss";

  onBattleStart?(state): void;
  getAction(state): Promise<CombatAction>;  // THE core method
  onActionResult?(result): void;
  onBattleEnd?(winner, reason): void;
  destroy?(): void;
}
```

### LLM Agentic Loop

The LLMAgent runs a **multi-step reasoning loop** per turn:

1. Engine calls `getAction(state)`
2. Agent builds system prompt with full battle state (HP, AC, spell slots, status, positions)
3. **Agentic loop** (up to 5 iterations per turn):
   - Send messages + tools to LLM
   - **Observation tools** (free, loop continues): `inspect_self`, `inspect_enemy`, `review_spells`, `review_inventory`
   - **Action tools** (commits turn, loop ends): `attack`, `defend`, `cast_spell`, `use_item`, `dash`, `flee`
4. Returns the committed `CombatAction`

## D&D 5e Mechanics

### Classes (Level 5)

| Class | HP | AC | STR | DEX | CON | INT | WIS | CHA | Special |
|-------|----|----|-----|-----|-----|-----|-----|-----|---------|
| **Warrior** | 55 | 16 | 18 | 13 | 16 | 8 | 10 | 10 | Extra Attack, Second Wind |
| **Mage** | 33 | 12 | 8 | 13 | 13 | 20 | 12 | 10 | Arcane Recovery, all spells |
| **Rogue** | 44 | 14 | 10 | 20 | 14 | 10 | 10 | 10 | Sneak Attack (3d6), Uncanny Dodge |
| **Paladin** | 55 | 18 | 16 | 8 | 14 | 8 | 12 | 16 | Divine Smite, Lay on Hands |

### Spell System

| Spell | Level | Type | Effect |
|-------|-------|------|--------|
| Fire Bolt | Cantrip | Attack roll | 2d10 fire |
| Scorching Ray | 2nd slot | Attack roll (3 rays) | 6d6 fire |
| Fireball | 3rd slot | DEX save | 8d6 fire (half on save) |
| Lightning Bolt | 3rd slot | DEX save | 8d6 lightning (half on save) |
| Magic Missile | 1st slot | Auto-hit | 3d4+3 force |
| Hold Person | 2nd slot | WIS save | Paralyzed (save end of turn) |
| Shield | 1st slot | Reaction | +5 AC until next turn |
| Cure Wounds | 1st slot | Heal | 1d8+MOD |
| Shield of Faith | 1st slot | Buff | +2 AC (concentration) |

### Status Effects
- **Burned**: DoT (Fire Bolt, Scorching Ray)
- **Poisoned**: DoT (rogue weapons, poison bomb)
- **Paralyzed**: Skip turn, auto-crit (Hold Person)
- **Shielded**: +5 AC (Shield spell)
- **Frozen**: Skip turn (Ice effect)

### Items
- **Health Potion** — restores 2d4+2 HP
- **Greater Health Potion** — restores 4d4+4 HP
- **Antidote** — cures poison/paralyzed
- **Bomb** — 3d6 damage (20ft range)
- **Elixir** — full HP + cure status (rare)

### Bosses

| Boss | Tier | Level | HP | AC | Special |
|------|------|-------|----|----|---------|
| Goblin King | 1 | 7 | 65 | 15 | Pack Tactics |
| Dark Wizard | 2 | 9 | 80 | 13 | Spell casting |
| Ancient Dragon | 3 | 11 | 130 | 19 | Multiattack, Breath Weapon |
| Lich Lord | 4 | 13 | 100 | 17 | Legendary magic |
| Demon Lord | 5 | 15 | 150 | 20 | All abilities |

## Quick Start

### Install
```bash
npm install
```

### Web Dashboard (Tournament)
```bash
# Start dashboard (with local LLM)
npx tsx src/index.ts --serve-reports

# Test mode (no LLM needed — uses heuristic agents)
npx tsx src/index.ts --serve-reports --test-mode

# Custom port
npx tsx src/index.ts --serve-reports --serve-reports-port 9090
```

Open http://localhost:8050 — select models, start tournament, watch live!

### CLI Battles
```bash
# Quick mock battle (no API needed)
npm run battle:mock

# 1v1 LLM battle
npx tsx src/index.ts -p "Alpha,warrior,red,llm,Gemma-4-26B" "Beta,mage,blue,llm,Qwen3-27B"

# 2v2 team battle
npm run battle:2v2

# 4v1 boss raid
npm run battle:raid

# Free-for-all
npm run battle:ffa
```

### Tournament CLI
```bash
# 3 models + heuristic baseline, best of 5
npx tsx src/index.ts --tournament -tm gemma-4-26b qwen3 cydonia-24b

# No heuristic baseline, custom settings
npx tsx src/index.ts --tournament -tm modelA modelB \
  --tournament-no-heuristic --tournament-k-factor 24 --tournament-best-of 11
```

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_BASE_URL` | `http://localhost:8008/v1` | OpenAI-compatible API endpoint |
| `LLM_API_KEY` | `no-key` | API key (not needed for local providers) |

## Dashboard Features

The web dashboard at `http://localhost:8050` provides:

### Setup Tab
- Model auto-discovery from LLM endpoint
- ELO ratings from previous sessions
- Config presets: ⚡ Quick (Bo1), ⚔️ Standard (Bo5), 🏃 Marathon (Bo11)
- Shareable tournament URLs
- Client-side + server-side validation

### Live Tab
- Real-time battle narrative via SSE
- Color-coded HP bars per turn
- ELO ranking table with live updates
- ELO history sparkline chart
- Matchup bracket with progress bars
- Collapsible game details per matchup
- Tournament timer with ETA
- Final rankings with 🥇🥈🥉 medals
- Confetti + sound on completion

### Reports Tab
- Final ELO rankings table
- Head-to-head matrix (color-coded)
- Class performance breakdown (warrior/mage/rogue/paladin win rates)
- Matchup summaries with game details
- Turn-by-turn game viewer with HP bars
- Tournament history (persisted to `history.json`)
- Comparison bar chart
- Export as JSON or CSV

### Keyboard Shortcuts
- `1` / `2` / `3` — Switch tabs
- `Escape` — Close modals
- Click any turn in game log to copy text

## Project Structure
```
src/
├── engine/
│   ├── types.ts          # All TypeScript types, arena presets, positions
│   ├── characters.ts     # D&D 5e character factory, class presets, spells, items
│   ├── combat.ts         # Core combat resolver (d20 rolls, AC, saves, spells, status)
│   ├── dice.ts           # Dice roller (standard + rigged for testing)
│   ├── bosses.ts         # D&D 5e monster stat blocks (5 bosses)
│   └── index.ts          # Engine exports
├── agent/
│   ├── interface.ts      # IAgent — unified contract for all participants
│   ├── heuristic-agent.ts # Rule-based AI (instant decisions, dash logic)
│   ├── llm-agent.ts      # LLM agent with agentic loop (observe → think → act)
│   ├── human-agent.ts    # Human player (Promise resolves on UI input)
│   ├── boss-agent.ts     # Boss AI (scripted per boss profile)
│   └── index.ts          # Agent exports
├── tools/
│   └── definitions.ts    # Observation + action tool schemas (OpenAI function calling)
├── arena/
│   ├── battle-runner.ts  # Battle orchestrator (turns, agents, events)
│   ├── elo.ts            # ELO rating system + model stats tracking
│   ├── tournament.ts     # TournamentRunner (round-robin, events, ELO updates)
│   ├── tournament-report.ts # Markdown report generation (matchup + summary)
│   ├── tournament-server.ts # Express web dashboard (SSE, REST API, SPA)
│   ├── report-viewer.ts  # Markdown → HTML conversion
│   ├── cli-renderer.ts   # CLI battle renderer (colored output)
│   ├── ws-renderer.ts    # WebSocket renderer (for web UI)
│   ├── battlefield-renderer.ts # Canvas battlefield image renderer
│   └── replay.ts         # Battle replay (turn-by-turn JSON)
├── server.ts             # Web server (Express + WebSocket + GameSession)
└── index.ts              # CLI entry point

src/__tests__/             # 394 tests across 13 files
```

## Testing

```bash
# Run all tests
npx vitest run

# With coverage
npx vitest run --coverage

# Watch mode
npx vitest
```

**Test Coverage**: 87% statements, 88% lines, 394 tests across 13 files, 0 TypeScript warnings.

### Key Test Patterns
- `makeRiggedDice([4, 3, 2, 1])` — deterministic dice for precise damage assertions
- Pipeline tests use `HeuristicAgent` via `agentFactory` — no LLM needed
- Probabilistic tests run 20-100 iterations with threshold assertions

## Adding Your Own Agent

```typescript
import { IAgent } from "./agent/interface.js";
import { BattleStateSnapshot, CombatAction } from "./engine/types.js";

export class MyCustomAgent implements IAgent {
  readonly type = "custom" as const;
  constructor(public readonly id: string, public readonly name: string) {}

  async getAction(state: BattleStateSnapshot): Promise<CombatAction> {
    const me = state.characters.find(c => c.id === this.id)!;
    const enemy = state.characters.find(c => c.id !== this.id)!;

    // Your logic here
    if (me.stats.hp < me.stats.maxHp * 0.3) {
      return { type: "use_item", actorId: this.id, targetId: this.id, itemId: "health_potion" };
    }
    return { type: "attack", actorId: this.id, targetId: enemy.id };
  }
}
```

## License

MIT
