// 展开状态进深链 / 刷新能恢复：collection/tools/tests/verify-expand-route.mjs
// 用户报告（原话）："现在能够记忆不同板块的展开，但是这没有在深链上面体现。具体表现为，
//   当点开另外一个曾经展开过的板块后，深链接总是空的，刷新后会丢失展开状态。"
//
// 链路（读代码 + 运行时探针确认）：手风琴开关 → toggleSeries/toggleVariety → syncFocusAndRoute()
//   → focusFromDom()（从 .series-body.open 反推 focusSeries）→ syncRoute() → buildRoute() 写 s/v 段。
//   这条在"用户手点"时是通的（用例①，今天就是绿的）。
//   ✗ 断在"靠记忆自动还原"那条路：renderSeriesList() 里 `if (!reveal) { focusSeries = [] }`，
//     之后只用 __expandMemoryByScope 里的记忆**把 DOM 打开**，从没回写 focusSeries/路由
//     —— 于是界面显示"开着"，URL 却是空的；刷新（记忆是内存态）就全丢。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const full = join(ROOT, p);
  if (!existsSync(full) || statSync(full).isDirectory()) { res.writeHead(404).end('nf'); return; }
  const b = readFileSync(full);
  res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpExpRoute-'));
const DP = 17570;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0; const pend = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('no cdp'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const J = async e => JSON.parse(await ev(`(async()=>JSON.stringify(await(async()=>{ ${e} })()))()`));
await send('Runtime.enable'); await send('Page.enable');

const openCat = '#notes/commemorative';   // 纪念钞分类：系列多、稳定
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}${openCat}` });
for (let i = 0; i < 140; i++) { if (await ev(`document.readyState==='complete' && typeof toggleSeries==='function'`).catch(() => false)) break; await sleep(120); }
await sleep(3000);

// 页面里现成的真相读取器：只读 DOM，不碰内部变量
await ev(`
window.__dom = function () {
  var ids = [].map.call(document.querySelectorAll('.series-body.open'), b => String(b.id || ''));
  var si = ids.map(x => (/-s(\\d+)$/.exec(x) || [])[1]).filter(x => x !== undefined).map(Number).sort((a,b)=>a-b);
  var vi = [];
  [].forEach.call(document.querySelectorAll('.series-body.open'), function (b) {
    var s = (/-s(\\d+)$/.exec(b.id || '') || [])[1];
    [].forEach.call(b.querySelectorAll('.copy-list.open'), function (l) {
      var v = (/-v\\d+-(\\d+)$/.exec(l.id || '') || [])[1];
      if (s !== undefined && v !== undefined) vi.push(s + '.' + v);
    });
  });
  return { openBodies: ids.length, series: si, varieties: vi.sort(), hash: location.hash,
    headers: document.querySelectorAll('.series-year-header').length };
};
window.__seg = function (letter) {
  var m = new RegExp('(?:^|/)' + letter + '([0-9.,]+)').exec(location.hash);
  return m ? m[1].split(',').map(Number).sort((a,b)=>a-b) : [];
};
// ★ 品种段必须按**原始字符串**比：vi 是 si.vi 对，用 Number() 归一化会把 11.0 变成 11、
//   11.10 变成 11.1（与真的 11.1 撞车）—— 第一版就是被自己的辅助函数骗了，看着像产品的 bug。
window.__segRaw = function (letter) {
  var m = new RegExp('(?:^|/)' + letter + '([0-9.,]+)').exec(location.hash);
  return m ? m[1].split(',').sort() : [];
};
window.__go = async function (h) { location.hash = h; await new Promise(r => setTimeout(r, 2600)); return location.hash; };
window.__clickSeries = async function (n) {
  var h = document.querySelectorAll('.series-year-header')[n || 0];
  if (!h) return 0; h.click();
  await new Promise(r => setTimeout(r, 1400)); return 1;
};
`);

console.log('══════ ① 前提：分类页与手点展开（今天就是绿的）══════\n');
const p0 = await J(`return window.__dom();`);
ok(p0.headers > 0, `① 进入 ${openCat} 后渲染出 ${p0.headers} 个系列头`);
await J(`await window.__clickSeries(0); return 1;`);
const p1 = await J(`return { d: window.__dom(), seg: window.__seg('s') };`);
ok(p1.d.openBodies === 1 && p1.seg.length === 1 && p1.seg[0] === p1.d.series[0],
  `① 手点展开第一个系列 → 地址栏带上 s${p1.seg.join(',')}（DOM 里开着 ${p1.d.openBodies} 个）`);

// ①b 二级段也要进深链（用户给的例子就是 /s0/v0.0,0.1 这种两级）
// ★ 固定装置必须先**真的**展开一个有品种的系列：第一版直接点第一个系列体内的 .variety-header，
//   而 commemorative 的第 0 个系列本身没有品种 ⇒ 什么都没点开 ⇒ `openLists>0 && 0===0` 空过判绿。
//   这里逐个点系列头，找到第一个含品种的系列再点它，找不到就让断言失败（不许静默通过）。
await J(`window.__openSomeVariety = async function () {
  // ★ 必须在**活动容器**里找：站点复用了多个容器，隐藏容器里会留着旧分类的 .copy-list.open
  //   （第一版用 document 数出 21 个"开着"的品种列表，全是别的容器里的残留，属于假数据）。
  var scope = (typeof getRenderContainer === 'function') ? getRenderContainer() : document;
  var bodies = scope.querySelectorAll('.series-body');
  for (var i = 0; i < bodies.length; i++) {
    var vh = bodies[i].querySelector('.variety-header');
    if (!vh) continue;
    var uid = String(bodies[i].id || '').replace(/^body-/, '');
    if (!bodies[i].classList.contains('open')) {
      var hdrs = scope.querySelectorAll('.series-year-header');
      for (var k = 0; k < hdrs.length; k++) {
        var oc = hdrs[k].getAttribute('onclick') || '';
        if (oc.indexOf("'" + uid + "'") >= 0) { hdrs[k].click(); break; }
      }
      await new Promise(r => setTimeout(r, 1300));
    }
    vh.click();
    await new Promise(r => setTimeout(r, 1300));
    return { uid: uid, seriesOpen: bodies[i].classList.contains('open'),
      openListsInBody: bodies[i].querySelectorAll('.copy-list.open').length };
  }
  return { uid: null, seriesOpen: false, openListsInBody: 0 };
};
return 1;`);
const setup = await J(`return await window.__openSomeVariety();`);
const r1b = await J(`var scope = (typeof getRenderContainer === 'function') ? getRenderContainer() : document;
  var opens = [], lists = scope.querySelectorAll('.copy-list.open');
  [].forEach.call(lists, function (l) {
    var b = l.closest('.series-body');
    var s = (/-s(\\d+)$/.exec((b && b.id) || '') || [])[1];
    var v = (/-v\\d+-(\\d+)$/.exec(l.id || '') || [])[1];
    if (s !== undefined && v !== undefined) opens.push(s + '.' + v);
  });
  return { openLists: lists.length, opens: opens.sort(), segV: window.__segRaw('v') };`);
ok(setup.uid && setup.seriesOpen && setup.openListsInBody > 0,
  `①b 前提：系列 ${setup.uid} 已展开，其中 ${setup.openListsInBody} 个品种列表被点开`);
ok(r1b.opens.length > 0 && r1b.segV.join(',') === r1b.opens.join(','),
  `①b 品种那一级也写进深链（DOM 开着 v[${r1b.opens.join(',')}]，地址栏 v[${r1b.segV.join(',')}]）`);

console.log('\n══════ ② 切走再回来：靠"记忆"还原的展开有没有进深链（BUG 在这里）══════\n');
await J(`await window.__go('#notes'); return 1;`);
await J(`await window.__go('${openCat}'); return 1;`);
const r2 = await J(`return { d: window.__dom(), seg: window.__seg('s'), segV: window.__segRaw('v') };`);
ok(r2.d.openBodies > 0,
  `② 前提成立：记忆把 ${r2.d.openBodies} 个系列重新展开（DOM 级事实，与内部变量无关）`);
ok(r2.seg.length === r2.d.series.length && r2.seg.join(',') === r2.d.series.join(','),
  `② 深链必须与眼前所见一致：DOM 开着 s[${r2.d.series.join(',')}]，地址栏写着 s[${r2.seg.join(',')}]`);
ok((r2.d.varieties || []).length > 0 && r2.segV.join(',') === (r2.d.varieties || []).slice().sort().join(','),
  `② 品种那一级也一致（要求非空）：DOM 开着 v[${(r2.d.varieties || []).join(',')}]，地址栏 v[${r2.segV.join(',')}]`);

console.log('\n══════ ③ 刷新之后还能不能从深链恢复 ══════\n');
await send('Page.reload');
for (let i = 0; i < 140; i++) { if (await ev(`document.readyState==='complete' && typeof toggleSeries==='function'`).catch(() => false)) break; await sleep(120); }
await sleep(3000);
await ev(`
window.__dom = function () {
  var scope = (typeof getRenderContainer === 'function') ? getRenderContainer() : document;
  var opened = scope.querySelectorAll('.series-body.open');
  var si = [], vi = [];
  [].forEach.call(opened, function (b) {
    var s = (/-s(\\d+)$/.exec(b.id || '') || [])[1];
    if (s !== undefined) si.push(Number(s));
    [].forEach.call(b.querySelectorAll('.copy-list.open'), function (l) {
      var v = (/-v\\d+-(\\d+)$/.exec(l.id || '') || [])[1];
      if (s !== undefined && v !== undefined) vi.push(s + '.' + v);
    });
  });
  return { openBodies: opened.length, series: si.sort((a,b)=>a-b), varieties: vi.sort(), hash: location.hash };
};
`);
// ★ 刷新会把页面里注入的辅助函数一起清掉，第 ④ 步之前必须重新注入（第一版漏了，脚本在 ④ 崩掉）
await ev(`
window.__seg = function (letter) {
  var m = new RegExp('(?:^|/)' + letter + '([0-9.,]+)').exec(location.hash);
  return m ? m[1].split(',').map(Number).sort((a,b)=>a-b) : [];
};
// ★ 品种段必须按**原始字符串**比：vi 是 si.vi 对，用 Number() 归一化会把 11.0 变成 11、
//   11.10 变成 11.1（与真的 11.1 撞车）—— 第一版就是被自己的辅助函数骗了，看着像产品的 bug。
window.__segRaw = function (letter) {
  var m = new RegExp('(?:^|/)' + letter + '([0-9.,]+)').exec(location.hash);
  return m ? m[1].split(',').sort() : [];
};
window.__clickSeries = async function (n) {
  var h = document.querySelectorAll('.series-year-header')[n || 0];
  if (!h) return 0; h.click();
  await new Promise(r => setTimeout(r, 1600)); return 1;
};
`);
const r3 = await J(`return { d: window.__dom(), seg: (function(){ var m=/(?:^|\\/)s([0-9.,]+)/.exec(location.hash); return m? m[1].split(',').map(Number):[]; })() };`);
ok(r3.seg.length > 0, `③ 刷新后地址栏仍带着序号段 s[${r3.seg.join(',')}]`);
ok(r3.d.openBodies > 0 && r3.d.series.join(',') === r3.seg.join(','),
  `③ 并且真的按深链恢复成展开态（刷新后 DOM 里开着 ${r3.d.openBodies} 个系列，s[${r3.d.series.join(',')}]）`);
ok((r3.d.varieties || []).length > 0
  && (r3.d.varieties || []).join(',') === (function () {
       var m = /(?:^|\/)v([0-9.,]+)/.exec(r3.d.hash || location.hash || '');
       return m ? m[1].split(',').sort().join(',') : '';
     })(),
  `③ 品种那一级也按深链恢复（刷新后 DOM 里开着 v[${(r3.d.varieties || []).join(',')}]）`);

console.log('\n══════ ④ 收起后要清理干净（别留悬挂的序号）══════\n');
// 把当前所有开着的系列都收起（①b 的固定装置可能开了不止一个），再断言段清空
await J(`var scope = (typeof getRenderContainer === 'function') ? getRenderContainer() : document;
  var opened = scope.querySelectorAll('.series-body.open');
  for (var i = 0; i < opened.length; i++) {
    var uid = String(opened[i].id || '').replace(/^body-/, '');
    var hdrs = scope.querySelectorAll('.series-year-header');
    for (var k = 0; k < hdrs.length; k++) {
      var oc = hdrs[k].getAttribute('onclick') || '';
      if (oc.indexOf("'" + uid + "'") >= 0) { hdrs[k].click(); break; }
    }
    await new Promise(r => setTimeout(r, 900));
  }
  await new Promise(r => setTimeout(r, 1600));
  return 1;`);
const r4 = await J(`return { d: window.__dom(), seg: window.__seg('s') };`);
ok(r4.d.openBodies === 0 && r4.seg.length === 0,
  `④ 收起后地址栏的 s 段一起消失（DOM ${r4.d.openBodies} 个 / 段 ${r4.seg.length} 个）`);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
try { ws.close(); } catch { }
child.kill(); server.close();
process.exitCode = fail ? 1 : 0;
