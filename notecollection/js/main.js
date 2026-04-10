// 禁用浏览器的自动滚动恢复，防止 F5 刷新后自动滚动到之前的位置
history.scrollRestoration = 'manual';

// 合并所有数据
const banknotesData = {
    commemorative: commemorativeData,
    hk_boc: hk_bocData,
    hk_hsbc: hk_hsbcData,
    hk_sc: hk_scData,
    hk_gov: hk_govData,
    macau_boc: macau_bocData,
    macau_bnu: macau_bnuData,
    taiwan: taiwanData,
    rmb5: rmb5Data,
    rmb4: rmb4Data,
    rmb3: rmb3Data,
    rmb2: rmb2Data,
    rmb1: rmb1Data,
    fec: fecData,
    gkq: gkqData,
    republic_cbc: republic_cbcData,
    republic_boc: republic_bocData,
    republic_communications: republic_communicationsData,
    republic_fbc: republic_fbcData,
    republic_kpb: republic_kpbData,
    republic_crbc: republic_crbcData,
    japan: japanData,
    indonesia: indonesiaData,
    venezuela: venezuelaData,
    ukarine: ukarineData,
    korea: koreaData
};

const categoryOrder = [
    "commemorative",
    "hk_boc",
    "hk_hsbc",
    "hk_sc",
    "hk_gov",
    "macau_boc",
    "macau_bnu",
    "taiwan",
    "rmb5",
    "rmb4",
    "rmb3",
    "rmb2",
    "rmb1",
    "fec",
    "gkq",
    "republic_cbc",
    "republic_boc",
    "republic_communications",
    "republic_fbc",
    "republic_kpb",
    "republic_crbc",
    "japan",
    "indonesia",
    "venezuela",
    "ukarine",
    "korea"
];

let currentView = "categories";
let currentCategoryId = null;
let currentSeries = null;
let scrollMemory = {};

let searchScope = 'global';
let currentSearchKeyword = '';
let currentSearchType = 'all';

let searchMode = 'click';

let currentModalImg1 = '';
let currentModalImg2 = '';

let hammerManager = null;
let currentScale = 1;
let currentX = 0;
let currentY = 0;

const KRAUSE_PREFIX = 'Pick# ';

// 搜索结果页返回相关变量
let fromSearchResult = false;
let lastSearchParams = null;

// 将数字转换为带圈数字（使用数学专用字符）
function toCircledNumber(num) {
    const numStr = num.toString();
    const circledDigits = {
        '0': '𝟘', '1': '𝟙', '2': '𝟚', '3': '𝟛', '4': '𝟜',
        '5': '𝟝', '6': '𝟞', '7': '𝟟', '8': '𝟠', '9': '𝟡'
    };
    return numStr.split('').map(d => circledDigits[d] || d).join('');
}

function saveScroll(key) {
    scrollMemory[key] = window.scrollY;
}

