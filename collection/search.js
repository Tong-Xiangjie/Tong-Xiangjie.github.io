// ==================== search.js ====================

function updateSearchUIForMode() {
    const select = document.getElementById('searchType');
    const toggle = document.getElementById('modeToggle');
    const tip = document.getElementById('searchTip');

    if (!select || !toggle || !tip) return;

    if (currentMode === MODE.ARTICLES) {
        select.classList.add('hidden');
        toggle.classList.remove('hidden');
        toggle.textContent = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '标' : '全';
        toggle.title = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '当前为按标题索引，点击“标”字可以切换为全字段索引' : '当前为全字段索引，点击“全”字可以切换为按标题索引';
        tip.textContent = (typeof articleSearchMode !== 'undefined' && articleSearchMode === 'title') ? '当前模式为按标题索引（实时搜索），点击“标”字可以切换为全字段索引' : '当前模式为全字段索引（实时搜索），点击“全”字可以切换为按标题索引 | 请先等待全文搜索准备就绪，我们正在全力加载……';
    } else if (currentMode === MODE.SPECIAL || currentMode === MODE.SETTINGS) {
        select.classList.add('hidden');
        toggle.classList.add('hidden');
        tip.textContent = '';
    } else {
        select.classList.remove('hidden');
        toggle.classList.remove('hidden');
        const modeSearch = getEffectiveSearchMode();
        toggle.textContent = modeSearch === SEARCH_MODE.CLICK ? '□' : '■';
        toggle.title = '切换搜索模式';
        tip.textContent = `当前搜索模式为“${modeSearch === SEARCH_MODE.CLICK ? '点击搜索' : '实时搜索'}”，点击“${modeSearch === SEARCH_MODE.CLICK ? '□' : '■'}”可切换至${modeSearch === SEARCH_MODE.CLICK ? '实时搜索' : '点击搜索'}模式`;
    }
}

function doSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return;

    const rawKeyword = input.value.trim();

    if (currentMode === MODE.ARTICLES) {
        articleSearchKeyword = rawKeyword;
        renderArticleList();
        return;
    }

    // ★ 在切换到搜索视图之前，保存当前状态（包括展开状态）
    saveFullState();

    const typeSelect = document.getElementById('searchType');
    const type = typeSelect ? typeSelect.value : SEARCH_TYPE.ALL;
    currentSearchKeyword = rawKeyword;
    currentSearchType = type;
    currentView = VIEW.SEARCH;
    switchToCurrentContainer();
    performSearchAndRender(rawKeyword, type);
}

function resetSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return;

    input.value = '';
    input.focus();

    if (currentMode === MODE.ARTICLES) {
        articleSearchKeyword = '';
        renderArticleList();
        return;
    }

    // 如果当前在搜索结果视图，回到之前的视图（并保留展开状态）
    if (currentView === VIEW.SEARCH) {
        backFromSearch();
        return;
    }

    // 否则（在 overview 或 category 视图），只清空搜索框，不重新渲染
    currentSearchKeyword = '';
    updateSearchUIForMode();
}

