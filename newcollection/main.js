// ========== 状态管理 ==========
let currentMode = 'notes';
let currentTab = 'notes';
let currentCategoryId = null;
let currentSubId = null;
let currentView = 'overview';
let searchMode = 'realtime';
let currentSearchKeyword = '';
let currentSearchType = 'all';
let scrollMemory = {};
let isSettingsMode = false;
let settingsReturnState = null;
let isSidebarCollapsed = false;
let settingsPageCache = null;

// 专题状态
let selectedSpecial = null;
let specialPageCaches = {};

// 评级切换状态
let ratingMode = 'notes';

let modeStates = {
    notes: {
        currentCategoryId: null,
        currentSubId: null,
        currentView: 'overview',
        currentSearchKeyword: '',
        currentSearchType: 'all',
        searchMode: 'realtime',
        isSidebarCollapsed: false,
        expandedSeries: [],
        expandedVarieties: [],
        overviewScrollY: 0,
        categoryScrollY: 0,
        searchScrollY: 0
    },
    coins: {
        currentCategoryId: null,
        currentSubId: null,
        currentView: 'overview',
        currentSearchKeyword: '',
        currentSearchType: 'all',
        searchMode: 'realtime',
        isSidebarCollapsed: false,
        expandedSeries: [],
        expandedVarieties: [],
        overviewScrollY: 0,
        categoryScrollY: 0,
        searchScrollY: 0
    }
};

let articleState = {
    currentView: 'list',
    currentCategory: 'all',
    currentIndex: -1,
    searchKeyword: '',
    listScrollY: 0,
    readerScrollY: 0
};

let articleSearchMode = 'title';

let hammerManager = null;
let currentScale = 1;
let currentX = 0;
let currentY = 0;
let currentModalImg1 = '';
let currentModalImg2 = '';

const KRAUSE_PREFIX = 'Pick# ';

// ===== ★ 独立滚动容器系统 =====
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

    if (key === 'articles' || key === 'special' || key === 'settings') {
        if (app) app.style.display = 'block';
    } else {
        const container = ensureViewContainer(key);
        container.style.display = 'block';
    }
}

function triggerViewAnimation() {
    const containerKey = currentMode === 'articles' || currentMode === 'special' || currentMode === 'settings'
        ? currentMode
        : currentMode + '_' + currentView;
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
    if (key === 'articles' || key === 'special' || key === 'settings') {
        return document.getElementById('app');
    }
    return ensureViewContainer(key);
}

/* ========== 专题配置 ========== */
function getSpecialConfigs() {
    return window.SPECIAL_CONFIGS || [];
}

let specialCategoryTree = null;

function buildSpecialCategoryTree() {
    specialCategoryTree = [];
    for (const config of getSpecialConfigs()) {
        const children = [];
        for (const cat of config.categories) {
            children.push({ id: cat.id, name: cat.name, dataKey: config.id });
        }
        specialCategoryTree.push({
            id: config.id,
            name: config.name,
            dataKey: config.id,
            children: children
        });
    }
}

function getCategoryTree() {
    if (currentMode === 'special') return specialCategoryTree;
    return currentMode === 'notes' ? categoryTree : coinCategoryTree;
}

function getImageBase() {
    if (currentMode === 'special') {
        const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
        return config ? config.imageBase : '';
    }
    return currentMode === 'notes' ? IMAGE_BASE : COIN_IMAGE_BASE;
}

function getAllDataKeys() {
    return currentMode === 'notes' ? allDataKeys : coinAllDataKeys;
}

function getData(dataKey) {
    if (currentMode === 'notes') {
        return window.DATA_MAP && window.DATA_MAP[dataKey] ? window.DATA_MAP[dataKey] : null;
    } else if (currentMode === 'coins') {
        return window.COIN_DATA_MAP && window.COIN_DATA_MAP[dataKey] ? window.COIN_DATA_MAP[dataKey] : null;
    } else if (currentMode === 'special') {
        return window.FUN_DATA_MAP && window.FUN_DATA_MAP[dataKey] ? window.FUN_DATA_MAP[dataKey] : null;
    }
    return null;
}

function getSubCategoryMap() {
    return currentMode === 'notes' ? subCategoryMap : {};
}

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
    toggle.textContent = isSidebarCollapsed ? '▸' : '◂';
    toggle.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
    if (currentMode === 'notes' || currentMode === 'coins') {
        const prev = modeStates[currentMode] || {};
        modeStates[currentMode] = { ...prev, isSidebarCollapsed: isSidebarCollapsed };
    }
}

