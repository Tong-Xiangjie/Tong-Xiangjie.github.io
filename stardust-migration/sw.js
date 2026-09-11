/**
 * sw.js —— 仅用于缓存与 PWA 安装
 *
 * 重要说明：
 * - 本 Service Worker 只做静态资源缓存，让游戏可以离线打开、可以安装到桌面。
 * - 绝对不做任何后台模拟 / 定时任务 / 推送。
 * - 所有离线结算逻辑都在页面打开时由 offline.js 一次性完成。
 * - 作用域被限制在游戏目录（scope: ./），不会影响同域下的其他站点。
 */

const CACHE_NAME = 'stardust-migration-v2';

/** 需要预缓存的静态资源（全部使用相对路径） */
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/ui.js',
  './js/state.js',
  './js/save.js',
  './js/offline.js',
  './js/tasks.js',
  './js/events.js',
  './js/data.js',
  './js/utils.js',
  './js/time.js',
  './js/rng.js',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg',
];

// 安装：预缓存
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 逐个添加，单个失败不影响整体安装
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            console.warn('[sw] 预缓存失败：', url);
          }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// 请求：缓存优先，网络回退（HTML 走网络优先，保证拿到最新版本）
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isDocument = request.mode === 'navigate' || request.destination === 'document';

  if (isDocument) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request);
          return cached || caches.match('./index.html');
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (err) {
        console.warn('[sw] 请求失败且无缓存：', request.url, err);
        throw err;
      }
    })(),
  );
});
