// 台币拆分验证：taiwan.js 按系列拆成多个文件后，父类/子类在真浏览器里是否都正常。
// 已进仓库：collection/tools/tests（A4）。
//
// ★ 本用例不再把「每个文件有几个系列」「子类叫什么名字」写死在表里：
//   站主往 taiwan_5.js 里加/删一个系列、把某个占位文件的 series 填上藏品，
//   以前都会让这里假红（被测的产品行为其实没坏）。现在一律**现算**：
//     · 期望值 = 直接读 notecollection/data/*.js 现数（本文件的 diskOf()）；
//     · 页面值 = 运行时从 window.DATA_MAP / DOM 现读；
//     · 两块现算互证（数据里的 series 数 === 页面渲染出的系列头数）。
//   只有"数据里当前根本没有这个场景"（例如某个占位文件被填上了藏品）才记 ○ 跳过。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

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
const userDir = await mkdtemp(join(tmpdir(), 'cdpTW-'));
const DP = 11000 + Math.floor(Math.random() * 90);
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
let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
// ★ "数据里当前没有这个场景"（例如占位文件的 series 已经被填上藏品）⇒ skip：
//   保留这条检查、既不计通过也不计失败，但必须把原因打出来（否则就是假绿）。
const skip = (m) => { skipped++; console.log(`  ○ 跳过 ${m}`); };

await send('Runtime.enable');
await send('Page.enable');

async function boot(hash) {
  await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#${hash}` });
  for (let i = 0; i < 140; i++) {
    const r = await evaluate(`(()=>typeof viewScrollContainers!=='undefined' && typeof onTabClick==='function' && document.readyState==='complete' && Object.keys(viewScrollContainers).length>0)()`).catch(() => false);
    if (r) break;
    await sleep(120);
  }
  await sleep(450);
}
const viewText = () => evaluate(`(()=>{const el=document.querySelector('.view-container, #categoryView, #listView, main')||document.body;return (el.innerText||'').replace(/\\s+/g,' ').trim();})()`);

// ── 期望值来源：**直接读磁盘上的数据文件**（不是抄一份写死的表）─────────────
//   数据文件把对象挂在全局变量上（const taiwan5Data = {…}），用正则取到变量名后
//   把 `= expr` 当表达式求值即可拿到对象。读不到就返回 null，由调用处判红。
const diskOf = async (file) => {
  try {
    const src = await readFile(file, 'utf8');
    const m = src.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*)/);
    if (!m) return null;
    let body = m[2].trim();
    if (body.endsWith(';')) body = body.slice(0, -1);
    const data = (0, eval)('(' + body + ')');
    return {
      varName: m[1],
      name: data.name,
      series: Array.isArray(data.series) ? data.series.length : -1,
      copies: Array.isArray(data.series) ? data.series.reduce((a, s) => a + ((s.copies && s.copies.length) || 0), 0) : -1,
      fields: Array.isArray(data.detailFields) ? data.detailFields.length : -1,
      readmes: Array.isArray(data.readmes) ? data.readmes.map(r => r.title) : [],
      firstSeries: Array.isArray(data.series) && data.series[0] ? String(data.series[0].seriesName || '') : ''
    };
  } catch (e) { console.log(`    [诊断] 读数据文件失败 ${file}: ${e.message}`); return null; }
};

// ③ 要逐个子类打开的文件清单（id / dataKey 是配置契约，写在这里；系列个数与名字一律现算）
const PLAN = [
  { id: 'taiwanOld', file: 'notecollection/data/taiwan_old.js' },
  { id: 'taiwan38V', file: 'notecollection/data/taiwan_38v.js' },
  { id: 'taiwan43V', file: 'notecollection/data/taiwan_43v.js' },
  { id: 'taiwan1', file: 'notecollection/data/taiwan_1.js' },
  { id: 'taiwan2', file: 'notecollection/data/taiwan_2.js' },
  { id: 'taiwan3', file: 'notecollection/data/taiwan_3.js' },
  { id: 'taiwan4', file: 'notecollection/data/taiwan_4.js' },
  { id: 'taiwan5', file: 'notecollection/data/taiwan_5.js' },
  { id: 'taiwanKm', file: 'notecollection/data/taiwan_km.js' },
  { id: 'taiwanMz', file: 'notecollection/data/taiwan_mz.js' },
  { id: 'taiwanDc', file: 'notecollection/data/taiwan_dc.js' }
];
const PARENT_FILE = 'notecollection/data/taiwan_readme.js';
for (const p of PLAN) {
  const d = await diskOf(p.file);
  // dataKey / 全局变量名沿用文件里现读到的形状（taiwan_5.js → taiwan5Data）
  p.key = d ? d.varName : (p.id.replace(/_([a-z0-9])/g, (s, c) => c.toUpperCase()).replace(/^taiwan/, 'taiwan') + 'Data');
  p.disk = d;
}
const parentDisk = await diskOf(PARENT_FILE);
const diskList = PLAN.map(p => p.disk).filter(Boolean);

