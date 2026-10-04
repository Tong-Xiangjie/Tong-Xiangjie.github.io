// 退出缩回动画：图片"完全不在屏幕中、但靠翻面能看到"时，点退出必须仍有动画
// （已进仓库：collection/tools/tests）
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

console.log('══════ ① 静态：落点解析改成"逐个候选试" ══════\n');
const cv = readFileSync('collection/category-view.js', 'utf8');
const cm = cv.slice(cv.indexOf('function closeModal'), cv.indexOf('function initPinchZoom'));
// 只看代码、不看注释（新注释里引用了旧写法，不剥掉会误判）
const cmCode = cm.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(/preferredSrc/.test(cmCode), '① closeModal 里区分了"首选落点"与"兜底落点"');
ok(/candidates\.push\(preferredSrc\)/.test(cmCode) && /candidates\.push\(fallbackSrc\)/.test(cmCode), '① 两个候选都进了候选列表');
ok(/modalShrinkTarget\(imageContentRect\(src\)\)/.test(cmCode), '① 每个候选都过一遍"是否真的落在视口内"');
ok(!/gridThumbForUrl\(faceUrl\) \|\| fallbackSrc/.test(cmCode), '① 旧的 `gridThumbForUrl(faceUrl) || fallbackSrc` 已去掉（它永远轮不到兜底）');
ok(/break;/.test(cmCode), '① 命中一个就停（不重复起飞）');

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
const userDir = await mkdtemp(join(tmpdir(), 'cdpCA-'));
const DP = 12000 + Math.floor(Math.random() * 90);
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
// ★ 钉死媒体偏好。本用例第 67 行就有断言"无头浏览器没有开 reduced-motion"——那是**假设**，
//   在 CI（GitHub 的 Windows runner 默认关闭系统动画）不成立，于是它连同后面的动画断言
//   一起变红。改成用例自己把偏好设为 no-preference，假设就成了保证。
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#notes` });
for (let i = 0; i < 140; i++) { const r = await evaluate(`typeof openModal === 'function' && document.readyState === 'complete'`).catch(() => false); if (r) break; await sleep(120); }
await sleep(900);

console.log('\n══════ ② 准备：两个"网格缩略图"（正/反两面）══════\n');
ok(await evaluate(`!prefersReducedMotion()`), '无头浏览器没有开 reduced-motion（否则动画本来就不该播）');
const urls = JSON.parse(await evaluate(`(()=>{
  document.querySelectorAll('.dsh-thumb-probe').forEach(e => e.remove());
  const base = new URL('img-placeholder.svg', location.href).href;
  const front = base, back = base + '?face=2';
  const mk = (src, left) => {
    const img = document.createElement('img');
    img.className = 'mini-thumb dsh-thumb-probe';
    img.src = src;
    img.style.cssText = 'position:fixed;left:' + left + 'px;top:120px;width:56px;height:40px;z-index:1;';
    document.body.appendChild(img);
    return img;
  };
  window.__tFront = mk(front, 40);
  window.__tBack = mk(back, 140);
  window.__off = () => ({ left: -500, top: -140, width: 56, height: 40, right: -444, bottom: -100, x: -500, y: -140 });
  return JSON.stringify({ front: front, back: back });
})()`));
const openModalPair = async () => {
  await evaluate(`(()=>{ lastModalSourceImg = window.__tFront; openModal(${JSON.stringify(urls.front)}, ${JSON.stringify(urls.back)}); return 1; })()`);
  for (let i = 0; i < 40; i++) { const r = await evaluate(`document.getElementById('imageModal').classList.contains('modal-show')`).catch(() => false); if (r) break; await sleep(120); }
  await sleep(500);
};
const closeAndSettle = async () => { await evaluate(`closeModal()`); await sleep(900); };
const flightInfo = () => evaluate(`(()=>{
  const el = document.querySelector('img.modal-flight');
  if (!el) return JSON.stringify(null);
  return JSON.stringify({ left: parseFloat(el.style.left), top: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) });
})()`).then(JSON.parse);

