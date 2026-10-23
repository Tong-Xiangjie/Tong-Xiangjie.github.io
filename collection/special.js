// ==================== special.js ====================
// 专题

let specialItemsList = [];
let specialCurrentIndex = -1;
let shanheProvinceNames = {};
let shanheMapCache = null;

// 「网格画质」这类全局设置改动后会调 invalidateRenderedViews() 清空视图容器，
// 但山河地图的节点被缓存在 shanheMapCache 里复用 —— 不清掉它，下次会把旧节点
// （里面是旧的 img src）原样塞回容器。
function dropShanheMapCache() { shanheMapCache = null; }
let shanheViewMode = 'map';

// ★ 时间轴排序状态
let timelineSortOrder = 'desc';
let timelineFilterYear = '全部';
let timelineFilterMonth = '全部';

// ==================== 冷启动：搜索栏必须在**第一次绘制之前**就收起 ====================
// 起因（用户 2026 反复反馈、桌面 1920 必现）：直接打开 / 刷新 `#special/timeline` 时，
//   「年份 / 月份」两排按键会在时间线渲染出来的那一刻**整体向下滑一次**（网格上边缘下移），
//   然后停在最终位置不回弹 —— 正是用户说的"数字沉降"。
//
// 真凶**不在热力图里**，而是上面那条搜索栏：
//   `.app-layout` 是 `flex-direction: column`，`.top-search-container` 排在 `.body-row` 之前，
//   所以搜索栏的高度**直接决定** `.body-row`（进而整张热力图）的纵坐标。
//   静态 HTML 里搜索栏是"展开"的（`.top-search-container` 没有 `hidden`，高约 70px），
//   router 要到数据加载完、首屏渲染后才按 URL 给它加 `hidden`，于是触发一次
//   `max-height / padding / opacity` 的 `--dur-3`(0.3s) 过渡。
//   实测时序（1920x1080 冷启动，逐帧采样）：
//     t=557.9ms  router 给搜索栏加 `hidden`（加载遮罩刚开始淡出）
//     t=561.6ms  过渡开始
//     t=746.2ms  时间线渲染 ⇒ 热力图**第一次出现**，此刻搜索栏才收到 54.2px
//     t=870.8ms  过渡结束（搜索栏只剩 1px 的 border-bottom）
//   ⇒ 热力图的**文档绝对 top** 在 198.25 → 145 之间滑了 **53.25px**。
//   1440x900 / 1366x768 之所以"看起来没事"：那两个宽度下过渡在渲染点之前已经走完，
//   热力图全程只有一个绝对 top 取值；1920 宽下搜索栏起始 70px 高，0.3s 过渡正好压在渲染点上。
//
// 为什么不能在 HTML 里写死 `hidden`：本站无服务端，HTML 是静态的，收不收起来只有 router
//   读了 URL 才知道。所以这里在**解析期**（早于任何元素首次绘制）按 URL 一次性打上
//   `html[data-hm-cold]`，由 `layout.css` 把它 `display: none` 掉（`max-height` 过渡的
//   中间值仍参与布局，只有 `display: none` 能保证第一帧就零高度）。
//
// ★ 只对"专题深链接"打这个标记：
//    · `#special/...`：正是会出问题的路径；
//    · 站内点进来的路径上搜索栏**早已收起**，本来就没有这一帧，打不打都一样；
//    · 普通首页 / 认不出的 hash：一律不打 ⇒ 首页搜索栏**分毫不动**。
// ★ 属性随后会被摘掉（见下面的 rAF）：那一刻 router 已经加上了 `hidden` 类，此后由类
//   接管，所以"从专题返回普通板块时搜索栏滑出来"的动画完全没变。
(function markHmColdIfSpecialDeepLink() {
    try {
        const h = String(location.hash || '');
        if (!/^#special\//.test(h)) return;      // 不是专题深链接 ⇒ 什么都不做
        document.documentElement.setAttribute('data-hm-cold', '1');
    } catch (e) { /* 读不到 hash 也不该影响任何功能 */ }
})();
// 摘掉标记：**必须等 router 真的把 `hidden` 类加上**，不能简单地推几帧 ——
// router 是在"数据加载完 → `#app` 揭示 → 渲染首屏"时才加类（实测 t=557.9ms），
// 而解析期的 rAF 在 t≈70ms 就跑了：那会儿摘掉等于没修。
// 这里用 MutationObserver 精确等那个时刻，然后**同步**摘掉并强制一次样式重算：
//   `display: none`（来自标记）与 `max-height: 0`（来自 `hidden` 类）对布局的效果一致
//   （都是零高度、且 `.body-row` 的纵坐标相同），所以这次交接不会有任何跳动；
//   同一个任务里 `getComputedStyle` 读一下再强行 `display` 一次，是为了让浏览器
//   在**本帧**就把新样式应用掉，不留下"两套规则谁生效"的中间帧。
(function clearHmColdAfterRouterAppliedHidden() {
    try {
        const root = document.documentElement;
        if (!root.hasAttribute('data-hm-cold')) return;
        const sc = document.querySelector('.top-search-container');
        const done = function () {
            try { obs.disconnect(); } catch (e) { }
            root.removeAttribute('data-hm-cold');
            if (sc) { void sc.getBoundingClientRect().height; }   // 强制样式重算，本帧生效
        };
        const hasHidden = function () { return !!(sc && sc.classList.contains('hidden')); };
        if (hasHidden()) { done(); return; }
        const obs = new MutationObserver(function () { if (hasHidden()) done(); });
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true });
        // ★ 兜底：万一因为别的原因 `hidden` 一直没被加上（例如将来改了 router 的写法），
        //   也绝不能把搜索栏永久藏起来 —— 3s 后无条件摘掉标记并放弃。
        setTimeout(function () { try { obs.disconnect(); } catch (e) { } root.removeAttribute('data-hm-cold'); }, 3000);
    } catch (e) { /* 观察器不可用也不能影响功能 */ }
})();

const SHANHE_LABEL_OFFSETS = {
    hebei: 10
};

let shanheListRO = null;
let shanheListLastCols = 0;

// ========== 面额排序 ==========
const DENOM_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1/3, '⅔': 2/3 };

function denomSortValue(s) {
    s = String(s || '').trim();
    if (!s) return [99, 0, ''];

    let num = NaN;
    const numMatch = s.match(/\d+(?:\.\d+)?/);
    if (numMatch) {
        num = parseFloat(numMatch[0]);
        const after = s.substring(numMatch[0].length);
        const fm = after.match(/[½¼¾⅓⅔]/);
        if (fm) num += DENOM_FRACTIONS[fm[0]];
    } else {
        const fm = s.match(/[½¼¾⅓⅔]/);
        if (fm) num = DENOM_FRACTIONS[fm[0]];
    }
    if (isNaN(num)) num = 0;

    let unit = '';
    const uMatch = s.match(/([^\d\s½¼¾⅓⅔.]+)$/);
    if (uMatch) unit = uMatch[1];

    let prio = 6;
    if (unit === '分') prio = 1;
    else if (unit === '角') prio = 2;
    else if (unit === '元') prio = 3;
    else if (unit === '万元') prio = 4;
    else if (unit === '亿元') prio = 5;

    return [prio, num, unit];
}

function compareDenom(a, b) {
    const va = denomSortValue(a);
    const vb = denomSortValue(b);
    if (va[0] !== vb[0]) return va[0] - vb[0];
    if (va[0] === 6) {
        if (va[2] !== vb[2]) return va[2].localeCompare(vb[2], 'zh');
        return va[1] - vb[1];
    }
    return va[1] - vb[1];
}

// ========== 通用分组 ==========
function buildGroupCategories(config, items) {
    const groupField = config.groupBy || 'year';

    if (groupField === 'denom') {
        const set = new Set();
        for (const item of items) if (item.denom) set.add(item.denom);
        return [...set]
            .sort(compareDenom)
            .map(d => ({ id: d, name: d, dataKey: config.id }));
    }

    const years = new Set();
    for (const item of items) if (item.year) years.add(item.year);
    if (years.size === 0) return null;

    const decades = {};
    for (const year of years) {
        const label = Math.floor(year / 10) * 10 + 's';
        if (!decades[label]) decades[label] = [];
        decades[label].push(year);
    }
    return Object.keys(decades)
        .sort((a, b) => parseInt(b) - parseInt(a))
        .map(d => ({ id: d, name: d, dataKey: config.id }));
}

function syncSpecialGroupChildren(config) {
    if (!config || config.view === 'timeline' || config.view === 'map' || !config.dataKey) return;
    const data = getData(config.dataKey);
    const items = data ? (data.items || data) : [];
    const groupChildren = buildGroupCategories(config, items);
    const specialTree = specialCategoryTree ? specialCategoryTree.find(c => c.id === config.id) : null;
    if (specialTree) {
        specialTree.children = (groupChildren && groupChildren.length > 0) ? groupChildren : null;
    }
}

// ========== 专题概览 ==========
function renderSpecialOverview() {
    const app = getRenderContainer();
    currentView = VIEW.OVERVIEW;

    const configs = getSpecialConfigs();

    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    document.querySelector('.body-row')?.classList.add('sidebar-hidden');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) toggleBtn.style.display = 'none';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.innerHTML = '';
        // ★ 这条路绕过了 renderSidebar()，所以侧边栏的"上次渲染板块"记录
        //   必须在这里补一笔。否则从专题切回纸币时会被判成"板块没变"，
        //   侧边栏的入场动画就漏播了（见 sidebar.js replaySidebarEnter）。
        if (typeof markSidebarEnterScope === 'function') markSidebarEnterScope(sidebar);
    }

    let html = `<div class="overview-header"><h2>专题收藏</h2><p>选择专题查看详情</p></div>`;

    if (!configs || configs.length === 0) {
        html += '<div class="empty-state">' + emptyArt('special') + '还木有专题</div>';
        app.innerHTML = html;
        triggerViewAnimation();
        // ★★★ 恢复概览滚动 ★★★
        if (specialPageCaches['__overview__']?.scrollY !== undefined) {
            setTimeout(() => {
                app.scrollTop = specialPageCaches['__overview__'].scrollY || 0;
            }, 50);
        }
        return;
    }

    html += `<div class="special-overview-grid">`;
    for (const config of configs) {
        if (config.slogan) {
            html += `<div class="special-overview-bar" onclick="onSpecialOverviewItemClick('${config.id}')">`;
            html += `<span class="special-overview-bar-title">${escapeHtml(config.name)}</span>`;
            html += `<span class="special-overview-bar-slogan">${escapeHtml(config.slogan)}</span>`;
            html += `</div>`;
        } else {
            const data = getData(config.dataKey);
            const count = data ? data.length || 0 : 0;
            html += `<div class="special-overview-card" onclick="onSpecialOverviewItemClick('${config.id}')">`;
            html += `<div class="special-overview-card-title">${escapeHtml(config.name)}</div>`;
            html += `<div class="special-overview-card-count">${count}件</div>`;
            html += `</div>`;
        }
    }
    html += `</div>`;

    app.innerHTML = html;
    triggerViewAnimation();
    // ★★★ 恢复概览滚动 ★★★
    if (specialPageCaches['__overview__']?.scrollY !== undefined) {
        setTimeout(() => {
            app.scrollTop = specialPageCaches['__overview__'].scrollY || 0;
        }, 50);
    }
}

// ========== 点击专题 ==========
function onSpecialOverviewItemClick(configId, initialGroup) {
    // ★ 收口写 URL（深链接）：这是专题内的导航/筛选动作，完成后同步地址栏
    try {
        onSpecialOverviewItemClickInner(configId, initialGroup);
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

// ★ initialGroup：深链接要还原的侧边栏子类（面额/年代…），没有就传 null。
//   用可选入参而不是新增一个入口函数，是为了让路由与"用户手动点专题卡片"
//   继续走**同一条代码路径**（见 router.js 顶部"模拟点击"的说明），
//   否则两条路径的副作用很容易长歪。
function onSpecialOverviewItemClickInner(configId, initialGroup) {
    selectedSpecial = configId;
    currentCategoryId = configId;
    currentSubId = null;
    const config = getSpecialConfigs().find(c => c.id === configId);

    document.querySelector('.body-row')?.classList.remove('sidebar-hidden');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    if (config && (config.view === 'map' || config.view === 'timeline')) {
        document.querySelector('.body-row')?.classList.add('sidebar-hidden');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.style.display = 'none';
        if (config.view === 'map') {
            shanheViewMode = 'map';
            renderShanheContent(config);
        } else {
            renderTimelineContent(config);
        }
        triggerViewAnimation();
        return;
    }

    if (config) {
        syncSpecialGroupChildren(config);
    }

    const hasSub = config && specialCategoryTree
        ? specialCategoryTree.find(c => c.id === configId)?.children?.length > 0
        : false;

    // ★ 深链接要还原侧边栏子类。必须在 syncSpecialGroupChildren() **之后**做 ——
    //   这一步才把 children 建出来，提前设会被随后的渲染覆盖。
    //   校验用 children 里的真实 id（而不是直接用 URL 里那串），
    //   这样链接里写了已删除的子类时会安静地退回"全部"，不会卡在一个空列表上。
    //   本条对**任何**按 groupBy 自动分组的专题都成立（面额、年代、以及将来新增的），
    //   因为 children 是 buildGroupCategories() 按配置统一生成的。
    let restoredGroup = false;
    if (hasSub && initialGroup !== null && initialGroup !== undefined && initialGroup !== '') {
        const node = specialCategoryTree.find(c => c.id === configId);
        const hit = node && node.children
            ? node.children.find(sub => String(sub.id) === String(initialGroup))
            : null;
        if (hit) { currentSubId = hit.id; restoredGroup = true; }
    }

    if (hasSub) {
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.style.display = '';
        renderSidebar();
        renderSpecialContent();
        // ★ 侧边栏是按 currentSubId 打高亮的，而上面 renderSidebar() 已经跑过一次；
        //   还原了子类就再渲染一次，否则"内容是子类、高亮却是全部"。
        if (restoredGroup) renderSidebar();
        triggerViewAnimation();
    } else {
        document.querySelector('.body-row')?.classList.add('sidebar-hidden');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.style.display = 'none';
        renderSpecialContent();
        triggerViewAnimation();
    }
}

// ========== 专题内容 ==========
function renderSpecialContent() {
    const app = getRenderContainer();

    if (!selectedSpecial) { renderSpecialOverview(); return; }
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) { renderSpecialOverview(); return; }

    if (config.view === 'timeline') {
        renderTimelineContent(config);
        return;
    }

    const data = getData(config.dataKey);
    if (!data) { app.innerHTML = '<div class="empty-state">' + emptyArt('special') + '啥都木有</div>'; return; }

    const items = data.items || data;
    if (!items || items.length === 0) { app.innerHTML = '<div class="empty-state">' + emptyArt('special') + '啥都木有</div>'; return; }

    if (config.view === 'map') {
        renderShanheContent(config);
        return;
    }

    const groupField = config.groupBy || 'year';

    let filteredItems = items;
    if (currentSubId) {
        if (groupField === 'denom') {
            filteredItems = items.filter(item => (item.denom || '') === currentSubId);
        } else {
            const decadeStart = parseInt(currentSubId);
            if (!isNaN(decadeStart)) {
                filteredItems = items.filter(item => {
                    const y = item.year;
                    return y && Math.floor(y / 10) * 10 === decadeStart;
                });
            }
        }
    }

    const groups = {};
    for (const item of filteredItems) {
        const key = groupField === 'denom' ? (item.denom || '未知') : (item.year || '未知');
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    }
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === '未知') return 1;
        if (b === '未知') return -1;
        if (groupField === 'denom') return compareDenom(a, b);
        return parseInt(b) - parseInt(a);
    });

    specialItemsList = [];
    for (const key of sortedKeys) for (const item of groups[key]) specialItemsList.push(item);

    let html = `<div class="overview-header"><h2>${escapeHtml(config.name)}</h2>`;
    if (currentSubId) html += `<p style="font-size:0.8rem;color:var(--theme);">正在看：${escapeHtml(currentSubId)}</p>`;
    html += `</div>`;

    for (const key of sortedKeys) {
        const group = groups[key];
        html += `<div class="special-year-section">`;
        html += `<div class="special-year-title">${escapeHtml(key)} <span class="count">${group.length}件</span></div>`;
        html += `<div class="special-year-grid">`;
        for (const item of group) {
            const index = specialItemsList.indexOf(item);
            const imgUrl = getImageUrl(item.yearImg || item.img);
            const gImg = gridImg(item.yearImg || item.img);
            html += `<div class="special-item-card" onclick="openSpecialLightbox(${index})">`;
            if (imgUrl) {
                html += `<div class="special-item-img-wrapper"><img class="special-item-img" src="${escapeAttr(gImg.src)}"${thumbFallbackAttr(gImg.fallback)} alt="${escapeAttr(item.name || item.scene || '')}" loading="lazy"></div>`;
            } else {
                html += `<div class="special-item-img-wrapper" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-secondary);">还木有图片</div>`;
            }
            html += `<div class="special-item-info">`;
            html += `<div class="special-item-name">${escapeHtml(item.name || item.scene || '')}</div>`;
            if (item.krause && !/unlisted/i.test(item.krause)) html += `<div class="special-item-krause">${escapeHtml(item.krause)}</div>`;
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }

    if (filteredItems.length === 0) html += '<div class="empty-state">' + emptyArt('special') + '啊哦，啥都木有……</div>';
    app.innerHTML = html;

    // ★★★ 恢复专题滚动（从缓存中） ★★★
    if (selectedSpecial && specialPageCaches[selectedSpecial]?.scrollY !== undefined) {
        setTimeout(() => {
            app.scrollTop = specialPageCaches[selectedSpecial].scrollY || 0;
        }, 50);
    }
    triggerViewAnimation();

    // ★ 专题页图片是懒加载的，渲染完成后在后台补齐（见 precache.js）
    if (typeof schedulePrecacheCurrentView === 'function') schedulePrecacheCurrentView();
}

