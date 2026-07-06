// ==================== stats.js ====================
// 统计与导出

function collectAllCopies() {
    const allCopies = [];

    if (window.DATA_MAP) {
        for (const dataKey of allDataKeys) {
            const data = window.DATA_MAP[dataKey];
            if (!data || !data.series) continue;
            for (let si = 0; si < data.series.length; si++) {
                const series = data.series[si];
                if (series.varieties) {
                    for (let vi = 0; vi < series.varieties.length; vi++) {
                        const variety = series.varieties[vi];
                        if (!variety.copies) continue;
                        for (let ci = 0; ci < variety.copies.length; ci++) {
                            allCopies.push({
                                copy: variety.copies[ci],
                                seriesName: series.seriesName + ' - ' + variety.varietyName,
                                type: 'notes',
                                dataKey
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allCopies.push({
                            copy: series.copies[ci],
                            seriesName: series.seriesName,
                            type: 'notes',
                            dataKey
                        });
                    }
                }
            }
        }
    }

    if (window.COIN_DATA_MAP) {
        for (const dataKey of coinAllDataKeys) {
            const data = window.COIN_DATA_MAP[dataKey];
            if (!data || !data.series) continue;
            for (let si = 0; si < data.series.length; si++) {
                const series = data.series[si];
                if (series.varieties) {
                    for (let vi = 0; vi < series.varieties.length; vi++) {
                        const variety = series.varieties[vi];
                        if (!variety.copies) continue;
                        for (let ci = 0; ci < variety.copies.length; ci++) {
                            allCopies.push({
                                copy: variety.copies[ci],
                                seriesName: series.seriesName + ' - ' + variety.varietyName,
                                type: 'coins',
                                dataKey
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allCopies.push({
                            copy: series.copies[ci],
                            seriesName: series.seriesName,
                            type: 'coins',
                            dataKey
                        });
                    }
                }
            }
        }
    }

    return allCopies;
}

function computeStats(typeFilter) {
    const allCopies = collectAllCopies();

    let filtered = allCopies;
    if (typeFilter === 'notes') {
        filtered = allCopies.filter(c => c.type === 'notes');
    } else if (typeFilter === 'coins') {
        filtered = allCopies.filter(c => c.type === 'coins');
    }

    const total = filtered.length;

    let notesCount = 0, coinsCount = 0;
    if (window.DATA_MAP) {
        for (const key of allDataKeys) {
            const d = window.DATA_MAP[key];
            if (d && d.series) {
                for (const s of d.series) {
                    if (s.varieties) for (const v of s.varieties) notesCount += (v.copies ? v.copies.length : 0);
                    else if (s.copies) notesCount += s.copies.length;
                }
            }
        }
    }
    if (window.COIN_DATA_MAP) {
        for (const key of coinAllDataKeys) {
            const d = window.COIN_DATA_MAP[key];
            if (d && d.series) {
                for (const s of d.series) {
                    if (s.varieties) for (const v of s.varieties) coinsCount += (v.copies ? v.copies.length : 0);
                    else if (s.copies) coinsCount += s.copies.length;
                }
            }
        }
    }

    let prices = [];
    for (const item of filtered) {
        const ps = item.copy.price;
        if (ps) {
            const num = parseFloat(String(ps).replace(/[^0-9.]/g, ''));
            if (!isNaN(num) && num > 0) {
                prices.push({ value: num, name: item.seriesName, version: item.copy.version || '', dataKey: item.dataKey, type: item.type });
            } else {
                prices.push({ value: -1, name: item.seriesName, version: item.copy.version || '', noPrice: true, dataKey: item.dataKey, type: item.type });
            }
        } else {
            prices.push({ value: -1, name: item.seriesName, version: item.copy.version || '', noPrice: true, dataKey: item.dataKey, type: item.type });
        }
    }
    const totalPrice = prices.reduce((s, p) => s + (p.noPrice ? 0 : p.value), 0);
    const pricedItems = prices.filter(p => !p.noPrice);
    const avgPrice = pricedItems.length > 0 ? Math.round(totalPrice / pricedItems.length) : 0;

    const gradeCounts = {};
    let ungraded = 0;
    for (const item of filtered) {
        const cond = item.copy.condition || item.copy.grade || '';

        if (cond.includes('真品')) {
            gradeCounts['真品'] = (gradeCounts['真品'] || 0) + 1;
            continue;
        }

        const match = cond.match(/(\d+)\+?(E)?/);
        if (match) {
            const displayGrade = match[1] + (match[2] || '');
            gradeCounts[displayGrade] = (gradeCounts[displayGrade] || 0) + 1;
        } else {
            ungraded++;
        }
    }
    const sortedGrades = Object.entries(gradeCounts).sort((a, b) => {
        const aVal = a[0] === '真品' ? -1 : parseFloat(a[0].replace('E', '.5'));
        const bVal = b[0] === '真品' ? -1 : parseFloat(b[0].replace('E', '.5'));
        return bVal - aVal;
    });

    const yearCounts = {};
    for (const item of filtered) {
        const y = item.copy.year;
        if (y && typeof y === 'number') {
            const decade = Math.floor(y / 10) * 10;
            const key = decade + 's';
            yearCounts[key] = (yearCounts[key] || 0) + 1;
        }
    }
    const sortedYears = Object.entries(yearCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    return { total, notesCount, coinsCount, prices, totalPrice, avgPrice, sortedGrades, ungraded, sortedYears };
}

function buildPriceFilterCategories() {
    const cats = [];
    if (window.DATA_MAP) {
        for (const cat of categoryTree) {
            if (cat.children) {
                for (const sub of cat.children) {
                    const data = window.DATA_MAP[sub.dataKey];
                    if (data && data.series && data.series.length > 0) {
                        cats.push({ id: 'notes_' + sub.id, name: '纸币 - ' + sub.name, dataKey: sub.dataKey, source: 'notes' });
                    }
                }
            } else if (cat.dataKey) {
                const data = window.DATA_MAP[cat.dataKey];
                if (data && data.series && data.series.length > 0) {
                    cats.push({ id: 'notes_' + cat.id, name: '纸币 - ' + cat.name, dataKey: cat.dataKey, source: 'notes' });
                }
            }
        }
    }
    if (window.COIN_DATA_MAP) {
        for (const cat of coinCategoryTree) {
            const data = window.COIN_DATA_MAP[cat.dataKey];
            if (data && data.series && data.series.length > 0) {
                cats.push({ id: 'coins_' + cat.id, name: '硬币 - ' + cat.name, dataKey: cat.dataKey, source: 'coins' });
            }
        }
    }
    return cats;
}

function buildCategoryOrder() {
    const order = {};
    let index = 0;

    if (window.DATA_MAP) {
        for (const cat of categoryTree) {
            if (cat.children) {
                for (const sub of cat.children) {
                    if (window.DATA_MAP[sub.dataKey]) {
                        order[sub.dataKey] = index++;
                    }
                }
            } else if (cat.dataKey) {
                if (window.DATA_MAP[cat.dataKey]) {
                    order[cat.dataKey] = index++;
                }
            }
        }
    }

    if (window.COIN_DATA_MAP) {
        for (const cat of coinCategoryTree) {
            if (window.COIN_DATA_MAP[cat.dataKey]) {
                order[cat.dataKey] = index++;
            }
        }
    }

    return order;
}

function renderPriceListItems(prices, order, filter, filterInfo) {
    let filteredPrices = prices;
    if (filter && filter !== 'all' && filterInfo) {
        const data = getDataBySource(filterInfo.dataKey, filterInfo.source);
        if (data && data.series) {
            const allowedNames = [];
            for (const series of data.series) {
                if (series.varieties) {
                    for (const v of series.varieties) {
                        if (v.copies) {
                            for (const c of v.copies) {
                                allowedNames.push(series.seriesName + ' - ' + v.varietyName);
                            }
                        }
                    }
                } else if (series.copies) {
                    for (const c of series.copies) {
                        allowedNames.push(series.seriesName);
                    }
                }
            }
            filteredPrices = prices.filter(p => allowedNames.includes(p.name));
        }
    }

    let sorted;
    if (order === 'default') {
        sorted = [...filteredPrices];
    } else {
        sorted = [...filteredPrices].sort((a, b) => {
            if (order === 'desc') return b.value - a.value;
            else return a.value - b.value;
        });
    }

    let html = '';
    for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        const displayPrice = p.noPrice ? '-' : p.value + ' 元';
        const nameHtml = escapeHtml(p.name);
        const versionHtml = p.version ? escapeHtml(p.version) : '';
        html += `<div class="price-list-item">`;
        html += `<span class="price-list-index">${i + 1}</span>`;
        html += `<span class="price-list-name">${nameHtml}${versionHtml ? ' (' + versionHtml + ')' : ''}</span>`;
        html += `<span class="price-list-value ${p.noPrice ? 'no-price' : ''}">${displayPrice}</span>`;
        html += `</div>`;
    }
    if (sorted.length === 0) {
        html += `<div class="price-list-empty">啊呜，这里空空如也υ´• ﻌ •\`υ</div>`;
    }
    return html;
}

function onPriceSortOrFilterChange() {
    const sortSelect = document.getElementById('priceSortSelect');
    const filterSelect = document.getElementById('priceFilterSelect');
    const summaryEl = document.getElementById('priceListSummary');
    const bodyEl = document.getElementById('priceListBody');
    if (!sortSelect || !filterSelect || !bodyEl) return;

    const order = sortSelect.value;
    const filter = filterSelect.value;
    const stats = computeStats();

    let filterInfo = null;
    let filteredPrices = stats.prices;

    if (filter && filter !== 'all') {
        const filterCats = buildPriceFilterCategories();
        const matchedCat = filterCats.find(c => c.id === filter);
        if (matchedCat) {
            filterInfo = { dataKey: matchedCat.dataKey, source: matchedCat.source };
            const data = getDataBySource(matchedCat.dataKey, matchedCat.source);
            if (data && data.series) {
                const allowedNames = [];
                for (const series of data.series) {
                    if (series.varieties) {
                        for (const v of series.varieties) {
                            if (v.copies) {
                                for (const c of v.copies) {
                                    allowedNames.push(series.seriesName + ' - ' + v.varietyName);
                                }
                            }
                        }
                    } else if (series.copies) {
                        for (const c of series.copies) {
                            allowedNames.push(series.seriesName);
                        }
                    }
                }
                filteredPrices = stats.prices.filter(p => allowedNames.includes(p.name));
            }
        }
    }

    if (summaryEl) {
        if (filterInfo) {
            const total = filteredPrices.reduce((s, p) => s + (p.noPrice ? 0 : p.value), 0);
            const pricedItems = filteredPrices.filter(p => !p.noPrice);
            const avg = pricedItems.length > 0 ? Math.round(total / pricedItems.length) : 0;
            summaryEl.style.display = 'block';
            summaryEl.innerHTML = `<div class="price-list-summary-row"><span>该板块总投入</span><span>${total.toFixed(0)}元</span></div><div class="price-list-summary-row"><span>该板块藏品均价</span><span>${avg}元/件</span></div>`;
        } else {
            summaryEl.style.display = 'none';
        }
    }

    bodyEl.innerHTML = renderPriceListItems(stats.prices, order, filter, filterInfo);
}

function changePriceSort(order) {
    const sortSelect = document.getElementById('priceSortSelect');
    if (sortSelect) sortSelect.value = order;
    onPriceSortOrFilterChange();
}

function switchRatingMode(mode) {
    ratingMode = mode;
    const stats = computeStats(ratingMode);

    document.querySelectorAll('.rating-tab').forEach(el => {
        el.classList.toggle('active', el.dataset.mode === mode);
    });

    const gradeSection = document.getElementById('ratingSection');
    if (gradeSection) {
        gradeSection.style.opacity = '0';
        gradeSection.style.transform = 'translateY(8px)';
        setTimeout(() => {
            gradeSection.innerHTML = buildRatingHTML(stats);
            gradeSection.style.opacity = '1';
            gradeSection.style.transform = 'translateY(0)';
        }, 100);
    }

    const yearSection = document.getElementById('yearSection');
    if (yearSection) {
        yearSection.style.opacity = '0';
        yearSection.style.transform = 'translateY(8px)';
        setTimeout(() => {
            yearSection.innerHTML = buildYearHTML(stats);
            yearSection.style.opacity = '1';
            yearSection.style.transform = 'translateY(0)';
        }, 100);
    }
}

function buildRatingHTML(stats) {
    const maxGradeCount = stats.sortedGrades.length > 0
        ? Math.max(...stats.sortedGrades.map(g => g[1]), stats.ungraded)
        : 1;
    let html = `<div class="stats-bars">`;
    for (const [grade, count] of stats.sortedGrades) {
        const pct = (count / maxGradeCount * 100).toFixed(0);
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">${grade}</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${count}件</span>`;
        html += `</div>`;
    }
    if (stats.ungraded > 0) {
        const pct = (stats.ungraded / maxGradeCount * 100).toFixed(0);
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">未评级</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill ungraded" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${stats.ungraded}件</span>`;
        html += `</div>`;
    }
    if (stats.sortedGrades.length === 0 && stats.ungraded === 0) {
        html += `<div class="empty-colors-hint">还没有评级数据鸭～</div>`;
    }
    html += `</div>`;
    return html;
}

function buildYearHTML(stats) {
    const maxYearCount = stats.sortedYears.length > 0
        ? Math.max(...stats.sortedYears.map(y => y[1]))
        : 1;
    let html = `<div class="stats-bars">`;
    for (const [decade, count] of stats.sortedYears) {
        const pct = (count / maxYearCount * 100).toFixed(0);
        const label = decade.slice(0, -1) + 's';
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">${label}</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${count} 件</span>`;
        html += `</div>`;
    }
    if (stats.sortedYears.length === 0) {
        html += `<div class="empty-colors-hint">还没有年代数据鸭～</div>`;
    }
    html += `</div>`;
    return html;
}

// ==================== 数据导出 ====================

function exportJSON() {
    const allCopies = collectAllCopies();
    const stats = computeStats();
    const exportData = {
        exportDate: new Date().toISOString().split('T')[0],
        totalCount: allCopies.length,
        totalPrice: stats.totalPrice,
        items: allCopies.map(item => ({
            type: item.type === 'notes' ? '纸币' : '硬币',
            dataKey: item.dataKey,
            seriesName: item.seriesName,
            version: item.copy.version || '',
            year: item.copy.year || '',
            grade: item.copy.condition || item.copy.grade || '',
            gradingCompany: item.copy.gradingCompany || '',
            catalogNumber: item.copy.catalogNumber || item.copy.krause || '',
            price: item.copy.price || '',
            purchaseDate: item.copy.purchaseDate || '',
            material: item.copy.material || '',
            remark: item.copy.remark || ''
        }))
    };
    const dateStr = new Date().toISOString().split('T')[0];
    downloadFile(JSON.stringify(exportData, null, 2), `铜の币纪 | 藏品数据备份文件 | 导出日期${dateStr}.json`, 'application/json');
}

function exportCSV() {
    const allCopies = collectAllCopies();
    const headers = ['类型', '分类', '系列', '冠字号', '年份', '评级得分', '评级机构', '目录编号', '购入价格', '购买日期', '材质', '备注'];
    let csv = '\uFEFF' + headers.join(',') + '\n';
    for (const item of allCopies) {
        const c = item.copy;
        let catLabel = item.dataKey;
        if (item.type === 'notes') {
            for (const cat of categoryTree) {
                if (cat.children) { for (const sub of cat.children) { if (sub.dataKey === item.dataKey) catLabel = cat.name + ' - ' + sub.name; } }
                else if (cat.dataKey === item.dataKey) catLabel = cat.name;
            }
        } else {
            for (const cat of coinCategoryTree) { if (cat.dataKey === item.dataKey) catLabel = cat.name; }
        }
        const row = [
            item.type === 'notes' ? '纸币' : '硬币', catLabel, item.seriesName,
            c.version || '', c.year || '', c.condition || c.grade || '',
            c.gradingCompany || '', c.catalogNumber || c.krause || '',
            c.price || '', c.purchaseDate || '', c.material || '', c.remark || ''
        ].map(v => '"' + String(v).replace(/\\"/g, '""') + '"');
        csv += row.join(',') + '\n';
    }
    const dateStr = new Date().toISOString().split('T')[0];
    downloadFile(csv, `铜の币纪 | 收藏品详细信息表格 | 导出日期${dateStr}.csv`, 'text/csv;charset=utf-8');
}

function exportMarkdown() {
    const allCopies = collectAllCopies();
    const stats = computeStats();
    let md = '# 收藏报告\n\n导出日期：' + new Date().toISOString().split('T')[0] + '\n\n';
    md += '## 总览\n\n- 藏品总数：' + allCopies.length + ' 件\n';
    md += '- 纸币：' + stats.notesCount + ' 件 | 硬币：' + stats.coinsCount + ' 件\n';
    md += '- 已记录价格：' + stats.prices.filter(p => !p.noPrice).length + ' 件\n';
    md += '- 总投入：' + stats.totalPrice.toFixed(0) + ' 元\n\n';
    const groups = {};
    for (const item of allCopies) {
        let catLabel = item.dataKey;
        if (item.type === 'notes') {
            for (const cat of categoryTree) {
                if (cat.children) { for (const sub of cat.children) { if (sub.dataKey === item.dataKey) catLabel = cat.name + ' - ' + sub.name; } }
                else if (cat.dataKey === item.dataKey) catLabel = cat.name;
            }
        } else {
            for (const cat of coinCategoryTree) { if (cat.dataKey === item.dataKey) catLabel = cat.name; }
        }
        if (!groups[catLabel]) groups[catLabel] = [];
        groups[catLabel].push(item);
    }
    md += '## 按分类统计\n\n';
    for (const [label, items] of Object.entries(groups)) {
        md += '### ' + label + '\n\n- 数量：' + items.length + ' 件\n';
        const total = items.reduce((s, i) => s + (parseFloat(i.copy.price) || 0), 0);
        if (total > 0) md += '- 小计：' + total.toFixed(0) + ' 元\n';
        md += '\n';
    }
    const dateStr = new Date().toISOString().split('T')[0];
    downloadFile(md, `铜の币纪 | 收藏品概况报告 | 导出日期${dateStr}.md`, 'text/markdown;charset=utf-8');
}

function exportPriceList() {
    const stats = computeStats();
    const sorted = stats.prices.map((p, i) => ({ ...p, idx: i + 1 }))
        .sort((a, b) => (b.noPrice ? 0 : b.value) - (a.noPrice ? 0 : a.value));
    let text = '价格清单（从高到低）\n导出日期：' + new Date().toISOString().split('T')[0] + '\n\n';
    for (const p of sorted) {
        text += p.idx + '. ' + p.name + (p.version ? ' (' + p.version + ')' : '') + ' - ' + (p.noPrice ? '-' : p.value + ' 元') + '\n';
    }
    text += '\n合计：' + stats.totalPrice.toFixed(0) + ' 元 | 均价：' + stats.avgPrice + ' 元/件\n';
    const dateStr = new Date().toISOString().split('T')[0];
    downloadFile(text, `铜の币纪 | 价格列表 | 导出日期${dateStr}.txt`, 'text/plain;charset=utf-8');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
