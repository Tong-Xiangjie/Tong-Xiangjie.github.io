// ==================== precache.js ====================
// 离线预缓存：把「因懒加载而尚未被请求」的图片在后台低并发地拉一遍，
// 让 Service Worker 把它们写入图片缓存，做到「没滚到的图也能离线看」。
//
// 设计取舍（重要）：
//  1) 只补懒加载造成的缺口。懒加载目前只用在专题页（special.js），
//     概览 / 搜索 / 分类页的图片本来就全部 eager 加载，浏览时会被浏览器请求、
//     也就会被 SW 顺带缓存，不主动再拉一遍（避免把纸币概览页那 ~600MB 白下载）。
//  2) 单队列 + 按 URL 去重 + 先查 Cache Storage：已缓存 / 已排队的一律跳过，
//     所以跨页面、跨会话重复触发都是幂等的，不会重复下载。
//  3) 并发 3，并在 requestIdleCallback 里启动，给首屏渲染让路。
//  4) 省流量模式（saveData）或 2G/3G 网络下不自动触发，只保留手动按钮。
//  5) 门控：页面未被 Service Worker 接管时不预缓存 —— 请求不会被拦截、
//     也就不会写进缓存，纯属白耗流量（「预缓存全部图片」可达近 780MB）。

const PRECACHE_CONCURRENCY = 3;
const PRECACHE_STORE_PREFIX = 'collection-images';   // 与 sw.js 的 CACHE_NAME 前缀一致
const PRECACHE_AUTO_KEY = 'precache-auto';           // localStorage：'0' 表示关闭自动预缓存
const PRECACHE_CHIP_HIDE_DELAY = 2200;

let precacheQueue = [];
let precacheActive = 0;
let precacheSession = null;      // { total, finished, failed, cancelled }
let precacheChipEl = null;
let precacheChipTimer = null;
const precacheSeen = new Set();  // 本会话已排队 / 已命中的 URL，避免重复处理

// ========== 开关与网络条件 ==========
function precacheAutoEnabled() {
    try { return localStorage.getItem(PRECACHE_AUTO_KEY) !== '0'; } catch (e) { return true; }
}

function setPrecacheAuto(on) {
    try { localStorage.setItem(PRECACHE_AUTO_KEY, on ? '1' : '0'); } catch (e) {}
    if (!on) precacheCancel();
}

function precacheNetworkOk() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return true;
    if (c.saveData) return false;
    const t = c.effectiveType || '';
    return !(t === 'slow-2g' || t === '2g' || t === '3g');
}

// ========== 缓存访问（只读，不创建；创建交给 sw.js） ==========
async function getPrecacheCache() {
    if (typeof caches === 'undefined' || !caches) return null;
    try {
        const keys = await caches.keys();
        const name = keys.filter(k => k.indexOf(PRECACHE_STORE_PREFIX) === 0)[0];
        return name ? await caches.open(name) : null;
    } catch (e) {
        return null;
    }
}

async function precacheCountCached() {
    const cache = await getPrecacheCache();
    if (!cache) return 0;
    try {
        const keys = await cache.keys();
        return keys.length;
    } catch (e) {
        return 0;
    }
}

// ========== 进度指示器 ==========
function precacheEnsureChip() {
    if (precacheChipEl) return precacheChipEl;
    if (typeof document === 'undefined' || !document.body) return null;
    const el = document.createElement('div');
    el.className = 'precache-chip';
    el.innerHTML = '<span class="precache-chip-text"></span><span class="precache-chip-cancel" title="停止预缓存">×</span>';
    el._text = el.querySelector('.precache-chip-text');
    el._cancel = el.querySelector('.precache-chip-cancel');
    if (el._cancel) {
        el._cancel.onclick = function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            precacheCancel();
        };
    }
    document.body.appendChild(el);
    precacheChipEl = el;
    return el;
}

function precacheShowChip(text) {
    const el = precacheEnsureChip();
    if (!el) return;
    if (precacheChipTimer) { clearTimeout(precacheChipTimer); precacheChipTimer = null; }
    if (el._text) el._text.textContent = text;
    if (el.classList) el.classList.add('show');
    else el.className = 'precache-chip show';
}

