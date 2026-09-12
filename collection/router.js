// ==================== router.js ====================
// 全站深链接（hash 路由）
//
// 为什么用 hash 而不是 History API + path：
//   本站部署在 GitHub Pages 的**项目页**（/collection/ 子路径），没有服务端路由。
//   用 History API 时刷新 /collection/notes/rmb3 会直接 404（除非再维护一份 404.html
//   跳转页）。hash 不需要任何服务端配合，刷新、直接粘贴、收藏、后退全部天然可用。
//
// 为什么集中在这里而不是把 URL 写入散落到各处：
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
//
// ★ 历史记录策略：全程只用 replaceState，**不新增任何历史记录**。
//   本站的浏览方式是"连续点很多分类/条目"，若每次跳转都 push 一条历史，
//   用户要退出本站得按几十次后退键 —— 后退键被站点绑架了。
//   现在整个浏览过程只占一条历史记录，后退直接回到进入本站之前的页面。
//   地址栏依然实时反映当前位置，所以分享、收藏、刷新还原都不受影响。
//   细节见 syncRoute() 的注释。

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

        // ★ 展开段：把"用户此刻展开了哪些系列/品种"编进 URL，让分类页链接可精确还原。
        //   形态：<mode>/<catId>[/<subId>]/s<i[,i...]>[/v<si.vi[,si.vi...]>]
        //   例：#notes/rmb/rmb3/s1,3/v1.0,3.2
        //   （parseRoute 一直能解析 s<i>/v<j> 单值形式，这里扩展为逗号列表，
        //     并保持对旧单值链接的兼容 —— 用户可能已经把老链接分享出去了。）
        //
        //   ★ 为什么是列表：手风琴本来就允许同时展开多个，只写一条的话
        //     用户展开了 3 个系列、分享出去只剩最上面那个（用户报告的问题）。
        //
        //   ★ 归属用 focusOwner 校验，不用 focusScope：
        //     focusScope 是"最近写入的作用域"，渲染分类页那一刻会被提前改成新分类，
        //     而序号还是旧分类的 —— 那时用 focusScope 校验会误判为合法
        //     （实测：从 rmb3 切到纪念钞，地址栏一度变成 #notes/commemorative/s1/v0）。
        //     focusOwner 只在"确定序号归属"时写入，与渲染时机无关。
        //   ★ 顺序即 DOM 序，天然稳定；这里再兜一层防御性排序与去重，
        //     避免任何上游异常产出 s3,1 这种看着就乱、也没法比较的链接。
        if (focusOwner === getCategoryScope() && focusSeries && focusSeries.length) {
            const seriesList = [...new Set(focusSeries)].filter(n => Number.isFinite(n)).sort((a, b) => a - b);
            if (seriesList.length) {
                seg.push('s' + seriesList.join(','));
                // 品种只在它的系列也展开时才写 —— 系列没展开的品种是肉眼看不到的，
                // 写进去会让链接声称一个用户此刻看不见的状态。
                const seriesSet = new Set(seriesList);
                const varietyList = [...new Set(focusVariety || [])].filter(k => {
                    const si = parseInt(String(k).split('.')[0], 10);
                    return Number.isFinite(si) && seriesSet.has(si);
                }).sort((a, b) => {
                    const [as, av] = String(a).split('.').map(Number), [bs, bv] = String(b).split('.').map(Number);
                    return (as - bs) || (av - bv);
                });
                if (varietyList.length) seg.push('v' + varietyList.join(','));
            }
        }
    }
    return seg.join('/');
}

// ========== 把 hash 解析成路由对象 ==========
//
// ★ 把 "s1,3" 这种列表段拆成数字数组。
//   同时兼容**旧的单值形式**（s1 / v2）：老链接可能已经被分享出去或存进书签，
//   不能让它们失效。两种形式在这里统一成列表，下游只处理列表。
function parseIdxList(raw) {
    if (raw === undefined || raw === null || raw === '') return [];
    const out = [];
    for (const piece of String(raw).split(',')) {
        const n = parseInt(piece, 10);
        if (Number.isFinite(n)) out.push(n);
    }
    return [...new Set(out)];
}

