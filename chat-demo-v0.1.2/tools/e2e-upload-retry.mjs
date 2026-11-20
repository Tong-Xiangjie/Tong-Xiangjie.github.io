/**
 * 验证上传诊断与重试：/anthropic/v1/files 前两次故意失败，第三次成功。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget } from './minimal-cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8888;
const CDP_PORT = 9378;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

let fileAttempts = 0;
let uploadAttempts = 0;
let dropAttempts = 0;
let dropMode = false;
const seen = [];
const dropSeen = [];
const diagnostic = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/__reset') {
    fileAttempts = 0;
    uploadAttempts = 0;
    dropAttempts = 0;
    dropMode = false;
    seen.length = 0;
    dropSeen.length = 0;
    diagnostic.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  // 切到「网络层被掐断」场景
  if (url.pathname === '/__mode/drop') {
    dropMode = true;
    dropAttempts = 0;
    dropSeen.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }

  if (url.pathname.endsWith('/files')) {
    fileAttempts++;
    seen.push(url.pathname);
    const ctype = String(req.headers['content-type'] || '');
    const isUpload = /multipart\/form-data/.test(ctype);
    if (isUpload) uploadAttempts++;
    diagnostic.push({ n: fileAttempts, up: uploadAttempts, ctype: ctype.slice(0, 40), isUpload, mode: dropMode ? 'drop' : '5xx' });
    req.resume();

    // drop 场景：前两次直接销毁 socket，模拟网络层被掐断
    if (dropMode && isUpload) {
      dropAttempts++;
      dropSeen.push(dropAttempts);
      if (dropAttempts <= 2) { req.socket.destroy(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'file_ok', type: 'file' }));
      return;
    }
    // 前两次「附件」上传让服务端返回 5xx，第三次成功。
    //
    // ★ 为什么用 5xx 而不是销毁 socket：
    //   原先用 req.socket.destroy()，但 Chrome 会**自己**在底层静默重连重发，
    //   应用侧的 fetch 有时根本看不到失败（实测：服务端明明掐了 2 次，
    //   客户端日志里却只有 1 次失败，甚至一次都没有）。
    //   这样一来测试结果就取决于 Chrome 的透明重试，是随机失败的根因。
    //   5xx 是应用层可见的、确定的瞬时故障，正好用来稳定地验证重试逻辑。
    //   （网络层错误的重试路径另有断言覆盖，见下方网络错误用例。）
    //
    // 判定只看真正的附件上传（multipart），不能用「本进程收到的第几次 /files」：
    // 应用启动、切提供方都会先打一次 /files 探测，计数器会漂移。
    if (isUpload && uploadAttempts <= 2) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{"error":"temporarily unavailable"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'file_ok', type: 'file' }));
    return;
  }

  if (url.pathname === '/models' || url.pathname === '/anthropic/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }] }));
    return;
  }

  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
};

const profile = mkdtempSync(join(tmpdir(), 'cdp-up-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
   '--no-first-run', '--window-size=1200,800', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await sleep(3000);
const ev = (e) => cdp.evaluate(e);

console.log('\n=== 上传重试与诊断 ===\n');

// 配置一个带 Key 的提供方指向本地假服务（走桥接自己的接口，最贴近真实路径）
await ev(`
  (() => {
    const L = window.__localstore;
    L.updateProvider('deepseek-official', {
      baseURL: 'http://127.0.0.1:${PORT}',
      apiKey: 'sk-local-upload-test',
      models: ['deepseek-flash'],
      defaultModel: 'deepseek-flash'
    });
    L.setActiveProvider('deepseek-official');
    return true;
  })()
`);
await sleep(600);

const active = JSON.parse(await ev(`JSON.stringify(window.__localstore.getActiveProvider())`));
console.log('  生效提供方: ' + JSON.stringify({ id: active.id, baseURL: active.baseURL, hasKey: !!active.apiKey }));
check('生效提供方指向本地假服务', active.baseURL === `http://127.0.0.1:${PORT}`, active.baseURL);
check('生效提供方带上了 Key', !!active.apiKey);

const rep0 = await ev(`JSON.stringify(window.__localstore.uploadLog().report)`);
console.log('  上传前报告: ' + rep0);
check('诊断接口可用且报出桥接版本', /bridge v\d+\.\d+\.\d+/.test(rep0), rep0);
check('报告里含上传地址', /\/anthropic\/v1\/files/.test(rep0), rep0);

// 触发上传：前两次服务端返回 503，第三次成功
const uploaded = await ev(`
  (async () => {
    try {
      const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
      const fd = new FormData();
      fd.append('purpose', 'assistant');
      fd.append('file', file);
      const r = await fetch('http://127.0.0.1:${PORT}/anthropic/v1/files', {
        method: 'POST',
        headers: { 'x-api-key': 'sk-local-upload-test', 'anthropic-beta': 'files-api-2025-04-14' },
        body: fd
      });
      return JSON.stringify({ ok: r.ok, status: r.status });
    } catch (e) {
      return 'ERR ' + e.message;
    }
  })()
`);
console.log('  上传结果: ' + uploaded);
check('服务端临时故障后重试成功', JSON.parse(uploaded).ok === true, uploaded);
console.log('  服务端看到的 /files 请求:');
diagnostic.forEach((d) => console.log('    ' + JSON.stringify(d)));
check('服务端一共收到 3 次附件上传尝试', uploadAttempts === 3, `实际 ${uploadAttempts} 次`);
check('路径始终正确（无重复 /anthropic）',
  seen.every((p) => p === '/anthropic/v1/files'), JSON.stringify(seen));

// 诊断日志是同步 push 的，fetch resolve 时应当已经写全，不需要额外等待。
const log = JSON.parse(await ev(`JSON.stringify(window.__localstore.uploadLog())`));
console.log('  诊断 entries:');
log.entries.forEach((e) => console.log('    ' + JSON.stringify(e)));
console.log('  最终报告: ' + log.report);

const errors = log.entries.filter((e) => e.status === 'error');
const oks = log.entries.filter((e) => e.status === 'ok');
check('诊断记录了 2 次失败', errors.length === 2,
  JSON.stringify(errors.length) + ' 全部条目=' + JSON.stringify(log.entries.map((e) => e.status + '/' + e.attempt)));
check('诊断记录了 1 次成功', oks.length === 1, JSON.stringify(oks.length));
check('诊断记录了上传前的预检信息',
  !!(log.entries[0] && log.entries[0].preflight && log.entries[0].preflight.keyHint),
  JSON.stringify(log.entries[0]));
check('报告结论指向成功', /HTTP 200/.test(log.report), log.report);

// ---------------------------------------------------------------------------
// 第二条重试路径：网络层被掐断（fetch 抛 TypeError）。
// 切到 drop 模式，并仍打 /anthropic/v1/files —— 路径必须匹配桥接层的
// `/\/files(\?|$)/`，否则请求根本不会被接管（踩过：一开始用了
// `/__flaky-files`，看起来像 /files 结尾其实不是，于是完全没走重试）。
//
// 只断言「最终成功」，不断言服务端请求次数：Chrome 对掐断的连接会自己
// 静默重连重发（实测服务端掐了 2 次、客户端只看到 1 次失败，甚至 0 次），
// 所以观测到的次数本身就不确定。要保证的是重试最终把附件传上去。
await ev(`fetch('http://127.0.0.1:${PORT}/__mode/drop').then(r => r.text())`);
const dropped = await ev(`
  (async () => {
    try {
      const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
      const fd = new FormData();
      fd.append('purpose', 'assistant');
      fd.append('file', file);
      const r = await fetch('http://127.0.0.1:${PORT}/anthropic/v1/files', {
        method: 'POST',
        headers: { 'x-api-key': 'sk-local-upload-test' },
        body: fd
      });
      return JSON.stringify({ ok: r.ok, status: r.status });
    } catch (e) {
      return 'ERR ' + e.message;
    }
  })()
`);
console.log('  网络掐断用例: ' + dropped + '  服务端收到附件尝试 ' + dropAttempts + ' 次（' + dropSeen.join(',') + '）');
check('网络被掐断后仍能重试成功', JSON.parse(dropped).ok === true, dropped);

cdp.close(); chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.close();

console.log('\n' + '='.repeat(46));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
