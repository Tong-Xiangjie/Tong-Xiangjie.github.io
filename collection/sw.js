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
// ★ 版本号 +1 的时机（本次即是）：策略本身变了。v2 = fetch 强制 reload（绕开 HTTP 缓存）
//   + 去掉 ignoreSearch + 入口脚本带 ?v=。改这个名字会让 activate 清掉 v1 的旧资源缓存。
const ASSET_CACHE = 'collection-assets-v2';
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

// 网络优先：成功就用网络（顺手更新缓存），失败才退回缓存，两者都没有就报网络错误。
// ★ fetch(..., { cache: 'reload' })：强制绕过 HTTP 缓存。
//   不加这个，Service Worker 自己的 fetch 照样吃浏览器 HTTP 缓存的旧副本，
//   而线上这些文件是 Cache-Control: max-age=600 ⇒ 表现就是用户实测的
//   "同一条分享链接换个浏览器就好了、过一会儿又好了"（旧 gate.js 根本不认 ?share=，直接拒）。
//   ASSET_RE 管的只是 html/js/css 这类小体积代码资源（图走上面那条图片策略），
//   多一次网络请求换"绝不发旧代码"，与上面那句策略说明一致。
function networkFirstAsset(request) {
    return caches.open(ASSET_CACHE).then(cache =>
        fetch(request, { cache: 'reload' })
            .then(response => {
                if (isCacheable(response)) {
                    const clone = response.clone();
                    cache.put(request, clone).catch(() => {});
                }
                return response;
            })
            // ★ 不用 ignoreSearch：入口里两个门禁脚本现在带 ?v=<内容哈希>，精确匹配才拿得到
            //   对应版本；带上 ignoreSearch 反而会把"没版本号"的旧副本配出来（正是要避免的事）。
            .catch(() => cache.match(request)
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
                            // ★ put 必须交给 event.waitUntil 兜住。
                            //   原来只是"发出去就不管"：respondWith 已经用网络响应解决了，
                            //   这个 put 就成了游离的 Promise —— SW 一旦被挂起/回收，
                            //   或者它比"下一次读缓存"到得还晚，就会表现为
                            //   "第二次请求仍然打到服务器 / 缓存里查不到这张图"。
                            //   CI windows 上偶发的
                            //   「★ 这张图确实被写进了 collection-images 缓存」红就是这个窗口。
                            //   waitUntil 不改变任何响应行为（返回的仍是 response），
                            //   只是让浏览器把这次写入当成"这次 fetch 事件的收尾工作"，
                            //   从而保证它跑完（离线可用性只增不减）。
                            const put = caches.open(CACHE_NAME)
                                .then(cache => cache.put(request, clone))
                                .catch(() => {});
                            try { event.waitUntil(put); } catch (e) {}
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

// ③ 文档（HTML）导航：同样强制绕过 HTTP 缓存。
//    ★ 为什么必须单独做：GitHub Pages 给 HTML 发的是 Cache-Control: max-age=600
//      （10 分钟）。HTML 被缓存 ⇒ 里面那两个 <script src="…?v=…"> 的版本戳也是旧的
//      ⇒ 浏览器照旧加载**旧脚本**，于是"代码明明改了，页面表现没变"（用户实测的
//      "还是一样？是因为缓存吗"）。脚本带 ?v= 只能解决脚本自身的缓存，解决不了
//      "拿到旧 HTML"这件事，所以这里把导航请求也按 cache:'reload' 走网络。
//    离线时仍然退回缓存（可用性只增不减）。
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.mode !== 'navigate') return;
    event.respondWith(
        fetch(request, { cache: 'reload' })
            .catch(() => caches.match(request).then(r => r || Response.error()))
    );
});

// ★ 支持 SKIP_WAITING 消息
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
