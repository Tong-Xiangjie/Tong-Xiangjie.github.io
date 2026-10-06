// 文章编辑器「工具箱」（collection/toolbox.js + toolbox.css + index.html 里的 #toolboxModal）
//
// 用户要求：
//   · 在「我的」页面里能找到入口，点了**在站内弹窗**（不跳新页面/新标签页）；
//   · 左所见即所得、右实时只读 HTML，底部字数；
//   · 工具栏：加粗/斜体/下划线/删除线、五档字号、文字色/高亮、左中右对齐、清除格式；
//   · 插入块：标题、引用框、图注、图片（对话框填地址/宽度/说明）、并排图片、超链接、换行、落款；
//   · 表格：对话框填行/列/有无表头，**并且能把 Excel/网页粘来的表格自动转成 HTML 表格**；
//   · 复制 HTML（带 execCommand 兜底）、下载 .html、草稿自动保存与恢复；
//   · 点工具栏按钮不能丢编辑区里的选区；Esc / 点遮罩能关，且不留全局监听泄漏。
//
// 这条用例守的关键点（也是最容易悄悄坏掉的）：
//   ① 入口真的在「我的」页面里（不是只在源码里写了行字符串）；
//   ② 点了之后**没有跳走**（同一个 document、URL 的 hash 没变、不是新窗口）；
//   ③ 打字/live 同步：编辑区内容 → 代码区 HTML；
//   ④ 点加粗（真鼠标）之后选区**仍在编辑区里**、且 <b> 包住的是被选中的那段文字；
//   ⑤ 表格输出的是**透明背景**版本（不含写死的 #f5f7fa/#fafbfc —— 那在暗色模式下看不见字），
//      且行内样式里的 var() 必须完好（execCommand('insertHTML') 会把 td 的 border 洗掉，
//      所以插入走的是 createContextualFragment + insertNode）；
//   ⑥ 粘贴 TSV / HTML 表格会自动变成 <table>，普通文字粘贴不被打扰；
//   ⑦ 并排图片按语料那套 flex 行输出（总宽 80%、gap 20px、同高度/同宽度两档、
//      默认整行共用一条图注且放在容器之后）；
//   ⑧ 草稿会存进 localStorage，重开弹窗给恢复提示条（不弹 confirm）；
//   ⑨ 全程 Runtime.exceptionThrown 为 0（含初始化、开、点、关）。
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log(`  [ok] ${m}`)) : (fail++, console.log(`  [XX] ${m}`)); };

// ==============================================================
console.log('====== (1) 静态：新文件都在，且真的被页面引上 ======\n');
const html = readFileSync('collection/index.html', 'utf8');
const js = readFileSync('collection/toolbox.js', 'utf8');
const css = readFileSync('collection/toolbox.css', 'utf8');
ok(/<script src="toolbox\.js"><\/script>/.test(html), '(1) index.html 引入了 toolbox.js');
ok(/<link rel="stylesheet" href="toolbox\.css">/.test(html), '(1) index.html 引入了 toolbox.css');
ok(html.indexOf('layout.css') < html.indexOf('toolbox.css'), '(1) toolbox.css 在 layout.css 之后');
ok(html.indexOf('<script src="dropdown.js">') < html.indexOf('<script src="toolbox.js">'), '(1) toolbox.js 在既有模块之后加载（不打断任何既有链路）');
ok(/<div id="toolboxModal" class="tb-modal"/.test(html), '(1) 弹窗 DOM 在 index.html 里（与 #imageModal 同一套做法）');
ok(/id="tbEditor"[^>]*contenteditable="true"/.test(html), '(1) 编辑区是 contenteditable，且在 HTML 里就声明好');
ok(/id="tbCode"[^>]*spellcheck="false"/.test(html) && !/id="tbCode"[^>]*readonly/.test(html),
  '(1) 代码区是可编辑的 textarea（不再是 readonly）——「导入已有文章」就靠它');
ok(/id="tbValidate"/.test(html), '(1) 代码区下面有校验区（#tbValidate）');
// 文案精简：两块面板各一行小标题，长句说明一律删掉，提示改放 placeholder / data-placeholder
ok((html.match(/class="tb-pane-head"/g) || []).length === 2, '(1) 正文 / HTML 两块面板各有一行小标题');
ok(!/tb-codebar|tb-sub/.test(html), '(1) 常驻长句说明已删除（不留说明条）');
ok(/data-placeholder="在这里写正文"/.test(html) && /placeholder="粘贴或直接编辑 HTML"/.test(html),
  '(1) 空状态提示改成了 placeholder（正文用 data-placeholder，代码区用 placeholder）');
ok(/id="tbCode"[^>]*wrap="soft"/.test(html), '(1) 代码区 textarea 显式写 wrap="soft"（长行要折行）');
ok(/data-tb="undo"/.test(html) && /data-tb="redo"/.test(html), '(1) 工具栏有「撤回」「恢复」按钮');
ok(/id="tbFullBtn"/.test(html) && /data-tb="fullscreen"/.test(html), '(1) 标题栏有全屏按钮');
// 八个缩放手柄：四条边 + 四个角（n/s/e/w/nw/ne/sw/se）
const gripsInHtml = (html.match(/data-tb-grip="/g) || []).length;
ok(gripsInHtml === 8, `(1) 八个方向的缩放手柄都在（实际 ${gripsInHtml} 个）`);
ok(/id="tbHead"[^>]*/.test(html), '(1) 标题栏能作为拖动区（#tbHead）');
ok(/id="tbDraftBar"/.test(html) && /id="tbDraftRestore"/.test(html) && /id="tbDraftDiscard"/.test(html),
  '(1) 草稿提示条（发现草稿 + 恢复 + 丢弃）的 DOM 在 index.html 里');
ok(/id="tbTableMenu"/.test(html) && /role="menu"/.test(html),
  '(1) 表格右键小菜单的 DOM（#tbTableMenu）在 index.html 里');
ok(/onclick="toolboxOpen\(\)"/.test(readFileSync('collection/settings.js', 'utf8')),
  '(1) 「我的」页面（settings.js）里挂上了工具箱入口');
// 生成表格必须是"透明背景"那版：一旦出现写死的浅色底，暗色模式下表头文字就看不见了
ok(!/background-color:\s*#f5f7fa/i.test(js) && !/background-color:\s*#fafbfc/i.test(js),
  '(1) 表格生成代码里没有 #f5f7fa / #fafbfc 这类写死的浅色底（透明背景版）');
ok(/background:var\(--bg\)/.test(js) && /border:1px solid var\(--border\)/.test(js),
  '(1) 表格用 var(--bg)/var(--border) 主题变量，浅色暗色都跟着走');
// 主路径必须是 createContextualFragment（手工插节点），execCommand('insertHTML') 只能出现在
// 兜底分支里 —— 一旦它的位置跑到前面，就说明有人把主路径改回去了，行内 var() 会开始丢。
// ★ 只在**代码行**里比位置：注释里也会提到 execCommand('insertHTML')，把注释算进来会误判。
const jsCode = js.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
ok(jsCode.indexOf('createContextualFragment') > 0
   && jsCode.indexOf('createContextualFragment') < jsCode.indexOf("execCommand('insertHTML'"),
  '(1) 插入主路径走 createContextualFragment（execCommand insertHTML 只做兜底）');
ok(css.indexOf('.tb-dialog') >= 0 && css.indexOf('.tb-toolbar') >= 0 && css.indexOf('.tb-code') >= 0 && css.indexOf('.tb-draftbar') >= 0,
  '(1) toolbox.css 里工具栏/代码区/字段对话框/草稿条的样式都在');
ok(/mousedown/.test(js) && /preventDefault/.test(js) && /toolboxSaveRange/.test(js) && /toolboxRestoreRange/.test(js),
  '(1) 选区处理两道保险都在（mousedown 阻止默认 + 存/恢复 Range）');
ok(/localStorage\.setItem/.test(js) && /catch \(e\) \{ toolboxDraftError/.test(js),
  '(1) 草稿写 localStorage 且包了 try/catch（file:// 与隐私模式会抛）');
ok(/TOOLBOX_FLEX_STYLE[\s\S]{0,200}width:80%/.test(js), '(1) 并排图片容器总宽钉在 80%（与单图默认宽度一致）');
// —— 这一轮加的规格：文件名输入框 / 正文按钮 / 多图 / 不预填 value / 列宽 colgroup / 会话保留 ——
ok(/id="tbFileName"[^>]*placeholder="Untitled.html"/.test(html) && /id="tbFileName"[^>]*title="下载文件名/.test(html),
  '(1)* 左上角是"下载文件名"输入框（placeholder=Untitled.html、title 提示下载文件名）');
ok(!/id="tbFileName"[^>]*value=/.test(html),
  '(1)* 文件名输入框不预填 value（默认值只写在 placeholder 上，不干扰用户输入）');
ok(/data-tb="body"[^>]*>正文</.test(html), '(1)* 工具栏有「正文」按钮（标题的反操作）');
ok(/data-tb="stack"[^>]*>多图</.test(html) && /data-tb="stack"[^>]*title="[^"]*多张图片并排/.test(html),
  '(1)* 「并排」已改名「多图」，title 里写明"多张图片并排"');
ok(/TOOLBOX_DEFAULT_NAME\s*=\s*'Untitled\.html'/.test(js) && /function toolboxCleanFileName/.test(js),
  '(1)* 下载文件名有 default + 清洗函数（非法字符/后缀补齐）');
ok(/function toolboxColGroup/.test(js) && /'width:' \+ s\.pct\[i\] \+ '%;'/.test(js) && /TOOLBOX_COL_MIN_PCT/.test(js),
  '(1)* 列宽拖拽：colgroup + 百分比写入 + 单列最小值约束都在');
ok(!/sessionStorage\.(get|set|remove)Item/.test(js),
  '(1)* 会话标记只用内存变量（toolboxSession），没有往 sessionStorage 里塞东西');
// —— 表格操作（右键菜单 / 合并拆分 / 插删行列单元格）——
const tmBlock = js.slice(js.indexOf('const TOOLBOX_TM_ITEMS'), js.indexOf('// ========== 开关弹窗'));
const tmLabels = (tmBlock.match(/label:\s*'([^']+)'/g) || []).map(s => s.replace(/label:\s*'|'/g, ''));
ok(JSON.stringify(tmLabels) === JSON.stringify(['上方插入行', '下方插入行', '删除行', '左侧插入列',
    '右侧插入列', '删除列', '插入单元格', '删除单元格', '合并单元格', '拆分单元格']),
  `(1)* 表格操作的 10 个动作在源码里就是这个顺序（${tmLabels.join('/')}）`);
ok(/addEventListener\('contextmenu'/.test(js) && /toolboxTableMenuOpen/.test(js)
   && /toolboxTableMenuClose/.test(js) && /m\.addEventListener\('mousedown', function \(e\) \{ e\.preventDefault\(\); \}\)/.test(js),
  '(1)* 表格里右键弹菜单，且菜单自己的 mousedown 阻止默认（不抢焦点、不丢表格选区）');
ok(/function toolboxTableGrid/.test(js) && /function toolboxTableColCounts/.test(js)
   && /const counts = toolboxTableColCounts\(tables\[i\]\)/.test(js),
  '(1)* 校验器按 colspan/rowspan 的占位算"有效列数"（合并之后不再误报列数不一致）');
ok(/function toolboxTableMerge/.test(js) && /setAttribute\('colspan', String\(picked\.span\)\)/.test(js)
   && /picked\.span > 1/.test(js) && /picked\.rows > 1/.test(js),
  '(1)* 合并只在 span/rows 大于 1 时才写 colspan/rowspan（与语料写法一致）');
ok(/function toolboxTableSplit/.test(js) && /function toolboxTableInsertRow/.test(js)
   && /function toolboxTableDeleteRow/.test(js) && /function toolboxTableInsertCol/.test(js)
   && /function toolboxTableDeleteCol/.test(js) && /function toolboxTableAddCell/.test(js)
   && /function toolboxTableDeleteCell/.test(js),
  '(1)* 插删行/列/单元格 与 合并/拆分 的实现都在');
ok(/toolboxUndoPush\(false\);\s*\/\/ ★ 一次操作 = 一条撤回记录/.test(js)
   && (tmBlock.match(/toolboxUndoPush\(/g) || []).length <= 2,
  '(1)* 一次表格操作只入一条撤回记录（补格/改属性都不单独入栈）');
ok(/toolboxColGroupDrop/.test(js) && /结构变了，手动拖出来的列宽就作废/.test(js),
  '(1)* 结构变化后 colgroup 会一起收拾掉（不留下和实际列数对不上的 <col>）');
ok(css.indexOf('.tb-tmenu') >= 0 && /\.tb-tmenu \{[\s\S]{0,400}font-size: 13px/.test(css)
   && /\.tb-tmenu \{[\s\S]{0,400}border-radius: 6px/.test(css)
   && /\.tb-tmenu \{[\s\S]{0,400}border: 1px solid var\(--border\)/.test(css),
  '(1)* 右键菜单是站内风格的小菜单（白底 + 1px var(--border) + 6px 圆角 + 13px）');
const dlgBlock = js.slice(js.indexOf('const TOOLBOX_DIALOGS'), js.indexOf('function toolboxOpenDialog'));
ok(dlgBlock.length > 100 && /placeholder:/.test(dlgBlock) && !/value:/.test(dlgBlock) && !/value="/.test(dlgBlock),
  '(1)* 字段对话框的默认值全部写在 placeholder 上（一个 value 预填都没有）');

export {};

// ==============================================================
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
if (!chromePath) { console.log('  [XX] 找不到 Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
const userDir = await mkdtemp(join(tmpdir(), 'cdpTB-'));
const DP = 16500 + Math.floor(Math.random() * 90);
const child = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${DP}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgId = 0; const pending = new Map();
const ws = new WebSocket(await (async () => { for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${DP}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl; } catch {} await sleep(250); } throw new Error('CDP 未就绪'); })());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const errors = [];
// 未捕获异常带调用栈：只看 "exception" 两个字是查不出是谁抛的
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const ed = m.params.exceptionDetails || {};
    const st = ((ed.stackTrace && ed.stackTrace.callFrames) || []).slice(0, 4)
      .map(f => `${f.functionName || '(anon)'} @ ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`).join('  <-  ');
    errors.push((ed.text || '') + ' ' + ((ed.exception && ed.exception.description) || '') + (st ? '  | stack: ' + st : ''));
  }
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function evaluate(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}
const json = async (e) => JSON.parse(await evaluate(e));
// 真鼠标事件（点工具栏按钮必须用真的：这条用例要验证的正是"按下按钮会不会把选区抢走"）
async function clickAt(x, y) {
  const x1 = Math.round(x), y1 = Math.round(y);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, button: 'none', buttons: 0, clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
}
const btnCenter = (sel) => json(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return JSON.stringify({none:true});const r=b.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height});})()`);
// 点之前必须保证目标在视口里：「我的」页面很长，入口按钮排在统计图表之后，默认是滚出屏幕的
// （实测 y 约 2671，视口才 802）。不滚的话 CDP 的鼠标事件点在空白处、elementFromPoint 是 null ——
// 表现就是"点了没反应"，很容易被误判成功能坏了。
async function scrollIntoView(sel) {
  await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(b && b.scrollIntoView) b.scrollIntoView({block:'center'});return 1;})()`);
  await sleep(260);
}
async function clickSel(sel) {
  await scrollIntoView(sel);
  const b = await btnCenter(sel);
  if (b.none) throw new Error('找不到元素：' + sel);
  await clickAt(b.x, b.y);
  await sleep(220);
  return b;
}
// 把编辑区清空并把光标放到末尾（每次交互前的统一前置）。
// ★ 同时清掉"冻结快照"和"上一次的选区存档"：不然上一节留下的选中文字会被
//   当成"用户选中了东西"，让本来该用默认文字的插入去包住那段旧文字。
const resetEditor = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p><br></p>';
  toolboxSnapClear(); toolboxRange = null;
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();toolboxSaveRange();return 1;})()`);

await send('Runtime.enable');
await send('Page.enable');
// 钉住几个会让"点一下"变成"真的下载/真的写系统剪贴板"的行为：
// headless 里没有下载落盘目录、也未必有剪贴板权限，不拦的话用例会卡在弹窗/权限上。
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try {
    delete Navigator.prototype.clipboard;
    HTMLAnchorElement.prototype.click = function () { window.__tbDownloaded = (this.download || ''); };
  } catch (e) {}`
});

await send('Page.navigate', { url: `${BASE}?t=${Date.now()}#settings` });
for (let i = 0; i < 160; i++) {
  const r = await evaluate(`document.readyState === 'complete' && typeof onTabClick === 'function' && !!document.getElementById('toolboxOpenBtn')`).catch(() => false);
  if (r) break;
  await sleep(120);
}
await sleep(600);

// ==============================================================
console.log('\n====== (2) 入口在「我的」页面里 ======\n');
const entry = await json(`(()=>{
  const b = document.getElementById('toolboxOpenBtn');
  if (!b) return JSON.stringify({ none: true });
  const sec = b.closest('.settings-section');
  const r = b.getBoundingClientRect();
  const mod = document.getElementById('toolboxModal');
  return JSON.stringify({
    text: (b.textContent || '').trim(),
    inSettingsPage: !!document.querySelector('.settings-page') && !!sec,
    sectionTitle: sec ? ((sec.querySelector('h3') || {}).textContent || '') : '',
    visible: r.width > 0 && r.height > 0,
    modalExists: !!mod,
    modalHidden: mod ? getComputedStyle(mod).display === 'none' : true,
    hash: location.hash,
    bootstrapped: typeof window.toolboxOpen === 'function'
  });
})()`);
console.log(`  入口按钮：「${entry.text}」，所在小节「${entry.sectionTitle}」，尺寸可见=${entry.visible}`);
ok(entry.none !== true, '(2) 「我的」页面里找得到工具箱入口（#toolboxOpenBtn）');
ok(entry.inSettingsPage === true, '(2) 入口确实在设置页的某个 .settings-section 里');
ok(entry.text.length > 0 && entry.visible, `(2) 入口是可见的按钮（文字「${entry.text}」）`);
ok(entry.modalExists && entry.modalHidden, '(2) 弹窗在页面里且默认是隐藏的（没有自说自话地弹出来）');
ok(entry.hash === '#settings', `(2) 打开前停在「我的」页面（hash=${entry.hash}）`);
ok(entry.bootstrapped === true, '(2) toolbox.js 已加载：toolboxOpen 是可调用的全局函数');

