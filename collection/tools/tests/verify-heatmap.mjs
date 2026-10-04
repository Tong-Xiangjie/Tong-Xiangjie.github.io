// 币海拾年 · 按月份热力图（年 × 月）验收：
//   · 每年一行、12 个月一列，格子按"当月花了多少钱"分级
//   · 悬停（CSS 自写 tooltip，不用 JS 定位）显示**购买件数与具体金额**
//   · 格子里的数字必须与"自己从原始数据重算"的结果完全一致（不信任页面里的聚合代码）
//   · 全部格子的金额之和 == 标语「到目前为止，你共花了 N 元」的 N（口径必须一致）
//   · 点格子 = 把年份/月份筛选取上这个格子
//   · 手机宽度下不横向溢出；深色主题下 tooltip 可读
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ─────────── ① 静态：结构与"CSS 定位"这条硬约束 ───────────
console.log('══════ ① 静态：热力图代码与 CSS-only tooltip ══════\n');
const sp = readFileSync('collection/special.js', 'utf8');
const css = readFileSync('collection/layout.css', 'utf8');
ok(/function\s+buildMonthHeatmap/.test(sp), '① special.js 里有热力图构造函数');
const renderFn = sp.slice(sp.indexOf('function renderTimelineContent'), sp.length);
ok(/buildMonthHeatmap\s*\(/.test(renderFn), '① renderTimelineContent 里调用了它');
ok(renderFn.indexOf('buildMonthHeatmap(') < renderFn.indexOf('if (filteredItems.length === 0)'), '① 空状态提前 return 之前就渲染热力图（筛选到没结果时图还在）');
// 构造函数只拼字符串，不做任何测量/定位（泡的位置交给 CSS + 悬停时的两个自定义属性）
const builder = sp.slice(sp.indexOf('function buildMonthHeatmap'), sp.indexOf('\nfunction applyTimelineFilter'));
ok(!/getBoundingClientRect|style\.(left|top|right|bottom|position)\s*=/.test(builder), '① ★ 构造函数里没有任何 JS 定位/测量（只拼 HTML 字符串）');
// 水平微调只允许在 clampHeatmapTip 里，而且只准写 --hm-tx / --hm-arrow 两个自定义属性
const clampFn = sp.slice(sp.indexOf('function clampHeatmapTip'), sp.indexOf('let heatmapTipClampBound'));
ok(/--hm-tx/.test(clampFn) && /--hm-arrow/.test(clampFn), '① clampHeatmapTip 只调 --hm-tx / --hm-arrow 两个自定义属性（「能居中就居中」）');
ok(!/style\.(left|top|right|bottom|position|transform|width)\s*=/.test(clampFn), '① clampHeatmapTip 不写任何内联的定位/尺寸属性');
ok(/:hover/.test(css) && /\.tl-heatmap-tip/.test(css), '① CSS 里有 .tl-heatmap-tip 且靠 :hover 显示');
ok(/@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/.test(css), '① 触摸/鼠标分开处理（沿用站内既有写法）');
ok(/prefers-reduced-motion/.test(css.slice(css.indexOf('.tl-heatmap'), css.indexOf('.timeline-body'))), '① 热力图样式里有 reduced-motion 兜底');
// ★ 缩放必须落在**色块**上而不是格子上：tooltip 是格子的子元素，格子一缩放它也被放大 4%，
//   于是"量宽度时还在热力图内、悬停动画结束后又冒出去"（手机上实测差 2px）
ok(/\.tl-heatmap-cell:hover\s*>\s*\.tl-hm-fill\s*\{[^}]*scale\(1\.0[0-6]\)/.test(css), '① 悬停只轻轻放大一点点（scale ≤ 1.06）且加在色块上（不放大子元素 tooltip）');
ok(!/\.tl-heatmap-title/.test(css) && !/tl-heatmap-title/.test(sp), '① 已去掉"按月份统计（共 N 件…）"那句标题（用户要求）');
// ★ 淡入/位移动画必须留在 CSS 里：clamp 一旦去冻 transition，出现的动画就没了、只剩退出动画
//   （用户反馈过"悬浮泡出现的动画基本没有，只有退出动画"）
ok(/transition:[^;]*opacity[^;]*transform/.test(css), '① 泡的淡入 + 位移写在 CSS 的 transition 里（出现的动画不会丢）');
ok(!/style\.transition|transitionProperty|transition\s*=\s*'none'/.test(clampFn), '① clampHeatmapTip 不碰 transition（动了就只剩退出动画）');

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
const userDir = await mkdtemp(join(tmpdir(), 'cdpHM-'));
const DP = 12550 + Math.floor(Math.random() * 120);
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

const openYears = async () => {
  const id = await evaluate(`(()=>{
    const t = (typeof specialCategoryTree !== 'undefined' && specialCategoryTree) ? specialCategoryTree : [];
    const hit = t.find(c => /拾年|时间轴/.test(c.name || '')) || t.find(c => c.id === 'years');
    if (!hit) return '';
    if (typeof onSpecialOverviewItemClick === 'function') onSpecialOverviewItemClick(hit.id);
    return hit.id;
  })()`);
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`!!document.querySelector('.tl-heatmap') && !!document.getElementById('timelineYearFilter')`).catch(() => false);
    if (ready) return id;
    await sleep(300);
  }
  return id;
};
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#notes` });
for (let i = 0; i < 140; i++) {
  const r = await evaluate(`(()=>typeof onTabClick==='function' && document.readyState==='complete' && Object.keys(viewScrollContainers||{}).length>0)()`).catch(() => false);
  if (r) break;
  await sleep(120);
}
await sleep(700);
const sid = await openYears();
ok(!!sid, `② 进入币海拾年（${sid || '没找到'}）`);

