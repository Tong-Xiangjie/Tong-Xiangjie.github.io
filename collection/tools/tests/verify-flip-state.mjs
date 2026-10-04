// 翻面/关闭 状态机验证：把 category-view.js 里的**真实函数源码**抽出来，
// 在 Node 里用假 DOM + 假定时器驱动。
//
// 为什么不是浏览器测试：本环境下 Chromium 起不来（沙箱禁止进程建命名管道，
// platform_channel.cc Check failed 拒绝访问 0x5，--no-sandbox 也无效）。
// 这个 harness 覆盖的是"状态机对不对"——也就是本 bug 的根因层
//（翻面后 lastModalSourceImg 被置空 → 退出动画整段被跳过）。
// 它**不能**替代"动画好不好看"的肉眼判断，那部分仍需浏览器。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync('collection/category-view.js', 'utf8');
const CSS = readFileSync('collection/layout.css', 'utf8');
const TRACE = process.env.TRACE === '1';

// ★ 翻面"压扁"终态。翻面一共有四处要写同一个值：
//     CSS 基态 / modalFlipOut 的 to / modalFlipIn 的 from / JS 钉住终态的内联 transform。
//   前三个引用 CSS 变量 --flip-collapse，JS 也引用同一个变量，所以这里断言的就是
//   "JS 用的是变量引用"；四处是否真的都指向变量，由文件末尾的「单一来源」检查兜住。
const COLLAPSE_TRANSFORM = 'scale3d(var(--flip-collapse), 1, 1)';

