// ─────────────────────────────────────────────────────────
//  LLM Agent — agentic loop with observe → think → act
// ─────────────────────────────────────────────────────────
//
//  The LLM can call **observation tools** (inspect_enemy, review_spells,
//  etc.) as many times as it wants before committing to an **action tool**.
//  This gives the LLM a proper reasoning chain instead of a single shot.
//
//  Flow per turn:
//    1. Engine calls getAction(state)
//    2. Agent builds system prompt from state
//    3. Agentic loop (up to MAX_ITERATIONS):
//       a. Send messages + tools to LLM
//       b. If observation tool call → execute, append result, continue
//       c. If action tool call → convert to CombatAction, return it
//       d. If no tool call → fallback to attack
//    4. Return action to engine
// ─────────────────────────────────────────────────────────

import OpenAI from "openai";
import { IAgent } from "./interface.js";
import {
  BattleStateSnapshot,
  CombatAction,
  CombatResult,
} from "../engine/types.js";
import { getAgenticTools } from "../tools/definitions.js";

// ── Config ──────────────────────────────────────────────

export interface LLMAgentConfig {
  id: string;
  name: string;
  characterClass: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  systemPrompt?: string;
  maxIterations?: number; // max tool-call rounds per turn (default: 5)
}

const DEFAULT_MAX_ITERATIONS = 5;

// ── Observation Tool Handlers ───────────────────────────
// These return text data to the LLM without consuming a turn.

type ObservationHandler = (
  args: Record<string, any>,
  state: BattleStateSnapshot,
  myId: string
) => string;

const observationHandlers: Record<string, ObservationHandler> = {
  inspect_self(_args, state, myId) {
    const me = state.characters.find((c) => c.id === myId)!;
    return JSON.stringify({
      name: me.name,
      hp: `${me.hp}/${me.maxHp}`,
      mp: `${me.mp}/${me.maxMp}`,
      hpPercent: Math.round((me.hp / me.maxHp) * 100),
      mpPercent: Math.round((me.mp / me.maxMp) * 100),
      isDefending: me.isDefending,
      statusEffects: me.statusEffects,
    }, null, 2);
  },

  inspect_enemy(_args, state, myId) {
    const enemy = state.characters.find((c) => c.id !== myId)!;
    return JSON.stringify({
      name: enemy.name,
      hp: `${enemy.hp}/${enemy.maxHp}`,
      mp: `${enemy.mp}/${enemy.maxMp}`,
      hpPercent: Math.round((enemy.hp / enemy.maxHp) * 100),
      statusEffects: enemy.statusEffects,
      isDefending: enemy.isDefending,
    }, null, 2);
  },

  review_spells(_args, state, myId) {
    const me = state.characters.find((c) => c.id === myId)!;
    return JSON.stringify(
      me.spells.map((s) => ({
        id: s.id,
        name: s.name,
        ready: s.currentCooldown === 0,
        cooldownRemaining: s.currentCooldown,
      })),
      null,
      2
    );
  },

  review_inventory(_args, state, myId) {
    const me = state.characters.find((c) => c.id === myId)!;
    return JSON.stringify(
      me.inventory.filter((i) => i.quantity > 0),
      null,
      2
    );
  },
};

// ── Agent Class ─────────────────────────────────────────

export class LLMAgent implements IAgent {
  readonly type = "llm" as const;

  private config: LLMAgentConfig;
  private client: OpenAI;
  private conversationHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  private turnCount = 0;
  private maxIterations: number;

