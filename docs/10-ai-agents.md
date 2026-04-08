# 10 — AI Agents

How characters are controlled — heuristic, LLM, boss, and human agents.

---

## Agent Interface

All agents implement `IAgent`:

```typescript
interface IAgent {
  type: "heuristic" | "llm" | "human" | "boss";
  id: string;
  name: string;
  getAction(snapshot: BattleStateSnapshot): Promise<CombatAction>;
  onBattleStart?(snapshot: BattleStateSnapshot): void;
  onBattleEnd?(winner?: string, reason?: string): void;
  onActionResult?(result: CombatResult): void;
  destroy(): void;
}
```

The `BattleRunner` calls `getAction()` and awaits the result — it doesn't
care whether the agent resolves in 1ms (heuristic), 2s (LLM), or 30s (human).

---

## Heuristic Agent

A rule-based AI that makes deterministic decisions based on character state.

### File: `src/agent/heuristic-agent.ts`

### Decision Priority

| Priority | Condition                         | Action                    |
|----------|-----------------------------------|---------------------------|
| 1        | HP < 40%, has Second Wind        | Second Wind               |
| 2        | HP < 30%, has Lay on Hands       | Lay on Hands              |
| 3        | HP < 30%, has Greater Potion     | Use Greater Health Potion |
| 4        | HP < 30%, has Health Potion      | Use Health Potion         |
| 5        | HP < 30%, has Elixir             | Use Elixir                |
| 6        | HP < 30%, 50% chance             | Defend                    |
| 7        | HP < 50%, has heal spell, 60% chance | Cast heal spell       |
| 8        | Target healthy, has bomb, in range, 40% chance | Use bomb     |
| 9        | Has spell slots, 70% chance      | Cast highest-level damage spell |
| 10       | Has cantrips, 60% chance         | Cast cantrip              |
| 11       | No slots, has cantrips, 70% chance | Cast cantrip           |
| 12       | Has Shield, not already shielded, 30% chance | Cast Shield   |
| 13       | Random 15% chance                | Defend                    |
| 14       | Out of melee range + normal move can't reach | Dash toward target |
| 15       | Default                          | Weapon attack with movement |

### Target Selection

- 70% chance: attack lowest-HP enemy
- 30% chance: attack random enemy

### Movement

- Attaches `moveToward()` to actions when distance > required range
- Uses Dash when target is beyond `speed + MELEE_RANGE`

### 5e Accuracy

The heuristic agent makes reasonable tactical decisions but doesn't follow
strict 5e action economy.  For example, it can cast Shield as an action
(in 5e, Shield is a reaction).  It doesn't use bonus actions or reactions.

---

## LLM Agent

An AI agent powered by a local LLM via OpenAI-compatible API.

### File: `src/agent/llm-agent.ts`

### Architecture

Uses the `@anthropic-ai/sdk` Agent SDK pattern:
1. Build system prompt with character info and rules
2. Build turn prompt with current battle state
3. Call `session.prompt()` — starts agentic loop
4. Agent calls observation tools (inspect_self, estimate_distance, etc.)
5. Agent calls ONE action tool (attack, cast_spell, etc.)
6. Action tool resolves the turn via `commitAction()`
7. Session is aborted to stop the agentic loop

### Tool System

#### Observation Tools (free, multiple calls)

| Tool              | Returns                              |
|-------------------|--------------------------------------|
| `inspect_self`    | Full stats, HP, AC, status, position |
| `inspect_enemy`   | Enemy stats, HP, AC, status, position |
| `estimate_distance` | Approximate distance, in-range spells |
| `review_spells`   | Spell list with cooldowns and readiness |
| `review_inventory` | Item list with quantities            |

#### Action Tools (commits turn)

| Tool          | Parameters             |
|---------------|------------------------|
| `attack`      | target                 |
| `defend`      | —                      |
| `cast_spell`  | spell_id, target       |
| `use_item`    | item_id                |
| `dash`        | target                 |
| `wait`        | —                      |
| `flee`        | —                      |

All action tools accept optional `move_dx` and `move_dy` for movement before
the action.

### Timeout

120-second turn timeout.  If the LLM doesn't commit an action, the agent
falls back to `attack` targeting the nearest enemy.

### LLM Configuration

```bash
# Default endpoint
LLM_BASE_URL=http://localhost:8008/v1

# API key (default: "no-key")
LLM_API_KEY=no-key

# Per-participant model selection
-p "Alice,warrior,team_a,llm,Gemma-4-26B-A4B-IQ4_XS"
```

---

## Boss Agent

### File: `src/agent/boss-agent.ts`

A specialized heuristic agent for boss encounters with boss-specific
priorities (big spells first, action surge management).

---

## Human Agent

### File: `src/agent/human-agent.ts`

A placeholder for interactive play.  Returns `wait` as a stub.

---

## Agent Factory

The tournament system uses an `agentFactory` to create agents:

```typescript
function agentFactory(id: string, name: string, model?: string): IAgent {
  if (model) return new LLMAgent(id, name, { baseURL, model });
  return new HeuristicAgent(id, name);
}
```

In test mode, all agents are `HeuristicAgent` regardless of model — this
allows testing the tournament system without a running LLM server.
