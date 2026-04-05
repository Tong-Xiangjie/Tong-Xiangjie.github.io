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
let lastSearchType = "all";
let lastSearchKeyword = "";
let isFromSearch = false;
let searchTimer = null;

let currentModalImg1 = '';
let currentModalImg2 = '';

// 滚动记忆
function saveScroll() {
    const key = currentView + "_" + (currentCategoryId || "") + "_" + (currentSeries?.cid || "") + "_" + (currentSeries?.si || "");
    scrollMemory[key] = window.scrollY;
}
function restoreScroll() {
    const key = currentView + "_" + (currentCategoryId || "") + "_" + (currentSeries?.cid || "") + "_" + (currentSeries?.si || "");
    setTimeout(() => window.scrollTo(0, scrollMemory[key] || 0), 0);
}

// 辅助函数：转义HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// 搜索栏结构
function getSearchHtml(scope) {
    const scopeText = scope === 'global' ? '全局' : '当前板块';
    return `
        <div class="search-bar">
            <select class="search-select" id="searchType">
                <option value="all" selected>全字段搜索（默认）</option>
                <option value="name">按名称搜索</option>
                <option value="version">按冠字号搜索</option>
                <option value="year">按年份搜索</option>
                <option value="agency">按评级机构(ACG/PMG)</option>
                <option value="krause">按克劳斯编号搜索</option>
            </select>
            <input type="text" class="search-input" id="searchInput" placeholder="请输入搜索内容..." value="${escapeHtml(lastSearchKeyword)}">
            <button class="search-btn" id="searchBtn">搜索 ${scopeText}</button>
            <button class="reset-btn" id="resetBtn">重置</button>
        </div>
        <div class="search-tip">💡 实时搜索，输入即显示结果</div>
    `;
}

// 执行搜索（返回结果数组）
function performSearch(keyword, type, scope) {
    if (!keyword) return [];
    let results = [];
    const targetCats = scope === 'global' ? categoryOrder : [currentCategoryId];
    targetCats.forEach(cid => {
        const cat = banknotesData[cid];
        if (!cat) return;
        cat.series.forEach((s, si) => {
            s.copies.forEach((cp, ci) => {
                let match = false;
                if (type === 'all') {
                    const txt = `${s.seriesName} ${cp.version||''} ${s.year} ${cp.condition||''} ${cp.krause||''}`.toLowerCase();
                    match = txt.includes(keyword);
                } else {
                    switch(type) {
                        case 'name': match = s.seriesName.toLowerCase().includes(keyword); break;
                        case 'version': match = (cp.version||'').toLowerCase().includes(keyword); break;
                        case 'year': match = String(s.year).toLowerCase().includes(keyword); break;
                        case 'agency': match = (cp.condition||'').toLowerCase().includes(keyword); break;
                        case 'krause': match = (cp.krause||'').toLowerCase().includes(keyword); break;
                    }
                }
                if (match) results.push({ catId: cid, sIdx: si, cIdx: ci, series: s, copy: cp });
            });
        });
    });
    return results;
}

// 更新搜索结果列表（不重绘页面）
function updateSearchResultList(results, keyword) {
    const wrap = document.getElementById('searchResultWrap');
    const countSpan = document.getElementById('resultCount');
    if (!wrap) return;
    
    let html = '';
    if (results.length === 0) {
        html = `<div style="padding:1rem; text-align:center;">暂无匹配结果</div>`;
    } else {
        results.forEach(item => {
            html += `
                <div class="copy-item" onclick="selectCopy('${item.catId}', ${item.sIdx}, ${item.cIdx})">
                    <div class="copy-index">#${item.copy.copyId}</div>
                    <div class="copy-badge">${escapeHtml(item.copy.condition || '无')}</div>
                    <div class="copy-version">${escapeHtml(item.series.seriesName)}</div>
                    <div class="copy-price">${escapeHtml(item.copy.version || '无冠号')}</div>
                    <div class="copy-price">${item.series.year}</div>
                </div>`;
        });
    }
    wrap.innerHTML = html;
    if (countSpan) {
        countSpan.innerText = results.length;
    }
}

// 防抖函数
function debounce(func, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}

