// ==================== core.js ====================
// 常量定义
const MODE = { NOTES: 'notes', COINS: 'coins', SPECIAL: 'special', ARTICLES: 'articles', SETTINGS: 'settings' };
const VIEW = { OVERVIEW: 'overview', CATEGORY: 'category', SEARCH: 'search', LIST: 'list', READER: 'reader' };
const SEARCH_TYPE = { ALL: 'all', NAME: 'name', VERSION: 'version', YEAR: 'year', AGENCY: 'agency', KRAUSE: 'krause', COPYID: 'copyid' };
const SEARCH_MODE = { CLICK: 'click', REALTIME: 'realtime' };
// ★ 目录编号前缀归一化。
//   实测各数据文件 catalogNumber/krause 的原始形态只有三类：
//     ① 纯编号（324 条，如 "41a" / "130"）——不带前缀
//     ② "KM# 130"（5 条，克劳斯硬币目录）——目录名 + '#' + 空格
//     ③ "Sun-J2a1"（1 条）——"Sun" 是**编号本身的一部分**，不是可省的前缀
//         （下方 formatCatalogNumber 也专门用 /^sun[-#]/i 保留它，可互相印证）
//   以前只把 'Pick# ' 当特例剥掉，于是 ② 搜不到（审查报告 B3）。
//   ★ 刻意**不**把 sun / 裸 krause 当作前缀：那会把 ③ 剥成 "J2a1"，造成真实回归。
const CATALOG_PREFIX_RE = /^(?:pick|km)\s*[-#]\s*/i;

// 搜索用字符串归一化：NFKC（全角→半角，ＫＭ＃→KM#）→ 去掉所有空白 → 小写。
// 这样 'KM# 130' / 'KM#130' / 'ＫＭ＃130' 会被视为同一个串。
function normalizeForSearch(v) {
    if (v === undefined || v === null) return '';
    return String(v).normalize('NFKC').replace(/[\s\u3000\u00a0]+/g, '').toLowerCase();
}

// 剥掉目录编号前缀（不区分大小写、不区分空白与全角）
function stripCatalogPrefix(v) {
    if (v === undefined || v === null) return '';
    return String(v).normalize('NFKC').replace(CATALOG_PREFIX_RE, '');
}

// ========== 目录编号格式化（统一规则） ==========
function formatCatalogNumber(num) {
    if (!num) return '';
    const s = String(num).trim();
    if (/unlisted/i.test(s)) return '';
    if (s.includes('#') || /^sun[-#]/i.test(s)) return s;
    return 'Pick# ' + s;
}

// ========== 图片路径处理 ==========
// ★ 图片已不再走 jsDelivr。本仓库体积远超 jsDelivr 的 50MB 包上限：
//   data.jsdelivr.com 对 @main 返回 403 "Package size exceeded the configured limit of 50 MB"，
//   于是 jsDelivr 把所有请求 302 到 raw.githubusercontent.com（非 CDN、严格限流、国内很慢）。
//   现改为与站点同源的 GitHub Pages 直出 —— 图片本就在仓库里、也早已被 Pages 发布。
//   数据文件里存的是完整站点 URL（https://tong-xiangjie.github.io/...），
//   所以 getImageUrl 通常原样返回；下面的相对路径分支仅作兼容。
const SITE_BASE = 'https://tong-xiangjie.github.io/';
const IMAGE_BASE = SITE_BASE + 'notecollection/image/';

// ★ 坏文件名占位符：数据里有一批写成 ".../rmb3/-1.jpg" 的引用 —— URL 前缀齐全、
//   但文件名是空的（只有 -1 / -2 这种编号），磁盘上当然不存在，必然 404。
//   实测 38 处 / 19 件（rmb3.js 30、rmb2.js 4、hk_gov.js 4）。
//   这里统一归一化成空串，让调用方直接走"无图"分支（分类卡片显示「我的图捏？？？」、
//   概览/时间轴显示「无图」），比修 38 处数据更稳：以后录数据再犯同样的错也不会破图，
//   而且不会再往 failedImages 里灌 404 → 顶部「图片加载失败」角标不会一直挂着。
//   注意：这是**渲染层**归一化，数据文件保持原样（check-data.mjs 仍会把这些列为
//   "文件名是空的" WARN，作为数据待补清单，这是有意保留的）。
const PLACEHOLDER_IMG_RE = /^-\d+\.[a-z0-9]+$/i;

function getImageUrl(path, subDir = 'comm') {
    if (!path) return '';
    // ★ 占位符判定必须放在最前面 —— 数据里的 img1/img2 写的是**完整绝对 URL**
    //   （如 https://tong-xiangjie.github.io/notecollection/image/rmb3/-1.jpg），
    //   放在 http:// 分支之后就永远走不到了。这里只看 basename，所以对
    //   722-1.jpg / 1943-10-17-1.jpg 这类正常带连字符的文件名不会误判。
    if (PLACEHOLDER_IMG_RE.test(path.substring(path.lastIndexOf('/') + 1))) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }
    if (path.startsWith('/')) {
        return path;                       // 根绝对路径：同源直出
    }
    let relative = path;
    if (relative.startsWith('image/')) {
        relative = relative.substring(6);
    }
    if (relative.includes('/')) {
        return IMAGE_BASE + relative;
    }
    return IMAGE_BASE + subDir + '/' + relative;
}

// ========== 缩略图路径处理 ==========
// 缩略图与原图同构，放在图片根目录的 thumb/ 子目录下，且统一为 .jpg：
//   原图   <图片根目录>/<相对路径>.<ext>
//   缩略图 <图片根目录>/thumb/<相对路径>.jpg
// 由 tools/make-thumbs.ps1 生成（宽度 320px / JPEG q80，实测约 13KB/张）。
// 映射不上的一律回退原图，因此漏生成只会多耗流量，不会导致图片显示不出来。
const IMAGE_ROOT_RE = /^(?:https?:\/\/tong-xiangjie\.github\.io)?\/(notecollection\/image|coincollection\/image|funcollection\/[^/]+\/images)\/(.+)$/i;

function getThumbUrl(path, subDir = 'comm') {
    const full = getImageUrl(path, subDir);
    if (!full) return '';
    const m = full.match(IMAGE_ROOT_RE);
    if (!m) return full;                       // 未知目录 / 外部 URL → 回退原图
    const rel = m[2];
    if (/\.svg$/i.test(rel)) return full;      // 矢量图不做缩略图
    const slash = rel.lastIndexOf('/');
    const dir = slash >= 0 ? rel.substring(0, slash + 1) : '';
    const name = slash >= 0 ? rel.substring(slash + 1) : rel;
    const stem = name.replace(/\.[^./]+$/, '');
    return SITE_BASE + m[1] + '/thumb/' + dir + stem + '.jpg';
}

// 属性值转义：URL 直接拼进 src="..." 时，引号会截断属性
function escapeAttr(url) {
    if (!url) return '';
    return String(url)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '%22')
        .replace(/'/g, '%27');
}

// 缩略图加载失败时回退原图：返回可直接拼进 <img ...> 的 onerror 属性片段
function thumbFallbackAttr(originalUrl) {
    if (!originalUrl) return '';
    return ` onerror="this.onerror=null;this.src='${escapeAttr(originalUrl)}'"`;
}

// ========== 网格图片源：缩略图 / 原图可切换 ==========
// 默认用缩略图。冷启动时一个板块的原图合计可达 98MB（缩略图约 1.4MB，约 70 倍），
// 而且原图要解码进 36×26 / 56×40 这种小格子，手机上很浪费。
// 但 Service Worker 会把浏览过的图都缓存下来（stale-while-revalidate），缓存热了
// 之后两者一样快 —— 想在缓存热的时候要更清晰的画质，就在设置里打开这个开关。
const GRID_ORIGINAL_KEY = 'collection-grid-original';

function gridUseOriginal() {
    try { return localStorage.getItem(GRID_ORIGINAL_KEY) === '1'; } catch (e) { return false; }
}

function setGridUseOriginal(on) {
    try { localStorage.setItem(GRID_ORIGINAL_KEY, on ? '1' : '0'); } catch (e) {}
}

// 网格 / 列表里的所有图片位统一走这里。
// 返回 { src, fallback }：fallback 交给 thumbFallbackAttr()，用原图时为空
// （原图都加载不出来，缩略图更不可能有 —— 缩略图就是从原图生成的）。
function gridImg(path, subDir = 'comm') {
    const full = getImageUrl(path, subDir);
    if (!full) return { src: '', fallback: '' };
    if (gridUseOriginal()) return { src: full, fallback: '' };
    const thumb = getThumbUrl(path, subDir) || full;
    return { src: thumb, fallback: thumb === full ? '' : full };
}
// =========================================================

// ========== 动效偏好 ==========
// 尊重系统的"减少动态效果"设置：动画与平滑滚动都应能关闭。
function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 平滑滚动（reduced-motion 时改为瞬时跳转）
// ★ 保留：跳转到搜索结果时用它把目标手风琴滚到视野中央
//   （此前它一度是"零调用"的死代码，现已接入 navigateToCopy）
function scrollIntoViewSmooth(el, block) {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: block || 'center'
    });
}

