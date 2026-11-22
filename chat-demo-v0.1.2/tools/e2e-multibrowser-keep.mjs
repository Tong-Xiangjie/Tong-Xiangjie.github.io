/**
 * 跨浏览器共用同一个存档文件夹 —— 防丢失专项测试。
 *
 * 用户的真实处境（实测已造成数据丢失）：
 *   文件夹 数据/sessions.json 里有 9 条对话，但文件夹里只剩 4 个 JSON 文件。
 *   浏览器 A 有 6 条（仿真足球新手入门指南 / 新对话 / 死刑后能否回家 /
 *   SVG文字放大对齐 / NLiPsCalib论文讲解 / 用户问候助手），
 *   浏览器 B 有 4 条（未命名对话 / 用户问候助手 / 初次问候回应 / 仅提取光学部分）。
 *   两边合起来 9 条，但**谁最后同步，文件夹里就只剩谁的**。
 *
 * 根因：
 *   `数据/sessions.json` 是多个浏览器**共用**的文件，而每个浏览器快照时都用
 *   "自己本地库里的会话"把它整个覆盖掉：
 *     · A 写完后索引里只剩 A 的 6 条；
 *     · B 本地库根本没有 A 那几条，算出的 mine 里没有 A 的文件名；
 *     · B 的"空库保护"闸门只看"本地是否为空"，B 不空 → 闸门不成立 → 进入清理，
 *       把"上次索引里没有"的 A 的对话文件当残留删掉。
 *
 * 修复后必须满足：
 *   1. 快照不删别人的会话文件；
 *   2. 索引保留别人的条目（否则下一次快照又会把它们当残留）；
 *   3. 本机真的删了某条对话时，它自己的文件仍要能被清理掉（别把功能修死）。
 */
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget } from './minimal-cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8913;
const DIR_NAME = '跨浏览器防丢失';

const server = http.createServer((req, res) => {
  const p0 = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const p = p0 === '/' ? '/index.html' : p0;
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
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

function waitFreePort(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host: '127.0.0.1', port });
      const done = (free) => {
        sock.destroy();
        if (free) return resolve(port);
        if (Date.now() > deadline) return reject(new Error('端口占用'));
        setTimeout(attempt, 250);
      };
      sock.once('connect', () => done(false));
      sock.once('error', () => done(true));
      sock.setTimeout(1000, () => done(false));
    };
    attempt();
  });
}

// 假文件夹：bucket 就是"磁盘上的文件内容"，测试可直接读写
function fsSetupScript(initialBucket) {
  return `
    (() => {
      const bucket = ${JSON.stringify(initialBucket)};
      window.__fsBucket = bucket;
      function makeFileHandle(prefix, fname) {
        const key = prefix + fname;
        return {
          kind: 'file', name: fname,
          async createWritable() {
            let buf = '';
            return { write: async (d) => { buf += typeof d === 'string' ? d : '[blob]'; },
                     close: async () => { bucket[key] = buf; } };
          },
          async getFile() { return new File([bucket[key] || ''], fname); }
        };
      }
      function makeDir(prefix) {
        return {
          kind: 'directory',
          name: prefix === '' ? ${JSON.stringify(DIR_NAME)} : prefix.split('/').filter(Boolean).pop(),
          async getDirectoryHandle(child, opts) {
            const key = prefix + child + '/';
            if (bucket[key] === undefined) {
              if (!opts || !opts.create) { const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e; }
              bucket[key] = true;
            }
            return makeDir(prefix + child + '/');
          },
          async getFileHandle(fname, opts) {
            const key = prefix + fname;
            if (bucket[key] === undefined && !(opts && opts.create)) {
              const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
            }
            return makeFileHandle(prefix, fname);
          },
          async removeEntry(fname) { delete bucket[prefix + fname]; },
          async *values() {
            for (const k of Object.keys(bucket)) {
              if (!k.startsWith(prefix)) continue;
              const rest = k.slice(prefix.length);
              if (!rest || rest.includes('/')) continue;
              if (bucket[k] === true) yield { kind: 'directory', name: rest };
              else yield makeFileHandle(prefix, rest);
            }
          },
          async queryPermission() { return 'granted'; },
          async requestPermission() { return 'granted'; }
        };
      }
      window.__fakeRoot = makeDir('');
      return true;
    })()
  `;
}

function mkSession(id, title, now) {
  return {
    id, title, createdAt: now, updatedAt: now, rootMessageId: 'u-' + id,
    messages: [
      { id: 'u-' + id, role: 'user', content: title, files: [], createdAt: now,
        parentId: null, selectedChildId: 'a-' + id },
      { id: 'a-' + id, role: 'assistant', createdAt: now + 1, parentId: 'u-' + id,
        selectedChildId: null, model: 'deepseek-flash', status: 'done',
        blocks: [{ type: 'text', text: title + ' 的回答' }] }
    ]
  };
}

const profile = mkdtempSync(join(tmpdir(), 'cdp-xbr-'));
const cdpPort = await waitFreePort(9405);
spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
   '--no-first-run', '--window-size=1300,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
