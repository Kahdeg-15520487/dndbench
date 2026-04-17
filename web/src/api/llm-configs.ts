import { api } from './client';
import type { LLMConfig } from '../types';

export const llmConfigsApi = {
  list: () => api<LLMConfig[]>('/api/llm-configs'),
  get: (id: number) => api<LLMConfig>(`/api/llm-configs/${id}`),
  create: (input: Partial<LLMConfig> & { name: string; model: string }) =>
    api<LLMConfig>('/api/llm-configs', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, input: Partial<LLMConfig>) =>
    api<LLMConfig>(`/api/llm-configs/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  delete: (id: number) =>
    api<{ success: boolean }>(`/api/llm-configs/${id}`, { method: 'DELETE' }),
  models: () => api<{ models: string[]; endpoint: string }>('/api/models'),
  health: () => api<{ status: string; latency_ms: number }>('/api/health'),
};
