// ==================== verify-lightbox-close.mjs ====================
// 「弹窗可滚动，但右上角 × 不应随滚动移动」（用户报的）。
//
// 根因：三个灯箱（详细信息 / 八面图 / 专题）的卡片**自己**是滚动容器
//   （overflow-y:auto），而 × 是卡片的 absolute 子元素 —— 绝对定位的基准是卡片的
//   padding box，它属于"被滚动的内容坐标"，所以内容一滚 × 就跟着上去了。
// 修法：滚动从卡片挪到内容区（.info-lightbox-content / .octo-grid /
//   .special-lightbox-content），卡片改成 overflow:hidden 的 flex 竖列，× 钉在卡片上。
//
// 图片大图弹窗（.modal-close）本来就是 position:fixed，不在滚动容器里，一起回归。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { shotViewport, maxChanDiff } from './lib/pixel.mjs';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

// ══════════════════════════════════════════════════════════════
console.log('══════ ① 静态：卡片不滚、内容区滚、× 在卡片里 ══════\n');
const css = readFileSync('collection/layout.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const specialJs = readFileSync('collection/special.js', 'utf8');
const block = name => css.match(new RegExp('\\' + name + '\\s*\\{[^}]*\\}'))?.[0] || '';
for (const [card, content, human] of [
  ['.info-lightbox-inner', '.info-lightbox-content', '详细信息'],
  ['.octo-inner', '.octo-grid', '八面图'],
  ['.special-lightbox-inner', '.special-lightbox-content', '专题'],
]) {
  const cb = block(card), ob = block(content);
  ok(/overflow\s*:\s*hidden/.test(cb) && !/overflow-y\s*:\s*auto/.test(cb),
    `① ${human}灯箱：卡片自己不滚（overflow:hidden）`);
  ok(/display\s*:\s*flex/.test(cb) && /flex-direction\s*:\s*column/.test(cb),
    `① ${human}灯箱：卡片是竖列 flex（内容区才能拿到剩余高度并滚动）`);
  ok(/overflow-y\s*:\s*auto/.test(ob) && /min-height\s*:\s*0/.test(ob),
    `① ${human}灯箱：内容区才是滚动容器（min-height:0 是 flex 能收缩的关键）`);
}
ok(/max-height\s*:\s*90vh/.test(specialJs) && !/overflow-y:auto/.test(specialJs.match(/special-lightbox-inner';[\s\S]{0,60}/)?.[0] || 'x'),
  '① 专题灯箱的内联样式里也去掉了 overflow-y:auto（内联优先级比 CSS 高，不改就白改）');
ok(/\.lightbox-close\s*\{[^}]*position\s*:\s*absolute/.test(css) && /\.lightbox-close\s*\{[^}]*background\s*:\s*var\(--card-bg\)/.test(css),
  '① × 仍是卡片内的 absolute，并且有和卡片同色的底（内容从底下滚过也看得清）');
ok(/\.modal-close\s*\{[^}]*position\s*:\s*fixed/.test(css), '① 图片大图弹窗的 × 仍是 position:fixed（本来就没问题）');

// ══════════════════════════════════════════════════════════════
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpClose-'));
const DP = 15200 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,700', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || '')); if (m.method === 'Fetch.requestPaused') onPaused(m.params); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
await send('Runtime.enable');
await send('Page.enable');
// CI 的 runner 默认关系统动画 → Chrome 报 reduce，这里量的不是动画，钉死成 no-preference 保持一致
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
// 视口压矮一点：卡片 max-height 是 88vh，内容容易真的滚起来（不靠注入也算真场景）
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 620, deviceScaleFactor: 1, mobile: false });

async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof viewScrollContainers!=='undefined' && Object.keys(viewScrollContainers).length>0 && document.readyState==='complete' && typeof copyDetailList!=='undefined')()`).catch(() => false);
    if (r) break;
    await sleep(300);
  }
  await sleep(1800);
}
await boot('notes/commemorative');
let idx = -1;
for (let i = 0; i < 30; i++) {
  idx = await evaluate(`(()=>{ if (typeof copyDetailList === 'undefined') return -1;
    return copyDetailList.findIndex(x => x.copy && String(x.copy.version) === 'KP04057'); })()`).catch(() => -1);
  if (idx >= 0) break;
  await sleep(200);
}

// ══════════════════════════════════════════════════════════════
// 核心检查：把内容撑高 → 滚 → × 的屏幕坐标必须一动不动
async function checkNoMove(human, cardSel, scrollSel, closeSel) {
  const R = JSON.parse(await evaluate(`(()=>{
    const card = document.querySelector('${cardSel}');
    const sc = document.querySelector('${scrollSel}');
    const btn = document.querySelector('${closeSel}');
    if (!card || !sc || !btn) return JSON.stringify({ err: '结构没找到 card=' + !!card + ' sc=' + !!sc + ' btn=' + !!btn });
    // 内容不够高就垫一块（这是布局契约：容器滚起来时 × 不能动）
    let pad = document.getElementById('__tallpad');
    if (!pad) { pad = document.createElement('div'); pad.id = '__tallpad';
      pad.style.cssText = 'height:1500px; flex:none;'; sc.appendChild(pad); }
    const cr = card.getBoundingClientRect(), br = btn.getBoundingClientRect();
    const cc = getComputedStyle(card), scs = getComputedStyle(sc), bs = getComputedStyle(btn);
    return JSON.stringify({ 卡片overflowY: cc.overflowY, 内容overflowY: scs.overflowY, closePosition: bs.position,
      能滚: sc.scrollHeight > sc.clientHeight + 1,
      之前scrollTop: Math.round(sc.scrollTop),
      closeBtn: [Math.round(br.left), Math.round(br.top), Math.round(br.right), Math.round(br.bottom)],
      卡片: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.right), Math.round(cr.bottom)],
      卡片高: Math.round(cr.height), 内容可视高: Math.round(sc.clientHeight), 内容总高: Math.round(sc.scrollHeight) });
  })()`));
  if (R.err) { ok(false, `${human}：${R.err}`); return; }
  const after = JSON.parse(await evaluate(`(()=>{
    const sc = document.querySelector('${scrollSel}');
    sc.scrollTop = Math.min(400, sc.scrollHeight - sc.clientHeight);
    const btn = document.querySelector('${closeSel}');
    const br = btn.getBoundingClientRect();
    return JSON.stringify({ scrollTop: Math.round(sc.scrollTop), closeBtn: [Math.round(br.left), Math.round(br.top), Math.round(br.right), Math.round(br.bottom)] });
  })()`));
  console.log(`  ${human}：卡片 overflow=${R.卡片overflowY}，内容 overflow=${R.内容overflowY} 可视 ${R.内容可视高}/${R.内容总高}px`);
  ok(R.closePosition === 'absolute' && R.卡片overflowY === 'hidden' && R.内容overflowY === 'auto',
    `${human}：× 在卡片内绝对定位、卡片不滚、内容区滚`);
  ok(after.scrollTop > R.之前scrollTop, `${human}：内容确实滚下去了（scrollTop ${R.之前scrollTop} → ${after.scrollTop}）`);
  ok(after.closeBtn[0] === R.closeBtn[0] && after.closeBtn[1] === R.closeBtn[1],
    `★ ${human}：内容滚动后 × 一动不动（滚动前 ${R.closeBtn[0]},${R.closeBtn[1]} → 滚动后 ${after.closeBtn[0]},${after.closeBtn[1]}）`);
  ok(after.closeBtn[2] <= R.卡片[2] && after.closeBtn[1] >= R.卡片[1] && after.closeBtn[1] - R.卡片[1] <= 20,
    `${human}：× 仍贴在卡片右上角（距卡片右边 ${R.卡片[2] - after.closeBtn[2]}px、上边 ${after.closeBtn[1] - R.卡片[1]}px）`);
  await evaluate(`(()=>{ const p=document.getElementById('__tallpad'); if(p) p.remove(); return 1; })()`);
}

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ② 详细信息灯箱（.info-lightbox）══════\n');
ok(idx >= 0, `② 找到 KP04057 的详情数据（下标 ${idx}）`);
if (idx >= 0) {
  await evaluate(`(()=>{ openCopyDetail(${idx}); return true; })()`);
  await sleep(700);
  ok(await evaluate(`!!document.querySelector('#copyDetailLightbox .lightbox-close')`) === true, '② 详情灯箱打开了');
  await checkNoMove('详细信息', '.info-lightbox-inner', '.info-lightbox-content', '.lightbox-close');

  // ══════════════════════════════════════════════════════════════
  console.log('\n══════ ③ 八面图灯箱（.octo-lightbox）══════\n');
  await evaluate(`(()=>{ openOctoGallery(${idx}); return true; })()`);
  await sleep(700);
  ok(await evaluate(`!!document.querySelector('#octoLightbox .lightbox-close')`) === true, '③ 八面图灯箱打开了');
  await checkNoMove('八面图', '.octo-inner', '.octo-grid', '.lightbox-close');
  await evaluate(`(()=>{ closeOctoGallery(); closeCopyDetail(); return true; })()`);
  await sleep(600);
  ok(await evaluate(`!document.querySelector('#octoLightbox') && !document.querySelector('#copyDetailLightbox')`) === true,
    '③ 关掉后两个灯箱都不留残骸');
}

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ④ 专题灯箱（.special-lightbox）══════\n');
await boot('special');
const opened = await evaluate(`(()=>{
  const t = (typeof specialCategoryTree !== 'undefined' && specialCategoryTree) ? specialCategoryTree : [];
  const hit = t.find(c => /拾年/.test(c.name || '')) || t[0];
  if (!hit || typeof onSpecialOverviewItemClick !== 'function') return 'no-data';
  onSpecialOverviewItemClick(hit.id);
  return 'ok';
})()`);
await sleep(2500);
console.log(`  进入专题：${opened}`);
const specOpen = await evaluate(`(()=>{ if (typeof openSpecialLightbox !== 'function') return 'no-fn';
  openSpecialLightbox(0); return 'ok'; })()`);
await sleep(800);
const hasSpecial = await evaluate(`!!document.querySelector('#specialLightbox .lightbox-close')`);
ok(hasSpecial === true, `④ 专题灯箱打开了（${specOpen}）`);
if (hasSpecial) {
  await checkNoMove('专题', '.special-lightbox-inner', '.special-lightbox-content', '.lightbox-close');
  await evaluate(`(()=>{ closeSpecialLightbox(); return 1; })()`);
  await sleep(600);
  ok(await evaluate(`!document.querySelector('#specialLightbox')`) === true, '④ 关掉后不留残骸');
}

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑤ 图片大图弹窗（.modal）══════\n');
const modalInfo = JSON.parse(await evaluate(`(()=>{
  if (typeof openModal !== 'function') return JSON.stringify({ err: 'openModal 不存在' });
  openModal('images/icon-192.png', '');
  const m = document.getElementById('imageModal');
  if (!m) return JSON.stringify({ err: '弹窗没打开' });
  const btn = m.querySelector('.modal-close');
  const br = btn.getBoundingClientRect();
  // 让页面滚一下，fixed 的 × 不该动
  document.documentElement.scrollTop = 0;
  window.scrollTo(0, 0);
  const before = [Math.round(br.left), Math.round(br.top)];
  window.dispatchEvent(new Event('resize'));
  return JSON.stringify({ position: getComputedStyle(btn).position, zIndex: getComputedStyle(btn).zIndex,
    容器滚动: m.scrollHeight > m.clientHeight + 1, before,
    after: [Math.round(btn.getBoundingClientRect().left), Math.round(btn.getBoundingClientRect().top)],
    在视口内: br.left >= 0 && br.top >= 0 && br.right <= innerWidth && br.bottom <= innerHeight });
})()`));
console.log('  ' + JSON.stringify(modalInfo));
ok(modalInfo.position === 'fixed', `⑤ 图片弹窗的 × 是 position:fixed（${modalInfo.position}）`);
ok(modalInfo.容器滚动 === false, '⑤ 图片弹窗容器本身不滚（所以 × 没有"跟着滚"的问题）');
ok(modalInfo.before[0] === modalInfo.after[0] && modalInfo.before[1] === modalInfo.after[1], '⑤ 视口变化/重排后 × 位置不变');
ok(modalInfo.在视口内 === true, '⑤ × 在视口内（右上角可点）');
await evaluate(`(()=>{ closeModal(); return 1; })()`);
await sleep(500);
ok(await evaluate(`document.getElementById('imageModal').classList.contains('modal-show') === false`) === true, '⑤ 大图弹窗能正常关掉');

// ══════════════════════════════════════════════════════════════
// ⑥⑦⑧：「原图还在下载时关闭 / 翻面」的真实现场（用户报的两条）
//
// 用户原话：
//   ①「原图还没有加载出来的时候就点击关闭图片，会出现淡出和飞回动画同时叠加，我不希望淡出动画。」
//   ②「加载一半的时候翻面，加载完成后会在翻到另一面出现加载好的图片。」
//
// 病根都在同一件事上：**原图没解码就绪时，画面上真正可见的那张图不是 #modalImg**：
//   · #modalImg 此刻没有任何像素（naturalWidth=0）
//   · 可见的是垫底层 #modalImgOverlay.backdrop-layer 里的**低清缩略图**（在主图下面）
//   · 而"生长/缩回飞行图层"却按 #modalImg.src（= 还在下载的原图）建，
//     于是整段动画它自己画不出东西；真正可见的那张低清图留在 .modal 里，
//     跟着 .modal 的 opacity 淡出 → 用户看到"淡出 + 飞回"叠加。
//
// 慢加载怎么造（CI 无外网也能跑）：CDP Fetch 拦截，把线上图片地址改写到本地
// 静态服务器，并按需把原图请求**挂住不放行**（就是"还在下载"）。
console.log('\n══════ ⑥ 原图还在下载时关闭：只允许"飞回原位"这一个几何动画 ══════\n');
const LIVE = 'https://tong-xiangjie.github.io/';
const LOCAL = `http://127.0.0.1:${server.address().port}/`;
const norm = u => String(u || '').replace(/^https?:\/\/[^/]+/i, '');
let imgHold = null;      // 命中它的图片请求按 imgDelayMs 处理（0 = 挂住不放行）
let imgDelayMs = 0;
let heldIds = [];
async function onPaused(p) {
  try {
    const u = p.request.url;
    const local = u.startsWith(LIVE) ? LOCAL + u.slice(LIVE.length) : u;
    if (imgHold && imgHold.test(u)) {
      if (imgDelayMs > 0) await sleep(imgDelayMs);
      else { heldIds.push(p.requestId); return; }   // 一直挂着 = "原图还在下载"
    }
    await send('Fetch.continueRequest', { requestId: p.requestId, url: local });
  } catch {
    try { await send('Fetch.continueRequest', { requestId: p.requestId }); } catch { }
  }
}
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Fetch.enable', { patterns: [{ urlPattern: LIVE + '*', requestStage: 'Request' }] });

