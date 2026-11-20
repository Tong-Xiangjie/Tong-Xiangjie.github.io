/**
 * 深链接专项：每个对话一个稳定 token，刷新后留在原对话。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { CDP, fetchPageTarget } from './minimal-cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8892;
const CDP_PORT = 9382;
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

const profile = mkdtempSync(join(tmpdir(), 'cdp-deep-'));
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu',
   '--no-first-run', '--window-size=1400,900', `http://127.0.0.1:${PORT}/index.html`], { stdio: 'ignore' });
const target = await fetchPageTarget(CDP_PORT);
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await sleep(3000);
const ev = (e) => cdp.evaluate(e);

console.log('\n=== 深链接测试 ===\n');
console.log('[1] 准备两条对话');

await ev(`
  (async () => {
    const now = Date.now();
    const mk = (id, title, age) => ({
      id, title, createdAt: now - age, updatedAt: now - age, rootMessageId: 'u-' + id,
      messages: [
        { id: 'u-' + id, role: 'user', content: '问题 ' + title, files: [], createdAt: now - age, parentId: null, selectedChildId: 'a-' + id },
        { id: 'a-' + id, role: 'assistant', createdAt: now - age + 1, parentId: 'u-' + id, selectedChildId: null, model: 'deepseek-flash', status: 'done', blocks: [{ type: 'text', text: '回答 ' + title }] }
      ]
    });
    const db = await new Promise((res, rej) => { const rq = indexedDB.open('chat-demo'); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    await new Promise((res) => {
      const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite');
      tx.objectStore('sessions').put(mk('sess-aaa', '甲对话', 100000));
      tx.objectStore('sessions').put(mk('sess-bbb', '乙对话', 50000));
      tx.objectStore('sessionSummaries').put({ id: 'sess-aaa', title: '甲对话', createdAt: now - 100000, updatedAt: now - 100000 });
      tx.objectStore('sessionSummaries').put({ id: 'sess-bbb', title: '乙对话', createdAt: now - 50000, updatedAt: now - 50000 });
      tx.oncomplete = () => res(); tx.onerror = () => res();
    });
    db.close();
    return 'ok';
  })()
`);
await cdp.send('Page.reload');
await sleep(5000);

const start = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const list = L.readSidebarSessions();
    return {
      count: list.length,
      titles: list.map((x) => x.title),
      tokens: list.map((x) => x.token),
      // 全新打开时应该没有「当前对话」
      activeNow: L.activeSession() ? L.activeSession().title : null,
      hash: location.hash
    };
  })())
`));
console.log('    侧边栏: ' + JSON.stringify(start));
check('侧边栏读到两条对话', start.count === 2, JSON.stringify(start));
check('每个对话都有 token', start.tokens.every((t) => typeof t === 'string' && t.length > 0), JSON.stringify(start.tokens));
check('两个 token 不相同', new Set(start.tokens).size === 2, JSON.stringify(start.tokens));
check('打开时不带 hash（新对话）', start.activeNow === null, JSON.stringify(start));

console.log('\n[2] token 稳定性：重新读取不会变');
const again = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    return { tokens: L.readSidebarSessions().map((x) => x.token) };
  })())
`));
check('同一对话的 token 保持不变', JSON.stringify(again.tokens) === JSON.stringify(start.tokens),
  JSON.stringify({ before: start.tokens, after: again.tokens }));

console.log('\n[3] 点开一个对话 → 地址栏应带上它的 token');
const tokenA = start.tokens[start.titles.indexOf('甲对话')];
const clicked = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const list = L.readSidebarSessions();
    const t = list.find((x) => x.title === '甲对话');
    if (!t) return { ok: false };
    t.el.click();
    return { ok: true };
  })())
`));
check('点击侧边栏项成功', clicked.ok === true, JSON.stringify(clicked));
await sleep(1600);

const afterClick = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const act = L.activeSession();
    return { activeTitle: act ? act.title : null, hash: location.hash };
  })())
`));
console.log('    点击后: ' + JSON.stringify(afterClick));
check('当前对话变成了「甲对话」', afterClick.activeTitle === '甲对话', JSON.stringify(afterClick));
check('地址栏带上了该对话的 token', afterClick.hash === '#c=' + tokenA, `期望 #c=${tokenA}，实际 ${afterClick.hash}`);

console.log('\n[4] 刷新后应停留在同一个对话（而不是回到新对话）');
await cdp.send('Page.reload');
await sleep(6000);

const afterReload = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const act = L.activeSession();
    return {
      activeTitle: act ? act.title : null,
      hash: location.hash,
      bodyHasWelcome: /开启新对话|Start a new chat/.test(document.body.innerText || ''),
      bodyHasQuestion: /问题 甲对话/.test(document.body.innerText || '')
    };
  })())
`));
console.log('    刷新后: ' + JSON.stringify(afterReload));
check('刷新后仍在「甲对话」', afterReload.activeTitle === '甲对话', JSON.stringify(afterReload));
check('刷新后地址栏 hash 保留', afterReload.hash === '#c=' + tokenA, JSON.stringify(afterReload));
check('刷新后正文确实显示该对话内容', afterReload.bodyHasQuestion === true, JSON.stringify(afterReload));

console.log('\n[5] 直接粘贴链接（reload 到带 hash 的地址）应跳到对应对话');
const tokenB = start.tokens[start.titles.indexOf('乙对话')];
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html#c=${tokenB}` });
await sleep(6000);
const viaLink = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const act = L.activeSession();
    return { activeTitle: act ? act.title : null, hash: location.hash };
  })())
`));
console.log('    打开链接后: ' + JSON.stringify(viaLink));
check('按链接跳到了「乙对话」', viaLink.activeTitle === '乙对话', JSON.stringify(viaLink));

cdp.close(); chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.close();

console.log('\n' + '='.repeat(46));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
