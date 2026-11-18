<template>
  <nav class="sticky top-0 z-50 border-b border-[color:var(--border-color)]"
       style="background-color: var(--bg-card); backdrop-filter: blur(8px);">
    <div class="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
      <router-link to="/" class="flex items-center gap-2 group">
        <div class="w-7 h-7 rounded-md flex items-center justify-center transition-transform group-hover:scale-105"
             style="background-color: var(--accent);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="4" r="2"/>
            <path d="M12 6v6l-3 3"/>
            <path d="M9 18l-3 2"/>
            <path d="M15 18l3 2"/>
            <path d="M15 12l3 3"/>
          </svg>
        </div>
        <span class="font-semibold text-base tracking-tight">AI深蹲教练</span>
      </router-link>

      <div class="flex items-center gap-1">
        <router-link to="/" exact-active-class="text-[color:var(--accent)]"
                     class="nav-link">
          首页
        </router-link>
        <router-link to="/history" active-class="text-[color:var(--accent)]"
                     class="nav-link">
          <span class="inline-flex items-center gap-1.5">
            <component :is="HistoryIcon" :size="15" />
            历史记录
          </span>
        </router-link>
        <ThemeToggle />
      </div>
    </div>
  </nav>
</template>

<script setup>
import { History as HistoryIcon } from '@lucide/vue'
import ThemeToggle from './ThemeToggle.vue'
</script>

<style scoped>
.nav-link {
  @apply px-3 py-1.5 text-sm font-medium rounded-md transition-colors duration-200;
  color: var(--text-secondary);
}
.nav-link:hover {
  color: var(--text-primary);
  background-color: var(--bg-hover);
}
</style>
