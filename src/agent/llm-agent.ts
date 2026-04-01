// ─────────────────────────────────────────────────────────
//  LLM Agent — connects to OpenAI/Anthropic to make battle decisions
// ─────────────────────────────────────────────────────────

import OpenAI from "openai";
import {
  AgentConfig,
  BattleStateSnapshot,
  CombatAction,
  ToolCall,
  ToolDefinition,
} from "../engine/types.js";
import { getOpenAITools } from "../tools/definitions.js";

// ── System Prompt Builder ───────────────────────────────

function buildSystemPrompt(
  config: AgentConfig,
  snapshot: BattleStateSnapshot
): string {
  const me = snapshot.characters.find((c) => c.id === config.character.id)!;
  const enemy = snapshot.characters.find((c) => c.id !== config.character.id)!;

  return `You are an RPG battle AI controlling ${me.name}, a skilled ${config.character.class}.
Your opponent is ${enemy.name}.

## YOUR CURRENT STATUS
- HP: ${me.hp}/${me.maxHp} ${me.hp < me.maxHp * 0.3 ? "⚠️ LOW HP!" : ""}
- MP: ${me.mp}/${me.maxMp}
- Status Effects: ${me.statusEffects.length > 0 ? me.statusEffects.map((e) => e.type + ` (${e.turnsRemaining} turns)`).join(", ") : "None"}
- Defending: ${me.isDefending}

## AVAILABLE SPELLS
${me.spells.map((s) => `- ${s.name} (id: ${s.id}): ${s.currentCooldown > 0 ? `⏳ Cooldown: ${s.currentCooldown} turns` : "Ready"} | Cost: variable MP`).join("\n")}

## INVENTORY
${me.inventory.length > 0 ? me.inventory.map((i) => `- ${i.name} (id: ${i.id}): ${i.quantity} remaining`).join("\n") : "No items remaining"}

## ENEMY STATUS
- ${enemy.name}: ${enemy.hp}/${enemy.maxHp} HP, ${enemy.mp}/${enemy.maxMp} MP
- Enemy Status Effects: ${enemy.statusEffects.length > 0 ? enemy.statusEffects.map((e) => e.type).join(", ") : "None"}

## STRATEGY GUIDELINES
- If HP is low, consider healing or using Health Potions
- If MP is low, consider using Wait or Mana Potions
- Watch spell cooldowns — don't waste turns trying unavailable spells
- Use status effects strategically (poison for attrition, freeze to deny turns)
- Defend when you expect a big hit
- Conserve your Elixir for critical moments
- Be aggressive when the enemy is weak

## RULES
- Choose EXACTLY ONE action by calling the appropriate tool
- Be strategic and unpredictable — don't always do the same thing
- Respond with a tool call, not text

${config.systemPrompt || ""}`;
}

// ── OpenAI Agent ────────────────────────────────────────

export class LLMAgent {
  private config: AgentConfig;
  private client: OpenAI | null = null;
  private conversationHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  private turnCount = 0;

  constructor(config: AgentConfig) {
    this.config = config;

    if (config.provider === "openai-compatible") {
      this.client = new OpenAI({
        apiKey: config.apiKey || process.env.LLM_API_KEY || "sk-placeholder",
        baseURL: config.baseURL || process.env.LLM_BASE_URL || "https://api.openai.com/v1",
      });
    }
  }

  /**
   * Get the next action from the LLM
   */
  async getAction(snapshot: BattleStateSnapshot): Promise<CombatAction> {
    this.turnCount++;

    if (this.config.provider === "mock") {
      return this.getMockAction(snapshot);
    }

    if (!this.client) {
      throw new Error(`Provider ${this.config.provider} not configured`);
    }

    const systemPrompt = buildSystemPrompt(this.config, snapshot);

    // Reset conversation every 5 turns to avoid context bloat
    if (this.turnCount % 5 === 1) {
      this.conversationHistory = [
        { role: "system", content: systemPrompt },
      ];
    } else {
      this.conversationHistory[0] = { role: "system", content: systemPrompt };
    }

    // Add the current state as user message
    this.conversationHistory.push({
      role: "user",
      content: `Turn ${snapshot.turnNumber}. What is your action?`,
    });

    try {
      const tools = getOpenAITools();
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: this.conversationHistory,
        tools,
        tool_choice: "auto",
        temperature: 0.8, // some creativity
        max_tokens: 200,
      });

