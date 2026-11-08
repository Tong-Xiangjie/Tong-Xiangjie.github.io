// 自定义悬浮提示（tooltip）验证：collection/tools/tests/verify-tooltip.mjs
// 用户："鼠标悬浮的时候有时会出现一个框框显示文字，那个东西叫什么来着，能不能也自己写一个，
//        原生的有点丑" + "那个框框出现和消失的时候可以考虑加一点动画"。
// 那个"框框"就是浏览器原生的 title 气泡（tooltip）。本用例量的是自己写的那套：
// 悬停弹的是自己的气泡、原生气泡被掐掉（title 属性在悬停期间被挪走）、进出都有动画、
// 长文字会换行、顶部放不下会翻到下方、离开/Esc 会收起并把 title 还回去。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full) || statSync(full).isDirectory()) { res.writeHead(404).end('nf'); return; }
    const buf = readFileSync(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpTip-'));
const DP = 17540;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const J = async e => JSON.parse(await evaluate(`(async()=>JSON.stringify(await(async()=>{ ${e} })()))()`));
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}` });
for (let i = 0; i < 140; i++) {
  const r = await evaluate(`document.readyState==='complete'`).catch(() => false);
  if (r) break; await sleep(120);
}
await sleep(700);
await evaluate(`
window.__mk = function (opts) {
  var d = document.createElement('button');
  d.type = 'button';
  d.textContent = '靶子';
  var old = document.getElementById('tipTarget');
  if (old) old.parentNode.removeChild(old);
  d.id = 'tipTarget';
  d.setAttribute('title', opts.text);
  d.style.cssText = 'position:fixed;left:' + opts.left + 'px;top:' + opts.top + 'px;padding:4px 10px;z-index:5;';
  document.body.appendChild(d);
  return 1;
};
window.__hover = async function (x, y, wait) {
  var d = document.getElementById('tipTarget');
  if (typeof x !== 'number') {
    // 不给坐标就用靶子中心（真机上悬停必然伴随一次 mousemove，这里照样补上，行为才一致）
    var a = d.getBoundingClientRect();
    x = Math.round(a.left + a.width / 2);
    y = Math.round(a.top + a.height / 2);
  }
  // ★ 顺序要紧：先 mousemove（模块用鼠标位置当锚点），再 mouseover
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
  d.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
  await new Promise(r => setTimeout(r, wait === 0 ? 30 : 620));
  return 1;
};
window.__move = async function (x, y) {
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
  await new Promise(r => setTimeout(r, 140));
  return 1;
};
window.__unhover = async function () {
  var d = document.getElementById('tipTarget');
  d.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  await new Promise(r => setTimeout(r, 60));
  return 1;
};
window.__tip = function () {
  var t = document.querySelector('.dsh-tip');
  if (!t) return null;
  var a = t.getBoundingClientRect(), cs = getComputedStyle(t);
  return { exists: true, text: String(t.textContent || ''), cls: t.className,
    opacity: parseFloat(cs.opacity), visibility: cs.visibility, display: cs.display,
    dur: cs.transitionDuration, top: Math.round(a.top), bottom: Math.round(a.bottom),
    left: Math.round(a.left), right: Math.round(a.right), width: Math.round(a.width),
    height: Math.round(a.height), maxW: cs.maxWidth, ax: cs.getPropertyValue('--tip-ax') };
};
window.__target = function () { var d = document.getElementById('tipTarget'); var a = d.getBoundingClientRect();
  return { top: Math.round(a.top), left: Math.round(a.left), width: Math.round(a.width),
    height: Math.round(a.height),
    bottom: Math.round(a.bottom), title: d.getAttribute('title'), tipAttr: d.getAttribute('data-tip') }; };