// ─────────── ② 图形结构 ───────────
console.log('\n══════ ② 结构：年 × 月 ══════\n');
const shape = JSON.parse(await evaluate(`(()=>{
  const hm = document.querySelector('.tl-heatmap');
  if (!hm) return JSON.stringify(null);
  const rows = [...hm.querySelectorAll('.tl-heatmap-row')];
  return JSON.stringify({
    hasChart: true,
    headMonths: [...hm.querySelectorAll('.tl-heatmap-row.tl-hm-head .tl-heatmap-mlabel')].map(e => e.dataset.label),
    rows: rows.filter(r => !r.classList.contains('tl-hm-head')).map(r => ({
      year: (r.querySelector('.tl-heatmap-ylabel') || {}).dataset?.label || null,
      cells: [...r.querySelectorAll('.tl-heatmap-cell')].map(c => ({
        m: c.dataset.month, y: c.dataset.year,
        aria: c.getAttribute('aria-label'), tip: (c.querySelector('.tl-heatmap-tip') || {}).textContent?.trim() || null,
        lv: +(c.style.getPropertyValue('--hm-o') || 0),
        inline: c.querySelector('.tl-heatmap-tip') ? (c.querySelector('.tl-heatmap-tip').getAttribute('style') || '') : 'x'
      }))
    })),
    label: (hm.querySelector('.tl-heatmap-title') || {}).textContent?.trim() || null
  });
})()`));
ok(!!shape && shape.hasChart, '② 页面上有 .tl-heatmap');
ok(!!shape && shape.headMonths.length === 12 && shape.headMonths[0] === '1' && shape.headMonths[11] === '12', `② 表头 12 个月份列（${shape ? shape.headMonths.join(',') : '—'}）`);
ok(!!shape && shape.rows.length >= 1, `② 行数 = 有购买记录的年份数（${shape ? shape.rows.length : 0} 行）`);
ok(!!shape && shape.rows.every(r => r.cells.length === 12), '② 每行都是 12 个格子');
ok(!!shape && shape.rows.every(r => r.cells.every(c => !/(^|;)\s*(position|left|right|top|bottom|transform|width|height)\s*:/i.test(c.inline))), '② ★ 泡上没有内联的定位/尺寸属性（位置由 CSS 决定，JS 只在悬停时补 --hm-tx/--hm-arrow）');
const tipHasYM = !!shape && shape.rows.every(r => r.cells.every(c =>
  String(c.tip).includes(r.year) && new RegExp('(^|[^0-9])' + String(parseInt(c.m, 10)) + '\\s*月').test(String(c.tip))));
ok(tipHasYM, `② 每个 tooltip 都写清了年月（例如「${shape && shape.rows[0] ? shape.rows[0].cells[0].tip : '—'}」）`);

// 独立重算：完全按页面口径解析日期与价格，但代码是测试自己写的
const expectMatrix = JSON.parse(await evaluate(`(()=>{
  const px = (s) => { const v = parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, '')); return (isNaN(v) || v <= 0) ? 0 : v; };
  const pdate = (s) => {
    const t = String(s || '').trim();
    const d = new Date(t);
    if (!isNaN(d.getTime())) return d;
    const m = t.match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日?/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const cells = {}; const years = new Set(); let totalAmount = 0, totalCount = 0;
  for (const map of [window.DATA_MAP, window.COIN_DATA_MAP]) {
    if (!map) continue;
    for (const k of Object.keys(map)) {
      const d = map[k]; if (!d || !d.series) continue;
      const walk = (arr) => { for (const c of (arr || [])) {
        if (!c || !c.purchaseDate) continue;
        const dt = pdate(c.purchaseDate); if (!dt || isNaN(dt.getTime())) continue;
        const y = String(dt.getFullYear()), mo = String(dt.getMonth() + 1).padStart(2, '0');
        const key = y + '/' + mo;
        cells[key] = cells[key] || { n: 0, sum: 0 };
        cells[key].n++;
        const p = px(c.price); cells[key].sum += p;
        totalAmount += p; totalCount++; years.add(y);
      } };
      for (const s of d.series) { if (s.varieties) { for (const v of s.varieties) walk(v.copies); } else walk(s.copies); }
    }
  }
  return JSON.stringify({ cells, years: [...years].sort(), totalAmount: Math.round(totalAmount), totalCount });
})()`));
console.log(`      独立重算：${expectMatrix.years.length} 个年份（${expectMatrix.years.join(',')}）、${expectMatrix.totalCount} 件、${expectMatrix.totalAmount} 元`);

ok(!!shape && shape.rows.length === expectMatrix.years.length, `② 行数与该年份数一致（页面 ${shape ? shape.rows.length : '?'} vs 重算 ${expectMatrix.years.length}）`);
let cellBad = 0, cellChecked = 0, sumAll = 0;
for (const r of (shape?.rows || [])) {
  for (const c of r.cells) {
    const want = expectMatrix.cells[r.year + '/' + c.m] || { n: 0, sum: 0 };
    cellChecked++;
    sumAll += want.sum;
    const tip = String(c.tip || '');
    // 用户定的文案格式：x年x月，共购入x件，合计x元
    const wantText = `${r.year}年${Number(c.m)}月，共购入${want.n}件，合计${Math.round(want.sum)}元`;
    const exact = tip === wantText;
    const nOk = tip.includes(`共购入${want.n}件`);
    const sumOk = tip.includes(`合计${Math.round(want.sum)}元`);
    const ariaOk = !!c.aria && c.aria.includes(`共购入${want.n}件`) && c.aria.includes(`合计${Math.round(want.sum)}元`);
    if (!nOk || !sumOk || !ariaOk || !exact) {
      cellBad++;
      if (cellBad <= 5) console.log(`      ✗ ${r.year}/${c.m} 期望「${wantText}」，页面 tooltip「${tip}」aria「${c.aria}」`);
    }
  }
}
ok(cellChecked === 12 * (shape?.rows.length || 0), `② 逐个检查了 ${cellChecked} 个格子`);
ok(cellBad === 0, `② ★ ${cellChecked} 个格子的「件数 + 金额」全部与独立重算一致（不一致 ${cellBad} 个）`);
ok(Math.round(sumAll) === expectMatrix.totalAmount, `② 全部格子金额之和 = 独立重算总额（${Math.round(sumAll)} vs ${expectMatrix.totalAmount}）`);

const sloganSum = parseInt(((await evaluate(`(document.querySelector('.timeline-slogan')||{}).textContent||''`)).match(/共花了\s*(\d+)\s*元/) || [])[1], 10);
ok(sloganSum === expectMatrix.totalAmount, `② ★ 格子金额之和 == 标语总额（${sloganSum} 元），说明热力图的金额口径与列表完全一致`);

