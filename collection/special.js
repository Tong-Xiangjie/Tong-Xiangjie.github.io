// ==================== special.js ====================
// 专题

let specialItemsList = [];
let specialCurrentIndex = -1;
let shanheProvinceNames = {}; // 方寸山河：省份拼音 → 中文名
let shanheMapCache = null;   // ★ 缓存已构建好的地图 DOM
let shanheViewMode = 'map';  // ★ 当前视图：'map' 或 'list'（仅根视图有效）

// ========== 面额排序：分<角<元<万元<亿元<其他(音序) ==========
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

// ========== 通用分组：按 groupBy（year→年代 / denom→面额）生成侧边栏分类 ==========
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

// ★ 确保专题侧边栏分组与数据一致（按 groupBy 生成，覆盖 config.categories 旧数据）
function syncSpecialGroupChildren(config) {
    if (!config || config.view === 'map') return;   // 地图专题无侧边栏
    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    const items = data ? (data.items || data) : [];
    const groupChildren = buildGroupCategories(config, items);
    const specialTree = specialCategoryTree ? specialCategoryTree.find(c => c.id === config.id) : null;
    if (specialTree) {
        specialTree.children = (groupChildren && groupChildren.length > 0) ? groupChildren : null;
    }
}

// ========== 专题概览 ==========
function renderSpecialOverview() {
    const app = document.getElementById('app');
    currentView = VIEW.OVERVIEW;

    const configs = getSpecialConfigs();

    document.querySelector('.body-row')?.classList.remove('special-overview-mode');
    document.querySelector('.body-row')?.classList.add('sidebar-hidden');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) toggleBtn.style.display = 'none';
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.innerHTML = '';

    let html = `<div class="overview-header"><h2>专题收藏</h2><p>选择专题查看详情</p></div>`;

    if (!configs || configs.length === 0) {
        html += '<div class="empty-state">还木有专题</div>';
        app.innerHTML = html;
        triggerViewAnimation();
        return;
    }

    html += `<div class="special-overview-grid">`;
    for (const config of configs) {
        if (config.slogan) {
            // 长条样式：一行、无件数、带标语
            html += `<div class="special-overview-bar" onclick="onSpecialOverviewItemClick('${config.id}')">`;
            html += `<span class="special-overview-bar-title">${escapeHtml(config.name)}</span>`;
            html += `<span class="special-overview-bar-slogan">${escapeHtml(config.slogan)}</span>`;
            html += `</div>`;
        } else {
            const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
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
}

// ========== 点击专题 ==========
function onSpecialOverviewItemClick(configId) {
    selectedSpecial = configId;
    currentCategoryId = configId;
    currentSubId = null;
    const config = getSpecialConfigs().find(c => c.id === configId);

    document.querySelector('.body-row')?.classList.remove('sidebar-hidden');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    // ★ 方寸山河：地图/列表模式，无侧边栏
    if (config && config.view === 'map') {
        document.querySelector('.body-row')?.classList.add('sidebar-hidden');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.style.display = 'none';
        shanheViewMode = 'map'; // ★ 默认地图视图
        renderShanheContent(config);
        triggerViewAnimation();
        return;
    }

    // ★ 同步分组（数据驱动侧边栏）
    if (config) {
        syncSpecialGroupChildren(config);
    }

    const hasSub = config && specialCategoryTree
        ? specialCategoryTree.find(c => c.id === configId)?.children?.length > 0
        : false;

    if (hasSub) {
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.style.display = '';
        renderSidebar();
        renderSpecialContent();
        triggerViewAnimation();
    } else {
        document.querySelector('.body-row')?.classList.add('sidebar-hidden');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.style.display = 'none';
        renderSpecialContent();
        triggerViewAnimation();
    }
}

// ========== 专题内容（通用分组：年份/面额 + 地图分支） ==========
function renderSpecialContent() {
    const app = document.getElementById('app');

    if (!selectedSpecial) { renderSpecialOverview(); return; }
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) { renderSpecialOverview(); return; }

    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    if (!data) { app.innerHTML = '<div class="empty-state">啥都木有</div>'; return; }

    const items = data.items || data;
    if (!items || items.length === 0) { app.innerHTML = '<div class="empty-state">啥都木有</div>'; return; }

    // ★ 方寸山河：地图/列表交互分支
    if (config.view === 'map') {
        renderShanheContent(config);
        return;
    }

    const groupField = config.groupBy || 'year';

    // 筛选
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

    // 分组（显示顺序 = 组排序 + 组内数据序）
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

    // 灯箱列表 = 展示顺序
    specialItemsList = [];
    for (const key of sortedKeys) for (const item of groups[key]) specialItemsList.push(item);

    let html = `<div class="overview-header"><h2>${escapeHtml(config.name)}</h2>`;
    if (currentSubId) html += `<p style="font-size:0.8rem;color:var(--theme);">当前筛选：${escapeHtml(currentSubId)}</p>`;
    html += `</div>`;

    for (const key of sortedKeys) {
        const group = groups[key];
        html += `<div class="special-year-section">`;
        html += `<div class="special-year-title">${escapeHtml(key)} <span class="count">${group.length}件</span></div>`;
        html += `<div class="special-year-grid">`;
        for (const item of group) {
            const index = specialItemsList.indexOf(item);
            const imgUrl = getImageUrl(item.yearImg || item.img);
            html += `<div class="special-item-card" onclick="openSpecialLightbox(${index})">`;
            if (imgUrl) {
                html += `<div class="special-item-img-wrapper"><img class="special-item-img" src="${imgUrl}" alt="${escapeHtml(item.name || item.scene || '')}" loading="lazy"></div>`;
            } else {
                html += `<div class="special-item-img-wrapper" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-secondary);">暂无图片</div>`;
            }
            html += `<div class="special-item-info">`;
            html += `<div class="special-item-name">${escapeHtml(item.name || item.scene || '')}</div>`;
            if (item.krause && !/unlisted/i.test(item.krause)) html += `<div class="special-item-krause">${escapeHtml(item.krause)}</div>`;
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }

    if (filteredItems.length === 0) html += '<div class="empty-state">该分组暂无藏品</div>';
    app.innerHTML = html;
    triggerViewAnimation();
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
    lightbox.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:20px;animation:contentFadeIn 0.2s ease;';

    const inner = document.createElement('div');
    inner.className = 'special-lightbox-inner';
    inner.style.cssText = 'background:var(--card-bg);border-radius:12px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 8px 30px rgba(0,0,0,0.2);';

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
        html += `<img src="${imgUrl}" alt="${escapeHtml(item.name || item.scene || '')}" style="max-width:100%;max-height:100%;width:auto;object-fit:contain;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">`;
        html += `</div>`;
    } else {
        html += `<div style="height:55vh;display:flex;align-items:center;justify-content:center;margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem;">暂无图片</div>`;
    }

    html += `<div style="border-top:1px solid var(--border);padding-top:12px;">`;
    html += `<div style="font-size:1rem;font-weight:bold;color:var(--text);margin-bottom:4px;">${escapeHtml(item.name || item.scene || '')}</div>`;

    // ★ 字段显示：年份、来源/面额、城市、编号、备注（山河专属）
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
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', specialLightboxKeyHandler);
}

