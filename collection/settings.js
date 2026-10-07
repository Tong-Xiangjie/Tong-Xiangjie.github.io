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

// ★ 价格列表的排序方式与筛选板块，同理也必须由模块级变量持有：
//   它们是 <select> 的选中值，而整个「我的」页每次重渲染都会重建这两个 select，
//   重建后浏览器只会认 HTML 里写死的 selected（默认排序 / 全部藏品），
//   用户选过的"从高到低""某个板块"就没了（用户要求保留）。
//   与 priceListOpen 一样只活在本次会话里。
let priceSortOrder = 'default';   // 'default' | 'desc' | 'asc'
let priceFilter = 'all';          // 'all' 或 buildPriceFilterCategories() 里的某个 id

// ★ 价格列表面板**内部**的滚动位置（它是 max-height:420px + overflow-y:auto 的面板，
//   有自己的 scrollTop）。整个「我的」页重渲染时面板也一起重建，滚动位置会归零；
//   恢复时机见 renderSettingsPage 末尾。同样只活在本次会话里。
let priceListScrollTop = 0;

// 按当前的排序/筛选算出真正要渲染的数据。
// ★ 首屏渲染与用户切换排序/筛选必须走同一个函数，否则"汇总数字和下面列表对不上"
//   （这正是 onPriceSortOrFilterChange 里那段注释警告过的事）。
//   顺带做一次归一：筛选目标若已不存在（数据变了），退回"全部藏品"，
//   免得留下一个谁都选不中的 select 值。
function currentPriceListData(stats) {
    const s = stats || computeStats();
    let filterInfo = null;
    let filteredPrices = s.prices;

    if (priceFilter && priceFilter !== 'all') {
        const matchedCat = buildPriceFilterCategories().find(c => c.id === priceFilter);
        if (matchedCat) {
            filterInfo = { dataKey: matchedCat.dataKey, source: matchedCat.source };
            filteredPrices = filterPricesByCategory(s.prices, filterInfo);
        } else {
            priceFilter = 'all';
        }
    }
    return { filteredPrices, filterInfo };
}

