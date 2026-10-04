// 灯箱「左右滑动翻面」的真实验收（真实 Chrome + CDP 派发真实触摸事件）
//
// 为什么必须用真实浏览器：手势是"识别器 + 阈值 + 事件竞争"的组合，
// 假 DOM 里没有 Hammer、没有触摸事件流，测了也不算数。
//
// ★ 一个必须踩过的坑：Hammer 在**创建 Manager 时**就用 `'ontouchstart' in window`
//   决定要不要注册 TouchInput。所以触摸模拟必须在**页面加载之前**开启 ——
//   等弹窗打开后再开，Hammer 已经只挂了 MouseInput，怎么滑都没反应
//   （第一版就是这么错的：正向用例全红、反向用例全绿，看起来像"功能没生效"）。
//   而开着触摸模拟时 Chrome 会把鼠标事件也转成触摸，鼠标用例就不算数了，
//   所以鼠标用例单独在"未开模拟"的一轮里跑。
//
// 覆盖：
//   A 鼠标拖动（未放大）→ 不翻面、也不误关弹窗   ← 桌面保持原行为
//   B 左滑 → 翻到另一面
//   C 右滑 → 翻回来
//   D 竖滑 → 不翻面                              ← Swipe 限定横向
//   E 放大后横滑 → 不翻面                        ← 那是"看图片另一部分"
//   F 单面图横滑 → 不翻面                        ← 没有另一面可翻
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
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
const BASE = `http://127.0.0.1:${server.address().port}/collection/`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('找不到 Chrome'); process.exit(1); }
const userDir = await mkdtemp(path.join(tmpdir(), 'cdpSwipe-'));
const DP = 9451;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
async function wsUrlOf() { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch (e) { } await new Promise(r => setTimeout(r, 250)); } throw new Error('CDP 未就绪'); }
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
await send('Page.enable'); await send('Runtime.enable');
// ★ 钉死媒体偏好：CI（GitHub 的 Windows runner）默认关闭系统动画 → Chrome 报 reduce →
//   "关闭时生成了缩回飞行图层（说明没被 reduced-motion 短路）"这类断言必然红。
//   用例自身不该随宿主机的系统偏好变红。
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fail = 0;
const chk = (label, ok, detail) => { if (!ok) fail++; console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `\n      ${detail}`)); };

async function swipeTouch(x0, y0, x1, y1, steps = 8, dt = 16) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }] });
    await sleep(dt);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function dragMouse(x0, y0, x1, y1, steps = 8, dt = 16) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, button: 'left', buttons: 1 });
    await sleep(dt);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
}

const state = () => evaluate(`({
  side: currentModalSide,
  scale: currentScale,
  busy: modalFlipBusy,
  multi: !!currentModalImg2,
  show: document.getElementById('imageModal').classList.contains('modal-show'),
  touch: 'ontouchstart' in window
})`);

// 重新加载页面 → 进 rmb3 → 点开第一张成对正反面
async function loadAndOpenModal() {
  await send('Page.navigate', { url: BASE + '?f=' + Date.now() });
  for (let i = 0; i < 120; i++) { await sleep(300); try { if (await evaluate(`typeof openModal === 'function' && document.querySelectorAll('img.copy-thumb').length > 0`)) break; } catch (e) { } }
  await evaluate(`location.hash = '#notes/rmb/rmb3'`);
  for (let i = 0; i < 80; i++) { await sleep(300); try { if (await evaluate(`document.querySelectorAll('img.copy-thumb').length > 0`)) break; } catch (e) { } }
  for (let i = 0; i < 60; i++) { try { if (await evaluate(`[...document.querySelectorAll('img.copy-thumb')].some(e => e.complete && e.naturalWidth > 0)`)) break; } catch (e) { } await sleep(300); }
  await sleep(400);
  await evaluate(`(async () => {
    const th = document.querySelector('img.copy-thumb');
    th.scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 200));
    th.click();
    await new Promise(r => setTimeout(r, 900));
    return true;
  })()`);
  const vp = await evaluate(`({ w: innerWidth, h: innerHeight })`);
  return { cx: Math.round(vp.w / 2), cy: Math.round(vp.h / 2), vp };
}

console.log('目标: ' + BASE);
const DX = 150;

