// CI 诊断：为什么"本地全绿、CI 全红"。
//
// 背景：verify-search-case.mjs（84 条 count() 全部"重试 40 次仍未就绪"）与 verify-octo.mjs
// （copyDetailList 里找不到 KP04057，listLen=undefined）在 GitHub runner 上红，本地全绿。
// 两个用例等的分别是 search.js 的 performSearchAndRender 与 category-view.js 的
// copyDetailList —— 两个**不同文件的顶层声明**在 CI 里同时不存在，说明不是某个断言写错，
// 而是页面压根没启动到那一步（很可能卡在某个永不返回的资源请求上）。
//
// 这个脚本不改任何代码，只做三件事，并把结果写成 check-run 注解（CI 日志要鉴权才能下载，
// 注解用公开 API 就能读）：
//   ① 在页面加载前注入错误收集器：window.onerror / unhandledrejection / console.error；
//   ② 打开 CDP 的 Network，记录 4xx/5xx、加载失败、以及"发出去了但一直没收到响应"的请求；
//   ③ 启动期间每 5 秒采一次样：关键全局在不在、渲染出多少条目、资源加载进度。
//
// 用法：node collection/tools/tests/diag-ci.mjs [hash]     （默认 notes/commemorative）
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const HASH = process.argv[2] || 'notes/commemorative';
const WAIT_MS = Number(process.env.DIAG_WAIT_MS || 60000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

const log = (m) => {
  const line = String(m);
  // CI 上同时打成注解：日志要 token，注解不要
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=DIAG::${line.replace(/\r?\n/g, ' | ').slice(0, 900)}`);
  console.log('  ' + line);
};

let served = 0, s404 = 0;
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full)) { s404++; res.writeHead(404).end('nf'); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(404).end('dir'); return; }
    const buf = await readFile(full);
    served++;
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { s404++; res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { log('找不到 Chrome'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpDiag-'));
const DP = 13900 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

const reqs = new Map();      // requestId -> {url, type, t0}
const failed = [];           // 加载失败（含被 abort/CORS/DNS）
const http4xx = [];          // 4xx/5xx
const navErrors = [];
let reqTotal = 0, respTotal = 0;
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.requestWillBeSent') { reqTotal++; reqs.set(m.params.requestId, { url: m.params.request.url, type: m.params.type, t0: Date.now() }); }
  else if (m.method === 'Network.responseReceived') { respTotal++; const r = reqs.get(m.params.requestId); if (r) r.status = m.params.response.status; if (m.params.response.status >= 400) http4xx.push(m.params.response.status + ' ' + m.params.response.url); }
  else if (m.method === 'Network.loadingFailed') { const r = reqs.get(m.params.requestId); failed.push((r ? r.type + ' ' + r.url : m.params.requestId) + ' 原因=' + m.params.errorText + (m.params.canceled ? '(已取消)' : '')); }
  else if (m.method === 'Runtime.exceptionThrown') { navErrors.push('异常: ' + ((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '')).replace(/\s+/g, ' ').slice(0, 300)); }
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') { navErrors.push('日志: ' + String(m.params.entry.text).slice(0, 250)); }
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
const evaluate = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300)); return r.result.value; };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Log.enable');
// 页面脚本跑起来之前就装好收集器（否则早期的异常收不到）
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__diag = { errs: [], rejects: [], cons: [] };
    window.addEventListener('error', e => { try { window.__diag.errs.push((e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0)); } catch (_) {} }, true);
    window.addEventListener('unhandledrejection', e => { try { window.__diag.rejects.push(String(e.reason && (e.reason.stack || e.reason.message || e.reason)).slice(0, 300)); } catch (_) {} });
    (function(){ const ce = console.error; console.error = function(){ try { window.__diag.cons.push([].slice.call(arguments).map(String).join(' ').slice(0, 250)); } catch (_) {} return ce.apply(console, arguments); }; })();`
});

const SAMPLE = `(()=>{
  const r = { t: Math.round(performance.now()), ready: document.readyState,
    sv: (typeof viewScrollContainers !== 'undefined'),
    views: (typeof viewScrollContainers !== 'undefined') ? Object.keys(viewScrollContainers).length : -1,
    cdl: (typeof copyDetailList === 'undefined') ? 'undef' : copyDetailList.length,
    psr: (typeof performSearchAndRender === 'function'),
    items: document.querySelectorAll('.copy-item, .category-item, .search-result-item').length,
    res: performance.getEntriesByType('resource').length,
    imgs: performance.getEntriesByType('resource').filter(e => e.initiatorType === 'img').length,
    scripts: document.scripts.length };
  if (window.__diag) { r.errs = window.__diag.errs.length; r.rejects = window.__diag.rejects.length; r.cons = window.__diag.cons.length; }
  return JSON.stringify(r);
})()`;

log(`诊断开始 hash=#${HASH} 等待 ${WAIT_MS / 1000}s  平台=${process.platform} CI=${!!process.env.CI}`);
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${HASH}` });
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < WAIT_MS) {
  await sleep(5000);
  try { samples.push(JSON.parse(await evaluate(SAMPLE))); } catch (e) { samples.push({ t: Date.now() - t0, err: String(e.message).slice(0, 120) }); }
}
samples.forEach(s => log('采样 ' + JSON.stringify(s)));

const final = await evaluate(`(()=>{
  const d = window.__diag || { errs: [], rejects: [], cons: [] };
  const res = performance.getEntriesByType('resource');
  const slow = res.slice().sort((a, b) => b.duration - a.duration).slice(0, 5).map(e => Math.round(e.duration) + 'ms ' + e.initiatorType + ' ' + e.name.split('/').slice(-1)[0]);
  return JSON.stringify({ errs: d.errs.slice(0, 8), rejects: d.rejects.slice(0, 8), cons: d.cons.slice(0, 8), slow,
    resCount: res.length, navDone: document.readyState, view: (typeof currentView !== 'undefined') ? currentView : '?',
    hash: location.hash, bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) });
})()`);
const F = JSON.parse(final);
log('最终 errs=' + JSON.stringify(F.errs));
log('最终 rejects=' + JSON.stringify(F.rejects));
log('最终 console.error=' + JSON.stringify(F.cons));
log('最慢的 5 个资源=' + JSON.stringify(F.slow));
log('资源数=' + F.resCount + '  readyState=' + F.navDone + '  view=' + F.view + '  hash=' + F.hash);
log('页面文字片段=' + JSON.stringify(F.bodyText));

// "发出去了但一直没回来"的请求：最像"页面卡住"的元凶
const never = [...reqs.values()].filter(r => !r.status).slice(0, 12).map(r => r.type + ' ' + r.url);
log('从未收到响应的请求（' + never.length + ' 条，最多列 12）=' + JSON.stringify(never));
log('HTTP 4xx/5xx（' + http4xx.length + '，最多 8）=' + JSON.stringify(http4xx.slice(0, 8)));
log('加载失败（' + failed.length + '，最多 8）=' + JSON.stringify(failed.slice(0, 8)));
log('请求总数=' + reqTotal + ' 收到响应=' + respTotal + '  测试服务器：已服务=' + served + ' 404/500=' + s404);

try { ws.close(); } catch {}
try { child.kill(); } catch {}
try { server.close(); } catch {}
process.exit(0);
