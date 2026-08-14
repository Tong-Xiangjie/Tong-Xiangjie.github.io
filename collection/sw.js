// ==================== sw.js ====================
// Service Worker：图片本地持久缓存（可离线）
// 策略：stale-while-revalidate（缓存优先 + 后台更新）
//
// ★ 更新缓存的方法：
//   1. 把下面 CACHE_NAME 版本号 +1（如 'collection-images-v2'），下次打开自动清旧缓存；
//   2. 或使用「设置页 → 清除图片缓存」按钮（见 settings.js 改动）。

const CACHE_NAME = 'collection-images-v1';

// 只处理 jsDelivr CDN 上的图片，不拦截页面/数据js
function shouldCache(request) {
    const url = new URL(request.url);
    if (!url.hostname.includes('cdn.jsdelivr.net')) return false;
    return /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)$/i.test(url.pathname);
}

// 安装：跳过等待，尽快接管
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// 激活：删除旧版本缓存，立即接管所有页面
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// 请求拦截：缓存优先，同时后台请求网络并更新缓存
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
                .catch(() => cached); // 网络失败时回退缓存（离线可用）
            return cached || network;
        })
    );
});
