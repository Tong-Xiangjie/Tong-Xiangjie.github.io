// A2 验证：sw.js 真的做缓存吗（图片 cache-first + 资源 network-first + 版本清理 + 离线可看）
// 关键手法：本地服务器记录每个路径被请求的次数 —— "第二次取同一张图不再打到服务器"
// 就是"确实走了缓存"的硬证据。
import { createServer } from 'node:http';
import { readdirSync, statSync } from 'node:fs';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
let pass = 0, fail = 0; const fails = [];
const ok = (c, m, extra = '') => { if (c) { pass++; console.log(`    ✓ ${m}${extra ? '  ' + extra : ''}`); } else { fail++; fails.push(m); console.log(`    ✗ ${m}${extra ? '  ' + extra : ''}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 本地服务器：正常缓存头 + 请求计数 + 可切换 sw.js 变体（模拟重新部署） ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const hits = new Map();
const bump = p => hits.set(p, (hits.get(p) || 0) + 1);
let swVariant = false;
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    bump(p);
    let full = join(ROOT, p);
    if (p.endsWith('/')) full = join(ROOT, p, 'index.html');
    if (!existsSync(full) || (await stat(full)).isDirectory()) { res.writeHead(404).end('nf'); return; }
    let buf = await readFile(full);
    if (p.endsWith('/sw.js') && swVariant) buf = Buffer.concat([buf, Buffer.from('\n// redeploy-marker\n')]);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=600' });
    res.end(buf);
  } catch (e) { console.log('    [服务器错误] ' + p + ' :: ' + e.message); res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpSw-'));
const DP = 12200 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const pg = l.find(t => t.type === 'page'); if (pg?.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const pageErrors = []; const consoleMsgs = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.text || 'exception');
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = (m.params?.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
    if (t) consoleMsgs.push(`[${m.params.type}] ${t}`);
  }
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('precache-auto','0'); } catch(e) {}` });

// 找一张真实存在、且路径里带 /image/ 的图片当测试对象
function findImage(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { const r = findImage(p); if (r) return r; }
    else if (/\.(jpe?g)$/i.test(n)) return p;
  }
  return null;
}
const IMG_PATH = findImage('notecollection/image');
if (!IMG_PATH) { console.log('  ✗ 找不到测试图片'); process.exit(1); }
const IMG = '/' + IMG_PATH.replace(/\\/g, '/');
const IMG_FILE = IMG.split('/').pop();
console.log(`  测试图片：${IMG_FILE}（${IMG}）\n`);

const waitReady = async () => { for (let i = 0; i < 60; i++) { const c = await evaluate(`!!(navigator.serviceWorker && navigator.serviceWorker.controller)`).catch(() => false); if (c) return true; await sleep(250); } return false; };
const load = async () => {
  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 200; i++) { if (await evaluate(`typeof onTabClick === 'function' && document.readyState === 'complete'`).catch(() => false)) return true; await sleep(120); }
  return false;
};
const requireLoad = async (where) => {
  const good = await load();
  if (!good) {
    console.log(`  ✗ 页面没能加载（${where}）：测试环境自身有问题，后面的结论不可信`);
    console.log('    页面上的错误：' + JSON.stringify(pageErrors.slice(-3)));
    console.log('    控制台：' + JSON.stringify(consoleMsgs.slice(-6)));
    try { ws.close(); } catch {}
    child.kill(); server.close();
    process.exit(2);
  }
};

console.log('══════ ① SW 注册与接管 ══════\n');
await requireLoad('①');
await sleep(1500);
let controlled = await waitReady();
if (!controlled) { await load(); await sleep(1200); controlled = await waitReady(); }
ok(controlled, 'navigator.serviceWorker.controller 存在（SW 已接管页面）');
const cacheKeys = await evaluate(`caches.keys()`);
// ★ 此刻只断言"资源缓存已建立"：本地测试里数据文件用的是绝对线上地址，
//   页面自己的图片是跨域的、不经过本 SW，图片缓存要等 ② 显式请求一张同源图片才建立。
ok(cacheKeys.some(k => k.startsWith('collection-assets')), 'SW 已把页面资源写进缓存（前缀 collection-assets）', JSON.stringify(cacheKeys));
ok(cacheKeys.every(k => !k.startsWith('stardust')), '没有去碰同源其它应用的缓存');

