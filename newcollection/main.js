// ========== 状态管理 ==========
let currentMode = 'notes';       // 'notes' | 'coins'
let currentTab = 'notes';
let currentCategoryId = null;
let currentSubId = null;
let currentView = 'overview';
let searchMode = 'click';
let scrollMemory = {};
let isSettingsMode = false;
let settingsReturnState = null;
let isSidebarCollapsed = false;

// 存储各模式的状态（含展开状态）
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

// 弹窗状态
let hammerManager = null;
let currentScale = 1;
let currentX = 0;
let currentY = 0;
let currentModalImg1 = '';
let currentModalImg2 = '';

const KRAUSE_PREFIX = 'Pick# ';

// ========== 模式感知 getter ==========
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

// 收集当前展开状态
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

// 恢复展开状态
function restoreExpandedStates(states) {
    if (!states) return;

    requestAnimationFrame(() => {
        if (states.expandedSeries) {
            for (const id of states.expandedSeries) {
                const body = document.getElementById('body-' + id);
                const icon = document.getElementById('icon-' + id);
                if (body) {
                    body.classList.add('open');
                    if (icon) icon.classList.add('open');
                }
            }
        }

        if (states.expandedVarieties) {
            for (const id of states.expandedVarieties) {
                const list = document.getElementById('list-' + id);
                const icon = document.getElementById('icon-' + id);
                if (list) {
                    list.classList.add('open');
                    if (icon) icon.classList.add('open');
                }
            }
        }

        // 恢复滚动位置
        if (states.scrollY) {
            const content = document.querySelector('.content');
            if (content) content.scrollTop = states.scrollY;
        }
    });
}

// ========== 侧边栏折叠 ==========
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (!sidebar || !toggle) return;
    isSidebarCollapsed = !isSidebarCollapsed;
    sidebar.classList.toggle('collapsed', isSidebarCollapsed);
    toggle.textContent = isSidebarCollapsed ? '▶' : '◀';
    toggle.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
}

