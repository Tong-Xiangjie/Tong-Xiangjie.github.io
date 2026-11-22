#!/usr/bin/env node
/**
 * 真正调用应用的 checkArchiveFormat / importArchive，把真实异常抓出来。
 *
 * 为什么必须这么做：应用只报一句笼统的
 *   「文件导入失败，可能是文件格式错误或使用了旧版的对话导出 ZIP 文件…」
 * 而 checkArchiveFormat 里有好几个不同的 throw（backupUnrecognized /
 * backupInvalidVersion / backupNewerVersion / backupIncomplete…），
 * 靠读代码猜是低效的 —— 直接调它，让异常自己说话。
 *
 * 做法：
 *   1. 起静态服务器把页面跑起来
 *   2. 在页面里动态 import 那个懒加载 chunk（script src 都注入了 rspack 运行时）
 *   3. 把 ZIP 字节喂成 File 对象，先 checkArchiveFormat 再 importArchive
 *   4. 捕获异常，打印 message（就是 UI 上看到的那句）+ stack
 *
 * 用法: node tools/probe-native-import.mjs <file.zip>
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const zipPath = process.argv[2];
if (!zipPath) { console.error('用法: node tools/probe-native-import.mjs <file.zip>'); process.exit(1); }

const PORT = 8795 + Math.floor(Math.random() * 100);
const CDP_PORT = 9500 + Math.floor(Math.random() * 200);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

const browserPath = findBrowser();
if (/chrome\.exe$/i.test(browserPath)) { console.error('拒绝执行：这会拉起 Chrome。'); process.exit(1); }
const zipBytes = readFileSync(zipPath);
console.log('待测文件  : ' + zipPath);
console.log('大小      : ' + (zipBytes.length / 1024 / 1024).toFixed(2) + ' MB');
console.log('浏览器    : ' + browserPath + '\n');

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  // 让页面自己 fetch 这个 ZIP（几百 MB 走 CDP 传字符串太蠢）
  if (p === '/__test.zip') {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zipBytes.length });
    res.end(zipBytes);
    return;
  }
  if (p === '/') p = '/index.html';
  const f = join(ROOT, p);
  if (!existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'native-import-probe-'));
const proc = spawn(browserPath, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--window-size=1280,900',
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
    pageErrs.push((d.exception?.description || d.text).split('\n')[0].slice(0, 200));
  }
});

const ev = async (expr, timeoutMs) => {
  try { return await cdp.evaluate(expr, { timeoutMs: timeoutMs || 60000 }); }
  catch (e) { return { __err: String(e.message) }; }
};

for (let i = 0; i < 60; i++) {
  if ((await ev(`!!(window.__localstore && window.__localstore.version)`)) === true) break;
  await new Promise((r) => setTimeout(r, 500));
}
await ev(`try { localStorage.setItem('chat-demo:api-key','sk-probe-placeholder'); } catch(e){}`);
await cdp.send('Page.reload', { ignoreCache: false });
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const ready = await ev(`!!(window.__localstore && window.__localstore.version)`);
  if (ready === true) break;
}
await new Promise((r) => setTimeout(r, 2000));
console.log('页面就绪，准备走真实 UI 路径…');

/**
 * 走真正的 UI 路径，不用 import()。
 *
 * 为什么：那个 chunk 是 rspack 打包的，必须经它自己的运行时加载，
 * 直接 import() 拿不到导出（实测 "没能加载到含 checkArchiveFormat 的 chunk"）。
 * 而真实路径完全等价于用户手动操作，还能顺带抓到 toast 上那句报错文案。
 */
await cdp.send('DOM.enable');
await cdp.send('Runtime.enable');