// 深浅：用户两轮都说"不灵敏"，最后要求**无限档、按比例丝滑变化**。所以这里不改公式、直接验算：
//   每个格子的 --hm-o 必须 = 0（金额 0）或 0.10 + 0.85 × 金额/最大金额
const lvInfo = JSON.parse(await evaluate(`(()=>{
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  const o = c => +(c.style.getPropertyValue('--hm-o') || 0);
  const am = c => { const t=(c.querySelector('.tl-heatmap-tip')||{}).textContent||''; const m=t.match(/合计([0-9]+)元/); return m?+m[1]:0; };
  const rows = cells.map(c => ({ am: am(c), o: o(c), fill: +(getComputedStyle(c.querySelector('.tl-hm-fill')).opacity) }));
  const maxAm = Math.max(...rows.map(r => r.am));
  const bad = [];
  for (const r of rows) {
    const want = r.am <= 0 ? 0 : 0.10 + 0.85 * Math.min(1, r.am / maxAm);
    if (Math.abs(r.o - want) > 0.002) bad.push(r.am + '元:' + r.o.toFixed(3) + '≠' + want.toFixed(3));
  }
  let mono = true;
  for (const a of rows) for (const b of rows) if (a.am > b.am && a.o < b.o - 1e-9) mono = false;
  const distinct = new Set(rows.filter(r => r.am > 0).map(r => r.o.toFixed(3))).size;
  const sorted = rows.slice().sort((x, y) => y.am - x.am);
  const big = sorted[0];
  const mid = rows.slice().sort((x, y) => Math.abs(x.am - 3000) - Math.abs(y.am - 3000))[0];
  return JSON.stringify({ n: rows.length, bad: bad.slice(0, 4), badN: bad.length, mono, maxAm, distinct,
    zeros: rows.filter(r => r.am <= 0).length,
    zeroO: rows.length ? Math.max(...rows.filter(r => r.am <= 0).map(r => r.o), 0) : 0,
    zeroFill: rows.length ? Math.max(...rows.filter(r => r.am <= 0).map(r => r.fill), 0) : 0,
    filled: rows.filter(r => r.fill > 0.02).length, nonZero: rows.filter(r => r.am > 0).length,
    mid, big, midGap: (mid && big) ? +(big.o - mid.o).toFixed(3) : 0 });
})()`));
ok(lvInfo.zeros === 0 || (lvInfo.zeroO === 0 && lvInfo.zeroFill < 0.005), `② "没有购买记录"的月份真的透明（${lvInfo.zeros} 个 0 元格子，--hm-o 最大 ${lvInfo.zeroO}、实际渲染不透明度最大 ${lvInfo.zeroFill.toFixed(3)}）`);
ok(lvInfo.mono, '② 深浅随金额单调不倒退');
ok(lvInfo.badN === 0, `② ★ 严格按比例、连续不分档：--hm-o = 0.10+0.85×金额/最大金额(${lvInfo.maxAm})，${lvInfo.n} 个格子全部对得上${lvInfo.badN ? '；不符：' + lvInfo.bad.join('，') : ''}`);
ok(lvInfo.distinct >= 8, `② ★ 是连续值而不是几档（有记录的格子里出现了 ${lvInfo.distinct} 个互不相同的透明度）`);
ok(lvInfo.filled === lvInfo.nonZero, `② 有金额的格子都真的画上了填充色（${lvInfo.filled}/${lvInfo.nonZero}）`);
ok(lvInfo.midGap >= 0.35, `② ★ 3000 元那格与最深一格差得开（${lvInfo.mid.am} 元 o=${lvInfo.mid.o.toFixed(3)} → ${lvInfo.big.am} 元 o=${lvInfo.big.o.toFixed(3)}，差 ${lvInfo.midGap}）`);

// 结构细节：年份升序、正方形、没有标题那句、左上角是"全部"
const geo = JSON.parse(await evaluate(`(()=>{
  const rows = [...document.querySelectorAll('.tl-heatmap-row')];
  const years = rows.filter(r => !r.classList.contains('tl-hm-head')).map(r => (r.querySelector('.tl-heatmap-ylabel')||{dataset:{}}).dataset.label);
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  const rs = cells.map(c => c.getBoundingClientRect());
  const hm = document.querySelector('.tl-heatmap').getBoundingClientRect();
  const corner = document.querySelector('.tl-hm-corner');
  return JSON.stringify({ years,
    w: Math.round(rs[0].width), h: Math.round(rs[0].height),
    square: rs.every(r => Math.abs(r.width - r.height) <= 1),
    title: !!document.querySelector('.tl-heatmap-title'),
    corner: corner ? { text: corner.dataset.label, click: corner.getAttribute('onclick') || '' } : null,
    centered: (() => { const cr = document.querySelector('.tl-heatmap-row').getBoundingClientRect();
      const mc = (typeof getRenderContainer === 'function' && getRenderContainer()) || document.body;
      const mr = mc.getBoundingClientRect();
      return Math.abs((cr.left - mr.left) - (mr.right - cr.right)) < 40; })() });
})()`));
ok(geo.years.every((y, i, a) => i === 0 || Number(a[i - 1]) < Number(y)), `② ★ 年份升序：老的在上、新的在下（${geo.years.join(' → ')}）`);
ok(geo.square, `② ★ 格子是正方形（实测 ${geo.w}×${geo.h}）`);
ok(geo.w >= 28, `② 格子比上一版大一点（${geo.w}px，上限 42px）`);
ok(!geo.title, '② ★ 没有"按月份统计（共 N 件…）"那句标题（用户要求去掉）');
ok(!!geo.corner && geo.corner.text === '全部' && /applyTimelineFilter/.test(geo.corner.click), `② ★ 左上角是"全部"，点了回到全部时间（onclick=${geo.corner && geo.corner.click}）`);
ok(geo.centered, '② 热力图整块在内容区里居中');

