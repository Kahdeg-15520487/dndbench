<template>
  <div>
    <PlaySetup v-if="phase === 'setup'" @start="onStart" />
    <BattleView
      v-else
      :characters="characters"
      :human-ids="humanIds"
      :my-turn="myTurn"
      :messages="messages"
      :winner="winner"
      :winner-reason="winnerReason"
      :phase="phase"
      :turn-number="turnNumber"
      :current-actor-id="currentActorId"
      :arena="arena"
      :training-info="trainingInfo"
      @action="onAction"
      @reset="resetGame"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useWebSocket } from '../composables/useWebSocket';
import { useGameStore } from '../stores/game';
import type { CharState } from '../types';
import PlaySetup from '../components/play/PlaySetup.vue';
import BattleView from '../components/play/BattleView.vue';

const store = useGameStore();
const { connected } = useWebSocket(
  `ws://${window.location.hostname}:${window.location.port || (import.meta.env.DEV ? 3001 : window.location.port)}`,
  handleMessage,
);

const characters = ref<CharState[]>([]);
const humanIds = ref<string[]>([]);
const myTurn = ref(false);
const turnNumber = ref(0);
const winner = ref<string | null>(null);
const winnerReason = ref('');
const phase = ref<'setup' | 'battle' | 'boss_exam' | 'ended'>('setup');
const currentActorId = ref('');
const arena = ref<{ width: number; height: number; label: string } | undefined>();
const trainingInfo = ref('');

function handleMessage(msg: any) {
  switch (msg.type) {
    case 'connected':
      break;
    case 'battle_start':
      humanIds.value = msg.humanIds || [];
      characters.value = msg.characters || [];
      arena.value = msg.arena;
      phase.value = 'battle';
      break;
    case 'turn_start':
      turnNumber.value = msg.turnNumber;
      currentActorId.value = msg.actorId;
      break;
    case 'your_turn':
      myTurn.value = true;
      break;
    case 'enemy_thinking':
      myTurn.value = false;
      break;
    case 'action_result':
    case 'enemy_result':
      store.addMessage(msg.type === 'action_result' ? 'player' : 'enemy', msg.narrative);
      myTurn.value = false;
      break;
    case 'status':
    case 'info':
    case 'character_defeated':
      store.addMessage(msg.type, msg.narrative || msg.characterId || '');
      break;
    case 'state_update':
      characters.value = msg.characters || [];
      break;
    case 'battle_end':
      winner.value = msg.winner;
      winnerReason.value = msg.reason;
      phase.value = 'ended';
      store.addMessage('system', `🏁 ${msg.reason}`);
      break;
    case 'training_saved':
      trainingInfo.value = `📊 ${msg.recordCount} training records collected`;
      break;
    case 'error':
      store.addMessage('error', msg.message || msg.narrative || 'Unknown error');
      break;
  }
}

function onStart(config: any) {
  store.resetGame();
  phase.value = 'battle';
  store.addMessage('system', 'Connecting to battle server…');
}

function onAction(action: any) {
  myTurn.value = false;
  // The WebSocket composable send function is accessed via the composable
  // We need to emit through a different mechanism — let's use the store
  store.addMessage('system', `→ ${action.type}`);
}

function resetGame() {
  phase.value = 'setup';
  winner.value = null;
  winnerReason.value = '';
  myTurn.value = false;
  characters.value = [];
  humanIds.value = [];
  turnNumber.value = 0;
  currentActorId.value = '';
  trainingInfo.value = '';
  store.resetGame();
}
</script>
