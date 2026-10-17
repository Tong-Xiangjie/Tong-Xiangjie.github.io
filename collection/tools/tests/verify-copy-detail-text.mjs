// ==================== verify-copy-detail-text.mjs ====================
// 硬币板块「藏品条目」（分类内容页里「详细信息」那一块）的信息排版：
//
//   ① 评级合成**一个**色块：评级公司在前、分数在后，中间恰好一个半角空格 → `<公司> <分数>`
//      （原来是 <span class="condition">MS67</span><span class="meta">ACG</span> 两个元素、顺序还是反的）
//   ② 色块之后接「<年份>年发行 · <购藏日期>以<价格>元的价格购入」—— 文字与分隔符保持原样，
//      只调整它与色块的相邻关系（色块与这一段之间恰好一个**半角**空格；用户明确这个不动）
//   ③ 第三行由"目录编号 / 材质：…"两行合并成一行：
//      `<目录编号>　<材质>　<直径>　<重量>`（下面抬头里举例引自数据，不是判据）
//      ★ 字段之间用**全角空格 U+3000**（用户要求「间隔可以宽一点，例如全角空格」）；
//        字段缺失就跳过，所以不会出现连续全角空格，也不会留首尾全角空格
//      ★ 直径与重量**原样照抄数据值**（数据里写 `外接圆直径30mm` 就渲染 `外接圆直径30mm`，
//        不做任何正则抽数 / 单位补全 / 汉字剥离），值的内部一字不动、只 trim 首尾空白，
//        字段在数据里不存在就整段不渲染（不留空串、undefined、null、0 或"未知"）
//      ★ 目录编号走页面既有的 formatCatalogNumber：假值 / "Unlisted" ⇒ 整段不渲染、行首不空位
//   ④ 这一段渲染代码被纸币板块复用 —— 纸币的输出必须**一个字符都不变**（⑤ 节逐条现算比对）
//
// ★★ 判据只钉**渲染行为**，不钉**数据快照**：
//   · 期望值一律从页面上的数据对象 `copyDetailList`（= renderCopiesList 的入参）**现算**，
//     用的是本文件里镜像实现的 chipOf / metaOf / row2Of / specPartsOf / line3Of；
//   · 页面条目与数据**靠实现自己给出的全局下标配对**：每条 `.copy-item` 的详情链接是
//     `onclick="openCopyDetail(N)"`，那个 N 就是它在 copyDetailList 里的下标 ⇒ 不需要假设
//     DOM 顺序、也不需要假设 copyDetailList 的作用域（整个分类页的顺序，不是单个系列的）；
//   · ② 节除首屏外，还会对**数据里每一个系列**跳到它的路由（路由片段由页面上的
//     coinCategoryTree 现推，见 SERIES_JS）逐条比一遍，覆盖面不依赖"某条藏品恰好存在"；
//     条数不写死，加币删币 / 改材质直径重量 / 改评级 / 改目录号 / 加备注都不影响判读。
//   · 不写死任何藏品的文本/条数、不写死 sha256 基线、也不读数据源码文件。
//   因此用户编辑数据**不会假红**，只有渲染被改坏（少一个字段、分隔符变半角、多了「材质：」、
//   少了空格…）才会红。唯一保留的"写死"是 ④ 节那些**自造数据**跑真实渲染函数得到的期望
//   —— 那与用户数据无关。
//   · 数据里当前没有的场景（CJK 直径/重量、目录号为空）记成 `○ 跳过`，**不计入通过**，
//     由 ④ 节的合成样本等价覆盖，避免"绿勾但其实什么都没验证"。
//
// 自包含、零依赖：自己起静态服务器、自己拉起无头 Chrome（CDP）、自己断言。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0, skip = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
// ★ 数据里当前没有这个场景 → 明确记成"跳过"，**不计入通过**（原来写成 ok(true) 会让日志里出现
//   一个绿色的 ✓，读起来像"验证过了"，其实什么都没验证）。跳过的场景由 ④ 节的合成样本覆盖。
const skipped = m => { skip++; console.log(`  ○ 跳过（数据里当前没有该场景，由 ④ 节合成样本覆盖）：${m}`); };

// ══════════════════════════════════════════════════════════════
console.log('══════ ① 静态：色块/文字沿用现有体系（没有自创风格） ══════\n');
const css = readFileSync('collection/layout.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const chipRule = css.match(/\.copy-info \.condition\s*\{[^}]*\}/);
const metaRule = css.match(/\.copy-info \.meta\s*\{[^}]*\}/);
ok(!!chipRule && /background:\s*var\(--thumb-bg\)/.test(chipRule[0]) && /border-radius/.test(chipRule[0]),
  `① 评级色块用的仍是既有的 .copy-info .condition（background:var(--thumb-bg) + 圆角）`);
ok(!!metaRule && /color:\s*var\(--text-secondary\)/.test(metaRule[0]),
  '① 说明文字用的仍是既有的 .copy-info .meta（--text-secondary + 0.75rem）');
ok(!/\.copy-spec\b|\.rating-chip\b|\.copy-detail-line\b/.test(css),
  '① 没有为这次改版新造 CSS 类名（沿用条件色块 + meta 文字两套）');

// ─────────── 起服务 + 无头浏览器 ───────────
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
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
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}/collection/index.html`;
const LOCAL = `http://127.0.0.1:${PORT}/`;
const LIVE = 'https://tong-xiangjie.github.io/';

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpDetail-'));
// 端口段 17000-17089：与现有用例的写死端口（9416…10995）和随机段（10800~16689）都不重叠
const DP = 17000 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || ''));
  if (m.method === 'Fetch.requestPaused') onPaused(m.params);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
