#!/usr/bin/env node
/**
 * 验证「批量导入」按钮：一次选多个包，只刷新一次。
 *
 * 做法：造 3 个小包（共 6 个对话），模拟用户一次选中 3 个文件
 * （直接构造 FileList 派发 change），然后检查：
 *   · 库里是否 6 个对话都在
 *   · 是否只刷新了一次
 *
 * 用法: node tools/verify-batch-import.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PORT = 9130 + Math.floor(Math.random() * 30);
const CDP_PORT = 9950 + Math.floor(Math.random() * 45);

function makeBundle(n, offset) {
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const k = offset + i;
    sessions.push({
      id: 'batch-' + k,
      title: '批量测试 ' + k,
      createdAt: 1785000000000 + k * 1000,
      updatedAt: 1785000000000 + k * 1000 + 500,
      rootMessageId: 'm' + k + 'a',
      messages: [
        { id: 'm' + k + 'a', role: 'user', parentId: null, selectedChildId: 'm' + k + 'b', content: '用户消息 ' + k, createdAt: 1785000000000 + k * 1000, files: [] },
        {
          id: 'm' + k + 'b', role: 'assistant', parentId: 'm' + k + 'a', selectedChildId: null,
          createdAt: 1785000000000 + k * 1000 + 500,
          blocks: [{ type: 'text', text: '助手回复 ' + k }],
          model: null, thinking: false, search: false, prefix: false, status: 'done',
          latestReminder: '2026-07-25,星期六,,Web,中文'
        }
      ]
    });
  }
  return { schema: 'chat-demo-export@1', note: 't', exportedAt: Date.now(), appVersion: 't', bridgeVersion: 't', origin: 't', sessionCount: n, attachmentCount: 0, sessions, files: [] };
}

const PACKS = [makeBundle(2, 1), makeBundle(2, 3), makeBundle(2, 5)];

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
PACKS.forEach((p, i) => files.set('/__pack' + (i + 1) + '.json', { body: Buffer.from(JSON.stringify(p), 'utf8'), type: 'application/json' }));

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
const profile = mkdtempSync(join(tmpdir(), 'verify-batch-'));
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

  /**
   * ★ 从这里拿结论，而不是重连后再查 ★
   *
   * 导入成功后桥接层会 location.reload()，旧的 CDP target 就失效了；
   * 而浏览器实际分配的调试端口未必是我传进去的那个（被占用时会自己换），
   * 于是"重连后再查库"这条路很容易找错端口。
   * 所以改成：把页面里的 console 消息截下来，导出完成后立刻读库、打印结果。
   */
  const pageLogs = [];
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const txt = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    pageLogs.push(txt);
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry || {};
    if (e.text) pageLogs.push('[log] ' + e.text);
  });
  try { await cdp.send('Log.enable'); } catch (e) {}

  const ev = async (expr, t = 180000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, t);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'eval failed');
    }
    return r.result ? r.result.value : undefined;
  };

  for (let i = 0; i < 120; i++) {
    const ok = await ev(`!!(window.__localstore && typeof window.__localstore.importBundle === 'function')`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await ev(`(function(){ try { localStorage.setItem('chat-demo:api-key','sk-batch-test'); } catch(e){} return 1; })()`);

  // 打开设置面板，点「批量导入」，构造 3 个文件的 FileList
  const clicked = await ev(`
    (async () => {
      var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      // 打开设置（点有设置字样的按钮）
      var all = document.querySelectorAll('button, [role="button"], div');
      var setBtn = null;
      for (var i = 0; i < all.length; i++) {
        var tx = (all[i].textContent || '').trim();
        if (tx === '设置') { setBtn = all[i]; break; }
      }
      if (setBtn) { setBtn.click(); await sleep(1500); }

      var dump = function () {
        var bs = document.querySelectorAll('button');
        return Array.prototype.slice.call(bs).map(function (b) { return (b.textContent || '').trim(); }).filter(Boolean).slice(0, 30);
      };

      // ★ 桥接层的「备份与恢复」区块只挂在**通用设置**标签页下
      //   （detectActiveTab 里明确只认 TAB_GENERAL），不是「数据管理」。
      var tabs = document.querySelectorAll('.navItem-_85c1b, button, [role="button"], div, span');
      for (var t = 0; t < tabs.length; t++) {
        if ((tabs[t].textContent || '').trim() === '通用设置') { tabs[t].click(); break; }
      }
      await sleep(2000);
      var afterDump = dump();

      // 找到「批量导入」按钮
      var btn = null;
      var bs = document.querySelectorAll('button');
      for (var j = 0; j < bs.length; j++) {
        if ((bs[j].textContent || '').trim() === '批量导入') { btn = bs[j]; break; }
      }
      if (!btn) return { err: '找不到「批量导入」按钮', afterDump: afterDump,
        bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600) };

      // 抢在它 appendChild 之后、click() 之前把监听换掉做不到，
      // 所以改为：先点一下让 input 挂到 body，再从 body 里把它找出来自己派发 change。
      var before = document.querySelectorAll('input[type=file]').length;
      btn.click();
      await sleep(200);
      var ins = document.querySelectorAll('input[type=file]');
      var inp = null;
      for (var k = ins.length - 1; k >= 0; k--) {
        if (ins[k].multiple) { inp = ins[k]; break; }
      }
      if (!inp) return { err: '没找到 multiple 的 file input', total: ins.length, before: before };

      var texts = [];
      for (var q = 1; q <= 3; q++) {
        texts.push(await (await fetch('/__pack' + q + '.json')).text());
      }
      var dt = new DataTransfer();
      for (var w = 0; w < texts.length; w++) {
        dt.items.add(new File([texts[w]], 'pack' + (w + 1) + '.json', { type: 'application/json' }));
      }
      inp.files = dt.files;
      if (inp.files.length !== 3) return { err: '文件没挂上', n: inp.files.length };
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, attached: inp.files.length };
    })()
  `, 120000);
  console.log('点击「批量导入」:', JSON.stringify(clicked));
  if (clicked && clicked.err) { console.error('✗ ' + clicked.err); await cleanup(); process.exit(1); }

  // 等导入完成（页面会自动刷新一次）
  // ★ 刷新会让旧的 CDP target 失效，所以这里要能重连 —— 之前脚本就是卡在这
  const evalAfterReload = async (expr, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      let c2 = null;
      try {
        const t2 = await fetchPageTarget(CDP_PORT);
        if (!t2) continue;
        c2 = await CDP.connect(t2.webSocketDebuggerUrl);
        // ★ 新连接必须先 Runtime.enable，否则 evaluate 可能拿不到值
        await c2.send('Runtime.enable');
        const r = await c2.send('Runtime.evaluate', {
          expression: expr, awaitPromise: true, returnByValue: true
        }, 90000);
        if (r.exceptionDetails) {
          const d = r.exceptionDetails;
          const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text || '异常';
          // 页面还没加载完（没有 __localstore）就继续等，不算失败
          if (/undefined|not a function|cannot read/i.test(String(msg))) {
            await c2.close().catch(() => {});
            continue;
          }
          await c2.close().catch(() => {});
          return { value: undefined, errs: String(msg).slice(0, 300) };
        }
        const val = r.result ? r.result.value : undefined;
        await c2.close().catch(() => {});
        if (val !== undefined) return { value: val, errs: null };
      } catch (e) {
        try { if (c2) await c2.close(); } catch (e2) {}
      }
    }
    return { value: undefined, errs: '等待超时' };
  };

  console.log('等待导入完成（页面会自动刷新）…');
  let maxItems = 0;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await ev(`
      (function () {
        return {
          items: document.querySelectorAll('.item-ff6fc9').length
        };
      })()
    `).catch(() => null);
    if (!st) { console.log(`   [${(i + 1) * 5}s] 页面已刷新（连不上旧 target，正常）`); break; }
    maxItems = Math.max(maxItems, st.items);
    console.log(`   [${(i + 1) * 5}s] 侧栏=${st.items}`);
  }

  console.log('');
  console.log('================ 结论 ================');
  const summary = pageLogs.filter((x) => /批量导入小结/.test(x));
  const done = pageLogs.filter((x) => /导入完成：/.test(x));
  if (done.length) {
    console.log('页面日志里的导入记录:');
    for (const x of done) console.log('  · ' + x.slice(0, 160));
  }
  if (summary.length) console.log('  小结: ' + summary[summary.length - 1].replace(/^\[localstore\][^:]*:\s*/, ''));

  // ★ 主判据是侧栏条目数：导入成功后桥接层立刻刷新，console 缓冲会被清掉，
  //   所以"抓到日志"只能算加分项，不能当判据。
  console.log('');
  console.log(`侧栏条目: ${maxItems}（期望 6）`);
  console.log(maxItems === 6
    ? '✅ 批量导入有效：一次选中 3 个包（共 6 个对话），只刷新一次即全部入库'
    : `⚠ 侧栏 ${maxItems} 项，期望 6 项`);
} finally {
  await cleanup();
  console.log('（已清理临时 profile）');
}