// 关闭弹层时先淡出再移除（专题灯箱、详细信息卡片都用它）。
// 原来这些地方是直接 overlay.remove()，蒙版会"啪"地一下消失。
function fadeOutAndRemove(el, ms) {
    if (!el || !el.parentNode) return false;
    if (el._fadeTimer) clearTimeout(el._fadeTimer);
    el.classList.add('lightbox-hide');
    const delay = prefersReducedMotion() ? 0 : (ms || 260);
    el._fadeTimer = setTimeout(function() {
        el._fadeTimer = null;
        if (el.parentNode) el.remove();
    }, delay + 40);
    return true;
}

// 精确高度的手风琴展开 / 收起。
// 为什么不用 CSS 里写死的 max-height：浏览器按时间线性插值 max-height，而元素实际
// 可视高度 = min(内容高度, 插值)。于是短面板几十毫秒就展完、剩下的时间全在空跑
// （观感是"啪一下弹开然后静止"），长面板则"冲得飞快然后戛然而止"。
// 这里先量出内容真实高度再过渡，动画速度就与内容长度无关；过渡结束后把高度限制
// 解除为 none，这样图片后加载导致的内容增长不会被裁掉。
function animateAccordion(el, open) {
    if (!el) return;
    clearTimeout(el._accTimer);
    const reduced = prefersReducedMotion();
    if (open) {
        const h = el.scrollHeight;
        el.style.maxHeight = h + 'px';
        el.classList.add('open');
        // ★ 兜底：scrollHeight 量到 0 说明此刻量不出内容高度（元素或其祖先尚未完成布局，
        //   例如刚 display 出来的容器、图片还没撑开）。若照原样把 max-height 钉成 0px，
        //   就会出现「三角形转了、系列体一点没长开」——用户看到的就是点了没反应。
        //   这时直接解除高度限制，宁可没有过渡动画，也不能让它停在 0。
        if (reduced || h === 0) { el.style.maxHeight = 'none'; return; }
        el._accTimer = setTimeout(function() {
            if (el.classList.contains('open')) el.style.maxHeight = 'none';
        }, 280);
    } else {
        el.style.maxHeight = el.scrollHeight + 'px';
        void el.offsetHeight;          // 先把当前高度固定下来，作为过渡起点
        el.classList.remove('open');
        el.style.maxHeight = '';       // 交回 CSS 的 max-height: 0
    }
}

// ========== 全局状态 ==========
let currentMode = MODE.NOTES;
let currentCategoryId = null;
let currentSubId = null;
let currentView = VIEW.OVERVIEW;
let currentSearchKeyword = '';
let currentSearchType = SEARCH_TYPE.ALL;
let isSettingsMode = false;
let settingsReturnState = null;
let isSidebarCollapsed = false;
let settingsPageCache = null;
let isArticlePreloading = false;

let selectedSpecial = null;
let specialPageCaches = {};
let specialCategoryTree = null;

let ratingMode = MODE.NOTES;

// ★ 「待展开条目」：从概览/搜索结果跳进分类页时，目标系列与品种应当在**渲染的那一刻**
//   就带 open 类和 max-height，而不是渲染完再靠 setTimeout 去 DOM 里找节点补开。
//   原因：后者是一条异步链（waitFor → 取节点 → toggleSeries → animateAccordion），
//   任何一环落空（节点还没生成、活动容器漂移、这次渲染的目标分类与作用域不一致）
//   都会静默失败 —— 表现就是用户报的"概览跳转点不开"，且不报错、无法排查。
//   改成渲染时生成后：展开与否是渲染的**输入**，不再依赖查找结果。
//   catId 参与匹配（取 currentSubId || currentCategoryId），确保这份待展开状态
//   确实属于正在渲染的那个分类，切分类时不会误展同序号系列。
let pendingReveal = null;   // { catId, sIdx, vIdx, cIdx }

