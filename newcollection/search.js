// ========== 搜索状态 ==========
let currentSearchKeyword = '';
let currentSearchType = 'all';

// ========== 搜索主函数 ==========
function doSearch() {
    const input = document.getElementById('searchInput');
    const typeSelect = document.getElementById('searchType');
    if (!input) return;

    const rawKeyword = input.value;
    const type = typeSelect ? typeSelect.value : 'all';

    // 保存滚动位置
    saveScroll(currentView === 'overview' ? 'overview' : 'category');

    currentSearchKeyword = rawKeyword;
    currentSearchType = type;
    currentView = 'search';

    performSearchAndRender(rawKeyword, type);
}

// ========== 执行搜索 ==========
function performSearchAndRender(rawKeyword, type) {
    const keyword = getActualKeyword(rawKeyword, type);
    const isEmptySearch = !keyword || keyword === '';
    const lowerKeyword = isEmptySearch ? '' : keyword.toLowerCase();
    let results = [];

    for (const dataKey of allDataKeys) {
        const data = getData(dataKey);
        if (!data || !data.series) continue;

        // 找到对应的分类信息
        let catName = dataKey;
        let parentName = '';
        for (const cat of categoryTree) {
            if (cat.dataKey === dataKey) {
                catName = cat.name;
                break;
            }
            if (cat.children) {
                for (const sub of cat.children) {
                    if (sub.dataKey === dataKey) {
                        catName = sub.name;
                        parentName = cat.name;
                        break;
                    }
                }
            }
        }

        for (let si = 0; si < data.series.length; si++) {
            const series = data.series[si];

            if (series.varieties && series.varieties.length > 0) {
                for (let vi = 0; vi < series.varieties.length; vi++) {
                    const variety = series.varieties[vi];
                    if (!variety.copies) continue;
                    for (let ci = 0; ci < variety.copies.length; ci++) {
                        const copy = variety.copies[ci];
                        if (matchCopy(copy, series, variety, lowerKeyword, type, isEmptySearch)) {
                            results.push({
                                dataKey, catName, parentName,
                                sIdx: si, vIdx: vi, cIdx: ci,
                                series, variety, copy,
                                hasVarieties: true
                            });
                        }
                    }
                }
            } else if (series.copies) {
                for (let ci = 0; ci < series.copies.length; ci++) {
                    const copy = series.copies[ci];
                    if (matchCopyFlat(copy, series, lowerKeyword, type, isEmptySearch)) {
                        results.push({
                            dataKey, catName, parentName,
                            sIdx: si, cIdx: ci,
                            series, copy,
                            hasVarieties: false
                        });
                    }
                }
            }
        }
    }

    renderSearchResults(results, rawKeyword, type);
}

function matchCopy(copy, series, variety, keyword, type, isEmpty) {
    if (isEmpty) return true;
    switch(type) {
        case 'all':
            const text = `${series.seriesName} ${variety.varietyName} ${copy.version || ''} ${copy.year} ${copy.condition || ''} ${copy.krause || ''}`.toLowerCase();
            return text.includes(keyword);
        case 'name':
            return series.seriesName.toLowerCase().includes(keyword) || variety.varietyName.toLowerCase().includes(keyword);
        case 'version':
            return (copy.version || '').toLowerCase().includes(keyword);
        case 'year':
            return String(copy.year).toLowerCase().includes(keyword);
        case 'agency':
            return (copy.condition || '').toLowerCase().includes(keyword);
        case 'krause':
            return (copy.krause || '').toLowerCase().includes(keyword);
    }
    return false;
}

function matchCopyFlat(copy, series, keyword, type, isEmpty) {
    if (isEmpty) return true;
    switch(type) {
        case 'all':
            const text = `${series.seriesName} ${copy.version || ''} ${copy.year} ${copy.condition || ''} ${copy.krause || ''}`.toLowerCase();
            return text.includes(keyword);
        case 'name':
            return series.seriesName.toLowerCase().includes(keyword);
        case 'version':
            return (copy.version || '').toLowerCase().includes(keyword);
        case 'year':
            return String(copy.year).toLowerCase().includes(keyword);
        case 'agency':
            return (copy.condition || '').toLowerCase().includes(keyword);
        case 'krause':
            return (copy.krause || '').toLowerCase().includes(keyword);
    }
    return false;
}

function getActualKeyword(inputValue, searchType) {
    if (searchType === 'krause') {
        if (inputValue.startsWith(KRAUSE_PREFIX)) {
            return inputValue.substring(KRAUSE_PREFIX.length).trim();
        }
        return inputValue.trim();
    }
    return inputValue.trim();
}

function getDisplayValue(keyword, searchType) {
    if (searchType === 'krause') {
        if (!keyword || keyword === '') return KRAUSE_PREFIX;
        if (!keyword.startsWith(KRAUSE_PREFIX)) return KRAUSE_PREFIX + keyword;
    }
    return keyword || '';
}

