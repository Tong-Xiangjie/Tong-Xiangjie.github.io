#!/usr/bin/env node
/**
 * 验证「官方导出转换出来的包」能不能真的被页面导入。
 *
 * 为什么用独立临时 profile：不能拿用户自己的浏览器数据当试验场。
 * 这个 profile 是全新的空库，导入进去的东西跟用户真实数据完全隔离，
 * 测完直接删掉。
 *
 * 查什么：
 *   1. importBundleFromText 的返回统计（导入了几个、跳过几个、附件还原几个）
 *   2. 库里实际落了几个会话 / 附件
 *   3. 附件 blob 是不是真的（比对字节数，防"只有元信息的空壳"）
 *   4. 思维链块在不在（THINK 片段有没有保住）
 *   5. 分支链是不是通的（rootMessageId + selectedChildId 能串出线性对话）
 *
 * 只用 Edge（DSH_BROWSER），绝不拉起 Chrome。
 */
import { spawn, execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer } from 'node:http';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const PORT = 8884;
const CDP_PORT = 9329;

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error('用法: node tools/verify-official-import.mjs <转换出来的包.json>');
  process.exit(1);
}
const bundleSize = statSync(bundlePath).size;
console.log('待导入的包: ' + bundlePath);
console.log('包大小    : ' + (bundleSize / 1024 / 1024).toFixed(2) + ' MB');

const browserPath = findBrowser();
if (/chrome\.exe$/i.test(browserPath)) { console.error('拒绝执行：这会拉起 Chrome。'); process.exit(1); }
console.log('浏览器    : ' + browserPath + '\n');

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  // 让页面自己把包 fetch 走：165MB 直接塞进 evaluate 的字符串不安全
  if (p === '/__bundle.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(readFileSync(bundlePath));
    return;
  }
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'official-import-'));
const proc = spawn(browserPath, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--window-size=1400,900',
  `http://127.0.0.1:${PORT}/index.html`
], { stdio: 'ignore' });

const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

let pageErrs = [];
cdp.on('event', (msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    pageErrs.push((d.exception?.description || d.text).split('\n')[0].slice(0, 160));
  }
});

const ev = async (expr, timeoutMs) => {
  try { return await cdp.evaluate(expr, { timeoutMs: timeoutMs || 60000 }); }
  catch (e) { return { __err: String(e.message) }; }
};

for (let i = 0; i < 60; i++) {
  if ((await ev(`!!(window.__localstore && window.__localstore.version)`)) === true) break;
  await new Promise((r2) => setTimeout(r2, 500));
}

/**
 * 补一个 API Key 再刷新。
 *
 * 为什么必须：没有 key 时应用停在"输入 API Key 开始使用"的欢迎页，
 * 侧栏和消息区都不渲染 —— 那样就没法验证搜索步骤到底能不能显示出来。
 * 这个 key 只存在于**临时 profile** 里，用完整个 profile 目录会被删掉。
 * 这里刻意用一个明显是假的占位串，不会误当作真 key。
 */
await ev(`try { localStorage.setItem('chat-demo:api-key', 'sk-verify-placeholder-not-a-real-key'); } catch (e) {}`);
await cdp.send('Page.reload', { ignoreCache: false });
for (let i = 0; i < 60; i++) {
  await new Promise((r2) => setTimeout(r2, 500));
  const ready = await ev(`!!(window.__localstore && window.__localstore.version) && !!(window.__lsFeatures && window.__lsFeatures.openSessionByTitle)`);
  if (ready === true) break;
}
await new Promise((r2) => setTimeout(r2, 2500));

// 解析包（在 Node 里，避免把 165MB 塞进 CDP evaluate）
console.log('读取并解析包…');
const bundleText = readFileSync(bundlePath, 'utf8');
const bundle = JSON.parse(bundleText);
console.log(`  包内: ${bundle.sessionCount} 个对话, ${bundle.attachmentCount} 个附件`);
console.log('');

// 附件期望字节数（用来验证 blob 是不是真的）
const expectedSizes = new Map();
for (const f of bundle.files) {
  // base64 长度 → 原始字节数（忽略 padding）
  const b64 = f.blobB64 || '';
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (f.id) expectedSizes.set(f.id, bytes);
}

