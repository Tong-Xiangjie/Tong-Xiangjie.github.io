// ========== 状态管理 ==========
let currentMode = 'notes';
let currentTab = 'notes';
let currentCategoryId = null;
let currentSubId = null;
let currentView = 'overview';
let searchMode = 'click';
let scrollMemory = {};
let isSettingsMode = false;
let settingsReturnState = null;
let isSidebarCollapsed = false;
let settingsPageCache = null;

// 专题状态
let selectedSpecial = null;
let specialPageCache = null;
let specialOverviewHintVisible = true;

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
    searchKeyword: ''
};

let hammerManager = null;
let currentScale = 1;
let currentX = 0;
let currentY = 0;
let currentModalImg1 = '';
let currentModalImg2 = '';

const KRAUSE_PREFIX = 'Pick# ';

// ========== 专题配置 ==========
const specialConfigs = [
    {
        id: 'years',
        name: '年份图鉴',
        desc: '按年份展示纸币实拍图片',
        dataKey: 'yearsData',
        imageBase: '../funcollection/years/',
        categories: [
            { id: 'all', name: '全部纸币', filter: null },
            { id: 'fec', name: '外汇兑换券', filter: function(item) { return item.name.includes('外汇兑换券'); } },
            { id: 'rmb2', name: '第二套人民币', filter: function(item) { return item.name.includes('第二套人民币'); } },
            { id: 'rmb3', name: '第三套人民币', filter: function(item) { return item.name.includes('第三套人民币'); } },
            { id: 'commemorative', name: '纪念钞', filter: function(item) { return item.name.includes('纪念钞') || item.name.includes('贺岁'); } },
            { id: 'war', name: '乌克兰战争纪念钞', filter: function(item) { return item.name.includes('俄乌战争'); } },
            { id: 'gkq', name: '国库券', filter: function(item) { return item.name.includes('国库券'); } },
            { id: 'republic', name: '民国纸币', filter: function(item) { return item.name.includes('交通银行') || item.name.includes('中国银行') || item.name.includes('中央银行') || item.name.includes('大洋票'); } }
        ]
    }
];

// 专题分类树（用于侧边栏渲染）
let specialCategoryTree = null;

