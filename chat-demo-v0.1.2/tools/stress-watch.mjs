#!/usr/bin/env node
/**
 * 压力观察：比 crash-watch 更狠。
 *
 * crash-watch 证明了闲着的时候不发文件系统调用（调用次数恒为 0）。
 * 这个脚本再加两个变量：
 *   1. 反复做「用户会做的事」：导入/导出、发消息、切标签、来回改设置。
 *      旧版的崩溃就是被这些动作触发的自动写盘路径引出来的。
 *   2. 真去读进程内存（上一版 PowerShell 过滤没匹配上，一直显示 0）。
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { CDP, fetchPageTarget, findBrowser } from 'file:///C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2/tools/minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const PORT = 8896;
const CDP_PORT = 9336;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browserPath = findBrowser();
if (/chrome\.exe$/i.test(browserPath)) {
  console.error('拒绝执行：这会拉起 Chrome。');
  process.exit(1);
}
console.log('浏览器: ' + browserPath);

const profile = mkdtempSync(join(tmpdir(), 'stresswatch-'));
const proc = spawn(browserPath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions',
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

let exited = false, exitInfo = null;
proc.on('exit', (code, signal) => { exited = true; exitInfo = { code, signal }; });

const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

const ev = async (expr) => {
  try { return await cdp.evaluate(expr); } catch (e) { return { __err: String(e.message) }; }
};
const mb = (n) => (n / 1024 / 1024).toFixed(1);

let pageErrors = 0;
cdp.on('event', (msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors++;
    const d = msg.params.exceptionDetails;
    console.log('  [页面异常] ' + (d.exception?.description || d.text).split('\n')[0]);
  }
});

// 直接读注册表里记录的 Edge 进程内存（比按命令行过滤稳）
function edgeMem() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$p = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.StartTime -gt (Get-Date).AddMinutes(-3) }; if ($p) { ($p | Measure-Object WorkingSet64 -Sum).Sum; $p.Count } else { '0'; '0' }"`,
      { encoding: 'utf8', timeout: 20000 }
    ).trim().split(/\r?\n/);
    return { bytes: parseInt(out[0], 10) || 0, count: parseInt(out[1], 10) || 0 };
  } catch { return { bytes: 0, count: 0 }; }
}

const sample = async (label) => {
  const heap = await ev('performance.memory ? performance.memory.usedJSHeapSize : 0');
  const breaker = await ev(`(function(){
    try {
      var L = window.__localstore;
      if (!L) return null;
      return L.fsBreaker ? L.fsBreaker() : null;
    } catch (e) { return null; }
  })()`);
  const m = edgeMem();
  console.log(
    label.padEnd(22) + ' 存活=' + (exited ? '否' : '是') +
    '  Edge进程=' + String(m.count).padStart(2) +
    '  Edge内存=' + mb(m.bytes).padStart(7) + 'MB' +
    '  页面堆=' + mb(typeof heap === 'number' ? heap : 0).padStart(5) + 'MB' +
    '  文件系统调用=' + (breaker ? (breaker['调用次数'] ?? '?') : '?')
  );
  return { heap: typeof heap === 'number' ? heap : 0, mem: m.bytes, calls: breaker ? breaker['调用次数'] : null };
};

await new Promise((r) => setTimeout(r, 2500));
const baseline = await sample('基线（刚打开）');

// ---- 反复触发"用户会做的事" ----
const actions = [
  ['导出全部', `window.__localstore.exportBundle()`],
  ['单个对话导出', `window.__localstore.exportSession('x')`],
  ['导入一个坏文件', `window.__localstore.importBundle('{"nope":1}').catch(()=>{})`],
  ['点桥接层按钮', `(function(){ var b=document.querySelector('#localstore-section .ls-btns button'); if(b) b.click(); return !!b; })()`],
  ['挂载设置区块', `window.__localstore.mountSection(document.createElement('div'))`],
  ['注入模型徽标', `window.__localstore.injectModelBadges()`],
  ['读会话数', `window.__localstore.countLocalSessions()`],
  ['断开文件夹', `(function(){ try { return typeof window.__localstore.pickFolder; } catch(e){ return 'ERR'; } })()`]
];

console.log('\n---- 开始反复触发用户动作 ----');
let rounds = 0;
const t0 = Date.now();
while (Date.now() - t0 < 90000 && !exited) {
  rounds++;
  for (const [name, expr] of actions) {
    if (exited) break;
    await ev(expr);
  }
  if (rounds % 3 === 0) {
    const s = await sample(`第 ${rounds} 轮后`);
    // 堆如果持续暴涨就是泄漏信号
    if (s.heap > baseline.heap * 4 && s.heap > 80 * 1024 * 1024) {
      console.log('  ⚠ 页面堆相对基线涨了 4 倍以上，疑似泄漏');
    }
  }
  await new Promise((r) => setTimeout(r, 700));
}

console.log('\n================ 结果 ================');
console.log('完成的动作轮数: ' + rounds + '（每轮 ' + actions.length + ' 个动作，共 ' + rounds * actions.length + ' 次）');
console.log('进程存活: ' + (exited ? '否 —— 退出信息 ' + JSON.stringify(exitInfo) : '是'));
console.log('页面内异常: ' + pageErrors + ' 次');
await sample('结束时');
console.log('观察时长: ' + Math.round((Date.now() - t0) / 1000) + 's');

try { cdp.close(); } catch { }
try { proc.kill(); } catch { }
server.close();
await new Promise((r) => setTimeout(r, 800));
try {
  execSync(
    `powershell -NoProfile -Command "Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-3) } | Stop-Process -Force -ErrorAction SilentlyContinue"`,
    { stdio: 'ignore' }
  );
} catch { }
try { rmSync(profile, { recursive: true, force: true }); } catch { }
console.log('（已清理临时 profile）');
process.exit(0);