// 只把"对话"喂给页面导入；附件通过 files 字段一起给（就是包里的结构）
console.log('让页面自己 fetch 这个包并导入（会解码 base64 并写 IndexedDB，可能要一两分钟）…');
const importResult = await ev(`
  (async () => {
    try {
      var L = window.__localstore;
      var resp = await fetch('/__bundle.json');
      var text = await resp.text();
      var bytes = text.length;
      var r = await L.importBundle(text);
      return { ok: true, got: bytes, result: r };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 500) };
    }
  })()
`, 600000);
console.log('  importBundle 返回: ' + JSON.stringify(importResult, null, 1));
console.log('');

// 再导一次同一个包：验证幂等（这是我们向用户承诺过的性质，必须实测）
console.log('再导入同一个包一次，验证幂等（重复导入不应产生重复）…');
const second = await ev(`
  (async () => {
    try {
      var resp = await fetch('/__bundle.json?again=1');
      var text = await resp.text();
      var r = await window.__localstore.importBundle(text);
      return { ok: true, result: r };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  })()
`, 600000);
console.log('  第二次导入返回: ' + JSON.stringify(second.ok ? second.result : second));
console.log('');

// 校验落库结果
const check = await ev(`
  (async () => {
    function openDb() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open('chat-demo');
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    function getAll(db, store) {
      return new Promise(function (res, rej) {
        if (!db.objectStoreNames.contains(store)) return res([]);
        var tx = db.transaction(store, 'readonly');
        var q = tx.objectStore(store).getAll();
        q.onsuccess = function () { res(q.result || []); };
        q.onerror = function () { rej(q.error); };
      });
    }
    var db = await openDb();
    var sessions = await getAll(db, 'sessions');
    var files = await getAll(db, 'files');
    var summaries = await getAll(db, 'sessionSummaries');

    // 附件 blob 真伪：给出 id → 字节数
    var fileSizes = {};
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      fileSizes[f.id] = (f.blob && f.blob.size != null) ? f.blob.size : -1;
    }

    // 思维链：统计 thinking 块数量，并抽一条样例
    var thinkBlocks = 0, textBlocks = 0, toolBlocks = 0, toolResults = 0, legacySearchBlocks = 0, legacyContentBlocks = 0, strContent = 0, arrContent = 0, assistantMissingBlocks = 0, assistantMissingModel = 0, assistantMissingStatus = 0;
    var thinkSample = null, treeOk = 0, treeBad = 0, linearOk = 0, linearBad = 0;
    var totalMsgs = 0, extraBranchMsgs = 0, sessionsWithBranch = 0;
    for (var s = 0; s < sessions.length; s++) {
      var sess = sessions[s];
      var msgs = sess.messages || [];
      totalMsgs += msgs.length;
      var byId = {};
      for (var m = 0; m < msgs.length; m++) byId[msgs[m].id] = msgs[m];

      // 顺 selectedChildId 从 rootMessageId 走：走到的条数 = 应用实际显示的条数
      var cur = sess.rootMessageId;
      var steps = 0, guard = 0;
      while (cur != null && byId[cur] && guard++ < 100000) { steps++; cur = byId[cur].selectedChildId; }
      if (sess.rootMessageId != null && byId[sess.rootMessageId] && steps > 0) treeOk++; else treeBad++;
      extraBranchMsgs += Math.max(0, msgs.length - steps);
      if (msgs.length > steps) sessionsWithBranch++;

      // 用应用自己的 linearMessages 复核（它才是真正渲染用的）
      try {
        var lin = window.__localstore.linearMessages(sess);
        if (lin && lin.length === steps) linearOk++; else linearBad++;
      } catch (e) { linearBad++; }

      for (var k = 0; k < msgs.length; k++) {
        var mm2 = msgs[k];
        // ★ 助手消息的块在 blocks 字段；用户消息的正文在 content 字段（字符串）
        if (typeof mm2.content === 'string') strContent++;
        var c = Array.isArray(mm2.blocks) ? mm2.blocks : (Array.isArray(mm2.content) ? mm2.content : null);
        if (Array.isArray(mm2.content)) legacyContentBlocks++;
        if (!c) continue;
        arrContent++;
        for (var b = 0; b < c.length; b++) {
          if (!c[b]) continue;
          if (c[b].type === 'thinking') {
            thinkBlocks++;
            if (!thinkSample && c[b].thinking) thinkSample = String(c[b].thinking).slice(0, 80);
          } else if (c[b].type === 'text') textBlocks++;
          else if (c[b].type === 'ls_tool') toolBlocks++;
          else if (c[b].type === 'server_tool_use') toolBlocks++;
          else if (c[b].type === 'web_search_tool_result') toolResults++;
          else if (c[b].type === 'search') legacySearchBlocks++;
        }
      }
      // 助手消息必备字段检查（缺了应用消息头渲染不出来）
      for (var k2 = 0; k2 < msgs.length; k2++) {
        var mm3 = msgs[k2];
        if (mm3.role !== 'assistant') continue;
        if (!Array.isArray(mm3.blocks)) assistantMissingBlocks++;
        if (!('model' in mm3)) assistantMissingModel++;
        if (!('status' in mm3)) assistantMissingStatus++;
      }
    }
    db.close();
    return {
      sessions: sessions.length,
      summaries: summaries.length,
      files: files.length,
      fileSizes: fileSizes,
      thinkBlocks: thinkBlocks,
      textBlocks: textBlocks,
      toolBlocks: toolBlocks,
      toolResults: toolResults,
      legacySearchBlocks: legacySearchBlocks,
      legacyContentBlocks: legacyContentBlocks,
      assistantMissingBlocks: assistantMissingBlocks,
      assistantMissingModel: assistantMissingModel,
      assistantMissingStatus: assistantMissingStatus,
      strContent: strContent,
      arrContent: arrContent,
      thinkSample: thinkSample,
      treeOk: treeOk, treeBad: treeBad,
      linearOk: linearOk, linearBad: linearBad,
      totalMsgs: totalMsgs, extraBranchMsgs: extraBranchMsgs, sessionsWithBranch: sessionsWithBranch
    };
  })()
`);

