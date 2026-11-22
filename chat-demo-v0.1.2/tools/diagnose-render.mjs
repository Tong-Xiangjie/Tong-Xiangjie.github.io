#!/usr/bin/env node
/**
 * 诊断「点开对话就黑屏」：导入一个批包，然后逐个点开侧栏里每个对话，
 * 记录哪个对话崩了、页面具体报什么错。
 *
 * 关键点：把页面的**运行时异常**和 console.error 抓下来 —— 黑屏基本是
 * React 渲染抛异常，异常信息就是根因。
 *
 * 只用 Edge（DSH_BROWSER），绝不拉起 Chrome。
 *
 * 用法: node tools/diagnose-render.mjs <批包.json> [最多点开几个]
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const bundlePath = resolve(process.argv[2] || '');
const maxOpen = parseInt(process.argv[3] || '12', 10);
if (!bundlePath) { console.error('用法: node tools/diagnose-render.mjs <批包.json> [最多点开几个]'); process.exit(1); }

const bundleText = readFileSync(bundlePath, 'utf8');
let bundle;
try { bundle = JSON.parse(bundleText.charCodeAt(0) === 0xFEFF ? bundleText.slice(1) : bundleText); }
catch (e) { console.error('包不是合法 JSON: ' + e.message); process.exit(1); }

const titles = (bundle.sessions || []).map((s) => String(s.title || '')).filter(Boolean);
console.log(`待测包: ${bundlePath}`);
console.log(`  会话 ${(bundle.sessions || []).length} 个，附件 ${(bundle.files || []).length} 个，${(bundleText.length / 1048576).toFixed(2)} MB`);
console.log(`  将逐个点开前 ${Math.min(maxOpen, titles.length)} 个对话`);
console.log('');

// ---------------------------------------------------------------------------
// 静态服务 + 浏览器
// ---------------------------------------------------------------------------
const PORT = 8990 + Math.floor(Math.random() * 40);
const CDP_PORT = 9700 + Math.floor(Math.random() * 60);
const files = new Map();
{
  const walk = (rel) => {
    const abs = join(ROOT, rel);
    try {
      const st = readFileSync(abs);
      files.set('/' + rel.split('\\').join('/'), { body: st, type: MIME[rel.slice(rel.lastIndexOf('.'))] || 'application/octet-stream' });
    } catch (e) { /* 跳过 */ }
  };
  const { readdirSync, statSync } = await import('node:fs');
  const rec = (dir, prefix = '') => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = prefix ? prefix + '/' + name : name;
      if (statSync(abs).isDirectory()) rec(abs, rel);
      else walk(rel);
    }
  };
  rec(ROOT);
  files.set('/__test.json', { body: Buffer.from(bundleText, 'utf8'), type: 'application/json' });
}
const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const f = files.get(url === '/' ? '/index.html' : url);
  if (!f) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': f.type });
  res.end(f.body);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = findBrowser();