function restoreScroll(key) {
    if (scrollMemory[key] !== undefined && scrollMemory[key] !== null) {
        requestAnimationFrame(() => {
            window.scrollTo(0, scrollMemory[key]);
        });
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function formatYear(year) {
    if (year === undefined || year === null) return '—';
    return year + '年';
}

function formatKrause(krause) {
    if (krause && krause !== '') {
        return `Pick# ${krause}`;
    }
    return `Pick#`;
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
        if (!keyword || keyword === '') {
            return KRAUSE_PREFIX;
        }
        if (!keyword.startsWith(KRAUSE_PREFIX)) {
            return KRAUSE_PREFIX + keyword;
        }
    }
    return keyword || '';
}

function performSearch(rawKeyword, type, scope) {
    const keyword = getActualKeyword(rawKeyword, type);
    
    // 判断是否为空搜索（关键词为空字符串）
    const isEmptySearch = !keyword || keyword === '';
    
    const lowerKeyword = isEmptySearch ? '' : keyword.toLowerCase();
    let results = [];
    const targetCats = scope === 'global' ? categoryOrder : [currentCategoryId];

    for (let cid of targetCats) {
        const cat = banknotesData[cid];
        if (!cat || !cat.series) continue;

        for (let si = 0; si < cat.series.length; si++) {
            const series = cat.series[si];
            if (!series.copies || series.copies.length === 0) continue;

            for (let ci = 0; ci < series.copies.length; ci++) {
                const copy = series.copies[ci];
                
                if (isEmptySearch) {
                    // 空关键词：直接添加所有结果
                    results.push({ catId: cid, sIdx: si, cIdx: ci, series: series, copy: copy });
                } else {
                    // 正常搜索匹配
                    let match = false;
                    switch(type) {
                        case 'all':
                            const searchText = `${series.seriesName} ${copy.version || ''} ${copy.year} ${copy.condition || ''} ${copy.krause || ''}`.toLowerCase();
                            match = searchText.includes(lowerKeyword);
                            break;
                        case 'name':
                            match = series.seriesName.toLowerCase().includes(lowerKeyword);
                            break;
                        case 'version':
                            match = (copy.version || '').toLowerCase().includes(lowerKeyword);
                            break;
                        case 'year':
                            match = String(copy.year).toLowerCase().includes(lowerKeyword);
                            break;
                        case 'agency':
                            match = (copy.condition || '').toLowerCase().includes(lowerKeyword);
                            break;
                        case 'krause':
                            match = (copy.krause || '').toLowerCase().includes(lowerKeyword);
                            break;
                    }
                    if (match) {
                        results.push({ catId: cid, sIdx: si, cIdx: ci, series: series, copy: copy });
                    }
                }
            }
        }
    }

    return results;
}

function renderResultsList(results) {
    if (results.length === 0) {
        return `<div style="padding:1rem; text-align:center;">暂无匹配结果</div>`;
    }

    // 按 catId 分组
    const grouped = {};
    for (let item of results) {
        if (!grouped[item.catId]) {
            grouped[item.catId] = [];
        }
        grouped[item.catId].push(item);
    }

    let html = `<div class="copy-list">`;
    
    for (let cid of categoryOrder) {
        const groupResults = grouped[cid];
        if (!groupResults || groupResults.length === 0) continue;
        
        const cat = banknotesData[cid];
        const catName = cat ? cat.name : cid;
        // 优先使用数据文件中的 icon，否则自动生成
        const catIcon = (cat && cat.icon) ? cat.icon : toCircledNumber(categoryOrder.indexOf(cid) + 1);
        
        // 添加分类标题（带数量统计）
        html += `
            <div class="search-category-divider">
                <span class="category-icon">${catIcon}</span>
                <span class="category-name">${escapeHtml(catName)}</span>
                <span class="category-count">${groupResults.length}张</span>
            </div>
        `;
        
        // 添加该分类下的藏品
        for (let item of groupResults) {
            const krauseDisplay = formatKrause(item.copy.krause);
            html += `
                <div class="copy-item" onclick="selectCopy('${item.catId}', ${item.sIdx}, ${item.cIdx})">
                    <div class="copy-index">#${item.copy.copyId}</div>
                    <div class="copy-badge">${escapeHtml(item.copy.condition || '无')}</div>
                    <div class="copy-version">${escapeHtml(item.series.seriesName)}</div>
                    <div class="copy-price">${escapeHtml(item.copy.version || '无冠号')}</div>
                    <div class="copy-price">${formatYear(item.copy.year)}</div>
                    <div class="copy-price">${escapeHtml(krauseDisplay)}</div>
                </div>`;
        }
    }
    
    html += `</div>`;
    return html;
}

function performRealtimeSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchType = document.getElementById('searchType');

    if (!searchInput) return;

    const rawKeyword = searchInput.value;
    const type = searchType ? searchType.value : 'all';

    currentSearchKeyword = rawKeyword;
    currentSearchType = type;

    // 如果搜索框为空，展示所有藏品
    if (!rawKeyword || rawKeyword.trim() === '') {
        currentSearchKeyword = '';
        saveScroll("searchResult");
        renderSearchResultPage('', type, true);
        return;
    }

    // 实时搜索模式下，统一重新渲染页面，确保关键词提示正确显示
    renderSearchResultPage(rawKeyword, type, true);
}

