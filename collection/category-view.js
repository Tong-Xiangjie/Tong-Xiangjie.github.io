// ==================== category-view.js ====================

let copyDetailList = []; // 当前分类页已渲染的 copy 元信息，供详细信息卡片使用

// ========== 通过分类树查找 dataKey（纸币/硬币统一） ==========
function findDataKeyByCategory(categoryId, subId) {
    const tree = getCategoryTree();
    for (const cat of tree) {
        if (cat.id === categoryId) {
            if (subId && cat.children) {
                for (const sub of cat.children) {
                    if (sub.id === subId) {
                        return sub.dataKey;
                    }
                }
                return null; // 子分类不存在
            }
            // 无子分类或未指定子分类，返回自身 dataKey
            return cat.dataKey || null;
        }
    }
    return null;
}

function renderCurrentCategory() {
    if (!currentCategoryId) {
        switchToCurrentContainer();
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

    // 如果有子分类但未选择子分类，显示分类概览
    if (cat.children && cat.children.length > 0 && !currentSubId) {
        renderCategoryOverview(cat);
        return;
    }

    // ★ 统一使用 findDataKeyByCategory，不再依赖 subCategoryMap
    let dataKey = null;
    if (currentSubId) {
        dataKey = findDataKeyByCategory(cat.id, currentSubId);
    }
    if (!dataKey && cat.dataKey) {
        dataKey = cat.dataKey;
    }

    if (!dataKey) { renderOverview(); triggerViewAnimation(); return; }

    const data = getData(dataKey);
    if (!data) {
        const app = getRenderContainer();
        app.innerHTML = '<div class="empty-state">啥都木有</div>';
        triggerViewAnimation();
        return;
    }

    const subName = currentSubId ? getSubName(cat, currentSubId) : '';
    const title = subName || (cat.name || '');
    renderSeriesList(data, title);
}

function getSubName(cat, subId) {
    if (cat.children) {
        for (const sub of cat.children) {
            if (sub.id === subId) return sub.name;
        }
    }
    return '';
}

function renderCategoryOverview(cat) {
    const app = getRenderContainer();

    let allItems = [];
    let globalIndex = 1;

    if (cat.children && cat.children.length > 0) {
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
            const img1 = getImageUrl(c.img1);
            const img2 = getImageUrl(c.img2);
            const thumb1 = getThumbUrl(c.img1);
            const thumb2 = getThumbUrl(c.img2);
            const displayName = item.hasVarieties && item.variety
                ? `${item.series.seriesName} - ${item.variety.varietyName}`
                : item.series.seriesName;

            const catalogNum = c.catalogNumber || c.krause || '';
            const catalogDisplay = formatCatalogNumber(catalogNum);

            html += `<div class="search-result-item" onclick="navigateFromOverview('${item.dataKey}', ${item.si}, ${item.hasVarieties ? item.vi : 'null'}, ${item.ci}, ${item.hasVarieties})">`;
            html += `<div class="dual-thumb">`;
            if (img1) html += `<img class="mini-thumb" src="${thumb1}"${thumbFallbackAttr(img1)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
            if (img2) html += `<img class="mini-thumb" src="${thumb2}"${thumbFallbackAttr(img2)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
            if (!img1 && !img2) html += `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;">O_O</div>`;
            html += `</div>`;
            html += `<div class="info">`;
            html += `<div class="name">${escapeHtml(displayName)}</div>`;
            html += `<div class="detail">`;
            if (c.version) html += `${escapeHtml(c.version)} · `;
            if (c.condition || c.grade) html += `${escapeHtml(c.condition || c.grade)} · `;
            if (c.year) html += `${c.year}年发行`;
            if (catalogDisplay) html += ` · ${escapeHtml(catalogDisplay)}`;
            html += `</div></div>`;
            html += `<div class="index-num">#${item.globalIndex}</div>`;
            html += `</div>`;
        }
        html += `</div>`;
    }

    app.innerHTML = html;
    triggerViewAnimation();

    // ★ 分类概览图片是懒加载的，渲染完成后在后台补齐
    if (typeof schedulePrecacheCurrentView === 'function') schedulePrecacheCurrentView();
}

function renderSeriesList(data, title) {
    const app = getRenderContainer();
    copyDetailList = []; // 重置详细信息列表

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
                html += renderCopiesList(copies, data.detailFields, `${series.seriesName} - ${variety.varietyName}`);
                html += `</div></div>`;
            }
        } else if (series.copies && series.copies.length > 0) {
            html += `<div class="copy-list open" id="copies-${seriesId}" style="max-height:none;opacity:1;">`;
            html += renderCopiesList(series.copies, data.detailFields, series.seriesName);
            html += `</div>`;
        }

        html += `</div></div>`;
    }

    html += `</div>`;
    app.innerHTML = html;

    // ★ 藏品列表图片是懒加载的，渲染完成后在后台补齐
    if (typeof schedulePrecacheCurrentView === 'function') schedulePrecacheCurrentView();
}

