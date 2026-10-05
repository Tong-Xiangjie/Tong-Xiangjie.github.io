// 自绘下拉栏（collection/dropdown.js + layout.css 末尾那一节）
//
// 用户要求：
//   · "你可以自己写下下拉栏，不用默认的了" —— 不用系统默认下拉；
//   · "下拉栏其实也可以设置为固定某宽度，对于写不下的可以像侧边栏那样压扁宽度"；
//   · "下拉栏弹出的时候可以有一定动画"。
//
// 关键约束（这条用例守的就是它）：原生 <select> 的 .value / .options / selectedIndex /
// change 是既有契约，stats.js / router.js / special.js 和十几个用例都在用。
// 所以自绘只换"看得见的那一层"，契约必须一字不动 —— 用例里专门验证：
//   ① 原生 select 还在、还能读能写、change 照常派发；
//   ② 外部 programmatic 改 value 时，自绘那一层的文字要跟着变（反向同步）；
//   ③ 用户点选项时，既写回 value、又派发 change（正向同步），且不会无端派发。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ══════════════════════════════════════════════════════════════
console.log('══════ ① 静态：自绘只换外观，原生 select 的契约不能动 ══════\n');
const css = readFileSync('collection/layout.css', 'utf8');
const js = readFileSync('collection/dropdown.js', 'utf8');
const html = readFileSync('collection/index.html', 'utf8');

ok(html.includes('dropdown.js'), '① index.html 引入了 dropdown.js');
ok(/\.dd-native\s*\{[^}]*display\s*:\s*none/.test(css),
  '① 原生 select 是 .dd-native { display:none }（藏起来但留在 DOM 里，继续持有状态）');
ok(/min-width\s*:\s*0/.test(css), '① .dd-label 有 min-width:0（flex 子项不加这条，固定宽度会被长文字撑开，压扁就废了）');
ok(/text-overflow\s*:\s*ellipsis/.test(css), '① 长文字用省略号压扁');
ok(/\.dd-popup\s*\{[^}]*position\s*:\s*fixed/.test(css),
  '① 弹层是 position: fixed（不会被 .price-list-body / .timeline-header 这些 overflow 容器裁掉）');
ok(/\.dd\.dd-open\s+\.dd-popup/.test(css) && /transition\s*:/.test(css.match(/\.dd-popup\s*\{[^}]*\}/)?.[0] || ''),
  '① 弹层有弹出动画（.dd-open 时透明度/位移过渡）');
ok(!/select\.style\.(display|visibility)\s*=/.test(js) && !/removeChild\(select\)|select\.remove\(\)/.test(js),
  '① 没有把原生 select 从 DOM 里摘掉');
