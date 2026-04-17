<template>
  <header class="app-header">
    <div class="header-left">
      <h2 class="header-title">{{ title }}</h2>
    </div>
    <div class="header-right">
      <span class="ws-status" :class="wsClass" :title="wsLabel">
        <span class="ws-dot"></span>
        {{ wsLabel }}
      </span>
      <span v-if="trainingCount" class="training-badge" title="Training records collected this session">
        📊 {{ trainingCount }}
      </span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  title?: string;
  connected?: boolean;
  reconnecting?: boolean;
  trainingCount?: number;
}>(), {
  title: 'Arena',
  connected: false,
  reconnecting: false,
  trainingCount: 0,
});

const wsClass = computed(() => ({
  'ws-status--connected': props.connected,
  'ws-status--disconnected': !props.connected && !props.reconnecting,
  'ws-status--reconnecting': props.reconnecting,
}));

const wsLabel = computed(() => {
  if (props.connected) return 'Connected';
  if (props.reconnecting) return 'Reconnecting…';
  return 'Disconnected';
});
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-6);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  height: 48px;
}
.header-title { font-size: var(--text-lg); font-weight: 600; margin: 0; }
.header-right { display: flex; align-items: center; gap: var(--space-4); }
.ws-status { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); color: var(--text-dim); }
.ws-dot { width: 8px; height: 8px; border-radius: 50%; }
.ws-status--connected .ws-dot { background: var(--success); }
.ws-status--disconnected .ws-dot { background: var(--danger); }
.ws-status--reconnecting .ws-dot { background: var(--warning); animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.training-badge { font-size: var(--text-xs); background: var(--surface); padding: 2px 8px; border-radius: var(--radius-sm); }
</style>