function renderSearchResultPage(rawKeyword, type, autoFocus = true) {
    // 允许空关键词，表示展示所有藏品
    const keyword = rawKeyword || '';
    
    // 标记当前在搜索结果页
    currentView = 'searchResult';

    // 保存滚动位置（原有代码不变）
    if (currentView === 'categories') {
        saveScroll("categories");
    } else if (currentView === 'seriesList' && currentCategoryId) {
        saveScroll("seriesList_" + currentCategoryId);
    } else if (currentView === 'copyList' && currentSeries) {
        saveScroll("copyList_" + currentSeries.cid + "_" + currentSeries.si);
    }

    const results = performSearch(keyword, type, searchScope);
    const resultsHtml = renderResultsList(results);
    const placeholderText = searchScope === 'global' ? '在全局搜索' : '在当前板块搜索';
    const displayValue = getDisplayValue(keyword, type);
    const modeIcon = searchMode === 'click' ? '□' : '■';
    const modeText = searchMode === 'click' ? '点击搜索' : '实时搜索';
    
    // 空关键词时显示“全部藏品”，否则显示关键词
    const actualKeyword = keyword === '' ? '' : escapeHtml(getActualKeyword(keyword, type));
    const keywordDisplayHtml = keyword === '' 
        ? '' 
        : ` | 关键词：<span id="searchKeywordDisplay">${actualKeyword}</span>`;

    const fullHtml = `
        <div class="back-bar"><button class="back-btn" onclick="backToPrevious()">← 返回</button></div>
        <div class="search-bar">
            <select class="search-select" id="searchType">
                <option value="all" ${type === 'all' ? 'selected' : ''}>全字段搜索</option>
                <option value="name" ${type === 'name' ? 'selected' : ''}>按名称搜索</option>
                <option value="version" ${type === 'version' ? 'selected' : ''}>按冠字号搜索</option>
                <option value="year" ${type === 'year' ? 'selected' : ''}>按年份搜索</option>
                <option value="agency" ${type === 'agency' ? 'selected' : ''}>按评级机构搜索</option>
                <option value="krause" ${type === 'krause' ? 'selected' : ''}>按克劳斯目录编号搜索</option>
            </select>
            <input type="text" class="search-input" id="searchInput" placeholder="${placeholderText}" value="${escapeHtml(displayValue)}" autocomplete="off">
            <button class="search-btn" id="searchBtn">搜索</button>
            <span id="modeToggle" style="cursor:pointer; font-size:1.2rem; padding:0 8px; color:#daa520;" title="切换搜索模式">${modeIcon}</span>
            <button class="reset-btn" id="resetBtn">重置</button>
        </div>
        <div class="search-tip" id="searchTip">当前模式：${modeText} | 点击“<span style="color:#daa520;">${modeIcon}</span>”可切换</div>
        <div class="list-panel">
            <div class="panel-header">
                <h2>搜索结果</h2>
                <p>找到 <span id="resultCount">${results.length}</span> 个匹配${keywordDisplayHtml}</p>
            </div>
            <div id="dynamicResultContainer">${resultsHtml}</div>
        </div>
    `;

    document.getElementById("app").innerHTML = fullHtml;
    
    restoreScroll("searchResult");
    bindSearchEvents();

    if (autoFocus) {
        const input = document.getElementById('searchInput');
        if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }
}

