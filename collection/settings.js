// ==================== settings.js ====================
// 设置页渲染

let cacheConfirmPending = false;
let cacheConfirmTimer = null;

let articleCacheConfirmPending = false;
let articleCacheConfirmTimer = null;

// ★ 价格列表的展开状态。
//   以前这个状态只挂在 DOM 的 class 上（togglePriceList 直接 classList.toggle），
//   而「我的」页每次 renderSettingsPage() 都会整体重建 innerHTML —— 切板块、切评级页签、
//   加自定义颜色都会触发 —— 于是重建后展开态必然丢失（用户报的"切换板块后无法保持"）。
//   改成模块级变量：同一次会话内（含切板块往返、切页签）保持；刷新页面回到默认收起。
//   不写 localStorage：这是一次浏览里的临时开合，和主题、模糊搜索那种"偏好"不同类。
let priceListOpen = false;

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
    html += `<span class="price-list-arrow${priceListOpen ? ' open' : ''}" id="priceListArrow">▼</span>`;
    html += `</div>`;
    html += `<div class="price-list-summary" id="priceListSummary" style="display:none;"></div>`;
    html += `<div class="price-list-body${priceListOpen ? ' open' : ''}" id="priceListBody">`;
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

    // 外观（三态：跟随系统 / 亮 / 暗）
    html += `<div class="settings-section">`;
    html += `<h3>外观</h3>`;
    html += renderSegmented('colorSchemeSeg', '明暗', [
        ['system', '跟随系统'], ['light', '亮'], ['dark', '暗']
    ], getColorSchemeMode(), 'setColorSchemeMode');
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
        html += `<span class="empty-colors-hint">还没添加自定义颜色哦～</span>`;
    } else {
        for (let i = 0; i < customColors.length; i++) {
            const color = customColors[i];
            const active = color === currentTheme ? ' active' : '';
            html += `<div class="saved-color-item">`;
            html += `<div class="color-block${active}" style="background:${color}" data-color="${color}" onclick="setTheme('${color}'); updateSettingsPageTheme('${color}')"></div>`;
            html += `<button class="remove-color-btn" onclick="removeCustomColor(${i})">×</button>`;
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

    // 文章搜索（模糊搜索 / 同义扩展）
    // ★ 从搜索栏搬过来的。放在「我的」是因为它是一条**偏好**（默认关、存 localStorage、
    //   不进 URL），和「网格直接用原图」「自动预缓存」同类，而不是一次搜索的状态。
    html += `<div class="settings-section">`;
    html += `<h3>文章搜索模式偏好</h3>`;
    html += renderToggleRow('articleFuzzySwitch', '模糊搜索',
        articleFuzzyOn(), 'toggleArticleFuzzy()',
        '开启后，检索词依据同义词表扩展为同义项一并参与匹配，可覆盖正式名称与俗称、简称之间的对应关系；命中结果合并为单一列表并按相关性排序。召回范围相应扩大，会包含相关但非精确匹配的条目；仅作用于文章板块。');
    html += `</div>`;

    // 网格画质
    html += `<div class="settings-section">`;
    html += `<h3>网格图片画质</h3>`;
    html += renderToggleRow('gridOriginalSwitch', '使用原图',
        gridUseOriginal(), 'toggleGridOriginal()');
    html += `</div>`;

    // 图片缓存
    html += `<div class="settings-section">`;
    html += `<h3>图片缓存</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" id="clearCacheBtn" onclick="clearImageCache()"><span id="clearCacheText">清除图片缓存</span></button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">图片将被Service Worker缓存到本地，支持离线查看。若图片更换后依旧显示旧图，请点击此按钮并刷新网页</p>`;
    html += `</div>`;

    // 文章缓存
    html += `<div class="settings-section">`;
    html += `<h3>文章缓存</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" id="clearArticleCacheBtn" onclick="clearArticleCache()"><span id="clearArticleCacheText">清除文章缓存</span></button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">文章正文缓存在内存中。若文章修改后依旧显示旧内容，请点击此按钮并刷新网页</p>`;
    html += `</div>`;

    // 离线预缓存
    const precacheAutoOn = (typeof precacheAutoEnabled === 'function' && precacheAutoEnabled());
    html += `<div class="settings-section">`;
    html += `<h3>图片离线预缓存</h3>`;
    html += renderToggleRow('precacheAutoSwitch', '自动缓存',
        precacheAutoOn, 'togglePrecacheAuto()');
    html += `<div class="actions-caption">手动缓存</div>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" onclick="runPrecacheThumbs()">预缓存缩略图</button>`;
    html += `<button class="export-btn" onclick="runPrecacheAll()"><span id="precacheAllText">预缓存全部图片</span></button>`;
    html += `</div>`;
    html += `<p class="export-hint" id="precacheStatus" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">本地已缓存0张图片</p>`;
    html += `</div>`;

    html += `<div class="settings-section">`;
    html += `<h3>数据导出</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" onclick="exportJSON()">数据备份.json</button>`;
    html += `<button class="export-btn" onclick="exportCSV()">详细表格.csv</button>`;
    html += `<button class="export-btn" onclick="exportMarkdown()">概览报告.md</button>`;
    html += `<button class="export-btn" onclick="exportPriceList()">价格清单.txt</button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">点击即可下载相应文件</p>`;
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

// ========== 开关卡片（自动预缓存 / 网格画质 / 文章搜索共用） ==========
// 浅色卡片 = "状态/设置项"；主题色实心按钮 = "立即执行的动作"。两套语言分开，
// 也避免把开关和按钮排在同一行（之前那样看着很乱）。
//
// 参数：(id, label, on, onclickExpr, desc)
//   id          —— 给 .switch 元素的 id，用于 setSwitchState(id, on) 局部刷新
//   label       —— 显示文案
//   on          —— 当前是否开启（布尔）
//   onclickExpr —— 点击整张卡片时执行的全局函数表达式字符串
//   desc        —— 可选：开关下方的一行补充说明（.toggle-desc，0.72rem 次要色）。
//                  放在卡片内部，所以点说明文字也会切换开关（整张卡片是一个点击区）。
function renderToggleRow(id, label, on, onclickExpr, desc) {
    const checked = !!on;
    return `<div class="toggle-card" onclick="${onclickExpr}">`
        + `<div class="toggle-card-top">`
        + `<span class="toggle-label">${label}</span>`
        + `<span class="switch${checked ? ' on' : ''}" id="${id}" role="switch" aria-checked="${checked ? 'true' : 'false'}">`
        + `<span class="switch-knob"></span></span>`
        + `</div>`
        + (desc ? `<div class="toggle-desc">${desc}</div>` : '')
        + `</div>`;
}

function setSwitchState(id, on) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('on', !!on);
    el.setAttribute('aria-checked', on ? 'true' : 'false');
}

// 三态分段控件（如「明暗：跟随系统 / 亮 / 暗」）。
// options 是 [[值, 文案], ...]；onPickName 是全局函数名，点一下调 onPickName(值)。
function renderSegmented(id, label, options, current, onPickName) {
    let html = `<div class="toggle-card">`;
    if (label) html += `<div class="toggle-label">${label}</div>`;
    html += `<div class="segmented" id="${id}" role="radiogroup">`;
    for (const [value, text] of options) {
        const active = value === current ? ' active' : '';
        html += `<button type="button" class="seg-btn${active}" data-value="${value}"`
            + ` role="radio" aria-checked="${value === current ? 'true' : 'false'}"`
            + ` onclick="${onPickName}('${value}'); updateSegmented('${id}', '${value}')">${text}</button>`;
    }
    html += `</div></div>`;
    return html;
}

// 点完立刻更新高亮，不等整页重渲染
function updateSegmented(id, value) {
    const box = document.getElementById(id);
    if (!box) return;
    box.querySelectorAll('.seg-btn').forEach(function (btn) {
        const on = btn.dataset.value === value;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
}

// ========== 网格画质：缩略图 / 原图 ==========
// 默认缩略图（冷启动一个板块约 1~2MB，原图要 40~100MB）；缓存热了之后两者一样快，
// 所以给个开关让"想要更清晰"的时候自己开。
function toggleGridOriginal() {
    const next = !(typeof gridUseOriginal === 'function' && gridUseOriginal());
    setGridUseOriginal(next);
    setSwitchState('gridOriginalSwitch', next);
    // ★ 已渲染视图里的 <img src> 还是旧的，必须主动作废，否则要刷新页面才生效
    if (typeof invalidateRenderedViews === 'function') invalidateRenderedViews();
}

function togglePriceList() {
    const body = document.getElementById('priceListBody');
    const arrow = document.getElementById('priceListArrow');
    if (!body || !arrow) return;
    // ★ 以模块级变量为准（而不是 classList.toggle 盲翻）：
    //   重渲染后 DOM 的 class 是按 priceListOpen 写出来的，两边必须同一个口径。
    priceListOpen = !priceListOpen;
    body.classList.toggle('open', priceListOpen);
    arrow.classList.toggle('open', priceListOpen);
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
        fadeText('已 清 除');
        setTimeout(() => fadeText('清除图片缓存'), 2000);
    } catch (e) {
        fadeText('清除失败！');
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
    // ★ 索引没了，"建索引"这件事也必须一起重置（否则会有两个后果）：
    //   ① articlePreloadPromise 还钉在那个"已经跑完"的旧 Promise 上，
    //      之后切到全文 / 再进文章板块都只会拿到它、**不会真的重建**，
    //      于是全文搜索静默退化成只搜标题，而且再也恢复不了（只能刷新页面）。
    //   ② 提示词会一直停在"全文还在加载中"（状态永远回不到 ready）。
    //   清掉这三样之后，下次进文章板块（tab-switcher 在全文模式下会调
    //   preloadAllArticles）就会真的重建，提示词也会重新走一遍加载中 → 准备好啦。
    articlePreloadPromise = null;
    isArticlePreloading = false;
    articleFulltextState = 'idle';
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