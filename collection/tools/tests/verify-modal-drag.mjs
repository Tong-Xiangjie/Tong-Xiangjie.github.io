// 放大视图里"拖动平移"与"单击关闭"的区分
//
// 用户报告：鼠标拖动查看大图时，只要是**慢速**移动，即使移动了很远，也会被识别成"单击关闭"。
// 要求：拖动时长超过某个（较小的）阈值就应当算拖动，不该关弹窗。
//
// 这里用真实的 CDP 鼠标事件（不是脚本里直接调 click()），因为要复现的正是
// "浏览器在 mouseup 之后补发 click" 那条链路上的判断。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

console.log('══════ ① 静态：判定条件不能把"慢速拖动"排除在外 ══════\n');
const core = readFileSync('collection/core.js', 'utf8');
const start = core.indexOf('function setupModalEvents');
const body = core.slice(start, core.indexOf('\nfunction ', start + 10));
// 只看代码、不看注释（注释里会引用旧写法，不剥掉会误判）
const code = body.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(/addEventListener\('click'/.test(code), '① 找到了弹窗的 click 处理器');
// 旧写法：`if (downTime && Date.now() - downTime < 800) { ... moved > 8 ... }`
// —— 位移判断被关在"按住不到 800ms"里面，慢速拖动整段被跳过。
ok(!/Date\.now\(\)\s*-\s*downTime\s*<\s*800/.test(code),
  '① 旧的"按住 < 800ms 才判断位移"已经不在了（它就是慢速拖动被误判的根因）');
// 阈值可以是数字字面量，也可以是具名常量 —— 匹配意图，不锁死写法
ok(/moved\s*>\s*(?:\d+|MODAL_DRAG_SLOP)/.test(code), '① 位移阈值仍在（快速拖动依然不能关弹窗）');
ok(/held\s*>\s*(?:\d+|MODAL_DRAG_HOLD_MS)/.test(code),
  '① 新增了"按住时长超过阈值就算拖动"的判断（用户要求：阈值可以比较小）');
const holdM = code.match(/MODAL_DRAG_HOLD_MS\s*=\s*(\d+)/);
ok(!!holdM && Number(holdM[1]) <= 600,
  `① 按住阈值确实"比较小"（${holdM ? holdM[1] + 'ms' : '没找到取值'}，要求 ≤600ms）`);

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
const userDir = await mkdtemp(join(tmpdir(), 'cdpMD-'));
const DP = 13000 + Math.floor(Math.random() * 90);
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
// ★ 把 prefers-reduced-motion 钉死成 no-preference：CI（GitHub 的 Windows runner）默认关闭系统
//   动画，Chrome 会报 reduce，这条用例量的又是"动画/交互"路径，不钉死就会随宿主机变红。
//   （这是用例自身的不确定性，见 README 里 2026-10 那批 CI-only 失败的说明。）
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#notes` });
for (let i = 0; i < 140; i++) { const r = await evaluate(`typeof openModal === 'function' && document.readyState === 'complete'`).catch(() => false); if (r) break; await sleep(120); }
await sleep(700);

// ─────────── 手势工具 ───────────
const isOpen = () => evaluate(`document.getElementById('imageModal').classList.contains('modal-show')`);
const waitOpen = async (want) => {
  for (let i = 0; i < 40; i++) { if ((await isOpen()) === want) return true; await sleep(100); }
  return false;
};
const openBig = async () => {
  await evaluate(`(()=>{
    document.querySelectorAll('.dsh-drag-probe').forEach(e => e.remove());
    const img = document.createElement('img');
    img.className = 'mini-thumb dsh-drag-probe';
    img.src = new URL('img-placeholder.svg', location.href).href;
    img.style.cssText = 'position:fixed;left:40px;top:120px;width:56px;height:40px;z-index:1;';
    document.body.appendChild(img);
    lastModalSourceImg = img;
    openModal(img.src, img.src);
    return 1;
  })()`);
  await waitOpen(true);
  await sleep(350);
};
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1, ...extra });
// 一次完整的按下→（可选）分步移动→抬起。totalMs 是按住总时长，steps 决定分几步移动。
const gesture = async ({ x0, y0, x1, y1, totalMs, steps = 4 }) => {
  await mouse('mousePressed', x0, y0, { buttons: 1 });
  for (let i = 1; i <= steps; i++) {
    await sleep(Math.round(totalMs / steps));
    const x = Math.round(x0 + (x1 - x0) * i / steps);
    const y = Math.round(y0 + (y1 - y0) * i / steps);
    await mouse('mouseMoved', x, y, { buttons: 1, button: 'left' });
  }
  await mouse('mouseReleased', x1, y1, { buttons: 0 });
  await sleep(500);
};

console.log('\n══════ ② 四种手势 ══════\n');
ok(await evaluate(`typeof prefersReducedMotion === 'function' ? !prefersReducedMotion() : true`), '媒体偏好已钉成 no-preference');

// A. 快速单击（原地、很短）→ 应当关闭（这是本来就正确的行为，不能被改坏）
await openBig();
await gesture({ x0: 640, y0: 450, x1: 640, y1: 450, totalMs: 40, steps: 1 });
const aOpen = await isOpen();
ok(aOpen === false, `快速单击：弹窗关闭（${aOpen ? '仍开着 ✗' : '已关 ✓'}）`);

// B. 快速拖动（位移大、时间短）→ 不应关闭
await openBig();
await gesture({ x0: 640, y0: 450, x1: 760, y1: 450, totalMs: 200, steps: 4 });
const bOpen = await isOpen();
ok(bOpen === true, `快速拖动 200ms/120px：弹窗没被误关（${bOpen ? '仍开着 ✓' : '被关了 ✗'}）`);

// C. ★ 慢速长距离拖动（用户报告的场景）→ 不应关闭
await openBig();
await gesture({ x0: 640, y0: 450, x1: 760, y1: 450, totalMs: 1400, steps: 5 });
const cOpen = await isOpen();
ok(cOpen === true, `★ 慢速拖动 1400ms/120px：弹窗没被误关（${cOpen ? '仍开着 ✓' : '被关了 ✗ —— 这就是用户报的问题'}）`);

// D. ★ 慢速按住几乎不动（用户要求：时长超阈值也算拖动）→ 不应关闭
await openBig();
await gesture({ x0: 640, y0: 450, x1: 642, y1: 450, totalMs: 1200, steps: 4 });
const dOpen = await isOpen();
ok(dOpen === true, `★ 慢速按住 1200ms/2px：按拖动处理、弹窗没被关（${dOpen ? '仍开着 ✓' : '被关了 ✗'}）`);

// E. 关不掉之外的兜底：拖完之后再单击一次，仍要能正常关闭
await evaluate(`closeModal()`);
await sleep(600);
await openBig();
await gesture({ x0: 640, y0: 450, x1: 720, y1: 450, totalMs: 1200, steps: 4 });
await gesture({ x0: 640, y0: 450, x1: 640, y1: 450, totalMs: 40, steps: 1 });
const eOpen = await isOpen();
ok(eOpen === false, `拖动之后紧接着快速单击，弹窗仍能关掉（${eOpen ? '关不掉 ✗' : '已关 ✓'}）`);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
try { child.kill(); } catch {}
try { server.close(); } catch {}
process.exit(fail === 0 ? 0 : 1);
