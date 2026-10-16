// 验收：OCR-B（冠号字体）冷启动零位移 + 数据模块加载并发。
//
// 背景（用户报的两件事）：
//   ①「ocrb 字体可以在初始化的时候就加载好吗？要不然总是会跳一下。」
//      逐帧实测（HTTP/2 + 60ms RTT，冷启动 #notes/rmb/rmb3/s0,2,3/v0.0,2.0,3.0）：
//        · 字体请求 t≈1565ms 才开始 —— 因为以前**没有任何 preload**，浏览器要等
//          第一张藏品卡被排版、真的需要这个字形时才发现它（加载屏 t≈1201ms 就消失了）；
//        · .version-text 第 74 帧（t≈1572ms）先按回退字体出现，宽度 99.15 / 92.74px；
//          第 80 帧（t≈1656ms）换成 OCR-B，宽度 103.89 / 98.16px —— 每个冠号 +4.7~5.4px。
//          这就是看到的"跳一下"。
//      修法：index.html 里 preload + main.js 提前 document.fonts.load() + layout.css 的
//      font-display 从 swap 改 block（最后一条只是兜底，见 layout.css 注释）。
//   ②「现在初始化的时候好像记得是什么'一次加载6个'，还能不能更多（更快）？」
//      "一次 6 个" = collection/data-loader.js 里加载屏背后那批 <script> 的并发上限。
//      实测（HTTP/2 + 80ms RTT，3 次取中位数，导航开始 → 全部数据文件下载完）：
//        并发 6 → 1491ms，12 → 960ms，16 → 847ms，24 → 656ms，48 → 580ms，70 → 458ms；
//      换成 HTTP/1.1 再测：6/12/24/48 全是 ~1990ms（Chrome 每源只开 6 条 TCP 连接）。
//      GitHub Pages 走 h2，所以取 24（理由与代价见 data-loader.js 的常量注释）。
//
// 这个用例验什么：
//   A. 静态：preload 与 @font-face 必须指向**同一个文件**；font-display 必须是 block；
//   B. 静态：main.js 必须主动 load 一次（preload 只解决字节，不解决首次异步重排）；
//   C. 静态 + 动态：并发常量 == 24，worker 池取号 / 失败兜底 / 取消语义原样保留，
//      且**实测峰值并行数**恰好等于这个常量；
//   D. 动态：冷启动全程 .version-text 矩形零位移 + 首个可见帧时字体已是 loaded；
//   E. 反向验证：把三处改动退回旧实现，**必须能测出位移** —— 证明 D 不是空断言；
//   F. 首屏可读内容没被推迟：新旧实现在同一台机器上跑同一页，FCP / 首屏可见时刻
//      不许因为字体处理而变差（差分自校准，不写死绝对毫秒）。
//   G. 站点入口页（仓库根 index.html）：同样零位移 + 反向验证。
//   H. 另外三页 academic/ · time/ · time_awful/（family 名是 "OCRB10"，与上面那个不同名、
//      同一个 woff）：preload 与 @font-face 必须解析到同一个真实文件、display 取值按页
//      （time 用 block：整屏就是 OCR-B 数字；academic/time_awful 用 swap：中文内容页，
//      block 会把连中文在内的整段文字一起藏起来）、提前 load() 必须在那张样式表之后。
//   I. 动态：这三页"改前先按回退字体排过一遍（首帧宽 ≠ 末帧宽）、改后逐帧零位移"。
//
// 注：无头 Chrome 里会关掉 Service Worker 注册 —— 否则 SW 会喂**旧版** CSS/JS，
//     测到的可能是缓存里的老资源（这正是"本地全绿、线上仍旧"的经典坑）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, relative } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };

// ── 期望值（改动这两处时必须同时改这里，是有意的"双人复核"）──
const EXPECTED_CONCURRENCY = 24;
const OCRB_FAMILY = 'OCRB10PitchBT-Regular';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const NOTE = m => console.log(`    · ${m}`);

// ══════════════════ 静态检查 ══════════════════
const html = await readFile(join(ROOT, 'collection', 'index.html'), 'utf8');
const css = await readFile(join(ROOT, 'collection', 'layout.css'), 'utf8');
const mainJs = await readFile(join(ROOT, 'collection', 'main.js'), 'utf8');
const loaderJs = await readFile(join(ROOT, 'collection', 'data-loader.js'), 'utf8');

console.log('══════ A. OCR-B：preload 与 @font-face 必须是同一个文件 ══════');
const preloadRe = /<link rel="preload" as="font" type="font\/woff" href="([^"]+)"([^>]*)>/g;
const preloads = [...html.matchAll(preloadRe)];
ok(preloads.length === 1, `index.html 里恰好 1 条字体 preload（实际 ${preloads.length}）`);
const href = preloads.length ? preloads[0][1] : '';
ok(/crossorigin/.test(preloads.length ? preloads[0][2] : ''),
   `字体 preload 带 crossorigin（少了它 preload 命不中 CORS 模式的字体请求，等于白下）`);