// 重置搜索
function resetSearch() {
    isFromSearch = false;
    lastSearchKeyword = '';
    lastSearchType = 'all';
    
    const ipt = document.getElementById('searchInput');
    if (ipt) ipt.value = '';
    
    if (currentView === 'seriesList' && currentCategoryId) {
        renderSeriesList(currentCategoryId);
    } else {
        renderCategories();
    }
}

// 分类页
function renderCategories() {
    saveScroll();
    searchScope = 'global';
    currentView = "categories";
    isFromSearch = false;
    let html = getSearchHtml('global');
    html += `<div class="category-grid">`;
    for (let id of categoryOrder) {
        const cat = banknotesData[id];
        if (!cat) continue;
        let total = 0;
        cat.series.forEach(s => total += s.copies.length);
        html += `
            <div class="category-card" onclick="selectCategory('${id}')">
                <div class="category-icon">${cat.icon}</div>
                <h3>${cat.name}</h3>
                <p>${cat.desc}</p>
                <div class="count-badge">📌 ${total} 张藏品</div>
            </div>`;
    }
    html += `</div>`;
    document.getElementById("app").innerHTML = html;
    bindSearchEvents();
    restoreScroll();
}

// 系列列表
function renderSeriesList(cid) {
    saveScroll();
    searchScope = 'currentCategory';
    currentView = "seriesList";
    currentCategoryId = cid;
    isFromSearch = false;
    const cat = banknotesData[cid];
    let items = `<div class="series-list">`;
    cat.series.forEach((s, idx) => {
        items += `
            <div class="series-item" onclick="selectSeries('${cid}', ${idx})">
                <div class="series-name">${escapeHtml(s.seriesName)}</div>
                <div class="series-count">${s.copies.length}张</div>
                <div class="series-year">${s.year}年</div>
            </div>`;
    });
    items += `</div>`;
    const full = `
        <div class="back-bar"><button class="back-btn" onclick="backToCategories()">← 返回分类</button></div>
        ${getSearchHtml('currentCategory')}
        <div class="list-panel">
            <div class="panel-header"><h2>${cat.icon} ${cat.name}</h2><p>点击品种查看藏品</p></div>
            ${items}
        </div>`;
    document.getElementById("app").innerHTML = full;
    bindSearchEvents();
    restoreScroll();
}

// 搜索结果页
function renderSearchResultPage() {
    const keyword = lastSearchKeyword;
    const type = lastSearchType;
    
    if (!keyword) return;
    
    saveScroll();
    isFromSearch = true;
    const results = performSearch(keyword, type, searchScope);
    
    const head = `
        <div class="back-bar"><button class="back-btn" onclick="resetSearch()">← 返回</button></div>
        <div class="search-bar">
            <select class="search-select" id="searchType">
                <option value="all" ${type === 'all' ? 'selected' : ''}>全字段搜索（默认）</option>
                <option value="name" ${type === 'name' ? 'selected' : ''}>按名称搜索</option>
                <option value="version" ${type === 'version' ? 'selected' : ''}>按冠字号搜索</option>
                <option value="year" ${type === 'year' ? 'selected' : ''}>按年份搜索</option>
                <option value="agency" ${type === 'agency' ? 'selected' : ''}>按评级机构(ACG/PMG)</option>
                <option value="krause" ${type === 'krause' ? 'selected' : ''}>按克劳斯编号搜索</option>
            </select>
            <input type="text" class="search-input" id="searchInput" placeholder="请输入搜索内容..." value="${escapeHtml(keyword)}">
            <button class="search-btn" id="searchBtn">搜索</button>
            <button class="reset-btn" id="resetBtn">重置</button>
        </div>
        <div class="search-tip">💡 实时搜索，输入即显示结果</div>
        <div class="list-panel">
            <div class="panel-header"><h2>🔍 搜索结果</h2><p>找到 <span id="resultCount">${results.length}</span> 个匹配 | 关键词：${escapeHtml(keyword)}</p></div>
            <div class="copy-list" id="searchResultWrap">
    `;
    let list = '';
    if (results.length === 0) {
        list = `<div style="padding:1rem; text-align:center;">暂无匹配结果</div>`;
    } else {
        results.forEach(item => {
            list += `
                <div class="copy-item" onclick="selectCopy('${item.catId}', ${item.sIdx}, ${item.cIdx})">
                    <div class="copy-index">#${item.copy.copyId}</div>
                    <div class="copy-badge">${escapeHtml(item.copy.condition || '无')}</div>
                    <div class="copy-version">${escapeHtml(item.series.seriesName)}</div>
                    <div class="copy-price">${escapeHtml(item.copy.version || '无冠号')}</div>
                    <div class="copy-price">${item.series.year}</div>
                </div>`;
        });
    }
    const foot = `</div></div>`;
    document.getElementById("app").innerHTML = head + list + foot;
    bindRealtimeSearchOnly();
    restoreScroll();
}

