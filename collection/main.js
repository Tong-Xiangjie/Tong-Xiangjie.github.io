// ==================== main.js ====================
// 精简版：初始化与事件绑定

document.addEventListener('DOMContentLoaded', async function() {
    // ★ 数据加载提示（含进度条 + 当前文件）
    const loadingApp = document.getElementById('app');
    if (loadingApp) {
        loadingApp.innerHTML =
            '<div class="data-loading">' +
            '<div class="data-loading-text">数据正火速赶来中，请稍候ε=ε=(ノ≧∇≦)ノ</div>' +
            '<div class="data-loading-file" id="dataLoadingFile">正在准备…</div>' +
            '<div class="data-loading-bar"><div class="data-loading-fill" id="dataLoadingFill"></div></div>' +
            '</div>';
    }

    // ★ 进度更新函数：显示当前文件名 + 百分比
    function updateLoadingProgress(p) {
        const fileEl = document.getElementById('dataLoadingFile');
        const fillEl = document.getElementById('dataLoadingFill');
        if (fileEl) {
            const name = p.current ? p.current.split('/').pop() : '';
            const pct = p.total ? Math.round(p.loaded / p.total * 100) : 0;
            fileEl.textContent = p.current
                ? `正在加载 ${name} · ${pct}%（${p.loaded}/${p.total}）`
                : '全部就绪';
        }
        if (fillEl) {
            const pct = p.total ? Math.round(p.loaded / p.total * 100) : 0;
            fillEl.style.width = pct + '%';
        }
    }

    // ★ 等待所有数据文件加载并桥接（传入进度回调）
    try {
        if (typeof loadAllData === 'function') await loadAllData(updateLoadingProgress);
    } catch (e) {
        const appEl0 = document.getElementById('app');
        if (appEl0) appEl0.innerHTML = '<div class="empty-state">数据加载失败：' + escapeHtml(e.message) + '</div>';
        return;
    }

    // ★ 加载完成后清空 #app，防止加载提示残留
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