// ==============================================================
console.log('\n====== (3) 点击 -> 站内弹窗（不是新页面） ======\n');
const before = await json(`(()=>{
  const mod = document.getElementById('toolboxModal');
  return JSON.stringify({
    href: location.href, hash: location.hash,
    docId: (window.__tbDocId = (window.__tbDocId || String(Math.random()))),
    readyState: document.readyState,
    modalDisplay: getComputedStyle(mod).display,
    bodyLocked: document.body.classList.contains('tb-modal-open')
  });
})()`);
await clickSel('#toolboxOpenBtn');
await sleep(420);
const after = await json(`(()=>{
  const mod = document.getElementById('toolboxModal');
  const card = mod.querySelector('.tb-card');
  const ed = document.getElementById('tbEditor');
  const cw = document.querySelector('.tb-pane-code');
  const cr = card.getBoundingClientRect();
  return JSON.stringify({
    href: location.href, hash: location.hash, docId: window.__tbDocId,
    readyState: document.readyState,
    settingsStillThere: !!document.querySelector('.settings-page'),
    modalDisplay: getComputedStyle(mod).display,
    bodyLocked: document.body.classList.contains('tb-modal-open'),
    cardW: Math.round(cr.width), cardH: Math.round(cr.height),
    vw: window.innerWidth, vh: window.innerHeight,
    editorEditable: ed.getAttribute('contenteditable'),
    editorH: Math.round(ed.getBoundingClientRect().height),
    codeW: Math.round(cw.getBoundingClientRect().width),
    toolbarBtns: mod.querySelectorAll('.tb-toolbar button').length,
    editorText: (ed.textContent || '').trim(),
    codeText: document.getElementById('tbCode').value,
    filenameVal: (document.getElementById('tbFileName') || {}).value,
    focused: document.activeElement === ed,
    tabCount: document.querySelectorAll('.tab-item').length
  });
})()`);
console.log(`  弹窗尺寸：${after.cardW}x${after.cardH}（视口 ${after.vw}x${after.vh}）；工具栏按钮 ${after.toolbarBtns} 个`);
ok(after.docId === before.docId && after.readyState === 'complete',
  '(3)* 没有跳转/新开页面（同一个 document，readyState 仍是 complete）');
ok(after.hash === before.hash && after.href === before.href,
  `(3)* URL 完全没变（仍是 ${after.hash}）—— 弹窗是站内的，不是新标签页`);
ok(after.settingsStillThere === true, '(3) 「我的」页面还在下面（弹窗盖在它上面）');
ok(after.modalDisplay === 'flex', '(3) 弹窗出现了（display:flex）');
ok(after.bodyLocked === true, '(3) 打开时锁住了背景滚动（body.tb-modal-open）');
ok(after.cardW > after.vw * 0.9 && after.cardH > after.vh * 0.8,
  `(3)* 弹窗接近满屏（宽 ${after.cardW}/${after.vw}、高 ${after.cardH}/${after.vh} —— Word 那样的大工作台）`);
ok(after.cardW <= after.vw && after.cardH <= after.vh, '(3) 弹窗没有溢出视口（宽高都在视口之内）');
ok(after.editorEditable === 'true' && after.editorH > 200, '(3) 左侧编辑区可编辑且有实际高度');
ok(after.codeW > 100 && after.codeW < after.cardW * 0.5, '(3) 右侧代码区占一栏（窄于编辑区）');
ok(after.toolbarBtns >= 20, `(3) 工具栏按钮齐全（${after.toolbarBtns} 个）`);
ok(after.editorText === '' && after.codeText === '',
  '(3)* 页面刷新后第一次打开时编辑区与代码区都是空的（不预置任何示例文章）');
ok(after.filenameVal === '',
  '(3)* 左上角的下载文件名输入框默认是空的（默认值只写在 placeholder 上，不预填干扰用户）');
ok(after.focused === true, '(3) 打开后焦点在编辑区（可以直接开始打字）');

// ==============================================================
console.log('\n====== (4) 打字 -> 代码区实时同步 + 字数 ======\n');
await resetEditor();
await sleep(120);
await send('Input.insertText', { text: '测试正文一段' });
await sleep(450);
const typed = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const code = document.getElementById('tbCode').value;
  return JSON.stringify({ editorText: (ed.textContent || '').trim(), code: code,
    count: (document.getElementById('tbCount') || {}).textContent,
    codeIsReadonly: document.getElementById('tbCode').readOnly,
    codeBg: getComputedStyle(document.getElementById('tbCode')).backgroundColor,
    codeFont: getComputedStyle(document.getElementById('tbCode')).fontFamily });
})()`);
console.log(`  代码区：${JSON.stringify(typed.code)}`);
ok(typed.editorText === '测试正文一段', '(4)* 编辑区里真的打进了文字（真键盘输入路径）');
ok(/测试正文一段/.test(typed.code), '(4)* 代码区出现了对应的 HTML 文字（实时同步）');
ok(/<\w+[^>]*>/.test(typed.code), '(4) 代码区输出的是 HTML 标签，不是光秃秃的纯文本');
ok(typed.codeIsReadonly === false, '(4) 代码区是可编辑的（双向同步的前提）');
ok(/rgb\(\s*30,\s*30,\s*40\s*\)/.test(typed.codeBg), `(4) 代码区是深底（${typed.codeBg} = #1e1e28）`);
ok(/mono|Consolas|Menlo|Courier/i.test(typed.codeFont), `(4) 代码区是等宽字体（${typed.codeFont.split(',')[0]}）`);
ok(typed.count === '6', `(4)* 底部字数统计跟着变（「测试正文一段」= ${typed.count} 字）`);

// 长串不换行会把代码区撑出横向滚动条。塞一段超长且**不含空格**的 HTML
// （文章里真实存在这种写法：<div style="background:…;border-left:…">），
// 断言它被折行而不是溢出。
const wrapped = await json(`(()=>{
  const t = document.getElementById('tbCode');
  t.value = '<div style="' + 'a'.repeat(300) + '"></div>';
  const cs = getComputedStyle(t);
  return JSON.stringify({ sw: t.scrollWidth, cw: t.clientWidth, overflowX: cs.overflowX,
    wrap: cs.overflowWrap, wordBreak: cs.wordBreak, attr: t.getAttribute('wrap') });
})()`);
console.log(`  超长无空格片段：scrollWidth=${wrapped.sw} clientWidth=${wrapped.cw} overflow-x=${wrapped.overflowX} wrap=${wrapped.attr}`);
ok(wrapped.sw <= wrapped.cw + 4, `(4)* 代码区对超长无空格片段自动折行，没有横向溢出（${wrapped.sw} ≤ ${wrapped.cw}+4）`);
ok(wrapped.overflowX === 'hidden', `(4)* 代码区不会出现横向滚动条（overflow-x: ${wrapped.overflowX}）`);
ok(wrapped.attr === 'soft', `(4) textarea 用的是 wrap="soft"（实际 ${wrapped.attr}）`);
ok(/anywhere|break-word/.test(wrapped.wrap + ' ' + wrapped.wordBreak),
  `(4) 折行规则写的是 break-word/anywhere（overflow-wrap:${wrapped.wrap} word-break:${wrapped.wordBreak}）`);

// ==============================================================
console.log('\n====== (5) 点加粗：出现 <b>/<strong>，且选区没被按钮抢走 ======\n');
const setup = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<p>前缀加粗这段后缀</p>';
  const node = ed.querySelector('p').firstChild;
  const r = document.createRange();
  r.setStart(node, 2); r.setEnd(node, 6);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  return JSON.stringify({ selected: s.toString(), collapsed: s.isCollapsed, activeIsEditor: document.activeElement === ed });
})()`);
ok(setup.selected === '加粗这段' && setup.collapsed === false, `(5) 前置：编辑区里选中了「${setup.selected}」`);
// 关键动作：用**真鼠标**点在按钮上。按钮的 mousedown 若没阻止默认行为，
// 编辑区会失焦、选区随之消失 —— 所以下面要检查点完选区还在不在。
const bSel = await json(`(()=>{const b=document.querySelector('[data-tb="bold"]');const r=b.getBoundingClientRect();
  return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,text:b.textContent.trim()});})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(bSel.x), y: Math.round(bSel.y), button: 'none', buttons: 0, clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(bSel.x), y: Math.round(bSel.y), button: 'left', buttons: 1, clickCount: 1 });
const afterDown = await json(`(()=>{const s=getSelection();return JSON.stringify({selected:s.toString(),rangeCount:s.rangeCount,
  inEditor: !!(s.rangeCount && document.getElementById('tbEditor').contains(s.getRangeAt(0).commonAncestorContainer))});})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(bSel.x), y: Math.round(bSel.y), button: 'left', buttons: 0, clickCount: 1 });
await sleep(350);
ok(afterDown.selected === '加粗这段' && afterDown.inEditor,
  `(5)* 按下工具栏按钮时选区没丢（选中仍是「${afterDown.selected}」，且仍在编辑区内）`);
const bold = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  return JSON.stringify({ html: ed.innerHTML, code: document.getElementById('tbCode').value });
})()`);
console.log(`  编辑区：${bold.html}`);
ok(/<(b|strong)\b/i.test(bold.html), '(5)* 出现 <b> 或 <strong>');
ok(/<(b|strong)\b[^>]*>\s*加粗这段\s*<\/(b|strong)>/i.test(bold.html),
  '(5)* 加粗包住的正是被选中的那段文字（证明恢复选区这一步真的生效了）');
ok(/前缀/.test(bold.html) && /后缀/.test(bold.html), '(5) 选区之外的字没被误伤');
ok(/<(b|strong)\b/i.test(bold.code), '(5) 代码区同步出现加粗标签');

// 斜体 / 删除线也走一遍（同一个 execCommand 链路，确认没有互相覆盖）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>斜体文字</p>';
  const r=document.createRange();r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await clickSel('[data-tb="italic"]');
const it = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/<(i|em)\b/i.test(it), `(5) 斜体生效（${it}）`);

await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>删除线文字</p>';
  const r=document.createRange();r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await clickSel('[data-tb="strike"]');
const st = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/<(s|strike|del)\b/i.test(st), `(5) 删除线生效（${st}）`);

// ==============================================================
console.log('\n====== (6) 字号 / 颜色 / 对齐 / 清除格式 ======\n');
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>字号文字</p>';
  const r=document.createRange();r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await clickSel('[data-tb="size"][data-size="1.1em"]');
const sizeHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/font-size:\s*1\.1em/i.test(sizeHtml), `(6) 1.1em 字号生效且输出 em 而不是 <font size>（${sizeHtml.replace(/\s+/g, ' ')}）`);
ok(!/<font\b/i.test(sizeHtml), '(6) 生成的是 <span style="font-size:...">，没有留下 <font> 老标签');

await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>颜色文字</p>';
  const r=document.createRange();r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
const colorRes = await json(`(()=>{
  const inp = document.getElementById('tbForeColor');
  const isColorInput = inp && inp.type === 'color';
  const def = inp ? inp.value : '';
  inp.value = '#555555'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ isColorInput, def, html: document.getElementById('tbEditor').innerHTML });
})()`);
ok(colorRes.isColorInput === true, '(6) 文字颜色用的是 <input type="color">');
ok(colorRes.def.toLowerCase() === '#555555', `(6) 文字颜色默认值是语料主流的小字色 #555555（实际 ${colorRes.def}）`);
ok(/<span style="color:\s*(#555555|rgb\(85, 85, 85\))/i.test(colorRes.html) && !/<font/i.test(colorRes.html),
  `(6)* 文字颜色输出成 <span style="color:...">（不是老式 <font>，${colorRes.html.replace(/\s+/g, ' ')}）`);

await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>对齐文字</p>';
  const r=document.createRange();r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await clickSel('[data-tb="align-center"]');
const alignHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/text-align:\s*center/i.test(alignHtml), `(6) 居中对齐生效（${alignHtml.replace(/\s+/g, ' ')}）`);

await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p><b><span style="color:#ff0000;">清格式</span></b></p>';
  const r=document.createRange();r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await clickSel('[data-tb="clear"]');
const clearHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(!/color:#ff0000/i.test(clearHtml) && /清格式/.test(clearHtml),
  `(6) 清除格式摘掉了行内颜色、但文字还在（${clearHtml.replace(/\s+/g, ' ')}）`);

// ==============================================================
console.log('\n====== (7) 表格：对话框插入 + 输出形态 ======\n');
await resetEditor();
await clickSel('[data-tb="table"]');
const dlg1 = await json(`(()=>{
  const d = document.getElementById('tbDialog');
  return JSON.stringify({ open: getComputedStyle(d).display !== 'none',
    title: (document.getElementById('tbDialogTitle') || {}).textContent,
    hasRows: !!document.getElementById('tbF_rows'), hasCols: !!document.getElementById('tbF_cols'),
    hasHeader: !!document.getElementById('tbF_header'),
    headerChecked: !!(document.getElementById('tbF_header') || {}).checked,
    rowsValue: (document.getElementById('tbF_rows') || {}).value,
    colsValue: (document.getElementById('tbF_cols') || {}).value,
    rowsPlaceholder: (document.getElementById('tbF_rows') || {}).placeholder,
    colsPlaceholder: (document.getElementById('tbF_cols') || {}).placeholder });
})()`);
ok(dlg1.open === true, `(7) 点「表格」弹出了参数对话框（标题「${dlg1.title}」）`);
ok(dlg1.hasRows && dlg1.hasCols && dlg1.hasHeader, '(7) 对话框里有行数/列数/表头三个字段');
ok(dlg1.headerChecked === true, `(7) 默认勾选"第一行是表头"（默认 ${dlg1.rowsPlaceholder} 行 x ${dlg1.colsPlaceholder} 列）`);
ok(dlg1.rowsValue === '' && dlg1.colsValue === '' && dlg1.rowsPlaceholder === '3' && dlg1.colsPlaceholder === '2',
  '(7)* 行数/列数不预填 value，默认值只写在 placeholder 上（3 / 2）');
await evaluate(`(()=>{document.getElementById('tbF_rows').value='3';document.getElementById('tbF_cols').value='3';
  document.getElementById('tbF_header').checked=true;return 1;})()`);
await clickSel('#tbDialogOk');
const tbl = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const t = ed.querySelector('table');
  if (!t) return JSON.stringify({ none: true, html: ed.innerHTML });
  const th = t.querySelector('th'), tr = t.querySelector('tbody tr');
  const d = document.getElementById('tbDialog');
  return JSON.stringify({
    none: false,
    code: document.getElementById('tbCode').value,
    rowCount: t.querySelectorAll('tr').length,
    thCount: t.querySelectorAll('th').length,
    tdCount: t.querySelectorAll('td').length,
    thead: !!t.querySelector('thead'),
    thBg: th ? getComputedStyle(th).backgroundColor : '',
    dialogClosed: getComputedStyle(d).display === 'none',
    tdStyle: tr && tr.querySelector('td') ? tr.querySelector('td').getAttribute('style') : '',
    thStyle: th ? th.getAttribute('style') : '',
    tableStyle: t.getAttribute('style'),
    hasHardcodedBg: /#f5f7fa|#fafbfc/i.test(document.getElementById('tbCode').value)
  });
})()`);
ok(tbl.none === false, '(7)* 编辑区里插入了表格');
ok(tbl.dialogClosed === true, '(7) 确定后对话框自己关掉了');
console.log(`  表格内联样式：<table style="${tbl.tableStyle}">`);
console.log(`                <th style="${tbl.thStyle}">`);
console.log(`                <td style="${tbl.tdStyle}">`);
console.log('  生成的 HTML 片段：');
console.log(tbl.code.split('\n').filter(l => /table|thead|tbody|<tr>|<th|<td/.test(l)).slice(0, 4).map(l => '    ' + l).join('\n'));
// 3 行 = 整张表 3 行（对话框上写的是"行数（含表头）"），所以是 1 个 thead 行 + 2 个 tbody 行：
// 3 个 tr、3 个 th，内容行 2x3 = 6 个 td
ok(tbl.rowCount === 3 && tbl.thCount === 3 && tbl.tdCount === 6,
  `(7) 填 3 行 x 3 列 + 勾表头：共 ${tbl.rowCount} 个 tr（1 表头 + 2 内容）、${tbl.thCount} 个 th、${tbl.tdCount} 个 td`);
ok(tbl.thead === true, '(7) 第一行在 <thead> 里（表头语义与语料一致）');
ok(/<table\b/.test(tbl.code), '(7)* 生成的 HTML 里有 <table>');
ok(!tbl.hasHardcodedBg, '(7)* 生成的 HTML 里没有 background-color:#f5f7fa（透明背景版：暗色模式下才看得清文字）');
ok(/border:1px solid var\(--border\)/.test(tbl.thStyle) && /border:1px solid var\(--border\)/.test(tbl.tdStyle),
  '(7)* 框线走 var(--border)（主题变量，浅色暗色都跟着走）');
ok(/border-collapse:collapse/.test(tbl.tableStyle || ''), '(7)* 表格是 border-collapse:collapse');
ok(tbl.thBg.indexOf('rgba(0, 0, 0, 0)') !== 0, `(7) 表头有底色（${tbl.thBg}）而不是纯透明`);

// 表头复选框取消勾选时不应有 <th>
await resetEditor();
await clickSel('[data-tb="table"]');
await evaluate(`(()=>{document.getElementById('tbF_rows').value='2';document.getElementById('tbF_cols').value='2';
  document.getElementById('tbF_header').checked=false;return 1;})()`);
await clickSel('#tbDialogOk');
const noHead = await evaluate(`(()=>{const t=document.querySelector('#tbEditor table');return t?JSON.stringify({th:t.querySelectorAll('th').length,tr:t.querySelectorAll('tr').length}):'{"none":1}';})()`);
ok(/"th":0/.test(noHead), `(7) 不勾"表头"时只出 <td>（${noHead}）`);

// ==============================================================
console.log('\n====== (8) 直接把表格粘进编辑区（Excel / 网页 / Tab 纯文本） ======\n');
await resetEditor();
// 真粘贴路径：剪贴板里的 tab 分隔文本（Excel 复制到纯文本就是这个形态）
const pasteTsv = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const dt = new DataTransfer();
  dt.setData('text/plain', '币种\\t面值\\t发行量\\n荷花钞\\t100元\\t300万\\n奥运钞\\t10元\\t600万');
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  const t = ed.querySelector('table');
  return JSON.stringify({ hasTable: !!t,
    rows: t ? t.querySelectorAll('tr').length : 0,
    cols: t ? t.querySelectorAll('th').length : 0,
    firstTh: t ? (t.querySelector('th') || {}).textContent : '',
    firstBodyTd: t ? ((t.querySelector('tbody td') || {}).textContent || '') : '',
    code: document.getElementById('tbCode').value,
    leftoverText: (ed.textContent || '').indexOf('币种\\t面值') >= 0 });
})()`);
ok(pasteTsv.hasTable === true, '(8)* 粘贴 Tab 分隔的纯文本 -> 自动变成了 <table>');
ok(pasteTsv.rows === 3 && pasteTsv.cols === 3, `(8)* 行列识别正确（3 行 x ${pasteTsv.cols} 列）`);
ok(pasteTsv.firstTh === '币种' && pasteTsv.firstBodyTd === '荷花钞',
  `(8)* 单元格内容对了（表头「${pasteTsv.firstTh}」、首行「${pasteTsv.firstBodyTd}」）`);