// ★ 「展开状态」（用于把展开的手风琴编码进地址栏，让分类页的链接精确还原）。
//   与 pendingReveal 的区别很重要：
//     · pendingReveal 是**一次性指令** —— 渲染时消费掉立刻置 null，只负责"这次要展什么"；
//     · 下面这几个是**持续状态** —— 反映"用户此刻展开了哪些系列/品种"，
//       buildRoute() 要靠它生成 #notes/rmb3/s1,3/v1.0,3.2 这种精确链接。
//
//   ★ 用**列表**而不是单个值：手风琴本来就允许同时展开多个，地址栏只记一条的话，
//     用户展开了 3 个系列、分享出去只剩最上面那个（实测报告的问题）。
//     （命名里的 focus* 是历史遗留，实际语义是"已展开集合"。）
//
//   ★ 为什么 scope 要分成两个变量（这是踩过的坑）：
//     focusOwner —— 下面这些序号**属于哪个分类**（buildRoute 校验它）。
//     focusScope —— 最近一次写入的容器作用域（与 owner 分开，避免渲染时序污染）。
//   二者在稳定状态下相等，但**渲染分类页的那一刻会短暂不等**：
//   renderSeriesList() 会把 focusScope 写成新分类的 scope，而序号还是旧分类的。
//   如果只用一个变量同时表达"归属"和"当前"，这个瞬间就会把旧分类的序号
//   当成新分类的写进 URL（实测：从 rmb3 切到纪念钞 → #notes/commemorative/s1/v0）。
//   拆开之后，"归属校验"只看 focusOwner，与渲染时机的先后无关。
let focusOwner = null;      // 序号所属分类的作用域；null 表示"序号不可信"
let focusScope = null;      // 最近写入的作用域（= getCategoryScope()）
let focusSeries = [];       // 已展开的系列 si 列表（升序）
// 已展开的品种，扁平化为 "si.vi" 字符串列表（如 ['1.0','3.2']）。
// ★ 扁平化是有意的：buildRoute 要写成 v1.0,3.2 这种紧凑形式，
//   解析回来也是一层数组；如果用 [{si,vi}] 则处处要拆装，反而容易错。
let focusVariety = [];

let modeStates = {
    notes: {
        currentCategoryId: null, currentSubId: null, currentView: VIEW.OVERVIEW,
        currentSearchKeyword: '', currentSearchType: SEARCH_TYPE.ALL,
        searchMode: SEARCH_MODE.REALTIME, isSidebarCollapsed: false,
        expandedSeries: [], expandedVarieties: [],
        focusOwner: null, focusScope: null, focusSeries: [], focusVariety: [],
        overviewScrollY: 0, categoryScrollY: 0, searchScrollY: 0
    },
    coins: {
        currentCategoryId: null, currentSubId: null, currentView: VIEW.OVERVIEW,
        currentSearchKeyword: '', currentSearchType: SEARCH_TYPE.ALL,
        searchMode: SEARCH_MODE.REALTIME, isSidebarCollapsed: false,
        expandedSeries: [], expandedVarieties: [],
        focusOwner: null, focusScope: null, focusSeries: [], focusVariety: [],
        overviewScrollY: 0, categoryScrollY: 0, searchScrollY: 0
    }
};

let articleState = {
    currentView: VIEW.LIST,
    currentCategory: 'all',
    currentIndex: -1,
    searchKeyword: '',
    listScrollY: 0,
    readerScrollY: 0
};

// ========== 图片弹窗状态 ==========
let hammerManager = null;
let currentScale = 1, currentX = 0, currentY = 0;
let currentModalImg1 = '', currentModalImg2 = '';

// ========== 文章状态 ==========
let currentArticleView = VIEW.LIST;
let currentArticleCategory = 'all';
let currentArticleIndex = -1;
let collectedArticles = [];
let articleContentCache = {};
let articlePlainTextCache = {};
let articleSearchKeyword = '';
let articleSearchMode = 'title';
let articleCategoryTree = [];

// ========== 独立滚动容器系统 ==========
const viewScrollContainers = {};

function ensureViewContainer(key) {
    if (!viewScrollContainers[key]) {
        const div = document.createElement('div');
        div.className = 'view-scroll-container';
        div.id = 'view-' + key.replace(/[^a-zA-Z0-9_\-]/g, '_');
        div.style.cssText = 'height:100%;overflow-y:auto;display:none;';
        const content = document.querySelector('.content');
        if (!content) {
            console.error('Content element not found');
            return null;
        }
        content.insertBefore(div, document.getElementById('app'));
        viewScrollContainers[key] = div;
    }
    return viewScrollContainers[key];
}

// ★ 所有模式都使用独立容器，#app 不再用于渲染
function getContainerKey() {
    // ★ 优先判断：如果正在设置页，直接返回设置容器 key
    if (isSettingsMode) {
        return 'settings_container';
    }

    if (currentMode === MODE.ARTICLES) {
        if (currentArticleView === VIEW.READER && currentArticleIndex >= 0) {
            return 'articles_reader_' + currentArticleIndex;
        }
        return 'articles_list';
    }
    if (currentMode === MODE.SPECIAL) {
        return 'special_container';
    }
    if (currentMode === MODE.NOTES) {
        if (currentView === VIEW.SEARCH) return 'notes_search';
        if (currentView === VIEW.CATEGORY) return 'notes_category_' + String(currentSubId || currentCategoryId || 'overview').replace(/[^a-zA-Z0-9_\-]/g, '_');
        return 'notes_overview';
    }
    if (currentMode === MODE.COINS) {
        if (currentView === VIEW.SEARCH) return 'coins_search';
        if (currentView === VIEW.CATEGORY) return 'coins_category_' + String(currentCategoryId || 'overview').replace(/[^a-zA-Z0-9_\-]/g, '_');
        return 'coins_overview';
    }
    return 'default';
}

function switchToCurrentContainer() {
    const key = getContainerKey();
    switchViewContainer(key);
}

