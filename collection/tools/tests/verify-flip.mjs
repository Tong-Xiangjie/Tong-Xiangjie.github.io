// 图片灯箱：翻面动画 + 翻面之后退出动画 的验证（真实 Chrome）
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
const BASE = TARGET_URL || `http://127.0.0.1:${PORT}/collection/`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(path.join(tmpdir(), 'cdpFlip-'));
const DP = 9443;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
async function wsUrlOf() { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch (e) {} await new Promise(r => setTimeout(r, 250)); } throw new Error('CDP 未就绪'); }
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
const warns = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(m.params.type)) {
    warns.push(m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 140));
  }
});

let fail = 0;
const chk = (label, ok, detail) => {
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}` + (ok ? '' : `\n      ${detail}`));
};
const eq = (label, got, want) => chk(label, JSON.stringify(got) === JSON.stringify(want), `got  = ${JSON.stringify(got)}\n      want = ${JSON.stringify(want)}`);

console.log('目标: ' + BASE);
await send('Page.navigate', { url: BASE + '?f=' + Date.now() });
for (let i = 0; i < 150; i++) {
  await new Promise(r => setTimeout(r, 320));
  try { if (await evaluate(`typeof openModal === 'function' && document.querySelectorAll('img.copy-thumb, img.mini-thumb').length > 0`)) break; } catch (e) {}
}
// 进 rmb3 分类（条目缩略图最多，正反面成对）
await evaluate(`onSidebarItemClick && enterNotesOrCoinsTab ? (function(){
  try { goto('notes/rmb/rmb3'); } catch(e) {}
})() : null`);
await evaluate(`location.hash = '#notes/rmb/rmb3'`);
for (let i = 0; i < 80; i++) {
  await new Promise(r => setTimeout(r, 320));
  try { if (await evaluate(`document.querySelectorAll('img.copy-thumb').length > 0`)) break; } catch (e) {}
}
// 等到至少一张缩略图真的解码出来（懒加载 + naturalWidth>0），否则点它等于点空
for (let i = 0; i < 60; i++) {
  try { if (await evaluate(`[...document.querySelectorAll('img.copy-thumb')].some(e => e.complete && e.naturalWidth > 0)`)) break; } catch (e) {}
  await new Promise(r => setTimeout(r, 320));
}
await new Promise(r => setTimeout(r, 600));
const scene = await evaluate(`({
  hash: location.hash,
  thumbs: document.querySelectorAll('img.copy-thumb').length,
  placeholders: document.querySelectorAll('div.copy-thumb.no-img').length,
  firstTwoSrc: [...document.querySelectorAll('img.copy-thumb')].slice(0,2).map(e => e.getAttribute('src'))
})`);
console.log('  · 场景: ' + JSON.stringify(scene));

// ---------- 1. 打开时必须先「生长」出来（前置条件，说明来源被记录） ----------
console.log('\n=== 1. 点击缩略图 → 生长动画（前置条件） ===');
const opened = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const th = document.querySelector('img.copy-thumb');
  if (!th) return { err: '没有缩略图' };
  th.scrollIntoView({ block: 'center' });
  await s(200);
  th.click();
  // 在飞行动画窗口内取样
  await s(90);
  const mid = {
    flightEl: !!document.querySelector('.modal-flight'),
    multiImg: document.getElementById('imageModal').classList.contains('multi-img'),
    imgOpacity: document.getElementById('modalImg').style.opacity,
    sourceRecorded: !!lastModalSourceImg
  };
  await s(600);
  return mid;
})()`);
if (opened.err) { console.log('  ✗ ' + opened.err); process.exit(1); }
console.log('  · 开启动画中途: ' + JSON.stringify(opened));
chk('打开时存在飞行图层（生长动画）', opened.flightEl, JSON.stringify(opened));
chk('弹窗是双图（有翻面按钮）', opened.multiImg, JSON.stringify(opened));
chk('记录了来源缩略图', opened.sourceRecorded, JSON.stringify(opened));

