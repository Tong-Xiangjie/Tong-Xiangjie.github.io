// 币海拾年（时间轴专题）两件事的验证（已进仓库：collection/tools/tests）：
//   ① 换年份/月份后回到顶部
//   ② 标题下的标语改成"所选时间段一共花了多少钱"
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

console.log('══════ ① 静态：两处代码都在 ══════\n');
const sp = readFileSync('collection/special.js', 'utf8');
const fn = sp.slice(sp.indexOf('function onTimelineFilterChangeInner'), sp.indexOf('// ---------- 返回专题概览'));
const helper = sp.slice(sp.indexOf('function rerenderTimeline'), sp.indexOf('function onTimelineFilterChangeInner'));
ok(/specialPageCaches\[selectedSpecial\]\.scrollY = 0/.test(helper), '① rerenderTimeline 里先把滚动缓存清零（否则会被 render 末尾的还原拉回去）');
ok(/app\.scrollTop = 0/.test(helper), '① rerenderTimeline 渲染后把容器滚到顶部');
// 这里只匹配函数名，不写死参数：那个调用后来加了参数（keepChrome: true 用来把
// 进入动画限制在下面的列表上），写死 renderTimelineContent(config) 会让这条断言无故变红
ok(helper.indexOf('scrollY = 0') < helper.indexOf('renderTimelineContent('), '① 顺序正确：先清缓存、再渲染');
ok(/rerenderTimeline\(\)/.test(fn), '① 换年份/月份走 rerenderTimeline()');
ok(/rerenderTimeline\(\)/.test(sp.slice(sp.indexOf('function setTimelineOrderInner'), sp.indexOf('function rerenderTimeline'))), '① 换最新/最早（排序）也走 rerenderTimeline()');
ok((sp.match(/specialPageCaches\[[^\]]+\]\.scrollY = 0/g) || []).length === 1, '① 全站只有这一处清零（没有顺手破坏别处的滚动记忆）');
const hdr = sp.slice(sp.indexOf('let periodTotal'), sp.indexOf('const sloganText') + 260);
ok(/periodTotal/.test(hdr) && /你共花了/.test(hdr), '② 标语由"这段时间花了多少"算出来');
ok(/config\.slogan/.test(hdr), '② 一件都没记价格时仍回退到原来的标语（不硬说 0 元）');
ok(/item\.copy\.price/.test(hdr), '② 金额口径与每天那条"这天，你一共花了X元"一致');

