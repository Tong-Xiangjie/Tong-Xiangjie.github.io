// ==================== main.js ====================
// 精简版：初始化与事件绑定

document.addEventListener('DOMContentLoaded', async function() {
    const loadingContainer = document.getElementById('loadingContainer');
    const appEl = document.getElementById('app');

    // ★ 进度更新函数
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

    // ★ 等待所有数据文件加载
    try {
        if (typeof loadAllData === 'function') await loadAllData(updateLoadingProgress);
    } catch (e) {
        loadingContainer.innerHTML = '<div class="empty-state">数据加载失败：' + escapeHtml(e.message) + '</div>';
        return;
    }

    // ★ 加载完成：进度条先淡出，再渲染并让内容淡入（不再硬切）
    function revealContent() {
        loadingContainer.style.display = 'none';
        appEl.style.display = 'block';
        appEl.innerHTML = '';

        // 初始化
        buildSpecialCategoryTree();
        renderSidebar();

        const contentEl = document.querySelector('.content');
        if (contentEl) {
            contentEl.style.overflow = 'hidden';
            contentEl.style.height = '100%';
        }

        appEl.style.height = '100%';
        appEl.style.overflowY = 'auto';

        switchToCurrentContainer();
        renderOverview();
        updateSearchUIForMode();

        // 首屏也走一次进入动画（renderOverview 自身不触发）
        triggerViewAnimation();
        // 首屏里"插入时就已加载完"的图需要补标，否则会一直保持透明
        requestAnimationFrame(sweepLoadedImages);
    }

    if (prefersReducedMotion()) {
        revealContent();
    } else {
        let revealed = false;
        const once = function () { if (revealed) return; revealed = true; revealContent(); };
        loadingContainer.classList.add('loading-fade-out');
        loadingContainer.addEventListener('animationend', once, { once: true });
        setTimeout(once, 320);   // 兜底：动画被打断时也要继续，绝不能卡在加载页
    }

    // 事件绑定
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
    setupImageFadeIn();

    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);
    const st = document.getElementById('sidebarToggle');
    if (st) { st.textContent = '☰'; st.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'; }

    if (typeof loadTheme === 'function') loadTheme();

    if (typeof watchSidebarFit === 'function') watchSidebarFit();

    // ★ 初始化特殊字符面板
    if (typeof initSymbolPicker === 'function') {
        initSymbolPicker();
    }
});