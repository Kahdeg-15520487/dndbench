<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from "vue";

interface CharState {
  id: string;
  name: string;
  team: string;
  class: string;
  hp: number;
  maxHp: number;
  ac: number;
  statusEffects: { type: string; turnsRemaining: number }[];
  isDefending: boolean;
  position?: { x: number; y: number };
  spells: { id: string; name: string; currentCooldown: number }[];
  inventory: { id: string; name: string; quantity: number }[];
  spellSlots?: Record<string, number>;
}

interface ChatMessage {
  id: number;
  type: "system" | "player" | "enemy" | "status" | "info" | "error" | "thinking";
  text: string;
}

interface ThinkingStep {
  type: string;
  text: string;
  toolName?: string;
}

const props = defineProps<{
  // N-unit mode
  characters: CharState[];
  humanIds: string[];

  // Legacy 1v1 (computed from characters in App.vue)
  player: CharState;
  enemy: CharState;
  playerClass: string;
  enemyClass: string;

  messages: ChatMessage[];
  myTurn: boolean;
  enemyThinking: boolean;
  thinkingSteps: ThinkingStep[];
  turnNumber: number;
  winner: string | null;
  winnerReason: string;
  phase: string;
  gameCategory?: "1v1" | "boss_exam" | "scenario";
  bossExamResults?: Array<{ bossId: string; bossName: string; won: boolean; turns: number }>;
  bossExamScorecard?: { results: any[]; completed: number; total: number; wins: number; allDone: boolean; grade: string } | null;
  currentBossIndex?: number;
  currentBossEmoji?: string;
  currentBossName?: string;
  bossExamBosses?: Array<{ id: string; name: string; emoji: string; title: string }>;
  arena?: { width: number; height: number; label: string };
  moveEvent?: { actorId: string; from: { x: number; y: number }; to: { x: number; y: number }; distance: number } | null;
  actorId?: string;
}>();

const emit = defineEmits<{
  action: [action: { type: string; spellId?: string; itemId?: string; target?: string }];
  reset: [];
}>();

// ── Computed ──────────────────────────────────────────
const isNUnit = computed(() => props.characters.length > 2);
const humanChar = computed(() => {
  if (props.humanIds.length > 0) {
    return props.characters.find(c => props.humanIds.includes(c.id)) || props.player;
  }
  return props.player;
});
const livingCharacters = computed(() => props.characters.filter(c => c.hp > 0));

// ── Action Panel State ────────────────────────────────
const actionMode = ref<"main" | "spells" | "items">("main");

// ── HP / MP bars ──────────────────────────────────────
function hpPct(c: CharState) { return c.maxHp > 0 ? (c.hp / c.maxHp) * 100 : 0; }
function hpColor(pct: number): string {
  if (pct > 60) return "var(--hp)";
  if (pct > 30) return "var(--hp-mid)";
  return "var(--hp-low)";
}

const availableSpells = computed(() =>
  humanChar.value.spells.filter(s => s.currentCooldown === 0)
);
const availableItems = computed(() =>
  humanChar.value.inventory.filter(i => i.quantity > 0)
);

// Spell slot level labels for display
const SLOT_LABELS: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };

// ── Team colors ──────────────────────────────────────
const TEAM_COLORS: Record<string, string> = {
  a: "#3b82f6", player: "#3b82f6", red: "#ef4444", raid: "#3b82f6",
  b: "#ef4444", enemy: "#ef4444", blue: "#60a5fa", boss: "#a855f7",
  c: "#22c55e", d: "#eab308",
};
function teamColor(team: string): string {
  return TEAM_COLORS[team] || "#6b7280";
}

// ── Actions ───────────────────────────────────────────
function doAction(type: string, extra?: { spellId?: string; itemId?: string }) {
  const target = ["cure_wounds", "shield", "shield_of_faith"].includes(extra?.spellId || "") ? "self" : undefined;
  emit("action", { type, ...extra, target });
  actionMode.value = "main";
}

// ── Auto-scroll Chat ──────────────────────────────────
const chatContainer = ref<HTMLElement | null>(null);

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  }
);

// ── Status Effect Emoji ───────────────────────────────
const statusEmoji: Record<string, string> = {
  burn: "🔥", freeze: "❄️", poison: "☠️", shield: "🛡️",
  defending: "🛡️", haste: "💨", slow: "🐌", regen: "💚", blind: "🕶️",
};

