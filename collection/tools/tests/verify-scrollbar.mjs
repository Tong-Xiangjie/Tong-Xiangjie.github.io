// 自绘滚动条（collection/scrollbar.js + layout.css 末尾那一节）
//
// 用户报告与要求：
//   · 原生滚动条"总是容易把整个网站横向变窄一点点" —— 滚动条一出现，内容区宽度
//     就被吃掉约 15px（Windows Chrome 的经典滚动条占布局宽度）；
//   · 自己写：**悬浮在内容上方**（绝不压缩内容区）、停手一段时间自动隐藏、
//     鼠标滑到滚动条的位置又会出来；
//   · 略微细一点、贴合网站风格；
//   · 横向不需要（本站没有需要横向滚动的地方）。
//
// 这条用例的重点不是"有没有画出条"，而是：
//   ① 原生条是不是在 **CSS 里提前** 收掉了（否则首屏会先被压缩一下，再弹回来）；
//   ② 容器自己有没有因为滚动条而损失宽度（offsetWidth - clientWidth == 0）；
//   ③ 自绘条是不是真的浮层（position: fixed、父节点是 body、不占位、不改容器定位）；
//   ④ "自动隐藏 → 鼠标移到滚动条那一带又出来"这条交互链。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ══════════════════════════════════════════════════════════════
console.log('══════ ① 静态：原生条必须在 CSS 里提前收掉（不能等 JS） ══════\n');

const css = readFileSync('collection/layout.css', 'utf8');
const js = readFileSync('collection/scrollbar.js', 'utf8');
const html = readFileSync('collection/index.html', 'utf8');

// 找出"声明了 scrollbar-width: none"的那条规则的选择器清单
const ruleBlocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
const hideY = ruleBlocks.filter(r => /scrollbar-width\s*:\s*none/.test(r.body));
const hideYSelectors = hideY.map(r => r.sel).join(' ');
for (const sel of ['.view-scroll-container', '#app', '.content', '.sidebar']) {
  ok(hideYSelectors.includes(sel),
    `① ${sel} 在"提前收掉原生条"的选择器清单里（不能只靠 JS 事后加 .cscroll-host —— 那样首屏会先被压缩约 15px 再弹回来）`);
}
const webkitRules = ruleBlocks.filter(r => /::-webkit-scrollbar/.test(r.sel));
const webkitW0 = webkitRules.filter(r => /width\s*:\s*0/.test(r.body));
ok(webkitW0.length >= 1 && webkitW0.map(r => r.sel).join(' ').includes('.view-scroll-container'),
  '① 同一批选择器有 ::-webkit-scrollbar { width: 0 }（Chrome/Safari 收纵向条）');
ok(webkitW0.every(r => /width\s*:\s*0/.test(r.body)), '① WebKit 侧只收纵向（width），横向原生条保留');

ok(/position\s*:\s*fixed/.test(css.match(/\.cscroll-bar\s*\{[^}]*\}/)?.[0] || ''),
  '① 自绘条是 position: fixed（浮层，不参与布局 —— 这是"不压缩内容区"的关键）');
ok(!/\.cscroll-bar\s*\{[^}]*position\s*:\s*(relative|absolute)/.test(css),
  '① 自绘条没有用 relative/absolute（那会要求容器成为定位基准，把 .tl-heatmap-tip 之类的绝对定位后代带偏）');

// 容器本身不能被加上 position/contain 之类的属性
ok(!/\.cscroll-host\s*\{[^}]*\b(position|contain|padding-right|margin-right)\s*:/i.test(css),
  '① .cscroll-host 没有给容器加 position / contain / padding-right（加任何一条都会挤压内容区）');
ok(!/el\.style\.(position|width|paddingRight|marginRight)\s*=/.test(js),
  '① scrollbar.js 没有改容器的 position/width/padding/margin');

ok(!/cscroll-x/.test(js) && !/cscroll-x/.test(css),
  '① 没有做横向自绘条（用户确认：本站没有需要横向滚动的地方）');
ok(html.includes('scrollbar.js'), '① index.html 引入了 scrollbar.js');

// ══════════════════════════════════════════════════════════════
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpSB-'));
const DP = 13500 + Math.floor(Math.random() * 90);
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
// 主机（CI 的 Windows runner）默认关系统动画，会把 prefers-reduced-motion 报成 reduce，
// 而这里量的正是淡入淡出那条路径，钉死成 no-preference。
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

// 用"设置"视图：它的滚动容器是 core.js 内联建的 #view-settings_container（内容很长）
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#settings` });
for (let i = 0; i < 140; i++) { const r = await evaluate(`document.readyState === 'complete' && !!document.querySelector('.view-scroll-container')`).catch(() => false); if (r) break; await sleep(120); }
await sleep(1500);

const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1, ...extra });
const wheel = (x, y, dy) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse' });

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ② 内容区没有被压缩（用户报的"横向变窄"） ══════\n');

