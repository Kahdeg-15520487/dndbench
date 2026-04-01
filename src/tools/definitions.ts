// ─────────────────────────────────────────────────────────
//  Tool Definitions — observation + action tools
// ─────────────────────────────────────────────────────────

import { ToolDefinition } from "../engine/types.js";

// ── Observation Tools (free, callable multiple times) ───

const OBSERVATION_TOOLS: ToolDefinition[] = [
  {
    name: "inspect_self",
    description:
      "Get your detailed stats: exact HP/MP percentages, status effects, defending state. Use this to assess your situation precisely.",
    parameters: {},
  },
  {
    name: "inspect_enemy",
    description:
      "Get the enemy's detailed stats: HP/MP percentages, active status effects, defending state. Useful for deciding whether to be aggressive.",
    parameters: {},
  },
  {
    name: "review_spells",
    description:
      "List all your spells with cooldown status and readiness. Helps you pick the right spell without wasting a turn on cooldown.",
    parameters: {},
  },
  {
    name: "review_inventory",
    description:
      "List your remaining items with quantities. Check this before using items to avoid wasting turns.",
    parameters: {},
  },
];

// ── Action Tools (commits your turn) ────────────────────

const ACTION_TOOLS: ToolDefinition[] = [
  {
    name: "attack",
    description:
      "ACTION: Basic physical attack on the enemy. Damage scales with Strength. Can crit (Luck). Can be dodged (Speed). Commits your turn.",
    parameters: {
      target: {
        type: "string",
        description: "The enemy to attack.",
        required: true,
      },
    },
  },
  {
    name: "defend",
    description:
      "ACTION: Defensive stance. Greatly increases Defense this turn. Lasts until your next turn. Commits your turn.",
    parameters: {},
  },
  {
    name: "cast_spell",
    description:
      "ACTION: Cast a spell (costs MP, may have cooldown). Damages, heals, buffs, or debuffs. Commits your turn.",
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
          "'self' for heal/buff spells, or enemy identifier for damage/debuff spells.",
        required: true,
      },
    },
  },
  {
    name: "use_item",
    description:
      "ACTION: Use a consumable item from inventory. Commits your turn.",
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
      "ACTION: Wait and recover 8 MP. Useful when conserving resources. Commits your turn.",
    parameters: {},
  },
  {
    name: "flee",
    description:
      "ACTION: Attempt to flee. Success chance based on Speed (30-50%). You lose if you flee. Last resort only. Commits your turn.",
    parameters: {},
  },
];

// ── All Tools Combined ──────────────────────────────────

export const ALL_TOOLS: ToolDefinition[] = [...OBSERVATION_TOOLS, ...ACTION_TOOLS];

// ── OpenAI Format ───────────────────────────────────────

function toOpenAIFormat(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
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
 * Full agentic toolset (observation + action) for the LLM agent loop.
 */
export function getAgenticTools() {
  return toOpenAIFormat(ALL_TOOLS);
}

/**
 * Action-only tools (no observation) — used by the old single-shot mode
 * or anywhere that only needs the combat actions.
 */
export function getActionTools() {
  return toOpenAIFormat(ACTION_TOOLS);
}
