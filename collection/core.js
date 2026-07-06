// ==================== core.js ====================
// 常量定义
const MODE = { NOTES: 'notes', COINS: 'coins', SPECIAL: 'special', ARTICLES: 'articles', SETTINGS: 'settings' };
const VIEW = { OVERVIEW: 'overview', CATEGORY: 'category', SEARCH: 'search', LIST: 'list', READER: 'reader' };
const SEARCH_TYPE = { ALL: 'all', NAME: 'name', VERSION: 'version', YEAR: 'year', AGENCY: 'agency', KRAUSE: 'krause' };
const SEARCH_MODE = { CLICK: 'click', REALTIME: 'realtime' };
const KRAUSE_PREFIX = 'Pick# ';

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
    currentView: VIEW.LIST, currentCategory: 'all', currentIndex: -1,
    searchKeyword: '', listScrollY: 0, readerScrollY: 0
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

function ensureViewContainer(key) {
    if (!viewScrollContainers[key]) {
        const div = document.createElement('div');
        div.className = 'view-scroll-container';
        div.id = 'view-' + key;
        div.style.cssText = 'height:100%;overflow-y:auto;display:none;';
        const content = document.querySelector('.content');
        const app = document.getElementById('app');
        content.insertBefore(div, app);
        viewScrollContainers[key] = div;
    }
    return viewScrollContainers[key];
}

function switchViewContainer(key) {
    for (const k of Object.keys(viewScrollContainers)) {
        viewScrollContainers[k].style.display = 'none';
    }
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    if (key === MODE.ARTICLES || key === MODE.SPECIAL || key === MODE.SETTINGS) {
        if (app) app.style.display = 'block';
    } else {
        const container = ensureViewContainer(key);
        container.style.display = 'block';
    }
}

function triggerViewAnimation() {
    const containerKey = currentMode === MODE.ARTICLES || currentMode === MODE.SPECIAL || currentMode === MODE.SETTINGS
        ? currentMode : currentMode + '_' + currentView;
    const el = getViewContainer(containerKey);
    if (!el) return;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            el.classList.remove('content-enter');
            void el.offsetWidth;
            el.classList.add('content-enter');
        });
    });
}

function getViewContainer(key) {
    if (key === MODE.ARTICLES || key === MODE.SPECIAL || key === MODE.SETTINGS) {
        return document.getElementById('app');
    }
    return ensureViewContainer(key);
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

function restoreExpandedStates(states) {
    if (!states) return;
    if (states.expandedSeries) {
        for (const id of states.expandedSeries) {
            const body = document.getElementById('body-' + id);
            const icon = document.getElementById('icon-' + id);
            if (body) { body.classList.add('open'); if (icon) icon.classList.add('open'); }
        }
    }
    if (states.expandedVarieties) {
        for (const id of states.expandedVarieties) {
            const list = document.getElementById('list-' + id);
            const icon = document.getElementById('icon-' + id);
            if (list) { list.classList.add('open'); if (icon) icon.classList.add('open'); }
        }
    }
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
    const content = document.querySelector('.content');
    const scrollY = content ? content.scrollTop : 0;

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
    } else if (currentMode === MODE.ARTICLES) {
        const prev = articleState;
        articleState = {
            currentView: currentArticleView, currentCategory: currentArticleCategory,
            currentIndex: currentArticleIndex, searchKeyword: articleSearchKeyword,
            listScrollY: currentArticleView === VIEW.LIST ? scrollY : (prev.listScrollY || 0),
            readerScrollY: currentArticleView === VIEW.READER ? scrollY : (prev.readerScrollY || 0)
        };
    } else if (currentMode === MODE.SPECIAL) {
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

function applySidebarState() {
    if (currentMode === MODE.NOTES || currentMode === MODE.COINS) {
        const saved = modeStates[currentMode];
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebarToggle');
        if (!sidebar || !toggle) return;
        const collapsed = saved ? saved.isSidebarCollapsed : false;
        sidebar.classList.toggle('collapsed', collapsed);
        toggle.textContent = '☰';
        isSidebarCollapsed = collapsed;
    }
}

function setupModalEvents() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    modal.addEventListener('click', function(e) {
        if (e.target === modal) closeModal();
    });
}
