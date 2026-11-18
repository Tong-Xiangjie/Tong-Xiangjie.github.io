<template>
  <div class="result-page max-w-6xl mx-auto px-6 py-8">
    <!-- 顶部操作栏 -->
    <div class="flex items-center justify-between mb-6 animate-fade-up">
      <h1 class="text-xl font-bold tracking-tight">分析结果</h1>
      <div class="flex items-center gap-2">
        <span v-if="saved" class="badge badge-ok">
          <component :is="CheckIcon" :size="12" />
          已自动保存
        </span>
        <router-link to="/" class="btn btn-ghost btn-sm">
          <component :is="RefreshCwIcon" :size="14" />
          新分析
        </router-link>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <!-- 左侧：计数 + 视频回放 -->
      <div class="lg:col-span-3 space-y-6">
        <!-- 计数面板 -->
        <div class="card p-5 animate-fade-up" style="animation-delay: 50ms">
          <div class="flex items-center gap-2 mb-3">
            <component :is="HashIcon" :size="16" style="color: var(--accent)" />
            <span class="text-sm font-medium">计数结果</span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="text-5xl font-bold tracking-tight">{{ analysis?.totalCount || 0 }}</span>
            <span class="text-sm" style="color: var(--text-tertiary)">次深蹲</span>
          </div>

          <div v-if="analysis?.totalCount > 0"
               class="grid grid-cols-3 gap-3 mt-5 pt-5 border-t"
               style="border-color: var(--border-color)">
            <div class="stat">
              <div class="stat-label">最快节奏</div>
              <div class="stat-value">{{ formatMs(analysis.rhythmStats.fastest) }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">平均节奏</div>
              <div class="stat-value">{{ formatMs(analysis.rhythmStats.average) }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">最慢节奏</div>
              <div class="stat-value">{{ formatMs(analysis.rhythmStats.slowest) }}</div>
            </div>
          </div>
        </div>

        <!-- 视频回放区 -->
        <div class="card p-5 animate-fade-up" style="animation-delay: 100ms">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <component :is="PlayIcon" :size="16" style="color: var(--accent)" />
              <span class="text-sm font-medium">视频回放</span>
            </div>
            <label class="flex items-center gap-2 text-xs cursor-pointer select-none">
              <span>骨架叠加</span>
              <span class="toggle" :class="{ on: showSkeleton }" @click="showSkeleton = !showSkeleton">
                <span class="toggle-dot"></span>
              </span>
            </label>
          </div>

          <!-- 视频 -->
          <div class="video-wrap">
            <video
              ref="videoRef"
              :src="videoUrl"
              class="w-full rounded-md block"
              @timeupdate="onTimeUpdate"
              @loadedmetadata="onVideoLoaded"
              controls
            />

            <!-- 骨架叠加层 -->
            <div class="skeleton-overlay" v-if="showSkeleton && currentLandmarks">
              <PoseOverlay
                :landmarks="currentLandmarks"
                :show-skeleton="showSkeleton"
                :show-keypoints="showSkeleton"
                :width="videoWidth"
                :height="videoHeight"
              />
            </div>
          </div>

          <!-- 时间轴标记 -->
          <div v-if="analysis?.repTimestamps?.length > 0" class="mt-3">
            <div class="text-xs mb-1" style="color: var(--text-tertiary)">
              深蹲标记 (共 {{ analysis.repTimestamps.length }} 次)
            </div>
            <div class="timeline">
              <div v-for="(rep, i) in analysis.repTimestamps" :key="i"
                   class="timeline-rep"
                   :title="`第 ${i + 1} 次: ${(rep.start / 1000).toFixed(1)}s - ${(rep.end / 1000).toFixed(1)}s`"
                   :style="repStyle(rep)">
                <span class="rep-num">{{ i + 1 }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：姿势评分卡 -->
      <div class="lg:col-span-2 space-y-6">
        <!-- 总评分 -->
        <div class="card p-5 animate-fade-up" style="animation-delay: 80ms">
          <div class="flex items-center gap-2 mb-3">
            <component :is="StarIcon" :size="16" style="color: var(--accent)" />
            <span class="text-sm font-medium">姿势评分</span>
          </div>

          <div class="flex items-baseline gap-3 mb-4">
            <span class="text-5xl font-bold tracking-tight"
                  :style="{ color: scoreColor }">{{ analysis?.poseScore ?? 0 }}</span>
            <span class="text-sm" style="color: var(--text-tertiary)">/ 100</span>
          </div>

          <div class="badge" :class="'badge-' + scoreBadgeClass">
            {{ ratingLabel }}
          </div>
        </div>

        <!-- 5维度详情 -->
        <div class="card p-5 animate-fade-up" style="animation-delay: 130ms">
          <div class="flex items-center gap-2 mb-3">
            <component :is="ClipboardCheckIcon" :size="16" style="color: var(--accent)" />
            <span class="text-sm font-medium">姿势详情</span>
          </div>

          <div class="space-y-4">
            <div v-for="(dim, key) in poseLabels" :key="key"
                 class="dim-item">
              <div class="dim-header">
                <div class="dim-label">
                  <span class="dim-icon"
                        :style="{ color: dim.status === 'ok' ? 'var(--accent)' : 'var(--status-warn)' }">
                    <component :is="dim.status === 'ok' ? CheckCircleIcon : AlertCircleIcon" :size="15" />
                  </span>
                  {{ dim.label }}
                </div>
                <span class="dim-status" :class="dim.status === 'ok' ? 'ok' : 'warn'">
                  {{ dim.status === 'ok' ? '达标' : '需改进' }}
                </span>
              </div>
              <p v-if="dim.detail" class="dim-detail">{{ dim.detail }}</p>
              <p v-if="dim.suggestion" class="dim-suggestion">
                <component :is="LightbulbIcon" :size="12" />
                {{ dim.suggestion }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Save as SaveIcon, Check as CheckIcon, RefreshCw as RefreshCwIcon,
  Hash as HashIcon, Play as PlayIcon, Star as StarIcon,
  ClipboardCheck as ClipboardCheckIcon, Lightbulb as LightbulbIcon,
  CheckCircle as CheckCircleIcon, AlertCircle as AlertCircleIcon,
} from '@lucide/vue'
import { saveRecord } from '@/db'
import PoseOverlay from '@/components/PoseOverlay.vue'

const router = useRouter()

const analysis = ref(null)
const videoRef = ref(null)
const saved = ref(false)
const showSkeleton = ref(true)

const videoUrl = ref('')
const videoWidth = ref(640)
const videoHeight = ref(480)
const currentLandmarks = ref(null)

const poseLabels = computed(() => ({
  depth:    { label: '下蹲深度', ...analysis.value?.poseDimensions?.depth || {} },
  kneeDir:  { label: '膝盖方向', ...analysis.value?.poseDimensions?.kneeDir || {} },
  kneeOver: { label: '膝盖过脚尖', ...analysis.value?.poseDimensions?.kneeOver || {} },
  back:     { label: '背部挺直', ...analysis.value?.poseDimensions?.back || {} },
  lean:     { label: '身体前倾', ...analysis.value?.poseDimensions?.lean || {} },
}))

const scoreColor = computed(() => {
  const s = analysis.value?.poseScore ?? 0
  if (s >= 90) return 'var(--accent)'
  if (s >= 75) return 'var(--accent)'
  if (s >= 60) return 'var(--status-warn)'
  return 'var(--status-error)'
})

const scoreBadgeClass = computed(() => {
  const s = analysis.value?.poseScore ?? 0
  if (s >= 75) return 'ok'
  if (s >= 60) return 'warn'
  return 'error'
})

const ratingLabel = computed(() => {
  const r = analysis.value?.poseRating
  return {
    excellent: '优秀',
    good:      '良好',
    pass:      '合格',
    need_improve: '需改进',
  }[r] || '未知'
})

function formatMs(ms) {
  if (!ms || ms <= 0) return '-'
  return (ms / 1000).toFixed(1) + 's'
}

function repStyle(rep) {
  const duration = analysis.value?.repTimestamps.reduce((s, r) => Math.max(s, r.end), 0) || 10000
  const leftPct = (rep.start / duration) * 100
  const widthPct = ((rep.end - rep.start) / duration) * 100
  return { left: leftPct + '%', width: Math.max(2, widthPct) + '%' }
}

function onVideoLoaded() {
  if (videoRef.value) {
    videoWidth.value = videoRef.value.videoWidth || 640
    videoHeight.value = videoRef.value.videoHeight || 480
  }
}

function onTimeUpdate() {
  if (!videoRef.value || !analysis.value?.keypoints) return
  const t = videoRef.value.currentTime * 1000 // ms

  // 找最接近当前时间的关键点帧
  const frames = analysis.value.keypoints
  let bestIdx = -1
  let bestDiff = Infinity
  for (let i = 0; i < frames.length; i++) {
    const diff = Math.abs(frames[i].time - t)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = i
    }
  }
  if (bestIdx >= 0 && bestDiff < 100) {
    currentLandmarks.value = frames[bestIdx].landmarks
  }
}

async function saveToHistory() {
  if (!analysis.value || saved.value) return
  try {
    // 强制转成纯 plain object，避免 Vue Proxy 或不可序列化对象导致 Dexie DataCloneError
    const record = JSON.parse(JSON.stringify({
      createdAt: Date.now(),
      totalCount: analysis.value.totalCount,
      repTimestamps: analysis.value.repTimestamps,
      rhythmStats: analysis.value.rhythmStats,
      poseScore: analysis.value.poseScore,
      poseRating: analysis.value.poseRating,
      poseDimensions: analysis.value.poseDimensions,
    }))
    await saveRecord(record)
    saved.value = true
  } catch (err) {
    console.error('保存失败:', err)
  }
}

onMounted(async () => {
  const raw = sessionStorage.getItem('squat_analysis')
  if (!raw) {
    router.replace({ name: 'home' })
    return
  }
  analysis.value = JSON.parse(raw)

  const file = window.__squat_video_file
  if (file) {
    videoUrl.value = URL.createObjectURL(file)
  }

  // 自动保存到历史
  await saveToHistory()
})

onBeforeUnmount(() => {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
  }
})
</script>

<style scoped>
.stat-label {
  @apply text-xs;
  color: var(--text-tertiary);
}
.stat-value {
  @apply text-sm font-semibold mt-1;
}

.dim-item {
  padding: 0;
}
.dim-header {
  @apply flex items-center justify-between;
}
.dim-label {
  @apply flex items-center gap-2 text-sm font-medium;
}
.dim-icon {
  @apply flex items-center;
}
.dim-status {
  @apply text-xs font-medium px-2 py-0.5 rounded-sm;
}
.dim-status.ok {
  color: var(--accent);
  background-color: var(--accent-subtle);
}
.dim-status.warn {
  color: var(--status-warn);
  background-color: rgba(201, 138, 45, 0.15);
}
.dim-detail {
  @apply text-xs mt-1;
  color: var(--text-secondary);
}
.dim-suggestion {
  @apply flex items-center gap-1.5 text-xs mt-1.5 px-3 py-2 rounded;
  color: var(--text-secondary);
  background-color: var(--bg-secondary);
}

.video-wrap {
  position: relative;
}
.skeleton-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* Toggle switch */
.toggle {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background-color: var(--bg-tertiary);
  position: relative;
  transition: background-color 0.2s;
  cursor: pointer;
}
.toggle.on {
  background-color: var(--accent);
}
.toggle-dot {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background-color: white;
  transition: transform 0.2s;
}
.toggle.on .toggle-dot {
  transform: translateX(14px);
}

/* Timeline */
.timeline {
  position: relative;
  height: 16px;
  background-color: var(--bg-tertiary);
  border-radius: 4px;
}
.timeline-rep {
  position: absolute;
  top: 2px;
  height: 12px;
  background-color: var(--accent);
  border-radius: 2px;
  opacity: 0.85;
  cursor: pointer;
}
.rep-num {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: var(--text-tertiary);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.15s;
}
.timeline-rep:hover .rep-num {
  opacity: 1;
}
.timeline-rep:hover {
  opacity: 1;
  background-color: var(--accent-hover);
}
</style>
