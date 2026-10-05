// 验收：① 价格列表展开态跨板块保持 / ② 模糊搜索说明 / ④ 概览页滚动状态
//       ⑪ 手机窄屏（侧边栏展开）下「冠号 + 详细信息」那一行不越界
// 用法：node verify-4issues.mjs           → 跑本地工作区
//       LIVE=1 node verify-4issues.mjs    → 跑线上 GitHub Pages（部署后真机验证）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const LIVE = process.env.LIVE === '1';
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
const BASE = LIVE
  ? 'https://tong-xiangjie.github.io/collection/index.html'
  : `http://127.0.0.1:${server.address().port}/collection/index.html`;
console.log(`目标：${LIVE ? '线上 GitHub Pages' : '本地工作区'}\n`);

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpV4-'));
// ★ 调试端口不能写死：本地回归和线上验证可能同时在跑，
//   两个 Chrome 抢同一个端口时后者会连上前者，Page.navigate 互相打断，
//   报出来是"onTabClick is not defined"这种莫名其妙的加载失败。
const DP = 10900 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  // ★ 等"首个视图容器已经渲染出来"，而不是只等全局函数出现：
  //   线上是几十个 <script src> 逐个下载的，函数早就有了但首屏还没渲染完
  //   （本地文件秒开，所以只有线上会踩这个坑）。
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof viewScrollContainers!=='undefined'
      && typeof onTabClick==='function'
      && document.readyState==='complete'
      && Object.keys(viewScrollContainers).length>0)()`).catch(() => false);
    if (r) break;
    await sleep(300);
  }
  await sleep(1800);
}
const SCROLL_OF = `(() => {
  for (const k of Object.keys(viewScrollContainers)) { const e=viewScrollContainers[k];
    if (e && e.style.display !== 'none') return { key:k, y:e.scrollTop, max: e.scrollHeight - e.clientHeight }; }
  return { key:'(无)', y:-1, max:0 };
})()`;
const priceOpen = `(()=>{const b=document.getElementById('priceListBody');return b?b.classList.contains('open'):null})()`;

try {
  await send('Page.enable'); await send('Runtime.enable');

  // ══════════════ ① 价格列表展开态 ══════════════
  console.log('══════ ① 价格列表展开状态跨板块保持 ══════');
  await boot('settings');
  ok(await evaluate(`(()=>!!document.getElementById('priceListBody'))()`) === true, '设置页渲染出价格列表');
  ok(await evaluate(priceOpen) === false, '默认是收起的');
  await evaluate(`(()=>{ document.querySelector('.price-list-header').click(); return true; })()`);
  await sleep(300);
  ok(await evaluate(priceOpen) === true, '点标题能展开');
  ok(await evaluate(`(()=>{const a=document.getElementById('priceListArrow');return a?a.classList.contains('open'):null})()`) === true, '箭头同时进入 open 态');

  await evaluate(`(()=>{ onTabClick('notes'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2200);
  ok(await evaluate(priceOpen) === true, '★ 切到纸币再切回「我的」，仍然展开');

  // 反向验证：收起之后切走再回来，必须仍然是收起的（不能只会"保持展开"）
  await evaluate(`(()=>{ document.querySelector('.price-list-header').click(); return true; })()`);
  await sleep(300);
  ok(await evaluate(priceOpen) === false, '再点一下能收起');
  await evaluate(`(()=>{ onTabClick('coins'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2200);
  ok(await evaluate(priceOpen) === false, '★ 收起状态切走再回来也是收起（不是无脑保持展开）');

  // 同一页内的重渲染（切评级页签）也要保持
  await evaluate(`(()=>{ document.querySelector('.price-list-header').click(); return true; })()`);
  await sleep(300);
  await evaluate(`(()=>{ switchRatingMode('coins'); return true; })()`);
  await sleep(600);
  ok(await evaluate(priceOpen) === true, '切评级页签（同页重渲染）后仍然展开');

  // ══════════════ ② 模糊搜索说明 ══════════════
  console.log('\n══════ ② 模糊搜索下面的说明 ══════');
  const desc = await evaluate(`(()=>{
    const sw=document.getElementById('articleFuzzySwitch');
    if(!sw) return JSON.stringify({err:'没有开关'});
    const card=sw.closest('.toggle-card');
    if(!card) return JSON.stringify({err:'没有卡片'});
    const inside=card.querySelector('.toggle-desc');
    const sib=card.nextElementSibling;
    const isSibDesc = !!(sib && sib.classList && sib.classList.contains('toggle-desc'));
    const d = inside || (isSibDesc ? sib : null);
    const cs=d?getComputedStyle(d):null;
    const cr=card.getBoundingClientRect(), dr=d?d.getBoundingClientRect():null;
    return JSON.stringify({ text:d?d.textContent.trim():null, fs:cs?cs.fontSize:null, color:cs?cs.color:null,
      insideCard: !!inside, isNextSibling: isSibDesc,
      belowCard: !!(dr && dr.top >= cr.bottom - 1),
      gap: dr ? Math.round(dr.top - cr.bottom) : null,
      leftAligned: dr ? Math.round(dr.left - cr.left) : null,
      cardText:card.textContent.trim().slice(0,20) });
  })()`);
  const d = JSON.parse(desc);
  console.log(`  说明文案：${d.text}`);
  console.log(`  位置：在卡片内=${d.insideCard}  是卡片的下一个兄弟=${d.isNextSibling}  在卡片下方=${d.belowCard}（间距 ${d.gap}px，左缩进 ${d.leftAligned}px）`);
  ok(!!d.text && d.text.length > 20, '模糊搜索卡片下有说明文字');
  ok(d.insideCard === false, '★ 说明不在卡片（按钮）内部');
  ok(d.isNextSibling === true, '★ 说明是卡片的下一个兄弟节点（即"按钮下面"）');
  ok(d.belowCard === true, '★ 说明在卡片的几何下方');
  ok(d.leftAligned >= 10 && d.leftAligned <= 16, `说明左缩进对齐卡片内容（实测 ${d.leftAligned}px，卡片 padding 12 + 边框 1）`);
  ok(d.fs === '11.52px' || (d.fs && parseFloat(d.fs) < 13), `说明用的是 .toggle-desc 小字（font-size=${d.fs}）`);
  ok(!/央行|荷花钞/.test(d.text || ''), '说明里没有举例（按你的要求）');
  ok(/同义词/.test(d.text || ''), '说明讲清了"按同义词表扩展"');
  ok(/文章板块/.test(d.text || ''), '说明讲清了作用范围只限文章板块');
  // ★ 关键行为：点说明文字**不应该**切换开关（放卡片外面就是为了这个）
  const before = await evaluate(`(()=>document.getElementById('articleFuzzySwitch').classList.contains('on'))()`);
  await evaluate(`(()=>{ const sw=document.getElementById('articleFuzzySwitch'); const c=sw.closest('.toggle-card');
    const dd=c.nextElementSibling; dd.click(); return true; })()`);
  await sleep(400);
  const after = await evaluate(`(()=>document.getElementById('articleFuzzySwitch').classList.contains('on'))()`);
  ok(after === before, `★ 点说明文字不会切换开关（${before} → ${after}）`);
  // 反向验证：点卡片本身仍然要能切换
  await evaluate(`(()=>{ document.getElementById('articleFuzzySwitch').closest('.toggle-card').click(); return true; })()`);
  await sleep(400);
  const after2 = await evaluate(`(()=>document.getElementById('articleFuzzySwitch').classList.contains('on'))()`);
  ok(after2 !== before, `★ 点卡片本身仍然能切换开关（${before} → ${after2}）`);
  await evaluate(`(()=>{ document.getElementById('articleFuzzySwitch').closest('.toggle-card').click(); return true; })()`);
  await sleep(400);
  const others = await evaluate(`(()=>{
    const ids=['gridOriginalSwitch','precacheAutoSwitch'];
    return JSON.stringify(ids.map(id=>{ const s=document.getElementById(id); const c=s&&s.closest('.toggle-card');
      return { id, hasDesc: !!(c&&(c.querySelector('.toggle-desc')||(c.nextElementSibling&&c.nextElementSibling.classList&&c.nextElementSibling.classList.contains('toggle-desc')))) }; }));
  })()`);
  for (const o of JSON.parse(others)) ok(o.hasDesc === false, `${o.id} 没有被顺带加上说明（只改了模糊搜索那一处）`);
  // 反向验证：不传 desc 时不产生空节点
  ok(await evaluate(`(()=>{ const h=renderToggleRow('tmpX','临时',false,'void 0'); return h.indexOf('toggle-desc')===-1; })()`) === true, '不传 desc 时不会渲染出空的 .toggle-desc');

  // ══════════════ ④ 概览页滚动状态 ══════════════
  console.log('\n══════ ④ 概览页滚动状态 ══════');
  // (a) 全局概览：切 tab 往返保留
  await boot('notes');
  await evaluate(`(()=>{ getRenderContainer().scrollTop=900; return true; })()`); await sleep(500);
  const a1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onTabClick('coins'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('notes'); return true; })()`); await sleep(2200);
  const a2 = await evaluate(SCROLL_OF);
  console.log(`  全局概览 ${a1.y} → ${a2.y}（容器 ${a2.key}）`);
  ok(a2.y > 0, `★ 全局概览滚动位置一直保留（${a1.y} → ${a2.y}）`);

  // (b) 含子类的分类概览（票证）：切 tab 往返保留
  await boot('notes/ticket');
  const b1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ getRenderContainer().scrollTop=Math.min(600, getRenderContainer().scrollHeight); return true; })()`); await sleep(500);
  const b2 = await evaluate(SCROLL_OF);
  console.log(`  票证概览滚到 ${b2.y}（容器 ${b2.key}，可滚 ${b2.max}）`);
  await evaluate(`(()=>{ onTabClick('coins'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('notes'); return true; })()`); await sleep(2500);
  const b3 = await evaluate(SCROLL_OF);
  console.log(`  切 tab 往返后 ${b3.y}（容器 ${b3.key}）`);
  ok(b3.y === b2.y, `★ 同一分类内切 tab 往返，票证概览滚动保留（${b2.y} → ${b3.y}）`);

  // (c) 同板块内往返：票证概览 → 国库券 → 返回票证概览，保留
  await boot('notes/ticket');
  await evaluate(`(()=>{ getRenderContainer().scrollTop=Math.min(600, getRenderContainer().scrollHeight); return true; })()`); await sleep(500);
  const c1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onSidebarChildClick('ticket','gkq'); return true; })()`); await sleep(2200);
  const cMid = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onSidebarChildClick('ticket','gkq'); return true; })()`); await sleep(2500);
  const c2 = await evaluate(SCROLL_OF);
  console.log(`  票证 ${c1.y} → 国库券 ${cMid.y}（容器 ${cMid.key}）→ 返回票证 ${c2.y}（容器 ${c2.key}）`);
  ok(c2.key === c1.key, '返回后确实回到了票证概览容器');
  ok(c2.y === c1.y, `★ 票证 → 国库券 → 返回票证，滚动位置恢复（期望 ${c1.y}，实际 ${c2.y}）`);

  // (d) 换了顶级分类再回来 → 从头开始
  await boot('notes/ticket');
  await evaluate(`(()=>{ getRenderContainer().scrollTop=Math.min(600, getRenderContainer().scrollHeight); return true; })()`); await sleep(500);
  const d1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onSidebarItemClick('rmb'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onSidebarItemClick('ticket'); return true; })()`); await sleep(2500);
  const d2 = await evaluate(SCROLL_OF);
  console.log(`  票证 ${d1.y} → 人民币 → 返回票证 ${d2.y}（容器 ${d2.key}）`);
  ok(d2.key === d1.key && d2.y === 0, `★ 换了顶级分类再回来，从头开始（期望 0，实际 ${d2.y}）`);

  // (e) 反向验证：不换分类、只重渲染，不应该被"作废"
  await boot('notes/ticket');
  await evaluate(`(()=>{ getRenderContainer().scrollTop=400; return true; })()`); await sleep(500);
  const e1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ renderCurrentCategory(); return true; })()`); await sleep(800);
  const e2 = await evaluate(SCROLL_OF);
  console.log(`  原地重渲染 ${e1.y} → ${e2.y}`);
  ok(e2.y === e1.y, `★ 原地重渲染不会丢失滚动（${e1.y} → ${e2.y}）`);

  // ── 用户实测反馈后的补充路径（"tab"=纸币/硬币）──
  // (f) 全局概览：进过分类（容器被清空）之后切 tab 往返，绕一圈回全局仍然保留
  console.log('\n  ── 补充：用户实测路径 ──');
  await boot('notes');
  await evaluate(`(()=>{ getRenderContainer().scrollTop=900; return true; })()`); await sleep(600);
  const f1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onSidebarItemClick('rmb'); return true; })()`); await sleep(2200);   // 进分类：会清空所有容器
  const fMid = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onTabClick('coins'); return true; })()`); await sleep(2200);        // 切到硬币
  await evaluate(`(()=>{ onTabClick('notes'); return true; })()`); await sleep(2600);        // 切回纸币
  const f2 = await evaluate(SCROLL_OF);
  // 切回来落在"上次所在的分类（人民币）"是对的，不是全局概览
  ok(f2.key === 'notes_category_rmb', '切回来回到上次所在的分类（人民币），而不是被强行拉回全局');
  await evaluate(`(()=>{ onSidebarItemClick('rmb'); return true; })()`); await sleep(2600);  // 再点一次 = 回全局概览
  const f3 = await evaluate(SCROLL_OF);
  console.log(`  全局 ${f1.y} → 进人民币(${fMid.key} ${fMid.y}) → 切硬币 → 切回纸币(${f2.key} ${f2.y}) → 回全局 ${f3.y}（容器 ${f3.key}）`);
  ok(f3.key === 'notes_overview', '确实回到了全局概览容器');
  ok(f3.y === f1.y, `★ 全局概览：进过分类、切过 tab 后仍保留（期望 ${f1.y}，实际 ${f3.y}）`);

  // (g) 全局概览：只切 tab 往返（不进分类）
  await boot('notes');
  await evaluate(`(()=>{ getRenderContainer().scrollTop=750; return true; })()`); await sleep(600);
  const g1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onTabClick('coins'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('notes'); return true; })()`); await sleep(2600);
  const g2 = await evaluate(SCROLL_OF);
  console.log(`  全局 ${g1.y} → 切硬币 → 切回纸币 → ${g2.y}`);
  ok(g2.y === g1.y, `★ 全局概览：纯切 tab 往返保留（${g1.y} → ${g2.y}）`);

  // (h) 全局概览：进分类后点回全局（点已选中的分类 = 回全局）
  await boot('notes');
  await evaluate(`(()=>{ getRenderContainer().scrollTop=850; return true; })()`); await sleep(600);
  const h1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onSidebarItemClick('rmb'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onSidebarItemClick('rmb'); return true; })()`); await sleep(2600);  // 再点一次 = 回全局概览
  const h2 = await evaluate(SCROLL_OF);
  console.log(`  全局 ${h1.y} → 人民币 → 再点人民币 → ${h2.y}（容器 ${h2.key}）`);
  ok(h2.key === 'notes_overview' && h2.y === h1.y, `★ 全局概览：经分类往返后保留（期望 ${h1.y}，实际 ${h2.y}）`);

  // (i) 父类（人民币）概览：切 tab 往返保留
  await boot('notes/rmb');
  await evaluate(`(()=>{ getRenderContainer().scrollTop=Math.min(500, getRenderContainer().scrollHeight); return true; })()`); await sleep(600);
  const i1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onTabClick('coins'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('notes'); return true; })()`); await sleep(2600);
  const i2 = await evaluate(SCROLL_OF);
  console.log(`  人民币 ${i1.y} → 切硬币 → 切回纸币 → ${i2.y}（容器 ${i2.key}）`);
  ok(i2.key === i1.key && i2.y === i1.y, `★ 父类（人民币）概览：切 tab 往返保留（${i1.y} → ${i2.y}）`);

  // (j) 全局概览的记忆不被"换板块"作废（全局永远保留）
  await boot('notes');
  await evaluate(`(()=>{ getRenderContainer().scrollTop=700; return true; })()`); await sleep(600);
  const j1 = await evaluate(SCROLL_OF);
  await evaluate(`(()=>{ onSidebarItemClick('rmb'); return true; })()`); await sleep(2000);
  await evaluate(`(()=>{ onSidebarItemClick('ticket'); return true; })()`); await sleep(2000);
  await evaluate(`(()=>{ onSidebarItemClick('ticket'); return true; })()`); await sleep(2600);  // 回全局
  const j2 = await evaluate(SCROLL_OF);
  console.log(`  全局 ${j1.y} → 人民币 → 票证 → 回全局 → ${j2.y}（容器 ${j2.key}）`);
  ok(j2.key === 'notes_overview' && j2.y === j1.y, `★ 全局概览：逛过多个分类后仍保留（期望 ${j1.y}，实际 ${j2.y}）`);

  // ══════════════ ⑤ 山河：列表视图不显示"藏品数量 / 少 → 多"图例 ══════════════
  console.log('\n══════ ⑤ 山河列表不显示藏品数量图例 ══════');
  const LEGEND = `(()=>{ const el=document.querySelector('.shanhe-map-legend');
    return JSON.stringify({ has: !!el, text: el ? el.textContent.trim() : null,
      bodyHas: document.body.innerText.includes('藏品数量') }); })()`;
  await boot('special/shanhe');
  const v0 = await evaluate(`(()=>typeof shanheViewMode!=='undefined' ? shanheViewMode : '(未定义)')()`);
  console.log(`  进入山河，当前视图 = ${v0}`);
  await evaluate(`(()=>{ shanheSwitchView('list'); return true; })()`); await sleep(2200);
  const lv = JSON.parse(await evaluate(LEGEND));
  const listCols = await evaluate(`(()=>document.querySelectorAll('.shanhe-list-cell').length)()`);
  console.log(`  列表视图：图例存在=${lv.has}  页面出现"藏品数量"=${lv.bodyHas}  列表图 ${listCols} 张`);
  ok(listCols > 0, '确实渲染出了列表视图（有列表格子）');
  ok(lv.has === false, '★ 列表视图没有 .shanhe-map-legend 图例');
  ok(lv.bodyHas === false, '★ 列表视图整页都不出现"藏品数量"字样');

  await evaluate(`(()=>{ shanheSwitchView('map'); return true; })()`); await sleep(2600);
  const mv = JSON.parse(await evaluate(LEGEND));
  console.log(`  地图视图：图例存在=${mv.has}  文案="${mv.text}"`);
  ok(mv.has === true, '★ 地图视图仍然保留图例（色阶说明只对地图有意义）');
  ok(!!mv.text && mv.text.includes('藏品数量') && mv.text.includes('少'), '图例文案仍是"藏品数量 / 少 → 多"');

  // 切回列表：图例必须再次消失（不是只在首次渲染时判断）
  await evaluate(`(()=>{ shanheSwitchView('list'); return true; })()`); await sleep(2200);
  const lv2 = JSON.parse(await evaluate(LEGEND));
  console.log(`  再切回列表：图例存在=${lv2.has}`);
  ok(lv2.has === false, '★ 地图→列表 切回来图例同样不显示');

  // ══════════════ ⑥ 价格列表的排序 / 筛选选择跨板块保持 ══════════════
  console.log('\n══════ ⑥ 价格列表排序/筛选保留 ══════');
  const SEL = `(()=>{ const s=document.getElementById('priceSortSelect'), f=document.getElementById('priceFilterSelect');
    const sum=document.getElementById('priceListSummary');
    return JSON.stringify({ sort:s?s.value:null, filter:f?f.value:null,
      summary:sum?sum.style.display:null, summaryText:sum?(sum.textContent||'').trim().slice(0,40):null }); })()`;
  const DESC_OK = `(()=>{ const nums=[...document.querySelectorAll('#priceListBody .price-list-value')]
      .map(e=>e.textContent.trim()).filter(t=>t!=='--'&&t!=='-').map(t=>parseFloat(t)).filter(n=>!isNaN(n));
    for (let i=1;i<nums.length;i++) if (nums[i] > nums[i-1]) return false;
    return nums.length > 3; })()`;
  await boot('settings');
  const s0 = JSON.parse(await evaluate(SEL));
  console.log(`  初始：排序=${s0.sort} 筛选=${s0.filter} 汇总=${s0.summary}`);
  ok(s0.sort === 'default' && s0.filter === 'all', '初始是默认排序 / 全部藏品');

  await evaluate(`(()=>{ const s=document.getElementById('priceSortSelect'); s.value='desc'; s.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(500);
  ok(await evaluate(DESC_OK) === true, '选「从高到低」后列表确实降序');

  const firstCat = await evaluate(`(()=>{ const s=document.getElementById('priceFilterSelect');
    const o=[...s.options].filter(x=>x.value!=='all'); return o.length ? o[0].value : null; })()`);
  await evaluate(`(()=>{ const s=document.getElementById('priceFilterSelect'); s.value=${JSON.stringify(firstCat)}; s.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(600);
  const s1 = JSON.parse(await evaluate(SEL));
  console.log(`  选好之后：排序=${s1.sort} 筛选=${s1.filter} 汇总=${s1.summary}「${s1.summaryText}」`);
  ok(s1.summary === 'block' && /该板块总投入/.test(s1.summaryText || ''), '筛选后汇总行显示出来');

  // 切板块往返（会整体重渲染「我的」页）
  await evaluate(`(()=>{ onTabClick('notes'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2600);
  const s2 = JSON.parse(await evaluate(SEL));
  console.log(`  切板块往返后：排序=${s2.sort} 筛选=${s2.filter} 汇总=${s2.summary}「${s2.summaryText}」`);
  ok(s2.sort === 'desc', `★ 排序方式跨板块保持（期望 desc，实际 ${s2.sort}）`);
  ok(s2.filter === firstCat, `★ 筛选板块跨板块保持（期望 ${firstCat}，实际 ${s2.filter}）`);
  ok(s2.summary === 'block' && /该板块总投入/.test(s2.summaryText || ''), '★ 汇总行也跟着恢复（不是空壳）');
  ok(await evaluate(DESC_OK) === true, '★ 恢复后列表仍然是降序（不只是 select 值对）');

  // 同页重渲染（切评级页签）也要保持
  await evaluate(`(()=>{ switchRatingMode('coins'); return true; })()`); await sleep(700);
  const s3 = JSON.parse(await evaluate(SEL));
  ok(s3.sort === 'desc' && s3.filter === firstCat, '同页重渲染（切评级页签）后排序/筛选同样保持');

  // 反向验证：改回默认，切走再回来必须也是默认（不能只会"保持非默认值"）
  await evaluate(`(()=>{ const s=document.getElementById('priceSortSelect'); s.value='default'; s.dispatchEvent(new Event('change'));
    const f=document.getElementById('priceFilterSelect'); f.value='all'; f.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(600);
  await evaluate(`(()=>{ onTabClick('coins'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2600);
  const s4 = JSON.parse(await evaluate(SEL));
  console.log(`  改回默认后往返：排序=${s4.sort} 筛选=${s4.filter} 汇总=${s4.summary}`);
  ok(s4.sort === 'default' && s4.filter === 'all' && s4.summary === 'none', '★ 改回默认后往返仍是默认（不是无脑保持）');

  // ══════════════ ⑥′ 价格列表筛选包含硬币的**子分类** ══════════════
  // ★ 用户报的："价格列表那里还是没有'流通硬币'"。
  //   根因：buildPriceFilterCategories() 里纸币那半边会展开 cat.children，
  //   硬币那半边只遍历顶层 —— 而流通硬币在 tree 里是"人民币流通硬币"的 children，
  //   于是一整块硬币子分类永远进不了筛选列表（article.js 里硬币的文章分类同样漏）。
  console.log('\n══════ ⑥′ 价格列表筛选包含硬币子分类 ══════');
  await boot('notes/overview');
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2600);
  // ★ 直接看 buildPriceFilterCategories() 的返回值（它带 dataKey/source），
  //   不要去解析 <option> 的 value —— 那边的 id 是 coins_<cat.id>，拿它比 dataKey 不可靠。
  const FILTER_OPTS = `(()=>{ const f=document.getElementById('priceFilterSelect');
    let cats = [];
    try { cats = buildPriceFilterCategories(); } catch (e) { return JSON.stringify({ err: String(e && e.message) }); }
    // 树里"有数据"的分类：含子分类的按子算，与函数应有的口径一致
    const expect = [];
    for (const cat of (typeof coinCategoryTree !== 'undefined' ? coinCategoryTree : [])) {
      if (cat.children && cat.children.length) for (const s of cat.children) expect.push({ key: s.dataKey, id: 'coins_' + s.id, label: cat.name + ' - ' + s.name });
      else if (cat.dataKey) expect.push({ key: cat.dataKey, id: 'coins_' + cat.id, label: cat.name });
    }
    const has = k => { const d = window.COIN_DATA_MAP && window.COIN_DATA_MAP[k]; return !!(d && d.series && d.series.length > 0); };
    const want = expect.filter(e => has(e.key));
    const gotKeys = cats.filter(c => c.source === 'coins').map(c => c.dataKey);
    const missing = want.filter(e => !gotKeys.includes(e.key)).map(e => e.key);
    return JSON.stringify({
      total: cats.length,
      coinCats: cats.filter(c => c.source === 'coins').map(c => ({ id: c.id, name: c.name, key: c.dataKey })),
      want: want.map(e => e.key), missing,
      optionCount: f ? f.options.length : -1
    });
  })()`;
  const fo = JSON.parse(await evaluate(FILTER_OPTS));
  if (fo.err) console.log('  调用 buildPriceFilterCategories() 出错：' + fo.err);
  console.log('  函数返回 ' + fo.total + ' 项，其中硬币 ' + (fo.coinCats || []).length + ' 项：' + (fo.coinCats || []).map(c => c.name + '(' + c.id + ')').join(' / '));
  console.log('  树里有数据的硬币分类（应有）：' + (fo.want || []).join(', '));
  if (fo.missing && fo.missing.length) console.log('  缺失：' + fo.missing.join(', '));
  ok(!fo.err, 'buildPriceFilterCategories() 可正常调用');
  ok(fo.missing && fo.missing.length === 0, `★ 树里有数据的硬币分类一个都没漏（应有 ${(fo.want || []).length} 个，缺 ${(fo.missing || []).length} 个）`);
  ok((fo.coinCats || []).some(c => /circulating/.test(c.id)), '★ 筛选列表里能看到「流通硬币」那一支（用户报的就是它）');
  ok((fo.coinCats || []).some(c => / - /.test(c.name)), '有子分类的走「父 - 子」命名，与纸币一致');
  ok((fo.coinCats || []).every(c => c.name && !/^人民币流通硬币$/.test(c.name.trim())), '带子分类的父分类不单独出现（否则点了筛不到东西）');

  // ══════════════ ⑦ 单面图的提示语不含"滑动翻面" ══════════════
  console.log('\n══════ ⑦ 单面图提示语 ══════');
  const TIP = `(()=>{ const m=document.getElementById('imageModal');
    const flip=document.querySelector('.modal-tip .tip-flip');
    const touch=document.querySelector('.modal-tip .tip-touch');
    return JSON.stringify({ multi: m.classList.contains('multi-img'),
      flipDisplay: flip ? getComputedStyle(flip).display : '(无 .tip-flip)',
      hasFlipNode: !!flip,
      tipText: touch ? touch.textContent : null }); })()`;
  await boot('notes/ticket/gkq');
  let opened = null;
  for (let i = 0; i < 40; i++) {
    const r = await evaluate(`(()=>{ const t=document.querySelector('img.copy-thumb'); if(!t) return false; t.click(); return true; })()`).catch(() => false);
    if (r) { await sleep(1800); opened = JSON.parse(await evaluate(TIP)); if (opened.multi) break; }
    await sleep(400);
  }
  console.log(`  双面图：multi=${opened && opened.multi}  .tip-flip 的 display=${opened && opened.flipDisplay}`);
  ok(!!opened && opened.hasFlipNode === true, '提示语里有独立的 .tip-flip 片段');
  ok(!!opened && opened.multi === true, '前置：打开的是双面图（有另一面）');
  ok(!!opened && opened.flipDisplay === 'inline', '★ 双面图：提示语显示"滑动翻面"');
  ok(!!opened && /滑动翻面/.test(opened.tipText || ''), '双面图提示文案完整');

  // 单面图：同一张图当成"没有另一面"打开（文章配图/专题灯箱就是这么调用的）
  await evaluate(`(()=>{ openModal(currentModalImg1, ''); return true; })()`);
  await sleep(1500);
  const single = JSON.parse(await evaluate(TIP));
  console.log(`  单面图：multi=${single.multi}  .tip-flip 的 display=${single.flipDisplay}`);
  ok(single.multi === false, '前置：这是单面图（currentModalImg2 为空）');
  ok(single.flipDisplay === 'none', '★ 单面图：提示语不显示"滑动翻面"');
  ok(/滑动翻面/.test(single.tipText || ''), '（文案本体没删，只是按需隐藏）');
  // 反向验证：再打开一张双面图，提示语要能回来
  await evaluate(`(()=>{ closeModal(); return true; })()`); await sleep(900);
  await evaluate(`(()=>{ openModal(currentModalImg1, currentModalImg1 + '?x=1'); return true; })()`);
  await sleep(1600);
  const again = JSON.parse(await evaluate(TIP));
  console.log(`  再开双面图：multi=${again.multi}  .tip-flip 的 display=${again.flipDisplay}`);
  ok(again.flipDisplay === 'inline', '★ 再打开双面图，提示语恢复显示"滑动翻面"（不是一次性判断）');
  await evaluate(`(()=>{ closeModal(); return true; })()`);

  // ══════════════ ⑧ 价格列表面板内部的滚动位置跨板块保持 ══════════════
  console.log('\n══════ ⑧ 价格列表内部滚动保留 ══════');
  const PLSCROLL = `(()=>{ const b=document.getElementById('priceListBody');
    return JSON.stringify({ y:b?b.scrollTop:-1, max:b?b.scrollHeight-b.clientHeight:-1,
      open:b?b.classList.contains('open'):null }); })()`;
  await boot('settings');
  await evaluate(`(()=>{ const b=document.getElementById('priceListBody');
    if (!b.classList.contains('open')) document.querySelector('.price-list-header').click(); return true; })()`);
  await sleep(700);
  const p0 = JSON.parse(await evaluate(PLSCROLL));
  console.log(`  展开后：可滚 ${p0.max}px，当前 ${p0.y}`);
  ok(p0.open === true, '面板已展开');
  ok(p0.max > 100, `面板内部确实可滚（可滚 ${p0.max}px）`);

  const target = Math.min(300, p0.max);
  await evaluate(`(()=>{ document.getElementById('priceListBody').scrollTop=${target}; return true; })()`);
  await sleep(400);
  const p1 = JSON.parse(await evaluate(PLSCROLL));
  console.log(`  滚到 ${p1.y}`);
  ok(p1.y === target, `面板滚到了 ${target}`);

  await evaluate(`(()=>{ onTabClick('notes'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2800);
  const p2 = JSON.parse(await evaluate(PLSCROLL));
  console.log(`  切板块往返后：${p2.y}（面板 open=${p2.open}）`);
  ok(p2.open === true, '往返后面板仍然是展开的');
  ok(p2.y === p1.y, `★ 价格列表内部滚动位置跨板块保持（期望 ${p1.y}，实际 ${p2.y}）`);

  // 同页重渲染（切评级页签）也要保持
  await evaluate(`(()=>{ switchRatingMode('coins'); return true; })()`); await sleep(900);
  const p3 = JSON.parse(await evaluate(PLSCROLL));
  ok(p3.y === p1.y, `★ 同页重渲染后内部滚动也保持（期望 ${p1.y}，实际 ${p3.y}）`);

  // 反向验证：滚回顶部，往返后仍是顶部（不能只会"保持非零值"）
  await evaluate(`(()=>{ document.getElementById('priceListBody').scrollTop=0; return true; })()`);
  await sleep(400);
  await evaluate(`(()=>{ onTabClick('coins'); return true; })()`); await sleep(2200);
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2800);
  const p4 = JSON.parse(await evaluate(PLSCROLL));
  console.log(`  滚回顶部后往返：${p4.y}`);
  ok(p4.y === 0, '★ 滚回顶部后往返仍是顶部');

  // 换排序 = 另一批内容，应该回到顶部（而不是停在一个无关的位置）
  await evaluate(`(()=>{ const b=document.getElementById('priceListBody'); b.scrollTop=Math.min(200,b.scrollHeight-b.clientHeight); return true; })()`);
  await sleep(400);
  const p5 = JSON.parse(await evaluate(PLSCROLL));
  await evaluate(`(()=>{ const s=document.getElementById('priceSortSelect'); s.value='desc'; s.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(600);
  const p6 = JSON.parse(await evaluate(PLSCROLL));
  console.log(`  换排序前 ${p5.y} → 换排序后 ${p6.y}`);
  ok(p5.y > 0 && p6.y === 0, '★ 换排序后回到顶部（新内容里旧位置没有意义）');
  // 复原
  await evaluate(`(()=>{ const s=document.getElementById('priceSortSelect'); s.value='default'; s.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(500);

  // ══════════════ ⑨ 文章板块的滚动进度 ══════════════
  console.log('\n══════ ⑨ 文章板块滚动进度 ══════');
  const ARTY = `(()=>{ const rc=getRenderContainer(); return rc?Math.round(rc.scrollTop):-1; })()`;
  const ARTKEY = `(()=>Object.keys(viewScrollContainers).filter(k=>viewScrollContainers[k].style.display!=='none').join(','))()`;
  const ARTMAX = `(()=>{ const rc=getRenderContainer(); return rc?Math.round(rc.scrollHeight-rc.clientHeight):-1; })()`;
  async function artScrollTo(n) {
    await evaluate(`(()=>{ const rc=getRenderContainer(); rc.scrollTop=${n}; return true; })()`);
    await sleep(450);
  }
  async function artTab(t) {
    await evaluate(`(()=>{ onTabClick('${t}'); return true; })()`); await sleep(2600);
  }
  async function artOpen(i) {
    await evaluate(`(()=>{ openArticleReader(${i}); return true; })()`); await sleep(2600);
  }
  async function artBack() {
    await evaluate(`(()=>{ closeArticleReader(); return true; })()`); await sleep(1900);
  }

  await boot('articles');
  const ar_artMax = await evaluate(ARTMAX);
  console.log(`  文章列表可滚 ${ar_artMax}px（容器 ${await evaluate(ARTKEY)}）`);
  ok(ar_artMax > 800, '前置：文章列表足够长');

  // 列表：切 tab 往返
  await artScrollTo(700);
  await artTab('special'); await artTab('articles');
  ok(await evaluate(ARTY) === 700, `★ 文章列表切 tab 往返保留（期望 700，实际 ${await evaluate(ARTY)}）`);

  // 列表：进文章再返回
  await artOpen(0);
  ok(await evaluate(ARTY) === 0, '★ 首次打开一篇没读过的文章，从顶部开始');
  await artScrollTo(900);
  ok(await evaluate(ARTY) === 900, '阅读器滚到 900');
  await artBack();
  ok(await evaluate(ARTY) === 700, `★ 返回列表回到原位置（期望 700，实际 ${await evaluate(ARTY)}）`);

  // 阅读器：返回后再打开同一篇 → 接着上次读
  await artOpen(0);
  const ar_c1 = await evaluate(ARTY);
  console.log(`  重开同一篇：${ar_c1}`);
  ok(ar_c1 === 900, `★ 重开同一篇接着上次的位置（期望 900，实际 ${ar_c1}）`);

  // 阅读器：切 tab 往返
  await artTab('notes'); await artTab('articles');
  const ar_c2 = await evaluate(ARTY);
  const ar_c2key = await evaluate(ARTKEY);
  console.log(`  切 tab 往返后：${ar_c2}（容器 ${ar_c2key}）`);
  ok(ar_c2key.indexOf('articles_reader_0') === 0, '★ 切回文章仍停在阅读器（不是被拉回列表）');
  ok(ar_c2 === 900, `★ 阅读器切 tab 往返保留（期望 900，实际 ${ar_c2}）`);

  // 每篇各自记：A(900) → B(300) → 回 A(900)
  await artBack();
  await artOpen(1);
  const ar_d0 = await evaluate(ARTY);
  ok(ar_d0 === 0, `★ 打开另一篇（没读过）从顶部开始（实际 ${ar_d0}）`);
  await artScrollTo(300);
  await artBack();
  await artOpen(0);
  const ar_d1 = await evaluate(ARTY);
  console.log(`  A=900 → B=300 → 回 A：${ar_d1}`);
  ok(ar_d1 === 900, `★ 每篇文章各自记住自己的位置（回到 A 期望 900，实际 ${ar_d1}）`);
  await artBack();
  await artOpen(1);
  const ar_d2 = await evaluate(ARTY);
  ok(ar_d2 === 300, `★ B 的位置也各自记着（期望 300，实际 ${ar_d2}）`);
  await artBack();

  // 反向验证：把某篇滚回顶部，往返后仍是顶部
  await artOpen(1);
  await artScrollTo(0);
  await artBack();
  await artOpen(1);
  const ar_e1 = await evaluate(ARTY);
  console.log(`  B 滚回顶部后重开：${ar_e1}`);
  ok(ar_e1 === 0, `★ 滚回顶部后重开仍是顶部（实际 ${ar_e1}）`);
  await artBack();

  // 打开阅读器不能把列表位置冲掉（旧代码在这里会把 listScrollY 量成 0）
  // ★ 用 API 读而不是直接读 articleScrollMemory：列表的记忆键按分类分了一层
  //   （articles_list::<分类>），直接读 'articles_list' 已经取不到了。
  const ar_listMem = await evaluate(`(()=>{ return (typeof getRememberedArticleScroll === 'function')
    ? getRememberedArticleScroll('articles_list') : null; })()`);
  console.log(`  列表滚动记忆 = ${ar_listMem}`);
  ok(ar_listMem === 700, `★ 打开/返回阅读器没有把列表位置冲成 0（期望 700，实际 ${ar_listMem}）`);

  // 搜索结果：切 tab 往返
  await evaluate(`(()=>{ const inp=document.getElementById('searchInput'); inp.value='元'; onSearchInput({target:inp}); return true; })()`);
  await sleep(2600);
  const ar_sMax = await evaluate(ARTMAX);
  const ar_sTarget = Math.min(200, ar_sMax);
  await artScrollTo(ar_sTarget);
  await artTab('notes'); await artTab('articles');
  const ar_sAfter = await evaluate(ARTY);
  console.log(`  搜索结果（可滚 ${ar_sMax}px）滚到 ${ar_sTarget} → 切 tab 往返：${ar_sAfter}`);
  ok(ar_sAfter === ar_sTarget, `★ 搜索结果滚动位置也保留（期望 ${ar_sTarget}，实际 ${ar_sAfter}）`);
  // 清掉搜索，回到全部
  await evaluate(`(()=>{ const inp=document.getElementById('searchInput'); inp.value=''; onSearchInput({target:inp}); return true; })()`);
  await sleep(2200);

  // ══════════════ ⑩ 文章：点开侧栏板块再回到全局，保留全局原来的位置 ══════════════
  console.log('\n══════ ⑩ 文章：板块 ↔ 全局 的滚动位置 ══════');
  const ARTCAT = `(()=>{ const rc=getRenderContainer();
    return JSON.stringify({ y: rc?Math.round(rc.scrollTop):-1, cat: currentArticleCategory,
      max: rc?Math.round(rc.scrollHeight-rc.clientHeight):-1 }); })()`;
  const artCat = async (id) => { await evaluate(`(()=>{ onArticleSidebarClick('${id}'); return true; })()`); await sleep(2400); };
  const artBackToAll = async () => { await evaluate(`(()=>{ onArticleSidebarClick(currentArticleCategory); return true; })()`); await sleep(2400); };

  await boot('articles');
  await artScrollTo(800);
  let ac = JSON.parse(await evaluate(ARTCAT));
  console.log(`  全局列表（分类 ${ac.cat}）滚到 ${ac.y}`);
  ok(ac.y === 800 && ac.cat === 'all', '前置：停在全局列表并滚到 800');

  // 找一个列表足够长的板块（各板块文章数不同，写死 id 不稳）
  let bigCat = null;
  for (const id of ['rmb', 'hk', 'macau', 'ticket', 'republic', 'commemorative', 'prcAidPrinted']) {
    await artCat(id);
    const m = JSON.parse(await evaluate(ARTCAT));
    if (m.max > 400) { bigCat = id; console.log(`  选用板块 ${id}（可滚 ${m.max}px）`); break; }
    await artBackToAll();
  }
  ok(!!bigCat, `找到一个列表足够长的板块（${bigCat}）`);

  // ★ 用户报的那条路：全局 → 板块 → 看文章 → 回全局
  await boot('articles');
  await artScrollTo(800);
  await artCat(bigCat);
  ac = JSON.parse(await evaluate(ARTCAT));
  ok(ac.cat === bigCat, `已进入板块 ${bigCat}`);
  ok(ac.y === 0, `★ 首次进入该板块从顶部开始（实际 ${ac.y}）`);
  await artOpen(0);
  await artBack();
  ac = JSON.parse(await evaluate(ARTCAT));
  console.log(`  看了一篇文章再返回：分类 ${ac.cat} y=${ac.y}`);
  await artBackToAll();
  ac = JSON.parse(await evaluate(ARTCAT));
  console.log(`  ★ 回到全局：分类 ${ac.cat} y=${ac.y}`);
  ok(ac.cat === 'all', '确实回到了全局（分类 all）');
  ok(ac.y === 800, `★ 回到全局保留原来的位置（期望 800，实际 ${ac.y}）`);

  // 每个板块各自记位置
  await boot('articles');
  await artScrollTo(800);
  await artCat(bigCat);
  await artScrollTo(300);
  await artBackToAll();
  ac = JSON.parse(await evaluate(ARTCAT));
  ok(ac.y === 800, `★ 板块往返后全局仍是 800（实际 ${ac.y}）`);
  await artCat(bigCat);
  ac = JSON.parse(await evaluate(ARTCAT));
  ok(ac.y === 300, `★ 再进该板块仍是它自己的 300（实际 ${ac.y}）`);

  // 与纸币/硬币同规则：换过别的板块，该板块从头开始；全局永不作废
  await boot('articles');
  await artScrollTo(800);
  await artCat(bigCat);
  await artScrollTo(300);
  await artCat('hk');
  await artBackToAll();
  ac = JSON.parse(await evaluate(ARTCAT));
  ok(ac.y === 800, `★ 换过别的板块，全局仍是 800（实际 ${ac.y}）`);
  await artCat(bigCat);
  ac = JSON.parse(await evaluate(ARTCAT));
  ok(ac.y === 0, `★ 换过别的板块后，该板块回来从头开始（实际 ${ac.y}）`);

  // 反向：全局在顶部时往返仍是顶部
  await boot('articles');
  await artScrollTo(0);
  await artCat(bigCat);
  await artBackToAll();
  ac = JSON.parse(await evaluate(ARTCAT));
  ok(ac.y === 0, `★ 全局 0 → 板块往返 → 仍是 0（实际 ${ac.y}）`);

  // ══════════════ ⑪ 手机窄屏（侧边栏展开）明细行不越界 ══════════════
  console.log('\n══════ ⑪ 手机窄屏下「冠号 + 详细信息」那一行不越界 ══════');
  // 用户报：手机上侧边栏展开时右侧较挤，「ⅩⅠⅩ7361948 详细信息」这一行被挤出屏幕。
  // 结构原因：≤768px 时侧边栏占 25%（min 120px），375px 屏幕上内容区只剩约 255px；
  // 而 .version 是 flex（默认 nowrap）、两个子项又都 white-space: nowrap，
  // min-content 等于整段文字、谁也收缩不了 → 整行顶出屏幕。
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await boot('notes/ticket/nedb');
  const ROW_SEL = `[...document.querySelectorAll('.copy-info .version')].find(x => (x.textContent || '').indexOf('7361948') >= 0)`;
  const real = JSON.parse(await evaluate(`(()=>{
    const v = ${ROW_SEL};
    if (!v) return JSON.stringify({ found: false, hash: location.hash,
      sample: [...document.querySelectorAll('.copy-info .version')].slice(0, 5).map(x => x.textContent.trim()) });
    const link = v.querySelector('.copy-detail-link');
    const r = v.getBoundingClientRect(), lr = link ? link.getBoundingClientRect() : null;
    const t = v.querySelector('.version-text');
    const chain = [];
    for (let el = v; el && el !== document.body; el = el.parentElement) {
      const b = el.getBoundingClientRect();
      chain.push((el.className || el.tagName) + '[' + Math.round(b.left) + ',' + Math.round(b.right) + ']');
    }
    return JSON.stringify({
      found: true, vw: innerWidth,
      rowRight: Math.round(r.right), linkRight: lr ? Math.round(lr.right) : null,
      left: Math.round(r.left), chain: chain.join(' ← '),
      docScroll: document.documentElement.scrollWidth,
      flexWrap: getComputedStyle(v).flexWrap,
      whiteSpace: getComputedStyle(t).whiteSpace,
      overflowWrap: getComputedStyle(t).overflowWrap
    });
  })()`));
  if (!real.found) console.log('    （没找到那一行，页面上的行样例：' + JSON.stringify(real.sample) + '）');
  console.log(`    视口 ${real.vw}px；那一行 left=${real.left} right=${real.rowRight}；「详细信息」右边界 ${real.linkRight}；文档 scrollWidth ${real.docScroll}`);
  console.log(`    父链（left,right）：${real.chain}`);
  console.log(`    .version flex-wrap=${real.flexWrap}；.version-text white-space=${real.whiteSpace} / overflow-wrap=${real.overflowWrap}`);
  ok(real.found === true, `找到了「…7361948 详细信息」那一行（hash=${real.hash || 'notes/ticket/nedb'}）`);
  if (real.found) {
    ok(real.docScroll <= real.vw + 1,
       `★ 页面没有被撑出横向滚动（scrollWidth ${real.docScroll} ≤ 视口 ${real.vw}）`);
    // ★ 关键判据：旧写法下「详细信息」会被顶到视口之外（实测 488px / 375px）
    ok(real.linkRight !== null && real.linkRight <= real.vw,
       `★ 「详细信息」在屏幕内（右边界 ${real.linkRight} ≤ 视口 ${real.vw}）`);
    ok(real.flexWrap === 'wrap', `★ .version 允许换行（flex-wrap=${real.flexWrap}）`);
    ok(real.whiteSpace !== 'nowrap' && /anywhere|break-word/.test(real.overflowWrap),
       `★ 冠号可断行（white-space=${real.whiteSpace}，overflow-wrap=${real.overflowWrap}）`);
    // 造一个一定放不下的超长冠号：必须是"在盒内断行 + 链接换到下一行"，不能是"顶出去"
    const E = JSON.parse(await evaluate(`(()=>{
      const v = ${ROW_SEL};
      const t = v.querySelector('.version-text'), link = v.querySelector('.copy-detail-link');
      const old = t.textContent;
      t.textContent = 'ⅩⅠⅩⅠⅩⅠⅩⅠⅩⅠⅩⅠⅩⅠⅩⅠⅩ7361948123456789012345678901234567890';
      const tr = t.getBoundingClientRect(), lr = link.getBoundingClientRect();
      const out = { textOverflow: Math.round(t.scrollWidth - t.clientWidth),
                    wraps: lr.top >= tr.bottom - 2,
                    linkRight: Math.round(lr.right), vw: innerWidth,
                    docScroll: document.documentElement.scrollWidth };
      t.textContent = old;
      return JSON.stringify(out);
    })()`));
    console.log(`    超长冠号时：换行=${E.wraps}，冠号盒内溢出=${E.textOverflow}px，「详细信息」右边界 ${E.linkRight}（视口 ${E.vw}）、scrollWidth ${E.docScroll}`);
    ok(E.wraps === true, '★ 超长冠号时「详细信息」换到下一行（而不是被推出屏幕）');
    ok(E.linkRight <= E.vw && E.docScroll <= E.vw + 1,
       `★ 超长冠号下「详细信息」仍在屏幕内（${E.linkRight} ≤ ${E.vw}；scrollWidth ${E.docScroll}）`);
  }
  await send('Emulation.clearDeviceMetricsOverride');

  // ══════════════ ⑫ 缺图占位（自绘古钱币）+ 仍可重新加载 ══════════════
  console.log('\n══════ ⑫ 缺图占位：古钱币居中 + 仍可重新加载 ══════');
  // 用户要求两件事：
  //   ① 加载不出来的图片，用自绘的古钱币 SVG 占位、放在中间；
  //   ② "重新加载图片的时候这些缺的地方要可以重新加载" —— 占位不能把状态焊死。
  // 这里验：不再有碎图标 / 占位图真能解码（SVG 若是坏 XML 会解码失败）/
  //         真实地址记在 data-retry-src / 仍在重试队列 / 顶部按钮能把真图请求回来。
  // ★ 度量口径：只统计 src 非空的 <img>。大图弹窗里的 modal-img / modal-img-overlay
  //   闲置时 src=""，complete=true 且 naturalWidth=0 —— 那是"空闲"不是"碎图"，
  //   第一版用例就被它们骗过一次（误报 2 张碎图）。
  // ★ loading="lazy"：折叠以下的图不自己发起请求，也就不会触发 onerror，
  //   必须先逐张滚进视口把它们逼出来。
  const SCAN = `(() => {
    const all = [...document.querySelectorAll('img')].filter(i => (i.getAttribute('src') || '').trim() !== '');
    const isPh = i => i.classList.contains('img-failed');
    const ph = all.filter(isPh);
    const fab = document.getElementById('imgRetryFab');
    const sample = all.find(i => i.getAttribute('onerror'));
    const cs0 = ph.length ? getComputedStyle(ph[0]) : null;
    return JSON.stringify({
      total: all.length,
      pending: all.filter(i => !i.complete).length,
      broken: all.filter(i => i.complete && i.naturalWidth === 0).length,
      realLoaded: all.filter(i => i.naturalWidth > 0 && !isPh(i)).length,
      placeholders: ph.length,
      phLoaded: ph.filter(i => i.naturalWidth > 0).map(i => i.naturalWidth + 'x' + i.naturalHeight),
      retrySrc: ph.map(i => i.dataset.retrySrc || '(空)'),
      phSrc: ph.length ? ph[0].getAttribute('src') : null,
      phMask: cs0 ? ((cs0.maskImage && cs0.maskImage !== 'none') ? cs0.maskImage : (cs0.webkitMaskImage || '')) : null,
      phColor: cs0 ? cs0.backgroundColor : null,
      fabShown: fab ? fab.classList.contains('show') : null,
      hasImgFallback: typeof imgFallback === 'function',
      hasRetryFn: typeof retryFailedImages === 'function',
      anyOnerror: sample ? sample.getAttribute('onerror') : null
    });
  })()`;
  const FORCE = `(async () => {
    const all = [...document.querySelectorAll('img')];
    const need = all.filter(i => !i.complete);
    for (const i of need) { i.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 300)); }
    await new Promise(r => setTimeout(r, 1600));
    return JSON.stringify({ needed: need.length, stillPending: all.filter(i => !i.complete).length });
  })()`;

  // 真实鼠标点击（CDP Input）。★ 不能用 el.click()：
  //   合成 click 会无视 pointer-events，测不出"点不到"这件事。
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x, y: y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x, y: y, button: 'left', clickCount: 1 });
    await sleep(450);
  };
  const MODAL_OPEN = `document.body.classList.contains('modal-open')`;

  // 对照组先做：真图必须点得开。否则"占位点不开"可能只是"点哪儿都没反应"，
  // 那种断言等于没测。分两步：① 先直接调 openModal，验通道本身是通的；
  // ② 再找一张"中心点确实自己接得住"的真图，用真实鼠标点一下。
  await boot('notes/ticket/fec');
  const CA = JSON.parse(await evaluate(`(async () => {
    const good = [...document.querySelectorAll('img')].filter(i => !i.classList.contains('img-failed')
      && i.naturalWidth > 0 && i.getAttribute('onclick'))[0];
    if (!good) return JSON.stringify({ none: true, why: '找不到带 onclick 的真图' });
    if (typeof openModal !== 'function') return JSON.stringify({ none: true, why: '没有 openModal' });
    const url = good.getAttribute('src');
    openModal(url, url);
    await new Promise(r => setTimeout(r, 500));
    const opened = document.body.classList.contains('modal-open');
    if (typeof closeModal === 'function') closeModal();
    await new Promise(r => setTimeout(r, 300));
    return JSON.stringify({ none: false, url: url, opened: opened });
  })()`));
  ok(CA.none === false && CA.opened === true,
     `★ 对照组①：大图通道本身可用（openModal 之后 modal-open=${CA.opened}${CA.why ? '，' + CA.why : ''}）`);
  const CB = JSON.parse(await evaluate(`(async () => {
    // ★ 列表里的缩略图多数在**折叠**的分组里：.copy-list 是 max-height:0 + overflow:hidden，
    //   子元素照样有布局盒子（offsetParent 不为空、rect 也在视口内），只是被裁掉了，
    //   所以"可见性"判断会骗人 —— 先把第一个分组展开再挑。
    const row = document.querySelector('.series-year-row');
    if (row) { row.click(); await new Promise(r => setTimeout(r, 800)); }
    const list = [...document.querySelectorAll('img')].filter(i => !i.classList.contains('img-failed')
      && i.naturalWidth > 0 && i.getAttribute('onclick'));
    const tries = [];
    for (const el of list.slice(0, 12)) {
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      if (r.width < 4 || r.height < 4) { tries.push(String(el.className) + ':尺寸为0'); continue; }
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) { tries.push(String(el.className) + ':在视口外'); continue; }
      const top = document.elementFromPoint(cx, cy);
      if (top === el) return JSON.stringify({ found: true, cx: cx, cy: cy, cls: String(el.className) });
      tries.push(String(el.className) + '→被 ' + (top ? top.tagName + '.' + String(top.className).split(' ')[0] : 'null') + ' 接住');
    }
    return JSON.stringify({ found: false, tries: tries });
  })()`));
  if (CB.found) {
    await clickAt(CB.cx, CB.cy);
    const opened2 = await evaluate(MODAL_OPEN);
    console.log(`    对照组真图（${CB.cls}）中心(${CB.cx},${CB.cy}) 真点一下 → modal-open=${opened2}`);
    ok(opened2 === true, `★ 对照组②：真图点一下确实能打开大图（modal-open=${opened2}）`);
    if (opened2) { await evaluate(`typeof closeModal === 'function' && closeModal()`); await sleep(400); }
  } else {
    console.log(`    （对照组②未取到样本：列表行的缩略图被 series-year-header / series-name-label 覆盖，`);
    console.log(`      点不到"中心点是自己"的真图；"能点开"这一半由对照组①的 openModal 直接证明。）`);
  }

  // 候选页面：数据里"引用了但文件不存在"的图分布在这几处（check-data 的 WARN 有清单）。
  let page = null, S = null;
  for (const h of ['notes/ticket/mpc', 'notes/ticket/fec', 'notes/republic/republic_cbc',
                   'notes/republic/republic_boc', 'notes/republic/republic_communications']) {
    await boot(h);
    const f = JSON.parse(await evaluate(FORCE));
    const s = JSON.parse(await evaluate(SCAN));
    console.log(`    候选 ${h}: 图 ${s.total}（真图 ${s.realLoaded}、占位 ${s.placeholders}、碎图 ${s.broken}、补加载 ${f.needed}）`);
    if (s.placeholders > 0) { page = h; S = s; break; }
  }
  ok(page !== null, `★ 真实数据里确实有会落到占位图的条目（页面：${page || '未命中'}）`);
  if (page === null) {
    // 兜底：注入一张引用不存在文件的图，onerror 写法与真实渲染逐字相同
    await boot('notes/rmb/rmb3');
    const inj = await evaluate(`(async () => {
      const img = document.createElement('img');
      img.id = 'injectedMissingImg';
      img.className = 'copy-thumb';
      img.setAttribute('src', '/notecollection/image/__no_such_dir__/__no_such_file__-1.jpg');
      img.setAttribute('onerror', "imgFallback(this, '/notecollection/image/__no_such_dir__/__no_such_file__-1.jpg')");
      document.body.appendChild(img);
      await new Promise(r => setTimeout(r, 1500));
      return img.getAttribute('src');
    })()`);
    page = '(注入受控 404 图)';
    console.log(`    注入受控 404 图后 src=${inj}`);
    S = JSON.parse(await evaluate(SCAN));
  }
  console.log(`    → ${page}：图 ${S.total}（真图 ${S.realLoaded}、占位 ${S.placeholders}、碎图 ${S.broken}、未完成 ${S.pending}）`);
  console.log(`    占位元素 src=${S.phSrc}；mask=${S.phMask}；颜色=${S.phColor}；重试 FAB 显示=${S.fabShown}`);
  console.log(`    真实渲染出的 onerror：${S.anyOnerror}`);
  console.log(`    占位元素记下的真实地址：${JSON.stringify(S.retrySrc)}`);
  ok(S.hasImgFallback === true && S.hasRetryFn === true,
     `前置：页面加载的是新版 core.js（imgFallback=${S.hasImgFallback}、retryFailedImages=${S.hasRetryFn}）`);
  ok(S.total > 0, `前置：页面上的图元素计数正常（${S.total} 张，src 非空）`);
  ok(/imgFallback\(this,/.test(S.anyOnerror || ''),
     `★ 渲染层真的把 imgFallback 挂到了图片上（${S.anyOnerror}）`);
  ok(S.broken === 0, `★ 页面上没有碎图（真碎图数 = ${S.broken}）`);
  ok(S.placeholders > 0, `★ 缺图的图片确实被标成了降级态 .img-failed（${S.placeholders} 张）`);
  ok(/img-placeholder\.svg/.test(S.phMask || ''),
     `★ 降级态用古钱币当蒙版（mask-image=${S.phMask}）`);
  ok(!!S.phColor && S.phColor !== 'rgba(0, 0, 0, 0)' && S.phColor !== 'transparent',
     `★ 蒙版染的是主题色而不是透明（background-color=${S.phColor}）`);

  // ★ 占位不该点得开：点开的大图还是那张缺图，白跑一趟。
  const P = JSON.parse(await evaluate(`(() => {
    const bad = document.querySelector('img.img-failed');
    if (!bad) return JSON.stringify({ none: true });
    bad.scrollIntoView({ block: 'center' });
    const r = bad.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return JSON.stringify({ none: false, cx: cx, cy: cy,
      pe: getComputedStyle(bad).pointerEvents, cursor: getComputedStyle(bad).cursor,
      hasOnclick: !!bad.getAttribute('onclick'),
      hit: top ? (top === bad ? '它自己' : (top.tagName + (top.className ? '.' + String(top.className).split(' ')[0] : ''))) : 'null',
      modalOpenNow: ${MODAL_OPEN} });
  })()`));
  ok(P.none === false && P.hasOnclick === true,
     `前置：占位图本身带着 onclick（说明确实有"本来能点开"这回事）`);
  if (!P.none) {
    console.log(`    占位图 中心(${P.cx},${P.cy}) pointer-events=${P.pe} cursor=${P.cursor}，该点命中=${P.hit}`);
    ok(P.pe === 'none', `★ 占位图不吃点击（pointer-events=${P.pe}）`);
    ok(P.cursor === 'default', `★ 占位图不再是手型光标（cursor=${P.cursor}）`);
    ok(P.hit !== '它自己', `★ 占位图中心点没被它自己接住（命中 ${P.hit}）`);
    ok(P.modalOpenNow === false, `前置：此时大图弹窗是关着的`);
    await clickAt(P.cx, P.cy);
    const opened1 = await evaluate(MODAL_OPEN);
    console.log(`    真点一下占位图 → modal-open=${opened1}`);
    ok(opened1 === false, `★ 真点占位图，大图不会打开（modal-open=${opened1}）`);
  }
  ok(S.retrySrc.length === S.placeholders && S.retrySrc.every(s => s && s !== '(空)' && s.indexOf('img-placeholder') < 0),
     `★ 每个占位都记下了真实地址（可重新加载的前提）：${JSON.stringify(S.retrySrc)}`);
  ok(S.fabShown === true, `★ 占位元素仍在重试队列里（顶部重试按钮显示=${S.fabShown}）`);

  // 按顶部那个按钮，真图地址必须被重新请求回来
  const R = JSON.parse(await evaluate(`(() => {
    const el = [...document.querySelectorAll('img')].filter(i => i.classList.contains('img-failed'))[0];
    if (!el) return JSON.stringify({ ok: false, why: '没有处于降级态的图片' });
    // 占位态现在是 160×160 的透明 SVG 而不是 1×1 GIF，所以只认前缀、不写死具体 data URI
    const wasPlaceholder = (el.getAttribute('src') || '').indexOf('data:image/') === 0;
    const want = el.dataset.retrySrc || '';
    if (typeof retryFailedImages !== 'function') return JSON.stringify({ ok: false, why: '没有 retryFailedImages' });
    retryFailedImages();
    const after = el.getAttribute('src') || '';
    return JSON.stringify({ ok: true, want: want, after: after, wasPlaceholder: wasPlaceholder,
      requestedReal: !!want && after.indexOf(want) === 0 });
  })()`));
  console.log(`    点重试后：${R.want} → ${R.after}`);
  ok(R.ok === true, `重试可用（${R.why || 'ok'}）`);
  if (R.ok) {
    ok(R.wasPlaceholder === true, '前置：拿到的确实是处于占位态的那张图');
    ok(R.requestedReal === true, `★ 重试请求的是真实图片地址，而不是占位图本身（${R.after}）`);
  }
  await sleep(2500);
  const S2 = JSON.parse(await evaluate(SCAN));
  console.log(`    重试后再看：碎图 ${S2.broken}、占位 ${S2.placeholders}、FAB=${S2.fabShown}`);
  ok(S2.broken === 0 && S2.placeholders === S.placeholders,
     `★ 真图确实不存在时，重试后仍然稳定回到占位（碎图 ${S2.broken}、占位 ${S2.placeholders}）`);
  ok(S2.retrySrc.every(s => s && s !== '(空)' && s.indexOf('img-placeholder') < 0),
     `★ 重试失败后真实地址没有被占位地址覆盖（仍可再次重试）`);

  // 数据里根本没有图片的条目（未评级藏品）：文案统一 + 古钱币在中间 + 颜色跟主题走
  await boot('notes/rmb/rmb3');
  const N = JSON.parse(await evaluate(`(async () => {
    // ★ 缺图在页面上有两条路径，都算"占位"，都要考：
    //   ① .no-img 这类块：数据里根本没写图片名（-1.jpg / 空串），走 ::before 画古钱币；
    //   ② img.img-failed：数据里写了名字但文件不存在（例如 rmb3 现在写的 0-1.jpg），
    //      请求 404 后降级，蒙版直接画在 img 自己身上。
    //   两条路用的是同一张 img-placeholder.svg，所以后面的蒙版/颜色/尺寸断言对两者都成立。
    const blocks = [...document.querySelectorAll('.copy-thumb.no-img, .timeline-no-img, .shanhe-list-cell .no-img')];
    const failed = [...document.querySelectorAll('img.img-failed')];
    const all = blocks.concat(failed);
    if (!all.length) return JSON.stringify({ count: 0, diag: {
      hash: location.hash,
      text: ((document.querySelector('.view-container, #listView, #categoryView, main') || document.body).innerText || '').replace(/\\s+/g, ' ').slice(0, 150),
      copyThumb: document.querySelectorAll('.copy-thumb').length,
      noImgAny: document.querySelectorAll('.no-img').length,
      failed: failed.length,
      imgs: document.querySelectorAll('img').length,
      hasRmb3: typeof rmb3Data !== 'undefined'
    } });
    const e = all[0];
    const isImg = e.tagName === 'IMG';
    const cs = isImg ? getComputedStyle(e) : getComputedStyle(e, '::before');
    const r = e.getBoundingClientRect();
    const mask = (cs.maskImage && cs.maskImage !== 'none') ? cs.maskImage : (cs.webkitMaskImage || '');
    const m = /url\\(["']?([^"')]+)["']?\\)/.exec(mask);
    // 蒙版那个 SVG 自己能不能解码 —— 坏 XML 的 SVG 会在这里露馅
    let svgOk = 'no-url', svgW = 0, svgH = 0;
    if (m) {
      const im = new Image();
      svgOk = await new Promise(res => { im.onload = () => res('load'); im.onerror = () => res('error'); im.src = m[1]; setTimeout(() => res('timeout'), 5000); });
      svgW = im.naturalWidth; svgH = im.naturalHeight;
    }
    // ★ 颜色是不是真的跟着主题：用应用自己的 setColorSchemeMode() 两端各切一次。
    //   不能只改 html[data-color-scheme] —— theme.js 的 applyTheme() 是把整套调色板
    //   以内联样式写到根元素上的（样式表那份只是"JS 跑起来之前的底色"，防白闪），
    //   内联优先级更高，改属性看不见效果。
    const prevMode = (typeof getColorSchemeMode === 'function') ? getColorSchemeMode() : 'system';
    const canSwitch = typeof setColorSchemeMode === 'function';
    let lightColor = '', darkColor = '';
    const bg = () => isImg ? getComputedStyle(e).backgroundColor : getComputedStyle(e, '::before').backgroundColor;
    // ★ 切完主题必须等颜色**稳定**再采：明暗切换现在带 0.3s 的颜色补间
    //   （layout.css 用 @property 让变量逐帧插值），切完立刻读到的是切换前的值。
    //   第一版就是在这里红的：浅色和深色采到同一个颜色。
    const settleBg = async () => {
      let last = bg(), stable = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 1500) {
        await new Promise(r => setTimeout(r, 40));
        const now = bg();
        if (now === last) { if (++stable >= 3) return now; }
        else { stable = 0; last = now; }
      }
      return last;
    };
    if (canSwitch) {
      setColorSchemeMode('light');
      lightColor = await settleBg();
      setColorSchemeMode('dark');
      darkColor = await settleBg();
      setColorSchemeMode(prevMode);
    }
    return JSON.stringify({
      count: all.length, blocks: blocks.length, failedCount: failed.length, isImg: isImg,
      text: (e.textContent || '').trim(),
      mask: mask, maskUrl: m ? m[1] : null, svgOk: svgOk, svgW: svgW, svgH: svgH,
      lightColor: lightColor, darkColor: darkColor, colorChanged: lightColor !== darkColor,
      w: Math.round(r.width), h: Math.round(r.height),
      beforeW: cs.width, beforeH: cs.height,
      // 诊断：到底哪些行渲染成了 <img>（挂着 alt="o_O"）而不是 .no-img
      imgCount: document.querySelectorAll('.copy-thumb').length,
      imgEls: [...document.querySelectorAll('.copy-thumb')].filter(x => x.tagName === 'IMG').length,
      imgFail: [...document.querySelectorAll('img.copy-thumb')].filter(x => x.complete && x.naturalWidth === 0).length,
      imgSample: [...document.querySelectorAll('img.copy-thumb')].slice(0, 4).map(x => (x.getAttribute('src') || '').split('/').pop() + '|' + (x.getAttribute('alt') || '') + '|' + (x.naturalWidth > 0 ? 'ok' : 'fail')),
      // 逐行对照：标题 ⇒ 缩略图是 <img>（能加载/失败）还是占位块
      rows: [...document.querySelectorAll('.copy-item')].slice(0, 14).map(it => {
        const t = (it.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30);
        const th = it.querySelector('.copy-thumb');
        return t + ' ⇒ ' + (th ? (th.tagName === 'IMG' ? 'img(' + (th.naturalWidth > 0 ? 'ok' : 'fail') + ')' : '占位') : '无');
      })
    });
  })()`));
  console.log(`    无图条目 ${N.count} 个；首个文案「${N.text}」、格子 ${N.w}x${N.h}、伪元素 ${N.beforeW}x${N.beforeH}`);
  console.log(`    .copy-thumb 共 ${N.imgCount} 个，其中 <img> ${N.imgEls} 个（解码失败 ${N.imgFail}）：${JSON.stringify(N.imgSample)}`);
  for (const r of (N.rows || [])) console.log(`      行 ${r}`);
  console.log(`    蒙版 url=${N.maskUrl}（SVG 解码 ${N.svgOk} ${N.svgW}x${N.svgH}）`);
  console.log(`    主题色：浅色 ${N.lightColor} / 深色 ${N.darkColor}`);
  ok(N.count > 0, `前置：找到了数据里没有图片的条目（${N.count} 个：块 ${N.blocks} + 降级图 ${N.failedCount}）`);
  if (N.count === 0 && N.diag) console.log(`    诊断：hash=${N.diag.hash} rmb3Data已加载=${N.diag.hasRmb3} .copy-thumb=${N.diag.copyThumb} .no-img=${N.diag.noImgAny} .img-failed=${N.diag.failed} img=${N.diag.imgs}\n    页面文本：${N.diag.text}`);
  if (N.count > 0) {
    if (!N.isImg) ok(N.text === '暂无图片', `★ 无图文案已统一为「暂无图片」（实际「${N.text}」）`);
    else ok(true, `（这条走的是"有名字但文件不存在"的降级路，没有「暂无图片」文案，只考蒙版与颜色）`);
    ok(/img-placeholder\.svg/.test(N.mask), `★ 无图位置用古钱币当蒙版（mask=${N.mask}）`);
    ok(N.svgOk === 'load' && N.svgW > 0 && N.svgH > 0,
       `★ 古钱币 SVG 本身能解码（${N.svgOk} ${N.svgW}x${N.svgH}）—— 坏 XML 会在这里露馅`);
    ok(parseFloat(N.beforeW) > 0 && parseFloat(N.beforeH) > 0,
       `★ 古钱币占位有实际尺寸（${N.beforeW}x${N.beforeH}）`);
    ok(!!N.lightColor && N.lightColor !== 'rgba(0, 0, 0, 0)',
       `★ 占位被染上了主题色（浅色主题 ${N.lightColor}）`);
    ok(N.colorChanged === true,
       `★ 换到深色主题时占位颜色跟着变（${N.lightColor} → ${N.darkColor}）`);
  }

  // ══════════════ ⑬ 外观：明暗分段控件的选中高亮是"滑动"过去的 ══════════════
  // ★ 用户要求："明暗那里的高亮按钮其实可以设计为左右滑动的动画"。
  //   原来是把 .active 按钮自己的背景一换（硬切）。现在高亮是一块独立的 .seg-pill，
  //   JS 量出选中项的 left/width 写进 --seg-x/--seg-w，CSS 过渡 transform/width。
  //   这里要验的是：几何真的对得上（不是写死宽度）、点了会滑到新位置、
  //   并且**尊重"减弱动效"**（reduce 时不允许有过渡）。
  console.log('\n══════ ⑬ 外观：明暗高亮滑块 ══════');
  {  // ★ 用块作用域包住：本节的 p0/p1/before 会和别的小节撞名
  const PILL = `(()=>{ const box=document.getElementById('colorSchemeSeg');
    if(!box) return JSON.stringify({ err:'没有 colorSchemeSeg' });
    const pill=box.querySelector('.seg-pill');
    const act=box.querySelector('.seg-btn.active');
    const btn=(v)=>box.querySelector('.seg-btn[data-value="'+v+'"]');
    if(!pill||!act) return JSON.stringify({ err:'缺少 .seg-pill 或 .active', hasPill:!!pill, hasActive:!!act });
    const cs=getComputedStyle(pill);
    const geom=(el)=>{ const bb=box.getBoundingClientRect(), ab=el.getBoundingClientRect();
      return { x: Math.round(ab.left-bb.left-box.clientLeft), w: Math.round(ab.width) }; };
    const vars={ x: Math.round(parseFloat(cs.getPropertyValue('--seg-x'))||0),
                 w: Math.round(parseFloat(cs.getPropertyValue('--seg-w'))||0) };
    const want=geom(act);
    const pb=pill.getBoundingClientRect(), ab=act.getBoundingClientRect();
    const bb2=box.getBoundingClientRect();
    return JSON.stringify({
      active: act.dataset.value, hasPill:true,
      transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration,
      vars, want,
      // ★ 关键：--seg-x 是 JS 立刻写下的"目标值"，读它量不出滑动过程。
      //   要判断"是不是真的在滑"，必须量滑块**渲染出来的**位置。
      pillX: Math.round(pb.left-bb2.left), btnX: Math.round(ab.left-bb2.left),
      dx: Math.round(pb.left-ab.left), dw: Math.round(pb.width-ab.width),
      btnVals: [...box.querySelectorAll('.seg-btn')].map(b=>b.dataset.value),
      activeBg: getComputedStyle(act).backgroundColor,
      disabled: cs.transitionDuration === '0s' || cs.transitionProperty === 'none'
    }); })()`;

  // ① 减弱动效下：滑块必须"直接到位"（不许有过渡）
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await boot('notes/overview');
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2600);
  const pRed = JSON.parse(await evaluate(PILL));
  ok(!pRed.err, `外观分段控件渲染出滑块（${pRed.err || 'ok'}）`);
  if (!pRed.err) {
    console.log(`  减弱动效：transition=${pRed.transitionProperty} / ${pRed.transitionDuration}；滑块变量 x=${pRed.vars.x} w=${pRed.vars.w}，选中「${pRed.active}」`);
    ok(pRed.disabled, '★ 减弱动效时滑块不过渡（直接到位）');
    ok(Math.abs(pRed.dx) <= 1 && Math.abs(pRed.dw) <= 1,
       `★ 滑块与选中项几何一致（偏差 dx=${pRed.dx} dw=${pRed.dw}）——几何是量出来的，不是写死宽度`);
  }

  // ② 允许动效时：有过渡，并且点了真的滑到新位置
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await boot('notes/overview');
  await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2600);
  const p0 = JSON.parse(await evaluate(PILL));
  ok(!p0.err && /transform/.test(p0.transitionProperty) && parseFloat(p0.transitionDuration) > 0,
     `★ 允许动效时滑块有 transform 过渡（${p0.transitionProperty} / ${p0.transitionDuration}）`);

  // 从当前值切到另一个值（优先切到"暗"，它和另外两个都不同）
  const other = (p0.btnVals || []).find(v => v !== p0.active) || 'dark';
  const before = p0;
  await evaluate(`(()=>{ const b=document.querySelector('#colorSchemeSeg .seg-btn[data-value=${JSON.stringify(other)}]'); b.click(); return true; })()`);
  await sleep(110);
  const pMid = JSON.parse(await evaluate(PILL));
  await sleep(700);
  const p1 = JSON.parse(await evaluate(PILL));
  console.log(`  点「${other}」：渲染位置 起点 pillX=${before.pillX} → 中途 ${pMid.pillX} → 终点 ${p1.pillX}（目标 btnX=${p1.btnX}）`);
  ok(p1.active === other, `★ 点击后高亮状态切到「${other}」（实际 ${p1.active}）`);
  ok(Math.abs(p1.dx) <= 1 && Math.abs(p1.dw) <= 1,
     `★ 滑到位后与新的选中项几何一致（偏差 dx=${p1.dx} dw=${p1.dw}）`);
  ok(p1.pillX !== before.pillX, `★ 滑块真的移动了（${before.pillX} → ${p1.pillX}），不是原地换色`);
  // 中途那一帧必须夹在起终点之间 —— 这才证明是"滑过去"而不是"闪过去"
  const lo = Math.min(before.pillX, p1.pillX), hi = Math.max(before.pillX, p1.pillX);
  ok(pMid.pillX > lo && pMid.pillX < hi,
     `★ 中途那一帧夹在起终点之间 = 确实在滑动（${before.pillX} → ${pMid.pillX} → ${p1.pillX}）`);
  ok(p0.activeBg === 'rgba(0, 0, 0, 0)' || p0.activeBg === 'transparent',
     `★ 选中按钮自身背景透明（高亮由滑块画，否则会是两块）—— 实际 ${p0.activeBg}`);

  // ③ 切主题色也不能把滑块弄丢（主题色变了滑块颜色跟着变，位置不动）
  const beforeTheme = JSON.parse(await evaluate(PILL));
  await evaluate(`(()=>{ if (typeof applyTheme==='function') { applyTheme('#d92121'); return true; } return false; })()`);
  await sleep(400);
  const pTheme = JSON.parse(await evaluate(PILL));
  ok(pTheme.vars.x === beforeTheme.vars.x && Math.abs(pTheme.dx) <= 1,
     `★ 换主题色后滑块还在原位（渲染位置 ${beforeTheme.pillX} → ${pTheme.pillX}）`);
  }

  // ══════════════ ⑭「纸币 / 硬币」的选中高亮也是滑动块 ══════════════
  // ★ 用户要求："纸币 硬币 ←这个也做成滑动块"（和「明暗」那几个选项同一套 .seg-pill）。
  //   这段其实和 ⑬ 是同一个机制，但换成 .rating-tabs / .rating-tab.active 这套类名，
  //   所以"量选中项"的选择器容易漏 —— 这里就是专门盯着它别漏。
  console.log('\n══════ ⑭ 纸币/硬币 高亮滑块 ══════');
  {
    const RPILL = `(()=>{ const box=document.querySelector('.rating-tabs');
      if(!box) return JSON.stringify({ err:'没有 .rating-tabs' });
      const pill=box.querySelector('.seg-pill');
      const act=box.querySelector('.rating-tab.active');
      if(!pill||!act) return JSON.stringify({ err:'缺少 .seg-pill 或 .rating-tab.active', hasPill:!!pill, hasActive:!!act });
      const cs=getComputedStyle(pill), bb=box.getBoundingClientRect();
      const pb=pill.getBoundingClientRect(), ab=act.getBoundingClientRect();
      return JSON.stringify({ active: act.dataset.mode, mode: (typeof ratingMode!=='undefined')?ratingMode:'?',
        tabs: [...box.querySelectorAll('.rating-tab')].map(t=>t.dataset.mode),
        transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration,
        pillBg: cs.backgroundColor, theme: getComputedStyle(document.documentElement).getPropertyValue('--theme').trim(),
        pillX: Math.round(pb.left-bb.left), btnX: Math.round(ab.left-bb.left),
        dx: Math.round(pb.left-ab.left), dw: Math.round(pb.width-ab.width),
        // ★ 两项之间不能有竖线：滑块在下面，线在 z-index 之上会从滑块上划过去（用户报过）
        tabBorderRight: getComputedStyle(act).borderRightWidth,
        所有竖线: [...box.querySelectorAll('.rating-tab')].map(t=>getComputedStyle(t).borderRightWidth),
        // 滑块要和它盖住的那个 tab 完全重合（否则会在边上露出一条底色）
        pillCoverX: Math.round(pb.left-ab.left), pillCoverW: Math.round(pb.width-ab.width),
        activeBg: getComputedStyle(act).backgroundColor,
        // ★ 设计：两块图表在同一个圆角卡片里；两条小节标题各占一条柱状图高度、居中
        卡内标题: [...document.querySelectorAll('.stats-chart-card .stats-chart-sub')].map(h=>h.textContent.trim()),
        卡内区块: [...document.querySelectorAll('.stats-chart-card [id]')].map(e=>e.id),
        卡片圆角: getComputedStyle(document.querySelector('.stats-chart-card')||document.body).borderRadius,
        卡片数: document.querySelectorAll('.stats-chart-card').length,
        标题对齐: [...document.querySelectorAll('.stats-chart-card .stats-chart-sub')].map(h=>getComputedStyle(h).textAlign),
        标题高: [...document.querySelectorAll('.stats-chart-card .stats-chart-sub')].map(h=>Math.round(h.getBoundingClientRect().height)),
        一根柱子行高: (()=>{ const r=document.querySelector('#ratingSection .stat-bar-row'); return r?Math.round(r.getBoundingClientRect().height):0; })(),
        tabs在卡片里: !!document.querySelector('.stats-chart-card .rating-tabs'),
        tabs在卡片顶行: !!document.querySelector('.stats-chart-card .stats-chart-head .rating-tabs') }); })()`;

    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await boot('notes/overview');
    await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2600);
    const r0 = JSON.parse(await evaluate(RPILL));
    console.log(`  ${JSON.stringify({ active: r0.active, pillX: r0.pillX, btnX: r0.btnX, dx: r0.dx, dw: r0.dw, pillBg: r0.pillBg })}`);
    ok(!r0.err, `纸币/硬币渲染出滑块（${r0.err || 'ok'}）`);
    if (!r0.err) {
      // ★ 用户设计：评级得分统计 + 藏品年代统计 联动，放进同一个圆角矩形；
      //   两条小节标题各占一条柱状图的高度、居中；币种切换挪到卡片顶上。
      ok(r0.卡片数 === 1 && r0.卡内区块.join(',') === 'ratingSection,yearSection',
        `★ ⑭ 两块图表在同一个圆角卡片里（卡片 ${r0.卡片数} 个，区块 ${r0.卡内区块.join('+')}）`);
      ok(r0.tabs在卡片顶行 === true, '★ ⑭ 币种切换在卡片顶行');
      ok(r0.卡内标题.join('/') === '评级得分统计/藏品年代统计', `★ ⑭ 两条小节标题是「${r0.卡内标题.join('」「')}」`);
      ok(r0.标题对齐.every(a => a === 'center'), `★ ⑭ 两条小节标题居中（text-align=${JSON.stringify(r0.标题对齐)}）`);
      ok(r0.标题高.every(h => Math.abs(h - r0.一根柱子行高) <= 1),
        `★ ⑭ 标题高度 = 一条柱状图的高度（标题 ${JSON.stringify(r0.标题高)} vs 柱行 ${r0.一根柱子行高}）`);
      ok(parseFloat(r0.卡片圆角) > 0, `★ ⑭ 卡片是圆角矩形（border-radius=${r0.卡片圆角}）`);
      ok(r0.tabs.join('/') === 'notes/coins', `⑭ 两个选项是 纸币/硬币（data-mode=${r0.tabs.join('/')}）`);
      ok(Math.abs(r0.dx) <= 1 && Math.abs(r0.dw) <= 1,
        `★ ⑭ 滑块与选中项几何一致（偏差 dx=${r0.dx} dw=${r0.dw}）——几何是量出来的`);
      ok(r0.pillBg === r0.theme, `★ ⑭ 滑块用的是主题色（${r0.pillBg} = --theme ${r0.theme}）`);
      ok(r0.activeBg === 'rgba(0, 0, 0, 0)', `★ ⑭ 选中 tab 自身背景透明（高亮由滑块画，否则两块）—— 实际 ${r0.activeBg}`);
      ok(r0.所有竖线.every(w => w === '0px'),
        `★ ⑭ 两个选项之间没有竖线（滑块才不会被一条线划过去）—— 实际 ${JSON.stringify(r0.所有竖线)}`);
      ok(/transform/.test(r0.transitionProperty) && parseFloat(r0.transitionDuration) > 0,
        `⑭ 滑块有 transform 过渡（${r0.transitionProperty} / ${r0.transitionDuration}）`);

      // 点「硬币」：滑块要滑过去，不是原地换色
      const other = r0.active === 'notes' ? 'coins' : 'notes';
      await evaluate(`(()=>{ const t=document.querySelector('.rating-tab[data-mode=${JSON.stringify(other)}]'); t.click(); return true; })()`);
      await sleep(80);
      const rMid = JSON.parse(await evaluate(RPILL));
      await sleep(700);
      const r1 = JSON.parse(await evaluate(RPILL));
      console.log(`  点「${other}」：${r0.pillX} → 中途 ${rMid.pillX} → ${r1.pillX}（目标 ${r1.btnX}）`);
      ok(r1.active === other && r1.mode === other, `★ ⑭ 点击后高亮与统计模式都切到「${other}」（${r1.active}/${r1.mode}）`);
      ok(Math.abs(r1.dx) <= 1 && Math.abs(r1.dw) <= 1, `★ ⑭ 滑到位后与新选中项几何一致（偏差 dx=${r1.dx} dw=${r1.dw}）`);
      ok(r1.pillX !== r0.pillX, `★ ⑭ 滑块真的移动了（${r0.pillX} → ${r1.pillX}），不是原地换色`);
      const lo = Math.min(r0.pillX, r1.pillX), hi = Math.max(r0.pillX, r1.pillX);
      ok(rMid.pillX > lo && rMid.pillX < hi, `★ ⑭ 中途那一帧夹在起终点之间 = 确实在滑动（${r0.pillX} → ${rMid.pillX} → ${r1.pillX}）`);

      // ★ 切换的动画（用户设计）：柱子按槽位伸缩、左右文字淡出淡入、
      //   「藏品年代统计」标题滑到新槽位、整个卡片做展开/收起。
      //   注意别拿"第一根柱子"当判据：占比最高的那一档两边常常都是 100%，
      //   只盯它会把"有动画"误判成"没动画"；这里比对整组柱宽签名。
      const back = other === 'coins' ? 'notes' : 'coins';
      const MORPH = JSON.parse(await evaluate(`(async()=>{
        const card=document.querySelector('.stats-chart-card');
        const title=document.querySelectorAll('.stats-chart-card .stats-chart-sub')[1];
        const sig=()=>[...document.querySelectorAll('#ratingSection .stat-bar-fill')]
          .map(f=>Math.round(f.getBoundingClientRect().width)).join(',');
        const opa=()=>{ const l=document.querySelector('#ratingSection .stat-bar-label');
          return l?Number(Number(getComputedStyle(l).opacity).toFixed(3)):-1; };
        // "从无到有"多出来的柱子：盯最后一根（切到柱数更多的那种时它原本不存在）
        const lastW=()=>{ const fs=document.querySelectorAll('#ratingSection .stat-bar-fill');
          return fs.length?Math.round(fs[fs.length-1].getBoundingClientRect().width):-1; };
        const s0=sig(), h0=Math.round(card.getBoundingClientRect().height);
        const sigs=[], ops=[], tops=[], hs=[], lasts=[];
        const t0=performance.now();
        document.querySelector('.rating-tab[data-mode="${back}"]').click();
        await new Promise(res=>{ const tick=()=>{ sigs.push(sig()); ops.push(opa());
            tops.push(Math.round(title.getBoundingClientRect().top));
            hs.push(Math.round(card.getBoundingClientRect().height));
            lasts.push(lastW());
            if (performance.now()-t0<820) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
        return JSON.stringify({ h0, s0, 档数:new Set(sigs).size, 首帧:sigs[0], 末帧:sigs[sigs.length-1],
          透明档数:new Set(ops).size, 最小透明度:Math.min(...ops), 最高透明度:Math.max(...ops),
          标题档数:new Set(tops).size, 标题首:tops[0], 标题末:tops[tops.length-1],
          卡片档数:new Set(hs).size, 卡片首:hs[0], 卡片末:hs[hs.length-1],
          末柱首几帧:lasts.slice(0,10), 末柱最小:Math.min(...lasts.filter(x=>x>=0)), 末柱末:lasts[lasts.length-1],
          残留类:[...document.querySelectorAll('.stat-bar-row')].filter(r=>r.classList.contains('text-out')||r.classList.contains('text-in')).length,
          残留:{height:card.style.height,transition:card.style.transition,overflow:card.style.overflow,
                标题t:title.style.transform,标题o:title.style.opacity,标题tr:title.style.transition,
                柱子:[...document.querySelectorAll('.stat-bar-fill')].filter(f=>f.style.transition||f.dataset.to).length} });
      })()`));
      console.log(`  切到「${back}」：柱宽签名 ${MORPH.档数} 档；文字透明度 ${MORPH.最小透明度}→${MORPH.最高透明度}；` +
        `年代标题 top ${MORPH.标题首}→${MORPH.标题末}（${MORPH.标题档数} 档）；卡片高 ${MORPH.卡片首}→${MORPH.卡片末}（${MORPH.卡片档数} 档）`);
      console.log(`  末根柱子（切前不存在）：${MORPH.末柱首几帧.join('/')} → ${MORPH.末柱末}px`);
      ok(MORPH.档数 > 2, `★ ⑭ 柱子按槽位伸缩（整组柱宽出现 ${MORPH.档数} 个签名，不是硬切）`);
      ok(MORPH.末柱最小 <= 3 && MORPH.末柱末 > 3,
        `★ ⑭ "从无到有"的柱子从 0 拉长到应有长度（最小 ${MORPH.末柱最小}px → 末 ${MORPH.末柱末}px）`);
      ok(MORPH.末帧 !== MORPH.首帧, `★ ⑭ 柱子最终换成了新口径的数据（${MORPH.首帧} → ${MORPH.末帧}）`);
      ok(MORPH.最小透明度 < 0.9 && MORPH.最高透明度 > 0.9,
        `★ ⑭ 柱行左右的文字淡出再淡入（透明度 ${MORPH.最小透明度} → ${MORPH.最高透明度}，${MORPH.透明档数} 档）`);
      ok(MORPH.标题档数 > 2 && MORPH.标题末 !== MORPH.标题首,
        `★ ⑭ 「藏品年代统计」标题滑到新槽位（top ${MORPH.标题首} → ${MORPH.标题末}，${MORPH.标题档数} 档）`);
      ok(MORPH.卡片档数 > 2, `★ ⑭ 卡片做展开/收起的高度过渡（${MORPH.卡片首} → ${MORPH.卡片末}，${MORPH.卡片档数} 档）`);
      ok(!MORPH.残留.height && !MORPH.残留.transition && !MORPH.残留.overflow &&
         !MORPH.残留.标题t && !MORPH.残留.标题o && !MORPH.残留.标题tr,
        `★ ⑭ 动画结束后不留内联样式（${JSON.stringify(MORPH.残留)}）`);
      ok(MORPH.残留.柱子 === 0 && MORPH.残留类 === 0,
        `⑭ 柱子不留内联过渡、行上的动画类也清干净（柱子 ${MORPH.残留.柱子} / 类 ${MORPH.残留类}）`);

      // 重渲染后（切板块往返）滑块还得在位，不能跑到最左边。
      // 注意此时选中的是 back（上面那段动画又点了一次），不是 other。
      await evaluate(`(()=>{ onTabClick('coins'); return true; })()`); await sleep(2200);
      await evaluate(`(()=>{ onTabClick('settings'); return true; })()`); await sleep(2600);
      const r2 = JSON.parse(await evaluate(RPILL));
      ok(r2.active === back && Math.abs(r2.dx) <= 1,
        `★ ⑭ 重渲染后滑块仍在选中项上（active=${r2.active}，期望 ${back}，偏差 dx=${r2.dx}）`);

      // ★ 连点滑块：不重复淡入，但也不能把文字藏着（用户："藏太久了，还不如之前那个，
      //   我只是要求不要重复淡入"）—— 所以连点期间文字应该一直是亮的。
      const RAPID = JSON.parse(await evaluate(`(async()=>{
        const opa=()=>{ const l=document.querySelector('#ratingSection .stat-bar-label');
          return l?Number(Number(getComputedStyle(l).opacity).toFixed(2)):-1; };
        const tabs=[...document.querySelectorAll('.rating-tab')];
        const 点击期间=[];
        for (let i=0;i<8;i++){ tabs[i%2].click(); await new Promise(r=>setTimeout(r,45)); 点击期间.push(opa()); }
        const samples=[];
        const t1=performance.now();
        await new Promise(res=>{ const tick=()=>{ samples.push(opa());
            if (performance.now()-t1<1000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
        const all=点击期间.concat(samples);
        return JSON.stringify({ 点击期间, 点击期间最低:Math.min(...点击期间),
          最低:Math.min(...all), 最高:Math.max(...all),
          回升次数: all.reduce((n,v,i)=> n + (i>0 && v>0.9 && all[i-1]<=0.9 ? 1:0), 0),
          末尾:samples.slice(-4),
          残留类:[...document.querySelectorAll('.stat-bar-row')].filter(x=>x.classList.contains('text-out')||x.classList.contains('text-in')).length,
          残留内联:!!document.querySelector('.stats-chart-card').style.height });
      })()`));
      console.log(`  连点 8 次：点击期间文字透明度 ${RAPID.点击期间.join('/')}；之后 ${RAPID.最低}→${RAPID.最高}（回升 ${RAPID.回升次数} 次）`);
      ok(RAPID.回升次数 <= 1, `★ ⑭ 连点滑块时文字不重复淡入（从低回升到高 ${RAPID.回升次数} 次）`);
      ok(RAPID.点击期间最低 > 0.5, `★ ⑭ 连点期间文字不会消失（最低 ${RAPID.点击期间最低}，不藏）`);
      ok(RAPID.最高 > 0.9, `★ ⑭ 文字始终可见（末值 ${RAPID.最高}）`);
      ok(RAPID.残留类 === 0 && RAPID.残留内联 === false,
        `⑭ 连点后不留动画痕迹（类 ${RAPID.残留类} / 内联 ${RAPID.残留内联}）`);

      // 减弱动效：不许有过渡，但位置和内容照常
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await sleep(200);
      const rRed = JSON.parse(await evaluate(RPILL));
      ok(rRed.transitionDuration === '0s' || rRed.transitionProperty === 'none',
        `★ ⑭ 减弱动效时滑块不过渡（${rRed.transitionProperty} / ${rRed.transitionDuration}）`);
      ok(Math.abs(rRed.dx) <= 1, `⑭ 减弱动效时位置照样对（偏差 ${rRed.dx}）`);
      // 减弱动效下切换：内容要照常换、但不能留动画痕迹
      const rRedSwitch = JSON.parse(await evaluate(`(async()=>{
        const before=document.querySelector('#ratingSection .stat-bar-label').textContent;
        const first=document.querySelector('.rating-tab:not(.active)');
        first.click();
        await new Promise(r=>setTimeout(r,260));
        const card=document.querySelector('.stats-chart-card');
        const title=document.querySelectorAll('.stats-chart-card .stats-chart-sub')[1];
        return JSON.stringify({ 换了: document.querySelector('#ratingSection .stat-bar-label').textContent!==before,
          残留类:[...document.querySelectorAll('.stat-bar-row')].filter(x=>x.classList.contains('text-out')||x.classList.contains('text-in')).length,
          残留内联: !!(card.style.height||card.style.transition||title.style.transform||title.style.opacity||title.style.transition) });
      })()`));
      ok(rRedSwitch.换了 === true, '★ ⑭ 减弱动效时切换照常换内容');
      ok(rRedSwitch.残留类 === 0 && rRedSwitch.残留内联 === false,
        `★ ⑭ 减弱动效时不播动画、也不留痕迹（类 ${rRedSwitch.残留类} / 内联 ${rRedSwitch.残留内联}）`);
    }
  }

  // 收尾：媒体模拟恢复默认，免得影响后续用例
  await send('Emulation.setEmulatedMedia', { features: [] });

  console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.log('!! 异常: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  await sleep(300);
  process.exit(process.exitCode || 0);
}
