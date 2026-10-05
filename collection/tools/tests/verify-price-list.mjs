// ==================== verify-price-list.mjs ====================
// 「我的」页价格列表的四件事（用户 2026-10 连续报的）：
//   ① 每条要带**大类前缀**（"纪念钞 - 澳门格兰披治大奖赛35周年纪念钞 (KP04057)"、
//      "人民币 - 第三套人民币 - 1960年 1角 枣红"）；
//   ② 标题行与具体价格行之间要有**一条分割线**，而且不能挂在第一行上（那是滚动容器，
//      线会跟着内容滚走）；
//   ③ 展开要有动画（原来只有容器 max-height 在动，行是一次性出现的）；
//   ④ 切换排序/筛选要有动画（原来是直接换 innerHTML，内容瞬间跳走）——用 FLIP。
//
// 自包含：自己起服务器、自己拉无头 Chrome、自己断言。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

// ══════════════════════════════════════════════════════════════
console.log('══════ ① 静态：分割线挂在列表体上、行有 FLIP 用的 key、有进入动画 ══════\n');
const css = readFileSync('collection/layout.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const statsJs = readFileSync('collection/stats.js', 'utf8');
const settingsJs = readFileSync('collection/settings.js', 'utf8');

ok(/\.price-list-body\.open\s*\{[^}]*border-top\s*:\s*1px/.test(css),
  '① 分割线画在 .price-list-body.open 自己身上（在滚动区域之外，不会跟着内容滚走）');
ok(/\.price-list-body\.open\s+\.price-list-item:first-child\s*\{[^}]*border-top\s*:\s*none/.test(css),
  '① 同时去掉第一行自带的 border-top（否则是重复的两条线）');
ok(/@keyframes\s+pl-row-in/.test(css) && /\.pl-enter\s*\{[^}]*animation[^}]*backwards/.test(css),
  '① 有行进入动画（@keyframes pl-row-in + .pl-enter，带 backwards 才不会"先亮一下再动"）');
ok(!/nth-child\(-n\+6\)/.test(css) && /playPriceListRowsIn/.test(settingsJs),
  '① 错开延迟由 JS 逐行给（全部条目都动，不是写死前 6 条）');
ok(/perScreen/.test(settingsJs) && /Math\.min\(i,\s*perScreen\)/.test(settingsJs),
  '① 错开只排一屏内的行、之后的封顶（否则 400 条会被拉成一两秒，且屏幕外的行长时间被藏住）');
ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.pl-enter[^}]*animation:\s*none/s.test(css),
  '① 减弱动效时不做进入动画');
ok(/data-pl-key=/.test(statsJs), '① 每行带 data-pl-key（FLIP 靠它认人：同一行换位置要认得出）');
ok(/function\s+animatePriceListRows/.test(statsJs) && /requestAnimationFrame/.test(statsJs),
  '① 切换时有 FLIP（记录旧位置 → 摆回去 → 下一帧滑到新位置）');
