<template>
  <div class="history-page max-w-5xl mx-auto px-6 py-8">
    <div class="flex items-center justify-between mb-6 animate-fade-up">
      <h1 class="text-xl font-bold tracking-tight">历史记录</h1>
      <div class="flex items-center gap-2">
        <button @click="triggerImport" class="btn btn-sm">
          <component :is="DownloadIcon" :size="14" />
          导入
        </button>
        <button @click="exportData" class="btn btn-sm" :disabled="records.length === 0">
          <component :is="UploadIcon" :size="14" />
          导出全部
        </button>
        <button v-if="records.length > 0" @click="confirmClear" class="btn btn-ghost btn-sm danger">
          <component :is="TrashIcon" :size="14" />
          清空
        </button>
        <button @click="handleResetDb" class="btn btn-ghost btn-sm" title="重置本地数据库（修复保存失败问题）">
          <component :is="RefreshCwIcon" :size="14" />
          重置
        </button>
        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleImport" />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!loading && records.length === 0"
         class="card p-12 text-center animate-scale-in">
      <div class="empty-icon mx-auto mb-4"
           style="background-color: var(--bg-secondary); color: var(--text-tertiary)">
        <component :is="FolderArchiveIcon" :size="32" />
      </div>
      <p class="text-base font-medium mb-1">暂无训练记录</p>
      <p class="text-sm mb-5" style="color: var(--text-tertiary)">
        完成第一次深蹲分析后，结果会自动保存到这里
      </p>
      <router-link to="/" class="btn btn-primary">
        <component :is="ArrowRightIcon" :size="14" />
        开始分析
      </router-link>
    </div>

    <!-- 记录列表 -->
    <div v-else class="space-y-3">
      <transition-group name="list">
        <div v-for="(rec, idx) in records" :key="rec.id"
             class="card p-0 animate-fade-up overflow-hidden"
             :style="{ animationDelay: (idx * 30) + 'ms' }">

          <!-- 主卡片头部（可点击展开） -->
          <div class="card-row" @click="toggleDetail(rec.id)">
            <div class="flex-shrink-0 text-center w-24">
              <div class="text-2xl font-bold tracking-tight">{{ rec.totalCount }}</div>
              <div class="text-xs" style="color: var(--text-tertiary)">次深蹲</div>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1.5">
                <component :is="CalendarIcon" :size="13" style="color: var(--text-tertiary)" />
                <span class="text-sm">{{ formatDate(rec.createdAt) }}</span>
                <span class="badge" :class="'badge-' + getScoreClass(rec.poseScore)">
                  {{ getScoreLabel(rec.poseRating) }} ({{ rec.poseScore }})
                </span>
              </div>

              <div class="flex items-center gap-3 text-xs">
                <div v-for="(dim, key) in rec.poseDimensions" :key="key" class="dim-chip"
                     :class="dim.status === 'ok' ? 'ok' : 'warn'"
                     :title="dim.detail || ''">
                  <component :is="dim.status === 'ok' ? CheckIcon : AlertIcon" :size="11" />
                  {{ dimLabels[key] }}
                </div>
              </div>
            </div>

            <div class="flex items-center gap-1" @click.stop>
              <button @click="exportSingle(rec)" class="btn btn-ghost btn-sm" title="导出单条">
                <component :is="UploadIcon" :size="14" />
              </button>
              <button @click="confirmDelete(rec)" class="btn btn-ghost btn-sm" title="删除">
                <component :is="TrashIcon" :size="14" />
              </button>
              <component :is="expandedId === rec.id ? ChevronUpIcon : ChevronDownIcon"
                         :size="15" class="ml-1 transition-transform"
                         style="color: var(--text-tertiary)" />
            </div>
          </div>

          <!-- 展开详情 -->
          <Transition name="expand">
            <div v-if="expandedId === rec.id" class="detail-panel">
              <!-- 节奏统计 -->
              <div class="detail-section">
                <div class="detail-title">
                  <component :is="ActivityIcon" :size="13" />
                  节奏统计
                </div>
                <div class="detail-stats">
                  <div class="stat-item">
                    <span class="stat-label">最快</span>
                    <span class="stat-value">{{ formatMs(rec.rhythmStats?.fastest) }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">平均</span>
                    <span class="stat-value">{{ formatMs(rec.rhythmStats?.average) }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">最慢</span>
                    <span class="stat-value">{{ formatMs(rec.rhythmStats?.slowest) }}</span>
                  </div>
                </div>
              </div>

              <!-- 姿势详情 + 建议 -->
              <div class="detail-section">
                <div class="detail-title">
                  <component :is="ClipboardListIcon" :size="13" />
                  姿势详情与建议
                </div>
                <div class="space-y-2.5">
                  <div v-for="(dim, key) in rec.poseDimensions" :key="key"
                       class="dim-detail"
                       :class="dim.status === 'ok' ? 'ok' : 'warn'">
                    <div class="dim-detail-head">
                      <div class="dim-detail-label">
                        <component :is="dim.status === 'ok' ? CheckIcon : AlertIcon" :size="13" />
                        {{ dimLabels[key] }}
                      </div>
                      <span class="dim-detail-status">{{ dim.status === 'ok' ? '达标' : '需改进' }}</span>
                    </div>
                    <p v-if="dim.detail" class="dim-detail-text">{{ dim.detail }}</p>
                    <p v-if="dim.suggestion" class="dim-detail-suggestion">
                      <component :is="LightbulbIcon" :size="11" />
                      {{ dim.suggestion }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </transition-group>
    </div>

    <!-- 确认对话框 -->
    <Transition name="modal">
      <div v-if="confirmState.show" class="modal-backdrop" @click.self="cancelConfirm">
        <div class="modal-box animate-scale-in">
          <h3 class="text-base font-semibold mb-2">{{ confirmState.title }}</h3>
          <p class="text-sm mb-5" style="color: var(--text-secondary)">{{ confirmState.message }}</p>
          <div class="flex items-center justify-end gap-2">
            <button @click="cancelConfirm" class="btn btn-sm">取消</button>
            <button @click="executeConfirm" class="btn btn-primary btn-sm danger">
              {{ confirmState.confirmText || '确认' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  Download as DownloadIcon, Upload as UploadIcon, Trash as TrashIcon,
  FolderArchive as FolderArchiveIcon, ArrowRight as ArrowRightIcon,
  Calendar as CalendarIcon, Check as CheckIcon, AlertCircle as AlertIcon,
  RefreshCw as RefreshCwIcon, ChevronUp as ChevronUpIcon, ChevronDown as ChevronDownIcon,
  Activity as ActivityIcon, ClipboardList as ClipboardListIcon, Lightbulb as LightbulbIcon,
} from '@lucide/vue'
import { getAllRecords, deleteRecord, clearAllRecords, exportAllRecords, importRecords, resetDb } from '@/db'

const loading = ref(true)
const records = ref([])
const fileInput = ref(null)
const expandedId = ref(null)

function toggleDetail(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function formatMs(ms) {
  if (!ms || ms <= 0) return '-'
  return (ms / 1000).toFixed(1) + 's'
}

const dimLabels = {
  depth: '深度', kneeDir: '膝盖', kneeOver: '脚尖', back: '背部', lean: '前倾',
}

const confirmState = ref({ show: false, action: null, title: '', message: '', confirmText: '' })

async function load() {
  loading.value = true
  records.value = await getAllRecords()
  loading.value = false
}

function formatDate(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getScoreLabel(rating) {
  return { excellent: '优秀', good: '良好', pass: '合格', need_improve: '需改进' }[rating] || '-'
}
function getScoreClass(score) {
  if (score >= 75) return 'ok'
  if (score >= 60) return 'warn'
  return 'error'
}

function confirmDelete(rec) {
  confirmState.value = {
    show: true,
    action: () => deleteRecord(rec.id).then(load),
    title: '删除记录',
    message: `确定删除 ${formatDate(rec.createdAt)} 的训练记录吗？此操作无法撤销。`,
    confirmText: '删除',
  }
}
function confirmClear() {
  confirmState.value = {
    show: true,
    action: () => clearAllRecords().then(load),
    title: '清空所有记录',
    message: '确定清空所有训练记录吗？此操作无法撤销，建议先导出备份。',
    confirmText: '清空',
  }
}
function cancelConfirm() {
  confirmState.value.show = false
}
function executeConfirm() {
  const action = confirmState.value.action
  confirmState.value.show = false
  if (action) action()
}

async function exportData() {
  const data = await exportAllRecords()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `squat-history-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function exportSingle(rec) {
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    records: [rec],
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `squat-record-${new Date(rec.createdAt).toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function triggerImport() {
  fileInput.value?.click()
}
async function handleImport(e) {
  const file = e.target.files[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (!data.records || !Array.isArray(data.records)) {
      throw new Error('文件格式不正确')
    }
    await importRecords(data.records)
    await load()
  } catch (err) {
    alert('导入失败: ' + err.message)
  }
  e.target.value = ''
}

async function handleResetDb() {
  if (!confirm('确定重置本地数据库吗？这会清空所有历史记录。\n此操作可修复"保存失败"问题。')) return
  try {
    await resetDb()
    await load()
    alert('数据库已重置')
  } catch (err) {
    alert('重置失败: ' + err.message)
  }
}

onMounted(load)
</script>

<style scoped>
.dim-chip {
  @apply inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px];
}
.dim-chip.ok {
  color: var(--accent);
  background-color: var(--accent-subtle);
}
.dim-chip.warn {
  color: var(--status-warn);
  background-color: rgba(201, 138, 45, 0.12);
}

.empty-icon {
  @apply w-16 h-16 rounded-full flex items-center justify-center mx-auto;
}

.btn.danger {
  color: var(--status-error);
}
.btn.danger:hover {
  background-color: rgba(184, 74, 74, 0.1);
}

.hidden { display: none; }

/* List transition */
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-box {
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 24px;
  min-width: 340px;
  max-width: 90%;
  box-shadow: var(--shadow-lg);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

/* 卡片头部 */
.card-row {
  @apply flex items-center gap-4 p-5 cursor-pointer transition-colors;
}
.card-row:hover {
  background-color: var(--bg-hover);
}

/* 展开详情 */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}
.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 1000px;
}

.detail-panel {
  border-top: 1px solid var(--border-color);
  padding: 16px 20px 20px;
  background-color: var(--bg-secondary);
}

.detail-section {
  margin-bottom: 14px;
}
.detail-section:last-child {
  margin-bottom: 0;
}

.detail-title {
  @apply flex items-center gap-1.5 text-xs font-semibold mb-2;
  color: var(--text-secondary);
}

.detail-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.stat-item {
  @apply text-center py-2 rounded;
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
}
.stat-label {
  @apply block text-[11px];
  color: var(--text-tertiary);
}
.stat-value {
  @apply block text-sm font-semibold mt-0.5;
}

.dim-detail {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background-color: var(--bg-card);
}
.dim-detail-head {
  @apply flex items-center justify-between mb-1;
}
.dim-detail-label {
  @apply flex items-center gap-1.5 text-sm font-medium;
}
.dim-detail-label.ok {
  color: var(--accent);
}
.dim-detail-label.warn {
  color: var(--status-warn);
}
.dim-detail-status {
  @apply text-[11px] font-medium px-2 py-0.5 rounded;
}
.dim-detail.ok .dim-detail-status {
  color: var(--accent);
  background-color: var(--accent-subtle);
}
.dim-detail.warn .dim-detail-status {
  color: var(--status-warn);
  background-color: rgba(201, 138, 45, 0.12);
}
.dim-detail-text {
  @apply text-xs mb-1;
  color: var(--text-secondary);
}
.dim-detail-suggestion {
  @apply flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded;
  color: var(--text-secondary);
  background-color: var(--bg-secondary);
}
</style>