function renderCopiesList(copies, detailFields, displayName) {
    if (!copies || copies.length === 0) {
        return '<div style="padding:8px;font-size:0.8rem;color:var(--text-secondary);">啥都木有</div>';
    }
    let html = '';
    for (const c of copies) {
        const idx = copyDetailList.length;
        copyDetailList.push({ copy: c, name: displayName || '', detailFields: detailFields || [] });

        const img1 = getImageUrl(c.img1);
        const img2 = getImageUrl(c.img2);
        const thumb1 = getThumbUrl(c.img1);
        const thumb2 = getThumbUrl(c.img2);
        const catalogNum = c.catalogNumber || c.krause || '';
        const catalogDisplay = formatCatalogNumber(catalogNum);

        html += `<div class="copy-item">`;
        html += `<div class="dual-thumb">`;
        if (img1) html += `<img class="copy-thumb" src="${thumb1}"${thumbFallbackAttr(img1)} loading="lazy" decoding="async" alt="O_o" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
        if (img2) html += `<img class="copy-thumb" src="${thumb2}"${thumbFallbackAttr(img2)} loading="lazy" decoding="async" alt="o_O" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
        if (!img1 && !img2) html += `<div class="copy-thumb no-img">我的图捏？？？</div>`;
        html += `</div>`;
        html += `<div class="copy-info">`;

        if (c.version) {
            html += `<div class="version"><span class="version-text">${escapeHtml(c.version)}</span><span class="copy-detail-link" onclick="openCopyDetail(${idx})">详细信息</span></div>`;
        } else {
            html += `<div class="version"><span class="copy-detail-link" onclick="openCopyDetail(${idx})">详细信息</span></div>`;
        }

        html += `<div>`;
        if (c.condition || c.grade) html += `<span class="condition">${escapeHtml(c.condition || c.grade)}</span>`;
        if (c.gradingCompany) html += `<span class="meta">${escapeHtml(c.gradingCompany)}</span>`;
        if (c.year) html += `<span class="meta">${c.year}年发行</span>`;
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
    // 用精确高度过渡，避免固定 max-height 造成的"弹开后空跑"
    animateAccordion(body, !body.classList.contains('open'));
    if (icon) icon.classList.toggle('open');
}

function toggleVariety(id) {
    const list = document.getElementById('list-' + id);
    const icon = document.getElementById('icon-' + id);
    if (!list) return;
    animateAccordion(list, !list.classList.contains('open'));
    if (icon) icon.classList.toggle('open');
}

// ========== 图片弹窗 ==========
// ★ 秒开策略：先用缩略图占位 —— 它通常已经在缓存里（网格刚显示过），可以瞬间出图；
//   原图在后台静默加载，到货后再无缝替换。避免点开后对着黑屏等 1MB 下载。
// ★ 共享元素过渡：从被点击的缩略图位置"生长"到全屏，关闭时缩回。
//   缩略图是原图的等比缩放，所以「缩略图矩形」与「全屏 contain 矩形」宽高比一致，
//   于是可以只用 translate + 均匀 scale 完成 —— 无畸变、全程 GPU 合成、
//   且完全不去碰 Hammer 的捏合缩放（它操作 #imageContainer，这里操作独立的飞行图层）。
let modalLoadToken = 0;
let modalFlightEl = null;
let modalFlightTimer = null;
let modalCloseTimer = null;

const MODAL_FLIGHT_MS = 320;
const MODAL_FLIGHT_EASE = 'cubic-bezier(.22,.61,.36,1)';
const MODAL_HIDE_MS = 300;   // 与 CSS 的 --dur-3 保持一致（蒙版淡出时长）
// 最大放大倍率：触摸双指与桌面滚轮共用同一个上限，保证两端手感一致
const MODAL_MAX_SCALE = 8;

// ★ 取「图片真实内容」在视口中的矩形，而不是元素框。
//   网格里的缩略图元素框是固定尺寸（.mini-thumb 36×26、.copy-thumb 56×40、
//   .timeline-img 80×60），图片靠 object-fit 内接，所以元素框的比例（约 4:3）
//   ≠ 图片本身的比例（纸币普遍约 1.7:1）。直接拿元素框当飞行起点，图片会带着
//   错误比例起飞、看起来像被拉伸。这里按真实宽高比算出内接矩形。
function imageContentRect(el) {
    const box = el.getBoundingClientRect();
    const nw = el.naturalWidth || 0, nh = el.naturalHeight || 0;
    if (!nw || !nh || box.width <= 0 || box.height <= 0) return box;
    const ar = nw / nh;
    // contain 内接（over：铺满并溢出，可见部分被框裁掉；这里统一取不溢出的内接矩形）
    let w = box.width, h = w / ar;
    if (h > box.height) { h = box.height; w = h * ar; }
    const left = box.left + (box.width - w) / 2;
    const top = box.top + (box.height - h) / 2;
    // 注意：必须带上 right / bottom —— closeModal 用它们判断缩略图是否还在视口内，
    // 缺了就会导致「关闭时缩回」这一步永远不触发。
    return { left: left, top: top, width: w, height: h, right: left + w, bottom: top + h };
}

// 视口内「按 contain 铺满」的矩形
function modalContainRect(ar) {
    const vw = window.innerWidth, vh = window.innerHeight;
    let w = vw, h = vw / ar;
    if (h > vh) { h = vh; w = vh * ar; }
    const left = (vw - w) / 2, top = (vh - h) / 2;
    return { left: left, top: top, width: w, height: h, right: left + w, bottom: top + h };
}

function cancelModalFlight() {
    if (modalFlightTimer) { clearTimeout(modalFlightTimer); modalFlightTimer = null; }
    if (modalFlightEl) {
        if (modalFlightEl.parentNode) modalFlightEl.remove();
        modalFlightEl = null;
    }
}

// 从 fromRect 飞到 toRect（元素最终落在 toRect，靠 transform 反向偏移回到起点）
function startModalFlight(fromRect, toRect, srcUrl, onDone) {
    cancelModalFlight();
    const el = document.createElement('img');
    el.className = 'modal-flight';
    el.src = srcUrl;
    el.style.left = toRect.left + 'px';
    el.style.top = toRect.top + 'px';
    el.style.width = toRect.width + 'px';
    el.style.height = toRect.height + 'px';
    const s = fromRect.width / toRect.width;
    const dx = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
    const dy = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')';
    document.body.appendChild(el);
    modalFlightEl = el;

    void el.offsetWidth;   // 先落到起始状态，再启动过渡
    el.style.transition = 'transform ' + MODAL_FLIGHT_MS + 'ms ' + MODAL_FLIGHT_EASE;
    el.style.transform = 'none';

    let done = false;
    const finish = function () {
        if (done) return;
        done = true;
        if (modalFlightTimer) { clearTimeout(modalFlightTimer); modalFlightTimer = null; }
        if (onDone) onDone();
    };
    el.addEventListener('transitionend', finish, { once: true });
    // 兜底：过渡未触发（元素被隐藏等）也必须收尾，否则弹窗会卡在半透明状态
    modalFlightTimer = setTimeout(finish, MODAL_FLIGHT_MS + 80);
}

function openModal(imgSrc1, imgSrc2) {
    currentModalImg1 = imgSrc1;
    currentModalImg2 = imgSrc2;
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    if (!modal || !modalImg || !imgSrc1) return;

    const token = ++modalLoadToken;
    // ★ 弹窗主图直接就是原图，不再走「先缩略图占位、再后台换原图」的两段式。
    //   缩略图改当 #modalImg 自己的背景垫底：#modalImg 是 100vw/100vh + object-fit:contain，
    //   背景同样按 contain 铺在同一个盒子里，所以两者完全同框同形、像素级对齐。
    //   于是原图解码完成前看到的就是同一张图的低清版（不会空白），解码完成后原图
    //   不透明、正好盖住背景 —— 连交叉淡入都不需要，也没有"先糊后清"的跳变。
    const thumbUrl = getThumbUrl(imgSrc1);
    const backdropUrl = (thumbUrl && thumbUrl !== imgSrc1) ? thumbUrl : '';

    // 来源缩略图必须就是这一张，否则不做生长动画（例如从别处调用 openModal）
    const sourceEl = lastModalSourceImg;
    const sourceSrc = (sourceEl && typeof sourceEl.getAttribute === 'function')
        ? sourceEl.getAttribute('src') : '';
    const canFly = !prefersReducedMotion() && sourceEl && sourceEl.isConnected &&
        typeof sourceEl.getBoundingClientRect === 'function' &&
        // 来源可能挂在缩略图上，也可能（网格若直接用原图）挂在原图上，两种都认
        (sourceSrc === imgSrc1 || (!!backdropUrl && sourceSrc === backdropUrl));

    cancelModalFlight();
    // 关键：带 forwards 的 .modal-hide 若残留，弹窗会一直不可见
    if (modalCloseTimer) { clearTimeout(modalCloseTimer); modalCloseTimer = null; }
    modal.classList.remove('modal-hide');

    // 原图缺失时退到缩略图（数据里确实存在"引用了但图没上传"的图）
    modalImg.onerror = function () {
        modalImg.onerror = null;
        if (backdropUrl && modalImg.src !== backdropUrl) modalImg.src = backdropUrl;
    };
    modalImg.style.backgroundImage = backdropUrl ? 'url("' + backdropUrl + '")' : '';
    modalImg.style.backgroundSize = 'contain';
    modalImg.style.backgroundPosition = 'center';
    modalImg.style.backgroundRepeat = 'no-repeat';
    modalImg.src = imgSrc1;
    modalImg.style.opacity = canFly ? '0' : '';   // 飞行期间先藏着真图，落地后再显形
    modal.classList.add('modal-show');
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

    let flying = false;
    if (canFly) {
        const from = imageContentRect(sourceEl);
        if (from.width >= 8 && from.height >= 8) {
            // 缩略图与原图等比，直接用缩略图的宽高比即可
            startModalFlight(from, modalContainRect(from.width / from.height),
                sourceEl.currentSrc || sourceEl.src,
                function () {
                    if (token !== modalLoadToken) return;
                    cancelModalFlight();
                    modalImg.style.opacity = '';
                });
            flying = true;
        }
    }
    if (!flying) modalImg.style.opacity = '';
}

function closeModal() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;

    // ★ 蒙版淡出（原来是 finish() 里直接 display:none，所以"啪"地一下就没了）。
    //   注意 .modal 同时包含蒙版与图片，所以这里是整体不透明度淡出：
    //     · 走回缩动画时，飞行图层在 modal 之外（z-index 更高）→ 只有蒙版在淡，
    //       图片仍然清晰地飞回原缩略图位置
    //     · 不走回缩时，整个查看器一起淡出
    modal.classList.remove('modal-show');
    modal.classList.add('modal-hide');

    let done = false;
    const finish = function () {
        if (done) return;
        done = true;
        if (modalCloseTimer) { clearTimeout(modalCloseTimer); modalCloseTimer = null; }
        cancelModalFlight();
        modal.style.display = 'none';
        modal.classList.remove('modal-show', 'modal-hide');
        const img = document.getElementById('modalImg');
        if (img) { img.src = ''; img.style.opacity = ''; img.style.backgroundImage = ''; }
        const scrollY = parseInt(document.body.style.top || '0') * -1;
        document.body.classList.remove('modal-open');
        document.body.style.top = '';
        if (scrollY) window.scrollTo(0, scrollY);
        if (hammerManager) { hammerManager.destroy(); hammerManager = null; }
    };

    // 关闭：缩回原缩略图位置（前提是那张缩略图还在、且仍在视口内且没被滚走）
    const src = lastModalSourceImg;
    const modalImg = document.getElementById('modalImg');
    let flown = false;
    if (!prefersReducedMotion() && src && src.isConnected && modalImg &&
        typeof src.getBoundingClientRect === 'function') {
        const to = imageContentRect(src);
        const onScreen = to.bottom > 0 && to.top < window.innerHeight &&
                         to.right > 0 && to.left < window.innerWidth;
        if (onScreen && to.width >= 8 && to.height >= 8) {
            modalImg.style.opacity = '0';
            startModalFlight(modalContainRect(to.width / to.height), to,
                modalImg.currentSrc || modalImg.src, finish);
            flown = true;
        }
    }

    // 兜底：无论是否回缩，蒙版淡出结束后都必须真正隐藏。
    // （回缩动画的 finish 会先触发，done 保证只执行一次）
    const hideMs = prefersReducedMotion() ? 0 : MODAL_HIDE_MS;
    if (modalCloseTimer) clearTimeout(modalCloseTimer);
    modalCloseTimer = setTimeout(finish, (flown ? MODAL_FLIGHT_MS : 0) + hideMs + 80);
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
        newScale = Math.min(MODAL_MAX_SCALE, Math.max(1, newScale));
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

    // ---- 桌面端：滚轮缩放 ----
    // Hammer 的 pinch 只在触摸双指时生效，鼠标本身没有缩放手段，于是灯箱在桌面上
    // 完全没法放大（而底部的鼠标操作提示写着"滚轮缩放"，所以这里必须真的实现）。
    // 先摘掉上一次的监听：initPinchZoom 每次打开弹窗（以及 modalImg.onload）都会调用，
    // 不摘会不断累积监听器。
    if (container._wheelZoom) container.removeEventListener('wheel', container._wheelZoom);

    // 以视口坐标 (clientX, clientY) 为锚点缩放 —— 让光标下的那个点保持不动。
    // 变换是 translate(x,y) scale(s) 且 origin 为元素中心，所以图片的视觉中心
    // = 视口中心 + (currentX, currentY)；令锚点在缩放前后重合即可解出新的平移量。
    function zoomAt(clientX, clientY, factor) {
        const prev = currentScale;
        const next = Math.min(MODAL_MAX_SCALE, Math.max(1, prev * factor));
        if (next === prev) return;
        const vw = window.innerWidth, vh = window.innerHeight;
        const cx = vw / 2 + currentX, cy = vh / 2 + currentY;
        const k = next / prev;
        currentX = clientX - k * (clientX - cx) - vw / 2;
        currentY = clientY - k * (clientY - cy) - vh / 2;
        currentScale = next;
        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        clampTransform();
    }

    container._wheelZoom = function(e) {
        if (e.ctrlKey) return;                    // Ctrl+滚轮是浏览器自己的缩放，不抢
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    // 注：不再绑定 dblclick 还原 —— 现在"点哪儿都关"，双击的第一下就已经关掉弹窗了，
    // 还原动作永远不会触发。缩回 1 倍用滚轮向下 / 双指捏合即可。

    container.addEventListener('wheel', container._wheelZoom, { passive: false });
    resetTransform();
}

// ========== 详细信息卡片 ==========
function openCopyDetail(idx) {
    const info = copyDetailList[idx];
    if (!info) return;
    const { copy, name, detailFields } = info;

    const old = document.getElementById('copyDetailLightbox');
    if (old) old.remove();

    const lightbox = document.createElement('div');
    lightbox.id = 'copyDetailLightbox';
    lightbox.className = 'info-lightbox';

    const inner = document.createElement('div');
    inner.className = 'info-lightbox-inner';

    const closeBtn = document.createElement('div');
    closeBtn.className = 'lightbox-close';
    closeBtn.textContent = '×';
    closeBtn.title = '关闭';
    closeBtn.onclick = (e) => { e.stopPropagation(); closeCopyDetail(); };
    inner.appendChild(closeBtn);

    let html = '';
    if (name) html += `<div class="info-lightbox-title">${escapeHtml(name)}</div>`;

    const img1 = getImageUrl(copy.img1);
    const img2 = getImageUrl(copy.img2);
    // 卡片里用缩略图（48% 宽度约 300px），点开大图才加载原图
    const thumb1 = getThumbUrl(copy.img1);
    const thumb2 = getThumbUrl(copy.img2);
    if (img1 || img2) {
        html += `<div class="info-lightbox-imgs">`;
        if (img1) html += `<img src="${thumb1}"${thumbFallbackAttr(img1)} alt="" onclick="openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
        if (img2) html += `<img src="${thumb2}"${thumbFallbackAttr(img2)} alt="" onclick="openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
        html += `</div>`;
    }

    const rows = [];
    for (const f of detailFields) {
        let val = copy[f.key];
        if (val === undefined || val === null) continue;
        val = String(val);
        if (val === '' || val === '---') continue;
        if (f.key === 'krause' || f.key === 'catalogNumber') {
            val = formatCatalogNumber(val);
            if (!val) continue;
        }
        rows.push({ label: f.label || f.key, value: val });
    }
    if (copy.remark && !detailFields.some(f => f.key === 'remark')) {
        rows.push({ label: '备注', value: String(copy.remark) });
    }

    if (rows.length > 0) {
        html += `<div class="info-lightbox-body">`;
        for (const r of rows) {
            html += `<div class="detail-row"><span class="detail-label">${escapeHtml(r.label)}</span><span class="detail-value">${escapeHtml(r.value)}</span></div>`;
        }
        html += `</div>`;
    }

    const content = document.createElement('div');
    content.className = 'info-lightbox-content';
    content.innerHTML = html;
    inner.appendChild(content);
    lightbox.appendChild(inner);
    document.body.appendChild(lightbox);

    lightbox.addEventListener('click', function(e) {
        if (e.target === lightbox) closeCopyDetail();
    });
    document.addEventListener('keydown', copyDetailKeyHandler);
}

function closeCopyDetail() {
    const overlay = document.getElementById('copyDetailLightbox');
    if (overlay) fadeOutAndRemove(overlay, 240);   // 先淡出再移除，避免硬切
    document.removeEventListener('keydown', copyDetailKeyHandler);
}

function copyDetailKeyHandler(e) {
    if (e.key === 'Escape') closeCopyDetail();
}