console.log('══════ 台币拆分：父类 + 多个子类（期望值现算）══════\n');
console.log(`  磁盘现算：${PLAN.map(p => `${p.id}=${p.disk ? p.disk.series : '✗读不到'}`).join(' ')}；` +
  `父类 ${PARENT_FILE.split('/').pop()} series=${parentDisk ? parentDisk.series : '✗'} readmes=${JSON.stringify(parentDisk ? parentDisk.readmes : [])}`);
ok(PLAN.every(p => p.disk), '前置：11 个子类的数据文件都能被读到（期望值现算成功）');
ok(!!parentDisk, `前置：父类数据文件（${PARENT_FILE}）能被读到`);

// ① 父类节点
await boot('notes/taiwan');
const tree = JSON.parse(await evaluate(`(()=>{
  // 注意：categoryTree 是经典脚本顶层 const，只有全局词法绑定，不在 window 上
  const list = (typeof categoryTree !== 'undefined') ? categoryTree : [];
  const n = list.find(c=>c.id==='taiwan');
  if (!n) return JSON.stringify({ none: true });
  const own = (n.dataKey && window.DATA_MAP) ? window.DATA_MAP[n.dataKey] : null;
  return JSON.stringify({ none:false, name:n.name, dataKey:n.dataKey, hasOwnData: !!n.dataKey, hasOwnFile: !!n.dataFile,
    ownReadmes: (own && Array.isArray(own.readmes)) ? own.readmes.map(r => r.title) : [],
    ownCopies: (own && Array.isArray(own.series)) ? own.series.reduce((a,s)=>a+((s.copies&&s.copies.length)||0),0) : -1,
    ownSeries: (own && Array.isArray(own.series)) ? own.series.length : -1,
    children: (n.children||[]).map(c=>({ id:c.id, name:c.name, dataKey:c.dataKey, dataFile:c.dataFile })) });
})()`));
ok(tree.none === false, '前置：categoryTree 里找得到 taiwan 节点');
if (tree.none) { console.log('\n  父节点都没了，后面的检查没意义。'); process.exitCode = 1; }
else {
  // ★ 父类名字不再写死：与磁盘上父类数据文件的 name 现算比对
  ok(!!parentDisk && tree.name === parentDisk.name, `父类名字与数据文件一致：「${tree.name}」=「${parentDisk ? parentDisk.name : '（读不到）'}」`);
  // ★ 规则升级：「父类自己挂文章」这条需求要求父类能有自己的数据文件。
  //   当初那句"父类不再挂 dataKey/dataFile"的本意是**藏品只来自子文件**（不重复），
  //   写成"不许挂"就把父类文章这条路一起堵死了。现在按本意断言：
  //   可以挂，但那个文件不贡献任何藏品条目。
  ok(tree.hasOwnData && tree.hasOwnFile, '父类可以有自己的数据文件（用于挂文章）');
  ok(tree.ownCopies === 0, `父类的数据文件不贡献藏品条目（copies=${tree.ownCopies}，应为 0）`);
  // 父类那篇文章必须真的随文件加载进来了 —— 这正是第一版失败的原因：
  // readme 写进了 data/taiwan.js（拆分后的旧文件，已不在树里 → 根本不会被加载），
  // 于是"文章"板块里什么都没有。
  const ownReadmes = JSON.parse(await evaluate(`(()=>{
    const d = (window.DATA_MAP && window.DATA_MAP.taiwanReadmeData) || null;
    return JSON.stringify({ loaded: !!d, titles: d && Array.isArray(d.readmes) ? d.readmes.map(r => r.title) : [] });
  })()`));
  // ★ 文章标题从数据里现取（以前写死 '台钞图录'——站主改个标题就假红）
  const parentTitle = parentDisk && parentDisk.readmes.length ? parentDisk.readmes[0] : (ownReadmes.titles[0] || '');
  ok(ownReadmes.loaded, '父类的数据文件（taiwanReadmeData）已加载进 DATA_MAP');
  ok(parentTitle !== '' && ownReadmes.titles.includes(parentTitle),
    `父类挂的文章随之加载（数据文件里是 ${JSON.stringify(parentDisk ? parentDisk.readmes : [])}，运行时是 ${JSON.stringify(ownReadmes.titles)}）`);
  ok(tree.children.length === PLAN.length, `父类下正好 ${PLAN.length} 个子类（实际 ${tree.children.length}）`);
  // ★ 子类名字/顺序不再抄表：与磁盘上各数据文件的 name 现算比对
  const diskNames = PLAN.map(p => p.disk && p.disk.name);
  const namesOk = JSON.stringify(tree.children.map(c => c.name)) === JSON.stringify(diskNames);
  ok(namesOk, `子类名称与顺序与数据文件一致：${tree.children.map(c => c.name).join(' → ')}`);
  const idsOk = JSON.stringify(tree.children.map(c => c.id)) === JSON.stringify(PLAN.map(p => p.id));
  ok(idsOk, `子类 id 与计划一致：${tree.children.map(c => c.id).join(', ')}`);
  const keysOk = JSON.stringify(tree.children.map(c => c.dataKey)) === JSON.stringify(PLAN.map(p => p.key));
  ok(keysOk, `子类 dataKey 与计划一致（${PLAN.map(p => p.key).join(', ')}）`);
  const filesOk = tree.children.every((c, i) => c.dataFile.endsWith(PLAN[i].file.split('/').pop()));
  ok(filesOk, `子类 dataFile 都指向各自的拆分文件`);

  // ② 页面上的子类入口（点得进）
  const links = await evaluate(`(()=>{const t=document.body.innerText.replace(/\\s+/g,' ');return ${JSON.stringify(diskNames)}.filter(n=>t.includes(n)).length;})()`);
  ok(links === diskNames.length, `父类页面上 ${diskNames.length} 个子类名字都渲染出来了（实际 ${links}）`);

  // ★ 父类自己挂的文章，在「文章」板块里必须真的看得见（本次新增的能力）。
  //   enterArticlesTab 内部有 await，所以切完 tab 要等一下再读文本。
  await evaluate(`(async()=>{ try { if (typeof enterArticlesTab === 'function') await enterArticlesTab(); } catch (e) { window.__artTabErr = String((e && e.message) || e); } })()`);
  await new Promise(r => setTimeout(r, 1500));
  const board = JSON.parse(await evaluate(`JSON.stringify({ text: document.body.innerText.replace(/\\s+/g,' '), err: window.__artTabErr || null })`));
  const diag = JSON.parse(await evaluate(`(()=>{
    const list = (typeof collectedArticles !== 'undefined') ? collectedArticles : [];
    const mine = list.filter(a => a.dataKey === 'taiwanReadmeData');
    const t = (typeof articleCategoryTree !== 'undefined' ? articleCategoryTree : []).find(c => c.id === 'taiwan');
    let filtered = null;
    try { filtered = (typeof getFilteredArticles === 'function') ? getFilteredArticles().length : null; } catch (e) { filtered = 'err:' + ((e && e.message) || e); }
    return JSON.stringify({ total: list.length, mineCount: mine.length, mineTitle: (mine[0] && mine[0].title) || null,
      cat: (typeof currentArticleCategory !== 'undefined') ? currentArticleCategory : null,
      treeEntry: t ? { name: t.name, dataKey: t.dataKey || null, childrenLen: (t.children || []).length } : null,
      filtered, boardHasTaiwan: document.body.innerText.includes('台币'), boardLen: document.body.innerText.length });
  })()`));
  // 只在失败时打印中间状态，平时不吵。
  if (!parentTitle || !board.text.includes(parentTitle)) console.log('    [诊断] ' + JSON.stringify(diag));
  // ★ 用运行时现取到的标题去判（不再写死「台钞图录」）
  ok(parentTitle !== '' && board.text.includes(parentTitle),
    `切到「文章」板块后，父类那篇「${parentTitle}」出现在列表里（运行时有 ${JSON.stringify(diag.mineCount)} 篇、标题 ${JSON.stringify(diag.mineTitle)}）${board.err ? '（切 tab 时报错：' + board.err + '）' : ''}`);
  if (parentTitle === '') skip('父类数据文件里一篇文章都没有，"父类文章出现在列表里"无从判起');


  // ★ 父级自己的文章要排在子级文章**前面**：列表默认顺序 = 收集顺序 = allDataKeys 顺序，
  //   所以父级 dataKey 必须排在它的子级之前。这里对整棵树做通用检查（不只看台币），
  //   以后任何父级挂文章都受这条守着。
  const order = JSON.parse(await evaluate(`(()=>{
    const keys = (typeof allDataKeys !== 'undefined') ? allDataKeys : [];
    const bad = [];
    for (const cat of (typeof categoryTree !== 'undefined' ? categoryTree : [])) {
      if (!cat.children || !cat.dataKey) continue;
      const pi = keys.indexOf(cat.dataKey);
      for (const sub of cat.children) {
        if (!sub.dataKey) continue;
        const si = keys.indexOf(sub.dataKey);
        if (pi < 0 || si < 0 || pi > si) bad.push(cat.id + '(' + pi + ') 晚于 ' + sub.id + '(' + si + ')');
      }
    }
    return JSON.stringify({ bad, taiwanFirst: keys.indexOf('taiwanReadmeData') < keys.indexOf('taiwanOldData') });
  })()`));
  ok(order.bad.length === 0, `有父级数据的分类，父级都排在子级之前（异常：${JSON.stringify(order.bad)}）`);
  ok(order.taiwanFirst === true, '台币父级 dataKey 排在子级之前 → 父级文章显示在该类最上面');

  // ★ 上一条只是"表里的顺序对"，这一条把机制也钉住：文章列表默认顺序就是收集顺序，
  //   收集顺序必须与 allDataKeys 顺序一致（有逆序对就说明中间被重排过，
  //   父级文章又会被挤到子级文章下面）。这同时是上一轮的教训 ——
  //   只断言"数据加载了"会给出假绿。
  const seq = JSON.parse(await evaluate(`(()=>{
    const keys = (typeof allDataKeys !== 'undefined') ? allDataKeys : [];
    const list = (typeof collectedArticles !== 'undefined' ? collectedArticles : []).filter(a => a.sourceType === 'notes');
    let inversions = 0, pairs = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = keys.indexOf(list[i].dataKey), b = keys.indexOf(list[j].dataKey);
        if (a < 0 || b < 0) continue;
        pairs++;
        if (a > b) inversions++;
      }
    }
    return JSON.stringify({ inversions, pairs, count: list.length });
  })()`));
  ok(seq.inversions === 0, `文章收集顺序与 allDataKeys 一致（${seq.count} 篇、逆序对 ${seq.inversions}/${seq.pairs}）`);
}