// ========== 渲染搜索结果 ==========
function renderSearchResults(results, rawKeyword, type) {
    const app = document.getElementById('app');
    const displayValue = getDisplayValue(rawKeyword, type);

    let html = `<div class="back-bar"><button class="back-btn" onclick="backFromSearch()">← 返回</button></div>`;
    html += `<div class="panel-header"><h2>搜索结果</h2>`;
    html += `<p>找到 ${results.length} 个匹配`;
    if (rawKeyword) html += ` · 关键词：${escapeHtml(getActualKeyword(rawKeyword, type))}`;
    html += `</p></div>`;

    if (results.length === 0) {
        html += `<div class="empty-state">暂无匹配结果</div>`;
        app.innerHTML = html;
        return;
    }

    // 按分类分组
    const grouped = {};
    for (const item of results) {
        const key = item.dataKey;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
    }

    let idx = 1;
    for (const dataKey of allDataKeys) {
        const group = grouped[dataKey];
        if (!group || group.length === 0) continue;
        const first = group[0];
        const label = first.parentName ? `${first.parentName} - ${first.catName}` : first.catName;

        html += `<div class="search-result-group">`;
        html += `<div class="search-group-header">${escapeHtml(label)} <span class="count">${group.length}张</span></div>`;

        for (const item of group) {
            const copy = item.copy;
            const imgSrc = copy.img1 ? IMAGE_BASE + copy.img1 : '';
            const displayName = item.hasVarieties
                ? `${item.series.seriesName} - ${item.variety.varietyName}`
                : item.series.seriesName;

            html += `<div class="search-result-item" onclick="navigateToCopy('${item.dataKey}', ${item.sIdx}, ${item.hasVarieties ? item.vIdx : 'null'}, ${item.cIdx}, ${item.hasVarieties})">`;
            if (imgSrc) {
                html += `<img class="thumb" src="${imgSrc}" alt="">`;
            } else {
                html += `<div class="thumb" style="background:#e0d8cc;"></div>`;
            }
            html += `<div class="info">`;
            html += `<div class="name">${escapeHtml(displayName)}</div>`;
            html += `<div class="detail">${escapeHtml(copy.version || '无冠号')} · ${escapeHtml(copy.condition || '无评级')}${copy.price ? ' · ' + escapeHtml(copy.price) : ''}</div>`;
            html += `</div>`;
            html += `<div style="color:#999;font-size:0.7rem;">#${idx}</div>`;
            html += `</div>`;
            idx++;
        }
        html += `</div>`;
    }

    app.innerHTML = html;
}

// ========== 从搜索结果跳转到藏品 ==========
function navigateToCopy(dataKey, si, vi, ci, hasVarieties) {
    // 找到对应的分类
    for (const cat of categoryTree) {
        if (cat.children) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) {
                    currentCategoryId = cat.id;
                    currentSubId = sub.id;
                    currentView = 'category';
                    renderSidebar();
                    renderCurrentCategory();
                    // 自动展开对应的品种
                    setTimeout(() => {
                        // 尝试展开对应的品种行
                        let targetId;
                        if (hasVarieties && vi !== null) {
                            targetId = `v-${si}-${vi}`;
                        } else {
                            targetId = `s-${si}`;
                        }
                        toggleVariety(targetId);
                        // 滚动到该位置
                        const el = document.getElementById('list-' + targetId);
                        if (el) {
                            setTimeout(() => {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 100);
                        }
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
                let targetId;
                if (hasVarieties && vi !== null) {
                    targetId = `v-${si}-${vi}`;
                } else {
                    targetId = `s-${si}`;
                }
                toggleVariety(targetId);
                const el = document.getElementById('list-' + targetId);
                if (el) {
                    setTimeout(() => {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }
            }, 50);
            return;
        }
    }
}

// ========== 从搜索结果返回 ==========
function backFromSearch() {
    currentView = currentCategoryId ? 'category' : 'overview';
    currentSearchKeyword = '';
    if (currentView === 'overview') {
        renderOverview();
    } else {
        renderCurrentCategory();
    }
    // 恢复搜索栏
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
}

// ========== 重置 ==========
function resetSearch() {
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    currentSearchKeyword = '';
    currentView = currentCategoryId ? 'category' : 'overview';
    if (currentView === 'overview') {
        renderOverview();
    } else {
        renderCurrentCategory();
    }
}

// ========== 切换搜索模式 ==========
function toggleSearchMode() {
    searchMode = searchMode === 'click' ? 'realtime' : 'click';
    const toggle = document.getElementById('modeToggle');
    const tip = document.getElementById('searchTip');
    if (toggle) toggle.textContent = searchMode === 'click' ? '□' : '■';
    if (tip) tip.textContent = `当前模式：${searchMode === 'click' ? '点击搜索' : '实时搜索'} | 点击"${searchMode === 'click' ? '□' : '■'}"可切换`;

    const input = document.getElementById('searchInput');
    if (input) {
        if (searchMode === 'realtime') {
            input.addEventListener('input', doSearch);
        } else {
            input.removeEventListener('input', doSearch);
        }
    }
}