// ★ 等"另一面"的原图预热完成再点翻面。
//   openModal 会在弹窗显示后顺手预热另一面（见 category-view.js），但线上那张
//   原图 3739×2117，冷缓存下要 ~800ms 才下载完。测试若在预热还没完成时就猛点
//   翻面，量到的是"网络下载"而不是"翻面动画"。真实用户点开图片到去翻面，
//   间隔远大于 800ms。所以这里显式等预热落定，把变量隔离掉。
const preload = await evaluate(`(async () => {
  const url = currentModalImg2;
  if (!url) return { waited: 0, ready: false, note: '单面图' };
  const t0 = performance.now();
  const ready = await new Promise(res => {
    const im = new Image();
    const done = () => res(true);
    im.onload = done;
    im.onerror = done;                       // 图缺失也要放行
    im.src = url;
    if (im.complete) res(true);              // 已在缓存里：同步就绪
    setTimeout(() => res(false), 15000);      // 上限，别把测试挂死
  });
  return { waited: Math.round(performance.now() - t0), ready };
})()`);
console.log('  · 另一面预热: ' + JSON.stringify(preload));

const beforeFlip = await evaluate(`({
  side: currentModalSide,
  src: (document.getElementById('modalImg').currentSrc || document.getElementById('modalImg').src).split('/').slice(-2).join('/'),
  overlaySrc: document.getElementById('modalImgOverlay').getAttribute('src'),
  overlayClasses: document.getElementById('modalImgOverlay').className
})`);
console.log('  · 翻面前: ' + JSON.stringify(beforeFlip));