ok(!pasteTsv.leftoverText, '(8) 原来的制表符文本没有残留在表格旁边');
ok(/<table\b/.test(pasteTsv.code) && !/#f5f7fa/i.test(pasteTsv.code), '(8) 粘出来的也是透明背景版表格');

// 真 HTML 表格（网页/Excel 的 text/html 形态）
const pasteHtml = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<p><br></p>';
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  const dt = new DataTransfer();
  dt.setData('text/html', '<table><tr><th>项目</th><th>数值</th></tr><tr><td>甲</td><td>1</td></tr><tr><td>乙</td><td>2</td></tr></table>');
  dt.setData('text/plain', '项目\\t数值\\n甲\\t1\\n乙\\t2');
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  const t = ed.querySelector('table');
  return JSON.stringify({ hasTable: !!t, rows: t ? t.querySelectorAll('tr').length : 0,
    cellText: t ? (t.querySelector('tbody td') || {}).textContent : '' });
})()`);
ok(pasteHtml.hasTable === true && pasteHtml.rows === 3, `(8)* 粘贴网页/Excel 的 HTML 表格也能转（${pasteHtml.rows} 行）`);
ok(pasteHtml.cellText === '甲', `(8)* HTML 表格的单元格文字保留（「${pasteHtml.cellText}」）`);

// 普通文字粘贴：按**纯文本**处理（用户要求：粘进正文的东西不带任何样式）。
// 这条以前断言的是"不拦、交回浏览器默认"，现在规格变了 —— 必须拦下来转成纯文本 + <br>。
const pastePlain = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<p><br></p>';
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', '这是一段普通文字，没有制表符，也不是表格。');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  ed.dispatchEvent(ev);
  return JSON.stringify({ prevented: ev.defaultPrevented, hasTable: !!ed.querySelector('table'),
    html: ed.innerHTML });
})()`);
ok(pastePlain.prevented === true && pastePlain.hasTable === false,
  '(8)* 普通文字粘贴被拦下并按纯文本处理（不会误判成表格）');
ok(pastePlain.html.indexOf('这是一段普通文字') >= 0 && !/<p[^>]*>这是一段/.test(pastePlain.html),
  `(8)* 普通文字原样进来、没有被包成 <p>：${JSON.stringify(pastePlain.html)}`);

// ==============================================================
console.log('\n====== (9) 插入块：标题 / 引用框 / 图注 / 图片 / 链接 / 换行 / 落款 ======\n');
await resetEditor();
await clickSel('[data-tb="title"]');
// ★ 需求：用**默认文字**插入完之后，立刻把这段默认文字整段选中（用户直接打字就覆盖）。
//   所以这一节每插一个块都先"把光标放回末尾"再插下一个，模拟用户真实的操作节奏
//   （否则第二个块会去包住第一个块刚选中的默认文字）。
const putCaretAtEnd = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();
  toolboxDropRange(); toolboxSaveRange(); return 1;})()`);
const titleAfter = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ html: ed.innerHTML, sel: String(getSelection()),
    code: document.getElementById('tbCode').value });})()`);
ok(/<center>\s*<b>\s*<span style="font-size:1\.1em;">/.test(titleAfter.html.replace(/\s+/g, ' ')),
  '(9) 标题块：居中加粗 + 1.1em（与语料主流写法一致）');
ok(titleAfter.sel === '文章标题',
  `(9)* 无选区点「标题」→ 插完默认文字被整段选中（当前选中「${titleAfter.sel}」，直接打字即可覆盖）`);
await putCaretAtEnd();
await clickSel('[data-tb="quote"]');
const quoteHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/background:var\(--bg\);border-left:3px solid var\(--theme\)/.test(quoteHtml),
  '(9) 引用框：语料里那套完全一致的写法（--bg + 3px 主题色左边线）');
await putCaretAtEnd();
await clickSel('[data-tb="caption"]');
const capHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
// 容忍 color:#555555; 与 font-size 之间的空格：语料里两种写法都有
ok(/color:\s*#555555;\s*font-size:\s*0\.85rem/.test(capHtml), '(9) 图注：居中 + #555555 + 0.85rem');
await putCaretAtEnd();
await clickSel('[data-tb="sign"]');
const signHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/text-align:right/.test(signHtml), '(9) 落款是右对齐');
const blocks = { html: titleAfter.html + quoteHtml + capHtml + signHtml, code: titleAfter.code };
ok(/<center>/.test(blocks.html), '(9) 块级内容用 <center> 居中（语料 380 处的主流写法）');
// ★ 需求：插入后不许出现多余空行 / 空块。
//   （编辑器里"两段正文 → 插标题 → 插引用"是最容易留下空 <p> 的路径。）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>第一段正文</p><p>第二段正文</p>';
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();
  toolboxDropRange(); toolboxSaveRange(); return 1;})()`);
await clickSel('[data-tb="title"]');
await putCaretAtEnd();
await clickSel('[data-tb="quote"]');
const noBlank = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const code = document.getElementById('tbCode').value;
  const empties = [...ed.querySelectorAll('p,div,span,center,li')].filter(function (el) {
    if (el.closest('table')) return false;
    if (el.querySelector('img,table,hr,video,br,input,td,th')) return false;
    return !String(el.textContent || '').replace(/[\\s\\u00a0\\u200b]+/g, '');
  });
  return JSON.stringify({ code: code,
    blankLines: (code.match(/\\n[ \\t]*\\n/g) || []).length,
    empties: empties.length,
    emptySamples: empties.slice(0, 4).map(function (el) { return el.outerHTML.slice(0, 60); }),
    hasTitle: /font-size:1\\.1em/.test(code), hasQuote: /border-left:3px solid/.test(code) });
})()`);
console.log('  插完标题+引用后的导出：\n' + noBlank.code.split('\n').slice(0, 10).map(l => '    ' + l).join('\n'));
ok(noBlank.blankLines === 0, `(9)* 插入后生成的 HTML 里没有多余空行（空行 ${noBlank.blankLines} 处）`);
ok(noBlank.empties === 0,
  `(9)* 编辑区里没有"只含 <br>/&nbsp; 的空块"（${noBlank.empties} 个：${noBlank.emptySamples.join(' | ')}）`);
ok(noBlank.hasTitle && noBlank.hasQuote, '(9) 标题与引用两个块都在（没被空块清理误删）');
// 用户**有意**写的连续 <br> 不能删（那是"空一行"的排版手段）
const keptBr = await json(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>甲<br><br>乙</p>';
  const s=document.getElementById('tbCode'); toolboxRefresh();
  const before=(s.value.match(/<br>/g)||[]).length;
  toolboxCleanEditorBlocks(ed);
  const after=(ed.innerHTML.match(/<br>/g)||[]).length;
  return JSON.stringify({ before:before, after:after });})()`);
ok(keptBr.after === 2, `(9)* 用户有意写的连续 <br> 不会被当空块删掉（还剩 ${keptBr.after} 个）`);

// <br> 单独一条、而且要插在**中间**：浏览器会把块级元素末尾那个"仅用于放光标"的
// <br> 序列化掉（它本来就不渲染），所以"最后一个插入的是 br"这种测法必然误报。
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>前半段</p>';
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await clickSel('[data-tb="br"]');
await clickSel('[data-tb="caption"]');
const brHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/<br\s*\/?>/.test(brHtml), `(9) 换行插入了 <br>（插在中间的 br 会真的留下来，${brHtml.replace(/\s+/g, ' ')}）`);

// 图片对话框
await resetEditor();
await clickSel('[data-tb="image"]');
const imgDlg = await json(`(()=>{const d=document.getElementById('tbDialog');
  return JSON.stringify({open:getComputedStyle(d).display!=='none',
    width:(document.getElementById('tbF_width')||{}).value,
    widthPh:(document.getElementById('tbF_width')||{}).placeholder,
    src:(document.getElementById('tbF_src')||{}).value,
    srcPh:(document.getElementById('tbF_src')||{}).placeholder,
    hasCaption:!!document.getElementById('tbF_caption')});})()`);
ok(imgDlg.open && imgDlg.hasCaption, '(9) 图片按钮弹出对话框（地址/宽度/说明）');
ok(imgDlg.width === '' && imgDlg.widthPh === '80%',
  `(9)* 图片宽度不预填，默认值 80% 写在 placeholder 上（语料 160 处图片全是这个值）`);
ok(imgDlg.src === '' && /^readmes\/image\//.test(imgDlg.srcPh),
  `(9)* 图片地址也不预填（placeholder「${imgDlg.srcPh}」提示相对路径）`);
// 留空 = 用默认值：只填地址，宽度留空 → 出来的必须是 width="80%"
await evaluate(`(()=>{document.getElementById('tbF_src').value='readmes/image/comm/amsx_2012_01.jpg';
  document.getElementById('tbF_caption').value='龙年贺岁钞正面';return 1;})()`);
await clickSel('#tbDialogOk');
const imgObj = await json(`(()=>{const ed=document.getElementById('tbEditor');return JSON.stringify({img:!!ed.querySelector('img'),html:ed.innerHTML});})()`);
ok(imgObj.img === true, '(9) 图片真的插进了编辑区');
ok(/<img src="readmes\/image\/comm\/amsx_2012_01\.jpg" width="80%">/.test(imgObj.html),
  '(9)* 输出形态：<img src="readmes/image/..." width="80%">（相对路径，article.js 会重写基址）');
ok(/龙年贺岁钞正面/.test(imgObj.html), '(9) 图注跟着图片一起插入了');
ok(/<center><img[^>]*><\/center>/.test(imgObj.html), '(9) 图片块是 <center> 居中的（与语料逐字一致，不是 div 包一层）');
ok(/<center><span style="color:#555555; font-size:0\.85rem;">龙年贺岁钞正面<\/span><\/center>/.test(imgObj.html),
  '(9)* 图注沿用语料的 <center>+#555555+0.85rem 写法');

// 超链接对话框
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>看这里</p>';
  const r=document.createRange();r.setStart(ed.querySelector('p').firstChild,0);r.setEnd(ed.querySelector('p').firstChild,3);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await clickSel('[data-tb="link"]');
const linkDlg = await json(`(()=>{const d=document.getElementById('tbDialog');
  return JSON.stringify({open:getComputedStyle(d).display!=='none',
    blank:(document.getElementById('tbF_blank')||{}).checked,
    url:(document.getElementById('tbF_url')||{}).value,
    urlPh:(document.getElementById('tbF_url')||{}).placeholder,
    textPh:(document.getElementById('tbF_text')||{}).placeholder});})()`);
ok(linkDlg.open === true, '(9) 链接按钮弹出对话框');
ok(linkDlg.blank === true, '(9) 默认勾上「新标签页打开」（语料 46 个链接里 32 个带 _blank）');
ok(linkDlg.url === '' && /^https:\/\//.test(linkDlg.urlPh),
  `(9)* 链接地址不预填 https://，只放在 placeholder 里（「${linkDlg.urlPh}」）`);
ok(/选中的文字/.test(linkDlg.textPh), `(9)* 链接文字留空即用选中的文字（placeholder「${linkDlg.textPh}」）`);
await evaluate(`(()=>{document.getElementById('tbF_url').value='https://www.bankofchina.com/';return 1;})()`);
await clickSel('#tbDialogOk');
const linkHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/<a href="https:\/\/www\.bankofchina\.com\/" target="_blank" rel="noopener">/.test(linkHtml),
  `(9)* 链接输出带 target="_blank" rel="noopener"（${linkHtml.replace(/\s+/g, ' ')}）`);

// ==============================================================
console.log('\n====== (10) 多图并排（照抄语料的 flex 行） ======\n');
await resetEditor();
const stackBtnText = await evaluate(`(document.querySelector('[data-tb="stack"]')||{}).textContent.trim()`);
ok(stackBtnText === '多图', `(10) 按钮文案是「多图」（实际「${stackBtnText}」，原来的「并排」已改名）`);
await clickSel('[data-tb="stack"]');
const stackDlg = await json(`(()=>{const d=document.getElementById('tbDialog');
  return JSON.stringify({open:getComputedStyle(d).display!=='none',
    title:(document.getElementById('tbDialogTitle')||{}).textContent,
    count:(document.getElementById('tbF_count')||{}).value,
    countPh:(document.getElementById('tbF_count')||{}).placeholder,
    mode:(document.getElementById('tbF_mode')||{}).value,
    modePh:(document.getElementById('tbF_mode')||{}).placeholder,
    size:(document.getElementById('tbF_size')||{}).value,
    sizePh:(document.getElementById('tbF_size')||{}).placeholder,
    src1:(document.getElementById('tbF_src1')||{}).value,
    src1Ph:(document.getElementById('tbF_src1')||{}).placeholder,
    hasSrc1:!!document.getElementById('tbF_src1'), hasSrc4:!!document.getElementById('tbF_src4'),
    hasCap1:!!document.getElementById('tbF_cap1'),
    hasSharedCap:!!document.getElementById('tbF_sharedCap'),
    sharedCapLabel:((document.querySelector('label[for="tbF_sharedCap"]')||{}).textContent||''),
    sharedCapValue:(document.getElementById('tbF_sharedCap')||{}).value||''});})()`);
ok(stackDlg.open === true, `(10) 点「多图」弹出对话框（标题「${stackDlg.title}」）`);
ok(stackDlg.count === '' && stackDlg.countPh === '2' && stackDlg.hasSrc1 && stackDlg.hasSrc4 && stackDlg.hasCap1,
  '(10)* 张数不预填（placeholder 2），对话框支持 2~4 张、每张都有地址，且保留每图单独的图注字段');
ok(stackDlg.hasSharedCap === true && /整行/.test(stackDlg.sharedCapLabel) && stackDlg.sharedCapValue === '',
  `(10)* 对话框默认提供「${stackDlg.sharedCapLabel.trim()}」输入框（不预填，留空=用选中的文字）`);
ok(stackDlg.mode === '' && stackDlg.modePh === 'height',
  `(10)* 尺寸模式不预填，默认值 height 只写在 placeholder 上（实际值「${stackDlg.mode}」）`);
ok(stackDlg.size === '' && stackDlg.sizePh === '180px',
  `(10)* 高度值不预填，默认 180px 写在 placeholder 上（取自语料 flex 容器的 height:180px）`);
ok(stackDlg.src1 === '' && /readmes\/image\//.test(stackDlg.src1Ph || ''),
  `(10)* 每张图的地址也不预填（placeholder「${stackDlg.src1Ph}」）`);

// 10a. 默认（整行共用一条图注）：图注在容器之后、只出现一次、且不生成每图的子 div
await evaluate(`(()=>{document.getElementById('tbF_count').value='3';
  document.getElementById('tbF_mode').value='height';
  document.getElementById('tbF_size').value='180px';
  document.getElementById('tbF_sharedCap').value='一分纸币的三个版别';
  document.getElementById('tbF_src1').value='readmes/image/rmb2/1953_2fen_1.jpg';
  document.getElementById('tbF_src2').value='readmes/image/rmb2/1953_2fen_2.png';
  document.getElementById('tbF_src3').value='readmes/image/rmb2/1953_2fen_3.jpg';
  return 1;})()`);
await clickSel('#tbDialogOk');
const stackH = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const row = ed.querySelector('div[style*="display:flex"]');
  const imgs = [...ed.querySelectorAll('img')];
  const styles = imgs.map(i => i.getAttribute('style') || '');
  const html = ed.innerHTML;
  const capIdx = html.indexOf('一分纸币的三个版别');
  return JSON.stringify({ hasRow: !!row,
    rowStyle: row ? row.getAttribute('style') : '', imgCount: imgs.length,
    imgStyles: styles,
    heights: styles.filter(s => /height:/.test(s)).length,
    capCount: html.split('一分纸币的三个版别').length - 1,
    capAfterFlex: capIdx > html.indexOf('display:flex'),
    innerDivs: row ? row.querySelectorAll('div').length : -1,
    captionTag: (()=>{ const s=[...ed.querySelectorAll('span')].find(x=>/一分纸币的三个版别/.test(x.textContent)); return s ? s.outerHTML : ''; })(),
    afterRow: row ? (row.nextElementSibling ? row.nextElementSibling.outerHTML : '') : '',
    code: document.getElementById('tbCode').value });
})()`);
console.log(`  flex 容器：<div style="${stackH.rowStyle}">`);
console.log(`  每张图：${JSON.stringify(stackH.imgStyles[0])}`);
console.log(`  行下图注：${stackH.captionTag}`);
ok(stackH.hasRow === true, '(10)* 生成了 flex 行容器');
ok(/display:flex/.test(stackH.rowStyle), '(10)* 容器是 display:flex（照抄语料那套）');
ok(/justify-content:center/.test(stackH.rowStyle) && /gap:20px/.test(stackH.rowStyle) && /flex-wrap:wrap/.test(stackH.rowStyle),
  '(10)* 容器的 justify-content:center / gap:20px / flex-wrap:wrap 与语料逐字一致');
ok(/width:80%/.test(stackH.rowStyle) && /margin:10px auto/.test(stackH.rowStyle),
  '(10)* 容器总宽 = 单图默认宽度 80%，并用 margin:10px auto 居中');
ok(stackH.imgCount === 3, `(10)* <img> 数量与实际张数一致（3 张，实际 ${stackH.imgCount}）`);
ok(stackH.heights === 3, `(10)* 同高度模式下每张图都带 height:（${stackH.heights}/3）`);
ok(/height:180px/.test(stackH.imgStyles[0]), `(10) 高度值按对话框里填的来（${stackH.imgStyles[0]}）`);
ok(/max-width:100%/.test(stackH.imgStyles[0]) && /width:auto/.test(stackH.imgStyles[0]),
  '(10) 同高度模式宽度自适应（width:auto + max-width:100%）');
ok(stackH.capCount === 1, `(10)* 整行共用的图注在 HTML 里只出现一次（实际 ${stackH.capCount} 次）`);
ok(stackH.capAfterFlex === true, '(10)* 图注排在 display:flex 容器**之后**（不放进容器里）');
ok(/^<center><span style="color:\s*#555555;\s*font-size:\s*0\.85rem;/.test(stackH.afterRow),
  `(10)* 行下图注沿用 <center> + #555555 + 0.85rem（${stackH.afterRow}）`);
ok(stackH.innerDivs === 0, `(10)* 不勾"每张图各自一条"时不生成多余的子 div（实际 ${stackH.innerDivs} 个）`);

// 10b. 每张图各自一条图注（可选能力）
await resetEditor();
await clickSel('[data-tb="stack"]');
await evaluate(`(()=>{document.getElementById('tbF_count').value='2';
  document.getElementById('tbF_mode').value='height';
  document.getElementById('tbF_size').value='180px';
  document.getElementById('tbF_sharedCap').value='';
  document.getElementById('tbF_src1').value='readmes/image/rmb2/1953_2fen_1.jpg';
  document.getElementById('tbF_cap1').value='一分纸币正面';
  document.getElementById('tbF_src2').value='readmes/image/rmb2/1953_2fen_2.png';
  document.getElementById('tbF_cap2').value='一分纸币背面';
  return 1;})()`);
await clickSel('#tbDialogOk');
const stackPer = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const row = ed.querySelector('div[style*="display:flex"]');
  const caps = [...ed.querySelectorAll('span')].map(s => s.textContent);
  return JSON.stringify({ innerDivs: row ? row.querySelectorAll('div').length : -1,
    caps: caps, hasCenter: /<center>/.test(ed.innerHTML),
    html: ed.innerHTML });
})()`);
ok(stackPer.innerDivs === 2, `(10) 每图单独图注时每张图各有一个 text-align:center 子 div（${stackPer.innerDivs} 个）`);
ok(stackPer.caps.length === 2 && /正面/.test(stackPer.caps[0]) && /背面/.test(stackPer.caps[1]),
  `(10) 每张图的图注各就各位（${JSON.stringify(stackPer.caps)}）`);
ok(stackPer.hasCenter === false, '(10) 每图单独图注时不额外再加一条整行图注');

// 10c. 同宽度模式：2 张，宽度用 calc 等分
await resetEditor();
await clickSel('[data-tb="stack"]');
await evaluate(`(()=>{document.getElementById('tbF_count').value='2';
  document.getElementById('tbF_mode').value='width';
  document.getElementById('tbF_size').value='';
  document.getElementById('tbF_sharedCap').value='';
  document.getElementById('tbF_src1').value='readmes/image/rmb2/1953_2fen_1.jpg';
  document.getElementById('tbF_src2').value='readmes/image/rmb2/1953_2fen_2.png';
  return 1;})()`);
await clickSel('#tbDialogOk');
const stackW = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const styles = [...ed.querySelectorAll('img')].map(i => i.getAttribute('style') || '');
  return JSON.stringify({ n: styles.length, styles: styles,
    calcs: styles.filter(s => s.indexOf('width:calc(') >= 0).length,
    code: document.getElementById('tbCode').value });
})()`);
console.log(`  同宽度：${JSON.stringify(stackW.styles[0])}`);
ok(stackW.n === 2 && stackW.calcs === 2, `(10)* 同宽度模式下每张图都带 width:calc(（${stackW.calcs}/2）`);
ok(/width:calc\(\(100% - 20px\) \/ 2\)/.test(stackW.styles[0]),
  `(10)* 等分公式把 gap 算进去了（(100% - (n-1)*20px) / n，实际 ${stackW.styles[0]}）`);

