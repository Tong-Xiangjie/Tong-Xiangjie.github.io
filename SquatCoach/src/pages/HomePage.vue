<template>
  <div class="home-page">
    <div class="max-w-4xl mx-auto px-6 py-12">
      <div class="text-center mb-10 animate-fade-up">
        <h1 class="text-3xl font-bold mb-3 tracking-tight">
          上传深蹲视频，AI 帮你数次数、评姿势
        </h1>
        <p class="text-sm max-w-xl mx-auto" style="color: var(--text-secondary)">
          所有分析在浏览器本地完成，视频不会上传到任何服务器。
          拖拽即可使用，无需注册或安装。
        </p>
      </div>

      <VideoDropzone @file-selected="handleFile" class="animate-scale-in" />

      <!-- 示例提示 -->
      <div class="mt-8 animate-fade-up" style="animation-delay: 120ms">
        <div class="flex items-center justify-center gap-2 mb-4 text-xs" style="color: var(--text-tertiary)">
          <div class="flex-1 h-px" style="background-color: var(--border-strong)" />
          <span>拍摄建议</span>
          <div class="flex-1 h-px" style="background-color: var(--border-strong)" />
        </div>

        <div class="grid grid-cols-3 gap-4 max-w-xl mx-auto">
          <div v-for="tip in tips" :key="tip"
               class="card p-4 text-center text-xs">
            <component :is="tip.icon" :size="20" class="mx-auto mb-2"
                       style="color: var(--accent)" />
            {{ tip.text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { Camera, Sun, PersonStanding } from '@lucide/vue'
import VideoDropzone from '@/components/VideoDropzone.vue'

const router = useRouter()
const uploadedFile = ref(null)

const tips = [
  { icon: Camera, text: '全身入镜，包含头部到脚踝' },
  { icon: Sun, text: '光线充足，避免逆光拍摄' },
  { icon: PersonStanding, text: '侧面或 45° 视角效果更佳' },
]

function handleFile(file) {
  uploadedFile.value = file
  // 通过 sessionStorage 传文件信息给分析页
  sessionStorage.setItem('squat_video_name', file.name)
  sessionStorage.setItem('squat_video_size', String(file.size))
  // 把 File 存到全局变量（跨路由传递）
  window.__squat_video_file = file
  router.push({ name: 'analyzing' })
}
</script>
