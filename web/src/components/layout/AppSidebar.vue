<template>
  <nav class="app-sidebar">
    <div class="sidebar-brand">⚔️ Arena</div>
    <router-link v-for="item in navItems" :key="item.path" :to="item.path" class="sidebar-link" active-class="sidebar-link--active">
      <span class="sidebar-icon">{{ item.icon }}</span>
      <span>{{ item.label }}</span>
    </router-link>
  </nav>
</template>

<script setup lang="ts">
const navItems = [
  { path: '/', icon: '🏠', label: 'Dashboard' },
  { path: '/tournaments', icon: '🏆', label: 'Tournaments' },
  { path: '/play', icon: '⚔️', label: 'Play' },
  { path: '/data', icon: '📊', label: 'Data' },
  { path: '/settings', icon: '⚙️', label: 'Settings' },
];
</script>

<style scoped>
.app-sidebar {
  background: var(--bg-card);
  border-right: 1px solid var(--border);
  padding: var(--space-4) 0;
  display: flex;
  flex-direction: column;
}
.sidebar-brand {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-lg);
  font-weight: 700;
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--space-2);
}
.sidebar-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  color: var(--text-dim);
  text-decoration: none;
  font-size: var(--text-sm);
  transition: color var(--transition-fast), background var(--transition-fast);
}
.sidebar-link:hover { color: var(--text); background: var(--bg-hover); }
.sidebar-link--active { color: var(--accent); background: rgba(88, 166, 255, 0.08); font-weight: 500; }
.sidebar-icon { font-size: var(--text-base); width: 24px; text-align: center; }
</style>