// ---------- 抽取需要的真实函数（按花括号配平，从函数头切到配平的收尾） ----------
function extractFn(src, name) {
  const re = new RegExp('(?:^|\\n)function ' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('找不到函数: ' + name);
  const start = src.indexOf('function', m.index);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('函数未配平: ' + name);
}
// closeModal 内部依赖 startModalFlight / cancelModalFlight / imageContentRect /
// modalContainRect / modalShrinkFromRect，它们都在同一个改动区里，一并抽取。
const FN_NAMES = [
  'resetModalZoom', 'clearModalFlipLayer', 'loadModalImage', 'modalFlip',
  'closeModal', 'cancelModalFlight', 'startModalFlight', 'imageContentRect', 'modalContainRect',
  'modalShrinkFromRect',
  'gridThumbForUrl', 'modalShrinkTarget',
  // 垫底层相关：主图加载期间由 #modalImgOverlay 扛着缩略图（替代原来的
  // #modalImg background-image 方案），这三个函数是 loadModalImage/resetModalZoom
  // 的直接依赖，必须一并抽取。
  'beginModalBackdrop', 'dropModalBackdrop', 'restoreModalBackdrop', 'currentModalSrc', 'currentModalBackdrop'
];
const code = FN_NAMES.map(n => extractFn(SRC, n)).join('\n\n');

// ---------- 假 DOM ----------
function makeClassList(el) {
  const set = new Set();
  return {
    _set: set,
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    contains: c => set.has(c),
    toString: () => [...set].join(' '),
  };
}
function makeEl(id) {
  const el = {
    id,
    tagName: 'IMG',
    style: {},
    attrs: {},
    parentNode: null,
    isConnected: true,
    naturalWidth: 1600,
    naturalHeight: 900,
    _complete: true,
    width: 100, height: 60,
    left: 100, top: 100, right: 200, bottom: 160,
    src: '',
    currentSrc: '',
    className: '',
    listeners: {},
    onload: null,
    onerror: null,
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    getBoundingClientRect() { return { left: this.left, top: this.top, width: this.width, height: this.height, right: this.right, bottom: this.bottom }; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    appendChild(c) { c.parentNode = this; return c; },
    remove() { if (this.parentNode) this.parentNode = null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    offsetWidth: 100,
  };
  el.classList = makeClassList(el);
  // className 与 classList 双向同步（真实 DOM 里 className 就是它的字符串形式）
  Object.defineProperty(el, 'className', {
    get() { return el.classList.toString(); },
    set(v) { el.classList._set.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => el.classList._set.add(c)); },
  });
  // ★ 模拟真实的图片加载语义：默认**异步**触发 onload（放在一个 ~15ms 的
  //   假定时器里），并且是"赋值时就发起加载"。
  //   sb.__syncSrc 里的 URL 视为"命中缓存"，赋值后 complete 立即为 true。
  let _complete = true;
  Object.defineProperty(el, 'complete', {
    get() { return _complete; },
    set(v) { _complete = v; },
  });
  Object.defineProperty(el, 'src', {
    get() { return el._src || ''; },
    set(v) {
      // ★ 先复位 complete：真实浏览器里**给 img.src 赋值**（哪怕值没变）
      //   会同步把 complete 置回 false，然后才开始加载。
      //   不复位的话 loadModalImage 末尾那条 `if (modalImg.complete)` 同步分支
      //   会在换源之前就误触发，把 onReady 提前叫掉 —— 这正是我在这里
      //   绕了好几圈的原因（表现是"flip-in 永远挂不上"）。
      el.complete = false;
      el._src = String(v);
      // 真实 DOM 里 src 属性会同步反射到 getAttribute('src')
      if (v) el.attrs.src = String(v); else delete el.attrs.src;
      if (!v) { el.complete = true; return; }
      if (el._sb && el._sb.__syncSrc.has(String(v))) {
        el.complete = true;
        return;   // 命中缓存：complete 立刻为真（loadModalImage 里那条同步分支）
      }
      if (el._sb) {
        const id = el._sb.__addTimer(() => { el.complete = true; if (el.onload) el.onload(); }, 15, 'load');
        el._loadTimer = id;
      }
    },
  });
  // currentSrc 跟随 src（真实浏览器里加载完成后两者一致）
  Object.defineProperty(el, 'currentSrc', {
    get() { return el._src || ''; },
    set(v) { el._src = String(v); },
  });
  return el;
}

function makeSandbox() {
  const els = {
    imageModal: makeEl('imageModal'),
    modalImg: makeEl('modalImg'),
    modalImgOverlay: makeEl('modalImgOverlay'),
    modalContent: makeEl('modalContent'),
    imageContainer: makeEl('imageContainer'),
  };
  // 让容器有真实尺寸，modalContainRect 才量得到
  els.modalContent.width = 1400; els.modalContent.height = 1000;
  els.modalContent.left = 0; els.modalContent.top = 0;
  els.modalContent.right = 1400; els.modalContent.bottom = 1000;

  const timers = new Map();
  let timerSeq = 0;
  const body = makeEl('body');
  const appended = [];
  // 网格里的缩略图元素（测试用例往里放），供 gridThumbForUrl 查找
  const gridEls = [];

  const sandbox = {
    console,
    els, appended, timers, gridEls,
    // 视为"命中缓存"的图片 URL：赋值后 complete 立即为真
    __syncSrc: new Set(),
    __now: 0,   // 假时钟（毫秒，相对时间）
    __addTimer(fn, ms, kind) { const id = ++timerSeq; timers.set(id, { fn, ms, kind }); if (TRACE) console.log('    [timer+] id=' + id + ' now=' + sandbox.__now + ' ms=' + ms + ' →due=' + (sandbox.__now + ms) + ' kind=' + kind); return id; },
    document: {
      getElementById: id => els[id] || null,
      querySelector: () => null,
      // gridThumbForUrl 会查 img.mini-thumb / img.copy-thumb，所以这里要能按类名筛。
      // gridEls 由测试用例往里放"网格里的缩略图元素"。
      querySelectorAll: sel => {
        const wanted = String(sel).split(',').map(s => s.trim().replace(/^img\./, ''));
        return gridEls.filter(el => wanted.some(c => el.classList.contains(c)));
      },
      createElement: () => makeEl('created'),
      body,
    },
    window: { innerWidth: 1400, innerHeight: 1000, scrollTo() {} },
    setTimeout: (fn, ms) => sandbox.__addTimer(fn, ms, 'timeout'),
    clearTimeout: id => timers.delete(id),
    prefersReducedMotion: () => !!sandbox.__reduced,
    __reduced: false,
    // 状态（与 core.js 里同名）
    modalLoadToken: 0, modalFlightEl: null, modalFlightTimer: null, modalCloseTimer: null,
    modalFlipBusy: false, modalFlipTimer: null,
    currentModalSide: 1, modalFullReady: false,
    currentModalImg1: '', currentModalImg2: '',
    currentScale: 1, currentX: 0, currentY: 0,
    hammerManager: null,
    imageModalOpen: false,
    lastModalSourceImg: null,
    MODAL_FLIGHT_MS: 320, MODAL_FLIGHT_EASE: 'ease', MODAL_HIDE_MS: 300,
    MODAL_MAX_SCALE: 8, MODAL_FLIP_HALF_MS: 90,
    currentModalSrc() { return (sandbox.currentModalSide === 2 && sandbox.currentModalImg2) ? sandbox.currentModalImg2 : sandbox.currentModalImg1; },
    currentModalBackdrop() { return ''; },
    getThumbUrl: u => u.replace('/image/', '/image/thumb/').replace(/\.[^.]+$/, '.jpg'),
    initPinchZoom() {},
  };
  const ctx = vm.createContext(sandbox);
  // 让元素能访问到沙箱的定时器（模拟图片异步加载）
  for (const el of Object.values(els)) el._sb = sandbox;
  vm.runInContext(code +
    '\n;globalThis.__api = { modalFlip, closeModal, loadModalImage, clearModalFlipLayer, resetModalZoom, cancelModalFlight, gridThumbForUrl, modalShrinkTarget, imageContentRect, currentModalBackdrop, beginModalBackdrop, dropModalBackdrop, restoreModalBackdrop };',
    ctx, { filename: 'category-view.modal.js' });
  sandbox.__api.closeModal = vm.runInContext('closeModal', ctx);
  return sandbox;
}

// ---------- 假定时器驱动 ----------
// ★ 必须**按时间顺序**推进并重新取到期项：新回调里安排的定时器
//   （比如 finishHalf 里才发起的图片加载）要能从当时的时刻继续往后算。
//   第一版是把"此刻所有到期的"一次性收集起来挨个执行，结果图片的 onload
//   跑在了 finishHalf **之前** —— 那是假的：真实浏览器里 onload 不可能
//   早于"发起加载"的那一步。这个 bug 让 3 个用例出现假失败。
// kind='timeout' 只跑业务定时器，'load' 只跑模拟的图片 onload，
// 分开是为了单独模拟"新图解码慢"。
function tick(sb, advanceMs, kind) {
  const t0 = sb.__now;
  const t1 = t0 + advanceMs;
  // ★ 进 tick 时先把"相对延迟"换算成**绝对到期时刻**并固定下来。
  //   第一版是每轮循环现算 now+ms，而时钟会在循环里前进，
  //   于是同一条 130ms 的定时器被算成 145ms 而错过本次推进 ——
  //   finishHalf 永远不执行，看起来像"代码没跑"。
  const due = new Map();
  for (const [id, timer] of sb.timers) due.set(id, sb.__now + timer.ms);
  let ran = 0;
  for (;;) {
    let bestId = null, bestAt = Infinity;
    for (const [id, at] of due) {
      const timer = sb.timers.get(id);
      if (!timer) { due.delete(id); continue; }             // 已被 clearTimeout 取消
      if (at > t1) continue;                                // 本次推进还没到
      if (kind && timer.kind !== kind) continue;             // 只跑指定类别
      if (at < bestAt) { bestAt = at; bestId = id; }
    }
    if (bestId === null) break;
    const timer = sb.timers.get(bestId);
    sb.timers.delete(bestId);
    due.delete(bestId);
    sb.__now = Math.max(sb.__now, bestAt);
    timer.fn();
    ran++;
    // 本轮新安排的定时器（比如 finishHalf 里才发起的图片加载）也要纳入本次推进
    for (const [id, t] of sb.timers) if (!due.has(id)) due.set(id, sb.__now + t.ms);
  }
  sb.__now = t1;
  return ran;
}
// ★ 推进到**指定时刻**、并在窗口边界截断。
//   tick(sb, ms) 会把窗口内新安排的定时器也一并跑掉，而真实时间不是这样的：
//   finishHalf 在 130ms 才发起图片加载，那张图最早也要 130+Xms 才可能就绪。
//   不截断的话"等解码"这条路径根本测不到（新安排的回调被同一个窗口吃掉了）。
function tickTo(sb, deadline, kind) {
  const due = new Map();
  for (const [id, timer] of sb.timers) due.set(id, sb.__now + timer.ms);
  let ran = 0;
  for (;;) {
    let bestId = null, bestAt = Infinity;
    for (const [id, at] of due) {
      const timer = sb.timers.get(id);
      if (!timer) { due.delete(id); continue; }
      if (at > deadline) continue;
      if (kind && timer.kind !== kind) continue;
      if (at < bestAt) { bestAt = at; bestId = id; }
    }
    if (bestId === null) break;
    const timer = sb.timers.get(bestId);
    sb.timers.delete(bestId);
    due.delete(bestId);
    sb.__now = Math.max(sb.__now, bestAt);
    timer.fn();
    ran++;
    for (const [id, t] of sb.timers) {
      if (due.has(id)) continue;
      const at = sb.__now + t.ms;
      if (at <= deadline) due.set(id, at);   // 超出窗口的不跑（留到下一次推进）
    }
  }
  // 时钟停在"最后一个真正触发的事件"或 deadline 上，保持单调
  sb.__now = Math.max(sb.__now, deadline);
  return ran;
}
function pendingMs(sb, kind) {
  return [...sb.timers.values()].filter(v => !kind || v.kind === kind).map(v => v.ms);
}
// 按增量推进，并在边界截断：窗口内**新安排**且到期超过边界的定时器留到下一次。
// 需要"停在某个中间时刻做断言"时用这个，而不是 tick()。
function tickBy(sb, advanceMs) { return tickTo(sb, sb.__now + advanceMs); }

let fail = 0;
const chk = (label, ok, detail) => {
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `\n      ${detail}`));
};

