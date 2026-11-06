// 验收：不同专题之间的滚动位置**各归各的**，不许互相带。
//
// 背景（用户报的 bug）：用户原话「不同专题之间似乎滚动程度会相互影响？」
//   实测确实如此：在"年份图鉴"滚到 320px，再从侧边栏点"面额大观"（首次进入），
//   面额大观也从 320px 开始 —— 新专题顶着上一个专题的进度打开。
//   根因是两件事凑在一起（都在 core.js 的 rememberSpecialScroll 上面写了）：
//     ① MODE_REGISTRY 里 special 的 containerKey() 是**固定**的 'special_container'
//        —— 所有专题共用同一个滚动容器，而 switchViewContainer() 有意
//        "不清空内容、不重置滚动"；渲染函数里那几处还原只在**有记忆**时才动。
//     ② 每个专题的位置存在 specialPageCaches[selectedSpecial]，可它只在
//        saveFullState()（切板块/进设置页）里写；专题互跳的入口
//        （侧边栏点专题名、点概览卡片）全是直接覆盖 selectedSpecial，从没存过。
//   于是"进一个没去过的专题"= 没记忆可还原 + 没人复位 = 沿用上一个专题的位置。
//
// 判据（确定，不靠碰运气采样）：
//   ★ ① 是用户报的那一条本身：冷启动后 A 滚下去 → 切首次进入的 B → B 必须在顶部。
//   ★ 但只守 ① 不够：如果把位置"一律清零"来糊弄，① 也会绿。
//     所以还要证"记忆真的存在且各归各的"：A 的位置必须被存进 A 自己那一条、
//     回到 A 必须回到原处、B 的位置也必须单独存（不是共用一份）。
//   ★ 概览是第三个"页"（specialPageCaches['__overview__']），同样要各归各的。
//
// ★ 容差说明：设完 scrollTop 之后隔一会儿再读，Chrome 的滚动锚定（scroll
//   anchoring）会让它漂几个像素（实测 320 → 321/325）。所以断言一律
//   "与**切换前实测的那个值**相差不超过 TOL"，而不是钉死字面量。
//   这个容差远小于"带错专题的位置"的量级（320 vs 0），不会掩盖真问题。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
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
const BASE = `http://127.0.0.1:${server.address().port}/collection/`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpSpecialScroll-'));
const DP = 17360;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,900', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const J = async e => JSON.parse(await evaluate(`(async function(){ return JSON.stringify(await (async function(){ ${e} })()); })()`));

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const skip = m => { skipped++; console.log(`  ○ ${m}`); };
// 滚动锚定造成的像素漂移（实测 320 → 321/325）：判"同一个位置"给 12px 容差。
// 判"换了一页"（320 vs 0）用的容差必须小得多，否则会把 bug 放过去。
const TOL_SAME = 12, TOL_TOP = 4;
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
const px = v => (typeof v === 'number' ? Math.round(v) : v);

