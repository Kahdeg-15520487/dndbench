import { api } from './client';
import type { Tournament, Game } from '../types';

export const tournamentsApi = {
  list: (limit = 50, offset = 0) => api<Tournament[]>(`/api/tournaments?limit=${limit}&offset=${offset}`),
  get: (id: number) => api<Tournament>(`/api/tournaments/${id}`),
  create: (config: Tournament['config']) => api<{ id: number }>('/api/tournaments', { method: 'POST', body: JSON.stringify(config) }),
  start: (id: number) => api<{ message: string }>(`/api/tournaments/${id}/start`, { method: 'POST' }),
  abort: (id: number) => api<{ message: string }>(`/api/tournaments/${id}/abort`, { method: 'POST' }),
  status: (id: number) => api<any>(`/api/tournaments/${id}/status`),
  games: (id: number) => api<Game[]>(`/api/tournaments/${id}/games`),
};