function buildSpecialCategoryTree() {
    specialCategoryTree = [];
    for (const config of specialConfigs) {
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
        const config = specialConfigs.find(c => c.id === selectedSpecial);
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
    toggle.textContent = isSidebarCollapsed ? '▶' : '◀';
    toggle.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
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
            html += `<span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>`;
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

function onSidebarItemClick(catId) {
    // 专题模式
    if (currentMode === 'special') {
        if (selectedSpecial === catId) {
            // 点击已选中的专题 → 回到概览页（侧边栏重新展开铺满）
            selectedSpecial = null;
            currentCategoryId = null;
            currentSubId = null;
            renderSpecialOverview();
            return;
        }
        // 切换到其他专题
        selectedSpecial = catId;
        const config = specialConfigs.find(c => c.id === catId);
        if (config && config.categories && config.categories.length > 0) {
            currentCategoryId = catId;
            currentSubId = config.categories[0].id;
        } else {
            currentCategoryId = catId;
            currentSubId = null;
        }
        renderSidebar();
        renderSpecialContent();
        return;
    }

    // 纸币/硬币模式
    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === catId);
    if (!cat) return;

    if (currentCategoryId === catId) {
        currentCategoryId = null;
        currentSubId = null;
        currentView = 'overview';
        renderSidebar();
        renderOverview();
        return;
    }

    currentCategoryId = catId;
    currentView = 'category';

    if (cat.children) {
        currentSubId = cat.children[0].id;
    } else {
        currentSubId = null;
    }

    renderSidebar();
    renderCurrentCategory();
}

function onSidebarChildClick(parentId, subId) {
    // 专题模式
    if (currentMode === 'special') {
        selectedSpecial = parentId;
        currentCategoryId = parentId;
        currentSubId = subId;
        renderSidebar();
        renderSpecialContent();
        return;
    }

    currentCategoryId = parentId;
    currentSubId = subId;
    currentView = 'category';
    renderSidebar();
    renderCurrentCategory();
}

function renderCurrentCategory() {
    if (!currentCategoryId) { renderOverview(); return; }

    if (currentMode === 'special') {
        renderSpecialContent();
        return;
    }

    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === currentCategoryId);
    if (!cat) { renderOverview(); return; }

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
        // 专题模式和设置模式隐藏搜索栏
    } else {
        select.classList.remove('hidden');
        toggle.classList.remove('hidden');
        toggle.textContent = searchMode === 'click' ? '□' : '■';
        toggle.title = '切换搜索模式';
        tip.textContent = `当前模式：${searchMode === 'click' ? '点击搜索' : '实时搜索'} | 点击"□"可切换`;
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
                currentMode,
                currentCategoryId, currentSubId, currentView,
                currentSearchKeyword: currentSearchKeyword || ''
            };
        }
        enterSettings();
        return;
    }

    // ===== 专题 =====
    if (target === 'special') {
        // 离开其他模式时移除概览模式 class
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

        // 进入专题模式
        currentMode = 'special';
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector('.tab-item[data-target="special"]')?.classList.add('active');

        // 隐藏搜索栏
        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.add('hidden');

        // 从缓存恢复 selectedSpecial 和 currentSubId
        if (specialPageCache) {
            if (specialPageCache.selectedSpecial !== undefined) {
                selectedSpecial = specialPageCache.selectedSpecial;
            }
            if (specialPageCache.currentSubId !== undefined) {
                currentSubId = specialPageCache.currentSubId;
            }
            if (selectedSpecial !== null && specialPageCache.innerHTML) {
                // 恢复内容页
                document.querySelector('.body-row')?.classList.remove('special-overview-mode');
                const toggleBtn = document.getElementById('sidebarToggle');
                if (toggleBtn) toggleBtn.style.display = '';
                currentCategoryId = selectedSpecial;
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
            if (settingsReturnState) {
                currentSearchKeyword = settingsReturnState.currentSearchKeyword || '';
            }
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
        // 离开专题模式时移除概览模式 class
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');

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
        // 离开专题模式时移除概览模式 class
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');

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

function enterSettings() {
    isSettingsMode = true;
    currentSearchKeyword = '';
    articleSearchKeyword = '';

    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    document.querySelector('.body-row')?.classList.add('settings-mode');
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="settings"]')?.classList.add('active');

    if (settingsPageCache) {
        document.getElementById('app').innerHTML = settingsPageCache.innerHTML;
        document.querySelectorAll('#settingsThemeColors .theme-color').forEach(el => {
            el.addEventListener('click', function() {
                const color = this.dataset.color;
                updateSettingsPageTheme(color);
                if (typeof setTheme === 'function') setTheme(color);
            });
        });
        requestAnimationFrame(() => {
            const content = document.querySelector('.content');
            if (content && settingsPageCache.scrollY) {
                content.scrollTop = settingsPageCache.scrollY;
            }
        });
    } else {
        renderSettingsPage();
    }
}

/* ==================== 专题功能 ==================== */

function renderSpecialOverview() {
    const app = document.getElementById('app');
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');

    // 添加概览模式 class → 侧边栏展开铺满 + 内容区隐藏
    document.querySelector('.body-row')?.classList.add('special-overview-mode');

    // 隐藏折叠按钮
    if (toggleBtn) toggleBtn.style.display = 'none';

    // 渲染侧边栏：只显示专题名称，无子分类
    let html = '';
    for (const config of specialConfigs) {
        const isActive = selectedSpecial === config.id;
        html += `<div class="sidebar-item ${isActive ? 'active' : ''}" onclick="onSpecialOverviewItemClick('${config.id}')">`;
        html += `<span>${escapeHtml(config.name)}</span>`;
        html += `</div>`;
    }
    sidebar.innerHTML = html;

    // 内容区显示提示信息（带动画）
    specialOverviewHintVisible = true;
    app.innerHTML = '<div class="special-overview-hint" id="specialOverviewHint">选择一个专题开始浏览</div>';
}

function onSpecialOverviewItemClick(specialId) {
    selectedSpecial = specialId;

    // 移除概览模式 → 侧边栏收缩 + 内容区出现
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    // 恢复折叠按钮
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) toggleBtn.style.display = '';

    // 提示语淡出
    specialOverviewHintVisible = false;
    const hint = document.getElementById('specialOverviewHint');
    if (hint) {
        hint.style.opacity = '0';
        hint.style.transform = 'translateY(-10px)';
    }

    // 默认选中第一个子分类
    const config = specialConfigs.find(c => c.id === specialId);
    if (config && config.categories && config.categories.length > 0) {
        currentCategoryId = specialId;
        currentSubId = config.categories[0].id;
    } else {
        currentCategoryId = specialId;
        currentSubId = null;
    }

    renderSidebar();
    renderSpecialContent();
}

function renderSpecialContent() {
    if (!selectedSpecial) {
        renderSpecialOverview();
        return;
    }

    const config = specialConfigs.find(c => c.id === selectedSpecial);
    if (!config) { renderSpecialOverview(); return; }

    const data = getData(config.dataKey);
    if (!data || data.length === 0) {
        document.getElementById('app').innerHTML = '<div class="empty-state">暂无数据</div>';
        return;
    }

    // 根据 currentSubId 筛选
    let filteredData = data;
    if (currentSubId && currentSubId !== 'all') {
        const catConfig = config.categories.find(c => c.id === currentSubId);
        if (catConfig && catConfig.filter) {
            filteredData = data.filter(catConfig.filter);
        }
    }

    const imgBase = config.imageBase;

    // 按年份分组
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
    requestAnimationFrame(() => {
        const app = document.getElementById('app');
        app.classList.remove('content-enter');
        void app.offsetWidth;
        app.classList.add('content-enter');
    });
}

// 专题大图弹窗（复用主站弹窗）
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

/* ==================== 统计功能 ==================== */

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
                                seriesName: series.seriesName + ' - ' + variety.varietyName
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allCopies.push({
                            copy: series.copies[ci],
                            seriesName: series.seriesName
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
                                seriesName: series.seriesName + ' - ' + variety.varietyName
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allCopies.push({
                            copy: series.copies[ci],
                            seriesName: series.seriesName
                        });
                    }
                }
            }
        }
    }

    return allCopies;
}

