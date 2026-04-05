// 合并所有数据
const banknotesData = {
    commemorative: commemorativeData,
    hk: hkData,
    macau: macauData,
    taiwan: taiwanData,
    rmb2: rmb2Data,
    rmb3: rmb3Data,
    rmb4: rmb4Data,
    rmb5: rmb5Data,
    fec: fecData,
    japan: japanData
};

const categoryOrder = ["commemorative", "hk", "macau", "taiwan", "rmb2", "rmb3", "rmb4", "rmb5", "fec", "japan"];

let currentView = "categories";
let currentCategoryId = null;
let currentSeries = null;
let scrollMemory = {};

let searchScope = 'global';
let currentSearchKeyword = '';
let currentSearchType = 'all';

// 搜索模式：'click' 或 'realtime'，默认点击模式
let searchMode = 'click';

let currentModalImg1 = '';
let currentModalImg2 = '';

// 缩放相关变量
let hammerManager = null;
let currentScale = 1;
let currentX = 0;
let currentY = 0;

// 克劳斯前缀常量
const KRAUSE_PREFIX = 'Pick# ';

// ========== 滚动位置保存和恢复 ==========
function saveScroll(key) {
    scrollMemory[key] = window.scrollY;
}

function restoreScroll(key) {
    if (scrollMemory[key] !== undefined && scrollMemory[key] !== null) {
        setTimeout(() => {
            window.scrollTo(0, scrollMemory[key]);
        }, 50);
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

// 年份格式化（加"年"字）
function formatYear(year) {
    if (year === undefined || year === null) return '—';
    return year + '年';
}

// 格式化克劳斯编码显示
function formatKrause(krause) {
    if (krause && krause !== '') {
        return `Pick# ${krause}`;
    }
    return `Pick#`;
}

// 从输入框获取实际搜索关键词
function getActualKeyword(inputValue, searchType) {
    if (searchType === 'krause') {
        if (inputValue.startsWith(KRAUSE_PREFIX)) {
            return inputValue.substring(KRAUSE_PREFIX.length).trim();
        }
        return inputValue.trim();
    }
    return inputValue.trim();
}

// 获取输入框显示的值
function getDisplayValue(keyword, searchType) {
    if (searchType === 'krause' && keyword !== '') {
        if (!keyword.startsWith(KRAUSE_PREFIX)) {
            return KRAUSE_PREFIX + keyword;
        }
    }
    return keyword;
}

// 执行搜索
function performSearch(rawKeyword, type, scope) {
    const keyword = getActualKeyword(rawKeyword, type);
    if (!keyword || keyword === '') return [];

    const lowerKeyword = keyword.toLowerCase();
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
                let match = false;

                switch(type) {
                    case 'all':
                        const searchText = `${series.seriesName} ${copy.version || ''} ${series.year} ${copy.condition || ''} ${copy.krause || ''}`.toLowerCase();
                        match = searchText.includes(lowerKeyword);
                        break;
                    case 'name':
                        match = series.seriesName.toLowerCase().includes(lowerKeyword);
                        break;
                    case 'version':
                        match = (copy.version || '').toLowerCase().includes(lowerKeyword);
                        break;
                    case 'year':
                        match = String(series.year).toLowerCase().includes(lowerKeyword);
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

    return results;
}

// 更新搜索结果列表（实时模式用，不重绘页面）
function updateSearchResultList(results) {
    const wrap = document.getElementById('searchResultWrap');
    const countSpan = document.getElementById('resultCount');
    if (!wrap) return;

    let html = '';
    if (results.length === 0) {
        html = `<div style="padding:1rem; text-align:center;">暂无匹配结果</div>`;
    } else {
        for (let item of results) {
            const krauseDisplay = formatKrause(item.copy.krause);
            html += `
                <div class="copy-item" onclick="selectCopy('${item.catId}', ${item.sIdx}, ${item.cIdx})">
                    <div class="copy-index">#${item.copy.copyId}</div>
                    <div class="copy-badge">${escapeHtml(item.copy.condition || '无')}</div>
                    <div class="copy-version">${escapeHtml(item.series.seriesName)}</div>
                    <div class="copy-price">${escapeHtml(item.copy.version || '无冠号')}</div>
                    <div class="copy-price">${formatYear(item.series.year)}</div>
                    <div class="copy-price">${escapeHtml(krauseDisplay)}</div>
                </div>`;
        }
    }
    wrap.innerHTML = html;
    if (countSpan) {
        countSpan.innerText = results.length;
    }
}

// 渲染搜索结果页（点击模式用）
function renderSearchResultPage(rawKeyword, type, isRealtime = false) {
    const keyword = getActualKeyword(rawKeyword, type);
    if (!keyword || keyword === '') return;

    if (!isRealtime) {
        saveScroll(currentView + "_search");
    }

    const results = performSearch(rawKeyword, type, searchScope);

    let resultsHtml = '';
    if (results.length === 0) {
        resultsHtml = `<div style="padding:1rem; text-align:center;">暂无匹配结果</div>`;
    } else {
        resultsHtml = `<div class="copy-list" id="searchResultWrap">`;
        for (let item of results) {
            const krauseDisplay = formatKrause(item.copy.krause);
            resultsHtml += `
                <div class="copy-item" onclick="selectCopy('${item.catId}', ${item.sIdx}, ${item.cIdx})">
                    <div class="copy-index">#${item.copy.copyId}</div>
                    <div class="copy-badge">${escapeHtml(item.copy.condition || '无')}</div>
                    <div class="copy-version">${escapeHtml(item.series.seriesName)}</div>
                    <div class="copy-price">${escapeHtml(item.copy.version || '无冠号')}</div>
                    <div class="copy-price">${formatYear(item.series.year)}</div>
                    <div class="copy-price">${escapeHtml(krauseDisplay)}</div>
                </div>`;
        }
        resultsHtml += `</div>`;
    }

    const modeIcon = searchMode === 'click' ? '□' : '■';
    const modeText = searchMode === 'click' ? '点击搜索' : '实时搜索';
    const placeholderText = searchScope === 'global' ? '在全局搜索' : '在当前板块搜索';
    const displayValue = getDisplayValue(rawKeyword, type);

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
            <span id="modeToggle" style="cursor:pointer; font-size:1.2rem; padding:0 8px;" title="切换搜索模式">${modeIcon}</span>
            <button class="reset-btn" id="resetBtn">重置</button>
        </div>
        <div class="search-tip" id="searchTip">当前模式：${modeText} | 点击“${modeIcon}”可切换</div>
        <div class="list-panel">
            <div class="panel-header">
                <h2>搜索结果</h2>
                <p>找到 <span id="resultCount">${results.length}</span> 个匹配 | 关键词：${escapeHtml(keyword)}</p>
            </div>
            ${resultsHtml}
        </div>
    `;

    document.getElementById("app").innerHTML = fullHtml;
    bindSearchEvents();

    if (!isRealtime) {
        restoreScroll(currentView + "_search");
    }
}

// 返回上一页
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

// 重置搜索（只清空搜索框，完全不清空搜索类型）
function resetSearchAndBack() {
    // 只清空搜索关键词，保留搜索类型
    currentSearchKeyword = '';
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    
    backToPrevious();
}

// 处理克劳斯输入框的前缀保护
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

// 绑定搜索事件
function bindSearchEvents() {
    const searchBtn = document.getElementById('searchBtn');
    const resetBtn = document.getElementById('resetBtn');
    const modeToggle = document.getElementById('modeToggle');
    const searchInput = document.getElementById('searchInput');
    const searchType = document.getElementById('searchType');
    const searchTip = document.getElementById('searchTip');

    if (!searchInput) return;

    // 移除旧的实时输入事件
    if (searchInput._realtimeHandler) {
        searchInput.removeEventListener('input', searchInput._realtimeHandler);
        searchInput._realtimeHandler = null;
    }

    let realtimeTimer = null;

    // 实时搜索处理函数
    const handleRealtimeInput = function(e) {
        const rawKeyword = searchInput.value;
        const type = searchType ? searchType.value : 'all';
        
        currentSearchKeyword = rawKeyword;
        currentSearchType = type;
        
        if (realtimeTimer) clearTimeout(realtimeTimer);
        realtimeTimer = setTimeout(() => {
            const actualKeyword = getActualKeyword(rawKeyword, type);
            if (actualKeyword && actualKeyword !== '') {
                const results = performSearch(rawKeyword, type, searchScope);
                updateSearchResultList(results);
            } else if (rawKeyword === '' || actualKeyword === '') {
                backToPrevious();
            }
        }, 300);
    };

    // 搜索类型变化时的处理
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
    }
    
    setupKrauseInputProtection(searchInput, searchType);
    
    // 根据模式设置
    if (searchMode === 'realtime') {
        // 实时模式：绑定输入事件，禁用搜索按钮
        searchInput.addEventListener('input', handleRealtimeInput);
        searchInput._realtimeHandler = handleRealtimeInput;
        if (searchBtn) {
            searchBtn.disabled = true;
            searchBtn.style.opacity = '0.5';
            searchBtn.style.cursor = 'not-allowed';
        }
    } else {
        // 点击模式：移除输入事件，启用搜索按钮
        searchInput.removeEventListener('input', handleRealtimeInput);
        if (searchBtn) {
            searchBtn.disabled = false;
            searchBtn.style.opacity = '1';
            searchBtn.style.cursor = 'pointer';
        }
    }

    // 搜索按钮（点击模式时触发）
    if (searchBtn) {
        const newBtn = searchBtn.cloneNode(true);
        searchBtn.parentNode.replaceChild(newBtn, searchBtn);
        newBtn.addEventListener('click', function() {
            if (searchMode === 'click') {
                const rawKeyword = searchInput.value;
                const type = searchType ? searchType.value : 'all';
                const actualKeyword = getActualKeyword(rawKeyword, type);
                if (actualKeyword && actualKeyword !== '') {
                    currentSearchKeyword = rawKeyword;
                    currentSearchType = type;
                    renderSearchResultPage(rawKeyword, type, false);
                } else {
                    alert('请输入搜索关键词');
                }
            }
        });
    }

    // 模式切换图标
    if (modeToggle) {
        const newToggle = modeToggle.cloneNode(true);
        modeToggle.parentNode.replaceChild(newToggle, modeToggle);
        newToggle.addEventListener('click', function() {
            searchMode = searchMode === 'click' ? 'realtime' : 'click';
            
            const modeIcon = searchMode === 'click' ? '□' : '■';
            const modeText = searchMode === 'click' ? '点击搜索' : '实时搜索';
            newToggle.textContent = modeIcon;
            if (searchTip) {
                searchTip.innerHTML = `当前模式：${modeText} | 点击“${modeIcon}”可切换`;
            }
            
            // 重新绑定事件
            bindSearchEvents();
        });
    }

    // 重置按钮（只清空搜索框，不清空搜索类型）
    if (resetBtn) {
        const newReset = resetBtn.cloneNode(true);
        resetBtn.parentNode.replaceChild(newReset, resetBtn);
        newReset.addEventListener('click', function() {
            // 只清空搜索框内容，不清空搜索类型
            currentSearchKeyword = '';
            if (searchInput) {
                searchInput.value = '';
            }
            backToPrevious();
        });
    }
}

// 分类页
function renderCategories(restore = false) {
    if (!restore) {
        saveScroll("categories");
    }
    searchScope = 'global';
    currentView = "categories";
    currentCategoryId = null;

    const modeIcon = searchMode === 'click' ? '□' : '■';
    const modeText = searchMode === 'click' ? '点击搜索' : '实时搜索';
    const placeholderText = '在全局搜索';
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
            <input type="text" class="search-input" id="searchInput" placeholder="${placeholderText}" value="${escapeHtml(displayValue)}" autocomplete="off">
            <button class="search-btn" id="searchBtn">搜索</button>
            <span id="modeToggle" style="cursor:pointer; font-size:1.2rem; padding:0 8px;" title="切换搜索模式">${modeIcon}</span>
            <button class="reset-btn" id="resetBtn">重置</button>
        </div>
        <div class="search-tip" id="searchTip">当前模式：${modeText} | 点击“${modeIcon}”可切换</div>
    `;
    html += `<div class="category-grid">`;
    for (let id of categoryOrder) {
        const cat = banknotesData[id];
        if (!cat) continue;
        let total = 0;
        if (cat.series) {
            for (let s of cat.series) {
                total += s.copies ? s.copies.length : 0;
            }
        }
        html += `
            <div class="category-card" onclick="selectCategory('${id}')">
                <div class="category-icon">${cat.icon || '📷'}</div>
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

// 系列列表
function renderSeriesList(cid, restore = false) {
    if (!restore) {
        saveScroll("seriesList_" + cid);
    }
    searchScope = 'currentCategory';
    currentView = "seriesList";
    currentCategoryId = cid;

    const cat = banknotesData[cid];
    if (!cat || !cat.series) return;

    const modeIcon = searchMode === 'click' ? '□' : '■';
    const modeText = searchMode === 'click' ? '点击搜索' : '实时搜索';
    const placeholderText = '在当前板块搜索';
    const displayValue = getDisplayValue(currentSearchKeyword, currentSearchType);

    let items = `<div class="series-list">`;
    for (let idx = 0; idx < cat.series.length; idx++) {
        const s = cat.series[idx];
        const copyCount = s.copies ? s.copies.length : 0;
        items += `
            <div class="series-item" onclick="selectSeries('${cid}', ${idx})">
                <div class="series-name">${escapeHtml(s.seriesName)}</div>
                <div class="series-count">${copyCount}张</div>
                <div class="series-year">${formatYear(s.year)}</div>
            </div>`;
    }
    items += `</div>`;

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
            <input type="text" class="search-input" id="searchInput" placeholder="${placeholderText}" value="${escapeHtml(displayValue)}" autocomplete="off">
            <button class="search-btn" id="searchBtn">搜索</button>
            <span id="modeToggle" style="cursor:pointer; font-size:1.2rem; padding:0 8px;" title="切换搜索模式">${modeIcon}</span>
            <button class="reset-btn" id="resetBtn">重置</button>
        </div>
        <div class="search-tip" id="searchTip">当前模式：${modeText} | 点击“${modeIcon}”可切换</div>
        <div class="list-panel">
            <div class="panel-header"><h2>${cat.icon || ''} ${cat.name || cid}</h2><p>点击品种查看藏品</p></div>
            ${items}
        </div>`;
    document.getElementById("app").innerHTML = full;
    bindSearchEvents();

    if (restore) {
        restoreScroll("seriesList_" + cid);
    }
}

// 单张列表
function renderCopyList(cid, si, restore = false) {
    if (!restore) {
        saveScroll("copyList_" + cid + "_" + si);
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
        const krauseDisplay = formatKrause(cp.krause);
        copiesHtml += `
            <div class="copy-item" onclick="selectCopy('${cid}', ${si}, ${ci})">
                <div class="copy-index">#${cp.copyId}</div>
                <div class="copy-badge">${escapeHtml(cp.condition || '无评级')}</div>
                <div class="copy-version">${escapeHtml(cp.version || '无冠号')}</div>
                <div class="copy-price">${formatYear(series.year)}</div>
                <div class="copy-price">${escapeHtml(krauseDisplay)}</div>
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

// 详情页
function renderDetail(cid, si, ci) {
    saveScroll("copyList_" + cid + "_" + si);

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
    const krauseDisplay = formatKrause(cp.krause);

    const detailHtml = `
        <div class="back-bar">
            <button class="back-btn" onclick="backToCopyList('${cid}', ${si})">← 返回藏品列表</button>
        </div>
        <div class="detail-panel">
            <div class="detail-header">
                <h3>${escapeHtml(series.seriesName)}</h