// ========== 状态管理 ==========
let currentMode = 'notes';
let currentTab = 'notes';
let currentCategoryId = null;
let currentSubId = null;
let currentView = 'overview';
let searchMode = 'realtime';
let scrollMemory = {};
let isSettingsMode = false;
let settingsReturnState = null;
let isSidebarCollapsed = false;
let settingsPageCache = null;

// 专题状态
let selectedSpecial = null;
let specialPageCache = null;

// 评级切换状态
let ratingMode = 'notes';

let modeStates = {
    notes: {
        currentCategoryId: null,
        currentSubId: null,
        currentView: 'overview',
        currentSearchKeyword: '',
        expandedSeries: [],
        expandedVarieties: [],
        scrollY: 0
    },
    coins: {
        currentCategoryId: null,
        currentSubId: null,
        currentView: 'overview',
        currentSearchKeyword: '',
        expandedSeries: [],
        expandedVarieties: [],
        scrollY: 0
    }
};

let articleState = {
    currentView: 'list',
    currentCategory: 'all',
    currentIndex: -1,
    searchKeyword: '',
    scrollY: 0
};

let hammerManager = null;
let currentScale = 1;
let currentX = 0;
let currentY = 0;
let currentModalImg1 = '';
let currentModalImg2 = '';

const KRAUSE_PREFIX = 'Pick# ';

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
    requestAnimationFrame(() => {
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
        if (states.scrollY) {
            const content = document.querySelector('.content');
            if (content) content.scrollTop = states.scrollY;
        }
    });
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (!sidebar || !toggle) return;
    isSidebarCollapsed = !isSidebarCollapsed;
    sidebar.classList.toggle('collapsed', isSidebarCollapsed);
    toggle.textContent = isSidebarCollapsed ? '▸' : '◂';
    toggle.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
}

/** 恢复侧边栏折叠状态（离开专题后调用） */
function restoreSidebarState() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (sidebar) {
        sidebar.classList.toggle('collapsed', isSidebarCollapsed);
    }
    if (toggle) {
        toggle.textContent = isSidebarCollapsed ? '▸' : '◂';
        toggle.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
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

/* ===== 滚动到顶部 ===== */
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
        renderSidebar();
        renderOverview();
        scrollToTop();
        return;
    }

    currentCategoryId = catId;
    currentView = 'category';

    if (cat.children) {
        currentSubId = null;
    } else {
        currentSubId = null;
    }

    renderSidebar();
    renderCurrentCategory();
    scrollToTop();
}

/* ===== onSidebarChildClick 支持取消选中 ===== */
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
        renderSidebar();
        renderCurrentCategory();
        scrollToTop();
        return;
    }

    currentCategoryId = parentId;
    currentSubId = subId;
    currentView = 'category';
    renderSidebar();
    renderCurrentCategory();
    scrollToTop();
}

/* ===== renderCurrentCategory 增加父分类概览列表 ===== */
function renderCurrentCategory() {
    if (!currentCategoryId) { renderOverview(); return; }

    if (currentMode === 'special') {
        renderSpecialContent();
        return;
    }

    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === currentCategoryId);
    if (!cat) { renderOverview(); return; }

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

    if (!dataKey) { renderOverview(); return; }

    const data = getData(dataKey);
    if (!data) {
        document.getElementById('app').innerHTML = '<div class="empty-state">暂无数据</div>';
        return;
    }

    const subName = currentSubId ? (subMap[currentSubId]?.name || '') : '';
    const title = subName ? subName : (cat.name || '');
    renderSeriesList(data, title);
}

/* ===== 父分类概览列表 ===== */
function renderCategoryOverview(cat) {
    const app = document.getElementById('app');
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
    requestAnimationFrame(() => {
        app.classList.remove('content-enter');
        void app.offsetWidth;
        app.classList.add('content-enter');
    });
}

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
        // 专题和设置模式隐藏搜索栏
    } else {
        select.classList.remove('hidden');
        toggle.classList.remove('hidden');
        toggle.textContent = searchMode === 'click' ? '□' : '■';
        toggle.title = '切换搜索模式';
        tip.textContent = `当前模式：${searchMode === 'click' ? '点击搜索' : '实时搜索'} | 点击"${searchMode === 'click' ? '□' : '■'}"可切换`;
    }
}

