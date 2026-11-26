// 评级费清单「站内小窗预览」验收：collection/tools/tests/verify-grading-sheet-window.mjs
// 用户要求（原话）："『下载清单』比较麻烦，每次想查看都要下载，你看看能不能自己写一个小窗展示清单，
//   下载接口写在小窗里面。"
//
// 判据（本用例只读 DOM，期望值一律从 xlsx 现算，不手抄）：
//   ① 时间轴的费用条目上有「查看清单」入口（不再是"点一下就下载"的链接）；
//   ② 点它弹出小窗，小窗里的表格 = 该批 xlsx 的**真实内容**（用 Node 侧零依赖解析 xlsx 对账：
//      15 个证书号一个不少、合计 630 / 567 在表里）；
//   ③ 下载链接**在小窗里面**，href / target / rel 与原来一致（不见得要你先下载才能看）；
//   ④ 点入口**不会跑掉**（不导航、不下载），Esc / 关闭按钮能关掉。
//
// 红证：未实现时 ① 就红（页面上只有 <a>下载清单</a>，没有预览入口、没有小窗）。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ─────────── Node 侧零依赖 xlsx 解析（只为拿到"期望值"，与被测实现完全独立）───────────
function zipEntry(buf, want) {
    let eocd = buf.length - 22;
    while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('no EOCD');
    const count = buf.readUInt16LE(eocd + 10);
    let pos = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
        const method = buf.readUInt16LE(pos + 10);
        const csize = buf.readUInt32LE(pos + 20);
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const cmtLen = buf.readUInt16LE(pos + 32);
        const localOff = buf.readUInt32LE(pos + 42);
        const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
        if (name === want) {
            const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
            const raw = buf.subarray(start, start + csize);
            return method === 8 ? inflateRawSync(raw) : raw;
        }
        pos += 46 + nameLen + extraLen + cmtLen;
    }
    throw new Error('entry not found: ' + want);
}
const xmlUnesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function sheetGrid(buf) {
    const shared = [];
    const ssXml = (() => { try { return zipEntry(buf, 'xl/sharedStrings.xml').toString('utf8'); } catch { return ''; } })();
    for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        shared.push(xmlUnesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
    }
    const sheetName = (() => {
        for (let i = 1; i <= 6; i++) { try { zipEntry(buf, `xl/worksheets/sheet${i}.xml`); return `xl/worksheets/sheet${i}.xml`; } catch { } }
        throw new Error('no sheet xml');
    })();
    const xml = zipEntry(buf, sheetName).toString('utf8');
    const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
    const rows = [];
    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
        const row = [];
        for (const cm of rm[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*)\/>|<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
            const ref = cm[1] || cm[3];
            const attrs = cm[2] || cm[4] || '';
            const inner = cm[5] || '';
            const t = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
            let val = '';
            if (t === 'inlineStr') val = xmlUnesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
            else {
                const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
                if (v !== undefined) val = (t === 's') ? (shared[+v] || '') : xmlUnesc(v);
            }
            if (String(val).trim() !== '') row[colIdx(ref)] = String(val).trim();
        }
        rows.push(row);
    }
    return rows;
}

