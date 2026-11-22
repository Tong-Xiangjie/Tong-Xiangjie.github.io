#!/usr/bin/env node
/**
 * 找出「哪个会话点开会黑屏」。
 *
 * 做法：拿一个批包，按会话逐个拆出单会话小包，每次导入后**重载**再点开那一个，
 * 记录崩溃的会话 id 与页面错误。
 *
 * 为什么必须重载：实测一个会话崩了会清空整个 root，之后同页面里再也点不动任何东西。
 *
 * 用法:
 *   node tools/find-crashing-session.mjs <批包.json> [起始序号] [个数]
 *   node tools/find-crashing-session.mjs <批包.json> --ids=id1,id2
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const bundlePath = resolve(process.argv[2] || '');
if (!bundlePath) { console.error('用法: node tools/find-crashing-session.mjs <批包.json> [起始] [个数]'); process.exit(1); }
const rest = process.argv.slice(3);
const idArg = rest.find((x) => x.startsWith('--ids='));
const start = parseInt(rest[0] || '0', 10) || 0;
const count = parseInt(rest[1] || '0', 10) || 0;

let raw = readFileSync(bundlePath, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const bundle = JSON.parse(raw);
const all = bundle.sessions || [];
const filesAll = bundle.files || [];

let picks;
if (idArg) {
  const want = new Set(idArg.slice(6).split(',').map((s) => s.trim()).filter(Boolean));
  picks = all.filter((s) => want.has(s.id));
} else {
  picks = all.slice(start, count > 0 ? start + count : undefined);
}
console.log(`包: ${bundlePath}`);
console.log(`  共 ${all.length} 个会话，本次测 ${picks.length} 个`);

// 附件按 id 索引，拆包时带上被引用到的
const fileById = new Map(filesAll.map((f) => [f.id, f]));

function makeMini(sess) {
  const used = new Set();
  for (const m of (sess.messages || [])) {
    for (const f of (m.files || [])) if (f && f.id) used.add(f.id);
  }
  return {
    ...bundle,
    sessionCount: 1,
    attachmentCount: used.size,
    sessions: [sess],
    files: [...used].map((id) => fileById.get(id)).filter(Boolean),
    note: '单会话诊断包'
  };
}

// ---------------------------------------------------------------------------
const PORT = 9060 + Math.floor(Math.random() * 30);
const CDP_PORT = 9860 + Math.floor(Math.random() * 50);
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

let currentMini = null;
const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/__mini.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(currentMini));
    return;
  }
  const f = files.get(url === '/' ? '/index.html' : url);
  if (!f) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': f.type });
  res.end(f.body);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = findBrowser();
if (/chrome\.exe$/i.test(browser)) { console.error('拒绝：解析到 Chrome'); process.exit(1); }
const profile = mkdtempSync(join(tmpdir(), 'find-crash-'));
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
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (function () {
        window.__diagErrs = window.__diagErrs || [];
        var push = function (src, msg, stack) {
          try { if (window.__diagErrs.length < 80) window.__diagErrs.push({ src: src, msg: String(msg).slice(0, 900), stack: String(stack || '').slice(0, 1400) }); } catch (e) {}
        };
        var origCE = console.error;
        console.error = function () {
          var a = Array.prototype.slice.call(arguments);
          push('console.error', a.map(function (x) { try { return (x && x.stack) ? x.stack : (typeof x === 'string' ? x : JSON.stringify(x)); } catch (e) { return String(x); } }).join(' '), '');
          return origCE.apply(console, arguments);
        };
        window.addEventListener('error', function (e) { push('window.error', e.message || (e.error && e.error.message) || '', (e.error && e.error.stack) || ''); });
        window.addEventListener('unhandledrejection', function (e) { var r = e.reason; push('unhandledrejection', (r && r.message) || String(r), (r && r.stack) || ''); });
      })();
    `
  }).catch(() => {});

  const ev = async (expr, t = 90000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, t);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'eval failed');
    }
    return r.result ? r.result.value : undefined;
  };
  const waitReady = async () => {
    for (let i = 0; i < 120; i++) {
      const ok = await ev(`!!(window.__localstore && typeof window.__localstore.importBundle === 'function')`).catch(() => false);
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };

  await waitReady();
  await ev(`(function(){ try { localStorage.setItem('chat-demo:api-key','sk-diag'); } catch(e){} return 1; })()`);

  const results = [];
  for (let i = 0; i < picks.length; i++) {
    const sess = picks[i];
    currentMini = makeMini(sess);
    // 清库，保证每次只有这一个会话
    await ev(`(async () => {
      try {
        var dbs = await indexedDB.databases();
        for (var d of dbs) { if (d.name) indexedDB.deleteDatabase(d.name); }
        localStorage.clear();
        localStorage.setItem('chat-demo:api-key','sk-diag');
      } catch (e) {}
      return 1;
    })()`, 60000).catch(() => {});
    await ev('location.reload()').catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    await waitReady();
    await ev(`(function(){ try { localStorage.setItem('chat-demo:api-key','sk-diag'); } catch(e){} return 1; })()`);

    const imp = await ev(`(async () => {
      var r = await fetch('/__mini.json');
      var t = await r.text();
      return await window.__localstore.importBundle(t);
    })()`, 180000).catch((e) => ({ err: String(e.message).slice(0, 200) }));

    await ev('location.reload()').catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    let items = 0;
    for (let w = 0; w < 120; w++) {
      items = await ev(`document.querySelectorAll('.item-ff6fc9').length`).catch(() => 0);
      if (items > 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1200));

    const errsBefore = await ev(`(window.__diagErrs || []).length`).catch(() => 0);
    const res = await ev(`
      (async () => {
        var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        var items = document.querySelectorAll('.item-ff6fc9');
        if (!items.length) return { err: '侧栏空' };
        items[0].click();
        await sleep(3000);
        var root = document.getElementById('root');
        var body = document.body ? (document.body.innerText || '') : '';
        return {
          rootChildren: root ? root.children.length : -1,
          items: document.querySelectorAll('.item-ff6fc9').length,
          asst: document.querySelectorAll('.message-e1faee').length,
          user: document.querySelectorAll('.bubble-_4cfe7').length,
          bodyLen: body.length,
          head: body.replace(/\\s+/g, ' ').slice(0, 100)
        };
      })()
    `, 90000).catch((e) => ({ err: String(e.message).slice(0, 200) }));

    const allErrs = await ev(`window.__diagErrs || []`).catch(() => []);
    const newErrs = (allErrs || []).slice(errsBefore);

    const crashed = !res || res.err || res.rootChildren === 0 || res.asst === 0;
    results.push({ id: sess.id, title: String(sess.title || '').slice(0, 30), msgs: (sess.messages || []).length, crashed, res, newErrs });

    console.log(`${crashed ? '❌ 崩' : '✅ 正常'} [${i + 1}/${picks.length}] ${JSON.stringify(String(sess.title || '').slice(0, 26))}  (消息 ${(sess.messages || []).length}, id=${sess.id})`);
    if (res && res.err) console.log(`      打开失败: ${res.err}`);
    if (res && !res.err) console.log(`      root子女=${res.rootChildren} 侧栏=${res.items} 助手=${res.asst} 用户=${res.user} bodyLen=${res.bodyLen}`);
    for (const e of newErrs.slice(0, 2)) {
      console.log(`      [${e.src}] ${e.msg.replace(/\s+/g, ' ').slice(0, 300)}`);
      if (e.stack) console.log(`         栈: ${e.stack.replace(/\s+/g, ' ').slice(0, 500)}`);
    }
  }

  const bad = results.filter((r) => r.crashed);
  console.log('');
  console.log('================ 汇总 ================');
  console.log(`测了 ${results.length} 个：正常 ${results.length - bad.length}，崩 ${bad.length}`);
  if (bad.length) {
    console.log('');
    console.log('崩溃的会话：');
    for (const b of bad) console.log(`  · ${b.id}  ${JSON.stringify(b.title)}  消息 ${b.msgs}`);
    const out = join(tmpdir(), 'crashing-sessions.json');
    writeFileSync(out, JSON.stringify(bad.map((b) => b.id), null, 1), 'utf8');
    console.log(`\n崩溃 id 已写入: ${out}`);
    // 打出第一条错误的完整内容
    const first = bad.find((b) => b.newErrs && b.newErrs.length);
    if (first) {
      console.log('');
      console.log('首个错误的完整内容：');
      console.log(JSON.stringify(first.newErrs[0], null, 1).slice(0, 2500));
    }
  }
} finally {
  await cleanup();
  console.log('（已清理临时 profile）');
}
