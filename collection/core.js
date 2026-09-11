// ==================== core.js ====================
// 常量定义
const MODE = { NOTES: 'notes', COINS: 'coins', SPECIAL: 'special', ARTICLES: 'articles', SETTINGS: 'settings' };
const VIEW = { OVERVIEW: 'overview', CATEGORY: 'category', SEARCH: 'search', LIST: 'list', READER: 'reader' };
const SEARCH_TYPE = { ALL: 'all', NAME: 'name', VERSION: 'version', YEAR: 'year', AGENCY: 'agency', KRAUSE: 'krause' };
const SEARCH_MODE = { CLICK: 'click', REALTIME: 'realtime' };
const KRAUSE_PREFIX = 'Pick# ';

// ========== 目录编号格式化（统一规则） ==========
function formatCatalogNumber(num) {
    if (!num) return '';
    const s = String(num).trim();
    if (/unlisted/i.test(s)) return '';
    if (s.includes('#') || /^sun[-#]/i.test(s)) return s;
    return 'Pick# ' + s;
}

// ========== 图片路径处理 ==========
// ★ 图片已不再走 jsDelivr。本仓库体积远超 jsDelivr 的 50MB 包上限：
//   data.jsdelivr.com 对 @main 返回 403 "Package size exceeded the configured limit of 50 MB"，
//   于是 jsDelivr 把所有请求 302 到 raw.githubusercontent.com（非 CDN、严格限流、国内很慢）。
//   现改为与站点同源的 GitHub Pages 直出 —— 图片本就在仓库里、也早已被 Pages 发布。
//   数据文件里存的是完整站点 URL（https://tong-xiangjie.github.io/...），
//   所以 getImageUrl 通常原样返回；下面的相对路径分支仅作兼容。
const SITE_BASE = 'https://tong-xiangjie.github.io/';
const IMAGE_BASE = SITE_BASE + 'notecollection/image/';

function getImageUrl(path, subDir = 'comm') {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }
    if (path.startsWith('/')) {
        return path;                       // 根绝对路径：同源直出
    }
    let relative = path;
    if (relative.startsWith('image/')) {
        relative = relative.substring(6);
    }
    if (relative.includes('/')) {
        return IMAGE_BASE + relative;
    }
    return IMAGE_BASE + subDir + '/' + relative;
}

// ========== 缩略图路径处理 ==========
// 缩略图与原图同构，放在图片根目录的 thumb/ 子目录下，且统一为 .jpg：
//   原图   <图片根目录>/<相对路径>.<ext>
//   缩略图 <图片根目录>/thumb/<相对路径>.jpg
// 由 tools/make-thumbs.ps1 生成（宽度 320px / JPEG q80，实测约 13KB/张）。
// 映射不上的一律回退原图，因此漏生成只会多耗流量，不会导致图片显示不出来。
const IMAGE_ROOT_RE = /^(?:https?:\/\/tong-xiangjie\.github\.io)?\/(notecollection\/image|coincollection\/image|funcollection\/[^/]+\/images)\/(.+)$/i;

function getThumbUrl(path, subDir = 'comm') {
    const full = getImageUrl(path, subDir);
    if (!full) return '';
    const m = full.match(IMAGE_ROOT_RE);
    if (!m) return full;                       // 未知目录 / 外部 URL → 回退原图
    const rel = m[2];
    if (/\.svg$/i.test(rel)) return full;      // 矢量图不做缩略图
    const slash = rel.lastIndexOf('/');
    const dir = slash >= 0 ? rel.substring(0, slash + 1) : '';
    const name = slash >= 0 ? rel.substring(slash + 1) : rel;
    const stem = name.replace(/\.[^./]+$/, '');
    return SITE_BASE + m[1] + '/thumb/' + dir + stem + '.jpg';
}

// 缩略图加载失败时回退原图：返回可直接拼进 <img ...> 的 onerror 属性片段
function thumbFallbackAttr(originalUrl) {
    if (!originalUrl) return '';
    const safe = String(originalUrl)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '%22')
        .replace(/'/g, '%27');
    return ` onerror="this.onerror=null;this.src='${safe}'"`;
}
// =========================================================

// ========== 动效偏好 ==========
// 尊重系统的"减少动态效果"设置：动画与平滑滚动都应能关闭。
function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 平滑滚动（reduced-motion 时改为瞬时跳转）
function scrollIntoViewSmooth(el, block) {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: block || 'center'
    });
}

