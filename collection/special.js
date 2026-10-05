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
        html += `<div style="height:55vh;display:flex;align-items:center;justify-content:center;margin-bottom:12px;overflow:hidden;">`;
        html += `<img src="${imgUrl}"${thumbFallbackAttr('')} alt="${escapeAttr(item.name || item.scene || '')}" style="max-width:100%;max-height:100%;width:auto;object-fit:contain;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">`;
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
    if (!amount || amount <= 0) return 0;
    if (!maxAmount || maxAmount <= 0) return 0.10;
    return 0.10 + 0.85 * Math.min(1, amount / maxAmount);
}

// 金额口径必须和"这天，你一共花了X元"、标语「你共花了 N 元」完全一致：
// 只认能解析出的正数 price，取整显示。★ 改这里就等于改那两处，verify-heatmap 会盯着。
function timelinePriceOf(copy) {
    const price = parseFloat(String((copy && copy.price) || '').replace(/[^0-9.]/g, ''));
    return (!isNaN(price) && price > 0) ? price : 0;
}

function buildMonthHeatmap(items) {
    const byYear = new Map();
    for (const it of items) {
        const y = it.date.getFullYear();
        const m = it.date.getMonth();                 // 0-11
        if (!byYear.has(y)) byYear.set(y, Array.from({ length: 12 }, () => ({ n: 0, sum: 0 })));
        const cell = byYear.get(y)[m];
        cell.n++;
        cell.sum += timelinePriceOf(it.copy);
    }
    if (byYear.size === 0) return '';

    // 年份**升序**：老的在上、新的在下（用户要求）
    const years = [...byYear.keys()].sort((a, b) => a - b);
    let maxAmount = 0;
    for (const y of years) for (const c of byYear.get(y)) if (c.sum > maxAmount) maxAmount = c.sum;

    // 标签的泡里也要有"多少件、多少钱"（用户要求）：
    //   年份 = 全年合计；月份 = 历年这个月的合计；"全部" = 全部时间合计
    const monthTotal = Array.from({ length: 12 }, () => ({ n: 0, sum: 0 }));
    const yearTotal = new Map();
    let allN = 0, allSum = 0;
    for (const y of years) {
        const cells = byYear.get(y);
        let n = 0, sum = 0;
        for (let m = 0; m < 12; m++) {
            n += cells[m].n; sum += cells[m].sum;
            monthTotal[m].n += cells[m].n; monthTotal[m].sum += cells[m].sum;
        }
        yearTotal.set(y, { n, sum });
        allN += n; allSum += sum;
    }
    // 文案统一成用户给的格式：x年x月，共购入x件，合计x元
    const tipOf = (lead, n, sum) => `${lead}，共购入${n}件，合计${Math.round(sum)}元`;

    const allActive = (timelineFilterYear === '全部' && timelineFilterMonth === '全部');
    let html = `<div class="tl-heatmap">`;

    // 表头：左上角"全部"（点它回到全部时间）+ 12 个月份（点它看历年这个月）
    // ★ 标签也用**自写悬浮泡**（同一套 .tl-heatmap-tip），不用原生 title：
    //   原生 tooltip 又慢又丑、样式不可控，而且在触摸设备上根本不出现。
    //   data-label 存住纯文本，方便用例和样式按"这一格是谁"来取（textContent 会被悬浮泡文案污染）。
    html += `<div class="tl-heatmap-row tl-hm-head">`;
    html += `<div class="tl-heatmap-ylabel tl-hm-corner${allActive ? ' is-active' : ''}" role="button" tabindex="0"` +
        ` data-label="全部" aria-label="回到全部时间：${tipOf('全部时间', allN, allSum)}"` +
        ` onclick="applyTimelineFilter('全部','全部')">全部` +
        `<span class="tl-heatmap-tip">${tipOf('全部时间', allN, allSum)}</span></div>`;
    for (let m = 1; m <= 12; m++) {
        const sel = (timelineFilterYear === '全部' && timelineFilterMonth === String(m).padStart(2, '0')) ? ' is-active' : '';
        const mt = monthTotal[m - 1];
        const mtip = tipOf(`历年${m}月`, mt.n, mt.sum);
        html += `<div class="tl-heatmap-mlabel${sel}" role="button" tabindex="0" data-label="${m}"` +
            ` aria-label="看历年 ${m} 月：${mtip}"` +
            ` onclick="applyTimelineFilter('全部', ${m})">${m}` +
            `<span class="tl-heatmap-tip">${mtip}</span></div>`;
    }
    html += `</div>`;

    for (const y of years) {
        const cells = byYear.get(y);
        const yt = yearTotal.get(y);
        const ytip = tipOf(`${y}年`, yt.n, yt.sum);
        const rowSel = (timelineFilterYear === String(y) && timelineFilterMonth === '全部') ? ' is-active' : '';
        html += `<div class="tl-heatmap-row">`;
        html += `<div class="tl-heatmap-ylabel${rowSel}" role="button" tabindex="0" data-label="${y}"` +
            ` aria-label="看 ${y} 年全年：${ytip}"` +
            ` onclick="applyTimelineFilter(${y}, '全部')">${y}` +
            `<span class="tl-heatmap-tip">${ytip}</span></div>`;
        for (let m = 0; m < 12; m++) {
            const c = cells[m];
            // 连续深浅：直接把这个格子的透明度写成内联自定义属性（CSS 读不到 DOM 里的金额，
            // 所以"无限档"只能由 JS 给一个值；这不是给 tooltip 写内联样式，tooltip 仍是纯 CSS 定位）
            const o = timelineHeatmapOpacity(c.sum, maxAmount);
            const styleAttr = o > 0 ? ` style="--hm-o:${Math.round(o * 1000) / 1000}"` : '';
            // tl-hm-on 只为"有金额"的格子加：深色主题那条 calc() 提亮只该作用在它们身上，
            // 否则 0 元的空格子也会被抬到 0.08（测出来过），空月份会微微泛色
            const onClass = o > 0 ? ' tl-hm-on' : '';
            const label = tipOf(`${y}年${m + 1}月`, c.n, c.sum);
            const edge = m === 0 ? ' tl-hm-first' : (m === 11 ? ' tl-hm-last' : '');
            html += `<div class="tl-heatmap-cell${edge}${onClass}"${styleAttr} tabindex="0" role="button"` +
                ` data-year="${y}" data-month="${String(m + 1).padStart(2, '0')}"` +
                ` aria-label="${escapeAttr(label)}" onclick="onHeatmapCellClick(${y}, ${m + 1})">` +
                `<i class="tl-hm-fill"></i><span class="tl-heatmap-tip">${escapeHtml(label)}</span></div>`;
        }
        html += `</div>`;
    }
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
        const dateA = new Date(a);
        const dateB = new Date(b);
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
    //   标题下面那句标语换成「在所选的时间段内，你共花了xx元」这样类似的句子"）。
    //   金额口径和下面每天的"这天，你一共花了X元"完全一致：只累加能解析出正数的 price，
    //   取整显示。一件都没记价格时不硬说"0 元"，仍旧显示原来的标语。
    //   措辞按用户反馈收了一遍（"在…里"的"在"和"里"都不要）：
    //     2026 年，你共花了 N 元 / 2026 年 7 月，你共花了 N 元 / 历年 7 月，你共花了 N 元
    let periodTotal = 0;
    let periodHasPrice = false;
    for (const item of filteredItems) {
        const price = parseFloat(String(item.copy.price || '').replace(/[^0-9.]/g, ''));
        if (!isNaN(price) && price > 0) { periodTotal += price; periodHasPrice = true; }
    }
    const periodText = (timelineFilterYear === '全部' && timelineFilterMonth === '全部')
        ? '到目前为止'
        : (timelineFilterYear === '全部')
            ? '历年 ' + parseInt(timelineFilterMonth, 10) + ' 月'
            : (timelineFilterMonth === '全部')
                ? timelineFilterYear + ' 年'
                : timelineFilterYear + ' 年 ' + parseInt(timelineFilterMonth, 10) + ' 月';
    const sloganText = (periodHasPrice || filteredItems.length === 0)
        ? periodText + '，你共花了 ' + periodTotal.toFixed(0) + ' 元'
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
        app.innerHTML = html;
        if (keepChrome) playTimelineFlip(app, flipSnap); else triggerViewAnimation();
        return;
    }

    html += `<div class="timeline-body">`;
    // FLIP 用的 key：按内容算，跨渲染稳定（不能用自增序号——换筛选后序号会整体错位，
    // 保留的条目就认不出来了）。完全相同的条目（同一天买两枚一模一样的）用出现次序区分。
    const flipSigCount = new Map();
    for (const dateKey of sortedDates) {
        const groupItems = grouped[dateKey];

        let dayTotal = 0;
        let hasPrice = false;
        for (const item of groupItems) {
            const price = parseFloat(String(item.copy.price || '').replace(/[^0-9.]/g, ''));
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
                if (item.type === 'notes') {
                    metaParts.push('冠字号：' + version);
                    metaParts.push('评级得分：' + grade);
                } else {
                    if (gradingCompany && gradingCompany !== '') {
                        metaParts.push('评级机构：' + gradingCompany);
                    }
                    metaParts.push('评级得分：' + grade);
                }
                metaParts.push('购入价格：' + priceText);
                const metaStr = metaParts.join('\u00A0\u00A0\u00A0\u00A0');

                const flipSig = [item.type, item.dataKey, item.seriesName, c.purchaseDate,
                    c.version, c.condition || c.grade, c.gradingCompany, c.price, c.img1, c.img2].join('|');
                const flipNth = flipSigCount.get(flipSig) || 0;
                flipSigCount.set(flipSig, flipNth + 1);

                html += `<div class="timeline-item" data-flip-key="${escapeAttr(flipSig + '#' + flipNth)}">`;
                html += `<div class="timeline-left">`;
                html += `<div class="timeline-dot"></div>`;
                html += `</div>`;
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
                html += `</div>`;
            } catch (e) {
                console.warn('[时间轴] 渲染单个条目出错（已跳过）:', e);
            }
        }
    }
    html += `</div>`;

    app.innerHTML = html;
    // 热力图悬浮泡的"能居中就居中"逻辑（只挂一次，事件委托在 document 上）
    bindHeatmapTipClamp();
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