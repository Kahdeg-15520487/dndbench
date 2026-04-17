import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Tournament, EloRating } from '../types';
import { tournamentsApi } from '../api/tournaments';
import { api } from '../api/client';

export const useTournamentStore = defineStore('tournament', () => {
  const tournaments = ref<Tournament[]>([]);
  const currentTournament = ref<Tournament | null>(null);
  const ratings = ref<EloRating[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const sseConnected = ref(false);
  const sseEvents = ref<any[]>([]);

  async function fetchTournaments() {
    loading.value = true;
    error.value = null;
    try {
      tournaments.value = await tournamentsApi.list();
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function fetchRatings() {
    try {
      ratings.value = await api<EloRating[]>('/api/ratings');
    } catch { /* ratings optional */ }
  }

  function resetSSE() {
    sseEvents.value = [];
    sseConnected.value = false;
  }

  return { tournaments, currentTournament, ratings, loading, error, sseConnected, sseEvents, fetchTournaments, fetchRatings, resetSSE };
});
