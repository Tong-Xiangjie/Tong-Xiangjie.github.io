// 验收：表格的代码排版 —— **要有换行、要有缩进**，一行只放一个标签。
//
// 用户报的（原话）："编辑器的表格自动生成代码似乎没有换行，比较乱"，并贴了希望的形状
//   （`<div style="overflow-x:auto…">` / `<table>` / `<thead>` / `<tr>` / 缩进两格的单元格 /
//     单元格里并排图组一张图一行 —— 与他手写的 republic_signatures_on_notes_editions.html 一致）。
//
// 量下来的原因：序列化器里 `<tr>/<td>/<th>` 被列进了 TOOLBOX_ONELINE_TAGS，一律"一行写完"，
//   而且整条导出链路**没有任何缩进** —— 于是 5 列的表格导出成**一整行几百个字符**：
//   `<tbody>` 下面所有 `<tr>` 全挤在一行（用户贴出来的就是那样）。生成器自己的产出明明是多行的，
//   但编辑区一动（编辑区 → 代码区那条路）就被重新压平，两边形状不一致。
//
// 本用例守六件事：
//   ① 生成器的产出：骨架自己一行、单元格一行一个、单元格比行多缩进两格、没有超长行；
//   ② "插表格 → 代码区"与生成器产出**逐字节一致**（插进去什么样、导出就什么样）；
//   ③ 真实文章（用户手写的那篇）走一遍编辑区 → 代码区：每个标签一行、文字一个不丢、再走一遍逐字节相同；
//   ④ 单元格里的并排图组：图组撑开、一张图一行；
//   ⑤ 在单元格里真的敲一个字之后，排版不许退回"一行写完"；
//   ⑥ 任何一行里不许出现两个 `<tr>` 或两个 `<td>`（旧行为不许回来）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
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
const BASE = `http://127.0.0.1:${server.address().port}/collection/`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpToolboxTableCode-'));
const DP = 17490;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1280,900', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const J = async e => JSON.parse(await evaluate(`(async function(){ return JSON.stringify(await (async function(){ ${e} })()); })()`));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

async function key(k, code, vk, modifiers = 0) {
  const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(400);
}
const Enter = () => key('Enter', 'Enter', 13, 0);
const ShiftEnter = () => key('Enter', 'Enter', 13, 8);

const PAGE_HELPERS = String.raw`
window.__sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
window.__code = function () { return document.getElementById('tbCode').value; };
// 代码区 → 编辑区（"把 HTML 贴进代码区"那条路）
window.__toEditor = function (text) {
  var c = document.getElementById('tbCode');
  c.value = text;
  c.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
// 编辑区 → 代码区（用户抱怨的那条路：编辑区一动，代码区被重新排版）
window.__fromEditor = function () { toolboxRefresh(); return document.getElementById('tbCode').value; };
window.__codeStats = function (text) {
  var lines = String(text).split('\n');
  var long = 0, twoTr = 0, twoTd = 0, maxLen = 0;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (l.length > maxLen) maxLen = l.length;
    if (l.length > 120) long++;
    if ((l.match(/<tr[ >]/g) || []).length > 1) twoTr++;
    if ((l.match(/<t[dh][ >]/g) || []).length > 1) twoTd++;
  }
  return { lines: lines.length, maxLen: maxLen, long: long, twoTr: twoTr, twoTd: twoTd };
};
window.__textOf = function (sel) { var el = document.querySelector(sel); return el ? String(el.textContent || '') : ''; };
`;
await send('Page.navigate', { url: BASE + 'index.html' });
await sleep(4200);
await evaluate(PAGE_HELPERS);
await evaluate(`toolboxOpen();`);
await sleep(700);

const article = await readFile(join(ROOT, 'notecollection/readmes/republic_signatures_on_notes_editions.html'), 'utf8');

// 单元格里塞一个"并排图组"的表格（用户那篇文章里就有这么一格）
const wanted = [
  '<p>图组测试</p>',
  '<div style="overflow-x:auto;margin:1rem 0;">',
  '<table>',
  '<tbody>',
  '<tr>',
  '  <td>并排图</td>',
  '  <td>',
  '    <div style="display:flex; justify-content:center; gap:20px;">',
  '      <img src="readmes/image/b.jpg" style="height:180px;">',
  '      <img src="readmes/image/c.jpg" style="height:180px;">',
  '    </div><br>',
  '  </td>',
  '</tr>',
  '</tbody>',
  '</table>',
  '</div>'
].join('\n');

