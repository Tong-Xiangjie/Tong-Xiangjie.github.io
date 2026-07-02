// ========== 状态管理 ==========
let currentMode = 'notes';
let currentTab = 'notes';
let currentCategoryId = null;
let currentSubId = null;
let currentView = 'overview';
// ★[MOD] 删除全局 searchMode，改为从 modeStates 读取
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

let hammerManager = null;
let currentScale = 1;
let currentX = 0;
let currentY = 0;
let currentModalImg1 = '';
let currentModalImg2 = '';

const KRAUSE_PREFIX = 'Pick# ';

// ★[MOD] 获取当前模式的独立搜索模式
function getEffectiveSearchMode() {
    if (currentMode === 'articles') return 'realtime';
    if (currentMode === 'notes' || currentMode === 'coins') {
        const st = modeStates[currentMode];
        return (st && st.searchMode) || 'realtime';
    }
    return 'realtime';
}

// ===== ★ 独立滚动容器系统：每个视图一个容器，浏览器原生隔离 scrollTop =====
const viewScrollContainers = {};

/** 获取或懒创建指定视图的滚动容器 */
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

/** 切换到目标视图容器（隐藏所有容器，显示目标） */
function switchViewContainer(key) {
    // 隐藏所有独立容器
    for (const k of Object.keys(viewScrollContainers)) {
        viewScrollContainers[k].style.display = 'none';
    }
    // 隐藏 #app
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    if (key === 'articles' || key === 'special' || key === 'settings') {
        // 这 3 个模式使用 #app 作为滚动容器
        if (app) app.style.display = 'block';
    } else {
        // notes/coins 模式使用独立滚动容器
        const container = ensureViewContainer(key);
        container.style.display = 'block';
    }
}

/** ★ 触发当前视图容器的入场动画 */
function triggerViewAnimation() {
    const containerKey = currentMode === 'articles' || currentMode === 'special' || currentMode === 'settings'
        ? currentMode
        : currentMode + '_' + currentView;
    const el = getViewContainer(containerKey);
    if (!el) return;
    // 双重 rAF 确保 DOM 已渲染完毕
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            el.classList.remove('content-enter');
            void el.offsetWidth;
            el.classList.add('content-enter');
        });
    });
}

/** 获取当前视图的渲染目标元素 */
function getViewContainer(key) {
    if (key === 'articles' || key === 'special' || key === 'settings') {
        return document.getElementById('app');
    }
    return ensureViewContainer(key);
}

/* ========== 从桥接文件读取专题配置 ========== */
function getSpecialConfigs() {
    return window.SPECIAL_CONFIGS || [];
}

// 专题分类树
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
    toggle.textContent = '☰';
    toggle.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
    // ★ 同步保存到 modeStates
    if (currentMode === 'notes' || currentMode === 'coins') {
        const prev = modeStates[currentMode] || {};
        modeStates[currentMode] = {
            ...prev,
            isSidebarCollapsed: isSidebarCollapsed
        };
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
        triggerViewAnimation();
        return;
    }

    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === catId);
    if (!cat) return;

    if (currentCategoryId === catId) {
        // 返回概览
        currentCategoryId = null;
        currentSubId = null;
        currentView = 'overview';
        switchViewContainer(currentMode + '_overview');
        renderSidebar();
        renderOverview();
        triggerViewAnimation();
        return;
    }

    // 切换到分类
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
            triggerViewAnimation();
            return;
        }
        selectedSpecial = parentId;
        currentCategoryId = parentId;
        currentSubId = subId;
        renderSidebar();
        renderSpecialContent();
        triggerViewAnimation();
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

// ★[MOD] 使用 getEffectiveSearchMode() 替代全局 searchMode
function updateSearchUIForMode() {
    const select = document.getElementById('searchType');
    const toggle = document.getElementById('modeToggle');
    const tip = document.getElementById('searchTip');

    if (!select || !toggle || !tip) return;

    if (currentMode === 'articles') {
        select.classList.add('hidden');
        toggle.classList.remove('hidden');
        toggle.textContent = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '标' : '全';
        toggle.title = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '当前：标题索引，点击切换为全字段索引' : '当前：全字段索引，点击切换为标题索引';
        tip.textContent = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '文章搜索：标题索引（实时）' : '文章搜索：全字段索引（实时）';
    } else if (currentMode === 'special' || currentMode === 'settings') {
        select.classList.add('hidden');
        toggle.classList.add('hidden');
        tip.textContent = '';
    } else {
        // ★[MOD] 纸币/硬币：从 modeStates 读取独立的搜索模式
        const modeSearch = getEffectiveSearchMode();
        select.classList.remove('hidden');
        toggle.classList.remove('hidden');
        toggle.textContent = modeSearch === 'click' ? '□' : '■';
        toggle.title = '切换搜索模式';
        tip.textContent = `当前模式：${modeSearch === 'click' ? '点击搜索' : '实时搜索'} | 点击"${modeSearch === 'click' ? '□' : '■'}"可切换`;
    }
}

// ★[NEW] ========== 搜索核心功能（整合到 file0） ==========
function doSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return;

    const rawKeyword = input.value.trim();

    // 文章模式搜索（强制实时）
    if (currentMode === 'articles') {
        saveScroll('articles');
        articleSearchKeyword = rawKeyword;
        renderArticleList();
        return;
    }

    // 纸币/硬币搜索
    const typeSelect = document.getElementById('searchType');
    const type = typeSelect ? typeSelect.value : 'all';
    currentSearchKeyword = rawKeyword;
    currentSearchType = type;
    currentView = 'search';
    switchViewContainer(currentMode + '_search');
    performSearchAndRender(rawKeyword, type);
}

function resetSearch() {
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    currentSearchKeyword = '';

    if (currentMode === 'articles') {
        articleSearchKeyword = '';
        renderArticleList();
        return;
    }

    currentView = currentCategoryId ? 'category' : 'overview';
    switchViewContainer(currentMode + '_' + currentView);
    if (currentView === 'overview') {
        renderOverview();
    } else {
        renderCurrentCategory();
    }
}

// ★[NEW] 切换搜索模式（使用 modeStates 独立管理）
function toggleSearchMode() {
    if (currentMode === 'articles') {
        if (typeof toggleArticleSearchMode === 'function') {
            toggleArticleSearchMode();
        }
        return;
    }
    if (currentMode !== 'notes' && currentMode !== 'coins') return;

    const current = modeStates[currentMode].searchMode;
    const newMode = current === 'click' ? 'realtime' : 'click';
    modeStates[currentMode].searchMode = newMode;

    const toggle = document.getElementById('modeToggle');
    const tip = document.getElementById('searchTip');
    if (toggle) toggle.textContent = newMode === 'click' ? '□' : '■';
    if (tip) tip.textContent = `当前模式：${newMode === 'click' ? '点击搜索' : '实时搜索'} | 点击"□"可切换`;

    const input = document.getElementById('searchInput');
    if (input) {
        input.removeEventListener('input', doSearch);
        if (newMode === 'realtime') {
            input.addEventListener('input', doSearch);
        }
    }
}