if (/chrome\.exe$/i.test(browser)) { console.error('拒绝：解析到 Chrome，本脚本只用 Edge'); process.exit(1); }
const profile = mkdtempSync(join(tmpdir(), 'diag-render-'));
const proc = spawn(browser, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1400,1000',
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore', detached: false });

let cdp = null;
const cleanup = async () => {
  try { if (cdp) await cdp.close(); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
};
process.on('exit', () => { try { proc.kill(); } catch (e) {} });

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { target = await fetchPageTarget(CDP_PORT); } catch (e) { /* 还没起来 */ }
  }
  if (!target) { console.error('✗ 连不上浏览器'); await cleanup(); process.exit(1); }
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable').catch(() => {});
  /**
   * ★ 在**文档加载前**就把钩子装进去 ★
   *
   * 上一次的做法是页面加载完再装，结果 location.reload() 之后钩子就没了，
   * 而且"点击对话 → root 被清空"这个过程里的错误一条都抓不到。
   * 用 addScriptToEvaluateOnNewDocument 让每次新文档都先装钩子，重载也不会丢。
   */
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (function () {
        window.__diagErrs = window.__diagErrs || [];
        var push = function (src, msg, stack) {
          try {
            if (window.__diagErrs.length < 80) {
              window.__diagErrs.push({ src: src, msg: String(msg).slice(0, 800), stack: String(stack || '').slice(0, 1200) });
            }
          } catch (e) {}
        };
        window.__diagPush = push;
        var origCE = console.error;
        console.error = function () {
          var a = Array.prototype.slice.call(arguments);
          push('console.error', a.map(function (x) {
            try { return (x && x.stack) ? x.stack : (typeof x === 'string' ? x : JSON.stringify(x)); } catch (e) { return String(x); }
          }).join(' '), '');
          return origCE.apply(console, arguments);
        };
        window.addEventListener('error', function (e) {
          push('window.error', e.message || (e.error && e.error.message) || '', (e.error && e.error.stack) || '');
        });
        window.addEventListener('unhandledrejection', function (e) {
          var r = e.reason;
          push('unhandledrejection', (r && r.message) || String(r), (r && r.stack) || '');
        });
      })();
    `
  }).catch(() => {});

  // ---- 抓页面异常与 console.error ----
  const pageErrors = [];
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || '';
    pageErrors.push({ kind: 'exception', text: String(desc).slice(0, 600), url: d.url, line: d.lineNumber });
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error' && p.type !== 'warning') return;
    const txt = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 500);
    pageErrors.push({ kind: p.type, text: txt });
  });
  /**
   * ★ 页面内自己的兜底 ★
   *
   * CDP 的 Runtime.exceptionThrown 抓不到的情况：React 的错误边界自己 catch 了、
   * 或者异常发生在某个被吞掉的 Promise 里。所以这里在页面里再装一层钩子，
   * 直接覆盖 console.error / window.onerror / unhandledrejection / Error 构造，
   * 把栈存到 window.__diagErrs。
   *
   * Error 构造那层是关键：React 渲染抛异常时会 new Error(...)，把栈存下来就能
   * 知道是哪个组件/哪一行炸的。
   */
  const installHooks = () => ev(`
    (function () {
      if (window.__diagHooked) return 'already';
      window.__diagHooked = true;
      window.__diagErrs = [];
      var push = function (src, msg, stack) {
        try {
          if (window.__diagErrs.length < 60) {
            window.__diagErrs.push({ src: src, msg: String(msg).slice(0, 700), stack: String(stack || '').slice(0, 900) });
          }
        } catch (e) {}
      };
      var origCE = console.error;
      console.error = function () {
        var a = Array.prototype.slice.call(arguments);
        push('console.error', a.map(function (x) {
          try { return (x && x.stack) ? x.stack : (typeof x === 'string' ? x : JSON.stringify(x)); } catch (e) { return String(x); }
        }).join(' '), '');
        return origCE.apply(console, arguments);
      };
      window.addEventListener('error', function (e) {
        push('window.error', e.message || (e.error && e.error.message) || '', (e.error && e.error.stack) || '');
      });
      window.addEventListener('unhandledrejection', function (e) {
        var r = e.reason;
        push('unhandledrejection', (r && r.message) || String(r), (r && r.stack) || '');
      });
      return 'installed';
    })()
  `);

  const ev = async (expr, timeoutMs = 60000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'eval failed');
    }
    return r.result ? r.result.value : undefined;
  };

  // ---- 等页面就绪 ----
  for (let i = 0; i < 120; i++) {
    const ok = await ev(`!!(window.__localstore && window.__localstore.version) && !!window.__lsFeatures`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('页面内钩子:', await installHooks().catch((e) => '装不上: ' + e.message));
  await ev(`
    (function () {
      try { localStorage.setItem('chat-demo:api-key', 'sk-diag-local-only'); } catch (e) {}
      return 'ok';
    })()
  `);

  // ---- 注入包并导入 ----
  const seed = await ev(`
    (async () => {
      var r = await fetch('/__test.json');
      var t = await r.text();
      window.__diagBundle = t;
      if (typeof window.__localstore.importBundle !== 'function') {
        return { err: 'importBundle 不存在', keys: Object.keys(window.__localstore || {}) };
      }
      var res = await window.__localstore.importBundle(t);
      return { ok: true, res: res };
    })()
  `, 300000);
  console.log('导入结果:', JSON.stringify(seed).slice(0, 300));
  if (seed && seed.err) { console.error('✗ ' + seed.err); await cleanup(); process.exit(1); }

  // 导入后必须刷新（应用启动时才把会话读进内存）
  await cdp.send('Page.enable').catch(() => {});
  await ev(`location.reload()`).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  for (let i = 0; i < 180; i++) {
    const n = await ev(`document.querySelectorAll('.item-ff6fc9').length`).catch(() => 0);
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 2000));
  const sideCount = await ev(`document.querySelectorAll('.item-ff6fc9').length`);
  console.log(`刷新后侧栏: ${sideCount} 项`);

  // 侧栏里真实的标题是什么（别靠猜）
  const sideTitles = await ev(`
    (function () {
      var out = [];
      var items = document.querySelectorAll('.item-ff6fc9');
      for (var i = 0; i < items.length && i < 8; i++) {
        var ti = items[i].querySelector('.title-ff6fc9');
        out.push({
          title: ti ? (ti.textContent || '').trim().slice(0, 40) : null,
          itemText: (items[i].innerText || items[i].textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
          cls: items[i].className
        });
      }
      return out;
    })()
  `);
  console.log('侧栏前 8 项实际内容:');
  for (const s of (sideTitles || [])) console.log(`   title=${JSON.stringify(s.title)}  item=${JSON.stringify(s.itemText)}`);
  console.log('');

  // ---- 逐个点开 ----
  const n = Math.min(maxOpen, titles.length);
  const results = [];
  for (let i = 0; i < n; i++) {
    const title = titles[i];
    const before = pageErrors.length;
    let opened = null;
    try {
      opened = await ev(`
        (async () => {
          var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
          var title = ${JSON.stringify(title)};
          var wantIdx = ${i};
          var items = document.querySelectorAll('.item-ff6fc9');
          var hit = null, hitIdx = -1, i2;
          // 先按标题精确匹配
          for (i2 = 0; i2 < items.length; i2++) {
            var ti = items[i2].querySelector('.title-ff6fc9');
            if (ti && ti.textContent.trim() === title) { hit = items[i2]; hitIdx = i2; break; }
          }
          // 匹配不到就按"第 i 项"点（顺序与包内顺序一致）
          if (!hit && items[wantIdx]) { hit = items[wantIdx]; hitIdx = wantIdx; }
          if (!hit) return { err: '侧栏没有第 ' + wantIdx + ' 项（共 ' + items.length + ' 项）' };
          var realTitle = null;
          var rti = hit.querySelector('.title-ff6fc9');
          if (rti) realTitle = (rti.textContent || '').trim();
          hit.click();
          await sleep(1500);
          var body1 = document.body ? (document.body.innerText || document.body.textContent || '') : '';
          var items1 = document.querySelectorAll('.item-ff6fc9').length;
          // 看看是不是崩了之后又恢复
          await sleep(1500);
          var body2 = document.body ? (document.body.innerText || document.body.textContent || '') : '';
          var items2 = document.querySelectorAll('.item-ff6fc9').length;
          // 把整个 DOM 结构摘要出来
          var nodes = [];
          var walk = function (el, depth) {
            if (!el || nodes.length > 60) return;
            nodes.push('  '.repeat(depth) + el.tagName.toLowerCase() +
              (el.id ? '#' + el.id : '') +
              (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : '') +
              ' [' + ((el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40)) + ']');
            for (var c = 0; c < el.children.length && nodes.length <= 60; c++) walk(el.children[c], depth + 1);
          };
          try { walk(document.body, 0); } catch (e) { nodes.push('walk 失败: ' + e.message); }
          return {
            hitIdx: hitIdx,
            realTitle: realTitle,
            itemsAfterClick: items1,
            itemsAfterClick2: items2,
            bodyLen: body1.length,
            bodyLen2: body2.length,
            mainEls: document.querySelectorAll('.main-_9fdf5').length,
            asstEls: document.querySelectorAll('.message-e1faee').length,
            userEls: document.querySelectorAll('.bubble-_4cfe7').length,
            thinkEls: document.querySelectorAll('[class*="think"]').length,
            welcome: document.querySelectorAll('.container-_1f155').length,
            rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1,
            head: body1.replace(/\\s+/g, ' ').slice(0, 200),
            domTree: nodes.join('\\n')
          };
        })()
      `, 90000);
    } catch (e) {
      opened = { err: String(e.message).slice(0, 300) };
    }
    const newErrs = pageErrors.slice(before);
    const row = { i: i + 1, title: title.slice(0, 30), opened, errs: newErrs };
    results.push(row);

    const blank = !opened || opened.err || (opened.bodyLen !== undefined && opened.bodyLen < 300);
    const tag = blank ? '❌' : (newErrs.length ? '⚠ ' : '✅');
    console.log(`${tag} [${i + 1}/${n}] 包内标题=${JSON.stringify(title.slice(0, 26))}`);
    console.log(`      侧栏命中第 ${opened && opened.hitIdx} 项，实际标题=${JSON.stringify(opened && opened.realTitle)}`);
    console.log(`      点击后侧栏项数: 1.5s=${opened && opened.itemsAfterClick}  3s=${opened && opened.itemsAfterClick2}   root子女=${opened && opened.rootChildren}`);
    console.log(`      bodyLen: 1.5s=${opened && opened.bodyLen}  3s=${opened && opened.bodyLen2}`);
    console.log(`      主区=${opened && opened.mainEls} 助手气泡=${opened && opened.asstEls} 用户气泡=${opened && opened.userEls} 欢迎页=${opened && opened.welcome}`);
    if (opened && opened.err) console.log(`      打开失败: ${opened.err}`);
    if (opened && opened.head) console.log(`      开头: ${opened.head}`);
    for (const e of newErrs.slice(0, 3)) console.log(`      ${e.kind}: ${e.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    if (blank && i === 0 && opened && opened.domTree) {
      console.log('');
      console.log('      ── 点击后 DOM 结构（最多 60 层）──');
      for (const line of opened.domTree.split('\n')) console.log('      ' + line);
    }
    console.log('');
  }

  console.log('================ 汇总 ================');
  const blanks = results.filter((r) => !r.opened || r.opened.err || (r.opened.bodyLen !== undefined && r.opened.bodyLen < 300));
  const withErr = results.filter((r) => r.errs && r.errs.length);
  console.log(`点开 ${results.length} 个：正常 ${results.length - blanks.length}，异常/空白 ${blanks.length}`);
  console.log(`有页面报错的: ${withErr.length} 个`);
  console.log(`页面异常总数: ${pageErrors.length}`);
  if (pageErrors.length) {
    console.log('');
    console.log('前 8 条页面错误：');
    const seen = new Set();
    for (const e of pageErrors) {
      const key = e.text.replace(/\d+/g, '#').slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  · ${e.kind}: ${e.text.replace(/\s+/g, ' ').slice(0, 500)}`);
      if (seen.size >= 8) break;
    }
  }

  // ★ 页面内钩子抓到的错误（CDP 抓不到的那一类）★
  try {
    const inPage = await ev(`window.__diagErrs || []`, 30000);
    console.log('');
    console.log(`页面内钩子抓到 ${inPage ? inPage.length : 0} 条：`);
    if (inPage && inPage.length) {
      const seen2 = new Set();
      for (const e of inPage) {
        const key = (e.msg || '').replace(/\d+/g, '#').slice(0, 140);
        if (seen2.has(key)) continue;
        seen2.add(key);
        console.log(`  · [${e.src}] ${(e.msg || '').replace(/\s+/g, ' ').slice(0, 600)}`);
        if (e.stack) console.log(`      栈: ${e.stack.replace(/\s+/g, ' ').slice(0, 700)}`);
        if (seen2.size >= 10) break;
      }
    }
  } catch (e) { /* 忽略 */ }
} finally {
  await cleanup();
  console.log('（已清理临时 profile）');
}