function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    if (currentMode === 'articles') {
        renderArticleSidebar();
        return;
    }

    let tree;
    if (currentMode === 'special') {
        tree = specialCategoryTree;
    } else {
        tree = getCategoryTree();
    }

    if (!tree) { sidebar.innerHTML = ''; return; }

    let html = '';
    for (const cat of tree) {
        const hasChildren = cat.children && cat.children.length > 0;
        const isActive = currentCategoryId === cat.id;
        const isExpanded = isActive && hasChildren;
        html += `<div class="sidebar-item ${isActive ? 'active' : ''}" onclick="onSidebarItemClick('${cat.id}')">`;
        html += `<span>${cat.name}</span>`;
        if (hasChildren) {
            html += `<span class="expand-icon ${isExpanded ? 'expanded' : ''}">▸</span>`;
        }
        html += `</div>`;
        if (hasChildren) {
            html += `<div class="sidebar-children ${isExpanded ? 'open' : ''}" id="children-${cat.id}">`;
            for (const sub of cat.children) {
                const subActive = currentSubId === sub.id;
                html += `<div class="sidebar-child ${subActive ? 'active' : ''}" onclick="onSidebarChildClick('${cat.id}', '${sub.id}'); event.stopPropagation();">${sub.name}</div>`;
            }
            html += `</div>`;
        }
    }
    sidebar.innerHTML = html;
}

function scrollToTop() {
    const content = document.querySelector('.content');
    if (content) content.scrollTop = 0;
}

function onSidebarItemClick(catId) {
    if (currentMode === 'special') {
        if (selectedSpecial === catId) {
            selectedSpecial = null;
            currentCategoryId = null;
            currentSubId = null;
            renderSpecialOverview();
            return;
        }
        selectedSpecial = catId;
        const config = getSpecialConfigs().find(c => c.id === catId);
        if (config && config.categories && config.categories.length > 0) {
            currentCategoryId = catId;
            currentSubId = null;
        } else {
            currentCategoryId = catId;
            currentSubId = null;
        }
        renderSidebar();
        renderSpecialContent();
        return;
    }

    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === catId);
    if (!cat) return;

    if (currentCategoryId === catId) {
        currentCategoryId = null;
        currentSubId = null;
        currentView = 'overview';
        switchViewContainer(currentMode + '_overview');
        renderSidebar();
        renderOverview();
        triggerViewAnimation();
        return;
    }

    currentCategoryId = catId;
    currentView = 'category';
    if (cat.children) {
        currentSubId = null;
    } else {
        currentSubId = null;
    }
    switchViewContainer(currentMode + '_category');
    renderSidebar();
    renderCurrentCategory();
    triggerViewAnimation();
}

function onSidebarChildClick(parentId, subId) {
    if (currentMode === 'special') {
        if (currentSubId === subId) {
            currentSubId = null;
            currentCategoryId = parentId;
            renderSidebar();
            renderSpecialContent();
            return;
        }
        selectedSpecial = parentId;
        currentCategoryId = parentId;
        currentSubId = subId;
        renderSidebar();
        renderSpecialContent();
        return;
    }

    if (currentSubId === subId) {
        currentSubId = null;
        currentCategoryId = parentId;
        currentView = 'category';
        switchViewContainer(currentMode + '_category');
        renderSidebar();
        renderCurrentCategory();
        triggerViewAnimation();
        return;
    }

    currentCategoryId = parentId;
    currentSubId = subId;
    currentView = 'category';
    switchViewContainer(currentMode + '_category');
    renderSidebar();
    renderCurrentCategory();
    triggerViewAnimation();
}

/* ===== renderCurrentCategory ===== */
function renderCurrentCategory() {
    if (!currentCategoryId) {
        switchViewContainer(currentMode + '_overview');
        renderOverview();
        triggerViewAnimation();
        return;
    }

    if (currentMode === 'special') {
        renderSpecialContent();
        return;
    }

    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === currentCategoryId);
    if (!cat) { renderOverview(); triggerViewAnimation(); return; }

    if (cat.children && cat.children.length > 0 && !currentSubId) {
        renderCategoryOverview(cat);
        return;
    }

    let dataKey;
    const subMap = getSubCategoryMap();
    if (currentSubId) {
        const subInfo = subMap[currentSubId];
        if (subInfo) dataKey = subInfo.dataKey;
    } else if (cat.dataKey) {
        dataKey = cat.dataKey;
    }

    if (!dataKey) { renderOverview(); triggerViewAnimation(); return; }

    const data = getData(dataKey);
    if (!data) {
        const app = getViewContainer(currentMode + '_category');
        app.innerHTML = '<div class="empty-state">暂无数据</div>';
        triggerViewAnimation();
        return;
    }

    const subName = currentSubId ? (subMap[currentSubId]?.name || '') : '';
    const title = subName ? subName : (cat.name || '');
    renderSeriesList(data, title);
    // renderSeriesList 内部触发动画？若没有，可以在此添加
}