// 筛选生效时那两行汇总（总投入 / 均价）。未筛选时返回空串。
// ★ 内容包一层 .price-list-summary-inner：内边距必须挂在**内层**，
//   否则外层 max-height 收到 0 时那 16px padding（+1px 边框）还留在布局里，
//   收起动画末段会把下面顶起来 17px（实测就是这 17px 在抖）。
function priceListSummaryHtml(filteredPrices, filterInfo) {
    if (!filterInfo) return '';
    const total = filteredPrices.reduce((sum, p) => sum + (p.noPrice ? 0 : p.value), 0);
    const pricedItems = filteredPrices.filter(p => !p.noPrice);
    const avg = pricedItems.length > 0 ? Math.round(total / pricedItems.length) : 0;
    return `<div class="price-list-summary-inner">`
        + `<div class="price-list-summary-row"><span>该板块总投入</span><span>${total.toFixed(0)}元</span></div>`
        + `<div class="price-list-summary-row"><span>该板块藏品均价</span><span>${avg}元/件</span></div>`
        + `</div>`;
}

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
    for (const [val, label] of [['default', '默认排序'], ['desc', '从高到低'], ['asc', '从低到高']]) {
        html += `<option value="${val}"${priceSortOrder === val ? ' selected' : ''}>${label}</option>`;
    }
    html += `</select>`;
    html += `<select class="price-filter-select" id="priceFilterSelect" onclick="event.stopPropagation()" onchange="onPriceSortOrFilterChange()">`;
    html += `<option value="all"${priceFilter === 'all' ? ' selected' : ''}>全部藏品</option>`;
    const filterCategories = buildPriceFilterCategories();
    for (const cat of filterCategories) {
        html += `<option value="${cat.id}"${priceFilter === cat.id ? ' selected' : ''}>${escapeHtml(cat.name)}</option>`;
    }
    html += `</select>`;
    html += `</div>`;
    html += `<span class="price-list-arrow${priceListOpen ? ' open' : ''}" id="priceListArrow">▼</span>`;
    html += `</div>`;
    // ★ 汇总行与列表都按"当前的排序 + 筛选"渲染，和切换时走同一套计算。
    //   初始状态必须和 setPriceSummaryShown 的口径一致：显示时带 .shown + max-height:none，
    //   否则重渲染后它会因为 max-height:0 / opacity:0 直接看不见（.shown 才是"展开态"）。
    const priceData = currentPriceListData(allStats);
    const priceSummaryHtml = priceListSummaryHtml(priceData.filteredPrices, priceData.filterInfo);
    const sumShown = !!priceData.filterInfo;
    html += `<div class="price-list-summary${sumShown ? ' shown' : ''}" id="priceListSummary" style="display:${sumShown ? 'block' : 'none'};max-height:${sumShown ? 'none' : '0px'};">${priceSummaryHtml}</div>`;
    // ★ 没有筛选时汇总行不显示，它让出的那段高度由列表用 .absorb 撑住 ——
    //   卡片外框总高因此始终一致，卡片以下（统计图表、整页外观设置）不会上下跳。
    html += `<div class="price-list-body${priceListOpen ? ' open' : ''}${sumShown ? '' : ' absorb'}" id="priceListBody">`;
    html += renderPriceListItems(priceData.filteredPrices, priceSortOrder, priceFilter, priceData.filterInfo);
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    // ★「评级得分统计」和「藏品年代统计」是联动的（同一个币种口径），用户要求把两块放进
    //   **同一个圆角矩形**里：卡片顶上放币种切换，两个**小节标题各占一条柱状图的高度、居中**。
    //   （"占一条柱状图高度 / 可居左或居中"说的是这两条小节标题，不是卡片标题。）
    html += `<div class="settings-section stats-chart-card">`;
    html += `<div class="stats-chart-head">`;
    html += `<span class="stats-chart-name">统计图表</span>`;
    html += `<div class="rating-tabs">`;
    // ★ 会滑动的选中高亮块（和「明暗」那几个选项同一套，见 layoutSegmented）。
    //   放在最前面，靠 z-index 压在两个 tab 下面。
    html += `<span class="seg-pill" aria-hidden="true"></span>`;
    html += `<span class="rating-tab ${ratingMode === 'notes' ? 'active' : ''}" data-mode="notes" onclick="switchRatingMode('notes')">纸币</span>`;
    html += `<span class="rating-tab ${ratingMode === 'coins' ? 'active' : ''}" data-mode="coins" onclick="switchRatingMode('coins')">硬币</span>`;
    html += `</div>`;
    html += `</div>`;
    html += `<h3 class="stats-chart-sub">评级得分统计</h3>`;
    html += `<div id="ratingSection">`;
    html += buildRatingHTML(stats);
    html += `</div>`;
    html += `<h3 class="stats-chart-sub">藏品年代统计</h3>`;
    html += `<div id="yearSection">`;
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
        html += `<span class="empty-colors-hint">${emptyArt('color', true)}还没添加自定义颜色哦～</span>`;
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

    // 工具箱（文章 HTML 生成器）
    // ★ 入口放这里、不在底部 Tab 栏另开一个 tab：它是**写作辅助**，不是一块藏品内容，
    //   和「数据导出」「图片缓存」这些工具同类，所以统一收在「我的」页面最下面。
    // ★ 用 onclick="toolboxOpen()" 而不是在这里 addEventListener：整个设置页每次重渲染
    //   都是重建 innerHTML，事件监听得在 renderSettingsPage 里重新挂一遍（现有几个按钮
    //   全是内联 onclick，就是为避开这个坑）。toolbox.js 的顶层 function 是全局词法绑定，
    //   内联 onclick 取得到。
    // ★ 按钮**不依赖** toolbox.js 是否加载成功：万一副本没更新，toolboxOpen 未定义时
    //   内联 onclick 只会抛一条 ReferenceError（页面不白屏），不会把设置页弄坏。
    html += `<div class="settings-section">`;
    html += `<h3>工具箱</h3>`;
    html += `<div class="export-buttons">`;
    html += `<button class="export-btn" id="toolboxOpenBtn" onclick="toolboxOpen()">文章 HTML 生成器</button>`;
    html += `</div>`;
    html += `<p class="export-hint" style="font-size:0.75rem;color:var(--text-secondary);margin-top:6px;">站内弹窗里所见即所得地写正文，右侧实时生成 HTML（支持标题、引用框、图注、图片、超链接、表格）。表格用工具栏的「表格」按钮生成，或把现成的 HTML 粘到右侧代码区；正文区粘贴一律按**纯文本**处理，不会带入原来的样式</p>`;
    html += `</div>`;

    html += `</div>`;
    app.innerHTML = html;

    // ★ 设置页是整体重建 innerHTML 的，滑块每次都得重新量一次位置
    //   （animate=false：重渲染时"滑过去"没意义，直接摆正）
    layoutAllSegmented(false);

    // ★ 延迟恢复滚动
    if (settingsPageCache && settingsPageCache.scrollY) {
        setTimeout(() => {
            app.scrollTop = settingsPageCache.scrollY || 0;
        }, 50);
    }

    // ★ 价格列表是"固定 420px + 内部滚动"的面板，它有自己的 scrollTop；
    //   上面那行恢复的是**整个「我的」页**的滚动，管不到它，面板一重渲染就回到顶部。
    //   这里挂监听 + 恢复，口径和展开态、排序筛选一致：只活在本次会话里。
    const plBody = document.getElementById('priceListBody');
    if (plBody) {
        plBody.addEventListener('scroll', function () {
            // ★ 面板收起时 max-height:0 会把 scrollTop 钳成 0，那不是用户在滚，
            //   别把已经记住的位置覆盖掉（和分类页滚动记忆同一个坑）。
            if (plBody.scrollHeight <= plBody.clientHeight + 1) return;
            priceListScrollTop = plBody.scrollTop || 0;
        }, { passive: true });
        // 收起状态下 clientHeight 为 0，设 scrollTop 无效，所以只在展开时恢复
        if (priceListOpen && priceListScrollTop > 0) {
            requestAnimationFrame(function () {
                if (plBody.scrollTop !== priceListScrollTop) plBody.scrollTop = priceListScrollTop;
            });
        }
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
//                  ★ 放在卡片**外面**（用户要求："放在按钮下面"）：卡片整块是一个
//                  点击区，说明放里面就变成"点文字也会切换开关"。
function renderToggleRow(id, label, on, onclickExpr, desc) {
    const checked = !!on;
    return `<div class="toggle-card" onclick="${onclickExpr}">`
        + `<div class="toggle-card-top">`
        + `<span class="toggle-label">${label}</span>`
        + `<span class="switch${checked ? ' on' : ''}" id="${id}" role="switch" aria-checked="${checked ? 'true' : 'false'}">`
        + `<span class="switch-knob"></span></span>`
        + `</div>`
        + `</div>`
        + (desc ? `<div class="toggle-desc">${desc}</div>` : '');
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
    // ★ seg-no-anim：首帧滑块要"摆"到当前项上，不能从最左边滑过去（见 layoutSegmented）
    html += `<div class="segmented seg-no-anim" id="${id}" role="radiogroup">`;
    // ★ 会滑动的选中高亮块。放在最前面，靠 z-index 压在按钮下面（见 layout.css）
    html += `<span class="seg-pill" aria-hidden="true"></span>`;
    for (const [value, text] of options) {
        const active = value === current ? ' active' : '';
        html += `<button type="button" class="seg-btn${active}" data-value="${value}"`
            + ` role="radio" aria-checked="${value === current ? 'true' : 'false'}"`
            + ` onclick="${onPickName}('${value}'); updateSegmented('${id}', '${value}')">${text}</button>`;
    }
    html += `</div></div>`;
    return html;
}

// ★ 把滑块摆到当前选中项上。
//   几何从按钮上量（不写死宽度）：选项文字长了、窗口缩放了、字体换了都能自动跟正。
//   animate=true 时滑过去（用户点击），false 时直接到位（首帧 / 缩放 / 字体就绪）。
//   ★ 选中项的类名不统一：.segmented 用 .seg-btn.active，「纸币/硬币」的 .rating-tabs
//     用 .rating-tab.active，所以两种都认。
function layoutSegmented(idOrBox, animate) {
    const box = (typeof idOrBox === 'string') ? document.getElementById(idOrBox) : idOrBox;
    if (!box || !box.querySelector) return;
    const pill = box.querySelector('.seg-pill');
    if (!pill) return;
    const active = box.querySelector('.seg-btn.active, .rating-tab.active');
    // ★ 兜底：设置页有可能是在"还没显示"的时候渲染的（那时所有 rect 都是 0），
    //   或者宽度被字体/侧边栏影响。挂个 ResizeObserver，一有真实尺寸就重新量。
    //   这里不会有回环：滑块是绝对定位，改 --seg-w 不会反过来改变容器宽度。
    if (!box.__segObserved && typeof ResizeObserver === 'function') {
        box.__segObserved = true;
        try {
            new ResizeObserver(function () { layoutSegmented(box, false); }).observe(box);
        } catch (e) {}
    }
    if (!animate) box.classList.add('seg-no-anim');
    if (active) {
        const bb = box.getBoundingClientRect();
        const ab = active.getBoundingClientRect();
        // 绝对定位的 left:0 贴的是 padding 边，所以要减掉容器左边框宽度
        box.style.setProperty('--seg-x', (ab.left - bb.left - box.clientLeft) + 'px');
        box.style.setProperty('--seg-w', ab.width + 'px');
        pill.style.visibility = '';
    } else {
        // 没有选中项（理论上不该发生）：把滑块收起来，别留在原地误导
        box.style.setProperty('--seg-w', '0px');
        pill.style.visibility = 'hidden';
    }
    if (!animate) {
        // 摆位这一帧不能被过渡吃掉，所以等两帧再恢复动画
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { box.classList.remove('seg-no-anim'); });
        });
    }
}

