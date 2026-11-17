// 收起最上层后再次展开，必须保留关闭前的深度：collection/tools/tests/verify-expand-depth-memory.mjs
// 用户报告（原话）："假如在展开到单张（无论是手动还是自动）的情况下直接点最上层把这个关闭了，
//   再次点开的表现会有两种：如果没有切换板块，就依旧是展开到单张；但是如果切换了板块，
//   就会展开到中间那层，还要点开一次才是单张。我希望保持都是未切换板块的那种行为。"
//
// 也就是：**关闭不应该是"忘掉"**。收起系列只是把它自己关上，里面"用户留下的品种展开态"
// 必须原样留在记忆里，下次（无论有没有切板块）展开回同一深度。
//
// 本用例只读 DOM 与 window.__expandMemoryByScope（都是站点对外的事实），不碰内部变量：
//   ④ 不切板块：收起 → 再展开 → 品种全回来（今天就是绿的，作为对照组）
//   ⑤ 切板块：收起 → 去 #notes → 回 #notes/commemorative → 再展开 → 品种也必须全回来 ← 今天判红
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpDepthMem-'));
const DP = 17580;
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

const CAT = '#notes/commemorative';
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}${CAT}` });
for (let i = 0; i < 140; i++) { if (await ev(`document.readyState==='complete' && typeof toggleSeries==='function'`).catch(() => false)) break; await sleep(120); }
await sleep(3000);

// 页面侧工具：只读 DOM / 只读记忆快照，并用"点标题"这种真实用户动作驱动
await ev(`
window.__scope = function () { return (typeof getRenderContainer === 'function') ? getRenderContainer() : document; };
window.__pick = function () {   // 选一个**真有品种**的系列，返回它的 uid
  var sc = window.__scope(), bodies = sc.querySelectorAll('.series-body');
  for (var i = 0; i < bodies.length; i++) {
    if (bodies[i].querySelectorAll('.variety-header').length >= 2) return String(bodies[i].id || '').replace(/^body-/, '');
  }
  return null;
};
window.__clickSeriesByUid = async function (uid) {
  var sc = window.__scope(), hdrs = sc.querySelectorAll('.series-year-header');
  for (var k = 0; k < hdrs.length; k++) {
    var oc = hdrs[k].getAttribute('onclick') || '';
    if (oc.indexOf("'" + uid + "'") >= 0) { hdrs[k].click(); await new Promise(r => setTimeout(r, 2400)); return 1; }
  }
  return 0;
};
// 这个系列的深度读数：体开着吗、里面哪些品种列表开着
window.__depth = function (uid) {
  var sc = window.__scope();
  var b = sc.querySelector('#body-' + uid) || document.getElementById('body-' + uid);
  if (!b) return { found: false, open: false, vari: [] };
  var vari = [];
  [].forEach.call(b.querySelectorAll('.copy-list'), function (l) {
    if (l.classList.contains('open')) vari.push(String(l.id || '').replace(/^list-/, ''));
  });
  return { found: true, open: b.classList.contains('open'),
    vari: vari.map(function (x) { return x.replace(/^.*-v/, ''); }).sort(),
    variCount: b.querySelectorAll('.copy-list').length };
};
window.__mem = function () {
  var scope = (typeof getCategoryScope === 'function') ? getCategoryScope() : null;
  var snap = ((window.__expandMemoryByScope || {})[scope]) || null;
  return { scope: scope,
    series: snap ? (snap.expandedSeries || []).map(function (x) { return x.replace(/^.*-s/, ''); }).sort() : null,
    vari: snap ? (snap.expandedVarieties || []).map(function (x) { return x.replace(/^.*-v/, ''); }).sort() : null };
};
window.__go = async function (h) { location.hash = h; await new Promise(r => setTimeout(r, 3000)); return location.hash; };
`);

const uid = await J(`return window.__pick();`);
console.log(`\n选定系列 uid = ${uid}\n`);

console.log('══════ ③ 先做到"展开到单张"（对照组，今天就是绿的）══════\n');
await J(`return await window.__clickSeriesByUid('${uid}');`);
const deep = await J(`return { d: window.__depth('${uid}'), m: window.__mem() };`);
ok(deep.d.open && deep.d.vari.length >= 2,
  `③ 系列已展开到单张：体 open=${deep.d.open}，开着 ${deep.d.vari.length}/${deep.d.variCount} 个品种`);

console.log('\n══════ ④ 不切板块：收起 → 再展开（今天应该绿）══════\n');
await J(`return await window.__clickSeriesByUid('${uid}');`);      // 收起
const collapsed = await J(`return { d: window.__depth('${uid}'), m: window.__mem() };`);
console.log(`  · 收起后：体 open=${collapsed.d.open}，DOM 里开着 ${collapsed.d.vari.length} 个品种` +
  `；记忆 series=${JSON.stringify(collapsed.m.series)} vari=${JSON.stringify(collapsed.m.vari)}`);
await J(`return await window.__clickSeriesByUid('${uid}');`);      // 再展开
const reA = await J(`return { d: window.__depth('${uid}'), m: window.__mem() };`);
ok(reA.d.open && reA.d.vari.join(',') === deep.d.vari.join(','),
  `④ 不切板块：再展开回到同一深度（预期 v[${deep.d.vari.join(',')}]，实得 v[${reA.d.vari.join(',')}]）`);

console.log('\n══════ ⑤ 切板块：收起 → 离开 → 回来 → 再展开 ══════\n');
await J(`return await window.__clickSeriesByUid('${uid}');`);      // 收起
const collapsed2 = await J(`return { d: window.__depth('${uid}'), m: window.__mem() };`);
console.log(`  · 收起后：体 open=${collapsed2.d.open}，DOM 里开着 ${collapsed2.d.vari.length} 个品种` +
  `；记忆 series=${JSON.stringify(collapsed2.m.series)} vari=${JSON.stringify(collapsed2.m.vari)}`);
await J(`return await window.__go('#notes');`);
await J(`return await window.__go('${CAT}');`);
const back = await J(`return { d: window.__depth('${uid}'), m: window.__mem() };`);
console.log(`  · 回来后：体 open=${back.d.open}，DOM 里开着 ${back.d.vari.length} 个品种` +
  `；记忆 series=${JSON.stringify(back.m.series)} vari=${JSON.stringify(back.m.vari)}`);
if (!back.d.open) await J(`return await window.__clickSeriesByUid('${uid}');`);
const reB = await J(`return { d: window.__depth('${uid}'), m: window.__mem() };`);
ok(reB.d.open && reB.d.vari.join(',') === deep.d.vari.join(','),
  `⑤ 切板块后也必须回到同一深度（预期 v[${deep.d.vari.join(',')}]，实得 v[${reB.d.vari.join(',')}]）`);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
try { ws.close(); } catch { }
child.kill(); server.close();
process.exitCode = fail ? 1 : 0;