// ---------- 2. 翻面必须有动画 ----------
console.log('\n=== 2. 点「看另一面」→ 必须有翻面动画 ===');
const flip = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalImg');
  const overlay = document.getElementById('modalImgOverlay');
  const seen = [];
  const sample = tag => seen.push({ tag,
    busy: modalFlipBusy,
    modalFlipping: modal.classList.contains('modal-flipping'),
    imgClasses: img.className,
    overlayClasses: overlay.className,
    overlayHasSrc: !!overlay.getAttribute('src'),
    imgHasInlineAnim: !!img.style.animation && img.style.animation !== 'none'
  });
  sample('t0');
  // 插桩：看主图的 load/error 到底有没有在这段时间里发生
  const loadEvts = [];
  const t0ev = performance.now();
  const onL = () => loadEvts.push({ ev: 'load', at: Math.round(performance.now() - t0ev), src: (img.currentSrc || img.src).split('/').slice(-1)[0] });
  const onE = () => loadEvts.push({ ev: 'error', at: Math.round(performance.now() - t0ev), src: (img.currentSrc || img.src).split('/').slice(-1)[0] });
  img.addEventListener('load', onL);
  img.addEventListener('error', onE);
  // 触屏/鼠标点击同一个处理：直接调 modalFlip 之外，也走一次真实按钮点击
  document.getElementById('modalNavNext').click();
  // ★ 起点必须**点击之后立刻同步**采样：此时按钮的 click 处理器已经跑完
  //   （busy=true / flip-out 已挂上），但 90ms 的第一半还没走完。
  sample('t0-after-click');
  // ★ 后半（flip-in）什么时候出现由**新图解码就绪**决定，不是固定时刻：
  //   新面要现下载解码，慢的话会晚于第一半。所以这里高密度轮询记录
  //   "是否观察到 flip-in"，而不是押注某一个时间点。
  let sawFlipIn = false, flipInWhileBusy = false, settledAt = -1, flipInAt = -1;
  const t0ms = performance.now();
  // 用 rAF 计数而不是 setInterval 计时：headless 里后台页面的 setInterval
  // 会被钳制到 ~1000ms 一次，拿它测"某一帧的类名"必然漏采样。
  let rafAt = -1;
  (function raf() {
    if (rafAt < 0 && img.classList.contains('flip-in')) rafAt = Math.round(performance.now() - t0ms);
    if (rafAt < 0) requestAnimationFrame(raf);
  })();
  for (let i = 0; i < 120; i++) {
    await s(25);
    const hasIn = img.classList.contains('flip-in');
    if (hasIn && !sawFlipIn) { sawFlipIn = true; flipInWhileBusy = modalFlipBusy; }
    if (hasIn && !modalFlipBusy) { settledAt = Math.round(performance.now() - t0ms); break; }
  }
  img.removeEventListener('load', onL);
  img.removeEventListener('error', onE);
  // 再等一会，让展开动画（90ms）走完
  await s(220);
  // 展开动画播完后，flip-in 这个类**会留着**（动画 fill 到终态），
  // 由下次打开/关闭时的 finish() 清理；这里断言的是"没有压扁残留"。
  sample('settled');
  return { seen, sawFlipIn, flipInWhileBusy, settledAt, flipInAt: rafAt, loadEvts,
    side: currentModalSide,
    finalSrc: (img.currentSrc || img.src).split('/').slice(-2).join('/'),
    finalImgClasses: img.className,
    finalOverlaySrc: overlay.getAttribute('src'),
    finalFullReady: modalFullReady };
})()`);
for (const x of flip.seen) console.log('  · ' + JSON.stringify(x));
console.log('  · 翻面后: side=' + flip.side + ' src=' + flip.finalSrc + ' classes=' + flip.finalImgClasses + ' overlaySrc=' + flip.finalOverlaySrc);
console.log('  · flip-in 出现=' + flip.sawFlipIn + ' 出现时仍 busy=' + flip.flipInWhileBusy +
  ' flip-in首现=' + flip.flipInAt + 'ms 收尾耗时=' + flip.settledAt + 'ms');
console.log('  · 主图 load/error 事件: ' + JSON.stringify(flip.loadEvts));

const t0b = flip.seen[1], settled = flip.seen[2];
chk('起点：标记为翻面中', t0b.busy && t0b.modalFlipping, JSON.stringify(t0b));
chk('起点：主图挂着 flip-out（正在压扁）', t0b.imgClasses.includes('flip-out'), JSON.stringify(t0b));
chk('起点：浮层不参与翻面（不挂 flip-out、不接手旧图）',
  !t0b.overlayClasses.includes('flip-out') && !t0b.overlayHasSrc, JSON.stringify(t0b));
chk('后半：观察到主图挂 flip-in（正在展开）', flip.sawFlipIn, JSON.stringify(flip));
// ★ 不直接断言"flip-in 出现时 busy 仍为 true"：onReady 的最后一步就是把 busy
//   清掉，紧接着才 add('flip-in')，所以外部能观察到时 busy 已经是 false —— 断言
//   那个只会测到实现顺序，测不到行为。改断言"确实是被就绪事件及时放行的"：
//   第一半在 130ms 结束，兜底定时器要 1200ms 后才放行；整轮在 600ms 内收尾，
//   说明走的是"解码就绪"这条路，而不是兜底。（实测约 150ms）
chk('后半：由解码就绪及时放行（不是 1200ms 兜底兜的）', flip.sawFlipIn && flip.settledAt > 0 && flip.settledAt < 600,
  `settledAt=${flip.settledAt} 首现flip-in=${flip.flipInAt}ms`);
chk('收尾：翻面标记已清、无压扁残留',
  !settled.busy && !settled.modalFlipping && !settled.imgClasses.includes('flip-out') && !settled.imgHasInlineAnim,
  JSON.stringify(settled));
chk('收尾：浮层已清空（不会留残影）', !settled.overlayHasSrc && !settled.overlayClasses.includes('flip-'), JSON.stringify(settled));
chk('确实换到了另一面（src 变了）', flip.finalSrc !== beforeFlip.src, `before=${beforeFlip.src} after=${flip.finalSrc}`);
chk('当前面 = 2', flip.side, flip.side === 2 ? '' : 'side=' + flip.side);

// ---------- 3. 翻面之后再退出，必须有缩回动画（本轮修的 bug #1） ----------
console.log('\n=== 3. 翻面之后点关闭 → 必须有缩回动画（本轮修复点） ===');
const closed = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalImg');
  const seen = [];
  const sample = tag => {
    const ovE = document.getElementById('modalImgOverlay');
    const ovCs = getComputedStyle(ovE);
    const ovR = ovE.getBoundingClientRect();
    // ★ 关键：主图在关闭动画期间**实际**渲染出来的不透明度。
    //   曾经的 bug：.modal-img.flip-in 是 forwards 填充的 CSS 动画，动画终态含
    //   opacity:1，而 CSS 动画优先级高于内联样式 —— closeModal 里设的
    //   modalImg.style.opacity='0' 被压掉，于是缩回动画期间一张全尺寸反面大图
    //   原地静止，直到 finish() 摘掉 flip-in 才消失。
    //   注意：只断言 "内联 opacity===0" 是抓不到的（内联值一直是 0），必须看 computed。
    const cs = getComputedStyle(img);
    const r = img.getBoundingClientRect();
    const paintedFullSize = (img.getAttribute('src') || img.src) &&
      Number(cs.opacity) > 0.01 && r.width > 200 && r.height > 200;
    seen.push({ tag,
      flightEl: !!document.querySelector('.modal-flight'),
      imgOpacity: img.style.opacity,
      imgComputedOpacity: cs.opacity,
      imgW: Math.round(r.width), imgH: Math.round(r.height),
      imgClasses: img.className,
      imgPaintedFullSize: paintedFullSize,
      modalHide: modal.classList.contains('modal-hiding') || modal.classList.contains('modal-hide'),
      display: modal.style.display,
      overlayBusy: {
        src: ovE.getAttribute('src') ? '有' : '(空)',
        opacity: ovCs.opacity,
        w: Math.round(ovR.width), h: Math.round(ovR.height)
      }
    });
  };
  sample('t0');
  closeModal();
  sample('t0-after-close');   // 关闭瞬间（同步）
  await s(60);  sample('t60');
  await s(200); sample('t260');
  await s(300); sample('t560');
  await s(200); sample('t760');
  return { seen, display: modal.style.display,
    overlaySrc: document.getElementById('modalImgOverlay').getAttribute('src'),
    imgTransform: img.style.transform, imgAnimation: img.style.animation,
    imgClasses: img.className, busy: modalFlipBusy };
})()`);
for (const t of closed.seen) console.log('  · ' + JSON.stringify(t));
const cAfter = closed.seen[1], c60 = closed.seen[2], c260 = closed.seen[3];
chk('关闭时出现了飞行图层（= 缩回缩略图，不是整体淡出）', c60.flightEl, JSON.stringify(closed.seen));
// ★ 这一条是本次 bug 的核心闸门：关闭期间主图必须**真的**不可见。
//   flip-in 的 forwards 填充会把它钉在 opacity:1 上（内联 opacity=0 无效）。
chk('★ 关闭一开始主图就真的不可见（不能被 flip-in 的 forwards 钉住）',
  !cAfter.imgPaintedFullSize, 'computedOp=' + cAfter.imgComputedOpacity + ' 尺寸=' + cAfter.imgW + 'x' + cAfter.imgH + ' 类=' + cAfter.imgClasses);
