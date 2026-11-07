// 验收：用户这一轮报的六件事（都在编辑器里，原话逐条列在下面）。
//
//   ① "文字编辑器修改图片路径后，默认生成的展位文字应该重新检测"
//      —— 占位框上的文字来自 alt（没写 alt 时是文件名的默认写法），改了路径却不改 alt，
//         展位文字就还是旧文件名。改路径时若 alt 本来就是"默认写法"，要跟着重新算一遍。
//   ② "直接复制左侧的表格并且粘贴，表格样式会失效"
//      —— class 跟着剪贴板走，可定义这些 class 的 <style> 块不会跟着走；粘到代码区就成
//         "有 class、没规则"的裸表格。粘贴时要从当前页面的样式表里把命中的规则一起带过来，
//         而且剪贴板 HTML 里本来就带的 <style> 不许再被删掉。
//   ③ "插入图片的时候自动加上去的 [空行] 完全是多余的" + "删掉这个换行会连带着图片一起删掉"
//      —— 插块之后不该留空壳；点那个空行按退格只能删掉空行本身，不许把图片一起带走。
//   ④ "表格内换行会出问题"
//      —— 表格里回车只许在单元格内插 <br>，绝不拆表；而且回车之后打字要落在**换行之后**
//         （实测：光标停在"块尾 + 末尾 <br>"上时，浏览器一打字就把那根 <br> 吃掉）。
//   ⑤ "多图的模式，右键出来却显示的是单图界面 指的是修改参数"
//      —— 并排图片上右键给的是「修改多图参数…」（张数/尺寸模式/尺寸/每张路径与图注/共用图注）。
//   ⑥ "假如文章在最后插入了表格，想接下来另起一行就得在右边手动加上 <br>"
//      —— 这条是本轮 STYLE 守卫漏判空引入的回归：光标停在根上（表格/图片后面）时回车抛异常，
//         preventDefault 已经执行过 ⇒ 回车完全没反应。守两件事：回车不报错、能接着另起一行打字。
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpToolboxReports2-'));
const DP = 17500;
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
  await sleep(420);
}
const Enter = () => key('Enter', 'Enter', 13, 0);
const Backspace = () => key('Backspace', 'Backspace', 8, 0);
const type = async t => { await send('Input.insertText', { text: t }); await sleep(600); };

const PAGE_HELPERS = String.raw`
window.__sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
window.__code = function () { return document.getElementById('tbCode').value; };
window.__toEditor = function (text) {
  var c = document.getElementById('tbCode');
  c.value = text; c.dispatchEvent(new Event('input', { bubbles: true })); return true;
};
window.__caretEnd = function () {
  var ed = toolboxTpl.editor;
  var r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  var s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxSaveRange(); return true;
};
window.__caretIn = function (el, off) {
  var r = document.createRange();
  r.setStart(el, off == null ? el.childNodes.length : off); r.collapse(true);
  var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  toolboxTpl.editor.focus(); toolboxSnapClear(); toolboxSaveRange(); return true;
};
window.__where = function () {
  var s = getSelection(); var ed = toolboxTpl.editor; var n = s.anchorNode;
  return { node: n ? (n === ed ? '(根)' : (n.nodeType === 1 ? n.tagName : '#text')) : '(无)', offset: s.anchorOffset };
};
window.__errs = [];
window.addEventListener('error', function (e) { window.__errs.push(String((e && e.message) || e)); });
window.__phText = function (img) {
  var w = toolboxImgDisplayWrap(img);
  if (!w) return '(无占位框)';
  var n = w.querySelector('[data-tb-display="name"]');
  return n ? String(n.textContent || '') : '(无文字)';
};
// 对话框：填字段 / 点选项 / 确定（就是用户在框里打字再按确定）
window.__setField = function (key, val) {
  var el = document.getElementById('tbF_' + key);
  if (!el) return false;
  el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); return true;
};
window.__seg = function (key, val) {
  var box = document.getElementById('tbF_' + key);
  if (!box) return false;
  var bs = box.querySelectorAll('.tb-seg');
  for (var i = 0; i < bs.length; i++) {
    if (String(bs[i].getAttribute('data-val')) === String(val)) { bs[i].click(); return true; }
  }
  return false;
};
window.__dlgTitle = function () {
  var t = document.querySelector('#toolboxDialog .tb-dialog-title, .tb-dialog-title');
  return t ? String(t.textContent || '').trim() : '(没开对话框)';
};
window.__rightClickImg = function (img) {
  var r = img.getBoundingClientRect();
  img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
    clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  return { mode: toolboxMenuMode, target: !!toolboxImgMenuTarget,
           items: toolboxMenuItems().map(function (it) { return it.label || '—'; }) };
};
window.__stackItemCaps = function (row) {
  var out = [];
  var cells = row.children || [];
  for (var i = 0; i < cells.length; i++) {
    var sp = cells[i].querySelectorAll ? cells[i].querySelectorAll('span') : [];
    var cap = '';
    for (var k = 0; k < sp.length; k++) {
      if (!sp[k].getAttribute('data-tb-display')) { cap = String(sp[k].textContent || '').trim(); break; }
    }
    out.push(cap);
  }
  return out;
};
// 并排那一行的**容器**（不是里面每张图的 flex 小框：那些也是 display:flex）
window.__stackRow = function () {
  var img = toolboxTpl.editor.querySelector('img');
  return (img && toolboxStackRowOf(img, toolboxTpl.editor)) || null;
};
window.__blocks = function () {
  return Array.prototype.map.call(toolboxTpl.editor.children, function (c) { return c.tagName; }).join(',');
};
window.__dialogsOpen = function () { return toolboxTpl.dialog.style.display !== 'none'; };
// 正文区里"最后一块下方的空白"坐标（点不到就返回 null）
// ★ 先把编辑区滚到底：前面几节把内容撑长了，不滚到底时"最后一块"可能根本不在可视区里，
//   算出来的坐标会点到别的地方（这一节第一次就是因此判红的）。
window.__belowLast = function () {
  var ed = toolboxTpl.editor;
  ed.scrollTop = ed.scrollHeight;
  var last = ed.lastElementChild;
  if (!last) return null;
  var r = ed.getBoundingClientRect(), b = last.getBoundingClientRect();
  var y = Math.round((b.bottom + r.bottom) / 2);
  if (!(y > b.bottom + 2)) return null;
  return { x: Math.round((r.left + r.right) / 2), y: y };
};
window.__rootBrs = function () {
  var ed = toolboxTpl.editor, n = 0;
  for (var i = 0; i < ed.childNodes.length; i++) {
    var c = ed.childNodes[i];
    if (c.nodeType === 1 && c.tagName === 'BR' && !c.getAttribute('data-tb-caret')) n++;
  }
  return n;
};
window.__recentText = function () { return String(toolboxTpl.editor.textContent || ''); };
window.__dialogTitle = function () {
  var t = document.querySelector('.tb-dialog-title');
  return t ? String(t.textContent || '').trim() : '(无)';
};
`;

