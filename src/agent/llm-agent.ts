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
import type { ThinkingStep } from "../engine/types.js";
import {
  BattleStateSnapshot,
  CombatAction,
  CombatResult,
} from "../engine/types.js";

// ── Config ──────────────────────────────────────────────

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

  /** Resolve a target name to a character snapshot (fuzzy: name, id, or "self") */
  private resolveTarget(nameOrId: string): BattleStateSnapshot["characters"][0] | undefined {
    const all = this.currentSnapshot?.characters ?? [];
    const lower = nameOrId.toLowerCase();
    return all.find(c => c.id === nameOrId || c.name.toLowerCase() === lower) ?? undefined;
  }

  /** Get all combatants except self */
  private others(): BattleStateSnapshot["characters"][0][] {
    return (this.currentSnapshot?.characters ?? []).filter(c => c.id !== this.id);
  }

  // Thinking step collection per turn
  private _pendingThinkingSteps: ThinkingStep[] = [];

  /** Callback for streaming thinking steps to UI */
  onThinking?: (step: ThinkingStep) => void;

  /** Get and clear accumulated thinking steps for the current turn */
  consumeThinkingSteps(): ThinkingStep[] {
    const steps = this._pendingThinkingSteps;
    this._pendingThinkingSteps = [];
    return steps;
  }

  /** Emit a thinking step to both the UI callback and internal buffer */
  private emitThinking(step: ThinkingStep): void {
    this._pendingThinkingSteps.push(step);
    this.onThinking?.(step);
  }

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

    // Debug: uncomment to trace LLM config
    // console.error(`[${this.name}] onBattleStart — ${modelId} @ ${baseUrl}`);

    const systemPrompt = this.buildSystemPrompt(me);
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
    // Capture params from toolcall_start (before execution)
    let pendingToolParams: Record<string, any> = {};
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
          const tc = sub.toolCall;
          const name = tc?.name || "?";
          toolCalls.push(name);
          // Store params for when tool_execution_start fires
          const args = tc?.arguments ?? tc?.params ?? tc?.input;
          if (args) {
            try {
              pendingToolParams[name] = typeof args === "string" ? JSON.parse(args) : args;
            } catch { pendingToolParams[name] = args; }
          }
        }
      } else if (t === "tool_execution_start") {
        const name = event.toolName;
        const params = event.args ?? event.toolParams ?? event.arguments ?? event.parameters ?? pendingToolParams[name] ?? undefined;
        toolCalls.push(name);
        this.emitThinking({
          type: "tool_call",
          text: `Using ${name}...`,
          toolName: name,
          toolParams: params,
        });
      } else if (t === "tool_execution_end") {
        // Extract meaningful text from result
        let resultText = event.isError ? "Error" : "";
        if (event.result) {
          try {
            const r = event.result;
            // pi tool results have { content: [{type:"text", text:"..."}] }
            if (r?.content?.[0]?.text) {
              resultText = r.content[0].text;
            } else if (typeof r === "string") {
              resultText = r;
            } else {
              resultText = JSON.stringify(r);
            }
          } catch {
            resultText = event.isError ? "Error" : "Done";
          }
        }
        if (!resultText) resultText = event.isError ? "Error" : "Done";
        this.emitThinking({
          type: "tool_result",
          text: resultText.length > 500 ? resultText.slice(0, 500) + "..." : resultText,
          toolName: event.toolName,
        });
      } else if (t === "turn_end") {
        if (thinkingBuf || toolCalls.length) {
          if (thinkingBuf.trim()) {
            this.emitThinking({
              type: "thinking",
              text: thinkingBuf.trim(),
            });
          }
        }
        thinkingBuf = "";
        toolCalls = [];
      } else if (t === "agent_end") {
        // thinking complete
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
        name: "inspect",
        label: "Inspect Combatant",
        description: "Get a combatant's visible stats: HP, MP, status effects, position.",
        promptSnippet: "Check a combatant's HP and status",
        parameters: Type.Object({
          name: Type.String({ description: "Character name to inspect (e.g. 'Alpha', 'Beta')" }),
        }),
        execute: async (_id: any, params: any) => {
          const target = this.resolveTarget(params.name);
          if (!target) {
            return { content: [{ type: "text" as const, text: `Unknown combatant: '${params.name}'. Available: ${this.currentSnapshot!.characters.map(c => c.name).join(', ')}` }], details: {} };
          }
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                name: target.name,
                hp: `${target.hp}/${target.maxHp}`,
                mp: `${target.mp}/${target.maxMp}`,
                hpPercent: Math.round((target.hp / target.maxHp) * 100),
                position: `(${target.position.x.toFixed(1)}, ${target.position.y.toFixed(1)})`,
                statusEffects: target.statusEffects,
                isDefending: target.isDefending,
              }, null, 2),
            }],
            details: {},
          };
        },
      },
      {
        name: "estimate_distance",
        label: "Estimate Distance",
        description: "Estimate distance to a target. Shows exact distance, melee range check, and which of your spells/items can reach.",
        promptSnippet: "Check distance to enemy and spell ranges",
        parameters: Type.Object({
          target: Type.String({ description: "Character name to measure distance to (e.g. 'Alpha', 'Beta')" }),
        }),
        execute: async (_id: any, params: any) => {
          const me = this.currentSnapshot!.characters.find((c) => c.id === this.id)!;
          const target = this.resolveTarget(params.target);
          if (!target) {
            return { content: [{ type: "text" as const, text: `Unknown combatant: '${params.target}'. Available: ${this.currentSnapshot!.characters.map(c => c.name).join(', ')}` }], details: {} };
          }
          const dx = me.position.x - target.position.x;
          const dy = me.position.y - target.position.y;
          const exactDist = Math.sqrt(dx * dx + dy * dy);
          // Add ±15% noise so it's a rough estimate, not exact
          const noise = 1 + (Math.random() * 0.3 - 0.15);
          const estimatedDist = Math.round(exactDist * noise * 10) / 10;
          const MELEE_RANGE = 1.5;
          const probablyInMelee = Math.abs(exactDist - MELEE_RANGE) < 0.5
            ? "maybe — hard to tell at this range"
            : exactDist <= MELEE_RANGE ? "yes" : "no";
          // Use estimated distance for range checks (agent doesn't know exact distance)
          const distForRange = estimatedDist;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                estimatedDistance: estimatedDist,
                direction: dx > 0 ? "to your left" : dx < 0 ? "to your right" : "same x",
                inMeleeRange: probablyInMelee,
                spellsProbablyInRange: me.spells
                  .filter((s) => s.currentCooldown === 0 && (s.target === "self" || distForRange <= s.range))
                  .map((s) => `${s.name} (~range ${s.range})`),
                spellsProbablyOutOfRange: me.spells
                  .filter((s) => s.target === "enemy" && (s.currentCooldown > 0 || distForRange > s.range))
                  .map((s) => `${s.name} (~range ${s.range}${s.currentCooldown > 0 ? `, cooldown ${s.currentCooldown}t` : ""})`),
              }, null, 2),
            }],
            details: {},
          };
        },
      },
      {
        name: "review_spells",
        label: "Review Spells",
        description: "List your available spells with full details: power, cost, cooldown, status effects.",
        promptSnippet: "Check which spells are ready and their properties",
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
                  description: s.description,
                  type: s.type,
                  target: s.target,
                  mpCost: s.mpCost,
                  basePower: s.basePower,
                  cooldown: s.cooldown,
                  cooldownRemaining: s.currentCooldown,
                  ready: s.currentCooldown === 0,
                  statusEffect: s.statusEffect || undefined,
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

      // ── Action tools (commit the turn — include optional move) ──
      {
        name: "attack",
        label: "Attack",
        description: "Basic melee attack. Range 1.5. Optionally move first by providing move_dx/move_dy.",
        promptSnippet: "Attack the enemy",
        parameters: Type.Object({
          target: Type.String({ description: "Character name to attack (e.g. 'Alpha', 'Beta')" }),
          move_dx: Type.Optional(Type.Number({ description: "Move this much in X before attacking (0 = no move)" })),
          move_dy: Type.Optional(Type.Number({ description: "Move this much in Y before attacking (0 = no move)" })),
        }),
        execute: async (_id: any, params: any) => {
          const t = this.resolveTarget(params.target);
          if (!t) return { content: [{ type: "text" as const, text: `Unknown combatant: '${params.target}'. Available: ${this.currentSnapshot!.characters.map(c => c.name).join(', ')}` }], details: {} };
          return this.commitAction({
            type: "attack",
            actorId: this.id,
            targetId: t.id,
            move: (params.move_dx || params.move_dy) ? { dx: params.move_dx || 0, dy: params.move_dy || 0 } : undefined,
          });
        },
      },
      {
        name: "defend",
        label: "Defend",
        description: "Raise your guard, reducing incoming damage this turn. Can move while defending.",
        promptSnippet: "Defend to reduce damage",
        parameters: Type.Object({
          move_dx: Type.Optional(Type.Number({ description: "Move this much in X before defending" })),
          move_dy: Type.Optional(Type.Number({ description: "Move this much in Y before defending" })),
        }),
        execute: async (_id: any, params: any) => this.commitAction({
          type: "defend",
          actorId: this.id,
          move: (params.move_dx || params.move_dy) ? { dx: params.move_dx || 0, dy: params.move_dy || 0 } : undefined,
        }),
      },
      {
        name: "cast_spell",
        label: "Cast Spell",
        description: "Cast a spell. Requires spell_id. Costs MP. Spell has a range — out of range = miss. Optionally move first.",
        promptSnippet: "Cast a spell (fire, ice, heal, etc.)",
        parameters: Type.Object({
          spell_id: Type.String({ description: "Spell ID to cast (e.g. fire, heal, shield)" }),
          target: Type.String({ description: "Character name to target (e.g. 'Alpha' to attack, or your own name to self-cast heal/shield)" }),
          move_dx: Type.Optional(Type.Number({ description: "Move this much in X before casting" })),
          move_dy: Type.Optional(Type.Number({ description: "Move this much in Y before casting" })),
        }),
        execute: async (_id: any, params: any) => {
          const t = this.resolveTarget(params.target);
          if (!t) return { content: [{ type: "text" as const, text: `Unknown combatant: '${params.target}'. Available: ${this.currentSnapshot!.characters.map(c => c.name).join(', ')}` }], details: {} };
          return this.commitAction({
            type: "cast_spell",
            actorId: this.id,
            targetId: t.id,
            spellId: params.spell_id,
            move: (params.move_dx || params.move_dy) ? { dx: params.move_dx || 0, dy: params.move_dy || 0 } : undefined,
          });
        },
      },
      {
        name: "use_item",
        label: "Use Item",
        description: "Use an item from inventory (health_potion, mana_potion, bomb, antidote, elixir). Bombs have range 6 and need a target name. Optionally move first.",
        promptSnippet: "Use an item from inventory",
        parameters: Type.Object({
          item_id: Type.String({ description: "Item ID to use (e.g. health_potion, mana_potion, bomb)" }),
          target: Type.Optional(Type.String({ description: "Target name for bombs (e.g. 'Alpha'). Omit for self-use items like potions." })),
          move_dx: Type.Optional(Type.Number({ description: "Move this much in X before using item" })),
          move_dy: Type.Optional(Type.Number({ description: "Move this much in Y before using item" })),
        }),
        execute: async (_id: any, params: any) => {
          // Resolve target for bombs, default to self for potions
          let targetId = this.id;
          if (params.target) {
            const t = this.resolveTarget(params.target);
            if (!t) return { content: [{ type: "text" as const, text: `Unknown combatant: '${params.target}'. Available: ${this.currentSnapshot!.characters.map(c => c.name).join(', ')}` }], details: {} };
            targetId = t.id;
          }
          return this.commitAction({
            type: "use_item",
            actorId: this.id,
            targetId,
            itemId: params.item_id,
            move: (params.move_dx || params.move_dy) ? { dx: params.move_dx || 0, dy: params.move_dy || 0 } : undefined,
          });
        },
      },
      {
        name: "wait",
        label: "Wait",
        description: "Do nothing this turn. Recover 8 MP. Can move while waiting.",
        promptSnippet: "Wait (skip turn)",
        parameters: Type.Object({
          move_dx: Type.Optional(Type.Number({ description: "Move this much in X" })),
          move_dy: Type.Optional(Type.Number({ description: "Move this much in Y" })),
        }),
        execute: async (_id: any, params: any) => this.commitAction({
          type: "wait",
          actorId: this.id,
          move: (params.move_dx || params.move_dy) ? { dx: params.move_dx || 0, dy: params.move_dy || 0 } : undefined,
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
  ): string {
    const others = this.others();
    const opponentList = others.map(c => c.name).join(', ');
    return `You are an expert RPG battle AI controlling ${me.name} (${this.config.characterClass}).
Your opponents: ${opponentList}

## ARENA & MOVEMENT
The battlefield is a 2D space. Position matters!
- All combatants have (x, y) positions. Distance affects whether attacks reach.
- Melee attacks require distance ≤ 1.5. Each spell has a range. Out-of-range actions MISS.
- Every turn you can MOVE AND ACT — both in the same turn.
- Movement happens BEFORE your action. So your post-move position determines range.
- Use move_dx/move_dy on any action tool. Positive dx = right, negative = left.
- Movement is clamped by your speed (roughly 2–4 units/turn depending on your speed stat).

### Movement Tactics:
- **Close in**: Move toward a target to get in range, then attack/spell. Example: move_dx=3 toward enemy, then melee attack.
- **Retreat**: Move AWAY after your action to make them waste their turn closing distance. Since you move first, you can move in close, act, and then the enemy still has to close on THEIR turn.
- **Strafe**: Move perpendicular (dy) to reposition while staying at spell range.
- **Kite**: If you're a ranged fighter, keep distance. Let the melee enemy waste turns chasing you.
- Use estimate_distance to check if you can reach a target before committing to an attack.

## TARGETING
- ALL action tools use character NAMES for targeting (e.g. 'Alpha', 'Beta').
- Self-cast spells: use your own name as the target — cast_spell(spell_id="heal", target="${me.name}")
- Attack: always needs a target name — attack(target="Beta")
- Bombs: need a target name — use_item(item_id="bomb", target="Beta")
- Potions: omit target (auto-targets self) — use_item(item_id="health_potion")

## TOOLS
You have two kinds of tools:

1. OBSERVATION TOOLS (free — call as many as you want before acting):
   - inspect_self: Your detailed stats (HP, MP, status effects, position)
   - inspect: Get any combatant's visible stats — inspect(name="Beta")
   - estimate_distance: Distance to a target + which spells/items are in range — estimate_distance(target="Beta")
   - review_spells: Your spells with cooldown status, range, and MP cost
   - review_inventory: Your usable items with quantities and range

2. ACTION TOOLS (commits your turn — call EXACTLY ONE):
   - attack, defend, cast_spell, use_item, wait, flee
   - ALL action tools accept optional move_dx and move_dy to reposition before acting.
   - Example: cast_spell(spell_id="fire", target="Beta", move_dx=2, move_dy=0) — moves 2 right, THEN casts fire at Beta from the new position.
   - Example: attack(target="Alpha", move_dx=-3, move_dy=0) — moves 3 left, THEN swings at Alpha if in melee range.
   - Example: cast_spell(spell_id="heal", target="${me.name}") — heals yourself.

## RULES
- First call observation tools to assess the situation, then call ONE action tool.
- You have LIMITED TIME. Observe quickly, then act decisively.
- Do NOT write explanations. Just call tools.
- If HP is low, heal or defend.
- If MP is low, use items or wait.
- Use status effects strategically.
- CHECK DISTANCE before attacking! Your move_dx/move_dy shifts you first, then range is checked from your new position.
- NEVER waste a turn: if out of range, include movement to close the gap. If too far even after moving, use a long-range spell or item instead of melee.

${this.config.systemPrompt || ""}`;
  }

  private buildTurnPrompt(snapshot: BattleStateSnapshot): string {
    const me = snapshot.characters.find((c) => c.id === this.id)!;
    const others = snapshot.characters.filter((c) => c.id !== this.id);

    const myStatus = me.statusEffects.length > 0
      ? me.statusEffects.map((e) => `${e.type}(${e.turnsRemaining}t)`).join(", ")
      : "None";

    // Build combatant lines
    const otherLines = others.map(c => {
      const status = c.statusEffects.length > 0
        ? c.statusEffects.map((e) => `${e.type}(${e.turnsRemaining}t)`).join(", ")
        : "None";
      const dx = c.position.x - me.position.x;
      const dy = c.position.y - me.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return `${c.name}: HP ${c.hp}/${c.maxHp} (${Math.round((c.hp / c.maxHp) * 100)}%) | Status: ${status} | pos(${c.position.x.toFixed(1)},${c.position.y.toFixed(1)}) dist=${dist.toFixed(1)}`;
    });

    const lastResult = this.lastResult
      ? `\nLast action result: ${this.lastResult}`
      : "";

    return `Turn ${snapshot.turnNumber}.
Your HP: ${me.hp}/${me.maxHp} (${Math.round((me.hp / me.maxHp) * 100)}%) | MP: ${me.mp}/${me.maxMp} | Status: ${myStatus}${me.hp < me.maxHp * 0.3 ? " ⚠️ CRITICAL!" : ""}
Position: you(${me.position.x.toFixed(1)},${me.position.y.toFixed(1)})
${otherLines.length > 0 ? otherLines.join("\n") : "No other combatants."}
Observe then act NOW.${lastResult}`;
  }

  private lastResult = "";

  // Track last result for next turn context
  onActionResult_(result: CombatResult): void {
    this.lastResult = result.narrative;
  }
}
