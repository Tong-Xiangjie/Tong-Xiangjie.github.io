// ==================== sw.js ====================
// Service Worker：图片本地持久缓存（可离线）
// 策略：stale-while-revalidate（缓存优先 + 后台更新）

const CACHE_NAME = 'collection-images-v1';

function shouldCache(request) {
    const url = new URL(request.url);
    if (!url.hostname.includes('cdn.jsdelivr.net')) return false;
    return /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)$/i.test(url.pathname);
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (!shouldCache(event.request)) return;

    event.respondWith(
        caches.match(event.request).then(cached => {
            const network = fetch(event.request)
                .then(response => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});

// ★ 新增：支持 SKIP_WAITING 消息
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});