#!/usr/bin/env node
/**
 * 诊断：fetch 钩子到底装没装、上传请求走了哪条路。
 * 用法: node tools/diag-upload-hook.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PORT = 9280 + Math.floor(Math.random() * 30);
const CDP_PORT = 9590 + Math.floor(Math.random() * 50);
const BASE = 'https://llmapi.paratera.com';
const KEY = 'sk-_IzbJJ2lh5r7zqemUdIWsQ';

const files = new Map();
const rec = (dir, prefix = '') => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? prefix + '/' + name : name;
    if (statSync(abs).isDirectory()) rec(abs, rel);
    else files.set('/' + rel.split('\\').join('/'), { body: readFileSync(abs), type: MIME[rel.slice(rel.lastIndexOf('.'))] || 'application/octet-stream' });
  }
};
rec(ROOT);
const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const f = files.get(url === '/' ? '/index.html' : url);
  if (!f) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': f.type });
  res.end(f.body);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = findBrowser();
if (/chrome\.exe$/i.test(browser)) { console.error('拒绝：解析到 Chrome'); process.exit(1); }
const profile = mkdtempSync(join(tmpdir(), 'diag-hook-'));
const proc = spawn(browser, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1400,1000',
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

const cleanup = async () => {
  try { proc.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
};

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { target = await fetchPageTarget(CDP_PORT); } catch (e) {}
  }
  if (!target) { console.error('✗ 连不上浏览器'); await cleanup(); process.exit(1); }
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  const logs = [];
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const m = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    logs.push(String(m));
  });
  const ev = async (expr, t = 180000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, t);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'eval failed');
    }
    return r.result ? r.result.value : undefined;
  };

  for (let i = 0; i < 120; i++) {
    const ok = await ev(`!!(window.__lsFeatures && window.__localstore)`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await ev(`(function(){
    try {
      localStorage.setItem('chat-demo:api-base', ${JSON.stringify(BASE)});
      localStorage.setItem('chat-demo:api-key', ${JSON.stringify(KEY)});
    } catch(e){}
    return 1;
  })()`);
  await ev('location.reload()').catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  for (let i = 0; i < 120; i++) {
    const ok = await ev(`!!(window.__lsFeatures && document.querySelector('textarea'))`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const state = await ev(`
    (function () {
      var L = window.__localstore;
      var keys = [];
      try { keys = Object.keys(L); } catch (e) {}
      return {
        fetchPatched: !!window.fetch.__localstorePatched,
        fetchName: String(window.fetch.name || ''),
        hasUploadLog: typeof L.uploadLog === 'function',
        lsKeys: keys.filter(function (k) { return /upload|net|fetch|trace/i.test(k); }),
        base: localStorage.getItem('chat-demo:api-base'),
        keySet: !!localStorage.getItem('chat-demo:api-key'),
        protocol: (typeof L.resolveProtocol === 'function') ? L.resolveProtocol() : 'n/a',
        effectiveBase: (typeof L.effectiveBase === 'function') ? L.effectiveBase() : 'n/a'
      };
    })()
  `);
  console.log('=== 运行时状态 ===');
  console.log(JSON.stringify(state, null, 2));

  logs.length = 0;
  const out = await ev(`
    (async () => {
      var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var F = window.__lsFeatures;
      var text = '钩子诊断\\n';
      for (var i = 1; i <= 80; i++) text += '第' + i + '行：诊断用内容，需要足够长才会转成 txt 附件。\\n';
      var ok = F.attachTextAsFile(text);
      await sleep(11000);
      var cards = document.querySelectorAll('[class*="attachments-"] > [class*="card-"]');
      var info = [];
      for (var c = 0; c < cards.length; c++) info.push({ cls: String(cards[c].className||''), text: (cards[c].textContent||'').trim().slice(0,30) });
      var ul = null;
      try { ul = window.__localstore.uploadLog ? window.__localstore.uploadLog() : null; } catch (e) { ul = String(e); }
      var tr = null;
      try { tr = window.__localstore.protocol.trace(); } catch (e) { tr = String(e); }
      var diag = null;
      try { diag = window.__localstore.protocol.diagnose(); } catch (e) { diag = String(e); }
      return { attachOk: ok, cards: info, uploadLog: ul, trace: tr, diag: diag,
               lastPaste: (F.lastPaste || null) };
    })()
  `, 240000);

  console.log('');
  console.log('=== 粘贴+上传结果 ===');
  console.log(JSON.stringify(out, null, 2));
  console.log('');
  console.log('=== 页面日志（localstore 相关）===');
  const rel = logs.filter((x) => /localstore|lsfeat|上传|回退|调试/.test(x));
  for (const x of rel.slice(-25)) console.log('  ' + x.slice(0, 240));
  if (!rel.length) console.log('（没有）');
} finally {
  await cleanup();
  console.log('（已清理临时 profile）');
}
