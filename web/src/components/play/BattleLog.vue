<template>
  <div ref="logRef" class="battle-log" aria-live="polite" aria-label="Battle log">
    <div
      v-for="msg in messages"
      :key="msg.id"
      class="log-msg"
      :class="`log-msg--${msg.type}`"
    >{{ msg.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import type { ChatMessage } from '../../types';

const props = defineProps<{ messages: ChatMessage[] }>();
const logRef = ref<HTMLElement | null>(null);
let userScrolledUp = false;

function onScroll() {
  if (!logRef.value) return;
  const el = logRef.value;
  userScrolledUp = (el.scrollHeight - el.scrollTop - el.clientHeight) > 80;
}

watch(() => props.messages.length, async () => {
  if (userScrolledUp) return;
  await nextTick();
  if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight;
});

watch(logRef, (el) => {
  if (el) el.addEventListener('scroll', onScroll, { passive: true });
});
</script>

<style scoped>
.battle-log {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md);
  padding: var(--space-3); max-height: 250px; overflow-y: auto; font-size: var(--text-sm); line-height: 1.6;
}
.log-msg { padding: 2px 0; }
.log-msg--player { color: var(--accent); }
.log-msg--enemy { color: var(--danger); }
.log-msg--status { color: var(--warning); }
.log-msg--system { color: var(--text); font-weight: 500; }
.log-msg--info { color: var(--text-dim); font-style: italic; }
.log-msg--error { color: var(--danger); font-weight: 600; }
.log-msg--thinking { color: var(--text-dim); font-size: var(--text-xs); padding-left: var(--space-3); }
</style>
