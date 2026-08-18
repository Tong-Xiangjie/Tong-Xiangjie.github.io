// ==================== sidebar.js ====================

// ★ Word式文字比例压缩：超长横向压扁，不省略、不换行、字号不变
function fitSidebarLabels() {
    document.querySelectorAll('.sidebar-item').forEach(item => {
        const text = item.children[0];
        if (!text) return;

        const cs = getComputedStyle(item);
        const icon = item.querySelector('.expand-icon');
        const iconW = icon ? icon.offsetWidth : 0;
        const avail = item.clientWidth
            - (parseFloat(cs.paddingLeft) || 0)
            - (parseFloat(cs.paddingRight) || 0)
            - iconW
            - 4;

        // ★ 宽度不可用（折叠过渡中≈0）时直接跳过，保留旧压缩状态，不清 transform
        if (avail <= 0) return;

        text.style.transform = '';
        text.style.overflow = 'visible';
        const full = text.scrollWidth;

        if (full > avail) {
            const ratio = avail / full;
            text.style.transformOrigin = 'left center';
            text.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
        }
    });
}

// ★ 立即 + 等宽度过渡结束再各算一次（覆盖折叠/切换页面等所有场景）
function fitSidebarLabelsDelayed() {
    if (typeof fitSidebarLabels !== 'function') return;
    fitSidebarLabels();
    setTimeout(fitSidebarLabels, 350);
}

// ★ 侧边栏宽度变化（折叠/展开/从隐藏状态进入）时自动重新做文字比例压缩
function watchSidebarFit() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (window.__sidebarFitRO) window.__sidebarFitRO.disconnect();
    const ro = new ResizeObserver(() => {
        if (typeof fitSidebarLabels === 'function') fitSidebarLabels();
    });
    ro.observe(sidebar);
    window.__sidebarFitRO = ro;
}

function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    if (currentMode === MODE.ARTICLES) {
        renderArticleSidebar();
        return;
    }

    let tree;
    if (currentMode === MODE.SPECIAL) {
        // ★ 渲染前同步分组，保证任何入口进来侧边栏都是数据驱动的年代/面额
        if (typeof syncSpecialGroupChildren === 'function') {
            const cfg = getSpecialConfigs().find(c => c.id === selectedSpecial);
            if (cfg) syncSpecialGroupChildren(cfg);
        }
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

    // ★ 比例压缩（立即+延迟，覆盖过渡动画场景）
    fitSidebarLabelsDelayed();
}

function onSidebarItemClick(catId) {
    // ★ 专题模式
    if (currentMode === MODE.SPECIAL) {
        if (selectedSpecial === catId) {
            // 点击已选中的专题：返回概览
            selectedSpecial = null;
            currentCategoryId = null;
            currentSubId = null;
            renderSpecialOverview();
            return;
        }
        // 选中专题，清除年代筛选
        selectedSpecial = catId;
        currentCategoryId = catId;
        currentSubId = null;
        renderSidebar();
        renderSpecialContent();
        applySpecialLayout();      // ★ 从侧边栏进入河山也强制全屏
        triggerViewAnimation();
        return;
    }

    // ★ 纸币/硬币模式
    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === catId);
    if (!cat) return;

    if (currentCategoryId === catId) {
        // 点击已选中的分类：返回概览
        currentCategoryId = null;
        currentSubId = null;
        currentView = VIEW.OVERVIEW;
        // 清理所有容器
        for (const k of Object.keys(viewScrollContainers)) {
            viewScrollContainers[k].style.display = 'none';
            viewScrollContainers[k].innerHTML = '';
        }
        const appEl = document.getElementById('app');
        if (appEl) { appEl.style.display = 'none'; appEl.innerHTML = ''; }
        switchToCurrentContainer();
        renderSidebar();
        renderOverview();
        triggerViewAnimation();
        return;
    }

    // 进入分类
    currentCategoryId = catId;
    currentView = VIEW.CATEGORY;
    currentSubId = null;
    // 清理所有容器
    for (const k of Object.keys(viewScrollContainers)) {
        viewScrollContainers[k].style.display = 'none';
        viewScrollContainers[k].innerHTML = '';
    }
    const appEl = document.getElementById('app');
    if (appEl) { appEl.style.display = 'none'; appEl.innerHTML = ''; }
    switchToCurrentContainer();
    renderSidebar();
    renderCurrentCategory();
    triggerViewAnimation();
}

function onSidebarChildClick(parentId, subId) {
    // ★ 专题模式（按年代筛选）
    if (currentMode === MODE.SPECIAL) {
        if (currentSubId === subId) {
            // 点击已选中的年代：取消筛选，显示全部
            currentSubId = null;
            currentCategoryId = parentId;
            renderSidebar();
            renderSpecialContent();
            triggerViewAnimation();
            return;
        }
        // 选中年代
        selectedSpecial = parentId;
        currentCategoryId = parentId;
        currentSubId = subId;
        renderSidebar();
        renderSpecialContent();
        triggerViewAnimation();
        return;
    }

    // ★ 纸币/硬币子分类
    if (currentSubId === subId) {
        // 点击已选中的子分类：返回父分类
        currentSubId = null;
        currentCategoryId = parentId;
        currentView = VIEW.CATEGORY;
        // 清理所有容器
        for (const k of Object.keys(viewScrollContainers)) {
            viewScrollContainers[k].style.display = 'none';
            viewScrollContainers[k].innerHTML = '';
        }
        const appEl = document.getElementById('app');
        if (appEl) { appEl.style.display = 'none'; appEl.innerHTML = ''; }
        switchToCurrentContainer();
        renderSidebar();
        renderCurrentCategory();
        triggerViewAnimation();
        return;
    }

    // 进入子分类
    currentCategoryId = parentId;
    currentSubId = subId;
    currentView = VIEW.CATEGORY;
    // 清理所有容器
    for (const k of Object.keys(viewScrollContainers)) {
        viewScrollContainers[k].style.display = 'none';
        viewScrollContainers[k].innerHTML = '';
    }
    const appEl = document.getElementById('app');
    if (appEl) { appEl.style.display = 'none'; appEl.innerHTML = ''; }
    switchToCurrentContainer();
    renderSidebar();
    renderCurrentCategory();
    triggerViewAnimation();
}

// ★ 窗口大小变化时重新计算侧边栏文字比例（延迟版，RO 也会触发，但保留作为备用）
let sidebarResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(sidebarResizeTimer);
    sidebarResizeTimer = setTimeout(() => {
        if (typeof fitSidebarLabelsDelayed === 'function') {
            fitSidebarLabelsDelayed();
        }
    }, 200);
});