// 页内采样器：逐帧记录"谁在画、谁在动、有哪些动画"
async function installSampler() {
  await evaluate(`(() => {
    if (window.__LS) return 1;
    const eff = el => { let o = 1, n = el; while (n && n.nodeType === 1) { const v = parseFloat(getComputedStyle(n).opacity); if (isFinite(v)) o *= v; n = n.parentElement; } return o; };
    const anims = () => document.getAnimations().map(a => {
      const t = a.effect && a.effect.target;
      let props = [];
      try { props = [...new Set((a.effect.getKeyframes() || []).reduce((acc, f) => acc.concat(Object.keys(f)), []).filter(pp => ['offset', 'computedOffset', 'easing', 'composite'].indexOf(pp) < 0))]; } catch (e) { }
      const inModal = !!(t && ((t.id === 'imageModal') || (t.closest && t.closest('#imageModal')) || (t.classList && t.classList.contains('modal-flight'))));
      return { name: String(a.animationName || a.transitionProperty || ''), props: props, inModal: inModal, target: t ? (t.id || String(t.className || '')) : '' };
    });
    const rect = n => { const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    const cur = n => String((n && (n.currentSrc || n.getAttribute('src'))) || '');
    const frame = () => {
      const img = document.getElementById('modalImg'), ov = document.getElementById('modalImgOverlay'), fl = document.querySelector('.modal-flight'), m = document.getElementById('imageModal');
      return { t: Math.round(performance.now()),
        modalDisplay: m ? getComputedStyle(m).display : '', modalHide: m ? m.classList.contains('modal-hide') : false, modalOp: m ? getComputedStyle(m).opacity : '',
        ovDisplay: ov ? getComputedStyle(ov).display : '', ovBackdrop: ov ? ov.classList.contains('backdrop-layer') : false, ovNw: ov ? ov.naturalWidth : 0,
        imgSrc: cur(img), imgNw: img ? img.naturalWidth : 0, imgEff: img ? +eff(img).toFixed(3) : 0,
        flight: fl ? { src: cur(fl), nw: fl.naturalWidth, op: getComputedStyle(fl).opacity, eff: +eff(fl).toFixed(3), rect: rect(fl) } : null,
        anims: anims() };
    };
    window.__LS = {
      frames: [], on: false,
      start() { this.frames = []; this.on = true; const tick = () => { if (!this.on) return; try { this.frames.push(frame()); } catch (e) { } requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; },
      stop() { this.on = false; return JSON.stringify(this.frames); },
      snap() { return JSON.stringify(frame()); }
    };
    return 1;
  })()`);
}
// 找到 KP04057 的正面格子并点开（走真实缩略图点击：生长动画 + lastModalSourceImg 都是真的）
const openSnippet = flipAfter => `(async () => {
  const re = /openModal\\('([^']+)',\\s*'([^']+)'\\)/;
  let el = null, mm = null;
  for (const w of document.querySelectorAll('[onclick]')) {
    const oc = w.getAttribute('onclick'); const m2 = oc ? re.exec(oc) : null;
    if (m2 && /KP04057-1\\.jpg$/.test(m2[1])) { el = w; mm = m2; break; }
  }
  if (!el) return JSON.stringify({ err: '没找到 KP04057 的正反面格子' });
  const th = el.querySelector('img') || el;
  th.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 300));
  const target = imageContentRect(th);
  th.click();
  let growInAir = false;
  if (${flipAfter} > 0) {
    await new Promise(r => setTimeout(r, ${flipAfter}));
    growInAir = !!document.querySelector('.modal-flight');
    document.getElementById('modalNavNext').click();
  }
  return JSON.stringify({ img1: mm[1], img2: mm[2], thumb: (typeof getThumbUrl === 'function' ? getThumbUrl(mm[1]) : ''),
    target: [Math.round(target.left), Math.round(target.top), Math.round(target.width), Math.round(target.height)], growInAir: growInAir });
})()`;

