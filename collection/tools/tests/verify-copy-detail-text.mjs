// ==================== verify-copy-detail-text.mjs ====================
// 硬币板块「藏品条目」（分类内容页里「详细信息」那一块）的信息排版：
//
//   ① 评级合成**一个**色块：评级公司在前、分数在后，中间恰好一个半角空格 → `ACG MS67`
//      （原来是 <span class="condition">MS67</span><span class="meta">ACG</span> 两个元素、顺序还是反的）
//   ② 色块之后接「1989年发行 · 2025年12月14日以74元的价格购入」—— 文字与分隔符保持原样，
//      只调整它与色块的相邻关系（色块与这一段之间恰好一个**半角**空格；用户明确这个不动）
//   ③ 第三行由"目录编号 / 材质：…"两行合并成一行：
//      `Sun-J14a　铜镍合金　30mm　9.32g` = 目录编号 + 材质 + 直径 + 重量
//      ★ 字段之间用**全角空格 U+3000**（用户要求「间隔可以宽一点，例如全角空格」）；
//        字段缺失就跳过，所以不会出现连续全角空格，也不会留首尾全角空格
//      ★ 直径与重量**原样照抄数据值**（数据里写 `外接圆直径30mm` 就渲染 `外接圆直径30mm`，
//        不做任何正则抽数 / 单位补全 / 汉字剥离），值的内部一字不动、只 trim 首尾空白，
//        字段在数据里不存在就整段不渲染（不留空串、undefined、null、0 或"未知"）
//   ④ 这一段渲染代码被纸币板块复用 —— 纸币的输出必须**一个字符都不变**（下面 ⑤ 节把
//      #notes/rmb/rmb3 前 12 条的 textContent 原样钉死；基线是本次改动前实测抓下来的）
//
// 自包含、零依赖：自己起静态服务器、自己拉起无头 Chrome（CDP）、自己断言。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

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

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ② 硬币：Sun-J14a（纯「数字+单位」的直径/重量） ══════\n');
const coinCount = await boot('coins/commemorative_coins/coincomm/s3', '.copy-item');
ok(coinCount > 0, `② 硬币分类内容页渲染出了藏品条目（.copy-item ${coinCount} 个）`);