await sleep(400);
const target = await fetchPageTarget(cdpPort);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
// 关掉"收完就刷新"，否则页面一跳测试就断
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.location.reload = function () {};`
});
await sleep(3500);
const ev = (e) => cdp.evaluate(e);

console.log('\n=== 跨浏览器共用文件夹：防丢失测试 ===\n');

const now = Date.now();
await ev(fsSetupScript({
  '对话/': true,
  '数据/': true,
  '附件/': true
}));

await ev(`
  (() => {
    window.location.reload = function () {};
    localStorage.setItem('chat-demo:ls-watch-noreload', 'true');
    localStorage.setItem('chat-demo:api-key', 'sk-xbr');
    localStorage.setItem('chat-demo:providers', JSON.stringify([
      { id:'deepseek-official', name:'DeepSeek', baseURL:'https://api.deepseek.com',
        apiKey:'sk-xbr', builtin:true, defaultModel:'deepseek-flash' }
    ]));
    localStorage.setItem('chat-demo:active-provider', 'deepseek-official');
    // 关键：带"已同步"标记 —— 否则空库保护闸门会挡住清理，测不出问题
    localStorage.setItem('chat-demo:history-synced-at', String(Date.now()));
    return 'ok';
  })()
`);

/**
 * 切换"当前是哪个浏览器"。
 *
 * 修复后清理权限是按"谁写的"判定的（`数据/sessions.json` 里每条会话带
 * `wroteBy`），而浏览器身份存在 localStorage。同一个页面里模拟两个浏览器，
 * 就是在两次快照之间换掉这个身份 —— 这正是本次要测的东西。
 */
async function becomeBrowser(id) {
  return ev(`(() => { localStorage.setItem('chat-demo:browser-id', ${JSON.stringify(id)}); return true; })()`);
}

/** 把指定会话写进本地库（模拟"这个浏览器里有这几条对话"） */
async function setLocalSessions(sessions) {
  return JSON.parse(await ev(`
    (async () => {
      const SESSIONS = ${JSON.stringify(sessions)};
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('chat-demo', 11);
        r.onupgradeneeded = () => {
          const d = r.result;
          for (const s of ['sessions','files']) {
            if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
          }
          if (!d.objectStoreNames.contains('sessionSummaries')) {
            const st = d.createObjectStore('sessionSummaries', { keyPath: 'id' });
            st.createIndex('fileIds', 'fileIds', { multiEntry: true });
          }
        };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      for (const store of ['sessions','sessionSummaries','files']) {
        if (!db.objectStoreNames.contains(store)) continue;
        await new Promise((res, rej) => {
          const tx = db.transaction([store], 'readwrite');
          tx.objectStore(store).clear();
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
      }
      await new Promise((res, rej) => {
        const tx = db.transaction(['sessions','sessionSummaries'], 'readwrite');
        for (const s of SESSIONS) {
          tx.objectStore('sessions').put(s);
          tx.objectStore('sessionSummaries').put({ id: s.id, title: s.title,
            createdAt: s.createdAt, updatedAt: s.updatedAt, fileIds: [] });
        }
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      db.close();
      return JSON.stringify((SESSIONS || []).map(s => s.id));
    })()
  `));
}

// ---------------------------------------------------------------------------
// 第 1 步：浏览器 A（6 条，模拟用户的 Chrome）完整同步一次
// ---------------------------------------------------------------------------
const A = [
  mkSession('a-football', '仿真足球新手入门指南', now - 6000e3),
  mkSession('a-newchat', '新对话', now - 5000e3),
  mkSession('a-death', '死刑后能否回家', now - 4000e3),
  mkSession('a-svg', 'SVG文字放大对齐', now - 3000e3),
  mkSession('a-nlips', 'NLiPsCalib论文讲解', now - 2000e3),
  mkSession('a-greet', '用户问候助手', now - 1000e3)
];
await becomeBrowser('chrome-A');
await setLocalSessions(A);
const aSnap = JSON.parse(await ev(`
  (async () => {
    await window.__localstore.__setRootHandleForTest(window.__fakeRoot);
    const r = await window.__localstore.snapshot('browser-A');
    const files = Object.keys(window.__fsBucket).filter(k => /^对话\\/.*\\.json$/.test(k));
    const idx = JSON.parse(window.__fsBucket['数据/sessions.json']);
    return JSON.stringify({ files: files.length, removed: r ? r.removed : null,
      indexCount: (idx.sessions || []).length });
  })()
`));
console.log('    A 同步后: ' + JSON.stringify(aSnap));
check('A（6 条）同步后文件夹里有 6 个对话文件', aSnap.files === 6, String(aSnap.files));
check('A 的索引记下了 6 条会话', aSnap.indexCount === 6, String(aSnap.indexCount));

// 直接看磁盘上到底有什么、以及"读回来的索引"长什么样 —— 别猜
const probe = JSON.parse(await ev(`
  (async () => {
    const keys = Object.keys(window.__fsBucket).filter(k => /^对话\\//.test(k));
    const idx = JSON.parse(window.__fsBucket['数据/sessions.json']);
    const pairs = (idx.sessions || []).map(s => ({ id: s.id, files: s.files }));
    return JSON.stringify({ diskKeys: keys, sessions: pairs });
  })()
`));
console.log('    磁盘上的对话文件: ' + JSON.stringify(probe.diskKeys));
console.log('    A 索引条目: ' + JSON.stringify(probe.sessions));

// ---------------------------------------------------------------------------
// 第 2 步：浏览器 B（4 条，含 A 没有的 3 条）同步 —— 这里是丢数据的地方
// ---------------------------------------------------------------------------
const B = [
  mkSession('b-untitled', '未命名对话', now - 7000e3),
  mkSession('a-greet', '用户问候助手', now - 1000e3), // 两边都有
  mkSession('b-first', '初次问候回应', now - 8000e3),
  mkSession('b-optics', '仅提取光学部分', now - 9000e3)
];
await becomeBrowser('edge-B');
await setLocalSessions(B);
const bSnap = JSON.parse(await ev(`
  (async () => {
    await window.__localstore.__setRootHandleForTest(window.__fakeRoot);
    const r = await window.__localstore.snapshot('browser-B');
    const files = Object.keys(window.__fsBucket).filter(k => /^对话\\/.*\\.json$/.test(k));
    const idx = JSON.parse(window.__fsBucket['数据/sessions.json']);
    return JSON.stringify({
      files: files,
      fileCount: files.length,
      removed: r ? r.removed : null,
      keptForeign: r ? r.keptForeign : null,
      indexCount: (idx.sessions || []).length,
      indexPath: Object.keys(window.__fsBucket).filter(k => /^数据\\/.*\\.json$/.test(k)),
      diag: window.__localstore.lastSnapshotDiag()
    });
  })()
`));
console.log('    B 同步后: 文件数=' + bSnap.fileCount + ' 删了=' + bSnap.removed +
  ' 保留外部=' + bSnap.keptForeign + ' 索引条目=' + bSnap.indexCount);
console.log('    B 的清理判据: ' + JSON.stringify(bSnap.diag));
check('★★ B 同步时没有删掉 A 的对话文件（不再"谁最后同步只剩谁"）',
  bSnap.fileCount >= 6, '只剩 ' + bSnap.fileCount + ' 个: ' + JSON.stringify(bSnap.files));
check('★ B 的索引保留了 A 的条目（否则下次快照又会删）',
  bSnap.indexCount >= 7, '索引条目 ' + bSnap.indexCount);

// ---------------------------------------------------------------------------
// 第 3 步：A 再同步一次（带"已同步"标记、且没有外部新文件）——
//         以前这一步也会把 B 的文件删掉
// ---------------------------------------------------------------------------
await becomeBrowser('chrome-A');
await setLocalSessions(A);
const aSnap2 = JSON.parse(await ev(`
  (async () => {
    await window.__localstore.__setRootHandleForTest(window.__fakeRoot);
    const r = await window.__localstore.snapshot('browser-A-again');
    const files = Object.keys(window.__fsBucket).filter(k => /^对话\\/.*\\.json$/.test(k));
    return JSON.stringify({ fileCount: files.length, files: files,
      removed: r ? r.removed : null,
      all: Object.keys(window.__fsBucket).filter(k => /^对话\\//.test(k)).length });
  })()
`));
console.log('    A 再次同步后: 文件数=' + aSnap2.fileCount + ' 删了=' + aSnap2.removed);
check('★★ A 再次同步也没删掉 B 的对话（反复同步也不丢）',
  aSnap2.fileCount >= 9, '只剩 ' + aSnap2.fileCount + ' 个');

// ---------------------------------------------------------------------------
// 第 4 步：本机**真的删掉**一条对话时，它的文件仍要能被清理（别把功能修死）
// ---------------------------------------------------------------------------
const Aminus = A.filter((s) => s.id !== 'a-svg');
await becomeBrowser('chrome-A');
await setLocalSessions(Aminus);
const pruneSnap = JSON.parse(await ev(`
  (async () => {
    await window.__localstore.__setRootHandleForTest(window.__fakeRoot);
    const r = await window.__localstore.snapshot('a-deleted-one');
    const files = Object.keys(window.__fsBucket).filter(k => /^对话\\/.*\\.json$/.test(k));
    return JSON.stringify({ removed: r ? r.removed : null, fileCount: files.length,
      stillThere: files.filter(f => /SVG/.test(f)) });
  })()
`));
console.log('    删掉一条后同步: 删了=' + pruneSnap.removed + ' 剩余=' + pruneSnap.fileCount);
check('★ 本机自己删掉的对话，文件仍会被清理（功能没被修死）',
  pruneSnap.removed >= 1 && pruneSnap.stillThere.length === 0,
  JSON.stringify(pruneSnap));
check('清理之后别人的对话还在（B 的 4 条不受影响）',
  pruneSnap.fileCount >= 8, String(pruneSnap.fileCount));

console.log('\n' + '='.repeat(52));
console.log(`跨浏览器防丢失测试: ${pass} 通过 / ${fail} 失败`);

cdp.close?.();
server.close();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