// 1) 打开设置 → 数据管理，让导入的 input 出现在 DOM 里
const opened = await ev(`
  (async () => {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var log = [];
    function byText(sel, txt) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        if ((els[i].textContent || '').trim() === txt) return els[i];
      }
      return null;
    }
    // 先点"设置"
    var s = byText('button, a, div[role="button"]', '设置');
    if (!s) {
      var cands = document.querySelectorAll('*');
      for (var i = 0; i < cands.length && !s; i++) {
        var el = cands[i];
        if (el.children.length === 0 && (el.textContent || '').trim() === '设置') s = el;
      }
    }
    if (s) { s.click(); log.push('点了设置'); } else { log.push('没找到设置'); }
    await sleep(1200);
    // 再点"数据管理"
    var d = byText('button, a, div[role="button"], div, li, span', '数据管理');
    if (d) { d.click(); log.push('点了数据管理'); } else { log.push('没找到数据管理'); }
    await sleep(1500);
    return { log: log, inputs: document.querySelectorAll('input[type=file]').length,
             zipInputs: document.querySelectorAll('input[accept*=".zip"]').length };
  })()
`, 120000);
console.log('  ' + JSON.stringify(opened));

// 2) 装钩子（console / JSON.parse / 未捕获拒绝）。
//    必须在注入文件之前装好 —— 应用读 ZIP 就在注入之后。
try {
  await ev(`
    (function () {
      if (window.__probeConsole) return 'already';
      window.__probeConsole = [];
      ['error', 'warn', 'log'].forEach(function (lvl) {
        var orig = console[lvl];
        console[lvl] = function () {
          try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
              var a = arguments[i];
              parts.push(a && a.stack ? String(a.stack).split('\\n').slice(0, 3).join(' | ')
                                        : (typeof a === 'object' ? JSON.stringify(a) : String(a)));
            }
            window.__probeConsole.push(lvl + ': ' + parts.join(' ').slice(0, 400));
          } catch (e) {}
          return orig.apply(console, arguments);
        };
      });
      // 未捕获的 Promise 拒绝也抓
      window.__probeRejections = [];
      window.addEventListener('unhandledrejection', function (ev) {
        var r = ev.reason;
        window.__probeRejections.push(
          (r && r.name ? r.name + ': ' : '') +
          String(r && r.message || r).slice(0, 300) +
          (r && r.code ? ' [code=' + r.code + ']' : '')
        );
      });
      // ---- 插桩 JSON.parse：应用读 ZIP 里的 JSON 全靠它 ----
      window.__probeParse = [];
      window.__probeStringify = [];
      var origParse = JSON.parse;
      JSON.parse = function (text, reviver) {
        var res;
        try { res = origParse.call(JSON, text, reviver); }
        catch (e) {
          window.__probeParse.push({ len: String(text).length, head: String(text).slice(0, 120), THREW: String(e.message) });
          throw e;
        }
        try {
          if (window.__probeParse.length < 30) {
            var desc = '?';
            if (Array.isArray(res)) desc = 'array[' + res.length + ']';
            else if (res && typeof res === 'object') desc = 'object(' + Object.keys(res).slice(0, 8).join(',') + ')';
            else desc = typeof res + ':' + String(res).slice(0, 40);
            window.__probeParse.push({ len: String(text).length, result: desc });
          }
        } catch (e) {}
        return res;
      };
      var origStringify = JSON.stringify;
      JSON.stringify = function (v) {
        try {
          if (window.__probeStringify.length < 12) {
            var desc;
            if (Array.isArray(v)) desc = 'array[' + v.length + ']';
            else if (v && typeof v === 'object') desc = 'object(' + Object.keys(v).slice(0, 10).join(',') + ')';
            else desc = typeof v;
            var s = origStringify.apply(JSON, arguments);
            window.__probeStringify.push(desc + ' → ' + String(s).length + ' 字符');
            return s;
          }
        } catch (e) {}
        return origStringify.apply(JSON, arguments);
      };
      // ---- 插桩解压与 CRC 相关内置 API，看应用在 ZIP 层走到哪一步 ----
      window.__probeLow = [];
      var low = function (name, wrap) {
        try {
          var Orig = window[name];
          if (!Orig) { window.__probeLow.push(name + ': 不存在'); return; }
          var OrigCtor = Orig;
          var Patched = wrap(OrigCtor);
          Patched.prototype = OrigCtor.prototype;
          for (var k in OrigCtor) { try { Patched[k] = OrigCtor[k]; } catch (e) {} }
          window[name] = Patched;
          window.__probeLow.push(name + ': 已挂钩');
        } catch (e) { window.__probeLow.push(name + ': 挂钩失败 ' + e.message); }
      };
      if (window.DecompressionStream) {
        low('DecompressionStream', function (O) {
          return function (fmt) {
            window.__probeLow.push('DecompressionStream("' + fmt + '") 被创建');
            return new O(fmt);
          };
        });
      } else {
        window.__probeLow.push('DecompressionStream: 浏览器不支持');
      }
      var origTD = window.TextDecoder;
      window.TextDecoder = function (enc, opts) {
        try { if (window.__probeLow.length < 60) window.__probeLow.push('TextDecoder("' + enc + '")'); } catch (e) {}
        return new origTD(enc, opts);
      };
      window.TextDecoder.prototype = origTD.prototype;
      // ---- 插桩 map：应用的校验失败会让 map 回调返回 null，记下栈 ----
      window.__probeNull = [];
      var origMap = Array.prototype.map;
      Array.prototype.map = function (cb, thisArg) {
        var self = this;
        var out;
        try {
          out = origMap.call(self, function (v, i, arr) {
            var r = cb.call(thisArg, v, i, arr);
            try {
              if (r === null && window.__probeNull.length < 6) {
                var st = (new Error()).stack || '';
                window.__probeNull.push({
                  index: i,
                  inputType: typeof v,
                  inputKeys: v && typeof v === 'object' ? Object.keys(v).slice(0, 12).join(',') : String(v).slice(0, 60),
                  stack: st.split('\\n').slice(1, 5).join(' | ').slice(0, 400)
                });
              }
            } catch (e) {}
            return r;
          });
        } catch (e) { throw e; }
        return out;
      };
      // 同时盯 JSON.stringify（应用写库时会 stringify）
      return 'installed';
    })()
  `);
} catch (e) { console.log('  console 捕获安装失败: ' + e.message); }

