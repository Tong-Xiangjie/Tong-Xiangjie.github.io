let currentSearchKeyword = '';
let currentSearchType = 'all';

function doSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return;

    const rawKeyword = input.value.trim();

    // 文章模式搜索
    if (currentMode === 'articles') {
        saveScroll('articles');
        currentSearchKeyword = rawKeyword;
        articleSearchKeyword = rawKeyword;
        renderArticleList();
        return;
    }

    // 纸币/硬币搜索
    const typeSelect = document.getElementById('searchType');
    const type = typeSelect ? typeSelect.value : 'all';
    currentSearchKeyword = rawKeyword;
    currentSearchType = type;
    currentView = 'search';
    // ★ 切换到搜索容器
    switchViewContainer(currentMode + '_search');
    performSearchAndRender(rawKeyword, type);
}

function resetSearch() {
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    currentSearchKeyword = '';

    if (currentMode === 'articles') {
        articleSearchKeyword = '';
        renderArticleList();
        return;
    }

    // 纸币/硬币模式
    currentView = currentCategoryId ? 'category' : 'overview';
    // ★ 切换回概览或分类容器
    switchViewContainer(currentMode + '_' + currentView);
    if (currentView === 'overview') {
        renderOverview();
    } else {
        renderCurrentCategory();
    }
}

function toggleSearchMode() {
    if (currentMode === 'articles') {
        toggleArticleSearchMode();
        return;
    }

    searchMode = searchMode === 'click' ? 'realtime' : 'click';
    const toggle = document.getElementById('modeToggle');
    const tip = document.getElementById('searchTip');
    if (toggle) toggle.textContent = searchMode === 'click' ? '□' : '■';
    if (tip) tip.textContent = `当前模式：${searchMode === 'click' ? '点击搜索' : '实时搜索'} | 点击"□"可切换`;

    const input = document.getElementById('searchInput');
    if (input) {
        if (searchMode === 'realtime') {
            input.addEventListener('input', doSearch);
        } else {
            input.removeEventListener('input', doSearch);
        }
    }
}

