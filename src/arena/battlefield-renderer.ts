// ─────────────────────────────────────────────────────────
//  Battlefield Image Renderer — draws arena PNG via node-canvas
// ─────────────────────────────────────────────────────────
//
//  Renders a top-down battlefield with:
//    • Grid background with terrain lines
//    • Character circles with HP bars
//    • Movement trail arrows
//    • Range circles for spells
//
//  Used for replay attachments (Phase 4).
// ─────────────────────────────────────────────────────────

import { createCanvas, type CanvasRenderingContext2D } from "canvas";
import type { ArenaConfig, Position } from "../engine/types.js";
import { getTeamColor } from "../engine/types.js";

export interface BattlefieldCharacter {
  id: string;
  name: string;
  team: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  position: Position;
  statusEffects: string[];
  isDefending: boolean;
}

export interface MoveTrail {
  actorId: string;
  from: Position;
  to: Position;
}

export interface BattlefieldFrame {
  arena: ArenaConfig;
  characters: BattlefieldCharacter[];
  /** Optional move trail to show as an arrow */
  moveTrail?: MoveTrail;
  /** Turn number */
  turnNumber: number;
  /** Which character is acting this turn */
  actorId?: string;
}

// ── Colors ──────────────────────────────────────────────

const COLORS = {
  bg: "#1a1a2e",
  gridLine: "rgba(255, 255, 255, 0.04)",
  gridBorder: "rgba(255, 255, 255, 0.15)",
  playerFill: "#3b82f6",
  playerStroke: "#60a5fa",
  enemyFill: "#ef4444",
  enemyStroke: "#f87171",
  arrowColor: "#fbbf24",
  arrowHead: "#f59e0b",
  hpHigh: "#22c55e",
  hpMid: "#eab308",
  hpLow: "#ef4444",
  mpBar: "#6366f1",
  shieldGlow: "rgba(96, 165, 250, 0.3)",
  text: "#e2e8f0",
  textDim: "#94a3b8",
  statusBurn: "#f97316",
  statusFreeze: "#38bdf8",
  statusPoison: "#a855f7",
  statusShield: "#60a5fa",
  statusDefending: "#34d399",
  activeGlow: "rgba(251, 191, 36, 0.4)",
};

// ── Public API ──────────────────────────────────────────

/** Render a single battlefield frame to a PNG buffer */
export function renderBattlefield(frame: BattlefieldFrame, width?: number, height?: number): Buffer {
  const canvas = renderBattlefieldCanvas(frame, width, height);
  return canvas.toBuffer("image/png");
}

/** Render a battlefield frame directly to a canvas (reusable for GIF encoding) */
export function renderBattlefieldCanvas(frame: BattlefieldFrame, explicitWidth?: number, explicitHeight?: number): ReturnType<typeof createCanvas> {
  const { arena, characters, moveTrail, turnNumber, actorId } = frame;

  const padding = 40;
  const scale = 28;
  const width = explicitWidth ?? arena.width * scale + padding * 2;
  const height = explicitHeight ?? arena.height * scale + padding * 2;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  // Scale to fit the arena within the canvas
  const arenaAspect = arena.width / arena.height;
  const canvasAspect = (width - padding * 2) / (height - padding * 2);
  let sx: number, sy: number;
  if (canvasAspect > arenaAspect) {
    sy = (height - padding * 2) / arena.height;
    sx = sy;
  } else {
    sx = (width - padding * 2) / arena.width;
    sy = sx;
  }
  const ox = (width - arena.width * sx) / 2;
  const oy = (height - arena.height * sy) / 2;

  // Grid
  drawGridScaled(ctx, arena, ox, oy, sx, sy);

  // Move trail arrow
  if (moveTrail) {
    drawMoveArrowScaled(ctx, moveTrail.from, moveTrail.to, ox, oy, sx, sy);
  }

  // Characters
  for (const char of characters) {
    const isActive = char.id === actorId;
    drawCharacterScaled(ctx, char, ox, oy, sx, sy, isActive);
  }

  // Turn label
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`Turn ${turnNumber}`, padding / 2, 18);

  // Arena label
  ctx.textAlign = "right";
  ctx.fillText(arena.label, width - padding / 2, 18);

  return canvas;
}