function openPair(sb, side1 = '/image/front.jpg', side2 = '/image/back.jpg') {
  sb.currentModalImg1 = side1;
  sb.currentModalImg2 = side2;
  sb.currentModalSide = 1;
  sb.imageModalOpen = true;
  sb.modalLoadToken++;
  // 正面视为"已在屏幕上"（用户就是点它进来的）：同步就绪
  sb.__syncSrc.add(side1);
  const modalImg = sb.els.modalImg;
  // ★ 必须补上"图就绪"的等价副作用：真实流程里 openModal 会走
  //   loadModalImage，它给 #modalImg 装 onload 来置 modalFullReady / 去掉
  //   .modal-loading。少了这一步，翻面第一半结束后没有任何东西能把
  //   "新图就绪"这件事告诉 modalFlip，也就永远看不到 flip-in。
  const markReady = () => { sb.modalFullReady = true; sb.els.imageModal.classList.remove('modal-loading'); };
  modalImg.onload = markReady;
  modalImg.onerror = null;
  modalImg.src = side1;
  modalImg.complete = true;
  markReady();
  sb.els.imageModal.classList.add('modal-show', 'multi-img');
  sb.els.imageModal.style.display = 'flex';
  const th = makeEl('thumb');
  th._sb = sb;
  th.src = sb.getThumbUrl(side1);
  sb.lastModalSourceImg = th;
}

// ============ 1. 翻面动画的两半 ============
console.log('\n=== 1. 翻面：两半动画的类切换（新图需要下载） ===');
{
  const sb = makeSandbox();
  openPair(sb);
  const img = sb.els.modalImg, ov = sb.els.modalImgOverlay;
  const beforeSrc = img.src;
  const accepted = sb.__api.modalFlip(1);
  chk('modalFlip 受理', accepted === true, 'returned ' + accepted);
  chk('当前面切到 2', sb.currentModalSide === 2, 'side=' + sb.currentModalSide);
  chk('主图挂上 flip-out（开始压扁）', img.classList.contains('flip-out'), 'classes=' + img.className);
  // ★ 浮层**不参与**翻面动画（2025 改）：它现在是"原图解码完成前的垫底层"。
  //   历史上它接过旧图、也跑 flip-out，但那样会在动画中间多出一张横向压扁的旧图
  //   （两层叠着各转各的）。现在主图独自完成压扁/展开，浮层在翻面全程不渲染。
  chk('浮层不参与翻面（不挂 flip-out）', !ov.classList.contains('flip-out'), 'overlayClasses=' + ov.className);
  chk('浮层在翻面期间不渲染（display:none）', ov.style.display === 'none', 'display=' + JSON.stringify(ov.style.display));
  chk('浮层没有接过旧图作为翻面用图', ov.getAttribute('src') !== beforeSrc, 'overlaySrc=' + ov.getAttribute('src'));
  chk('标记翻面中', sb.modalFlipBusy === true, 'busy=' + sb.modalFlipBusy);
  chk('modal-flipping 已加上（用来压掉实时缩放）', sb.els.imageModal.classList.contains('modal-flipping'), 'classes=' + sb.els.imageModal.className);
  chk('src 此时**还没**换（等第一半结束才换）', img.src === beforeSrc, 'src=' + img.src);

  // 推进到第一半结束（130ms）。新图加载是 finishHalf **之后**才发起的，
  // 所以这里不会连带把它的就绪也算进来 —— 那正是"等解码"这条路径。
  tickTo(sb, 130);
  chk('第一半结束后：已换成新面', img.src === sb.currentModalImg2, 'src=' + img.src);
  chk('第一半结束后：浮层仍未参与翻面动画', !ov.classList.contains('flip-out') && !ov.classList.contains('flip-in'), 'overlayClasses=' + ov.className);
  chk('第一半结束后：浮层扛的是**新面**的垫底缩略图', ov.getAttribute('src') === sb.__api.currentModalBackdrop(), 'overlaySrc=' + ov.getAttribute('src'));
  chk('第一半结束后：仍在翻面中（等新图解码）', sb.modalFlipBusy === true, 'busy=' + sb.modalFlipBusy);
  chk('第一半结束后：主图处于压扁态（还没展开）', img.style.transform === COLLAPSE_TRANSFORM, 'transform=' + img.style.transform);

  // 推进到新图解码完成（145ms）
  tickTo(sb, 150);
  chk('新图就绪后：主图挂上 flip-in（开始展开）', img.classList.contains('flip-in'), 'classes=' + img.className);
  chk('新图就绪后：主图无内联残留（交给 keyframes）', !img.style.transform && !img.style.animation && !img.style.opacity,
    `transform=${img.style.transform} animation=${img.style.animation} opacity=${img.style.opacity}`);
  chk('新图就绪后：翻面标记已清', sb.modalFlipBusy === false, 'busy=' + sb.modalFlipBusy);
  chk('新图就绪后：modal-flipping 已移除', !sb.els.imageModal.classList.contains('modal-flipping'), 'classes=' + sb.els.imageModal.className);
}

