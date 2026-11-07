// 验收：图片/图注/表格旁边的"换行"和 Ctrl+Z，**光标必须落在用户以为的那个地方**，结构不许被改写。
//
// 用户报的（原话）："不是很丝滑：换行、ctrl+z 总是跳到别的地方；另外例如多张图片的时候在图注
//   末尾换行，就会跳到下一张图片的图注的开头；表格也是类似。似乎图表就不是一个正常的'元素'"。
//
// 量下来的根因有两条，都不在"光标绘制"，而在两处**结构判断**：
//
//   ① 在**段首**按回车时走了"切段"那条路：toolboxSplitBlockAt 会把这一段的内容整个搬进一个
//      新的 <p>（图注就从 <center> 变成 <p>，标签/样式一起没了），空掉的前半段又被"前半段被
//      切空 → 升格成一根独立 <br>"那条规则吃掉 —— 于是"在图片/图注/表格旁边换行"会把结构改坏。
//      修法：非普通段落（<center>/<div> 引用块/表格外壳…）停在段首回车时，在它**前面**插一个
//      新空段，原块一个字不动（与 Word/Docs 一致）。普通 <p> 保持原口径不变。
//
//   ② Ctrl+Z 的落点：撤回栈靠"源码字符串"判"内容有没有变"，可**回车在段尾分出来的那个空段是
//      瞬态的** —— 导出时被 toolboxDropEmptyBlocks（空块直接摘掉）删掉，源码一字不差。于是这一下
//      回车**根本不入栈**，用户按 Ctrl+Z 撤掉的是更早的一步，光标自然"跳到别的地方"。
//      另外光标位置的恢复最先试"文字指纹"，而正文段的前文里常常正好含有图注那串字，
//      指纹会匹配到图注里那一份，整块跑偏。
//      修法：入栈判据加上"编辑区结构指纹"（区分"多出一个空段"与"光标只是挪了一下"）；
//      指纹落点再用"结构坐标（第几个内容块+块内第几个字）"互相校验，并对不上时按结构坐标兜底。
//
// 本用例守四件事：
//   ① 图注（<center>）旁边回车：标签不许被换掉、不许凭空多出根级 <br>，新空段落要落在正确一侧；
//   ② Ctrl+Z 之后光标必须回到**用户刚才动手的那一段里**（不许掉到编辑区根上、不许跳到图注里）；
//   ③ 方向键挪光标**不许**产生撤回步（结构指纹不能把"光标挪位置"当成内容变化）；
//   ④ 整个回车/撤回循环之后，导出源码与原始源码**逐字节相同**（结构没被悄悄改写）。
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpToolboxCaret-'));
const DP = 17480;
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

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

// ★ 一律派发**真实按键**（CDP Input 域），不走 JS 合成事件：
//   回车/Ctrl+Z/方向键都是编辑器自己 keydown 里接管的，只有真按键才走用户那条路。
async function key(k, code, vk, modifiers = 0) {
  const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(420);
}
const Enter = () => key('Enter', 'Enter', 13, 0);
const CtrlZ = () => key('z', 'KeyZ', 90, 2);
const ArrowLeft = () => key('ArrowLeft', 'ArrowLeft', 37, 0);
const ArrowRight = () => key('ArrowRight', 'ArrowRight', 39, 0);

