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

  // Generate animated GIF replay
  let gifPath: string | undefined;
  try {
    gifPath = generateBattlefieldGif(log, characters, imagesDir);
  } catch (err: any) {
    console.error("GIF generation skipped:", err.message);
  }

  const md = renderMarkdown(log, characters, agents, imageMap, gifPath);
  fs.writeFileSync(filePath, md, "utf-8");
  return filePath;
}

// ── Markdown Renderer ───────────────────────────────────

function renderMarkdown(
  log: BattleLog,
  characters: Character[],
  agents: IAgent[],
  imageMap: Map<string, string>,
  gifPath?: string
): string {
  const lines: string[] = [];
  const charMap = new Map(characters.map((c) => [c.id, c]));

  // Title — list all character names
  const matchup = characters.map((c) => `${c.name} (${c.class})`).join(" vs ");
  const winner = log.winner ? charMap.get(log.winner)?.name ?? log.winner : "Draw";

  // ── Header ──
  lines.push(`# ⚔️ ${matchup}`);
  lines.push("");

  // Team info
  const teams = new Set(characters.map((c) => c.team));
  if (teams.size > 1) {
    for (const team of teams) {
      const members = characters.filter((c) => c.team === team);
      lines.push(`**Team \"${team}\"**: ${members.map((c) => c.name).join(", ")}`);
    }
    lines.push("");
  }

  // Stats table — N columns
  const cols = characters.map((c) => c.name);
  const sep = characters.map(() => "---").join(" | ");
  const ag = agents;
  lines.push(`| | ${cols.join(" | ")} |`);
  lines.push(`|---| ${sep} |`);
  lines.push(`| **Class** | ${characters.map((c) => c.class).join(" | ")} |`);
  lines.push(`| **Team** | ${characters.map((c) => c.team).join(" | ")} |`);
  lines.push(`| **Agent** | ${characters.map((c) => agentLabel(ag.find((a) => a.id === c.id))).join(" | ")} |`);
  lines.push(`| **HP** | ${characters.map((c) => `${c.stats.maxHp}`).join(" | ")} |`);
  lines.push(`| **AC** | ${characters.map((c) => `${c.stats.ac}`).join(" | ")} |`);
  lines.push(`| **STR/DEX/CON/INT/WIS/CHA** | ${characters.map((c) => `${c.stats.str}/${c.stats.dex}/${c.stats.con}/${c.stats.int}/${c.stats.wis}/${c.stats.cha}`).join(" | ")} |`);
  lines.push("");
  lines.push(`- **Winner**: ${winner}`);
  lines.push(`- **Turns**: ${log.totalTurns}`);
  lines.push(`- **Arena**: ${log.arena.label} (${log.arena.width}×${log.arena.height})`);
  lines.push(`- **Started**: ${log.startTime}`);
  lines.push(`- **Ended**: ${log.endTime ?? "N/A"}`);

  // Animated GIF link
  if (gifPath) {
    const gifRelPath = `./${path.basename(path.dirname(gifPath))}/${path.basename(gifPath)}`;
    lines.push("");
    lines.push(`🎬 **Animated Replay**: [${path.basename(gifPath)}](${gifRelPath})`);
  }
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
      lines.push(`- **Action**: ${formatAction(act, charMap)}`);

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
        lines.push(`- **Spell slot**: level ${result.spell.slotUsed}${result.spell.slotsRemaining ? `, remaining: ${JSON.stringify(result.spell.slotsRemaining)}` : ""}`);
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
        lines.push("");
        lines.push("| Name | HP | AC | Position | Status |");
        lines.push("|------|-----|-----|----------|--------|");
        for (const c of snap.characters) {
          const bar = hpBar(c.hp, c.maxHp);
          const hp = `${bar} ${c.hp}/${c.maxHp}`;
          const ac = `${c.ac}`;
          const pos = `(${c.position.x.toFixed(1)},${c.position.y.toFixed(1)})`;
          const status = c.statusEffects.length > 0
            ? c.statusEffects.map((e: any) => typeof e === "string" ? e : e.type).join(", ")
            : "";
          lines.push(`| **${c.name}** | ${hp} | ${ac} | ${pos} | ${status} |`);
        }
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
      const isWinner = log.winner === c.id || (c.team && log.winner === c.team);
      lines.push(`### ${c.name}${isWinner ? " 🏆" : ""}`);
      lines.push(`- HP: ${c.hp}/${c.maxHp}  AC: ${c.ac}  Team: ${c.team}`);
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
  _agents: IAgent[],
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

function formatAction(action: import("../engine/types.js").CombatAction, charMap?: Map<string, Character>): string {
  const parts: string[] = [action.type];
  if (action.spellId) parts.push(`spell="${action.spellId}"`);
  if (action.itemId) parts.push(`item="${action.itemId}"`);
  if (action.targetId) {
    const targetName = charMap?.get(action.targetId)?.name ?? action.targetId;
    parts.push(`target="${targetName}"`);
  }
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
    boss: "👹 Boss",
  };
  return labels[agent.type] || agent.type;
}

