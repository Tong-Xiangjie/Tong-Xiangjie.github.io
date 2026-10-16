// 偏好默认值验收：① 文章「模糊搜索」默认**开** ② 图片「离线预缓存（自动缓存）」默认**关**
//
// 自包含：自己起本地 HTTP 服务器、自己拉起无头 Chrome、自己断言（零依赖，不读任何用例外的夹具）。
// 跑法：node collection/tools/tests/verify-pref-defaults.mjs
//       node collection/tools/tests/run.mjs --only pref-defaults
//
// ★ 断言对象是"清空 localStorage 之后的首访默认值"，不是"当前进程里碰巧是什么值"：
//   这两个开关都存在 localStorage 里，写过的偏好会压过默认值。所以每一条默认值断言之前
//   都先 localStorage.clear() + 硬重载一次，量到的才是**从没设置过的用户**会看到的东西。
// ★ 同时反向验"已存偏好优先"：显式把两个偏好设成与默认相反的取值 → 刷新 → 仍然是那个反值。
//   这一条是"改默认值只影响首访用户"的唯一证据；少了它，默认值改动会静默冲掉老用户的偏好。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpPrefDef-'));
// 端口不写死：别的用例可能同时在跑，抢同一个调试端口会互相插页面（见 verify-4issues 的注释）。
// ★ 随机段必须避开**所有**写死的端口，也要避开别的用例的随机段，否则照样会连错浏览器 ——
//   collection/tools/tests/check-portable.mjs 的第 ② 项查的就是这个：
//   10990+90 会盖住 verify-search-case(10991) / verify-octo(10995)，所以挪到没人用的 11200 段
//   （11200-11289：全仓库无写死端口落入，也与其它随机段不重叠）。
const DP = 11200 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
let wsUrl = '';
for (let i = 0; i < 80 && !wsUrl; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p && p.webSocketDebuggerUrl) wsUrl = p.webSocketDebuggerUrl; } catch (e) { }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('  ✗ CDP 未就绪'); child.kill(); server.close(); process.exit(2); }
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// 等页面脚本与首屏就绪
async function waitBoot() {
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof onTabClick==='function' && typeof articleFuzzyOn==='function'
      && typeof precacheAutoEnabled==='function' && document.readyState==='complete')()`).catch(() => false);
    if (r) break;
    await sleep(250);
  }
  await sleep(1200);
}
// 硬重载：先跳 about:blank 丢掉文档，再带时间戳重新进「我的」（避免同文档导航沿用运行时状态）
async function hardReload() {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(350);
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#settings` });
  await waitBoot();
  // 深链接有时停在别处：确保「我的」页真的渲染出来（两个开关是设置页独有的）
  const has = await evaluate(`!!document.getElementById('precacheAutoSwitch')`).catch(() => false);
  if (!has) { await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(1500); }
}
// 两个开关的外观 + 「使用原图」作对照（它不该被本次改动影响）
const SWITCHES = `(()=>{
  const g = id => { const e = document.getElementById(id); if (!e) return null;
    return { on: e.classList.contains('on'), aria: e.getAttribute('aria-checked'),
             pressed: e.getAttribute('aria-pressed'), role: e.getAttribute('role') }; };
  return JSON.stringify({ fuzzy: g('articleFuzzySwitch'), precache: g('precacheAutoSwitch'), grid: g('gridOriginalSwitch') });
})()`;
const STORED = `JSON.stringify({ fuzzy: localStorage.getItem('collection-article-fuzzy'),
  precache: localStorage.getItem('precache-auto') })`;

console.log('════════════════════════════════════════════════');
console.log('  偏好默认值：模糊搜索默认开 / 离线预缓存默认关');
console.log('════════════════════════════════════════════════');

