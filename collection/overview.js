// ==================== overview.js ====================

function renderOverview() {
    const app = getRenderContainer();
    currentView = VIEW.OVERVIEW;

    let allItems = [];
    let globalIndex = 1;
    const tree = getCategoryTree();

    for (const cat of tree) {
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
        } else if (cat.dataKey) {
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

    const modeLabel = currentMode === MODE.NOTES ? '纸币' : '硬币';
    let html = `<div class="overview-header"><h2>全部${modeLabel}</h2><p>共${allItems.length}件藏品</p></div>`;
    if (allItems.length === 0) {
        html += '<div class="empty-state">啥都木有</div>';
        app.innerHTML = html;
        return;
    }

    const grouped = {};
    for (const item of allItems) {
        if (!grouped[item.catLabel]) grouped[item.catLabel] = [];
        grouped[item.catLabel].push(item);
    }

    for (const cat of tree) {
        if (cat.children && cat.children.length > 0) {
            for (const sub of cat.children) {
                const label = cat.name + ' - ' + sub.name;
                if (!grouped[label]) continue;
                html += renderOverviewGroup(label, grouped[label]);
            }
        } else if (cat.name) {
            if (!grouped[cat.name]) continue;
            html += renderOverviewGroup(cat.name, grouped[cat.name]);
        }
    }

    app.innerHTML = html;

    // ★ 概览页图片是懒加载的，渲染完成后在后台补齐，保证「没滚到的图」也能离线看
    if (typeof schedulePrecacheCurrentView === 'function') schedulePrecacheCurrentView();
}

function renderOverviewGroup(label, items) {
    let html = `<div class="search-result-group">`;
    html += `<div class="search-group-header">${escapeHtml(label)} <span class="count">${items.length}件</span></div>`;
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
        if (img1) html += `<img class="mini-thumb" src="${escapeAttr(g1.src)}"${thumbFallbackAttr(g1.fallback)} loading="lazy" decoding="async" alt="O_o" onclick="event.stopPropagation(); openModal('${escapeAttr(img1)}', '${escapeAttr(img2 || img1)}')">`;
        if (img2) html += `<img class="mini-thumb" src="${escapeAttr(g2.src)}"${thumbFallbackAttr(g2.fallback)} loading="lazy" decoding="async" alt="o_O" onclick="event.stopPropagation(); openModal('${escapeAttr(img2)}', '${escapeAttr(img1 || img2)}')">`;
        if (!img1 && !img2) html += `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;">图片它不见力(╯︵╰,)</div>`;
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
    return html;
}

function navigateFromOverview(dataKey, si, vi, ci, hasVarieties) {
    const tree = getCategoryTree();

    let foundCat = null;
    let foundSub = null;

    for (const cat of tree) {
        if (cat.children && cat.children.length > 0) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) {
                    foundCat = cat;
                    foundSub = sub;
                    break;
                }
            }
            if (foundCat) break;
        } else if (cat.dataKey === dataKey) {
            foundCat = cat;
            foundSub = null;
            break;
        }
    }

    if (!foundCat) return;

    // 设置新状态
    currentCategoryId = foundCat.id;
    currentSubId = foundSub ? foundSub.id : null;
    currentView = VIEW.CATEGORY;

    // 彻底清理：移除所有现有滚动容器的 display:block 并清空内容
    const allKeys = Object.keys(viewScrollContainers);
    for (const k of allKeys) {
        const container = viewScrollContainers[k];
        container.style.display = 'none';
        container.innerHTML = '';
    }
    const appEl = document.getElementById('app');
    if (appEl) {
        appEl.style.display = 'none';
        appEl.innerHTML = '';
    }

    // ★ 登记"待展开条目"：必须在 renderCurrentCategory() **之前**，
    //   renderSeriesList() 会消费它并直接生成已展开的标记。
    //   原来只靠下面的 setTimeout 去补开，一条异步链上任何一环落空就静默失败
    //   （用户报的"概览跳转点不开"）。
    pendingReveal = {
        catId: String(currentSubId || currentCategoryId || ''),
        sIdx: si,
        vIdx: (hasVarieties && vi !== null && vi !== undefined && vi !== 'null') ? vi : null,
        cIdx: (ci === null || ci === undefined) ? null : ci
    };

    // 切换到目标容器并渲染
    switchToCurrentContainer();
    renderSidebar();
    renderCurrentCategory();

    // ★ 把"当前所在位置"同步进地址栏。
    //   navigateToCopy()（搜索结果跳转）一直有这一步，概览跳转却漏了，
    //   于是从概览点进分类后地址栏还停留在旧位置，深链接不可分享。
    //   syncRoute 内部只做 replaceState，不会新增历史记录。
    if (typeof syncRoute === 'function') syncRoute();

    // 展开并滚动到目标条目。
    // ★ 改为复用 router.js 的 revealCopyInCategory()，不再自己拼 DOM id：
    //   原实现用 `series-${si}` / `v-${si}-${vi}`（无分类作用域）配合
    //   document.getElementById，会命中隐藏容器里其它分类的同序号节点（审查报告 B7）。
    //   顺带把"只展开不折叠其它"改成"先折叠其它再展开目标"，避免深链接打开时
    //   一堆系列同时播放展开动画。
    setTimeout(() => {
        closeAllAccordions();
        revealCopyInCategory({
            sIdx: si,
            vIdx: (hasVarieties && vi !== null && vi !== undefined && vi !== 'null') ? vi : null,
            cIdx: null
        });
    }, 50);
}