// 10d. 4 张也要能出（上限内）
await resetEditor();
await clickSel('[data-tb="stack"]');
await evaluate(`(()=>{document.getElementById('tbF_count').value='4';
  for (let i=1;i<=4;i++) document.getElementById('tbF_src'+i).value='readmes/image/rmb2/p'+i+'.jpg';
  return 1;})()`);
await clickSel('#tbDialogOk');
const stack4 = await evaluate(`document.querySelectorAll('#tbEditor img').length`);
ok(stack4 === 4, `(10) 4 张也支持（实际 ${stack4} 张，flex-wrap 会自动换行）`);

// ==============================================================
console.log('\n====== (11) 草稿自动保存 / 恢复提示条 ======\n');
await evaluate(`(()=>{try{localStorage.removeItem('collection.toolbox.draft');}catch(e){}; return 1;})()`);
await resetEditor();
await send('Input.insertText', { text: '这是没写完的草稿正文' });
await sleep(900);                       // 防抖 500ms，留足余量
const draft = await json(`(()=>{
  let raw = null; try { raw = localStorage.getItem('collection.toolbox.draft'); } catch(e) { raw = 'THREW'; }
  return JSON.stringify({ raw: raw, has: !!raw });
})()`);
ok(draft.has === true, '(11)* 输入后 localStorage 里出现了草稿 key（collection.toolbox.draft）');
ok(/没写完的草稿正文/.test(draft.raw || ''), `(11)* 草稿里带着刚写的内容（${String(draft.raw).slice(0, 60)}）`);
// 关掉再打开（**同一次会话**）：内容原样保留，且**不**提示草稿 —— 内容根本没丢。
// 只有刷新页面之后才提示（见下面那段 Page.reload）。
await evaluate(`window.__confirmCalled = 0; window.confirm = function(){ window.__confirmCalled++; return false; };`);
await evaluate(`toolboxClose()`);
await sleep(200);
await evaluate(`toolboxOpen()`);
await sleep(400);
const reopened = await json(`(()=>{
  const bar = document.getElementById('tbDraftBar');
  const ed = document.getElementById('tbEditor');
  return JSON.stringify({
    barHidden: bar.hidden,
    barText: (bar.textContent || '').replace(/\\s+/g, ' ').trim(),
    hasRestore: !!document.getElementById('tbDraftRestore'),
    hasDiscard: !!document.getElementById('tbDraftDiscard'),
    editorText: (ed.textContent || '').trim(),
    codeText: document.getElementById('tbCode').value,
    confirmCalled: window.__confirmCalled
  });
})()`);
console.log(`  同会话重开：提示条 hidden=${reopened.barHidden}，正文「${reopened.editorText}」`);
ok(reopened.editorText === '这是没写完的草稿正文',
  `(11)* 同一次会话里关掉再打开，内容原样保留（「${reopened.editorText}」）`);
ok(/没写完的草稿正文/.test(reopened.codeText), '(11)* 代码区也原样保留（没有被清空）');
ok(reopened.barHidden === true,
  '(11)* 同会话重开**不**提示草稿（内容没丢，提示条只会多余）');
ok(reopened.confirmCalled === 0, '(11)* 没有用 confirm 打断（只提示，不拦人）');
ok(reopened.hasRestore && reopened.hasDiscard, '(11) 提示条上「恢复」「丢弃」两个按钮一直在 DOM 里');
// ---- 刷新页面：会话标记没了 → 打开时编辑区是空的，这时才提示草稿 ----
await evaluate(`toolboxClose()`);
await sleep(150);
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 160; i++) {
  const r = await evaluate(`document.readyState === 'complete' && typeof onTabClick === 'function' && !!document.getElementById('toolboxOpenBtn')`).catch(() => false);
  if (r) break;
  await sleep(120);
}
await sleep(600);
await evaluate(`toolboxOpen()`);
await sleep(400);
const afterReload = await json(`(()=>{
  const bar = document.getElementById('tbDraftBar');
  const ed = document.getElementById('tbEditor');
  return JSON.stringify({
    barHidden: bar.hidden,
    barText: (bar.textContent || '').replace(/\\s+/g, ' ').trim(),
    editorText: (ed.textContent || '').trim(),
    codeText: document.getElementById('tbCode').value,
    winReady: !!toolboxWin.ready });
})()`);
console.log(`  刷新后重开：提示条「${afterReload.barText}」`);
ok(afterReload.editorText === '' && afterReload.codeText === '',
  '(11)* 刷新后打开时编辑区与代码区都是空的（不预置示例）');
ok(afterReload.barHidden === false && /草稿/.test(afterReload.barText),
  '(11)* 刷新后打开才出现「发现草稿」提示条');
ok(afterReload.winReady === true, '(11) 刷新后窗口回默认尺寸（同样被 toolboxWinApply 接管）');

// 点「恢复」
await clickSel('#tbDraftRestore');
const restored = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  return JSON.stringify({ text: (ed.textContent || '').trim(), barHidden: document.getElementById('tbDraftBar').hidden,
    code: document.getElementById('tbCode').value });
})()`);
ok(/没写完的草稿正文/.test(restored.text), `(11)* 点「恢复」后内容回来了（「${restored.text}」）`);
ok(restored.barHidden === true, '(11) 恢复后提示条自己收起来');
// 点「丢弃」：同样要"刷新后重开"才会出现提示条（同会话内不提示）
const reloadAndOpen = async () => {
  await evaluate(`toolboxClose()`).catch(() => {});
  await sleep(150);
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 160; i++) {
    const r = await evaluate(`document.readyState === 'complete' && typeof onTabClick === 'function' && !!document.getElementById('toolboxOpenBtn')`).catch(() => false);
    if (r) break;
    await sleep(120);
  }
  await sleep(600);
  await evaluate(`toolboxOpen()`);
  await sleep(350);
};
await reloadAndOpen();
const barAgain = await evaluate(`document.getElementById('tbDraftBar').hidden`);
ok(barAgain === false, '(11) 再刷新一次：草稿还在，提示条又出现（「恢复」不会顺手删草稿）');
await clickSel('#tbDraftDiscard');
const discarded = await json(`(()=>{
  let raw = null; try { raw = localStorage.getItem('collection.toolbox.draft'); } catch(e) {}
  return JSON.stringify({ raw: raw, barHidden: document.getElementById('tbDraftBar').hidden,
    editor: (document.getElementById('tbEditor').textContent || '').trim() });
})()`);
ok(discarded.raw === null && discarded.barHidden === true, '(11)* 点「丢弃」后草稿真的被删掉了');
ok(discarded.editor === '', '(11) 丢弃后编辑区是空的（没有被灌进任何内容）');
// 草稿已经删了：再刷新重开**不该**再出现提示条
await reloadAndOpen();
const afterDiscardReload = await evaluate(`document.getElementById('tbDraftBar').hidden`);
ok(afterDiscardReload === true, '(11)* 草稿删掉之后，刷新重开不再提示');
// 「清空并删除草稿」要防误触：第一次点只是换个文案，第二次才真清。
// ★ 这里必须手动派发 input 事件：草稿是靠编辑区的 input/keyup 触发的，
//   用 innerHTML 直接塞内容浏览器不会发 input，草稿永远不会被调度（这是测试侧的坑，不是功能坏）。
const typeIntoEditor = (text) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>'+${JSON.stringify(text)}+'</p>';
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();
  ed.dispatchEvent(new Event('input',{bubbles:true}));
  return 1;})()`);
await typeIntoEditor('待清空内容');
await sleep(800);
const beforeClear = await evaluate(`(localStorage.getItem('collection.toolbox.draft')||'').length`);
ok(beforeClear > 0, `(11) 清空前草稿已存下来（${beforeClear} 字符）`);
const clearClick1 = await json(`(()=>{const b=document.querySelector('[data-tb="cleardraft"]'); const t0=b.textContent;
  b.click(); return JSON.stringify({ before:t0, after:b.textContent,
    draftStill: (localStorage.getItem('collection.toolbox.draft')||'').length,
    editor: (document.getElementById('tbEditor').textContent||'').trim() });})()`);
ok(clearClick1.after !== clearClick1.before && /再点一次/.test(clearClick1.after),
  `(11)* 第一次点只是二次确认（按钮变成「${clearClick1.after}」），内容与草稿都还在`);
ok(clearClick1.draftStill > 0 && clearClick1.editor === '待清空内容', '(11)* 确认前什么都没删');
const clearClick2 = await json(`(()=>{const b=document.querySelector('[data-tb="cleardraft"]');
  b.click();
  return JSON.stringify({ editor:(document.getElementById('tbEditor').textContent||'').trim(),
    draft: localStorage.getItem('collection.toolbox.draft'),
    label: b.textContent });})()`);
ok(clearClick2.editor === '' && clearClick2.draft === null,
  '(11)* 第二次点才真的清空编辑区并删掉草稿');
ok(/^清空$/.test(clearClick2.label.trim()), `(11) 清空后按钮文案复位成「清空」（${clearClick2.label}）`);
// 复制/下载之后草稿必须还在（用户可能还在改）
await typeIntoEditor('复制后草稿要留着');
await sleep(800);
const draftBeforeOutput = await evaluate(`(localStorage.getItem('collection.toolbox.draft')||'')`);
ok(/复制后草稿要留着/.test(draftBeforeOutput), '(11) 复制/下载前草稿已在');
await clickSel('[data-tb="copy"]');
await clickSel('[data-tb="download"]');
const afterOutput = await evaluate(`(localStorage.getItem('collection.toolbox.draft')||'')`);
ok(/复制后草稿要留着/.test(afterOutput), '(11)* 复制/下载之后草稿**没有**被删（用户还要接着改）');

// ==============================================================
console.log('\n====== (12) 复制 HTML / 下载 .html ======\n');
const copyInfo = await json(`(()=>{const b=document.querySelector('[data-tb="copy"]');
  return JSON.stringify({text:b.textContent.trim(),exists:!!b});})()`);
ok(copyInfo.exists === true, `(12) 复制按钮存在（「${copyInfo.text}」）`);
// 已经删掉了 navigator.clipboard，所以走的是 execCommand('copy') 兜底那条路
const copyRes = await json(`(async ()=>{
  let threw = null;
  try { window.__tbCopyRet = toolboxCopyHtml(); } catch (e) { threw = String(e && e.message); }
  await new Promise(r => setTimeout(r, 260));
  const toast = document.getElementById('tbToast');
  return JSON.stringify({ threw: threw, ret: String(window.__tbCopyRet),
    toastShown: toast.classList.contains('show'), toastText: (toast.textContent || '').slice(0, 60),
    codeLen: document.getElementById('tbCode').value.length });
})()`);
ok(copyRes.threw === null, `(12)* 调复制不抛异常（返回值 ${copyRes.ret}）`);
ok(copyRes.codeLen > 0, `(12) 复制的是代码区里那份 HTML（${copyRes.codeLen} 个字符）`);
ok(copyRes.toastShown === true, `(12) 复制后有明确反馈（提示：「${copyRes.toastText}」）`);
// 也走一遍真点击，确认按钮的 click 链路通
await clickSel('[data-tb="copy"]');
const copyToast2 = await json(`(()=>{const t=document.getElementById('tbToast');
  return JSON.stringify({shown:t.classList.contains('show'),text:(t.textContent||'').slice(0,60)});})()`);
ok(copyToast2.shown === true, `(12)* 真点按钮也走通了（提示：「${copyToast2.text}」）`);

await clickSel('[data-tb="download"]');
const dl = await json(`(()=>{const t=document.getElementById('tbToast');
  return JSON.stringify({ name: window.__tbDownloaded || '', text: (t.textContent||'').slice(0, 60) });})()`);
ok(dl.name === 'Untitled.html',
  `(12)* 左上角文件名留空 → 下载就用 Untitled.html（${dl.name}）`);
ok(/下载|download/i.test(dl.text), `(12) 下载有提示（${dl.text}）`);
// 文件名清洗 + 后缀规则（留空/非法字符/已带后缀三种情况）
const nameRules = await json(`(()=>{
  const inp = document.getElementById('tbFileName');
  const before = inp.value;
  const out = {};
  inp.value = ''; out.empty = toolboxFileName();
  inp.value = '  我的 报告 / 2024 : 版 * ';
  out.dirty = toolboxFileName();
  inp.value = 'archive.htm'; out.htm = toolboxFileName();
  inp.value = 'notes.html'; out.html = toolboxFileName();
  inp.value = 'noext'; out.append = toolboxFileName();
  inp.value = 'report.final.v2'; out.customExt = toolboxFileName();
  inp.value = before;
  return JSON.stringify(out);
})()`);
console.log(`  文件名规则：${JSON.stringify(nameRules)}`);
ok(nameRules.empty === 'Untitled.html', `(12)* 空值回落 Untitled.html（${nameRules.empty}）`);
ok(nameRules.dirty === '我的 报告 2024 版.html',
  `(12)* 非法字符 / \\\\ : * ? " < > | 被清掉、首尾空白去掉、补 .html（${nameRules.dirty}）`);
ok(nameRules.htm === 'archive.htm' && nameRules.html === 'notes.html',
  `(12)* 用户写了扩展名就原样用，不改写后缀（${nameRules.htm} / ${nameRules.html}）`);
ok(nameRules.append === 'noext.html', `(12)* 没写扩展名才补 .html（noext → ${nameRules.append}）`);
ok(nameRules.customExt === 'report.final.v2', `(12)* 任意已有扩展名都保留（${nameRules.customExt}）`);
// 真下载时用的是清洗后的名字
await evaluate(`(()=>{document.getElementById('tbFileName').value=' 我的/报告:2024 ';return 1;})()`);
await clickSel('[data-tb="download"]');
const dl2 = await evaluate(`window.__tbDownloaded || ''`);
ok(dl2 === '我的报告2024.html', `(12)* 下载用的是清洗后的文件名（${dl2}）`);
await evaluate(`(()=>{document.getElementById('tbFileName').value='';return 1;})()`);

// ==============================================================
console.log('\n====== (13) 关闭干净：Esc / 点遮罩，不留监听泄漏 ======\n');
// 探针只挂在两个元素上，而且**只在编辑区上派发一次** keyup：
// 事件会冒泡，所以一次派发应该正好打到两个探针（编辑区 1 次 + 弹窗 1 次）。
// 若"每次打开都重新挂一遍监听"，这个数会一轮轮变大（2 → 4 → 6…）。
const probeArm = () => json(`(()=>{
  window.__tbProbe = 0;
  const ed = document.getElementById('tbEditor');
  const mod = document.getElementById('toolboxModal');
  const probe = function () { window.__tbProbe++; };
  ed.addEventListener('keyup', probe);
  mod.addEventListener('keyup', probe);
  return JSON.stringify({ tag: 'armed', before: window.__tbProbe });
})()`);
const probeFire = () => json(`(()=>{
  document.getElementById('tbEditor').dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  return JSON.stringify({ probe: window.__tbProbe });
})()`);
const armed = await probeArm();
ok(armed.tag === 'armed', '(13) 监听泄漏探针就位');

const preEsc = await json(`(()=>{
  const mod = document.getElementById('toolboxModal');
  window.__escSeen = 0; window.__escDocSeen = 0;
  mod.addEventListener('keydown', function(e){ if (e.key === 'Escape') window.__escSeen++; }, true);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') window.__escDocSeen++; }, true);
  const a = document.activeElement;
  return JSON.stringify({ display: getComputedStyle(mod).display,
    active: a ? (a.tagName + '#' + (a.id||'') + '.' + (a.className||'')) : 'none',
    inModal: !!(a && mod.contains(a)) });
})()`);
console.log('  Esc 前：' + JSON.stringify(preEsc));

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(320);
console.log('  Esc 被看到：' + await evaluate(`JSON.stringify({modal: window.__escSeen, doc: window.__escDocSeen})`));
const afterEsc = await json(`(()=>{
  const mod = document.getElementById('toolboxModal');
  return JSON.stringify({ display: getComputedStyle(mod).display,
    locked: document.body.classList.contains('tb-modal-open'),
    dialogOpen: getComputedStyle(document.getElementById('tbDialog')).display !== 'none',
    draftBarHidden: document.getElementById('tbDraftBar').hidden });
})()`);
ok(afterEsc.display === 'none', '(13)* Esc 关掉了弹窗');
ok(afterEsc.locked === false, '(13) 关闭后背景滚动锁被摘掉（body.tb-modal-open 已移除）');
ok(afterEsc.dialogOpen === false, '(13) Esc 之后字段对话框也是关着的');

const cycle1 = await json(`(()=>{toolboxOpen(); return JSON.stringify({});})()`);
const fire1 = await probeFire();
await evaluate(`toolboxClose()`);
await sleep(120);
await json(`(()=>{toolboxOpen(); return JSON.stringify({});})()`);
const fire2 = await probeFire();
ok(fire2.probe - fire1.probe === 2,
  `(13)* 来回开关不重复挂监听（第二次只多了 ${fire2.probe - fire1.probe} 次，恒为 2：编辑区 1 + 冒泡到弹窗 1）`);

// 点遮罩关闭
const maskInfo = await json(`(()=>{const mod=document.getElementById('toolboxModal');const r=mod.getBoundingClientRect();
  return JSON.stringify({x:r.left+6,y:r.top+6});})()`);
await clickAt(maskInfo.x, maskInfo.y);
await sleep(300);
const afterMask = await evaluate(`getComputedStyle(document.getElementById('toolboxModal')).display`);
ok(afterMask === 'none', '(13)* 点遮罩也关得掉');

// 关掉之后主站还得是活的（下拉栏 / Tab / 设置页）
const mainAlive = await json(`(()=>{
  const sels = [...document.querySelectorAll('select')];
  const visible = sels.filter(s => getComputedStyle(s).display !== 'none');
  return JSON.stringify({
    settings: !!document.querySelector('.settings-page'),
    tabs: document.querySelectorAll('.tab-item').length,
    selects: sels.length,
    visibleSelects: visible.length,
    ddCount: document.querySelectorAll('.dd').length,
    bodyLocked: document.body.classList.contains('tb-modal-open'),
    modalOpen: document.body.classList.contains('modal-open')
  });
})()`);
console.log(`  主站状态：设置页=${mainAlive.settings} Tab=${mainAlive.tabs} 原生select=${mainAlive.selects}(可见${mainAlive.visibleSelects}) 自绘下拉=${mainAlive.ddCount}`);
ok(mainAlive.settings === true && mainAlive.tabs === 5, '(13) 关掉工具箱后「我的」页面与底部 Tab 都还在');
ok(mainAlive.visibleSelects === 0 && mainAlive.ddCount > 0, '(13) 下拉栏仍是自绘顶上、原生藏着的既有状态（没被工具箱改坏）');
ok(mainAlive.bodyLocked === false && mainAlive.modalOpen === false, '(13) 没有留下任何滚动锁');