console.log('\n══════ ② 图片：cache-first（第二次不再打到服务器）══════\n');
await evaluate(`document.querySelectorAll('img').forEach(i => { if (i.loading === 'lazy') i.loading = 'eager'; })`);
const before = hits.get(IMG) || 0;
const r1 = await evaluate(`fetch(${JSON.stringify(IMG)}).then(r => r.status).catch(e => 'ERR:' + e.message)`);
const afterFirst = hits.get(IMG) || 0;
ok(r1 === 200, `能取到图片（HTTP ${r1}）`);
ok(afterFirst > before, `第一次请求走了服务器（计数 ${before} → ${afterFirst}）`);
await sleep(400);
const r2 = await evaluate(`fetch(${JSON.stringify(IMG)}).then(r => r.status).catch(e => 'ERR:' + e.message)`);
const afterSecond = hits.get(IMG) || 0;
ok(r2 === 200, `第二次也能取到图片（HTTP ${r2}）`);
ok(afterSecond === afterFirst, `★ 第二次取同一张图没有再打到服务器（计数停在 ${afterSecond}）—— 走的缓存`, `服务器计数 ${afterFirst} → ${afterSecond}`);
const inImageCache = await evaluate(`(async () => { const k = (await caches.keys()).find(x => x.startsWith('collection-images')); if (!k) return 0; const c = await caches.open(k); return (await c.match(${JSON.stringify(IMG)}, { ignoreSearch: true })) ? 1 : 0; })()`);
ok(inImageCache === 1, '★ 这张图确实被写进了 collection-images 缓存');

console.log('\n══════ ③ 资源：network-first（在线时优先网络，绝不吃旧代码）══════\n');
// ★ 关掉浏览器 HTTP 缓存，否则"没再请求服务器"可能只是 HTTP 缓存命中，看不出 SW 的真实行为
await send('Network.setCacheDisabled', { cacheDisabled: true });
const cssHitsBefore = hits.get('/collection/layout.css') || 0;
await requireLoad('③');
const cssHitsAfter = hits.get('/collection/layout.css') || 0;
ok(cssHitsAfter > cssHitsBefore, `重新打开页面时 CSS 仍然优先走网络（计数 ${cssHitsBefore} → ${cssHitsAfter}）—— 上线就能拿到新代码`);
const jsHitsBefore = hits.get('/collection/special.js') || 0;
await evaluate(`fetch('/collection/special.js').then(r => r.status).catch(() => 0)`);
await sleep(300);
ok((hits.get('/collection/special.js') || 0) > jsHitsBefore, '在线时请求 JS 也优先走网络（不会吃到旧缓存）');

console.log('\n══════ ④ 离线：已缓存的图还能看，整页还能打开 ══════\n');
await send('Network.clearBrowserCache');   // 清 HTTP 缓存，逼出"只能靠 SW"的真实情况
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const offImg = await evaluate(`fetch(${JSON.stringify(IMG)}).then(r => r.status).catch(e => 'ERR:' + (e.message || e))`);
ok(offImg === 200, `★ 断网后仍能取到已缓存的图片（HTTP ${offImg}）`);
const offCss = await evaluate(`fetch('/collection/layout.css').then(r => r.status).catch(e => 'ERR:' + (e.message || e))`);
ok(offCss === 200, `断网后仍能取到已缓存的 CSS（HTTP ${offCss}）`);
await send('Page.navigate', { url: PAGE });
let offLoaded = false;
for (let i = 0; i < 140; i++) { if (await evaluate(`typeof onTabClick === 'function'`).catch(() => false)) { offLoaded = true; break; } await sleep(150); }
ok(offLoaded, '★ 断网后整页仍能打开（HTML/JS 走缓存）');
const offImgs = await evaluate(`document.querySelectorAll('img').length`).catch(() => 0);
ok(offImgs > 0, `断网页面里仍有 ${offImgs} 个图片元素`);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await sleep(300);
await requireLoad('恢复联网后');   // 断网那段之后页面可能是浏览器错误页，先回到正常页面再继续

console.log('\n══════ ⑤ 与 precache.js / settings.js 的约定一致 ══════\n');
const precacheHit = await evaluate(`(async () => { try { const c = await getPrecacheCache(); return c ? 1 : 0; } catch (e) { return 'ERR:' + e.message; } })()`);
ok(precacheHit === 1, '★ precache.js 能按前缀找到这个缓存（离线预缓存不再是白下载）', String(precacheHit));

