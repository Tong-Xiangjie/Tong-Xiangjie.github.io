// ==================== overview.js ====================

function renderOverview() {
    const app = getRenderContainer();
    currentView = VIEW.OVERVIEW;

    let allItems = [];
    let globalIndex = 1;
    const tree = getCategoryTree();
    const imgBase = getImageBase();

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
}

function renderOverviewGroup(label, items) {
    const imgBase = getImageBase();
    let html = `<div class="search-result-group">`;
    html += `<div class="search-group-header">${escapeHtml(label)} <span class="count">${items.length}件</span></div>`;
    for (const item of items) {
        const c = item.copy;
        const img1 = c.img1 ? imgBase + c.img1 : '';
        const img2 = c.img2 ? imgBase + c.img2 : '';
        const displayName = item.hasVarieties && item.variety
            ? `${item.series.seriesName} - ${item.variety.varietyName}`
            : item.series.seriesName;

        const catalogNum = c.catalogNumber || c.krause || '';
        const catalogDisplay = catalogNum ? (catalogNum.startsWith('Pick#') ? catalogNum : (catalogNum.startsWith('SUN#') ? catalogNum : 'Pick# ' + catalogNum)) : '';

        html += `<div class="search-result-item" onclick="navigateFromOverview('${item.dataKey}', ${item.si}, ${item.hasVarieties ? item.vi : 'null'}, ${item.ci}, ${item.hasVarieties})">`;
        html += `<div class="dual-thumb">`;
        if (img1) html += `<img class="mini-thumb" src="${img1}" alt="O_o" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
        if (img2) html += `<img class="mini-thumb" src="${img2}" alt="o_O" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
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

    // 先在纸币/硬币树中找到匹配的分类
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
        } else if (cat.dataKey === dataKey) {
            foundCat = cat;
            foundSub = null;
            break;
        }
        if (foundCat) break;
    }

    if (!foundCat) return;

    // 保存概览页滚动位置
    const overviewKey = getContainerKey();
    const overviewContainer = getRenderContainer();
    if (overviewContainer) {
        scrollMemory[currentMode + '-' + overviewKey] = overviewContainer.scrollTop;
    }

    // 设置新状态
    currentCategoryId = foundCat.id;
    currentSubId = foundSub ? foundSub.id : null;
    currentView = VIEW.CATEGORY;

    // 切换容器并渲染
    switchToCurrentContainer();
    renderSidebar();
    renderCurrentCategory();

    // 展开并滚动到目标条目
    setTimeout(() => {
        const seriesId = `series-${si}`;
        const seriesEl = document.querySelector(`#body-${seriesId}, #${seriesId}`);
        toggleSeries(seriesId);

        if (hasVarieties && vi !== null && vi !== undefined && vi !== 'null') {
            setTimeout(() => {
                toggleVariety(`v-${si}-${vi}`);
                setTimeout(() => {
                    const el = document.getElementById('list-v-' + si + '-' + vi);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }, 50);
        } else {
            setTimeout(() => {
                const el = document.getElementById('copies-' + seriesId);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }, 50);
}
