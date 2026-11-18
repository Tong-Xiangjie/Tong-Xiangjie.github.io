<template>
  <div
    class="dropzone"
    :class="{ 'is-dragover': isDragging, 'is-loading': loading }"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
    @click="triggerFileInput"
  >
    <div class="dropzone-inner">
      <div class="icon-wrap mb-4">
        <component :is="UploadIcon" :size="40" stroke-width="1.5" />
      </div>

      <p class="text-base font-medium mb-1">拖放视频文件到这里</p>
      <p class="text-sm" style="color: var(--text-tertiary)">
        支持 MP4 / WebM / MOV，建议 ≤ 50MB
      </p>

      <div class="divider">或</div>

      <button type="button" class="btn btn-primary">
        <component :is="FolderOpenIcon" :size="16" />
        选择文件
      </button>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="video/mp4,video/webm,video/quicktime,video/*"
      class="hidden"
      @change="onFileSelected"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Upload as UploadIcon, FolderOpen as FolderOpenIcon } from '@lucide/vue'

const emit = defineEmits(['file-selected'])

const props = defineProps({
  loading: { type: Boolean, default: false },
})

const isDragging = ref(false)
const fileInput = ref(null)

function onDragOver() {
  isDragging.value = true
}
function onDragLeave() {
  isDragging.value = false
}
function onDrop(e) {
  isDragging.value = false
  if (props.loading) return
  const file = e.dataTransfer.files[0]
  if (file && file.type.startsWith('video/')) {
    emit('file-selected', file)
  }
}
function triggerFileInput() {
  if (props.loading) return
  fileInput.value?.click()
}
function onFileSelected(e) {
  const file = e.target.files[0]
  if (file) emit('file-selected', file)
  // 重置，允许再次选同一文件
  e.target.value = ''
}
</script>

<style scoped>
.dropzone {
  @apply w-full rounded-lg border-2 border-dashed cursor-pointer transition-all duration-200;
  border-color: var(--border-strong);
  background-color: var(--bg-secondary);
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dropzone:hover {
  border-color: var(--accent);
  background-color: var(--accent-subtle);
}
.dropzone.is-dragover {
  border-color: var(--accent);
  background-color: var(--accent-subtle);
  transform: scale(1.01);
}
.dropzone.is-loading {
  pointer-events: none;
  opacity: 0.6;
}

.dropzone-inner {
  @apply flex flex-col items-center text-center px-8 py-10;
}

.icon-wrap {
  @apply w-16 h-16 rounded-full flex items-center justify-center;
  color: var(--accent);
  background-color: var(--accent-subtle);
}

.divider {
  @apply my-4 flex items-center text-xs;
  color: var(--text-tertiary);
}
.divider::before,
.divider::after {
  content: '';
  width: 24px;
  height: 1px;
  margin: 0 10px;
  background-color: var(--border-strong);
}

.hidden { display: none; }
</style>
