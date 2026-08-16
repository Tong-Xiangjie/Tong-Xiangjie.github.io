// ==================== special.js ====================
// 专题

let specialItemsList = [];
let specialCurrentIndex = -1;

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

// ========== 通用分组 ==========
function buildGroupCategories(config, items, groupBy) {
    if (!items || items.length === 0) return null;
    const set = new Set();
    for (const item of items) {
        const val = item[groupBy];
        if (val) set.add(val);
    }
    if (set.size === 0) return null;
    const sortFn = groupBy === 'denom' ? compareDenom : (a, b) => parseInt(b) - parseInt(a);
    return [...set].sort(sortFn).map(g => ({ id: g, name: g, dataKey: config.id }));
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

// ========== 点击专题项 ==========
function onSpecialOverviewItemClick(configId) {
    selectedSpecial = configId;
    currentCategoryId = configId;
    currentSubId = null;
    const config = getSpecialConfigs().find(c => c.id === configId);

    // 地图视图：整页地图，无侧边栏
    if (config && config.view === 'map') {
        document.querySelector('.body-row')?.classList.remove('sidebar-hidden');
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.style.display = 'none';
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.innerHTML = '';
        renderShanheContent();
        triggerViewAnimation();
        return;
    }

    document.querySelector('.body-row')?.classList.remove('sidebar-hidden');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    if (config) {
        const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
        const items = data ? (data.items || data) : [];
        const groupBy = config.groupBy || 'year';
        const groupChildren = buildGroupCategories(config, items, groupBy);

        const specialTree = specialCategoryTree ? specialCategoryTree.find(c => c.id === configId) : null;
        if (specialTree) {
            specialTree.children = (groupChildren && groupChildren.length > 0) ? groupChildren : null;
        }
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

// ========== 渲染专题内容 ==========
function renderSpecialContent() {
    const app = document.getElementById('app');

    if (!selectedSpecial) {
        renderSpecialOverview();
        return;
    }

    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) { renderSpecialOverview(); return; }

    // 地图视图跳转
    if (config.view === 'map') {
        renderShanheContent();
        return;
    }

    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    if (!data) {
        app.innerHTML = '<div class="empty-state">啥都木有</div>';
        return;
    }

    const items = data.items || data;
    if (!items || items.length === 0) {
        app.innerHTML = '<div class="empty-state">啥都木有</div>';
        return;
    }

    const groupBy = config.groupBy || 'year';
    let filteredItems = items;
    if (currentSubId) {
        filteredItems = items.filter(item => String(item[groupBy]) === currentSubId);
    }

    const groups = {};
    for (const item of filteredItems) {
        const key = item[groupBy] || '未知';
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    }

    const sortFn = groupBy === 'denom' ? compareDenom : (a, b) => {
        if (a === '未知') return 1;
        if (b === '未知') return -1;
        return parseInt(b) - parseInt(a);
    };
    const sortedKeys = Object.keys(groups).sort(sortFn);

    specialItemsList = [];
    for (const key of sortedKeys) {
        for (const item of groups[key]) {
            specialItemsList.push(item);
        }
    }

    let html = `<div class="overview-header"><h2>${escapeHtml(config.name)}</h2>`;
    if (currentSubId) {
        html += `<p style="font-size:0.8rem;color:var(--theme);">当前筛选：${currentSubId}</p>`;
    }
    html += `</div>`;

    const groupLabel = groupBy === 'year' ? '年' : '';
    for (const key of sortedKeys) {
        const group = groups[key];
        html += `<div class="special-year-section">`;
        html += `<div class="special-year-title">${key}${groupLabel} <span class="count">${group.length}件</span></div>`;
        html += `<div class="special-year-grid">`;
        for (const item of group) {
            const index = specialItemsList.indexOf(item);
            const imgUrl = getImageUrl(item.yearImg || item.img);
            html += `<div class="special-item-card" onclick="openSpecialLightbox(${index})">`;
            if (imgUrl) {
                html += `<div class="special-item-img-wrapper"><img class="special-item-img" src="${imgUrl}" alt="${escapeHtml(item.name || '')}" loading="lazy"></div>`;
            } else {
                html += `<div class="special-item-img-wrapper" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-secondary);">暂无图片</div>`;
            }
            html += `<div class="special-item-info">`;
            html += `<div class="special-item-name">${escapeHtml(item.name || '')}</div>`;
            if (item.krause && !/unlisted/i.test(item.krause)) {
                html += `<div class="special-item-krause">${escapeHtml(item.krause)}</div>`;
            }
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }

    if (filteredItems.length === 0) {
        html += '<div class="empty-state">该分组暂无藏品</div>';
    }

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
        html += `<img src="${imgUrl}" alt="${escapeHtml(item.name || '')}" style="max-width:100%;max-height:100%;width:auto;object-fit:contain;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">`;
        html += `</div>`;
    } else {
        html += `<div style="height:55vh;display:flex;align-items:center;justify-content:center;margin-bottom:12px;color:var(--text-secondary);font-size:0.85rem;">暂无图片</div>`;
    }

    html += `<div style="border-top:1px solid var(--border);padding-top:12px;">`;
    html += `<div style="font-size:1rem;font-weight:bold;color:var(--text);margin-bottom:4px;">${escapeHtml(item.name || '')}</div>`;
    if (item.year) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">年份：${item.year}年</div>`;
    if (item.denom) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">面额：${escapeHtml(item.denom)}</div>`;
    if (item.plate) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">车牌：${escapeHtml(item.plate)}</div>`;
    if (item.city) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">城市：${escapeHtml(item.city)}</div>`;
    if (item.scene) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">主景：${escapeHtml(item.scene)}</div>`;
    if (item.krause && !/unlisted/i.test(item.krause)) {
        html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">编号：${escapeHtml(item.krause)}</div>`;
    }
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

// ========== 方寸山河：地图视图 ==========
let shanheItems = null;
let shanheProvinceMap = {};

function renderShanheContent() {
    const app = document.getElementById('app');

    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) { renderSpecialOverview(); return; }

    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    if (!data) {
        app.innerHTML = '<div class="empty-state">数据加载失败</div>';
        return;
    }
    shanheItems = data.items || data;

    // 构建省份→场景列表映射
    shanheProvinceMap = {};
    for (const item of shanheItems) {
        const p = item.province;
        if (!shanheProvinceMap[p]) shanheProvinceMap[p] = [];
        shanheProvinceMap[p].push(item);
    }

    // 加载地图 SVG
    const mapFile = config.mapFile || 'collection/china_map.svg';
    fetch(mapFile)
        .then(res => {
            if (!res.ok) throw new Error('地图加载失败');
            return res.text();
        })
        .then(svgText => {
            renderShanheMap(app, svgText, config);
        })
        .catch(err => {
            app.innerHTML = `<div class="empty-state">地图加载失败：${err.message}</div>`;
        });
}

function renderShanheMap(app, svgText, config) {
    let html = `<div class="overview-header"><h2>${escapeHtml(config.name)}</h2>`;
    if (config.slogan) html += `<p style="font-size:0.8rem;color:var(--text-secondary);">${escapeHtml(config.slogan)}</p>`;
    html += `<button class="back-btn" onclick="backFromShanheMap()" style="margin-top:6px;">← 返回专题列表</button>`;
    html += `</div>`;

    html += `<div class="shanhe-map-wrap">`;
    html += svgText;
    html += `</div>`;

    app.innerHTML = html;
    triggerViewAnimation();

    // 绑定省份点击事件：根据 class 识别省份
    const svg = app.querySelector('svg');
    if (!svg) return;

    const allPaths = svg.querySelectorAll('.state');
    for (const path of allPaths) {
        const classes = path.getAttribute('class') || '';
        const match = classes.match(/(?:^|\s)([a-z]+)(?:\s|$)/);
        if (match) {
            const prov = match[1];
            if (shanheProvinceMap[prov] && shanheProvinceMap[prov].length > 0) {
                path.classList.add('has-scenes');
            }
            path.style.cursor = 'pointer';
            path.addEventListener('click', () => {
                if (shanheProvinceMap[prov] && shanheProvinceMap[prov].length > 0) {
                    renderShanheProvince(prov);
                }
            });
        }
    }
}

function renderShanheProvince(province) {
    const app = document.getElementById('app');
    const items = shanheProvinceMap[province] || [];

    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);

    // 按车牌分组
    const groups = {};
    for (const item of items) {
        const key = item.plate || '未知';
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    }
    const sortedKeys = Object.keys(groups).sort();

    // 构建展示列表
    specialItemsList = [];
    for (const key of sortedKeys) {
        for (const item of groups[key]) {
            specialItemsList.push(item);
        }
    }

    let html = `<div class="overview-header">`;
    html += `<button class="back-btn" onclick="renderShanheContent()">← 返回地图</button>`;
    html += `<h2 style="margin-top:8px;">${escapeHtml(province)} · ${items.length}处场景</h2>`;
    html += `</div>`;

    const provinceNames = window.SHANHE_PROVINCE_NAMES || {};
    const provinceChinese = provinceNames[province] || province;

    for (const key of sortedKeys) {
        const group = groups[key];
        html += `<div class="special-year-section">`;
        html += `<div class="special-year-title">${key} <span class="count">${group.length}件</span></div>`;
        html += `<div class="special-year-grid">`;
        for (const item of group) {
            const index = specialItemsList.indexOf(item);
            const imgUrl = getImageUrl(item.img);
            html += `<div class="special-item-card" onclick="openSpecialLightbox(${index})">`;
            if (imgUrl) {
                html += `<div class="special-item-img-wrapper"><img class="special-item-img" src="${imgUrl}" alt="${escapeHtml(item.scene || '')}" loading="lazy"></div>`;
            } else {
                html += `<div class="special-item-img-wrapper" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-secondary);">暂无图片</div>`;
            }
            html += `<div class="special-item-info">`;
            html += `<div class="special-item-name">${escapeHtml(item.scene || item.name || '')}</div>`;
            if (item.denom) html += `<div class="special-item-krause">${escapeHtml(item.denom)}</div>`;
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }

    app.innerHTML = html;
    triggerViewAnimation();
}

function backFromShanheMap() {
    selectedSpecial = null;
    renderSpecialOverview();
}