`);

console.log('══════ ① 模块与样式 ══════\n');
ok(await evaluate(`typeof window.dshTooltip === 'object' && window.dshTooltip !== null`), '① 自定义提示模块已加载（window.dshTooltip）');
ok(await evaluate(`!!document.getElementById('dsh-tip-style')`), '① 它自己注入了样式（不依赖 layout.css）');

console.log('\n══════ ② 悬停弹出的是自己的气泡 ══════\n');
await J(`await window.__mk({ text: '这是一个提示文字', left: 600, top: 400 }); await window.__hover(); return 1;`);
const t1 = await J(`return { tip: window.__tip(), tgt: window.__target() };`);
ok(!!t1.tip && t1.tip.display !== 'none' && t1.tip.opacity > 0.9 && t1.tip.visibility === 'visible',
  `② 悬停后弹出自己的气泡（opacity=${t1.tip && t1.tip.opacity}, visibility=${t1.tip && t1.tip.visibility}）`);
ok(t1.tip && t1.tip.text === '这是一个提示文字', `② 文字就是 title 里那句（「${t1.tip && t1.tip.text}」）`);
ok(t1.tgt.title === null && t1.tgt.tipAttr === '这是一个提示文字',
  `② 悬停期间 title 被挪进 data-tip（title=${t1.tgt.title}）—— 原生气泡因此不会再弹`);
// ★ 锚点从"元素矩形"改成"鼠标位置"之后，这条期望也跟着变：气泡在**鼠标**上方，
//   而鼠标停在元素中心 —— 所以气泡底可能比元素顶还低一点（那是对的，不是回归）。
//   真正要守的是：气泡在鼠标上方 10px 以上。
const mouseY = t1.tgt.top + t1.tgt.height / 2;
ok(t1.tip && t1.tip.cls.indexOf('tip-above') >= 0 && t1.tip.bottom <= mouseY - 10,
  `② 弹在鼠标上方（气泡底 ${t1.tip && t1.tip.bottom} ≤ 鼠标 y ${Math.round(mouseY)} - 10）`);
ok(t1.tip && Math.abs((t1.tip.left + t1.tip.right) / 2 - (t1.tgt.left + t1.tgt.width / 2)) <= 2,
  `② 水平居中对齐（气泡中心 ${t1.tip && Math.round((t1.tip.left + t1.tip.right) / 2)} vs 靶子中心 ${Math.round(t1.tgt.left + t1.tgt.width / 2)}）`);
ok(t1.tip && t1.tip.width <= 360 + 30, `② 有最大宽度、不会拉成一长条（实测 ${t1.tip && t1.tip.width}px）`);

console.log('\n══════ ③ 出现和消失都有动画 ══════\n');
const inDur = parseFloat(String(t1.tip.dur).split(',')[0]);
ok(t1.tip.cls.indexOf('tip-in') >= 0 && inDur > 0.05,
  `③ 出现有过渡（class=${t1.tip.cls}、时长 ${inDur}s）`);
await J(`await window.__unhover(); return 1;`);
const mid = await J(`return window.__tip();`);
const outDur = parseFloat(String(mid.dur).split(',')[0]);
ok(mid && mid.cls.indexOf('tip-in') < 0 && outDur > 0.05,
  `③ 消失也有过渡、且比出现更慢一点（进 ${inDur}s / 退 ${outDur}s）`);
await sleep(320);
const gone = await J(`return window.__tip();`);
ok(gone && gone.display === 'none', `③ 动画走完才真正隐藏（display=${gone && gone.display}）`);
const restored = await J(`return window.__target();`);
ok(restored.title === '这是一个提示文字' && restored.tipAttr === null,
  `③ 离开后 title 还回去了（title=「${restored.title}」）——读屏软件和测试还能读到`);

console.log('\n══════ ④ 顶部放不下翻到下方 / 长文字换行 / Esc 收起 ══════\n');
await J(`await window.__mk({ text: '贴顶的靶子', left: 600, top: 0 }); await window.__hover(); return 1;`);
const t2 = await J(`return { tip: window.__tip(), tgt: window.__target() };`);
ok(t2.tip && t2.tip.cls.indexOf('tip-below') >= 0 && t2.tip.top >= t2.tgt.bottom - 1,
  `④ 贴顶时翻到元素下方（气泡顶 ${t2.tip && t2.tip.top} ≥ 靶子底 ${t2.tgt.bottom}）`);
await J(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1;`);
await sleep(320);
ok((await J(`var t=window.__tip(); return t ? t.display : 'none'`)) === 'none', '④ Esc 收起气泡');

const longText = '长'.repeat(200);
await J(`await window.__mk({ text: '${longText}', left: 300, top: 300 }); await window.__hover(); return 1;`);
const t3 = await J(`return window.__tip();`);
ok(t3 && t3.height > 40 && t3.width <= 390,
  `④ 超长提示会换行而不是撑成一条（宽 ${t3 && t3.width}px、高 ${t3 && t3.height}px）`);

