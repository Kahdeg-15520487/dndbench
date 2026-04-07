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
  type: "system" | "player" | "enemy" | "status" | "info" | "error" | "thinking";
  text: string;
  /** For thinking messages: which step index */
  stepIndex?: number;
  /** For thinking messages: tool name */
  toolName?: string;
}

// ── State ────────────────────────────────────────────────

const phase = ref<"setup" | "battle" | "boss_exam" | "ended">("setup");
const connected = ref(false);
const myTurn = ref(false);
const enemyThinking = ref(false);
const thinkingSteps = ref<Array<{ text: string; toolName?: string; type: string }>>([]);
const turnNumber = ref(0);
const playerId = ref("");
const enemyId = ref("");
const playerClass = ref("");
const enemyClass = ref("");
const winner = ref<string | null>(null);
const winnerReason = ref("");
const gameCategory = ref<"1v1" | "boss_exam">("1v1");

// Boss exam state
const bossExamBosses = ref<Array<{ id: string; name: string; emoji: string; title: string }>>([]);
const bossExamResults = ref<Array<{ bossId: string; bossName: string; won: boolean; turns: number }>>([]);
const bossExamScorecard = ref<{ results: any[]; completed: number; total: number; wins: number; allDone: boolean; grade: string } | null>(null);
const currentBossIndex = ref(0);
const currentBossEmoji = ref("");
const currentBossName = ref("");

// Arena / battlefield state
const arena = ref<{ width: number; height: number; label: string }>({ width: 20, height: 12, label: "Arena" });
const moveEvent = ref<{ actorId: string; from: { x: number; y: number }; to: { x: number; y: number }; distance: number } | null>(null);
const currentActorId = ref<string>("");

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
      if (msg.arena) arena.value = msg.arena;
      updateState(msg.state);
      phase.value = "battle";
      moveEvent.value = null;
      break;

    case "turn_start":
      turnNumber.value = msg.turnNumber;
      currentActorId.value = msg.actorId;
      updateState(msg.state);
      break;

    case "your_turn":
      myTurn.value = true;
      enemyThinking.value = false;
      updateState(msg.state);
      break;

    case "move":
      moveEvent.value = {
        actorId: msg.actorId,
        from: msg.from,
        to: msg.to,
        distance: msg.distance,
      };
      break;

    case "action_chosen":
      addMessage("system", `→ ${msg.actionLabel || formatAction(msg.action)}`);
      moveEvent.value = null; // clear old arrow
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
      thinkingSteps.value = [];
      break;

    case "enemy_thinking_step":
      enemyThinking.value = true;
      thinkingSteps.value.push({
        type: msg.type,
        text: msg.text,
        toolName: msg.toolName,
      });
      break;

    case "enemy_result":
      enemyThinking.value = false;
      thinkingSteps.value = [];
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
      if (gameCategory.value === "boss_exam") {
        // Don't show "ended" yet — scorecard will follow
        addMessage("system", `🏁 ${msg.reason}`);
      } else {
        phase.value = "ended";
        addMessage("system", `🏁 ${msg.reason}`);
      }
      break;

    case "boss_exam_start":
      phase.value = "boss_exam";
      bossExamBosses.value = msg.bosses;
      bossExamResults.value = [];
      bossExamScorecard.value = null;
      currentBossIndex.value = 0;
      addMessage("system", `👹 Boss Exam begins! Fight ${msg.bosses.length} bosses.`);
      break;

    case "boss_exam_fight_start":
      currentBossIndex.value = msg.bossIndex;
      currentBossEmoji.value = msg.bossEmoji;
      currentBossName.value = msg.bossName;
      addMessage("system", `${msg.bossEmoji} Boss ${msg.bossIndex + 1}/${msg.totalBosses}: ${msg.bossName} — ${msg.bossTitle}`);
      break;

    case "boss_exam_fight_end": {
      const result = { bossId: msg.bossId, bossName: msg.bossName, won: msg.won, turns: msg.turns };
      bossExamResults.value.push(result);
      addMessage("system", msg.won
        ? `✅ ${msg.bossName} defeated! (${msg.turns} turns)`
        : `❌ Defeated by ${msg.bossName}! (${msg.turns} turns)`
      );
      break;
    }

    case "boss_exam_scorecard":
      bossExamScorecard.value = {
        results: msg.results,
        completed: msg.completed,
        total: msg.total,
        wins: msg.wins,
        allDone: msg.allDone,
        grade: msg.grade,
      };
      if (msg.allDone) {
        phase.value = "ended";
        addMessage("system", `📋 Final Score: ${msg.wins}/${msg.total} — Grade: ${msg.grade}`);
      }
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

function startBattle(config: { name: string; charClass: string; enemyMode: string; llmConfigId?: number; gameCategory: "1v1" | "boss_exam" }) {
  gameCategory.value = config.gameCategory;

  if (config.gameCategory === "boss_exam") {
    send({
      type: "start_boss_exam",
      name: config.name,
      class: config.charClass,
      enemyMode: config.enemyMode,
      llmConfigId: config.llmConfigId,
    });
  } else {
    send({
      type: "start_battle",
      name: config.name,
      class: config.charClass,
      enemyMode: config.enemyMode,
      llmConfigId: config.llmConfigId,
    });
  }
}

function sendAction(action: { type: string; spellId?: string; itemId?: string; target?: string }) {
  myTurn.value = false;
  send({ type: "action", action });
}

function formatAction(action: any): string {
  if (!action) return "?";
  const parts = [action.type];
  if (action.spellId) parts.push(`spell="${action.spellId}"`);
  if (action.itemId) parts.push(`item="${action.itemId}"`);
  if (action.targetId) parts.push(`target="${action.targetId}"`);
  return parts.join(" ");
}

function resetGame() {
  phase.value = "setup";
  messages.value = [];
  msgId = 0;
  winner.value = null;
  winnerReason.value = "";
  myTurn.value = false;
  enemyThinking.value = false;
  thinkingSteps.value = [];
  turnNumber.value = 0;
  bossExamResults.value = [];
  bossExamScorecard.value = null;
  currentBossIndex.value = 0;
  moveEvent.value = null;
  currentActorId.value = "";
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
    :thinking-steps="thinkingSteps"
    :turn-number="turnNumber"
    :winner="winner"
    :winner-reason="winnerReason"
    :phase="phase"
    :game-category="gameCategory"
    :boss-exam-results="bossExamResults"
    :boss-exam-scorecard="bossExamScorecard"
    :current-boss-index="currentBossIndex"
    :current-boss-emoji="currentBossEmoji"
    :current-boss-name="currentBossName"
    :boss-exam-bosses="bossExamBosses"
    :arena="arena"
    :move-event="moveEvent"
    :actor-id="currentActorId"
    @action="sendAction"
    @reset="resetGame"
  />
</template>