const ITEM = JSON.parse(await evaluate(`(() => {
  const it = [...document.querySelectorAll('.copy-item')].find(x => /Sun-J14a/.test(x.textContent || ''));
  if (!it) return JSON.stringify({ err: '没找到 Sun-J14a 那一条' });
  const info = it.querySelector('.copy-info');
  const kids = [...info.children];
  const row2 = kids[1] || null;
  const chip = row2 ? row2.querySelector('.condition') : null;
  return JSON.stringify({
    err: '',
    kidCount: kids.length,
    kidCls: kids.map(k => k.className),
    title: kids[0] ? kids[0].textContent : '',
    titleLink: kids[0] ? !!kids[0].querySelector('.copy-detail-link') : false,
    titleOnclick: kids[0] && kids[0].querySelector('.copy-detail-link') ? kids[0].querySelector('.copy-detail-link').getAttribute('onclick') : '',
    row2: row2 ? row2.textContent : '',
    row2Kids: row2 ? [...row2.children].map(k => ({ cls: k.className, text: k.textContent })) : [],
    chipCls: chip ? chip.className : '',
    chipText: chip ? chip.textContent : '',
    companyAsOwnEl: row2 ? [...row2.children].some(k => k.textContent === 'ACG') : null,
    line3Cls: kids[2] ? kids[2].className : '',
    line3: kids[2] ? kids[2].textContent : '',
    whole: info.textContent
  });
})()`));
console.log(`  .copy-info 子节点 = ${JSON.stringify(ITEM.kidCls)}`);
console.log(`  第 1 行（小标题）= ${JSON.stringify(ITEM.title)}  （可点链接 ${ITEM.titleLink}，onclick=${JSON.stringify(ITEM.titleOnclick)}）`);
console.log(`  第 2 行 textContent = ${JSON.stringify(ITEM.row2)}`);
console.log(`  第 2 行子节点 = ${JSON.stringify(ITEM.row2Kids)}`);
console.log(`  色块 .condition textContent = ${JSON.stringify(ITEM.chipText)}（class=${ITEM.chipCls}）`);
console.log(`  第 3 行 [class=${ITEM.line3Cls}] = ${JSON.stringify(ITEM.line3)}`);
ok(ITEM.err === '', `② 找到 Sun-J14a 那一条（${ITEM.err || 'ok'}）`);
const L3 = String(ITEM.line3 == null ? '' : ITEM.line3);
const WHOLE = String(ITEM.whole == null ? '' : ITEM.whole);
ok(String(ITEM.title || '').trim() === '详细信息' && ITEM.titleLink === true && /openCopyDetail\(/.test(String(ITEM.titleOnclick || '')),
  `② 第 1 行「详细信息」小标题原样保留、仍可点开详情卡片（${JSON.stringify(ITEM.title)}）`);
ok(ITEM.chipCls === 'condition',
  `② 评级渲染成**一个**色块，用的还是既有的 .condition（class=${ITEM.chipCls}）`);
ok(ITEM.chipText === 'ACG MS67',
  `★ ② 色块里是「评级公司在前后接分数」，中间恰好一个半角空格：期望 "ACG MS67"，实际 ${JSON.stringify(ITEM.chipText)}`);
ok(ITEM.companyAsOwnEl === false,
  '★ ② 评级公司不再是紧挨着的另一个独立元素（原来 MS67 与 ACG 是两个块、顺序还是反的）');
ok(ITEM.row2 === 'ACG MS67 1989年发行 · 2025年12月14日以74元的价格购入',
  `★ ② 色块之后接原样的年份/购藏信息（年间文字与分隔符一字未动）：期望 "ACG MS67 1989年发行 · 2025年12月14日以74元的价格购入"，实际 ${JSON.stringify(ITEM.row2)}`);
ok(ITEM.line3 === 'Sun-J14a\u3000铜镍合金\u300030mm\u30009.32g',
  `★ ② 第三行 = 目录编号 + 材质 + 直径 + 重量（**全角空格 U+3000** 分隔、无「材质：」前缀）：期望 "Sun-J14a　铜镍合金　30mm　9.32g"，实际 ${JSON.stringify(ITEM.line3)}`);
// ★ 分辨力（用户要求"间隔宽一点、用全角空格"）：分隔符必须真的是 U+3000。
//   两条一起断言才严密 —— 只断言"命中全角形式"时，半角实现可能因别的空白巧合通过；
//   只断言"不含半角旧形式"时，改成两个半角空格也照样绿。
ok(/^Sun-J14a\u3000铜镍合金\u300030mm\u30009\.32g$/.test(L3),
  `★ ② 第三行确实匹配 /Sun-J14a\\u3000铜镍合金\\u300030mm\\u30009\\.32g/（匹配=${/^Sun-J14a\u3000铜镍合金\u300030mm\u30009\.32g$/.test(L3)}；逐个分隔符的码点=${JSON.stringify([...L3].map(ch => ch === '\u3000' ? 'U+3000' : (ch === ' ' ? 'U+0020' : '')).filter(Boolean))}）`);
ok(!L3.includes('Sun-J14a 铜镍合金 30mm 9.32g'),
  `★ ② 第三行**不是**半角空格分隔的旧形式（"Sun-J14a 铜镍合金 30mm 9.32g" 出现在其中=${L3.includes('Sun-J14a 铜镍合金 30mm 9.32g')}）`);
ok(!/\u3000{2}/.test(L3) && !/^\u3000|\u3000$/.test(L3) && !/ {2}/.test(L3),
  `★ ② 第三行没有连续全角空格、没有首尾全角空格、也没有连续半角空格（实际 ${JSON.stringify(L3)}）`);
ok(ITEM.line3Cls === 'meta',
  `② 第三行走的仍是既有的 .meta 文字体系（class=${ITEM.line3Cls}）`);
ok(ITEM.kidCount === 3,
  `★ ② 原来的「目录编号」「材质：…」两行确实合成了一行（.copy-info 子节点 ${ITEM.kidCount} 个：${JSON.stringify(ITEM.kidCls)}）`);
ok(!/材质[:：]/.test(WHOLE), '★ ② 整个条目里不再出现「材质：」前缀');
ok(L3 === L3.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '') && !/\s{2}/.test(L3) && !/(undefined|null|NaN)/.test(L3),
  '★ ② 第三行没有前导/尾随空白（半角与全角都算）、没有连续空白、没有 undefined/null/NaN 之类占位');

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ③ 硬币：直径含中文前缀（外接圆直径30mm）必须原样照抄 ══════\n');
const EM = JSON.parse(await evaluate(`(() => {
  const it = [...document.querySelectorAll('.copy-item')].find(x => /2023emei-1/.test(x.innerHTML || ''));
  if (!it) return JSON.stringify({ err: '没找到峨眉山那一条' });
  const info = it.querySelector('.copy-info');
  const kids = [...info.children];
  const metas = kids.filter(k => k.className === 'meta').map(k => k.textContent);
  return JSON.stringify({ err: '', line3: metas[0] || '', metas: metas, row2: kids[1] ? kids[1].textContent : '',
    whole: info.textContent });
})()`));
console.log(`  第 3 行 = ${JSON.stringify(EM.line3)}（该条 remark 另占一行，共 ${JSON.stringify((EM.metas || []).map(m => m.slice(0, 24) + (m.length > 24 ? '…' : '')))}）`);
ok(EM.err === '' && EM.line3 === '铜合金\u3000外接圆直径30mm\u300011.56g',
  `★ ③ 直径含中文前缀时**原样渲染**（不许抽数字、不许剥汉字），字段间仍用全角空格：期望 "铜合金　外接圆直径30mm　11.56g"，实际 ${JSON.stringify(EM.line3)}`);
