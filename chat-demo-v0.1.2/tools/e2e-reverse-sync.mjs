/**
 * 反向同步专项测试：文件夹里冒出来的新对话，应用要**自动**收进来。
 *
 * 背景（用户实际被卡住的场景）：
 *   在 GitHub 网页版（或另一台机器 / 另一个浏览器）新建了对话，
 *   本机的文件夹里已经有这些对话文件了，但本机应用上死活看不到，
 *   必须手动点「从文件夹恢复」。
 *
 * 根因：原来的自动恢复只在「本浏览器没有历史同步标记 + 本地库是空的」时才跑，
 * 所以只要本机已经有对话，就永远不会再去读文件夹。
 *
 * 现在改为：定时扫「对话」目录，只认比启动基线更新的文件，读进来按 id 合并。
 *
 * 模拟方式：注入一个内存假文件夹（带真实的 lastModified 语义），
 * 启动后往里面塞一个新的会话文件（lastModified 设为"未来"，等价于外部刚改过），
 * 然后断言它被自动收进 IndexedDB。
 */
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8901;
const DIR_NAME = '反向同步测试存档';

const server = http.createServer((req, res) => {
  // ⚠ 必须用 .pathname（它会自动丢掉 ?v=hash）而不是整个 req.url。
  // 桥接层给功能扩展层加的是 `localstore-features.js?v=1.2.0`，
  // 把查询串当成文件名去 existsSync 会一律 404，功能层就完全没加载
  // —— 表现成「反向同步怎么都不生效」，其实是测试服务器的问题。
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
        if (Date.now() > deadline) return reject(new Error(`端口 ${port} 一直没空出来`));
        setTimeout(attempt, 250);
      };
      sock.once('connect', () => done(false));
      sock.once('error', () => done(true));
      sock.setTimeout(1000, () => done(false));
    };
    attempt();
  });
}

/**
 * 假文件夹。
 *
 * ⚠ 关键：`values()` 必须产出**真正的 FileSystemFileHandle 形状**
 * （也就是要带 `getFile()`），不能只给一个 `{kind, name}` 的裸对象。
 * 踩过的坑：真代码里写的是 `await entry.getFile()`，裸对象没有这个方法，
 * 异常被 catch 吞掉，表现成「文件夹里明明有文件，就是永远收不进来」，
 * 而且一句日志都没有 —— 白查了半天。
 *
 * lastModified 由测试用 __touch 显式控制，不用 Date.now()：
 * 我们自己写下去的文件如果带上"现在"的时间，会被当成外部改动。
 */
