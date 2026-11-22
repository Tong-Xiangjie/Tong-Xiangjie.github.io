#!/usr/bin/env node
/**
 * 对照实验：在**全新空库**里，让应用自己新建一个对话（走它自己的写入路径），
 * 然后点侧栏切换，看会不会同样"点开就黑屏"。
 *
 * 目的：把"应用自身的既有问题"和"我的导入数据的问题"分开。
 *
 * 用法: node tools/test-native-newchat.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PORT = 9040 + Math.floor(Math.random() * 40);
const CDP_PORT = 9800 + Math.floor(Math.random() * 60);

const files = new Map();
const rec = (dir, prefix = '') => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? prefix + '/' + name : name;
    if (statSync(abs).isDirectory()) rec(abs, rel);
    else {
      files.set('/' + rel.split('\\').join('/'), {
        body: readFileSync(abs),
        type: MIME[rel.slice(rel.lastIndexOf('.'))] || 'application/octet-stream'
      });
    }
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
const profile = mkdtempSync(join(tmpdir(), 'native-newchat-'));
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

  const errors = [];
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    errors.push(String((d.exception && (d.exception.description || d.exception.value)) || d.text || '').slice(0, 500));
  });

  const ev = async (expr, t = 60000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, t);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'eval failed');
    }
    return r.result ? r.result.value : undefined;
  };

  for (let i = 0; i < 120; i++) {
    const ok = await ev(`!!window.__localstore`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await ev(`(function(){ try { localStorage.setItem('chat-demo:api-key','sk-native-test'); } catch(e){} return 1; })()`);

  const dump = () => ev(`
    (function () {
      var body = document.body ? (document.body.innerText || document.body.textContent || '') : '';
      var root = document.getElementById('root');
      return {
        rootChildren: root ? root.children.length : -1,
        items: document.querySelectorAll('.item-ff6fc9').length,
        main: document.querySelectorAll('.main-_9fdf5').length,
        asst: document.querySelectorAll('.message-e1faee').length,
        user: document.querySelectorAll('.bubble-_4cfe7').length,
        welcome: document.querySelectorAll('.container-_1f155').length,
        bodyLen: body.length,
        head: body.replace(/\\s+/g, ' ').slice(0, 140)
      };
    })()
  `);

  console.log('初始状态:', JSON.stringify(await dump()));

  // -------------------------------------------------------------------------
  // 最小会话：完全照转换器的结构手写，看打开时会不会崩
  // -------------------------------------------------------------------------
  const mini = {
    schema: 'chat-demo-export@1',
    note: '诊断用的最小会话',
    exportedAt: Date.now(),
    appVersion: 'diag',
    bridgeVersion: 'diag',
    origin: 'diag',
    sessionCount: 1,
    attachmentCount: 0,
    sessions: [{
      id: 'diag-mini-1',
      title: '诊断最小会话',
      createdAt: Date.now() - 120000,
      updatedAt: Date.now() - 60000,
      rootMessageId: 'm1',
      messages: [
        {
          id: 'm1', role: 'user', parentId: null, selectedChildId: 'm2',
          content: '诊断：这是一条用户消息', createdAt: Date.now() - 120000,
          files: []
        },
        {
          id: 'm2', role: 'assistant', parentId: 'm1', selectedChildId: null,
          createdAt: Date.now() - 60000,
          blocks: [
            { type: 'thinking', thinking: '诊断：这是思维链', signature: null },
            { type: 'text', text: '诊断：这是助手的回复正文。' }
          ],
          model: null, thinking: true, search: false, prefix: false, status: 'done',
          thinkingEnabled: true
        }
      ]
    }],
    files: []
  };

  const imported = await ev(`
    (async () => {
      var txt = ${JSON.stringify(JSON.stringify(mini))};
      var r = await window.__localstore.importBundle(txt);
      return r;
    })()
  `, 120000);
  console.log('最小会话导入:', JSON.stringify(imported));

  await ev('location.reload()').catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));
  for (let i = 0; i < 120; i++) {
    const n = await ev(`document.querySelectorAll('.item-ff6fc9').length`).catch(() => 0);
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1500));
  console.log('刷新后:', JSON.stringify(await dump()));

  const clickMini = await ev(`
    (function () {
      var items = document.querySelectorAll('.item-ff6fc9');
      if (!items.length) return { err: '侧栏空' };
      items[0].click();
      return { ok: true, title: (items[0].innerText || '').trim().slice(0, 40) };
    })()
  `);
  console.log('点最小会话:', JSON.stringify(clickMini));
  await new Promise((r) => setTimeout(r, 3500));
  const afterMini = await dump();
  console.log('最小会话点击后:', JSON.stringify(afterMini));
  console.log('');
  console.log('★ 判定: ' + (afterMini.rootChildren > 0 && afterMini.asst > 0
    ? '最小会话能正常打开 → 问题在真实数据的某个字段'
    : '连最小会话都崩 → 问题在基本结构（rootMessageId / id / selectedChildId）'));
  console.log('');
  console.log('页面异常:', errors.length);
  for (const e of errors.slice(0, 5)) console.log('  · ' + e.replace(/\s+/g, ' ').slice(0, 400));
} finally {
  await cleanup();
  console.log('（已清理临时 profile）');
}