// ============ 1b. 新图命中缓存：同步就绪也必须正常 ============
console.log('\n=== 1b. 翻面目标命中缓存（complete 同步为真） ===');
{
  const sb = makeSandbox();
  openPair(sb);
  sb.__syncSrc.add(sb.currentModalImg2);   // 反面已在缓存里
  const accepted = sb.__api.modalFlip(1);
  chk('翻面受理', accepted === true, 'returned ' + accepted);
  tickTo(sb, 130);
  chk('第一半结束后就绪：挂上 flip-in', sb.els.modalImg.classList.contains('flip-in'), 'classes=' + sb.els.modalImg.className);
  chk('第一半结束后就绪：无内联残留', !sb.els.modalImg.style.transform && !sb.els.modalImg.style.animation,
    `transform=${sb.els.modalImg.style.transform} animation=${sb.els.modalImg.style.animation}`);
  chk('第一半结束后就绪：标记复位', sb.modalFlipBusy === false, 'busy=' + sb.modalFlipBusy);
}

// ============ 2. 翻面之后关闭：必须走「缩回缩略图」（bug #1 的根因） ============
console.log('\n=== 2. 翻面之后关闭：必须出现飞行图层（= 缩回动画） ===');
{
  const sb = makeSandbox();
  openPair(sb);
  // 反面已在缓存里，让流程不带异步噪声
  sb.__syncSrc.add(sb.currentModalImg2);
  sb.__api.modalFlip(1);
  tickBy(sb, 130);
  const originThumb = sb.lastModalSourceImg && sb.lastModalSourceImg.src;

  // ★ 造一个"反面自己的格子"放进网格：它才是应该被选中的落点。
  //   故意把它放在和正面格子不同的位置，这样"选错"时断言必然失败。
  const backThumb = makeEl('backThumb');
  backThumb.className = 'copy-thumb';
  backThumb.src = sb.getThumbUrl(sb.currentModalImg2);   // = /image/thumb/back.jpg
  backThumb.left = 700; backThumb.top = 500; backThumb.right = 756; backThumb.bottom = 540;
  backThumb.width = 56; backThumb.height = 40;
  sb.gridEls.push(backThumb);

  sb.__api.closeModal();
  const modal = sb.els.imageModal;
  chk('关闭时移除了 modal-show', !modal.classList.contains('modal-show'), 'classes=' + modal.className);
  chk('关闭时加上了 modal-hide（蒙版淡出）', modal.classList.contains('modal-hide'), 'classes=' + modal.className);
  chk('★ 出现了飞行图层（缩回缩略图）', !!sb.modalFlightEl, 'modalFlightEl=' + sb.modalFlightEl);
  chk('★ 来源缩略图仍在（没有被翻面置空）', !!sb.lastModalSourceImg, 'lastModalSourceImg=' + sb.lastModalSourceImg);
  chk('★ 飞行用的是「当前这一面」的图（反面）', sb.modalFlightEl && sb.modalFlightEl.src === sb.currentModalImg2,
    `flightSrc=${sb.modalFlightEl && sb.modalFlightEl.src} want=${sb.currentModalImg2}`);
  chk('★ 落点选中了「反面自己的格子」', (() => {
    if (!sb.modalFlightEl) return false;
    // 落点用的是 imageContentRect（图片真实内容的内接矩形），与元素框相差几个像素，
    // 所以断言「落在该格子的内容矩形范围内」，而不是等于元素框的 left/top。
    const want = sb.__api.imageContentRect(backThumb);
    const l = parseFloat(sb.modalFlightEl.style.left), t = parseFloat(sb.modalFlightEl.style.top);
    return l >= want.left - 0.5 && l <= want.right + 0.5 && t >= want.top - 0.5 && t <= want.bottom + 0.5;
  })(), `flight=${sb.modalFlightEl && sb.modalFlightEl.style.left},${sb.modalFlightEl && sb.modalFlightEl.style.top} want=${JSON.stringify(sb.__api.imageContentRect(backThumb))}`);
  chk('★ 落点不在「点进来时那张」正面的格子上（这是本次修掉的错位）',
    originThumb === sb.getThumbUrl('/image/front.jpg') &&
    Math.abs(parseFloat(sb.modalFlightEl.style.left) - sb.lastModalSourceImg.left) > 1,
    'thumb=' + originThumb + ' flightLeft=' + (sb.modalFlightEl && sb.modalFlightEl.style.left) + ' frontLeft=' + sb.lastModalSourceImg.left);
  chk('飞行期间真图被隐藏', sb.els.modalImg.style.opacity === '0', 'opacity=' + sb.els.modalImg.style.opacity);

  tick(sb, 500);
  chk('结束后弹窗真正隐藏', modal.style.display === 'none', 'display=' + modal.style.display);
  chk('结束后飞行图层已清理', !sb.modalFlightEl, 'flightEl=' + sb.modalFlightEl);
  chk('结束后浮层已清空', !sb.els.modalImgOverlay.getAttribute('src'), 'overlaySrc=' + sb.els.modalImgOverlay.getAttribute('src'));
  chk('结束后主图无残留 transform', !sb.els.modalImg.style.transform, 'transform=' + sb.els.modalImg.style.transform);
  chk('结束后主图无残留 animation', !sb.els.modalImg.style.animation, 'animation=' + sb.els.modalImg.style.animation);
  chk('结束后主图无残留动画类', !sb.els.modalImg.classList.contains('flip-out') && !sb.els.modalImg.classList.contains('flip-in'),
    'classes=' + sb.els.modalImg.className);
  chk('结束后翻面标记复位', sb.modalFlipBusy === false, 'busy=' + sb.modalFlipBusy);
  chk('结束后 multi-img 已移除', !modal.classList.contains('multi-img'), 'classes=' + modal.className);
}

