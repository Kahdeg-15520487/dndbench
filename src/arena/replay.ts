// ─────────────────────────────────────────────────────────
//  Replay — generates markdown battle reports
// ─────────────────────────────────────────────────────────

import type { BattleLog, Character } from "../engine/types.js";
import type { IAgent } from "../agent/interface.js";
import fs from "fs";
import path from "path";

// ── Public API ──────────────────────────────────────────

export interface ReplayMeta {
  agents: { id: string; name: string; type: string; characterClass: string; model?: string }[];
}

/**
 * Generate a markdown replay from a BattleLog and write to disk.
 * Returns the output path.
 */
export function saveReplay(
  log: BattleLog,
  characters: Character[],
  agents: IAgent[],
  replayDir = "replays"
): string {
  const md = renderMarkdown(log, characters, agents);
  const filePath = buildPath(log, characters, agents, replayDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, md, "utf-8");
  return filePath;
}

// ── Markdown Renderer ───────────────────────────────────

function renderMarkdown(
  log: BattleLog,
  characters: Character[],
  agents: IAgent[]
): string {
  const lines: string[] = [];
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const charMap = new Map(characters.map((c) => [c.id, c]));

  const a1 = characters[0];
  const a2 = characters[1];
  const ag1 = agentMap.get(a1.id);
  const ag2 = agentMap.get(a2.id);
  const matchup = `${a1.name} (${a1.class}) vs ${a2.name} (${a2.class})`;
  const winner = log.winner ? charMap.get(log.winner)?.name ?? log.winner : "Draw";

  // ── Header ──
  lines.push(`# ⚔️ ${matchup}`);
  lines.push("");
  lines.push(`| | ${a1.name} | ${a2.name} |`);
  lines.push(`|---|---|---|`);
  lines.push(`| **Class** | ${a1.class} | ${a2.class} |`);
  lines.push(`| **Agent** | ${agentLabel(ag1)} | ${agentLabel(ag2)} |`);
  lines.push(`| **HP** | ${a1.stats.hp}/${a1.stats.maxHp} | ${a2.stats.hp}/${a2.stats.maxHp} |`);
  lines.push(`| **MP** | ${a1.stats.mp}/${a1.stats.maxMp} | ${a2.stats.mp}/${a2.stats.maxMp} |`);
  lines.push(`| **STR/DEF/MAG/SPD/LCK** | ${a1.stats.strength}/${a1.stats.defense}/${a1.stats.magic}/${a1.stats.speed}/${a1.stats.luck} | ${a2.stats.strength}/${a2.stats.defense}/${a2.stats.magic}/${a2.stats.speed}/${a2.stats.luck} |`);
  lines.push("");
  lines.push(`- **Winner**: ${winner}`);
  lines.push(`- **Turns**: ${log.totalTurns}`);
  lines.push(`- **Started**: ${log.startTime}`);
  lines.push(`- **Ended**: ${log.endTime ?? "N/A"}`);
  lines.push("");

  // ── Turn-by-turn ──
  lines.push("---");
  lines.push("");
  lines.push("## Turn-by-Turn Replay");
  lines.push("");

  for (const turn of log.turns) {
    for (const result of turn.results) {
      const actor = charMap.get(result.actorId);
      const actorName = actor?.name ?? result.actorId;

      lines.push(`### Turn ${turn.turnNumber} — ${actorName}`);
      lines.push("");

      // Narrative
      lines.push(`> ${result.narrative}`);
      lines.push("");

      // Damage / heal details
      if (result.damage) {
        const d = result.damage;
        lines.push(`- **Damage**: ${d.damage}${d.wasCrit ? " 💥 CRIT" : ""}${d.wasMiss ? " (MISS)" : ""}${d.statusApplied ? ` → ${d.statusApplied}` : ""}`);
        lines.push(`- **Target HP**: ${d.targetHp}/${d.targetMaxHp}`);
      }
      if (result.heal) {
        lines.push(`- **Healed**: ${result.heal.amount} HP (${result.heal.targetHp}/${result.heal.targetMaxHp})`);
      }
      if (result.spell) {
        lines.push(`- **MP remaining**: ${result.spell.mpRemaining}`);
        if (result.spell.cooldownRemaining > 0) {
          lines.push(`- **Cooldown**: ${result.spell.cooldownRemaining} turns`);
        }
      }
      if (result.item) {
        lines.push(`- **Item**: ${result.item.itemName} (${result.item.remaining} left)`);
      }
      if (result.fledSuccessfully) {
        lines.push("- **🏃 Fled!**");
      }

      // HP snapshot from the state at end of turn
      const snap = turn.stateSnapshot;
      if (snap) {
        const hpLine = snap.characters
          .map((c) => `**${c.name}**: ${hpBar(c.hp, c.maxHp)} ${c.hp}/${c.maxHp} HP, ${c.mp}/${c.maxMp} MP`)
          .join(" | ");
        lines.push("");
        lines.push(hpLine);
      }

      lines.push("");
    }
  }

  // ── Final state ──
  lines.push("---");
  lines.push("");
  lines.push("## Final State");
  lines.push("");

  const lastSnap = log.turns.at(-1)?.stateSnapshot;
  if (lastSnap) {
    for (const c of lastSnap.characters) {
      lines.push(`### ${c.name}${log.winner === c.id ? " 🏆" : ""}`);
      lines.push(`- HP: ${c.hp}/${c.maxHp}  MP: ${c.mp}/${c.maxMp}`);
      if (c.statusEffects.length > 0) {
        lines.push(`- Status: ${c.statusEffects.map((e) => `${e.type} (${e.turnsRemaining}t)`).join(", ")}`);
      }
      lines.push("");
    }
  }

  lines.push(`*Replay generated at ${new Date().toISOString()}*`);
  lines.push("");

  return lines.join("\n");
}

// ── Helpers ─────────────────────────────────────────────

function buildPath(
  log: BattleLog,
  characters: Character[],
  agents: IAgent[],
  dir: string
): string {
  const ts = new Date(log.startTime)
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19); // 2026-04-02_08-30-10

  const names = characters.map((c) => `${c.name}-${c.class}`).join("_vs_");
  const filename = `${ts}_${names}.md`;
  return path.resolve(dir, filename);
}

function hpBar(hp: number, maxHp: number): string {
  const len = 10;
  const filled = Math.round((hp / maxHp) * len);
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, len - filled));
}

function agentLabel(agent?: IAgent): string {
  if (!agent) return "?";
  const labels: Record<string, string> = {
    heuristic: "🤖 Heuristic",
    llm: "🧠 LLM",
    human: "👤 Human",
  };
  return labels[agent.type] || agent.type;
}
