// 路由逻辑验证：mock history/location/DOM，直接执行 router.js 的真实代码。
// 结果写入 route-report.txt（避免依赖管道捕获输出）。
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const out = [];
const log = (...a) => out.push(a.map(String).join(' '));
let problems = 0;
function check(cond, label, detail) {
  if (!cond) problems++;
  log(`  ${cond ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
}

// ---------- 从 core.js 抽出真实的板块注册表 ----------
// ★ 必须用真实实现而不是手写一份，否则这个测试会和产品代码一起漂移。
//   之前这里**漏了** modeFromUrlSegment，于是 parseRoute 里 headMode 恒为 null，
//   所有 hash 都被判成"认不出来"→ 整份报告的 parse 段全是 ✗。
//   而外部跑测脚本只看 stderr / 退出码，这个系统性失败被静默吞掉了很久。
//   （`const` 在 vm 里是词法绑定，必须用 IIFE 显式挂到 context 上。）
const CORE_SRC = readFileSync(path.join('collection', 'core.js'), 'utf8');
function extractBlockAt(src, start) {
  const open = src.indexOf('{', start);
  if (open < 0) throw new Error('未找到起始花括号');
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
function extractObjectConst(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`未找到常量对象 ${name}`);
  return extractBlockAt(src, start) + ';';
}
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`未找到函数 ${name}`);
  return extractBlockAt(src, start);
}
const REGISTRY_SRC = [
  extractObjectConst(CORE_SRC, 'MODE_REGISTRY'),
  extractObjectConst(CORE_SRC, 'MODE_URL_SEGMENTS'),
  extractFunction(CORE_SRC, 'getModeDef'),
  extractFunction(CORE_SRC, 'modeLabel'),
  extractFunction(CORE_SRC, 'isCollectionMode'),
  extractFunction(CORE_SRC, 'modeFromUrlSegment')
].join('\n\n');

// ---------- mock 环境 ----------
const calls = { replace: [], push: [] };
let currentHash = '';
const location = {
  pathname: '/collection/',
  search: '',
  get hash() { return currentHash; },
  set hash(v) { currentHash = v.startsWith('#') ? v : '#' + v; }
};
const history = {
  replaceState(_s, _t, url) { calls.replace.push(url); const i = url.indexOf('#'); currentHash = i >= 0 ? url.slice(i) : ''; },
  pushState(_s, _t, url) { calls.push.push(url); const i = url.indexOf('#'); currentHash = i >= 0 ? url.slice(i) : ''; }
};

const listeners = {};
const sandbox = {
  console,
  location,
  history,
  window: {
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    matchMedia: () => ({ matches: false })
  },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  setTimeout,
  clearTimeout,
  encodeURIComponent,
  decodeURIComponent,
  Number,
  Object,
  Array,
  String,
  Boolean,
  Date,
  Math,
  JSON,
  isNaN,
  parseInt,
  parseFloat,
  Set,
  Map,
  Promise,
  Error,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// ---- 模板里的应用状态与常量（照抄 collection 的定义） ----
const prelude = `
const MODE = { NOTES: 'notes', COINS: 'coins', SPECIAL: 'special', ARTICLES: 'articles', SETTINGS: 'settings' };
const VIEW = { OVERVIEW: 'overview', CATEGORY: 'category', SEARCH: 'search', LIST: 'list', READER: 'reader' };
const SEARCH_TYPE = { ALL: 'all', NAME: 'name', VERSION: 'version', YEAR: 'year', AGENCY: 'agency', KRAUSE: 'krause', COPYID: 'copyid' };

let currentMode = MODE.NOTES;
let currentCategoryId = null;
let currentSubId = null;
let currentView = VIEW.OVERVIEW;
let currentSearchKeyword = '';
let currentSearchType = SEARCH_TYPE.ALL;
let isSettingsMode = false;
let selectedSpecial = null;
let currentArticleView = VIEW.LIST;
let currentArticleIndex = -1;
// ★ 文章侧边栏选中的分类/子分类，现在也参与 buildRoute()（c- 段）。
//   不声明的话 buildRoute 会直接 ReferenceError —— 这个沙箱按"真实全局变量"
//   逐条模拟，缺一个就暴露一个，是刻意保持的严格性。
let currentArticleCategory = 'all';
// ★ 文章搜索关键词与搜索模式（q- / sm- 段）。同理，缺一个就暴露一个。
let articleSearchKeyword = '';
let articleSearchMode = 'title';
let shanheViewMode = 'map';
let timelineSortOrder = 'desc';
let timelineFilterYear = '全部';
let timelineFilterMonth = '全部';
let modeStates = { notes: {}, coins: {} };
let articleState = { currentView: VIEW.LIST, currentIndex: -1, currentKeyword: '' };

// ★ 分类页"当前位置"（见 collection/core.js 的说明）。
//   本测试默认不设任何定位，所以声明为 null —— buildRoute() 的归属校验
//   (focusOwner === getCategoryScope()) 不成立，生成的 URL 与从前一致。
//   刻意不让"默认就有定位"，否则会掩盖路由本身的解析/生成问题。
let focusOwner = null;
let focusScope = null;
let focusSeries = null;
let focusVariety = null;
// buildRoute() 会用它做归属校验；本测试不关心真实容器 key，给个稳定映射即可。
function getCategoryScope() {
  return String(currentSubId || currentCategoryId || 'default').replace(/[^a-zA-Z0-9_\-]/g, '_');
}

// 供 applyRoute 用到的桩（本测试只关心路由解析/生成与历史写入）
function invalidateRenderedViews() {}
function enterSettings() { isSettingsMode = true; }
function enterArticlesTab() { currentMode = MODE.ARTICLES; }
// ★ 全文搜索的索引预热：真实实现会 fetch 全部正文。applyRoute 在
//   searchMode==='fulltext' 时会 await 它，所以必须给个可 await 的桩，
//   否则 deep-link 那条路径会直接 TypeError。
function preloadAllArticles() { return Promise.resolve(); }
function renderArticleList() {}
function updateSearchUIForMode() {}
function enterSpecialFromTab() { currentMode = MODE.SPECIAL; }
function enterNotesOrCoinsTab(m) {
  // 复刻真实实现的关键部分（tab-switcher.js:373）：从 modeStates 恢复状态
  currentMode = m;
  const saved = modeStates[m] || {};
  currentCategoryId = saved.currentCategoryId !== undefined ? saved.currentCategoryId : null;
  currentSubId = saved.currentSubId !== undefined ? saved.currentSubId : null;
  currentView = saved.currentView || VIEW.OVERVIEW;
  currentSearchKeyword = saved.currentSearchKeyword || '';
  currentSearchType = saved.currentSearchType || SEARCH_TYPE.ALL;
  // ★ 真实实现也会恢复"当前位置"（否则切板块回来地址栏会丢定位段）
  focusOwner = saved.focusOwner !== undefined ? saved.focusOwner : null;
  focusScope = saved.focusScope !== undefined ? saved.focusScope : null;
  focusSeries = saved.focusSeries !== undefined ? saved.focusSeries : null;
  focusVariety = saved.focusVariety !== undefined ? saved.focusVariety : null;
}
function onSpecialOverviewItemClick(id) { selectedSpecial = id; }
function shanheSwitchView(v) { shanheViewMode = v; }
function setTimelineOrder(o) { timelineSortOrder = o; }
function onTimelineFilterChange() {}
function doSearch() {}
function revealCopyInCategory() { return Promise.resolve(); }
function getRenderContainer() { return null; }
function toggleSeries() {}
function toggleVariety() {}
function scrollIntoViewSmooth() {}
const document = { getElementById: () => null, querySelector: () => null };
`;

// ★ 真实注册表注入：router.js 的 parseRoute 靠 modeFromUrlSegment() 把段名映射成板块。
//   用 IIFE 显式挂到 context 上（`const` 在 vm 里是词法绑定，不会自动出现在 sandbox 上）。
//   MODE/VIEW 也要一并注入：MODE_REGISTRY 的键就是 [MODE.NOTES] 这种计算属性名，
//   少了它们会直接 ReferenceError。
vm.runInContext(`(function(){
const MODE = { NOTES: 'notes', COINS: 'coins', SPECIAL: 'special', ARTICLES: 'articles', SETTINGS: 'settings' };
const VIEW = { OVERVIEW: 'overview', CATEGORY: 'category', SEARCH: 'search', LIST: 'list', READER: 'reader' };
${REGISTRY_SRC}
this.MODE_REGISTRY = MODE_REGISTRY;
this.MODE_URL_SEGMENTS = MODE_URL_SEGMENTS;
this.getModeDef = getModeDef;
this.modeLabel = modeLabel;
this.isCollectionMode = isCollectionMode;
this.modeFromUrlSegment = modeFromUrlSegment;
}).call(this)`, sandbox, { filename: 'core-registry.js' });

const routerSrc = readFileSync('collection/router.js', 'utf8');
vm.runInContext(prelude + '\n' + routerSrc, sandbox, { filename: 'router.js' });

const run = (code) => vm.runInContext(code, sandbox);

// ---------- 1. parseRoute ----------
log('=== 1. parseRoute 解析 ===');
const parseCases = [
  ['#notes', r => r.mode === 'notes' && r.view === 'overview'],
  ['#coins', r => r.mode === 'coins' && r.view === 'overview'],
  ['#notes/rmb3', r => r.view === 'category' && r.catId === 'rmb3' && r.subId === null],
  ['#notes/hk/boc', r => r.catId === 'hk' && r.subId === 'boc'],
  ['#notes/rmb3/s0/v1/c2', r => r.catId === 'rmb3' && r.sIdx === 0 && r.vIdx === 1 && r.cIdx === 2],
  ['#notes/search', r => r.view === 'search' && r.searchType === 'all'],
  ['#notes/search/krause/KM%23130', r => r.view === 'search' && r.searchType === 'krause' && r.searchKeyword === 'KM#130'],
  ['#notes/search/copyid/1843785', r => r.view === 'search' && r.searchType === 'copyid' && r.searchKeyword === '1843785'],
  ['#notes/search/%E6%B0%B4%E5%8D%B0', r => r.view === 'search' && r.searchType === 'all' && r.searchKeyword === '水印'],
  ['#articles', r => r.mode === 'articles' && r.articleIndex === -1],
  ['#articles/12', r => r.mode === 'articles' && r.articleIndex === 12],
  ['#settings', r => r.mode === 'settings'],
  ['#special', r => r.mode === 'special' && r.configId === null],
  ['#special/shanhe', r => r.mode === 'special' && r.configId === 'shanhe'],
  ['#special/shanhe/view-list', r => r.configId === 'shanhe' && r.shanheView === 'list'],
  ['#special/timeline/order-asc/y-2020', r => r.configId === 'timeline' && r.timelineOrder === 'asc' && r.timelineYear === '2020'],
];
for (const [hash, ok] of parseCases) {
  const r = run(`parseRoute(${JSON.stringify(hash)})`);
  check(r && ok(r), `parseRoute(${hash})`, r ? JSON.stringify(r) : 'null');
}

log('\n=== 2. 无效 hash 必须被忽略（不能抛错/改状态）===');
for (const bad of ['#', '#/', '#item-3', '#some-anchor', '#unknown/thing', '']) {
  let r, threw = false;
  try { r = run(`parseRoute(${JSON.stringify(bad)})`); } catch (e) { threw = true; }
  check(!threw && r === null, `parseRoute(${JSON.stringify(bad)}) → null`, threw ? '抛错!' : String(r));
}

// ---------- 3. buildRoute 往返 ----------
log('\n=== 3. buildRoute → parseRoute 往返一致 ===');
const roundTrips = [
  ['notes overview', `currentMode='notes'; currentView='overview'; currentCategoryId=null; currentSubId=null;`],
  ['coins overview', `currentMode='coins'; currentView='overview'; currentCategoryId=null; currentSubId=null;`],
  ['category no sub', `currentMode='notes'; currentView='category'; currentCategoryId='rmb3'; currentSubId=null;`],
  ['category with sub', `currentMode='notes'; currentView='category'; currentCategoryId='hk'; currentSubId='boc';`],
  ['search all', `currentMode='notes'; currentView='search'; currentSearchType='all'; currentSearchKeyword='水印';`],
  ['search krause', `currentMode='coins'; currentView='search'; currentSearchType='krause'; currentSearchKeyword='KM#130';`],
  ['search copyid', `currentMode='notes'; currentView='search'; currentSearchType='copyid'; currentSearchKeyword='1843785-048';`],
  ['articles list', `currentMode='articles'; currentArticleView='list'; currentArticleIndex=-1; currentArticleCategory='all';`],
  ['articles reader', `currentMode='articles'; currentArticleView='reader'; currentArticleIndex=7; currentArticleCategory='all';`],
  ['articles category', `currentMode='articles'; currentArticleView='list'; currentArticleIndex=-1; currentArticleCategory='notes_rmb';`],
  ['articles reader+category', `currentMode='articles'; currentArticleView='reader'; currentArticleIndex=3; currentArticleCategory='coins';`],
  ['settings', `isSettingsMode=true;`],
  ['special overview', `isSettingsMode=false; currentMode='special'; selectedSpecial=null; currentSubId=null;`],
  ['special shanhe map', `currentMode='special'; selectedSpecial='shanhe'; currentSubId=null; shanheViewMode='map';`],
  ['special shanhe list', `currentMode='special'; selectedSpecial='shanhe'; currentSubId=null; shanheViewMode='list';`],
  ['special timeline asc', `currentMode='special'; selectedSpecial='timeline'; currentSubId=null; shanheViewMode='map'; timelineSortOrder='asc'; timelineFilterYear='全部'; timelineFilterMonth='全部';`],
  // ★ 专题侧边栏子类（面额 "10000元" 这种含中文与数字的 id）
  ['special denom 10000元', `currentMode='special'; selectedSpecial='denom'; currentSubId='10000元';`],
  ['special years 1990s', `currentMode='special'; selectedSpecial='years'; currentSubId='1990s';`],
  ['special 子类+时间轴', `currentMode='special'; selectedSpecial='timeline'; currentSubId='1990s'; shanheViewMode='map'; timelineSortOrder='asc'; timelineFilterYear='全部'; timelineFilterMonth='全部';`],
];
for (const [label, setup] of roundTrips) {
  const route = run(`(function(){ ${setup} return buildRoute(); })()`);
  const back = run(`parseRoute(${JSON.stringify('#' + route)})`);
  check(back !== null, `${label}  →  #${route}`, back ? '' : '（解析回 null）');
}

// ★ 字段级往返：只断言 "parse 不为 null" 太弱 —— groupId/categoryId 就算被
//   静默丢掉也照样非 null。这里逐字段核对它们真的活着回来了。
log('\n=== 3b. 子类/分类字段必须原样活到解析结果里 ===');
const fieldCases = [
  ['专题子类 10000元', `currentMode='special'; selectedSpecial='denom'; currentSubId='10000元';`,
   r => r.mode === 'special' && r.configId === 'denom' && r.groupId === '10000元', 'groupId'],
  ['专题子类 1990s', `currentMode='special'; selectedSpecial='years'; currentSubId='1990s';`,
   r => r.configId === 'years' && r.groupId === '1990s', 'groupId'],
  ['专题无子类时不该凭空生出 g 段', `currentMode='special'; selectedSpecial='denom'; currentSubId=null;`,
   r => r.configId === 'denom' && (r.groupId === undefined || r.groupId === null || r.groupId === ''), 'groupId 应为空'],
  ['文章分类段', `currentMode='articles'; currentArticleView='list'; currentArticleIndex=-1; currentArticleCategory='notes_rmb'; articleSearchKeyword='';`,
   r => r.mode === 'articles' && r.categoryId === 'notes_rmb' && r.articleIndex === -1, 'categoryId'],
  ['文章序号+分类并存', `currentMode='articles'; currentArticleView='reader'; currentArticleIndex=5; currentArticleCategory='coins'; articleSearchKeyword='';`,
   r => r.articleIndex === 5 && r.categoryId === 'coins', '两者都要在'],
  ['文章默认分类写 all 时不产生 c 段', `currentMode='articles'; currentArticleView='list'; currentArticleIndex=-1; currentArticleCategory='all'; articleSearchKeyword='';`,
   r => r.categoryId === null, 'categoryId 应为 null'],
  // ★ 搜索了但没点进文章的状态
  ['文章标题搜索关键词', `currentMode='articles'; currentArticleView='list'; currentArticleIndex=-1; currentArticleCategory='all'; articleSearchKeyword='水印'; articleSearchMode='title';`,
   r => r.searchKeyword === '水印' && r.searchMode === 'title', 'searchKeyword/searchMode'],
  ['文章全文搜索关键词', `currentMode='articles'; currentArticleView='list'; currentArticleIndex=-1; currentArticleCategory='all'; articleSearchKeyword='中国人民银行'; articleSearchMode='fulltext';`,
   r => r.searchKeyword === '中国人民银行' && r.searchMode === 'fulltext', 'searchKeyword/searchMode'],
  ['文章搜索+分类+序号可共存', `currentMode='articles'; currentArticleView='reader'; currentArticleIndex=2; currentArticleCategory='coins'; articleSearchKeyword='PMG'; articleSearchMode='fulltext';`,
   r => r.articleIndex === 2 && r.categoryId === 'coins' && r.searchKeyword === 'PMG' && r.searchMode === 'fulltext', '四段都要在'],
  ['文章无关键词时不产生 q/sm 段', `currentMode='articles'; currentArticleView='list'; currentArticleIndex=-1; currentArticleCategory='all'; articleSearchKeyword=''; articleSearchMode='title';`,
   r => (r.searchKeyword === undefined || r.searchKeyword === '') && r.searchMode === null, '不该凭空生出搜索段'],
];
for (const [label, setup, pred, what] of fieldCases) {
  const route = run(`(function(){ ${setup} return buildRoute(); })()`);
  const back = run(`parseRoute(${JSON.stringify('#' + route)})`);
  let ok = false;
  try { ok = !!back && pred(back); } catch (e) { ok = false; }
  check(ok, `${label}  →  #${route}`, ok ? '' : `${what} 丢失/不符: ${JSON.stringify(back)}`);
}
// 再验证"生成→解析→再生成"稳定
log('\n=== 4. 生成/解析幂等（避免地址栏抖动）===');
const loopRoute = run(`(function(){ currentMode='notes'; currentView='search'; currentSearchType='krause'; currentSearchKeyword='KM#130'; return buildRoute(); })()`);
const r1 = run(`parseRoute(${JSON.stringify('#' + loopRoute)})`);
check(r1 && r1.searchKeyword === 'KM#130', '含 # 的关键词往返不丢字符', JSON.stringify(r1));

// ---------- 5. syncRoute 历史行为 ----------
log('\n=== 5. syncRoute 历史记录策略 ===');
calls.replace.length = 0; calls.push.length = 0;
run(`initRouter()`);
log(`  · initRouter 后：replace=${calls.replace.length} push=${calls.push.length}`);

calls.replace.length = 0; calls.push.length = 0;
// 边打边搜：连续 5 次 replace
run(`currentMode='notes'; currentView='search'; currentSearchType='all';
     for (const kw of ['水','水印','水印图','水印图案','水印图案A']) { currentSearchKeyword=kw; syncRoute(true); }`);
check(calls.replace.length === 5 && calls.push.length === 0,
  '边打边搜 5 次 → 只 replaceState 5 次、不新增历史',
  `replace=${calls.replace.length} push=${calls.push.length}`);

calls.replace.length = 0; calls.push.length = 0;
// ★ 显式搜索（点"搜索"按钮/回车）过去会 pushState，现在**也走 replaceState**。
//   这是有意的策略变更：整个浏览过程只占一条历史记录，否则用户要退出本站
//   得按几十次后退键（详见 collection/router.js 顶部的「历史记录策略」）。
//   所以这里断言的是"2 次同步 = 2 次 replace、0 次 push"。
run(`currentMode='notes'; currentView='search'; currentSearchType='all'; currentSearchKeyword='水印'; syncRoute(false);
     currentSearchKeyword='水印图案'; syncRoute(false);`);
check(calls.push.length === 0 && calls.replace.length === 2,
  '两次显式搜索 → 只 replaceState 2 次、不新增历史（不污染后退键）',
  `replace=${calls.replace.length} push=${calls.push.length}`);

calls.replace.length = 0; calls.push.length = 0;
// 同一状态重复同步不应重复写入
run(`syncRoute(); syncRoute(); syncRoute();`);
check(calls.replace.length === 0 && calls.push.length === 0,
  '状态未变时重复 syncRoute 不写历史（去重生效）',
  `replace=${calls.replace.length} push=${calls.push.length}`);

calls.replace.length = 0; calls.push.length = 0;
// 应用路由过程中不得回写
run(`applyingRoute = true; currentCategoryId='rmb3'; currentView='category'; syncRoute(false); applyingRoute = false;`);
check(calls.push.length === 0 && calls.replace.length === 0, 'applyRoute 期间 syncRoute 被抑制（不回声写）',
  `replace=${calls.replace.length} push=${calls.push.length}`);

// ---------- 6. applyRoute 写入正确的状态 ----------
log('\n=== 6. applyRoute 真的改了状态 ===');
const applyCases = [
  ['#notes/rmb4', `currentMode==='notes' && currentCategoryId==='rmb4' && currentView==='category'`, '分类'],
  ['#coins/commemorative_coins', `currentMode==='coins' && currentCategoryId==='commemorative_coins'`, '硬币分类'],
  ['#notes/search/krause/KM%23130', `currentView==='search' && currentSearchType==='krause' && modeStates.notes.currentSearchKeyword==='KM#130'`, '搜索状态写进 modeStates'],
  ['#settings', `isSettingsMode===true`, '设置页'],
  ['#articles', `currentMode==='articles'`, '文章板块'],
];
for (const [hash, expr, label] of applyCases) {
  run(`isSettingsMode=false; selectedSpecial=null; currentView='overview'; currentCategoryId=null;`);
  const p = run(`applyRoute(${JSON.stringify(hash)})`);
  await p;
  await new Promise(r => setTimeout(r, 260));
  const ok = run(`(function(){ return !!(${expr}); })()`);
  check(ok, `applyRoute(${hash}) → ${label}`);
}

log('');
log(problems === 0 ? '✅ 路由验证全部通过' : `⚠ ${problems} 处失败`);
writeFileSync('route-report.txt', out.join('\n'), 'utf8');
// ★ 失败必须反映到退出码上。
//   原来这里不设退出码（恒为 0），而报告是写文件的 —— 外部只要用
//   `$LASTEXITCODE -ne 0` 判断就会把整份报告都当成通过，
//   上面那个"modeFromUrlSegment 缺失导致 parseRoute 全灭"的问题
//   正是这样被静默吞掉很久的。
process.exit(problems === 0 ? 0 : 1);
