<template>
  <div class="action-panel" :class="{ 'action-panel--disabled': !myTurn }">
    <div v-if="mode === 'main'" class="action-grid">
      <button class="action-btn action-btn--attack" :disabled="!myTurn" @click="$emit('action', { type: 'attack', targetId: autoTarget })">⚔️ Attack</button>
      <button class="action-btn action-btn--defend" :disabled="!myTurn" @click="$emit('action', { type: 'defend' })">🛡️ Defend</button>
      <button class="action-btn action-btn--spell" :disabled="!myTurn" @click="mode = 'spell'">✨ Spell</button>
      <button class="action-btn action-btn--item" :disabled="!myTurn || !hasItems" @click="mode = 'item'">🧪 Item</button>
      <button class="action-btn action-btn--dash" :disabled="!myTurn" @click="$emit('action', { type: 'dash' })">⚡ Dash</button>
      <button class="action-btn action-btn--flee" :disabled="!myTurn" @click="$emit('action', { type: 'flee' })">🏃 Flee</button>
    </div>

    <div v-if="mode === 'spell'" class="sub-panel">
      <div class="sub-header">
        <button class="btn btn-ghost btn-sm" @click="mode = 'main'">← Back</button>
        <span class="sub-title">Cast Spell</span>
      </div>
      <div class="spell-grid">
        <button
          v-for="spell in availableSpells" :key="spell.id"
          class="spell-btn"
          :disabled="!myTurn || spell.currentCooldown > 0"
          @click="selectSpell(spell)"
        >
          <span class="spell-name">{{ spell.name }}</span>
          <span class="spell-meta">Lv{{ spell.level }} {{ spell.damageDice ? spell.damageDice : spell.range ? spell.range + 'ft' : '' }}</span>
        </button>
      </div>
    </div>

    <div v-if="mode === 'item'" class="sub-panel">
      <div class="sub-header">
        <button class="btn btn-ghost btn-sm" @click="mode = 'main'">← Back</button>
        <span class="sub-title">Use Item</span>
      </div>
      <div v-if="items.length" class="spell-grid">
        <button v-for="item in items" :key="item.id" class="spell-btn" :disabled="!myTurn" @click="$emit('action', { type: 'use_item', itemId: item.id, targetId: autoTarget })">
          <span class="spell-name">{{ item.name }}</span>
          <span class="spell-meta">×{{ item.quantity }}</span>
        </button>
      </div>
      <p v-else class="empty-text">No items available</p>
    </div>

    <p v-if="!myTurn && phase === 'battle'" class="wait-text">Waiting for {{ isBossExam ? 'enemy' : 'other side' }}…</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import type { CharState } from '../../types';

const props = defineProps<{
  myTurn: boolean;
  player?: CharState;
  enemies: CharState[];
  phase: string;
  isBossExam?: boolean;
}>();

const emit = defineEmits<{ action: [action: any] }>();
const mode = ref<'main' | 'spell' | 'item'>('main');

const autoTarget = computed(() => props.enemies.find(e => e.hp > 0)?.id || '');

const availableSpells = computed(() => props.player?.spells?.filter(s => s.currentCooldown <= 0) || []);
const items = computed(() => props.player?.inventory?.filter(i => i.quantity > 0) || []);
const hasItems = computed(() => items.value.length > 0);

function selectSpell(spell: any) {
  const needsTarget = ['attack', 'ranged_attack', 'save'].includes(spell.type);
  emit('action', {
    type: 'cast_spell',
    spellId: spell.id,
    targetId: needsTarget ? autoTarget.value : undefined,
  });
  mode.value = 'main';
}
</script>

<style scoped>
.action-panel { padding: var(--space-3); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-md); }
.action-panel--disabled { opacity: 0.7; }
.action-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); }
.action-btn {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: transparent; color: var(--text); cursor: pointer; font-size: var(--text-xs);
  transition: all var(--transition-fast); min-height: 52px;
}
.action-btn:hover:not(:disabled) { background: var(--bg-hover); border-color: var(--accent); }
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.action-btn--attack { border-color: rgba(248, 81, 73, 0.3); }
.action-btn--defend { border-color: rgba(88, 166, 255, 0.3); }
.action-btn--spell { border-color: rgba(168, 85, 247, 0.3); }
.action-btn--item { border-color: rgba(210, 153, 34, 0.3); }
.action-btn--dash { border-color: rgba(63, 185, 80, 0.3); }
.action-btn--flee { border-color: rgba(120, 113, 108, 0.3); }
.sub-panel { border-top: 1px solid var(--border); padding-top: var(--space-2); }
.sub-header { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
.sub-title { font-size: var(--text-sm); font-weight: 600; }
.spell-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-1); }
.spell-btn {
  display: flex; flex-direction: column; gap: 2px; padding: var(--space-2);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: transparent; color: var(--text); cursor: pointer; text-align: left;
  font-size: var(--text-xs); transition: all var(--transition-fast);
}
.spell-btn:hover:not(:disabled) { background: var(--bg-hover); }
.spell-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.spell-name { font-weight: 500; }
.spell-meta { color: var(--text-dim); font-size: 10px; }
.wait-text { text-align: center; color: var(--text-dim); font-size: var(--text-xs); margin-top: var(--space-2); }
.empty-text { text-align: center; color: var(--text-dim); font-size: var(--text-sm); padding: var(--space-2); }
</style>