ok(EM.line3 === EM.line3.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '') && !/\u3000{2}/.test(EM.line3) && !/ {2}/.test(EM.line3),
  '★ ③ 该条目录编号在数据里是 "Unlisted"（格式化后为空）→ 行首不补位、没有连续/首尾空白');
ok(EM.row2 === 'ACG MS69 2023年发行 · 2026年4月8日以22.5元的价格购入',
  `③ 换一条藏品，第 2 行的版式同样成立（实际 ${JSON.stringify(EM.row2)}）`);

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
console.log('\n══════ ⑤ 纸币板块（同一段渲染代码复用）输出必须一字不变 ══════\n');
// 基线：本次改动前在 #notes/rmb/rmb3 上实测抓下来的 .copy-info textContent（前 12 条）
const NOTE_BASELINE = [
  '详细信息1960年发行',
  '详细信息ACGE1962年发行',
  '详细信息ACGE1962年发行',
  '详细信息ACGE1962年发行',
  "ⅩⅩⅦ6238600详细信息ACG 66E1962年发行 · 2026年8月29日以40元的价格购入Pick# 877h",
  "ⅤⅡ08686382详细信息ACG 67E1962年发行 · 2026年2月4日以56元的价格购入Pick# 877g",
  "ⅨⅦ86510421详细信息ACG 67E1962年发行 · 2026年2月18日以46元的价格购入Pick# 877f",
  "ⅣⅦⅣ6018867详细信息ACG 67E1962年发行 · 2025年10月22日以28元的价格购入Pick# 877c",
  "ⅢⅧ86989663详细信息ACG 67E1962年发行 · 2026年2月4日以32元的价格购入Pick# 877d",
  '详细信息ACGE1962年发行',
  '详细信息ACGE1962年发行',
  "ⅢⅧ52000924详细信息ACG 67E1962年发行 · 2026年2月4日以31元的价格购入Pick# 878c"
];
const noteCount = await boot('notes/rmb/rmb3', '.copy-item');
const NOTE_NOW = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.copy-item')].slice(0, 12).map(it => it.querySelector('.copy-info').textContent))`));
ok(noteCount > 0 && NOTE_NOW.length === 12, `⑤ 纸币分类内容页渲染出来（.copy-item ${noteCount} 个，取了 ${NOTE_NOW.length} 条）`);
let same = 0;
for (let i = 0; i < NOTE_BASELINE.length; i++) if (NOTE_NOW[i] === NOTE_BASELINE[i]) same++;
ok(same === NOTE_BASELINE.length,
  `★ ⑤ 纸币条目文本与改版前逐条一致（${same}/${NOTE_BASELINE.length} 条相同）—— 硬币的版式没有误伤纸币`);
