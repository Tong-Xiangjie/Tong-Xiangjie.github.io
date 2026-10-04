// 台币拆分验证：taiwan.js 按 7 个系列拆成 7 个文件后，父类/子类在真浏览器里是否都正常。
// 已进仓库：collection/tools/tests（A4）。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';

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
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

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

// series 数 = 原文件里各系列的品种数（去掉大类后，品种层直接变成系列层）
// series: 0 = 尚未录入藏品的占位系列（数据文件里 series: []），只校验页面不崩、显示空状态
const PLAN = [
  { id: 'taiwanOld', key: 'taiwanOldData', file: 'taiwan_old.js', name: '战后旧台币', series: 2 },
  { id: 'taiwan38V', key: 'taiwan38VData', file: 'taiwan_38v.js', name: '三十八年直式新台币', series: 0 },
  { id: 'taiwan43V', key: 'taiwan43VData', file: 'taiwan_43v.js', name: '四十三年直式新台币', series: 0 },
  { id: 'taiwan1', key: 'taiwan1Data', file: 'taiwan_1.js', name: '第一套横式新台币', series: 3 },
  { id: 'taiwan2', key: 'taiwan2Data', file: 'taiwan_2.js', name: '第二套横式新台币', series: 2 },
  { id: 'taiwan3', key: 'taiwan3Data', file: 'taiwan_3.js', name: '第三套横式新台币', series: 3 },
  { id: 'taiwan4', key: 'taiwan4Data', file: 'taiwan_4.js', name: '第四套横式新台币', series: 0 },
  { id: 'taiwan5', key: 'taiwan5Data', file: 'taiwan_5.js', name: '第五套横式新台币', series: 7 },
  { id: 'taiwanKm', key: 'taiwanKmData', file: 'taiwan_km.js', name: '金门地区专用钞券', series: 1 },
  { id: 'taiwanMz', key: 'taiwanMzData', file: 'taiwan_mz.js', name: '马祖地区专用钞券', series: 1 },
  { id: 'taiwanDc', key: 'taiwanDcData', file: 'taiwan_dc.js', name: '大陈地区专用钞券', series: 0 }
];

console.log('══════ 台币拆分：父类 + 7 个子类 ══════\n');

// ① 父类节点
await boot('notes/taiwan');
const tree = JSON.parse(await evaluate(`(()=>{
  // 注意：categoryTree 是经典脚本顶层 const，只有全局词法绑定，不在 window 上
  const list = (typeof categoryTree !== 'undefined') ? categoryTree : [];
  const n = list.find(c=>c.id==='taiwan');
  if (!n) return JSON.stringify({ none: true });
  return JSON.stringify({ none:false, name:n.name, hasOwnData: !!n.dataKey, hasOwnFile: !!n.dataFile,
    children: (n.children||[]).map(c=>({ id:c.id, name:c.name, dataKey:c.dataKey, dataFile:c.dataFile })) });
})()`));
ok(tree.none === false, '前置：categoryTree 里找得到 taiwan 节点');
if (tree.none) { console.log('\n  父节点都没了，后面的检查没意义。'); process.exitCode = 1; }
else {
  ok(tree.name === '台币', `父类名字仍是「${tree.name}」`);
  ok(tree.hasOwnData === false && tree.hasOwnFile === false, '父类自己不再挂 dataKey/dataFile（和 rmb/hk/民国 一致）');
  ok(tree.children.length === PLAN.length, `父类下正好 ${PLAN.length} 个子类（实际 ${tree.children.length}）`);
  const namesOk = JSON.stringify(tree.children.map(c => c.name)) === JSON.stringify(PLAN.map(p => p.name));
  ok(namesOk, `子类名称与顺序一致：${tree.children.map(c => c.name).join(' → ')}`);
  const idsOk = JSON.stringify(tree.children.map(c => c.id)) === JSON.stringify(PLAN.map(p => p.id));
  ok(idsOk, `子类 id 与计划一致：${tree.children.map(c => c.id).join(', ')}`);
  const keysOk = JSON.stringify(tree.children.map(c => c.dataKey)) === JSON.stringify(PLAN.map(p => p.key));
  ok(keysOk, `子类 dataKey 与计划一致`);
  const filesOk = tree.children.every((c, i) => c.dataFile.endsWith(PLAN[i].file));
  ok(filesOk, `子类 dataFile 都指向各自的拆分文件`);

  // ② 页面上的子类入口（点得进）
  const links = await evaluate(`(()=>{const t=document.body.innerText.replace(/\\s+/g,' ');return ${JSON.stringify(PLAN.map(p => p.name))}.filter(n=>t.includes(n)).length;})()`);
  ok(links === PLAN.length, `父类页面上 ${PLAN.length} 个子类名字都渲染出来了（实际 ${links}）`);
}