await send('Page.navigate', { url: BASE + 'index.html' });
await sleep(4200);
await evaluate(PAGE_HELPERS);
await evaluate(`toolboxOpen();`);
await sleep(700);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n① 改图片路径 → 展位文字要重新检测');
// 用户那条路：图是"图片"按钮插进去的（alt 自动写成文件名），之后只改路径
const a1 = await J(`
  await window.__toEditor('<p>甲</p>');
  await window.__caretEnd();
  var html = toolboxImageBlock('readmes/image/old_name.jpg', '80%', '');
  toolboxInsertHtml(html);
  await __sleep(900);
  var img = toolboxTpl.editor.querySelector('img');
  var before = window.__phText(img);
  toolboxImgMenuTarget = img;
  toolboxImgEditDialog();
  await __sleep(300);
  var title = window.__dlgTitle();
  var preAlt = (document.getElementById('tbF_alt') || {}).value;
  window.__setField('src', 'readmes/image/new_name.png');
  window.__setField('alt', preAlt);
  toolboxDialogOk();
  await __sleep(900);
  var img2 = toolboxTpl.editor.querySelector('img');
  return { before: before, title: title, preAlt: preAlt,
           after: window.__phText(img2),
           alt: String(img2.getAttribute('alt') || ''),
           code: window.__code() };
`);
ok(a1.before === 'old_name.jpg', `① 插入后展位文字 = 旧文件名（实测 ${JSON.stringify(a1.before)}）`);
ok(/修改图片/.test(a1.title), `① 打开的是单图参数对话框（${a1.title}）`);
ok(a1.preAlt === 'old_name.jpg', `① 对话框预填的 alt = 旧文件名（${JSON.stringify(a1.preAlt)}）`);
ok(a1.after === 'new_name.png', `① 只改路径后展位文字跟着变 = 新文件名（实测 ${JSON.stringify(a1.after)}）`);
ok(a1.alt === 'new_name.png', `① 节点的 alt 也同步成新文件名（${JSON.stringify(a1.alt)}）`);
ok(/alt="new_name\.png"/.test(a1.code), '① 代码区里 alt 也是新文件名');

// 手写的 alt 不许被改掉
const a2 = await J(`
  await window.__toEditor('<p>甲</p>');
  await window.__caretEnd();
  toolboxInsertHtml(toolboxImageBlock('readmes/image/keep_me.jpg', '80%', ''));
  await __sleep(800);
  var img = toolboxTpl.editor.querySelector('img');
  img.setAttribute('alt', '这张是手写的说明');
  toolboxRefresh(); await __sleep(400);
  toolboxImgMenuTarget = img;
  toolboxImgEditDialog(); await __sleep(300);
  var preAlt = (document.getElementById('tbF_alt') || {}).value;
  window.__setField('src', 'readmes/image/other.png');
  window.__setField('alt', preAlt);
  toolboxDialogOk(); await __sleep(900);
  var img2 = toolboxTpl.editor.querySelector('img');
  return { preAlt: preAlt, alt: String(img2.getAttribute('alt') || ''), ph: window.__phText(img2) };
`);
ok(a2.preAlt === '这张是手写的说明', `① 手写 alt 原样预填（${JSON.stringify(a2.preAlt)}）`);
ok(a2.alt === '这张是手写的说明', `① 改路径不动手写 alt（${JSON.stringify(a2.alt)}）`);
ok(a2.ph === '这张是手写的说明', `① 展位文字用手写 alt（${JSON.stringify(a2.ph)}）`);

