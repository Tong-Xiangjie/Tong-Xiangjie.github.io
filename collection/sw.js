// ==================== sw.js ====================
// Service Worker：图片本地持久缓存（可离线）
// 策略：stale-while-revalidate（缓存优先 + 后台更新）
// 只缓存本站藏品图片；数据文件、页面与 china_map.svg 一律走网络，避免更新被缓存卡住
//
// 注册位置：collection/index.html 末尾（scope 为 /collection/）

const CACHE_NAME = 'collection-images-v2';   // v2：图片改同源直出，旧的 jsDelivr 缓存会被 activate 清掉
// 只缓存本站的藏品图片目录，避免把 china_map.svg、页面资源等也缓存住。
const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i;
const IMAGE_PATH_RE = /^\/(?:(?:notecollection|coincollection)\/(?:readmes\/)?image\/|funcollection\/[^/]+\/images\/)/;

function shouldCache(request) {
    if (!request || request.method !== 'GET') return false;
    let url;
    try {
        url = new URL(request.url);
    } catch (e) {
        return false;
    }
    // 同源限定：图片现在由 GitHub Pages 直出（此前走 jsDelivr，但该仓库体积
    // 远超其 50MB 包上限，会被 302 到 raw.githubusercontent.com，反而更慢）。
    if (url.origin !== self.location.origin) return false;
    if (!IMAGE_RE.test(url.pathname)) return false;
    return IMAGE_PATH_RE.test(url.pathname);
}

// ★ 判断响应是否值得入缓存。
// 同源图片响应是 basic（ok === true）；仍保留 opaque 分支作为兜底
// （若日后重新引入跨域图床，no-cors 的 `<img>` 响应 ok === false、status === 0，
//  不额外接受 opaque 就会"响应正常却永远存不进缓存"）。
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
