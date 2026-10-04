// 往返验证：设置页 / 搜索 / 板块互切之后，定位是否还在
//   TEST_URL=https://tong-xiangjie.github.io/collection/ node verify-roundtrip.mjs
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
const BASE_URL = TARGET_URL || `http://127.0.0.1:${PORT}/collection/`;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(path.join(tmpdir(), 'cdpA-'));
const DP = 9425;
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

await send('Page.navigate', { url: BASE_URL });
for (let i = 0; i < 220; i++) { await new Promise(r => setTimeout(r, 320)); try { if (await evaluate(`document.querySelectorAll('.search-result-item').length > 0 && typeof switchToCurrentContainer === 'function'`)) break; } catch (e) {} }

let fail = 0;
const chk = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `\n      got  = ${JSON.stringify(got)}\n      want = ${JSON.stringify(want)}`));
};
// 数组用 JSON 比较：直接用 === 比数组永远不等，会造成假失败
const chkDeep = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `\n      got  = ${JSON.stringify(got)}\n      want = ${JSON.stringify(want)}`));
};

// 先建立定位：rmb3 → 展开系列 1 → 展开品种 0
console.log('\n=== 建立定位：rmb/rmb3 → s1 → v0 ===');
const setup = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const clickCat = (id) => { const el=[...document.querySelectorAll('.sidebar [onclick]')].find(e=>new RegExp("onSidebarItemClick\\\\('"+id+"'\\\\)").test(e.getAttribute('onclick')||'')); if(el) el.click(); return !!el; };
  const clickSub = (p, sid) => { const el=[...document.querySelectorAll('.sidebar [onclick]')].find(e=>{const a=e.getAttribute('onclick')||''; return a.includes("onSidebarChildClick('"+p+"'") && a.includes("'"+sid+"'");}); if(el) el.click(); return el?el.getAttribute('onclick'):null; };
  const gotRmb = clickCat('rmb'); await s(500);
  const afterRmb = { hash: location.hash, view: currentView, cat: currentCategoryId, key: getContainerKey() };
  const subAttr = clickSub('rmb', 'rmb3'); await s(1000);
  const c = getRenderContainer();
  const afterSub = { hash: location.hash, view: currentView, cat: currentCategoryId, sub: currentSubId,
                     key: getContainerKey(), headers: c.querySelectorAll('.series-year-header').length,
                     bodies: c.querySelectorAll('.series-body').length };
  const hs = [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'));
  if (hs.length < 2) return { gotRmb, afterRmb, subAttr, afterSub, why: '系列不足 2 个' };
  hs[1].click(); await s(500);
  const vh = [...hs[1].parentNode.querySelectorAll('.variety-header')];
  if (!vh.length) return { gotRmb, afterRmb, subAttr, afterSub, why: '该系列无品种', seriesCount: hs.length };
  vh[0].click(); await s(500);
  return { gotRmb, afterRmb, subAttr, afterSub, hash: location.hash, histLen: history.length, vCount: vh.length };
})()`);
if (setup.why) { console.log('  诊断：' + JSON.stringify(setup, null, 2)); fail++; }
chk('定位已建立', setup.hash, '#notes/rmb/rmb3/s1/v1.0');
const baseHist = setup.histLen;

// --- 往返 1：设置页 ---
console.log('\n=== 往返 1：进设置页再返回 ===');
const r1 = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  onTabClick('settings'); await s(800);
  const inSettings = location.hash;
  onTabClick('notes'); await s(1000);
  const c = getRenderContainer();
  return { inSettings, back: location.hash,
           openBodies: [...c.querySelectorAll('.series-body.open')].map(e=>e.id),
           openLists: [...c.querySelectorAll('.copy-list.open')].map(e=>e.id),
           bodyH: (()=>{const b=c.querySelector('.series-body.open'); return b?Math.round(b.getBoundingClientRect().height):0;})(),
           histLen: history.length };
})()`);
chk('设置页 hash', r1.inSettings, '#settings');
chk('返回后定位保住', r1.back, '#notes/rmb/rmb3/s1/v1.0');
chk('返回后系列仍展开', r1.openBodies, ['body-notes_category_rmb3-s1']);
chk('返回后品种仍展开', r1.openLists, ['list-notes_category_rmb3-v1-0']);
chk('返回后确实有高度', r1.bodyH > 0, true);

