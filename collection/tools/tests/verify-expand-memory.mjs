// 验收：「藏品展开程度」只在这个系列第一次展开时生效，之后一律按记忆。
//
// 用户口径（原话）：「只有在这个小系列第一次展开的时候才使用这里的"展开程度"，
//   否则就应该用记忆。」说明文字里那句"手动展开或收起过的系列均将按您的习惯保留"
//   一直没兑现 —— 所以这里把三档逐档钉住。
//
// 实测到的两个根因（缺一不可，两个都在本用例里守着）：
//   ① 档位每次点开都重新套一遍：toggleSeries() 里只要"点之前该系列是关的"就按档位
//      把里面的品种全开 —— 于是你手动收起来的品种，收起系列再点开又冒出来了。
//      ⇒ 现在给每个系列记一个"本次会话里档位已经用过"（seriesDepthUsed），
//        只有第一次展开才套档位。"全部展开"档在进入分类时替所有系列开过一次，
//        也算用过（否则你收起再点开，又会被它把手动收起的品种撞开）。
//   ② 记忆快照拍早了：markExpandMemory() 原来写在 toggleSeries/toggleVariety 的**第一行**，
//      拍到的是点击**之前**的状态 ⇒ 你收起一个品种，记忆里记的却是"它还开着"，
//      下次渲染（切分类再回来）又替你打开。现在挪到改完 class 之后
//      （animateAccordion() 同步加/去 'open' 类，只有 max-height 走过渡）。
//
// ★ 判据认的是"用户看到的结果"：系列/品种的 open 状态，以及记忆快照里到底记了什么。
// ★ 每一轮都带 cache-buster 强制真·新文档：不带的话同一个 hash 之间是**同文档导航**，
//   页面不重载，上一轮的展开记忆与"档位已用过"标记会留着，结果全是脏的（踩过）。
// ★ 记忆本身只活在页面会话里（不跨刷新）——这是站点原有口径，本用例不越界去改它，
//   只要求"同一会话内按记忆"。
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpExpandMem-'));
const DP = 17400;
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

const CAT = '#notes/rmb/rmb3';
let seq = 0;

// 真·新文档 + 指定档位 + 进分类（顺序很重要：档位要在分类渲染之前写进去）
async function loadCategory(depth, hash) {
  seq += 1;
  await send('Page.navigate', { url: BASE + `index.html?_=${seq}#notes` });
  await sleep(4000);
  await evaluate(`window.__sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    try { localStorage.setItem('collection-expand-depth', ${JSON.stringify(depth)}); } catch (e) { }
    window.__t = {
      body: function (id) { return document.getElementById('body-' + id); },
      head: function (id) { var b = this.body(id); return b ? b.previousElementSibling : null; },
      vhead: function (id, i) { var b = this.body(id); return b ? [].slice.call(b.querySelectorAll('.variety-header'))[i] : null; },
      snap: function (id) {
        var b = this.body(id); if (!b) return null;
        var lists = [].slice.call(b.querySelectorAll('.copy-list')).filter(function (l) { return !l.hasAttribute('data-acc-permanent'); });
        return { open: b.classList.contains('open'), v: lists.map(function (l) { return l.classList.contains('open'); }) };
      },
      pick: function (excludeId) {
        var bs = [].slice.call(getRenderContainer().querySelectorAll('.series-body')).filter(function (b) {
          return b.id && b.id !== excludeId && b.querySelectorAll('.variety-header').length >= 2; });
        return bs.length ? bs[0].id.replace(/^body-/, '') : null;
      },
      pickOther: function (id) { return this.pick('body-' + id); },
      allSeries: function () { return [].slice.call(getRenderContainer().querySelectorAll('.series-body')).map(function (b) { return String(b.id || '').replace(/^body-/, ''); }).filter(Boolean); }
    };`);
  await evaluate(`location.hash = ${JSON.stringify(hash || CAT)};`);
  await sleep(2700);
}