// ========== 灯箱 ==========
function openSpecialLightbox(index) {
    specialCurrentIndex = index;

    const overlay = document.getElementById('specialLightbox');
    if (overlay) overlay.remove();

    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) return;

    const lightbox = document.createElement('div');
    lightbox.id = 'specialLightbox';
    lightbox.className = 'special-lightbox';
    lightbox.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:20px;animation:contentFadeIn var(--dur-2) var(--ease-out);';

    const inner = document.createElement('div');
    inner.className = 'special-lightbox-inner';
    // ★ 滚动交给 .special-lightbox-content（见 layout.css），卡片本身不滚：
    //   这样右上角的 × 才不会跟着内容滚走（用户："弹窗可滚动，但右上角 × 不应随滚动移动"）。
    //   这里是内联样式，优先级比 CSS 高，所以必须在这儿一起改掉 overflow-y:auto。
    inner.style.cssText = 'background:var(--card-bg);border-radius:12px;max-width:700px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;position:relative;box-shadow:0 8px 30px rgba(0,0,0,0.2);';

    const closeBtn = document.createElement('div');
    closeBtn.className = 'lightbox-close';
    closeBtn.textContent = '×';
    closeBtn.title = '关闭';
    closeBtn.onclick = (e) => { e.stopPropagation(); closeSpecialLightbox(); };
    inner.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'special-lightbox-content';
    content.style.padding = '16px 20px 20px';

    inner.appendChild(content);
    lightbox.appendChild(inner);
    document.body.appendChild(lightbox);

    renderLightboxContent(content, config);

    lightbox.addEventListener('click', function(e) {
        if (e.target === lightbox) closeSpecialLightbox();
    });

    document.addEventListener('keydown', specialLightboxKeyHandler);
}

function renderLightboxContent(contentEl, config) {
    const items = specialItemsList;
    const index = specialCurrentIndex;
    if (index < 0 || index >= items.length) return;

    const item = items[index];
    const imgUrl = getImageUrl(item.yearImg || item.img);

    let html = '';

    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-right:36px;">`;
    html += `<div style="font-size:0.8rem;color:var(--text-secondary);">${index + 1} / ${items.length}</div>`;
    html += `<div style="display:flex;gap:8px;">`;
    const prevDisabled = index <= 0;
    html += `<button class="special-lightbox-nav" onclick="navigateLightbox(-1)" ${prevDisabled ? 'disabled' : ''}>← 上一张</button>`;
    const nextDisabled = index >= items.length - 1;
    html += `<button class="special-lightbox-nav" onclick="navigateLightbox(1)" ${nextDisabled ? 'disabled' : ''}>下一张 →</button>`;
    html += `</div></div>`;

    if (imgUrl) {
        // ★ 大图弹窗的图片与站内其它弹窗用**同一套**规则：铺满 + object-fit: contain。
        //   原来写的是 max-width/max-height:100% + width:auto —— max-* **只缩不放**，
        //   于是图片小于 55vh 的框时就按**自身像素尺寸**显示：用户实测 `1953-001.jpg`
        //   只有 394×296，而其它图 822~1812，同一屏里就"小一圈"（点开才小）。
        //   改成 100%×100% 后一律拉齐；本专题的图恰好全是 4:3（已逐张量过 48/48），
        //   contain 既不会裁切也不会留边。
        //   阴影同时从 box-shadow 换成 filter: drop-shadow —— box-shadow 是贴着
        //   **元素盒子**画的，铺满后一旦 contain 在图外留边，就会看到"阴影框一大圈、
        //   图在里头"，而 drop-shadow 跟着**实际画出的像素**走，观感与改前一致。
        html += `<div style="height:55vh;display:flex;align-items:center;justify-content:center;margin-bottom:12px;overflow:hidden;">`;
        html += `<img src="${imgUrl}"${thumbFallbackAttr('')} alt="${escapeAttr(item.name || item.scene || '')}" style="width:100%;height:100%;object-fit:contain;border-radius:6px;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.1));">`;
        html += `</div>`;
    } else {
        // 和列表里的 .no-img 一样：自绘古钱币（由 .special-lightbox-nopic::before 提供）＋一行字
        html += `<div style="height:55vh;display:flex;align-items:center;justify-content:center;margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem;"><span class="special-lightbox-nopic">暂无图片</span></div>`;
    }

    html += `<div style="border-top:1px solid var(--border);padding-top:12px;">`;
    html += `<div style="font-size:1rem;font-weight:bold;color:var(--text);margin-bottom:4px;">${escapeHtml(item.name || item.scene || '')}</div>`;
    if (item.year) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">年份：${item.year}年</div>`;
    if (item.denom) {
        const label = (config && config.view === 'map') ? '来源' : '面额';
        html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">${label}：${escapeHtml(item.denom)}</div>`;
    }
    if (item.city) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">城市：${escapeHtml(item.city)}</div>`;
    if (item.krause && !/unlisted/i.test(item.krause)) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">编号：${escapeHtml(item.krause)}</div>`;
    if (item.remark) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">备注：${escapeHtml(item.remark)}</div>`;
    html += `</div>`;

    contentEl.innerHTML = html;
}

function navigateLightbox(direction) {
    specialCurrentIndex += direction;
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    const contentEl = document.querySelector('#specialLightbox .special-lightbox-content');
    if (contentEl) renderLightboxContent(contentEl, config);
}

function closeSpecialLightbox() {
    const overlay = document.getElementById('specialLightbox');
    if (overlay) fadeOutAndRemove(overlay, 240);   // 先淡出再移除，避免硬切
    document.removeEventListener('keydown', specialLightboxKeyHandler);
}

function specialLightboxKeyHandler(e) {
    if (e.key === 'Escape') closeSpecialLightbox();
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
}

// ========== 方寸山河：视图切换 ==========
function shanheSwitchView(view) {
    // ★ 收口写 URL（深链接）：这是专题内的导航/筛选动作，完成后同步地址栏
    try {
        shanheSwitchViewInner(view);
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function shanheSwitchViewInner(view) {
    if (shanheViewMode === view) return;
    // ★★★ 保存当前视图状态 ★★★
    saveFullState();
    shanheViewMode = view;
    currentSubId = null;

    if (shanheListRO) { shanheListRO.disconnect(); shanheListRO = null; }

    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) return;

    const app = getRenderContainer();
    if (app) {
        // 进入方向：去列表从右侧滑入，回地图从左侧滑入（有方向感，而不是又一次"向上淡入"）
        app.classList.remove('shanhe-view-enter', 'shanhe-view-enter-left', 'shanhe-view-enter-right');
        void app.offsetWidth;
        app.classList.add(view === 'list' ? 'shanhe-view-enter-right' : 'shanhe-view-enter-left');
    }
    renderShanheContent(config);
}

function backFromShanheToOverview() {
    // ★ 收口写 URL（深链接）：这是专题内的导航/筛选动作，完成后同步地址栏
    try {
        backFromShanheToOverviewInner();
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function backFromShanheToOverviewInner() {
    saveFullState(); // 保存当前专题滚动
    selectedSpecial = null;
    currentCategoryId = null;
    currentSubId = null;
    shanheMapCache = null;
    if (shanheListRO) { shanheListRO.disconnect(); shanheListRO = null; }
    renderSpecialOverview();
}

function shanheListCols(app) {
    const GAP = 8, MIN_CELL = 140;
    const appW = app.clientWidth || window.innerWidth || 600;
    return Math.max(1, Math.floor((appW + GAP) / (MIN_CELL + GAP)));
}

function renderShanheList(config) {
    const app = getRenderContainer();
    const data = getData(config.dataKey);
    const items = data ? (data.items || data) : [];

    const groups = new Map();
    for (const item of items) {
        const key = (item.province || '') + '|' + (item.city || '其他');
        if (!groups.has(key)) groups.set(key, { province: item.province || '', city: item.city || '其他', items: [] });
        groups.get(key).items.push(item);
    }

    const sortedGroups = [...groups.values()].sort((a, b) => {
        const pa = shanheProvinceNames[a.province] || a.province;
        const pb = shanheProvinceNames[b.province] || b.province;
        if (pa !== pb) return pa.localeCompare(pb, 'zh');
        return a.city.localeCompare(b.city, 'zh');
    });

    const flat = [];
    for (const g of sortedGroups) for (const item of g.items) flat.push({ group: g, item });
    specialItemsList = flat.map(f => f.item);

    let html = shanheHeaderHtml(config);
    if (flat.length === 0) {
        html += '<div class="empty-state">' + emptyArt('shanhe') + '还……还没有风景(╥_╥)</div>';
        app.innerHTML = html;
        triggerViewAnimation();
        return;
    }

    const colCount = shanheListCols(app);
    shanheListLastCols = colCount;

    html += `<div class="shanhe-list-rows">`;
    for (let i = 0; i < flat.length; i += colCount) {
        const chunk = flat.slice(i, i + colCount);

        const strips = [];
        for (const f of chunk) {
            if (strips.length > 0 && strips[strips.length - 1].group === f.group) {
                strips[strips.length - 1].count++;
            } else {
                strips.push({ group: f.group, count: 1 });
            }
        }

        html += `<div class="shanhe-list-block">`;
        html += `<div class="shanhe-list-strips" style="grid-template-columns: repeat(${colCount}, 1fr);">`;
        for (const s of strips) {
            const provinceName = shanheProvinceNames[s.group.province] || s.group.province;
            html += `<div class="shanhe-list-strip" style="grid-column: span ${s.count};">${escapeHtml(provinceName)} - ${escapeHtml(s.group.city)}</div>`;
        }
        html += `</div>`;
        html += `<div class="shanhe-list-images" style="grid-template-columns: repeat(${colCount}, 1fr);">`;
        for (const { item } of chunk) {
            const idx = specialItemsList.indexOf(item);
            const imgUrl = getImageUrl(item.img || item.yearImg);
            const gImg = gridImg(item.img || item.yearImg);
            html += `<div class="shanhe-list-cell" onclick="openSpecialLightbox(${idx})" title="${escapeAttr(item.scene || item.name || '')}">`;
            if (imgUrl) html += `<img src="${escapeAttr(gImg.src)}"${thumbFallbackAttr(gImg.fallback)} alt="" loading="lazy">`;
            else html += `<span class="no-img">暂无图片</span>`;
            html += `</div>`;
        }
        html += `</div>`;
        html += `</div>`;
    }
    html += `</div>`;

    app.innerHTML = html;

    // ★★★ 恢复专题滚动（列表视图） ★★★
    if (selectedSpecial && specialPageCaches[selectedSpecial]?.scrollY !== undefined) {
        setTimeout(() => {
            app.scrollTop = specialPageCaches[selectedSpecial].scrollY || 0;
        }, 50);
    }
    triggerViewAnimation();

    if (shanheListRO) shanheListRO.disconnect();
    shanheListRO = new ResizeObserver(() => {
        if (isSettingsMode ||
            currentMode !== MODE.SPECIAL ||
            selectedSpecial !== config.id ||
            currentSubId !== null ||
            shanheViewMode !== 'list') return;
        const cols = shanheListCols(app);
        if (cols !== shanheListLastCols) renderShanheList(config);
    });
    shanheListRO.observe(app);

    // ★ 列表视图图片是懒加载的，渲染完成后在后台补齐（见 precache.js）
    if (typeof schedulePrecacheCurrentView === 'function') schedulePrecacheCurrentView();
}

function shanheHeaderHtml(config) {
    let html = `<div class="back-bar"><button class="back-btn" onclick="backFromShanheToOverview()">← 返回专题</button></div>`;
    html += `<div class="overview-header shanhe-header-row">`;
    html += `<div><h2>${escapeHtml(config.name)}</h2><p>点击查看山河壮阔</p></div>`;
    html += `<div class="shanhe-view-toggle">`;
    html += `<button class="shanhe-view-btn ${shanheViewMode === 'map' ? 'active' : ''}" onclick="shanheSwitchView('map')">地 图</button>`;
    html += `<button class="shanhe-view-btn ${shanheViewMode === 'list' ? 'active' : ''}" onclick="shanheSwitchView('list')">列 表</button>`;
    html += `</div>`;
    html += `</div>`;
    // ★ 图例只在地图视图显示：这条色阶说明的是"省份颜色越深 = 藏品越多"，
    //   而列表视图里省份根本没有上色，摆在那里只是一行无意义的说明
    //   （用户要求：山河的列表那里不用显示"藏品数量 / 少 → 多"）。
    //   原来是列表和地图共用这个头部，所以两个视图都会出现。
    if (shanheViewMode === 'map') {
        // ★ 图例：原来地图完全没有说明"颜色深浅代表什么"，
        //   加上深色模式曾经把渐变方向弄反（没数据的省份最亮），
        //   颜色语义就更猜不出来了。这条渐变条直接复用 --bg-light → --theme-light，
        //   所以它和地图用的是同一套颜色，明暗切换都自洽。
        html += `<div class="shanhe-map-legend">`;
        html += `<span class="shanhe-legend-label">藏品数量</span>`;
        html += `<span class="shanhe-legend-bar"></span>`;
        html += `<span class="shanhe-legend-label">少 → 多</span>`;
        html += `</div>`;
    }
    return html;
}

// ========== 方寸山河：地图 ==========
let shanheRequestId = 0;

function applyShanheStyling(svg, items, config) {
    const countByProvince = {};
    let maxCount = 0;
    for (const item of items) {
        if (!item.province) continue;
        countByProvince[item.province] = (countByProvince[item.province] || 0) + 1;
        if (countByProvince[item.province] > maxCount) maxCount = countByProvince[item.province];
    }
    const themeLightRGB = getCssColor('--theme-light', [94, 160, 255]);

    svg.querySelectorAll('.state').forEach(el => {
        const cls = el.getAttribute('class') || '';
        const pid = cls.split(/\s+/).filter(c => c && c !== 'state')[0] || '';
        const isGangAo = (pid === 'xianggang' || pid === 'aomen');
        setupShanheState(el, pid, countByProvince[pid] || 0, maxCount, themeLightRGB, config, svg, undefined, isGangAo);
    });

    buildShanheInset(svg, countByProvince, maxCount, themeLightRGB, config);
}

function loadShanheViaObject(app, config, items, mapFile) {
    return new Promise((resolve, reject) => {
        const loadEl = app.querySelector('.shanhe-map-loading');
        // ★★★ 保留进度条，只更新文字 ★★★
        const textEl = loadEl?.querySelector('.loading-text');
        if (textEl) textEl.textContent = '正在把地图搬过来（本地模式）……';

        const obj = document.createElement('object');
        obj.data = mapFile;
        obj.type = 'image/svg+xml';
        obj.style.cssText = 'width:100%;height:auto;display:block;';

        let done = false;
        const timer = setTimeout(() => {
            if (!done) reject(new Error('SVG 加载超时，请确保 china_map.svg 与 index.html 在同一目录'));
        }, 10000);

        obj.onload = function() {
            clearTimeout(timer);
            if (done) return;
            try {
                const svg = obj.contentDocument?.querySelector('svg');
                if (!svg) {
                    reject(new Error('无法获取 SVG DOM，浏览器可能阻止了本地文件访问'));
                    return;
                }
                done = true;

                if (loadEl) loadEl.remove();

                const wrap = document.createElement('div');
                wrap.className = 'shanhe-map-wrap';
                wrap.appendChild(svg);
                app.appendChild(wrap);

                applyShanheStyling(svg, items, config);

                shanheMapCache = { wrap };

                if (selectedSpecial && specialPageCaches[selectedSpecial]?.scrollY !== undefined) {
                    setTimeout(() => {
                        app.scrollTop = specialPageCaches[selectedSpecial].scrollY || 0;
                    }, 50);
                }
                triggerViewAnimation();
                resolve();
            } catch (err) {
                reject(err);
            }
        };

        obj.onerror = function() {
            clearTimeout(timer);
            if (!done) reject(new Error('object 标签加载失败，请检查 china_map.svg 是否存在'));
        };

        if (loadEl) {
            loadEl.parentNode.insertBefore(obj, loadEl);
        } else {
            app.appendChild(obj);
        }
    });
}

async function renderShanheContent(config) {
    const app = getRenderContainer();
    const data = getData(config.dataKey);
    const items = data ? (data.items || data) : [];
    const mapFile = config.mapFile || 'china_map.svg';
    shanheProvinceNames = window.SHANHE_PROVINCE_NAMES || {};

    document.querySelector('.body-row')?.classList.add('sidebar-hidden');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) toggleBtn.style.display = 'none';
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl) {
        sidebarEl.innerHTML = '';
        // 同 renderSpecialOverview：这条路也不经过 renderSidebar()，补记板块记录。
        if (typeof markSidebarEnterScope === 'function') markSidebarEnterScope(sidebarEl);
    }

    if (!currentSubId) {
        if (shanheViewMode === 'list') {
            renderShanheList(config);
            return;
        }

        // ★★★ 构建带脉冲条的加载提示 ★★★
        app.innerHTML = shanheHeaderHtml(config) +
            `<div class="shanhe-map-loading">
                <div class="loading-text">且待万里山河在你面前徐徐展开</div>
                <div class="shanhe-map-loading-bar"><div class="fill"></div></div>
             </div>`;
        const loadEl = app.querySelector('.shanhe-map-loading');

        if (shanheMapCache && shanheMapCache.wrap) {
            const removeLoad = app.querySelector('.shanhe-map-loading');
            if (removeLoad) removeLoad.remove();
            shanheMapCache.wrap.querySelectorAll('.shanhe-label.active').forEach(t => t.classList.remove('active'));
            app.appendChild(shanheMapCache.wrap);
            if (selectedSpecial && specialPageCaches[selectedSpecial]?.scrollY !== undefined) {
                setTimeout(() => {
                    app.scrollTop = specialPageCaches[selectedSpecial].scrollY || 0;
                }, 50);
            }
            triggerViewAnimation();
            return;
        }

        const isFileProtocol = window.location.protocol === 'file:';

        try {
            if (isFileProtocol) {
                await loadShanheViaObject(app, config, items, mapFile);
            } else {
                const currentRequestId = ++shanheRequestId;
                const res = await fetch(mapFile);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const svgText = await res.text();

                if (currentRequestId !== shanheRequestId) return;
                if (!app.contains(loadEl)) return;

                const wrap = document.createElement('div');
                wrap.className = 'shanhe-map-wrap';
                wrap.innerHTML = svgText;
                app.appendChild(wrap);

                const svg = wrap.querySelector('svg');
                if (!svg) throw new Error('SVG中未找到<svg>');

                const removeLoad = app.querySelector('.shanhe-map-loading');
                if (removeLoad) removeLoad.remove();
                shanheMapCache = { wrap };

                applyShanheStyling(svg, items, config);

                if (selectedSpecial && specialPageCaches[selectedSpecial]?.scrollY !== undefined) {
                    setTimeout(() => {
                        app.scrollTop = specialPageCaches[selectedSpecial].scrollY || 0;
                    }, 50);
                }
                triggerViewAnimation();
            }
        } catch (e) {
            if (app.contains(loadEl)) {
                app.innerHTML = shanheHeaderHtml(config) +
                    `<div class="empty-state">地图……它……它不见力(╥_╥)<br><span style="font-size:0.75rem;color:var(--text-secondary);">报错信息：${escapeHtml(e.message)}</span></div>`;
            }
        }
    } else {
        renderShanheProvince(config);
    }
}

// 地图省份填色。
//
// ★ 深色模式必须**把渐变方向反过来**，否则热力图语义整体倒置：
//   亮色下 --bg 是白的，空省填白 = 自然的"留白"（对比 1.11:1），
//   深色下 --bg 接近纯黑，同一行"空省填白"就变成 20.2:1 的刺眼白光 ——
//   结果是**没有藏品的省份最抢眼**，有数据的反而暗，图读起来是反的。
//   所以深色下改成：空省 = --bg-light（跟底色走），有数据 = 越多数越亮。
function fillForCount(count, maxCount, themeLightRGB) {
    const dark = (typeof isDarkScheme === 'function') && isDarkScheme();
    if (dark) {
        const base = getCssColor('--bg-light', [26, 30, 37]);
        if (count <= 0) return mixColor(base, base, 0);
        // 起点给 0.25 而不是 0：只差一件也要能一眼看出"这省有东西"
        const ratio = maxCount > 0 ? count / maxCount : 0;
        return mixColor(base, themeLightRGB, 0.25 + 0.75 * ratio);
    }
    if (count <= 0) return 'rgb(255,255,255)';
    const ratio = maxCount > 0 ? count / maxCount : 0;
    return mixColor([255, 255, 255], themeLightRGB, ratio);
}

function createShanheLabel(svg, x, y, name, count, baseSize, strokeScale) {
    const NS = 'http://www.w3.org/2000/svg';
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'shanhe-label' + (count > 0 ? ' has-count' : ''));
    text.style.setProperty('--label-size', (baseSize || 12) + 'px');
    if (strokeScale && strokeScale !== 1) {
        text.style.setProperty('--label-stroke', (1.5 * strokeScale) + 'px');
    }
    const tName = document.createElementNS(NS, 'tspan');
    tName.textContent = name;
    text.appendChild(tName);
    if (count > 0) {
        const tCount = document.createElementNS(NS, 'tspan');
        tCount.setAttribute('class', 'shanhe-label-count');
        tCount.textContent = ' ' + count;
        text.appendChild(tCount);
    }
    svg.appendChild(text);
    return text;
}