// ==============================================================
console.log('\n====== (14) 像窗口一样：拖动 / 八向缩放 / 全屏 ======\n');
const clearDraft = () => evaluate(`(()=>{try{localStorage.removeItem('collection.toolbox.draft');}catch(e){};return 1;})()`);
await clearDraft();
await evaluate(`toolboxOpen()`);
await sleep(360);

// 拖动辅助：按下 → 分几步移动（真鼠标事件会给出一串 pointermove）→ 抬起
async function dragBy(x, y, dx, dy) {
    const steps = 6;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', buttons: 0, clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
        await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', button: 'left', buttons: 1, clickCount: 0,
            x: Math.round(x + dx * i / steps), y: Math.round(y + dy * i / steps)
        });
        await sleep(14);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x + dx), y: Math.round(y + dy), button: 'left', buttons: 0, clickCount: 1 });
    await sleep(140);
}
const cardBox = () => json(`(()=>{const c=document.querySelector('.tb-card');const r=c.getBoundingClientRect();
  return JSON.stringify({l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
    grips:[...c.querySelectorAll('[data-tb-grip]')].map(g=>g.getAttribute('data-tb-grip'))});})()`);
const gripPoint = (dir) => json(`(()=>{const g=document.querySelector('[data-tb-grip="${dir}"]');const r=g.getBoundingClientRect();
  const el=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
  return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,hit: el ? (el.getAttribute('data-tb-grip')||el.className||el.tagName) : null});})()`);

const base = await cardBox();
console.log(`  默认窗口：${base.w}x${base.h} @ (${base.l},${base.t})；手柄 ${base.grips.join('/')}`);
ok(base.grips.length === 8, `(14) 八个手柄都在 DOM 里（${base.grips.join('/')}）`);
for (const d of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
    ok(base.grips.indexOf(d) >= 0, `(14) 手柄「${d}」存在`);
}
ok(base.w > 1300 && base.h > 700, `(14) 打开时是默认的居中大窗口（${base.w}x${base.h}）`);

// ★ 先把窗口缩小：默认尺寸已经是 min(1400px,96vw)，几乎占满视口宽度，
//   这时往右/往下拖都会被"不许拖出屏幕"的夹取拦住（能拖动的距离是 0），
//   所以先缩到一个有余量的尺寸，后面每一步拖动都能真的走满。
const pe0 = await gripPoint('e');
await dragBy(pe0.x, pe0.y, -300, 0);
const ps0 = await gripPoint('s');
await dragBy(ps0.x, ps0.y, 0, -200);
const shrunk = await cardBox();
console.log(`  先缩小到：${shrunk.w}x${shrunk.h} @ (${shrunk.l},${shrunk.t})`);
ok(shrunk.w < base.w - 200 && shrunk.h < base.h - 150, `(14) 预置：窗口已缩小（${shrunk.w}x${shrunk.h}）`);

// ① 拖动标题栏。★ 落点必须挑"空白处"：标题栏左边是文件名输入框、右边是全屏/关闭按钮，
//    在这三处按下都**不该**触发拖动（下面一条用例专门验它）。
const headPt = await json(`(()=>{const h=document.getElementById('tbHead');const r=h.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width*0.55),y:Math.round(r.top+r.height/2)});})()`);
await dragBy(headPt.x, headPt.y, 70, 46);
const moved = await cardBox();
console.log(`  拖动后：(${moved.l},${moved.t})，尺寸 ${moved.w}x${moved.h}`);
ok(Math.abs(moved.l - (shrunk.l + 70)) <= 3 && Math.abs(moved.t - (shrunk.t + 46)) <= 3,
  `(14)* 按住标题栏拖动，窗口位置跟着走（Δ=${moved.l - shrunk.l},${moved.t - shrunk.t}）`);
ok(moved.w === shrunk.w && moved.h === shrunk.h, '(14) 拖动只改位置，不改尺寸');
// 标题栏左侧的文件名输入框 / 右侧的按钮上按下：不许拖动窗口（否则"点关闭"会变成"拖窗口"）
const noDragSpots = await json(`(()=>{const h=document.getElementById('tbHead');const r=h.getBoundingClientRect();
  const inp=document.getElementById('tbFileName').getBoundingClientRect();
  const btn=document.getElementById('tbFullBtn').getBoundingClientRect();
  return JSON.stringify({ix:Math.round(inp.left+inp.width/2),iy:Math.round(inp.top+inp.height/2),
    bx:Math.round(btn.left+btn.width/2),by:Math.round(btn.top+btn.height/2),
    hx:Math.round(r.left+r.width/2),hy:Math.round(r.top+r.height/2)});})()`);
const posBeforeNoDrag = await cardBox();
await dragBy(noDragSpots.ix, noDragSpots.iy, 60, 40);
const afterInputDrag = await cardBox();
ok(afterInputDrag.l === posBeforeNoDrag.l && afterInputDrag.t === posBeforeNoDrag.t,
  `(14)* 在文件名输入框上拖动不会挪窗口（${posBeforeNoDrag.l},${posBeforeNoDrag.t} → ${afterInputDrag.l},${afterInputDrag.t}）`);
await dragBy(noDragSpots.bx, noDragSpots.by, 60, 40);
const afterBtnDrag = await cardBox();
ok(afterBtnDrag.l === afterInputDrag.l && afterBtnDrag.t === afterInputDrag.t,
  '(14)* 在全屏按钮上拖动也不会挪窗口（点按钮不会被当成拖标题栏）');
const headerLayout = await json(`(()=>{const h=document.getElementById('tbHead').getBoundingClientRect();
  const inp=document.getElementById('tbFileName').getBoundingClientRect();
  const fs=document.getElementById('tbFullBtn').getBoundingClientRect();
  const cl=document.querySelector('.tb-close').getBoundingClientRect();
  return JSON.stringify({inpLeft:Math.round(inp.left-h.left), inpW:Math.round(inp.width),
    fsRight:Math.round(h.right-fs.right), clRight:Math.round(h.right-cl.right),
    fsBeforeClose: fs.left < cl.left,
    btnH:Math.round(fs.height), closeW:Math.round(cl.width)});})()`);
console.log(`  标题栏布局：文件名左 ${headerLayout.inpLeft}px 宽 ${headerLayout.inpW}px；全屏距右 ${headerLayout.fsRight}px、关闭距右 ${headerLayout.clRight}px`);
ok(headerLayout.inpW >= 200 && headerLayout.inpW <= 260,
  `(14)* 文件名输入框宽度合理（${headerLayout.inpW}px，200~260 之间，不铺满整行）`);
ok(headerLayout.fsBeforeClose && headerLayout.clRight <= 16 && headerLayout.fsRight > headerLayout.clRight,
  `(14)* 全屏与关闭都在标题栏最右上角（全屏距右 ${headerLayout.fsRight}px、关闭距右 ${headerLayout.clRight}px）`);
ok(headerLayout.btnH <= 30 && headerLayout.closeW <= 30,
  `(14)* 右上角两个按钮是紧凑尺寸（全屏高 ${headerLayout.btnH}px、关闭宽 ${headerLayout.closeW}px）`);

// ② 拖右边手柄：只改宽
const beforeE = await cardBox();
const pe = await gripPoint('e');
ok(pe.hit === 'e', `(14) 东侧手柄在最上层、点得到（elementFromPoint 命中「${pe.hit}」）`);
await dragBy(pe.x, pe.y, 60, 0);
const afterE = await cardBox();
ok(Math.abs(afterE.w - (beforeE.w + 60)) <= 3, `(14)* 拖右边：宽度 +60（${beforeE.w}→${afterE.w}）`);
ok(afterE.h === beforeE.h, `(14)* 拖右边：高度不变（${afterE.h}）`);
ok(afterE.l === beforeE.l && afterE.t === beforeE.t, '(14) 拖右边：左上角原点不动');

// ③ 拖下边手柄：只改高
const beforeS = await cardBox();
const ps = await gripPoint('s');
ok(ps.hit === 's', `(14) 南侧手柄在最上层、点得到（命中「${ps.hit}」）`);
await dragBy(ps.x, ps.y, 0, 50);
const afterS = await cardBox();
ok(Math.abs(afterS.h - (beforeS.h + 50)) <= 3, `(14)* 拖下边：高度 +50（${beforeS.h}→${afterS.h}）`);
ok(afterS.w === beforeS.w, `(14)* 拖下边：宽度不变（${afterS.w}）`);
ok(afterS.l === beforeS.l && afterS.t === beforeS.t, '(14) 拖下边：左上角原点不动');

// ④ 拖左边手柄：宽度变化 + 原点跟着移（右边不动）
const beforeW = await cardBox();
const pw = await gripPoint('w');
await dragBy(pw.x, pw.y, -70, 0);
const afterW = await cardBox();
const rightBefore = beforeW.l + beforeW.w, rightAfter = afterW.l + afterW.w;
console.log(`  拖左边：(${beforeW.l},${beforeW.w}) → (${afterW.l},${afterW.w})；右边界 ${rightBefore} → ${rightAfter}`);
ok(afterW.l < beforeW.l && afterW.w > beforeW.w,
  `(14)* 拖左边：原点左移（${beforeW.l}→${afterW.l}）且宽度变大（${beforeW.w}→${afterW.w}）`);
ok(Math.abs(rightAfter - rightBefore) <= 3, `(14)* 拖左边：右边界不动（${rightBefore} → ${rightAfter}，容差 3px）`);

// ⑤ 拖上边手柄：高度变化 + 原点跟着移（下边不动）
const beforeN = await cardBox();
const pn = await gripPoint('n');
await dragBy(pn.x, pn.y, 0, 40);
const afterN = await cardBox();
const bottomBefore = beforeN.t + beforeN.h, bottomAfter = afterN.t + afterN.h;
ok(afterN.t > beforeN.t && afterN.h < beforeN.h,
  `(14)* 拖上边：原点下移（${beforeN.t}→${afterN.t}）且高度变小（${beforeN.h}→${afterN.h}）`);
ok(Math.abs(bottomAfter - bottomBefore) <= 3, `(14)* 拖上边：下边界不动（${bottomBefore} → ${bottomAfter}）`);

// ⑥ 拖右下角：等比缩放
const beforeSE = await cardBox();
const ratioBefore = beforeSE.w / beforeSE.h;
const pse = await gripPoint('se');
await dragBy(pse.x, pse.y, 90, 30);
const afterSE = await cardBox();
const ratioAfter = afterSE.w / afterSE.h;
console.log(`  拖右下角：${beforeSE.w}x${beforeSE.h} → ${afterSE.w}x${afterSE.h}；宽高比 ${ratioBefore.toFixed(3)} → ${ratioAfter.toFixed(3)}`);
ok(afterSE.w > beforeSE.w && afterSE.h > beforeSE.h, `(14)* 拖右下角：宽高都变大（${beforeSE.w}x${beforeSE.h} → ${afterSE.w}x${afterSE.h}）`);
ok(Math.abs(ratioAfter / ratioBefore - 1) <= 0.05,
  `(14)* 拖右下角：保持宽高比（偏差 ${(Math.abs(ratioAfter / ratioBefore - 1) * 100).toFixed(2)}%，容差 5%）`);

// ⑦ 拖左上角：也是等比（这一条专门盯"原点跟着动"的那一路）
const beforeNW = await cardBox();
const rNWBefore = beforeNW.w / beforeNW.h;
const pnw = await gripPoint('nw');
await dragBy(pnw.x, pnw.y, -60, -20);
const afterNW = await cardBox();
ok(Math.abs((afterNW.w / afterNW.h) / rNWBefore - 1) <= 0.05,
  `(14) 拖左上角同样等比（${beforeNW.w}x${beforeNW.h} → ${afterNW.w}x${afterNW.h}）`);
ok(afterNW.l <= beforeNW.l && afterNW.t <= beforeNW.t, '(14) 拖左上角：左/上原点跟着动');

// ⑧ 最小尺寸：往左上拖到极小也不能小于 480x320（等比时最小约束同时作用到宽和高）
const pse2 = await gripPoint('se');
await dragBy(pse2.x, pse2.y, -3000, -3000);
const minBox = await cardBox();
ok(minBox.w >= 480 - 1 && minBox.h >= 320 - 1, `(14)* 缩到最小也不小于 480x320（实际 ${minBox.w}x${minBox.h}）`);

// ⑨ 全屏 / 还原
const beforeFull = await cardBox();
await clickSel('#tbFullBtn');
const fullBox = await json(`(()=>{const c=document.querySelector('.tb-card');const r=c.getBoundingClientRect();
  return JSON.stringify({l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
    vw:window.innerWidth,vh:window.innerHeight, cls:c.classList.contains('tb-full')});})()`);
console.log(`  全屏：${fullBox.w}x${fullBox.h} @ (${fullBox.l},${fullBox.t})，视口 ${fullBox.vw}x${fullBox.vh}`);
ok(fullBox.cls === true && fullBox.l === 0 && fullBox.t === 0 && Math.abs(fullBox.w - fullBox.vw) <= 2 && Math.abs(fullBox.h - fullBox.vh) <= 2,
  `(14)* 点全屏后铺满视口（${fullBox.w}x${fullBox.h}）`);
await clickSel('#tbFullBtn');
const restoredWin = await cardBox();
ok(restoredWin.cls !== true && restoredWin.l === beforeFull.l && restoredWin.t === beforeFull.t
   && restoredWin.w === beforeFull.w && restoredWin.h === beforeFull.h,
  `(14)* 再点一次回到**原来的**尺寸与位置（不是回到初始值）：${restoredWin.w}x${restoredWin.h} @ (${restoredWin.l},${restoredWin.t})`);

// ⑨ 会话内保留：关掉再打开保持刚才那套尺寸位置（刷新页面才回默认尺寸，见 (11) 与 (18d)）
const beforeReopen = await cardBox();
await evaluate(`toolboxClose()`);
await sleep(150);
await evaluate(`toolboxOpen()`);
await sleep(320);
const reopenedWin = await cardBox();
const stores = await json(`(()=>{
  const keys = [];
  try { for (let i=0;i<localStorage.length;i++) keys.push(localStorage.key(i)); } catch(e) {}
  return JSON.stringify({ keys: keys });
})()`);
console.log(`  重开后：${reopenedWin.w}x${reopenedWin.h} @ (${reopenedWin.l},${reopenedWin.t})；localStorage keys=${JSON.stringify(stores.keys)}`);
ok(reopenedWin.w === beforeReopen.w && reopenedWin.h === beforeReopen.h
   && reopenedWin.l === beforeReopen.l && reopenedWin.t === beforeReopen.t,
  `(14)* 同一次会话里关掉再打开，保持上次拖动/缩放后的尺寸位置（${reopenedWin.w}x${reopenedWin.h} @ ${reopenedWin.l},${reopenedWin.t}）`);
ok(!stores.keys.some(k => /window|geometry|win(pos|size)?/i.test(k)),
  `(14)* 窗口几何**没有**进任何存储（只用内存变量，刷新后回默认：${JSON.stringify(stores.keys)}）`);

// ==============================================================
console.log('\n====== (15) 代码区可编辑：实时双向同步 + 校验 + 撤回/恢复 ======\n');
// 15a 代码区 → 编辑区：真键盘输入进代码区，等防抖，编辑区应该自己跟上（不用点任何按钮）
await clearDraft();
await evaluate(`toolboxClose()`);
await sleep(140);
await evaluate(`toolboxOpen()`);
await sleep(320);
const openEmpty = await json(`(()=>{const ed=document.getElementById('tbEditor'),c=document.getElementById('tbCode');
  return JSON.stringify({editor:(ed.textContent||'').trim(), code:c.value});})()`);
// ★ 注意：打开时"清空编辑区"只在**页面刷新后第一次打开**发生（同会话内关掉再打开是原样保留的，
//   见 (11)）。这一节跑在前面的用例之后，所以这里用「清空」按钮显式把两份都清干净，
//   顺便也就把"清空 = 真清空 + 删草稿"再验一遍。
await evaluate(`(()=>{const b=document.querySelector('[data-tb="cleardraft"]');b.click();b.click();return 1;})()`);
await sleep(200);
const cleared = await json(`(()=>{const ed=document.getElementById('tbEditor'),c=document.getElementById('tbCode');
  return JSON.stringify({editor:(ed.textContent||'').trim(), code:c.value,
    draft:(function(){try{return localStorage.getItem('collection.toolbox.draft');}catch(e){return 'THREW';}})()});})()`);
ok(cleared.editor === '' && cleared.code === '' && cleared.draft === null,
  `(15)* 点「清空」后编辑区、代码区、草稿都清干净了（草稿=${cleared.draft === null ? 'null' : '还在'}）`);
ok(openEmpty.editor !== undefined, '(15) 打开后能读到编辑区状态（前置检查）');
await evaluate(`(()=>{const c=document.getElementById('tbCode');c.value='';c.focus();return 1;})()`);
await send('Input.insertText', { text: '<center><b><span style="font-size:1.1em;">导入的标题</span></b></center>\n<table><tr><th>栏</th></tr><tr><td>值</td></tr></table>' });
await sleep(700);                                    // 防抖 350ms，留足余量
const syncIn = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ table:!!ed.querySelector('table'), th:!!ed.querySelector('th'),
    title:(ed.querySelector('b')||{}).textContent||'', code:document.getElementById('tbCode').value });})()`);
ok(syncIn.table === true && syncIn.th === true, '(15)* 在代码区输入 HTML → 编辑区自动出现 <table>（无需按钮）');
ok(syncIn.title === '导入的标题', `(15) 标题结构也解析进去了（「${syncIn.title}」）`);
ok(syncIn.code.indexOf('导入的标题') >= 0 && syncIn.code.indexOf('<table>') >= 0,
  '(15)* 代码区保留用户写下的原文（不会被归一化回写覆盖）');

// 15b 编辑区 → 代码区：仍然是归一化 + 按行排版后的那份（这条是"导出"）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await send('Input.insertText', { text: '补一句' });
await sleep(400);
const syncOut = await json(`(()=>{const c=document.getElementById('tbCode').value;
  const lines=c.split('\\n');
  return JSON.stringify({ code:c, lines:lines.length,
    blank:lines.filter(function(l){return !l.trim();}).length,
    lead:lines.filter(function(l){return /^[ \\t]/.test(l);}).length,
    centerLine:lines.some(function(l){return /^<center>/.test(l);}),
    tableLine:lines.some(function(l){return /^<table>/.test(l);}) });})()`);
ok(/补一句/.test(syncOut.code), '(15)* 编辑区改动 → 代码区实时更新');
ok(syncOut.lines > 1, `(15)* 生成的 HTML 按行排版，不是挤成一行（${syncOut.lines} 行）`);
ok(syncOut.centerLine && syncOut.tableLine,
  '(15)* 每个顶层块各占一行（<center>… 与 <table> 都从行首开始）');
ok(syncOut.lead === 0, `(15) 行首不缩进（与 readmes/ 现有文章一致，缩进行数 ${syncOut.lead}）`);
ok(syncOut.blank === 0, `(15) 没有多余空行（空行 ${syncOut.blank} 行）`);
console.log('  导出样例：\n' + syncOut.code.split('\n').slice(0, 8).map(l => '    ' + l).join('\n'));

// 15b2 行内之间**不许**插换行（插了会被 HTML 折叠成空格，凭空改坏排版）
const inlineCase = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<center><b>甲</b><b>乙</b></center>';
  toolboxRefresh();
  const c = document.getElementById('tbCode').value;
  const m = c.match(/<center>([\\s\\S]*?)<\\/center>/);
  return JSON.stringify({ code: c, inner: m ? m[1] : null });
})()`);
console.log(`  行内场景：${JSON.stringify(inlineCase.code)}`);
ok(inlineCase.inner !== null && inlineCase.inner.indexOf('\n') < 0,
  '(15)* <center> 内部并排的行内节点之间**没有**换行（否则会多出空格）');
