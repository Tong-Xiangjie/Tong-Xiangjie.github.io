<template>
  <div class="app-root min-h-screen flex flex-col">
    <AppNav />
    <main class="flex-1">
      <router-view v-slot="{ Component, route }">
        <transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </transition>
      </router-view>
    </main>
    <footer class="py-6 text-center text-xs text-[color:var(--text-tertiary)] border-t border-[color:var(--border-color)]">
      AI深蹲教练 &mdash; 本地处理，数据不上传
    </footer>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import AppNav from '@/components/AppNav.vue'
import { initTheme } from '@/composables/useTheme'

onMounted(() => {
  initTheme()
})
</script>
