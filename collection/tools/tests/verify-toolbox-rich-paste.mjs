// 验收：从网页/富文本"复制—粘贴"进来的段落，不许在段落之间凭空多出空行（根级 <br>）。
//
// 用户报的：文章 HTML 编辑器里，正文中"原本没有空行的图片"用着用着就全都多了空行；
//   他自己删掉之后还会再长出来（"似乎是我改了一点右侧的代码…是在对代码标准化的时候加上的"），
//   而这些空行**只出现在块与块的边界上**（他那篇文章里被删掉的 9 根，全在"图注块 → 图片块"之间）。
//
// 查下来不是排版器（toolboxFormatHtml 逐字幂等）、也不是代码区导入（代码区→编辑区→代码区
//   往返 0 差异），而是**粘贴**这条路上的一个口径错位：
//   · 浏览器把网页复制进剪贴板时，text/plain 这一份里**块级元素之间本来就是空行**
//     （`<p>甲</p><p>乙</p>` → 剪贴板文本 "甲\n\n乙"）；
//   · toolboxPastePlain 取的就是 text/plain，交给 toolboxPlainTextParas；
//   · 而那个函数的规则是用户给纯文本定的："**空行 = 段落分界，且分界处补一根独立 <br>**"
//     （手敲两次 Enter 的等价物）。
//   两条规则一撞：**每一个块边界都会被当成"用户故意留的空行"补一根 <br>** ——
//   图片/图注各自成块，于是"每张图都多出一个空行"。实测复现：4 段富文本粘贴 → 凭空 3 个根级 <br>。
//
// 修法（见 toolboxPlainTextParas 的 fromHtml）：剪贴板里**同时带 text/html** 时，
//   那份纯文本里的空行是复制方加的结构分隔，不是用户手敲的 —— 每段少算一个空行。
//   只带纯文本（记事本复制、自己敲）时口径一个字不改：空行仍然照旧变成独立 <br>。
//
// 本用例守四件事：
//   ① 富文本粘贴（text/html + text/plain）：段落结构保留，但**不许**凭空多出根级 <br>
//      （编辑区的、以及代码区里单独成行的，都要 0）；
//   ② 纯文本粘贴：用户的空行必须**照旧**保留（3 个空行 = 3 根 <br>）—— 修完不许把它一起改掉；
//   ③ 富文本里**真的**有两个空行（源里有个空的 <p>）：保留 1 个，不能一刀切全删掉；
//   ④ 不误伤：真实文章走"代码区导入"那条往返，代码区逐字不变。
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
const userDir = await mkdtemp(join(tmpdir(), 'cdpRichPaste-'));
const DP = 17460;
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

// 浏览器复制网页时剪贴板的两份内容：html 是块结构，plain 里"块与块之间是空行"
const RICH_HTML = '<p>第一段正文。</p><p><img src="readmes/image/a.jpg" width="80%"></p>'
  + '<p>图1 一件假钞的样张</p><p>第二段正文。</p>'
  + '<p><img src="readmes/image/b.jpg" width="80%"></p><p>图2 另一张样张</p>';
const RICH_TEXT = '第一段正文。\n\n图1 一件假钞的样张\n\n第二段正文。\n\n图2 另一张样张';

// 页面里用真正的 DataTransfer + ClipboardEvent 走一遍粘贴（不直接调内部函数）
const DEFINE_PASTE = `window.__paste = function (text, html) {
  var ed = toolboxTpl.editor;
  var dt = new DataTransfer();
  if (text) dt.setData('text/plain', text);
  if (html) dt.setData('text/html', html);
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
};`;
const PASTE = async (text, html) => J(`
  var ed = toolboxTpl.editor, code = document.getElementById('tbCode');
  ed.innerHTML = ''; toolboxRefresh(); await __sleep(150);
  window.__paste(${JSON.stringify(text)}, ${JSON.stringify(html)});
  await __sleep(350); toolboxRefresh(); await __sleep(150);
  // 根级 <br>："光标托"（data-tb-caret）是编辑器自己的落脚点、不进导出，不算用户看到的空行
  var unmarked = 0, all = 0;
  for (var i = 0; i < ed.childNodes.length; i++) {
    var c = ed.childNodes[i];
    if (c.nodeType === 1 && c.tagName === 'BR') { all++; if (!c.getAttribute('data-tb-caret')) unmarked++; }
  }
  var lines = String(code.value).split('\\n');
  var codeBlank = 0;
  for (var k = 0; k < lines.length; k++) if (/^\\s*<br\\s*\\/?>\\s*$/.test(lines[k])) codeBlank++;
  var text = String(ed.textContent || '').replace(/[\\s\\u00a0\\u200b]+/g, '');
  return { unmarked: unmarked, allBr: all, codeBlank: codeBlank, paras: ed.querySelectorAll('p').length, text: text };
`);

