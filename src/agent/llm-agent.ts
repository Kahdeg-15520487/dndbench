// ─────────────────────────────────────────────────────────
//  LLM Agent — powered by pi's agent SDK
// ─────────────────────────────────────────────────────────
//
//  Uses pi's createAgentSession as the LLM runtime.
//  The agent has OBSERVATION tools (free, return data) and
//  ACTION tools (commit the turn). When an action tool fires,
//  we capture it and abort the session loop.
//
//  Flow per turn:
//    1. Engine calls getAction(state)
//    2. We session.prompt() with the battle state
//    3. Agent calls observation tools → data returned, loop continues
//    4. Agent calls an action tool → execute() resolves our Promise
//    5. We abort the session and return the CombatAction
// ─────────────────────────────────────────────────────────

import { Type } from "@sinclair/typebox";
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  SettingsManager,
  createExtensionRuntime,
  type AgentSession,
  type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { IAgent } from "./interface.js";
import {
  BattleStateSnapshot,
  CombatAction,
  CombatResult,
} from "../engine/types.js";

// ── Config ──────────────────────────────────────────────

export interface ThinkingStep {
  /** What the agent is doing */
  type: "thinking" | "tool_call" | "tool_result";
  /** Human-readable summary */
  text: string;
  /** Tool name (for tool_call / tool_result) */
  toolName?: string;
  /** Tool result summary (for tool_result) */
  toolResult?: string;
}

export interface LLMAgentConfig {
  id: string;
  name: string;
  characterClass: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  provider?: string;
  systemPrompt?: string;
  maxIterations?: number;
  /** Called during agentic loop to stream thinking steps to the UI */
  onThinking?: (step: ThinkingStep) => void;
}

// ── Minimal Resource Loader ─────────────────────────────