// ★ 品种段：新形式 "v1.0,3.2"（si.vi 对，能跨系列、能精确还原多个），
//   旧形式 "v2"（只有品种号，系列取同一个 s 段的值）。
function parseVarietyList(raw) {
    if (raw === undefined || raw === null || raw === '') return { pairs: [], bare: [] };
    const pairs = [], bare = [];
    for (const piece of String(raw).split(',')) {
        const m = /^(\d+)\.(\d+)$/.exec(piece.trim());
        if (m) { pairs.push([parseInt(m[1], 10), parseInt(m[2], 10)]); continue; }
        const n = parseInt(piece, 10);
        if (Number.isFinite(n)) bare.push(n);
    }
    return { pairs, bare: [...new Set(bare)] };
}

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

        // 分类：<mode>/<catId>[/<subId>][/s<i[,i]>][/v<si.vi[,si.vi]>][/c<k>]
        // ★ 判定"第二段是不是子分类"时，要把带逗号/小数点的序号段也认出来，
        //   否则 #notes/rmb3/s1,3 中的 "s1,3" 会被当成子分类 id。
        //   旧写法只认 /^[svc]\d+$/，遇到列表段就漏判。
        const r = {
            mode,
            view: VIEW.CATEGORY,
            catId: safeDecode(rest[0]),
            subId: rest[1] && !/^[svc][\d.,]+$/.test(rest[1]) ? safeDecode(rest[1]) : null
        };
        // 展开段：s / v / c 任意组合、任意顺序；s/v 支持逗号列表
        for (const p of rest) {
            const m = /^([svc])([\d.,]+)$/.exec(p);
            if (!m) continue;
            if (m[1] === 's') {
                r.sIdxList = parseIdxList(m[2]);
            } else if (m[1] === 'v') {
                const { pairs, bare } = parseVarietyList(m[2]);
                r.vPairList = pairs;
                r.vBareList = bare;
            } else {
                const n = parseInt(m[2], 10);
                if (Number.isFinite(n)) r.cIdx = n;
            }
        }
        // ★ 兼容旧链接：把单独的 s<i> / v<j> 也暴露成 sIdx/vIdx。
        //   优先取列表首项（旧链接本来就只有一条），列表为空时为 undefined。
        if (r.sIdxList && r.sIdxList.length) r.sIdx = r.sIdxList[0];
        if (r.vBareList && r.vBareList.length) r.vIdx = r.vBareList[0];
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
                focusOwner: null,
                focusScope: null,
                focusSeries: [],
                focusVariety: [],
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
                // ★ 展开段的序号必须**在这里**就写进快照。
                //   enterNotesOrCoinsTab() 是从 modeStates[mode] 恢复全局 focus* 的，
                //   而 renderSeriesList() 又是在 enter* **内部**跑的。
                //   若等到 enter* 之后再设全局，renderSeriesList() 看到的还是空数组 ——
                //   实测正是如此：它把 modeStates 里的序号又写回了空，URL 的展开段被抹掉。
                //   （focusOwner/scope 留空，由 renderSeriesList() 在渲染时补上。）
                //
                //   ★ 品种统一成 "si.vi" 形式：
                //     新链接直接给 v1.0,3.2 这样的对；旧链接给的是单独的 v<j>，
                //     此时品种号归属于同一个 s 段（旧语义就是"这个系列的某个品种"）。
                const sList = (route.sIdxList && route.sIdxList.length)
                    ? route.sIdxList.slice()
                    : ((route.sIdx === undefined) ? [] : [route.sIdx]);
                const vList = [];
                for (const pair of (route.vPairList || [])) vList.push(pair[0] + '.' + pair[1]);
                for (const vi of (route.vBareList || [])) {
                    const host = sList.length ? sList[0] : 0;
                    vList.push(host + '.' + vi);
                }
                if (sList.length) {
                    blank.focusSeries = sList;
                    blank.focusVariety = vList;
                }
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
        // ★ 展开信息要在 enter* **之前**登记：enter* 内部的 renderSeriesList()
        //   会消费它并直接生成已展开的标记（见 core.js 的 pendingReveal 注释）。
        //   主流程的 enter* 走 modeStates 里的 expandedSeries/expandedVarieties，
        //   这里单独给"路由指定的那些"再补一次，保证它们一定展开。
        //
        //   ★ 传列表而不是单值：深链接可以带多个系列/品种（#…/s1,3/v1.0,3.2），
        //     渲染时要一次性把**全部**目标都标成已展开 —— 若只传第一个，
        //     链接里其余的条目会打开后保持收起，等于链接说了不算。
        if (route.view === VIEW.CATEGORY && route.sIdx !== undefined) {
            pendingReveal = {
                // 与 category-view.js 里 renderSeriesList 的匹配口径一致
                catId: String(route.subId || route.catId || ''),
                sIdx: route.sIdx,
                sIdxList: (route.sIdxList || []).slice(),
                vPairList: (route.vPairList || []).map(p => [p[0], p[1]]),
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

    // ★ 收尾时**确定性**地把地址栏与真实状态对齐一次。
    //   为什么需要这一步：applyRoute 全程抑制 syncRoute（避免回写打架），
    //   于是"链接里写了什么"和"界面实际能呈现出什么"可能不一致：
    //     · 旧格式 #…/s1/v0 要规范化成 #…/s1/v1.0
    //     · 越界 #…/s99/v7 一个系列都展不开，应纠正回真实状态
    //     · 越界混在有效里 #…/s0,99 应只留 s0
    //   不这么做的话，地址栏"显示一个做不到的状态"，用户复制出去还是坏的。
    //   （这一步必须放在 finally **之后** —— applyingRoute 还是 true 时 syncRoute 会直接返回。）
    syncFocusAndRoute();
}

// 展开并滚动到路由指定的条目。
// 约定（与 category-view.js 渲染时写入的属性对应）：
//   系列体 body-<scope>-s<si>、品种列表 list-<scope>-v<si>-<vi>、条目 data-copy-vindex
// ★ 所有查询都限定在**当前活动容器**内（scopeAccordionLookup / findCopyElement），
//   因为视图容器是复用的 —— 隐藏容器里残留着其它分类的同序号节点，
//   用 document.getElementById 会命中错误的那个（审查报告 B7）。
//
// ★ 支持多条：链接可以是 #…/s1,3/v1.0,3.2，这里把每个目标都打开，
//   滚动条只滚到**第一个**目标（滚多个等于没滚，最后一个是随机的）。
async function revealCopyInCategory(route) {
    // 归一成"要处理的目标列表"：新链接给 sIdxList/vPairList，旧调用方给单个 sIdx/vIdx
    const sTargets = (route.sIdxList && route.sIdxList.length)
        ? route.sIdxList.slice()
        : ((route.sIdx === undefined || route.sIdx === null) ? [] : [route.sIdx]);
    if (!sTargets.length) return;

    // 每个系列要打开哪些品种（si -> [vi...]）
    const vBySeries = new Map();
    for (const pair of (route.vPairList || [])) {
        if (!vBySeries.has(pair[0])) vBySeries.set(pair[0], []);
        vBySeries.get(pair[0]).push(pair[1]);
    }
    if (route.vIdx !== undefined && route.vIdx !== null) {
        const host = sTargets[0];
        if (!vBySeries.has(host)) vBySeries.set(host, []);
        vBySeries.get(host).push(route.vIdx);
    }

    const scope = getCategoryScope();
    const firstSi = sTargets[0];
    const firstId = seriesScopeId(scope, firstSi);

    await waitFor(() => scopeAccordionLookup('body-' + firstId));

    // 先同步把**所有**目标系列标成已展开。
    // ★ 用 classList/内联样式直接改，而不是逐个 toggleSeries()：
    //   toggleSeries 会各自跑一段高度过渡动画，几十个目标叠加起来又慢又抖；
    //   而且它每次末尾都 syncFocusAndRoute()，中途态会被写进地址栏。
    //   这里一次性把 DOM 改到位，末尾统一 sync 一次即可。
    const openSeriesEl = (si) => {
        const sid = seriesScopeId(scope, si);
        const body = scopeAccordionLookup('body-' + sid);
        if (!body) return null;
        if (!body.classList.contains('open')) {
            body.classList.add('open');
            body.style.maxHeight = 'none';
            body.style.opacity = '1';
        }
        const icon = scopeAccordionLookup('icon-' + sid);
        if (icon && !icon.classList.contains('open')) icon.classList.add('open');
        return body;
    };
    const openVarietyEl = (si, vi) => {
        const vid = varietyScopeId(scope, si, vi);
        const list = scopeAccordionLookup('list-' + vid);
        if (!list) return null;
        if (!list.classList.contains('open')) {
            list.classList.add('open');
            list.style.maxHeight = 'none';
            list.style.opacity = '1';
        }
        const icon = scopeAccordionLookup('icon-' + vid);
        if (icon && !icon.classList.contains('open')) icon.classList.add('open');
        return list;
    };

    for (const si of sTargets) openSeriesEl(si);
    for (const [si, vis] of vBySeries) {
        if (!sTargets.includes(si)) continue;   // 系列没展开的品种不开（与 buildRoute 的口径一致）
        for (const vi of vis) openVarietyEl(si, vi);
    }

    // 地址栏跟上真实展开态。
    // ★ 必须放在下面的 tick 里，不能放在这里：此刻 DOM 未必就绪
    //   （waitFor 没等到时函数已经 return 了），而且概览跳转会在渲染后
    //   调 closeAllAccordions() 把刚展开的收掉 —— 那之后再同步才是最终状态。
    const syncAfter = () => {
        if (typeof syncFocusAndRoute === 'function') syncFocusAndRoute();
    };

    // 滚动只针对第一个目标；无品种系列的条目列表是**永久展开**的，
    // 但跳转流程会在渲染后调用 closeAllAccordions()，一旦被收起系列体的
    // scrollHeight 就会变成 0（"三角形转了但不展开"），所以这里仍显式确保它是开的。
    tick(() => {
        const seriesBody = scopeAccordionLookup('body-' + firstId);
        const firstVis = vBySeries.get(firstSi) || [];
        if (firstVis.length) {
            const vid = varietyScopeId(scope, firstSi, firstVis[0]);
            const vList = scopeAccordionLookup('list-' + vid);
            syncAfter();
            tick(() => {
                const target = (route.cIdx !== undefined && route.cIdx !== null)
                    ? findCopyElement(firstVis[0], route.cIdx)
                    : null;
                const el = target || vList || seriesBody;
                if (el && typeof scrollIntoViewSmooth === 'function') scrollIntoViewSmooth(el, 'center');
                syncAfter();
            }, 120);
        } else {
            tick(() => {
                const el = scopeAccordionLookup('copies-' + firstId);
                if (el && el.classList && !el.classList.contains('open')) {
                    el.classList.add('open');
                    el.style.maxHeight = 'none';
                    el.style.opacity = '1';
                }
                if (el && typeof scrollIntoViewSmooth === 'function') scrollIntoViewSmooth(el, 'center');
                syncAfter();
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
//
// ★ 历史记录策略：**只用 replaceState，永不 pushState**。
//   原因：浏览这个站点的自然方式是"连续点很多个分类/条目"，而每次跳转都 push 一条
//   历史的话，用户按一次后退只能退回上一个分类，要退出站点得按几十次
//   —— 浏览器后退键被这个站"绑架"了，回到别的网站变得非常烦人。
//   改成 replaceState 后：
//     · 地址栏仍然实时反映当前位置（#notes/rmb3 可分享、可收藏、刷新可还原）
//     · 整个浏览过程只占**一条**历史记录
//     · 后退键直接回到进入本站之前的那个页面（符合用户预期）
//
//   replace 形参保留是为了不动 16 处调用点，但它现在**不再影响行为** ——
//   历史上 replace=false 表示 pushState（"跳转"语义），那个语义已被废弃。
function syncRoute(replace) {
    if (applyingRoute) return;     // 正在应用路由，不要回写
    const route = buildRoute();
    if (route === lastRoute) return;
    lastRoute = route;
    const url = location.pathname + location.search + (route ? '#' + route : '');
    try {
        history.replaceState({ route }, '', url);
    } catch (e) {
        // file:// 或某些受限环境下 replaceState 会抛错。
        // ★ 注意不能用 `location.hash = route` 兜底 —— 改 hash 会**新增**一条历史记录，
        //   正好违背这里的目的。宁可不写地址栏（功能不受影响），也不要污染历史。
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
    if (!location.hash) syncRoute();
}

// 数据加载完成、界面渲染好之后调用；把 URL 里的深链接状态应用上去。
function applyInitialRoute() {
    const hash = location.hash;
    if (!hash) { syncRoute(); return; }
    const parsed = parseRoute(hash);
    if (!parsed) return;                 // 认不出来就别动，保持默认首页
    lastRoute = null;                    // 强制本次同步一定写一次
    applyRoute(hash).catch(e => console.warn('[router] 初始路由应用失败:', e));
}
