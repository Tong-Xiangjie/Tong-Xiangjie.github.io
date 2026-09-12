// ==================== router.js ====================
// 全站深链接（hash 路由）
//
// 为什么用 hash 而不是 History API + path：
//   本站部署在 GitHub Pages 的**项目页**（/collection/ 子路径），没有服务端路由。
//   用 History API 时刷新 /collection/notes/rmb3 会直接 404（除非再维护一份 404.html
//   跳转页）。hash 不需要任何服务端配合，刷新、直接粘贴、收藏、后退全部天然可用。
//
// 为什么集中在这里而不是把 pushState 散落到各处：
//   全站的导航入口很多（顶部 Tab、侧栏父/子项、搜索结果跳转、文章列表、专题分组…），
//   在每一处都插一次写 URL 极易漏、也极易在后续改动中失效。
//   这里的做法是反过来的：**从当前状态生成 URL**（buildRoute），在几个关键入口调用
//   syncRoute() 即可，新增页面只要保证 currentMode/currentView 等状态正确，URL 自动跟上。
//
// URL 形态（# 后面）：
//   #notes                        纸币概览
//   #coins                        硬币概览
//   #notes/rmb3                   纸币 - 第三套人民币
//   #notes/hk/boc                 纸币 - 香港 - 中银（带子分类）
//   #notes/rmb3/s0/v1/c2          并定位到第 0 系列 / 第 1 品种 / 第 2 枚（自动展开）
//   #notes/search/watermark/水印   按下拉选项搜 water 字段…（见下方 type 段）
//   #articles                     文章列表
//   #articles/12                  第 12 篇文章
//   #special                      方寸之间概览
//   #special/<configId>           某个专题
//   #settings                     设置
//
// 页面内锚点（搜索结果里的 #item-... 之类）不受影响：本路由器只认上面这些前缀，
// 认不出来的 hash 一律忽略（不报错、不改状态），避免将来加锚点时互相打断。

// ========== 路由状态 ==========
let routerReady = false;
// ★ 重入保护：applyRoute() 会调用 enter* 系列函数，那些函数内部又会调用
//   syncRoute()。没有这个标记就会二次写 URL（并把 hashchange 再次触发）。
let applyingRoute = false;
// 上一次写进地址栏的 URL，用于避免重复 replaceState
let lastRoute = null;

// ========== 从当前状态生成 hash ==========
// 返回不带 '#' 的片段
function buildRoute() {
    const seg = [];

    // ---------- 设置页优先（它盖在任意板块之上） ----------
    if (isSettingsMode) return 'settings';

    // ---------- 文章板块 ----------
    if (currentMode === MODE.ARTICLES) {
        seg.push('articles');
        if (currentArticleView === VIEW.READER && currentArticleIndex >= 0) {
            seg.push(String(currentArticleIndex));
        }
        return seg.join('/');
    }

    // ---------- 设置/文章之外的板块 ----------
    if (currentMode === MODE.SPECIAL) {
        seg.push('special');
        if (selectedSpecial !== null && selectedSpecial !== undefined) {
            seg.push(String(selectedSpecial));
            // 山河专题的两个视图
            if (typeof shanheViewMode === 'string' && shanheViewMode !== 'map') {
                seg.push('view-' + shanheViewMode);
            }
            // 时间轴专题的排序与筛选（只在非默认值时才写进 URL，保持链接简短）
            if (typeof timelineSortOrder === 'string' && timelineSortOrder !== 'desc') {
                seg.push('order-' + timelineSortOrder);
            }
            if (typeof timelineFilterYear === 'string' && timelineFilterYear && timelineFilterYear !== '全部') {
                seg.push('y-' + encodeURIComponent(timelineFilterYear));
            }
            if (typeof timelineFilterMonth === 'string' && timelineFilterMonth && timelineFilterMonth !== '全部') {
                seg.push('m-' + encodeURIComponent(timelineFilterMonth));
            }
        }
        return seg.join('/');
    }

    if (currentMode === MODE.COINS) seg.push('coins');
    else seg.push('notes');   // 默认纸币

    // ---------- 视图 ----------
    if (currentView === VIEW.SEARCH) {
        seg.push('search');
        // 用一个便于人读的前缀段放 type，关键词放最后一段
        if (currentSearchType && currentSearchType !== SEARCH_TYPE.ALL) {
            seg.push(String(currentSearchType));
        }
        if (currentSearchKeyword) seg.push(encodeURIComponent(currentSearchKeyword));
        return seg.join('/');
    }

    if (currentView === VIEW.CATEGORY && currentCategoryId) {
        seg.push(String(currentCategoryId));
        if (currentSubId) seg.push(String(currentSubId));
    }
    return seg.join('/');
}

