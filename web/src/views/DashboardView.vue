<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useTournamentStore } from '../stores/tournament';
import { useDataStore } from '../stores/data';

const tournamentStore = useTournamentStore();
const dataStore = useDataStore();

const recentTournaments = computed(() =>
  [...tournamentStore.tournaments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
);

const topRatings = computed(() =>
  [...tournamentStore.ratings]
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 10)
);

const statusBadge: Record<string, string> = {
  completed: '🟢',
  running: '🟡',
  pending: '⚪',
  aborted: '🔴',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

function winRate(r: { wins: number; games: number }) {
  if (r.games === 0) return '—';
  return ((r.wins / r.games) * 100).toFixed(1) + '%';
}

function medal(rank: number) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `${rank}.`;
}

onMounted(() => {
  tournamentStore.fetchTournaments();
  tournamentStore.fetchRatings();
  dataStore.fetchStats();
});
</script>

<template>
  <div>
    <h1>Dashboard</h1>
    <p style="color: var(--text-dim)">Overview — recent tournaments, ELO rankings, quick actions</p>

    <!-- Quick Stats -->
    <div class="stats-grid">
      <div class="card">
        <div class="card-icon">🏆</div>
        <div class="card-value">{{ tournamentStore.tournaments.length }}</div>
        <div class="card-label">Total Tournaments</div>
      </div>
      <div class="card">
        <div class="card-icon">🎮</div>
        <div class="card-value">{{ dataStore.stats?.totalGames ?? '—' }}</div>
        <div class="card-label">Total Games</div>
      </div>
      <div class="card">
        <div class="card-icon">📊</div>
        <div class="card-value">{{ dataStore.stats?.totalRecords ?? '—' }}</div>
        <div class="card-label">Training Records</div>
      </div>
    </div>

    <!-- Recent Tournaments -->
    <section>
      <h2>Recent Tournaments</h2>
      <div v-if="recentTournaments.length === 0" class="empty-state">
        No tournaments yet.
      </div>
      <ul v-else class="tournament-list">
        <li v-for="t in recentTournaments" :key="t.id">
          <router-link :to="`/tournaments/${t.id}/live`" class="tournament-item">
            <span class="status-badge">{{ statusBadge[t.status] ?? '⚪' }}</span>
            <span class="tournament-models">{{ t.config.models.join(' vs ') }}</span>
            <span class="tournament-date">{{ formatDate(t.createdAt) }}</span>
            <span class="tournament-arrow">→</span>
          </router-link>
        </li>
      </ul>
    </section>

    <!-- ELO Leaderboard -->
    <section>
      <h2>ELO Leaderboard</h2>
      <div v-if="topRatings.length === 0" class="empty-state">
        No ratings data yet.
      </div>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>ELO</th>
            <th>Games</th>
            <th>Win Rate</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in topRatings" :key="r.name">
            <td>{{ medal(i + 1) }}</td>
            <td>{{ r.name }}</td>
            <td>{{ r.elo }}</td>
            <td>{{ r.games }}</td>
            <td>{{ winRate(r) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Quick Actions -->
    <section>
      <h2>Quick Actions</h2>
      <div class="actions-row">
        <router-link to="/tournaments">
          <button class="btn">🏆 Tournaments</button>
        </router-link>
        <router-link to="/play">
          <button class="btn">⚔️ Play</button>
        </router-link>
        <router-link to="/data">
          <button class="btn">📊 Training Data</button>
        </router-link>
        <router-link to="/settings">
          <button class="btn">⚙️ Settings</button>
        </router-link>
      </div>
    </section>
  </div>
</template>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin: 16px 0 24px;
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
  text-align: center;
}

.card-icon {
  font-size: 28px;
  margin-bottom: 8px;
}

.card-value {
  font-size: 32px;
  font-weight: 700;
  color: var(--text);
}

.card-label {
  font-size: 13px;
  color: var(--text-dim);
  margin-top: 4px;
}

section {
  margin-bottom: 24px;
}

h2 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 12px;
}

.empty-state {
  color: var(--text-dim);
  font-size: 14px;
  padding: 16px 0;
}

.tournament-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tournament-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  text-decoration: none;
  color: var(--text);
  transition: border-color 0.15s;
}

.tournament-item:hover {
  border-color: var(--accent-dim);
}

.status-badge {
  font-size: 14px;
}

.tournament-models {
  flex: 1;
  font-size: 14px;
}

.tournament-date {
  font-size: 12px;
  color: var(--text-dim);
}

.tournament-arrow {
  color: var(--text-dim);
  font-size: 14px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.data-table th {
  text-align: left;
  padding: 8px 12px;
  color: var(--text-dim);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
}

.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.data-table tr:last-child td {
  border-bottom: none;
}

.actions-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.actions-row a {
  text-decoration: none;
}
</style>
