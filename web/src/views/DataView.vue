<template>
  <div class="data-page">
    <div class="data-sidebar card">
      <h3>Filters</h3>

      <div class="form-group">
        <label class="form-label">Actor Type</label>
        <select v-model="filters.actorType" class="form-select" @change="onFilter">
          <option value="">All</option>
          <option value="llm">LLM</option>
          <option value="heuristic">Heuristic</option>
          <option value="human">Human</option>
          <option value="boss">Boss</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Actor Name</label>
        <input v-model="filters.actorName" class="form-input" placeholder="Filter by name" @input="onFilter" />
      </div>

      <div class="form-group">
        <label class="form-label">Game ID</label>
        <input v-model.number="filters.gameId" class="form-input" type="number" placeholder="Filter by game" @input="onFilter" />
      </div>

      <button class="btn btn-ghost btn-sm" @click="clearFilters">Clear filters</button>

      <div v-if="store.stats" class="stats-summary">
        <h4>Summary</h4>
        <div class="stat-row"><span>Total records</span><span>{{ store.stats.totalRecords }}</span></div>
        <div class="stat-row"><span>Total games</span><span>{{ store.stats.totalGames }}</span></div>
        <div class="stat-row"><span>Bad actions</span><span>{{ store.stats.badActions }} ({{ store.stats.badActionRate }}%)</span></div>
        <div class="stat-row"><span>Timed out</span><span>{{ store.stats.timedOut }}</span></div>
      </div>
    </div>

    <div class="data-main">
      <div class="data-header">
        <h2>Training Records</h2>
        <div class="data-actions">
          <span class="record-count">{{ store.total }} records</span>
          <button class="btn btn-ghost btn-sm" @click="showExport = !showExport">📤 Export</button>
        </div>
      </div>

      <div v-if="showExport" class="card export-panel">
        <h4>Export Dataset</h4>
        <div class="export-options">
          <button class="btn btn-ghost btn-sm" @click="doExport('jsonl')">📄 JSONL (fine-tuning)</button>
          <button class="btn btn-ghost btn-sm" @click="doExport('csv')">📊 CSV</button>
        </div>
      </div>

      <LoadingSpinner v-if="store.loading" size="sm" label="Loading records…" />
      <ErrorBanner v-else-if="store.error" :message="store.error" />
      <EmptyState v-else-if="store.records.length === 0" icon="📊" title="No records yet" description="Run a tournament or play a battle to generate training data" />

      <table v-else class="data-table">
        <thead>
          <tr>
            <th>Game</th>
            <th>Turn</th>
            <th>Actor</th>
            <th>Class</th>
            <th>Action</th>
            <th>Result</th>
            <th>Bad</th>
            <th>Timeout</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in store.records" :key="r.id">
            <td class="mono">{{ r.gameId }}</td>
            <td>{{ r.turnNumber }}</td>
            <td>{{ r.actorName }} <span class="type-badge">{{ r.actorType }}</span></td>
            <td>{{ r.actorClass }}</td>
            <td>{{ r.action?.type || '?' }}</td>
            <td class="result-cell">{{ r.actionResult?.badAction || 'ok' }}</td>
            <td>{{ r.actionWasBad ? '❌' : '' }}</td>
            <td>{{ r.actionTimedOut ? '⏰' : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useDataStore } from '../stores/data';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorBanner from '../components/common/ErrorBanner.vue';
import LoadingSpinner from '../components/common/LoadingSpinner.vue';

const store = useDataStore();
const showExport = ref(false);
const filters = reactive({ actorType: '', actorName: '', gameId: '' as string | number });

function onFilter() {
  const f: Record<string, string | number> = {};
  if (filters.actorType) f.actorType = filters.actorType;
  if (filters.actorName) f.actorName = filters.actorName;
  if (filters.gameId) f.gameId = Number(filters.gameId);
  store.fetchRecords(f);
}

function clearFilters() {
  filters.actorType = '';
  filters.actorName = '';
  filters.gameId = '';
  store.fetchRecords();
}

async function doExport(format: 'jsonl' | 'csv') {
  try {
    const content = await store.exportData(format);
    const blob = new Blob([content], { type: format === 'jsonl' ? 'application/x-ndjson' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `training_export.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    alert('Export failed: ' + e.message);
  }
}

onMounted(() => {
  store.fetchStats();
  store.fetchRecords();
});
</script>

<style scoped>
.data-page { display: grid; grid-template-columns: 240px 1fr; gap: var(--space-4); }
@media (max-width: 900px) { .data-page { grid-template-columns: 1fr; } }
.data-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-4); }
.data-header h2 { margin: 0; }
.data-actions { display: flex; align-items: center; gap: var(--space-3); }
.record-count { font-size: var(--text-sm); color: var(--text-dim); }
.stats-summary { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
.stats-summary h4 { margin: 0 0 var(--space-2); font-size: var(--text-sm); }
.stat-row { display: flex; justify-content: space-between; font-size: var(--text-xs); padding: 2px 0; color: var(--text-dim); }
.mono { font-family: var(--font-mono); font-size: var(--text-xs); }
.type-badge { font-size: 10px; background: var(--surface); padding: 0 4px; border-radius: 2px; color: var(--text-dim); }
.result-cell { font-size: var(--text-xs); }
.export-panel { margin-bottom: var(--space-4); }
.export-panel h4 { margin: 0 0 var(--space-2); }
.export-options { display: flex; gap: var(--space-2); }
</style>