/* ===== renderCategoryOverview ===== */
function renderCategoryOverview(cat) {
    const app = getViewContainer(currentMode + '_category');
    const imgBase = getImageBase();
    const subMap = getSubCategoryMap();

    let allItems = [];
    let globalIndex = 1;

    for (const sub of cat.children) {
        const subInfo = subMap[sub.id];
        if (!subInfo || !subInfo.dataKey) continue;
        const data = getData(subInfo.dataKey);
        if (!data || !data.series) continue;

        const catLabel = cat.name + ' - ' + sub.name;
        for (let si = 0; si < data.series.length; si++) {
            const series = data.series[si];
            if (series.varieties) {
                for (let vi = 0; vi < series.varieties.length; vi++) {
                    const variety = series.varieties[vi];
                    if (!variety.copies) continue;
                    for (let ci = 0; ci < variety.copies.length; ci++) {
                        allItems.push({
                            catLabel, catId: cat.id, subId: sub.id,
                            dataKey: subInfo.dataKey, si, vi, ci,
                            series, variety, copy: variety.copies[ci],
                            hasVarieties: true, globalIndex: globalIndex++
                        });
                    }
                }
            } else if (series.copies) {
                for (let ci = 0; ci < series.copies.length; ci++) {
                    allItems.push({
                        catLabel, catId: cat.id, subId: sub.id,
                        dataKey: subInfo.dataKey, si, vi: null, ci,
                        series, variety: null, copy: series.copies[ci],
                        hasVarieties: false, globalIndex: globalIndex++
                    });
                }
            }
        }
    }

    let html = `<div class="overview-header"><h2>${escapeHtml(cat.name)}</h2><p>共 ${allItems.length} 件藏品</p></div>`;
    if (allItems.length === 0) {
        html += '<div class="empty-state">暂无数据</div>';
        app.innerHTML = html;
        triggerViewAnimation();
        return;
    }

    const grouped = {};
    for (const item of allItems) {
        if (!grouped[item.catLabel]) grouped[item.catLabel] = [];
        grouped[item.catLabel].push(item);
    }

    for (const [label, items] of Object.entries(grouped)) {
        html += `<div class="search-result-group">`;
        html += `<div class="search-group-header">${escapeHtml(label)} <span class="count">${items.length}件</span></div>`;
        for (const item of items) {
            const c = item.copy;
            const img1 = c.img1 ? imgBase + c.img1 : '';
            const img2 = c.img2 ? imgBase + c.img2 : '';
            const displayName = item.hasVarieties && item.variety
                ? `${item.series.seriesName} - ${item.variety.varietyName}`
                : item.series.seriesName;
            const catalogNum = c.catalogNumber || c.krause || '';
            const catalogDisplay = catalogNum ? (catalogNum.startsWith('Pick#') ? catalogNum : (catalogNum.startsWith('KM#') ? catalogNum : 'Pick# ' + catalogNum)) : '';

            html += `<div class="search-result-item" onclick="navigateFromOverview('${item.dataKey}', ${item.si}, ${item.hasVarieties ? item.vi : 'null'}, ${item.ci}, ${item.hasVarieties})">`;
            html += `<div class="dual-thumb">`;
            if (img1) html += `<img class="mini-thumb" src="${img1}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
            if (img2) html += `<img class="mini-thumb" src="${img2}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
            if (!img1 && !img2) html += `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;">无预览</div>`;
            html += `</div>`;
            html += `<div class="info">`;
            html += `<div class="name">${escapeHtml(displayName)}</div>`;
            html += `<div class="detail">`;
            if (c.version) html += `${escapeHtml(c.version)} · `;
            if (c.condition || c.grade) html += `${escapeHtml(c.condition || c.grade)} · `;
            if (c.year) html += `${c.year}年`;
            if (catalogDisplay) html += ` · ${escapeHtml(catalogDisplay)}`;
            html += `</div></div>`;
            html += `<div class="index-num">#${item.globalIndex}</div>`;
            html += `</div>`;
        }
        html += `</div>`;
    }

    app.innerHTML = html;
    triggerViewAnimation();
}