// 精确高度的手风琴展开 / 收起。
// 为什么不用 CSS 里写死的 max-height：浏览器按时间线性插值 max-height，而元素实际
// 可视高度 = min(内容高度, 插值)。于是短面板几十毫秒就展完、剩下的时间全在空跑
// （观感是"啪一下弹开然后静止"），长面板则"冲得飞快然后戛然而止"。
// 这里先量出内容真实高度再过渡，动画速度就与内容长度无关；过渡结束后把高度限制
// 解除为 none，这样图片后加载导致的内容增长不会被裁掉。
function animateAccordion(el, open) {
    if (!el) return;
    clearTimeout(el._accTimer);
    const reduced = prefersReducedMotion();
    if (open) {
        el.style.maxHeight = el.scrollHeight + 'px';
        el.classList.add('open');
        if (reduced) { el.style.maxHeight = 'none'; return; }
        el._accTimer = setTimeout(function() {
            if (el.classList.contains('open')) el.style.maxHeight = 'none';
        }, 280);
    } else {
        el.style.maxHeight = el.scrollHeight + 'px';
        void el.offsetHeight;          // 先把当前高度固定下来，作为过渡起点
        el.classList.remove('open');
        el.style.maxHeight = '';       // 交回 CSS 的 max-height: 0
    }
}

// ========== 全局状态 ==========
let currentMode = MODE.NOTES;
let currentTab = MODE.NOTES;
let currentCategoryId = null;
let currentSubId = null;
let currentView = VIEW.OVERVIEW;
let currentSearchKeyword = '';
let currentSearchType = SEARCH_TYPE.ALL;
let scrollMemory = {};
let isSettingsMode = false;
let settingsReturnState = null;
let isSidebarCollapsed = false;
let settingsPageCache = null;
let isArticlePreloading = false;

let selectedSpecial = null;
let specialPageCaches = {};
let specialCategoryTree = null;

let ratingMode = MODE.NOTES;

let modeStates = {
    notes: {
        currentCategoryId: null, currentSubId: null, currentView: VIEW.OVERVIEW,
        currentSearchKeyword: '', currentSearchType: SEARCH_TYPE.ALL,
        searchMode: SEARCH_MODE.REALTIME, isSidebarCollapsed: false,
        expandedSeries: [], expandedVarieties: [],
        overviewScrollY: 0, categoryScrollY: 0, searchScrollY: 0
    },
    coins: {
        currentCategoryId: null, currentSubId: null, currentView: VIEW.OVERVIEW,
        currentSearchKeyword: '', currentSearchType: SEARCH_TYPE.ALL,
        searchMode: SEARCH_MODE.REALTIME, isSidebarCollapsed: false,
        expandedSeries: [], expandedVarieties: [],
        overviewScrollY: 0, categoryScrollY: 0, searchScrollY: 0
    }
};

let articleState = {
    currentView: VIEW.LIST,
    currentCategory: 'all',
    currentIndex: -1,
    searchKeyword: '',
    listScrollY: 0,
    readerScrollY: 0
};

// ========== 图片弹窗状态 ==========
let hammerManager = null;
let currentScale = 1, currentX = 0, currentY = 0;
let currentModalImg1 = '', currentModalImg2 = '';

// ========== 文章状态 ==========
let currentArticleView = VIEW.LIST;
let currentArticleCategory = 'all';
let currentArticleIndex = -1;
let collectedArticles = [];
let articleContentCache = {};
let articlePlainTextCache = {};
let articleSearchKeyword = '';
let articleSearchMode = 'title';
let articleCategoryTree = [];

// ========== 独立滚动容器系统 ==========
const viewScrollContainers = {};

