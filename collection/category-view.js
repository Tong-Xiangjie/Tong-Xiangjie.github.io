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

    // ★ 归属校验（"当前位置"失效就丢弃）。
    //   focusSeries/focusVariety 是**序号**，只在同一个分类内才有意义。
    //   用户在 A 分类展开了系列 3，再切到只有 2 个系列的 B 分类 —— 若不丢弃，
    //   buildRoute() 会写出 B/s3 这种指向不存在系列的链接，别人点开会看到错误页面。
    //   ★ 判定条件是"序号所属分类**变了**"，不是"当前 scope 不等于本分类"：
    //     后者有时序漏洞 —— renderSeriesList() 会把 focusScope 提前写成新分类的 scope，
    //     而序号还是旧分类的，此时"等于当前"成立，旧序号就被当成新分类的写进 URL
    //     （实测：从 rmb3 切到纪念钞，地址栏变成 #notes/commemorative/s1/v0）。
    //     focusOwner 与渲染时机解耦，所以只看它。
    const nowScope = getCategoryScope();
    if (focusOwner !== null && focusOwner !== nowScope) {
        focusSeries = [];
        focusVariety = [];
        const st = modeStates[currentMode];
        if (st) { st.focusSeries = []; st.focusVariety = []; }
    }
    focusOwner = nowScope;
    focusScope = nowScope;

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
            const g1 = gridImg(c.img1);
            const g2 = gridImg(c.img2);
            const displayName = item.hasVarieties && item.variety
                ? `${item.series.seriesName} - ${item.variety.varietyName}`
                : item.series.seriesName;

            const catalogNum = c.catalogNumber || c.krause || '';
            const catalogDisplay = formatCatalogNumber(catalogNum);

            html += `<div class="search-result-item" onclick="navigateFromOverview('${item.dataKey}', ${item.si}, ${item.hasVarieties ? item.vi : 'null'}, ${item.ci}, ${item.hasVarieties})">`;
            html += `<div class="dual-thumb">`;
            if (img1) html += `<img class="mini-thumb" src="${escapeAttr(g1.src)}"${thumbFallbackAttr(g1.fallback)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeAttr(img1)}', '${escapeAttr(img2 || img1)}')">`;
            if (img2) html += `<img class="mini-thumb" src="${escapeAttr(g2.src)}"${thumbFallbackAttr(g2.fallback)} loading="lazy" decoding="async" alt="" onclick="event.stopPropagation(); openModal('${escapeAttr(img2)}', '${escapeAttr(img1 || img2)}')">`;
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

    // ★ 注意：pendingReveal 只对"这一次渲染"有效。无论下面走哪个分支都必须消费掉，
    //   否则空数据提前 return 时它会残留下来，污染下一次无关的分类渲染。
    const reveal = (pendingReveal && pendingReveal.catId === String(currentSubId || currentCategoryId || ''))
        ? pendingReveal : null;
    pendingReveal = null;

    if (!data || !data.series || data.series.length === 0) {
        app.innerHTML = '<div class="empty-state">啥都木有，赶快攒钱库库买入۹( ÒہÓ )۶</div>';
        return;
    }

    // ★ 本分类的作用域（用于给手风琴 id 加前缀，避免跨分类撞名 —— 审查报告 B7）
    const accScope = getCategoryScope();

    // ★ 此刻才最终确定"当前位置"的归属：这里渲染的一定是目标分类，
    //   所以 focusOwner/focusScope 取本分类作用域必然正确。
    //   为什么不放在 applyRoute / enter* 里定：那两处都可能早于容器建立
    //   （getContainerKey() 还不代表目标分类），而且这一路上 syncRoute() 会被调用多次，
    //   归属一旦填错，buildRoute() 就会把序号丢掉甚至写成别的分类的序号。
    //   放在"真正渲染这个分类"的唯一出口上，比在调用链里补更稳。
    focusOwner = accScope;
    focusScope = accScope;
    // ★ 但序号不能无条件继承：只有"本次渲染确实展开了某些系列"才保留展开态。
    //   反例（实测）：在 rmb3 展开 s1/v0 → 去搜索 → 再点侧边栏回到 rmb3。
    //   这条路径既没走 applyRoute（没有 pendingReveal），也没走"能恢复展开态"的
    //   enterNotesOrCoinsTab，于是界面上一个系列都没展开，而 focus 还留着 s1/v0，
    //   buildRoute() 就写出 …/s1/v0 —— URL 声称的位置和眼前所见不一致，复制出去是错的。
    //   没有 reveal 指令 = 本次不是"定位跳转"，那就以"什么都没展开"为准。
    //
    //   ★ 归一成数组：reveal 可能来自深链接（列表）或概览/搜索（单值），
    //     统一在这里转成集合，下面按集合判定，两条来源就不会各写一套逻辑。
    const wantSeries = new Set();
    const wantVarieties = new Set();
    if (reveal) {
        const sList = (reveal.sIdxList && reveal.sIdxList.length)
            ? reveal.sIdxList
            : ((reveal.sIdx === undefined || reveal.sIdx === null) ? [] : [reveal.sIdx]);
        for (const n of sList) if (Number.isFinite(n)) wantSeries.add(n);
        // 新链接的品种用 si.vi 对表达（能跨系列）；旧的单值 vIdx 归属同一个 s
        for (const pair of (reveal.vPairList || [])) {
            if (Number.isFinite(pair[0]) && Number.isFinite(pair[1])) wantVarieties.add(pair[0] + '.' + pair[1]);
        }
        if (reveal.vIdx !== undefined && reveal.vIdx !== null && Number.isFinite(reveal.vIdx)) {
            const host = sList.length ? sList[0] : 0;
            wantVarieties.add(host + '.' + reveal.vIdx);
        }
    }
    if (!reveal) {
        focusSeries = [];
        focusVariety = [];
    }
    const st = modeStates[currentMode];
    if (st) {
        st.focusOwner = accScope;
        st.focusScope = accScope;
        // 展开态一并落档：切板块再回来时靠它还原地址栏
        st.focusSeries = focusSeries.slice();
        st.focusVariety = focusVariety.slice();
    }

    let html = `<div class="series-header">`;
    html += `<h2>${escapeHtml(title || data.name || '')}</h2>`;
    if (data.desc) html += `<div class="series-desc">${escapeHtml(data.desc)}</div>`;
    html += `</div>`;
    html += `<div class="series-container">`;

    for (let si = 0; si < data.series.length; si++) {
        const series = data.series[si];
        const seriesId = seriesScopeId(accScope, si);

        // ★ 空系列：既没有品种，也没有条目。这种系列**不能**渲染成可点击的头 ——
        //   点下去三角形会转（open 类加上了），但系列体里什么都没有，scrollHeight=0，
        //   视觉上就是「点了没反应」。用户报的"概览跳转点不开"最终定位到这里：
        //   数据里曾把「啥都木有」这句占位提示直接写成了 seriesName。
        //   改为输出一行不可展开的占位行，不再给三角形这个假交互。
        const varieties = series.varieties || [];
        const copies = series.copies || [];
        const isEmptySeries = varieties.length === 0 && copies.length === 0;

        if (isEmptySeries) {
            html += `<div class="series-year-row series-year-row-empty">`;
            html += `<div class="series-year-header series-year-header-empty">`;
            html += `<span class="series-name-label series-name-label-empty">${escapeHtml(series.seriesName)}</span>`;
            html += `<span class="series-empty-badge">暂无藏品</span>`;
            html += `</div></div>`;
            continue;
        }

        // 本系列是否要在本次渲染里直接展开
        const openSeries = wantSeries.has(si);

        let seriesTotal = 0;
        if (series.varieties) {
            for (const v of series.varieties) seriesTotal += (v.copies ? v.copies.length : 0);
        } else {
            seriesTotal += (series.copies ? series.copies.length : 0);
        }

        html += `<div class="series-year-row">`;
        html += `<div class="series-year-header" onclick="toggleSeries('${seriesId}', this)">`;
        html += `<span class="series-name-label">${escapeHtml(series.seriesName)}</span>`;
        html += `<span class="series-count-badge">${seriesTotal}件</span>`;
        html += `<span class="series-expand-icon${openSeries ? ' open' : ''}" id="icon-${seriesId}">▼</span>`;
        html += `</div>`;
        html += `<div class="series-body${openSeries ? ' open' : ''}" id="body-${seriesId}"${openSeries ? ' style="max-height:none;"' : ''}>`;

        if (series.varieties && series.varieties.length > 0) {
            for (let vi = 0; vi < series.varieties.length; vi++) {
                const variety = series.varieties[vi];
                const copies = variety.copies || [];
                const uid = varietyScopeId(accScope, si, vi);
                // 目标品种：仅在目标系列内部才认，避免在别的系列里误展开同序号品种
                // ★ 用 si.vi 复合键：新品种段能跨系列（v1.0,3.2），只比 vi 会串台
                const openVariety = openSeries && wantVarieties.has(si + '.' + vi);

                html += `<div class="variety-row">`;
                html += `<div class="variety-header" onclick="toggleVariety('${uid}', this)">`;
                html += `<span class="variety-name">${escapeHtml(variety.varietyName)}</span>`;
                html += `<span class="variety-summary">`;
                html += `<span class="count">${copies.length}件</span>`;
                html += `<span class="variety-expand-icon${openVariety ? ' open' : ''}" id="icon-${uid}">▼</span>`;
                html += `</span></div>`;
                html += `<div class="copy-list${openVariety ? ' open' : ''}" id="list-${uid}" data-acc-v="${vi}"${openVariety ? ' style="max-height:none;opacity:1;"' : ''}>`;
                // ★ 有品种但品种里没条目时（例如 japan 的 C/D/E 序列：品种名是真实资料，
                //   只是还没上图），仍然渲染出「啥都木有」这一行 —— 保证展开后**有内容**，
                //   否则同样会出现"三角形转了但不展开"。
                html += renderCopiesList(copies, data.detailFields, `${series.seriesName} - ${variety.varietyName}`, vi);
                html += `</div></div>`;
            }
        } else if (series.copies && series.copies.length > 0) {
            // ★ data-acc-permanent：无品种系列的条目列表没有对应的"品种头"可以再点开，
            //   所以它必须**永久展开**，不能让 closeAllAccordions() 收起来
            //   （否则系列体唯一的子元素高度为 0，系列体的 scrollHeight 也变成 0，
            //   表现为"三角形转了但什么都不展开"）。详见 core.js 的 closeAllAccordions()。
            html += `<div class="copy-list open" id="copies-${seriesId}" data-acc-series="${si}" data-acc-v="-1" data-acc-permanent="1" style="max-height:none;opacity:1;">`;
            html += renderCopiesList(series.copies, data.detailFields, series.seriesName, -1);
            html += `</div>`;
        }

        html += `</div></div>`;
    }

    html += `</div>`;
    app.innerHTML = html;

    // ★ 藏品列表图片是懒加载的，渲染完成后在后台补齐
    if (typeof schedulePrecacheCurrentView === 'function') schedulePrecacheCurrentView();
}