// 5) 用 fetch 把 ZIP 取进页面，再作为 File 塞给 input 并触发 change。
//
// 为什么不用 DOM.setFileInputFiles 直接给路径：
// 大文件（几百 MB）时那个 CDP 调用会卡住不返回，实测 30 分钟无响应。
// 走 HTTP 让浏览器自己取，既没有大小限制，也完全等价于用户手动选文件。
const injected = await ev(`
  (async () => {
    var inp = document.querySelector('input[accept*=".zip"]') || document.querySelector('input[type=file]');
    if (!inp) return { ok: false, why: '找不到 input' };
    var resp = await fetch('/__test.zip');
    if (!resp.ok) return { ok: false, why: 'fetch ' + resp.status };
    var blob = await resp.blob();
    var file = new File([blob], 'probe.zip', { type: 'application/zip' });
    var dt = new DataTransfer();
    dt.items.add(file);
    if (dt.files.length !== 1) return { ok: false, why: 'DataTransfer 没接受文件', dtLen: dt.files.length };
    inp.files = dt.files;
    var afterSet = inp.files.length;
    var sizeSeen = afterSet ? inp.files[0].size : -1;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, size: file.size, afterSet: afterSet, sizeSeen: sizeSeen };
  })()
`, 900000);
console.log('  注入文件: ' + JSON.stringify(injected));
if (!injected || injected.ok !== true) {
  console.log('✗ 文件注入失败，无法继续');
  try { cdp.close(); } catch { }
  try { proc.kill(); } catch { }
  server.close();
  process.exit(1);
}

