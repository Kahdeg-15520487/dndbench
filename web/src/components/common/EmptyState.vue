<template>
  <div class="empty-state">
    <div class="empty-icon">{{ icon }}</div>
    <h3 class="empty-title">{{ title }}</h3>
    <p v-if="description" class="empty-desc">{{ description }}</p>
    <button v-if="actionLabel" class="btn btn-primary" @click="$emit('action')">{{ actionLabel }}</button>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ icon?: string; title: string; description?: string; actionLabel?: string }>(), { icon: '📭' });
defineEmits<{ action: [] }>();
</script>

<style scoped>
.empty-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-8); color: var(--text-dim); text-align: center; }
.empty-icon { font-size: 2rem; }
.empty-title { margin: 0; font-size: var(--text-lg); color: var(--text); }
.empty-desc { margin: 0; font-size: var(--text-sm); max-width: 320px; }
</style>