/* ===== 更新搜索UI ===== */
function updateSearchUIForMode() {
    const select = document.getElementById('searchType');
    const toggle = document.getElementById('modeToggle');
    const tip = document.getElementById('searchTip');

    if (!select || !toggle || !tip) return;

    if (currentMode === 'articles') {
        select.classList.add('hidden');
        toggle.classList.remove('hidden');
        toggle.textContent = articleSearchMode === 'title' ? '标' : '全';
        toggle.title = articleSearchMode === 'title' ? '当前：标题索引，点击切换为全字段索引' : '当前：全字段索引，点击切换为标题索引';
        tip.textContent = articleSearchMode === 'title' ? '文章搜索：标题索引（实时）' : '文章搜索：全字段索引（实时）';
    } else if (currentMode === 'special' || currentMode === 'settings') {
        select.classList.add('hidden');
        toggle.classList.add('hidden');
        tip.textContent = '';
    } else {
        select.classList.remove('hidden');
        toggle.classList.remove('hidden');
        const saved = modeStates[currentMode];
        const mode = saved ? saved.searchMode : 'realtime';
        toggle.textContent = mode === 'click' ? '□' : '■';
        toggle.title = '切换搜索模式';
        tip.textContent = `当前模式：${mode === 'click' ? '点击搜索' : '实时搜索'} | 点击"${mode === 'click' ? '□' : '■'}"可切换`;
    }
}

/* ===== 状态保存/恢复 ===== */
function saveFullState() {
    const content = document.querySelector('.content');
    const scrollY = content ? content.scrollTop : 0;

    if (currentMode === 'notes' || currentMode === 'coins') {
        const expanded = collectExpandedStates();
        const prev = modeStates[currentMode] || {};
        modeStates[currentMode] = {
            currentCategoryId,
            currentSubId,
            currentView,
            currentSearchKeyword: currentSearchKeyword || '',
            currentSearchType: currentSearchType || 'all',
            searchMode: searchMode,
            isSidebarCollapsed: isSidebarCollapsed,
            expandedSeries: expanded.expandedSeries,
            expandedVarieties: expanded.expandedVarieties,
            overviewScrollY: currentView === 'overview' ? scrollY : (prev.overviewScrollY || 0),
            categoryScrollY: currentView === 'category' ? scrollY : (prev.categoryScrollY || 0),
            searchScrollY: currentView === 'search' ? scrollY : (prev.searchScrollY || 0)
        };
    } else if (currentMode === 'articles') {
        const prev = articleState;
        articleState = {
            currentView: currentArticleView,
            currentCategory: currentArticleCategory,
            currentIndex: currentArticleIndex,
            searchKeyword: articleSearchKeyword,
            listScrollY: currentArticleView === 'list' ? scrollY : (prev.listScrollY || 0),
            readerScrollY: currentArticleView === 'reader' ? scrollY : (prev.readerScrollY || 0)
        };
    } else if (currentMode === 'special') {
        const appEl = document.getElementById('app');
        if (selectedSpecial !== null && selectedSpecial !== undefined) {
            specialPageCaches[selectedSpecial] = {
                innerHTML: appEl ? appEl.innerHTML : '',
                scrollY,
                currentSubId: currentSubId
            };
        }
    } else if (currentMode === 'settings') {
        const appEl = document.getElementById('app');
        settingsPageCache = {
            innerHTML: appEl ? appEl.innerHTML : '',
            scrollY
        };
    }
}

function restoreSidebarState() {
    if (currentMode === 'notes' || currentMode === 'coins') {
        const saved = modeStates[currentMode];
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebarToggle');
        if (!sidebar || !toggle) return;

        const collapsed = saved ? saved.isSidebarCollapsed : false;
        sidebar.classList.toggle('collapsed', collapsed);
        toggle.textContent = collapsed ? '▸' : '◂';
        toggle.title = collapsed ? '展开侧边栏' : '收起侧边栏';
        isSidebarCollapsed = collapsed;
    }
}

let currentInputHandler = null;

