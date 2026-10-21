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
let pass = 0, fail = 0, skipped = 0; const fails = [];
const ok = (c, m, extra = '') => { if (c) { pass++; console.log(`    ✓ ${m}${extra ? '  ' + extra : ''}`); } else { fail++; fails.push(m); console.log(`    ✗ ${m}${extra ? '  ' + extra : ''}`); } };
// ★ "数据里当前没有这个场景"（例如 notecollection/image 下没有任何 jpg）⇒ skip：
//   单独计数、既不计通过也不计失败，但必须把原因打出来。退出码只看 fail。
const skip = (m) => { skipped++; console.log(`    ○ 跳过 ${m}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 本地服务器：正常缓存头 + 请求计数 + 可切换 sw.js 变体（模拟重新部署） ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const hits = new Map();
const bump = p => hits.set(p, (hits.get(p) || 0) + 1);
let swVariant = false;
// ---------- A2 补充断言用的"可变量"（都在 ⑧ 节里用） ----------
// 都是**磁盘上不存在的合成 URL**，只经过 SW，不去碰真实的 layout.css / 真实图片：
//   ① .css 合成资源：用来模拟"服务端换了内容"（一次重新部署）；
//   ② /notecollection/image/ 下的合成图片：路径落在 IMAGE_PATH_RE 里（才走图片策略），
//      而页面从来不会请求它 —— 所以不会和页面自己的图片加载抢时序。
const PROBE = '/collection/tools/tests/__sw-probe.css';
let probeBody = 'A';
const PROBE_IMG = '/notecollection/image/__sw-probe.jpg';
let probeImgBody = 'AAAAAAAA';
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    bump(p);
    if (p === PROBE) {
      const b = Buffer.from(`/* probe-${probeBody} */\n`, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'public, max-age=600' });
      res.end(b);
      return;
    }
    if (p === PROBE_IMG) {
      const b = Buffer.from(`\xff\xd8\xff\xe0/*${probeImgBody}*/`, 'binary');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': b.length, 'Cache-Control': 'public, max-age=600' });
      res.end(b);
      return;
    }
    let full = join(ROOT, p);
    if (p.endsWith('/')) full = join(ROOT, p, 'index.html');
    if (!existsSync(full) || (await stat(full)).isDirectory()) { res.writeHead(404).end('nf'); return; }
    let buf = await readFile(full);
    if (p.endsWith('/sw.js') && swVariant) buf = Buffer.concat([buf, Buffer.from('\n// redeploy-marker\n')]);
    // ★ SW 脚本必须**不可长缓存**。原先一律发 `public, max-age=600`，而 sw.js 也吃到了这个头 ——
    //   按规范 SW 脚本理应按 max-age 缓存（浏览器自 2018 起不再对 SW 脚本施加上限），
    //   于是 `registration.update()` 有可能直接命中 HTTP 缓存、拿到的还是旧字节，
    //   新版本永远不装、activate 里的清缓存也就不跑。CI 上 windows 那两条
    //   "旧缓存没被清掉"正是这么来的（10s 轮询等不到，因为压根没发生升级）。
    //   真实部署也是这么发的（SW 必须 no-cache，否则更新传不出去），所以这里跟着改。
    const isSW = p.endsWith('/sw.js');
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': isSW ? 'no-cache' : 'public, max-age=600'
    });
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
// ★ 以前这里是 `process.exit(1)`：notecollection/image 下一个 jpg 都没有（纯净检出、
//   数据/图片目录没同步过来的 CI）就整例硬红 —— 而"没有图片可测"是**环境缺工件**，
//   不是产品缺陷。run.mjs 把 exit 3 当"跳过"（不算失败），这里跟着用 exit 3，
//   并把原因打印在明面上。图片齐全时下面的断言一条都不会少。
if (!IMG_PATH) {
  skip('notecollection/image 下找不到任何 .jpg，② 图片缓存 / ④ 离线图片这两节没有测试对象');
  console.log('  ⏭ 跳过：notecollection/image 下没有 jpg（缺本地工件，按 run.mjs 约定 exit 3 不算失败）');
  console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  process.exit(3);
}
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
// ★ 写缓存是"响应返回之后"才落盘的（stale-while-revalidate），所以这里**轮询等待**它出现，
//   不再是一锤子查一次。CI windows 上偶发的这条红就是这个窗口：
//   第二次请求已经吃了缓存（上面那条绿），但 cache.put 还没落盘 ⇒ 这里查到 0。
//   超时也不加长固定 sleep，而是把诊断一次性打全（keys / controller / SW 状态 / 该资源的
//   performance 条目），让下一次 CI 红了能直接定位。
const waitImageCached = async (ms = 6000) => {
  const t0 = Date.now();
  for (;;) {
    const n = await evaluate(`(async () => { const k = (await caches.keys()).find(x => x.startsWith('collection-images')); if (!k) return 0; const c = await caches.open(k); return (await c.match(${JSON.stringify(IMG)}, { ignoreSearch: true })) ? 1 : 0; })()`);
    if (n === 1) return { ok: true, ms: Date.now() - t0 };
    if (Date.now() - t0 > ms) return { ok: false, ms: Date.now() - t0, diag: await evaluate(`(async () => {
      const keys = await caches.keys();
      const reg = await navigator.serviceWorker.getRegistration();
      const ents = performance.getEntriesByName(${JSON.stringify(new URL(IMG, 'http://x').pathname)}, 'resource')
        .concat(performance.getEntriesByType('resource').filter(e => e.name.indexOf(${JSON.stringify(IMG_FILE)}) >= 0));
      return JSON.stringify({
        keys: keys,
        controller: navigator.serviceWorker.controller ? '有' : '无',
        active: reg && reg.active ? reg.active.state : 'none',
        waiting: reg && reg.waiting ? reg.waiting.state : 'none',
        installing: reg && reg.installing ? reg.installing.state : 'none',
        swEntries: ents.slice(0, 3).map(e => ({ name: e.name.split('/').pop(), transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize, duration: Math.round(e.duration) }))
      }); })()`) };
    await sleep(120);
  }
};
const imgCached = await waitImageCached();
ok(imgCached.ok, '★ 这张图确实被写进了 collection-images 缓存',
  imgCached.ok ? `（等 ${imgCached.ms}ms 后出现）` : `（等 ${imgCached.ms}ms 仍未出现；诊断 ${imgCached.diag}）`);

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
  // ★ 等两个条件同时成立：新 SW 真的**接管**（activated / controller 换成它），且旧缓存被清掉。
  //   只轮询"缓存没了"看不出到底是"没升级"还是"升级了但没清"，
  //   诊断里把 SW 状态与 scriptURL 一起带出来，下次 CI 红了能一眼区分。
  const t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    const keys = await caches.keys();
    const ctrl = navigator.serviceWorker.controller;
    if (r.active && r.active.state === 'activated' && ctrl && keys.indexOf('collection-images-v0') === -1) {
      return 'ok:' + (Date.now() - t0) + 'ms';
    }
    await new Promise(s => setTimeout(s, 250));
  }
  const keys = await caches.keys();
  return 'timeout:' + (Date.now() - t0) + 'ms'
    + ' active=' + (r.active ? (r.active.state + '@' + String(r.active.scriptURL).split('/').slice(-2).join('/')) : 'none')
    + ' installing=' + (r.installing ? r.installing.state : 'none')
    + ' waiting=' + (r.waiting ? r.waiting.state : 'none')
    + ' controller=' + (navigator.serviceWorker.controller ? '有' : '无')
    + ' keys=' + JSON.stringify(keys);
})()`);
console.log('  升级结果：' + updated);
// 再给 activate 的清理一点时间（轮询已经等到 keys 里没有 v0 了，这里只是兜底）
for (let i = 0; i < 20; i++) {
  const k = await evaluate(`caches.keys()`);
  if (!k.includes('collection-images-v0') && !k.includes('collection-assets-v0')) break;
  await sleep(250);
}
const keysAfter = await evaluate(`caches.keys()`);
ok(!keysAfter.includes('collection-images-v0'), '★ 升级后旧的 collection-images-v0 被清掉', JSON.stringify(keysAfter) + ' / update=' + updated);
ok(!keysAfter.includes('collection-assets-v0'), '★ 升级后旧的 collection-assets-v0 被清掉', 'update=' + updated);
ok(keysAfter.includes('stardust-migration-images'), '★ 别的项目的缓存（stardust-migration-images）没有被误删');
ok(keysAfter.some(k => k.startsWith('collection-images-v')), '当前版本的图片缓存仍在（升级不会清掉用户已缓存的图）');
const keptImg = await evaluate(`(async () => { const k = (await caches.keys()).find(x => x.startsWith('collection-images-v')); const c = await caches.open(k); return (await c.match(${JSON.stringify(IMG)}, { ignoreSearch: true })) ? 1 : 0; })()`);
ok(keptImg === 1, '升级前缓存的图片在升级后依然命中（不会白缓存一遍）', `update=${updated}`);

console.log('\n══════ ⑦ 静态检查：SW 既有正确逻辑没被改错 ══════\n');
console.log('     （注意：真正在用的是 collection/sw.js，根目录那份 5 行 sw.js 是「网站总入口」为 PWA 可安装性注册的）');
const swSrc = await readFile('collection/sw.js', 'utf8');
// ★ 版本号不再钉死成 v3：站主**主动升版本号**（v3 → v4，正是"改它会让图片全部重下"
//   时的正确操作）不该把用例判红。这里保留的是"必须带版本号"这条判据本身：
//   格式必须是 collection-images-v<数字>，且页面运行时的缓存名与源码里的这个名字一致。
const SW_CACHE_NAME = (swSrc.match(/CACHE_NAME\s*=\s*'([^']+)'/) || [])[1] || '';
const SW_VERSION = (SW_CACHE_NAME.match(/^collection-images-v(\d+)$/) || [])[1];
ok(!!SW_VERSION, `★ 图片缓存名带版本号（collection-images-vN，当前 ${SW_CACHE_NAME || '（没匹配到）'}）`);
const runtimeImgKeys = await evaluate(`caches.keys()`).catch(() => []);
if (runtimeImgKeys.some(k => k.startsWith('collection-images-v'))) {
  ok(runtimeImgKeys.includes(SW_CACHE_NAME),
    `运行时真正建立的图片缓存名与源码里的一致（源码 ${SW_CACHE_NAME}；运行时 ${JSON.stringify(runtimeImgKeys.filter(k => k.startsWith('collection-images'))) }）`);
} else {
  skip('运行时还没建起 collection-images-vN 缓存，名字一致性无从比对');
}
ok(/startsWith\(CACHE_PREFIX\)/.test(swSrc), 'activate 仍是前缀限定的清理（不会误删同源其它应用的缓存）');
ok(!/filter\(\s*k\s*=>\s*k\s*!==\s*CACHE_NAME\s*\)/.test(swSrc), '★ 没有退回"删掉所有其它缓存"的写法（B12 不能复发）');
ok(/ASSET_CACHE/.test(swSrc) && /networkFirstAsset/.test(swSrc), '★ 新增了页面资源的 network-first 缓存');
ok(/SKIP_WAITING/.test(swSrc), '仍支持 SKIP_WAITING 消息（settings 的「清除图片缓存」要用）');
ok(/IMAGE_PATH_RE/.test(swSrc), '仍限定只缓存藏品图片目录');
ok(/stale-while-revalidate/.test(swSrc), '图片策略注释仍在（stale-while-revalidate 未改）');

console.log('\n══════ ⑧ A2 补充：之前没有任何断言覆盖的几件事 ══════\n');
console.log('     （①字体也 network-first ②在线改了内容立刻可见，不只是"打到服务器" ③断网回退到最新一份');
console.log('       ④图片真是 SWR：不会永久钉在旧版本 ⑤根 sw.js 不缓存 ⑥两个缓存不串台）\n');

// ⑧ 自己把 HTTP 缓存清掉再关掉：下面断言的是 **SW 的行为**，不能被浏览器 HTTP 缓存顶包，
//    否则"立刻拿到新内容"这类断言会因为 HTTP 缓存命中而假红。
await send('Network.clearBrowserCache');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await requireLoad('⑧');

// ⑧-1 字体：ASSET_RE 里写了 woff2?，但在此次补充之前没有任何断言碰过字体。
const FONT = '/font/OCRB10PitchBT-Regular.woff';
if (existsSync(join(ROOT, FONT))) {
  const fb = hits.get(FONT) || 0;
  const fr = await evaluate(`fetch(${JSON.stringify(FONT)}).then(r => r.status).catch(e => 'ERR:' + e.message)`);
  await sleep(250);
  const fa = hits.get(FONT) || 0;
  ok(fr === 200, `字体能取到（HTTP ${fr}）`);
  ok(fa > fb, `★ 在线时 woff 字体也优先走网络（计数 ${fb} → ${fa}）—— 字体没有落在"缓存优先"那一支里`);
} else {
  ok(false, `字体测试对象不存在（${FONT}），⑧-1 无法判定`);
}

// ⑧-2 "在线永远拿最新"的实质：服务端内容一变，下一次请求拿到的是**新内容**。
// ③ 只断言了"又打到服务器"，没断言拿到的确实是新的 —— 两者不是一回事。
probeBody = 'A';
const pr1 = await evaluate(`fetch(${JSON.stringify(PROBE)}).then(r => r.text()).catch(e => 'ERR:' + e.message)`);
ok(typeof pr1 === 'string' && pr1.includes('probe-A'), `在线首次取到的是网络上的当前版本（${String(pr1).slice(0, 32)}）`);
probeBody = 'B';
const pr2 = await evaluate(`fetch(${JSON.stringify(PROBE)}).then(r => r.text()).catch(e => 'ERR:' + e.message)`);
ok(typeof pr2 === 'string' && pr2.includes('probe-B'), '★ 服务端内容一变，下一次请求立刻拿到新版本（在线绝不吃旧缓存）');

// ⑧-3 断网时回退到"最后一次在线看到的那一份"，而不是部署前的旧版
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const pr3 = await evaluate(`fetch(${JSON.stringify(PROBE)}).then(r => r.text()).catch(e => 'ERR:' + (e.message || e))`);
ok(typeof pr3 === 'string' && pr3.includes('probe-B'),
  '★ 断网后取到的是缓存里最新的一份（probe-B，不是部署前的 probe-A）—— network-first 真的把缓存刷新过', String(pr3).slice(0, 40));
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await sleep(250);

// ⑧-4 图片：证明它是**真的 stale-while-revalidate**，而不是"缓存了就永远不更新"。
// ② 只断言了"第二次没打到服务器"，那既能是 cache-first（永不更新）也能是 SWR；
// "缓存最终变成新内容"这一条才能证明图片不会被永久钉在旧版本上。
const probeImgLen = () => evaluate(`(async () => {
  const k = (await caches.keys()).find(x => x.startsWith('collection-images'));
  if (!k) return -1;
  const c = await caches.open(k);
  const r = await c.match(${JSON.stringify(PROBE_IMG)});
  return r ? (await r.arrayBuffer()).byteLength : -1;
})()`);
const pib = hits.get(PROBE_IMG) || 0;
const firstStatus = await evaluate(`fetch(${JSON.stringify(PROBE_IMG)}).then(r => r.status).catch(e => 'ERR:' + e.message)`);
ok(firstStatus === 200, `合成藏品图能取到（HTTP ${firstStatus}）`);
ok((hits.get(PROBE_IMG) || 0) > pib, `第一次请求走了服务器（计数 ${pib} → ${hits.get(PROBE_IMG) || 0}）—— 新图片会被写进缓存`);
let lenBefore = -1;
for (let i = 0; i < 60; i++) { lenBefore = await probeImgLen(); if (lenBefore > 0) break; await sleep(120); }
ok(lenBefore > 0, `这张图已被写进 collection-images 缓存（${lenBefore} 字节）`);
if (lenBefore > 0) {
  probeImgBody = 'BBBBBBBBBBBB';                 // 服务端换成"新一版"（比上一版长 4 字节）
  const imgHitsBefore = hits.get(PROBE_IMG) || 0;
  const servedLen = await evaluate(`fetch(${JSON.stringify(PROBE_IMG)}).then(r => r.arrayBuffer()).then(b => b.byteLength).catch(() => -1)`);
  ok(servedLen === lenBefore,
    `★ 第二次请求**立刻**返回缓存里的那一份（${servedLen} 字节）—— 这就是"缓存优先，不阻塞"`, `期望 ${lenBefore}`);
  let revalidated = false;
  for (let i = 0; i < 50; i++) { if ((hits.get(PROBE_IMG) || 0) > imgHitsBefore) { revalidated = true; break; } await sleep(100); }
  ok(revalidated, `★ stale-while-revalidate：返回缓存的同时，后台确实发起了再验证请求（服务器计数 ${imgHitsBefore} → ${hits.get(PROBE_IMG) || 0}）`);
  let newLen = -1;
  for (let i = 0; i < 60; i++) { newLen = await probeImgLen(); if (newLen > 0 && newLen !== lenBefore) break; await sleep(120); }
  ok(newLen > 0 && newLen !== lenBefore,
    `★ 后台把新版本写回了缓存（${lenBefore} → ${newLen} 字节）—— 图片不会被永久钉在旧版本上`);
}
// 断网后应当能取到"刚才后台更新后的那一份"
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const offProbe = await evaluate(`fetch(${JSON.stringify(PROBE_IMG)}).then(r => r.arrayBuffer()).then(b => b.byteLength).catch(() => -1)`);
ok(offProbe > lenBefore, `断网后仍能取到这张图，且是后台更新过的新版本（${offProbe} 字节 > 升级前 ${lenBefore}）`);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

// ⑧-5 根目录 sw.js 的 scope 是 /（整站）。它现在是纯网络直通 —— 这条断言守住方向：
// 它一旦开始缓存，整站用户就可能拿到旧页面，而它并不在 ⑦ 的静态检查范围内。
const rootSw = await readFile('sw.js', 'utf8');
ok(!/caches\s*\.|cache\.put\s*\(|CACHE_NAME|cache\.add\s*\(/.test(rootSw),
  '★ 根 sw.js（scope = /）不做任何缓存，是纯网络直通 —— 不可能让整站用户拿到旧文件');
ok(/respondWith\(\s*fetch\(/.test(rootSw), '根 sw.js 只把请求原样交给网络（在线永远最新）');

// ⑧-6 两个缓存不串台：藏品图不该进资源缓存，资源缓存的东西也不该进图片缓存
ok(await evaluate(`(async () => {
  const ak = (await caches.keys()).find(k => k.startsWith('collection-assets'));
  if (!ak) return 'no-assets-cache';
  const c = await caches.open(ak);
  return (await c.match(${JSON.stringify(PROBE_IMG)}, { ignoreSearch: true })) ? 'present' : 'absent';
})()`) === 'absent', '★ 藏品图没有被写进资源缓存（两个缓存不串台）');
const IMG_PATH_SRC = /^\/(?:(?:notecollection|coincollection)\/(?:readmes\/)?image\/|funcollection\/[^/]+\/images\/)/;
const strayImages = await evaluate(`(async () => {
  const ik = (await caches.keys()).find(k => k.startsWith('collection-images'));
  if (!ik) return 'no-images-cache';
  const c = await caches.open(ik);
  const ks = await c.keys();
  return JSON.stringify(ks.map(r => new URL(r.url).pathname).filter(p => !${IMG_PATH_SRC}.test(p)));
})()`);
ok(strayImages === '[]', '★ 图片缓存里只有藏品图目录下的路径（没有把页面/脚本混进去）', String(strayImages));

// ⑧-7 静态：资源缓存同样"带版本号 + 前缀限定清理"（⑦ 只断言了图片那一份 CACHE_NAME）
ok(/const\s+ASSET_CACHE\s*=\s*'collection-assets-v\d+'/.test(swSrc), '★ 资源缓存名带版本号（collection-assets-vN）');
ok(/const\s+ASSET_PREFIX\s*=\s*'collection-assets-'/.test(swSrc),
  '资源缓存的清理有独立前缀常量（不会误删图片缓存，也不会误删别的应用）');
ok(/const\s+ASSET_RE[\s\S]{0,320}woff2\?/.test(swSrc), '资源策略的覆盖范围里包含字体（woff/woff2）');

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
if (fails.length) { console.log('  失败项：'); fails.forEach(f => console.log('    · ' + f)); }
const errs = pageErrors.length;
console.log(`  ${errs === 0 ? '✓' : '✗'} 未捕获异常（${errs} 条）${errs ? '：' + JSON.stringify(pageErrors.slice(0, 3)) : ''}`);
const swWarns = consoleMsgs.filter(m => m.includes('[sw]'));
if (swWarns.length) console.log('  SW 注册相关的控制台消息：' + JSON.stringify(swWarns.slice(0, 3)));
if (fail > 0 && consoleMsgs.length) console.log('  控制台最后几条：' + JSON.stringify(consoleMsgs.slice(-5)));
try { ws.close(); } catch {}
child.kill(); server.close();
process.exit(fail === 0 ? 0 : 1);
