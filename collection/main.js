// ==================== main.js ====================
// 精简版：初始化与事件绑定

// ★ OCR-B（冠号字体）提前置为 loaded —— 只靠 head 里的 <link rel=preload as=font> 不够：
//   preload 只解决"字节什么时候到"，**不解决"第一次用到它时的异步重排"**。
//   元素第一次需要这个字体时，浏览器仍会先按回退字体排一次版、拿到字体后再重排一次；
//   这一次重排就是用户报的"总是会跳一下"（逐帧实测：冠号宽度 99.15→103.89px、
//   92.74→98.16px，即 +4.7~5.4px）。这里在卡片渲染之前按 family 主动 load 一次，
//   把 FontFace 状态提前变成 loaded，元素第一次排版就用真字体，全程零位移。
//   ★ 为什么写在这里而不是 head 的内联脚本里：@font-face 在 layout.css 中，
//     head 里那条内联脚本运行时 CSSOM 里还没有这条规则，document.fonts.load()
//     会立刻以空数组 resolve（等于没做）。本文件是 </body> 前的外链经典脚本，
//     执行时阻塞样式表（layout.css）必然已加载完 —— 规则一定在。
//   ★ 时机：这里 t≈110ms 就跑完，而卡片要等 72 个数据文件加载完（t≈1.2s）才渲染，
//     所以字体必然先就绪；失败也只是退回 layout.css 的 font-display: block 兜底。
(function () {
    function kickOcrbFont() {
        try {
            if (document.fonts && document.fonts.load) document.fonts.load('1em "OCRB10PitchBT-Regular"');
        } catch (e) { /* 老浏览器 / 隐私模式：忽略 */ }
    }
    kickOcrbFont();
    // 兜底：万一 layout.css 还没进 CSSOM（本文件是经典外链脚本，理论上不会），
    // 等它 load 事件再补一次。
    var l = document.querySelector('link[href$="layout.css"]');
    if (l && !l.sheet) l.addEventListener('load', kickOcrbFont, { once: true });
})();

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

        // ★ 深链接：数据与首屏都就绪后再应用 URL 里的路由（顺序很重要 ——
        //   数据没加载完时 applyRoute 会读到空的 DATA_MAP）。
        if (typeof applyInitialRoute === 'function') applyInitialRoute();
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

    // ★ 深链接：初始化路由（注册 popstate / hashchange 监听，并把初始状态写进地址栏）
    if (typeof initRouter === 'function') initRouter();

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
        document.getElementById('searchInput')?.addEventListener('input', onSearchInput);
    }

    setupModalEvents();
    setupImageRetry();
    setupImageFadeIn();
    // ★ 实测底部 Tab 栏高度写入 --tabbar-h（弹窗图片盒子靠它停在 Tab 栏之上）。
    //   放在这里而不是 revealContent 里：Tab 栏是静态 DOM，此刻已可测量，
    //   而且要在任何一次 openModal 之前完成。
    setupTabbarMetrics();

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