const INFO = `(()=>{
  const hosts = [...document.querySelectorAll('*')].filter(e => e.__cscroll);
  const host = hosts.find(e => e.offsetParent !== null) || hosts[0];
  if (!host) return JSON.stringify({ err: '没有任何容器被挂上自绘滚动条', 候选: [...document.querySelectorAll('.view-scroll-container')].map(e => ({ id: e.id, sh: e.scrollHeight, ch: e.clientHeight, d: getComputedStyle(e).display })) });
  const rec = host.__cscroll;
  const bar = rec.bar, thumb = rec.thumb;
  const cs = getComputedStyle(host);
  const r = host.getBoundingClientRect();
  const rb = bar.getBoundingClientRect();
  const rt = thumb.getBoundingClientRect();
  // 平台上"原生条吃多少宽度"：同样宽度的两个临时 div，一个有原生条、一个收掉
  const probe = (extraCss) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:-9999px;top:0;width:300px;height:100px;overflow-y:auto;' + extraCss;
    d.innerHTML = '<div style="height:600px"></div>';
    document.body.appendChild(d);
    const w = d.clientWidth;
    d.remove();
    return w;
  };
  return JSON.stringify({
    id: host.id || host.className,
    容器宽: host.offsetWidth, 容器可用宽: host.clientWidth,
    被吃掉: host.offsetWidth - host.clientWidth,
    scrollbarWidth: cs.scrollbarWidth,
    scrollH: host.scrollHeight, clientH: host.clientHeight, scrollTop: Math.round(host.scrollTop),
    整流器原生条宽: 300 - probe(''),
    收掉后宽: probe('scrollbar-width:none;'),
    条的position: getComputedStyle(bar).position,
    条的父节点: bar.parentNode === document.body ? 'body' : (bar.parentNode.tagName + '.' + bar.parentNode.className),
    条与容器右边缘差: Math.round(rb.right - r.right),
    条高: Math.round(rb.height), 容器可视高: host.clientHeight,
    滑块高: Math.round(rt.height), 期望滑块高: Math.max(24, Math.round(host.clientHeight * host.clientHeight / host.scrollHeight)),
    滑块宽: Math.round(rt.width),
    容器是否被改过position: cs.position,
    条数: hosts.length,
    横向条数: document.querySelectorAll('.cscroll-x').length
  });
})()`;
const I = JSON.parse(await evaluate(INFO));
if (I.err) { ok(false, '② 找到被接管的滚动容器：' + I.err + ' ' + JSON.stringify(I.候选)); }
else {
  console.log(`  被接管的容器：${I.id}  内容 ${I.scrollH}/${I.clientH}px  自绘条数=${I.条数}`);
  console.log(`  平台上原生条吃掉：${I.整流器原生条宽}px（300 → ${300 - I.整流器原生条宽}）；同样的宽度收掉原生条后 = ${I.收掉后宽}px`);
  console.log(`  这个容器：offsetWidth=${I.容器宽} clientWidth=${I.容器可用宽} 差=${I.被吃掉}px`);
  ok(I.整流器原生条宽 > 0, `② 先确认这台机器上原生滚动条确实占宽（吃掉 ${I.整流器原生条宽}px）—— 不然这条断言没意义`);
  ok(I.收掉后宽 > 300 - I.整流器原生条宽, `② 用 scrollbar-width:none 收掉后宽度确实回来了（${300 - I.整流器原生条宽} → ${I.收掉后宽}）`);
  ok(I.被吃掉 === 0, `★ ② 容器可用宽度没有被滚动条吃掉（offsetWidth - clientWidth = ${I.被吃掉}px，修复前这里会是 ${I.整流器原生条宽}px）`);
  ok(I.scrollbarWidth === 'none', `② 容器的 computed scrollbar-width = ${I.scrollbarWidth}（CSS 提前收掉，不等 JS）`);
  ok(I.条的position === 'fixed', `② 自绘条是浮层（position: ${I.条的position}），不参与布局`);
  ok(I.条的父节点 === 'body', `② 自绘条挂在 body 上（${I.条的父节点}），不是塞进容器里挤内容`);
  ok(Math.abs(I.条与容器右边缘差) <= 1, `② 自绘条贴着容器右边缘（差 ${I.条与容器右边缘差}px）`);
  ok(I.容器是否被改过position === 'static' || I.容器是否被改过position === 'relative',
     `② 容器自身 position 保持 ${I.容器是否被改过position}（没有为了浮层去改它，避免带偏内部绝对定位）`);
  ok(Math.abs(I.滑块高 - I.期望滑块高) <= 2, `② 滑块长度与实际内容成比例（${I.滑块高}px vs 期望 ${I.期望滑块高}px）`);
  ok(I.滑块宽 > 0 && I.滑块宽 <= 10, `② 滑块比原生条细（视觉 ${I.滑块宽}px，原生是 ${I.整流器原生条宽}px，用户要求"略微细一点"）`);
  ok(I.横向条数 === 0, `② 没有画横向自绘条（${I.横向条数} 个）`);
}

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ③ 悬浮出现 / 自动隐藏 / 移到滚动条位置又出来 ══════\n');