chk('★ 缩回期间主图仍然不可见（否则会与飞行图层重影）',
  !c60.imgPaintedFullSize, 'computedOp=' + c60.imgComputedOpacity + ' 尺寸=' + c60.imgW + 'x' + c60.imgH + ' 类=' + c60.imgClasses);
chk('★ 关闭一开始主图上的翻面动画类已摘掉（flip-in 的 forwards 是残影来源）',
  !cAfter.imgClasses.includes('flip-'), '类=' + cAfter.imgClasses);
// 浮层的可见性判据：**有 src 且被渲染成"全尺寸/不透明"** 才是残影。
// 注意：浮层没有 src 时，computed opacity 是 CSS 基础值 0.25、transform 是压扁的
// scale3d(0.06,1,1) —— 那是设计值（"无动画时的静默态"），没有内容可绘制，
// 不等于可见。所以不能断言 opacity===0。
const ghostOf = o => o.src === '有' && Number(o.opacity) > 0.01 && o.w > 200;
chk('★ 关闭一开始浮层就没有图（否则缩回期间会多一张静止大图）',
  cAfter.overlayBusy.src === '(空)', JSON.stringify(cAfter.overlayBusy));
chk('★ 缩回中途浮层也没有残影',
  c60.overlayBusy.src === '(空)' && !ghostOf(c60.overlayBusy), JSON.stringify(c60.overlayBusy));
chk('蒙版同时在淡出', c60.modalHide, JSON.stringify(c60));
chk('动画结束后弹窗真正隐藏', closed.display === 'none', 'display=' + closed.display);
chk('结束后浮层已清空', !closed.overlaySrc, 'overlaySrc=' + closed.overlaySrc);
chk('结束后主图无残留 transform（否则下次打开第一眼是压扁的）', !closed.imgTransform, 'transform=' + closed.imgTransform);
chk('结束后主图无残留 animation', !closed.imgAnimation, 'animation=' + closed.imgAnimation);
chk('结束后主图无残留动画类', !closed.imgClasses.includes('flip-'), 'classes=' + closed.imgClasses);
chk('结束后翻面标记已复位（下次还能翻）', !closed.busy, 'busy=' + closed.busy);

