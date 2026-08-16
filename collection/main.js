// ==================== main.js ====================
// 精简版：仅初始化与事件绑定

document.addEventListener('DOMContentLoaded', async function() {
    // 数据加载中提示
    const loadingApp = document.getElementById('app');
    if (loadingApp) {
        loadingApp.innerHTML = '<div class="data-loading">数据正火速赶来中，请稍候ε=ε=(ノ≧∇≦)ノ</div>';
    }

    // 等待所有数据文件加载并桥接
    try {
        if (typeof loadAllData === 'function') await loadAllData();
    } catch (e) {
        const appEl0 = document.getElementById('app');
        if (appEl0) appEl0.innerHTML = '<div class="empty-state">数据加载失败：' + escapeHtml(e.message) + '</div>';
        return;
    }

    // ★ 加载完成后清空 #app，防止加载提示残留（后续渲染会填充）
    const appEl = document.getElementById('app');
    if (appEl) appEl.innerHTML = '';

    buildSpecialCategoryTree();
    renderSidebar();

    const contentEl = document.querySelector('.content');
    if (contentEl) {
        contentEl.style.overflow = 'hidden';
        contentEl.style.height = '100%';
    }

    if (appEl) {
        appEl.style.height = '100%';
        appEl.style.overflowY = 'auto';
    }

    switchToCurrentContainer();
    renderOverview();
    updateSearchUIForMode();

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => onTabClick(tab.dataset.target));
    });

    document.getElementById('searchBtn')?.addEventListener('click', doSearch);
    document.getElementById('resetBtn')?.addEventListener('click', resetSearch);
    document.getElementById('modeToggle')?.addEventListener('click', function() {
        if (currentMode === MODE.ARTICLES) {
            if (typeof toggleArticleSearchMode === 'function') toggleArticleSearchMode();
        } else {
            toggleSearchMode();
        }
    });

    document.getElementById('searchInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (currentMode === MODE.ARTICLES) { doSearch(); }
            else if (getEffectiveSearchMode() === SEARCH_MODE.CLICK) { doSearch(); }
        }
    });

    if (getEffectiveSearchMode() === SEARCH_MODE.REALTIME) {
        document.getElementById('searchInput')?.addEventListener('input', doSearch);
    }

    setupModalEvents();
    setupImageRetry();

    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);
    const st = document.getElementById('sidebarToggle');
    if (st) { st.textContent = '☰'; st.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'; }

    if (typeof loadTheme === 'function') loadTheme();
});
