// ==================== settings.js ====================
// 设置页渲染

let cacheConfirmPending = false;
let cacheConfirmTimer = null;

let articleCacheConfirmPending = false;
let articleCacheConfirmTimer = null;

function renderSettingsPage() {
    const app = getRenderContainer();
    const currentTheme = localStorage.getItem('app-theme') || '#1677ff';
    const customColors = getCustomColors();
    const allStats = computeStats();
    const stats = computeStats(ratingMode);

    let html = `<div class="settings-page">`;
    html += `<h2>我的</h2>`;

    html += `<div class="settings-section">`;
    html += `<h3>藏品数量</h3>`;
    html += `<div class="stats-summary-cards">`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.total}</div><div class="stat-label">藏品总数量</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.notesCount}</div><div class="stat-label">纸币数量</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.coinsCount}</div><div class="stat-label">硬币数量</div></div>`;
    html += `<div class="stat-card"><div class="stat-num">${allStats.prices.filter(p => !p.noPrice).length}</div><div class="stat-label">已记录价格</div></div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>资金投入</h3>`;
    html += `<div class="stats-money">`;
    html += `<div class="money-row"><span class="money-label">藏品总投入</span><span class="money-value">${allStats.totalPrice.toFixed(0)}元</span></div>`;
    html += `<div class="money-row"><span class="money-label">藏品均价</span><span class="money-value">${allStats.avgPrice}元/件</span></div>`;
    html += `</div>`;

    html += `<div class="price-list-wrapper">`;
    html += `<div class="price-list-header" onclick="togglePriceList()">`;
    html += `<span>价格列表</span>`;
    html += `<div class="price-list-controls">`;
    html += `<select class="price-sort-select" id="priceSortSelect" onclick="event.stopPropagation()" onchange="onPriceSortOrFilterChange()">`;
    html += `<option value="default" selected>默认排序</option>`;
    html += `<option value="desc">从高到低</option>`;
    html += `<option value="asc">从低到高</option>`;
    html += `</select>`;
    html += `<select class="price-filter-select" id="priceFilterSelect" onclick="event.stopPropagation()" onchange="onPriceSortOrFilterChange()">`;
    html += `<option value="all">全部藏品</option>`;
    const filterCategories = buildPriceFilterCategories();
    for (const cat of filterCategories) {
        html += `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`;
    }
    html += `</select>`;
    html += `</div>`;
    html += `<span class="price-list-arrow" id="priceListArrow">▼</span>`;
    html += `</div>`;
    html += `<div class="price-list-summary" id="priceListSummary" style="display:none;"></div>`;
    html += `<div class="price-list-body" id="priceListBody">`;
    html += renderPriceListItems(allStats.prices, 'default', 'all', null);
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<div class="rating-section-header">`;
    html += `<div class="rating-tabs">`;
    html += `<span class="rating-tab ${ratingMode === 'notes' ? 'active' : ''}" data-mode="notes" onclick="switchRatingMode('notes')">纸币</span>`;
    html += `<span class="rating-tab ${ratingMode === 'coins' ? 'active' : ''}" data-mode="coins" onclick="switchRatingMode('coins')">硬币</span>`;
    html += `</div>`;
    html += `<h3>评级得分统计</h3>`;
    html += `</div>`;
    html += `<div id="ratingSection" style="transition: opacity 0.15s ease, transform 0.15s ease;">`;
    html += buildRatingHTML(stats);
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>藏品年代统计</h3>`;
    html += `<div id="yearSection" style="transition: opacity 0.15s ease, transform 0.15s ease;">`;
    html += buildYearHTML(stats);
    html += `</div>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>主题色</h3>`;
    html += `<div class="theme-colors" id="settingsThemeColors">`;
    // 预设主题色：按色相绕一圈排（蓝 → 靛 → 紫 → 玫红 → 红 → 酒红 → 铜 → 金 → 橙 → 绿 → 墨绿 → 青碧）
    // 「铜」是呼应站名「铜の币纪」特意加的。
    const presetColors = [
        '#1677ff', // 蓝（默认）
        '#2f54eb', // 靛蓝
        '#722ed1', // 紫
        '#eb2f96', // 玫红
        '#d92121', // 红
        '#b87333', // 铜
        '#ad8b00', // 金
        '#ff7d00', // 橙
        '#00b42a', // 绿
        '#237804', // 墨绿
        '#08979c'  // 青碧
    ];
    for (const color of presetColors) {
        const active = color === currentTheme ? ' active' : '';
        html += `<div class="theme-color${active}" style="background:${color}" data-color="${color}"></div>`;
    }
    html += `</div>`;

    html += `<div class="saved-colors" id="savedColorsContainer">`;
    if (customColors.length === 0) {
        html += `<span class="empty-colors-hint">还没攒下自定义颜色～</span>`;
    } else {
        for (let i = 0; i < customColors.length; i++) {
            const color = customColors[i];
            const active = color === currentTheme ? ' active' : '';
            html += `<div class="saved-color-item">`;
            html += `<div class="color-block${active}" style="background:${color}" data-color="${color}" onclick="setTheme('${color}'); updateSettingsPageTheme('${color}')"></div>`;
            html += `<button class="remove-color-btn" onclick="removeCustomColor(${i})">x</button>`;
            html += `</div>`;
        }
    }
    html += `</div>`;

    html += `<div class="custom-color-row">`;
    html += `<label for="settingsCustomColor">自定义颜色</label>`;
    html += `<input type="color" id="settingsCustomColor" value="${currentTheme}">`;
    html += `<button class="add-color-btn" onclick="addCurrentCustomColor()">添加</button>`;
    html += `</div>`;
    html += `</div>`;

    // 网格画质
    html += `<div class="settings-section">`;
    html += `<h3>网格画质</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" onclick="toggleGridOriginal()"><span id="gridOriginalText">${gridOriginalLabel()}</span></button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">默认用缩略图（平均约 18KB）。切成原图确实清楚一点，但冷启动一个板块可能要下 <b>40~100MB</b>（缩略图只要 1~2MB），所以默认不开。Service Worker 会把看过的图都存到本地，缓存热了之后两者一样快 —— 这个开关是留给"不差流量、就想要清晰"的时候。改完回到列表/概览就生效。</p>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">开了它之后还想离线能看网格，请用下面「预缓存全部（含原图）」，别再点「预缓存全部缩略图」了。</p>`;
    html += `</div>`;

    // 图片缓存
    html += `<div class="settings-section">`;
    html += `<h3>图片缓存</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" id="clearCacheBtn" onclick="clearImageCache()"><span id="clearCacheText">清除图片缓存</span></button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">图片会被 Service Worker 存到本地，离线也能看。换了图还显示旧图的话，点它清一下再刷新～</p>`;
    html += `</div>`;

    // 文章缓存
    html += `<div class="settings-section">`;
    html += `<h3>文章缓存</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" id="clearArticleCacheBtn" onclick="clearArticleCache()"><span id="clearArticleCacheText">清除文章缓存</span></button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">文章正文存在内存里，改了文章还看到旧内容，点它清掉再打开一次就好～</p>`;
    html += `</div>`;

    // 离线预缓存
    const precacheAutoLabel = (typeof precacheAutoEnabled === 'function' && precacheAutoEnabled())
        ? '自动预缓存：开' : '自动预缓存：关';
    html += `<div class="settings-section">`;
    html += `<h3>离线预缓存</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" onclick="togglePrecacheAuto()"><span id="precacheAutoText">${precacheAutoLabel}</span></button>`;
    html += `<button class="export-btn" onclick="runPrecacheThumbs()">预缓存全部缩略图</button>`;
    html += `<button class="export-btn" onclick="runPrecacheAll()"><span id="precacheAllText">预缓存全部（含原图）</span></button>`;
    html += `</div>`;
    html += `<p class="export-hint" id="precacheStatus" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">本地已缓存 0 张图片</p>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">专题页的图是懒加载的：没滚到的不会下载、离线就看不到。开着自动预缓存的话，它会在后台慢慢把当前页补齐（不影响浏览；左下角有进度，点 × 能停）。省流量模式或 2G/3G 下不会自己跑。</p>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">「预缓存全部缩略图」约 <b>14MB</b>，离线时网格能完整看（灯箱只有低清占位）。「预缓存全部（含原图）」约 <b>775MB</b>，会吃掉本站的 GitHub Pages 带宽（软限 100GB/月），<b>别反复点</b>；原图在你点开大图时会自动存下来，一般用不着它。</p>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>数据导出</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" onclick="exportJSON()">数据备份.json</button>`;
    html += `<button class="export-btn" onclick="exportCSV()">详细表格.csv</button>`;
    html += `<button class="export-btn" onclick="exportMarkdown()">概览报告.md</button>`;
    html += `<button class="export-btn" onclick="exportPriceList()">价格清单.txt</button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">点一下就自动下载啦～</p>`;
    html += `</div>`;

    html += `</div>`;
    app.innerHTML = html;

    // ★ 延迟恢复滚动
    if (settingsPageCache && settingsPageCache.scrollY) {
        setTimeout(() => {
            app.scrollTop = settingsPageCache.scrollY || 0;
        }, 50);
    }

    document.querySelectorAll('#settingsThemeColors .theme-color').forEach(el => {
        el.addEventListener('click', function() {
            const color = this.dataset.color;
            updateSettingsPageTheme(color);
            if (typeof setTheme === 'function') setTheme(color);
        });
    });

    // ★ 异步刷新离线预缓存的已缓存张数
    if (typeof precacheRefreshStatus === 'function') precacheRefreshStatus();
}