// ============ 3. 对照：翻面前关闭也必须走缩回（确认没改坏原有行为） ============
console.log('\n=== 3. 对照：不翻面直接关闭，行为与改动前一致 ===');
{
  const sb = makeSandbox();
  openPair(sb);
  sb.__api.closeModal();
  chk('出现了飞行图层（缩回缩略图）', !!sb.modalFlightEl, 'flightEl=' + sb.modalFlightEl);
  chk('飞行图是当前面（正面）', sb.modalFlightEl && sb.modalFlightEl.src === sb.currentModalImg1,
    'flightSrc=' + (sb.modalFlightEl && sb.modalFlightEl.src));
  tick(sb, 500);
  chk('结束后隐藏且清理干净', sb.els.imageModal.style.display === 'none' && !sb.modalFlightEl,
    'display=' + sb.els.imageModal.style.display);
}

// ============ 3b. 落点解析：回退与两种 URL 形态 ============
console.log('\n=== 3b. 落点解析 gridThumbForUrl（回退 / 缩略图 URL / 原图 URL） ===');
{
  // 反面的格子不在网格里 → 必须回退到"点进来时那张"的格子，而不是不缩回
  {
    const sb = makeSandbox();
    openPair(sb);
    sb.__syncSrc.add(sb.currentModalImg2);
    sb.__api.modalFlip(1);
    tickBy(sb, 130);
    chk('网格里没有反面格子时 gridThumbForUrl 返回 null',
      sb.__api.gridThumbForUrl(sb.currentModalImg2) === null, '');
    sb.__api.closeModal();
    chk('★ 仍然出现飞行图层（回退到原格子，而不是退化成整体淡出）',
      !!sb.modalFlightEl, 'modalFlightEl=' + sb.modalFlightEl);
    chk('★ 回退后落点是「点进来时那张」的格子',
      sb.modalFlightEl && sb.modalFlightEl.style.left === sb.lastModalSourceImg.left + 'px',
      `flightLeft=${sb.modalFlightEl && sb.modalFlightEl.style.left} srcLeft=${sb.lastModalSourceImg.left}`);
  }

  // 网格用原图 URL 渲染时（设置里的"使用原图"开关），也要能命中
  {
    const sb = makeSandbox();   // 之前漏了这行 → 整个块 ReferenceError，断言必然失败
    const byFull = makeEl('byFull');
    byFull.className = 'mini-thumb';
    byFull.src = '/image/back.jpg';           // 原图 URL，不是 thumb URL
    sb.gridEls.push(byFull);
    chk('★ 网格渲染的是原图 URL 时也能命中', sb.__api.gridThumbForUrl('/image/back.jpg') === byFull, '');
    chk('★ 传入缩略图 URL 也能命中同一个元素',
      sb.__api.gridThumbForUrl(sb.getThumbUrl('/image/back.jpg')) === byFull, '');
    chk('无关 URL 命中不到', sb.__api.gridThumbForUrl('/image/other.jpg') === null, '');
    chk('空 URL 命中不到（不抛异常）', sb.__api.gridThumbForUrl('') === null, '');
  }

  // modalShrinkTarget 的落点判定（★ 语义已改：屏幕外但有尺寸的格子照样算数 ——
  // 图片要朝它"本来应在"的位置飞出去，而不是被夹回视口或放弃动画）
  {
    const sb = makeSandbox();
    chk('有尺寸但完全在视口外 → 仍然认（要飞到屏幕外"应有"的位置）',
      sb.__api.modalShrinkTarget({ left: -500, top: 100, width: 56, height: 40, right: -444, bottom: 140 }) !== null, '');
    chk('尺寸过小 → null', sb.__api.modalShrinkTarget({ left: 100, top: 100, width: 3, height: 3, right: 103, bottom: 103 }) === null, '');
    chk('数值非法（NaN 宽度）→ null',
      sb.__api.modalShrinkTarget({ left: 100, top: 100, width: NaN, height: 40, right: 156, bottom: 140 }) === null, '');
    chk('视口内且尺寸正常 → 原样返回',
      sb.__api.modalShrinkTarget({ left: 100, top: 100, width: 56, height: 40, right: 156, bottom: 140 }) !== null, '');
  }
}

// ============ 4. 连点：动画进行中必须被拒绝 ============
console.log('\n=== 4. 翻面动画进行中连点 ===');
{
  const sb = makeSandbox();
  openPair(sb);
  sb.__syncSrc.add(sb.currentModalImg2);   // 去掉异步噪声，只测"连点是否被拒"
  chk('第一次受理', sb.__api.modalFlip(1) === true, '');
  chk('第二次被拒（动画中）', sb.__api.modalFlip(1) === false, '');
  chk('第三次被拒（动画中）', sb.__api.modalFlip(1) === false, '');
  chk('此时仍是第 2 面（没有被连点翻回去）', sb.currentModalSide === 2, 'side=' + sb.currentModalSide);
  tickBy(sb, 130);
  chk('第一半打完后才允许再翻', sb.__api.modalFlip(1) === true, 'busy=' + sb.modalFlipBusy);
  tickBy(sb, 130);
  chk('翻了两次：回到第 1 面', sb.currentModalSide === 1, 'side=' + sb.currentModalSide);
}