// ── ⑥ 加载中关闭 ──────────────────────────────────────────────
{
  imgHold = /image\/comm\/KP04057-1\.jpg/; imgDelayMs = 0; heldIds = [];
  await boot('notes/commemorative');
  await installSampler();
  const P = JSON.parse(await evaluate(openSnippet(0)));
  ok(!P.err, `⑥ 点开正面格子（${P.err || norm(P.img1)}）`);
  // 等生长动画落地：本段只量"加载中关闭"，不与翻面撞生长动画混在一起
  await sleep(700);
  const pre = JSON.parse(await evaluate('window.__LS.snap()'));
  ok(pre.imgNw === 0 && pre.ovNw > 0 && pre.ovBackdrop,
    `⑥ 前置：原图确实还在下载（主图 naturalWidth=${pre.imgNw}、无像素），画面上可见的是垫底层里那张低清缩略图（naturalWidth=${pre.ovNw}）`);
  await evaluate('window.__LS.start()');
  await evaluate(`document.querySelector('#imageModal .modal-close').click()`);
  await sleep(800);
  const F = JSON.parse(await evaluate('window.__LS.stop()'));
  const fs = F.filter(f => f.flight);
  const last = fs.length ? fs[fs.length - 1].flight : null;
  const pxFrames = fs.filter(f => f.flight.nw > 0).length;
  console.log(`  采样 ${F.length} 帧，其中有飞行图层 ${fs.length} 帧；飞行图层有像素 ${pxFrames} 帧`);
  ok(fs.length >= 3, `⑥ 关闭时确实有"飞回原位"的飞行图层（${fs.length} 帧）`);
  ok(fs.length > 0 && pxFrames >= Math.ceil(fs.length / 2) && last && last.nw > 0,
    `★ ⑥ 飞行图层扛的是**真有像素**的那张图（${pxFrames}/${fs.length} 帧 naturalWidth>0）—— 旧实现扛的是还在下载的原图，整段动画什么都画不出来`);
  ok(fs.length > 0 && fs.every(f => norm(f.flight.src) === norm(P.thumb)),
    `★ ⑥ 飞行图层的地址 = 屏幕上真正可见的那张低清图（期望 ${norm(P.thumb)}，实际 ${fs.length ? norm(fs[0].flight.src) : '-'}）`);
  ok(fs.every(f => Math.abs(Number(f.flight.eff) - 1) < 0.01), '★ ⑥ 飞行图层的有效不透明度全程 = 1（图片没有在淡出）');
  ok(F.every(f => f.modalOp === '1' && !f.modalHide),
    `★ ⑥ 这一场合成里没有任何淡出：#imageModal 全程 opacity=1、不挂 .modal-hide（帧内 opacity 取值 ${[...new Set(F.map(f => f.modalOp))].join('/')}）`);
  const fadeAnims = F.reduce((acc, f) => acc.concat(f.anims), []).filter(a => a.inModal && a.props.indexOf('opacity') >= 0);
  ok(fadeAnims.length === 0,
    `★ ⑥ getAnimations() 里没有任何 opacity 动画（${fadeAnims.length ? fadeAnims.map(a => a.name + '@' + a.target).join('、') : '无'}），只有几何动画`);
  ok(F.some(f => f.anims.some(a => a.inModal && a.props.indexOf('transform') >= 0 || a.name === 'transform')),
    '⑥ 确实在跑几何（transform）动画');
  const rects = fs.map(f => f.flight.rect.map(v => v).join(','));
  ok(new Set(rects).size >= 3, `⑥ 位置/尺寸逐帧变化到目标位（${new Set(rects).size} 个不同矩形）`);
  ok(fs.length > 0 && fs[0].flight.rect[2] > 300, `⑥ 起飞时是满幅那一张（首帧宽 ${fs.length ? fs[0].flight.rect[2] : '-'}px）`);
  ok(last && Math.abs(last.rect[0] - P.target[0]) <= 3 && Math.abs(last.rect[1] - P.target[1]) <= 3 && Math.abs(last.rect[2] - P.target[2]) <= 3 && Math.abs(last.rect[3] - P.target[3]) <= 3,
    `⑥ 终点落在缩略图格子本来的位置上（终点 ${last ? last.rect.join(',') : '-'} vs 格子 ${P.target.join(',')}）`);
  ok(fs.length > 0 && fs.every(f => f.ovDisplay === 'none' || !f.ovNw),
    '★ ⑥ 弹窗里那份低清图已撤掉：同一张图不会"原地留一张 + 再飞一张"');
  await sleep(400);
  ok(await evaluate(`!document.querySelector('.modal-flight')`) === true, '⑥ 飞行结束后飞行图层已清理');
  ok(await evaluate(`getComputedStyle(document.getElementById('imageModal')).display === 'none'`) === true, '⑥ 弹窗真的收掉了（没有卡在半透明/半显示）');
  ok(await evaluate(`document.getElementById('modalImg').style.opacity === ''`) === true, '⑥ 收尾时主图的内联 opacity 已清空（不留给下次打开）');
  heldIds.forEach(id => { send('Fetch.continueRequest', { requestId: id }).catch(() => { }); });
  heldIds = [];
  await sleep(400);
}

