// A3 验证：hammer.js 已本地化，站内不再有任何外部 CDN 依赖，且捏合缩放仍然可用
import { createServer } from 'node:http';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
let pass = 0, fail = 0; const fails = [];
const ok = (c, m, extra = '') => { if (c) { pass++; console.log(`    ✓ ${m}${extra ? '  ' + extra : ''}`); } else { fail++; fails.push(m); console.log(`    ✗ ${m}${extra ? '  ' + extra : ''}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('══════ ① 静态：本地文件存在且是正版 hammer ══════\n');
const vendorPath = 'collection/vendor/hammer.min.js';
ok(existsSync(vendorPath), `本地文件存在：${vendorPath}`);
let size = 0, src = '';
if (existsSync(vendorPath)) {
  size = statSync(vendorPath).size;
  src = readFileSync(vendorPath, 'utf8');
  ok(size > 15000 && size < 200000, `体积正常（${(size / 1024).toFixed(1)} KB，官方 min 版约 20-30KB）`);
  ok(/Hammer/.test(src), '文件里确实有 Hammer 的实现');
  ok(!/document\.write/.test(src), '没有奇怪的 document.write（防止拿到被篡改的构建）');
}

console.log('\n══════ ② 静态：站内不再引用任何外部 CDN ══════\n');
const html = readFileSync('collection/index.html', 'utf8');
const extScripts = [...html.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]).filter(u => /^(https?:)?\/\//i.test(u));
ok(extScripts.length === 0, '★ index.html 里没有外部 <script src>', JSON.stringify(extScripts));
ok(!/cdnjs|jsdelivr|unpkg|googleapis|fonts\.google/i.test(html), '★ index.html 里没有任何 CDN 域名');
ok(/vendor\/hammer(\.min)?\.js/.test(html), '★ index.html 引的是本地 vendor/hammer.min.js');
// 整个 collection 目录扫一遍，防以后有人又加回来
const offenders = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const st = statSync(p);
    if (st.isDirectory()) { if (n !== 'vendor' && n !== 'image') walk(p); continue; }
    if (!/\.(html?|js|css)$/i.test(n)) continue;
    const t = readFileSync(p, 'utf8');
    const m = t.match(/https?:\/\/(cdnjs|cdn\.jsdelivr|unpkg|ajax\.googleapis|fonts\.googleapis)[^"')\s]*/i);
    if (m) offenders.push(p + ' → ' + m[0].slice(0, 60));
  }
})( 'collection');
ok(offenders.length === 0, '★ collection/ 下所有 html/js/css 都不含外部 CDN 引用', offenders.length ? JSON.stringify(offenders) : '');

// ★ 原来只扫 collection/，结果 notecollection/index.html 里还藏着一个 cdnjs 的 hammer.js 没被发现。
//   现在整站扫，并顺带确认每个本地 <script>/<link> 指向的文件真的存在（防止改成不存在的路径）。
//   跳过规则（都是客观的、不是挑着排除）：
//     · 点目录（.git / .github / answersheet/.ref/…）：Jekyll、Pages 默认都不发布点目录，不会上线；
//     · vendor（就是本地化的库本身）、data 与 image（用户的数据和图片，出现域名不代表依赖）、
//       tests（用例源码里本来就写着这些 CDN 正则）。
console.log('\n══════ ②b 静态：整站（含 notecollection）都没有外部 CDN 依赖 ══════\n');
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'data', 'image', 'tests']);
const localRefs = [], siteOffenders = [];
(function walkAll(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const segs = p.split(/[\\/]/);
    if (segs.some(s => s.startsWith('.') || SKIP_DIRS.has(s))) continue;
    const st = statSync(p);
    if (st.isDirectory()) { walkAll(p); continue; }
    if (!/\.(html?|js|css|mjs)$/i.test(n)) continue;
    const t = readFileSync(p, 'utf8');
    const m = t.match(/https?:\/\/(cdnjs|cdn\.jsdelivr|unpkg|ajax\.googleapis|fonts\.googleapis)[^"')\s]*/i);
    if (m) siteOffenders.push(p + ' → ' + m[0].slice(0, 60));
    if (/\.html?$/i.test(n)) {
      for (const mm of t.matchAll(/<(script|link)[^>]*?(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const u = mm[2];
        if (/^(https?:)?\/\//i.test(u) || /^(data:|#|mailto:)/i.test(u)) continue;
        localRefs.push([p, u]);
      }
    }
  }
})(ROOT);
ok(siteOffenders.length === 0, '★ 整站（含 notecollection）没有任何外部 CDN 引用', siteOffenders.length ? JSON.stringify(siteOffenders) : '');
const missing = localRefs.filter(([p, u]) => !existsSync(join(dirname(p), u.split('?')[0].split('#')[0])));
ok(missing.length === 0, `★ 每个本地 <script>/<link> 指向的文件都存在（查了 ${localRefs.length} 条）`, missing.length ? JSON.stringify(missing.slice(0, 4)) : '');
// ★ 只认 CDN 的 **URL**，不认 "cdnjs" 这个词 —— 注释里写"原来挂 cdnjs"是允许的
const cdnUrlRe = /(https?:)?\/\/[^"'\s>]*(cdnjs|cdn\.jsdelivr|unpkg|ajax\.googleapis|fonts\.googleapis)/i;
// 通用规则（不写死具体页面，以后新增子站也会被自动覆盖）：
//   ① 凡是引用 hammer 的页面，都必须引本地 vendor/hammer.min.js，且不能有 CDN 链接；
//   ② 每个本地 <script>/<link> 指向的文件都必须真实存在。
const hammerPages = [];
(function walkHtml(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const segs = p.slice(ROOT.length + 1).split(/[\\/]/);
    if (segs.some(s => s.startsWith('.') || SKIP_DIRS.has(s))) continue;
    if (statSync(p).isDirectory()) { walkHtml(p); continue; }
    if (!/\.html?$/i.test(n)) continue;
    const t = readFileSync(p, 'utf8');
    if (/hammer/i.test(t)) hammerPages.push([p.slice(ROOT.length + 1), t]);
  }
})(ROOT);
const hammerBad = hammerPages.filter(([, t]) => !/vendor\/hammer(\.min)?\.js/.test(t) || cdnUrlRe.test(t));
ok(hammerPages.length >= 4, `★ 扫到 ${hammerPages.length} 个引用 hammer 的页面（collection/notecollection/coincollection/funcollection/newcollection…）`);
ok(hammerBad.length === 0, '★ 所有引用 hammer 的页面都指向本地 vendor、且没有任何 CDN 链接', hammerBad.length ? JSON.stringify(hammerBad.map(([p]) => p)) : '');
ok(existsSync('answersheet/vendor/html2pdf.bundle.min.js') && existsSync('answersheet/vendor/jspdf.umd.min.js'), '★ answersheet/vendor 里 html2pdf 与 jsPDF 两个文件都在');

console.log('\n══════ ③ 实机：页面用的是本地那份，且捏合缩放能力在 ══════\n');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    let full = join(ROOT, p);
    if (p.endsWith('/')) full = join(ROOT, p, 'index.html');
    if (!existsSync(full) || (await stat(full)).isDirectory()) { res.writeHead(404).end('nf'); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/collection/index.html`;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpVendor-'));
const DP = 12300 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
let msgId = 0; const pending = new Map(); const pageErrors = [];
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const pg = l.find(t => t.type === 'page'); if (pg?.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.text || 'exception');
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }
await send('Runtime.enable'); await send('Page.enable');
// "外部请求"只认第三方域名：本机（开发服务器）和本站自己的域名（有的页面把图片写成
// https://tong-xiangjie.github.io/… 的绝对地址，那是本站、不是外部依赖）都排除掉。
const EXT_REQ = `/^https?:\\/\\/(?!127\\.0\\.0\\.1|localhost|tong-xiangjie\\.github\\.io)/`;
await send('Page.navigate', { url: PAGE });
let loaded = false;
for (let i = 0; i < 200; i++) { if (await evaluate(`typeof onTabClick === 'function' && document.readyState === 'complete'`).catch(() => false)) { loaded = true; break; } await sleep(120); }
ok(loaded, '页面加载完成');
if (loaded) {
  const hammer = await evaluate(`(typeof Hammer === 'function') ? (Hammer.VERSION || 'unknown') : ('missing:' + typeof Hammer)`);
  // ★ hammer.js 的怪癖：cdnjs 上标 2.0.8 的构建里 Hammer.VERSION 自报 '2.0.7'，
  //   所以这两个值都算正确（本地这份就是从那个构建存下来的）。
  ok(hammer === '2.0.7' || hammer === '2.0.8', `★ Hammer 从本地加载且版本正确（${hammer}）`);
  ok(await evaluate(`typeof Hammer.Manager === 'function' && typeof Hammer.Pinch === 'function'`), '★ 捏合（Pinch）识别器可用 —— 缩放功能不会是"静默失效"');
  const res = await evaluate(`JSON.stringify(performance.getEntriesByType('resource').map(r => r.name).filter(n => ${EXT_REQ}.test(n)))`);
  const external = JSON.parse(res);
  ok(external.length === 0, '★ 运行时没有向任何外部域名发请求', external.length ? JSON.stringify(external.slice(0, 4)) : '');
  const hammerRes = await evaluate(`JSON.stringify(performance.getEntriesByType('resource').map(r => r.name).filter(n => /hammer/i.test(n)))`);
  const hr = JSON.parse(hammerRes);
  ok(hr.some(n => /127\.0\.0\.1/.test(n) && /vendor\/hammer/.test(n)), '★ 实际加载的是本地 vendor/hammer.min.js', JSON.stringify(hr));
}

// ★ 顺带把 notecollection 和 answersheet 这两个"也在线"的页面拉起来看一眼：
//   notecollection 的手势（Hammer）、answersheet 的导出（html2pdf + jsPDF）都必须从本地加载成功，
//   只看 HTML 改没改不够 —— 路径写错、文件放错位置都会在这里现形。
const PAGES = [
  { name: 'notecollection', url: `http://127.0.0.1:${server.address().port}/notecollection/index.html`,
    probe: `(typeof Hammer === 'function' && typeof Hammer.Pinch === 'function') ? 'ok' : ('missing:' + typeof Hammer)`, want: 'ok',
    label: '★ notecollection：Hammer 从 ../collection/vendor 本地加载，捏合识别器可用' },
  { name: 'coincollection', url: `http://127.0.0.1:${server.address().port}/coincollection/index.html`,
    probe: `(typeof Hammer === 'function' && typeof Hammer.Pinch === 'function') ? 'ok' : ('missing:' + typeof Hammer)`, want: 'ok',
    label: '★ coincollection：Hammer 从 ../collection/vendor 本地加载，捏合识别器可用' },
  { name: 'answersheet', url: `http://127.0.0.1:${server.address().port}/answersheet/index.html`,
    probe: `(typeof html2pdf === 'function' || typeof html2pdf === 'object') && !!(window.jspdf && window.jspdf.jsPDF) ? 'ok' : ('html2pdf:' + typeof html2pdf + ' jspdf:' + (window.jspdf ? typeof window.jspdf.jsPDF : 'none'))`, want: 'ok',
    label: '★ answersheet：html2pdf 与 jsPDF 都从本地 vendor 加载成功（导出功能不会静默失效）' },
  { name: 'newcollection', url: `http://127.0.0.1:${server.address().port}/newcollection/index.html`,
    probe: `(typeof Hammer === 'function' && typeof Hammer.Pinch === 'function') ? 'ok' : ('missing:' + typeof Hammer)`, want: 'ok',
    label: '★ newcollection：Hammer 从 ../collection/vendor 本地加载，捏合识别器可用' },
  { name: 'funcollection/years', url: `http://127.0.0.1:${server.address().port}/funcollection/years/index.html`,
    probe: `(typeof Hammer === 'function' && typeof Hammer.Pinch === 'function') ? 'ok' : ('missing:' + typeof Hammer)`, want: 'ok',
    label: '★ funcollection/years：Hammer 从 ../../collection/vendor 本地加载（层级更深，最容易写错路径）' }
];
for (const pg of PAGES) {
  await send('Page.navigate', { url: pg.url });
  let ready = false;
  for (let i = 0; i < 150; i++) { if (await evaluate(`document.readyState === 'complete'`).catch(() => false)) { ready = true; break; } await sleep(120); }
  const got = ready ? await evaluate(pg.probe).catch(e => 'err:' + e.message) : 'not-loaded';
  ok(got === pg.want, `${pg.label}（${got}）`);
  if (ready) {
    const ext = JSON.parse(await evaluate(`JSON.stringify(performance.getEntriesByType('resource').map(r => r.name).filter(n => ${EXT_REQ}.test(n)))`).catch(() => '[]'));
    ok(ext.length === 0, `★ ${pg.name}：运行时没有向任何外部域名发请求`, ext.length ? JSON.stringify(ext.slice(0, 4)) : '');
  }
}

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
if (fails.length) { console.log('  失败项：'); fails.forEach(f => console.log('    · ' + f)); }
console.log(`  ${pageErrors.length === 0 ? '✓' : '✗'} 未捕获异常（${pageErrors.length} 条）${pageErrors.length ? '：' + pageErrors.slice(0, 2).join(' ｜ ') : ''}`);
try { ws.close(); } catch {}
child.kill(); server.close();
process.exit(fail === 0 ? 0 : 1);