function performSearchAndRender(rawKeyword, type) {
    const keyword = getActualKeyword(rawKeyword, type);
    const isEmptySearch = !keyword || keyword === '';
    const lowerKeyword = isEmptySearch ? '' : keyword.toLowerCase();
    let results = [];
    const keys = getAllDataKeys();

    for (const dataKey of keys) {
        const data = getData(dataKey);
        if (!data || !data.series) continue;

        let catName = dataKey;
        let parentName = '';
        const tree = getCategoryTree();
        for (const cat of tree) {
            if (cat.dataKey === dataKey) {
                catName = cat.name;
                break;
            }
            if (cat.children) {
                for (const sub of cat.children) {
                    if (sub.dataKey === dataKey) {
                        catName = sub.name;
                        parentName = cat.name;
                        break;
                    }
                }
            }
        }

        for (let si = 0; si < data.series.length; si++) {
            const series = data.series[si];
            if (series.varieties && series.varieties.length > 0) {
                for (let vi = 0; vi < series.varieties.length; vi++) {
                    const variety = series.varieties[vi];
                    if (!variety.copies) continue;
                    for (let ci = 0; ci < variety.copies.length; ci++) {
                        const copy = variety.copies[ci];
                        if (matchCopy(copy, series, variety, lowerKeyword, type, isEmptySearch)) {
                            results.push({
                                dataKey, catName, parentName,
                                sIdx: si, vIdx: vi, cIdx: ci,
                                series, variety, copy,
                                hasVarieties: true
                            });
                        }
                    }
                }
            } else if (series.copies) {
                for (let ci = 0; ci < series.copies.length; ci++) {
                    const copy = series.copies[ci];
                    if (matchCopyFlat(copy, series, lowerKeyword, type, isEmptySearch)) {
                        results.push({
                            dataKey, catName, parentName,
                            sIdx: si, cIdx: ci,
                            series, copy,
                            hasVarieties: false
                        });
                    }
                }
            }
        }
    }

    renderSearchResults(results, rawKeyword, type);
}