function performSearchAndRender(rawKeyword, type) {
    const keyword = getActualKeyword(rawKeyword, type);
    const isEmptySearch = !keyword || keyword === '';
    const lowerKeyword = isEmptySearch ? '' : keyword.toLowerCase();
    let results = [];
    const keys = getAllDataKeys();

    for (const dataKey of keys) {
        const data = getData(dataKey);
        if (!data || !data.series) continue;

        let catName = dataKey;
        let parentName = '';
        const tree = getCategoryTree();
        for (const cat of tree) {
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
            const text = `${series.seriesName} ${variety.varietyName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase();
            return text.includes(keyword);
        case 'name':
            return series.seriesName.toLowerCase().includes(keyword) || variety.varietyName.toLowerCase().includes(keyword);
        case 'version':
            return (copy.version || '').toLowerCase().includes(keyword);
        case 'year':
            return String(copy.year).toLowerCase().includes(keyword);
        case 'agency':
            return (copy.condition || copy.grade || '').toLowerCase().includes(keyword);
        case 'krause':
            return (copy.catalogNumber || copy.krause || '').toLowerCase().includes(keyword);
    }
    return false;
}

function matchCopyFlat(copy, series, keyword, type, isEmpty) {
    if (isEmpty) return true;
    switch(type) {
        case 'all':
            const text = `${series.seriesName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase();
            return text.includes(keyword);
        case 'name':
            return series.seriesName.toLowerCase().includes(keyword);
        case 'version':
            return (copy.version || '').toLowerCase().includes(keyword);
        case 'year':
            return String(copy.year).toLowerCase().includes(keyword);
        case 'agency':
            return (copy.condition || copy.grade || '').toLowerCase().includes(keyword);
        case 'krause':
            return (copy.catalogNumber || copy.krause || '').toLowerCase().includes(keyword);
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

function renderSearchResults(results, rawKeyword, type) {
    // ★ 使用独立滚动容器
    const app = getViewContainer(currentMode + '_search');
    const imgBase = getImageBase();
    const modeLabel = currentMode === 'notes' ? '纸币' : '硬币';

    let html = `<div class="back-bar"><button class="back-btn" onclick="backFromSearch()">← 返回</button></div>`;
    html += `<div class="panel-header"><h2>搜索结果（${modeLabel}）</h2>`;
    html += `<p>找到 ${results.length} 个匹配`;
    if (rawKeyword) html += ` · 关键词：${escapeHtml(getActualKeyword(rawKeyword, type))}`;
    html += `</p></div>`;

    if (results.length === 0) {
        html += `<div class="empty-state">暂无匹配结果</div>`;
        app.innerHTML = html;
        requestAnimationFrame(() => {
            app.classList.remove('content-enter');
            void app.offsetWidth;
            app.classList.add('content-enter');
        });
        return;
    }

    const grouped = {};
    for (const item of results) {
        const key = item.dataKey;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
    }

    let idx = 1;
    const keys = getAllDataKeys();
    for (const dataKey of keys) {
        const group = grouped[dataKey];
        if (!group || group.length === 0) continue;
        const first = group[0];
        const label = first.parentName ? `${first.parentName} - ${first.catName}` : first.catName;

        html += `<div class="search-result-group">`;
        html += `<div class="search-group-header">${escapeHtml(label)} <span class="count">${group.length}件</span></div>`;

        for (const item of group) {
            const copy = item.copy;
            const img1 = copy.img1 ? imgBase + copy.img1 : '';
            const img2 = copy.img2 ? imgBase + copy.img2 : '';
            const displayName = item.hasVarieties
                ? `${item.series.seriesName} - ${item.variety.varietyName}`
                : item.series.seriesName;
            const catalogNum = copy.catalogNumber || copy.krause || '';
            const catalogDisplay = catalogNum ? (catalogNum.startsWith('Pick#') ? catalogNum : (catalogNum.startsWith('KM#') ? catalogNum : 'Pick# ' + catalogNum)) : '';

            html += `<div class="search-result-item" onclick="navigateToCopy('${item.dataKey}', ${item.sIdx}, ${item.hasVarieties ? item.vIdx : 'null'}, ${item.cIdx}, ${item.hasVarieties})">`;
            html += `<div class="dual-thumb">`;
            if (img1) html += `<img class="mini-thumb" src="${img1}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
            if (img2) html += `<img class="mini-thumb" src="${img2}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
            if (!img1 && !img2) html += `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;">无预览</div>`;
            html += `</div>`;
            html += `<div class="info">`;
            html += `<div class="name">${escapeHtml(displayName)}</div>`;
            html += `<div class="detail">`;
            if (copy.version) html += `${escapeHtml(copy.version)} · `;
            if (copy.condition || copy.grade) html += `${escapeHtml(copy.condition || copy.grade)} · `;
            if (copy.year) html += `${copy.year}年`;
            if (catalogDisplay) html += ` · ${escapeHtml(catalogDisplay)}`;
            html += `</div></div>`;
            html += `<div class="index-num">#${idx}</div>`;
            html += `</div>`;
            idx++;
        }
        html += `</div>`;
    }

    app.innerHTML = html;

    // ★ 不需要恢复滚动，容器自动保持 scrollTop

    requestAnimationFrame(() => {
        app.classList.remove('content-enter');
        void app.offsetWidth;
        app.classList.add('content-enter');
    });
}

function navigateToCopy(dataKey, si, vi, ci, hasVarieties) {
    const tree = getCategoryTree();
    for (const cat of tree) {
        if (cat.children) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) {
                    currentCategoryId = cat.id;
                    currentSubId = sub.id;
                    currentView = 'category';
                    switchViewContainer(currentMode + '_category');
                    renderSidebar();
                    renderCurrentCategory();
                    setTimeout(() => {
                        const seriesId = `series-${si}`;
                        toggleSeries(seriesId);
                        if (hasVarieties && vi !== null) {
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
                    return;
                }
            }
        } else if (cat.dataKey === dataKey) {
            currentCategoryId = cat.id;
            currentSubId = null;
            currentView = 'category';
            switchViewContainer(currentMode + '_category');
            renderSidebar();
            renderCurrentCategory();
            setTimeout(() => {
                const seriesId = `series-${si}`;
                toggleSeries(seriesId);
                if (hasVarieties && vi !== null) {
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
            return;
        }
    }
}

function backFromSearch() {
    currentView = currentCategoryId ? 'category' : 'overview';
    // ★ 切换回概览或分类容器
    switchViewContainer(currentMode + '_' + currentView);
    currentSearchKeyword = '';
    if (currentView === 'overview') {
        renderOverview();
    } else {
        renderCurrentCategory();
    }
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
}