      const message = response.choices[0]?.message;
      if (!message) throw new Error("No response from LLM");

      this.conversationHistory.push(message);

      // Extract tool call
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const args = JSON.parse(toolCall.function.arguments || "{}");
        return this.toolCallToAction(
          toolCall.function.name,
          args,
          snapshot
        );
      }

      // Fallback: if no tool call, default to attack
      console.warn(
        `[${this.config.name}] No tool call received, defaulting to attack`
      );
      return {
        type: "attack",
        actorId: this.config.character.id,
        targetId: this.getEnemyId(snapshot),
      };
    } catch (error: any) {
      console.error(
        `[${this.config.name}] LLM error: ${error.message}. Defaulting to attack.`
      );
      return {
        type: "attack",
        actorId: this.config.character.id,
        targetId: this.getEnemyId(snapshot),
      };
    }
  }

  /**
   * Add the result of the last action to conversation history
   */
  addResult(narrative: string): void {
    this.conversationHistory.push({
      role: "tool",
      content: narrative,
      tool_call_id: "result",
    } as any);
  }

  // ── Helpers ─────────────────────────────────────────

  private getEnemyId(snapshot: BattleStateSnapshot): string {
    return snapshot.characters.find(
      (c) => c.id !== this.config.character.id
    )!.id;
  }

  private toolCallToAction(
    toolName: string,
    args: Record<string, any>,
    snapshot: BattleStateSnapshot
  ): CombatAction {
    const actorId = this.config.character.id;
    const targetId = this.getEnemyId(snapshot);

    switch (toolName) {
      case "attack":
        return { type: "attack", actorId, targetId };
      case "defend":
        return { type: "defend", actorId };
      case "cast_spell":
        return {
          type: "cast_spell",
          actorId,
          targetId: args.target === "self" ? actorId : targetId,
          spellId: args.spell_id,
        };
      case "use_item":
        return {
          type: "use_item",
          actorId,
          itemId: args.item_id,
        };
      case "wait":
        return { type: "wait", actorId };
      case "flee":
        return { type: "flee", actorId };
      default:
        return { type: "attack", actorId, targetId };
    }
  }

  /**
   * Simple mock agent for testing (no LLM API needed)
   */
  private getMockAction(snapshot: BattleStateSnapshot): CombatAction {
    const me = snapshot.characters.find(
      (c) => c.id === this.config.character.id
    )!;
    const enemy = snapshot.characters.find(
      (c) => c.id !== this.config.character.id
    )!;
    const actorId = this.config.character.id;

    // Simple heuristic AI
    if (me.hp < me.maxHp * 0.3) {
      // Low HP — heal
      const healSpell = me.spells.find(
        (s) => s.id === "heal" && s.currentCooldown === 0
      );
      if (healSpell && me.mp >= 15) {
        return { type: "cast_spell", actorId, targetId: actorId, spellId: "heal" };
      }
      const potion = me.inventory.find(
        (i) => i.id === "health_potion" && i.quantity > 0
      );
      if (potion) {
        return { type: "use_item", actorId, itemId: "health_potion" };
      }
    }

    // Use bomb if enemy is high HP
    const bomb = me.inventory.find((i) => i.id === "bomb" && i.quantity > 0);
    if (bomb && enemy.hp > enemy.maxHp * 0.5 && Math.random() > 0.6) {
      return { type: "use_item", actorId, itemId: "bomb" };
    }

    // Cast a damage spell
    const dmgSpells = me.spells.filter(
      (s) =>
        (s.type === "damage" || s.type === "drain") &&
        s.currentCooldown === 0 &&
        me.mp >= s.mpCost
    );
    if (dmgSpells.length > 0 && Math.random() > 0.3) {
      const spell = dmgSpells[Math.floor(Math.random() * dmgSpells.length)];
      return {
        type: "cast_spell",
        actorId,
        targetId: enemy.id,
        spellId: spell.id,
      };
    }

    // Defend sometimes
    if (Math.random() > 0.8) {
      return { type: "defend", actorId };
    }

    // Default: attack
    return { type: "attack", actorId, targetId: enemy.id };
  }
}
