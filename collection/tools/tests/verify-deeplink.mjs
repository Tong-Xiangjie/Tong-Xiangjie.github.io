// 深链接精确到系列/品种的端到端验证。
//   TEST_URL=https://tong-xiangjie.github.io/collection/ node verify-deeplink.mjs
//   不设 TEST_URL 则起本地静态服务器测工作区代码。
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
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(path.join(tmpdir(), 'cdpD-'));
const DP = 9431;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
async function wsUrlOf() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p && p.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch (e) {} await new Promise(r => setTimeout(r, 250)); } throw new Error('CDP 未就绪'); }
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await wsUrlOf());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const warns = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(m.params.type)) {
    warns.push(m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 110));
  }
});

const BASE = TARGET_URL || `http://127.0.0.1:${PORT}/collection/`;

let gotoSeq = 0;
async function goto(url) {
  // ★ 必须强制**真正的文档重载**：Page.navigate 到一个"只有 #fragment 不同"的 URL
  //   在 headless 里只算同文档导航，页面不会重新初始化 ——
  //   于是测的其实是"在已初始化的页面上再跑一次 applyRoute"，
  //   与"用户打开别人分享的链接"完全不是一回事（这一度让我误判成产品 bug）。
  //   加一个变化的查询参数即可强制重载。
  const bust = (url.includes('?') ? '&' : '?') + 'r=' + (++gotoSeq);
  const target = url.includes('#') ? url.replace('#', bust + '#') : url + bust;
  await send('Page.navigate', { url: target });
  // 等"DOM 已渲染 + hash 连续若干次不再变化"。
  // ★ 不能拿 hash === '#'+buildRoute() 当就绪条件：syncRoute 写地址栏时会保留
  //   location.search（上面那个 cache-bust 参数），两者永远不相等。
  let prev = null, stable = 0;
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 320));
    try {
      const st = await evaluate(`(() => {
        if (typeof buildRoute !== 'function') return null;
        if (document.querySelectorAll('.series-body, .search-result-item').length === 0) return null;
        return { hash: location.hash, built: buildRoute() };
      })()`);
      if (!st) { prev = null; stable = 0; continue; }
      if (st.hash === prev) { stable++; if (stable >= 4) return; }
      else { prev = st.hash; stable = 1; }
    } catch (e) { prev = null; stable = 0; }
  }
}

let fail = 0;
const chk = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `\n      got  = ${JSON.stringify(got)}\n      want = ${JSON.stringify(want)}`));
};
// 数组/对象用 JSON 比较 —— 直接用 === 比数组永远不等，会造成假失败
const chkDeep = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `\n      got  = ${JSON.stringify(got)}\n      want = ${JSON.stringify(want)}`));
};

console.log('目标: ' + BASE);

// ---------- 1. 点击系列 → 地址栏 ----------
console.log('\n=== 1. 进入分类后展开系列，地址栏应带 s<i> ===');
await goto(BASE);
await evaluate(`[...document.querySelectorAll('.sidebar [onclick]')].find(e=>/onSidebarItemClick\\('rmb'\\)/.test(e.getAttribute('onclick')||'')).click()`);
await new Promise(r => setTimeout(r, 600));
await evaluate(`[...document.querySelectorAll('.sidebar [onclick]')].find(e=>/onSidebarChildClick\\('rmb', 'rmb3'\\)/.test(e.getAttribute('onclick')||'')).click()`);
await new Promise(r => setTimeout(r, 900));
chk('刚进入分类（无展开）', await evaluate(`location.hash`), '#notes/rmb/rmb3');

