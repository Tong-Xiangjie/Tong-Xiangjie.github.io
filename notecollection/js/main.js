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
let currentSearchKeyword = '';  // 当前搜索关键词
let currentSearchType = 'all';   // 当前搜索类型

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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// 搜索栏HTML（显示当前搜索词）
function getSearchHtml(scope, searchKeyword, searchType) {
    const scopeText = scope === 'global' ? '全局' : '当前板块';
    return `
        <div class="search-bar">
            <select class="search-select" id="searchType">
                <option value="all" ${searchType === 'all' ? 'selected' : ''}>全字段搜索（默认）</option>
                <option value="name" ${searchType === 'name' ? 'selected' : ''}>按名称搜索</option>
                <option value="version" ${searchType === 'version' ? 'selected' : ''}>按冠字号搜索</option>
                <option value="year" ${searchType === 'year' ? 'selected' : ''}>按年份搜索</option>
                <option value="agency" ${searchType === 'agency' ? 'selected' : ''}>按评级机构(ACG/PMG)</option>
                <option value="krause" ${searchType === 'krause' ? 'selected' : ''}>按克劳斯编号搜索</option>
            </select>
            <input type="text" class="search-input" id="searchInput" placeholder="请输入搜索内容..." value="${escapeHtml(searchKeyword)}">
            <button class="search-btn" id="searchBtn">搜索 ${scopeText}</button>
            <button class="reset-btn" id="resetBtn">重置</button>
        </div>
        <div class="search-tip">💡 输入关键词后点击搜索按钮</div>
    `;
}

// 执行搜索
function performSearch(keyword, type, scope) {
    if (!keyword || keyword.trim() === '') return [];
    
    const lowerKeyword = keyword.trim().toLowerCase();
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

// 渲染搜索结果页
function renderSearchResultPage(keyword, type) {
    if (!keyword || keyword.trim() === '') return;
    
    saveScroll();
    const results = performSearch(keyword, type, searchScope);
    
    let resultsHtml = '';
    if (results.length === 0) {
        resultsHtml = `<div style="padding:1rem; text-align:center;">暂无匹配结果</div>`;
    } else {
        resultsHtml = `<div class="copy-list">`;
        for (let item of results) {
            resultsHtml += `
                <div class="copy-item" onclick="selectCopy('${item.catId}', ${item.sIdx}, ${item.cIdx})">
                    <div class="copy-index">#${item.copy.copyId}</div>
                    <div class="copy-badge">${escapeHtml(item.copy.condition || '无')}</div>
                    <div class="copy-version">${escapeHtml(item.series.seriesName)}</div>
                    <div class="copy-price">${escapeHtml(item.copy.version || '无冠号')}</div>
                    <div class="copy-price">${item.series.year}</div>
                </div>`;
        }
        resultsHtml += `</div>`;
    }
    
    const fullHtml = `
        <div class="back-bar"><button class="back-btn" onclick="backToPrevious()">← 返回</button></div>
        ${getSearchHtml(searchScope, keyword, type)}
        <div class="list-panel">
            <div class="panel-header">
                <h2>🔍 搜索结果</h2>
                <p>找到 ${results.length} 个匹配 | 关键词：${escapeHtml(keyword)}</p>
            </div>
            ${resultsHtml}
        </div>
    `;
    
    document.getElementById("app").innerHTML = fullHtml;
    bindSearchButton();
    restoreScroll();
}

// 返回上一页
function backToPrevious() {
    if (currentView === 'categories') {
        renderCategories();
    } else if (currentView === 'seriesList' && currentCategoryId) {
        renderSeriesList(currentCategoryId);
    } else {
        renderCategories();
    }
}

// 绑定搜索按钮事件
function bindSearchButton() {
    const searchBtn = document.getElementById('searchBtn');
    const resetBtn = document.getElementById('resetBtn');
    const searchInput = document.getElementById('searchInput');
    const searchType = document.getElementById('searchType');
    
    if (searchBtn) {
        const newBtn = searchBtn.cloneNode(true);
        searchBtn.parentNode.replaceChild(newBtn, searchBtn);
        newBtn.addEventListener('click', function() {
            const keyword = searchInput ? searchInput.value : '';
            const type = searchType ? searchType.value : 'all';
            if (keyword && keyword.trim() !== '') {
                currentSearchKeyword = keyword;
                currentSearchType = type;
                renderSearchResultPage(keyword, type);
            } else {
                alert('请输入搜索关键词');
            }
        });
    }
    
    if (resetBtn) {
        const newReset = resetBtn.cloneNode(true);
        resetBtn.parentNode.replaceChild(newReset, resetBtn);
        newReset.addEventListener('click', function() {
            if (searchInput) searchInput.value = '';
            if (currentView === 'categories') {
                renderCategories();
            } else if (currentView === 'seriesList' && currentCategoryId) {
                renderSeriesList(currentCategoryId);
            } else {
                renderCategories();
            }
        });
    }
}

// 分类页
function renderCategories() {
    saveScroll();
    searchScope = 'global';
    currentView = "categories";
    currentCategoryId = null;
    
    let html = getSearchHtml('global', '', 'all');
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
                <div class="count-badge">📌 ${total} 张藏品</div>
            </div>`;
    }
    html += `</div>`;
    document.getElementById("app").innerHTML = html;
    bindSearchButton();
    restoreScroll();
}

// 系列列表
function renderSeriesList(cid) {
    saveScroll();
    searchScope = 'currentCategory';
    currentView = "seriesList";
    currentCategoryId = cid;
    
    const cat = banknotesData[cid];
    if (!cat || !cat.series) return;
    
    let items = `<div class="series-list">`;
    for (let idx = 0; idx < cat.series.length; idx++) {
        const s = cat.series[idx];
        const copyCount = s.copies ? s.copies.length : 0;
        items += `
            <div class="series-item" onclick="selectSeries('${cid}', ${idx})">
                <div class="series-name">${escapeHtml(s.seriesName)}</div>
                <div class="series-count">${copyCount}张</div>
                <div class="series-year">${s.year}年</div>
            </div>`;
    }
    items += `</div>`;
    
    const full = `
        <div class="back-bar"><button class="back-btn" onclick="backToCategories()">← 返回分类</button></div>
        ${getSearchHtml('currentCategory', '', 'all')}
        <div class="list-panel">
            <div class="panel-header"><h2>${cat.icon || ''} ${cat.name || cid}</h2><p>点击品种查看藏品</p></div>
            ${items}
        </div>`;
    document.getElementById("app").innerHTML = full;
    bindSearchButton();
    restoreScroll();
}

// 单张列表
function renderCopyList(cid, si) {
    saveScroll();
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
                <div class="copy-price">${cp.price}</div>
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
                <p>${series.year} 年 · 共 ${copies.length} 张</p>
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
    
    const cat = banknotesData[cid];
    if (!cat || !cat.series || !cat.series[si]) return;
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

// 弹窗功能
function openModal(index = 0) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImg');
    const imgSrc = index === 0 ? currentModalImg1 : currentModalImg2;
    modalImg.src = imgSrc;
    modal.style.display = 'flex';
    
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = scrollbarWidth + 'px';
}

function closeModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    const modalImg = document.getElementById('modalImg');
    if (modalImg) modalImg.src = '';
}

// 点击背景关闭
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

// 路由函数
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
