// 验收：方寸山河的两件事 ——
//   ① 「点进去某个具体省份后切换 tab 再换回来，就会跳到列表视图」（用户报的 bug）
//   ② 「在切换地图和列表视图的时候，← 返回专题 / 方寸山河 / 点击查看山河壮阔 /
//       地 图 / 列 表这些最好都不要动，应该固定，只有下面的东西动」
//
// ① 的根因：enterSpecialTab() 在"切回来"那条路上无条件 currentSubId = null。
//    而进省份时 shanheViewMode 被设成 'list'（为了深链写出 view-list），
//    于是切回来时"视图模式还在、省份没了" ⇒ 渲染出来正好是列表视图。
//    写入口其实一直好的（离开板块时 saveFullState() 已经把 currentSubId 归档），
//    缺的是**读回来**那一步（core.js 的 restoreSpecialSubId）。
//    同一类缺口还有两处：点省份时没同步地址栏、深链里的 g<省> 段没人读 ——
//    于是"刷新/分享那条链接"也回不到那个省。三处都在本用例里守着。
//
// ② 的根因：原来每个渲染函数都 `app.innerHTML = 页头 + 内容`，
//    切视图 = 整页重建 + 整容器播横向滑入 ⇒ 页头跟着一起闪、一起滑。
//
// 判据（确定，能红能绿）：
//   ★ 判断"页头没被动"用的是**节点身份**（切之前给页头各节点打标记，
//     切完还是同一批对象）—— 只比 innerHTML 相同是不够的，重建出来的 HTML 一模一样。
//   ★ 同时要证"内容确实换了"（列表格子出现、地图节点消失），
//     否则"什么都没做"也能让上面那条通过。
//   ★ 切 tab 回来看的是"还是那个省"，并且**不是**列表视图（列表格子数为 0）——
//     这正是用户报的症状。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
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
const BASE = `http://127.0.0.1:${server.address().port}/collection/`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpShanhe-'));
const DP = 17380;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,900', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const J = async e => JSON.parse(await evaluate(`(async function(){ return JSON.stringify(await (async function(){ ${e} })()); })()`));

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const boot = async hash => {
  await send('Page.navigate', { url: BASE + 'index.html' + hash });
  await sleep(4300);
  await evaluate(`window.__sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };`);
};