console.log('\n══════ ① 生成器的产出：骨架一行一个、单元格缩进两格 ══════\n');
const built = await evaluate(`toolboxBuildTable(3, 2, true)`);
{
  const s = await J(`return window.__codeStats(${JSON.stringify(built)});`);
  const lines = built.split('\n');
  ok(s.twoTr === 0 && s.twoTd === 0,
    `一行里不许塞两个 <tr>/<td>（实测：含两个 <tr> 的行 ${s.twoTr} 行、含两个 <td> 的行 ${s.twoTd} 行）`);
  ok(s.long === 0, `没有超长行（最长 ${s.maxLen} 字符，阈值 120）`);
  const trLine = lines.find(l => l.trim() === '<tr>');
  const thLine = lines.find(l => /<th[ >]/.test(l));
  ok(!!trLine && !!thLine && /^  </.test(thLine),
    `单元格比 <tr> 多缩进两格（<tr> 在 ${trLine ? trLine.indexOf('<') : '?'} 列、<th> 在 ${thLine ? thLine.indexOf('<') : '?'} 列）`);
  const tableLine = lines.find(l => /<table[ >]/.test(l));
  ok(!!tableLine && tableLine.indexOf('<') === 0, `<table> 与包裹它的 <div> 齐平（用户手写的那篇就是这样）`);
  const closed = lines.filter(l => /^<\/?(thead|tbody|tr|table|div)>/.test(l.trim())).length;
  ok(closed >= 8, `骨架标签各自成行（数到 ${closed} 行骨架标签）`);
}

console.log('\n══════ ② 插表格 → 代码区：与生成器产出逐字节一致 ══════\n');
{
  await J(`
    var ed = toolboxTpl.editor;
    ed.innerHTML = '<p>表格前</p>';
    toolboxSnapClear(); toolboxRefresh(); await __sleep(320);
    var rg = document.createRange(); rg.selectNodeContents(ed); rg.collapse(false);
    var sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); toolboxSaveRange();
    toolboxInsertHtml(${JSON.stringify(built)});
    await __sleep(700);
    return 1;
  `);
  const code = await evaluate(`window.__code()`);
  const tablePart = code.slice(code.indexOf('<div style="overflow-x'));
  ok(tablePart === built,
    `代码区里的表格与生成器产出逐字节相同（${tablePart.length} vs ${built.length} 字符）—— 插进去什么样、导出就什么样`);
  const s = await J(`return window.__codeStats(${JSON.stringify(code)});`);
  ok(s.twoTr === 0 && s.twoTd === 0, `代码区里一行也没塞两个 <tr>/<td>（${s.lines} 行 / 最长 ${s.maxLen} 字符）`);
}

console.log('\n══════ ③ 真实文章（用户手写的那篇）走一遍编辑区导出 ══════\n');
let artOut = '';
{
  await J(`window.__toEditor(${JSON.stringify(article)}); await __sleep(1100); return 1;`);
  artOut = await evaluate(`window.__fromEditor()`);
  const s = await J(`return window.__codeStats(${JSON.stringify(artOut)});`);
  ok(s.twoTr === 0 && s.twoTd === 0,
    `导出后一行也没塞两个 <tr>/<td>（实测 ${s.twoTr} / ${s.twoTd}）—— 修前表体全挤在一行`);
  ok(s.long === 0 || s.maxLen < 460, `没有几百字符的巨行（最长 ${s.maxLen} 字符）`);
  // 单元格一行一个：三个单元格的表头检查
  const trLines = artOut.split('\n').filter(l => l.trim() === '<tr>');
  const tdLines = artOut.split('\n').filter(l => /^\s*<t[dh][ >]/.test(l));
  ok(trLines.length === 8 && tdLines.length >= 20,
    `<tr> 与 <td> 各自成行（<tr> ${trLines.length} 行、单元格 ${tdLines.length} 行）`);
  // 文字一个不丢：把两份里的文字抠出来比。
  // ★ 这里**连 <style> 里的 CSS 一起算**：那段 CSS 也是用户写的内容，导入导出必须原样活着
  //   （它曾经被 sanitizeToolboxNode 当危险标签删掉，顺带把表格样式也删了）。
  const txt = await J(`
    var a = document.createElement('div'); a.innerHTML = ${JSON.stringify(article)};
    var b = document.createElement('div'); b.innerHTML = ${JSON.stringify(artOut)};
    var norm = function (x) { return String(x.textContent || '').replace(/\\s+/g, ''); };
    return { before: norm(a), after: norm(b) };
  `);
  ok(txt.before === txt.after,
    `文字（含 <style> 里的 CSS）一个没丢（${txt.before.length} 字 → ${txt.after.length} 字）`);
  const tdCount = await J(`
    var b = document.createElement('div'); b.innerHTML = ${JSON.stringify(artOut)};
    return { td: b.querySelectorAll('td').length, table: b.querySelectorAll('table').length };
  `);
  ok(tdCount.td === 21 && tdCount.table === 1,
    `表格结构完好（${tdCount.table} 张表 / ${tdCount.td} 个 td）`);
}

