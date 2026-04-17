import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/tournaments', name: 'tournaments', component: () => import('../views/TournamentsView.vue') },
  { path: '/tournaments/:id/live', name: 'tournament-live', component: () => import('../views/TournamentLiveView.vue'), props: true },
  { path: '/play', name: 'play', component: () => import('../views/PlayView.vue') },
  { path: '/data', name: 'data', component: () => import('../views/DataView.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