// ── Battlefield Image Generation ───────────────────────

import {
  renderBattlefield,
  renderBattlefieldCanvas,
  type BattlefieldCharacter,
  type BattlefieldFrame,
} from "./battlefield-renderer.js";

function generateBattlefieldImages(
  log: BattleLog,
  _characters: Character[],
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
        ac: c.ac,
        
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

// ── Animated GIF Generation ────────────────────────────

import GIFEncoder from "gif-encoder-2";

function generateBattlefieldGif(
  log: BattleLog,
  _characters: Character[],
  imagesDir: string
): string | undefined {
  // Collect all frames
  const frames: { turnNumber: number; actorId: string; snapshot: any; move?: any }[] = [];

  for (const turn of log.turns) {
    for (const result of turn.results) {
      if (turn.stateSnapshot) {
        frames.push({
          turnNumber: turn.turnNumber,
          actorId: result.actorId,
          snapshot: turn.stateSnapshot,
          move: result.move,
        });
      }
    }
  }

  if (frames.length === 0) return undefined;

  const WIDTH = 560;
  const HEIGHT = 280;

  return generateBattlefieldGifSync(log, frames, imagesDir, WIDTH, HEIGHT);
}

function generateBattlefieldGifSync(
  log: BattleLog,
  frames: { turnNumber: number; actorId: string; snapshot: any; move?: any }[],
  imagesDir: string,
  width: number,
  height: number
): string {
  const gif = new GIFEncoder(width, height, "neuquant", true);
  gif.start();
  gif.setRepeat(0);
  gif.setDelay(1200);
  gif.setQuality(10);

  // Render each frame directly to a canvas using renderBattlefieldToCanvas
  for (const frame of frames) {
    const bfChars: BattlefieldCharacter[] = frame.snapshot.characters.map((c: any) => ({
      id: c.id,
      name: c.name,
      team: c.team,
      hp: c.hp,
      maxHp: c.maxHp,
      ac: c.ac,
      
      position: c.position,
      statusEffects: c.statusEffects?.map((e: any) => typeof e === "string" ? e : e.type) ?? [],
      isDefending: c.isDefending,
    }));

    const bfFrame: BattlefieldFrame = {
      arena: log.arena,
      characters: bfChars,
      moveTrail: frame.move
        ? { actorId: frame.actorId, from: frame.move.from, to: frame.move.to }
        : undefined,
      turnNumber: frame.turnNumber,
      actorId: frame.actorId,
    };

    // Get the canvas directly instead of going through PNG
    const canvas = renderBattlefieldCanvas(bfFrame, width, height);
    gif.addFrame(canvas.getContext("2d") as any);
  }

  gif.finish();
  const gifData = gif.out.getData();
  const gifName = "battlefield_anim.gif";
  const gifFullPath = path.join(imagesDir, gifName);
  fs.writeFileSync(gifFullPath, Buffer.from(gifData));

  return gifFullPath;
}