function bindSearchInputHandler() {
    const inp = document.getElementById('searchInput');
    if (!inp) return;
    if (currentInputHandler) {
        inp.removeEventListener('input', currentInputHandler);
    }

    if (currentMode === 'articles') {
        if (articleSearchMode === 'title') {
            currentInputHandler = function() {
                const val = this.value.trim();
                if (val) filterArticlesByTitle(val);
                else collectAndRenderAllArticles();
            };
        } else {
            currentInputHandler = doSearch;
        }
    } else if (currentMode === 'notes' || currentMode === 'coins') {
        const saved = modeStates[currentMode];
        const mode = saved ? saved.searchMode : 'realtime';
        if (mode === 'realtime') {
            currentInputHandler = function() {
                const val = this.value.trim();
                currentSearchKeyword = val;
                if (val) {
                    currentView = 'search';
                    performSearchAndRender(val, currentSearchType);
                } else {
                    currentView = 'overview';
                    switchViewContainer(currentMode + '_overview');
                    renderOverview();
                    triggerViewAnimation();
                }
            };
        } else {
            currentInputHandler = null;
        }
    } else {
        currentInputHandler = null;
    }

    if (currentInputHandler) {
        inp.addEventListener('input', currentInputHandler);
    }
}

function toggleSearchMode() {
    if (currentMode === 'articles') {
        toggleArticleSearchMode();
        return;
    }
    if (currentMode === 'special' || currentMode === 'settings') return;

    const saved = modeStates[currentMode];
    const currentModeValue = saved ? saved.searchMode : 'realtime';
    const newMode = currentModeValue === 'realtime' ? 'click' : 'realtime';
    searchMode = newMode;
    if (saved) {
        modeStates[currentMode] = { ...saved, searchMode: newMode };
    }
    bindSearchInputHandler();
    updateSearchUIForMode();
}

function toggleArticleSearchMode() {
    articleSearchMode = articleSearchMode === 'title' ? 'full' : 'title';
    bindSearchInputHandler();
    updateSearchUIForMode();
    const inp = document.getElementById('searchInput');
    if (inp && inp.value.trim()) {
        if (articleSearchMode === 'title') {
            filterArticlesByTitle(inp.value.trim());
        } else {
            doSearch();
        }
    } else {
        collectAndRenderAllArticles();
    }
}