// ══════════════ 第 1 轮：不开触摸模拟 → 鼠标用例 ══════════════
console.log('\n########## 第 1 轮（未开触摸模拟）：鼠标拖动 ##########');
{
  const { cx, cy } = await loadAndOpenModal();
  const opened = await state();
  console.log('  · 打开后: ' + JSON.stringify(opened));
  chk('前置：打开的是双面图', opened.multi === true, JSON.stringify(opened));
  chk('前置：这一轮页面确实没有触摸能力（' + "ontouchstart" + ' 不存在）', opened.touch === false, JSON.stringify(opened));

  console.log('\n=== A. 鼠标横向拖动（未放大）→ 不翻面、不误关弹窗 ===');
  const a0 = await state();
  await dragMouse(cx + DX / 2, cy, cx - DX / 2, cy);
  await sleep(500);
  const a1 = await state();
  console.log(`  side ${a0.side} → ${a1.side}；show=${a1.show}`);
  chk('鼠标拖动不触发翻面', a1.side === a0.side, `side ${a0.side} → ${a1.side}`);
  chk('鼠标拖动之后弹窗仍然开着（没有误触发"点哪儿都关"）', a1.show === true, JSON.stringify(a1));
}

// ══════════════ 第 2 轮：先开触摸模拟，再加载页面 ══════════════
console.log('\n########## 第 2 轮（触摸模拟已开）：滑动翻面 ##########');
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const { cx, cy, vp } = await loadAndOpenModal();
const opened2 = await state();
console.log('  · 打开后: ' + JSON.stringify(opened2));
console.log(`  · 视口 ${vp.w}×${vp.h}，手势中心 (${cx}, ${cy})`);
chk('前置：双面图', opened2.multi === true, JSON.stringify(opened2));
chk('前置：这一轮页面有触摸能力（Hammer 会注册 TouchInput）', opened2.touch === true, JSON.stringify(opened2));
chk('前置：弹窗已显示、缩放为 1', opened2.show && opened2.scale === 1, JSON.stringify(opened2));

console.log('\n=== B. 手指左滑 → 翻到另一面 ===');
{
  const b0 = await state();
  await swipeTouch(cx + DX / 2, cy, cx - DX / 2, cy);
  await sleep(700);
  const b1 = await state();
  console.log(`  side ${b0.side} → ${b1.side}；busy=${b1.busy}`);
  chk('左滑触发了翻面（当前面变了）', b1.side !== b0.side, `side ${b0.side} → ${b1.side}`);
  chk('翻面动画已结束（busy 归位）', b1.busy === false, JSON.stringify(b1));
  chk('左滑之后弹窗仍然开着', b1.show === true, JSON.stringify(b1));
}

console.log('\n=== C. 手指右滑 → 翻回原来那一面 ===');
{
  const c0 = await state();
  await swipeTouch(cx - DX / 2, cy, cx + DX / 2, cy);
  await sleep(700);
  const c1 = await state();
  console.log(`  side ${c0.side} → ${c1.side}`);
  chk('右滑同样触发翻面（能翻回去）', c1.side !== c0.side, `side ${c0.side} → ${c1.side}`);
}

console.log('\n=== D. 手指竖滑 → 不翻面（Swipe 限定横向） ===');
{
  const d0 = await state();
  await swipeTouch(cx, cy + DX / 2, cx, cy - DX / 2);
  await sleep(700);
  const d1 = await state();
  console.log(`  side ${d0.side} → ${d1.side}`);
  chk('竖滑不触发翻面', d1.side === d0.side, `side ${d0.side} → ${d1.side}`);
  chk('竖滑之后弹窗仍然开着', d1.show === true, JSON.stringify(d1));
}

console.log('\n=== E. 放大到 2 倍后横滑 → 不翻面（那是看图片另一部分） ===');
{
  await evaluate(`(function(){
    currentScale = 2;
    document.getElementById('imageContainer').style.transform = 'translate3d(0px,0px,0px) scale3d(2,2,1)';
    return true;
  })()`);
  await sleep(150);
  const e0 = await state();
  await swipeTouch(cx + DX / 2, cy, cx - DX / 2, cy);
  await sleep(700);
  const e1 = await state();
  console.log(`  scale=${e0.scale}；side ${e0.side} → ${e1.side}`);
  chk('放大状态下横滑不翻面', e1.side === e0.side, `side ${e0.side} → ${e1.side}`);
  await evaluate(`(function(){
    currentScale = 1; currentX = 0; currentY = 0;
    document.getElementById('imageContainer').style.transform = 'translate3d(0px,0px,0px) scale3d(1,1,1)';
    return true;
  })()`);
  await sleep(150);
}

