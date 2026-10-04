// ==================== sw.js ====================
// Service Worker：图片本地持久缓存（可离线）
// 策略：stale-while-revalidate（缓存优先 + 后台更新）
// 只缓存本站藏品图片；数据文件、页面与 china_map.svg 一律走网络，避免更新被缓存卡住
//
// ★ A2 补充（2026-09）：页面资源（html/js/css/json/txt/字体/svg）改为
//   「network-first + 断网退回缓存」——在线时永远先取网络，所以上面"更新被缓存卡住"
//   这个担忧依然不成立；只有网络真的失败才用缓存把整页撑起来，
//   手机在没有网络的地方也能翻藏品目录。**图片策略与 CACHE_NAME 一个字都没动。**
//
// 注册位置：collection/index.html 末尾（scope 为 /collection/）
//
// ★ 为什么资源缓存不按 /collection/ 前缀判断：SW 的 scope 决定"哪些页面被接管"，
//   fetch 拦截的却是"被接管页面发出的所有同源请求"——藏品数据在 /notecollection/data/、
//   图片在 /notecollection/image/，都在 scope 之外却依然会被本 SW 拦到。
//   所以判断依据只能是"同源 + GET + 不是藏品图 + 后缀/结尾斜杠"。

const CACHE_NAME = 'collection-images-v3';   // v3：缓存前缀隔离（B12）上线后的一次整体刷新
// ★ 关于版本号什么时候该 +1：
//   activate 只删除「带本前缀且 != CACHE_NAME」的旧缓存，所以改 CACHE_NAME 会让
//   全部已缓存的图片作废、下次访问重新下载（实测这套图约 780MB）。
//   因此：**只在图片内容或缓存策略本身变化时才 +1**，纯代码结构调整不要动它。
//   v2：图片改同源直出（清掉旧的 jsDelivr 缓存）
//   v3：修复同源 SW 互删缓存（改为前缀隔离）后的首次整体刷新
// ★ 本 SW 自己的缓存前缀，activate 只允许清理带这个前缀的旧缓存。
// 原因：Cache Storage 是 **按源（per-origin）** 隔离的，不是按 scope！
// 同源的 stardust-migration/sw.js 也在用它自己的 activate 清缓存，
// 若这里写成「删掉所有 != CACHE_NAME 的缓存」，两个应用会互相清空对方的离线缓存
//（而且不报错，只是缓存没了）。所以两边都必须按各自前缀限定。
const CACHE_PREFIX = 'collection-images-';
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

// ==================== A2：页面资源缓存（只为"断网时还能打开"） ====================
// 与图片策略的区别就是"谁优先"：
//   图片 = 缓存优先（图不会随便变，省流量最要紧）
//   资源 = 网络优先（代码会天天改，宁可多一次请求也绝不吃旧代码）
const ASSET_CACHE = 'collection-assets-v1';
// ★ 资源缓存的版本号只在"资源缓存策略本身变化"时才需要 +1：
//   在线时每次请求都会用网络结果覆盖缓存，不存在"卡住更新"的问题。
const ASSET_PREFIX = 'collection-assets-';
const ASSET_RE = /\.(?:html?|js|mjs|css|json|txt|svg|woff2?|ttf|map)$/i;

function shouldCacheAsset(request) {
    if (!request || request.method !== 'GET') return false;
    let url;
    try {
        url = new URL(request.url);
    } catch (e) {
        return false;
    }
    if (url.origin !== self.location.origin) return false;
    // 藏品图交给上面的图片策略（stale-while-revalidate），这里不重复管
    if (IMAGE_RE.test(url.pathname) && IMAGE_PATH_RE.test(url.pathname)) return false;
    // 页面本身（以 / 结尾）与常见资源后缀
    return ASSET_RE.test(url.pathname) || url.pathname.charAt(url.pathname.length - 1) === '/';
}

// 网络优先：成功就用网络（顺手更新缓存），失败才退回缓存，两者都没有就报网络错误
function networkFirstAsset(request) {
    return caches.open(ASSET_CACHE).then(cache =>
        fetch(request)
            .then(response => {
                if (isCacheable(response)) {
                    const clone = response.clone();
                    cache.put(request, clone).catch(() => {});
                }
                return response;
            })
            .catch(() => cache.match(request, { ignoreSearch: true })
                .then(cached => cached || Response.error()))
    );
}

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                // ★ 只清理本 SW 自己的旧版本（前缀限定），绝不碰同源其它应用的缓存
                keys.filter(k => (k.startsWith(CACHE_PREFIX) || k.startsWith(ASSET_PREFIX)) &&
                                 k !== CACHE_NAME && k !== ASSET_CACHE)
                    .map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // ① 藏品图片：stale-while-revalidate（原逻辑，一字未改）
    if (shouldCache(request)) {
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
        return;
    }

    // ② 页面资源：network-first（在线永远拿最新，断网才有缓存兜底）
    if (shouldCacheAsset(request)) {
        event.respondWith(networkFirstAsset(request));
    }
});

// ★ 支持 SKIP_WAITING 消息
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
