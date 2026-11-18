<template>
  <div class="pose-overlay relative w-full" :style="{ aspectRatio: aspectRatio }">
    <canvas ref="canvasRef" class="absolute inset-0 w-full h-full" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { POSE_CONNECTIONS } from '@/utils/poseAnalyzer'

const props = defineProps({
  landmarks: { type: Array, default: () => [] },
  showSkeleton: { type: Boolean, default: true },
  showKeypoints: { type: Boolean, default: true },
  width: { type: Number, default: 640 },
  height: { type: Number, default: 480 },
})

const canvasRef = ref(null)
const aspectRatio = computed(() => `${props.width} / ${props.height}`)

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return

  canvas.width = props.width
  canvas.height = props.height
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  if (!props.landmarks || props.landmarks.length === 0) return

  const lm = props.landmarks
  const W = canvas.width
  const H = canvas.height

  if (props.showSkeleton) {
    ctx.lineWidth = 3
    ctx.strokeStyle = '#2d8a6b'
    ctx.lineCap = 'round'

    for (const [a, b] of POSE_CONNECTIONS) {
      if (lm[a] && lm[b]) {
        ctx.beginPath()
        ctx.moveTo(lm[a].x * W, lm[a].y * H)
        ctx.lineTo(lm[b].x * W, lm[b].y * H)
        ctx.stroke()
      }
    }
  }

  if (props.showKeypoints) {
    for (let i = 0; i < lm.length; i++) {
      if (!lm[i]) continue
      const x = lm[i].x * W
      const y = lm[i].y * H
      const c = lm[i].visibility > 0.5 ? '#2d8a6b' : '#888'

      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = c
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }
}

watch(
  () => [props.landmarks, props.showSkeleton, props.showKeypoints],
  () => nextTick(draw),
  { deep: true }
)

onMounted(() => {
  nextTick(draw)
})
</script>

<style scoped>
.pose-overlay {
  /* 透明，让底下的视频透过来 */
  pointer-events: none;
}
canvas {
  display: block;
  background: transparent;
}
</style>
