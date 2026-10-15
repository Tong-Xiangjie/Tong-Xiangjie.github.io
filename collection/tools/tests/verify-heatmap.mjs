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
  let ownAmount = 0, feeSum = 0, rawAmount = 0;   // ownAmount = Σ裸币价；feeSum = 评级费支出；rawAmount = Σ录入价
  // ★ 藏品侧的 copyId 全集：台账判"已售出"的依据就是"cert 匹配不到 copyId"。
  const copyIds = new Set();
  for (const map of [window.DATA_MAP, window.COIN_DATA_MAP]) {
    if (!map) continue;
    for (const k of Object.keys(map)) {
      const d = map[k]; if (!d || !d.series) continue;
      const scan = (arr) => { for (const c of (arr || [])) if (c && c.copyId) copyIds.add(String(c.copyId)); };
      for (const s of d.series) { if (s.varieties) { for (const v of s.varieties) scan(v.copies); } else scan(s.copies); }
    }
  }
  // ★★ 认证码 → 该枚要减掉的评级费（**裸币价口径**，用户裁定 2026-10）：
  //   录入价含评级费 ⇒ 自己送评且**非换壳**的那一枚显示/统计都减掉它。
  //   换壳行（reholder）不减（当作原始价格），也不计入评级费。
  //   同一 cert 出现两次时取**第一次**，与页面 gradingFeeIndex() 一致。
  const feeOfCert = {};
  const fee = window.DATA_MAP && window.DATA_MAP['gradingFeeData'];
  if (fee && Array.isArray(fee.batches)) {
    for (const b of fee.batches) {
      for (const it of (b.items || [])) {
        if (!it || !it.cert || feeOfCert[it.cert] !== undefined) continue;
        if (!copyIds.has(String(it.cert))) continue;          // 已售出 ⇒ 不参与
        feeOfCert[it.cert] = it.reholder ? 0 : px(it.paidFee); // 换壳 ⇒ 不减费
      }
    }
  }
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
        const raw = px(c.price);
        const fri = (c.copyId && feeOfCert[c.copyId] != null) ? feeOfCert[c.copyId] : 0;
        const p = (raw > 0 && raw - fri >= 0) ? raw - fri : raw;   // 裸币价
        cells[key].sum += p;
        totalAmount += p; ownAmount += p; rawAmount += raw; totalCount++; years.add(y);
      } };
      for (const s of d.series) { if (s.varieties) { for (const v of s.varieties) walk(v.copies); } else walk(s.copies); }
    }
  }
  // ★ 评级费台账也要算进来：时间轴上多了 5 条评级费条目（special.js 的
  //   gradingFeeEntries()，按**付款日期** paidDate 落位），它们同样进热力图的格子、
  //   年份标签与"全部"泡。★ 一条"评级费"= 该批**匹配得上 copyId 且非换壳**的行之和
  //   （匹配不上 = 已售出；换壳 = 不计入评级费），所以这里每批只记 **1 件**。
  //   漏掉这一段会让 5 个格子的件数/金额全部偏小，并连带把三个标签泡泡一起带红。
  if (fee && Array.isArray(fee.batches)) {
    for (const b of fee.batches) {
      const dt = pdate(b.paidDate); if (!dt || isNaN(dt.getTime())) continue;
      const live = (b.items || []).filter(it => it && copyIds.has(String(it.cert)) && !it.reholder);
      let amt = 0;
      for (const it of live) amt += px(it.paidFee);
      amt = Math.round(amt * 10) / 10;
      if (amt <= 0) continue;   // 整批已售出 ⇒ 不出现在时间轴上
      const y = String(dt.getFullYear()), mo = String(dt.getMonth() + 1).padStart(2, '0');
      const key = y + '/' + mo;
      cells[key] = cells[key] || { n: 0, sum: 0 };
      cells[key].n++;
      const p = amt; cells[key].sum += p;
      totalAmount += p; feeSum += p; totalCount++; years.add(y);
    }
  }
  return JSON.stringify({ cells, years: [...years].sort(), totalAmount: Math.round(totalAmount), totalCount, ownAmount: Math.round(ownAmount), feeSum: Math.round(feeSum), rawAmount: Math.round(rawAmount) });
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
ok(Math.round(sumAll) === expectMatrix.totalAmount, `② 全部格子金额之和 = 独立重算总额（${Math.round(sumAll)} vs ${expectMatrix.totalAmount}）`);
// ★★ 口径（用户裁定 2026-10，最终版）：**总花费 = Σ裸币价 + 评级费支出**，
//   数学上恒等于 **Σ 藏品 price**（录入价 = 裸币价 + 该枚评级费）。既不重复也不遗漏。
//   热力图与标语都必须落在同一个数上（热力图把两者都画进格子里）。
ok(sloganSum === expectMatrix.totalAmount,
  `② ★ 标语"共花了" == 热力图总额 == Σ裸币价 + 评级费支出（${sloganSum} vs ${expectMatrix.totalAmount}）`);
