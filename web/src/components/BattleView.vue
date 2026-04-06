<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";

interface CharState {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  statusEffects: { type: string; turnsRemaining: number }[];
  isDefending: boolean;
  spells: { id: string; name: string; currentCooldown: number }[];
  inventory: { id: string; name: string; quantity: number }[];
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
  gameCategory?: "1v1" | "boss_exam";
  bossExamResults?: Array<{ bossId: string; bossName: string; won: boolean; turns: number }>;
  bossExamScorecard?: { results: any[]; completed: number; total: number; wins: number; allDone: boolean; grade: string } | null;
  currentBossIndex?: number;
  currentBossEmoji?: string;
  currentBossName?: string;
  bossExamBosses?: Array<{ id: string; name: string; emoji: string; title: string }>;
}>();

const emit = defineEmits<{
  action: [action: { type: string; spellId?: string; itemId?: string; target?: string }];
  reset: [];
}>();

// ── Action Panel State ────────────────────────────────
const actionMode = ref<"main" | "spells" | "items">("main");

// ── Computed ──────────────────────────────────────────
const playerHpPct = computed(() =>
  props.player.maxHp > 0 ? (props.player.hp / props.player.maxHp) * 100 : 0
);
const playerMpPct = computed(() =>
  props.player.maxMp > 0 ? (props.player.mp / props.player.maxMp) * 100 : 0
);
const enemyHpPct = computed(() =>
  props.enemy.maxHp > 0 ? (props.enemy.hp / props.enemy.maxHp) * 100 : 0
);
const enemyMpPct = computed(() =>
  props.enemy.maxMp > 0 ? (props.enemy.mp / props.enemy.maxMp) * 100 : 0
);

function hpColor(pct: number): string {
  if (pct > 60) return "var(--hp)";
  if (pct > 30) return "var(--hp-mid)";
  return "var(--hp-low)";
}

const availableSpells = computed(() =>
  props.player.spells.filter(
    (s) => s.currentCooldown === 0
  )
);

const availableItems = computed(() =>
  props.player.inventory.filter((i) => i.quantity > 0)
);

// Spell cost map (approximate, for display)
const spellCosts: Record<string, number> = {
  fire: 12, ice: 14, lightning: 18, heal: 15,
  shield: 10, poison: 10, drain: 16, meteor: 35,
};

// ── Actions ───────────────────────────────────────────
function doAction(type: string, extra?: { spellId?: string; itemId?: string }) {
  const target = ["heal", "shield"].includes(extra?.spellId || "")
    ? "self"
    : undefined;
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
  burn: "🔥",
  freeze: "❄️",
  poison: "☠️",
  shield: "🛡️",
  defending: "🛡️",
  haste: "💨",
  slow: "🐌",
  regen: "💚",
  blind: "🕶️",
};

function statusLabel(type: string, turns: number): string {
  return `${statusEmoji[type] || "●"} ${type} (${turns})`;
}
</script>

