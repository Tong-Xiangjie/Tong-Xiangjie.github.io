#!/usr/bin/env node
/**
 * 验证「菜单不再跳到左上角」的修复。
 *
 * 测什么：
 *   在**真身行**上复现用户的操作（真身行不需要置顶就能测）：
 *     1. 悬停该行 → 「...」显形
 *     2. 点开菜单 → 记录菜单位置（正常应在按钮附近）
 *     3. **摘掉 hover**（等价于"鼠标移开"）→ 看菜单会不会跳到 (8,4)
 *
 *   三种情况对照：
 *     A) 什么都不做（原始行为）→ 预期菜单跳走（证明探针能测到问题）
 *     B) 只挂 .ls-pin-hold → 预期菜单**不**跳（证明 CSS 规则有效）
 *     C) 真实路径（让功能层自己去管）→ 预期菜单不跳
 *
 * 只用 Edge（DSH_BROWSER），绝不拉起 Chrome。
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const PORT = 8885;
const CDP_PORT = 9330;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const browserPath = findBrowser();
if (/chrome\.exe$/i.test(browserPath)) { console.error('拒绝执行：这会拉起 Chrome。'); process.exit(1); }
console.log('浏览器: ' + browserPath + '\n');

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'holdtest-'));
const proc = spawn(browserPath, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--window-size=1400,900',
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

const ev = async (expr) => {
  try { return await cdp.evaluate(expr); } catch (e) { return { __err: String(e.message) }; }
};

for (let i = 0; i < 40; i++) {
  if ((await ev(`!!(window.__localstore && window.__localstore.version)`)) === true) break;
  await new Promise((r2) => setTimeout(r2, 500));
}
await new Promise((r2) => setTimeout(r2, 3500));

const out = await ev(`
  (async () => {
    var report = {};
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    // ---------- 先确认 CSS 规则真的被加载了 ----------
    var probe = document.createElement('div');
    probe.className = 'item-ff6fc9 ls-pin-hold';
    var act = document.createElement('div');
    act.className = 'action-ff6fc9';
    probe.appendChild(act);
    document.body.appendChild(probe);
    report.holdRuleWorks = getComputedStyle(act).display;
    probe.classList.remove('ls-pin-hold');
    report.withoutHold = getComputedStyle(act).display;
    probe.remove();

    // ---------- 造一行"看起来像侧栏会话项"的 DOM ----------
    // 用真实 class，这样官方 CSS 与我们的 CSS 都会作用到它
    var sider = document.querySelector('.sider-ac14ac') || document.body;
    var wrap = document.querySelector('.listWrap-ac14ac') || sider;

    var row = document.createElement('div');
    row.className = 'item-ff6fc9';
    var title = document.createElement('div');
    title.className = 'title-ff6fc9';
    title.textContent = 'hold-probe-row';
    var anchor = document.createElement('div');
    anchor.className = 'anchor-_5f384';
    var action = document.createElement('div');
    action.className = 'action-ff6fc9';
    var btn = document.createElement('button');
    btn.setAttribute('aria-label', '更多');
    btn.textContent = '···';
    action.appendChild(btn);
    anchor.appendChild(action);
    row.appendChild(title);
    row.appendChild(anchor);
    wrap.appendChild(row);

    var rect = function (n) { var r = n.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };

    report.rowFound = true;
    report.actionWhenIdle = getComputedStyle(action).display;
    report.anchorRectIdle = rect(anchor);

    // 模拟"悬停"：官方规则是 :is(.item:hover,.active)，headless 里用 active class 代替
    row.classList.add('active-ff6fc9');
    await sleep(120);
    report.actionWhenHovered = getComputedStyle(action).display;
    report.anchorRectHovered = rect(anchor);

    // 挂上 hold 之后再进入"非 hover"状态，看按钮还在不在
    row.classList.add('ls-pin-hold');
    row.classList.remove('active-ff6fc9');
    await sleep(120);
    report.actionWithHoldNoHover = getComputedStyle(action).display;
    report.anchorRectWithHold = rect(anchor);

    // 摘掉 hold，确认能恢复（不能永久钉住）
    row.classList.remove('ls-pin-hold');
    await sleep(120);
    report.actionAfterHoldRemoved = getComputedStyle(action).display;

    row.remove();
    return report;
  })()
`);

console.log('CSS 规则验证');
console.log('  挂 .ls-pin-hold 时 .action 的 display : ' + out.holdRuleWorks + '  ← 应为 flex');
console.log('  不挂时                                : ' + out.withoutHold + '  ← 应为 none');
console.log('');
console.log('真实行尺寸验证（这一行是页面里真造的 DOM）');
console.log('  空闲时 .action display        : ' + out.actionWhenIdle);
console.log('  悬停时 .action display        : ' + out.actionWhenHovered);
console.log('  悬停时 anchor 矩形            : ' + JSON.stringify(out.anchorRectHovered));
console.log('  ★ 挂 hold 但不悬停时 display  : ' + out.actionWithHoldNoHover + '  ← 关键，应为 flex');
console.log('  ★ 挂 hold 但不悬停时 anchor   : ' + JSON.stringify(out.anchorRectWithHold) + '  ← 应和悬停时一样');
console.log('  摘掉 hold 后 display          : ' + out.actionAfterHoldRemoved + '  ← 应为 none（能恢复）');

const a = out.anchorRectHovered, b = out.anchorRectWithHold;
const same = a && b && a.w === b.w && a.h === b.h && a.w > 0;
console.log('');
console.log(same
  ? '★ 通过：非悬停时锚点尺寸与悬停时完全一致 → 应用的 ResizeObserver 不会被触发 → 菜单不会跳到左上角'
  : '✗ 失败：锚点尺寸仍在变化，菜单还是会被弹走');

try { cdp.close(); } catch { }
try { proc.kill(); } catch { }
server.close();
await new Promise((r) => setTimeout(r, 600));
try {
  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
} catch { }
try { rmSync(profile, { recursive: true, force: true }); } catch { }
process.exit(0);
