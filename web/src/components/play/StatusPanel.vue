<template>
  <div class="status-panel">
    <div
      v-for="char in characters"
      :key="char.id"
      class="char-card"
      :class="{ 'char-card--active': char.id === currentActorId, 'char-card--dead': char.hp <= 0 }"
    >
      <div class="char-header">
        <span class="char-icon">{{ classEmoji(char.class) }}</span>
        <span class="char-name">{{ char.name }}</span>
        <span v-if="char.id === currentActorId" class="char-active-dot"></span>
      </div>
      <HealthBar :current="char.hp" :max="char.maxHp" :label="`${char.hp}/${char.maxHp}`" :show-text="true" />
      <div class="char-stats">
        <span>AC {{ char.ac }}</span>
        <span v-if="char.isDefending" class="char-defending" title="Defending">🛡️</span>
      </div>
      <div v-if="char.statusEffects.length" class="char-effects">
        <span v-for="fx in char.statusEffects" :key="fx.type" class="effect-tag" :title="fx.type">
          {{ effectEmoji(fx.type) }}<sup>{{ fx.turnsRemaining }}</sup>
        </span>
      </div>
      <div v-if="char.spellSlots && Object.keys(char.spellSlots).length" class="char-slots">
        <span v-for="(remaining, level) in char.spellSlots" :key="level" class="slot-tag">
          {{ level }}:{{ remaining }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CharState } from '../../types';
import HealthBar from '../common/HealthBar.vue';

defineProps<{ characters: CharState[]; currentActorId: string }>();

function classEmoji(cls: string) {
  const map: Record<string, string> = { warrior: '⚔️', mage: '🔮', rogue: '🗡️', paladin: '🛡️' };
  return map[cls] || '👤';
}

function effectEmoji(type: string) {
  const map: Record<string, string> = { burn: '🔥', poison: '☠️', paralyzed: '⚡', frozen: '❄️', shielded: '🛡️', haste: '💨', slow: '🐌', invisible: '👻', stunned: '💫', unconscious: '😵', grappled: '🤼', prone: '⬇️', blinded: '🕶️', frightened: '😨', restrained: '⛓️', spirit_guardians: '👻', mirror_image: '🪞', absorb_elements: '🌀' };
  return map[type] || '✦';
}
</script>

<style scoped>
.status-panel { display: flex; flex-direction: column; gap: var(--space-2); min-width: 180px; }
.char-card { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); transition: border-color var(--transition-fast); }
.char-card--active { border-color: var(--accent); }
.char-card--dead { opacity: 0.5; }
.char-header { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); }
.char-icon { font-size: var(--text-base); }
.char-name { font-size: var(--text-sm); font-weight: 600; flex: 1; }
.char-active-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1s ease-in-out infinite; }
.char-stats { display: flex; gap: var(--space-2); font-size: var(--text-xs); color: var(--text-dim); margin-top: var(--space-1); }
.char-defending { font-size: var(--text-sm); }
.char-effects { display: flex; flex-wrap: wrap; gap: 2px; margin-top: var(--space-1); }
.effect-tag { font-size: var(--text-xs); background: var(--surface); padding: 0 4px; border-radius: 2px; }
.effect-tag sup { font-size: 9px; color: var(--text-dim); }
.char-slots { display: flex; gap: var(--space-1); margin-top: var(--space-1); flex-wrap: wrap; }
.slot-tag { font-size: var(--text-xs); color: var(--accent); font-family: var(--font-mono); background: rgba(88, 166, 255, 0.1); padding: 0 4px; border-radius: 2px; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