try {
  await send('Page.enable'); await send('Runtime.enable');

  // ══════════════════ 档位①：展开到单张（默认）══════════════════
  console.log('\n══════ 档位「展开到单张」：第一次展开全开，之后按记忆 ══════\n');
  await loadCategory('copies');
  const pre = await J(`window.__sid = __t.pick(null); window.__other = __t.pickOther(window.__sid);
    return { depth: expandDepth(), sid: window.__sid, other: window.__other,
             usedFn: typeof seriesDepthUsed === 'function' && typeof markSeriesDepthUsed === 'function',
             scope: getCategoryScope() };`);
  ok(pre.usedFn, `"档位已用过"的记账函数在位（seriesDepthUsed/markSeriesDepthUsed）`);
  ok(pre.depth === 'copies' && pre.sid && pre.other,
    `档位读到 copies，取到两个含≥2 品种的系列：${pre.sid} / ${pre.other}`);

  await evaluate(`__t.head(window.__sid).click();`);
  await sleep(2400);
  const s1 = await J(`return __t.snap(window.__sid);`);
  ok(s1.open && s1.v.length >= 2 && s1.v.every(Boolean),
    `第一次点开：系列开了，里面 ${s1.v.length} 个品种全开（档位生效）`);

  await evaluate(`__t.vhead(window.__sid, 1).click();`);
  await sleep(700);
  const s2 = await J(`var id = window.__sid, mem = (window.__expandMemoryByScope || {})[getCategoryScope()] || {};
    return { snap: __t.snap(id), v2id: 'prefix', expanded: (mem.expandedVarieties || []) };`);
  ok(s2.snap.open && s2.snap.v[1] === false,
    `手动收起第 2 个品种：它确实收起了（DOM 上 ${JSON.stringify(s2.snap.v)}）`);
  // ★ 快照里存的是品种 id **不带 list- 前缀**（见 core.js 的 collectScopedExpanded），
  //   所以这里要把 DOM 的 `list-xxx` 摘掉前缀再比 —— 第一版直接拿带前缀的 id 去 indexOf，
  //   永远查不到、断言恒真（空转），等于没守。
  const v2ClosedInMem = await J(`var mem = (window.__expandMemoryByScope || {})[getCategoryScope()] || {};
    var b = __t.body(window.__sid);
    var l = [].slice.call(b.querySelectorAll('.copy-list')).filter(function(x){return !x.hasAttribute('data-acc-permanent');})[1];
    var base = l ? String(l.id).replace(/^list-/, '') : '';
    return { domId: l ? l.id : null, base: base,
             inDom: !!(l && l.classList.contains('open')),
             has: (mem.expandedVarieties || []).indexOf(base) >= 0 };`);
  ok(v2ClosedInMem.inDom === false && v2ClosedInMem.has === false,
    `记忆快照记的是"收起后"的状态（${v2ClosedInMem.base} 不在已展开清单里）—— 快照没拍早`);

  await evaluate(`__t.head(window.__sid).click();`);       // 收起系列
  await sleep(900);
  const s3 = await J(`return __t.snap(window.__sid);`);
  ok(s3.open === false && s3.v[1] === false, `收起系列：系列关上了，里面品种状态原样留着`);

  await evaluate(`__t.head(window.__sid).click();`);       // 第二次展开
  await sleep(2400);
  const s4 = await J(`return __t.snap(window.__sid);`);
  ok(s4.open && s4.v[1] === false && s4.v[0] === true,
    `第二次点开：第 2 个品种**保持收起**、第 1 个保持展开 —— 记忆赢过档位（用户报的那一条）`);

  await evaluate(`__t.head(window.__other).click();`);
  await sleep(2400);
  const s5 = await J(`return __t.snap(window.__other);`);
  ok(s5.open && s5.v.length >= 2 && s5.v.every(Boolean),
    `另一个没动过的系列（${pre.other}）第一次展开照样全开 ${s5.v.length} 个 —— 记账是按系列记的，不是"只用一次"`);

  // 切走再回来：走的是渲染期记忆这条路
  await evaluate(`location.hash = '#notes/hk/hk_boc';`);
  await sleep(1800);
  await evaluate(`location.hash = ${JSON.stringify(CAT)};`);
  await sleep(2400);
  const s6 = await J(`return __t.snap(window.__sid);`);
  ok(s6 && s6.open && s6.v[1] === false,
    `切到别的分类再回来：系列照样开着，第 2 个品种照样收着（渲染期也按记忆）`);

  // ══════════════════ 档位②：只展开系列 ══════════════════
  console.log('\n══════ 档位「只展开系列」：没人动过就别自作主张 ══════\n');
  await loadCategory('series');
  const sid2 = await J(`window.__sid = __t.pick(null); return { sid: window.__sid, depth: expandDepth() };`);
  ok(sid2.depth === 'series' && !!sid2.sid, `档位读到 series，系列 ${sid2.sid}`);
  await evaluate(`__t.head(window.__sid).click();`);
  await sleep(1500);
  const t1 = await J(`return __t.snap(window.__sid);`);
  ok(t1.open && t1.v.length >= 2 && t1.v.every(v => v === false),
    `第一次点开：只开系列本身，${t1.v.length} 个品种一个都不开（这一档就该这样）`);
  await evaluate(`__t.vhead(window.__sid, 1).click();`);
  await sleep(700);
  await evaluate(`__t.head(window.__sid).click();`);
  await sleep(900);
  await evaluate(`__t.head(window.__sid).click();`);
  await sleep(1500);
  const t2 = await J(`return __t.snap(window.__sid);`);
  ok(t2.open && t2.v[1] === true && t2.v[0] === false,
    `手动开过第 2 个品种后收起再展开：第 2 个还开着、第 1 个没被顺手打开（按记忆）`);

  // ══════════════════ 档位③：全部展开 ══════════════════
  console.log('\n══════ 档位「全部展开」：进入即全开，但手动收起过的要留住 ══════\n');
  await loadCategory('all');
  const sid3 = await J(`window.__sid = __t.pick(null); window.__other = __t.pickOther(window.__sid);
    var bodies = __t.allSeries();
    var opened = bodies.filter(function (id) { var s = __t.snap(id); return s && s.open && s.v.length && s.v.every(Boolean); });
    return { depth: expandDepth(), sid: window.__sid, other: window.__other, bodies: bodies.length, opened: opened.length };`);
  ok(sid3.depth === 'all', `档位读到 all`);
  ok(sid3.opened >= 2,
    `进入分类即全开：${sid3.opened}/${sid3.bodies} 个系列连品种一起开着（这一档就该这样）`);

  await evaluate(`__t.vhead(window.__sid, 1).click();`);    // 手动收起 S 里的第 2 个品种
  await sleep(700);
  const u1 = await J(`return __t.snap(window.__sid);`);
  ok(u1.v[1] === false, `在 ${sid3.sid} 里手动收起第 2 个品种`);
  await evaluate(`__t.head(window.__other).click();`);       // 收起另一个系列
  await sleep(900);
  await evaluate(`__t.head(window.__other).click();`);       // 再展开它
  await sleep(2400);
  const u2 = await J(`return { s: __t.snap(window.__sid), o: __t.snap(window.__other) };`);
  ok(u2.s.v[1] === false,
    `别人（${sid3.other}）收起再展开时，不会顺手把 ${sid3.sid} 里手动收起的品种又撞开 —— 记忆赢`);
  ok(u2.o.open, `${sid3.other} 自己正常开合（open=${u2.o.open}）`);
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
console.log(`  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
if (fail) { console.log(`✗ 展开程度/记忆检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 展开程度/记忆检查全部通过（${pass} 项断言${skipped ? `，跳过 ${skipped}` : ''}）`);
