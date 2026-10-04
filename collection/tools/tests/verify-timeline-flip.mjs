// 币海拾年 · 时间轴「搜索式进出场」验收（用户新要求）：
//   ① 反复点**同一个**时间段（同一个格子/年份/月份/全部）不该重渲染，就像反复点同一个 tab；
//   ② 真的换了时间段时，下面的列表要像"纸币/硬币搜索结果"那样条目自己滑进滑出
//      （位移同时含左右与上下），而不是整块重刷一下；
//   ③ 文章版块用的是同一套动画（既有行为，用这条钉住，防止以后被改回纯淡入）；
//   ④ 动画结束后不能留下内联 style 或退场替身（否则会污染后续渲染与命中测试）。
//
// ★ 采样方式：条目从"起始态"到"落位"只隔一帧，隔几十毫秒再去查内联 transform 是抓不到的。
//   所以用 MutationObserver 记录**节点插入那一刻**的 transform —— 这才是可靠证据。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? (pass++, console.log(`  ✓ ${m}${extra ? '  ' + extra : ''}`)) : (fail++, console.log(`  ✗ ${m}${extra ? '  ' + extra : ''}`)); };

// ─────────── ① 静态：守卫与 FLIP 的形态 ───────────
console.log('══════ ① 静态：重复点击守卫 + FLIP 实现 ══════\n');
const sp = readFileSync('collection/special.js', 'utf8');
const css = readFileSync('collection/layout.css', 'utf8');

ok(/function\s+snapshotTimelineFlip/.test(sp), '① 有 snapshotTimelineFlip（改 DOM 前量旧位置）');
ok(/function\s+playTimelineFlip/.test(sp), '① 有 playTimelineFlip（改完算位移并播动画）');

const fci = sp.slice(sp.indexOf('function onTimelineFilterChangeInner'), sp.indexOf('// ---------- 返回专题概览'));
ok(/timelineFilterYear\s*===\s*|===\s*timelineFilterYear/.test(fci), '① 筛选变更里有"新旧年份相同"的判断');
ok(/timelineFilterMonth\s*===\s*|===\s*timelineFilterMonth/.test(fci), '① 筛选变更里有"新旧月份相同"的判断');
ok(/return\s+false/.test(fci), '① 相同则提前返回（不重渲染）');
ok(fci.indexOf('return false') < fci.indexOf('rerenderTimeline()'), '① 提前返回发生在 rerenderTimeline() 之前');
ok(/function setTimelineOrderInner[\s\S]{0,160}timelineSortOrder === order[\s\S]{0,40}return/.test(sp), '① 换排序本来就有同款守卫（新加的必须与它一致）');

const play = sp.slice(sp.indexOf('function playTimelineFlip'), sp.indexOf('function playTimelineFlip') + 4200);
ok(/translateX\(/.test(play), '① 新条目从右侧滑入（translateX，与搜索结果一致）');
ok(/dx/.test(play) && /dy/.test(play), '① 保留的条目同时算左右(dx)与上下(dy)位移');
ok(/timeline-flip-ghost/.test(play), '① 被筛掉的条目会做退场替身（class 名 timeline-flip-ghost）');
ok(/cloneNode/.test(sp.slice(sp.indexOf('function snapshotTimelineFlip'), sp.indexOf('function playTimelineFlip'))), '① 退场替身用克隆（时间轴是整块 innerHTML 重建，旧节点已经不在了）');
ok(/prefers-reduced-motion/.test(play) || /prefers-reduced-motion/.test(css), '① 有 reduced-motion 兜底（沿用站内既有写法）');

// ─────────── 起服务 + 无头浏览器 ───────────
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full)) { res.writeHead(404).end('nf'); return; }
    if ((await stat(full)).isDirectory()) { res.writeHead(302, { Location: p + '/index.html' }).end(); return; }
    const buf = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpFlip-'));
const DP = 12700 + Math.floor(Math.random() * 120);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const pageErrors = [];
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.text || 'exception');
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

