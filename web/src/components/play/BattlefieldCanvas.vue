<template>
  <div class="canvas-wrapper">
    <canvas ref="canvasRef" :width="canvasW" :height="canvasH"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { CharState } from '../../types';

const props = defineProps<{
  characters: CharState[];
  arena?: { width: number; height: number; label: string };
  currentActorId?: string;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const CELL = 24;
const PAD = 8;

const arenaW = computed(() => props.arena?.width || 20);
const arenaH = computed(() => props.arena?.height || 12);
const canvasW = computed(() => arenaW.value * CELL + PAD * 2);
const canvasH = computed(() => arenaH.value * CELL + PAD * 2);

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= arenaW.value; x++) {
    ctx.beginPath();
    ctx.moveTo(PAD + x * CELL, PAD);
    ctx.lineTo(PAD + x * CELL, PAD + arenaH.value * CELL);
    ctx.stroke();
  }
  for (let y = 0; y <= arenaH.value; y++) {
    ctx.beginPath();
    ctx.moveTo(PAD, PAD + y * CELL);
    ctx.lineTo(PAD + arenaW.value * CELL, PAD + y * CELL);
    ctx.stroke();
  }

  // Characters
  const teamColors: Record<string, string> = {};
  const colorPalette = ['#58a6ff', '#f85149', '#3fb950', '#d29922', '#bc8cff'];
  let colorIdx = 0;
  for (const char of props.characters) {
    if (!teamColors[char.team]) teamColors[char.team] = colorPalette[colorIdx++ % colorPalette.length];
  }

  for (const char of props.characters) {
    if (char.hp <= 0) continue;
    const x = (char.position?.x || 0) * CELL + PAD;
    const y = (char.position?.y || 0) * CELL + PAD;
    const isActive = char.id === props.currentActorId;

    // Glow for active
    if (isActive) {
      ctx.beginPath();
      ctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(88, 166, 255, 0.2)';
      ctx.fill();
    }

    // Circle
    ctx.beginPath();
    ctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = teamColors[char.team] || '#8b949e';
    ctx.fill();
    ctx.strokeStyle = isActive ? '#58a6ff' : '#30363d';
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.stroke();

    // Initial
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char.name[0].toUpperCase(), x + CELL / 2, y + CELL / 2);
  }
}

watch(() => [props.characters, props.currentActorId], draw, { deep: true });
onMounted(draw);
</script>

<style scoped>
.canvas-wrapper { overflow-x: auto; }
canvas { display: block; border-radius: var(--radius-sm); }
</style>
