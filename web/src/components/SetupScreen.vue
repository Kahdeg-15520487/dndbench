<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";

const props = defineProps<{
  connected: boolean;
}>();

const emit = defineEmits<{
  start: [config: {
    name: string;
    charClass: string;
    enemyMode: string;
    llmConfigId?: number;
    gameCategory: "1v1" | "boss_exam";
  }];
}>();

const name = ref("Hero");
const charClass = ref("warrior");
const enemyMode = ref("mock");
const gameCategory = ref<"1v1" | "boss_exam">("1v1");
const selectedLlmConfigId = ref<number | null>(null);

// LLM configs from DB
interface LLMConfigOption {
  id: number;
  name: string;
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  isDefault: boolean;
}
const llmConfigs = ref<LLMConfigOption[]>([]);

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

// ── Fetch LLM configs from API ──────────────────────────

async function fetchLLMConfigs() {
  try {
    const base = import.meta.env.DEV ? "http://localhost:3001" : "";
    const res = await fetch(`${base}/api/llm-configs`);
    if (res.ok) {
      llmConfigs.value = await res.json();
      // Auto-select the default
      const defaultConfig = llmConfigs.value.find((c) => c.isDefault);
      if (defaultConfig) {
        selectedLlmConfigId.value = defaultConfig.id;
      } else if (llmConfigs.value.length > 0) {
        selectedLlmConfigId.value = llmConfigs.value[0].id;
      }
    }
  } catch {
    // Server might not be up yet
  }
}

onMounted(fetchLLMConfigs);

// ── Config form ─────────────────────────────────────────

const showConfigForm = ref(false);
const configForm = ref({
  name: "",
  model: "",
  apiKey: "",
  baseUrl: "",
  isDefault: false,
});
const configFormError = ref("");

function resetConfigForm() {
  configForm.value = { name: "", model: "", apiKey: "", baseUrl: "", isDefault: false };
  configFormError.value = "";
}

