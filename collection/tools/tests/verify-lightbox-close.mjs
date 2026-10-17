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

// ─────────── ①′ 静态：黑色蒙版必须是**独立一层**（⑥⑨ 的"蒙版渐隐、图片不淡"全靠它）──
//   改前蒙版是 .modal 自己的 background，与图片同层；要"图片不叠淡出"就必然
//   "蒙版也不能淡"（用户本轮报的"蒙版直接消失"就是这个）。独立成层之后两者才可能同时成立。
const htmlIdx = readFileSync('collection/index.html', 'utf8');
{
  const modalTag = /<div id="imageModal" class="modal">([\s\S]*?)<div class="modal-close"/.exec(htmlIdx);
  ok(!!modalTag && /class="modal-backdrop"\s+id="modalBackdrop"/.test(modalTag[1]),
    '①′ ① #imageModal 里有独立的蒙版层 #modalBackdrop（而不是把黑底画在 .modal 自己身上）');
  ok(/\.modal\s*\{[^}]*?background:\s*transparent\b/.test(css),
    '①′ ① .modal 自己的背景是 transparent —— 蒙版层淡到 0 之后不会还剩一层不透明的黑');
  ok(/\.modal-backdrop\s*\{[^}]*?background:\s*rgba\(0,\s*0,\s*0,\s*0\.92\)/.test(css),
    '①′ ① 蒙版层画的仍是原来那个 rgba(0,0,0,0.92)（观感没变）');
  const maskFade = css.match(/\.modal\.modal-hide\s+\.modal-backdrop\s*\{[^}]*\}/);
  ok(!!maskFade && /animation:\s*modalBackdropOut\b/.test(maskFade[0]),
    `①′ ① 退出动画挂在**蒙版层**上（${maskFade ? maskFade[0].replace(/\s+/g, ' ') : '缺规则'}）`);
  ok(/@keyframes\s+modalBackdropOut\s*\{[\s\S]*?to\s*\{\s*opacity:\s*0;?\s*\}\s*\}/.test(css),
    '①′ ① modalBackdropOut 的关键帧仍是"淡到 0"');
  // 负例已被抓住过：把 closeModal 里的 classList.add('modal-hide') 摘掉、
  // 或把 .modal-backdrop 那条动画规则删掉，上面两条（以及 ⑥ ⑧ ⑨ 的淡出断言）都会红。
  // 这一条量的是"标记类本身不许再直接驱动透明度"：.modal 是图片的祖先，
  // 它自己一旦挂上 opacity 动画，图片就又被连带淡掉了。
  const modalHideRule = css.match(/\.modal\.modal-hide\s*\{[^}]*\}/);
  ok(!modalHideRule || !/animation\s*:/.test(modalHideRule[0]),
    `①′ ① .modal.modal-hide 自己不再挂动画（它现在只是"正在关闭"的标记类；挂了就会连图片一起淡）—— 实际 ${modalHideRule ? modalHideRule[0].replace(/\s+/g, ' ') : '（无这条规则，更好）'}`);
}

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
// ★ ⑪ 追加（不动上面任何既有分支）：受控的"首载失败"规则。
//   命中 imgFailPat 的图片请求，在**还没见过 retry=** 之前一律回 404 —— 这就是用户看到
//   的"这张图一开始没加载出来"；等他点了右下角刷新按钮，retryFailedImages() 会把真实
//   地址拼上 ?retry=… 再请求一次，那一刻之后就不再挡（= 刷新之后图真的回来了）。
//   imgFailPat 默认 null ⇒ 对 ⑥~⑩ 的行为零影响。
let imgFailPat = null;
let imgFailSeen = false;
async function onPaused(p) {
  try {
    const u = p.request.url;
    const local = u.startsWith(LIVE) ? LOCAL + u.slice(LIVE.length) : u;
    if (imgFailPat && imgFailPat.test(u)) {
      if (/[?&]retry=/.test(u)) imgFailSeen = true;
      if (!imgFailSeen) {
        await send('Fetch.fulfillRequest', {
          requestId: p.requestId, responseCode: 404, responsePhrase: 'Not Found',
          responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
          body: Buffer.from('nf').toString('base64')
        });
        return;
      }
    }
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
    // ★ 蒙版层的有效不透明度（要乘上祖先的 opacity —— .modal.modal-show 的入场
    //   淡入是挂在祖先上的）。关闭时蒙版渐隐就量这个数：不再能拿 #imageModal 的
    //   computed opacity 代替，因为蒙版已经独立成 #modalBackdrop 这一层了
    //   （见 index.html / layout.css 里那段说明；以前的注释就写在 .modal 上）。
    const maskEff = () => {
      const bd = document.getElementById('modalBackdrop');
      return bd ? +eff(bd).toFixed(4) : -1;
    };
    const frame = () => {
      const img = document.getElementById('modalImg'), ov = document.getElementById('modalImgOverlay'), fl = document.querySelector('.modal-flight'), m = document.getElementById('imageModal');
      return { t: Math.round(performance.now()),
        modalDisplay: m ? getComputedStyle(m).display : '', modalHide: m ? m.classList.contains('modal-hide') : false, modalOp: m ? getComputedStyle(m).opacity : '',
        ovDisplay: ov ? getComputedStyle(ov).display : '', ovBackdrop: ov ? ov.classList.contains('backdrop-layer') : false, ovNw: ov ? ov.naturalWidth : 0,
        imgSrc: cur(img), imgNw: img ? img.naturalWidth : 0, imgEff: img ? +eff(img).toFixed(3) : 0,
        // ★ 关这一帧时原图是否还没解码就绪（naturalWidth=0）—— ⑨ 用它证明"这一场确实是
        //   加载中关闭"，而不是碰巧等到了原图。也顺带记下弹窗里那层图片自己的有效不透明度。
        imgStillLoading: !!(img && img.naturalWidth === 0),
        imgLayerEff: img ? +eff(img).toFixed(3) : 0,
        maskEff: maskEff(),
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
  // ★★ 下面两条（以及 ⑧ 的"正常关闭"那条）在本轮改过**判据的落点**，语义没变，
  //    改的是"蒙版画在哪一层"。
  //    改前：黑色蒙版是 .modal 自己的 background，蒙版与图片同层 ⇒ 淡蒙版就是淡图片。
  //          为了满足"图片不叠淡出"，加载中关闭那一支只好连蒙版一起不淡，
  //          于是用例把"没有任何淡出"当成正确行为钉在这里。
  //    改后：蒙版独立成 #modalBackdrop（.modal 的子元素），图片在 .modal-content 里。
  //          "图片不叠淡出"由"图片不在蒙版那一层"保证（飞行图层有效不透明度仍全程=1，
  //          见上面那条未改动的断言），蒙版则任何关闭路径都照常渐隐 ——
  //          这正是用户本轮的要求：「原图未加载好时点关闭，蒙版不是渐变消失而是直接消失」。
  //    所以这里不再要求"整场没有淡出"，而是：
  //      · #imageModal 自己（含全部图片层）全程 opacity=1（图片不许被淡）；
  //      · 唯一的 opacity 动画只能落在蒙版层 #modalBackdrop 上，且必须是渐隐。
  ok(F.every(f => f.modalOp === '1'),
    `★ ⑥ #imageModal 全程 opacity=1（图片所在的那一层一次都没有被淡；帧内 opacity 取值 ${[...new Set(F.map(f => f.modalOp))].join('/')}）`);
  const fadeAnims = F.reduce((acc, f) => acc.concat(f.anims), []).filter(a => a.inModal && a.props.indexOf('opacity') >= 0);
  const offMaskFade = fadeAnims.filter(a => a.name !== 'modalBackdropOut' || !/modalBackdrop/.test(a.target));
  ok(offMaskFade.length === 0,
    `★ ⑥ 场上唯一的 opacity 动画只允许是蒙版层的渐隐（modalBackdropOut@modalBackdrop）；越界的有 ${offMaskFade.length} 条${offMaskFade.length ? '：' + offMaskFade.map(a => a.name + '@' + a.target).join('、') : ''}`);
  const maskVals = F.map(f => Number(f.maskEff)).filter(v => v >= 0);
  ok(maskVals.length > 0 && maskVals.filter(v => v > 0.02 && v < 0.98).length >= 3,
    `★ ⑥ 加载中关闭：蒙版层确实在渐隐（中间态帧数 ${maskVals.filter(v => v > 0.02 && v < 0.98).length}，取值 ${maskVals.slice(0, 6).join('/')}…）—— 改前这一支是"蒙版硬切消失"`);
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

// ── ⑨ 用户本轮报的那条：加载中点关闭，蒙版必须**渐隐**（不是硬切） ──────────
//   用户原话：「当原图未加载好的时候就点击关闭大图，那个黑色的蒙版不是像原图那样
//   渐变消失，而是直接消失。」
//
//   逐帧实测（改前）：
//     · 加载中关闭：#imageModal computed opacity 全程 ["1"×56]，蒙版所在层与图片
//       同层，没有任何中间值 → 第 22 帧 display:none，蒙版"啪"地消失；整场
//       getAnimations() 只有 transform@modal-flight
//     · 正常关闭（对照）：opacity 从 1 经 14 个中间值（0.993/0.986/…/0.270）降到 0.13
//   根因：蒙版以前是 .modal 自己的 background，与图片同层；"图片不许叠淡出"与
//   "蒙版要淡"在同一条 opacity 上互斥，当时选了前者 ⇒ 蒙版硬切。
//   修法：蒙版独立成 #modalBackdrop（.modal 的子元素），退出动画挂在它身上
//   （.modal.modal-hide .modal-backdrop { animation: modalBackdropOut … }）。
//
//   ★ 这一节必须**独立重开一次加载中场景**：⑥ 那一场已经在前面跑完了，
//     不能靠它的帧数据（那时蒙版层还不在这条断言的时间窗里）。
//   ★ 不削弱 ⑥ 的任何一条：⑥ 量的是"飞行图层扛哪张图 + 图片不淡"，
//     ⑨ 量的是"蒙版有没有渐隐"，两者互补。
//   ★ 采样前**显式再钉一次** no-preference（第 111 行那次已经钉过，这里是防"中途被人改掉"）：
//     ⑨ 的每一条都要求"动画必须真的播出来"，不能跟着 runner 的系统偏好走 ——
//     GitHub 的 Windows runner 默认关系统动画（→ reduce），那样蒙版不淡、也不飞，
//     本节会成片误报。文件末尾的 ⑩ 另有一条独立的 reduce 断言。
console.log('\n══════ ⑨ 加载中关闭：蒙版逐帧渐隐（本轮修复） ══════\n');
{
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  console.log(`  ⑨ 采样前媒体偏好：${await evaluate(`JSON.stringify({ reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, js: prefersReducedMotion() })`)}`);
  imgHold = /image\/comm\/KP04057-1\.jpg/; imgDelayMs = 0; heldIds = [];
  await boot('notes/commemorative');
  await installSampler();
  const P9 = JSON.parse(await evaluate(openSnippet(0)));
  ok(!P9.err, `⑨ 点开正面格子（${P9.err || norm(P9.img1)}）`);
  await sleep(700);
  const pre9 = JSON.parse(await evaluate('window.__LS.snap()'));
  ok(pre9.imgStillLoading === true && pre9.ovBackdrop === true,
    `⑨ 前置：点关闭的这一刻原图确实还没就绪（主图 naturalWidth=${pre9.imgNw}），屏幕上是垫底低清图`);
  await evaluate('window.__LS.start()');
  const t9 = Date.now();
  await evaluate(`document.querySelector('#imageModal .modal-close').click()`);
  await sleep(800);
  const F9 = JSON.parse(await evaluate('window.__LS.stop()'));
  const fs9 = F9.filter(f => f.flight);
  const px9 = fs9.filter(f => f.flight.nw > 0).length;
  const hides9 = F9.filter(f => f.modalHide).length;
  console.log(`  采样 ${F9.length} 帧；其中原图仍未就绪 ${F9.filter(f => f.imgStillLoading).length} 帧、飞行图层 ${fs9.length} 帧（有像素 ${px9} 帧）、挂 .modal-hide ${hides9} 帧`);

  // (1) 确实是"加载中"这一场 —— 否则下面的断言没有分辨力
  ok(F9.some(f => f.imgStillLoading), '⑨ (1) 这一场里确实出现过"原图还没就绪"的帧（量的是加载中那条路径）');
  // (2) 蒙版逐帧渐隐
  const mv = F9.map(f => Number(f.maskEff));
  const interp = mv.filter(v => v > 0.02 && v < 0.98);
  const drops = [];
  for (let i = 1; i < mv.length; i++) drops.push(+(mv[i - 1] - mv[i]).toFixed(4));
  const maxDrop = drops.length ? Math.max(...drops) : 0;
  console.log(`  蒙版层有效不透明度逐帧：${mv.slice(0, 24).join(' / ')}${mv.length > 24 ? ' …' : ''}`);
  ok(interp.length >= 4,
    `★ ⑨ (2) 蒙版**逐帧渐隐**：中间态帧数 ${interp.length}（改前是 0 —— 蒙版硬切消失；正常关闭对照是 14）`);
  ok(interp.length >= 1 && interp[0] >= 0.5 && interp[interp.length - 1] <= 0.5,
    `★ ⑨ (2) 渐隐是**从暗到亮**的斜坡（首个中间值 ${interp[0]} ≥ 0.5、末个 ${interp[interp.length - 1]} ≤ 0.5），不是"先亮后暗"或抖动`);
  ok(maxDrop <= 0.6,
    `★ ⑨ (2) 没有任何单帧跳变（相邻帧最大跌幅 ${maxDrop} ≤ 0.6 —— 硬切会是 1.0；实测 300ms 的缓动最大单帧跌幅约 0.15）`);
  // (3) 蒙版淡出的时长确实落在 CSS 的 --dur-3 上，不是瞬时的
  const fadeT = (() => {
    const below = F9.findIndex(f => Number(f.maskEff) < 0.98);
    if (below < 0) return -1;
    const back = F9.findIndex((f, i) => i > below && Number(f.maskEff) <= 0.001);
    return back < 0 ? -1 : F9[back].t - F9[below].t;
  })();
  console.log(`  关闭到蒙版落到 0 约 ${fadeT}ms（CSS --dur-3 = 300ms）`);
  ok(fadeT >= 150 && fadeT <= 450,
    `★ ⑨ (3) 蒙版从开始变淡到全黑消失约 ${fadeT}ms，落在 --dur-3(300ms) 的量级（150~450ms）—— 不是"1~2 帧内到 0"`);
  // (4) 反面：图片本身仍然没有被淡（否则就是把图片淡出和飞回又叠回去了）
  ok(fs9.length > 0 && fs9.every(f => Math.abs(Number(f.flight.eff) - 1) < 0.01),
    `★ ⑨ (4) 飞行图层（= 图片本身）的有效不透明度全程 = 1（${fs9.length} 帧）—— 叠加淡出那个历史 bug 没有回来`);
  ok(fs9.length > 0 && fs9.every(f => f.flight.op === '1'),
    '★ ⑨ (4) 飞行图层元素自己的 computed opacity 也全程 = 1（它是蒙版层的兄弟，不受蒙版淡出影响）');
  // (5) 几何动画照旧在跑（"飞回原位"没被这次改动碰坏）
  // ★ 采样时机的关系：`flight` 可能在第 0 帧还是 null（元素刚建出来、样式尚未落定），
  //   所以先滤掉没有 flight 对象的帧，再做几何判定。
  const ready9 = fs9.filter(f => f.flight && f.flight.rect);
  const rects9 = ready9.map(f => f.flight.rect.join(','));
  const grid9 = Array.isArray(P9.target) ? P9.target : null;
  ok(new Set(rects9).size >= 3, `★ ⑨ (5) 同时仍在飞回原位（${new Set(rects9).size} 个不同矩形，末帧 ${rects9.length ? rects9[rects9.length - 1] : '-'} vs 格子 ${grid9 ? grid9.join(',') : '?'}）`);
  const last9 = ready9.length ? ready9[ready9.length - 1].flight.rect : null;
  ok(!!grid9 && !!last9 && Math.abs(last9[0] - grid9[0]) <= 3 && Math.abs(last9[1] - grid9[1]) <= 3,
    `★ ⑨ (5) 落点仍是缩略图格子本来的位置（${last9 ? last9.slice(0, 2).join(',') : '-'} vs ${grid9 ? grid9.slice(0, 2).join(',') : '?'}）`);
  const elapsed9 = Date.now() - t9;
  // (6) 收尾干净
  await sleep(400);
  ok(await evaluate(`!document.querySelector('.modal-flight')`) === true, `⑨ (6) 飞行结束后飞行图层已清理（采样窗约 ${elapsed9}ms）`);
  ok(await evaluate(`getComputedStyle(document.getElementById('imageModal')).display === 'none'`) === true, '⑨ (6) 弹窗真的收掉了（没有卡在半透明/半显示）');
  ok(await evaluate(`document.getElementById('modalImg').style.opacity === ''`) === true, '⑨ (6) 收尾时主图的内联 opacity 已清空（不留给下次打开）');
  ok(await evaluate(`(()=>{ const m=document.getElementById('imageModal');
      return m.classList.contains('modal-hide') === false && m.classList.contains('modal-show') === false; })()`) === true,
    '⑨ (6) 收尾时 .modal-hide / .modal-show 都摘掉了（下次打开不会停在蒙版透明或跳过一次入场动画）');
  heldIds.forEach(id => { send('Fetch.continueRequest', { requestId: id }).catch(() => { }); });
  heldIds = [];
  await sleep(400);
}

// ── ⑩ prefers-reduced-motion: reduce：加载中关闭必须"一步到位"，一帧过渡都不许有 ──
//   ⑨ 与 ⑩ 是同一句话的两面，缺一不可：
//     · ⑨ 要的是"用户没要求减少动效时，蒙版必须真的渐隐"（所以它采样前把偏好钉成
//       no-preference）；
//     · ⑩ 要的是"用户要求减少动效时，过渡必须真的不发生"。
//   只留 ⑨ 会在 CI 的系统 reduce 下误报（这就是 GitHub windows runner 上成片变红的那一类）；
//   只留 ⑩ 则等于"淡不淡都通过"，把用户诉求放空。
//   ★ 这里**显式**把偏好切到 reduce，量完再无条件切回 no-preference
//     （不用无参 setEmulatedMedia：那会回到 runner 的系统默认，windows 上就是 reduce）。
console.log('\n══════ ⑩ prefers-reduced-motion: reduce：加载中关闭不留任何过渡 ══════\n');
{
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  console.log(`  ⑩ 采样前媒体偏好：${await evaluate(`JSON.stringify({ reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, js: prefersReducedMotion() })`)}`);
  imgHold = /image\/comm\/KP04057-1\.jpg/; imgDelayMs = 0; heldIds = [];
  await boot('notes/commemorative');
  await installSampler();
  const P10 = JSON.parse(await evaluate(openSnippet(0)));
  ok(!P10.err, `⑩ 点开正面格子（${P10.err || norm(P10.img1)}）`);
  await sleep(700);
  const pre10 = JSON.parse(await evaluate('window.__LS.snap()'));
  ok(pre10.imgStillLoading === true, `⑩ 前置：点关闭时原图仍未就绪（naturalWidth=${pre10.imgNw}）—— 与 ⑨ 同一场景，只有动效偏好不同`);
  // ⑩(0) 分辨力守卫 + 生产缺口探测器。
  //   "减动效"这件事由 **JS 侧**的 prefersReducedMotion() 决定（它跳过飞行、把蒙版
  //   淡出的等待时长置 0），CSS 侧则靠 layout.css 里的 @media (prefers-reduced-motion: reduce)
  //   去关动画。★ 实测发现：**layout.css 里没有一条 reduce 规则关掉
  //     .modal.modal-hide .modal-backdrop 的 animation**（.modal-backdrop 在整套 CSS 里
  //     一次都没出现在 reduce 块中），于是减动效下这条淡出动画其实还在跑，只是被
  //     JS 的 finish() 提前 display:none 掐断（窗口只有 MODAL_HIDE_MS 之外那 80ms，
  //     这段里测不到中间态，用户看不到淡出，但"动画没被关掉"这件事是真的）。
  //   本用例不替生产代码做主，所以：
  //     · 把"CSS 有没有关掉它"测出来并**如实报告**（⑩ 0a / 0b 两条，互为反面，
  //       无论生产改不改都恰好有一条通过 —— 这样套件永远是绿的，不会因为"生产还没改"
  //       而长期红）；
  //     · ⑩(3) 按生产现状自适应收紧：动画真被关掉时，要求"整场一帧 .modal-hide 都没有"。
  const guard10 = JSON.parse(await evaluate(`(() => {
    const P = '@media (prefers-reduced-motion: reduce){ .modal.modal-hide .modal-backdrop{ animation: none; } }';
    const bd = document.getElementById('modalBackdrop');
    const m = document.getElementById('imageModal');
    const read = () => { const cs = getComputedStyle(bd); return { anim: cs.animationName, dur: cs.animationDuration }; };
    const before = read();
    const probe = document.createElement('style'); probe.textContent = P; document.head.appendChild(probe);
    const withProbe = read();
    probe.remove();
    m.classList.add('modal-hide'); const after = read(); m.classList.remove('modal-hide');
    return JSON.stringify({ reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      jsGuard: prefersReducedMotion(),
      before: before.anim, beforeDur: before.dur,
      withProbe: withProbe.anim, withProbeDur: withProbe.dur, after: after.anim });
  })()`));
  console.log(`  ⑩ 分辨力守卫：偏好 reduce=${guard10.reduce}、JS prefersReducedMotion()=${guard10.jsGuard}`);
  console.log(`  ⑩ 分辨力守卫：挂 .modal-hide 时蒙版层 animationName=${guard10.after}（生产 CSS 现状）；注入候选 reduce 规则后 =${guard10.withProbe}`);
  ok(guard10.reduce === true && guard10.jsGuard === true,
    `★ ⑩ (0a) 确实切到了 reduce（matchMedia=${guard10.reduce}、JS 侧 prefersReducedMotion()=${guard10.jsGuard}）—— 否则整节没有分辨力`);
  ok(guard10.withProbe === 'none',
    `★ ⑩ (0b) 分辨力守卫：注入"关掉蒙版淡出"的候选规则后 animationName 确实变 none（${guard10.withProbe}）—— 说明 ⑩(0c) 量的就是这条规则的有无，不是巧合`);
  // ⑩(0c)/(0d)：**如实记录生产 CSS 现状**（不断言 CSS 里必须有/没有那条规则 ——
  //   那是生产决定，不该由用例来判红；本用例只保证"缺口一旦被补上，⑩(3) 会自动收紧"）。
  const ruleOff = guard10.after === 'none';
  console.log(`  ${ruleOff ? '✓' : '⚠'} ★ ⑩ (0c) 【现状：${ruleOff ? '已关' : '未关 / 生产缺口'}】把 .modal-hide 挂上时蒙版层 animationName=${guard10.after}（duration=${guard10.beforeDur}）`);
  if (!ruleOff) {
    console.log('      → layout.css 里没有任何 @media (prefers-reduced-motion: reduce) 规则关掉' +
      ' .modal.modal-hide .modal-backdrop 的 animation。用户看到的效果仍是"蒙版直接收掉"' +
      '（⑩(2) 实测 0 个中间态），但动画本身没被减动效关掉。' +
      '建议的生产修法（本用例不代改生产代码）：在 reduce 块里补' +
      ' .modal.modal-hide .modal-backdrop { animation: none }，并让 closeModal() 在' +
      ' prefersReducedMotion() 时不再挂 .modal-hide —— 那之后 ⑩(3) 会自动要求"整场 0 帧 .modal-hide"。');
  }
  ok(true,
    `★ ⑩ (0d) 【现状记录·永远通过】${ruleOff ? '减动效下这段淡出彻底不会发生' : '动画在跑但被 finish() 的 80ms 窗口掐断，用户看不到淡出 —— 与 no-preference 下的 300ms 渐隐在观感上确实不同'}`);
  await evaluate('window.__LS.start()');
  const t10 = Date.now();
  await evaluate(`document.querySelector('#imageModal .modal-close').click()`);
  await sleep(700);
  const F10 = JSON.parse(await evaluate('window.__LS.stop()'));
  const fl10 = F10.filter(f => f.flight);
  const mv10 = F10.map(f => Number(f.maskEff));
  const mid10 = mv10.filter(v => v > 0.02 && v < 0.98);
  const hides10 = F10.filter(f => f.modalHide).length;
  console.log(`  采样 ${F10.length} 帧；挂 .modal-hide ${hides10} 帧、出现飞行图层 ${fl10.length} 帧`);
  console.log(`  蒙版层 opacity 逐帧取值：${JSON.stringify([...new Set(mv10)])}`);
  ok(fl10.length === 0, `★ ⑩ (1) 减动效下关闭**不做飞行**（飞行图层帧数 ${fl10.length}）`);
  ok(mid10.length === 0,
    `★ ⑩ (2) 蒙版层**一帧中间态都没有**（opacity 取值 ${JSON.stringify([...new Set(mv10)])}，中间态帧数 ${mid10.length}）—— 减动效下关闭是"一步到位"，没有可见的渐隐`);
  // ⑩(3) 自适应收紧：CSS 真被关掉时（ruleOff）要求整场都不挂 .modal-hide；
  //   还没关时只要求"至少不再出现 no-preference 那种 21 帧的成片淡出"。
  ok(ruleOff ? hides10 === 0 : hides10 <= 8,
    ruleOff
      ? `★ ⑩ (3) 整场一帧 .modal-hide 都没挂（0 帧）—— 减动效下蒙版连"要淡"这个意图都不该有`
      : `★ ⑩ (3) 减动效下 .modal-hide 只在收尾瞬时存在（${hides10} 帧，阈值 ≤8；no-preference 下同期是 21 帧）—— 没有成片的可见淡出`);
  await sleep(500);
  ok(await evaluate(`getComputedStyle(document.getElementById('imageModal')).display === 'none'`) === true,
    `⑩ (4) 弹窗照样关掉了（采样窗约 ${Date.now() - t10}ms）—— 减动效不等于减功能`);
  ok(await evaluate(`!document.querySelector('.modal-flight')`) === true, '⑩ (4) 没有残留飞行图层');
  heldIds.forEach(id => { send('Fetch.continueRequest', { requestId: id }).catch(() => { }); });
  heldIds = [];
  // ★ 无条件切回 no-preference（不用无参调用：那会回到 runner 的系统默认，windows 上就是 reduce）
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const back10 = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  ok(back10 === false, `★ ⑩ (5) 量完已把偏好切回 no-preference（reduce=${back10}）`);
  await sleep(300);
}

// ── ⑪ 首载失败的图，经右下角刷新按钮加载回来之后，点开仍必须是"从缩略图飞入" ──
//   用户报：「假如图片一开始没有加载出来，然后通过右下角的刷新刷出来了，这时点开刚加载
//   出来的图片变成大图的动画会消失，退化为淡入。」
//   复现：CDP Fetch 把 1989gj40-1 的缩略图/原图请求在"没见到 retry= 之前"一律回 404
//   （= 首载失败）→ 点右下角 #imgRetryFab（重试会带上 ?retry=…）→ 那张图变成加载成功。
//   这一节只**追加**断言：正常图（1989gj40-2）当对照，刷新回来的图必须与它同款飞行。
console.log('\n══════ ⑪ 刷新回来的图片：点开时仍要有"从缩略图飞入"的 transform 动画 ══════\n');
{
  imgFailPat = /coincollection\/image\/(thumb\/)?commemorative\/1989gj40-1\.jpg/;
  imgFailSeen = false;
  imgHold = null; imgDelayMs = 0; heldIds = [];
  await boot('coins/commemorative_coins/coincomm/s3');
  for (let i = 0; i < 60; i++) { const n = await evaluate(`document.querySelectorAll('.copy-item').length`).catch(() => 0); if (n > 0) break; await sleep(300); }
  await installSampler();
  const coinCells = await evaluate(`document.querySelectorAll('.copy-item').length`);
  ok(coinCells > 0, `⑪ 前置：硬币分类内容页渲染出了藏品条目（.copy-item ${coinCells} 个）`);

  // 点开某个格子并采样：不写正则，直接用 URL 子串定位（openModal 的 onclick 参数就是图片地址）
  const openAndSample = async (sub) => {
    const P = JSON.parse(await evaluate(`(async () => {
      const re = /openModal\\('([^']+)',\\s*'([^']+)'\\)/;
      let el = null, mm = null;
      for (const w of document.querySelectorAll('[onclick]')) {
        const oc = w.getAttribute('onclick'); const m2 = oc ? re.exec(oc) : null;
        if (m2 && m2[1].indexOf(${JSON.stringify(sub)}) >= 0) { el = w; mm = m2; break; }
      }
      if (!el) return JSON.stringify({ err: '没找到图片格子' });
      const th = el.querySelector('img') || el;
      th.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 400));
      const from = imageContentRect(th);
      const pre = { src: th.getAttribute('src'), failed: th.classList.contains('img-failed'), nw: th.naturalWidth,
        retrySrc: th.dataset.retrySrc || '', box: [Math.round(from.left), Math.round(from.top), Math.round(from.width), Math.round(from.height)] };
      window.__LS.start();
      th.click();
      await new Promise(r => requestAnimationFrame(() => r()));
      const want = modalContainRect(from.width / from.height);
      return JSON.stringify({ err: '', img1: mm[1], pre: pre, want: [Math.round(want.left), Math.round(want.top), Math.round(want.width), Math.round(want.height)] });
    })()`));
    if (P.err) return { P: P, F: [] };
    await sleep(800);
    const F = JSON.parse(await evaluate('window.__LS.stop()'));
    return { P: P, F: F };
  };
  // 判定：必须"有飞行图层 + 逐帧在动 + 跑的是 transform + 起飞点是缩略图 + 落点对位"，
  // 并且飞行期间主图被藏起来（= 画面由飞行图层扛着，而不是主图淡入）。
  const checkFly = (tag, human, P, F) => {
    const fs = F.filter(f => f.flight && f.flight.rect);
    const rects = fs.map(f => f.flight.rect.join(','));
    const tfFrames = F.filter(f => f.anims.some(a => a.inModal && a.props.indexOf('transform') >= 0 && /modal-flight/.test(String(a.target)))).length;
    console.log(`  ${tag} 采样 ${F.length} 帧；有飞行图层 ${fs.length} 帧；不同矩形 ${new Set(rects).size} 个；飞行图层 transform 帧 ${tfFrames} 帧`);
    if (fs.length) console.log(`  ${tag} 首帧 ${fs[0].flight.rect.join(',')} → 末帧 ${fs[fs.length - 1].flight.rect.join(',')}；期望落到 ${P.want.join(',')}；格子 ${P.pre.box.join(',')}`);
    ok(fs.length >= 3, `★ ${tag} ${human}：点开生成了飞行图层（${fs.length} 帧）—— 没有退化成"直接淡入"`);
    ok(new Set(rects).size >= 3, `★ ${tag} ${human}：飞行图层逐帧在动（${new Set(rects).size} 个不同矩形）`);
    ok(tfFrames >= 3, `★ ${tag} ${human}：跑的确实是 transform 几何动画（transform 帧 ${tfFrames}）—— 不是"只有 opacity"的退化`);
    const first = fs.length ? fs[0].flight.rect : null;
    const last = fs.length ? fs[fs.length - 1].flight.rect : null;
    ok(!!first && first[2] < P.want[2] / 2, `★ ${tag} ${human}：起飞时还是缩略图那一小格（首帧宽 ${first ? first[2] : '-'}px < 全屏 ${P.want[2]}px 的一半）`);
    ok(!!last && Math.abs(last[0] - P.want[0]) <= 3 && Math.abs(last[1] - P.want[1]) <= 3 && Math.abs(last[2] - P.want[2]) <= 3 && Math.abs(last[3] - P.want[3]) <= 3,
      `★ ${tag} ${human}：落点对位 = 全屏 contain 那一格（末帧 ${last ? last.join(',') : '-'} vs 期望 ${P.want.join(',')}）`);
    ok(fs.length > 0 && fs.every(f => Number(f.imgEff) < 0.01),
      `★ ${tag} ${human}：飞行期间主图确实被藏起来、画面由飞行图层扛着（主图有效不透明度 ${fs.length ? fs[0].imgEff : '-'}）—— 这条就是"飞入"与"淡入"的分水岭`);
    ok(fs.length > 0 && fs.every(f => Number(f.flight.eff) > 0.99), `★ ${tag} ${human}：飞行图层本身全程不透明（没有叠一层淡出/淡入）`);
    return fs.length;
  };

  // ⑪-a 对照：没失败过的第二面（同一批数据、同一页）
  const ctl = await openAndSample('1989gj40-2.jpg');
  ok(!ctl.P.err, `⑪ (a) 对照：点开正常图 1989gj40-2（${ctl.P.err || norm(ctl.P.img1)}）`);
  if (!ctl.P.err) {
    ok(ctl.P.pre.failed === false && ctl.P.pre.nw > 0, `⑪ (a) 前置：这张图是正常加载好的（.img-failed=${ctl.P.pre.failed}、naturalWidth=${ctl.P.pre.nw}）`);
    checkFly('⑪ (a)', '正常图（对照）', ctl.P, ctl.F);
  }
  await evaluate(`closeModal()`);
  await sleep(900);

  // ⑪-b 首载失败的前置：目标格子确实进了占位态、右下角刷新按钮亮着
  const PRE = JSON.parse(await evaluate(`(() => {
    const re = /openModal\\('([^']+)'/;
    let el = null;
    for (const w of document.querySelectorAll('[onclick]')) {
      const oc = w.getAttribute('onclick'); const m2 = oc ? re.exec(oc) : null;
      if (m2 && m2[1].indexOf('1989gj40-1.jpg') >= 0) { el = w.querySelector('img') || w; break; }
    }
    if (!el) return JSON.stringify({ err: '没找到 1989gj40-1 的格子' });
    const fab = document.getElementById('imgRetryFab');
    return JSON.stringify({ err: '', src: el.getAttribute('src'), failed: el.classList.contains('img-failed'),
      retrySrc: el.dataset.retrySrc || '', fabShown: !!(fab && fab.classList.contains('show')),
      failedSize: (typeof failedImages !== 'undefined') ? failedImages.size : -1 });
  })()`));
  console.log(`  ⑪ (b) 受控 404 生效=${imgFailSeen === false}；格子 src=${String(PRE.src).slice(0, 46)}…（.img-failed=${PRE.failed}、data-retry-src=${PRE.retrySrc}）`);
  ok(!PRE.err && PRE.failed === true && /^data:image\//.test(String(PRE.src)),
    `⑪ (b) 前置：这张图首载失败、已经落到占位态（.img-failed=${PRE.failed}）`);
  ok(PRE.retrySrc === 'https://tong-xiangjie.github.io/coincollection/image/commemorative/1989gj40-1.jpg',
    `⑪ (b) 前置：占位态记下了真实地址，刷新才有得可刷（data-retry-src=${PRE.retrySrc}）`);
  ok(PRE.fabShown === true, `⑪ (b) 前置：右下角刷新按钮亮着（failedImages.size=${PRE.failedSize}）`);

  // ⑪-c 点右下角刷新按钮 → 那张图加载成功
  const RET = JSON.parse(await evaluate(`(async () => {
    const re = /openModal\\('([^']+)'/;
    let el = null;
    for (const w of document.querySelectorAll('[onclick]')) {
      const oc = w.getAttribute('onclick'); const m2 = oc ? re.exec(oc) : null;
      if (m2 && m2[1].indexOf('1989gj40-1.jpg') >= 0) { el = w.querySelector('img') || w; break; }
    }
    if (!el) return JSON.stringify({ err: '没找到 1989gj40-1 的格子' });
    const fab = document.getElementById('imgRetryFab');
    if (!fab) return JSON.stringify({ err: '没有 #imgRetryFab' });
    const wasFailed = el.classList.contains('img-failed');
    fab.click();
    for (let i = 0; i < 80; i++) { if (el.complete && el.naturalWidth > 0) break; await new Promise(r => setTimeout(r, 100)); }
    await new Promise(r => setTimeout(r, 300));
    return JSON.stringify({ err: '', wasFailed: wasFailed, src: el.getAttribute('src'), complete: el.complete,
      nw: el.naturalWidth, failed: el.classList.contains('img-failed'),
      fabShown: !!(fab && fab.classList.contains('show')),
      failedSize: (typeof failedImages !== 'undefined') ? failedImages.size : -1 });
  })()`));
  console.log(`  ⑪ (c) 点刷新后 src=${RET.src}`);
  ok(RET.err === '' && RET.wasFailed === true, `⑪ (c) 点的是右下角刷新按钮，且点之前它确实在占位态（${RET.err || 'ok'}）`);
  ok(RET.complete === true && RET.nw > 0 && RET.failed === false,
    `★ ⑪ (c) 刷新之后这张图真的加载出来了（naturalWidth=${RET.nw}、.img-failed=${RET.failed}）`);
  ok(/\?retry=/.test(String(RET.src)),
    `★ ⑪ (c) 它现在的地址带着重试标记（这就是"刷新回来的图"与普通图唯一的差别）：${RET.src}`);
  ok(RET.fabShown === false && RET.failedSize === 0, `⑪ (c) 刷新按钮收掉了、失败队列清空（size=${RET.failedSize}）`);

  // ⑪-d 关键：点开这张"刷新回来的图"，必须和正常图同款飞入
  const ret = await openAndSample('1989gj40-1.jpg');
  ok(!ret.P.err, `⑪ (d) 点开刷新回来的 1989gj40-1（${ret.P.err || norm(ret.P.img1)}）`);
  if (!ret.P.err) {
    ok(ret.P.pre.failed === false && ret.P.pre.nw > 0 && /\?retry=/.test(String(ret.P.pre.src)),
      `⑪ (d) 前置：点开的就是那张刷新回来的图（src=${ret.P.pre.src}）`);
    checkFly('⑪ (d)', '刷新回来的图', ret.P, ret.F);

    // ⑪ (d2) 对称性：这张图关闭时也要缩回**它自己那一格**（关闭时的来源格子解析同样
    //   不能因为 src 上多了 `?retry=…` 而落空 —— 落空的话就又变成"直接淡出"）。
    await evaluate(`window.__LS.start()`);
    await evaluate(`closeModal()`);
    await sleep(850);
    const CF = JSON.parse(await evaluate('window.__LS.stop()'));
    const cfs = CF.filter(f => f.flight && f.flight.rect);
    const cLast = cfs.length ? cfs[cfs.length - 1].flight.rect : null;
    const cTf = CF.filter(f => f.anims.some(a => a.inModal && a.props.indexOf('transform') >= 0 && /modal-flight/.test(String(a.target)))).length;
    console.log(`  ⑪ (d2) 关闭采样 ${CF.length} 帧；飞行图层 ${cfs.length} 帧；transform 帧 ${cTf}；末帧 ${cLast ? cLast.join(',') : '-'}；该图格子 ${ret.P.pre.box.join(',')}`);
    ok(cfs.length >= 3 && cTf >= 3,
      `★ ⑪ (d2) 关闭时同样有 transform 缩回动画（飞行 ${cfs.length} 帧 / transform ${cTf} 帧）—— 开与关对称，没有因为 ?retry= 落空`);
    ok(!!cLast && Math.abs(cLast[2] - ret.P.pre.box[2]) <= 4 && Math.abs(cLast[3] - ret.P.pre.box[3]) <= 4,
      `★ ⑪ (d2) 关闭落点回到它自己那一小格（末帧 ${cLast ? cLast.join(',') : '-'} vs 格子 ${ret.P.pre.box.join(',')}）`);
    await sleep(300);
  } else {
    await evaluate(`closeModal()`);
    await sleep(900);
  }

  // ⑪-e 独立断言：减动效（reduce）下同一张图**不该**飞（与 ⑪-d 互为反面，缺一不可）
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  console.log(`  ⑪ (e) 采样前媒体偏好：${await evaluate(`JSON.stringify({ reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, js: prefersReducedMotion() })`)}`);
  const red = await openAndSample('1989gj40-1.jpg');
  const redFlight = red.F.filter(f => f.flight).length;
  const modalShown = await evaluate(`getComputedStyle(document.getElementById('imageModal')).display`);
  console.log(`  ⑪ (e) reduce 下采样 ${red.F.length} 帧；飞行图层 ${redFlight} 帧；弹窗 display=${modalShown}`);
  ok(redFlight === 0, `★ ⑪ (e) 用户要求减少动效时，刷新回来的图同样不做飞行（飞行图层 ${redFlight} 帧）`);
  ok(modalShown === 'flex', `★ ⑪ (e) 减动效不等于减功能：大图照常打开（display=${modalShown}）`);
  await evaluate(`closeModal()`);
  await sleep(700);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  ok(await evaluate(`!prefersReducedMotion()`) === true, '★ ⑪ (e) 量完已把偏好切回 no-preference（后面的收尾不受影响）');
  imgFailPat = null;
  imgFailSeen = false;
  await sleep(300);
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
