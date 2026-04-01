# ⚔️ RPG Arena — LLM Agent Battle System

A turn-based RPG arena where **LLM agents battle each other** using tool calls, or **you fight an AI opponent** through a browser-based Vue chatbox UI.

Works with **any OpenAI-compatible API** — OpenAI, Ollama, LM Studio, Groq, Together, etc.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Battle Runner                           │
│         (orchestrator — only knows IAgent)                  │
│                                                             │
│   agent.getAction(state)  ──── awaits ────┐                │
│                                          │                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│   │ HeuristicAgent│  │   LLMAgent   │  │  HumanAgent  │    │
│   │  🤖 instant   │  │ 🧠 agentic   │  │ 👙 Promise   │    │
│   │  rule-based   │  │  observe→act │  │  resolves on │    │
│   │  decisions    │  │  multi-step  │  │  UI click    │    │
│   └──────────────┘  └──────────────┘  └──────────────┘    │
│          │                  │                  │             │
│          └──────────────────┼──────────────────┘             │
│                             ▼                                │
│              ┌───────────────────────┐                      │
│              │     Game Engine       │                      │
│              │  • Combat Resolver    │                      │
│              │  • Status Effects     │                      │
│              │  • Ability System     │                      │
│              │  • Inventory          │                      │
│              └───────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

### The IAgent Interface

Every battle participant implements the same interface:

```typescript
interface IAgent {
  readonly id: string;
  readonly name: string;
  readonly type: "heuristic" | "llm" | "human";
  
  onBattleStart?(state): void;
  getAction(state): Promise<CombatAction>;  // THE core method
  onActionResult?(result): void;
  onBattleEnd?(winner, reason): void;
  destroy?(): void;
}
```

| Agent | Resolves when... | Use case |
|-------|-----------------|----------|
| **HeuristicAgent** 🤖 | Instantly (rule-based AI) | Quick battles, testing |
| **LLMAgent** 🧠 | After agentic loop (observe → think → act) | Smart AI opponent |
| **HumanAgent** 👤 | When `submitAction()` is called | Browser UI player |

### LLM Agentic Loop

The LLMAgent doesn't just fire a single API call — it runs a **multi-step reasoning loop**:

1. Engine calls `getAction(state)`
2. Agent builds a system prompt with full battle state
3. **Agentic loop** (up to 5 iterations per turn):
   - Send messages + tools to LLM
   - **Observation tools** (free, loop continues): `inspect_self`, `inspect_enemy`, `review_spells`, `review_inventory`
   - **Action tools** (commits turn, loop ends): `attack`, `defend`, `cast_spell`, `use_item`, `wait`, `flee`
4. Returns the committed `CombatAction`

This gives the LLM time to "think" — inspect the battlefield before deciding.

## RPG Mechanics

### Classes
| Class | HP | MP | STR | DEF | MAG | SPD | LCK | Special |
|-------|----|----|-----|-----|-----|-----|-----|---------|
| **Warrior** | 120 | 30 | 18 | 15 | 5 | 10 | 8 | High physical damage |
| **Mage** | 70 | 100 | 5 | 7 | 22 | 12 | 10 | All 8 spells |
| **Rogue** | 85 | 50 | 14 | 9 | 8 | 22 | 18 | High crit + dodge |
| **Paladin** | 110 | 60 | 13 | 18 | 12 | 8 | 10 | Tanky healer |

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

## Quick Start

### Web UI — Human vs AI
```bash
npm run dev
# Frontend: http://localhost:3000 | Server: http://localhost:3001
```

### CLI — AI vs AI
```bash
# Quick mock battle (no API needed)
npm run battle:mock

# LLM vs LLM
LLM_API_KEY=sk-... npx tsx src/index.ts --mode llm

# LLM vs Mock AI
npm run battle:mixed

# Ollama (local, no key)
LLM_BASE_URL=http://localhost:11434/v1 npx tsx src/index.ts --mode llm --a1-model llama3
```

### Full CLI Options
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
│   ├── interface.ts      # IAgent — unified contract for all participants
│   ├── heuristic-agent.ts # Rule-based AI (instant decisions)
│   ├── llm-agent.ts      # LLM agent with agentic loop (observe → act)
│   ├── human-agent.ts    # Human player (Promise resolves on UI input)
│   └── index.ts          # Agent exports
├── tools/
│   └── definitions.ts    # Observation + action tool schemas
├── arena/
│   └── battle-runner.ts  # Battle orchestrator (uses IAgent only)
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

## Adding Your Own Agent

Implement the `IAgent` interface — that's it. The engine doesn't change:

```typescript
import { IAgent } from "./agent/interface.js";
import { BattleStateSnapshot, CombatAction } from "./engine/types.js";

export class MyCustomAgent implements IAgent {
  readonly type = "custom" as const;
  constructor(public readonly id: string, public readonly name: string) {}
  
  async getAction(state: BattleStateSnapshot): Promise<CombatAction> {
    // Your logic here — return a CombatAction
    const me = state.characters.find(c => c.id === this.id)!;
    const enemy = state.characters.find(c => c.id !== this.id)!;
    return { type: "attack", actorId: this.id, targetId: enemy.id };
  }
}
```

Drop it into the battle runner:
```typescript
const runner = new BattleRunner([char1, char2], [myAgent, heuristicAgent]);
await runner.run();
```

## License

MIT