// 搜索结果页的实时搜索（只更新列表）
function bindRealtimeSearchOnly() {
    const ipt = document.getElementById('searchInput');
    const sel = document.getElementById('searchType');
    if (!ipt) return;
    
    const newIpt = ipt.cloneNode(true);
    ipt.parentNode.replaceChild(newIpt, ipt);
    const newSel = sel ? sel.cloneNode(true) : null;
    if (newSel && sel) sel.parentNode.replaceChild(newSel, sel);
    
    const finalIpt = document.getElementById('searchInput');
    const finalSel = document.getElementById('searchType');
    
    const handleInput = debounce(function() {
        const keyword = finalIpt.value.trim().toLowerCase();
        const type = finalSel ? finalSel.value : 'all';
        
        lastSearchKeyword = keyword;
        lastSearchType = type;
        
        if (keyword === '') {
            const wrap = document.getElementById('searchResultWrap');
            const countSpan = document.getElementById('resultCount');
            if (wrap) wrap.innerHTML = `<div style="padding:1rem; text-align:center; color:#999;">请输入搜索关键词</div>`;
            if (countSpan) countSpan.innerText = '0';
            return;
        }
        
        const results = performSearch(keyword, type, searchScope);
        updateSearchResultList(results, keyword);
    }, 150);
    
    finalIpt.addEventListener('input', handleInput);
    
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        const newBtn = searchBtn.cloneNode(true);
        searchBtn.parentNode.replaceChild(newBtn, searchBtn);
        newBtn.addEventListener('click', function() {
            const keyword = finalIpt.value.trim().toLowerCase();
            const type = finalSel ? finalSel.value : 'all';
            if (keyword) {
                lastSearchKeyword = keyword;
                lastSearchType = type;
                renderSearchResultPage();
            }
        });
    }
    
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        const newReset = resetBtn.cloneNode(true);
        resetBtn.parentNode.replaceChild(newReset, resetBtn);
        newReset.addEventListener('click', function() { resetSearch(); });
    }
}

// 普通页面的搜索事件
function bindSearchEvents() {
    const ipt = document.getElementById('searchInput');
    const sel = document.getElementById('searchType');
    const searchBtn = document.getElementById('searchBtn');
    const resetBtn = document.getElementById('resetBtn');
    
    if (!ipt) return;
    
    const handleRealTime = debounce(function() {
        const keyword = ipt.value.trim().toLowerCase();
        const type = sel ? sel.value : 'all';
        
        lastSearchKeyword = keyword;
        lastSearchType = type;
        
        if (keyword === '') {
            if (currentView === 'categories') {
                renderCategories();
            } else if (currentView === 'seriesList' && currentCategoryId) {
                renderSeriesList(currentCategoryId);
            }
            return;
        }
        
        renderSearchResultPage();
    }, 300);
    
    ipt.addEventListener('input', handleRealTime);
    
    if (searchBtn) {
        const newBtn = searchBtn.cloneNode(true);
        searchBtn.parentNode.replaceChild(newBtn, searchBtn);
        newBtn.addEventListener('click', function() {
            const keyword = ipt.value.trim().toLowerCase();
            const type = sel ? sel.value : 'all';
            if (keyword) {
                lastSearchKeyword = keyword;
                lastSearchType = type;
                renderSearchResultPage();
            }
        });
    }
    
    if (resetBtn) {
        const newReset = resetBtn.cloneNode(true);
        resetBtn.parentNode.replaceChild(newReset, resetBtn);
        newReset.addEventListener('click', function() { resetSearch(); });
    }
}

