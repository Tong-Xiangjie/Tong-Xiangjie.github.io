import { ref, watch } from 'vue'

const STORAGE_KEY = 'squat-coach-theme'

export const theme = ref('system') // 'light' | 'dark' | 'system'
export const resolvedTheme = ref('light')

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(value) {
  const root = document.documentElement
  if (value === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  resolvedTheme.value = value
}

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark' || saved === 'system') {
    theme.value = saved
  }

  resolveAndApply()

  // 监听系统主题变化
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  mql.addEventListener('change', () => {
    if (theme.value === 'system') {
      resolveAndApply()
    }
  })
}

function resolveAndApply() {
  if (theme.value === 'system') {
    applyTheme(getSystemTheme())
  } else {
    applyTheme(theme.value)
  }
}

export function setTheme(value) {
  theme.value = value
  localStorage.setItem(STORAGE_KEY, value)
  resolveAndApply()
}

export function useTheme() {
  watch(theme, resolveAndApply)
  return { theme, resolvedTheme, setTheme }
}