console.log('\n=== F. 单面图横滑 → 不翻面（没有另一面可翻） ===');
{
  await evaluate(`(function(){ openModal(currentModalImg1, ''); return true; })()`);
  await sleep(900);
  const f1 = await state();
  await swipeTouch(cx + DX / 2, cy, cx - DX / 2, cy);
  await sleep(700);
  const f2 = await state();
  console.log(`  multi=${f1.multi}；side ${f1.side} → ${f2.side}`);
  chk('前置：确实是单面图', f1.multi === false, JSON.stringify(f1));
  chk('单面图横滑不翻面', f2.side === f1.side, `side ${f1.side} → ${f2.side}`);
}

console.log('\n=== G. 放大到 3 倍后关闭 → 缩回动画必须从放大状态起飞（不能先跳回原始大小） ===');
{
  // 用户报告："图片放大后点击关闭，会突变变回正常大小后再出现关闭动画"。
  // 根因是 closeModal 里飞行图层的起飞矩形写死成未放大的 contain 矩形。
  // 这里量的是飞行图层的**第一帧**：它应该等于放大后的图片矩形，而不是 1 倍时的矩形。
  await evaluate(`(function(){
    currentScale = 1; currentX = 0; currentY = 0;
    document.getElementById('imageContainer').style.transform = 'translate3d(0px,0px,0px) scale3d(1,1,1)';
    return true;
  })()`);
  await sleep(250);
  const fit = await evaluate(`(function(){
    const r = imageContentRect(document.getElementById('modalImg'));
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  await evaluate(`(function(){
    currentScale = 3; currentX = 0; currentY = 0;
    document.getElementById('imageContainer').style.transform = 'translate3d(0px,0px,0px) scale3d(3,3,1)';
    return true;
  })()`);
  await sleep(300);
  const zoomed = await evaluate(`(function(){
    const r = imageContentRect(document.getElementById('modalImg'));
    return { w: Math.round(r.width), h: Math.round(r.height),
             cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
  })()`);
  // 关掉，并在同一个同步块里量飞行图层的第一帧
  const flight = await evaluate(`(function(){
    closeModal();
    const el = document.querySelector('img.modal-flight');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
             cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
  })()`);
  console.log(`  1 倍时 ${fit.w}x${fit.h}；3 倍时 ${zoomed.w}x${zoomed.h}；飞行图层第一帧 ` +
              (flight ? `${flight.w}x${flight.h}` : '（没生成飞行图层）'));
  chk('前置：确实放大到了 3 倍', zoomed.w > fit.w * 2.5, `1 倍 ${fit.w}px → 3 倍 ${zoomed.w}px`);
  chk('关闭时生成了缩回飞行图层（说明没被 reduced-motion 短路）', !!flight, '没拿到 img.modal-flight');
  if (flight) {
    chk('★ 飞行图层从放大后的尺寸起飞，而不是先跳回 1 倍',
        flight.w > fit.w * 2,
        `飞行起始宽 ${flight.w}px；1 倍是 ${fit.w}px、放大后是 ${zoomed.w}px —— 若接近 ${fit.w} 就是"突变"`);
    chk('★ 起飞尺寸与放大后的尺寸一致（等比缩回，无跳变）',
        Math.abs(flight.w - zoomed.w) <= zoomed.w * 0.12,
        `飞行 ${flight.w}px vs 放大后 ${zoomed.w}px`);
    chk('★ 起飞位置就是放大后图片所在的位置',
        Math.abs(flight.cx - zoomed.cx) <= zoomed.w * 0.12 && Math.abs(flight.cy - zoomed.cy) <= zoomed.h * 0.12,
        `飞行中心 (${flight.cx},${flight.cy})；放大后中心 (${zoomed.cx},${zoomed.cy})`);
  }
  await sleep(1400);
  const g1 = await state();
  chk('缩回结束后弹窗确实关掉了', g1.show === false, JSON.stringify(g1));
}

console.log('\n================ 汇总 ================');
console.log(fail === 0 ? '🟢 滑动翻面全部通过' : `🔴 ${fail} 项失败`);
ws.close(); child.kill(); server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => { });
process.exit(fail ? 1 : 0);
