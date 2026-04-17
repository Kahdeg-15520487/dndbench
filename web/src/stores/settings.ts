import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { LLMConfig } from '../types';
import { llmConfigsApi } from '../api/llm-configs';

export const useSettingsStore = defineStore('settings', () => {
  const configs = ref<LLMConfig[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const defaultConfig = computed(() => configs.value.find(c => c.isDefault) || configs.value[0] || null);

  async function fetchConfigs() {
    loading.value = true;
    error.value = null;
    try {
      configs.value = await llmConfigsApi.list();
    } catch (e: any) {
      error.value = e.message || 'Failed to load LLM configs';
    } finally {
      loading.value = false;
    }
  }

  async function createConfig(input: Partial<LLMConfig> & { name: string; model: string }) {
    const config = await llmConfigsApi.create(input);
    configs.value.push(config);
    return config;
  }

  async function updateConfig(id: number, input: Partial<LLMConfig>) {
    const config = await llmConfigsApi.update(id, input);
    const idx = configs.value.findIndex(c => c.id === id);
    if (idx !== -1) configs.value[idx] = config;
    return config;
  }

  async function deleteConfig(id: number) {
    await llmConfigsApi.delete(id);
    configs.value = configs.value.filter(c => c.id !== id);
  }

  return { configs, loading, error, defaultConfig, fetchConfigs, createConfig, updateConfig, deleteConfig };
});