const RECT = `(()=>{ const h=[...document.querySelectorAll('*')].filter(e=>e.__cscroll && e.offsetParent!==null)[0];
  if(!h) return JSON.stringify({err:1});
  const r=h.getBoundingClientRect();
  return JSON.stringify({ left:Math.round(r.left), right:Math.round(r.right), top:Math.round(r.top), bottom:Math.round(r.bottom), cx:Math.round(r.left+r.width/2), cy:Math.round(r.top+r.height/2) }); })()`;
const rc = JSON.parse(await evaluate(RECT));
const barOn = () => evaluate(`(()=>{ const h=[...document.querySelectorAll('*')].filter(e=>e.__cscroll && e.offsetParent!==null)[0];
  if(!h) return 'no-host'; return h.__cscroll.bar.classList.contains('cscroll-on'); })()`);

if (rc.err) { ok(false, '③ 找不到可视的滚动容器'); }
else {
  // 先移到侧边栏上（容器之外），再移进内容区 —— 这样不管无头浏览器初始指针在哪，
  // "跨边界进入"这件事都真实发生；否则初始指针本来就在内容区里，pointerenter 不会触发。
  await mouse('mouseMoved', 60, 300);
  await sleep(120);
  await mouse('mouseMoved', rc.cx, rc.cy);
  await sleep(150);
  ok(await barOn() === true, '③ 鼠标从外面进入内容区 → 滚动条出现');
  // 鼠标停在中间不动，滚动一段后应当自动隐藏
  await wheel(rc.cx, rc.cy, 400);
  await sleep(200);
  const afterWheel = await evaluate(`(()=>{ const h=[...document.querySelectorAll('*')].filter(e=>e.__cscroll && e.offsetParent!==null)[0];
    return JSON.stringify({ st: Math.round(h.scrollTop), on: h.__cscroll.bar.classList.contains('cscroll-on') }); })()`);
  const aw = JSON.parse(afterWheel);
  ok(aw.st > 0, `③ 滚轮仍然是原生行为（scrollTop = ${aw.st}）—— 自绘条没有接管滚轮`);
  ok(aw.on === true, '③ 滚动时滚动条是显示的');
  await sleep(1500);
  ok(await barOn() === false, '③ 停手一段时间后自动隐藏（用户要求）');
  // 鼠标滑到滚动条那一带 → 又出来
  await mouse('mouseMoved', rc.right - 6, rc.cy);
  await sleep(150);
  ok(await barOn() === true, '★ ③ 鼠标滑到滚动条的位置 → 又出来了（用户要求）');
  // 鼠标再移开 → 又隐藏
  await mouse('mouseMoved', rc.cx, rc.cy);
  await sleep(900);
  ok(await barOn() === false, '③ 鼠标移开后又隐藏（不是一直赖着）');
}

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ④ 拖动滑块 / 点击轨道 ══════\n');
const geo = JSON.parse(await evaluate(`(()=>{ const h=[...document.querySelectorAll('*')].filter(e=>e.__cscroll && e.offsetParent!==null)[0];
  if(!h) return JSON.stringify({err:1});
  const rec=h.__cscroll; const rt=rec.thumb.getBoundingClientRect(); const rb=rec.bar.getBoundingClientRect();
  return JSON.stringify({ st: Math.round(h.scrollTop), tx: Math.round(rt.left+rt.width/2), ty: Math.round(rt.top+rt.height/2),
    th: Math.round(rt.height), bb: Math.round(rb.bottom), maxScroll: h.scrollHeight-h.clientHeight }); })()`));
if (geo.err) { ok(false, '④ 找不到可视的滚动容器'); }
else {
  await evaluate(`(()=>{ [...document.querySelectorAll('*')].filter(e=>e.__cscroll)[0].scrollTop = 0; return 1; })()`);
  await sleep(120);
  await mouse('mouseMoved', geo.tx, geo.ty);
  await mouse('mousePressed', geo.tx, geo.ty, { buttons: 1 });
  for (let i = 1; i <= 5; i++) { await mouse('mouseMoved', geo.tx, geo.ty + i * 30, { buttons: 1, button: 'left' }); await sleep(40); }
  await mouse('mouseReleased', geo.tx, geo.ty + 150, { buttons: 1 });
  await sleep(200);
  const afterDrag = JSON.parse(await evaluate(`(()=>{ const h=[...document.querySelectorAll('*')].filter(e=>e.__cscroll)[0];
    return JSON.stringify({ st: Math.round(h.scrollTop), max: h.scrollHeight-h.clientHeight }); })()`));
  ok(afterDrag.st > 0, `④ 拖动滑块能把内容滚下去（0 → ${afterDrag.st} / 最大 ${afterDrag.max}）`);
  const ratio = afterDrag.st / afterDrag.max;
  ok(ratio > 0.1 && ratio < 0.9, `④ 拖动 150px 大致对应内容滚动了 ${(ratio * 100).toFixed(0)}%（不是一拖到底也不是没动）`);
}

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
try { child.kill(); } catch {}
try { server.close(); } catch {}
process.exit(fail === 0 ? 0 : 1);