console.log('══════ ③ 核心场景：当前这一面（反面）的格子被滚出视口 ══════\n');
await openModalPair();
ok(await evaluate(`!!currentModalImg2`), '弹窗拿到了正反两面（可翻面）');
await evaluate(`modalFlip()`);
await sleep(400);
ok(await evaluate(`currentModalSide === 2`), '已翻到反面（现在显示的是反面那张）');
// 把"反面自己的格子"弄成"有尺寸但完全不在视口内"（等价于被滚出屏幕）
await evaluate(`window.__tBack.getBoundingClientRect = window.__off`);
ok(await evaluate(`(()=>{ const r = window.__tBack.getBoundingClientRect(); return r.width > 0 && r.bottom < 0; })()`), '反面格子：有尺寸、但完全在视口之外（模拟"图片不在屏幕中"）');
ok(await evaluate(`typeof gridThumbForUrl === 'function' && gridThumbForUrl(${JSON.stringify(urls.back)}) === window.__tBack`), 'gridThumbForUrl 仍会把这张"屏幕外"的格子当兜底返回（这正是旧写法轮不到 fallback 的原因）');
await evaluate(`closeModal()`);
const fl1 = await flightInfo();
const ex1 = JSON.parse(await evaluate(`JSON.stringify(imageContentRect(window.__tBack))`));
ok(!!fl1, '★ 点退出仍然生成了缩回飞行图层（不是直接淡出）');
if (fl1) {
  ok(ex1.left < 0 && ex1.bottom < 0, `（前提）反面格子确实在屏幕外：left=${Math.round(ex1.left)} bottom=${Math.round(ex1.bottom)}`);
  ok(Math.abs(fl1.left - ex1.left) <= 1 && Math.abs(fl1.top - ex1.top) <= 1, `★ 落点等于这张格子"应有"的位置（left=${fl1.left}/期望${Math.round(ex1.left)}，top=${fl1.top}/期望${Math.round(ex1.top)}）`);
  ok(fl1.left < 0, '★ 落点就在屏幕外（没被夹回视口内，也没改飞别的格子）');
  ok(fl1.w >= 8 && fl1.h >= 8, `飞行图层仍带真实尺寸（${fl1.w}×${fl1.h}）`);
}
await sleep(900);
ok(await evaluate(`document.getElementById('imageModal').style.display === 'none'`), '动画走完后弹窗正常隐藏');

console.log('\n══════ ④ 回归：正常情况仍缩回"当前这一面"自己的格子 ══════\n');
await evaluate(`delete window.__tBack.getBoundingClientRect`);
await openModalPair();
await evaluate(`modalFlip()`);
await sleep(400);
await evaluate(`closeModal()`);
const fl2 = await flightInfo();
const ex2 = JSON.parse(await evaluate(`JSON.stringify(imageContentRect(window.__tBack))`));
ok(!!fl2, '翻面后关闭：仍有缩回飞行图层');
if (fl2) ok(Math.abs(fl2.left - ex2.left) <= 1 && Math.abs(fl2.top - ex2.top) <= 1, `★ 落点精确等于反面自己的格子（left=${fl2.left}/期望${Math.round(ex2.left)}）—— 首选落点仍然优先`);
await sleep(900);

console.log('\n══════ ⑤ 首选与兜底都"没尺寸"（隐藏容器）时 → 退化成淡出 ══════\n');
await openModalPair();
await evaluate(`modalFlip()`);
await sleep(400);
await evaluate(`window.__tBack.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
  window.__tFront.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });`);
await evaluate(`closeModal()`);
const fl3 = await flightInfo();
ok(!fl3, '两个落点都是 0 尺寸时不硬飞（仍走整体淡出）');
await sleep(900);
ok(await evaluate(`document.getElementById('imageModal').style.display === 'none'`), '弹窗照常关闭（没卡在半透明）');
ok(await evaluate(`document.querySelectorAll('img.modal-flight').length === 0`), '没有残留的飞行图层');
ok(await evaluate(`modalFlipBusy === false`), 'modalFlipBusy 复位（不会导致下次翻不了面）');

console.log('\n══════ ⑥ 两个格子都在屏幕外 → 仍朝首选那个"应有"位置飞 ══════\n');
await evaluate(`delete window.__tFront.getBoundingClientRect; delete window.__tBack.getBoundingClientRect;`);
await openModalPair();
await evaluate(`modalFlip()`);
await sleep(400);
await evaluate(`window.__tBack.getBoundingClientRect = () => ({ left: -500, top: -140, width: 56, height: 40, right: -444, bottom: -100 });
  window.__tFront.getBoundingClientRect = () => ({ left: -900, top: -300, width: 56, height: 40, right: -844, bottom: -260 });`);
await evaluate(`closeModal()`);
const fl4 = await flightInfo();
ok(!!fl4, '两个格子都在屏幕外时照飞（而不是淡出）');
if (fl4) ok(fl4.left < -400 && fl4.left > -600, `★ 飞向首选（当前这一面）那个格子的屏幕外位置（left=${fl4.left}，期望约 -500 一侧，而不是兜底的 -900 一侧）`);
await sleep(900);
ok(await evaluate(`document.getElementById('imageModal').style.display === 'none'`), '弹窗照常关闭');
await evaluate(`delete window.__tFront.getBoundingClientRect; delete window.__tBack.getBoundingClientRect;
  document.querySelectorAll('.dsh-thumb-probe').forEach(e => e.remove()); delete window.__tFront; delete window.__tBack;`);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
child.kill();
server.close();
process.exitCode = fail ? 1 : 0;
