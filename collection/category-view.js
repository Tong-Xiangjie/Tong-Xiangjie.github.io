// ==================== category-view.js ====================
// 分类内容渲染 + 图片弹窗

function renderCurrentCategory() {
    if (!currentCategoryId) { 
        switchViewContainer(currentMode + '_' + VIEW.OVERVIEW);
        renderOverview();
        triggerViewAnimation();
        return;
    }

    if (currentMode === MODE.SPECIAL) {
        renderSpecialContent();
        return;
    }

    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === currentCategoryId);
    if (!cat) { renderOverview(); triggerViewAnimation(); return; }

    if (cat.children && cat.children.length > 0 && !currentSubId) {
        renderCategoryOverview(cat);
        return;
    }

    let dataKey;
    const subMap = getSubCategoryMap();
    if (currentSubId) {
        const subInfo = subMap[currentSubId];
        if (subInfo) dataKey = subInfo.dataKey;
    } else if (cat.dataKey) {
        dataKey = cat.dataKey;
    }

    if (!dataKey) { renderOverview(); triggerViewAnimation(); return; }

    const data = getData(dataKey);
    if (!data) {
        const app = getViewContainer(currentMode + '_' + VIEW.CATEGORY);
        app.innerHTML = '<div class="empty-state">啥都木有</div>';
        triggerViewAnimation();
        return;
    }

    const subName = currentSubId ? (subMap[currentSubId]?.name || '') : '';
    const title = subName || (cat.name || '');
    renderSeriesList(data, title);
}

function renderCategoryOverview(cat) {
    const app = getViewContainer(currentMode + '_' + VIEW.CATEGORY);
    const imgBase = getImageBase();
    const subMap = getSubCategoryMap();

    let allItems = [];
    let globalIndex = 1;

    for (const sub of cat.children) {
        const subInfo = subMap[sub.id];
        if (!subInfo || !subInfo.dataKey) continue;
        const data = getData(subInfo.dataKey);
        if (!data || !data.series) continue;

        const catLabel = cat.name + ' - ' + sub.name;
        for (let si = 0; si < data.series.length; si++) {
            const series = data.series[si];
            if (series.varieties) {
                for (let vi = 0; vi < series.varieties.length; vi++) {
                    const variety = series.varieties[vi];
                    if (!variety.copies) continue;
                    for (let ci = 0; ci < variety.copies.length; ci++) {
                        allItems.push({
                            catLabel, catId: cat.id, subId: sub.id,
                            dataKey: subInfo.dataKey, si, vi, ci,
                            series, variety, copy: variety.copies[ci],
                            hasVarieties: true, globalIndex: globalIndex++
                        });
                    }
                }
            } else if (series.copies) {
                for (let ci = 0; ci < series.copies.length; ci++) {
                    allItems.push({
                        catLabel, catId: cat.id, subId: sub.id,
                        dataKey: subInfo.dataKey, si, vi: null, ci,
                        series, variety: null, copy: series.copies[ci],
                        hasVarieties: false, globalIndex: globalIndex++
                    });
                }
            }
        }
    }

    let html = `<div class="overview-header"><h2>${escapeHtml(cat.name)}</h2><p>共${allItems.length}件藏品</p></div>`;
    if (allItems.length === 0) {
        html += '<div class="empty-state">啥都木有</div>';
        app.innerHTML = html;
        triggerViewAnimation();
        return;
    }

    const grouped = {};
    for (const item of allItems) {
        if (!grouped[item.catLabel]) grouped[item.catLabel] = [];
        grouped[item.catLabel].push(item);
    }

    for (const [label, items] of Object.entries(grouped)) {
        html += `<div class="search-result-group">`;
        html += `<div class="search-group-header">${escapeHtml(label)}<span class="count">${items.length}件</span></div>`;
        for (const item of items) {
            const c = item.copy;
            const img1 = c.img1 ? imgBase + c.img1 : '';
            const img2 = c.img2 ? imgBase + c.img2 : '';
            const displayName = item.hasVarieties && item.variety
                ? `${item.series.seriesName} - ${item.variety.varietyName}`
                : item.series.seriesName;
            const catalogNum = c.catalogNumber || c.krause || '';
            const catalogDisplay = catalogNum ? (catalogNum.startsWith('Pick#') ? catalogNum : (catalogNum.startsWith('KM#') ? catalogNum : 'Pick# ' + catalogNum)) : '';

            html += `<div class="search-result-item" onclick="navigateFromOverview('${item.dataKey}', ${item.si}, ${item.hasVarieties ? item.vi : 'null'}, ${item.ci}, ${item.hasVarieties})">`;
            html += `<div class="dual-thumb">`;
            if (img1) html += `<img class="mini-thumb" src="${img1}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
            if (img2) html += `<img class="mini-thumb" src="${img2}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
            if (!img1 && !img2) html += `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;">O_O</div>`;
            html += `</div>`;
            html += `<div class="info">`;
            html += `<div class="name">${escapeHtml(displayName)}</div>`;
            html += `<div class="detail">`;
            if (c.version) html += `${escapeHtml(c.version)} · `;
            if (c.condition || c.grade) html += `${escapeHtml(c.condition || c.grade)} · `;
            if (c.year) html += `${c.year}年`;
            if (catalogDisplay) html += ` · ${escapeHtml(catalogDisplay)}`;
            html += `</div></div>`;
            html += `<div class="index-num">#${item.globalIndex}</div>`;
            html += `</div>`;
        }
        html += `</div>`;
    }

    app.innerHTML = html;
    triggerViewAnimation();
}