// ── ⑦ 加载中翻面 ──────────────────────────────────────────────
console.log('\n══════ ⑦ 原图还在下载时翻面：加载完成后必须就挂在当前可见的那一面上 ══════\n');
{
  // ⑦a：生长动画还在空中就翻面 —— 旧实现会让"生长飞行图层"永远留在 DOM 里
  //      （落在全屏那一格、z-index 1002），把加载好的当前面大图整块盖住。
  imgHold = /image\/comm\/KP04057-[12]\.jpg/; imgDelayMs = 1600; heldIds = [];
  await boot('notes/commemorative');
  await installSampler();
  const P = JSON.parse(await evaluate(openSnippet(80)));
  ok(!P.err, `⑦ 点开正面格子（${P.err || norm(P.img1)}）`);
  ok(P.growInAir === true, '⑦a 前置：翻面时"缩略图飞向全屏"的生长动画还在空中（这正是用户点开就翻的动作）');
  await sleep(3000);
  const st = JSON.parse(await evaluate(`(() => {
    const fl = document.querySelector('.modal-flight'), img = document.getElementById('modalImg'), ov = document.getElementById('modalImgOverlay');
    const eff = el => { let o = 1, n = el; while (n && n.nodeType === 1) { const v = parseFloat(getComputedStyle(n).opacity); if (isFinite(v)) o *= v; n = n.parentElement; } return o; };
    return JSON.stringify({ side: currentModalSide, fullReady: modalFullReady, staleFlight: !!fl,
      staleSrc: fl ? String(fl.currentSrc || fl.getAttribute('src')) : '',
      imgSrc: String(img.currentSrc || img.getAttribute('src') || ''), imgNw: img.naturalWidth, imgEff: +eff(img).toFixed(3),
      ovDisplay: getComputedStyle(ov).display, ovBackdrop: ov.classList.contains('backdrop-layer'), ovNw: ov.naturalWidth,
      modalLoading: document.getElementById('imageModal').classList.contains('modal-loading') });
  })()`));
  console.log('  ' + JSON.stringify({ ...st, imgSrc: norm(st.imgSrc), staleSrc: norm(st.staleSrc) }));
  ok(st.side === 2, '⑦a 当前面已经切到反面');
  ok(st.staleFlight === false,
    `★ ⑦a 没有残留的飞行图层（旧实现会永远留一张 ${norm(st.staleSrc)} 盖在大图上）`);
  ok(st.imgNw > 0 && Math.abs(st.imgEff - 1) < 0.01 && norm(st.imgSrc) === norm(P.img2),
    `★ ⑦a 加载完成后，加载好的原图就挂在当前可见面上：src=${norm(st.imgSrc)} naturalWidth=${st.imgNw} 有效不透明度=${st.imgEff}（不需要再翻一次）`);
  ok(st.fullReady === true && st.modalLoading === false, '⑦a 主图处于"就绪"状态（提示语/捏合缩放都按就绪走）');
  ok(!(st.ovBackdrop && st.ovDisplay !== 'none' && st.ovNw > 0), '⑦a 垫底低清层已撤，没有低清旧面压在原图上面');
  await evaluate('closeModal()');
  await sleep(600);

  // ⑦b：生长动画落地之后（原图仍在下载）翻面 → 加载完成后画面上必须是"另一面的原图"，
  //      用像素证据判：翻面前后同一块区域的像素必须有明显差异
  //      （旧实现如果把"翻到的那面"画成上一面的低清图，这里就会几乎一模一样）
  imgHold = /image\/comm\/KP04057-[12]\.jpg/; imgDelayMs = 1600; heldIds = [];
  await boot('notes/commemorative');
  await installSampler();
  const Q = JSON.parse(await evaluate(openSnippet(0)));
  ok(!Q.err, `⑦b 点开正面格子（${Q.err || norm(Q.img1)}）`);
  await sleep(700);
  const pre = JSON.parse(await evaluate('window.__LS.snap()'));
  ok(pre.imgNw === 0, `⑦b 前置：原图仍在下载（主图 naturalWidth=${pre.imgNw}），屏幕上是正面低清图`);
  const shotA = await shotViewport(send, 1, 'white');
  await evaluate(`document.getElementById('modalNavNext').click()`);
  await sleep(3200);
  const shotB = await shotViewport(send, 1, 'white');
  const st2 = JSON.parse(await evaluate(`(() => {
    const img = document.getElementById('modalImg'), ov = document.getElementById('modalImgOverlay');
    const eff = el => { let o = 1, n = el; while (n && n.nodeType === 1) { const v = parseFloat(getComputedStyle(n).opacity); if (isFinite(v)) o *= v; n = n.parentElement; } return o; };
    return JSON.stringify({ side: currentModalSide, fullReady: modalFullReady, staleFlight: !!document.querySelector('.modal-flight'),
      imgSrc: String(img.currentSrc || img.getAttribute('src') || ''), imgNw: img.naturalWidth, imgEff: +eff(img).toFixed(3),
      ovBackdrop: ov.classList.contains('backdrop-layer'), ovDisplay: getComputedStyle(ov).display, ovNw: ov.naturalWidth });
  })()`));
  // 像素证据：在图片区撒点，比较"翻面+加载完成"前后
  let sum = 0, n = 0, mx = 0;
  for (let y = 120; y < 560; y += 40) for (let x = 340; x < 950; x += 40) {
    const d = maxChanDiff(shotA.px(x, y), shotB.px(x, y));
    sum += d; n++; if (d > mx) mx = d;
  }
  const avg = +(sum / n).toFixed(1);
  console.log(`  像素差异（翻面前后同点）：平均 ${avg}、最大 ${mx}（采样 ${n} 点）`);
  ok(st2.side === 2 && norm(st2.imgSrc) === norm(Q.img2) && st2.imgNw > 0 && Math.abs(st2.imgEff - 1) < 0.01 && st2.fullReady === true,
    `★ ⑦b 加载完成后当前可见面就是反面的原图：src=${norm(st2.imgSrc)} naturalWidth=${st2.imgNw} 有效不透明度=${st2.imgEff}`);
  ok(st2.staleFlight === false, '⑦b 没有残留飞行图层');
  ok(avg > 18, `★ ⑦b 像素证据：画面上真的换成了另一面的图（同点平均色差 ${avg} > 18）`);
  await evaluate('closeModal()');
  await sleep(600);
  heldIds.forEach(id => { send('Fetch.continueRequest', { requestId: id }).catch(() => { }); });
  heldIds = [];
  await sleep(300);
}

