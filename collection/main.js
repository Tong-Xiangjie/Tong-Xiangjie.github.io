// ==================== main.js ====================
// 精简版，仅初始化与事件绑定

document.addEventListener('DOMContentLoaded', function() {
    buildSpecialCategoryTree();
    renderSidebar();

    const contentEl = document.querySelector('.content');
    if (contentEl) {
        contentEl.style.overflow = 'hidden';
        contentEl.style.height = '100%';
    }

    const appEl = document.getElementById('app');
    if (appEl) {
        appEl.style.height = '100%';
        appEl.style.overflowY = 'auto';
    }

    switchViewContainer(currentMode + '_' + currentView);
    renderOverview();

    updateSearchUIForMode();

    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.addEventListener('click', () => onTabClick(tab.dataset.target));
    });

    document.getElementById('searchBtn')?.addEventListener('click', doSearch);
    document.getElementById('resetBtn')?.addEventListener('click', resetSearch);
    document.getElementById('modeToggle')?.addEventListener('click', function() {
        if (currentMode === MODE.ARTICLES) {
            if (typeof toggleArticleSearchMode === 'function') {
                toggleArticleSearchMode();
            }
        } else {
            toggleSearchMode();
        }
    });

    document.getElementById('searchInput')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            if (currentMode === MODE.ARTICLES) {
                doSearch();
            } else if (getEffectiveSearchMode() === SEARCH_MODE.CLICK) {
                doSearch();
            }
        }
    });

    if (getEffectiveSearchMode() === SEARCH_MODE.REALTIME) {
        document.getElementById('searchInput')?.addEventListener('input', doSearch);
    }

    setupModalEvents();
    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);
    const st = document.getElementById('sidebarToggle');
    if (st) {
        st.textContent = '☰';
        st.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
    }

    if (typeof loadTheme === 'function') loadTheme();
});
