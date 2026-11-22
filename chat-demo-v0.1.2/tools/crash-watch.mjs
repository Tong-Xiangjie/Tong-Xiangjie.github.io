#!/usr/bin/env node
/**
 * 崩溃观察实验。
 *
 * 目的：把新版桥接层加载进 Edge，然后**什么都不做**地保持 100 秒，
 * 每 10 秒采样一次：进程还活着吗？内存有没有一路涨？
 *
 * 为什么这个实验有意义：
 *   用户的崩溃特征是「打开页面后 2~3 分钟内所有标签一起没」。
 *   如果新版桥接层还在偷偷发文件系统调用，那它会在闲着的时候也持续
 *   产生请求，内存/句柄会一路涨，最后被看门狗杀掉 —— 这个脚本就是盯着这个。
 *   如果 100 秒里内存平稳、进程健在，说明自动路径确实断干净了。
 *
 * 安全约束：
 *   - 只用 Edge（DSH_BROWSER），绝不拉起 Chrome。
 *   - 用独立的临时 user-data-dir，不碰用户正在用的 Edge profile。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { CDP, fetchPageTarget, findBrowser } from 'file:///C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2/tools/minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const PORT = 8897;
const CDP_PORT = 9337;
const HOLD_MS = 100000;      // 总共观察 100 秒
const SAMPLE_MS = 10000;     // 每 10 秒采样
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
console.log('浏览器: ' + browserPath);
if (/chrome\.exe$/i.test(browserPath)) {
  console.error('拒绝执行：这会拉起 Chrome。请设置 DSH_BROWSER 指向 Edge。');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'crashwatch-'));
const args = [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `http://127.0.0.1:${PORT}/index.html`
];
console.log('启动参数: ' + args.slice(0, 5).join(' '));
const proc = spawn(browserPath, args, { stdio: 'ignore' });

let exited = false;
let exitInfo = null;
proc.on('exit', (code, signal) => { exited = true; exitInfo = { code, signal }; });

const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

const ev = async (expr) => {
  try { return await cdp.evaluate(expr); } catch (e) { return { __err: String(e.message) }; }
};

const mb = (n) => (n / 1024 / 1024).toFixed(1) + 'MB';

// 记录页面内的异常（崩溃前往往先有一串报错）
let pageErrors = 0;
cdp.on('event', (msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors++;
    const d = msg.params.exceptionDetails;
    console.log('  [页面异常] ' + (d.exception?.description || d.text).split('\n')[0]);
  }
});

console.log('\n时间   存活   Edge总内存  页面堆     桥接层调用数  说明');
console.log('-----  -----  ----------  ---------  ------------  ----');

const t0 = Date.now();
let firstHeap = null;
let lastHeap = null;
let worstHeapGrowth = 0;

while (Date.now() - t0 < HOLD_MS) {
  await new Promise((r) => setTimeout(r, SAMPLE_MS));

  // Edge 自己的进程组内存（按 user-data-dir 精确匹配，不会算上用户那 16 个）
  let totalMem = 0, procs = 0;
  try {
    const { execSync } = await import('node:child_process');
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\')}*' } | Measure-Object WorkingSetSize -Sum | Select-Object -ExpandProperty Sum"`,
      { encoding: 'utf8' }
    ).trim();
    totalMem = parseInt(out, 10) || 0;
    const cnt = execSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\')}*' }).Count"`,
      { encoding: 'utf8' }
    ).trim();
    procs = parseInt(cnt, 10) || 0;
  } catch { /* 采样失败不算致命 */ }

  // 页面堆 + 桥接层状态
  const heap = await ev('performance.memory ? performance.memory.usedJSHeapSize : 0');
  const fsCalls = await ev(`(function(){
    try {
      var L = window.__localstore;
      if (!L) return 'no-bridge';
      var b = L.fsBreaker ? L.fsBreaker() : null;
      return b ? JSON.stringify(b) : 'no-breaker';
    } catch (e) { return 'ERR'; }
  })()`);

  const heapNum = typeof heap === 'number' ? heap : 0;
  if (firstHeap === null && heapNum) firstHeap = heapNum;
  if (heapNum) {
    lastHeap = heapNum;
    if (firstHeap) worstHeapGrowth = Math.max(worstHeapGrowth, heapNum - firstHeap);
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(
    String(secs).padStart(4) + 's  ' +
    (exited ? ' 否 ' : ' 是 ') + '  ' +
    mb(totalMem).padStart(9) + '  ' +
    mb(heapNum).padStart(8) + '  ' +
    String(fsCalls).slice(0, 12).padEnd(12) + '  ' +
    (exited ? ('已退出 ' + JSON.stringify(exitInfo)) : '')
  );

  if (exited) break;
}

console.log('\n================ 结果 ================');
console.log('进程存活到实验结束: ' + (exited ? '否（提前退出）' : '是'));
if (exited) console.log('退出信息: ' + JSON.stringify(exitInfo));
console.log('页面内异常次数: ' + pageErrors);
console.log('页面堆: ' + mb(firstHeap || 0) + ' → ' + mb(lastHeap || 0)
  + '（增长 ' + mb(worstHeapGrowth) + '）');
console.log('观察时长: ' + Math.round((Date.now() - t0) / 1000) + 's');

try { cdp.close(); } catch { }
try { proc.kill(); } catch { }
server.close();
await new Promise((r) => setTimeout(r, 800));
// 兜底：把这个临时 profile 下残留的 Edge 进程收掉（只按 user-data-dir 匹配）
try {
  const { execSync } = await import('node:child_process');
  execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
    { stdio: 'ignore' }
  );
} catch { }
try { rmSync(profile, { recursive: true, force: true }); } catch { }
console.log('（已清理临时 profile）');
process.exit(0);
