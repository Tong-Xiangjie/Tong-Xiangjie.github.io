/**
 * 跨浏览器同步专项测试。
 *
 * 模拟方式：用两个**完全独立的浏览器配置**（等价于两个浏览器 / 清空数据后的新
 * 浏览器），各自注入同一个「共享文件夹」的内容。因为模拟文件系统是纯内存的，
 * 由测试脚本在两边灌入同一份初始内容，并在两端各自读回结果。
 *
 * 覆盖三件事：
 *   1. 浏览器 A 写入 → 文件夹里确实有对话与设置
 *   2. 浏览器 B（全新，无同步标记）能自动恢复设置
 *   3. 浏览器 B 能主动「从文件夹恢复」把对话读回来
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
const PORT = 8897;
const CDP_PORT = 9387;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const DIR_NAME = '跨浏览器测试存档';

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 等一个调试端口真正空出来。
 *
 * 为什么需要：Chrome 被 kill 之后，端口不会立刻释放，而 fetchPageTarget
 * 是「连上就返回」。如果沿用固定端口，下一个实例很可能连到**上一个正在退出**
 * 的 Chrome 上，于是脚本刚跑几步就报「WebSocket 已关闭」。
 */
function waitFreePort(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host: '127.0.0.1', port });
      const done = (free) => {
        sock.destroy();
        if (free) return resolve(port);
        if (Date.now() > deadline) {
          return reject(new Error(`端口 ${port} 一直没空出来`));
        }
        setTimeout(attempt, 250);
      };
      sock.once('connect', () => done(false)); // 连得上 = 还被占用
      sock.once('error', () => done(true)); // 连不上 = 空了
      sock.setTimeout(1000, () => done(false));
    };
    attempt();
  });
}

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
};

/** 生成一段「注入模拟文件夹 + 用指定初始内容」的页面脚本 */
function fsSetupScript(initialBucket) {
  return `
    (() => {
      const bucket = ${JSON.stringify(initialBucket)};
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
  `;
}