  constructor(config: LLMAgentConfig) {
    this.config = config;
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.LLM_API_KEY || "sk-placeholder",
      baseURL: config.baseURL || process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    });
  }

  onBattleStart(state: BattleStateSnapshot): void {
    // Fresh conversation for each battle
    this.conversationHistory = [];
    this.turnCount = 0;
    const me = state.characters.find((c) => c.id === this.id)!;
    const enemy = state.characters.find((c) => c.id !== this.id)!;

    this.conversationHistory.push({
      role: "system",
      content: this.buildSystemPrompt(me, enemy),
    });
  }

  async getAction(snapshot: BattleStateSnapshot): Promise<CombatAction> {
    this.turnCount++;

    const me = snapshot.characters.find((c) => c.id === this.id)!;
    const enemy = snapshot.characters.find((c) => c.id !== this.id)!;

    // Update system prompt with latest state
    this.conversationHistory[0] = {
      role: "system",
      content: this.buildSystemPrompt(me, enemy),
    };

    // Prompt the LLM to think
    this.conversationHistory.push({
      role: "user",
      content: `Turn ${snapshot.turnNumber}. Analyze the situation and choose your action. You may inspect the battlefield first, then commit to an action.`,
    });

    try {
      return await this.agenticLoop(snapshot);
    } catch (error: any) {
      console.error(
        `[${this.name}] Agentic loop error: ${error.message}. Defaulting to attack.`
      );
      return {
        type: "attack",
        actorId: this.id,
        targetId: enemy.id,
      };
    }
  }

  onActionResult(result: CombatResult): void {
    // Add the narrative to conversation so the LLM remembers what happened
    this.conversationHistory.push({
      role: "user",
      content: `Last action result: ${result.narrative}`,
    });
  }

  onBattleEnd(winner: string | undefined, reason: string): void {
    const won = winner === this.id;
    this.conversationHistory.push({
      role: "user",
      content: `Battle over! ${reason}. ${won ? "You won!" : "You lost."}`,
    });
  }

  destroy(): void {
    this.conversationHistory = [];
  }

  // ── Agentic Loop ────────────────────────────────────

  private async agenticLoop(snapshot: BattleStateSnapshot): Promise<CombatAction> {
    const tools = getAgenticTools();
    const enemyId = snapshot.characters.find((c) => c.id !== this.id)!.id;

    for (let i = 0; i < this.maxIterations; i++) {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: this.conversationHistory,
        tools,
        tool_choice: "auto",
        temperature: 0.8,
        max_tokens: 300,
      });

      const message = response.choices[0]?.message;
      if (!message) throw new Error("No response from LLM");

      this.conversationHistory.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        // No tool call — LLM just talked. Prompt again.
        this.conversationHistory.push({
          role: "user",
          content: "Please use one of the available tools to take your action.",
        });
        continue;
      }

      // Process all tool calls in this round
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || "{}");

        // Is it an observation tool?
        if (toolName in observationHandlers) {
          const result = observationHandlers[toolName](args, snapshot, this.id);
          this.conversationHistory.push({
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          });
          // Continue the loop — LLM can observe more or commit to action
          continue;
        }

        // It's an action tool — commit and return
        this.conversationHistory.push({
          role: "tool",
          content: `Action committed: ${toolName}`,
          tool_call_id: toolCall.id,
        });

        return this.toolCallToAction(toolName, args, enemyId);
      }
    }

    // Max iterations reached — fallback to attack
    console.warn(
      `[${this.name}] Max iterations (${this.maxIterations}) reached. Defaulting to attack.`
    );
    return { type: "attack", actorId: this.id, targetId: enemyId };
  }

  // ── System Prompt ───────────────────────────────────

  private buildSystemPrompt(
    me: BattleStateSnapshot["characters"][0],
    enemy: BattleStateSnapshot["characters"][0]
  ): string {
    return `You are an expert RPG battle AI controlling ${me.name} (${this.config.characterClass}).
Your opponent is ${enemy.name}.

## BATTLE STATE
Your HP: ${me.hp}/${me.maxHp} (${Math.round((me.hp / me.maxHp) * 100)}%) ${me.hp < me.maxHp * 0.3 ? "⚠️ CRITICAL!" : ""}
Your MP: ${me.mp}/${me.maxMp}
Your Status: ${me.statusEffects.length > 0 ? me.statusEffects.map((e) => `${e.type} (${e.turnsRemaining}t)`).join(", ") : "None"}
Enemy HP: ${enemy.hp}/${enemy.maxHp} (${Math.round((enemy.hp / enemy.maxHp) * 100)}%)
Enemy Status: ${enemy.statusEffects.length > 0 ? enemy.statusEffects.map((e) => `${e.type} (${e.turnsRemaining}t)`).join(", ") : "None"}

## AVAILABLE TOOLS
You have TWO kinds of tools:

1. OBSERVATION TOOLS (free — call as many as you want before acting):
   - inspect_self: Your detailed stats (HP, MP, status effects)
   - inspect_enemy: Enemy's detailed stats
   - review_spells: Your spells with cooldown status
   - review_inventory: Your usable items with quantities

2. ACTION TOOLS (commits your turn — call EXACTLY ONE):
   - attack, defend, cast_spell, use_item, wait, flee

## STRATEGY
- Use observation tools first to assess the situation
- If HP is low, heal or defend
- If MP is low, wait or use mana potions
- Watch spell cooldowns — don't try unavailable spells
- Use status effects strategically (poison for attrition, freeze to deny turns)
- Be unpredictable — don't always do the same thing

${this.config.systemPrompt || ""}`;
  }

  // ── Tool Call → Action ──────────────────────────────

  private toolCallToAction(
    toolName: string,
    args: Record<string, any>,
    enemyId: string
  ): CombatAction {
    switch (toolName) {
      case "attack":
        return { type: "attack", actorId: this.id, targetId: enemyId };
      case "defend":
        return { type: "defend", actorId: this.id };
      case "cast_spell":
        return {
          type: "cast_spell",
          actorId: this.id,
          targetId: args.target === "self" ? this.id : enemyId,
          spellId: args.spell_id,
        };
      case "use_item":
        return { type: "use_item", actorId: this.id, itemId: args.item_id };
      case "wait":
        return { type: "wait", actorId: this.id };
      case "flee":
        return { type: "flee", actorId: this.id };
      default:
        return { type: "attack", actorId: this.id, targetId: enemyId };
    }
  }
}