function statusLabel(type: string, turns: number): string {
  return `${statusEmoji[type] || "●"} ${type} (${turns})`;
}

// ── Battlefield Canvas ────────────────────────────────
const battlefieldCanvas = ref<HTMLCanvasElement | null>(null);

function drawBattlefield() {
  const canvas = battlefieldCanvas.value;
  if (!canvas) return;

  const arena = props.arena ?? { width: 20, height: 12, label: "Arena" };
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  canvas.width = displayWidth * dpr;
  canvas.height = displayHeight * dpr;
  ctx.scale(dpr, dpr);

  const padding = 24;
  const scaleX = (displayWidth - padding * 2) / arena.width;
  const scaleY = (displayHeight - padding * 2) / arena.height;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = (displayWidth - arena.width * scale) / 2;
  const offsetY = (displayHeight - arena.height * scale) / 2;

  const toX = (pos: number) => offsetX + pos * scale;
  const toY = (pos: number) => offsetY + pos * scale;

  // Background
  ctx.fillStyle = "#0f0f1a";
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  // Grid
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= arena.width; x++) {
    ctx.beginPath();
    ctx.moveTo(toX(x), toY(0));
    ctx.lineTo(toX(x), toY(arena.height));
    ctx.stroke();
  }
  for (let y = 0; y <= arena.height; y++) {
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(y));
    ctx.lineTo(toX(arena.width), toY(y));
    ctx.stroke();
  }

  // Arena border
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.strokeRect(toX(0), toY(0), arena.width * scale, arena.height * scale);

  // Move trail arrow
  if (props.moveEvent) {
    const mv = props.moveEvent;
    const p1x = toX(mv.from.x);
    const p1y = toY(mv.from.y);
    const p2x = toX(mv.to.x);
    const p2y = toY(mv.to.y);

    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(p1x, p1y);
    ctx.lineTo(p2x, p2y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead
    const angle = Math.atan2(p2y - p1y, p2x - p1x);
    const headLen = 8;
    ctx.fillStyle = "#f59e0b";
    ctx.beginPath();
    ctx.moveTo(p2x, p2y);
    ctx.lineTo(p2x - headLen * Math.cos(angle - 0.4), p2y - headLen * Math.sin(angle - 0.4));
    ctx.lineTo(p2x - headLen * Math.cos(angle + 0.4), p2y - headLen * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  // Draw all characters
  const chars = props.characters.length > 0 ? props.characters : [props.player, props.enemy];
  for (const char of chars) {
    if (!char.position) continue;
    if (char.hp <= 0) continue; // skip dead
    const cx = toX(char.position.x);
    const cy = toY(char.position.y);
    const radius = Math.max(scale * 0.45, 8);

    // Active glow
    if (char.id === props.actorId) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(251,191,36,0.3)";
      ctx.fill();
    }

    // Shield/defend aura
    if (char.statusEffects.some(e => e.type === "shield") || char.isDefending) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = char.isDefending ? "rgba(52,211,153,0.6)" : "rgba(96,165,250,0.6)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Circle — team color
    const color = teamColor(char.team);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Initial
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(radius * 0.9)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((char.name || "?").charAt(0).toUpperCase(), cx, cy);

    // HP bar
    const barW = Math.max(radius * 2.4, 20);
    const barH = 3;
    const barX = cx - barW / 2;
    const barY = cy - radius - 10;
    const hp = char.maxHp > 0 ? char.hp / char.maxHp : 0;

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(barX, barY, barW, barH);

    const hpClr = hp > 0.6 ? "#22c55e" : hp > 0.3 ? "#eab308" : "#ef4444";
    ctx.fillStyle = hpClr;
    ctx.fillRect(barX, barY, barW * hp, barH);

    // Name
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(char.name || "?", cx, barY - 2);
  }

  // Turn label
  ctx.fillStyle = "rgba(148,163,184,0.7)";
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`Turn ${props.turnNumber}  ${arena.label}`, padding, 8);
}

// Redraw when any relevant prop changes
watch(
  () => [props.characters, props.moveEvent, props.actorId, props.arena, props.turnNumber],
  () => nextTick(drawBattlefield),
  { deep: true }
);

onMounted(() => nextTick(drawBattlefield));
</script>