function backToPrevious() {
    if (currentView === 'categories') {
        renderCategories(true);
    } else if (currentView === 'seriesList' && currentCategoryId) {
        renderSeriesList(currentCategoryId, true);
    } else if (currentView === 'copyList' && currentSeries) {
        renderCopyList(currentSeries.cid, currentSeries.si, true);
    } else {
        renderCategories(true);
    }
}

function resetSearchAndBack() {
    currentSearchKeyword = '';
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    backToPrevious();
}

function setupKrauseInputProtection(inputElement, searchTypeElement) {
    if (!inputElement || !searchTypeElement) return;

    const handleKeydown = function(e) {
        if (searchTypeElement.value !== 'krause') return;
        const cursorPos = inputElement.selectionStart;
        if (cursorPos <= KRAUSE_PREFIX.length) {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                return;
            }
        }
    };

    const handleInput = function(e) {
        if (searchTypeElement.value !== 'krause') return;
        let currentValue = inputElement.value;
        if (!currentValue.startsWith(KRAUSE_PREFIX)) {
            inputElement.value = KRAUSE_PREFIX + currentValue;
        }
    };

    inputElement.removeEventListener('keydown', handleKeydown);
    inputElement.removeEventListener('input', handleInput);
    inputElement.addEventListener('keydown', handleKeydown);
    inputElement.addEventListener('input', handleInput);
}

function bindSearchEvents() {
    const searchBtn = document.getElementById('searchBtn');
    const resetBtn = document.getElementById('resetBtn');
    const modeToggle = document.getElementById('modeToggle');
    const searchInput = document.getElementById('searchInput');
    const searchType = document.getElementById('searchType');
    const searchTip = document.getElementById('searchTip');

    if (!searchInput) return;

    if (searchInput._realtimeHandler) {
        searchInput.removeEventListener('input', searchInput._realtimeHandler);
    }

    let realtimeTimer = null;

    const handleRealtimeInput = function(e) {
        if (realtimeTimer) clearTimeout(realtimeTimer);
        realtimeTimer = setTimeout(() => {
            performRealtimeSearch();
        }, 300);
    };

    if (searchType) {
        const handleTypeChange = function() {
            const newType = searchType.value;
            const currentRaw = searchInput.value;

            if (newType === 'krause') {
                if (!currentRaw.startsWith(KRAUSE_PREFIX)) {
                    searchInput.value = KRAUSE_PREFIX + currentRaw;
                }
            } else {
                if (currentRaw.startsWith(KRAUSE_PREFIX)) {
                    searchInput.value = currentRaw.substring(KRAUSE_PREFIX.length);
                }
            }
            currentSearchKeyword = searchInput.value;
            currentSearchType = newType;
            setupKrauseInputProtection(searchInput, searchType);
        };

        searchType.removeEventListener('change', handleTypeChange);
        searchType.addEventListener('change', handleTypeChange);
        handleTypeChange();
    }

    setupKrauseInputProtection(searchInput, searchType);

    if (searchMode === 'realtime') {
        searchInput.addEventListener('input', handleRealtimeInput);
        searchInput._realtimeHandler = handleRealtimeInput;
        if (searchBtn) {
            searchBtn.disabled = true;
            searchBtn.style.opacity = '0.5';
        }
    } else {
        searchInput.removeEventListener('input', handleRealtimeInput);
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.style.opacity = '1';
        }
    }

    if (searchBtn) {
        const newBtn = searchBtn.cloneNode(true);
        searchBtn.parentNode.replaceChild(newBtn, searchBtn);
        newBtn.addEventListener('click', function() {
            if (searchMode === 'click') {
                const keyword = searchInput.value;
                const type = searchType ? searchType.value : 'all';
                if (keyword && keyword.trim() !== '') {
                    currentSearchKeyword = keyword;
                    currentSearchType = type;
                    renderSearchResultPage(keyword, type, true);
                } else {
                    alert('请输入搜索关键词');
                }
            }
        });
    }

    if (modeToggle) {
        const newToggle = modeToggle.cloneNode(true);
        modeToggle.parentNode.replaceChild(newToggle, modeToggle);
        newToggle.addEventListener('click', function() {
            searchMode = searchMode === 'click' ? 'realtime' : 'click';
            const modeIcon = searchMode === 'click' ? '□' : '■';
            const modeText = searchMode === 'click' ? '点击搜索' : '实时搜索';
            newToggle.textContent = modeIcon;
            if (searchTip) {
                searchTip.innerHTML = `当前模式：${modeText} | 点击“<span style="color:#daa520;">${modeIcon}</span>”可切换`;
            }
            bindSearchEvents();
        });
    }

    if (resetBtn) {
        const newReset = resetBtn.cloneNode(true);
        resetBtn.parentNode.replaceChild(newReset, resetBtn);
        newReset.addEventListener('click', function() {
            resetSearchAndBack();
        });
    }
}

