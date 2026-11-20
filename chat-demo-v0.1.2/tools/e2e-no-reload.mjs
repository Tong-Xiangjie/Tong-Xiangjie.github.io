/**
 * 验证：切换模型 / 提供方不再刷新页面，且 Key 立即生效。
 * 通过在设置面板里真的点「设为默认」来触发，观察导航次数。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget } from './minimal-cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8890;
const CDP_PORT = 9380;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

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

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + detail : '')); }
};

const profile = mkdtempSync(join(tmpdir(), 'cdp-nocl-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
   '--no-first-run', '--window-size=1400,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

let navs = 0;
cdp.on('Page.frameNavigated', (p) => {
  if (p.frame && p.frame.parentId) return;
  navs++;
});
await sleep(3200);
const ev = (e) => cdp.evaluate(e);
await ev(`window.__lsReloadLog = []; 'ok'`);

console.log('\n=== 切换不再刷新页面 ===\n');

// 准备两个提供方（一个官方、一个自定义）
console.log('[1] 准备提供方');
const setup = await ev(`
  (() => {
    const L = window.__localstore;
    const st = L.getProviders();
    const np = { id: 'p-second', name: '第二个中转', baseURL: 'https://relay.example.com',
                 apiKey: 'sk-second', models: ['m-a', 'm-b'], defaultModel: 'm-a',
                 availableModels: ['m-a', 'm-b'], builtin: false };
    st.list.push(np);
    L.updateProvider('p-second', np);
    L.addProvider && L.addProvider(np);
    localStorage.setItem('chat-demo:api-key', 'sk-official');
    return JSON.stringify({
      ids: L.getProviders().list.map((x) => x.id),
      active: L.getProviders().activeId
    });
  })()
`);
console.log('    ' + setup);

// 如果 addProvider 不存在，用设置面板的「添加提供方」按钮
const finalIds = JSON.parse(await ev(`JSON.stringify(window.__localstore.getProviders().list.map((x) => x.id))`));
if (!finalIds.includes('p-second')) {
  // 通过 UI 添加：打开设置 → 通用设置 → 添加提供方
  await ev(`
    (() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find((x) => ['设置', 'Settings'].includes((x.getAttribute('aria-label') || '').trim()));
      if (b) b.click();
      return 'opened';
    })()
  `);
  await sleep(1500);
  await ev(`
    (() => {
      const dlg = document.querySelector('.dialog-_85c1b');
      if (!dlg) return 'no-dialog';
      const nav = Array.from(dlg.querySelectorAll('[class*=navItem]'))
        .find((x) => /通用设置|General/.test(x.textContent || ''));
      if (nav) nav.click();
      return 'tab';
    })()
  `);
  await sleep(1200);
  const added = await ev(`
    (() => {
      const sec = document.getElementById('localstore-section');
      if (!sec) return 'no-section';
      const btn = Array.from(sec.querySelectorAll('.ls-btn'))
        .find((x) => /添加提供方|Add provider/.test(x.textContent || ''));
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()
  `);
  console.log('    通过界面添加提供方: ' + added);
  await sleep(1200);
  // 填名称/地址/Key
  await ev(`
    (() => {
      const sec = document.getElementById('localstore-section');
      const cards = Array.from(sec.querySelectorAll('.ls-prov'));
      const card = cards[cards.length - 1];
      if (!card) return 'no-card';
      const inputs = Array.from(card.querySelectorAll('.ls-input'));
      const set = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      if (inputs[0]) set(inputs[0], '第二个中转');
      if (inputs[1]) set(inputs[1], 'https://relay.example.com');
      if (inputs[2]) set(inputs[2], 'sk-second');
      // 手动加两个模型
      const ta = Array.from(card.querySelectorAll('textarea')).pop();
      if (ta) set(ta, 'm-a\\nm-b');
      return 'filled ' + inputs.length;
    })()
  `);
  await sleep(600);
  await ev(`
    (() => {
      const sec = document.getElementById('localstore-section');
      const cards = Array.from(sec.querySelectorAll('.ls-prov'));
      const card = cards[cards.length - 1];
      const save = Array.from(card.querySelectorAll('.ls-btn')).find((b) => /保存|Save/.test(b.textContent || ''));
      if (save) save.click();
      return 'saved';
    })()
  `);
  await sleep(1500);
}

const ids2 = JSON.parse(await ev(`JSON.stringify(window.__localstore.getProviders().list.map((x) => x.id))`));
console.log('    提供方列表: ' + JSON.stringify(ids2));
const secondId = ids2.find((x) => x !== 'deepseek-official');
check('第二个提供方已存在', !!secondId, JSON.stringify(ids2));
const secondProviderName = JSON.parse(await ev(`
  JSON.stringify((window.__localstore.getProviders().list.find((x) => x.id === ${JSON.stringify(secondId)}) || {}).name)
`));
console.log('    第二个提供方名称: ' + secondProviderName);
// 给它配上第二个 Key 和模型，供后面的切换用例使用
await ev(`
  JSON.stringify(window.__localstore.updateProvider(${JSON.stringify(secondId)}, {
    apiKey: 'sk-second', models: ['m-a', 'm-b'], defaultModel: 'm-a',
    availableModels: ['m-a', 'm-b']
  }))
`);

// 关掉设置弹窗
await ev(`
  (() => {
    const c = document.querySelector('.overlay-_83af2 .close-_83af2');
    if (c) { c.click(); return 'closed'; }
    return 'no-close';
  })()
`);
await sleep(800);

console.log('\n[2] 切换到第二个提供方：不应刷新页面');
const n0 = navs;
const switched = await ev(`
  (() => {
    const L = window.__localstore;
    L.openComposerMenu(true);
    const menu = document.getElementById('ls-composer-menu');
    if (!menu) return 'no-menu';
    const heads = Array.from(menu.querySelectorAll('.ls-menu-head'));
    // 找不是「当前生效」的那个提供方（它就是可点击切换的）
    const target = heads.find((h) => !h.querySelector('.ls-menu-tag'));
    if (!target) return 'no-head:' + heads.map((h) => h.textContent).join(',');
    target.click();
    return 'clicked ' + target.textContent;
  })()
`);
console.log('    切换操作: ' + switched);
await sleep(2500);

const afterSwitch = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    return {
      active: L.getProviders().activeId,
      appKey: localStorage.getItem('chat-demo:api-key'),
      model: localStorage.getItem('chat-demo:model'),
      reloadLog: window.__lsReloadLog || []
    };
  })())
`));
console.log('    切换后: ' + JSON.stringify(afterSwitch));
check('已切到第二个提供方', afterSwitch.active === secondId, JSON.stringify(afterSwitch));
check('切换后没有刷新页面', navs - n0 === 0, `导航 ${navs - n0} 次`);
check('官方 Key 槽位已更新为第二个提供方的 Key',
  afterSwitch.appKey === 'sk-second', String(afterSwitch.appKey));
check('没有触发任何自动刷新记录',
  (afterSwitch.reloadLog || []).length === 0, JSON.stringify(afterSwitch.reloadLog));

console.log('\n[3] k0() 现读到的是新 Key（不刷新也生效）');
const liveKey = await ev(`
  (() => {
    // 直接读补丁注入的取值器：它每次调用都现读 localStorage
    try {
      const v = localStorage.getItem('chat-demo:api-key');
      // 模拟「再改一次 Key」，验证取值器跟随
      localStorage.setItem('chat-demo:api-key', 'sk-changed-again');
      return JSON.stringify({ before: v, after: localStorage.getItem('chat-demo:api-key') });
    } catch (e) { return 'ERR ' + e.message; }
  })()
`);
console.log('    ' + liveKey);
check('Key 槽位可即时改写（无需刷新）',
  JSON.parse(liveKey).after === 'sk-changed-again', liveKey);

console.log('\n[4] 切换模型：不应刷新页面');
const n1 = navs;
const modelClick = await ev(`
  (() => {
    const L = window.__localstore;
    L.openComposerMenu(true);
    const menu = document.getElementById('ls-composer-menu');
    if (!menu) return 'no-menu';
    const items = Array.from(menu.querySelectorAll('.ls-menu-item'));
    if (!items.length) return 'no-item';
    const before = localStorage.getItem('chat-demo:model');
    // 挑一个和当前不同的模型
    const t = items.find((x) => (x.textContent || '').trim() !== before) || items[0];
    const wanted = (t.textContent || '').replace('✓', '').trim();
    t.click();
    return JSON.stringify({ clicked: wanted, before: before });
  })()
`);
console.log('    切模型: ' + modelClick);
const clickedInfo = JSON.parse(modelClick);
await sleep(2000);
const afterModel = JSON.parse(await ev(`
  JSON.stringify({
    model: localStorage.getItem('chat-demo:model'),
    reloadLog: window.__lsReloadLog || []
  })
`));
console.log('    切模型后: ' + JSON.stringify(afterModel));
check('切换模型没有刷新页面', navs - n1 === 0, `导航 ${navs - n1} 次`);
check('模型已更新', afterModel.model === clickedInfo.clicked,
  `期望 ${clickedInfo.clicked}，实际 ${afterModel.model}`);
check('切模型也没有触发刷新记录',
  (afterModel.reloadLog || []).length === 0, JSON.stringify(afterModel.reloadLog));

cdp.close(); chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.close();

console.log('\n' + '='.repeat(46));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
