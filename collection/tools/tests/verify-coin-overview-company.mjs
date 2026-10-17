// ==================== verify-coin-overview-company.mjs ====================
// 硬币**概览**条目第二行的评级公司前缀：
//
//   原来：MS67 · 1984年发行 · Sun-J2a1
//   改为：PCGS MS67 · 1984年发行 · Sun-J2a1
//
// 用户口径（逐条落实）：
//   ① 只改硬币概览条目第二行：**评级公司**放在**分数**前面，中间恰好一个**半角空格**
//      （不是 `·`、不是全角空格）；
//   ② 第二行其余部分逐字不动（`·` 的个数与位置、`1984年发行`、目录号 Sun-J2a1 原样）；
//   ③ 第一行（标题）不动；
//   ④ 数据里没有评级公司时不加前缀 —— 不留前导空格、不出现 undefined/null/占位文字；
//   ⑤ 只改硬币概览：**详情页**（category-view.js 的 renderCopiesList，色块 PCGS MS67）与
//      其它板块（纸币/文章等）一律不碰 —— 第 ⑤/⑥ 节对页面上**全部**纸币概览条目逐条做
//      结构性校验。
//
// 实现处：collection/overview.js 的 renderOverviewGroup()（全局概览 #coins 与
//         分类概览 #coins/<父分类> 共用它；分类概览那一份在 category-view.js 里是另一段
//         独立循环，本用例两条路由都验）。
// 公司键名：硬币数据里的 `gradingCompany`（分数是 `grade`；纸币没有这个字段，公司名本来
//         就写在 `condition` 里，如 "ACG 66E" ⇒ 这段拼接对纸币是恒等变换）。
//
// ★★ 判据只钉**渲染行为**，不钉**数据快照**：
//   期望文本一律从"页面上的数据对象"现算（条数、公司名、目录号、正文都不写死），
//   所以在编辑数据（加币/删币/改价格/改材质/加条目）时**不会假红**，只有渲染被改坏才红。
//   这里**故意没有**任何写死的 sha256 或"某几条的原文基线" —— 那两个东西钉的是数据内容，
//   而数据是用户会持续编辑的东西。
//   也**故意不去读数据源码文件**：源码文本的写法（引号/缩进/嵌套层级）与渲染无关，
//   用它算期望同样会因"改数据"假红。期望只来自运行时数据对象（COIN_DATA_MAP / DATA_MAP）。
//
// 自包含、零依赖：自己起静态服务器、自己拉起无头 Chrome（CDP）、自己断言。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

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
const userDir = await mkdtemp(join(tmpdir(), 'cdpCoinOv-'));
// 端口段 15000-15089：与现有用例的写死端口（9416…10995、10608…10877）和已用的随机段
// （10900-10989 / 11000-11089 / 11200-11289 / 11300-11389 / 11500-11589 / 11600-11689 /
//   11800-11889 / 11900-11989 / 12000-12089 / 12200-12289 / 12300-12389 / 12550-12669 /
//   12700-12819 / 13000-13089 / 13500-13589 / 13700-13789 / 13900-13989 / 14000-14089 /
//   14200-14289 / 14900-14989 / 15200-15289 / 16500-16589 / 16600-16689 / 17000-17089）
// 全都不重叠；check-portable.mjs 会静态复核这件事。
const DP = 15000 + Math.floor(Math.random() * 90);
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
// 线上图片地址改写到本地（CI 无外网也能跑；图片加载成败不影响本用例的文案断言）
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
  for (let i = 0; i < 200; i++) {
    const r = await evaluate(`(()=>document.readyState==='complete' && document.querySelectorAll('${sel}').length>0)()`).catch(() => false);
    if (r) break;
    await sleep(250);
  }
  await sleep(1500);
  return await evaluate(`document.querySelectorAll('${sel}').length`).catch(() => -1);
}

// ─────────── 页面里取「概览条目」的原始文本（第一行标题 + 第二行 detail） ───────────
const ROWS = `JSON.stringify([...document.querySelectorAll('.search-result-item')].map(el => {
  const info = el.querySelector('.info');
  const name = info && info.querySelector('.name');
  const det = info && info.querySelector('.detail');
  return det ? { name: name ? name.textContent : null, detail: det.textContent } : null;
}).filter(Boolean))`;

// ─────────── 硬币概览应有的条目元信息（顺序 = renderOverview/renderCategoryOverview 的遍历顺序） ───────────
// 直接从页面上的 coinCategoryTree / COIN_DATA_MAP 推导 —— 不写死任何条数与文本，
// 数据一改（加币/删币/改值）这里自动跟着走，只有"渲染与数据不一致"才会红。
const COIN_META = `(() => {
  const out = [];
  const walk = cat => {
    for (const sub of (cat.children || [])) walk(sub);
    if (cat.dataKey) out.push({ key: cat.dataKey, data: (window.COIN_DATA_MAP || {})[cat.dataKey] });
  };
  for (const cat of (typeof coinCategoryTree !== 'undefined' ? coinCategoryTree : [])) walk(cat);
  const items = [];
  for (const src of out) {
    const data = src.data;
    if (!data || !data.series) continue;
    for (const series of data.series) {
      if (series.varieties) {
        for (const v of series.varieties) for (const c of (v.copies || [])) items.push({
          name: series.seriesName + ' - ' + v.varietyName, copy: {
            version: c.version, condition: c.condition, grade: c.grade,
            gradingCompany: c.gradingCompany, year: c.year,
            catalogNumber: c.catalogNumber, krause: c.krause } });
      } else {
        for (const c of (series.copies || [])) items.push({
          name: series.seriesName, copy: {
            version: c.version, condition: c.condition, grade: c.grade,
            gradingCompany: c.gradingCompany, year: c.year,
            catalogNumber: c.catalogNumber, krause: c.krause } });
      }
    }
  }
  return JSON.stringify(items);
})()`;