await send('Runtime.enable'); await send('Page.enable');
// ★ 把 prefers-reduced-motion 钉成 no-preference：GitHub 的 Windows runner 默认关闭系统动画，
//   Chrome 会报 reduce，于是"动画应该播"的断言在 CI 上必然红（本用例 2026-10 就是这样挂的）。
//   这是用例自身依赖了宿主机偏好，不是被测代码的问题。
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.navigate', { url: BASE });
let loaded = false;
for (let i = 0; i < 220; i++) { if (await evaluate(`typeof onTabClick === 'function' && document.readyState === 'complete'`).catch(() => false)) { loaded = true; break; } await sleep(120); }
ok(loaded, '页面加载完成');

// 装一个"插入瞬间"记录器：把节点插进 DOM 那一刻的 transform 记下来
await evaluate(`(()=>{
  window.__flip = { item: [], ghost: [], article: [] };
  const note = (root) => {
    if (!root || root.nodeType !== 1) return;
    const push = (el, bucket) => { if (el.classList) window.__flip[bucket].push(el.style.transform || '(none)'); };
    if (root.classList && root.classList.contains('timeline-item')) push(root, 'item');
    if (root.classList && root.classList.contains('timeline-flip-ghost')) push(root, 'ghost');
    if (root.classList && root.classList.contains('search-result-item')) push(root, 'article');
    if (root.querySelectorAll) {
      root.querySelectorAll('.timeline-item').forEach(e => push(e, 'item'));
      root.querySelectorAll('.timeline-flip-ghost').forEach(e => push(e, 'ghost'));
      root.querySelectorAll('.search-result-item').forEach(e => push(e, 'article'));
    }
  };
  const mo = new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) note(n); });
  mo.observe(document.body, { childList: true, subtree: true });
  window.__flipMo = mo;
  return 1;
})()`);
const resetFlip = () => evaluate(`(()=>{ window.__flip = { item: [], ghost: [], article: [] }; return 1; })()`);

// 走真实入口进时间轴：专题 tab → 专题概览 → 时间轴卡片
await evaluate(`onTabClick('special')`).catch(e => console.log('  切专题 tab 失败：' + e.message));
await sleep(900);
await evaluate(`onSpecialOverviewItemClick('timeline')`).catch(e => console.log('  进时间轴失败：' + e.message));
await sleep(1200);
let itemCount = await evaluate(`document.querySelectorAll('.timeline-item').length`).catch(() => 0);
if (!itemCount) {                                        // 兜底：直接渲染
  await evaluate(`(()=>{ selectedSpecial = 'timeline'; currentMode = MODE.SPECIAL; renderTimelineContent(getSpecialConfigs().find(c => c.id === 'timeline'), {}); return 1; })()`).catch(() => {});
  await sleep(900);
  itemCount = await evaluate(`document.querySelectorAll('.timeline-item').length`).catch(() => 0);
}
ok(itemCount > 0, `时间轴列表渲染出来了（${itemCount} 个条目）`);

// 计数器：把 renderTimelineContent 包一层，数它被调用了几次
await evaluate(`(()=>{ if (!window.__rtCount) { window.__rtCount = 0; const orig = window.renderTimelineContent; window.renderTimelineContent = function () { window.__rtCount++; return orig.apply(this, arguments); }; } return 1; })()`);
// ★ FLIP 的"起始态"是在插入 DOM **之后**才设的，MutationObserver 看不到，
//   所以在 playTimelineFlip 外面包一层，在它返回那一刻取真实状态 —— 这才是可靠证据。
await evaluate(`(()=>{
  if (window.__flipProbe) return 1;
  window.__flipProbe = [];
  const orig = window.playTimelineFlip;
  window.playTimelineFlip = function (app, snap) {
    const ret = orig.apply(this, arguments);
    const items = [...document.querySelectorAll('.timeline-item')];
    const de = document.scrollingElement || document.documentElement;
    const appEl = (typeof getRenderContainer === 'function') ? getRenderContainer() : null;
    const bodyEl = document.querySelector('.timeline-body');
    window.__flipProbe.push({
      enter: items.filter(e => /^translate\\(40/.test(e.style.transform || '')).length,
      moving: items.filter(e => /translate/.test(e.style.transform || '')).length,
      total: items.length,
      ghosts: document.querySelectorAll('.timeline-flip-ghost').length,
      // ★ 位移期间不能撑出横向滚动条（用户反馈过；见 layout.css 里 .timeline-body 的注释）
      docOver: de.scrollWidth - de.clientWidth,
      appOver: appEl ? appEl.scrollWidth - appEl.clientWidth : 0,
      bodyOver: bodyEl ? bodyEl.scrollWidth - bodyEl.clientWidth : 0
    });
    return ret;
  };
  return 1;
})()`);
const resetProbe = () => evaluate(`(()=>{ window.__flipProbe = []; return 1; })()`);
const probe = async () => JSON.parse(await evaluate(`JSON.stringify(window.__flipProbe)`));
const count = () => evaluate(`window.__rtCount`);