// 单张列表
function renderCopyList(cid, si) {
    saveScroll();
    currentView = "copyList";
    currentCategoryId = cid;
    currentSeries = { cid, si };
    isFromSearch = false;
    const cat = banknotesData[cid];
    const series = cat.series[si];
    let copiesHtml = `<div class="copy-list">`;
    series.copies.forEach((cp, ci) => {
        copiesHtml += `
            <div class="copy-item" onclick="selectCopy('${cid}', ${si}, ${ci})">
                <div class="copy-index">#${cp.copyId}</div>
                <div class="copy-badge">${escapeHtml(cp.condition || '无评级')}</div>
                <div class="copy-version">${escapeHtml(cp.version || '无冠号')}</div>
                <div class="copy-price">${cp.price}</div>
            </div>`;
    });
    if (series.copies.length === 0) {
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
                <p>${series.year} 年 · 共 ${series.copies.length} 张</p>
            </div>
            ${copiesHtml}
        </div>`;
    document.getElementById("app").innerHTML = full;
    restoreScroll();
}

// 详情页
function renderDetail(cid, si, ci) {
    saveScroll();
    currentView = "detail";
    currentCategoryId = cid;
    currentSeries = { cid, si };
    isFromSearch = false;
    const cat = banknotesData[cid];
    const series = cat.series[si];
    const cp = series.copies[ci];
    if (!cp) return;

    currentModalImg1 = cp.img1 || '';
    currentModalImg2 = cp.img2 || '';

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
                <div class="detail-field"><label>冠字号码</label><div>${escapeHtml(cp.version || '—')}</div></div>
                <div class="detail-field"><label>发行银行</label><div>${escapeHtml(cp.bank || '—')}</div></div>
                <div class="detail-field"><label>发行年份</label><div>${series.year || '—'}</div></div>
                <div class="detail-field"><label>评级分数</label><div>${escapeHtml(cp.condition || '—')}</div></div>
                <div class="detail-field"><label>购入价格</label><div>${cp.price || '—'}</div></div>
                <div class="detail-field"><label>购入日期</label><div>${cp.purchaseDate || '—'}</div></div>
                <div class="detail-field"><label>克劳斯编号</label><div>${escapeHtml(cp.krause || '—')}</div></div>
                <div class="detail-field"><label>藏品编号</label><div>#${cp.copyId}</div></div>
            </div>

            ${cp.remark ? `<div class="remark-box"><label style="font-size:0.8rem; color:#9a7a5b; font-weight:bold;">备注</label><div style="margin-top:0.4rem; font-size:0.9rem; line-height:1.6;">${escapeHtml(cp.remark)}</div></div>` : ''}
        </div>`;
    document.getElementById("app").innerHTML = detailHtml;
    restoreScroll();
}

// ========== 弹窗功能（流畅版） ==========
function openModal(index = 0) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    const imgSrc = index === 0 ? currentModalImg1 : currentModalImg2;
    modalImg.src = imgSrc;
    modal.style.display = 'flex';
    modalImg.classList.remove('zoomed');
    
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = scrollbarWidth + 'px';
    
    const modalContent = document.getElementById('modalContent');
    if (modalContent) {
        modalContent.scrollTop = 0;
        modalContent.scrollLeft = 0;
    }
}

function closeModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    const modalImg = document.getElementById('modalImg');
    modalImg.src = '';
    modalImg.classList.remove('zoomed');
}

// 点击图片切换缩放
document.addEventListener('DOMContentLoaded', function() {
    const modalImg = document.getElementById('modalImg');
    if (modalImg) {
        modalImg.addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.toggle('zoomed');
        });
    }
    
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this || e.target.classList.contains('modal-content')) {
                closeModal();
            }
        });
    }
});

// ========== 路由函数 ==========
function selectCategory(cid) { renderSeriesList(cid); }
function backToCategories() { renderCategories(); }
function backToSeries(cid) { renderSeriesList(cid); }
function selectSeries(cid, si) { renderCopyList(cid, si); }
function backToCopyList(cid, si) { renderCopyList(cid, si); }
function selectCopy(cid, si, ci) { renderDetail(cid, si, ci); }

// 初始化
window.addEventListener('DOMContentLoaded', renderCategories);
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
});