try {
  await send('Page.navigate', { url: BASE + 'index.html' });
  await sleep(4200);
  await evaluate(`window.__sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };`);
  await evaluate(`toolboxOpen();`);
  await sleep(600);
  await evaluate(DEFINE_PASTE);

  // ─────────── ① 富文本粘贴：不许凭空多出空行 ───────────
  console.log('\n══════ ① 富文本粘贴（剪贴板带 text/html）：块边界不该变成空行 ══════\n');
  const rich = await PASTE(RICH_TEXT, RICH_HTML);
  ok(rich.paras === 4, `4 段各自成一个 <p>，段落结构保留（实际 ${rich.paras} 个 <p>）`);
  ok(rich.text === '第一段正文。图1一件假钞的样张第二段正文。图2另一张样张',
    `正文文字一个不少（${JSON.stringify(rich.text)}）`);
  ok(rich.unmarked === 0,
    `编辑区里**没有**凭空多出来的根级 <br>（实际 ${rich.unmarked} 根；这就是"每张图都多出空行"的来源）`);
  ok(rich.codeBlank === 0,
    `代码区里没有"自己占一行的 <br>"（实际 ${rich.codeBlank} 行）`);

  // ─────────── ② 纯文本粘贴：用户的空行必须照旧保留 ───────────
  console.log('\n══════ ② 纯文本粘贴（没有 text/html）：用户故意留的空行照旧保留 ══════\n');
  const plain = await PASTE(RICH_TEXT, '');
  ok(plain.paras === 4, `4 段各自成一个 <p>（实际 ${plain.paras} 个 <p>）`);
  ok(plain.unmarked === 3 && plain.codeBlank === 3,
    `3 个空行 = 3 根独立 <br>，一根不少（实际编辑区 ${plain.unmarked} 根 / 代码区 ${plain.codeBlank} 行）`);

  // ─────────── ③ 富文本里真的有两个空行：保留 1 个，不能一刀切 ───────────
  console.log('\n══════ ③ 富文本里真的多留了空行：保留用户那一根 ══════\n');
  // 源里那个空的 <p> 让剪贴板文本变成"甲\n\n\n乙"（两个空行）——
  // 其中一个仍是复制方加的结构分隔，剩下那个是用户真的留的空行。
  const two = await PASTE('甲\n\n\n乙', '<p>甲</p><p><br></p><p>乙</p>');
  ok(two.paras === 2, `两段（实际 ${two.paras} 个 <p>）`);
  ok(two.unmarked === 1,
    `保留 1 根空行 <br>（实际 ${two.unmarked} 根）—— 不是把用户留的空行一起删掉`);

  // ─────────── ④ 不误伤：真实文章走"代码区导入"，内容与结构逐字不变 ───────────
  // ★ 2024 更正：这里以前断言"代码区逐字不变"，但**表格排版现在会规范化**
  //   （用户明确要求表格代码要有换行+缩进，这一篇的表恰好是"一整行写完"的老写法）。
  //   所以改成断言**两件事**，这两件才是本用例真正守的东西：
  //     · 抹掉标签之间的空白后**逐字节相同** —— 内容、结构、属性一个字符都没变；
  //     · `<br>` 一个不多一个不少 —— 这正是本用例的主题（粘贴不许凭空多出空行）。
  console.log('\n══════ ④ 不误伤：真实文章走"代码区导入"，内容/结构不变、<br> 不多不少 ══════\n');
  const articlePath = join(ROOT, 'notecollection', 'readmes', 'republic_1914_5_yuan_fake_note_zhihu_lee.html');
  const article = await readFile(articlePath, 'utf8');
  const rt = await J(`
    var ed = toolboxTpl.editor, code = document.getElementById('tbCode');
    var src = ${JSON.stringify(article)};
    code.value = src; code.dispatchEvent(new Event('input', { bubbles: true }));
    await __sleep(200); toolboxCodeToEditor(); await __sleep(350);
    var c1 = code.value;
    toolboxRefresh(); await __sleep(200);
    var c2 = code.value;
    var squash = function (s) { return String(s).replace(/\\r\\n?/g, '\\n').replace(/>\\s+</g, '><').replace(/\\s+/g, ' ').trim(); };
    var un = 0;
    for (var i = 0; i < ed.childNodes.length; i++) { var c = ed.childNodes[i];
      if (c.nodeType === 1 && c.tagName === 'BR' && !c.getAttribute('data-tb-caret')) un++; }
    return { same: c1 === c2, contentSame: squash(c1) === squash(c2),
             br1: (c1.match(/<br[^>]*>/gi) || []).length, br2: (c2.match(/<br[^>]*>/gi) || []).length,
             unmarked: un, br: (src.match(/<br[^>]*>/gi) || []).length };
  `);
  ok(rt.contentSame === true,
    `编辑区导出之后，内容与结构逐字不变（只允许表格的换行/缩进被规范化）${rt.same ? ' —— 连排版也逐字相同' : ''}`);
  ok(rt.br1 === rt.br2,
    `<br> 一个不多一个不少（${rt.br1} → ${rt.br2}）—— 没有凭空多出空行`);
  ok(rt.unmarked === 1,
    `文章里独立成行的 <br> 保持原样（实际 ${rt.unmarked} 根 —— 用户手敲的那一根）`);
} finally {
  try { ws.close(); } catch { }
  try { child.kill(); } catch { }
  try { server.close(); } catch { }
}

console.log('');
console.log(`  ──────── 通过 ${pass} / 失败 ${fail} ────────`);
if (fail) { console.log(`✗ 富文本粘贴空行检查失败：${fail} 项`); process.exit(1); }
console.log(`🟢 富文本粘贴空行检查全部通过（${pass} 项断言）`);
