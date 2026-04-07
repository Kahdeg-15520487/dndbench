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
  const filePath = buildPath(log, characters, agents, replayDir);
  const imagesDir = filePath.replace(/\.md$/, "_images");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  // Generate battlefield images — one per turn-result, keyed by "turnNum-resultIdx"
  let imageMap = new Map<string, string>();
  try {
    imageMap = generateBattlefieldImages(log, characters, imagesDir);
  } catch (err: any) {
    // Image generation is optional — don't fail replay if canvas isn't available
    console.error("Battlefield image generation skipped:", err.message);
  }

  const md = renderMarkdown(log, characters, agents, imageMap);
  fs.writeFileSync(filePath, md, "utf-8");
  return filePath;
}

// ── Markdown Renderer ───────────────────────────────────

function renderMarkdown(
  log: BattleLog,
  characters: Character[],
  agents: IAgent[],
  imageMap: Map<string, string>
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
  lines.push(`- **Arena**: ${log.arena.label} (${log.arena.width}×${log.arena.height})`);
  lines.push(`- **Started**: ${log.startTime}`);
  lines.push(`- **Ended**: ${log.endTime ?? "N/A"}`);
  lines.push("");

  // ── Turn-by-turn ──
  lines.push("---");
  lines.push("");
  lines.push("## Turn-by-Turn Replay");
  lines.push("");

  let resultIdx = 0;
  for (const turn of log.turns) {
    for (const result of turn.results) {
      const actor = charMap.get(result.actorId);
      const actorName = actor?.name ?? result.actorId;

      lines.push(`### Turn ${turn.turnNumber} — ${actorName}`);
      lines.push("");

      // Narrative
      lines.push(`> ${result.narrative}`);
      lines.push("");

      // Action details
      const act = result.action;
      lines.push(`- **Action**: ${formatAction(act)}`);

      // Movement
      if (result.move) {
        lines.push(`- **Move**: (${result.move.from.x.toFixed(1)},${result.move.from.y.toFixed(1)}) → (${result.move.to.x.toFixed(1)},${result.move.to.y.toFixed(1)}) [${result.move.distanceMoved.toFixed(1)} units]`);
      }

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
          .map((c) => `**${c.name}**: ${hpBar(c.hp, c.maxHp)} ${c.hp}/${c.maxHp} HP, ${c.mp}/${c.maxMp} MP @ (${c.position.x.toFixed(1)},${c.position.y.toFixed(1)})`)
          .join(" | ");
        lines.push("");
        lines.push(hpLine);
      }

      // Battlefield image — inline at end of turn
      const imgKey = `${turn.turnNumber}-${resultIdx}`;
      const imgPath = imageMap.get(imgKey);
      if (imgPath) {
        const imgName = path.basename(imgPath);
        const relPath = `./${path.basename(path.dirname(imgPath))}/${imgName}`;
        lines.push("");
        lines.push(`![Turn ${turn.turnNumber} — ${actorName}](${relPath})`);
      }

      // Thinking steps (LLM reasoning)
      if (turn.thinkingSteps?.length) {
        lines.push("");
        lines.push("<details>");
        lines.push("<summary>🧠 Thinking process</summary>");
        lines.push("");
        for (const step of turn.thinkingSteps) {
          if (step.type === "tool_call") {
            let detail = `**🔧 ${step.toolName}**`;
            if (step.toolParams != null && typeof step.toolParams === "object") {
              const entries = Object.entries(step.toolParams).filter(([_, v]) => v != null);
              if (entries.length > 0) {
                const paramStr = entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
                detail += `(${paramStr})`;
              }
            }
            lines.push(`- ${detail}`);
          } else if (step.type === "tool_result") {
            const isAction = ["attack", "defend", "cast_spell", "use_item", "wait", "flee"].includes(step.toolName || "");
            if (isAction) {
              lines.push(`  - ↳ ${step.text}`);
            } else {
              // Observation results are now clean text from the tool
              lines.push(`  - ↳ ${step.text}`);
            }
          } else if (step.type === "thinking") {
            lines.push(`- 💭 ${step.text}`);
          }
        }
        lines.push("");
        lines.push("</details>");
      }

      lines.push("");
      resultIdx++;
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

function formatAction(action: import("../engine/types.js").CombatAction): string {
  const parts: string[] = [action.type];
  if (action.spellId) parts.push(`spell="${action.spellId}"`);
  if (action.itemId) parts.push(`item="${action.itemId}"`);
  if (action.targetId) parts.push(`target="${action.targetId}"`);
  return parts.join(" ");
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

function truncate(val: any, maxLen: number): string {
  const str = typeof val === "string" ? val : JSON.stringify(val);
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

// ── Battlefield Image Generation ───────────────────────

import {
  renderBattlefield,
  type BattlefieldCharacter,
  type BattlefieldFrame,
} from "./battlefield-renderer.js";

function generateBattlefieldImages(
  log: BattleLog,
  characters: Character[],
  imagesDir: string
): Map<string, string> {
  fs.mkdirSync(imagesDir, { recursive: true });

  const imageMap = new Map<string, string>();
  let resultIdx = 0;

  for (const turn of log.turns) {
    for (const result of turn.results) {
      if (!turn.stateSnapshot) { resultIdx++; continue; }

      const bfChars: BattlefieldCharacter[] = turn.stateSnapshot.characters.map((c) => ({
        id: c.id,
        name: c.name,
        team: c.team,
        hp: c.hp,
        maxHp: c.maxHp,
        mp: c.mp,
        maxMp: c.maxMp,
        position: c.position,
        statusEffects: c.statusEffects.map((e) => e.type as string),
        isDefending: c.isDefending,
      }));

      const frame: BattlefieldFrame = {
        arena: log.arena,
        characters: bfChars,
        moveTrail: result.move
          ? { actorId: result.actorId, from: result.move.from, to: result.move.to }
          : undefined,
        turnNumber: turn.turnNumber,
        actorId: result.actorId,
      };

      const buf = renderBattlefield(frame);
      const imgName = `turn_${String(turn.turnNumber).padStart(3, "0")}_action${resultIdx}.png`;
      const imgPath = path.join(imagesDir, imgName);
      fs.writeFileSync(imgPath, buf);

      const key = `${turn.turnNumber}-${resultIdx}`;
      imageMap.set(key, imgPath);
      resultIdx++;
    }
  }

  return imageMap;
}


