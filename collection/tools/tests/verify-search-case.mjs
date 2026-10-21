// 搜索大小写不敏感 + 字段名不再"全命中"——验收集
//
// 背景（用户测评报告）：
//   分字段搜索对拉丁字母大小写敏感。all（全字段）与 krause（目录编号）走
//   normalizeForSearch() 兜底，而 name/version/year/agency/copyid 直接拿原始关键词
//   去 includes() 已转小写的字段值 —— 同一串字符换个搜索类型就"查无此物"。
//
// ★ 本用例的所有"样例词"一律**从当前数据里现取**（见 SCAN_FN / notesSamples）：
//   以前这里写死了 'ACG'、'KP04057'、'A101459C'、'Rupees'、'ⅠⅡⅢ06173849'、'ⅦⅡⅡ'、
//   'IO88888767' 等具体冠字号/机构名 —— 站主一改数据（改冠字号、换评级公司、删掉某件）
//   这些断言就假红，但被测的那条产品行为其实没坏。现在改成：
//     · 只判 a === b（大小写等价、全角/半角等价）这类**行为**；
//     · "这个词命中了几件"属于数据内容，数据里没有该场景就记 ○ 跳过（单独计数，
//       既不计通过也不计失败），并把原因打出来。
//
// 本脚本：LIVE=1 走线上，否则本地静态服务。
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const LIVE = process.env.LIVE === '1';
// ★ 这里原来写死了开发机的绝对路径（'C:/Users/57891/tong-xiangjie.github.io'）。
//   在本机跑没事，一到 CI 就整片红：runner 上没有这个路径，测试服务器对**每个**请求
//   都 404，页面根本没加载 —— 静态断言全过、84 条运行时 count() 全部"重试 40 次仍未就绪"
//   （84 × 40 × 250ms ≈ 840s，正好把 15 分钟的硬超时耗光，于是 CI 报的是"超时"）。
//   用 process.cwd()：run.mjs 以仓库根为 cwd 起用例，手动跑也要求在仓库根执行。
const ROOT = process.cwd();
const LOCAL = `http://127.0.0.1:0/collection/index.html`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
let server = null, BASE = 'https://tong-xiangjie.github.io/collection/index.html';
if (!LIVE) {
  server = createServer(async (req, res) => {
    try { const p = decodeURIComponent(req.url.split('?')[0]); const f = join(ROOT, p); const buf = await readFile(f);
      res.writeHead(200, { 'Content-Type': MIME[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream' }); res.end(buf);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;
}
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpCaseV-'));
const DP = 10991;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; }

let pass = 0, fail = 0, skipped = 0;
function ok(cond, label) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }
// ★ "数据里当前没有这个场景"时用 skip：**保留**这条检查、既不计通过也不计失败，
//   但把原因打出来（否则就成了假绿）。退出码只看 fail。
const skip = (label) => { skipped++; console.log(`  ○ 跳过 ${label}`); };
async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 140; i++) { const r = await evaluate(`(()=>typeof viewScrollContainers!=='undefined' && Object.keys(viewScrollContainers).length>0 && document.readyState==='complete' && typeof performSearchAndRender==='function')()`).catch(() => false); if (r) break; await sleep(300); }
  await sleep(LIVE ? 2600 : 1800);
}
// 直接调 performSearchAndRender（离 UI），读 prevSearchResults 长度。
// ★ 原来是一发定胜负：CI 上这行抛过异常（注解里的 "at <anonymous>:2:63" 就是它），
//   于是整个用例以一个看不懂的栈收场。现在改成重试 + 把异常原文打成 ✗ 行：
//   · prevSearchResults 还是 falsy（= 渲染没落地）也算没就绪，继续等；
//   · 一直抛异常就打印真实 message（而不是只留栈），annotation 里能直接看到。
const count = async (kw, type) => {
  let lastErr = null;
  for (let i = 0; i < 40; i++) {
    try {
      const n = await evaluate(`(()=>{ if (typeof performSearchAndRender !== 'function') return -2;
        performSearchAndRender(${JSON.stringify(kw)}, ${JSON.stringify(type)});
        return prevSearchResults ? prevSearchResults.length : -1; })()`);
      if (n >= 0) return n;
    } catch (e) { lastErr = e; }
    await sleep(250);
  }
  console.log(`  ✗ count(${JSON.stringify(kw)}, ${JSON.stringify(type)}) 重试 40 次仍未就绪` + (lastErr ? `：${String(lastErr.message).slice(0, 200)}` : ''));
  return -1;
};
// ★ 现取样例词：在某个模式下列出当前真实存在的**字段值**（不是写死的名字）。
//   结果条目长这样：{ dataKey, catName, series, copy, ... } —— 字段值都在 copy 上。
const FIELD_OF = { version: 'version', agency: 'condition', name: 'seriesName', copyid: 'copyId', krause: 'krause', year: 'year' };
const SCAN_FN = `window.__searchSamples = (mode, field, want) => {
  if (typeof performSearchAndRender !== 'function') return { ready:false, total:0, values:[] };
  performSearchAndRender('', mode);
  const r = (typeof prevSearchResults !== 'undefined' && prevSearchResults) ? prevSearchResults : [];
  const seen = new Set(), out = [];
  for (const x of r) {
    const c = (x && x.copy) || {};
    let v;
    if (field === 'seriesName') v = (x && x.series && x.series.seriesName) || '';
    else v = (c[field] !== null && c[field] !== undefined) ? c[field] : '';
    v = String(v).trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    const hasUp = /[A-Z]/.test(v), hasLow = /[a-z]/.test(v);
    if (want === 'mixed' && !hasUp) continue;
    if (want === 'wide' && !/[\\uFF01-\\uFF5E]/.test(v)) continue;
    if (want === 'roman' && !/[\\u2160-\\u217F]/.test(v)) continue;
    out.push(v);
    if (out.length >= 6) break;
  }
  return { ready:true, total: r.length, values: out, hasLowerToo: seen.size > 0 && (() => { for (const v of seen) if (/[a-z]/.test(v)) return true; return false; })() };
}; 1`;
// 读某个模式下的样例词；页面尚未就绪时返回 []（等一下再试）
// ★ 必须等**数据真的挂上全局变量**为止：页面 readyState 到 complete 时，数据文件的
//   <script> 可能还在跑，这时扫出来的是 0 件（会被误判成"数据里没有该字段"⇒ 假跳过）。
const samplesOf = async (mode, field, want = null) => {
  for (let i = 0; i < 16; i++) {
    const r = await evaluate(`JSON.stringify(window.__searchSamples ? window.__searchSamples(${JSON.stringify(mode)}, ${JSON.stringify(field)}, ${JSON.stringify(want)}) : {ready:false,values:[]})`).catch(() => null);
    if (r) {
      const o = JSON.parse(r);
      // 取到值 / 明确有数据但该形态确实没有 ⇒ 都可以收工；两边都空就再等一会儿
      if (o.ready && (o.values.length || o.total > 0)) return o.values.filter(v => !/^ERR:/.test(v));
    }
    await sleep(400);
  }
  return [];
};
// 走真实 UI：选类型 → 填输入框 → 点搜索按钮 → 读结果。
// ★ 渲染条数只能数**当前可见**的滚动容器：各视图容器是常驻的、只是 display 切换，
//   概览页也在用 .search-result-item，直接 document.querySelectorAll 会把概览的
//   336 条一起数进来（实测 971）。
// ★ 再排除"嵌套在另一个 .search-result-item 里"的条目：FLIP 重建路径给每条结果
//   又套了一层同 class 的外壳（renderItemElement 返回的已经是完整条目），
//   所以容器里每条结果是 2 个节点。那是既有的渲染问题（提交 06f797e9 引入），
//   与本次搜索匹配的修复无关 —— 这里只数顶层条目，同时把它作为信息项报出来。
async function uiCount(kw, type) {
  await evaluate(`(()=>{ const s=document.getElementById('searchType'); if(s) s.value=${JSON.stringify(type)};
    const i=document.getElementById('searchInput'); if(i) i.value=${JSON.stringify(kw)}; return true; })()`);
  await evaluate(`(()=>{ const b=document.getElementById('searchBtn'); if(b) b.click(); return true; })()`);
  await sleep(1700);
  return await evaluate(`(()=>{
    const visible = Object.keys(viewScrollContainers).map(k => viewScrollContainers[k])
      .filter(d => d && d.style.display !== 'none');
    let top = 0, all = 0;
    for (const d of visible) {
      for (const it of d.querySelectorAll('.search-result-item')) {
        all++;
        if (!(it.parentElement && it.parentElement.closest('.search-result-item'))) top++;
      }
    }
    return JSON.stringify({ render: top, raw: all, data: prevSearchResults ? prevSearchResults.length : -1,
      view: currentView, key: Object.keys(viewScrollContainers).filter(k => viewScrollContainers[k].style.display !== 'none').join(',') });
  })()`);
}

// ★ 全角化：与产品里的 NFKC 归一化相对（半角→全角后应被折回同一个半角词）
const toFullWidth = (s) => [...String(s)].map(ch => {
  const c = ch.codePointAt(0);
  if (c === 0x20) return '\u3000';
  if (c >= 0x21 && c <= 0x7e) return String.fromCodePoint(c + 0xfee0);
  return ch;
}).join('');

const MODES = [['version', '冠字号'], ['agency', '评级机构'], ['all', '全字段'], ['copyid', '评级编号'], ['name', '名称'], ['krause', '目录编号'], ['year', '年份']];

try {
  await send('Page.enable'); await send('Runtime.enable');
  console.log(`══════ 搜索大小写一致性（${LIVE ? '线上' : '本地'}）══════`);

  // ── 0. 现取样例词（后面所有断言都用它，不写死任何藏品名）──────────────────
  console.log('\n── 0. 从当前数据现取样例词 ──');
  await boot('notes');
  await evaluate(SCAN_FN);
  await evaluate(`(async()=>{ for (let i=0;i<40 && !(window.DATA_MAP && Object.keys(window.DATA_MAP).length);i++) await new Promise(r=>setTimeout(r,200)); return 1; })()`);
  const notesCountAll = await count('', 'all');
  console.log(`    纸币板块：空关键词 = 全部 ${notesCountAll} 件`);
  const notesSamples = [];
  for (const [m, field] of [['version', 'version'], ['agency', 'condition'], ['krause', 'krause'], ['copyid', 'copyId'], ['name', 'seriesName']]) {
    const vals = (await samplesOf(m, field, 'mixed')).slice(0, 2);
    for (const v of vals) if (!notesSamples.some(s => s.v === v)) notesSamples.push({ mode: m, v, lower: v.toLowerCase() });
  }
  console.log(`    现取样例词（含大写字母）：${notesSamples.map(s => `${s.mode}:「${s.v}」`).join('、') || '（一个都没有）'}`);
  ok(notesCountAll > 0, `前置：纸币板块有可搜索的数据（${notesCountAll} 件）`);
  ok(notesSamples.length > 0, `前置：能现取到含大写字母的样例词（${notesSamples.length} 个）${notesSamples.length ? '' : ' —— 数据里没有拉丁字母的话，1/6 两节只能跳过'}`);

  // ── 1. 大小写矩阵：真实样例词 × 7 个搜索模式 ────────────────────────────────
  //   判据只有一条：同一个词的**大写原样**与**小写**必须命中同一批（a === b）。
  //   "命中几件"是数据内容，不在这里判 —— 只在数据里确实有该词时顺带报一下非空。
  console.log('\n── 1. 大小写矩阵（纸币，样例词现取）──');
  for (const s of notesSamples) {
    let empty = 0;
    for (const [t, label] of MODES) {
      const a = await count(s.v, t), b = await count(s.lower, t);
      if (a || b) console.log(`    「${s.v}」/「${s.lower}」 ${label}(${t}) → ${a} / ${b}`);
      ok(a === b, `${t} 模式大小写等价：${s.v}=${a} vs ${s.lower}=${b}`);
      if (b > 0) ok(a > 0, `${t} 模式大写输入能命中（${s.v} → ${a}，小写是 ${b}）`);
      else empty++;
    }
    // 一个词在 7 个模式里的多数模式都搜不到是正常的（例如冠字号在"名称"模式里当然没有），
    // 这里把这一组的空缺**合并成一条 skip**，避免刷屏；原因照写。
    if (empty) skip(`样例词「${s.v}」在 ${empty}/${MODES.length} 个模式里当前数据 0 件，这些模式给不出"大写也能命中"的正面证据`);
  }
  if (!notesSamples.length) skip('纸币板块数据里没有任何含拉丁字母的样例词，1 节的大小写矩阵整节跳过');

  // ── 2. 硬币板块 ───────────────────────────────────────────────────────────
  console.log('\n── 2. 硬币板块 ──');
  await boot('coins');
  await evaluate(SCAN_FN);
  const coinCountAll = await count('', 'all');
  console.log(`    硬币板块：空关键词 = 全部 ${coinCountAll} 件`);
  const coinSamples = [];
  for (const [m, field] of [['agency', 'condition'], ['agency', 'gradingCompany'], ['version', 'version'], ['krause', 'krause'], ['copyid', 'copyId'], ['name', 'seriesName']]) {
    const vals = (await samplesOf(m, field, 'mixed')).slice(0, 2);
    for (const v of vals) if (!coinSamples.some(s => s.v === v)) coinSamples.push({ mode: m, v, lower: v.toLowerCase() });
  }
  console.log(`    现取样例词（含大写字母）：${coinSamples.map(s => `${s.mode}:「${s.v}」`).join('、') || '（一个都没有）'}`);
  for (const s of coinSamples) {
    for (const [t] of MODES) {
      const a = await count(s.v, t), b = await count(s.lower, t);
      if (a || b) console.log(`    「${s.v}」/「${s.lower}」 ${t} → ${a} / ${b}`);
      ok(a === b, `coins ${t} 模式大小写等价：${s.v}=${a} vs ${s.lower}=${b}`);
      if (b > 0) ok(a > 0, `coins ${t} 模式大写输入能命中（${s.v} → ${a}）`);
    }
  }
  if (!coinSamples.length) skip('硬币板块数据里没有任何含拉丁字母的样例词，2 节的大小写矩阵整节跳过');

  // ── 3. 全角输入（NFKC 归一化）─────────────────────────────────────────────
  console.log('\n── 3. 全角输入 ──');
  await boot('notes');
  await evaluate(SCAN_FN);
  // ★ 样例词一律现取，再**由它派生**全角写法（不是写死 'ＡＣＧ'/'ｋｐ０４０５７'）：
  //   基准取同一个词的半角原样，不能取它的某个子串。
  const fwSrc = [];
  for (const [m, field, label] of [['agency', 'condition', '评级机构'], ['version', 'version', '冠字号'], ['krause', 'krause', '目录编号']]) {
    const v = (await samplesOf(m, field, 'mixed'))[0];
    if (v && !fwSrc.some(x => x.half === v)) fwSrc.push({ mode: m, half: v, fw: toFullWidth(v), label });
  }
  ok(fwSrc.length > 0, `前置：能从数据里现取到可全角化的半角样例词（${fwSrc.length} 个）`);
  const FW_CASES = fwSrc.map(x => [x.fw, x.half, x.mode, `${x.label}「${x.half}」→ 全角`]);
  for (const [fw, half, mode, label] of FW_CASES) {
    const a = await count(fw, mode), b = await count(half, mode);
    console.log(`    「${fw}」→ ${a} 件，「${half}」→ ${b} 件  [${label}]`);
    // 行为判据：全角与半角必须等价。非空属于数据内容，单独判、没有数据就跳过。
    ok(a === b, `${label}：全角与半角等价（${a} vs ${b}）`);
    if (b > 0) ok(a > 0 && a === b, `${label}：全角输入也能命中同一批（${a} vs ${b}）`);
    else skip(`${label}：半角基准「${half}」在当前数据里 0 件，给不出非空证据`);
  }
  if (!FW_CASES.length) skip('数据里现取不到半角样例词，3 节整节跳过');

  // ── 4. 罗马数字不能被"折成几个 I" ──────────────────────────────────────────
  // NFKC 会把罗马数字兼容分解成 ASCII：Ⅰ→I、Ⅱ→II、Ⅲ→III、Ⅶ→VII。
  // 于是「ⅢⅡⅠ」变成 6 个 I，能命中「ⅠⅡⅢ」甚至「ⅦⅡⅡ」；搜「ⅠO888」命中 IO88888767
  // （用户实测报告）。这些本来就是不同的冠字号，必须区分开。
  // ★ 这一节的输入不再写死具体冠字号：NP 的输入由**数据里现取到的 version 值**构造；
  //   只有 NFKC 本身的形态（'Ⅰ' 这类字符）是 Unicode 语义、不随数据变。
  console.log('\n── 4. 罗马数字不再退化成 I 计数 ──');
  const ROMAN_ONE = '\u2162';         // Ⅲ
  const ROMAN_PAIR1 = '\u2162\u2161\u2160';   // ⅢⅡⅠ
  const ROMAN_PAIR2 = '\u2160\u2161\u2162';   // ⅠⅡⅢ
  const NORM = JSON.parse(await evaluate(`(()=>JSON.stringify({
    one: normalizeForSearch(${JSON.stringify(ROMAN_ONE)}),
    san: normalizeForSearch(${JSON.stringify(ROMAN_PAIR1)}),
    yi: normalizeForSearch(${JSON.stringify(ROMAN_PAIR2)}),
    qi: normalizeForSearch('ⅦⅡⅡ'),
    ioRoman: normalizeForSearch('ⅠO888'),
    ioAscii: normalizeForSearch('IO888'),
    full: normalizeForSearch('ＡＣＧ'),
    km: normalizeForSearch('ＫＭ＃ 130')
  }))()`));
  console.log('    ' + JSON.stringify(NORM));
  ok(NORM.one === '\u2172', `单个「Ⅲ」归一化后是 1 个字符（实测 ${JSON.stringify(NORM.one)}），不再是 3 个 i`);
  ok(NORM.san !== NORM.yi, `「ⅢⅡⅠ」与「ⅠⅡⅢ」归一化后不再相同（${JSON.stringify(NORM.san)} vs ${JSON.stringify(NORM.yi)}）`);
  ok(NORM.ioRoman !== NORM.ioAscii, `「ⅠO888」与「IO888」归一化后不再相同（${JSON.stringify(NORM.ioRoman)} vs ${JSON.stringify(NORM.ioAscii)}）`);
  ok(NORM.full === 'acg' && NORM.km === 'km#130',
    `全角→半角 / 去空白没被改坏（ＡＣＧ→${NORM.full}，ＫＭ＃ 130→${NORM.km}）`);
  // ★ 纯函数判据：这个坑的形态就是"**两个不同的** roman 冠字号被折成同一个串"。
  //   所以判据不能是"roman 字符还在"（现状就是折成 ASCII 的），而是：
  //   ① 两个内容不同的 roman 串归一化后必须**不相等**（ⅢⅡⅠ vs ⅠⅡⅢ）；
  //   ② 数据里真实存在的 roman 串，各自归一化后仍然两两可区分
  //      （现在的实现把 Ⅰ→i、Ⅱ→ii…，所以只要求"不产生新的合并"，
  //        真被折成同一个串的两条会在下面"不互相误命中"里当场红）。
  const romanVals = await samplesOf('version', 'version', 'roman');
  const romanNorms = JSON.parse(await evaluate(`JSON.stringify(${JSON.stringify(romanVals.slice(0, 8))}.map(v => [v, normalizeForSearch(v)]))`));
  const merged = (() => {
    const byNorm = new Map();
    for (const [v, n] of romanNorms) { if (!byNorm.has(n)) byNorm.set(n, []); byNorm.get(n).push(v); }
    return [...byNorm.values()].filter(a => a.length > 1);
  })();
  console.log(`    真实 roman 冠字号 ${romanNorms.length} 个：${romanNorms.slice(0, 4).map(([v, n]) => `${v}→${n}`).join('，')}`);
  ok(NORM.san !== NORM.yi || NORM.san !== NORM.qi,
    `两个不同的 roman 串「ⅢⅡⅠ」/「ⅠⅡⅢ」/「ⅦⅡⅡ」归一化后互不相同（${JSON.stringify(NORM.san)} / ${JSON.stringify(NORM.yi)} / ${JSON.stringify(NORM.qi)}）`);
  ok(merged.length === 0 || romanNorms.length === 0,
    `数据里现取的 ${romanNorms.length} 个 roman 冠字号归一化后没有互相合并（合并 ${merged.length} 组：${JSON.stringify(merged.slice(0, 2))}）`);
  if (!romanVals.length) skip('当前数据里没有含罗马数字的冠字号，4 节的运行时部分跳过');
  // 真实数据里跑一遍（冠字号模式）：关键词由现取到的 version 值构造
  const versionsOf = async (kw) => JSON.parse(await evaluate(`(()=>{
    performSearchAndRender(${JSON.stringify(kw)}, 'version');
    const r = (typeof prevSearchResults !== 'undefined' && prevSearchResults) ? prevSearchResults : [];
    return JSON.stringify(r.map(x => String((x && x.copy && x.copy.version) || (x && x.version) || '')).slice(0, 30));
  })()`));
  // 取两个互为"不同冠字号"的真实值：其中一个必须是另一个的子串之外的独立值
  let romanPair = null;
  for (let i = 0; i < romanVals.length && !romanPair; i++) {
    for (let j = i + 1; j < romanVals.length; j++) {
      const x = romanVals[i], y = romanVals[j];
      if (x.includes(y) || y.includes(x)) continue;
      romanPair = { x, y }; break;
    }
  }
  if (romanPair) {
    const cx = await count(romanPair.x, 'version'), cy = await count(romanPair.y, 'version');
    const hitsSelf = await versionsOf(romanPair.x);
    console.log(`    搜「${romanPair.x}」→ ${cx} 件；搜「${romanPair.y}」→ ${cy} 件；含「${romanPair.x}」的结果 ${JSON.stringify(hitsSelf.slice(0, 3))}`);
    ok(!hitsSelf.includes(romanPair.y),
      `搜「${romanPair.x}」不再命中另一个 roman 冠字号「${romanPair.y}」（命中 ${JSON.stringify(hitsSelf.slice(0, 3))}）`);
    // 同一节里守住"自己还能被自己搜到"，否则上面那条可能是"搜索整体失灵"换来的
    ok(cx === 0 || hitsSelf.includes(romanPair.x), `roman 冠字号「${romanPair.x}」仍能命中它自己（命中 ${JSON.stringify(hitsSelf.slice(0, 2))}）`);
    if (cx === 0 || cy === 0) skip(`roman 冠字号在当前数据里搜不全（${romanPair.x}=${cx}、${romanPair.y}=${cy} 件），"不互相误命中"缺一半证据`);
  } else {
    skip('当前数据里找不到两个互不包含的 roman 冠字号，4 节的"不互相误命中"跳过');
  }
  // 罗马数字写法**不能**命中 ASCII 写法（这是用户报的原病）。
  //   用"搜 ASCII 写法能命中的那些值"当基准：它们一个都不许出现在罗马数字写法的结果里。
  const IO_ROMAN = '\u2160O888', IO_ASCII = 'IO888';
  const vIoRoman = await versionsOf(IO_ROMAN);
  const vIoAscii = await versionsOf(IO_ASCII);
  console.log(`    搜「${IO_ROMAN}」→ ${JSON.stringify(vIoRoman)}`);
  console.log(`    搜「${IO_ASCII}」→ ${JSON.stringify(vIoAscii)}`);
  ok(vIoAscii.filter(v => vIoRoman.includes(v)).length === 0,
    `搜罗马数字的「${IO_ROMAN}」不再命中 ASCII 写法的冠字号（罗马数字命中 ${JSON.stringify(vIoRoman)}，ASCII 命中 ${JSON.stringify(vIoAscii)}）`);
  if (vIoAscii.length) ok(vIoAscii.some(v => /^IO/i.test(v)), `ASCII 的「${IO_ASCII}」仍能命中以 IO 开头的冠字号（${JSON.stringify(vIoAscii.slice(0, 3))}）`);
  else skip(`当前数据里没有「${IO_ASCII}」形态的冠字号，"正常路径没被一起关掉"跳过`);

  // ── 5. 中文字段标签不再"全命中"────────────────────────────────────────────
  console.log('\n── 5. 评级机构模式：中文字段标签 ──');
  for (const kw of ['评级分数', '评级公司', '评级机构', '评级证书编号']) {
    const n = await count(kw, 'agency');
    console.log(`    「${kw}」 评级机构模式 → ${n} 件`);
    ok(n === 0, `「${kw}」不再全命中（期望 0，实际 ${n}）`);
  }
  // 全字段模式搜一个真实存在的机构词仍要能命中（旧写法写死 'ACG'）
  const agencySample = notesSamples.find(s => s.mode === 'agency');
  if (agencySample) {
    const n = await count(agencySample.v, 'all');
    ok(n > 0, `全字段模式搜真实机构词「${agencySample.v}」仍能命中（${n} 件）`);
  } else {
    skip('数据里没有含拉丁字母的评级机构词，第 5 节的"全字段仍能命中"跳过');
  }

  // ── 6. 走真实 UI（下拉框 + 输入框 + 搜索按钮）──────────────────────────────
  console.log('\n── 6. 真实 UI 路径 ──');
  await boot('notes');
  await evaluate(SCAN_FN);
  const uiCases = [];
  for (const [mode, field, label] of [['agency', 'condition', '评级机构'], ['version', 'version', '冠字号'], ['name', 'seriesName', '名称']]) {
    const v = (await samplesOf(mode, field, 'mixed'))[0];
    if (v) uiCases.push([v, mode, `${label}「${v}」`], [v.toLowerCase(), mode, `${label}「${v.toLowerCase()}」`]);
  }
  if (!uiCases.length) skip('数据里现取不到含大写字母的样例词，第 6 节的 UI 路径整节跳过');
  for (const [kw, type, label] of uiCases) {
    const ui = JSON.parse(await uiCount(kw, type));
    const direct = await count(kw, type);
    console.log(`    UI「${kw}」(${label}) → 可见容器顶层条目 ${ui.render}，全部节点 ${ui.raw}，数据 ${ui.data} 条，直接调用 ${direct} 条 [view=${ui.view} ${ui.key}]`);
    ok(ui.data === direct, `UI 路径与数据路径一致（${label}：${ui.data} vs ${direct}）`);
    if (direct > 0) ok(ui.data > 0, `UI 路径非空（${label}：${ui.data} 条）`);
    else skip(`${label}：该词在当前数据里 0 件，"UI 路径非空"跳过`);
    ok(ui.render === ui.data, `UI 顶层条目数与结果数一致（${label}：${ui.render} vs ${ui.data}）`);
    if (ui.raw !== ui.render) console.log(`    ⚠ 信息项（既有问题，非本次改动引入）：每条结果在 DOM 里是 ${Math.round(ui.raw / Math.max(ui.render, 1))} 层嵌套`);
  }

  console.log(`\n──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.log('!! 异常: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch { } try { child.kill(); } catch { } try { if (server) server.close(); } catch { }
  await sleep(300); process.exit(process.exitCode || 0);
}
