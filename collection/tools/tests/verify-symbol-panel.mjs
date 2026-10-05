// 特殊字符面板的出现/消失动画（collection/symbol-picker.js + layout.css 的 .symbol-panel）
//
// 用户要求："特殊字符面板可以加一个出现消失的动画"。
//
// 原来的实现是 .symbol-panel{display:none} / .symbol-panel.open{display:block} —— 纯硬切，
// 没有任何过渡。现在改成 display 与可见性分离：
//   .shown  → 进入布局（display:block），但还是 opacity:0 / 缩小上移
//   .open   → 淡入 + 移回原位 + 放大到 1
// 打开时 JS 必须先结算一次样式再挂 .open，否则"从 display:none 直接到目标样式"在同一次
// 样式计算里完成，浏览器拿不到 before-change style，动画根本不会播（这是最容易写错的一步）。
// 关闭时要等动画跑完再把 display 收掉，期间面板还在布局里。
//
// 这条用例守两件事：
//   ① 出现和消失**真的有中间帧**（不是硬切），且用站点约定的时长/缓动；
//   ② 收起之后面板不能留在布局里（否则会被自绘滚动条当成滚动容器挂滑块、还会吃点击），
//      而且"插入字符 / Esc / 点遮罩 / 切版块"这些既有行为一字不改。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ══════════════════════════════════════════════════════════════
console.log('══════ ① 静态：动画写在 CSS 里，且 display 与可见性分离 ══════\n');
const css = readFileSync('collection/layout.css', 'utf8');
const js = readFileSync('collection/symbol-picker.js', 'utf8');
const panelCss = css.match(/\.symbol-panel\s*\{[^}]*\}/)?.[0] || '';
const openCss = css.match(/\.symbol-panel\.open\s*\{[^}]*\}/)?.[0] || '';
const shownCss = css.match(/\.symbol-panel\.shown\s*\{[^}]*\}/)?.[0] || '';

ok(/transition\s*:[^;]*opacity[^;]*transform|transition\s*:[^;]*transform[^;]*opacity/.test(panelCss),
  '① .symbol-panel 上有 opacity/transform 的 transition（不再是 display 硬切）');
ok(/opacity\s*:\s*0/.test(panelCss) && /transform\s*:/.test(panelCss),
  '① 面板基础态是不可见 + 有位移/缩放（动画的起点）');
ok(/opacity\s*:\s*1/.test(openCss) && /transform\s*:\s*none/.test(openCss),
  '① .open 是可见 + 归位（动画的终点）');
ok(/display\s*:\s*block/.test(shownCss) && !/display\s*:\s*block/.test(openCss),
  '① display 交给 .shown，可见性交给 .open —— 两者分开，动画才有时机可插');
ok(/display\s*:\s*none/.test(panelCss), '① 基础态仍是 display:none（收起时不占布局、不吃点击）');
ok(/--dur-2/.test(openCss) && /--ease-out/.test(openCss),
  '① 打开用 --dur-2/--ease-out（站点"小面板"那一档：手风琴/下拉/提示）');
ok(/--dur-1/.test(panelCss) && /--ease-in/.test(panelCss),
  '① 收起用更短的 --dur-1/--ease-in（收得比开得利落）');
ok(/prefers-reduced-motion[\s\S]{0,160}\.symbol-panel\s*,\s*\.symbol-panel\.open\s*\{\s*transition:\s*none/.test(css),
  '① 有"减少动态效果"的兜底，且**两个状态都写了**（只写基础态的话，进入侧会被 .open 的 transition 盖住）');
ok(/void panel\.offsetHeight/.test(js),
  '① 打开前强制结算一次样式（不写这行动画不会播，只会硬切）');
ok(/clearTimeout\(panelHideTimer\)/.test(js) && /panelOpen\) panel\.classList\.remove\('shown'\)/.test(js),
  '① 收起用定时器延迟摘 display，并且开面板时会清掉它（避免"先隐后显"闪一下）');

