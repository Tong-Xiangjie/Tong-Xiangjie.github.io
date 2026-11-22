#!/usr/bin/env node
/**
 * 真人参与的对照实验：旧版桥接层 + 真的连上一个文件夹。
 *
 * 为什么必须有人参与：
 *   旧版的崩溃只在"真的连上文件夹 + 授权读写"之后才会触发，
 *   而 File System Access 的授权强制要求用户手势，headless 脚本给不了。
 *
 * 安全设计（很重要）：
 *   1. 只在 E:\ 下新建一个**空的临时目录**（E:\ls-crashtest-<时间>），
 *      不碰 E:\ChatHistory，也不读你任何真实数据。
 *   2. 用 headed 模式开一个独立的临时 profile 的 Edge，
 *      跟你正在用的 Edge 完全隔离。
 *   3. 全程每 3 秒采样：页面是否还活着、文件系统调用次数、
 *      页面异常、以及"最后一次卡在哪一步"。
 *
 * 需要你做的（就一步）：
 *   窗口弹出来后，在设置面板里点「选择文件夹」，然后选
 *   E:\ls-crashtest-xxxx 那个目录，并点「允许读写」。
 *   然后什么都别做，让它放着。脚本会盯着看它会不会卡/崩。
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { CDP, fetchPageTarget, findBrowser } from 'file:///C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2/tools/minimal-cdp.mjs';

const NEW_ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PORT = 8889;
const CDP_PORT = 9333;
const HOLD_MS = 180000;   // 最多观察 3 分钟

const browserPath = findBrowser();
if (/chrome\.exe$/i.test(browserPath)) {
  console.error('拒绝执行：这会拉起 Chrome。请设置 DSH_BROWSER 指向 Edge。');
  process.exit(1);
}

// 在 E: 下建一个空目录（只在 E: 存在时）
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const TEST_DIR = `E:\\ls-crashtest-${stamp}`;
let testDirCreated = false;
try {
  if (existsSync('E:\\')) { mkdirSync(TEST_DIR, { recursive: true }); testDirCreated = true; }
} catch (e) { console.log('E: 建目录失败：' + e.message); }

const workDir = mkdtempSync(join(tmpdir(), 'oldheaded-'));
copyFileSync(join(NEW_ROOT, 'index.html'), join(workDir, 'index.html'));
copyFileSync(join(process.env.TEMP, 'old-bridge-probe', 'localstore-bridge.js'),
             join(workDir, 'localstore-bridge.js'));
const { cpSync } = await import('node:fs');
cpSync(join(NEW_ROOT, 'static'), join(workDir, 'static'), { recursive: true });

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(workDir, p);
  if (!existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'oldheaded-prof-'));
console.log('======================================================');
console.log('浏览器      : ' + browserPath);
console.log('测试用目录  : ' + (testDirCreated ? TEST_DIR + '（空的，随便读写）' : '（E: 不可用，跳过）'));
console.log('真实数据    : 完全不会被读取或修改');
console.log('======================================================');
console.log('\n>>> 窗口马上弹出来。请在里面：');
console.log('>>>   1. 打开设置 → 「备份与恢复 / 本地文件夹存储」区域');
console.log('>>>   2. 点「选择文件夹」');
console.log('>>>   3. 选 ' + (testDirCreated ? TEST_DIR : '任意空目录'));
console.log('>>>   4. 点「允许读写」');
console.log('>>>   然后什么都别动，让它放着。最多观察 3 分钟。\n');

// headed（不加 headless），独立 profile
const proc = spawn(browserPath, [
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1400,900',
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

let exited = false, exitInfo = null;
proc.on('exit', (code, signal) => { exited = true; exitInfo = { code, signal }; });

const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

let errors = 0;
const errorList = [];
cdp.on('event', (msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    errors++;
    const d = msg.params.exceptionDetails;
    const line = (d.exception?.description || d.text).split('\n')[0].slice(0, 140);
    errorList.push(line);
    console.log('  [页面异常] ' + line);
  }
});

const ev = async (expr, timeoutHint) => {
  try { return await cdp.evaluate(expr); } catch (e) { return { __err: String(e.message) }; }
};

console.log('时间   存活  文件系统调用  连续失败  熔断  上次结果  页面异常');
console.log('-----  -----  ------------  --------  ----  --------  --------');

const t0 = Date.now();
let sawFsCall = false;
let maxCalls = 0;

while (Date.now() - t0 < HOLD_MS && !exited) {
  await new Promise((r) => setTimeout(r, 3000));

  const b = await ev(`(function(){
    try { var L = window.__localstore; if (!L || !L.fsBreaker) return null; return L.fsBreaker(); }
    catch(e) { return { err: String(e.message) }; }
  })()`);

  const calls = b && typeof b === 'object' ? (b['调用次数'] ?? 0) : 0;
  if (typeof calls === 'number' && calls > maxCalls) maxCalls = calls;
  if (calls > 0) sawFsCall = true;

  const secs = Math.round((Date.now() - t0) / 1000);
  const failStreak = b && typeof b === 'object' ? (b['连续失败'] ?? '-') : '-';
  const tripped = b && typeof b === 'object' ? (b['熔断中'] ?? '-') : '-';
  const lastResult = b && typeof b === 'object' ? (b['上次结果'] ?? '-') : '-';
  console.log(
    String(secs).padStart(4) + 's  ' +
    (exited ? ' 否 ' : ' 是 ').padEnd(5) + '  ' +
    String(calls).padStart(11) + '  ' +
    String(failStreak).padStart(8) + '  ' +
    String(tripped).padStart(4) + '  ' +
    String(lastResult).padStart(8) + '  ' +
    String(errors).padStart(8)
  );
}

console.log('\n================ 结果 ================');
console.log('进程存活到结束 : ' + (exited ? '否 —— ' + JSON.stringify(exitInfo) : '是'));
console.log('出现过的文件系统调用次数峰值 : ' + maxCalls);
console.log('是否真的发过文件系统调用     : ' + (sawFsCall ? '是（说明你成功连上了文件夹）' : '否（没连上，实验无效）'));
console.log('页面异常次数 : ' + errors);
if (errorList.length) {
  console.log('异常明细（前 8 条）:');
  errorList.slice(0, 8).forEach((e) => console.log('  - ' + e));
}
console.log('观察时长 : ' + Math.round((Date.now() - t0) / 1000) + 's');

try { cdp.close(); } catch { }
try { proc.kill(); } catch { }
server.close();
await new Promise((r) => setTimeout(r, 800));
try { rmSync(profile, { recursive: true, force: true }); } catch { }
try { rmSync(workDir, { recursive: true, force: true }); } catch { }
if (testDirCreated) {
  try {
    const left = execSync(`powershell -NoProfile -Command "(Get-ChildItem '${TEST_DIR}' -Recurse -File -ErrorAction SilentlyContinue).Count"`, { encoding: 'utf8' }).trim();
    console.log('测试目录里留下的文件数 : ' + left + '（目录 ' + TEST_DIR + ' 保留，方便你自己看）');
  } catch { }
}
console.log('（已清理临时 profile 与临时站点目录）');
process.exit(0);