const r1 = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const c = getRenderContainer();
  const hs = [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'));
  if (hs.length < 3) return { why: '系列不足 3 个', n: hs.length };
  hs[2].click(); await s(500);
  const h3 = location.hash;
  const openBody = c.querySelector('.series-body.open');
  const firstId = openBody ? openBody.id : null;
  hs[2].click(); await s(500);
  return { h3, firstId, afterClose: location.hash };
})()`);
if (r1.why) { console.log('  诊断: ' + JSON.stringify(r1)); fail++; }
else {
  chk('展开第 3 个系列后 hash', r1.h3, '#notes/rmb/rmb3/s2');
  chk('展开的是 body-<scope>-s2', r1.firstId, 'body-notes_category_rmb3-s2');
  chk('收起后 hash 去掉 s2', r1.afterClose, '#notes/rmb/rmb3');
}

// ---------- 1b. 同时展开多个系列 → 地址栏必须记全 ----------
// 这是本轮修的核心问题：以前只记最上面一条，展开 3 个系列分享出去只剩 1 个。
console.log('\n=== 1b. 同时展开多个系列，地址栏必须把每一条都记上 ===');
const r1b = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const c = getRenderContainer();
  const hs = [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'));
  if (hs.length < 4) return { why: '系列不足 4 个', n: hs.length };
  // 故意乱序点：先 3 再 0 再 2，验证输出是按序号稳定排序的、而不是点击顺序
  hs[3].click(); await s(300);
  const after1 = location.hash;
  hs[0].click(); await s(300);
  const after2 = location.hash;
  hs[2].click(); await s(400);
  const after3 = location.hash;
  const openCount = c.querySelectorAll('.series-body.open').length;
  const openIds = [...c.querySelectorAll('.series-body.open')].map(e => e.id);
  return { after1, after2, after3, openCount, openIds, focusSeries: focusSeries.slice() };
})()`);
if (r1b.why) { console.log('  诊断: ' + JSON.stringify(r1b)); fail++; }
else {
  chk('展开第 1 个后只记 1 条', r1b.after1, '#notes/rmb/rmb3/s3');
  chk('再展开 1 个后记 2 条（升序）', r1b.after2, '#notes/rmb/rmb3/s0,3');
  chk('再展开 1 个后记 3 条（升序，不按点击顺序）', r1b.after3, '#notes/rmb/rmb3/s0,2,3');
  chk('界面上确实开着 3 个系列', r1b.openCount, 3);
  chkDeep('focusSeries 与界面一致', r1b.focusSeries, [0, 2, 3]);
}

// ---------- 1c. 多条展开的深链接能完整还原 ----------
console.log('\n=== 1c. #…/s0,2,3 打开后应同时展开这 3 个系列 ===');
await goto(BASE + '#notes/rmb/rmb3/s0,2,3');
const r1c = await evaluate(`(() => {
  const c = getRenderContainer();
  const open = [...c.querySelectorAll('.series-body.open')];
  return {
    hash: location.hash,
    ids: open.map(e => e.id),
    heights: open.map(e => Math.round(e.getBoundingClientRect().height)),
    focusSeries: focusSeries.slice()
  };
})()`);
chk('多条深链接 hash 未被抹掉', r1c.hash, '#notes/rmb/rmb3/s0,2,3');
chkDeep('3 个系列全部展开', r1c.ids, [
  'body-notes_category_rmb3-s0', 'body-notes_category_rmb3-s2', 'body-notes_category_rmb3-s3'
]);
chk('每个展开体都有实际高度', r1c.heights.every(h => h > 0), true);
chkDeep('focusSeries 登记完整', r1c.focusSeries, [0, 2, 3]);

// ---------- 2. 展开品种 → 地址栏 ----------
console.log('\n=== 2. 展开品种，地址栏应带 v<si.vi> ===');
const r2 = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const c = getRenderContainer();
  c.querySelectorAll('.series-body.open').forEach(b => { const h = b.previousElementSibling; if (h && h.classList.contains('series-year-header')) h.click(); });
  await s(450);
  const hs = [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'));
  // 找一个**至少 2 个品种**的系列（有的系列只有 1 个品种，选它会越界）
  let target = null, ti = -1;
  hs.forEach((h, i) => {
    if (target) return;
    const b = h.parentNode.querySelector('.series-body');
    if (b && b.querySelectorAll('.variety-header').length >= 2) { target = h; ti = i; }
  });
  if (!target) return { why: '没有含 2 个以上品种的系列' };
  target.click(); await s(500);
  const afterSeries = location.hash;
  const vh = [...target.parentNode.querySelectorAll('.variety-header')];
  vh[1].click(); await s(500);
  const afterVar = location.hash;
  const openLists = [...c.querySelectorAll('.copy-list.open')].map(e => e.id);
  vh[1].click(); await s(500);
  return { ti, afterSeries, afterVar, openLists, afterVarClose: location.hash };
})()`);
if (r2.why) { console.log('  诊断: ' + JSON.stringify(r2)); fail++; }
else {
  chk('展开含品种的系列后 hash', r2.afterSeries, `#notes/rmb/rmb3/s${r2.ti}`);
  chk('再展开第 2 个品种后 hash 用 si.vi 对', r2.afterVar, `#notes/rmb/rmb3/s${r2.ti}/v${r2.ti}.1`);
  chk('只有目标品种列表是开的', r2.openLists.length, 1);
  chk('收起品种后 hash 保留 s', r2.afterVarClose, `#notes/rmb/rmb3/s${r2.ti}`);
}