function switchViewContainer(key) {
    // 1. 隐藏所有容器
    for (const k of Object.keys(viewScrollContainers)) {
        viewScrollContainers[k].style.display = 'none';
    }
    // 2. 隐藏 #app
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    // 3. 获取或创建目标容器
    const container = ensureViewContainer(key);
    if (!container) return;

    // ★ 不要清空内容，不要重置滚动，由各渲染函数自行处理
    container.style.display = 'block';
}

function getRenderContainer() {
    const key = getContainerKey();
    return ensureViewContainer(key);
}

// ========== ★ 手风琴（系列 / 品种）ID 的作用域处理 ==========
// 问题（审查报告 B7，复现脚本 repro-accordion-id-collision.mjs）：
//   系列与品种的 DOM id 是 `series-${si}` / `v-${si}-${vi}`，**没有分类前缀**。
//   而视图容器的 DOM 是复用的（switchViewContainer 只改 display，不清空），
//   于是隐藏容器里旧分类的 body-series-0 仍然留在文档中。
//   document.getElementById('body-series-0') 返回的是**文档序第一个**，
//   结果是"在 A 分类展开的系列，切到 B 分类后被恢复到了 A 的隐藏节点上"。
// 修法（两道保险）：
//   ① ID 带上分类作用域前缀 → 不同分类之间不可能再撞名；
//   ② 查询一律限定在**当前活动容器**内（scopeAccordionLookup）→
//      即使还有别的历史节点残留在文档里也不会被误命中。