// 6) 等确认弹窗出现，点"确认导入"
//
// 大包（几百 MB）在这个环境里会跑很久。原来所有等待都塞在一个 evaluate 里，
// 一旦超时就什么都看不到，分不清"还在干活"和"卡死"。改成：
//   - 用独立的小 evaluate 点确认
//   - 之后每 15 秒轮询一次状态（侧栏条目数、解析计数、是否出现结果文案）
//   - 这样卡住时也能看到最后停在哪一步
let confirmErr = null;
try {
  const conf = await ev(`
    (async () => {
      var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      function byText(txt) {
        var els = document.querySelectorAll('button, a, div[role="button"]');
        for (var i = 0; i < els.length; i++) if ((els[i].textContent || '').trim() === txt) return els[i];
        return null;
      }
      var c = null;
      for (var w = 0; w < 40; w++) {
        await sleep(500);
        c = byText('确认导入') || byText('确定') || byText('确认');
        if (c) break;
      }
      if (!c) return { clicked: false };
      c.click();
      return { clicked: true, text: (c.textContent || '').trim() };
    })()
  `, 120000);
  console.log('  ' + JSON.stringify(conf));
} catch (e) {
  confirmErr = e.message;
  console.log('  点确认失败: ' + e.message);
}

const statusProbe = `
  (function () {
    var body = document.body ? (document.body.innerText || '') : '';
    var m = body.match(/文件导入失败[^\\n]*/) || body.match(/已导入\\s*\\d+\\s*个对话/) || body.match(/文件内容不完整[^\\n]*/) || body.match(/无法识别该文件[^\\n]*/) || body.match(/文件版本[^\\n]*/) || body.match(/附件数据已损坏[^\\n]*/) || body.match(/消息分支已损坏[^\\n]*/) || body.match(/文件不是有效/);
    return {
      result: m ? m[0].slice(0, 90) : null,
      items: document.querySelectorAll('.item-ff6fc9').length,
      parses: (window.__probeParse || []).length,
      low: (window.__probeLow || []).length,
      busyVisible: /导入中|正在导入/.test(body)
    };
  })()
`;

console.log('  开始轮询状态（每 15 秒一次）…');
let lastStatus = null;
let finalStatus = null;
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 15000));
  let st;
  try {
    st = await ev(statusProbe, 30000);
  } catch (e) {
    console.log(`   [${(i + 1) * 15}s] 状态查询超时（页面可能被占满）`);
    continue;
  }
  if (st && typeof st === 'object') {
    const line = `[${String((i + 1) * 15).padStart(4)}s] 侧栏=${st.items} JSON.parse=${st.parses} 低层钩子=${st.low} 忙碌=${st.busyVisible} 结果=${st.result || '—'}`;
    if (line !== lastStatus) { console.log('   ' + line); lastStatus = line; }
    if (st.result) { finalStatus = st; break; }
  }
}
if (!finalStatus) {
  try { finalStatus = await ev(statusProbe, 30000); } catch (e) { finalStatus = { __err: e.message }; }
}

// 把 map 里返回 null 的位置（也就是校验失败点）抓出来
try {
  const nulls = await ev(`(window.__probeNull || []).slice(0, 6)`, 30000);
  if (nulls && nulls.length) {
    console.log('');
    console.log('=== map 回调返回 null 的位置（校验失败点）===');
    console.log(JSON.stringify(nulls, null, 1));
  } else {
    console.log('  （没有捕获到 map 返回 null）');
  }
} catch (e) { /* 忽略 */ }

const result = finalStatus;

console.log('\n================ 结果 ================');
console.log(JSON.stringify(result, null, 1));
console.log('\n页面异常: ' + pageErrs.length);
pageErrs.slice(0, 6).forEach((e) => console.log('  ' + e));

try { cdp.close(); } catch { }
try { proc.kill(); } catch { }
server.close();
await new Promise((r) => setTimeout(r, 800));
try {
  execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedge.exe'\\" | Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '\\\\')}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
} catch { }
try { rmSync(profile, { recursive: true, force: true }); } catch { }
console.log('（已清理临时 profile）');
