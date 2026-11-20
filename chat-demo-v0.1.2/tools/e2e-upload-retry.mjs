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
const seen = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname.endsWith('/files')) {
    fileAttempts++;
    seen.push(url.pathname);
    req.resume();
    if (fileAttempts <= 2) {
      // 模拟 HTTP/2 连接被掐断：直接销毁 socket，fetch 会抛 TypeError
      req.socket.destroy();
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

// 触发上传：前两次会被服务端掐断，第三次应成功
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
check('瞬时故障后重试成功', JSON.parse(uploaded).ok === true, uploaded);
check('服务端一共收到 3 次尝试', fileAttempts === 3, `实际 ${fileAttempts} 次`);
check('路径始终正确（无重复 /anthropic）',
  seen.every((p) => p === '/anthropic/v1/files'), JSON.stringify(seen));

const log = JSON.parse(await ev(`JSON.stringify(window.__localstore.uploadLog())`));
console.log('  诊断 entries:');
log.entries.forEach((e) => console.log('    ' + JSON.stringify(e)));
console.log('  最终报告: ' + log.report);

const errors = log.entries.filter((e) => e.status === 'error');
const oks = log.entries.filter((e) => e.status === 'ok');
check('诊断记录了 2 次失败', errors.length === 2, JSON.stringify(errors.length));
check('诊断记录了 1 次成功', oks.length === 1, JSON.stringify(oks.length));
check('诊断记录了上传前的预检信息',
  !!(log.entries[0] && log.entries[0].preflight && log.entries[0].preflight.keyHint),
  JSON.stringify(log.entries[0]));
check('报告结论指向成功', /HTTP 200/.test(log.report), log.report);

cdp.close(); chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.close();

console.log('\n' + '='.repeat(46));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