console.log('================ 校验结果 ================');
console.log(`  库里会话数        : ${check.sessions}   （包里 ${bundle.sessionCount}）`);
console.log(`  sessionSummaries  : ${check.summaries}`);
console.log(`  库里附件数        : ${check.files}   （包里 ${bundle.attachmentCount}）`);
console.log(`  消息 content 形态 : 字符串 ${check.strContent} 条 / 块数组 ${check.arrContent} 条`);
console.log(`  正文块 / 思维链块 : ${check.textBlocks} / ${check.thinkBlocks}`);
console.log(`  原生搜索块        : server_tool_use ${check.toolBlocks} 个, web_search_tool_result ${check.toolResults} 个, 旧版 search 块 ${check.legacySearchBlocks} 个（应为 0）`);
console.log(`  消息总数          : ${check.totalMsgs} 条`);
console.log(`  旧分支消息        : ${check.extraBranchMsgs} 条，分布在 ${check.sessionsWithBranch} 个会话里（默认不显示，但已保留）`);
console.log(`  分支链可走通      : ${check.treeOk} 好 / ${check.treeBad} 坏`);
console.log(`  linearMessages 复核: ${check.linearOk} 好 / ${check.linearBad} 坏`);
if (check.thinkSample) console.log(`  思维链样例        : "${check.thinkSample}…"`);
console.log('');

// 附件字节数比对
let sizeOk = 0, sizeEmpty = 0, sizeMissing = 0, sizeMismatch = 0;
const mismatches = [];
for (const [id, expected] of expectedSizes) {
  const actual = check.fileSizes[id];
  if (actual === undefined) { sizeMissing++; continue; }
  if (actual <= 0) { sizeEmpty++; continue; }
  if (actual === expected) sizeOk++;
  else { sizeMismatch++; if (mismatches.length < 5) mismatches.push(`${id}: 期望 ${expected} 实际 ${actual}`); }
}
console.log('  附件 blob 校验：');
console.log(`    字节数完全一致 : ${sizeOk}`);
console.log(`    空/无内容      : ${sizeEmpty}`);
console.log(`    库里找不到     : ${sizeMissing}`);
console.log(`    字节数不符     : ${sizeMismatch}`);
if (mismatches.length) mismatches.forEach((m) => console.log('      ' + m));
console.log('');
console.log('  页面异常: ' + pageErrs.length);
pageErrs.slice(0, 5).forEach((e) => console.log('    ' + e));
console.log('');