// ── ⑧ 回归：图片已就绪时，正常关闭照旧"蒙版淡出 + 图片飞回" ──────────
console.log('\n══════ ⑧ 回归：加载完成后的正常关闭/翻面没被改坏 ══════\n');
{
  imgHold = null; imgDelayMs = 0; heldIds = [];
  await boot('notes/commemorative');
  await installSampler();
  const P = JSON.parse(await evaluate(openSnippet(0)));
  ok(!P.err, `⑧ 点开正面格子（${P.err || norm(P.img1)}）`);
  for (let i = 0; i < 40; i++) { if (await evaluate('modalFullReady === true').catch(() => false)) break; await sleep(250); }
  ok(await evaluate('modalFullReady === true') === true, '⑧ 前置：原图已解码就绪');
  await evaluate('window.__LS.start()');
  await evaluate(`document.querySelector('#imageModal .modal-close').click()`);
  await sleep(150);
  const F = JSON.parse(await evaluate('window.__LS.stop()'));
  const fs = F.filter(f => f.flight);
  const pxFrames = fs.filter(f => f.flight.nw > 0).length;
  console.log(`  正常关闭采样 ${F.length} 帧，其中飞行图层 ${fs.length} 帧、有像素 ${pxFrames} 帧`);
  ok(F.some(f => f.modalHide) === true, '★ ⑧ 正常关闭：蒙版照旧淡出（.modal-hide 仍在）—— 既有观感没被改坏');
  ok(fs.length > 0 && fs[fs.length - 1].flight.nw > 0, `⑧ 正常关闭：飞行图层扛着已加载的原图（末帧 naturalWidth=${fs.length ? fs[fs.length - 1].flight.nw : '-'}）`);
  await sleep(700);
  ok(await evaluate(`!document.querySelector('.modal-flight')`) === true, '⑧ 正常关闭：飞行图层已清理');

  // 正常翻面（原图已就绪）：翻完就停在当前面
  await sleep(600);   // 等生长动画彻底落地再翻，确保本段量的是"已就绪"那条路径
  await evaluate(`(async () => {
    const re = /openModal\\('([^']+)',\\s*'([^']+)'\\)/;
    for (const w of document.querySelectorAll('[onclick]')) {
      const oc = w.getAttribute('onclick'); const m2 = oc ? re.exec(oc) : null;
      if (m2 && /KP04057-1\\.jpg$/.test(m2[1])) { (w.querySelector('img') || w).click(); return 1; }
    }
    return 0;
  })()`);
  for (let i = 0; i < 40; i++) { if (await evaluate('modalFullReady === true').catch(() => false)) break; await sleep(250); }
  await evaluate(`document.getElementById('modalNavNext').click()`);
  await sleep(1800);  const st = JSON.parse(await evaluate(`(() => {
    const img = document.getElementById('modalImg');
    const eff = el => { let o = 1, n = el; while (n && n.nodeType === 1) { const v = parseFloat(getComputedStyle(n).opacity); if (isFinite(v)) o *= v; n = n.parentElement; } return o; };
    return JSON.stringify({ side: currentModalSide, src: String(img.currentSrc || img.getAttribute('src') || ''), nw: img.naturalWidth,
      eff: +eff(img).toFixed(3), fl: !!document.querySelector('.modal-flight'), flipIn: img.classList.contains('flip-in') });
  })()`));
  ok(st.side === 2 && norm(st.src) === norm(P.img2) && st.nw > 0 && Math.abs(st.eff - 1) < 0.01 && st.fl === false,
    `★ ⑧ 正常翻面：停在反面且原图可见（src=${norm(st.src)} nw=${st.nw} 有效不透明度=${st.eff}）`);
  await evaluate('closeModal()');
  await sleep(600);
}

for (const id of heldIds) { try { await send('Fetch.continueRequest', { requestId: id }); } catch { } }
try { await send('Fetch.disable'); } catch { }

// ══════════════════════════════════════════════════════════════
console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch { }
try { child.kill(); } catch { }
try { server.close(); } catch { }
process.exit(fail === 0 ? 0 : 1);
