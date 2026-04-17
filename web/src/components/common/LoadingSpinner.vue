<template>
  <div class="spinner" :class="`spinner--${size}`">
    <div class="spinner-ring"></div>
    <span v-if="label" class="spinner-label">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg'; label?: string }>(), { size: 'md' });
</script>

<style scoped>
.spinner { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); }
.spinner-ring { border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; }
.spinner--sm .spinner-ring { width: 16px; height: 16px; }
.spinner--md .spinner-ring { width: 24px; height: 24px; }
.spinner--lg .spinner-ring { width: 40px; height: 40px; }
.spinner-label { font-size: var(--text-xs); color: var(--text-dim); }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .spinner-ring { animation-duration: 0.01ms !important; }
}
</style>
