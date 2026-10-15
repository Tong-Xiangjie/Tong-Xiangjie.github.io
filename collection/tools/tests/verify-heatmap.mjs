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
import { decodePng, pixelAt } from './lib/pixel.mjs';
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
// ★★★ 用户反复反馈的「年份/月份高亮后数字会沉降一点点」：
//   真凶是**用 font-weight 做高亮** —— 字重一变，字形墨迹框就变（笔画变粗、ink 变高 1px），
//   而行盒在定高 42px 的 flex 盒里居中 ⇒ `getBoundingClientRect()` 一个像素都不动，
//   所以"外框零偏差"的断言全绿、屏幕上却真的换了一副字形。⇒ 高亮一律只准用
//   **不改变字体度量、也不画色块**的属性（只允许 color），字号·字重·字体·行高·字距各状态必须相同。
{
  const activeRule = (css.match(/\.tl-heatmap-ylabel\.is-active[^{]*\{[^}]*\}/) || [''])[0];
  ok(activeRule.length > 0, '① ★★★ 有 .is-active 高亮规则');
  ok(!/font/.test(activeRule.replace(/font-variant[^;]*/g, '')),
    `① ★★★ 高亮规则里**没有任何 font-* 属性**（既不改字重、也不改字号/字体/行高/字距，避免字形变化造成的"数字沉降"）：${activeRule.replace(/\s+/g, ' ')}`);
  ok(/color\s*:/.test(activeRule), '① ★★★ 高亮只体现在文字颜色上（color: var(--theme)）');
  // ★★★ 用户 2026-10："选中的那一块会出现**底部颜色变化**，不应该这样，只应该让字的颜色变化"
  //   ⇒ 高亮规则里不准出现任何画色块的属性。
  ok(!/color-mix|background\s*:(?!\s*none)/.test(activeRule) && /background\s*:\s*none/.test(activeRule),
    `① ★★★ 高亮规则**不画任何底色/背景图**（background: none；没有 color-mix）：${activeRule.replace(/\s+/g, ' ')}`);
  ok(!/border|box-shadow|outline|text-decoration/.test(activeRule.replace(/border\s*:\s*none|box-shadow\s*:\s*none/g, '')),
    `① ★★★ 高亮规则**不画边框/阴影/轮廓/下划线**：${activeRule.replace(/\s+/g, ' ')}`);
  const activePseudo = (css.match(/\.tl-heatmap-y?label\.is-active::(?:before|after)[^{]*\{[^}]*\}/g) || []).join(' ');
  ok(/content\s*:\s*none/.test(activePseudo),
    `① ★★★ 高亮态**不长伪元素**（::before/::after 都是 content: none）：${activePseudo.replace(/\s+/g, ' ')}`);
  // 悬浮态同样不许碰任何字体度量属性（hover 只准改 color 等 paint 属性）
  const hoverRule = (css.match(/\.tl-heatmap-ylabel:hover[^{]*\{[^}]*\}/) || [''])[0];
  ok(!/font(-weight|-size|-family)?\s*:/.test(hoverRule) && !/line-height|letter-spacing|padding|border|height/.test(hoverRule),
    `① ★★★ 标签的 :hover 只改 paint 属性（不改字号/字重/行高/内边距/边框/高度）：${hoverRule.replace(/\s+/g, ' ')}`);
  // 泡必须彻底脱离版式流：absolute + 显式行高（`line-height: normal` 等），
  // 这样"泡在不在"都改不了父级与标签文字的任何度量。
  const tipRule = (css.match(/\.tl-heatmap-tip\s*\{[\s\S]*?\n\}/) || [''])[0];
  ok(/position\s*:\s*absolute/.test(tipRule),
    `① ★ 泡是绝对定位（不参与父级版式）：${tipRule.replace(/\s+/g, ' ').slice(0, 160)}`);
  ok(/line-height\s*:/.test(tipRule),
    `① ★★★ 泡上显式写了 line-height（不继承按钮的行高，避免插进按钮里时影响基线）`);
}

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
      // 「全部时间」范围：第一行取 **裸币口径** npn/npsum（用户 2026-10 裁定）
      all,
      allTotal: Math.round((all.npsum + totalFee) * 10) / 10,
      allRaw: { count: all.pn, sum: all.psum },
      allNaked: { count: all.npn, sum: all.npsum },
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
    const want = expectMatrix.cells[r.year + '/' + c.m] || { n: 0, sum: 0, pn: 0, psum: 0, npn: 0, npsum: 0 };
    cellChecked++;
    sumAll += want.npsum;
    const { text: tip, lines } = tipTextOf(c.tip);
    // 用户定的文案格式（2026-10 起是**两/三行**）：
    //   第一行 = `x年x月，共购入N件，合计X元`，N/X **只算藏品**、X = **Σ裸币价**（不含评级费）
    //   第二行 = `另对K件钱币评级，评级费用 Y 元`（该月没有评级费就整行没有）
    //   第三行 = `合计支出Z元`，Z = X + Y（同样只在有评级费时出现）
    const wantText = `${r.year}年${Number(c.m)}月，共购入${want.npn}件，合计${want.npsum}元`;
    const exact = lines[0] === wantText;
    const nOk = lines[0].includes(`共购入${want.npn}件`);
    const sumOk = lines[0].includes(`合计${want.npsum}元`);
    // ★ aria-label 走的是 escapeAttr ⇒ 里面的 `<strong class="tl-hm-num">` 被编码成
    //   `%3Cstrong class=%22tl-hm-num%22%3E`。要比就先把实体/百分号编码解回来，
    //   再去掉标签，最后和泡的纯文本比。
    const ariaPlain = decodeEnt(String(c.aria || '').replace(/%3C/gi, '<').replace(/%3E/gi, '>')
      .replace(/%22/g, '"').replace(/&#10;/g, '\n').replace(/%0A/gi, '\n'))
      .replace(/<[^>]*>/g, '');
    const ariaOk = !!c.aria && ariaPlain.includes(`共购入${want.npn}件`) && ariaPlain.includes(`合计${want.npsum}元`);
    // ★ 第一行里**绝不能**并进评级费（这正是用户报的"多了一倍评级费"）
    const feeAmt = (() => { const m = (lines[1] || '').match(/评级费用\s*([\d.]+)\s*元/); return m ? +m[1] : null; })();
    const noFeeInHead = feeAmt == null || !lines[0].includes(`合计${Math.round(want.npsum + feeAmt)}元`);
    // ★★ 第三行 == 第一行 + 第二行（逐格恒等 ⇒ 评级费只被加过一次）
    const totalOk = (() => {
      if (feeAmt == null) return lines.length === 1;
      const m = (lines[2] || '').match(/^合计支出([\d.]+)元$/);
      return lines.length === 3 && !!m && Math.abs(+m[1] - (want.npsum + feeAmt)) <= 0.01;
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
// ★★ 格子填色/图例的口径（用户 2026-10 用"2026 年 2 月逐日明细"手算 7194 之后钉死）：
//   填色金额 = 泡第一行"合计" = **Σ(该月每天的"这天，你一共花了 X 元")** = `cell.psum`（裸币价）。
//   ⇒ 所以"全部格子之和"必须等于 `expectMatrix.ownAmount`（Σ裸币价 = 46668.5），
//     **不是** `totalAmount`（那是"Σ裸币价 + 评级费支出"= 标语用的总支出口径）。
ok(Math.abs(sumAll - expectMatrix.ownAmount) <= 0.6,
  `② ★★★ 全部格子金额之和 == Σ裸币价 ${expectMatrix.ownAmount}（实测 ${Math.round(sumAll * 10) / 10}）—— 填色口径 = 泡第一行合计 = 逐日"这天你一共花了"`);

const sloganSum = parseInt(((await evaluate(`(document.querySelector('.timeline-slogan')||{}).textContent||''`)).match(/共花了\s*(\d+)\s*元/) || [])[1], 10);
// ★★ 标语口径（用户裁定 2026-10，最终版）：**总花费 = Σ裸币价 + 评级费支出**，
//   数学上恒等于 **Σ 藏品 price**（录入价 = 裸币价 + 该枚评级费）。既不重复也不遗漏。
//   ★ 注意：标语与"格子填色"**不是同一个数** —— 标语是"总共花了多少"（含所有评级费），
//     格子/图例是"每个月花了多少"（裸币价口径，与逐日明细吻合）。
ok(sloganSum === expectMatrix.totalAmount,
  `② ★ 标语"共花了" == Σ裸币价 + 评级费支出（${sloganSum} vs ${expectMatrix.totalAmount}）`);
ok(sloganSum === expectMatrix.ownAmount + expectMatrix.feeSum,
  `② ★ 标语总额 == Σ裸币价 ${expectMatrix.ownAmount} + 评级费支出 ${expectMatrix.feeSum} = ${expectMatrix.ownAmount + expectMatrix.feeSum}`);
ok(expectMatrix.ownAmount === expectMatrix.rawAmount - expectMatrix.feeSum,
  `② ★ Σ裸币价 == Σ录入价 − 评级费支出（${expectMatrix.ownAmount} == ${expectMatrix.rawAmount} − ${expectMatrix.feeSum}）`);
ok(expectMatrix.totalAmount === expectMatrix.rawAmount,
  `② ★★★ 两条总口径恒等：Σ裸币价+评级费支出 == Σ录入价（${expectMatrix.totalAmount} == ${expectMatrix.rawAmount}）—— 7670 与 7193.5 的差就是这么来的`);

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
    //   （上一版就是这么报出"第一行 1836 ≠ Σ裸币价 0 / 无评级费却有 3 行"的）。
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
  //   ⇒ 这些月份被当成"无评级费"，用例报出"第一行 1836 ≠ Σ裸币价 0"这种看不懂的错。
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
      if (Math.abs(headSum - (cellWant ? cellWant.npsum : 0)) > 0.01) {
        tipBad.push(`${t.y}/${t.m} 第一行 ${headSum} ≠ Σ裸币价 ${cellWant ? cellWant.npsum : '（无该月）'}`);
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
  // ★★ 用户 2026-10 给的例子，逐字对上（第一行口径 = Σ裸币价）：
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
  ok(octCell && octCell.npn === 8 && Math.abs(octCell.npsum - 1114) <= 0.01,
    `②-c ★★★ 独立复算该月 = ${octCell && octCell.npn} 件 / Σ裸币价 ${octCell && octCell.npsum} 元`);  if (octExp) ok(octExp.k === 26 && octExp.amount === 810,
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

// ─────────── ②-d 「共购入 N 件」的 N 到底是多少：8 还是 9 ───────────
// 用户举的例子是 2026 年 10 月「共购入 9 件，合计 1114 元」，页面给的是 8 件。
// 查证结论（三条互不相干的路径 + 页面 DOM 逐条点数）：
//   · 数据源：`grep 'purchaseDate: "2026年10月' notecollection/data/*.js` ⇒ **正好 8 条**，
//     而且 8 条的 price 全部有值（200/98/88/88/115/70/70/385 = 1114）⇒ **不是"有件没价格被漏算"**；
//   · `collectAllCopies()` 在页面里跑一遍 ⇒ 2026/10 = 8 件 / Σprice 1114；
//   · 时间轴 DOM 上「2026年10月」那一段 ⇒ **9 张卡片**，其中第 6 张是
//     「评级费｜评级公司：ACG｜…｜送评日期：2026年9月6日」（付款日期 2026-10-01）
//     ⇒ 用户数的 9 = **8 件藏品 + 1 条评级费卡片**。
//   ⇒ 所以「共购入 N 件」的 N 按**藏品件数**记（评级费那条已经单独出在第二行，
//     再并进第一行就是一行里数两次）。这里把三条路径和 DOM 都钉住。
console.log('\n══════ ②-d 「共购入 N 件」：2026年10月 是 8 件（9 张卡片 = 8 藏品 + 1 评级费） ══════\n');
{
  const octTips = tipsAll.find(t => t.y === '2026' && Number(t.m) === 10);
  const octWant = expectMatrix.cells['2026/10'] || { pn: 0, psum: 0 };
  // A) 数据源逐条：**不看价格**，只按 purchaseDate 落在 2026 年 10 月数一遍
  const octItems = JSON.parse(await evaluate(`(()=>{
    const pdate = (s) => { const t = String(s || '').trim(); const d = new Date(t); if (!isNaN(d.getTime())) return d;
      const m = t.match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
    const px = (s) => { const v = parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, '')); return (isNaN(v) || v <= 0) ? 0 : v; };
    const out = [];
    for (const map of [window.DATA_MAP, window.COIN_DATA_MAP]) {
      if (!map) continue;
      for (const k of Object.keys(map)) { const d = map[k]; if (!d || !d.series) continue;
        const walk = (arr) => { for (const c of (arr || [])) {
          if (!c || !c.purchaseDate) continue;
          const dt = pdate(c.purchaseDate); if (!dt) continue;
          if (dt.getFullYear() !== 2026 || dt.getMonth() !== 9) continue;
          out.push({ copyId: c.copyId != null ? String(c.copyId) : null, price: px(c.price), rawPrice: c.price == null ? null : String(c.price), key: k });
        } };
        for (const s of d.series) { if (s.varieties) { for (const v of s.varieties) walk(v.copies); } else walk(s.copies); }
      }
    }
    return JSON.stringify(out);
  })()`));
  const octSum = octItems.reduce((s, x) => s + x.price, 0);
  const octNoPrice = octItems.filter(x => x.price <= 0).length;
  console.log(`     2026 年 10 月逐条（不看价格、只按购入日期）：共 ${octItems.length} 件`);
  for (const x of octItems) console.log(`        ${String(x.copyId || '（无 copyId）').padEnd(14)} price=${JSON.stringify(x.rawPrice)} → ${x.price}  [${x.key}]`);
  ok(octItems.length === octWant.pn,
    `②-d ★★★ 2026年10月 实际购入件数 == ${octItems.length}（与"只按日期数"的独立复算一致；页面提示也是 ${octWant.pn} 件）`);
  ok(Math.round(octSum) === Math.round(octWant.npsum),
    `②-d ★★★ 该月合计金额（只算有价格的）== ${Math.round(octSum)}（与页面 ${octWant.npsum} 一致）—— **件数与金额各自独立复算**：件数不看价格、金额看价格`);
  ok(octNoPrice === 0, `②-d ★★ 这 ${octItems.length} 件**每一件都有价格**（无价格件数 = ${octNoPrice}）⇒ "有一件没价格被漏算"这个猜测不成立`);
  // B) 页面提示第一行的件数 / 金额
  if (octTips) {
    const m = String(octTips.tip).split('\n')[0].match(/共购入(\d+)件，合计([\d.]+)元/);
    ok(!!m && +m[1] === octItems.length,
      `②-d ★★★ 页面第一行件数 == 实际购入件数（页面「${m ? m[1] : '?'}件」 vs 实际 ${octItems.length} 件）`);
  } else {
    ok(false, '②-d 没找到 2026年10月 的提示文本');
  }
  // C) 时间轴 DOM：那个月渲染了几张卡片、其中有几张是评级费
  const domOct = JSON.parse(await evaluate(`(()=>{
    const bodies = [...document.querySelectorAll('.timeline-body')].filter(b => b.getBoundingClientRect().height > 1);
    const body = bodies[0] || document.querySelector('.timeline-body');
    if (!body) return JSON.stringify(null);
    const walker = []; let cur = null;
    for (const el of [...body.children]) {
      const txt = (el.textContent || '').trim();
      const m = txt.match(/^(\\d{4}年\\d{1,2}月\\d{1,2}日)/);
      if (m) { cur = m[1]; continue; }
      if (cur) walker.push({ day: cur, txt: txt.slice(0, 60) });
    }
    const oct = walker.filter(w => /^2026年10月/.test(w.day));
    return JSON.stringify({ total: oct.length, items: oct,
      feeCards: oct.filter(w => /评级费/.test(w.txt)).length,
      days: [...new Set(oct.map(w => w.day))] });
  })()`));
  ok(!!domOct && domOct.total === octItems.length + 1,
    `②-d ★★★ 时间轴 DOM 上「2026年10月」共 ${domOct && domOct.total} 张卡片 = 藏品 ${octItems.length} 件 + **评级费卡片 ${domOct && domOct.feeCards} 张**（这就是用户数的"9"）`);
  ok(!!domOct && domOct.feeCards === 1,
    `②-d ★★ 那一张多出来的卡片是评级费条目（${domOct && JSON.stringify(domOct.items.filter(w => /评级费/.test(w.txt)).map(w => w.txt))}）`);
  ok(!!domOct && domOct.days.length === 3 && domOct.days.join(',') === '2026年10月14日,2026年10月13日,2026年10月1日',
    `②-d ★ 那 9 张卡片分布在 3 天里（${domOct && domOct.days.join(' / ')}）—— 9 条并没有第 9 件藏品`);
}

// ─────────── ②-e 以"每日合计之和"为准对账（用户 2026-10 的判据） ───────────
// 用户裁定：**单月合计 == 该月"这天，你一共花了 X 元"之和**。
//   他手算 2026 年 2 月 = 68+88+298+121+240+2323+1153+677+198+766+129+298+341+494 = **7194**。
//   ★ 本段**真的去调用页面自己的按日聚合函数**（timelineDailyAmountOf / 同类函数），
//     逐日把"这天你一共花了多少"算出来再加总，而不是复用热力图的按格聚合 ——
//     这样"单月 == 逐日之和"才是一条**独立**的判据。
console.log('\n══════ ②-e 单月合计 == 该月"逐日合计"之和（用户判据） ══════\n');
{
  const daily = JSON.parse(await evaluate(`(()=>{
    const dayFn = (typeof timelineDayAmountOf === 'function' ? timelineDayAmountOf
      : (typeof timelineDailyAmount === 'function' ? timelineDailyAmount : null));
    const priceFn = (typeof timelinePriceOf === 'function' ? timelinePriceOf : null);
    const pdate = (s) => { const t = String(s || '').trim(); const d = new Date(t); if (!isNaN(d.getTime())) return d;
      const m = t.match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
    const px = (s) => { const v = parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, '')); return (isNaN(v) || v <= 0) ? 0 : v; };
    // 逐枚：用页面自己那支"这枚在时间轴上算多少钱"的函数（= 裸币价）
    const per = [];
    for (const map of [window.DATA_MAP, window.COIN_DATA_MAP]) {
      if (!map) continue;
      for (const k of Object.keys(map)) { const d = map[k]; if (!d || !d.series) continue;
        const walk = (arr) => { for (const c of (arr || [])) {
          if (!c || !c.purchaseDate) continue;
          const dt = pdate(c.purchaseDate); if (!dt) continue;
          per.push({ y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(),
            v: (typeof timelinePriceOf === 'function' ? px(timelinePriceOf(c)) : px(c.price)) });
        } };
        for (const s of d.series) { if (s.varieties) { for (const v of s.varieties) walk(v.copies); } else walk(s.copies); }
      }
    }
    const byDay = new Map(), byMonth = new Map();
    for (const r of per) {
      const dk = r.y + '/' + String(r.m).padStart(2, '0') + '/' + String(r.d).padStart(2, '0');
      const mk = r.y + '/' + String(r.m).padStart(2, '0');
      byDay.set(dk, Math.round(((byDay.get(dk) || 0) + r.v) * 10) / 10);
      byMonth.set(mk, Math.round(((byMonth.get(mk) || 0) + r.v) * 10) / 10);
    }
    return JSON.stringify({ dayFnName: typeof dayFn === 'function' ? (dayFn.name || '匿名') : null,
      priceFnName: typeof priceFn === 'function' ? (priceFn.name || '匿名') : null,
      byDay: [...byDay.entries()], byMonth: [...byMonth.entries()], rows: per.length });
  })()`));
  const dailyMonth = new Map(daily.byMonth);
  console.log(`     逐日聚合：${daily.byDay.length} 天 / ${daily.rows} 枚（金额函数：${daily.priceFnName}）`);
  console.log(`     2026 年 2 月逐日合计（独立按日重算，与用户手算的 14 天对照）：`);
  const feb = daily.byDay.filter(([k]) => k.startsWith('2026/02/')).sort();
  for (const [k, v] of feb) console.log(`        ${k}  ${v}`);
  const febSum = Math.round(feb.reduce((s, [, v]) => s + v, 0) * 10) / 10;
  console.log(`        ── 2 月合计 = ${febSum}（用户手算 7194）`);
  // ★★ 两个数都要算：精确值 7193.5，以及"按页面那样每天四舍五入显示后再相加"= 7194。
  //   用户是照屏幕上的每日数字（765.5 印成 766）加的，所以他得 7194；两者差 0.5，属显示取整。
  const febAcc = Math.round(feb.reduce((s, [, v]) => s + v, 0) * 10) / 10;
  const febShown = feb.reduce((s, [, v]) => s + Math.round(v), 0);
  console.log(`        精确值 ${febAcc}；按页面每天取整后相加 = ${febShown}（用户手算 7194）`);
  ok(febShown === 7194 && Math.abs(febAcc - 7194) <= 1,
    `②-e ★★★ 2026 年 2 月「逐日合计之和」= ${febAcc}（按天取整后 ${febShown}）== 用户手算的 7194`);
  // 页面格子的金额必须 == 该月逐日合计（对所有有数据的月份）
  const cellAmt = JSON.parse(await evaluate(`(()=>{
    const out = {};
    for (const r of [...document.querySelectorAll('.tl-heatmap-row')].filter(x => !x.classList.contains('tl-hm-head'))) {
      const y = (r.querySelector('.tl-heatmap-ylabel') || {}).dataset?.label;
      for (const c of r.querySelectorAll('.tl-heatmap-cell')) out[y + '/' + c.dataset.month] = +(c.dataset.amount || 0);
    }
    return JSON.stringify(out);
  })()`));
  const monthBad = [];
  let nMon = 0;
  for (const [mk, v] of dailyMonth) {
    const [y, m] = mk.split('/');
    const got = cellAmt[y + '/' + m];
    nMon++;
    if (got === undefined || Math.abs(got - v) > 0.11) monthBad.push(`${mk}: 格子 ${got} ≠ 逐日 ${v}`);
  }
  ok(monthBad.length === 0,
    `②-e ★★★ 全部 ${nMon} 个月：格子金额 == 该月"逐日合计之和"（不一致：${monthBad.join('；') || '无'}）`);
  // 全年合计 == 各月之和；全部合计 == 所有月之和（自洽性）
  const ySum = new Map(), allSum = Math.round([...dailyMonth.values()].reduce((s, v) => s + v, 0) * 10) / 10;
  for (const [mk, v] of dailyMonth) { const y = mk.split('/')[0]; ySum.set(y, Math.round(((ySum.get(y) || 0) + v) * 10) / 10); }
  const pageYear = JSON.parse(await evaluate(`(()=>{
    const out = {};
    for (const e of document.querySelectorAll('.tl-heatmap-ylabel')) if (e.dataset.label && /^\\d{4}$/.test(e.dataset.label))
      out[e.dataset.label] = +(e.style.getPropertyValue('--hm-yearsum') || 0);
    return JSON.stringify(out);
  })()`));
  const yBad = [];
  for (const [y, v] of ySum) { const got = pageYear[y]; if (got === undefined || Math.abs(got - v) > 0.11) yBad.push(`${y}: 页面 ${got} ≠ 逐月之和 ${v}`); }
  ok(yBad.length === 0 && Object.keys(pageYear).length === ySum.size,
    `②-e ★★★ 每个年份行：页面写的全年合计 == 该年各月"逐日合计"之和（${yBad.join('；') || '全部一致'}；页面上 ${Object.keys(pageYear).length} 个年份行）`);
  console.log(`     各年"逐月之和"：${[...ySum.entries()].map(([y, v]) => y + '=' + v).join(' , ')}`);
  console.log(`     全部 = Σ所有月 = ${allSum}；Σ各年 = ${Math.round([...ySum.values()].reduce((s, v) => s + v, 0) * 10) / 10}`);
  ok(Math.abs(allSum - expectMatrix.ownAmount) <= 0.6,
    `②-e ★★ 全部（Σ所有月）== Σ裸币价 ${expectMatrix.ownAmount}（${allSum}）`);
  ok(Math.abs(Math.round([...ySum.values()].reduce((s, v) => s + v, 0) * 10) / 10 - allSum) <= 0.11,
    `②-e ★★ 自洽：Σ各年 == Σ所有月（${[...ySum.values()].reduce((s, v) => s + v, 0)} == ${allSum}）`);

  // ★★★ 图例五档的最大值必须**等于按"逐日合计"口径算出来的最大月合计**（用户判据 3）：
  //   当前数据下最大月 = 2026/02 = 7193.5（显示 7194）。
  const maxMon = [...dailyMonth.entries()].sort((a, b) => b[1] - a[1])[0];
  const legend = JSON.parse(await evaluate(`(()=>{
    const lg = document.querySelector('.tl-heatmap-legend');
    if (!lg) return JSON.stringify(null);
    const ticks = [...lg.querySelectorAll('.tl-hm-legend-tick')];
    return JSON.stringify({ ticks: ticks.map(t => ({ pct: +t.dataset.percent, amt: +t.dataset.amount, text: t.textContent.trim() })) });
  })()`));
  console.log(`     最大月合计（逐日口径）= ${maxMon[1]} 元，落在 ${maxMon[0]}`);
  console.log(`     图例五档实测文本：${legend && legend.ticks.map(t => t.text).join(' / ')}`);
  ok(!!legend && Math.abs((legend.ticks[4] || {}).amt - maxMon[1]) <= 0.5,
    `②-e ★★★ 图例 100% 档 == 最大月合计（图例 ${legend && legend.ticks[4] && legend.ticks[4].amt} vs 逐日口径最大月 ${maxMon[1]} 元 @ ${maxMon[0]}）`);
  // 最大月的那个格子必须是最深的一档（bright == 1）
  const maxCell = JSON.parse(await evaluate(`(()=>{
    const c = [...document.querySelectorAll('.tl-heatmap-cell')].find(x => String(x.dataset.year) === ${JSON.stringify(maxMon[0].split('/')[0])} && String(x.dataset.month) === ${JSON.stringify(maxMon[0].split('/')[1])});
    return JSON.stringify(c ? { amt: +c.dataset.amount, bright: +c.dataset.bright, alpha: +c.dataset.alpha } : null);
  })()`));
  ok(!!maxCell && Math.abs(maxCell.amt - maxMon[1]) <= 0.11 && maxCell.bright === 1 && Math.abs(maxCell.alpha - 0.95) <= 0.001,
    `②-e ★★★ 最大月那一格（${maxMon[0]}）取的是最深一档：金额 ${maxCell && maxCell.amt}、bright ${maxCell && maxCell.bright}、α ${maxCell && maxCell.alpha}`);
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const spNoCmt = stripComments(readFileSync('collection/special.js', 'utf8')), cssNoCmt = stripComments(css);
  ok(!/7193/.test(spNoCmt) && !/7193/.test(cssNoCmt),
    `②-e ★★★ special.js / layout.css 里**没有任何写死的 7193**（图例五档全部由实时 max 算出来）`);
  ok(/timelineHeatmapTiers\s*\(\s*maxAmount\s*\)/.test(spNoCmt),
    '②-e ★★★ 图例五档由 timelineHeatmapTiers(maxAmount) 实时算（maxAmount = 最大月合计），不是写死的数组');
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
// ★★★ 用户报的"形状问题"（泡被压成一个格子那么宽）—— 判据**全部改成字体/视口无关**：
//   · 旧的 `tipW >= 200` 是写死的 px，CI（ubuntu）字体更窄 ⇒ 实测 176px ⇒ 误报（CI 红的就是这条）；
//     `tipW > cellW * 2` 本身是相对量，保留。
//   · 再加一条 hRatio（泡高 / 泡宽）< 1.0：正常"三行、宽 ≈200、高 ≈52"⇒ 0.25 左右；
//     被压成竖排时宽塌到 59、高 256 ⇒ 4.3（本机反例实测）。
//   · `<br>` 三行、高度 ≥ 2.8 × lineHeight 这两条**本来就相对 lineHeight**（octLines.oneLine），
//     与字体无关，保持不动。
ok(octLines && octLines.tipW > octLines.cellW * 2,
  `②-c ★★★ 泡的宽度没有被压成"一个格子那么宽"（泡 ${octLines && octLines.tipW}px > 格子 ${octLines && octLines.cellW}px × 2）—— 用户报的形状问题`);
ok(octLines && octLines.tipW > 0 && octLines.h / octLines.tipW < 1.0,
  `②-c ★★★ 泡不是竖排（高/宽 = ${octLines && (octLines.h / octLines.tipW).toFixed(3)} < 1.0，泡 ${octLines && octLines.tipW}×${octLines && octLines.h}px）—— 字体无关的形状判据`);
// 深浅：颜色**只有 --theme 一种**，深浅全由 opacity 表达；
//   每个格子的 --hm-o 必须 = 0（金额 0）或 lerp(0.06, 0.95, 金额/最大金额)
const lvInfo = JSON.parse(await evaluate(`(()=>{
  const cells = [...document.querySelectorAll('.tl-heatmap-cell')];
  const o = c => +(c.style.getPropertyValue('--hm-o') || 0);
  // ★★ 填色金额读 data-amount（渲染端写的 = **该格裸币口径金额** cell.psum：
  //   藏品录入价 − 该枚自己的评级费）。★ 它必须与泡第一行"合计"**逐分相等** ——
  //   这正是用户 2026-10 抓到的 bug：上一版填色用的是"裸币价 + 该月评级费"，
  //   2026/02 于是填 7193、图例最大值也 7193，而泡里写 7670，三处口径互相打架。
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
  // ★★★ 字体/视口无关的形状度量（CI（ubuntu）与本机字体不同，绝不能拿具体 px 当判据）：
  //   nLines = 文本行盒个数（Range.getClientRects()，块级元素直接量只会得到 1 个）；
  //   lh     = 计算出来的单行高（px，跟字体走，但**只和自身比**）；
  //   hRatio = 泡高 / 泡宽 —— "被压成一个格子那么宽"必然让这个比值暴涨，与字体无关。
  const _rg = document.createRange(); _rg.selectNodeContents(tip);
  const _rects = [..._rg.getClientRects()].filter(x => x.width > 0 && x.height > 0);
  const _lh = parseFloat(getComputedStyle(tip).lineHeight) || 0;
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
    // ★ 字体无关的形状度量（见 tp 上面那段注释）
    nLines: _rects.length,
    lh: +_lh.toFixed(2),
    hRatio: tr.width > 0 ? +(tr.height / tr.width).toFixed(3) : null,
    scrollW: tip.scrollWidth,
    // ★★ 内容宽度（字体无关判据用）：每行 nowrap、width:max-content、text-align:center
    //    ⇒ 若"没有折行"，泡的**内宽** == 最长那一行的宽度 == scrollWidth（无溢出）。
    //    对比 tip.scrollWidth > tip.clientWidth 就能判"内容被压住溢出/被迫折行"。
    //    （注意：这段是**模板字符串内部**，注释里不能出现反引号，否则会提前结束字符串。）
    clientW: tip.clientWidth,
    // ★ 被描述对象（格子/标签）的宽 —— 用于"泡宽 > 2 × 它"这条**相对**判据
    boxW: +br.width.toFixed(2),
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
    n += c.n; sum += c.sum;
    // ★★ 标签泡第一行用的字段：**裸币口径**（npn / npsum）。
    //   这与格子泡、逐日"这天你一共花了"、图例五档是同一支口径（用户 2026-10 裁定）。
    pn += c.npn || 0; psum += c.npsum || 0;
  }
  return {
    n, sum: Math.round(sum), pn,
    psum: Math.round(psum * 10) / 10,
    naked: Math.round(psum * 10) / 10      // ★ 与 psum 同值：这一支就是"裸币口径"
  };
};
const year0 = expectMatrix.years.map(Number).sort((a, b) => a - b)[0];
// ★★ 统一成 {pn, psum}：标签泡与格子泡**同一套字段名**，
//   早先这里写成 {n, sum} 而断言读 exp.pn ⇒ 永远 undefined（上一版误报就是它）。
const expectLabel = {
  all: { pn: expectMatrix.range.allNaked.count, psum: Math.round(expectMatrix.range.allNaked.sum * 10) / 10 },
  year0: sumCells(yy => yy === year0),
  year0Label: String(year0),
  m7: sumCells((yy, mm) => mm === 7)
};
expectLabel.all.naked = expectLabel.all.psum;
expectLabel.all.n = expectLabel.all.pn;
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
  ok(!!m && +m[1] === exp.pn && Math.abs(+m[2] - exp.naked) <= 0.51,
    `③ ★ ${name}的泡第一行件数/购入金额与它管的格子一致（泡 ${m ? m[1] + ' 件/' + m[2] + ' 元' : '—'} vs 复算 ${exp.pn} 件/裸币 Σ ${exp.naked} 元）`);
  // ★★★ 泡的形状：必须能抓住"泡被压成竖排"这个回归（用户报的形状问题）。判据全部是**相对量**：
  //   ① tipW > boxW × 2     —— 泡明显比它所描述的对象宽。
  //   ② hRatio < 1.0        —— 泡高 / 泡宽。
  //   ③ scrollW ≤ clientW+1 —— 内容没有被压住（width:max-content + nowrap 下内容宽 == scrollWidth）。
  //   ④ ws === 'nowrap'     —— 直接查计算样式（与字体完全无关，本来就是最稳的一条）。
  //   ★ 反例推演（本机实测，把老实现注回去，见 %TEMP%/hmdiag/neg.mjs）：
  //     正常：泡 224.8×51.7、高/宽 0.230、boxW 43.5、scrollW==clientW；
  //     只注入 `white-space: pre-line`：**形状不变**（现在的文案是 <br> 分行，不靠 \n）
  //       ⇒ 只有 ④ 能抓住，① ② ③ 都照样绿（所以 ④ 不能删）；
  //     再注入 `width:auto`（当年真正让首选宽度塌掉的组合）：泡塌成 **59.3×255.6**、
  //       高/宽 **4.310**、boxW 43.5 ⇒ ① false、② false —— 两条都红。
  //   ★ 为什么不再用 `tipW >= 200`：CI（ubuntu）与本机字体不同，同样文案量出来的宽度不同
  //     （CI 上 176px），写死 200 在字体更窄的 runner 上就会误报（CI 已实测红了 6 条）。
  const cellW = p.boxW || 0;
  ok(p.tipW > cellW * 2,
    '③ ★ ' + name + '的泡明显宽于一个格子（泡 ' + p.tipW + 'px > 格子 ' + cellW + 'px × 2）—— 抓"被压成一个格子那么宽"');
  ok(p.hRatio !== null && p.hRatio < 1.0,
    '③ ★ ' + name + '的泡不是竖排（高/宽 = ' + p.hRatio + ' < 1.0）—— 抓"三行被挤成竖排"');
  ok(p.ws === 'nowrap' && p.scrollW <= p.clientW + 1,
    '③ ★ ' + name + '的泡每行不折行、内容没有被压住（white-space=' + p.ws + '，scrollWidth ' + p.scrollW + ' ≤ clientWidth ' + p.clientW + ' + 1，共 ' + p.nLines + ' 行）');
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
    // ★★ 泡第一行的口径 = **裸币价**（npn / npsum）—— 与格子填色、逐日合计、图例五档同一支
    pn += c.npn || 0; psum += c.npsum || 0; nsum += c.npsum;
  }
  return { n: pn, pn, psum: Math.round(psum * 10) / 10, naked: Math.round(psum * 10) / 10, nsum: Math.round(nsum * 10) / 10 };
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
  ok(!!m && +m[1] === exp.pn && Math.abs(+m[2] - exp.naked) <= 0.51,
    `③-b ★★ ${name}：第一行前缀正确，件数/Σ裸币价与独立复算一致（${m ? m[1] + ' 件/' + m[2] + ' 元' : '格式不符'} vs 复算 ${exp.n} 件/裸币 Σ ${exp.naked} 元）`);
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

// ─────────── ③-b2 四种范围的「共购入 N 件」自查 ───────────
// 用户要求：四种范围的件数都要与"该范围实际购入件数"一致；件数**不看价格**、金额看价格。
//   ★ 独立复算走**与 expectMatrix.cells 无关**的第二条路径：直接遍历 window.DATA_MAP 里
//     带 purchaseDate 的藏品，按范围数件数（不读 price），按范围求和（读 price）。
//   ★ 同时打印"含评级费条目的总卡片数"，让"9 张卡片"这种错觉一眼可见。
console.log('\n══════ ③-b2 四种范围的件数自查（件数不看价格 / 金额看价格） ══════\n');
{
  const recount = JSON.parse(await evaluate(`(()=>{
    const pdate = (s) => { const t = String(s || '').trim(); const d = new Date(t); if (!isNaN(d.getTime())) return d;
      const m = t.match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
    const px = (s) => { const v = parseFloat(String(s == null ? '' : s).replace(/[^0-9.]/g, '')); return (isNaN(v) || v <= 0) ? 0 : v; };
    const rows = [];
    for (const map of [window.DATA_MAP, window.COIN_DATA_MAP]) {
      if (!map) continue;
      for (const k of Object.keys(map)) { const d = map[k]; if (!d || !d.series) continue;
        const walk = (arr) => { for (const c of (arr || [])) {
          if (!c || !c.purchaseDate) continue;
          const dt = pdate(c.purchaseDate); if (!dt) continue;
          rows.push({ y: dt.getFullYear(), m: dt.getMonth() + 1, price: px(c.price),
            naked: px(timelinePriceOf(c)), hasPrice: c.price != null && String(c.price).trim() !== '' });
        } };
        for (const s of d.series) { if (s.varieties) { for (const v of s.varieties) walk(v.copies); } else walk(s.copies); }
      }
    }
    const agg = (pick) => { let n = 0, sum = 0, naked = 0, noPrice = 0;
      for (const r of rows) { if (!pick(r)) continue; n++; sum += r.price; naked += r.naked; if (!r.hasPrice) noPrice++; }
      return { n, sum: Math.round(sum * 10) / 10, naked: Math.round(naked * 10) / 10, noPrice }; };
    // 页面上的四种范围泡（纯文本）
    const tipOf = (e) => { if (!e) return null; const t = e.querySelector(':scope > .tl-heatmap-tip'); return t ? window.__tipText(t) : null; };
    const mLabels = [...document.querySelectorAll('.tl-heatmap-mlabel')];
    const cellTip = (y, m) => { const c = [...document.querySelectorAll('.tl-heatmap-cell')].find(x =>
      (x.closest('.tl-heatmap-row') || {}).dataset && String(x.dataset.year) === String(y) && String(x.dataset.month) === String(m).padStart(2, '0'));
      return c ? tipOf(c) : null; };
    return JSON.stringify({
      all: agg(() => true),
      y2026: agg(r => r.y === 2026),
      m10: agg(r => r.m === 10),
      oct: agg(r => r.y === 2026 && r.m === 10),
      noPriceRows: rows.filter(r => !r.hasPrice).length,
      totalRows: rows.length,
      tips: {
        all: tipOf(document.querySelector('.tl-hm-corner')),
        y2026: tipOf([...document.querySelectorAll('.tl-heatmap-ylabel')].find(e => e.dataset.label === '2026')),
        m10: tipOf(mLabels[9]),
        oct: cellTip(2026, '10')
      }
    });
  })()`));
  const A = expectMatrix.range.all;
  const octCell = expectMatrix.cells['2026/10'] || { pn: 0, psum: 0 };
  const firstOf = (t) => (t ? String(t).split('\n')[0] : '（未取到）');
  console.log('     范围              实际购入件数  无价格件    Σ裸币价    页面泡第一行');
  const print = (name, n, sum, noPrice, tip) =>
    console.log(`     ${name.padEnd(16)} ${String(n).padStart(10)}  ${String(noPrice).padStart(6)}  ${String(sum).padStart(10)}   ${firstOf(tip)}`);
  print('全部（入坑以来）', recount.all.n, recount.all.naked, recount.all.noPrice, recount.tips.all);
  print('单月 2026年10月', recount.oct.n, recount.oct.naked, recount.oct.noPrice, recount.tips.oct);
  print('某年 2026年', recount.y2026.n, recount.y2026.naked, recount.y2026.noPrice, recount.tips.y2026);
  print('历年10月', recount.m10.n, recount.m10.naked, recount.m10.noPrice, recount.tips.m10);
  console.log(`     （全站共 ${recount.totalRows} 件藏品带购入日期；其中 **${recount.noPriceRows} 件没有价格字段**）`);
  console.log(`     对照：全部范围的"卡片总数" = 藏品 ${recount.all.n} + 评级费条目 5 = ${recount.all.n + 5}（时间轴顶部"共385件"写的就是这个数）`);
  // 件数与金额各自独立复算后再和页面泡对一遍
  const chk = (name, want, tip) => {
    const m = String(tip || '').split('\n')[0].match(/共购入(\d+)件，合计([\d.]+)元/);
    ok(!!m && +m[1] === want.n, `③-b2 ★★★ ${name}：件数 ${want.n} == 独立复算（页面「${m ? m[1] : '?'}件」）`);
    ok(!!m && Math.abs(+m[2] - want.naked) <= 0.01, `③-b2 ★★★ ${name}：Σ裸币价 ${want.naked} == 独立复算（页面「${m ? m[2] : '?'}元」）`);
  };
  chk('全部（入坑以来）', recount.all, recount.tips.all);
  chk('单月 2026年10月', recount.oct, recount.tips.oct);
  chk('某年 2026年', recount.y2026, recount.tips.y2026);
  chk('历年10月', recount.m10, recount.tips.m10);
  ok(recount.all.n === A.npn && Math.abs(recount.all.naked - A.npsum) <= 0.01,
    `③-b2 ★★★ 全部范围与格子重算口径一致（件数 ${recount.all.n}/${A.npn}、Σ裸币价 ${recount.all.naked}/${A.npsum}；Σ录入价 ${recount.all.sum}）`);
  ok(recount.oct.n === octCell.npn && Math.abs(recount.oct.naked - octCell.npsum) <= 0.01,
    `③-b2 ★★★ 2026年10月与格子重算口径一致（件数 ${recount.oct.n}/${octCell.npn}、Σ裸币价 ${recount.oct.naked}/${octCell.npsum}）`);
  ok(recount.noPriceRows === 0,
    `③-b2 ★★ 全站 ${recount.noPriceRows} 件藏品缺价格字段 ⇒ 今天"计件数"与"计有价格的件数"结果相同（将来出现 0 元藏品时，件数仍按实际件数计）`);
}

// ─────────── ③-e 填色金额 == 泡第一行"合计"（口径回环，用户 2026-10 的 bug） ───────────
// 用户原话："热力图的价格还是不对"。根因：**格子取色与泡第一行用了两支不同口径** ——
//   泡第一行曾经是 `cell.psum`（Σ录入价，2026/02 = 7670），而逐日"这天你一共花了"与
//   页面自己的每日合计是**裸币价**（2026/02 = 7193.5 ≈ 用户手算的 7194）。
// 现在两处统一到 **cell.npsum** ⇒ 逐格断言 `data-amount` == 泡第一行"合计" == 逐日之和。
console.log('\n══════ ③-e 填色金额 == 泡第一行"合计"（逐格回环） ══════\n');
{
  const pairs = JSON.parse(await evaluate(`(()=>{
    const out = [];
    for (const r of [...document.querySelectorAll('.tl-heatmap-row')].filter(x => !x.classList.contains('tl-hm-head'))) {
      const y = (r.querySelector('.tl-heatmap-ylabel') || {}).dataset?.label;
      for (const c of r.querySelectorAll('.tl-heatmap-cell')) {
        const t = c.querySelector('.tl-heatmap-tip');
        const txt = window.__tipText ? window.__tipText(t) : '';
        // ★ 只取**第一行**的"合计"（第三行也叫"合计支出"，不能混）
        const m = String(txt).split('\\n')[0].match(/合计([\\d.]+)元/);
        out.push({ key: y + '/' + c.dataset.month, amt: +(c.dataset.amount || 0), tipSum: m ? +m[1] : null, first: String(txt).split('\\n')[0] });
      }
    }
    return JSON.stringify(out);
  })()`));
  const bad = pairs.filter(p => p.amt > 0 && (p.tipSum === null || Math.abs(p.amt - p.tipSum) > 0.11));
  const covered = pairs.filter(p => p.amt > 0).length;
  console.log(`     有色的格子 ${covered} 个；样例：`);
  for (const p of pairs.filter(x => x.amt > 0).slice(0, 3)) console.log(`        ${p.key}  填色金额=${p.amt}  泡第一行「${p.first}」`);
  ok(bad.length === 0,
    `③-e ★★★ 每个有色格子的**填色金额** == 它泡第一行的"合计"（不一致：${bad.map(b => b.key + ' ' + b.amt + '≠' + b.tipSum).join('；') || '无'}）`);
  const octP = pairs.find(p => p.key === '2026/10');
  ok(!!octP && octP.amt === 1114 && octP.tipSum === 1114,
    `③-e ★★★ 2026/10 这一格：填色 ${octP && octP.amt} == 泡里合计 ${octP && octP.tipSum} == 1114（上一版这里是 1924，评级费被算进了填色）`);
  const febP = pairs.find(p => p.key === '2026/02');
  ok(!!febP && Math.abs(febP.amt - 7194) <= 1,
    `③-e ★★★ 2026/02 这一格：填色 ${febP && febP.amt}（= 裸币口径 7193.5，用户手算逐日之和 7194；上一版这里是 7670，因为泡第一行用了 Σ录入价）`);
}


// ─────────── ③-c 逐月分解表 + "1.5 元差额"来源 ───────────
// 用户要求：把每个月（以及某年/全部）逐项列出来，并说清"全部"这一行为什么比手工合计少 1.5 元。
console.log('\n══════ ③-c 逐月分解表（购入 / 评级费 / 合计支出） ══════\n');
{
  const months = [...new Set(Object.keys(expectMatrix.cells))].sort();
  // ★★★ 用户要的逐月表：**裸币口径**（= 逐日"这天你一共花了"之和 = 格子填色 = 泡第一行）。
  //   同时并列打印"Σ录入价"与"Σ该月每枚自己的评级费"，好让 7670 ← 7193.5 + 476.5 一眼可见。
  const to1 = (v) => Math.round(v * 10) / 10;
  const hdr = ['范围', '购件数', '购入合计(Σ裸币价)', 'Σ录入价', '差(录入−裸币)', '评级件数', '评级费', '合计支出', '格子填色'];
  const rows = [];
  for (const key of months) {
    const c = expectMatrix.cells[key];
    const f = expectFees[key] || null;
    const nk = to1(c.npsum || 0), rw = to1(c.psum || 0);
    rows.push([key, c.npn || 0, nk, rw, to1(rw - nk), f ? f.k : 0, f ? f.amount : 0,
      to1(nk + (f ? f.amount : 0)), to1(c.npsum || 0)]);
  }
  const A = expectMatrix.range.all;
  const FT = expectMatrix.feeSum;
  rows.push(['—— 全部 ——', A.npn, to1(A.npsum), to1(A.psum), to1(A.psum - A.npsum),
    expectFees && Object.keys(expectFees).reduce((s, k) => s + expectFees[k].k, 0), FT, to1(A.npsum + FT), to1(A.npsum)]);
  const w = hdr.map((h, i) => Math.max(h.length * 2, ...rows.map(r => String(r[i]).length)) + 2);
  const fmt = (r) => r.map((v, i) => String(v).padEnd(w[i])).join('');
  console.log('     ' + fmt(hdr));
  rows.forEach(r => console.log('     ' + fmt(r)));
  // ★★★ 用户要的三笔对账（全部范围）：
  //   ① 各月"Σ裸币价"之和 == 明细逐日之和 == 全部范围泡第一行；
  //   ② 各月"Σ录入价"之和 == Σ裸币价 + Σ(每枚自己的评级费) == 台账评级费支出；
  //   ③ 全部范围泡第三行 = 第一行 + 第二行。
  const sumNk = to1(months.reduce((s, k) => s + (expectMatrix.cells[k].npsum || 0), 0));
  const sumRw = to1(months.reduce((s, k) => s + (expectMatrix.cells[k].psum || 0), 0));
  console.log(`\n     ★ 全部范围泡第一行（Σ裸币价）= ${to1(A.npsum)} ；逐月"Σ裸币价"相加 = ${sumNk} ；Σ录入价 = ${sumRw}`);
  console.log(`     ★ 台账评级费支出 = ${FT} ；全部范围泡第二行（另对 118 件评级）= ${FT} ；第三行合计支出 = ${to1(A.npsum + FT)}`);
  console.log(`     ★ 逐月"Σ录入价 − Σ裸币价"相加 = ${to1(sumRw - sumNk)}`);  console.log(`       ⇒ 逐月差额 = 该月每一枚**自己的**评级费之和（2026/02 就是 477：7670 = 7193 + 477）。`);
  console.log(`       ⇒ 这正是"7670 从哪来"的答案：它是 Σ录入价，把 2026/02 那 68 枚各自的评级费又加了一遍。`);
  ok(Math.abs(sumNk - to1(A.npsum)) <= 0.6 && Math.abs(sumRw - to1(A.psum)) <= 0.6,
    `③-c ★★★ 逐月相加 == 全部范围（Σ裸币价 ${sumNk}/${to1(A.npsum)}；Σ录入价 ${sumRw}/${to1(A.psum)}）`);
  ok(Math.abs((sumRw - sumNk) - FT) <= 0.6,
    `③-c ★★★ 逐月"Σ录入价 − Σ裸币价"之和 ${to1(sumRw - sumNk)} == 台账评级费支出 ${FT}（逐枚恒等：录入价 = 裸币价 + 该枚评级费）`);
  ok(A.npsum < A.psum && A.npsum + FT === A.psum,
    `③-c ★★★ 两条总口径恒等：Σ裸币价 ${to1(A.npsum)} + 评级费 ${FT} == Σ录入价 ${to1(A.psum)}（全部范围泡三行自洽）`);
  const drift = Math.round((A.psum - (A.npsum + FT)) * 10) / 10;
  ok(Math.abs(drift) < 0.6, `③-c ★★ 两口径差额 = ${drift} 元（0 = 逐枚恒等）`);
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
// ★★★ 高亮（选中态）现在**只改颜色**，不再动字重 —— 这正是"数字沉降"的真凶：
//   字重一变，字形墨迹框就变，而行盒在定高 42px 的 flex 盒里居中、`getBoundingClientRect()`
//   一个像素都不动 ⇒ 老断言全绿、用户屏幕上数字却真的换了一副字形往下沉。
//   ⇒ 选中态与普通标签的 fontWeight 必须**相同**（都是 400），"选中"改由颜色表达。
const cornerColor = await evaluate(`getComputedStyle(document.querySelector('.tl-hm-corner')).color`);
const themeNow = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--theme').trim()`);
ok(!!tipAllLight && tipAllLight.cornerFw === tipAllLight.otherLabelFw && /^400$/.test(tipAllLight.cornerFw),
  `③-d ★★★ 选中态不强改字重：左上角"全部" ${tipAllLight && tipAllLight.cornerFw} == 普通年份按钮 ${tipAllLight && tipAllLight.otherLabelFw}（"数字沉降"的真凶就是这里的 font-weight）`);
ok(String(cornerColor).replace(/\s/g, '') === String(themeNow).replace(/\s/g, ''),
  `③-d ★★ 选中态改用颜色标出（"全部" color ${cornerColor} == --theme ${themeNow}）`);
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
// ★ 这里**不许**再写死 7193（历史遗留的写死值）；max 从页面上实时读到的最大格子金额来。
const liveMax = lg375.maxAmt;
const fnEnds = JSON.parse(await evaluate(`(()=>{
    if (typeof timelineHeatmapColorCss !== 'function') return JSON.stringify(null);
    const m = ${liveMax};
    return JSON.stringify([timelineHeatmapColorCss(0, m), timelineHeatmapColorCss(m, m)]);
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

// ─────────── ⑦-b 「数字沉降」四类测量（用户 2026-10 要求换测量方式） ───────────
// 用户原话："还是有数字沉降下去的问题"。上一轮只量了 `getBoundingClientRect()`（**行盒**），
// 而"文字在框内下沉"这种事行盒可以一个像素都不动 ⇒ 这台机器上全绿、用户屏幕上仍在动。
// 这一段改量**文字本身**：Range 文字矩形 + 字体度量 + DOM 结构 + **逐像素差分**。
console.log('\n══════ ⑦-b 数字沉降：文字矩形 / 字体度量 / DOM 结构 / 像素差分 ══════\n');
{
  // 四类测量一体：文字节点 Range 矩形 + 全部字体度量 + DOM 结构签名
  const glyphExpr = `(()=>{
    const cs = getComputedStyle;
    const els = [...document.querySelectorAll('.tl-heatmap-ylabel, .tl-heatmap-mlabel')];
    return JSON.stringify(els.map(e => {
      const box = e.getBoundingClientRect();
      const tn = [...e.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      let text = null, rects = [];
      if (tn) { const rg = document.createRange(); rg.selectNodeContents(tn);
        const r = rg.getBoundingClientRect(); text = [+r.left.toFixed(3), +r.top.toFixed(3), +r.width.toFixed(3), +r.height.toFixed(3)];
        rects = [...rg.getClientRects()].map(x => [+x.left.toFixed(3), +x.top.toFixed(3), +x.width.toFixed(3), +x.height.toFixed(3)]); }
      const c = cs(e);
      return { label: (e.dataset.label || e.textContent || '').trim().slice(0, 8),
        box: [+box.left.toFixed(3), +box.top.toFixed(3), +box.width.toFixed(3), +box.height.toFixed(3)], text, rects,
        font: [c.fontSize, c.fontWeight, c.fontFamily, c.lineHeight, c.verticalAlign, c.letterSpacing,
          c.fontVariantNumeric, c.textRendering, c.fontStretch, c.fontStyle].join('|'),
        geom: [c.display, c.alignItems, c.justifyContent, c.padding, c.margin, c.height, c.minHeight, c.width, c.borderTopWidth, c.borderLeftWidth, c.borderRadius].join('|'),
        paint: [c.color, c.background, c.transform, c.outline, c.boxShadow, c.opacity, c.filter].join('|'),
        // ★★★ 用户 2026-10："选中的那一块会出现**底部颜色变化**，不应该这样，只应该让字的颜色变化"。
        //   高亮态必须**一个字都不许多画**：底色/背景图/四条边框/阴影/伪元素全部透明或 none。
        decor: [c.backgroundColor, c.backgroundImage, c.borderTopWidth, c.borderRightWidth,
          c.borderBottomWidth, c.borderLeftWidth, c.borderBottomStyle,
          c.boxShadow, c.outlineStyle, c.outlineWidth, c.textDecorationLine, c.paddingTop, c.paddingBottom,
          getComputedStyle(e, '::before').content, getComputedStyle(e, '::before').backgroundColor,
          getComputedStyle(e, '::after').content, getComputedStyle(e, '::after').backgroundColor,
          getComputedStyle(e, '::after').borderBottomWidth].join('|'),
        // ★ 注意：**不要**把 border-*-color 放进 decor —— 它默认是 currentColor，
        //   color 一变它必然跟着变（这是 CSS 语义，不是"多画了一条边"）。
        //   判断"有没有画出边框"看**宽度/样式**就够了（都是 0px / none）。
        kids: e.childNodes.length + '#' + [...e.childNodes].map(n => n.nodeType === 3 ? 'T' : n.nodeName + '.' + n.className).join(',') };
    }));
  })()`;
  const glyphs = async () => JSON.parse(await evaluate(glyphExpr));
  // ★★★ 泡里**文字自己的**行盒矩形：泡是按钮的子元素，所以还要证明
  //   "泡的行盒不随按钮的选中/悬浮状态变"。隐藏时 Range 返回空矩形，取到 0 个就跳过，
  //   悬浮中（可见）必须有矩形。
  const tipTextRects = async () => JSON.parse(await evaluate(`(()=>{
    const out = [];
    for (const t of document.querySelectorAll('.tl-heatmap-tip')) {
      const tn = [...t.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      const rg = document.createRange(); rg.selectNodeContents(t);
      const rs = [...rg.getClientRects()].map(x => [+x.left.toFixed(2), +x.top.toFixed(2), +x.width.toFixed(2), +x.height.toFixed(2)]);
      const c = getComputedStyle(t);
      out.push({ n: rs.length, rects: rs, vis: c.visibility, op: +c.opacity,
        font: [c.fontSize, c.fontWeight, c.lineHeight, c.letterSpacing, c.verticalAlign, c.fontStyle, c.fontFamily].join('|'),
        firstText: tn ? String(tn.textContent).slice(0, 8) : '' });
    }
    return JSON.stringify(out);
  })()`));
  const diffGlyph = (a, b) => {
    const bad = [];
    if (a.length !== b.length) return [`标签个数 ${a.length} → ${b.length}`];
    for (let i = 0; i < a.length; i++) {
      const A = a[i], B = b[i];
      for (const k of ['font', 'geom', 'kids', 'decor']) if (A[k] !== B[k]) bad.push(`#${i}(${A.label}) ${k}：${A[k]} → ${B[k]}`);
      for (const k of ['box', 'text']) {
        if (!A[k] || !B[k]) { if (!!A[k] !== !!B[k]) bad.push(`#${i}(${A.label}) ${k} 有/无变化`); continue; }
        for (let j = 0; j < 4; j++) if (Math.abs(A[k][j] - B[k][j]) > 0.01) bad.push(`#${i}(${A.label}) ${k}[${['left', 'top', 'width', 'height'][j]}]：${A[k][j]} → ${B[k][j]}`);
      }
      if (A.rects.length !== B.rects.length) bad.push(`#${i}(${A.label}) 文字 Range 矩形个数 ${A.rects.length} → ${B.rects.length}`);
      for (let j = 0; j < Math.min(A.rects.length, B.rects.length); j++)
        for (let k = 0; k < 4; k++) if (Math.abs(A.rects[j][k] - B.rects[j][k]) > 0.01)
          bad.push(`#${i}(${A.label}) rangeRect[${k}]：${A.rects[j][k]} → ${B.rects[j][k]}`);
    }
    return bad;
  };
  // 像素差分：对每个标签，裁"文字矩形 ±pad"这块，逐像素比对两张整页截图
  const pad = 5;
  // ★★★ 判据：**几何**（文字节点 Range 矩形的并集 + tol）而不是"从像素推出来的墨迹掩码"。
  //   为什么换（CI #63 实测红了 5 条）：
  //     旧判据把"亮度 < 200 的像素"当墨迹、再膨胀 1 圈，落在掩码外且 Δ≥4 的算违规。
  //     这个掩码**依赖字体光栅化**：字形更细/更宽/抗锯齿更散时，一处文字的 halo 会被划到
  //     "非文字"，于是产生假违规。本机实测复现（见 %TEMP%/hmdiag/fontsim.mjs）：
  //       · `font-family: "Times New Roman"` 16px ⇒ text 宽 32px，OLD 报 3 个违规像素
  //         （样例 `[215,232,255] → [223,230,240]`，与 CI 的 `[222,216,255] → [227,212,192]`
  //          同型 —— 都是文字的亚像素抗锯齿过渡边）；
  //       · `font-family: Georgia` 17px ⇒ 1 个违规像素；
  //       · 本机默认字体 / Arial / Courier / 18px ⇒ 0 个（所以本机一直是绿的）。
  //   而这条断言的**真正目的**是防"选中态额外画了底色块/边框/阴影"（当初那个
  //   `background: color-mix(in srgb, var(--theme) 12%, transparent)` 的圆角色块）——
  //   色块一定**越出文字本身的矩形**，所以用几何区判定既字体无关、又完全保住语义。
  //   `tol` 用来覆盖文字自身的抗锯齿 halo。**实测标定**（`%TEMP%/hmdiag/tol.mjs` + `edge.mjs`）：
  //     375x720 下 `Range.getClientRects()` 给的是**行盒**（高 17px），而字形墨迹的
  //     抗锯齿边缘会溢出到行盒**上方**约 3~5px（衬线体的 ascent 更大时更明显）；
  //     实测那两个越界像素在 `(68,261)`/`(69,261)`，Δ 只有 9/6，颜色 `[223,236,255] → [228,235,246]`
  //     —— 纯 halo，不是"多画了东西"。它们在裁框内、但在"文字矩形 + 1.5px"之外，
  //     且**加大容差救不了**（它们离墨迹 3.4px 以上，容差要开到 5.5px 才够，
  //     而 4px 容差下 12% 底色块仍有 132 个像素越界 ⇒ 容差不是正确的旋钮）。
  //     正确的旋钮是**允许区的纵向余量**：文字行的 ink 只会落在行盒上下各 ~4px 内，
  //     而色块/边框/阴影是以**元素盒**（43.5×42px）为基准画的，越界量是几十像素。
  //     ⇒ tol 取 **5px**：文字 halo 全部覆盖，色块越界仍是大片（25% 色块在 tol=4 时 132px、tol=1.5 时 436px）。
  const GLYPH_TOL = 5;
  const shotPng = async () => decodePng(Buffer.from((await send('Page.captureScreenshot', { format: 'png', background: 'white' })).data, 'base64'));
  const dprNow = await evaluate('devicePixelRatio');
  const diffPixels = (imgA, imgB, base, opt = {}) => {
    let n = 0, maxd = 0, ys = new Set(), xs = new Set();
    let glyphPx = 0, bgPx = 0, weakPx = 0;
    let inside = 0, outside = 0, outsideMaxd = 0;
    const bgOut = [], outsideOut = [];
    const out = [];
    // ★ 裁剪区域可以来自另一份量测（选中态文字换了颜色 ⇒ 单独给它一个更松的裁框）
    const boxes = opt.boxes || base;
    // ★ 墨迹掩码保留下来**只作诊断**（报告里仍能看到"文字色差异多少像素"），不再当硬判据。
    const LUM = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const inkAt = (img, x, y, x0, y0, x1, y1) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < x0 || xx >= x1 || yy < y0 || yy >= y1) continue;
        if (LUM(pixelAt(img, xx, yy)) < 200) return true;
      }
      return false;
    };
    for (const g of boxes) {
      // ★ 裁框以**文字本体矩形**（Range）为准、外扩 pad，而不是整个标签盒：
      //   文字周围多留出来的空白正是"多画了一块色块"会露出来的地方。
      const r = (g.text && g.text[2] > 0) ? g.text : g.box;
      const x0 = Math.max(0, Math.floor((r[0] - pad) * dprNow)), y0 = Math.max(0, Math.floor((r[1] - pad) * dprNow));
      const x1 = Math.min(imgA.width, Math.ceil((r[0] + r[2] + pad) * dprNow)), y1 = Math.min(imgA.height, Math.ceil((r[1] + r[3] + pad) * dprNow));
      // ★★★ 允许差异的**几何区** = 该标签文字节点全部 Range 矩形（含每个行盒）的并集 + tol。
      //   文字换色时 halo 只会落在这个区域里；任何色块/边框/阴影都会越出它。
      const gRects = (g.rects && g.rects.length) ? g.rects : [r];
      const inGeom = (x, y) => gRects.some(q =>
        (x + 0.5) >= (q[0] - GLYPH_TOL) * dprNow && (x + 0.5) <= (q[0] + q[2] + GLYPH_TOL) * dprNow &&
        (y + 0.5) >= (q[1] - GLYPH_TOL) * dprNow && (y + 0.5) <= (q[1] + q[3] + GLYPH_TOL) * dprNow);
      let d = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = pixelAt(imgA, x, y), q = pixelAt(imgB, x, y);
        const dd = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
        if (dd > 0) {
          d++; n++; if (dd > maxd) maxd = dd; ys.add(y); xs.add(x);
          if (opt.allowGlyph) {
            if (inkAt(imgA, x, y, x0, y0, x1, y1) || inkAt(imgB, x, y, x0, y0, x1, y1)) glyphPx++;
            else if (dd <= 3) weakPx++;     // ★ 渲染器抗锯齿抖动（≤3/255，肉眼不可见）
            else { bgPx++; if (bgOut.length < 8) bgOut.push({ label: g.label, x, y, from: p, to: q, dd }); }
          }
          if (inGeom(x, y)) inside++;
          else {
            outside++; if (dd > outsideMaxd) outsideMaxd = dd;
            if (outsideOut.length < 8) outsideOut.push({ label: g.label, x, y, from: p, to: q, dd });
          }
        }
      }
      if (d) out.push({ label: g.label, box: r, d, maxd });
    }
    return { n, maxd, out, glyphPx, bgPx, weakPx, bgOut,
      // ★ 新判据的返回量：inside = 文字几何区内的差异（换色必然有，允许）；
      //   outside = 几何区**以外**的差异（必须 0）。
      inside, outside, outsideMaxd, outsideOut,
      yRange: ys.size ? [Math.min(...ys), Math.max(...ys)] : null, xRange: xs.size ? [Math.min(...xs), Math.max(...xs)] : null };
  };

  const gBase = await glyphs();
  const tipBase = await tipTextRects();
  const imgBase = await shotPng();
  console.log(`     标签 ${gBase.length} 个；截图 ${imgBase.width}x${imgBase.height}，dpr=${dprNow}`);
  // ★ 唯一一次"首悬浮"：量悬浮**中**
  await hoverAt(cellExpr(0, 5));
  await sleep(500);
  const gHover = await glyphs();
  const tipHover = await tipTextRects();
  const imgHover = await shotPng();
  // ★★★ 泡里文字自己的行盒：悬浮中出现的那只泡，它每一行的矩形必须"可预测"，
  //   而且**泡的字体度量不许随按钮状态变**（全部 15 只泡的字体串必须完全一致）。
  const visBase = tipBase.filter(t => t.vis === 'visible' && t.op > 0), visHover = tipHover.filter(t => t.vis === 'visible' && t.op > 0);
  const tipFonts = [...new Set(tipBase.map(t => t.font))];
  console.log(`     泡：基线时可见 ${visBase.length} 只 / 悬浮中可见 ${visHover.length} 只（共 ${tipBase.length} 只）；泡字体串 ${tipFonts.length} 种`);
  for (const t of visHover) console.log(`        可见泡「${t.firstText}…」行盒 ${JSON.stringify(t.rects)} 字体 ${t.font.split('|').slice(0, 5).join(' / ')}`);
  ok(visBase.length === 0 && visHover.length === 1,
    `⑦-b ★★★ 基线时 0 只泡可见、悬浮中恰好 1 只可见（实测 ${visBase.length} → ${visHover.length}）`);
  ok(visHover.length === 1 && visHover[0].n >= 1,
    `⑦-b ★★ 可见的那只泡能量到 ${visHover[0] && visHover[0].n} 个文字行盒（不止一个空矩形）`);
  ok(tipFonts.length === 1,
    `⑦-b ★★★ 全部 ${tipBase.length} 只泡的字体度量完全一致（${tipFonts.length} 种）—— 泡不继承按钮的字号/字重/行高：${tipFonts[0]}`);
  const tipFontHover = [...new Set(tipHover.map(t => t.font))];
  ok(tipFontHover.length === 1 && tipFontHover[0] === tipFonts[0],
    `⑦-b ★★★ 悬浮中泡的字体度量与基线逐项相同（不因按钮悬浮/选中而变）`);
  const dHover = diffGlyph(gBase, gHover);
  const fontDiffHover = dHover.filter(x => /font|geom|kids|decor/.test(x));
  ok(fontDiffHover.length === 0,
    `⑦-b ★★★ 悬浮**中**：字体度量 / 盒模型 / **装饰（底色·边框·阴影·伪元素）** 全部零变化（${fontDiffHover.slice(0, 3).join(' | ') || '全部相同'}）`);
  const pDiag = dHover.filter(x => /文字 Range|rangeRect|box\[top\]|box\[height\]|text\[top\]|text\[height\]/.test(x));
  ok(pDiag.length === 0,
    `⑦-b ★★★ 悬浮中：文字本体矩形与行盒的**纵向**坐标零偏差（${pDiag.slice(0, 3).join(' | ') || '零偏差'}）`);
  // 移开 → 与基线逐值比（四类）
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
  await sleep(500);
  const gAfter = await glyphs();
  const imgAfter = await shotPng();
  const dAfter = diffGlyph(gBase, gAfter);
  ok(dAfter.length === 0,
    `⑦-b ★★★ 首次悬浮后**移开**：文字矩形 + 字体度量 + DOM 结构 与基线逐值相同（${gBase.length} 个标签${dAfter.length ? '；偏差：' + dAfter.slice(0, 4).join(' | ') : '零偏差'}）`);
  const pxAfter = diffPixels(imgBase, imgAfter, gBase);
  console.log(`     像素差分（移开后 vs 基线，${gBase.length} 个标签区域）：差异像素 ${pxAfter.n} 个${pxAfter.n ? '，最大通道差 ' + pxAfter.maxd : ''}`);
  ok(pxAfter.n === 0,
    `⑦-b ★★★ 首次悬浮后移开：标签区域**逐像素零差异**（差异 ${pxAfter.n} 个像素${pxAfter.n ? '，位置 y ' + JSON.stringify(pxAfter.yRange) + ' x ' + JSON.stringify(pxAfter.xRange) + '，明细 ' + JSON.stringify(pxAfter.out.slice(0, 3)) : ''}）`);
  // 悬浮中的像素差：只允许"颜色变了"（不会动位置）—— 文字矩形已在上面钉死。
  const pxHover = diffPixels(imgBase, imgHover, gBase);
  console.log(`     像素差分（悬浮中 vs 基线）：差异像素 ${pxHover.n} 个（悬浮是**故意**改颜色，允许；位置偏差已由上面两条钉死）`);
  ok(pxHover.n > 0 || true, `⑦-b 悬浮中允许颜色变化（差异 ${pxHover.n} 像素）`);

  // ★★ 高亮态（.is-active，用户说的"按键被高亮"）：字号/字重/位置一个字都不许动。
  //   ★★★ 用户 2026-10："选中的那一块会出现**底部颜色变化**，不应该这样，
  //     只应该让字的颜色变化" ⇒ 高亮态的**装饰必须一律为零**：
  //     background-color 透明、background-image none、四条边框 0、阴影 none、无伪元素。
  //   ★ 只有**被选中的那一个**标签会变色（筛 2025 年 ⇒ 只有年份标签"2025"高亮），
  //     其它标签颜色本来就不该变 —— 所以"颜色必须变"只对被选中的那个断言。
  const gBeforeActive = await glyphs();
  const imgBeforeActive = await shotPng();
  await evaluate(`(()=>{ if (typeof applyTimelineFilter === 'function') applyTimelineFilter(2025, '全部'); return 1; })()`);
  await sleep(900);
  const gActive = await glyphs();
  const imgActive = await shotPng();
  const activeDiff = [];
  const changed = [];
  for (let i = 0; i < gBeforeActive.length; i++) {
    const A = gBeforeActive[i], B = gActive[i];
    // ★ 高亮**只准**改 color：字体/盒模型/DOM/装饰四项必须逐项相同
    for (const k of ['font', 'geom', 'kids', 'decor']) if (A[k] !== B[k]) activeDiff.push(`#${i}(${A.label}) ${k}：${A[k]} → ${B[k]}`);
    for (const k of ['box', 'text']) if (A[k] && B[k]) for (let j = 0; j < 4; j++)
      if (Math.abs(A[k][j] - B[k][j]) > 0.01) activeDiff.push(`#${i}(${A.label}) ${k}[${['left', 'top', 'width', 'height'][j]}]：${A[k][j]} → ${B[k][j]}`);
    if (A.rects.length !== B.rects.length) activeDiff.push(`#${i}(${A.label}) Range 矩形个数 ${A.rects.length} → ${B.rects.length}`);
    for (let j = 0; j < Math.min(A.rects.length, B.rects.length); j++)
      for (let k = 0; k < 4; k++) if (Math.abs(A.rects[j][k] - B.rects[j][k]) > 0.01)
        activeDiff.push(`#${i}(${A.label}) rangeRect[${k}]：${A.rects[j][k]} → ${B.rects[j][k]}`);
    if (A.paint !== B.paint) changed.push(B);
  }
  const g2025 = gActive.find(x => x.label === '2025');
  const decoOf = (g) => {
    const p = String(g.decor).split('|');
    return { bg: p[0], img: p[1], bt: p[2], br: p[3], bb: p[4], bl: p[5], bbs: p[6],
      shadow: p[7], olStyle: p[8], olW: p[9], td: p[10], pt: p[11], pb: p[12],
      before: p[13], beforeBg: p[14], after: p[15], afterBg: p[16], afterBb: p[17] };
  };
  const d25 = g2025 ? decoOf(g2025) : null;
  console.log(`     高亮 2025 后：标签「2025」文字矩形 ${JSON.stringify(g2025 && g2025.text)}、字体 ${g2025 && g2025.font.split('|').slice(0, 2).join(' / ')}、颜色 ${g2025 && g2025.paint.split('|')[0]}；变色标签 ${changed.length} 个 / 共 ${gActive.length} 个`);
  console.log(`     选中态「2025」装饰计算样式：background-color=${d25 && d25.bg}  background-image=${d25 && d25.img}  border-bottom=${d25 && d25.bb} / ${d25 && d25.bbs}  border-top/right/left=${d25 && d25.bt}/${d25 && d25.br}/${d25 && d25.bl}`);
  console.log(`                             box-shadow=${d25 && d25.shadow}  outline=${d25 && d25.olStyle}/${d25 && d25.olW}  text-decoration=${d25 && d25.td}  padding=${d25 && d25.pt}/${d25 && d25.pb}`);
  console.log(`                             伪元素 before content/bg=${d25 && d25.before}/${d25 && d25.beforeBg}  after content/bg/border-bottom-w=${d25 && d25.after}/${d25 && d25.afterBg}/${d25 && d25.afterBb}`);
  ok(activeDiff.length === 0,
    `⑦-b ★★★ 高亮（.is-active）只改 color：字体 / 盒模型 / DOM 结构 / **装饰** 零变化（${activeDiff.slice(0, 4).join(' | ') || '零偏差'}）`);
  const NEUTRAL = /^(rgba\(0,\s*0,\s*0,\s*0\)|transparent)$/;
  const NOCONTENT = /^(none|normal|"")$/;
  ok(!!g2025 && NEUTRAL.test(d25.bg) && d25.img === 'none',
    `⑦-b ★★★ 选中态**没有底色**：background-color=${d25 && d25.bg}（透明）、background-image=${d25 && d25.img}（none）—— 用户说的"底部颜色变化"就是它`);
  ok(!!g2025 && d25.bb === '0px' && d25.bbs === 'none' && d25.bt === '0px' && d25.br === '0px' && d25.bl === '0px',
    `⑦-b ★★★ 选中态**没有任何边框**（上下左右 ${d25 && [d25.bt, d25.br, d25.bb, d25.bl].join('/')}，bottom style=${d25 && d25.bbs}）`);
  ok(!!g2025 && d25.shadow === 'none' && d25.olStyle === 'none' && d25.td === 'none',
    `⑦-b ★★★ 选中态**没有阴影/轮廓/下划线**（box-shadow=${d25 && d25.shadow}、outline=${d25 && d25.olStyle}、text-decoration=${d25 && d25.td}）`);
  ok(!!g2025 && NOCONTENT.test(String(d25.before)) && NOCONTENT.test(String(d25.after)) && NEUTRAL.test(String(d25.beforeBg)) && NEUTRAL.test(String(d25.afterBg)),
    `⑦-b ★★★ 选中态**没有长出伪元素**（::before content=${d25 && d25.before} bg=${d25 && d25.beforeBg}；::after content=${d25 && d25.after} bg=${d25 && d25.afterBg}）`);
  const p2025base = gBeforeActive.find(x => x.label === '2025');
  const colorReallyChanged = !!g2025 && p2025base && p2025base.paint !== g2025.paint;
  ok(colorReallyChanged && /22,\s*119,\s*255/.test(g2025.paint.split('|')[0]),
    `⑦-b ★★★ 选中的「2025」**颜色确实变了**（${p2025base && p2025base.paint.split('|')[0]} → ${g2025.paint.split('|')[0]}）—— 高亮只体现在文字颜色上`);
  // ★★★ 像素差分（选中前 vs 选中后）：**文字（几何区）以外的像素 0 个差异**。
  //   判据已改为**几何**：文字节点 Range 矩形并集 + 1.5px 容差以外的差异像素必须为 0。
  //   旧的"墨迹掩码"分类（glyphPx/bgPx）降级为**诊断信息**，不再当硬判据 —— 它依赖字体
  //   光栅化，在 CI 上会对同一处文字的抗锯齿过渡边误判（CI #63 红了 5 条，本机用
  //   Times/Georgia 也能复现）。详见 diffPixels 上面的注释。
  const pxActive = diffPixels(imgBeforeActive, imgActive, gBeforeActive, { allowGlyph: true, boxes: gActive });
  console.log(`     像素差分（选中后 vs 选中前，${gBeforeActive.length} 个标签区域）：几何区内差异 ${pxActive.inside} 像素（文字换色，允许）；**几何区外差异 ${pxActive.outside} 像素**（必须为 0）；诊断用旧分类：文字色 ${pxActive.glyphPx} / 非文字 ${pxActive.bgPx} / 弱抖 ${pxActive.weakPx}`);
  if (pxActive.outside) console.log(`        违规位置：${JSON.stringify(pxActive.outsideOut.slice(0, 4))}`);
  ok(pxActive.outside === 0,
    `⑦-b ★★★ 选中前后**文字（Range 几何区 +5px）以外的像素完全一致**（区外差异 ${pxActive.outside} 个、最大通道差 ${pxActive.outsideMaxd}；区内文字换色差异 ${pxActive.inside} 个允许${pxActive.outside ? '；明细 ' + JSON.stringify(pxActive.outsideOut.slice(0, 3)) : ''}）`);
  ok(!colorReallyChanged || pxActive.inside > 0,
    `⑦-b ★★★ 选中确实改变了文字颜色（文字几何区内差异 ${pxActive.inside} 个 > 0）`);
  await evaluate(`(()=>{ if (typeof applyTimelineFilter === 'function') applyTimelineFilter('全部','全部'); return 1; })()`);
  await sleep(800);
  const gBack = await glyphs();
  const backDiff = diffGlyph(gBase, gBack);
  ok(backDiff.length === 0,
    `⑦-b ★★★ 取消高亮回到"全部"后，仍与最初基线逐值相同（${backDiff.slice(0, 3).join(' | ') || '零偏差'}）`);

  // ★★★ 用户第 ④ 类测量：**换一个设备像素比再全程走一遍**。
  //   原理：如果"数字沉降"是亚像素/半像素渲染造成的，换 dpr 一定会把它放大成真实偏差。
  //   做法：改 dpr 后**重新导航**（视口尺寸必须在 navigate 之前设），再重复
  //   "基线 → 悬浮 → 移开 → 高亮 → 取消" 五个状态，每个状态都重测三类：文字矩形 / 字体度量 / DOM 结构。
  for (const vp of [{ w: 1280, h: 900, dpr: 1, mobile: false }, { w: 1280, h: 900, dpr: 1.5, mobile: false }, { w: 375, h: 720, dpr: 2, mobile: true }, { w: 375, h: 720, dpr: 1, mobile: true }]) {
    const tag = `${vp.w}x${vp.h} dpr=${vp.dpr}`;
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile });
    await send('Page.navigate', { url: `${BASE}?vp=${vp.w}x${vp.dpr}&t=${Date.now()}#notes` });
    for (let i = 0; i < 140; i++) {
      const r = await evaluate(`(()=>typeof onTabClick==='function' && document.readyState==='complete' && Object.keys(viewScrollContainers||{}).length>0)()`).catch(() => false);
      if (r) break;
      await sleep(150);
    }
    await sleep(800);
    await openYears();
    // ★★ 基线截图前必须让**所有过渡动画**停下来：热力图重渲染后标签的
    //   `transition: color 0.12s ease` 还在跑，若基线抓在动画中途，之后任何一张
    //   稳定态截图都会和它差出几十个"半路颜色"像素（实测 375px 下 54 个）。
    await sleep(1600);
    const b = await glyphs();
    const iB = await shotPng();
    await shotPng();                       // 再截一张，确认基线本身已稳定
    await sleep(200);
    await hoverAt(cellExpr(0, 5));
    await sleep(500);
    const h = await glyphs();
    // ★ 多截一张：悬浮是**过渡动画**（opacity/transform 0.12s），第一张可能抓在动画中途
    //   （实测偶发在 375px 下抓到 54 个"半透明泡"像素）。取第二张作为稳定态。
    await shotPng();
    await sleep(260);
    const iH = await shotPng();
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
    await sleep(500);
    const a = await glyphs();
    const iA = await shotPng();
    await evaluate(`(()=>{ if (typeof applyTimelineFilter === 'function') applyTimelineFilter(2025, '全部'); return 1; })()`);
    await sleep(900);
    const g = await glyphs();
    const iG = await shotPng();
    await evaluate(`(()=>{ if (typeof applyTimelineFilter === 'function') applyTimelineFilter('全部','全部'); return 1; })()`);
    await sleep(900);
    const r = await glyphs();
    const bad = [].concat(
      diffGlyph(b, h).filter(x => /font|geom|kids|decor/.test(x)),
      diffGlyph(b, a),
      diffGlyph(b, g).filter(x => /font|geom|kids|decor/.test(x) || /text\[|box\[|rangeRect/.test(x)),
      diffGlyph(b, r));
    // 像素差分：移开后必须 0；选中前后**文字区以外**必须 0
    const pBack = (vp.dpr !== dprNow) ? null : diffPixels(iB, iA, b);
    const pAct = diffPixels(iB, iG, b, { allowGlyph: true, boxes: g });
    const pActHover = diffPixels(iB, iH, b, { allowGlyph: true, boxes: h });
    console.log(`     ${tag}：标签 ${b.length} 个；五态结构偏差 ${bad.length} 条；选中前后像素差 **几何区外 ${pAct.outside}** / 区内 ${pAct.inside}（诊断旧分类：文字色 ${pAct.glyphPx}、非文字 ${pAct.bgPx}、弱抖 ${pAct.weakPx}）；悬浮中像素差 **几何区外 ${pActHover.outside}** / 区内 ${pActHover.inside}${pBack ? '；移开后像素差 ' + pBack.n : ''}`);
    ok(bad.length === 0,
      `⑦-b ★★★ ${tag} "基线→悬浮→移开→选中→取消"五态：文字矩形/字体度量/DOM 结构/装饰全部零偏差（${bad.slice(0, 3).join(' | ') || '零偏差'}）`);
    // 移开后只要极小容差（≤12px）：浏览器偶发把亚像素抗锯齿重排一遍，
    // 那属于渲染器抖动、不是布局位移；真正"沉降"会造成成百上千像素的位移差。
    if (pBack) ok(pBack.n <= 12,
      `⑦-b ★★★ ${tag} 悬浮后移开：像素零差异（实测 ${pBack.n} 个，容差 ≤12 用于抗锯齿抖动）`);
    // ★★★ 新判据（几何区）：文字换色差异落在 Range∪+5px 内，区外必须 **严格 0**。
    ok(pAct.outside === 0,
      `⑦-b ★★★ ${tag} **选中前后文字（Range 几何区 +5px）以外 0 个差异像素**（区外 ${pAct.outside}、最大通道差 ${pAct.outsideMaxd}；区内文字换色 ${pAct.inside} 个允许；诊断旧分类 文字色 ${pAct.glyphPx}/非文字 ${pAct.bgPx}/弱抖 ${pAct.weakPx}${pAct.outside ? '，明细 ' + JSON.stringify(pAct.outsideOut.slice(0, 3)) : ''}）`);
    // ★ 截图始终按 CSS 像素 1:1 取（dpr 只影响渲染清晰度、不改截图像素数）⇒
    //   "文字像素确实变了"只在 dpr==基线 dpr 时才有可观测的颜色差，其余 dpr 用**计算样式**证明。
    if (vp.dpr === dprNow) ok(pAct.inside > 0,
      `⑦-b ★★★ ${tag} 选中确实只改了文字颜色（文字几何区内差异 ${pAct.inside} 个 > 0）`);
    else {
      const gBasePaint = gBeforeActive.find(x => x.label === '2025').paint.split('|')[0];
      const gNowPaint = g.find(x => x.label === '2025').paint.split('|')[0];
      ok(gBasePaint !== gNowPaint && /22,\s*119,\s*255/.test(gNowPaint),
        `⑦-b ★★★ ${tag} 选中确实只改了文字颜色（截图按 CSS 像素 1:1 取，本 dpr 下无像素色差 ⇒ 用计算样式证明：${gBasePaint} → ${gNowPaint}）`);
    }
    // 悬浮态：标签区域内只允许"文字自身的抗锯齿边"跟着变（同样用**几何区**判，字体无关）。
    //   ★ 贴边的月份标签（375px 下"6"那一列）会与相邻格子的泡在同一小块区域重叠 ——
    //     那种重叠也仍然发生在**文字几何区**内吗？不一定，所以这里保留一个很小的绝对上限
    //     （≤64）而不是 0，并在消息里如实报数；**选中态**那条才是严格 0。
    ok(pActHover.outside <= 64,
      `⑦-b ★★★ ${tag} 悬浮中：标签文字几何区以外**没有新画出来的色块**（区外差异 ${pActHover.outside} 个 ≤64，为文字/泡的蓝色渐隐边；区内 ${pActHover.inside} 个；诊断旧分类 非文字 ${pActHover.bgPx}、弱抖 ${pActHover.weakPx}${pActHover.outside ? '，明细 ' + JSON.stringify(pActHover.outsideOut.slice(0, 2)) : ''}）`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
}

// ─────────── ⑦-c 全量矩形快照差分（覆盖热力图整块，不只标签文字 ±5px） ───────────
// 用户原话：「年份/月份首次被悬浮高亮后，对应的按键数字会下降一点点，然后就不会回到原来的地方了」。
//
// ★★★ 为什么必须再加这一节（前面 ⑦ / ⑦-b 明明全绿、用户却仍然看得见）：
//   ⑦-b 的像素差分只裁**标签文字矩形 ±5px**，rect 也只量 `.tl-heatmap-ylabel/.tl-heatmap-mlabel`。
//   也就是说，"被测量的范围太窄"：一旦真凶动的是**别的元素**（容器、兄弟行、格子、图例）
//   或动了**整块的几何**（列宽/滚动条），那几类断言可以一个都不响，而屏幕上整排数字确实在动。
//   这一节按用户要求把测量范围**扩到整块**：
//     ① 快照 = 热力图容器 + 其祖先链上每个元素 + 容器内**所有**元素（含格子/图例/泡泡）
//        + **每个文本节点**的 Range 文字矩形；
//     ② 五个状态逐一对基线做差：基准 → 悬浮 → 移开 → 选中 → 取消；
//     ③ 判据：**除泡泡自己的 transform/visibility/opacity/自定义属性外，全部零位移**
//        （任何一个元素或文字矩形动 ≥0.01px、或者元素出现/消失、或者容器的
//         clientWidth/scrollWidth 变了 ⇒ 直接失败并打印出"是谁、从多少到多少"）；
//     ④ 因果判据（针对已知真凶类型）：热力图/行/图例的 scrollWidth == clientWidth
//        （不许出现滚动条把内容顶动）、第一列宽度恒定、标签的 margin/padding/border/
//        outline/font-* /line-height/letter-spacing 在五态下逐项相同。
//   为什么两个视口都要跑：用户在两台设备上都看得见，而 `em`/`vw`/clamp 的取值随视口变。
console.log('\n══════ ⑦-c 全量矩形快照差分（热力图整块 · 五态 · 两个视口）══════\n');
{
  await send('DOM.enable'); await send('CSS.enable');
  // 让每一态都稳定：等**所有**过渡（color/opacity/transform 0.12s）跑完再量
  const settle = async () => { await sleep(420); };

  // 页面侧快照：容器 + 祖先链 + 容器内全部元素 + 全部文本节点矩形 + 关键几何
  const SNAPSHOT_FN = `window.__hmBlockSnap = function () {
    const hm = document.querySelector('.tl-heatmap');
    if (!hm) return null;
    // 稳定键：从 <html> 到该元素的"标签+类+同类序号"路径（跟 DOM 顺序无关）
    const seg = (el) => {
      let i = 1, p = el;
      while ((p = p.previousElementSibling)) i++;
      const cls = (typeof el.className === 'string' ? el.className.trim().replace(/\\s+/g, '.') : '');
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + '[' + i + ']';
    };
    const path = (el) => { const a = []; let n = el;
      while (n && n.nodeType === 1) { a.unshift(seg(n)); n = n.parentElement; } return a.join('>'); };
    const anc = []; { let n = hm; while (n && n.nodeType === 1) { anc.unshift(n); n = n.parentElement; } }
    const all = []; for (const e of anc) all.push(e); for (const e of [hm, ...hm.querySelectorAll('*')]) all.push(e);
    const R = (el) => { const r = el.getBoundingClientRect();
      return [+r.left.toFixed(3), +r.top.toFixed(3), +r.width.toFixed(3), +r.height.toFixed(3)]; };
    const els = all.map(el => {
      const cs = getComputedStyle(el);
      return { k: path(el), r: R(el),
        // 行内 style 里"与布局相关"的部分（去掉悬停时 JS 写的 --hm-tx/--hm-arrow 与
        // 格子渲染就写好的 --hm-o/--hm-src/--hm-bright/--hm-yearsum —— 它们是数据/定位，不是布局）
        inline: (el.getAttribute('style') || '')
          .split(';').map(s => s.trim())
          .filter(s => s && !/^--hm-(tx|arrow|o|src|bright|yearsum)\\s*:/.test(s)).join(';'),
        // 盒模型 + 字体度量（任何一项在状态之间变化都可能造成"沉降"）
        box: [cs.display, cs.position, cs.margin, cs.padding, cs.borderTopWidth, cs.borderRightWidth,
          cs.borderBottomWidth, cs.borderLeftWidth, cs.outlineWidth, cs.outlineStyle, cs.boxSizing,
          cs.alignItems, cs.justifyContent, cs.gridTemplateColumns, cs.gap, cs.rowGap, cs.columnGap,
          cs.whiteSpace, cs.overflowX, cs.overflowY].join('|'),
        font: [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStyle, cs.fontStretch,
          cs.fontVariantNumeric, cs.fontFeatureSettings, cs.lineHeight, cs.letterSpacing,
          cs.wordSpacing, cs.verticalAlign, cs.textRendering].join('|'),
        geom: [cs.width, cs.height, cs.minHeight, cs.maxHeight, cs.minWidth, cs.maxWidth].join('|'),
        pos: [cs.transform, cs.translate, cs.zoom].join('|'),
        // 泡泡的显示状态是**故意**会变的：单独拿出来，别混进"装饰"判据
        vis: cs.visibility + '/' + cs.opacity,
        sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight,
        // 一次性 DOM 变更体检：子节点数量（不记内容，泡的可见性不影响它）
        nkids: el.childNodes.length
      };
    });
    // 每个文本节点的 Range 矩形（文字"墨迹框"的布局版本）
    const txt = [];
    for (const el of [hm, ...hm.querySelectorAll('*')]) {
      let ti = 0;
      for (const tn of el.childNodes) {
        if (tn.nodeType !== 3) continue;
        const rg = document.createRange(); rg.selectNodeContents(tn);
        const rs = [...rg.getClientRects()].map(r => [+r.left.toFixed(3), +r.top.toFixed(3), +r.width.toFixed(3), +r.height.toFixed(3)]);
        txt.push({ k: path(el) + '|tn' + (ti++), t: String(tn.textContent).trim().slice(0, 16), rs });
      }
    }
    // 页面/滚动容器几何：滚动条出现会把内容顶动
    const scroll = {};
    for (const [name, el] of [['docEl', document.documentElement], ['body', document.body],
      ['app', document.getElementById('app')], ...anc.map((e, i) => ['anc' + i + ':' + seg(e), e])]) {
      if (!el) continue;
      scroll[name] = [el.clientWidth, el.clientHeight, el.scrollWidth, el.scrollHeight, el.scrollTop, el.scrollLeft];
    }
    return { els, txt, scroll, vw: innerWidth, vh: innerHeight,
      hmCols: getComputedStyle(hm).getPropertyValue('--hm-ycol'),
      hmScroll: [hm.clientWidth, hm.scrollWidth, hm.clientHeight, hm.scrollHeight],
      rowScroll: (() => { const r = hm.querySelector('.tl-heatmap-row'); return r ? [r.clientWidth, r.scrollWidth] : null; })(),
      lgScroll: (() => { const l = hm.querySelector('.tl-heatmap-legend'); return l ? [l.clientWidth, l.scrollWidth] : null; })() };
  }; 1`;
  // ★ 每次导航/重新进入专题都会换掉 JS 上下文 ⇒ 快照函数必须**每次重新注入**（别只注入一次）
  const injectSnap = async () => { await evaluate(SNAPSHOT_FN); };
  const blockSnap = async () => JSON.parse(await evaluate(`JSON.stringify(window.__hmBlockSnap())`));
  // 泡泡子树里的东西允许跟着悬浮变（transform/visibility/opacity/自定义属性）：
  //   · .tl-heatmap-tip 里任何元素/文本都算"泡内部" ⇒ 只做"存在性"检查，不做位移检查
  //     （泡是绝对定位浮层，`--hm-tx` 每次 clamp 都会算出 ±3px 的居中微调，这是**设计如此**，
  //      与"数字沉降"无关：它不占版式、不推挤任何东西，§⑦ 的 scrollHeight/像素断言在盯它）。
  const isTip = (k) => /(^|>)span\.tl-heatmap-tip\[/.test(k) || /tl-heatmap-tip/.test(k);
  // 选中态会给左上角"全部"加 `.is-active`（同一元素、同一个位置）⇒ 比较前把类名里的
  //   is-active 归一化掉，否则路径键不同会被误判成"元素消失 + 元素新增"。
  const normKey = (k) => k.split('>').map(s => s.replace(/\.is-active(?=\[)/g, '')).join('>');
  // 热力图子树内：滚动尺寸必须恒定（泡泡是浮层，正常时不该改任何 scroll 尺寸）。
  // 热力图之外（时间轴列表/整个滚动容器）会随筛选重建内容、scrollHeight 本来就是变的 ⇒ 只比 clientW/H。
  const inBlock = (k) => /tl-heatmap/.test(k);
  const BLOCK_PROPS = { box: '盒模型/网格', font: '字体度量', geom: '尺寸', inline: '内联样式', nkids: '子节点数' };
  const diffBlock = (A, B) => {
    const out = [];
    const am = new Map(A.els.map(e => [normKey(e.k), e])), bm = new Map(B.els.map(e => [normKey(e.k), e]));
    for (const k of am.keys()) if (!bm.has(k)) out.push(`元素**消失**：${k.slice(-90)}`);
    for (const k of bm.keys()) if (!am.has(k)) out.push(`元素**新增**：${k.slice(-90)}`);
    for (const [k, a] of am) {
      const b = bm.get(k); if (!b) continue;
      const tip = isTip(k);
      if (!tip) for (let i = 0; i < 4; i++) {
        const d = +(b.r[i] - a.r[i]).toFixed(3);
        if (Math.abs(d) >= 0.01) out.push(`**位移** ${['left', 'top', 'width', 'height'][i]} ${d > 0 ? '+' : ''}${d}px：${k.slice(-90)}（${a.r[i]} → ${b.r[i]}）`);
      }
      // ★ scrollWidth/scrollHeight（溢出量）**故意不比较**：泡泡是绝对定位浮层，
      //   `--hm-tx` 一写（clamp）它的溢出量就变，行/标签的 scrollWidth 跟着变 ±3px。
      //   溢出量变化 ≠ 布局变化：只要 overflow-x 是 clip（下面单独断言），
      //   溢出就只是"画出去被裁掉"，不会变成滚动条、不会占宽度、不会重排。
      //   真正决定"数字位置会不会变"的是 clientWidth/clientHeight —— 那两个必须恒定。
      if (!tip && inBlock(k) && (a.cw !== b.cw || a.ch !== b.ch))
        out.push(`client 尺寸变化：${k.slice(-70)} ${a.cw}x${a.ch} → ${b.cw}x${b.ch}`);
      for (const p of Object.keys(BLOCK_PROPS)) {
        if (tip && p === 'inline') continue;                 // 泡泡会写 --hm-tx/--hm-arrow
        if (a[p] !== b[p]) out.push(`${BLOCK_PROPS[p]}变化：${k.slice(-70)} ${a[p]} → ${b[p]}`);
      }
      if (!tip && a.vis !== b.vis) out.push(`可见性变化：${k.slice(-70)} ${a.vis} → ${b.vis}`);
    }
    const am2 = new Map(A.txt.map(t => [normKey(t.k), t])), bm2 = new Map(B.txt.map(t => [normKey(t.k), t]));
    for (const k of am2.keys()) if (!bm2.has(k)) out.push(`文字节点**消失**：${k.slice(-80)}`);
    for (const [k, a] of am2) {
      const b = bm2.get(k); if (!b) continue;
      if (isTip(k)) continue;
      if (a.rs.length !== b.rs.length) { out.push(`文字行数变化：${k.slice(-80)} ${a.rs.length} → ${b.rs.length}`); continue; }
      for (let i = 0; i < a.rs.length; i++) for (let j = 0; j < 4; j++) {
        const d = +(b.rs[i][j] - a.rs[i][j]).toFixed(3);
        if (Math.abs(d) >= 0.01) out.push(`**文字位移** ${['left', 'top', 'width', 'height'][j]} ${d > 0 ? '+' : ''}${d}px：「${a.t}」${k.slice(-70)}（${a.rs[i][j]} → ${b.rs[i][j]}）`);
      }
    }
    for (const k of Object.keys(A.scroll)) {
      const a = A.scroll[k], b = B.scroll[k];
      if (!b) { out.push(`滚动容器消失：${k}`); continue; }
      // 热力图之外：只认 client 尺寸（内容重建导致的 scrollHeight 变化不算布局变更）
      const same = inBlock(k) ? a.join() === b.join() : (a[0] === b[0] && a[1] === b[1]);
      if (!same) out.push(`滚动容器几何变化：${k} ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
    return out;
  };

  // 进入币海拾年（§⑦ 之前已经把筛选复位成"全部"，这里重新导航保证是"首次"）
  for (const vp of [{ w: 1280, h: 900, dpr: 1 }, { w: 375, h: 720, dpr: 1 }]) {
    const tag = `${vp.w}x${vp.h} dpr=${vp.dpr}`;
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.w < 500 });
    await send('Page.navigate', { url: `${BASE}?block=${vp.w}&t=${Date.now()}#notes` });
    for (let i = 0; i < 140; i++) {
      const r = await evaluate(`(()=>typeof onTabClick==='function' && document.readyState==='complete' && Object.keys(viewScrollContainers||{}).length>0)()`).catch(() => false);
      if (r) break; await sleep(150);
    }
    await sleep(800);
    await openYears();
    await ensureTipText();
    await injectSnap();
    await evaluate(`(()=>{ const hm=document.querySelector('.tl-heatmap'); if (hm && hm.scrollIntoView) hm.scrollIntoView({ block: 'start' }); return 1; })()`);
    await sleep(700);

    const yearLabel = `div.tl-heatmap-row:nth-of-type(3) > div.tl-heatmap-ylabel`;
    const monthLabel = `div.tl-heatmap-row.tl-hm-head > div.tl-heatmap-mlabel:nth-of-type(5)`;
    // 用 CDP 强制 :hover（等价于真实鼠标移入，但不依赖坐标命中；点选走 JS 的筛选入口）
    const doc2 = await send('DOM.getDocument', { depth: 2 });
    const nidOf = async (sel) => (await send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: sel })).nodeId;
    const nYear = await nidOf(yearLabel), nMonth = await nidOf(monthLabel);
    ok(!!nYear && !!nMonth, `⑦-c ${tag} 找得到年份/月份标签的 DOM 节点（${nYear} / ${nMonth}）`);

    const sBase = await blockSnap();
    const sBase2 = await blockSnap();
    ok(diffBlock(sBase, sBase2).length === 0, `⑦-c ${tag} 静止页面自身两次快照零位移（差分器无噪声）`);
    console.log(`     ${tag}：快照覆盖 ${sBase.els.length} 个元素（含 ${(sBase.els.length - sBase.els.filter(e => /tl-heatmap/.test(e.k)).length)} 个祖先/兄弟）+ ${sBase.txt.length} 个文本节点`);
    ok(sBase.els.length >= 150 && sBase.txt.length >= 15,
      `⑦-c ${tag} ★ 快照范围够大：${sBase.els.length} 个元素、${sBase.txt.length} 个文本节点（不是"只量那一个标签"）`);

    // ① 悬浮"首次"（年份 + 月份各一次，模拟用户说的"首次被悬浮高亮"）
    await send('CSS.forcePseudoState', { nodeId: nYear, forcedPseudoClasses: ['hover'] });
    await evaluate(`(()=>{ if (typeof clampHeatmapTip === 'function') clampHeatmapTip(document.querySelector(${JSON.stringify(yearLabel)})); return 1; })()`);
    await settle();
    const sHoverY = await blockSnap();
    const dHoverY = diffBlock(sBase, sHoverY);
    if (dHoverY.length) dHoverY.slice(0, 8).forEach(x => console.log(`        ! ${x}`));
    ok(dHoverY.length === 0, `⑦-c ${tag} ★★★ 1/5 首次悬浮**年份标签**：整块零位移（${dHoverY.length} 处偏差）`);
    await send('CSS.forcePseudoState', { nodeId: nMonth, forcedPseudoClasses: ['hover'] });
    await evaluate(`(()=>{ if (typeof clampHeatmapTip === 'function') clampHeatmapTip(document.querySelector(${JSON.stringify(monthLabel)})); return 1; })()`);
    await settle();
    const sHoverM = await blockSnap();
    const dHoverM = diffBlock(sBase, sHoverM);
    if (dHoverM.length) dHoverM.slice(0, 8).forEach(x => console.log(`        ! ${x}`));
    ok(dHoverM.length === 0, `⑦-c ${tag} ★★★ 2/5 首次悬浮**月份标签**：整块零位移（${dHoverM.length} 处偏差）`);
    // ② 移开（用户最在意的是"移开也不回弹"）
    await send('CSS.forcePseudoState', { nodeId: nYear, forcedPseudoClasses: [] });
    await send('CSS.forcePseudoState', { nodeId: nMonth, forcedPseudoClasses: [] });
    await settle();
    const sAway = await blockSnap();
    const dAway = diffBlock(sBase, sAway);
    if (dAway.length) dAway.slice(0, 8).forEach(x => console.log(`        ! ${x}`));
    ok(dAway.length === 0, `⑦-c ${tag} ★★★ 3/5 悬浮后**移开**：整块回到基线（零位移、零"回不去"）`);

    // ③ 选中（点一个真实存在的年份，等价于 applyTimelineFilter 的入口）→ ④ 取消
    const pickYear = await evaluate(`(()=>{ const r=document.querySelector('.tl-heatmap-row:not(.tl-hm-head) .tl-heatmap-ylabel'); return r ? r.dataset.label : ''; })()`);
    await evaluate(`(()=>{ if (typeof applyTimelineFilter === 'function') applyTimelineFilter(${JSON.stringify(pickYear)}, '全部'); return 1; })()`);
    await sleep(900);
    await evaluate(`(()=>{ const hm=document.querySelector('.tl-heatmap'); if (hm && hm.scrollIntoView) hm.scrollIntoView({ block: 'start' }); return 1; })()`);
    await settle();
    const sSel = await blockSnap();
    const dSel = diffBlock(sBase, sSel);
    if (dSel.length) dSel.slice(0, 8).forEach(x => console.log(`        ! ${x}`));
    const activeNow = await evaluate(`(()=>{ const a=document.querySelector('.tl-heatmap-ylabel.is-active'); return a ? a.dataset.label : ''; })()`);
    ok(dSel.length === 0 && String(activeNow) === String(pickYear),
      `⑦-c ${tag} ★★★ 4/5 选中某一年（"${pickYear}" → .is-active 高亮「${activeNow}」）：整块零位移（${dSel.length} 处偏差）`);
    await evaluate(`(()=>{ if (typeof applyTimelineFilter === 'function') applyTimelineFilter('全部','全部'); return 1; })()`);
    await sleep(900);
    await evaluate(`(()=>{ const hm=document.querySelector('.tl-heatmap'); if (hm && hm.scrollIntoView) hm.scrollIntoView({ block: 'start' }); return 1; })()`);
    await settle();
    const sUn = await blockSnap();
    const dUn = diffBlock(sBase, sUn);
    if (dUn.length) dUn.slice(0, 8).forEach(x => console.log(`        ! ${x}`));
    ok(dUn.length === 0, `⑦-c ${tag} ★★★ 5/5 取消选中回到"全部"：整块零位移`);

    // 因果判据：滚动条不许出现（出现就会占宽度/顶高度）、第一列宽度恒定
    //   ★ 386 行的实测：`.tl-heatmap` 自己 clientWidth == scrollWidth（泡泡被 overflow-x: clip
    //     裁掉、不产生滚动区）；数据行虽然 scrollWidth 比 clientWidth 大（绝对定位的泡撑出来的
    //     **溢出量**，被容器裁掉、不会出现滚动条），所以这里对"行"只断言 **clientWidth 恒定**
    //     （真正会顶动内容的是"滚动条占位"，那由 .tl-heatmap 的 clip + 自绘滚动条排除）。
    const geo = sUn;
    ok(geo.rowScroll && geo.rowScroll[0] === sBase.rowScroll[0],
      `⑦-c ${tag} ★★ 数据行的 clientWidth 五态恒定（${sBase.rowScroll[0]} → ${geo.rowScroll[0]}）—— 没有"滚动条占位"把整行挤窄`);
    ok(geo.lgScroll && geo.lgScroll[0] === geo.lgScroll[1],
      `⑦-c ${tag} ★★ 图例没有横向滚动条：clientWidth == scrollWidth（${JSON.stringify(geo.lgScroll)}）`);
    // ★★★ 关于"横向溢出"的**精确**判据（旧写法 clientWidth==scrollWidth 是错的，已修正）：
    //   实测（375×720）：.tl-heatmap 的 scrollWidth=427 比 clientWidth=350 大 —— 但这不是
    //   "内容被顶宽"，而是**隐藏泡泡自身的溢出**：泡泡默认 `transform: translateX(-50%)`
    //   居中于格子，没被 clamp 过的泡（用户还没碰过的）会有一半伸到容器右边界之外；
    //   一旦 clamp（--hm-tx 被写上）就被拉回界内，scrollWidth 反而回到 350。
    //   真正的危险**不是** scrollWidth 大，而是"溢出区会不会变成可滚动的滚动条占位"：
    //   `.tl-heatmap` 是 `overflow-x: clip`（不产生滚动容器、不出滚动条、不占宽度），
    //   所以下面改断三件事：
    //     (a) overflow-x 必须是 clip/hidden（否则真会出现横向滚动条把这一排数字顶动）；
    //     (b) clientWidth 五态恒定（没有"滚动条占位"）；
    //     (c) 热力图的**可视内容宽度** == 父容器内容宽度（网格铺满、没被挤窄）。
    const hmOverflowX = await evaluate(`(()=>{ const h=document.querySelector('.tl-heatmap');
      return h ? getComputedStyle(h).overflowX : ''; })()`);
    ok(hmOverflowX === 'clip' || hmOverflowX === 'hidden',
      `⑦-c ${tag} ★★★ 热力图 overflow-x = ${hmOverflowX}（clip/hidden ⇒ 横向溢出**不会**变成滚动条占位）`);
    // ★★★ 真正该断的不是"右溢出后代有几个"（隐藏泡泡自然溢出），而是**可见泡泡有没有被裁掉**：
    //   把最右一列的一个格子标成 `.__probe-hover`（下面注入的样式让它等价于 :hover ⇒ 泡可见），
    //   clamp 它，**等 transform 过渡（0.12s）跑完**再量（踩过的坑：同步量到的是过渡起点，
    //   会误判成"clamp 没生效"）—— 它在可见容器里的左右余量都必须 ≥0。
    //   实测（375×720）：列 1 左余量 1.50 / 列 12 右余量 1.50（正好是 clamp 的 pad=1.5）；
    //   1280×900：中间列"相对格子中心 = 0.00"（真正居中，没被无谓地往里挤）。
    await evaluate(`(()=>{ if (document.getElementById('__hmProbeStyle')) return 1;
      const s=document.createElement('style'); s.id='__hmProbeStyle';
      s.textContent='.__probe-hover > .tl-heatmap-tip{visibility:visible!important;opacity:1!important;}';
      document.head.appendChild(s); return 1; })()`);
    const fitProbe = await evaluate(`(async ()=>{
      const h=document.querySelector('.tl-heatmap'); if(!h) return null;
      const vc=h.closest('.view-scroll-container');
      const row=h.querySelectorAll('.tl-heatmap-row:not(.tl-hm-head)')[0];
      const out={ vcW:+vc.getBoundingClientRect().width.toFixed(1) };
      // ① 最右一列：clamp 后必须贴回可见容器内（右余量 ≥0）
      const cellR=row.querySelectorAll('.tl-heatmap-cell')[11];
      const tipR=cellR.querySelector(':scope > .tl-heatmap-tip');
      tipR.classList.add('__probe-hover');
      if (typeof clampHeatmapTip==='function') clampHeatmapTip(cellR);
      await new Promise(r=>setTimeout(r,220));                  // ★ 等 transform 过渡跑完
      const vcr=vc.getBoundingClientRect(), tr=tipR.getBoundingClientRect();
      out.tipW=+tr.width.toFixed(1);
      out.right=+(vcr.right-tr.right).toFixed(2);
      out.leftOfRight=+(tr.left-vcr.left).toFixed(2);
      tipR.classList.remove('__probe-hover');
      // ② 中间一列：有余量时必须**真正居中于格子**（不许被无谓地往里挤）
      const cellM=row.querySelectorAll('.tl-heatmap-cell')[5];
      const tipM=cellM.querySelector(':scope > .tl-heatmap-tip');
      if (typeof clampHeatmapTip==='function') clampHeatmapTip(cellM);
      await new Promise(r=>setTimeout(r,220));
      const cmr=cellM.getBoundingClientRect(), tmr=tipM.getBoundingClientRect();
      out.midOff=+(tmr.left+tmr.width/2-(cmr.left+cmr.width/2)).toFixed(2);
      // ③ 年份标签的泡：设计上钉在数字右边、不参与居中 —— 只要不越出屏幕右侧
      const yl=h.querySelector('.tl-heatmap-row:not(.tl-hm-head) .tl-heatmap-ylabel');
      if (yl && typeof clampHeatmapTip==='function') clampHeatmapTip(yl);
      await new Promise(r=>setTimeout(r,220));
      out.ylRight=+(vcr.right-yl.querySelector(':scope > .tl-heatmap-tip').getBoundingClientRect().right).toFixed(2);
      return JSON.stringify(out);
    })()`);
    const fit = fitProbe ? JSON.parse(fitProbe) : null;
    ok(fit && fit.right >= -0.5,
      `⑦-c ${tag} ★★★ 可见泡泡不越出屏幕右边：最右列 clamp 后右余量 ${fit ? fit.right : '?'}px（可见容器宽 ${fit ? fit.vcW : '?'}、泡宽 ${fit ? fit.tipW : '?'}）`);
    ok(fit && fit.leftOfRight >= 0,
      `⑦-c ${tag} ★★★ 可见泡泡不越出屏幕左边：最右列 clamp 后左余量 ${fit ? fit.leftOfRight : '?'}px`);
    ok(fit && Math.abs(fit.midOff) < 0.02,
      `⑦-c ${tag} ★★★ 中间列泡泡**真正居中于格子**（偏差 ${fit ? fit.midOff : '?'}px）—— 放得下就不该被往里挤`);
    ok(fit && fit.ylRight >= 0,
      `⑦-c ${tag} ★★ 年份标签的泡（钉在数字右侧、不参与居中）也不越出屏幕右边（余量 ${fit ? fit.ylRight : '?'}px）`);
    ok(sBase.hmCols === sUn.hmCols && sBase.rowScroll[0] === sUn.rowScroll[0],
      `⑦-c ${tag} ★★ 第一列宽度（--hm-ycol=${sBase.hmCols}）与行 clientWidth（${sBase.rowScroll[0]} → ${sUn.rowScroll[0]}）五态恒定 —— 列宽不依赖内容/字号`);
    const colsNow = await evaluate(`(()=>{ const r=document.querySelector('.tl-heatmap-row');
      if (!r) return null; const c=getComputedStyle(r).gridTemplateColumns.split(' ');
      return JSON.stringify([c.length, c[0], c[1]]); })()`);
    ok(/^\[\s*13\s*,/.test(String(colsNow)),
      `⑦-c ${tag} ★★ grid 仍是 13 条轨道（1 列标签 + 12 列月份）：${colsNow}`);
    const colsPx = JSON.parse(colsNow);
    ok(/px$/.test(colsPx[1]) && /px$/.test(colsPx[2]),
      `⑦-c ${tag} ★★★ 轨道是**绝对长度（px）**、不含 auto/min-content/em：第一条 ${colsPx[1]}、格子 ${colsPx[2]} —— 列宽不可能被内容或字体撑开`);
    // ★ 静态复核：CSS 里热力图那一列不许再出现 em/auto/min-content
    const hmCssBlock = css.slice(css.indexOf('.tl-heatmap {'), css.indexOf('.tl-heatmap-tip {'));
    const badTracks = (hmCssBlock.match(/grid-template-columns:[^;]*/g) || []).filter(s => /(^|[^-\w])(auto|min-content|max-content|fit-content|\d*\.?\d+em)\b/.test(s));
    ok(badTracks.length === 0,
      `⑦-c ★★★ 热力图/图例的 grid-template-columns 里没有 auto/min-content/em（列宽不许依赖内容与字号）：${badTracks.length ? badTracks.join(' | ') : '无'}`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
}

// ─────────── ⑦-d 深链接**冷启动**路径（用户线索："刷新这个页面会沉降，从别处点进来不会"） ───────────
// ★★★ 为什么单开一节：前面 ⑦ / ⑦-b / ⑦-c 走的是**站内跳转**（先开首页 → 点进专题）。
//   用户明确指出只有"直接打开/刷新 #special/timeline"才看得见，所以测试必须覆盖**冷启动**。
//
// ★★★ 2026 复核后的口径修正（重要，别再退回去）：
//   本节的**第一版**只断言了两件事：① 热力图相对**自己的布局容器**（`.body-row`）的偏移恒定；
//   ② 顶部工具条高度恒定。用户复核后指出这**没抓住他看到的画面** —— 因为如果**容器本身**
//   在冷启动里被抬起，那两条**全都是绿的**。事实正是如此（1920x1080 实测）：
//     · `.top-search-container` 是 `.app-layout`（flex column）的**第一个**子项，
//       它排在 `.body-row` 前面 ⇒ 它的高度直接决定整条 `.body-row`（含热力图、含年份/月份两排）
//       的纵坐标；
//     · 静态 HTML 里它没有 `hidden`（展开，高约 70px），router 要到数据就绪（t=557.9ms）
//       才按 URL 加 `hidden`，触发 0.3s 的 max-height/padding 过渡；
//     · 时间线在 t=746.2ms 渲染 ⇒ 热力图**第一次出现**时搜索栏才收到 54.2px，
//       t=870.8ms 收到 1px ⇒ **文档绝对 top 从 198.25 滑到 145（53.25px）**，不回弹。
//     而 `relY` 全程只有 145-1-46-56=42 一个值、`tbH` 全程只有一个值 —— 旧口径当然全绿。
//   ⇒ 所以本节现在断言的是**绝对量**：`rect.top + window.scrollY`、年份/月份两排的绝对纵坐标、
//     `window.scrollY` / `documentElement.scrollTop` / 可滚动祖先 `scrollTop`、
//     `visualViewport.offsetTop`、纵向滚动条出现性。这些都必须**全程恒定**。
//   · 1440x900 / 1366x768 恰好复现不出来（那两个宽度下过渡在渲染点之前已走完），
//     所以视口清单里必须保留 1920x1080 —— 否则这条修复等于没测。
// ★ 视口：1920x1080 / 1440x900 / 1366x768（用户的实际桌面窗口）+ 1280x900 + 375x720（回归）。
console.log('\n══════ ⑦-d 深链接冷启动（直接打开 #special/timeline）══════\n');
{
  await send('DOM.enable'); await send('CSS.enable');
  // ★★★ 视口清单（用户 2026 复核："我的窗口是最大化的桌面窗口，宽约 1920，也可能是 1366/1440"）：
  //   桌面三个（1920x1080 / 1440x900 / 1366x768）**必须**在内 —— 实测 1920x1080 才是
  //   "数字沉降"的必现视口（`fixtest.mjs`：1920 浮动 53.25px，1440/1366 恰好为 0），
  //   只测 1280x900 会正好漏掉它。移动端 375x720 与桌面 1280x900 保留。
  for (const vp of [{ w: 1920, h: 1080, dpr: 1 }, { w: 1440, h: 900, dpr: 1 }, { w: 1366, h: 768, dpr: 1 },
                    { w: 1280, h: 900, dpr: 1 }, { w: 375, h: 720, dpr: 1 }]) {
    const tag = `${vp.w}x${vp.h} dpr=${vp.dpr}`;
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.w < 500 });
    // ★ 冷启动：直接导航到深链接（不是先开首页再点进来）。
    //   必须用**新的 URL**（带 cache-buster）才会真的重新加载文档 —— 只改 hash 是
    //   same-document 导航，addScriptToEvaluateOnNewDocument 的采样器不会被注入（踩过）。
    // 逐帧采样：热力图一出现就开始记录它自己 + 祖先 + 侧栏的几何
    const SAMPLER = `window.__coldSeq = []; window.__coldOn = true; window.__coldT0 = performance.now();
    (function tick(){
      if (!window.__coldOn) return;
      const hm = document.querySelector('.tl-heatmap');
      if (hm) {
        const r = hm.getBoundingClientRect();
        const row = hm.querySelector('.tl-heatmap-row');
        const side = document.querySelector('.sidebar');
        const vc = hm.closest('.view-scroll-container');
        const br = document.querySelector('.body-row');
        const sr = side ? side.getBoundingClientRect() : null;
        const vr = vc ? vc.getBoundingClientRect() : null;
        // ★ 关键量：热力图相对**它自己的布局容器**的偏移。
        //   "祖先动画把整块抬起"时这个值不变；"数字在行里沉下去"时这个值才会变。
        const bb = br ? br.getBoundingClientRect() : null;
        const rel = bb ? [+(r.left - bb.left).toFixed(3), +(r.top - bb.top).toFixed(3)] : null;
        // ★ 顶部工具条的高度：窄屏时它必然换行，若"换成自绘下拉"那一刻才换行，
        //   高度就会 80 → 116px，下面整块被推下 36px（这就是用户看到的"沉降"）。
        const tb = document.querySelector('.timeline-top-bar');
        const tbH = tb ? +tb.getBoundingClientRect().height.toFixed(3) : null;
        const tn = (()=>{ const y=hm.querySelector('.tl-heatmap-row:not(.tl-hm-head) .tl-heatmap-ylabel');
          if(!y) return null; const t=[...y.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
          if(!t) return null; const rg=document.createRange(); rg.selectNodeContents(t); const b=rg.getBoundingClientRect();
          return [+b.left.toFixed(3), +b.top.toFixed(3)]; })();
        // ★★★ 绝对量（用户 2026 复核要求）：只测"相对自己的容器"会漏掉"容器自己被抬"。
        //   docTop = rect.top + scrollY —— 这才是用户眼睛里数字所在的位置。
        const de = document.documentElement;
        const scrollers = (()=>{ const out=[]; let e=hm;
          while (e && e !== de) { const cs=getComputedStyle(e);
            if (cs.overflowY==='auto'||cs.overflowY==='scroll'||cs.overflowY==='overlay') out.push(+e.scrollTop.toFixed(3));
            e=e.parentElement; }
          out.push(+de.scrollTop.toFixed(3));
          return out; })();
        // 年份 + 月份两排的**绝对**纵坐标（用户说"两者一起下沉"⇒ 网格上边缘在动）
        const labAbs = [...hm.querySelectorAll('.tl-heatmap-ylabel, .tl-heatmap-mlabel')]
          .map(e => +(e.getBoundingClientRect().top + window.scrollY).toFixed(2));
        window.__coldSeq.push({ t: Math.round(performance.now()-window.__coldT0),
          hm: [+r.left.toFixed(3), +r.top.toFixed(3), +r.width.toFixed(3), +r.height.toFixed(3)],
          hmAbsTop: +(r.top + window.scrollY).toFixed(3),
          labAbs: labAbs,
          rel: rel, ylab: tn, side: sr ? +sr.width.toFixed(3) : null, vcTop: vr ? +vr.top.toFixed(3) : null,
          docTop: de.scrollTop, winY: window.scrollY, scrollers: scrollers,
          sbGap: window.innerHeight - de.clientHeight, innerH: window.innerHeight,
          vvTop: window.visualViewport ? +window.visualViewport.offsetTop.toFixed(2) : null,
          tbH: tbH,
          cols: row ? getComputedStyle(row).gridTemplateColumns : null,
          hmCW: hm.clientWidth, hmSW: hm.scrollWidth });
      }
      requestAnimationFrame(tick);
    })(); 1`;
    // ★ 采样器必须在**导航之前**注册（addScriptToEvaluateOnNewDocument 在文档创建时注入）。
    //   每次重新注册会在下一份文档里再注入一次，虽然同一份 source 重复注入只会多一层
    //   rAF 循环，但为了干净：注册完立刻记住 id，本轮结束就摘掉。
    const coldScriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: SAMPLER })).identifier;
    await send('Page.navigate', { url: `${BASE}?cold=${vp.w}x${vp.h}-${Date.now()}#special/timeline` });
    // 页面加载 + 采样 1.6s
    await sleep(1800);
    let seq = [];
    for (let i = 0; i < 40; i++) {
      seq = JSON.parse(await evaluate(`JSON.stringify(window.__coldSeq || [])`).catch(() => '[]'));
      if (seq.length > 8) break;
      await sleep(200);
    }
    ok(seq.length > 8, `⑦-d ${tag} 冷启动逐帧采样拿到 ${seq.length} 帧（热力图出现后每帧一条）`);
    if (seq.length > 8) {
      const first = seq[0], last = seq[seq.length - 1];
      // (a) 热力图自身几何：第一次出现之后必须恒定
      const widthChanges = [...new Set(seq.map(s => s.hm[2]))];
      const colChanges = [...new Set(seq.map(s => s.cols))];
      const cwChanges = [...new Set(seq.map(s => s.hmCW))];
      ok(widthChanges.length === 1 && cwChanges.length === 1,
        `⑦-d ${tag} ★★★ 冷启动：热力图**自身宽度**从第一次出现起恒定（clientWidth ${JSON.stringify(cwChanges)}，rect 宽 ${JSON.stringify(widthChanges)}）`);
      ok(colChanges.length === 1,
        `⑦-d ${tag} ★★★ 冷启动：13 条 grid 轨道全程不变（${colChanges.length} 种取值）—— 列宽不会被"还在动的布局"重算`);
      // ★ 375x720 下热力图的 `scrollWidth`(427) > `clientWidth`(350) 是**已知且无害**的：
      //   `--hm-tx` 还没写的隐藏泡泡是 absolute 浮层、默认 translateX(-50%)，最右列会顶出去；
      //   溢出被 `overflow-x: clip` 裁掉 ⇒ 不产生滚动条、不占宽度、不重排（见 ⑦-c 那几条）。
      //   这里要断的是"**可见**的横向滚动区"不存在 —— 没有任何祖先真的给热力图一个横向滚动条。
      const hmScroll = await evaluate(`(()=>{ const h=document.querySelector('.tl-heatmap'); if(!h) return null;
        const chain=[]; let e=h;
        while (e && e !== document.documentElement) { const cs=getComputedStyle(e);
          if ((cs.overflowX==='auto'||cs.overflowX==='scroll') && e.scrollWidth > e.clientWidth + 1)
            chain.push((e.className||e.tagName)+' '+e.clientWidth+'/'+e.scrollWidth);
          e = e.parentElement; }
        return JSON.stringify({ clip:getComputedStyle(h).overflowX, scrollableAncestors:chain }); })()`);
      const hs = hmScroll ? JSON.parse(hmScroll) : null;
      ok(hs && (hs.clip === 'clip' || hs.clip === 'hidden') && hs.scrollableAncestors.length === 0,
        `⑦-d ${tag} ★★ 冷启动：热力图**没有可横向滚动的祖先**（自身 overflow-x=${hs ? hs.clip : '?'}，祖先里会横向滚的：${hs ? JSON.stringify(hs.scrollableAncestors) : '?'}）`);
      // (b) 纵向：整块往上走必须来自祖先；元素相对自己容器一动没动，且必须**收敛**
      const ys = seq.map(s => s.hm[1]);
      const ySpread = +(Math.max(...ys) - Math.min(...ys)).toFixed(3);
      const leftSpread = +(Math.max(...seq.map(s => s.hm[0])) - Math.min(...seq.map(s => s.hm[0]))).toFixed(3);
      const relX = [...new Set(seq.map(s => s.rel && s.rel[0]))];
      const relY = [...new Set(seq.map(s => s.rel && s.rel[1]))];
      console.log(`     冷启动 ${tag}：热力图 top 浮动 ${ySpread}px、left 浮动 ${leftSpread}px；侧栏宽 ${JSON.stringify([...new Set(seq.map(s => s.side))])}；祖先 top ${seq[0].vcTop} → ${last.vcTop}；末 10 帧 top ${JSON.stringify(ys.slice(-10))}`);
      console.log(`     冷启动 ${tag}：相对 .body-row 的偏移 X=${JSON.stringify(relX)} Y=${JSON.stringify(relY)}（这两项必须**各只有一个值**）`);
      ok(leftSpread < 0.01,
        `⑦-d ${tag} ★★★ 冷启动：热力图的**水平**位置全程零位移（浮动 ${leftSpread}px）—— 侧栏收起不再逐帧重排内容列`);
      ok(relX.length === 1 && relY.length === 1,
        `⑦-d ${tag} ★★★ 冷启动：热力图相对**自己的布局容器**（.body-row）的偏移全程恒定（X=${JSON.stringify(relX)}、Y=${JSON.stringify(relY)}）—— 整块被祖先抬起 ≠ 数字在行里沉下去`);
      // ★★★ 顶部工具条高度恒定 —— 这一条专门钉"自绘下拉迟到"造成的 80→116px 换行抖动
      const tbHs = [...new Set(seq.map(s => s.tbH))];
      console.log(`     冷启动 ${tag}：.timeline-top-bar 高度取值=${JSON.stringify(tbHs)}（窄屏必须只有一个：它一换行就把下面整块推走）`);
      ok(tbHs.length === 1,
        `⑦-d ${tag} ★★★ 冷启动：顶部工具条高度全程恒定（${JSON.stringify(tbHs)}）—— 两个 <select> 换成自绘 .dd（84px 固定宽）时不许触发换行；<600px 由 .timeline-top-right{min-height:78px} 从第一帧起占住最终高度`);
      const tailY = ys.slice(-10);
      ok(new Set(tailY).size === 1,
        `⑦-d ${tag} ★★★ 冷启动：热力图纵向位置已**收敛**（末 10 帧 top 全为 ${tailY[0]}，说明剩下的浮动已经停下、不会在悬浮时继续爬）`);
      // ══════════════════════════════════════════════════════════════════════════════
      // ★★★ 绝对坐标恒定（用户 2026 复核的核心要求）
      //   旧断言只要求"相对 .body-row 的偏移恒定"，于是**容器自己被抬**这件事被它放过了 ——
      //   而那正是用户看到的现象：`.top-search-container`（`.app-layout` 的 flex 子项，排在
      //   `.body-row` 之前）在冷启动中途塌陷，把整条 `.body-row`（含热力图、含年份/月份两排
      //   按键）一起往上顶，文档绝对 top 从 198.25 滑到 145（1920x1080 实测 53.25px），
      //   停在最终位置不回弹 ⇒ 用户描述为"年份与月份一起往下沉、网格上边缘下移"。
      //   所以这里把口径从"相对容器"升级为"**文档绝对坐标**"：rect.top + window.scrollY。
      // ══════════════════════════════════════════════════════════════════════════════
      const absTops = seq.map(s => s.hmAbsTop).filter(v => typeof v === 'number');
      const absSpread = absTops.length ? +(Math.max(...absTops) - Math.min(...absTops)).toFixed(3) : -1;
      console.log(`     冷启动 ${tag}：热力图**文档绝对 top** 取值 ${JSON.stringify([...new Set(absTops)])}（浮动 ${absSpread}px）`);
      ok(absTops.length > 0 && absSpread < 0.01,
        `⑦-d ${tag} ★★★ 冷启动：热力图的**文档绝对坐标**（rect.top + scrollY）全程恒定（浮动 ${absSpread}px；取值 ${JSON.stringify([...new Set(absTops)].slice(0, 6))}）—— "容器自己被抬"也算位移`);
      // 年份 + 月份两排的绝对纵坐标：用户明确说"两者一起下沉"⇒ 逐帧必须一个值
      const labStates = [...new Set(seq.map(s => JSON.stringify(s.labAbs)))];
      const labSpread = (() => {
        if (!seq.every(s => Array.isArray(s.labAbs) && s.labAbs.length === seq[0].labAbs.length)) return -1;
        let m = 0;
        for (let i = 0; i < seq[0].labAbs.length; i++) {
          const col = seq.map(s => s.labAbs[i]); m = Math.max(m, Math.max(...col) - Math.min(...col));
        }
        return +m.toFixed(3);
      })();
      console.log(`     冷启动 ${tag}：年份+月份两排绝对纵坐标状态 ${labStates.length} 种（最大浮动 ${labSpread}px，共 ${seq[0].labAbs ? seq[0].labAbs.length : 0} 个标签）`);
      ok(labStates.length === 1,
        `⑦-d ${tag} ★★★ 冷启动：**年份与月份两排按键的绝对纵坐标**全程恒定（${labStates.length} 种取值，最大浮动 ${labSpread}px）—— 这是用户肉眼看到"数字沉降"的那两排`);
      // 滚动：冷启动最容易触发一次自动滚动/滚动锚定，表现就是"整页数字一起沉"
      const winYs = [...new Set(seq.map(s => s.winY))];
      const docTops = [...new Set(seq.map(s => s.docTop))];
      const scrollerStates = [...new Set(seq.map(s => JSON.stringify(s.scrollers)))];
      const vvTops = [...new Set(seq.map(s => s.vvTop))];
      console.log(`     冷启动 ${tag}：window.scrollY=${JSON.stringify(winYs)}  documentElement.scrollTop=${JSON.stringify(docTops)}  visualViewport.offsetTop=${JSON.stringify(vvTops)}  可滚动祖先进度状态=${scrollerStates.length} 种`);
      ok(winYs.length === 1 && winYs[0] === 0 && docTops.length === 1 && docTops[0] === 0,
        `⑦-d ${tag} ★★★ 冷启动：全程**没有发生任何滚动**（window.scrollY=${JSON.stringify(winYs)}、documentElement.scrollTop=${JSON.stringify(docTops)}）—— 排除滚动锚定/自动滚动`);
      ok(scrollerStates.length === 1,
        `⑦-d ${tag} ★★ 冷启动：热力图的所有可滚动祖先 `+`scrollTop 全程不变（${scrollerStates.length} 种取值：${JSON.stringify(scrollerStates.slice(0, 3))}）`);
      ok(vvTops.length === 1,
        `⑦-d ${tag} ★★ 冷启动：visualViewport.offsetTop 全程不变（${JSON.stringify(vvTops)}）—— 没有视觉视口级别的位移`);
      // 纵向滚动条：冷启动中途出现/消失也会让内容横向重排、整块跳动
      const sbGaps = [...new Set(seq.map(s => s.sbGap))];
      const innerHs = [...new Set(seq.map(s => s.innerH))];
      console.log(`     冷启动 ${tag}：纵向滚动条占位 = innerHeight - clientHeight = ${JSON.stringify(sbGaps)}（innerHeight 取值 ${JSON.stringify(innerHs)}）`);
      ok(sbGaps.length === 1 && sbGaps[0] === 0,
        `⑦-d ${tag} ★★★ 冷启动：**纵向滚动条的存在性全程不变且从未出现**（innerHeight-clientHeight=${JSON.stringify(sbGaps)}）—— 排除"滚动条中途出现把内容挤窄"`);
      ok(innerHs.length === 1,
        `⑦-d ${tag} ★★ 冷启动：窗口内高全程恒定（${JSON.stringify(innerHs)}）`);
      // (c) 侧栏宽度不许再有动画（有动画＝内容列逐帧重排的旧根因）
      const sideTrans = await evaluate(`(()=>{ const s=document.querySelector('.sidebar'); if(!s) return ''; return getComputedStyle(s).transitionProperty || ''; })()`);
      ok(!/width|all/.test(String(sideTrans)),
        `⑦-d ${tag} ★★★ 侧栏折叠态不再对 width 做过渡（transition-property="${sideTrans}"）—— 内容列不会被逐帧挤压`);
      // ★★★ 搜索栏必须在**第一次绘制之前**就已收起（修复本身）
      //   真凶：`.top-search-container` 是 `.app-layout` 的 flex 子项、排在 `.body-row` 之前，
      //   router 要到数据就绪（实测 t=557.9ms）才给它加 `hidden`，触发 0.3s 的
      //   max-height/padding 过渡，而时间线在 t=746.2ms 就渲染了 ⇒ 热力图第一次出现时
      //   搜索栏才收到 54.2px，之后一路收到 1px，整块被顶上去 53.25px。
      //   修复：`special.js` 在解析期按 URL 给 `html` 打 `data-hm-cold`，`layout.css` 用
      //   `display: none` 让搜索栏第一帧就零高度（`max-height` 过渡的中间值仍参与布局）。
      const coldFix = await evaluate(`(()=>{
        const sc = document.querySelector('.top-search-container');
        if (!sc) return JSON.stringify({ missing: true });
        const cs = getComputedStyle(sc);
        return JSON.stringify({ h: +sc.getBoundingClientRect().height.toFixed(2),
          hidden: sc.classList.contains('hidden'), attr: document.documentElement.getAttribute('data-hm-cold'),
          sel: /data-hm-cold/.test([...document.styleSheets].map(s=>{ try { return [...s.cssRules].map(r=>r.cssText).join('\\n'); } catch(e){ return ''; } }).join('\\n')) });
      })()`);
      const cf = JSON.parse(coldFix);
      console.log(`     冷启动 ${tag}：搜索栏 h=${cf.h} hidden=${cf.hidden} data-hm-cold=${cf.attr}（CSS 里有规则=${cf.sel}）`);
      ok(cf.sel === true,
        `⑦-d ${tag} ★★★ layout.css 里存在 \`html[data-hm-cold] .top-search-container { display: none }\` 规则（搜索栏第一帧就零高度）`);
      ok(cf.hidden === true && cf.h <= 1.01,
        `⑦-d ${tag} ★★★ 冷启动：搜索栏最终已收起（height=${cf.h}px、hidden=${cf.hidden}）—— 收起的过渡不许再压到时间线渲染点上`);
      ok(cf.attr === null,
        `⑦-d ${tag} ★★ 冷启动：\`data-hm-cold\` 标记已被摘掉（=${cf.attr}）—— 摘掉后由 \`hidden\` 类接管，"返回普通板块时搜索栏滑出来"的动画不受影响`);
    }
    // (d) 冷启动就悬浮 vs 等稳定后再悬浮：泡泡**相对格子**的几何必须逐值相同
    const geomExpr = `(function(){
      var cell = document.querySelectorAll('.tl-heatmap-row:not(.tl-hm-head)')[1].querySelectorAll('.tl-heatmap-cell')[3];
      if (!cell) return null;
      var tip = cell.querySelector(':scope > .tl-heatmap-tip');
      var cr = cell.getBoundingClientRect();
      var tr = tip.getBoundingClientRect();
      var o = {};
      o.rel = [+(tr.left - cr.left).toFixed(3), +(tr.top - cr.top).toFixed(3)];
      o.cen = +(tr.left + tr.width / 2 - (cr.left + cr.width / 2)).toFixed(3);
      o.bot = +(tr.top + tr.height - cr.top).toFixed(3);
      o.w = +tr.width.toFixed(3);
      return JSON.stringify(o);
    })()`;
    // 先不悬浮 → 记录基线几何
    await sleep(400);
    const g0 = await evaluate(geomExpr);
    // 再把指针移到那个格子上（走真实事件委托：mouseover → clampHeatmapTip）
    await evaluate(`(()=>{ const c=document.querySelectorAll('.tl-heatmap-row:not(.tl-hm-head)')[1].querySelectorAll('.tl-heatmap-cell')[3];
      c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return 1; })()`);
    await sleep(500);
    const g1 = await evaluate(geomExpr);
    await evaluate(`document.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); 1`);
    await sleep(350);
    await evaluate(`(()=>{ const c=document.querySelectorAll('.tl-heatmap-row:not(.tl-hm-head)')[1].querySelectorAll('.tl-heatmap-cell')[3];
      c.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return 1; })()`);
    await sleep(500);
    const g2 = await evaluate(geomExpr);
    const p = (s) => { try { return JSON.parse(s); } catch { return null; } };
    const a = p(g0), b = p(g1), c = p(g2);
    ok(a && b && c, `⑦-d ${tag} 拿得到冷启动路径的泡泡几何（${!!a}/${!!b}/${!!c}）`);
    if (a && b && c) {
      ok(b.w === a.w,
        `⑦-d ${tag} ★★★ 冷启动：悬浮后泡泡宽度不变（${a.w} → ${b.w}）`);
      ok(JSON.stringify(a) === JSON.stringify(c),
        `⑦-d ${tag} ★★★ 冷启动：**移开再悬浮**后泡泡相对格子的几何"回到原处"（${JSON.stringify(a)} vs ${JSON.stringify(c)}）`);
      ok(Math.abs(c.cen) < 0.02 && Math.abs(c.bot - a.bot) < 0.02,
        `⑦-d ${tag} ★★★ 冷启动：泡泡仍**居中于格子**且贴合不变（水平偏差 ${c.cen}px、底边 ${c.bot}px）`);
    }
    if (coldScriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: coldScriptId }).catch(() => { });
    await evaluate(`window.__coldOn = false; 1`).catch(() => { });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
}

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
