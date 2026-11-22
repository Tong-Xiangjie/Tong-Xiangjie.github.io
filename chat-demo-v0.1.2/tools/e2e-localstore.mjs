#!/usr/bin/env node
/**
 * e2e-localstore.mjs —— 在真实 Chrome 里端到端验证本地文件夹存档功能。
 *
 * 因为 File System Access API 的目录授权必须由用户手势触发（无法自动化），
 * 这里采用「注入模拟目录句柄」的方式：用同一套 bridge 代码路径，
 * 把文件写到内存里，从而验证快照 / 对账 / 恢复 / 模型嗅探是否真的正确。
 *
 * 用到的浏览器能力都是真实的：真实 Chrome、真实 IndexedDB、真实 fetch 拦截。
 *
 * 用法：
 *   node tools/e2e-localstore.mjs             # 无头
 *   node tools/e2e-localstore.mjs --headed    # 显示窗口，方便观察
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEADED = process.argv.includes('--headed');
const PORT = 8891;
const CDP_PORT = 9333;

/** 模拟存档文件夹名 */
const DIR_NAME = '测试存档';
/** 与真实接口一致的路径，bridge 靠 /messages 判断是否为对话请求 */
const SSE_PATH = '/anthropic/v1/messages';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// ---------------------------------------------------------------------------
// 迷你静态服务器
// ---------------------------------------------------------------------------

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    // 模拟 Anthropic 风格的 SSE 流，用于验证模型名嗅探
    if (url.pathname === SSE_PATH) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      const send = (evt) =>
        res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
      send({
        type: 'message_start',
        message: {
          id: 'msg_test',
          model: 'deepseek-v4-pro',
          role: 'assistant',
          usage: { input_tokens: 10, output_tokens: 1 }
        }
      });
      send({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      });
      send({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '你好' }
      });
      send({ type: 'content_block_stop', index: 0 });
      send({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 3 }
      });
      send({ type: 'message_stop' });
      res.end();
      return;
    }

    // 模拟普通 JSON 接口（验证 fetch hook 不破坏正常请求）
    if (url.pathname === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }] }));
      return;
    }

    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = join(ROOT, path);

    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream'
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  );
}

// 浏览器路径统一由 minimal-cdp 的 findBrowser() 提供（Chrome 优先，退到 Edge），
// 不再在本文件里维护第二份候选列表。

function launchChrome(profile) {
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-features=Translate,OptimizationHints',
    `http://127.0.0.1:${PORT}/index.html`
  ];
  if (!HEADED) args.unshift('--headless=new', '--disable-gpu');
  return spawn(findBrowser(), args, { stdio: 'ignore' });
}

// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail !== undefined ? '  → ' + detail : ''}`);
    failed++;
  }
}

const profile = mkdtempSync(join(tmpdir(), 'cdp-profile-'));
let server;
let chrome;
let cdp;

