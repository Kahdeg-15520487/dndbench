<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick, computed } from "vue";
import SetupScreen from "./components/SetupScreen.vue";
import BattleView from "./components/BattleView.vue";

// ── Types ────────────────────────────────────────────────

interface CharState {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  statusEffects: { type: string; turnsRemaining: number }[];
  isDefending: boolean;
  spells: { id: string; name: string; currentCooldown: number }[];
  inventory: { id: string; name: string; quantity: number }[];
}

interface ChatMessage {
  id: number;
  type: "system" | "player" | "enemy" | "status" | "info" | "error";
  text: string;
}

// ── State ────────────────────────────────────────────────

const phase = ref<"setup" | "battle" | "ended">("setup");
const connected = ref(false);
const myTurn = ref(false);
const enemyThinking = ref(false);
const turnNumber = ref(0);
const playerId = ref("");
const enemyId = ref("");
const playerClass = ref("");
const enemyClass = ref("");
const winner = ref<string | null>(null);
const winnerReason = ref("");

const player = reactive<CharState>({
  id: "",
  name: "",
  hp: 0,
  maxHp: 0,
  mp: 0,
  maxMp: 0,
  statusEffects: [],
  isDefending: false,
  spells: [],
  inventory: [],
});

const enemy = reactive<CharState>({
  id: "",
  name: "",
  hp: 0,
  maxHp: 0,
  mp: 0,
  maxMp: 0,
  statusEffects: [],
  isDefending: false,
  spells: [],
  inventory: [],
});

const messages = ref<ChatMessage[]>([]);
let msgId = 0;
let ws: WebSocket | null = null;

// ── WebSocket ────────────────────────────────────────────

function connect() {
  const wsUrl =
    import.meta.env.DEV
      ? "ws://localhost:3001"
      : `ws://${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connected.value = true;
  };

  ws.onclose = () => {
    connected.value = false;
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleServerMessage(msg);
  };
}

function send(data: object) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function handleServerMessage(msg: any) {
  switch (msg.type) {
    case "connected":
      connected.value = true;
      break;

    case "battle_start":
      playerId.value = msg.playerId;
      enemyId.value = msg.enemyId;
      playerClass.value = msg.playerClass;
      enemyClass.value = msg.enemyClass;
      updateState(msg.state);
      phase.value = "battle";
      break;

    case "turn_start":
      turnNumber.value = msg.turnNumber;
      updateState(msg.state);
      break;

    case "your_turn":
      myTurn.value = true;
      enemyThinking.value = false;
      updateState(msg.state);
      break;

    case "action_result":
      myTurn.value = false;
      addMessage("player", msg.narrative);
      if (msg.result?.damage?.damage > 0) {
        updateState(msg.state);
      }
      updateState(msg.state);
      break;

    case "enemy_thinking":
      enemyThinking.value = true;
      break;

    case "enemy_result":
      enemyThinking.value = false;
      addMessage("enemy", msg.narrative);
      updateState(msg.state);
      break;

    case "status":
      addMessage("status", msg.narrative);
      break;

    case "info":
      addMessage("info", msg.narrative);
      break;

    case "error":
      addMessage("error", msg.message || msg.narrative || "Error");
      break;

    case "battle_end":
      myTurn.value = false;
      enemyThinking.value = false;
      winner.value = msg.winner;
      winnerReason.value = msg.reason;
      updateState(msg.state);
      phase.value = "ended";
      addMessage("system", `🏁 ${msg.reason}`);
      break;
  }
}

function updateState(state: any) {
  if (!state?.characters) return;
  for (const c of state.characters) {
    const target = c.id === playerId.value ? player : enemy;
    Object.assign(target, c);
  }
  turnNumber.value = state.turnNumber || turnNumber.value;
}

function addMessage(type: ChatMessage["type"], text: string) {
  messages.value.push({ id: ++msgId, type, text });
}

// ── Actions ──────────────────────────────────────────────

function startBattle(config: { name: string; charClass: string; enemyMode: string }) {
  send({
    type: "start_battle",
    name: config.name,
    class: config.charClass,
    enemyMode: config.enemyMode,
  });
}

function sendAction(action: { type: string; spellId?: string; itemId?: string; target?: string }) {
  myTurn.value = false;
  send({ type: "action", action });
}

function resetGame() {
  phase.value = "setup";
  messages.value = [];
  msgId = 0;
  winner.value = null;
  winnerReason.value = "";
  myTurn.value = false;
  enemyThinking.value = false;
  turnNumber.value = 0;
}

// ── Lifecycle ────────────────────────────────────────────

onMounted(() => {
  connect();
});

onUnmounted(() => {
  ws?.close();
});
</script>

<template>
  <SetupScreen
    v-if="phase === 'setup'"
    :connected="connected"
    @start="startBattle"
  />
  <BattleView
    v-else
    :player="player"
    :enemy="enemy"
    :player-class="playerClass"
    :enemy-class="enemyClass"
    :messages="messages"
    :my-turn="myTurn"
    :enemy-thinking="enemyThinking"
    :turn-number="turnNumber"
    :winner="winner"
    :winner-reason="winnerReason"
    :phase="phase"
    @action="sendAction"
    @reset="resetGame"
  />
</template>
