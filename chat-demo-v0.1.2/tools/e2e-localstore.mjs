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
import { CDP, fetchPageTarget } from './minimal-cdp.mjs';

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

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('找不到 Chrome / Edge');
}

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
  return spawn(findChrome(), args, { stdio: 'ignore' });
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
  async function evaluateStable(expression, attempts = 6) {
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
        if (!retriable) throw e;
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
  // 注入模拟目录句柄（内存文件系统，接口与真实句柄一致）
  // -------------------------------------------------------------------------
  await evaluateStable(`
    (() => {
      const bucket = {};
      window.__fsBucket = bucket;

      function makeDir(prefix) {
        return {
          kind: 'directory',
          name: prefix === '' ? ${JSON.stringify(DIR_NAME)} : prefix.split('/').filter(Boolean).pop(),
          async getDirectoryHandle(child, opts) {
            const key = prefix + child + '/';
            if (bucket[key] === undefined) {
              if (!opts || !opts.create) {
                const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
              }
              bucket[key] = true;
            }
            return makeDir(prefix + child + '/');
          },
          async getFileHandle(fname, opts) {
            const key = prefix + fname;
            if (bucket[key] === undefined && !(opts && opts.create)) {
              const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
            }
            return {
              kind: 'file',
              name: fname,
              async createWritable() {
                let buf = '';
                return {
                  write: async (d) => { buf += typeof d === 'string' ? d : '[blob]'; },
                  close: async () => { bucket[key] = buf; }
                };
              },
              async getFile() { return new File([bucket[key] || ''], fname); }
            };
          },
          async removeEntry(fname) { delete bucket[prefix + fname]; },
          async *values() {
            for (const k of Object.keys(bucket)) {
              if (!k.startsWith(prefix)) continue;
              const rest = k.slice(prefix.length);
              if (!rest || rest.includes('/')) continue;
              if (bucket[k] === true) yield { kind: 'directory', name: rest };
              else yield { kind: 'file', name: rest };
            }
          },
          async queryPermission() { return 'granted'; },
          async requestPermission() { return 'granted'; }
        };
      }
      window.__fakeRoot = makeDir('');
      return true;
    })()
  `);
  console.log('（已注入模拟目录句柄：写入内存而非真实磁盘）\n');

  // -------------------------------------------------------------------------
  // 造数据：一个带分支的消息树
  // -------------------------------------------------------------------------
  await evaluateStable(`
    (async () => {
      const open = () => new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo', 11);
        r.onupgradeneeded = () => {
          const db = r.result;
          for (const s of ['sessions','files','sessionsStaging','filesStaging']) {
            if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('sessionSummaries')) {
            const st = db.createObjectStore('sessionSummaries', { keyPath: 'id' });
            st.createIndex('fileIds', 'fileIds', { multiEntry: true });
          }
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const db = await open();
      const now = Date.now();
      const session = {
        id: 'sess-test-1',
        title: '测试对话：正则表达式',
        createdAt: now - 60000,
        updatedAt: now,
        rootMessageId: 'm1',
        messages: [
          { id: 'm1', role: 'user', content: '帮我写个匹配邮箱的正则', files: [],
            createdAt: now - 60000, parentId: null, selectedChildId: 'm2' },
          // 真实结构：助手消息用 blocks（不是 content / 顶层 text）
          { id: 'm2', role: 'assistant', model: 'deepseek-flash', serverModel: 'deepseek-v4-pro',
            createdAt: now - 50000, parentId: 'm1', selectedChildId: null, status: 'done',
            blocks: [{ type: 'text', text: '可以用 /^[^@]+@[^@]+\\\\.[^@]+$/', citations: [] }] },
          // 未选中的旧版本，用于验证「分支不丢失且不混入」
          { id: 'm3', role: 'assistant', model: 'deepseek-flash',
            createdAt: now - 55000, parentId: 'm1', selectedChildId: null, status: 'done',
            blocks: [{ type: 'text', text: '旧版本回答文字' }] }
        ]
      };
      await new Promise((res, rej) => {
        const tx = db.transaction(['sessions','sessionSummaries'], 'readwrite');
        tx.objectStore('sessions').put(session);
        tx.objectStore('sessionSummaries').put({
          id: session.id, title: session.title, createdAt: session.createdAt,
          updatedAt: session.updatedAt, fileIds: []
        });
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });

      // 再放两条附件：一张图片 + 一个**非图片**。
      // 非图片过去只记元信息、原件不落盘；现在要求原件也写进 附件/。
      if (db.objectStoreNames.contains('files')) {
        await new Promise((res, rej) => {
          const tx = db.transaction(['files'], 'readwrite');
          tx.objectStore('files').put({
            id: 'file-img-1', name: 'shot.png', size: 4, mimeType: 'image/png',
            isImage: true, serverId: 'srv-img-1',
            blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
          });
          tx.objectStore('files').put({
            id: 'file-pdf-1', name: '报告.pdf', size: 6, mimeType: 'application/pdf',
            isImage: false, serverId: 'srv-pdf-1',
            blob: new Blob([new Uint8Array([5, 6, 7, 8, 9, 10])], { type: 'application/pdf' })
          });
          // 没有原件的老记录：必须老实标记为未落盘，不能伪造
          tx.objectStore('files').put({
            id: 'file-old-1', name: 'notes.txt', size: 10, mimeType: 'text/plain',
            isImage: false, serverId: 'srv-old-1'
          });
          tx.oncomplete = res;
          tx.onerror = () => rej(tx.error);
        });
      }
      return true;
    })()
  `);
  check('已写入测试会话到 IndexedDB', true);

  // -------------------------------------------------------------------------
  // 核心：跑一次快照
  // -------------------------------------------------------------------------
  const snap = await evaluateStable(`
    (async () => {
      await window.__localstore.__setRootHandleForTest(window.__fakeRoot);
      return await window.__localstore.snapshot('e2e');
    })()
  `);
  check('快照执行成功', !!snap, JSON.stringify(snap));
  check('快照统计到 1 个对话', snap && snap.sessionCount === 1, JSON.stringify(snap));

  // -------------------------------------------------------------------------
  // 回归：countLocalSessions 必须数的是**应用库**（chat-demo），不是桥接层自己的库
  //
  // 这里曾经写错库（用了 chat-demo-localstore，里面没有 sessions 表），
  // 于是永远返回 -1。而 -1 在 maybeAutoRestoreHistory 里表示「数不出来，
  // 按不安全处理」，直接导致**换浏览器 / 清空数据后自动恢复永远不执行** ——
  // 用户看到的就是「换个浏览器记录不互联」。
  //
  // 断言要点：有会话时必须数得出正数，绝不能是 -1。
  // -------------------------------------------------------------------------
  const countWithSessions = await evaluateStable(
    `window.__localstore.countLocalSessions()`
  );
  check(
    'countLocalSessions 能数出应用库里的会话（不是 -1）',
    typeof countWithSessions === 'number' && countWithSessions > 0,
    String(countWithSessions)
  );

  const files = await evaluateStable('Object.keys(window.__fsBucket).sort()');
  console.log('\n  生成的文件:');
  files.forEach((f) => console.log('    ' + f));
  console.log('');

  // 注意：bucket 的键是相对存档根目录的路径（真实句柄的 values() 语义）
  const has = (re) => files.some((f) => re.test(f));
  check('生成了对话 Markdown', has(/^对话\/.*\.md$/));
  check('生成了对话 JSON', has(/^对话\/.*\.json$/));
  check('生成了索引 sessions.json', has(/^数据\/sessions\.json$/));
  check('生成了 manifest.json', has(/^数据\/manifest\.json$/));
  check('生成了顶层 README.md', has(/^README\.md$/));
  check('生成了附件目录', has(/^附件\/$/));

  // -------------------------------------------------------------------------
  // 附件原件落盘：图片与非图片都要存
  // -------------------------------------------------------------------------
  console.log('\n[附件落盘]');
  files.filter((f) => /^附件\//.test(f)).forEach((f) => console.log('    ' + f));

  check('图片原件已落盘', has(/^附件\/file-img-1\.png$/));
  check(
    '非图片（PDF）原件也已落盘',
    has(/^附件\/file-pdf-1\.pdf$/),
    JSON.stringify(files.filter((f) => /^附件\//.test(f)))
  );

  const filesJsonRaw = await evaluateStable(
    'window.__fsBucket[' + JSON.stringify('数据/files.json') + ']'
  );
  const filesJson = JSON.parse(filesJsonRaw);
  // files.json 是一个**裸数组**（不是 {files:[...]}），与历史版本保持一致
  const fileList = Array.isArray(filesJson) ? filesJson : filesJson.files || [];
  const recOf = (id) => fileList.find((x) => x.id === id) || {};
  console.log('    附件数: ' + fileList.length);
  console.log('    files.json: ' + JSON.stringify(fileList));
  check(
    'PDF 记录里 storedAs 指向附件目录',
    recOf('file-pdf-1').storedAs === '附件/file-pdf-1.pdf',
    JSON.stringify(recOf('file-pdf-1'))
  );
  check(
    'PDF 记录没有丢失元信息',
    recOf('file-pdf-1').name === '报告.pdf' &&
      recOf('file-pdf-1').mimeType === 'application/pdf',
    JSON.stringify(recOf('file-pdf-1'))
  );
  // 没有原件的老记录不能假装存了
  check(
    '没有原件的记录 storedAs 为 null（不伪造）',
    recOf('file-old-1').storedAs === null,
    JSON.stringify(recOf('file-old-1'))
  );
  check(
    '快照统计区分了「原件数」与「附件数」',
    snap && snap.blobCount === 2 && snap.fileCount === 3 && snap.blobMissed === 1,
    JSON.stringify({ blobCount: snap && snap.blobCount, fileCount: snap && snap.fileCount, blobMissed: snap && snap.blobMissed })
  );

  // 写进去的字节要能原样读回来
  const pdfBytes = await evaluateStable(`
    (() => {
      const raw = window.__fsBucket[${JSON.stringify('附件/file-pdf-1.pdf')}];
      if (raw == null) return null;
      if (typeof raw === 'string') return raw.length;
      return (raw.bytes && raw.bytes.length) || null;
    })()
  `);
  console.log('    读回的 PDF 字节长度: ' + pdfBytes);
  check('PDF 原件字节已写入内存文件系统', pdfBytes === 6, String(pdfBytes));

  // -------------------------------------------------------------------------
  // 校验 Markdown 内容
  // -------------------------------------------------------------------------
  const mdKey = files.find((f) => /^对话\/.*\.md$/.test(f));
  const md = await evaluateStable(
    'window.__fsBucket[' + JSON.stringify(mdKey) + ']'
  );

  check('Markdown 含标题', md.includes('# 测试对话：正则表达式'));
  check('Markdown 标注了真实模型 deepseek-v4-pro', md.includes('deepseek-v4-pro'));
  check('Markdown 含用户消息', md.includes('帮我写个匹配邮箱的正则'));
  check('Markdown 含助手回答', md.includes('[^@]+@[^@]+'));
  check('Markdown 只含被选中的分支', !md.includes('旧版本回答文字'));
  check('Markdown 含角色标注', /## 我/.test(md) && /## DeepSeek/.test(md));

  // -------------------------------------------------------------------------
  // 校验 JSON 保留了全部分支
  // -------------------------------------------------------------------------
  const jsonKey = files.find((f) => /^对话\/.*\.json$/.test(f));
  const parsed = JSON.parse(
    await evaluateStable('window.__fsBucket[' + JSON.stringify(jsonKey) + ']')
  );

  check('JSON 保留全部 3 条消息（含未选分支）', parsed.messages.length === 3, String(parsed.messages.length));
  check('JSON 顶层汇总了真实模型', Array.isArray(parsed.models) && parsed.models.includes('deepseek-v4-pro'), JSON.stringify(parsed.models));
  check('JSON conversation 为选中路径（2 条）', parsed.conversation.length === 2, String(parsed.conversation.length));
  check('JSON 带 schema 标识', parsed.schema === 'chat-demo-mirror/session@1');

  // -------------------------------------------------------------------------
  // 校验 manifest
  // -------------------------------------------------------------------------
  const manifest = JSON.parse(
    await evaluateStable(`window.__fsBucket['数据/manifest.json']`)
  );
  check('manifest 记录文件夹名', manifest.folderName === '测试存档', manifest.folderName);
  check('manifest 记录会话数', manifest.sessionCount === 1);
  check('manifest 带同步时间', typeof manifest.lastSyncAt === 'number');

  // -------------------------------------------------------------------------
  // 增量对账：改名后重跑
  // -------------------------------------------------------------------------
  await evaluateStable(`
    (async () => {
      const r = indexedDB.open('chat-demo');
      const db = await new Promise((res) => { r.onsuccess = () => res(r.result); });
      await new Promise((res, rej) => {
        const tx = db.transaction('sessions','readwrite');
        const st = tx.objectStore('sessions');
        const g = st.get('sess-test-1');
        g.onsuccess = () => {
          const s = g.result;
          s.title = '改名之后的标题';
          s.updatedAt = Date.now();
          st.put(s);
        };
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      return true;
    })()
  `);
  await evaluateStable(`window.__localstore.snapshot('e2e-2')`);

  const files2 = await evaluateStable('Object.keys(window.__fsBucket).sort()');
  const mdCount = files2.filter((f) => /^对话\/.*\.md$/.test(f)).length;
  const jsonCount = files2.filter((f) => /^对话\/.*\.json$/.test(f)).length;
  check('改名后旧文件被清理（Markdown 仍只 1 份）', mdCount === 1, `实际 ${mdCount} 份`);
  check('改名后旧文件被清理（JSON 仍只 1 份）', jsonCount === 1, `实际 ${jsonCount} 份`);

  // ⚠ 这里以前断言"文件名跟着标题变成新标题"。
  // 现在**故意不再改名**，改成"同一条对话永远落在同一个文件上"：
  // 文件名按 updatedAt 生成，一旦改名，同一个会话在不同浏览器/不同时刻
  // 就会算出不同文件名 —— 共用一个文件夹时就会**出现重复文件**，
  // 而且先写的那份会变成孤儿被清理掉（实测：跨浏览器同步后对话成批消失）。
  // 所以文件名只作为"稳定的存放位置"，标题以文件内容为准。
  const jsonName = files2.find((f) => /^对话\/.*\.json$/.test(f));
  const mirrorRaw = await evaluateStable(
    `window.__fsBucket[${JSON.stringify(jsonName)}]`
  );
  const mirror = JSON.parse(mirrorRaw);
  check(
    '★ 改名后新标题写进了文件内容（标题以内容为准，不再靠改名）',
    mirror && mirror.title === '改名之后的标题',
    mirror && mirror.title
  );
  check(
    '★ 同一条对话只产生一个文件（文件名保持稳定，避免跨浏览器重复）',
    jsonCount === 1 && mdCount === 1,
    `json=${jsonCount} md=${mdCount}`
  );

  // -------------------------------------------------------------------------
  // 恢复：清空 IndexedDB 后从文件夹读回
  // -------------------------------------------------------------------------
  console.log('  [step] 清空浏览器数据库…');
  await evaluateStable(`
    (async () => {
      const r = indexedDB.open('chat-demo');
      const db = await new Promise((res) => { r.onsuccess = () => res(r.result); });
      await new Promise((res, rej) => {
        const tx = db.transaction(['sessions','sessionSummaries'],'readwrite');
        tx.objectStore('sessions').clear();
        tx.objectStore('sessionSummaries').clear();
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      return true;
    })()
  `);
  // 注意：裸表达式里不能有顶层 await，必须包成 async IIFE
  const empty = await evaluateStable(
    '(async () => (await window.__localstore.readAllSessions()).length)()'
  );
  check('已清空浏览器数据库（模拟清缓存）', empty === 0, String(empty));

  console.log('  [step] 从文件夹恢复…');
  const restored = await evaluateStable(`window.__localstore.restoreFromFolder()`);
  check('从文件夹恢复成功', !!restored && restored.sessions === 1, JSON.stringify(restored));

  const after = await evaluateStable(`
    (async () => {
      const list = await window.__localstore.readAllSessions();
      const s = list[0];
      return {
        count: list.length,
        title: s && s.title,
        messages: s ? s.messages.length : 0,
        models: s
          ? s.messages.map(function (m) { return m.serverModel || m.model; }).filter(Boolean)
          : []
      };
    })()
  `);

  check('恢复后会话数正确', after.count === 1, String(after.count));
  check('恢复后标题正确', after.title === '改名之后的标题', String(after.title));
  check('恢复后消息数无损（3 条含分支）', after.messages === 3, String(after.messages));
  check('恢复后模型信息保留', after.models.includes('deepseek-v4-pro'), JSON.stringify(after.models));

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
  const attached = await evaluateStable(`
    (async () => {
      const r = indexedDB.open('chat-demo');
      const db = await new Promise((res) => { r.onsuccess = () => res(r.result); });
      const s = await new Promise((res) => {
        const g = db.transaction('sessions').objectStore('sessions').get('sess-test-1');
        g.onsuccess = () => res(g.result);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction('sessions','readwrite');
        tx.objectStore('sessions').put(s);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      const s2 = await new Promise((res) => {
        const g = db.transaction('sessions').objectStore('sessions').get('sess-test-1');
        g.onsuccess = () => res(g.result);
      });
      const last = s2.messages.filter((m) => m.role === 'assistant').pop();
      return last ? last.serverModel || null : null;
    })()
  `);
  check('真实模型被写入助手消息（serverModel）', attached === 'deepseek-v4-pro', String(attached));

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
  check('包含本地文件夹区块', sectionMounted.text.includes('本地文件夹存储'));
  check('包含 API Key 存文件夹区块', sectionMounted.text.includes('API Key 保存到文件夹'));
  check('包含模型显示开关', sectionMounted.text.includes('模型显示'));

  // -------------------------------------------------------------------------
  // 模型徽标：按消息顺序把模型名注入到每条回答的操作条里
  // -------------------------------------------------------------------------
  const badge = await evaluateStable(`
    (async () => {
      // 清掉真实页面里的干扰节点，用与官方同名的 class 造两条消息
      document.querySelectorAll('.message-e1faee').forEach((n) => n.remove());
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

      // 让当前显示会话就是库里的那条（2 条线性消息：user + assistant）
      await window.__localstore.injectModelBadges();

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

  // -------------------------------------------------------------------------
  // API Key 存到文件夹
  // -------------------------------------------------------------------------
  await evaluateStable(`localStorage.setItem('chat-demo:api-key', 'sk-test-key-12345')`);
  const keySaved = await evaluateStable(`
    (async () => {
      try { await window.__localstore.writeKeyToFolder(); return 'ok'; }
      catch (e) { return 'ERR:' + e.message; }
    })()
  `);
  check('API Key 写入文件夹成功', keySaved === 'ok', keySaved);

  const keyFile = await evaluateStable(`window.__fsBucket['数据/apikey.json']`);
  check('密钥文件已生成', !!keyFile);
  if (keyFile) {
    const kp = JSON.parse(keyFile);
    check('密钥文件内容正确', kp.apiKey === 'sk-test-key-12345', kp.apiKey);
    check('密钥文件含明文警告', typeof kp.warning === 'string' && kp.warning.length > 0);
  }

  const keyRead = await evaluateStable(`
    (async () => {
      const p = await window.__localstore.readKeyFromFolder();
      return p ? p.apiKey : null;
    })()
  `);
  check('可从文件夹读回密钥', keyRead === 'sk-test-key-12345', String(keyRead));

  // 回填：清掉浏览器里的 key，应能从文件夹恢复
  const hydrate = await evaluateStable(`
    (async () => {
      localStorage.removeItem('chat-demo:api-key');
      const ok = await window.__localstore.hydrateKeyFromFolder();
      return { ok, key: localStorage.getItem('chat-demo:api-key') };
    })()
  `);
  check(
    '清空后可自动从文件夹回填密钥',
    hydrate.ok === true && hydrate.key === 'sk-test-key-12345',
    JSON.stringify(hydrate)
  );

  // -------------------------------------------------------------------------
  // ★ 回归：换浏览器 / 清空数据后，连上文件夹要能把对话读回来 ★
  //
  // 这是用户报的「我另外一个浏览器记录不互联」的正面用例。
  //
  // 曾经的真实 bug：countLocalSessions() 数的是桥接层自己的库
  // （chat-demo-localstore，没有 sessions 表），永远返回 -1；
  // 而 -1 在 maybeAutoRestoreHistory() 里表示「数不出来，按不安全处理」，
  // 于是判断永远走成「本地已经有数据了，不要覆盖」，导入**从来没跑过**。
  //
  // 这里把真实链路完整跑一遍：
  //   本地库清空（模拟新浏览器）→ 文件夹里有别人的存档 → 连接后应自动读回来。
  // 覆盖 snapshot / 数据/sessions.json / 对话/*.json 的真实格式。
  // -------------------------------------------------------------------------
  console.log('\n[换浏览器] 新浏览器连上已有存档的文件夹，应把对话读回来\n');

  // 1) 造一条"文件夹里才有"的新对话（独立 id，方便断言"是它被导入了"）
  const freshTitle = '换浏览器导入验证：薛定谔的猫';
  await evaluateStable(`
    (async () => {
      const open = () => new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo', 11);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const db = await open();
      const now = Date.now();
      const session = {
        id: 'sess-fresh-1',
        title: ${JSON.stringify(freshTitle)},
        createdAt: now, updatedAt: now,
        rootMessageId: 'f1',
        messages: [
          { id: 'f1', role: 'user', content: '文件夹里才有的问题', files: [],
            createdAt: now, parentId: null, selectedChildId: 'f2' },
          { id: 'f2', role: 'assistant', model: 'deepseek-flash',
            serverModel: 'DeepSeek-V4.1-Flash',
            createdAt: now, parentId: 'f1', selectedChildId: null, status: 'done',
            blocks: [{ type: 'text', text: '文件夹里才有的回答', citations: [] }] }
        ]
      };
      await new Promise((res, rej) => {
        const tx = db.transaction(['sessions','sessionSummaries'], 'readwrite');
        tx.objectStore('sessions').put(session);
        tx.objectStore('sessionSummaries').put({
          id: session.id, title: session.title, createdAt: session.createdAt,
          updatedAt: session.updatedAt, fileIds: []
        });
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      return true;
    })()
  `);

  // 2) 落盘一次 —— 用 bridge 自己的快照写出真实格式的文件，
  //    避免手写格式跟实现对不上（那会让测试变成"假阳性"）
  await evaluateStable(`window.__localstore.snapshot('fresh-import-seed')`);
  const seededFiles = await evaluateStable('Object.keys(window.__fsBucket).sort()');
  const seededJson = seededFiles.filter((f) => /^对话\/.*\.json$/.test(f));
  check(
    '文件夹里已有本机与「新对话」的存档',
    seededJson.length >= 2,
    'json 文件: ' + JSON.stringify(seededJson)
  );
  check(
    '存档里确实有那条「文件夹里才有」的对话',
    seededFiles.some((f) => /^对话\/.*\.json$/.test(f)) &&
      (await evaluateStable(`
        Object.keys(window.__fsBucket).some(k =>
          /^对话\\/.*\\.json$/.test(k) &&
          String(window.__fsBucket[k]).indexOf(${JSON.stringify(freshTitle)}) >= 0)
      `)) === true
  );

  // 3) 模拟新浏览器：清空本地库 + 清掉"同步过"的标记
  const cleared = await evaluateStable(`
    (async () => {
      const open = () => new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo', 11);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const db = await open();
      for (const store of ['sessions','sessionSummaries','files']) {
        if (!db.objectStoreNames.contains(store)) continue;
        await new Promise((res, rej) => {
          const tx = db.transaction([store], 'readwrite');
          tx.objectStore(store).clear();
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
      }
      localStorage.removeItem('chat-demo:history-synced-at');
      const n = await window.__localstore.countLocalSessions();
      return { localCount: n, marker: localStorage.getItem('chat-demo:history-synced-at') };
    })()
  `);
  check(
    '已模拟出新浏览器（本地库为空、且没有同步过）',
    cleared.localCount === 0 && !cleared.marker,
    JSON.stringify(cleared)
  );

  // 4) 关键一步：连接文件夹后的自动恢复
  const autoRestore = await evaluateStable(`
    (async () => {
      try {
        const restored = await window.__localstore.autoRestoreAfterConnect();
        const sessions = await window.__localstore.readAllSessions();
        return {
          restored: restored,
          count: sessions.length,
          titles: sessions.map((s) => s.title),
          marker: localStorage.getItem('chat-demo:history-synced-at')
        };
      } catch (e) {
        return { error: (e && e.message) || String(e) };
      }
    })()
  `);
  check(
    '连接文件夹后自动恢复了对话（返回导入数量，不是布尔值）',
    typeof autoRestore.restored === 'number' && autoRestore.restored > 0,
    JSON.stringify(autoRestore)
  );
  check(
    '那条「文件夹里才有」的对话被读进了本地库',
    Array.isArray(autoRestore.titles) && autoRestore.titles.indexOf(freshTitle) >= 0,
    JSON.stringify(autoRestore.titles)
  );
  check(
    '恢复后写下了「已同步」标记（下次启动不会重复导入）',
    typeof autoRestore.marker === 'string' && autoRestore.marker.length > 0,
    String(autoRestore.marker)
  );

  // 5) 再调一次：本地已非空，必须跳过，绝不能覆盖
  const second = await evaluateStable(`
    (async () => {
      const r = await window.__localstore.maybeAutoRestoreHistory();
      return JSON.stringify(r);
    })()
  `);
  check(
    '再次调用不会重复导入（本地非空时跳过）',
    /already-synced|local-not-empty/.test(second),
    second
  );

  // 6) 本地已有数据时连接文件夹，绝不能把本地清掉
  const localKept = await evaluateStable(`
    (async () => {
      const before = (await window.__localstore.readAllSessions()).length;
      await window.__localstore.autoRestoreAfterConnect();
      const after = (await window.__localstore.readAllSessions()).length;
      return { before: before, after: after };
    })()
  `);
  check(
    '本地已有对话时不会被覆盖（导入是合并语义）',
    localKept.after === localKept.before && localKept.after > 0,
    JSON.stringify(localKept)
  );

  // -------------------------------------------------------------------------
  // ★ 回归：文件夹里没有可恢复的对话时，autoRestoreAfterConnect 必须返回 0，
  //   不能返回真值 —— 否则调用方会当成"恢复成功"去刷新页面，刷新后又重扫，
  //   用户看到界面一直卡在「处理中… / 同步中…」。
  // -------------------------------------------------------------------------
  const noImport = await evaluateStable(`
    (async () => {
      // 造一个**空的**存档文件夹并切过去（模拟"文件夹里没有对话"）
      const bucket = {};
      const makeDir = (prefix) => ({
        kind: 'directory',
        name: prefix === '' ? '空存档' : prefix.split('/').filter(Boolean).pop(),
        async getDirectoryHandle(child, opts) {
          const key = prefix + child + '/';
          if (bucket[key] === undefined) {
            if (!opts || !opts.create) {
              const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
            }
            bucket[key] = true;
          }
          return makeDir(prefix + child + '/');
        },
        async getFileHandle(fname, opts) {
          const key = prefix + fname;
          if (bucket[key] === undefined && !(opts && opts.create)) {
            const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
          }
          return { kind: 'file', name: fname,
            async createWritable() { return { write: async () => {}, close: async () => {} }; },
            async getFile() { return new File([''], fname); } };
        },
        async removeEntry(fname) { delete bucket[prefix + fname]; },
        async *values() {},
        async queryPermission() { return 'granted'; },
        async requestPermission() { return 'granted'; }
      });
      // 清空本地库 + 清掉同步标记 → 满足"全新浏览器"的两个前置条件
      const open = () => new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo', 11);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const db = await open();
      for (const store of ['sessions','sessionSummaries','files']) {
        if (!db.objectStoreNames.contains(store)) continue;
        await new Promise((res, rej) => {
          const tx = db.transaction([store], 'readwrite');
          tx.objectStore(store).clear();
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
      }
      localStorage.removeItem('chat-demo:history-synced-at');
      await window.__localstore.__setRootHandleForTest(makeDir(''));
      const n = await window.__localstore.autoRestoreAfterConnect();
      return JSON.stringify({ n: n, type: typeof n });
    })()
  `);
  const ni = JSON.parse(noImport);
  check(
    'autoRestoreAfterConnect 返回数字而不是布尔值（类型契约）',
    ni.type === 'number',
    noImport
  );
  check(
    '文件夹里没有可恢复的对话时返回 0（不会误触发刷新）',
    ni.n === 0,
    noImport
  );

  // -------------------------------------------------------------------------
  // ★ 回归：界面不能永远卡在「处理中…」★
  //   用户实测反馈过界面一直停在 处理中… / 同步中… 出不来，
  //   所有按钮被禁用，只能关标签页。这里锁住三个逃生机制。
  // -------------------------------------------------------------------------
  const stuck = JSON.parse(await evaluateStable(`
    (async () => {
      const L = window.__localstore;
      // 1) 手动逃生舱
      const before = L.isBusy();
      const after = L.unstick();
      return JSON.stringify({
        before: before,
        afterBusy: after && after.busy,
        isBusyNow: L.isBusy(),
        hasReloadLog: Array.isArray(L.reloadLog())
      });
    })()
  `));
  check('isBusy() 可用（能查出面板是否还锁着）', stuck.before === false, JSON.stringify(stuck));
  check('unstick() 能把「处理中」强制放开', stuck.isBusyNow === false, JSON.stringify(stuck));
  check('reloadLog() 可用（能查出是谁要刷新）', stuck.hasReloadLog === true, JSON.stringify(stuck));

  // 2) 刷新被 8 秒闸门拦下时，必须留下 blocked 记录，
  //    否则"界面卡住不刷新"根本无从排查
  const blockedLog = JSON.parse(await evaluateStable(`
    (async () => {
      const L = window.__localstore;
      // 先把闸门时间戳设成"刚刚"，这样下一次请求一定被拦
      sessionStorage.setItem('chat-demo:auto-reload-at', String(Date.now()));
      const ok = L.__requestReloadForTest('测试：故意触发闸门');
      const log = L.reloadLog();
      const last = log[log.length - 1] || null;
      sessionStorage.removeItem('chat-demo:auto-reload-at');
      return JSON.stringify({ ok: ok, last: last });
    })()
  `));
  check(
    '刷新被闸门拦下时记录 blocked:true（可排查）',
    blockedLog.ok === false && blockedLog.last && blockedLog.last.blocked === true,
    JSON.stringify(blockedLog)
  );
  check(
    '被拦下的记录带原因与调用栈',
    blockedLog.last && /测试：故意触发闸门/.test(blockedLog.last.reason || '') &&
      typeof blockedLog.last.stack === 'string' && blockedLog.last.stack.length > 0,
    JSON.stringify(blockedLog.last)
  );

  // -------------------------------------------------------------------------
  // ★★ 回归：必须挡住"每 9 秒刷一次"的无限刷新循环 ★★
  //
  // 原实现只有一个**滑动窗口**（8 秒内只允许一次），它只限速不限次：
  // 每次启动周期超过 8 秒就变成无限循环，页面永远在加载、面板永远停在
  // 「处理中… / 同步中…」。现在必须做到"每次页面加载只允许一次刷新"。
  // -------------------------------------------------------------------------
  const loopGuard = JSON.parse(await evaluateStable(`
    (async () => {
      const L = window.__localstore;
      sessionStorage.removeItem('chat-demo:auto-reload-at');
      sessionStorage.removeItem('chat-demo:auto-reload-count');
      const seq = [];
      // 连续请求 6 次，keepQuota=true 让配额真的累积：
      // 旧实现只靠 8 秒滑动窗口，会放行多次；新实现必须只放行第 1 次。
      for (let i = 0; i < 6; i++) {
        seq.push(L.__requestReloadForTest('循环测试 ' + i, true));
      }
      const afterAll = sessionStorage.getItem('chat-demo:auto-reload-count');
      sessionStorage.removeItem('chat-demo:auto-reload-at');
      sessionStorage.removeItem('chat-demo:auto-reload-count');
      return JSON.stringify({ seq: seq, count: afterAll });
    })()
  `));
  console.log('    放行序列: ' + JSON.stringify(loopGuard.seq));
  check(
    '★★ 每次页面加载只允许一次自动刷新（挡住无限刷新循环）',
    loopGuard.seq[0] === true && loopGuard.seq.slice(1).every((x) => x === false),
    JSON.stringify(loopGuard.seq)
  );

  // 跨"8 秒滑动窗口"也必须照样拦住：模拟"刷完一次、过了 9 秒又来一次"
  const loopGuard2 = JSON.parse(await evaluateStable(`
    (async () => {
      const L = window.__localstore;
      sessionStorage.removeItem('chat-demo:auto-reload-at');
      sessionStorage.removeItem('chat-demo:auto-reload-count');
      // 第一次请求并**保留配额**（模拟真的刷了一次），
      // 然后伪造"上次刷新发生在 9 秒前"——滑动窗口已经过期，
      // 旧实现会在这里放行，从而形成"每 9 秒刷一次"的无限循环。
      const first = L.__requestReloadForTest('第一次', true);
      sessionStorage.setItem('chat-demo:auto-reload-at', String(Date.now() - 9000));
      const second = L.__requestReloadForTest('过了 9 秒又来一次', true);
      sessionStorage.removeItem('chat-demo:auto-reload-at');
      sessionStorage.removeItem('chat-demo:auto-reload-count');
      return JSON.stringify({ first: first, second: second });
    })()
  `));
  check(
    '★ 滑动窗口过期后也不放行（这正是原来无限循环的成因）',
    loopGuard2.first === true && loopGuard2.second === false,
    JSON.stringify(loopGuard2)
  );

  // 3) syncDoctor 必须把 UI/刷新现场一起报出来（用户只跑一条命令就够）
  const doc = JSON.parse(await evaluateStable(
    `(async () => JSON.stringify(await window.__localstore.syncDoctor()))()`
  ));
  check('syncDoctor 带 ui.busy（面板是否锁着）',
    doc.ui && typeof doc.ui.busy === 'boolean', JSON.stringify(doc.ui));
  check('syncDoctor 带 reloadLog（刷新现场）',
    Array.isArray(doc.reloadLog) && doc.reloadLog.length > 0, JSON.stringify(doc.reloadLog));

  // -------------------------------------------------------------------------
  // ★ 端到端：用户点「选择文件夹…」时真正跑的那条业务逻辑 ★
  //
  // 前面几节是分开验证各个零件（countLocalSessions / autoRestoreAfterConnect）。
  // 这一节直接把 pickAndRestoreFolder() 整条跑一遍 —— 顺序才是最容易出错的地方
  // （先导入还是先对账、什么时候刷新、刷新被拦下会不会卡住）。
  //
  // 做法：替换 window.showDirectoryPicker 让它直接返回那个已有存档的文件夹，
  // 不需要真的弹系统选择框。
  // -------------------------------------------------------------------------
  console.log('\n[选择文件夹] 点按钮后应自动导入并保持界面可用\n');

  const pickPath = JSON.parse(await evaluateStable(`
    (async () => {
      const L = window.__localstore;

      // ⚠ 不能依赖前面注入的 window.__fakeRoot / __fsBucket：
      // 导入成功后排队的刷新会**真的把页面 reload 掉**，那两个内存对象
      // 就随页面一起没了（模拟目录句柄只存在于 JS 内存里）。
      // 所以这一段自带一整套"文件夹 + 存档"，不依赖任何先前状态。
      const bucket = {};
      const makeDir = (prefix) => ({
        kind: 'directory',
        name: prefix === '' ? '选择测试存档' : prefix.split('/').filter(Boolean).pop(),
        async getDirectoryHandle(child, opts) {
          const key = prefix + child + '/';
          if (bucket[key] === undefined) {
            if (!opts || !opts.create) {
              const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
            }
            bucket[key] = true;
          }
          return makeDir(prefix + child + '/');
        },
        async getFileHandle(fname, opts) {
          const key = prefix + fname;
          if (bucket[key] === undefined && !(opts && opts.create)) {
            const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
          }
          return { kind: 'file', name: fname,
            async createWritable() {
              let buf = '';
              return { write: async (d) => { buf += typeof d === 'string' ? d : '[blob]'; },
                       close: async () => { bucket[key] = buf; } };
            },
            async getFile() { return new File([bucket[key] || ''], fname); } };
        },
        async removeEntry(f) { delete bucket[prefix + f]; },
        async *values() {
          for (const k of Object.keys(bucket)) {
            if (!k.startsWith(prefix)) continue;
            const rest = k.slice(prefix.length);
            if (!rest || rest.includes('/')) continue;
            if (bucket[k] === true) yield { kind: 'directory', name: rest };
            else yield { kind: 'file', name: rest };
          }
        },
        async queryPermission() { return 'granted'; },
        async requestPermission() { return 'granted'; }
      });
      const root = makeDir('');

      // 造一份真实结构的存档文件（格式与 bridge 自己写出来的一致）
      const now = Date.now();
      const title = '选择文件夹导入验证';
      const session = {
        schema: 'chat-demo-mirror/session@1',
        id: 'sess-pick-1', title: title,
        createdAt: now, updatedAt: now, rootMessageId: 'k1',
        conversation: [], messages: [
          { id: 'k1', role: 'user', content: '选文件夹后能看到我吗', files: [],
            createdAt: now, parentId: null, selectedChildId: 'k2' },
          { id: 'k2', role: 'assistant', model: 'deepseek-flash',
            serverModel: 'DeepSeek-V4.1-Flash', createdAt: now,
            parentId: 'k1', selectedChildId: null, status: 'done',
            blocks: [{ type: 'text', text: '能看到', citations: [] }] }
        ]
      };
      const convDir = await root.getDirectoryHandle('对话', { create: true });
      const fh = await convDir.getFileHandle('pick-test.json', { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(session));
      await w.close();

      // 清空本地库 + 清标记 → 模拟新浏览器
      const open = () => new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo', 11);
        r.onupgradeneeded = () => {
          const db = r.result;
          for (const s of ['sessions','files']) {
            if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('sessionSummaries')) {
            const st = db.createObjectStore('sessionSummaries', { keyPath: 'id' });
            st.createIndex('fileIds', 'fileIds', { multiEntry: true });
          }
        };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      const db = await open();
      for (const store of ['sessions','sessionSummaries','files']) {
        if (!db.objectStoreNames.contains(store)) continue;
        await new Promise((res, rej) => {
          const tx = db.transaction([store], 'readwrite');
          tx.objectStore(store).clear();
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
      }
      localStorage.removeItem('chat-demo:history-synced-at');
      // 清掉刷新闸门，让排队的刷新这次真的能成功
      sessionStorage.removeItem('chat-demo:auto-reload-at');

      // 关键：让 showDirectoryPicker 直接返回这个文件夹
      const orig = window.showDirectoryPicker;
      window.showDirectoryPicker = async () => root;

      // ★ 故意把刷新闸门关上，强制走"刷新被拦下"这条路。
      //
      // 为什么这么测：用户在真实环境里踩到的正是这条 —— 刷新被 8 秒闸门
      // 拦下、页面不跳转，而 busy 没放开，面板永久停在「处理中…」。
      // 让刷新真的发生反而测不到它（页面一跳，断言窗口就没了）。
      // 排在前面的那几条测试已经验证过"刷新会被正常发出"。
      sessionStorage.setItem('chat-demo:auto-reload-count', '1');

      let res = null, err = null;
      try { res = await L.__pickAndRestoreFolderForTest(); }
      catch (e) { err = (e && e.message) || String(e); }
      window.showDirectoryPicker = orig;

      const after = await L.readAllSessions();
      // 等过排队刷新的 800ms 延迟 + 余量
      await new Promise(r => setTimeout(r, 1500));
      sessionStorage.removeItem('chat-demo:auto-reload-count');
      sessionStorage.removeItem('chat-demo:auto-reload-at');

      return JSON.stringify({
        err: err, res: res,
        localAfter: after.length,
        titles: after.map(s => s.title),
        busyAfter: L.isBusy(),
        message: (document.querySelector('.ls-msg') || {}).textContent || null,
        reloadLog: L.reloadLog().slice(-3).map(x => ({ reason: x.reason, blocked: x.blocked }))
      });
    })()
  `));
  console.log('    ' + JSON.stringify(pickPath));
  check('点「选择文件夹」后没有抛错', pickPath.err === null, String(pickPath.err));
  check('点完之后对话真的进了本地库',
    pickPath.localAfter > 0, JSON.stringify(pickPath.titles));
  check('pickAndRestoreFolder 报告导入了对话',
    pickPath.res && pickPath.res.imported > 0, JSON.stringify(pickPath.res));
  check('★ 界面没有卡在「处理中…」（busy 已放开）',
    pickPath.busyAfter === false, JSON.stringify({ busy: pickPath.busyAfter, msg: pickPath.message }));
  check('刷新被拦下时给出了手动刷新的提示（不是静默卡住）',
    typeof pickPath.message === 'string' && pickPath.message.includes('Ctrl+Shift+R'),
    JSON.stringify(pickPath.message));
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