// --- 往返 2：搜索 ---
console.log('\n=== 往返 2：去搜索再回分类 ===');
const r2 = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  // 走真实 UI：在搜索框里输入并派发 input 事件（实时搜索模式）
  const inp = document.getElementById('searchInput');
  const before = location.hash;
  inp.value = '水印';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await s(1200);
  const inSearch = location.hash;
  const searchView = currentView;
  // 回分类：点侧边栏（与用户操作一致）
  const el2=[...document.querySelectorAll('.sidebar [onclick]')].find(e=>/onSidebarItemClick\\('rmb'\\)/.test(e.getAttribute('onclick')||''));
  if (el2) el2.click(); await s(500);
  const el3=[...document.querySelectorAll('.sidebar [onclick]')].find(e=>/onSidebarChildClick\\('rmb', 'rmb3'\\)/.test(e.getAttribute('onclick')||''));
  if (el3) { el3.click(); await s(900); }
  const c = getRenderContainer();
  return { before, inSearch, searchView, after: location.hash,
           openBodies: [...c.querySelectorAll('.series-body.open')].length,
           focus: [focusOwner, focusSeries, focusVariety] };
})()`);
console.log('  · 诊断：' + JSON.stringify(r2));
chk('搜索 hash 生效', /^#notes\/search\//.test(r2.inSearch), true);
chk('回到分类后 hash 是分类级（重新进入分类不残留旧定位）', r2.after, '#notes/rmb/rmb3');

// --- 往返 3：板块互切 3 轮 ---
console.log('\n=== 往返 3：板块互切 3 轮，定位与历史都要稳 ===');
const r3 = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  // 重新建立定位
  const c = getRenderContainer();
  const hs = [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'));
  hs[3].click(); await s(500);
  const target = location.hash;
  const seen = [];
  for (let i=0;i<3;i++) {
    onTabClick('coins'); await s(500); seen.push(location.hash);
    onTabClick('notes'); await s(700); seen.push(location.hash);
  }
  return { target, seen, histLen: history.length };
})()`);
chk('三次往返后每次都回到同一位置', new Set(r3.seen.filter(h => h.startsWith('#notes'))).size, 1);
chk('回到的位置就是离开时的位置', r3.seen[r3.seen.length - 1], r3.target);
console.log(`  · 往返 3 后历史 ${r3.histLen}（起始 ${baseHist}）`);

// --- 往返 4：多条目展开跨板块往返 ---
// 本轮修的正是"只记最上面一条"。往返之后必须**每一条都还在**，
// 而且顺序稳定（否则每次切板块回来链接都变，用户没法收藏/分享）。
console.log('\n=== 往返 4：同时展开 3 个系列，切板块往返后每一条都要在 ===');
const r4 = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const c = getRenderContainer();
  c.querySelectorAll('.series-body.open').forEach(b => {
    const h = b.previousElementSibling;
    if (h && h.classList.contains('series-year-header')) h.click();
  });
  await s(500);
  const hs = [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'));
  if (hs.length < 4) return { why: '系列不足 4 个' };
  hs[1].click(); await s(250);
  hs[3].click(); await s(250);
  hs[0].click(); await s(450);
  const before = location.hash;
  const beforeIds = [...c.querySelectorAll('.series-body.open')].map(e => e.id);
  onTabClick('coins'); await s(600);
  onTabClick('notes'); await s(900);
  const c2 = getRenderContainer();
  return { before, beforeIds,
           after: location.hash,
           afterIds: [...c2.querySelectorAll('.series-body.open')].map(e => e.id),
           histLen: history.length };
})()`);
if (r4.why) { console.log('  诊断: ' + JSON.stringify(r4)); fail++; }
else {
  chk('离开时记了 3 条', r4.before, '#notes/rmb/rmb3/s0,1,3');
  chkDeep('往返后地址栏与离开时一致', r4.after, r4.before);
  chkDeep('往返后 3 个系列都还开着', r4.afterIds, r4.beforeIds);
  chk('往返没有新增历史', r4.histLen, baseHist);
}

console.log('\n================ 汇总 ================');
console.log(fail === 0 ? '🟢 往返全部通过' : `🔴 ${fail} 项失败`);
console.log('console.warn/error: ' + (warns.length ? warns.slice(0,6).join(' | ') : '（无）'));
ws.close(); child.kill(); if (server) server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => {});
process.exit(fail === 0 ? 0 : 1);
