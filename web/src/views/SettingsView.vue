<template>
  <div class="settings-page">
    <div class="settings-section card">
      <div class="section-header">
        <h2>🤖 LLM Configurations</h2>
        <LoadingSpinner v-if="settings.loading" size="sm" />
      </div>

      <ErrorBanner v-if="settings.error" :message="settings.error" />

      <table v-if="settings.configs.length" class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Model</th>
            <th>Provider</th>
            <th>Base URL</th>
            <th>Default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in settings.configs" :key="c.id">
            <td>{{ editingId === c.id ? '' : c.name }}</td>
            <td class="mono">{{ editingId === c.id ? '' : c.model }}</td>
            <td>{{ c.provider }}</td>
            <td class="mono url-cell">{{ c.baseUrl || '—' }}</td>
            <td>{{ c.isDefault ? '✓' : '' }}</td>
            <td class="actions-cell">
              <template v-if="editingId === c.id">
                <button class="btn btn-ghost btn-sm" @click="saveEdit(c.id)">💾</button>
                <button class="btn btn-ghost btn-sm" @click="cancelEdit">✕</button>
              </template>
              <template v-else>
                <button class="btn btn-ghost btn-sm" @click="startEdit(c)">✏️</button>
                <button class="btn btn-ghost btn-sm" @click="onDelete(c.id)">🗑️</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <EmptyState v-else icon="🤖" title="No LLM configs" description="Add a configuration to use LLM agents" actionLabel="Add Configuration" @action="showForm = true" />

      <button class="btn btn-primary" style="margin-top: var(--space-4)" :disabled="showForm" @click="showForm = true">
        + Add Configuration
      </button>

      <div v-if="showForm" class="form-panel card" style="margin-top: var(--space-4)">
        <h3>New Configuration</h3>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Name</label>
            <input v-model="newName" class="form-input" placeholder="e.g., GPT-4o" />
          </div>
          <div class="form-group">
            <label class="form-label">Model ID</label>
            <input v-model="newModel" class="form-input" placeholder="e.g., gpt-4o-mini" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Base URL</label>
            <input v-model="newBaseUrl" class="form-input" placeholder="https://api.openai.com/v1" />
          </div>
          <div class="form-group">
            <label class="form-label">API Key</label>
            <input v-model="newApiKey" class="form-input" type="password" placeholder="sk-..." />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" :disabled="!newName || !newModel" @click="onCreate">Create</button>
          <button class="btn btn-ghost" @click="resetForm">Cancel</button>
        </div>
      </div>

      <div v-if="editingId !== null" class="form-panel card" style="margin-top: var(--space-4)">
        <h3>Edit: {{ editName }}</h3>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Name</label>
            <input v-model="editName" class="form-input" />
          </div>
          <div class="form-group">
            <label class="form-label">Model ID</label>
            <input v-model="editModel" class="form-input" />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" @click="saveEdit(editingId!)">Save</button>
          <button class="btn btn-ghost" @click="cancelEdit">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settings';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorBanner from '../components/common/ErrorBanner.vue';
import LoadingSpinner from '../components/common/LoadingSpinner.vue';

const settings = useSettingsStore();
const showForm = ref(false);
const editingId = ref<number | null>(null);
const newName = ref('');
const newModel = ref('');
const newBaseUrl = ref('');
const newApiKey = ref('');
const editName = ref('');
const editModel = ref('');

function resetForm() {
  showForm.value = false;
  newName.value = ''; newModel.value = ''; newBaseUrl.value = ''; newApiKey.value = '';
}

async function onCreate() {
  try {
    await settings.createConfig({ name: newName.value, model: newModel.value, baseUrl: newBaseUrl.value || null, apiKey: newApiKey.value || null, provider: 'openai-compatible' });
    resetForm();
  } catch (e: any) { alert('Failed: ' + e.message); }
}

function startEdit(c: any) {
  editingId.value = c.id;
  editName.value = c.name;
  editModel.value = c.model;
}

async function saveEdit(id: number) {
  try { await settings.updateConfig(id, { name: editName.value, model: editModel.value }); editingId.value = null; }
  catch (e: any) { alert('Failed: ' + e.message); }
}

function cancelEdit() { editingId.value = null; }

async function onDelete(id: number) {
  if (!confirm('Delete this LLM configuration?')) return;
  try { await settings.deleteConfig(id); } catch (e: any) { alert('Failed: ' + e.message); }
}

onMounted(() => { settings.fetchConfigs(); });
</script>

<style scoped>
.settings-page { max-width: 800px; }
.section-header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
.section-header h2 { margin: 0; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.form-panel { padding: var(--space-4); }
.form-panel h3 { margin: 0 0 var(--space-3); }
.form-actions { display: flex; gap: var(--space-2); margin-top: var(--space-3); }
.mono { font-family: var(--font-mono); font-size: var(--text-xs); }
.url-cell { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions-cell { white-space: nowrap; }
</style>
