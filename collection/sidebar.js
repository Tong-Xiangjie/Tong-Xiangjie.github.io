// ==================== sidebar.js ====================

// 上一次 renderSidebar() 结束后，各子面板的展开态（"模式|面板序号" → true/false）。
// 空对象表示"还没渲染过"（首次渲染不做动画，避免首屏无谓地展开一下）。
// 这个映射是"重建 innerHTML"与"CSS 过渡"之间的桥梁，详见 syncSidebarAccordion()。
//
// ★ 必须按**模式**分区（key 前缀就是 currentMode）。原因：面板序号是它在该模式
//   侧边栏里的位置，而不同模式的分类数量互不相同（纸币 8 个子面板、文章 6 个、
//   专题 2 个）。共用一个命名空间的话，切版块时"新模式的第 N 个面板"会被拿去和
//   "旧模式的第 N 个面板"做差分，等于把上一个版块的展开状态套到这一个上 ——
//   实测症状就是用户报的"不同 tab 的侧边栏父类展开情况相互影响"。
let sidebarAccordionState = {};

// ★ Word式文字比例压缩：同时处理父级（.sidebar-item）和子级（.sidebar-child）
function fitSidebarLabels() {
    // 1. 父级分类（.sidebar-item）
    document.querySelectorAll('.sidebar-item').forEach(item => {
        const text = item.children[0]; // 第一个子元素是文字 span
        if (!text) return;

        const cs = getComputedStyle(item);
        const icon = item.querySelector('.expand-icon');
        const iconW = icon ? icon.offsetWidth : 0;
        const avail = item.clientWidth
            - (parseFloat(cs.paddingLeft) || 0)
            - (parseFloat(cs.paddingRight) || 0)
            - iconW
            - 4; // 与右侧图标间距

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

    // 2. 子分类（.sidebar-child），需匹配内部的 .child-text
    document.querySelectorAll('.sidebar-child').forEach(child => {
        const text = child.querySelector('.child-text');
        if (!text) return;

        const cs = getComputedStyle(child);
        const avail = child.clientWidth
            - (parseFloat(cs.paddingLeft) || 0)
            - (parseFloat(cs.paddingRight) || 0);

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
        // ★ 同步所有专题的分组（年份→年代、面额→面额、山河→跳过），保证每个有分组的都显示 ▸
        if (typeof syncSpecialGroupChildren === 'function') {
            const configs = getSpecialConfigs();
            for (const cfg of configs) {
                syncSpecialGroupChildren(cfg);
            }
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
                // ★ 子项文字用 .child-text 包裹以便压缩
                html += `<div class="sidebar-child ${subActive ? 'active' : ''}" onclick="onSidebarChildClick('${cat.id}', '${sub.id}'); event.stopPropagation();"><span class="child-text">${sub.name}</span></div>`;
            }
            html += `</div>`;
        }
    }
    sidebar.innerHTML = html;

    // ★ 让分类子面板的展开/收起真正走过渡（见函数注释）
    syncSidebarAccordion();

    // ★ 比例压缩（立即+延迟，覆盖过渡动画场景）
    fitSidebarLabelsDelayed();
}

// 切换一个分类子面板的展开态，并让它走过渡。
//
// ★ 为什么要量高度、而不是直接靠 CSS 的 max-height: 0 → 2000px：
//   2000px 相对真实内容（多数分类 100~420px）是个严重失真的上限，
//   过渡曲线前段就把可见部分长完了，后段全是空转 —— 实测 160px 高的面板
//   在 54ms（全程 23%）就长满，max-height 却还要爬到 2000px，
//   观感是"猛地弹出、然后拖尾"。
//   所以这里量出真实高度当区间；展开时用 inline max-height 驱动过渡，
//   结束后把 inline 样式清掉，交回 CSS 的 auto 语义（不再受任何上限约束）。
//
// ★ 量出面板内容的自然高度。不能直接用 scrollHeight：收起态（max-height:0）
//   下它返回 0，展开态下它又会被 CSS 的 2000px 上限掩盖真实意图。
//   把 max-height 设成 none 量一次 offsetHeight 才是准的 —— 同一个 tick 里
//   设完就读，中间没有绘制，用户看不到这一下。
function measureSidebarPanelHeight(panel) {
    const saved = panel.style.maxHeight;
    panel.style.maxHeight = 'none';
    const h = panel.offsetHeight;
    panel.style.maxHeight = saved;
    return h;
}

// 展开/收起一个分类子面板，带过渡。
//
// ★ 为什么量高度、而不是直接用 CSS 的 max-height: 0 → 2000px：
//   2000px 相对真实内容（多数分类 100~420px）是个严重失真的上限，
//   过渡曲线前段就把可见部分长完了，后段全是空转 —— 实测 160px 高的面板
//   在 54ms（全程 23%）就长满，max-height 却还要爬到 2000px，
//   观感是"猛地弹出、然后拖尾"。用真实高度当区间，可见变化才铺满整段过渡。
//
// ★ 过渡必须由 **class 上的 CSS transition** 驱动，不能在这两个 tick 里
//   碰 inline transition：混着改会把过渡状态搞乱、transitionend 不触发，
//   于是只能靠兜底定时器收尾，实际时长被拖长（实测 0.22s 的过渡跑成 246ms）。
function setSidebarPanelOpen(panel, open) {
    if (!panel) return;
    if (open === panel.classList.contains('open')) return;

    // ★ 尊重"减少动态效果"：直接切到终态，不量高度也不过渡。
    //   core.js 的 animateAccordion() 有这个判断，CSS 里 @media
    //   (prefers-reduced-motion) 只覆盖了 .switch/.switch-knob/.toggle-card，
    //   没管手风琴，所以这里必须自己判 —— 否则开了减少动效的用户照样看到动画。
    if (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) {
        panel.style.maxHeight = '';
        panel.classList.toggle('open', open);
        return;
    }

    const h = measureSidebarPanelHeight(panel);

    // 第一个 tick：把"变化前状态"落实成确切起点。
    // 起点必须是**长度值** —— length ↔ none 之间不可插值，一旦拿到 none
    // 就会直接跳变、过渡整个消失（收起侧实测过 0 个中间态）。
    panel.style.maxHeight = (open ? '0px' : h + 'px');

    requestAnimationFrame(function () {
        // 第二个 tick：加/去 class 并给出目标长度值，CSS 过渡随之生效
        if (open) panel.classList.add('open');
        else panel.classList.remove('open');
        panel.style.maxHeight = (open ? h + 'px' : '0px');

        if (!open) return;   // 收起的终态就是 0px，不必再收尾

        // 展开收尾：让 max-height 回到"不设上限"，免得内容以后变高被固定值裁掉。
        // 改值前先关掉过渡，否则计算值从内容高度回落到 CSS 的 2000px 又是一次
        // 可过渡的变化，会白白再空转一段（内容早就画完了）。
        const done = function () {
            panel.removeEventListener('transitionend', onEnd);
            clearTimeout(timer);
            if (!panel.classList.contains('open')) return;
            panel.style.transition = 'none';
            panel.style.maxHeight = 'none';
            void panel.offsetHeight;           // 把 none 落定为新的起始状态
            panel.style.transition = '';
        };
        const onEnd = function (e) {
            if (e.target === panel && e.propertyName === 'max-height') done();
        };
        panel.addEventListener('transitionend', onEnd);
        const timer = setTimeout(done, 400);   // 兜底：transitionend 没来也不卡住
    });
}

// 让侧边栏分类的子面板展开/收起带上过渡动画。
//
// 背景：renderSidebar() 每次都整体重建 innerHTML（它必须这么做 —— 要刷新
// .active），新面板**一出现就已经带着 .open**，CSS 里那条
// `transition: max-height` 永远等不到"从 0 到有"的过程，所以父类展开/关闭
// 一直是硬切、没有动画。
//
// 做法：拿"本次重建后的目标状态"和"上一次渲染结束时的状态"做差分，
// 只让**真的发生变化**的那些面板走过渡；没变化的面板保持终态直接渲染，
// 避免每次重建都无谓地动一下。
//
// 时序：先把变化前状态刷进 DOM，再在图下一帧切成目标状态。
// 不能在同一帧里两边都写 —— 浏览器会合并样式、看不到中间值，过渡不会触发。
function syncSidebarAccordion() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    // 展开态按模式分区，切版块时互不干扰（见 sidebarAccordionState 的注释）
    const scope = (typeof currentMode === 'string' && currentMode) ? currentMode : 'default';
    const prev = (sidebarAccordionState && typeof sidebarAccordionState === 'object')
        ? sidebarAccordionState[scope] : null;

    // ★ 子面板一律从 DOM 结构推导，不用 id、也不用解析 onclick。
    //   约定（各处渲染器都遵守）：分类项 .sidebar-item 后面紧跟着它的
    //   .sidebar-children 面板（没有子项时不渲染面板）。
    //   为什么不按 id 找：文章模式有自己的渲染器 renderArticleSidebar()，
    //   它生成的面板**没有 id**，靠 getElementById('children-'+catId) 会全部漏掉；
    //   而给文章面板补 id 又有撞名风险（两个渲染器各自命名空间独立，
    //   id 是全局的）。按兄弟关系推导则天然唯一，且各渲染器无需额外属性。
    //   注意：没有面板的分类项，nextElementSibling 会是下一个 .sidebar-item，需校验类名。
    const panels = [];
    sidebar.querySelectorAll('.sidebar-item').forEach(function (item) {
        const panel = item.nextElementSibling;
        if (!panel || !panel.classList.contains('sidebar-children')) return;   // 该分类没有子项
        // 用 DOM 中的出现序号当键：跨模式唯一（再叠加 scope 前缀），且不依赖分类 id 的命名。
        panels.push({ key: 'p' + panels.length, panel: panel, isOpen: panel.classList.contains('open') });
    });

    const next = {};
    const changes = [];
    panels.forEach(function (p) {
        const wasOpen = prev ? !!prev[p.key] : p.isOpen;   // 首次渲染：视为"本来就是目标态"
        if (wasOpen !== p.isOpen) changes.push(p);
        next[p.key] = p.isOpen;
    });

    if (changes.length) {
        // ① 回落到变化前状态（不要过渡，瞬时）
        changes.forEach(function (p) {
            p.panel.style.transition = 'none';
            p.panel.classList.toggle('open', !p.isOpen);
        });
        // ② 下一帧恢复过渡并切到目标状态
        requestAnimationFrame(function () {
            changes.forEach(function (p) {
                p.panel.style.transition = '';
                setSidebarPanelOpen(p.panel, p.isOpen);
            });
        });
    }

    if (!sidebarAccordionState || typeof sidebarAccordionState !== 'object') sidebarAccordionState = {};
    sidebarAccordionState[scope] = next;
}

function onSidebarItemClick(catId) {
    // ★ try/finally 统一收口写 URL（本函数有 5 个提前 return 分支）
    try {
        onSidebarItemClickInner(catId);
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function onSidebarItemClickInner(catId) {
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
    // ★ try/finally 统一收口写 URL（本函数有 4 个提前 return 分支）
    try {
        onSidebarChildClickInner(parentId, subId);
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function onSidebarChildClickInner(parentId, subId) {
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

// ★ 窗口大小变化时重新计算侧边栏文字比例
let sidebarResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(sidebarResizeTimer);
    sidebarResizeTimer = setTimeout(() => {
        if (typeof fitSidebarLabelsDelayed === 'function') {
            fitSidebarLabelsDelayed();
        }
    }, 200);
});