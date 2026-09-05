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

// ========== CDN 图片路径处理 ==========
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/';

function getImageUrl(path, subDir = 'comm') {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }
    let relative = path;
    if (relative.startsWith('image/')) {
        relative = relative.substring(6);
    }
    if (relative.includes('/')) {
        return CDN_BASE + relative;
    }
    return CDN_BASE + subDir + '/' + relative;
}
// =========================================================

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
    requestAnimationFrame(() => {
        el.classList.remove('content-enter');
        void el.offsetWidth;
        el.classList.add('content-enter');
    });
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
    retryFab.innerHTML = '<span class="fab-icon">↻</span><span class="fab-count" id="imgRetryCount"></span>';
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