<template>
  <div class="arena">
    <!-- ── Header ──────────────────────────────────────── -->
    <header class="header">
      <span class="title" v-if="gameCategory === 'boss_exam'">👹 Boss Exam</span>
      <span class="title" v-else>⚔️ RPG Arena</span>
      <span class="turn-badge" v-if="phase === 'battle' || (phase === 'boss_exam')">
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

    <!-- ── Status Bars ─────────────────────────────────── -->
    <section class="status-section">
      <!-- Player -->
      <div class="char-card player-card" :class="{ 'your-turn-glow': myTurn }">
        <div class="char-header">
          <span class="char-name">{{ player.name || "You" }}</span>
          <span class="char-class">{{ playerClass }}</span>
        </div>
        <div class="bar-container">
          <span class="bar-label" style="color: var(--hp)">HP</span>
          <div class="bar-track">
            <div
              class="bar-fill"
              :style="{ width: playerHpPct + '%', background: hpColor(playerHpPct) }"
            />
          </div>
          <span class="bar-value">{{ player.hp }}/{{ player.maxHp }}</span>
        </div>
        <div class="bar-container">
          <span class="bar-label" style="color: var(--mp)">MP</span>
          <div class="bar-track">
            <div
              class="bar-fill"
              :style="{ width: playerMpPct + '%', background: 'var(--mp)' }"
            />
          </div>
          <span class="bar-value">{{ player.mp }}/{{ player.maxMp }}</span>
        </div>
        <div class="status-tags" v-if="player.statusEffects.length">
          <span
            v-for="s in player.statusEffects"
            :key="s.type"
            class="status-tag"
          >{{ statusLabel(s.type, s.turnsRemaining) }}</span>
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
            <div
              class="bar-fill"
              :style="{ width: enemyHpPct + '%', background: hpColor(enemyHpPct) }"
            />
          </div>
          <span class="bar-value">{{ enemy.hp }}/{{ enemy.maxHp }}</span>
        </div>
        <div class="bar-container">
          <span class="bar-label" style="color: var(--mp)">MP</span>
          <div class="bar-track">
            <div
              class="bar-fill"
              :style="{ width: enemyMpPct + '%', background: 'var(--mp)' }"
            />
          </div>
          <span class="bar-value">{{ enemy.mp }}/{{ enemy.maxMp }}</span>
        </div>
        <div class="status-tags" v-if="enemy.statusEffects.length">
          <span
            v-for="s in enemy.statusEffects"
            :key="s.type"
            class="status-tag"
          >{{ statusLabel(s.type, s.turnsRemaining) }}</span>
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

      <!-- Enemy thinking indicator — live feed -->
      <div v-if="enemyThinking" class="thinking-panel">
        <div class="thinking-header">
          <span class="thinking-label">🧠 Enemy thinking</span>
          <span class="typing-dots">
            <span class="typing-dot">.</span>
            <span class="typing-dot">.</span>
            <span class="typing-dot">.</span>
          </span>
        </div>
        <div v-if="thinkingSteps.length > 0" class="thinking-steps">
          <div
            v-for="(step, idx) in thinkingSteps"
            :key="idx"
            class="thinking-step"
            :class="'step-' + step.type"
          >
            <span class="step-icon">
              {{ step.type === 'thinking' ? '💭' : step.type === 'tool_call' ? '🔧' : '📋' }}
            </span>
            <span class="step-text">
              {{ step.type === 'tool_call' ? step.toolName : step.type === 'tool_result' ? step.text : step.text }}
            </span>
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
            <div class="scorecard-score">
              {{ bossExamScorecard.wins }} / {{ bossExamScorecard.total }} Bosses Defeated
            </div>
            <div class="scorecard-results">
              <div
                v-for="(r, idx) in bossExamScorecard.results"
                :key="idx"
                class="scorecard-row"
                :class="r.won ? 'score-won' : 'score-lost'"
              >
                <span class="score-icon">{{ r.won ? '✅' : '❌' }}</span>
                <span class="score-name">{{ r.bossName }}</span>
                <span class="score-turns">{{ r.turns }} turns</span>
              </div>
            </div>
          </div>
        </template>
        <!-- 1v1 Result -->
        <template v-else>
          <div class="end-text" :class="winner === 'player' ? 'win' : winner === 'enemy' || winner === 'boss' ? 'lose' : 'draw'">
            {{ winner === 'player' ? '🏆 Victory!' : winner === 'enemy' || winner === 'boss' ? '💀 Defeat!' : '🤝 Draw!' }}
          </div>
          <div class="end-reason">{{ winnerReason }}</div>
        </template>
        <button class="btn-accent" @click="emit('reset')">⚔️ Play Again</button>
      </div>

      <!-- Main Actions -->
      <div v-else-if="actionMode === 'main'" class="action-grid">
        <button class="btn-attack" :disabled="!myTurn" @click="doAction('attack')">
          ⚔️ Attack
        </button>
        <button class="btn-defend" :disabled="!myTurn" @click="doAction('defend')">
          🛡️ Defend
        </button>
        <button class="btn-spell" :disabled="!myTurn" @click="actionMode = 'spells'">
          ✨ Spells
        </button>
        <button class="btn-item" :disabled="!myTurn" @click="actionMode = 'items'">
          🧪 Items
        </button>
        <button class="btn-wait" :disabled="!myTurn" @click="doAction('wait')">
          ⏳ Wait
        </button>
        <button class="btn-flee" :disabled="!myTurn" @click="doAction('flee')">
          🏃 Flee
        </button>
      </div>

      <!-- Spell Selection -->
      <div v-else-if="actionMode === 'spells'" class="sub-panel">
        <div class="sub-header">
          <button class="btn btn-sm" @click="actionMode = 'main'">← Back</button>
          <span class="sub-title">✨ Choose Spell ({{ player.mp }} MP)</span>
        </div>
        <div class="sub-grid">
          <button
            v-for="s in availableSpells"
            :key="s.id"
            class="btn btn-sm spell-btn"
            :disabled="!myTurn || (spellCosts[s.id] || 0) > player.mp"
            @click="doAction('cast_spell', { spellId: s.id })"
          >
            {{ s.name }}
            <span class="spell-cost">{{ spellCosts[s.id] || '?' }} MP</span>
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
/* ── Layout Principle ──────────────────────────────────
   Header, status bars, and action panel are FIXED size.
   Only the chat area stretches / scrolls.
   This prevents layout shifts when content changes.
   ─────────────────────────────────────────────────── */