function computeStats() {
    const allCopies = collectAllCopies();
    const total = allCopies.length;

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
    for (const item of allCopies) {
        const ps = item.copy.price;
        if (ps) {
            const num = parseFloat(ps.replace(/[^0-9.]/g, ''));
            if (!isNaN(num) && num > 0) {
                prices.push({ value: num, name: item.seriesName, version: item.copy.version || '' });
            } else {
                prices.push({ value: -1, name: item.seriesName, version: item.copy.version || '', noPrice: true });
            }
        } else {
            prices.push({ value: -1, name: item.seriesName, version: item.copy.version || '', noPrice: true });
        }
    }
    const totalPrice = prices.reduce((s, p) => s + (p.noPrice ? 0 : p.value), 0);
    const pricedItems = prices.filter(p => !p.noPrice);
    const avgPrice = pricedItems.length > 0 ? Math.round(totalPrice / pricedItems.length) : 0;

    const gradeCounts = {};
    let ungraded = 0;
    for (const item of allCopies) {
        const cond = item.copy.condition || item.copy.grade || '';
        const match = cond.match(/(\d+)/);
        if (match) {
            const g = match[1];
            gradeCounts[g] = (gradeCounts[g] || 0) + 1;
        } else {
            ungraded++;
        }
    }
    const sortedGrades = Object.entries(gradeCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    const yearCounts = {};
    for (const item of allCopies) {
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

/* ==================== 设置页 ==================== */

function renderSettingsPage() {
    const app = document.getElementById('app');
    const currentTheme = localStorage.getItem('app-theme') || '#1677ff';
    const customColors = getCustomColors();
    const stats = computeStats();

    let html = `<div class="settings-page">`;
    html += `<h2>我的</h2>`;

    html += `<div class="settings-section">`;
    html += `<h3>收藏概况</h3>`;
    html += `<div class="stats-summary-cards">`;
    html += `<div class="stat-card"><div class="stat-num">${stats.total}</div><div class="stat-label">藏品总数</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${stats.notesCount}</div><div class="stat-label">纸币</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${stats.coinsCount}</div><div class="stat-label">硬币</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${stats.prices.filter(p => !p.noPrice).length}</div><div class="stat-label">已记录价格</div></div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>资金概况</h3>`;
    html += `<div class="stats-money">`;
    html += `<div class="money-row"><span class="money-label">总投入</span><span class="money-value">${stats.totalPrice.toFixed(0)} 元</span></div>`;
    html += `<div class="money-row"><span class="money-label">均价</span><span class="money-value">${stats.avgPrice} 元/件</span></div>`;
    html += `</div>`;

    html += `<div class="price-list-wrapper">`;
    html += `<div class="price-list-header" onclick="togglePriceList()">`;
    html += `<span>价格列表</span>`;
    html += `<select class="price-sort-select" onclick="event.stopPropagation()" onchange="changePriceSort(this.value)">`;
    html += `<option value="desc">从高到低</option>`;
    html += `<option value="asc">从低到高</option>`;
    html += `</select>`;
    html += `<span class="price-list-arrow" id="priceListArrow">▼</span>`;
    html += `</div>`;
    html += `<div class="price-list-body" id="priceListBody">`;
    html += renderPriceListItems(stats.prices, 'desc');
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>评级分布</h3>`;
    html += `<div class="stats-bars">`;
    const maxGradeCount = stats.sortedGrades.length > 0
        ? Math.max(...stats.sortedGrades.map(g => g[1]), stats.ungraded)
        : 1;
    for (const [grade, count] of stats.sortedGrades) {
        const pct = (count / maxGradeCount * 100).toFixed(0);
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">${grade} 分</span>`;
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
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>年代分布</h3>`;
    html += `<div class="stats-bars">`;
    const maxYearCount = stats.sortedYears.length > 0
        ? Math.max(...stats.sortedYears.map(y => y[1]))
        : 1;
    for (const [decade, count] of stats.sortedYears) {
        const pct = (count / maxYearCount * 100).toFixed(0);
        const label = decade.slice(0, -1) + '年代';
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">${label}</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill year" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${count} 件</span>`;
        html += `</div>`;
    }
    if (stats.sortedYears.length === 0) {
        html += `<div class="empty-colors-hint">暂无年代数据</div>`;
    }
    html += `</div>`;
    html += `</div>`;

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

function renderPriceListItems(prices, order) {
    const sorted = [...prices].sort((a, b) => {
        if (order === 'desc') return b.value - a.value;
        else return a.value - b.value;
    });

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
    return html;
}

function togglePriceList() {
    const body = document.getElementById('priceListBody');
    const arrow = document.getElementById('priceListArrow');
    if (!body || !arrow) return;
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

function changePriceSort(order) {
    const body = document.getElementById('priceListBody');
    if (!body) return;
    const stats = computeStats();
    body.innerHTML = renderPriceListItems(stats.prices, order);
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

document.addEventListener('DOMContentLoaded', function() {
    buildSpecialCategoryTree();
    renderSidebar();
    renderOverview();

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => onTabClick(tab.dataset.target));
    });

    document.getElementById('searchBtn')?.addEventListener('click', doSearch);
    document.getElementById('resetBtn')?.addEventListener('click', resetSearch);
    document.getElementById('modeToggle')?.addEventListener('click', function() {
        if (currentMode === 'articles') {
            toggleArticleSearchMode();
        } else {
            toggleSearchMode();
        }
    });

    document.getElementById('searchInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (currentMode === 'articles') {
                doSearch();
            } else if (searchMode === 'click') {
                doSearch();
            }
        }
    });

    if (searchMode === 'realtime') {
        document.getElementById('searchInput')?.addEventListener('input', doSearch);
    }

    setupModalEvents();
    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);

    if (typeof loadTheme === 'function') loadTheme();
});