try {
  await send('Page.enable'); await send('Runtime.enable');
  await boot('#special/shanhe');

  // ─────────── ⓪ 前提自检 ───────────
  console.log('\n══════ ⓪ 前提自检 ══════\n');
  const pre = await J(`var app = getRenderContainer();
    return { view: shanheViewMode, states: document.querySelectorAll('.shanhe-map-wrap .state').length,
             header: !!app.querySelector('.shanhe-header-row'), body: !!app.querySelector('.shanhe-view-body'),
             bodyFn: typeof shanheBodyFor === 'function', restoreFn: typeof restoreSpecialSubId === 'function',
             headerInsideBody: !!(app.querySelector('.shanhe-view-body .shanhe-header-row')) };`);
  ok(pre.states > 10 && pre.header && pre.body && pre.bodyFn,
    `山河地图已就绪、页头与内容区都在（省格 ${pre.states} 个，body=${pre.body}）`);
  ok(pre.restoreFn, `切 tab 还原子类/省份的读出口在（restoreSpecialSubId=${pre.restoreFn}）`);
  ok(pre.headerInsideBody === false, `页头在内容区**外面**（它是固定不动的那一半）`);

  // ─────────── ① 地图 ⇄ 列表：页头原地不动 ───────────
  console.log('\n══════ ① 切换地图/列表：页头一个节点都不重建 ══════\n');
  const sw = await J(`var app = getRenderContainer();
    var back = app.querySelector('.back-bar .back-btn');
    var h2 = app.querySelector('.shanhe-header-row h2');
    var tg = app.querySelector('.shanhe-view-toggle');
    back.setAttribute('data-probe', '1'); h2.setAttribute('data-probe', '1'); tg.setAttribute('data-probe', '1');
    window.__probe = { back: back, h2: h2, tg: tg };
    var before = { view: shanheViewMode, legend: !!app.querySelector('.shanhe-map-legend'),
                   mapInBody: !!app.querySelector('.shanhe-view-body .shanhe-map-wrap') };
    shanheSwitchView('list'); await __sleep(900);
    var inList = { view: shanheViewMode,
      sameBack: app.querySelector('.back-bar .back-btn') === window.__probe.back,
      sameH2: app.querySelector('.shanhe-header-row h2') === window.__probe.h2,
      sameToggle: app.querySelector('.shanhe-view-toggle') === window.__probe.tg,
      marks: app.querySelectorAll('[data-probe]').length,
      active: (app.querySelector('.shanhe-view-btn.active') || {}).textContent,
      bodyClass: (app.querySelector('.shanhe-view-body') || {}).className,
      containerClass: app.className,
      legend: !!app.querySelector('.shanhe-map-legend'),
      cells: document.querySelectorAll('.shanhe-list-cell').length,
      mapInBody: !!app.querySelector('.shanhe-view-body .shanhe-map-wrap'),
      maps: document.querySelectorAll('.shanhe-map-wrap').length };
    shanheSwitchView('map'); await __sleep(1300);
    var backToMap = { view: shanheViewMode,
      sameBack: app.querySelector('.back-bar .back-btn') === window.__probe.back,
      active: (app.querySelector('.shanhe-view-btn.active') || {}).textContent,
      bodyClass: (app.querySelector('.shanhe-view-body') || {}).className,
      legend: !!app.querySelector('.shanhe-map-legend'),
      cells: document.querySelectorAll('.shanhe-list-cell').length,
      mapInBody: !!app.querySelector('.shanhe-view-body .shanhe-map-wrap'),
      maps: document.querySelectorAll('.shanhe-map-wrap').length };
    return { before: before, inList: inList, backToMap: backToMap };`);
  ok(sw.before.view === 'map' && sw.before.legend && sw.before.mapInBody,
    `起点是地图（图例在、地图挂在内容区里）`);
  ok(sw.inList.sameBack && sw.inList.sameH2 && sw.inList.sameToggle && sw.inList.marks === 3,
    `切到列表后，页头三个节点还是原来的对象（标记存活 ${sw.inList.marks}/3）—— 没被重建`);
  ok(sw.inList.cells > 0 && sw.inList.mapInBody === false,
    `同时内容确实换了（列表格子 ${sw.inList.cells} 个、地图已移出内容区）—— 不是"什么都没做"`);
  const inListBodyClass = String(sw.inList.bodyClass || '');
  const inListContainerClass = String(sw.inList.containerClass || '');
  ok(/shanhe-view-enter-right/.test(inListBodyClass) && !/shanhe-view-enter/.test(inListContainerClass),
    `横向滑入动画只加在内容区上（body="${inListBodyClass.trim()}"，容器没有该动画）`);
  ok(sw.inList.active === '列 表' && sw.inList.legend === false,
    `页头就地更新：按钮高亮=${sw.inList.active}、图例只在地图显示（列表这里=${sw.inList.legend}）`);
  ok(sw.backToMap.sameBack && sw.backToMap.active === '地 图' && /shanhe-view-enter-left/.test(String(sw.backToMap.bodyClass || '')),
    `切回地图后仍是同一批页头节点、高亮回"地 图"、动画方向变成从左侧`);
  ok(sw.backToMap.cells === 0 && sw.backToMap.mapInBody && sw.backToMap.maps === 1 && sw.backToMap.legend,
    `地图就位且只有一张（${sw.backToMap.maps} 个 .shanhe-map-wrap），列表格子已清空`);

  // ─────────── ② 点省份 ───────────
  console.log('\n══════ ② 点一个省：进省份详情，地址栏跟上 ══════\n');
  const prov = await J(`var app = getRenderContainer();
    var el = [...app.querySelectorAll('.shanhe-map-wrap .state')]
      .sort((a,b) => parseInt(b.getAttribute('data-count')||'0',10) - parseInt(a.getAttribute('data-count')||'0',10))[0];
    var pid = el.getAttribute('data-pid');
    var count = el.getAttribute('data-count');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await __sleep(1000);
    app = getRenderContainer();
    return { pid: pid, count: count, sub: currentSubId, view: shanheViewMode, hash: location.hash,
             heading: (app.querySelector('.overview-header h2') || {}).textContent,
             back: (app.querySelector('.back-bar .back-btn') || {}).textContent,
             items: document.querySelectorAll('.special-item-card').length,
             cells: document.querySelectorAll('.shanhe-list-cell').length };`);
  ok(prov.sub === prov.pid && prov.items > 0,
    `进了 ${prov.pid} 省详情（${prov.items} 件藏品）—— 不是列表、也不是地图`);
  ok(prov.back === '← 返回地图', `省份页有自己的返回（"${prov.back}"）`);
  ok(prov.hash.indexOf('g' + prov.pid) >= 0,
    `地址栏带上了这个省（${prov.hash}）—— 刷新/分享才回得来`);
  const headingOk = !!prov.heading && prov.heading !== '全部纸币';
  ok(headingOk, `标题是省份名（实测"${prov.heading}"，只看当前容器里的页头）`);

  // ─────────── ③ 切 tab 再切回来（用户报的 bug）───────────
  console.log('\n══════ ③ 切到别的板块再切回专题：还停在那个省 ══════\n');
  const backTab = await J(`onTabClick('notes'); await __sleep(800);
    var mid = { mode: currentMode, hash: location.hash };
    onTabClick('special'); await __sleep(1400);
    var app = getRenderContainer();
    return { mid: mid, sub: currentSubId, view: shanheViewMode, hash: location.hash,
             heading: (app.querySelector('.overview-header h2') || {}).textContent,
             cache: specialPageCaches['shanhe'] ? specialPageCaches['shanhe'].currentSubId : null,
             items: document.querySelectorAll('.special-item-card').length,
             cells: document.querySelectorAll('.shanhe-list-cell').length,
             map: !!document.querySelector('.shanhe-map-wrap') };`);
  ok(backTab.mid.mode === 'notes', `确实切走过（中途 mode=${backTab.mid.mode}，hash=${backTab.mid.hash}）`);
  ok(backTab.sub === prov.pid, `切回来还在 ${prov.pid} 省（currentSubId=${backTab.sub}，记忆里=${backTab.cache}）`);
  ok(backTab.cells === 0 && backTab.items > 0,
    `而且是省份详情、**不是列表视图**（列表格子 ${backTab.cells} 个、藏品卡片 ${backTab.items} 件）—— 用户报的症状`);

  // ─────────── ④ 深链直接打开某个省（刷新/分享那条路）───────────
  console.log('\n══════ ④ 深链 #special/shanhe/g<省>/view-list：落在那个省上 ══════\n');
  await boot('#special/shanhe/g' + prov.pid + '/view-list');
  const deep = await J(`var app = getRenderContainer();
    return { sub: currentSubId, view: shanheViewMode, hash: location.hash,
             heading: (app.querySelector('.overview-header h2') || {}).textContent,
             items: document.querySelectorAll('.special-item-card').length,
             cells: document.querySelectorAll('.shanhe-list-cell').length,
             map: !!document.querySelector('.shanhe-map-wrap') };`);
  ok(deep.sub === prov.pid && deep.items > 0,
    `刷新那条链接落在 ${prov.pid} 省（${deep.items} 件）—— 不再是"掉回地图/列表"`);
  ok(deep.hash.indexOf('g' + prov.pid) >= 0,
    `地址栏没有被改写成"不带省的列表"（${deep.hash}）—— 页面与 URL 一致，刷新位置不丢`);

  // ─────────── ⑤ 坏链接：不存在的省 ⇒ 安静退回地图 ───────────
  console.log('\n══════ ⑤ 链接里写了不存在的省 ⇒ 退回地图，不卡空页 ══════\n');
  await boot('#special/shanhe/gzzz_meiyou_zhege_sheng');
  const bogus = await J(`return { sub: currentSubId, view: shanheViewMode,
    states: document.querySelectorAll('.shanhe-map-wrap .state').length,
    items: document.querySelectorAll('.special-item-card').length,
    header: !!getRenderContainer().querySelector('.shanhe-header-row') };`);
  ok(bogus.sub === null && bogus.states > 10 && bogus.header,
    `退回地图（currentSubId=${bogus.sub}，省格 ${bogus.states} 个，页头在）`);
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
console.log(`  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
if (fail) { console.log(`✗ 山河视图状态检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 山河视图状态检查全部通过（${pass} 项断言${skipped ? `，跳过 ${skipped}` : ''}）`);