.arena {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh; /* mobile viewport */
  max-width: 600px;
  margin: 0 auto;
  padding: 0;
  overflow: hidden;
}

/* ── Header — fixed ─────────────────────────────────── */
.header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}
.title {
  font-weight: 700;
  font-size: 16px;
}
.turn-badge {
  font-size: 12px;
  font-weight: 700;
  background: var(--accent);
  color: #fff;
  padding: 3px 10px;
  border-radius: 20px;
}

/* ── Status Section — fixed height ──────────────────── */
.status-section {
  flex-shrink: 0;
  display: flex;
  align-items: stretch; /* both cards same height */
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
  /* prevent content from resizing the card */
  overflow: hidden;
}
.player-card.your-turn-glow {
  border-color: var(--accent);
}
.char-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}
.char-name {
  font-weight: 700;
  font-size: 13px;
}
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
.bar-label {
  font-size: 10px;
  font-weight: 700;
  width: 18px;
  flex-shrink: 0;
}
.bar-track {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}
.bar-value {
  font-size: 10px;
  color: var(--text-dim);
  width: 55px;
  flex-shrink: 0;
  text-align: right;
}
.status-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 3px;
  min-height: 0; /* don't reserve space when empty */
}
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

/* ── Chat Section — ONLY section that scrolls ───────── */
.chat-section {
  flex: 1;
  min-height: 0; /* critical: allows flex child to shrink below content size */
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
.msg-player {
  align-self: flex-end;
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.25);
  color: #93bbfd;
}
.msg-enemy {
  align-self: flex-start;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}
.msg-status {
  align-self: center;
  background: rgba(234, 179, 8, 0.1);
  color: var(--hp-mid);
  font-size: 12px;
  text-align: center;
}
.msg-info {
  align-self: center;
  color: var(--text-dim);
  font-size: 12px;
  text-align: center;
}
.msg-system {
  align-self: center;
  background: rgba(108, 99, 255, 0.1);
  border: 1px solid rgba(108, 99, 255, 0.2);
  color: #a5a0ff;
  font-weight: 600;
  text-align: center;
}
.msg-error {
  align-self: center;
  color: #f87171;
  font-size: 12px;
}
.msg-thinking {
  align-self: flex-start;
  color: var(--text-dim);
  font-size: 13px;
  font-style: italic;
}