ok(/priceCategoryLabel\s*\(/.test(statsJs), '① 渲染时取了大类名字当前缀');

// 名称列原来是单行省略号（前缀加长后会更容易触发，这是既有策略，本次没动它）
ok(/\.price-list-name\s*\{[^}]*text-overflow\s*:\s*ellipsis/.test(css),
  '① 名称那一列的既有省略号策略没被这次改动碰到（加前缀后更容易触发，仍是单行省略）');

// ══════════════════════════════════════════════════════════════
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpPL-'));
const DP = 14900 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
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
// 主机（CI 的 runner）默认关系统动画，会把 prefers-reduced-motion 报成 reduce，而这里量的正是动画，钉死。
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#settings` });
for (let i = 0; i < 140; i++) { const r = await evaluate(`document.readyState === 'complete' && !!document.getElementById('priceListBody')`).catch(() => false); if (r) break; await sleep(120); }
await sleep(1500);
// 展开（后续几节都要列表是展开的）
await evaluate(`(()=>{ const w=document.querySelector('.price-list-wrapper'); if(w) w.scrollIntoView({block:'center'});
  const b=document.getElementById('priceListBody'); if (b && !b.classList.contains('open')) document.querySelector('.price-list-header').click(); return true; })()`);
await sleep(1000);

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ② 每条都带大类前缀 ══════\n');
const CATS = JSON.parse(await evaluate(`(()=>{
  const f = document.getElementById('priceFilterSelect');
  return JSON.stringify([...f.options].map(o => (o.textContent || '').trim()).filter(t => t && t !== '全部藏品'));
})()`));
const PREFIX = JSON.parse(await evaluate(`(()=>{
  const rows = [...document.querySelectorAll('#priceListBody .price-list-item')];
  const names = rows.map(r => (r.querySelector('.price-list-name').textContent || '').trim());
  return JSON.stringify({ 行数: rows.length, 前三条: names.slice(0, 3),
    后三条: names.slice(-3), 示例: names.filter(n => /澳门格兰披治|枣红|1角/.test(n)).slice(0, 4) });
})()`));
console.log('  分类清单：' + CATS.slice(0, 4).join(' / ') + (CATS.length > 4 ? ' …共 ' + CATS.length + ' 个' : ''));
console.log('  前三条：' + JSON.stringify(PREFIX.前三条, null, 0));
ok(CATS.length > 0, `② 筛选下拉里有分类名可当"大类"（${CATS.length} 个）`);
const withPrefix = PREFIX.前三条.concat(PREFIX.后三条).filter(n => CATS.some(c => n.startsWith(c + ' - ')));
ok(withPrefix.length === PREFIX.前三条.length + PREFIX.后三条.length,
  `② 抽查的行都带上了大类前缀（${withPrefix.length}/${PREFIX.前三条.length + PREFIX.后三条.length} 条形如"大类 - 名称"）`);
const fullCount = JSON.parse(await evaluate(`(()=>{
  const cats = [...document.getElementById('priceFilterSelect').options].map(o => (o.textContent || '').trim()).filter(t => t && t !== '全部藏品');
  const names = [...document.querySelectorAll('#priceListBody .price-list-item .price-list-name')].map(e => (e.textContent || '').trim());
  return JSON.stringify({ 全部: names.length, 有前缀: names.filter(n => cats.some(c => n.startsWith(c + ' - '))).length });
})()`));
ok(fullCount.有前缀 === fullCount.全部,
  `★ ② 全部 ${fullCount.全部} 行都有大类前缀（用户要求：每条都要有）`);
ok(PREFIX.示例.length > 0 && /^[^-]+ - /.test(PREFIX.示例[0]),
  `② 用户举的例子形态正确：「${PREFIX.示例[0] || '（没找到样例）'}」`);

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ③ 标题行与价格行之间的分割线 ══════\n');
const LINE = JSON.parse(await evaluate(`(()=>{
  const w = document.querySelector('.price-list-wrapper');
  const h = w.querySelector('.price-list-header');
  const b = document.getElementById('priceListBody');
  const first = b.querySelector('.price-list-item');
  const cb = getComputedStyle(b), cf = getComputedStyle(first);
  const rb = b.getBoundingClientRect(), rh = h.getBoundingClientRect();
  return JSON.stringify({
    标题行底: Math.round(rh.bottom), 列表体顶: Math.round(rb.top),
    列表体上边框: cb.borderTopWidth + ' ' + cb.borderTopColor,
    首行上边框: cf.borderTopWidth,
    列表体scrollTop: Math.round(b.scrollTop) });
})()`));
console.log('  ' + JSON.stringify(LINE));
ok(LINE.标题行底 === LINE.列表体顶, `③ 分割线紧贴标题行下面（标题行底 ${LINE.标题行底} = 列表体顶 ${LINE.列表体顶}）`);
ok(/^1px/.test(LINE.列表体上边框), `③ 列表体自己有 1px 上边框（${LINE.列表体上边框}）`);
ok(LINE.首行上边框 === '0px', `③ 第一行不再重复画一条（${LINE.首行上边框}）`);
// 滚下去之后分割线必须还在原位（这正是"挂在第一行上"会坏掉的地方）
const LINE2 = JSON.parse(await evaluate(`(()=>{
  const b = document.getElementById('priceListBody');
  b.scrollTop = Math.min(200, b.scrollHeight - b.clientHeight);
  const w = document.querySelector('.price-list-wrapper');
  const h = w.querySelector('.price-list-header');
  const rb = b.getBoundingClientRect(), rh = h.getBoundingClientRect();
  return JSON.stringify({ scrollTop: Math.round(b.scrollTop), 标题行底: Math.round(rh.bottom), 列表体顶: Math.round(rb.top),
    列表体上边框: getComputedStyle(b).borderTopWidth,
    首行可见: Math.round(b.querySelector('.price-list-item').getBoundingClientRect().top) });
})()`));
console.log('  滚动后：' + JSON.stringify(LINE2));
ok(LINE2.scrollTop > 0 && LINE2.标题行底 === LINE2.列表体顶 && /^1px/.test(LINE2.列表体上边框),
  '★ ③ 内容滚动后分割线仍在标题行下面（挂在第一行上的写法这时就没了）');
await evaluate(`(()=>{ document.getElementById('priceListBody').scrollTop = 0; return 1; })()`);

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ④ 切换排序/筛选有 FLIP 动画 ══════\n');
const FLIP = JSON.parse(await evaluate(`(async()=>{
  const b = document.getElementById('priceListBody');
  const first = b.querySelector('.price-list-item');
  const key = first.getAttribute('data-pl-key');
  const sel = document.getElementById('priceSortSelect');
  const t0 = performance.now();
  const frames = [];
  sel.value = 'desc'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(res => { const tick = () => {
      const row = b.querySelector('[data-pl-key="' + CSS.escape(key) + '"]');
      const cs = row ? getComputedStyle(row) : null;
      frames.push([Math.round(performance.now() - t0), cs ? cs.transform : 'none', cs ? Number(cs.opacity) : -1]);
      if (performance.now() - t0 < 700) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick); });
  const moved = frames.filter(f => f[1] !== 'none' && f[1] !== 'matrix(1, 0, 0, 1, 0, 0)');
  const row = b.querySelector('[data-pl-key="' + CSS.escape(key) + '"]');
  return JSON.stringify({ 采样: frames.length, 有位移的帧: moved.length, 前几帧: moved.slice(0, 4), 末帧: frames[frames.length-1],
    结束后的内联: row ? { transform: row.style.transform, transition: row.style.transition } : '行没了',
    行还在: !!row, 顺序正确: (()=>{ const nums=[...b.querySelectorAll('.price-list-value')].map(e=>parseFloat(e.textContent)).filter(n=>!isNaN(n));
      for (let i=1;i<nums.length;i++) if (nums[i] > nums[i-1]) return false; return nums.length > 3; })() });
})()`));
console.log(`  采样 ${FLIP.采样} 帧，其中 ${FLIP.有位移的帧} 帧有位移；前几帧 ${JSON.stringify(FLIP.前几帧.map(f => f[1].slice(0, 28)))}`);
ok(FLIP.行还在, '④ 切换后那一行还在（FLIP 靠 data-pl-key 认人）');
ok(FLIP.有位移的帧 >= 3, `★ ④ 切换排序时有 FLIP 位移帧（${FLIP.有位移的帧} 帧；修之前这里是 0，内容瞬间跳走）`);
ok(FLIP.顺序正确, '④ 切换后列表确实是新顺序（降序）');
ok(!FLIP.结束后的内联.transform && !FLIP.结束后的内联.transition,
  `★ ④ 动画结束后不留内联 style（transform="${FLIP.结束后的内联.transform}" transition="${FLIP.结束后的内联.transition}"）`);

// 切到某个分类：汇总行要"下滑展开"（max-height 从 0 长到自然高度），筛掉时"上滑收起"
const SUMANI = JSON.parse(await evaluate(`(async()=>{
  const f = document.getElementById('priceFilterSelect'), sum = document.getElementById('priceListSummary');
  const b = document.getElementById('priceListBody');
  const cat = [...f.options].filter(o => o.value !== 'all')[0];
  const rowsBefore = b.querySelectorAll('.price-list-item').length;
  const hiddenBefore = !sum.style.display || sum.style.display === 'none';
  const px = v => Math.round((parseFloat(v) || 0) * 10) / 10;
  const frames = [];
  const t0 = performance.now();
  f.value = cat.value; f.dispatchEvent(new Event('change', { bubbles: true }));
  const justAfter = { display: sum.style.display, 类: sum.className, 内联maxH: sum.style.maxHeight };
  await new Promise(res => { const tick = () => {
      const cs = getComputedStyle(sum);
      frames.push([Math.round(performance.now() - t0), px(cs.maxHeight), Number(cs.opacity)]);
      if (performance.now() - t0 < 520) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const grown = frames.map(f => f[1]).filter(h => h > 0);
  // ★ 汇总文字和行数必须在"收起之前"取：收起时 innerHTML 会被换成空汇总（filterInfo 为 null），
  //   在收起之后读只会拿到空字符串（这坑我先踩过一次）。
  const mid = { display: sum.style.display, 类: sum.className, 内联maxH: sum.style.maxHeight,
    自然高: Math.round(sum.scrollHeight), 汇总文字: (sum.textContent || '').trim().slice(0, 30),
    行数: b.querySelectorAll('.price-list-item').length };
  // 再切回"全部"：应收起（滑到 0 之后 display:none）
  const collapse = [];
  const t1 = performance.now();
  f.value = 'all'; f.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(res => { const tick = () => {
      const cs = getComputedStyle(sum);
      collapse.push([Math.round(performance.now() - t1), px(cs.maxHeight), sum.style.display]);
      if (performance.now() - t1 < 520) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const shrunk = collapse.map(c => c[1]).filter(h => h > 0);
  return JSON.stringify({ 分类: (cat.textContent || '').trim(), 切前行数: rowsBefore,
    切后行数: b.querySelectorAll('.price-list-item').length, 切前汇总隐藏: hiddenBefore,
    瞬间: justAfter, 展开中间帧数: grown.length, 展开前几帧: frames.slice(0, 6), 展开末帧: frames[frames.length - 1],
    展开后: mid, 收起中间帧数: shrunk.length, 收起末帧: collapse[collapse.length - 1],
    收起后: { 类: sum.className, 内联maxH: sum.style.maxHeight, display: sum.style.display } });
})()`));
console.log(`  展开中间帧 ${SUMANI.展开中间帧数} 帧（前几帧 max-height ${JSON.stringify(SUMANI.展开前几帧.map(f => f[1]))}，末帧 opacity ${SUMANI.展开末帧[2]}）`);
console.log(`  收起中间帧 ${SUMANI.收起中间帧数} 帧，末帧 ${JSON.stringify(SUMANI.收起末帧)}`);
ok(SUMANI.切前汇总隐藏 && SUMANI.瞬间.display === 'block', '④ 筛选生效后汇总行显示出来（既有行为不变）');
ok(SUMANI.展开中间帧数 >= 3 && SUMANI.展开前几帧.some(f => f[1] > 0 && f[1] < SUMANI.展开后.自然高),
  `★ ④ 汇总行是"下滑展开"（max-height 出现中间值：${SUMANI.展开前几帧.map(f => f[1]).join(' → ')}）`);
ok(!/pl-enter/.test(SUMANI.瞬间.类), '④ 汇总行不再用一次性淡入（用户要求改成上下滑动）');
ok(SUMANI.展开后.内联maxH === 'none', '④ 展开结束后放开高度上限（窗口变窄、文字换行也不会被裁）');
ok(SUMANI.收起中间帧数 >= 2 && SUMANI.收起末帧[2] === 'none',
  `★ ④ 汇总行是"上滑收起"（滑到 0 之后才 display:none，末帧 ${JSON.stringify(SUMANI.收起末帧)}）`);
ok(SUMANI.展开后.行数 > 0 && SUMANI.展开后.行数 <= SUMANI.切前行数, `④ 筛选后行数变少或不变（${SUMANI.切前行数} → ${SUMANI.展开后.行数}）`);
ok(/该板块总投入/.test(SUMANI.展开后.汇总文字), `④ 汇总内容仍然正确（${SUMANI.展开后.汇总文字}）`);
// 复位
await evaluate(`(()=>{ const s=document.getElementById('priceSortSelect'); s.value='default'; s.dispatchEvent(new Event('change')); return 1; })()`);
await sleep(600);

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑤ 展开有动画（全部条目错开出现）══════\n');
const EXPAND = JSON.parse(await evaluate(`(async()=>{
  const head = document.querySelector('.price-list-header'), b = document.getElementById('priceListBody');
  if (b.classList.contains('open')) { head.click(); await new Promise(r => setTimeout(r, 700)); }
  const closed = { open: b.classList.contains('open'), 高: Math.round(b.getBoundingClientRect().height),
    残留延迟: [...b.querySelectorAll('.price-list-item')].filter(r => r.style.animationDelay).length,
    残留类: b.querySelectorAll('.price-list-item.pl-enter').length };
  head.click();                              // 展开
  const all = [...b.querySelectorAll('.price-list-item')];
  const toMs = v => { const n = parseFloat(v) || 0; return /ms$/.test(v) ? n : n * 1000; };
  const info = all.map(r => ({ 类: r.className, 延迟: toMs(getComputedStyle(r).animationDelay),
    动画: getComputedStyle(r).animationName, 不透明度: Number(getComputedStyle(r).opacity) }));
  const h1 = Math.round(b.getBoundingClientRect().height);
  await new Promise(r => setTimeout(r, 300));
  const midOp = Number(getComputedStyle(all[all.length - 1]).opacity);
  await new Promise(r => setTimeout(r, 1300));
  const after = all.map(r => ({ 动画: getComputedStyle(r).animationName, 不透明度: Number(getComputedStyle(r).opacity),
    内联延迟: r.style.animationDelay }));
  return JSON.stringify({ 收起时: closed, 行数: all.length,
    带动画的行数: info.filter(r => r.动画 === 'pl-row-in').length,
    延迟: info.map(r => r.延迟),
    最大延迟: Math.max(...info.map(r => r.延迟)),
    第1行不透明度: info[0].不透明度, 最后一行中段不透明度: midOp,
    展开1帧高: h1, 展开1600ms高: Math.round(b.getBoundingClientRect().height),
    结束后: { 动画都停了: after.every(r => r.动画 === 'none'), 都不透明: after.every(r => r.不透明度 === 1),
      残留内联延迟: after.filter(r => r.内联延迟).length } });
})()`));
console.log(`  ${EXPAND.行数} 行全部挂动画=${EXPAND.带动画的行数}，前 5 个延迟 ${EXPAND.延迟.slice(0, 5).join('/')}ms，最大 ${EXPAND.最大延迟}ms`);
ok(EXPAND.收起时.open === false && EXPAND.收起时.高 === 0, '⑤ 先能收起（高度归零）');
ok(EXPAND.带动画的行数 === EXPAND.行数,
  `★ ⑤ 全部 ${EXPAND.行数} 条都播进入动画（用户要求；之前只有前 6 条）`);
const delays = EXPAND.延迟;
ok(delays[delays.length - 1] > 0 && delays.every((v, i, a) => i === 0 || v >= a[i - 1]),
  '⑤ 延迟随行号递增（错开，不是一起蹦出来）');
ok(EXPAND.最大延迟 <= 330,
  `⑤ 错开窗口有上限（最大延迟 ${EXPAND.最大延迟}ms；400 条也不会拖成好几秒，屏幕外的行不会被长时间藏住）`);
ok(delays.filter(d => d === 0).length <= 2, `⑤ 只有第一行是零延迟（${delays.findIndex(d => d > 0)} 号之后才开始错开）`);
ok(EXPAND.展开1帧高 < EXPAND.展开1600ms高, `⑤ 展开是渐变的（1 帧时 ${EXPAND.展开1帧高}px → 1600ms 后 ${EXPAND.展开1600ms高}px）`);
ok(EXPAND.结束后.动画都停了 && EXPAND.结束后.都不透明 && EXPAND.结束后.残留内联延迟 === 0,
  `⑤ 动画结束后全部恢复常态、内联延迟清干净（残留 ${EXPAND.结束后.残留内联延迟} 条）`);
ok(EXPAND.收起时.残留类 === 0 && EXPAND.收起时.残留延迟 === 0, '⑤ 收起时上一轮的动画类/延迟都已清掉');

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑥ 减弱动效：不做动画，但功能照常 ══════\n');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(200);
const RM = JSON.parse(await evaluate(`(async()=>{
  const b = document.getElementById('priceListBody'), head = document.querySelector('.price-list-header');
  const sel = document.getElementById('priceSortSelect');
  const before = [...b.querySelectorAll('.price-list-value')].map(e => e.textContent.trim()).slice(0, 3);
  const frames = [];
  const t0 = performance.now();
  sel.value = 'asc'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(res => { const tick = () => {
      const row = b.querySelector('.price-list-item');
      frames.push(getComputedStyle(row).transform);
      if (performance.now() - t0 < 300) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const anyMoved = frames.some(t => t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)');
  const rows = [...b.querySelectorAll('.price-list-item')].slice(0, 3);
  const anim = rows.map(r => getComputedStyle(r).animationName);
  const nums = [...b.querySelectorAll('.price-list-value')].map(e => parseFloat(e.textContent)).filter(n => !isNaN(n));
  let asc = true; for (let i = 1; i < nums.length; i++) if (nums[i] < nums[i - 1]) asc = false;
  return JSON.stringify({ 切换前: before, 有位移帧: anyMoved, 行的动画: anim, 升序正确: asc && nums.length > 3,
    内联: b.querySelector('.price-list-item').style.transform });
})()`));
console.log('  ' + JSON.stringify(RM));
ok(RM.有位移帧 === false, '★ ⑥ 减弱动效时不播 FLIP（不位移）');
ok(RM.行的动画.every(a => a === 'none'), `⑥ 减弱动效时也不播进入动画（${RM.行的动画.join('/')}）`);
ok(RM.升序正确, '⑥ 减弱动效时排序功能照常（内容仍然正确换了）');
await evaluate(`(()=>{ const s=document.getElementById('priceSortSelect'); s.value='default'; s.dispatchEvent(new Event('change')); return 1; })()`);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

// ══════════════════════════════════════════════════════════════
console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch { }
try { child.kill(); } catch { }
try { server.close(); } catch { }
process.exit(fail === 0 ? 0 : 1);