ok(expectMatrix.totalAmount === expectMatrix.ownAmount + expectMatrix.feeSum,
  `② ★ 总额 == Σ裸露价 ${expectMatrix.ownAmount} + 评级费支出 ${expectMatrix.feeSum} = ${expectMatrix.ownAmount + expectMatrix.feeSum}`);
ok(expectMatrix.ownAmount === expectMatrix.rawAmount - expectMatrix.feeSum,
  `② ★ Σ裸币价 == Σ录入价 − 评级费支出（${expectMatrix.ownAmount} == ${expectMatrix.rawAmount} − ${expectMatrix.feeSum}）`);

// 深浅：颜色**只有 --theme 一种**，深浅全由 opacity 表达；
//   每个格子的 --hm-o 必须 = 0（金额 0）或 lerp(0.06, 0.95, 金额/最大金额)
const lvInfo = JSON.parse(await evaluate(`(()=>{
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  const o = c => +(c.style.getPropertyValue('--hm-o') || 0);
  const am = c => { const t=(c.querySelector('.tl-heatmap-tip')||{}).textContent||''; const m=t.match(/合计([0-9]+)元/); return m?+m[1]:0; };
  const rows = cells.map(c => {
    const f = c.querySelector('.tl-hm-fill');
    const cs = getComputedStyle(f);
    return { am: am(c), o: o(c), fill: +cs.opacity, bg: cs.backgroundColor || '' };
  });
  const maxAm = Math.max(...rows.map(r => r.am));
  const bad = [];
  for (const r of rows) {
    const want = r.am <= 0 ? 0 : 0.06 + 0.89 * Math.min(1, r.am / maxAm);
    if (Math.abs(r.o - want) > 0.002) bad.push(r.am + '元:' + r.o.toFixed(3) + '≠' + want.toFixed(3));
  }
  let mono = true;
  for (const a of rows) for (const b of rows) if (a.am > b.am && a.o < b.o - 1e-9) mono = false;
  // ★ "没买就不画色块"：判据是**这一格不可见**（opacity 为 0）
  //   注意 fill 的 background 在 CSS 里固定是 var(--theme)，所以背景色本身永远是主题蓝；
  //   色块的显隐完全由 opacity（--hm-o）说了算，不能拿背景色判断。
  const zeroCells = rows.filter(r => r.am <= 0);
  const zeroOpaque = zeroCells.filter(r => r.o > 0 || r.fill > 0.005).length;
  const visible = rows.filter(r => r.am > 0);
  const alphas = [...new Set(visible.map(r => +r.o.toFixed(3)))];
  const sorted = rows.slice().sort((x, y) => y.am - x.am);
  const big = sorted[0];
  const mid = rows.slice().sort((x, y) => Math.abs(x.am - 3000) - Math.abs(y.am - 3000))[0];
  return JSON.stringify({ n: rows.length, bad: bad.slice(0, 4), badN: bad.length, mono, maxAm,
    distinct: alphas.length, alphas: alphas.sort((a, b) => a - b),
    zeros: zeroCells.length, zeroOpaque,
    mid, big, midGap: (mid && big) ? +(big.o - mid.o).toFixed(3) : 0 });
})()`));
ok(lvInfo.zeros === 0 || lvInfo.zeroOpaque === 0, `② "没有购买记录"的月份真的不填色（${lvInfo.zeros} 个 0 元格子，其中 ${lvInfo.zeroOpaque} 个有填充）`);
ok(lvInfo.mono, '② 深浅随金额单调不倒退');
ok(lvInfo.badN === 0, `② ★ 严格按比例：--hm-o = 0.06+0.89×金额/最大金额(${lvInfo.maxAm})，${lvInfo.n} 个格子全部对得上${lvInfo.badN ? '；不符：' + lvInfo.bad.join('，') : ''}`);
// ★★ 深浅体现在**透明度**上，而且是**连续值**（"无限档、按比例丝滑变化"，用户明确要的）
ok(lvInfo.distinct >= 8, `② ★ 深浅是连续值而不是几档（有记录的格子里出现了 ${lvInfo.distinct} 个互不相同的 alpha）`);
ok(lvInfo.alphas[0] >= 0.06 - 1e-6 && lvInfo.alphas[lvInfo.alphas.length - 1] <= 0.95 + 1e-6,
  `② ★ 所有 alpha 都落在色阶 [0.06, 0.95] 内（实测 ${lvInfo.alphas[0]} … ${lvInfo.alphas[lvInfo.alphas.length - 1]}）`);