// ========== 网格画质：缩略图 / 原图 ==========
// 默认缩略图（冷启动一个板块约 1~2MB，原图要 40~100MB）；
// 缓存热了之后两者速度一样，所以给个开关让"想要更清晰"的时候自己开。
function gridOriginalLabel() {
    return (typeof gridUseOriginal === 'function' && gridUseOriginal())
        ? '网格直接用原图：开' : '网格直接用原图：关';
}

function toggleGridOriginal() {
    const next = !(typeof gridUseOriginal === 'function' && gridUseOriginal());
    setGridUseOriginal(next);
    const span = document.getElementById('gridOriginalText');
    if (span) span.textContent = next ? '网格直接用原图：开' : '网格直接用原图：关';
}

function togglePriceList() {
    const body = document.getElementById('priceListBody');
    const arrow = document.getElementById('priceListArrow');
    if (!body || !arrow) return;
    body.classList.toggle('open');
    arrow.classList.toggle('open');
}

function updateSettingsPageTheme(color) {
    document.querySelectorAll('.theme-color, .color-block').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.color === color) {
            el.classList.add('active');
        }
    });
    const picker = document.getElementById('settingsCustomColor');
    if (picker) picker.value = color;
}

function addCurrentCustomColor() {
    const picker = document.getElementById('settingsCustomColor');
    if (!picker) return;
    const color = picker.value;
    addCustomColor(color);
    renderSettingsPage();
    if (typeof setTheme === 'function') setTheme(color);
}