console.log('\n══════ ④ 单元格里的并排图组：一张图一行 ══════\n');
{
  await J(`window.__toEditor(${JSON.stringify(wanted)}); await __sleep(1000); return 1;`);
  const out = await evaluate(`window.__fromEditor()`);
  const flexLine = out.split('\n').find(l => /display:flex/.test(l)) || '';
  ok(flexLine.trim().startsWith('<div') && flexLine.trim().endsWith('>'),
    `flex 图组自己占一行、标签闭合（「${flexLine.trim().slice(0, 40)}…」）`);
  ok(!/img/.test(flexLine), `flex 那一行里不再拖着图片标签`);
  const imgLines = out.split('\n').filter(l => /<img /.test(l));
  ok(imgLines.length === 2 && imgLines.every(l => /^\s+<img /.test(l)),
    `两张图各自成行、带缩进（${imgLines.length} 行）`);
  ok(/^\s*<\/?td[ >]/.test(out.split('\n').find(l => /<td>并排图/.test(l)) || 'x'),
    `单元格自己一行（内容全是行内时一行写完）`);
}

console.log('\n══════ ⑤ 单元格里真的敲一个字之后，排版不许退回一行写完 ══════\n');
{
  await J(`window.__toEditor(${JSON.stringify(wanted)}); await __sleep(1000); return 1;`);
  await evaluate(`window.__fromEditor();`);
  await J(`
    var ed = toolboxTpl.editor;
    var td = ed.querySelector('tbody td');
    var tn = td.firstChild;
    var rg = document.createRange(); rg.setStart(tn, 1); rg.collapse(true);
    var sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg);
    ed.focus(); toolboxSaveRange(); return 1;
  `);
  await send('Input.insertText', { text: 'X' });
  await sleep(900);
  const out = await evaluate(`window.__code()`);
  const s = await J(`return window.__codeStats(${JSON.stringify(out)});`);
  ok(out.indexOf('并X排图') >= 0 || out.indexOf('并排X图') >= 0, `字确实打进了单元格（${(out.match(/[并排图X]{4}/) || [''])[0]}）`);
  ok(s.twoTr === 0 && s.twoTd === 0, `打完字排版没变回"一行写完"（${s.lines} 行 / 最长 ${s.maxLen} 字符）`);
}

console.log('\n══════ ⑥ 幂等：同一份内容再走一遍逐字节相同 ══════\n');
{
  await J(`window.__toEditor(${JSON.stringify(artOut)}); await __sleep(1100); return 1;`);
  const again = await evaluate(`window.__fromEditor()`);
  ok(again === artOut, `真实文章导出 → 再导入 → 再导出，逐字节相同（${artOut.length} 字符）`);
}