function renderCategories(restore = false) {
    fromSearchResult = false;
    if (!restore) {
        window.scrollTo(0, 0);
    }
    searchScope = 'global';
    currentView = "categories";
    currentCategoryId = null;

    const modeIcon = searchMode === 'click' ? '□' : '■';
    const modeText = searchMode === 'click' ? '点击搜索' : '实时搜索';
    const displayValue = getDisplayValue(currentSearchKeyword, currentSearchType);

    let html = `
        <div class="search-bar">
            <select class="search-select" id="searchType">
                <option value="all" ${currentSearchType === 'all' ? 'selected' : ''}>全字段搜索</option>
                <option value="name" ${currentSearchType === 'name' ? 'selected' : ''}>按名称搜索</option>
                <option value="version" ${currentSearchType === 'version' ? 'selected' : ''}>按冠字号搜索</option>
                <option value="year" ${currentSearchType === 'year' ? 'selected' : ''}>按年份搜索</option>
                <option value="agency" ${currentSearchType === 'agency' ? 'selected' : ''}>按评级机构搜索</option>
                <option value="krause" ${currentSearchType === 'krause' ? 'selected' : ''}>按克劳斯目录编号搜索</option>
            </select>
            <input type="text" class="search-input" id="searchInput" placeholder="在全局搜索" value="${escapeHtml(displayValue)}" autocomplete="off">
            <button class="search-btn" id="searchBtn">搜索</button>
            <span id="modeToggle" style="cursor:pointer; font-size:1.2rem; padding:0 8px; color:#daa520;" title="切换搜索模式">${modeIcon}</span>
            <button class="reset-btn" id="resetBtn">重置</button>
        </div>
        <div class="search-tip" id="searchTip">当前模式：${modeText} | 点击“<span style="color:#daa520;">${modeIcon}</span>”可切换</div>
        <div class="category-grid">`;

    for (let id of categoryOrder) {
        const cat = banknotesData[id];
        if (!cat) continue;
        let total = 0;
        if (cat.series) {
            for (let s of cat.series) total += s.copies ? s.copies.length : 0;
        }
        // 优先使用数据文件中的 icon，否则自动生成
        const icon = (cat && cat.icon) ? cat.icon : toCircledNumber(categoryOrder.indexOf(id) + 1);
        html += `
            <div class="category-card" onclick="selectCategory('${id}')">
                <div class="category-icon">${icon}</div>
                <h3>${cat.name || id}</h3>
                <p>${cat.desc || ''}</p>
                <div class="count-badge"> ${total} 张藏品</div>
            </div>`;
    }
    html += `</div>`;
    document.getElementById("app").innerHTML = html;
    bindSearchEvents();
    if (restore) {
        restoreScroll("categories");
    }
}