// ---------- 2b. 跨系列的多个品种 → 地址栏记全 ----------
console.log('\n=== 2b. 两个系列各展开一个品种，地址栏要记两条 ===');
const r2b = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const c = getRenderContainer();
  // 清空重来
  c.querySelectorAll('.series-body.open').forEach(b => { const h = b.previousElementSibling; if (h && h.classList.contains('series-year-header')) h.click(); });
  await s(450);
  const hs = [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'));
  // 找两个**各自有品种**的系列
  const withVar = [];
  hs.forEach((h, i) => {
    const b = h.parentNode.querySelector('.series-body');
    if (b && b.querySelectorAll('.variety-header').length > 0) withVar.push([h, i]);
  });
  if (withVar.length < 2) return { why: '不足两个含品种的系列', n: withVar.length };
  const [hA, iA] = withVar[0], [hB, iB] = withVar[1];
  hA.click(); await s(350);
  [...hA.parentNode.querySelectorAll('.variety-header')][0].click(); await s(350);
  hB.click(); await s(350);
  [...hB.parentNode.querySelectorAll('.variety-header')][0].click(); await s(450);
  const c2 = getRenderContainer();
  return { iA, iB, hash: location.hash,
           openSeries: c2.querySelectorAll('.series-body.open').length,
           openLists: c2.querySelectorAll('.copy-list.open').length,
           focusVariety: focusVariety.slice() };
})()`);
if (r2b.why) { console.log('  诊断: ' + JSON.stringify(r2b)); fail++; }
else {
  chk('两条品种都写进 v 段（升序）', r2b.hash, `#notes/rmb/rmb3/s${r2b.iA},${r2b.iB}/v${r2b.iA}.0,${r2b.iB}.0`);
  chk('界面 2 个系列开着', r2b.openSeries, 2);
  chk('界面 2 个品种列表开着', r2b.openLists, 2);
  chkDeep('focusVariety 记两条', r2b.focusVariety, [`${r2b.iA}.0`, `${r2b.iB}.0`]);
}

// ---------- 3. 深链接还原 ----------
console.log('\n=== 3. 用 #notes/rmb/rmb3/s1/v1.0 直接打开，应还原为"系列1展开+品种0展开" ===');
await goto(BASE + '#notes/rmb/rmb3/s1/v1.0');
const r3 = await evaluate(`(() => {
  const c = getRenderContainer();
  const open = [...c.querySelectorAll('.series-body.open')];
  const b = open[0];
  return {
    hash: location.hash,
    openSeriesIds: open.map(e => e.id),
    openLists: [...c.querySelectorAll('.copy-list.open')].map(e => e.id),
    bodyRectH: b ? Math.round(b.getBoundingClientRect().height) : null,
    focusOwner, focusSeries: focusSeries.slice(), focusVariety: focusVariety.slice()
  };
})()`);
chk('深链接 hash 未被自己的 syncRoute 抹掉', r3.hash, '#notes/rmb/rmb3/s1/v1.0');
chkDeep('展开的系列是 s1', r3.openSeriesIds, ['body-notes_category_rmb3-s1']);
chkDeep('展开的品种列表是 s1 v0', r3.openLists, ['list-notes_category_rmb3-v1-0']);
chk('系列体有实际高度', r3.bodyRectH > 0, true);
chk('focusOwner 归属正确', r3.focusOwner, 'notes_category_rmb3');
chkDeep('focusSeries 登记正确', r3.focusSeries, [1]);
chkDeep('focusVariety 登记正确', r3.focusVariety, ['1.0']);

