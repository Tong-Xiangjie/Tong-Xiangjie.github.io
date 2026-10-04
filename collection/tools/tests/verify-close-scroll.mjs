// 「关闭板块后再点开，概览页要回到顶部」的验证。
// 已进仓库：collection/tools/tests（A4）。
//
// 用户原话：
//   「关闭板块（如：民国纸币）后，再次点开就应该概览页从头开始，
//     现在需要点击另一个板块才会这样，否则还是原来那个滚动进度」
// 关闭板块 = 点侧边栏里**已选中**的那个分类（sidebar.js 的 "点击已选中的分类：返回概览"）。
// 这条路径原来不经过 noteCategoryOwner，所以记忆留了下来 —— 现在补了 forgetCategoryScroll()。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ─────────── ① 静态：接线是否都在 ───────────
console.log('══════ ① 静态接线 ══════\n');
const core = readFileSync('collection/core.js', 'utf8');
const side = readFileSync('collection/sidebar.js', 'utf8');
ok(/function forgetCategoryScroll\s*\(/.test(core), 'core.js 里有 forgetCategoryScroll()');
const fnBody = core.slice(core.indexOf('function forgetCategoryScroll'));
ok(/isOverviewContainerKey\(k\)/.test(fnBody.slice(0, fnBody.indexOf('\n}'))), '它只清分类记忆、保留全局概览（isOverviewContainerKey 白名单）');
const closeBranch = side.slice(side.indexOf('if (currentCategoryId === catId)'), side.indexOf('// 进入分类'));
ok(/forgetCategoryScroll/.test(closeBranch), 'sidebar.js 的「点击已选中的分类：返回概览」分支里调了它');
ok(/forgetCategoryScroll/.test(side.slice(side.indexOf('点击已选中的专题'), side.indexOf('// 选中专题'))), '专题的同一分支也调了（专题无此记忆，属无害兜底）');

// ─────────── 起服务 + 无头浏览器 ───────────
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpCS-'));
const DP = 11600 + Math.floor(Math.random() * 90);
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
async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof onTabClick==='function' && document.readyState==='complete' && typeof viewScrollContainers!=='undefined' && Object.keys(viewScrollContainers).length>0)()`).catch(() => false);
    if (r) break;
    await sleep(120);
  }
  await sleep(600);
}
const snap = () => evaluate(`(()=>{
  var key = getContainerKey();
  var el = viewScrollContainers[key];
  var mode = currentMode;
  var mem = (categoryScrollMemory && categoryScrollMemory[mode]) ? categoryScrollMemory[mode] : {};
  return JSON.stringify({
    key: key, cat: currentCategoryId, view: currentView, mode: mode,
    top: el ? el.scrollTop : -1,
    scrollable: el ? (el.scrollHeight - el.clientHeight) : -1,
    memKeys: Object.keys(mem), memHere: (typeof mem[key] === 'number') ? mem[key] : null,
    overviewMem: (mem['notes_overview'] === undefined) ? null : mem['notes_overview']
  });
})()`).then(JSON.parse);
const enter = async (id) => {
  let s = await snap();
  if (s.cat !== id) { await evaluate(`onSidebarItemClick(${JSON.stringify(id)})`); await sleep(800); s = await snap(); }
  return s;
};
const clickItem = async (id) => { await evaluate(`onSidebarItemClick(${JSON.stringify(id)})`); await sleep(800); return await snap(); };
const setTop = async (y) => { await evaluate(`(()=>{ var el = viewScrollContainers[getContainerKey()]; if (el) el.scrollTop = ${y}; })()`); await sleep(450); };
// 全局概览记忆的哨兵：直接从页面里种一个值，验证关闭板块不会把它误清
const plantSentinel = () => evaluate(`(()=>{ if (!categoryScrollMemory['notes']) categoryScrollMemory['notes'] = {};
  categoryScrollMemory['notes']['notes_overview'] = 12345; return 1; })()`);

// ─────────── ② 找一个"概览能滚"的板块 ───────────
console.log('══════ ② 找一个概览能滚动的板块 ══════\n');
await boot('notes');
const cats = JSON.parse(await evaluate(`(()=>{
  var t = (typeof getCategoryTree === 'function') ? getCategoryTree() : [];
  return JSON.stringify(t.filter(function(c){ return c.children && c.children.length; }).map(function(c){ return { id: c.id, name: c.name }; }));
})()`));
ok(cats.length >= 2, `纸币板块里至少有两个带子类的分类（${cats.map(c => c.name).join('、')}）`);
let target = null, second = null;
for (const c of cats) {
  const s = await enter(c.id);
  if (s.scrollable > 80) { if (!target) target = c; else if (!second && c.id !== target.id) second = c; }
  if (target && second) break;
}
ok(!!target, `找到可滚动的板块：${target ? target.name : '（没有）'}`);
if (!target) { console.log('\n  没有可滚动的板块，后面的检查没意义。'); process.exitCode = 1; }
else {
  ok(!!second, `再找一个用于对照的：${second ? second.name : '（没有）'}`);

  // ─────────── ③ 关闭板块 → 记忆作废 → 重开回顶部 ───────────
  console.log('\n══════ ③ 关闭板块后再点开 ══════\n');
  const s1 = await enter(target.id);
  ok(s1.cat === target.id, `已进入「${target.name}」（容器 ${s1.key}，可滚 ${s1.scrollable}px）`);
  ok(/category/.test(s1.key), `分类概览用的是分类专属容器（${s1.key}），不是全局那个 notes_overview`);
  await setTop(320);
  const s2 = await snap();
  ok(s2.top > 100, `把概览滚到 ${s2.top}px`);
  ok(s2.memHere !== null && s2.memHere > 100, `滚动位置已被记住（${s2.key} → ${s2.memHere}px）`);
  await plantSentinel();

  const s3 = await clickItem(target.id);          // ★ 关闭板块（点已选中的它）
  ok(s3.cat === null, `点已选中的它 → 回到全局概览（currentCategoryId=${s3.cat}）`);
  ok(s3.memKeys.indexOf(s2.key) < 0, `关闭后该板块的滚动记忆已作废（剩下：${s3.memKeys.join(', ') || '空'}）`);
  ok(s3.overviewMem === 12345, `全局概览那条记忆没被误清（哨兵 ${s3.overviewMem}）`);

  const s4 = await enter(target.id);              // ★ 再次点开
  ok(s4.cat === target.id, `再次点开确实进了「${target.name}」`);
  ok(s4.top === 0, `★ 概览页从头开始（scrollTop=${s4.top}，修复前会是 320 上下）`);

  // ─────────── ④ 全局概览的滚动记忆不受影响 ───────────
  console.log('\n══════ ④ 全局概览的记忆 ══════\n');
  const s5 = await clickItem(target.id);           // 关闭 → 回全局概览
  ok(s5.cat === null && s5.key === 'notes_overview', `关闭后落在全局概览容器（${s5.key}）`);
  ok(s5.overviewMem === 12345, `全局概览记忆仍在（${s5.overviewMem}）`);

  // ─────────── ⑤ 切换板块再回来，仍然是"从头开始"（原规则没改坏） ───────────
  if (second) {
    console.log('\n══════ ⑤ 切换板块再回来（原规则）══════\n');
    await enter(target.id);
    await setTop(240);
    const f = await snap();
    ok(f.top > 100, `先进「${target.name}」并滚到 ${f.top}px`);
    await enter(second.id);
    const h = await enter(target.id);
    ok(h.cat === target.id, `切到「${second.name}」再回来，确实回到了「${target.name}」`);
    ok(h.top === 0, `切换板块再回来仍是从头开始（scrollTop=${h.top}）`);
  }
}

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 5).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
child.kill();
server.close();
process.exitCode = fail ? 1 : 0;
