// 编辑器「标题层级 hx」按钮验证：collection/tools/tests/verify-toolbox-hx.mjs
// 用户要求（原话）：
//   · "最好在文章编辑器里面加上这几个选项按钮，但是不应该与原有的'标题'样式重复，
//      因为这个标题是原生的 html 格式，你可以加在 BIUS 上下标那一块，可以让用户选择具体是几级标题"；
//   · "HTML 标准标题标签一共支持 6 级：<h1> 到 <h6>"；
//   · "你就在 BIUS 上下标那一块加一个 hx 的按钮表示选择标题的层级"。
// 与「标题」按钮的分工是本用例的重点：那个是文字类型（<p> + 字号加粗），这个必须写**原生标签**，
// 因为文章目录只认 <h1>~<h6>（verify-article-toc.mjs 守着另一半）。
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const skip = m => { skipped++; console.log(`  ○ 跳过 ${m}`); };

const ROOT = process.cwd();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, p);
    if (!existsSync(full) || statSync(full).isDirectory()) { res.writeHead(404).end('nf'); return; }
    const buf = readFileSync(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) { res.writeHead(500).end(String(e.message)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/collection/index.html`;

const chromePath = (process.env.CHROME_PATH ? [process.env.CHROME_PATH] : [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`, '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']).find(p => p && existsSync(p));
if (!chromePath) { console.log('  ✗ 找不到 Chrome：请设置 CHROME_PATH'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpHx-'));
const DP = 17530;
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch { } await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text + ' ' + (m.params.exceptionDetails?.exception?.description || '')); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const J = async e => JSON.parse(await evaluate(`(async()=>JSON.stringify(await(async()=>{ ${e} })()))()`));
await send('Runtime.enable'); await send('Page.enable');

await send('Page.navigate', { url: `${BASE}?t=${Date.now()}` });
for (let i = 0; i < 140; i++) {
  const r = await evaluate(`(()=>typeof toolboxOpen==='function' && document.readyState==='complete')()`).catch(() => false);
  if (r) break; await sleep(120);
}
await sleep(900);
await evaluate(`toolboxOpen();`);
await sleep(800);

await evaluate(`
window.__toEditor = async function (html) {
  toolboxTpl.editor.innerHTML = html;
  toolboxRefresh();
  await new Promise(r => setTimeout(r, 60));
  return 1;
};
window.__caretIn = async function (sel, off) {
  var ed = toolboxTpl.editor;
  var el = ed.querySelector(sel);
  if (!el) return 0;
  var tn = null;
  (function find(n) {
    for (var i = 0; i < n.childNodes.length; i++) {
      var c = n.childNodes[i];
      if (c.nodeType === 3 && c.nodeValue.length) { tn = c; return true; }
      if (c.nodeType === 1 && find(c)) return true;
    }
    return false;
  })(el);
  if (!tn) return 0;
  var r = document.createRange();
  r.setStart(tn, Math.min(off || 0, tn.nodeValue.length));
  r.collapse(true);
  ed.focus();
  var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  toolboxStoreRangeNow();
  toolboxSyncToolbarState();
  await new Promise(x => setTimeout(x, 40));
  return 1;
};
window.__rangeAcross = async function (selA, selB) {
  var ed = toolboxTpl.editor;
  var a = ed.querySelector(selA), b = ed.querySelector(selB);
  if (!a || !b) return 0;
  var ta = a.firstChild, tb = b.firstChild;
  var r = document.createRange();
  r.setStart(ta, 0); r.setEnd(tb, tb.nodeValue.length);
  ed.focus();
  var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  toolboxStoreRangeNow();
  toolboxSyncToolbarState();
  await new Promise(x => setTimeout(x, 40));
  return 1;
};
window.__click = async function (sel) { var b = document.querySelector(sel); if (!b) return 0; b.click(); await new Promise(x => setTimeout(x, 160)); return 1; };
window.__blocks = function () { return [].map.call(toolboxTpl.editor.children, function (c) { return c.tagName; }); };
window.__texts = function () { return [].map.call(toolboxTpl.editor.children, function (c) { return String(c.textContent || ''); }); };
window.__hxBtn = function () { var b = document.querySelector('[data-tb="hx"]'); return b ? { label: b.textContent, active: b.classList.contains('active'), lv: b.getAttribute('data-hx-level') } : null; };
`);

// ─────────── ① 按钮与面板 ───────────
console.log('══════ ① hx 按钮与层级面板 ══════\n');
const btns = await J(`return {
  hx: !!document.querySelector('[data-tb="hx"]'),
  nearSup: (function(){ var sup=document.querySelector('[data-tb="sup"]'); var hx=document.querySelector('[data-tb="hx"]');
    return !!(sup && hx && sup.parentNode === hx.closest('.tb-toolbar')); })(),
  title: !!document.querySelector('[data-tb="title"]'),
  items: [].map.call(document.querySelectorAll('.tb-hx-item'), b=>b.getAttribute('data-tb')),
  menuHidden: document.getElementById('tbHxMenu').hidden,
  label: (document.querySelector('[data-tb="hx"]')||{}).textContent };`);
ok(btns.hx, `① 工具栏里有 hx 按钮（初始文字「${btns.label}」）`);
ok(btns.nearSup, '① 它就在上标/下标那一带（同一个工具栏里，紧挨着）');
ok(btns.items.join(',') === 'hx-1,hx-2,hx-3,hx-4,hx-5,hx-6,hx-0', `① 面板里有 h1~h6 六个级别 + 段落（${btns.items.join(',')}）`);
ok(btns.menuHidden === true, '① 面板默认是收起的');
await evaluate(`document.querySelector('[data-tb="hx"]').click();`);
await sleep(200);
ok((await evaluate(`document.getElementById('tbHxMenu').hidden`)) === false, '① 点一下 hx 面板展开');
await evaluate(`document.querySelector('[data-tb="hx"]').click();`);
await sleep(200);
ok((await evaluate(`document.getElementById('tbHxMenu').hidden`)) === true, '① 再点一下收起');
ok(btns.title, '① 原有的「标题」按钮还在（没有被这个新按钮顶掉）');

// ─────────── ② 六个级别都真的写原生标签 ───────────
console.log('\n══════ ② 六个级别都写原生 <h1>~<h6> ══════\n');
for (let lv = 1; lv <= 6; lv++) {
  await J(`await window.__toEditor('<p>甲段</p><p>乙段</p>'); await window.__caretIn('p', 1); return 1;`);
  await J(`return await window.__click('[data-tb="hx-${lv}"]');`);
  const r = await J(`return { blocks: window.__blocks(), texts: window.__texts(), hx: window.__hxBtn(),
    menuHidden: document.getElementById('tbHxMenu').hidden };`);
  ok(r.blocks[0] === 'H' + lv && r.blocks[1] === 'P' && r.texts[0] === '甲段' && r.texts[1] === '乙段',
    `② 光标在「甲段」上点 H${lv} → 第一块变成 <h${lv}>、文字没变、第二块仍是 <p>（${r.blocks.join('+')}）`);
  ok(r.hx && r.hx.label === 'h' + lv && r.hx.active === true, `② 按钮上直接显示当前级别（「${r.hx && r.hx.label}」并高亮）`);
  ok(r.menuHidden === true, '② 选完级别面板自己收起');
}

// ─────────── ③ 幂等 / 段落 / 跨段 / 撤回 ───────────
console.log('\n══════ ③ 幂等、回段落、跨段、撤回 ══════\n');
await J(`await window.__toEditor('<p>甲段</p>'); await window.__caretIn('p', 1); await window.__click('[data-tb="hx-3"]'); await window.__click('[data-tb="hx-3"]'); return 1;`);
const idem = await J(`return { html: toolboxTpl.editor.innerHTML, blocks: window.__blocks() };`);
ok(idem.blocks.join('') === 'H3' && (idem.html.match(/<h3/gi) || []).length === 1,
  `③ 同一级别点两次不会套两层（${idem.html}）`);
await J(`await window.__click('[data-tb="hx-0"]'); return 1;`);
const back = await J(`return { blocks: window.__blocks(), texts: window.__texts(), hx: window.__hxBtn() };`);
ok(back.blocks.join('') === 'P' && back.texts[0] === '甲段', `③ 点「段落」换回 <p>，文字原样（${back.blocks.join('+')}）`);
ok(back.hx && back.hx.label === 'hx' && back.hx.active === false, '③ 回到段落后按钮不再高亮、文字回到 hx');

await J(`await window.__toEditor('<p>甲段</p><p>乙段</p>'); await window.__rangeAcross('p', 'p:last-child'); return 1;`);
await J(`await window.__click('[data-tb="hx-2"]'); return 1;`);
const multi = await J(`return { blocks: window.__blocks(), texts: window.__texts() };`);
ok(multi.blocks.join('+') === 'H2+H2' && multi.texts.join('|') === '甲段|乙段',
  `③ 选中两段再点 H2 → 两块都换（${multi.blocks.join('+')}，文字 ${multi.texts.join('|')}）`);

await J(`await window.__toEditor('<p>甲段</p>'); await window.__caretIn('p', 1);
  // ★ 直接写 innerHTML **不会**进撤回栈（真实编辑每一步都会快照），所以这里补一次基线快照。
  //   不补的话，"撤回"退到的是上一个用例留下的状态，测的就不是这个按钮了（第一版就踩了这个）。
  toolboxSnapClear(); toolboxUndoPush(false); return 1;`);
const beforeUndo = await J(`return window.__blocks().join('');`);
ok(beforeUndo === 'P', `③ 改之前是 <p>（基线快照已入栈：${beforeUndo}）`);
await J(`await window.__click('[data-tb="hx-4"]'); return 1;`);
ok((await J(`return window.__blocks().join('')`)) === 'H4', '③ 点 H4 后是 <h4>');
await J(`toolboxUndoStep(-1); await new Promise(r=>setTimeout(r,200)); return 1;`);
const afterUndo = await J(`return { blocks: window.__blocks().join(''), texts: window.__texts().join('|') };`);
ok(afterUndo.blocks === 'P' && afterUndo.texts === '甲段',
  `③ 一次改层级 = 一条撤回记录（撤回后 <h4> → ${afterUndo.blocks}，文字 ${afterUndo.texts}）`);

// ─────────── ④ 与「标题」按钮不重复（用户点名的要求）───────────
console.log('\n══════ ④ 与原有「标题」样式不重复 ══════\n');
await J(`await window.__toEditor('<p>甲段</p>'); await window.__caretIn('p', 1); await window.__click('[data-tb="title"]'); return 1;`);
const byTitle = await J(`var ed=toolboxTpl.editor, c=ed.children[0];
  return { tag: c.tagName, html: c.outerHTML.slice(0,120), hxLabel: (window.__hxBtn()||{}).label };`);
ok(byTitle.tag === 'P', `④ 「标题」按钮只改样式、**不写原生标签**（标签仍是 <${byTitle.tag}>：${byTitle.html.slice(0, 70)}）`);
ok(byTitle.hxLabel === 'hx', '④ 所以按「标题」之后 hx 按钮不亮（两件事，互不冒充）');
await J(`await window.__click('[data-tb="hx-2"]'); return 1;`);
const both = await J(`return { tag: toolboxTpl.editor.children[0].tagName, hx: (window.__hxBtn()||{}).label };`);
ok(both.tag === 'H2' && both.hx === 'h2', `④ 同一个块上点 hx 才会变成原生 <h2>（现在 ${both.tag}，按钮 ${both.hx}）`);

// ─────────── ⑤ 表格骨架不许动；导入时标题标签要活着 ───────────
console.log('\n══════ ⑤ 表格骨架不动、导入保活 ══════\n');
await J(`await window.__toEditor('<table border="1"><tbody><tr><td>格一</td><td>格二</td></tr></tbody></table><p>表后段</p>'); return 1;`);
const beforeTbl = await J(`var t=toolboxTpl.editor.querySelector('table');
  return { rows: t.querySelectorAll('tr').length, cells: t.querySelectorAll('td').length };`);
await J(`await window.__caretIn('td', 1); await window.__click('[data-tb="hx-3"]'); return 1;`);
const afterTbl = await J(`var t=toolboxTpl.editor.querySelector('table');
  return { rows: t.querySelectorAll('tr').length, cells: t.querySelectorAll('td').length,
    hInTable: t.querySelectorAll('h1,h2,h3,h4,h5,h6').length, text: String(toolboxTpl.editor.textContent||'') };`);
ok(afterTbl.rows === beforeTbl.rows && afterTbl.cells === beforeTbl.cells && afterTbl.hInTable === 0,
  `⑤ 光标在单元格里点 H3：表格骨架一个标签都没换（${afterTbl.rows} 行 / ${afterTbl.cells} 格 / 表内标题 ${afterTbl.hInTable} 个）`);
ok(afterTbl.text.indexOf('格一') >= 0 && afterTbl.text.indexOf('格二') >= 0, '⑤ 单元格文字还在');

const san = await J(`var box=document.createElement('div');
  box.innerHTML='<h1>一</h1><h2>二</h2><h3>三</h3><h4>四</h4><h5>五</h5><h6>六</h6><blink>怪</blink>';
  sanitizeToolboxNode(box);
  return { kept: [].map.call(box.querySelectorAll('h1,h2,h3,h4,h5,h6'), h=>h.tagName), blink: box.querySelectorAll('blink').length, text: String(box.textContent||'') };`);
ok(san.kept.length === 6, `⑤ 导出/导入的白名单认得原生标题：h1~h6 全部保留（${san.kept.join(',')}）`);
ok(san.blink === 0 && san.text.indexOf('怪') >= 0, '⑤ 不在白名单里的标签照旧拆成纯文本（<blink> 没了、字还在）');

console.log(`\n  ──────── 通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} ────────`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 4).forEach(e => console.log('    ! ' + e.slice(0, 160)));
try { ws.close(); } catch { }
child.kill(); server.close();
process.exitCode = fail ? 1 : 0;