function onTabClick(target) {
    // ===== 设置（"我的"） =====
    if (target === 'settings') {
        if (!isSettingsMode) {
            if (currentMode === 'articles') {
                articleState = {
                    currentView: currentArticleView,
                    currentCategory: currentArticleCategory,
                    currentIndex: currentArticleIndex,
                    searchKeyword: articleSearchKeyword
                };
            } else if (currentMode === 'notes' || currentMode === 'coins') {
                const content = document.querySelector('.content');
                const scrollY = content ? content.scrollTop : 0;
                const expanded = collectExpandedStates();
                modeStates[currentMode] = {
                    currentCategoryId, currentSubId, currentView,
                    currentSearchKeyword: currentSearchKeyword || '',
                    expandedSeries: expanded.expandedSeries,
                    expandedVarieties: expanded.expandedVarieties,
                    scrollY
                };
            } else if (currentMode === 'special') {
                const appEl = document.getElementById('app');
                const contentEl = document.querySelector('.content');
                specialPageCache = {
                    innerHTML: appEl ? appEl.innerHTML : '',
                    scrollY: contentEl ? contentEl.scrollTop : 0,
                    selectedSpecial: selectedSpecial,
                    currentSubId: currentSubId
                };
            }
            settingsReturnState = {
                currentMode: currentMode,
                currentCategoryId: currentCategoryId,
                currentSubId: currentSubId,
                currentView: currentView,
                currentSearchKeyword: currentSearchKeyword || '',
                selectedSpecial: selectedSpecial
            };
        }
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
        } else if (currentMode === 'notes' || currentMode === 'coins') {
            const content = document.querySelector('.content');
            const scrollY = content ? content.scrollTop : 0;
            const expanded = collectExpandedStates();
            modeStates[currentMode] = {
                currentCategoryId, currentSubId, currentView,
                currentSearchKeyword: currentSearchKeyword || '',
                expandedSeries: expanded.expandedSeries,
                expandedVarieties: expanded.expandedVarieties,
                scrollY
            };
        } else if (currentMode === 'articles') {
            articleState = {
                currentView: currentArticleView,
                currentCategory: currentArticleCategory,
                currentIndex: currentArticleIndex,
                searchKeyword: articleSearchKeyword
            };
        }

        currentMode = 'special';
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');

        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.add('hidden');

        if (specialPageCache && specialPageCache.selectedSpecial !== null && specialPageCache.selectedSpecial !== undefined) {
            selectedSpecial = specialPageCache.selectedSpecial;
            currentSubId = specialPageCache.currentSubId || null;
            currentCategoryId = selectedSpecial;
            document.querySelector('.body-row')?.classList.remove('special-overview-mode');
            const toggleBtn = document.getElementById('sidebarToggle');
            if (toggleBtn) toggleBtn.style.display = '';
            document.getElementById('app').innerHTML = specialPageCache.innerHTML;
            renderSidebar();
            requestAnimationFrame(() => {
                const content = document.querySelector('.content');
                if (content && specialPageCache.scrollY) {
                    content.scrollTop = specialPageCache.scrollY;
                }
            });
        } else {
            renderSpecialOverview();
        }
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
        // 恢复侧边栏折叠状态
        restoreSidebarState();

        if (target === 'articles') {
            currentMode = 'articles';
            currentArticleView = articleState.currentView;
            currentArticleCategory = articleState.currentCategory;
            currentArticleIndex = articleState.currentIndex;
            articleSearchKeyword = articleState.searchKeyword;
            if (collectedArticles.length === 0) collectAllArticles();
            searchMode = 'realtime';
            const si = document.getElementById('searchInput');
            if (si) {
                si.removeEventListener('input', doSearch);
                si.addEventListener('input', doSearch);
                // 没有搜索关键词时清空输入框
                if (!articleSearchKeyword) si.value = '';
            }
            updateSearchUIForMode();
            renderSidebar();
            if (currentArticleView === 'list') renderArticleList();
            else openArticleReader(currentArticleIndex);
            document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
            document.querySelector(`.tab-item[data-target="articles"]`)?.classList.add('active');
            return;
        }

        if (target === 'notes' || target === 'coins') {
            currentMode = target;
            const saved = modeStates[target];
            currentCategoryId = saved.currentCategoryId;
            currentSubId = saved.currentSubId;
            currentView = saved.currentView;
            currentSearchKeyword = saved.currentSearchKeyword || '';

            if (searchMode === 'realtime') {
                const inp = document.getElementById('searchInput');
                if (inp) {
                    inp.removeEventListener('input', doSearch);
                    inp.addEventListener('input', doSearch);
                    if (!currentSearchKeyword) inp.value = '';
                }
            }

            updateSearchUIForMode();
            renderSidebar();
            if (currentView === 'overview') {
                renderOverview();
            } else if (currentView === 'category') {
                renderCurrentCategory();
                restoreExpandedStates({
                    expandedSeries: saved.expandedSeries,
                    expandedVarieties: saved.expandedVarieties,
                    scrollY: saved.scrollY
                });
            } else if (currentView === 'search') {
                if (currentSearchKeyword) {
                    performSearchAndRender(currentSearchKeyword, currentSearchType);
                } else {
                    currentView = 'overview';
                    renderOverview();
                }
            }
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
            
            if (settingsReturnState && settingsReturnState.selectedSpecial) {
                selectedSpecial = settingsReturnState.selectedSpecial;
                currentCategoryId = settingsReturnState.selectedSpecial;
                currentSubId = settingsReturnState.currentSubId;
                renderSidebar();
                renderSpecialContent();
            } else {
                renderSpecialOverview();
            }
            return;
        }

        if (settingsReturnState) {
            currentMode = settingsReturnState.currentMode || 'notes';
            currentCategoryId = settingsReturnState.currentCategoryId;
            currentSubId = settingsReturnState.currentSubId;
            currentView = settingsReturnState.currentView;
            currentSearchKeyword = settingsReturnState.currentSearchKeyword || '';
        }
        updateSearchUIForMode();
        renderSidebar();
        if (currentView === 'overview') renderOverview();
        else renderCurrentCategory();
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
        // 恢复侧边栏折叠状态
        restoreSidebarState();

        if (currentMode === 'notes' || currentMode === 'coins') {
            const content = document.querySelector('.content');
            const scrollY = content ? content.scrollTop : 0;
            const expanded = collectExpandedStates();
            modeStates[currentMode] = {
                currentCategoryId, currentSubId, currentView,
                currentSearchKeyword: currentSearchKeyword || '',
                expandedSeries: expanded.expandedSeries,
                expandedVarieties: expanded.expandedVarieties,
                scrollY
            };
        } else if (currentMode === 'special') {
            const appEl = document.getElementById('app');
            const contentEl = document.querySelector('.content');
            specialPageCache = {
                innerHTML: appEl ? appEl.innerHTML : '',
                scrollY: contentEl ? contentEl.scrollTop : 0,
                selectedSpecial: selectedSpecial,
                currentSubId: currentSubId
            };
        }

        currentMode = 'articles';
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

        if (collectedArticles.length === 0) collectAllArticles();

        currentArticleView = articleState.currentView;
        currentArticleCategory = articleState.currentCategory;
        currentArticleIndex = articleState.currentIndex;
        articleSearchKeyword = articleState.searchKeyword;

        searchMode = 'realtime';
        const si = document.getElementById('searchInput');
        if (si) {
            si.removeEventListener('input', doSearch);
            si.addEventListener('input', doSearch);
            if (!articleSearchKeyword) si.value = '';
        }

        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.remove('hidden');

        updateSearchUIForMode();
        renderSidebar();
        if (currentArticleView === 'list') renderArticleList();
        else openArticleReader(currentArticleIndex);
        return;
    }

    // ===== 纸币/硬币 =====
    if (target === 'notes' || target === 'coins') {
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn && toggleBtn.style.display === 'none') {
            toggleBtn.style.display = '';
        }
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');
        // 恢复侧边栏折叠状态
        restoreSidebarState();

        if (currentMode === 'articles') {
            articleState = {
                currentView: currentArticleView,
                currentCategory: currentArticleCategory,
                currentIndex: currentArticleIndex,
                searchKeyword: articleSearchKeyword
            };
        } else if (currentMode === 'notes' || currentMode === 'coins') {
            const content = document.querySelector('.content');
            const scrollY = content ? content.scrollTop : 0;
            const expanded = collectExpandedStates();
            modeStates[currentMode] = {
                currentCategoryId, currentSubId, currentView,
                currentSearchKeyword: currentSearchKeyword || '',
                expandedSeries: expanded.expandedSeries,
                expandedVarieties: expanded.expandedVarieties,
                scrollY
            };
        } else if (currentMode === 'special') {
            const appEl = document.getElementById('app');
            const contentEl = document.querySelector('.content');
            specialPageCache = {
                innerHTML: appEl ? appEl.innerHTML : '',
                scrollY: contentEl ? contentEl.scrollTop : 0,
                selectedSpecial: selectedSpecial,
                currentSubId: currentSubId
            };
        }

        const newMode = target;
        currentMode = newMode;

        const saved = modeStates[newMode];
        currentCategoryId = saved.currentCategoryId;
        currentSubId = saved.currentSubId;
        currentView = saved.currentView;
        currentSearchKeyword = saved.currentSearchKeyword || '';

        if (searchMode === 'realtime') {
            const inp = document.getElementById('searchInput');
            if (inp) {
                inp.removeEventListener('input', doSearch);
                inp.addEventListener('input', doSearch);
                // 没有搜索关键词时清空输入框
                if (!currentSearchKeyword) inp.value = '';
            }
        }

        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.remove('hidden');

        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

        updateSearchUIForMode();
        renderSidebar();
        if (currentView === 'overview') {
            renderOverview();
        } else if (currentView === 'category') {
            renderCurrentCategory();
            restoreExpandedStates({
                expandedSeries: saved.expandedSeries,
                expandedVarieties: saved.expandedVarieties,
                scrollY: saved.scrollY
            });
        } else if (currentView === 'search') {
            if (currentSearchKeyword) {
                performSearchAndRender(currentSearchKeyword, currentSearchType);
            } else {
                currentView = 'overview';
                renderOverview();
            }
        }
        return;
    }
}

// ...（后面的 enterSettings、专题功能、统计、设置、数据导出等所有函数保持原样不变）

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
    
    const appEl = document.getElementById('app');
    const contentEl = document.querySelector('.content');
    if (appEl && contentEl) {
        settingsPageCache = {
            innerHTML: appEl.innerHTML,
            scrollY: contentEl.scrollTop
        };
    }
}
