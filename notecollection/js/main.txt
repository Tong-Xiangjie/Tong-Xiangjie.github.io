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

let modalStartX = 0;
let modalCurrentSlide = 0;
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
            <input type="text" class="search-input" id="searchInput" placeholder="请输入搜索内容...">
            <button class="search-btn" onclick="doSearch(false)">搜索 ${scopeText}</button>
            <button class="reset-btn" onclick="resetSearch()">重置</button>
        </div>
        <div class="search-tip">💡 全字段：名称+冠号+年份+评级+克劳斯 同时匹配</div>
    `;
}

// 绑定实时搜索（防抖+不重绘）
function bindRealTimeSearch() {
    const ipt = document.getElementById('searchInput');
    const sel = document.getElementById('searchType');
    if (!ipt) return;
    ipt.oninput = () => {
        lastSearchType = sel.value;
        lastSearchKeyword = ipt.value.trim().toLowerCase();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => doSearch(true), 80);
    };
}

// 执行搜索
function doSearch(isRealTime = false) {
    const type = lastSearchType;
    const keyword = lastSearchKeyword;

    let results = [];
    const targetCats = searchScope === 'global' ? categoryOrder : [currentCategoryId];
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

    if (isRealTime) {
        updateSearchResultList(results);
    } else {
        renderSearchResult(results);
    }
}

// 仅更新结果列表，不重绘整个区域 → 键盘绝不收起
function updateSearchResultList(results) {
    const wrap = document.getElementById('searchResultWrap');
    if (!wrap) return;
    let html = '';
    if (results.length === 0) {
        html = `<div style="padding:1rem; text-align:center;">暂无匹配结果</div>`;
    } else {
        results.forEach(item => {
            html += `
                <div class="copy-item" onclick="selectCopy('${item.catId}', ${item.sIdx}, ${item.cIdx})">
                    <div class="copy-index">#${item.copy.copyId}</div>
                    <div class="copy-badge">${item.copy.condition || '无'}</div>
                    <div class="copy-version">${item.series.seriesName}</div>
                    <div class="copy-price">${item.copy.version || '无冠号'}</div>
                    <div class="copy-price">${item.series.year}</div>
                </div>`;
        });
    }
    wrap.innerHTML = html;
}

// 首次渲染搜索页
function renderSearchResult(results) {
    saveScroll();
    isFromSearch = true;
    const head = `
        <div class="back-bar"><button class="back-btn" onclick="resetSearch()">← 返回</button></div>
        ${getSearchHtml(searchScope)}
        <div class="list-panel">
            <div class="panel-header"><h2>🔍 搜索结果</h2><p>找到 ${results.length} 个匹配 | 关键词：${lastSearchKeyword||'空'}</p></div>
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
                    <div class="copy-badge">${item.copy.condition || '无'}</div>
                    <div class="copy-version">${item.series.seriesName}</div>
                    <div class="copy-price">${item.copy.version || '无冠号'}</div>
                    <div class="copy-price">${item.series.year}</div>
                </div>`;
        });
    }
    const foot = `</div></div>`;
    document.getElementById("app").innerHTML = head + list + foot;
    bindRealTimeSearch();
    restoreScroll();
}

// 重置搜索
function resetSearch() {
    isFromSearch = false;
    lastSearchKeyword = '';
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
    bindRealTimeSearch();
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
                <div class="series-name">${s.seriesName}</div>
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
    bindRealTimeSearch();
    restoreScroll();
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
                <div class="copy-badge">${cp.condition || '无评级'}</div>
                <div class="copy-version">${cp.version || '无冠号'}</div>
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
                <h2>${series.seriesName}</h2>
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
                <h3>${series.seriesName}</h3>
                <div style="color:#8b6b4f; font-size:0.9rem;">${cp.version || '无冠号'}</div>
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
                <div class="detail-field">
                    <label>冠字号码</label>
                    <div>${cp.version || '—'}</div>
                </div>
                <div class="detail-field">
                    <label>发行银行</label>
                    <div>${cp.bank || '—'}</div>
                </div>
                <div class="detail-field">
                    <label>发行年份</label>
                    <div>${series.year || '—'}</div>
                </div>
                <div class="detail-field">
                    <label>评级分数</label>
                    <div>${cp.condition || '—'}</div>
                </div>
                <div class="detail-field">
                    <label>购入价格</label>
                    <div>${cp.price || '—'}</div>
                </div>
                <div class="detail-field">
                    <label>购入日期</label>
                    <div>${cp.purchaseDate || '—'}</div>
                </div>
                <div class="detail-field">
                    <label>克劳斯编号</label>
                    <div>${cp.krause || '—'}</div>
                </div>
                <div class="detail-field">
                    <label>藏品编号</label>
                    <div>#${cp.copyId}</div>
                </div>
            </div>

            ${cp.remark ? `
            <div class="remark-box">
                <label style="font-size:0.8rem; color:#9a7a5b; font-weight:bold;">备注</label>
                <div style="margin-top:0.4rem; font-size:0.9rem; line-height:1.6;">${cp.remark}</div>
            </div>` : ''}
        </div>`;

    document.getElementById("app").innerHTML = detailHtml;
    restoreScroll();
}

// 弹窗滑动 + 缩放
function openModal(index = 0) {
    modalCurrentSlide = index;
    const modal = document.getElementById('imageModal');
    const img1 = document.getElementById('modalImg1');
    const img2 = document.getElementById('modalImg2');
    img1.src = currentModalImg1;
    img2.src = currentModalImg2;
    modal.style.display = 'flex';
    updateModalSlider();
    document.body.style.overflow = 'hidden';
}

function updateModalSlider() {
    const ms = document.getElementById('modalSlider');
    ms.style.transform = `translateX(-${modalCurrentSlide * 100}vw)`;
}

document.getElementById('imageModal').addEventListener('touchstart', (e) => {
    modalStartX = e.touches[0].clientX;
});

document.getElementById('imageModal').addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - modalStartX;
    if (dx > 40) modalCurrentSlide = Math.max(0, modalCurrentSlide - 1);
    if (dx < -40) modalCurrentSlide = Math.min(1, modalCurrentSlide + 1);
    updateModalSlider();
});

document.getElementById('imageModal').addEventListener('click', (e) => {
    if (e.target.tagName !== 'IMG') closeModal();
});

function closeModal() {
    document.getElementById('imageModal').style.display = 'none';
    document.body.style.overflow = '';
}

// 路由
function selectCategory(cid) { renderSeriesList(cid); }
function backToCategories() { renderCategories(); }
function backToSeries(cid) { renderSeriesList(cid); }
function selectSeries(cid, si) { renderCopyList(cid, si); }
function backToCopyList(cid, si) { renderCopyList(cid, si); }
function selectCopy(cid, si, ci) { renderDetail(cid, si, ci); }

// 初始化
window.addEventListener('DOMContentLoaded', renderCategories);
document.addEventListener('keydown', e => e.key === 'Escape' && closeModal());