function ensureViewContainer(key) {
    if (!viewScrollContainers[key]) {
        const div = document.createElement('div');
        div.className = 'view-scroll-container';
        div.id = 'view-' + key.replace(/[^a-zA-Z0-9_\-]/g, '_');
        div.style.cssText = 'height:100%;overflow-y:auto;display:none;';
        const content = document.querySelector('.content');
        if (!content) {
            console.error('Content element not found');
            return null;
        }
        content.insertBefore(div, document.getElementById('app'));
        viewScrollContainers[key] = div;
    }
    return viewScrollContainers[key];
}

// ★ 所有模式都使用独立容器，#app 不再用于渲染
function isFullPageMode(key) {
    return false;
}

function getContainerKey() {
    // ★ 优先判断：如果正在设置页，直接返回设置容器 key
    if (isSettingsMode) {
        return 'settings_container';
    }

    if (currentMode === MODE.ARTICLES) {
        if (currentArticleView === VIEW.READER && currentArticleIndex >= 0) {
            return 'articles_reader_' + currentArticleIndex;
        }
        return 'articles_list';
    }
    if (currentMode === MODE.SPECIAL) {
        return 'special_container';
    }
    if (currentMode === MODE.NOTES) {
        if (currentView === VIEW.SEARCH) return 'notes_search';
        if (currentView === VIEW.CATEGORY) return 'notes_category_' + String(currentSubId || currentCategoryId || 'overview').replace(/[^a-zA-Z0-9_\-]/g, '_');
        return 'notes_overview';
    }
    if (currentMode === MODE.COINS) {
        if (currentView === VIEW.SEARCH) return 'coins_search';
        if (currentView === VIEW.CATEGORY) return 'coins_category_' + String(currentCategoryId || 'overview').replace(/[^a-zA-Z0-9_\-]/g, '_');
        return 'coins_overview';
    }
    return 'default';
}

function switchToCurrentContainer() {
    const key = getContainerKey();
    switchViewContainer(key);
}

function switchViewContainer(key) {
    // 1. 隐藏所有容器
    for (const k of Object.keys(viewScrollContainers)) {
        viewScrollContainers[k].style.display = 'none';
    }
    // 2. 隐藏 #app
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    // 3. 获取或创建目标容器
    const container = ensureViewContainer(key);
    if (!container) return;

    // ★ 不要清空内容，不要重置滚动，由各渲染函数自行处理
    container.style.display = 'block';
}

function getRenderContainer() {
    const key = getContainerKey();
    return ensureViewContainer(key);
}

function triggerViewAnimation() {
    const key = getContainerKey();
    const el = viewScrollContainers[key];
    if (!el) return;

    // ★ 强制重置动画：先移除动画，强制回流，再恢复
    el.style.animation = 'none';
    void el.offsetHeight;          // 强制回流
    el.style.animation = '';

    // ★ 正常触发 content-enter 类动画
    el.classList.remove('content-enter');
    void el.offsetHeight;          // 再次强制回流，确保类移除生效
    el.classList.add('content-enter');
}

// ========== 数据读取函数 ==========
function getSpecialConfigs() { return window.SPECIAL_CONFIGS || []; }

function buildSpecialCategoryTree() {
    specialCategoryTree = [];
    for (const config of getSpecialConfigs()) {
        const children = [];
        if (config.categories) {
            for (const cat of config.categories) {
                children.push({ id: cat.id, name: cat.name, dataKey: config.id });
            }
        }
        specialCategoryTree.push({
            id: config.id, name: config.name, dataKey: config.id,
            children: children.length > 0 ? children : null
        });
    }
}

function getCategoryTree() {
    if (currentMode === MODE.SPECIAL) return specialCategoryTree;
    return currentMode === MODE.NOTES ? categoryTree : coinCategoryTree;
}

function getImageBase() {
    return '';
}

function getAllDataKeys() {
    return currentMode === MODE.NOTES ? allDataKeys : coinAllDataKeys;
}

