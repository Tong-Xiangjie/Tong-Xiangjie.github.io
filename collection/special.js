// ==================== special.js ====================
// 专题功能

function renderSpecialOverview() {
    const app = document.getElementById('app');
    currentView = VIEW.OVERVIEW;

    const configs = getSpecialConfigs();
    let html = `<div class="overview-header"><h2>专题收藏</h2><p>选择专题查看详情</p></div>`;

    if (!configs || configs.length === 0) {
        html += '<div class="empty-state">暂无专题</div>';
        app.innerHTML = html;
        return;
    }

    for (const config of configs) {
        const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[config.id];
        const count = data ? data.length || 0 : 0;
        html += `<div class="special-card" onclick="onSpecialOverviewItemClick('${config.id}')">`;
        html += `<div class="special-card-title">${escapeHtml(config.name)}</div>`;
        html += `<div class="special-card-count">${count} 件</div>`;
        html += `</div>`;
    }

    app.innerHTML = html;
    triggerViewAnimation();

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.innerHTML = '';
}

function onSpecialOverviewItemClick(configId) {
    selectedSpecial = configId;
    currentCategoryId = configId;
    currentSubId = null;
    const config = getSpecialConfigs().find(c => c.id === configId);

    if (config && config.categories && config.categories.length > 0) {
        document.querySelector('.body-row')?.classList.remove('special-overview-mode');
        const toggleBtn = document.getElementById('sidebarToggle');
        if (toggleBtn) toggleBtn.style.display = '';
        renderSidebar();
        renderSpecialContent();
        triggerViewAnimation();
    } else {
        document.querySelector('.body-row')?.classList.add('special-overview-mode');
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

    let currentDataKey = config.id;
    if (currentSubId) {
        currentDataKey = config.id;
    }

    const data = window.FUN_DATA_MAP && window.FUN_DATA_MAP[currentDataKey];
    if (!data) {
        app.innerHTML = '<div class="empty-state">暂无数据</div>';
        return;
    }

    let html = `<div class="overview-header"><h2>${escapeHtml(config.name)}</h2></div>`;

    const items = data.items || data;
    if (!items || items.length === 0) {
        html += '<div class="empty-state">暂无数据</div>';
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