// 清空 alt → 节点上就是**显式不带 alt**（用户清空了就是不要），而展位文字仍旧按新路径重算
const a3 = await J(`
  await window.__toEditor('<p>甲</p>');
  await window.__caretEnd();
  toolboxInsertHtml(toolboxImageBlock('readmes/image/aa.jpg', '80%', ''));
  await __sleep(800);
  var img = toolboxTpl.editor.querySelector('img');
  toolboxImgMenuTarget = img;
  toolboxImgEditDialog(); await __sleep(300);
  window.__setField('alt', '');
  window.__setField('src', 'readmes/image/bb.png');
  toolboxDialogOk(); await __sleep(900);
  var img2 = toolboxTpl.editor.querySelector('img');
  return { alt: String(img2.getAttribute('alt') || ''), has: img2.hasAttribute('alt'), ph: window.__phText(img2) };
`);
ok(!a3.has && a3.ph === 'bb.png', `① 清空 alt：节点上不带 alt（has=${a3.has}），展位文字按新路径重算（${JSON.stringify(a3.ph)}）`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n② 复制左侧的表格粘贴 → 样式要跟着来');
const b1 = await J(`
  var st = document.createElement('style');
  st.textContent = '.probe-table { border-collapse: collapse; width: 100%; }\\n'
    + '.probe-table th, .probe-table td { border: 1px solid #999; padding: 0.4rem; text-align: center; }';
  document.head.appendChild(st);
  var host = document.createElement('div'); host.id = 'leftPane';
  host.innerHTML = '<div style="overflow-x:auto;margin:1rem 0;">'
    + '<table class="probe-table"><thead><tr><th>列一</th><th>列二</th></tr></thead>'
    + '<tbody><tr><td>甲</td><td>乙</td></tr></tbody></table></div>';
  document.body.appendChild(host);
  await window.__toEditor('<p>上面一段</p>');
  var c = document.getElementById('tbCode');
  c.focus(); c.setSelectionRange(c.value.length, c.value.length);
  var dt = new DataTransfer();
  dt.setData('text/html', host.innerHTML);
  dt.setData('text/plain', '列一\\t列二\\n甲\\t乙');
  c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await __sleep(1500);
  var t = toolboxTpl.editor.querySelector('table');
  return { code: c.value,
           cssBlocks: (c.value.match(/<style/g) || []).length,
           hasRule: c.value.indexOf('.probe-table') >= 0,
           cls: t ? String(t.getAttribute('class') || '(被剥掉)') : '(无表)',
           collapse: t ? getComputedStyle(t).borderCollapse : '(无)',
           tdBorder: t ? getComputedStyle(t.querySelector('td')).borderTopWidth : '(无)',
           tdAlign: t ? getComputedStyle(t.querySelector('td')).textAlign : '(无)',
           text: t ? String(t.textContent || '') : '' };
`);
ok(b1.hasRule, '② 粘贴后的代码里带上了 .probe-table 的规则');
ok(b1.cssBlocks === 1, `② 只带了一个 <style> 块（实测 ${b1.cssBlocks} 个）`);
ok(b1.cls === 'probe-table', `② 表格的 class 没被剥掉（${JSON.stringify(b1.cls)}）`);
ok(b1.collapse === 'collapse', `② 规则真的生效：border-collapse=${b1.collapse}`);
ok(b1.tdBorder === '1px', `② 单元格边框生效（${b1.tdBorder}）`);
ok(b1.tdAlign === 'center', `② 单元格对齐生效（${b1.tdAlign}）`);
ok(b1.text.indexOf('甲') >= 0 && b1.text.indexOf('乙') >= 0, '② 表格内容一个字没丢');

const b2 = await J(`
  var host = document.getElementById('leftPane');
  var c = document.getElementById('tbCode');
  c.focus(); c.setSelectionRange(c.value.length, c.value.length);
  var dt = new DataTransfer();
  dt.setData('text/html', host.innerHTML);
  dt.setData('text/plain', '列一\\t列二\\n甲\\t乙');
  c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await __sleep(1200);
  return { cssBlocks: (c.value.match(/<style/g) || []).length, tables: (c.value.match(/<table/g) || []).length };
`);
ok(b2.cssBlocks === 1, `② 再粘一次不会重复带规则（style 块仍是 ${b2.cssBlocks} 个）`);
ok(b2.tables === 2, `② 两次粘贴两张表（${b2.tables} 张）`);

const b3 = await evaluate(`toolboxClipboardHtmlToSource('<html><body><style>.x{color:red}</style><p>甲</p></body></html>')`);
ok(/<style/.test(b3), `② 剪贴板 HTML 自带的 <style> 不再被删掉（${JSON.stringify(b3)}）`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n③ 末尾插图不留空壳 + 删空行不连坐');
const c1 = await J(`
  await window.__toEditor('<p>上一段</p>');
  await __sleep(1000);
  await window.__caretEnd();
  toolboxInsertHtml(toolboxImageBlock('readmes/image/end_probe.png', '80%', ''));
  await __sleep(900);
  var ed = toolboxTpl.editor;
  return { code: window.__code(),
           blocks: window.__blocks(),
           emptyP: ed.querySelectorAll('p').length };
`);
ok(!/<p><\/p>/.test(c1.code), `③ 插图后代码里没有空段落：${JSON.stringify(c1.code.slice(-70))}`);
ok(c1.blocks === 'P,CENTER', `③ 编辑区就两块：段落 + 图片块（${c1.blocks}）`);

const c2 = await J(`
  await window.__toEditor('<p>上一段</p>\\n<center><img src="readmes/image/probe_x.png" width="80%" alt="probe_x.png"></center>\\n<br>');
  await __sleep(600);
  var ed = toolboxTpl.editor, br = null;
  for (var i = 0; i < ed.childNodes.length; i++) {
    var n = ed.childNodes[i];
    if (n.nodeType === 1 && n.tagName === 'BR') { br = n; break; }
  }
  if (!br) return { clicked: false };
  var r = br.getBoundingClientRect();
  return { clicked: true, x: Math.round(r.left + 40), y: Math.round(r.top + Math.max(2, r.height / 2)) };
`);
ok(c2.clicked, '③ 找到了那根空行的 <br>');
if (c2.clicked) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c2.x, y: c2.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c2.x, y: c2.y, button: 'left', clickCount: 1 });
  await sleep(320);
  await Backspace();
}
const c3 = await J(`
  var ed = toolboxTpl.editor;
  return { imgs: ed.querySelectorAll('img').length,
           brs: (function () { var n = 0; for (var i = 0; i < ed.childNodes.length; i++) { var c = ed.childNodes[i]; if (c.nodeType === 1 && c.tagName === 'BR') n++; } return n; })(),
           code: window.__code() };
`);
ok(c3.imgs === 1, `③ 点空行退格后图片还在（${c3.imgs} 张）`);
ok(c3.brs === 0, `③ 那根空行被删掉了（根上剩 ${c3.brs} 根 <br>）`);
ok(/probe_x\.png/.test(c3.code), '③ 代码里图片也还在');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n④ 表格内换行');
const SHAPES = [
  ['裸表', '<table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>'],
  ['div 包一层', '<div style="overflow-x:auto;margin:1rem 0;"><table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table></div>'],
  ['div+center', '<div style="overflow-x:auto;margin:1rem 0;"><center><table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table></center></div>']
];
for (const [name, html] of SHAPES) {
  const r = await J(`
    await window.__toEditor(${JSON.stringify(html)});
    await __sleep(600);
    var cell = toolboxTpl.editor.querySelector('td');
    await window.__caretIn(cell, cell.childNodes.length);
    await __sleep(200);
    return { tables: toolboxTpl.editor.querySelectorAll('table').length,
             cells: toolboxTpl.editor.querySelectorAll('td').length,
             cellHtml: String(cell.innerHTML) };
  `);
  await Enter();
  const r2 = await J(`
    var cell = toolboxTpl.editor.querySelector('td');
    return { tables: toolboxTpl.editor.querySelectorAll('table').length,
             cells: toolboxTpl.editor.querySelectorAll('td').length,
             cellHtml: String(cell.innerHTML), code: window.__code() };
  `);
  ok(r2.tables === 1, `④ [${name}] 回车没有拆表（表 ${r.tables}→${r2.tables} 张）`);
  ok(r2.cells === 2, `④ [${name}] 单元格数不变（${r.cells}→${r2.cells}）`);
  ok(/<br/.test(r2.cellHtml), `④ [${name}] 单元格里插出 <br>（${JSON.stringify(r2.cellHtml)}）`);
  ok(!/<p[ >]/.test(r2.code.replace(/<p>甲<\/p>/g, '')), `④ [${name}] 没有把单元格内容甩成 <p>`);
  // 打字必须落在换行之后
  await type('第二行');
  const r3 = await J(`var cell = toolboxTpl.editor.querySelector('td');
    return { cellHtml: String(cell.innerHTML), code: window.__code() };`);
  ok(/甲<br>第二行/.test(r3.cellHtml), `④ [${name}] 打字落在换行之后（${JSON.stringify(r3.cellHtml)}）`);
  ok(/<td>甲<br>第二行<\/td>/.test(r3.code), `④ [${name}] 代码里是 <td>甲<br>第二行</td>`);
}