try {
  await send('Page.enable'); await send('Runtime.enable');

  // ───────────── ⓪ 先建立 origin，然后显式清空 localStorage ─────────────
  console.log('\n══════ ⓪ 清空 localStorage（模拟"从没设置过的用户"）══════');
  await hardReload();
  await evaluate(`(()=>{ localStorage.clear(); return true; })()`);
  await hardReload();
  const stored0 = JSON.parse(await evaluate(STORED));
  console.log(`  清空后两个偏好键：${JSON.stringify(stored0)}`);
  ok(stored0.fuzzy === null, '清空后 collection-article-fuzzy 不存在（默认值是代码给的，不是被写进存储的）');
  ok(stored0.precache === null, '清空后 precache-auto 不存在（同上）');

  // ───────────── ① 首访默认值（函数口径）─────────────
  console.log('\n══════ ① 首访默认值：模糊＝开、离线预缓存＝关 ══════');
  const fuzzyDef = await evaluate(`articleFuzzyOn()`);
  const precacheDef = await evaluate(`precacheAutoEnabled()`);
  console.log(`  articleFuzzyOn()=${fuzzyDef}   precacheAutoEnabled()=${precacheDef}`);
  ok(fuzzyDef === true, '★ 未设置过偏好时 articleFuzzyOn() === true（模糊搜索默认开）');
  ok(precacheDef === false, '★ 未设置过偏好时 precacheAutoEnabled() === false（图片离线预缓存默认关）');

  // ───────────── ② 「我的」页面里开关的默认外观 ─────────────
  console.log('\n══════ ②「我的」页面里两个开关的默认外观 ══════');
  const sw0 = JSON.parse(await evaluate(SWITCHES));
  console.log(`  articleFuzzySwitch = ${JSON.stringify(sw0.fuzzy)}`);
  console.log(`  precacheAutoSwitch = ${JSON.stringify(sw0.precache)}`);
  console.log(`  gridOriginalSwitch = ${JSON.stringify(sw0.grid)}（对照，本次不改）`);
  ok(!!sw0.fuzzy, '「我的」页里有 #articleFuzzySwitch');
  ok(!!sw0.precache, '「我的」页里有 #precacheAutoSwitch');
  ok(sw0.fuzzy && sw0.fuzzy.on === true, '★ #articleFuzzySwitch 默认带 on 类（渲染成"开"）');
  ok(sw0.fuzzy && sw0.fuzzy.aria === 'true', '★ #articleFuzzySwitch 默认 aria-checked="true"');
  ok(sw0.precache && sw0.precache.on === false, '★ #precacheAutoSwitch 默认**不带** on 类（渲染成"关"）');
  ok(sw0.precache && sw0.precache.aria === 'false', '★ #precacheAutoSwitch 默认 aria-checked="false"');
  // 需求原话写的是 aria-pressed；实现用的是 role="switch" 的 aria-checked（开关语义的标准写法）。
  // 这里如实记录：两者都没有 aria-pressed，状态由 aria-checked 承载。
  ok(sw0.fuzzy && sw0.fuzzy.role === 'switch' && sw0.precache && sw0.precache.role === 'switch',
    '两个开关都是 role="switch"（状态属性是 aria-checked，实现里没有 aria-pressed）');
  ok(sw0.grid && sw0.grid.on === false && sw0.grid.aria === 'false', '对照：#gridOriginalSwitch 仍是默认关（未被本次改动波及）');

  // ───────────── ③ 已存偏好优先（与默认相反的取值）─────────────
  console.log('\n══════ ③ 已存偏好优先：设成反值 → 刷新仍是反值 ══════');
  await evaluate(`(()=>{ setArticleFuzzy(false); setPrecacheAuto(true); return true; })()`);
  await sleep(300);
  const stored1 = JSON.parse(await evaluate(STORED));
  console.log(`  落盘结果：${JSON.stringify(stored1)}`);
  ok(stored1.fuzzy === '0', "setArticleFuzzy(false) 落盘为 '0'");
  ok(stored1.precache === '1', "setPrecacheAuto(true) 落盘为 '1'");

  await hardReload();
  const fuzzyAfter = await evaluate(`articleFuzzyOn()`);
  const precacheAfter = await evaluate(`precacheAutoEnabled()`);
  console.log(`  刷新后：articleFuzzyOn()=${fuzzyAfter}   precacheAutoEnabled()=${precacheAfter}`);
  ok(fuzzyAfter === false, '★ 已存偏好优先：模糊存了 \'0\'，刷新后仍是关（没有被"默认开"冲掉）');
  ok(precacheAfter === true, '★ 已存偏好优先：预缓存存了 \'1\'，刷新后仍是开（没有被"默认关"冲掉）');
  const sw1 = JSON.parse(await evaluate(SWITCHES));
  console.log(`  刷新后开关外观：fuzzy=${JSON.stringify(sw1.fuzzy)}  precache=${JSON.stringify(sw1.precache)}`);
  ok(sw1.fuzzy && sw1.fuzzy.on === false && sw1.fuzzy.aria === 'false', '「我的」里模糊开关跟着已存偏好显示为关');
  ok(sw1.precache && sw1.precache.on === true && sw1.precache.aria === 'true', '「我的」里自动缓存开关跟着已存偏好显示为开');

  // ───────────── ④ 反向：存成默认值本身，刷新后就是默认值 ─────────────
  console.log('\n══════ ④ 反向：存成"与默认相同"的值，刷新后一致 ══════');
  await evaluate(`(()=>{ setArticleFuzzy(true); setPrecacheAuto(false); return true; })()`);
  await sleep(300);
  await hardReload();
  ok(await evaluate(`articleFuzzyOn()`) === true, '模糊存 \'1\' → 刷新后是开');
  ok(await evaluate(`precacheAutoEnabled()`) === false, '预缓存存 \'0\' → 刷新后是关');

  // ───────────── ⑤ 真实交互路径：点「我的」里的开关 ─────────────
  console.log('\n══════ ⑤ 走真实交互路径：点开关能取反并落盘 ══════');
  await evaluate(`(()=>{ toggleArticleFuzzy(); return true; })()`);
  await sleep(300);
  ok(await evaluate(`articleFuzzyOn()`) === false, '点一下模糊开关：开 → 关');
  ok(await evaluate(`(()=>document.getElementById('articleFuzzySwitch').classList.contains('on'))()`) === false, '开关外观同步为关');
  await evaluate(`(()=>{ togglePrecacheAuto(); return true; })()`);
  await sleep(300);
  ok(await evaluate(`precacheAutoEnabled()`) === true, '点一下自动缓存开关：关 → 开');
  ok(await evaluate(`(()=>document.getElementById('precacheAutoSwitch').classList.contains('on'))()`) === true, '开关外观同步为开');

  // 复原成首访默认，别把偏好留给同一 profile 的后续断言（本用例自包含，主要是整洁）
  await evaluate(`(()=>{ setArticleFuzzy(true); setPrecacheAuto(false); return true; })()`);
  await sleep(200);
  await hardReload();
  ok(await evaluate(`articleFuzzyOn()`) === true && await evaluate(`precacheAutoEnabled()`) === false,
    '复原后回到"模糊开 / 预缓存关"');
} catch (e) {
  fail++;
  console.log(`  ✗ 用例异常：${e.message}`);
}

console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
try { ws.close(); } catch (e) { }
child.kill(); server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => { });
process.exit(fail ? 1 : 0);