/* ===== 主要Tab切换 ===== */
function onTabClick(target) {
    saveFullState();

    // ===== 设置 =====
    if (target === 'settings') {
        if (!isSettingsMode) {
            settingsReturnState = {
                currentMode: currentMode,
                currentCategoryId: currentCategoryId,
                currentSubId: currentSubId,
                currentView: currentView,
                currentSearchKeyword: currentSearchKeyword || '',
                currentSearchType: currentSearchType || 'all',
                selectedSpecial: selectedSpecial
            };
        }
        switchViewContainer('settings');
        enterSettings();
        return;
    }

    // ===== 专题 =====
    if (target === 'special') {
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn && toggleBtn.style.display === 'none') {
            toggleBtn.style.display = '';
        }
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');

        if (isSettingsMode) {
            const appEl = document.getElementById('app');
            const contentEl = document.querySelector('.content');
            if (appEl) {
                settingsPageCache = { innerHTML: appEl.innerHTML, scrollY: contentEl ? contentEl.scrollTop : 0 };
            }
            isSettingsMode = false;
            document.querySelector('.body-row')?.classList.remove('settings-mode');
        }

        currentMode = 'special';
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');

        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.add('hidden');

        switchViewContainer('special');
        if (selectedSpecial !== null && selectedSpecial !== undefined && specialPageCaches[selectedSpecial]) {
            const cache = specialPageCaches[selectedSpecial];
            currentSubId = cache.currentSubId || null;
            currentCategoryId = selectedSpecial;
            document.querySelector('.body-row')?.classList.remove('special-overview-mode');
            const toggleBtn2 = document.getElementById('sidebarToggle');
            if (toggleBtn2) toggleBtn2.style.display = '';
            document.getElementById('app').innerHTML = cache.innerHTML;
            renderSidebar();
            requestAnimationFrame(() => {
                const appEl = document.getElementById('app');
                if (appEl) appEl.scrollTop = cache.scrollY || 0;
            });
        } else {
            renderSpecialOverview();
        }
        triggerViewAnimation(); // 专题内容渲染后触发动画
        return;
    }

    // ===== 退出设置模式 =====
    if (isSettingsMode) {
        const appEl = document.getElementById('app');
        const contentEl = document.querySelector('.content');
        if (appEl) {
            settingsPageCache = { innerHTML: appEl.innerHTML, scrollY: contentEl ? contentEl.scrollTop : 0 };
        }
        isSettingsMode = false;
        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.remove('hidden');
        document.querySelector('.body-row')?.classList.remove('settings-mode');
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn && toggleBtn.style.display === 'none') toggleBtn.style.display = '';

        if (target === 'articles') {
            currentMode = 'articles';
            currentArticleView = articleState.currentView;
            currentArticleCategory = articleState.currentCategory;
            currentArticleIndex = articleState.currentIndex;
            articleSearchKeyword = articleState.searchKeyword;
            if (collectedArticles.length === 0) collectAllArticles();
            const inp = document.getElementById('searchInput');
            if (inp) { inp.value = articleSearchKeyword || ''; bindSearchInputHandler(); }
            switchViewContainer('articles');
            updateSearchUIForMode();
            renderSidebar();
            if (currentArticleView === 'list') renderArticleList();
            else openArticleReader(currentArticleIndex);
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            document.querySelector(`.tab-item[data-target="articles"]`)?.classList.add('active');
            triggerViewAnimation();
            return;
        }

        if (target === 'notes' || target === 'coins') {
            currentMode = target;
            const saved = modeStates[target];
            searchMode = saved ? saved.searchMode : 'realtime';
            if (saved.currentSearchKeyword && saved.currentSearchKeyword.trim() !== '') {
                currentView = saved.currentView;
            } else {
                currentView = 'overview';
                modeStates[target].currentView = 'overview';
            }
            currentCategoryId = saved.currentCategoryId;
            currentSubId = saved.currentSubId;
            currentSearchKeyword = saved.currentSearchKeyword || '';
            currentSearchType = saved.currentSearchType || 'all';

            const inp = document.getElementById('searchInput');
            if (inp) { inp.value = currentSearchKeyword; bindSearchInputHandler(); }
            const typeSelect = document.getElementById('searchType');
            if (typeSelect) typeSelect.value = currentSearchType;

            const containerKey = currentMode + '_' + currentView;
            switchViewContainer(containerKey);
            updateSearchUIForMode();
            restoreSidebarState();
            renderSidebar();
            if (currentView === 'overview') {
                renderOverview();
                restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
            } else if (currentView === 'category') {
                renderCurrentCategory();
                restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
            } else if (currentView === 'search') {
                if (currentSearchKeyword) {
                    performSearchAndRender(currentSearchKeyword, currentSearchType);
                } else {
                    currentView = 'overview';
                    switchViewContainer(currentMode + '_overview');
                    renderOverview();
                }
            }
            triggerViewAnimation();
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');
            return;
        }

        if (target === 'special') {
            currentMode = 'special';
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');
            const searchContainer = document.querySelector('.top-search-container');
            if (searchContainer) searchContainer.classList.add('hidden');
            switchViewContainer('special');
            if (settingsReturnState && settingsReturnState.selectedSpecial) {
                selectedSpecial = settingsReturnState.selectedSpecial;
                currentCategoryId = settingsReturnState.selectedSpecial;
                currentSubId = settingsReturnState.currentSubId;
                renderSidebar();
                renderSpecialContent();
                const cache = specialPageCaches[selectedSpecial];
                if (cache) {
                    requestAnimationFrame(() => {
                        const appEl = document.getElementById('app');
                        if (appEl) appEl.scrollTop = cache.scrollY || 0;
                    });
                }
            } else {
                renderSpecialOverview();
            }
            triggerViewAnimation();
            return;
        }

        if (settingsReturnState) {
            currentMode = settingsReturnState.currentMode || 'notes';
            currentCategoryId = settingsReturnState.currentCategoryId;
            currentSubId = settingsReturnState.currentSubId;
            currentView = settingsReturnState.currentView;
            currentSearchKeyword = settingsReturnState.currentSearchKeyword || '';
            currentSearchType = settingsReturnState.currentSearchType || 'all';
            const saved = modeStates[currentMode];
            searchMode = saved ? saved.searchMode : 'realtime';
        }
        switchViewContainer(currentMode + '_' + currentView);
        updateSearchUIForMode();
        renderSidebar();
        if (currentView === 'overview') renderOverview();
        else renderCurrentCategory();
        triggerViewAnimation();
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${currentMode}"]`)?.classList.add('active');
        return;
    }

    // ===== 文章 =====
    if (target === 'articles') {
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn && toggleBtn.style.display === 'none') toggleBtn.style.display = '';
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');

        currentMode = 'articles';
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

        if (collectedArticles.length === 0) collectAllArticles();
        currentArticleView = articleState.currentView;
        currentArticleCategory = articleState.currentCategory;
        currentArticleIndex = articleState.currentIndex;
        articleSearchKeyword = articleState.searchKeyword;

        const inp = document.getElementById('searchInput');
        if (inp) { inp.value = articleSearchKeyword || ''; bindSearchInputHandler(); }

        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.remove('hidden');

        switchViewContainer('articles');
        updateSearchUIForMode();
        renderSidebar();
        if (currentArticleView === 'list') renderArticleList();
        else openArticleReader(currentArticleIndex);
        triggerViewAnimation();
        return;
    }

    // ===== 纸币/硬币 =====
    if (target === 'notes' || target === 'coins') {
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn && toggleBtn.style.display === 'none') toggleBtn.style.display = '';
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');

        const newMode = target;
        currentMode = newMode;
        const saved = modeStates[newMode];
        searchMode = saved ? saved.searchMode : 'realtime';

        if (saved.currentSearchKeyword && saved.currentSearchKeyword.trim() !== '') {
            currentView = saved.currentView;
        } else {
            currentView = 'overview';
            saved.currentView = 'overview';
        }
        currentCategoryId = saved.currentCategoryId;
        currentSubId = saved.currentSubId;
        currentSearchKeyword = saved.currentSearchKeyword || '';
        currentSearchType = saved.currentSearchType || 'all';

        const inp = document.getElementById('searchInput');
        if (inp) { inp.value = currentSearchKeyword; bindSearchInputHandler(); }
        const typeSelect = document.getElementById('searchType');
        if (typeSelect) typeSelect.value = currentSearchType;

        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.remove('hidden');

        const containerKey = newMode + '_' + currentView;
        switchViewContainer(containerKey);
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');
        updateSearchUIForMode();
        restoreSidebarState();
        renderSidebar();
        if (currentView === 'overview') {
            renderOverview();
            restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
        } else if (currentView === 'category') {
            renderCurrentCategory();
            restoreExpandedStates({ expandedSeries: saved.expandedSeries, expandedVarieties: saved.expandedVarieties });
        } else if (currentView === 'search') {
            if (currentSearchKeyword) {
                performSearchAndRender(currentSearchKeyword, currentSearchType);
            } else {
                currentView = 'overview';
                switchViewContainer(newMode + '_overview');
                renderOverview();
            }
        }
        triggerViewAnimation();
        return;
    }
}

