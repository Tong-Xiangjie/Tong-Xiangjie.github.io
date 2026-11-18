<template>
  <div class="relative" ref="containerRef">
    <button
      @click="toggleMenu"
      class="theme-toggle"
      :title="`主题: ${label}`"
      :aria-label="`主题切换 (当前: ${label})`"
    >
      <component :is="currentIcon" :size="16" />
    </button>

    <Transition name="dropdown">
      <div v-if="showMenu" class="theme-dropdown" ref="menuRef">
        <button v-for="opt in options" :key="opt.value"
                @click="select(opt.value)"
                class="theme-option"
                :class="{ active: theme === opt.value }">
          <component :is="opt.icon" :size="14" />
          <span>{{ opt.label }}</span>
          <CheckIcon v-if="theme === opt.value" :size="13" class="ml-auto" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Sun, Moon, Monitor, Check as CheckIcon } from '@lucide/vue'
import { theme, resolvedTheme, setTheme } from '@/composables/useTheme'

const showMenu = ref(false)
const containerRef = ref(null)
const menuRef = ref(null)

const options = [
  { value: 'light',  label: '亮色', icon: Sun },
  { value: 'dark',   label: '暗色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const currentIcon = computed(() => {
  if (theme.value === 'light') return Sun
  if (theme.value === 'dark') return Moon
  return Monitor
})

const label = computed(() => {
  if (theme.value === 'light') return '亮色'
  if (theme.value === 'dark') return '暗色'
  return '跟随系统'
})

function toggleMenu() {
  showMenu.value = !showMenu.value
}

function select(value) {
  setTheme(value)
  showMenu.value = false
}

function handleClickOutside(e) {
  if (containerRef.value && !containerRef.value.contains(e.target)) {
    showMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.theme-toggle {
  @apply w-8 h-8 flex items-center justify-center rounded-md transition-colors;
  color: var(--text-secondary);
}
.theme-toggle:hover {
  color: var(--text-primary);
  background-color: var(--bg-hover);
}

.theme-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 128px;
  padding: 4px;
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 100;
}

.theme-option {
  @apply w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded transition-colors;
  color: var(--text-primary);
}
.theme-option:hover {
  background-color: var(--bg-hover);
}
.theme-option.active {
  color: var(--accent);
  font-weight: 500;
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease-out;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
