// ==================== core.js ====================
// 常量定义
const MODE = { NOTES: 'notes', COINS: 'coins', SPECIAL: 'special', ARTICLES: 'articles', SETTINGS: 'settings' };
const VIEW = { OVERVIEW: 'overview', CATEGORY: 'category', SEARCH: 'search', LIST: 'list', READER: 'reader' };
const SEARCH_TYPE = { ALL: 'all', NAME: 'name', VERSION: 'version', YEAR: 'year', AGENCY: 'agency', KRAUSE: 'krause' };
const SEARCH_MODE = { CLICK: 'click', REALTIME: 'realtime' };
const KRAUSE_PREFIX = 'Pick# ';

// ========== 目录编号格式化（统一规则） ==========
// 规则：值中已含 '#'（如 KM# 555、Pick# 123、SUN# 456）→ 原样返回；
//       不含 '#' 的纯编号（如 888）→ 默认补 'Pick# ' 前缀。
//       若包含 'Unlisted'（不区分大小写）→ 返回空字符串（不显示）
function formatCatalogNumber(num) {
    if (!num) return '';
    const s = String(num).trim();
    // Unlisted / Pick# Unlisted 等 → 不显示编号（搜索仍按原始值命中）
    if (/unlisted/i.test(s)) return '';
    // 已带前缀（Pick# / KM# / SUN# / Sun- 等）→ 原样返回
    if (s.includes('#') || /^sun[-#]/i.test(s)) return s;
    // 纯编号 → 默认补 Pick#
    return 'Pick# ' + s;
}

// ========== CDN 图片路径处理（智能识别子目录） ==========
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/';

function getImageUrl(path, subDir = 'comm') {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }

    let relative = path;
    // 如果以 'image/' 开头，去掉这个前缀
    if (relative.startsWith('image/')) {
        relative = relative.substring(6);
    }

    // 如果 relative 包含 '/'，说明有子目录，直接拼接
    if (relative.includes('/')) {
        return CDN_BASE + relative;
    }

    // 纯文件名，使用传入的 subDir（默认 'comm'）
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

// 专题状态
let selectedSpecial = null;
let specialPageCaches = {};
let specialCategoryTree = null;

// 评级切换状态
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

// ========== 文章状态（article.js 共享） ==========
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

/** 确保容器存在，返回它 */
function ensureViewContainer(key) {
    if (!viewScrollContainers[key]) {
        const div = document.createElement('div');
        div.className = 'view-scroll-container';
        div.id = 'view-' + key.replace(/[^a-zA-Z0-9_\-]/g, '_');
        div.style.cssText = 'height:100%;overflow-y:auto;display:none;';
        const content = document.querySelector('.content');
        const app = document.getElementById('app');
        content.insertBefore(div, app);
        viewScrollContainers[key] = div;
    }
    return viewScrollContainers[key];
}

/**
 * 判断是否使用 #app 的全页模式
 * 只有专题和设置使用 #app，文章（列表/阅读器）和纸币/硬币都使用独立容器
 */
function isFullPageMode(key) {
    if (key === MODE.SPECIAL || key === MODE.SETTINGS) return true;
    if (key.startsWith('special_') || key === 'settings') return true;
    return false;
}

/** 根据当前状态获取正确的容器键名 */
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

/** 切换显示到当前状态的容器 */
function switchToCurrentContainer() {
    const key = getContainerKey();
    switchViewContainer(key);
}

/** 切换显示的容器（隐藏所有其他容器，显示目标） */
function switchViewContainer(key) {
    // 隐藏所有滚动容器
    for (const k of Object.keys(viewScrollContainers)) {
        viewScrollContainers[k].style.display = 'none';
    }
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    if (isFullPageMode(key)) {
        // 专题和设置使用 #app
        if (app) app.style.display = 'block';
    } else {
        // 纸币、硬币、文章都使用独立滚动容器
        const container = ensureViewContainer(key);
        container.style.display = 'block';
    }
}

/** 获取当前状态的渲染目标容器 */
function getRenderContainer() {
    const key = getContainerKey();
    if (isFullPageMode(key)) return document.getElementById('app');
    return ensureViewContainer(key);
}

/** 触发入场动画 */
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
        // 也同步保存到 scrollMemory，兼容旧代码
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
        // ★ 设置模式下不覆盖专题缓存（避免专题缓存被设置页覆盖）
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
    }
}

function setupModalEvents() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    modal.addEventListener('click', function(e) {
        const t = e.target;
        // 点击图片本身或关闭按钮 → 不关闭；其余任意空白/留白/提示区 → 关闭
        if (t && (t.id === 'modalImg' || t.classList.contains('modal-close'))) return;
        closeModal();
    });
}