// 页面里备好一套"图 + 图注 + 图 + 图注 + 正文（+ 可选尾段/表格）"的正文，
// 以及"把光标放到第 i 个内容块的开头/末尾""报告光标落在哪个块"的工具。
const PAGE_HELPERS = String.raw`
window.__doc = [
  '<center><img src="readmes/image/a.jpg" width="80%" alt="a.jpg"></center>',
  '<center><span style="color:#555555;font-size:0.85rem;">图1 第一张的说明</span></center>',
  '<center><img src="readmes/image/b.jpg" width="80%" alt="b.jpg"></center>',
  '<center><span style="color:#555555;font-size:0.85rem;">图2 第二张的说明</span></center>',
  '<p>正文第一段</p>'
].join('\n');
// 只数**元素块**：childNodes 里还夹着空白文本节点与"光标托"，取块与报块必须是同一个口径
window.__blocks = function () {
  var ed = toolboxTpl.editor, out = [];
  for (var i = 0; i < ed.childNodes.length; i++) {
    var c = ed.childNodes[i];
    if (c.nodeType !== 1) continue;
    if (c.getAttribute && c.getAttribute('data-tb-caret')) continue;
    out.push(c);
  }
  return out;
};
window.__load = function (extra) {
  var ed = toolboxTpl.editor;
  ed.innerHTML = window.__doc + (extra || '');
  toolboxSnapClear();
  toolboxRefresh();
};
window.__caret = function (i, atEnd) {
  var ed = toolboxTpl.editor, blk = window.__blocks()[i];
  var r = document.createRange();
  if (atEnd) { r.selectNodeContents(blk); r.collapse(false); }
  else { r.setStart(blk, 0); r.collapse(true); }
  var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  ed.focus(); toolboxSnapClear(); toolboxSaveRange();
  return true;
};
window.__where = function () {
  var ed = toolboxTpl.editor, sel = getSelection();
  var els = window.__blocks();
  var out = {
    tags: els.map(function (c) { return c.tagName; }),
    texts: els.map(function (c) { return String(c.textContent || '').replace(/\s+/g, ' ').slice(0, 12); }),
    rootBr: 0, rootP: 0
  };
  for (var i = 0; i < ed.childNodes.length; i++) {
    var c = ed.childNodes[i];
    if (c.nodeType !== 1) continue;
    if (c.getAttribute && c.getAttribute('data-tb-caret')) continue;
    if (c.tagName === 'BR') out.rootBr++;
  }
  out.sel = '(没有选区)';
  out.idx = -1;
  if (sel && sel.rangeCount) {
    var r = sel.getRangeAt(0), n = r.startContainer, top = n;
    while (top && top.parentNode !== ed) top = top.parentNode;
    out.idx = (top && top.nodeType === 1) ? els.indexOf(top) : -1;
    var path = [];
    for (var t = n; t && t !== ed; t = t.parentNode) path.push(t.nodeType === 3 ? '#text' : t.tagName);
    out.sel = (top && top.nodeType === 1 ? top.tagName : '根') + ' / ' + path.join('<') + '@' + r.startOffset;
    // 光标是不是"落在一个能打字的文本节点里"
    out.inText = !!(n && n.nodeType === 3);
  }
  return out;
};
window.__code = function () { return toolboxCodeText(); };
window.__undoDepth = function () { return toolboxUndo.stack.length; };
window.__resetUndo = function () { toolboxUndoReset(); };
// 表格：光标放进第 r 行（只数 tbody）、第 c 列单元格的文字末尾；以及表格体检报告
window.__caretCell = function (r, c) {
  var ed = toolboxTpl.editor;
  var rows = ed.querySelectorAll('tbody tr');
  var cell = rows[r] && rows[r].children[c];
  if (!cell) return false;
  var tn = null, w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null), n;
  while ((n = w.nextNode())) if (String(n.nodeValue || '').length) tn = n;
  var range = document.createRange();
  if (tn) { range.setStart(tn, String(tn.nodeValue).length); range.collapse(true); }
  else { range.selectNodeContents(cell); range.collapse(false); }
  var s = getSelection(); s.removeAllRanges(); s.addRange(range);
  ed.focus(); toolboxSnapClear(); toolboxSaveRange();
  return true;
};
window.__tableHealth = function () {
  var ed = toolboxTpl.editor;
  var first = ed.querySelector('tbody tr');
  var sel = getSelection(), inCell = false;
  if (sel && sel.rangeCount) {
    var t = sel.getRangeAt(0).startContainer;
    while (t && t !== ed) { if (t.nodeType === 1 && t.tagName === 'TD') { inCell = true; break; } t = t.parentNode; }
  }
  return {
    tables: ed.querySelectorAll('table').length,
    rows: ed.querySelectorAll('tbody tr').length,
    cells: ed.querySelectorAll('th,td').length,
    firstRowText: first ? String(first.textContent || '').replace(/\s+/g, '') : '(没有行)',
    cellBr: ed.querySelectorAll('tbody td br').length,
    inCell: inCell
  };
};
`;

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + 'index.html' });
  await sleep(4200);
  await evaluate(`window.__sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };`);
  await evaluate(`toolboxOpen();`);
  await sleep(700);
  await evaluate(PAGE_HELPERS);
  ok(await evaluate(`!!(toolboxTpl && toolboxTpl.editor)`) === true, '工具箱打开，编辑区可用');

  // ─────────── ① 图注（<center>）旁边的回车不许改写结构 ───────────
  console.log('\n══════ ① 图注旁边回车：结构不许被改写 ══════\n');
  {
    // 光标停在「图1 的图注」**末尾**按回车：新空段落要落在图注之后、下一张图之前
    await J(`window.__load(); await __sleep(300); window.__caret(1, true); await __sleep(120); window.__resetUndo(); await __sleep(60); return 1;`);
    const before = await J(`return window.__where();`);
    await Enter();
    const after = await J(`return window.__where();`);
    ok(after.tags[1] === 'CENTER' && after.texts[1] === '图1 第一张的说明',
      `图注末尾回车：图注自己没被动过（第 1 块仍是 <center>「图1 第一张的说明」）——实际 ${after.tags[1]}/${after.texts[1]}`);
    ok(after.tags[2] === 'P' && after.tags[3] === 'CENTER' && after.texts[3] === 'b.jpg',
      `新空段落落在图注之后、下一张图之前（第 2 块是 <p>，第 3 块仍是 b.jpg）`);
    ok(after.idx === 2, `光标在新空段落里（第 ${after.idx} 块，期望 2）`);
    ok(after.rootBr === before.rootBr,
      `没有凭空多出根级空行（根级 <br> ${before.rootBr} → ${after.rootBr}）`);
  }
  {
    // 光标停在「图1 的图注」**开头**按回车 —— 用户报的"图表不像正常元素"最典型的一下
    await J(`window.__load(); await __sleep(300); window.__caret(1, false); await __sleep(120); window.__resetUndo(); await __sleep(60); return 1;`);
    const before = await J(`return window.__where();`);
    await Enter();
    const after = await J(`return window.__where();`);
    ok(after.tags[1] === 'P' && after.texts[1] === '',
      `图注开头回车：新空段落插在图注**前面**（第 1 块是空 <p>）——实际 ${after.tags[1]}/${after.texts[1]}`);
    ok(after.tags[2] === 'CENTER' && after.texts[2] === '图1 第一张的说明',
      `图注仍是 <center>（没有被改写成 <p>）——实际 ${after.tags[2]}/${after.texts[2]}`);
    ok(after.rootBr === before.rootBr && after.rootBr === 0,
      `没有多余的根级空行（根级 <br> = ${after.rootBr}，期望 0）`);
    ok(after.idx === 1, `光标在新空段落里（第 ${after.idx} 块，期望 1）`);
  }
  {
    // 表格外壳同理：停在表格块开头回车，表格必须原样留着
    await J(`
      var ed = toolboxTpl.editor;
      ed.innerHTML = '<p>表格前</p>' + toolboxBuildTable(2, 2, true) + '<p>表格后</p>';
      toolboxSnapClear(); toolboxRefresh(); await __sleep(300);
      window.__caret(1, false); await __sleep(120); window.__resetUndo(); await __sleep(60);
      return 1;
    `);
    await Enter();
    // ★ 数单元格要连 <th> 一起数：toolboxBuildTable 的首行是表头（th），只数 td 会少一半
    const after = await J(`
      var ed = toolboxTpl.editor;
      var r = { tables: ed.querySelectorAll('table').length, cells: ed.querySelectorAll('th,td').length,
                tags: window.__blocks().map(function (c) { return c.tagName; }),
                idx: window.__where().idx, rootBr: window.__where().rootBr };
      return r;
    `);
    ok(after.tables === 1 && after.cells === 4,
      `表格块开头回车：表格原样留着（table ${after.tables} 个 / 单元格 ${after.cells} 个，期望 1/4）`);
    ok(after.tags[0] === 'P' && after.tags[1] === 'P' && after.tags[2] === 'DIV' && after.tags[3] === 'P',
      `新空段落在表格**前面**、表格还在原位（块序 ${after.tags.join(',')}，期望 P,P,DIV,P）`);
    ok(after.rootBr === 0, `没有多余的根级空行（根级 <br> = ${after.rootBr}）`);
  }

  // ─────────── ② Ctrl+Z 之后光标必须回到刚动手的那一段 ───────────
  console.log('\n══════ ② Ctrl+Z 的光标落点 ══════\n');
  {
    // 正文段末尾打字 → 撤回：文字回来，光标必须**还在这一段里**
    await J(`window.__load(); await __sleep(300); window.__caret(4, true); await __sleep(120); window.__resetUndo(); await __sleep(60); return 1;`);
    await send('Input.insertText', { text: 'AB' });
    await sleep(900);
    const typed = await J(`return window.__where();`);
    await CtrlZ();
    const after = await J(`return window.__where();`);
    ok(typed.texts[4] === '正文第一段AB', `打字落在正文段里（第 4 块 = 「${typed.texts[4]}」）`);
    ok(after.texts[4] === '正文第一段', `Ctrl+Z 把字撤回去了（第 4 块 = 「${after.texts[4]}」）`);
    ok(after.idx === 4,
      `★ 光标仍在**正文这一段**里（第 ${after.idx} 块，期望 4）—— 修前会掉到编辑区根上或跳到图注里`);
    ok(after.inText === true, `光标落在可打字的文本上（不是根/块边界）——${after.sel}`);
  }
  {
    // 中段回车 → 撤回：空段消失，光标回到原段末尾（这是"回车不入栈"那个根因的守卫）
    await J(`window.__load('\\n<p>尾段</p>'); await __sleep(300); window.__caret(4, true); await __sleep(120); window.__resetUndo(); await __sleep(60); return 1;`);
    const depth0 = await J(`return window.__undoDepth();`);
    await Enter();
    const mid = await J(`return { w: window.__where(), depth: window.__undoDepth() };`);
    ok(mid.depth === depth0 + 1,
      `★ 回车本身要成为一条撤回记录（深度 ${depth0} → ${mid.depth}）—— 修前空段不进导出、这一步被跳过`);
    ok(mid.w.tags[5] === 'P' && mid.w.texts[5] === '' && mid.w.texts[6] === '尾段',
      `回车分出的空段夹在正文段与尾段之间（块序 ${mid.w.tags.join(',')}）`);
    await CtrlZ();
    const after = await J(`return window.__where();`);
    ok(after.tags.length === mid.w.tags.length - 1 && after.texts[4] === '正文第一段' && after.texts[5] === '尾段',
      `Ctrl+Z 把那一下回车撤掉了（块序 ${after.tags.join(',')}）`);
    ok(after.idx === 4,
      `★ 光标回到原正文段里（第 ${after.idx} 块，期望 4）—— 修前会跨过这一步撤到更早、光标乱跳`);
  }

  // ─────────── ③ 方向键挪光标不许产生撤回步 ───────────
  console.log('\n══════ ③ 方向键不产生撤回步 ══════\n');
  {
    await J(`window.__load(); await __sleep(300); window.__caret(4, true); await __sleep(120); window.__resetUndo(); await __sleep(60); return 1;`);
    const d0 = await J(`return window.__undoDepth();`);
    for (let i = 0; i < 3; i++) await ArrowLeft();
    for (let i = 0; i < 3; i++) await ArrowRight();
    await sleep(500);
    const d1 = await J(`return window.__undoDepth();`);
    const w = await J(`return window.__where();`);
    ok(d1 === d0, `挪 6 次光标后撤回深度不变（${d0} → ${d1}）—— 结构指纹只认结构变化，不认光标移动`);
    ok(w.idx === 4, `光标仍在正文段里（第 ${w.idx} 块）`);
  }

  // ─────────── ④ 单元格里回车不许把表劈开 ───────────
  console.log('\n══════ ④ 表格单元格里回车：表格结构一个节点都不许动 ══════\n');
  {
    await J(`
      var ed = toolboxTpl.editor;
      ed.innerHTML = '<p>表格前</p>' + toolboxBuildTable(3, 2, true) + '<p>表格后</p>';
      toolboxSnapClear(); toolboxRefresh(); await __sleep(320);
      window.__caretCell(0, 0); await __sleep(120); window.__resetUndo(); await __sleep(60);
      return 1;
    `);
    const before = await J(`return window.__tableHealth();`);
    await Enter();
    const after = await J(`return window.__tableHealth();`);
    ok(after.tables === before.tables && after.rows === before.rows && after.cells === before.cells,
      `★ 表格没被劈开（表 ${before.tables}→${after.tables} / 行 ${before.rows}→${after.rows} / 格 ${before.cells}→${after.cells}）—— 修前会变成 2 张表、还多一行`);
    ok(after.firstRowText === before.firstRowText,
      `首行单元格的文字没被搬走（「${before.firstRowText}」→「${after.firstRowText}」）`);
    ok(after.cellBr === before.cellBr + 1,
      `回车变成了单元格内的换行（单元格里 <br> ${before.cellBr} → ${after.cellBr}）`);
    ok(after.inCell === true, `光标仍在单元格里（表格里回车的自然含义：就地换行）`);
    await CtrlZ();
    const undone = await J(`return window.__tableHealth();`);
    ok(undone.tables === 1 && undone.cells === before.cells && undone.cellBr === before.cellBr,
      `Ctrl+Z 把这一下换行撤回（表 ${undone.tables} / 格 ${undone.cells} / 单元格 <br> ${undone.cellBr}）`);
  }

  // ─────────── ⑤ 一圈回车/撤回之后，导出源码逐字节不变 ───────────
  console.log('\n══════ ⑤ 源码不许被悄悄改写 ══════\n');
  {
    await J(`window.__load('\\n<p>尾段</p>'); await __sleep(300); window.__caret(1, false); await __sleep(120); window.__resetUndo(); await __sleep(60); return 1;`);
    const code0 = await evaluate(`window.__code()`);
    await Enter();                       // 在图注开头回车（最容易被改写结构的那一下）
    await CtrlZ();                       // 再撤回
    await sleep(400);
    const code1 = await evaluate(`window.__code()`);
    const w = await J(`return window.__where();`);
    ok(code1 === code0, `图注开头「回车 + 撤回」之后源码逐字节不变（${code0.length} 字）`);
    ok(w.tags[1] === 'CENTER' && w.texts[1] === '图1 第一张的说明',
      `图注仍是 <center>「图1 第一张的说明」（实际 ${w.tags[1]}/${w.texts[1]}）`);
  }
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
console.log(`  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
if (fail) { console.log(`✗ 工具箱光标/结构检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 工具箱光标/结构检查全部通过（${pass} 项断言${skipped ? `，跳过 ${skipped}` : ''}）`);
