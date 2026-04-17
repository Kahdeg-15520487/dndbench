<template>
  <div class="app-layout">
    <AppSidebar />
    <div class="app-right">
      <AppHeader :title="pageTitle" :connected="false" :reconnecting="false" />
      <main class="app-main">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppSidebar from './components/layout/AppSidebar.vue';
import AppHeader from './components/layout/AppHeader.vue';

const route = useRoute();

const pageTitle = computed(() => {
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    tournaments: 'Tournaments',
    'tournament-live': 'Tournament Live',
    play: 'Play',
    data: 'Training Data',
    settings: 'Settings',
  };
  return titles[route.name as string] || 'Arena';
});
</script>

<style scoped>
.app-layout {
  display: grid;
  grid-template-columns: 200px 1fr;
  min-height: 100vh;
}
.app-right {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 100vh;
}
@media (max-width: 768px) {
  .app-layout { grid-template-columns: 1fr; }
}
</style>