function enterSettings() {
    isSettingsMode = true;
    currentSearchKeyword = '';
    articleSearchKeyword = '';
    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.add('hidden');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    document.querySelector('.body-row')?.classList.add('settings-mode');
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="settings"]')?.classList.add('active');
    renderSettingsPage();
    restoreExpandedStates({ scrollY: settingsPageCache?.scrollY || 0 });
    const appEl = document.getElementById('app');
    if (appEl) {
        settingsPageCache = { ...settingsPageCache, innerHTML: appEl.innerHTML, scrollY: appEl.scrollTop };
    }
}

/* ==================== 专题功能 ==================== */

function renderSpecialOverview() {
    const app = document.getElementById('app');
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    document.querySelector('.body-row')?.classList.add('special-overview-mode');
    if (sidebar) sidebar.classList.remove('collapsed');
    if (toggleBtn) toggleBtn.style.display = 'none';

    let html = '';
    for (const config of getSpecialConfigs()) {
        const isActive = selectedSpecial === config.id;
        html += `<div class="sidebar-item ${isActive ? 'active' : ''}" onclick="onSpecialOverviewItemClick('${config.id}')">`;
        html += `<span>${escapeHtml(config.name)}</span></div>`;
    }
    sidebar.innerHTML = html;
    app.innerHTML = '';
    triggerViewAnimation();
}

function onSpecialOverviewItemClick(specialId) {
    selectedSpecial = specialId;
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) toggleBtn.style.display = '';
    const config = getSpecialConfigs().find(c => c.id === specialId);
    if (config && config.categories && config.categories.length > 0) {
        currentCategoryId = specialId;
        currentSubId = null;
    } else {
        currentCategoryId = specialId;
        currentSubId = null;
    }
    renderSidebar();
    renderSpecialContent();
    triggerViewAnimation();
}