ok(/<b>甲<\/b><b>乙<\/b>/.test(inlineCase.code), '(15) 行内节点原样相邻输出');
// flex 行（并排图片）也整体保持一行
const flexCase = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<div style="display:flex; justify-content:center; gap:20px; flex-wrap:wrap; margin:10px auto; width:80%;"><img src="readmes/image/a.jpg" style="height:180px; width:auto; max-width:100%;"><img src="readmes/image/b.jpg" style="height:180px; width:auto; max-width:100%;"></div>';
  toolboxRefresh();
  const c = document.getElementById('tbCode').value;
  return JSON.stringify({ code: c, lines: c.split('\\n').length });
})()`);
ok(flexCase.lines === 1, `(15)* 并排图片的 flex 容器内部不插换行（${flexCase.lines} 行）`);

// 15b3 粘贴富文本的去杂质：Word 那种 class/id/px 字号
const pasteCase = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<p class="MsoNormal" id="x" data-x="1"><span style="font-family:Calibri; font-size:15.2px; mso-fareast-font-family:宋体;">粘贴来的一段</span></p>';
  toolboxRefresh();
  return JSON.stringify({ code: document.getElementById('tbCode').value });
})()`);
console.log(`  粘贴杂质：${JSON.stringify(pasteCase.code)}`);
ok(!/class=|id=|data-x|MsoNormal/.test(pasteCase.code), '(15)* 粘贴带进来的 class/id 被清掉');
ok(!/mso-/.test(pasteCase.code), '(15)* Word 专属的 mso-* 声明被清掉');
ok(/font-size:\s*\.?0?\.?95em/.test(pasteCase.code),
  `(15)* 15.2px 字号就近归一化成 .95em（站内刻度）`);
ok(/粘贴来的一段/.test(pasteCase.code), '(15) 文字本身一个字没丢');

// 15c 校验：错配标签 / script / 正常
const setCode = async (t) => {
    await evaluate(`(()=>{const c=document.getElementById('tbCode');c.value=${JSON.stringify(t)};
      c.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
    await sleep(120);
    return json(`(()=>{const v=document.getElementById('tbValidate');
      return JSON.stringify({errors:+v.getAttribute('data-errors'),warnings:+v.getAttribute('data-warnings'),
        text:(v.textContent||'').replace(/\\s+/g,' ').slice(0,120)});})()`);
};
const lintBad = await setCode('<div><span>配错</div>');
console.log(`  错配标签 → ${JSON.stringify(lintBad)}`);
ok(lintBad.errors >= 1, `(15)* 标签错配 → 校验区报错（${lintBad.errors} 条：「${lintBad.text}」）`);
const lintScript = await setCode('<p>正文</p><script>alert(1)</script>');
ok(lintScript.errors >= 1, `(15)* 含 <script> → 校验区报错（${lintScript.errors} 条）`);
const lintOk = await setCode('<center><b><span style="font-size:1.1em;">标题</span></b></center>\n<p>正文<a href="https://a.com" target="_blank" rel="noopener">链接</a></p>\n<center><img src="readmes/image/x.jpg" width="80%"></center>');
console.log(`  正常片段 → ${JSON.stringify(lintOk)}`);
ok(lintOk.errors === 0, `(15)* 正常片段 → 错误数 0（实际 ${lintOk.errors}）`);
// 结构没配平时不许清空编辑区
await evaluate(`(()=>{const c=document.getElementById('tbCode');c.value='<div><span>半截';c.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
await sleep(650);
const keepEditor = await evaluate(`(()=>{const ed=document.getElementById('tbEditor');return (ed.textContent||'').trim();})()`);
// 编辑区里应该还留着"上一次好内容"（本用例前面刚放过「粘贴来的一段」），
// 关键在于**没有被清空**；具体是哪一段不重要，所以只断言"非空 + 不是那半截坏文本"。
console.log(`  代码区没配平时编辑区内容：「${keepEditor.slice(0, 30)}」`);
ok(keepEditor.length > 0 && keepEditor.indexOf('半截') < 0,
  `(15)* 代码区没配平时保留编辑区最后一次可用内容（没有被清空：「${keepEditor.slice(0, 30)}」）`);

// 15d 撤回 / 恢复
const undoState = () => json(`(()=>{const u=document.getElementById('tbUndoBtn'),r=document.getElementById('tbRedoBtn');
  return JSON.stringify({undo:u.disabled,redo:r.disabled,code:document.getElementById('tbCode').value,
    editor:(document.getElementById('tbEditor').textContent||'').trim()});})()`);
// 起点：把当前状态当成撤回起点（前面的用例已经攒了一堆历史步，这里先归零）
await evaluate(`toolboxUndoReset()`);
await sleep(120);
const st0 = await undoState();
const baseline = st0.editor;
ok(st0.undo === true && st0.redo === true, '(15)* 栈里只有起点时，撤回/恢复都是禁用态（没有多余的历史步）');
// 做一次干净的编辑（代码区整段替换）
await setCode('<p>第一段</p>');
await sleep(500);
const st1 = await undoState();
console.log(`  状态 1：撤回禁用=${st1.undo} 恢复禁用=${st1.redo} 编辑区「${st1.editor}」`);
ok(st1.editor === '第一段', '(15) 状态 1：代码区输入已同步到编辑区');
ok(st1.undo === false && st1.redo === true, '(15)* 一次编辑 = 一个历史步（撤回可用、恢复仍禁用）');
// 撤回一次 → 回到起点
await clickSel('[data-tb="undo"]');
await sleep(200);
const st1b = await undoState();
ok(st1b.editor === baseline && st1b.redo === false,
  `(15)* 撤回一次就回到输入前的状态（「${st1b.editor.slice(0, 20)}」）`);
// 再进一步：第二次不同修改
await clickSel('[data-tb="redo"]');
await sleep(200);
await setCode('<p>第二段</p>');
await sleep(500);
const st2 = await undoState();
ok(st2.editor === '第二段' && st2.undo === false, `(15)* 两次不同修改后有可撤回的历史（撤回禁用=${st2.undo}）`);
// 撤回一次 → 回到第一段
await clickSel('[data-tb="undo"]');
const st3 = await undoState();
console.log(`  撤回后：编辑区「${st3.editor}」 恢复禁用=${st3.redo}`);
ok(st3.editor === '第一段', `(15)* 点撤回一次 → 回到上一次（「${st3.editor}」）`);
ok(st3.redo === false, '(15) 撤回之后「恢复」可用');
// 恢复 → 回到第二段
await clickSel('[data-tb="redo"]');
const st4 = await undoState();
ok(st4.editor === '第二段', `(15)* 点恢复 → 回到最新（「${st4.editor}」）`);
// 撤回/恢复也是键盘可达的（Ctrl+Z / Ctrl+Y），只在弹窗内拦截
await evaluate(`document.getElementById('tbEditor').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await sleep(260);
const st5 = await undoState();
ok(st5.editor === '第一段', `(15)* Ctrl+Z 也走同一套快照栈（「${st5.editor}」）`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89, modifiers: 2 });
await sleep(260);
const st6 = await undoState();
ok(st6.editor === '第二段', `(15)* Ctrl+Y 恢复（「${st6.editor}」）`);

// 15e 幂等：拿真文章走"导入 → 导出 → 再导入 → 再导出"
// 两篇：一篇纯图文（120 张图的常见形态）、一篇带表格（表格是最容易在导入导出里被改坏的）
const ARTICLES = ['notecollection/readmes/1960_fujianlocaldebt_1yuan.html',
  'notecollection/readmes/amsx_2012.html'];
const importExport = async (text) => {
    await evaluate(`(()=>{const c=document.getElementById('tbCode');c.value=${JSON.stringify(text)};
      c.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
    await sleep(700);                                  // 等代码区 → 编辑区的防抖
    // "导出"= 编辑区 → 代码区这一路的结果：把编辑区内容重新渲染成代码区文本
    return evaluate(`(()=>{toolboxRefresh(); return document.getElementById('tbCode').value;})()`);
};
for (let ai = 0; ai < ARTICLES.length; ai++) {
    const ARTICLE = ARTICLES[ai];
    const art = readFileSync(ARTICLE, 'utf8');
    const hasTable = /<table/.test(art);
    console.log(`  真文章：${ARTICLE}（${art.length} 字符，表格=${hasTable}）`);
    ok(/<img /.test(art), `(15) ${ARTICLE} 里有图片（幂等测试要覆盖 <center><img …> 那一路）`);
    const e1 = await importExport(art);
    const e2 = await importExport(e1);
    const e3 = await importExport(e2);
    console.log(`  导出长度：第 1 次 ${e1.length}，第 2 次 ${e2.length}，第 3 次 ${e3.length}`);
    ok(e1 === e2, `(15) ${ARTICLE.split('/').pop()}：导入→导出 两次就能收敛（1、2 次相同）`);
    ok(e2 === e3, `★ (15)* ${ARTICLE.split('/').pop()}：第 2 次导出与第 3 次导出**完全一致**（幂等）`);
    // 语料里的关键结构不能在导入导出里丢掉
    if (hasTable) ok(/<table/.test(e2), `(15) ${ARTICLE.split('/').pop()} 的表格还在`);
    ok(/readmes\/image\//.test(e2), `(15) ${ARTICLE.split('/').pop()} 的 readmes/image/… 相对路径被保留`);
    ok(/<img /.test(e2), `(15) ${ARTICLE.split('/').pop()} 的图片标签还在`);
    // 按行排版：顶层块各占一行，且**标签行**行首不缩进（与 readmes/ 里的写法一致）。
    // 只查以 < 开头的行：正文文本行原样保留用户/语料里的空格，那不是缩进。
    const lines = e2.split('\n');
    const tagLines = lines.filter((l) => /^\s*</.test(l));
    const indented = tagLines.filter((l) => /^[ \t]/.test(l));
    ok(lines.length > 1 && indented.length === 0,
      `(15) ${ARTICLE.split('/').pop()} 导出按行排版、标签行不缩进（${lines.length} 行，缩进 ${indented.length} 行${indented.length ? '：' + JSON.stringify(indented[0].slice(0, 40)) : ''}）`);
}

// ==============================================================
console.log('\n====== (16) 用户实测的两个 bug：纯文本粘贴 + 选区不被默认文字顶掉 ======\n');

// 把一段剪贴板内容"粘"进正文区：真的造 DataTransfer + ClipboardEvent，
// 和用户按 Ctrl+V 走的是同一条路（paste 监听器就在这条路上）。
const pasteInto = async (plain, html, target) => {
    const sel = target || '#tbEditor';
    await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});
      el.focus();
      if (el.isContentEditable) { el.innerHTML='<p><br></p>';
        const r=document.createRange(); r.selectNodeContents(el); r.collapse(false);
        const s=getSelection(); s.removeAllRanges(); s.addRange(r); toolboxSaveRange(); }
      else { el.value=''; el.setSelectionRange(0,0); }
      const dt=new DataTransfer();
      dt.setData('text/html', ${JSON.stringify(html)});
      dt.setData('text/plain', ${JSON.stringify(plain)});
      el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
      return 1;})()`);
    await sleep(620);        // 代码区粘贴后要等"代码区 → 编辑区"的防抖（350ms）跑完
    return json(`(()=>{const ed=document.getElementById('tbEditor');
      return JSON.stringify({html:ed.innerHTML,text:(ed.textContent||'').trim(),
        code:document.getElementById('tbCode').value});})()`);
};

// —— Bug 1：正文区粘来的东西必须是纯文本 ——
const richPaste = await pasteInto('第一行\n第二行', '<b>x</b><span style="background:#ff0">y</span>');
console.log(`  富文本粘贴后：${JSON.stringify(richPaste.html)}`);
ok(richPaste.text.indexOf('第一行') >= 0 && richPaste.text.indexOf('第二行') >= 0, '(16)* 两行都粘进来了');
ok(/第一行<br>第二行/.test(richPaste.html), `(16)* 换行变成了 <br>（不是 <p> 包装）：${JSON.stringify(richPaste.html)}`);
ok(!/<b[\s>]/i.test(richPaste.html) && !/<span/i.test(richPaste.html),
  '(16)* 粘贴带来的加粗/span 全部丢掉（纯文本粘贴）');
ok(!/background|ff0|font-size|color:/i.test(richPaste.html), '(16)* 背景色/字号/颜色等样式一个都没留下');
ok(richPaste.code.indexOf('<br>') >= 0 && richPaste.code.indexOf('第一行') >= 0,
  '(16) 代码区跟着更新（导出的是同一份纯文本）');

// 表格仍然是"粘进来就转成表格"（这条既有功能不能被纯文本化改坏）
const tsvPaste = await pasteInto('甲\t乙\n丙\t丁', '');
ok(/<table/.test(tsvPaste.html) && /<th[^>]*>甲/.test(tsvPaste.html.replace(/\n/g, '')),
  `(16) TSV 表格粘贴仍然转成 HTML 表格（没被纯文本化弄坏）`);

// 代码区粘贴：必须保留 HTML（导入现成文章靠它）
const codePaste = await pasteInto('标题正文', '<center><b><span style="font-size:1.1em;">导入标题</span></b></center><p>正文</p>', '#tbCode');
console.log(`  代码区粘贴后编辑区：${JSON.stringify(codePaste.html).slice(0, 160)}`);
ok(/<center>/.test(codePaste.html) && /导入标题/.test(codePaste.html),
  '(16)* 代码区粘 HTML → 原样保留（编辑区解析出了 <center> 结构，没被纯文本化）');
ok(/font-size:\s*1\.1em/.test(codePaste.html), '(16) 代码区粘贴的 HTML 连内联样式都在');

// —— Bug 2：有选区时必须包住选中的字，不许换成默认文字 ——
const selectedWrap = async (act, defWords, structRe, note) => {
    // 放进「甲乙丙」并全选，然后**用真鼠标**点按钮：
    // mousePressed 时冻结选区 → 中途故意把编辑区选区收起（模拟浏览器丢选区）→ mouseReleased 触发点击
    await evaluate(`toolboxOpen()`);
    await sleep(260);
    const box = await json(`(()=>{const b=document.querySelector('[data-tb="${act}"]');
      if(!b) return JSON.stringify({x:-1,y:-1});
      b.scrollIntoView({block:'center'});
      const r=b.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
    if (box.x < 0) { ok(false, `(16) 找不到按钮 [data-tb="${act}"]`); return null; }
    await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
      ed.innerHTML='<p>甲乙丙</p>';
      const node=ed.querySelector('p').firstChild;
      const r=document.createRange(); r.setStart(node,0); r.setEnd(node,3);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSaveRange(); return 1;})()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0, clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
    // ★ 关键一步：模拟"浏览器把编辑区选区收起了"（真实场景里按钮/输入框抢焦点就是这样）。
    //   如果实现是"现场读选区"，接下来只会插默认文字；只有冻结快照才能救回选中的字。
    await evaluate(`(()=>{const s=getSelection(); const ed=document.getElementById('tbEditor');
      if (s) s.collapse(ed, 0); return 1;})()`);
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(320);
    const st = await json(`(()=>{const ed=document.getElementById('tbEditor');
      return JSON.stringify({html:ed.innerHTML, text:(ed.textContent||'').trim()});})()`);
    console.log(`  ${act}：${JSON.stringify(st.html)}`);
    ok(st.text.indexOf('甲乙丙') >= 0, `(16)* 点「${note}」后选中的「甲乙丙」原样保留（${JSON.stringify(st.text)}）`);
    ok(defWords.every((w) => st.text.indexOf(w) < 0),
      `(16)* 没有插入默认文字（{${defWords.join('、')}} 一个都没出现）`);
    ok(structRe.test(st.html), `(16) 出现了对应结构（${note}）`);
    return st;
};
await selectedWrap('title', ['文章标题'], /font-size:\s*1\.1em/, '标题');
await selectedWrap('quote', ['此处填写引用内容'], /border-left:\s*3px solid/, '引用');
await selectedWrap('caption', ['图片说明'], /color:\s*#555555/, '图注');
await selectedWrap('sign', ['落款'], /text-align:\s*right/, '落款');

// 链接：对话框里点确定时，编辑区早已失焦 —— 链接文字仍要取选中的「甲乙丙」
await evaluate(`toolboxOpen()`);
await sleep(260);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>甲乙丙</p>';
  const node=ed.querySelector('p').firstChild;
  const r=document.createRange(); r.setStart(node,0); r.setEnd(node,3);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSaveRange(); return 1;})()`);
const linkBox = await json(`(()=>{const b=document.querySelector('[data-tb="link"]'); b.scrollIntoView({block:'center'});
  const r=b.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: linkBox.x, y: linkBox.y, button: 'left', buttons: 1, clickCount: 1 });
await evaluate(`(()=>{const s=getSelection(); if(s) s.collapse(document.getElementById('tbEditor'),0); return 1;})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: linkBox.x, y: linkBox.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(320);
await evaluate(`(()=>{document.getElementById('tbF_url').value='https://example.com/';return 1;})()`);
await clickSel('#tbDialogOk');
await sleep(320);
const linkSt = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({html:ed.innerHTML, text:(ed.textContent||'').trim()});})()`);
console.log(`  链接：${JSON.stringify(linkSt.html)}`);
ok(linkSt.text.indexOf('甲乙丙') >= 0, '(16)* 链接也用选中的文字，没丢掉');
ok(/<a href="https:\/\/example\.com\/"[^>]*>甲乙丙<\/a>/.test(linkSt.html), '(16)* 选中的字被包进了 <a>');
ok(linkSt.text.indexOf('链接文字') < 0, '(16) 没有出现默认的「链接文字」');

// 反向：**没有**选区时点标题 → 还是要插默认文字（默认值功能不能丢）
await evaluate(`toolboxOpen()`);
await sleep(200);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
  const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSaveRange(); return 1;})()`);
await clickSel('[data-tb="title"]');
await sleep(320);
const noSelSt = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({text:(ed.textContent||'').trim(), html:ed.innerHTML});})()`);
ok(/文章标题/.test(noSelSt.text), `(16)* 没有选区时仍然插入默认文字「文章标题」（${JSON.stringify(noSelSt.text)}）`);
ok(/<center><b><span style="font-size:1\.1em;">文章标题<\/span><\/b><\/center>/.test(noSelSt.html),
  '(16) 默认标题的结构与语料一致');

// 输出还必须能通过净化 + 按行排版，并且**不含**非法嵌套 <p><center>…</center></p>
await evaluate(`toolboxRefresh()`);
const wrapOut = await json(`(()=>{const c=document.getElementById('tbCode').value;
  return JSON.stringify({code:c, bad:/<p>\s*<center/.test(c)||/<p>\s*<div/.test(c)});})()`);
