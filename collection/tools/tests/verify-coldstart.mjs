// 冷启动验收：每个深链接都在全新标签页里打开，验证还原 + 地址栏不退化 + 不新增历史
//   TEST_URL=https://tong-xiangjie.github.io/collection/ node verify-coldstart.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_URL = process.env.TEST_URL || null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
let server = null, PORT = 0;
if (!TARGET_URL) {
  server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const full = path.join(ROOT, p);
      if (!existsSync(full)) { res.writeHead(404).end(); return; }
      if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
      const buf = await readFile(full);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      res.end(buf);
    } catch (e) { res.writeHead(500).end(String(e.message)); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;
}
const BASE = TARGET_URL || `http://127.0.0.1:${PORT}/collection/`;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(path.join(tmpdir(), 'cdpY-'));
const DP = 9419;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
async function wsUrlOf() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch (e) {} await new Promise(r => setTimeout(r, 250)); } throw new Error('未就绪'); }
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await wsUrlOf());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const warns = [];
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.consoleAPICalled' && ['warning','error'].includes(m.params.type)) warns.push(m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0,110)); });

// 每个深链接开一个**全新标签页**（全新文档），模拟"别人点开我发的链接"
async function newTabAndCheck(hash) {
  const t = await (await fetch(`http://127.0.0.1:${DP}/json/new?${encodeURIComponent(BASE + hash)}`, { method: 'PUT' })).json();
  const tws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { tws.onopen = res; tws.onerror = rej; });
  let id2 = 0; const p2 = new Map();
  tws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && p2.has(m.id)) { const { resolve, reject } = p2.get(m.id); p2.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
  const s2 = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id2; p2.set(i, { resolve, reject }); tws.send(JSON.stringify({ id: i, method, params })); });
  const e2 = async (expr) => { const r = await s2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  await s2('Page.enable'); await s2('Runtime.enable');
  let ok = false;
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 320));
    try {
      // 就绪判定要覆盖所有板块：分类页出 .series-body，概览/搜索出 .search-result-item，
      // 设置页 / 文章页各出各自的内容容器 —— 只等 .series-body 会让整页类深链接误判超时。
      if (await e2(`(document.querySelectorAll('.series-body').length > 0)
        || (document.querySelectorAll('.search-result-item').length > 0)
        || (document.querySelectorAll('.settings-page, .settings-section, #settingsArea, .article-list, .article-item, .articles-list').length > 0)
        || (document.body && document.body.innerText.length > 400)`)) { ok = true; break; }
    } catch (e) {}
  }
  await new Promise(r => setTimeout(r, 4500));   // 留足规范化/纠正的时间（越界那条要等一次 waitFor 超时）
  const res = ok ? await e2(`(() => {
    const c = getRenderContainer();
    const openBodies = [...c.querySelectorAll('.series-body.open')];
    const b = openBodies[0];
    return {
      hash: location.hash,
      built: buildRoute(),
      historyLen: history.length,
      openCount: openBodies.length,
      openCount2: c.querySelectorAll('.copy-list.open').length,
      openLists: [...c.querySelectorAll('.copy-list.open')].map(e => e.id),
      bodyH: b ? Math.round(b.getBoundingClientRect().height) : 0,
      bodyScrollH: b ? b.scrollHeight : 0,
      focusOwner, focusSeries, focusVariety
    };
  })()`) : { hash: '(超时未渲染)', built: null };
  try { await fetch(`http://127.0.0.1:${DP}/json/close/${t.id}`); } catch (e) {}
  try { tws.close(); } catch (e) {}
  return res;
}

