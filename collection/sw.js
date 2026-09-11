// ==================== sw.js ====================
// Service Worker：图片本地持久缓存（可离线）
// 策略：stale-while-revalidate（缓存优先 + 后台更新）
// 只缓存 CDN 上的图片；数据文件与页面一律走网络，避免更新被缓存卡住
//
// 注册位置：collection/index.html 末尾（scope 为 /collection/）

const CACHE_NAME = 'collection-images-v1';
const CDN_HOST = 'cdn.jsdelivr.net';
const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)$/i;

function shouldCache(request) {
    if (!request || request.method !== 'GET') return false;
    let url;
    try {
        url = new URL(request.url);
    } catch (e) {
        return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.hostname.indexOf(CDN_HOST) === -1) return false;
    return IMAGE_RE.test(url.pathname);
}

// ★ 判断响应是否值得入缓存
// 页面里的 <img> 发往 CDN 的是 no-cors 请求，返回的 opaque 响应
// ok === false 且 status === 0，所以必须额外接受 response.type === 'opaque'，
// 否则「响应正常但永远存不进缓存」，离线看图会静默失效。
function isCacheable(response) {
    if (!response) return false;
    return response.ok || response.type === 'opaque';
}

self.addEventListener('install', () => {
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
    const request = event.request;
    if (!shouldCache(request)) return;

    event.respondWith(
        caches.match(request).then(cached => {
            const network = fetch(request)
                .then(response => {
                    if (isCacheable(response)) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(request, clone))
                            .catch(() => {});
                    }
                    return response;
                })
                // 网络失败时退回缓存；若本来就没缓存，返回网络错误响应
                // （会让图片加载失败，从而被「图片重试」按钮收集）
                .catch(() => cached || Response.error());
            return cached || network;
        })
    );
});

// ★ 支持 SKIP_WAITING 消息
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