console.log('\n══════ ⑤ 贴着鼠标 + 白天/夜间跟主题 ══════\n');
// 用户："有时候出现的地方会距离鼠标有点远" —— 用一个 1000px 宽的靶子把原因复现出来：
// 鼠标放在它左边（x=180），旧实现按元素矩形居中，气泡会跑到元素中心（x≈600）去。
await J(`await window.__mk({ text: '宽靶子', left: 100, top: 300 }); return 1;`);
await evaluate(`document.getElementById('tipTarget').style.width='1000px';`);
await J(`await window.__hover(180, 320); return 1;`);
const near = await J(`return { tip: window.__tip(), tgt: window.__target() };`);
const tipCx = (near.tip.left + near.tip.right) / 2;
const tgtCx = near.tgt.left + near.tgt.width / 2;
ok(Math.abs(tipCx - 180) <= 3, `⑤ 气泡贴在鼠标上（鼠标 x=180，气泡中心 ${Math.round(tipCx)}）`);
ok(Math.abs(tipCx - tgtCx) > 200,
  `⑤ 不再按元素居中（元素中心 ${Math.round(tgtCx)}，差 ${Math.round(Math.abs(tipCx - tgtCx))}px —— 这就是"离鼠标有点远"的来由）`);
ok(near.tip.bottom <= 320, `⑤ 鼠标在 y=320，气泡在它上方（气泡底 ${near.tip.bottom}）`);
await J(`await window.__move(900, 320); return 1;`);
const moved = await J(`return window.__tip();`);
ok(Math.abs((moved.left + moved.right) / 2 - 900) <= 3,
  `⑤ 鼠标往右移，气泡跟着走（移到 x=900，气泡中心 ${Math.round((moved.left + moved.right) / 2)}）`);

// 白天/夜间：底色/文字用主题变量（applyTheme 写在 documentElement 上的那套），不是写死的深色
const theme = await J(`var t=document.querySelector('.dsh-tip');
  var before=getComputedStyle(t).backgroundColor;
  var root=document.documentElement;
  root.style.setProperty('--bg-light','rgb(250, 250, 250)');
  root.style.setProperty('--text','rgb(20, 20, 20)');
  var after=getComputedStyle(t).backgroundColor, fg=getComputedStyle(t).color;
  root.style.removeProperty('--bg-light'); root.style.removeProperty('--text');
  return { before: before, after: after, fg: fg };`);
ok(theme.before !== 'rgba(26, 26, 30, 0.96)', `⑤ 底色不再是写死的深色，走主题变量（当前主题下是 ${theme.before}）`);
ok(theme.after === 'rgb(250, 250, 250)' && theme.fg === 'rgb(20, 20, 20)',
  `⑤ 主题换成浅色（--bg-light/--text 改成白底黑字）气泡立刻跟着变（${theme.after} / ${theme.fg}）——白天模式自动生效`);

console.log('\n══════ ⑥ 小三角也有主题色描边 ══════\n');
// 用户："小三角目前缺了主题色描边，其他没问题"
const arrow = await J(`var t=document.querySelector('.dsh-tip');
  var a=getComputedStyle(t,'::after'), b=getComputedStyle(t);
  var root=document.documentElement;
  root.style.setProperty('--border','rgb(7, 8, 9)');
  var a2=getComputedStyle(t,'::after').borderRightColor;
  root.style.removeProperty('--border');
  return { cls: t.className, w: a.borderRightWidth, shown: a.borderRightColor,
    hiddenStyle: a.borderTopStyle, hiddenW: a.borderTopWidth,
    bubble: b.borderTopColor, themed: a2 };`);
ok(arrow.cls.indexOf('tip-above') >= 0 && arrow.w === '1px',
  `⑥ 朝下的小三角有 1px 描边（border-right-width=${arrow.w}）——旧版这里是 0px，等于没描边`);
ok(arrow.shown === arrow.bubble && arrow.shown !== 'rgba(0, 0, 0, 0)',
  `⑥ 描边用的是气泡同款主题色（箭头 ${arrow.shown} = 气泡 ${arrow.bubble}）`);
// ★ 判"这条边不描"要看 border-*-style/width，不能看 color：写了 border-top: 0 之后
//   border-top-color 照样算得出颜色（第一版就是这么写错的），真正变成 none/0px 的是 style 和 width。
ok(arrow.hiddenStyle === 'none' && arrow.hiddenW === '0px',
  `⑥ 只留朝外那两条边，另外两条不描（朝内那条 style=${arrow.hiddenStyle}、width=${arrow.hiddenW}，否则小三角会变成一个小方块）`);
ok(arrow.themed === 'rgb(7, 8, 9)',
  `⑥ 描边跟着主题变量走（把 --border 改成 rgb(7,8,9) 后箭头描边立刻跟着变：${arrow.themed}）`);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 3).forEach(e => console.log('    ! ' + String(e).slice(0, 160)));
try { ws.close(); } catch { }
child.kill(); server.close();
process.exitCode = fail ? 1 : 0;
