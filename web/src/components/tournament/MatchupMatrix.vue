<template>
  <div class="matrix">
    <table class="matrix-table">
      <thead>
        <tr>
          <th class="matrix-corner"></th>
          <th v-for="model in models" :key="model" class="matrix-header">{{ shortName(model) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in models" :key="row">
          <th class="matrix-header">{{ shortName(row) }}</th>
          <td
            v-for="col in models" :key="col"
            class="matrix-cell"
            :class="cellClass(row, col)"
            :title="`${row} vs ${col}: ${cellLabel(row, col)}`"
          >
            <span v-if="row === col" class="matrix-empty">—</span>
            <template v-else>{{ cellLabel(row, col) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="matrix-legend">
      <span class="legend-item"><span class="legend-swatch legend-swatch--win"></span> Row won</span>
      <span class="legend-item"><span class="legend-swatch legend-swatch--loss"></span> Column won</span>
      <span class="legend-item"><span class="legend-swatch legend-swatch--draw"></span> Draw</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  matchups: Array<{ modelA: string; modelB: string; winsA: number; winsB: number; draws: number }>;
  models: string[];
}>();

function shortName(name: string): string {
  return name.length > 16 ? name.slice(0, 14) + '…' : name;
}

function findMatchup(a: string, b: string) {
  return props.matchups.find(m => m.modelA === a && m.modelB === b);
}

function cellLabel(row: string, col: string): string {
  const m = findMatchup(row, col);
  if (!m) return '–';
  return `${m.winsA}-${m.winsB}-${m.draws}`;
}

function cellClass(row: string, col: string): string {
  if (row === col) return 'matrix-cell--empty';
  const m = findMatchup(row, col);
  if (!m) return 'matrix-cell--pending';
  if (m.winsA > m.winsB) return 'matrix-cell--win';
  if (m.winsB > m.winsA) return 'matrix-cell--loss';
  if (m.draws > 0) return 'matrix-cell--draw';
  return 'matrix-cell--draw';
}
</script>

<style scoped>
.matrix { overflow-x: auto; }
.matrix-table { border-collapse: collapse; font-size: var(--text-xs); }
.matrix-corner { width: 80px; }
.matrix-header { padding: var(--space-2); text-align: center; font-weight: 600; color: var(--text-dim); font-size: var(--text-xs); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.matrix-cell { padding: var(--space-2) var(--space-3); text-align: center; border: 1px solid var(--border); font-family: var(--font-mono); min-width: 50px; }
.matrix-cell--win { background: rgba(63, 185, 80, 0.15); color: var(--success); }
.matrix-cell--loss { background: rgba(248, 81, 73, 0.15); color: var(--danger); }
.matrix-cell--draw { background: rgba(210, 153, 34, 0.1); color: var(--warning); }
.matrix-cell--empty { background: transparent; }
.matrix-cell--pending { background: var(--bg); color: var(--text-dim); }
.matrix-empty { color: var(--text-dim); opacity: 0.5; }
.matrix-legend { display: flex; gap: var(--space-4); margin-top: var(--space-2); font-size: var(--text-xs); color: var(--text-dim); }
.legend-item { display: flex; align-items: center; gap: var(--space-1); }
.legend-swatch { width: 12px; height: 12px; border-radius: 2px; border: 1px solid var(--border); }
.legend-swatch--win { background: rgba(63, 185, 80, 0.3); }
.legend-swatch--loss { background: rgba(248, 81, 73, 0.3); }
.legend-swatch--draw { background: rgba(210, 153, 34, 0.2); }
</style>
