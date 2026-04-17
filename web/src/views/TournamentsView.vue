<template>
  <div class="tournaments-page">
    <div class="tournaments-list-section">
      <div class="section-header">
        <h2>Tournaments</h2>
        <LoadingSpinner v-if="store.loading" size="sm" />
      </div>

      <ErrorBanner v-if="store.error" :message="store.error" />

      <EmptyState
        v-if="!store.loading && store.tournaments.length === 0"
        icon="🏆"
        title="No tournaments yet"
        description="Create your first tournament to get started"
      />

      <table v-else class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Status</th>
            <th>Models</th>
            <th>Best of</th>
            <th>Date</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in store.tournaments"
            :key="t.id"
            class="tournament-row"
            @click="goLive(t.id)"
          >
            <td class="mono">{{ t.id }}</td>
            <td>
              <span class="status-badge" :class="`status-badge--${t.status}`">
                {{ statusIcon(t.status) }} {{ t.status }}
              </span>
            </td>
            <td class="models-cell">{{ t.config.models.join(', ') }}</td>
            <td>{{ t.config.bestOf }}</td>
            <td class="date-cell">{{ formatDate(t.createdAt) }}</td>
            <td>
              <button class="btn btn-ghost btn-sm" @click.stop="goLive(t.id)">View →</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <TournamentCreateForm @created="onCreated" />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useTournamentStore } from '../stores/tournament';
import EmptyState from '../components/common/EmptyState.vue';
import ErrorBanner from '../components/common/ErrorBanner.vue';
import LoadingSpinner from '../components/common/LoadingSpinner.vue';
import TournamentCreateForm from '../components/tournament/TournamentCreateForm.vue';

const store = useTournamentStore();
const router = useRouter();

function statusIcon(status: string) {
  switch (status) {
    case 'completed': return '🟢';
    case 'running': return '🟡';
    case 'aborted': return '🔴';
    default: return '⚪';
  }
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function goLive(id: number) {
  router.push(`/tournaments/${id}/live`);
}

function onCreated(id: number) {
  store.fetchTournaments();
  router.push(`/tournaments/${id}/live`);
}

onMounted(() => {
  store.fetchTournaments();
});
</script>

<style scoped>
.tournaments-page { display: grid; grid-template-columns: 1fr 400px; gap: var(--space-6); }
@media (max-width: 900px) {
  .tournaments-page { grid-template-columns: 1fr; }
}
.section-header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
.section-header h2 { margin: 0; }
.tournament-row { cursor: pointer; }
.mono { font-family: var(--font-mono); font-size: var(--text-xs); }
.models-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); }
.date-cell { font-size: var(--text-xs); color: var(--text-dim); white-space: nowrap; }
.status-badge { font-size: var(--text-xs); display: inline-flex; align-items: center; gap: var(--space-1); }
.status-badge--completed { color: var(--success); }
.status-badge--running { color: var(--warning); }
.status-badge--aborted { color: var(--danger); }
.status-badge--pending { color: var(--text-dim); }
.btn-sm { padding: var(--space-1) var(--space-2); font-size: var(--text-xs); }
</style>