// ---------- 4. 再打开、再翻面、再关闭：状态必须完全复原 ----------
console.log('\n=== 4. 第二次完整流程（确认状态没被上一次污染） ===');
const second = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const th = document.querySelector('img.copy-thumb');
  th.scrollIntoView({ block: 'center' });
  await s(250);
  th.click();
  await s(700);
  const grown = { flightElSeen: true, side: currentModalSide };
  const growOverlaySrc = document.getElementById('modalImgOverlay').getAttribute('src');
  document.getElementById('modalNavNext').click();
  await s(500);
  const flippedSide = currentModalSide;
  closeModal();
  await s(80);
  const flightEl = !!document.querySelector('.modal-flight');
  await s(700);
  return { grown, growOverlaySrc, flippedSide, flightEl,
    display: document.getElementById('imageModal').style.display };
})()`);
console.log('  · ' + JSON.stringify(second));
chk('第二次打开后当前面回到 1', second.grown.side === 1, 'side=' + second.grown.side);
chk('第二次打开时浮层是空的（没有上一次的残影）', !second.growOverlaySrc, 'overlaySrc=' + second.growOverlaySrc);
chk('第二次翻面成功', second.flippedSide === 2, 'side=' + second.flippedSide);
chk('第二次关闭仍有缩回动画', second.flightEl, JSON.stringify(second));
chk('第二次关闭后弹窗隐藏', second.display === 'none', 'display=' + second.display);

// ---------- 5. 动画进行中连点，不能叠加成闪烁 ----------
console.log('\n=== 5. 翻面动画进行中连点，必须被忽略 ===');
const spam = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const th = document.querySelector('img.copy-thumb');
  th.scrollIntoView({ block: 'center' });
  await s(250);
  th.click();
  await s(700);
  const side0 = currentModalSide;
  document.getElementById('modalNavNext').click();   // 第 1 次：受理
  await s(20);
  const acceptedSecond = modalFlip(1);               // 动画中：应被拒绝
  const acceptedThird = modalFlip(1);
  await s(600);
  const sideAfter = currentModalSide;
  const busyAfter = modalFlipBusy;
  closeModal(); await s(700);
  return { side0, acceptedSecond, acceptedThird, sideAfter, busyAfter };
})()`);
console.log('  · ' + JSON.stringify(spam));
chk('动画中的连点被拒绝', spam.acceptedSecond === false && spam.acceptedThird === false, JSON.stringify(spam));
chk('只翻了一次（side 从 1 到 2）', spam.side0 === 1 && spam.sideAfter === 2, JSON.stringify(spam));
chk('结束后标记复位', spam.busyAfter === false, 'busy=' + spam.busyAfter);

// ---------- 6. 翻面动画中途关闭，也必须干净收场 ----------
console.log('\n=== 6. 翻面动画中途关闭（最容易漏的边界） ===');
const midClose = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const th = document.querySelector('img.copy-thumb');
  th.scrollIntoView({ block: 'center' });
  await s(250);
  th.click();
  await s(700);
  document.getElementById('modalNavNext').click();   // 开始翻面
  await s(30);                                        // 第一半还没结束
  closeModal();                                       // 立刻关闭
  await s(800);
  const modal = document.getElementById('imageModal');
  const img = document.getElementById('modalImg');
  return { display: modal.style.display, busy: modalFlipBusy,
    imgTransform: img.style.transform, imgAnimation: img.style.animation,
    imgClasses: img.className, overlaySrc: document.getElementById('modalImgOverlay').getAttribute('src'),
    modalFlipping: modal.classList.contains('modal-flipping') };
})()`);
console.log('  · ' + JSON.stringify(midClose));
chk('中途关闭：弹窗隐藏', midClose.display === 'none', JSON.stringify(midClose));
chk('中途关闭：翻面标记复位（否则再也翻不了面）', midClose.busy === false, JSON.stringify(midClose));
chk('中途关闭：无残留 transform', !midClose.imgTransform, 'transform=' + midClose.imgTransform);
chk('中途关闭：无残留 animation', !midClose.imgAnimation, 'animation=' + midClose.imgAnimation);
chk('中途关闭：浮层已清空', !midClose.overlaySrc, 'overlaySrc=' + midClose.overlaySrc);
chk('中途关闭：modal-flipping 已移除', midClose.modalFlipping === false, JSON.stringify(midClose));

// 还能再打开并翻面
const recovered = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const th = document.querySelector('img.copy-thumb');
  th.scrollIntoView({ block: 'center' });
  await s(250);
  th.click(); await s(700);
  const ok = modalFlip(1);
  await s(600);
  const side = currentModalSide;
  closeModal(); await s(700);
  return { ok, side };
})()`);
chk('中途关闭之后：还能正常打开并翻面', recovered.ok === true && recovered.side === 2, JSON.stringify(recovered));