function makeResourceLoader(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

// ── Agent Class ─────────────────────────────────────────

export class LLMAgent implements IAgent {
  readonly type = "llm" as const;
  readonly id: string;
  readonly name: string;

  private config: LLMAgentConfig;
  private session: AgentSession | null = null;
  private turnCount = 0;

  // Turn state — resolved when action tool fires
  private actionResolve: ((action: CombatAction) => void) | null = null;
  private currentSnapshot: BattleStateSnapshot | null = null;
  private enemyId = "";

  // Thinking callback
  private onThinking?: (step: ThinkingStep) => void;

  constructor(config: LLMAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
    this.onThinking = config.onThinking;
  }

  // ── Lifecycle ───────────────────────────────────────

  async onBattleStart(state: BattleStateSnapshot): Promise<void> {
    this.turnCount = 0;
    this.currentSnapshot = state;

    const me = state.characters.find((c) => c.id === this.id)!;
    const enemy = state.characters.find((c) => c.id !== this.id)!;
    this.enemyId = enemy.id;

    // Register arena's own provider from DB config (not ~/.pi/agent/models.json)
    const providerName = `arena-${this.id}`;
    const modelId = this.config.model;
    const baseUrl = this.config.baseURL || "https://api.openai.com/v1";
    const apiKey = this.config.apiKey || "no-key";

    console.error(`[${this.name}] onBattleStart — ${modelId} @ ${baseUrl}`);

    const systemPrompt = this.buildSystemPrompt(me, enemy);
    const authStorage = AuthStorage.create();

    const modelRegistry = new (ModelRegistry as any)(authStorage);
    (modelRegistry as any).registerProvider(providerName, {
      baseUrl,
      api: "openai-completions",
      apiKey: this.config.apiKey || "no-key",
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
      models: [
        {
          id: modelId,
          name: `${this.name} (${modelId})`,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32768,
          maxTokens: 4096,
        },
      ],
    });

    // Set runtime API key so pi considers this provider "available"
    (authStorage as any).setRuntimeApiKey(providerName, this.config.apiKey || "no-key");

    const model = modelRegistry.find(providerName, modelId);
    if (!model) throw new Error(`Model not found: ${providerName}/${modelId}`);

    const tools = this.buildTools();

    const { session } = await createAgentSession({
      model,
      thinkingLevel: "off",
      authStorage,
      modelRegistry,
      resourceLoader: makeResourceLoader(systemPrompt),
      tools: [], // No built-in coding tools
      customTools: tools,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    });

    this.session = session;

    // Buffer streaming text, print summary after each turn
    let thinkingBuf = "";
    let toolCalls: string[] = [];
    session.subscribe((event: any) => {
      const t = event.type;
      if (t === "message_update") {
        const sub = event.assistantMessageEvent;
        if (sub.type === "thinking_delta") {
          thinkingBuf += sub.delta;
        }
        if (sub.type === "text_delta") {
          thinkingBuf += sub.delta;
        }
        if (sub.type === "toolcall_start") {
          const name = sub.toolCall?.name || "?";
          toolCalls.push(name);
          this.onThinking?.({
            type: "tool_call",
            text: `Calling ${name}...`,
            toolName: name,
          });
        }
      } else if (t === "tool_execution_start") {
        toolCalls.push(event.toolName);
        this.onThinking?.({
          type: "tool_call",
          text: `Using ${event.toolName}...`,
          toolName: event.toolName,
        });
      } else if (t === "tool_execution_end") {
        this.onThinking?.({
          type: "tool_result",
          text: event.isError ? "Error" : "Done",
          toolName: event.toolName,
        });
      } else if (t === "turn_end") {
        if (thinkingBuf || toolCalls.length) {
          const think = thinkingBuf.length > 120 ? thinkingBuf.slice(0, 120) + "…" : thinkingBuf;
          console.error(`[${this.name}] think: ${think || "(none)"} | tools: ${toolCalls.join(", ")}`);
          if (thinkingBuf.trim()) {
            this.onThinking?.({
              type: "thinking",
              text: thinkingBuf.trim().slice(0, 200),
            });
          }
        }
        thinkingBuf = "";
        toolCalls = [];
      } else if (t === "agent_end") {
        console.error(`[${this.name}] done`);
      }
    });
  }

  async getAction(snapshot: BattleStateSnapshot): Promise<CombatAction> {
    this.turnCount++;
    this.currentSnapshot = snapshot;

    // Default fallback
    const defaultAction: CombatAction = {
      type: "attack",
      actorId: this.id,
      targetId: this.enemyId,
    };

    if (!this.session) return defaultAction;

    try {
      const action = await new Promise<CombatAction>(async (resolve) => {
        this.actionResolve = resolve;

        // Prompt the agent — runs in background
        const promptText = this.buildTurnPrompt(snapshot);
        this.session!.prompt(promptText).catch((err) => {
          // Abort throws — that's fine if we already resolved
          if (this.actionResolve) {
            console.warn(`[${this.name}] Prompt error: ${err.message}`);
            resolve(defaultAction);
          }
        });
      });

      return action;
    } catch (err: any) {
      console.error(`[${this.name}] getAction error: ${err.message}`);
      return defaultAction;
    }
  }

  onActionResult(result: CombatResult): void {
    // Could feed result back to session via steer/followUp
    // For now, we include it in next turn's prompt
  }

  onBattleEnd(winner: string | undefined, reason: string): void {
    // Cleanup
  }

  destroy(): void {
    if (this.session) {
      this.session.abort().catch(() => {});
      this.session.dispose();
      this.session = null;
    }
    this.actionResolve = null;
  }

  // ── Tool Definitions ────────────────────────────────

  private buildTools() {
    return [
      // ── Observation tools (return data, loop continues) ──
      {
        name: "inspect_self",
        label: "Inspect Self",
        description: "Get your detailed stats: HP, MP, status effects, defending state.",
        promptSnippet: "Check your own HP, MP, and status effects",
        parameters: Type.Object({}),
        execute: async () => {
          const me = this.currentSnapshot!.characters.find((c) => c.id === this.id)!;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                name: me.name,
                hp: `${me.hp}/${me.maxHp}`,
                mp: `${me.mp}/${me.maxMp}`,
                hpPercent: Math.round((me.hp / me.maxHp) * 100),
                mpPercent: Math.round((me.mp / me.maxMp) * 100),
                isDefending: me.isDefending,
                statusEffects: me.statusEffects,
              }, null, 2),
            }],
            details: {},
          };
        },
      },
      {
        name: "inspect_enemy",
        label: "Inspect Enemy",
        description: "Get enemy's visible stats: HP, MP, status effects.",
        promptSnippet: "Check enemy HP, status effects",
        parameters: Type.Object({}),
        execute: async () => {
          const enemy = this.currentSnapshot!.characters.find((c) => c.id !== this.id)!;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                name: enemy.name,
                hp: `${enemy.hp}/${enemy.maxHp}`,
                mp: `${enemy.mp}/${enemy.maxMp}`,
                hpPercent: Math.round((enemy.hp / enemy.maxHp) * 100),
                statusEffects: enemy.statusEffects,
                isDefending: enemy.isDefending,
              }, null, 2),
            }],
            details: {},
          };
        },
      },
      {
        name: "review_spells",
        label: "Review Spells",
        description: "List your available spells with cooldown status and MP cost.",
        promptSnippet: "Check which spells are ready and their costs",
        parameters: Type.Object({}),
        execute: async () => {
          const me = this.currentSnapshot!.characters.find((c) => c.id === this.id)!;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(
                me.spells.map((s) => ({
                  id: s.id,
                  name: s.name,
                  type: s.type,
                  mpCost: s.mpCost,
                  ready: s.currentCooldown === 0,
                  cooldownRemaining: s.currentCooldown,
                })),
                null,
                2
              ),
            }],
            details: {},
          };
        },
      },
      {
        name: "review_inventory",
        label: "Review Inventory",
        description: "List your usable items with remaining quantities.",
        promptSnippet: "Check your available items",
        parameters: Type.Object({}),
        execute: async () => {
          const me = this.currentSnapshot!.characters.find((c) => c.id === this.id)!;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(
                me.inventory.filter((i) => i.quantity > 0),
                null,
                2
              ),
            }],
            details: {},
          };
        },
      },

      // ── Action tools (commit the turn) ──
      {
        name: "attack",
        label: "Attack",
        description: "Basic physical attack against the enemy. Reliable, no MP cost.",
        promptSnippet: "Attack the enemy",
        parameters: Type.Object({}),
        execute: async () => this.commitAction({
          type: "attack",
          actorId: this.id,
          targetId: this.enemyId,
        }),
      },
      {
        name: "defend",
        label: "Defend",
        description: "Raise your guard, reducing incoming damage this turn.",
        promptSnippet: "Defend to reduce damage",
        parameters: Type.Object({}),
        execute: async () => this.commitAction({
          type: "defend",
          actorId: this.id,
        }),
      },
      {
        name: "cast_spell",
        label: "Cast Spell",
        description: "Cast a spell. Requires spell_id. Costs MP.",
        promptSnippet: "Cast a spell (fire, ice, heal, etc.)",
        parameters: Type.Object({
          spell_id: Type.String({ description: "Spell ID to cast (e.g. fire, heal, shield)" }),
          target: Type.Optional(Type.String({
            description: '"self" for self-target spells, omit for enemy (default)',
            enum: ["self", "enemy"],
          })),
        }),
        execute: async (_id: any, params: any) => this.commitAction({
          type: "cast_spell",
          actorId: this.id,
          targetId: params.target === "self" ? this.id : this.enemyId,
          spellId: params.spell_id,
        }),
      },
      {
        name: "use_item",
        label: "Use Item",
        description: "Use an item from your inventory (health_potion, mana_potion, bomb, antidote, elixir).",
        promptSnippet: "Use an item from inventory",
        parameters: Type.Object({
          item_id: Type.String({ description: "Item ID to use (e.g. health_potion, mana_potion, bomb)" }),
        }),
        execute: async (_id: any, params: any) => this.commitAction({
          type: "use_item",
          actorId: this.id,
          itemId: params.item_id,
        }),
      },
      {
        name: "wait",
        label: "Wait",
        description: "Do nothing this turn. Cooldowns still tick.",
        promptSnippet: "Wait (skip turn)",
        parameters: Type.Object({}),
        execute: async () => this.commitAction({
          type: "wait",
          actorId: this.id,
        }),
      },
      {
        name: "flee",
        label: "Flee",
        description: "Attempt to flee the battle. Success depends on your speed vs enemy. You lose if it fails.",
        promptSnippet: "Try to flee the battle",
        parameters: Type.Object({}),
        execute: async () => this.commitAction({
          type: "flee",
          actorId: this.id,
        }),
      },
    ];
  }

  /** Called by action tool execute() — resolves the turn Promise and aborts the session */
  private async commitAction(action: CombatAction) {
    // Resolve the Promise in getAction()
    if (this.actionResolve) {
      const resolve = this.actionResolve;
      this.actionResolve = null;
      resolve(action);
    }

    // Abort the session to stop further processing
    // Use setImmediate to let the tool result return first
    setImmediate(() => {
      this.session?.abort().catch(() => {});
    });

    return {
      content: [{ type: "text" as const, text: `Action committed: ${action.type}` }],
      details: { action },
    };
  }

  // ── Prompt Building ─────────────────────────────────

  private buildSystemPrompt(
    me: BattleStateSnapshot["characters"][0],
    enemy: BattleStateSnapshot["characters"][0]
  ): string {
    return `You are an expert RPG battle AI controlling ${me.name} (${this.config.characterClass}).
Your opponent is ${enemy.name}.

## TOOLS
You have two kinds of tools:

1. OBSERVATION TOOLS (free — call as many as you want before acting):
   - inspect_self: Your detailed stats (HP, MP, status effects)
   - inspect_enemy: Enemy's visible stats
   - review_spells: Your spells with cooldown status and MP cost
   - review_inventory: Your usable items with quantities

2. ACTION TOOLS (commits your turn — call EXACTLY ONE):
   - attack, defend, cast_spell, use_item, wait, flee

## RULES
- First call observation tools to assess the situation, then call ONE action tool.
- You have LIMITED TIME. Observe quickly, then act decisively.
- Do NOT write explanations. Just call tools.
- If HP is low, heal or defend.
- If MP is low, use items or wait.
- Use status effects strategically.

${this.config.systemPrompt || ""}`;
  }

  private buildTurnPrompt(snapshot: BattleStateSnapshot): string {
    const me = snapshot.characters.find((c) => c.id === this.id)!;
    const enemy = snapshot.characters.find((c) => c.id !== this.id)!;

    const myStatus = me.statusEffects.length > 0
      ? me.statusEffects.map((e) => `${e.type}(${e.turnsRemaining}t)`).join(", ")
      : "None";
    const enemyStatus = enemy.statusEffects.length > 0
      ? enemy.statusEffects.map((e) => `${e.type}(${e.turnsRemaining}t)`).join(", ")
      : "None";

    const lastResult = this.lastResult
      ? `\nLast action result: ${this.lastResult}`
      : "";

    return `Turn ${snapshot.turnNumber}.
Your HP: ${me.hp}/${me.maxHp} (${Math.round((me.hp / me.maxHp) * 100)}%) | MP: ${me.mp}/${me.maxMp} | Status: ${myStatus}${me.hp < me.maxHp * 0.3 ? " ⚠️ CRITICAL!" : ""}
Enemy HP: ${enemy.hp}/${enemy.maxHp} (${Math.round((enemy.hp / enemy.maxHp) * 100)}%) | Status: ${enemyStatus}
Observe then act NOW.${lastResult}`;
  }

  private lastResult = "";

  // Track last result for next turn context
  onActionResult_(result: CombatResult): void {
    this.lastResult = result.narrative;
  }
}
