// ==================== special.js ====================
// 专题功能

let specialItemsList = [];
let specialCurrentIndex = -1;

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
        const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
        const count = data ? data.length || 0 : 0;
        html += `<div class="special-overview-card" onclick="onSpecialOverviewItemClick('${config.id}')">`;
        html += `<div class="special-overview-card-title">${escapeHtml(config.name)}</div>`;
        html += `<div class="special-overview-card-count">${count}件</div>`;
        html += `</div>`;
    }
    html += `</div>`;

    app.innerHTML = html;
    triggerViewAnimation();
}

function onSpecialOverviewItemClick(configId) {
    selectedSpecial = configId;
    currentCategoryId = configId;
    currentSubId = null;
    const config = getSpecialConfigs().find(c => c.id === configId);

    document.querySelector('.body-row')?.classList.remove('sidebar-hidden');
    document.querySelector('.body-row')?.classList.remove('special-overview-mode');

    if (config) {
        const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
        const items = data ? (data.items || data) : [];
        const decadeChildren = buildDecadeCategories(config, items);

        const specialTree = specialCategoryTree ? specialCategoryTree.find(c => c.id === configId) : null;
        if (specialTree) {
            if (decadeChildren && decadeChildren.length > 0) {
                specialTree.children = decadeChildren;
            } else {
                specialTree.children = null;
            }
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

function buildDecadeCategories(config, items) {
    if (!items || items.length === 0) return null;

    const years = new Set();
    for (const item of items) {
        if (item.year) years.add(item.year);
    }
    if (years.size === 0) return null;

    const decades = {};
    for (const year of years) {
        const decadeStart = Math.floor(year / 10) * 10;
        const label = decadeStart + 's';
        if (!decades[label]) decades[label] = [];
        decades[label].push(year);
    }

    return Object.keys(decades).sort().map(decade => ({
        id: decade,
        name: decade,
        dataKey: config.id
    }));
}

function renderSpecialContent() {
    const app = document.getElementById('app');

    if (!selectedSpecial) {
        renderSpecialOverview();
        return;
    }

    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) { renderSpecialOverview(); return; }

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

    specialItemsList = items;

    let filteredItems = items;
    if (currentSubId) {
        const decadeStart = parseInt(currentSubId);
        if (!isNaN(decadeStart)) {
            filteredItems = items.filter(item => {
                const year = item.year;
                return year && Math.floor(year / 10) * 10 === decadeStart;
            });
        }
    }

    const imgBase = config.imageBase || '';
    let html = `<div class="overview-header"><h2>${escapeHtml(config.name)}</h2>`;
    if (currentSubId) {
        html += `<p style="font-size:0.8rem;color:var(--theme);">当前筛选：${currentSubId}</p>`;
    }
    html += `</div>`;

    const yearGroups = {};
    for (let i = 0; i < filteredItems.length; i++) {
        const item = filteredItems[i];
        const year = item.year || '未知';
        if (!yearGroups[year]) yearGroups[year] = [];
        yearGroups[year].push({ item, index: items.indexOf(item) });
    }

    const sortedYears = Object.keys(yearGroups).sort((a, b) => {
        if (a === '未知') return 1;
        if (b === '未知') return -1;
        return parseInt(b) - parseInt(a);
    });

    for (const year of sortedYears) {
        const group = yearGroups[year];
        html += `<div class="special-year-section">`;
        html += `<div class="special-year-title">${year}年 <span class="count">${group.length}件</span></div>`;
        html += `<div class="special-year-grid">`;
        for (const { item, index } of group) {
            const imgUrl = item.yearImg ? imgBase + item.yearImg : '';
            html += `<div class="special-item-card" onclick="openSpecialLightbox(${index})">`;
            if (imgUrl) {
                html += `<div class="special-item-img-wrapper"><img class="special-item-img" src="${imgUrl}" alt="${escapeHtml(item.name || '')}" loading="lazy"></div>`;
            } else {
                html += `<div class="special-item-img-wrapper" style="display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:var(--text-secondary);">暂无图片</div>`;
            }
            html += `<div class="special-item-info">`;
            html += `<div class="special-item-name">${escapeHtml(item.name || '')}</div>`;
            if (item.krause) html += `<div class="special-item-krause">${escapeHtml(item.krause)}</div>`;
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }

    if (filteredItems.length === 0) {
        html += '<div class="empty-state">该年代暂无藏品</div>';
    }

    app.innerHTML = html;
    triggerViewAnimation();
}

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

    // ★ 关闭按钮：右上角，不与导航按钮重叠
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'position:absolute;top:-8px;right:-8px;font-size:1.3rem;cursor:pointer;color:#fff;line-height:1;z-index:10;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.45);border:2px solid rgba(255,255,255,0.3);transition:background 0.15s;';
    closeBtn.onmouseover = () => { closeBtn.style.background = 'rgba(0,0,0,0.7)'; };
    closeBtn.onmouseout = () => { closeBtn.style.background = 'rgba(0,0,0,0.45)'; };
    closeBtn.onclick = (e) => { e.stopPropagation(); closeSpecialLightbox(); };

    const content = document.createElement('div');
    content.className = 'special-lightbox-content';
    content.style.padding = '16px 20px 20px';

    inner.appendChild(closeBtn);
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
    const imgBase = config ? config.imageBase || '' : '';
    const imgUrl = item.yearImg ? imgBase + item.yearImg : '';

    let html = '';

    // ★ 导航按钮：不再用内联样式，使用 CSS class
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">`;
    html += `<div style="font-size:0.8rem;color:var(--text-secondary);">${index + 1} / ${items.length}</div>`;
    html += `<div style="display:flex;gap:8px;">`;

    const prevDisabled = index <= 0;
    html += `<button class="special-lightbox-nav" onclick="navigateLightbox(-1)" ${prevDisabled ? 'disabled' : ''}>← 上一张</button>`;

    const nextDisabled = index >= items.length - 1;
    html += `<button class="special-lightbox-nav" onclick="navigateLightbox(1)" ${nextDisabled ? 'disabled' : ''}>下一张 →</button>`;

    html += `</div></div>`;

    if (imgUrl) {
        html += `<div style="text-align:center;margin-bottom:12px;">`;
        html += `<img src="${imgUrl}" alt="${escapeHtml(item.name || '')}" style="max-width:100%;max-height:55vh;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">`;
        html += `</div>`;
    } else {
        html += `<div style="text-align:center;padding:40px;color:var(--text-secondary);font-size:0.85rem;">暂无图片</div>`;
    }

    html += `<div style="border-top:1px solid var(--border);padding-top:12px;">`;
    html += `<div style="font-size:1rem;font-weight:bold;color:var(--text);margin-bottom:4px;">${escapeHtml(item.name || '')}</div>`;
    if (item.year) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">年份：${item.year}年</div>`;
    if (item.krause) html += `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:2px;">编号：${escapeHtml(item.krause)}</div>`;
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
