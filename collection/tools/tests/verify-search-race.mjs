// 边打边搜的「异步覆盖」竞态验收 —— 逐板块跑
//
// 用户报的 bug：
//   输入 2222 → 无结果
//   输入 222  → 有结果
//   此时**快速连续**删掉两个 2 回到 222：应该显示结果，却被 2222 的"无结果"覆盖。
//
// 根因：reconcileWithFLIP / reconcileArticleWithFLIP 在"新列表为空"时排了一个
//   400ms 的 setTimeout 去写空状态，而这个定时器**不检查自己是否已过期**。
//   快速删字符时新结果先渲染好，旧定时器随后醒来把 wrapper.innerHTML 整个换掉。
//   FLIP 的 requestAnimationFrame 有同一类问题（按旧位置表去改新 DOM）。
//
// 判据：过了 400ms 之后，列表必须仍然是**最新查询**的结果。
//
// 板块与代码路径的对应（决定要覆盖哪几条）：
//   纸币 / 硬币 / 专题 → doSearchInner → performSearchAndRender → reconcileWithFLIP   (search.js)
//   文章              → renderArticleList → reconcileArticleWithFLIP                (article.js)
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/`;
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const DP = 10877;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${await mkdtemp(path.join(tmpdir(), 'cdpRace-'))}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
async function wsUrlOf() { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await new Promise(r => setTimeout(r, 250)); } throw new Error('CDP 未就绪'); }
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await wsUrlOf());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function ev(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: BASE });
await sleep(7000);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`    ${c ? '✓' : '✗'} ${m}`); };

// ★ 只数**可见**的条目：三个板块的容器同时存在于 DOM 里，隐藏容器里会留着上一次的
//   结果节点，不筛可见性就会数出一堆无关节点（我第一次诊断就被这个骗了：
//   搜 zzzzzz 竟然"有 330 条"）。
const SNAP = `(()=>{
  const vis = el => el.offsetParent !== null || el.getClientRects().length > 0;
  const items = [...document.querySelectorAll('.search-result-item')].filter(vis);
  const empty = [...document.querySelectorAll('.empty-state')].filter(vis);
  return { items: items.length, empty: empty.length,
           emptyText: empty.map(e=>e.textContent.trim()).join('|').slice(0,36),
           kw: (typeof currentSearchKeyword!=='undefined')?currentSearchKeyword:'?',
           articleKw: (typeof articleSearchKeyword!=='undefined')?articleSearchKeyword:'?' };
})()`;

const type_ = (q) => `(()=>{const i=document.getElementById('searchInput'); if(!i) return false;
  i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`;
const tab = (t) => `(()=>{ if(typeof onTabClick==='function') onTabClick(${JSON.stringify(t)}); return true; })()`;
const ANCHOR = `(()=>{const c=(typeof getRenderContainer==='function')?getRenderContainer():null;
  return c ? (c.style.overflowAnchor || '(空)') : 'no-container';})()`;

// 每个板块的候选关键词（前缀有结果、加尾巴就无结果）
const BOARDS = [
  { tab: 'notes',    name: '纸币', bases: ['2002', '1999', '2008', '1960', '222', '50', '100'] },
  { tab: 'coins',    name: '硬币', bases: ['2002', '1999', '2008', '222', '50', '100'] },
  { tab: 'special',  name: '专题', bases: ['2002', '1999', '2008', '50', '100'] },
  { tab: 'articles', name: '文章', bases: ['生肖', '荷花', '奥运', '人民', '十元'] }
];

console.log('══ 逐板块找可复现的关键词（q 有结果、q+尾巴 无结果）══');
const found = [];
for (const b of BOARDS) {
  await ev(tab(b.tab));
  await sleep(1600);
  const hasInput = await ev(`(()=>!!document.getElementById('searchInput'))()`);
  if (!hasInput) { console.log(`  ${b.name}: 无搜索框，跳过`); continue; }
  let pair = null;
  for (const base of b.bases) {
    await ev(type_(base)); await sleep(800);
    const a = await ev(SNAP);
    if (a.items === 0) continue;
    const bad = base + (b.tab === 'articles' ? 'zzz' : '2');
    await ev(type_(bad)); await sleep(800);
    const c = await ev(SNAP);
    if (c.items === 0 && c.empty > 0) { pair = { good: base, bad, n: a.items }; break; }
  }
  if (pair) { found.push({ ...b, ...pair }); console.log(`  ★ ${b.name}：「${pair.good}」=${pair.n} 条 / 「${pair.bad}」=0 条`); }
  else console.log(`  ${b.name}: 找不到合适组合，跳过`);
}
ok(found.length >= 2, `找到 ${found.length} 个板块的可复现组合`);

for (const b of found) {
  console.log(`\n══ 【${b.name}】快速连续删字符：旧查询的"无结果"不得覆盖新结果 ══`);
  await ev(tab(b.tab));
  await sleep(1600);

  for (const gap of [60, 120, 320]) {
    await ev(type_(b.good)); await sleep(800);
    const before = await ev(SNAP);
    ok(before.items === b.n, `「${b.good}」稳定后是 ${b.n} 条（实际 ${before.items}）`);

    // 先打无结果的串（排下 400ms 空状态定时器），隔 gap 毫秒再"删回"有结果的串
    await ev(type_(b.bad));
    await sleep(gap);
    await ev(type_(b.good));
    const now = await ev(SNAP);
    await sleep(700);   // 越过 400ms 定时器的触发点
    const after = await ev(SNAP);

    console.log(`    间隔 ${String(gap).padStart(3)}ms → 删回后立刻 ${now.items} 条 / 700ms 后 ${after.items} 条 空状态=${after.empty}(${after.emptyText})`);
    ok(after.items === b.n, `间隔 ${gap}ms：最终仍是「${b.good}」的 ${b.n} 条（实际 ${after.items}）`);
    ok(after.empty === 0, `间隔 ${gap}ms：没有被「${b.bad}」的空状态覆盖`);
  }

  // 反向：真的无结果时，空状态必须照常出现
  await ev(type_(b.good)); await sleep(800);
  await ev(type_(b.bad)); await sleep(900);
  const e1 = await ev(SNAP);
  ok(e1.items === 0 && e1.empty > 0, `真无结果时正常显示空状态（items=${e1.items} 空状态=${e1.empty}）`);

  // 慢速输入不受影响
  await ev(type_(b.good)); await sleep(700);
  await ev(type_(b.bad)); await sleep(700);
  const s = await ev(SNAP);
  await ev(type_(b.good)); await sleep(700);
  const s2 = await ev(SNAP);
  ok(s.items === 0 && s.empty > 0, '慢速打到无结果串时正常显示空状态');
  ok(s2.items === b.n, `慢速删回时结果正确（${s2.items} / 期望 ${b.n}）`);

  // 滚动锚定不得被留在 none
  for (const [label, seq] of [
    ['非空 → 空', [b.good, b.bad]],
    ['空 → 非空', [b.bad, b.good]],
    ['非空 → 空 → 非空', [b.good, b.bad, b.good]]
  ]) {
    for (const q of seq) { await ev(type_(q)); await sleep(300); }
    await sleep(900);
    const a = await ev(ANCHOR);
    ok(a !== 'none', `${label} 之后 overflowAnchor 已还原（实际 ${a}）`);
  }
}

console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
child.kill(); server.close();
process.exit(fail ? 1 : 0);