const d2 = await J(`
  await window.__toEditor('<table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>');
  await __sleep(600);
  var cell = toolboxTpl.editor.querySelector('td');
  await window.__caretIn(cell, cell.childNodes.length);
  return { start: String(cell.innerHTML) };
`);
await Enter(); await Enter();
const d3 = await J(`
  var cell = toolboxTpl.editor.querySelector('td');
  var code = window.__code();
  var again = (function () { toolboxRefresh(); return window.__code(); })();
  return { cellHtml: String(cell.innerHTML), code: code, again: again,
           tables: toolboxTpl.editor.querySelectorAll('table').length };
`);
ok(/甲<br><br/.test(d3.cellHtml), `④ 连按两次回车 = 两个换行（${JSON.stringify(d3.cellHtml)}）`);
ok(d3.tables === 1, '④ 连按两次回车表还在');
ok(d3.again === d3.code, '④ 表格内换行之后导出是幂等的');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⑤ 多图一行：右键给的是多图参数');
const e1 = await J(`
  var rowHtml = toolboxStackRowHtml([{ src: 'readmes/image/s1.png', caption: '' }, { src: 'readmes/image/s2.png', caption: '' }],
    'height', '180px', '整行图注');
  await window.__toEditor('<p>上面一段</p>' + rowHtml);
  await __sleep(900);
  var img = toolboxTpl.editor.querySelector('img');
  var rc = window.__rightClickImg(img);
  return { items: rc.items, mode: rc.mode, target: rc.target,
           isRow: !!toolboxStackRowOf(img, toolboxTpl.editor) };
`);
ok(e1.isRow, '⑤ 右键的那张图被认出在并排行里');
ok(e1.items.indexOf('修改图片参数') >= 0, `⑤ 菜单项里有「修改图片参数」（${JSON.stringify(e1.items)}）`);
ok(e1.items.filter(x => /%$/.test(x)).length === 0, '⑤ 多图行不列单图专属的宽度项');

