// ==================== stats.js ====================
// 统计与导出

// ========== 硬币评级前缀解析 ==========
// 双字母在前、单字母在后，避免 F 与 XF/VF/PF/FR 误配
const COIN_PREFIXES = ['MS', 'PF', 'AU', 'XF', 'VF', 'VG', 'AG', 'FR', 'PO', 'F', 'G'];

function parseGrade(cond) {
    let s = cond.trim();
    let prefix = '';
    for (const p of COIN_PREFIXES) {
        if (s.startsWith(p)) {
            prefix = p;
            s = s.substring(p.length);
            break;
        }
    }
    // ★ 去掉 ^ 锚点：兼容 ACG65E 这类“公司前缀 + 数字”的纸币评级
    const m = s.match(/(\d+)\+?(E)?/);
    if (!m) return null;
    return { prefix, score: m[1] + (m[2] || '') };
}
// ============================================

function collectAllCopies() {
    const allCopies = [];

    if (window.DATA_MAP) {
        for (const dataKey of allDataKeys) {
            const data = window.DATA_MAP[dataKey];
            if (!data || !data.series) continue;
            for (let si = 0; si < data.series.length; si++) {
                const series = data.series[si];
                if (series.varieties) {
                    for (let vi = 0; vi < series.varieties.length; vi++) {
                        const variety = series.varieties[vi];
                        if (!variety.copies) continue;
                        for (let ci = 0; ci < variety.copies.length; ci++) {
                            allCopies.push({
                                copy: variety.copies[ci],
                                seriesName: series.seriesName + ' - ' + variety.varietyName,
                                type: 'notes',
                                dataKey
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allCopies.push({
                            copy: series.copies[ci],
                            seriesName: series.seriesName,
                            type: 'notes',
                            dataKey
                        });
                    }
                }
            }
        }
    }

    if (window.COIN_DATA_MAP) {
        for (const dataKey of coinAllDataKeys) {
            const data = window.COIN_DATA_MAP[dataKey];
            if (!data || !data.series) continue;
            for (let si = 0; si < data.series.length; si++) {
                const series = data.series[si];
                if (series.varieties) {
                    for (let vi = 0; vi < series.varieties.length; vi++) {
                        const variety = series.varieties[vi];
                        if (!variety.copies) continue;
                        for (let ci = 0; ci < variety.copies.length; ci++) {
                            allCopies.push({
                                copy: variety.copies[ci],
                                seriesName: series.seriesName + ' - ' + variety.varietyName,
                                type: 'coins',
                                dataKey
                            });
                        }
                    }
                } else if (series.copies) {
                    for (let ci = 0; ci < series.copies.length; ci++) {
                        allCopies.push({
                            copy: series.copies[ci],
                            seriesName: series.seriesName,
                            type: 'coins',
                            dataKey
                        });
                    }
                }
            }
        }
    }

    return allCopies;
}

function computeStats(typeFilter) {
    const allCopies = collectAllCopies();

    let filtered = allCopies;
    if (typeFilter === 'notes') {
        filtered = allCopies.filter(c => c.type === 'notes');
    } else if (typeFilter === 'coins') {
        filtered = allCopies.filter(c => c.type === 'coins');
    }

    const total = filtered.length;

    let notesCount = 0, coinsCount = 0;
    if (window.DATA_MAP) {
        for (const key of allDataKeys) {
            const d = window.DATA_MAP[key];
            if (d && d.series) {
                for (const s of d.series) {
                    if (s.varieties) for (const v of s.varieties) notesCount += (v.copies ? v.copies.length : 0);
                    else if (s.copies) notesCount += s.copies.length;
                }
            }
        }
    }
    if (window.COIN_DATA_MAP) {
        for (const key of coinAllDataKeys) {
            const d = window.COIN_DATA_MAP[key];
            if (d && d.series) {
                for (const s of d.series) {
                    if (s.varieties) for (const v of s.varieties) coinsCount += (v.copies ? v.copies.length : 0);
                    else if (s.copies) coinsCount += s.copies.length;
                }
            }
        }
    }

    let prices = [];
    for (const item of filtered) {
        const ps = item.copy.price;
        if (ps) {
            const num = parseFloat(String(ps).replace(/[^0-9.]/g, ''));
            if (!isNaN(num) && num > 0) {
                prices.push({ value: num, name: item.seriesName, version: item.copy.version || '', dataKey: item.dataKey, type: item.type });
            } else {
                prices.push({ value: -1, name: item.seriesName, version: item.copy.version || '', noPrice: true, dataKey: item.dataKey, type: item.type });
            }
        } else {
            prices.push({ value: -1, name: item.seriesName, version: item.copy.version || '', noPrice: true, dataKey: item.dataKey, type: item.type });
        }
    }
    const totalPrice = prices.reduce((s, p) => s + (p.noPrice ? 0 : p.value), 0);
    const pricedItems = prices.filter(p => !p.noPrice);
    const avgPrice = pricedItems.length > 0 ? Math.round(totalPrice / pricedItems.length) : 0;

    // ========== 评级统计（支持 MS/PF/AU 等前缀分组） ==========
    const gradeMap = {};
    let ungraded = 0;
    for (const item of filtered) {
        const cond = item.copy.condition || item.copy.grade || '';

        // 处理「真品」特殊情况
        if (cond.includes('真品')) {
            if (!gradeMap['真品']) gradeMap['真品'] = { prefixes: new Set(['']), count: 0 };
            gradeMap['真品'].count++;
            continue;
        }

        // ★ 新增：处理「UNC」特殊情况（如 "ACG UNC"）
        if (cond.includes('UNC') && !cond.match(/\d/)) {
            // 只处理不包含数字的 UNC（避免把 "UNC 65" 也抓进来，虽然这种情况较少）
            if (!gradeMap['UNC']) gradeMap['UNC'] = { prefixes: new Set(['']), count: 0 };
            gradeMap['UNC'].count++;
            continue;
        }

        const parsed = parseGrade(cond);
        if (!parsed) {
            ungraded++;
            continue;
        }

        // 按分数（含 E 后缀）分组，记录出现过的前缀
        if (!gradeMap[parsed.score]) gradeMap[parsed.score] = { prefixes: new Set(), count: 0 };
        gradeMap[parsed.score].prefixes.add(parsed.prefix);
        gradeMap[parsed.score].count++;
    }

    // 生成标签：同分多前缀用 / 合并（如 MS/PF69）；排序按分数，不再被标签文字干扰
    const sortedGrades = Object.entries(gradeMap)
        .map(([score, g]) => {
            const prefixes = [...g.prefixes].filter(Boolean).sort();
            const label = score === '真品' ? '真品'
                : score === 'UNC' ? 'UNC'
                : (prefixes.length ? prefixes.join('/') + score : score);
            
            // ★ 排序值计算
            let sortVal;
            if (score === '真品') {
                sortVal = -1;
            } else if (score === 'UNC') {
                sortVal = 0;  // 排在数字分数之后、真品之前
            } else {
                sortVal = parseFloat(score.replace('E', '.5'));
            }
            return [label, g.count, sortVal];
        })
        .sort((a, b) => b[2] - a[2])
        .map(e => [e[0], e[1]]);

    const yearCounts = {};
    for (const item of filtered) {
        const y = item.copy.year;
        if (y && typeof y === 'number') {
            const decade = Math.floor(y / 10) * 10;
            const key = decade + 's';
            yearCounts[key] = (yearCounts[key] || 0) + 1;
        }
    }
    const sortedYears = Object.entries(yearCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    return { total, notesCount, coinsCount, prices, totalPrice, avgPrice, sortedGrades, ungraded, sortedYears };
}

// ============================================================
// ★ 修改：价格列表分类筛选下拉菜单，显示层级结构
// ============================================================
function buildPriceFilterCategories() {
    const cats = [];

    // ★ 改成"走树"生成（纸币/硬币同一套逻辑）。
    //   原来这里是两段**手写遍历**：纸币那半边会展开 cat.children，硬币那半边
    //   只跑顶层 —— 而流通硬币在 tree 里是"人民币流通硬币"的 children，
    //   于是 circulating_2/3/4/5 永远进不了筛选列表（用户报的
    //   "价格列表那里还是没有'流通硬币'"就是这个）。
    //   同一类病这已经是第三处：coinAllDataKeys 手写、coincollection 手写文件名、
    //   这里是手写遍历。凡是"树变了但代码没跟上"的地方，都是因为没走树。
    //   口头约定：以后树加深层级，这里自动跟上，不用再改。
    function collect(tree, map, source) {
        if (!tree || !map) return;
        for (const cat of tree) {
            if (cat.children) {
                // 有子分类：显示 "父分类 - 子分类"
                for (const sub of cat.children) {
                    const data = map[sub.dataKey];
                    if (data && data.series && data.series.length > 0) {
                        cats.push({
                            id: source + '_' + sub.id,
                            name: cat.name + ' - ' + sub.name,
                            dataKey: sub.dataKey,
                            source: source
                        });
                    }
                }
            } else if (cat.dataKey) {
                // 无子分类（顶层分类）：直接显示分类名
                const data = map[cat.dataKey];
                if (data && data.series && data.series.length > 0) {
                    cats.push({
                        id: source + '_' + cat.id,
                        name: cat.name,
                        dataKey: cat.dataKey,
                        source: source
                    });
                }
            }
        }
    }

    if (window.DATA_MAP) collect(typeof categoryTree !== 'undefined' ? categoryTree : null, window.DATA_MAP, 'notes');
    if (window.COIN_DATA_MAP) collect(typeof coinCategoryTree !== 'undefined' ? coinCategoryTree : null, window.COIN_DATA_MAP, 'coins');

    return cats;
}

// ★ 原 buildCategoryOrder() 已删除：全站零调用。
//   分类顺序现在直接由 getAllDataKeys() 给出。

// ★ 按分类筛选价格列表。
//   原来这里是 `allowedNames.includes(p.name)` —— 按**名称字符串**比对，两个问题：
//     ① 同名系列散落在两个 dataKey 里时会互相串入（价格列表与顶部汇总数字对不上）；
//     ② 每渲染一次都要把整个分类的所有名称拼成一个数组再 O(n) 线性查找，纯浪费。
//   现在直接按 (dataKey, source) 筛选：prices 条目本身已带 dataKey 与 type 字段。
//   ★ 注意 dataKey **不是全局唯一**：纸币的纪念钞与硬币的纪念币都叫 'commemorativeData'
//     （硬币那条用 dataVar: 'coincommData' 区分变量名）。二者被分别放进 DATA_MAP 与
//     COIN_DATA_MAP，所以必须连 source 一起比，只比 dataKey 会把两者混在一起。
function filterPricesByCategory(prices, filterInfo) {
    if (!filterInfo || !filterInfo.dataKey) return prices;
    const wantKey = filterInfo.dataKey;
    const wantSource = filterInfo.source;
    return prices.filter(p => p.dataKey === wantKey && (!wantSource || p.type === wantSource));
}

// ★ (dataKey, source) → 分类显示名，给价格列表每条加"大类"前缀用。
//   价格条目自己只带 dataKey + type（见 computeStats 里 prices.push 的字段），
//   要显示"纪念钞 - …"、"人民币 - 第三套人民币 - …"就得回到分类树上取名字
//   （buildPriceFilterCategories 生成的名字正好就是这个格式，筛选下拉里用的也是它）。
//   取名字这一段是纯查表，缓存一次即可（分类树是静态的）。
let priceCategoryLabelCache = null;
function priceCategoryLabel(dataKey, source) {
    if (!dataKey) return '';
    if (!priceCategoryLabelCache) {
        priceCategoryLabelCache = new Map();
        for (const cat of buildPriceFilterCategories()) {
            const k = cat.source + '|' + cat.dataKey;
            // 同一个 (dataKey, source) 可能被多个分类条目指到（同名系列散落在不同子类里），
            // 保留第一个即可：前缀只是"告诉用户这条属于哪个大类"，不参与筛选。
            if (!priceCategoryLabelCache.has(k)) priceCategoryLabelCache.set(k, cat.name);
        }
    }
    return priceCategoryLabelCache.get(source + '|' + dataKey) || '';
}

function renderPriceListItems(prices, order, filter, filterInfo) {
    // prices 已由调用方按分类筛好（避免这里再筛一次导致汇总与列表不同源）
    const filteredPrices = prices;

    let sorted;
    if (order === 'default') {
        sorted = [...filteredPrices];
    } else {
        sorted = [...filteredPrices].sort((a, b) => {
            if (order === 'desc') return b.value - a.value;
            else return a.value - b.value;
        });
    }

    let html = '';
    for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        const displayPrice = p.noPrice ? '-' : p.value + '元';
        // ★ 带上大类前缀（用户要求）："纪念钞 - 澳门格兰披治大奖赛35周年纪念钞 (KP04057)"、
        //   "人民币 - 第三套人民币 - 1960年 1角 枣红"。分类名本身可能已经带一层
        //   "父 - 子"，所以拼起来自然就是两段式。
        const catLabel = priceCategoryLabel(p.dataKey, p.type);
        const nameHtml = escapeHtml(catLabel ? catLabel + ' - ' + p.name : p.name);
        const versionHtml = p.version ? escapeHtml(p.version) : '';
        // data-pl-key：切换排序/筛选时用 FLIP 认人（同一行换位置要能认出来）
        html += `<div class="price-list-item" data-pl-key="${escapeHtml(p.name + '|' + (p.version || ''))}">`;
        html += `<span class="price-list-index">${i + 1}</span>`;
        html += `<span class="price-list-name">${nameHtml}${versionHtml ? ' (' + versionHtml + ')' : ''}</span>`;
        html += `<span class="price-list-value ${p.noPrice ? 'no-price' : ''}">${displayPrice}</span>`;
        html += `</div>`;
    }
    if (sorted.length === 0) {
        html += `<div class="price-list-empty">${emptyArt('tag')}啊呜，这里空空如也υ´• ﻌ •\`υ</div>`;
    }
    return html;
}

function onPriceSortOrFilterChange() {
    const sortSelect = document.getElementById('priceSortSelect');
    const filterSelect = document.getElementById('priceFilterSelect');
    const summaryEl = document.getElementById('priceListSummary');
    const bodyEl = document.getElementById('priceListBody');
    if (!sortSelect || !filterSelect || !bodyEl) return;

    // ★ 记到模块级变量上：这两个 <select> 会随「我的」页整体重渲染而重建，
    //   不记下来下次渲染就退回"默认排序 / 全部藏品"（用户要求保留选择）。
    priceSortOrder = sortSelect.value;
    priceFilter = filterSelect.value;

    // ★ 与首屏渲染共用同一套计算（settings.js 的 currentPriceListData）：
    //   以前汇总用 filterPricesByCategory 筛、列表在 renderPriceListItems 内部再筛一遍，
    //   两套逻辑一旦有差异就会"汇总数字和下面列表对不上"。
    //   它还可能把已失效的筛选值归一成 'all'，所以下面要把 select 同步回来。
    const data = currentPriceListData();
    if (filterSelect.value !== priceFilter) filterSelect.value = priceFilter;

    if (summaryEl) {
        summaryEl.innerHTML = priceListSummaryHtml(data.filteredPrices, data.filterInfo);
        // ★ 汇总行的进出改成"下滑展开 / 上滑收起"（用户要求，见 settings.js 的
        //   setPriceSummaryShown）；原来这里是 display 硬切 + 一次性淡入。
        setPriceSummaryShown(summaryEl, !!data.filterInfo);
    }

    // ★ 换了排序或筛选就是另一批内容了，旧的滚动位置没有意义（会停在一条
    //   和刚才完全无关的条目上），所以这里先回到顶部 —— 顺序很重要：
    //   必须在记录旧位置**之前**归零，否则 FLIP 记下的是"滚动过"的坐标，动画会整体错位。
    priceListScrollTop = 0;
    bodyEl.scrollTop = 0;

    const before = new Map();
    for (const el of bodyEl.querySelectorAll('.price-list-item')) {
        before.set(el.getAttribute('data-pl-key') || '', el.getBoundingClientRect().top);
    }

    bodyEl.innerHTML = renderPriceListItems(data.filteredPrices, priceSortOrder, priceFilter, data.filterInfo);

    // ★ 切换排序/筛选的 FLIP 动画（用户报的"切换缺少动画"）：
    //   原来是直接换 innerHTML —— 整片内容瞬间跳到新顺序，没有任何过渡。
    //   做法和"币海拾年"的条目动画同一套：换内容前记下每行的位置（data-pl-key 认人），
    //   换完先把行摆回旧位置（transform，不带过渡），下一帧放开让它滑到新位置。
    animatePriceListRows(bodyEl, before);
}

// 见 onPriceSortOrFilterChange 末尾的说明
function animatePriceListRows(bodyEl, before) {
    if (!bodyEl) return;
    const reduced = (typeof prefersReducedMotion === 'function') && prefersReducedMotion();
    const rows = [...bodyEl.querySelectorAll('.price-list-item')];
    rows.forEach(el => {
        const oldTop = before.get(el.getAttribute('data-pl-key') || '');
        if (oldTop === undefined) {
            // 这次筛选新进来的行：淡入 + 轻微上移
            if (!reduced) {
                el.classList.add('pl-enter');
                setTimeout(() => el.classList.remove('pl-enter'), 320);
            }
            return;
        }
        const dy = Math.round(oldTop - el.getBoundingClientRect().top);
        if (reduced || !dy) return;
        el.style.transition = 'none';
        el.style.transform = 'translateY(' + dy + 'px)';
        requestAnimationFrame(() => {
            el.style.transition = 'transform var(--dur-3) var(--ease-out)';
            el.style.transform = '';
            // 动画结束把内联样式清干净（用例里明确断言"动画结束后不留内联 style"）
            const done = () => {
                el.style.transition = '';
                el.style.transform = '';
                el.removeEventListener('transitionend', done);
            };
            el.addEventListener('transitionend', done);
            setTimeout(done, 600);        // 兜底：过渡被打断（比如用户又切了一次）也要清掉
        });
    });
}


function switchRatingMode(mode) {
    // ★ 点已经选中的那个：什么都不做。
    //   （用户："反复点击纸币/硬币，不要让柱状图左右的文字反复淡入" —— 同一个就别重演一遍。）
    if (mode === ratingMode) return;

    ratingMode = mode;
    const stats = computeStats(ratingMode);

    document.querySelectorAll('.rating-tab').forEach(el => {
        el.classList.toggle('active', el.dataset.mode === mode);
    });

    // ★ 纸币/硬币 的选中高亮是"滑动块"（用户要求）：切完高亮，把滑块滑到新的 tab 上。
    //   和「明暗」那几个选项共用 layoutSegmented（几何是从 tab 上量的，不写死宽度）。
    if (typeof layoutSegmented === 'function') {
        layoutSegmented(document.querySelector('.rating-tabs'), true);
    }

    // ★ 切换币种的图表动画：见 animateChartSwitch（用户设计，一次切换四件事同时发生）
    animateChartSwitch([
        ['ratingSection', buildRatingHTML(stats)],
        ['yearSection', buildYearHTML(stats)],
    ]);
}

// ★ 切换币种时的图表动画（用户设计）。
//   把卡片内容看成一串**槽位**，每个槽 = 一根柱状图的高度（28px）：
//     [卡片头] [评级得分统计 标题] [评级柱 × N] [藏品年代统计 标题] [年代柱 × M]
//   切一次做四件事：
//     ① 所有柱行**左右的文字**淡出（柱子本身先不动）
//     ② 换内容：柱子按**槽位**伸缩 —— 第 i 根对第 i 根，不管它前后代表的是什么评级/年代；
//        柱子的位置不挪，所以看起来就是同一个位置上的柱子在长/缩。
//        "从无到有"多出来的槽没有旧柱子，就从 0 拉长到应有长度
//     ③ 手停下来以后文字淡入；「藏品年代统计」标题滑到它的新槽位（柱数不同它就得上下挪），
//        它现在占的那个槽原本是根柱子 —— 那根柱子在①已经淡出消失了，于是"柱子淡出 → 标题淡入"
//     ④ 整个圆角卡片补一次高度过渡（柱数不同 → 展开/收起），卡片本身位置不动
//   ★ 连点保护（用户要求）：动画没收尾又点，就**不再重演一次淡出** —— 直接把内容换掉，
//     新文字**立刻亮着**（不是藏着等）。用户原话："我只是要求不要重复淡入"，
//     藏着等手停下来反而更糟。柱子的起止值每次都是现量的**渲染**宽度（px），
//     所以连点也是接着滑，不会跳。
//   减弱动效时全部跳过，直接换内容。
const CHART_SETTLE_MS = 130;
const chartAnim = { active: false, timers: [] };

function chartAnimClearTimers() {
    chartAnim.timers.forEach(t => clearTimeout(t));
    chartAnim.timers = [];
}

function chartAnimLater(fn, ms) {
    chartAnim.timers.push(setTimeout(fn, ms));
}

function animateChartSwitch(list) {
    const reduced = (typeof prefersReducedMotion === 'function') && prefersReducedMotion();
    const resume = chartAnim.active;         // 上一轮还没收尾 → 这次是连点
    chartAnimClearTimers();

    const card = document.querySelector('.stats-chart-card');
    const subs = card ? card.querySelectorAll('.stats-chart-sub') : null;
    const yearTitle = subs && subs[1] ? subs[1] : null;   // 「藏品年代统计」
    const jobs = list.map(([id, html]) => ({ sec: document.getElementById(id), html })).filter(j => j.sec);
    if (!jobs.length) { chartAnim.active = false; return; }

    // 动手改之前把要用的量一次量完（边改边读会互相打架）
    const oldW = jobs.map(j => [...j.sec.querySelectorAll('.stat-bar-fill')].map(f => f.getBoundingClientRect().width));
    const h0 = card ? Math.round(card.getBoundingClientRect().height) : 0;
    const titleTop0 = yearTitle ? yearTitle.getBoundingClientRect().top : 0;

    // 收尾：清内联样式和动画类（淡入不在这里做，见下面的 afterNextPaint）
    const finish = () => {
        if (card) {
            card.style.transition = '';
            card.style.height = '';
            card.style.overflow = '';
        }
        if (yearTitle) {
            yearTitle.style.transition = '';
            yearTitle.style.transform = '';
            yearTitle.style.opacity = '';
        }
        jobs.forEach(j => j.sec.querySelectorAll('.stat-bar-row')
            .forEach(row => row.classList.remove('text-out', 'text-in')));
        chartAnim.active = false;
    };

    const swapIn = (hideText) => {
        jobs.forEach(j => { j.sec.innerHTML = j.html; });

        // ② 柱子按槽位伸缩
        jobs.forEach((j, i) => {
            [...j.sec.querySelectorAll('.stat-bar-row')].forEach((row, k) => {
                // 正常切换：文字先藏住，换完内容再淡入一次。
                // 连点（hideText=false）：新文字直接亮着换内容 —— 用户要的是"不要反复淡入"，
                // 不是"一直藏着"（藏久了还不如不藏）。
                if (hideText) row.classList.add('text-out');
                if (reduced) return;
                const fill = row.querySelector('.stat-bar-fill');
                if (!fill) return;
                const to = fill.style.width;            // 目标长度（构建时写好的百分比）
                const from = oldW[i][k];                // 同一槽位上一根柱子的渲染宽度
                fill.style.transition = 'none';
                // ★ "从无到有"的柱子从 0 拉长（用户要求）；老柱子从它当前的长度接着走
                fill.style.width = (from === undefined ? 0 : from) + 'px';
                fill.dataset.to = to;
            });
        });

        // ③ 标题滑槽：先按旧的纵向位置偏移摆好，再滑回 0
        if (yearTitle && !reduced) {
            const dy = Math.round(titleTop0 - yearTitle.getBoundingClientRect().top);
            yearTitle.style.transition = 'none';
            yearTitle.style.transform = 'translateY(' + dy + 'px)';
            yearTitle.style.opacity = '0';
        }
        const h1 = card ? Math.round(card.getBoundingClientRect().height) : 0;

        if (reduced) {                                   // 减弱动效：不淡出、不动画，一次到位
            chartAnim.active = false;
            finish();
            return;
        }

        chartAnim.active = true;
        afterNextPaint(() => {
            jobs.forEach(j => j.sec.querySelectorAll('.stat-bar-fill').forEach(fill => {
                if (!fill.dataset.to) return;           // 交回 CSS 的 width 过渡，放开到新长度
                fill.style.transition = '';
                fill.style.width = fill.dataset.to;
                delete fill.dataset.to;
            }));
            if (yearTitle) {
                yearTitle.style.transition = 'transform var(--dur-3) var(--ease-out), opacity var(--dur-2) var(--ease-out)';
                yearTitle.style.transform = 'translateY(0)';
                yearTitle.style.opacity = '1';
            }
            // 文字淡入（只有正常切换才做；连点时文字本来就亮着）
            if (hideText) {
                jobs.forEach(j => j.sec.querySelectorAll('.stat-bar-row').forEach(row => {
                    row.classList.remove('text-out');
                    row.classList.add('text-in');
                }));
            }
            // ④ 卡片高度：先钉住旧高度，再等一帧过渡到新高度（同一帧写起止值会被合并成一次计算）
            if (card && h0 && Math.abs(h1 - h0) > 1) {
                card.style.overflow = 'hidden';
                card.style.height = h0 + 'px';
                requestAnimationFrame(() => {
                    if (!card.isConnected) return;
                    card.style.transition = 'height var(--dur-3) var(--ease-out)';
                    card.style.height = h1 + 'px';
                });
            }
        });
        chartAnimLater(finish, 420);                     // 动画跑完清场
    };

    // 减弱动效 / 连点：不重演淡出，直接换幕（连点时新文字直接亮着）
    if (reduced || resume) { swapIn(false); return; }
    chartAnim.active = true;
    jobs.forEach(j => j.sec.querySelectorAll('.stat-bar-row').forEach(r => r.classList.add('text-out')));
    chartAnimLater(() => swapIn(true), CHART_SETTLE_MS);
}

function buildRatingHTML(stats) {
    const maxGradeCount = stats.sortedGrades.length > 0
        ? Math.max(...stats.sortedGrades.map(g => g[1]), stats.ungraded)
        : 1;
    let html = `<div class="stats-bars">`;
    for (const [grade, count] of stats.sortedGrades) {
        const pct = (count / maxGradeCount * 100).toFixed(0);
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">${escapeHtml(grade)}</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${count}件</span>`;
        html += `</div>`;
    }
    if (stats.ungraded > 0) {
        const pct = (stats.ungraded / maxGradeCount * 100).toFixed(0);
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">未评级</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill ungraded" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${stats.ungraded}件</span>`;
        html += `</div>`;
    }
    if (stats.sortedGrades.length === 0 && stats.ungraded === 0) {
        html += `<div class="empty-colors-hint">${emptyArt('stats')}还没有评级数据鸭～</div>`;
    }
    html += `</div>`;
    return html;
}

function buildYearHTML(stats) {
    const maxYearCount = stats.sortedYears.length > 0
        ? Math.max(...stats.sortedYears.map(y => y[1]))
        : 1;
    let html = `<div class="stats-bars">`;
    for (const [decade, count] of stats.sortedYears) {
        const pct = (count / maxYearCount * 100).toFixed(0);
        const label = decade.slice(0, -1) + 's';
        html += `<div class="stat-bar-row">`;
        html += `<span class="stat-bar-label">${label}</span>`;
        html += `<div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pct}%"></div></div>`;
        html += `<span class="stat-bar-count">${count}件</span>`;
        html += `</div>`;
    }
    if (stats.sortedYears.length === 0) {
        html += `<div class="empty-colors-hint">${emptyArt('stats')}还没有年代数据鸭～</div>`;
    }
    html += `</div>`;
    return html;
}

// ==================== 数据导出 ====================

// 导出用的时间戳。
// ★ 用本地时间：原来的 new Date().toISOString() 是 UTC，在东八区晚上导出会显示成前一天。
function exportStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const date = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    return {
        date: date,
        time: p(d.getHours()) + ':' + p(d.getMinutes()),
        // 文件名里不能出现冒号（Windows 非法字符），所以用下划线 + 时分
        fileStamp: date + '_' + p(d.getHours()) + p(d.getMinutes())
    };
}

// 把内部 dataKey 映射成人能读的分类路径（纸币要带上父分类）。
// ★ 实现已统一到 core.js 的 getCategoryPath()，这里不再重复一份。
//   导出时找不到分类名就退回 dataKey，至少不丢信息。
function exportCategoryLabel(item) {
    return getCategoryPath(item.dataKey, item.type) || item.dataKey;
}

function exportJSON() {
    const allCopies = collectAllCopies();
    const stats = computeStats();
    const stamp = exportStamp();
    const exportData = {
        exportDate: stamp.date,
        exportTime: stamp.time,
        totalCount: allCopies.length,
        totalPrice: stats.totalPrice,
        items: allCopies.map(item => ({
            // ★ 原始字段全量展开 —— 这才是"备份"该有的样子：
            //   img1/img2 图片地址、copyId，以及各板块特有字段（国库券的 wmk、
            //   港币的 bank/signature/faceDate、流通币的直径重量边齿等）。
            //   原来只挑 12 个字段，图片地址和这些特有字段全都丢了。
            ...item.copy,
            // 以下是原始字段之外补充的规范化字段，便于直接查看与统计
            type: (typeof modeLabel === 'function') ? modeLabel(item.type) : item.type,
            category: exportCategoryLabel(item),
            dataKey: item.dataKey,
            seriesName: item.seriesName,
            grade: item.copy.condition || item.copy.grade || '',
            catalogNumber: item.copy.catalogNumber || item.copy.krause || ''
        }))
    };
    downloadFile(JSON.stringify(exportData, null, 2),
        `铜の币纪_藏品数据备份_导出时间${stamp.fileStamp}.json`, 'application/json');
}

function exportCSV() {
    const allCopies = collectAllCopies();
    const stamp = exportStamp();
    const headers = ['类型', '板块', '品类', '冠字号', '发行年份', '评级得分', '评级机构', '目录编号', '购入价格', '购买日期', '材质', '备注'];
    // ★ CSV 转义：字段内部的引号必须写成两个引号。
    //   原写法 /\\"/g 匹配的是「反斜杠 + 引号」，等于压根没转义裸引号，
    //   备注里只要出现一个 " 就会让整行错位（Excel 打开串行）。
    const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    let csv = '\uFEFF' + headers.map(esc).join(',') + '\n';
    for (const item of allCopies) {
        const c = item.copy;
        const row = [
            (typeof modeLabel === 'function') ? modeLabel(item.type) : item.type, exportCategoryLabel(item), item.seriesName,
            c.version || '', c.year || '', c.condition || c.grade || '',
            c.gradingCompany || '', c.catalogNumber || c.krause || '',
            c.price || '', c.purchaseDate || '', c.material || '', c.remark || ''
        ].map(esc);
        csv += row.join(',') + '\n';
    }
    downloadFile(csv, `铜の币纪_收藏品详细信息表格_导出时间${stamp.fileStamp}.csv`, 'text/csv;charset=utf-8');
}

function exportMarkdown() {
    const allCopies = collectAllCopies();
    const stats = computeStats();
    const stamp = exportStamp();
    let md = '# 藏品报告\n\n导出时间：' + stamp.date + ' ' + stamp.time + '\n\n';
    md += '## 总览\n\n- 藏品总数：' + allCopies.length + ' 件\n';
    md += '- 纸币：' + stats.notesCount + ' 件 | 硬币：' + stats.coinsCount + ' 件\n';
    md += '- 已记录价格：' + stats.prices.filter(p => !p.noPrice).length + ' 件\n';
    md += '- 总投入：' + stats.totalPrice.toFixed(0) + ' 元\n\n';
    const groups = {};
    for (const item of allCopies) {
        const catLabel = exportCategoryLabel(item);
        if (!groups[catLabel]) groups[catLabel] = [];
        groups[catLabel].push(item);
    }
    md += '## 按分类统计\n\n';
    for (const [label, items] of Object.entries(groups)) {
        md += '### ' + label + '\n\n- 数量：' + items.length + ' 件\n';
        const total = items.reduce((s, i) => s + (parseFloat(i.copy.price) || 0), 0);
        if (total > 0) md += '- 小计：' + total.toFixed(0) + ' 元\n';
        md += '\n';
    }
    downloadFile(md, `铜の币纪_收藏品概况报告_导出时间${stamp.fileStamp}.md`, 'text/markdown;charset=utf-8');
}

function exportPriceList() {
    const stats = computeStats();
    const stamp = exportStamp();
    // ★ 先排序、后编号。原来是先 map 出 idx、再 sort，idx 记的是"排序前的位置"，
    //   打印出来序号会乱跳（2. / 4. / 3. / 1. / 5.）。
    const sorted = [...stats.prices]
        .sort((a, b) => (b.noPrice ? 0 : b.value) - (a.noPrice ? 0 : a.value));
    let text = '价格清单（从高到低）\n导出时间：' + stamp.date + ' ' + stamp.time + '\n\n';
    sorted.forEach((p, i) => {
        text += (i + 1) + '. ' + p.name + (p.version ? ' (' + p.version + ')' : '') + ' - ' + (p.noPrice ? '-' : p.value + ' 元') + '\n';
    });
    text += '\n合计：' + stats.totalPrice.toFixed(0) + ' 元 | 均价：' + stats.avgPrice + ' 元/件\n';
    downloadFile(text, `铜の币纪_价格列表_导出时间${stamp.fileStamp}.txt`, 'text/plain;charset=utf-8');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