function fsSetupScript(initialBucket, initialTimes, initialBase) {
  return `
    (() => {
      const bucket = ${JSON.stringify(initialBucket)};
      const times = ${JSON.stringify(initialTimes)};
      const BASE_TS = ${JSON.stringify(initialBase)};
      window.__fsBucket = bucket;
      window.__fsTimes = times;
      window.__fsBase = BASE_TS;
      window.__touch = (path, t) => { times[path] = t; };

      function makeFileHandle(prefix, fname) {
        const key = prefix + fname;
        return {
          kind: 'file',
          name: fname,
          async createWritable() {
            let buf = '';
            return {
              write: async (d) => { buf += typeof d === 'string' ? d : '[blob]'; },
              close: async () => {
                bucket[key] = buf;
                if (times[key] === undefined) times[key] = BASE_TS;
              }
            };
          },
          async getFile() {
            const t = times[key] === undefined ? BASE_TS : times[key];
            const body = bucket[key] === undefined ? '' : bucket[key];
            const f = new File([body], fname);
            try { Object.defineProperty(f, 'lastModified', { value: t, configurable: true }); } catch (e) {}
            try { Object.defineProperty(f, 'size', { value: body.length, configurable: true }); } catch (e) {}
            return f;
          }
        };
      }

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
            return makeFileHandle(prefix, fname);
          },
          async removeEntry(fname) { delete bucket[prefix + fname]; delete times[prefix + fname]; },
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

function mkSession(id, title, now, tag) {
  return {
    id, title, createdAt: now, updatedAt: now, rootMessageId: 'u-' + id,
    messages: [
      { id: 'u-' + id, role: 'user', content: title + '：' + tag, files: [], createdAt: now,
        parentId: null, selectedChildId: 'a-' + id },
      { id: 'a-' + id, role: 'assistant', createdAt: now + 1, parentId: 'u-' + id,
        selectedChildId: null, model: 'deepseek-flash', status: 'done',
        blocks: [{ type: 'text', text: title + ' 的回答' }] }
    ]
  };
}

const profile = mkdtempSync(join(tmpdir(), 'cdp-rev-'));
const cdpPort = await waitFreePort(9391);
const chrome = spawn(findBrowser(),
  [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
   '--no-first-run', '--window-size=1400,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
const target = await fetchPageTarget(cdpPort);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await sleep(3000);
const ev = (e) => cdp.evaluate(e);

console.log('\n=== 反向同步（文件夹 → 应用）测试 ===\n');

// ---------------------------------------------------------------------------
// 准备：文件夹里已经有两条对话，但**本地库并不是空的** ——
// 这正是用户踩坑的处境：历史同步标记早就写过了，旧逻辑从此再也不读文件夹。
// ---------------------------------------------------------------------------
const now = Date.now();
const T0 = now - 3600e3;
const T_NEW = now + 60000;    // 外部新改过，明显更晚
const watchMs = 800;          // 测试用的扫描间隔（覆盖自适应节奏）

// 本地先放一条对话，并把会话摘要也写进去（等价于"这个浏览器早就在用了"）
await ev(`
  (async () => {
    const db = await new Promise((res) => { const rq = indexedDB.open('chat-demo'); rq.onsuccess = () => res(rq.result); });
    const localSession = {
      id: 'local-only', title: '本地本来就有的对话',
      createdAt: ${now - 90000e3}, updatedAt: ${now - 90000e3}, rootMessageId: 'u-lo',
      messages: [
        { id: 'u-lo', role: 'user', content: '本地的问题', files: [], createdAt: ${now - 90000e3},
          parentId: null, selectedChildId: 'a-lo' },
        { id: 'a-lo', role: 'assistant', createdAt: ${now - 90000e3 + 1}, parentId: 'u-lo',
          selectedChildId: null, model: 'deepseek-flash', status: 'done',
          blocks: [{ type: 'text', text: '本地的回答' }] }
      ]
    };
    await new Promise((res) => {
      const tx = db.transaction(['sessions','sessionSummaries'], 'readwrite');
      tx.objectStore('sessions').put(localSession);
      tx.objectStore('sessionSummaries').put({ id: 'local-only', title: '本地本来就有的对话',
        createdAt: localSession.createdAt, updatedAt: localSession.updatedAt, fileIds: [] });
      tx.oncomplete = () => res();
    });
    return 'ok';
  })()
`);

await ev(fsSetupScript({
  '对话/': true,
  // 用应用自己的命名规则（`<时间>_<标题>.json`），才能真实模拟
  // 「网页版把对话同步进这个文件夹」之后的样子。
  // 这两个文件在文件夹里"已经存在很久了"，但它们比本地库新 ——
  // 也就是「在网页版新建后同步进了文件夹，本机却没收到」的那两条
  '对话/20260101-120000_网页版建的对话一.json':
    JSON.stringify(mkSession('web-1', '网页版建的对话一', now - 3600e3, '网1')),
  '对话/20260101-130000_网页版建的对话二.json':
    JSON.stringify(mkSession('web-2', '网页版建的对话二', now - 3500e3, '网2')),
  // 这一条文件夹和本地一样新，不该被重复导入
  '对话/20260102-090000_本地本来就有的对话.json': JSON.stringify({
    id: 'local-only', title: '本地本来就有的对话',
    createdAt: now - 90000e3, updatedAt: now - 90000e3, rootMessageId: 'u-lo',
    messages: [{ id: 'u-lo', role: 'user', content: '本地的问题', files: [],
      createdAt: now - 90000e3, parentId: null, selectedChildId: null }]
  })
}, {
  '对话/20260101-120000_网页版建的对话一.json': T0,
  '对话/20260101-130000_网页版建的对话二.json': T0,
  '对话/20260102-090000_本地本来就有的对话.json': T0
}, T0));

const bound = await ev(`
  (async () => {
    try {
      // 关掉"收完就刷新"：无头测试里一刷新，注入的假文件夹就没了
      localStorage.setItem('chat-demo:ls-watch-noreload', 'true');
      // 扫描节奏调快，别让测试干等
      localStorage.setItem('chat-demo:ls-watch-ms', '800');
      localStorage.setItem('chat-demo:api-key', 'sk-rev');
      localStorage.setItem('chat-demo:providers', JSON.stringify([
        { id:'deepseek-official', name:'DeepSeek', baseURL:'https://api.deepseek.com',
          apiKey:'sk-rev', builtin:true, defaultModel:'deepseek-flash' }
      ]));
      localStorage.setItem('chat-demo:active-provider', 'deepseek-official');
      localStorage.setItem('chat-demo:model', 'deepseek-flash');
      // 关键：伪造"这个浏览器早就同步过"，也就是用户当前的处境。
      // 旧逻辑（maybeAutoRestoreHistory）在这里就直接放弃了，永远不再读文件夹。
      localStorage.setItem('chat-demo:history-synced-at', String(Date.now() - 86400e3));
      await window.__localstore.__setRootHandleForTest(window.__fakeRoot);
      return 'ok';
    } catch (e) { return 'ERR ' + e.message; }
  })()
`);
check('成功注入模拟文件夹', bound === 'ok', bound);

// 启动对齐：等 web-1 / web-2 被收进来
let boot = [];
for (let i = 0; i < 30; i++) {
  await sleep(500);
  boot = JSON.parse(await ev(`
    (async () => JSON.stringify((await window.__localstore.readAllSessions()).map(s => s.id)))()
  `));
  if (boot.indexOf('web-2') >= 0) break;
}
check('启动时就把文件夹里比本地新的对话收进来了（用户踩的正是这一步）',
  boot.indexOf('web-1') >= 0 && boot.indexOf('web-2') >= 0, JSON.stringify(boot));
check('本地独有的对话没有被删掉', boot.indexOf('local-only') >= 0, JSON.stringify(boot));
check('和本地一样新的对话没有被重复导入',
  boot.filter((x) => x === 'local-only').length === 1, JSON.stringify(boot));

const st0 = JSON.parse(await ev(`JSON.stringify(window.__localstore.folderWatch.state)`));
check('监看已装上并在轮询', st0.enabled === true, JSON.stringify({ enabled: st0.enabled }));
check('启动对齐已完成', st0.reconciled === true, JSON.stringify(st0));
check('扫到了 3 个会话文件', st0.fileCount === 3, 'fileCount=' + st0.fileCount);
check('扫描没有报错', !st0.lastError, String(st0.lastError));

// ---------------------------------------------------------------------------
// 外部（网页版 / 另一台机器）新增一个对话
// ---------------------------------------------------------------------------
console.log('\n[模拟] 在网页版又新建了一条对话，文件夹里出现新文件\n');
await ev(`
  (() => {
    window.__fsBucket['对话/new-1.json'] = ${JSON.stringify(
      JSON.stringify(mkSession('new-1', '网页版新建的对话', now, '新'))
    )};
    window.__touch('对话/new-1.json', ${T_NEW});
    return 'ok';
  })()
`);

// 等自动轮询把新文件收进来。
// 轮询本身是异步排程的（鼠标活动时 3s / 闲置 20s，测试里用 ls-watch-ms 覆盖成
// 800ms），所以这里给足时间；中途也手动 pump 一次，避免纯粹被排程相位拖慢。
let imported = null;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  if (i === 2 && watchMs > 0) await ev(`window.__localstore.folderWatch.poll()`);
  imported = JSON.parse(await ev(`
    (async () => JSON.stringify((await window.__localstore.readAllSessions()).map(s => s.id)))()
  `));
  if (imported.indexOf('new-1') >= 0) break;
}
check('文件夹里新出现的对话被自动收进本地库（不用手动点恢复）',
  imported.indexOf('new-1') >= 0, JSON.stringify(imported));

// 回归：外来的文件不能被快照的清理逻辑删掉。
// 这条是实测踩出来的 —— 用户「在网页版新建对话」之后，文件夹里那几个文件
// 在下一次快照时被判成「本地没有的旧文件」直接删除，表现成对话凭空消失。
const stPrune = JSON.parse(await ev(`JSON.stringify(window.__localstore.folderWatch.state.lastPrune || {})`));
check('不是本机写出的文件被保留下来了（没有被清理删掉）',
  (stPrune.keptForeign || 0) > 0 || (stPrune.removed || 0) === 0,
  JSON.stringify(stPrune));

const st1 = JSON.parse(await ev(`JSON.stringify(window.__localstore.folderWatch.state)`));
check('监看状态记录了导入条数', st1.imported >= 1,
  JSON.stringify({ imported: st1.imported, last: st1.lastImported }));

const summary = JSON.parse(await ev(`
  (async () => {
    const db = await new Promise((res) => { const rq = indexedDB.open('chat-demo'); rq.onsuccess = () => res(rq.result); });
    return JSON.stringify(await new Promise((res) => {
      const tx = db.transaction('sessionSummaries', 'readonly');
      const rq = tx.objectStore('sessionSummaries').getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => res([]);
    }));
  })()
`));
check('会话摘要也一起补齐了（侧栏靠它显示）',
  summary.some((s) => s.id === 'new-1' && s.title === '网页版新建的对话'),
  JSON.stringify(summary.map((s) => s.title)));

// ---------------------------------------------------------------------------
// 第二轮：同一个文件被外部改过，内容更新，应该再收一次
// ---------------------------------------------------------------------------
console.log('\n[模拟] 外部把刚才那条对话改了（updatedAt 变新）\n');
// 先确认第一轮的收尾（收进来后的写回）已经落定，否则会跟它抢
const importBase = JSON.parse(await ev(`String(window.__localstore.folderWatch.state.imported)`));
await ev(`
  (() => {
    const s = ${JSON.stringify(JSON.stringify(mkSession('new-1', '网页版改过标题的对话', now + 300000, '改')))};
    window.__fsBucket['对话/new-1.json'] = s;
    window.__touch('对话/new-1.json', ${T_NEW + 120000});
    return 'ok';
  })()
`);
let title = null;
let titleImported = false;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  if (i === 3) await ev(`window.__localstore.folderWatch.poll()`);
  title = await ev(`
    (async () => { const all = await window.__localstore.readAllSessions();
      const s = all.find(x => x.id === 'new-1'); return s ? s.title : null; })()
  `);
  const imp = JSON.parse(await ev(`String(window.__localstore.folderWatch.state.imported)`));
  titleImported = imp > importBase;
  if (title === '网页版改过标题的对话') break;
}
check('外部修改过的对话会被再次收进来', title === '网页版改过标题的对话',
  JSON.stringify({ title: title, 导入计数增加: titleImported }));

// ---------------------------------------------------------------------------
// 第三轮：内容没变、只是被整体重写一遍 → 不能反复导入
// ---------------------------------------------------------------------------
console.log('\n[模拟] 文件夹里的文件被重写但内容没变\n');
const importedBefore = JSON.parse(await ev(`String(window.__localstore.folderWatch.state.imported)`));
await ev(`
  (() => {
    // 内容原样不动，只把 lastModified 改掉（模拟"整目录重写一遍"）
    window.__touch('对话/web-1.json', ${T_NEW + 500000});
    window.__touch('对话/local-only.json', ${T_NEW + 500000});
    return 'ok';
  })()
`);
await sleep(4000);
const importedAfter = JSON.parse(await ev(`String(window.__localstore.folderWatch.state.imported)`));
check('内容没变的重写不会被误判成新对话', importedAfter === importedBefore,
  JSON.stringify({ before: importedBefore, after: importedAfter }));

// ---------------------------------------------------------------------------
// 第四轮：本地更新的内容不能被文件夹里的旧文件盖回去
// ---------------------------------------------------------------------------
console.log('\n[模拟] 本地比文件夹新 → 不能反向覆盖\n');
await ev(`
  (async () => {
    const db = await new Promise((res) => { const rq = indexedDB.open('chat-demo'); rq.onsuccess = () => res(rq.result); });
    const all = await window.__localstore.readAllSessions();
    const s = all.find(x => x.id === 'new-1');
    s.title = '本地更新过的标题';
    s.updatedAt = Date.now() + 999999999;   // 比文件夹里的新很多
    await new Promise((res) => {
      const tx = db.transaction(['sessions','sessionSummaries'], 'readwrite');
      tx.objectStore('sessions').put(s);
      tx.objectStore('sessionSummaries').put({ id: s.id, title: s.title, createdAt: s.createdAt,
        updatedAt: s.updatedAt, fileIds: [] });
      tx.oncomplete = () => res();
    });
    // 文件夹里那个文件"动一下"，触发一次扫描
    window.__touch('对话/new-1.json', ${T_NEW + 900000});
    return 'ok';
  })()
`);
await sleep(5000);
const afterLocal = await ev(`
  (async () => { const all = await window.__localstore.readAllSessions();
    const s = all.find(x => x.id === 'new-1'); return s ? s.title : null; })()
`);
check('本地更新的对话没有被文件夹里的旧版本盖掉', afterLocal === '本地更新过的标题', String(afterLocal));

// ---------------------------------------------------------------------------
// 关掉开关后不再轮询
// ---------------------------------------------------------------------------
console.log('\n[模拟] 关掉监看开关\n');
await ev(`
  (() => { localStorage.setItem('chat-demo:local-watch', 'false');
    window.__localstore.folderWatch.stop(); return 'ok'; })()
`);
const st2 = JSON.parse(await ev(`JSON.stringify(window.__localstore.folderWatch.state)`));
const scansBefore = st2.lastScan;
await sleep(4000);
const st3 = JSON.parse(await ev(`JSON.stringify(window.__localstore.folderWatch.state)`));
check('停掉之后不再扫描', st3.lastScan === scansBefore,
  JSON.stringify({ before: scansBefore, after: st3.lastScan }));

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败\n');

try { cdp.removeAllListeners(); } catch (e) { /* ignore */ }
try { cdp.close(); } catch (e) { /* ignore */ }
try { spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { chrome.kill(); }
await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.close();
process.exit(fail ? 1 : 0);