// ========== 清除图片缓存 ==========
function clearImageCache() {
    if (!cacheConfirmPending) {
        cacheConfirmPending = true;
        fadeText('确 定 吗 ？');
        cacheConfirmTimer = setTimeout(() => {
            cacheConfirmPending = false;
            fadeText('清除图片缓存');
        }, 3000);
        return;
    }
    clearTimeout(cacheConfirmTimer);
    cacheConfirmPending = false;
    performClearImageCache();
}

async function performClearImageCache() {
    try {
        if (!('caches' in window)) throw new Error('浏览器不支持 Cache API');
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(k => k.startsWith('collection-images')).map(k => caches.delete(k))
        );
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                await registration.update();
                if (registration.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
            }
        }
        fadeText('清好啦，刷新看看～');
        setTimeout(() => fadeText('清除图片缓存'), 2000);
    } catch (e) {
        fadeText('没清掉…再试一次？');
        setTimeout(() => fadeText('清除图片缓存'), 1000);
    }
}

function fadeText(text) {
    const span = document.getElementById('clearCacheText');
    if (!span) return;
    span.style.transition = 'opacity 0.15s ease';
    span.style.opacity = '0';
    setTimeout(() => {
        span.textContent = text;
        span.style.opacity = '1';
    }, 150);
}

// ========== 清除文章缓存 ==========
function clearArticleCache() {
    if (!articleCacheConfirmPending) {
        articleCacheConfirmPending = true;
        fadeArticleText('确 定 吗 ？');
        articleCacheConfirmTimer = setTimeout(() => {
            articleCacheConfirmPending = false;
            fadeArticleText('清除文章缓存');
        }, 3000);
        return;
    }
    clearTimeout(articleCacheConfirmTimer);
    articleCacheConfirmPending = false;
    articleContentCache = {};
    articlePlainTextCache = {};
    fadeArticleText('已 清 除');
    setTimeout(() => fadeArticleText('清除文章缓存'), 1000);
}

function fadeArticleText(text) {
    const span = document.getElementById('clearArticleCacheText');
    if (!span) return;
    span.style.transition = 'opacity 0.15s ease';
    span.style.opacity = '0';
    setTimeout(() => {
        span.textContent = text;
        span.style.opacity = '1';
    }, 150);
}

// ========== 清除 CDN 缓存（已移除） ==========
// 原先这里调用 jsDelivr purge 接口。现已移除，原因：
//   本仓库体积远超 jsDelivr 的 50MB 包上限，purge 会让 jsDelivr 无法重建缓存，
//   所有图片被 302 到 raw.githubusercontent.com（非 CDN、严格限流、明显更慢），
//   且这种状态无法自行恢复。图片现已改为 GitHub Pages 同源直出，jsDelivr 不再参与，
//   更新图片时用上方的「清除图片缓存」清掉本地 SW 缓存即可。