console.log('\n══════ ⑦ 用户那份"标准代码"（含 <style> + class）必须能贴进去、且样式真的生效 ══════\n');
{
  // 校验：这段代码以前直接报错（"Line 6：不允许的标签 <style>" / "Line 23：…"）
  const lint = await J(`
    var r = toolboxLint(${JSON.stringify(article)});
    var errs = (r && r.errors) ? r.errors.map(function (e) { return 'L' + e.line + ' ' + e.msg; }) : [];
    return { count: errs.length, errs: errs.slice(0, 6) };
  `);
  ok(lint.count === 0, `校验 0 错（实测 ${lint.count} 条${lint.count ? '：' + lint.errs.join(' / ') : ''}）—— 修前 <style> 直接算"不允许的标签"`);

  await J(`window.__toEditor(${JSON.stringify(article)}); await __sleep(1100); return 1;`);
  const out = await evaluate(`window.__fromEditor()`);
  const lf = s => String(s).replace(/\r\n?/g, '\n');
  const styleIn = (lf(article).match(/<style>[\s\S]*?<\/style>/) || [''])[0];
  ok(lf(out).indexOf(styleIn) >= 0,
    `<style> 整块逐字节活着（${styleIn.split('\n').length} 行 CSS）`);
  ok(out.indexOf('<table class="signature-table">') >= 0,
    `<table class="signature-table"> 的 class 活着 —— 不然那段 CSS 就没有对象可配`);
  // 导出与磁盘原文的**真实差异**：除了换行风格（文件 CRLF / 编辑区 LF），到底改了哪几行？
  // 用"多重集合差"而不是逐行对齐 —— 逐行对齐会把整段位移全报成差异，看不清真相。
  const a = lf(article).split('\n'), b = lf(out).split('\n');
  const tally = arr => { const m = new Map(); arr.forEach(l => m.set(l, (m.get(l) || 0) + 1)); return m; };
  const ma = tally(a), mb = tally(b);
  const onlyFile = [], onlyOut = [];
  ma.forEach((n, l) => { const d = n - (mb.get(l) || 0); if (d > 0) onlyFile.push(l); });
  mb.forEach((n, l) => { const d = n - (ma.get(l) || 0); if (d > 0) onlyOut.push(l); });
  console.log(`    （导出与原文的差异，换行风格已归一：原文独有 ${onlyFile.length} 行 / 导出独有 ${onlyOut.length} 行）`);
  onlyFile.slice(0, 4).forEach(l => console.log(`      − ${JSON.stringify(l.length > 70 ? l.slice(0, 70) + '…' : l)}`));
  onlyOut.slice(0, 4).forEach(l => console.log(`      + ${JSON.stringify(l.length > 70 ? l.slice(0, 70) + '…' : l)}`));
  ok(out.indexOf('<table>\n<thead>') < 0 || out.indexOf('class="signature-table"') >= 0,
    `表格仍是带 class 的那张（没有退化成裸 <table>）`);

  // 样式是不是真的生效：文章页就是把 readme 原样 innerHTML 注入，编辑区里能量到同样结果
  const look = await J(`
    var t = toolboxTpl.editor.querySelector('table.signature-table');
    if (!t) return { found: false };
    var cs = getComputedStyle(t);
    var td = t.querySelector('tbody td');
    var cst = td ? getComputedStyle(td) : null;
    return { found: true, collapse: cs.borderCollapse, fontSize: cs.fontSize, align: cs.textAlign,
             tdBorder: cst ? cst.borderTopWidth : '' };
  `);
  ok(look.found === true, `编辑区里找得到 .signature-table 这张表`);
  ok(look.collapse === 'collapse' && look.tdBorder === '1px',
    `CSS 真的落到了表上（border-collapse=${look.collapse}、单元格上边框=${look.tdBorder}、字号=${look.fontSize}）`);
}

console.log('\n══════ ⑧ 光标落在 <style> 块里时，回车/换行不许把 CSS 切坏 ══════\n');
{
  await J(`window.__toEditor(${JSON.stringify(article)}); await __sleep(1100); return 1;`);
  const cssBefore = await J(`
    var st = toolboxTpl.editor.querySelector('style');
    if (!st) return { ok: false };
    var tn = st.firstChild;
    // 光标放到 CSS 文本正中间（用户点一下就可能落在这里）
    var rg = document.createRange(); rg.setStart(tn, Math.floor(String(tn.nodeValue).length / 2)); rg.collapse(true);
    var s = getSelection(); s.removeAllRanges(); s.addRange(rg);
    toolboxTpl.editor.focus(); toolboxSaveRange();
    return { ok: true, css: String(st.textContent || ''), styles: toolboxTpl.editor.querySelectorAll('style').length };
  `);
  ok(cssBefore.ok === true, `编辑区里有一个可定位的 <style> 块（${cssBefore.styles} 个）`);
  await Enter();
  await ShiftEnter();
  const cssAfter = await J(`
    var st = toolboxTpl.editor.querySelector('style');
    return { css: st ? String(st.textContent || '') : '(没有 style 了)', styles: toolboxTpl.editor.querySelectorAll('style').length,
             styled: !!toolboxTpl.editor.querySelector('table.signature-table') };
  `);
  ok(cssAfter.css === cssBefore.css && cssAfter.styles === 1,
    `回车 / Shift+Enter 之后 CSS 文本逐字节没变（${cssBefore.css.length} 字符，style 块 ${cssAfter.styles} 个）`);
  ok(cssAfter.styled === true, `表格还在、class 还在（CSS 仍然有对象可配）`);
}

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 0 ────────`);
console.log(fail === 0 ? '🟢 表格代码排版检查全部通过' : '✗ 表格代码排版检查失败');

ws.close(); child.kill(); server.close();
process.exit(fail === 0 ? 0 : 1);