// ========== 侧边栏渲染 ==========
function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const tree = getCategoryTree();
    let html = '';
    for (const cat of tree) {
        const hasChildren = cat.children && cat.children.length > 0;
        const isActive = currentCategoryId === cat.id;
        const isExpanded = isActive && hasChildren;
        html += `<div class="sidebar-item ${isActive ? 'active' : ''}" data-cat-id="${cat.id}" onclick="onSidebarItemClick('${cat.id}')">`;
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

// ========== 侧边栏点击 ==========
function onSidebarItemClick(catId) {
    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === catId);
    if (!cat) return;

    // 再次点击已选中的项 -> 回到概览
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

// ========== 渲染当前分类 ==========
function renderCurrentCategory() {
    if (!currentCategoryId) {
        renderOverview();
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

// ========== Tab切换 ==========
function onTabClick(target) {
    if (target === 'settings') {
        // 保存当前模式的状态（含展开状态和滚动位置）
        if (!isSettingsMode) {
            const content = document.querySelector('.content');
            const scrollY = content ? content.scrollTop : 0;
            const expanded = collectExpandedStates();
            modeStates[currentMode] = {
                currentCategoryId,
                currentSubId,
                currentView,
                currentSearchKeyword: currentSearchKeyword || '',
                expandedSeries: expanded.expandedSeries,
                expandedVarieties: expanded.expandedVarieties,
                scrollY
            };
            settingsReturnState = { ...modeStates[currentMode], currentMode };
        }
        enterSettings();
        return;
    }

    if (target === 'special') {
        alert('暂未开放');
        return;
    }

    // 从设置页返回
    if (isSettingsMode) {
        isSettingsMode = false;
        document.querySelector('.body-row')?.classList.remove('settings-mode');
        if (settingsReturnState) {
            currentMode = settingsReturnState.currentMode || 'notes';
            currentCategoryId = settingsReturnState.currentCategoryId;
            currentSubId = settingsReturnState.currentSubId;
            currentView = settingsReturnState.currentView;
            currentSearchKeyword = settingsReturnState.currentSearchKeyword || '';
        }
        renderSidebar();
        if (currentView === 'overview') {
            renderOverview();
        } else {
            renderCurrentCategory();
            // 恢复展开状态
            if (settingsReturnState) {
                restoreExpandedStates({
                    expandedSeries: settingsReturnState.expandedSeries,
                    expandedVarieties: settingsReturnState.expandedVarieties,
                    scrollY: settingsReturnState.scrollY
                });
            }
        }
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${currentMode}"]`)?.classList.add('active');
        return;
    }

    // 切换 notes / coins
    if (target === 'notes' || target === 'coins') {
        // 保存当前模式的状态（含展开状态和滚动位置）
        const content = document.querySelector('.content');
        const scrollY = content ? content.scrollTop : 0;
        const expanded = collectExpandedStates();
        modeStates[currentMode] = {
            currentCategoryId,
            currentSubId,
            currentView,
            currentSearchKeyword: currentSearchKeyword || '',
            expandedSeries: expanded.expandedSeries,
            expandedVarieties: expanded.expandedVarieties,
            scrollY
        };

        // 切换到目标模式
        const newMode = target;
        currentMode = newMode;

        // 恢复目标模式的状态
        const saved = modeStates[newMode];
        currentCategoryId = saved.currentCategoryId;
        currentSubId = saved.currentSubId;
        currentView = saved.currentView;
        currentSearchKeyword = saved.currentSearchKeyword || '';

        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

        renderSidebar();
        if (currentView === 'overview') {
            renderOverview();
        } else if (currentView === 'category') {
            renderCurrentCategory();
            // 恢复展开状态
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

// ========== 设置页 ==========
function enterSettings() {
    isSettingsMode = true;
    document.querySelector('.body-row')?.classList.add('settings-mode');
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector('.tab-item[data-target="settings"]')?.classList.add('active');
    renderSettingsPage();
}

function renderSettingsPage() {
    const app = document.getElementById('app');
    const currentTheme = localStorage.getItem('app-theme') || '#1677ff';

    let html = `<div class="settings-page">`;
    html += `<h2>设置</h2>`;
    html += `<div class="settings-section">`;
    html += `<h3>主题色</h3>`;
    html += `<div class="theme-colors" id="settingsThemeColors">`;
    const colors = ['#1677ff', '#d92121', '#00b42a', '#ff7d00', '#722ed1'];
    for (const color of colors) {
        const active = color === currentTheme ? ' active' : '';
        html += `<div class="theme-color${active}" style="background:${color}" data-color="${color}"></div>`;
    }
    html += `</div>`;
    html += `<div class="custom-color-row">`;
    html += `<label for="settingsCustomColor">自定义颜色：</label>`;
    html += `<input type="color" id="settingsCustomColor" value="${currentTheme}">`;
    html += `</div>`;
    html += `</div></div>`;

    app.innerHTML = html;

    document.querySelectorAll('#settingsThemeColors .theme-color').forEach(el => {
        el.addEventListener('click', function() {
            const color = this.dataset.color;
            document.querySelectorAll('#settingsThemeColors .theme-color').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('settingsCustomColor').value = color;
            if (typeof setTheme === 'function') setTheme(color);
        });
    });
    document.getElementById('settingsCustomColor').addEventListener('input', function() {
        document.querySelectorAll('#settingsThemeColors .theme-color').forEach(c => c.classList.remove('active'));
        if (typeof setTheme === 'function') setTheme(this.value);
    });
}

// ========== 弹窗事件 ==========
function setupModalEvents() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeModal();
        }
    });
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', function() {
    renderSidebar();
    renderOverview();

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => onTabClick(tab.dataset.target));
    });

    document.getElementById('searchBtn')?.addEventListener('click', doSearch);
    document.getElementById('resetBtn')?.addEventListener('click', resetSearch);
    document.getElementById('modeToggle')?.addEventListener('click', toggleSearchMode);

    document.getElementById('searchInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (searchMode === 'click') doSearch();
        }
    });

    if (searchMode === 'realtime') {
        document.getElementById('searchInput')?.addEventListener('input', doSearch);
    }

    setupModalEvents();

    // 侧边栏折叠
    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);

    if (typeof loadTheme === 'function') loadTheme();
});
