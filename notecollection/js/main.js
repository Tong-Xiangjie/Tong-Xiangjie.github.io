history.scrollRestoration = 'manual';

// 侧滑返回历史记录管理
let isHandlingPopState = false;
let viewHistoryStack = [];

// 合并所有数据
const banknotesData = {
    commemorative: commemorativeData,
    uncut: uncutData,
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
    nedb: nedbData,
    lecb: lecbData,
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
    russia: russiaData
};

const categoryOrder = [
    "commemorative",
    "uncut",
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
    "nedb",
    "lecb",
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
    "russia"
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

// readme 返回信息存储
let currentReadmeBackInfo = null;

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

// 加载外部文件内容（用于备注等长文本）
async function loadExternalContent(path) {
    if (!path) return null;
    
    const fileMatch = path.match(/^(?:file:|LOAD:)?(.+)$/i);
    if (!fileMatch) return null;
    
    const filePath = fileMatch[1];
    try {
        const response = await fetch(filePath);
        if (response.ok) {
            return await response.text();
        } else {
            console.error('加载文件失败:', filePath, response.status);
            return `[文件加载失败: ${filePath}]`;
        }
    } catch(e) {
        console.error('加载文件异常:', filePath, e);
        return `[文件加载异常: ${filePath}]`;
    }
}

// 处理备注内容（支持外部文件加载和HTML）
async function processRemarkContent(remark) {
    if (!remark) return '';
    
    const isExternalFile = remark.startsWith('file:') || remark.startsWith('LOAD:');
    let content = remark;
    
    if (isExternalFile) {
        content = await loadExternalContent(remark);
        if (!content) return '';
    }
    
    return content;
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
    
    const isEmptySearch = !keyword || keyword === '';
    
    const lowerKeyword = isEmptySearch ? '' : keyword.toLowerCase();
    let results = [];
    const targetCats = scope === 'global' ? categoryOrder : [currentCategoryId];

    for (let cid of targetCats) {
        const cat = banknotesData[cid];
        if (!cat || !cat.series) continue;

        for (let si = 0; si < cat.series.length; si++) {
            const series = cat.series[si];
            
            if (series.varieties && series.varieties.length > 0) {
                for (let vi = 0; vi < series.varieties.length; vi++) {
                    const variety = series.varieties[vi];
                    if (!variety.copies || variety.copies.length === 0) continue;
                    for (let ci = 0; ci < variety.copies.length; ci++) {
                        const copy = variety.copies[ci];
                        if (isEmptySearch) {
                            results.push({ catId: cid, sIdx: si, vIdx: vi, cIdx: ci, series: series, variety: variety, copy: copy, hasVarieties: true });
                        } else {
                            let match = false;
                            switch(type) {
                                case 'all':
                                    const searchText = `${series.seriesName} ${variety.varietyName} ${copy.version || ''} ${copy.year} ${copy.condition || ''} ${copy.krause || ''}`.toLowerCase();
                                    match = searchText.includes(lowerKeyword);
                                    break;
                                case 'name':
                                    match = series.seriesName.toLowerCase().includes(lowerKeyword) || variety.varietyName.toLowerCase().includes(lowerKeyword);
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
                                results.push({ catId: cid, sIdx: si, vIdx: vi, cIdx: ci, series: series, variety: variety, copy: copy, hasVarieties: true });
                            }
                        }
                    }
                }
            } else {
                if (!series.copies || series.copies.length === 0) continue;
                for (let ci = 0; ci < series.copies.length; ci++) {
                    const copy = series.copies[ci];
                    if (isEmptySearch) {
                        results.push({ catId: cid, sIdx: si, cIdx: ci, series: series, copy: copy, hasVarieties: false });
                    } else {
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
                            results.push({ catId: cid, sIdx: si, cIdx: ci, series: series, copy: copy, hasVarieties: false });
                        }
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

    const grouped = {};
    for (let item of results) {
        if (!grouped[item.catId]) {
            grouped[item.catId] = [];
        }
        grouped[item.catId].push(item);
    }

    let html = `<div class="copy-list">`;
    
    // 全局序号：从1开始，所有分类共用
    let globalIndex = 1;
    
    for (let cid of categoryOrder) {
        const groupResults = grouped[cid];
        if (!groupResults || groupResults.length === 0) continue;
        
        const cat = banknotesData[cid];
        const catName = cat ? cat.name : cid;
        const catIcon = (cat && cat.icon) ? cat.icon : toCircledNumber(categoryOrder.indexOf(cid) + 1);
        
        html += `
            <div class="search-category-divider">
                <span class="category-icon">${catIcon}</span>
                <span class="category-name">${escapeHtml(catName)}</span>
                <span class="category-count">${groupResults.length}张</span>
            </div>
        `;
        
        // 不再独立编号，使用全局序号
        for (let item of groupResults) {
            const krauseDisplay = formatKrause(item.copy.krause);
            const displayName = item.hasVarieties ? `${item.series.seriesName} - ${item.variety.varietyName}` : item.series.seriesName;
            html += `
                <div class="copy-item" onclick="selectCopyFromSearchResult('${item.catId}', ${item.sIdx}, ${item.hasVarieties ? item.vIdx : null}, ${item.cIdx}, ${item.hasVarieties})">
                    <div class="copy-index">#${globalIndex}</div>
                    <div class="copy-badge">${escapeHtml(item.copy.condition || '无')}</div>
                    <div class="copy-version">${escapeHtml(displayName)}</div>
                    <div class="copy-price">${escapeHtml(item.copy.version || '无冠号')}</div>
                    <div class="copy-price">${formatYear(item.copy.year)}</div>
                    <div class="copy-price">${escapeHtml(krauseDisplay)}</div>
                </div>`;
            globalIndex++;
        }
    }
    
    html += `</div>`;
    return html;
}

function selectCopyFromSearchResult(cid, si, vi, ci, hasVarieties) {
    fromSearchResult = true;
    saveScroll("searchResult");
    lastSearchParams = {
        keyword: currentSearchKeyword,
        type: currentSearchType
    };
    
    if (hasVarieties) {
        renderDetailFromVariety(cid, si, vi, ci);
    } else {
        renderDetail(cid, si, ci);
    }
}

function performRealtimeSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchType = document.getElementById('searchType');

    if (!searchInput) return;

    const rawKeyword = searchInput.value;
    const type = searchType ? searchType.value : 'all';

    const isNewSearch = (currentSearchKeyword !== rawKeyword || currentSearchType !== type);
    
    if (isNewSearch) {
        delete scrollMemory["searchResult"];
    }

    currentSearchKeyword = rawKeyword;
    currentSearchType = type;

    if (!rawKeyword || rawKeyword.trim() === '') {
        currentSearchKeyword = '';
        renderSearchResultPage('', type, true);
        return;
    }

    renderSearchResultPage(rawKeyword, type, true);
}

function renderSearchResultPage(rawKeyword, type, autoFocus = true) {
    const keyword = rawKeyword || '';
    
    const isNewSearch = (currentSearchKeyword !== keyword || currentSearchType !== type);
    
    currentView = 'searchResult';

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
    
    if (isNewSearch) {
        delete scrollMemory["searchResult"];
    } else {
        restoreScroll("searchResult");
    }
    
    bindSearchEvents();

    if (autoFocus) {
        const input = document.getElementById('searchInput');
        if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }
    
    const switchBtn = document.getElementById('switchToCoinsBtn');
    if (switchBtn) {
        switchBtn.style.display = 'none';
    }
}

// ========== 修改后的返回函数 ==========
function backToPrevious() {
    history.back();
}

function backToCopyList() {
    history.back();
}

function backToCopyListFromVariety() {
    history.back();
}

function backToVarietyList() {
    history.back();
}

function backToSeriesList() {
    history.back();
}

function backToSeries() {
    history.back();
}

function backToCategories() {
    history.back();
}

function goBackFromReadme() {
    history.back();
}
// ========== 返回函数修改结束 ==========

function resetSearchAndBack() {
    const currentType = currentSearchType;  // 保存当前搜索类型
    
    currentSearchKeyword = '';
    // currentSearchType = 'all';  // 删除这一行
    
    delete scrollMemory["searchResult"];
    delete scrollMemory["categories"];
    
    fromSearchResult = false;
    
    renderCategoriesWithoutRestore();
    
    currentSearchType = currentType;  // 恢复搜索类型
}

function renderCategoriesWithoutRestore() {
    fromSearchResult = false;
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
            for (let s of cat.series) {
                if (s.varieties && s.varieties.length > 0) {
                    for (let v of s.varieties) {
                        total += v.copies ? v.copies.length : 0;
                    }
                } else {
                    total += s.copies ? s.copies.length : 0;
                }
            }
        }
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
    
    const switchBtn = document.getElementById('switchToCoinsBtn');
    if (switchBtn) {
        switchBtn.style.display = 'inline-block';
    }
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
        searchBtn.onclick = function() {
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
        };
    }

    if (modeToggle) {
        modeToggle.onclick = function() {
            searchMode = searchMode === 'click' ? 'realtime' : 'click';
            const modeIcon = searchMode === 'click' ? '□' : '■';
            const modeText = searchMode === 'click' ? '点击搜索' : '实时搜索';
            modeToggle.textContent = modeIcon;
            if (searchTip) {
                searchTip.innerHTML = `当前模式：${modeText} | 点击“<span style="color:#daa520;">${modeIcon}</span>”可切换`;
            }
            bindSearchEvents();
        };
    }

    if (resetBtn) {
        resetBtn.onclick = function() {
            resetSearchAndBack();
        };
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
            for (let s of cat.series) {
                if (s.varieties && s.varieties.length > 0) {
                    for (let v of s.varieties) {
                        total += v.copies ? v.copies.length : 0;
                    }
                } else {
                    total += s.copies ? s.copies.length : 0;
                }
            }
        }
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
    
    const switchBtn = document.getElementById('switchToCoinsBtn');
    if (switchBtn) {
        switchBtn.style.display = 'inline-block';
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
        
        const hasVarieties = s.varieties && s.varieties.length > 0;
        let totalCount = 0;
        if (hasVarieties) {
            for (let v of s.varieties) {
                totalCount += v.copies ? v.copies.length : 0;
            }
        } else {
            totalCount = s.copies ? s.copies.length : 0;
        }
        
        items += `
            <div class="series-item" onclick="selectSeriesOrVariety('${cid}', ${idx})">
                <div class="series-name">${escapeHtml(s.seriesName)}</div>
                <div class="series-count">${totalCount}张</div>
                <div class="series-year">${formatYear(s.year)}</div>
            </div>`;
    }
    items += `</div>`;

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
            <div class="panel-header"><h2>${icon} ${cat.name || cid}</h2><p>点击版别查看详情</p></div>
            ${items}
        </div>`;
    document.getElementById("app").innerHTML = full;
    bindSearchEvents();
    if (restore) {
        restoreScroll("seriesList_" + cid);
    }
    
    const switchBtn = document.getElementById('switchToCoinsBtn');
    if (switchBtn) {
        switchBtn.style.display = 'none';
    }
}

function selectSeriesOrVariety(cid, si) {
    const cat = banknotesData[cid];
    if (!cat || !cat.series[si]) return;
    
    const series = cat.series[si];
    
    if (series.varieties && series.varieties.length > 0) {
        saveScroll("seriesList_" + cid);
        renderVarietyList(cid, si, false);
    } else {
        saveScroll("seriesList_" + cid);
        renderCopyList(cid, si, false);
    }
}

// 辅助函数：生成 readme 卡片 HTML（支持数组或单个对象）
function generateReadmeCards(readmeData, type, cid, si, vi = null) {
    if (!readmeData) return '';
    
    let cardsHtml = '';
    const items = Array.isArray(readmeData) ? readmeData : [readmeData];
    
    for (let idx = 0; idx < items.length; idx++) {
        const rm = items[idx];
        const title = rm.title || 'Readme';
        
        let onclickAttr = '';
        if (type === 'varietyList') {
            onclickAttr = `onclick="goToReadmeFromSeriesWithIndex('${cid}', ${si}, ${idx})"`;
        } else if (type === 'copyListFromVariety') {
            onclickAttr = `onclick="goToReadmeFromCopyListWithIndex('${cid}', ${si}, ${vi}, ${idx})"`;
        } else {
            onclickAttr = `onclick="goToReadmeFromCopyListWithIndex('${cid}', ${si}, null, ${idx})"`;
        }
        
        cardsHtml += `
            <div class="readme-card" ${onclickAttr}>
                <div class="readme-title">${escapeHtml(title)}</div>
            </div>
        `;
    }
    
    return cardsHtml;
}

function renderVarietyList(cid, si, restore = false) {
    fromSearchResult = false;
    if (!restore) {
        window.scrollTo(0, 0);
    }
    currentView = "varietyList";
    currentCategoryId = cid;
    currentSeries = { cid, si, vi: null };

    const cat = banknotesData[cid];
    if (!cat || !cat.series[si]) return;
    const series = cat.series[si];
    const varieties = series.varieties || [];

    let itemsHtml = `<div class="series-list">`;
    for (let vi = 0; vi < varieties.length; vi++) {
        const v = varieties[vi];
        const copyCount = v.copies ? v.copies.length : 0;
        itemsHtml += `
            <div class="series-item" onclick="selectVariety('${cid}', ${si}, ${vi})">
                <div class="series-name">${escapeHtml(v.varietyName)}</div>
                <div class="series-count">${copyCount}张</div>
                <div class="series-year">${formatYear(series.year)}</div>
            </div>`;
    }
    itemsHtml += `</div>`;

    // readme 卡片（支持数组）
    const readmeCardsHtml = generateReadmeCards(series.readme, 'varietyList', cid, si);

    const full = `
        <div class="back-bar"><button class="back-btn" onclick="backToSeriesList()">← 返回版别</button></div>
        <div class="list-panel">
            <div class="panel-header">
                <h2>${escapeHtml(series.seriesName)}</h2>
                <p>${formatYear(series.year)} · 共 ${varieties.length} 个品种</p>
            </div>
            ${readmeCardsHtml}
            ${itemsHtml}
        </div>`;
    document.getElementById("app").innerHTML = full;
    
    if (restore) {
        restoreScroll("varietyList_" + cid + "_" + si);
    }
    
    const switchBtn = document.getElementById('switchToCoinsBtn');
    if (switchBtn) {
        switchBtn.style.display = 'none';
    }
}

function selectVariety(cid, si, vi) {
    saveScroll("varietyList_" + cid + "_" + si);
    renderCopyListFromVariety(cid, si, vi, false);
}

function renderCopyListFromVariety(cid, si, vi, restore = false) {
    fromSearchResult = false;
    if (!restore) {
        window.scrollTo(0, 0);
    }
    currentView = "copyList";
    currentCategoryId = cid;
    currentSeries = { cid, si, vi };

    const cat = banknotesData[cid];
    if (!cat || !cat.series[si]) return;
    const series = cat.series[si];
    const variety = series.varieties[vi];
    const copies = variety.copies || [];

    let copiesHtml = `<div class="copy-list">`;
    // 动态序号：从1开始
    for (let ci = 0; ci < copies.length; ci++) {
        const cp = copies[ci];
        copiesHtml += `
            <div class="copy-item" onclick="selectCopyFromVariety('${cid}', ${si}, ${vi}, ${ci})">
                <div class="copy-index">#${ci + 1}</div>
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

    const readmeCardsHtml = generateReadmeCards(variety.readme, 'copyListFromVariety', cid, si, vi);

    const full = `
        <div class="back-bar">
            <button class="back-btn" onclick="backToVarietyList()">← 返回品种</button>
        </div>
        <div class="list-panel">
            <div class="panel-header">
                <h2>${escapeHtml(variety.varietyName)}</h2>
                <p>${formatYear(series.year)} · 共 ${copies.length} 张</p>
            </div>
            ${readmeCardsHtml}
            ${copiesHtml}
        </div>`;
    document.getElementById("app").innerHTML = full;
    
    if (restore) {
        restoreScroll("copyList_" + cid + "_" + si + "_" + vi);
    }
    
    const switchBtn = document.getElementById('switchToCoinsBtn');
    if (switchBtn) {
        switchBtn.style.display = 'none';
    }
}

function selectCopyFromVariety(cid, si, vi, ci) {
    if (currentView === 'searchResult') {
        fromSearchResult = true;
        saveScroll("searchResult");
        lastSearchParams = {
            keyword: currentSearchKeyword,
            type: currentSearchType
        };
    } else {
        fromSearchResult = false;
        saveScroll("copyList_" + cid + "_" + si + "_" + vi);
    }
    renderDetailFromVariety(cid, si, vi, ci);
}

async function renderDetailFromVariety(cid, si, vi, ci) {
    currentView = "detail";
    currentCategoryId = cid;
    currentSeries = { cid, si, vi, ci };

    const cat = banknotesData[cid];
    if (!cat || !cat.series[si]) return;
    const series = cat.series[si];
    const variety = series.varieties[vi];
    const cp = variety.copies[ci];
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
        
        const displayValue = field.key === 'signature' ? String(value) : escapeHtml(String(value));
        
        detailGridHtml += `
            <div class="detail-field">
                <label>${field.label}</label>
                <div>${displayValue}</div>
            </div>`;
    }
    
    let remarkHtml = '';
    if (cp.remark) {
        const remarkContent = await processRemarkContent(cp.remark);
        if (remarkContent) {
            remarkHtml = `<div class="remark-box"><label style="font-size:0.8rem; color:#9a7a5b; font-weight:bold;">备注</label><div style="margin-top:0.4rem; font-size:0.9rem; line-height:1.6;">${remarkContent}</div></div>`;
        }
    }

    const detailHtml = `
        <div class="back-bar">
            <button class="back-btn" onclick="backToCopyListFromVariety()">← 返回藏品列表</button>
        </div>
        <div class="detail-panel">
            <div class="detail-header">
                <h3>${escapeHtml(series.seriesName)} - ${escapeHtml(variety.varietyName)}</h3>
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

            ${remarkHtml}
        </div>`;
    document.getElementById("app").innerHTML = detailHtml;
    window.scrollTo(0, 0);
    
    const switchBtn = document.getElementById('switchToCoinsBtn');
    if (switchBtn) {
        switchBtn.style.display = 'none';
    }
}

function renderCopyList(cid, si, restore = false) {
    fromSearchResult = false;
    if (!restore) {
        window.scrollTo(0, 0);
    }
    currentView = "copyList";
    currentCategoryId = cid;
    currentSeries = { cid, si, ci: null };

    const cat = banknotesData[cid];
    if (!cat || !cat.series || !cat.series[si]) return;
    const series = cat.series[si];
    const copies = series.copies || [];

    let copiesHtml = `<div class="copy-list">`;
    // 动态序号：从1开始
    for (let ci = 0; ci < copies.length; ci++) {
        const cp = copies[ci];
        copiesHtml += `
            <div class="copy-item" onclick="selectCopy('${cid}', ${si}, ${ci})">
                <div class="copy-index">#${ci + 1}</div>
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

    const readmeCardsHtml = generateReadmeCards(series.readme, 'copyList', cid, si);

    const full = `
        <div class="back-bar">
            <button class="back-btn" onclick="backToSeries()">← 返回品种</button>
        </div>
        <div class="list-panel">
            <div class="panel-header">
                <h2>${escapeHtml(series.seriesName)}</h2>
                <p>${formatYear(series.year)} · 共 ${copies.length} 张</p>
            </div>
            ${readmeCardsHtml}
            ${copiesHtml}
        </div>`;
    document.getElementById("app").innerHTML = full;
    if (restore) {
        restoreScroll("copyList_" + cid + "_" + si);
    }
    
    const switchBtn = document.getElementById('switchToCoinsBtn');
    if (switchBtn) {
        switchBtn.style.display = 'none';
    }
}

async function renderDetail(cid, si, ci) {
    currentView = "detail";
    currentCategoryId = cid;
    currentSeries = { cid, si, ci };

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
        
        const displayValue = field.key === 'signature' ? String(value) : escapeHtml(String(value));
        
        detailGridHtml += `
            <div class="detail-field">
                <label>${field.label}</label>
                <div>${displayValue}</div>
            </div>`;
    }
    
    let remarkHtml = '';
    if (cp.remark) {
        const remarkContent = await processRemarkContent(cp.remark);
        if (remarkContent) {
            remarkHtml = `<div class="remark-box"><label style="font-size:0.8rem; color:#9a7a5b; font-weight:bold;">备注</label><div style="margin-top:0.4rem; font-size:0.9rem; line-height:1.6;">${remarkContent}</div></div>`;
        }
    }

    const detailHtml = `
        <div class="back-bar">
            <button class="back-btn" onclick="backToCopyList()">← 返回藏品列表</button>
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

            ${remarkHtml}
        </div>`;
    document.getElementById("app").innerHTML = detailHtml;
    window.scrollTo(0, 0);
    
    const switchBtn = document.getElementById('switchToCoinsBtn');
    if (switchBtn) {
        switchBtn.style.display = 'none';
    }
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
            keyword: currentSearchKeyword,
            type: currentSearchType
        };
    } else {
        fromSearchResult = false;
        saveScroll("copyList_" + cid + "_" + si);
    }
    renderDetail(cid, si, ci);
}

// ========= readme 功能（支持数组） =========

// 从 readme 返回
// 已在上方修改为 goBackFromReadme = history.back

// 渲染 readme 详情页（新的一层）
async function renderReadmePage(readmeItem, viewType, params) {
    const title = readmeItem.title || 'Readme';
    let content = readmeItem.content;
    
    if (content && (content.startsWith('file:') || content.startsWith('LOAD:'))) {
        content = await loadExternalContent(content) || '内容加载失败';
    }
    
    currentReadmeBackInfo = {
        viewType: viewType,
        params: params
    };
    
    const html = `
        <div class="back-bar">
            <button class="back-btn" onclick="goBackFromReadme()">← 返回</button>
        </div>
        <div class="readme-detail-panel">
            <div class="readme-detail-header">
                <h3>${escapeHtml(title)}</h3>
            </div>
            <div class="rich-content">
                ${content}
            </div>
        </div>
    `;
    document.getElementById("app").innerHTML = html;
    
    document.querySelectorAll('.rich-content img').forEach(img => {
        img.style.cursor = 'pointer';
        img.onclick = (e) => {
            e.stopPropagation();
            currentModalImg1 = img.src;
            openModal(0);
        };
    });
    
    currentView = "readmePage";
}

// 从系列进入 readme（品种列表页）- 带索引
function goToReadmeFromSeriesWithIndex(cid, si, readmeIndex) {
    const cat = banknotesData[cid];
    if (!cat || !cat.series[si]) return;
    const series = cat.series[si];
    const readmeList = series.readme;
    if (!readmeList) return;
    
    const readmeItem = Array.isArray(readmeList) ? readmeList[readmeIndex] : readmeList;
    if (!readmeItem) return;
    
    saveScroll("varietyList_" + cid + "_" + si);
    
    recordCurrentView();
    history.pushState({ custom: true }, '');
    
    renderReadmePage(readmeItem, 'varietyList', { cid: cid, si: si });
}

// 从系列/品种进入 readme（藏品列表页）- 带索引
function goToReadmeFromCopyListWithIndex(cid, si, vi, readmeIndex) {
    const cat = banknotesData[cid];
    if (!cat || !cat.series[si]) return;
    
    let readmeList = null;
    let viewType = 'copyList';
    let params = {};
    
    if (vi !== undefined && vi !== null) {
        const variety = cat.series[si].varieties[vi];
        readmeList = variety.readme;
        params = { cid: cid, si: si, vi: vi };
        saveScroll("copyList_" + cid + "_" + si + "_" + vi);
    } else {
        const series = cat.series[si];
        readmeList = series.readme;
        params = { cid: cid, si: si, vi: null };
        saveScroll("copyList_" + cid + "_" + si);
    }
    
    if (!readmeList) return;
    const readmeItem = Array.isArray(readmeList) ? readmeList[readmeIndex] : readmeList;
    if (!readmeItem) return;
    
    recordCurrentView();
    history.pushState({ custom: true }, '');
    
    renderReadmePage(readmeItem, viewType, params);
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

    const scrollY = window.scrollY;
    document.body.classList.add('modal-open');
    document.body.style.top = `-${scrollY}px`;

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
    
    const scrollY = parseInt(document.body.style.top || '0') * -1;
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    
    if (scrollY) {
        window.scrollTo(0, scrollY);
    }
    
    const modalImg = document.getElementById('modalImg');
    modalImg.src = '';

    if (hammerManager) {
        hammerManager.destroy();
        hammerManager = null;
    }
}

function recordCurrentView() {
    const currentViewInfo = {
        view: currentView,
        categoryId: currentCategoryId,
        series: currentSeries ? { 
            cid: currentSeries.cid, 
            si: currentSeries.si,
            vi: currentSeries.vi,
            ci: currentSeries.ci
        } : null,
        searchKeyword: currentSearchKeyword,
        searchType: currentSearchType
    };
    viewHistoryStack.push(currentViewInfo);
    
    if (viewHistoryStack.length > 50) {
        viewHistoryStack.shift();
    }
}

function goBackToPreviousView() {
    if (viewHistoryStack.length <= 1) {
        return false;
    }
    
    viewHistoryStack.pop();
    
    const previousView = viewHistoryStack[viewHistoryStack.length - 1];
    
    if (!previousView) {
        return false;
    }
    
    switch (previousView.view) {
        case 'categories':
            renderCategories(true);
            break;
        case 'seriesList':
            if (previousView.categoryId) {
                renderSeriesList(previousView.categoryId, true);
            } else {
                renderCategories(true);
            }
            break;
        case 'varietyList':
            if (previousView.series && previousView.categoryId) {
                renderVarietyList(previousView.categoryId, previousView.series.si, true);
            } else if (previousView.categoryId) {
                renderSeriesList(previousView.categoryId, true);
            } else {
                renderCategories(true);
            }
            break;
        case 'copyList':
            if (previousView.series && previousView.categoryId) {
                if (previousView.series.vi !== undefined) {
                    renderCopyListFromVariety(previousView.categoryId, previousView.series.si, previousView.series.vi, true);
                } else {
                    renderCopyList(previousView.categoryId, previousView.series.si, true);
                }
            } else if (previousView.categoryId) {
                renderSeriesList(previousView.categoryId, true);
            } else {
                renderCategories(true);
            }
            break;
        case 'readmePage':
            goBackFromReadme();
            break;
        case 'detail':
            if (currentSeries && currentSeries.cid) {
                if (currentSeries.vi !== undefined) {
                    renderCopyListFromVariety(currentSeries.cid, currentSeries.si, currentSeries.vi, true);
                } else {
                    renderCopyList(currentSeries.cid, currentSeries.si, true);
                }
            } else if (previousView.categoryId) {
                renderSeriesList(previousView.categoryId, true);
            } else {
                renderCategories(true);
            }
            break;
        case 'searchResult':
            if (previousView.searchKeyword !== undefined) {
                renderSearchResultPage(previousView.searchKeyword, previousView.searchType || 'all', false);
            } else {
                renderCategories(true);
            }
            break;
        default:
            renderCategories(true);
    }
    
    return true;
}

window.addEventListener('popstate', function(event) {
    if (isHandlingPopState) return;
    isHandlingPopState = true;
    
    event.preventDefault();
    
    const handled = goBackToPreviousView();
    
    if (!handled) {
        setTimeout(() => {
            window.history.back();
        }, 0);
    }
    
    setTimeout(() => {
        isHandlingPopState = false;
    }, 100);
});

function pushViewToHistory() {
    if (isHandlingPopState) return;
    
    recordCurrentView();
    
    history.pushState({ custom: true }, '');
}

const originalRenderCategories = renderCategories;
const originalRenderSeriesList = renderSeriesList;
const originalRenderVarietyList = renderVarietyList;
const originalRenderCopyList = renderCopyList;
const originalRenderCopyListFromVariety = renderCopyListFromVariety;
const originalRenderDetail = renderDetail;
const originalRenderDetailFromVariety = renderDetailFromVariety;
const originalRenderSearchResultPage = renderSearchResultPage;

window.renderCategories = function(restore = false) {
    const result = originalRenderCategories(restore);
    if (!restore) {
        pushViewToHistory();
    }
    return result;
};

window.renderSeriesList = function(cid, restore = false) {
    const result = originalRenderSeriesList(cid, restore);
    if (!restore) {
        pushViewToHistory();
    }
    return result;
};

window.renderVarietyList = function(cid, si, restore = false) {
    const result = originalRenderVarietyList(cid, si, restore);
    if (!restore) {
        pushViewToHistory();
    }
    return result;
};

window.renderCopyList = function(cid, si, restore = false) {
    const result = originalRenderCopyList(cid, si, restore);
    if (!restore) {
        pushViewToHistory();
    }
    return result;
};

window.renderCopyListFromVariety = function(cid, si, vi, restore = false) {
    const result = originalRenderCopyListFromVariety(cid, si, vi, restore);
    if (!restore) {
        pushViewToHistory();
    }
    return result;
};

window.renderDetail = function(cid, si, ci) {
    const result = originalRenderDetail(cid, si, ci);
    pushViewToHistory();
    return result;
};

window.renderDetailFromVariety = function(cid, si, vi, ci) {
    const result = originalRenderDetailFromVariety(cid, si, vi, ci);
    pushViewToHistory();
    return result;
};

window.renderSearchResultPage = function(rawKeyword, type, autoFocus = true) {
    const result = originalRenderSearchResultPage(rawKeyword, type, autoFocus);
    pushViewToHistory();
    return result;
};

renderCategories = window.renderCategories;
renderSeriesList = window.renderSeriesList;
renderVarietyList = window.renderVarietyList;
renderCopyList = window.renderCopyList;
renderCopyListFromVariety = window.renderCopyListFromVariety;
renderDetail = window.renderDetail;
renderDetailFromVariety = window.renderDetailFromVariety;
renderSearchResultPage = window.renderSearchResultPage;

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
    viewHistoryStack = [];
    pushViewToHistory();
    renderCategories(false);
    window.scrollTo(0, 0);
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
});