function renderSeriesList(data, title) {
    const app = getViewContainer(currentMode + '_' + VIEW.CATEGORY);
    const imgBase = getImageBase();

    if (!data || !data.series || data.series.length === 0) {
        app.innerHTML = '<div class="empty-state">啥都木有，赶快攒钱库库买入۹( ÒہÓ )۶</div>';
        return;
    }

    let html = `<div class="series-header">`;
    html += `<h2>${escapeHtml(title || data.name || '')}</h2>`;
    if (data.desc) html += `<div class="series-desc">${escapeHtml(data.desc)}</div>`;
    html += `</div>`;
    html += `<div class="series-container">`;

    for (let si = 0; si < data.series.length; si++) {
        const series = data.series[si];
        const seriesId = `series-${si}`;

        let seriesTotal = 0;
        if (series.varieties) {
            for (const v of series.varieties) seriesTotal += (v.copies ? v.copies.length : 0);
        } else {
            seriesTotal += (series.copies ? series.copies.length : 0);
        }

        html += `<div class="series-year-row">`;
        html += `<div class="series-year-header" onclick="toggleSeries('${seriesId}')">`;
        html += `<span class="series-name-label">${escapeHtml(series.seriesName)}</span>`;
        html += `<span class="series-count-badge">${seriesTotal}件</span>`;
        html += `<span class="series-expand-icon" id="icon-${seriesId}">▼</span>`;
        html += `</div>`;
        html += `<div class="series-body" id="body-${seriesId}">`;

        if (series.varieties && series.varieties.length > 0) {
            for (let vi = 0; vi < series.varieties.length; vi++) {
                const variety = series.varieties[vi];
                const copies = variety.copies || [];
                const uid = `v-${si}-${vi}`;

                html += `<div class="variety-row">`;
                html += `<div class="variety-header" onclick="toggleVariety('${uid}')">`;
                html += `<span class="variety-name">${escapeHtml(variety.varietyName)}</span>`;
                html += `<span class="variety-summary">`;
                html += `<span class="count">${copies.length}件</span>`;
                html += `<span class="variety-expand-icon" id="icon-${uid}">▼</span>`;
                html += `</span></div>`;
                html += `<div class="copy-list" id="list-${uid}">`;
                html += renderCopiesList(copies);
                html += `</div></div>`;
            }
        } else if (series.copies && series.copies.length > 0) {
            html += `<div class="copy-list open" id="copies-${seriesId}" style="max-height:none;opacity:1;">`;
            html += renderCopiesList(series.copies);
            html += `</div>`;
        }

        html += `</div></div>`;
    }

    html += `</div>`;
    app.innerHTML = html;
}

