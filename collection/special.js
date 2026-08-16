// ==================== special.js ====================
// 专题

let specialItemsList = [];
let specialCurrentIndex = -1;
let shanheProvinceNames = {}; // 方寸山河：省份拼音 → 中文名

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

    // ★ 方寸山河：地图整页模式，无侧边栏
    if (config && config.view === 'map') {
        document.querySelector('.body-row')?.classList.add('sidebar-hidden');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.style.display = 'none';
        renderShanheContent(config);
        triggerViewAnimation();
        return;
    }

    if (config) {
        const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
        const items = data ? (data.items || data) : [];
        const groupChildren = buildGroupCategories(config, items);

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

    // ★ 方寸山河：地图交互分支
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
    if (item.year) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">年份：${item.year}年</div>`;
    if (item.denom) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">面额：${escapeHtml(item.denom)}</div>`;
    if (item.plate) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">车牌：${escapeHtml(item.plate)}</div>`;
    if (item.city) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">城市：${escapeHtml(item.city)}</div>`;
    if (item.krause && !/unlisted/i.test(item.krause)) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">编号：${escapeHtml(item.krause)}</div>`;
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

// ========== 方寸山河：地图交互（六点调整版） ==========
async function renderShanheContent(config) {
    const app = document.getElementById('app');
    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    const items = data ? (data.items || data) : [];
    const mapFile = config.mapFile || 'china_map.svg';
    shanheProvinceNames = window.SHANHE_PROVINCE_NAMES || {};

    if (!currentSubId) {
        // ★ 地图视图
        app.innerHTML =
            `<div class="back-bar"><button class="back-btn" onclick="backFromShanheToOverview()">← 返回专题</button></div>` +
            `<div class="overview-header"><h2>${escapeHtml(config.name)}</h2><p>点击省份查看对应的纸币主景</p></div>` +
            `<div class="shanhe-map-loading">且待万里山河在你面前徐徐展开</div>`;
        try {
            const res = await fetch(mapFile);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const svgText = await res.text();
            const wrap = document.createElement('div');
            wrap.className = 'shanhe-map-wrap';
            wrap.innerHTML = svgText;
            app.appendChild(wrap);

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

            const removeLoad = app.querySelector('.shanhe-map-loading');
            if (removeLoad) removeLoad.remove();

            // 主图：给每个省份着色 + 事件 + 标注
            svg.querySelectorAll('.state').forEach(el => {
                const cls = el.getAttribute('class') || '';
                const pid = cls.split(/\s+/).filter(c => c && c !== 'state')[0] || '';
                setupShanheState(el, pid, countByProvince[pid] || 0, maxCount, themeLightRGB, config, svg);
            });

            // ★ 港澳局部放大图
            buildShanheInset(svg, countByProvince, maxCount, themeLightRGB, config);

            triggerViewAnimation();
        } catch (e) {
            app.innerHTML = `<div class="empty-state">地图加载失败：${escapeHtml(e.message)}</div>`;
        }
    } else {
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
function createShanheLabel(svg, x, y, name, count) {
    const NS = 'http://www.w3.org/2000/svg';
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'shanhe-label' + (count > 0 ? ' has-count' : ''));
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

// 给省份元素绑定着色 + 点击 + 悬浮联动（主图与放大图共用）
function setupShanheState(el, pid, count, maxCount, themeLightRGB, config, svg) {
    const name = shanheProvinceNames[pid] || pid;
    el.style.fill = fillForCount(count, maxCount, themeLightRGB);
    el.style.cursor = count > 0 ? 'pointer' : 'default';
    el.addEventListener('click', () => {
        if (count === 0) return;
        currentSubId = pid;
        renderShanheContent(config);
    });
    let bbox = null;
    try { bbox = el.getBBox(); } catch (e) {}
    if (!bbox) return null;
    const text = createShanheLabel(svg, bbox.x + bbox.width / 2, bbox.y + bbox.height / 2, name, count);
    el.addEventListener('mouseenter', () => text.classList.add('active'));
    el.addEventListener('mouseleave', () => text.classList.remove('active'));
    return text;
}

// ★ 港澳局部放大图：右下角叠加一个缩略图
function buildShanheInset(mainSvg, countByProvince, maxCount, themeLightRGB, config) {
    const ids = ['xianggang', 'aomen'];
    const els = [];
    for (const id of ids) {
        const el = mainSvg.querySelector('.state.' + id);
        if (el) els.push({ id, el });
    }
    if (els.length === 0) return;

    // 合并 bbox
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const { el } of els) {
        const b = el.getBBox();
        minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + b.width);
        minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.height);
    }
    const pad = 10;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const wrap = document.createElement('div');
    wrap.className = 'shanhe-map-inset';
    wrap.innerHTML = '<div class="shanhe-map-inset-title">港澳放大</div>';

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    wrap.appendChild(svg);

    const mapWrap = mainSvg.closest('.shanhe-map-wrap');
    if (mapWrap) mapWrap.appendChild(wrap);   // 先挂进 DOM，getBBox 才能取到

    for (const { id, el } of els) {
        const clone = el.cloneNode(true);
        clone.removeAttribute('style');
        svg.appendChild(clone);               // 先挂载再取 bbox
        setupShanheState(clone, id, countByProvince[id] || 0, maxCount, themeLightRGB, config, svg);
    }
}

// ★ 返回专题概览（地图专用）
function backFromShanheToOverview() {
    selectedSpecial = null;
    currentCategoryId = null;
    currentSubId = null;
    renderSpecialOverview();
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

// ========== 省份主景视图（保持不变） ==========
function renderShanheProvince(config) {
    const app = document.getElementById('app');
    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    const items = (data ? (data.items || data) : []).filter(item => item.province === currentSubId);
    const provinceName = shanheProvinceNames[currentSubId] || currentSubId;

    // 按车牌/城市分组
    const cityGroups = {};
    for (const item of items) {
        const key = item.plate || item.city || '其他';
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
    for (const plate of Object.keys(cityGroups)) for (const item of cityGroups[plate]) specialItemsList.push(item);

    for (const plate of Object.keys(cityGroups)) {
        const list = cityGroups[plate];
        html += `<div class="special-year-section">`;
        html += `<div class="special-year-title">${escapeHtml(plate)} <span class="count">${list.length}件</span></div>`;
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
            const sub = [item.plate, item.city, item.denom, item.year ? item.year + '年' : ''].filter(Boolean).join(' · ');
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
    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (config) renderShanheContent(config);
}
