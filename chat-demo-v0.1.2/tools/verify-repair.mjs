#!/usr/bin/env node
/**
 * 验证「修复数据」按钮：先导入一份**故意做坏的**数据（用户消息没有 files、
 * 助手消息没有 latestReminder），确认点开会黑屏；再点「修复数据」，
 * 确认点开恢复正常。
 *
 * 这样能证明修复函数真的解决了那个 TypeError，而不是碰巧。
 *
 * 用法: node tools/verify-repair.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PORT = 9100 + Math.floor(Math.random() * 30);
const CDP_PORT = 9900 + Math.floor(Math.random() * 50);

// 故意做坏的包：用户消息没有 files，助手消息没有 latestReminder
const BAD = {
  schema: 'chat-demo-export@1',
  note: '故意做坏，用来验证修复功能',
  exportedAt: Date.now(),
  appVersion: 'test',
  bridgeVersion: 'test',
  origin: 'test',
  sessionCount: 2,
  attachmentCount: 0,
  sessions: [
    {
      id: 'bad-1', title: '坏数据一号',
      createdAt: 1784000000000, updatedAt: 1784000100000,
      rootMessageId: 'b1a',
      messages: [
        { id: 'b1a', role: 'user', parentId: null, selectedChildId: 'b1b', content: '这条用户消息故意没有 files 字段', createdAt: 1784000000000 },
        { id: 'b1b', role: 'assistant', parentId: 'b1a', selectedChildId: null, createdAt: 1784000100000,
          blocks: [{ type: 'text', text: '助手回复（故意没有 latestReminder）' }],
          model: null, thinking: false, search: false, prefix: false, status: 'done' }
      ]
    },
    {
      id: 'bad-2', title: '坏数据二号',
      createdAt: 1784000200000, updatedAt: 1784000300000,
      rootMessageId: 'b2a',
      messages: [
        { id: 'b2a', role: 'user', parentId: null, selectedChildId: 'b2b', content: '第二条也没有 files', createdAt: 1784000200000 },
        { id: 'b2b', role: 'assistant', parentId: 'b2a', selectedChildId: null, createdAt: 1784000300000,
          blocks: [{ type: 'text', text: '第二条助手回复' }],
          model: null, thinking: false, search: false, prefix: false, status: 'done' }
      ]
    }
  ],
  files: []
};

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
files.set('/__bad.json', { body: Buffer.from(JSON.stringify(BAD), 'utf8'), type: 'application/json' });

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
const profile = mkdtempSync(join(tmpdir(), 'verify-repair-'));
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

  const ev = async (expr, t = 120000) => {
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
  await ev(`(function(){ try { localStorage.setItem('chat-demo:api-key','sk-repair-test'); } catch(e){} return 1; })()`);

  const imp = await ev(`(async () => {
    var r = await fetch('/__bad.json'); var t = await r.text();
    return await window.__localstore.importBundle(t);
  })()`);
  console.log('导入坏数据:', JSON.stringify(imp));

  await ev('location.reload()').catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  for (let i = 0; i < 120; i++) {
    const n = await ev(`document.querySelectorAll('.item-ff6fc9').length`).catch(() => 0);
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const openFirst = `
    (async () => {
      var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var items = document.querySelectorAll('.item-ff6fc9');
      if (!items.length) return { err: '侧栏空' };
      items[0].click();
      await sleep(3000);
      var root = document.getElementById('root');
      return {
        rootChildren: root ? root.children.length : -1,
        asst: document.querySelectorAll('.message-e1faee').length,
        user: document.querySelectorAll('.bubble-_4cfe7').length,
        bodyLen: (document.body ? document.body.innerText || '' : '').length
      };
    })()
  `;

  const bad = await ev(openFirst);
  console.log('');
  console.log('【修复前】点开第一个对话:', JSON.stringify(bad));
  console.log('   判定: ' + (bad.rootChildren === 0 ? '✅ 复现了黑屏（root 被清空）' : '⚠ 没复现黑屏'));

  // 刷新回到干净状态，跑修复
  await ev('location.reload()').catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  for (let i = 0; i < 120; i++) {
    const n = await ev(`document.querySelectorAll('.item-ff6fc9').length`).catch(() => 0);
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const rep = await ev(`window.__localstore.repairSessions()`, 300000);
  console.log('');
  console.log('修复结果:', JSON.stringify(rep));

  await ev('location.reload()').catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  for (let i = 0; i < 120; i++) {
    const n = await ev(`document.querySelectorAll('.item-ff6fc9').length`).catch(() => 0);
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const good = await ev(openFirst);
  console.log('');
  console.log('【修复后】点开第一个对话:', JSON.stringify(good));
  console.log('');
  console.log('================ 结论 ================');
  const ok = bad.rootChildren === 0 && good.rootChildren > 0 && good.asst > 0;
  console.log(ok
    ? '✅ 修复有效：坏数据必崩 → 修复后正常渲染'
    : ('⚠ 结论不成立：修复前 ' + JSON.stringify(bad) + '，修复后 ' + JSON.stringify(good)));
} finally {
  await cleanup();
  console.log('（已清理临时 profile）');
}