// ========== 把 hash 解析成路由对象 ==========
function parseRoute(hash) {
    const raw = String(hash || '').replace(/^#/, '').replace(/^\/+/, '');
    if (!raw) return null;
    const parts = raw.split('/').filter(p => p !== '');
    if (parts.length === 0) return null;

    const head = parts[0];

    if (head === 'settings') return { mode: 'settings' };
    if (head === 'articles') {
        const idx = parts.length > 1 ? parseInt(parts[1], 10) : NaN;
        return { mode: 'articles', articleIndex: Number.isFinite(idx) ? idx : -1 };
    }
    if (head === 'special') {
        const r = { mode: 'special', configId: parts.length > 1 ? safeDecode(parts[1]) : null };
        // 余下片段是专题子视图参数：view-list / order-asc / y-2020 / m-5
        for (const p of parts.slice(2)) {
            if (p.startsWith('view-')) r.shanheView = p.slice(5);
            else if (p.startsWith('order-')) r.timelineOrder = p.slice(6);
            else if (p.startsWith('y-')) r.timelineYear = safeDecode(p.slice(2));
            else if (p.startsWith('m-')) r.timelineMonth = safeDecode(p.slice(2));
        }
        return r;
    }
    if (head === 'notes' || head === 'coins') {
        const mode = head;
        // 余下片段：可能什么都有，逐段判定
        const rest = parts.slice(1);

        // 搜索：<mode>/search[/<type>][/<keyword>]
        if (rest[0] === 'search') {
            const typeRaw = rest[1];
            const knownTypes = Object.values(SEARCH_TYPE);
            let type = SEARCH_TYPE.ALL, kw = '';
            if (typeRaw && knownTypes.includes(typeRaw)) {
                type = typeRaw;
                kw = rest.length > 2 ? safeDecode(rest.slice(2).join('/')) : '';
            } else {
                kw = rest.length > 1 ? safeDecode(rest.slice(1).join('/')) : '';
            }
            return { mode, view: VIEW.SEARCH, searchType: type, searchKeyword: kw };
        }

        if (rest.length === 0) return { mode, view: VIEW.OVERVIEW };

        // 分类：<mode>/<catId>[/<subId>][/s<i>/v<j>/c<k>]
        const r = {
            mode,
            view: VIEW.CATEGORY,
            catId: safeDecode(rest[0]),
            subId: rest[1] && !/^[svc]\d+$/.test(rest[1]) ? safeDecode(rest[1]) : null
        };
        // 定位段：s0 / v1 / c2 任意组合、任意顺序
        for (const p of rest) {
            const m = /^([svc])(\d+)$/.exec(p);
            if (!m) continue;
            const n = parseInt(m[2], 10);
            if (m[1] === 's') r.sIdx = n;
            else if (m[1] === 'v') r.vIdx = n;
            else r.cIdx = n;
        }
        return r;
    }

    // 认不出来 → 忽略（不抛错、不改状态）
    return null;
}

function safeDecode(s) {
    try { return decodeURIComponent(s); } catch { return s; }
}

// ========== 事件绑定表 ==========
// 路由靠**模拟点击**对应入口来应用状态，而不是直接改内部变量。
// 原因：各板块的进入函数（enterNotesOrCoinsTab / enterArticlesTab / enterSettingsFromTab…）
// 除了设置状态，还负责 Tab 高亮、搜索框回填、容器切换、动画等一整套副作用；
// 直接改状态会漏掉这些，出现"URL 对了但界面不对"。
// 模拟点击让路由与手动操作走**同一条代码路径**，行为天然一致。

function tick(fn, ms) {
    // 统一的"等布局/动画稳定后执行"，比散落的 setTimeout 更容易统一调整
    return setTimeout(fn, ms === undefined ? 60 : ms);
}

// 等待某条件成立（带超时），用于等异步渲染出节点
function waitFor(cond, timeout) {
    return new Promise(resolve => {
        const t0 = Date.now();
        (function poll() {
            let ok = false;
            try { ok = !!cond(); } catch { ok = false; }
            if (ok) return resolve(true);
            if (Date.now() - t0 > (timeout || 2500)) return resolve(false);
            requestAnimationFrame(poll);
        })();
    });
}

// ========== 应用路由 ==========
async function applyRoute(hash, opts) {
    const route = parseRoute(hash);
    if (!route) return false;

    applyingRoute = true;
    try {
        // ★ 先把目标板块的 modeStates 重置为"空白"，再交给 enter* 函数：
        //   那些函数是从 modeStates[mode] 里恢复状态的（saved.xxx），
        //   不重置的话，浏览器里已有的浏览状态会盖掉 URL 里写的状态。
        //   （这也是"复制链接发给别人能打开正确页面"的前提 —— 别人没有你的浏览状态。）
        if (route.mode === 'notes' || route.mode === 'coins') {
            const blank = {
                currentView: VIEW.OVERVIEW,
                currentCategoryId: null,
                currentSubId: null,
                currentSearchKeyword: '',
                currentSearchType: SEARCH_TYPE.ALL,
                expandedSeries: [],
                expandedVarieties: [],
                overviewScrollY: 0,
                categoryScrollY: 0,
                searchScrollY: 0
            };
            if (route.view === VIEW.SEARCH) {
                blank.currentView = VIEW.SEARCH;
                blank.currentSearchKeyword = route.searchKeyword || '';
                blank.currentSearchType = route.searchType || SEARCH_TYPE.ALL;
            } else if (route.view === VIEW.CATEGORY) {
                blank.currentView = VIEW.CATEGORY;
                blank.currentCategoryId = route.catId || null;
                blank.currentSubId = route.subId || null;
            }
            modeStates[route.mode] = Object.assign({}, modeStates[route.mode] || {}, blank);
        } else if (route.mode === 'articles') {
            articleState = Object.assign({}, articleState, {
                currentView: route.articleIndex >= 0 ? VIEW.READER : VIEW.LIST,
                currentIndex: route.articleIndex >= 0 ? route.articleIndex : -1,
                searchKeyword: '',
                listScrollY: 0,
                readerScrollY: 0
            });
        }

        // ★ 清空各视图容器：enter* 只在"容器为空"时才重新渲染，
        //   不清的话 URL 里写的分类/搜索就不会生效（会停在原页面上）。
        if (typeof invalidateRenderedViews === 'function') invalidateRenderedViews();

        // ---------- 设置页 ----------
        if (route.mode === 'settings') {
            if (typeof enterSettings === 'function') enterSettings();
            return true;
        }

        // ---------- 文章 ----------
        if (route.mode === 'articles') {
            if (typeof enterArticlesTab === 'function') await enterArticlesTab();
            return true;
        }

        // ---------- 专题 ----------
        if (route.mode === 'special') {
            if (typeof enterSpecialFromTab === 'function') enterSpecialFromTab();
            if (route.configId && route.configId !== 'overview') {
                await waitFor(() => typeof onSpecialOverviewItemClick === 'function');
                tick(() => {
                    try { onSpecialOverviewItemClick(route.configId); }
                    catch (e) { console.warn('[router] 打开专题失败:', route.configId, e); }
                }, 80);
                // 子视图参数（山河列表视图 / 时间轴排序与筛选）
                if (route.shanheView || route.timelineOrder || route.timelineYear || route.timelineMonth) {
                    await waitFor(() => selectedSpecial === route.configId, 1500);
                    tick(() => applySpecialSubView(route), 160);
                }
            }
            return true;
        }

        // ---------- 纸币 / 硬币 ----------
        // ★ 定位信息要在 enter* **之前**登记：enter* 内部的 renderSeriesList()
        //   会消费它并直接生成已展开的标记（见 core.js 的 pendingReveal 注释）。
        //   主流程的 enter* 走 modeStates 里的 expandedSeries/expandedVarieties，
        //   这里单独给"路由指定的那一条"再补一次，保证它一定展开。
        if (route.view === VIEW.CATEGORY && route.sIdx !== undefined) {
            pendingReveal = {
                // 与 category-view.js 里 renderSeriesList 的匹配口径一致
                catId: String(route.subId || route.catId || ''),
                sIdx: route.sIdx,
                vIdx: (route.vIdx === undefined) ? null : route.vIdx,
                cIdx: (route.cIdx === undefined) ? null : route.cIdx
            };
        }
        if (typeof enterNotesOrCoinsTab === 'function') enterNotesOrCoinsTab(route.mode);

        // 搜索视图：enter* 内部会按 saved.currentSearchKeyword 渲染，通常已够；
        // 这里再兜一次，确保关键词真的进了搜索框与结果区。
        if (route.view === VIEW.SEARCH && route.searchKeyword) {
            const inp = document.getElementById('searchInput');
            if (inp && inp.value !== route.searchKeyword) {
                inp.value = route.searchKeyword;
                if (typeof doSearch === 'function') doSearch();
            }
        }

        // 定位到具体条目：展开对应手风琴并滚到视野中央
        if (route.view === VIEW.CATEGORY && route.sIdx !== undefined) {
            await revealCopyInCategory(route);
        }

        return true;
    } finally {
        applyingRoute = false;
    }
}

// 展开并滚动到路由指定的条目。
// 约定（与 category-view.js 渲染时写入的属性对应）：
//   系列体 body-<scope>-s<si>、品种列表 list-<scope>-v<si>-<vi>、条目 data-copy-vindex
// ★ 所有查询都限定在**当前活动容器**内（scopeAccordionLookup / findCopyElement），
//   因为视图容器是复用的 —— 隐藏容器里残留着其它分类的同序号节点，
//   用 document.getElementById 会命中错误的那个（审查报告 B7）。
async function revealCopyInCategory(route) {
    const si = route.sIdx;
    if (si === undefined || si === null) return;

    const scope = getCategoryScope();
    const seriesId = seriesScopeId(scope, si);

    await waitFor(() => scopeAccordionLookup('body-' + seriesId));

    tick(() => {
        const seriesBody = scopeAccordionLookup('body-' + seriesId);
        if (seriesBody && !seriesBody.classList.contains('open')) toggleSeries(seriesId);

        if (route.vIdx !== undefined && route.vIdx !== null) {
            const vid = varietyScopeId(scope, si, route.vIdx);
            tick(() => {
                const vList = scopeAccordionLookup('list-' + vid);
                if (vList && !vList.classList.contains('open')) toggleVariety(vid);
                tick(() => {
                    const target = (route.cIdx !== undefined && route.cIdx !== null)
                        ? findCopyElement(route.vIdx, route.cIdx)
                        : null;
                    const el = target || vList || seriesBody;
                    if (el && typeof scrollIntoViewSmooth === 'function') scrollIntoViewSmooth(el, 'center');
                }, 120);
            }, 80);
        } else {
            // ★ 无品种系列（series 直接带 copies）：它的条目列表是**永久展开**的，
            //   这里只负责滚动到位。但仍显式确保它是开的 —— 单靠渲染时的 open 类不够稳，
            //   因为跳转流程会在渲染后调用 closeAllAccordions()，
            //   一旦它被收起，系列体的 scrollHeight 就会变成 0（"三角形转了但不展开"）。
            tick(() => {
                const el = scopeAccordionLookup('copies-' + seriesId);
                if (el && el.classList && !el.classList.contains('open')) {
                    el.classList.add('open');
                    el.style.maxHeight = 'none';
                    el.style.opacity = '1';
                }
                if (el && typeof scrollIntoViewSmooth === 'function') scrollIntoViewSmooth(el, 'center');
            }, 120);
        }
    }, 80);
}

// 在活动容器里按"品种序号 + 品种内序号"找条目。
// 依据 category-view.js 渲染时写下的 data-acc-v / data-copy-vindex。
// ★ 不能只按 data-copy-index 找：那是全局序号，多个品种会重复。
function findCopyElement(vIdx, cIdx) {
    const container = getRenderContainer();
    if (!container || vIdx === undefined || vIdx === null || cIdx === undefined || cIdx === null) return null;
    return container.querySelector(
        '.copy-item[data-acc-v="' + vIdx + '"][data-copy-vindex="' + cIdx + '"]'
    );
}

// 应用专题的子视图参数（山河列表/地图、时间轴排序与筛选）。
// 都通过调用原有的切换函数来生效，而不是直接改变量 —— 那些函数还要重建视图与动画。
function applySpecialSubView(route) {
    if (route.shanheView && typeof shanheViewMode === 'string' && shanheViewMode !== route.shanheView) {
        if (typeof shanheSwitchView === 'function') shanheSwitchView(route.shanheView);
    }
    if (route.timelineOrder && typeof timelineSortOrder === 'string' && timelineSortOrder !== route.timelineOrder) {
        if (typeof setTimelineOrder === 'function') setTimelineOrder(route.timelineOrder);
    }
    const yearSelect = document.getElementById('timelineYearFilter');
    const monthSelect = document.getElementById('timelineMonthFilter');
    let needFilter = false;
    if (route.timelineYear && yearSelect) { yearSelect.value = route.timelineYear; needFilter = true; }
    if (route.timelineMonth && monthSelect) { monthSelect.value = route.timelineMonth; needFilter = true; }
    if (needFilter && typeof onTimelineFilterChange === 'function') onTimelineFilterChange();
}

// ========== 写入地址栏 ==========
// 由各导航入口在完成跳转后调用。
//   replace = true  → replaceState（不新增历史记录，用于搜索关键词变化这类高频更新）
//   replace = false → 新增一条历史记录（用户"跳转"语义）
function syncRoute(replace) {
    if (applyingRoute) return;     // 正在应用路由，不要回写
    const route = buildRoute();
    if (route === lastRoute) return;
    lastRoute = route;
    const url = location.pathname + location.search + (route ? '#' + route : '');
    try {
        if (replace) history.replaceState({ route }, '', url);
        else history.pushState({ route }, '', url);
    } catch (e) {
        // file:// 或某些受限环境下 pushState 会抛错，退回直接改 hash（不新增历史也没关系）
        try { location.hash = route; } catch { /* 彻底不可用就静默放弃 */ }
    }
}

// ========== 初始化 ==========
function initRouter() {
    if (routerReady) return;
    routerReady = true;

    // 浏览器前进/后退
    window.addEventListener('popstate', function () {
        applyRoute(location.hash);
    });
    // 用户手动改地址栏里的 hash（含点击页内锚点）
    window.addEventListener('hashchange', function () {
        if (applyingRoute) return;
        const parsed = parseRoute(location.hash);
        if (!parsed) return;             // 不是本站路由格式（页面锚点等）→ 忽略
        if (buildRoute() === location.hash.replace(/^#/, '')) return;  // 已经就是这个状态
        applyRoute(location.hash);
    });

    // ★ 首次进入：把初始状态写进地址栏，这样从"无 hash"打开也能得到可分享的 URL。
    //   有 hash 时由 main.js 在数据就绪后调用 applyInitialRoute()。
    if (!location.hash) syncRoute(true);
}

// 数据加载完成、界面渲染好之后调用；把 URL 里的深链接状态应用上去。
function applyInitialRoute() {
    const hash = location.hash;
    if (!hash) { syncRoute(true); return; }
    const parsed = parseRoute(hash);
    if (!parsed) return;                 // 认不出来就别动，保持默认首页
    lastRoute = null;                    // 强制本次同步一定写一次
    applyRoute(hash).catch(e => console.warn('[router] 初始路由应用失败:', e));
}