function specialLightboxKeyHandler(e) {
    if (e.key === 'Escape') closeSpecialLightbox();
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
}

// ========== 方寸山河：视图切换 ==========
function shanheSwitchView(view) {
    if (shanheViewMode === view) return;
    shanheViewMode = view;
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (config) renderShanheContent(config);
}

// ★ 返回专题概览（地图/列表专用）
function backFromShanheToOverview() {
    selectedSpecial = null;
    currentCategoryId = null;
    currentSubId = null;
    shanheMapCache = null; // ★ 离开时清缓存，下次重新加载确保数据最新
    renderSpecialOverview();
}

// ★ 列表视图：长条和图片分行渲染
function renderShanheList(config) {
    const app = document.getElementById('app');
    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    const items = data ? (data.items || data) : [];

    // 按 省份|城市 分组
    const groups = new Map();
    for (const item of items) {
        const key = (item.province || '') + '|' + (item.city || '其他');
        if (!groups.has(key)) groups.set(key, { province: item.province || '', city: item.city || '其他', items: [] });
        groups.get(key).items.push(item);
    }

    // 省份音序 → 城市音序
    const sortedGroups = [...groups.values()].sort((a, b) => {
        const pa = shanheProvinceNames[a.province] || a.province;
        const pb = shanheProvinceNames[b.province] || b.province;
        if (pa !== pb) return pa.localeCompare(pb, 'zh');
        return a.city.localeCompare(b.city, 'zh');
    });

    // 展平成有序图片序列
    const flat = [];
    for (const g of sortedGroups) for (const item of g.items) flat.push({ group: g, item });
    specialItemsList = flat.map(f => f.item);

    let html = shanheHeaderHtml(config);
    if (flat.length === 0) {
        html += '<div class="empty-state">该专题暂无主景</div>';
        app.innerHTML = html;
        triggerViewAnimation();
        return;
    }

    // ★ 列数自适应：按容器宽度估算（约140px一格），桌面≈4列、手机自动变少
    const GAP = 8, MIN_CELL = 140;
    const appW = app.clientWidth || window.innerWidth || 600;
    const colCount = Math.max(1, Math.floor((appW + GAP) / (MIN_CELL + GAP)));

    html += `<div class="shanhe-list-rows">`;
    for (let i = 0; i < flat.length; i += colCount) {
        const chunk = flat.slice(i, i + colCount);

        // 长条行：按本行内各城市图片数合并，宽度 = 占列数
        const strips = [];
        for (const f of chunk) {
            if (strips.length > 0 && strips[strips.length - 1].group === f.group) {
                strips[strips.length - 1].count++;
            } else {
                strips.push({ group: f.group, count: 1 });
            }
        }

        html += `<div class="shanhe-list-block">`;
        // ★ 第一行：长条
        html += `<div class="shanhe-list-strips" style="grid-template-columns: repeat(${colCount}, 1fr);">`;
        for (const s of strips) {
            const provinceName = shanheProvinceNames[s.group.province] || s.group.province;
            html += `<div class="shanhe-list-strip" style="grid-column: span ${s.count};">${escapeHtml(provinceName)} - ${escapeHtml(s.group.city)}</div>`;
        }
        html += `</div>`;
        // ★ 第二行：图片
        html += `<div class="shanhe-list-images" style="grid-template-columns: repeat(${colCount}, 1fr);">`;
        for (const { item } of chunk) {
            const idx = specialItemsList.indexOf(item);
            const imgUrl = getImageUrl(item.img || item.yearImg);
            html += `<div class="shanhe-list-cell" onclick="openSpecialLightbox(${idx})" title="${escapeHtml(item.scene || item.name || '')}">`;
            if (imgUrl) html += `<img src="${imgUrl}" alt="" loading="lazy">`;
            else html += `<span class="no-img">暂无图片</span>`;
            html += `</div>`;
        }
        html += `</div>`;
        html += `</div>`;
    }
    html += `</div>`;

    app.innerHTML = html;
    triggerViewAnimation();
}