function renderSeriesList(cid, restore = false) {
    fromSearchResult = false;
    if (!restore) {
        window.scrollTo(0, 0);
    }
    searchScope = 'currentCategory';
    currentView = "seriesList";
    currentCategoryId = cid;

    const cat = banknotesData[cid];
    if (!cat || !cat.series) return;

    const modeIcon = searchMode === 'click' ? '□' : '■';
    const modeText = searchMode === 'click' ? '点击搜索' : '实时搜索';
    const displayValue = getDisplayValue(currentSearchKeyword, currentSearchType);

    let items = `<div class="series-list">`;
    for (let idx = 0; idx < cat.series.length; idx++) {
        const s = cat.series[idx];
        items += `
            <div class="series-item" onclick="selectSeries('${cid}', ${idx})">
                <div class="series-name">${escapeHtml(s.seriesName)}</div>
                <div class="series-count">${s.copies ? s.copies.length : 0}张</div>
                <div class="series-year">${formatYear(s.year)}</div>
            </div>`;
    }
    items += `</div>`;

    // 优先使用数据文件中的 icon，否则自动生成
    const icon = (cat && cat.icon) ? cat.icon : toCircledNumber(categoryOrder.indexOf(cid) + 1);

    const full = `
        <div class="back-bar"><button class="back-btn" onclick="backToCategories()">← 返回分类</button></div>
        <div class="search-bar">
            <select class="search-select" id="searchType">
                <option value="all" ${currentSearchType === 'all' ? 'selected' : ''}>全字段搜索</option>
                <option value="name" ${currentSearchType === 'name' ? 'selected' : ''}>按名称搜索</option>
                <option value="version" ${currentSearchType === 'version' ? 'selected' : ''}>按冠字号搜索</option>
                <option value="year" ${currentSearchType === 'year' ? 'selected' : ''}>按年份搜索</option>
                <option value="agency" ${currentSearchType === 'agency' ? 'selected' : ''}>按评级机构搜索</option>
                <option value="krause" ${currentSearchType === 'krause' ? 'selected' : ''}>按克劳斯目录编号搜索</option>
            </select>
            <input type="text" class="search-input" id="searchInput" placeholder="在当前板块搜索" value="${escapeHtml(displayValue)}" autocomplete="off">
            <button class="search-btn" id="searchBtn">搜索</button>
            <span id="modeToggle" style="cursor:pointer; font-size:1.2rem; padding:0 8px; color:#daa520;" title="切换搜索模式">${modeIcon}</span>
            <button class="reset-btn" id="resetBtn">重置</button>
        </div>
        <div class="search-tip" id="searchTip">当前模式：${modeText} | 点击“<span style="color:#daa520;">${modeIcon}</span>”可切换</div>
        <div class="list-panel">
            <div class="panel-header"><h2>${icon} ${cat.name || cid}</h2><p>点击品种查看藏品</p></div>
            ${items}
        </div>`;
    document.getElementById("app").innerHTML = full;
    bindSearchEvents();
    if (restore) {
        restoreScroll("seriesList_" + cid);
    }
}

function renderCopyList(cid, si, restore = false) {
    fromSearchResult = false;
    if (!restore) {
        window.scrollTo(0, 0);
    }
    currentView = "copyList";
    currentCategoryId = cid;
    currentSeries = { cid, si };

    const cat = banknotesData[cid];
    if (!cat || !cat.series || !cat.series[si]) return;
    const series = cat.series[si];
    const copies = series.copies || [];

    let copiesHtml = `<div class="copy-list">`;
    for (let ci = 0; ci < copies.length; ci++) {
        const cp = copies[ci];
        copiesHtml += `
            <div class="copy-item" onclick="selectCopy('${cid}', ${si}, ${ci})">
                <div class="copy-index">#${cp.copyId}</div>
                <div class="copy-badge">${escapeHtml(cp.condition || '无评级')}</div>
                <div class="copy-version">${escapeHtml(cp.version || '无冠号')}</div>
                <div class="copy-price">${formatYear(cp.year)}</div>
                <div class="copy-price">${escapeHtml(formatKrause(cp.krause))}</div>
            </div>`;
    }
    if (copies.length === 0) {
        copiesHtml += `<div style="padding:1rem; text-align:center; color:#999;">暂无藏品</div>`;
    }
    copiesHtml += `</div>`;

    const full = `
        <div class="back-bar">
            <button class="back-btn" onclick="backToSeries('${cid}')">← 返回品种</button>
        </div>
        <div class="list-panel">
            <div class="panel-header">
                <h2>${escapeHtml(series.seriesName)}</h2>
                <p>${formatYear(series.year)} · 共 ${copies.length} 张</p>
            </div>
            ${copiesHtml}
        </div>`;
    document.getElementById("app").innerHTML = full;
    if (restore) {
        restoreScroll("copyList_" + cid + "_" + si);
    }
}