/** Render multiple frames into an animated GIF-like strip (for replay) */
export function renderBattlefieldStrip(
  frames: BattlefieldFrame[],
  arena: ArenaConfig
): Buffer {
  if (frames.length === 0) {
    // Return a single empty frame
    return renderBattlefield({
      arena,
      characters: [],
      turnNumber: 0,
    });
  }
  if (frames.length === 1) {
    return renderBattlefield(frames[0]);
  }

  // For now, render the last frame as the summary
  // (GIF encoding would need an external dep)
  return renderBattlefield(frames[frames.length - 1]);
}

// ── Drawing Helpers ─────────────────────────────────────

function toPixel(pos: Position, padding: number, scale: number): { x: number; y: number } {
  return {
    x: padding + pos.x * scale,
    y: padding + pos.y * scale,
  };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  arena: ArenaConfig,
  padding: number,
  scale: number
) {
  const left = padding;
  const top = padding;
  const right = padding + arena.width * scale;
  const bottom = padding + arena.height * scale;

  // Grid lines (every unit)
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= arena.width; x++) {
    const px = left + x * scale;
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px, bottom);
    ctx.stroke();
  }
  for (let y = 0; y <= arena.height; y++) {
    const py = top + y * scale;
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = COLORS.gridBorder;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left, top, arena.width * scale, arena.height * scale);
}

function drawMoveArrow(
  ctx: CanvasRenderingContext2D,
  from: Position,
  to: Position,
  padding: number,
  scale: number
) {
  const p1 = toPixel(from, padding, scale);
  const p2 = toPixel(to, padding, scale);

  // Trail line
  ctx.strokeStyle = COLORS.arrowColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrow head
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const headLen = 8;
  ctx.fillStyle = COLORS.arrowHead;
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(p2.x - headLen * Math.cos(angle - 0.4), p2.y - headLen * Math.sin(angle - 0.4));
  ctx.lineTo(p2.x - headLen * Math.cos(angle + 0.4), p2.y - headLen * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  char: BattlefieldCharacter,
  padding: number,
  scale: number,
  isActive: boolean
) {
  const p = toPixel(char.position, padding, scale);
  const radius = scale * 0.45;

  // Active turn glow
  if (isActive) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.activeGlow;
    ctx.fill();
  }

  // Shield aura
  if (char.statusEffects.includes("shield") || char.isDefending) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = char.isDefending ? COLORS.statusDefending : COLORS.statusShield;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Body circle — color by team
  const teamColor = getTeamColor(char.team);
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = teamColor;
  ctx.fill();
  // Slightly brighter stroke
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;
  ctx.stroke();
  ctx.globalAlpha = 1.0;

  // Character initial
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(radius * 0.9)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(char.name.charAt(0).toUpperCase(), p.x, p.y);

  // HP bar above character
  const barWidth = scale * 1.2;
  const barHeight = 4;
  const barX = p.x - barWidth / 2;
  const barY = p.y - radius - 12;

  // Bar background
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(barX, barY, barWidth, barHeight);

  // HP fill
  const hpPct = char.maxHp > 0 ? char.hp / char.maxHp : 0;
  const hpColor = hpPct > 0.6 ? COLORS.hpHigh : hpPct > 0.3 ? COLORS.hpMid : COLORS.hpLow;
  ctx.fillStyle = hpColor;
  ctx.fillRect(barX, barY, barWidth * hpPct, barHeight);

  // Name label
  ctx.fillStyle = COLORS.text;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(char.name, p.x, barY - 2);

  // HP text
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "9px monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`${char.hp}/${char.maxHp}`, p.x, p.y + radius + 4);

  // Status icons below
  const icons: string[] = [];
  for (const s of char.statusEffects) {
    switch (s) {
      case "burn": icons.push("🔥"); break;
      case "freeze": icons.push("❄️"); break;
      case "poison": icons.push("☠️"); break;
      case "shield": icons.push("🛡️"); break;
      case "defending": icons.push("🔰"); break;
      case "haste": icons.push("💨"); break;
      case "slow": icons.push("🐌"); break;
    }
  }
  if (icons.length > 0) {
    ctx.font = "10px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(icons.join(""), p.x, p.y + radius + 16);
  }
}