<template>
  <div class="arena">
    <!-- ── Header ──────────────────────────────────────── -->
    <header class="header">
      <span class="title" v-if="gameCategory === 'boss_exam'">👹 Boss Exam</span>
      <span class="title" v-else-if="isNUnit">⚔️ Arena ({{ livingCharacters.length }} units)</span>
      <span class="title" v-else>⚔️ RPG Arena</span>
      <span class="turn-badge" v-if="phase === 'battle' || phase === 'boss_exam'">
        Turn {{ turnNumber }}
      </span>
      <span class="boss-progress" v-if="gameCategory === 'boss_exam' && bossExamBosses">
        <span
          v-for="(boss, idx) in bossExamBosses"
          :key="boss.id"
          class="boss-dot"
          :class="{
            'boss-done-won': bossExamResults?.[idx]?.won,
            'boss-done-lost': bossExamResults?.[idx] && !bossExamResults[idx].won,
            'boss-current': idx === currentBossIndex && phase !== 'ended',
          }"
          :title="boss.name"
        >{{ boss.emoji }}</span>
      </span>
    </header>

    <!-- ── Battlefield Canvas ──────────────────────────── -->
    <section v-if="phase === 'battle' || phase === 'boss_exam'" class="battlefield-section">
      <canvas ref="battlefieldCanvas" class="battlefield-canvas"></canvas>
    </section>

    <!-- ── Status Bars ─────────────────────────────────── -->
    <!-- N-unit mode: horizontal scrollable card strip -->
    <section v-if="isNUnit && characters.length > 0" class="status-section-n">
      <div class="char-strip">
        <div
          v-for="c in characters"
          :key="c.id"
          class="char-card-mini"
          :class="{ 'is-dead': c.hp <= 0, 'is-human': humanIds.includes(c.id), 'your-turn-glow': humanIds.includes(c.id) && myTurn }"
          :style="{ '--team-color': teamColor(c.team) }"
        >
          <div class="char-header-mini">
            <span class="char-name-mini">{{ c.name }}</span>
            <span class="char-team" :style="{ color: teamColor(c.team) }">{{ c.team }}</span>
          </div>
          <div class="bar-container">
            <span class="bar-label" style="color: var(--hp)">HP</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: hpPct(c) + '%', background: hpColor(hpPct(c)) }" />
            </div>
            <span class="bar-value">{{ c.hp }}/{{ c.maxHp }}</span>
          </div>
          <div class="bar-container">
            <span class="bar-label" style="color: var(--ac)">AC</span>
            <span class="bar-value ac-val">{{ c.ac }}</span>
          </div>
          <div class="status-tags" v-if="c.statusEffects.length">
            <span v-for="s in c.statusEffects" :key="s.type" class="status-tag">{{ statusEmoji[s.type] || "●" }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Legacy 1v1 / Boss exam: two cards -->
    <section v-else class="status-section">
      <!-- Player -->
      <div class="char-card player-card" :class="{ 'your-turn-glow': myTurn }">
        <div class="char-header">
          <span class="char-name">{{ player.name || "You" }}</span>
          <span class="char-class">{{ playerClass }}</span>
        </div>
        <div class="bar-container">
          <span class="bar-label" style="color: var(--hp)">HP</span>
          <div class="bar-track">
            <div class="bar-fill" :style="{ width: hpPct(player) + '%', background: hpColor(hpPct(player)) }" />
          </div>
          <span class="bar-value">{{ player.hp }}/{{ player.maxHp }}</span>
        </div>
        <div class="bar-container">
          <span class="bar-label" style="color: var(--ac)">AC</span>
          <span class="bar-value ac-val">{{ player.ac }}</span>
        </div>
        <div class="status-tags" v-if="player.statusEffects.length">
          <span v-for="s in player.statusEffects" :key="s.type" class="status-tag">{{ statusLabel(s.type, s.turnsRemaining) }}</span>
        </div>
      </div>

      <div class="vs-badge">VS</div>

      <!-- Enemy / Boss -->
      <div class="char-card enemy-card">
        <div class="char-header">
          <span class="char-name">{{ gameCategory === 'boss_exam' && currentBossName ? currentBossName : (enemy.name || "Enemy") }}</span>
          <span class="char-class">{{ gameCategory === 'boss_exam' ? 'BOSS' : enemyClass }}</span>
        </div>
        <div class="bar-container">
          <span class="bar-label" style="color: var(--hp)">HP</span>
          <div class="bar-track">
            <div class="bar-fill" :style="{ width: hpPct(enemy) + '%', background: hpColor(hpPct(enemy)) }" />
          </div>
          <span class="bar-value">{{ enemy.hp }}/{{ enemy.maxHp }}</span>
        </div>
        <div class="bar-container">
          <span class="bar-label" style="color: var(--ac)">AC</span>
          <span class="bar-value ac-val">{{ enemy.ac }}</span>
        </div>
        <div class="status-tags" v-if="enemy.statusEffects.length">
          <span v-for="s in enemy.statusEffects" :key="s.type" class="status-tag">{{ statusLabel(s.type, s.turnsRemaining) }}</span>
        </div>
      </div>
    </section>

    <!-- ── Chat Area ───────────────────────────────────── -->
    <section class="chat-section" ref="chatContainer">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="chat-msg"
        :class="'msg-' + msg.type"
      >
        <span class="msg-text">{{ msg.text }}</span>
      </div>

      <!-- Enemy thinking indicator -->
      <div v-if="enemyThinking" class="thinking-panel">
        <div class="thinking-header">
          <span class="thinking-label">🧠 Enemy thinking</span>
          <span class="typing-dots">
            <span class="typing-dot">.</span><span class="typing-dot">.</span><span class="typing-dot">.</span>
          </span>
        </div>
        <div v-if="thinkingSteps.length > 0" class="thinking-steps">
          <div v-for="(step, idx) in thinkingSteps" :key="idx" class="thinking-step" :class="'step-' + step.type">
            <span class="step-icon">{{ step.type === 'thinking' ? '💭' : step.type === 'tool_call' ? '🔧' : '📋' }}</span>
            <span class="step-text">{{ step.type === 'tool_call' ? step.toolName : step.text }}</span>
          </div>
        </div>
        <div v-else class="thinking-steps">
          <div class="thinking-step step-waiting">
            <span class="step-icon">⏳</span>
            <span class="step-text">Analyzing battlefield...</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Action Panel ────────────────────────────────── -->
    <section class="action-section">
      <!-- Battle Ended -->
      <div v-if="phase === 'ended'" class="end-panel">
        <!-- Boss Exam Scorecard -->
        <template v-if="gameCategory === 'boss_exam' && bossExamScorecard">
          <div class="scorecard">
            <div class="scorecard-title">📋 Boss Exam Results</div>
            <div class="scorecard-grade" :class="'grade-' + bossExamScorecard.grade.toLowerCase()">
              {{ bossExamScorecard.grade }}
            </div>
            <div class="scorecard-score">{{ bossExamScorecard.wins }} / {{ bossExamScorecard.total }} Bosses Defeated</div>
            <div class="scorecard-results">
              <div v-for="(r, idx) in bossExamScorecard.results" :key="idx" class="scorecard-row" :class="r.won ? 'score-won' : 'score-lost'">
                <span class="score-icon">{{ r.won ? '✅' : '❌' }}</span>
                <span class="score-name">{{ r.bossName }}</span>
                <span class="score-turns">{{ r.turns }} turns</span>
              </div>
            </div>
          </div>
        </template>
        <!-- Standard Result -->
        <template v-else>
          <div class="end-text" :class="winner === 'player' ? 'win' : (winner === 'enemy' || winner === 'boss') ? 'lose' : 'draw'">
            {{ winner === 'player' ? '🏆 Victory!' : (winner === 'enemy' || winner === 'boss') ? '💀 Defeat!' : '🤝 Draw!' }}
          </div>
          <div class="end-reason">{{ winnerReason }}</div>
        </template>
        <button class="btn-accent" @click="emit('reset')">⚔️ Play Again</button>
      </div>

      <!-- Main Actions -->
      <div v-else-if="actionMode === 'main'" class="action-grid">
        <button class="btn-attack" :disabled="!myTurn" @click="doAction('attack')">⚔️ Attack</button>
        <button class="btn-defend" :disabled="!myTurn" @click="doAction('defend')">🛡️ Defend</button>
        <button class="btn-spell" :disabled="!myTurn" @click="actionMode = 'spells'">✨ Spells</button>
        <button class="btn-item" :disabled="!myTurn" @click="actionMode = 'items'">🧪 Items</button>
        <button class="btn-wait" :disabled="!myTurn" @click="doAction('wait')">⏳ Wait</button>
        <button class="btn-flee" :disabled="!myTurn" @click="doAction('flee')">🏃 Flee</button>
      </div>

      <!-- Spell Selection -->
      <div v-else-if="actionMode === 'spells'" class="sub-panel">
        <div class="sub-header">
          <button class="btn btn-sm" @click="actionMode = 'main'">← Back</button>
          <span class="sub-title">✨ Choose Spell</span>
        </div>
        <div class="sub-grid">
          <button
            v-for="s in availableSpells"
            :key="s.id"
            class="btn btn-sm spell-btn"
            :disabled="!myTurn"
            @click="doAction('cast_spell', { spellId: s.id })"
          >
            {{ s.name }}
          </button>
        </div>
      </div>

      <!-- Item Selection -->
      <div v-else-if="actionMode === 'items'" class="sub-panel">
        <div class="sub-header">
          <button class="btn btn-sm" @click="actionMode = 'main'">← Back</button>
          <span class="sub-title">🧪 Choose Item</span>
        </div>
        <div class="sub-grid">
          <button
            v-for="i in availableItems"
            :key="i.id"
            class="btn btn-sm item-btn"
            :disabled="!myTurn || i.quantity <= 0"
            @click="doAction('use_item', { itemId: i.id })"
          >
            {{ i.name }}
            <span class="item-qty">x{{ i.quantity }}</span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.arena {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  max-width: 600px;
  margin: 0 auto;
  padding: 0;
  overflow: hidden;
}

/* ── Header ─────────────────────────────────────────── */
.header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}
.title { font-weight: 700; font-size: 16px; }
.turn-badge {
  font-size: 12px;
  font-weight: 700;
  background: var(--accent);
  color: #fff;
  padding: 3px 10px;
  border-radius: 20px;
}

