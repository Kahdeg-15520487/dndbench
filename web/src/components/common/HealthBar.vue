<template>
  <div class="health-bar" role="progressbar" :aria-valuenow="current" :aria-valuemin="0" :aria-valuemax="max" :aria-label="`${label} HP: ${current}/${max}`">
    <div class="health-track">
      <div class="health-fill" :style="{ width: pct + '%', backgroundColor: color }"></div>
    </div>
    <span v-if="showText" class="health-text">{{ current }}/{{ max }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ current: number; max: number; label?: string; showText?: boolean }>(), { label: '', showText: true });

const pct = computed(() => props.max > 0 ? Math.max(0, Math.min(100, (props.current / props.max) * 100)) : 0);
const color = computed(() => {
  if (pct.value > 60) return 'var(--hp-high)';
  if (pct.value > 30) return 'var(--hp-mid)';
  return 'var(--hp-low)';
});
</script>

<style scoped>
.health-bar { display: flex; align-items: center; gap: var(--space-2); }
.health-track { flex: 1; height: 8px; background: var(--surface); border-radius: 4px; overflow: hidden; }
.health-fill { height: 100%; border-radius: 4px; transition: width var(--transition-normal), background-color var(--transition-normal); }
.health-text { font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-dim); white-space: nowrap; }
</style>
