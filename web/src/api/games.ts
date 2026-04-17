import { api } from './client';
import type { Game, TrainingRecord } from '../types';

export const gamesApi = {
  get: (id: number) => api<Game>(`/api/games/${id}`),
  training: (id: number) => api<{ records: TrainingRecord[]; total: number }>(`/api/games/${id}/training`),
};