function renderDetail(cid, si, ci) {
    currentView = "detail";
    currentCategoryId = cid;
    currentSeries = { cid, si };

    const cat = banknotesData[cid];
    if (!cat || !cat.series || !cat.series[si]) return;
    const series = cat.series[si];
    const cp = series.copies[ci];
    if (!cp) return;

    currentModalImg1 = cp.img1 || '';
    currentModalImg2 = cp.img2 || '';

    const detailFields = cat.detailFields || [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯编号" },
        { key: "copyId", label: "藏品编号" }
    ];

    let detailGridHtml = '';
    for (let field of detailFields) {
        let value = cp[field.key];
        
        if (field.key === 'year') {
            value = formatYear(cp.year);
        } else if (field.key === 'krause') {
            value = formatKrause(value);
        } else if (field.key === 'copyId') {
            value = `#${value}`;
        } else if (value === undefined || value === null || value === '') {
            value = '—';
        }
        
        // signature 字段支持 HTML 换行，其他字段正常转义
        const displayValue = field.key === 'signature' ? String(value) : escapeHtml(String(value));
        
        detailGridHtml += `
            <div class="detail-field">
                <label>${field.label}</label>
                <div>${displayValue}</div>
            </div>`;
    }

    const detailHtml = `
        <div class="back-bar">
            <button class="back-btn" onclick="backToCopyList('${cid}', ${si})">← 返回藏品列表</button>
        </div>
        <div class="detail-panel">
            <div class="detail-header">
                <h3>${escapeHtml(series.seriesName)}</h3>
                <div style="color:#8b6b4f; font-size:0.9rem;">${escapeHtml(cp.version || '无冠号')}</div>
            </div>

            <div class="img-pair">
                <div class="img-box">
                    <img src="${cp.img1}" alt="正面" onclick="openModal(0)">
                </div>
                <div class="img-box">
                    <img src="${cp.img2}" alt="背面" onclick="openModal(1)">
                </div>
            </div>

            <div class="detail-grid">
                ${detailGridHtml}
            </div>

            ${cp.remark ? `<div class="remark-box"><label style="font-size:0.8rem; color:#9a7a5b; font-weight:bold;">备注</label><div style="margin-top:0.4rem; font-size:0.9rem; line-height:1.6;">${escapeHtml(cp.remark)}</div></div>` : ''}
        </div>`;
    document.getElementById("app").innerHTML = detailHtml;
    window.scrollTo(0, 0);
}

function backToCopyList(cid, si) {
    if (fromSearchResult) {
        fromSearchResult = false;
        // 恢复搜索结果页，关键词可能为空
        renderSearchResultPage(lastSearchParams.keyword, lastSearchParams.type, false);
    } else {
        renderCopyList(cid, si, true);
    }
}

function backToSeries(cid) {
    renderSeriesList(cid, true);
}

function backToCategories() {
    renderCategories(true);
}

function selectCategory(cid) {
    saveScroll("categories");
    renderSeriesList(cid, false);
}

function selectSeries(cid, si) {
    saveScroll("seriesList_" + cid);
    renderCopyList(cid, si, false);
}