function matchCopy(copy, series, variety, keyword, type, isEmpty) {
    if (isEmpty) return true;
    switch(type) {
        case 'all':
            const text = `${series.seriesName} ${variety.varietyName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase();
            return text.includes(keyword);
        case 'name':
            return series.seriesName.toLowerCase().includes(keyword) || variety.varietyName.toLowerCase().includes(keyword);
        case 'version':
            return (copy.version || '').toLowerCase().includes(keyword);
        case 'year':
            return String(copy.year).toLowerCase().includes(keyword);
        case 'agency':
            return (copy.condition || copy.grade || '').toLowerCase().includes(keyword);
        case 'krause':
            return (copy.catalogNumber || copy.krause || '').toLowerCase().includes(keyword);
    }
    return false;
}

function matchCopyFlat(copy, series, keyword, type, isEmpty) {
    if (isEmpty) return true;
    switch(type) {
        case 'all':
            const text = `${series.seriesName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase();
            return text.includes(keyword);
        case 'name':
            return series.seriesName.toLowerCase().includes(keyword);
        case 'version':
            return (copy.version || '').toLowerCase().includes(keyword);
        case 'year':
            return String(copy.year).toLowerCase().includes(keyword);
        case 'agency':
            return (copy.condition || copy.grade || '').toLowerCase().includes(keyword);
        case 'krause':
            return (copy.catalogNumber || copy.krause || '').toLowerCase().includes(keyword);
    }
    return false;
}

function getActualKeyword(inputValue, searchType) {
    if (searchType === 'krause') {
        if (inputValue.startsWith(KRAUSE_PREFIX)) {
            return inputValue.substring(KRAUSE_PREFIX.length).trim();
        }
        return inputValue.trim();
    }
    return inputValue.trim();
}

function getDisplayValue(keyword, searchType) {
    if (searchType === 'krause') {
        if (!keyword || keyword === '') return KRAUSE_PREFIX;
        if (!keyword.startsWith(KRAUSE_PREFIX)) return KRAUSE_PREFIX + keyword;
    }
    return keyword || '';
}

function renderSearchResults(results, rawKeyword, type) {
    const app = getViewContainer(currentMode + '_search');
    const imgBase = getImageBase();
    const modeLabel = currentMode === 'notes' ? '纸币' : '硬币';

    let html = `<div class="back-bar"><button class="back-btn" onclick="backFromSearch()">← 返回</button></div>`;
    html += `<div class="panel-header"><h2>搜索结果（${modeLabel}）</h2>`;
    html += `<p>找到 ${results.length} 个匹配`;
    if (rawKeyword) html += ` · 关键词：${escapeHtml(getActualKeyword(rawKeyword, type))}`;
    html += `</p></div>`;

    if (results.length === 0) {
        html += `<div class="empty-state">暂无匹配结果</div>`;
        app.innerHTML = html;
        requestAnimationFrame(() => {
            app.classList.remove('content-enter');
            void app.offsetWidth;
            app.classList.add('content-enter');
        });
        return;
    }

    const grouped = {};
    for (const item of results) {
        const key = item.dataKey;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
    }

    let idx = 1;
    const keys = getAllDataKeys();
    for (const dataKey of keys) {
        const group = grouped[dataKey];
        if (!group || group.length === 0) continue;
        const first = group[0];
        const label = first.parentName ? `${first.parentName} - ${first.catName}` : first.catName;

        html += `<div class="search-result-group">`;
        html += `<div class="search-group-header">${escapeHtml(label)} <span class="count">${group.length}件</span></div>`;

        for (const item of group) {
            const copy = item.copy;
            const img1 = copy.img1 ? imgBase + copy.img1 : '';
            const img2 = copy.img2 ? imgBase + copy.img2 : '';
            const displayName = item.hasVarieties
                ? `${item.series.seriesName} - ${item.variety.varietyName}`
                : item.series.seriesName;
            const catalogNum = copy.catalogNumber || copy.krause || '';
            const catalogDisplay = catalogNum ? (catalogNum.startsWith('Pick#') ? catalogNum : (catalogNum.startsWith('KM#') ? catalogNum : 'Pick# ' + catalogNum)) : '';

            html += `<div class="search-result-item" onclick="navigateToCopy('${item.dataKey}', ${item.sIdx}, ${item.hasVarieties ? item.vIdx : 'null'}, ${item.cIdx}, ${item.hasVarieties})">`;
            html += `<div class="dual-thumb">`;
            if (img1) html += `<img class="mini-thumb" src="${img1}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
            if (img2) html += `<img class="mini-thumb" src="${img2}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
            if (!img1 && !img2) html += `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;">无预览</div>`;
            html += `</div>`;
            html += `<div class="info">`;
            html += `<div class="name">${escapeHtml(displayName)}</div>`;
            html += `<div class="detail">`;
            if (copy.version) html += `${escapeHtml(copy.version)} · `;
            if (copy.condition || copy.grade) html += `${escapeHtml(copy.condition || copy.grade)} · `;
            if (copy.year) html += `${copy.year}年`;
            if (catalogDisplay) html += ` · ${escapeHtml(catalogDisplay)}`;
            html += `</div></div>`;
            html += `<div class="index-num">#${idx}</div>`;
            html += `</div>`;
            idx++;
        }
        html += `</div>`;
    }

    app.innerHTML = html;
    requestAnimationFrame(() => {
        app.classList.remove('content-enter');
        void app.offsetWidth;
        app.classList.add('content-enter');
    });
}

function navigateToCopy(dataKey, si, vi, ci, hasVarieties) {
    const tree = getCategoryTree();
    for (const cat of tree) {
        if (cat.children) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) {
                    currentCategoryId = cat.id;
                    currentSubId = sub.id;
                    currentView = 'category';
                    switchViewContainer(currentMode + '_category');
                    renderSidebar();
                    renderCurrentCategory();
                    setTimeout(() => {
                        const seriesId = `series-${si}`;
                        toggleSeries(seriesId);
                        if (hasVarieties && vi !== null) {
                            setTimeout(() => {
                                toggleVariety(`v-${si}-${vi}`);
                                setTimeout(() => {
                                    const el = document.getElementById('list-v-' + si + '-' + vi);
                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 100);
                            }, 50);
                        } else {
                            setTimeout(() => {
                                const el = document.getElementById('copies-' + seriesId);
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 100);
                        }
                    }, 50);
                    return;
                }
            }
        } else if (cat.dataKey === dataKey) {
            currentCategoryId = cat.id;
            currentSubId = null;
            currentView = 'category';
            switchViewContainer(currentMode + '_category');
            renderSidebar();
            renderCurrentCategory();
            setTimeout(() => {
                const seriesId = `series-${si}`;
                toggleSeries(seriesId);
                if (hasVarieties && vi !== null) {
                    setTimeout(() => {
                        toggleVariety(`v-${si}-${vi}`);
                        setTimeout(() => {
                            const el = document.getElementById('list-v-' + si + '-' + vi);
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                    }, 50);
                } else {
                    setTimeout(() => {
                        const el = document.getElementById('copies-' + seriesId);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }
            }, 50);
            return;
        }
    }
}

function backFromSearch() {
    currentView = currentCategoryId ? 'category' : 'overview';
    switchViewContainer(currentMode + '_' + currentView);
    currentSearchKeyword = '';
    if (currentView === 'overview') {
        renderOverview();
    } else {
        renderCurrentCategory();
    }
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
}

/* ===== 统一保存完整状态（切出Tab时调用） ===== */
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
            // ★[MOD] 保存当前模式的独立 searchMode（已由 toggleSearchMode 写入 modeStates）
            searchMode: modeStates[currentMode] ? modeStates[currentMode].searchMode : 'realtime',
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

/* ===== 恢复侧边栏状态（用于离开专题后还原） ===== */
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

function onTabClick(target) {
    // ===== 切出前统一保存状态 =====
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
                settingsPageCache = {
                    innerHTML: appEl.innerHTML,
                    scrollY: contentEl ? contentEl.scrollTop : 0
                };
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
        triggerViewAnimation();
        return;
    }

    // ===== 退出设置模式 =====
    if (isSettingsMode) {
        const appEl = document.getElementById('app');
        const contentEl = document.querySelector('.content');
        if (appEl) {
            settingsPageCache = {
                innerHTML: appEl.innerHTML,
                scrollY: contentEl ? contentEl.scrollTop : 0
            };
        }
        isSettingsMode = false;

        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.remove('hidden');

        document.querySelector('.body-row')?.classList.remove('settings-mode');
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');

        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn && toggleBtn.style.display === 'none') {
            toggleBtn.style.display = '';
        }

        if (target === 'articles') {
            currentMode = 'articles';
            currentArticleView = articleState.currentView;
            currentArticleCategory = articleState.currentCategory;
            currentArticleIndex = articleState.currentIndex;
            articleSearchKeyword = articleState.searchKeyword;
            if (collectedArticles.length === 0) collectAllArticles();
            // ★[MOD] 文章模式独立，不影响纸币/硬币的搜索模式
            const inp = document.getElementById('searchInput');
            if (inp) {
                inp.value = articleSearchKeyword || '';
                inp.removeEventListener('input', doSearch);
                inp.addEventListener('input', doSearch);
            }
            switchViewContainer('articles');
            updateSearchUIForMode();
            renderSidebar();
            if (currentArticleView === 'list') {
                renderArticleList();
            } else {
                openArticleReader(currentArticleIndex);
            }
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            document.querySelector(`.tab-item[data-target="articles"]`)?.classList.add('active');
            triggerViewAnimation();
            return;
        }

        if (target === 'notes' || target === 'coins') {
            currentMode = target;
            const saved = modeStates[target];
            // ★[MOD] 从 modeStates 恢复独立搜索模式，不依赖全局变量
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
            if (inp) {
                inp.value = currentSearchKeyword;
                inp.removeEventListener('input', doSearch);
                // ★[MOD] 使用独立搜索模式
                if (getEffectiveSearchMode() === 'realtime') {
                    inp.addEventListener('input', doSearch);
                }
            }
            const typeSelect = document.getElementById('searchType');
            if (typeSelect) {
                typeSelect.value = currentSearchType;
            }

            const containerKey = currentMode + '_' + currentView;
            switchViewContainer(containerKey);

            updateSearchUIForMode();
            restoreSidebarState();

            renderSidebar();
            if (currentView === 'overview') {
                renderOverview();
                restoreExpandedStates({
                    expandedSeries: saved.expandedSeries,
                    expandedVarieties: saved.expandedVarieties
                });
            } else if (currentView === 'category') {
                renderCurrentCategory();
                restoreExpandedStates({
                    expandedSeries: saved.expandedSeries,
                    expandedVarieties: saved.expandedVarieties
                });
            } else if (currentView === 'search') {
                if (currentSearchKeyword) {
                    performSearchAndRender(currentSearchKeyword, currentSearchType);
                } else {
                    currentView = 'overview';
                    const newKey = currentMode + '_overview';
                    switchViewContainer(newKey);
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
            // ★[MOD] 从 modeStates 恢复
        }
        switchViewContainer(currentMode + '_' + currentView);
        updateSearchUIForMode();
        renderSidebar();
        if (currentView === 'overview') {
            renderOverview();
            restoreExpandedStates({ scrollY: 0 });
        } else {
            renderCurrentCategory();
            restoreExpandedStates({ scrollY: 0 });
        }

        triggerViewAnimation();

        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${currentMode}"]`)?.classList.add('active');
        return;
    }

    // ===== 文章 =====
    if (target === 'articles') {
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn && toggleBtn.style.display === 'none') {
            toggleBtn.style.display = '';
        }
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');

        currentMode = 'articles';
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

        if (collectedArticles.length === 0) collectAllArticles();

        currentArticleView = articleState.currentView;
        currentArticleCategory = articleState.currentCategory;
        currentArticleIndex = articleState.currentIndex;
        articleSearchKeyword = articleState.searchKeyword;

        // ★[MOD] 文章模式独立，不设置全局 searchMode

        const inp = document.getElementById('searchInput');
        if (inp) {
            inp.value = articleSearchKeyword || '';
            inp.removeEventListener('input', doSearch);
            inp.addEventListener('input', doSearch);
        }

        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.remove('hidden');

        switchViewContainer('articles');
        updateSearchUIForMode();
        renderSidebar();
        if (currentArticleView === 'list') {
            renderArticleList();
        } else {
            openArticleReader(currentArticleIndex);
        }
        triggerViewAnimation();
        return;
    }

    // ===== 纸币/硬币 =====
    if (target === 'notes' || target === 'coins') {
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn && toggleBtn.style.display === 'none') {
            toggleBtn.style.display = '';
        }
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');

        const newMode = target;
        currentMode = newMode;

        const saved = modeStates[newMode];

        // ★[MOD] 从 modeStates 恢复独立搜索模式，不设全局变量

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
        if (inp) {
            inp.value = currentSearchKeyword;
            inp.removeEventListener('input', doSearch);
            // ★[MOD] 使用独立搜索模式
            if (getEffectiveSearchMode() === 'realtime') {
                inp.addEventListener('input', doSearch);
            }
        }
        const typeSelect = document.getElementById('searchType');
        if (typeSelect) {
            typeSelect.value = currentSearchType;
        }

        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.remove('hidden');

        const containerKey = newMode + '_' + currentView;
        switchViewContainer(containerKey);

        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

        updateSearchUIForMode();

        // 恢复侧边栏
        restoreSidebarState();

        renderSidebar();
        if (currentView === 'overview') {
            renderOverview();
            restoreExpandedStates({
                expandedSeries: saved.expandedSeries,
                expandedVarieties: saved.expandedVarieties
            });
        } else if (currentView === 'category') {
            renderCurrentCategory();
            restoreExpandedStates({
                expandedSeries: saved.expandedSeries,
                expandedVarieties: saved.expandedVarieties
            });
        } else if (currentView === 'search') {
            if (currentSearchKeyword) {
                performSearchAndRender(currentSearchKeyword, currentSearchType);
            } else {
                currentView = 'overview';
                const newKey = newMode + '_overview';
                switchViewContainer(newKey);
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
        settingsPageCache = {
            ...settingsPageCache,
            innerHTML: appEl.innerHTML,
            scrollY: appEl.scrollTop
        };
    }
}

/* ==================== 专题功能 ==================== */

function renderSpecialOverview() {
    const app = document.getElementById('app');
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');

    document.querySelector('.body-row')?.classList.add('special-overview-mode');

    // ★ 不再修改 isSidebarCollapsed 全局变量，而是强制展开侧边栏（仅显示用途）
    if (sidebar) sidebar.classList.remove('collapsed');
    // 隐藏 toggle 按钮，因为专题概览不需要切换
    if (toggleBtn) toggleBtn.style.display = 'none';

    // 渲染专题列表作为侧边栏
    let html = '';
    for (const config of getSpecialConfigs()) {
        const isActive = selectedSpecial === config.id;
        html += `<div class="sidebar-item ${isActive ? 'active' : ''}" onclick="onSpecialOverviewItemClick('${config.id}')">`;
        html += `<span>${escapeHtml(config.name)}</span>`;
        html += `</div>`;
    }
    sidebar.innerHTML = html;

    app.innerHTML = '';
    // ★ 触发淡入动画
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
    if (!selectedSpecial) {
        renderSpecialOverview();
        return;
    }

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
        if (catConfig && catConfig.filter) {
            filteredData = data.filter(catConfig.filter);
        }
    }

    const imgBase = config.imageBase;

    const yearGroups = {};
    for (const item of filteredData) {
        const y = item.year;
        if (!yearGroups[y]) yearGroups[y] = [];
        yearGroups[y].push(item);
    }
    const sortedYears = Object.keys(yearGroups).sort((a, b) => b - a);

    let html = `<div class="special-content">`;
    html += `<h2>${escapeHtml(config.name)}</h2>`;

    if (currentSubId && currentSubId !== 'all') {
        const catConfig = config.categories.find(c => c.id === currentSubId);
        if (catConfig) {
            html += `<p style="margin-top:-8px;margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem;">${escapeHtml(catConfig.name)} · 共 ${filteredData.length} 项</p>`;
        }
    } else {
        html += `<p style="margin-top:-8px;margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem;">共 ${filteredData.length} 项</p>`;
    }

    for (const year of sortedYears) {
        const items = yearGroups[year];
        html += `<div class="special-year-section">`;
        html += `<div class="special-year-title">${year} 年 <span class="count">${items.length} 项</span></div>`;
        html += `<div class="special-year-grid">`;
        for (const item of items) {
            const imgSrc = item.yearImg ? imgBase + item.yearImg : '';
            html += `<div class="special-item-card" onclick="${imgSrc ? `openSpecialModal('${escapeHtml(imgSrc)}')` : ''}">`;
            if (imgSrc) {
                html += `<div class="special-item-img-wrapper">`;
                html += `<img class="special-item-img" src="${imgSrc}" alt="${escapeHtml(item.name)}" loading="lazy">`;
                html += `</div>`;
            }
            html += `<div class="special-item-info">`;
            html += `<div class="special-item-name">${escapeHtml(item.name)}</div>`;
            if (item.krause) html += `<div class="special-item-krause">${escapeHtml(item.krause)}</div>`;
            html += `</div>`;
            html += `</div>`;
        }
        html += `</div>`;
        html += `</div>`;
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

/* ==================== 统计与设置功能 ==================== */

function collectAllCopies() {
    const allCopies = [];

    if (window.DATA_MAP) {
        for (const dataKey of allDataKeys) {
            const data = window.DATA_MAP[dataKey];
            if (!data || !data.series) continue;
            for (let si = 0; si < data.series.length; si++) {
                const series = data.series[si];
                if (series.varieties) {
                    for (let vi = 0; vi < series.varieties.length; vi++) {
                        const variety = series.varieties[vi];
                        if (!variety.copies) continue;
                        for (let ci = 0; ci < variety.copies.length; ci++) {
                            allCopies.push({
                                copy: variety.copies[ci],
                                seriesName: series.seriesName + ' - ' + variety.varietyName,
                                type: 'notes',
                                dataKey: dataKey
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allCopies.push({
                            copy: series.copies[ci],
                            seriesName: series.seriesName,
                            type: 'notes',
                            dataKey: dataKey
                        });
                    }
                }
            }
        }
    }

    if (window.COIN_DATA_MAP) {
        for (const dataKey of coinAllDataKeys) {
            const data = window.COIN_DATA_MAP[dataKey];
            if (!data || !data.series) continue;
            for (let si = 0; si < data.series.length; si++) {
                const series = data.series[si];
                if (series.varieties) {
                    for (let vi = 0; vi < series.varieties.length; vi++) {
                        const variety = series.varieties[vi];
                        if (!variety.copies) continue;
                        for (let ci = 0; ci < variety.copies.length; ci++) {
                            allCopies.push({
                                copy: variety.copies[ci],
                                seriesName: series.seriesName + ' - ' + variety.varietyName,
                                type: 'coins',
                                dataKey: dataKey
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allCopies.push({
                            copy: series.copies[ci],
                            seriesName: series.seriesName,
                            type: 'coins',
                            dataKey: dataKey
                        });
                    }
                }
            }
        }
    }

    return allCopies;
}

function computeStats(typeFilter) {
    const allCopies = collectAllCopies();
    
    let filtered = allCopies;
    if (typeFilter === 'notes') {
        filtered = allCopies.filter(c => c.type === 'notes');
    } else if (typeFilter === 'coins') {
        filtered = allCopies.filter(c => c.type === 'coins');
    }
    
    const total = filtered.length;

    let notesCount = 0, coinsCount = 0;
    if (window.DATA_MAP) {
        for (const key of allDataKeys) {
            const d = window.DATA_MAP[key];
            if (d && d.series) {
                for (const s of d.series) {
                    if (s.varieties) for (const v of s.varieties) notesCount += (v.copies ? v.copies.length : 0);
                    else if (s.copies) notesCount += s.copies.length;
                }
            }
        }
    }
    if (window.COIN_DATA_MAP) {
        for (const key of coinAllDataKeys) {
            const d = window.COIN_DATA_MAP[key];
            if (d && d.series) {
                for (const s of d.series) {
                    if (s.varieties) for (const v of s.varieties) coinsCount += (v.copies ? v.copies.length : 0);
                    else if (s.copies) coinsCount += s.copies.length;
                }
            }
        }
    }

    let prices = [];
    for (const item of filtered) {
        const ps = item.copy.price;
        if (ps) {
            const num = parseFloat(String(ps).replace(/[^0-9.]/g, ''));
            if (!isNaN(num) && num > 0) {
                prices.push({ value: num, name: item.seriesName, version: item.copy.version || '', dataKey: item.dataKey, type: item.type });
            } else {
                prices.push({ value: -1, name: item.seriesName, version: item.copy.version || '', noPrice: true, dataKey: item.dataKey, type: item.type });
            }
        } else {
            prices.push({ value: -1, name: item.seriesName, version: item.copy.version || '', noPrice: true, dataKey: item.dataKey, type: item.type });
        }
    }
    const totalPrice = prices.reduce((s, p) => s + (p.noPrice ? 0 : p.value), 0);
    const pricedItems = prices.filter(p => !p.noPrice);
    const avgPrice = pricedItems.length > 0 ? Math.round(totalPrice / pricedItems.length) : 0;

    // ===== 评级统计（支持 EPQ/E 后缀及真品） =====
    const gradeCounts = {};
    let ungraded = 0;
    for (const item of filtered) {
        const cond = item.copy.condition || item.copy.grade || '';
        
        // 处理"真品"
        if (cond.includes('真品')) {
            gradeCounts['真品'] = (gradeCounts['真品'] || 0) + 1;
            continue;
        }
        
        // 提取数字 + 可选的 E
        const match = cond.match(/(\d+)\+?(E)?/);
        if (match) {
            const displayGrade = match[1] + (match[2] || '');
            gradeCounts[displayGrade] = (gradeCounts[displayGrade] || 0) + 1;
        } else {
            ungraded++;
        }
    }
    // 排序：带E的比不带E的高0.5，真品视为-1（排最后）
    const sortedGrades = Object.entries(gradeCounts).sort((a, b) => {
        const aVal = a[0] === '真品' ? -1 : parseFloat(a[0].replace('E', '.5'));
        const bVal = b[0] === '真品' ? -1 : parseFloat(b[0].replace('E', '.5'));
        return bVal - aVal;
    });

    const yearCounts = {};
    for (const item of filtered) {
        const y = item.copy.year;
        if (y && typeof y === 'number') {
            const decade = Math.floor(y / 10) * 10;
            const key = decade + 's';
            yearCounts[key] = (yearCounts[key] || 0) + 1;
        }
    }
    const sortedYears = Object.entries(yearCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    return { total, notesCount, coinsCount, prices, totalPrice, avgPrice, sortedGrades, ungraded, sortedYears };
}

function buildPriceFilterCategories() {
    const cats = [];
    if (window.DATA_MAP) {
        for (const cat of categoryTree) {
            if (cat.children) {
                for (const sub of cat.children) {
                    const data = window.DATA_MAP[sub.dataKey];
                    if (data && data.series && data.series.length > 0) {
                        cats.push({ id: 'notes_' + sub.id, name: '纸币 - ' + sub.name, dataKey: sub.dataKey, source: 'notes' });
                    }
                }
            } else if (cat.dataKey) {
                const data = window.DATA_MAP[cat.dataKey];
                if (data && data.series && data.series.length > 0) {
                    cats.push({ id: 'notes_' + cat.id, name: '纸币 - ' + cat.name, dataKey: cat.dataKey, source: 'notes' });
                }
            }
        }
    }
    if (window.COIN_DATA_MAP) {
        for (const cat of coinCategoryTree) {
            const data = window.COIN_DATA_MAP[cat.dataKey];
            if (data && data.series && data.series.length > 0) {
                cats.push({ id: 'coins_' + cat.id, name: '硬币 - ' + cat.name, dataKey: cat.dataKey, source: 'coins' });
            }
        }
    }
    return cats;
}

function getDataBySource(dataKey, source) {
    if (source === 'coins') {
        return window.COIN_DATA_MAP && window.COIN_DATA_MAP[dataKey] ? window.COIN_DATA_MAP[dataKey] : null;
    }
    return window.DATA_MAP && window.DATA_MAP[dataKey] ? window.DATA_MAP[dataKey] : null;
}

function buildCategoryOrder() {
    const order = {};
    let index = 0;
    
    if (window.DATA_MAP) {
        for (const cat of categoryTree) {
            if (cat.children) {
                for (const sub of cat.children) {
                    if (window.DATA_MAP[sub.dataKey]) {
                        order[sub.dataKey] = index++;
                    }
                }
            } else if (cat.dataKey) {
                if (window.DATA_MAP[cat.dataKey]) {
                    order[cat.dataKey] = index++;
                }
            }
        }
    }
    
    if (window.COIN_DATA_MAP) {
        for (const cat of coinCategoryTree) {
            if (window.COIN_DATA_MAP[cat.dataKey]) {
                order[cat.dataKey] = index++;
            }
        }
    }
    
    return order;
}

function renderPriceListItems(prices, order, filter, filterInfo) {
    let filteredPrices = prices;
    if (filter && filter !== 'all' && filterInfo) {
        const data = getDataBySource(filterInfo.dataKey, filterInfo.source);
        if (data && data.series) {
            const allowedNames = [];
            for (const series of data.series) {
                if (series.varieties) {
                    for (const v of series.varieties) {
                        if (v.copies) {
                            for (const c of v.copies) {
                                allowedNames.push(series.seriesName + ' - ' + v.varietyName);
                            }
                        }
                    }
                } else if (series.copies) {
                    for (const c of series.copies) {
                        allowedNames.push(series.seriesName);
                    }
                }
            }
            filteredPrices = prices.filter(p => allowedNames.includes(p.name));
        }
    }
    
    let sorted;
    if (order === 'default') {
        sorted = [...filteredPrices];
    } else {
        sorted = [...filteredPrices].sort((a, b) => {
            if (order === 'desc') return b.value - a.value;
            else return a.value - b.value;
        });
    }

    let html = '';
    for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        const displayPrice = p.noPrice ? '-' : p.value + ' 元';
        const nameHtml = escapeHtml(p.name);
        const versionHtml = p.version ? escapeHtml(p.version) : '';
        html += `<div class="price-list-item">`;
        html += `<span class="price-list-index">${i + 1}</span>`;
        html += `<span class="price-list-name">${nameHtml}${versionHtml ? ' (' + versionHtml + ')' : ''}</span>`;
        html += `<span class="price-list-value ${p.noPrice ? 'no-price' : ''}">${displayPrice}</span>`;
        html += `</div>`;
    }
    if (sorted.length === 0) {
        html += `<div class="price-list-empty">无匹配结果</div>`;
    }
    return html;
}

function onPriceSortOrFilterChange() {
    const sortSelect = document.getElementById('priceSortSelect');
    const filterSelect = document.getElementById('priceFilterSelect');
    const summaryEl = document.getElementById('priceListSummary');
    const bodyEl = document.getElementById('priceListBody');
    if (!sortSelect || !filterSelect || !bodyEl) return;
    
    const order = sortSelect.value;
    const filter = filterSelect.value;
    const stats = computeStats();
    
    let filterInfo = null;
    let filteredPrices = stats.prices;
    
    if (filter && filter !== 'all') {
        const filterCats = buildPriceFilterCategories();
        const matchedCat = filterCats.find(c => c.id === filter);
        if (matchedCat) {
            filterInfo = { dataKey: matchedCat.dataKey, source: matchedCat.source };
            const data = getDataBySource(matchedCat.dataKey, matchedCat.source);
            if (data && data.series) {
                const allowedNames = [];
                for (const series of data.series) {
                    if (series.varieties) {
                        for (const v of series.varieties) {
                            if (v.copies) {
                                for (const c of v.copies) {
                                    allowedNames.push(series.seriesName + ' - ' + v.varietyName);
                                }
                            }
                        }
                    } else if (series.copies) {
                        for (const c of series.copies) {
                            allowedNames.push(series.seriesName);
                        }
                    }
                }
                filteredPrices = stats.prices.filter(p => allowedNames.includes(p.name));
            }
        }
    }
    
    if (summaryEl) {
        if (filterInfo) {
            const total = filteredPrices.reduce((s, p) => s + (p.noPrice ? 0 : p.value), 0);
            const pricedItems = filteredPrices.filter(p => !p.noPrice);
            const avg = pricedItems.length > 0 ? Math.round(total / pricedItems.length) : 0;
            summaryEl.style.display = 'block';
            summaryEl.innerHTML = `<div class="price-list-summary-row"><span>板块总投入</span><span>${total.toFixed(0)} 元</span></div><div class="price-list-summary-row"><span>板块均价</span><span>${avg} 元/件</span></div>`;
        } else {
            summaryEl.style.display = 'none';
        }
    }
    
    bodyEl.innerHTML = renderPriceListItems(stats.prices, order, filter, filterInfo);
}

function changePriceSort(order) {
    const sortSelect = document.getElementById('priceSortSelect');
    if (sortSelect) sortSelect.value = order;
    onPriceSortOrFilterChange();
}

function switchRatingMode(mode) {
    ratingMode = mode;
    const stats = computeStats(ratingMode);
    
    document.querySelectorAll('.rating-tab').forEach(el => {
        el.classList.toggle('active', el.dataset.mode === mode);
    });
    
    const gradeSection = document.getElementById('ratingSection');
    if (gradeSection) {
        gradeSection.style.opacity = '0';
        gradeSection.style.transform = 'translateY(8px)';
        setTimeout(() => {
            gradeSection.innerHTML = buildRatingHTML(stats);
            gradeSection.style.opacity = '1';
            gradeSection.style.transform = 'translateY(0)';
        }, 100);
    }
    
    const yearSection = document.getElementById('yearSection');
    if (yearSection) {
        yearSection.style.opacity = '0';
        yearSection.style.transform = 'translateY(8px)';
        setTimeout(() => {
            yearSection.innerHTML = buildYearHTML(stats);
            yearSection.style.opacity = '1';
            yearSection.style.transform = 'translateY(0)';
        }, 100);
    }
}

function buildRatingHTML(stats) {
    const maxGradeCount = stats.sortedGrades.length > 0
        ? Math.max(...stats.sortedGrades.map(g => g[1]), stats.ungraded)
        : 1;
    let html = `<div class="stats-bars">`;
    for (const [grade, count] of stats.sortedGrades) {
        const pct = (count / maxGradeCount * 100).toFixed(0);
        html += `<div class="stat-bar-row">`;
        // 直接显示 grade 字符串，不附加"分"字
        html += `<span class="stat-bar-label">${grade}</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${count} 件</span>`;
        html += `</div>`;
    }
    if (stats.ungraded > 0) {
        const pct = (stats.ungraded / maxGradeCount * 100).toFixed(0);
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">未评级</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill ungraded" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${stats.ungraded} 件</span>`;
        html += `</div>`;
    }
    if (stats.sortedGrades.length === 0 && stats.ungraded === 0) {
        html += `<div class="empty-colors-hint">暂无评级数据</div>`;
    }
    html += `</div>`;
    return html;
}

function buildYearHTML(stats) {
    const maxYearCount = stats.sortedYears.length > 0
        ? Math.max(...stats.sortedYears.map(y => y[1]))
        : 1;
    let html = `<div class="stats-bars">`;
    for (const [decade, count] of stats.sortedYears) {
        const pct = (count / maxYearCount * 100).toFixed(0);
        const label = decade.slice(0, -1) + '年代';
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">${label}</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${count} 件</span>`;
        html += `</div>`;
    }
    if (stats.sortedYears.length === 0) {
        html += `<div class="empty-colors-hint">暂无年代数据</div>`;
    }
    html += `</div>`;
    return html;
}

function renderSettingsPage() {
    const app = document.getElementById('app');
    const currentTheme = localStorage.getItem('app-theme') || '#1677ff';
    const customColors = getCustomColors();
    const allStats = computeStats();
    const stats = computeStats(ratingMode);

    let html = `<div class="settings-page">`;
    html += `<h2>我的</h2>`;

    // 收藏概况
    html += `<div class="settings-section">`;
    html += `<h3>收藏概况</h3>`;
    html += `<div class="stats-summary-cards">`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.total}</div><div class="stat-label">藏品总数</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.notesCount}</div><div class="stat-label">纸币</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.coinsCount}</div><div class="stat-label">硬币</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.prices.filter(p => !p.noPrice).length}</div><div class="stat-label">已记录价格</div></div>`;
    html += `</div>`;
    html += `</div>`;

    // 资金概况 + 价格列表
    html += `<div class="settings-section">`;
    html += `<h3>资金概况</h3>`;
    html += `<div class="stats-money">`;
    html += `<div class="money-row"><span class="money-label">总投入</span><span class="money-value">${allStats.totalPrice.toFixed(0)} 元</span></div>`;
    html += `<div class="money-row"><span class="money-label">均价</span><span class="money-value">${allStats.avgPrice} 元/件</span></div>`;
    html += `</div>`;

    html += `<div class="price-list-wrapper">`;
    html += `<div class="price-list-header" onclick="togglePriceList()">`;
    html += `<span>价格列表</span>`;
    html += `<div class="price-list-controls">`;
    html += `<select class="price-sort-select" id="priceSortSelect" onclick="event.stopPropagation()" onchange="onPriceSortOrFilterChange()">`;
    html += `<option value="default" selected>默认排序</option>`;
    html += `<option value="desc">从高到低</option>`;
    html += `<option value="asc">从低到高</option>`;
    html += `</select>`;
    html += `<select class="price-filter-select" id="priceFilterSelect" onclick="event.stopPropagation()" onchange="onPriceSortOrFilterChange()">`;
    html += `<option value="all">全部藏品</option>`;
    const filterCategories = buildPriceFilterCategories();
    for (const cat of filterCategories) {
        html += `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`;
    }
    html += `</select>`;
    html += `</div>`;
    html += `<span class="price-list-arrow" id="priceListArrow">▼</span>`;
    html += `</div>`;
    html += `<div class="price-list-summary" id="priceListSummary" style="display:none;"></div>`;
    html += `<div class="price-list-body" id="priceListBody">`;
    html += renderPriceListItems(allStats.prices, 'default', 'all', null);
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    // 评级分布
    html += `<div class="settings-section">`;
    html += `<div class="rating-section-header">`;
    html += `<div class="rating-tabs">`;
    html += `<span class="rating-tab ${ratingMode === 'notes' ? 'active' : ''}" data-mode="notes" onclick="switchRatingMode('notes')">纸币</span>`;
    html += `<span class="rating-tab ${ratingMode === 'coins' ? 'active' : ''}" data-mode="coins" onclick="switchRatingMode('coins')">硬币</span>`;
    html += `</div>`;
    html += `<h3>评级分布</h3>`;
    html += `</div>`;
    html += `<div id="ratingSection" style="transition: opacity 0.15s ease, transform 0.15s ease;">`;
    html += buildRatingHTML(stats);
    html += `</div>`;
    html += `</div>`;

    // 年代分布
    html += `<div class="settings-section">`;
    html += `<h3>年代分布</h3>`;
    html += `<div id="yearSection" style="transition: opacity 0.15s ease, transform 0.15s ease;">`;
    html += buildYearHTML(stats);
    html += `</div>`;
    html += `</div>`;

    // 主题色设置
    html += `<div class="settings-section">`;
    html += `<h3>主题色</h3>`;
    html += `<div class="theme-colors" id="settingsThemeColors">`;
    const presetColors = ['#1677ff', '#d92121', '#00b42a', '#ff7d00', '#722ed1'];
    for (const color of presetColors) {
        const active = color === currentTheme ? ' active' : '';
        html += `<div class="theme-color${active}" style="background:${color}" data-color="${color}"></div>`;
    }
    html += `</div>`;

    html += `<div class="saved-colors" id="savedColorsContainer">`;
    if (customColors.length === 0) {
        html += `<span class="empty-colors-hint">暂无自定义颜色</span>`;
    } else {
        for (let i = 0; i < customColors.length; i++) {
            const color = customColors[i];
            const active = color === currentTheme ? ' active' : '';
            html += `<div class="saved-color-item">`;
            html += `<div class="color-block${active}" style="background:${color}" data-color="${color}" onclick="setTheme('${color}'); updateSettingsPageTheme('${color}')"></div>`;
            html += `<button class="remove-color-btn" onclick="removeCustomColor(${i})">x</button>`;
            html += `</div>`;
        }
    }
    html += `</div>`;

    html += `<div class="custom-color-row">`;
    html += `<label for="settingsCustomColor">自定义颜色</label>`;
    html += `<input type="color" id="settingsCustomColor" value="${currentTheme}">`;
    html += `<button class="add-color-btn" onclick="addCurrentCustomColor()">添加</button>`;
    html += `</div>`;
    html += `</div>`;

    // ========== 数据导出 ==========
    html += `<div class="settings-section">`;
    html += `<h3>数据导出</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" onclick="exportJSON()">JSON 备份</button>`;
    html += `<button class="export-btn" onclick="exportCSV()">CSV 表格</button>`;
    html += `<button class="export-btn" onclick="exportMarkdown()">报告</button>`;
    html += `<button class="export-btn" onclick="exportPriceList()">价格清单</button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">点击按钮自动下载文件，可备份到本地或分享给藏友</p>`;
    html += `</div>`;

    html += `</div>`;
    app.innerHTML = html;

    document.querySelectorAll('#settingsThemeColors .theme-color').forEach(el => {
        el.addEventListener('click', function() {
            const color = this.dataset.color;
            updateSettingsPageTheme(color);
            if (typeof setTheme === 'function') setTheme(color);
        });
    });
}

function togglePriceList() {
    const body = document.getElementById('priceListBody');
    const arrow = document.getElementById('priceListArrow');
    if (!body || !arrow) return;
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

function updateSettingsPageTheme(color) {
    document.querySelectorAll('.theme-color, .color-block').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.color === color) {
            el.classList.add('active');
        }
    });
    const picker = document.getElementById('settingsCustomColor');
    if (picker) picker.value = color;
}

function addCurrentCustomColor() {
    const picker = document.getElementById('settingsCustomColor');
    if (!picker) return;
    const color = picker.value;
    addCustomColor(color);
    renderSettingsPage();
    if (typeof setTheme === 'function') setTheme(color);
}

function setupModalEvents() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    modal.addEventListener('click', function(e) {
        if (e.target === modal) closeModal();
    });
}

/* ==================== 数据导出 ==================== */

function exportJSON() {
    const allCopies = collectAllCopies();
    const stats = computeStats();
    const exportData = {
        exportDate: new Date().toISOString().split('T')[0],
        totalCount: allCopies.length,
        totalPrice: stats.totalPrice,
        items: allCopies.map(item => ({
            type: item.type === 'notes' ? '纸币' : '硬币',
            dataKey: item.dataKey,
            seriesName: item.seriesName,
            version: item.copy.version || '',
            year: item.copy.year || '',
            grade: item.copy.condition || item.copy.grade || '',
            gradingCompany: item.copy.gradingCompany || '',
            catalogNumber: item.copy.catalogNumber || item.copy.krause || '',
            price: item.copy.price || '',
            purchaseDate: item.copy.purchaseDate || '',
            material: item.copy.material || '',
            remark: item.copy.remark || ''
        }))
    };
    downloadFile(JSON.stringify(exportData, null, 2), 'coin-collection.json', 'application/json');
}

function exportCSV() {
    const allCopies = collectAllCopies();
    const headers = ['类型', '分类', '系列', '冠字号', '年份', '评级', '评级公司', '目录编号', '价格', '购买日期', '材质', '备注'];
    let csv = '\uFEFF' + headers.join(',') + '\n';
    for (const item of allCopies) {
        const c = item.copy;
        let catLabel = item.dataKey;
        if (item.type === 'notes') {
            for (const cat of categoryTree) {
                if (cat.children) { for (const sub of cat.children) { if (sub.dataKey === item.dataKey) catLabel = cat.name + ' - ' + sub.name; } }
                else if (cat.dataKey === item.dataKey) catLabel = cat.name;
            }
        } else {
            for (const cat of coinCategoryTree) { if (cat.dataKey === item.dataKey) catLabel = cat.name; }
        }
        const row = [
            item.type === 'notes' ? '纸币' : '硬币', catLabel, item.seriesName,
            c.version || '', c.year || '', c.condition || c.grade || '',
            c.gradingCompany || '', c.catalogNumber || c.krause || '',
            c.price || '', c.purchaseDate || '', c.material || '', c.remark || ''
        ].map(v => '"' + String(v).replace(/\\"/g, '""') + '"');
        csv += row.join(',') + '\n';
    }
    downloadFile(csv, 'coin-collection.csv', 'text/csv;charset=utf-8');
}

function exportMarkdown() {
    const allCopies = collectAllCopies();
    const stats = computeStats();
    let md = '# 收藏报告\n\n导出日期：' + new Date().toISOString().split('T')[0] + '\n\n';
    md += '## 总览\n\n- 藏品总数：' + allCopies.length + ' 件\n';
    md += '- 纸币：' + stats.notesCount + ' 件 | 硬币：' + stats.coinsCount + ' 件\n';
    md += '- 已记录价格：' + stats.prices.filter(p => !p.noPrice).length + ' 件\n';
    md += '- 总投入：' + stats.totalPrice.toFixed(0) + ' 元\n\n';
    const groups = {};
    for (const item of allCopies) {
        let catLabel = item.dataKey;
        if (item.type === 'notes') {
            for (const cat of categoryTree) {
                if (cat.children) { for (const sub of cat.children) { if (sub.dataKey === item.dataKey) catLabel = cat.name + ' - ' + sub.name; } }
                else if (cat.dataKey === item.dataKey) catLabel = cat.name;
            }
        } else {
            for (const cat of coinCategoryTree) { if (cat.dataKey === item.dataKey) catLabel = cat.name; }
        }
        if (!groups[catLabel]) groups[catLabel] = [];
        groups[catLabel].push(item);
    }
    md += '## 按分类统计\n\n';
    for (const [label, items] of Object.entries(groups)) {
        md += '### ' + label + '\n\n- 数量：' + items.length + ' 件\n';
        const total = items.reduce((s, i) => s + (parseFloat(i.copy.price) || 0), 0);
        if (total > 0) md += '- 小计：' + total.toFixed(0) + ' 元\n';
        md += '\n';
    }
    downloadFile(md, 'coin-collection-report.md', 'text/markdown;charset=utf-8');
}

function exportPriceList() {
    const stats = computeStats();
    const sorted = stats.prices.map((p, i) => ({ ...p, idx: i + 1 }))
        .sort((a, b) => (b.noPrice ? 0 : b.value) - (a.noPrice ? 0 : a.value));
    let text = '价格清单（从高到低）\n导出日期：' + new Date().toISOString().split('T')[0] + '\n\n';
    for (const p of sorted) {
        text += p.idx + '. ' + p.name + (p.version ? ' (' + p.version + ')' : '') + ' - ' + (p.noPrice ? '-' : p.value + ' 元') + '\n';
    }
    text += '\n合计：' + stats.totalPrice.toFixed(0) + ' 元 | 均价：' + stats.avgPrice + ' 元/件\n';
    downloadFile(text, 'coin-collection-price-list.txt', 'text/plain;charset=utf-8');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', function() {
    buildSpecialCategoryTree();
    renderSidebar();

    // ★ 让 .content 不滚动，由子容器负责滚动
    const contentEl = document.querySelector('.content');
    if (contentEl) {
        contentEl.style.overflow = 'hidden';
        contentEl.style.height = '100%';
    }

    // ★ 让 #app 也能独立滚动（articles/special/settings 使用）
    const appEl = document.getElementById('app');
    if (appEl) {
        appEl.style.height = '100%';
        appEl.style.overflowY = 'auto';
    }

    // ★ 切换到初始视图容器
    switchViewContainer(currentMode + '_' + currentView);
    renderOverview();

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => onTabClick(tab.dataset.target));
    });

    document.getElementById('searchBtn')?.addEventListener('click', doSearch);
    document.getElementById('resetBtn')?.addEventListener('click', resetSearch);
    document.getElementById('modeToggle')?.addEventListener('click', function() {
        if (currentMode === 'articles') {
            if (typeof toggleArticleSearchMode === 'function') {
                toggleArticleSearchMode();
            }
        } else {
            toggleSearchMode();
        }
    });

    document.getElementById('searchInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (currentMode === 'articles') {
                doSearch();
            // ★[MOD] 使用独立搜索模式判断
            } else if (getEffectiveSearchMode() === 'click') {
                doSearch();
            }
        }
    });

    // ★[MOD] 使用独立搜索模式绑定初始实时搜索
    if (getEffectiveSearchMode() === 'realtime') {
        document.getElementById('searchInput')?.addEventListener('input', doSearch);
    }

    setupModalEvents();
    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);

    if (typeof loadTheme === 'function') loadTheme();
});