const e2 = await J(`
  var img = toolboxTpl.editor.querySelector('img');
  toolboxImgMenuTarget = img;
  toolboxImgEditDialog();
  await __sleep(400);
  var v = TOOLBOX_DIALOGS.stackEdit.fill();
  return { title: window.__dlgTitle(), count: v.count, mode: v.mode, size: v.size,
           src1: v.src1, src2: v.src2, cap1: v.cap1, sharedCap: v.sharedCap,
           labels: TOOLBOX_DIALOGS.stackEdit.fields.map(function (f) { return f.label; }) };
`);
ok(e2.title === '修改图片参数', `⑤ 多图行打开的对话框标题 = 修改图片参数（${e2.title}）`);
ok(e2.count === '2', `⑤ 预填张数 = 2（${e2.count}）`);
ok(e2.mode === 'height' && e2.size === '180px', `⑤ 预填尺寸模式/尺寸 = ${e2.mode}/${e2.size}`);
ok(e2.src1 === 'readmes/image/s1.png' && e2.src2 === 'readmes/image/s2.png', '⑤ 预填每张图的路径');
ok(e2.sharedCap === '整行图注', `⑤ 预填整行图注（${JSON.stringify(e2.sharedCap)}）`);
ok(e2.labels.indexOf('图组注释') >= 0 && e2.labels.indexOf('第 4 张图片路径') >= 0, '⑤ 字段里有整行图注与每张图的路径/图注');

const e3 = await J(`
  var v = TOOLBOX_DIALOGS.stackEdit.fill();
  v.count = '3'; v.mode = 'width'; v.size = '80';
  v.src3 = 'readmes/image/s3.png'; v.cap1 = '第一张的图注'; v.sharedCap = '改过的整行图注';
  TOOLBOX_DIALOGS.stackEdit.apply(v);
  await __sleep(1000);
  var ed = toolboxTpl.editor;
  var row = window.__stackRow();                       // 容器本身（不是里面每张图的 flex 小框）
  var rows = 0;
  for (var i = 0; i < ed.children.length; i++) {
    if (ed.children[i].querySelector && ed.children[i].querySelector('img')) {
      if (toolboxStackRowOf(ed.children[i].querySelector('img'), ed) === ed.children[i]) rows++;
    }
  }
  var imgs = row ? row.querySelectorAll('img') : [];
  return { rows: rows, imgs: imgs.length,
           srcs: Array.prototype.map.call(imgs, function (i) { return String(i.getAttribute('src')).split('/').pop(); }),
           firstStyle: imgs[0] ? String(imgs[0].getAttribute('style')) : '',
           itemCaps: window.__stackItemCaps(row),
           caption: (function () { var m = row ? row.nextSibling : null; while (m && m.nodeType !== 1) m = m.nextSibling; return m ? String(m.textContent) : '(无)'; })(),
           capBlocks: (function () { var t = 0, m = row ? row.nextSibling : null; while (m) { if (m.nodeType === 1) t++; m = m.nextSibling; } return t; })(),
           code: window.__code() };
`);
ok(e3.rows === 1, `⑤ 改参数后还是一条并排行（${e3.rows} 条）`);
ok(e3.imgs === 3, `⑤ 张数改成 3 生效（${e3.imgs} 张）`);
ok(e3.srcs.join(',') === 's1.png,s2.png,s3.png', `⑤ 三张图的路径都对（${e3.srcs.join(',')}）`);
ok(/width:\s*80%/.test(e3.firstStyle), `⑤ 同宽度 80% 写进了每张图（${e3.firstStyle}）`);
ok(e3.itemCaps[0] === '第一张的图注', `⑤ 单张图注写进去了（${JSON.stringify(e3.itemCaps)}）`);
ok(e3.caption === '改过的整行图注', `⑤ 整行图注换成了新值（${JSON.stringify(e3.caption)}）`);
ok(e3.capBlocks === 1, `⑤ 整行图注只留一块（${e3.capBlocks} 块）`);
ok(/width:80%/.test(e3.code) && /display:flex/.test(e3.code), '⑤ 代码区里这条并排行是新参数');