function getData(dataKey) {
    if (currentMode === MODE.NOTES) {
        return window.DATA_MAP && window.DATA_MAP[dataKey] ? window.DATA_MAP[dataKey] : null;
    } else if (currentMode === MODE.COINS) {
        return window.COIN_DATA_MAP && window.COIN_DATA_MAP[dataKey] ? window.COIN_DATA_MAP[dataKey] : null;
    } else if (currentMode === MODE.SPECIAL) {
        return window.FUN_DATA_MAP && window.FUN_DATA_MAP[dataKey] ? window.FUN_DATA_MAP[dataKey] : null;
    }
    return null;
}

function getSubCategoryMap() {
    return currentMode === MODE.NOTES ? subCategoryMap : {};
}

function getEffectiveSearchMode() {
    if (currentMode === MODE.ARTICLES) return SEARCH_MODE.REALTIME;
    if (currentMode === MODE.NOTES || currentMode === MODE.COINS) {
        const st = modeStates[currentMode];
        return (st && st.searchMode) || SEARCH_MODE.REALTIME;
    }
    return SEARCH_MODE.REALTIME;
}

// ========== 工具函数 ==========
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function saveScroll(key) {
    const content = document.querySelector('.content');
    if (content) scrollMemory[currentMode + '-' + key] = content.scrollTop;
}

function restoreScroll(key) {
    const sk = currentMode + '-' + key;
    if (scrollMemory[sk] !== undefined) {
        requestAnimationFrame(() => {
            const content = document.querySelector('.content');
            if (content) content.scrollTop = scrollMemory[sk];
        });
    }
}

function collectExpandedStates() {
    const expandedSeries = [];
    const expandedVarieties = [];
    document.querySelectorAll('.series-body.open').forEach(el => {
        const id = el.id;
        if (id && id.startsWith('body-series-')) {
            expandedSeries.push(id.replace('body-', ''));
        }
    });
    document.querySelectorAll('.copy-list.open').forEach(el => {
        const id = el.id;
        if (id && (id.startsWith('list-v-') || id.startsWith('list-s-'))) {
            expandedVarieties.push(id.replace('list-', ''));
        }
    });
    return { expandedSeries, expandedVarieties };
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (!sidebar || !toggle) return;
    isSidebarCollapsed = !isSidebarCollapsed;
    sidebar.classList.toggle('collapsed', isSidebarCollapsed);
    toggle.textContent = '☰';
    toggle.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
    if (modeStates.notes) modeStates.notes.isSidebarCollapsed = isSidebarCollapsed;
    if (modeStates.coins) modeStates.coins.isSidebarCollapsed = isSidebarCollapsed;

    if (typeof fitSidebarLabelsDelayed === 'function') {
        fitSidebarLabelsDelayed();
    }
}

function scrollToTop() {
    const content = document.querySelector('.content');
    if (content) content.scrollTop = 0;
}

function getDataBySource(dataKey, source) {
    if (source === 'coins') {
        return window.COIN_DATA_MAP && window.COIN_DATA_MAP[dataKey] ? window.COIN_DATA_MAP[dataKey] : null;
    }
    return window.DATA_MAP && window.DATA_MAP[dataKey] ? window.DATA_MAP[dataKey] : null;
}

