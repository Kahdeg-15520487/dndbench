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
  type: "system" | "player" | "enemy" | "status" | "info" | "error";
  text: string;
}

const props = defineProps<{
  player: CharState;
  enemy: CharState;
  playerClass: string;
  enemyClass: string;
  messages: ChatMessage[];
  myTurn: boolean;
  enemyThinking: boolean;
  turnNumber: number;
  winner: string | null;
  winnerReason: string;
  phase: string;
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
      <span class="title">⚔️ RPG Arena</span>
      <span class="turn-badge" v-if="phase === 'battle' || phase === 'ended'">
        Turn {{ turnNumber }}
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

      <!-- Enemy -->
      <div class="char-card enemy-card">
        <div class="char-header">
          <span class="char-name">{{ enemy.name || "Enemy" }}</span>
          <span class="char-class">{{ enemyClass }}</span>
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

      <!-- Enemy thinking indicator -->
      <div v-if="enemyThinking" class="chat-msg msg-thinking">
        <span class="msg-text">
          🤔 Enemy is thinking
          <span class="typing-dot">.</span>
          <span class="typing-dot">.</span>
          <span class="typing-dot">.</span>
        </span>
      </div>
    </section>

    <!-- ── Action Panel ────────────────────────────────── -->
    <section class="action-section">
      <!-- Battle Ended -->
      <div v-if="phase === 'ended'" class="end-panel">
        <div class="end-text" :class="winner === 'player' ? 'win' : winner === 'enemy' ? 'lose' : 'draw'">
          {{ winner === 'player' ? '🏆 Victory!' : winner === 'enemy' ? '💀 Defeat!' : '🤝 Draw!' }}
        </div>
        <div class="end-reason">{{ winnerReason }}</div>
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
.arena {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 600px;
  margin: 0 auto;
  padding: 0;
}

/* ── Header ─────────────────────────────────────────── */
.header {
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

/* ── Status Section ─────────────────────────────────── */
.status-section {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}
.char-card {
  flex: 1;
  min-width: 0;
  padding: 10px;
  background: var(--bg);
  border-radius: 10px;
  border: 1px solid var(--border);
}
.player-card.your-turn-glow {
  border-color: var(--accent);
}
.char-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.char-name {
  font-weight: 700;
  font-size: 14px;
}
.char-class {
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.vs-badge {
  font-weight: 900;
  font-size: 12px;
  color: var(--text-dim);
  text-shadow: 0 0 8px rgba(108, 99, 255, 0.3);
}

/* ── Chat Section ───────────────────────────────────── */
.chat-section {
  flex: 1;
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

/* ── Action Section ─────────────────────────────────── */
.action-section {
  padding: 12px 16px 16px;
  background: var(--bg-card);
  border-top: 1px solid var(--border);
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