// 单图仍旧是单图界面
const e4 = await J(`
  await window.__toEditor('<p>甲</p><center><img src="readmes/image/one.png" width="80%" alt="one.png"></center>');
  await __sleep(900);
  var img = toolboxTpl.editor.querySelector('img');
  var rc = window.__rightClickImg(img);
  toolboxImgMenuTarget = img;
  toolboxImgEditDialog();
  await __sleep(300);
  return { items: rc.items, title: window.__dlgTitle(),
           fields: TOOLBOX_DIALOGS.imgEdit.fields.map(function (f) { return f.key; }) };
`);
ok(e4.items.indexOf('修改图片参数') >= 0, `⑤ 单图菜单照旧（${JSON.stringify(e4.items)}）`);
ok(e4.title === '修改图片', `⑤ 单图给的是单图那套字段（标题「${e4.title}」，字段 ${JSON.stringify(e4.fields)}）`);
ok(e4.fields.indexOf('src') >= 0 && e4.fields.indexOf('count') < 0, '⑤ 单图对话框里没有多图的张数/尺寸字段');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⑥ 末尾插表格后能接着另起一行');
const f1 = await J(`
  window.__errs.length = 0;
  await window.__toEditor('<p>上一段</p>');
  await window.__caretEnd();
  toolboxInsertHtml(toolboxBuildTable(2, 2, true));
  await __sleep(1000);
  return { code: window.__code(), where: window.__where() };
`);
ok(/<\/table>/.test(f1.code), '⑥ 表格插进去了');
ok(f1.where.node === '(根)' || f1.where.node === 'DIV', `⑥ 插入后光标停在表格后面（${JSON.stringify(f1.where)}）`);
await Enter();
const f2 = await J(`return { errs: window.__errs.slice(), where: window.__where(),
  blocks: Array.prototype.map.call(toolboxTpl.editor.children, function (c) { return c.tagName; }).join(',') };`);
ok(f2.errs.length === 0, `⑥ 表格后面按回车不报错（${JSON.stringify(f2.errs)}）`);
ok(f2.where.node === 'P', `⑥ 回车给出了新的一段可写（${JSON.stringify(f2.where)}）`);
await type('表格之后');
const f3 = await J(`return { code: window.__code(), errs: window.__errs.slice() };`);
ok(/<p>表格之后<\/p>/.test(f3.code), `⑥ 接着打字落在表格后面（${JSON.stringify(f3.code.slice(-40))}）`);
ok(f3.errs.length === 0, '⑥ 全程没有异常');

const f4 = await J(`
  await window.__toEditor('<p>上一段</p>');
  await __sleep(800);
  await window.__caretEnd();
  toolboxInsertHtml(toolboxBuildTable(2, 2, true));
  await __sleep(1000);
  return { code: window.__code(), blocks: window.__blocks() };
`);
await Enter();
await sleep(300);
const f4b = await J(`return { blocks: window.__blocks(), where: window.__where() };`);
await Enter();
await sleep(300);
const f5 = await J(`return { code: window.__code(), blocks: window.__blocks(), errs: window.__errs.slice() };`);
ok(f4b.blocks.split(',').filter(x => x === 'P').length === 2, `⑥ 第一次回车开出一个空段（${f4b.blocks}）`);
ok(f5.blocks.indexOf('BR') > f5.blocks.indexOf('DIV'), `⑥ 第二次回车把空段升格成空行（${f5.blocks}）`);
ok(f5.code.replace(f4.code, '') === '\n<br>', `⑥ 代码区在表格后面多了一根 <br>（${JSON.stringify(f5.code.slice(f4.code.length))}）`);
ok(f5.errs.length === 0, '⑥ 连按两次回车也没有异常');

