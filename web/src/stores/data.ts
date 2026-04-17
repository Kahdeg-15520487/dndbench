import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TrainingRecord, TrainingStats } from '../types';
import { trainingApi } from '../api/training';

export const useDataStore = defineStore('data', () => {
  const records = ref<TrainingRecord[]>([]);
  const stats = ref<TrainingStats | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const total = ref(0);

  async function fetchStats() {
    try { stats.value = await trainingApi.stats(); } catch { /* optional */ }
  }

  async function fetchRecords(filters: Record<string, string | number> = {}) {
    loading.value = true;
    error.value = null;
    try {
      const result = await trainingApi.list(filters);
      records.value = result.records;
      total.value = result.total;
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function exportData(format: 'jsonl' | 'csv', filters: Record<string, string | number> = {}) {
    return trainingApi.export(format, filters);
  }

  return { records, stats, loading, error, total, fetchStats, fetchRecords, exportData };
});