if (same !== NOTE_BASELINE.length) {
  for (let i = 0; i < NOTE_BASELINE.length; i++) if (NOTE_NOW[i] !== NOTE_BASELINE[i]) console.log(`      #${i} 期望 ${JSON.stringify(NOTE_BASELINE[i])}\n         实际 ${JSON.stringify(NOTE_NOW[i])}`);
}
ok(!NOTE_NOW.some(t => /材质[:：]/.test(t)), '★ ⑤ 纸币条目里没有凭空冒出「材质：」这类硬币字段文案');

// ══════════════════════════════════════════════════════════════
console.log('\n══════ ⑥ 真实数据里字段确实缺失的那一条（流通币 catalogNumber 为空） ══════\n');
// coincollection/data/circulating_2.js 第一条：catalogNumber 是空串（真实数据，不是我造的）
const realCount = await boot('coins/circulating_coins/circulating_2/s0', '.copy-item');
const REAL = JSON.parse(await evaluate(`(() => {
  const it = [...document.querySelectorAll('.copy-item')].find(x => /2018-001-1/.test(x.innerHTML || ''));
  if (!it) return JSON.stringify({ err: '没找到 2018-001-1 那一条' });
  const info = it.querySelector('.copy-info');
  const kids = [...info.children];
  const metas = kids.filter(k => k.className === 'meta').map(k => k.textContent);
  return JSON.stringify({ err: '', kidCount: kids.length, row2: kids[1] ? kids[1].textContent : '',
    line3: metas[0] == null ? null : metas[0], remarkIsOwnLine: metas.length > 1, whole: info.textContent });
})()`));
console.log(`  .copy-info 子节点 ${REAL.kidCount} 个；第 3 行 = ${JSON.stringify(REAL.line3)}`);
ok(realCount > 0 && REAL.err === '', `⑥ 流通币分类内容页渲染出来了（.copy-item ${realCount} 个，${REAL.err || 'ok'}）`);
ok(REAL.row2 === 'ACG MS68 2018年发行 · 2026年6月19日以18元的价格购入',
  `★ ⑥ 真实数据第 2 行：期望 "ACG MS68 2018年发行 · 2026年6月19日以18元的价格购入"，实际 ${JSON.stringify(REAL.row2)}`);
ok(REAL.line3 === '铝镁合金\u300018mm\u30000.67g',
  `★ ⑥ 该条 catalogNumber 是空串 → 第三行从材质开始、字段间仍是全角空格，行首/行尾都不留空位：期望 "铝镁合金　18mm　0.67g"，实际 ${JSON.stringify(REAL.line3)}`);
ok(String(REAL.line3 || '') === String(REAL.line3 || '').replace(/^[\s\u3000]+|[\s\u3000]+$/g, '') && !/\u3000{2}/.test(String(REAL.line3 || '')) && !/(undefined|null|NaN)/.test(String(REAL.whole || '')),
  '★ ⑥ 真实缺失字段时既没有前导/尾随空白（含全角），也没有连续全角空格或 undefined/null/NaN 之类占位');

// ══════════════════════════════════════════════════════════════
try { await send('Fetch.disable'); } catch { }
console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));

try { ws.close(); } catch { }
try { child.kill(); } catch { }
try { server.close(); } catch { }
process.exit(fail === 0 ? 0 : 1);
