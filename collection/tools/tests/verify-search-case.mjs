// 搜索大小写不敏感 + 字段名不再"全命中"——验收集
//
// 背景（用户测评报告）：
//   分字段搜索对拉丁字母大小写敏感。all（全字段）与 krause（目录编号）走
//   normalizeForSearch() 兜底，而 name/version/year/agency/copyid 直接拿原始关键词
//   去 includes() 已转小写的字段值 —— 同一串字符换个搜索类型就"查无此物"。
//   实测：KP04057 冠字号 0 件 / kp04057 1 件；ACG 评级机构 0 件 / acg 316 件；
//   MS67 0 件 / ms67 4 件；65E 0 件 / 65e 26 件。
//   另外评级机构模式会匹配 detailFields 的中文标签，输入「评级分数」「评级公司」
//   返回 339 件（=所有有该字段的藏品），即"按字段名搜索 = 全命中"。
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

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label}`); } }
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

const MODES = [['version', '冠字号'], ['agency', '评级机构'], ['all', '全字段'], ['copyid', '评级编号'], ['name', '名称'], ['krause', '目录编号'], ['year', '年份']];

try {
  await send('Page.enable'); await send('Runtime.enable');
  console.log(`══════ 搜索大小写一致性（${LIVE ? '线上' : '本地'}）══════`);

  // ── 1. 用户报告的矩阵：纸币板块 ─────────────────────────────────────────────
  console.log('\n── 1. 用户报告的矩阵（纸币）──');
  await boot('notes');
  const NOTES_PAIRS = [
    ['KP04057', 'kp04057', '冠字号'],
    ['ACG', 'acg', '评级机构'],
    ['65E', '65e', '评级机构'],
    ['A101459C', 'a101459c', '冠字号'],
    ['Rupees', 'rupees', '名称'],
    ['KM# 130', 'km# 130', '目录编号'],
  ];
  const notesCounts = {};
  for (const [up, low, label] of NOTES_PAIRS) {
    for (const [t] of MODES) {
      const a = await count(up, t), b = await count(low, t);
      notesCounts[`${t}|${up}`] = a; notesCounts[`${t}|${low}`] = b;
      if (a || b) console.log(`    「${up}」/「${low}」 ${label}(${t}) → ${a} / ${b}`);
      ok(a === b, `${t} 模式大小写等价：${up}=${a} vs ${low}=${b}`);
      if (b > 0) ok(a > 0, `${t} 模式大写输入能命中（${up} → ${a}，小写是 ${b}）`);
    }
  }

  // ── 2. 硬币板块 ───────────────────────────────────────────────────────────
  console.log('\n── 2. 硬币板块 ──');
  await boot('coins');
  for (const [up, low] of [['MS67', 'ms67'], ['ACG', 'acg'], ['PCGS', 'pcgs'], ['PF69', 'pf69']]) {
    for (const [t] of MODES) {
      const a = await count(up, t), b = await count(low, t);
      if (a || b) console.log(`    「${up}」/「${low}」 ${t} → ${a} / ${b}`);
      ok(a === b, `coins ${t} 模式大小写等价：${up}=${a} vs ${low}=${b}`);
      if (b > 0) ok(a > 0, `coins ${t} 模式大写输入能命中（${up} → ${a}）`);
    }
  }

  // ── 3. 全角输入（NFKC 归一化）─────────────────────────────────────────────
  console.log('\n── 3. 全角输入 ──');
  await boot('notes');
  // ★ 基准必须取"同一个词的半角写法"，不能取它的某个子串：
  //   「ACG 65E」= 24 件，而子串「65E」= 26 件（多出的两条是 PMG 65E 之类）。
  const FW_CASES = [
    ['ＡＣＧ', 'ACG', 'agency', '全角字母'],
    ['ＡＣＧ ６５Ｅ', 'ACG 65E', 'agency', '全角字母+数字（含空格）'],
    ['Ａ101459C', 'A101459C', 'version', '首字母全角'],
    ['ｋｐ０４０５７', 'KP04057', 'version', '全角冠字号'],
  ];
  for (const [fw, half, mode, label] of FW_CASES) {
    const a = await count(fw, mode), b = await count(half, mode);
    console.log(`    「${fw}」→ ${a} 件，「${half}」→ ${b} 件  [${label}]`);
    ok(a === b && b > 0, `${label}：全角与半角等价（${a} vs ${b}）`);
  }

  // ── 4. 罗马数字不能被"折成几个 I" ──────────────────────────────────────────
  // NFKC 会把罗马数字兼容分解成 ASCII：Ⅰ→I、Ⅱ→II、Ⅲ→III、Ⅶ→VII。
  // 于是「ⅢⅡⅠ」变成 6 个 I，能命中「ⅠⅡⅢ」甚至「ⅦⅡⅡ」；搜「ⅠO888」命中 IO88888767
  // （用户实测报告）。这些本来就是不同的冠字号，必须区分开。
  // ★ 同时要守住 NFKC 存在的理由：全角/半角仍要等价（上一节），ASCII 的 IO888 仍要能命中。
  console.log('\n── 4. 罗马数字不再退化成 I 计数 ──');
  const NORM = JSON.parse(await evaluate(`(()=>JSON.stringify({
    san: normalizeForSearch('ⅢⅡⅠ'), yi: normalizeForSearch('ⅠⅡⅢ'), qi: normalizeForSearch('ⅦⅡⅡ'),
    ioRoman: normalizeForSearch('ⅠO888'), ioAscii: normalizeForSearch('IO888'),
    one: normalizeForSearch('Ⅲ'), full: normalizeForSearch('ＡＣＧ'), km: normalizeForSearch('ＫＭ＃ 130')
  }))()`));
  console.log('    ' + JSON.stringify(NORM));
  ok(NORM.one === 'ⅲ', `单个「Ⅲ」归一化后是 1 个字符（实测 ${JSON.stringify(NORM.one)}），不再是 3 个 i`);
  ok(NORM.san !== NORM.yi && NORM.san !== NORM.qi,
    `「ⅢⅡⅠ」与「ⅠⅡⅢ」/「ⅦⅡⅡ」归一化后不再相同（${JSON.stringify(NORM.san)} vs ${JSON.stringify(NORM.yi)} vs ${JSON.stringify(NORM.qi)}）`);
  ok(NORM.ioRoman !== NORM.ioAscii, `「ⅠO888」与「IO888」归一化后不再相同（${JSON.stringify(NORM.ioRoman)} vs ${JSON.stringify(NORM.ioAscii)}）`);
  ok(NORM.full === 'acg' && NORM.km === 'km#130',
    `全角→半角 / 去空白没被改坏（ＡＣＧ→${NORM.full}，ＫＭ＃ 130→${NORM.km}）`);

  // 真实数据里跑一遍（冠字号模式）
  const versionsOf = async (kw) => JSON.parse(await evaluate(`(()=>{
    performSearchAndRender(${JSON.stringify(kw)}, 'version');
    const r = (typeof prevSearchResults !== 'undefined' && prevSearchResults) ? prevSearchResults : [];
    return JSON.stringify(r.map(x => String((x && x.copy && x.copy.version) || (x && x.version) || '')).slice(0, 30));
  })()`));
  const vIoRoman = await versionsOf('ⅠO888');
  console.log(`    搜「ⅠO888」→ ${JSON.stringify(vIoRoman)}`);
  ok(!vIoRoman.includes('IO88888767'), `搜罗马数字的「ⅠO888」不再命中 ASCII 的 IO88888767（命中 ${JSON.stringify(vIoRoman)}）`);
  const vIoAscii = await versionsOf('IO888');
  console.log(`    搜「IO888」→ ${JSON.stringify(vIoAscii)}`);
  ok(vIoAscii.includes('IO88888767'), `ASCII 的「IO888」仍能命中 IO88888767（没把正常路径一起关掉）`);
  const vSan = await versionsOf('ⅢⅡⅠ');
  console.log(`    搜「ⅢⅡⅠ」→ ${JSON.stringify(vSan)}`);
  ok(!vSan.includes('ⅠⅡⅢ06173849') && !vSan.includes('ⅦⅡⅡ'),
    `搜「ⅢⅡⅠ」不再命中「ⅠⅡⅢ」/「ⅦⅡⅡ」（命中 ${JSON.stringify(vSan)}）`);
  const vQi = await versionsOf('ⅦⅡⅡ');
  console.log(`    搜「ⅦⅡⅡ」→ ${JSON.stringify(vQi)}`);
  ok(vQi.includes('ⅦⅡⅡ'), `搜「ⅦⅡⅡ」仍能命中它自己（命中 ${JSON.stringify(vQi)}）`);
  const vYi = await versionsOf('ⅠⅡⅢ06173849');
  console.log(`    搜「ⅠⅡⅢ06173849」→ ${JSON.stringify(vYi)}`);
  ok(vYi.includes('ⅠⅡⅢ06173849'), `完整的罗马数字冠字号仍能精确命中（命中 ${JSON.stringify(vYi)}）`);

  // ── 5. 中文字段标签不再"全命中"────────────────────────────────────────────
  console.log('\n── 5. 评级机构模式：中文字段标签 ──');
  for (const kw of ['评级分数', '评级公司', '评级机构', '评级证书编号']) {
    const n = await count(kw, 'agency');
    console.log(`    「${kw}」 评级机构模式 → ${n} 件`);
    ok(n === 0, `「${kw}」不再全命中（期望 0，实际 ${n}）`);
  }
  const acgAll = await count('ACG', 'all');
  ok(acgAll > 0, `全字段模式搜「ACG」仍能命中（${acgAll} 件）`);

  // ── 6. 走真实 UI（下拉框 + 输入框 + 搜索按钮）──────────────────────────────
  console.log('\n── 6. 真实 UI 路径 ──');
  await boot('notes');
  for (const [kw, type, label] of [['ACG', 'agency', '大写+评级机构'], ['KP04057', 'version', '大写+冠字号'], ['acg', 'agency', '小写+评级机构']]) {
    const ui = JSON.parse(await uiCount(kw, type));
    const direct = await count(kw, type);
    console.log(`    UI「${kw}」(${label}) → 可见容器顶层条目 ${ui.render}，全部节点 ${ui.raw}，数据 ${ui.data} 条，直接调用 ${direct} 条 [view=${ui.view} ${ui.key}]`);
    ok(ui.data === direct && ui.data > 0, `UI 路径与数据路径一致且非空（${label}：${ui.data} vs ${direct}）`);
    ok(ui.render === ui.data, `UI 顶层条目数与结果数一致（${label}：${ui.render} vs ${ui.data}）`);
    if (ui.raw !== ui.render) console.log(`    ⚠ 信息项（既有问题，非本次改动引入）：每条结果在 DOM 里是 ${Math.round(ui.raw / Math.max(ui.render, 1))} 层嵌套`);
  }

  console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.log('!! 异常: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch { } try { child.kill(); } catch { } try { if (server) server.close(); } catch { }
  await sleep(300); process.exit(process.exitCode || 0);
}
