// ========== 状态管理 ==========
let currentTab = 'notes';
let currentCategoryId = null;   // 当前选中的一级分类 id
let currentSubId = null;        // 当前选中的子分类 id
let currentView = 'overview';   // 'overview' | 'category' | 'search'
let searchMode = 'click';       // 'click' | 'realtime'
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

function countCopies(data) {
    if (!data || !data.series) return 0;
    let total = 0;
    for (const s of data.series) {
        if (s.varieties) {
            for (const v of s.varieties) {
                total += v.copies ? v.copies.length : 0;
            }
        } else {
            total += s.copies ? s.copies.length : 0;
        }
    }
    return total;
}

function sumPrice(data) {
    // 简单解析价格中的数字部分
    let total = 0;
    if (!data || !data.series) return 0;
    for (const s of data.series) {
        const copies = s.varieties
            ? s.varieties.flatMap(v => v.copies || [])
            : (s.copies || []);
        for (const c of copies) {
            if (c.price) {
                const num = parseFloat(String(c.price).replace(/[^0-9.]/g, ''));
                if (!isNaN(num)) total += num;
            }
        }
    }
    return total;
}

function getData(dataKey) {
    return window[dataKey] || null;
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

// ========== 侧边栏点击事件 ==========
function onSidebarItemClick(catId) {
    const cat = categoryTree.find(c => c.id === catId);
    if (!cat) return;

    if (currentCategoryId === catId && cat.children) {
        // 点击已展开的父级 -> 折叠，回到概览
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
        // 有子分类：选中第一个
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

    const subName = currentSubId ? subCategoryMap[currentSubId]?.name : cat.name;
    renderSeriesList(data, subName || data.name);
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
    // 切换到纸币Tab
    currentTab = 'notes';
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab-item[data-target="${target}"]`)?.classList.add('active');

    if (currentView === 'search') return; // 搜索结果保留
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

    // Tab事件
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => onTabClick(tab.dataset.target));
    });

    // 搜索事件
    document.getElementById('searchBtn')?.addEventListener('click', doSearch);
    document.getElementById('resetBtn')?.addEventListener('click', resetSearch);
    document.getElementById('modeToggle')?.addEventListener('click', toggleSearchMode);

    // 回车搜索
    document.getElementById('searchInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (searchMode === 'click') doSearch();
            // realtime 模式已在输入时触发
        }
    });

    // 实时搜索
    if (searchMode === 'realtime') {
        document.getElementById('searchInput')?.addEventListener('input', doSearch);
    }

    // 弹窗点击背景关闭
    document.getElementById('imageModal')?.addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });

    // 加载主题
    if (typeof loadTheme === 'function') loadTheme();
});
