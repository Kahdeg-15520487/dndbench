import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CharState, ChatMessage } from '../types';

export const useGameStore = defineStore('game', () => {
  const phase = ref<'setup' | 'battle' | 'boss_exam' | 'ended'>('setup');
  const connected = ref(false);
  const myTurn = ref(false);
  const characters = ref<CharState[]>([]);
  const humanIds = ref<string[]>([]);
  const turnNumber = ref(0);
  const winner = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const trainingSaved = ref<{ gameId: number; recordCount: number } | null>(null);
  let msgIdCounter = 0;

  function addMessage(type: ChatMessage['type'], text: string) {
    messages.value.push({ id: ++msgIdCounter, type, text });
  }

  function resetGame() {
    phase.value = 'setup';
    myTurn.value = false;
    characters.value = [];
    humanIds.value = [];
    turnNumber.value = 0;
    winner.value = null;
    messages.value = [];
    trainingSaved.value = null;
  }

  return { phase, connected, myTurn, characters, humanIds, turnNumber, winner, messages, trainingSaved, addMessage, resetGame };
});
