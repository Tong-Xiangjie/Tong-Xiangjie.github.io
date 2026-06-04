// ========== 状态管理 ==========
let currentTab = 'notes';
let currentCategoryId = null;
let currentSubId = null;
let currentView = 'overview';
let searchMode = 'click';
let scrollMemory = {};
let isSettingsMode = false;
let settingsReturnState = null;

// 弹窗状态
let hammerManager = null;
let currentScale = 1;
let currentX = 0;
let currentY = 0;
let currentModalImg1 = '';
let currentModalImg2 = '';

const KRAUSE_PREFIX = 'Pick# ';

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
    if (content) scrollMemory[key] = content.scrollTop;
}

function restoreScroll(key) {
    if (scrollMemory[key] !== undefined) {
        requestAnimationFrame(() => {
            const content = document.querySelector('.content');
            if (content) content.scrollTop = scrollMemory[key];
        });
    }
}

// ========== 侧边栏渲染 ==========
function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    let html = '';
    for (const cat of categoryTree) {
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
    const cat = categoryTree.find(c => c.id === catId);
    if (!cat) return;

    if (currentCategoryId === catId && cat.children) {
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
    const cat = categoryTree.find(c => c.id === currentCategoryId);
    if (!cat) { renderOverview(); return; }

    let dataKey;
    if (currentSubId) {
        const subInfo = subCategoryMap[currentSubId];
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

    const subName = currentSubId ? (subCategoryMap[currentSubId]?.name || '') : '';
    const title = subName ? subName : (cat.name || '');
    renderSeriesList(data, title);
}

// ========== Tab切换 ==========
function onTabClick(target) {
    if (target === 'settings') {
        enterSettings();
        return;
    }
    if (target === 'coins' || target === 'special') {
        alert('暂未开放');
        return;
    }

    // 如果从设置回来
    if (isSettingsMode) {
        isSettingsMode = false;
        document.querySelector('.body-row')?.classList.remove('settings-mode');
        if (settingsReturnState) {
            currentCategoryId = settingsReturnState.currentCategoryId;
            currentSubId = settingsReturnState.currentSubId;
            currentView = settingsReturnState.currentView;
            currentSearchKeyword = settingsReturnState.currentSearchKeyword || '';
        }
    }

    currentTab = 'notes';
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

    if (currentView === 'search' && !currentSearchKeyword) {
        currentView = currentCategoryId ? 'category' : 'overview';
    }

    renderSidebar();
    if (currentView === 'overview') {
        renderOverview();
    } else if (currentView === 'category') {
        renderCurrentCategory();
    } else if (currentView === 'search') {
        // 保持搜索结果
    }
}

// ========== 设置页 ==========
function enterSettings() {
    // 保存返回状态
    settingsReturnState = {
        currentCategoryId: currentCategoryId,
        currentSubId: currentSubId,
        currentView: currentView,
        currentSearchKeyword: currentSearchKeyword || ''
    };

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
    html += `</div>`;
    html += `</div>`;

    app.innerHTML = html;

    // 绑定事件
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
        // 点击背景（modal本身）关闭
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

    if (typeof loadTheme === 'function') loadTheme();
});