// 图片那条路同样成立
const f6 = await J(`
  await window.__toEditor('<p>上一段</p>');
  await window.__caretEnd();
  toolboxInsertHtml(toolboxImageBlock('readmes/image/end2.png', '80%', ''));
  await __sleep(900);
  return { code: window.__code() };
`);
await Enter();
await type('图片之后');
const f7 = await J(`return { code: window.__code(), errs: window.__errs.slice() };`);
ok(/<p>图片之后<\/p>/.test(f7.code), '⑥ 图片块后面也能接着另起一行打字');
ok(f7.errs.length === 0, '⑥ 图片这条路也没有异常');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⑦ 弹窗里选字拖到外面 → 弹窗不许关');
const g0 = await J(`
  await window.__toEditor('<p>甲</p>');
  await __sleep(700);
  toolboxOpenDialog('image');
  await __sleep(400);
  var inp = document.getElementById('tbF_src');
  inp.value = 'readmes/image/abc.png';
  var r = inp.getBoundingClientRect();
  var d = toolboxTpl.dialog.getBoundingClientRect();
  var m = document.getElementById('toolboxModal').getBoundingClientRect();
  return { open: window.__dialogsOpen(),
           inL: Math.round(r.left + 4), inR: Math.round(r.right - 4), inY: Math.round(r.top + r.height / 2),
           dlgR: Math.round(d.right - 4), dlgB: Math.round(d.bottom - 4),
           maskX: Math.round(m.left + 6), maskY: Math.round(m.top + 6) };
`);
ok(g0.open, '⑦ 图片对话框开着');

// ① 在输入框里按住往左拖（选字），松手落到遮罩上 —— click 的落点会变成遮罩
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g0.inR, y: g0.inY, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g0.inL, y: g0.inY, button: 'left' });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g0.maskX, y: g0.maskY, button: 'left' });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g0.maskX, y: g0.maskY, button: 'left', clickCount: 1 });
await sleep(500);
const g1 = await J(`return { open: window.__dialogsOpen(), title: window.__dialogTitle() };`);
ok(g1.open, `⑦ 选字松手到遮罩上：弹窗还在（${g1.title}）`);

// ② 在输入框里起手，松到弹窗自己的空白处 —— click 的落点会变成弹窗本身
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g0.inL, y: g0.inY, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g0.dlgR, y: g0.dlgB, button: 'left' });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g0.dlgR, y: g0.dlgB, button: 'left', clickCount: 1 });
await sleep(500);
const g2 = await J(`return { open: window.__dialogsOpen() };`);
ok(g2.open, '⑦ 选字松手到弹窗空白处：弹窗还在');

// ③ 真的点弹窗空白处（按下、松开在同一处）→ 照旧关掉
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g0.dlgR, y: g0.dlgB, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g0.dlgR, y: g0.dlgB, button: 'left', clickCount: 1 });
await sleep(500);
const g3 = await J(`return { open: window.__dialogsOpen() };`);
ok(!g3.open, '⑦ 原位点弹窗空白处：照旧关掉（这条不能一起改坏）');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⑧ 多图的路径/图注按数量动态生成');
const h1 = await J(`
  toolboxOpenDialog('stack');
  await __sleep(400);
  var vis = function () {
    var out = [];
    for (var i = 1; i <= 4; i++) {
      var el = document.getElementById('tbF_src' + i);
      var box = el ? el.closest('.tb-field') : null;
      if (box && box.style.display !== 'none') out.push(i);
    }
    return out;
  };
  var cin = document.getElementById('tbF_count');
  var open2 = vis();
  cin.value = '3'; cin.dispatchEvent(new Event('input', { bubbles: true }));
  var after3 = vis();
  var el3 = document.getElementById('tbF_cap3');
  var box3 = el3 ? el3.closest('.tb-field') : null;
  var show3 = box3 ? box3.style.display !== 'none' : false;
  cin.value = '4'; cin.dispatchEvent(new Event('input', { bubbles: true }));
  var after4 = vis();
  cin.value = '2'; cin.dispatchEvent(new Event('input', { bubbles: true }));
  var after2 = vis();
  cin.value = ''; cin.dispatchEvent(new Event('input', { bubbles: true }));
  var afterEmpty = vis();
  return { open2: open2, after3: after3, after4: after4, after2: after2, afterEmpty: afterEmpty, cap3Shown: show3 };
`);
ok(h1.open2.join(',') === '1,2', `⑧ 默认 2 张：只摆出第 1、2 张的路径（${JSON.stringify(h1.open2)}）`);
ok(h1.after3.join(',') === '1,2,3', `⑧ 填 3：第 3 张的路径出现（${JSON.stringify(h1.after3)}）`);
ok(h1.cap3Shown, '⑧ 填 3：第 3 张的图注也出现');
ok(h1.after4.join(',') === '1,2,3,4', `⑧ 填 4：四张都出现（${JSON.stringify(h1.after4)}）`);
ok(h1.after2.join(',') === '1,2', `⑧ 改回 2：第 3、4 张收起来（${JSON.stringify(h1.after2)}）`);
ok(h1.afterEmpty.join(',') === '1,2', `⑧ 留空：按默认 2 张（${JSON.stringify(h1.afterEmpty)}）`);