console.log(`  包装后的导出：${JSON.stringify(wrapOut.code).slice(0, 200)}`);
ok(wrapOut.bad === false, '(16)* 导出里没有 <p><center>…</center></p> 这种非法嵌套（块被提到了段落外）');

// ==============================================================
console.log('\n====== (17) 校验不误报：颜色只查"颜色属性"，border-collapse 之类不碰 ======\n');

// ① 用工具自己的表格功能生成一段表格 HTML → 校验必须干净
await evaluate(`toolboxOpen()`);
await sleep(260);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
  const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSaveRange(); return 1;})()`);
await clickSel('[data-tb="table"]');
await sleep(300);
// 表格对话框默认就是 3 行（含表头）× 2 列，直接确定
await clickSel('#tbDialogOk');
await sleep(420);
const tblLint = await json(`(()=>{const v=document.getElementById('tbValidate');
  return JSON.stringify({errors:+v.getAttribute('data-errors'),warnings:+v.getAttribute('data-warnings'),
    text:(v.textContent||'').replace(/\\s+/g,' ').slice(0,200), code:document.getElementById('tbCode').value});})()`);
console.log(`  工具生成表格后：错误 ${tblLint.errors} / 警告 ${tblLint.warnings} —— ${tblLint.text}`);
ok(/border-collapse/.test(tblLint.code), '(17) 生成的表格里确实有 border-collapse（这是误报的来源）');
ok(/<th[^>]*background/.test(tblLint.code.replace(/\n/g, '')) || /background:var\(--bg\)/.test(tblLint.code),
  '(17) 表头用的是 background:var(--bg)（合法的主题变量写法）');
ok(tblLint.errors === 0 && tblLint.warnings === 0,
  `(17)* 插入表格后校验区是干净的（错误 ${tblLint.errors} / 警告 ${tblLint.warnings}）`);
ok(!/collapse/.test(tblLint.text), '(17)* 校验文案里不再出现 collapse 这个词（不再把 border-collapse 当颜色）');

// ② 直接喂一段"语料同款"表格 HTML（border-collapse + border:var + background:var）
const okTable = await setCode('<table style="border-collapse: collapse; width: 100%;">'
  + '<thead><tr><th style="border: 1px solid var(--border); padding: 0.4rem; background: var(--bg);">栏</th>'
  + '<th style="border: 1px solid var(--border); padding: 0.4rem; background: var(--bg);">值</th></tr></thead>'
  + '<tbody><tr><td style="border: 1px solid var(--border); padding: 0.4rem;">甲</td>'
  + '<td style="border: 1px solid var(--border); padding: 0.4rem;">乙</td></tr></tbody></table>');
console.log(`  语料同款表格 → 错误 ${okTable.errors} / 警告 ${okTable.warnings} —— ${okTable.text}`);
ok(okTable.errors === 0 && okTable.warnings === 0,
  `(17)* border-collapse / border:1px solid var(--border) / background:var(--bg) 都不报警（错误 ${okTable.errors} / 警告 ${okTable.warnings}）`);

// ③ rgb() → 应该报（建议改 hex），文案里带属性名
const rgbCase = await setCode('<p><span style="color: rgb(255,0,0)">x</span></p>');
console.log(`  rgb() → ${JSON.stringify(rgbCase.text)}`);
ok(rgbCase.warnings >= 1, `(17)* rgb() 颜色仍然报警告（${rgbCase.warnings} 条）`);
ok(/color/.test(rgbCase.text) && /rgb/.test(rgbCase.text) && /hex/.test(rgbCase.text),
  '(17)* 警告文案带属性名 + 原因（color … rgb() … hex）');

// ④ 具名颜色 → 应该报，并给出建议 hex
const namedCase = await setCode('<p><span style="color: gold">x</span></p>');
console.log(`  具名颜色 → ${JSON.stringify(namedCase.text)}`);
ok(namedCase.warnings >= 1, `(17)* 具名颜色报警告（${namedCase.warnings} 条）`);
ok(/gold/.test(namedCase.text) && /#daa520/.test(namedCase.text),
  '(17)* 文案里给出建议的 hex（gold → #daa520）');

// ⑤ #555555 → 干净
const hexCase = await setCode('<p><span style="color: #555555">x</span></p>');
ok(hexCase.warnings === 0, `(17)* hex 颜色不报警（警告 ${hexCase.warnings}）`);

// ⑥ 其它非颜色属性一律不碰（逐条喂，任何一条报警都算误报）
const inertProps = [
    '<div style="border-collapse: collapse;">x</div>',
    '<div style="border-width: 2px; border-style: dashed;">x</div>',
    '<div style="font-size: 15.2px; text-align: center; line-height: 1.8;">x</div>',
    '<div style="display: flex; gap: 20px; padding: 0.5rem 1rem; margin: 1rem 0;">x</div>',
    '<div style="border-radius: 6px; height: 180px; width: 80%; max-width: 100%;">x</div>',
    '<div style="border-left: 3px solid var(--theme); border-top: 1px solid var(--border);">x</div>',
    '<table style="border-collapse: collapse;"><tr><td style="border: 1px solid var(--border);">1</td>'
      + '<td style="border: 1px solid var(--border);">2</td></tr></table>',
    '<div style="background: var(--bg); color: var(--text); border-color: var(--border);">x</div>',
    '<div style="outline: 1px solid var(--theme); caret-color: var(--theme);">x</div>'
];
let inertBad = [];
for (let i = 0; i < inertProps.length; i++) {
    const r = await setCode(inertProps[i]);
    if (r.warnings !== 0) inertBad.push(inertProps[i].slice(0, 48) + ' → ' + r.text.slice(0, 60));
}
ok(inertBad.length === 0,
  `(17)* 非颜色属性（border-collapse / width / font-size / display / 数字内容…）零误报${inertBad.length ? '：' + inertBad[0] : ''}`);
console.log(`  非颜色属性逐条测：${inertProps.length} 条，误报 ${inertBad.length} 条`);

// ⑦ 颜色属性里写了个看不懂的值 → 仍然要报（别把闸门关死）
const junkColor = await setCode('<p><span style="color: collapse">x</span></p>');
ok(junkColor.warnings >= 1, `(17)* color 里写了个非颜色值照样报（${junkColor.warnings} 条：「${junkColor.text.slice(0, 60)}」）`);

// ==============================================================
console.log('\n====== (18) 「正文」按钮 / 默认文字全选 / 表格列宽拖拽 / 会话保留 ======\n');

// 上一节 (17) 是把 HTML 敲进**代码区**验校验的，代码区→编辑区的防抖（350ms）可能还没跑完；
// 不等它跑完就改编辑区，会被它回来覆盖掉（第一版就踩到了）。这里先静默一下再清干净。
const quietSync = async () => {
  await sleep(760);
  await evaluate(`(()=>{const c=document.getElementById('tbCode');
    if (toolboxCodeApplyTimer) { clearTimeout(toolboxCodeApplyTimer); toolboxCodeApplyTimer = 0; }
    toolboxSyncBusy = false; c.value = '';
    const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
    toolboxSnapClear(); toolboxRange = null; toolboxRefresh(); return 1;})()`);
  await sleep(160);
};
await quietSync();

// ---- 18a 「正文」= 「标题」的反操作 ----
await resetEditor();
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<center><b><span style="font-size:1.1em;">被当成标题的一段话</span></b></center>';
  const t=ed.querySelector('span').firstChild;
  const r=document.createRange();r.setStart(t,0);r.setEnd(t,t.nodeValue.length);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();toolboxSaveRange();return 1;})()`);
await clickSel('[data-tb="body"]');
const bodyRes = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ html: ed.innerHTML, code: document.getElementById('tbCode').value,
    text: (ed.textContent||'').trim() });})()`);
console.log(`  「正文」之后：${bodyRes.html}`);
ok(/被当成标题的一段话/.test(bodyRes.text), '(18)* 「正文」不会把文字弄丢');
ok(!/font-size:1\.1em/.test(bodyRes.html) && !/font-weight/.test(bodyRes.html),
  '(18)* 「正文」把字号打回默认、去掉了加粗');
ok(!/<center>/i.test(bodyRes.html) && !/text-align:\s*center/i.test(bodyRes.html),
  '(18)* 「正文」去掉了居中（<center> 拆掉 / text-align 摘掉）');

// ---- 18b 有选区时用选中的原文，且**不**做"默认文字全选" ----
await resetEditor();
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>用户自己写的一段话</p>';
  const t=ed.querySelector('p').firstChild;
  const r=document.createRange();r.setStart(t,0);r.setEnd(t,t.nodeValue.length);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();toolboxSaveRange();return 1;})()`);
await clickSel('[data-tb="title"]');
const wrapRes = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ html: ed.innerHTML, sel: String(getSelection()), text: (ed.textContent||'').trim() });})()`);
ok(/<span style="font-size:1\.1em;">用户自己写的一段话<\/span>/.test(wrapRes.html),
  `(18)* 有选区点「标题」→ 包住的是**用户选中的原文**（${wrapRes.html}）`);
ok(!/文章标题/.test(wrapRes.html), '(18)* 有选区时不会插入默认文字（不会把用户选的字顶掉）');
ok(wrapRes.sel !== '文章标题', `(18)* 有选区时不做"默认文字全选"（当前选中「${wrapRes.sel}」）`);

// ---- 18c 表格列宽拖拽 → <colgroup> 百分比；一次拖动一条撤回记录 ----
await resetEditor();
await clickSel('[data-tb="table"]');
await evaluate(`(()=>{document.getElementById('tbF_rows').value='2';
  document.getElementById('tbF_cols').value='2';
  document.getElementById('tbF_header').checked=false;return 1;})()`);
await clickSel('#tbDialogOk');
await sleep(420);
const beforeDrag = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const t=ed.querySelector('table');
  const td=t.querySelector('td');
  const r=td.getBoundingClientRect();
  return JSON.stringify({ hasColgroup: !!t.querySelector('colgroup'),
    x: Math.round(r.right), y: Math.round(r.top + r.height/2),
    code: document.getElementById('tbCode').value });})()`);
ok(beforeDrag.hasColgroup === false && !/colgroup/.test(beforeDrag.code),
  '(18)* 工具刚插出来的表格**没有** colgroup（只有用户真拖过才写）');
// 用真鼠标在第一列右边界上按住往右拖 120px
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeDrag.x, y: beforeDrag.y, button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: beforeDrag.x, y: beforeDrag.y, button: 'left', buttons: 1, clickCount: 1 });
for (const dx of [30, 70, 120]) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeDrag.x + dx, y: beforeDrag.y, button: 'left', buttons: 1 });
  await sleep(80);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: beforeDrag.x + 120, y: beforeDrag.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(500);
const afterDrag = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const t = ed.querySelector('table');
  const cols = t ? [...t.querySelectorAll('col')] : [];
  const pcts = cols.map(function (c) {
    const m = /width:\\s*([0-9.]+)%/.exec(c.getAttribute('style') || '');
    return m ? Math.round(parseFloat(m[1])) : null;
  });
  return JSON.stringify({ colCount: cols.length, pcts: pcts,
    sum: pcts.reduce(function (a, b) { return a + (b || 0); }, 0),
    code: document.getElementById('tbCode').value,
    cursor: document.getElementById('tbEditor').style.cursor,
    undoLabel: (document.querySelector('[data-tb="undo"]') || {}).disabled });
})()`);
console.log(`  拖完列宽：${JSON.stringify(afterDrag.pcts)}（和 ${afterDrag.sum}）`);
ok(afterDrag.colCount === 2, `(18)* 拖完写出了 <colgroup>（${afterDrag.colCount} 个 <col>）`);
ok(afterDrag.sum >= 99 && afterDrag.sum <= 101,
  `(18)* 两列百分比之和保持 100（实际 ${afterDrag.sum}：${JSON.stringify(afterDrag.pcts)}）`);
ok(afterDrag.pcts[0] > 50, `(18)* 第一列被拖宽了（${afterDrag.pcts[0]}% > 拖之前的 50%）`);
ok(/<colgroup>/.test(afterDrag.code) && /<col /.test(afterDrag.code),
  '(18)* 生成的 HTML 里带 <colgroup><col style="width:…%;">');
ok(afterDrag.undoLabel === false, '(18) 拖完撤回按钮可用（这一拖动进了撤回栈）');
// 撤回一次 → colgroup 消失（一次拖动只算一条记录）
await clickSel('[data-tb="undo"]');
await sleep(420);
const afterUndo = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const t=ed.querySelector('table');
  return JSON.stringify({ hasColgroup: !!(t && t.querySelector('colgroup')),
    code: document.getElementById('tbCode').value });})()`);
ok(afterUndo.hasColgroup === false && !/colgroup/.test(afterUndo.code),
  '(18)* 撤回一次就把 colgroup 撤掉了（一次拖动 = 一条撤回记录）');
// 幂等：导入一篇真实文章（有表格、没有 colgroup）→ 导出 → 再导入 → 再导出，两次一致
// ★ 语料里有 colgroup 的文章是少数（amsx_20xx 那一批有），必须挑一篇**没有** colgroup 的，
//   否则"导入不补 colgroup"这条根本验不到。
const corpusNoCol = 'notecollection/readmes/gkq_3.html';
const idemCol = await json(`(async ()=>{
  const res = await fetch(${JSON.stringify('/' + corpusNoCol)});
  const src = await res.text();
  const box = document.createElement('div'); box.innerHTML = src;
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = box.innerHTML;
  toolboxRefresh();
  const first = document.getElementById('tbCode').value;
  document.getElementById('tbCode').value = first;
  toolboxApplyCodeToEditor(first, true);
  await new Promise(function (r) { setTimeout(r, 420); });
  const second = document.getElementById('tbCode').value;
  return JSON.stringify({ same: first === second, hasTable: /<table/.test(first),
    autoColgroup: /colgroup/.test(first), len: first.length });
})()`);
console.log(`  含表格的真实文章幂等：同=${idemCol.same}，自动补 colgroup=${idemCol.autoColgroup}`);
ok(idemCol.hasTable === true, '(18) 导入的真实文章里确实有表格（幂等用例有效）');
ok(idemCol.autoColgroup === false,
  '(18)* 导入已有表格**不会**被自动补上等分 colgroup（否则导入→导出就不幂等了）');
ok(idemCol.same === true, '(18)* 含表格的文章"导出 → 再导入 → 再导出"字节一致（幂等）');

// ---- 18d 同会话保留窗口尺寸位置（只在内存里，刷新后回默认） ----
await resetEditor();
await evaluate(`toolboxClose()`);
await sleep(150);
await evaluate(`toolboxOpen()`);
await sleep(350);
const geo0 = await json(`(()=>{const c=document.querySelector('.tb-card'),r=c.getBoundingClientRect();
  return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),l:Math.round(r.left),t:Math.round(r.top)});})()`);
await evaluate(`(()=>{toolboxWinApply({left:40,top:30,w:700,h:460});return 1;})()`);
await sleep(120);
await evaluate(`toolboxClose()`);
await sleep(150);
await evaluate(`toolboxOpen()`);
await sleep(350);
const geo1 = await json(`(()=>{const c=document.querySelector('.tb-card'),r=c.getBoundingClientRect();
  return JSON.stringify({w:Math.round(r.width),h:Math.round(r.height),l:Math.round(r.left),t:Math.round(r.top)});})()`);
console.log(`  窗口几何：默认 ${JSON.stringify(geo0)} → 改成 700x460@(40,30) → 重开 ${JSON.stringify(geo1)}`);
ok(Math.abs(geo1.w - 700) <= 2 && Math.abs(geo1.h - 460) <= 2 && Math.abs(geo1.l - 40) <= 2 && Math.abs(geo1.t - 30) <= 2,
  `(18)* 同一次会话里关掉再打开，窗口尺寸位置保留（${geo1.w}x${geo1.h}@${geo1.l},${geo1.t}）`);
ok(Math.abs(geo1.w - geo0.w) > 10, '(18) 保留的确实不是"默认尺寸"（说明它真的记住了）');

// ==============================================================
console.log('\n====== (19) 表格操作：右键小菜单 + 合并/拆分 + 插删行列单元格 ======\n');
await quietSync();