// 构造一批深链接：不同分类、系列、品种，含边界与非法值
// want:  地址栏最终**应该**是什么（规范化/纠正之后的值）—— 地址栏必须反映真实能做到的状态
// open:  应该展开几个系列体
// lists: 期望展开的品种列表 id；null = 不断言
//   （有些分类的条目列表是**永久展开**的（data-acc-permanent，无品种系列），
//     与深链接无关，所以只对"链接里明确写了 v 段"的用例做精确断言）
const cases = [
  { h: '#notes/rmb/rmb3/s1/v0',            want: '#notes/rmb/rmb3/s1/v1.0',    open: 1, lists: ['list-notes_category_rmb3-v1-0'] },
  { h: '#notes/rmb/rmb3/s0',               want: '#notes/rmb/rmb3/s0',         open: 1, lists: [] },
  { h: '#notes/rmb/rmb3/s7/v1',            want: '#notes/rmb/rmb3/s7/v7.1',    open: 1, lists: ['list-notes_category_rmb3-v7-1'] },
  // ★ 多条目：本轮修的核心问题 —— 展开多个系列/品种，链接必须记全
  { h: '#notes/rmb/rmb3/s0,2,3',           want: '#notes/rmb/rmb3/s0,2,3',     open: 3, lists: [] },
  { h: '#notes/rmb/rmb3/s0,2,3/v0.0,2.0,3.0', want: '#notes/rmb/rmb3/s0,2,3/v0.0,2.0,3.0', open: 3, lists: ['list-notes_category_rmb3-v0-0', 'list-notes_category_rmb3-v2-0', 'list-notes_category_rmb3-v3-0'] },
  { h: '#notes/commemorative/s0',          want: '#notes/commemorative/s0',    open: 1, lists: null },
  { h: '#notes/hk/hk_boc',                 want: '#notes/hk/hk_boc',           open: 0, lists: [] },
  { h: '#notes/hk/hk_boc/s0',              want: '#notes/hk/hk_boc/s0',        open: 1, lists: [] },
  { h: '#coins/commemorative_coins/s0',    want: '#coins/commemorative_coins/s0', open: 1, lists: null },
  // 越界：一个都展不开 → 地址栏被纠正回分类级（不再留着做不到的假链接）
  { h: '#notes/rmb/rmb3/s99/v7',           want: '#notes/rmb/rmb3',            open: 0, lists: [] },
  // 越界混在有效里：只保留有效的那部分
  { h: '#notes/rmb/rmb3/s0,99',            want: '#notes/rmb/rmb3/s0',         open: 1, lists: [] },
  { h: '#notes/rmb/rmb3',                  want: '#notes/rmb/rmb3',            open: 0, lists: [] },
  // 无效分类 / 无效子分类：容错兜底到概览，不崩。
  // ★ 此时 buildRoute() 只表达"概览视图"（不写分类 id），地址栏与 built 不一致
  //   是既有行为，所以这类不校验地址栏，只要求"不崩 + 什么都没展开"。
  { h: '#notes/doesnotexist',              want: null,                        open: 0, lists: [] },
  { h: '#notes/hk/doesnotexist',           want: null,                        open: 0, lists: [] },
  // 其余形态
  { h: '#notes',                           want: '#notes',                     open: 0, lists: [] },
  { h: '#settings',                        want: '#settings',                  open: 0, lists: [] },
  { h: '#articles',                        want: '#articles',                  open: 0, lists: [] },
];
let fail = 0;
console.log('深链接'.padEnd(30) + '地址栏  展开数  展开高  展开列表  历史  判定');
for (const cs of cases) {
  const r = await newTabAndCheck(cs.h);
  if (r.hash === '(超时未渲染)') { fail++; console.log(cs.h.padEnd(30) + '✗ 渲染超时'); continue; }
  const hashOk = cs.want === null ? true : (r.hash === cs.want);
  const openOk = r.openCount === cs.open;
  const listsOk = cs.lists === null ? true
    : JSON.stringify(r.openLists.slice().sort()) === JSON.stringify(cs.lists.slice().sort());
  const heightOk = cs.open === 0 || (r.bodyH > 0 && r.bodyScrollH > 0);
  const histOk = r.historyLen === 1 || r.historyLen === 2;
  const ok = hashOk && openOk && listsOk && heightOk && histOk;
  if (!ok) fail++;
  console.log(
    cs.h.padEnd(30) +
    String(hashOk ? '✓' : '✗').padEnd(8) +
    String(r.openCount + '/' + cs.open).padEnd(8) +
    String(r.bodyH).padEnd(8) +
    String(listsOk ? '✓' : '✗').padEnd(10) +
    String(histOk ? '✓' : '✗').padEnd(6) +
    (ok ? '' : '  ← FAIL want=' + cs.want + ' got=' + r.hash +
      (listsOk ? '' : ' lists=' + JSON.stringify(r.openLists) + ' wantLists=' + JSON.stringify(cs.lists)))
  );
}
console.log('');
console.log(fail === 0 ? '🟢 冷启动全部通过' : `🔴 ${fail} 个深链接失败`);
console.log('console.warn/error: ' + (warns.length ? warns.slice(0,6).join(' | ') : '（无）'));
ws.close(); child.kill(); if (server) server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => {});
process.exit(fail === 0 ? 0 : 1);
