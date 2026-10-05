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
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || '')); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
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
console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch { }
try { child.kill(); } catch { }
try { server.close(); } catch { }
process.exit(fail === 0 ? 0 : 1);