// ============ 5. 翻面动画中途关闭 ============
console.log('\n=== 5. 翻面动画中途关闭（最容易漏的边界） ===');
{
  const sb = makeSandbox();
  openPair(sb);
  sb.__api.modalFlip(1);
  // 第一半还没结束就关闭
  sb.__api.closeModal();
  chk('关闭即复位翻面标记（否则下次再也翻不了面）', sb.modalFlipBusy === false, 'busy=' + sb.modalFlipBusy);
  chk('★ 关闭即清掉第一半的收尾定时器（否则它会迟到触发，把主图写成压扁）',
    sb.modalFlipTimer === null, 'modalFlipTimer=' + sb.modalFlipTimer);
  chk('关闭时也移除了 modal-flipping', !sb.els.imageModal.classList.contains('modal-flipping'),
    'classes=' + sb.els.imageModal.className);
  tick(sb, 600);
  chk('弹窗已隐藏', sb.els.imageModal.style.display === 'none', 'display=' + sb.els.imageModal.style.display);
  chk('无残留 transform', !sb.els.modalImg.style.transform, 'transform=' + sb.els.modalImg.style.transform);
  chk('无残留 animation', !sb.els.modalImg.style.animation, 'animation=' + sb.els.modalImg.style.animation);
  chk('无残留动画类', !sb.els.modalImg.classList.contains('flip-out') && !sb.els.modalImg.classList.contains('flip-in'),
    'classes=' + sb.els.modalImg.className);
  chk('浮层已清空', !sb.els.modalImgOverlay.getAttribute('src'), 'overlaySrc=' + sb.els.modalImgOverlay.getAttribute('src'));
  chk('modal-flipping 已移除', !sb.els.imageModal.classList.contains('modal-flipping'), 'classes=' + sb.els.imageModal.className);

  // 还能再次打开并翻面
  openPair(sb);
  sb.els.imageModal.classList.add('modal-show');
  chk('中途关闭后仍能正常翻面', sb.__api.modalFlip(1) === true, 'busy=' + sb.modalFlipBusy);
  tickBy(sb, 130);
  chk('并且真的翻到了第 2 面', sb.currentModalSide === 2, 'side=' + sb.currentModalSide);
}

// ============ 6. 减少动效：不做动画但功能正常 ============
console.log('\n=== 6. prefers-reduced-motion ===');
{
  const sb = makeSandbox();
  openPair(sb);
  sb.__reduced = true;
  const accepted = sb.__api.modalFlip(1);
  chk('翻面受理', accepted === true, 'returned ' + accepted);
  chk('不启用翻面动画（浮层不挂动画类）', !sb.els.modalImgOverlay.classList.contains('flip-out') && !sb.els.modalImgOverlay.classList.contains('flip-in'),
    'overlayClasses=' + sb.els.modalImgOverlay.className);
  chk('不给主图挂动画类', !sb.els.modalImg.classList.contains('flip-out') && !sb.els.modalImg.classList.contains('flip-in'),
    'classes=' + sb.els.modalImg.className);
  chk('src 立刻切换', sb.els.modalImg.src === sb.currentModalImg2, 'src=' + sb.els.modalImg.src);
  chk('翻面标记不残留', sb.modalFlipBusy === false, 'busy=' + sb.modalFlipBusy);

  sb.els.modalImg.style.opacity = '0';
  sb.__api.closeModal();
  chk('减少动效下关闭不做飞行', !sb.modalFlightEl, 'flightEl=' + sb.modalFlightEl);
  tick(sb, 500);
  chk('仍能正常关闭', sb.els.imageModal.style.display === 'none', 'display=' + sb.els.imageModal.style.display);
}

// ============ 7. 单面图不得被翻面逻辑影响 ============
console.log('\n=== 7. 单面图（正反面同一张） ===');
{
  const sb = makeSandbox();
  openPair(sb, '/image/same.jpg', '');
  chk('modalFlip 返回 false', sb.__api.modalFlip(1) === false, '');
  chk('当前面没变', sb.currentModalSide === 1, 'side=' + sb.currentModalSide);
  chk('没有挂任何翻面类', !sb.els.modalImg.classList.contains('flip-out'), 'classes=' + sb.els.modalImg.className);
  chk('没有启动浮层', !sb.els.modalImgOverlay.getAttribute('src'), 'overlaySrc=' + sb.els.modalImgOverlay.getAttribute('src'));
}

// ============ 8. 新图解码慢：第二半不能提前展开 ============
console.log('\n=== 8. 新图解码慢时不提前展开（onReady 的意义） ===');
{
  const sb = makeSandbox();
  openPair(sb);
  // 让新图"一直没加载好"：把 complete 设 false，且不触发 onload
  sb.els.modalImg.complete = false;
  sb.__api.modalFlip(1);
  tickBy(sb, 130);
  chk('第一半结束：src 已换、主图仍是压扁态', sb.els.modalImg.style.transform === COLLAPSE_TRANSFORM,
    'transform=' + sb.els.modalImg.style.transform);
  chk('第一半结束：仍算翻面中（等解码）', sb.modalFlipBusy === true, 'busy=' + sb.modalFlipBusy);
  // 现在图片解码好了
  sb.els.modalImg.complete = true;
  if (sb.els.modalImg.onload) sb.els.modalImg.onload();
  chk('解码完成后才开始展开', sb.els.modalImg.classList.contains('flip-in'), 'classes=' + sb.els.modalImg.className);
  chk('解码完成后标记复位', sb.modalFlipBusy === false, 'busy=' + sb.modalFlipBusy);
}

