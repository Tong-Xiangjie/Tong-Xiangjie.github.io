// B7 手风琴作用域修复验证。
// 方法：从 collection/*.js 里**抽取真实函数源码**，在最小 DOM 实现上执行。
// （不重写逻辑副本 —— 否则验证的是我的复述而不是产品代码）
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const out = [];
const log = (...a) => out.push(a.map(String).join(' '));
let problems = 0;
function check(cond, label, detail) {
  if (!cond) problems++;
  log(`  ${cond ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
}

// ================= 最小 DOM =================
let docOrder = 0;
class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this._classes = new Set();
    this._attrs = new Map();
    this.style = {};
    this.scrollHeight = 100;
    this._order = docOrder++;
    for (const [k, v] of Object.entries(attrs)) {
      this._attrs.set(k, String(v));
      // ★ 必须同步 class 属性到 _classes：matchesOne 只查 _classes，
      //   不同步的话 className 会是空的（我第一版就踩了这个）
      if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    }
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self._classes.add(x)),
      remove: (...c) => c.forEach(x => self._classes.delete(x)),
      contains: c => self._classes.has(c),
      toggle: (c, force) => { const on = force === undefined ? !self._classes.has(c) : !!force; on ? self._classes.add(c) : self._classes.delete(c); return on; }
    };
  }
  get id() { return this._attrs.get('id') || ''; }
  set id(v) { this._attrs.set('id', String(v)); }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this._attrs.set(k, String(v)); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
  insertBefore(c) { c.parentNode = this; this.childNodes.push(c); return c; }
  removeChild(c) { this.childNodes = this.childNodes.filter(x => x !== c); return c; }
  // 真实 DOM 上一定存在；这里只要不抛错就行 —— 本脚本验证的是手风琴 ID 作用域，
  // 与 core.js 给滚动容器挂的 scroll 监听（分类页滚动记忆）无关。
  addEventListener() {}
  removeEventListener() {}
  matches(sel) { return matchesOne(this, sel); }
  querySelector(sel) { return this._descendants().find(e => matchesOne(e, sel)) || null; }
  querySelectorAll(sel) { return this._descendants().filter(e => matchesOne(e, sel)); }  _descendants() {
    const r = [];
    const walk = n => n.childNodes.forEach(c => { r.push(c); walk(c); });
    walk(this);
    return r.sort((a, b) => a._order - b._order);
  }
}
function matchesOne(el, sel) {
  // ★ 真实 CSS 选择器支持逗号分隔的列表（closeAllAccordions 就用了
  //   '.series-body.open, .copy-list.open'）。不支持的话整条正则匹配失败、
  //   静默返回 false —— 我第一版就因此误判成产品缺陷。
  if (String(sel).includes(',')) {
    return String(sel).split(',').some(part => matchesOne(el, part.trim()));
  }
  // 支持 "tag" / ".class" / "[attr=\"v\"]" / ".a.b" / ".a[attr=\"v\"][attr2=\"v2\"]"
  const m = /^([a-zA-Z]+)?((?:\.[\w-]+|\[[\w-]+="[^"]*"\])*)$/.exec(sel);
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  const rest = m[2] || '';
  for (const part of rest.match(/\.[\w-]+|\[[\w-]+="[^"]*"\]/g) || []) {
    if (part.startsWith('.')) { if (!el._classes.has(part.slice(1))) return false; }
    else {
      const a = /\[([\w-]+)="([^"]*)"\]/.exec(part);
      if (el._attrs.get(a[1]) !== a[2]) return false;
    }
  }
  return true;
}
// document 桩：getElementById 返回**文档序第一个**匹配（真实浏览器语义）
const allEls = [];
const document = {
  getElementById(id) { return allEls.find(e => e.id === id) || null; },
  querySelector(sel) { return allEls.find(e => matchesOne(e, sel)) || null; },
  querySelectorAll(sel) { return allEls.filter(e => matchesOne(e, sel)); },
  // ensureViewContainer 会 createElement 一个滚动容器；把它也纳入 allEls，
  // 这样 document.getElementById('view-…') 的行为与真实浏览器一致
  createElement(tag) { const e = new El(tag); allEls.push(e); return e; }
};

// ================= 抽取真实函数源码 =================
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

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`未找到函数 ${name}`);
  return extractBlockAt(src, start);
}

// 抽取顶层 `const NAME = {...}`（例如板块注册表）。
// 它必须和依赖它的函数一起抽出来 —— 否则在抽取出来的沙箱里
// getContainerKey 会报 getModeDef is not defined。
function extractObjectConst(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`未找到常量对象 ${name}`);
  return extractBlockAt(src, start) + ';';
}

const core = readFileSync('collection/core.js', 'utf8');
const catview = readFileSync('collection/category-view.js', 'utf8');
const tabsw = readFileSync('collection/tab-switcher.js', 'utf8');

const pieces = [
  // 常量与状态（照抄 core.js 的定义）
  `const MODE = { NOTES: 'notes', COINS: 'coins', SPECIAL: 'special', ARTICLES: 'articles', SETTINGS: 'settings' };
   const VIEW = { OVERVIEW: 'overview', CATEGORY: 'category', SEARCH: 'search', LIST: 'list', READER: 'reader' };
   let currentMode = MODE.NOTES, currentCategoryId = null, currentSubId = null, currentView = VIEW.CATEGORY;
   let currentSearchKeyword = '', isSettingsMode = false, currentArticleView = VIEW.LIST, currentArticleIndex = -1;
   const viewScrollContainers = {};`,
  // ★ 板块注册表：getContainerKey 改走查表后，这里必须把它和取值函数一起抽出来
  extractObjectConst(core, 'MODE_REGISTRY'),
  extractFunction(core, 'getModeDef'),
  extractFunction(core, 'modeLabel'),
  extractFunction(core, 'prefersReducedMotion'),
  extractFunction(core, 'animateAccordion'),
  extractFunction(core, 'ensureViewContainer'),
  extractFunction(core, 'getContainerKey'),
  extractFunction(core, 'getRenderContainer'),
  extractFunction(core, 'switchToCurrentContainer'),
  extractFunction(core, 'switchViewContainer'),
  extractFunction(core, 'getCategoryScope'),
  extractFunction(core, 'seriesScopeId'),
  extractFunction(core, 'varietyScopeId'),
  extractFunction(core, 'closeAllAccordions'),
  extractFunction(core, 'getViewRootOf'),
  extractFunction(core, '$$'),
  extractFunction(core, '$'),
  extractFunction(core, 'scopeAccordionLookup'),
  extractFunction(core, 'accordionTargetOf'),
  extractFunction(core, 'collectScopedExpanded'),
  extractFunction(core, 'collectExpandedStates'),
  extractFunction(catview, 'syncFocusAndRoute'),
  extractFunction(catview, 'toggleSeries'),
  extractFunction(catview, 'toggleVariety'),
  extractFunction(tabsw, 'restoreExpandedStates'),
];
// scopeAccordionLookup 依赖 window.matchMedia（prefersReducedMotion）
const sandbox = {
  console, document, setTimeout, clearTimeout, requestAnimationFrame: f => setTimeout(f, 0),
  Set, Map, String, Number, Array, Object, JSON, Boolean, Math, RegExp, Error,
  window: { matchMedia: () => ({ matches: false }) },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(pieces.join('\n\n'), sandbox, { filename: 'extracted.js' });
const run = c => vm.runInContext(c, sandbox);

// 让 ensureViewContainer 能建容器（它要 querySelector('.content') 和 getElementById('app')）
function buildScaffold() {
  allEls.length = 0;
  const content = new El('div', { class: 'content' });
  const app = new El('div', { id: 'app' });
  content.appendChild(app);
  allEls.push(content, app);
  run(`for (const k of Object.keys(viewScrollContainers)) delete viewScrollContainers[k];`);
}
// 往当前活动容器里塞一个"分类页"骨架
function seedCategory(scope, seriesCount, varietiesPerSeries) {
  const container = run(`getRenderContainer()`);
  for (let si = 0; si < seriesCount; si++) {
    const body = new El('div', { class: 'series-body', id: `body-${scope}-s${si}` });
    const icon = new El('span', { class: 'series-expand-icon', id: `icon-${scope}-s${si}` });
    container.appendChild(body); container.appendChild(icon);
    allEls.push(body, icon);
    const nv = varietiesPerSeries || 0;
    if (nv > 0) {
      for (let vi = 0; vi < nv; vi++) {
        const list = new El('div', { class: 'copy-list', id: `list-${scope}-v${si}-${vi}`, 'data-acc-v': vi });
        const licon = new El('span', { class: 'variety-expand-icon', id: `icon-${scope}-v${si}-${vi}` });
        for (let ci = 0; ci < 3; ci++) {
          list.appendChild(new El('div', { class: 'copy-item', 'data-acc-v': vi, 'data-copy-vindex': ci }));
        }
        container.appendChild(list); container.appendChild(licon);
        allEls.push(list, licon);
      }
    } else {
      const copies = new El('div', { class: 'copy-list open', id: `copies-${scope}-s${si}`, 'data-acc-series': si, 'data-acc-v': -1 });
      container.appendChild(copies); allEls.push(copies);
    }
  }
  return container;
}

log('=== 1. 作用域 ID 不再跨分类撞名 ===');
buildScaffold();
run(`currentMode='notes'; currentCategoryId='rmb5'; currentSubId=null; currentView='category';`);
const scopeA = run(`getCategoryScope()`);
run(`currentMode='notes'; currentCategoryId='commemorative'; currentSubId=null;`);
const scopeB = run(`getCategoryScope()`);
check(scopeA !== scopeB, '两个分类的作用域标识不同', `${scopeA} vs ${scopeB}`);
check(run(`seriesScopeId(${JSON.stringify(scopeA)},0)`) !== run(`seriesScopeId(${JSON.stringify(scopeB)},0)`),
  '同序号系列( si=0 )在两类下 ID 不同');
check(scopeA === 'notes_category_rmb5', 'notes 分类作用域形态符合预期', scopeA);

log('\n=== 2. 复现场景：A 分类展开后切到 B 分类，B 不应被误展开 ===');
// A：rmb5，先渲染并展开 series-0
run(`currentMode='notes'; currentCategoryId='rmb5'; currentSubId=null; currentView='category'; switchToCurrentContainer();`);
const scopeRmb5 = run(`getCategoryScope()`);
seedCategory(scopeRmb5, 4, 0);
run(`toggleSeries(${JSON.stringify(scopeRmb5 + '-s0')})`);   // 用户点开第 1 个系列
const savedA = run(`collectExpandedStates()`);
check(savedA.expandedSeries.length === 1 && savedA.expandedSeries[0] === `${scopeRmb5}-s0`,
  '① A 分类的展开态被正确收集（带作用域）', JSON.stringify(savedA.expandedSeries));

// B：切到 commemorative（容器不复用 —— 模拟真实"保留隐藏容器"）
const containerA = run(`getRenderContainer()`);
run(`currentMode='notes'; currentCategoryId='commemorative'; currentSubId=null; switchToCurrentContainer();`);
const scopeComm = run(`getCategoryScope()`);
seedCategory(scopeComm, 3, 0);
// 此刻文档里有两个分类的节点，且 A 是隐藏的（display:none 但仍存在）
check(containerA.style.display === 'none', '② A 分类容器已被隐藏但 DOM 仍在（这正是冲突前提）', `display=${containerA.style.display}`);

run(`restoreExpandedStates(${JSON.stringify(savedA)})`);
const aOpen = run(`scopeAccordionLookup('body-' + ${JSON.stringify(scopeRmb5)} + '-s0').classList.contains('open')`);
const bOpen = run(`scopeAccordionLookup('body-' + ${JSON.stringify(scopeComm)} + '-s0').classList.contains('open')`);
check(bOpen === false, '③ B 分类未被 A 的展开态误展开（修复前会命中错误节点）', `B open=${bOpen}`);
check(aOpen === true, '④ A 分类自身的展开态保持不变', `A open=${aOpen}`);

log('\n=== 3. 同分类返回时能正确恢复 ===');
run(`currentMode='notes'; currentCategoryId='rmb5'; currentSubId=null; switchToCurrentContainer();`);
run(`restoreExpandedStates(${JSON.stringify(savedA)})`);
const restored = run(`scopeAccordionLookup('body-' + ${JSON.stringify(scopeRmb5)} + '-s0').classList.contains('open')`);
check(restored === true, '⑤ 切回 A 分类后展开态恢复', `open=${restored}`);

log('\n=== 4. 品种层同样不串台 ===');
run(`currentMode='notes'; currentCategoryId='rmb3'; currentSubId=null; currentView='category'; switchToCurrentContainer();`);
const scopeV1 = run(`getCategoryScope()`);
seedCategory(scopeV1, 2, 2);
run(`toggleSeries(${JSON.stringify(scopeV1 + '-s0')}); toggleVariety(${JSON.stringify(scopeV1 + '-v0-1')});`);
const savedV = run(`collectExpandedStates()`);
check(savedV.expandedVarieties.length === 1 && savedV.expandedVarieties[0] === `${scopeV1}-v0-1`,
  '⑥ 品种展开态带作用域收集', JSON.stringify(savedV.expandedVarieties));
run(`currentMode='coins'; currentCategoryId='commemorative_coins'; switchToCurrentContainer();`);
const scopeV2 = run(`getCategoryScope()`);
seedCategory(scopeV2, 2, 2);
run(`restoreExpandedStates(${JSON.stringify(savedV)})`);
check(run(`scopeAccordionLookup('list-' + ${JSON.stringify(scopeV2)} + '-v0-1').classList.contains('open')`) === false,
  '⑦ 硬币板块未被纸币的品种展开态误展开（跨 mode 也不串）');

log('\n=== 5. toggleSeries 只动活动容器里的节点 ===');
// ★ 用前面没用过的分类名，保证 A 的 -s0 一开始是闭合的
//   （第 4 节已经在同一容器里打开过 rmb3 的 -s0，复用会污染本节的 before 断言）
run(`currentMode='notes'; currentCategoryId='rmb1'; currentSubId=null; currentView='category'; switchToCurrentContainer();`);
const sA = run(`getCategoryScope()`);
seedCategory(sA, 2, 0);
run(`currentMode='notes'; currentCategoryId='rmb2'; currentSubId=null; switchToCurrentContainer();`);
const sB = run(`getCategoryScope()`);
seedCategory(sB, 2, 0);
check(sA !== sB, '前置：两个分类的容器/作用域不同', `${sA} vs ${sB}`);
// 隐藏容器(sA) 在文档序里排在前 → 老代码的 document.getElementById 会命中它
const hidBefore = run(`document.getElementById('body-' + ${JSON.stringify(sA)} + '-s0').classList.contains('open')`);
run(`toggleSeries(${JSON.stringify(sB + '-s0')})`);
const hidAfter = run(`document.getElementById('body-' + ${JSON.stringify(sA)} + '-s0').classList.contains('open')`);
const actAfter = run(`scopeAccordionLookup('body-' + ${JSON.stringify(sB)} + '-s0').classList.contains('open')`);
check(hidBefore === false && hidAfter === false, '⑧ 隐藏容器里的同序号节点未被误改', `before=${hidBefore} after=${hidAfter}`);
check(actAfter === true, '⑨ 活动容器里的目标节点被正确展开', `open=${actAfter}`);

log('\n=== 6. closeAllAccordions 只清活动容器 ===');
// 直接在隐藏容器(sA)的节点上加 open（不能用 toggleSeries —— 它现在已经
// "只动活动容器"了，这正是本项修复的语义）。目的是验证 closeAllAccordions
// 不会顺手把隐藏容器的状态也清掉。
run(`document.getElementById('body-' + ${JSON.stringify(sA)} + '-s0').classList.add('open')`);
const hidOpenBefore = run(`document.getElementById('body-' + ${JSON.stringify(sA)} + '-s0').classList.contains('open')`);
const dbgScopeB = run(`getCategoryScope()`);
run(`closeAllAccordions()`);
check(run(`scopeAccordionLookup('body-' + ${JSON.stringify(sB)} + '-s0').classList.contains('open')`) === false,
  '⑩ 活动容器的展开被收起');
check(hidOpenBefore === true && run(`document.getElementById('body-' + ${JSON.stringify(sA)} + '-s0').classList.contains('open')`) === true,
  '⑪ 隐藏容器的展开状态被保留（用户切回去还是原样）');

log('');
log(problems === 0 ? '✅ B7 全部验证通过' : `⚠ ${problems} 处失败`);
writeFileSync('b7-report.txt', out.join('\n'), 'utf8');
// ★ 失败必须反映到退出码上。原来报告只写文件、退出码恒为 0，
//   外部用 `$LASTEXITCODE -ne 0` 判定就会把失败当通过（同 verify-router 的坑）。
process.exit(problems === 0 ? 0 : 1);