function layoutAllSegmented(animate) {
    // ★ 带上 .rating-tabs（纸币/硬币）：它复用同一套 .seg-pill 滑块
    document.querySelectorAll('.segmented, .rating-tabs').forEach(function (box) { layoutSegmented(box, animate); });
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
    layoutSegmented(box, true);      // ★ 滑块滑过去
}

// ★ 窗口尺寸变了（侧边栏宽度/字号都会跟着变）滑块要重新量；缩放时不播动画。
//   字体晚到会让按钮宽度变，所以 fonts.ready 之后再量一次。
let segRelayoutRaf = 0;
window.addEventListener('resize', function () {
    if (segRelayoutRaf) cancelAnimationFrame(segRelayoutRaf);
    segRelayoutRaf = requestAnimationFrame(function () {
        segRelayoutRaf = 0;
        layoutAllSegmented(false);
    });
});
if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
    document.fonts.ready.then(function () { layoutAllSegmented(false); });
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

// ★ 展开时让**每一条**都错开淡入（用户要求，原来只动了前 6 条）。
//   错开只排"一屏装得下"的那些行：屏幕外的行用户根本看不到，给它们排长延迟有两个坏处 ——
//   ① 400 条 × 每行几毫秒会把整段拉成一两秒；② backwards 填充期间它们是隐藏的，
//   用户这时候往下滚会看到一片空白。
//   所以一屏之后的行延迟封顶（≈整个错开窗口），既不拖长也不会被"藏住"。
//   延迟只能逐行写（CSS 的 nth-child 写到固定条数就到头了），所以结束时要清干净。
function playPriceListRowsIn(body) {
    if (!body) return;
    if (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) return;
    const rows = [...body.querySelectorAll('.price-list-item')];
    if (!rows.length) return;
    const ROW_H = 30;                                   // 见 .price-list-item 的高度
    const perScreen = Math.max(1, Math.ceil((body.clientHeight || 420) / ROW_H));
    const step = Math.max(8, Math.min(24, Math.round(260 / perScreen)));
    const maxDelay = Math.min(rows.length, perScreen) * step;
    rows.forEach((el, i) => {
        el.style.animationDelay = Math.min(i, perScreen) * step + 'ms';
        el.classList.add('pl-enter');
    });
    setTimeout(() => {
        rows.forEach(el => {
            el.classList.remove('pl-enter');
            el.style.animationDelay = '';
        });
    }, 420 + maxDelay);
}