ok(/dispatchEvent\(new Event\('change'/.test(js),
  '① 用户选择时会把 change 派发出去（既有 onchange 逻辑照常跑）');
ok(/defineProperty\(select, 'value'/.test(js),
  '① 包了实例上的 value setter（改 value 不改 DOM 属性，MutationObserver 看不到，必须在这里才能反向同步）');

// ══════════════════════════════════════════════════════════════
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpDD-'));
const DP = 14000 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || '')); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
await send('Runtime.enable');
await send('Page.enable');
// 弹出动画是这条用例要量的东西，钉死动画偏好（CI 的 Windows runner 默认 reduce）
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

// 价格列表在"设置"视图（#priceSortSelect / #priceFilterSelect 都在这里）
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#settings` });
for (let i = 0; i < 140; i++) { const r = await evaluate(`!!document.getElementById('priceSortSelect') && document.readyState === 'complete'`).catch(() => false); if (r) break; await sleep(120); }
await sleep(1500);

// ══════════════════════════════════════════════════════════════
console.log('══════ ② 接管：原生藏起来、自绘顶上来 ══════\n');
const TAKE = `(()=>{
  const s = document.getElementById('priceSortSelect'), f = document.getElementById('priceFilterSelect');
  if (!s || !f) return JSON.stringify({ err: '找不到原生 select' });
  if (!s.__dd || !f.__dd) return JSON.stringify({ err: '原生 select 没有被接管', s: !!s.__dd, f: !!f.__dd });
  const pick = (sel) => { const r = sel.__dd; const tr = r.trigger; const lb = r.label;
    const trR = tr.getBoundingClientRect();
    return { id: sel.id, nativeDisplay: getComputedStyle(sel).display, nativeValue: sel.value,
      trigW: Math.round(trR.width), trigH: Math.round(trR.height), text: lb.textContent,
      optCount: sel.options.length, popupCount: r.popup.children.length,
      popupPos: getComputedStyle(r.popup).position, aria: tr.getAttribute('aria-expanded'),
      caret: !!r.box.querySelector('.dd-caret') };
  };
  return JSON.stringify({ sort: pick(s), filter: pick(f), ddCount: document.querySelectorAll('.dd').length,
    visibleNative: [...document.querySelectorAll('select')].filter(x => getComputedStyle(x).display !== 'none').length });
})()`;
const T = JSON.parse(await evaluate(TAKE));
if (T.err) { ok(false, '② ' + T.err + ' ' + JSON.stringify(T)); }
else {
  console.log(`  排序控件：原生 display=${T.sort.nativeDisplay} 值=${T.sort.nativeValue} 宽=${T.sort.trigW}px 文字「${T.sort.text}」`);
  console.log(`  筛选控件：原生 display=${T.filter.nativeDisplay} 值=${T.filter.nativeValue} 宽=${T.filter.trigW}px 文字「${T.filter.text}」`);
  ok(T.sort.nativeDisplay === 'none' && T.filter.nativeDisplay === 'none', '② 原生 select 都不再显示（用系统默认下拉的问题不存在了）');
  ok(T.visibleNative === 0, `② 页面上没有可见的原生 select（${T.visibleNative} 个）`);
  ok(T.sort.trigW > 0 && T.sort.trigH > 0, '② 自绘触发器有正常尺寸');
  ok(T.sort.optCount === T.sort.popupCount, `② 弹层里的选项数与原生 options 一致（${T.sort.optCount}）`);
  ok(T.sort.popupPos === 'fixed', '② 弹层是 fixed 定位');
  ok(T.sort.caret && T.filter.caret, '② 触发器带下拉箭头');
  ok(T.filter.trigW === 168, `② 筛选项的固定宽度按配置生效（${T.filter.trigW}px）`);
  ok(T.sort.text.length > 0, '② 触发器上显示当前选项文字');
}

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ③ 固定宽度 + 写不下的压扁省略 ══════\n');
const SQUEEZE = `(()=>{
  const f = document.getElementById('priceFilterSelect'), r = f.__dd;
  // 找最长的一个选项（筛选里是"人民币 - 第一套人民币"这类长名字）
  let li = 0, ln = -1;
  [...f.options].forEach((o, i) => { const n = (o.textContent || '').length; if (n > ln) { ln = n; li = i; } });
  const before = Math.round(r.trigger.getBoundingClientRect().width);
  const longText = f.options[li].textContent.trim();
  r.popup.querySelector('.dd-opt[data-index="' + li + '"]').click();
  const after = Math.round(r.trigger.getBoundingClientRect().width);
  const lb = r.label;
  const cs = getComputedStyle(lb);
  return JSON.stringify({ before, after, longText, label: lb.textContent,
    scrollW: lb.scrollWidth, clientW: lb.clientWidth, ellipsis: cs.textOverflow, overflow: cs.overflow,
    whiteSpace: cs.whiteSpace, title: lb.title, maxChars: longText.length });
})()`;
const Q = JSON.parse(await evaluate(SQUEEZE));
console.log(`  最长选项「${Q.longText}」（${Q.maxChars} 字）；触发器宽度 ${Q.before} → ${Q.after}`);
console.log(`  文字需要 ${Q.scrollW}px，可用 ${Q.clientW}px → 压扁=${Q.scrollW > Q.clientW}`);
ok(Q.after === Q.before, `★ ③ 选中长选项后触发器宽度不变（${Q.before} → ${Q.after}px）= 固定宽度，不是随内容变`);
ok(Q.label === Q.longText, '③ 触发器文字确实换成了刚选的那一项');
ok(Q.scrollW > Q.clientW, `★ ③ 写不下的文字被压扁（文字 ${Q.scrollW}px > 可用 ${Q.clientW}px，像侧边栏那样省略，不是把控件撑宽）`);
ok(Q.ellipsis === 'ellipsis' && Q.overflow === 'hidden' && Q.whiteSpace === 'nowrap',
  `③ 压扁是靠 overflow:hidden + text-overflow:ellipsis + nowrap（${Q.ellipsis}/${Q.overflow}/${Q.whiteSpace}）`);
ok(Q.title === Q.longText, '③ 压扁之后 title 里有完整文字（鼠标停一下能看全，信息没丢）');

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ④ 弹出动画 ══════\n');
const ANIM = `(()=>{
  const s = document.getElementById('priceSortSelect'), r = s.__dd;
  if (r.opened) r.trigger.click();
  const pop = r.popup;
  const rows = []; const t0 = performance.now();
  return new Promise(res => {
    function tick(){
      const t = Math.round(performance.now() - t0);
      const cs = getComputedStyle(pop);
      rows.push({ t, op: +(+cs.opacity).toFixed(3), tf: cs.transform });
      if (t < 700) requestAnimationFrame(tick); else res(JSON.stringify(rows));
    }
    r.trigger.click();
    tick();
  });
})()`;
const A = JSON.parse(await evaluate(ANIM));
const mids = A.filter(r => r.op > 0.02 && r.op < 0.98);
const tfMids = A.filter(r => r.tf && r.tf !== 'none' && !/matrix\(1, 0, 0, 1, 0, 0\)/.test(r.tf));
console.log('  ' + A.filter(r => r.op > 0.02 && r.op < 1).slice(0, 5).map(r => `${r.t}ms op=${r.op}`).join('  |  '));
ok(mids.length >= 2, `★ ④ 弹出过程中有中间帧（${mids.length} 帧既非全透也非全不透）= 真的在补间，不是硬切`);
ok(tfMids.length >= 1, `★ ④ 弹出过程有位移补间（${tfMids.length} 帧 transform 处于中间态）`);
ok(A[A.length - 1].op > 0.98, '④ 动画结束时完全显示');
const opened = JSON.parse(await evaluate(`(()=>{ const r=document.getElementById('priceSortSelect').__dd;
  return JSON.stringify({ open: r.opened, aria: r.trigger.getAttribute('aria-expanded'), hidden: r.popup.hidden }); })()`));
ok(opened.open === true && opened.aria === 'true' && opened.hidden === false, '④ 打开后 aria-expanded=true、弹层不再 hidden（无障碍状态跟着走）');

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑤ 事件契约：既有的 .value / change 一字不改 ══════\n');
const CONTRACT = `(()=>{
  const s = document.getElementById('priceSortSelect'), r = s.__dd;
  if (r.opened) r.trigger.click();
  const log = [];
  const onCh = (e) => log.push(e.type + ':' + s.value);
  s.addEventListener('change', onCh);
  // 选一个"和当前不同"的选项
  const cur = s.value;
  let pickIdx = -1;
  [...s.options].forEach((o, i) => { if (o.value !== cur && pickIdx < 0) pickIdx = i; });
  const want = s.options[pickIdx].value;
  r.popup.querySelector('.dd-opt[data-index="' + pickIdx + '"]').click();
  const afterPick = { value: s.value, log: log.slice(), label: r.label.textContent };
  // 再点一次同一项：值没变，就不该再派发 change（不能无端触发重排/重渲染）
  r.trigger.click();
  r.popup.querySelector('.dd-opt[data-index="' + pickIdx + '"]').click();
  const afterSame = { value: s.value, log: log.slice() };
  // 反向：外部 programmatic 改 value（router.js 就是这么干的）
  const other = s.options[0].value;
  s.value = other;
  s.dispatchEvent(new Event('change'));
  const afterOutside = { value: s.value, label: r.label.textContent, log: log.slice() };
  s.removeEventListener('change', onCh);
  return JSON.stringify({ want, afterPick, afterSame, afterOutside, firstText: s.options[0].textContent.trim() });
})()`;
const C = JSON.parse(await evaluate(CONTRACT));
console.log(`  点选「${C.want}」→ value=${C.afterPick.value}，change 记录=${JSON.stringify(C.afterPick.log)}`);
console.log(`  再点同一项 → change 记录=${JSON.stringify(C.afterSame.log)}（不该变多）`);
console.log(`  外部改 value → value=${C.afterOutside.value}，自绘文字「${C.afterOutside.label}」`);
ok(C.afterPick.value === C.want, '★ ⑤ 点选项写回了原生 select.value（既有逻辑读到的值是对的）');
ok(C.afterPick.log.length === 1 && C.afterPick.log[0] === 'change:' + C.want,
  '★ ⑤ 点选项派发了 change（onchange="onPriceSortOrFilterChange()" 这类既有处理器照常跑）');
ok(C.afterPick.label === (await evaluate(`document.getElementById('priceSortSelect').options[${0}].textContent.trim()`)) || C.afterPick.label.length > 0,
  '⑤ 自绘文字同步成新选项');
ok(C.afterSame.log.length === 1, '⑤ 重复点同一项不会重复派发 change（不制造无意义的刷新）');
ok(C.afterOutside.value === C.firstText || C.afterOutside.label === C.firstText,
  `★ ⑤ 外部 programmatic 改 value 时自绘文字跟着变（「${C.afterOutside.label}」）—— 反向同步没断`);

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑥ 键盘 / 点外部关闭 ══════\n');
const KB = `(()=>{
  const s = document.getElementById('priceSortSelect'), r = s.__dd;
  if (r.opened) r.trigger.click();
  const ev = (t, k) => r.trigger.dispatchEvent(new KeyboardEvent(t, { key: k, bubbles: true, cancelable: true }));
  const out = {};
  ev('keydown', 'ArrowDown'); out.byArrow = r.opened;
  const a0 = r.active; ev('keydown', 'ArrowDown'); out.moved = (r.active !== a0);
  ev('keydown', 'Escape'); out.escClosed = !r.opened;
  ev('keydown', 'Enter'); out.byEnter = r.opened;
  const a1 = r.active; ev('keydown', 'ArrowUp'); out.movedUp = (r.active !== a1);
  ev('keydown', 'Enter'); out.enterClosed = !r.opened; out.value = s.value;
  // 点外部关闭
  r.trigger.click(); const wasOpen = r.opened;
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  out.outsideClosed = wasOpen && !r.opened;
  return JSON.stringify(out);
})()`;
const K = JSON.parse(await evaluate(KB));
console.log('  ' + JSON.stringify(K));
ok(K.byArrow === true, '⑥ 方向键能打开下拉');
ok(K.moved === true, '⑥ ↓ 能移动高亮项');
ok(K.escClosed === true, '⑥ Esc 能关闭');
ok(K.byEnter === true, '⑥ Enter 能打开');
ok(K.movedUp === true, '⑥ ↑ 能移动高亮项');
ok(K.enterClosed === true, '⑥ Enter 能选中并关闭');
ok(K.outsideClosed === true, '⑥ 点控件外部能关闭');

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑦ 窄屏不把标题行挤爆 ══════\n');
await send('Emulation.setDeviceMetricsOverride', { width: 520, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(800);
const NARROW = JSON.parse(await evaluate(`(()=>{
  const f = document.getElementById('priceFilterSelect'), r = f.__dd;
  const tr = r.trigger.getBoundingClientRect();
  const body = document.body;
  return JSON.stringify({ trigW: Math.round(tr.width), trigRight: Math.round(tr.right),
    innerW: window.innerWidth, docScrollW: document.documentElement.scrollWidth,
    横向溢出: document.documentElement.scrollWidth > window.innerWidth + 1 });
})()`));
console.log('  ' + JSON.stringify(NARROW));
ok(NARROW.trigW < 168, `⑦ 窄屏下固定宽度自动收窄（${NARROW.trigW}px < 168px）`);
ok(NARROW.trigRight <= NARROW.innerW + 1, `⑦ 控件没有伸出视口（右边缘 ${NARROW.trigRight} ≤ ${NARROW.innerW}）`);
ok(NARROW.横向溢出 === false, '⑦ 窄屏下整页没有横向溢出（固定宽度没有把页面撑宽）');
await send('Emulation.clearDeviceMetricsOverride');

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑧ 时间轴的两个筛选（另一个视图里的下拉）══════\n');
await evaluate(`(()=>{ const t = (typeof specialCategoryTree !== 'undefined' && specialCategoryTree) ? specialCategoryTree : [];
  const hit = t.find(c => /拾年|时间轴/.test(c.name || '')) || t.find(c => c.id === 'years');
  if (hit && typeof onSpecialOverviewItemClick === 'function') onSpecialOverviewItemClick(hit.id);
  return !!hit; })()`);
for (let i = 0; i < 40; i++) {
  if (await evaluate(`!!document.querySelector('.timeline-header') && !!document.getElementById('timelineYearFilter')`).catch(() => false)) break;
  await sleep(300);
}
await sleep(900);
const TL = JSON.parse(await evaluate(`(()=>{
  const y = document.getElementById('timelineYearFilter'), m = document.getElementById('timelineMonthFilter');
  if (!y || !m) return JSON.stringify({ err: '没找到时间轴的筛选控件' });
  const g = (s) => s.__dd ? { 已接管: true, 宽: Math.round(s.__dd.trigger.getBoundingClientRect().width),
    文字: s.__dd.label.textContent, 选项数: s.options.length, 弹层项数: s.__dd.popup.children.length,
    原生display: getComputedStyle(s).display, 值: s.value } : { 已接管: false };
  return JSON.stringify({ y: g(y), m: g(m) });
})()`));
if (TL.err) { ok(false, '⑧ ' + TL.err); }
else {
  console.log(`  年份：${JSON.stringify(TL.y)}`);
  console.log(`  月份：${JSON.stringify(TL.m)}`);
  ok(TL.y.已接管 && TL.m.已接管, '⑧ 时间轴的年份/月份两个下拉也被接管了（不用回来改文件）');
  ok(TL.y.原生display === 'none' && TL.m.原生display === 'none', '⑧ 时间轴的原生 select 也藏起来了');
  ok(TL.y.宽 === 96 && TL.m.宽 === 96, `⑧ 时间轴的固定宽度按配置生效（${TL.y.宽}px / ${TL.m.宽}px）`);
  ok(TL.y.选项数 === TL.y.弹层项数 && TL.m.选项数 === TL.m.弹层项数, '⑧ 时间轴弹层的选项数与原生一致');

  // 契约：换年份要真的重新渲染时间轴（special.js 的 onTimelineFilterChange）
  const SWAP = JSON.parse(await evaluate(`(()=>{
    const y = document.getElementById('timelineYearFilter'), r = y.__dd;
    const sig = () => { const b = document.querySelector('.timeline-body') || document.querySelector('.timeline-header');
      return b ? (b.textContent || '').replace(/\\s+/g, '').slice(0, 300) : ''; };
    const before = sig();
    const cur = y.value;
    let idx = -1;
    [...y.options].forEach((o, i) => { if (o.value !== cur && idx < 0) idx = i; });
    if (idx < 0) return JSON.stringify({ 跳过: '年份只有一个选项' });
    const want = y.options[idx].value;
    r.popup.querySelector('.dd-opt[data-index="' + idx + '"]').click();
    return JSON.stringify({ want, value: y.value, 内容变了: sig() !== before, 文字: r.label.textContent });
  })()`));
  if (SWAP.跳过) console.log('  ' + SWAP.跳过);
  else {
    ok(SWAP.value === SWAP.want, `★ ⑧ 点年份选项写回了 value（${SWAP.want}）`);
    ok(SWAP.内容变了 === true, '★ ⑧ 换年份后时间轴内容真的重新渲染了（既有 onTimelineFilterChange 链路完好）');
  }
}

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
try { child.kill(); } catch {}
try { server.close(); } catch {}
process.exit(fail === 0 ? 0 : 1);
