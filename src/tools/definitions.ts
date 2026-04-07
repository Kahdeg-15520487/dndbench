// ─────────────────────────────────────────────────────────
//  Tool Definitions — observation + action tools
// ─────────────────────────────────────────────────────────

import { ToolDefinition } from "../engine/types.js";

// ── Observation Tools (free, callable multiple times) ───

const OBSERVATION_TOOLS: ToolDefinition[] = [
  {
    name: "inspect_self",
    description:
      "Get your detailed stats: exact HP/MP percentages, status effects, defending state, position. Use this to assess your situation precisely.",
    parameters: {},
  },
  {
    name: "inspect_enemy",
    description:
      "Get the enemy's detailed stats: HP/MP percentages, active status effects, defending state, position. Useful for deciding whether to be aggressive.",
    parameters: {},
  },
  {
    name: "estimate_distance",
    description:
      "ROUGHLY estimate the distance to a target entity. Not exact — has ±15% margin. Returns approximate distance, direction, whether the target is likely in melee range, and which spells probably can/can't reach. Essential for deciding whether to move closer before attacking.",
    parameters: {
      target: {
        type: "string",
        description: "The entity to measure distance to (e.g. 'enemy').",
        required: true,
      },
    },
  },
  {
    name: "review_spells",
    description:
      "List all your spells with cooldown status, readiness, and range. Helps you pick the right spell without wasting a turn on cooldown.",
    parameters: {},
  },
  {
    name: "review_inventory",
    description:
      "List your remaining items with quantities and range. Check this before using items to avoid wasting turns.",
    parameters: {},
  },
];

// ── Action Tools (commits your turn) ────────────────────

const ACTION_TOOLS: ToolDefinition[] = [
  {
    name: "attack",
    description:
      "ACTION: Melee weapon attack. d20 + STR modifier vs target AC. Must be within melee range (5ft). Commits your turn.",
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
      "ACTION: Defensive stance. +2 AC until your next turn. Commits your turn.",
    parameters: {},
  },
  {
    name: "cast_spell",
    description:
      "ACTION: Cast a spell (uses a spell slot, or cantrip for free). Each spell has a range in feet — if enemy is out of range the spell fails. Commits your turn.",
    parameters: {
      spell_id: {
        type: "string",
        description: "The spell to cast.",
        enum: [
          "fire_bolt",
          "magic_missile",
          "shield",
          "thunderwave",
          "cure_wounds",
          "shield_of_faith",
          "scorching_ray",
          "hold_person",
          "fireball",
          "lightning_bolt",
        ],
        required: true,
      },
      target: {
        type: "string",
        description:
          "Name of the target character (e.g. 'Goblin King'). Use your own name for self-targeting spells (shield, cure_wounds, shield_of_faith).",
        required: true,
      },
    },
  },
  {
    name: "use_item",
    description:
      "ACTION: Use a consumable item from inventory. Bombs have range 20ft and need a target, other items are self-use. Commits your turn.",
    parameters: {
      item_id: {
        type: "string",
        description: "The item to use.",
        enum: [
          "health_potion",
          "greater_health_potion",
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
      "ACTION: Wait and do nothing. Useful when conserving resources or when no good option is available. Commits your turn.",
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
