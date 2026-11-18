import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/pages/HomePage.vue'),
  },
  {
    path: '/analyzing',
    name: 'analyzing',
    component: () => import('@/pages/AnalyzingPage.vue'),
  },
  {
    path: '/result',
    name: 'result',
    component: () => import('@/pages/ResultPage.vue'),
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('@/pages/HistoryPage.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