// ─────────── ③ 悬停：CSS tooltip 真的会显示 ───────────
console.log('\n══════ ③ 悬停显示件数与金额 ══════\n');
// 先挑一个真有钱的格子（金额最大）并滚到视野中间
const bestIdx = await evaluate(`(()=>{
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  if (!cells.length) return -1;
  let bi = 0, bv = -1;
  cells.forEach((c, i) => {
    const t = (c.querySelector('.tl-heatmap-tip') || {}).textContent || '';
    const m = t.match(/合计([0-9]+)元/); const v = m ? +m[1] : 0;
    if (v > bv) { bv = v; bi = i; }
  });
  cells[bi].scrollIntoView({ block: 'center' });
  return bi;
})()`);
// ★ 坐标必须在滚动稳定之后再量，否则鼠标会落到滚动前的位置上、hover 落空
let box = null;
if (bestIdx >= 0) {
  await sleep(450);
  box = JSON.parse(await evaluate(`(()=>{
    const c = document.querySelectorAll('.tl-heatmap-cell')[${bestIdx}];
    const r = c.getBoundingClientRect();
    const tip = c.querySelector('.tl-heatmap-tip');
    const cs = getComputedStyle(tip);
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, text: tip.textContent.trim(),
      vis: cs.visibility, op: +cs.opacity, inline: tip.getAttribute('style') });
  })()`));
}
// 悬停探针：一次把"是否显示 / 文案 / 是否越界 / 是否居中 / 尖角"都量出来。
// ★ 用户规则：泡**尽可能居中于它描述的东西**（格子=格子本身；年份/月份标签=文字本身，
//   因为年份数字靠右、月份数字居中，对着整块可点击区域的中心会显得箭头指着框），
//   只有会越出热力图左右边界时才往里挤 —— 这里就按这条判定。
const tipProbe = async (elExpr) => JSON.parse(await evaluate(`(()=>{
  const el = ${elExpr};
  const hm = document.querySelector('.tl-heatmap');
  if (!el || !hm) return JSON.stringify({ found: false });
  const tip = el.querySelector(':scope > .tl-heatmap-tip');
  if (!tip) return JSON.stringify({ found: false, why: '方块里没有泡' });
  const hr = hm.getBoundingClientRect(), br = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
  // ★ 左右按**屏幕可见区**（内容容器）判定，上下按**热力图**判定 —— 用户要求：窄屏时泡不要超出屏幕边界，
  //   但上下仍然不能跑出热力图（泡一律朝上弹，表头那行给它留了空间）。
  const mc = (typeof getRenderContainer === 'function' && getRenderContainer()) || document.documentElement;
  const cr = mc.getBoundingClientRect();
  const outX = Math.max(0, Math.round(cr.left - tr.left), Math.round(tr.right - cr.right));
  const outY = Math.max(0, Math.round(hr.top - tr.top), Math.round(tr.bottom - hr.bottom));
  const boxC = br.left + br.width / 2;
  const tn = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
  let anchorC = boxC, textL = null, textR = null;
  if (tn) { const rg = document.createRange(); rg.selectNodeContents(tn); const rr = rg.getBoundingClientRect();
    if (rr.width) { anchorC = rr.left + rr.width / 2; textL = rr.left; textR = rr.right; } }
  const naturalL = anchorC - tr.width / 2;
  return JSON.stringify({
    found: true,
    vis: +getComputedStyle(tip).opacity > 0.5,
    text: tip.textContent.trim(),
    out: Math.max(outX, outY), outX, outY,
    dc: Math.round((tr.left + tr.width / 2) - anchorC),
    anchorC: Math.round(anchorC),
    boxC: Math.round(boxC),
    fitsCentered: naturalL >= cr.left + 1.5 && naturalL + tr.width <= cr.right - 1.5,
    flushL: Math.abs(tr.left - cr.left) <= 2,
    flushR: Math.abs(tr.right - cr.right) <= 2,
    geo: '屏[' + Math.round(cr.left) + ',' + Math.round(cr.right) + '] 热力图[' + Math.round(hr.left) + ',' + Math.round(hr.right) + '] 泡[' + Math.round(tr.left) + ',' + Math.round(tr.right) + '] 上下越界' + outY + ' 宽' + Math.round(tr.width),
    tipL: Math.round(tr.left), tipR: Math.round(tr.right),
    textL: textL === null ? null : Math.round(textL), textR: textR === null ? null : Math.round(textR),
    tipCY: Math.round(tr.top + tr.height / 2), boxCY: Math.round(br.top + br.height / 2),
    arrowSide: (() => {
      const cs = getComputedStyle(tip, '::after');
      const bg = getComputedStyle(tip).backgroundColor;
      // 有色那条边 = 颜色和泡底色一致的那条（透明边在 Chrome 里可能报成 rgb(0,0,0)，不能只看 transparent）
      return ['Top', 'Right', 'Bottom', 'Left'].filter(s => cs['border' + s + 'Color'] === bg).join(',') || 'none';
    })(),
    styleAttr: tip.getAttribute('style') || ''
  });
})()`));
const cellExpr = (rowIdx, col) => `(document.querySelectorAll('.tl-heatmap-row:not(.tl-hm-head)')[${rowIdx}]||{querySelectorAll:()=>[]}).querySelectorAll('.tl-heatmap-cell')[${col}]`;
const hoverAt = async (elExpr) => {
  const box = JSON.parse(await evaluate(`(()=>{ const el=${elExpr}; if(!el) return JSON.stringify(null);
    const r=el.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}); })()`));
  if (!box) return false;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0 });
  await sleep(420);                                 // 悬停后的过渡要过完再量，否则量到的是动画中间态
  return true;
};

if (!box) {
  ok(false, '③ 页面上一个格子都没有，悬停部分无法验证');
} else {
ok(box.op === 0 || box.vis === 'hidden', `③ 没悬停时 tooltip 藏起来（visibility=${box.vis} opacity=${box.op}）`);
const beforeHover = JSON.parse(await evaluate(`(()=>{ const t=[...document.querySelectorAll('.tl-heatmap-tip')].find(x=>x.textContent.trim()===${JSON.stringify(box.text)}); const cs=getComputedStyle(t); return JSON.stringify({vis:cs.visibility,op:+cs.opacity}); })()`));
// 真实鼠标移动（CDP 输入管线，不是合成事件）
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x), y: Math.round(box.y), buttons: 0 });
await sleep(320);
const hoverState = JSON.parse(await evaluate(`(()=>{
  const t=[...document.querySelectorAll('.tl-heatmap-tip')].find(x=>x.textContent.trim()===${JSON.stringify(box.text)});
  const cs=getComputedStyle(t);
  const r=t.getBoundingClientRect();
  return JSON.stringify({vis:cs.visibility,op:+cs.opacity,bg:cs.backgroundColor,color:cs.color,w:Math.round(r.width),h:Math.round(r.height),left:Math.round(r.left),right:Math.round(r.right)});
})()`));
ok(hoverState.vis === 'visible' && hoverState.op > 0.9, `③ ★ 悬停后 tooltip 显示了（visibility=${hoverState.vis} opacity=${hoverState.op}，之前 ${beforeHover.vis}/${beforeHover.op}）`);
ok(hoverState.w > 40 && hoverState.h > 10, `③ tooltip 真的渲染出尺寸了（${hoverState.w}×${hoverState.h}px）`);
ok(/共购入[0-9]+件，合计[0-9]+元/.test(box.text), `③ tooltip 文案是「x年x月，共购入x件，合计x元」：「${box.text}」`);
ok(!/transparent|rgba\(0, 0, 0, 0\)/.test(hoverState.bg), `③ tooltip 有底色（${hoverState.bg}）`);
// tooltip 不该跑出内容区左/右边界太多
await evaluate(`(()=>{ const mc=(typeof getRenderContainer==='function'&&getRenderContainer())||document.body; const r=mc.getBoundingClientRect(); window.__hmBox={ l:r.left, r:r.right }; return 1; })()`);
const bounds = JSON.parse(await evaluate(`JSON.stringify(window.__hmBox)`));
ok(hoverState.left >= bounds.l - 2 && hoverState.right <= bounds.r + 2, `③ tooltip 没有横向跑出内容区（${hoverState.left}~${hoverState.right} vs 内容区 ${Math.round(bounds.l)}~${Math.round(bounds.r)}）`);
// 鼠标移开后要收起来
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
await sleep(320);
const afterLeave = JSON.parse(await evaluate(`(()=>{
  const t=[...document.querySelectorAll('.tl-heatmap-tip')].find(x=>x.textContent.trim()===${JSON.stringify(box.text)});
  const cs=getComputedStyle(t); return JSON.stringify({vis:cs.visibility,op:+cs.opacity});
})()`));
ok(afterLeave.vis === 'hidden' || afterLeave.op < 0.1, `③ 鼠标移开后自动收起（visibility=${afterLeave.vis} opacity=${afterLeave.op}）`);