// 当前分类的作用域标识。用 getContainerKey() 保证与"哪个滚动容器"一一对应
// （所以设置页、搜索结果、文章等非分类视图不会与分类页冲突）。
function getCategoryScope() {
    return getContainerKey().replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function seriesScopeId(scope, si) { return scope + '-s' + si; }
function varietyScopeId(scope, si, vi) { return scope + '-v' + si + '-' + vi; }

// 收起活动容器里的全部手风琴（系列 + 品种）。
// 深链接/搜索结果跳转前先收干净，避免一次性播放十几个展开动画。
// ★ 只动活动容器：隐藏容器里的状态保留着，用户切回去还是原样。
//
// ★★ 必须跳过 [data-acc-permanent]：
//   无品种（series 直接带 copies）的系列，它的条目列表是**永久展开**的 ——
//   没有对应的品种头可以再点开，一旦被收起就再也打不开。
//   历史 bug：概览跳转的流程是「渲染时展开 → 50ms 后 closeAllAccordions() →
//   revealCopyInCategory() 只按 vIdx 重开品种」，而这类系列的 vIdx 恒为 null，
//   于是 copy-list 被关掉后无人重开 → max-height 锁死在 0 → 系列体的
//   scrollHeight 变成 0 → 表现为「三角形转了但什么都不展开」。
function closeAllAccordions() {
    const container = getRenderContainer();
    if (!container) return;
    $$('.series-body.open, .copy-list.open', container).forEach(el => {
        if (el.hasAttribute && el.hasAttribute('data-acc-permanent')) return;   // 永久展开，不参与收起
        el.classList.remove('open');
        el.style.maxHeight = '';
    });
    $$('.series-expand-icon.open, .variety-expand-icon.open', container).forEach(el => {
        el.classList.remove('open');
    });
}

// ★ 拿到某个节点所属的「视图容器根」。
//   被点击的节点自己知道它在哪个容器里 —— 这比"猜当前活动容器"可靠得多。
function getViewRootOf(el) {
    let n = el;
    while (n) {
        if (n.classList && n.classList.contains('view-scroll-container')) return n;
        n = n.parentNode;
    }
    return null;
}

// ★ 两个查询原语：把"在哪个范围里找"集中到一处。
//   root 可以是任意元素（含视图容器）；传 null 表示全局查。
//   不能假定 root 一定是视图容器 —— 从被点节点往上找可能只到 .series-container，
//   这时用 root.querySelectorAll 依然正确（范围更小、不会漏）。
function $$(sel, root) {
    root = root || document;
    if (typeof root.querySelectorAll === 'function') return [...root.querySelectorAll(sel)];
    return [];
}
function $(sel, root) {
    root = root || document;
    if (typeof root.querySelector === 'function') return root.querySelector(sel);
    return null;
}

// 在可能的位置里查手风琴节点。
// ★ 为什么不像一开始那样"只查活动容器"：
//   活动容器是由 getContainerKey() 现算的，它依赖 currentMode / currentCategoryId /
//   currentSubId / currentView / isSettingsMode 这一串可变状态。只要其中任何一项在
//   "渲染时"和"点击时"之间发生漂移（切板块、深链接回填、设置页往返、画质开关作废
//   容器、路由应用中途……），查询就会落空；而 toggleSeries 里是 `if (!body) return;`
//   —— 静默什么都不做，用户看到的就是"点了没反应"。
//   现在改成按可靠性由高到低逐级下探，任何一级命中即可：
//     ① 被点元素自己所在的视图容器（最可靠：节点在哪就查哪）
//     ② 当前活动容器
//     ③ 任意已存在的视图容器
//     ④ 全局（id 已带分类作用域、全局唯一，不会串台）
function scopeAccordionLookup(domId, hintEl) {
    const id = String(domId);
    const sel = '[id="' + id.replace(/"/g, '\\"') + '"]';

    // ① 被点节点所在的容器
    if (hintEl) {
        const root = getViewRootOf(hintEl) || hintEl.parentNode;
        const hit = $(sel, root);
        if (hit) return hit;
    }
    // ② 当前活动容器
    const active = getRenderContainer();
    if (active) {
        const hit = $(sel, active);
        if (hit) return hit;
    }
    // ③ 其它已渲染的视图容器
    for (const k of Object.keys(viewScrollContainers)) {
        const c = viewScrollContainers[k];
        if (!c || c === active) continue;
        const hit = $(sel, c);
        if (hit) return hit;
    }
    // ④ 全局兜底
    return document.getElementById(id);
}

// ★ 点击路径专用：**就地解析**手风琴目标，而不是按 id 全文档查找。
//
//   为什么还需要这个（scopeAccordionLookup 不够吗）：
//   scopeAccordionLookup 的第 ① 级是"在 hintEl 所属的**视图容器**里按 id 查"。
//   视图容器粒度太粗 —— B7 的根因正是"跨板块切换只切 display、容器里的旧 DOM 全留着"，
//   于是同 id 节点可能在不同时刻存在于同一个视图容器内。第 ①/② 级一旦命中**另一个**
//   节点（旧批量残留、或隐藏容器的同 id 残留），点击就会作用在看不见的节点上：
//   用户看到三角形转了（图标恰好解析对了），系列体却纹丝不动。这就是
//   "点了没反应 / 必须切一下板块再回来才好"的成因。
//
//   而点击时的 DOM 结构是**确定**的，根本不用查 id：
//     .series-year-row      = hintEl.parentNode           → 里面必有 .series-body
//     .variety-row          = hintEl.parentNode           → 里面必有 .copy-list
//     .copy-list            = hintEl.nextElementSibling   → 条目列表就是它的下一个兄弟
//   所以先只在这几个节点里找；找不到再逐级放宽到视图容器、全局。
//   顺序是"由近及远"：结构越近，越不可能串台。
function accordionTargetOf(hintEl, domId, localSel) {
    const id = String(domId);
    const idSel = '[id="' + id.replace(/"/g, '\\"') + '"]';
    const match = (root) => {
        if (!root || typeof root.querySelector !== 'function') return null;
        if (localSel) {
            // 就地找：本地选择器 + id 双重确认，防止相邻的兄弟被误认成目标
            const local = root.querySelector(localSel);
            if (local && local.id === id) return local;
        }
        return root.querySelector(idSel);
    };
    if (!hintEl) return scopeAccordionLookup(domId, hintEl);
    // ① 就地：被点节点的父节点（即它在 DOM 里天然所属的那个行容器）
    const parent = hintEl.parentNode;
    const near = match(parent);
    if (near) return near;
    // ② 就地：被点节点的下一个兄弟（品种行 → .copy-list 就是紧邻的下一个兄弟）
    const next = hintEl.nextElementSibling;
    if (next && next.id === id) return next;
    // ③ 放宽到被点节点所属的视图容器
    const viewRoot = getViewRootOf(hintEl);
    const inView = match(viewRoot);
    if (inView) return inView;
    // ④ 最后才用原来的多级查找 / 全局兜底
    return scopeAccordionLookup(domId, hintEl);
}

// 收集展开态。
// ★ 按「作用域前缀」过滤，而不是按「活动容器」过滤。
//   id 形如 body-notes_category_rmb3-s0，前缀本身就唯一确定了分类。
//   只查活动容器时，一旦活动容器为空或发生漂移，就会收集到"空状态"，
//   恢复阶段再把用户原本开着的系列全关掉 —— 表现为"展开状态莫名丢失"。
//   改成按前缀收集后：既不串台（前缀不同），也不丢状态（不依赖活动容器）。
function collectScopedExpanded() {
    const scope = getCategoryScope();
    const seriesPrefix = 'body-' + scope + '-s';
    const varietyPrefix = 'list-' + scope + '-v';
    const expandedSeries = [];
    const expandedVarieties = [];
    const seenSeries = new Set();
    const seenVarieties = new Set();

    const scan = (root) => {
        $$('.series-body.open', root).forEach(el => {
            const id = el.id || '';
            if (id.startsWith(seriesPrefix) && !seenSeries.has(id)) {
                seenSeries.add(id);
                expandedSeries.push(id.slice('body-'.length));
            }
        });
        $$('.copy-list.open', root).forEach(el => {
            const id = el.id || '';
            if (id.startsWith(varietyPrefix) && !seenVarieties.has(id)) {
                seenVarieties.add(id);
                expandedVarieties.push(id.slice('list-'.length));
            }
        });
    };
    for (const k of Object.keys(viewScrollContainers)) {
        if (viewScrollContainers[k]) scan(viewScrollContainers[k]);
    }
    scan(document);   // 全局兜底（前缀已保证不串台）

    return { expandedSeries, expandedVarieties };
}

// ★ 从**真实 DOM** 反推"已展开集合"，写进 focusOwner / focusScope / focusSeries / focusVariety。
//
//   为什么读 DOM 而不是让 toggleSeries 自己记账：
//   与其在点击处维护一套可能与 DOM 不同步的变量，不如在点击后（DOM 已是最终状态）
//   直接读出真实展开态。这样地址栏与界面所见严格一致，
//   不会出现"URL 说开着、界面没开"。
//
//   ★ 采集**全部**展开项（早期版本只取第一条，导致多开时链接丢失其余条目 —— 用户报告）。
//     顺序按文档序，结果稳定；同一系列内的品种按文档序。
function focusFromDom() {
    const container = (typeof getRenderContainer === 'function') ? getRenderContainer() : null;
    if (!container) return;
    // ★ 只认活动容器：容器的 DOM 是复用的（隐藏着、内容还留着），
    //   若读到隐藏容器里旧分类的手风琴，focusSeries 就会记成别分类的序号。
    //   ★ 判定必须用**内联** display —— switchViewContainer() 正是用
    //   style.display='none'/'block' 来切容器的。不能用 getComputedStyle：
    //   隐藏容器的祖先才是 display:none，它自己的 computed display 仍是 block，
    //   用 computed 判定等于没判。
    if (!container.style || container.style.display !== 'block') return;
    // ★ 用 getCategoryScope() 而不是 getContainerKey()：必须与 renderSeriesList()
    //   写入的 accScope 是同一个口径，否则 buildRoute 的归属校验永远为假、序号段被静默丢掉。
    focusScope = (typeof getCategoryScope === 'function') ? getCategoryScope() : null;
    focusOwner = focusScope;    // 刚采集到的序号就属于此刻这个分类
    focusSeries = [];
    focusVariety = [];

    const bodies = container.querySelectorAll('.series-body.open');
    for (const body of bodies) {
        const m = /-s(\d+)$/.exec(body.id || '');
        if (!m) continue;
        const si = parseInt(m[1], 10);
        if (!Number.isFinite(si)) continue;
        focusSeries.push(si);
        // 这一系列里开着的品种列表
        for (const list of body.querySelectorAll('.copy-list.open')) {
            const mv = /-v\d+-(\d+)$/.exec(list.id || '');
            if (!mv) continue;
            const vi = parseInt(mv[1], 10);
            if (Number.isFinite(vi)) focusVariety.push(si + '.' + vi);
        }
    }
    // 稳定排序（DOM 序理应已升序，这里只是保证不依赖浏览器实现细节）
    focusSeries.sort((a, b) => a - b);
    focusVariety.sort((a, b) => {
        const [as, av] = a.split('.').map(Number), [bs, bv] = b.split('.').map(Number);
        return (as - bs) || (av - bv);
    });
}

// ★ 作废所有已渲染视图的 DOM。
//   视图容器的 DOM 是复用的 —— switchViewContainer 特意"不清空、不重置滚动"，
//   返回时也只在"容器里没有内容"时才重渲染（见 tab-switcher 的 restoreNotesCoinsFromSettings）。
//   所以凡是会改变所有 <img src> 的全局设置（如「网格画质」），改完必须主动作废，
//   否则要刷新页面才生效。清空之后各视图会自然走"没内容 → 重新渲染"那条路径。
function invalidateRenderedViews() {
    for (const k of Object.keys(viewScrollContainers)) {
        if (k === 'settings_container') continue;   // 设置页自己不用动
        const el = viewScrollContainers[k];
        if (el) el.innerHTML = '';
    }
    // 山河地图把渲染好的节点缓存在 special.js 里复用，光清容器不够
    if (typeof dropShanheMapCache === 'function') dropShanheMapCache();
}

function triggerViewAnimation() {
    const key = getContainerKey();
    const el = viewScrollContainers[key];
    if (!el) return;

    // ★ 强制重置动画：先移除动画，强制回流，再恢复
    el.style.animation = 'none';
    void el.offsetHeight;          // 强制回流
    el.style.animation = '';

    // ★ 正常触发 content-enter 类动画
    el.classList.remove('content-enter');
    void el.offsetHeight;          // 再次强制回流，确保类移除生效
    el.classList.add('content-enter');
}

// ========== 数据读取函数 ==========
function getSpecialConfigs() { return window.SPECIAL_CONFIGS || []; }

function buildSpecialCategoryTree() {
    specialCategoryTree = [];
    for (const config of getSpecialConfigs()) {
        const children = [];
        if (config.categories) {
            for (const cat of config.categories) {
                children.push({ id: cat.id, name: cat.name, dataKey: config.id });
            }
        }
        specialCategoryTree.push({
            id: config.id, name: config.name, dataKey: config.id,
            children: children.length > 0 ? children : null
        });
    }
}

function getCategoryTree() {
    if (currentMode === MODE.SPECIAL) return specialCategoryTree;
    return currentMode === MODE.NOTES ? categoryTree : coinCategoryTree;
}

function getAllDataKeys() {
    return currentMode === MODE.NOTES ? allDataKeys : coinAllDataKeys;
}

function getData(dataKey) {
    if (currentMode === MODE.NOTES) {
        return window.DATA_MAP && window.DATA_MAP[dataKey] ? window.DATA_MAP[dataKey] : null;
    } else if (currentMode === MODE.COINS) {
        return window.COIN_DATA_MAP && window.COIN_DATA_MAP[dataKey] ? window.COIN_DATA_MAP[dataKey] : null;
    } else if (currentMode === MODE.SPECIAL) {
        return window.FUN_DATA_MAP && window.FUN_DATA_MAP[dataKey] ? window.FUN_DATA_MAP[dataKey] : null;
    }
    return null;
}

// 把内部 dataKey 映射成人能读的分类路径（纸币要带上父分类，如 rmb3Data → 中国 - 第三套人民币）。
// ★ 全站只此一份：导出（stats.js）与时间轴（special.js）都用它。
//   以前 stats.js 里抄了三份同样的循环、special.js 里还有一份 getCategoryPath，已合并到这里。
//   找不到时返回 ''（调用方自己决定要不要回退成 dataKey）。
function getCategoryPath(dataKey, type) {
    let tree;
    if (type === 'notes') tree = typeof categoryTree !== 'undefined' ? categoryTree : null;
    else if (type === 'coins') tree = typeof coinCategoryTree !== 'undefined' ? coinCategoryTree : null;
    else return '';
    if (!tree) return '';
    for (const cat of tree) {
        if (cat.children && cat.children.length > 0) {
            for (const sub of cat.children) {
                if (sub.dataKey === dataKey) return cat.name + ' - ' + sub.name;
            }
        } else if (cat.dataKey === dataKey) {
            return cat.name;
        }
    }
    return '';
}

function getEffectiveSearchMode() {
    if (currentMode === MODE.ARTICLES) return SEARCH_MODE.REALTIME;
    if (currentMode === MODE.NOTES || currentMode === MODE.COINS) {
        const st = modeStates[currentMode];
        return (st && st.searchMode) || SEARCH_MODE.REALTIME;
    }
    return SEARCH_MODE.REALTIME;
}

// ========== 工具函数 ==========
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function collectExpandedStates() {
    // ★ 改为"只收集当前活动容器里、本分类作用域下"的展开态（原来是无差别全文档扫描，
    //   会把隐藏容器里其它分类的节点也算进来 —— 见文件上方 getCategoryScope 的说明）。
    return collectScopedExpanded();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (!sidebar || !toggle) return;
    isSidebarCollapsed = !isSidebarCollapsed;
    sidebar.classList.toggle('collapsed', isSidebarCollapsed);
    toggle.textContent = '☰';
    toggle.title = isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
    // ★ 这里**有意**同时写两个板块的状态（不是笔误）：折叠是"想让内容区更宽"的界面偏好，
    //   不随板块切换而变，否则会出现"纸币折叠着、切到硬币又自己展开"的跳变。
    //   readme 第 9 节曾误写成"两个板块独立保存"，已按此实现更正文档。
    if (modeStates.notes) modeStates.notes.isSidebarCollapsed = isSidebarCollapsed;
    if (modeStates.coins) modeStates.coins.isSidebarCollapsed = isSidebarCollapsed;

    if (typeof fitSidebarLabelsDelayed === 'function') {
        fitSidebarLabelsDelayed();
    }
}

// ========== 状态保存与恢复 ==========
function saveFullState() {
    const key = getContainerKey();
    const container = viewScrollContainers[key];
    const scrollY = container ? container.scrollTop : 0;

    // ★ 优先保存设置页状态（如果正处于设置模式）
    if (isSettingsMode) {
        const container = viewScrollContainers['settings_container'];
        settingsPageCache = {
            scrollY: container ? container.scrollTop || 0 : 0
        };
        // 设置页不保存其他状态，直接返回
        return;
    }

    if ((currentMode === MODE.NOTES || currentMode === MODE.COINS) && !isSettingsMode) {
        const expanded = collectExpandedStates();
        const prev = modeStates[currentMode] || {};
        // ★ 顺带刷新"当前位置"：这里 DOM 一定是最终状态，是最省事也最准的采集时机。
        //   失焦（切到别的板块/设置页）时不清空 —— 板块切回来还要靠它还原 URL。
        if (typeof focusFromDom === 'function') focusFromDom();
        modeStates[currentMode] = {
            currentCategoryId, currentSubId, currentView,
            currentSearchKeyword: currentSearchKeyword || '',
            currentSearchType: currentSearchType || SEARCH_TYPE.ALL,
            searchMode: modeStates[currentMode] ? modeStates[currentMode].searchMode : SEARCH_MODE.REALTIME,
            isSidebarCollapsed: isSidebarCollapsed,
            expandedSeries: expanded.expandedSeries,
            expandedVarieties: expanded.expandedVarieties,
            focusOwner: focusOwner,
            focusScope: focusScope,
            // ★ 存副本：focusSeries/focusVariety 是数组，直接存引用的话，
            //   之后 focusFromDom() 里 push/sort 会连带改到"已保存的快照"，
            //   快照就不再是"保存那一刻的展开态"了（切板块还原时表现诡异）。
            focusSeries: focusSeries.slice(),
            focusVariety: focusVariety.slice(),
            overviewScrollY: currentView === VIEW.OVERVIEW ? scrollY : (prev.overviewScrollY || 0),
            categoryScrollY: currentView === VIEW.CATEGORY ? scrollY : (prev.categoryScrollY || 0),
            searchScrollY: currentView === VIEW.SEARCH ? scrollY : (prev.searchScrollY || 0)
        };
    } else if (currentMode === MODE.ARTICLES && !isSettingsMode) {
        const prev = articleState;
        articleState = {
            currentView: currentArticleView,
            currentCategory: currentArticleCategory,
            currentIndex: currentArticleIndex,
            searchKeyword: articleSearchKeyword,
            listScrollY: currentArticleView === VIEW.LIST ? scrollY : (prev.listScrollY || 0),
            readerScrollY: currentArticleView === VIEW.READER ? scrollY : (prev.readerScrollY || 0)
        };
    } else if (currentMode === MODE.SPECIAL && !isSettingsMode) {
        if (selectedSpecial !== null && selectedSpecial !== undefined) {
            const cfg = getSpecialConfigs().find(c => c.id === selectedSpecial);
            if (cfg && cfg.view === 'map') {
                specialPageCaches[selectedSpecial] = { currentSubId };
            } else {
                specialPageCaches[selectedSpecial] = {
                    scrollY: container ? container.scrollTop || 0 : 0,
                    currentSubId: currentSubId
                };
            }
        } else {
            // 保存概览滚动
            specialPageCaches['__overview__'] = {
                scrollY: scrollY
            };
        }
    }
}

function restoreSidebarState() {
    if (currentMode === MODE.NOTES || currentMode === MODE.COINS) {
        const saved = modeStates[currentMode];
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebarToggle');
        if (!sidebar || !toggle) return;
        const collapsed = saved ? saved.isSidebarCollapsed : false;
        sidebar.classList.toggle('collapsed', collapsed);
        toggle.textContent = '☰';
        toggle.title = collapsed ? '展开侧边栏' : '收起侧边栏';
        isSidebarCollapsed = collapsed;
        if (typeof fitSidebarLabelsDelayed === 'function') {
            fitSidebarLabelsDelayed();
        }
    }
}

function setupModalEvents() {
    const modal = document.getElementById('imageModal');
    if (!modal) return;

    // ★ 区分"点击"和"拖动结束"。
    //   拖动平移之后，浏览器仍会在 mouseup 时补发一次 click，不区分的话
    //   电脑上每次拖动查看都会顺手把弹窗关掉。
    let downX = 0, downY = 0, downTime = 0;
    const markDown = function(x, y) { downX = x; downY = y; downTime = Date.now(); };
    modal.addEventListener('mousedown', function(e) { markDown(e.clientX, e.clientY); });
    modal.addEventListener('touchstart', function(e) {
        const t = e.touches && e.touches[0];
        if (t) markDown(t.clientX, t.clientY);
    }, { passive: true });

    modal.addEventListener('click', function(e) {
        const t = e.target;
        // 关闭按钮与翻面按钮都长在蒙版里，点它们不能被"点哪儿都关"顺手关掉弹窗
        if (t && t.classList && (t.classList.contains('modal-close') || t.classList.contains('modal-nav'))) return;

        // 拖动结束的那一下不算点击（8px 容差，避免手抖误判）
        if (downTime && Date.now() - downTime < 800) {
            const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
            if (moved > 8) { downTime = 0; return; }
        }
        downTime = 0;

        // 点哪儿都关（鼠标与触摸行为一致，包括点图片本身）。
        // 代价是"双击还原"不可用 —— 双击的第一下就已经把弹窗关了；
        // 缩放还原改用滚轮向下 / 双指捏合缩回 1 倍。
        closeModal();
    });

    // ★ 记录最近被点击的缩略图，供大图"从缩略图位置生长出来"的共享元素动画使用。
    //   用捕获阶段的全局监听（而不是改 15 处内联 onclick），新增图片位时自动生效。
    document.addEventListener('click', function(e) {
        const t = e.target;
        if (t && t.tagName === 'IMG' && !(t.closest && t.closest('#imageModal'))) {
            lastModalSourceImg = t;
        }
    }, true);

    // ★ 文章阅读器里的配图也可以点开看大图。
    //   用文档级委托，不依赖渲染时机（文章正文是异步取回后 innerHTML 进去的）。
    //   文章配图没有生成缩略图，所以正反面传同一张 —— openModal 会自动跳过垫底图，
    //   也就不会去请求一个注定 404 的缩略图。
    document.addEventListener('click', function(e) {
        const t = e.target;
        if (!t || t.tagName !== 'IMG') return;
        if (!t.closest || !t.closest('.article-reader')) return;
        if (t.closest('#imageModal')) return;
        const src = t.currentSrc || t.src;
        if (src) openModal(src, src);
    });

    // ★ 键盘：Esc 关弹窗、左右方向键翻正反面。
    //   stopImmediatePropagation 是必要的：专题灯箱也监听左右方向键（切换景观图），
    //   详情卡片也监听 Esc（关自己）。本处理器在页面加载时就注册了，比它们都早，
    //   因此抢先生效之后可以拦住它们 —— 弹窗开着时，这些键只归弹窗管。
    document.addEventListener('keydown', function(e) {
        if (!imageModalOpen) return;
        if (e.key === 'Escape') { e.stopImmediatePropagation(); closeModal(); return; }
        if (e.key === 'ArrowLeft') { e.stopImmediatePropagation(); e.preventDefault(); modalFlip(-1); return; }
        if (e.key === 'ArrowRight') { e.stopImmediatePropagation(); e.preventDefault(); modalFlip(1); }
    });
}

let lastModalSourceImg = null;
// 图片弹窗是否正开着。详情卡片 / 专题灯箱也监听 Esc，需要靠它做"分层关闭"：
// 弹窗开在它们上面时，Esc 只该关掉最上面那一层。
let imageModalOpen = false;

// ============================================================
// ★★★★★★★ 图片加载淡入 ★★★★★★★
// ============================================================
// CSS 让网格图片在未加载完时保持透明（opacity:0），加载完成后加 .img-loaded 淡入，
// 避免"色块 → 图片"的硬切。三重保障确保任何图片都不会加载完了却一直不显示：
//   ① load 事件（含懒加载后到达的图）
//   ② MutationObserver：插入时就已 complete 的图不会触发 load，需主动补标
//   ③ 定时兜底清扫（先做一次极廉价的 querySelector 短路检查）
function markImageLoaded(img) {
    if (img && img.tagName === 'IMG' && !img.classList.contains('img-loaded')) {
        img.classList.add('img-loaded');
    }
}

function sweepLoadedImages(root) {
    const scope = (root && root.querySelectorAll) ? root : document;
    scope.querySelectorAll('img:not(.img-loaded)').forEach(function (img) {
        // complete 且 naturalWidth 为 0 表示加载失败；也必须标上，否则会一直隐形
        if (img.complete) img.classList.add('img-loaded');
    });
}

function setupImageFadeIn() {
    document.addEventListener('load', function(e) {
        if (e.target && e.target.tagName === 'IMG') markImageLoaded(e.target);
    }, true);

    try {
        const mo = new MutationObserver(function(muts) {
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (!n || n.nodeType !== 1) continue;
                    if (n.tagName === 'IMG') {
                        if (n.complete) markImageLoaded(n);
                    } else if (n.querySelectorAll) {
                        n.querySelectorAll('img').forEach(function(i) {
                            if (i.complete) markImageLoaded(i);
                        });
                    }
                }
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
        // 环境不支持 MutationObserver 时由定时兜底接管
    }

    // 兜底清扫：只在启动后的一分钟内做有限次数。
    // 之后 load 事件 + MutationObserver 已能覆盖（晚到的懒加载图会触发 load，
    // 插入时就 complete 的图会被 MutationObserver 捕获），无需长期轮询。
    let sweeps = 0;
    const sweepTimer = setInterval(function() {
        if (++sweeps > 30) { clearInterval(sweepTimer); return; }
        sweepLoadedImages();
    }, 2000);
}

// ============================================================
// ★★★★★★★ 图片重试 ★★★★★★★
// ============================================================
let failedImages = new Set();
let retryFab = null;

function setupImageRetry() {
    document.addEventListener('error', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG') {
            failedImages.add(t);
            updateRetryFab();
        }
    }, true);

    document.addEventListener('load', (e) => {
        const t = e.target;
        if (t && t.tagName === 'IMG') {
            if (failedImages.delete(t)) updateRetryFab();
        }
    }, true);

    retryFab = document.createElement('div');
    retryFab.id = 'imgRetryFab';
    retryFab.className = 'img-retry-fab';
    retryFab.innerHTML = '<span class="fab-icon">⟳</span><span class="fab-count" id="imgRetryCount"></span>';
    retryFab.onclick = () => { retryFailedImages(); };
    document.body.appendChild(retryFab);
    updateRetryFab();
}

function updateRetryFab() {
    if (!retryFab) return;
    const has = failedImages.size > 0;
    if (has) {
        retryFab.classList.add('show');
        const count = failedImages.size;
        const countEl = retryFab.querySelector('.fab-count');
        countEl.textContent = count > 999 ? '999+' : String(count);
        countEl.style.fontSize = count > 999 ? '8px' : (count > 99 ? '9px' : (count > 9 ? '10px' : '12px'));
        retryFab.title = '重新加载未显示的图片（' + count + ' 张）';
    } else {
        retryFab.classList.remove('show');
    }
}

function retryFailedImages() {
    const list = [...failedImages];
    failedImages.clear();
    updateRetryFab();
    for (const img of list) {
        if (!img.isConnected) continue;
        let src = img.getAttribute('src') || img.src;
        if (!src) continue;
        const sep = src.includes('?') ? '&' : '?';
        img.src = src + sep + 'retry=' + Date.now() + Math.random().toString(36).slice(2, 6);
    }
}

// ========== 专题全屏布局 ==========
function applySpecialLayout() {
    const cfg = getSpecialConfigs().find(c => c.id === selectedSpecial);

    if (cfg && typeof syncSpecialGroupChildren === 'function') {
        syncSpecialGroupChildren(cfg);
    }

    const bodyRow = document.querySelector('.body-row');
    const toggleBtn = document.getElementById('sidebarToggle');
    const isMap = !!(cfg && cfg.view === 'map');
    const tree = specialCategoryTree ? specialCategoryTree.find(c => c.id === selectedSpecial) : null;
    const hasSub = !isMap && !!(tree && tree.children && tree.children.length > 0);

    if (isMap || !hasSub) {
        if (bodyRow) {
            bodyRow.classList.add('sidebar-hidden');
            bodyRow.classList.remove('special-overview-mode');
        }
        if (toggleBtn) toggleBtn.style.display = 'none';
    } else {
        if (bodyRow) {
            bodyRow.classList.remove('sidebar-hidden');
            bodyRow.classList.remove('special-overview-mode');
        }
        if (toggleBtn) toggleBtn.style.display = '';
    }
}