// ★ 地图/列表视图头部的 HTML（不含 emoji）
function shanheHeaderHtml(config) {
    let html = `<div class="back-bar"><button class="back-btn" onclick="backFromShanheToOverview()">← 返回专题</button></div>`;
    html += `<div class="overview-header shanhe-header-row">`;
    html += `<div><h2>${escapeHtml(config.name)}</h2><p>点击省份查看对应的纸币主景</p></div>`;
    html += `<div class="shanhe-view-toggle">`;
    html += `<button class="shanhe-view-btn ${shanheViewMode === 'map' ? 'active' : ''}" onclick="shanheSwitchView('map')">地图</button>`;
    html += `<button class="shanhe-view-btn ${shanheViewMode === 'list' ? 'active' : ''}" onclick="shanheSwitchView('list')">列表</button>`;
    html += `</div>`;
    html += `</div>`;
    return html;
}

// ========== 方寸山河：地图交互（根视图 + 省份详情视图） ==========
async function renderShanheContent(config) {
    const app = document.getElementById('app');
    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    const items = data ? (data.items || data) : [];
    const mapFile = config.mapFile || 'china_map.svg';
    shanheProvinceNames = window.SHANHE_PROVINCE_NAMES || {};

    // ★ 河山恒为全屏：强制隐藏侧边栏
    document.querySelector('.body-row')?.classList.add('sidebar-hidden');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) toggleBtn.style.display = 'none';
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl) sidebarEl.innerHTML = '';

    // ★★★ 结构关键：根视图（未点省份） vs 省份详情（已点省份）★★★
    if (!currentSubId) {
        // ===== 根视图：地图 / 列表 二选一 =====
        if (shanheViewMode === 'list') {
            renderShanheList(config);
            return;
        }

        // ===== 地图视图：记录占位元素引用 =====
        app.innerHTML = shanheHeaderHtml(config) +
            `<div class="shanhe-map-loading">且待万里山河在你面前徐徐展开</div>`;
        const loadEl = app.querySelector('.shanhe-map-loading');   // ★ 占位标记

        // ★ 已有缓存：直接复用，不再 fetch/重建
        if (shanheMapCache && shanheMapCache.wrap) {
            const removeLoad = app.querySelector('.shanhe-map-loading');
            if (removeLoad) removeLoad.remove();
            // ★ 清除残留悬浮态
            shanheMapCache.wrap.querySelectorAll('.shanhe-label.active').forEach(t => t.classList.remove('active'));
            app.appendChild(shanheMapCache.wrap);
            triggerViewAnimation();
            return;
        }

        try {
            const res = await fetch(mapFile);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const svgText = await res.text();

            // ★ 防串台：fetch 期间视图已被替换（占位元素不在 #app 里了）→ 直接丢弃
            if (!app.contains(loadEl)) return;

            const wrap = document.createElement('div');
            wrap.className = 'shanhe-map-wrap';
            wrap.innerHTML = svgText;

            const svg = wrap.querySelector('svg');
            if (!svg) throw new Error('SVG中未找到<svg>');

            // 件数统计 + 最大件数
            const countByProvince = {};
            let maxCount = 0;
            for (const item of items) {
                if (!item.province) continue;
                countByProvince[item.province] = (countByProvince[item.province] || 0) + 1;
                if (countByProvince[item.province] > maxCount) maxCount = countByProvince[item.province];
            }

            const themeLightRGB = getCssColor('--theme-light', [94, 160, 255]);

            // ★ 追加前再确认一次（双保险）
            if (!app.contains(loadEl)) return;

            const removeLoad = app.querySelector('.shanhe-map-loading');
            if (removeLoad) removeLoad.remove();

            // ★ 主图：给省份着色 + 事件 + 标注（港澳保留形状，只是不写标签）
            svg.querySelectorAll('.state').forEach(el => {
                const cls = el.getAttribute('class') || '';
                const pid = cls.split(/\s+/).filter(c => c && c !== 'state')[0] || '';
                const isGangAo = (pid === 'xianggang' || pid === 'aomen');
                setupShanheState(el, pid, countByProvince[pid] || 0, maxCount, themeLightRGB, config, svg, undefined, isGangAo);
            });

            // ★ 港澳局部放大图 = 粤港澳切片（缩小范围）
            buildShanheInset(svg, countByProvince, maxCount, themeLightRGB, config);

            app.appendChild(wrap);

            // ★ 构建完成，存入缓存
            shanheMapCache = { wrap };

            triggerViewAnimation();
        } catch (e) {
            // 报错也只在还是当前视图时才展示
            if (app.contains(loadEl)) {
                app.innerHTML = shanheHeaderHtml(config) +
                    `<div class="empty-state">地图加载失败：${escapeHtml(e.message)}</div>`;
            }
        }
    } else {
        // ===== 省份详情视图：与视图模式无关，永远走这里 =====
        renderShanheProvince(config);
    }
}