// ============ 9. 图永远加载不出来：兜底也必须收尾 ============
console.log('\n=== 9. 新图加载失败：兜底定时器必须收尾 ===');
{
  const sb = makeSandbox();
  openPair(sb);
  sb.els.modalImg.complete = false;
  sb.__api.modalFlip(1);
  tickBy(sb, 130);
  chk('第一半结束仍在翻面中', sb.modalFlipBusy === true, 'busy=' + sb.modalFlipBusy);
  tickBy(sb, 1200);   // 兜底 readyTimer
  chk('兜底到点后展开收尾', sb.els.modalImg.classList.contains('flip-in'), 'classes=' + sb.els.modalImg.className);
  chk('兜底到点后标记复位', sb.modalFlipBusy === false, 'busy=' + sb.modalFlipBusy);
}

// ============ 10. 垫底层：新图就绪前显示的是**新面**的缩略图 ============
//
// 对应 bug「小图选择缩略图时，点开一张后退出再点开另一张，
// 之前那张缩略图会在新的一张原图加载出来前闪现一下」。
//
// 修复前：垫底图铺在 #modalImg 的 background-image 上，和 #modalImg 自己的
// opacity 搅在一起；关闭时留下的内联 opacity:'0' 会被下一次打开继承，
// 主图不显形、只剩垫底图，观感就是"上一张的缩略图停在那儿"。
//
// 修复后：垫底图独立成层（#modalImgOverlay + .backdrop-layer），
// 且**同一帧**就换成新面的缩略图，不经过"先清空"的中间态。
console.log('\n=== 10. 垫底层（原图就绪前的缩略图）===');
{
  const sb = makeSandbox();
  openPair(sb);
  const ov = sb.els.modalImgOverlay;
  const frontThumb = sb.getThumbUrl('/image/front.jpg');
  const backThumb = sb.getThumbUrl('/image/back.jpg');

  // openPair 模拟的是"已打开正面"。这里模拟翻面到反面时重新加载：
  // loadModalImage 必须把垫底层换成**反面**的缩略图，而不是留着正面的。
  sb.currentModalSide = 2;
  sb.__api.loadModalImage({});
  chk('垫底层换成了当前面(反面)的缩略图', ov.getAttribute('src') === backThumb,
    `overlaySrc=${ov.getAttribute('src')} want=${backThumb}`);
  chk('垫底层不再扛着上一面(正面)的缩略图', ov.getAttribute('src') !== frontThumb,
    `overlaySrc=${ov.getAttribute('src')} frontThumb=${frontThumb}`);
  chk('垫底层带上了垫底身份', ov.classList.contains('backdrop-layer'), 'classes=' + ov.className);

  // 原图就绪 → 垫底层必须让位
  sb.els.modalImg.complete = true;
  if (sb.els.modalImg.onload) sb.els.modalImg.onload();
  chk('原图就绪后垫底层被撤掉', !ov.classList.contains('backdrop-layer'), 'classes=' + ov.className);
  chk('原图就绪后垫底层不再占位（display:none）', ov.style.display === 'none', 'display=' + JSON.stringify(ov.style.display));
  chk('原图就绪后垫底层的 src 被清空', !ov.getAttribute('src'), 'overlaySrc=' + ov.getAttribute('src'));

  // 关掉再打开另一张：整个过程不得让垫底层扛着上一张
  sb.__api.closeModal();
  tickBy(sb, 400);
  sb.currentModalImg1 = '/image/other.jpg';
  sb.currentModalSide = 1;
  sb.els.modalImg.complete = false;
  sb.__api.loadModalImage({});
  chk('换一张重新打开：垫底层是新图自己的缩略图',
    ov.getAttribute('src') === sb.getThumbUrl('/image/other.jpg'),
    `overlaySrc=${ov.getAttribute('src')} want=${sb.getThumbUrl('/image/other.jpg')}`);
  chk('换一张重新打开：垫底层没残留上一张',
    ov.getAttribute('src') !== frontThumb && ov.getAttribute('src') !== backThumb,
    'overlaySrc=' + ov.getAttribute('src'));
  chk('换一张重新打开：主图 opacity 没有被上次关闭的 0 卡住',
    sb.els.modalImg.style.opacity !== '0',
    'opacity=' + JSON.stringify(sb.els.modalImg.style.opacity));

  // clearModalFlipLayer（resetModalZoom 会调）绝不能把正在当垫底的浮层清掉
  const sb2 = makeSandbox();
  openPair(sb2);
  sb2.currentModalSide = 2;
  sb2.__api.loadModalImage({});
  const ov2 = sb2.els.modalImgOverlay;
  const kept = ov2.getAttribute('src');
  sb2.__api.clearModalFlipLayer();
  chk('clearModalFlipLayer 不会清掉正在当垫底的浮层',
    ov2.getAttribute('src') === kept && ov2.classList.contains('backdrop-layer'),
    `after=${ov2.getAttribute('src')} classes=${ov2.className}`);
}

