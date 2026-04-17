<template>
  <div class="battle">
    <div class="battle-top">
      <StatusPanel :characters="characters" :current-actor-id="currentActorId" />
      <BattlefieldCanvas :characters="characters" :arena="arena" :current-actor-id="currentActorId" />
    </div>
    <BattleLog :messages="messages" />
    <ActionPanel
      :my-turn="myTurn"
      :player="playerChar"
      :enemies="enemyChars"
      :phase="phase"
      :is-boss-exam="phase === 'boss_exam'"
      @action="onAction"
    />
    <div v-if="winner" class="result-banner card">
      <h2>{{ winner === 'draw' ? '🤝 Draw!' : `🏆 ${winner} wins!` }}</h2>
      <p class="result-reason">{{ winnerReason }}</p>
      <div class="result-actions">
        <button class="btn btn-primary" @click="$emit('reset')">⚔️ Play Again</button>
        <router-link class="btn btn-ghost" to="/data">📊 View Data</router-link>
      </div>
      <p v-if="trainingInfo" class="training-note">{{ trainingInfo }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CharState, ChatMessage } from '../../types';
import StatusPanel from './StatusPanel.vue';
import BattlefieldCanvas from './BattlefieldCanvas.vue';
import BattleLog from './BattleLog.vue';
import ActionPanel from './ActionPanel.vue';

const props = defineProps<{
  characters: CharState[];
  humanIds: string[];
  myTurn: boolean;
  messages: ChatMessage[];
  winner: string | null;
  winnerReason: string;
  phase: string;
  turnNumber: number;
  currentActorId: string;
  arena?: { width: number; height: number; label: string };
  trainingInfo?: string;
}>();

const emit = defineEmits<{ action: [action: any]; reset: [] }>();

const playerChar = computed(() => {
  const pid = props.humanIds[0];
  return props.characters.find(c => c.id === pid);
});

const enemyChars = computed(() =>
  props.characters.filter(c => !props.humanIds.includes(c.id))
);

function onAction(action: any) {
  emit('action', action);
}
</script>

<style scoped>
.battle { display: flex; flex-direction: column; gap: var(--space-3); }
.battle-top { display: grid; grid-template-columns: 200px 1fr; gap: var(--space-3); }
@media (max-width: 700px) {
  .battle-top { grid-template-columns: 1fr; }
}
.result-banner { text-align: center; padding: var(--space-6); }
.result-banner h2 { margin: 0 0 var(--space-2); }
.result-reason { color: var(--text-dim); margin: 0 0 var(--space-4); }
.result-actions { display: flex; gap: var(--space-3); justify-content: center; }
.training-note { margin-top: var(--space-3); font-size: var(--text-sm); color: var(--text-dim); }
</style>
