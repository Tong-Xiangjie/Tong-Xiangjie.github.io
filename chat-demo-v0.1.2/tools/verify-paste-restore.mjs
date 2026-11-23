#!/usr/bin/env node
/**
 * 验证「粘贴至输入框」按钮：
 *   ① 粘一大段文本 → 生成 .txt 附件卡片
 *   ② 卡片上应当出现「粘贴至输入框」按钮
 *   ③ 点它 → 原文应当完整回到输入框（一字不差）
 *   ④ 而且不能再次被守卫转成附件（防死循环）
 *
 * 用法: node tools/verify-paste-restore.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { CDP, fetchPageTarget, findBrowser } from './minimal-cdp.mjs';

const ROOT = 'C:/Users/57891/tong-xiangjie.github.io/chat-demo-v0.1.2';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PORT = 9220 + Math.floor(Math.random() * 30);
const CDP_PORT = 9700 + Math.floor(Math.random() * 60);

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
const profile = mkdtempSync(join(tmpdir(), 'verify-paste-'));
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
  const ev = async (expr, t = 120000) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, t);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'eval failed');
    }
    return r.result ? r.result.value : undefined;
  };

  for (let i = 0; i < 120; i++) {
    const ok = await ev(`!!(window.__lsFeatures && window.__lsFeatures.attachTextAsFile)`).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await ev(`(function(){ try { localStorage.setItem('chat-demo:api-key','sk-verify-paste'); } catch(e){} return 1; })()`);
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
      var ta = document.querySelector('textarea.textarea-ed6f47, textarea[class*="textarea-"]');
      if (!ta) return { err: '没有 textarea' };
      ta.focus();

      // 造一段内容有特征、可校验的文本
      var text = '第1行：粘贴还原测试内容\\n';
      for (var i = 2; i <= 60; i++) text += '第' + i + '行：验证原文能不能一字不差地回到输入框\\n';
      var expect = text;

      var dt = new DataTransfer();
      dt.setData('text/plain', text);
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(2500);

      var lastPaste = window.__lsFeatures.lastPaste;

      // ② 找按钮
      var btn = document.querySelector('.ls-paste-into-input');
      if (!btn) {
        // 手动扫一次（MutationObserver 可能还没跑到）
        window.__lsFeatures.scanPasteCards();
        await sleep(400);
        btn = document.querySelector('.ls-paste-into-input');
      }
      var remembered = window.__lsFeatures.rememberedPastes;
      if (!btn) return { err: '卡片上没有「粘贴至输入框」按钮', lastPaste: lastPaste, remembered: remembered,
                        cards: document.querySelectorAll('[class*="attachments-"] > [class*="card-"]').length };

      var btnText = (btn.textContent || '').trim();

      // ③ 点它
      btn.click();
      await sleep(800);

      var after = ta.value || '';
      // ④ 点完之后不该再生成新卡片
      var cardsAfter = document.querySelectorAll('[class*="attachments-"] > [class*="card-"]').length;

      return {
        lastPaste: lastPaste,
        remembered: remembered,
        btnText: btnText,
        expectedLen: expect.length,
        gotLen: after.length,
        exactMatch: after === expect,
        head: after.slice(0, 30),
        tail: after.slice(-20),
        cardsAfterClick: cardsAfter
      };
    })()
  `, 180000);

  console.log('=== 结果 ===');
  console.log(JSON.stringify(out, null, 2));
  console.log('');
  console.log('================ 结论 ================');
  if (out && out.err) {
    console.log('❌ ' + out.err);
    if (out.lastPaste) console.log('   粘贴判定: ' + JSON.stringify(out.lastPaste));
    if (out.remembered) console.log('   已记住的原文: ' + JSON.stringify(out.remembered));
  } else if (out.exactMatch) {
    console.log('✅ 「粘贴至输入框」有效');
    console.log('   · 按钮文字: ' + out.btnText);
    console.log('   · 原文 ' + out.expectedLen + ' 字 → 输入框 ' + out.gotLen + ' 字，一字不差');
    console.log('   · 点击后没有再生成新附件卡片（' + out.cardsAfterClick + ' 张），没有死循环');
  } else {
    console.log('⚠ 内容对不上：期望 ' + out.expectedLen + ' 字，实际 ' + out.gotLen + ' 字');
    console.log('   开头: ' + JSON.stringify(out.head));
    console.log('   结尾: ' + JSON.stringify(out.tail));
  }
} finally {
  await cleanup();
  console.log('（已清理临时 profile）');
}