// ══════════════════════════════════════════════════════════════
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(404).end('dir'); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpSym-'));
const DP = 14200 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '')).slice(0, 180));
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
  return r.result.value;
}
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#notes` });
for (let i = 0; i < 140; i++) { const r = await evaluate(`typeof initSymbolPicker === 'function' && !!document.getElementById('symbolToggle') && document.readyState === 'complete'`).catch(() => false); if (r) break; await sleep(150); }
await sleep(1500);

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ② 出现：点 Ω 真的有中间帧 ══════\n');
// 采样器：点开后逐帧读 opacity/transform，返回时间线
const OPEN_ANIM = `(()=>{
  const panel = document.getElementById('symbolPanel'), btn = document.getElementById('symbolToggle');
  const rows = []; const t0 = performance.now();
  return new Promise(res => {
    function tick(){
      const t = Math.round(performance.now() - t0);
      const cs = getComputedStyle(panel);
      rows.push({ t, op: +(+cs.opacity).toFixed(3), tf: cs.transform, disp: cs.display });
      if (t < 700) requestAnimationFrame(tick); else res(JSON.stringify(rows));
    }
    btn.click();
    tick();
  });
})()`;
const A = JSON.parse(await evaluate(OPEN_ANIM));
const mids = A.filter(r => r.op > 0.02 && r.op < 0.98);
const tfMids = A.filter(r => r.tf && r.tf !== 'none' && !/matrix\(1, 0, 0, 1, 0, 0\)/.test(r.tf));
console.log('  ' + A.filter(r => r.op > 0.02 && r.op < 1).slice(0, 5).map(r => `${r.t}ms op=${r.op}`).join('  |  '));
ok(A[0].disp === 'block', '② 点开后立刻进入布局（display:block）');
ok(mids.length >= 2, `★ ② 出现过程有中间帧（${mids.length} 帧既非全透也非全不透）= 真的在补间，不是硬切`);
ok(tfMids.length >= 1, `★ ② 出现过程有位移/缩放补间（${tfMids.length} 帧 transform 处于中间态）`);
ok(A[A.length - 1].op > 0.98, '② 动画结束时完全显示');

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ③ 消失：收回也有动画，收完必须离开布局 ══════\n');
const CLOSE_ANIM = `(()=>{
  const panel = document.getElementById('symbolPanel'), btn = document.getElementById('symbolToggle');
  if (!panel.classList.contains('open')) btn.click();
  const rows = []; const t0 = performance.now();
  return new Promise(res => {
    function tick(){
      const t = Math.round(performance.now() - t0);
      const cs = getComputedStyle(panel);
      rows.push({ t, op: +(+cs.opacity).toFixed(3), disp: cs.display, tf: cs.transform,
        shown: panel.classList.contains('shown'), box: Math.round(panel.getBoundingClientRect().width) });
      if (t < 900) requestAnimationFrame(tick);
      else res(JSON.stringify({ rows, final: { disp: cs.display, shown: panel.classList.contains('shown'),
        box: Math.round(panel.getBoundingClientRect().width), open: panel.classList.contains('open'),
        openFlag: (typeof panelOpen !== 'undefined') ? panelOpen : '?' } }));
    }
    btn.click();   // 关
    tick();
  });
})()`;
const C = JSON.parse(await evaluate(CLOSE_ANIM));
const cMids = C.rows.filter(r => r.op > 0.02 && r.op < 0.98);
const firstHidden = C.rows.find(r => r.disp === 'none');
console.log('  ' + C.rows.filter(r => r.op > 0 && r.op < 1).slice(0, 5).map(r => `${r.t}ms op=${r.op}`).join('  |  '));
console.log(`  收完：display=${C.final.disp}  占位宽=${C.final.box}px  .open=${C.final.open}  panelOpen=${C.final.openFlag}  摘 display 发生在 ${firstHidden ? firstHidden.t + 'ms' : '（一直没摘）'}`);
ok(cMids.length >= 2, `★ ③ 消失过程也有中间帧（${cMids.length} 帧）= 收回也在补间`);
ok(C.final.disp === 'none', '★ ③ 动画结束后 display 回到 none');
ok(C.final.box === 0, '★ ③ 收起的面板不占布局（宽度 0）—— 否则会被自绘滚动条当成滚动容器挂滑块、还会吃点击');
ok(C.final.open === false && C.final.openFlag === false, '③ 收起后 .open 与 panelOpen 状态一致');
ok(!firstHidden || firstHidden.t >= 100,
  `③ 摘 display 是等动画跑完才做的（${firstHidden ? firstHidden.t + 'ms' : 'n/a'} ≥ 100ms），不是刚点就消失`);

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ④ 既有行为不能改坏 ══════\n');
const BEHAVE = `(()=>{
  const panel = document.getElementById('symbolPanel'), btn = document.getElementById('symbolToggle');
  const input = document.getElementById('searchInput');
  const out = {};
  // 插入字符：原来会写进搜索框并派发 input 事件
  input.value = 'ab';
  input.setSelectionRange(1, 1);
  if (!panel.classList.contains('open')) btn.click();
  let inputs = 0;
  const onIn = () => inputs++;
  input.addEventListener('input', onIn);
  const ch = panel.querySelector('.symbol-char');
  const chr = ch.dataset.char;
  ch.click();
  out.insert = { value: input.value, inputs, chr, caret: input.selectionStart };
  input.removeEventListener('input', onIn);
  // Esc 关闭
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  out.escClosed = !panel.classList.contains('open');
  // 遮罩 mousedown 关闭
  btn.click();
  const ov = document.getElementById('symbolOverlay');
  out.reopened = panel.classList.contains('open');
  ov.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  out.overlayClosed = !panel.classList.contains('open');
  // window.closeSymbolPanel（tab-switcher 切版块时调它）
  btn.click();
  if (typeof window.closeSymbolPanel === 'function') window.closeSymbolPanel();
  out.apiClosed = !panel.classList.contains('open');
  return JSON.stringify(out);
})()`;
const B = JSON.parse(await evaluate(BEHAVE));
console.log('  ' + JSON.stringify(B.insert));
ok(B.insert.value === 'a' + B.insert.chr + 'b', `★ ④ 点字符仍然插到光标处（${JSON.stringify(B.insert.value)}）`);
ok(B.insert.inputs === 1, '④ 插入后仍然派发一次 input 事件（实时搜索照常触发）');
ok(B.insert.caret === 2, '④ 光标停在插入的字符之后');
ok(B.escClosed === true, '④ Esc 仍然能关');
ok(B.reopened === true && B.overlayClosed === true, '④ 点遮罩仍然能关');
ok(B.apiClosed === true, '④ window.closeSymbolPanel()（切版块用）仍然有效');

