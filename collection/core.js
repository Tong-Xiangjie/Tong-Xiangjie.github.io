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
        content.insertBefore(div, document.getElementById('app'));
        viewScrollContainers[key] = div;
    }
    return viewScrollContainers[key];
}

function isFullPageMode(key) {
    if (key === MODE.SPECIAL || key === MODE.SETTINGS) return true;
    if (key.startsWith('special_') || key === 'settings') return true;
    return false;
}

function getContainerKey() {
    if (currentMode === MODE.ARTICLES) {
        if (currentArticleView === VIEW.READER && currentArticleIndex >= 0) {
            return 'articles_reader_' + currentArticleIndex;
        }
        return 'articles_list';
    }
    if (currentMode === MODE.SPECIAL) return 'special_' + (selectedSpecial || 'overview');
    if (currentMode === MODE.SETTINGS) return 'settings';
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
    for (const k of Object.keys(viewScrollContainers)) {
        viewScrollContainers[k].style.display = 'none';
    }
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    if (isFullPageMode(key)) {
        if (app) app.style.display = 'block';
    } else {
        const container = ensureViewContainer(key);
        container.style.display = 'block';
    }
}

function getRenderContainer() {
    const key = getContainerKey();
    if (isFullPageMode(key)) return document.getElementById('app');
    return ensureViewContainer(key);
}

function triggerViewAnimation() {
    const key = getContainerKey();
    const el = isFullPageMode(key) ? document.getElementById('app') : viewScrollContainers[key];
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
    if (currentMode === MODE.SPECIAL) {
        const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
        return config ? config.imageBase : '';
    }
    return currentMode === MODE.NOTES ? IMAGE_BASE : COIN_IMAGE_BASE;
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

    // ★ 宽度变化后重新做文字比例压缩
    if (typeof fitSidebarLabels === 'function') fitSidebarLabels();
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
    const container = isFullPageMode(key) ? document.getElementById('app') : viewScrollContainers[key];
    const scrollY = container ? container.scrollTop : 0;

    if (currentMode === MODE.NOTES || currentMode === MODE.COINS) {
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
    } else if (currentMode === MODE.ARTICLES) {
        const prev = articleState;
        articleState = {
            currentView: currentArticleView,
            currentCategory: currentArticleCategory,
            currentIndex: currentArticleIndex,
            searchKeyword: articleSearchKeyword,
            listScrollY: currentArticleView === VIEW.LIST ? scrollY : (prev.listScrollY || 0),
            readerScrollY: 0
        };
        scrollMemory['articles-' + key] = scrollY;
    } else if (currentMode === MODE.SPECIAL && !isSettingsMode) {
        const appEl = document.getElementById('app');
        if (selectedSpecial !== null && selectedSpecial !== undefined) {
            specialPageCaches[selectedSpecial] = {
                innerHTML: appEl ? appEl.innerHTML : '', scrollY, currentSubId
            };
        }
    } else if (currentMode === MODE.SETTINGS) {
        const appEl = document.getElementById('app');
        settingsPageCache = { innerHTML: appEl ? appEl.innerHTML : '', scrollY };
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
        // ★ 恢复折叠状态后同步压缩
        if (typeof fitSidebarLabels === 'function') fitSidebarLabels();
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
// ★★★★★★★ 图片重试：收集加载失败的图片，一键重新加载 ★★★★★★★
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

    // 右下角悬浮按钮：⟳ + 右上角数量角标
    retryFab = document.createElement('div');
    retryFab.id = 'imgRetryFab';
    retryFab.className = 'img-retry-fab';
    retryFab.innerHTML = '<span class="fab-icon">⟳</span><span class="fab-count" id="imgRetryCount"></span>';
    retryFab.onclick = () => { retryFailedImages(); };   // 不再弹窗
    document.body.appendChild(retryFab);
    updateRetryFab();
}

function updateRetryFab() {
    if (!retryFab) return;
    const has = failedImages.size > 0;
    retryFab.style.display = has ? 'flex' : 'none';
    if (has) {
        const count = failedImages.size;
        const countEl = retryFab.querySelector('.fab-count');
        // ★ 压缩：超 999 显示 999+；字号随位数自适应
        countEl.textContent = count > 999 ? '999+' : String(count);
        countEl.style.fontSize = count > 999 ? '8px' : (count > 99 ? '9px' : (count > 9 ? '10px' : '12px'));
        retryFab.title = '重新加载未显示的图片（' + count + ' 张）';
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
// ★★★★★★★ 图片重试功能结束 ★★★★★★★