// ── Scaled Drawing Helpers (for GIF with explicit canvas size) ──

function toPixelScaled(pos: Position, ox: number, oy: number, sx: number, sy: number): { x: number; y: number } {
  return { x: ox + pos.x * sx, y: oy + pos.y * sy };
}

function drawGridScaled(
  ctx: CanvasRenderingContext2D,
  arena: ArenaConfig,
  ox: number,
  oy: number,
  sx: number,
  sy: number
) {
  const right = ox + arena.width * sx;
  const bottom = oy + arena.height * sy;

  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= arena.width; x++) {
    const px = ox + x * sx;
    ctx.beginPath(); ctx.moveTo(px, oy); ctx.lineTo(px, bottom); ctx.stroke();
  }
  for (let y = 0; y <= arena.height; y++) {
    const py = oy + y * sy;
    ctx.beginPath(); ctx.moveTo(ox, py); ctx.lineTo(right, py); ctx.stroke();
  }

  ctx.strokeStyle = COLORS.gridBorder;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox, oy, arena.width * sx, arena.height * sy);
}

function drawMoveArrowScaled(
  ctx: CanvasRenderingContext2D,
  from: Position,
  to: Position,
  ox: number,
  oy: number,
  sx: number,
  sy: number
) {
  const p1 = toPixelScaled(from, ox, oy, sx, sy);
  const p2 = toPixelScaled(to, ox, oy, sx, sy);

  ctx.strokeStyle = COLORS.arrowColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  ctx.setLineDash([]);

  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const headLen = 8;
  ctx.fillStyle = COLORS.arrowHead;
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(p2.x - headLen * Math.cos(angle - 0.4), p2.y - headLen * Math.sin(angle - 0.4));
  ctx.lineTo(p2.x - headLen * Math.cos(angle + 0.4), p2.y - headLen * Math.sin(angle + 0.4));
  ctx.closePath(); ctx.fill();
}

function drawCharacterScaled(
  ctx: CanvasRenderingContext2D,
  char: BattlefieldCharacter,
  ox: number,
  oy: number,
  sx: number,
  sy: number,
  isActive: boolean
) {
  const p = toPixelScaled(char.position, ox, oy, sx, sy);
  const radius = Math.max(sx * 0.45, 8);

  if (isActive) {
    ctx.beginPath(); ctx.arc(p.x, p.y, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.activeGlow; ctx.fill();
  }

  if (char.statusEffects.includes("shield") || char.isDefending) {
    ctx.beginPath(); ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = char.isDefending ? COLORS.statusDefending : COLORS.statusShield;
    ctx.lineWidth = 2; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
  }

  const teamColor = getTeamColor(char.team);
  ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = teamColor; ctx.fill();
  ctx.strokeStyle = teamColor; ctx.lineWidth = 2; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1.0;

  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(radius * 0.9)}px sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(char.name.charAt(0).toUpperCase(), p.x, p.y);

  const barWidth = Math.max(sx * 1.2, 20);
  const barHeight = 4;
  const barX = p.x - barWidth / 2;
  const barY = p.y - radius - 12;

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(barX, barY, barWidth, barHeight);
  const hpPct = char.maxHp > 0 ? char.hp / char.maxHp : 0;
  const hpColor = hpPct > 0.6 ? COLORS.hpHigh : hpPct > 0.3 ? COLORS.hpMid : COLORS.hpLow;
  ctx.fillStyle = hpColor;
  ctx.fillRect(barX, barY, barWidth * hpPct, barHeight);

  ctx.fillStyle = COLORS.text;
  ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText(char.name, p.x, barY - 2);

  ctx.fillStyle = COLORS.textDim;
  ctx.font = "9px monospace"; ctx.textBaseline = "top";
  ctx.fillText(`${char.hp}/${char.maxHp}`, p.x, p.y + radius + 4);
}
