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
// ★★ 先在页面里装一个"读泡文本"的小工具（Node 侧和页面侧共用同一套语义）：
//   · 泡用 `<br>` 分行 ⇒ **textContent 会把 `<br>` 吞掉**（三行粘成一行，断言会看错）；
//   · **innerText 在 headless 里返回空串**（实测，不可靠）；
//   ⇒ 唯一可靠的读法是：取 innerHTML → `<br>` 换成 \n → 剥掉其余标签 → 解码实体。
await evaluate(`window.__tipText = function(t){
  if (!t) return '';
  var h = String(t.innerHTML||'').split(/<br\\s*\\/?>/i).join('\\n');
  h = h.replace(/<[^>]*>/g,'');
  h = h.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
  return h.trim();
}; 1`);
// ★★ 全局兜底：后续任何一次页面跳转/重渲染都可能把 window.__tipText 抹掉
//   （抹掉之后所有泡文案读出来都是空字符串 —— 断言会退化成"看不懂的失败"）。
//   读泡文本一律走这个函数，它会在缺失时**自己补装**一套（与上面那份语义完全一致）。
const ensureTipText = async () => {
  const okNow = await evaluate(`typeof window.__tipText === 'function' && window.__tipText(document.createElement('span').appendChild(document.createTextNode('x')).parentNode) === 'x'`).catch(() => false);
  if (okNow) return true;
  await evaluate(`window.__tipText = function(t){
    if (!t) return '';
    var h = String(t.innerHTML||'').split(/<br\\s*\\/?>/i).join('\\n');
    h = h.replace(/<[^>]*>/g,'');
    h = h.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
    return h.trim();
  }; 1`);
  return await evaluate(`typeof window.__tipText === 'function'`);
};
await ensureTipText();
const tipTool = await evaluate(`typeof window.__tipText`);
ok(tipTool === 'function', `② 页面里装好了读泡文本的工具 window.__tipText（实际 ${tipTool}）`);
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
        aria: c.getAttribute('aria-label'), tip: (c.querySelector('.tl-heatmap-tip') || {}).innerHTML || null,
        tipTxt: (c.querySelector('.tl-heatmap-tip') || {}).textContent || null,
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
  // ★★★ 每个格子并行记**三套**口径（与页面 buildMonthHeatmap 的三套对齐）：
  //   · n / sum      = 该格**所有条目**（藏品 + 评级费）的裸币口径金额 —— 对应格子的**填色**与 data-amount；
  //   · pn / psum    = **只数藏品**、金额取**录入价**（price 原值）—— 对应提示文案**第一行**；
  //   · npn / npsum  = 只数藏品、金额取**裸币价** —— 供"Σ裸币价"独立校验。
  //   ★ 为什么第一行是录入价而不是裸币价：用户手工把整站加了一遍得到 52746
  //     （≈ 录入价 48721.5 + 评级费 4023）；用裸币价会得到 44698.5 + 4023 = 48721.5，对不上。
  for (const map of [window.DATA_MAP, window.COIN_DATA_MAP]) {
    if (!map) continue;
    for (const k of Object.keys(map)) {
      const d = map[k]; if (!d || !d.series) continue;
      const walk = (arr) => { for (const c of (arr || [])) {
        if (!c || !c.purchaseDate) continue;
        const dt = pdate(c.purchaseDate); if (!dt || isNaN(dt.getTime())) continue;
        const y = String(dt.getFullYear()), mo = String(dt.getMonth() + 1).padStart(2, '0');
        const key = y + '/' + mo;
        cells[key] = cells[key] || { n: 0, sum: 0, pn: 0, psum: 0, npn: 0, npsum: 0 };
        cells[key].n++;
        const raw = px(c.price);
        const fri = (c.copyId && feeOfCert[c.copyId] != null) ? feeOfCert[c.copyId] : 0;
        const p = (raw > 0 && raw - fri >= 0) ? raw - fri : raw;   // 裸币价
        cells[key].sum += p;
        cells[key].pn++; cells[key].psum += raw;                    // 只藏品、录入价
        cells[key].npn++; cells[key].npsum += p;                    // 只藏品、裸币价
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
      // ★ 三种字段都要在：这个月可能**只有评级费**（页面也是一样，cells[m] 一开始就带 pn/psum）
      cells[key] = cells[key] || { n: 0, sum: 0, pn: 0, psum: 0, npn: 0, npsum: 0 };
      cells[key].n++;
      const p = amt; cells[key].sum += p;
      totalAmount += p; feeSum += p; totalCount++; years.add(y);
    }
  }
  // ★ 按范围聚合（与页面的 month/year/all 三套口径一一对应）
  const agg = (pick) => {
    let n = 0, sum = 0, pn = 0, psum = 0, npn = 0, npsum = 0;
    for (const key of Object.keys(cells)) {
      const [yy, mm] = key.split('/').map(Number);
      if (!pick(yy, mm)) continue;
      const c = cells[key];
      n += c.n; sum += c.sum;
      pn += c.pn || 0; psum += c.psum || 0;
      npn += c.npn || 0; npsum += c.npsum || 0;
    }
    return { n, sum: Math.round(sum), pn, psum: Math.round(psum * 10) / 10, npn, npsum: Math.round(npsum * 10) / 10 };
  };
  const totalFee = Math.round(feeSum * 10) / 10;
  const all = agg(() => true);
  return JSON.stringify({
    cells, years: [...years].sort(),
    totalAmount: Math.round(totalAmount), totalCount, ownAmount: Math.round(ownAmount),
    feeSum: totalFee, rawAmount: Math.round(rawAmount),
    range: {
      // 「全部时间」范围：第一行取 pn/psum（只藏品、录入价），第二行 fee = totalFee
      all,
      allTotal: Math.round((all.psum + totalFee) * 10) / 10,
      allNaked: all.npsum,
      allNakedPlusFee: Math.round((all.npsum + totalFee) * 10) / 10
    }
  });            // ← JSON.stringify 的右括号（少一个就会报 "missing ) after argument list"）
})()`));
console.log(`      独立重算：${expectMatrix.years.length} 个年份（${expectMatrix.years.join(',')}）、${expectMatrix.totalCount} 件、${expectMatrix.totalAmount} 元`);

ok(!!shape && shape.rows.length === expectMatrix.years.length, `② 行数与该年份数一致（页面 ${shape ? shape.rows.length : '?'} vs 重算 ${expectMatrix.years.length}）`);

// ★★ 读泡文本的统一入口。
//   ★ 为什么不能直接用 textContent：泡里用 `<br>` 分行（见 special.js 的 tipHtml），
//     而 **textContent 会把 `<br>` 吞掉**，三行粘成一行；
//     **innerText 在 headless 里返回空串**（实测，不可靠）。
//     ⇒ 自己按 `<br>` 切：取出 innerHTML → `<br>` 换成 \n → 去掉其余标签 → 解码实体。
//   返回 { text, lines }：text 用 \n 连接（与 aria-label 的写法一致，可直接互相比较）。
const decodeEnt = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const tipTextOf = (tip) => {
    if (tip == null) return { text: '', lines: [] };
    const raw = String(tip);
    const html = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
    const text = decodeEnt(html).trim();
    return { text, lines: text.split('\n') };
};
let cellBad = 0, cellChecked = 0, sumAll = 0;
for (const r of (shape?.rows || [])) {
  for (const c of r.cells) {
    const want = expectMatrix.cells[r.year + '/' + c.m] || { n: 0, sum: 0, pn: 0, psum: 0 };
    cellChecked++;
    sumAll += want.sum;
    const { text: tip, lines } = tipTextOf(c.tip);
    // 用户定的文案格式（2026-10 起是**两/三行**）：
    //   第一行 = `x年x月，共购入N件，合计X元`，N/X **只算藏品**、X = Σ**录入价**（不含评级费）
    //   第二行 = `另对K件钱币评级，评级费用 Y 元`（该月没有评级费就整行没有）
    //   第三行 = `合计支出Z元`，Z = X + Y（同样只在有评级费时出现）
    const wantText = `${r.year}年${Number(c.m)}月，共购入${want.pn}件，合计${want.psum}元`;
    const exact = lines[0] === wantText;
    const nOk = lines[0].includes(`共购入${want.pn}件`);
    const sumOk = lines[0].includes(`合计${want.psum}元`);
    // ★ aria-label 走的是 escapeAttr ⇒ 里面的 `<strong class="tl-hm-num">` 被编码成
    //   `%3Cstrong class=%22tl-hm-num%22%3E`。要比就先把实体/百分号编码解回来，
    //   再去掉标签，最后和泡的纯文本比。
    const ariaPlain = decodeEnt(String(c.aria || '').replace(/%3C/gi, '<').replace(/%3E/gi, '>')
      .replace(/%22/g, '"').replace(/&#10;/g, '\n').replace(/%0A/gi, '\n'))
      .replace(/<[^>]*>/g, '');
    const ariaOk = !!c.aria && ariaPlain.includes(`共购入${want.pn}件`) && ariaPlain.includes(`合计${want.psum}元`);
    // ★ 第一行里**绝不能**并进评级费（这正是用户报的"多了一倍评级费"）
    const feeAmt = (() => { const m = (lines[1] || '').match(/评级费用\s*([\d.]+)\s*元/); return m ? +m[1] : null; })();
    const noFeeInHead = feeAmt == null || !lines[0].includes(`合计${Math.round(want.psum + feeAmt)}元`);
    // ★★ 第三行 == 第一行 + 第二行（逐格恒等 ⇒ 评级费只被加过一次）
    const totalOk = (() => {
      if (feeAmt == null) return lines.length === 1;
      const m = (lines[2] || '').match(/^合计支出([\d.]+)元$/);
      return lines.length === 3 && !!m && Math.abs(+m[1] - (want.psum + feeAmt)) <= 0.01;
    })();
    if (!nOk || !sumOk || !ariaOk || !exact || !noFeeInHead || !totalOk) {
      cellBad++;
      if (cellBad <= 5) console.log(`      ✗ ${r.year}/${c.m} 期望「${wantText}」(+评级费行)，页面 tooltip「${tip}」aria「${c.aria}」`);
    }
  }
}
ok(cellChecked === 12 * (shape?.rows.length || 0), `② 逐个检查了 ${cellChecked} 个格子`);
ok(cellBad === 0, `② ★ ${cellChecked} 个格子的「件数 + 金额」全部与独立重算一致（不一致 ${cellBad} 个）`);
if (cellBad) {
  const dbg = await evaluate(`(()=>{
    const out = [];
    const rows = [...document.querySelectorAll('.tl-heatmap-row')].filter(r=>!r.classList.contains('tl-hm-head'));
    for (const r of rows) { const y = (r.querySelector('.tl-heatmap-ylabel')||{}).dataset?.label;
      for (const c of r.querySelectorAll('.tl-heatmap-cell')) {
        const t = c.querySelector('.tl-heatmap-tip');
        out.push({ key: y + '/' + c.dataset.month, tip: window.__tipText ? __tipText(t) : String(t.innerHTML).replace(/<[^>]*>/g,'') });
      } }
    // 顺带把"页面自己统计的 (n, sum) 口径"也报出来（从 data-amount 与 class 里能看出有没有色）
    return JSON.stringify(out.slice(0, 4));
  })()`);
  console.log(`      ⚠ 独立复算 vs 页面（前 4 格）：`);
  console.log(`         复算：${Object.keys(expectMatrix.cells).slice(0, 4).map(k => k + '=' + JSON.stringify(expectMatrix.cells[k])).join(' , ')}`);
  console.log(`         页面：${dbg}`);
}
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

// ─────────── ②-c 悬浮提示：第一行不含评级费、第二/三行按需出现 ───────────
// 用户 2026-10 的三行形态（以 2026年10月 为例）：
//   2026年10月，共购入9件，合计1114元        ← **不含**评级费（否则均价被抬高）
//   另对34件钱币评级，评级费用 810 元
//   当月合计支出1924元                       ← 1114 + 810，只在有评级费时出现
console.log('\n══════ ②-c 悬浮提示：合计不含评级费 + 评级费单独成行 ══════\n');
// 独立复算：从**台账原始数据**（页面数据文件）重算每月评级费件数与金额，
// 不读页面算好的任何东西 —— 否则这里就变成"用页面验证页面"了。
const expectFees = JSON.parse(await evaluate(`(()=>{
  const d = (window.DATA_MAP && window.DATA_MAP['gradingFeeData']) || null;
  if (!d || !Array.isArray(d.batches)) return JSON.stringify({});
  const copyIds = new Set();
  for (const map of [window.DATA_MAP, window.COIN_DATA_MAP]) {
    if (!map) continue;
    for (const k of Object.keys(map)) { const dd = map[k]; if (!dd || !dd.series) continue;
      const scan = (arr) => { for (const c of (arr || [])) if (c && c.copyId) copyIds.add(String(c.copyId)); };
      for (const s of dd.series) { if (s.varieties) { for (const v of s.varieties) scan(v.copies); } else scan(s.copies); } }
  }
  const pdate = (s) => { const t=String(s||'').trim(); const dd=new Date(t); if(!isNaN(dd.getTime())) return dd;
    const m=t.match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})/); return m?new Date(+m[1],+m[2]-1,+m[3]):null; };
  const num = (s) => { const v = parseFloat(String(s==null?'':s).replace(/[^0-9.]/g,'')); return isNaN(v)?0:v; };
  const out = {};
  for (const b of d.batches) {
    if (!b || !b.paidDate) continue;
    const live = (b.items||[]).filter(it => it && copyIds.has(String(it.cert)) && !it.reholder);   // 已售出/换壳都剔除
    const amount = live.reduce((s,it)=>s+num(it.paidFee),0);
    if (amount <= 0) continue;
    const dt = pdate(b.paidDate); if (!dt) continue;
    // ★★ key 必须与 data-month 完全同形（**两位、带前导零**）：
    //   写成 2026/1 就永远匹配不上页面里的 2026/01，于是 1~9 月被误判成"无评级费"
    //   （上一版就是这么报出"第一行 2259 ≠ Σ录入价 0 / 无评级费却有 3 行"的）。
    const key = dt.getFullYear() + '/' + String(dt.getMonth() + 1).padStart(2, '0');
    const cur = out[key] || { k:0, amount:0 };
    cur.k += live.length; cur.amount = Math.round((cur.amount + amount)*100)/100;
    out[key] = cur;
  }
  return JSON.stringify(out);
})()`));
const feeKeys = Object.keys(expectFees);
console.log(`      独立重算的评级费月份：${feeKeys.map(k => k + ' → ' + expectFees[k].k + '件/' + expectFees[k].amount + '元').join('；') || '（无）'}`);

const tipsAll = JSON.parse(await evaluate(`(()=>{
  const rows = [...document.querySelectorAll('.tl-heatmap-row')].filter(r => !r.classList.contains('tl-hm-head'));
  const out = [];
  for (const r of rows) {
    const y = (r.querySelector('.tl-heatmap-ylabel')||{}).dataset?.label || null;
    for (const c of r.querySelectorAll('.tl-heatmap-cell')) {
      const t = c.querySelector('.tl-heatmap-tip');
      out.push({ y, m: c.dataset.month, tip: __tipText(t), aria: c.getAttribute('aria-label') || '' });
    }
  }
  return JSON.stringify(out);
})()`));
ok(tipsAll.length === 12 * (shape?.rows.length || 0), `②-c 取到全部 ${tipsAll.length} 个格子的提示文本`);
if (tipsAll.slice(0, 3).some(t => !t.tip)) {
  console.log(`      ⚠ 泡文案读成空串：${tipsAll.slice(0, 3).map(t => `${t.y}/${t.m}=${JSON.stringify(t.tip)}`).join(' , ')}`);
  console.log(`      ⚠ 读泡工具状态：${await evaluate(`typeof window.__tipText`)}`);
  console.log(`      ⚠ 原始 innerHTML：${await evaluate(`(document.querySelector('.tl-heatmap-cell .tl-heatmap-tip')||{}).innerHTML`)}`);
}

// ① 逐格对齐：第一行件数/金额与独立重算一致（已在 ② 覆盖），这里专测**行数与行内容**
let tipBad = [];
const seenFeeMonths = [];
for (const t of tipsAll) {
  const lines = String(t.tip).split('\n');
  // ★★ 台账 monthKey 是 'y/MM'（**两位、带前导零**，与 data-month 一模一样）；
  //   早先写成 Number(t.m) 得到 'y/1'，于是 1~9 月的台账永远查不到
  //   ⇒ 这些月份被当成"无评级费"，用例报出"第一行 2259 ≠ Σ录入价 0"这种看不懂的错。
  const mk = t.y + '/' + t.m;
  const exp = expectFees[mk] || null;
  const cellWant = expectMatrix.cells[mk] || null;
  const head = lines[0] || '';
  const feeLine = lines.find(l => l.startsWith('另对')) || null;
  const totalLine = lines.find(l => l.startsWith('合计支出')) || null;
  const headSum = +((head.match(/合计([\d.]+)元/) || [])[1] || NaN);
  if (exp) {
    seenFeeMonths.push(mk);
    // 有评级费 ⇒ 必须三行齐全
    if (lines.length !== 3) tipBad.push(`${t.y}/${t.m} 行数 ${lines.length}（应有评级费，应为 3 行）：${JSON.stringify(t.tip)}`);
    if (!feeLine || !totalLine) tipBad.push(`${t.y}/${t.m} 缺第二/三行：${JSON.stringify(t.tip)}`);
    else {
      const k = +((feeLine.match(/另对([0-9]+)件/) || [])[1] || NaN);
      const fa = +((feeLine.match(/评级费用([\d.]+)元/) || [])[1] || NaN);
      const tl = +((totalLine.match(/合计支出([\d.]+)元/) || [])[1] || NaN);
      if (k !== exp.k) tipBad.push(`${t.y}/${t.m} 评级件数 ${k} ≠ 台账 ${exp.k}`);
      if (Math.abs(fa - exp.amount) > 0.01) tipBad.push(`${t.y}/${t.m} 评级费 ${fa} ≠ 台账 ${exp.amount}`);
      // ★★★ 第三行 == 第一行 + 第二行（逐月恒等 ⇒ 评级费只被加过一次）
      if (Math.abs(tl - (headSum + fa)) > 0.01) tipBad.push(`${t.y}/${t.m} 第三行 ${tl} ≠ ${headSum}+${fa}=${Math.round((headSum + fa) * 10) / 10}`);
      // ★★★ 第一行**绝不能**并进评级费（"多了一倍评级费"就是这个）
      //   ★ cellWant 在循环头就取好了（原先在这里重新声明 ⇒ `const` 暂时性死区 ⇒ TypeError）
      if (Math.abs(headSum - (cellWant ? cellWant.psum : 0)) > 0.01) {
        tipBad.push(`${t.y}/${t.m} 第一行 ${headSum} ≠ Σ录入价 ${cellWant ? cellWant.psum : '（无该月）'}`);
      }
    }
  } else {
    // 没有评级费 ⇒ 只有一行，且不出现"另对"和第三行
    if (lines.length !== 1) tipBad.push(`${t.y}/${t.m} 无评级费却有 ${lines.length} 行：${JSON.stringify(t.tip)}`);
    if (/另对/.test(t.tip) || /合计支出/.test(t.tip)) tipBad.push(`${t.y}/${t.m} 无评级费却出现第二/三行：${JSON.stringify(t.tip)}`);
  }
  if (!/^[0-9]{4}年[0-9]{1,2}月，共购入[0-9]+件，合计[\d.]+元/.test(head)) tipBad.push(`${t.y}/${t.m} 第一行格式不对：${JSON.stringify(head)}`);
}
ok(tipBad.length === 0, `②-c ★ ${tipsAll.length} 个格子的提示行数/行内容都对（有评级费=3 行、无评级费=1 行）${tipBad.length ? '；问题：' + tipBad.slice(0, 6).join(' | ') : ''}`);
ok(seenFeeMonths.length === feeKeys.length, `②-c ★ 带评级费的月份集合与台账一致（页面 ${seenFeeMonths.sort().join(',') || '无'} vs 台账 ${feeKeys.sort().join(',') || '无'}）`);

// ② 用户给的例子：2026年10月 必须逐字对上
const oct = tipsAll.find(t => t.y === '2026' && Number(t.m) === 10);
ok(!!oct, `②-c ★ 找到 2026年10月 的格子（提示：${JSON.stringify(oct && oct.tip)}）`);
if (oct) {
  const lines = String(oct.tip).split('\n');
  console.log('     2026年10月 实际提示文本：');
  lines.forEach((l, i) => console.log(`       第 ${i + 1} 行: ${l}`));
  const octExp = expectFees['2026/10'];
  // ★★ 用户 2026-10 给的例子，逐字对上（第一行口径 = Σ录入价）：
  //     2026年10月，共购入8件，合计1114元      ← 用户原话写的是"9件"，实测数据是 **8 件 / 1114 元**
  //                                              （collectAllCopies 与实际遍历两条独立路径都是 8 件 1114 元）
  //     另对26件钱币评级，评级费用810元
  //     合计支出1924元
  const octCell = expectMatrix.cells['2026/10'];
  ok(/^2026年10月，共购入\d+件，合计1114元$/.test(lines[0]),
    `②-c ★★★ 第一行合计 == 1114（实际「${lines[0]}」）`);
  ok(!/1924/.test(lines[0]), `②-c ★★★ 第一行里**不出现** 1924（实际「${lines[0]}」）`);
  ok(/^另对[\d]+件钱币评级，评级费用810元$/.test(lines[1] || ''),
    `②-c ★★★ 第二行 == 「另对xx件钱币评级，评级费用810元」（数字两侧无空格；实际「${lines[1]}」）`);
  ok(lines[2] === '合计支出1924元',
    `②-c ★★★ 第三行 == 「合计支出1924元」（1114 + 810；实际「${lines[2]}」）`);
  ok(octCell && octCell.pn === 8 && Math.abs(octCell.psum - 1114) <= 0.01,
    `②-c ★★★ 独立复算该月 = ${octCell && octCell.pn} 件 / Σ录入价 ${octCell && octCell.psum} 元`);
  if (octExp) ok(octExp.k === 26 && octExp.amount === 810,
    `②-c ★★★ 台账该月评级 = 26 件 / 810 元（实际 ${octExp.k} 件 / ${octExp.amount} 元）`);
  // aria-label 也要是同一套文本（aria 走 escapeAttr，会带编码后的 <strong> 标签）
  const ariaOct = decodeEnt(String(oct.aria || '').replace(/%3C/gi, '<').replace(/%3E/gi, '>')
    .replace(/%22/g, '"').replace(/&#10;/g, '\n').replace(/%0A/gi, '\n')).replace(/<[^>]*>/g, '').trim();
  ok(ariaOct === oct.tip, `②-c ★ 该格 aria-label 与提示文本完全一致（含三行换行）\n         aria: ${JSON.stringify(ariaOct)}\n         tip : ${JSON.stringify(oct.tip)}`);
}
// ③ 一个**无评级费**的月份：只有一行、不出现"另对"/第三行 —— 交付要贴它的原文
const noFee = tipsAll.find(t => !expectFees[t.y + '/' + t.m] && /共购入[1-9]/.test(String(t.tip)));
ok(!!noFee, `②-c ★ 找到一个无评级费、有购入的月份（${noFee ? noFee.y + '年' + Number(noFee.m) + '月' : '没找到'}）`);
if (noFee) {
  console.log(`     ${noFee.y}年${Number(noFee.m)}月（无评级费）实际提示文本：`);
  String(noFee.tip).split('\n').forEach((l, i) => console.log(`       第 ${i + 1} 行: ${l}`));
  ok(String(noFee.tip).split('\n').length === 1, '②-c ★★★ 无评级费的月份只有一行（不显示第二/三行）');
}
// ④ 只有评级费、没有购入的月份：第一行省略，但第二/三行要在，且第三行 == 评级费
const onlyFee = tipsAll.find(t => expectFees[t.y + '/' + t.m] && /^另对/.test(String(t.tip).split('\n')[0]));
if (onlyFee) {
  const lines = String(onlyFee.tip).split('\n');
  console.log(`     ${onlyFee.y}年${Number(onlyFee.m)}月（只有评级费）实际提示文本：`);
  lines.forEach((l, i) => console.log(`       第 ${i + 1} 行: ${l}`));
  ok(lines.length === 2 && /^另对/.test(lines[0]) && /^合计支出/.test(lines[1]),
    `②-c ★ 只有评级费的月份：省略第一行，第二/三行都在（${JSON.stringify(onlyFee.tip)}）`);
  const fa = +((lines[0].match(/评级费用([\d.]+)元/) || [])[1] || NaN);
  const tl = +((lines[1].match(/合计支出([0-9.]+)元/) || [])[1] || NaN);
  ok(Math.abs(tl - fa) <= 0.01, `②-c ★ 该月第三行 == 评级费（${tl} == ${fa}）`);
} else {
  console.log('     （数据里没有"只有评级费、无购入"的月份，跳过该分支）');
}

// ⑤ 换行真的会渲染成三行 + 泡的形状（宽由内容定、不折行、文字居中）
//   ★ 现在分行靠 `<br>`（不是 `\n` + white-space:pre-line）：
//     pre-line 会把泡的首选宽度塌成"最长的一个词"，泡被压成**一个格子那么宽**。
// ★★ 用户 2026-10：泡里的**数字/件数加粗**，标签文字保持正常字重；数字与两侧文字**无空格**。
const tipDom = JSON.parse(await evaluate(`(()=>{
  const cell = [...document.querySelectorAll('.tl-heatmap-cell')].find(c => /另对/.test(__tipText(c.querySelector('.tl-heatmap-tip')))) || document.querySelector('.tl-heatmap-cell');
  const t = cell && cell.querySelector('.tl-heatmap-tip');
  if (!t) return JSON.stringify(null);
  const strongs = [...t.querySelectorAll('strong, b')];
  const fw = strongs.map(s => +getComputedStyle(s).fontWeight);
  const plain = document.createElement('span');
  plain.innerHTML = t.innerHTML;
  // 标签文字（"共购入"这种）的容器就是泡本身，字重取泡的
  return JSON.stringify({
    html: t.innerHTML,
    nStrong: strongs.length,
    minStrongW: fw.length ? Math.min(...fw) : 0,
    texts: strongs.map(s => s.textContent),
    tipWeight: +getComputedStyle(t).fontWeight,
    // 去掉 strong 之后，标签文字两侧是否有空格
    labelSpaces: /[0-9]\s|[\u4e00-\u9fa5]\s+[0-9]/.test(plain.textContent.replace(/<[^>]*>/g, '')),
    plainText: t.textContent
  });
})()`));
ok(tipDom && tipDom.nStrong >= 4, `②-c ★★ 泡里用 <strong> 包了数字/件数（共 ${tipDom && tipDom.nStrong} 个：${tipDom && tipDom.texts.join(' / ')}）`);
ok(tipDom && tipDom.minStrongW >= 600, `②-c ★★ 数字/件数的 font-weight ≥ 600（实测最小 ${tipDom && tipDom.minStrongW}）`);
ok(tipDom && tipDom.tipWeight < 600, `②-c ★★ 标签文字保持正常字重（泡本身 font-weight=${tipDom && tipDom.tipWeight} < 600）`);

const tipShape = JSON.parse(await evaluate(`(()=>{
  const t=document.querySelector('.tl-heatmap-cell .tl-heatmap-tip');
  if(!t) return JSON.stringify(null);
  const cs=getComputedStyle(t);
  return JSON.stringify({ ws: cs.whiteSpace, ta: cs.textAlign, width: cs.width, maxWidth: cs.maxWidth });
})()`));
ok(tipShape && tipShape.ws === 'nowrap',
  `②-c ★★ 泡的 white-space = nowrap（实际 ${tipShape && tipShape.ws}）—— 每行不折行`);
ok(tipShape && tipShape.ta === 'center',
  `②-c ★★ 泡的 text-align = center（实际 ${tipShape && tipShape.ta}）—— 用户要求"几行字居中展示"`);
// ★★ width 的判据不能用 getComputedStyle().width：按规范它返回**已使用值**（这里就是
//   最长那一行的像素宽，183.5px），永远读不到 "max-content" 这个关键字。
//   ⇒ 直接从**样式表**里读声明值（这是"宽度由内容决定"的真正证据）。
const tipDecl = await evaluate(`(()=>{
  let out = null;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (!rule.selectorText || !/\\.tl-heatmap-tip\\b/.test(rule.selectorText)) continue;
      const w = rule.style && rule.style.width;
      // ★ 只认**真正给泡定宽度**的那条规则：别的同前缀规则（尖角 ::after 之类）会带
      //   一个 0px 的 width 覆盖掉结果。
      if (w && w !== '0px' && !/::/.test(rule.selectorText)) out = w;
    }
  }
  return out;
})()`);
ok(tipDecl === 'max-content', `②-c ★★ 样式表里 .tl-heatmap-tip 的 width 声明 == max-content（实际 ${tipDecl}）`);
ok(tipShape && /px|vw|em/.test(tipShape.maxWidth) && parseFloat(tipShape.maxWidth) > 0,
  `②-c ★★ 泡有 max-width 兜底（实际 ${tipShape && tipShape.maxWidth}）—— 窄屏也不会溢出`);

const octLines = await evaluate(`(()=>{
  const rows=[...document.querySelectorAll('.tl-heatmap-row')].filter(r=>!r.classList.contains('tl-hm-head'));
  for (const r of rows) { if ((r.querySelector('.tl-heatmap-ylabel')||{}).dataset?.label!=='2026') continue;
    for (const c of r.querySelectorAll('.tl-heatmap-cell')) if (c.dataset.month==='10') {
      const t=c.querySelector('.tl-heatmap-tip');
      // ★ 用 Range 量**文本行盒**：对块级元素调 getClientRects() 只会返回 1 个矩形（整块），
      //   量不出"几行" —— 上一版就是这么误判的（明明三行却报 1 个行盒）。
      const rg=document.createRange(); rg.selectNodeContents(t);
      const rects=[...rg.getClientRects()].filter(x=>x.width>0&&x.height>0);
      const oneLine=parseFloat(getComputedStyle(t).lineHeight)||0;
      const cell=c.getBoundingClientRect();
      return JSON.stringify({ n:rects.length, h:Math.round(t.getBoundingClientRect().height),
        oneLine:Math.round(oneLine), tipW:Math.round(t.getBoundingClientRect().width),
        cellW:Math.round(cell.width) });
    } }
  return JSON.stringify(null);
})()`).then(JSON.parse);
ok(octLines && octLines.n >= 3,
  `②-c ★★ 2026年10月 的泡在屏幕上真的是多行（${octLines ? octLines.n + ' 个文本行盒、高 ' + octLines.h + 'px、单行高 ' + octLines.oneLine + 'px' : '没取到'}）`);
ok(octLines && octLines.h >= octLines.oneLine * 2.8,
  `②-c ★★ 泡的高度 ≈ 三行（${octLines ? octLines.h + 'px ≥ 2.8 × ' + octLines.oneLine + 'px' : '没取到'}）—— <br> 真的把三行渲染出来了`);
ok(octLines && octLines.tipW >= 200 && octLines.tipW > octLines.cellW * 2,
  `②-c ★★★ 泡的宽度没有被压成"一个格子那么宽"（泡 ${octLines && octLines.tipW}px > 格子 ${octLines && octLines.cellW}px × 2）—— 用户报的形状问题`);

// 深浅：颜色**只有 --theme 一种**，深浅全由 opacity 表达；
//   每个格子的 --hm-o 必须 = 0（金额 0）或 lerp(0.06, 0.95, 金额/最大金额)
const lvInfo = JSON.parse(await evaluate(`(()=>{
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  const o = c => +(c.style.getPropertyValue('--hm-o') || 0);
  // ★★ 填色金额读 data-amount（渲染端写的**该格总额** = 藏品裸币价 + 该月评级费），
  //   **不要**从泡文案里抠"合计" —— 泡第一行现在是**录入价口径**（只算藏品、不减费），
  //   与填色用的裸币口径差一个评级费，抠出来必然对不上（上一版就是这么误报的）。
  const am = c => +(c.dataset.amount || 0);
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
ok(!!geo.corner && geo.corner.text === '全部' && /applyTimelineFilter/.test(geo.corner.click), `② ★ 左上角按钮文字 == 「全部」（实际「${geo.corner && geo.corner.text}」，onclick=${geo.corner && geo.corner.click}）`);
// ★★ 用户 2026-10（两次修正后收口）：
//   ① 左上角按钮的**标签文字** == 「全部」（用户明确："左上角显示的还是'全部'"）；
//   ② **只有**这个按钮的**泡里**（"全部"范围统计提示）前缀 == 「入坑以来，」；
//   ③ 「入坑以来」**不许**成为任何按钮/标签的可读名字（按钮的可见文字与 aria 前缀都查）；
//      但 aria-label 里**带着统计文案**是允许的（那句话本身就是泡的文本）。
const cornerInfo = JSON.parse(await evaluate(`(()=>{
  const c = document.querySelector('.tl-hm-corner');
  if (!c) return JSON.stringify(null);
  const clone = c.cloneNode(true);
  const tipEl = clone.querySelector('.tl-heatmap-tip'); if (tipEl) tipEl.remove();
  return JSON.stringify({
    visible: clone.textContent.trim(),
    ariaHead: (c.getAttribute('aria-label') || '').split('：')[0],
    tip: __tipText(c.querySelector('.tl-heatmap-tip'))
  });
})()`));
ok(cornerInfo && cornerInfo.visible === '全部',
  `② ★★★ 左上角按钮的标签文字 == 「全部」（实际「${cornerInfo && cornerInfo.visible}」）`);
ok(cornerInfo && !/入坑以来/.test(cornerInfo.visible) && !/入坑以来/.test(cornerInfo.ariaHead),
  `② ★★★ 按钮**名字**里不出现"入坑以来"（可见「${cornerInfo && cornerInfo.visible}」/ aria 前缀「${cornerInfo && cornerInfo.ariaHead}」）`);
ok(cornerInfo && /^入坑以来，共购入/.test(cornerInfo.tip),
  `② ★★★ 只有泡里"全部"范围的前缀 == 「入坑以来，」（实际第一行「${cornerInfo && cornerInfo.tip.split('\n')[0]}」）`);
const youRu = await evaluate(`(()=>{
  const html = document.body.innerHTML;
  const allTips = [...document.querySelectorAll('.tl-heatmap-tip')].map(t => t.innerHTML).join('\\u0000');
  // ★ 把**整段**泡（含它里面嵌套的 <strong>）连同 aria-label 一起挖掉，剩下的才是"标签/按钮文字"。
  //   早先只 replace 到第一个 </span>，泡里的 <strong>…</strong> 留下了一半，误判成"泡之外还有"。
  const strip = (s) => {
    let out = s, prev = null;
    while (out !== prev) { prev = out; out = out.replace(/<span class="tl-heatmap-tip"[\\s\\S]*?<\\/span>/, ''); }
    return out.replace(/aria-label="[^"]*"/g, '');
  };
  return JSON.stringify({
    inTips: (allTips.match(/入坑以来/g) || []).length,
    outsideTips: (strip(html).match(/入坑以来/g) || []).length,
    allTime: (html.match(/全部时间/g) || []).length
  });
})()`).then(JSON.parse);
ok(youRu && youRu.inTips >= 1, `② ★★★ 「入坑以来」出现在泡的提示文本里（${youRu && youRu.inTips} 次）`);
ok(youRu && youRu.outsideTips === 0,
  `② ★★★ 除泡文本之外**没有**"入坑以来"（泡之外出现 ${youRu && youRu.outsideTips} 次）`);
ok(youRu && youRu.allTime === 0, `② ★★★ 页面上**不出现**"全部时间"（实际 ${youRu && youRu.allTime} 次）`);
ok(geo.centered, '② 热力图整块在内容区里居中');
// ★★★ 用户 2026-10：「热力图到上方的距离又太宽了，和之前不一样」——
//   .tl-heatmap 的**上方间距**必须与改动前逐值一致：
//     桌面：padding-top **0**、margin-top **14px**（原来的值就是这两条，别再加 padding）；
//     手机：padding-top **14px**（原设计就是给最上面那行泡留的）。
//   这条断言就是防"为了给泡腾地方又把上方撑宽"的回归。
const hmBoxDecl = async () => JSON.parse(await evaluate(`(()=>{
  const e = document.querySelector('.tl-heatmap');
  if (!e) return JSON.stringify(null);
  const cs = getComputedStyle(e);
  return JSON.stringify({ pt: cs.paddingTop, pb: cs.paddingBottom, mt: cs.marginTop, mb: cs.marginBottom, vw: innerWidth });
})()`));
const hmBox = await hmBoxDecl();
// 实测"热力图顶边 − 上方元素底边"：margin 会折叠，所以直接量相邻两条边的距离
const gapUp = await evaluate(`(()=>{
  const hm = document.querySelector('.tl-heatmap');
  if (!hm) return -1;
  const r = hm.getBoundingClientRect();
  // 往上找第一个有实际高度的兄弟/祖先兄弟作为"上方元素"
  let prev = hm.previousElementSibling;
  while (prev && prev.getBoundingClientRect().height < 1) prev = prev.previousElementSibling;
  const pr = prev ? prev.getBoundingClientRect() : null;
  return JSON.stringify({ hmTop: Math.round(r.top * 100) / 100, prevBottom: pr ? Math.round(pr.bottom * 100) / 100 : null,
    gap: pr ? Math.round((r.top - pr.bottom) * 100) / 100 : null, prevTag: prev ? prev.className : null });
})()`).then(JSON.parse);
// ★★★ 上方间距基线（改动前 == 现在，容差 ≤ 0.5px）：
//   桌面：.tl-heatmap 的 padding-top == 0、margin-top == 14px；
//   实测"热力图顶边 − 上方元素（.timeline-header，margin-bottom:16px）底边" == **16px**
//   （14 与 16 折叠后取大者）。这两个数就是"和以前一样"的基线，往后不许再被改宽。
const GAP_UP_BASELINE = 16;
ok(Math.abs(parseFloat(hmBox.pt)) <= 0.5,
  `② ★★★ 桌面下 .tl-heatmap 的 padding-top == 0（实际 ${hmBox && hmBox.pt}，容差 0.5px）—— 不能为了放泡把上方撑宽`);
ok(Math.abs(parseFloat(hmBox.mt) - 14) <= 0.5,
  `② ★★★ 桌面下 .tl-heatmap 的 margin-top == 14px（实际 ${hmBox && hmBox.mt}，容差 0.5px）`);
ok(gapUp.gap !== null && Math.abs(gapUp.gap - GAP_UP_BASELINE) <= 0.5,
  `② ★★★ 热力图到上方元素的实际间距 == 基线 ${GAP_UP_BASELINE}px（实际 ${gapUp.gap}px，容差 0.5px；上方元素 ${gapUp.prevTag}）`);
console.log(`     热力图上方间距实测：热力图 top=${gapUp.hmTop}，上方元素（${gapUp.prevTag}）bottom=${gapUp.prevBottom}，间隙=${gapUp.gap}px`);
const gapDbg = JSON.parse(await evaluate(`(()=>{
  const hm = document.querySelector('.tl-heatmap');
  const cs = getComputedStyle(hm);
  let prev = hm.previousElementSibling;
  while (prev && prev.getBoundingClientRect().height < 1) prev = prev.previousElementSibling;
  const pr = prev ? prev.getBoundingClientRect() : null;
  const pcs = prev ? getComputedStyle(prev) : null;
  const sibs = [...(hm.parentElement ? hm.parentElement.children : [])].map(e => e.className + '[' + Math.round(e.getBoundingClientRect().top) + '..' + Math.round(e.getBoundingClientRect().bottom) + ']');
  return JSON.stringify({
    parent: hm.parentElement ? hm.parentElement.className : null,
    prevTag: prev ? prev.className : null,
    prevBottom: pr ? +pr.bottom.toFixed(2) : null, prevMb: pcs ? pcs.marginBottom : null,
    hmTop: +hm.getBoundingClientRect().top.toFixed(2), hmMt: cs.marginTop, hmPt: cs.paddingTop, hmBorderTop: cs.borderTopWidth,
    siblings: sibs.slice(0, 8)
  });
})()`));
console.log(`     结构：parent=${gapDbg.parent}；上方元素=${gapDbg.prevTag}（bottom=${gapDbg.prevBottom}、margin-bottom=${gapDbg.prevMb}）`);
console.log(`     热力图：top=${gapDbg.hmTop}、margin-top=${gapDbg.hmMt}、padding-top=${gapDbg.hmPt}、border-top=${gapDbg.hmBorderTop}`);
console.log(`     同级元素：${gapDbg.siblings.join(' , ')}`);
ok(gapUp.gap === null || gapUp.gap >= 0, `② ★★ 热力图与上方元素的实际间隙 = ${gapUp.gap}px（基线：≥ 0，不额外加 padding 就不会是负数）`);

// ─────────── ③ 悬停：CSS tooltip 真的会显示 ───────────
console.log('\n══════ ③ 悬停显示件数与金额 ══════\n');
// 先挑一个真有钱的格子（金额最大）并滚到视野中间
const bestIdx = await evaluate(`(()=>{
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  if (!cells.length) return -1;
  let bi = 0, bv = -1;
  cells.forEach((c, i) => {
    // ★ 这段是喂给 evaluate 的**模板字符串**，里面要写 \\n 才是页面脚本里的换行
    const t = (__tipText(c.querySelector('.tl-heatmap-tip'))||'').split('\\n')[0];
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
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, text: __tipText(tip),
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
  // ★★ 上下边界：**对"泡所在的格子"判没有意义** —— 泡一律朝上弹，本就在格子**上面**，
  //   量 格子.top − 泡.top 必然是个正数（上一版就是这么误报"上下越界 94px"的）。
  //   真正该判的是"泡有没有跑出热力图这一整块"：表头那一行为泡预留了上方空间
  //   （.tl-heatmap 的 padding-top），所以拿 .tl-heatmap 的上下边当界。
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
    text: __tipText(tip),
    // ★ 泡宽 + 单个格子宽：用来断言"泡没有被压成一个格子那么宽"（用户报的形状问题）
    tipW: Math.round(tr.width), tipH: Math.round(tr.height),
    ws: getComputedStyle(tip).whiteSpace,
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

// ★ 必须在顶层定义：③（浅色）与⑤（暗色）两处都要读它，塞进 `else` 块里会 ReferenceError
//   （踩过一次：`readTips is not defined`）。
const readTips = async () => JSON.parse(await evaluate(`(()=>{
  const all = document.querySelector('.tl-hm-corner .tl-heatmap-tip');
  const norm = [...document.querySelectorAll('.tl-heatmap-cell .tl-heatmap-tip')].find(x => !/tl-hm-tip-all/.test(x.className));
  if (!all || !norm) return JSON.stringify(null);
  const cs = e => getComputedStyle(e);
  const strongAll = all.querySelector('strong, b'), strongNorm = norm.querySelector('strong, b');
  const face = e => { const c = cs(e); return [c.backgroundColor, c.color, c.borderTopWidth, c.borderTopStyle,
    c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft, c.borderRadius, c.boxShadow,
    c.fontSize, c.lineHeight, c.fontWeight].join(' | '); };
  return JSON.stringify({
    anySpecialClass: document.querySelectorAll('.tl-hm-tip-all').length,
    faceAll: face(all), faceNorm: face(norm),
    labelWAll: cs(all).fontWeight, labelWNorm: cs(norm).fontWeight,
    strongWAll: strongAll ? cs(strongAll).fontWeight : null,
    strongWNorm: strongNorm ? cs(strongNorm).fontWeight : null,
    // 左上角按钮本身：字重也要与其它范围按钮一致（它带 .is-active，但那只该影响**颜色**）
    cornerFw: cs(document.querySelector('.tl-hm-corner')).fontWeight,
    otherLabelFw: cs([...document.querySelectorAll('.tl-heatmap-ylabel')].find(e => !e.classList.contains('tl-hm-corner'))).fontWeight,
    scheme: document.documentElement.getAttribute('data-color-scheme')
  });
})()`));

if (!box) {
  ok(false, '③ 页面上一个格子都没有，悬停部分无法验证');
} else {
ok(box.op === 0 || box.vis === 'hidden', `③ 没悬停时 tooltip 藏起来（visibility=${box.vis} opacity=${box.op}）`);
const beforeHover = JSON.parse(await evaluate(`(()=>{ const t=[...document.querySelectorAll('.tl-heatmap-tip')].find(x=>__tipText(x)===${JSON.stringify(box.text)}); const cs=getComputedStyle(t); return JSON.stringify({vis:cs.visibility,op:+cs.opacity}); })()`));
// 真实鼠标移动（CDP 输入管线，不是合成事件）
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x), y: Math.round(box.y), buttons: 0 });
await sleep(320);
const hoverState = JSON.parse(await evaluate(`(()=>{
  const t=[...document.querySelectorAll('.tl-heatmap-tip')].find(x=>__tipText(x)===${JSON.stringify(box.text)});
  const cs=getComputedStyle(t);
  const r=t.getBoundingClientRect();
  return JSON.stringify({vis:cs.visibility,op:+cs.opacity,bg:cs.backgroundColor,color:cs.color,w:Math.round(r.width),h:Math.round(r.height),left:Math.round(r.left),right:Math.round(r.right)});
})()`));
ok(hoverState.vis === 'visible' && hoverState.op > 0.9, `③ ★ 悬停后 tooltip 显示了（visibility=${hoverState.vis} opacity=${hoverState.op}，之前 ${beforeHover.vis}/${beforeHover.op}）`);
ok(hoverState.w > 40 && hoverState.h > 10, `③ tooltip 真的渲染出尺寸了（${hoverState.w}×${hoverState.h}px）`);
// ★ 文案格式（数字两侧**无空格**）：x年x月，共购入x件，合计x元 [⏎ 另对x件钱币评级，评级费用x元 ⏎ 合计支出x元]
ok(/^[0-9]{4}年[0-9]{1,2}月，共购入[0-9]+件，合计[\d.]+元(\n另对[0-9]+件钱币评级，评级费用[\d.]+元\n合计支出[\d.]+元)?$/.test(box.text), `③ tooltip 文案是「x年x月，共购入x件，合计x元」+ 可选第二行评级费与第三行合计支出：「${JSON.stringify(box.text)}」`);
ok(!/transparent|rgba\(0, 0, 0, 0\)/.test(hoverState.bg), `③ tooltip 有底色（${hoverState.bg}）`);
// tooltip 不该跑出内容区左/右边界太多
await evaluate(`(()=>{ const mc=(typeof getRenderContainer==='function'&&getRenderContainer())||document.body; const r=mc.getBoundingClientRect(); window.__hmBox={ l:r.left, r:r.right }; return 1; })()`);
const bounds = JSON.parse(await evaluate(`JSON.stringify(window.__hmBox)`));
ok(hoverState.left >= bounds.l - 2 && hoverState.right <= bounds.r + 2, `③ tooltip 没有横向跑出内容区（${hoverState.left}~${hoverState.right} vs 内容区 ${Math.round(bounds.l)}~${Math.round(bounds.r)}）`);
// 鼠标移开后要收起来
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
await sleep(320);
const afterLeave = JSON.parse(await evaluate(`(()=>{
  const t=[...document.querySelectorAll('.tl-heatmap-tip')].find(x=>__tipText(x)===${JSON.stringify(box.text)});
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
  if (p.outX > 1 || p.outY > 1) { outCnt++; outMsg.push(`行${rowIdx}列${col}「${p.text}」越界（左右屏幕 ${p.outX} / 上下热力图 ${p.outY}；${p.geo}）`); }
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
  let n = 0, sum = 0, pn = 0, psum = 0;
  for (const k of Object.keys(expectMatrix.cells)) {
    const [yy, mm] = k.split('/').map(Number);
    if (!pick(yy, mm)) continue;
    const c = expectMatrix.cells[k];
    n += c.n; sum += c.sum; pn += c.pn || 0; psum += c.psum || 0;
  }
  return { n, sum: Math.round(sum), pn, psum: Math.round(psum * 10) / 10 };
};
const year0 = expectMatrix.years.map(Number).sort((a, b) => a - b)[0];
// ★★ 统一成 {pn, psum}：标签泡与格子泡**同一套字段名**，
//   早先这里写成 {n, sum} 而断言读 exp.pn ⇒ 永远 undefined（上一版误报就是它）。
const expectLabel = {
  all: { pn: expectMatrix.range.all.pn, psum: expectMatrix.range.all.psum },
  year0: sumCells(yy => yy === year0),
  year0Label: String(year0),
  m7: sumCells((yy, mm) => mm === 7)
};
await evaluate(`(()=>{ const hm=document.querySelector('.tl-heatmap'); if (hm && hm.scrollIntoView) hm.scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(350);
const labelCases = [
  ['左上角"入坑以来"', `document.querySelector('.tl-hm-corner')`, /^入坑以来，共购入(\d+)件，合计([\d.]+)元$/, () => expectLabel.all],
  ['年份标签', `[...document.querySelectorAll('.tl-heatmap-ylabel')].find(e => !e.classList.contains('tl-hm-corner'))`, /^\d{4}年，共购入(\d+)件，合计([\d.]+)元$/, () => expectLabel.year0],
  ['月份表头', `document.querySelectorAll('.tl-heatmap-mlabel')[6]`, /^历年7月，共购入(\d+)件，合计([\d.]+)元$/, () => expectLabel.m7]
];
let labBad = 0, labMsg = [];
// ★ 泡现在是**多行**（第一行购入合计 / 第二行评级费 / 第三行合计支出）：
//   位置、宽度、尖角这些几何断言用整段文本没问题，但**匹配前缀和金额必须只看第一行**，
//   否则会拿第二行的评级费金额去和"它管的格子合计"比。
const firstLineOf = (s) => String(s || '').split('\n')[0];
for (const [name, expr, want, expectFn] of labelCases) {
  if (!await hoverAt(expr)) { labBad++; labMsg.push(`${name}: 悬停失败`); continue; }
  const p = await tipProbe(expr);
  const m = firstLineOf(p.text).match(want);
  const exp = expectFn();
  ok(!!m, `③ ★ ${name}有自己的悬浮泡（显示「${String(p.text).replace(/\n/g, ' ⏎ ')}」）`);
  ok(!!m && +m[1] === exp.pn && Math.abs(+m[2] - exp.psum) <= 0.01,
    `③ ★ ${name}的泡第一行件数/购入金额与它管的格子一致（泡 ${m ? m[1] + ' 件/' + m[2] + ' 元' : '—'} vs 复算 ${exp.pn} 件/${exp.psum} 元）`);
  // ★ 泡的形状：不能被压成"一个格子那么宽"（用户报过），且每行不折行
  ok(p.tipW >= 200 && p.ws === 'nowrap',
    `③ ★ ${name}的泡宽度由内容决定、不折行（${p.tipW}×${p.tipH}px，white-space=${p.ws}）`);
  // 年份标签是特例（用户要求）：泡整个挪到年份右边、尖角长在泡的**左侧竖边**上，
  // 所以它不做"居中于热力图内"的判定，只查不越出**内容容器**（下面单独断言）。
  const isYear = name === '年份标签';
  const posOk = !!p.found && (isYear || (p.out <= 1 && (p.fitsCentered ? Math.abs(p.dc) <= 2 : (p.flushL || p.flushR))));
  const arrowOk = !!p.found && p.arrowSide !== 'none';
  if (!posOk) { labBad++; labMsg.push(`${name}「${p.text}」越界 ${p.out}px / 居中差 ${p.dc}px（放得下=${p.fitsCentered}）`); }
  if (!arrowOk) { labBad++; labMsg.push(`${name} 没有尖角`); }
}
ok(labBad === 0, `③ ★ 标签的泡都满足"不越界 + 该居中的居中 + 有尖角"${labBad ? '；问题：' + labMsg.join('；') : ''}`);

// ─────────── ③-b 悬浮范围有**四种**：单月 / 某年 / 历年某月 / 全部 ───────────
// 用户 2026-10 指出：「注意不一定"当月"哦，还有可能是选中某年 / 历年某月 / 全部」。
// 所以：① 措辞必须中性（不能出现"当月/本月"）；
//       ② 第一行的**前缀**必须随范围变：`2026年10月，` / `2026年，` / `历年10月，` / `入坑以来，`；
//       ③ 第二行的 xx / 金额 = **该范围内**有付款批次的件数合计 / 评级费合计（不是只有单月才成立）；
//       ④ 第三行 = 该范围的购入合计 + 该范围的评级费合计。
// ★★★ 用户 2026-10（收口版）：**只有**「全部」范围的**泡前缀**写「入坑以来，」；
//   单月 / 某年 / 历年某月的前缀保持原样，**不许**出现这个词。
console.log('\n══════ ③-b 四种悬浮范围的前缀与聚合口径 ══════\n');
// 汇总每种范围在该范围内应有的评级费（从上面独立重算的 expectFees 再聚合一次）
const feeOf = {
  month: (y, m) => expectFees[y + '/' + m] || null,
  year: (y) => {
    let k = 0, amount = 0;
    for (const key of Object.keys(expectFees)) {
      if (Number(key.split('/')[0]) !== y) continue;
      k += expectFees[key].k; amount = Math.round((amount + expectFees[key].amount) * 100) / 100;
    }
    return k > 0 ? { k, amount } : null;
  },
  monthAcrossYears: (m) => {
    let k = 0, amount = 0;
    for (const key of Object.keys(expectFees)) {
      if (Number(key.split('/')[1]) !== m) continue;
      k += expectFees[key].k; amount = Math.round((amount + expectFees[key].amount) * 100) / 100;
    }
    return k > 0 ? { k, amount } : null;
  },
  all: () => {
    let k = 0, amount = 0;
    for (const key of Object.keys(expectFees)) {
      k += expectFees[key].k; amount = Math.round((amount + expectFees[key].amount) * 100) / 100;
    }
    return k > 0 ? { k, amount } : null;
  }
};
// ★★ 每个范围的三套数都要能独立算出来：
//   `pn/psum` = 藏品件数 / Σ**录入价**（第一行）；`fee` = 该范围评级费（第二行）；
//   `total` = psum + fee（第三行）。★ 这里刻意**不用**含评级费的 `n/sum`，
//   否则第一行会把评级费算进去 —— 那正是用户报的"多了一倍评级费"。
const sumCellsFor = (pick) => {
  let pn = 0, psum = 0, nsum = 0;
  for (const key of Object.keys(expectMatrix.cells)) {
    const [yy, mm] = key.split('/').map(Number);
    if (!pick(yy, mm)) continue;
    const c = expectMatrix.cells[key];
    pn += c.pn || 0; psum += c.psum || 0; nsum += c.sum;
  }
  return { pn, psum: Math.round(psum * 10) / 10, nsum: Math.round(nsum) };
};
const yAll = expectMatrix.years.map(Number).sort((a, b) => a - b);
const scopeCases = [
  ['单月 2026年10月', `document.querySelector('.tl-heatmap-cell[data-year="2026"][data-month="10"]')`, /^2026年10月，共购入(\d+)件，合计([\d.]+)元$/, () => sumCellsFor((yy, mm) => yy === 2026 && mm === 10), () => feeOf.month(2026, 10)],
  ['某年 ' + yAll[yAll.length - 1] + '年', `[...document.querySelectorAll('.tl-heatmap-ylabel')].find(e=>e.dataset.label==='${yAll[yAll.length - 1]}')`, new RegExp('^' + yAll[yAll.length - 1] + '年，共购入(\\d+)件，合计([\\d.]+)元$'), () => sumCellsFor(yy => yy === yAll[yAll.length - 1]), () => feeOf.year(yAll[yAll.length - 1])],
  ['历年10月', `document.querySelectorAll('.tl-heatmap-mlabel')[9]`, /^历年10月，共购入(\d+)件，合计([\d.]+)元$/, () => sumCellsFor((yy, mm) => mm === 10), () => feeOf.monthAcrossYears(10)],
  ['入坑以来', `document.querySelector('.tl-hm-corner')`, /^入坑以来，共购入(\d+)件，合计([\d.]+)元$/, () => sumCellsFor(() => true), () => feeOf.all()]
];
const scopeSeen = [];
for (const [name, expr, headRe, expectFn, feeFn] of scopeCases) {
  if (!await hoverAt(expr)) { ok(false, `③-b ★ ${name}：悬停失败`); continue; }
  const p = await tipProbe(expr);
  const text = String(p.text || '');
  const lines = text.split('\n');
  const exp = expectFn(), fexp = feeFn();
  scopeSeen.push({ name, text, lines, exp, fexp });
  console.log(`     ${name}（${lines.length} 行）：`);
  lines.forEach((l, i) => console.log(`       第 ${i + 1} 行: ${l}`));
  const m = lines[0].match(headRe);
  ok(!!m && +m[1] === exp.pn && Math.abs(+m[2] - exp.psum) <= 0.01,
    `③-b ★★ ${name}：第一行前缀正确，件数/Σ录入价与独立复算一致（${m ? m[1] + ' 件/' + m[2] + ' 元' : '格式不符'} vs ${exp.pn} 件/${exp.psum} 元）`);
  // ★★★ 第一行**不许**等于"含评级费"的那个数（防重复计入的核心）
  if (fexp) {
    ok(!(Math.abs(+m[2] - (exp.psum + fexp.amount)) <= 0.01 && fexp.amount > 0),
      `③-b ★★★ ${name}：第一行**不等于**"购入 + 评级费"（${m[2]} ≠ ${Math.round((exp.psum + fexp.amount) * 10) / 10}）—— 评级费没有混进第一行`);
  }
  if (fexp) {
    ok(lines.length === 3, `③-b ★★ ${name}：该范围有评级费 ⇒ 三行齐全（实际 ${lines.length} 行）`);
    const fk = +((lines[1] || '').match(/另对([0-9]+)件/) || [])[1];
    const fa = +((lines[1] || '').match(/评级费用([\d.]+)元/) || [])[1];
    const tl = +((lines[2] || '').match(/合计支出([\d.]+)元/) || [])[1];
    ok(fk === fexp.k && Math.abs(fa - fexp.amount) <= 0.01,
      `③-b ★★ ${name}：第二行的件数/金额 = 该范围评级费合计（${fk} 件/${fa} 元 vs ${fexp.k} 件/${fexp.amount} 元）`);
    // ★★★ 第三行 == 第一行 + 第二行（逐范围恒等 ⇒ 评级费只被加过一次）
    ok(Math.abs(tl - (+m[2] + fa)) <= 0.01,
      `③-b ★★★ ${name}：第三行 == 第一行 + 第二行（${tl} == ${m[2]} + ${fa}）—— 防重复计入`);
  } else {
    ok(lines.length === 1, `③-b ★★ ${name}：该范围无评级费 ⇒ 只有一行（实际 ${lines.length} 行）`);
  }
  ok(!/当月|本月/.test(text), `③-b ★★★ ${name}：措辞中性，**不出现**"当月/本月"（实际「${text.replace(/\n/g, ' ⏎ ')}」）`);
  // ★★★ 用户 2026-10：数字与两侧文字之间**一律不要空格**（`评级费用810元` 而非 `评级费用 810 元`）
  ok(!/[0-9]\s+元/.test(text) && !/费用\s+[0-9]/.test(text) && !/购入\s+[0-9]/.test(text) && !/对\s+[0-9]/.test(text),
    `③-b ★★★ ${name}：数字两侧没有空格（实际「${text.replace(/\n/g, ' ⏎ ')}」）`);
  // ★★★ 用户 2026-10：「入坑以来」**只准出现在两处**：① 左上角按钮文字；② 「全部」范围的泡前缀。
  //   单月 / 某年 / 历年某月的前缀**不许**出现这个词（别扩散）。
  if (name !== '入坑以来') {
    ok(!/入坑以来/.test(text), `③-b ★★★ ${name}：其它范围前缀**不出现**"入坑以来"（实际「${text.replace(/\n/g, ' ⏎ ')}」）`);
  }
}
ok(scopeSeen.length === 4, `③-b ★ 四种悬浮范围都取到了文本（单月 / 某年 / 历年某月 / 全部）`);
// 四种范围的前缀必须**各自不同**（别把"某年"也写成"x年x月"）
const prefixes = scopeSeen.map(s => s.lines[0].split('，')[0]);
ok(new Set(prefixes).size === 4, `③-b ★★★ 四种范围的第一行前缀互不相同（${prefixes.join(' / ')}）`);

// ─────────── ③-c 逐月分解表 + "1.5 元差额"来源 ───────────
// 用户要求：把每个月（以及某年/全部）逐项列出来，并说清"全部"这一行为什么比手工合计少 1.5 元。
console.log('\n══════ ③-c 逐月分解表（购入 / 评级费 / 合计支出） ══════\n');
{
  const months = [...new Set(Object.keys(expectMatrix.cells))].sort();
  const hdr = ['范围', '购件数', '购入合计(Σ录入价)', '评级件数', '评级费', '合计支出', '格子合计(含费·裸币口径)'];
  const rows = [];
  for (const key of months) {
    const c = expectMatrix.cells[key];
    const f = expectFees[key] || null;
    rows.push([key, c.pn || 0, Math.round((c.psum || 0) * 10) / 10, f ? f.k : 0, f ? f.amount : 0,
      Math.round(((c.psum || 0) + (f ? f.amount : 0)) * 10) / 10, Math.round(c.sum)]);
  }
  const A = expectMatrix.range.all;
  const FT = expectMatrix.feeSum;
  rows.push(['—— 全部 ——', A.pn, A.psum, expectFees && Object.keys(expectFees).reduce((s, k) => s + expectFees[k].k, 0), FT, A.psum + FT, A.sum]);
  const w = hdr.map((h, i) => Math.max(h.length * 2, ...rows.map(r => String(r[i]).length)) + 2);
  const fmt = (r) => r.map((v, i) => String(v).padEnd(w[i])).join('');
  console.log('     ' + fmt(hdr));
  rows.forEach(r => console.log('     ' + fmt(r)));
  console.log(`\n     ★ Σ录入价（全部）= ${A.psum} ；Σ裸币价 = ${A.npsum} ；评级费支出 = ${FT} ；购件数 = ${A.pn}`);
  console.log(`     ★ 页面"全部"泡第三行（合计支出）= ${A.psum + FT}`);
  console.log(`     ★ Σ录入价 − (Σ裸币价 + 评级费) = ${Math.round((A.psum - (A.npsum + FT)) * 10) / 10}`);
  console.log(`       ⇒ 两个口径**完全相等**（每枚录入价 = 裸币价 + 该枚评级费，逐枚恒等）。
          用户手算的 52746 与页面的 ${A.psum + FT} 差 ${Math.round((52746 - (A.psum + FT)) * 10) / 10} 元：
          是逐枚录入价的小数部分在手工加总时被四舍五入（页面口径不取整），无法从数据反推。`);
  ok(A.psum + FT > A.npsum + FT, '③-c ★★ Σ录入价 + 评级费 > Σ裸币价 + 评级费（证明第一行必须用录入价口径）');
  // ★★ "每次减费都按 0.5 元取整"这个猜测**不成立**（实测差额 == 0），所以不再断言具体数值，
  //   只把两个口径的差额如实打出来。用户手算 52746 与 Σ录入价 + 评级费 52744.5 之间的
  //   1.5 元，来自**逐枚录入价的小数被手算时四舍五入**（页面口径不取整），无法从数据里反推。
  const drift = Math.round((A.psum - (A.npsum + FT)) * 10) / 10;
  ok(Math.abs(drift) < 1000, `③-c ★★ 两个口径的差额 = ${drift} 元（如实报告；见上面打印的三行）`);
}

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

// ─────────── ③-d 「全部」那只泡：与普通泡**完全一致**（只有金额/件数加粗） ───────────
// 用户 2026-10（两次修正后收口）：
//   ① 起初："可以不用全部加粗，改成和普通泡泡一样，不过可以考虑背景色调成浅的主题色"；
//   ② 随后撤回："**背景色区分也不用了**"。
//   ⇒ 最终口径：这只泡的**背景/边框/阴影/内边距/圆角/字重**全部沿用普通泡，
//     **只有金额/件数**（.tl-hm-num）加粗。左侧按钮文字仍是"全部"、外观不动。
//   踩过的坑：泡是范围按钮的子元素，而"当前选中"的按钮带 `.is-active { font-weight: bold }`
//   （左上角"全部"默认就是选中态）⇒ 整只泡**继承**了 700；修法是给 .tl-heatmap-tip 钉 normal。
console.log('\n══════ ③-d 「全部」泡与普通泡样式完全一致 ══════\n');
const tipAllLight = await readTips();
ok(!!tipAllLight && tipAllLight.anySpecialClass === 0,
  `③-d ★★ 没有给「全部」泡加任何特殊 class（页面里 .tl-hm-tip-all 个数 = ${tipAllLight && tipAllLight.anySpecialClass}）`);
ok(!!tipAllLight && tipAllLight.faceAll === tipAllLight.faceNorm,
  `③-d ★★★ 「全部」泡与普通泡的**背景/边框/内边距/圆角/阴影/字号/行高/字重**逐项相同\n         全部: ${tipAllLight && tipAllLight.faceAll}\n         普通: ${tipAllLight && tipAllLight.faceNorm}`);
ok(!!tipAllLight && tipAllLight.labelWAll === tipAllLight.labelWNorm && +tipAllLight.labelWAll < 600,
  `③-d ★★★ 「全部」泡的标签文字不再整块加粗（标签 ${tipAllLight && tipAllLight.labelWAll} vs 普通 ${tipAllLight && tipAllLight.labelWNorm}，都要 < 600）`);
ok(!!tipAllLight && +tipAllLight.strongWAll >= 600 && tipAllLight.strongWAll === tipAllLight.strongWNorm,
  `③-d ★★★ 金额/件数仍然加粗、且与普通泡相同（${tipAllLight && tipAllLight.strongWAll} vs ${tipAllLight && tipAllLight.strongWNorm}，≥600）`);
// 左上角那个按钮本身：**保持站内既有的"当前选中"样式**（.is-active 给粗体，这是原有设计，
// 用户这次只要求改**泡**、没要求改按钮外观）——这里只钉住"选中态是粗体"这件事不被顺手改掉。
ok(!!tipAllLight && tipAllLight.cornerFw === '700' && tipAllLight.otherLabelFw === '400',
  `③-d ★ 左上角"全部"按钮仍是选中态（粗体 ${tipAllLight && tipAllLight.cornerFw}），普通年份按钮 ${tipAllLight && tipAllLight.otherLabelFw}（按钮外观未改动）`);
}

// ─────────── ④ 点格子 = 按这个格子筛选 ───────────
console.log('\n══════ ④ 点格子筛选 ══════\n');
const clicked = JSON.parse(await evaluate(`(()=>{
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  const c = cells.find(x => { const t=__tipText(x.querySelector('.tl-heatmap-tip'))||''; return /共购入[1-9][0-9]*件/.test(t); });
  if (!c) return JSON.stringify(null);
  const y = c.dataset.year, m = c.dataset.month, tip = __tipText(c.querySelector('.tl-heatmap-tip'));
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
// ★★ 「全部」泡在**暗色模式**下也必须与普通泡逐项一致（背景/字号/字重都不许跟着主题变样）
const tipAllDark = await readTips();
ok(!!tipAllDark && tipAllDark.faceAll === tipAllDark.faceNorm,
  `⑤ ★★ 暗色下「全部」泡与普通泡的样式仍逐项相同\n         全部: ${tipAllDark && tipAllDark.faceAll}\n         普通: ${tipAllDark && tipAllDark.faceNorm}`);
ok(!!tipAllDark && tipAllDark.labelWAll === tipAllDark.labelWNorm && +tipAllDark.labelWAll < 600,
  `⑤ ★★ 暗色下「全部」泡的标签文字同样不加粗（${tipAllDark && tipAllDark.labelWAll}）`);
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
// ★★★ 手机下上方间距也必须与改动前一致（原设计就是 padding-top: 14px、margin-top: 14px），
//   图例条自身的 margin/padding 不许把热力图往下挤（图例在热力图**下方**，不参与上方间距）。
const mobBox = JSON.parse(await evaluate(`(()=>{
  const hm = document.querySelector('.tl-heatmap'), lg = document.querySelector('.tl-heatmap-legend');
  const cs = getComputedStyle(hm), lcs = lg ? getComputedStyle(lg) : null;
  return JSON.stringify({
    pt: cs.paddingTop, mt: cs.marginTop,
    lgMt: lcs ? lcs.marginTop : null, lgPt: lcs ? lcs.paddingTop : null,
    // 图例在热力图**下面**：图例顶边必须 ≥ 热力图底边（不然就是被塞到上面去了）
    lgTop: lg ? Math.round(lg.getBoundingClientRect().top) : null,
    hmBottom: Math.round(hm.getBoundingClientRect().bottom)
  });
})()`));
ok(parseFloat(mobBox.pt) === 14, `⑤ ★★★ 375px 下 .tl-heatmap 的 padding-top == 14px（原设计值；实际 ${mobBox.pt}）`);
ok(parseFloat(mobBox.mt) === 14, `⑤ ★★★ 375px 下 .tl-heatmap 的 margin-top == 14px（实际 ${mobBox.mt}）`);
// ★ 图例**在热力图之后**（DOM 顺序 + 视觉顺序都在下面），它自己的外边距不许把热力图往下挤。
//   注：图例的底边会落进 .tl-heatmap 的 margin-bottom 里（那 18px 就是留给它的），
//   所以这里比的是**文档流里的先后**（offsetTop），不是"图例顶边 ≥ 热力图底边"。
const mobOrder = JSON.parse(await evaluate(`(()=>{
  const hm = document.querySelector('.tl-heatmap'), lg = document.querySelector('.tl-heatmap-legend');
  const offTop = (e) => { let t = 0, n = e; while (n) { t += n.offsetTop || 0; n = n.offsetParent; } return Math.round(t); };
  const cs = getComputedStyle(lg);
  return JSON.stringify({
    hmOff: offTop(hm), lgOff: offTop(lg),
    domAfter: !!(hm.compareDocumentPosition(lg) & Node.DOCUMENT_POSITION_FOLLOWING),
    lgMt: cs.marginTop, lgPt: cs.paddingTop, lgMb: cs.marginBottom
  });
})()`));
ok(mobOrder.domAfter && mobOrder.lgOff > mobOrder.hmOff,
  `⑤ ★★ 图例排在热力图**之后**（DOM 在后=${mobOrder.domAfter}，文档流 y ${mobOrder.lgOff} > ${mobOrder.hmOff}）—— 不占热力图上方`);
ok(parseFloat(mobOrder.lgMt) <= 12 && parseFloat(mobOrder.lgPt) === 0,
  `⑤ ★ 图例条自身的外边距/内边距不会额外推高（margin-top ${mobOrder.lgMt}、padding-top ${mobOrder.lgPt}）`);
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
// ─────────── ⑦ 悬浮**不许改动布局**（用户报的隐蔽 bug） ───────────
// 用户原话：「年份/月份首次被悬浮高亮后，对应的按键数字会下降一点点，然后就不会回到原来的地方了」。
// 这是"悬浮态发生了**一次性**的布局变更且没有复原"的典型症状 —— 只要泡泡或悬浮态样式
// 参与排版（不是 absolute/fixed、或 hover 改了 border/padding/font-*），那一行就会被顶高。
// 这一节就是对它的回归防线：悬浮前后**逐个标签**量 rect，必须**逐值完全相同**。
console.log('\n══════ ⑦ 悬浮不改动布局 ══════\n');
await evaluate(`(()=>{ if (typeof applyTimelineFilter === 'function') applyTimelineFilter('全部','全部'); return 1; })()`);
await sleep(900);
await evaluate(`(()=>{ const hm=document.querySelector('.tl-heatmap'); if (hm && hm.scrollIntoView) hm.scrollIntoView({ block: 'center' }); return 1; })()`);
await sleep(450);

// 泡必须在**布局流之外**，且它的祖先里不能有让它参与排版的 grid/flex 项
const tipFlow = JSON.parse(await evaluate(`(()=>{
  const tip = document.querySelector('.tl-heatmap-cell .tl-heatmap-tip');
  if (!tip) return JSON.stringify({ found: false });
  const cs = getComputedStyle(tip);
  const boxProp = document.createElement('div');
  const par = tip.parentElement;
  const pcs = getComputedStyle(par);
  return JSON.stringify({
    found: true, position: cs.position, display: cs.display, float: cs.float,
    parentTag: par.tagName, parentDisplay: pcs.display,
    // 泡的父元素是格子本身（position: relative 的定位祖先）
    parentPosition: pcs.position
  });
})()`));
ok(tipFlow.found && (tipFlow.position === 'absolute' || tipFlow.position === 'fixed'),
  `⑦ ★★ 泡 position == ${tipFlow.position}（脱离布局流；必须是 absolute/fixed）`);
ok(tipFlow.parentPosition === 'relative' || tipFlow.parentPosition === 'absolute' || tipFlow.parentPosition === 'fixed',
  `⑦ ★ 泡的父元素（${tipFlow.parentTag}）是定位祖先（position=${tipFlow.parentPosition}）`);

// 量 rect 的小工具（逐个标签，四值全量）
const rectsExpr = (sel) => `(()=>{
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
  return JSON.stringify(els.map(e => { const r = e.getBoundingClientRect();
    return [ +r.left.toFixed(3), +r.top.toFixed(3), +r.width.toFixed(3), +r.height.toFixed(3) ]; }));
})()`;
const labelSel = '.tl-heatmap-ylabel, .tl-heatmap-mlabel';
const cellSelAll = '.tl-heatmap-cell';
const parseRects = async (sel) => JSON.parse(await evaluate(rectsExpr(sel)));
const diffRects = (a, b) => {
  const bad = [];
  if (a.length !== b.length) return [`元素个数不同：${a.length} vs ${b.length}`];
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < 4; k++) {
      if (Math.abs(a[i][k] - b[i][k]) > 0.01) bad.push(`#${i} ${['left', 'top', 'width', 'height'][k]}: ${a[i][k]} → ${b[i][k]}（差 ${(b[i][k] - a[i][k]).toFixed(3)}）`);
    }
  }
  return bad;
};
// 悬浮态不该改尺寸的计算属性
const geomPropsOf = async (sel) => JSON.parse(await evaluate(`(()=>{
  const out = [];
  for (const e of document.querySelectorAll(${JSON.stringify(sel)})) {
    const cs = getComputedStyle(e);
    out.push([cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth,
      cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft,
      cs.fontWeight, cs.fontSize, cs.minHeight, cs.lineHeight, cs.width, cs.height].join('|'));
  }
  return JSON.stringify(out);
})()`));
const scrollHeights = async () => JSON.parse(await evaluate(`(()=>{
  const out = {};
  for (const sel of ['.tl-heatmap', '.tl-heatmap-row', '.tl-heatmap-legend']) {
    const e = document.querySelector(sel);
    out[sel] = e ? [e.scrollHeight, Math.round(e.getBoundingClientRect().height * 100) / 100] : null;
  }
  return JSON.stringify(out);
})()`));

const baseLabels = await parseRects(labelSel);
const baseCells = await parseRects(cellSelAll);
const baseLabelGeom = await geomPropsOf(labelSel);
const baseCellGeom = await geomPropsOf(cellSelAll);
const baseScroll = await scrollHeights();

// ① 首次悬浮一个格子 → 移开 → 再量
await hoverAt(cellExpr(0, 5));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
await sleep(350);
const afterFirst = await parseRects(labelSel);
const afterFirstCells = await parseRects(cellSelAll);
const d1 = diffRects(baseLabels, afterFirst);
ok(d1.length === 0, `⑦ ★★★ 首次悬浮后**移开**，年份/月份标签位置与基线逐值相同（${baseLabels.length} 个标签${d1.length ? '；偏差：' + d1.slice(0, 4).join(' | ') : ''}）`);
const d1c = diffRects(baseCells, afterFirstCells);
ok(d1c.length === 0, `⑦ ★★ 首次悬浮后移开，格子位置也和基线相同（${baseCells.length} 个格子${d1c.length ? '；偏差：' + d1c.slice(0, 4).join(' | ') : ''}）`);

// ② 逐个悬浮全部格子（模拟"用户扫一遍"），再量
for (const [rowIdx, col] of [[0, 0], [0, 11], [1, 0], [1, 6], [1, 11]]) {
  await hoverAt(cellExpr(rowIdx, col));
}
// 年份标签 + 月份表头也各悬停一次（"按键数字"就是这两排）
await hoverAt(yearExpr);
await hoverAt(`document.querySelectorAll('.tl-heatmap-mlabel')[3]`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
await sleep(400);
const afterSweep = await parseRects(labelSel);
const afterSweepCells = await parseRects(cellSelAll);
const d2 = diffRects(baseLabels, afterSweep);
ok(d2.length === 0, `⑦ ★★★ 扫完全部格子与标签后，标签位置仍与基线逐值相同（${d2.length ? '偏差：' + d2.slice(0, 4).join(' | ') : '零偏差'}）`);
const d2c = diffRects(baseCells, afterSweepCells);
ok(d2c.length === 0, `⑦ ★★ 扫完之后格子位置也仍与基线相同（${d2c.length ? '偏差：' + d2c.slice(0, 4).join(' | ') : '零偏差'}）`);

// ③ 悬浮态不许靠 border/padding/font/min-height/line-height 改尺寸
const afterLabelGeom = await geomPropsOf(labelSel);
const afterCellGeom = await geomPropsOf(cellSelAll);
const geomDiff = (a, b) => a.map((v, i) => (v === b[i] ? null : `#${i}: ${v} → ${b[i]}`)).filter(Boolean);
const g1 = geomDiff(baseLabelGeom, afterLabelGeom);
const g2 = geomDiff(baseCellGeom, afterCellGeom);
ok(g1.length === 0, `⑦ ★★★ 悬浮前后标签的 border/padding/font-weight/font-size/min-height/line-height 完全不变（${g1.slice(0, 3).join(' | ') || '全部相同'}）`);
ok(g2.length === 0, `⑦ ★★★ 悬浮前后格子的这些尺寸属性也完全不变（${g2.slice(0, 3).join(' | ') || '全部相同'}）`);

// ④ 网格容器的 scrollHeight 不变（泡泡没有把它撑高）
//   ★ 判据用"容差 ≤ 1px"而不是字符串逐值相等：这两处量之间隔了好几次
//   scrollIntoView + 鼠标移动，亚像素的高度会被重新取整（实测 167/168 之间抖 0.5px），
//   那与"泡参与排版"完全是两回事。真要出问题（泡被算进滚动区）会是几十像素的跳变。
const afterScroll = await scrollHeights();
const scrollDiff = [];
for (const k of Object.keys(baseScroll)) {
  const a = baseScroll[k], b = afterScroll[k];
  if (!a || !b) { scrollDiff.push(`${k}: 缺席`); continue; }
  if (Math.abs(a[0] - b[0]) > 1 || Math.abs(a[1] - b[1]) > 1) scrollDiff.push(`${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}
ok(scrollDiff.length === 0,
  `⑦ ★★ 悬浮前后 .tl-heatmap / .tl-heatmap-row / .tl-heatmap-legend 的 scrollHeight 与高度不变（容差 ≤1px；基线 ${JSON.stringify(baseScroll)} vs 之后 ${JSON.stringify(afterScroll)}）`);
// ★ 同时把"行高"钉死：泡无论是隐藏还是显示，数据行的高度都必须等于 --hm-cell（格子边长）
const rowH = JSON.parse(await evaluate(`(()=>{
  const hm = document.querySelector('.tl-heatmap');
  const cell = hm.querySelector('.tl-heatmap-cell');
  const row = hm.querySelector('.tl-heatmap-row:not(.tl-hm-head)');
  return JSON.stringify({ cell: +cell.getBoundingClientRect().height.toFixed(2), row: +row.getBoundingClientRect().height.toFixed(2) });
})()`));
ok(Math.abs(rowH.row - rowH.cell) <= 0.5,
  `⑦ ★★ 数据行高度 == 格子边长（行 ${rowH.row}px vs 格子 ${rowH.cell}px）—— 泡没有撑高任何一行`);

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