function precacheHideChipSoon() {
    if (precacheChipTimer) clearTimeout(precacheChipTimer);
    precacheChipTimer = setTimeout(function () {
        precacheChipTimer = null;
        const el = precacheChipEl;
        if (!el) return;
        if (el.classList) el.classList.remove('show');
        else el.className = 'precache-chip';
    }, PRECACHE_CHIP_HIDE_DELAY);
}

function precacheUpdateChip() {
    const s = precacheSession;
    if (!s) return;
    const pct = s.total > 0 ? Math.round(s.finished / s.total * 100) : 0;
    precacheShowChip('离线预缓存 ' + s.finished + '/' + s.total + '（' + pct + '%）');
}

// 「我的」页面上的状态文字
function precacheRefreshStatus() {
    const el = document.getElementById ? document.getElementById('precacheStatus') : null;
    if (!el) return;
    precacheCountCached().then(function (n) {
        if (!el.isConnected) return;
        const queued = precacheQueue.length + precacheActive;
        let text = n > 0 ? '本地已缓存 ' + n + ' 张图片' : '本地还没有缓存的图片';
        if (queued > 0) text += '（正在预缓存 ' + queued + ' 张）';
        el.textContent = text;
    });
}

// ========== 加载单张（no-cors 的 <img>，交给 SW 去缓存） ==========
function precacheLoad(url) {
    return new Promise(function (resolve) {
        const img = new Image();
        let settled = false;
        const finish = function (ok) {
            if (settled) return;
            settled = true;
            img.onload = null;
            img.onerror = null;
            resolve(ok);
        };
        img.onload = function () { finish(true); };
        img.onerror = function () { finish(false); };
        img.src = url;
    });
}

// ========== 队列调度 ==========
function precachePump() {
    while (precacheActive < PRECACHE_CONCURRENCY && precacheQueue.length > 0) {
        const url = precacheQueue.shift();
        precacheActive++;
        precacheLoad(url).then(function (ok) {
            precacheActive--;
            precacheUpdateChip();
            if (precacheSession) {
                precacheSession.finished++;
                if (!ok) precacheSession.failed++;
            }
            // 失败的从 seen 里移除，下次触发可以重试
            if (!ok) precacheSeen.delete(url);
            precachePump();
            precacheMaybeFinish();
        });
    }
    precacheMaybeFinish();
}

function precacheMaybeFinish() {
    if (!precacheSession) return;
    if (precacheQueue.length > 0 || precacheActive > 0) return;

    const s = precacheSession;
    precacheSession = null;

    let text;
    if (s.cancelled) {
        text = '已停止预缓存';
    } else if (s.total === 0) {
        text = '图片已全部在本地缓存';
    } else if (s.failed > 0) {
        text = '预缓存完成 ' + (s.finished - s.failed) + ' 张，' + s.failed + ' 张失败';
    } else {
        text = '已预缓存 ' + s.finished + ' 张图片';
    }
    precacheShowChip(text);
    precacheHideChipSoon();
    precacheRefreshStatus();
}

// ========== 入队（去重 + 跳过已缓存） ==========
// ★ 门控：预缓存依赖 Service Worker 拦截请求并写入缓存。
//   若页面没有被 SW 接管，这些请求只会白白消耗流量而不会被缓存，
//   （「预缓存全部图片」尤其致命：近 780MB 全白下），因此先等 SW 就绪。
async function precacheEnsureController() {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return false;
    const sw = navigator.serviceWorker;
    if (sw.controller) return true;
    try {
        // ready 在注册失败时会一直 pending，因此加超时兜底
        await Promise.race([
            sw.ready || Promise.resolve(),
            new Promise(function (r) { setTimeout(r, 3000); }),
        ]);
    } catch (e) {
        return false;
    }
    // activate 里调用了 clients.claim()，controller 会稍后落到当前页
    for (let i = 0; i < 10 && !sw.controller; i++) {
        await new Promise(function (r) { setTimeout(r, 200); });
    }
    return !!sw.controller;
}