const h2 = await J(`
  var v = TOOLBOX_DIALOGS.stackEdit.fill ? {} : {};
  toolboxCloseDialog();
  var rowHtml = toolboxStackRowHtml([{ src: 'readmes/image/s1.png', caption: '' }, { src: 'readmes/image/s2.png', caption: '' }],
    'height', '180px', '');
  await window.__toEditor('<p>甲</p>' + rowHtml);
  await __sleep(900);
  var img = toolboxTpl.editor.querySelector('img');
  toolboxImgMenuTarget = img;
  toolboxImgEditDialog();
  await __sleep(400);
  var vis = function () {
    var out = [];
    for (var i = 1; i <= 4; i++) {
      var el = document.getElementById('tbF_src' + i);
      var box = el ? el.closest('.tb-field') : null;
      if (box && box.style.display !== 'none') out.push(i);
    }
    return out;
  };
  var before = vis();
  var cin = document.getElementById('tbF_count');
  cin.value = '4'; cin.dispatchEvent(new Event('input', { bubbles: true }));
  var after = vis();
  return { title: window.__dlgTitle(), before: before, after: after };
`);
ok(h2.title === '修改图片参数' && h2.before.join(',') === '1,2', `⑧ 修改多图参数时也按数量收放（默认 ${JSON.stringify(h2.before)}）`);
ok(h2.after.join(',') === '1,2,3,4', `⑧ 改成 4 张：四格都出现（${JSON.stringify(h2.after)}）`);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n⑨ 文章末尾没有空行时，点末尾空白处要自动补一个空行');
{
  const spot = await J(`
    toolboxCloseDialog();                    // ★ 上一节把对话框留着没关：不关的话点击会打在弹窗上
    await window.__toEditor('<p>上一段</p>' + '<div style="overflow-x:auto;margin:1rem 0;"><table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table></div>');
    await __sleep(1000);
    return { spot: window.__belowLast(), brs: window.__rootBrs(), code: window.__code() };
  `);
  ok(!!spot.spot, '⑨ 正文区里确实有"最后一块下方的空白"可点');
  if (spot.spot) {
    const hit = await J(`var el = document.elementFromPoint(${spot.spot.x}, ${spot.spot.y});
      return { hit: el ? (el.id || el.tagName) : '(空)', x: ${spot.spot.x}, y: ${spot.spot.y} };`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.spot.x, y: spot.spot.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.spot.x, y: spot.spot.y, button: 'left', clickCount: 1 });
    await sleep(500);
    const i1 = await J(`return { brs: window.__rootBrs(), code: window.__code(), blocks: window.__blocks(), where: window.__where(),
      kids: Array.prototype.map.call(toolboxTpl.editor.childNodes, function (c) { return c.nodeType === 1 ? (c.tagName + (c.getAttribute('data-tb-caret') ? '(托)' : '')) : '#t'; }).join(',') };`);
    ok(i1.brs === 1 && /\n<br>$/.test(i1.code),
      `⑨ 点一下就在末尾补出一个空行（根级 <br> ${spot.brs}→${i1.brs}；点击命中 ${hit.hit} @${hit.x},${hit.y}；代码尾 ${JSON.stringify(i1.code.slice(-14))}）`);
    ok(i1.where.node === '(根)', `⑨ 光标停在空行下面（${JSON.stringify(i1.where)}）`);
    // 再点一次：不许越点越多
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.spot.x, y: spot.spot.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.spot.x, y: spot.spot.y, button: 'left', clickCount: 1 });
    await sleep(400);
    const i2 = await J(`return { brs: window.__rootBrs(), code: window.__code() };`);
    ok(i2.brs === 1 && i2.code === i1.code, `⑨ 反复点末尾空白不会越加越多（根级 <br> ${i1.brs}→${i2.brs} 根）`);
    // 打字落在空行下面、自成一段
    await send('Input.insertText', { text: '末尾接着写' });
    await sleep(700);
    const i3 = await J(`return { code: window.__code(), blocks: window.__blocks() };`);
    ok(/<p>末尾接着写<\/p>/.test(i3.code), `⑨ 接着打字自成一段（${JSON.stringify(i3.code.slice(-24))}）`);
    ok(i3.blocks === 'P,DIV,P', `⑨ 编辑区结构：段落 + 表格 + 新段落（${i3.blocks}）`);
  }
}

// 点正文内容（不在末尾空白）不许乱加空行
{
  const j1 = await J(`
    await window.__toEditor('<p>上一段</p><center><img src="readmes/image/z.png" width="80%" alt="z.png"></center>');
    await __sleep(1000);
    var p = toolboxTpl.editor.querySelector('p');
    var r = p.getBoundingClientRect();
    return { before: window.__code(), brs: window.__rootBrs(),
             x: Math.round(r.left + 8), y: Math.round(r.top + r.height / 2) };
  `);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: j1.x, y: j1.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: j1.x, y: j1.y, button: 'left', clickCount: 1 });
  await sleep(400);
  const j2 = await J(`return { brs: window.__rootBrs(), code: window.__code() };`);
  ok(j2.brs === j1.brs && j2.code === j1.before, `⑨ 点正文内容里不会凭空加空行（根级 <br> 仍是 ${j2.brs} 根）`);
}

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
ws.close(); child.kill(); server.close();
process.exit(fail === 0 ? 0 : 1);