// ─────────── 起服务 + 无头浏览器 ───────────
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpYT-'));
const DP = 11900 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || '')); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
await send('Runtime.enable');
await send('Page.enable');
async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof onTabClick==='function' && document.readyState==='complete' && Object.keys(viewScrollContainers||{}).length>0)()`).catch(() => false);
    if (r) break;
    await sleep(120);
  }
  await sleep(700);
}
const openYears = async () => {
  const id = await evaluate(`(()=>{
    const t = (typeof specialCategoryTree !== 'undefined' && specialCategoryTree) ? specialCategoryTree : [];
    const hit = t.find(c => /拾年|时间轴/.test(c.name || '')) || t.find(c => c.id === 'years');
    if (!hit) return '';
    if (typeof onSpecialOverviewItemClick === 'function') onSpecialOverviewItemClick(hit.id);
    return hit.id;
  })()`);
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`!!document.querySelector('.timeline-header') && !!document.getElementById('timelineYearFilter')`).catch(() => false);
    if (ready) break;
    await sleep(300);
  }
  await sleep(500);
  return id;
};
const state = () => evaluate(`(()=>{
  const app = getRenderContainer();
  const ys = document.getElementById('timelineYearFilter');
  const ms = document.getElementById('timelineMonthFilter');
  const sl = document.querySelector('.timeline-slogan');
  return JSON.stringify({
    year: ys ? ys.value : null, month: ms ? ms.value : null,
    slogan: sl ? sl.textContent.trim() : null,
    count: (document.querySelector('.timeline-top-count') || {}).textContent || null,
    scrollTop: app ? Math.round(app.scrollTop) : -1,
    scrollable: app ? Math.round(app.scrollHeight - app.clientHeight) : -1,
    cache: (typeof specialPageCaches !== 'undefined' && selectedSpecial && specialPageCaches[selectedSpecial]) ? specialPageCaches[selectedSpecial].scrollY : null,
    opts: ys ? [...ys.options].map(o => o.value) : []
  });
})()`).then(JSON.parse);
// 独立重算：自己解析日期与价格，不调用页面里的过滤器
const expectSum = (year, month) => evaluate(`(()=>{
  const px = (s) => { const m = String(s == null ? '' : s).match(/[0-9]+(?:\\.[0-9]+)?/); return m ? parseFloat(m[0]) : NaN; };
  const pd = (s) => { const m = String(s||'').trim().match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日?/); return m ? { y: +m[1], mo: +m[2] } : null; };
  let sum = 0, n = 0, priced = 0;
  for (const map of [window.DATA_MAP, window.COIN_DATA_MAP]) {
    if (!map) continue;
    for (const k of Object.keys(map)) {
      const d = map[k]; if (!d || !d.series) continue;
      const walk = (arr) => { for (const c of (arr || [])) {
        if (!c || !c.purchaseDate) continue;
        const dt = pd(c.purchaseDate); if (!dt) continue;
        if (${JSON.stringify(year)} !== '全部' && String(dt.y) !== ${JSON.stringify(year)}) continue;
        if (${JSON.stringify(month)} !== '全部' && String(dt.mo).padStart(2, '0') !== ${JSON.stringify(month)}) continue;
        n++; const p = px(c.price); if (!isNaN(p) && p > 0) { sum += p; priced++; }
      } };
      for (const s of d.series) { if (s.varieties) { for (const v of s.varieties) walk(v.copies); } else walk(s.copies); }
    }
  }
  return JSON.stringify({ sum: Math.round(sum), n, priced });
})()`).then(JSON.parse);

// ─────────── ② 进入币海拾年 ───────────
console.log('\n══════ ② 标语：所选时间段一共花了多少 ══════\n');
await boot('notes');
const sid = await openYears();
ok(!!sid, `进入币海拾年（${sid || '没找到'}）`);
const s0 = await state();
ok(!!s0.slogan, `标题下的标语现在是：「${s0.slogan}」`);
ok(/你共花了\s*\d+\s*元/.test(s0.slogan || ''), '标语换成了"…你共花了 N 元"');
ok(!/一钞一年号/.test(s0.slogan || ''), '不再是原来那句 slogan（一钞一年号，一纸一春秋）');
const e0 = await expectSum(s0.year, s0.month);
const got0 = parseInt((s0.slogan.match(/共花了\s*(\d+)\s*元/) || [])[1], 10);
ok(got0 === e0.sum, `★ 金额与独立重算一致：页面 ${got0} 元 vs 测试自己算 ${e0.sum} 元（${s0.year}/${s0.month}，${e0.n} 件，其中 ${e0.priced} 件有价）`);
ok(/到目前为止/.test(s0.slogan || ''), '全部年份+全部月份时措辞是"到目前为止"（不是"全部时间段"这种别扭说法）');
ok(!/在|里/.test((s0.slogan || '').replace('到目前为止', '')), `措辞里没有多余的"在/里"（${s0.slogan}）`);

// ─────────── ③ 换年份/月份要回到顶部 ───────────
console.log('\n══════ ③ 换筛选后回到顶部 ══════\n');
const scrollTest = async (label, setter, plantStale) => {
  const pre = await state();
  if (pre.scrollable < 80) { console.log(`      （${label}：内容不够长，跳过滚动检查，余量 ${pre.scrollable}px）`); return null; }
  // 种一个"上次记住的旧位置"，模拟真实场景：缓存里明明有值，换筛选时必须作废
  if (plantStale) {
    await evaluate(`(()=>{ if (typeof selectedSpecial !== 'undefined' && selectedSpecial) {
      specialPageCaches[selectedSpecial] = specialPageCaches[selectedSpecial] || {};
      specialPageCaches[selectedSpecial].scrollY = 999; } return 1; })()`);
    const planted = await state();
    ok(planted.cache === 999, `${label}：先往缓存里种一个旧位置 ${planted.cache}（模拟"上次记住的 999px"）`);
  }
  await evaluate(`(()=>{ const app = getRenderContainer(); app.scrollTop = ${Math.min(420, pre.scrollable)}; return 1; })()`);
  await sleep(350);
  const scrolled = await state();
  ok(scrolled.scrollTop > 60, `${label}：先把列表滚到 ${scrolled.scrollTop}px（可滚 ${scrolled.scrollable}px，确认这就是真滚动容器）`);
  await evaluate(setter);
  await sleep(700);
  const after = await state();
  return { scrolled, after };
};
const years = s0.opts.filter(v => v !== '全部');
if (years.length === 0) { ok(false, '年份下拉里没有可选的年份，无法验证'); }
else {
  const y = years[years.length - 1];
  const r1 = await scrollTest(`换到 ${y} 年`, `(()=>{ const s=document.getElementById('timelineYearFilter'); s.value=${JSON.stringify(y)}; s.dispatchEvent(new Event('change')); return 1; })()`, true);
  if (r1) {
    ok(r1.after.year === y, `③ 筛选确实生效（现在看的是 ${r1.after.year} 年）`);
    ok(r1.after.scrollTop === 0, `★ 换年份后回到顶部（scrollTop ${r1.scrolled.scrollTop} → ${r1.after.scrollTop}）`);
    ok(r1.after.cache === 0, `★ 缓存里那个旧位置也被作废了（999 → ${r1.after.cache}），不会被 render 末尾的还原拉回 999px`);
    const ey = await expectSum(y, r1.after.month);
    const gy = parseInt((r1.after.slogan.match(/共花了\s*(\d+)\s*元/) || [])[1], 10);
    ok(gy === ey.sum, `标语金额跟着变：${gy} 元 = 独立重算 ${ey.sum} 元（${ey.n} 件）`);
    ok(new RegExp(y).test(r1.after.slogan), `措辞里带上了年份（${r1.after.slogan}）`);
    ok(r1.after.slogan.indexOf('在') < 0 && r1.after.slogan.indexOf('里') < 0, `年份那句没有"在/里"（${r1.after.slogan}）`);
  }
  const r2 = await scrollTest('换月份', `(()=>{ const s=document.getElementById('timelineMonthFilter'); s.value='07'; s.dispatchEvent(new Event('change')); return 1; })()`);
  if (r2) {
    ok(r2.after.month === '07', '③ 月份筛选生效（07 月）');
    ok(r2.after.scrollTop === 0, `★ 换月份后也回到顶部（scrollTop ${r2.scrolled.scrollTop} → ${r2.after.scrollTop}）`);
    const em = await expectSum(r2.after.year, '07');
    const gm = parseInt((r2.after.slogan.match(/共花了\s*(\d+)\s*元/) || [])[1], 10);
    ok(gm === em.sum, `07 月的金额也一致：${gm} 元 = 独立重算 ${em.sum} 元（${em.n} 件）`);
    ok(/7 月/.test(r2.after.slogan), `措辞里带上了月份（${r2.after.slogan}）`);
    ok(r2.after.slogan.indexOf('在') < 0 && r2.after.slogan.indexOf('里') < 0, `年+月那句也没有"在/里"（${r2.after.slogan}）`);
  }
  // 只选月份（年份回到全部）：措辞应是"历年 7 月，你共花了 N 元"
  await evaluate(`(()=>{ const s=document.getElementById('timelineYearFilter'); s.value='全部'; s.dispatchEvent(new Event('change')); return 1; })()`);
  await sleep(800);
  const rm = await state();
  const em2 = await expectSum('全部', '07');
  const gm2 = parseInt((rm.slogan.match(/共花了\s*(\d+)\s*元/) || [])[1], 10);
  ok(/^历年 7 月，你共花了/.test(rm.slogan || ''), `只选月份时措辞是"历年 7 月，…"（${rm.slogan}）`);
  ok(gm2 === em2.sum, `只选月份时的金额也一致：${gm2} 元 = 独立重算 ${em2.sum} 元（${em2.n} 件）`);
  // 换"最新/最早"（排序）也要回到顶部（用户追加要求）
  const preSort = await state();
  if (preSort.scrollable < 80) { console.log(`      （排序：内容不够长，跳过，余量 ${preSort.scrollable}px）`); }
  else {
    await evaluate(`(()=>{ getRenderContainer().scrollTop = ${Math.min(420, preSort.scrollable)}; return 1; })()`);
    await sleep(350);
    const scrolledS = await state();
    ok(scrolledS.scrollTop > 60, `换排序前先把列表滚到 ${scrolledS.scrollTop}px`);
    const clicked = await evaluate(`(()=>{
      const btn = [...document.querySelectorAll('.timeline-sort-btn')].find(b => !b.classList.contains('active'));
      if (!btn) return '';
      btn.click();
      return btn.textContent.trim();
    })()`);
    await sleep(800);
    const afterS = await state();
    ok(!!clicked, `点到了另一颗排序按钮「${clicked}」`);
    ok(afterS.scrollTop === 0, `★ 换最新/最早后也回到顶部（${scrolledS.scrollTop} → ${afterS.scrollTop}）`);
    ok(afterS.cache === 0 || afterS.cache === null, `排序也把缓存里的旧位置作废（${afterS.cache}）`);
    const eS = await expectSum(afterS.year, afterS.month);
    const gS = parseInt(((afterS.slogan || '').match(/共花了\s*(\d+)\s*元/) || [])[1], 10);
    ok(gS === eS.sum, `排序只改顺序不改金额（${gS} 元 = 独立重算 ${eS.sum} 元）`);
    const firstDate = await evaluate(`(()=>{ const h = document.querySelector('.timeline-date-label'); return h ? h.textContent.trim() : ''; })()`);
    ok(!!firstDate, `列表确实重排了（首条日期：${firstDate}）`);
  }
}

// ─────────── ④ 只重置这一条缓存，不误伤别的 ───────────
console.log('\n══════ ④ 不误伤别的滚动缓存 ══════\n');
await evaluate(`(()=>{ const s=document.getElementById('timelineYearFilter'); if(s){s.value='全部'; s.dispatchEvent(new Event('change'));}
  const m=document.getElementById('timelineMonthFilter'); if(m){m.value='全部'; m.dispatchEvent(new Event('change'));} return 1; })()`);
await sleep(800);
const planted = JSON.parse(await evaluate(`(()=>{
  if (typeof specialPageCaches === 'undefined' || typeof selectedSpecial === 'undefined' || !selectedSpecial) return JSON.stringify(null);
  specialPageCaches['__overview__'] = { scrollY: 321 };
  specialPageCaches['__other_special__'] = { scrollY: 654, currentSubId: 'x' };
  const put = (id, v) => { const el = document.getElementById(id); if (!el) return null; el.value = v; el.dispatchEvent(new Event('change')); return el.value; };
  const ys = document.getElementById('timelineYearFilter');
  const yv = put('timelineYearFilter', ys.options[ys.options.length - 1].value);
  const ms = document.getElementById('timelineMonthFilter');
  const mv = put('timelineMonthFilter', ms.options[1].value);
  return JSON.stringify({ ov: 321, other: 654, year: yv, month: mv, id: selectedSpecial });
})()`));
await sleep(900);
const afterTouch = JSON.parse(await evaluate(`(()=>{
  if (typeof specialPageCaches === 'undefined') return JSON.stringify(null);
  return JSON.stringify({ ov: specialPageCaches['__overview__'] ? specialPageCaches['__overview__'].scrollY : null,
    other: specialPageCaches['__other_special__'] ? specialPageCaches['__other_special__'].scrollY : null,
    timeline: (typeof selectedSpecial !== 'undefined' && selectedSpecial && specialPageCaches[selectedSpecial]) ? specialPageCaches[selectedSpecial].scrollY : null,
    scrollTop: getRenderContainer() ? Math.round(getRenderContainer().scrollTop) : -1 });
})()`));
if (!planted) { ok(false, '④ 拿不到 specialPageCaches（无法验证）'); }
else {
  ok(afterTouch.ov === 321, `换筛选后"专题概览"的缓存原封不动（321 → ${afterTouch.ov}）`);
  ok(afterTouch.other === 654, `别的专题的缓存也没被动（654 → ${afterTouch.other}）`);
  ok(afterTouch.timeline === 0, `只有时间轴自己那条被清零（${afterTouch.timeline}）`);
  ok(afterTouch.scrollTop === 0, `换筛选后仍停在顶部（${afterTouch.scrollTop}px，这次是年+月一起换）`);
  await evaluate(`(()=>{ delete specialPageCaches['__other_special__']; delete specialPageCaches['__overview__']; return 1; })()`);
}

// ─────────── ⑤ 滚动记忆机制自检（信息，不判失败）───────────
console.log('\n══════ ⑤ 滚动记忆机制自检（信息）══════\n');
const mech = JSON.parse(await evaluate(`(()=>{
  const key = getContainerKey();
  const vc = viewScrollContainers[key];
  const app = getRenderContainer();
  const out = { key: key, same: vc === app,
    vcTag: vc ? (vc.id || vc.className || vc.tagName) : null,
    appTag: app ? (app.id || app.className || app.tagName) : null,
    vcRoom: vc ? Math.round(vc.scrollHeight - vc.clientHeight) : -1,
    appRoom: app ? Math.round(app.scrollHeight - app.clientHeight) : -1 };
  if (app) app.scrollTop = 300;
  out.appAfterSet = app ? Math.round(app.scrollTop) : -1;
  if (typeof saveFullState === 'function') saveFullState();
  out.saved = (typeof selectedSpecial !== 'undefined' && selectedSpecial && specialPageCaches[selectedSpecial]) ? specialPageCaches[selectedSpecial].scrollY : null;
  if (app) app.scrollTop = 0;
  return JSON.stringify(out);
})()`));
console.log(`      容器 key = ${mech.key}；viewScrollContainers[key] 与 getRenderContainer() ${mech.same ? '是同一个元素' : '不是同一个元素'}`);
console.log(`      viewScrollContainers[key] = ${mech.vcTag}（可滚 ${mech.vcRoom}px）`);
console.log(`      getRenderContainer()     = ${mech.appTag}（可滚 ${mech.appRoom}px，设 300 后读回 ${mech.appAfterSet}px）`);
console.log(`      saveFullState() 存下的是 ${mech.saved}px`);
if (!mech.same) console.log('      ⚠ 两者不同一：时间轴"返回再进来记住位置"这条链路本来就对不上（与本次改动无关；本次只加了换筛选时清零）');
else if (mech.saved !== mech.appAfterSet) console.log('      ⚠ 存下的位置与实际滚动位置不一致（与本次改动无关）');
else console.log('      ✓ 保存链路一致');
ok(true, '⑤ 机制自检已输出（信息性，不影响结论）');

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
child.kill();
server.close();
process.exitCode = fail ? 1 : 0;