function renderSpecialContent() {
    if (!selectedSpecial) { renderSpecialOverview(); return; }
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) { renderSpecialOverview(); return; }
    const data = getData(config.dataKey);
    if (!data || data.length === 0) {
        document.getElementById('app').innerHTML = '<div class="empty-state">暂无数据</div>';
        triggerViewAnimation();
        return;
    }
    let filteredData = data;
    if (currentSubId && currentSubId !== 'all') {
        const catConfig = config.categories.find(c => c.id === currentSubId);
        if (catConfig && catConfig.filter) filteredData = data.filter(catConfig.filter);
    }
    const imgBase = config.imageBase;
    const yearGroups = {};
    for (const item of filteredData) {
        const y = item.year;
        if (!yearGroups[y]) yearGroups[y] = [];
        yearGroups[y].push(item);
    }
    const sortedYears = Object.keys(yearGroups).sort((a, b) => b - a);
    let html = `<div class="special-content"><h2>${escapeHtml(config.name)}</h2>`;
    if (currentSubId && currentSubId !== 'all') {
        const catConfig = config.categories.find(c => c.id === currentSubId);
        if (catConfig) html += `<p style="margin-top:-8px;margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem;">${escapeHtml(catConfig.name)} · 共 ${filteredData.length} 项</p>`;
    } else {
        html += `<p style="margin-top:-8px;margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem;">共 ${filteredData.length} 项</p>`;
    }
    for (const year of sortedYears) {
        const items = yearGroups[year];
        html += `<div class="special-year-section"><div class="special-year-title">${year} 年 <span class="count">${items.length} 项</span></div><div class="special-year-grid">`;
        for (const item of items) {
            const imgSrc = item.yearImg ? imgBase + item.yearImg : '';
            html += `<div class="special-item-card" onclick="${imgSrc ? `openSpecialModal('${escapeHtml(imgSrc)}')` : ''}">`;
            if (imgSrc) html += `<div class="special-item-img-wrapper"><img class="special-item-img" src="${imgSrc}" alt="${escapeHtml(item.name)}" loading="lazy"></div>`;
            html += `<div class="special-item-info"><div class="special-item-name">${escapeHtml(item.name)}</div>`;
            if (item.krause) html += `<div class="special-item-krause">${escapeHtml(item.krause)}</div>`;
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }
    html += `</div>`;
    document.getElementById('app').innerHTML = html;
    triggerViewAnimation();
}

function openSpecialModal(imgSrc) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    if (!modal || !modalImg) return;
    modalImg.src = imgSrc;
    modal.style.display = 'flex';
    const container = document.getElementById('imageContainer');
    if (container) {
        container.style.transform = 'translate3d(0px, 0px, 0px) scale3d(1, 1, 1)';
        currentScale = 1; currentX = 0; currentY = 0;
    }
    const scrollY = window.scrollY;
    document.body.classList.add('modal-open');
    document.body.style.top = `-${scrollY}px`;
    modalImg.onload = function() { initPinchZoom(); };
    if (modalImg.complete) initPinchZoom();
}

/* ==================== 统计与设置功能（保持原样） ==================== */
// 以下函数保留原样，因篇幅不再重复，但实际代码中必须包含：
// collectAllCopies, computeStats, buildPriceFilterCategories, getDataBySource,
// buildCategoryOrder, renderPriceListItems, onPriceSortOrFilterChange,
// switchRatingMode, buildRatingHTML, buildYearHTML, renderSettingsPage,
// togglePriceList, updateSettingsPageTheme, addCurrentCustomColor,
// setupModalEvents, exportJSON, exportCSV, exportMarkdown, exportPriceList,
// downloadFile 以及 DOMContentLoaded 事件。
// 请从旧版本完整复制这些函数到此位置。

// 注意：由于篇幅，上述函数此处省略，使用时应全部保留。

document.addEventListener('DOMContentLoaded', function() {
    buildSpecialCategoryTree();
    renderSidebar();

    const contentEl = document.querySelector('.content');
    if (contentEl) {
        contentEl.style.overflow = 'hidden';
        contentEl.style.height = '100%';
    }

    const appEl = document.getElementById('app');
    if (appEl) {
        appEl.style.height = '100%';
        appEl.style.overflowY = 'auto';
    }

    switchViewContainer(currentMode + '_' + currentView);
    renderOverview();

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => onTabClick(tab.dataset.target));
    });

    document.getElementById('searchBtn')?.addEventListener('click', doSearch);
    document.getElementById('resetBtn')?.addEventListener('click', resetSearch);
    document.getElementById('modeToggle')?.addEventListener('click', toggleSearchMode);

    document.getElementById('searchInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (currentMode === 'articles') doSearch();
            else if (searchMode === 'click') doSearch();
        }
    });

    bindSearchInputHandler();
    setupModalEvents();
    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);

    if (typeof loadTheme === 'function') loadTheme();
});
