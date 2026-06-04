// ========== 概览页渲染（显示全部藏品列表） ==========
function renderOverview() {
    const app = document.getElementById('app');
    currentView = 'overview';

    // 收集所有藏品（类似旧站空搜索）
    let allItems = [];
    let globalIndex = 1;

    for (const cat of categoryTree) {
        if (cat.children) {
            for (const sub of cat.children) {
                const data = getData(sub.dataKey);
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
                                    dataKey: sub.dataKey, si, vi, ci,
                                    series, variety, copy: variety.copies[ci],
                                    hasVarieties: true, globalIndex: globalIndex++
                                });
                            }
                        }
                    } else if (series.copies) {
                        for (let ci = 0; ci < series.copies.length; ci++) {
                            allItems.push({
                                catLabel, catId: cat.id, subId: sub.id,
                                dataKey: sub.dataKey, si, vi: null, ci,
                                series, variety: null, copy: series.copies[ci],
                                hasVarieties: false, globalIndex: globalIndex++
                            });
                        }
                    }
                }
            }
        } else {
            const data = getData(cat.dataKey);
            if (!data || !data.series) continue;
            const catLabel = cat.name;
            for (let si = 0; si < data.series.length; si++) {
                const series = data.series[si];
                if (series.varieties) {
                    for (let vi = 0; vi < series.varieties.length; vi++) {
                        const variety = series.varieties[vi];
                        if (!variety.copies) continue;
                        for (let ci = 0; ci < variety.copies.length; ci++) {
                            allItems.push({
                                catLabel, catId: cat.id, subId: null,
                                dataKey: cat.dataKey, si, vi, ci,
                                series, variety, copy: variety.copies[ci],
                                hasVarieties: true, globalIndex: globalIndex++
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allItems.push({
                            catLabel, catId: cat.id, subId: null,
                            dataKey: cat.dataKey, si, vi: null, ci,
                            series, variety: null, copy: series.copies[ci],
                            hasVarieties: false, globalIndex: globalIndex++
                        });
                    }
                }
            }
        }
    }

    let html = `<div class="overview-header"><h2>全部藏品</h2><p>共 ${allItems.length} 张</p></div>`;

    if (allItems.length === 0) {
        html += '<div class="empty-state">暂无数据</div>';
        app.innerHTML = html;
        return;
    }

    // 按分类分组
    const grouped = {};
    for (const item of allItems) {
        const key = item.catLabel;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
    }

    // 按 categoryTree 顺序输出
    for (const cat of categoryTree) {
        if (cat.children) {
            for (const sub of cat.children) {
                const label = cat.name + ' - ' + sub.name;
                const group = grouped[label];
                if (!group) continue;
                html += renderOverviewGroup(label, group);
            }
        } else {
            const label = cat.name;
            const group = grouped[label];
            if (!group) continue;
            html += renderOverviewGroup(label, group);
        }
    }

    app.innerHTML = html;
}

function renderOverviewGroup(label, items) {
    let html = `<div class="search-result-group">`;
    html += `<div class="search-group-header">${escapeHtml(label)} <span class="count">${items.length}张</span></div>`;
    for (const item of items) {
        const c = item.copy;
        const imgSrc = c.img1 ? IMAGE_BASE + c.img1 : '';
        const displayName = item.hasVarieties && item.variety
            ? `${item.series.seriesName} - ${item.variety.varietyName}`
            : item.series.seriesName;

        html += `<div class="search-result-item" onclick="navigateFromOverview('${item.dataKey}', ${item.si}, ${item.hasVarieties ? item.vi : 'null'}, ${item.ci}, ${item.hasVarieties})">`;
        if (imgSrc) {
            html += `<img class="thumb" src="${imgSrc}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(imgSrc)}', '${escapeHtml(c.img2 ? IMAGE_BASE + c.img2 : imgSrc)}')">`;
        } else {
            html += `<div class="thumb" style="background:#e0d8cc;"></div>`;
        }
        html += `<div class="info">`;
        html += `<div class="name">${escapeHtml(displayName)}</div>`;
        html += `<div class="detail">`;
        if (c.version) html += `${escapeHtml(c.version)} · `;
        if (c.condition) html += `${escapeHtml(c.condition)} · `;
        if (c.year) html += `${c.year}年 · `;
        if (c.price) html += `${escapeHtml(c.price)}`;
        html += `</div>`;
        html += `</div>`;
        html += `<div style="color:#999;font-size:0.7rem;flex-shrink:0;">#${item.globalIndex}</div>`;
        html += `</div>`;
    }
    html += `</div>`;
    return html;
}

// 从概览跳转到分类展开
function navigateFromOverview(dataKey, si, vi, ci, hasVarieties) {
    for (const cat of categoryTree) {
        if (cat.children) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) {
                    currentCategoryId = cat.id;
                    currentSubId = sub.id;
                    currentView = 'category';
                    renderSidebar();
                    renderCurrentCategory();
                    setTimeout(() => {
                        const targetId = (hasVarieties && vi !== null) ? `v-${si}-${vi}` : `s-${si}`;
                        toggleVariety(targetId);
                        setTimeout(() => {
                            const el = document.getElementById('list-' + targetId);
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 100);
                    }, 50);
                    return;
                }
            }
        } else if (cat.dataKey === dataKey) {
            currentCategoryId = cat.id;
            currentSubId = null;
            currentView = 'category';
            renderSidebar();
            renderCurrentCategory();
            setTimeout(() => {
                const targetId = (hasVarieties && vi !== null) ? `v-${si}-${vi}` : `s-${si}`;
                toggleVariety(targetId);
                setTimeout(() => {
                    const el = document.getElementById('list-' + targetId);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }, 50);
            return;
        }
    }
}

// ========== 分类内容页渲染 ==========
function renderSeriesList(data, title) {
    const app = document.getElementById('app');
    if (!data || !data.series || data.series.length === 0) {
        app.innerHTML = '<div class="empty-state">暂无藏品</div>';
        return;
    }

    let html = `<div class="series-header">`;
    html += `<h2>${escapeHtml(title || data.name || '')}</h2>`;
    if (data.desc) html += `<div class="series-desc">${escapeHtml(data.desc)}</div>`;
    html += `</div>`;

    html += `<div class="variety-list">`;

    for (let si = 0; si < data.series.length; si++) {
        const series = data.series[si];

        if (series.varieties && series.varieties.length > 0) {
            for (let vi = 0; vi < series.varieties.length; vi++) {
                const variety = series.varieties[vi];
                const copies = variety.copies || [];
                const totalPrice = copies.reduce((sum, c) => {
                    const num = parseFloat(String(c.price || '0').replace(/[^0-9.]/g, ''));
                    return sum + (isNaN(num) ? 0 : num);
                }, 0);

                const uniqueId = `v-${si}-${vi}`;
                html += `<div class="variety-row">`;
                html += `<div class="variety-header" onclick="toggleVariety('${uniqueId}')">`;
                html += `<span class="variety-name">${escapeHtml(variety.varietyName || series.seriesName)}</span>`;
                html += `<div class="variety-summary">`;
                html += `<span class="count">${copies.length}张</span>`;
                if (totalPrice > 0) html += `<span class="total-price">≈${Math.round(totalPrice)}元</span>`;
                if (series.seriesName && series.varieties.length > 1) {
                    html += `<span style="color:#999;font-size:0.75rem;">${escapeHtml(series.seriesName)}</span>`;
                }
                html += `<span class="variety-expand-icon" id="icon-${uniqueId}">▼</span>`;
                html += `</div></div>`;
                html += `<div class="copy-list" id="list-${uniqueId}">`;
                html += renderCopiesList(copies);
                html += `</div></div>`;
            }
        } else if (series.copies && series.copies.length > 0) {
            const copies = series.copies;
            const totalPrice = copies.reduce((sum, c) => {
                const num = parseFloat(String(c.price || '0').replace(/[^0-9.]/g, ''));
                return sum + (isNaN(num) ? 0 : num);
            }, 0);

            const uniqueId = `s-${si}`;
            html += `<div class="variety-row">`;
            html += `<div class="variety-header" onclick="toggleVariety('${uniqueId}')">`;
            html += `<span class="variety-name">${escapeHtml(series.seriesName)}</span>`;
            html += `<div class="variety-summary">`;
            html += `<span class="count">${copies.length}张</span>`;
            if (totalPrice > 0) html += `<span class="total-price">≈${Math.round(totalPrice)}元</span>`;
            html += `<span class="variety-expand-icon" id="icon-${uniqueId}">▼</span>`;
            html += `</div></div>`;
            html += `<div class="copy-list" id="list-${uniqueId}">`;
            html += renderCopiesList(copies);
            html += `</div></div>`;
        }
    }

    html += `</div>`;
    app.innerHTML = html;
}

// ========== 藏品列表渲染 ==========
function renderCopiesList(copies) {
    if (!copies || copies.length === 0) {
        return '<div style="padding:8px;color:#999;font-size:0.8rem;">暂无藏品</div>';
    }

    let html = '';
    for (const c of copies) {
        const imgSrc1 = c.img1 ? IMAGE_BASE + c.img1 : '';
        const imgSrc2 = c.img2 ? IMAGE_BASE + c.img2 : '';

        html += `<div class="copy-item">`;
        if (imgSrc1) {
            html += `<img class="copy-thumb" src="${imgSrc1}" alt="缩略图" onclick="openModal('${escapeHtml(imgSrc1)}', '${escapeHtml(imgSrc2 || imgSrc1)}')">`;
        } else {
            html += `<div class="copy-thumb" style="background:#e0d8cc;display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:#999;">无图</div>`;
        }
        html += `<div class="copy-info">`;
        if (c.version) html += `<div class="version">${escapeHtml(c.version)}</div>`;
        html += `<div>`;
        if (c.condition) html += `<span class="condition">${escapeHtml(c.condition)}</span>`;
        if (c.year) html += `<span class="meta">${c.year}年</span>`;
        if (c.price) html += `<span class="meta"> · ${escapeHtml(c.price)}</span>`;
        if (c.purchaseDate) html += `<span class="meta"> · ${escapeHtml(c.purchaseDate)}</span>`;
        html += `</div>`;
        if (c.krause) html += `<div class="meta">Pick# ${escapeHtml(c.krause)}</div>`;
        if (c.remark) html += `<div class="meta">${escapeHtml(c.remark)}</div>`;
        html += `</div>`;
        html += `</div>`;
    }
    return html;
}

// ========== 展开/折叠品种 ==========
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
    hammerManager = new Hammer(container);
    hammerManager.get('pinch').set({ enable: true });

    let lastScale = 1;
    let lastX = 0;
    let lastY = 0;

    hammerManager.on('pinchstart', function() {
        lastScale = currentScale;
    });

    hammerManager.on('pinch', function(e) {
        currentScale = Math.max(0.5, Math.min(5, lastScale * e.scale));
        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
    });

    hammerManager.on('panstart', function() {
        lastX = currentX;
        lastY = currentY;
    });

    hammerManager.on('pan', function(e) {
        if (currentScale > 1) {
            currentX = lastX + e.deltaX;
            currentY = lastY + e.deltaY;
            container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        }
    });

    hammerManager.on('doubletap', function() {
        if (currentScale > 1) {
            currentScale = 1; currentX = 0; currentY = 0;
            container.style.transform = 'translate3d(0px, 0px, 0px) scale3d(1, 1, 1)';
        } else {
            currentScale = 2.5;
            container.style.transform = `translate3d(0px, 0px, 0px) scale3d(2.5, 2.5, 1)`;
        }
    });
}

// ========== 主题弹窗 ==========
let themeModal = null;
function toggleThemeModal() {
    if (!themeModal) {
        themeModal = document.createElement('div');
        themeModal.className = 'theme-modal';
        themeModal.innerHTML = `
            <div style="margin-bottom:8px;font-size:0.9rem;">选择主题色</div>
            <div class="theme-colors">
                <div class="theme-color" style="background:#1677ff"></div>
                <div class="theme-color" style="background:#d92121"></div>
                <div class="theme-color" style="background:#00b42a"></div>
                <div class="theme-color" style="background:#ff7d00"></div>
                <div class="theme-color" style="background:#722ed1"></div>
            </div>
            <input type="color" id="custom-theme" style="width:100%;margin-top:10px;border:none;height:30px;cursor:pointer;">
        `;
        document.body.appendChild(themeModal);

        themeModal.querySelectorAll('.theme-color').forEach(el => {
            el.addEventListener('click', () => {
                if (typeof setTheme === 'function') setTheme(el.style.backgroundColor);
            });
        });

        document.getElementById('custom-theme').addEventListener('input', e => {
            if (typeof setTheme === 'function') setTheme(e.target.value);
        });
    }
    themeModal.classList.toggle('show');
}