function renderCopiesList(copies) {
    const imgBase = getImageBase();
    if (!copies || copies.length === 0) {
        return '<div style="padding:8px;font-size:0.8rem;color:var(--text-secondary);">暂无藏品</div>';
    }
    let html = '';
    for (const c of copies) {
        const img1 = c.img1 ? imgBase + c.img1 : '';
        const img2 = c.img2 ? imgBase + c.img2 : '';
        const catalogNum = c.catalogNumber || c.krause || '';
        const catalogDisplay = catalogNum ? (catalogNum.startsWith('Pick#') ? catalogNum : (catalogNum.startsWith('KM#') ? catalogNum : 'Pick# ' + catalogNum)) : '';
        html += `<div class="copy-item">`;
        html += `<div class="dual-thumb">`;
        if (img1) html += `<img class="copy-thumb" src="${img1}" alt="O_o" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
        if (img2) html += `<img class="copy-thumb" src="${img2}" alt="o_O" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
        if (!img1 && !img2) html += `<div class="copy-thumb no-img">我的图捏？？？</div>`;
        html += `</div>`;
        html += `<div class="copy-info">`;
        if (c.version) html += `<div class="version">${escapeHtml(c.version)}</div>`;
        html += `<div>`;
        if (c.condition || c.grade) html += `<span class="condition">${escapeHtml(c.condition || c.grade)}</span>`;
        if (c.gradingCompany) html += `<span class="meta">${escapeHtml(c.gradingCompany)}</span>`;
        if (c.year) html += `<span class="meta">${c.year}年</span>`;
        if (c.purchaseDate) html += `<span class="meta"> · ${escapeHtml(c.purchaseDate)}</span>`;
        if (c.price) {
            const priceText = String(c.price).includes('元') ? c.price : c.price + '元';
            html += `<span class="meta">以${escapeHtml(priceText)}的价格购入</span>`;
        }
        html += `</div>`;
        if (catalogDisplay) html += `<div class="meta">${escapeHtml(catalogDisplay)}</div>`;
        if (c.material) html += `<div class="meta">材质：${escapeHtml(c.material)}</div>`;
        if (c.remark) html += `<div class="meta">${escapeHtml(c.remark)}</div>`;
        html += `</div>`;
        html += `</div>`;
    }
    return html;
}

function toggleSeries(id) {
    const body = document.getElementById('body-' + id);
    const icon = document.getElementById('icon-' + id);
    if (!body) return;
    body.classList.toggle('open');
    if (icon) icon.classList.toggle('open');
}

function toggleVariety(id) {
    const list = document.getElementById('list-' + id);
    const icon = document.getElementById('icon-' + id);
    if (!list) return;
    list.classList.toggle('open');
    if (icon) icon.classList.toggle('open');
}

// ========== 图片弹窗 ==========
function openModal(imgSrc1, imgSrc2) {
    currentModalImg1 = imgSrc1;
    currentModalImg2 = imgSrc2;
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    if (!modal || !modalImg) return;
    modalImg.src = imgSrc1;
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

function closeModal() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    modal.style.display = 'none';
    const scrollY = parseInt(document.body.style.top || '0') * -1;
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    if (scrollY) window.scrollTo(0, scrollY);
    const modalImg = document.getElementById('modalImg');
    if (modalImg) modalImg.src = '';
    if (hammerManager) { hammerManager.destroy(); hammerManager = null; }
}

function initPinchZoom() {
    const container = document.getElementById('imageContainer');
    if (!container) return;
    if (hammerManager) { hammerManager.destroy(); hammerManager = null; }
    hammerManager = new Hammer.Manager(container);
    const pinch = new Hammer.Pinch();
    const pan = new Hammer.Pan();
    hammerManager.add([pinch, pan]);
    let lastScale = 1, lastX = 0, lastY = 0;

    function resetTransform() {
        currentScale = 1; currentX = 0; currentY = 0;
        container.style.transform = 'translate3d(0px, 0px, 0px) scale3d(1, 1, 1)';
    }

    function clampTransform() {
        const img = document.getElementById('modalImg');
        if (!img) return;
        const containerRect = container.parentElement.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();
        const scaledWidth = imgRect.width, scaledHeight = imgRect.height;
        let maxX = 0, maxY = 0;
        if (scaledWidth > containerRect.width) maxX = (scaledWidth - containerRect.width) / 2;
        if (scaledHeight > containerRect.height) maxY = (scaledHeight - containerRect.height) / 2;
        currentX = Math.min(maxX, Math.max(-maxX, currentX));
        currentY = Math.min(maxY, Math.max(-maxY, currentY));
        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
    }

    hammerManager.on('pinchstart', function(e) { lastScale = currentScale; e.preventDefault(); });
    hammerManager.on('pinchmove', function(e) {
        let newScale = lastScale * e.scale;
        newScale = Math.min(4, Math.max(1, newScale));
        currentScale = newScale;
        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        e.preventDefault();
    });
    hammerManager.on('pinchend', function(e) { clampTransform(); e.preventDefault(); });
    hammerManager.on('panstart', function(e) { lastX = currentX; lastY = currentY; });
    hammerManager.on('panmove', function(e) {
        if (currentScale > 1) {
            currentX = lastX + e.deltaX;
            currentY = lastY + e.deltaY;
            container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        }
        e.preventDefault();
    });
    hammerManager.on('panend', function(e) { clampTransform(); });
    container.addEventListener('dblclick', function(e) { resetTransform(); e.preventDefault(); });
    resetTransform();
}
