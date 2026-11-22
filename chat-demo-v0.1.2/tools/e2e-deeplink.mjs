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

/* ------------------------------------------------------------------ *
 * [6] 收起侧栏后深链必须还在（用户报的回归）
 *
 * 现象：点侧栏顶部的「收起」后，地址栏的 #c= 会被抹掉，
 *       这时候一刷新就回到主页。
 *
 * 根因：收起时应用把真侧栏摘出 DOM，只留一个替身浮层。
 *       旧实现读不到侧栏 → 「当前对话」判成 null →
 *       跟随逻辑以为用户切到了新对话 → setHashToken(null)。
 *
 * 期望：收起只是个界面状态，地址栏的 #c= 必须保持不变；
 *       展开回来后还要能继续正常跟随。
 * ------------------------------------------------------------------ */
console.log('\n[6] 收起侧栏后地址栏的 #c= 必须保留');

const collapseInfo = JSON.parse(await ev(`
  JSON.stringify((() => {
    const btns = [].slice.call(document.querySelectorAll('.top-ac14ac button[aria-label]'));
    const info = btns.map((b) => b.getAttribute('aria-label'));
    const btn = btns.find((b) => /收起|collapse|hide/i.test(b.getAttribute('aria-label') || ''));
    return { labels: info, found: !!btn };
  })())
`));
check('侧栏里有「收起」按钮', collapseInfo.found === true, JSON.stringify(collapseInfo));

const hashBeforeCollapse = await ev(`location.hash`);
await ev(`
  (() => {
    const btn = [].slice.call(document.querySelectorAll('.top-ac14ac button[aria-label]'))
      .find((b) => /收起|collapse|hide/i.test(b.getAttribute('aria-label') || ''));
    if (btn) btn.click();
  })()
`);
// 收起动画 260ms + 兜底 260ms，留足时间让替身也被移除
await sleep(2000);

const collapsed = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    return {
      hash: location.hash,
      siderInDom: !!document.querySelector('.sider-ac14ac'),
      ghostInDom: !!document.querySelector('.ls-sider-ghost'),
      activeIsUnknown: L.activeSessionOrUnknown ? L.activeSessionOrUnknown() === undefined : null
    };
  })())
`));
console.log('    收起后: ' + JSON.stringify(collapsed));
check('收起后 hash 仍然是 #c=' + tokenB, collapsed.hash === '#c=' + tokenB,
  `收起前 ${hashBeforeCollapse}，收起后 ${collapsed.hash}`);

console.log('\n[7] 收起状态下刷新，仍应回到同一条对话');
/**
 * 明确把"收起"这个偏好写进 localStorage —— 模拟用户收起侧栏后关掉页面、
 * 下次再打开的状态（应用自己也会持久化这个键）。
 *
 * 注意断言的分寸：实测应用在**按深链打开对话时自己会把侧栏展开**
 * （它需要侧栏来呈现对话），所以这里不能断言"刷新后侧栏仍是收起的" ——
 * 那是应用自己的设计选择，不是我们的 bug。要断言的是：
 *   · #c= 不能丢；
 *   · 对话要真的恢复出来；
 *   · 我们不能把用户的偏好**写坏**（键值只能是 true/false 这种合法值）。
 */
await ev(`localStorage.setItem('chat-demo:sider-collapsed', 'true')`);
const lsBeforeReload = await ev(`localStorage.getItem('chat-demo:sider-collapsed')`);
console.log('    刷新前: lsCollapsed=' + lsBeforeReload);
await cdp.send('Page.reload');
await sleep(9000);
const afterCollapseReload = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const act = L.activeSession();
    return {
      activeTitle: act ? act.title : null,
      hash: location.hash,
      bodyHasQuestion: /问题 乙对话/.test(document.body.innerText || ''),
      siderInDom: !!document.querySelector('.sider-ac14ac'),
      lsCollapsed: localStorage.getItem('chat-demo:sider-collapsed'),
      openBtn: !!document.querySelector('.collapsed-ac14ac button'),
      cover: !!document.getElementById('ls-boot-cover')
    };
  })())
`));
console.log('    收起态刷新后: ' + JSON.stringify(afterCollapseReload));
check('收起态刷新后 hash 仍是 #c=' + tokenB, afterCollapseReload.hash === '#c=' + tokenB,
  JSON.stringify(afterCollapseReload));