// ★ 用户要求（两条）：泡左右上下都不许越出热力图；并且**能居中就居中**，只有放不下才贴边。
//   泡的宽度随文案变、格子随视口变，所以逐列真悬停实测（既是最容易出问题的，也是最容易被写死的）。
await evaluate(`(()=>{ const hm=document.querySelector('.tl-heatmap'); if (hm && hm.scrollIntoView) hm.scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(450);
const sweep = [];
for (let c = 0; c < 12; c++) sweep.push([0, c]);   // 最早那一年
for (let c = 0; c < 12; c++) sweep.push([1, c]);   // 最新那一年
let outCnt = 0, centBad = 0, inlineBad = 0, outMsg = [], centMsg = [];
for (const [rowIdx, col] of sweep) {
  if (!await hoverAt(cellExpr(rowIdx, col))) continue;
  const p = await tipProbe(cellExpr(rowIdx, col));
  if (!p.found || !p.vis) { outCnt++; outMsg.push(`行${rowIdx}列${col}: 悬停没显示`); continue; }
  if (p.outX > 1 || p.outY > 1) { outCnt++; outMsg.push(`行${rowIdx}列${col}「${p.text}」越界（左右屏幕 ${p.outX} / 上下热力图 ${p.outY}）`); }
  const centeredOk = p.fitsCentered ? Math.abs(p.dc) <= 2 : (p.flushL || p.flushR);
  if (!centeredOk) { centBad++; centMsg.push(`行${rowIdx}列${col} 居中差 ${p.dc}px（放得下=${p.fitsCentered} 贴左=${p.flushL} 贴右=${p.flushR}）`); }
  if (/left|right|top|bottom|position|transform|width/i.test(p.styleAttr.replace(/--hm-tx|--hm-arrow/g, ''))) inlineBad++;
}
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
await sleep(200);
ok(outCnt === 0, `③ ★ 泡左右不越出屏幕、上下不越出热力图（扫了 ${sweep.length} 个格子${outCnt ? '；越界：' + outMsg.join('；') : ''}）`);
ok(centBad === 0, `③ ★ 能居中就居中、只有放不下才贴边（扫了 ${sweep.length} 个格子${centBad ? '；不合规：' + centMsg.join('；') : ''}）`);
ok(inlineBad === 0, '③ 泡上只多了 --hm-tx / --hm-arrow 两个自定义属性，没有内联的定位/尺寸属性');

// 标签（"全部" / 年份 / 月份）也有自己的泡，而且要求"不越界 + 能居中就居中 + 有尖角 + 带件数金额"
// 标签泡里的件数/金额要和它管的那些格子加起来一致。
// ★ 用**独立重算的精确值**（expectMatrix），不要拿页面上取整后的每格金额再相加 ——
//   24 个格子各自四舍五入之后再求和，会和"先求和再四舍五入"差 1 元（上一版就栽在这上面）。
const sumCells = (pick) => {
  let n = 0, sum = 0;
  for (const k of Object.keys(expectMatrix.cells)) {
    const [yy, mm] = k.split('/').map(Number);
    if (!pick(yy, mm)) continue;
    n += expectMatrix.cells[k].n; sum += expectMatrix.cells[k].sum;
  }
  return { n, sum: Math.round(sum) };
};
const year0 = expectMatrix.years.map(Number).sort((a, b) => a - b)[0];
const expectLabel = {
  all: { n: expectMatrix.totalCount, sum: expectMatrix.totalAmount },
  year0: sumCells(yy => yy === year0),
  year0Label: String(year0),
  m7: sumCells((yy, mm) => mm === 7)
};
await evaluate(`(()=>{ const hm=document.querySelector('.tl-heatmap'); if (hm && hm.scrollIntoView) hm.scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(350);
const labelCases = [
  ['左上角"全部"', `document.querySelector('.tl-hm-corner')`, /^全部时间，共购入(\d+)件，合计(\d+)元$/, () => expectLabel.all],
  ['年份标签', `[...document.querySelectorAll('.tl-heatmap-ylabel')].find(e => !e.classList.contains('tl-hm-corner'))`, /^\d{4}年，共购入(\d+)件，合计(\d+)元$/, () => expectLabel.year0],
  ['月份表头', `document.querySelectorAll('.tl-heatmap-mlabel')[6]`, /^历年7月，共购入(\d+)件，合计(\d+)元$/, () => expectLabel.m7]
];
let labBad = 0, labMsg = [];
for (const [name, expr, want, expectFn] of labelCases) {
  if (!await hoverAt(expr)) { labBad++; labMsg.push(`${name}: 悬停失败`); continue; }
  const p = await tipProbe(expr);
  const m = (p.text || '').match(want);
  const exp = expectFn();
  ok(!!m, `③ ★ ${name}有自己的悬浮泡（显示「${p.text}」）`);
  ok(!!m && +m[1] === exp.n && +m[2] === exp.sum,
    `③ ★ ${name}的泡里带了件数与金额，且与它管的格子合计一致（泡 ${m ? m[1] + ' 件/' + m[2] + ' 元' : '—'} vs 格子合计 ${exp.n} 件/${exp.sum} 元）`);
  // 年份标签是特例（用户要求）：泡整个挪到年份右边、尖角长在泡的**左侧竖边**上，
  // 所以它不做"居中于热力图内"的判定，只查不越出**内容容器**（下面单独断言）。
  const isYear = name === '年份标签';
  const posOk = !!p.found && (isYear || (p.out <= 1 && (p.fitsCentered ? Math.abs(p.dc) <= 2 : (p.flushL || p.flushR))));
  const arrowOk = !!p.found && p.arrowSide !== 'none';
  if (!posOk) { labBad++; labMsg.push(`${name}「${p.text}」越界 ${p.out}px / 居中差 ${p.dc}px（放得下=${p.fitsCentered}）`); }
  if (!arrowOk) { labBad++; labMsg.push(`${name} 没有尖角`); }
}
ok(labBad === 0, `③ ★ 标签的泡都满足"不越界 + 该居中的居中 + 有尖角"${labBad ? '；问题：' + labMsg.join('；') : ''}`);

// 年份标签：泡整个在年份数字**右边**，尖角长在泡的左侧竖边（横着指回年份）—— 用户指定
const yearExpr = `[...document.querySelectorAll('.tl-heatmap-ylabel')].find(e => !e.classList.contains('tl-hm-corner'))`;
await hoverAt(yearExpr);
const yearTip = await tipProbe(yearExpr);
ok(yearTip.found && yearTip.vis && yearTip.tipL >= yearTip.textR,
  `③ ★ 年份的泡整个在数字右边（泡左 ${yearTip.tipL} ≥ 数字右 ${yearTip.textR}）`);
ok(yearTip.arrowSide === 'Right',
  `③ ★ 年份的尖角长在泡的左侧竖边上、朝左指（有色的那条边：${yearTip.arrowSide}）`);
ok(Math.abs(yearTip.tipCY - yearTip.boxCY) <= 3,
  `③ ★ 泡与年份在竖直方向居中（泡中心 ${yearTip.tipCY} vs 行中心 ${yearTip.boxCY}）`);
const yearInPage = JSON.parse(await evaluate(`(()=>{
  const mc = (typeof getRenderContainer === 'function' && getRenderContainer()) || document.body;
  const el = ${yearExpr};
  const tip = el.querySelector(':scope > .tl-heatmap-tip');
  const r = tip.getBoundingClientRect(), c = mc.getBoundingClientRect();
  return JSON.stringify({ over: Math.max(0, Math.round(c.left - r.left), Math.round(r.right - c.right)), mcL: Math.round(c.left), mcR: Math.round(c.right), tipR: Math.round(r.right) });
})()`));
ok(yearInPage.over <= 1,
  `③ ★ 年份的泡没越出内容容器（泡右 ${yearInPage.tipR} vs 容器右 ${yearInPage.mcR}）`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
await sleep(200);
ok((await evaluate(`[...document.querySelectorAll('.tl-heatmap [title]')].length`)) === 0, '③ 标签上没有原生 title（只用自写悬浮泡）');
}

// ─────────── ④ 点格子 = 按这个格子筛选 ───────────
console.log('\n══════ ④ 点格子筛选 ══════\n');
const clicked = JSON.parse(await evaluate(`(()=>{
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  const c = cells.find(x => { const t=(x.querySelector('.tl-heatmap-tip')||{}).textContent||''; return /共购入[1-9][0-9]*件/.test(t); });
  if (!c) return JSON.stringify(null);
  const y = c.dataset.year, m = c.dataset.month, tip = c.querySelector('.tl-heatmap-tip').textContent.trim();
  c.click();
  return JSON.stringify({ y, m, tip });
})()`));
await sleep(900);
const afterClick = JSON.parse(await evaluate(`(()=>{
  const ys=document.getElementById('timelineYearFilter'), ms=document.getElementById('timelineMonthFilter');
  const app=getRenderContainer();
  return JSON.stringify({ year: ys?ys.value:null, month: ms?ms.value:null, scrollTop: app?Math.round(app.scrollTop):-1,
    slogan: (document.querySelector('.timeline-slogan')||{}).textContent||'', heatmapStill: !!document.querySelector('.tl-heatmap'),
    count: (document.querySelector('.timeline-top-count')||{}).textContent||'' });
})()`));
ok(!!clicked, `④ 找到了有购买记录的格子（${clicked ? clicked.y + '/' + clicked.m : '—'}）`);
if (clicked) {
  ok(afterClick.year === clicked.y && afterClick.month === clicked.m, `④ ★ 点格子后下拉框变成 ${clicked.y} 年 ${clicked.m} 月（实际 ${afterClick.year}/${afterClick.month}）`);
  const want = expectMatrix.cells[clicked.y + '/' + clicked.m];
  const got = parseInt((afterClick.slogan.match(/共花了\s*(\d+)\s*元/) || [])[1], 10);
  ok(got === Math.round(want.sum), `④ 筛选后的标语金额 = 该格子金额（页面 ${got} vs 重算 ${Math.round(want.sum)}）`);
  ok(new RegExp(`共${want.n}件`).test(afterClick.count), `④ 顶部件数也跟着变成该格子的 ${want.n} 件（${afterClick.count}）`);
  ok(afterClick.scrollTop === 0, `④ 点格子后回到顶部（${afterClick.scrollTop}）`);
  ok(afterClick.heatmapStill, '④ 筛选之后热力图还在（不会因为筛选而消失）');
  // 复原
  await evaluate(`(()=>{ const ys=document.getElementById('timelineYearFilter'); if(ys){ys.value='全部'; ys.dispatchEvent(new Event('change'));}
    const ms=document.getElementById('timelineMonthFilter'); if(ms){ms.value='全部'; ms.dispatchEvent(new Event('change'));} return 1; })()`);
  await sleep(800);
}

// ─────────── ⑤ 深色主题 + 手机宽度 ───────────
console.log('\n══════ ⑤ 深色主题与手机宽度 ══════\n');
// ★ 主题必须走站内自己的接口：theme.js 把整套调色板（--bg/--text/--bg-light…）以
//   **内联样式**写在 <html> 上，直接改 data-color-scheme 属性是切不动的（踩过）。
//   无头 Chrome 的主题跟随系统，也不能假设默认就是浅色。
const lum = (c) => { const m = String(c).match(/[\d.]+/g) || []; return (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]); };
const setMode = async (m) => {
  const used = await evaluate(`(()=>{ if (typeof setColorSchemeMode==='function') { setColorSchemeMode(${JSON.stringify(m)}); return 1; } return 0; })()`);
  ok(used === 1, `⑤ 用站内的 setColorSchemeMode(${m}) 切主题（可用=${used}）`);
  await sleep(350);
};
const readTheme = async () => JSON.parse(await evaluate(`(()=>{
  const tip=document.querySelector('.tl-heatmap-tip'); const ct=getComputedStyle(tip);
  const cell=document.querySelector('.tl-heatmap-cell'); const cc=getComputedStyle(cell);
  const fill=document.querySelector('.tl-heatmap-cell .tl-hm-fill'); const cf=fill?getComputedStyle(fill):null;
  const ops=[...document.querySelectorAll('.tl-heatmap-cell')].map(c=>{ const f=c.querySelector('.tl-hm-fill'); return f?+getComputedStyle(f).opacity:null; }).filter(v=>v!==null);
  return JSON.stringify({
    scheme: document.documentElement.getAttribute('data-color-scheme'),
    tipBg: ct.backgroundColor, tipColor: ct.color, cellBg: cc.backgroundColor,
    fillBg: cf?cf.backgroundColor:null,
    theme: getComputedStyle(document.documentElement).getPropertyValue('--theme').trim(),
    maxOp: ops.length?Math.max(...ops):null, minOp: ops.length?Math.min(...ops):null
  });
})()`));
await setMode('light');
const lightT = await readTheme();
ok(lightT.scheme === 'light', `⑤ 切到浅色成功（data-color-scheme=${lightT.scheme}）`);
ok(!!lightT.fillBg && !/rgba\(0, 0, 0, 0\)/.test(lightT.fillBg), `⑤ 格子有填充色 ${lightT.fillBg}（取 var(--theme)=${lightT.theme || '空'}，所以会自动跟随用户选的 app 主题色）`);
ok(lightT.maxOp > lightT.minOp, `⑤ 连续深浅确实体现在透明度上（最深 ${lightT.maxOp} > 最浅 ${lightT.minOp}）`);
await setMode('dark');
const darkT = await readTheme();
ok(darkT.scheme === 'dark', `⑤ 切到深色成功（data-color-scheme=${darkT.scheme}）`);
ok(darkT.tipBg !== lightT.tipBg || darkT.tipColor !== lightT.tipColor, `⑤ tooltip 配色跟着主题变（浅 ${lightT.tipBg}/${lightT.tipColor} → 深 ${darkT.tipBg}/${darkT.tipColor}）`);
ok(Math.abs(lum(darkT.tipBg) - lum(darkT.tipColor)) > 60, `⑤ 深色下 tooltip 底色与文字对比够（${Math.round(Math.abs(lum(darkT.tipBg) - lum(darkT.tipColor)))}）`);
ok(darkT.maxOp > lightT.maxOp, `⑤ 深色下分级整体提一档（最深 ${lightT.maxOp} → ${darkT.maxOp}）`);
await setMode('light');

await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 720, deviceScaleFactor: 2, mobile: true });
await sleep(600);
const mob = JSON.parse(await evaluate(`(()=>{
  const hm=document.querySelector('.tl-heatmap');
  const mc=(typeof getRenderContainer==='function'&&getRenderContainer())||document.body;
  return JSON.stringify({
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    hmRight: hm ? Math.round(hm.getBoundingClientRect().right) : -1,
    hmLeft: hm ? Math.round(hm.getBoundingClientRect().left) : -1,
    mcRight: Math.round(mc.getBoundingClientRect().right),
    cellW: hm ? Math.round(hm.querySelector('.tl-heatmap-cell').getBoundingClientRect().width) : -1,
    tipW: hm ? Math.round(hm.querySelector('.tl-heatmap-tip').getBoundingClientRect().width) : -1
  });
})()`));
ok(mob.docOverflow <= 1, `⑤ 手机宽度（375px）下页面不横向溢出（scrollWidth - innerWidth = ${mob.docOverflow}）`);
ok(mob.hmRight <= mob.mcRight + 1, `⑤ 热力图没超出内容区（右边缘 ${mob.hmRight} vs 内容区 ${mob.mcRight}）`);
ok(mob.cellW >= 10, `⑤ 手机宽度下格子仍有 ${mob.cellW}px 宽（不是挤成 0）`);
// 手机窄屏下泡更容易越界 —— 375px 下把首行整行 12 个格子扫一遍
await evaluate(`(()=>{ const hm=document.querySelector('.tl-heatmap'); if (hm && hm.scrollIntoView) hm.scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(450);
let mOut = 0, mCent = 0, mMsg = [];
for (let col = 0; col < 12; col++) {
  if (!await hoverAt(cellExpr(0, col))) continue;
  const p = await tipProbe(cellExpr(0, col));
  if (!p.found || !p.vis) { mOut++; mMsg.push(`列${col}: 悬停没显示`); continue; }
  if (p.out > 1) { mOut++; mMsg.push(`列${col}「${p.text}」越界 ${p.out}px（${p.geo}）`); }
  const centeredOk = p.fitsCentered ? Math.abs(p.dc) <= 2 : (p.flushL || p.flushR);
  if (!centeredOk) { mCent++; mMsg.push(`列${col} 居中差 ${p.dc}px（放得下=${p.fitsCentered} 靶心=${p.anchorC} 方块中心=${p.boxC} ${p.geo}）`); }
}
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
await sleep(200);
ok(mOut === 0, `⑤ ★ 手机宽度下泡也没越出屏幕边界、上下仍在热力图内（扫了首行 12 个格子）${mMsg.filter(m => /越界|没显示/.test(m)).join('；')}`);
ok(mCent === 0, `⑤ ★ 手机宽度下同样"能居中就居中、放不下才贴边"${mCent ? '；' + mMsg.join('；') : ''}`);

// 再窄一档 320px：用户要求"窄屏不换行，只整体缩小"
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 2, mobile: true });
await sleep(700);
const narrow = JSON.parse(await evaluate(`(()=>{
  const hm = document.querySelector('.tl-heatmap');
  const rows = [...document.querySelectorAll('.tl-heatmap-row')];
  const dataRows = rows.filter(r => r.querySelector('.tl-heatmap-cell'));
  const cell = hm.querySelector('.tl-heatmap-cell');
  const ylab = hm.querySelector('.tl-heatmap-ylabel');
  const mlab = hm.querySelector('.tl-heatmap-mlabel');
  // 折行检测：只看元素里第一个文字节点被排成了几行（悬浮泡是绝对定位的，不能算进来）
  const lines = el => { const t = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (!t) return 0; const r = document.createRange(); r.selectNodeContents(t); return r.getClientRects().length; };
  return JSON.stringify({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    hmW: Math.round(hm.getBoundingClientRect().width),
    cellsPerRow: dataRows.map(r => r.querySelectorAll('.tl-heatmap-cell').length),
    rowH: dataRows.map(r => Math.round(r.getBoundingClientRect().height)),
    cellH: Math.round(cell.getBoundingClientRect().height),
    cellW: Math.round(cell.getBoundingClientRect().width),
    ylabLines: lines(ylab), mlabLines: lines(mlab),
    ylabFont: parseFloat(getComputedStyle(ylab).fontSize), mlabFont: parseFloat(getComputedStyle(mlab).fontSize)
  });
})()`));
ok(narrow.overflow <= 1, `⑤ ★ 320px 下页面不横向溢出（scrollWidth - innerWidth = ${narrow.overflow}）`);
ok(narrow.cellsPerRow.every(n => n === 12), `⑤ ★ 窄屏也不换行：每一行仍是 12 个格子（实测 ${narrow.cellsPerRow.join(',')}）`);
ok(narrow.rowH.every(h => Math.abs(h - narrow.cellH) <= 2), `⑤ ★ 每行只有一格高，格子没被挤到第二行（行高 ${narrow.rowH.join(',')} vs 格子 ${narrow.cellH}）`);
ok(narrow.ylabLines === 1 && narrow.mlabLines === 1, `⑤ ★ 年份/月份文字不折行（${narrow.ylabLines} 行 / ${narrow.mlabLines} 行）`);
ok(narrow.cellW >= 14 && Math.abs(narrow.cellW - narrow.cellH) <= 1, `⑤ 320px 下格子整体缩小且仍是正方形（${narrow.cellW}×${narrow.cellH}）`);
ok(narrow.ylabFont >= 11 && narrow.mlabFont >= 11, `⑤ 标签字号够大（年份 ${narrow.ylabFont}px / 月份 ${narrow.mlabFont}px）`);
await send('Emulation.clearDeviceMetricsOverride');
await sleep(400);

// ─────────── ⑥ 动画范围：换年月只让下面的时间轴动 ───────────
console.log('\n══════ ⑥ 动画范围 ══════\n');
// 包一层 triggerViewAnimation 计数：换筛选时它不能被调用，
// 否则挂在整页容器上的淡入会让标题、热力图、顶部工具条跟着重播一次（用户明确不要）。
await evaluate(`(()=>{
  if (!window.__vaOrig && typeof triggerViewAnimation === 'function') {
    window.__vaOrig = triggerViewAnimation; window.__vaCount = 0;
    window.triggerViewAnimation = function () { window.__vaCount++; return window.__vaOrig.apply(this, arguments); };
  }
  return 1;
})()`);
// 退回专题概览再重新进入：这一趟"进入"应该走整页动画
await evaluate(`(()=>{ if (typeof backFromTimelineInner === 'function') backFromTimelineInner(); else if (typeof backFromTimeline === 'function') backFromTimeline(); return 1; })()`);
await sleep(800);
const reentered = await evaluate(`(()=>{
  const tree = (typeof specialCategoryTree !== 'undefined' && specialCategoryTree) || [];
  const hit = tree.find(c => /拾年|时间轴/.test((c.name || '') + (c.id || '')));
  if (!hit) return 0;
  if (typeof onSpecialOverviewItemClick === 'function') onSpecialOverviewItemClick(hit.id);
  return 1;
})()`);
for (let i = 0; i < 40; i++) {
  const has = await evaluate(`!!document.querySelector('.tl-heatmap')`).catch(() => false);
  if (has) break;
  await sleep(300);
}
await sleep(800);
const enterInfo = JSON.parse(await evaluate(`(()=>{ const app=getRenderContainer(); return JSON.stringify({
  va: window.__vaCount || 0,
  containerAnim: !!(app && app.classList.contains('content-enter')),
  heatmap: !!document.querySelector('.tl-heatmap') }); })()`));
ok(reentered === 1 && enterInfo.heatmap, '⑥ 退回专题概览后重新进入币海拾年');
ok(enterInfo.va >= 1, `⑥ 进入专题走整页进入动画（triggerViewAnimation 调用 ${enterInfo.va} 次）`);
ok(enterInfo.containerAnim, '⑥ 进入时动画挂在整页容器上（标题、热力图跟着一起淡入 —— 这是用户要的"只在进入专题时才有"）');
// 换一次年月：应该只让 .timeline-body 动
await evaluate(`(()=>{ window.__vaCount = 0; return 1; })()`);
const clicked2 = await evaluate(`(()=>{
  const c = [...document.querySelectorAll('.tl-heatmap-cell')].find(x => /共购入[1-9][0-9]*件/.test((x.querySelector('.tl-heatmap-tip')||{}).textContent||''));
  if (!c) return 'no'; c.click(); return 'ok';
})()`);
await sleep(1000);
const filterInfo = JSON.parse(await evaluate(`(()=>{ const app=getRenderContainer(); return JSON.stringify({
  va: window.__vaCount || 0,
  bodyAnim: !!(app && app.querySelector('.timeline-body.content-enter')),
  heatmap: !!document.querySelector('.tl-heatmap'), header: !!document.querySelector('.timeline-header') }); })()`));
ok(clicked2 === 'ok', '⑥ 又点了一个格子（换筛选）');
ok(filterInfo.va === 0, `⑥ ★ 换筛选没有再触发整页动画（triggerViewAnimation 调用 ${filterInfo.va} 次）`);
ok(filterInfo.bodyAnim, '⑥ ★ 换筛选时只有 .timeline-body 淡入一次');
ok(filterInfo.heatmap && filterInfo.header, '⑥ 标题与热力图仍在（只是不再重播动画）');
// 收尾：回到全部时间
await evaluate(`(()=>{ if (typeof applyTimelineFilter === 'function') applyTimelineFilter('全部','全部'); return 1; })()`);
await sleep(900);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch {}
child.kill();
server.close();
process.exitCode = fail ? 1 : 0;