function selectCopy(cid, si, ci) {
    if (currentView === 'searchResult') {
        fromSearchResult = true;
        saveScroll("searchResult");
        lastSearchParams = {
            keyword: currentSearchKeyword,  // 可能是空字符串
            type: currentSearchType
        };
    } else {
        fromSearchResult = false;
        saveScroll("copyList_" + cid + "_" + si);
    }
    renderDetail(cid, si, ci);
}

function initPinchZoom() {
    if (typeof Hammer === 'undefined') {
        console.log('Hammer.js 未加载，缩放功能不可用');
        return;
    }

    const container = document.getElementById('imageContainer');
    if (!container) return;

    if (hammerManager) {
        hammerManager.destroy();
    }

    hammerManager = new Hammer.Manager(container);
    const pinch = new Hammer.Pinch();
    const pan = new Hammer.Pan();

    hammerManager.add([pinch, pan]);

    let lastScale = 1;
    let lastX = 0;
    let lastY = 0;

    function resetTransform() {
        currentScale = 1;
        currentX = 0;
        currentY = 0;
        container.style.transform = `translate3d(0px, 0px, 0px) scale3d(1, 1, 1)`;
    }

    function clampTransform() {
        const img = document.getElementById('modalImg');
        if (!img) return;

        const containerRect = container.parentElement.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();

        const scaledWidth = imgRect.width;
        const scaledHeight = imgRect.height;

        let maxX = 0, maxY = 0;
        if (scaledWidth > containerRect.width) {
            maxX = (scaledWidth - containerRect.width) / 2;
        }
        if (scaledHeight > containerRect.height) {
            maxY = (scaledHeight - containerRect.height) / 2;
        }

        currentX = Math.min(maxX, Math.max(-maxX, currentX));
        currentY = Math.min(maxY, Math.max(-maxY, currentY));

        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
    }

    hammerManager.on('pinchstart', function(e) {
        lastScale = currentScale;
        e.preventDefault();
    });

    hammerManager.on('pinchmove', function(e) {
        let newScale = lastScale * e.scale;
        newScale = Math.min(4, Math.max(1, newScale));
        currentScale = newScale;
        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        e.preventDefault();
    });

    hammerManager.on('pinchend', function(e) {
        clampTransform();
        e.preventDefault();
    });

    hammerManager.on('panstart', function(e) {
        lastX = currentX;
        lastY = currentY;
    });

    hammerManager.on('panmove', function(e) {
        if (currentScale > 1) {
            currentX = lastX + e.deltaX;
            currentY = lastY + e.deltaY;
            container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        }
        e.preventDefault();
    });

    hammerManager.on('panend', function(e) {
        clampTransform();
    });

    container.addEventListener('dblclick', function(e) {
        resetTransform();
        e.preventDefault();
    });

    resetTransform();
}

function openModal(index = 0) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    const imgSrc = index === 0 ? currentModalImg1 : currentModalImg2;
    modalImg.src = imgSrc;
    modal.style.display = 'flex';

    const container = document.getElementById('imageContainer');
    if (container) {
        container.style.transform = `translate3d(0px, 0px, 0px) scale3d(1, 1, 1)`;
        currentScale = 1;
        currentX = 0;
        currentY = 0;
    }

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = scrollbarWidth + 'px';

    modalImg.onload = function() {
        initPinchZoom();
    };
    if (modalImg.complete) {
        initPinchZoom();
    }
}

function closeModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    const modalImg = document.getElementById('modalImg');
    modalImg.src = '';

    if (hammerManager) {
        hammerManager.destroy();
        hammerManager = null;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this || e.target.classList.contains('modal-content')) {
                closeModal();
            }
        });
    }
});

window.addEventListener('DOMContentLoaded', function() {
    renderCategories(false);
    // 确保刷新后滚动到顶部
    window.scrollTo(0, 0);
});
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
});
