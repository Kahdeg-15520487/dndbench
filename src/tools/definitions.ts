// ─────────────────────────────────────────────────────────
//  Tool Definitions — the actions LLM agents can call
// ─────────────────────────────────────────────────────────

import { ToolDefinition } from "../engine/types.js";

export const TOOLS: ToolDefinition[] = [
  {
    name: "attack",
    description:
      "Perform a basic physical attack on the enemy. Damage scales with Strength. Can crit based on Luck. Can be dodged by fast enemies.",
    parameters: {
      target: {
        type: "string",
        description: "The enemy character to attack.",
        required: true,
      },
    },
  },
  {
    name: "defend",
    description:
      "Take a defensive stance for this turn. Greatly increases Defense, reducing incoming physical damage. The buff lasts until your next turn.",
    parameters: {},
  },
  {
    name: "cast_spell",
    description:
      "Cast a spell. Requires sufficient MP and the spell must not be on cooldown. Spells can deal damage, heal, buff, or debuff. Check your available spells and their costs carefully.",
    parameters: {
      spell_id: {
        type: "string",
        description: "The spell to cast.",
        enum: [
          "fire",
          "ice",
          "lightning",
          "heal",
          "shield",
          "poison",
          "drain",
          "meteor",
        ],
        required: true,
      },
      target: {
        type: "string",
        description:
          "Target for the spell. Use 'self' for healing/buff spells, or the enemy name for damage/debuff spells.",
        required: true,
      },
    },
  },
  {
    name: "use_item",
    description:
      "Use an item from your inventory. Items have limited quantities. Health Potions restore HP, Mana Potions restore MP, Bombs deal damage, Elixirs fully restore, Antidotes cure status effects.",
    parameters: {
      item_id: {
        type: "string",
        description: "The item to use.",
        enum: [
          "health_potion",
          "mana_potion",
          "antidote",
          "bomb",
          "elixir",
        ],
        required: true,
      },
    },
  },
  {
    name: "wait",
    description:
      "Wait and recover a small amount of MP (8 MP). Useful when conserving resources or waiting for cooldowns.",
    parameters: {},
  },
  {
    name: "flee",
    description:
      "Attempt to flee the battle. Success chance is based on your Speed stat (30-50%). If you flee, you lose the battle. Use only as a last resort.",
    parameters: {},
  },
];

/**
 * Format the tools in OpenAI function-calling format
 */
export function getOpenAITools() {
  return TOOLS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object" as const,
        properties: tool.parameters,
        required: Object.entries(tool.parameters)
          .filter(([, v]) => v.required)
          .map(([k]) => k),
      },
    },
  }));
}

/**
 * Format tools in Anthropic tool-use format
 */
export function getAnthropicTools() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object" as const,
      properties: tool.parameters,
      required: Object.entries(tool.parameters)
        .filter(([, v]) => v.required)
        .map(([k]) => k),
    },
  }));
}