// ★ 位移期间不能撑出横向滚动条：CSS 变换会撑大**可滚动溢出区**，站内之前踩过这个坑
//   （用户这次又反馈："左右滑动的时候会出现左右方向的滚动条"）。
//   注意只看页面和内容容器两层：.timeline-body 自己加了 overflow-x: clip 之后不再是
//   滚动容器，但它内部被裁掉的内容仍然计入 scrollWidth —— 拿它断言会误报。
function okNoHScroll(p, where) {
  const docOver = p.docOver || 0;
  const appOver = p.appOver || 0;
  ok(docOver <= 1 && appOver <= 1,
    `★ ${where}的瞬间没有横向滚动条（页面溢出 ${docOver}px，内容容器溢出 ${appOver}px）`);
}
const clickCell = (row, col) => evaluate(`(()=>{ const r = document.querySelectorAll('.tl-heatmap-row:not(.tl-hm-head)')[${row}]; const c = r && r.querySelectorAll('.tl-heatmap-cell')[${col}]; if (!c) return 'no-cell'; c.click(); return 1; })()`);
const clickCorner = () => evaluate(`(()=>{ const c = document.querySelector('.tl-hm-corner'); if (!c) return 'no-corner'; c.click(); return 1; })()`);
const clickYear = (i) => evaluate(`(()=>{ const y = [...document.querySelectorAll('.tl-heatmap-ylabel')].filter(e => !e.classList.contains('tl-hm-corner'))[${i}]; if (!y) return 'no-year'; y.click(); return 1; })()`);

// ─────────── ② 反复点同一时间段：不重渲染 ───────────
console.log('\n══════ ② 反复点同一个时间段不该反复刷新 ══════\n');
{
  await clickCorner(); await sleep(900);                    // 起点：全部
  const base = await count();
  const hadItem = await evaluate(`document.querySelectorAll('.timeline-item').length`);
  ok(hadItem > 0, `起点是"全部时间"，列表有 ${hadItem} 个条目`);

  await clickCell(0, 0); await sleep(900);
  const afterFirst = await count();
  ok(afterFirst === base + 1, `点一个格子重渲染一次（${base} → ${afterFirst}）`);
  ok(await evaluate(`timelineFilterYear !== '全部' || timelineFilterMonth !== '全部'`), '筛选确实变了（' + await evaluate(`timelineFilterYear + '/' + timelineFilterMonth`) + '）');

  for (let i = 0; i < 3; i++) { await clickCell(0, 0); await sleep(350); }
  const afterRepeat = await count();
  ok(afterRepeat === afterFirst, `★ 反复点同一个格子不再重渲染（仍是 ${afterRepeat} 次）`);

  const c1 = await count();
  await clickYear(0); await sleep(900);
  const c2 = await count();
  ok(c2 === c1 + 1, `点年份标签重渲染一次（${c1} → ${c2}）`);
  await clickYear(0); await sleep(350);
  await clickYear(0); await sleep(350);
  const c3 = await count();
  ok(c3 === c2, `★ 反复点同一个年份标签不再重渲染（仍是 ${c3} 次）`);

  await clickCorner(); await sleep(900);
  const c4 = await count();
  await clickCorner(); await sleep(350);
  await clickCorner(); await sleep(350);
  const c5 = await count();
  ok(c5 === c4, `★ 反复点"全部"不再重渲染（仍是 ${c5} 次）`);
  ok(await evaluate(`timelineFilterYear === '全部' && timelineFilterMonth === '全部'`), '最终回到"全部时间"');
}

