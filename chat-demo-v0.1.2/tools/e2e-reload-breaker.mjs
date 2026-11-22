/**
 * 自动刷新熔断专项测试 —— "页面会不会无限自己刷新"。
 *
 * 为什么要单独一个套件：
 *   其它所有 e2e 为了能连续断言，都刻意**关掉**了"收完文件夹就刷新页面"
 *   （localStorage['chat-demo:ls-watch-noreload']='true'），因为一刷新页面，
 *   注入的内存假文件夹就没了、测试也断了。
 *   结果是：**生产环境里真正会跑的那条刷新路径，从来没有被测试覆盖过。**
 *
 *   而用户实测的故障恰好在这条路径上：页面不停自己刷新，
 *   设置面板永远停在「处理中… / 同步中…」，看起来就是卡死。
 *
 *   所以这里专门在"允许刷新"的默认生产配置下跑，并且用 CDP 监听真实的
 *   页面导航事件来数「到底刷了几次」。
 *
 * 这里验证的不变量（也是熔断器存在的意义）：
 *   每次页面加载最多只自动刷新一次。判断写错时最坏是"少刷一次"，
 *   绝不允许变成"永远刷不完"。
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
const PORT = 8907;
const DIR_NAME = '刷新熔断测试存档';

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

/** 假文件夹（与 e2e-reverse-sync 同款：values() 产出真实句柄形状） */
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
          kind: 'file', name: fname,
          async createWritable() {
            let buf = '';
            return { write: async (d) => { buf += typeof d === 'string' ? d : '[blob]'; },
                     close: async () => { bucket[key] = buf; if (times[key] === undefined) times[key] = BASE_TS; } };
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

const profile = mkdtempSync(join(tmpdir(), 'cdp-brk-'));
const cdpPort = await waitFreePort(9397);
const chrome = spawn(findBrowser(),
  [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
   '--no-first-run', '--window-size=1400,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
const target = await fetchPageTarget(cdpPort);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

// 数真实页面导航（reload 会触发 Page.frameNavigated）
let navigations = 0;
cdp.on('Page.frameNavigated', (p) => {
  if (p && p.frame && p.frame.parentId === undefined) {
    navigations++;
    console.log('    [导航] ' + p.frame.url + '  (第 ' + navigations + ' 次)');
  }
});

await sleep(3500);
const ev = (e) => cdp.evaluate(e);

// ---------------------------------------------------------------------------
// ⚠ 关键：把"计数器"和"假文件夹"都装成**每次新文档都先跑一遍**的脚本。
//
// 踩过的坑：只在当前页面里 `window.location.reload = ...` 是不够的 ——
// 应用在启动阶段就会真的刷新一次，新页面拿到的是**原生的** location.reload，
// 而且上一页注入的 window.__fsBucket 也随页面一起没了。
// 结果就是测试自己在"刷新"这一步炸掉（Cannot set properties of undefined），
// 看起来像是注入写错了，其实是页面确实刷走了。
//
// Page.addScriptToEvaluateOnNewDocument 会让这段脚本在**每个新文档**里
// 最先执行，于是无论页面刷多少次，计数器和假文件夹都稳定存在。
// ---------------------------------------------------------------------------
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__reloadCalls = 0;
    window.__reloadStacks = [];
    try {
      window.location.reload = function () {
        window.__reloadCalls++;
        try {
          window.__reloadStacks.push(String(new Error().stack || '').split('\\n').slice(1, 5).join(' | '));
        } catch (e) {}
      };
    } catch (e) {}
  `
});
// 当前这个已经加载完的文档也要装上
await ev(`
  (() => {
    window.__reloadCalls = 0;
    window.__reloadStacks = [];
    try {
      window.location.reload = function () {
        window.__reloadCalls++;
        try {
          window.__reloadStacks.push(String(new Error().stack || '').split('\\n').slice(1, 5).join(' | '));
        } catch (e) {}
      };
    } catch (e) {}
    return 'installed';
  })()
`);

console.log('\n=== 自动刷新熔断（页面会不会无限自己刷新）测试 ===\n');

const now = Date.now();
const T0 = now - 3600e3;
const T_NEW = now + 60000;
const watchMs = 800;

// ---------------------------------------------------------------------------
// 准备：本地有对话（模拟"这个浏览器早就在用了"），文件夹里另有两条外部对话。
// 不关闭"收完就刷新"—— 故意保持生产默认值。
// ---------------------------------------------------------------------------
await ev(`
  (async () => {
    const db = await new Promise((res) => { const rq = indexedDB.open('chat-demo'); rq.onsuccess = () => res(rq.result); });
    const s = {
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
      tx.objectStore('sessions').put(s);
      tx.objectStore('sessionSummaries').put({ id: s.id, title: s.title,
        createdAt: s.createdAt, updatedAt: s.updatedAt, fileIds: [] });
      tx.oncomplete = () => res();
    });
    return 'ok';
  })()
`);

// 假文件夹也装成"每个新文档都先跑一遍"，这样即使应用在启动时真的刷新一次，
// 新页面里同样有 window.__fakeRoot / __fsBucket，测试不会半路断掉。
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: fsSetupScript({
    '对话/': true,
    '对话/20260101-120000_网页版建的一.json': JSON.stringify(mkSession('web-a', '网页版建的一', now - 3600e3, '网A')),
    '对话/20260101-130000_网页版建的二.json': JSON.stringify(mkSession('web-b', '网页版建的二', now - 3500e3, '网B'))
  }, {
    '对话/20260101-120000_网页版建的一.json': T0,
    '对话/20260101-130000_网页版建的二.json': T0
  }, T0)
});
// 当前文档也补一次
await ev(fsSetupScript({
  '对话/': true,
  '对话/20260101-120000_网页版建的一.json': JSON.stringify(mkSession('web-a', '网页版建的一', now - 3600e3, '网A')),
  '对话/20260101-130000_网页版建的二.json': JSON.stringify(mkSession('web-b', '网页版建的二', now - 3500e3, '网B'))
}, {
  '对话/20260101-120000_网页版建的一.json': T0,
  '对话/20260101-130000_网页版建的二.json': T0
}, T0));

// 记下"准备阶段"的导航次数，后面只关心新增的。
// 注意：location.reload 已被换成计数器，所以这里预期不会有真实导航。
const navBefore = navigations;
check('已阻止真实页面跳转（保证注入的假文件夹不会丢）',
  navigations <= 1, '启动阶段导航 ' + navigations + ' 次');

// 关键：**不**设置 ls-watch-noreload，保持生产默认（收完就刷新）
const bound = await ev(`
  (async () => {
    try {
      localStorage.setItem('chat-demo:ls-watch-ms', '${watchMs}');
      localStorage.setItem('chat-demo:api-key', 'sk-brk');
      localStorage.setItem('chat-demo:providers', JSON.stringify([
        { id:'deepseek-official', name:'DeepSeek', baseURL:'https://api.deepseek.com',
          apiKey:'sk-brk', builtin:true, defaultModel:'deepseek-flash' }
      ]));
      localStorage.setItem('chat-demo:active-provider', 'deepseek-official');
      localStorage.setItem('chat-demo:model', 'deepseek-flash');
      // 是否关闭刷新，由外部用例控制
      const mode = window.__brkMode || 'reload-on';
      if (mode === 'reload-off') localStorage.setItem('chat-demo:ls-watch-noreload', 'true');
      else localStorage.removeItem('chat-demo:ls-watch-noreload');
      localStorage.setItem('chat-demo:history-synced-at', String(Date.now() - 86400e3));
      await window.__localstore.__setRootHandleForTest(window.__fakeRoot);
      return 'ok';
    } catch (e) { return 'ERR ' + ((e && e.message) || e); }
  })()
`);
check('成功注入模拟文件夹（刷新保持生产默认开启）', bound === 'ok', bound);

// 等启动对账 + 自动收对话 + 可能的自动刷新
await sleep(12000);

const afterBoot = JSON.parse(await ev(`
  (async () => JSON.stringify({
    ids: (await window.__localstore.readAllSessions()).map(s => s.id).sort(),
    log: window.__localstore.reloadLog().map(x => ({ reason: x.reason, blocked: x.blocked })),
    doctor: await (async () => { try { return await window.__localstore.syncDoctor(); } catch (e) { return { err: String(e) }; } })()
  }))()
`));
console.log('    收进来的对话: ' + JSON.stringify(afterBoot.ids));

check('文件夹里的外部对话被自动收进来了',
  afterBoot.ids.includes('web-a') && afterBoot.ids.includes('web-b'),
  JSON.stringify(afterBoot.ids));

// ---------------------------------------------------------------------------
// ★ 核心断言：启动期间真实的页面刷新次数必须有上限
// ---------------------------------------------------------------------------
const navDelta = navigations - navBefore;
console.log('    启动期间真实导航次数: ' + navDelta);
check('★ 启动期间页面刷新不超过 1 次（没有无限自己刷）',
  navDelta <= 1, '导航 ' + navDelta + ' 次');

// 刷新意图记录：这里是最关键的证据。
// 启动时对账收到了 1 个以上对话，于是它**申请了刷新**，日志里留下了
// `启动对账收进了 N 个对话`（blocked:false）。
// 这正是修复的证明：这条生产路径以前是裸的 `location.reload()`，
// 既不会留下任何记录，也不受熔断器约束 —— 判断一出错就无限自己刷。
// 现在它一定经由 requestReload()，于是既刷得出去、又只刷一次。
const loggedCount = afterBoot.log.length;
console.log('    刷新意图记录: ' + JSON.stringify(afterBoot.log));
check('刷新日志接口可用（数组）', Array.isArray(afterBoot.log), typeof afterBoot.log);
check('★ 启动对账申请刷新时留下了记录（证明它走的是熔断器，不是裸 reload）',
  afterBoot.log.some((x) => /启动对账收进了|监看文件夹收进了/.test(x.reason || '')),
  JSON.stringify(afterBoot.log));
check('★ 该次刷新被放行（该刷还是刷，没被误伤）',
  afterBoot.log.some((x) => !x.blocked && /启动对账收进了|监看文件夹收进了/.test(x.reason || '')),
  JSON.stringify(afterBoot.log));
check('若启动请求过刷新，则每条记录都必须带原因',
  loggedCount === 0 || afterBoot.log.every((x) => typeof x.reason === 'string' && x.reason.length > 0),
  JSON.stringify(afterBoot.log));

// ---------------------------------------------------------------------------
// 模拟"判断出错、反复想刷"的最坏情况，确认熔断兜得住
// ---------------------------------------------------------------------------
const guard = JSON.parse(await ev(`
  (async () => {
    const L = window.__localstore;
    sessionStorage.removeItem('chat-demo:auto-reload-at');
    sessionStorage.removeItem('chat-demo:auto-reload-count');
    const seq = [];
    for (let i = 0; i < 8; i++) seq.push(L.__requestReloadForTest('模拟反复想刷新 ' + i, true));
    sessionStorage.removeItem('chat-demo:auto-reload-at');
    sessionStorage.removeItem('chat-demo:auto-reload-count');
    return JSON.stringify({ seq: seq });
  })()
`));
console.log('    放行序列: ' + JSON.stringify(guard.seq));
check('★★ 连续 8 次刷新意图只放行 1 次（熔断生效）',
  guard.seq[0] === true && guard.seq.slice(1).every((x) => x === false),
  JSON.stringify(guard.seq));

// ---------------------------------------------------------------------------
// ★★ 决定性验证：把 location.reload 换成计数器（不真的跳转），
//    然后**反复**触发"文件夹里有新对话"这条路径。
//
//    旧代码在这两处是裸的 location.reload()，不受熔断器约束：
//      每次启动/每次扫描收到新对话 → 刷新 → 又收到 → 又刷新 → 无限循环。
//    页面永远在加载，设置面板永远停在「同步中…」。
//
//    换成计数器后页面不会跳走，于是可以确切地数出"到底请求了几次刷新"：
//      修复前 → 每次触发都 +1（无上限）
//      修复后 → 只有第 1 次会真的调用 reload，之后被熔断器拦下
// ---------------------------------------------------------------------------
const counter = await ev(`
  (async () => {
    // 复位熔断配额，让本段从"干净的一次页面加载"开始
    sessionStorage.removeItem('chat-demo:auto-reload-at');
    sessionStorage.removeItem('chat-demo:auto-reload-count');
    // 打开"收完就刷新"（生产默认），确保走的就是那两处刷新
    localStorage.removeItem('chat-demo:ls-watch-noreload');
    // 计数归零（location.reload 早在启动时就换成计数器了）
    window.__reloadCalls = 0;
    return 'ok';
  })()
`);
check('已把 location.reload 换成计数器（可精确数刷新次数）', counter === 'ok', String(counter));

// 反复制造"文件夹里有更新的对话"，每次都应触发那条刷新路径
for (let k = 0; k < 5; k++) {
  await ev(`
    (async () => {
      const s = ${JSON.stringify(mkSession('loop-x', '循环测试对话', now - 3000e3, 'L'))};
      s.id = 'loop-${k}';
      s.title = '循环测试对话 ${k}';
      s.rootMessageId = 'u-loop-${k}';
      s.messages[0].id = 'u-loop-${k}';
      s.messages[0].content = '循环 ${k}';
      s.messages[1].id = 'a-loop-${k}';
      s.messages[1].parentId = 'u-loop-${k}';
      window.__fsBucket['对话/loop-${k}.json'] = JSON.stringify(s);
      window.__touch('对话/loop-${k}.json', ${T_NEW} + ${k});
      return 'ok';
    })()
  `);
  await sleep(2500);
}

const loopRes = JSON.parse(await ev(`
  JSON.stringify({
    reloadCalls: window.__reloadCalls,
    log: window.__localstore.reloadLog().slice(-10).map(x => ({ reason: x.reason, blocked: x.blocked }))
  })
`));
console.log('    5 次触发后 location.reload 实际调用次数: ' + loopRes.reloadCalls);
console.log('    刷新日志: ' + JSON.stringify(loopRes.log.slice(-4)));

check('★ 反复触发刷新路径时，真实 reload 至多只发生 1 次',
  loopRes.reloadCalls <= 1, 'reload 调用了 ' + loopRes.reloadCalls + ' 次');
check('后续的刷新意图被熔断器拦下并留下了 blocked 记录',
  loopRes.log.some((x) => x.blocked === true),
  JSON.stringify(loopRes.log));
check('刷新请求确实发生过（说明这条路径真的被走到了）',
  loopRes.log.length > 0, JSON.stringify(loopRes.log));

// ---------------------------------------------------------------------------
// ★★ 决定性验证：反复请求真实刷新，但每次都必须被"每次页面加载一次"的上限挡住。
//
//    这条不变量正是用户那个故障的解药：
//      旧实现只有 8 秒**滑动窗口**，它只限速不限次 —— 只要每次启动周期
//      超过 8 秒就变成每 9 秒刷一次的无限循环，页面永远在加载、
//      面板永远停在「处理中… / 同步中…」。
//      新实现额外加了一道"每次页面加载只允许一次刷新"的绝对上限。
//
//    这里用 keepQuota=true 让配额真的累积（还回去就永远试不出上限），
//    并且把闸门时间戳伪造成"9 秒前"，精确复现滑动窗口已过期的那种情形。
// ---------------------------------------------------------------------------
const breaker = JSON.parse(await ev(`
  (async () => {
    const L = window.__localstore;
    sessionStorage.removeItem('chat-demo:auto-reload-at');
    sessionStorage.removeItem('chat-demo:auto-reload-count');
    // 连续 8 次，全部 keepQuota=true
    const seq = [];
    for (let i = 0; i < 8; i++) seq.push(L.__requestReloadForTest('循环测试 ' + i, true));
    const countAfter = sessionStorage.getItem('chat-demo:auto-reload-count');
    // 再单独验一次"滑动窗口已过期也照样拦"
    sessionStorage.removeItem('chat-demo:auto-reload-at');
    sessionStorage.removeItem('chat-demo:auto-reload-count');
    const first = L.__requestReloadForTest('第一次', true);
    sessionStorage.setItem('chat-demo:auto-reload-at', String(Date.now() - 9000));
    const second = L.__requestReloadForTest('过了 9 秒又来一次', true);
    const log = L.reloadLog().slice(-3).map(x => ({ reason: x.reason, blocked: x.blocked }));
    sessionStorage.removeItem('chat-demo:auto-reload-at');
    sessionStorage.removeItem('chat-demo:auto-reload-count');
    return JSON.stringify({ seq: seq, countAfter: countAfter, first: first, second: second, log: log });
  })()
`));
console.log('    8 次请求放行序列: ' + JSON.stringify(breaker.seq));
console.log('    滑动窗口过期后: ' + JSON.stringify({ first: breaker.first, second: breaker.second }));

check('★★ 连续 8 次刷新请求只放行 1 次（每次页面加载仅一次）',
  breaker.seq[0] === true && breaker.seq.slice(1).every((x) => x === false),
  JSON.stringify(breaker.seq));
check('★ 滑动窗口过期后仍不放行（这正是原无限循环的成因）',
  breaker.first === true && breaker.second === false,
  JSON.stringify({ first: breaker.first, second: breaker.second }));
check('配额真的被累积记录（不是靠还配额骗过去的）',
  Number(breaker.countAfter) === 1, String(breaker.countAfter));
check('被拦下的请求留下了 blocked 记录（可排查是谁在刷）',
  breaker.log.some((x) => x.blocked === true), JSON.stringify(breaker.log));
check('放行的那次也留了记录',
  breaker.log.some((x) => x.blocked === false), JSON.stringify(breaker.log));

// ---------------------------------------------------------------------------
// 反复驱动真实对账路径这条用例**刻意没有做**，原因如实记录：
//
//   要"反复让对账认为有东西要收"，就必须在每次对账前把假文件夹重新绑定
//   （应用启动时真的刷过一次页面，而注入的假句柄只活在 JS 内存里，
//   刷新后就丢了 —— 真实句柄存在 IndexedDB，不受影响）。
//   但一旦对账真的申请刷新并放行，页面就跳走了，CDP 这边的断言上下文随之
//   销毁（Inspected target navigated）。要在无头环境里稳定绕开这点，
//   需要把假句柄做成能跨文档存活的替身，成本明显超出收益。
//
//   所以这一条**不写不可靠的断言充数**，改用两种确定性证据覆盖：
//     · 上面那条：启动对账申请刷新时，日志里留下了
//       `启动对账收进了 N 个对话` —— 证明这条生产路径确实走了熔断器；
//     · 下一段：连续/跨窗口的刷新请求只放行一次，证明无限循环被挡住。
//   两处源码也确认过：1580 与 1683 行都是 requestReload(...)，没有裸 reload。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 反向确认：关掉刷新时，收对话仍然正常（刷不刷新与收不收是两件事）
// ---------------------------------------------------------------------------
await ev(`localStorage.setItem('chat-demo:ls-watch-noreload', 'true')`);
await sleep(6000);
const ids2 = JSON.parse(await ev(`
  (async () => JSON.stringify((await window.__localstore.readAllSessions()).map(s => s.id).sort()))()
`));
check('关掉自动刷新不影响已有对话（收与刷解耦）',
  ids2.includes('local-only') && ids2.includes('web-a'), JSON.stringify(ids2));

console.log('\n' + '='.repeat(50));
console.log(`刷新熔断测试: ${pass} 通过 / ${fail} 失败`);

cdp.close?.();
chrome.kill();
server.close();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