function isPointInPolygon(el, x, y) {
    const pts = el.getAttribute('points');
    if (!pts) return true;
    const coords = pts.trim().split(/[\s,]+/).map(Number);
    let inside = false;
    for (let i = 0, j = coords.length - 2; i < coords.length; i += 2) {
        const xi = coords[i], yi = coords[i + 1];
        const xj = coords[j], yj = coords[j + 1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        j = i;
    }
    return inside;
}

function setupShanheState(el, pid, count, maxCount, themeLightRGB, config, svg, baseSize, noLabel, strokeScale) {
    const name = shanheProvinceNames[pid] || pid;
    el.style.fill = fillForCount(count, maxCount, themeLightRGB);
    // ★ 把数量写在元素上：地图配色是 JS 按 (count, maxCount, 主题) 算出来的，
    //   有了这个属性就能一眼看出"这块颜色对应几件藏品"，
    //   也让配色测试不必再去反推数据源（pid 在 class 里，但空数组时容易搞错 dataKey）。
    el.setAttribute('data-count', String(count));
    el.setAttribute('data-pid', pid);
    // ★ 描边走主题变量，并且用**内联**写：
    //   layout.css 里虽然也有 `.state { stroke: var(--border) }`，但 SVG 里
    //   `.state:hover { fill: ... !important }` 那条规则的存在说明这条链上
    //   优先级很微妙；内联最直接，也保证"刷新主题"时能被重新计算到。
    //   （旧值 #999 是写死的，换主题/明暗都不变。）
    el.style.stroke = 'var(--border, #999)';
    el.style.cursor = 'pointer';

    if (strokeScale && strokeScale !== 1) {
        el.style.strokeWidth = (1 * strokeScale) + 'px';
    }

    // ★★★ 点击省份时保存当前地图状态 ★★★
    el.addEventListener('click', () => {
        saveFullState(); // 保存滚动和当前省份
        shanheViewMode = 'list';
        currentSubId = pid;
        renderShanheContent(config);
        setTimeout(() => {
            const provinceName = shanheProvinceNames[pid] || pid;
            const strips = document.querySelectorAll('.shanhe-list-strip');
            for (const strip of strips) {
                if (strip.textContent.includes(provinceName)) {
                    strip.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    break;
                }
            }
        }, 200);
    });

    let bbox = null;
    try { bbox = el.getBBox(); } catch (e) {}
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return null;

    if (noLabel) return null;

    let lx = bbox.x + bbox.width / 2;
    let ly = bbox.y + bbox.height / 2;
    if (!isPointInPolygon(el, lx, ly)) {
        for (const step of [0.06, 0.12, 0.18, 0.24, 0.30]) {
            const yy = bbox.y + bbox.height * (0.5 + step);
            if (isPointInPolygon(el, lx, yy)) { ly = yy; break; }
        }
    }

    if (SHANHE_LABEL_OFFSETS && SHANHE_LABEL_OFFSETS[pid]) {
        ly += SHANHE_LABEL_OFFSETS[pid];
    }

    const text = createShanheLabel(svg, lx, ly, name, count, baseSize, strokeScale);
    el.addEventListener('mouseenter', () => text.classList.add('active'));
    el.addEventListener('mouseleave', () => text.classList.remove('active'));
    return text;
}

function buildShanheInset(mainSvg, countByProvince, maxCount, themeLightRGB, config) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const id of ['xianggang', 'aomen']) {
        const el = mainSvg.querySelector('.state.' + id);
        if (!el) continue;
        const b = el.getBBox();
        if (!b || b.width <= 0 || b.height <= 0) continue;
        minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + b.width);
        minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.height);
    }
    if (minX === 1e9) return;
    const pad = 6;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const gd = mainSvg.querySelector('.state.guangdong');
    if (gd) {
        const gb = gd.getBBox();
        if (gb && gb.width > 0 && gb.height > 0) {
            minY = Math.min(minY, gb.y + gb.height * 0.55);
            minX = Math.min(minX, gb.x + gb.width * 0.45);
        }
    }

    const inRegion = [];
    mainSvg.querySelectorAll('.state').forEach(el => {
        const b = el.getBBox();
        if (!b || b.width <= 0 || b.height <= 0) return;
        if (b.x < maxX && b.x + b.width > minX && b.y < maxY && b.y + b.height > minY) {
            inRegion.push(el);
        }
    });
    if (inRegion.length === 0) return;

    const wrap = document.createElement('div');
    wrap.className = 'shanhe-map-inset';
    wrap.innerHTML = '<div class="shanhe-map-inset-title">粤港澳地区局部放大图</div>';

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    wrap.appendChild(svg);

    const mapWrap = mainSvg.closest('.shanhe-map-wrap');
    if (mapWrap) mapWrap.appendChild(wrap);

    const mainVbW = (mainSvg.viewBox && mainSvg.viewBox.baseVal) ? mainSvg.viewBox.baseVal.width : 595.28;
    const mainScale = mainSvg.getBoundingClientRect().width / mainVbW;
    const insetScale = svg.getBoundingClientRect().width / (maxX - minX);
    // ★ 断点必须与 layout.css 一致（768px）。原来是 760px，而 CSS 里 .sidebar 的
    //   收窄断点也是 768px，于是 760~768px 这段宽度会出现「侧栏按手机收窄、
    //   山河图却按桌面字号排版」的错配。
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    const fontFactor = isMobile ? 1 : 0.55;
    const baseSize = insetScale > 0 ? 12 * mainScale / insetScale * fontFactor : 12;
    const strokeScale = mainScale / insetScale;

    for (const el of inRegion) {
        const cls = el.getAttribute('class') || '';
        const pid = cls.split(/\s+/).filter(c => c && c !== 'state')[0] || '';
        const clone = el.cloneNode(true);
        clone.removeAttribute('style');
        svg.appendChild(clone);
        setupShanheState(clone, pid, countByProvince[pid] || 0, maxCount, themeLightRGB, config, svg, baseSize, undefined, strokeScale);
    }
}

function getCssColor(prop, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    if (!v) return fallback;
    const hex = v.replace('#', '');
    if (hex.length === 3) return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
    if (hex.length === 6) return [parseInt(hex.substring(0, 2), 16), parseInt(hex.substring(2, 4), 16), parseInt(hex.substring(4, 6), 16)];
    const m = v.match(/\d+(?:\.\d+)?/g);
    if (m && m.length >= 3) return [parseInt(m[0]), parseInt(m[1]), parseInt(m[2])];
    return fallback;
}

function mixColor(c1, c2, t) {
    return 'rgb(' +
        Math.round(c1[0] + (c2[0] - c1[0]) * t) + ',' +
        Math.round(c1[1] + (c2[1] - c1[1]) * t) + ',' +
        Math.round(c1[2] + (c2[2] - c1[2]) * t) + ')';
}