// ---------- 3b. 旧格式单值链接仍要能用（向后兼容） ----------
console.log('\n=== 3b. 旧格式 #notes/rmb/rmb3/s1/v0 仍应还原（老链接不能失效） ===');
await goto(BASE + '#notes/rmb/rmb3/s1/v0');
const r3b = await evaluate(`(() => {
  const c = getRenderContainer();
  return { hash: location.hash,
           openSeriesIds: [...c.querySelectorAll('.series-body.open')].map(e => e.id),
           openLists: [...c.querySelectorAll('.copy-list.open')].map(e => e.id),
           focusVariety: focusVariety.slice() };
})()`);
chkDeep('旧链接仍展开 s1', r3b.openSeriesIds, ['body-notes_category_rmb3-s1']);
chkDeep('旧链接仍展开品种 0', r3b.openLists, ['list-notes_category_rmb3-v1-0']);
chkDeep('旧链接的 v0 被归一为 si.vi 对', r3b.focusVariety, ['1.0']);
chk('旧链接地址栏被规范化成新格式（可接受）', r3b.hash, '#notes/rmb/rmb3/s1/v1.0');

// ---------- 4. 切分类后序号不得残留 ----------
console.log('\n=== 4. 切到别的分类后，地址栏不得带上一个分类的序号 ===');
const r4 = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const el=[...document.querySelectorAll('.sidebar [onclick]')].find(e=>/onSidebarItemClick\\('commemorative'\\)/.test(e.getAttribute('onclick')||''));
  el.click(); await s(800);
  const afterSwitch = { hash: location.hash, focusOwner, focusSeries, focusVariety };
  const c = getRenderContainer();
  const hs = [...c.querySelectorAll('.series-year-header')].filter(h => !h.classList.contains('series-year-header-empty'));
  hs[0].click(); await s(500);
  return { afterSwitch, afterExpand: { hash: location.hash, focusOwner, focusSeries } };
})()`);
chk('切到纪念钞后 hash 不含旧序号', r4.afterSwitch.hash, '#notes/commemorative');
chkDeep('切分类后序号被清空', [r4.afterSwitch.focusSeries, r4.afterSwitch.focusVariety], [[], []]);
chk('切分类后归属已切到新分类', r4.afterSwitch.focusOwner, 'notes_category_commemorative');
chk('在纪念钞展开系列 0', r4.afterExpand.hash, '#notes/commemorative/s0');
chk('归属换成纪念钞', r4.afterExpand.focusOwner, 'notes_category_commemorative');

// ---------- 5. 切板块再回来 ----------
console.log('\n=== 5. 切板块再回来，地址栏应还原到原来的分类+系列 ===');
const r5 = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  onTabClick('coins'); await s(700);
  const atCoins = location.hash;
  onTabClick('notes'); await s(900);
  const c = getRenderContainer();
  return { atCoins, back: location.hash, openIds: [...c.querySelectorAll('.series-body.open')].map(e=>e.id) };
})()`);
chk('切到硬币板块', r5.atCoins, '#coins');
chk('切回纸币板块恢复定位', r5.back, '#notes/commemorative/s0');
chk('且该系列确实展开', r5.openIds.includes('body-notes_category_commemorative-s0'), true);