// ─────────── 静态 HTTP（仓库根为根：数据路径是 ../notecollection/…）───────────
const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full) || statSync(full).isDirectory()) { res.writeHead(404).end('nf'); return; }
    const b = readFileSync(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
    res.end(b);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

// 目标批次：取台账里付款日最新的那一批（就是用户刚加的第 6 批）
const dataSrc = readFileSync('notecollection/data/grading_fee.js', 'utf8');
const batches = JSON.parse('[' + [...dataSrc.matchAll(/\{\s*pj:\s*"([^"]+)"[\s\S]*?listUrl:\s*"([^"]+)"/g)]
    .map(m => `{"pj":"${m[1]}","listUrl":"${m[2]}"}`).join(',') + ']');
const target = batches[batches.length - 1];
const xlsxPath = 'notecollection/readmes/image/' + target.listUrl.split('/image/')[1];
const grid = sheetGrid(readFileSync(xlsxPath));
const certs = [...new Set(grid.flat().filter(v => /^27\d{6}$/.test(v)))].sort();
const flat = grid.flat().filter(Boolean);
console.log(`\n目标批次 ${target.pj}；xlsx 解析出 ${grid.length} 行 / ${certs.length} 个证书号 / 合计 ${flat.filter(v => v === '630' || v === '567').join('+')}\n`);

// ─────────── CDP ───────────
const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpSheetWin-'));
const DP = 17620;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0; const pend = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('no cdp'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const J = async e => JSON.parse(await ev(`(async()=>JSON.stringify(await(async()=>{ ${e} })()))()`));
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#notes` });
for (let i = 0; i < 200; i++) { if (await ev(`typeof DATA_MAP!=='undefined' && !!DATA_MAP['gradingFeeData']`).catch(() => false)) break; await sleep(150); }
await sleep(1500);
// 进入「币海拾年」时间轴（与 verify-grading-fee 同一入口；专题 id = timeline）
await ev(`(()=>{ const t=(typeof specialCategoryTree!=='undefined'&&specialCategoryTree)||[];
  const hit=t.find(c=>/拾年|时间轴/.test(c.name||''))||t.find(c=>c.id==='timeline');
  if(hit&&typeof onSpecialOverviewItemClick==='function') onSpecialOverviewItemClick(hit.id); return !!hit; })()`);
for (let i = 0; i < 50; i++) { if (await ev(`!!document.querySelector('.timeline-header') && !!document.getElementById('timelineYearFilter')`).catch(() => false)) break; await sleep(300); }
await ev(`(()=>{ const ys=document.getElementById('timelineYearFilter'), ms=document.getElementById('timelineMonthFilter');
  if(ys) ys.value='全部'; if(ms) ms.value='全部'; if(typeof setTimelineOrder==='function') setTimelineOrder('asc'); return true; })()`);
await sleep(1500);

const rows = await J(`return [].map.call(document.querySelectorAll('.timeline-item[data-type="fee"]'), function (el) {
  return { text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
    hasView: !!el.querySelector('.timeline-fee-view'),
    hasLink: !!el.querySelector('.timeline-fee-link'),
    viewTag: (el.querySelector('.timeline-fee-view') || {}).tagName || '',
    listUrl: (el.querySelector('.timeline-fee-link') || {}).getAttribute ? el.querySelector('.timeline-fee-link').getAttribute('href') : '' }; });`);
console.log('时间轴费用条目 ' + rows.length + ' 条；带预览入口的 ' + rows.filter(r => r.hasView).length + ' 条\n');

// ① 有预览入口（红在这条：今天只有 <a>下载清单</a>）
ok(rows.length > 0, `① 时间轴里有 ${rows.length} 条评级费条目`);
ok(rows.every(r => r.hasView),
    `① 每条都有「查看清单」预览入口（实际 ${rows.filter(r => r.hasView).length}/${rows.length}；今天只有下载链接）`);

// ② 点它 → 小窗出现，且不导航
//   ★ 必须点**目标批次**那一条：按钮上带着 data-sheet-pj（渲染时写入的单号），
//     否则点到时间轴第一条（最老那批）去比最新那批的清单，必然对不上 —— 第一版就是这么错的。
const opened = await J(`var el = document.querySelector('.timeline-fee-view[data-sheet-pj="${target.pj}"]');
  if (!el) return { clicked:false };
  var before = location.hash; el.click();
  await new Promise(r => setTimeout(r, 2500));
  var m = document.querySelector('.sheet-modal');
  var vis = m ? getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().height > 40 : false;
  var tbl = m ? m.querySelector('table') : null;
  // ★ 值取自**整张小窗**（合计现在在下面那张小表里，只取第一张表会漏）
  var cells = m ? [].map.call(m.querySelectorAll('td,th'), c => (c.innerText||'').replace(/\\s+/g,' ').trim()).filter(Boolean) : [];
  // ★ 还要拿到**二维**表格：只查"值在不在"抓不住错位（用户 2026-11 就是这么发现我抄错列的）。
  var grid2d = tbl ? [].map.call(tbl.querySelectorAll('tr'), tr =>
      [].map.call(tr.querySelectorAll('th,td'), c => (c.innerText||'').replace(/\\s+/g,' ').trim())) : [];
  var a = m ? m.querySelector('a[href$=".xlsx"]') : null;
  var tEl = m ? m.querySelector('.sheet-title') : null, sEl = m ? m.querySelector('.sheet-sub') : null;
  return { clicked:true, hashBefore: before, hashAfter: location.hash, visible: vis,
    rowCount: tbl ? tbl.querySelectorAll('tr').length : 0, cells: cells, grid2d: grid2d,
    cols: grid2d.length ? Math.max.apply(null, grid2d.map(r => r.length)) : 0,
    certRows: cells.filter(v => /^27\\d{6}$/.test(v)).length,
    linkHref: a ? a.getAttribute('href') : '', linkText: a ? a.innerText.trim() : '',
    linkTarget: a ? a.getAttribute('target') : '', linkRel: a ? a.getAttribute('rel') : '',
    titleText: tEl ? tEl.textContent.trim() : '', subText: sEl ? sEl.textContent.trim() : '' };`);
ok(opened.clicked && opened.visible, `② 点「查看清单」弹出小窗（点了 ${opened.clicked} / 可见 ${opened.visible}）`);
ok(opened.clicked && opened.hashBefore === opened.hashAfter, `② 点开不会跑掉（hash ${opened.hashBefore} → ${opened.hashAfter}）`);
ok(opened.certRows === certs.length,
    `② 小窗里的明细行数 = xlsx 里真实证书号个数（${opened.certRows} vs ${certs.length}）—— 抄录不漏行`);

// ③ 表格内容 = xlsx 真实内容（证书号一个不少 + 合计在）
const gotCerts = [...new Set((opened.cells || []).filter(v => /^27\d{6}$/.test(v)))].sort();
const missing = certs.filter(c => !gotCerts.includes(c));
ok(gotCerts.length === certs.length && missing.length === 0,
    `③ 小窗里 ${certs.length} 个证书号一个不少（缺：${missing.join(',') || '无'}）`);
const sumText = (opened.cells || []).join('|');
ok(/630/.test(sumText) && /567/.test(sumText),
    `③ xlsx 的合计（原价 630 / 实收 567）出现在小窗里`);
for (const head of ['序号', '编码', '实际费用']) {
    ok(sumText.includes(head), `③ 表头「${head}」在（xlsx 首行之一）`);
}

// ③b ★★ 逐格按下标比对（抓错位）：期望 = 原 xlsx 从列名行开始、剔掉隐私行/隐私格、裁掉行尾空列
{
    const PRIV = /客户\s*[：:]|微信|订单号|电话|1\d{10}/;
    const hIdx = grid.findIndex(r => (r || []).some(v => String(v).includes('编码')));
    // ★ 合计行按用户要求回到明细表最后一行 ⇒ 期望值截到**含合计**为止；
    //   合计之后的汇总行不在表里（它们是不带表格的文字），由 ③c 单独验。
    const allRows = grid.slice(hIdx)
        .map(r => Array.from(r || [], v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()).map(v => (PRIV.test(v) ? '' : v)))
        .filter(r => r.some(Boolean) && !r.some(v => PRIV.test(v)));
    const totalAt = allRows.findIndex(r => String(r[0] || '').trim() === '合计');
    const want = (totalAt >= 0 ? allRows.slice(0, totalAt + 1) : allRows)
        .map(r => { const c = r.slice(); while (c.length && c[c.length - 1] === '') c.pop(); return c; });
    const got = (opened.grid2d || []).map(r => { const c = r.slice(); while (c.length && c[c.length - 1] === '') c.pop(); return c; });
    const bad = [];
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
        const a = want[i] || [], b = got[i] || [];
        for (let j = 0; j < Math.max(a.length, b.length); j++) {
            if ((a[j] || '') !== (b[j] || '')) { bad.push(`第${i + 1}行第${j + 1}列: 期望「${a[j] || ''}」实得「${b[j] || ''}」`); if (bad.length >= 5) break; }
        }
        if (bad.length >= 5) break;
    }
    ok(want.length > 5 && bad.length === 0,
        `③b 逐格逐列都和原 xlsx 对齐（比了 ${want.length} 行；错位/错值 ${bad.length} 处${bad.length ? '：' + bad.join(' | ') : ''}）`);
}

// ③c 合计回到明细表最后一行；其余汇总行仍是不带表格的文字；表头几何 + 已售出样式 + 动画
const sumProbe = await J(`var m = document.querySelector('.sheet-modal');
  if (!m || m.hidden) return { open:false };
  var tbl = m.querySelector('table');
  var trs = tbl ? tbl.querySelectorAll('tbody tr') : [];
  var lastTr = trs.length ? trs[trs.length - 1] : null;
  var sumBox = m.querySelector('.sheet-sum');
  var th = tbl ? tbl.querySelector('thead th') : null;
  var head = m.querySelector('.sheet-head');
  var thCs = th ? getComputedStyle(th) : null;
  var thRect = th ? th.getBoundingClientRect() : null;
  var subEl = m.querySelector('.sheet-sub');
  var subRect = subEl ? subEl.getBoundingClientRect() : null;
  var headRect = head ? head.getBoundingClientRect() : null;
  var soldRows = m.querySelectorAll('tr.sheet-sold');
  var soldCs = soldRows.length ? getComputedStyle(soldRows[0].querySelector('td')) : null;
  return { open:true, tables: m.querySelectorAll('table').length,
    lastRowIsTotal: !!(lastTr && /^合计/.test(lastTr.textContent.trim())),
    tailLines: m.querySelectorAll('.sheet-sum-line').length, tailTitle: m.querySelectorAll('.sheet-sum-title').length,
    sumText: sumBox ? sumBox.textContent.replace(/\\s+/g,' ').trim() : '',
    gap: (thRect && subRect) ? Math.round(thRect.top - subRect.bottom) : ((thRect && headRect) ? Math.round(thRect.top - headRect.bottom) : null),
    borderTop: thCs ? thCs.borderTopWidth : null, borderBottom: thCs ? thCs.borderBottomWidth : null,
    thLeft: thCs ? thCs.borderLeftWidth : null, thBg: thCs ? thCs.backgroundColor : '', thBgImg: thCs ? thCs.backgroundImage : '',
    tblBorder: tbl ? getComputedStyle(tbl).borderTopWidth : null,
    bodyPadTop: (function () { var b = m.querySelector('.sheet-body'); return b ? getComputedStyle(b).paddingTop : ''; })(),
    thTop: thCs ? thCs.top : '', thPadTop: thCs ? thCs.paddingTop : '',
    td2Right: (function () { var td = tbl ? tbl.querySelector('tbody td:nth-child(2)') : null; return td ? getComputedStyle(td).borderRightWidth : null; })(),
    td2Left: (function () { var td = tbl ? tbl.querySelector('tbody td:nth-child(2)') : null; return td ? getComputedStyle(td).borderLeftWidth : null; })(),
    soldTitle: soldRows.length ? (soldRows[0].getAttribute('title') || '') : '',
    collapse: tbl ? getComputedStyle(tbl).borderCollapse : null,
    anim: getComputedStyle(m).animationName,
    soldCount: soldRows.length, soldDeco: soldCs ? soldCs.textDecorationLine : '', soldColor: soldCs ? soldCs.color : '',
    dataRows: trs.length };`);
ok(sumProbe.open && sumProbe.tables === 1 && sumProbe.lastRowIsTotal,
    `③c「合计」回到明细表最后一行（表数 ${sumProbe.tables}、末行是合计=${sumProbe.lastRowIsTotal}）`);
ok(sumProbe.tailLines >= 2 && sumProbe.tailTitle >= 1 && /评级费原价/.test(sumProbe.sumText),
    `③c 其余汇总行仍是不带表格的文字（文字行 ${sumProbe.tailLines}、小标题 ${sumProbe.tailTitle}）`);
ok(sumProbe.gap !== null && sumProbe.gap >= 4,
    `⑧ 列名表头与窗口抬头之间有余量（${sumProbe.gap}px）`);
// ★ 线不能重（用户 2026-11 看到"两条竖向的平行细线"）：格子只画右边/下边，外框画在 table 上，
//   所以"格子的左边框 = 0"、外框 > 0 —— 任何一条线都只有 1px。
// ★ 框线：画在**单元格自己身上**（画在 table 上的外框会随表格滚走 ⇒ sticky 表头看起来缺边、
//   与表格竖线对不齐，用户 2026-11 报的正是这个）。同时"格与格之间只有一条线"（不重叠）。
ok(parseFloat(sumProbe.borderTop) > 0 && parseFloat(sumProbe.borderBottom) > 0 && parseFloat(sumProbe.td2Right) > 0 && parseFloat(sumProbe.td2Left) === 0,
    `⑧ 框线画在格子上且不重叠：表头上下 ${sumProbe.borderTop}/${sumProbe.borderBottom}、第 2 格左 ${sumProbe.td2Left} 右 ${sumProbe.td2Right}`);
// ★★ "表头上面露字"的正确解法：**保留** 10px 上内边距（用户 2026-11 明确"不应该直接删掉"），
//   让 sticky 表头**只在滚动时**向上长出来盖住那条缝 —— 静止时不改变表头高度（否则缝隙会翻倍，
//   用户追问的"这不是会让表格变形？"指的就是这个）。判据：静止 padding-top=4px；滚动后 =14px。
ok(sumProbe.bodyPadTop === '10px',
    `⑧ 滚动容器上内边距保留 10px（实际 ${sumProbe.bodyPadTop}）`);
ok(sumProbe.thTop === '-10px' && parseFloat(sumProbe.thPadTop) === 4,
    `⑧ 静止时表头不变形（computed top=${sumProbe.thTop}、padding-top=${sumProbe.thPadTop}px）`);
const scrolledProbe = await J(`var m = document.querySelector('.sheet-modal');
  var b = m && m.querySelector('.sheet-body');
  if (!b) return { ok:false };
  b.scrollTop = 160;
  await new Promise(r => setTimeout(r, 400));
  var th = m.querySelector('.sheet-table thead th');
  var cs = th ? getComputedStyle(th) : null;
  var tr = th ? th.getBoundingClientRect() : null, br = b.getBoundingClientRect();
  return { ok:true, cls: b.classList.contains('sheet-scrolled'), padTop: cs ? cs.paddingTop : '',
    thTop: tr ? Math.round(tr.top) : null, bodyTop: Math.round(br.top),
    covers: !!(tr && tr.top <= br.top) };`);
ok(scrolledProbe.ok && scrolledProbe.cls && parseFloat(scrolledProbe.padTop) >= 10 && scrolledProbe.covers,
    `⑧ 滚动后表头加厚并盖住那条缝（.sheet-scrolled=${scrolledProbe.cls}、padding-top=${scrolledProbe.padTop}、表头顶 ${scrolledProbe.thTop} ≤ 容器顶 ${scrolledProbe.bodyTop}）`);
ok(sumProbe.soldTitle === '该藏品已售出，未入库',
    `⑨b 已售出行提示语 = "该藏品已售出，未入库"（实际 ${JSON.stringify(sumProbe.soldTitle)}）`);
ok(sumProbe.soldCount >= 1 && sumProbe.soldCount < sumProbe.dataRows && sumProbe.soldDeco === 'line-through',
    `⑨ 已售出/退回的行灰化 + 删除线，且**不是全标**（${sumProbe.soldCount}/${sumProbe.dataRows} 行，text-decoration=${sumProbe.soldDeco}，色 ${sumProbe.soldColor}）`);
// ★ 表头必须**真正不透明**：玻璃主题下 --bg-light 是半透明的，只靠它铺底会透出下面滚过的行
//   （用户 2026-11 报"表头上面还是漏字"）。判据：computed backgroundColor 的 alpha = 1，
//   并且还有一层主题色叠层（保证观感跟主题走）。
const thAlpha = (() => {
    const m = String(sumProbe.thBg || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map(s => parseFloat(s));
    return parts.length === 4 ? parts[3] : 1;
})();
ok(thAlpha === 1 && /linear-gradient/.test(sumProbe.thBgImg || ''),
    `⑧ 表头背景**不透明**（backgroundColor=${sumProbe.thBg}，alpha=${thAlpha}；叠层=${/linear-gradient/.test(sumProbe.thBgImg || '')}）`);
ok(sumProbe.anim && sumProbe.anim !== 'none', `⑩ 小窗出现时有动画（animation-name=${sumProbe.anim}）`);

ok(!/此张已售出/.test((opened.cells || []).join('|')),
    `③d 手写备注列（"此张已售出"）不再进小窗（表里 ${(opened.cells || []).filter(v => /已售出/.test(v)).length} 处）`);
ok(opened.cols === 12,
    `③d 表宽 = 12 列（备注列整列为空后已被裁掉；实际 ${opened.cols}）`);

// ④b 抬头格式（用户 2026-11 指定的样式）
ok(opened.titleText === '评级费清单（' + target.pj + '）',
    `④b 抬头 = 「评级费清单（PJ…）」（实际 ${JSON.stringify(opened.titleText)}）`);
ok(/^送评日期：.+ \| 合计：[\d.]+元$/.test(opened.subText || ''),
    `④b 副标题 = 「送评日期：… | 合计：…元」（实际 ${JSON.stringify(opened.subText)}）`);

// ④ 下载链接在小窗里面，且与原口径一致
ok(!!opened.linkHref && opened.linkHref.indexOf('grading_fee/' + target.pj + '.xlsx') >= 0,
    `④ 小窗里有下载链接且指向本批 xlsx（实际 ${opened.linkHref}）`);
ok(opened.linkTarget === '_blank' && opened.linkRel === 'noopener',
    `④ 下载链接 target=_blank / rel=noopener（实际 ${opened.linkTarget} / ${opened.linkRel}）`);
ok(!rows.some(r => r.text.indexOf('下载清单') >= 0),
    '④ 时间轴条目上不再挂"下载清单"链接（入口改成「查看清单」）');

// ⑤ 能关掉（★ 必须先确认小窗真的开过：否则 display='gone' 会**空过**）
ok(opened.clicked && opened.visible, `⑤ 前提：小窗确实开着（${opened.visible}）`);
const closed = await J(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  var m0 = document.querySelector('.sheet-modal');
  var hiding = m0 ? m0.classList.contains('sheet-hide') : false;
  await new Promise(r => setTimeout(r, 900));
  var m = document.querySelector('.sheet-modal');
  return { display: m ? getComputedStyle(m).display : 'gone', hiding: hiding };`);
ok(closed.hiding, '⑩ Esc 关闭时先挂上 .sheet-hide（播消失动画）');
ok(closed.display === 'none' || closed.display === 'gone', `⑤ Esc 能关掉小窗（display=${closed.display}）`);

// ★★ ⑤ 之后小窗是**关着**的，后面 ⑥⑦ 的几何探针必须重新打开再量 ——
//    否则 getBoundingClientRect 全是 0，重叠/溢出判定会**空过**（第一版就是这样：0 vs 0 也判绿）。
const reopened = await J(`var el = document.querySelector('.timeline-fee-view[data-sheet-pj="${target.pj}"]');
  if (!el) return { ok:false };
  el.click();
  await new Promise(r => setTimeout(r, 1800));
  var m = document.querySelector('.sheet-modal');
  var panel = m && m.querySelector('.sheet-panel');
  var r = panel ? panel.getBoundingClientRect() : { width:0, height:0 };
  var body = m && m.querySelector('.sheet-body');
  return { ok: !!(m && !m.hidden), w: Math.round(r.width), h: Math.round(r.height),
    scrollW: body ? body.scrollWidth : 0, clientW: body ? body.clientWidth : 0 };`);
ok(reopened.ok && reopened.w > 200 && reopened.h > 100,
    `⑤b 重新打开小窗后量尺寸（面板 ${reopened.w}×${reopened.h}）`);

// ⑥ 表头那行大标题不要了 + 横向滚动条走站里自绘的那套
const polish = await J(`var m = document.querySelector('.sheet-modal');
  if (!m) return { open:false };
  var body = m.querySelector('.sheet-body');
  var heads = [].map.call(m.querySelectorAll('table thead th'), th => th.textContent.trim());
  var cs = body ? getComputedStyle(body) : null;
  return { open:true, heads: heads,
    isHost: !!(body && body.classList.contains('cscroll-host')),
    scrollbarWidth: cs ? cs.scrollbarWidth : '',
    barCount: m.querySelectorAll('.cscroll-bar').length };`);
ok(polish.open && polish.heads.indexOf('爱藏评级费用清单') < 0,
    `⑥ 表头不再是大标题「爱藏评级费用清单」（首行表头 = ${JSON.stringify((polish.heads || []).slice(0, 3))}）`);
ok(polish.isHost && polish.scrollbarWidth === 'none',
    `⑥ 滚动容器挂上自绘滚动条宿主（cscroll-host=${polish.isHost}，原生条已收：scrollbar-width=${polish.scrollbarWidth}）`);
// ★ 关键一问：横向溢出时到底还有没有"能拖的横向条"。宿主类把原生条**两个方向**都收掉了，
//   所以要么自绘实现了横向，要么这里就得承认"横着滚不动" —— 先量出来再判。
const hProbe = await J(`var m = document.querySelector('.sheet-modal');
  var body = m && m.querySelector('.sheet-body');
  var bars = [].map.call(m ? m.querySelectorAll('.cscroll-bar') : [], b => {
    var r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), cls: b.className }; });
  return { overflowX: body ? body.scrollWidth - body.clientWidth : 0,
    scrollW: body ? body.scrollWidth : 0, clientW: body ? body.clientWidth : 0, bars: bars };`);
console.log(`  · 横向探针：scrollWidth ${hProbe.scrollW} / clientWidth ${hProbe.clientW}（溢出 ${hProbe.overflowX}px）；自绘条 ${JSON.stringify(hProbe.bars)}`);
ok(hProbe.clientW > 0 && (hProbe.overflowX <= 0 || hProbe.bars.some(b => b.w > b.h)),
    `⑥ 横向溢出时存在可拖的横向条（容器 ${hProbe.clientW}px、溢出 ${hProbe.overflowX}px；自绘条 ${JSON.stringify(hProbe.bars)}）`);

// ⑦ 抬头不重叠 + 链接无下划线（用户 2026-11 报："『下载清单』与 × 重叠了；不要下划线"）
const headProbe = await J(`var m = document.querySelector('.sheet-modal');
  if (!m) return { open:false };
  var dl = m.querySelector('.sheet-dl'), cl = m.querySelector('.sheet-close');
  var rd = dl.getBoundingClientRect(), rc = cl.getBoundingClientRect();
  var overlap = !(rd.right <= rc.left || rc.right <= rd.left || rd.bottom <= rc.top || rc.bottom <= rd.top);
  return { open:true, overlap: overlap, deco: getComputedStyle(dl).textDecorationLine,
    dl: [Math.round(rd.left), Math.round(rd.right)], cl: [Math.round(rc.left), Math.round(rc.right)] };`);
ok(headProbe.open && (headProbe.dl[1] - headProbe.dl[0]) > 0 && !headProbe.overlap,
    `⑦「下载清单」与关闭按钮不重叠（链接 x ${JSON.stringify(headProbe.dl)} vs 关闭 x ${JSON.stringify(headProbe.cl)}）`);
ok(headProbe.deco === 'none', `⑦「下载清单」无下划线（text-decoration-line=${headProbe.deco}）`);

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
try { ws.close(); } catch { }
child.kill(); server.close();
process.exitCode = fail ? 1 : 0;