// ③ 逐个打开每个子类
for (const p of PLAN) {
  await boot(`notes/taiwan/${p.id}`);
  let loaded = false;
  for (let i = 0; i < 40; i++) { loaded = await evaluate(`typeof ${p.key} !== 'undefined'`).catch(() => false); if (loaded) break; await sleep(120); }
  ok(loaded, `${p.id}：${p.file} 已加载（${p.key} 存在）`);
  if (!loaded) continue;
  const info = JSON.parse(await evaluate(`(()=>{
    const d = ${p.key};
    return JSON.stringify({ name:d.name, series:d.series.length,
      flat:d.series.every(s=>!s.varieties && Array.isArray(s.copies)),
      firstSeries:d.series.length ? d.series[0].seriesName : '',
      fields:d.detailFields.length,
      labels:[...document.querySelectorAll('.series-name-label')].map(e=>e.textContent.trim()),
      img:(d.series.length && d.series[0].copies && d.series[0].copies[0]) ? (d.series[0].copies[0].img1||'') : '' });
  })()`));
  ok(info.name === p.name, `${p.id}：数据 name=「${info.name}」`);
  ok(info.series === p.series, `${p.id}：系列层 ${info.series} 个（= 原品种数 ${p.series}，不再套「大类」）`);
  ok(info.flat === true, `${p.id}：每个系列都直接挂 copies，没有 varieties 中间层`);
  ok(info.labels.length === p.series, `${p.id}：页面上系列头 ${info.labels.length} 个（期望 ${p.series}）`);
  ok(!info.labels.includes(p.name), `${p.id}：页面系列头里没有以文件名命名的大类（${p.name}）`);
  ok(info.fields === 9, `${p.id}：detailFields 仍是 9 项（与台币原文件一致）`);
  if (p.series > 0) {
    ok(/年/.test(info.firstSeries) && /元/.test(info.firstSeries), `${p.id}：系列头就是年份+面值：「${info.firstSeries}」`);
    ok(info.img.includes('/taiwan/'), `${p.id}：图片路径仍指向 image/taiwan/（${info.img.split('/').pop()}）`);
  } else {
    ok(info.firstSeries === '' && info.img === '', `${p.id}：确实是空占位文件（series: []，没有系列也没有图）`);
  }
  const t = await viewText();
  ok(t.includes(p.name), `${p.id}：页面标题仍是「${p.name}」`);
  if (p.series > 0) {
    ok(t.includes(info.firstSeries.slice(0, 10)), `${p.id}：页面上渲染出首个系列头`);
  } else {
    ok(/啥都木有/.test(t), `${p.id}：空占位系列显示空状态「啥都木有」（不崩、不空白）`);
    const art = await evaluate(`document.querySelectorAll('.empty-state .empty-art').length`);
    ok(art >= 1, `${p.id}：空状态里带了插图（${art} 个）`);
  }
  ok(!/undefined|NaN|\[object/.test(t), `${p.id}：页面上没有 undefined/NaN/[object 之类的破绽`);
}

// ④ 老 hash（#notes/taiwan 直接当叶子）不应崩
await boot('notes/taiwan');
const oldHashOk = await evaluate(`(()=>{const t=document.body.innerText.replace(/\\s+/g,' ');return t.length>10 && !/undefined|NaN|\\[object/.test(t);})()`);
ok(oldHashOk, '旧 hash #notes/taiwan 不报错、不出现 undefined（现在落到子类列表）');

ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);

console.log(`\n──────── 通过 ${pass} / 失败 ${fail} ────────`);
try { child.kill(); } catch {}
ws.close();
server.close();
process.exitCode = fail ? 1 : 0;
