// ========== 状态管理 ==========
let currentTab = 'notes';
let currentCategoryId = null;
let currentSubId = null;
let currentView = 'overview';
let searchMode = 'click';
let scrollMemory = {};

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

    // 如果点击已展开的父级 -> 折叠，回到概览
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
        toggleThemeModal();
        return;
    }
    if (target === 'coins' || target === 'special') {
        alert('暂未开放');
        return;
    }
    currentTab = 'notes';
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

    if (currentView === 'search') return;
    currentCategoryId = null;
    currentSubId = null;
    currentView = 'overview';
    renderSidebar();
    renderOverview();
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

    document.getElementById('imageModal')?.addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });

    if (typeof loadTheme === 'function') loadTheme();
});