// ---------------------------------------------------------------------------
// 真正打开一个带搜索步骤的对话，看它渲染出什么
//
// 为什么非要做这一步：前面只证明了"块存进了库"。而应用对未知块类型是
// `default: return null`（静默丢弃）—— 存进去不等于看得见。
// 我第一版就是造了个 ls_tool 类型，库里数得出来，页面上一个字都没有。
// ---------------------------------------------------------------------------
const render = await ev(`
  (async () => {
    function openDb() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open('chat-demo');
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    function getAll(db, store) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(store, 'readonly');
        var q = tx.objectStore(store).getAll();
        q.onsuccess = function () { res(q.result || []); };
        q.onerror = function () { rej(q.error); };
      });
    }
    var db = await openDb();
    var sessions = await getAll(db, 'sessions');
    db.close();

    // 挑一个含 search 块的会话，且它得在当前显示路径上
    var target = null, targetMsg = null;
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var byId = {};
      for (var k = 0; k < s.messages.length; k++) byId[s.messages[k].id] = s.messages[k];
      var cur = s.rootMessageId, guard = 0, path = [];
      while (cur != null && byId[cur] && guard++ < 10000) { path.push(byId[cur]); cur = byId[cur].selectedChildId; }
      for (var p = 0; p < path.length; p++) {
        var c = path[p].content;
        if (!Array.isArray(c)) continue;
        for (var b = 0; b < c.length; b++) {
          if (c[b] && c[b].type === 'search') { target = s; targetMsg = path[p]; break; }
        }
        if (target) break;
      }
      if (target) break;
    }
    if (!target) return { skipped: '库里没有可渲染的 search 步骤' };

    var searchCount = 0, resultsInMsg = 0;
    for (var b2 = 0; b2 < targetMsg.content.length; b2++) {
      var bl = targetMsg.content[b2];
      if (bl.type === 'search') { searchCount++; resultsInMsg = (bl.results || []).length; }
    }

    // 直接调应用自己的渲染入口做不到，这里用桥接层的 markdown 导出做交叉验证：
    // 它会把 thinking 渲染成 <details>，把 text 原样输出。
    // ⚠ 注意：这个函数**不处理搜索块**，所以它只能验证正文与思维链，
    //   搜索步骤的验证必须靠下面真正打开对话查 DOM 那一步。
    var md = '';
    try { md = window.__localstore.renderMarkdown(target); } catch (e) { md = 'ERR ' + e.message; }

    return {
      sessionTitle: target.title,
      sessionId: target.id,
      searchStepsInThisMessage: searchCount,
      sourcesInSearchStep: resultsInMsg,
      msgBlockTypes: targetMsg.content.map(function (x) { return x.type; }),
      markdownHasThink: md.indexOf('<details>') >= 0,
      markdownHasAnswer: md.length > 500,
      markdownLen: md.length
    };
  })()
`);
console.log('正文/思维链交叉验证（注意：renderMarkdown 不处理搜索块）：');
console.log('  ' + JSON.stringify(render, null, 1).split('\n').join('\n  '));
console.log('');

