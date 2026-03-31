<script setup lang="ts">
import { ref, computed } from "vue";

const props = defineProps<{
  connected: boolean;
}>();

const emit = defineEmits<{
  start: [config: { name: string; charClass: string; enemyMode: string }];
}>();

const name = ref("Hero");
const charClass = ref("warrior");
const enemyMode = ref("mock");

const classes = [
  {
    id: "warrior",
    name: "Warrior",
    emoji: "⚔️",
    desc: "High HP & STR. Melee powerhouse.",
    stats: "HP:120 STR:18 DEF:15 SPD:10",
    color: "#ef4444",
  },
  {
    id: "mage",
    name: "Mage",
    emoji: "🔮",
    desc: "All 8 spells. Glass cannon.",
    stats: "HP:70 MP:100 MAG:22 SPD:12",
    color: "#7c3aed",
  },
  {
    id: "rogue",
    name: "Rogue",
    emoji: "🗡️",
    desc: "High crit, dodge & speed.",
    stats: "HP:85 SPD:22 LCK:18 STR:14",
    color: "#22c55e",
  },
  {
    id: "paladin",
    name: "Paladin",
    emoji: "🛡️",
    desc: "Tanky healer with Elixir.",
    stats: "HP:110 DEF:18 MP:60 MAG:12",
    color: "#eab308",
  },
];

function onStart() {
  emit("start", {
    name: name.value || "Hero",
    charClass: charClass.value,
    enemyMode: enemyMode.value,
  });
}
</script>

<template>
  <div class="setup">
    <div class="setup-card">
      <h1>⚔️ RPG Arena</h1>
      <p class="subtitle">Battle an AI opponent in turn-based combat</p>

      <div class="form-group">
        <label>Your Name</label>
        <input
          v-model="name"
          type="text"
          placeholder="Enter your name..."
          maxlength="20"
          @keyup.enter="onStart"
        />
      </div>

      <div class="form-group">
        <label>Choose Your Class</label>
        <div class="class-grid">
          <button
            v-for="c in classes"
            :key="c.id"
            class="class-card"
            :class="{ selected: charClass === c.id }"
            :style="{ '--class-color': c.color }"
            @click="charClass = c.id"
          >
            <span class="class-emoji">{{ c.emoji }}</span>
            <span class="class-name">{{ c.name }}</span>
            <span class="class-desc">{{ c.desc }}</span>
            <span class="class-stats">{{ c.stats }}</span>
          </button>
        </div>
      </div>

      <div class="form-group">
        <label>Enemy Mode</label>
        <div class="mode-toggle">
          <button
            class="btn"
            :class="{ active: enemyMode === 'mock' }"
            @click="enemyMode = 'mock'"
          >
            🤖 Mock AI
          </button>
          <button
            class="btn"
            :class="{ active: enemyMode === 'llm' }"
            @click="enemyMode = 'llm'"
          >
            🧠 LLM Agent
          </button>
        </div>
        <p class="hint">
          {{ enemyMode === 'mock' ? 'Fast heuristic AI. No API key needed.' : 'Uses OpenAI API. Requires OPENAI_API_KEY on server.' }}
        </p>
      </div>

      <button class="btn-accent start-btn" :disabled="!connected" @click="onStart">
        {{ connected ? '⚔️ Start Battle' : 'Connecting...' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.setup {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.setup-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 32px;
  max-width: 520px;
  width: 100%;
}
h1 {
  text-align: center;
  font-size: 28px;
  margin-bottom: 4px;
}
.subtitle {
  text-align: center;
  color: var(--text-dim);
  margin-bottom: 24px;
  font-size: 14px;
}
.form-group {
  margin-bottom: 20px;
}
.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
input {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 15px;
  font-family: inherit;
}
input:focus {
  outline: none;
  border-color: var(--accent);
}

.class-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.class-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  background: var(--bg);
  border: 2px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}
.class-card:hover {
  border-color: var(--class-color);
  background: var(--bg-card-light);
}
.class-card.selected {
  border-color: var(--class-color);
  background: color-mix(in srgb, var(--class-color) 15%, var(--bg-card));
  box-shadow: 0 0 12px color-mix(in srgb, var(--class-color) 25%, transparent);
}
.class-emoji {
  font-size: 24px;
  margin-bottom: 4px;
}
.class-name {
  font-weight: 700;
  font-size: 14px;
  color: var(--class-color);
}
.class-desc {
  font-size: 11px;
  color: var(--text-dim);
  margin: 2px 0;
}
.class-stats {
  font-size: 10px;
  color: var(--text-dim);
  font-family: monospace;
}

.mode-toggle {
  display: flex;
  gap: 8px;
}
.mode-toggle .btn {
  flex: 1;
}
.mode-toggle .btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 6px;
}

.start-btn {
  width: 100%;
  padding: 12px;
  font-size: 16px;
  margin-top: 8px;
}
</style>