// ─────────── ③ 真换时间段：搜索式进出场 ───────────
console.log('\n══════ ③ 换时间段时条目自己滑进滑出 ══════\n');
{
  // A. 全部 → 某一年：删掉大量条目 → 应有退场替身；保留条目应有 FLIP 位移
  await resetProbe();
  await clickYear(0);
  await sleep(900);
  const a = (await probe()).at(-1) || { enter: 0, moving: 0, total: 0, ghosts: 0 };
  ok(a.ghosts > 0 || a.moving > 0,
    `★ 收窄筛选时播了进出场（退场替身 ${a.ghosts} 个，带位移的条目 ${a.moving}/${a.total}）`);
  const aClean = JSON.parse(await evaluate(`JSON.stringify({ ghosts: document.querySelectorAll('.timeline-flip-ghost').length, bodyGhosts: [...document.body.children].filter(e => e.classList.contains('timeline-flip-ghost')).length, residue: [...document.querySelectorAll('.timeline-item')].filter(e => (e.style.transform || '') !== '' || (e.style.opacity || '') !== '').length })`));
  ok(aClean.ghosts === 0 && aClean.bodyGhosts === 0, `★ 动画结束后退场替身被清掉（残留 ${aClean.ghosts} 个）`);
  ok(aClean.residue === 0, `★ 动画结束后条目不留内联 transform/opacity（残留 ${aClean.residue} 个）`);
  okNoHScroll(a, '收窄筛选');

  // B. 这一年 → 全部：新增大量条目 → 新条目应从右侧滑入
  await resetProbe();
  await clickCorner();
  await sleep(900);
  const b = (await probe()).at(-1) || { enter: 0, moving: 0, total: 0, ghosts: 0 };
  ok(b.enter > 0, `★ 放开筛选时新条目从右侧滑入（${b.enter} 个处于 translateX(40px) 起始态，共播 ${b.moving} 个）`);
  const bClean = await evaluate(`[...document.querySelectorAll('.timeline-item')].filter(e => (e.style.transform || '') !== '' || (e.style.opacity || '') !== '').length`);
  ok(bClean === 0, `★ 动画结束后同样不留残留（残留 ${bClean} 个）`);
  ok(await evaluate(`document.querySelectorAll('.timeline-flip-ghost').length`) === 0, '退场替身也清干净了');
  // 屏幕外的条目不播（否则一次三百多个元素一起动画会卡）：播的数量应远小于总条目数
  ok(b.total > 100 && b.moving < b.total, `★ 只给可视区附近的条目播动画（播 ${b.moving} 个，共 ${b.total} 个，屏幕外的直接落位）`);
  okNoHScroll(b, '放开筛选');
}

// ─────────── ④ 文章版块用的是同一套动画 ───────────
console.log('\n══════ ④ 文章版块的进出场 ══════\n');
{
  await resetFlip();
  await evaluate(`onTabClick('articles')`).catch(e => console.log('  切文章 tab 失败：' + e.message));
  await sleep(1500);
  const art = JSON.parse(await evaluate(`JSON.stringify(window.__flip)`));
  const artItems = await evaluate(`document.querySelectorAll('.article-dynamic-wrapper .search-result-item').length`).catch(() => 0);
  const artSliding = art.article.filter(t => /translateX/.test(t)).length;
  ok(!!(await evaluate(`!!document.querySelector('.article-dynamic-wrapper')`)), '文章列表容器在');
  ok(artSliding > 0 || art.ghost.length > 0,
    `★ 文章版块用的是同一套动画（${artSliding}/${artItems} 个插入时带 translateX）`);
  await sleep(1000);
  const artClean = await evaluate(`document.querySelectorAll('.article-delete-anim').length`).catch(() => -1);
  ok(artClean === 0, `★ 文章版块动画结束后没有残留替身（${artClean} 个）`);
}