// @font-face 里的 src 与 preload 的 href 各自相对**自己的文件**解析 —— 必须落到同一个仓库路径
const faceMatch = new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*'${OCRB_FAMILY}'[^}]*\\}`).exec(css);
ok(!!faceMatch, `layout.css 里有 ${OCRB_FAMILY} 的 @font-face`);
const faceSrc = faceMatch ? (/src:\s*url\('([^']+)'\)/.exec(faceMatch[0]) || [])[1] : '';
const fromHtml = href ? join(ROOT, 'collection', href) : '';
const fromCss = faceSrc ? join(ROOT, 'collection', faceSrc) : '';
ok(!!fromHtml && !!fromCss && relative(ROOT, fromHtml) === relative(ROOT, fromCss),
   `preload href 与 @font-face src 指向同一文件（${href} ≡ ${faceSrc}）`);
if (fromHtml && existsSync(fromHtml)) {
  const sz = (await stat(fromHtml)).size;
  NOTE(`字体文件 ${relative(ROOT, fromHtml)} 大小 ${sz} 字节`);
  ok(sz > 0 && sz < 64 * 1024, `字体很小（${sz} 字节），preload 的代价可以忽略`);
} else {
  ok(false, `preload 指向的字体文件存在（${href}）`);
}
const fd = faceMatch ? (/font-display:\s*(\w+)/.exec(faceMatch[0]) || [])[1] : '';
ok(fd === 'block',
   `@font-face 的 font-display 是 block（实际 "${fd}"）—— swap 会"先按回退字体画一遍再跳"`);

// ★ font-display: block 只允许"藏住冠号"，绝不能碰到首屏可读内容 ——
//   所以静态上先钉死：这个 family 除了 @font-face 本身，只许出现在
//   .copy-info .version-text 的选择器里（以后谁把它加到 body 上，这条立刻红）。
{
  const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const sels = [];
  for (let i = cssNoComment.indexOf(OCRB_FAMILY); i >= 0; i = cssNoComment.indexOf(OCRB_FAMILY, i + 1)) {
    const open = cssNoComment.lastIndexOf('{', i);
    const prev = Math.max(cssNoComment.lastIndexOf('}', open - 1), cssNoComment.lastIndexOf('{', open - 1));
    const sel = cssNoComment.slice(prev + 1, open).trim().split(/\s*\n\s*/).filter(Boolean).pop() || '';
    sels.push(sel.trim());
  }
  NOTE(`layout.css 里用到 ${OCRB_FAMILY} 的选择器：${JSON.stringify(sels)}`);
  // 期望 4 处：@font-face 里 2 处（font-family 声明 + src 的 url），
  // 使用处 2 处（桌面端 + 手机端 @media 里的 .copy-info .version-text）
  const inFace = sels.filter(s => s === '@font-face').length;
  const inUse = sels.filter(s => s === '.copy-info .version-text').length;
  const other = sels.filter(s => s !== '@font-face' && s !== '.copy-info .version-text');
  ok(inFace === 2 && inUse === 2 && other.length === 0,
     `这个 family 只出现在 1 条 @font-face（2 处）与 2 条 .copy-info .version-text 里（实际 @font-face ${inFace} / 使用 ${inUse} / 其它 ${JSON.stringify(other)}）`);
  ok(other.length === 0,
     `★ 用到它的选择器只有 .copy-info .version-text（没有 body / 侧边栏 / 加载屏）—— block 不可能藏住首屏可读内容`);
}

console.log('\n══════ B. main.js 必须把 FontFace 提前置为 loaded ══════');
NOTE('preload 只把字节放进缓存；第一个用到它的元素仍会走一次"先按回退排版→拿到字体再重排"');
ok(mainJs.includes(`document.fonts.load('1em "${OCRB_FAMILY}"')`),
   `main.js 主动 document.fonts.load('1em "${OCRB_FAMILY}"')`);
// 必须在 DOMContentLoaded 回调**之外**：卡片是数据加载完后才渲染的，
// 写在 DOMContentLoaded 里也不算晚，但写成顶部同步 IIFE 才是"早于一切"的语义。
const kickIdx = mainJs.indexOf(`document.fonts.load('1em "${OCRB_FAMILY}"')`);
const dclIdx = mainJs.indexOf("document.addEventListener('DOMContentLoaded'");
ok(kickIdx >= 0 && dclIdx >= 0 && kickIdx < dclIdx,
   `这次 load 在 DOMContentLoaded 之前（顶部 IIFE，index ${kickIdx} < ${dclIdx}）`);

console.log('\n══════ C. 数据模块加载并发 ══════');
const concRe = /const DATA_LOAD_CONCURRENCY = (\d+);/;
const conc = concRe.exec(loaderJs);
ok(!!conc, 'data-loader.js 里有唯一的 DATA_LOAD_CONCURRENCY 常量');
ok(conc && Number(conc[1]) === EXPECTED_CONCURRENCY,
   `并发数 == ${EXPECTED_CONCURRENCY}（实际 ${conc ? conc[1] : '(没有)'}）`);
ok(!/const CONCURRENCY = \d+;/.test(loaderJs),
   '旧的写死局部 const CONCURRENCY 已经不在了（并发只有一个来源，不会两处漂移）');
const poolUses = [...loaderJs.matchAll(/Array\.from\(\{\s*length:\s*Math\.(?:min|max)\([^)]*DATA_LOAD_CONCURRENCY/g)];
ok(poolUses.length === 2,
   `两处 worker 池都用这个常量（loadDataFromTrees + loadAllData，实际 ${poolUses.length} 处）`);
// 不变量：取号方式与失败/兜底路径必须原样保留（提高并发不许顺手改错这些）
ok(loaderJs.includes('const file = files[next++];'),
   '不变量：worker 池仍用同步取号 files[next++]（不会取重/漏取）');
ok((loaderJs.match(/failed\.push\(file\);/g) || []).length === 2,
   '不变量：两处失败都只记进 failed、不中断其余文件');
ok((loaderJs.match(/window\.__dataLoadFailures = failed;/g) || []).length === 2,
   '不变量：失败清单仍然暴露到 window.__dataLoadFailures');
ok(loaderJs.includes("console.warn('[data-loader] 跳过加载失败的文件:'"),
   '不变量：单个文件失败仍然只 warn、不 reject 整个加载');
ok(loaderJs.includes("if (onProgress) onProgress({ loaded: files.length, total, current: '' });"),
   '不变量：全部加载完仍会补一次 onProgress（加载屏的"全部就绪"就靠它）');
ok(loaderJs.includes('if (dataReadyPromise) return dataReadyPromise;'),
   '不变量：loadAllData 的"只跑一次"缓存仍在（重复调用不会重复注入）');

// ══════════════════ 起服务器 / Chrome ══════════════════
// legacy 模式：把三处改动退回旧实现，用于 E（反向验证）与 F（首屏耗时对照）。
// ★ 只退字体那三处，**不碰 data-loader**：F 要对比的是"字体处理"的影响，
//   并发必须在两边一致，否则量到的是并发差异。
let MODE = 'normal';
const patched = { css: 0, html: 0, main: 0, root: 0, pages: 0 };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
    let buf = await readFile(full);
    if (MODE === 'legacy') {
      // ★ 只有**真的替换成功**才把 buffer 换掉：这个 handler 要发二进制（woff / png / svg），
      //   无条件 buf.toString('utf8') → Buffer.from(...,'utf8') 会把非法 UTF-8 字节
      //   换成 U+FFFD，字体/图片直接损坏（实测 woff 9472 字节会胀成 17095 字节、
      //   FontFace 变 error、图片被 ORB 拦掉）—— 这是"对照组把结论带偏"的经典坑。
      const rel = relative(ROOT, full).split('\\').join('/');
      let s = null, hit = false;
      if (rel === 'collection/layout.css') {
        s = buf.toString('utf8');
        const b = s;
        s = s.replace(/font-display:\s*block;/, 'font-display: swap;');
        hit = s !== b; if (hit) patched.css++;
      } else if (rel === 'collection/index.html') {
        s = buf.toString('utf8');
        const b = s;
        s = s.replace(/[ \t]*<link rel="preload" as="font"[^>]*>\r?\n/, '');
        hit = s !== b; if (hit) patched.html++;
      } else if (rel === 'collection/main.js') {
        s = buf.toString('utf8');
        const b = s;
        s = s.replace(`document.fonts.load('1em "${OCRB_FAMILY}"')`, 'void 0');
        hit = s !== b; if (hit) patched.main++;
      } else if (rel === 'index.html') {
        // 站点入口页（仓库根 index.html）也吃 OCR-B，它有自己的 preload 与内联触发
        s = buf.toString('utf8');
        const b = s;
        s = s.replace(/[ \t]*<link rel="preload" as="font"[^>]*>\r?\n/, '');
        s = s.replace(`document.fonts.load('1em "OCRB10"')`, 'void 0');
        hit = s !== b; if (hit) patched.root++;
      } else if (rel === 'academic/index.html' || rel === 'time/index.html' || rel === 'time_awful/index.html') {
        // 另外三页（H/I 小节）：同一个 family "OCRB10"，退回旧实现 =
        // 去掉 preload + 不再主动 load + font-display 回到 swap（三页原本都是 swap）。
        s = buf.toString('utf8');
        const b = s;
        s = s.replace(/[ \t]*<link rel="preload" as="font"[^>]*>\r?\n/, '');
        s = s.replace(`document.fonts.load('1em "OCRB10"')`, 'void 0');
        s = s.replace(/font-display:\s*(swap|block);/, 'font-display: swap;');
        hit = s !== b; if (hit) patched.pages++;
      }
      if (hit) buf = Buffer.from(s, 'utf8');
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/`;
// 注入 60ms 网络延迟（CDP Network.emulateNetworkConditions）：本机 0 RTT 时
// "字体晚一帧到"几乎看不出来，加一点 RTT 才能把"惰性发现字体"这个坑稳定复现出来
// （线上只会更明显）。断言只关心"字体是不是在冠号出现之前就 loaded"，与绝对毫秒无关。
const LATENCY = 60;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpOcrb-'));
const DP = 16600 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => {
  for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪');
})());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

