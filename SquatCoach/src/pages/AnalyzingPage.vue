<template>
  <div class="analyzing-page min-h-[60vh] flex items-center justify-center">
    <div class="text-center animate-fade-in">
      <div class="loader mb-6">
        <div class="loader-ring"></div>
        <div class="loader-icon">
          <component :is="DumbbellIcon" :size="22" :stroke-width="2" />
        </div>
      </div>

      <h2 class="text-lg font-semibold mb-1">正在分析视频...</h2>
      <p class="text-xs mb-6" style="color: var(--text-tertiary)">
        {{ videoName }}
      </p>

      <!-- 进度条 -->
      <div class="progress-wrap mx-auto mb-4">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progress + '%' }" />
        </div>
        <div class="flex justify-between mt-2 text-xs" style="color: var(--text-tertiary)">
          <span>{{ currentStep }}</span>
          <span>{{ progress }}%</span>
        </div>
      </div>

      <p class="text-xs mb-4" style="color: var(--text-tertiary)">
        请保持此页面打开，不要切换到其他页面
      </p>

      <!-- 取消按钮 -->
      <button @click="cancel" class="btn btn-ghost btn-sm">
        <component :is="XCircleIcon" :size="14" />
        取消分析
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { Dumbbell as DumbbellIcon, XCircle as XCircleIcon } from '@lucide/vue'
import { poseAnalyzer } from '@/utils/poseAnalyzer'

const router = useRouter()
const progress = ref(0)
const currentStep = ref('初始化姿态识别模型')
const videoName = ref(sessionStorage.getItem('squat_video_name') || '')
const isAnalyzing = ref(false)
let cancelled = false

// 路由守卫：分析中禁止离开
onBeforeRouteLeave((to, from, next) => {
  if (isAnalyzing.value) {
    const ok = window.confirm('分析尚未完成，离开将终止本次分析。确定离开吗？')
    if (ok) {
      cancelled = true
      next()
    } else {
      next(false)
    }
  } else {
    next()
  }
})

onMounted(async () => {
  const file = window.__squat_video_file
  if (!file) {
    router.replace({ name: 'home' })
    return
  }

  isAnalyzing.value = true

  try {
    currentStep.value = '加载 MediaPipe 模型'
    await poseAnalyzer.init()
    if (cancelled) return

    currentStep.value = '逐帧检测人体姿态'

    const result = await poseAnalyzer.analyzeVideo(file, (p, frame, total) => {
      if (cancelled) return
      progress.value = p
      if (p < 30) currentStep.value = `检测姿态关键点 (${frame}/${total} 帧)`
      else if (p < 70) currentStep.value = `处理动作序列 (${p}%)`
      else currentStep.value = `分析深蹲动作 (${p}%)`
    })

    if (cancelled) return

    currentStep.value = '生成分析报告'
    progress.value = 100

    sessionStorage.setItem('squat_analysis', JSON.stringify(result))

    setTimeout(() => {
      if (!cancelled) {
        isAnalyzing.value = false
        router.replace({ name: 'result' })
      }
    }, 300)
  } catch (err) {
    console.error('分析失败:', err)
    currentStep.value = `分析失败: ${err.message || '未知错误'}`
  } finally {
    isAnalyzing.value = false
  }
})

function cancel() {
  cancelled = true
  isAnalyzing.value = false
  router.replace({ name: 'home' })
}

onBeforeUnmount(() => {
  cancelled = true
})
</script>

<style scoped>
.loader {
  @apply relative w-20 h-20 mx-auto mb-6;
}
.loader-ring {
  @apply absolute inset-0 rounded-full;
  border: 3px solid var(--border-strong);
  border-top-color: var(--accent);
  animation: spin 1.2s linear infinite;
}
.loader-icon {
  @apply absolute inset-0 flex items-center justify-center;
  color: var(--accent);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.progress-wrap {
  max-width: 360px;
}
.progress-bar {
  @apply h-2 rounded-full overflow-hidden;
  background-color: var(--bg-tertiary);
}
.progress-fill {
  @apply h-full transition-all duration-300 ease-out;
  background-color: var(--accent);
  border-radius: inherit;
}
</style>