// ★ 汇总行的"下滑展开 / 上滑收起"（用户要求；原来是 display 硬切 + 一次性淡入）。
//   display:none 是不能过渡的，所以：
//     · 展开：先 display:block，max-height 从 0 量到自然高度，动画走完再放开成 none
//       （放开是为了窗口变窄、文字换行时不被裁）。
//     · 收起：从当前高度滑回 0，动画走完才 display:none。
//   max-height 用实测值而不是写死的数字，换行/字号变化都不会被裁。
//
//   ★ 起滑必须推迟一帧（用户报"收起的动画有卡顿"）：切换筛选时，同一个任务里还要
//     重建整张 394 行的价格列表并给每行挂 FLIP —— 那是几十毫秒的重活。如果滑动跟它
//     抢同一帧，140/220ms 的动画头几帧直接被拖住，看起来就是卡顿。推到下一帧再起滑，
//     重活先跑完，动画自己走得很干净。
//   ★ 用双层 rAF（和 layoutSegmented 同一个套路）：单层有可能和"设起点"落在同一帧里
//     被合并成一次样式计算，那样起止值只剩一个，动画根本不会发生。两层能保证中间
//     隔了一次完整的样式/布局，起点一定生效。
let priceSummaryTimer = null;
let priceSummarySeq = 0;
let priceSummaryBarTimer = null;
// 与 layout.css 的 .price-list-body.open 的 max-height 一致（列表张开时的上限）
const PRICE_LIST_MAX_H = 420;
function afterNextPaint(fn) {
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
}
// 汇总行的实高：写进 --pl-sum-h，列表靠它算出"收起时要吸收多少"。
// ★ 用 getBoundingClientRect 而不是 scrollHeight：后者量不到上下内边距（实测差 17px），
//   吸收量和让出量对不上，卡片还是会先被顶下去再弹回来。必须在汇总行可见时量。
function priceSummaryMeasure(sum) {
    const h = Math.round(sum.getBoundingClientRect().height) || 0;
    if (h > 0) document.documentElement.style.setProperty('--pl-sum-h', h + 'px');
    return h;
}
// 列表的自绘滚动条（挂在 body 上、按宿主旧几何画）。动画期间它跟不上新几何会看着错位，
// 所以先隐掉，动画结束再让它重新对位。
function priceSummaryBar(bodyEl, hide) {
    const rec = bodyEl && bodyEl.__cscroll;
    const bar = rec && rec.bar;
    if (!bar) return;
    if (hide) {
        bar.style.transition = 'opacity 0.1s linear';
        bar.style.opacity = '0';
    } else {
        bar.style.transition = '';
        bar.style.opacity = '';
        priceSummaryBarTimer = null;
        if (typeof window.refreshCustomScrollbars === 'function') window.refreshCustomScrollbars();
    }
}
function setPriceSummaryShown(sum, show, html) {
    if (!sum) return;
    // ★ 汇总内容由这里统一管：**收起时不要立刻换内容** —— 一换内容高度就先缩一下
    //   （实测量到 16px，页面跟着跳 51px）。旧数字要一路滑上去，滑完再换/清空。
    const nextHtml = typeof html === 'string' ? html : null;
    const applyHtml = () => { if (nextHtml !== null) sum.innerHTML = nextHtml; };
    // ★ 先看这个栏目本来在不在（class 是唯一口径：整页重渲染时也是按 filterInfo 写出来的）。
    //   用户："假如一直有这个栏目就不用重复展开收起，只有在'全部藏品'与其他东西切换的时候才要这个动画"
    //   —— 分类 → 另一个分类时汇总行一直在，只换数字，不该重播一遍下拉/上收。
    const wasShown = sum.classList.contains('shown');
    const seq = ++priceSummarySeq;                 // 期间又切了一次就以最后一次为准
    if (priceSummaryTimer) { clearTimeout(priceSummaryTimer); priceSummaryTimer = null; }

    const reduced = (typeof prefersReducedMotion === 'function') && prefersReducedMotion();
    const body = document.getElementById('priceListBody');
    const wrapper = sum.closest('.price-list-wrapper');
    const listOpen = !!(body && body.classList.contains('open'));
    // ★ 关键：列表开着的时候，让**列表自己吸收/让出**汇总行那段高度 ——
    //   汇总行 max-height 67→0 的同时，列表 max-height 420→487，两者用同一时长同一条缓动，
    //   任意时刻之和恒等于 487：卡片外框总高不变，卡片以下（统计图表、整页外观设置）
    //   一个像素都不动。三次"卡"的根子就是整页跟着汇总行上下动 ——
    //   动 max-height 是布局动画，下面那一大段每帧都要重排重绘。
    //   列表没开（没有列表可吸收）时就不播动画，一次到位：一帧的事，不会卡。
    const canAbsorb = listOpen && !reduced;
    const setAbsorb = (on) => { if (body) body.classList.toggle('absorb', !!on); };
    const moveBar = (hide) => { if (listOpen) priceSummaryBar(body, hide); };
    // 列表要吸收/让出的那一段 = 汇总行实高 h。动画期间写**明确 px**：
    //   calc() 里带 var 的 max-height 浏览器不做插值（实测直接跳变，页面照样抖），
    //   两端都是纯 px 才真的过渡；收尾再交回 .absorb 类（算出来的值一模一样，不会跳）。
    const sumH = () => Math.round(sum.getBoundingClientRect().height) || 0;
    const pinBody = (px) => { if (body && canAbsorb) body.style.maxHeight = px + 'px'; };
    const clearBody = () => { if (body) body.style.maxHeight = ''; };

    if (wasShown === show) {                       // 状态没变：只换数字，不重播动画
        applyHtml();
        sum.style.display = show ? 'block' : 'none';
        sum.style.maxHeight = show ? 'none' : '';
        if (show) priceSummaryMeasure(sum);
        setAbsorb(!show);
        clearBody();
        moveBar(false);
        return;
    }

    if (reduced) {                                 // 减弱动效：一次到位，不播动画
        applyHtml();
        sum.classList.toggle('shown', show);
        sum.style.display = show ? 'block' : 'none';
        sum.style.maxHeight = show ? 'none' : '';
        if (show) priceSummaryMeasure(sum);
        setAbsorb(!show);
        clearBody();
        return;
    }

    moveBar(true);
    if (show) {
        // ── 下滑展开 ──
        applyHtml();
        sum.classList.add('shown');
        sum.style.display = 'block';
        const h = sumH();
        setAbsorb(false);                          // 静止值交回 CSS（420）
        pinBody(PRICE_LIST_MAX_H + h);             // 起点 = 刚才的吸收态高度，本帧不变
        if (wrapper) wrapper.classList.add('sum-expanding');
        // 先把起点定在 0（本帧就被样式计算吃掉），两帧后再放开到自然高度
        sum.style.maxHeight = '0px';
        afterNextPaint(() => {
            if (seq !== priceSummarySeq) return;
            sum.style.maxHeight = sum.scrollHeight + 'px';
            pinBody(PRICE_LIST_MAX_H);             // 487 → 420：与汇总行的 0 → h 精确互补
            // 220ms（--dur-2）+ 余量：滑完再放开高度上限
            priceSummaryTimer = setTimeout(() => {
                if (seq !== priceSummarySeq) return;
                sum.style.maxHeight = 'none';
                if (wrapper) wrapper.classList.remove('sum-expanding');
                clearBody();
                priceSummaryMeasure(sum);
                moveBar(false);
                priceSummaryTimer = null;
            }, 300);
        });
    } else {
        // ── 上滑收起 ──
        // ★ 这里必须先把 .shown 摘掉：.shown 上的过渡是入场时长（--dur-2/220ms），
        //   而列表吸收走的是退场时长（--dur-1/140ms），两边不同步卡片就会先被顶下去再弹回来。
        //   摘掉后两边都是 --dur-1/--ease-in，任意时刻高度之和恒定。
        //   摘类造成的高度变化会被同一帧写入的内联 max-height 立刻盖掉，不会先塌一下。
        // ★ 这里**不能**再判断 canAbsorb 就 return：列表没收起时没有东西可以吸收，
        //   但汇总行自己照样要滑走（用户报的"价格列表没展开时这个小栏目收不起来"就是这句）。
        const h = sumH();                          // ★ 必须在摘 .shown 之前量：摘了 max-height 就是 0
        priceSummaryMeasure(sum);
        sum.classList.remove('shown');
        pinBody(PRICE_LIST_MAX_H);                 // 从静止值 420 起（下一帧滑到 420 + h）
        sum.style.maxHeight = h + 'px';            // 从实高起
        afterNextPaint(() => {
            if (seq !== priceSummarySeq) return;
            sum.style.maxHeight = '0px';
            pinBody(PRICE_LIST_MAX_H + h);         // 420 → 487：与汇总行的 h → 0 精确互补
            // 140ms（--dur-1）+ 余量：滑动结束再收掉 display
            priceSummaryTimer = setTimeout(() => {
                if (seq !== priceSummarySeq) return;
                sum.style.display = 'none';
                sum.style.maxHeight = '';
                setAbsorb(true);                   // 静止态交给 CSS，值与刚才的内联完全一致
                clearBody();
                applyHtml();                       // 空内容留到最后再换
                moveBar(false);
                priceSummaryTimer = null;
            }, 260);
        });
    }
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
    // ★ 展开时全部条目错开进来（用户报的"展开缺少动画"：原来只有容器 max-height 在动，
    //   行是一次性出现的，看着还是硬切）。
    if (priceListOpen) playPriceListRowsIn(body);
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