// ══════════════════ 逐帧采样器 ══════════════════
const SAMPLER = `(function () {
  // ★ 必须关掉 SW 注册：仓库里 collection/sw.js 会把旧版 CSS/JS 喂回来，
  //   不关的话这里量到的可能是缓存里的老资源（"本地全绿、线上仍旧"的经典坑）。
  try { Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined }); } catch (e) {}
  var rec = { frames: [], fcp: null, appShownAt: null, screenGoneAt: null, dataPeak: 0, dataAppended: 0, dataInflight: 0, errors: [], progressTotal: null, progressMax: 0 };
  window.__ocrb = rec;
  try {
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (e.name === 'first-contentful-paint' && rec.fcp === null) rec.fcp = e.startTime; }); }).observe({ type: 'paint', buffered: true });
  } catch (e) {}
  // 加载屏上的 "正在加载 xxx.js · 50%（36/72）" —— 从 DOM 里读那个 72，
  // 用来和"真的插了几个 <script>"互相印证（比静态数 dataFile 更权威：
  //  walkTree 只收同时有 dataKey 的节点）
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('dataLoadingFile');
    if (!el) return;
    new MutationObserver(function () {
      var m = (el.textContent || '').match(/(\\d+)\\/(\\d+)/);
      if (m) { rec.progressTotal = +m[2]; rec.progressMax = +m[1]; }
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  // 并发实测：data-loader.js 是**全仓库唯一**动态插 <script> 的地方，
  // 所以"插进去还没 load/error 的个数"就是它真实的在飞请求数。
  try {
    var origAppend = Node.prototype.appendChild;
    Node.prototype.appendChild = function (n) {
      try {
        if (n && n.tagName === 'SCRIPT' && n.src && /\\.js(\\?|$)/.test(n.src)) {
          rec.dataAppended++; rec.dataInflight++;
          if (rec.dataInflight > rec.dataPeak) rec.dataPeak = rec.dataInflight;
          var ol = n.onload, oe = n.onerror;
          n.onload = function (ev) { rec.dataInflight--; if (ol) return ol.call(this, ev); };
          n.onerror = function (ev) { rec.dataInflight--; if (oe) return oe.call(this, ev); };
        }
      } catch (e) {}
      return origAppend.apply(this, arguments);
    };
  } catch (e) {}
  window.addEventListener('error', function (e) { rec.errors.push(String(e.message).slice(0, 120)); });
  function faceState() {
    var f = Array.from(document.fonts).filter(function (x) { return x.family.replace(/^"|"$/g, '') === ${JSON.stringify(OCRB_FAMILY)}; })[0];
    return f ? f.status + '/' + (f.display || '?') : '(无)';
  }
  function snap() {
    var els = document.querySelectorAll('.version-text');
    var rects = [];
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      rects.push([+r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)]);
    }
    var app = document.getElementById('app');
    return { t: +performance.now().toFixed(1), n: els.length, rects: rects, face: faceState(),
             appVisible: !!(app && getComputedStyle(app).display !== 'none' && app.childElementCount > 0) };
  }
  var n = 0;
  (function frame() {
    var s = snap();
    rec.frames.push(s);
    if (rec.appShownAt === null && s.appVisible) rec.appShownAt = s.t;
    // ★ 首屏"可读内容就绪"的判据用**加载屏消失**：#app 在分类深链接下会被
    //   switchToCurrentContainer() 再藏回去（内容搬到分类容器里），所以对 #app
    //   取"可见"会永远取到 null，断言就成了空断言（第一版就踩了这个）。
    if (rec.screenGoneAt === null) {
      var lc = document.getElementById('loadingContainer');
      if (lc && getComputedStyle(lc).display === 'none') rec.screenGoneAt = s.t;
    }
    if (++n < 700) requestAnimationFrame(frame);
  })();
  // 探针灵敏度：把冠号强制换成回退字体栈量一次宽度，必须与真字体不同 ——
  // 否则"零位移"这个断言没有分辨力（旧实现必须能被测出来）。
  window.__sensitivity = function () {
    var el = document.querySelector('.version-text');
    if (!el) return null;
    var real = el.getBoundingClientRect().width;
    var oldF = el.style.fontFamily, oldFs = el.style.fontSize;
    el.style.fontFamily = "'Noto Sans CJK SC', 'Source Han Sans SC', 'PingFang SC', sans-serif";
    var fb = el.getBoundingClientRect().width;
    el.style.fontFamily = oldF; el.style.fontSize = oldFs;
    return { real: +real.toFixed(2), fallback: +fb.toFixed(2) };
  };
  window.__faces = function () {
    return { faces: Array.from(document.fonts).map(function (f) { return f.family + '|' + f.status + '|' + (f.display || ''); }),
             check: document.fonts.check('1em ${OCRB_FAMILY}'),
             count: document.querySelectorAll('.version-text').length };
  };
  // 首屏可读内容用的是什么字体 —— font-display: block 只允许影响"用到 OCR-B 的那一块"，
  // 所以这些元素的 computed font-family 里**不许**出现 OCR-B。
  window.__firstScreenFonts = function () {
    var sels = ['body', '.data-loading-text', '.data-loading-file', '.overview-header', '.tab-item', '.series-name'];
    var out = {};
    sels.forEach(function (s) { var el = document.querySelector(s); out[s] = el ? getComputedStyle(el).fontFamily : '(无此元素)'; });
    return out;
  };
  window.__analyze = function () {
    var withText = rec.frames.filter(function (f) { return f.n > 0; });
    var changed = [], prev = null, first = withText[0] || null;
    withText.forEach(function (f) {
      if (prev && prev.rects.length === f.rects.length) {
        for (var i = 0; i < f.rects.length; i++) {
          var a = prev.rects[i], b = f.rects[i];
          if (a.some(function (v, k) { return Math.abs(v - b[k]) > 0.01; })) {
            changed.push({ t: f.t, i: i, from: a, to: b });
          }
        }
      }
      prev = f;
    });
    var series = [], lastW = null;
    withText.forEach(function (f) {
      var w = f.rects[0] ? f.rects[0][2] : null;
      if (w !== lastW) { series.push([f.t, w, f.face]); lastW = w; }
    });
    return {
      totalFrames: rec.frames.length, textFrames: withText.length,
      first: first ? { t: first.t, n: first.n, rects: first.rects.slice(0, 4), face: first.face } : null,
      last: withText.length ? { t: withText[withText.length - 1].t, n: withText[withText.length - 1].n, rects: withText[withText.length - 1].rects.slice(0, 4), face: withText[withText.length - 1].face } : null,
      widthSeries: series.slice(0, 10), widthChanges: series.length,
      changedCount: changed.length, changed: changed.slice(0, 8),
      fcp: rec.fcp, appShownAt: rec.appShownAt, screenGoneAt: rec.screenGoneAt,
      dataPeak: rec.dataPeak, dataAppended: rec.dataAppended, errors: rec.errors,
      progressTotal: rec.progressTotal, progressMax: rec.progressMax,
      fontRes: performance.getEntriesByType('resource').filter(function (e) { return /\\.woff2?$/i.test(e.name); }).map(function (e) {
        return { name: e.name.split('/').pop(), start: +e.startTime.toFixed(1), end: +e.responseEnd.toFixed(1), size: e.transferSize, proto: e.nextHopProtocol };
      })
    };
  };
})();`;

const DEEP = 'index.html#notes/rmb/rmb3/s0,2,3/v0.0,2.0,3.0';