// ============ 11. 生长动画期间不得显示垫底层（否则同一张图画两遍）============
//
// 对应 bug「原图没加载好时点开缩略图，会立马出现一张放大的缩略图当背景，
// 同时又在播放放大动画」。
//
// 生长动画靠"飞行图层"从缩略图格子飞到全屏来承担画面；垫底层如果这时也显示，
// 就是同一张缩略图在同一位置画了两遍 —— 观感正是"背景 + 放大动画同时出现"。
// 所以 loadModalImage 收到 flyFromThumb 时必须把垫底层藏起来，
// 等飞行落地后由 restoreModalBackdrop 在"原图仍未就绪"时补上。
console.log('\n=== 11. 生长动画期间垫底层必须隐藏 ===');
{
  const sb = makeSandbox();
  openPair(sb);
  const ov = sb.els.modalImgOverlay;
  const backThumb = sb.getThumbUrl('/image/back.jpg');

  // 模拟 openModal：翻到反面并带生长动画地加载。原图故意"没就绪"。
  sb.currentModalSide = 2;
  sb.modalFullReady = false;
  sb.els.modalImg.complete = false;
  sb.__api.loadModalImage({ flyFromThumb: true });
  chk('飞行中：垫底层已备好缩略图（src 就位）', ov.getAttribute('src') === backThumb, 'overlaySrc=' + ov.getAttribute('src'));
  chk('飞行中：垫底层带垫底身份', ov.classList.contains('backdrop-layer'), 'classes=' + ov.className);
  chk('飞行中：垫底层不渲染（否则与飞行图层重影）', ov.style.display === 'none',
    'display=' + JSON.stringify(ov.style.display));

  // 飞行落地：原图仍未就绪 → 垫底层必须补上，否则主图 opacity:0 + 无垫底 = 全空
  sb.__api.restoreModalBackdrop();
  chk('落地且原图未就绪：垫底层补上并渲染', ov.classList.contains('backdrop-layer') && ov.style.display !== 'none',
    `classes=${ov.className} display=${JSON.stringify(ov.style.display)}`);
  chk('落地后垫底层仍是最新那一面的缩略图', ov.getAttribute('src') === backThumb, 'overlaySrc=' + ov.getAttribute('src'));

  // 原图就绪 → 垫底层让位
  sb.modalFullReady = true;
  sb.__api.dropModalBackdrop();
  chk('原图就绪后垫底层撤掉', !ov.classList.contains('backdrop-layer') && !ov.getAttribute('src'),
    `classes=${ov.className} overlaySrc=${ov.getAttribute('src')}`);

  // 反向：原图**已经就绪**时才落地，不应把垫底层又放出来
  const sb2 = makeSandbox();
  openPair(sb2);
  const ov2 = sb2.els.modalImgOverlay;
  sb2.currentModalSide = 2;
  sb2.modalFullReady = false;
  sb2.els.modalImg.complete = false;
  sb2.__api.loadModalImage({ flyFromThumb: true });
  sb2.modalFullReady = true;          // 落地之前原图就好了
  sb2.__api.restoreModalBackdrop();
  chk('原图已就绪才落地：不重复放出垫底层', ov2.style.display === 'none',
    'display=' + JSON.stringify(ov2.style.display));

  // 非生长动画路径（退出后再点开）：垫底层应当**立刻**可见
  const sb3 = makeSandbox();
  openPair(sb3);
  const ov3 = sb3.els.modalImgOverlay;
  sb3.currentModalSide = 2;
  sb3.modalFullReady = false;
  sb3.els.modalImg.complete = false;
  sb3.__api.loadModalImage({});
  chk('无生长动画：垫底层立刻可见（不能也被藏起来）',
    ov3.classList.contains('backdrop-layer') && ov3.style.display !== 'none',
    `classes=${ov3.className} display=${JSON.stringify(ov3.style.display)}`);
}

console.log('\n=========== 12. 压扁终态：四处必须单一来源 ===========');
// 背景：用户反馈"翻到一半时图片是一条细长的长方形"，要把中点宽度压到接近 0。
// 这个值原先在四个地方各写了一遍 0.06 —— 只改其中一处，前后半段就会对不上、中间闪一下。
// 现在收敛成一个 CSS 变量 --flip-collapse，下面逐处确认没有漏网的硬编码数字。
{
  const varDef = /--flip-collapse\s*:\s*([0-9.]+)\s*;/.exec(CSS);
  chk('layout.css 定义了 --flip-collapse', !!varDef, varDef ? '值=' + varDef[1] : '没找到');

  const collapse = varDef ? parseFloat(varDef[1]) : NaN;
  // ★ 用户最终要求"直接压扁到 0 宽"。所以这里断言的终态就是 0：
  //   先是从 0.06 收到 0.004，用户仍觉得不够（0.004 在 400px 屏上还有约 1.6px），
  //   现在直接 0 —— scale3d(0,1,1) 横向退化成零宽，配 0.25 不透明度完全看不见。
  chk('压扁比例就是 0（完全压扁，不再留任何窄条）', collapse === 0, `--flip-collapse=${collapse}`);

  // 四个引用点
  const outTo = /@keyframes\s+modalFlipOut\s*\{[\s\S]*?to\s*\{([^}]*)\}/.exec(CSS);
  const inFrom = /@keyframes\s+modalFlipIn\s*\{[\s\S]*?from\s*\{([^}]*)\}/.exec(CSS);
  chk('modalFlipOut 的 to 引用变量', !!outTo && /scale3d\(var\(--flip-collapse\)/.test(outTo[1]),
    outTo ? outTo[1].trim() : '没找到');
  chk('modalFlipIn 的 from 引用变量', !!inFrom && /scale3d\(var\(--flip-collapse\)/.test(inFrom[1]),
    inFrom ? inFrom[1].trim() : '没找到');
  chk('JS 钉住终态的内联 transform 引用变量',
    /modalImg\.style\.transform\s*=\s*'scale3d\(var\(--flip-collapse\), 1, 1\)'/.test(SRC),
    '检查 category-view.js 里 modalImg.style.transform 的赋值');

  // 兜底：两个源文件里都不该再有写死的 0.06 压扁值
  const hardCss = (CSS.match(/scale3d\(0\.06\s*,\s*1\s*,\s*1\)/g) || []).length;
  const hardJs = (SRC.match(/scale3d\(0\.06\s*,\s*1\s*,\s*1\)/g) || []).length;
  chk('layout.css 里没有写死的 0.06 压扁值', hardCss === 0, `找到 ${hardCss} 处`);
  chk('category-view.js 里没有写死的 0.06 压扁值', hardJs === 0, `找到 ${hardJs} 处`);
}

console.log('\n================ 汇总 ================');
console.log(fail === 0 ? '🟢 翻面/关闭状态机全部通过' : `🔴 ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