// 着色：0件→白，件数越多越接近主题浅色
function fillForCount(count, maxCount, themeLightRGB) {
    if (count <= 0) return 'rgb(255,255,255)';
    const ratio = maxCount > 0 ? count / maxCount : 0;
    return mixColor([255, 255, 255], themeLightRGB, ratio);
}

// 创建省份标注（名称 + 件数），返回 text 元素
function createShanheLabel(svg, x, y, name, count, baseSize, strokeScale) {
    const NS = 'http://www.w3.org/2000/svg';
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'shanhe-label' + (count > 0 ? ' has-count' : ''));
    text.style.setProperty('--label-size', (baseSize || 12) + 'px');
    // ★ 放大图：文字黑边按比例调细
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

// 射线法：点是否在多边形内（仅支持 points 属性的 polygon）
function isPointInPolygon(el, x, y) {
    const pts = el.getAttribute('points');
    if (!pts) return true;   // path 等无 points：不做判断，用几何中心
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

// 给省份元素绑定着色 + 点击 + 悬浮联动（主图与放大图共用）
function setupShanheState(el, pid, count, maxCount, themeLightRGB, config, svg, baseSize, noLabel, strokeScale) {
    const name = shanheProvinceNames[pid] || pid;
    el.style.fill = fillForCount(count, maxCount, themeLightRGB);
    el.style.cursor = count > 0 ? 'pointer' : 'default';
    // ★ 放大图：边界线按比例调细
    if (strokeScale && strokeScale !== 1) {
        el.style.strokeWidth = (1 * strokeScale) + 'px';
    }
    el.addEventListener('click', () => {
        if (count === 0) return;
        // ★ 点击省份 → 切换到列表视图并自动滚动到该省份
        shanheViewMode = 'list';
        currentSubId = pid;
        renderShanheContent(config);
        // 滚动到对应省份
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
    if (!bbox) return null;

    // ★ 不写标签（港澳）：只做着色/点击，跳过文字与悬浮放大
    if (noLabel) return null;

    // ★ 标注位置：几何中心在多边形外时向下找内部点（如内蒙古）
    let lx = bbox.x + bbox.width / 2;
    let ly = bbox.y + bbox.height / 2;
    if (!isPointInPolygon(el, lx, ly)) {
        for (const step of [0.06, 0.12, 0.18, 0.24, 0.30]) {
            const yy = bbox.y + bbox.height * (0.5 + step);
            if (isPointInPolygon(el, lx, yy)) { ly = yy; break; }
        }
    }

    const text = createShanheLabel(svg, lx, ly, name, count, baseSize, strokeScale);
    el.addEventListener('mouseenter', () => text.classList.add('active'));
    el.addEventListener('mouseleave', () => text.classList.remove('active'));
    return text;
}

// ★ 港澳放大图 = 切片（以港澳为主体，广东只露一小条）
function buildShanheInset(mainSvg, countByProvince, maxCount, themeLightRGB, config) {
    // ★ 切片区域：以港澳为主体，向广东方向露出一小条（不要求完整省份）
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const id of ['xianggang', 'aomen']) {
        const el = mainSvg.querySelector('.state.' + id);
        if (!el) continue;
        const b = el.getBBox();
        minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + b.width);
        minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.height);
    }
    if (minX === 1e9) return;
    const pad = 6;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    // ★ 向广东方向扩一点：上边界切到广东中下段、左边界到广东中段，只露广东南部一小条
    const gd = mainSvg.querySelector('.state.guangdong');
    if (gd) {
        const gb = gd.getBBox();
        minY = Math.min(minY, gb.y + gb.height * 0.55);
        minX = Math.min(minX, gb.x + gb.width * 0.45);
    }

    // 截取与该区域相交的所有省份
    const inRegion = [];
    mainSvg.querySelectorAll('.state').forEach(el => {
        const b = el.getBBox();
        if (b.x < maxX && b.x + b.width > minX && b.y < maxY && b.y + b.height > minY) {
            inRegion.push(el);
        }
    });
    if (inRegion.length === 0) return;

    const wrap = document.createElement('div');
    wrap.className = 'shanhe-map-inset';
    wrap.innerHTML = '<div class="shanhe-map-inset-title">粤港澳地区局部放大</div>';

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    wrap.appendChild(svg);

    const mapWrap = mainSvg.closest('.shanhe-map-wrap');
    if (mapWrap) mapWrap.appendChild(wrap);   // 先挂 DOM 再取渲染宽度

    // ★ 字号：与大图同屏一致后，再调小一点（×0.55）
    const mainVbW = (mainSvg.viewBox && mainSvg.viewBox.baseVal) ? mainSvg.viewBox.baseVal.width : 595.28;
    const mainScale = mainSvg.getBoundingClientRect().width / mainVbW;
    const insetScale = svg.getBoundingClientRect().width / (maxX - minX);
    // ★ 移动端（≤760px）港澳字号与大图一致；桌面端保持略小（×0.55）
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
    const fontFactor = isMobile ? 1 : 0.55;
    const baseSize = insetScale > 0 ? 12 * mainScale / insetScale * fontFactor : 12;
    // ★ 边界线/描边按比例反算，避免放大后过粗
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

// 读取 CSS 变量颜色 → [r,g,b]
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

// 颜色插值：c1 为起点、c2 为终点，t∈[0,1]
function mixColor(c1, c2, t) {
    return 'rgb(' +
        Math.round(c1[0] + (c2[0] - c1[0]) * t) + ',' +
        Math.round(c1[1] + (c2[1] - c1[1]) * t) + ',' +
        Math.round(c1[2] + (c2[2] - c1[2]) * t) + ')';
}

// ========== 省份详情视图（按城市分组列表） ==========
function renderShanheProvince(config) {
    const app = document.getElementById('app');
    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    const items = (data ? (data.items || data) : []).filter(item => item.province === currentSubId);
    const provinceName = shanheProvinceNames[currentSubId] || currentSubId;

    // ★ 按城市分组（不用车牌）
    const cityGroups = {};
    for (const item of items) {
        const key = item.city || '其他';
        if (!cityGroups[key]) cityGroups[key] = [];
        cityGroups[key].push(item);
    }

    let html = `<div class="back-bar"><button class="back-btn" onclick="backFromShanheMap()">← 返回地图</button></div>`;
    html += `<div class="overview-header"><h2>${escapeHtml(provinceName)}</h2><p>共${items.length}个主景</p></div>`;

    if (items.length === 0) {
        html += '<div class="empty-state">该省份暂无主景</div>';
        app.innerHTML = html;
        triggerViewAnimation();
        return;
    }

    // 灯箱列表 = 当前省份全部主景（城市分组顺序）
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
            html += `<div class="special-item-card" onclick="openSpecialLightbox(${index})">`;
            if (imgUrl) {
                html += `<div class="special-item-img-wrapper"><img class="special-item-img" src="${imgUrl}" alt="${escapeHtml(item.scene || item.name || '')}" loading="lazy"></div>`;
            } else {
                html += `<div class="special-item-img-wrapper" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-secondary);">暂无图片</div>`;
            }
            html += `<div class="special-item-info">`;
            html += `<div class="special-item-name">${escapeHtml(item.scene || item.name || '')}</div>`;
            // ★ 副信息：城市 · 来源（原为面额） · 年份
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
    triggerViewAnimation();
}

function backFromShanheMap() {
    currentSubId = null;
    shanheViewMode = 'map';
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (config) renderShanheContent(config);
}