// ---------- 7. 键盘左右方向键仍能翻面 ----------
console.log('\n=== 7. 键盘 ←/→ 仍能翻面 ===');
const kb = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const th = document.querySelector('img.copy-thumb');
  th.scrollIntoView({ block: 'center' });
  await s(250);
  th.click(); await s(700);
  const side0 = currentModalSide;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  await s(600);
  const side1 = currentModalSide;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  await s(600);
  const side2 = currentModalSide;
  closeModal(); await s(700);
  return { side0, side1, side2 };
})()`);
console.log('  · ' + JSON.stringify(kb));
chk('方向键 → 翻到反面', kb.side0 === 1 && kb.side1 === 2, JSON.stringify(kb));
chk('方向键 ← 翻回正面', kb.side2 === 1, JSON.stringify(kb));

// ---------- 8. 单面图（文章配图）不得出现翻面按钮，也不得被翻面逻辑影响 ----------
console.log('\n=== 8. 单面图（正反面同一张）不应有翻面按钮 ===');
const single = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const thumb = document.querySelector('img.copy-thumb');
  const src = thumb.getAttribute('src');
  openModal(src, src);
  await s(600);
  const modal = document.getElementById('imageModal');
  const res = { multiImg: modal.classList.contains('multi-img'), flipReturn: modalFlip(1) };
  closeModal(); await s(700);
  return res;
})()`);
console.log('  · ' + JSON.stringify(single));
chk('单面图没有 multi-img（按钮显示不出来）', single.multiImg === false, JSON.stringify(single));
chk('单面图调用翻面直接返回 false', single.flipReturn === false, JSON.stringify(single));

// ---------- 9. 首选减少动效时：不做动画但功能必须正常 ----------
console.log('\n=== 9. prefers-reduced-motion 下功能仍正常 ===');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
const reduced = await evaluate(`(async () => {
  const s = ms => new Promise(r => setTimeout(r, ms));
  const th = document.querySelector('img.copy-thumb');
  th.scrollIntoView({ block: 'center' });
  await s(250);
  th.click(); await s(700);
  const overlayBefore = document.getElementById('modalImgOverlay').getAttribute('src');
  const ok = modalFlip(1);
  await s(500);
  const side = currentModalSide;
  const overlayDuring = document.getElementById('modalImgOverlay').getAttribute('src');
  closeModal(); await s(700);
  const flightEl = !!document.querySelector('.modal-flight');
  return { overlayBefore, ok, side, overlayDuring, flightEl };
})()`);
console.log('  · ' + JSON.stringify(reduced));
chk('减少动效：翻面仍然切换成功', reduced.ok === true && reduced.side === 2, JSON.stringify(reduced));
chk('减少动效：不启用翻面浮层', !reduced.overlayBefore && !reduced.overlayDuring, JSON.stringify(reduced));
chk('减少动效：不做飞行/缩回动画', reduced.flightEl === false, JSON.stringify(reduced));
await send('Emulation.setEmulatedMedia', { features: [] });

console.log('\n================ 汇总 ================');
console.log(fail === 0 ? '🟢 翻面与退出动画全部通过' : `🔴 ${fail} 项失败`);
console.log('console.warn/error: ' + (warns.length ? warns.slice(0, 6).join(' | ') : '（无）'));
ws.close(); child.kill(); if (server) server.close();
await rm(userDir, { recursive: true, force: true }).catch(() => {});
process.exit(fail === 0 ? 0 : 1);
