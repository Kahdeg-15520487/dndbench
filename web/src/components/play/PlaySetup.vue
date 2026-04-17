<template>
  <div class="setup">
    <div class="setup-card card">
      <h2>⚔️ Play</h2>
      <p class="subtitle">Battle against AI agents</p>

      <div class="form-group">
        <label class="form-label">Name</label>
        <input v-model="name" class="form-input" placeholder="Enter your name" @keyup.enter="onStart" />
      </div>

      <div class="form-group">
        <label class="form-label">Class</label>
        <div class="class-grid">
          <button
            v-for="c in classes" :key="c.id"
            class="class-card"
            :class="{ 'class-card--selected': selectedClass === c.id }"
            @click="selectedClass = c.id"
          >
            <span class="class-icon">{{ c.emoji }}</span>
            <span class="class-name">{{ c.name }}</span>
            <span class="class-desc">{{ c.desc }}</span>
          </button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Enemy</label>
        <div class="toggle-group">
          <button class="chip" :class="{ 'chip--selected': enemyMode === 'mock' }" @click="enemyMode = 'mock'">🤖 Heuristic AI</button>
          <button class="chip" :class="{ 'chip--selected': enemyMode === 'llm' }" @click="enemyMode = 'llm'">🧠 LLM</button>
        </div>
      </div>

      <div v-if="enemyMode === 'llm'" class="form-group">
        <label class="form-label">LLM Configuration</label>
        <select v-if="settings.configs.length > 0" v-model="llmConfigId" class="form-select">
          <option :value="null" disabled>Select a config…</option>
          <option v-for="c in settings.configs" :key="c.id" :value="c.id">{{ c.name }} ({{ c.model }})</option>
        </select>
        <p v-else class="form-hint">No LLM configs found. <router-link to="/settings">Add one</router-link>.</p>
      </div>

      <button class="btn btn-primary" :disabled="!canStart" @click="onStart">
        ⚔️ Start Battle
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useSettingsStore } from '../../stores/settings';

const emit = defineEmits<{ start: [config: any] }>();
const settings = useSettingsStore();

const name = ref('Hero');
const selectedClass = ref('warrior');
const enemyMode = ref<'mock' | 'llm'>('mock');
const llmConfigId = ref<number | null>(null);

const classes = [
  { id: 'warrior', emoji: '⚔️', name: 'Warrior', desc: 'High HP, melee focused' },
  { id: 'mage', emoji: '🔮', name: 'Mage', desc: 'Spells, ranged damage' },
  { id: 'rogue', emoji: '🗡️', name: 'Rogue', desc: 'Sneak attack, evasion' },
  { id: 'paladin', emoji: '🛡️', name: 'Paladin', desc: 'Tanky, healing, smites' },
];

const canStart = computed(() => {
  if (!selectedClass.value) return false;
  if (enemyMode.value === 'llm' && !llmConfigId.value) return false;
  return true;
});

function onStart() {
  if (!canStart.value) return;
  emit('start', {
    type: 'start_battle',
    name: name.value || 'Hero',
    class: selectedClass.value,
    enemyMode: enemyMode.value,
    llmConfigId: llmConfigId.value || undefined,
  });
}

onMounted(() => { settings.fetchConfigs(); });
</script>

<style scoped>
.setup { display: flex; justify-content: center; }
.setup-card { max-width: 480px; width: 100%; }
.setup-card h2 { margin: 0; }
.subtitle { margin: var(--space-1) 0 var(--space-4); color: var(--text-dim); }
.class-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
.class-card {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md);
  background: transparent; color: var(--text); cursor: pointer;
  transition: all var(--transition-fast);
}
.class-card:hover { border-color: var(--accent); background: var(--bg-hover); }
.class-card--selected { border-color: var(--accent); background: rgba(88, 166, 255, 0.1); }
.class-icon { font-size: 1.5rem; }
.class-name { font-weight: 600; font-size: var(--text-sm); }
.class-desc { font-size: var(--text-xs); color: var(--text-dim); text-align: center; }
.toggle-group { display: flex; gap: var(--space-2); }
.chip {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: var(--space-1) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: transparent; color: var(--text-dim); font-size: var(--text-sm); cursor: pointer;
  transition: all var(--transition-fast);
}
.chip:hover { border-color: var(--accent); }
.chip--selected { background: rgba(88, 166, 255, 0.15); border-color: var(--accent); color: var(--accent); }
.form-hint { font-size: var(--text-xs); color: var(--text-dim); margin-top: var(--space-1); }
.btn { width: 100%; justify-content: center; margin-top: var(--space-4); }
</style>