ok(lvInfo.midGap >= 0.15, `② ★ 3000 元那格与最深一格差得开（${lvInfo.mid.am} 元 o=${lvInfo.mid.o.toFixed(3)} → ${lvInfo.big.am} 元 o=${lvInfo.big.o.toFixed(3)}，差 ${lvInfo.midGap}）`);

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
// ★ 必须定义在顶层：⑤（窄屏）里也要用它，放到 ③ 的 else 块里就会 ReferenceError（踩过一次）
const yearExpr = `[...document.querySelectorAll('.tl-heatmap-ylabel')].find(e => !e.classList.contains('tl-hm-corner'))`;
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
  const onCells=[...document.querySelectorAll('.tl-heatmap-cell')].filter(c=>+c.style.getPropertyValue('--hm-o')>0);
  const fills=onCells.map(c=>{ const f=c.querySelector('.tl-hm-fill'); return f?getComputedStyle(f):null; }).filter(Boolean);
  // 深浅 = opacity（颜色恒为 --theme），所以这里量的是**计算出来的 opacity**
  const alphas=fills.map(f=>+parseFloat(f.opacity).toFixed(3));
  // ★ 必须取**可见**那一个：页面里可能同时存在隐藏容器里的副本，
  //   document.querySelector 拿到的可能是隐藏副本（它的 computed filter 读出来是 none，
  //   于是"格子有压暗、条带没有"这种假失败会出现）。
  const bar=[...document.querySelectorAll('.tl-hm-legend-bar')].find(b=>b.getBoundingClientRect().width>1)||document.querySelector('.tl-hm-legend-bar');
  return JSON.stringify({
    scheme: document.documentElement.getAttribute('data-color-scheme'),
    tipBg: ct.backgroundColor, tipColor: ct.color, cellBg: cc.backgroundColor,
    fillBg: fills.length?fills[0].backgroundColor:null,
    theme: getComputedStyle(document.documentElement).getPropertyValue('--theme').trim(),
    fillCount: fills.length, distinctColors: new Set(alphas).size,
    alphaSet: [...new Set(alphas)].sort((a,b)=>a-b),
    maxL: alphas.length?Math.max(...alphas):null, minL: alphas.length?Math.min(...alphas):null,
    // 深色模式下条带与格子都必须被同一条压暗规则命中（filter），否则一边暗一边亮
    barFilter: bar?getComputedStyle(bar).filter:null,
    fillFilter: fills.length?fills[0].filter:null
  });
})()`));
await setMode('light');
const lightT = await readTheme();
ok(lightT.scheme === 'light', `⑤ 切到浅色成功（data-color-scheme=${lightT.scheme}）`);
ok(!!lightT.fillBg && !/rgba\(0, 0, 0, 0\)/.test(lightT.fillBg), `⑤ 格子有填充色 ${lightT.fillBg}（= --theme 本色，深浅靠 opacity）`);
// ★★ 深浅由 opacity 表达：有金额的格子出现**多种 alpha**，且最浅↔最深差得开
ok(lightT.distinctColors >= 2, `⑤ 深浅由透明度表达（${lightT.fillCount} 个有色格子出现 ${lightT.distinctColors} 种 alpha）`);
ok(lightT.maxL - lightT.minL >= 0.2, `⑤ ★ 最深与最浅格子的 alpha 差 ≥ 0.2（${lightT.minL} → ${lightT.maxL}，差 ${(lightT.maxL - lightT.minL).toFixed(3)}）`);
await setMode('dark');
const darkT = await readTheme();
ok(darkT.scheme === 'dark', `⑤ 切到深色成功（data-color-scheme=${darkT.scheme}）`);
ok(darkT.tipBg !== lightT.tipBg || darkT.tipColor !== lightT.tipColor, `⑤ tooltip 配色跟着主题变（浅 ${lightT.tipBg}/${lightT.tipColor} → 深 ${darkT.tipBg}/${darkT.tipColor}）`);
ok(Math.abs(lum(darkT.tipBg) - lum(darkT.tipColor)) > 60, `⑤ 深色下 tooltip 底色与文字对比够（${Math.round(Math.abs(lum(darkT.tipBg) - lum(darkT.tipColor)))}）`);
// ★★ 深色下**不动** alpha 色阶（"接近透明"在暗底上更接近背景色 —— 用户说这是预期行为，
//   不要为了可见性把它加白提亮，也不做压暗之类的"深色专用"处理）。
//   ⇒ 深浅集合必须与浅色**逐值相同**，而且**两边都不该挂任何滤镜**（防"写了但静默不生效"）。
ok(JSON.stringify(darkT.alphaSet) === JSON.stringify(lightT.alphaSet),
  `⑤ ★★ 深色下 alpha 色阶与浅色逐值相同（浅 ${lightT.alphaSet.join('/')} vs 深 ${darkT.alphaSet.join('/')}）`);
ok(String(lightT.fillFilter) === 'none' && String(darkT.fillFilter) === 'none' &&
   String(lightT.barFilter) === 'none' && String(darkT.barFilter) === 'none',
  `⑤ ★★ 格子和条带都不挂滤镜（浅色 fill=${lightT.fillFilter}/bar=${lightT.barFilter}，深色 fill=${darkT.fillFilter}/bar=${darkT.barFilter}）`);
ok(darkT.maxL - darkT.minL >= 0.2,
  `⑤ ★★ 深色下深浅依然分得开（alpha 跨度 ${(darkT.maxL - darkT.minL).toFixed(3)} ≥ 0.2）`);
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

// ─────────── ⑤-b 色阶图例（0/25/50/75/100% + 最亮档提亮） ───────────
// 用户要求："加一条类似于山河地图那样的指示条带，分别在 0%、25%、50%、75%、100% 的
// 地方标注颜色深浅对应的价格。最亮的颜色还可以更加亮以拉开颜色区分度。"
// 后续又明确：条带**本身是连续渐变**（不是 5 个离散色块）；中间三个节点各一根竖杠、
// 两端不画；五个金额标签**以对应位置为中心**对齐；只写金额（无括号、无注解、不可点）；
// **图例里不要任何标题文字**（"金额"、"少 → 多"都不要）；条带宽度与热力条一致。
const legendFrame = `(()=>{
  const lg = [...document.querySelectorAll('.tl-heatmap-legend')].find(e => e.getBoundingClientRect().width > 1) || document.querySelector('.tl-heatmap-legend');
  if (!lg) return JSON.stringify({ found: false });
  const cs = getComputedStyle;
  const bar = lg.querySelector('.tl-hm-legend-bar');
  const marks = [...lg.querySelectorAll('.tl-hm-legend-mark')];
  const ticks = [...lg.querySelectorAll('.tl-hm-legend-tick')];
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  const cellInfo = cells.map(c => {
    const f = c.querySelector('.tl-hm-fill');
    return { src: c.style.getPropertyValue('--hm-src').trim(),
             amt: +(c.style.getPropertyValue('--hm-src') || 0),
             bright: c.style.getPropertyValue('--hm-bright').trim(),
             o: c.style.getPropertyValue('--hm-o').trim(),
             // ★ 深浅现在只由 opacity 表达（颜色恒为 --theme）；alpha 就是 --hm-o
             alpha: +(c.style.getPropertyValue('--hm-o') || 0),
             color: cs(f).backgroundColor, opacity: +cs(f).opacity };
  });
  const maxAmt = Math.max(0, ...cellInfo.map(c => +c.src || 0));
  const lr = lg.getBoundingClientRect();
  const br = bar ? bar.getBoundingClientRect() : null;
  const slot = lg.querySelector('.tl-hm-legend-slot');
  const sr = slot ? slot.getBoundingClientRect() : null;
  // 热力条（12 个格子的整体范围）：第一格左边缘 → 最后一格右边缘
  const firstCell = cells[0], lastCell = cells[cells.length - 1];
  const fcr = firstCell ? firstCell.getBoundingClientRect() : null;
  const lcr = lastCell ? lastCell.getBoundingClientRect() : null;
  const themeColor = cs(document.documentElement).getPropertyValue('--theme').trim();
  // 该档金额对应的色相（用于和渐变 stop 比对）
  const segColorAt = (amt) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    const stop = document.createElementNS('http://www.w3.org/2000/svg','stop');
    const bg = cs(bar).backgroundImage;
    return bg;
  };
  return JSON.stringify({
    found: true,
    theme: themeColor,
    themeLight: cs(document.documentElement).getPropertyValue('--theme-light').trim(),
    barImage: bar ? cs(bar).backgroundImage : null,
    barColor: bar ? cs(bar).backgroundColor : null,
    barH: br ? Math.round(br.height) : 0,
    markCount: marks.length,
    marks: marks.map(m => ({ pct: +m.dataset.percent, left: Math.round(m.getBoundingClientRect().left),
                             w: Math.round(m.getBoundingClientRect().width), h: Math.round(m.getBoundingClientRect().height) })),
    ticks: ticks.map(t => ({ pct: +t.dataset.percent, amt: +t.dataset.amount, text: t.textContent.trim(),
        left: Math.round(t.getBoundingClientRect().left), right: Math.round(t.getBoundingClientRect().right),
        center: (t.getBoundingClientRect().left + t.getBoundingClientRect().right) / 2,
        transform: cs(t).transform, cursor: cs(t).cursor, pe: cs(t).pointerEvents })),
    anchors: [0, 25, 50, 75, 100].map(p => sr ? sr.left + sr.width * p / 100 : -1),
    tickTags: ticks.map(t => t.tagName),
    linkCount: lg.querySelectorAll('a').length,
    textAll: lg.textContent.replace(/\\s+/g, ' ').trim(),
    hasArrow: /[\\u2192\\u27A1\\u2794\\u21D2\\uFF0D>]/.test(lg.textContent),
    cellInfo, maxAmt,
    bar: br ? { left: Math.round(br.left), right: Math.round(br.right), w: Math.round(br.width) } : null,
    heatBar: (fcr && lcr) ? { left: Math.round(fcr.left), right: Math.round(lcr.right), w: Math.round(lcr.right - fcr.left) } : null,
    legend: { left: Math.round(lr.left), right: Math.round(lr.right), top: Math.round(lr.top), bottom: Math.round(lr.bottom) },
    hm: (() => { const h = document.querySelector('.tl-heatmap').getBoundingClientRect();
        return { left: Math.round(h.left), right: Math.round(h.right), bottom: Math.round(h.bottom) }; })(),
    tickFont: ticks.length ? parseFloat(cs(ticks[0]).fontSize) : 0,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    vw: window.innerWidth,
    scheme: document.documentElement.getAttribute('data-color-scheme')
  });
})()`;
const lg375 = JSON.parse(await evaluate(legendFrame));
ok(lg375.found === true, '⑤-b ★ 热力图下面有色阶图例条带');
ok(lg375.markCount === 3, `⑤-b ★ 恰好 3 根竖杠刻度（实际 ${lg375.markCount} 根）`);
ok(JSON.stringify(lg375.marks.map(m => m.pct)) === JSON.stringify([25, 50, 75]),
  `⑤-b ★ 三根竖杠就在 25/50/75%（实际 ${lg375.marks.map(m => m.pct + '%').join(' / ')}）—— 两端不画`);
ok(lg375.ticks.length === 5, `⑤-b 图例里正好 5 个金额标签（实际 ${lg375.ticks.length} 个）`);
ok(JSON.stringify(lg375.ticks.map(t => t.pct)) === JSON.stringify([0, 25, 50, 75, 100]),
  `⑤-b 五个标签分别对应 0/25/50/75/100%（实际 ${lg375.ticks.map(t => t.pct).join('/')}）`);
// 五档价格 = 百分比 × 最大金额（同一条连续色阶的取值，不是另造的几个数）
ok(lg375.ticks.every(t => t.amt === Math.round(lg375.maxAmt * t.pct / 100)),
  `⑤-b ★ 五档数值就是 0/25/50/75/100% × 最大金额 ${lg375.maxAmt}：${lg375.ticks.map(t => t.pct + '%=' + t.amt + '元').join(' · ')}`);
ok(lg375.ticks.every(t => t.text === t.amt + '元'),
  `⑤-b ★ 标签只写金额、不带括号也不带注解（${lg375.ticks.map(t => t.text).join(' / ')}）`);
// ★ 标签水平中心落在对应百分比位置上（居中语义）
const offMax = Math.max(...lg375.ticks.map((t, i) => Math.abs(t.center - lg375.anchors[i])));
ok(offMax <= 2,
  `⑤-b ★ 五个标签都以对应位置为**中心**（最大偏差 ${offMax.toFixed(1)}px）：${lg375.ticks.map((t, i) => t.pct + '%@' + t.center.toFixed(0) + '/靶' + lg375.anchors[i].toFixed(0)).join(' ')}`);
ok(lg375.ticks.every(t => /matrix\(1, 0, 0, 1, -\d/.test(t.transform) || /translateX\(-50%\)/.test(t.transform)),
  '⑤-b ★ 定位用的是 translateX(-50%) 居中语义（没有改成两端贴边对齐）');
// ★★ 条带 = **一条连续渐变、整条作为一个整体**，只用**两个色停**（0% 近透明 → 100% 最深）。
//   用户最终方案原话："就把整条作为整体不就行了吗？"
//   ⇒ 这里钉住"恰好两个色停、覆盖 0%→100%"，不许再出现 25/50/75% 中间的 alpha 色停
//     （老实现正是把变化挤在前 25%：0% 全透明、25% 已接近满色）。
ok(/linear-gradient\(to right/.test(lg375.barImage || ''),
  `⑤-b ★ 指示条是 linear-gradient(to right, …)（实测 ${String(lg375.barImage).slice(0, 70)}…）`);
// ★ 注意 Chrome 会把 rgba() 色停序列化成 `color(srgb r g b / a)`（新版）或 `rgba(r, g, b, a)`
//   （旧版），两种写法都要能解析，否则这里会静默解析出 0 个色停、断言形状全错。
//   形状：[色值] [百分比]? 之间用逗号分隔，最后一端可能没有百分比（隐含 100%）。
const barImageStr = String(lg375.barImage || '');
const gradBody = (barImageStr.match(/linear-gradient\(([^]*)\)$/) || [, ''])[1];
const gradientStops = gradBody.split(/,(?![^(]*\))/).map(part => {
  const s = part.trim();
  const color = (s.match(/^(color\([^)]*\)|rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|transparent)/) || [])[1] || '';
  const pm = s.match(/([\d.]+)%/);
  return { color, pct: pm ? +pm[1] : null, raw: s };
}).filter(s => s.color);
// 没有百分比的端点按 CSS 规则补默认值：第一个 0%、最后一个 100%
if (gradientStops.length && gradientStops[0].pct === null) gradientStops[0].pct = 0;
if (gradientStops.length && gradientStops[gradientStops.length - 1].pct === null) {
  gradientStops[gradientStops.length - 1].pct = 100;
}
ok(gradientStops.length === 2,
  `⑤-b ★★ 渐变**恰好两个色停**（实际 ${gradientStops.length} 个：${gradientStops.map(s => s.color + '@' + s.pct + '%').join(' , ') || '解析为空：' + barImageStr}）`);
ok(JSON.stringify(gradientStops.map(s => s.pct)) === JSON.stringify([0, 100]),
  `⑤-b ★★ 两个色停覆盖 0% → 100%（实际 [${gradientStops.map(s => s.pct).join(', ')}]）`);
ok(!/(25|50|75)\s*%/.test(gradBody),
  '⑤-b ★★ 渐变里**没有** 25/50/75% 的中间色停（整条交给浏览器线性插值）');
// alpha 解析：rgba(r,g,b,a) 的第 4 个分量，或 color(srgb r g b / a) 的斜杠后分量；rgb() 视为 1
const alphaOf = (c) => {
  const s = String(c);
  const srgb = s.match(/color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+%?))?/);
  if (srgb) {
    if (srgb[4] == null) return 1;
    return /%$/.test(srgb[4]) ? parseFloat(srgb[4]) / 100 : parseFloat(srgb[4]);
  }
  const m = s.match(/rgba?\(([^)]*)\)/);
  if (!m) return NaN;
  const parts = m[1].split(/[,\s/]+/).filter(x => x !== '').map(s => parseFloat(s));
  if (parts.length >= 4) return parts[parts.length - 1];
  return 1;
};
// 色相三元组（取掉 alpha 的前三个分量，统一成 0-255）
const rgbOf = (c) => {
  const s = String(c);
  const srgb = s.match(/color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  if (srgb) return [+srgb[1], +srgb[2], +srgb[3]].map(x => Math.round(x * 255));
  const m = s.match(/rgba?\(([^)]*)\)/);
  if (!m) return null;
  return m[1].split(/[,\s/]+/).filter(x => x !== '').slice(0, 3).map(s => Math.round(parseFloat(s)));
};
const endAlpha = gradientStops.map(s => alphaOf(s.color));
ok(JSON.stringify(rgbOf(gradientStops[0].color)) === JSON.stringify(rgbOf(gradientStops[1].color)),
  `⑤-b ★★ 两个端点是同一支颜色（只变 alpha）：${rgbOf(gradientStops[0].color)} / ${rgbOf(gradientStops[1].color)}`);
ok(endAlpha[0] <= 0.12, `⑤-b ★★ 0% 端 alpha ≤ 0.12（"接近透明"；实际 ${endAlpha[0]}）`);
ok(endAlpha[1] >= 0.9, `⑤-b ★★ 100% 端 alpha ≥ 0.9（最深/最显眼；实际 ${endAlpha[1]}）`);
ok(endAlpha[1] > endAlpha[0], `⑤-b ★★ 100% 端比 0% 端更实（${endAlpha[0]} → ${endAlpha[1]}）`);
// 这条直线：条上比例 p 处的 alpha = lerp(0.06, 0.95, p)
const barAlphaAt = (p) => endAlpha[0] + (endAlpha[1] - endAlpha[0]) * p;
// 颜色解析工具（下面多处要用）
const rgbTriple = (v) => {
  const s = String(v == null ? '' : v);
  const cm = s.match(/color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  if (cm) return [+cm[1], +cm[2], +cm[3]].map(x => Math.round(x * 255));
  const hm = s.match(/#([0-9a-fA-F]{6})/);
  if (hm) { const h = hm[1]; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
  const m = s.match(/([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return m ? [+m[1], +m[2], +m[3]].map(x => Math.round(x)) : null;
};
// 明度工具（WCAG 相对亮度）。rgb(…) / color(srgb …) / #rrggbb 都归一成 [r,g,b] 0-1。
const lumOfRgb = (t3) => {
  const [R, G, B] = t3.map(x => x / 255);
  const f = (x) => { const t = Math.min(1, Math.max(0, x)); return t <= 0.03928 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B);
};
const lumOf = (v) => { const t3 = rgbTriple(v); return t3 ? lumOfRgb(t3) : NaN; };
// HSL 的 L = (max+min)/2
const hslLOf = (v) => { const t3 = rgbTriple(v); return t3 ? (Math.max(...t3) + Math.min(...t3)) / 2 / 255 : NaN; };
// 色相固定（不要为了区分度变成彩虹色）：两个端点都必须是同一支蓝。
ok(gradientStops.every(s => { const t = rgbTriple(s.color); return t && t[2] > t[0] && t[2] >= t[1]; }),
  `⑤-b ★★ 条带两端都是蓝色系（B 通道最大、R 最小）：${gradientStops.map(s => rgbTriple(s.color).join(',')).join(' | ')}`);
// ★ 图例里不要任何文字（标题/注解），只剩金额标签
ok(!/金额/.test(lg375.textAll), `⑤-b ★ 图例里没有「金额」标题（实际文字「${lg375.textAll}」）`);
ok(!/少\s*→\s*多/.test(lg375.textAll) && !lg375.hasArrow,
  `⑤-b ★ 图例里没有「少 → 多」这类注解、也没有箭头符号（实际文字「${lg375.textAll}」）`);
// ★ 图例不可点击
ok(lg375.linkCount === 0 && lg375.tickTags.every(t => t === 'SPAN'),
  '⑤-b ★ 金额标签里没有 <a>、没有 href（全是 <span>）');
ok(lg375.ticks.every(t => t.pe === 'none' && t.cursor !== 'pointer'),
  `⑤-b ★ 金额标签不可点（pointer-events=${lg375.ticks[0].pe}，cursor=${lg375.ticks[0].cursor}）`);
// ★ 宽度与热力条一致（逐像素）
ok(lg375.bar && lg375.heatBar && Math.abs(lg375.bar.left - lg375.heatBar.left) <= 1 &&
   Math.abs(lg375.bar.right - lg375.heatBar.right) <= 1,
  `⑤-b ★ 指示条宽度与热力条一致（条带 ${lg375.bar.left}..${lg375.bar.right} vs 热力条 ${lg375.heatBar.left}..${lg375.heatBar.right}）`);
// ★★★ 图例 ↔ 热力图**逐档相等**（用户最终方案："就把整条作为整体"）。
//   实现上两边就是**同一条直线**：条带 `linear-gradient(to right, rgba(blue,0.06), rgba(blue,0.95))`
//   由浏览器按整条宽度线性插值；热力图格子的 opacity = alpha(v) = lerp(0.06, 0.95, v/max)。
//   这里取**最小 / 中间 / 最大**三个格子，与"条上同一比例位置的 alpha"逐档比对（容差 ≤0.02）。
const cellAmts = [...lg375.cellInfo].filter(c => c.amt > 0).sort((a, b) => a.amt - b.amt);
const minCell = cellAmts[0], maxCell = cellAmts[cellAmts.length - 1];
const midCell = cellAmts[Math.floor(cellAmts.length / 2)];
const cellAlpha = (c) => +c.alpha;
const samples = [{ tag: '最小', c: minCell }, { tag: '中间', c: midCell }, { tag: '最大', c: maxCell }].filter(s => s.c);
const sampleRows = samples.map(s => {
  const ratio = s.c.amt / lg375.maxAmt;
  const want = barAlphaAt(ratio);
  return { tag: s.tag, amt: s.c.amt, ratio, got: cellAlpha(s.c), want, diff: Math.abs(cellAlpha(s.c) - want) };
});
ok(sampleRows.every(r => r.diff <= 0.02),
  `⑤-b ★★★ 最小/中间/最大三个格子的 alpha == 条上同比例位置的 alpha（${sampleRows.map(r => r.tag + ' ' + r.amt + '元 α=' + r.got.toFixed(3) + ' vs ' + r.want.toFixed(3)).join(' | ')}）`);
ok(Math.abs(cellAlpha(maxCell) - endAlpha[1]) <= 0.02,
  `⑤-b ★★★ 值最大的格子（${maxCell.amt}元 ⇒ 1.000）== 条 100% 端（α ${cellAlpha(maxCell).toFixed(3)} vs ${endAlpha[1]}）`);
// 值最小的格子严格说落在 3.4% 处（不是 0%），所以它应该**比 0% 端略实、且仍在 25% 刻度以内**；
// "0% 端"由页面自己的取色函数核对（v=0 ⇒ 0.06），这才是真正的端点断言。
const minRatio = minCell.amt / lg375.maxAmt;
ok(cellAlpha(minCell) >= endAlpha[0] - 0.02 && cellAlpha(minCell) < barAlphaAt(0.25),
  `⑤-b ★★★ 值最小的格子（${minCell.amt}元 ⇒ ${minRatio.toFixed(3)}）比 0% 端略实、但仍在 25% 刻度之内（α ${cellAlpha(minCell).toFixed(3)}：${endAlpha[0]} ≤ α < ${barAlphaAt(0.25).toFixed(3)}）`);
// 热力图**全部**格子的 alpha 都出自这条色阶（与 lerp 值相等）
const offRampAlpha = cellAmts.filter(c => Math.abs(cellAlpha(c) - barAlphaAt(c.amt / lg375.maxAmt)) > 0.02);
ok(offRampAlpha.length === 0,
  `⑤-b ★★★ 热力图全部 ${cellAmts.length} 个有色格子的 alpha 都出自这条色阶（不在的：${offRampAlpha.map(c => c.amt + '元/α' + c.alpha).join(', ') || '无'}）`);
ok(cellAmts.every(c => cellAlpha(c) >= endAlpha[0] - 0.02 && cellAlpha(c) <= endAlpha[1] + 0.02),
  `⑤-b ★★★ 所有格子 alpha 都落在条带两端之间 [${endAlpha[0]}, ${endAlpha[1]}]`);
// 格子写的是同一支主题蓝（不是别处另一套颜色）：颜色只有一种，就是 --theme
const fillColors = [...new Set(cellAmts.map(c => (rgbTriple(c.color) || []).join(',')))];
ok(fillColors.length === 1 && fillColors[0] === (rgbTriple(lg375.theme) || []).join(','),
  `⑤-b ★★★ 格子底色全是 --theme 本色（只靠 opacity 分深浅）：${fillColors.join(' / ')} vs theme ${rgbTriple(lg375.theme)}`);
// 页面自己的取色函数与条带两端一致（不用 DOM，直接调页面函数）
const fnEnds = JSON.parse(await evaluate(`(()=>{
    if (typeof timelineHeatmapColorCss !== 'function') return JSON.stringify(null);
    return JSON.stringify([timelineHeatmapColorCss(0, 7193), timelineHeatmapColorCss(7193, 7193)]);
})()`));
ok(!!fnEnds && Math.abs(alphaOf(fnEnds[0]) - endAlpha[0]) <= 1e-6,
  `⑤-b ★★★ 页面取色在 v=0（最少钱的档）时正好是条带 0% 端（α ${fnEnds && alphaOf(fnEnds[0])} == ${endAlpha[0]}）`);
ok(!!fnEnds && Math.abs(alphaOf(fnEnds[1]) - endAlpha[1]) <= 1e-6,
  `⑤-b ★★★ 页面 timelineHeatmapColorCss(max) 的 alpha == 条带 100% 端（${fnEnds && alphaOf(fnEnds[1])} vs ${endAlpha[1]}）`);
// 图例在热力图的**数据行下方**（.tl-heatmap 的 bottom 含最后一个格子的悬浮泡，
// 那个泡是绝对定位、不算版式高度，所以拿最后一个数据行的 bottom 来比）
const lastRowBottom = await evaluate(`(()=>{
  const rows = [...document.querySelectorAll('.tl-heatmap-row')].filter(r => r.querySelector('.tl-heatmap-cell'));
  const r = rows[rows.length - 1];
  return r ? Math.round(r.getBoundingClientRect().bottom) : -1;
})()`);
ok(lg375.legend.top >= lastRowBottom - 1,
  `⑤-b 图例贴在热力图数据行下方（图例 top ${lg375.legend.top} ≥ 最后一行 bottom ${lastRowBottom}）`);
ok(lg375.barH >= 5 && lg375.barH <= 12, `⑤-b 条带是 8px 那种细条（实际 ${lg375.barH}px 高）`);
ok(lg375.legend.right <= lg375.vw && lg375.docOverflow <= 1,
  `⑤-b ★ 375px 下图例不超出屏幕（图例 ${lg375.legend.left}..${lg375.legend.right}，视口 ${lg375.vw}，溢出 ${lg375.docOverflow}）`);

// 窄屏下年份那个"侧边泡"也不能跑出屏幕（用户专门提的）：它在数字右边、尖角在左侧竖边
await evaluate(`(()=>{ const hm=document.querySelector('.tl-heatmap'); if (hm && hm.scrollIntoView) hm.scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(400);
await hoverAt(yearExpr);
const mYear = await tipProbe(yearExpr);
ok(mYear.found && mYear.vis && mYear.outX <= 1,
  `⑤ ★ 窄屏下年份的侧边泡不越出屏幕（左右越界 ${mYear.outX}｜${mYear.geo}）`);
ok(mYear.outY <= 1, `⑤ ★ 窄屏下年份的侧边泡上下仍在热力图内（上下越界 ${mYear.outY}）`);
ok(mYear.arrowSide === 'Right' && mYear.tipL >= mYear.textR,
  `⑤ ★ 窄屏下年份的泡仍在数字右边、尖角在左侧竖边（泡左 ${mYear.tipL} ≥ 数字右 ${mYear.textR}；尖角边 ${mYear.arrowSide}）`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
await sleep(200);

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
  flipReady: typeof playTimelineFlip === 'function' && typeof snapshotTimelineFlip === 'function',
  heatmap: !!document.querySelector('.tl-heatmap'), header: !!document.querySelector('.timeline-header') }); })()`));
ok(clicked2 === 'ok', '⑥ 又点了一个格子（换筛选）');
ok(filterInfo.va === 0, `⑥ ★ 换筛选没有再触发整页动画（triggerViewAnimation 调用 ${filterInfo.va} 次）`);
// ★ 这条原来是"换筛选时只有 .timeline-body 淡入一次"。用户后来要求改成"像纸币/硬币搜索结果
//   那样的进出场（左右+上下滑动）"，整块淡入已经删掉，改为由条目的 FLIP 负责 ——
//   所以这里核对的是"FLIP 就位 + 没有再整块重播"（本意不变：换筛选只动列表区）。
ok(!filterInfo.bodyAnim && filterInfo.flipReady, '⑥ ★ 换筛选不再整块淡入，改由条目自己滑进滑出（FLIP 就位）');
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