// 纸币概览的期望同样现算：DATA_MAP 里所有条目拉平（顺序 = renderOverview 的遍历顺序）
const NOTE_META = `(() => {
  const out = [];
  for (const k of Object.keys(window.DATA_MAP || {})) {
    const data = window.DATA_MAP[k];
    if (!data || !data.series) continue;
    for (const series of data.series) {
      if (series.varieties) {
        for (const v of series.varieties) for (const c of (v.copies || [])) out.push({
          version: c.version, condition: c.condition, grade: c.grade, year: c.year,
          catalogNumber: c.catalogNumber, krause: c.krause,
          gradingCompany: c.gradingCompany, purchaseDate: c.purchaseDate, price: c.price });
      } else {
        for (const c of (series.copies || [])) out.push({
          version: c.version, condition: c.condition, grade: c.grade, year: c.year,
          catalogNumber: c.catalogNumber, krause: c.krause,
          gradingCompany: c.gradingCompany, purchaseDate: c.purchaseDate, price: c.price });
      }
    }
  }
  return JSON.stringify(out);
})()`;

// ─────────── 期望的第二行：公司前缀（有公司才有，中间恰好一个半角空格）+ 其余逐字不动 ───────────
// formatCatalogNumber 的口径照抄 core.js（页面上**已经存在**的目录号格式化函数：
// "Unlisted" ⇒ 空、带 '#' 或 sun- 开头原样、其余补 'Pick# '）。必须跟着它算，否则
// 数据里 catalogNumber:"Unlisted" 的条目（页面渲染成**没有**目录号那一段）会被误判。
const catalogDisplayOf = num => {
  if (!num) return '';
  const s = String(num).trim();
  if (/unlisted/i.test(s)) return '';
  if (s.includes('#') || /^sun[-#]/i.test(s)) return s;
  return 'Pick# ' + s;
};
// 第二行的"分数那一段"：纸币是 condition（公司名本来就写在里面）、硬币是 grade。
const chipOf = c => (c.condition || c.grade || '');
const expectDetail = c => {
  const company = (typeof c.gradingCompany === 'string') ? c.gradingCompany.trim() : '';
  const grade = chipOf(c);
  let s = '';
  if (c.version) s += c.version + ' · ';
  if (company) s += company + ' ';
  if (grade) s += grade + ' · ';
  if (c.year) s += c.year + '年发行';
  const catalog = catalogDisplayOf(c.catalogNumber || c.krause || '');
  if (catalog) s += ' · ' + catalog;
  return s;
};

// 硬币概览条目必须长成这个形态：`<公司> <分数> · <年份>年发行[ · <目录号>]`
const COIN_SHAPE = /^([A-Za-z][A-Za-z0-9.\-]*) (\S+) · (\d{4})年发行( · (Sun-[A-Za-z0-9.\-]+|Pick# \S+|KM# \S+))?$/;
// 反方向的守卫：条目第二行**行首**不许是"某个评级公司 + 空格 + 分数"这种被误加前缀的形态。
// ★ 为什么必须排除"公司名 + 年份"：纸币合法的 "ACGE 1962年发行" 也是"字母 token + 空格"，
//   不加这层限制会把合法数据误报成红。这里用直白判定（不用 lookahead，行为更可读更稳）：
//   token 后面必须**不是** `年` 开头，且剩余部分是 `<分数> · <年份>年发行` 的形态。
const leadingTokenEnd = s => (/^[A-Za-z][A-Za-z0-9.\-]*/.exec(s) || [''])[0].length;
const looksLikeWrongPrefix = s => {
  const n = leadingTokenEnd(s);
  if (!n || s[n] !== ' ') return false;
  if (s[n + 1] === '年') return false;
  return /^\S+ · \d{4}年发行/.test(s.slice(n + 1));
};

// 逐条比对的公共小工具：打印不一致的明细（最多 6 条）并返回它们
const diffRows = (rows, want) => {
  const bad = [];
  for (let i = 0; i < Math.min(rows.length, want.length); i++) {
    if (rows[i].detail !== want[i]) bad.push({ i, want: want[i], got: rows[i].detail });
  }
  for (const d of bad.slice(0, 6)) console.log(`      #${d.i} 期望 ${JSON.stringify(d.want)}\n          实际 ${JSON.stringify(d.got)}`);
  return bad;
};

try {
  // ══════════════════════════════════════════════════════════════
  console.log('══════ ① 硬币全局概览（#coins）：第二行 = 公司 + 空格 + 分数 ══════\n');
  const n1 = await boot('coins', '.search-result-item');
  const meta1 = JSON.parse(await evaluate(COIN_META));
  const rows1 = JSON.parse(await evaluate(ROWS));
  const with1 = meta1.filter(m => typeof m.copy.gradingCompany === 'string' && m.copy.gradingCompany.trim() !== '');
  console.log(`  概览条目 ${rows1.length} 条；数据里硬币条目 ${meta1.length} 条（其中有评级公司 ${with1.length} 条、没有 ${meta1.length - with1.length} 条）`);
  console.log(`  第 1 条实测：${JSON.stringify(rows1[0] && rows1[0].name)}\n            ${JSON.stringify(rows1[0] && rows1[0].detail)}`);
  ok(n1 > 0 && rows1.length > 0 && rows1.length === n1, `① 硬币概览渲染出来了（.search-result-item ${n1} 个）`);
  ok(rows1.length === meta1.length, `① 页面条数与数据条数一致（页面 ${rows1.length} / 数据 ${meta1.length}）`);
  ok(with1.length > 0, `① 前置：数据里确实有带评级公司的硬币条目（${with1.length} 条，公司取值 ${JSON.stringify([...new Set(with1.map(m => m.copy.gradingCompany))])}）`);

  // (a) 期望值现算：整条第二行逐字比
  const bad1 = diffRows(rows1, meta1.map(m => expectDetail(m.copy)));
  ok(bad1.length === 0, `★ ① 每一条第二行 = <公司> + 恰好一个半角空格 + <分数> + 原有 " · 年份年发行 · 目录号"（${rows1.length - bad1.length}/${rows1.length} 条一致）`);

  // (b) 有公司的条目：形态 + 公司取自数据原文 + 公司后恰好一个半角空格
  const badShape = [], badCompany = [], badSep = [];
  for (let i = 0; i < Math.min(rows1.length, meta1.length); i++) {
    const c = meta1[i].copy;
    const company = (typeof c.gradingCompany === 'string') ? c.gradingCompany.trim() : '';
    if (!company) continue;
    if (!COIN_SHAPE.test(rows1[i].detail)) badShape.push({ i, t: rows1[i].detail });
    if (!rows1[i].detail.startsWith(company + ' ')) badCompany.push({ i, company, t: rows1[i].detail });
    if (!/^ [^ ]/.test(rows1[i].detail.slice(company.length))) badSep.push({ i, company, t: rows1[i].detail });
  }
  ok(badShape.length === 0, `★ ① 有公司的条目第二行都形如「<公司> <分数> · <年份>年发行 · <目录号>」（不合 ${badShape.length} 条）`);
  ok(badCompany.length === 0, `★ ① 前缀里的公司就是数据 gradingCompany 的原文（对不上 ${badCompany.length} 条）`);
  ok(badSep.length === 0, `★ ① 公司后面恰好一个半角空格、紧接着分数（不是 ` + '`·`' + `/全角空格/两个空格；不合 ${badSep.length} 条）`);
  ok(!rows1.some(r => /[A-Za-z]+·/.test(r.detail)), '★ ① 没有出现「公司紧贴 `·`」（PCGS·MS67 这种）的写法');
  ok(!rows1.some(r => /\u3000/.test(r.detail)), '★ ① 第二行里没有全角空格 U+3000（用户明确要普通空格）');

  // (c) 第二行其余部分逐字不动：`·` 的个数与位置 / 年份 / 目录号 / 标题
  let sepsOk = 0, yearOk = 0, catOk = 0;
  for (let i = 0; i < Math.min(rows1.length, meta1.length); i++) {
    const c = meta1[i].copy, t = rows1[i].detail;
    if ((t.match(/ · /g) || []).length === (c.version ? 1 : 0) + 1 + (catalogDisplayOf(c.catalogNumber || c.krause || '') ? 1 : 0)) sepsOk++;
    if (!c.year || t.includes(c.year + '年发行')) yearOk++;
    const cat = catalogDisplayOf(c.catalogNumber || c.krause || '');
    if (!cat || t.endsWith(' · ' + cat)) catOk++;
  }
  ok(sepsOk === meta1.length, `★ ① 第二行的 ` + '`·`' + ` 个数与位置与原来一致（${sepsOk}/${meta1.length}）`);
  ok(yearOk === meta1.length, `★ ① 年份写法原样（${yearOk}/${meta1.length}）`);
  ok(catOk === meta1.length, `★ ① 目录号原样收尾（数据里 "Unlisted" 之类的占位照旧不渲染那一段；${catOk}/${meta1.length}）`);
  const titleDiff = [];
  for (let i = 0; i < Math.min(rows1.length, meta1.length); i++) if (rows1[i].name !== meta1[i].name) titleDiff.push({ i, want: meta1[i].name, got: rows1[i].name });
  ok(titleDiff.length === 0, `★ ① 第一行（标题）与数据里的系列/品种名一字不差（不同 ${titleDiff.length} 条）`);
  for (const d of titleDiff.slice(0, 3)) console.log(`      #${d.i} 期望 ${JSON.stringify(d.want)}\n          实际 ${JSON.stringify(d.got)}`);

  // (d) 没有公司的条目：不许有前导空格 / 占位文字（数据里本来就没有时只会空过，不会假红）
  ok(!rows1.some(r => /^[ \u3000]/.test(r.detail)), `★ ① 没有公司时不留前导空格（以空格开头的条目 ${rows1.filter(r => /^[ \u3000]/.test(r.detail)).length} 条）`);
  ok(!rows1.some(r => /(undefined|null|NaN|未知|N\/A|Unlisted)/.test(r.detail)), '★ ① 第二行里没有 undefined/null/NaN/占位文字');
  ok(!rows1.some(r => /  +/.test(r.detail)), '★ ① 第二行里没有连续空格');
  ok(meta1.every(m => !m.copy.gradingCompany || !/^[ \u3000]/.test(m.copy.gradingCompany)),
    '① 数据里的公司值本身没有前导空白（两个面都不变）');

  // ══════════════════════════════════════════════════════════════
  console.log('\n══════ ② 分类概览（#coins/<父分类>，另一段渲染循环）同样加上公司 ══════\n');
  const n2 = await boot('coins/commemorative_coins', '.search-result-item');
  const rows2 = JSON.parse(await evaluate(ROWS));
  const meta2All = JSON.parse(await evaluate(COIN_META));
  console.log(`  分类概览条目 ${rows2.length} 条（硬币数据共 ${meta2All.length} 条，父分类只取自己那一支）`);
  console.log(`  第 1 条实测：${JSON.stringify(rows2[0] && rows2[0].detail)}`);
  ok(n2 > 0 && rows2.length > 0 && rows2.length < meta2All.length,
    `② 分类概览渲染出来了（${n2} 条，少于全部 ${meta2All.length} 条 ⇒ 确实只渲染了该父分类）`);
  // 期望值：按渲染顺序在数据总表里"认领"同名同文本的那一条（同名系列可能有重复，用 used 标记）
  let same2 = 0; const diff2 = [];
  {
    const pool = meta2All.map(m => ({ m, used: false }));
    for (const r of rows2) {
      const hit = pool.find(p => !p.used && p.m.name === r.name && expectDetail(p.m.copy) === r.detail);
      if (hit) { hit.used = true; same2++; }
      else {
        const cand = pool.filter(p => !p.used && p.m.name === r.name);
        diff2.push({ name: r.name, got: r.detail, want: cand.length ? expectDetail(cand[0].m.copy) : '(数据里没找到同名条目)' });
      }
    }
  }
  ok(same2 === rows2.length && diff2.length === 0,
    `★ ② 分类概览每一条第二行也都带公司前缀且其余逐字一致（${same2}/${rows2.length} 条一致）`);
  for (const d of diff2.slice(0, 5)) console.log(`      ${JSON.stringify(d.name)}\n          期望 ${JSON.stringify(d.want)}\n          实际 ${JSON.stringify(d.got)}`);
  ok(rows2.filter(r => COIN_SHAPE.test(r.detail)).length > 0,
    `★ ② 分类概览里出现「公司 + 空格 + 分数」形态（${rows2.filter(r => COIN_SHAPE.test(r.detail)).length} 条）`);
  ok(!rows2.some(r => /\u3000/.test(r.detail) || /^[ \u3000]/.test(r.detail) || /(undefined|null|NaN)/.test(r.detail)),
    '★ ② 分类概览没有条目含全角空格/前导空格/占位文字');

  // ══════════════════════════════════════════════════════════════
  console.log('\n══════ ③ 负例（自证关键断言真的能红）：没有公司时不加前缀 ══════\n');
  // 真实数据里硬币条目**可能**全部带公司，所以"没有公司"这一支用 renderOverviewGroup() 直接造：
  // 它是纯函数（入参就是 renderOverview 自己攒的那套 item 结构），造出来的 HTML 与真实渲染同源。
  // ★ 边界：本节只覆盖 overview.js 那一处（分类概览那处在 category-view.js，是同一套判据的
  //   另一份实现，没有可比的纯函数入口）—— 两处的"有公司"路径由 ① / ② 两节各自用真实数据守。
  const SYN = JSON.parse(await evaluate(`(() => {
    const mk = (copy, name) => ({ series: { seriesName: name || '合成系列' }, variety: null,
      hasVarieties: false, globalIndex: 1, copy });
    const pick = html => { const d = document.createElement('div'); d.innerHTML = html;
      const det = d.querySelector('.detail'); const nm = d.querySelector('.name');
      return { detail: det ? det.textContent : null, name: nm ? nm.textContent : null }; };
    return JSON.stringify({
      noCompany: pick(renderOverviewGroup('合成', [mk({ grade: 'MS67', year: 1984, catalogNumber: 'Sun-J2a1' })])),
      nullCompany: pick(renderOverviewGroup('合成', [mk({ grade: 'MS67', gradingCompany: null, year: 1984, catalogNumber: 'Sun-J2a1' })])),
      undefCompany: pick(renderOverviewGroup('合成', [mk({ grade: 'MS67', gradingCompany: undefined, year: 1984, catalogNumber: 'Sun-J2a1' })])),
      emptyCompany: pick(renderOverviewGroup('合成', [mk({ grade: 'MS67', gradingCompany: '', year: 1984, catalogNumber: 'Sun-J2a1' })])),
      strUndef: pick(renderOverviewGroup('合成', [mk({ grade: 'MS67', gradingCompany: 'undefined', year: 1984, catalogNumber: 'Sun-J2a1' })])),
      strNull: pick(renderOverviewGroup('合成', [mk({ grade: 'MS67', gradingCompany: 'null', year: 1984, catalogNumber: 'Sun-J2a1' })])),
      noCompanyNoGrade: pick(renderOverviewGroup('合成', [mk({ year: 1984, catalogNumber: 'Sun-J2a1' })])),
      withCompany: pick(renderOverviewGroup('合成', [mk({ grade: 'MS67', gradingCompany: 'PCGS', year: 1984, catalogNumber: 'Sun-J2a1' })])),
      version: pick(renderOverviewGroup('合成', [mk({ version: 'ⅩⅠⅩ7361948', grade: 'MS67', gradingCompany: 'PCGS', year: 1984, catalogNumber: 'Sun-J2a1' })]))
    });
  })()`));
  for (const k of Object.keys(SYN)) console.log(`  ${k.padEnd(18)} → ${JSON.stringify(SYN[k].detail)}`);
  ok(SYN.noCompany.detail === 'MS67 · 1984年发行 · Sun-J2a1', `★ ③ 没有公司 ⇒ 第二行退化为原样 ${JSON.stringify('MS67 · 1984年发行 · Sun-J2a1')}`);
  for (const k of ['nullCompany', 'undefCompany', 'emptyCompany', 'noCompanyNoGrade']) {
    ok(!/^[ \u3000]/.test(SYN[k].detail || '') && !/(undefined|null|NaN)/.test(SYN[k].detail || ''),
      `★ ③ ${k}：没有前导空格、没有 undefined/null（${JSON.stringify(SYN[k].detail)}）`);
  }
  for (const k of ['strUndef', 'strNull']) {
    ok(!/(undefined|null)/.test(SYN[k].detail || ''),
      `★ ③ ${k}：字符串 "undefined"/"null" 也不会当成公司渲染（${JSON.stringify(SYN[k].detail)}）`);
  }
  ok(SYN.withCompany.detail === 'PCGS MS67 · 1984年发行 · Sun-J2a1',
    `★ ③ 有公司 ⇒ 恰好一个半角空格（${JSON.stringify(SYN.withCompany.detail)}）`);
  ok(SYN.version.detail === 'ⅩⅠⅩ7361948 · PCGS MS67 · 1984年发行 · Sun-J2a1',
    `★ ③ 有版本号时公司前缀插在分数前、不和版本段打架（${JSON.stringify(SYN.version.detail)}）`);
  ok(!SYN.withCompany.detail.includes('\u3000') && !SYN.withCompany.detail.includes('\u00b7\u00b7'),
    '★ ③ 合成样本里也没有全角空格 / 连续 `·`');

  // ══════════════════════════════════════════════════════════════
  console.log('\n══════ ④ 详情页（色块 公司+空格+分数）没有被这次改动碰到 ══════\n');
  // 概览与详情页共用的是"评级公司在前"这条口径，但代码是两处（overview.js / category-view.js）。
  // 这里只做一个哨兵，期望值同样从页面数据现算（详情页排版由 verify-copy-detail-text.mjs 全量把关）。
  await boot('coins/commemorative_coins/coincomm', '.copy-item');
  const DETAIL = JSON.parse(await evaluate(`(() => {
    const it = document.querySelector('.copy-item');
    if (!it) return JSON.stringify({ err: '页面没有 .copy-item' });
    const info = it.querySelector('.copy-info');
    const chip = info.querySelector('.condition');
    const c = (typeof copyDetailList !== 'undefined' && copyDetailList[0]) ? copyDetailList[0].copy : null;
    if (!c) return JSON.stringify({ err: 'copyDetailList[0] 取不到数据' });
    const grade = ((typeof c.condition !== 'undefined' && c.condition) || c.grade || '');
    const company = (typeof c.gradingCompany === 'string' && c.gradingCompany.trim()) ? c.gradingCompany.trim() + ' ' : '';
    return JSON.stringify({ err: '', chip: chip ? chip.textContent : null, want: company + grade });
  })()`));
  console.log(`  详情页色块 = ${JSON.stringify(DETAIL.chip)}（数据现算期望 ${JSON.stringify(DETAIL.want)}）`);
  ok(DETAIL.err === '' && DETAIL.chip === DETAIL.want,
    `④ 详情页色块仍是「公司 + 空格 + 分数」（${JSON.stringify(DETAIL.chip)}）`);

  // ══════════════════════════════════════════════════════════════
  console.log('\n══════ ⑤ 其它板块守卫：纸币概览（同一段渲染代码复用）逐条结构校验 ══════\n');
  const n3 = await boot('notes', '.search-result-item');
  const rows3 = JSON.parse(await evaluate(ROWS));
  const notes3 = JSON.parse(await evaluate(NOTE_META));
  console.log(`  纸币概览 ${n3} 条；数据里纸币条目 ${notes3.length} 条`);
  console.log(`  第 1 条实测：${JSON.stringify(rows3[0] && (rows3[0].name + ' || ' + rows3[0].detail))}`);
  ok(n3 > 0 && rows3.length > 0 && rows3.length === n3, `⑤ 纸币概览渲染出来了（.search-result-item ${n3} 个）`);
  ok(notes3.length > 0 && rows3.length === notes3.length, `⑤ 前置：纸币数据里的条目数与页面一致（数据 ${notes3.length} / 页面 ${rows3.length}）`);

  // (a) 整条第二行与"数据现算的期望"逐字比 —— 这条同时覆盖"·的个数与位置"、
  //     "没有多出公司前缀"、"没有占位文字"（期望里根本没有公司前缀这一项）。
  const bad3 = diffRows(rows3, notes3.map(expectDetail));
  ok(bad3.length === 0, `★ ⑤ 纸币概览每一条第二行与数据现算的期望逐字一致（${rows3.length - bad3.length}/${rows3.length} 条）`);

  // (b) 逐条结构校验（不写死条数、不写死原文）
  const leadingSpace = rows3.filter(r => /^[ \u3000]/.test(r.detail));
  const ideoSpace = rows3.filter(r => /\u3000/.test(r.detail));
  const placeholders = rows3.filter(r => /(undefined|null|NaN|N\/A)/.test(r.detail));
  const doubleSpace = rows3.filter(r => /  +/.test(r.detail));
  const prefixed = rows3.filter(r => looksLikeWrongPrefix(r.detail));
  ok(leadingSpace.length === 0, `★ ⑤ 纸币概览没有条目以空格/全角空格开头（${leadingSpace.length} 条${leadingSpace.length ? '：' + JSON.stringify(leadingSpace[0].detail) : ''}）`);
  ok(ideoSpace.length === 0, `★ ⑤ 纸币概览没有条目含全角空格 U+3000（${ideoSpace.length} 条）`);
  ok(placeholders.length === 0, `★ ⑤ 纸币概览没有 undefined/null/NaN/N\/A 之类占位（${placeholders.length} 条）`);
  ok(doubleSpace.length === 0, `★ ⑤ 纸币概览没有"连续空格"（${doubleSpace.length} 条）—— 说明：第二行各段是数据原文照抄 + 固定 " · " 分隔，数据像现在这样不含连续空格时本条恒真；将来若有人往数据里写了连续空格，本条会红，请按当次数据复核后再决定改判据还是改数据`);
  ok(prefixed.length === 0, `★ ⑤ 纸币概览**没有**行首出现"公司 + 空格 + 分数"这种被误加前缀的形态（${prefixed.length} 条${prefixed.length ? '：' + JSON.stringify(prefixed[0].detail) : ''}）`);

  // (c) 误加前缀的专项守卫：候选公司取自**硬币侧数据**（PCGS/ACG…），断言没有一条纸币条目
  //     第二行以"公司 + 空白 + 分数"开头。
  //     ★ 为什么不能用"以公司名开头"就算：纸币自己的 condition 本来就可能以公司名开头
  //       （合法数据 "ACG 65E · 1988年发行 · Pick# 64"、"ACGE 1962年发行"），
  //       光看"公司名开头"会把一大堆合法条目误判成红。真正被误加的形态是：
  //       "硬币侧的公司名 + 空格 + 该条目 condition 之外的东西" —— 所以这里排掉
  //       "紧跟的正文与数据里的 condition 一致" 的情形（那是条目自带的前缀，不是误加）。
  const coinCompanies = [...new Set(meta1.map(m => (typeof m.copy.gradingCompany === 'string' ? m.copy.gradingCompany.trim() : '')).filter(Boolean))];
  const noteCompanyTokens = [...new Set(notes3.map(n => String(n.condition || '').trim().match(/^[A-Za-z][A-Za-z0-9.\-]*/)).filter(Boolean).map(m => m[0]))];
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wronglyPrefixed = rows3.filter((r, i) => {
    const own = String((notes3[i] && notes3[i].condition) || '').trim();
    return coinCompanies.some(co => new RegExp('^' + escapeRe(co) + ' \\S').test(r.detail)) && !r.detail.startsWith(own);
  });
  console.log(`  硬币侧出现过的评级公司：${JSON.stringify(coinCompanies)}；纸币 condition 自带的前缀 token：${JSON.stringify(noteCompanyTokens)}`);
  ok(wronglyPrefixed.length === 0, `★ ⑤ 没有纸币条目行首出现"硬币公司 + 空格 + 正文"这种误加前缀（自家 condition 自带的前缀不算；命中 ${wronglyPrefixed.length} 条${wronglyPrefixed.length ? '：' + JSON.stringify(wronglyPrefixed[0].detail) : ''}）`);
  const mistakenlyPrefixedForeign = rows3.filter(r => looksLikeWrongPrefix(r.detail) && coinCompanies.some(co => r.detail.startsWith(co + ' ')));
  ok(mistakenlyPrefixedForeign.length === 0, `★ ⑤ 行首也没有"硬币公司 + 空格 + 分数"形态（${mistakenlyPrefixedForeign.length} 条）`);
  const noteCompanyFiles = JSON.parse(await evaluate(`(() => {
    const hits = [];
    for (const k of Object.keys(window.DATA_MAP || {})) {
      const d = window.DATA_MAP[k]; if (!d || !d.series) continue;
      for (const s of d.series) {
        const lists = s.varieties ? s.varieties.map(v => v.copies || []) : [s.copies || []];
        for (const l of lists) for (const c of l) if (c && c.gradingCompany !== undefined) hits.push(k);
      }
    }
    return JSON.stringify([...new Set(hits)]);
  })()`));
  console.log(`  纸币数据里带 gradingCompany 字段的数据源：${JSON.stringify(noteCompanyFiles)}`);
  ok(noteCompanyFiles.length === 0, `★ ⑤ 纸币数据里本来就没有 gradingCompany 字段（带该字段的数据源：${JSON.stringify(noteCompanyFiles)}）⇒ 这段拼接对纸币是恒等变换`);

  // (d) 同一次运行内的"两次渲染逐条一致"自比对：切到硬币再切回纸币，两遍文本逐条比。
  //     这条不依赖任何数据快照，数据怎么变都不会假红。
  await boot('coins', '.search-result-item');
  const n3b = await boot('notes', '.search-result-item');
  const rows3b = JSON.parse(await evaluate(ROWS));
  let sameTwoRuns = 0;
  for (let i = 0; i < Math.min(rows3.length, rows3b.length); i++) if (rows3[i].name + '\u0000' + rows3[i].detail === rows3b[i].name + '\u0000' + rows3b[i].detail) sameTwoRuns++;
  ok(n3b === n3 && rows3b.length === rows3.length && sameTwoRuns === rows3.length,
    `★ ⑤ 同一次运行内两次渲染（切到硬币再切回纸币）逐条一致（${sameTwoRuns}/${rows3.length} 条）—— 不钉数据快照的自比对`);

  // ══════════════════════════════════════════════════════════════
  console.log('\n══════ ⑥ 其它板块守卫：其它分类概览（票证等）也未被波及 ══════\n');
  // 票证这类"带子分类"的父分类走 category-view.js 的 renderCategoryOverview()，
  // 与 #notes 全局概览不是同一段循环 —— 所以单独再抓一条路由确认没被波及。
  const n4 = await boot('notes/ticket', '.search-result-item');
  const rows4 = JSON.parse(await evaluate(ROWS));
  const noteKeys = JSON.parse(await evaluate(`JSON.stringify(Object.keys(window.DATA_MAP || {}))`));
  console.log(`  票证分类概览 ${n4} 条；纸币数据表 ${noteKeys.length} 个 dataKey`);
  console.log(`  第 1 条实测：${JSON.stringify(rows4[0] && (rows4[0].name + ' || ' + rows4[0].detail))}`);
  ok(n4 > 0 && rows4.length > 0, `⑥ 票证分类概览渲染出来了（${n4} 条）`);
  ok(!rows4.some(r => /^[ \u3000]/.test(r.detail)), '★ ⑥ 票证概览没有条目以空格/全角空格开头');
  ok(!rows4.some(r => /\u3000/.test(r.detail)), '★ ⑥ 票证概览没有条目含全角空格 U+3000');
  ok(!rows4.some(r => /(undefined|null|NaN)/.test(r.detail)), '★ ⑥ 票证概览没有 undefined/null/NaN');
  ok(!rows4.some(r => looksLikeWrongPrefix(r.detail)), '★ ⑥ 票证概览没有被误加"公司 + 空格 + 分数"前缀');
  ok(noteKeys.length > 0, '⑥ 纸币数据表读到了（守卫断言有对象可比）');

  // ══════════════════════════════════════════════════════════════
  console.log('\n══════ ⑦ 守卫灵敏度探针：合成"被误加前缀的纸币条目"，守卫必须都能抓到 ══════\n');
  // ★ 探针不改任何数据、不写盘、不重渲染页面（避免和"当前 hash 渲染出的容器"打架）：
  //   ① 用页面上的**真实渲染函数** renderOverviewGroup() 渲染纸币形态的假条目
  //      （有 condition、没有 gradingCompany、目录号是裸数字 "64"/"877h"）——
  //      硬币/纸币共用这一处渲染，所以能直接看到"这段代码被改成误加前缀会渲染成什么"；
  //      同时验证"数据里没有 gradingCompany 时渲染结果与纸币现在完全同形"。
  //   ② 把合成出来的坏文本喂给 ⑤ 用的**同一份谓词 / 同一份期望函数**，看它们是否当场报红。
  await boot('coins', '.search-result-item');
  const probeCo = coinCompanies[0] || 'ACG';
  const P_NOVER = { condition: 'ACG 65E', grade: '', year: 1988, catalogNumber: '64', krause: '' };
  const P_VER = { version: 'ⅩⅩⅦ6238600', condition: 'ACG 66E', grade: '', year: 1962, catalogNumber: '877h', krause: '' };
  const SYN2 = JSON.parse(await evaluate(`(() => {
    const mk = copy => ({ series: { seriesName: '合成纸币条目' }, variety: null, hasVarieties: false, globalIndex: 1, copy });
    const txt = html => { const d = document.createElement('div'); d.innerHTML = html;
      const det = d.querySelector('.detail'); const nm = d.querySelector('.name');
      return { detail: det ? det.textContent : null, name: nm ? nm.textContent : null }; };
    const render = copy => txt(renderOverviewGroup('合成', [mk(copy)]));
    const bad = copy => render(Object.assign({}, copy, { gradingCompany: ${JSON.stringify(probeCo)} }));
    return JSON.stringify({
      noVer: render(${JSON.stringify(P_NOVER)}), noVerBad: bad(${JSON.stringify(P_NOVER)}),
      ver: render(${JSON.stringify(P_VER)}), verBad: bad(${JSON.stringify(P_VER)})
    });
  })()`));
  console.log(`  合成纸币条目（无公司、无版本号）渲染 = ${JSON.stringify(SYN2.noVer.detail)}`);
  console.log(`  同一条若被误加公司前缀          = ${JSON.stringify(SYN2.noVerBad.detail)}`);
  console.log(`  合成纸币条目（无公司、有版本号）渲染 = ${JSON.stringify(SYN2.ver.detail)}`);
  console.log(`  同一条若被误加公司前缀          = ${JSON.stringify(SYN2.verBad.detail)}`);
  // ① 没有公司 ⇒ 与"数据现算的期望"逐字一致（这就是"纸币文本恒等变换"的内核）
  ok(SYN2.noVer.detail === expectDetail(P_NOVER) && SYN2.ver.detail === expectDetail(P_VER),
    '★ ⑦ 没有 gradingCompany 时，渲染结果 = ⑤ 用的那份数据现算期望（无版本号/有版本号两种形态都对）');
  ok(SYN2.noVer.detail === 'ACG 65E · 1988年发行 · Pick# 64',
    `★ ⑦ 结果与页面上纸币条目的形态一致（"condition · 年份 · Pick# 目录号"）：${JSON.stringify(SYN2.noVer.detail)}`);
  // ② 把坏文本喂给 ⑤ 用的同一份谓词。
  //    ★ 注意"被误加前缀"在真实数据上会长成什么：条目自己的 condition 已经以公司名开头
  //      （"ACG 65E"），所以误加后是 "PCGS ACG 65E · …" 这种"公司 + 空格 + 公司 + 空格 + 分数"
  //      —— 行首形态谓词 looksLikeWrongPrefix（公司 + 空格 + 分数 · 年份年发行）对它是
  //      **不匹配**的（"ACG 65E" 后面是 " ·" 而不是 " · 1988年发行"），真正抓到它的是
  //      ⑤(c) 的"硬币公司 + 空格 + 正文，且正文不等于自家 condition"谓词。
  //      另一种（condition 本身就是分数、如 "MS67"）才是 looksLikeWrongPrefix 的靶子。两种都自证。
  const escapeReP = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasCompanyPrefix = (detail, own) => coinCompanies.some(co => new RegExp('^' + escapeReP(co) + ' \\S').test(detail))
    && !detail.startsWith(String(own || '').trim());
  for (const [tag, src, badDetail] of [['无版本号', P_NOVER, SYN2.noVerBad.detail], ['有版本号', P_VER, SYN2.verBad.detail]]) {
    ok(badDetail !== expectDetail(src), `★ ⑦ 探针「${tag} + 误加前缀」：与数据现算期望不再逐字一致 ⇒ ⑤(a) 会红（${JSON.stringify(badDetail)}）`);
    ok(badDetail.includes(probeCo + ' '), `★ ⑦ 探针「${tag} + 误加前缀」：多出来的"${probeCo} "前缀能被 ⑤ 的文本检查看到`);
  }
  ok(hasCompanyPrefix(SYN2.noVerBad.detail, P_NOVER.condition),
    `★ ⑦ 探针①：真实形态的误加（"${probeCo} " + 原有以公司名开头的 condition）被 ⑤(c) 的谓词抓到（${JSON.stringify(SYN2.noVerBad.detail)}）`);
  const P_PLAIN = { condition: 'MS67', grade: '', year: 1984, catalogNumber: 'Sun-J2a1', krause: '' };
  const SYN3 = JSON.parse(await evaluate(`(() => {
    const mk = copy => ({ series: { seriesName: '合成条目' }, variety: null, hasVarieties: false, globalIndex: 1, copy });
    const txt = html => { const d = document.createElement('div'); d.innerHTML = html;
      const det = d.querySelector('.detail'); return det ? det.textContent : null; };
    const render = copy => txt(renderOverviewGroup('合成', [mk(copy)]));
    const bad = copy => render(Object.assign({}, copy, { gradingCompany: ${JSON.stringify(probeCo)} }));
    return JSON.stringify({ plain: render(${JSON.stringify(P_PLAIN)}), plainBad: bad(${JSON.stringify(P_PLAIN)}) });
  })()`));
  console.log(`  合成条目（condition 本就是分数）渲染 = ${JSON.stringify(SYN3.plain)}`);
  console.log(`  同一条若被误加公司前缀          = ${JSON.stringify(SYN3.plainBad)}`);
  ok(SYN3.plain === expectDetail(P_PLAIN) && SYN3.plainBad === probeCo + ' ' + expectDetail(P_PLAIN),
    `★ ⑦ 探针②：condition 本就是分数时，误加前缀渲染成 "${probeCo} MS67 · …"（${JSON.stringify(SYN3.plainBad)}）`);
  ok(looksLikeWrongPrefix(SYN3.plainBad) && hasCompanyPrefix(SYN3.plainBad, P_PLAIN.condition),
    '★ ⑦ 探针②：这种行首"公司 + 空格 + 分数"被 ⑤(b) 的形态谓词与 ⑤(c) 的谓词同时抓到');
  // ★ 反例（防止守卫变成"见谁咬谁"）：形状谓词 looksLikeWrongPrefix 本身**区分不了**
  //   "条目自带公司 + 空格 + 分数"（合法，如 "ACG 65E · …"）和"外部公司 + 空格 + 分数"
  //   （误加），它只是个形态筛查；真正定案的是 ⑤(a) 的**规范期望**（期望里根本没有外来公司
  //   前缀这一项）+ ⑤(c) 的"公司 + 空格 + 正文且正文 != 自家 condition"。
  //   所以这里用**页面上真实的纸币全表文本**做假阳性检测：被形状谓词命中的条目，
  //   必须全部能用"自带 condition 前缀"解释清楚（命中数 == 可解释数）。条数不写死。
  const shapeHits = rows3.filter(r => looksLikeWrongPrefix(r.detail));
  const explainable = shapeHits.filter((r, i) => {
    const idx = rows3.indexOf(r);
    const own = String((notes3[idx] && notes3[idx].condition) || '').trim();
    return own && r.detail.startsWith(own);
  });
  console.log(`  形状谓词在 ${rows3.length} 条真实纸币文本上命中 ${shapeHits.length} 条，其中 ${explainable.length} 条可由"条目自带 condition 前缀"解释`);
  ok(shapeHits.length === explainable.length,
    `★ ⑦ 反例：形状谓词的全部命中都能用"条目自带 condition"解释 ⇒ 没有假阳性（${explainable.length}/${shapeHits.length}）`);
  ok(shapeHits.every(r => rows3.some(x => x === r)) && looksLikeWrongPrefix('PCGS MS67 · 1984年发行'),
    '★ ⑦ 形状谓词对真正误加的 "PCGS MS67 · 1984年发行" 仍然报出（不是恒假）');
  ok(!looksLikeWrongPrefix('ACGE 1962年发行') && looksLikeWrongPrefix('PCGS MS67 · 1984年发行'),
    '★ ⑦ 反例：合法数据 "ACGE 1962年发行"（公司名开头但没有分数）不会被误报，而 "PCGS MS67 · 1984年发行" 会被报出来');

  // ══════════════════════════════════════════════════════════════
  try { await send('Fetch.disable'); } catch { }
  console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
  ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
  if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));
} catch (e) {
  fail++;
  console.log(`  ✗ 用例异常：${e && e.message}`);
}

try { ws.close(); } catch { }
try { child.kill(); } catch { }
try { server.close(); } catch { }
process.exit(fail === 0 ? 0 : 1);