// ─────────── ⑤ 从无到有 / 从有到无 ───────────
// 用户反馈"缺少从无到有的动画"：上一屏是空状态时一个 .timeline-item 都没有，
// 早先 playTimelineFlip 见到 snap.items 为空就提前返回，于是新条目直接蹦出来。
console.log('\n══════ ⑤ 空 ↔ 有 两个方向都要有动画 ══════\n');
{
  // ★ ④ 刚把界面切到文章版块，得先回到时间轴 —— 否则点的是留在旧容器里的热力图 DOM。
  await evaluate(`onTabClick('special')`).catch(() => {});
  await sleep(700);
  await evaluate(`onSpecialOverviewItemClick('timeline')`).catch(() => {});
  await sleep(1100);
  const backOnTimeline = await evaluate(`document.querySelectorAll('.tl-heatmap-cell').length`);
  ok(backOnTimeline > 0, `回到时间轴（热力图 ${backOnTimeline} 个格子）`);

  // 找一个"一件都没有"的格子（tooltip 文案是 共购入0件）
  const emptyCell = await evaluate(`(()=>{
    const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
    const c = cells.find(x => { const t = x.querySelector('.tl-heatmap-tip'); return t && /共购入0件/.test(t.textContent); });
    if (!c) return 'none';
    c.click();
    return c.getAttribute('aria-label') || 'ok';
  })()`);
  await sleep(900);
  const emptyState = JSON.parse(await evaluate(`JSON.stringify({
    items: document.querySelectorAll('.timeline-item').length,
    empty: !!document.querySelector('.empty-state'),
    enterCls: !!document.querySelector('.empty-state.timeline-empty-enter'),
    text: (document.querySelector('.empty-state') || {}).textContent ? document.querySelector('.empty-state').textContent.slice(0, 24) : ''
  })`));
  ok(emptyCell !== 'none', `找到一个 0 件的格子并点了它（${emptyCell}）`);
  ok(emptyState.items === 0 && emptyState.empty, `列表变成空状态（条目 ${emptyState.items} 个）`);
  ok(emptyState.enterCls, '★ 空状态自己有淡入（.timeline-empty-enter，从"有"到"无"不是硬蹦出来）');

  // 从空状态放开到"全部"：这就是"从无到有"，必须有滑入动画
  await resetProbe();
  await clickCorner();
  await sleep(900);
  const fromEmpty = (await probe()).at(-1) || { enter: 0, moving: 0, total: 0, ghosts: 0 };
  ok(fromEmpty.total > 0, `放开后列表又满了（${fromEmpty.total} 个条目）`);
  ok(fromEmpty.enter > 0,
    `★ 从空状态放开时新条目有滑入动画（${fromEmpty.enter} 个处于 translateX(40px) 起始态）—— 这就是"从无到有的动画"`);
  okNoHScroll(fromEmpty, '从空状态放开');
  const cleanAfter = await evaluate(`[...document.querySelectorAll('.timeline-item')].filter(e => (e.style.transform || '') !== '' || (e.style.opacity || '') !== '').length`);
  ok(cleanAfter === 0, `动画结束后不留残留（残留 ${cleanAfter} 个）`);
  ok(await evaluate(`document.querySelectorAll('.timeline-flip-ghost').length`) === 0, '退场替身也清干净了');

  // 收尾：回到全部时间
  await evaluate(`applyTimelineFilter('全部','全部')`);
  await sleep(600);
}

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
console.log(`  ${pageErrors.length === 0 ? '✓' : '✗'} 未捕获异常（${pageErrors.length} 条）${pageErrors.length ? '：' + pageErrors.slice(0, 2).join(' | ') : ''}`);
try { ws.close(); } catch {}
child.kill(); server.close();
process.exit(fail === 0 ? 0 : 1);