// ③ 逐个打开每个子类
//   ★ 期望值全部现算：系列个数/名字来自磁盘上的数据文件（p.disk），
//     再与**运行时**的 window.DATA_MAP 以及页面渲染出的系列头三处互证。
//   ★ detailFields 的项数不再是"必须 9"：先算出同批文件的**众数**，再要求每个文件与
//     众数一致（判据价值在"这一批拆出来的文件不能各写各的字段表"，而不在 9 这个数字）。
const fieldCounts = diskList.map(d => d.fields).filter(n => n > 0);
const fieldMode = (() => {
  if (!fieldCounts.length) return -1;
  const count = new Map();
  for (const n of fieldCounts) count.set(n, (count.get(n) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
})();
// 两个 id 都读不到磁盘文件时 PLAN 顺序可能对不上，这里按 id 建索引保证对得上
const diskById = new Map(PLAN.map(p => [p.id, p]));
for (const p of PLAN) {
  await boot(`notes/taiwan/${p.id}`);
  let loaded = false;
  for (let i = 0; i < 40; i++) { loaded = await evaluate(`typeof ${p.key} !== 'undefined'`).catch(() => false); if (loaded) break; await sleep(120); }
  ok(loaded, `${p.id}：${p.file.split('/').pop()} 已加载（${p.key} 存在）`);
  if (!loaded) continue;
  const dsk = diskById.get(p.id).disk || { series: -1, name: '（磁盘读不到）', fields: -1 };
  const info = JSON.parse(await evaluate(`(()=>{
    const d = ${p.key};
    return JSON.stringify({ name:d.name, series:d.series.length,
      flat:d.series.every(s=>!s.varieties && Array.isArray(s.copies)),
      firstSeries:d.series.length ? d.series[0].seriesName : '',
      fields:d.detailFields.length,
      labels:[...document.querySelectorAll('.series-name-label')].map(e=>e.textContent.trim()),
      img:(d.series.length && d.series[0].copies && d.series[0].copies[0]) ? (d.series[0].copies[0].img1||'') : '' });
  })()`));
  // 现算互证：运行时名字 === 磁盘名字
  ok(info.name === dsk.name, `${p.id}：运行时数据 name=「${info.name}」= 磁盘上的「${dsk.name}」`);
  // ★ 系列个数现算互证（原来写死 2/0/3/…）
  ok(info.series === dsk.series, `${p.id}：系列层 ${info.series} 个 = 磁盘文件里的 ${dsk.series} 个`);
  ok(info.flat === true, `${p.id}：每个系列都直接挂 copies，没有 varieties 中间层`);
  // ★ 页面渲染出的系列头数量 === 数据里的系列数（两块现算互证）
  ok(info.labels.length === info.series, `${p.id}：页面上系列头 ${info.labels.length} 个 = 数据里的 ${info.series} 个`);
  ok(dsk.series <= 0 || info.labels.length === dsk.series, `${p.id}：页面上系列头 ${info.labels.length} 个 = 磁盘文件里的 ${dsk.series} 个`);
  ok(!info.labels.includes(p.disk ? p.disk.name : ''), `${p.id}：页面系列头里没有以文件名命名的大类（${p.disk ? p.disk.name : ''}）`);
  if (fieldMode > 0) {
    ok(info.fields === fieldMode, `${p.id}：detailFields ${info.fields} 项 = 同批文件的众数 ${fieldMode} 项（各写各的会让详情面板错位）`);
  } else {
    skip(`${p.id}：读不到磁盘上的 detailFields，众数无从算起`);
  }
  if (info.series > 0) {
    // ★ 不再要求系列名里必须出现「年」「元」（那是数据书写习惯）：
    //   改成"首系列名非空、且这一串确实渲染到页面上"。
    ok(info.firstSeries.trim().length > 0, `${p.id}：首系列名非空：「${info.firstSeries}」`);
    // ★ 不再要求路径里含 '/taiwan/'（那是数据书写习惯）：改成"图片能取到非空 URL"
    ok(typeof info.img === 'string' && info.img.trim().length > 0, `${p.id}：首件藏品能取到非空图片 URL（${String(info.img).split('/').pop()}）`);
  } else {
    // ★ 原来断言"占位文件必须没有系列也没有图" —— 一旦站主往这个文件里填了藏品就假红。
    //   现在按现算判断：**只有它确实没有系列**时才断言页面显示空状态，否则跳过。
    ok(info.img === '', `${p.id}：series 为空时不带出任何图片（${String(info.img).slice(0, 60)}）`);
  }
  const t = await viewText();
  ok(t.includes(info.name), `${p.id}：页面标题仍是「${info.name}」`);
  if (info.series > 0) {
    ok(t.includes(info.firstSeries.trim().slice(0, 10)), `${p.id}：页面上渲染出首个系列头（「${info.firstSeries.trim().slice(0, 10)}」）`);
  } else {
    ok(/啥都木有/.test(t), `${p.id}：空占位系列显示空状态「啥都木有」（不崩、不空白）`);
    const art = await evaluate(`document.querySelectorAll('.empty-state .empty-art').length`);
    ok(art >= 1, `${p.id}：空状态里带了插图（${art} 个）`);
    const diskEmpty = p.disk ? p.disk.series === 0 : true;
    if (!diskEmpty) skip(`${p.id}：数据文件里已经有 ${p.disk.series} 个系列，"空占位显示空状态"这个场景在当前数据里不存在`);
  }
  ok(!/undefined|NaN|\[object/.test(t), `${p.id}：页面上没有 undefined/NaN/[object 之类的破绽`);
}

// ④ 老 hash（#notes/taiwan 直接当叶子）不应崩
await boot('notes/taiwan');
const oldHashOk = await evaluate(`(()=>{const t=document.body.innerText.replace(/\\s+/g,' ');return t.length>10 && !/undefined|NaN|\\[object/.test(t);})()`);
ok(oldHashOk, '旧 hash #notes/taiwan 不报错、不出现 undefined（现在落到子类列表）');

ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);

console.log(`\n──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
try { child.kill(); } catch {}
ws.close();
server.close();
process.exitCode = fail ? 1 : 0;