// ========== 状态保存与恢复 ==========
function saveFullState() {
    const key = getContainerKey();
    const container = viewScrollContainers[key];
    const scrollY = container ? container.scrollTop : 0;

    // ★ 优先保存设置页状态（如果正处于设置模式）
    if (isSettingsMode) {
        const container = viewScrollContainers['settings_container'];
        settingsPageCache = {
            scrollY: container ? container.scrollTop || 0 : 0
        };
        // 设置页不保存其他状态，直接返回
        return;
    }

    if ((currentMode === MODE.NOTES || currentMode === MODE.COINS) && !isSettingsMode) {
        const expanded = collectExpandedStates();
        const prev = modeStates[currentMode] || {};
        modeStates[currentMode] = {
            currentCategoryId, currentSubId, currentView,
            currentSearchKeyword: currentSearchKeyword || '',
            currentSearchType: currentSearchType || SEARCH_TYPE.ALL,
            searchMode: modeStates[currentMode] ? modeStates[currentMode].searchMode : SEARCH_MODE.REALTIME,
            isSidebarCollapsed: isSidebarCollapsed,
            expandedSeries: expanded.expandedSeries,
            expandedVarieties: expanded.expandedVarieties,
            overviewScrollY: currentView === VIEW.OVERVIEW ? scrollY : (prev.overviewScrollY || 0),
            categoryScrollY: currentView === VIEW.CATEGORY ? scrollY : (prev.categoryScrollY || 0),
            searchScrollY: currentView === VIEW.SEARCH ? scrollY : (prev.searchScrollY || 0)
        };
        scrollMemory[currentMode + '-' + key] = scrollY;
    } else if (currentMode === MODE.ARTICLES && !isSettingsMode) {
        const prev = articleState;
        articleState = {
            currentView: currentArticleView,
            currentCategory: currentArticleCategory,
            currentIndex: currentArticleIndex,
            searchKeyword: articleSearchKeyword,
            listScrollY: currentArticleView === VIEW.LIST ? scrollY : (prev.listScrollY || 0),
            readerScrollY: currentArticleView === VIEW.READER ? scrollY : (prev.readerScrollY || 0)
        };
        scrollMemory['articles-' + key] = scrollY;
    } else if (currentMode === MODE.SPECIAL && !isSettingsMode) {
        if (selectedSpecial !== null && selectedSpecial !== undefined) {
            const cfg = getSpecialConfigs().find(c => c.id === selectedSpecial);
            if (cfg && cfg.view === 'map') {
                specialPageCaches[selectedSpecial] = { currentSubId };
            } else {
                specialPageCaches[selectedSpecial] = {
                    scrollY: container ? container.scrollTop || 0 : 0,
                    currentSubId: currentSubId
                };
            }
        } else {
            // 保存概览滚动
            specialPageCaches['__overview__'] = {
                scrollY: scrollY
            };
        }
    }
}

function restoreSidebarState() {
    if (currentMode === MODE.NOTES || currentMode === MODE.COINS) {
        const saved = modeStates[currentMode];
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebarToggle');
        if (!sidebar || !toggle) return;
        const collapsed = saved ? saved.isSidebarCollapsed : false;
        sidebar.classList.toggle('collapsed', collapsed);
        toggle.textContent = '☰';
        toggle.title = collapsed ? '展开侧边栏' : '收起侧边栏';
        isSidebarCollapsed = collapsed;
        if (typeof fitSidebarLabelsDelayed === 'function') {
            fitSidebarLabelsDelayed();
        }
    }
}

function setupModalEvents() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    modal.addEventListener('click', function(e) {
        const t = e.target;
        if (t && (t.id === 'modalImg' || t.classList.contains('modal-close'))) return;
        closeModal();
    });

    // ★ 记录最近被点击的缩略图，供大图"从缩略图位置生长出来"的共享元素动画使用。
    //   用捕获阶段的全局监听（而不是改 15 处内联 onclick），新增图片位时自动生效。
    document.addEventListener('click', function(e) {
        const t = e.target;
        if (t && t.tagName === 'IMG' && !(t.closest && t.closest('#imageModal'))) {
            lastModalSourceImg = t;
        }
    }, true);
}

let lastModalSourceImg = null;

// ============================================================
// ★★★★★★★ 图片加载淡入 ★★★★★★★
// ============================================================
// CSS 让网格图片在未加载完时保持透明（opacity:0），加载完成后加 .img-loaded 淡入，
// 避免"色块 → 图片"的硬切。三重保障确保任何图片都不会加载完了却一直不显示：
//   ① load 事件（含懒加载后到达的图）
//   ② MutationObserver：插入时就已 complete 的图不会触发 load，需主动补标
//   ③ 定时兜底清扫（先做一次极廉价的 querySelector 短路检查）
function markImageLoaded(img) {
    if (img && img.tagName === 'IMG' && !img.classList.contains('img-loaded')) {
        img.classList.add('img-loaded');
    }
}

function sweepLoadedImages() {
    document.querySelectorAll('img:not(.img-loaded)').forEach(function (img) {
        // complete 且 naturalWidth 为 0 表示加载失败；也必须标上，否则会一直隐形
        if (img.complete) img.classList.add('img-loaded');
    });
}