function renderCopiesList(copies, detailFields, displayName, accV) {
    if (!copies || copies.length === 0) {
        return '<div style="padding:8px;font-size:0.8rem;color:var(--text-secondary);">啥都木有</div>';
    }
    // ★ accV：本条列表属于哪个品种（无品种层时传 -1）。
    //   data-copy-index 是 **全局** 序号（openCopyDetail 需要它去 copyDetailList 取数据），
    //   data-copy-vindex 才是**品种内**序号 —— 深链接里的 cIdx 指的是后者。
    const vAttr = (accV === undefined || accV === null) ? '' : ` data-acc-v="${accV}"`;
    let html = '';
    let vIndex = 0;
    for (const c of copies) {
        const idx = copyDetailList.length;
        const curVIndex = vIndex++;
        copyDetailList.push({ copy: c, name: displayName || '', detailFields: detailFields || [] });

        const img1 = getImageUrl(c.img1);
        const img2 = getImageUrl(c.img2);
        const g1 = gridImg(c.img1);
        const g2 = gridImg(c.img2);
        const catalogNum = c.catalogNumber || c.krause || '';
        const catalogDisplay = formatCatalogNumber(catalogNum);

        html += `<div class="copy-item" data-copy-vindex="${curVIndex}"${vAttr}>`;
        html += `<div class="dual-thumb">`;
        if (img1) html += `<img class="copy-thumb" src="${escapeAttr(g1.src)}"${thumbFallbackAttr(g1.fallback)} loading="lazy" decoding="async" alt="O_o" onclick="event.stopPropagation(); openModal('${escapeAttr(img1)}', '${escapeAttr(img2 || img1)}')">`;
        if (img2) html += `<img class="copy-thumb" src="${escapeAttr(g2.src)}"${thumbFallbackAttr(g2.fallback)} loading="lazy" decoding="async" alt="o_O" onclick="event.stopPropagation(); openModal('${escapeAttr(img2)}', '${escapeAttr(img1 || img2)}')">`;
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

// hintEl：被点击的那个头部元素（onclick 里传 this）。
// ★ 就地解析目标节点（accordionTargetOf），不再按 id 全文档查找 ——
//   理由见 core.js 里 accordionTargetOf 的注释：容器复用时同 id 节点可能不止一个，
//   按 id 查有可能把图标和系列体解析到**不同**的节点上，表现就是"三角形转了但不展开"。
//   now 从被点元素本身出发按 DOM 结构就近取，图标与 body 必然来自同一行、同一批节点。
//
// ★ 末尾的 syncFocusAndRoute()：手风琴的开关也是"位置变化"，要让地址栏跟着走
//   （展开第 2 个系列 → #notes/rmb3/s2）。不这么做的话，地址栏会停留在进入分类时的
//   状态，用户此时复制链接得到的是错的。
function syncFocusAndRoute() {
    // animateAccordion 是同步加/去 open 类的，所以此刻 DOM 已是最终状态。
    if (typeof focusFromDom === 'function') focusFromDom();
    // syncRoute 内部只做 replaceState —— 不会新增历史记录（见 router.js 顶部说明）。
    if (typeof syncRoute === 'function') syncRoute();
}

function toggleSeries(id, hintEl) {
    const body = accordionTargetOf(hintEl, 'body-' + id, '.series-body');
    const icon = accordionTargetOf(hintEl, 'icon-' + id, '.series-expand-icon');
    if (!body) {
        // 真找不到才报错：能帮助定位"渲染用的 id"与"onclick 里的 id"不一致这类问题
        console.warn('[accordion] 找不到系列体:', 'body-' + id);
        return;
    }
    // 用精确高度过渡，避免固定 max-height 造成的"弹开后空跑"
    animateAccordion(body, !body.classList.contains('open'));
    if (icon) icon.classList.toggle('open');
    syncFocusAndRoute();
}

function toggleVariety(id, hintEl) {
    const list = accordionTargetOf(hintEl, 'list-' + id, '.copy-list');
    const icon = accordionTargetOf(hintEl, 'icon-' + id, '.variety-expand-icon');
    if (!list) {
        console.warn('[accordion] 找不到品种列表:', 'list-' + id);
        return;
    }
    animateAccordion(list, !list.classList.contains('open'));
    if (icon) icon.classList.toggle('open');
    syncFocusAndRoute();
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
let modalFlipBusy = false;     // 翻面动画进行中（防止连点叠加成闪烁）
let modalFlipTimer = null;
let currentModalSide = 1;      // 当前看的是哪一面：1 = 正面(img1)，2 = 反面(img2)
let modalFullReady = false;    // 原图是否已解码完成 —— 完成前禁止缩放/拖动

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
    // ★ 之前这里用 window.innerWidth/innerHeight，而 .modal-img 的盒子是 CSS 的 100vw/100dvh
    //   —— 两套坐标系在移动端并不相等（地址栏展开时 innerHeight 明显小于 dvh），
    //   会导致共享元素飞行动画的落点偏移。
    //   现在直接量 .modal-content 的实际盒子，让 JS 与 CSS 共用同一个来源，天然不会漂移。
    const box = document.querySelector('.modal-content')?.getBoundingClientRect();
    const vw = (box && box.width) || window.innerWidth;
    const vh = (box && box.height) || window.innerHeight;
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

// 当前这一面要显示的图（1 = 正面 img1，2 = 反面 img2）
function currentModalSrc() {
    return (currentModalSide === 2 && currentModalImg2) ? currentModalImg2 : currentModalImg1;
}

// 当前这一面的缩略图，用来在 #modalImg 背景上垫底。skip = true 时返回空：
// 调用方已确认"这张图就是屏幕上那张已加载完的图"，不需要垫底。
function currentModalBackdrop(skip) {
    if (skip) return '';
    const full = currentModalSrc();
    const t = getThumbUrl(full);
    return (t && t !== full) ? t : '';
}

function resetModalZoom() {
    const container = document.getElementById('imageContainer');
    if (container) container.style.transform = 'translate3d(0px, 0px, 0px) scale3d(1, 1, 1)';
    currentScale = 1; currentX = 0; currentY = 0;
    // 翻面浮层可能还残留着"收起"动画的 forwards 终态（压扁 + 半透明），
    // 这里连同动画类一起清掉，避免它挡住图片。
    clearModalFlipLayer();
}

// 清掉翻面浮层上的动画状态与图片。幂等，可随时调用。
// keepTransform 省略/false：连内联 transform、opacity 一起清（关闭弹窗时用）。
// keepTransform = true：只清"上一半动画"的残留（src / 动画类），
//   但保留当前内联 transform，好让下一半从同一个压扁状态接着展开。
function clearModalFlipLayer(keepTransform) {
    const overlay = document.getElementById('modalImgOverlay');
    if (!overlay) return;
    overlay.classList.remove('flip-out', 'flip-in');
    overlay.style.animation = 'none';
    if (!keepTransform) {
        overlay.style.transform = '';
        overlay.style.opacity = '';
    }
    // ★ 必须清 src：这个 <img> 带着 .modal-img-overlay 的动画类残留时
    //   如果还挂着上一张图，会在下次翻面／关闭时一闪而过。
    overlay.removeAttribute('src');
}

// 把「当前这一面」装进弹窗，返回本次加载的 token。
// ★ 主图直接请求原图，缩略图只当 #modalImg 自己的背景垫底：#modalImg 是
//   100vw/100vh + object-fit:contain，背景同样按 contain 铺在同一个盒子里，
//   两者完全同框同形、像素级对齐 —— 原图解码完成前看到的是同一张图的低清版
//   （不会空白），解码完成后原图不透明正好盖住背景，没有"先糊后清"的跳变。
// ★ 原图解码完成前**禁止缩放/拖动**（画面还只是低清垫底图）：用 modalFullReady
//   卡住 Hammer 与滚轮，并给弹窗挂 .modal-loading 把提示语换成"原图加载中…"。
// ★ opts.onReady：原图**解码就绪或彻底失败**时回调一次。翻面动画靠它决定
//   "什么时候展开新面" —— 用固定定时器会在慢网下展开出空白（见 modalFlip）。
function loadModalImage(opts) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    if (!modal || !modalImg) return 0;

    const full = currentModalSrc();
    if (!full) return 0;
    const token = ++modalLoadToken;
    const backdropUrl = currentModalBackdrop(!!(opts && opts.skipBackdrop));
    const onReady = (opts && typeof opts.onReady === 'function') ? opts.onReady : null;
    let readyFired = false;
    const fireReady = function () {
        if (readyFired) return;
        readyFired = true;
        if (onReady) onReady(token);
    };
    // 兜底：图加载不出来（数据里确实有"引用了但没上传"的图）也必须让翻面收尾，
    // 否则第二次点击永远不会到来，"正反切换"会卡死在压扁状态。
    let readyTimer = null;
    if (onReady) readyTimer = setTimeout(fireReady, 1200);

    modalFullReady = false;
    modal.classList.add('modal-loading');

    // 原图缺失时退到缩略图（数据里确实存在"引用了但图没上传"的图）
    modalImg.onerror = function () {
        modalImg.onerror = null;
        if (backdropUrl && modalImg.src !== backdropUrl) modalImg.src = backdropUrl;
        fireReady();   // 失败也要放行，让翻面动画能收尾
    };
    modalImg.onload = function () {
        if (token !== modalLoadToken) return;   // 已经翻到另一面了，丢弃这次结果
        modalFullReady = true;
        modal.classList.remove('modal-loading');
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
        fireReady();
    };
    modalImg.style.backgroundImage = backdropUrl ? 'url("' + backdropUrl + '")' : '';
    modalImg.style.backgroundSize = 'contain';
    modalImg.style.backgroundPosition = 'center';
    modalImg.style.backgroundRepeat = 'no-repeat';
    modalImg.src = full;
    // 命中缓存时 load 事件可能已经错过（complete 同步就是 true）
    if (modalImg.complete) {
        modalFullReady = true;
        modal.classList.remove('modal-loading');
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
        fireReady();
    }
    resetModalZoom();
    return token;
}

// 正反面切换（圆形 ‹ › 按钮 / 左右方向键）
//
// ★ 这是"把卡片翻过来"，所以做两半的压缩/展开动画（详见 layout.css 里
//   .modal-img-overlay 上方那段注释，说明了为什么用 scaleX 而不是 rotateY）。
// ★ 时序必须由图片**解码就绪**驱动，不能用固定定时器：新面没解码完就展开，
//   用户会看到半张空白，反而比不做动画更糟。
//
// ★ 这里**不动 lastModalSourceImg**（原来会置空，那正是"翻面后退出没有动画"
//   的根因：置空之后 closeModal 里"缩回缩略图"那条路径整段被跳过，只剩整体淡出）。
//   保持不动是有意的：它记的是**用户点进来时的那张缩略图**，
//   于是"生长出来 / 缩回去"始终是同一对端点，翻面不改变弹窗的来处。
//   代价：停在反面关闭时会缩回正面的缩略图。这是刻意取舍 ——
//   反面那张缩略图常常根本不在视口里（同一张图的正反面在网格里是两个格子），
//   强行指向它反而会被 closeModal 的 onScreen 判定拦下、退化成淡出，更不稳定。
const MODAL_FLIP_HALF_MS = 90;
function modalFlip(dir) {
    if (!currentModalImg2) return false;
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    if (!modal || !modalImg) return false;
    // 动画进行中不再受理：连点会把两半动画叠加成闪烁（键盘长按很容易触发）
    if (modalFlipBusy) return false;

    // 换到另一面。src 要等第一半动画结束时才真正替换（见下），
    // 所以这里只动"当前是哪一面"这个状态，让 currentModalSrc() 先指向新面。
    currentModalSide = (currentModalSide === 1) ? 2 : 1;

    if (prefersReducedMotion()) {
        loadModalImage({});
        return true;
    }

    const overlay = document.getElementById('modalImgOverlay');
    const fromSrc = modalImg.currentSrc || modalImg.src;

    const finishHalf = function () {
        // ★ 用"翻面动画还在不在进行"兜底，挡住重复调用；真正的归属判断在
        //   下面 onReady 里用 token 做（翻面自己会推进 token，不能拿旧值比）。
        if (!modalFlipBusy) return;
        modal.classList.remove('modal-flipping');
        clearModalFlipLayer(true);
        modalImg.classList.remove('flip-out', 'flip-in');
        // 保留"压扁"终态，好让下一半从同一个形状接着展开
        modalImg.style.animation = 'none';
        modalImg.style.transform = 'scale3d(0.06, 1, 1)';
        modalImg.style.opacity = '0.25';
        // ★ modalFlipBusy 必须一直保持到"第二半的画面就位"为止，不能在这里先清掉。
        //   loadModalImage 末尾有一条"命中缓存 ⇒ complete 同步为真 ⇒ 立刻
        //   fireReady()"的分支，它会在本函数还没返回时就把 onReady 叫起来；
        //   要是这里先清了 busy，onReady 里的兜底判断就会误判成"已经又翻了一次"
        //   而直接退出，flip-in 永远挂不上 —— 命中缓存的翻面会卡死在压扁态。
        // ★ token 必须在**调用之前**就占好并闭包捕获：onReady 有可能在
        //   loadModalImage 返回之前就被同步叫起来（就是上面那条分支），
        //   那时才去接返回值只会拿到 undefined / 抛 TDZ。
        //   loadModalImage 内部是 `++modalLoadToken`，所以预占的值就是它将要用的值。
        const flipToken = modalLoadToken + 1;
        loadModalImage({
            onReady: function (token) {
                // 弹窗已关 / 这已经是另一次加载了：作废，交给后来者
                if (!modalFlipBusy || token !== modalLoadToken) return;
                modalFlipBusy = false;
                modal.classList.remove('modal-flipping');
                modalImg.style.animation = '';
                modalImg.style.transform = '';
                modalImg.style.opacity = '';
                modalImg.classList.remove('flip-out', 'flip-in');
                void modalImg.offsetWidth;   // 让展开动画从"压扁"这一帧重新起算
                modalImg.classList.add('flip-in');
            }
        });
        if (flipToken !== modalLoadToken) {
            // loadModalImage 没能开始（缺图/元素丢失），别把"翻面中"永远留着
            modalFlipBusy = false;
            modal.classList.remove('modal-flipping');
            modalImg.style.animation = '';
            modalImg.style.transform = '';
            modalImg.style.opacity = '';
        }
    };

    modalFlipBusy = true;
    modal.classList.add('modal-flipping');
    // 新面在第一半动画期间后台解码（回到前半段结束时时通常已经好了）
    if (overlay) {
        overlay.src = fromSrc;
        overlay.classList.remove('flip-in');
        overlay.classList.add('flip-out');
    }
    modalImg.classList.remove('flip-in');
    modalImg.classList.add('flip-out');

    modalFlipTimer = setTimeout(finishHalf, MODAL_FLIP_HALF_MS + 40);
    return true;
}

function openModal(imgSrc1, imgSrc2) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    if (!modal || !modalImg || !imgSrc1) return;

    currentModalImg1 = imgSrc1;
    // 正反面是同一张时（文章配图、专题灯箱就是这么调用的）不显示翻面按钮
    currentModalImg2 = (imgSrc2 && imgSrc2 !== imgSrc1) ? imgSrc2 : '';
    currentModalSide = 1;
    imageModalOpen = true;
    modal.classList.toggle('multi-img', !!currentModalImg2);

    // 来源图必须就是这一张，否则不做生长动画（例如从别处调用 openModal）
    const sourceEl = lastModalSourceImg;
    const sourceSrc = (sourceEl && typeof sourceEl.getAttribute === 'function')
        ? sourceEl.getAttribute('src') : '';
    // 来源本身就是"要显示的原图"且已加载完（文章配图）：连垫底图都不用，
    // 顺带省掉一次注定 404 的缩略图请求（文章配图没有生成缩略图）
    const sourceIsFull = !!sourceEl && sourceEl.tagName === 'IMG' && sourceEl.complete === true &&
        (sourceEl.currentSrc || sourceSrc) === imgSrc1;
    const backdrop = currentModalBackdrop(sourceIsFull);
    const canFly = !prefersReducedMotion() && !!sourceEl && sourceEl.isConnected &&
        typeof sourceEl.getBoundingClientRect === 'function' &&
        // 来源可能挂在缩略图上，也可能直接是原图，两种都认
        (sourceSrc === imgSrc1 || (!!backdrop && sourceSrc === backdrop));

    cancelModalFlight();
    // 关键：带 forwards 的 .modal-hide 若残留，弹窗会一直不可见
    if (modalCloseTimer) { clearTimeout(modalCloseTimer); modalCloseTimer = null; }
    modal.classList.remove('modal-hide');

    const token = loadModalImage({ skipBackdrop: sourceIsFull });
    modalImg.style.opacity = canFly ? '0' : '';   // 飞行期间先藏着真图，落地后再显形
    modal.classList.add('modal-show');
    modal.style.display = 'flex';

    const scrollY = window.scrollY;
    document.body.classList.add('modal-open');
    document.body.style.top = `-${scrollY}px`;

    // Hammer / 滚轮只绑一次即可，具体是否响应由 modalFullReady 把关
    initPinchZoom();

    // ★ 预热「另一面」的原图。
    //   翻面的第二半要等新面**解码就绪**才展开（见 modalFlip）。不预热的话，
    //   用户第一次点翻面时那张原图才刚开始下载——这里的原图动辄 3700×2100，
    //   实测冷缓存下光下载就要 800ms 上下，再叠加解码就可能压过 1200ms 兜底，
    //   于是纸币会长时间卡在"压扁"状态，看着像卡死。
    //   打开时顺手取一次，等用户真去翻的时候就在 HTTP 缓存里了。
    //   放在弹窗显示之后：不跟正面那张抢首屏，也不影响生长动画。
    //   失败无所谓（数据里确实有"引用了但没上传"的图），忽略即可。
    if (currentModalImg2) {
        const pre = new Image();
        pre.decoding = 'async';
        pre.onerror = function () { this.onerror = null; };
        pre.src = currentModalImg2;
    }

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

    // ★ 翻面动画可能正跑到一半就点了关闭。先把"进行中"标记与定时器收掉，
    //   否则那个 90ms 的收尾回调会在弹窗关掉之后触发，
    //   把 modalFlipBusy 卡在 true —— 下次打开图片就再也翻不了面。
    //   （transform / 浮层的实际清理统一放在 finish() 里，避免两处各清一半。）
    //   同时推进 modalLoadToken：让在途的 loadModalImage 回调（含翻面第二半的
    //   收尾）整体作废，不会再往已经关掉的弹窗上写 transform。
    if (modalFlipTimer) { clearTimeout(modalFlipTimer); modalFlipTimer = null; }
    modalFlipBusy = false;
    modalLoadToken++;
    modal.classList.remove('modal-flipping');
    // ★ 必须在这里就把主图上的翻面动画摘干净。
    //   .modal-img.flip-in { animation: modalFlipIn 90ms … forwards } —— forwards 让
    //   动画结束后**永久保持终态**，而终态里含 opacity:1。
    //   CSS 动画的优先级**高于内联样式**，所以下面那行 modalImg.style.opacity = '0'
    //   会被 flip-in 的 opacity:1 完全压掉：缩回动画照常播，但一张**全尺寸的反面大图
    //   会原地静止不动**，直到 finish() 里 remove('flip-in') 才消失 —— 这就是
    //   "翻面后退出，缩回动画上多一张静止大图，动画结束才消失"的根因。
    //   摘掉动画的同时连内联 animation/transform 一起复位，避免下次打开第一眼是压扁的。
    const closingImg = document.getElementById('modalImg');
    if (closingImg) {
        closingImg.classList.remove('flip-out', 'flip-in');
        closingImg.style.animation = '';
        closingImg.style.transform = '';
    }

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
        modal.classList.remove('modal-show', 'modal-hide', 'modal-loading', 'multi-img', 'modal-flipping');
        imageModalOpen = false;
        modalFullReady = false;
        modalFlipBusy = false;
        if (modalFlipTimer) { clearTimeout(modalFlipTimer); modalFlipTimer = null; }
        clearModalFlipLayer();
        const img = document.getElementById('modalImg');
        if (img) {
            img.src = '';
            img.style.opacity = '';
            img.style.backgroundImage = '';
            // ★ 必须连翻面动画的残留一起清干净：内联 animation / transform
            //   会盖住 .modal-show 的进入动画、也会让下次打开第一眼是压扁的。
            img.style.animation = '';
            img.style.transform = '';
            img.classList.remove('flip-out', 'flip-in');
        }
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
    // ★ Hammer 走 CDN + defer；若被拦截/离线导致未加载，这里静默降级为"无捏合缩放"，
    //   而不是让 openModal 整条链路抛 ReferenceError（灯箱仍可看大图）。
    if (typeof Hammer === 'undefined') return;
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

    // ★ 以下手势一律要求 modalFullReady：原图还没解码完时画面只是低清垫底图，
    //   此时放大/拖动没有意义（而且拖的是那张垫底图，等原图盖上来位置就错位了）。
    hammerManager.on('pinchstart', function(e) {
        if (!modalFullReady) return;
        lastScale = currentScale; e.preventDefault();
    });
    hammerManager.on('pinchmove', function(e) {
        if (!modalFullReady) return;
        let newScale = lastScale * e.scale;
        newScale = Math.min(MODAL_MAX_SCALE, Math.max(1, newScale));
        currentScale = newScale;
        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        e.preventDefault();
    });
    hammerManager.on('pinchend', function(e) {
        if (!modalFullReady) return;
        clampTransform(); e.preventDefault();
    });
    hammerManager.on('panstart', function(e) {
        if (!modalFullReady) return;
        lastX = currentX; lastY = currentY;
    });
    hammerManager.on('panmove', function(e) {
        if (!modalFullReady) return;
        if (currentScale > 1) {
            currentX = lastX + e.deltaX;
            currentY = lastY + e.deltaY;
            container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        }
        e.preventDefault();
    });
    hammerManager.on('panend', function(e) {
        if (!modalFullReady) return;
        clampTransform();
    });

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
        if (!modalFullReady) return;              // 原图没解码完，先别缩
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
    const g1 = gridImg(copy.img1);
    const g2 = gridImg(copy.img2);
    if (img1 || img2) {
        html += `<div class="info-lightbox-imgs">`;
        if (img1) html += `<img src="${escapeAttr(g1.src)}"${thumbFallbackAttr(g1.fallback)} alt="" onclick="openModal('${escapeAttr(img1)}', '${escapeAttr(img2 || img1)}')">`;
        if (img2) html += `<img src="${escapeAttr(g2.src)}"${thumbFallbackAttr(g2.fallback)} alt="" onclick="openModal('${escapeAttr(img2)}', '${escapeAttr(img1 || img2)}')">`;
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