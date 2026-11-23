#!/usr/bin/env node
/**
 * 端到端验证「粘贴转 txt」：
 *   ① 卡片显示正常（不再"上传失败"）
 *   ② 正文进入本地缓存
 *   ③ 发送时正文被内联进发给模型的请求（不是占位说明）
 *   ④ 走的是原生 OpenAI 形状的请求（中转站能懂）
 *
 * 只把对话请求换成本地假响应，其余不动；不真的调用模型。
 * 用法: node tools/verify-txt-inline.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PORT = 9430 + Math.floor(Math.random() * 20);
const CDP_PORT = 9300 + Math.floor(Math.random() * 40);
const BASE = 'https://llmapi.paratera.com';
const KEY = 'sk-_IzbJJ2lh5r7zqemUdIWsQ';

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
const profile = mkdtempSync(join(tmpdir(), 'verify-inline-'));
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
  const ev = async (expr, t = 180000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, t);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'eval failed');
    }
    return r.result ? r.result.value : undefined;
  };

  for (let i = 0; i < 120; i++) {
    const ok = await ev(`!!(window.__lsFeatures && window.__localstore)`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await ev(`(function(){
    try {
      localStorage.setItem('chat-demo:api-base', ${JSON.stringify(BASE)});
      localStorage.setItem('chat-demo:api-key', ${JSON.stringify(KEY)});
      localStorage.setItem('chat-demo:model', 'deepseek-chat');
    } catch(e){}
    return 1;
  })()`);
  await ev('location.reload()').catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  for (let i = 0; i < 120; i++) {
    const ok = await ev(`!!(window.__lsFeatures && document.querySelector('textarea'))`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const out = await ev(`
    (async () => {
      var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
      var F = window.__lsFeatures;
      var res = {};

      var MARK = '内联校验标记ABC123';
      var text = MARK + '\\n';
      for (var i = 1; i <= 60; i++) text += '第' + i + '行：正文必须原样出现在发给模型的请求里。\\n';

      // 只拦"翻译之后"的对话请求（/chat/completions）。
      // 注意不能拦 /messages —— 那是应用发出的**原始** Anthropic 请求，
      // 桥接层还要把它翻译成 OpenAI 形状、并在这过程中内联附件正文。
      // 拦它等于把翻译环节跳过了，验证就失去意义。
      var chatBodies = [];
      var seenUrls = [];
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\\/chat\\/completions/.test(url)) {
          try {
            var b = init && init.body;
            chatBodies.push({ url: url, body: typeof b === 'string' ? b.slice(0, 60000) : String(b) });
          } catch (e) {}
          return Promise.resolve(new Response(
            'data: {"id":"x","object":"chat.completion.chunk","model":"deepseek-flash","choices":[{"index":0,"delta":{"content":"ok"}}]}\\n\\ndata: [DONE]\\n\\n',
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
          ));
        }
        seenUrls.push(url);
        return origFetch.apply(this, arguments);
      };

      // ① 粘贴转 txt
      res.attachOk = F.attachTextAsFile(text);
      await sleep(8000);

      var cards = document.querySelectorAll('[class*="attachments-"] > [class*="card-"]');
      res.cards = [];
      for (var c = 0; c < cards.length; c++) {
        res.cards.push({ failed: /failed-/.test(cards[c].className || ''), text: (cards[c].textContent || '').trim().slice(0, 36) });
      }
      // ② 缓存
      try {
        var o = JSON.parse(localStorage.getItem('chat-demo:ls-file-text') || '{}');
        res.cacheIds = Object.keys(o);
        res.cacheHit = 0;
        Object.keys(o).forEach(function (k) { if (o[k].text && o[k].text.indexOf(MARK) >= 0) res.cacheHit = o[k].text.length; });
      } catch (e) { res.cacheErr = String(e); }

      // ③ 发送
      var ta = document.querySelector('textarea');
      var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '请读一下这个附件');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(700);
      var sendBtn = null;
      var btns = document.querySelectorAll('button');
      for (var b2 = 0; b2 < btns.length; b2++) {
        var lb = (btns[b2].getAttribute('aria-label') || '') + ' ' + (btns[b2].title || '');
        var cls = String(btns[b2].className || '');
        if (/发送|send/i.test(lb) || /send/i.test(cls)) { sendBtn = btns[b2]; break; }
      }
      if (!sendBtn) {
        // 退化：按回车
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      } else {
        sendBtn.click();
      }
      await sleep(9000);

      res.chatRequests = chatBodies.map(function (x) {
        return {
          url: x.url,
          len: x.body.length,
          hasMark: x.body.indexOf(MARK) >= 0,
          hasPlaceholder: x.body.indexOf('未能读取到内容') >= 0,
          hasFileId: /"file_id"|file_id/.test(x.body),
          head: x.body.slice(0, 260)
        };
      });
      res.seenUrls = seenUrls.filter(function (u, i, a) { return a.indexOf(u) === i; });
      try { res.trace = window.__localstore.protocol.trace().filter(function (e) { return e.kind === 'skip' || e.kind === 'entry' || e.kind === 'openai-request'; }); } catch (e) { res.trace = String(e); }
      try { res.errors = (window.__localstore.sniffState && window.__localstore.sniffState.errors || []).slice(-10); } catch (e) { res.errors = String(e); }
      try { res.diag = window.__localstore.protocol.diagnose(); } catch (e) {}
      window.fetch = origFetch;
      return res;
    })()
  `, 300000);

  console.log('=== 结果 ===');
  console.log('① 粘贴转 txt:', out.attachOk);
  console.log('   卡片:', JSON.stringify(out.cards));
  console.log('② 缓存条目数:', (out.cacheIds || []).length, ' 命中标记的正文长度:', out.cacheHit);
  console.log('③ 对话请求数（翻译后）:', (out.chatRequests || []).length);
  for (const r of out.chatRequests || []) {
    console.log('   ' + r.url);
    console.log('     长度=' + r.len + '  含正文标记=' + r.hasMark + '  含占位说明=' + r.hasPlaceholder + '  含file_id=' + r.hasFileId);
    console.log('     开头: ' + JSON.stringify(r.head));
  }
  console.log('   见过的请求地址:', JSON.stringify(out.seenUrls || []));
  console.log('   协议层记录:', JSON.stringify(out.trace || [], null, 1).slice(0, 1800));
  console.log('   桥接层错误:', JSON.stringify(out.errors || []).slice(0, 900));
  console.log('   诊断:', JSON.stringify(out.diag || {}).slice(0, 900));
  console.log('');
  console.log('================ 结论 ================');
  const cardOk = (out.cards || []).length > 0 && out.cards.every((c) => !c.failed);
  const cacheOk = out.cacheHit > 0;
  // ③ 的判据取自桥接层自己的记录（openai-request.attachment）：
  // 适配层是走内部 originalFetch 发出的，外部包 window.fetch 拦不到它。
  // 这条记录直接说明"翻译后的请求里有没有内联正文"。
  const reqTrace = (out.trace || []).find((e) => e && e.kind === 'openai-request');
  const att = reqTrace && reqTrace.attachment;
  const inlineOk = !!(att && att.inline && !att.unavailable);
  console.log('① 卡片正常（不再上传失败）:', cardOk ? '✅' : '❌');
  console.log('② 正文进入本地缓存        :', cacheOk ? '✅ ' + out.cacheHit + ' 字' : '❌');
  console.log('③ 发送时正文被内联        :',
    inlineOk ? '✅ 已内联（翻译后请求 ' + att.bytes + ' 字节，无占位说明）'
             : '❌ ' + JSON.stringify(att || '未找到 openai-request 记录'));
  console.log('');
  console.log(cardOk && cacheOk && inlineOk
    ? '✅ 全通：粘贴转 txt 不再上传，正文直接内联送达模型'
    : '⚠ 还有环节没通，见上面明细');
} finally {
  await cleanup();
  console.log('（已清理临时 profile）');
}