async function precacheEnqueue(urls, opts) {
    opts = opts || {};

    const hasController = await precacheEnsureController();
    if (!hasController) {
        if (opts.verbose) {
            precacheShowChip('图片缓存不可用（需要 https 且 Service Worker 已就绪）');
            precacheHideChipSoon();
        }
        return 0;
    }

    const cache = await getPrecacheCache();
    const fresh = [];
    for (const url of urls) {
        if (!url || precacheSeen.has(url)) continue;
        precacheSeen.add(url);
        if (cache) {
            let hit = null;
            try { hit = await cache.match(url); } catch (e) {}
            if (hit) continue;
        }
        fresh.push(url);
    }

    if (fresh.length === 0) {
        if (opts.verbose) {
            precacheShowChip('图片已全部在本地缓存');
            precacheHideChipSoon();
        }
        return 0;
    }

    if (!precacheSession) precacheSession = { total: 0, finished: 0, failed: 0, cancelled: false };
    precacheSession.total += fresh.length;
    for (const u of fresh) precacheQueue.push(u);
    precacheUpdateChip();
    precachePump();
    return fresh.length;
}

function precacheCancel() {
    precacheQueue = [];
    if (precacheSession) precacheSession.cancelled = true;
    if (precacheActive === 0) precacheMaybeFinish();
    else precacheShowChip('正在停止…');
}