/* ── Battlefield Canvas ──────────────────────────────── */
.battlefield-section {
  flex-shrink: 0;
  padding: 8px 16px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}
.battlefield-canvas {
  width: 100%;
  height: 140px;
  border-radius: 8px;
  display: block;
}

/* ── Status Section: N-unit mode ────────────────────── */
.status-section-n {
  flex-shrink: 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 8px 0;
  max-height: 150px;
  overflow-y: auto;
}
.char-strip {
  display: flex;
  gap: 8px;
  padding: 0 12px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.char-card-mini {
  flex-shrink: 0;
  min-width: 110px;
  padding: 6px 8px;
  background: var(--bg);
  border-radius: 8px;
  border: 1.5px solid var(--border);
  font-size: 12px;
}
.char-card-mini.is-dead {
  opacity: 0.35;
}
.char-card-mini.is-human {
  border-color: var(--team-color);
}
.char-card-mini.your-turn-glow {
  border-color: var(--accent);
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.3);
}
.char-header-mini {
  display: flex;
  justify-content: space-between;
  margin-bottom: 3px;
}
.char-name-mini { font-weight: 700; font-size: 12px; }
.char-team { font-size: 10px; font-weight: 600; }

/* ── Status Section: 1v1 mode ───────────────────────── */
.status-section {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 10px 16px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}
.char-card {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  background: var(--bg);
  border-radius: 10px;
  border: 1px solid var(--border);
  overflow: hidden;
}
.player-card.your-turn-glow { border-color: var(--accent); }
.char-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}
.char-name { font-weight: 700; font-size: 13px; }
.char-class {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.bar-container {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.bar-label { font-size: 10px; font-weight: 700; width: 18px; flex-shrink: 0; }
.bar-track {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}
.bar-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
.bar-value { font-size: 10px; color: var(--text-dim); width: 55px; flex-shrink: 0; text-align: right; }
.ac-val { color: var(--ac); font-weight: 700; font-size: 14px; }
.status-tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; min-height: 0; }
.status-tag {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-dim);
  white-space: nowrap;
}
.vs-badge {
  flex-shrink: 0;
  align-self: center;
  font-weight: 900;
  font-size: 12px;
  color: var(--text-dim);
  text-shadow: 0 0 8px rgba(108, 99, 255, 0.3);
}