// 一轮冷启动：新文档 + 逐帧采样
// ★ 采样脚本必须**只挂一份**：Page.addScriptToEvaluateOnNewDocument 会累积，
//   挂两份的话 appendChild 包装会被套两层，dataAppended 直接翻倍（并发断言就废了）。
let scriptId = null;
async function coldLoad() {
  if (scriptId) { try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }); } catch {} scriptId = null; }
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(120);
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: SAMPLER, runImmediately: true });
  scriptId = r.identifier;
  await send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Page.navigate', { url: BASE + DEEP });
  await sleep(5200);
  return await evaluate('window.__analyze()');
}

let legacyRun = null;
// ══════════════════ G. 站点入口页（仓库根 index.html）也吃 OCR-B ══════════════════
// 那页 body 就把 "OCRB10" 摆在字体栈第一位（键盘按键、2FA 口令框、VERIFICATION GATE
// 全是它），而且它以前同样没有任何 preload。逐帧实测（HTTP/2 0 RTT）：
//   第 0 帧（t≈105.8ms）先按回退字体画：.sub 宽 109.48px、.key-btn 高 48.38px、
//   .password-section 高 380.5px；字体 t=22.7→113.1ms 才回来 →
//   第 2 帧（t≈121.4ms）重排：122.81px / 45.38px / 372.5px，CLS 0.00299。
const ROOT_SAMPLER = `(function () {
  try { Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined }); } catch (e) {}
  var rec = { frames: [], cls: 0, shiftN: 0, errors: [] };
  window.__root = rec;
  window.addEventListener('error', function (e) { rec.errors.push(String(e.message).slice(0, 140)); });
  try {
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { rec.cls += e.value; rec.shiftN++; }); }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  function face() {
    var f = Array.from(document.fonts).filter(function (x) { return x.family.replace(/^"|"$/g, '') === 'OCRB10'; })[0];
    return f ? f.status + '/' + (f.display || '?') : '(无)';
  }
  function snap() {
    var out = [];
    ['.sub', '.key-btn', '.password-section'].forEach(function (sel) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < Math.min(els.length, 2); i++) {
        var r = els[i].getBoundingClientRect();
        out.push([sel, +r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)]);
      }
    });
    return { t: +performance.now().toFixed(1), rects: out, face: face() };
  }
  var n = 0;
  (function frame() { rec.frames.push(snap()); if (++n < 220) requestAnimationFrame(frame); })();
  window.__rootAnalyze = function () {
    var changed = [], prev = null;
    rec.frames.forEach(function (f) {
      if (prev && prev.rects.length === f.rects.length) {
        for (var i = 0; i < f.rects.length; i++) {
          var a = prev.rects[i], b = f.rects[i];
          if (a.slice(1).some(function (v, k) { return Math.abs(v - b[k + 1]) > 0.01; })) {
            changed.push({ t: f.t, el: b[0], from: a.slice(1), to: b.slice(1) });
          }
        }
      }
      prev = f;
    });
    var w = performance.getEntriesByType('resource').filter(function (e) { return /\\.woff2?$/i.test(e.name); });
    // ★ 首帧（rAF 第一拍，文档还没解析）里 .sub 根本不存在，rects 是空数组 ——
    //   拿它当"文字第一次画出来"的时刻会让"字体比首帧早"这条断言变成偶然事件
    //   （实测它会以 0.9ms 的差距随抖动翻红）。真正要看的是**第一个量到矩形的帧**。
    var firstRects = rec.frames.filter(function (f) { return f.rects.length > 0; })[0] || null;
    return {
      frames: rec.frames.length, first: rec.frames[0], firstRects: firstRects, last: rec.frames[rec.frames.length - 1],
      changedCount: changed.length, changed: changed.slice(0, 6),
      cls: +rec.cls.toFixed(5), shiftN: rec.shiftN, errors: rec.errors,
      keyBtns: document.querySelectorAll('.key-btn').length,
      check: document.fonts.check('1em OCRB10'),
      fontRes: w.length ? { name: w[0].name.split('/').pop(), start: +w[0].startTime.toFixed(1), end: +w[0].responseEnd.toFixed(1) } : null
    };
  };
})();`;

