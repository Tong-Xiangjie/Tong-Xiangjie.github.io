// ==================== special.js ====================
// 专题功能

function renderSpecialOverview() {
    const app = document.getElementById('app');
    currentView = VIEW.OVERVIEW;

    const configs = getSpecialConfigs();

    // 隐藏侧边栏，内容全宽
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
        // ★ 使用 config.dataKey 获取数据
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

    if (config && config.categories && config.categories.length > 0) {
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

function renderSpecialContent() {
    const app = document.getElementById('app');

    if (!selectedSpecial) {
        renderSpecialOverview();
        return;
    }

    const config = getSpecialConfigs().find(c => c.id === selectedSpecial);
    if (!config) { renderSpecialOverview(); return; }

    // ★ 使用 config.dataKey 获取数据
    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.dataKey];
    if (!data) {
        app.innerHTML = '<div class="empty-state">啥都木有</div>';
        return;
    }

    let html = `<div class="overview-header"><h2>${escapeHtml(config.name)}</h2></div>`;

    const items = data.items || data;
    if (!items || items.length === 0) {
        html += '<div class="empty-state">啥都木有</div>';
        app.innerHTML = html;
        return;
    }

    const imgBase = config.imageBase || '';
    html += `<div class="special-content">`;
    for (const item of items) {
        const imgUrl = item.yearImg ? imgBase + item.yearImg : '';
        html += `<div class="special-item" onclick="openSpecialModal('${escapeHtml(imgUrl)}', '${escapeHtml(item.name || '')}')">`;
        if (imgUrl) {
            html += `<img class="special-thumb" src="${imgUrl}" alt="${escapeHtml(item.name || '')}">`;
        }
        html += `<div class="special-item-info">`;
        html += `<div class="special-item-name">${escapeHtml(item.name || '')}</div>`;
        if (item.year) html += `<div class="special-item-year">${item.year}年</div>`;
        if (item.krause) html += `<div class="special-item-krause">${escapeHtml(item.krause)}</div>`;
        html += `</div>`;
        html += `</div>`;
    }
    html += `</div>`;

    app.innerHTML = html;
}

function openSpecialModal(imgUrl, title) {
    if (!imgUrl) return;
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    if (!modal || !modalImg) return;
    modalImg.src = imgUrl;
    modal.style.display = 'flex';

    const container = document.getElementById('imageContainer');
    if (container) {
        container.style.transform = 'translate3d(0px, 0px, 0px) scale3d(1, 1, 1)';
        currentScale = 1; currentX = 0; currentY = 0;
    }

    const scrollY = window.scrollY;
    document.body.classList.add('modal-open');
    document.body.style.top = `-${scrollY}px`;

    modalImg.onload = function() { initPinchZoom(); };
    if (modalImg.complete) initPinchZoom();
}