// ========== 省份详情 ==========
function renderShanheProvince(config) {
    const app = getRenderContainer();
    const data = getData(config.dataKey);
    const items = (data ? (data.items || data) : []).filter(item => item.province === currentSubId);
    const provinceName = shanheProvinceNames[currentSubId] || currentSubId;

    const cityGroups = {};
    for (const item of items) {
        const key = item.city || '其他';
        if (!cityGroups[key]) cityGroups[key] = [];
        cityGroups[key].push(item);
    }

    let html = `<div class="back-bar"><button class="back-btn" onclick="backFromShanheMap()">← 返回地图</button></div>`;
    html += `<div class="overview-header"><h2>${escapeHtml(provinceName)}</h2><p>共${items.length}个景观图</p></div>`;

    if (items.length === 0) {
        html += '<div class="empty-state">' + emptyArt('region') + '这么近，那么美，可这儿却没有我的一席之地……</div>';
        app.innerHTML = html;
        triggerViewAnimation();
        return;
    }

    specialItemsList = [];
    for (const city of Object.keys(cityGroups)) for (const item of cityGroups[city]) specialItemsList.push(item);

    for (const city of Object.keys(cityGroups)) {
        const list = cityGroups[city];
        html += `<div class="special-year-section">`;
        html += `<div class="special-year-title">${escapeHtml(city)} <span class="count">${list.length}件</span></div>`;
        html += `<div class="special-year-grid">`;
        for (const item of list) {
            const index = specialItemsList.indexOf(item);
            const imgUrl = getImageUrl(item.img || item.yearImg);
            const gImg = gridImg(item.img || item.yearImg);
            html += `<div class="special-item-card" onclick="openSpecialLightbox(${index})">`;
            if (imgUrl) {
                html += `<div class="special-item-img-wrapper"><img class="special-item-img" src="${escapeAttr(gImg.src)}"${thumbFallbackAttr(gImg.fallback)} alt="${escapeAttr(item.scene || item.name || '')}" loading="lazy"></div>`;
            } else {
                html += `<div class="special-item-img-wrapper" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-secondary);">还木有图片</div>`;
            }
            html += `<div class="special-item-info">`;
            html += `<div class="special-item-name">${escapeHtml(item.scene || item.name || '')}</div>`;
            const subParts = [];
            if (item.city) subParts.push(item.city);
            if (item.denom) subParts.push(item.denom);
            if (item.year) subParts.push(item.year + '年');
            let sub = subParts.join(' · ');
            if (sub) html += `<div class="special-item-krause">${escapeHtml(sub)}</div>`;
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }

    app.innerHTML = html;
    // ★★★ 恢复省份列表滚动（此时专题缓存中保存了滚动，直接恢复） ★★★
    if (selectedSpecial && specialPageCaches[selectedSpecial]?.scrollY !== undefined) {
        setTimeout(() => {
            app.scrollTop = specialPageCaches[selectedSpecial].scrollY || 0;
        }, 50);
    }
    triggerViewAnimation();

    // ★ 省份页图片是懒加载的，渲染完成后在后台补齐（见 precache.js）
    if (typeof schedulePrecacheCurrentView === 'function') schedulePrecacheCurrentView();
}

function backFromShanheMap() {
    // ★ 收口写 URL（深链接）：这是专题内的导航/筛选动作，完成后同步地址栏
    try {
        backFromShanheMapInner();
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function backFromShanheMapInner() {
    saveFullState(); // 保存省份列表滚动
    currentSubId = null;
    shanheViewMode = 'map';
    if (shanheListRO) { shanheListRO.disconnect(); shanheListRO = null; }
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (config) renderShanheContent(config);
}

// ========== ★ 主题切换刷新地图颜色 ==========
window.refreshShanheColors = function() {
    if (currentMode !== MODE.SPECIAL) return;
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config || config.view !== 'map') return;
    // ★ 这里**故意不再**提前 return（原来在省份详情页 / 列表视图下会直接放弃）。
    //   原因：shanheMapCache 里的地图节点是复用的，用户在省份详情页或列表视图下
    //   切明暗/换主题时，那几个 guard 会让配色留在旧主题上，返回地图就看到
    //   上一个主题的颜色（实测可复现）。更新缓存节点的 fill 很廉价，
    //   而且这正是"缓存里那棵树永远跟当前主题一致"的保证。
    //   真正需要判断的只有"有没有可刷新的节点"。

    const wrap = shanheMapCache?.wrap;
    if (!wrap) return;
    const svg = wrap.querySelector('svg');
    if (!svg) return;

    const data = getData(config.dataKey);
    const items = data ? (data.items || data) : [];

    const countByProvince = {};
    let maxCount = 0;
    for (const item of items) {
        if (!item.province) continue;
        countByProvince[item.province] = (countByProvince[item.province] || 0) + 1;
        if (countByProvince[item.province] > maxCount) maxCount = countByProvince[item.province];
    }

    const themeLightRGB = getCssColor('--theme-light', [94, 160, 255]);

    const updatePaths = (targetSvg) => {
        targetSvg.querySelectorAll('.state').forEach(el => {
            const cls = el.getAttribute('class') || '';
            const pid = cls.split(/\s+/).filter(c => c && c !== 'state')[0] || '';
            const count = countByProvince[pid] || 0;
            el.style.fill = fillForCount(count, maxCount, themeLightRGB);
            // 描边也跟着主题走（它现在是 var(--border)，重新赋值让新主题生效）
            el.style.stroke = 'var(--border, #999)';
        });
    };

    updatePaths(svg);
    const inset = wrap.querySelector('.shanhe-map-inset svg');
    if (inset) {
        updatePaths(inset);
    }
};

// ===================================================================
//  ★★★★★ 币海拾年 · 时间轴 ★★★★★
// ===================================================================

// ---------- 中文日期解析器 ----------
function parseChineseDate(dateStr) {
    if (!dateStr) return null;
    const trimmed = String(dateStr).trim();
    const standard = new Date(trimmed);
    if (!isNaN(standard.getTime())) return standard;
    const match = trimmed.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (match) {
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }
    return null;
}

// ---------- 分类路径 ----------
// getCategoryPath() 已统一到 core.js（stats.js 的导出与这里的时间轴共用一份）。

// ---------- 排序切换 ----------
function setTimelineOrder(order) {
    // ★ 收口写 URL（深链接）：这是专题内的导航/筛选动作，完成后同步地址栏
    try {
        setTimelineOrderInner(order);
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function setTimelineOrderInner(order) {
    if (timelineSortOrder === order) return;
    timelineSortOrder = order;
    // ★ 换排序同样算"换了一份列表"：位置回到顶部（用户要求："更换最新/最早也要回到顶部"）
    rerenderTimeline();
}

// ★ 时间轴上任何"换了内容"的操作（换年份/月份、换最新/最早）都走这里：
//   重渲染一帧，并把滚动位置放回顶部。
//   ★ 顺序不能反：必须先把 specialPageCaches 里的旧位置清零再渲染 ——
//     renderTimelineContent 末尾有个 setTimeout 会把缓存里的值还原回来，
//     不清零的话刚滚到顶部又会被拉回旧位置（这就是"换筛选不回到顶部"的根因）。
function rerenderTimeline() {
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (selectedSpecial && specialPageCaches[selectedSpecial]) {
        specialPageCaches[selectedSpecial].scrollY = 0;
    }
    if (config) renderTimelineContent(config, { keepChrome: true });
    const app = getRenderContainer();
    if (app) app.scrollTop = 0;
}

// ---------- 筛选变更 ----------
function onTimelineFilterChange() {
    // ★ 收口写 URL（深链接）：这是专题内的导航/筛选动作，完成后同步地址栏
    try {
        onTimelineFilterChangeInner();
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function onTimelineFilterChangeInner() {
    const yearSelect = document.getElementById('timelineYearFilter');
    const monthSelect = document.getElementById('timelineMonthFilter');
    const nextYear = yearSelect ? yearSelect.value : timelineFilterYear;
    const nextMonth = monthSelect ? monthSelect.value : timelineFilterMonth;
    // ★ 点的是**同一个时间段**（比如反复点同一个格子、反复点"全部"）：什么都不做。
    //   用户要求"和反复点纸币/硬币 tab 一样"——tab 那边就是在 onTabClickInner 里
    //   按身份判断后直接 return（见 tab-switcher.js）。这里同理，只是身份的
    //   "当前值"是 timelineFilterYear + timelineFilterMonth 这一对。
    //   为什么必须在这里（而不是在 applyTimelineFilter 里）：下拉框自己 onchange
    //   也会走到这儿，选回原来那一项同样不该重渲染。
    //   注意返回值：调用方据此知道"有没有真的换列表"，但 onTimelineFilterChange
    //   仍会照常 syncRoute（URL 本来就该与当前状态一致）。
    if (nextYear === timelineFilterYear && nextMonth === timelineFilterMonth) return false;
    timelineFilterYear = nextYear;
    timelineFilterMonth = nextMonth;
    // ★ 换了年份/月份＝换了一份列表，位置必须回到顶部（用户要求："更新选择年份/月份后
    //   应该回到顶部"）。清缓存 + 回顶部的顺序与原因都写在 rerenderTimeline 里。
    rerenderTimeline();
    return true;
}

// ---------- 返回专题概览 ----------
function backFromTimeline() {
    // ★ 收口写 URL（深链接）：这是专题内的导航/筛选动作，完成后同步地址栏
    try {
        backFromTimelineInner();
    } finally {
        if (typeof syncRoute === 'function') syncRoute();
    }
}

function backFromTimelineInner() {
    saveFullState(); // 保存时间轴滚动
    selectedSpecial = null;
    currentCategoryId = null;
    currentSubId = null;
    renderSpecialOverview();
}

// ---------- 按月份热力图（年 × 月） ----------
// 只回答一个问题："哪个月花得多"。格子深浅按"金额为主、件数为辅"的加权分分 5 档；
// 悬停/聚焦时用**纯 CSS** 的 tooltip 显示件数与金额 —— JS 不参与定位，也不给 tooltip
// 写内联 style，这样手机上点一下（聚焦）也能看，且不会因为 resize / 滚动而错位。
//
// 数据用**全部有效条目**（validItems），不跟着年份/月份筛选走：否则筛成年份后就只剩一行，
// 看不出趋势。筛选状态由下拉框自己表达；点热力图则反过来把筛选取上去：
//   · 格子        → 这一年 + 这一个月
//   · 年份标签    → 这一年（全部月份）
//   · 月份表头    → 历年这个月（全部年份）
//   · 左上角"全部" → 回到全部时间
// 深浅：**不分档**，按金额比例给一个连续值（用户要求"能不能无限档？自动丝滑变化"）。
// 两轮实测也都指向这个方向：
//   · 线性 5 档 → "200 多块和 2000 多块看不出什么区别"（档太少，一小格就跨过去了）
//   · 对数 5 档 → "7000 和 3000 颜色差不多"（对数把高端压扁，两笔一起顶到第 5 档）
// 现在：0 元 = 0（不显示），其余按 金额/最大金额 线性铺在 [0.10, 0.95] 上 ——
// 既是"按比例"，也不会因为金额很小而看不见（最低也有 0.10）。
// 件数只出现在 tooltip 文案里（用户说"或者只看金额也可以"）。
function timelineHeatmapOpacity(amount, maxAmount) {
    return hmAlphaOf(amount, maxAmount);
}

// ---------- 热力图色阶（同一支主题蓝 + 透明度线性铺满整条） ----------
// ★★ 用户五轮反馈的最终结论（最简方案）：
//   ① "颜色渐变只在条的前面 25%" —— 老实现的**色停位置**是对的，但颜色不对：
//      0% 是全透明、25% 就已经接近满色，之后三档几乎一样 ⇒ 后 75% 看着一片平。
//   ② "还是之前那个配色" —— 配色就是原来那套：**同一支主题蓝 + 透明度**；
//      钱最少那端"接近透明"（不是浅色、不是白色），色相全程不变，也不要彩虹色。
//   ③ "说的是深浅" / "就把整条作为整体不就行了吗" —— 别手工写 5 个 alpha 色停，
//      **整条当成一个整体、只用两个端点**，由浏览器线性插值，天然均匀。
//   ⇒ 所以全站只有下面这一条**线性关系**：
//        alpha(v) = HM_ALPHA_MIN + (HM_ALPHA_MAX − HM_ALPHA_MIN) × (v / max)
//     图例条带 = `linear-gradient(to right, rgba(blue,0.06), rgba(blue,0.95))`（两个色停）；
//     热力图格子 = 同一个 alpha(v) 当 opacity。
//     于是"值为 v 的格子"与"条上 v/max 那个位置"必然相等 —— 这是**同一条直线的两端**，
//     不需要再对色停、也不需要分档。
//   ★ 端点的取值：0.06 = "接近透明"但**不是**全透明（用户要看得见有个淡块，
//     而且 0 元格子本来就不画色块）；0.95 = 最深/最显眼那一档。
const HM_ALPHA_MIN = 0.06;
const HM_ALPHA_MAX = 0.95;
// 整条只用这两个端点色（linear-gradient 的两个色停），格子与条带都从这里取值。
const HM_FILL = 'var(--theme)';

// 图例与格子共用的**透明度**：金额 → alpha。唯一一条定义，别在别处再写一套。
//   ★ 端点必须**严格**是 HM_ALPHA_MIN / HM_ALPHA_MAX：
//     金额 0（或只有 1 分钱）→ 0.06（"接近透明"，和条带 0% 端逐字节相等），
//     金额 = maxAmount → 0.95（和条带 100% 端相等）。
//   ★ "有没有画色块"由渲染端按金额决定，**不靠这里的 0**：老实现让 0 元返回 0，
//     于是图例 0% 端写成透明度 0（全透明），整条的变化就全挤在前 25% 了。
function hmAlphaOf(amount, maxAmount) {
    const v = (typeof amount === 'number' && isFinite(amount)) ? amount : 0;
    const ratio = (maxAmount > 0) ? Math.max(0, Math.min(1, v / maxAmount)) : 0;
    return HM_ALPHA_MIN + (HM_ALPHA_MAX - HM_ALPHA_MIN) * ratio;
}

// ---------- 热力图图例（0/25/50/75/100% 五档） ----------
// ★ 这里**不另造一套颜色/深浅**：五档的价格就是同一条色阶在 0/25/50/75/100% 处的取值
//   （百分比 × 最大金额）；深浅由同一个 hmAlphaOf() 给出（与图例条带同一条直线）。
//   所以"图例第 N 档"与"金额等于该档价格的格子"必然一致，改取色函数两边同时跟着变。
// ★ 图例布局/刻度写法沿用「山河地图」那条图例（.shanhe-map-legend / .shanhe-legend-bar）：
//   同一套 label + bar + label 的三段式，只是这里的条带是分段实数色、并带五个刻度。
function timelineHeatmapTiers(maxAmount) {
    const FRACS = [0, 0.25, 0.5, 0.75, 1];
    const max = (maxAmount > 0) ? maxAmount : 0;
    return FRACS.map(f => ({
        frac: f,
        percent: Math.round(f * 100),
        // ★ 只做**显示**取整（四舍五入到整数元），分档本身仍由实时 max 乘出来：
        //   max = 7193.5 时五档 = 0 / 1798 / 3597 / 5395 / 7194。
        //   100% 那档就是"最大月合计"本身，和用户手算的 7194 是同一个数。
        amount: Math.round(max * f),
        opacity: timelineHeatmapOpacity(max * f, max)
    }));
}

// ★★★ 图例五档的最大值**必须**由当前数据实时算出来（`maxAmount` = 该色阶口径下
//   最大的月度合计 = `cell.psum` 的最大值），页面里**不许**出现任何写死的档位金额。
//   历史教训：上一版色阶用的是"裸币价 + 当月评级费"（`cell.sum`），2026/02 于是算成
//   7193，而泡里写的是 7670 ⇒ 用户拿"2026 年 2 月逐日明细手算的 7194"一对就发现不对。
//   verify-heatmap 里有断言：五档金额 == 实时最大月合计 × {0,¼,½,¾,1}（四舍五入）。

// 图例条带 / 热力图格子共用的**取色**：金额 → `color-mix(in srgb, var(--theme) α%, transparent)`。
//   ★ 色相 = 主题变量，不再写死默认主题蓝（原来返回 `rgba(22, 119, 255, α)`）；
//     α 仍是 hmAlphaOf() 那条直线，与 CSS 里 `.tl-hm-legend-bar` 的两个端点同源。
//   ★ 本函数目前没有产品调用方（条带颜色由 CSS 独家负责，JS 不写颜色），
//     verify-heatmap 会读它的 α 来核对"CSS 与 JS 是同一条色阶直线"。
function timelineHeatmapColorCss(amount, maxAmount) {
    const pct = Math.round(hmAlphaOf(amount, maxAmount) * 10000) / 100;
    return `color-mix(in srgb, var(--theme) ${pct}%, transparent)`;
}

// 图例条带：**一条连续渐变**（不是几个色块），0/25/50/75/100% 五处标注该档金额，
// 中间三个节点各一根竖杠刻度（两端不画竖杠）。
// ★ 宽度与热力条一致：直接复用热力图那一套网格（2.6em + 12×--hm-cell + 同一个 gap），
//   所以左右边缘与热力图逐像素对齐，不另算宽度、也不会比热力图宽或窄。
// ★★ 条带是**一条连续渐变，整条作为一个整体**：只用**两个色停**（0% 近透明 → 100% 最深），
//   由浏览器按整条宽度线性插值 ⇒ 天然均匀，不存在"变化挤在前 25%"的问题。
//   两个端点就是 hmAlphaOf 的上下限（HM_ALPHA_MIN / HM_ALPHA_MAX），
//   与热力图格子的 opacity 是**同一条直线**，所以"值为 v 的格子"与"条上 v/max 处"必然相等。
//   ★ 5 个金额标签 + 3 根竖杠照旧保留 —— 它们只是**刻度标注**，不参与配色。
//   ★★★ 颜色**不在这里**：这条渐变的色相与两端 alpha 全在 CSS 的 `.tl-hm-legend-bar` 里
//     （`color-mix(in srgb, var(--theme) 6%/95%, transparent)`）。这里以前内联写死
//     `rgba(22, 119, 255, …)`（默认主题蓝 #1677ff）⇒ 用户报「拾年的那个渐变条写死了是默认的蓝色」。
//     JS 现在**一个颜色都不写**，只出结构 ⇒ "换个主题色不跟随"在结构上不可能再发生。
function timelineHeatmapLegendHtml(maxAmount) {
    const tiers = timelineHeatmapTiers(maxAmount);
    let html = `<div class="tl-heatmap-legend">`;
    html += `<span class="tl-hm-legend-spacer"></span>`;      // 与热力图的年份列同宽
    html += `<span class="tl-hm-legend-slot">`;               // 与那 12 个格子同宽
    // ★★ 只写 background-image，**绝对不要**再写 background-color / background 简写！
    //   踩过的坑（用户原话："现在整条都是最多钱的那个颜色"）：条带同时写了
    //   `background-color: var(--theme)` 和一条**半透明**的 linear-gradient 时，
    //   浏览器是"先把 background-color 铺满整条、再把渐变压在上面"，而渐变的 alpha
    //   只有 0.06~0.95 ⇒ 底色从半透明的缝里透出来，整条看上去就是纯主题蓝。
    //   实测（截图逐像素，同一时刻同一位置）：
    //     带 background-color：0/25/50/75/100% 全是 rgb(22,119,255)（纯色！）
    //     同渐变去掉 background-color：rgb(217,225,237) → rgb(20,112,239) 一路变深（真渐变）
    //   ⇒ 渐变必须**独占**条带的涂色层。CSS 里也钉了"条带 background-color 必须透明"的断言。
    html += `<span class="tl-hm-legend-bar tl-hm-on"></span>`;
    // 刻度：25/50/75 三根竖杠（0% 与 100% 是条带两端，不画）
    html += `<span class="tl-hm-legend-marks">`;
    for (const t of tiers) {
        if (t.percent <= 0 || t.percent >= 100) continue;
        html += `<i class="tl-hm-legend-mark" data-percent="${t.percent}" style="left:${t.percent}%"></i>`;
    }
    html += `</span>`;
    // 价格标签：都以对应位置为**中心**（left:X% + translateX(-50%)），只写金额、无括号无注解，
    // 不可点击（纯 <span>，没有 <a>、没有 href）
    html += `<span class="tl-hm-legend-ticks">`;
    for (const t of tiers) {
        html += `<span class="tl-hm-legend-tick" data-percent="${t.percent}"` +
            ` data-amount="${t.amount}" style="left:${t.percent}%">${t.amount}元</span>`;
    }
    html += `</span>`;
    html += `</span>`;
    html += `</div>`;
    return html;
}

// 金额口径必须和"这天，你一共花了X元"、标语「你共花了 N 元」完全一致：
// 只认能解析出的正数 price，取整显示。★ 改这里就等于改那两处，verify-heatmap 会盯着。
//
// ★★ 口径修正（用户裁定 2026-10）：这里返回**裸币价**
//   （自送评且非换壳 ⇒ 录入价 − 该枚评级费；否则原价）。
//   理由：录入价含评级费，重复计会让热力图/每日合计/标语一起虚高。
//   注意实现次序：本函数是"原价"的**唯一读取口**，nakedPriceOf 内部会调用它拿原价，
//   所以**绝不能**反向在这里调 nakedPriceOf —— 那会无限递归。
function timelinePriceOf(copy) {
    const raw = timelineRawPriceOf(copy);
    if (raw <= 0) return 0;
    const fee = nakedFeeOf(copy && copy.copyId);
    return (fee != null && raw - fee >= 0) ? (raw - fee) : raw;
}

// 只取**录入价**（藏品数据里写的那个 price），不做任何评级费折算。
// ★ 它只用来**派生**裸币价（timelinePriceOf = 它 − 该枚评级费），**不再直接展示**。
// ★ 用户 2026-10 的最终裁定：提示第一行"合计"要写**裸币价之和** ——
//   他拿"2026 年 2 月整月逐日明细"手算 = **7194**，而"Σ录入价"是 7670（多出这些枚
//   自己的评级费 476.5）⇒ 三行文案、热力图填色、图例、逐日明细全部统一到裸币口径。
//   （更早那版第一行写 Σ录入价 = 48721.5，与页面自己"这天你一共花了"的逐日和 44698.5
//     对不上，用户一对账就发现了。）
function timelineRawPriceOf(copy) {
    const price = parseFloat(String((copy && copy.price) || '').replace(/[^0-9.]/g, ''));
    return (!isNaN(price) && price > 0) ? price : 0;
}

// ============================================
// ===== 评级费台账 → 时间轴条目（用户裁定："评级费出现在币海拾年里"） =====
// 数据来源：notecollection/data/grading_fee.js 的 window.DATA_MAP['gradingFeeData']。
// ★ 口径（别改）：
//   ① 每条按**付款日期** paidDate 落位（不是送评日期 sentDate）；
//   ② 金额用批次里的 paidFee —— 它已经是"**匹配得上 copyId 的行**"之和
//      （匹配不上的行 = 已售出，台账里已经剔除），所以这里直接读，不再自己筛；
//   ③ 批次 4（PJ20260615262532）= 1615.5 元（汇总块字面"1,615元"是显示舍入）；
//   ④ 某批 paidFee 为 0（整批都已售出）⇒ 该批不出现在时间轴上；
//   ⑤ 展示文字**优先从藏品记录取**（用 cert 关联 copyId），台账那边只有 cert + 两个金额。
// ★ 为什么在 special.js 而不是 stats.js：这笔钱是**时间轴里的一条**，
//   与"我的"页的资金统计无关（用户明确要求「我的」保持原样）。
// ============================================

// 日元/元字符串 → 数字（"1615.5元" → 1615.5）。校验用，展示仍用原字符串。
function feeAmountOf(s) {
    const n = parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : 0;
}

// 藏品 copyId → { copy, seriesName, type, dataKey }，用于丰富台账显示（"复用原有数据"）。
// 惰性构建并缓存（时间轴会反复重渲染）；台账/藏品变了就重建。
function gradingCopyIndex() {
    const d = (window.DATA_MAP && window.DATA_MAP['gradingFeeData']) || null;
    if (!d) return {};
    if (d.__copyIndex) return d.__copyIndex;
    const idx = {};
    const maps = [
        [window.DATA_MAP, 'notes'],
        [window.COIN_DATA_MAP, 'coins'],
        [window.FUN_DATA_MAP, 'fun']
    ];
    for (const [map, type] of maps) {
        if (!map) continue;
        for (const dataKey of Object.keys(map)) {
            const data = map[dataKey];
            if (!data || !data.series) continue;
            for (const series of data.series) {
                if (series.varieties) {
                    for (const variety of series.varieties) {
                        for (const c of (variety.copies || [])) {
                            if (c && c.copyId && !idx[c.copyId]) {
                                idx[c.copyId] = { copy: c, seriesName: series.seriesName + ' - ' + variety.varietyName, type: type, dataKey: dataKey };
                            }
                        }
                    }
                } else {
                    for (const c of (series.copies || [])) {
                        if (c && c.copyId && !idx[c.copyId]) {
                            idx[c.copyId] = { copy: c, seriesName: series.seriesName, type: type, dataKey: dataKey };
                        }
                    }
                }
            }
        }
    }
    d.__copyIndex = idx;
    return idx;
}

// 台账支出之和（数字）= **未售出 且非换壳** 部分之和。
// 数据未加载 / 没有台账时返回 0，调用方据此静默跳过。
function gradingFeeTotal() {
    let sum = 0;
    for (const e of gradingFeeEntries()) sum += feeAmountOf(e.copy.price);
    return Math.round(sum * 10) / 10;
}

// ---------- 「裸币价」折算（用户裁定） ----------
// 用户口径："我自己 data 里面录入的是**含评级费**的，你显示出来应该减掉评级费"，
// 且"凡是自己送评的一律视为裸币送评，除了换壳的当作原始价格，也不算进评级费"。
//   · 能在台账里匹配上 copyId、且**不是换壳行** ⇒ 录入价 − 该枚的 paidFee = 裸币价；
//   · 换壳行 / 匹配不上台账（= 直接买来的现货）⇒ 原价，不加"裸币"也不减费。
// cert → 该枚的评级费（只在台账里出现的那一行；同一 cert 出现两次时取**第一次**，
// 与"重复编码只算第一次"的支出判据一致）。有 __feeIndex 缓存，避免每件都重扫。
function gradingFeeIndex() {
    const d = (window.DATA_MAP && window.DATA_MAP['gradingFeeData']) || null;
    if (!d || !Array.isArray(d.batches)) return {};
    if (d.__feeIndex) return d.__feeIndex;
    const idx = {};
    for (const b of d.batches) {
        for (const it of (b && b.items) || []) {
            if (!it || !it.cert || idx[it.cert]) continue;
            idx[it.cert] = { fee: feeAmountOf(it.paidFee), reholder: !!it.reholder, pj: b.pj };
        }
    }
    d.__feeIndex = idx;
    return idx;
}

// 返回"该枚的裸币价（数字）"；null = 不折算、按原样显示（换壳行 / 非自送评 /
// 价格本来就不是个能解析的正数）。
function nakedPriceOf(cert) {
    const fee = nakedFeeOf(cert);
    if (fee == null) return null;
    const idx = gradingCopyIndex();
    const copy = idx[String(cert)] && idx[String(cert)].copy;
    const price = parseFloat(String((copy && copy.price) || '').replace(/[^0-9.]/g, ''));
    if (!(price > 0)) return null;
    const naked = price - fee;
    return naked >= 0 ? naked : null;               // 减成负数说明数据对不上，别硬算
}

// 该枚要减掉的评级费（数字）；null = 不减（换壳 / 台账里没有 / 没有正面额）。
// ★ 只回答"减多少"，**不读藏品价**，所以 timelinePriceOf 可以放心调它（避免递归）。
function nakedFeeOf(cert) {
    if (!cert) return null;
    const hit = gradingFeeIndex()[String(cert)];
    if (!hit || hit.reholder) return null;          // 换壳 ⇒ 当作原始价格
    return (hit.fee > 0) ? hit.fee : null;
}

// 金额保持"数字 + 元"的人类可读写法，**不四舍五入丢精度**（903 元、1615.5 元这类都要对）。
// 只做 2 位小数的浮点收口（880 − 45 = 835；1615.5 这种本来就带一位小数）。
function formatYuan(n) {
    const r = Math.round(n * 100) / 100;
    return String(r) + '元';
}

function gradingFeeEntries() {
    const d = (window.DATA_MAP && window.DATA_MAP['gradingFeeData']) || null;
    if (!d || !Array.isArray(d.batches)) return [];
    const idx = gradingCopyIndex();
    const out = [];
    for (const b of d.batches) {
        if (!b || !b.paidDate) continue;
        // ★ 判据（用户裁定）：**匹配不到 copyId 的行视为已售出** ⇒ 这行的评级费不计入支出。
        //   台账数据文件里那 4 行已经被剔除了（check-data 也会拦），这里是**第三道防线**：
        //   万一哪天台账里混进了匹配不上的行，页面自己也不会把它算进钱里。
        // ★★ 第二条判据（用户后来裁定，推翻了早先"换壳也算评级费"）：
        //   **换壳行（reholder）当作原始价格处理 —— 不减费、也不计入评级费。**
        //   所以这里把它一并滤掉；它对应的藏品在时间轴里显示**原价**（不加"裸币"）。
        const live = (b.items || []).filter(function (it) {
            return it && idx[it.cert] && !it.reholder;
        });
        // ★ 支出按**留下的行**重算，而不是直接读 b.paidFee —— 数据正常时两者相等
        //   （数据文件里 paidFee 就是未售出行之和），异常时以行级重算为准。
        //   · items 压根没有（数据形状坏了）→ 退回读 b.paidFee，宁可显示也别静默吞掉一笔钱；
        //   · items 有、但**一行都没匹配上** → 整批已售出，支出就是 0（不回退）。
        const hasItems = Array.isArray(b.items) && b.items.length > 0;
        const amount = hasItems
            ? Math.round(live.reduce(function (s, it) { return s + feeAmountOf(it.paidFee); }, 0) * 10) / 10
            : feeAmountOf(b.paidFee);
        // ★ 整批都已售出（支出为 0）⇒ 不进时间轴：一条 0 元的"支出"没有意义
        if (amount <= 0) continue;
        const date = parseChineseDate(b.paidDate);
        if (!date || isNaN(date.getTime())) continue;
        // 展示用：从匹配到的藏品记录里取（取不到就退回批次号）
        let displayName = '批次 ' + b.pj;
        if (live.length === 1) {
            const h = idx[live[0].cert];
            const path = (typeof getCategoryPath === 'function') ? getCategoryPath(h.dataKey, h.type) : '';
            displayName = (path ? path + ' - ' : '') + h.seriesName;
        } else if (live.length > 1) {
            displayName = '批次 ' + b.pj + '（' + live.length + ' 项）';
        }
        out.push({
            // ★ 借用既有条目形状，绝不往 collectAllCopies() 的结果里塞东西：
            //   台账的 series 仍是空数组，藏品总数/均价/评级与年代统计都不受影响。
            copy: {
                // version 那一格放 PJ 编号（渲染分支直接读它当"PJ 编号"）
                version: b.pj,
                // condition 同样放 PJ 编号：数据完整性检查要能直接从条目上认出批次
                condition: b.pj,
                // 金额 = 未售出部分；带"元"，与数据文件里的写法一致
                price: String(amount) + '元',
                purchaseDate: b.paidDate
            },
            type: 'fee',
            dataKey: 'gradingFeeData',
            // 条目标题：匹配得到就从藏品取，取不到退回批次号
            seriesName: displayName,
            itemCount: live.length,
            // ★ 两个日期别搞混：
            //   · paidDate —— 付款日期（**落位口径**，也在 copy.purchaseDate 里，分组键用它）；
            //   · sentDate —— 送评日期（只是留档，卡片副行写「送评 …」）。
            paidDate: b.paidDate || '',
            sentDate: b.sentDate || '',
            // ★ 评级公司：**只在数据里**（批次的 grader 字段）。渲染端不写死、不猜、不默认，
            //   数据里没有就退回中性文案「评级费」。以后送 PMG/PCGS 只需改数据。
            grader: (typeof b.grader === 'string' ? b.grader.trim() : ''),
            // ★ 评级公司短名：圆角标签里的字（"ACG"），同样**只在数据里**。
            //   数据里没有就省略整个标签，绝不写死、也不默认成别家。
            graderShort: (typeof b.graderShort === 'string' ? b.graderShort.trim() : ''),
            // ★ 该批清单文件（xlsx）地址，同样只来自数据。缺字段 ⇒ 不渲染「下载清单」链接。
            listUrl: (typeof b.listUrl === 'string' ? b.listUrl.trim() : ''),
            date: date,
            dateStr: formatTimelineDate(date)
        });
    }
    return out;
}

// 时间轴分组的日期键。★ 必须和藏品那侧的写法**完全一致**（藏品的 purchaseDate 是
// "2025年8月5日" 这种中文写法，357 条全是），否则同一天会被分进两个 key、
// 页面上会冒出两个标题一模一样的日期分组头（债还清了也看不出来）。
function formatTimelineDate(d) {
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

// ★★★ 口径（用户裁定 2026-10，别改）：
//   `items` 里混着**藏品**和**评级费条目**（type==='fee'，由 gradingFeeEntries() 生产，见
//   renderTimelineContent）。两者在"格子的深浅"上都要算钱（那格确实出去了这么多），
//   但**提示文案的第一行只能算藏品**：
//     · 第一行「共购入N件，合计X元」= **只数藏品**，X = **Σ裸币价**（= Σ(录入价 − 该枚自己的
//       评级费)；换壳的按原价不减）。★ 最终裁定（用户 2026-10，拿 2026-02 逐日明细手算 = 7194）：
//       它必须等于该范围里"每天'这天你一共花了X元'"的**总和**，也就是热力图填色与图例五档的口径。
//       ⚠️ 早先这里写的是 **Σ录入价**（全部 = 48721.5，2026/02 = 7670），比逐日之和整整多出
//          "每一枚自己的评级费"（全部多 4023，2026/02 多 477）—— 用户一对账就发现 7670 对不上 7194。
//          ⇒ 这就是"7670 是从哪来的"的答案：**它是 Σ录入价**，把每枚各自的评级费又算了一遍。
//     · 评级费单独走台账聚合（feeByYm），出第二行；
//     · 第三行 = 第一行 + 第二行（= Σ裸币价 + 台账评级费 = Σ录入价）。
//   ⚠️ 别把这里理解成"把评级费从 byYear 里删掉" —— byYear 同时供**填色**用，删了就少钱了。
//      所以这里并行记三套数：
//        `n / sum`     = 该格**所有条目**（藏品 + 评级费）的裸币口径金额 —— 早先供填色用；
//        `pn / psum`   = **只藏品**、金额取**录入价** —— 只作校验（Σ录入价 48721.5，别拿去展示）；
//        `npn / npsum` = 只藏品、金额取**裸币价** —— ★ 现在**填色 / data-amount / 图例 / 年·月·
//                        全部三种标签泡 / 逐日"这天你一共花了"**全部走这一支（唯一展示口径）。
function buildMonthHeatmap(items) {
    const byYear = new Map();
    for (const it of items) {
        const y = it.date.getFullYear();
        const m = it.date.getMonth();                 // 0-11
        if (!byYear.has(y)) byYear.set(y, Array.from({ length: 12 }, () => ({ n: 0, sum: 0, pn: 0, psum: 0, npn: 0, npsum: 0 })));
        const cell = byYear.get(y)[m];
        cell.n++;
        cell.sum += timelinePriceOf(it.copy);
        // 只数藏品（评级费条目不过这一关）
        if (it.type !== 'fee') {
            cell.pn++; cell.psum += timelineRawPriceOf(it.copy);
            cell.npn++; cell.npsum += timelinePriceOf(it.copy);
        }
    }
    if (byYear.size === 0) return '';

    // 年份**升序**：老的在上、新的在下（用户要求）
    const years = [...byYear.keys()].sort((a, b) => a - b);
    // ★★★ 色阶的"金额"口径 = **裸币价**（`cell.npsum` = Σ「录入价 − 该枚自己的评级费」）。
    //   这就是时间轴里"这天，你一共花了 X 元"、以及泡第一行"合计"用的同一个数。
    //   ★ 用户 2026-10 拿"2026 年 2 月整月逐日明细"手算 = **7194**（= 68 件的裸币价之和
    //     7193.5，只差显示取整），色阶必须跟这个数走。
    //   ★ 踩过的两个坑（用户原话："热力图的价格还是不对"）：
    //     ① 最早用 `c.sum`（= 裸币价 **再加**当月落位的那笔评级费）⇒ 2026/02 = 8003，泡里写 7670；
    //     ② 改用 `c.psum` 后又发现 **psum 是"Σ录入价、不减评级费"**（2026/02 = 7670）
    //        —— 它比裸币价多了这些枚自己的评级费 477。
    //   ⇒ 三个数各说各话的根源就是"填色用一支口径、泡用另一支"。现在统一成 `npsum`：
    //       泡第一行合计 == 格子取色金额 == 图例五档金额 == Σ(该月逐日"这天你一共花了")
    //       == 2026/02 的 7193（用户手算 7194，差的是 7193.5 的显示取整）。
    let maxAmount = 0;
    for (const y of years) for (const c of byYear.get(y)) if (c.npsum > maxAmount) maxAmount = c.npsum;

    // 标签的泡里也要有"多少件、多少钱"（用户要求）：
    //   年份 = 全年合计；月份 = 历年这个月的合计；"全部" = 全部时间合计
    //   ★ 同样分成三套（见上面那段注释）。
    const monthTotal = Array.from({ length: 12 }, () => ({ n: 0, sum: 0, pn: 0, psum: 0, npn: 0, npsum: 0 }));
    const yearTotal = new Map();
    let allNpn = 0, allNpsum = 0;
    for (const y of years) {
        const cells = byYear.get(y);
        let n = 0, sum = 0, pn = 0, psum = 0, npn = 0, npsum = 0;
        for (let m = 0; m < 12; m++) {
            n += cells[m].n; sum += cells[m].sum;
            pn += cells[m].pn; psum += cells[m].psum;
            npn += cells[m].npn; npsum += cells[m].npsum;
            monthTotal[m].n += cells[m].n; monthTotal[m].sum += cells[m].sum;
            monthTotal[m].pn += cells[m].pn; monthTotal[m].psum += cells[m].psum;
            monthTotal[m].npn += cells[m].npn; monthTotal[m].npsum += cells[m].npsum;
        }
        yearTotal.set(y, { n, sum, pn, psum, npn, npsum });
        allNpn += npn; allNpsum += npsum;
    }
    // 文案统一成用户给的格式：x年x月，共购入x件，合计x元
    // ★★ 2026-10 用户要求改口径：**"合计"里只算购入金额，评级费单独一行**。
    //   原因（用户原话）："还有810的评级费，这会显得这个月藏品均价很高" ——
    //   1900/9 那种均价是被评级费抬起来的，不是真实藏品均价。
    //   所以：
    //     第一行 = `${lead}，共购入${n}件，合计${购入金额}元`（**不含**评级费）
    //     第二行 = `另对${k}件藏品进行评级，评级费用 ${金额} 元`（k = 该区间**有付款**的评级批次件数）
    //   该区间没有评级费 ⇒ 第二行整行不出现（绝不出现"另对 0 件… 0 元"）。
    // ★ 2026-10 追加**第三行**（用户提议）：`合计支出{购入 + 评级费}元`。
    //   为什么要有它：第一行刻意剔掉了评级费（为了均价真实），但用户仍然想看
    //   "这笔钱到底出去了多少" ⇒ 第三行把两笔加回来。
    //   ★★ 措辞必须**中性**：悬浮范围**不止"单月"一种** —— 还有「某一年」「历年某月」
    //     「全部时间」，所以绝对不能写"当月/本月"（用户专门指出："注意不一定'当月'哦，
    //     还有可能是选中某年 / 历年某月 / 全部"）。最终用用户原话的「合计支出1924元」，
    //     它对四种范围都成立；四种范围的区别只体现在**第一行的前缀**上。
    //   ★ 只在**有评级费**的范围显示：没有评级费时第三行 == 第一行，纯冗余。
    const tipOf = (lead, n, sum, fee) => {
        // ★ 金额写法：**数字与两侧文字之间一律不加空格**（用户 2026-10 明确要求
        //   "评级费用xx元，xx和两边文字之间不要空格"）—— 所以是
        //   `评级费用810元`（不是 `评级费用 810 元`）、`合计1114元`、`共购入9件`。
        //   小数只在真有小数时出现（裸币价合计可能出现 .5，比如 44698.5）。
        const money = (v) => (Math.round(Math.round(v * 10) / 10 * 100) % 100 === 0)
            ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
        // ★ 用户要求：泡里的**数字/件数加粗**，标签文字保持正常字重。
        //   用 <strong>（语义上就是"重点强调"，读屏也会强调），CSS 给 ≥600 的字重。
        const b = (s) => `<strong class="tl-hm-num">${s}</strong>`;
        // ★ 只有评级费、没有购入的范围：省略第一行，只留评级费那一行（写"共购入0件，合计0元"
        //   纯属噪音）。见 verify-heatmap 的用例。
        const head = (n > 0 || !fee || fee.k <= 0)
            ? `${lead}，共购入${b(n + '件')}，合计${b(money(sum) + '元')}`
            : '';
        const feeLine = (fee && fee.k > 0)
            ? `另对${b(fee.k + '件')}藏品进行评级，评级费用${b(money(fee.amount) + '元')}`
            : '';
        // ★★ 第三行 = 第一行 + 第二行，逐范围恒等 —— 这是"防重复计入"的核心：
        //   评级费只在这**一个**加法里出现一次，绝不再混进第一行的 sum。
        const totalLine = (fee && fee.k > 0)
            ? `合计支出${b(money(sum + fee.amount) + '元')}`
            : '';
        return [head, feeLine, totalLine].filter(Boolean).join('\n');
    };
    // ★★ 三行文本 → 两种输出形式，别混用：
    //   · `tipHtml`  → 塞进 `.tl-heatmap-tip` 的 innerHTML，用 **`<br>`** 分行。
    //     ★ 为什么不用 `\n` + `white-space:pre-line`：pre-line 会把泡的**首选宽度**
    //       （max-content）算成"最长的一个词"，于是泡被压成**一个格子的宽度**、
    //       三行文字挤成一条竖列（用户实测："泡泡的横向宽度变成只有一个热力图方块那么宽"）。
    //       `<br>` 是显式的行盒，泡的 max-content = 最长那一行的完整宽度，宽度自然恢复。
    //   · `tipPlain` → 给 aria-label 用，保留 `\n`（读屏软件按换行读，是语义正确的）。
    const tipHtml = (lead, n, sum, fee) => tipOf(lead, n, sum, fee).split('\n').join('<br>');
    // 评级费按**付款日期**落在年月（与购入金额的月份口径互不干扰）：
    //   key = 'y-m'（月份从 0 起，与 byYear 的月份下标一致）。
    //   件数用条目上的 itemCount（gradingFeeEntries 已经按"已售出/换壳"剔过了），
    //   金额直接用条目上的 copy.price（那笔实际支出）。
    const feeByYm = new Map();
    for (const e of gradingFeeEntries()) {
        const y = e.date.getFullYear(), m = e.date.getMonth();
        const key = y + '-' + m;
        const cur = feeByYm.get(key) || { k: 0, amount: 0 };
        cur.k += (e.itemCount != null ? e.itemCount : 1);
        cur.amount += feeAmountOf(e.copy.price);
        feeByYm.set(key, cur);
    }
    const feeAt = (y, m) => feeByYm.get(y + '-' + m) || null;
    // 「历年这个月」= 各年这个月的合计（购入 + 评级费都要跨年累加）
    const monthFee = Array.from({ length: 12 }, () => ({ k: 0, amount: 0 }));
    for (const [key, v] of feeByYm) {
        const m = +key.split('-')[1];
        monthFee[m].k += v.k; monthFee[m].amount += v.amount;
    }
    // 全年 / 全部时间的评级费
    let allFeeK = 0, allFeeAmount = 0;
    const yearFee = new Map();
    for (const [key, v] of feeByYm) {
        const y = +key.split('-')[0];
        const cur = yearFee.get(y) || { k: 0, amount: 0 };
        cur.k += v.k; cur.amount += v.amount;
        yearFee.set(y, cur);
        allFeeK += v.k; allFeeAmount += v.amount;
    }

    const allActive = (timelineFilterYear === '全部' && timelineFilterMonth === '全部');
    // ★★★ 用户 2026-XX（**两次修正后收口，前面两版都别再来回改**）：
    //   第一次：「不是，发光效果是要求热力图那个**月份的小方块**边缘发光，怎么变成了热力图发光？」
    //     ⇒ 发光对象是**月份"格子"本身**，**不是**整块热力图、也不是网格的外框。早前那一版把光画在
    //       容器/网格外框上，已撤掉（layout.css 里 `.tl-heatmap.hm-single-month` 那套规则、容器的
    //       position: relative、以及为算外框宽度而引入的 --hm-gap 全部删除，容器样式回到改动前）。
    //   第二次（最终口径）：「**只有单个月分发光**」+ 追问里明确选「选'历年 X 月'（年份=全部）时，
    //     干脆不发光」 ⇒ 判据收紧成：**只有"年份"与"月份"都落在具体的某一个值上**（唯一确定一个
    //     格子）时才发光，其余一律不发光。于是：
    //       · 2026 年 10 月（年+月都具体）⇒ **恰好那 1 格**发光；
    //       · 历年 7 月（年=全部、月=07）⇒ **0 格**（**不是**每一年都亮一排）；
    //       · 只筛某一年（月=全部）⇒ **0 格**；全部时间 ⇒ **0 格**。
    //   ⇒ 判据 = ① 月份落在唯一一个月上（`timelineFilterMonth` 只会是 '全部' 或 '01'…'12'）；
    //            ② 年份落在具体某一年上（`timelineFilterYear`，'全部' ⇒ 不发光）；
    //            ③ ①② 都成立（`glowOne`）才在下面 12 格的循环里**逐格比对格子自己的年月**
    //               （`glowMonth === m + 1 && String(y) === glowYear`）—— 唯一确定的那一格亮。
    //   ★ 为什么必须"逐格"比对而不是去看筛选出的那几条记录：热力图是"历年全景"，它渲染的是
    //     validItems 里出现过的**所有年份**（年份筛选只筛下面那张列表、不会让热力图少渲染行），
    //     所以"只亮一格"这件事只能由发光自己拿格子自己的 data-year/data-month 来判定
    //     （早前只按月份发光时实测"2025 年 10 月"那格会跟着亮，一共 2 格）。
    //   · 用 Number()/String() 归一化，'7' 与 '07'、2026 与 '2026' 都能对上
    //     （下拉里的值一定是补零的两位，applyTimelineFilter 也补零）。
    //   · 样式全在 layout.css 的 `.tl-heatmap-cell.hm-month-glow`：格子自己的**出流伪元素** +
    //     box-shadow（只用边缘发光，不碰尺寸/间距/盒子模型）⇒ 格子/行/图例/容器的矩形逐值不变。
    //   · 类只加在**拾年专题**的月份格子上；别的板块根本没有热力图，不会被误伤。
    const glowYear = (timelineFilterYear === '全部') ? '' : String(timelineFilterYear);
    const glowMonth = (timelineFilterMonth !== '全部') ? Number(timelineFilterMonth) : 0;
    const glowOne = (glowYear !== '' && glowMonth > 0);   // 年月都具体 ⇒ 唯一确定一个格子
    let html = `<div class="tl-heatmap">`;

    // 表头：左上角"全部"（点它回到全部时间）+ 12 个月份（点它看历年这个月）
    // ★ 标签也用**自写悬浮泡**（同一套 .tl-heatmap-tip），不用原生 title：
    //   原生 tooltip 又慢又丑、样式不可控，而且在触摸设备上根本不出现。
    //   data-label 存住纯文本，方便用例和样式按"这一格是谁"来取（textContent 会被悬浮泡文案污染）。
    // ★★ 用户 2026-10 最终口径（**两次修正后收口，别再来回改**）：
    //   ① 左上角按钮的**可见文字** = 「全部」（不变）；
    //   ② **只有**这个按钮的**泡里**、也就是「全部」范围的统计提示，前缀用「入坑以来，」
    //      （例如「入坑以来，共购入380件，合计48721.5元」）；
    //   ③ 其它范围（单月 / 某年 / 历年某月）的前缀保持原样，**不许**扩散这个词。
    html += `<div class="tl-heatmap-row tl-hm-head">`;
    html += `<div class="tl-heatmap-ylabel tl-hm-corner${allActive ? ' is-active' : ''}" role="button" tabindex="0"` +
        ` data-label="全部" aria-label="回到全部数据：${escapeAttr(tipOf('入坑以来', allNpn, allNpsum, { k: allFeeK, amount: allFeeAmount }))}"` +
        ` onclick="applyTimelineFilter('全部','全部')">全部` +
        `<span class="tl-heatmap-tip">${tipHtml('入坑以来', allNpn, allNpsum, { k: allFeeK, amount: allFeeAmount })}</span></div>`;
    for (let m = 1; m <= 12; m++) {
        const sel = (timelineFilterYear === '全部' && timelineFilterMonth === String(m).padStart(2, '0')) ? ' is-active' : '';
        const mt = monthTotal[m - 1];
        const mtip = tipOf(`历年${m}月`, mt.npn, mt.npsum, monthFee[m - 1]);
        html += `<div class="tl-heatmap-mlabel${sel}" role="button" tabindex="0" data-label="${m}"` +
            ` aria-label="看历年 ${m} 月：${escapeAttr(mtip)}"` +
            ` onclick="applyTimelineFilter('全部', ${m})">${m}` +
            `<span class="tl-heatmap-tip">${tipHtml(`历年${m}月`, mt.npn, mt.npsum, monthFee[m - 1])}</span></div>`;
    }
    html += `</div>`;

    for (const y of years) {
        const cells = byYear.get(y);
        const yt = yearTotal.get(y);
        const ytip = tipOf(`${y}年`, yt.npn, yt.npsum, yearFee.get(y) || null);
        const rowSel = (timelineFilterYear === String(y) && timelineFilterMonth === '全部') ? ' is-active' : '';
        // ★★ 最上面那一年的数据行标记成 tl-hm-first-row：它的泡**要往下弹**（见 layout.css），
        //   因为泡一律朝上弹、而第一行上面只有表头 + 14px，容不下三行的泡（会顶出热力图）。
        //   这一行只加 class，不动任何间距 —— 用户明确要求"热力图到上方的距离跟以前一样"。
        html += `<div class="tl-heatmap-row${y === years[0] ? ' tl-hm-first-row' : ''}">`;
        // ★ --hm-yearsum = 这一年 12 格的金额之和（= 裸币口径的"全年购入合计"）。
        //   ★ 它由下面那 12 个格子的 `cell.npsum` 相加得到，渲染时直接写出来，
        //     verify-heatmap 会拿"该年各月逐日合计之和"对它做断言（自洽性判据）。
        html += `<div class="tl-heatmap-ylabel${rowSel}" role="button" tabindex="0" data-label="${y}"` +
            ` style="--hm-yearsum:${Math.round(yt.npsum * 10) / 10}"` +
            ` aria-label="看 ${y} 年全年：${escapeAttr(ytip)}"` +
            ` onclick="applyTimelineFilter(${y}, '全部')">${y}` +
            `<span class="tl-heatmap-tip">${tipHtml(`${y}年`, yt.npn, yt.npsum, yearFee.get(y) || null)}</span></div>`;
        for (let m = 0; m < 12; m++) {
            const c = cells[m];
            // 连续深浅：直接把这个格子的金额在色阶上的位置算成**透明度**
            // （CSS 读不到 DOM 里的金额，所以只能由 JS 给值；这不是给 tooltip 写内联样式）
            // ★ 有没有色块由**金额**决定（0 元 = 不画），alpha 由 hmAlphaOf 给；
            //   o > 0 只为沿用既有 CSS 钩子（--hm-o / .tl-hm-on），0 元时干脆不写这两个东西。
            // ★ 取色与泡泡**同一个金额**（cell.npsum = 裸币价）：这样"最深的格子"就是
            //   图例 100% 那档、"泡里第一行的合计"也等于这个数，三处永远一致。
            const o = (c.npsum > 0) ? timelineHeatmapOpacity(c.npsum, maxAmount) : 0;
            // ★★ 格子 = 主题蓝实色 + 该档 alpha，与图例条带**同一个函数、同一组 5 档 alpha**。
            //   底色的实色统一走 CSS 里的 .tl-hm-fill（background: var(--theme)），
            //   这里只写 opacity ⇒ 主题色换了格子跟着换，而"图例↔格子 alpha 逐档相等"不变。
            const bright = (maxAmount > 0) ? Math.min(1, c.npsum / maxAmount) : 0;
            // --hm-src = 这一格的原始金额；--hm-bright = 0→1 的档位比例（最亮那档 = 1）；
            // --hm-o 就是这一档的 alpha（CSS 直接用它当 opacity）。
            const styleAttr = o > 0
                ? ` style="--hm-o:${Math.round(o * 1000) / 1000};--hm-src:${Math.round(c.npsum * 10) / 10};--hm-bright:${bright.toFixed(3)}"`
                : '';
            // tl-hm-on 只为"有金额"的格子加：深色主题那条压暗滤镜只该作用在它们身上
            const onClass = o > 0 ? ' tl-hm-on' : '';
            const label = tipOf(`${y}年${m + 1}月`, c.npn, c.npsum, feeAt(y, m));
            const edge = m === 0 ? ' tl-hm-first' : (m === 11 ? ' tl-hm-last' : '');
            // ★ 这一格是否就是"年月都筛上"唯一确定的那一格（见 buildMonthHeatmap 开头的口径）：
            //   拿**格子自己的** y / m 与筛选的年月逐格比对 ⇒ 只有一格会得到 hm-month-glow。
            const glow = (glowOne && glowMonth === m + 1 && String(y) === glowYear) ? ' hm-month-glow' : '';
            html += `<div class="tl-heatmap-cell${edge}${onClass}${glow}"${styleAttr} tabindex="0" role="button"` +
                ` data-year="${y}" data-month="${String(m + 1).padStart(2, '0')}"` +
                ` data-amount="${Math.round(c.npsum * 10) / 10}" data-bright="${bright.toFixed(3)}"` +
                ` data-alpha="${o > 0 ? o : ''}"` +
                ` aria-label="${escapeAttr(label)}" onclick="onHeatmapCellClick(${y}, ${m + 1})">` +
                `<i class="tl-hm-fill"></i><span class="tl-heatmap-tip">${tipHtml(`${y}年${m + 1}月`, c.npn, c.npsum, feeAt(y, m))}</span></div>`;
        }
        html += `</div>`;
    }
    // ★ 色阶图例贴在热力图正下方（用户要求"加一条类似山河地图那样的指示条带"）：
    //   0/25/50/75/100% 五处标出该档对应的金额，颜色与热力图同一套取色函数。
    html += timelineHeatmapLegendHtml(maxAmount);
    html += `</div>`;
    return html;
}

// 统一的筛放入口：year / month 都可以是 '全部'，或者数字/数字字符串
function applyTimelineFilter(year, month) {
    const ys = document.getElementById('timelineYearFilter');
    const ms = document.getElementById('timelineMonthFilter');
    if (ys) ys.value = (year === '全部') ? '全部' : String(year);
    if (ms) ms.value = (month === '全部') ? '全部' : String(month).padStart(2, '0');
    // 走统一入口：URL 同步 + 回到顶部 + 只让下面的时间轴动一次，都在那里
    if (typeof onTimelineFilterChange === 'function') onTimelineFilterChange();
}

// 点格子 = 这一年 + 这一个月
function onHeatmapCellClick(year, month) { applyTimelineFilter(year, month); }

// ---------- 悬浮泡的水平位置：能居中就居中 ----------
// 规则（用户要求）：**尽可能居中于它描述的东西**，只有会越出热力图左右边界时才往里挤。
// "它描述的东西"对格子就是格子本身；对标签是**文字**（年份数字靠右、月份数字居中，
// 对着整块可点击区域的中心会显得箭头指着框，用户两次指出）—— 所以靶心取文字中心。
// 为什么不是纯 CSS：泡宽随文案变、格子随视口变，写死"第几列不居中"就会"放得下也被挤"。
// JS 只算两个变量：--hm-tx（水平位移）和 --hm-arrow（尖角位置），
// 泡的显示/隐藏、配色、尖角形状、动画全都还在 CSS 里，JS 不碰 left/top/position。
function clampHeatmapTip(el) {
    const tip = el && el.querySelector(':scope > .tl-heatmap-tip');
    if (!tip) return;
    // 年份标签的泡由 CSS 定死在数字右边（尖角在泡的左侧竖边上），不参与居中/纠偏
    if (el.classList.contains('tl-heatmap-ylabel') && !el.classList.contains('tl-hm-corner')) return;
    const hm = el.closest('.tl-heatmap');
    if (!hm) return;
    tip.style.removeProperty('--hm-tx');
    tip.style.removeProperty('--hm-arrow');
    const box = el.getBoundingClientRect();
    // ★ 宽度取小数（offsetWidth 会取整，手机上会差 2~3px）。泡虽然还是隐藏状态，但布局已经算好了。
    const w = tip.getBoundingClientRect().width;
    if (!box.width || !w) return;
    // ★ 左右边界取**内容容器**（屏幕可见区），不是热力图本身 —— 用户要求"窄屏时泡不要超出屏幕边界"，
    //   热力图在宽屏下只占中间一条，拿它当界会把泡过早往里挤。
    //   上下仍然不能超出热力图：那个由 CSS 保证（泡一律朝上弹，表头那一行给它们留了空间）。
    const bounds = (() => {
        const mc = (typeof getRenderContainer === 'function' && getRenderContainer()) || null;
        if (mc && mc.getBoundingClientRect) {
            const r = mc.getBoundingClientRect();
            if (r.width) return { left: r.left, right: r.right };
        }
        const rootW = document.documentElement.clientWidth || window.innerWidth || 0;
        return { left: 0, right: rootW };
    })();
    const boxCenter = box.left + box.width / 2;
    // 靶心：标签取文字中心（"全部"/月份的数字），格子（没有直接文字节点）取方块中心
    const textNode = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    let anchor = boxCenter;
    if (textNode) {
        const rg = document.createRange();
        rg.selectNodeContents(textNode);
        const rr = rg.getBoundingClientRect();
        if (rr.width) anchor = rr.left + rr.width / 2;
    }
    // 先按靶心居中（--hm-tx 的基准 -50% 是"居中于方块"，这里补上靶心相对方块中心的偏移），
    // 只有会越出热力图左右边界时才往里挤。
    // ★ 这里只算几何意图，**不碰 transition、也不测量动画中的位置**：一冻 transition
    //   淡入动画就没了（用户反馈"只有退出动画"）；量动画中的位置又会把偏差反复累加。
    const pad = 1.5;
    const naturalL = anchor - w / 2;
    let shift = 0;
    if (naturalL < bounds.left + pad) shift = (bounds.left + pad) - naturalL;
    else if (naturalL + w > bounds.right - pad) shift = (bounds.right - pad) - (naturalL + w);
    tip.style.setProperty('--hm-tx', `calc(-50% + ${(anchor - boxCenter + shift).toFixed(2)}px)`);
    // 尖角落在靶心上
    const arrow = Math.max(8, Math.min(w - 8, w / 2 - shift));
    tip.style.setProperty('--hm-arrow', `${arrow.toFixed(2)}px`);
}

let heatmapTipClampBound = false;
function bindHeatmapTipClamp() {
    if (heatmapTipClampBound) return;
    heatmapTipClampBound = true;
    const pick = (e) => {
        const t = e.target;
        if (!t || typeof t.closest !== 'function') return null;
        return t.closest('.tl-heatmap-cell, .tl-heatmap-ylabel, .tl-heatmap-mlabel');
    };
    // 事件委托：热力图上的方块有几十个，别逐个绑。
    // 只算几何（不碰 transition），所以不需要等下一帧再校一次——淡入/位移动画照旧由 CSS 负责。
    const run = (el) => clampHeatmapTip(el);
    document.addEventListener('mouseover', (e) => { const el = pick(e); if (el) run(el); });
    document.addEventListener('focusin', (e) => { const el = pick(e); if (el) run(el); });
}

// ---------- 泡泡几何的"冻结"防护 ----------
// 起因（用户反馈）：冷启动（直接打开/刷新 #special/timeline）时"首次悬浮高亮后数字会沉一点、
// 而且不会回到原位"；从站内点进来却看不到。
//
// 冷启动的实测（逐帧采样，1280×900 dpr=1）：
//   t≈500ms 专题面板与热力图第一次出现，t≈690~770ms 期间**整块**还在往上走约 10.5px，
//   起点是祖先链上的布局动画（同一次任务里 view 滚动容器的可用高度 819.078 → 826 逐帧插值，
//   `.body-row` 的 top 7.92 → 1）。热力图元素**自己**的矩形在这段里一动没动（左 346.734、
//   宽 43.516 全程恒定，泡泡相对格子的偏移恒为 0.000px），所以这本身不是"数字沉降"；
//   但它意味着：**用户第一次悬浮很可能落在"整页还在动"的窗口里**。
//   一旦 clampHeatmapTip 在这次窗口里量了 getBoundingClientRect()，它算出来的
//   `--hm-tx` / `--hm-arrow` 就带着那一刻的几何被写死在行内 style 上；
//   而这两个值只有"下一次鼠标移到某个格子/标签上"才会被重算——
//   于是动画结束、整块落位之后，泡泡相对格子就**永久偏了一点**（这正是"不会回到原来的地方"）。
//
// 实测（早悬浮 vs 等稳定后再悬浮，都取"相对格子"的偏移）目前都是 0.000px —— 也就是说
// 这条时序在**当前**代码里没有被触发；但它是"把测量结果缓存到行内样式上"这个写法的固有风险，
// 任何祖先动画（侧栏收起、顶部工具条/图片撑高、系统字体换挡……）都会把它变成真实的错位。
// 所以这里加一层**与动画无关**的兜底：布局一旦改动，就把已经写下的泡泡几何**重算一遍**。
//
// ★ 两条铁律（踩过坑才这么写）：
//   ① 只在**布局落位**之后重算。resize 事件/ResizeObserver 回调往往正好落在动画的
//      **第一帧**（此时量到的是动画起点），所以回调里必须等动画时长过去再量；
//   ② 只重算**已经量过**的泡泡（行内已有 --hm-tx）。没量过的（用户还没碰）一个都不碰，
//      既零开销，也绝不会凭空给泡泡写几何。
//      ↑ 这条原来漏了：ResizeObserver 一上来就把**没量过**的泡泡也重算了一遍，
//        等于凭空给它们写了 --hm-tx。已修正为只处理"行内已有 --hm-tx"的。
const HM_TIP_REFRESH_DELAY = 340;   // 略大于 .content-enter 的 --dur-enter(0.3s) 与各布局过渡(0.22~0.3s)
let heatmapTipObserver = null;
let heatmapTipTimer = 0;
function refreshHeatmapTipGeometry(root) {
    const hm = (root && root.nodeType === 1 && root.classList && root.classList.contains('tl-heatmap'))
        ? root
        : (root && root.querySelector ? root.querySelector('.tl-heatmap') : document.querySelector('.tl-heatmap'));
    if (!hm) return;
    let n = 0;
    for (const tip of hm.querySelectorAll('.tl-heatmap-tip')) {
        // ★ 只重算"已经被量过"的：没有 --hm-tx 说明用户还没碰过它，不需要动
        if (!tip.style.getPropertyValue('--hm-tx')) continue;
        const el = tip.parentElement;
        if (el) { clampHeatmapTip(el); n++; }
    }
    return n;
}
function watchHeatmapTipGeometry(hm) {
    if (!hm) return;
    const schedule = () => {
        if (heatmapTipTimer) clearTimeout(heatmapTipTimer);
        // 等布局动画结束（不是等"下一帧"）
        heatmapTipTimer = setTimeout(() => { heatmapTipTimer = 0; refreshHeatmapTipGeometry(hm); }, HM_TIP_REFRESH_DELAY);
    };
    if (typeof ResizeObserver === 'function') {
        if (!heatmapTipObserver) heatmapTipObserver = new ResizeObserver(schedule);
        heatmapTipObserver.disconnect();
        heatmapTipObserver.observe(hm);
        // 热力图**上方/下方**的东西长高长矮不会改热力图的尺寸，所以渲染容器也一起盯着
        const host = (typeof getRenderContainer === 'function' && getRenderContainer()) || null;
        if (host) heatmapTipObserver.observe(host);
    }
    schedule();
}

// ---------- 时间轴的"搜索式进出场"（FLIP） ----------
// 用户要求：换时间段/换排序时，下面的列表要像**纸币/硬币搜索结果**那样条目自己滑进滑出
// （位移同时含左右与上下），而不是整块重刷一下。参考实现在 search.js / article.js：
//   ① 改 DOM 前记下每个条目的 key 与屏幕位置；② 改完算位移，先反向平移再过渡回原位；
//   ③ 新条目从右侧滑入；④ 被筛掉的条目滑出后消失。
// ★ 与 search.js 的关键区别：时间轴是**整块 app.innerHTML = html 重建**的，改完之后
//   旧节点已经不存在了（不像搜索结果那样能移动真节点），所以：
//   · 保留条目的 FLIP 只靠 key→旧位置 的映射（新节点套用同一位移即可，FLIP 不要求同一个节点）；
//   · 退场替身必须在改 DOM **之前**用 cloneNode 留一份（只克隆可视区附近的，避免几百个条目全克隆）。
const TL_FLIP_EASE = 'transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.32s ease';
const TL_FLIP_DX = 40;          // 新条目从右侧 40px 处滑入（与搜索结果同一个量）

function timelineFlipEnabled() {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function snapshotTimelineFlip(app) {
    const snap = { items: new Map(), host: null };
    if (!app || !timelineFlipEnabled()) return snap;
    const host = app.getBoundingClientRect();
    snap.host = host;
    // 只克隆"看得见"的那些（上下各放宽 200px）：退场动画本来也只对可视区有意义，
    // 不这么限制的话，从"全部"收窄筛选会把几百个条目一起 clone，白费一次大开销。
    const viewTop = Math.max(host.top, 0) - 200;
    const viewBottom = Math.min(host.bottom, window.innerHeight) + 200;
    app.querySelectorAll('.timeline-item').forEach(el => {
        const key = el.dataset.flipKey;
        if (!key || snap.items.has(key)) return;
        const r = el.getBoundingClientRect();
        const visible = r.bottom > viewTop && r.top < viewBottom;
        snap.items.set(key, {
            left: r.left - host.left,
            top: r.top - host.top,
            w: r.width,
            h: r.height,
            visible,
            clone: visible ? el.cloneNode(true) : null
        });
    });
    return snap;
}

function playTimelineFlip(app, snap) {
    // ★ 注意这里**不能**要求 snap.items 非空：上一屏是空状态（"显然，在选择的这个时间段
    //   你并没有乱花钱"）时一个条目都没有，那正是"从无到有"最需要动画的时候 —— 早先加了
    //   size === 0 就 return，结果这种情形下新条目直接蹦出来（用户反馈"缺少从无到有的动画"）。
    if (!app || !snap || !snap.host) return;
    if (!timelineFlipEnabled()) return;
    const host = app.getBoundingClientRect();
    const moving = [];
    const seen = new Set();
    // ★ 只给"可视区附近"的条目播动画（上下各放宽 200px）：屏幕外的条目本来也看不见，
    //   而"从一年放开到全部"会一次多出三百多个条目 —— 全都挂 transition 会明显卡顿。
    //   这与 search.js 里的做法一致（那边对首屏以下的条目只做延迟淡入）。
    const viewTop = host.top - 200;
    const viewBottom = Math.min(host.bottom, window.innerHeight) + 200;

    // ① 已经在页面上的条目：新条目从右侧滑入，保留条目从旧位置滑到新位置（dx/dy 都算）
    app.querySelectorAll('.timeline-item').forEach(el => {
        if (!el.dataset.flipKey) return;
        const old = snap.items.get(el.dataset.flipKey);
        if (old) seen.add(el.dataset.flipKey);
        const r = el.getBoundingClientRect();
        const near = r.bottom > viewTop && r.top < viewBottom;
        if (!near) return;
        let dx, dy;
        if (old) {
            dx = (snap.host.left + old.left) - r.left;
            dy = (snap.host.top + old.top) - r.top;
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;   // 位置没动就别播
        } else {
            dx = TL_FLIP_DX;
            dy = 0;
        }
        el.style.transition = 'none';
        el.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
        if (!old) el.style.opacity = '0';
        moving.push(el);
    });

    // ② 这一版里消失的条目：把改 DOM 前留的克隆贴到原位置，做退场替身滑出去
    const ghosts = [];
    for (const [key, old] of snap.items) {
        if (seen.has(key) || !old.clone || !old.visible) continue;
        const g = old.clone;
        g.classList.add('timeline-flip-ghost');
        g.querySelectorAll('.timeline-flip-ghost').forEach(x => x.classList.remove('timeline-flip-ghost'));
        g.style.position = 'fixed';
        g.style.left = (snap.host.left + old.left) + 'px';
        g.style.top = (snap.host.top + old.top) + 'px';
        g.style.width = old.w + 'px';
        g.style.height = old.h + 'px';
        g.style.margin = '0';
        g.style.pointerEvents = 'none';
        g.style.zIndex = '90';
        g.style.transition = 'none';
        g.style.transform = 'translate(0, 0)';
        g.style.opacity = '1';
        document.body.appendChild(g);
        ghosts.push(g);
    }

    if (moving.length === 0 && ghosts.length === 0) return;

    // 先把起始态渲染出去（一次回流），下一帧再统一过渡到落位状态
    void app.offsetHeight;
    requestAnimationFrame(() => {
        for (const el of moving) {
            el.style.transition = TL_FLIP_EASE;
            el.style.transform = '';
            el.style.opacity = '';
        }
        for (const g of ghosts) {
            g.style.transition = TL_FLIP_EASE;
            g.style.transform = 'translateX(' + TL_FLIP_DX + 'px)';
            g.style.opacity = '0';
            const done = () => { g.removeEventListener('transitionend', done); if (g.parentNode) g.remove(); };
            g.addEventListener('transitionend', done);
            // ★ 兜底：某些情况下 transitionend 不会来（元素被隐藏、动画被合并…），
            //   留一个定时器保证替身一定被清掉 —— 否则它会一直盖在页面上、还会挡住点击。
            setTimeout(() => { if (g.parentNode) g.remove(); }, 700);
        }
    });

    // 动画结束后清掉内联 style：残留的 transform/opacity 会让下一次测量（FLIP 本身、
    // 热力图泡的边界判断）读到错的几何。
    setTimeout(() => {
        for (const el of moving) {
            el.style.transition = '';
            el.style.transform = '';
            el.style.opacity = '';
        }
    }, 420);
}

// ★ 这里原来是 animateTimelineBodyOnly()：换筛选时给 .timeline-body 挂一次 content-enter 淡入。
//   用户后来要求"像纸币/硬币搜索结果那样的进出场（左右滑动和上下滑动）"，条目的滑入滑出
//   已经由上面的 snapshotTimelineFlip / playTimelineFlip 负责，整块再淡入反而糊，
//   所以那个函数已经删掉，换筛选/换排序一律走 FLIP。

// ★★★ 保壳复用：整块重渲染时不让顶部那套自绘下拉被拆掉重建。
//
// 用户的反馈："为什么每次换选择的时间段，那个下拉栏就像是要'重建'一下，闪动一下。"
// 实测根因（`%TEMP%/hmdiag/paint.mjs` 逐帧）：
//   `renderTimelineContent` 用 `app.innerHTML = html` 整块换掉内容，而 `.dd` 就写在
//   那段 html 里 —— 老壳（连同 `.dd-trigger` / `.dd-label-text` 与它们的监听器）作为旧
//   子树被丢弃，新 `<select>` 身上没有 `__dd`，建壳又要等 rAF（dropdown.js 的 `schedule`）
//   或 32ms 去抖 ⇒ **中间那一帧被真的画了出来**：
//     t=2394.8ms  .dd=0（原生被 CSS 藏着）⇒ 控件区域一片空白，
//     `.timeline-top-right` 从 422.77px 塌到 214.77px，"共N件"和两个排序按钮整排横移，
//     下一帧（t=2408.5ms）才弹回来。空白 + 208px 横移叠加 = 用户看到的"闪动/像重建"。
//
// 为什么不能靠 dropdown.js 自己的 MutationObserver 兜住：那条路是"内容先画、控件后补"，
//   而浏览器的绘制发生在 JS 让出之后 —— 补的那一帧一定晚于画的那一帧。
// 所以这里反过来做：**先把壳摘下来保住，换完内容再认领回去**。
//   `captureCustomDropdowns` / `adoptCustomDropdowns` 由 dropdown.js 提供（只增不改的导出）。
//   壳节点身份全程不变，只有弹层里的选项子节点按新 options 重建（年份集合本来就会变）。
//   `enhance()` 见到 `select.__dd` 就 return，所以"认领"过的 select 不会再被建一次壳。
// ★ 没有旧壳可认领时（首次渲染）兜底走同步建壳 `refreshCustomDropdownsNow`，
//   保证"内容与壳在同一个任务里同时就位"，同样不留空白帧。
function renderIntoContainerWithDropdowns(app, html) {
    var capture = (typeof window.captureCustomDropdowns === 'function') ? window.captureCustomDropdowns : null;
    var adopt = (typeof window.adoptCustomDropdowns === 'function') ? window.adoptCustomDropdowns : null;
    // ① 重渲染前：把现存的自绘壳摘到游离容器（节点身份、监听器、__dd 记录全保留）
    var pen = capture ? capture(app) : null;
    // ② 整块替换（原有行为一字未改）
    app.innerHTML = html;
    // ③ 重渲染后：把壳认领给新一批同 id 的 <select>
    var adopted = adopt ? adopt(app, pen) : 0;
    // ④ 兜底：还有没被认领的 select（首次渲染 / 新增的下拉），同步建壳。
    //    刻意**同步**调用而不是 `refreshCustomDropdowns()`（=schedule，只排 rAF）——
    //    排到下一帧就等于把空白帧留在画面上。
    if (typeof window.refreshCustomDropdownsNow === 'function') {
        window.refreshCustomDropdownsNow();
    } else if (typeof window.refreshCustomDropdowns === 'function') {
        window.refreshCustomDropdowns();
    }
    // ⑤ 仍然排一次延迟的建壳/重压：认领回来的壳在容器刚 un-hide 时量到的可用宽可能是 0，
    //    压扁要等布局定下来再补一次（与原来调 refreshCustomDropdowns() 的效果一致）。
    if (typeof window.refreshCustomDropdowns === 'function') window.refreshCustomDropdowns();
    return adopted;
}

// ---------- 核心渲染 ----------
function renderTimelineContent(config, opts) {
    // ★ opts.keepChrome：换年月/换排序触发的重渲染。此时标题、热力图、顶部工具条
    //   保持原样不重播进入动画，只有下面的时间轴列表淡入一次。
    const keepChrome = !!(opts && opts.keepChrome);
    const app = getRenderContainer();
    // ★ FLIP 的"旧位置"必须在改 DOM **之前**量：时间轴是整块 innerHTML 重建的，
    //   改完之后旧节点就不在了（退场替身也因此要在这里先 clone 好）。
    //   只有换筛选/换排序（keepChrome）需要 —— 进入专题那一次走的是整页进入动画。
    const flipSnap = keepChrome ? snapshotTimelineFlip(app) : null;

    const items = [];

    // ===== 纸币数据 =====
    if (window.DATA_MAP) {
        const entries = Object.entries(window.DATA_MAP);
        for (const [dataKey, data] of entries) {
            if (!data || !data.series) continue;
            for (let si = 0; si < data.series.length; si++) {
                try {
                    const series = data.series[si];
                    if (!series) continue;

                    if (series.varieties && Array.isArray(series.varieties)) {
                        for (let vi = 0; vi < series.varieties.length; vi++) {
                            const variety = series.varieties[vi];
                            if (!variety || !variety.copies || !Array.isArray(variety.copies)) continue;
                            for (let ci = 0; ci < variety.copies.length; ci++) {
                                const copy = variety.copies[ci];
                                if (copy && copy.purchaseDate) {
                                    const date = parseChineseDate(copy.purchaseDate);
                                    if (date) {
                                        items.push({
                                            copy: copy,
                                            type: 'notes',
                                            dataKey: dataKey,
                                            seriesName: series.seriesName + ' - ' + variety.varietyName,
                                            date: date,
                                            dateStr: copy.purchaseDate
                                        });
                                    }
                                }
                            }
                        }
                    } else if (series.copies && Array.isArray(series.copies)) {
                        for (let ci = 0; ci < series.copies.length; ci++) {
                            const copy = series.copies[ci];
                            if (copy && copy.purchaseDate) {
                                const date = parseChineseDate(copy.purchaseDate);
                                if (date) {
                                    items.push({
                                        copy: copy,
                                        type: 'notes',
                                        dataKey: dataKey,
                                        seriesName: series.seriesName,
                                        date: date,
                                        dateStr: copy.purchaseDate
                                    });
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[时间轴] 纸币数据遍历出错（已跳过）:', e);
                }
            }
        }
    }

    // ===== 硬币数据 =====
    if (window.COIN_DATA_MAP) {
        const entries = Object.entries(window.COIN_DATA_MAP);
        for (const [dataKey, data] of entries) {
            if (!data || !data.series) continue;
            for (let si = 0; si < data.series.length; si++) {
                try {
                    const series = data.series[si];
                    if (!series) continue;

                    if (series.varieties && Array.isArray(series.varieties)) {
                        for (let vi = 0; vi < series.varieties.length; vi++) {
                            const variety = series.varieties[vi];
                            if (!variety || !variety.copies || !Array.isArray(variety.copies)) continue;
                            for (let ci = 0; ci < variety.copies.length; ci++) {
                                const copy = variety.copies[ci];
                                if (copy && copy.purchaseDate) {
                                    const date = parseChineseDate(copy.purchaseDate);
                                    if (date) {
                                        items.push({
                                            copy: copy,
                                            type: 'coins',
                                            dataKey: dataKey,
                                            seriesName: series.seriesName + ' - ' + variety.varietyName,
                                            date: date,
                                            dateStr: copy.purchaseDate
                                        });
                                    }
                                }
                            }
                        }
                    } else if (series.copies && Array.isArray(series.copies)) {
                        for (let ci = 0; ci < series.copies.length; ci++) {
                            const copy = series.copies[ci];
                            if (copy && copy.purchaseDate) {
                                const date = parseChineseDate(copy.purchaseDate);
                                if (date) {
                                    items.push({
                                        copy: copy,
                                        type: 'coins',
                                        dataKey: dataKey,
                                        seriesName: series.seriesName,
                                        date: date,
                                        dateStr: copy.purchaseDate
                                    });
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[时间轴] 硬币数据遍历出错（已跳过）:', e);
                }
            }
        }
    }

    // ===== 评级费台账（按付款日期落位）=====
    // ★ 与藏品**同一批 items**：后面的筛选、排序、按日期分组全都照旧走，
    //   所以 5 条评级费会自然地与同期藏品按日期混排，不需要单独一段。
    //   它们没进 collectAllCopies()，藏品总数仍是 396 件。
    for (const e of gradingFeeEntries()) items.push(e);

    // 过滤无效日期
    const validItems = items.filter(it => it.date && !isNaN(it.date.getTime()));

    // 按年份/月份筛选
    let filteredItems = validItems;
    if (timelineFilterYear !== '全部') {
        filteredItems = filteredItems.filter(it => {
            return it.date.getFullYear().toString() === timelineFilterYear;
        });
    }
    if (timelineFilterMonth !== '全部') {
        filteredItems = filteredItems.filter(it => {
            const month = String(it.date.getMonth() + 1).padStart(2, '0');
            return month === timelineFilterMonth;
        });
    }

    filteredItems.sort((a, b) => {
        const tA = a.date.getTime();
        const tB = b.date.getTime();
        return timelineSortOrder === 'desc' ? tB - tA : tA - tB;
    });

    // 按日期分组
    const grouped = {};
    for (const item of filteredItems) {
        const key = item.dateStr;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
    }
    const sortedDates = Object.keys(grouped).sort((a, b) => {
        // ★ 日期键是中文写法（"2025年8月5日"，藏品的 purchaseDate 原样，357 条全是），
        //   `new Date("2025年8月5日")` 在 V8 里是 Invalid Date，相减得 NaN ——
        //   于是这个 sort 其实**不排序**，分组头按"首次出现"的顺序排。
        //   这是本次改动之前就有的行为，不属于评级费这件事，所以我没有顺手改它
        //   （改了会让 357 条藏品的显示顺序一起变）。评级费那 5 条的落位不依赖这里：
        //   它们走的就是和藏品完全相同的 filteredItems 排序 + 分组逻辑。
        const dateA = parseChineseDate(a);
        const dateB = parseChineseDate(b);
        if (!dateA || !dateB || isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return 0;
        return timelineSortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    const availableYears = ['全部'];
    const yearSet = new Set();
    for (const item of validItems) {
        yearSet.add(item.date.getFullYear().toString());
    }
    for (const y of [...yearSet].sort()) {
        availableYears.push(y);
    }

    let html = `<div class="timeline-top-bar">`;
    html += `<button class="back-btn" onclick="backFromTimeline()">← 返回专题</button>`;
    html += `<div class="timeline-top-right">`;
    html += `<span class="timeline-top-count">共${filteredItems.length}件</span>`;

    html += `<select class="timeline-filter-select" id="timelineYearFilter" onchange="onTimelineFilterChange()">`;
    for (const y of availableYears) {
        const selected = y === timelineFilterYear ? 'selected' : '';
        const label = y === '全部' ? '全部年份' : y + '年';
        html += `<option value="${y}" ${selected}>${label}</option>`;
    }
    html += `</select>`;

    html += `<select class="timeline-filter-select" id="timelineMonthFilter" onchange="onTimelineFilterChange()">`;
    const months = ['全部', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    for (const m of months) {
        const selected = m === timelineFilterMonth ? 'selected' : '';
        const label = m === '全部' ? '全部月份' : m + '月';
        html += `<option value="${m}" ${selected}>${label}</option>`;
    }
    html += `</select>`;

    const descActive = timelineSortOrder === 'desc' ? 'active' : '';
    const ascActive = timelineSortOrder === 'asc' ? 'active' : '';
    html += `<button class="timeline-sort-btn ${descActive}" onclick="setTimelineOrder('desc')">最新优先</button>`;
    html += `<button class="timeline-sort-btn ${ascActive}" onclick="setTimelineOrder('asc')">最早优先</button>`;
    html += `</div>`;
    html += `</div>`;

    // ★ 标题下面那句标语换成"所选时间段一共花了多少钱"（用户要求："可以将点进专题后的
    //   标题下面那句标语换成「在所选的时间段内，你一共花了xx元」这样类似的句子"）。
    //   金额口径和下面每天的"这天，你一共花了X元"完全一致，取整显示。
    //   一件都没记价格时不硬说"0 元"，仍旧显示原来的标语。
    //   措辞按用户反馈收了一遍（"在…里"的"在"和"里"都不要）：
    //     2026 年，你一共花了 N 元 / 2026 年 7 月，你一共花了 N 元 / 历年 7 月，你一共花了 N 元
    //
    // ★★ 口径（用户裁定 2026-10，**两头都要做**，最后一版）：
    //     · 每枚自送藏品显示**裸币价** = 录入价 − 该枚评级费（见 nakedPriceOf）；
    //     · 评级费条目显示**该批支出**（= 未售出且非换壳行之和，合计 4023）；
    //     · **总花费 = Σ裸币价 + 评级费支出**，它在数学上恒等于 **Σ 藏品 price**
    //       （因为 录入价 = 裸币价 + 该枚评级费），所以既不重复计数、也不遗漏。
    //   历史坑：第一版把"裸币化"只做了减法、没有把评级费加回来 ⇒ 总额少了 4023
    //   （页面出现 44699，用户反馈"又少算了评级费"）。第二版干脆把评级费条目**跳过**，
    //   同样是少算。现在这两条路都堵住：评级费条目**照常累加**，藏品累加裸币价。
    //   ★ 一件都记不上价格时不硬说"0 元"，仍旧显示原来的标语。
    //   措辞按用户反馈收了一遍（"在…里"的"在"和"里"都不要）：
    //     2026 年，你一共花了 N 元 / 2026 年 7 月，你一共花了 N 元 / 历年 7 月，你一共花了 N 元
    let periodTotal = 0;
    let periodHasPrice = false;
    for (const item of filteredItems) {
        const naked = nakedPriceOf(item.copy && item.copy.copyId);
        const price = (naked != null)
            ? naked
            : parseFloat(String(item.copy.price || '').replace(/[^0-9.]/g, ''));
        if (!isNaN(price) && price > 0) { periodTotal += price; periodHasPrice = true; }
    }
    const periodText = (timelineFilterYear === '全部' && timelineFilterMonth === '全部')
        ? '到目前为止'
        : (timelineFilterYear === '全部')
            ? '历年' + parseInt(timelineFilterMonth, 10) + '月'
            : (timelineFilterMonth === '全部')
                ? timelineFilterYear + '年'
                : timelineFilterYear + '年' + parseInt(timelineFilterMonth, 10) + '月';
    const sloganText = (periodHasPrice || filteredItems.length === 0)
        ? periodText + '，你一共花了' + periodTotal.toFixed(0) + '元'
        : (config.slogan || '');

    html += `<div class="timeline-header">`;
    html += `<h2>${escapeHtml(config.name)}</h2>`;
    html += `<p class="timeline-slogan">${escapeHtml(sloganText)}</p>`;
    html += `</div>`;

    // ★ 按月份热力图放在"空状态提前 return"之前：筛选到一件都没有时，格子图仍在，
    //   用户能立刻看出是"这个月本来就没买"还是"筛错了"。
    html += buildMonthHeatmap(validItems);

    if (filteredItems.length === 0) {
        html += '<div class="empty-state timeline-empty-enter">' + emptyArt('timeline') + '显然，在选择的这个时间段你并没有乱花钱(·ω·)</div>';
        renderIntoContainerWithDropdowns(app, html);
        if (keepChrome) playTimelineFlip(app, flipSnap); else triggerViewAnimation();
        return;
    }

    html += `<div class="timeline-body">`;
    // FLIP 用的 key：按内容算，跨渲染稳定（不能用自增序号——换筛选后序号会整体错位，
    // 保留的条目就认不出来了）。完全相同的条目（同一天买两枚一模一样的）用出现次序区分。
    const flipSigCount = new Map();
    for (const dateKey of sortedDates) {
        const groupItems = grouped[dateKey];

        // ★ 口径与上面标语、与条目上显示的"购入价格"三者一致（用户裁定 2026-10）：
        //   藏品用**裸币价**（录入价 − 该枚评级费）；评级费条目**照常累加**该批支出。
        //   于是「这天一共花了」==「标语总额」在该天的分摊，且全局 Σ 恒等于 Σ 藏品 price。
        let dayTotal = 0;
        let hasPrice = false;
        for (const item of groupItems) {
            const naked = nakedPriceOf(item.copy && item.copy.copyId);
            const price = (naked != null)
                ? naked
                : parseFloat(String(item.copy.price || '').replace(/[^0-9.]/g, ''));
            if (!isNaN(price) && price > 0) {
                dayTotal += price;
                hasPrice = true;
            }
        }
        const totalSpentText = hasPrice ? dayTotal.toFixed(0) + '元' : '0元';

        html += `<div class="timeline-date-header">`;
        html += `<span class="timeline-date-label">${escapeHtml(dateKey)}</span>`;
        html += `<span class="timeline-date-spent">  这天，你一共花了${totalSpentText}</span>`;
        html += `</div>`;

        for (const item of groupItems) {
            try {
                const c = item.copy;
                const isFee = item.type === 'fee';
                const img1 = getImageUrl(c.img1);
                const img2 = getImageUrl(c.img2);
                const g1 = gridImg(c.img1);
                const g2 = gridImg(c.img2);
                const priceText = c.price ? (String(c.price).includes('元') ? c.price : c.price + '元') : '—';
                const version = c.version || '—';
                const grade = c.condition || c.grade || '—';
                const gradingCompany = c.gradingCompany || '';

                const categoryPath = getCategoryPath(item.dataKey, item.type);
                let fullName = categoryPath ? categoryPath + ' - ' + item.seriesName : item.seriesName;

                let metaParts = [];
                if (!isFee) {
                    if (item.type === 'notes') {
                        metaParts.push('冠字号：' + version);
                        metaParts.push('评级得分：' + grade);
                    } else {
                        if (gradingCompany && gradingCompany !== '') {
                            metaParts.push('评级机构：' + gradingCompany);
                        }
                        metaParts.push('评级得分：' + grade);
                    }
                    // ★★ 「裸币」显示（用户裁定）：录入价是**含评级费**的，自己送评（且非换壳）
                    //   的那一枚要减掉评级费、并标出"裸币"；换壳行与直接买来的现货一律原样显示。
                    const naked = nakedPriceOf(c.copyId);
                    if (naked != null) {
                        metaParts.push('购入价格：裸币' + formatYuan(naked));
                    } else {
                        metaParts.push('购入价格：' + priceText);
                    }
                }
                const metaStr = metaParts.join('\u00A0\u00A0\u00A0\u00A0');

                const flipSig = [item.type, item.dataKey, item.seriesName, c.purchaseDate,
                    c.version, c.condition || c.grade, c.gradingCompany, c.price, c.img1, c.img2].join('|');
                const flipNth = flipSigCount.get(flipSig) || 0;
                flipSigCount.set(flipSig, flipNth + 1);

                html += `<div class="timeline-item${isFee ? ' timeline-item--fee' : ''}" data-type="${escapeAttr(item.type || '')}" data-flip-key="${escapeAttr(flipSig + '#' + flipNth)}">`;
                html += `<div class="timeline-left">`;
                html += `<div class="timeline-dot"></div>`;
                html += `</div>`;
                if (isFee) {
                    // ★ 费用条目**不是藏品**：不占图片位，也绝不渲染任何图片占位（连「暂无图片」
                    //   和 .timeline-images 这个容器都不生成）。两行紧凑卡片：
                    //     [评级费（大标题）] [评级公司：ACG 圆角标签] [下载清单]
                    //     送评日期：… · 单号：PJ… · 评级收费：…元
                    //   · 第一行：「评级费」用大标题样式（= 原来"评级公司：爱藏评级"那个位置/字号），
                    //     后面紧跟**一个**主题色圆角标签，标签文字 = 「评级公司：」+ 短名
                    //     （用户确认："评级公司：也放进圆角标签内"）。
                    //   · 短名**只从数据来**（item.graderShort）：以后送别家只改数据；
                    //     数据里没有就**整个标签都不渲染**，绝不在渲染里写死任何公司名。
                    //   · 「下载清单」在第一行、紧跟在圆角标签后面（用户要求从第二行移上来）；
                    //     只在数据给了 listUrl 时才渲染 —— 缺字段就不出链接，不留空占位、不出死链。
                    //     点开是下载 xlsx，所以文字用"下载"不用"查看"。
                    //   · 「评级收费」= 未售出且非换壳部分的支出（= copy.price 那侧），与统计口径一致。
                    //   · 付款日期由上面的日期分组头承担，这里不重复写。
                    const sentDate = parseChineseDate(item.sentDate);
                    const sentStr = sentDate ? formatTimelineDate(sentDate) : '';
                    const short = item.graderShort || '';
                    html += `<div class="timeline-card timeline-card--fee">`;
                    html += `<div class="timeline-fee-main">`;
                    html += `<span class="timeline-fee-title">评级费</span>`;
                    // ★ 前缀「评级公司：」与短名**在同一个元素里**（用户确认）；
                    //   数据里没给 graderShort 就整个标签都不渲染 —— 不留一个空悬的"评级公司："。
                    if (short) {
                        html += `<span class="timeline-fee-tag">评级公司：${escapeHtml(short)}</span>`;
                    }
                    if (item.listUrl) {
                        html += `<a class="timeline-fee-link" href="${escapeAttr(item.listUrl)}" target="_blank" rel="noopener">下载清单</a>`;
                    }
                    html += `</div>`;
                    html += `<div class="timeline-fee-sub">`;
                    if (sentStr) html += `<span class="fee-f">送评日期：${escapeHtml(sentStr)}</span>`;
                    html += `<span class="fee-f">单号：${escapeHtml(version)}</span>`;
                    html += `<span class="fee-f">评级收费：${escapeHtml(priceText)}</span>`;
                    html += `</div>`;
                    html += `</div>`;
                } else {
                    html += `<div class="timeline-card">`;
                    html += `<div class="timeline-images">`;
                    if (img1) {
                        html += `<img class="timeline-img" src="${escapeAttr(g1.src)}"${thumbFallbackAttr(g1.fallback)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeAttr(img1)}', '${escapeAttr(img2 || img1)}')">`;
                    }
                    if (img2) {
                        html += `<img class="timeline-img" src="${escapeAttr(g2.src)}"${thumbFallbackAttr(g2.fallback)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeAttr(img2)}', '${escapeAttr(img1 || img2)}')">`;
                    }
                    if (!img1 && !img2) {
                        html += `<div class="timeline-no-img">暂无图片</div>`;
                    }
                    html += `</div>`;
                    html += `<div class="timeline-info">`;
                    html += `<div class="timeline-name">${escapeHtml(fullName)}</div>`;
                    html += `<div class="timeline-meta">${escapeHtml(metaStr)}</div>`;
                    html += `</div>`;
                    html += `</div>`;
                }
                html += `</div>`;
            } catch (e) {
                console.warn('[时间轴] 渲染单个条目出错（已跳过）:', e);
            }
        }
    }
    html += `</div>`;

    // ★★★ 保壳复用 + 同步建壳（两个下拉不再被拆掉重建，见 renderIntoContainerWithDropdowns
    //   的长注释：整块 innerHTML 替换会让 .dd 消失一帧，那一帧会被画出来 ⇒ 用户看到"闪动"）。
    //   这一句替代了原来单独的 `app.innerHTML = html;` 与紧随其后的
    //   `window.refreshCustomDropdowns()`（=schedule，只排 rAF，救不了那一帧）。
    //   下方这段历史注释保留，它记录的是**冷启动**那条时序（另一个问题：整块沉降），
    //   与"切换筛选时闪动"是两回事，但同样是"控件晚一帧就位"这一个根：
    //     · 不提前建壳的话，靠 dropdown.js 的 MutationObserver（32ms 去抖）才增强 ——
    //       于是浏览器会先画一帧"有标题、有排序按钮、但没有两个下拉"的 top-bar：
    //       `.timeline-top-right` 只有 46.9 + 75.9×2 + 8×2 = 198.7px，一行放得下 ⇒ 高 80px；
    //     · 32~57ms 后 `.dd`（84px 固定宽）建好 ⇒ 总宽 366.6px > 343px ⇒ flex-wrap 换行
    //       ⇒ top-bar 80 → 116px ⇒ **下方热力图整块被推下 36px**；
    //     · "第一次悬浮"正好落在这之后，热力图在它自己内部一动不动（⑦-c 五态全绿），
    //       但整块被祖先推走且再也不回来 ⇒ 用户看到的就是"一悬浮数字就沉下去"。
    renderIntoContainerWithDropdowns(app, html);
    // 热力图悬浮泡的"能居中就居中"逻辑（只挂一次，事件委托在 document 上）
    bindHeatmapTipClamp();
    // ★ 布局落位后把已量过的泡泡几何重算一遍（见 watchHeatmapTipGeometry 的注释：
    //   冷启动时整块还会往上走约 10px，别让那一刻量到的 --hm-tx 被永久冻住）
    watchHeatmapTipGeometry(app.querySelector('.tl-heatmap'));
    // ★ 时间轴曾漏了这一步（其它专题页都有），导致本页图片从不进入预缓存队列
    if (typeof schedulePrecacheCurrentView === 'function') schedulePrecacheCurrentView();
    // ★★★ 恢复时间轴滚动（使用专题缓存） ★★★
    if (selectedSpecial && specialPageCaches[selectedSpecial]?.scrollY !== undefined) {
        setTimeout(() => {
            app.scrollTop = specialPageCaches[selectedSpecial].scrollY || 0;
        }, 50);
    }
    // ★ 动画范围：进入专题时整页淡入（triggerViewAnimation）；换年月/换排序只让列表里的
    //   条目自己滑进滑出（playTimelineFlip），标题、热力图、工具条都不动。
    if (keepChrome) playTimelineFlip(app, flipSnap); else triggerViewAnimation();
}