/* ── Chat Section ────────────────────────────────────── */
.chat-section {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg);
}
.chat-msg {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  max-width: 90%;
  word-break: break-word;
}
.msg-player { align-self: flex-end; background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.25); color: #93bbfd; }
.msg-enemy { align-self: flex-start; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.25); color: #fca5a5; }
.msg-status { align-self: center; background: rgba(234,179,8,0.1); color: var(--hp-mid); font-size: 12px; text-align: center; }
.msg-info { align-self: center; color: var(--text-dim); font-size: 12px; text-align: center; }
.msg-system { align-self: center; background: rgba(108,99,255,0.1); border: 1px solid rgba(108,99,255,0.2); color: #a5a0ff; font-weight: 600; text-align: center; }
.msg-error { align-self: center; color: #f87171; font-size: 12px; }
.msg-thinking { align-self: flex-start; color: var(--text-dim); font-size: 13px; font-style: italic; }

/* ── Thinking Panel ────────────────────────────────── */
.thinking-panel {
  align-self: flex-start;
  width: 85%;
  background: rgba(139,92,246,0.08);
  border: 1px solid rgba(139,92,246,0.2);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
}
.thinking-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.thinking-label { font-weight: 600; color: #a78bfa; }
.typing-dots { display: inline-flex; gap: 2px; }
.thinking-steps { display: flex; flex-direction: column; gap: 3px; max-height: 120px; overflow-y: auto; }
.thinking-step { display: flex; align-items: flex-start; gap: 6px; padding: 2px 0; color: var(--text-dim); line-height: 1.4; }
.step-icon { flex-shrink: 0; font-size: 11px; }
.step-text { word-break: break-word; }
.step-tool_call .step-text { color: #c4b5fd; font-weight: 600; }
.step-tool_result .step-text { color: #86efac; font-size: 11px; opacity: 0.8; }
.step-thinking .step-text { color: #fde68a; font-style: italic; font-size: 11px; }
.step-waiting .step-text { color: var(--text-dim); font-style: italic; }

/* ── Action Section ────────────────────────────────── */
.action-section {
  flex-shrink: 0;
  padding: 10px 16px 14px;
  background: var(--bg-card);
  border-top: 1px solid var(--border);
  min-height: 150px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.action-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.action-grid button { padding: 10px 8px; font-size: 14px; }

.sub-panel { display: flex; flex-direction: column; gap: 8px; }
.sub-header { display: flex; align-items: center; gap: 10px; }
.sub-title { font-weight: 600; font-size: 14px; }
.sub-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.spell-btn, .item-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; position: relative; }
.spell-cost { font-size: 10px; opacity: 0.7; }
.item-qty { font-size: 10px; opacity: 0.7; }

/* ── Boss Exam ──────────────────────────────────────── */
.boss-progress { display: flex; gap: 4px; }
.boss-dot { font-size: 14px; opacity: 0.3; transition: all 0.2s; }
.boss-dot.boss-current { opacity: 1; transform: scale(1.3); filter: drop-shadow(0 0 4px rgba(255,200,50,0.6)); }
.boss-dot.boss-done-won { opacity: 1; }
.boss-dot.boss-done-lost { opacity: 0.6; filter: grayscale(0.5); }

/* ── Scorecard ─────────────────────────────────────── */
.scorecard { text-align: center; padding: 4px 0; }
.scorecard-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
.scorecard-grade { font-size: 48px; font-weight: 900; line-height: 1; margin-bottom: 4px; }
.grade-s { color: #fbbf24; text-shadow: 0 0 20px rgba(251,191,36,0.5); }
.grade-a { color: #34d399; }
.grade-b { color: #60a5fa; }
.grade-c { color: #a78bfa; }
.grade-d { color: #fb923c; }
.grade-f { color: #f87171; }
.scorecard-score { font-size: 14px; color: var(--text-dim); margin-bottom: 12px; }
.scorecard-results { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.scorecard-row { display: flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 6px; font-size: 13px; }
.score-won { background: rgba(52,211,153,0.1); }
.score-lost { background: rgba(248,113,113,0.1); }
.score-icon { font-size: 14px; }
.score-name { flex: 1; text-align: left; font-weight: 600; }
.score-turns { font-size: 11px; color: var(--text-dim); }

/* ── End Panel ──────────────────────────────────────── */
.end-panel { text-align: center; padding: 8px; }
.end-text { font-size: 24px; font-weight: 900; margin-bottom: 4px; }
.end-text.win { color: var(--success); }
.end-text.lose { color: var(--enemy); }
.end-text.draw { color: var(--warning); }
.end-reason { font-size: 13px; color: var(--text-dim); margin-bottom: 12px; }
</style>
