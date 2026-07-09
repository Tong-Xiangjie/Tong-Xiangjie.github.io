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
    if (currentMode === MODE.SPECIAL) {
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
        currentCategoryId = null;
        currentSubId = null;
        currentView = VIEW.OVERVIEW;
        switchToCurrentContainer();
        renderSidebar();
        renderOverview();
        triggerViewAnimation();
        return;
    }

    currentCategoryId = catId;
    currentView = VIEW.CATEGORY;
    currentSubId = null;
    switchToCurrentContainer();
    renderSidebar();
    renderCurrentCategory();
    triggerViewAnimation();
}

function onSidebarChildClick(parentId, subId) {
    if (currentMode === MODE.SPECIAL) {
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
        currentView = VIEW.CATEGORY;
        switchToCurrentContainer();
        renderSidebar();
        renderCurrentCategory();
        triggerViewAnimation();
        return;
    }

    currentCategoryId = parentId;
    currentSubId = subId;
    currentView = VIEW.CATEGORY;
    switchToCurrentContainer();
    renderSidebar();
    renderCurrentCategory();
    triggerViewAnimation();
}
