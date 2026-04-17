<template>
  <div class="create-form card">
    <h3 class="form-title">🏆 New Tournament</h3>

    <div class="form-group">
      <label class="form-label">Models</label>
      <LoadingSpinner v-if="loadingModels" size="sm" label="Discovering models…" />
      <ErrorBanner v-else-if="modelError" :message="modelError" />
      <div v-else class="model-chips">
        <button
          v-for="model in availableModels"
          :key="model"
          class="chip"
          :class="{ 'chip--selected': selectedModels.has(model) }"
          :title="model === HEURISTIC ? 'Rule-based baseline agent (no LLM required)' : model"
          @click="toggleModel(model)"
        >
          {{ model === HEURISTIC ? '🤖 Heuristic AI' : model }}
        </button>
        <p v-if="availableModels.length === 0" class="form-hint">No models found. Check LLM settings.</p>
      </div>
      <p v-if="selectedModels.size < 2" class="form-hint form-hint--warn">
        Select at least 2 models
      </p>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Best of</label>
        <div class="preset-group">
          <button
            v-for="p in presets" :key="p.value"
            class="chip"
            :class="{ 'chip--selected': bestOf === p.value }"
            @click="bestOf = p.value"
          >
            {{ p.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Max Turns <span class="form-hint-inline" title="Maximum turns per game">(default: 30)</span></label>
        <input v-model.number="maxTurns" type="number" min="10" max="200" class="form-input" />
      </div>
      <div class="form-group">
        <label class="form-label">K-Factor <span class="form-hint-inline" title="Higher = faster ELO changes per game">(default: 32)</span></label>
        <input v-model.number="kFactor" type="number" min="1" max="128" class="form-input" />
      </div>
    </div>

    <div v-if="bestOf >= 7" class="form-hint form-hint--warn">
      ⚠️ Marathon tournaments with {{ bestOf * estimateMatchups() / 2 }}+ games may take a while
    </div>

    <button
      class="btn btn-primary"
      :disabled="!canStart || submitting"
      @click="onSubmit"
    >
      {{ submitting ? 'Starting…' : 'Start Tournament' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { llmConfigsApi } from '../../api/llm-configs';
import { tournamentsApi } from '../../api/tournaments';
import LoadingSpinner from '../common/LoadingSpinner.vue';
import ErrorBanner from '../common/ErrorBanner.vue';

const emit = defineEmits<{ created: [id: number] }>();

const HEURISTIC = 'heuristic-baseline';
const availableModels = ref<string[]>([]);
const selectedModels = ref(new Set<string>());
const bestOf = ref(3);
const maxTurns = ref(30);
const kFactor = ref(32);
const loadingModels = ref(true);
const modelError = ref<string | null>(null);
const submitting = ref(false);

const presets = [
  { label: 'Quick (1)', value: 1 },
  { label: 'Standard (3)', value: 3 },
  { label: 'Extended (5)', value: 5 },
  { label: 'Marathon (11)', value: 11 },
];

const canStart = computed(() => selectedModels.value.size >= 2);

function toggleModel(model: string) {
  const next = new Set(selectedModels.value);
  if (next.has(model)) next.delete(model);
  else next.add(model);
  selectedModels.value = next;
}

function estimateMatchups() {
  const n = selectedModels.value.size;
  return (n * (n - 1)) / 2;
}

async function onSubmit() {
  if (!canStart.value || submitting.value) return;
  submitting.value = true;
  try {
    const result = await tournamentsApi.create({
      models: Array.from(selectedModels.value),
      bestOf: bestOf.value,
      maxTurns: maxTurns.value,
      kFactor: kFactor.value,
    });
    emit('created', result.id);
  } catch (e: any) {
    modelError.value = e.message || 'Failed to create tournament';
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  loadingModels.value = true;
  modelError.value = null;
  try {
    const data = await llmConfigsApi.models();
    availableModels.value = data.models || [];
    // Always include heuristic
    if (!availableModels.value.includes(HEURISTIC)) {
      availableModels.value.unshift(HEURISTIC);
    }
  } catch (e: any) {
    modelError.value = e.message || 'Could not discover models';
    availableModels.value = [HEURISTIC];
  } finally {
    loadingModels.value = false;
  }
});
</script>

<style scoped>
.create-form { max-width: 480px; }
.form-title { margin: 0 0 var(--space-4); font-size: var(--text-lg); }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
.form-hint { margin-top: var(--space-1); font-size: var(--text-xs); color: var(--text-dim); }
.form-hint--warn { color: var(--warning); }
.form-hint-inline { font-weight: normal; color: var(--text-dim); font-size: var(--text-xs); }
.model-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: transparent; color: var(--text-dim);
  font-size: var(--text-sm); cursor: pointer;
  transition: all var(--transition-fast);
}
.chip:hover { border-color: var(--accent); color: var(--text); }
.chip--selected { background: rgba(88, 166, 255, 0.15); border-color: var(--accent); color: var(--accent); }
.preset-group { display: flex; gap: var(--space-2); }
.btn { width: 100%; margin-top: var(--space-4); justify-content: center; }
</style>