async function loadRootPage() {
  if (scriptId) { try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }); } catch {} scriptId = null; }
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(120);
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: ROOT_SAMPLER, runImmediately: true });
  scriptId = r.identifier;
  await send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Page.navigate', { url: BASE.replace('/collection/', '/') + 'index.html' });
  await sleep(4500);
  return await evaluate('window.__rootAnalyze()');
}

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  const consoleErrors = [];
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.consoleAPICalled' && ['error'].includes(m.params.type)) consoleErrors.push(m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 160)); });

  // ---------- D. 冷启动零位移 ----------
  console.log('\n══════ D. 冷启动逐帧：冠号矩形零位移 + 首帧时字体已 loaded ══════');
  MODE = 'normal';
  const norm = await coldLoad();
  NOTE(`采样 ${norm.totalFrames} 帧，其中有冠号的 ${norm.textFrames} 帧；FCP=${norm.fcp === null ? '?' : norm.fcp.toFixed(0)}ms，首屏可见 t=${norm.appShownAt === null ? '?' : norm.appShownAt.toFixed(0)}ms`);
  NOTE(`数据文件动态插入 ${norm.dataAppended} 个，实测峰值并行 ${norm.dataPeak}`);
  ok(norm.textFrames > 5, `冷启动确实渲染出了冠号（${norm.textFrames} 帧含 .version-text，共 n=${norm.last ? norm.last.n : 0} 个）`);
  if (norm.first) {
    NOTE(`首个可见帧 t=${norm.first.t}ms  字体状态=${norm.first.face}  rects=${JSON.stringify(norm.first.rects)}`);
    NOTE(`最后一个可见帧 t=${norm.last.t}ms  rects=${JSON.stringify(norm.last.rects)}`);
  }
  ok(norm.changedCount === 0,
     `★ 冠号矩形全程零位移（${norm.textFrames} 帧、0 次变化；旧实现是 99.15→103.89px / 92.74→98.16px）`);
  if (norm.changedCount) for (const c of norm.changed) console.log(`      ✗ t=${c.t}ms 第 ${c.i} 个冠号 ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  ok(norm.first && norm.first.face === 'loaded/block',
     `★ 冠号第一次出现时字体就已经是 loaded（实际 "${norm.first ? norm.first.face : '?'}"）—— 从没按回退字体排版过`);
  const faces = await evaluate('window.__faces()');
  NOTE(`document.fonts：${JSON.stringify(faces.faces)}`);
  ok(faces.check === true, `document.fonts.check('1em ${OCRB_FAMILY}') 为 true`);
  ok(faces.faces.some(f => f.split('|')[0].replace(/"/g, '') === OCRB_FAMILY && f.split('|')[1] === 'loaded'),
     `${OCRB_FAMILY} 这条 FontFace 状态是 loaded`);

  // 探针灵敏度：回退字体宽度必须和真字体不同，否则"零位移"可能是空断言
  const sens = await evaluate('window.__sensitivity()');
  NOTE(`灵敏度：真字体宽 ${sens ? sens.real : '?'}px，回退字体宽 ${sens ? sens.fallback : '?'}px`);
  ok(!!sens && Math.abs(sens.real - sens.fallback) >= 2,
     `★ 探针有分辨力：回退字体与 OCR-B 宽度差 ${sens ? Math.abs(sens.real - sens.fallback).toFixed(2) : '?'}px（≥2px，存量位移必定被 frame 采样抓到）`);

  // ---------- C(动态). 实测峰值并行 == 常量 ----------
  console.log('\n══════ C(动态). 实测峰值并行数必须等于常量 ══════');
  // 加载屏自己报的总数（"k/N"）与真的插入次数必须一致 —— 后者才是并发池真的跑了多少个
  NOTE(`加载屏报的总数 N=${norm.progressTotal}，实测插入 ${norm.dataAppended} 个、峰值并行 ${norm.dataPeak}`);
  ok(norm.dataAppended === norm.progressTotal,
     `实测插入的数据 <script> 个数 == 加载屏报的总数（${norm.dataAppended} == ${norm.progressTotal}）`);
  ok(norm.dataAppended >= 60, `数据文件数量合理（${norm.dataAppended} 个 ≥ 60）`);
  ok(norm.dataPeak === EXPECTED_CONCURRENCY,
     `★ 实测峰值并行数 == ${EXPECTED_CONCURRENCY}（实际 ${norm.dataPeak}）—— 常量真的生效，不是摆设`);
  NOTE(`字体请求（新实现）：${JSON.stringify(norm.fontRes)}`);

  // ---------- E + F. 反向验证 + 首屏耗时对照 ----------
  console.log('\n══════ E/F. 反向验证（退回旧实现必须能测出位移）+ 首屏耗时对照 ══════');
  MODE = 'legacy';
  legacyRun = await coldLoad();
  NOTE(`legacy（swap + 无 preload + 不主动 load）采样 ${legacyRun.totalFrames} 帧，含冠号 ${legacyRun.textFrames} 帧`);
  NOTE(`legacy 字体请求：${JSON.stringify(legacyRun.fontRes)}`);
  if (legacyRun.first) NOTE(`legacy 首个可见帧 t=${legacyRun.first.t}ms 字体状态=${legacyRun.first.face} rects=${JSON.stringify(legacyRun.first.rects)}`);
  NOTE(`legacy 宽度序列（t, 第1个冠号宽, 字体状态）：${JSON.stringify(legacyRun.widthSeries)}  末帧 ${legacyRun.last ? legacyRun.last.t + 'ms ' + legacyRun.last.face : '?'}`);
  NOTE(`legacy 矩形变化 ${legacyRun.changedCount} 次` + (legacyRun.changed.length ? `，例如 ${JSON.stringify(legacyRun.changed[0])}` : ''));
  ok(patched.css > 0 && patched.html > 0 && patched.main > 0,
     `legacy 模式的三处替换都真的生效了（layout.css ${patched.css} / collection/index.html ${patched.html} / main.js ${patched.main}）`);
  ok(legacyRun.changedCount > 0,
     `★ 反向验证：退回旧实现确实会跳（${legacyRun.changedCount} 次矩形变化）—— 所以 D 的"零位移"不是空断言`);
  ok(legacyRun.first && legacyRun.first.face.indexOf('loaded') !== 0,
     `★ 反向验证：旧实现里冠号第一次出现时字体还没 loaded（实际 "${legacyRun.first ? legacyRun.first.face : '?'}"）＝ 先按回退字体排的版`);
  MODE = 'normal';

  const dFcp = norm.fcp - legacyRun.fcp, dScreen = norm.screenGoneAt - legacyRun.screenGoneAt;
  NOTE(`FCP 对照：新 ${norm.fcp.toFixed(0)}ms vs 旧 ${legacyRun.fcp.toFixed(0)}ms（差 ${dFcp.toFixed(0)}ms）`);
  NOTE(`加载屏消失对照：新 ${norm.screenGoneAt.toFixed(0)}ms vs 旧 ${legacyRun.screenGoneAt.toFixed(0)}ms（差 ${dScreen.toFixed(0)}ms）`);
  // ★ 先钉住"判据不是空的"：两个数都必须真的取到（第一版对 #app 取可见，
  //   分类深链接下 #app 又被藏回去了，两边都是 null，差值恒为 0，断言形同虚设）
  ok(norm.screenGoneAt !== null && legacyRun.screenGoneAt !== null,
     `两侧都量到了"加载屏消失"时刻（新 ${norm.screenGoneAt}ms / 旧 ${legacyRun.screenGoneAt}ms）—— 下面的对照不是空断言`);
  ok(dFcp <= 150, `★ 首屏可读内容没被推迟：FCP 不比旧实现差 150ms 以上（差 ${dFcp.toFixed(0)}ms）`);
  ok(dScreen <= 150, `★ 加载屏消失也不比旧实现差 150ms 以上（差 ${dScreen.toFixed(0)}ms）`);
  // 最硬的一条：首屏可读内容压根不吃 OCR-B，所以 block 期再长也影响不到它
  const fsFonts = await evaluate('window.__firstScreenFonts()');
  NOTE(`首屏元素的 computed font-family：${JSON.stringify(fsFonts)}`);
  const leak = Object.entries(fsFonts).filter(([, v]) => String(v).includes(OCRB_FAMILY));
  ok(leak.length === 0,
     `★ 首屏可读元素一个都不吃 OCR-B（${Object.keys(fsFonts).length} 个元素全部检查过，泄漏 ${leak.length} 个）`);

  // ---------- G. 站点入口页（仓库根 index.html）也吃 OCR-B ----------
  console.log('\n══════ G. 站点入口页 index.html：同样零位移 + 反向验证 ══════');
  MODE = 'normal';
  const rootNew = await loadRootPage();
  const rnFirst = rootNew.firstRects || rootNew.first;
  NOTE(`入口页：${rootNew.frames} 帧，首个量到矩形的帧 t=${rnFirst.t}ms 字体=${rnFirst.face}，字体请求 ${JSON.stringify(rootNew.fontRes)}`);
  NOTE(`该帧矩形：${JSON.stringify(rnFirst.rects)}`);
  NOTE(`末帧矩形：${JSON.stringify(rootNew.last.rects)}`);
  NOTE(`入口页 JS 报错：${rootNew.errors.length ? JSON.stringify(rootNew.errors) : '（无）'}`);
  ok(rootNew.keyBtns >= 40, `入口页正常渲染（键盘按键 ${rootNew.keyBtns} 个）`);
  ok(rootNew.fontRes && rootNew.fontRes.end < rnFirst.t,
     `★ 字体在**文字第一次被量到之前**就已经取回（${rootNew.fontRes ? rootNew.fontRes.end : '?'}ms < ${rnFirst.t}ms）—— 从没有按回退字体画过`);
  ok(rootNew.changedCount === 0,
     `★ 入口页矩形全程零位移（${rootNew.frames} 帧、0 次变化；旧实现是 .sub 109.48→122.81px、.key-btn 高 48.38→45.38px）`);
  if (rootNew.changedCount) for (const c of rootNew.changed) console.log(`      ✗ t=${c.t}ms ${c.el} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  ok(rootNew.cls <= 0.001,
     `★ 入口页 CLS ${rootNew.cls}（旧实现 0.00299，全部来自那次字体重排；${rootNew.shiftN} 条 layout-shift）`);
  ok(rootNew.check === true, `入口页 document.fonts.check('1em OCRB10') 为 true`);

  MODE = 'legacy';
  const rootOld = await loadRootPage();
  const roFirst = rootOld.firstRects || rootOld.first;
  NOTE(`入口页 legacy：${rootOld.frames} 帧，首个量到矩形的帧 t=${roFirst.t}ms 字体=${roFirst.face}，字体请求 ${JSON.stringify(rootOld.fontRes)}`);
  NOTE(`legacy 变化 ${rootOld.changedCount} 次` + (rootOld.changed.length ? `，例如 ${JSON.stringify(rootOld.changed[0])}` : '') + `，CLS ${rootOld.cls}`);
  NOTE(`legacy JS 报错：${rootOld.errors.length ? JSON.stringify(rootOld.errors) : '（无）'}`);
  // ★ 入口页和收藏页不一样：那一页第一个画面就是 OCR-B 文字，所以"零位移"的代价
  //   必然是"文字等字体到手才画"。实测（60ms RTT、无缓存）preload 或 document.fonts.load()
  //   任意一个单独存在就会触发这个等待：preload-only 首帧 166ms、load-only 188ms、
  //   两个都有 187ms、两个都没有（旧实现）115ms —— 但旧实现 115ms 画的是回退字体，
  //   174~203ms 再跳一次。这里把这个"等多久"钉住：只许等字体本身，不许等别的。
  const dRoot = rnFirst.t - roFirst.t;
  NOTE(`入口页首个量到矩形的帧：新 ${rnFirst.t}ms vs 旧 ${roFirst.t}ms（差 ${dRoot.toFixed(0)}ms）`);
  NOTE('  ↑ 这个差是**故意**的取舍：旧实现先画回退字体、再重排；新实现等字体到手才画，文字晚一点出现，但一次都不跳。');
  ok(rootNew.fontRes && rnFirst.t <= rootNew.fontRes.end + 200,
     `入口页等到的只是字体本身（首帧 ${rnFirst.t}ms ≤ 字体到手 ${rootNew.fontRes ? rootNew.fontRes.end : '?'}ms + 200ms，没有别的阻塞）`);
  ok(patched.root > 0, `入口页 legacy 替换生效（${patched.root} 处）`);
  ok(rootOld.changedCount > 0,
     `★ 反向验证：入口页退回旧实现确实会跳（${rootOld.changedCount} 次矩形变化，CLS ${rootOld.cls} > ${rootNew.cls}）`);
  // 入口页本来就有 1 条自己的报错（与字体无关）——所以只能断言"我这处改动**没有新增**报错"，
  // 不能断言"一条都没有"（那会把页面既有的问题算到我头上）。
  ok(rootNew.errors.length <= rootOld.errors.length,
     `入口页这处改动没新增 JS 报错（新 ${rootNew.errors.length} 条 ≤ 旧 ${rootOld.errors.length} 条）`);
  MODE = 'normal';

  // ---------- H. 另外三页（academic / time / time_awful）：同一套办法 ----------
  // 这三页的 @font-face family 叫 "OCRB10"（与 collection 的 OCRB10PitchBT-Regular **不同名**），
  // 但指向仓库里同一个 woff（font/OCRB10PitchBT-Regular.woff）。用户裁定一并修掉：
  // 同样是 preload + 尽早 document.fonts.load()，font-display 按各页情况选。
  console.log('\n══════ H. 三页静态：preload 与 @font-face 同文件 / display 取值 / 提前 load 在样式表之后 ══════');
  // ★ 这里的期望 display 值不是照抄 collection 的 block：三页各自的选择理由写在自己的
  //   @font-face 注释里，改这张表就必须回去改注释（有意的"双人复核"）。
  //   实测依据（60ms RTT，逐帧）：
  //     · time：整屏内容就是 OCR-B 数字，回退字体排一遍再换 = 钟面跳 +108.71px → block；
  //       字体人为延迟 1.5s 时 swap 会在回退字体上先画一遍再跳，block 全程不画错字体。
  //     · academic / time_awful：正文以中文为主的内容/应用页，block 会把**连中文在内**的
  //       整段文字一起藏到字体到手为止（block-cjk 实测），字体取不到时代价太大 → swap。
  const PAGES = [
    { rel: 'academic/index.html', display: 'swap', probes: ['.sub'], clsMax: null,
      note: '内容页（中文正文为主）→ swap：字体取不到也要保证整页可读' },
    { rel: 'time/index.html', display: 'block', probes: ['.footer-line', '#timeDisplay'], clsMax: 0.001,
      note: '整屏就是 OCR-B 数字 → block：宁可等字体也不先画错字体' },
    { rel: 'time_awful/index.html', display: 'swap', probes: ['.boot-sub', '.tb-badge'], clsMax: 0.002,
      note: '应用型页面（启动屏 + 搜索 + 面板）→ swap：同 academic' }
  ];
  for (const pg of PAGES) {
    const src = await readFile(join(ROOT, pg.rel), 'utf8');
    const pl = /<link rel="preload" as="font" type="font\/woff" href="([^"]+)"([^>]*)>/.exec(src);
    const fm = /@font-face\s*\{[^}]*font-family:\s*"OCRB10"[^}]*\}/.exec(src);
    const faceSrc = fm ? (/src:\s*url\('([^']+)'\)/.exec(fm[0]) || [])[1] : '';
    const faceDisplay = fm ? (/font-display:\s*(\w+)/.exec(fm[0]) || [])[1] : '';
    const kickAt = src.indexOf(`document.fonts.load('1em "OCRB10"')`);
    const styleEnd = kickAt > 0 ? src.lastIndexOf('</style>', kickAt) : -1;
    // ★ 必须取**这张样式表里**最后一条 @font-face：注释里也会出现 "@font-face" 这几个字
    //   （第一版就是被自己注释里的字面量骗了，faceAt 落到了 </style> 之后而误报红）
    const faceAt = styleEnd > 0 ? src.lastIndexOf('@font-face', styleEnd) : -1;
    const dir = pg.rel.slice(0, pg.rel.lastIndexOf('/'));
    const hrefAbs = pl ? join(ROOT, dir, decodeURIComponent(pl[1])) : '';
    const srcAbs = faceSrc ? join(ROOT, dir, faceSrc) : '';
    NOTE(`${pg.rel}：preload=${pl ? pl[1] : '(无)'}  @font-face.src=${faceSrc}  display=${faceDisplay}  ${pg.note}`);
    ok(!!pl && /\bcrossorigin\b/.test(pl[2]),
       `${pg.rel}：有 as="font" 且带 crossorigin 的 preload（字体请求必须带凭据模式，否则会二次下载）`);
    ok(!!fm && faceSrc.endsWith('font/OCRB10PitchBT-Regular.woff'),
       `${pg.rel}：@font-face 的 family 是 OCRB10 且 src 指向那个共用的 woff（${faceSrc}）`);
    ok(hrefAbs !== '' && hrefAbs === srcAbs && existsSync(hrefAbs),
       `★ ${pg.rel}：preload 的 href 与 @font-face 的 src 解析到**同一个真实文件**（${hrefAbs}）—— 预加载的正是要用的字形`);
    ok(faceDisplay === pg.display,
       `★ ${pg.rel}：font-display 是选定的 ${pg.display}（实际 ${faceDisplay}）`);
    ok(kickAt > 0 && faceAt > 0 && faceAt < styleEnd && kickAt > styleEnd,
       `★ ${pg.rel}：提前 load() 落在定义 @font-face 的那张样式表**之后**（表内 @font-face@${faceAt} < </style>@${styleEnd} < load@${kickAt}）—— 否则 CSSOM 里没有这条规则，load 会解析成空家族名直接 resolve`);
  }

  // ---------- I. 三页动态：改前有位移、改后零位移 ----------
  // 采样口径与前两节不同，多两处防伪报：
  //   ① 只比**尺寸**（宽/高）：academic 面板有 500ms fadeInUp(translateY) 入场动画，
  //      每帧 x/y 本来就在动，那是设计不是字体问题；
  //   ② 只有"**文字没变**、尺寸却变了"才算位移：时钟每秒换数字、time_awful 的
  //      "0%→55%→100%" 也会改宽度，拿它当位移会误报。
  const mkPageSampler = sels => `(function () {
  try { Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined }); } catch (e) {}
  var SEL = ${JSON.stringify(sels)};
  var rec = { frames: [], cls: 0, shiftN: 0, errors: [] };
  window.__pg = rec;
  window.addEventListener('error', function (e) { rec.errors.push(String(e.message).slice(0, 140)); });
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { rec.cls += e.value; rec.shiftN++; }); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  function face() {
    var f = Array.from(document.fonts).filter(function (x) { return x.family.replace(/^"|"$/g, '') === 'OCRB10'; })[0];
    return f ? f.status + '/' + (f.display || '?') : '(无)';
  }
  function snap() {
    var out = [];
    SEL.forEach(function (sel) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < Math.min(els.length, 2); i++) {
        var el = els[i], r = el.getBoundingClientRect();
        out.push([sel, +r.x.toFixed(2), +r.y.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2), (el.textContent || '').trim().slice(0, 24)]);
      }
    });
    return { t: +performance.now().toFixed(1), rects: out, face: face() };
  }
  var n = 0;
  (function frame() { rec.frames.push(snap()); if (++n < 240) requestAnimationFrame(frame); })();
  window.__pgAnalyze = function () {
    var per = {}, changed = [];
    rec.frames.forEach(function (f) {
      f.rects.forEach(function (r) {
        var k = r[0], e = per[k] || (per[k] = { first: null, last: null, wseries: [] });
        if (e.last && e.last.text === r[5] && (Math.abs(e.last.rect[2] - r[3]) > 0.01 || Math.abs(e.last.rect[3] - r[4]) > 0.01)) {
          changed.push({ t: f.t, el: k, from: e.last.rect.slice(2), to: r.slice(3), prevFace: e.last.face, face: f.face });
        }
        if (!e.wseries.length || e.wseries[e.wseries.length - 1][1] !== r[3]) e.wseries.push([f.t, r[3]]);
        if (!e.first) e.first = { t: f.t, rect: r.slice(1), text: r[5], face: f.face };
        e.last = { t: f.t, rect: r.slice(1), text: r[5], face: f.face };
      });
    });
    var firstRects = rec.frames.filter(function (f) { return f.rects.length > 0; })[0] || null;
    var w = performance.getEntriesByType('resource').filter(function (e) { return /\\.woff2?$/i.test(e.name); });
    // 主图（academic 那张 1.72MB 的 headphoto.png）的时序：J 小节要比"字体 vs 主图"
    var im = performance.getEntriesByType('resource').filter(function (e) { return /headphoto\\.png$/i.test(e.name); })[0];
    var clock = document.querySelector('#timeDisplay');
    return {
      frames: rec.frames.length, firstRects: firstRects, cls: +rec.cls.toFixed(5), shiftN: rec.shiftN,
      changedCount: changed.length, changed: changed.slice(0, 6), per: per, errors: rec.errors,
      clockText: clock ? clock.textContent.replace(/\\s+/g, ' ').trim().slice(0, 24) : null,
      fontRes: w.length ? { name: w[0].name.split('/').pop(), start: +w[0].startTime.toFixed(1), end: +w[0].responseEnd.toFixed(1) } : null,
      imgRes: im ? { name: im.name.split('/').pop(), start: +im.startTime.toFixed(1), end: +im.responseEnd.toFixed(1), size: im.decodedBodySize } : null
    };
  };
})();`;

  async function loadPage(rel, sels) {
    if (scriptId) { try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }); } catch {} scriptId = null; }
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(120);
    const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: mkPageSampler(sels), runImmediately: true });
    scriptId = r.identifier;
    await send('Network.emulateNetworkConditions', { offline: false, latency: LATENCY, downloadThroughput: -1, uploadThroughput: -1 });
    await send('Page.navigate', { url: BASE.replace('/collection/', '/') + rel });
    await sleep(4600);
    return await evaluate('window.__pgAnalyze()');
  }

  console.log('\n══════ I. 三页逐帧：改前先按回退字体排过一遍，改后零位移 ══════');
  const pageSummary = [];
  for (const pg of PAGES) {
    MODE = 'normal';
    const nw = await loadPage(pg.rel, pg.probes);
    const nwFirst = nw.firstRects || { t: null, face: '?' };
    const nwFallback = Object.values(nw.per).filter(e => e.first && e.first.rect[2] !== e.last.rect[2]);
    const nwTexts = Object.values(nw.per).map(e => (e.last && e.last.text) || '');
    NOTE(`【改后】${pg.rel}：${nw.frames} 帧，首帧量到矩形 t=${nwFirst.t}ms 字体=${nwFirst.face}，字体请求 ${JSON.stringify(nw.fontRes)}，CLS=${nw.cls}（${nw.shiftN} 条）`);
    for (const k of Object.keys(nw.per)) NOTE(`    ${k} 首帧宽 ${nw.per[k].first.rect[2]}px → 末帧宽 ${nw.per[k].last.rect[2]}px，宽度序列（有变化才记）${JSON.stringify(nw.per[k].wseries)}`);
    ok(nwTexts.some(t => t && t.length > 1), `${pg.rel}：页面正常渲染出可测文字（${JSON.stringify(nwTexts.filter(Boolean))}）`);
    ok(nw.changedCount === 0,
       `★ ${pg.rel}：逐帧尺寸零位移（${nw.frames} 帧、0 次变化）`);
    if (nw.changedCount) for (const c of nw.changed) console.log(`      ✗ t=${c.t}ms ${c.el} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}（${c.prevFace} → ${c.face}）`);
    ok(nwFallback.length === 0,
       `★ ${pg.rel}：${Object.keys(nw.per).length} 个探针**第一帧量到的就是最终尺寸**（没有任何一个先按回退字体排过版）`);
    ok(nw.fontRes && nwFirst.t !== null && nw.fontRes.end <= nwFirst.t + 50,
       `★ ${pg.rel}：字体在文字第一次被量到之前/同时就绪（字体到手 ${nw.fontRes ? nw.fontRes.end : '?'}ms ≤ 首帧 ${nwFirst.t}ms + 50ms 容差）`);
    if (pg.clsMax !== null) {
      ok(nw.cls <= pg.clsMax, `★ ${pg.rel}：CLS ${nw.cls} ≤ ${pg.clsMax}（旧实现是 0.02187 / 0.0300 那一档）`);
    } else {
      // 这一页的 CLS 被它自己的 500ms fadeInUp 入场动画 + JS 渲染站点列表主导，
      // 与字体无关，硬钉阈值只会变成随机红绿 —— 所以这里只记录不断言。
      NOTE(`${pg.rel}：CLS=${nw.cls} 不设断言（这一页自己的入场动画 + JS 列表渲染就占满了 CLS，与字体无关）`);
    }
    if (pg.rel === 'time/index.html') {
      ok(/^\d{2}:\d{2}:\d{2}/.test(nw.clockText || ''),
         `★ time：钟面仍然正常走字（#timeDisplay = "${nw.clockText}"）`);
    }

    MODE = 'legacy';
    const od = await loadPage(pg.rel, pg.probes);
    const odFirst = od.firstRects || { t: null, face: '?' };
    const odFallback = Object.values(od.per).filter(e => e.first && e.first.rect[2] !== e.last.rect[2]);
    const odJump = Math.max(0, ...Object.values(od.per).map(e => (e.first && e.last) ? Math.abs(e.last.rect[2] - e.first.rect[2]) : 0));
    NOTE(`【改前】${pg.rel}：${od.frames} 帧，首帧 t=${odFirst.t}ms 字体=${odFirst.face}，字体请求 ${JSON.stringify(od.fontRes)}，CLS=${od.cls}`);
    for (const k of Object.keys(od.per)) NOTE(`    ${k} 宽度序列（有变化才记）${JSON.stringify(od.per[k].wseries)}`);
    NOTE(`【改前】尺寸位移 ${od.changedCount} 次` + (od.changed.length ? `，例如 t=${od.changed[0].t}ms ${od.changed[0].el} ${JSON.stringify(od.changed[0].from)} → ${JSON.stringify(od.changed[0].to)}（${od.changed[0].prevFace} → ${od.changed[0].face}）` : ''));
    ok(od.changedCount > 0,
       `★ 反向验证：${pg.rel} 退回旧实现确实会跳（${od.changedCount} 次尺寸变化，最大 ${odJump.toFixed(2)}px）—— 所以"改后零位移"不是空断言`);
    ok(odFallback.length > 0,
       `★ 反向验证：${pg.rel} 旧实现里${odFallback.length} 个探针**先按回退字体排过版**（首帧宽 ≠ 末帧宽）`);
    ok(odJump >= 2,
       `★ 探针有分辨力：${pg.rel} 回退字体与 OCR-B 的宽度差 ${odJump.toFixed(2)}px（≥2px，帧采样必定抓到）`);
    ok(nw.errors.length <= od.errors.length,
       `${pg.rel}：这处改动没新增 JS 报错（新 ${nw.errors.length} 条 ≤ 旧 ${od.errors.length} 条）`);
    MODE = 'normal';
    pageSummary.push({ rel: pg.rel, display: pg.display, nwChanged: nw.changedCount, odChanged: od.changedCount,
      jump: odJump, nwFirst: nwFirst.t, odFirst: odFirst.t, nwCls: nw.cls, odCls: od.cls,
      nwFont: nw.fontRes ? nw.fontRes.end : null, odFont: od.fontRes ? od.fontRes.end : null });
  }
  ok(patched.pages > 0, `三页 legacy 替换都真的生效了（${patched.pages} 次文件替换）`);
  console.log('\n  ── 三页汇总（改前 / 改后）──');
  for (const s of pageSummary) {
    console.log(`  ${s.rel.padEnd(24)} display=${s.display.padEnd(5)} 尺寸位移 ${s.odChanged} → ${s.nwChanged} 次（最大跳 ${s.jump.toFixed(2)}px）  首字出现 ${s.odFirst}ms → ${s.nwFirst}ms（+${(s.nwFirst - s.odFirst).toFixed(0)}ms 是"等字体"的代价）  字体到手 ${s.odFont} → ${s.nwFont}ms  CLS ${s.odCls} → ${s.nwCls}`);
  }

  // ---------- J. academic 主图：加载优先级压到最低，别和字体抢 ----------
  // 用户裁定：不许内联字体、不许改入场动画，改为"把主图加载优先级调到最后"。
  // 手段只有三个 HTML 属性（见 academic/index.html 主图上的注释），这里把"属性真的在"
  // 与"引擎里真的生效（字体不晚于主图）"两件事分别钉住。
  console.log('\n══════ J. academic 主图降优先级：静态属性 + 字体不晚于主图 ══════');
  {
    const src = await readFile(join(ROOT, 'academic', 'index.html'), 'utf8');
    const m = /<img[^>]*class="logo-icon"[^>]*>/.exec(src);
    const tag = m ? m[0].replace(/\s+/g, ' ') : '';
    NOTE(`主图标签：${tag.slice(0, 220)}`);
    ok(!!m, 'academic/index.html 里主图 <img class="logo-icon"> 还在（没被删掉）');
    ok(/src="\.\.\/image\/headphoto\.png"/.test(tag),
       '主图 src 仍是原图 ../image/headphoto.png（没有换成低清占位）');
    ok(/\bfetchpriority="low"/.test(tag),
       '★ 主图带 fetchpriority="low" —— 实测引擎里它的请求优先级从 Medium 掉到 Low（同一套 CDP 抓的 initialPriority，字体仍是 High）');
    ok(/\bdecoding="async"/.test(tag),
       '★ 主图带 decoding="async" —— 2048x1562 的解码不占主线程、不顶掉首绘');
    ok(/\bloading="eager"/.test(tag) && !/\bloading="lazy"/.test(tag),
       '★ 主图是显式 loading="eager" 且不是 lazy —— 首屏主图不许"滚不到就不加载"');
    const imgFile = await stat(join(ROOT, 'image', 'headphoto.png'));
    ok(imgFile.size >= 1000000,
       `主图还是那张大图（${(imgFile.size / 1048576).toFixed(2)}MB / 2048x1562）—— 要的是"优先级最后"，不是"不加载/换小图"`);
    MODE = 'normal';
    const a = await loadPage('academic/index.html', ['.sub']);
    NOTE(`资源时序（60ms RTT、无缓存）：字体 ${JSON.stringify(a.fontRes)}  主图 ${JSON.stringify(a.imgRes)}`);
    NOTE(`主图属性（页面上读回来的）：见 I 小节；首绘/FCP=${a.firstRects ? a.firstRects.t : '?'}ms（FCP/LCP 由那张主图 + 它父容器的 500ms fadeInUp 动画决定，见交付说明）`);
    ok(!!a.fontRes && !!a.imgRes, '两侧资源计时都取到了（下面两条不是空断言）');
    // 容差 30/40ms：两边都在同一拍发出，资源计时的 start 只有 rAF 级精度，钉死 0ms 会随机红
    ok(a.fontRes && a.imgRes && a.fontRes.start <= a.imgRes.start + 30,
       `★ 字体请求起点不晚于主图（字体 ${a.fontRes ? a.fontRes.start : '?'}ms ≤ 主图 ${a.imgRes ? a.imgRes.start : '?'}ms + 30ms 容差）`);
    ok(a.fontRes && a.imgRes && a.fontRes.end <= a.imgRes.end + 40,
       `★ 字体到手也不晚于主图（字体 ${a.fontRes ? a.fontRes.end : '?'}ms ≤ 主图 ${a.imgRes ? a.imgRes.end : '?'}ms + 40ms 容差）—— 主图不再和字体抢那一段带宽`);
    ok(a.changedCount === 0 && Object.values(a.per).every(e => e.first.rect[2] === e.last.rect[2]),
       `★ 降主图优先级没有把字体那处的零位移弄回去（.sub 首帧宽=${Object.values(a.per)[0] ? Object.values(a.per)[0].first.rect[2] : '?'}px = 末帧宽，逐帧尺寸位移 ${a.changedCount} 次）`);
    MODE = 'normal';
  }

  console.log(`\nconsole.error: ${consoleErrors.length ? consoleErrors.join(' | ') : '（无）'}`);
  console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
} catch (e) {
  // ★ 这个 catch 不是装饰：只有 finally 的话，用例自己抛异常（比如断言代码里写错变量）
  //   会被 finally 里的 process.exit(fail ? 1 : 0) **吞掉并退出 0** —— 一次"静默变绿"。
  //   本文件第一版就踩过：section G 里先用了后面才声明的 roFirst，抛 ReferenceError，
  //   输出截断在半个小节、退出码却是 0。
  fail++;
  console.log(`\n✗ 用例自身抛异常（不是断言失败，是脚本 bug）：${e && e.stack ? e.stack : e}`);
  console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
} finally {
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  await sleep(400);
  process.exit(fail ? 1 : 0);
}
