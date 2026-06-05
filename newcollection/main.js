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

function getCategoryTree() {
    return currentMode === 'notes' ? categoryTree : coinCategoryTree;
}

function getImageBase() {
    return currentMode === 'notes' ? IMAGE_BASE : COIN_IMAGE_BASE;
}

function getAllDataKeys() {
    return currentMode === 'notes' ? allDataKeys : coinAllDataKeys;
}

function getData(dataKey) {
    if (currentMode === 'notes') {
        return window.DATA_MAP && window.DATA_MAP[dataKey] ? window.DATA_MAP[dataKey] : null;
    } else {
        return window.COIN_DATA_MAP && window.COIN_DATA_MAP[dataKey] ? window.COIN_DATA_MAP[dataKey] : null;
    }
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

    const tree = getCategoryTree();
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
    currentCategoryId = parentId;
    currentSubId = subId;
    currentView = 'category';
    renderSidebar();
    renderCurrentCategory();
}

function renderCurrentCategory() {
    if (!currentCategoryId) { renderOverview(); return; }
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
    } else {
        select.classList.remove('hidden');
        toggle.classList.remove('hidden');
        toggle.textContent = searchMode === 'click' ? '□' : '■';
        toggle.title = '切换搜索模式';
        tip.textContent = `当前模式：${searchMode === 'click' ? '点击搜索' : '实时搜索'} | 点击"□"可切换`;
    }
}

function onTabClick(target) {
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

    if (target === 'special') {
        alert('暂未开放');
        return;
    }

    if (isSettingsMode) {
        isSettingsMode = false;

        // 显示搜索栏
        const searchContainer = document.querySelector('.top-search-container');
        if (searchContainer) searchContainer.classList.remove('hidden');

        document.querySelector('.body-row')?.classList.remove('settings-mode');

        // 根据目标 Tab 切换模式
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
            // 恢复之前保存的状态，但切换到目标模式
            if (settingsReturnState) {
                // 从之前保存的状态中恢复非模式相关的信息
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

        // 如果点了其他未知 target，恢复之前模式
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

    if (target === 'articles') {
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

        updateSearchUIForMode();
        renderSidebar();
        if (currentArticleView === 'list') renderArticleList();
        else openArticleReader(currentArticleIndex);
        return;
    }

    if (target === 'notes' || target === 'coins') {
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

    // 隐藏搜索栏（带动画）
    const searchContainer = document.querySelector('.top-search-container');
    if (searchContainer) searchContainer.classList.add('hidden');

    document.querySelector('.body-row')?.classList.add('settings-mode');
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="settings"]')?.classList.add('active');
    renderSettingsPage();
}

function renderSettingsPage() {
    const app = document.getElementById('app');
    const currentTheme = localStorage.getItem('app-theme') || '#1677ff';
    const customColors = getCustomColors();

    let html = `<div class="settings-page">`;
    html += `<h2>设置</h2>`;

    // 预设主题色
    html += `<div class="settings-section">`;
    html += `<h3>主题色</h3>`;
    html += `<div class="theme-colors" id="settingsThemeColors">`;
    const presetColors = ['#1677ff', '#d92121', '#00b42a', '#ff7d00', '#722ed1'];
    for (const color of presetColors) {
        const active = color === currentTheme ? ' active' : '';
        html += `<div class="theme-color${active}" style="background:${color}" data-color="${color}"></div>`;
    }
    html += `</div>`;

    // 已保存的自定义颜色
    html += `<div class="saved-colors" id="savedColorsContainer">`;
    if (customColors.length === 0) {
        html += `<span class="empty-colors-hint">暂无自定义颜色</span>`;
    } else {
        for (let i = 0; i < customColors.length; i++) {
            const color = customColors[i];
            const active = color === currentTheme ? ' active' : '';
            html += `<div class="saved-color-item">`;
            html += `<div class="color-block${active}" style="background:${color}" data-color="${color}" onclick="setTheme('${color}'); updateSettingsPageTheme('${color}')"></div>`;
            html += `<button class="remove-color-btn" onclick="removeCustomColor(${i})">✕</button>`;
            html += `</div>`;
        }
    }
    html += `</div>`;

    // 自定义颜色添加
    html += `<div class="custom-color-row">`;
    html += `<label for="settingsCustomColor">自定义颜色：</label>`;
    html += `<input type="color" id="settingsCustomColor" value="${currentTheme}">`;
    html += `<button class="add-color-btn" onclick="addCurrentCustomColor()">添加</button>`;
    html += `</div>`;
    html += `</div>`;

    html += `</div>`;
    app.innerHTML = html;

    // 绑定预设颜色点击
    document.querySelectorAll('#settingsThemeColors .theme-color').forEach(el => {
        el.addEventListener('click', function() {
            const color = this.dataset.color;
            updateSettingsPageTheme(color);
            if (typeof setTheme === 'function') setTheme(color);
        });
    });

    // 绑定自定义颜色输入
    document.getElementById('settingsCustomColor').addEventListener('input', function() {
        // 实时预览但不保存
    });
}

function updateSettingsPageTheme(color) {
    // 更新所有选中状态
    document.querySelectorAll('.theme-color, .color-block').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.color === color) {
            el.classList.add('active');
        }
    });
    // 更新颜色选择器的值
    const picker = document.getElementById('settingsCustomColor');
    if (picker) picker.value = color;
}

function addCurrentCustomColor() {
    const picker = document.getElementById('settingsCustomColor');
    if (!picker) return;
    const color = picker.value;
    addCustomColor(color);
    // 重新渲染设置页
    renderSettingsPage();
    // 应用颜色
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