// 图片全部改写到本地（CI 无外网也能跑），图片加载失败与否不影响本用例的文案断言
async function onPaused(p) {
  try {
    const u = p.request.url;
    const local = u.startsWith(LIVE) ? LOCAL + u.slice(LIVE.length) : u;
    await send('Fetch.continueRequest', { requestId: p.requestId, url: local });
  } catch { try { await send('Fetch.continueRequest', { requestId: p.requestId }); } catch { } }
}
await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Fetch.enable', { patterns: [{ urlPattern: LIVE + '*', requestStage: 'Request' }] });

async function boot(hash, sel) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 160; i++) {
    const r = await evaluate(`(()=>document.readyState==='complete' && document.querySelectorAll('${sel}').length>0)()`).catch(() => false);
    if (r) break;
    await sleep(250);
  }
  await sleep(1200);
  return await evaluate(`document.querySelectorAll('${sel}').length`).catch(() => -1);
}

// ─────────── 从页面数据现算"应该渲染成什么" ───────────
// formatCatalogNumber 的口径照抄 core.js（页面上已存在的目录号格式化函数）：
// 假值 ⇒ 空、含 "unlisted" ⇒ 空、含 '#' 或以 sun- 开头原样、其余补 'Pick# '。
const catalogDisplayOf = num => {
  if (!num) return '';
  const s = String(num).trim();
  if (/unlisted/i.test(s)) return '';
  if (s.includes('#') || /^sun[-#]/i.test(s)) return s;
  return 'Pick# ' + s;
};
const SPEC_SEP = '\u3000';                    // 第三行字段之间的分隔符（与实现同值）
const TRIM_EDGE = /^[\s\u3000]+|[\s\u3000]+$/g;
// 「一个字段值算不算存在」的唯一口径：null/undefined/空串/纯半角或全角空白 ⇒ 不存在。
// ★ 这里必须与实现（category-view.js 的 `(v === undefined || v === null) ? '' : String(v).replace(TRIM_EDGE,'')`）
//   完全同构，否则像 `{ weight: ' \u3000' }` 这种值会出现"期望有、实际没有"的假红。
const trimEdgeOf = v => (v === undefined || v === null) ? '' : String(v).replace(TRIM_EDGE, '');
const specPartsOf = c => {
  const parts = [];
  const cat = catalogDisplayOf(c.catalogNumber || c.krause || '');
  if (cat) parts.push(cat);
  for (const v of [c.material, c.diameter, c.weight]) {
    const s = trimEdgeOf(v);
    if (s) parts.push(s);
  }
  return parts;
};
const line3Of = c => { const p = specPartsOf(c); return p.length ? p.join(SPEC_SEP) : null; };
const chipOf = c => {
  const grade = c.condition || c.grade || '';
  const company = c.gradingCompany || '';
  return company ? (grade ? company + ' ' + grade : company) : grade;
};
const metaOf = c => {
  let s = '';
  if (c.year) s += `${c.year}年发行`;
  if (c.purchaseDate) s += ` · ${c.purchaseDate}`;
  if (c.price) s += `以${String(c.price).includes('元') ? c.price : c.price + '元'}的价格购入`;
  return s;
};
// isCoinBoardLayout() 决定"色块与年份之间有没有那一个补上的半角空格"
const row2Of = (c, isCoin) => {
  const chip = chipOf(c), meta = metaOf(c);
  return chip + ((chip && meta && isCoin) ? ' ' : '') + meta;
};

// ─────────── 从页面 DOM 抓一条藏品条目的结构化信息 ───────────
// ★ linkIndex：详情链接 onclick="openCopyDetail(N)" 里的 N —— 就是该条在
//   copyDetailList 里的**全局下标**（renderCopiesList 用 copyDetailList.length 当 idx）。
//   有了它，就不需要假设 DOM 顺序 = 数据顺序，也不必猜 copyDetailList 的作用域：
//   直接"按实现给出的下标"去取那一条数据来算期望。
const ITEMS_JS = sel => `JSON.stringify([...document.querySelectorAll('${sel}')].map(it => {
  const info = it.querySelector('.copy-info');
  const kids = info ? [...info.children] : [];
  const row2 = kids[1] || null;
  const chip = row2 ? row2.querySelector('.condition') : null;
  const metas = kids.filter(k => k.className === 'meta').map(k => k.textContent);
  const link = it.querySelector('.copy-detail-link');
  const oc = link ? String(link.getAttribute('onclick') || '') : '';
  const mIdx = oc.match(/openCopyDetail\\((\\d+)\\)/);
  return {
    linkIndex: mIdx ? Number(mIdx[1]) : null,
    kidCount: kids.length,
    kidCls: kids.map(k => k.className),
    title: kids[0] ? kids[0].textContent : '',
    titleLink: !!link,
    titleOnclick: oc,
    row2: row2 ? row2.textContent : '',
    row2Kids: row2 ? [...row2.children].map(k => ({ cls: k.className, text: k.textContent })) : [],
    chipCls: chip ? chip.className : '',
    chipText: chip ? chip.textContent : '',
    companyAsOwnEl: row2 ? [...row2.children].some(k => k.className === 'meta' && /^(PCGS|ACG|PMG|NGC|ANACS|ICG|ACGE)$/.test(k.textContent)) : null,
    metas: metas,
    whole: info ? info.textContent : ''
  };
}))`;
// 页面上的 copyDetailList = renderCopiesList 的入参（顺序 = 整个分类页的渲染顺序）
const DATA_JS = `JSON.stringify((typeof copyDetailList === 'undefined' ? [] : copyDetailList).map(e => e && e.copy ? e.copy : null))`;
// ★ 取数：优先"当前展开的系列体"，没有展开体时退回整页 .copy-item。
//   配对不靠 DOM 顺序，靠每条自带的全局下标（linkIndex），所以退回整页也不会串台。
const SEL_ALL = '.copy-item';
const SEL_OPEN = '.series-body.open .copy-item';
const readPage = async () => {
  const data = JSON.parse(await evaluate(DATA_JS));
  let items = JSON.parse(await evaluate(ITEMS_JS(SEL_OPEN)));
  const scoped = items.some(it => it.linkIndex !== null);
  if (!scoped) items = JSON.parse(await evaluate(ITEMS_JS(SEL_ALL)));
  return { items, data, scoped };
};
// 硬币全量系列 + dataKey→路由片段 的映射，全部在**页面里**算好再带回 Node。
// ★ 必须在页面数据加载完之后调用（模块顶层的页面还是 about:blank）；
//   ★ 也必须在页面里算 route：coinCategoryTree 是页面里的全局词法绑定，Node 侧看不到。
// ★ 路由片段 =「父分类 id / 子分类 id」，只对**直接子级**成立（形如 #coins/<父>/<子>/s<序号>）。
//   不要写成递归 walker：递归到子级时 `cat` 已经变成子分类自己，会把父 id 覆盖掉。
const SERIES_JS = `JSON.stringify((function () {
  const routeMap = {};
  const keys = [];
  for (const cat of (typeof coinCategoryTree !== 'undefined' ? coinCategoryTree : [])) {
    if (cat.children && cat.children.length) {
      for (const sub of cat.children) {
        if (sub.dataKey) { routeMap[sub.dataKey] = cat.id + '/' + sub.id; keys.push(sub.dataKey); }
      }
    } else if (cat.dataKey) { routeMap[cat.dataKey] = cat.id; keys.push(cat.dataKey); }
  }
  const series = [];
  for (const k of keys) {
    const d = (window.COIN_DATA_MAP || {})[k]; if (!d || !d.series) continue;
    d.series.forEach((s, si) => {
      const copies = s.varieties ? s.varieties.reduce((a, v) => a.concat(v.copies || []), []) : (s.copies || []);
      series.push({ dataKey: k, si: si, name: s.seriesName, copies: copies, route: routeMap[k] || null });
    });
  }
  return { series: series, routeMap: routeMap };
})())`;
let allSeries = [], routeMap = {};

// ─────────── 把"页面上抓到的一条 + 它自己给出的数据下标"对齐 ───────────
// ★ 不假设 DOM 顺序、也不假设 copyDetailList 的作用域：用详情链接里的全局下标直接取数据。
const pairsOf = (items, data) => items
  .filter(it => it.linkIndex !== null && it.linkIndex >= 0 && it.linkIndex < data.length && data[it.linkIndex])
  .map(it => ({ it, c: data[it.linkIndex], idx: it.linkIndex }));
// 该条在页面上对应的"第三行"：第三行 = 各 .meta 里**文本等于 line3Of(c) 的那个**。
// ★ 数据没有第三行时返回 null —— **不要**退回 metas[0]：万一实现多挂了一个 meta
//   （例如把 remark 当第三行、或凭空多一行），退回会让它看起来"有第三行"，把问题盖住。
//   修好写法后，"第三行该不该有"由 kidCount 与 remark 计数共同把关（见 ② 节）。
const specsTextOf = (it, c) => {
  const want = line3Of(c);
  if (want === null) return null;
  const metas = it.metas || [];
  const hit = metas.find(m => m === want);
  return hit === undefined ? null : hit;
};
const specsClsOf = it => (it.kidCls && it.kidCls.includes('meta') ? 'meta' : '');
const remarkOf = (it, c) => (c.remark ? String(c.remark) : null);
const expectKidCount = c => 2 + (line3Of(c) === null ? 0 : 1) + (c.remark ? 1 : 0);

// dataKey → 路由片段：直接用页面带回来的 routeMap（页面里算的）
const routeOf = k => (routeMap || {})[k];

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ② 硬币分类内容页：逐条与 copyDetailList 现算值比对 ══════\n');
const coinCount = await boot('coins/commemorative_coins/coincomm/s3', SEL_ALL);
ok(coinCount > 0, `② 硬币分类内容页渲染出了藏品条目（.copy-item ${coinCount} 个）`);
({ series: allSeries, routeMap } = JSON.parse(await evaluate(SERIES_JS)));   // 数据已加载，这里才取得到
console.log(`  路由映射（dataKey→分类路由）：${JSON.stringify(routeMap)}`);
const S3 = await readPage();
const P3pairs = pairsOf(S3.items, S3.data);
console.log(`  页面上 .copy-item ${S3.items.length} 条（取数作用域${S3.scoped ? '=当前展开的系列体' : '=整页'}）；copyDetailList（整个分类页）${S3.data.length} 条；按详情链接下标配对 ${P3pairs.length} 对`);
console.log(`  第 1 对实测：下标 ${P3pairs[0] && P3pairs[0].idx}  色块=${JSON.stringify(P3pairs[0] && P3pairs[0].it.chipText)}  第二行=${JSON.stringify(P3pairs[0] && P3pairs[0].it.row2)}  第三行=${JSON.stringify(P3pairs[0] && specsTextOf(P3pairs[0].it, P3pairs[0].c))}`);
ok(P3pairs.length > 0 && P3pairs.length === S3.items.length,
  `② 页面上每条都能按详情链接里的全局下标取到对应数据（${P3pairs.length}/${S3.items.length} 条）`);

// (a) 逐条：色块 = 数据现算；色块后接原样的年份/购藏文字；第三行 = 目录号+材质+直径+重量
let chipOk = 0, row2Ok = 0, l3Ok = 0, kidOk = 0, remarkOk = 0, metasOk = 0;
const bad = [];
for (const { it, c } of P3pairs) {
  const l3 = specsTextOf(it, c);
  // ★ 把该条**所有** .meta 行的期望列出来逐字比：第三行（有则一层）+ remark（有则一层）。
  //   这样"多挂一层/meta 顺序错/把 remark 当第三行"都会被抓住，而不是靠名字去找一行就放过。
  const wantMetas = [];
  if (line3Of(c) !== null) wantMetas.push(line3Of(c));
  if (c.remark) wantMetas.push(String(c.remark));
  const gotMetas = it.metas || [];
  if (gotMetas.length === wantMetas.length && gotMetas.every((m, k) => m === wantMetas[k])) metasOk++;
  if (it.chipText === chipOf(c)) chipOk++;
  if (it.row2 === row2Of(c, true)) row2Ok++;
  if (String(l3) === String(line3Of(c))) l3Ok++;
  if (it.kidCount === expectKidCount(c)) kidOk++;
  if (String(it.whole || '').includes(String(remarkOf(it, c) || ''))) remarkOk++;
  if (it.chipText !== chipOf(c) || it.row2 !== row2Of(c, true) || String(l3) !== String(line3Of(c))) {
    bad.push({ idx: it.linkIndex, wantChip: chipOf(c), gotChip: it.chipText, wantRow: row2Of(c, true), gotRow: it.row2, wantL3: line3Of(c), gotL3: l3 });
  }
}
const N2 = P3pairs.length;
ok(chipOk === N2, `★ ② 每条色块 = 「数据 gradingCompany + 半角空格 + condition/grade」（${chipOk}/${N2} 条一致，公司在前、恰好一个半角空格）`);
ok(row2Ok === N2, `★ ② 每条第二行 = 色块 + 恰好一个半角空格 + 原样的「年份年发行 · 购藏日期以X元的价格购入」（${row2Ok}/${N2} 条一致）`);
ok(l3Ok === N2, `★ ② 每条第三行 = 目录编号 + 材质 + 直径 + 重量（全角空格 U+3000 分隔、无「材质：」前缀）（${l3Ok}/${N2} 条一致）`);
ok(kidOk === N2, `★ ② 第三行/备注行的存在与否与数据一致（${kidOk}/${N2} 条）`);
ok(remarkOk === N2, `★ ② 备注（remark）该出现的都出现了（${remarkOk}/${N2} 条）`);
ok(metasOk === N2, `★ ② 每条 .meta 行的**条数与顺序**都与数据一致（第三行一层 + remark 一层，没有多余行）（${metasOk}/${N2} 条）`);
for (const d of bad.slice(0, 5)) {
  console.log(`      下标 ${d.idx} 色块 期望 ${JSON.stringify(d.wantChip)} 实际 ${JSON.stringify(d.gotChip)}`);
  console.log(`              第二行 期望 ${JSON.stringify(d.wantRow)}\n                     实际 ${JSON.stringify(d.gotRow)}`);
  console.log(`              第三行 期望 ${JSON.stringify(d.wantL3)} 实际 ${JSON.stringify(d.gotL3)}`);
}

// (b) 结构：色块必须是**一个** .condition 元素，公司不再另起 meta 元素；行首无前导空格
ok(P3pairs.every(({ it }) => !it.chipText || it.chipCls === 'condition'),
  `★ ② 评级渲染成**一个** .condition 色块（${P3pairs.filter(({ it }) => it.chipText).length} 条有色块，class 全为 condition）`);
ok(P3pairs.every(({ it }) => it.companyAsOwnEl === false),
  '★ ② 评级公司不再是紧挨着的另一个独立 meta 元素（原来 MS67 与 ACG 是两个块、顺序还是反的）');
ok(P3pairs.every(({ it }) => specsClsOf(it) === 'meta'),
  '② 第三行走的仍是既有的 .meta 文字体系');
ok(P3pairs.every(({ it }) => !it.row2.startsWith(' ') && !it.row2.includes('  ')),
  '★ ② 第二行没有前导空格、没有连续空格');
// (c) 第一行小标题与详情入口
ok(P3pairs.every(({ it }) => String(it.title || '').includes('详细信息') && it.titleLink === true && /openCopyDetail\(/.test(String(it.titleOnclick || ''))),
  `② 第 1 行「详细信息」小标题原样保留、仍可点开详情卡片（${JSON.stringify(P3pairs[0] && P3pairs[0].it.title)}）`);

// (d) 第三行的三类判别（对**每一条**逐条做，不写死任何藏品）：
//     ① 分隔符真的是 U+3000（不是半角空格）；② 没有连续/首尾全角空格与连续半角空格；
//     ③ 每一段与数据对应字段逐字相同（原样照抄，不抽数字、不剥汉字）。
let sepOk = 0, segOk = 0, noPrefixOk = 0, placeholders = 0;
for (const { it, c } of P3pairs) {
  const l3 = String(specsTextOf(it, c) == null ? '' : specsTextOf(it, c));
  const want = specPartsOf(c);
  if (want.length === 0) { sepOk++; noPrefixOk++; continue; }
  const segs = l3.split(SPEC_SEP);
  if (segs.length === want.length && (want.length === 1 || l3.includes(SPEC_SEP))) sepOk++;
  if (segs.length === want.length && segs.every((s, k) => s === want[k])) segOk++;
  if (l3 === l3.replace(TRIM_EDGE, '') && !l3.includes(SPEC_SEP + SPEC_SEP) && !/ {2}/.test(l3)) noPrefixOk++;
  if (/(undefined|null|NaN)/.test(it.whole)) placeholders++;
}
ok(sepOk === N2, `★ ② 第三行按**全角空格 U+3000** 切出的段数与数据字段数一致（${sepOk}/${N2} 条；半角空格实现会被这里抓到）`);
ok(segOk === N2, `★ ② 第三行每一段与数据字段**逐字相同**（原样照抄，不抽数字不剥汉字）（${segOk}/${N2} 条）`);
ok(noPrefixOk === N2, `★ ② 第三行没有首尾空白/连续全角空格/连续半角空格（${noPrefixOk}/${N2} 条）`);
ok(placeholders === 0 && P3pairs.every(({ it }) => !/材质[:：]/.test(it.whole)),
  `★ ② 任何一条都没有 undefined/null/NaN 占位、也没有「材质：」前缀（${placeholders} 条占位）`);

// (e) 至少要有：有色块的条目、有第三行的条目、字段数 ≥2 的第三行（数据里没有就明确报出来，
//     不是"因为某条藏品的名字"才算数）
console.log(`  本页统计：有色块 ${P3pairs.filter(({ it }) => it.chipText).length} 条、有第三行 ${P3pairs.filter(({ c }) => line3Of(c) !== null).length} 条、第三行含 ≥2 段 ${P3pairs.filter(({ c }) => specPartsOf(c).length >= 2).length} 条`);
ok(P3pairs.filter(({ it }) => it.chipText).length > 0, '② 前置：这一页确实有色块条目可比');
ok(P3pairs.filter(({ c }) => line3Of(c) !== null).length > 0, '② 前置：这一页确实有第三行条目可比');
ok(P3pairs.filter(({ c }) => specPartsOf(c).length >= 2).length > 0, '② 前置：这一页确实有"多字段拼成第三行"的条目可比');

// (f) 全库覆盖：对数据里**每一个系列**都跳到它的路由，把该系列的每条藏品都按同样的判据比一遍。
//     这样"只有这一页这 1 条对得上"不会伪装成通过；条数不写死，数据改了自动跟着走。
{
  const routes = new Set();
  const fresh = () => ({ n: 0, chip: 0, row: 0, l3: 0, kid: 0, sep: 0, seg: 0, ph: 0, metas: 0 });
  const tot = fresh();
  let visited = 0, seriesWithData = 0;
  const badAll = [];
  for (const s of allSeries) {
    const frag = routeOf(s.dataKey);
    if (!frag || !s.copies.length) continue;
    seriesWithData++;
    const hash = `coins/${frag}/s${s.si}`;
    if (routes.has(hash)) continue;
    routes.add(hash);
    await boot(hash, SEL_ALL);
    const P = await readPage();
    const ps = pairsOf(P.items, P.data);
    if (ps.length === 0) continue;
    visited++;
    for (const { it, c } of ps) {
      // ★ 用 specsTextOf 的 null 语义参与比对（不是 String(null)=''）：
      //   数据没有第三行时，页面上也不许出现一行。
      const wantL3 = line3Of(c);
      const l3 = specsTextOf(it, c);
      const want = specPartsOf(c);
      const segs = String(l3 == null ? '' : l3).split(SPEC_SEP);
      const wantMetas = [];
      if (wantL3 !== null) wantMetas.push(wantL3);
      if (c.remark) wantMetas.push(String(c.remark));
      const gotMetas = it.metas || [];
      tot.n++;
      if (it.chipText === chipOf(c)) tot.chip++;
      if (it.row2 === row2Of(c, true)) tot.row++;            // 这些都是硬币路由 → isCoinBoardLayout() 为真
      if (l3 === wantL3) tot.l3++;
      if (it.kidCount === expectKidCount(c)) tot.kid++;
      if (want.length === 0 || (segs.length === want.length && String(l3).includes(SPEC_SEP))) tot.sep++;
      if (segs.length === want.length && segs.every((x, k) => x === want[k])) tot.seg++;
      if (gotMetas.length === wantMetas.length && gotMetas.every((m, k) => m === wantMetas[k])) tot.metas++;
      if (/(undefined|null|NaN)/.test(it.whole)) tot.ph++;
      if (it.chipText !== chipOf(c) || it.row2 !== row2Of(c, true) || l3 !== wantL3) {
        badAll.push({ hash, idx: it.linkIndex, wantChip: chipOf(c), gotChip: it.chipText, wantRow: row2Of(c, true), gotRow: it.row2, wantL3: wantL3, gotL3: l3 });
      }
    }
  }
  console.log(`  全库覆盖：走过 ${visited} 个系列路由（数据里有藏品的系列 ${seriesWithData} 个），共比对 ${tot.n} 条藏品`);
  for (const d of badAll.slice(0, 6)) console.log(`      ${d.hash} 下标 ${d.idx}\n        色块 期望 ${JSON.stringify(d.wantChip)} 实际 ${JSON.stringify(d.gotChip)}\n        第二行 期望 ${JSON.stringify(d.wantRow)} 实际 ${JSON.stringify(d.gotRow)}\n        第三行 期望 ${JSON.stringify(d.wantL3)} 实际 ${JSON.stringify(d.gotL3)}`);
  ok(tot.n > 0 && visited > 0, `★ ② 全库覆盖确实跑到了藏品（${tot.n} 条 / ${visited} 个系列路由）`);
  ok(tot.n >= P3pairs.length, `★ ② 全库覆盖的条数不少于首屏那一条（${tot.n} ≥ ${P3pairs.length}）—— 说明覆盖面真的扩大了`);
  ok(tot.chip === tot.n, `★ ② 全库每条色块都与数据现算一致（${tot.chip}/${tot.n}）`);
  ok(tot.row === tot.n, `★ ② 全库每条第二行都与数据现算一致（${tot.row}/${tot.n}）`);
  ok(tot.l3 === tot.n, `★ ② 全库每条第三行都与数据现算一致（含"该有/不该有"）（${tot.l3}/${tot.n}）`);
  ok(tot.kid === tot.n, `★ ② 全库每条的子节点数与数据一致（${tot.kid}/${tot.n}）`);
  ok(tot.metas === tot.n, `★ ② 全库每条 .meta 行的条数与顺序都与数据一致（${tot.metas}/${tot.n}）`);
  ok(tot.sep === tot.n, `★ ② 全库每条第三行按全角空格切出的段数都正确（${tot.sep}/${tot.n}）`);
  ok(tot.seg === tot.n, `★ ② 全库每条第三行每一段与数据字段逐字相同（${tot.seg}/${tot.n}）`);
  ok(tot.ph === 0, `★ ② 全库没有任何 undefined/null/NaN 占位（${tot.ph} 条）`);
  ok(badAll.length === 0, `★ ② 全库逐条比对无一处不符（${badAll.length} 处）`);
}

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ③ 直径/重量含中文前缀时必须原样照抄（结构定位，不认某条藏品） ══════\n');
// 先在页面数据里找出"直径或重量含 CJK"的那些拷贝，再按数据算出的系列下标跳到对应路由。
// 找不到就让"合成样本"那一节（④）承担这件事 —— 判据不依赖某条具体藏品是否存在。
const CJK = /[\u4e00-\u9fff]/;
const hasCjkSpec = c => CJK.test(String((c && c.diameter) || '')) || CJK.test(String((c && c.weight) || ''));
const cjkSeries = allSeries.filter(s => s.copies.some(hasCjkSpec))
  .map(s => ({ dataKey: s.dataKey, si: s.si, name: s.name, n: s.copies.filter(hasCjkSpec).length }));
console.log(`  数据里直径/重量含中文的系列：${JSON.stringify(cjkSeries.map(s => ({ route: s.dataKey + '/s' + s.si, name: s.name, n: s.n })))}`);
ok(cjkSeries.length > 0, `③ 前置：数据里确实存在"直径/重量含中文"的藏品（${cjkSeries.length} 个系列，共 ${cjkSeries.reduce((a, s) => a + s.n, 0)} 条）—— 这条用来验证原样照抄`);
if (cjkSeries.length > 0) {
  const target = cjkSeries[0];
  const route = `${target.dataKey}/s${target.si}`;
  const n3 = await boot(`coins/commemorative_coins/coincomm/${route}`, SEL_ALL);
  const P3 = await readPage();
  const cjkPairs = pairsOf(P3.items, P3.data).filter(({ c }) => hasCjkSpec(c));
  console.log(`  路由 #coins/commemorative_coins/coincomm/${route}（系列《${target.name}》）页面上 ${n3} 条，其中含中文直径/重量 ${cjkPairs.length} 条`);
  let verbatim = 0, cjkShown = 0;
  for (const { it, c } of cjkPairs) {
    const l3 = String(specsTextOf(it, c) == null ? '' : specsTextOf(it, c));
    const parts = specPartsOf(c);
    const segs = l3.split(SPEC_SEP);
    if (segs.length === parts.length && segs.every((s, k) => s === parts[k])) verbatim++;
    for (const v of [c.diameter, c.weight]) {
      const s = trimEdgeOf(v);                       // 与实现同一套 trim（半角 + 全角空白）
      if (s && CJK.test(s) && l3.includes(s)) cjkShown++;
    }
  }
  const expectCjkSegs = cjkPairs.reduce((a, { c }) => a + [c.diameter, c.weight].filter(v => { const s = trimEdgeOf(v); return s && CJK.test(s); }).length, 0);
  ok(cjkPairs.length > 0, `③ 定位到含中文直径/重量的条目（${cjkPairs.length} 条）`);
  ok(verbatim === cjkPairs.length, `★ ③ 含中文的直径/重量**原样照抄**（逐字段相同：${verbatim}/${cjkPairs.length} 条）`);
  ok(cjkShown === expectCjkSegs && expectCjkSegs > 0, `★ ③ 含中文的值整段出现在第三行里（${cjkShown}/${expectCjkSegs} 个值）—— 没有被抽数字、没有被剥汉字`);
  const sample = cjkPairs[0];
  if (sample) console.log(`  样例：数据 diameter=${JSON.stringify(sample.c.diameter)} weight=${JSON.stringify(sample.c.weight)} → 第三行 ${JSON.stringify(specsTextOf(sample.it, sample.c))}`);
} else {
  skipped('★ ③ 含中文的直径/重量原样照抄 —— 数据里当前没有 CJK 直径/重量');
  skipped('★ ③ 含中文的值整段出现在第三行里 —— 同上');
}

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ④ 字段缺失时的规则（合成数据直接过一遍渲染函数） ══════\n');
const SYN = JSON.parse(await evaluate(`(() => {
  const mk = (copy) => {
    const box = document.createElement('div');
    box.innerHTML = renderCopiesList([copy], [], 'X', -1);
    const info = box.querySelector('.copy-info');
    const kids = [...info.children];
    const metas = kids.filter(k => k.className === 'meta');
    return { kidCount: kids.length, line3: metas[0] ? metas[0].textContent : null, all: info.textContent };
  };
  return JSON.stringify({
    a: mk({ catalogNumber: 'Sun-X1', material: '铜镍合金', diameter: '', weight: '9.32g' }),
    b: mk({ catalogNumber: '', material: '铝镁合金', diameter: '18mm', weight: '0.67g' }),
    c: mk({ material: '铜合金' }),
    d: mk({ diameter: '外接圆直径30mm' }),
    e: mk({}),
    f: mk({ material: null, diameter: undefined, weight: '' }),
    g: mk({ catalogNumber: 'Unlisted', material: '铜合金' }),
    h: mk({ material: '铜镍合金', diameter: '   ' }),
    i: mk({ weight: ' 9.32g ' }),
    j: mk({ material: '铜镍合金', diameter: '\u3000\u3000' }),
    k: mk({ material: 'Cu Ni', diameter: '30mm' })
  });
})()`));
for (const [k, label, want] of [
  ['a', '缺 diameter（空串）→ 只拼存在的字段', 'Sun-X1\u3000铜镍合金\u30009.32g'],
  ['b', '缺 catalogNumber（空串）→ 行首不补位', '铝镁合金\u300018mm\u30000.67g'],
  ['c', '只有 material', '铜合金'],
  ['d', '只有 diameter（中文前缀）', '外接圆直径30mm'],
  ['g', '目录编号是 Unlisted → 格式化后为空，不占位', '铜合金'],
  ['h', 'diameter 是半角纯空白 → 视作不存在，不留双空格', '铜镍合金'],
  ['i', '数值带半角首尾空格 → 去掉首尾空白后拼接', '9.32g'],
  ['j', 'diameter 是**全角**纯空白 → 同样视作不存在', '铜镍合金'],
  ['k', '值**内部**的空格原样保留（只在字段之间加全角空格）', 'Cu Ni\u300030mm']
]) {
  ok(SYN[k].line3 === want, `★ ④ ${label}：期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(SYN[k].line3)}`);
}
ok(SYN.e.line3 === null && SYN.e.kidCount === 2,
  `★ ④ 材质/直径/重量/目录编号全缺 → 第三行整个不渲染（子节点 ${SYN.e.kidCount} 个，没有空 div）`);
ok(SYN.f.line3 === null && SYN.f.kidCount === 2,
  `★ ④ null / undefined / 空串一律不渲染成占位文字（子节点 ${SYN.f.kidCount} 个）`);
ok([SYN.a, SYN.b, SYN.c, SYN.d, SYN.g, SYN.h, SYN.i, SYN.j, SYN.k].every(x => !/(undefined|null|NaN)/.test(x.all)),
  '★ ④ 任何组合下都没有 undefined/null/NaN 文字');
// ★ 多字段的那些行：分隔符必须是全角，且不能有连续/首尾全角空格。
//   k（值内部本来就带半角空格）单独排除在"不含半角空格"之外 —— 那是数据内容，不该被动。
for (const key of ['a', 'b', 'k']) {
  const v = String(SYN[key].line3 || '');
  ok(v.indexOf('\u3000') >= 0 && !/\u3000{2}/.test(v) && !/^\u3000|\u3000$/.test(v),
    `★ ④ ${key} 多字段时用的是全角空格且没有连续/首尾全角空格（${JSON.stringify(v)}）`);
}
ok(!/\u3000/.test(String(SYN.j.line3 || '')),
  `★ ④ j 那个"全是全角空白"的字段被整段跳过 → 只剩一个字段时**没有**分隔符（${JSON.stringify(SYN.j.line3)}）`);
ok(['a', 'b', 'j'].every(key => !/ /.test(String(SYN[key].line3 || ''))),
  `★ ④ 多字段行的分隔符里**没有**半角空格（${JSON.stringify(['a', 'b', 'j'].map(key => SYN[key].line3))}）`);

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑤ 纸币板块（同一段渲染代码复用）逐条结构校验（不钉基线快照） ══════\n');
// ★ 纸币与硬币共用 renderCopiesList，区别只有 isCoinBoardLayout() —— 纸币**没有**色块与
//   年份之间那一个补上的空格。这里对**整页**纸币条目逐条现算比对 + 结构校验，
//   不写死条数、不写死任何一条的原文，所以用户改纸币数据不会假红。
const noteCount = await boot('notes/rmb/rmb3', SEL_ALL);
const P5 = await readPage();
const P5pairs = pairsOf(P5.items, P5.data);
console.log(`  纸币页面上 .copy-item ${P5.items.length} 条（作用域${P5.scoped ? '=当前展开的系列体' : '=整页'}）；copyDetailList ${P5.data.length} 条；配对 ${P5pairs.length} 对`);
console.log(`  第 1 对实测：${JSON.stringify(P5pairs[0] && P5pairs[0].it.whole)}`);
ok(noteCount > 0 && P5.items.length > 0, `⑤ 纸币分类内容页渲染出来了（.copy-item ${noteCount} 个）`);
ok(P5pairs.length === P5.items.length && P5pairs.length > 0, `⑤ 页面条目都能按详情链接下标取到数据（${P5pairs.length}/${P5.items.length} 条）`);
let nChip = 0, nRow = 0, nL3 = 0, nKid = 0, nMetas = 0;
for (const { it, c } of P5pairs) {
  const wantL3 = line3Of(c);
  const l3 = specsTextOf(it, c);
  const wantMetas = [];
  if (wantL3 !== null) wantMetas.push(wantL3);
  if (c.remark) wantMetas.push(String(c.remark));
  const gotMetas = it.metas || [];
  if (it.chipText === chipOf(c)) nChip++;
  if (it.row2 === row2Of(c, false)) nRow++;
  if (l3 === wantL3) nL3++;
  if (it.kidCount === expectKidCount(c)) nKid++;
  if (gotMetas.length === wantMetas.length && gotMetas.every((m, k) => m === wantMetas[k])) nMetas++;
}
const N5 = P5pairs.length;
ok(nChip === N5, `★ ⑤ 纸币每条色块 = 数据 condition（不额外拼公司）（${nChip}/${N5} 条）`);
ok(nRow === N5, `★ ⑤ 纸币每条第二行与改版前逐字一致（色块后**不补**那个半角空格）（${nRow}/${N5} 条）`);
ok(nL3 === N5, `★ ⑤ 纸币每条第三行与数据现算值逐字一致（含"该有/不该有"）（${nL3}/${N5} 条）`);
ok(nKid === N5, `★ ⑤ 纸币条目的行数与数据一致（${nKid}/${N5} 条）`);
ok(nMetas === N5, `★ ⑤ 纸币每条 .meta 行的条数与顺序都与数据一致（${nMetas}/${N5} 条）`);
ok(!P5pairs.some(({ it }) => /材质[:：]/.test(it.whole)), '★ ⑤ 纸币条目里没有凭空冒出「材质：」这类硬币字段文案');
ok(P5pairs.every(({ it }) => it.companyAsOwnEl === false), '★ ⑤ 纸币条目里没有多出独立的评级公司 meta 元素（没被硬币的逻辑误伤）');
ok(P5pairs.every(({ it }) => !it.row2.startsWith(' ') && !it.row2.includes('  ')), '★ ⑤ 纸币第二行没有前导空格、没有连续空格');
const noteChipStats = P5pairs.filter(({ it }) => it.chipText).length, noteSpecStats = P5pairs.filter(({ c }) => line3Of(c) !== null).length;
console.log(`  纸币本页统计：有色块 ${noteChipStats} 条、有第三行 ${noteSpecStats} 条`);
ok(noteChipStats > 0 || noteSpecStats > 0, `⑤ 前置：纸币这一页确实有色块/第三行条目可比（色块 ${noteChipStats}、第三行 ${noteSpecStats}）`);

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑥ 真实数据里"目录编号为空/Unlisted"的条目（结构定位，不认某条藏品） ══════\n');
// 在硬币数据里找 catalogNumber 为空或 Unlisted 的真实条目（页面里第三行会从材质开始），
// 按数据的系列下标跳到对应路由，并核对"行首不空位"。找不到就明确报"数据里当前没有"。
const emptyCatSeries = allSeries.filter(s => s.copies.some(c => !String((c && (c.catalogNumber || c.krause)) || '').trim() || /unlisted/i.test(String((c && c.catalogNumber) || ''))))
  .map(s => ({ dataKey: s.dataKey, si: s.si, name: s.name, n: s.copies.filter(c => !String((c && (c.catalogNumber || c.krause)) || '').trim() || /unlisted/i.test(String((c && c.catalogNumber) || ''))).length }));
console.log(`  数据里"目录编号为空/Unlisted"的系列：${JSON.stringify(emptyCatSeries.map(s => s.dataKey + '/s' + s.si + '（' + s.name + '，' + s.n + ' 条）'))}`);
ok(emptyCatSeries.length > 0, `⑥ 前置：数据里确实存在"目录编号为空/Unlisted"的真实条目（${emptyCatSeries.length} 个系列）`);
if (emptyCatSeries.length > 0) {
  const t6 = emptyCatSeries[0];
  const n6 = await boot(`coins/commemorative_coins/coincomm/${t6.dataKey}/s${t6.si}`, SEL_ALL);
  const P6 = await readPage();
  const isEmptyCat = c => !String((c && (c.catalogNumber || c.krause)) || '').trim() || /unlisted/i.test(String((c && c.catalogNumber) || ''));
  const hits = pairsOf(P6.items, P6.data).filter(({ c }) => isEmptyCat(c));
  let headOk = 0;
  for (const { it, c } of hits) {
    const got = specsTextOf(it, c);                     // 数据没有第三行 ⇒ 期望就是 null
    const want = specPartsOf(c);                        // 第一段不应是目录号（因为格式化后为空）
    const l3 = String(got == null ? '' : got);
    const segs = l3.split(SPEC_SEP);
    const okHere = want.length === 0
      ? (got === null)
      : (segs.length === want.length && segs.every((s, k) => s === want[k]) && !l3.startsWith(SPEC_SEP));
    if (okHere) headOk++;
  }
  console.log(`  路由 #coins/commemorative_coins/coincomm/${t6.dataKey}/s${t6.si}（系列《${t6.name}》）当前系列 ${n6} 条，其中目录号为空/Unlisted ${hits.length} 条`);
  ok(hits.length > 0 && headOk === hits.length, `★ ⑥ 这些条目的第三行从材质开始、行首不空位、字段仍逐字对应（${headOk}/${hits.length} 条）`);
  const s6 = hits[0];
  if (s6) console.log(`  样例：catalogNumber=${JSON.stringify(s6.c.catalogNumber)} → 第三行 ${JSON.stringify(specsTextOf(s6.it, s6.c))}（现算期望 ${JSON.stringify(line3Of(s6.c))}）`);
  ok(hits.every(({ it, c }) => {
    const l3 = String(specsTextOf(it, c) == null ? '' : specsTextOf(it, c));
    return l3 === l3.replace(TRIM_EDGE, '') && !l3.includes(SPEC_SEP + SPEC_SEP) && !/(undefined|null|NaN)/.test(it.whole);
  }), '★ ⑥ 这些条目也没有前导/尾随空白、没有连续全角空格、没有 undefined/null/NaN 占位');
} else {
  skipped('★ ⑥ 目录编号为空/Unlisted 的真实条目 —— 数据里当前没有（该场景由 ④ 节的 b/g 合成样本覆盖）');
}

// ══════════════════════════════════════════════════════════════
try { await send('Fetch.disable'); } catch { }
console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail}${skip ? ` / 跳过 ${skip}` : ''} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch { }
try { child.kill(); } catch { }
try { server.close(); } catch { }
process.exit(fail === 0 ? 0 : 1);