async function launch(label, initialBucket) {
  const profile = mkdtempSync(join(tmpdir(), 'cdp-xb-' + label + '-'));
  // 每个实例等端口空出来再用，避免连到上一个正在退出的 Chrome
  const cdpPort = await waitFreePort(CDP_PORT);
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
     '--no-first-run', '--window-size=1400,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
  const target = await fetchPageTarget(cdpPort);
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  // 记录非预期的页面导航：正常情况下这几个用例全程都不该刷新页面
  cdp.on('Page.frameNavigated', () => {
    console.log(`    [${label}] 注意：页面发生了导航`);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await sleep(2800);
  const ev = (e) => cdp.evaluate(e);

  await ev(fsSetupScript(initialBucket));
  // 把假句柄装进桥接层（等价于用户点了「选择文件夹」并授权）
  //
  // ⚠ 这里先关掉**反向同步**（文件夹 → 应用的自动收编）。
  // 本套件测的是**手动**路径：hydrateSettingsFromFolder / restoreFromFolder /
  // snapshot。自动收编由 e2e-reverse-sync.mjs 专测。
  // 不关的话后果不只是"多收了几条"：自动收编收完会 location.reload()，
  // 页面一刷新注入的假文件夹就没了，后面的用例会以
  // 「Cannot read properties of undefined (reading 'autoRestoreAfterConnect')」
  // 这种完全看不出原因的方式挂掉。
  await ev(`localStorage.setItem('chat-demo:local-watch', 'false')`);
  const bound = await ev(`
    (async () => {
      try {
        await window.__localstore.__setRootHandleForTest(window.__fakeRoot);
        return 'ok';
      } catch (e) { return 'ERR ' + e.message; }
    })()
  `);
  return {
    cdp, chrome, profile, ev, bound,
    close: async () => {
      // 注意：不要用 removeListener/off 传 undefined —— 那会抛
      // ERR_INVALID_ARG_TYPE。removeAllListeners 才是安全的整体清理。
      if (typeof cdp.removeAllListeners === 'function') cdp.removeAllListeners();
      try { cdp.close(); } catch (e) { /* 已关就忽略 */ }
      // 只杀这一棵进程树：不加 detached 时 taskkill /T 由 pid 定位，
      // 避免误伤其它仍在运行的测试浏览器实例。
      try {
        spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch (e) {
        try { chrome.kill(); } catch (e2) { /* ignore */ }
      }
      await sleep(400);
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    }
  };
}

console.log('\n=== 跨浏览器同步测试 ===\n');

// ---------------------------------------------------------------------------
// 步骤 1：浏览器 A 里造一条对话，然后同步到文件夹
// ---------------------------------------------------------------------------
console.log('[1] 浏览器 A：写入并同步');
const A = await launch('a', {});
check('A 成功连接文件夹', A.bound === 'ok', A.bound);

const aRaw = await A.ev(`
  (async () => {
    try {
      const now = Date.now();
      const sess = {
        id: 'xb-session-1', title: '跨浏览器会话', createdAt: now, updatedAt: now,
        rootMessageId: 'u1',
        messages: [
          { id: 'u1', role: 'user', content: '跨浏览器的问题', files: [], createdAt: now, parentId: null, selectedChildId: 'a1' },
          { id: 'a1', role: 'assistant', createdAt: now + 1, parentId: 'u1', selectedChildId: null,
            model: 'deepseek-v4-pro', status: 'done', blocks: [{ type: 'text', text: '跨浏览器的回答' }] }
        ]
      };
      const db = await new Promise((res, rej) => {
        const rq = indexedDB.open('chat-demo');
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
      await new Promise((res, rej) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(sess);
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
      });
      db.close();

      localStorage.setItem('chat-demo:locale', 'en-US');
      localStorage.setItem('chat-demo:thinking', 'true');

      const r = await window.__localstore.snapshot('test');
      const bucket = window.__fsBucket;
      return JSON.stringify({
        snapshotRaw: r === undefined ? 'undefined' : JSON.stringify(r).slice(0, 200),
        bucketKeys: Object.keys(bucket),
        keys: Object.keys(bucket).filter((k) => !k.endsWith('/')),
        settingsFile: bucket['数据/settings.json'] ? JSON.parse(bucket['数据/settings.json']) : null
      });
    } catch (e) {
      return 'ERR ' + (e && e.message ? e.message : String(e));
    }
  })()
`);
console.log('    raw: ' + String(aRaw).slice(0, 300));
const aWrote = String(aRaw).startsWith('ERR') ? {} : JSON.parse(aRaw);
check('快照执行没有报错', !String(aRaw).startsWith('ERR'), String(aRaw).slice(0, 200));

check('快照写入了文件夹（不再为空）', aWrote.keys.length > 0, JSON.stringify(aWrote.bucketKeys));
check(
  'settings.json 内含语言偏好',
  aWrote.settingsFile && aWrote.settingsFile.settings['chat-demo:locale'] === 'en-US',
  JSON.stringify(aWrote.settingsFile && aWrote.settingsFile.settings)
);
check('文件夹里生成了对话文件', aWrote.keys.some((k) => k.startsWith('对话/') && k.endsWith('.md')), JSON.stringify(aWrote.keys));
check('文件夹里生成了 settings.json', !!aWrote.settingsFile, JSON.stringify(aWrote.keys));
check('settings.json 不含密钥', aWrote.settingsFile ? !Object.keys(aWrote.settingsFile.settings).some((k) => /api-key/.test(k)) : false,
  JSON.stringify(aWrote.settingsFile && Object.keys(aWrote.settingsFile.settings)));

// ---------------------------------------------------------------------------
// 各提供方的 Key 也必须跨浏览器带走。
// 官方只有一个 Key 槽位，自定义提供方的 Key 存在 chat-demo:providers 里；
// settings.json 明确不含密钥，所以它们只能由 apikey.json 承担。
// ---------------------------------------------------------------------------
console.log('\n[1c] 自定义提供方的 Key 跨浏览器同步');
const provKeyRaw = await A.ev(`
  (async () => {
    try {
      const L = window.__localstore;
      // 造一个带 Key 的自定义提供方（走真实的新增接口）
      const newId = L.addProvider({
        id: 'custom-relay',
        name: '中转站', baseURL: 'https://relay.example.com',
        apiKey: 'sk-relay-secret', models: ['relay-model'], defaultModel: 'relay-model',
        availableModels: ['relay-model']
      });
      L.setActiveProvider('custom-relay');
      localStorage.setItem('chat-demo:api-key', 'sk-official-secret');
      localStorage.setItem('chat-demo:local-key', '1');   // 打开「Key 存到文件夹」
      await L.snapshot('key-sync');

      const bucket = window.__fsBucket;
      const file = bucket['数据/apikey.json'] ? JSON.parse(bucket['数据/apikey.json']) : null;
      return JSON.stringify({
        fileExists: !!file,
        schema: file ? file.schema : null,
        apiKey: file ? file.apiKey : null,
        providerKeys: file ? file.providerKeys : null
      });
    } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
  })()
`);
console.log('    raw: ' + String(provKeyRaw).slice(0, 300));
const provKeyWritten = String(provKeyRaw).startsWith('ERR') ? { error: provKeyRaw } : JSON.parse(provKeyRaw);
console.log('    apikey.json: ' + JSON.stringify(provKeyWritten));
check('apikey.json 已写出', provKeyWritten.fileExists === true, JSON.stringify(provKeyWritten));
check('带上了自定义提供方的 Key',
  provKeyWritten.providerKeys && provKeyWritten.providerKeys['custom-relay'] === 'sk-relay-secret',
  JSON.stringify(provKeyWritten.providerKeys));
check('也带上了官方那一个 Key', provKeyWritten.apiKey === 'sk-official-secret', String(provKeyWritten.apiKey));

// 把最新文件夹内容作为 C 的初始内容（模拟「同一个文件夹」），
// 并在关掉 A **之前**把它的内容取出来 —— 关掉实例后就再也读不到了。
const sharedBucket2 = JSON.parse(await A.ev(`JSON.stringify(window.__fsBucket)`));
await A.close();

const C = await launch('c', sharedBucket2);
check('C 成功连接同一文件夹', C.bound === 'ok', C.bound);

const cRestoredRaw = await C.ev(`
  (async () => {
    try {
      const L = window.__localstore;
      // C 是全新浏览器：先恢复设置（拿到提供方列表），再恢复密钥
      await L.hydrateSettingsFromFolder();
      await L.hydrateKeyFromFolder();
      const p = L.getProviders().list.find((x) => x.id === 'custom-relay');
      return JSON.stringify({
        providerPresent: !!p,
        providerKey: p ? p.apiKey : null,
        officialKey: localStorage.getItem('chat-demo:api-key')
      });
    } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
  })()
`);
console.log('    raw: ' + String(cRestoredRaw).slice(0, 300));
const cRestored = String(cRestoredRaw).startsWith('ERR') ? { error: cRestoredRaw } : JSON.parse(cRestoredRaw);
console.log('    C 恢复后: ' + JSON.stringify(cRestored));
check('C 拿到了自定义提供方', cRestored.providerPresent === true, JSON.stringify(cRestored));
check('C 拿到了自定义提供方的 Key', cRestored.providerKey === 'sk-relay-secret', JSON.stringify(cRestored));
// A 的「当前生效提供方」是 custom-relay，所以官方槽位里镜像的就是它的 Key
// —— 这是正确的，应用发请求时读的正是这个槽位。
check('C 的官方 Key 槽位与当前生效提供方一致',
  cRestored.officialKey === 'sk-relay-secret', JSON.stringify(cRestored));
await C.close();

// ---------------------------------------------------------------------------
// 步骤 2：浏览器 B（全新）—— 应自动恢复设置、并能恢复对话
// ---------------------------------------------------------------------------
console.log('\n[2] 浏览器 B（全新）：自动恢复设置');
const B = await launch('b', sharedBucket2);
check('B 成功连接同一文件夹', B.bound === 'ok', B.bound);

// B 是全新浏览器，应该没有同步标记
const bBefore = JSON.parse(await B.ev(`
  JSON.stringify((() => ({
    syncedAt: localStorage.getItem('chat-demo:settings-synced-at'),
    locale: localStorage.getItem('chat-demo:locale')
  }))())
`));

const bHydratedRaw = await B.ev(`
  (async () => {
    try {
      const L = window.__localstore;
      const restored = await L.hydrateSettingsFromFolder();
      return JSON.stringify({
        restored: restored,
        locale: localStorage.getItem('chat-demo:locale'),
        thinking: localStorage.getItem('chat-demo:thinking'),
        syncedAt: localStorage.getItem('chat-demo:settings-synced-at')
      });
    } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
  })()
`);
console.log('    raw: ' + String(bHydratedRaw).slice(0, 200));
const bHydrated = String(bHydratedRaw).startsWith('ERR') ? { error: bHydratedRaw } : JSON.parse(bHydratedRaw);
check('B 的自动恢复被触发（这是修好的关键点）', bHydrated.restored === true, JSON.stringify(bHydrated));check('B 恢复了语言偏好 en-US', bHydrated.locale === 'en-US', JSON.stringify(bHydrated));
check('B 恢复了思考开关', bHydrated.thinking === 'true', JSON.stringify(bHydrated));
check('B 写下了同步时间戳', !!bHydrated.syncedAt, JSON.stringify(bHydrated));

// 已同步过、且文件夹不比本地新 → 不应重复覆盖
const bSecondRaw = await B.ev(`
  (async () => {
    try {
      localStorage.setItem('chat-demo:locale', 'zh-CN');
      const r = await window.__localstore.hydrateSettingsFromFolder();
      return JSON.stringify({ restoredAgain: r, locale: localStorage.getItem('chat-demo:locale') });
    } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
  })()
`);
const bSecond = String(bSecondRaw).startsWith('ERR') ? { error: bSecondRaw } : JSON.parse(bSecondRaw);
check('本地更新时不覆盖用户的选择', bSecond.restoredAgain === false && bSecond.locale === 'zh-CN', JSON.stringify(bSecond));

// 文件夹更新了 → 应采纳
const bNewerRaw = await B.ev(`
  (async () => {
    try {
      const bucket = window.__fsBucket;
      const f = JSON.parse(bucket['数据/settings.json']);
      f.settings['chat-demo:locale'] = 'en-US';
      f.savedAt = Date.now() + 60000;
      bucket['数据/settings.json'] = JSON.stringify(f);
      const r = await window.__localstore.hydrateSettingsFromFolder();
      return JSON.stringify({ restored: r, locale: localStorage.getItem('chat-demo:locale') });
    } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
  })()
`);
const bNewer = String(bNewerRaw).startsWith('ERR') ? { error: bNewerRaw } : JSON.parse(bNewerRaw);
check('文件夹更新后采纳较新的设置', bNewer.restored === true && bNewer.locale === 'en-US', JSON.stringify(bNewer));

console.log('\n[3] 浏览器 B：恢复对话记录');
const bRestoreRaw = await B.ev(`
  (async () => {
    try {
      const L = window.__localstore;
      const readCount = async () => {
        const db = await new Promise((res, rej) => {
          const rq = indexedDB.open('chat-demo');
          rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
        });
        const n = await new Promise((res) => {
          const tx = db.transaction('sessions', 'readonly');
          const rq = tx.objectStore('sessions').count();
          rq.onsuccess = () => res(rq.result); rq.onerror = () => res(-1);
        });
        db.close();
        return n;
      };
      const before = await readCount();
      let res = null, err = null;
      try { res = await L.restoreFromFolder(); } catch (e) { err = String(e.message); }
      const after = await readCount();

      const db = await new Promise((res2, rej) => {
        const rq = indexedDB.open('chat-demo');
        rq.onsuccess = () => res2(rq.result); rq.onerror = () => rej(rq.error);
      });
      const sess = await new Promise((res2) => {
        const tx = db.transaction('sessions', 'readonly');
        const rq = tx.objectStore('sessions').get('xb-session-1');
        rq.onsuccess = () => res2(rq.result); rq.onerror = () => res2(null);
      });
      db.close();
      const asst = sess && sess.messages ? sess.messages.find((m) => m.role === 'assistant') : null;
      return JSON.stringify({
        before: before, after: after, err: err, restored: res,
        title: sess ? sess.title : null,
        model: asst ? asst.model : null,
        text: asst && asst.blocks ? (asst.blocks[0] || {}).text : null
      });
    } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
  })()
`);
console.log('    raw: ' + String(bRestoreRaw).slice(0, 300));
const bRestore = String(bRestoreRaw).startsWith('ERR') ? { error: bRestoreRaw } : JSON.parse(bRestoreRaw);
check('B 原本没有这条对话', bRestore.before === 0, JSON.stringify(bRestore));
check('从文件夹恢复成功', !bRestore.err && bRestore.after === 1, JSON.stringify(bRestore));
check('恢复后标题正确', bRestore.title === '跨浏览器会话', String(bRestore.title));
check('恢复后模型名保留', bRestore.model === 'deepseek-v4-pro', String(bRestore.model));
check('恢复后正文完整', bRestore.text === '跨浏览器的回答', String(bRestore.text));

console.log('\n[4] 安全闸门：全新浏览器不会清空文件夹里的存档');
const bGuardRaw = await B.ev(`
  (async () => {
    try {
      const L = window.__localstore;
      // 造出「刚清空过数据」的状态：本地库空、且没有历史同步标记
      const db = await new Promise((res, rej) => {
        const rq = indexedDB.open('chat-demo');
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
      await new Promise((res) => {
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').clear();
        tx.oncomplete = () => res(); tx.onerror = () => res();
      });
      db.close();
      localStorage.removeItem('chat-demo:history-synced-at');

      const before = Object.keys(window.__fsBucket).filter((k) => k.startsWith('对话/') && k.endsWith('.md'));
      const r = await L.snapshot('guard-test');
      const after = Object.keys(window.__fsBucket).filter((k) => k.startsWith('对话/') && k.endsWith('.md'));
      const manifest = window.__fsBucket['数据/manifest.json'] ? JSON.parse(window.__fsBucket['数据/manifest.json']) : null;
      return JSON.stringify({
        beforeCount: before.length, afterCount: after.length,
        pruneSkipped: manifest ? manifest.pruneSkipped : null,
        removed: r ? r.removed : null
      });
    } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
  })()
`);
console.log('    raw: ' + String(bGuardRaw).slice(0, 240));
const bGuard = String(bGuardRaw).startsWith('ERR') ? { error: bGuardRaw } : JSON.parse(bGuardRaw);
check('快照前文件夹里有存档', bGuard.beforeCount > 0, JSON.stringify(bGuard));
check('空库快照没有删掉文件夹里的对话（防丢失闸门生效）', bGuard.afterCount === bGuard.beforeCount, JSON.stringify(bGuard));
check('manifest 标记了跳过清理', bGuard.pruneSkipped === true, JSON.stringify(bGuard));

console.log('\n[5] 全新浏览器自动把对话读回来');
const bAutoRaw = await B.ev(`
  (async () => {
    try {
      const L = window.__localstore;
      // 仍是空库 + 无标记的状态
      const restored = await L.autoRestoreAfterConnect();
      const db = await new Promise((res, rej) => {
        const rq = indexedDB.open('chat-demo');
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
      const n = await new Promise((res) => {
        const tx = db.transaction('sessions', 'readonly');
        const rq = tx.objectStore('sessions').count();
        rq.onsuccess = () => res(rq.result); rq.onerror = () => res(-1);
      });
      db.close();
      return JSON.stringify({
        restored: restored, localCount: n,
        marker: !!localStorage.getItem('chat-demo:history-synced-at')
      });
    } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
  })()
`);
console.log('    raw: ' + String(bAutoRaw).slice(0, 240));
const bAuto = String(bAutoRaw).startsWith('ERR') ? { error: bAutoRaw } : JSON.parse(bAutoRaw);
check('自动恢复被触发', bAuto.restored === true, JSON.stringify(bAuto));
check('对话已回到本地库', bAuto.localCount === 1, JSON.stringify(bAuto));
check('写下了历史同步标记', bAuto.marker === true, JSON.stringify(bAuto));

// 第二次不应重复恢复（避免反复写库）
const bAuto2Raw = await B.ev(`
  (async () => {
    try {
      return JSON.stringify({ restored: await window.__localstore.autoRestoreAfterConnect() });
    } catch (e) { return 'ERR ' + e.message; }
  })()
`);
const bAuto2 = String(bAuto2Raw).startsWith('ERR') ? { error: bAuto2Raw } : JSON.parse(bAuto2Raw);
check('已有数据时不会重复自动恢复', bAuto2.restored === false, JSON.stringify(bAuto2));

await B.close();

console.log('\n' + '='.repeat(46));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(46) + '\n');

server.close();
process.exit(fail ? 1 : 0);