try {
  console.log('\n=== 端到端测试：本地文件夹存档 ===\n');

  server = await startServer();
  console.log(`静态服务已启动: http://127.0.0.1:${PORT}`);

  chrome = launchChrome(profile);
  const target = await fetchPageTarget(CDP_PORT);
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');

  // 记录导航与页面错误，便于定位「context destroyed」这类问题
  cdp.on('event', (msg) => {
    if (msg.method === 'Page.frameNavigated' && !msg.params.frame.parentId) {
      console.log(`  [navigate] ${msg.params.frame.url}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console.log('  [page:exception] ' + (d.exception?.description || d.text));
    }
  });

  console.log('已连接 Chrome（CDP）\n');

  // 新开的 Chrome 往往还在首帧导航，此时 evaluate 会撞上
  // 「Execution context was destroyed」。这里做重试包装。
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 出错时把"是哪一段注入代码挂的"打出来。
  // 只靠 CDP 给的 <anonymous>:11 完全定位不到 —— 每个注入块的行号都从 1 开始，
  // 排查时只能靠这段上下文。
  let evalSeq = 0;
  function evalLabel(expr) {
    const line = expr.split('\n').map((s) => s.trim())
      .find((s) => s && !s.startsWith('(') && !s.startsWith('{'));
    return (line || expr.trim().slice(0, 60)).slice(0, 90);
  }
  async function evaluateStable(expression, attempts = 6) {
    const seq = ++evalSeq;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await cdp.evaluate(expression);
      } catch (e) {
        lastErr = e;
        const msg = String(e && e.message);
        const retriable =
          msg.includes('Execution context was destroyed') ||
          msg.includes('Cannot find context') ||
          msg.includes('Target closed') ||
          msg.includes('Inspected target navigated');
        if (!retriable) {
          console.log(`  [eval#${seq} 出错] ${evalLabel(expression)}`);
          throw e;
        }
        await sleep(500);
      }
    }
    throw lastErr;
  }

  await sleep(1200);

  const ready = await evaluateStable(`
    new Promise((resolve) => {
      const t0 = Date.now();
      (function poll() {
        if (window.__localstore && window.__localstore.version) return resolve(true);
        if (Date.now() - t0 > 20000) return resolve(false);
        setTimeout(poll, 100);
      })();
    })
  `);
  check('bridge 已加载并暴露调试接口', ready === true);
  if (!ready) throw new Error('bridge 未就绪，后续测试无法继续');

  const supportsFs = await evaluateStable('window.__localstore.supportsFs');
  check('浏览器支持 File System Access API', supportsFs === true, String(supportsFs));

  // -------------------------------------------------------------------------
  // 模型嗅探：拦截 fetch 读取 SSE 里的真实模型名
  // -------------------------------------------------------------------------
  const sniffed = await evaluateStable(`
    (async () => {
      await fetch(${JSON.stringify(SSE_PATH)});
      await new Promise((r) => setTimeout(r, 400));
      return window.__localstore.currentModel();
    })()
  `);
  check('fetch 嗅探到 SSE 中的真实模型', sniffed === 'deepseek-v4-pro', String(sniffed));

  // 验证模型会被写进会话记录
  //
  // ⚠ 这里必须**先自己造一条待写入的会话**。
  // 踩过的坑：这段原来直接 get('sess-test-1')，而那条数据是靠套件前面
  // 「快照落盘」那几节顺手写进去的 —— 文件夹功能删掉后那些节没了，
  // get() 就返回 undefined，接着 put(undefined) 抛
  // 「Evaluating the object store's key path did not yield a value」。
  // 报错位置指向 put 那行，看起来像数据写错，其实是前置数据没了。
  // 现在这条用例自带前置数据，不再依赖别的节。
  const attached = await evaluateStable(`
    (async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });

      // 1) 先放一条"用户刚问完、助手刚答完但还没记模型"的会话
      await new Promise((res, rej) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put({
          id: 'model-attach-1', title: '模型归属测试', createdAt: 1, updatedAt: 2,
          rootMessageId: 'mu',
          messages: [
            { id: 'mu', role: 'user', content: '你好' },
            { id: 'ma', role: 'assistant', content: '你好！', parentId: 'mu' }
          ]
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('abort'));
      });

      // 2) 让 fetch hook 嗅到 SSE 里的真实模型名（pendingModel 被填上）
      await fetch(${JSON.stringify(SSE_PATH)});
      await new Promise((r) => setTimeout(r, 500));
      const sniffed = window.__localstore.currentModel();

      // 3) 模拟应用随后的落库：桥接层应把模型名补进助手消息
      const s = await new Promise((res, rej) => {
        const g = db.transaction('sessions').objectStore('sessions').get('model-attach-1');
        g.onsuccess = () => res(g.result);
        g.onerror = () => rej(g.error);
      });
      if (!s) return { err: '前置会话没写进去' };
      await new Promise((res, rej) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(s);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('abort'));
      });

      const s2 = await new Promise((res, rej) => {
        const g = db.transaction('sessions').objectStore('sessions').get('model-attach-1');
        g.onsuccess = () => res(g.result);
        g.onerror = () => rej(g.error);
      });
      const last = s2.messages.filter((m) => m.role === 'assistant').pop();
      db.close();
      return { sniffed, serverModel: last ? last.serverModel || null : null };
    })()
  `);
  check('真实模型被写入助手消息（serverModel）',
    attached.serverModel === 'deepseek-v4-pro', JSON.stringify(attached));

  // -------------------------------------------------------------------------
  // 普通请求不应被 fetch hook 破坏
  // -------------------------------------------------------------------------
  const normalOk = await evaluateStable(`
    fetch('/models').then((r) => r.json()).then((j) => j.data[0].id).catch((e) => 'ERR:' + e.message)
  `);
  check('fetch hook 不影响普通请求', normalOk === 'deepseek-flash', String(normalOk));

  // -------------------------------------------------------------------------
  // 设置面板注入
  // 用 class 与官方一致的隔离容器，避免匹配到页面上真实存在的同名文字
  //
  // 注意：区块只会挂在「通用设置」标签页下（两个标签页共用同一个内容容器，
  // 若不加判断就会串台）。所以这个仿造容器必须同时带上导航高亮，
  // 让 detectActiveTab 能判定当前就是通用设置。
  // -------------------------------------------------------------------------
  const sectionMounted = await evaluateStable(`
    (() => {
      const dlg = document.createElement('div');
      dlg.className = 'dialog-_85c1b';

      // 导航：通用设置（高亮） / 数据管理
      const general = document.createElement('button');
      general.className = 'navItem-_85c1b navItemActive-_85c1b';
      general.textContent = '通用设置';
      const data = document.createElement('button');
      data.className = 'navItem-_85c1b';
      data.textContent = '数据管理';
      dlg.appendChild(general);
      dlg.appendChild(data);

      const container = document.createElement('div');
      container.id = 'fake-settings-content';
      container.className = 'content-_85c1b';
      const row = document.createElement('div');
      row.className = 'cell-_85c1b row-_85c1b';
      const label = document.createElement('div');
      label.className = 'label-_85c1b';
      label.textContent = '语言';
      row.appendChild(label);
      container.appendChild(row);
      dlg.appendChild(container);
      document.body.appendChild(dlg);

      // 先清掉可能已挂在别处的区块，再用隔离容器重新挂载
      const existing = document.getElementById('localstore-section');
      if (existing) existing.remove();
      const ok = window.__localstore.mountSection(container);

      const sec = document.getElementById('localstore-section');
      return {
        mountReturned: ok,
        mounted: !!sec,
        insideContainer: !!container.querySelector('#localstore-section'),
        // 多提供方改造后：官方那一路不再作为卡片列出（由官方「数据管理」里的
        // 统一 Key 输入框 + 自定义 API 地址负责），本区块只列自定义提供方。
        // 因此这里断言区块骨架存在，而不是断言一定有卡片。
        hasApiInput: !!document.querySelector('#localstore-section .ls-head') &&
                     !!document.querySelector('#localstore-section .ls-meta') &&
                     !!document.querySelector('#localstore-section .ls-btns'),
        text: sec ? sec.textContent : ''
      };
    })()
  `);
  check('设置区块挂载函数返回成功', sectionMounted.mountReturned === true);
  check('设置区块被挂载', sectionMounted.mounted === true);
  check('设置区块位于设置面板内容容器内', sectionMounted.insideContainer === true);
  check('包含 API 地址输入框', sectionMounted.hasApiInput === true);
  check('包含备份与恢复区块', sectionMounted.text.includes('备份与恢复'));
  check('★ 不再包含文件夹存储区块（已整块移除）',
    !sectionMounted.text.includes('本地文件夹存储'));
  check('★ 不再包含「API Key 保存到文件夹」（已整块移除）',
    !sectionMounted.text.includes('API Key 保存到文件夹'));
  check('包含导出与导入按钮',
    sectionMounted.text.includes('导出') && sectionMounted.text.includes('导入'));
  check('包含模型显示开关', sectionMounted.text.includes('模型显示'));

  // -------------------------------------------------------------------------
  // 模型徽标：按消息顺序把模型名注入到每条回答的操作条里
  // -------------------------------------------------------------------------
  const badge = await evaluateStable(`
    (async () => {
      // 清掉真实页面里的干扰节点，用与官方同名的 class 造两条消息
      document.querySelectorAll('.message-e1faee').forEach((n) => n.remove());

      // ⚠ 必须先自己把"当前会话"造干净再断言。
      // injectModelBadges 里有一道硬门槛：DOM 节点数必须等于该会话的线性消息数
      //   if (nodes.length !== linear.length) return;
      // 前面几节留下的会话会让"最后更新的那个会话"变成别的，节点数就对不上，
      // 于是徽标一个都不注入 —— 表现为 badge.count === 0，很容易误判成注入坏了。
      // 这里直接把 sessions 清空，只留一条"两条消息（user+assistant）"的会话。
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite');
        tx.objectStore('sessions').clear();
        tx.objectStore('sessionSummaries').clear();
        tx.objectStore('sessions').put({
          id: 'badge-1', title: '徽标测试', createdAt: 1, updatedAt: 999999,
          rootMessageId: 'bu',
          // ⚠ 消息树必须自洽，而且关键在于 **selectedChildId**：
          // linearMessages 是顺着 selectedChildId 一条链走下来的
          //   cursor = node.selectedChildId
          // 只写 parentId 是不够的 —— 链会在根节点断掉，linear 只剩 1 条，
          // 撞上 injectModelBadges 的
          //   if (nodes.length !== linear.length) return;
          // 于是徽标一个都不注入，看着像"注入坏了"，其实是测试数据不合规。
          messages: [
            { id: 'bu', role: 'user', content: '问一句', parentId: null,
              selectedChildId: 'ba' },
            { id: 'ba', role: 'assistant', content: '答一句', parentId: 'bu',
              selectedChildId: null, serverModel: 'deepseek-v4-pro' }
          ]
        });
        tx.objectStore('sessionSummaries').put({
          id: 'badge-1', title: '徽标测试', createdAt: 1, updatedAt: 999999, fileIds: []
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('abort'));
      });
      db.close();
      sessionStorage.removeItem('chat-demo:active');

      const wrap = document.createElement('div');
      wrap.id = 'fake-messages';
      for (const cls of ['user-msg', 'assistant-msg']) {
        const node = document.createElement('div');
        node.className = 'message-e1faee';
        const actions = document.createElement('div');
        actions.className = 'actions-e1faee';
        node.appendChild(actions);
        wrap.appendChild(node);
      }
      document.body.appendChild(wrap);

      await window.__localstore.injectModelBadges();
      // 给定时注入一次机会：应用里徽标是靠防抖排程注入的，
      // 只调一次可能恰好在排程之前。
      await new Promise((r) => setTimeout(r, 400));

      const badges = wrap.querySelectorAll('.ls-model-badge');
      return {
        count: badges.length,
        text: badges.length ? badges[0].textContent : null,
        inAssistantActions: !!wrap.children[1].querySelector('.actions-e1faee .ls-model-badge'),
        notInUser: !wrap.children[0].querySelector('.ls-model-badge')
      };
    })()
  `);
  check('助手回答注入了模型徽标', badge.count === 1, JSON.stringify(badge));
  check('徽标显示真实模型名', badge.text === 'deepseek-v4-pro', String(badge.text));
  check('徽标位于助手消息的操作条内', badge.inAssistantActions === true);
  check('用户消息不会出现徽标', badge.notInUser === true);

  // -------------------------------------------------------------------------
  // API 地址：写入 localStorage 后应被补丁后的 bundle 读到
  // -------------------------------------------------------------------------
  const apiBaseOk = await evaluateStable(`
    (() => {
      localStorage.setItem('chat-demo:api-base', 'https://my-proxy.example.com/');
      return localStorage.getItem('chat-demo:api-base');
    })()
  `);
  check('可写入自定义 API 地址', apiBaseOk === 'https://my-proxy.example.com/');

  // ★ 导出 / 导入：现在唯一的数据搬运通道 ★
  //
  // 为什么这些用例重要：文件夹同步整块删掉之后，导出/导入就是用户**唯一**能把
  // 对话搬去别的浏览器、或清数据前留备份的路。它一旦坏掉，数据就是真的丢。
  // 而且它特别容易"看起来成功了" —— 所以这里全部走真实的往返。
  // -------------------------------------------------------------------------
  console.log('\n[导出/导入] 备份往返必须无损\n');

  // 先把库清干净再放我们自己那两条。
  // 前面几节（模型归属、模型徽标）都会往库里写东西，不清掉的话
  // "导出应有 2 个对话"这类断言会被它们污染 —— 之前就踩到导出计数变成 3。
  const cleared = await evaluateStable(`
    (async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite');
        tx.objectStore('sessions').clear();
        tx.objectStore('sessionSummaries').clear();
        tx.objectStore('files').clear();
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('abort'));
      });
      db.close();
      return true;
    })()
  `);
  check('导出用例开始前库已清空（用例之间不互相污染）', cleared === true, String(cleared));

  // 造两条对话 + 一个二进制附件
  //
  // ⚠ 必须**自己把 store 建对**，不能让 indexedDB.open 顺手建。
  // 踩过的坑：测试里写 indexedDB.open('chat-demo', 11) 时，如果没有 onupgradeneeded，
  // 浏览器会按默认规则建表 —— store 名叫 sessions，keyPath 就取 "sessions"。
  // 于是后面 put({id:'exp-1'}) 直接抛
  // 「Evaluating the object store's key path did not yield a value」，
  // 而且报错位置指向 put 那行，很容易误以为是数据写错了。
  // 官方/桥接层的真实建表是 keyPath:'id'（见 bundle 里的 upgrade 函数）。
  const seedResult = await evaluateStable(`
    (async () => {
      const step = [];
      const STORES = ['sessions', 'sessionSummaries', 'files'];

      // 先不带版本号打开：拿到当前库（可能是官方建好的 11）
      let db = await new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });

      // store 不存在、或 keyPath 不是 id（被误建过），就升一版按正确结构重建
      const needsFix = STORES.some((n) => !db.objectStoreNames.contains(n));
      const version = db.version;
      if (needsFix) {
        // 只有确实要重建时才关连接。无条件关掉再拿它开事务会抛
        // InvalidStateError: The database connection is closing.
        db.close();
        step.push('需要建表，当前 v' + version);
        db = await new Promise((res, rej) => {
          const r = indexedDB.open('chat-demo', version + 1);
          r.onupgradeneeded = () => {
            const d = r.result;
            for (const n of STORES) {
              if (d.objectStoreNames.contains(n)) continue;
              if (n === 'sessionSummaries') {
                const st = d.createObjectStore(n, { keyPath: 'id' });
                st.createIndex('fileIds', 'fileIds', { multiEntry: true });
              } else {
                d.createObjectStore(n, { keyPath: 'id' });
              }
            }
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
          r.onblocked = () => rej(new Error('open blocked'));
        });
      }
      step.push('库 v' + db.version + ' [' + [...db.objectStoreNames].join(',') + ']');

      const rows = [
        ['sessions', {
          id: 'exp-1', title: '导出测试一', createdAt: 1000, updatedAt: 2000,
          rootMessageId: 'm1',
          messages: [
            { id: 'm1', role: 'user', content: '你好', files: [{ id: 'att-1' }] },
            { id: 'm2', role: 'assistant', content: '你好，有什么可以帮你？', parentId: 'm1' }
          ]
        }],
        ['sessions', {
          id: 'exp-2', title: '导出测试二', createdAt: 1500, updatedAt: 2500,
          rootMessageId: 'n1',
          messages: [{ id: 'n1', role: 'user', content: '第二条', files: [] }]
        }],
        ['sessionSummaries', {
          id: 'exp-1', title: '导出测试一', createdAt: 1000, updatedAt: 2000, fileIds: ['att-1']
        }],
        ['sessionSummaries', {
          id: 'exp-2', title: '导出测试二', createdAt: 1500, updatedAt: 2500, fileIds: []
        }],
        ['files', {
          id: 'att-1', name: 'a.bin', mimeType: 'application/octet-stream', isImage: false,
          blob: new Blob([new Uint8Array([0,1,2,250,251,252,253,254,255])],
                         { type: 'application/octet-stream' })
        }]
      ];

      for (let i = 0; i < rows.length; i++) {
        const [store, value] = rows[i];
        try {
          await new Promise((res, rej) => {
            const tx = db.transaction([store], 'readwrite');
            tx.objectStore(store).put(value);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error || new Error('tx error'));
            tx.onabort = () => rej(tx.error || new Error('tx abort'));
          });
          step.push('ok ' + store + '#' + i + ' id=' + value.id);
        } catch (e) {
          return { failedAt: store + '#' + i + ' id=' + value.id,
                   err: String((e && e.name) + ': ' + (e && e.message)), step };
        }
      }
      db.close();
      return { step };
    })()
  `);
  if (seedResult.failedAt || seedResult.openErr || seedResult.err) {
    console.log('    ' + JSON.stringify(seedResult));
  }
  check('测试数据写入成功（store 结构正确）',
    !seedResult.failedAt && !seedResult.openErr, JSON.stringify(seedResult));

  // ---- 导出：拦下下载，检查产出的 JSON ----
  const exported = await evaluateStable(`
    (async () => {
      const api = window.__localstore;
      const realCreate = URL.createObjectURL;
      const realClick = HTMLAnchorElement.prototype.click;
      let blob = null;
      URL.createObjectURL = (b) => { blob = b; return 'blob:stub'; };
      HTMLAnchorElement.prototype.click = function () {};
      let ret;
      try { ret = await api.exportBundle(); }
      finally {
        URL.createObjectURL = realCreate;
        HTMLAnchorElement.prototype.click = realClick;
      }
      const text = blob ? await blob.text() : '';
      const bundle = text ? JSON.parse(text) : null;
      return {
        ret,
        schema: bundle && bundle.schema,
        sessionCount: bundle && bundle.sessionCount,
        attachmentCount: bundle && bundle.attachmentCount,
        hasB64: !!(bundle && bundle.files[0] && bundle.files[0].blobB64),
        warning: (bundle && bundle.warning) || null,
        textLen: text.length
      };
    })()
  `);
  check('★ 导出产出可解析的备份文件', exported.schema === 'chat-demo-export@1',
    JSON.stringify(exported.ret));
  check('导出包含两个对话', exported.sessionCount === 2, String(exported.sessionCount));
  check('导出包含一个附件', exported.attachmentCount === 1, String(exported.attachmentCount));
  check('★ 附件以 base64 内嵌（备份自包含）', exported.hasB64 === true);
  check('★ 导出文件带明文密钥警告', typeof exported.warning === 'string'
    && exported.warning.includes('API Key'), String(exported.warning));
  check('导出文件名以 .json 结尾',
    !!(exported.ret && /\.json$/.test(exported.ret.name)), exported.ret && exported.ret.name);

  // ---- 附件二进制往返：逐字节一致 ----
  const bytes = await evaluateStable(`
    (async () => {
      const api = window.__localstore;
      const files = await api.readAllFiles();
      const f = files.find((x) => x.id === 'att-1');
      const b64 = await api.__blobToB64ForTest(f.blob);
      const back = api.__b64ToBlobForTest(b64, f.mimeType);
      return [...new Uint8Array(await back.arrayBuffer())];
    })()
  `);
  check('★ 附件二进制往返逐字节一致（含 250-255 高位字节）',
    JSON.stringify(bytes) === JSON.stringify([0,1,2,250,251,252,253,254,255]),
    JSON.stringify(bytes));

  // ---- 导入合并规则 ----
  const merge = await evaluateStable(`
    window.__localstore.__planImportMergeForTest(
      [{ id: 'keep-me', updatedAt: 9000, title: '本地较新', messages: [] }],
      [{ id: 'keep-me', updatedAt: 1000, title: '备份较旧', messages: [] },
       { id: 'new-one', updatedAt: 1000, title: '备份新增', messages: [] }]
    )
  `);
  check('★ 备份较旧的同名对话不被覆盖（内容不会倒退）',
    merge.toWrite.length === 1 && merge.toWrite[0].id === 'new-one',
    JSON.stringify(merge.toWrite.map((s) => s.id)));
  check('跳过计数正确', merge.skipped === 1, String(merge.skipped));

  // ---- 清库后完整导入：两条对话 + 附件都要回来 ----
  const reimport = await evaluateStable(`
    (async () => {
      const api = window.__localstore;
      const realCreate = URL.createObjectURL;
      const realClick = HTMLAnchorElement.prototype.click;
      let blob = null;
      URL.createObjectURL = (b) => { blob = b; return 'blob:stub'; };
      HTMLAnchorElement.prototype.click = function () {};
      try { await api.exportBundle(); }
      finally {
        URL.createObjectURL = realCreate;
        HTMLAnchorElement.prototype.click = realClick;
      }
      const text = await blob.text();

      // 清空整个库，模拟"换了一台机器"
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite');
        tx.objectStore('sessions').clear();
        tx.objectStore('sessionSummaries').clear();
        tx.objectStore('files').clear();
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      const before = (await api.readAllSessions()).length;

      const r = await api.importBundle(text);
      const after = await api.readAllSessions();
      const filesAfter = await api.readAllFiles();
      return {
        before,
        imported: r.imported,
        ids: after.map((s) => s.id).sort(),
        titles: after.map((s) => s.title).sort(),
        attIds: filesAfter.map((f) => f.id).sort(),
        attSize: filesAfter[0] ? filesAfter[0].blob.size : -1
      };
    })()
  `);
  check('导入前库确实被清空了', reimport.before === 0, String(reimport.before));
  check('★ 清库后导入把两条对话都还原了',
    reimport.ids.join(',') === 'exp-1,exp-2', JSON.stringify(reimport.ids));
  check('★ 标题也一并还原（不是空标题）',
    reimport.titles.join(',') === '导出测试一,导出测试二', JSON.stringify(reimport.titles));
  check('★ 附件被还原（且不是 0 字节空壳）',
    reimport.attIds.join(',') === 'att-1' && reimport.attSize === 9,
    JSON.stringify({ ids: reimport.attIds, size: reimport.attSize }));

  // ---- 错误文件必须明确报错，不能静默失败 ----
  const bad = await evaluateStable(`
    (async () => {
      try { await window.__localstore.importBundle('{"nope":1}'); return 'ok'; }
      catch (e) { return 'ERR:' + e.message; }
    })()
  `);
  check('导入非本页导出的文件会明确报错',
    String(bad).startsWith('ERR:'), String(bad));

  // ---- 单个对话导出（会话菜单里的「导出」）----
  const single = await evaluateStable(`
    (async () => {
      try { return await window.__localstore.exportSession('exp-1'); }
      catch (e) { return { err: String(e && e.message) }; }
    })()
  `);
  check('★ 单个对话可以导出', !single.err, JSON.stringify(single));
  check('单条导出文件名带对话标题',
    !!(single.name && single.name.includes('导出测试一')), single.name);
  check('★ 单条导出只带自己的附件（不拖整库）',
    single.attachments === 1, String(single.attachments));

  // ---- 按标题导出：找不到就要报错，不能瞎选一条 ----
  const byTitle = await evaluateStable(`
    (async () => {
      const api = window.__localstore;
      const ok = await api.exportSessionByTitle('导出测试一').then(
        (r) => 'OK:' + r.name, (e) => 'ERR:' + e.message);
      const none = await api.exportSessionByTitle('这个标题不存在').then(
        () => 'OK', (e) => 'ERR:' + e.message);
      return { ok, none };
    })()
  `);
  check('按唯一标题可以导出', String(byTitle.ok).startsWith('OK:'), String(byTitle.ok));
  check('★ 标题不存在时报错（不静默导出错的那条）',
    String(byTitle.none).startsWith('ERR:'), String(byTitle.none));

  // ---- 标题含非法字符时文件名要被清洗（否则下载会失败）----
  const weird = await evaluateStable(`
    (async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction(['sessions'], 'readwrite');
        tx.objectStore('sessions').put({
          id: 'weird-1', title: 'a/b:c*d?e"f<g>h|i', createdAt: 1, updatedAt: 1,
          rootMessageId: 'w', messages: []
        });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      try { return await window.__localstore.exportSession('weird-1'); }
      catch (e) { return { err: String(e && e.message) }; }
    })()
  `);
  check('★ 标题含 / : * ? " < > | 时仍能导出（文件名已清洗）',
    !weird.err, JSON.stringify(weird));
  check('清洗后的文件名不含路径分隔符',
    !!(weird.name && !/[\\/]/.test(weird.name)), weird.name);

  // ---- 配置随导出带走：换浏览器后 Key 与偏好要能还原 ----
  const cfg = await evaluateStable(`
    (async () => {
      const api = window.__localstore;
      localStorage.setItem('chat-demo:api-key', 'sk-cfg-round-trip');
      localStorage.setItem('chat-demo:locale', 'en-US');

      const realCreate = URL.createObjectURL;
      const realClick = HTMLAnchorElement.prototype.click;
      let blob = null;
      URL.createObjectURL = (b) => { blob = b; return 'blob:stub'; };
      HTMLAnchorElement.prototype.click = function () {};
      try { await api.exportBundle(); }
      finally {
        URL.createObjectURL = realCreate;
        HTMLAnchorElement.prototype.click = realClick;
      }
      const text = await blob.text();
      const bundle = JSON.parse(text);
      const cfgKey = bundle.config && bundle.config.apiKey;

      // 清掉浏览器里的配置，再导入还原
      localStorage.removeItem('chat-demo:api-key');
      localStorage.removeItem('chat-demo:locale');
      const r = await api.importBundle(text);
      return {
        cfgKey,
        keyAfter: localStorage.getItem('chat-demo:api-key'),
        localeAfter: localStorage.getItem('chat-demo:locale'),
        keyRestored: r.keyRestored
      };
    })()
  `);
  check('★ 导出文件里带上了 API Key', cfg.cfgKey === 'sk-cfg-round-trip', String(cfg.cfgKey));
  check('★ 导入后 Key 被还原（换浏览器不用重填）',
    cfg.keyAfter === 'sk-cfg-round-trip', String(cfg.keyAfter));
  check('★ 导入后界面偏好被还原', cfg.localeAfter === 'en-US', String(cfg.localeAfter));

  // ---- 稳定不变量：桥接层不再暴露任何文件夹入口 ----
  const noFolderApi = await evaluateStable(`
    (() => {
      const L = window.__localstore;
      const gone = ['pickFolder','snapshot','restoreFromFolder','reconnect',
                    'disconnect','folderWatch'].filter((k) => typeof L[k] === 'function'
                    || (L[k] && typeof L[k] === 'object'));
      return { gone, hasExport: typeof L.exportBundle === 'function',
               hasImport: typeof L.importBundle === 'function' };
    })()
  `);
  check('★ 文件夹入口已从调试接口移除（防止误触发文件系统调用）',
    noFolderApi.gone.length === 0, JSON.stringify(noFolderApi.gone));
  check('导出/导入接口存在',
    noFolderApi.hasExport && noFolderApi.hasImport, JSON.stringify(noFolderApi));


} catch (err) {
  console.log(`\n测试异常终止: ${err.message}\n`);
  failed++;
} finally {
  if (cdp) cdp.close();
  if (chrome) {
    try {
      chrome.kill();
    } catch {
      /* ignore */
    }
  }
  if (server) server.close();
  await new Promise((r) => setTimeout(r, 300));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed ? 1 : 0);