/* ── Thinking Panel (live feed) ────────────────────── */
.thinking-panel {
  align-self: flex-start;
  width: 85%;
  background: rgba(139, 92, 246, 0.08);
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
}
.thinking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.thinking-label {
  font-weight: 600;
  color: #a78bfa;
}
.typing-dots {
  display: inline-flex;
  gap: 2px;
}
.thinking-steps {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 120px;
  overflow-y: auto;
}
.thinking-step {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 2px 0;
  color: var(--text-dim);
  line-height: 1.4;
}
.step-icon {
  flex-shrink: 0;
  font-size: 11px;
}
.step-text {
  word-break: break-word;
}
.step-tool_call .step-text {
  color: #c4b5fd;
  font-weight: 600;
}
.step-tool_result .step-text {
  color: #86efac;
  font-size: 11px;
  opacity: 0.8;
}
.step-thinking .step-text {
  color: #fde68a;
  font-style: italic;
  font-size: 11px;
}
.step-waiting .step-text {
  color: var(--text-dim);
  font-style: italic;
}

/* ── Action Section — fixed height via min-height ───── */
.action-section {
  flex-shrink: 0;
  padding: 10px 16px 14px;
  background: var(--bg-card);
  border-top: 1px solid var(--border);
  /* fixed height prevents layout shift when switching panels */
  min-height: 150px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.action-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.action-grid button {
  padding: 10px 8px;
  font-size: 14px;
}

.sub-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sub-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sub-title {
  font-weight: 600;
  font-size: 14px;
}
.sub-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.spell-btn, .item-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  position: relative;
}
.spell-cost {
  font-size: 10px;
  opacity: 0.7;
}
.item-qty {
  font-size: 10px;
  opacity: 0.7;
}

/* ── Boss Exam ──────────────────────────────────────── */
.boss-progress {
  display: flex;
  gap: 4px;
}
.boss-dot {
  font-size: 14px;
  opacity: 0.3;
  transition: all 0.2s;
}
.boss-dot.boss-current {
  opacity: 1;
  transform: scale(1.3);
  filter: drop-shadow(0 0 4px rgba(255, 200, 50, 0.6));
}
.boss-dot.boss-done-won {
  opacity: 1;
}
.boss-dot.boss-done-lost {
  opacity: 0.6;
  filter: grayscale(0.5);
}

/* ── Scorecard ─────────────────────────────────────── */
.scorecard {
  text-align: center;
  padding: 4px 0;
}
.scorecard-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 8px;
}
.scorecard-grade {
  font-size: 48px;
  font-weight: 900;
  line-height: 1;
  margin-bottom: 4px;
}
.grade-s { color: #fbbf24; text-shadow: 0 0 20px rgba(251, 191, 36, 0.5); }
.grade-a { color: #34d399; }
.grade-b { color: #60a5fa; }
.grade-c { color: #a78bfa; }
.grade-d { color: #fb923c; }
.grade-f { color: #f87171; }
.scorecard-score {
  font-size: 14px;
  color: var(--text-dim);
  margin-bottom: 12px;
}
.scorecard-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.scorecard-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.score-won { background: rgba(52, 211, 153, 0.1); }
.score-lost { background: rgba(248, 113, 113, 0.1); }
.score-icon { font-size: 14px; }
.score-name { flex: 1; text-align: left; font-weight: 600; }
.score-turns { font-size: 11px; color: var(--text-dim); }

/* ── End Panel ──────────────────────────────────────── */
.end-panel {
  text-align: center;
  padding: 8px;
}
.end-text {
  font-size: 24px;
  font-weight: 900;
  margin-bottom: 4px;
}
.end-text.win { color: var(--success); }
.end-text.lose { color: var(--enemy); }
.end-text.draw { color: var(--warning); }
.end-reason {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 12px;
}
</style>
