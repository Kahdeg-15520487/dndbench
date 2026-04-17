<template>
  <div v-if="message" class="error-banner" role="alert" aria-live="assertive">
    <span class="error-text">{{ message }}</span>
    <button v-if="dismissible" class="error-close" @click="$emit('dismiss')" aria-label="Dismiss">&times;</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ message: string; dismissible?: boolean }>();
defineEmits<{ dismiss: [] }>();
</script>

<style scoped>
.error-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.3);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: var(--text-sm);
}
.error-text { flex: 1; }
.error-close { background: none; border: none; color: var(--text-dim); font-size: var(--text-lg); cursor: pointer; padding: 0; }
</style>