try {
  await send('Page.enable'); await send('Runtime.enable');
  // 动画/平滑滚动一律关掉，免得量到过渡中的中间值（与其它用例一致）
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: BASE + 'index.html#special' });
  await sleep(2600);

  await evaluate(`window.__sp = {
    el: function(){ return viewScrollContainers[getContainerKey()] || null; },
    top: function(){ var e=this.el(); return e ? e.scrollTop : -1; },
    room: function(){ var e=this.el(); return e ? (e.scrollHeight - e.clientHeight) : -1; },
    setTop: function(y){ var e=this.el(); if (e) e.scrollTop = y; return this.top(); },
    cache: function(){ var o={}; for (var k in specialPageCaches) o[k] = specialPageCaches[k] ? specialPageCaches[k].scrollY : null; return o; },
    clearCache: function(){ for (var k in specialPageCaches) delete specialPageCaches[k]; return 1; }
  };`);

  // ─────────── ⓪ 前提自检（防止下面几条在坏代码上假绿） ───────────
  console.log('\n══════ ⓪ 前提自检 ══════\n');
  const pre = await J(`return {
    remember: typeof rememberSpecialScroll === 'function',
    settle: typeof settleSpecialScroll === 'function',
    key: getContainerKey(),
    isSpecial: currentMode === MODE.SPECIAL
  };`);
  ok(pre.remember && pre.settle,
    `换专题的存/摆两个函数都在（rememberSpecialScroll=${pre.remember} settleSpecialScroll=${pre.settle}）—— 少了它们，下面几条会假绿`);
  ok(pre.isSpecial && pre.key === 'special_container',
    `当前就在专题板块、滚动的确是共用容器「${pre.key}」（currentMode=${await evaluate('currentMode')}）`);

  // 挑两个"内容足够长"的专题当 A / B（不写死 id，数据变了也不假红）
  const cfgs = await J(`return getSpecialConfigs().map(function(c){ return { id: c.id, name: c.name, view: c.view || 'list' }; });`);
  const roomy = [];
  for (const c of cfgs) {
    if (c.view === 'map') continue;
    await evaluate(`onSpecialOverviewItemClick(${JSON.stringify(c.id)})`);
    await sleep(600);
    const r = await J(`return { room: __sp.room(), top: __sp.top() };`);
    if (r.room > 300) roomy.push({ ...c, room: Math.round(r.room) });
    if (roomy.length >= 2) break;
  }
  console.log(`      可滚的专题：${roomy.map(c => `${c.id}(${c.room}px)`).join('、') || '（一个都没有）'}`);
  if (roomy.length < 2) {
    ok(false, `需要两个"能真正滚起来"的专题才能验证互相影响，实测只有 ${roomy.length} 个 —— 不能算通过`);
  } else {
    const A = roomy[0], B = roomy[1];

    // ─────────── ① 用户报的那一条：A 滚下去 → 切首次进入的 B ───────────
    console.log('\n══════ ① 切到没去过的专题，不许沿用上一个专题的位置 ══════\n');
    await evaluate(`__sp.clearCache()`);
    await evaluate(`onSpecialOverviewItemClick(${JSON.stringify(A.id)})`);
    await sleep(700);
    const setA = await J(`return { set: __sp.setTop(320), room: __sp.room() };`);
    await sleep(350);
    const a0 = await J(`return { top: __sp.top(), cache: __sp.cache() };`);
    ok(near(a0.top, 320, TOL_SAME), `A「${A.name}」滚到 320px（实测 ${px(a0.top)}px，可滚 ${A.room}px）—— 下面那条不是空断言`);

    await evaluate(`onSidebarItemClickInner(${JSON.stringify(B.id)})`);
    await sleep(700);
    const b0 = await J(`return { top: __sp.top(), room: __sp.room(), cache: __sp.cache() };`);
    ok(near(b0.top, 0, TOL_TOP),
      `B「${B.name}」从顶部开始（实测 ${px(b0.top)}px，期望 0）—— 不再顶着 A 的 ${px(a0.top)}px 打开`);
    ok(near(b0.cache[A.id], a0.top, TOL_SAME),
      `A 的位置被存进**它自己**那一条（specialPageCaches[${A.id}] = ${px(b0.cache[A.id])}，切换前实测 ${px(a0.top)}）`);
    console.log(`      specialPageCaches = ${JSON.stringify(b0.cache)}`);

    // ─────────── ② 各记各的：回到 A 要回原处，B 也单独有一份 ───────────
    console.log('\n══════ ② 各记各的（不是"一律清零"糊弄过去的） ══════\n');
    await evaluate(`__sp.setTop(${Math.min(90, Math.max(0, b0.room - 1))})`);
    await sleep(350);
    const b1 = await J(`return __sp.top()`);
    await evaluate(`onSidebarItemClickInner(${JSON.stringify(A.id)})`);
    await sleep(900);
    const a1 = await J(`return { top: __sp.top(), cache: __sp.cache() };`);
    ok(near(a1.top, a0.top, TOL_SAME),
      `回到 A 是 A 自己的位置（实测 ${px(a1.top)}px ≈ 离开时的 ${px(a0.top)}px）—— 零清成 0 就说明记忆没落地`);
    ok(near(a1.top, 0, TOL_TOP) === false || a0.top < TOL_TOP,
      `回到 A 不是顶部（${px(a1.top)}px）—— 与"B 从顶部开始"区分开`);
    ok(near(a1.cache[B.id], b1, TOL_SAME),
      `B 的位置也单独存了（specialPageCaches[${B.id}] = ${px(a1.cache[B.id])}，离开 B 时实测 ${px(b1)}）—— 不是两个专题共用一份`);

    // ─────────── ③ 概览是第三个"页"，同样各归各的 ───────────
    console.log('\n══════ ③ 专题概览也记自己的位置 ══════\n');
    // 概览内容不长（1280×900 下可滚 0px），把视口压矮才量得出"概览自己的位置"
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 380, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    await evaluate(`onSidebarItemClickInner(${JSON.stringify(A.id)})`);   // 点已选中 ⇒ 关闭，回概览
    await sleep(900);
    const ovRoom = await J(`return __sp.room()`);
    if (ovRoom < 20) {
      skip(`概览可滚 ${px(ovRoom)}px（不够 20px）⇒ ③ 这一节跳过（不是通过）`);
    } else {
      await J(`return __sp.setTop(99999)`);                                 // 滚到它自己的底部
      await sleep(350);
      const ov0 = await J(`return { top: __sp.top(), cache: __sp.cache() };`);
      ok(ov0.top > 20, `概览滚到 ${px(ov0.top)}px（可滚 ${px(ovRoom)}px）`);
      await evaluate(`onSpecialOverviewItemClick(${JSON.stringify(A.id)})`);
      await sleep(900);
      const inA = await J(`return { top: __sp.top(), cache: __sp.cache() };`);
      ok(near(inA.top, a0.top, TOL_SAME),
        `从概览进 A 回到 A 自己的位置（实测 ${px(inA.top)}px ≈ ${px(a0.top)}px）—— 不是概览的 ${px(ov0.top)}px`);
      ok(near(inA.cache['__overview__'], ov0.top, TOL_SAME),
        `概览的位置存进了 __overview__（${px(inA.cache['__overview__'])} ≈ 离开时实测 ${px(ov0.top)}）—— 没被专题的归档盖掉`);
      await evaluate(`onSidebarItemClickInner(${JSON.stringify(A.id)})`);  // 再关掉，回概览
      await sleep(900);
      const ov1 = await J(`return { top: __sp.top(), cache: __sp.cache() };`);
      ok(near(ov1.top, ov0.top, TOL_SAME),
        `关掉 A 回概览，回到概览自己的 ${px(ov0.top)}px（实测 ${px(ov1.top)}px）—— 不是 A 的位置 ${px(inA.top)}px`);
    }
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(600);

    // ─────────── ④ 重复进入同一个专题不会把位置弄丢 ───────────
    // 深链接、重渲染都会走"再进一次当前专题"这条路；它必须幂等：
    // 记的是当前这个位置，摆回去的还是这个位置。
    console.log('\n══════ ④ 重复进同一个专题：位置原地不动 ══════\n');
    await evaluate(`onSpecialOverviewItemClick(${JSON.stringify(A.id)})`);
    await sleep(700);
    await J(`return __sp.setTop(500)`);
    await sleep(350);
    const a2 = await J(`return __sp.top()`);
    await evaluate(`onSpecialOverviewItemClick(${JSON.stringify(A.id)})`);   // 同一专题再进一次
    await sleep(900);
    const a3 = await J(`return __sp.top()`);
    ok(near(a3, a2, TOL_SAME),
      `再进一次 A 仍停在 ${px(a2)}px（实测 ${px(a3)}px —— 掉回 0 或跳回上一个值都是错的）`);
  }
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
console.log(`  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
if (fail) { console.log(`✗ 专题滚动记忆检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 专题滚动记忆检查全部通过（${pass} 项断言${skipped ? `，跳过 ${skipped}` : ''}）`);
