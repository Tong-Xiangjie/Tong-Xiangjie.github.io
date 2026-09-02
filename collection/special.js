// ==================== special.js ====================
// 专题

let specialItemsList = [];
let specialCurrentIndex = -1;
let shanheProvinceNames = {};
let shanheMapCache = null;
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
    if (sidebar) sidebar.innerHTML = '';

    let html = `<div class="overview-header"><h2>专题收藏</h2><p>选择专题查看详情</p></div>`;

    if (!configs || configs.length === 0) {
        html += '<div class="empty-state">还木有专题</div>';
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
function onSpecialOverviewItemClick(configId) {
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
    if (!data) { app.innerHTML = '<div class="empty-state">啥都木有</div>'; return; }

    const items = data.items || data;
    if (!items || items.length === 0) { app.innerHTML = '<div class="empty-state">啥都木有</div>'; return; }

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
    if (currentSubId) html += `<p style="font-size:0.8rem;color:var(--theme);">当前您选择查看${escapeHtml(currentSubId)}</p>`;
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
                html += `<div class="special-item-img-wrapper" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-secondary);">还木有图片</div>`;
            }
            html += `<div class="special-item-info">`;
            html += `<div class="special-item-name">${escapeHtml(item.name || item.scene || '')}</div>`;
            if (item.krause && !/unlisted/i.test(item.krause)) html += `<div class="special-item-krause">${escapeHtml(item.krause)}</div>`;
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }

    if (filteredItems.length === 0) html += '<div class="empty-state">啊哦，啥都木有……</div>';
    app.innerHTML = html;

    // ★★★ 恢复专题滚动（从缓存中） ★★★
    if (selectedSpecial && specialPageCaches[selectedSpecial]?.scrollY !== undefined) {
        setTimeout(() => {
            app.scrollTop = specialPageCaches[selectedSpecial].scrollY || 0;
        }, 50);
    }
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
    // ★★★ 保存当前视图状态 ★★★
    saveFullState();
    shanheViewMode = view;
    currentSubId = null;

    if (shanheListRO) { shanheListRO.disconnect(); shanheListRO = null; }

    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) return;

    const app = getRenderContainer();
    if (app) {
        app.classList.remove('shanhe-view-enter');
        void app.offsetWidth;
        app.classList.add('shanhe-view-enter');
    }
    renderShanheContent(config);
}

function backFromShanheToOverview() {
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
        html += '<div class="empty-state">还……还没有风景(╥_╥)</div>';
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
            html += `<div class="shanhe-list-cell" onclick="openSpecialLightbox(${idx})" title="${escapeHtml(item.scene || item.name || '')}">`;
            if (imgUrl) html += `<img src="${imgUrl}" alt="" loading="lazy">`;
            else html += `<span class="no-img">还木有图片</span>`;
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
        if (textEl) textEl.textContent = '正在加载地图（本地模式）……';

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
    if (sidebarEl) sidebarEl.innerHTML = '';

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

function fillForCount(count, maxCount, themeLightRGB) {
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
    const isMobile = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 760px)').matches;
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
        html += '<div class="empty-state">这么近，那么美，可这儿却没有我的一席之地……</div>';
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
            html += `<div class="special-item-card" onclick="openSpecialLightbox(${index})">`;
            if (imgUrl) {
                html += `<div class="special-item-img-wrapper"><img class="special-item-img" src="${imgUrl}" alt="${escapeHtml(item.scene || item.name || '')}" loading="lazy"></div>`;
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
}

function backFromShanheMap() {
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
    if (currentSubId !== null) return;
    if (shanheViewMode !== 'map') return;

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

// ---------- 获取分类路径（不含顶层「纸币/硬币」） ----------
function getCategoryPath(dataKey, type) {
    let tree;
    if (type === 'notes') {
        tree = typeof categoryTree !== 'undefined' ? categoryTree : [];
    } else if (type === 'coins') {
        tree = typeof coinCategoryTree !== 'undefined' ? coinCategoryTree : [];
    } else {
        return '';
    }

    for (const cat of tree) {
        if (cat.children && cat.children.length > 0) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) {
                    return cat.name + ' - ' + sub.name;
                }
            }
        } else {
            if (cat.dataKey === dataKey) {
                return cat.name;
            }
        }
    }
    return '';
}

// ---------- 排序切换 ----------
function setTimelineOrder(order) {
    if (timelineSortOrder === order) return;
    timelineSortOrder = order;
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (config) renderTimelineContent(config);
}

// ---------- 筛选变更 ----------
function onTimelineFilterChange() {
    const yearSelect = document.getElementById('timelineYearFilter');
    const monthSelect = document.getElementById('timelineMonthFilter');
    if (yearSelect) timelineFilterYear = yearSelect.value;
    if (monthSelect) timelineFilterMonth = monthSelect.value;
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (config) renderTimelineContent(config);
}

// ---------- 返回专题概览 ----------
function backFromTimeline() {
    saveFullState(); // 保存时间轴滚动
    selectedSpecial = null;
    currentCategoryId = null;
    currentSubId = null;
    renderSpecialOverview();
}

// ---------- 核心渲染 ----------
function renderTimelineContent(config) {
    const app = getRenderContainer();

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

    html += `<div class="timeline-header">`;
    html += `<h2>${escapeHtml(config.name)}</h2>`;
    html += `<p class="timeline-slogan">${escapeHtml(config.slogan)}</p>`;
    html += `</div>`;

    if (filteredItems.length === 0) {
        html += '<div class="empty-state">显然，在选择的这个时间段你并没有乱花钱(·ω·)</div>';
        app.innerHTML = html;
        triggerViewAnimation();
        return;
    }

    html += `<div class="timeline-body">`;
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

                html += `<div class="timeline-item">`;
                html += `<div class="timeline-left">`;
                html += `<div class="timeline-dot"></div>`;
                html += `</div>`;
                html += `<div class="timeline-card">`;
                html += `<div class="timeline-images">`;
                if (img1) {
                    html += `<img class="timeline-img" src="${img1}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
                }
                if (img2) {
                    html += `<img class="timeline-img" src="${img2}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
                }
                if (!img1 && !img2) {
                    html += `<div class="timeline-no-img">无图</div>`;
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
    // ★★★ 恢复时间轴滚动（使用专题缓存） ★★★
    if (selectedSpecial && specialPageCaches[selectedSpecial]?.scrollY !== undefined) {
        setTimeout(() => {
            app.scrollTop = specialPageCaches[selectedSpecial].scrollY || 0;
        }, 50);
    }
    triggerViewAnimation();
}