// ---------------------------------------------------------------------------
// 终极验证：真的打开那个对话，在 DOM 里找搜索 UI
//
// 为什么非做不可：前面两次都栽在"存进去了但看不见"——
//   1. 自定义类型 ls_tool  → 渲染器 default: null 丢掉
//   2. {type:'search'} 块  → 步骤聚合只认 server_tool_use，丢掉
// 库里数得出来 ≠ 页面上看得见。所以判据必须是肉眼等价的：
// DOM 里有没有出现「搜索到 N 个网页」。
// ---------------------------------------------------------------------------
const rendered = await ev(`
  (async () => {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var bodyText = function () { return document.body ? document.body.innerText : ''; };

    function openDb() {
      return new Promise(function (res, rej) {
        var r = indexedDB.open('chat-demo');
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    }
    function getAll(db, store) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(store, 'readonly');
        var q = tx.objectStore(store).getAll();
        q.onsuccess = function () { res(q.result || []); };
        q.onerror = function () { rej(q.error); };
      });
    }

    var db = await openDb();
    var sessions = await getAll(db, 'sessions');
    db.close();

    // 找"当前显示路径上含 server_tool_use"的会话
    var pick = null, expectSources = 0;
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var byId = {};
      for (var k = 0; k < s.messages.length; k++) byId[s.messages[k].id] = s.messages[k];
      var cur = s.rootMessageId, guard = 0;
      while (cur != null && byId[cur] && guard++ < 10000) {
        var m = byId[cur];
        if (Array.isArray(m.blocks)) {
          for (var b = 0; b < m.blocks.length; b++) {
            var bl = m.blocks[b];
            if (bl && bl.type === 'server_tool_use') {
              for (var b2 = 0; b2 < m.blocks.length; b2++) {
                var r2 = m.blocks[b2];
                if (r2 && r2.type === 'web_search_tool_result' && r2.tool_use_id === bl.id) {
                  expectSources = Array.isArray(r2.content) ? r2.content.length : 0;
                }
              }
              pick = { id: s.id, title: s.title };
              break;
            }
          }
        }
        if (pick) break;
        cur = m.selectedChildId;
      }
      if (pick) break;
    }
    if (!pick) return { skipped: '库里没有含 server_tool_use 的会话' };
    return { found: true, title: pick.title, id: pick.id, expectSources: expectSources, dbSessionCount: sessions.length };
  })()
`, 120000);
if (!rendered || !rendered.found) {
  console.log('（跳过渲染验证：' + JSON.stringify(rendered) + '）');
} else {
  /**
   * ★ 必须刷新页面再做渲染验证 ★
   *
   * 这不是可选的：导入是直接写 IndexedDB 的，而应用是**启动时**把对话读进
   * 内存 store 的。导入发生在启动之后 → 应用内存里一条都没有 → 侧栏 0 项、
   * 消息区空白。刷新一次应用才会把导入的对话读进来。
   *
   * 实测数据：导入后不刷新，itemEls=0、railCount=0；这就是"库里明明有、
   * 页面上却看不到"的真正原因（而不是块类型的问题）。
   *
   * 对用户的含义：导入完必须刷新页面（或者说，导入是"下次打开才生效"）。
   */
  console.log('刷新页面，让应用把导入的对话读进内存…');
  await cdp.send('Page.reload', { ignoreCache: false });
  for (let i = 0; i < 60; i++) {
    await new Promise((r2) => setTimeout(r2, 500));
    const ready = await ev(`!!(window.__localstore && window.__localstore.version) && !!(window.__lsFeatures && window.__lsFeatures.openSessionByTitle)`);
    if (ready === true) break;
  }

  /**
   * ★ 等待要足够长，且要等到侧栏真的出现条目 ★
   *
   * 实测：30 个会话时几秒就绪；1618 个会话时，刷完页面 2.5 秒内侧栏还是空的，
   * 直接去 openSessionByTitle 必然点不到东西（返回成功但什么都没发生）。
   * 这里改成轮询"侧栏有条目"，最多等 90 秒。
   */
  let sidebarReady = 0;
  for (let i = 0; i < 180; i++) {
    await new Promise((r2) => setTimeout(r2, 500));
    const n = await ev(`document.querySelectorAll('.item-ff6fc9').length`);
    if (typeof n === 'number' && n > 0) { sidebarReady = n; break; }
  }
  console.log(`  侧栏就绪: ${sidebarReady} 项`);
  // 再多给应用一点时间把首屏渲染完
  await new Promise((r2) => setTimeout(r2, 3000));

  const after = await ev(`
    (async () => {
      var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var title = ${JSON.stringify(rendered.title)};
      var diag = {
        itemEls: document.querySelectorAll('.item-ff6fc9').length,
        railCount: null,
        how: null
      };
      try { diag.railCount = window.__lsFeatures.railCount(); } catch (e) {}

      try {
        window.__lsFeatures.openSessionByTitle(title);
        diag.how = 'openSessionByTitle';
      } catch (e) {
        var items = document.querySelectorAll('.item-ff6fc9');
        for (var q = 0; q < items.length; q++) {
          var ti = items[q].querySelector('.title-ff6fc9');
          if (ti && ti.textContent.trim() === title) { items[q].click(); diag.how = 'sidebar-click'; break; }
        }
      }

      var found = null, text = '';
      for (var w = 0; w < 80; w++) {
        await sleep(250);
        text = document.body ? (document.body.innerText || document.body.textContent || '') : '';
        var mm = text.match(/搜索到\\s*\\d+\\s*个网页/) || text.match(/已阅读\\s*\\d+\\s*个网页/) || text.match(/Found\\s*\\d+\\s*web pages/);
        if (mm) { found = mm[0]; break; }
        // 还没进对话：应用有时需要再点一次（首屏渲染完侧栏才可点）
        if (w === 8 || w === 24 || w === 48 || w === 80) {
          try { window.__lsFeatures.openSessionByTitle(title); } catch (e) {}
        }
      }

      // 那一行到底渲染成了什么：把所有 class 含 row-_3d93a 的元素文字抓出来
      var rows = document.querySelectorAll('[class*="row-_3d93a"]');
      var rowTexts = [];
      for (var ri = 0; ri < rows.length; ri++) {
        var rt = (rows[ri].innerText || rows[ri].textContent || '').trim().replace(/\\s+/g, ' ');
        rowTexts.push(rt.slice(0, 120));
      }
      // 上一级容器（步骤列表）也看一下
      var listEl = null, listText = null;
      if (rows.length) {
        var par = rows[0].parentElement;
        if (par) { listEl = par.className; listText = (par.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 300); }
      }
      // innerText 在无头模式下可能为空，所以额外量几个真实存在的东西
      return {
        diag: diag,
        searchUiText: found,
        searchRowCount: document.querySelectorAll('[class*="row-_3d93a"]').length,
        searchRowTexts: rowTexts,
        stepListClass: listEl,
        stepListText: listText,
        bodyLen: text.length,
        innerTextLen: document.body ? (document.body.innerText || '').length : -1,
        textContentLen: document.body ? (document.body.textContent || '').length : -1,
        mainEls: document.querySelectorAll('[class*="main-_"]').length,
        contentEls: document.querySelectorAll('[class*="content-_"]').length,
        thinkEls: document.querySelectorAll('.ds-think-content').length,
        bodyHead: text.slice(0, 260)
      };
    })()
  `, 180000);
  console.log('刷新后的渲染结果：');
  console.log('  ' + JSON.stringify(after, null, 1).split('\n').join('\n  '));
  console.log('');
  globalThis.__searchRendered = !!(after && after.searchUiText);
  if (globalThis.__searchRendered) {
    console.log('★★ 通过：页面上确实出现「' + after.searchUiText + '」—— 原生搜索步骤渲染成功');
  } else {
    console.log('✗ 页面里没找到搜索 UI');
  }
}
console.log('');

const searchRendered = !!globalThis.__searchRendered;

const pass =
  check.sessions === bundle.sessionCount &&
  check.thinkBlocks > 0 &&
  check.treeBad === 0 && check.linearBad === 0 &&
  sizeEmpty === 0 && sizeMismatch === 0 &&
  check.legacySearchBlocks === 0 &&
  searchRendered &&
  importResult.ok === true;
console.log('');
console.log(pass ? '★ 全部通过：官方导出转换出来的包可以被页面正常导入，思维链与附件都完整'
                 : '✗ 有不通过项，见上面明细');

try { cdp.close(); } catch { }
try { proc.kill(); } catch { }
server.close();
await new Promise((r) => setTimeout(r, 800));
try {
  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
} catch { }
try { rmSync(profile, { recursive: true, force: true }); } catch { }
console.log('（已清理临时 profile）');
process.exit(pass ? 0 : 1);