// ========== 收集图片 URL ==========
// ★ 判断是否为「本站藏品图片」。刻意**不写死域名** —— 图片托管已经换过一次
//   （jsDelivr → GitHub Pages 同源），写死域名会让整套过滤条件静默失效。
const PRECACHE_IMAGE_RE = /^https?:\/\/[^/]+\/(?:(?:notecollection|coincollection)\/(?:readmes\/)?image\/|funcollection\/[^/]+\/images\/)[^"'\s>)]+\.(?:jpg|jpeg|png|gif|webp|avif|bmp|ico)$/i;

function isPrecacheableImage(u) {
    return !!u && PRECACHE_IMAGE_RE.test(u);
}

// 当前视图容器里已渲染的图片（懒加载的 <img> 也有 src，只是没被请求）
function precacheCollectFromCurrentView() {
    if (typeof getContainerKey !== 'function' || typeof viewScrollContainers === 'undefined') return [];
    const key = getContainerKey();
    const container = viewScrollContainers[key];
    if (!container || !container.querySelectorAll) return [];
    const urls = new Set();
    container.querySelectorAll('img[src]').forEach(function (img) {
        const src = img.getAttribute('src') || '';
        if (!isPrecacheableImage(src)) return;
        urls.add(src);
    });
    return [...urls];
}

// 数据里引用的图片。scope:
//   'thumbs'  —— 只缩略图（约 14MB；离线时网格完整可看，灯箱显示低清占位）
//   'special' —— 专题相关（缩略图 + 原图）
//   'all'     —— 全部（缩略图 + 原图 + 已加载文章的配图，约 775MB）
function precacheCollectUrls(scope) {
    const urls = new Set();
    const withOriginals = (scope === 'all' || scope === 'special');
    const add = function (v) {
        if (!v) return;
        // ★ 网格里实际显示的是缩略图，优先缓存它
        if (typeof getThumbUrl === 'function') {
            const t = getThumbUrl(v);
            if (t && t.indexOf('/thumb/') !== -1 && isPrecacheableImage(t)) urls.add(t);
        }
        if (!withOriginals) return;
        const u = (typeof getImageUrl === 'function') ? getImageUrl(v) : v;
        if (isPrecacheableImage(u)) urls.add(u);
    };
    const walkMap = function (map) {
        if (!map) return;
        for (const key of Object.keys(map)) {
            const data = map[key];
            if (!data) continue;
            if (Array.isArray(data)) {
                data.forEach(function (it) { if (it) add(it.yearImg || it.img); });
                continue;
            }
            if (Array.isArray(data.items)) {
                data.items.forEach(function (it) { if (it) add(it.yearImg || it.img); });
            }
            if (Array.isArray(data.series)) {
                for (const s of data.series) {
                    if (Array.isArray(s.varieties)) {
                        for (const v of s.varieties) {
                            if (Array.isArray(v.copies)) {
                                v.copies.forEach(function (c) { add(c.img1); add(c.img2); });
                            }
                        }
                    } else if (Array.isArray(s.copies)) {
                        s.copies.forEach(function (c) { add(c.img1); add(c.img2); });
                    }
                }
            }
        }
    };

    // 覆盖范围：'special' 只关心趣味专题（懒加载的那批）；
    // 'thumbs' / 'all' 覆盖纸币 + 硬币 + 专题全部数据
    if (scope !== 'special') {
        walkMap(window.DATA_MAP);
        walkMap(window.COIN_DATA_MAP);
    }
    walkMap(window.FUN_DATA_MAP);

    // 文章正文里的图片（只覆盖已加载过的文章）
    if (scope === 'all' &&
        typeof articleContentCache === 'object' && articleContentCache &&
        typeof getArticleBasePath === 'function') {
        const sourceByPath = {};
        if (Array.isArray(collectedArticles)) {
            collectedArticles.forEach(function (a) { sourceByPath[a.contentPath] = a.sourceType; });
        }
        for (const path of Object.keys(articleContentCache)) {
            const html = articleContentCache[path] || '';
            const base = getArticleBasePath(sourceByPath[path]);
            const reRel = /src\s*=\s*["']?(readmes\/image\/[^"'\s>)]+)/gi;
            const reAbs = /src\s*=\s*["'](https?:\/\/[^"'\s>)]+)/gi;
            let m;
            while ((m = reRel.exec(html)) !== null) urls.add(base + m[1]);
            while ((m = reAbs.exec(html)) !== null) { if (isPrecacheableImage(m[1])) urls.add(m[1]); }
        }
    }

    return [...urls];
}

// ========== 对外入口 ==========
// 由懒加载渲染点在渲染完成后调用（自动模式）
function schedulePrecacheCurrentView() {
    if (!precacheAutoEnabled()) return;
    if (!precacheNetworkOk()) return;
    const run = function () { precacheEnqueue(precacheCollectFromCurrentView(), {}); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 1200);
}

// ========== 「我的」页面交互 ==========
function togglePrecacheAuto() {
    setPrecacheAuto(!precacheAutoEnabled());
    if (typeof setSwitchState === 'function') setSwitchState('precacheAutoSwitch', precacheAutoEnabled());
    precacheRefreshStatus();
}

// 只缓存缩略图（约 14MB）：离线时网格完整可看，灯箱显示低清占位
function runPrecacheThumbs() {
    precacheEnqueue(precacheCollectUrls('thumbs'), { verbose: true });
}

let precacheAllConfirm = false;
let precacheAllTimer = null;

function runPrecacheAll() {
    const label = document.getElementById ? document.getElementById('precacheAllText') : null;

    if (!precacheAllConfirm) {
        const urls = precacheCollectUrls('all');
        if (urls.length === 0) {
            precacheShowChip('没有找到可预缓存的图片');
            precacheHideChipSoon();
            return;
        }
        precacheAllConfirm = true;
        // 缩略图约 18KB、原图约 0.96MB，分开估算才不会把总体积报成两倍
        let thumbCount = 0;
        for (const u of urls) { if (u.indexOf('/thumb/') !== -1) thumbCount++; }
        const mb = Math.round(thumbCount * 0.018 + (urls.length - thumbCount) * 0.96);
        if (label) label.textContent = '共 ' + urls.length + ' 个文件 · 约 ' + mb + 'MB，确定？';
        precacheAllTimer = setTimeout(function () {
            precacheAllConfirm = false;
            if (label) label.textContent = '预缓存全部（含原图）';
        }, 4000);
        return;
    }

    clearTimeout(precacheAllTimer);
    precacheAllConfirm = false;
    if (label) label.textContent = '预缓存全部图片';
    precacheEnqueue(precacheCollectUrls('all'), { verbose: true });
}
