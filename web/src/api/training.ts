import { api } from './client';
import type { TrainingRecord, TrainingStats } from '../types';

export const trainingApi = {
  list: (filters: Record<string, string | number> = {}) => {
    const params = new URLSearchParams(filters as any).toString();
    return api<{ records: TrainingRecord[]; total: number }>(`/api/training${params ? `?${params}` : ''}`);
  },
  export: (format: 'jsonl' | 'csv', filters: Record<string, string | number> = {}) => {
    const params = new URLSearchParams({ format, ...filters as any }).toString();
    return api<string>(`/api/training/export?${params}`);
  },
  stats: () => api<TrainingStats>('/api/training/stats'),
};