// 建一张 3 行 3 列、**不带表头**的表格（纯 <td>，数起来直观）
const buildTable = async (rows, cols, header) => {
  await resetEditor();
  await clickSel('[data-tb="table"]');
  await evaluate(`(()=>{document.getElementById('tbF_rows').value=${JSON.stringify(String(rows))};
    document.getElementById('tbF_cols').value=${JSON.stringify(String(cols))};
    document.getElementById('tbF_header').checked=${header ? 'true' : 'false'};return 1;})()`);
  await clickSel('#tbDialogOk');
  await sleep(450);
};
// 表格的当前状态（有效列数用工具箱自己那套格子算法算，口径和校验区一致）
const tblState = () => json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const t = ed.querySelector('table');
  if (!t) return JSON.stringify({ none: true });
  const spans = [...t.querySelectorAll('[colspan],[rowspan]')].map(function (c) {
    return c.tagName + '[' + (c.getAttribute('colspan') || '') + '/' + (c.getAttribute('rowspan') || '') + ']';
  });
  return JSON.stringify({
    rows: t.rows.length,
    tds: t.querySelectorAll('td').length,
    ths: t.querySelectorAll('th').length,
    colCounts: toolboxTableColCounts(t),
    spans: spans,
    text: (t.textContent || '').replace(/\\s+/g, ''),
    code: document.getElementById('tbCode').value,
    errors: +document.getElementById('tbValidate').getAttribute('data-errors'),
    warnings: +document.getElementById('tbValidate').getAttribute('data-warnings'),
    warnText: (document.getElementById('tbValidate').textContent || '').replace(/\\s+/g, ' ').slice(0, 120)
  });})()`);
const tAct = (act) => evaluate(`(()=>{toolboxTableAct(${JSON.stringify(act)}); return 1;})()`);
// 把光标放进第 r 行第 c 列那个 <td> 里
const caretIn = (r, c) => evaluate(`(()=>{
  const ed=document.getElementById('tbEditor'); const t=ed.querySelector('table');
  const cell=t.rows[${r}].children[${c}];
  toolboxFocusEditor(); toolboxCaretInCell(cell); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const sameTbl = (a, b) => a.rows === b.rows && a.tds === b.tds
  && JSON.stringify(a.colCounts) === JSON.stringify(b.colCounts)
  && JSON.stringify(a.spans) === JSON.stringify(b.spans) && a.code === b.code;

// ---- 19a 菜单项：正好是需求里那 10 项、顺序一致 ----
await evaluate(`toolboxTableMenuBuild()`);
const menu = await json(`(()=>{const m=document.getElementById('tbTableMenu');
  return JSON.stringify({ items:[...m.querySelectorAll('[data-tm]')].map(function(x){return x.textContent;}),
    seps:m.querySelectorAll('.tb-tmenu-sep').length, hidden:m.hidden });})()`);
console.log(`  菜单项：${menu.items.join(' / ')}`);
ok(JSON.stringify(menu.items) === JSON.stringify(['上方插入行', '下方插入行', '删除行', '左侧插入列',
    '右侧插入列', '删除列', '插入单元格', '删除单元格', '合并单元格', '拆分单元格']),
  `(19)* 右键菜单正好是需求里的 10 项、顺序一致（${menu.items.length} 项）`);
ok(menu.hidden === true && menu.seps >= 3, `(19) 菜单默认收起、用分隔线分成 4 组（${menu.seps} 条分隔线）`);

// ---- 19b 真右键：表格里弹菜单；表格外不弹 ----
await buildTable(3, 3, false);
const base3 = await tblState();
ok(JSON.stringify(base3.colCounts) === '[3,3,3]', `(19) 建出 3×3：每行有效列数 ${JSON.stringify(base3.colCounts)}`);
await caretIn(0, 0);
// 光标先在段落里 → 右键段落：不弹菜单（走浏览器自己的菜单）
// （表格是插在一个空段落后面的；插入路径会把那个空段落收拾掉，所以这里显式补一个段落）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const t=ed.querySelector('table');
  if(!ed.querySelector('p')){const p=document.createElement('p');p.textContent='表格外的段落';
    const host=(t&&t.parentNode!==ed)?t.parentNode:t;             // 表格外面还套着一层 overflow 的 div
    if(host&&host.nextSibling)ed.insertBefore(p,host.nextSibling);else ed.appendChild(p);}
  toolboxRefresh(); return 1;})()`);
const pPt = await json(`(()=>{const p=document.getElementById('tbEditor').querySelector('p');
  const r=p.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+8),y:Math.round(r.top+4)});})()`);
const rc = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(260);
};
await rc(pPt.x, pPt.y);
const menuOutside = await evaluate(`document.getElementById('tbTableMenu').hidden`);
ok(menuOutside === true, '(19)* 在表格外面右键不弹表格菜单（不抢浏览器自己的右键菜单）');
// 表格里右键
const cellPt = await json(`(()=>{const t=document.getElementById('tbEditor').querySelector('table');
  const r=t.rows[1].children[1].getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
await rc(cellPt.x, cellPt.y);
const opened = await json(`(()=>{const m=document.getElementById('tbTableMenu');const r=m.getBoundingClientRect();
  return JSON.stringify({hidden:m.hidden,left:Math.round(r.left),top:Math.round(r.top),
    vw:window.innerWidth,vh:window.innerHeight,w:Math.round(r.width),
    off:[...m.querySelectorAll('.tb-off')].map(function(x){return x.textContent;}),
    cursorInCell:(function(){const s=getSelection();
      const n=s&&s.rangeCount?s.getRangeAt(0).startContainer:null;
      let el=n&&n.nodeType===3?n.parentNode:n;
      while(el&&String(el.tagName||'').toUpperCase()!=='TD')el=el.parentNode;
      return !!el;})()});})()`);
console.log(`  菜单位置 (${opened.left},${opened.top}) 视口 ${opened.vw}x${opened.vh} 宽 ${opened.w}；灰掉的项：${JSON.stringify(opened.off)}`);
ok(opened.hidden === false, '(19)* 在表格里右键弹出小菜单');
ok(opened.left >= 0 && opened.top >= 0 && opened.left + opened.w <= opened.vw && opened.top <= opened.vh,
  '(19)* 菜单完整落在视口里（贴边时会自动收回来）');
ok(opened.cursorInCell === true, '(19)* 右键后光标落在右键点中的那个单元格里（后续操作有明确对象）');
ok(opened.off.indexOf('合并单元格') >= 0 && opened.off.indexOf('拆分单元格') >= 0,
  `(19)* 没跨格选中 / 没合并过的单元格：合并与拆分两项是灰的（${JSON.stringify(opened.off)}）`);
// Esc 关闭
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(200);
const escClosed = await json(`JSON.stringify({ menu: document.getElementById('tbTableMenu').hidden,
  modal: getComputedStyle(document.getElementById('toolboxModal')).display })`);
ok(escClosed.menu === true, '(19)* 按 Esc 关掉菜单');
ok(escClosed.modal !== 'none', '(19)* 第一下 Esc 只关菜单，不会把整个工具箱也关掉（层级从内到外关）');
// 再右键打开（下面要真鼠标点菜单项）
await rc(cellPt.x, cellPt.y);
const reopen = await evaluate(`document.getElementById('tbTableMenu').hidden`);
ok(reopen === false, '(19) 再右键又能打开');
// ★ 撤回的对照基线要在"点菜单项之前"这一刻取：
//   插行之前的最后一条撤回记录可能不是建表那一步（例如中途敲了 Esc，
//   编辑区的 keyup 也会记一步），所以拿"操作前的现场"比才靠谱。
const beforeRowClick = await tblState();
// 菜单里的「下方插入行」用**真鼠标点击**（验证菜单的 mousedown preventDefault 不会吃掉 click）
const itemPt = await json(`(()=>{const el=[...document.querySelectorAll('#tbTableMenu [data-tm]')]
  .find(function(x){return x.getAttribute('data-tm')==='row-below';});
  const r=el.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: itemPt.x, y: itemPt.y, button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: itemPt.x, y: itemPt.y, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: itemPt.x, y: itemPt.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(450);
const afterClick = await tblState();
const menuAfter = await evaluate(`document.getElementById('tbTableMenu').hidden`);
console.log(`  真鼠标点「下方插入行」后：${afterClick.rows} 行`);
ok(afterClick.rows === 4, `(19)* 点菜单项「下方插入行」真的插了一行（3 → ${afterClick.rows}）`);
ok(menuAfter === true, '(19)* 点完菜单项菜单自己收起');
ok(JSON.stringify(afterClick.colCounts) === '[3,3,3,3]',
  `(19)* 新行的有效列数与表格一致（${JSON.stringify(afterClick.colCounts)}）`);
ok(afterClick.tds === 12, `(19)* 新行是空单元格（3×4 = 12 个 <td>，实际 ${afterClick.tds}）`);
// 点菜单外面的空白处也会关闭（点窗口底部的状态栏，最无害的位置）
await rc(cellPt.x, cellPt.y);
const footPt = await json(`(()=>{const f=document.querySelector('.tb-foot');const r=f.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
await clickAt(footPt.x, footPt.y);
await sleep(250);
const blankClosed = await evaluate(`document.getElementById('tbTableMenu').hidden`);
ok(blankClosed === true, '(19)* 点菜单外面的空白处也会关掉菜单');
// 撤回一次回到操作前
await clickSel('[data-tb="undo"]');
await sleep(420);
const undoRow = await tblState();
if (!sameTbl(undoRow, beforeRowClick)) {
  const a = beforeRowClick.code.split('\n'), b = undoRow.code.split('\n');
  let d = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) { d = i; break; }
  console.log(`  撤回后与基线不一致：基线 ${a.length} 行 / 撤回后 ${b.length} 行；`
    + `行结构 ${beforeRowClick.rows}/${undoRow.rows}，td ${beforeRowClick.tds}/${undoRow.tds}`);
  console.log(`    第一处不同（第 ${d + 1} 行）：\n      基线: ${a[d]}\n      撤回: ${b[d]}`);
}
ok(sameTbl(undoRow, beforeRowClick), `(19)* 撤回一次回到插入行之前（${undoRow.rows} 行）`);

// ---- 19c 各种插删操作各 +1 / -1，且每次都能撤回 ----
const cases = [
  { act: 'row-above', name: '上方插入行', at: [1, 1], check: (a, b) => a.rows === b.rows + 1, label: '行数 +1' },
  { act: 'row-below', name: '下方插入行', at: [1, 1], check: (a, b) => a.rows === b.rows + 1, label: '行数 +1' },
  { act: 'row-del',   name: '删除行',     at: [1, 1], check: (a, b) => a.rows === b.rows - 1, label: '行数 -1' },
  { act: 'col-left',  name: '左侧插入列', at: [1, 1], check: (a, b) => a.colCounts[0] === b.colCounts[0] + 1, label: '每行有效列数 +1' },
  { act: 'col-right', name: '右侧插入列', at: [1, 1], check: (a, b) => a.colCounts[0] === b.colCounts[0] + 1, label: '每行有效列数 +1' },
  { act: 'col-del',   name: '删除列',     at: [1, 1], check: (a, b) => a.colCounts[0] === b.colCounts[0] - 1, label: '每行有效列数 -1' },
  { act: 'cell-add',  name: '插入单元格', at: [1, 1], check: (a, b) => a.tds === b.tds + 1, label: '单元格 +1' },
  { act: 'cell-del',  name: '删除单元格', at: [1, 1], check: (a, b) => a.tds === b.tds - 1, label: '单元格 -1' }
];
let caseBad = [];
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  await buildTable(3, 3, false);
  const before = await tblState();
  await caretIn(c.at[0], c.at[1]);
  await tAct(c.act);
  await sleep(240);
  const after = await tblState();
  const okShape = c.check(after, before);
  const okUndo = (await (async () => {
    await clickSel('[data-tb="undo"]');
    await sleep(420);
    const back = await tblState();
    return sameTbl(back, before);
  })());
  const okLegal = after.errors === 0
    && (c.act === 'cell-add' || c.act === 'cell-del'          // 这两项本来就故意让某一行多/少一格
        ? true
        : after.colCounts.every(v => v === after.colCounts[0]));
  console.log(`  ${c.name}: ${c.label} → ${okShape ? 'OK' : '✗'}；撤回复原 ${okUndo ? 'OK' : '✗'}；`
    + `有效列数 ${JSON.stringify(after.colCounts)}，错误 ${after.errors} / 警告 ${after.warnings}`);
  if (!(okShape && okUndo && okLegal)) {
    caseBad.push(`${c.name}(形状=${okShape} 撤回=${okUndo} 合法=${okLegal} 列数=${JSON.stringify(after.colCounts)})`);
  }
}
ok(caseBad.length === 0, `(19)* 8 种插删操作各就各位、撤回都能复原、结构合法${caseBad.length ? '：' + caseBad[0] : ''}`);

// 插入单元格之后这一行确实比别的行多一格：校验区只给**一条**提示（故意不齐，不刷屏）
await caretIn(1, 1);
await tAct('cell-add');
await sleep(240);
const uneven = await tblState();
console.log(`  插入单元格后：有效列数 ${JSON.stringify(uneven.colCounts)}，警告 ${uneven.warnings}「${uneven.warnText}」`);
ok(uneven.warnings <= 1, `(19)* 插入单元格后的"故意不齐"最多只提示一条（当前 ${uneven.warnings} 条）`);

// ---- 19d 合并 2×2 → 一个 colspan=2 rowspan=2 的单元格；校验区零警告 ----
await buildTable(3, 3, false);
const beforeMerge = await tblState();
// 先用真鼠标从第一格拖到第四格（真实用户手势），拖不出跨格选区就退化成程序化 Range
const dragPts = await json(`(()=>{const t=document.getElementById('tbEditor').querySelector('table');
  const a=t.rows[0].children[0].getBoundingClientRect(), b=t.rows[1].children[1].getBoundingClientRect();
  return JSON.stringify({ax:Math.round(a.left+6),ay:Math.round(a.top+a.height/2),
    bx:Math.round(b.right-6),by:Math.round(b.top+b.height/2)});})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragPts.ax, y: dragPts.ay, button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragPts.ax, y: dragPts.ay, button: 'left', buttons: 1, clickCount: 1 });
for (let k = 1; k <= 6; k++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved',
    x: Math.round(dragPts.ax + (dragPts.bx - dragPts.ax) * k / 6),
    y: Math.round(dragPts.ay + (dragPts.by - dragPts.ay) * k / 6), button: 'left', buttons: 1 });
  await sleep(50);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragPts.bx, y: dragPts.by, button: 'left', buttons: 0, clickCount: 1 });
await sleep(260);
let picked = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const p=toolboxTablePickedCells(ed);
  return JSON.stringify({n:p?p.cells.length:0, sel:String(getSelection())});})()`);
let dragWorked = picked.n >= 4;
if (!dragWorked) {
  // 退路：直接造一个"从第一格开头到第四格结尾"的 Range —— 和真拖选出来的东西一模一样
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); const t=ed.querySelector('table');
    const a=t.rows[0].children[0], b=t.rows[1].children[1];
    const r=document.createRange(); r.setStart(a,0); r.setEnd(b,b.childNodes.length);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r);
    toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
  picked = await json(`(()=>{const p=toolboxTablePickedCells(document.getElementById('tbEditor'));
    return JSON.stringify({n:p?p.cells.length:0, sel:String(getSelection())});})()`);
}
console.log(`  跨格选区：${dragWorked ? '真鼠标拖选' : '程序化 Range（拖选在无头里没生效）'}，命中 ${picked.n} 个单元格`);
ok(picked.n === 4, `(19)* 选区横跨 2×2 四个单元格（命中 ${picked.n} 个）`);
// 右键：菜单要弹出来，而且**不能**把这份跨格选区弄丢（合并全靠它）
await rc(dragPts.ax, dragPts.ay);
const keptSel = await json(`(()=>{const p=toolboxTablePickedCells(document.getElementById('tbEditor'));
  return JSON.stringify({n:p?p.cells.length:0, hidden:document.getElementById('tbTableMenu').hidden,
    off:[...document.querySelectorAll('#tbTableMenu .tb-off')].map(function(x){return x.textContent;})});})()`);
ok(keptSel.hidden === false, '(19)* 跨格选中时右键照样弹菜单');
ok(keptSel.n === 4, `(19)* 右键**没有**弄丢跨格选区（还能认出 ${keptSel.n} 个单元格）`);
ok(keptSel.off.indexOf('合并单元格') < 0, '(19)* 跨格选中时「合并单元格」不再是灰的');
// 点「合并单元格」
const mergePt = await json(`(()=>{const el=[...document.querySelectorAll('#tbTableMenu [data-tm]')]
  .find(function(x){return x.getAttribute('data-tm')==='merge';});
  const r=el.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mergePt.x, y: mergePt.y, button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mergePt.x, y: mergePt.y, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mergePt.x, y: mergePt.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(500);
const merged = await tblState();
console.log(`  合并后：${merged.rows} 行，<td> ${merged.tds} 个，span ${JSON.stringify(merged.spans)}，`
  + `有效列数 ${JSON.stringify(merged.colCounts)}，错误 ${merged.errors} / 警告 ${merged.warnings}`);
ok(merged.spans.length === 1 && /\[2\/2\]/.test(merged.spans[0]),
  `(19)* 合并出一个 colspan="2" 且 rowspan="2" 的单元格（${merged.spans.join(',')}）`);
ok(/colspan="2"/.test(merged.code) && /rowspan="2"/.test(merged.code),
  '(19)* 生成的 HTML 里真的写着 colspan="2" / rowspan="2"（语料同款写法）');
ok(merged.tds === 6, `(19)* 被合并掉的 3 个单元格已经删除（9 → ${merged.tds}）`);
ok(merged.text.indexOf('内容') >= 0 && merged.text.length <= beforeMerge.text.length,
  '(19) 保留的是左上角那格的内容（其余格子的文字按需求丢弃）');
ok(JSON.stringify(merged.colCounts) === '[3,3,3]',
  `(19)* 合并后每行有效列数仍然一致（${JSON.stringify(merged.colCounts)}：把 colspan/rowspan 的占位算进去了）`);
ok(merged.errors === 0 && merged.warnings === 0,
  `(19)* 合并单元格之后校验区**零**警告（错误 ${merged.errors} / 警告 ${merged.warnings}「${merged.warnText}」）`);
// 撤回一次回到合并前
await clickSel('[data-tb="undo"]');
await sleep(420);
const afterMergeUndo = await tblState();
ok(sameTbl(afterMergeUndo, beforeMerge),
  `(19)* 合并只算一条撤回记录：撤回一次就回到合并前（${afterMergeUndo.spans.length} 处 span）`);
// 重做后再拆分
await clickSel('[data-tb="redo"]');
await sleep(420);
await caretIn(0, 0);
await tAct('split');
await sleep(400);
const split = await tblState();
console.log(`  拆分后：${split.rows} 行，<td> ${split.tds} 个，span ${JSON.stringify(split.spans)}，`
  + `有效列数 ${JSON.stringify(split.colCounts)}，警告 ${split.warnings}`);
ok(split.spans.length === 0, `(19)* 拆分把 colspan/rowspan 复位（还剩 ${split.spans.length} 处）`);
ok(split.tds === 9, `(19)* 拆分把被合并掉的格子补回来了（9 个 <td>，实际 ${split.tds}）`);
ok(JSON.stringify(split.colCounts) === '[3,3,3]',
  `(19)* 拆分后每行有效列数一致（${JSON.stringify(split.colCounts)}）`);
ok(split.errors === 0 && split.warnings === 0,
  `(19)* 拆分后校验区也是干净的（错误 ${split.errors} / 警告 ${split.warnings}）`);
// 幂等：真实语料里带 rowspan / colspan 的文章，导入→导出两次必须字节一致。
// ★ 语料里 rowspan 和 colspan 分别出现在不同文章里（mo_boc_20xx 是 rowspan，
//   hk_boc_1994 是 colspan），两篇都得过一遍。
const spanFiles = ['notecollection/readmes/mo_boc_2008.html', 'notecollection/readmes/hk_boc_1994.html'];
const spanSeen = { row: false, col: false };
const spanBad = [];
for (let i = 0; i < spanFiles.length; i++) {
  const f = spanFiles[i];
  const r = await json(`(async ()=>{
    const res = await fetch(${JSON.stringify('/' + f)});
    const src = await res.text();
    const box = document.createElement('div'); box.innerHTML = src;
    const ed = document.getElementById('tbEditor');
    ed.innerHTML = box.innerHTML;
    toolboxSnapClear(); toolboxRange = null; toolboxRefresh();
    const first = document.getElementById('tbCode').value;
    document.getElementById('tbCode').value = first;
    toolboxApplyCodeToEditor(first, true);
    await new Promise(function (r2) { setTimeout(r2, 500); });
    const second = document.getElementById('tbCode').value;
    const t = ed.querySelector('table');
    return JSON.stringify({ same: first === second, hasRowspan: /rowspan="/.test(first),
      hasColspan: /colspan="/.test(first), counts: t ? toolboxTableColCounts(t) : null,
      warnings: +document.getElementById('tbValidate').getAttribute('data-warnings'),
      errors: +document.getElementById('tbValidate').getAttribute('data-errors') });
  })()`);
  console.log(`  语料 ${f}：同=${r.same}，rowspan=${r.hasRowspan} colspan=${r.hasColspan}，`
    + `有效列数 ${JSON.stringify(r.counts)}，错误 ${r.errors} / 警告 ${r.warnings}`);
  if (r.hasRowspan) spanSeen.row = true;
  if (r.hasColspan) spanSeen.col = true;
  if (!(r.same && r.errors === 0 && r.warnings === 0
        && r.counts && r.counts.every(v => v === r.counts[0]))) {
    spanBad.push(`${f}(同=${r.same} 错误=${r.errors} 警告=${r.warnings} 列数=${JSON.stringify(r.counts)})`);
  }
}
ok(spanSeen.row && spanSeen.col,
  `(19) 两篇语料分别含 rowspan / colspan（用例有效：row=${spanSeen.row} col=${spanSeen.col}）`);
ok(spanBad.length === 0,
  `(19)* 带合并单元格的真实语料"导出 → 再导入 → 再导出"字节一致、有效列数齐、零警告${spanBad.length ? '：' + spanBad[0] : ''}`);

// ==============================================================
console.log(`\n  -------- 通过 ${pass} / 失败 ${fail} --------`);
ok(errors.length === 0, `全程无未捕获异常（${errors.length} 条）`);
if (errors.length) errors.slice(0, 5).forEach(e => console.log('    ! ' + e.slice(0, 220)));

try { ws.close(); } catch {}
try { child.kill(); } catch {}
try { server.close(); } catch {}
process.exit(fail === 0 ? 0 : 1);
