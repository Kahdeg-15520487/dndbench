# ⚔️ RPG Arena — LLM Agent Battle System

A turn-based RPG arena where **two LLM agents battle each other** using tool calls, or **you can fight an AI opponent** through a browser-based chatbox UI. Each agent sees the game state and chooses from a set of combat actions exposed as function/tool calls.

Works with **any OpenAI-compatible API** — OpenAI, Ollama, LM Studio, Groq, Together, etc.

## Architecture

```
Battle Runner (orchestrator)
├── Agent A (LLM Client) ──┐
│   sees game state        │
│   returns tool call ─────┤
├── Agent B (LLM Client) ──┤
│   sees game state        │
│   returns tool call ─────┤
│                          ▼
│              ┌───────────────────┐
│              │   Game Engine     │
│              │  • Combat Resolver│
│              │  • Status Effects │
│              │  • Ability System │
│              │  • Inventory      │
│              └───────────────────┘
```

## RPG Mechanics

### Classes
| Class | HP | MP | STR | DEF | MAG | SPD | LCK | Special |
|-------|----|----|-----|-----|-----|-----|-----|---------|
| **Warrior** | 120 | 30 | 18 | 15 | 5 | 10 | 8 | High physical damage |
| **Mage** | 70 | 100 | 5 | 7 | 22 | 12 | 10 | All 8 spells |
| **Rogue** | 85 | 50 | 14 | 9 | 8 | 22 | 18 | High crit + dodge |
| **Paladin** | 110 | 60 | 13 | 18 | 12 | 8 | 10 | Tanky healer |

### Tool Call Actions (what LLM agents can use)
| Action | Description |
|--------|-------------|
| `attack(target)` | Physical attack. Scales with STR. Can crit (LCK) or be dodged (SPD). |
| `defend()` | Greatly boosts DEF for one turn. |
| `cast_spell(spell_id, target)` | Cast a spell (costs MP, may have cooldown). |
| `use_item(item_id)` | Use a consumable item from inventory. |
| `wait()` | Skip turn, recover 8 MP. |
| `flee()` | Attempt to escape (chance-based on SPD). Losing move if successful. |

### Spells
| Spell | Cost | CD | Type | Effect |
|-------|------|----|------|--------|
| Fire | 12 MP | 0 | Damage | 28 base power + 35% burn |
| Ice | 14 MP | 1 | Damage | 24 base power + 25% freeze |
| Lightning | 18 MP | 2 | Damage | 40 base power, pierces DEF |
| Heal | 15 MP | 1 | Heal | 35 base + MAG scaling |
| Shield | 10 MP | 3 | Buff | +12 DEF for 3 turns |
| Poison | 10 MP | 0 | Debuff | 10 base + 70% poison DoT |
| Drain | 16 MP | 2 | Drain | 22 base + 50% life steal |
| Meteor | 35 MP | 5 | Damage | 65 base + 50% burn |

### Status Effects
- **Burn**: DoT each turn (from Fire, Meteor)
- **Freeze**: Skip a turn (from Ice)
- **Poison**: DoT each turn (from Poison spell)
- **Shield**: +DEF buff (from Shield spell)

### Items
- **Health Potion** (restores 40 HP)
- **Mana Potion** (restores 30 MP)
- **Antidote** (cures all status effects)
- **Bomb** (deals 35 fixed damage to enemy)
- **Elixir** (fully restores HP + MP, cures status)

## Quick Start (Web UI — Human vs AI)

```bash
# One command to start both server and frontend dev:
npm run dev
```

Then open **http://localhost:3000** in your browser. Pick a class, name your character, and battle!

For production build:
```bash
npm run web      # builds Vue + starts server on :3000
```

## Usage

### Quick Mock Battle (no API needed)
```bash
npm run battle:mock
# or
npx tsx src/index.ts --mode mock --delay 800
```

### LLM vs LLM Battle
```bash
# Set env vars (works with any OpenAI-compatible API)
# See .env.example for provider-specific base URLs

# OpenAI
LLM_API_KEY=sk-... npx tsx src/index.ts --mode llm

# Ollama (local, no key needed)
LLM_BASE_URL=http://localhost:11434/v1 npx tsx src/index.ts --mode llm --a1-model llama3 --a2-model mistral

# LM Studio (local)
LLM_BASE_URL=http://localhost:1234/v1 npx tsx src/index.ts --mode llm

# Groq
LLM_API_KEY=gsk_... LLM_BASE_URL=https://api.groq.com/openai/v1 npx tsx src/index.ts --mode llm
```

### Mixed: LLM vs Mock AI
```bash
npm run battle:mixed
# or
npx tsx src/index.ts --mode mixed --a1-model gpt-4o-mini
```

### Full Options
```bash
npx tsx src/index.ts \
  --a1-class warrior --a1-name "Grog" --a1-model gpt-4o-mini \
  --a2-class mage --a2-name "Merlin" --a2-model gpt-4o-mini \
  --mode llm --max-turns 30 --delay 1000 \
  -o battle-log.json
```

## Project Structure
```
src/
├── engine/
│   ├── types.ts          # All TypeScript types
│   ├── characters.ts     # Character factory, classes, spells, items
│   ├── combat.ts         # Core combat resolver (damage, spells, items, status)
│   └── index.ts          # Engine exports
├── agent/
│   └── llm-agent.ts      # LLM agent controller (OpenAI-compatible tool-calling)
├── tools/
│   └── definitions.ts    # Tool call schema definitions
├── arena/
│   └── battle-runner.ts  # CLI battle orchestrator, turn management, display
├── server.ts             # Web server (Express + WebSocket + GameSession)
└── index.ts              # CLI entry point
web/
├── index.html
├── vite.config.ts
└── src/
    ├── main.ts
    ├── style.css
    ├── App.vue            # Root component (WebSocket, game state)
    └── components/
        ├── SetupScreen.vue  # Class selection & battle setup
        └── BattleView.vue   # HP bars, chat, action panel
```

## How LLM Tool-Calling Works

1. **Battle Runner** sends game state (HP, MP, spells, items, enemy status) to the agent
2. **Agent** formats this as a system prompt + user message with tool definitions
3. **LLM** returns a tool call (e.g., `cast_spell(spell_id: "fire", target: "enemy")`)
4. **Agent** converts the tool call to a `CombatAction`
5. **Engine** resolves the action and returns narrative + numbers
6. **Runner** checks for death/status, ticks cooldowns, moves to next turn

## Adding Your Own Agent

```typescript
import { LLMAgent } from "./agent/llm-agent.js";
import { createCharacter } from "./engine/characters.js";

// Works with any OpenAI-compatible endpoint
const agent = new LLMAgent({
  name: "MyFighter",
  character: createCharacter("my-id", "Fighter", "warrior"),
  provider: "openai-compatible",
  model: "gpt-4o-mini",
  // Or Ollama:
  // baseURL: "http://localhost:11434/v1",
  // apiKey: "not-needed",
  systemPrompt: "Play aggressively! Always attack when possible.",
});
```

## License

MIT
