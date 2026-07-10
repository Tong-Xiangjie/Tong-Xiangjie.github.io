// ==================== sidebar.js ====================

function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    if (currentMode === MODE.ARTICLES) {
        renderArticleSidebar();
        return;
    }

    let tree;
    if (currentMode === MODE.SPECIAL) {
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