console.log('\n══════ ⑥ 版本升级：清旧缓存，但不动别的项目 ══════\n');
await evaluate(`(async () => {
  await caches.open('collection-images-v0'); await caches.open('collection-assets-v0');
  await caches.open('stardust-migration-images');
  return (await caches.keys()).length;
})()`);
swVariant = true;   // 服务器开始发一份"变了一点点"的 sw.js，等价于一次重新部署
const updated = await evaluate(`(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  if (!r) return 'no-reg';
  await r.update();
  for (let i = 0; i < 40; i++) {
    if (r.active && r.active.scriptURL && (await caches.keys()).indexOf('collection-images-v0') === -1) return 'ok';
    await new Promise(s => setTimeout(s, 250));
  }
  return 'timeout';
})()`);
await sleep(600);
const keysAfter = await evaluate(`caches.keys()`);
ok(!keysAfter.includes('collection-images-v0'), '★ 升级后旧的 collection-images-v0 被清掉', JSON.stringify(keysAfter));
ok(!keysAfter.includes('collection-assets-v0'), '★ 升级后旧的 collection-assets-v0 被清掉');
ok(keysAfter.includes('stardust-migration-images'), '★ 别的项目的缓存（stardust-migration-images）没有被误删');
ok(keysAfter.some(k => k.startsWith('collection-images-v')), '当前版本的图片缓存仍在（升级不会清掉用户已缓存的图）');
const keptImg = await evaluate(`(async () => { const k = (await caches.keys()).find(x => x.startsWith('collection-images-v')); const c = await caches.open(k); return (await c.match(${JSON.stringify(IMG)}, { ignoreSearch: true })) ? 1 : 0; })()`);
ok(keptImg === 1, '升级前缓存的图片在升级后依然命中（不会白缓存一遍）', `update=${updated}`);

console.log('\n══════ ⑦ 静态检查：SW 既有正确逻辑没被改错 ══════\n');
console.log('     （注意：真正在用的是 collection/sw.js，根目录那份 5 行 sw.js 是「网站总入口」为 PWA 可安装性注册的）');
const swSrc = await readFile('collection/sw.js', 'utf8');
ok(/CACHE_NAME\s*=\s*'collection-images-v3'/.test(swSrc), '★ 图片缓存名仍是 collection-images-v3（改它会让约 780MB 图片全部重下）');
ok(/startsWith\(CACHE_PREFIX\)/.test(swSrc), 'activate 仍是前缀限定的清理（不会误删同源其它应用的缓存）');
ok(!/filter\(\s*k\s*=>\s*k\s*!==\s*CACHE_NAME\s*\)/.test(swSrc), '★ 没有退回"删掉所有其它缓存"的写法（B12 不能复发）');
ok(/ASSET_CACHE/.test(swSrc) && /networkFirstAsset/.test(swSrc), '★ 新增了页面资源的 network-first 缓存');
ok(/SKIP_WAITING/.test(swSrc), '仍支持 SKIP_WAITING 消息（settings 的「清除图片缓存」要用）');
ok(/IMAGE_PATH_RE/.test(swSrc), '仍限定只缓存藏品图片目录');
ok(/stale-while-revalidate/.test(swSrc), '图片策略注释仍在（stale-while-revalidate 未改）');

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
if (fails.length) { console.log('  失败项：'); fails.forEach(f => console.log('    · ' + f)); }
const errs = pageErrors.length;
console.log(`  ${errs === 0 ? '✓' : '✗'} 未捕获异常（${errs} 条）${errs ? '：' + JSON.stringify(pageErrors.slice(0, 3)) : ''}`);
const swWarns = consoleMsgs.filter(m => m.includes('[sw]'));
if (swWarns.length) console.log('  SW 注册相关的控制台消息：' + JSON.stringify(swWarns.slice(0, 3)));
if (fail > 0 && consoleMsgs.length) console.log('  控制台最后几条：' + JSON.stringify(consoleMsgs.slice(-5)));
try { ws.close(); } catch {}
child.kill(); server.close();
process.exit(fail === 0 ? 0 : 1);