// ---------- 6. 概览跳转 ----------
// 概览条目的 onclick 形如 navigateFromOverview('rmb3Data', 0, 0, 0, true)：
// 第 3 个实参是品种序号、第 5 个是 hasVarieties。所以带品种的系列跳转后
// 地址栏应当是 …/s0/v0（精确到品种），而不是只到系列。
console.log('\n=== 6. 概览跳转后地址栏应精确到系列+品种 ===');
const r6 = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  currentMode='notes'; currentView='overview'; currentCategoryId=null; currentSubId=null;
  switchToCurrentContainer(); renderOverview(); await s(600);
  const t=[...document.querySelectorAll('.search-result-item')].find(el=>(el.getAttribute('onclick')||'').includes("'rmb3Data', 0,"));
  if (!t) return { why: '概览里没找到 rmb3 条目' };
  const onclick = t.getAttribute('onclick');
  t.click(); await s(1200);
  return { onclick, hash: location.hash, focus: [focusOwner, focusSeries.slice(), focusVariety.slice()] };
})()`);
if (r6.why) { console.log('  诊断: ' + JSON.stringify(r6)); fail++; }
else {
  chk('概览条目声明 hasVarieties=true', /true\)\s*$/.test(r6.onclick), true);
  chk('概览跳转后 hash 含系列+品种', r6.hash, '#notes/rmb/rmb3/s0/v0.0');
  chkDeep('概览跳转后归属与列表正确', r6.focus, ['notes_category_rmb3', [0], ['0.0']]);
}

// ---------- 6b. 无品种系列不得写出 v 段 ----------
console.log('\n=== 6b. 无品种系列跳转不得写出 v 段 ===');
const r6b = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const map = window.DATA_MAP;
  let found = null;
  outer:
  for (const dataKey of Object.keys(map)) {
    const d = map[dataKey]; if (!d || !d.series) continue;
    for (let si = 0; si < d.series.length; si++) {
      const se = d.series[si];
      const hv = !!(se.varieties && se.varieties.length);
      const copies = se.copies || [];
      if (!hv && copies.length > 0) { found = { dataKey, si, name: se.seriesName }; break outer; }
    }
  }
  if (!found) return { skipped: true };
  currentMode='notes'; currentView='overview'; currentCategoryId=null; currentSubId=null;
  switchToCurrentContainer(); renderOverview(); await s(500);
  // 直接调跳转函数，模拟概览条目（vi 给了 0 但 hasVarieties=false）
  navigateFromOverview(found.dataKey, found.si, 0, 0, false);
  await s(1200);
  const b = getRenderContainer().querySelector('.series-body.open');
  return { found, hash: location.hash, focusVariety: focusVariety.slice(),
           bodyH: b ? Math.round(b.getBoundingClientRect().height) : 0 };
})()`);
if (r6b.skipped) console.log('  – 数据里没有"无品种且有条目"的系列，跳过');
else {
  chk('无品种系列：hash 不得含 v 段', /\/v[\d.,]+$/.test(r6b.hash), false);
  chkDeep('无品种系列：focusVariety 为空', r6b.focusVariety, []);
  chk('无品种系列：系列确实展开且有高度', r6b.bodyH > 0, true);
}

// ---------- 6c. 越界序号在列表里应被忽略、不污染其它条目 ----------
console.log('\n=== 6c. s0,99 只应展开 s0，越界的 99 不生效 ===');
await goto(BASE + '#notes/rmb/rmb3/s0,99');
const r6c = await evaluate(`(() => {
  const c = getRenderContainer();
  return { openIds: [...c.querySelectorAll('.series-body.open')].map(e => e.id),
           hash: location.hash, focusSeries: focusSeries.slice() };
})()`);
chkDeep('只展开存在的 s0', r6c.openIds, ['body-notes_category_rmb3-s0']);
chkDeep('focusSeries 与界面一致（不含越界的 99）', r6c.focusSeries, [0]);
chk('越界链接地址栏被纠正为真实状态', r6c.hash, '#notes/rmb/rmb3/s0');

// ---------- 7. 越界/非法序号不得崩 ----------
console.log('\n=== 7. 越界/非法序号不应报错 ===');
await goto(BASE + '#notes/rmb/rmb3/s99/v7');
// ★ 越界目标不存在时，revealCopyInCategory 的 waitFor 要等到超时才放弃，
//   纠正发生在之后（实测约 3.0s），所以这里多等一会儿再断言。
await new Promise(r => setTimeout(r, 4500));
const r7 = await evaluate(`({ hash: location.hash, seriesCount: getRenderContainer().querySelectorAll('.series-year-header').length,
                             openCount: getRenderContainer().querySelectorAll('.series-body.open').length })`);
// ★ 语义：地址栏必须反映"真实能做到的状态"。
//   越界序号一个都展不开，所以整条展开段被去掉，回到分类级 ——
//   用户看到的是真实状态，复制/收藏出去的链接也不会是坏的。
chk('越界深链接不崩、地址栏纠正为真实状态', r7.hash, '#notes/rmb/rmb3');
chk('越界序号不会误展开任何系列', r7.openCount, 0);
chk('分类正常渲染', r7.seriesCount > 0, true);

console.log('\n================ 汇总 ================');
console.log(fail === 0 ? '🟢 全部通过' : `🔴 ${fail} 项失败`);
console.log('console.warn/error: ' + (warns.length ? warns.slice(0, 6).join(' | ') : '（无）'));
ws.close(); child.kill(); if (server) server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => {});
process.exit(fail === 0 ? 0 : 1);