function setupImageFadeIn() {
    document.addEventListener('load', function(e) {
        if (e.target && e.target.tagName === 'IMG') markImageLoaded(e.target);
    }, true);

    try {
        const mo = new MutationObserver(function(muts) {
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (!n || n.nodeType !== 1) continue;
                    if (n.tagName === 'IMG') {
                        if (n.complete) markImageLoaded(n);
                    } else if (n.querySelectorAll) {
                        n.querySelectorAll('img').forEach(function(i) {
                            if (i.complete) markImageLoaded(i);
                        });
                    }
                }
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
        // 环境不支持 MutationObserver 时由定时兜底接管
    }

    // 兜底清扫：只在启动后的一分钟内做有限次数。
    // 之后 load 事件 + MutationObserver 已能覆盖（晚到的懒加载图会触发 load，
    // 插入时就 complete 的图会被 MutationObserver 捕获），无需长期轮询。
    let sweeps = 0;
    const sweepTimer = setInterval(function() {
        if (++sweeps > 30) { clearInterval(sweepTimer); return; }
        sweepLoadedImages();
    }, 2000);
}

// ============================================================
// ★★★★★★★ 图片重试 ★★★★★★★
// ============================================================
let failedImages = new Set();
let retryFab = null;

function setupImageRetry() {
    document.addEventListener('error', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG') {
            failedImages.add(t);
            updateRetryFab();
        }
    }, true);

    document.addEventListener('load', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG') {
            if (failedImages.delete(t)) updateRetryFab();
        }
    }, true);

    retryFab = document.createElement('div');
    retryFab.id = 'imgRetryFab';
    retryFab.className = 'img-retry-fab';
    retryFab.innerHTML = '<span class="fab-icon">⟳</span><span class="fab-count" id="imgRetryCount"></span>';
    retryFab.onclick = () => { retryFailedImages(); };
    document.body.appendChild(retryFab);
    updateRetryFab();
}

function updateRetryFab() {
    if (!retryFab) return;
    const has = failedImages.size > 0;
    if (has) {
        retryFab.classList.add('show');
        const count = failedImages.size;
        const countEl = retryFab.querySelector('.fab-count');
        countEl.textContent = count > 999 ? '999+' : String(count);
        countEl.style.fontSize = count > 999 ? '8px' : (count > 99 ? '9px' : (count > 9 ? '10px' : '12px'));
        retryFab.title = '重新加载未显示的图片（' + count + ' 张）';
    } else {
        retryFab.classList.remove('show');
    }
}

function retryFailedImages() {
    const list = [...failedImages];
    failedImages.clear();
    updateRetryFab();
    for (const img of list) {
        if (!img.isConnected) continue;
        let src = img.getAttribute('src') || img.src;
        if (!src) continue;
        const sep = src.includes('?') ? '&' : '?';
        img.src = src + sep + 'retry=' + Date.now() + Math.random().toString(36).slice(2, 6);
    }
}

// ========== 专题全屏布局 ==========
function applySpecialLayout() {
    const cfg = getSpecialConfigs().find(c => c.id === selectedSpecial);

    if (cfg && typeof syncSpecialGroupChildren === 'function') {
        syncSpecialGroupChildren(cfg);
    }

    const bodyRow = document.querySelector('.body-row');
    const toggleBtn = document.getElementById('sidebarToggle');
    const isMap = !!(cfg && cfg.view === 'map');
    const tree = specialCategoryTree ? specialCategoryTree.find(c => c.id === selectedSpecial) : null;
    const hasSub = !isMap && !!(tree && tree.children && tree.children.length > 0);

    if (isMap || !hasSub) {
        if (bodyRow) {
            bodyRow.classList.add('sidebar-hidden');
            bodyRow.classList.remove('special-overview-mode');
        }
        if (toggleBtn) toggleBtn.style.display = 'none';
    } else {
        if (bodyRow) {
            bodyRow.classList.remove('sidebar-hidden');
            bodyRow.classList.remove('special-overview-mode');
        }
        if (toggleBtn) toggleBtn.style.display = '';
    }
}