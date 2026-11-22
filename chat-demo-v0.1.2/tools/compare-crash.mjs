#!/usr/bin/env node
/**
 * 新旧对照：把两份桥接层放进**完全相同的环境**跑同一套压力动作，比谁更糟。
 *
 * 为什么要做这个对照：
 *   用户怀疑"Chrome 崩溃是我的工作导致的"。光看新版干净证明不了什么 ——
 *   必须把"会崩的旧版"（线上 4950e960）拿回来，用同样的环境跑，看它是否
 *   真的表现出更糟的行为（文件系统调用暴涨、异常、句柄泄漏、进程被杀）。
 *   两边用同一个浏览器（Edge）、同样的 headless 参数、同样的动作序列。
 *
 * 局限（必须如实说明）：
 *   旧版的崩溃需要**真的连上用户的 E:\ChatHistory 目录**才会触发，
 *   而 FSA 授权强制要求用户手势，脚本模拟不出来。
 *   所以这里测的是"没有授权时旧版会做什么" —— 也就是页面一打开、
 *   用户还没点任何东西时的那段自动逻辑。
 *   如果旧版在这段就大量发文件系统调用，那它的危险性是能证明的。
 */
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { CDP, fetchPageTarget, findBrowser } from 'file:///C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2/tools/minimal-cdp.mjs';

const NEW_ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const HOLD_MS = 45000;   // 每个版本观察 45 秒（闲置 + 动作）
const SAMPLE_MS = 5000;

const browserPath = findBrowser();
if (/chrome\.exe$/i.test(browserPath)) {
  console.error('拒绝执行：这会拉起 Chrome。');
  process.exit(1);
}

// 组装"旧版"目录：首页 + static + 旧桥接层
const { cpSync } = await import('node:fs');
function buildOldRoot2() {
  const dir = mkdtempSync(join(tmpdir(), 'oldver-'));
  copyFileSync(join(NEW_ROOT, 'index.html'), join(dir, 'index.html'));
  copyFileSync(join(process.env.TEMP, 'old-bridge-probe', 'localstore-bridge.js'),
               join(dir, 'localstore-bridge.js'));
  // static 下面还有子目录（async 等），必须整棵拷，不能只拷一层
  cpSync(join(NEW_ROOT, 'static'), join(dir, 'static'), { recursive: true });
  return dir;
}

async function runOne(label, root) {
  const PORT = 8890 + Math.floor(Math.random() * 8);
  const CDP_PORT = 9350 + Math.floor(Math.random() * 8);

  const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = join(root, p);
    if (!existsSync(f)) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  const profile = mkdtempSync(join(tmpdir(), 'cmp-'));
  const proc = spawn(browserPath, [
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `http://127.0.0.1:${PORT}/index.html`
  ], { stdio: 'ignore' });

  let exited = false, exitInfo = null;
  proc.on('exit', (code, signal) => { exited = true; exitInfo = { code, signal }; });

  const target = await fetchPageTarget(CDP_PORT);
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  let errors = 0;
  cdp.on('event', (msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      errors++;
      const d = msg.params.exceptionDetails;
      console.log(`  [${label}] 异常: ` + (d.exception?.description || d.text).split('\n')[0].slice(0, 120));
    }
  });

  const ev = async (expr) => {
    try { return await cdp.evaluate(expr); } catch (e) { return { __err: String(e.message) }; }
  };

  await new Promise((r) => setTimeout(r, 2500));

  // 关键指标：桥接层的文件系统调用次数、以及它自己报的状态
  const probe = async () => {
    const r = await ev(`(function(){
      var L = window.__localstore;
      if (!L) return { bridge: false };
      var out = { bridge: true, version: L.version };
      try { out.breaker = L.fsBreaker ? L.fsBreaker() : null; } catch(e) { out.breaker = 'ERR'; }
      try { out.hasPick = typeof L.pickFolder; } catch(e) {}
      try { out.hasSnapshot = typeof L.snapshot; } catch(e) {}
      try { out.hasExport = typeof L.exportBundle; } catch(e) {}
      try {
        var k = L.syncDoctor ? 'yes' : 'no';
        out.doctor = k;
      } catch(e) {}
      return out;
    })()`);
    return r;
  };

  const samples = [];
  const t0 = Date.now();
  // 前半段：纯闲置，看有没有"自己在那发请求"
  while (Date.now() - t0 < HOLD_MS && !exited) {
    await new Promise((r) => setTimeout(r, SAMPLE_MS));
    const p = await probe();
    samples.push(p);
    const calls = p && p.breaker ? p.breaker['调用次数'] : '?';
    console.log(`  [${label}] ${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s 存活=${exited ? '否' : '是'} 文件系统调用=${calls}`);
    // 顺手触发几个"用户会做"的动作
    await ev(`(function(){ try { var b=document.querySelector('#localstore-section .ls-btns button'); if(b) b.click(); } catch(e){} })()`);
  }

  const last = samples[samples.length - 1] || {};
  const result = {
    label,
    survived: !exited,
    exitInfo,
    errors,
    version: last.version || null,
    breaker: last.breaker || null,
    hasPickFolder: last.hasPick || null,
    hasSnapshot: last.hasSnapshot || null,
    hasExport: last.hasExport || null
  };

  try { cdp.close(); } catch { }
  try { proc.kill(); } catch { }
  server.close();
  await new Promise((r) => setTimeout(r, 600));
  try {
    execSync(`powershell -NoProfile -Command "Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-2) } | Stop-Process -Force -ErrorAction SilentlyContinue"`, { stdio: 'ignore' });
  } catch { }
  try { rmSync(profile, { recursive: true, force: true }); } catch { }
  return result;
}

console.log('浏览器: ' + browserPath + '\n');

const oldRoot = buildOldRoot2();
console.log('=== A) 线上旧版（4950e960，带文件夹读写）===');
const rOld = await runOne('旧', oldRoot);

console.log('\n=== B) 本地新版（ae6dd028，无文件夹读写）===');
const rNew = await runOne('新', NEW_ROOT);

console.log('\n================ 对照结果 ================');
const row = (k, a, b) => console.log(k.padEnd(26) + '旧: ' + String(a).padEnd(28) + '新: ' + String(b));
row('存活', rOld.survived ? '是' : '否', rNew.survived ? '是' : '否');
row('退出信息', JSON.stringify(rOld.exitInfo), JSON.stringify(rNew.exitInfo));
row('页面异常数', rOld.errors, rNew.errors);
row('桥接层版本', rOld.version, rNew.version);
row('文件系统调用次数', rOld.breaker ? rOld.breaker['调用次数'] : '-', rNew.breaker ? rNew.breaker['调用次数'] : '-');
row('有 pickFolder（危险入口）', rOld.hasPickFolder, rNew.hasPickFolder);
row('有 snapshot（会写盘）', rOld.hasSnapshot, rNew.hasSnapshot);
row('有 exportBundle（新功能）', rOld.hasExport, rNew.hasExport);

try { rmSync(oldRoot, { recursive: true, force: true }); } catch { }
console.log('\n（已清理临时目录）');
process.exit(0);
