<template>
  <div class="live-view">
    <div class="live-status">
      <span class="status-dot" :class="`status-dot--${connected ? 'on' : 'off'}`"></span>
      <span class="status-text">{{ statusText }}</span>
    </div>

    <div class="live-content">
      <div ref="logRef" class="live-log" aria-live="polite" aria-label="Tournament event log"></div>

      <div v-if="matchups.length > 0" class="matchup-section">
        <h3>Matchups</h3>
        <MatchupMatrix :matchups="matchups" :models="uniqueModels" />
      </div>

      <div v-if="finalResult" class="final-results card">
        <h3>🏆 Tournament Complete</h3>
        <table class="data-table">
          <thead>
            <tr><th>Rank</th><th>Model</th><th>ELO</th><th>W</th><th>L</th><th>D</th></tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in finalResult.stats" :key="s.name">
              <td>{{ i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1 }}</td>
              <td>{{ s.name }}</td>
              <td class="mono">{{ Math.round(s.elo) }}</td>
              <td>{{ s.wins }}</td>
              <td>{{ s.losses }}</td>
              <td>{{ s.draws }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="trainingCount > 0" class="training-note">📊 {{ trainingCount }} training records collected</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useSSE } from '../composables/useSSE';
import MatchupMatrix from '../components/tournament/MatchupMatrix.vue';

const props = defineProps<{ id: number }>();

const { connected, connect, disconnect } = useSSE(`/api/tournaments/${props.id}/events`, onEvent);

const logRef = ref<HTMLElement | null>(null);
const matchups = ref<any[]>([]);
const finalResult = ref<any>(null);
const trainingCount = ref(0);
const statusText = ref('Connecting…');

const uniqueModels = computed(() => {
  const set = new Set<string>();
  for (const m of matchups.value) { set.add(m.modelA); set.add(m.modelB); }
  return Array.from(set);
});

function appendLog(html: string) {
  if (!logRef.value) return;
  logRef.value.insertAdjacentHTML('beforeend', html);
  // Auto-scroll
  const isNearBottom = logRef.value.scrollHeight - logRef.value.scrollTop - logRef.value.clientHeight < 80;
  if (isNearBottom) {
    nextTick(() => { if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight; });
  }
}

function onEvent(event: any) {
  switch (event.type) {
    case 'tournament_start':
      statusText.value = 'Running…';
      appendLog(`<div class="log-event log-event--start">🏆 Tournament started — ${event.totalMatchups} matchups, ${event.totalGames} games</div>`);
      break;
    case 'matchup_start':
      appendLog(`<div class="log-event log-event--matchup">⚔️ Matchup ${event.matchupNum}/${event.totalMatchups}: <strong>${event.modelA}</strong> vs <strong>${event.modelB}</strong></div>`);
      break;
    case 'turn':
      appendLog(`<div class="log-event log-event--turn"><span class="log-game">G${event.gameNum}</span> ${escapeHtml(event.narrative || '')}</div>`);
      break;
    case 'game_start':
      appendLog(`<div class="log-event log-event--game-start">Game ${event.gameNum}/${event.totalGames}: ${event.modelA} (${event.classA}) vs ${event.modelB} (${event.classB})</div>`);
      break;
    case 'game_end':
      appendLog(`<div class="log-event log-event--game-end">Game ${event.gameNum} ended — ELO: ${event.modelA} ${Math.round(event.eloA)} | ${event.modelB} ${Math.round(event.eloB)}</div>`);
      break;
    case 'matchup_end':
      matchups.value.push({ modelA: event.modelA, modelB: event.modelB, winsA: event.winsA, winsB: event.winsB, draws: event.draws });
      break;
    case 'training_saved':
      trainingCount.value += (event.recordCount || 0);
      appendLog(`<div class="log-event log-event--training">📊 ${event.recordCount} training records saved</div>`);
      break;
    case 'tournament_end':
      statusText.value = 'Complete';
      finalResult.value = event.result;
      appendLog(`<div class="log-event log-event--end">🏁 Tournament complete!</div>`);
      break;
    case 'tournament_aborted':
      statusText.value = 'Aborted';
      appendLog(`<div class="log-event log-event--error">❌ Tournament aborted: ${event.reason || 'unknown'}</div>`);
      break;
    case 'tournament_error':
      appendLog(`<div class="log-event log-event--error">⚠️ Error: ${event.error}</div>`);
      break;
    case 'reports_saved':
      appendLog(`<div class="log-event log-event--info">📁 Reports saved</div>`);
      break;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

onMounted(() => connect());
onUnmounted(() => disconnect());
</script>

<style scoped>
.live-view { display: flex; flex-direction: column; gap: var(--space-4); }
.live-status { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--bg-card); border-radius: var(--radius-sm); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-dot--on { background: var(--success); }
.status-dot--off { background: var(--danger); }
.status-text { font-size: var(--text-sm); color: var(--text-dim); }
.live-log { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-3); max-height: 500px; overflow-y: auto; font-size: var(--text-sm); line-height: 1.6; }
.log-event { padding: var(--space-1) 0; }
.log-event--start { color: var(--accent); font-weight: 600; }
.log-event--matchup { color: var(--text); }
.log-event--turn { color: var(--text-dim); padding-left: var(--space-4); }
.log-event--game-start { color: var(--text); padding-left: var(--space-2); border-top: 1px solid var(--border); margin-top: var(--space-2); }
.log-event--game-end { color: var(--success); padding-left: var(--space-2); }
.log-event--end { color: var(--accent); font-weight: 600; margin-top: var(--space-2); border-top: 2px solid var(--accent); padding-top: var(--space-2); }
.log-event--error { color: var(--danger); }
.log-event--info { color: var(--text-dim); font-style: italic; }
.log-event--training { color: var(--text-dim); }
.log-game { color: var(--accent); font-weight: 600; font-size: var(--text-xs); margin-right: var(--space-1); }
.matchup-section { margin-top: var(--space-4); }
.matchup-section h3 { margin: 0 0 var(--space-3); }
.final-results { margin-top: var(--space-4); }
.final-results h3 { margin: 0 0 var(--space-3); }
.training-note { margin: var(--space-3) 0 0; font-size: var(--text-sm); color: var(--text-dim); }
.mono { font-family: var(--font-mono); font-size: var(--text-xs); }
</style>