// 快速连点：关到一半又打开，不能停在"藏着"的状态
console.log('\n  ── 连点（关一半又开）──');
const RAPID = JSON.parse(await evaluate(`(()=>{
  const panel = document.getElementById('symbolPanel'), btn = document.getElementById('symbolToggle');
  btn.click(); btn.click(); btn.click();     // 开→关→开
  return new Promise(res => setTimeout(() => {
    const cs = getComputedStyle(panel);
    res(JSON.stringify({ open: panel.classList.contains('open'), shown: panel.classList.contains('shown'),
      op: +(+cs.opacity).toFixed(2), disp: cs.display, box: Math.round(panel.getBoundingClientRect().width) }));
  }, 420));
})()`));
console.log('  ' + JSON.stringify(RAPID));
ok(RAPID.open === true && RAPID.disp === 'block' && RAPID.op > 0.9,
  '★ ④ 连点后停在"开着"的稳定状态（延迟摘 display 的定时器被清掉了，不会先隐后显闪一下）');
ok(RAPID.box > 0, '④ 连点后面板正常占位显示');

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑤ 减少动态效果时直接切、不留尾巴 ══════\n');
await evaluate(`(()=>{ const p=document.getElementById('symbolPanel'); if (p.classList.contains('open')) document.getElementById('symbolToggle').click(); return true; })()`);
await sleep(400);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(200);
const RM = JSON.parse(await evaluate(`(()=>{
  const panel = document.getElementById('symbolPanel'), btn = document.getElementById('symbolToggle');
  const t0 = performance.now();
  btn.click();                                   // 开
  // 不能点完立刻读：补间是从 0 起步的，t≈0 时当然是 0（no-preference 下也一样）。
  // 这里等两帧再读 —— reduce 下 transition 是 none，两帧足够到 1；没兜住的话
  // 220ms 才走完，两帧时还在半路上，断言就能区分出来。
  return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
    const opAfterOpen = +(+getComputedStyle(panel).opacity).toFixed(3);
    const dispAfterOpen = getComputedStyle(panel).display;
    btn.click();                                 // 关
    setTimeout(() => res(JSON.stringify({ opAfterOpen, dispAfterOpen, msOpen: Math.round(performance.now() - t0),
      opAfterClose: +(+getComputedStyle(panel).opacity).toFixed(3),
      disp: getComputedStyle(panel).display, shown: panel.classList.contains('shown'),
      box: Math.round(panel.getBoundingClientRect().width), ms: Math.round(performance.now() - t0) })), 60);
  })));
})()`));
console.log('  ' + JSON.stringify(RM));
ok(RM.opAfterOpen > 0.9, `⑤ reduce 下打开不做补间（两帧后就已经全不透明，实测 ${RM.opAfterOpen}，耗时 ${RM.msOpen}ms）`);
ok(RM.dispAfterOpen === 'block', '⑤ reduce 下打开仍是正常显示（只是不做动画）');
ok(RM.disp === 'none' && RM.shown === false && RM.box === 0,
  '⑤ reduce 下关闭立即离开布局（不等延迟定时器，不留 200ms 的尾巴）');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e));

try { ws.close(); } catch {}
try { child.kill(); } catch {}
try { server.close(); } catch {}
process.exit(fail === 0 ? 0 : 1);