async function saveConfig() {
  const f = configForm.value;
  if (!f.name.trim() || !f.model.trim()) {
    configFormError.value = "Name and model are required.";
    return;
  }

  try {
    const base = import.meta.env.DEV ? "http://localhost:3001" : "";
    const res = await fetch(`${base}/api/llm-configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name.trim(),
        model: f.model.trim(),
        apiKey: f.apiKey || undefined,
        baseUrl: f.baseUrl || undefined,
        isDefault: f.isDefault,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      configFormError.value = err.error || "Failed to save";
      return;
    }

    const saved = await res.json();
    await fetchLLMConfigs();
    selectedLlmConfigId.value = saved.id;
    showConfigForm.value = false;
    resetConfigForm();
  } catch (err: any) {
    configFormError.value = err.message;
  }
}

async function deleteConfig(id: number) {
  const base = import.meta.env.DEV ? "http://localhost:3001" : "";
  await fetch(`${base}/api/llm-configs/${id}`, { method: "DELETE" });
  await fetchLLMConfigs();
  if (selectedLlmConfigId.value === id) {
    selectedLlmConfigId.value = llmConfigs.value[0]?.id ?? null;
  }
}

// ── Start ───────────────────────────────────────────────

const canStart = computed(() => {
  if (!props.connected) return false;
  if (gameCategory.value === "1v1" && enemyMode.value === "llm" && !selectedLlmConfigId.value && llmConfigs.value.length === 0) return false;
  return true;
});

function onStart() {
  emit("start", {
    name: name.value || "Hero",
    charClass: charClass.value,
    enemyMode: enemyMode.value,
    gameCategory: gameCategory.value,
    ...(enemyMode.value === "llm" && selectedLlmConfigId.value
      ? { llmConfigId: selectedLlmConfigId.value }
      : {}),
  });
}
</script>

<template>
  <div class="setup">
    <div class="setup-card">
      <h1>⚔️ RPG Arena</h1>
      <p class="subtitle">Battle an AI opponent in turn-based combat</p>

      <!-- ── Game Category ─────────────────────────── -->
      <div class="form-group">
        <label>Game Mode</label>
        <div class="category-toggle">
          <button
            class="btn"
            :class="{ active: gameCategory === '1v1' }"
            @click="gameCategory = '1v1'"
          >
            ⚔️ 1v1 Arena
          </button>
          <button
            class="btn"
            :class="{ active: gameCategory === 'boss_exam' }"
            @click="gameCategory = 'boss_exam'"
          >
            👹 Boss Exam
          </button>
        </div>
        <p class="hint" v-if="gameCategory === '1v1'">
          Classic duel — fight a random class AI opponent.
        </p>
        <p class="hint" v-if="gameCategory === 'boss_exam'">
          Fight 5 bosses of increasing difficulty. Fresh HP each fight. Graded at the end.
        </p>
      </div>

      <!-- ── Name ─────────────────────────────────── -->
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

      <!-- ── Class ────────────────────────────────── -->
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

      <!-- ── Enemy Mode ───────────────────────────── -->
      <div class="form-group" v-if="gameCategory === '1v1'">
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
        <p class="hint" v-if="enemyMode === 'mock'">
          Fast heuristic AI. No API key needed.
        </p>
      </div>

      <!-- ── LLM Config ───────────────────────────── -->
      <div class="form-group" v-if="enemyMode === 'llm'">
        <label>LLM Configuration</label>

        <!-- Config list -->
        <div v-if="!showConfigForm" class="config-list">
          <div v-if="llmConfigs.length === 0" class="config-empty">
            No LLM configs yet. Add one below.
          </div>
          <div
            v-for="c in llmConfigs"
            :key="c.id"
            class="config-item"
            :class="{ selected: selectedLlmConfigId === c.id }"
            @click="selectedLlmConfigId = c.id"
          >
            <div class="config-info">
              <span class="config-name">
                {{ c.name }}
                <span v-if="c.isDefault" class="default-badge">default</span>
              </span>
              <span class="config-meta">
                {{ c.model }}
                <span v-if="c.baseUrl" class="config-url">{{ c.baseUrl }}</span>
                <span v-if="c.apiKey" class="config-key">{{ c.apiKey }}</span>
              </span>
            </div>
            <button class="btn-delete" @click.stop="deleteConfig(c.id)" title="Delete">✕</button>
          </div>

          <button class="btn btn-sm btn-add" @click="showConfigForm = true">
            + Add New Config
          </button>
        </div>

        <!-- Add config form -->
        <div v-if="showConfigForm" class="config-form">
          <div class="form-row">
            <label>Name</label>
            <input v-model="configForm.name" placeholder="e.g. GPT-4o Mini" />
          </div>
          <div class="form-row">
            <label>Model</label>
            <input v-model="configForm.model" placeholder="e.g. gpt-4o-mini, llama3" />
          </div>
          <div class="form-row">
            <label>API Key <span class="optional">(optional)</span></label>
            <input v-model="configForm.apiKey" type="password" placeholder="sk-... (not needed for Ollama)" />
          </div>
          <div class="form-row">
            <label>Base URL <span class="optional">(optional)</span></label>
            <input v-model="configForm.baseUrl" placeholder="https://api.openai.com/v1" />
          </div>
          <div class="form-row checkbox-row">
            <label>
              <input type="checkbox" v-model="configForm.isDefault" />
              Set as default
            </label>
          </div>
          <div v-if="configFormError" class="form-error">{{ configFormError }}</div>
          <div class="form-actions">
            <button class="btn btn-sm" @click="showConfigForm = false; resetConfigForm()">Cancel</button>
            <button class="btn btn-sm btn-accent" @click="saveConfig">Save</button>
          </div>
        </div>
      </div>

      <button class="btn-accent start-btn" :disabled="!canStart" @click="onStart">
        {{ connected
          ? gameCategory === 'boss_exam' ? '👹 Start Boss Exam' : '⚔️ Start Battle'
          : 'Connecting...' }}
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
  overflow-y: auto;
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
.form-group > label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
input[type="text"],
input[type="password"] {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 15px;
  font-family: inherit;
  box-sizing: border-box;
}
input:focus {
  outline: none;
  border-color: var(--accent);
}

/* ── Class Grid ─────────────────────────────────────── */
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
.class-emoji { font-size: 24px; margin-bottom: 4px; }
.class-name { font-weight: 700; font-size: 14px; color: var(--class-color); }
.class-desc { font-size: 11px; color: var(--text-dim); margin: 2px 0; }
.class-stats { font-size: 10px; color: var(--text-dim); font-family: monospace; }

/* ── Category Toggle ────────────────────────────────── */
.category-toggle {
  display: flex;
  gap: 8px;
}
.category-toggle .btn {
  flex: 1;
}
.category-toggle .btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

/* ── Mode Toggle ────────────────────────────────────── */
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

/* ── LLM Config List ───────────────────────────────── */
.config-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.config-empty {
  font-size: 13px;
  color: var(--text-dim);
  padding: 12px;
  text-align: center;
  background: var(--bg);
  border-radius: 8px;
}
.config-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg);
  border: 2px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.config-item:hover {
  border-color: var(--accent);
}
.config-item.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
}
.config-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.config-name {
  font-weight: 600;
  font-size: 14px;
}
.default-badge {
  font-size: 9px;
  background: var(--accent);
  color: #fff;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.config-meta {
  font-size: 11px;
  color: var(--text-dim);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.config-url { font-family: monospace; }
.config-key { font-family: monospace; opacity: 0.6; }
.btn-delete {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s;
}
.btn-delete:hover {
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
}
.btn-add {
  margin-top: 4px;
}

/* ── Config Form ────────────────────────────────────── */
.config-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg);
  padding: 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-row > label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
}
.optional {
  font-weight: 400;
  opacity: 0.6;
}
.checkbox-row label {
  flex-direction: row !important;
  align-items: center;
  gap: 6px;
}
.checkbox-row input[type="checkbox"] {
  width: 16px;
  height: 16px;
}
.form-error {
  font-size: 12px;
  color: #f87171;
}
.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* ── Start Button ───────────────────────────────────── */
.start-btn {
  width: 100%;
  padding: 12px;
  font-size: 16px;
  margin-top: 8px;
}
</style>