check('收起态刷新后仍在「乙对话」', afterCollapseReload.activeTitle === '乙对话',
  JSON.stringify(afterCollapseReload));
check('收起态刷新后正文显示该对话', afterCollapseReload.bodyHasQuestion === true,
  JSON.stringify(afterCollapseReload));
check('没有把用户的收起偏好写成非法值',
  afterCollapseReload.lsCollapsed === 'true' || afterCollapseReload.lsCollapsed === 'false',
  JSON.stringify(afterCollapseReload));
check('启动遮罩已经揭开', afterCollapseReload.cover === false, JSON.stringify(afterCollapseReload));

console.log('\n[7b] 收起状态下重复刷新也必须能恢复（不能只成功一次）');
for (let round = 1; round <= 2; round++) {
  await ev(`localStorage.setItem('chat-demo:sider-collapsed', 'true')`);
  await cdp.send('Page.reload');
  await sleep(9000);
  const r = JSON.parse(await ev(`
    JSON.stringify((() => {
      const L = window.__localstore;
      const act = L.activeSession();
      return { activeTitle: act ? act.title : null, hash: location.hash,
        collapsed: localStorage.getItem('chat-demo:sider-collapsed') };
    })())
  `));
  check(`第 ${round} 次收起态刷新后仍在「乙对话」`, r.activeTitle === '乙对话', JSON.stringify(r));
  check(`第 ${round} 次 hash 仍然保留`, r.hash === '#c=' + tokenB, JSON.stringify(r));
}

console.log('\n[8] 展开侧栏后跟随逻辑要恢复正常');
await sleep(1500);
await ev(`
  (() => {
    const b = document.querySelector('.collapsed-ac14ac button');
    if (b) b.click();
  })()
`);
await sleep(2500);
const afterExpand = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const act = L.activeSession();
    return { activeTitle: act ? act.title : null, hash: location.hash,
      siderInDom: !!document.querySelector('.sider-ac14ac') };
  })())
`));
console.log('    展开后: ' + JSON.stringify(afterExpand));
check('展开后侧栏回来了', afterExpand.siderInDom === true, JSON.stringify(afterExpand));
check('展开后当前对话仍是「乙对话」', afterExpand.activeTitle === '乙对话',
  JSON.stringify(afterExpand));
check('展开后 hash 仍正确', afterExpand.hash === '#c=' + tokenB, JSON.stringify(afterExpand));

// 展开后再切一次对话，确认跟随没有被"粘住"
const switched = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    const list = L.readSidebarSessions();
    const t = list.find((x) => x.title === '甲对话');
    if (!t) return { ok: false };
    const before = list.filter((x) => x.active).map((x) => x.title);
    const propsKey = Object.keys(t.el).find((k) => k.indexOf('__reactProps$') === 0);
    t.el.click();
    return { ok: true, beforeActives: before, hasProps: !!propsKey,
      rect: (function(){ const r = t.el.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() };
  })())
`));
await sleep(2000);
const afterSwitch = JSON.parse(await ev(`
  JSON.stringify((() => {
    const L = window.__localstore;
    return { hash: location.hash,
      actives: L.readSidebarSessions().filter((x) => x.active).map((x) => x.title),
      sticky: (L.activeSession() || {}).title || null };
  })())
`));
console.log('    切换前: ' + JSON.stringify(switched) + '  切换后: ' + JSON.stringify(afterSwitch));
check('切对话成功', switched.ok === true, JSON.stringify(switched));
check('应用把 active 标记挪到了「甲对话」',
  Array.isArray(afterSwitch.actives) && afterSwitch.actives.indexOf('甲对话') >= 0,
  JSON.stringify(afterSwitch));
check('收起再展开之后，地址栏仍能跟着切换对话', afterSwitch.hash === '#c=' + tokenA,
  `期望 #c=${tokenA}，实际 ${afterSwitch.hash}`);

cdp.close(); chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
server.close();

console.log('\n' + '='.repeat(46));
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