function toggleSearchMode() {
    if (currentMode === MODE.ARTICLES) {
        if (typeof toggleArticleSearchMode === 'function') {
            toggleArticleSearchMode();
        }
        return;
    }
    if (currentMode !== MODE.NOTES && currentMode !== MODE.COINS) return;

    const current = modeStates[currentMode].searchMode;
    const newMode = current === SEARCH_MODE.CLICK ? SEARCH_MODE.REALTIME : SEARCH_MODE.CLICK;
    modeStates[currentMode].searchMode = newMode;

    const toggle = document.getElementById('modeToggle');
    const tip = document.getElementById('searchTip');
    const toggleChar = newMode === SEARCH_MODE.CLICK ? '□' : '■';
    if (toggle) toggle.textContent = toggleChar;
    if (tip) tip.textContent = `当前搜索模式为“${newMode === SEARCH_MODE.CLICK ? '点击搜索' : '实时搜索'}”，点击“${newMode === SEARCH_MODE.CLICK ? '□' : '■'}”可切换至${newMode === SEARCH_MODE.CLICK ? '实时搜索' : '点击搜索'}模式`;

    const input = document.getElementById('searchInput');
    if (input) {
        input.removeEventListener('input', doSearch);
        if (newMode === SEARCH_MODE.REALTIME) {
            input.addEventListener('input', doSearch);
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
        case SEARCH_TYPE.ALL:
            const text = `${series.seriesName} ${variety.varietyName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase();
            return text.includes(keyword);
        case SEARCH_TYPE.NAME:
            return series.seriesName.toLowerCase().includes(keyword) || variety.varietyName.toLowerCase().includes(keyword);
        case SEARCH_TYPE.VERSION:
            return (copy.version || '').toLowerCase().includes(keyword);
        case SEARCH_TYPE.YEAR:
            return String(copy.year).toLowerCase().includes(keyword);
        case SEARCH_TYPE.AGENCY:
            return (copy.condition || copy.grade || '').toLowerCase().includes(keyword);
        case SEARCH_TYPE.KRAUSE:
            const raw = (copy.catalogNumber || copy.krause || '');
            const formatted = formatCatalogNumber(raw);
            return raw.toLowerCase().includes(keyword) || formatted.toLowerCase().includes(keyword);
    }
    return false;
}

function matchCopyFlat(copy, series, keyword, type, isEmpty) {
    if (isEmpty) return true;
    switch(type) {
        case SEARCH_TYPE.ALL:
            const text = `${series.seriesName} ${copy.version || ''} ${copy.year} ${copy.condition || copy.grade || ''} ${copy.catalogNumber || copy.krause || ''} ${copy.material || ''}`.toLowerCase();
            return text.includes(keyword);
        case SEARCH_TYPE.NAME:
            return series.seriesName.toLowerCase().includes(keyword);
        case SEARCH_TYPE.VERSION:
            return (copy.version || '').toLowerCase().includes(keyword);
        case SEARCH_TYPE.YEAR:
            return String(copy.year).toLowerCase().includes(keyword);
        case SEARCH_TYPE.AGENCY:
            return (copy.condition || copy.grade || '').toLowerCase().includes(keyword);
        case SEARCH_TYPE.KRAUSE:
            const raw = (copy.catalogNumber || copy.krause || '');
            const formatted = formatCatalogNumber(raw);
            return raw.toLowerCase().includes(keyword) || formatted.toLowerCase().includes(keyword);
    }
    return false;
}

function getActualKeyword(inputValue, searchType) {
    if (searchType === SEARCH_TYPE.KRAUSE) {
        if (inputValue.startsWith(KRAUSE_PREFIX)) {
            return inputValue.substring(KRAUSE_PREFIX.length).trim();
        }
        return inputValue.trim();
    }
    return inputValue.trim();
}

function renderSearchResults(results, rawKeyword, type) {
    const app = getRenderContainer();
    const modeLabel = currentMode === MODE.NOTES ? '纸币' : '硬币';

    let html = `<div class="back-bar"><button class="back-btn" onclick="backFromSearch()">← 返回</button></div>`;
    html += `<div class="panel-header"><h2>${modeLabel}板块搜索结果</h2>`;
    html += `<p>共找到${results.length}件符合要求的藏品`;
    if (rawKeyword) html += ` · 搜索关键词：${escapeHtml(getActualKeyword(rawKeyword, type))}`;
    html += `</p></div>`;

    if (results.length === 0) {
        html += '<div class="empty-state">啊呜，这里空空如也υ´• ﻌ •`υ</div>';
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
            const img1 = getImageUrl(copy.img1);
            const img2 = getImageUrl(copy.img2);
            const displayName = item.hasVarieties
                ? `${item.series.seriesName} - ${item.variety.varietyName}`
                : item.series.seriesName;

            const catalogNum = copy.catalogNumber || copy.krause || '';
            const catalogDisplay = formatCatalogNumber(catalogNum);

            html += `<div class="search-result-item" onclick="navigateToCopy('${item.dataKey}', ${item.sIdx}, ${item.hasVarieties ? item.vIdx : 'null'}, ${item.cIdx}, ${item.hasVarieties})">`;
            html += `<div class="dual-thumb">`;
            if (img1) html += `<img class="mini-thumb" src="${img1}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img1)}', '${escapeHtml(img2 || img1)}')">`;
            if (img2) html += `<img class="mini-thumb" src="${img2}" alt="" onclick="event.stopPropagation(); openModal('${escapeHtml(img2)}', '${escapeHtml(img1 || img2)}')">`;
            if (!img1 && !img2) html += `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;font-size:0.5rem;">O_O</div>`;
            html += `</div>`;
            html += `<div class="info">`;
            html += `<div class="name">${escapeHtml(displayName)}</div>`;
            html += `<div class="detail">`;
            if (copy.version) html += `${escapeHtml(copy.version)} · `;
            if (copy.condition || copy.grade) html += `${escapeHtml(copy.condition || copy.grade)} · `;
            if (copy.year) html += `${copy.year}年发行`;
            if (catalogDisplay) html += ` · ${escapeHtml(catalogDisplay)}`;
            html += `</div></div>`;
            html += `<div class="index-num">#${idx}</div>`;
            html += `</div>`;
            idx++;
        }
        html += `</div>`;
    }

    app.innerHTML = html;
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
                    // 保存搜索容器滚动
                    const searchKey = getContainerKey();
                    const container = getRenderContainer();
                    if (container) scrollMemory[currentMode + '-' + searchKey] = container.scrollTop;

                    currentCategoryId = cat.id;
                    currentSubId = sub.id;
                    currentView = VIEW.CATEGORY;
                    switchToCurrentContainer();
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
            const searchKey = getContainerKey();
            const container = getRenderContainer();
            if (container) scrollMemory[currentMode + '-' + searchKey] = container.scrollTop;

            currentCategoryId = cat.id;
            currentSubId = null;
            currentView = VIEW.CATEGORY;
            switchToCurrentContainer();
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
    // 保存搜索视图的滚动位置
    saveFullState();

    const prevCategoryId = currentCategoryId;

    // 切换回原来的视图（概览或分类）
    currentView = prevCategoryId ? VIEW.CATEGORY : VIEW.OVERVIEW;
    switchToCurrentContainer();
    currentSearchKeyword = '';
    const input = document.getElementById('searchInput');
    if (input) input.value = '';

    if (currentView === VIEW.OVERVIEW) {
        renderOverview();
    } else {
        // 重新渲染分类
        renderCurrentCategory();
        // ★ 从 modeStates 恢复展开状态（延迟足够长确保 DOM 渲染完成）
        const saved = modeStates[currentMode];
        if (saved && (saved.expandedSeries?.length > 0 || saved.expandedVarieties?.length > 0)) {
            setTimeout(() => {
                restoreExpandedStates({
                    expandedSeries: saved.expandedSeries || [],
                    expandedVarieties: saved.expandedVarieties || []
                });
            }, 100);
        }
    }
    updateSearchUIForMode();
}