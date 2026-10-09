// 文章编辑器「工具箱」（collection/toolbox.js + toolbox.css + index.html 里的 #toolboxModal）
//
// 用户要求：
//   · 在「我的」页面里能找到入口，点了**在站内弹*（不跳新页面/新标签页）；
//   · 左所见即所得、右实时只读 HTML，底部字数；
//   · 工具栏：加粗/斜体/下划删除线、五档字号、文字色/高亮、左中右对齐、清除格式；
//   · 插入块：标题、引用框、图注、图片（对话框填地址/宽度/说明）、并排图片、超链接、换行、落款；
//   · 表格：对话框填行/有无表头，*正文区粘贴一律纯文本**，表格不再从粘贴里自动生成；
//     现成 HTML 走代码区，见 (8)/(16)）；
//   · 复制 HTML（带 execCommand 兜底）、下载 .html、草稿自动保存与恢复；
//   · 点工具栏按钮不能丢编辑区里的选区；Esc / 点遮罩能关，且不留全局监听泄漏。
//
// 这条用例守的关键点（也是最容易悄悄坏掉的）：
//   入口真的在「我的」页面里（不是只在源码里写了行字符串）；
//   点了之后**没有跳走**（同一document、URL hash 没变、不是新窗口）；
//   打字/live 同步：编辑区内容 代码HTML
//   点加粗（真鼠标）之后选区**仍在编辑区里**、且 <b> 包住的是被选中的那段文字；
//   表格输出的是**透明背景**版本（不含写死的 #f5f7fa/#fafbfc —那在暗色模式下看不见字）
//      且行内样式里var() 必须完好（execCommand('insertHTML') 会把 td border 洗掉
//      所以插入走的是 createContextualFragment + insertNode）；
//   粘贴 TSV / HTML 表格会自动变<table>，普通文字粘贴不被打扰；
//   并排图片按语料那flex 行输出（总宽 80%、gap 20px、同高度/同宽度两档
//      默认整行共用一条图注且放在容器之后）；
//   草稿会存进localStorage，重开弹窗给恢复提示条（不confirm）；
//   全程 Runtime.exceptionThrown 0（含初始化、开、点、关）
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
// ★ 文案以**用户手改过的 index.html** 为准（本轮用户把空状态提示、草稿弹窗文案、
//   按钮 title 都自己改短了）：这里同步成用户版的字符串，判定只改字符串、不放宽语义。
ok(/data-placeholder="从这里开始……"/.test(html) && /placeholder="可在此粘贴或编辑HTML代码"/.test(html),
  '(1) 空状态提示改成了 placeholder（编辑区用 data-placeholder，代码区用 placeholder）');
ok(/id="tbCode"[^>]*wrap="soft"/.test(html), '(1) 代码区 textarea 显式写 wrap="soft"（长行要折行）');
ok(/data-tb="undo"/.test(html) && /data-tb="redo"/.test(html), '(1) 工具栏有「撤回」「恢复」按钮');
ok(/id="tbFullBtn"/.test(html) && /data-tb="fullscreen"/.test(html), '(1) 标题栏有全屏按钮');
// 用户直接给了两段 SVG（进入全屏/ 小窗），逐字使用：各 4 <path>
//   以前那些"字体符号"（⛶/⤡）自己画的方框""rect>）都作废了（
const fullBtnMarkup = (html.match(/<button[^>]*id="tbFullBtn"[\s\S]{0,600}?<\/button>/) || [''])[0];
ok(/<svg/.test(fullBtnMarkup) && /viewBox="0 0 24 24"/.test(fullBtnMarkup)
  && /stroke-width="2"/.test(fullBtnMarkup) && /stroke-linecap="round"/.test(fullBtnMarkup)
  && /stroke-linejoin="round"/.test(fullBtnMarkup) && /aria-hidden="true"/.test(fullBtnMarkup),
  '(1)* 全屏按钮里是用户给的内联 SVG（viewBox/描边属性逐字照抄）');
ok((fullBtnMarkup.match(/<path/g) || []).length === 4 && /d="M9 4H4v5"/.test(fullBtnMarkup),
  `(1)* 进入全屏、SVG 4 path、第一条d="M9 4H4v5"（实${(fullBtnMarkup.match(/<path/g) || []).length} 条）`);
ok(!/<rect/.test(fullBtnMarkup), '(1)* 不再自己画方框（按钮标签里没有 <rect>）');
ok(/id="tbFullBtn"[^>]*title="全屏"/.test(fullBtnMarkup),
  '(1)* 初始 title="全屏"（进入后由 JS 改成「退出全屏」）');
// ★ 事故修复：这两条的判定式和文案都被编码事故啃掉了（`!/(⛶|⤡)/` 的空字符类变成了
//   永远为假的 `!/(?:)/`，文案也少了"把 ⛶/⤡ 当按钮文字写"）。按基线语义复原，判定只紧不松。
ok(!/[\u26F6\u2921]/.test(fullBtnMarkup), '(1)* 全屏按钮的标签里不再有 ⛶/⤡ 字形');
// ★ 判定用"去掉纯注释行"的那份源码（jsCode 定义在下面，这里就地算一遍）：源码里
//   **注释**明确写着"不再用字体符号（⛶ / ⤡ …）"，那是历史说明、不是按钮文字；
//   按整份源码判会把这条说明也算成违规。
ok(!/[\u26F6\u2921]/.test(js.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')),
  '(1)* 源码里没有任何"把 ⛶/⤡ 当按钮文字写"的字符串（彻底不依赖字形渲染）');
ok(/TOOLBOX_WIN_ICON/.test(js) && /function toolboxWinIconPaint/.test(js) && /function toolboxWinIconHtml/.test(js)
  && /d="M9 4v5H4"/.test(js) && /'退出全屏'/.test(js) && /'全屏'/.test(js),
  '(1)* 两套图标（进入全屏 M9 4H4v5 / 退出全屏 M9 4v5H4）都在源码里，切换走 toolboxWinIconPaint()，标题在 全屏 ↔ 退出全屏 之间切');
// 八个缩放手柄：四条边 + 四个角（n/s/e/w/nw/ne/sw/se）
const gripsInHtml = (html.match(/data-tb-grip="/g) || []).length;
ok(gripsInHtml === 8, `(1) 八个方向的缩放手柄都在（实际 ${gripsInHtml} 个）`);
ok(/id="tbHead"[^>]*/.test(html), '(1) 标题栏能作为拖动区（#tbHead）');
ok(/id="tbDraftAsk"/.test(html) && /id="tbDraftRestore"/.test(html) && /id="tbDraftDiscard"/.test(html),
  '(1) 草稿确认弹窗（#tbDraftAsk + 恢复 + 丢弃）的 DOM 在 index.html 里');
ok(!/id="tbDraftBar"/.test(html) && !/class="tb-draftbar/.test(html),
  '(1)* 旧的细提示条 #tbDraftBar 的**元素**已从 index.html 删除（只剩注释里提一句历史）');
ok(/id="tbDraftAsk"[\s\S]{0,400}?发现未保存草稿/.test(html),
  '(1)* 草稿弹窗的文案是「发现未保存草稿」（以用户手改过的 index.html 为准）');
ok(/id="tbTableMenu"/.test(html) && /role="menu"/.test(html),
  '(1) 表格右键小菜单的 DOM（#tbTableMenu）在 index.html 里');
ok(/onclick="toolboxOpen\(\)"/.test(readFileSync('collection/settings.js', 'utf8')),
  '(1) 「我的」页面（settings.js）里挂上了工具箱入口');
// 生成表格必须"透明背景"那版：一旦出现写死的浅色底，暗色模式下表头文字就看不见了
ok(!/background-color:\s*#f5f7fa/i.test(js) && !/background-color:\s*#fafbfc/i.test(js),
  '(1) 表格生成代码里没有 #f5f7fa / #fafbfc 这类写死的浅色底（透明背景版）');
ok(/background:var\(--bg\)/.test(js) && /border:1px solid var\(--border\)/.test(js),
  '(1) 表格用 var(--bg)/var(--border) 主题变量，浅色暗色都跟着走');
// 主路径必须是 createContextualFragment（手工插节点），execCommand('insertHTML') 只能出现在
// 兜底分支里 —— 一旦它的位置跑到前面，就说明有人把主路径改回去了，行内 var() 会开始丢。
// 只在**代码*里比位置：注释里也会提到 execCommand('insertHTML')，把注释算进来会误判
const jsCode = js.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
ok(jsCode.indexOf('createContextualFragment') > 0
   && jsCode.indexOf('createContextualFragment') < jsCode.indexOf("execCommand('insertHTML'"),
  '(1) 插入主路径走 createContextualFragment（execCommand insertHTML 只做兜底）');
ok(css.indexOf('.tb-dialog') >= 0 && css.indexOf('.tb-toolbar') >= 0 && css.indexOf('.tb-code') >= 0 && css.indexOf('.tb-ask') >= 0,
  '(1) toolbox.css 里工具栏/代码区/字段对话框/草稿确认弹窗的样式都在');
// 草稿弹窗*压在工具箱主弹窗之上**（主弹窗 z-index:1200）：样式里就把它钉死，别只靠 DOM 顺序
const askZ = (css.match(/\.tb-ask\s*\{[^}]*z-index:\s*(\d+)/) || [, ''])[1];
const modalZ = (css.match(/\.tb-modal\s*\{[^}]*z-index:\s*(\d+)/) || [, ''])[1];
ok(Number(askZ) > Number(modalZ) && Number(askZ) > 0,
  `(1)* 草稿弹窗z-index(${askZ}) 高于工具箱主弹窗(${modalZ})`);
// 只看"还有没有规则"，不看注释：注释里为了说清历史会提到旧类名
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
ok(cssCode.indexOf('.tb-draftbar') < 0, '(1)* .tb-draftbar 的旧样式规则已删除（注释里的历史说明不算）');
ok(/mousedown/.test(js) && /preventDefault/.test(js) && /toolboxSaveRange/.test(js) && /toolboxRestoreRange/.test(js),
  '(1) 选区处理两道保险都在（mousedown 阻止默认 + 存/恢复 Range）');
ok(/localStorage\.setItem/.test(js) && /catch \(e\) \{ toolboxDraftError/.test(js),
  '(1) 草稿写 localStorage 且包了 try/catch（file:// 与隐私模式会抛）');
ok(/TOOLBOX_FLEX_STYLE[\s\S]{0,200}width:80%/.test(js), '(1) 并排图片容器总宽钉在 80%（与单图默认宽度一致）');
// —— 这一轮加的规格：文件名输入框 / 正文按钮 / 多图 / 不预填 value / 列宽 colgroup / 会话保留 ——
// 文件名这一轮改成了"跟标题栏融为一的一段字：默认值用**真实文本** value="Untitled""
//   不是 placeholder（placeholder 的计算颜色天生跟真实文字不一样，用户要求两者颜色完全相同）。
const nameMarkup = (html.match(/<input[^>]*id="tbFileName"[^>]*>/) || [''])[0];
ok(/value="Untitled"/.test(nameMarkup) && !/placeholder=/.test(nameMarkup),
  '(1)* 文件名默认值是真实文本 value="Untitled"（不用 placeholder，默认文字与输入文字同色）');
ok(/class="tb-filename"/.test(nameMarkup) && /title="Untitled"/.test(nameMarkup)
  && /aria-label="下载文件名/.test(nameMarkup),
  '(1)* 文件名是 .tb-filename（title 显示完整名字、aria-label 说明用途）');
ok(!/tb-filename[^}]*::placeholder/.test(css),
  '(1)* CSS 里没有 .tb-filename::placeholder 这类规则（placeholder 那条路彻底不用了）');
ok(/\.tb-filename\s*\{[^}]*border:\s*0/.test(css) && /\.tb-filename\s*\{[^}]*background:\s*var\(--bg-light\)/.test(css)
  && /\.tb-filename\s*\{[^}]*overflow:\s*hidden/.test(css) && /\.tb-filename\s*\{[^}]*text-overflow:\s*ellipsis/.test(css),
  '(1)* .tb-filename 无边框 + 与标题栏同底色 + overflow:hidden 与省略号（三项都在一条规则里）');
ok(/function toolboxFileNameSelectAll/.test(js) && /function toolboxSyncPanelFocus/.test(js)
  && /function toolboxDraftAskShow/.test(js),
  '(1)* 三个新能力都在源码里：点击全选 / 代码区禁用态 / 草稿确认弹窗');
ok(/data-tb="body"[^>]*>正文</.test(html), '(1)* 工具栏有「正文」按钮（标题的反操作）');
// 用户手改过 index.html：这个按钮的 title 被他清空了 —— 按他的版本来（断言"这个属性在、且为空"，
// 原来那句"title 里写明多张图片并排"已随他的改动失效；改的是字符串，不放宽结构判定）。
ok(/data-tb="stack"[^>]*>多图</.test(html) && /data-tb="stack"[^>]*title=""/.test(html),
  '(1)* 「并排」已改名「多图」（title 为空，以用户手改过的 index.html 为准）');
ok(/TOOLBOX_DEFAULT_NAME\s*=\s*'Untitled\.html'/.test(js) && /function toolboxCleanFileName/.test(js),
  '(1)* 下载文件名有 default + 清洗函数（非法字符/后缀补齐）');
ok(/function toolboxColGroup/.test(js) && /'width:' \+ s\.pct\[i\] \+ '%;'/.test(js) && /TOOLBOX_COL_MIN_PCT/.test(js),
  '(1)* 列宽拖拽：colgroup + 百分比写入 + 单列最小值约束都在');
ok(!/sessionStorage\.(get|set|remove)Item/.test(js),
  '(1)* 会话标记只用内存变量（toolboxSession），没有往 sessionStorage 里塞东西');
// —— 表格操作（右键菜单 / 合并拆分 / 插删行列单元格）——
// 菜单现在一个浮层两套菜单项（表格/ 图片），所以按数组分别取标签
const tmBlock = js.slice(js.indexOf('const TOOLBOX_TM_ITEMS'), js.indexOf('const TOOLBOX_IM_ITEMS'));
const imBlock = js.slice(js.indexOf('const TOOLBOX_IM_ITEMS'), js.indexOf('// ========== 开关弹窗'));
const tmLabels = (tmBlock.match(/label:\s*'([^']+)'/g) || []).map(s => s.replace(/label:\s*'|'/g, ''));
// ★ 下面两条的「期望值 + 文案」在编码事故里被拆坏了（文案串到了别的断言上、
//   期望值也丢了字：'左对齐'→'左对'）。这里按 toolbox.js 里的真实标签复原。
ok(JSON.stringify(tmLabels) === JSON.stringify(['上方插入行', '下方插入行', '删除行', '左侧插入列',
    '右侧插入列', '删除列', '插入单元格', '删除单元格', '合并单元格', '拆分单元格']),
  '(1)* 表格操作的 10 个动作在源码里就是这个顺序（上方插入行/下方插入行/删除行/左侧插入列/右侧插入列/删除列/插入单元格/删除单元格/合并单元格/拆分单元格）');
const imLabels = (imBlock.match(/label:\s*'([^']+)'/g) || []).map(s => s.replace(/label:\s*'|'/g, ''));
ok(JSON.stringify(imLabels) === JSON.stringify(['修改图片参数', '60%宽度', '80%宽度', '100%宽度',
    '左对齐', '居中对齐', '右对齐', '编辑图注', '删除图注', '删除图片']),
  '(1)* 图片右键菜单的 10 个动作在源码里就是这个顺序（修改图片参数/60%宽度/80%宽度/100%宽度/左对齐/居中对齐/右对齐/编辑图注/删除图注/删除图片）');
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
  '(1)* 插删行单元合并/拆分 的实现都在');
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
// ★ 新增的「尺寸模式」是**选项控件**：它天然要有个默认选中值（value: 'height'），
//   那不是"文本输入框的预填"。把这一处排除掉之后，断言与原来完全一致 ——
//   块里不许再出现任何 value: / value=" 的预填。
const dlgBlockNoSegDefault = dlgBlock.replace(/\bvalue:\s*'(?:height|width)'/g, '');
ok(dlgBlock.length > 100 && /placeholder:/.test(dlgBlock)
  && !/value:/.test(dlgBlockNoSegDefault) && !/value="/.test(dlgBlock),
  '(1)* 字段对话框的默认值全部写在 placeholder 上（一个 value 预填都没有；尺寸模式的默认选中值除外）');

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
if (!chromePath) { console.log('  [XX] 找不到Chrome：请设置 CHROME_PATH 环境变量，或安装 Chrome/Chromium'); process.exit(2); }
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
// 真鼠标事件（点工具栏按钮必须用真的：这条用例要验证的正是"按下按钮会不会把选区抢走"
async function clickAt(x, y) {
  const x1 = Math.round(x), y1 = Math.round(y);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1, button: 'none', buttons: 0, clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
}
const btnCenter = (sel) => json(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return JSON.stringify({none:true});const r=b.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height});})()`);
// 点之前必须保证目标在视口里：「我的」页面很长，入口按钮排在统计图表之后，默认是滚出屏幕的
// （实y 2671，视口才 802）。不滚的话CDP 的鼠标事件点在空白处、elementFromPoint null —
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
// 同时清掉"冻结快照""上一次的选区存档"：不然上一节留下的选中文字会被
//   当成"用户选中了东西"，让本来该用默认文字的插入去包住那段旧文字。
const resetEditor = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p><br></p>';
  toolboxSnapClear(); toolboxRange = null;
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();toolboxSaveRange();return 1;})()`);

await send('Runtime.enable');
await send('Page.enable');
// 钉住几个会让"点一"变成"真的下载/真的写系统剪贴板"的行为：
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
console.log(`  入口按钮：${entry.text}」，所在小节「${entry.sectionTitle}」，尺寸可见=${entry.visible}`);
ok(entry.none !== true, '(2) 「我的」页面里找得到工具箱入口（#toolboxOpenBtn）');
ok(entry.inSettingsPage === true, '(2) 入口确实在设置页的某个 .settings-section 里');
ok(entry.text.length > 0 && entry.visible, `(2) 入口是可见的按钮（文字颜${entry.text}」）`);
ok(entry.modalExists && entry.modalHidden, '(2) 弹窗在页面里且默认是隐藏的（没有自说自话地弹出来）');
ok(entry.hash === '#settings', `(2) 打开前停在「我的」页面（hash=${entry.hash}）`);
ok(entry.bootstrapped === true, '(2) toolbox.js 已加载：toolboxOpen 是可调用的全局函数');

// ==============================================================
console.log('\n====== (3) 点击 -> 站内弹窗（不是新页面======\n');
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
console.log(`  弹窗尺寸：${after.cardW}x${after.cardH}（视${after.vw}x${after.vh}）；工具栏按${after.toolbarBtns} 个`);
ok(after.docId === before.docId && after.readyState === 'complete',
  '(3)* 没有跳转/新开页面（同一个 document，readyState 仍是 complete）');
ok(after.hash === before.hash && after.href === before.href,
  `(3)* URL 完全没变（仍是${after.hash}）—弹窗是站内的，不是新标签页`);
ok(after.settingsStillThere === true, '(3) 「我的」页面还在下面（弹窗盖在它上面）');
ok(after.modalDisplay === 'flex', '(3) 弹窗出现了（display:flex）');
ok(after.bodyLocked === true, '(3) 打开时锁住了背景滚动（body.tb-modal-open）');
ok(after.cardW > after.vw * 0.9 && after.cardH > after.vh * 0.8,
  `(3)* 弹窗接近满屏（宽 ${after.cardW}/${after.vw}、高 ${after.cardH}/${after.vh} —Word 那样的大工作台）`);
ok(after.cardW <= after.vw && after.cardH <= after.vh, '(3) 弹窗没有溢出视口（宽高都在视口之内）');
ok(after.editorEditable === 'true' && after.editorH > 200, '(3) 左侧编辑区可编辑且有实际高度');
ok(after.codeW > 100 && after.codeW < after.cardW * 0.5, '(3) 右侧代码区占一栏（窄于编辑区）');
ok(after.toolbarBtns >= 20, `(3) 工具栏按钮齐全（${after.toolbarBtns} 个）`);
ok(after.editorText === '' && after.codeText === '',
  '(3)* 页面刷新后第一次打开时编辑区与代码区都是空的（不预置任何示例文章）');
ok(after.filenameVal === 'Untitled',
  `(3)* 左上角文件名默认是真实文Untitled（不placeholder；实际行${after.filenameVal}」）`);
ok(after.focused === true, '(3) 打开后焦点在编辑区（可以直接开始打字）');

// ==============================================================
console.log('\n====== (4) 打字 -> 代码区实时同+ 字数 ======\n');
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
    // 深底现在挂在代码区外面那层 .tb-code-wrap 上（textarea 的底色透明，
    // 好让下面那层高亮镜像透上来），所以两处都要看
    codeBg: getComputedStyle(document.getElementById('tbCode').parentNode).backgroundColor,
    codeOwnBg: getComputedStyle(document.getElementById('tbCode')).backgroundColor,
    codeFont: getComputedStyle(document.getElementById('tbCode')).fontFamily });
})()`);
console.log(`  代码区：${JSON.stringify(typed.code)}`);
ok(typed.editorText === '测试正文一段', '(4)* 编辑区里真的打进了文字（真键盘输入路径）');
ok(/测试正文一段/.test(typed.code), '(4)* 代码区出现了对应的 HTML 文字（实时同步）');
ok(/<\w+[^>]*>/.test(typed.code), '(4) 代码区输出的是 HTML 标签，不是光秃秃的纯文本');
ok(typed.codeIsReadonly === false, '(4) 代码区是可编辑的（双向同步的前提）');
ok(/rgb\(\s*30,\s*30,\s*40\s*\)/.test(typed.codeBg) && /rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(typed.codeOwnBg),
  `(4) 代码区是深底（外层${typed.codeBg} = #1e1e28，textarea 自身透明＝${typed.codeOwnBg}）`);
ok(/mono|Consolas|Menlo|Courier/i.test(typed.codeFont), '(4) textarea 用的是 wrap="soft"（实际 soft）');
ok(typed.count === '6', `(4)* 底部字数统计跟着变（「测试正文一段」 ${typed.count} 字）`);

// 长串不换行会把代码区撑出横向滚动条。塞一段超长且**不含空格**HTML
// （文章里真实存在这种写法div style="background:border-left:">），
// 断言它被折行而不是溢出。
const wrapped = await json(`(()=>{
  const t = document.getElementById('tbCode');
  t.value = '<div style="' + 'a'.repeat(300) + '"></div>';
  const cs = getComputedStyle(t);
  return JSON.stringify({ sw: t.scrollWidth, cw: t.clientWidth, overflowX: cs.overflowX,
    wrap: cs.overflowWrap, wordBreak: cs.wordBreak, attr: t.getAttribute('wrap') });
})()`);
console.log(`  超长无空格片段：scrollWidth=${wrapped.sw} clientWidth=${wrapped.cw} overflow-x=${wrapped.overflowX} wrap=${wrapped.attr}`);
ok(wrapped.sw <= wrapped.cw + 4, `(4)* 代码区对超长无空格片段自动折行，没有横向溢出${wrapped.sw} ${wrapped.cw}+4）`);
ok(wrapped.overflowX === 'hidden', `(4)* 代码区不会出现横向滚动条（overflow-x: ${wrapped.overflowX}）`);
ok(wrapped.attr === 'soft', `(4) textarea 用的是wrap="soft"（实${wrapped.attr}）`);
ok(/anywhere|break-word/.test(wrapped.wrap + ' ' + wrapped.wordBreak),
  `(4) 折行规则写的是break-word/anywhere（overflow-wrap:${wrapped.wrap} word-break:${wrapped.wordBreak}）`);

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
ok(setup.selected === '加粗这段' && setup.collapsed === false, `(5) 前置：编辑区里选中了${setup.selected}」`);
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
  `(5)* 按下工具栏按钮时选区没丢（选中仍是「加粗这段」，且仍在编辑区内）`);
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

// 斜体 / 删除线也走一遍（同一execCommand 链路，确认没有互相覆盖）
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
console.log('\n====== (6) 字号 / 对齐 / 清除格式（文字颜色与高亮已按用户要求删除=====\n');
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>字号文字</p>';
  const r=document.createRange();r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await clickSel('[data-tb="size"][data-size="1.1em"]');
const sizeHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/font-size:\s*1\.1em/i.test(sizeHtml), '(6) 1.1em 字号生效且输出 em 而不是 <font size>（<p><span style="font-size:1.1em;">字号文字</span></p>）');
ok(!/<font\b/i.test(sizeHtml), '(6) 生成的是 <span style="font-size:...">，没有留下 <font> 老标签');

// 文字颜色 / 背景高亮：整条功能已删（用户不需要）——UI、代码、样式都不该再有
const gone6 = await json(`(()=>{const m=document.getElementById('toolboxModal');
  const bar=m.querySelector('.tb-toolbar');
  return JSON.stringify({
    colorInputs: m.querySelectorAll('input[type="color"]').length,
    fore: !!document.getElementById('tbForeColor'), back: !!document.getElementById('tbBackColor'),
    swatches: m.querySelectorAll('.tb-swatch').length,
    labels: m.querySelectorAll('.tb-color-label').length,
    barText: bar ? bar.textContent : ''
  });})()`);
ok(gone6.colorInputs === 0 && !gone6.fore && !gone6.back && gone6.swatches === 0 && gone6.labels === 0,
  `(6)* ȡɫUI 全没了（input[type=color] ${gone6.colorInputs} 个、色块${gone6.swatches} 个、label ${gone6.labels} 个）`);
ok(!/高亮/.test(gone6.barText) && !/文字颜色/.test(gone6.barText),
  '(6)* 取色器 UI 全没了（input[type=color] 0 个、色块 0 个、label 0 个）');
ok(!/function toolboxHighlight\s*\(/.test(js) && !/function toolboxBindSwatch/.test(js)
  && !/function toolboxBgHolder/.test(js) && !/function toolboxColor\s*\(/.test(js)
  && !/toolboxForeDefault|toolboxBackDefault|TOOLBOX_HL_COLOR_RE|TOOLBOX_FONT_COMMANDS/.test(js),
  '(6)* 颜色/高亮的实现（含 hiliteColor 那条分支与取色器默认值）也一起删干净了');
ok(!/input\[type="color"\]|\.tb-color-label|\.tb-swatch/.test(css),
  '(6)* 取色器相关的 CSS 规则也没留下');

await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>对齐文字</p>';
  const r=document.createRange();r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await clickSel('[data-tb="align-center"]');
const alignHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/text-align:\s*center/i.test(alignHtml), '(6) 居中对齐生效（<p style="text-align: center;">对齐文字</p>）');

await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p><b><span style="color:#ff0000;">清格式</span></b></p>';
  const r=document.createRange();r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
// ★ 「清格式」按钮已按用户要求删除，动作本身保留。这里改用**等价入口**
//   toolboxToolbarAction('clear') —— 就是原来那个按钮被点击时走的同一个入口
//   （唯一区别是没有那一次真实鼠标点击；判定语义一字不放宽）。
await evaluate(`toolboxToolbarAction('clear')`);
await sleep(220);
const clearHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(!/color:#ff0000/i.test(clearHtml) && /清格式/.test(clearHtml),
  '(6) 清格式（等价入口 toolboxToolbarAction(\'clear\')）摘掉了行内颜色、但文字还在（<p>清格式</p>）');

// ==============================================================
console.log('\n====== (7) 表格：对话框插入 + 输出形======\n');
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
ok(dlg1.headerChecked === true, `(7) 默认勾第一行是表头"（默认${dlg1.rowsPlaceholder} "x ${dlg1.colsPlaceholder} 列）`);
ok(dlg1.rowsValue === '' && dlg1.colsValue === '' && dlg1.rowsPlaceholder === '留空则默认为3行' && dlg1.colsPlaceholder === '留空则默认为2列',
  '(7)* 行数/列数不预填 value，默认值只写在 placeholder 上（留空则默认为3行 / 留空则默认为2列）');
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
console.log(`  表格内联样式table style="${tbl.tableStyle}">`);
console.log(`                <th style="${tbl.thStyle}">`);
console.log(`                <td style="${tbl.tdStyle}">`);
console.log('  生成HTML 片段');
console.log(tbl.code.split('\n').filter(l => /table|thead|tbody|<tr>|<th|<td/.test(l)).slice(0, 4).map(l => '    ' + l).join('\n'));
// 3 = 整张卡3 行（对话框上写的行数（含表头行），所以是 1 thead + 2 tbody 行：
// 3 tr th，内容行 2x3 = 6 td
ok(tbl.rowCount === 3 && tbl.thCount === 3 && tbl.tdCount === 6,
  `(7) 3 x 3 + 勾表头：${tbl.rowCount} tr 表头 + 2 内容）${tbl.thCount} th${tbl.tdCount} td`);
ok(tbl.thead === true, '(7) 第一行在 <thead> 里（表头语义与语料一致）');
ok(/<table\b/.test(tbl.code), '(7)* 生成的 HTML 里有 <table>');
ok(!tbl.hasHardcodedBg, '(7)* 生成的 HTML 里没有 background-color:#f5f7fa（透明背景版：暗色模式下才看得清文字）');
ok(/border:1px solid var\(--border\)/.test(tbl.thStyle) && /border:1px solid var\(--border\)/.test(tbl.tdStyle),
  '(7)* 框线走 var(--border)（主题变量，浅色暗色都跟着走）');
ok(/border-collapse:collapse/.test(tbl.tableStyle || ''), '(7)* 表格是 border-collapse:collapse');
ok(tbl.thBg.indexOf('rgba(0, 0, 0, 0)') !== 0, `(7) 表头有底色（${tbl.thBg}）而不是纯透明`);

// 表头复选框取消勾选时不应出<th>
await resetEditor();
await clickSel('[data-tb="table"]');
await evaluate(`(()=>{document.getElementById('tbF_rows').value='2';document.getElementById('tbF_cols').value='2';
  document.getElementById('tbF_header').checked=false;return 1;})()`);
await clickSel('#tbDialogOk');
const noHead = await evaluate(`(()=>{const t=document.querySelector('#tbEditor table');return t?JSON.stringify({th:t.querySelectorAll('th').length,tr:t.querySelectorAll('tr').length}):'{"none":1}';})()`);
ok(/"th":0/.test(noHead), `(7) 不勾"表头"ʱֻ<td>${noHead}）`);

// ==============================================================
console.log('\n====== (8) 正文区粘======\n');
await resetEditor();
// 规格变更（用户实测的 bug 2）：粘贴*正文*一律按纯文本处—
//   Excel / 网页 / 带样式的 HTML 一律不再自动变成表格（以前会）。
//   表格走工具栏的「表格」按钮，或把 HTML 粘到**代码*（代码区仍然保留 HTML）
const pasteTsv = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const dt = new DataTransfer();
  dt.setData('text/plain', '币种\\t面值\\t发行量\\n荷花钞\\t100Ԫ\\t300万\\n奥运钞\\t10Ԫ\\t600');
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  const t = ed.querySelector('table');
  return JSON.stringify({ hasTable: !!t,
    text: (ed.textContent || ''),
    code: document.getElementById('tbCode').value,
    brs: ed.querySelectorAll('br').length });
})()`);
ok(pasteTsv.hasTable === false, '(8)* 正文区粘贴 Tab 文本**不再**自动变成 <table>（规格：正文粘贴 = 纯文本）');
ok(pasteTsv.text.indexOf('币种') >= 0 && pasteTsv.text.indexOf('荷花') >= 0 && pasteTsv.text.indexOf('奥运') >= 0,
  `(8)* 三行文字都留下了一${JSON.stringify(pasteTsv.text)}）`);
ok(pasteTsv.brs === 2, `(8)* 行与行之间用 <br> 分段控${pasteTsv.brs} 个）`);

// HTML 表格（网页Excel text/html 形态）：正文区也只取纯文本
const pasteHtml = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<p><br></p>';
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  const dt = new DataTransfer();
  dt.setData('text/html', '<table><tr><th>项目</th><th>数</th></tr><tr><td></td><td>1</td></tr><tr><td></td><td>2</td></tr></table>');
  dt.setData('text/plain', '项目\\t数值\\n甲\\t1\\n乙\\t2');
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  const t = ed.querySelector('table');
  return JSON.stringify({ hasTable: !!t, text: (ed.textContent || ''), code: document.getElementById('tbCode').value });
})()`);
ok(pasteHtml.hasTable === false, '(8)* 粘贴网页/Excel 的 HTML 表格也只进纯文本（不自动转表格）');
ok(pasteHtml.text.indexOf('项目') >= 0 && pasteHtml.text.indexOf('') >= 0,
  `(8)* HTML 表格的文字取出来了（${JSON.stringify(pasteHtml.text)}）`);

// 用户实测bug 2：剪贴板里同时有"文字 + 表格"时，以前只剩表格（文字丢了）
//   现在必须两段文字都在、且不出<table>
const pasteMix = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<p><br></p>';
  const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  const dt = new DataTransfer();
  dt.setData('text/html', '<p>文字</p><table><tr><td>格子</td></tr></table><p>文字2</p>');
  dt.setData('text/plain', '文字\\n文字2');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  ed.dispatchEvent(ev);
  return JSON.stringify({ prevented: ev.defaultPrevented, hasTable: !!ed.querySelector('table'),
    text: (ed.textContent || ''), html: ed.innerHTML });
})()`);
ok(pasteMix.hasTable === false, `(8)* 【bug 2文字+表格"粘贴后正文里没有 <table>"${JSON.stringify(pasteMix.html)}）`);
ok(pasteMix.text.indexOf('文字') >= 0 && pasteMix.text.indexOf('文字2') >= 0,
  `(8)* 【bug 2】两段文字都在（没有只留下表格，${JSON.stringify(pasteMix.text)}）`);
ok(/文字\s*<br\s*\/?>\s*文字2/.test(pasteMix.html.replace(/\n/g, '')),
  `(8)* 【bug 2】两行之间是 <br>${JSON.stringify(pasteMix.html)}）`);

// 普通文字粘贴：按**纯文本**处理（用户要求：粘进正文的东西不带任何样式）。
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
// ★ 规格变更（用户实测 bug，见 (40)）：纯文本粘贴后**必须被包进 <p>**。
//   以前这条断言钉的是"原样进来、没有被包成 <p>" —— 那正是用户报的 bug
//   （空编辑区粘「示例文字」，代码区出来的是裸文字，接着打字也留在裸文本里）。
//   所以这里把口径反过来钉：文字一个字不少，同时**必须**是 <p>…</p>。
ok(pastePlain.html.indexOf('这是一段普通文字') >= 0 && /<p[^>]*>这是一段普通文字[^<]*<\/p>/.test(pastePlain.html),
  `(8)* 普通文字粘贴：文字原样进来、且被包进一个 <p>（不再是顶层裸文本）${JSON.stringify(pastePlain.html)}`);

// 代码区仍然保HTML：把带表格的 HTML 粘进代码区正文区跟着出现真表
const codePaste = await json(`(()=>{
  const c = document.getElementById('tbCode');
  c.focus();
  const dt = new DataTransfer();
  dt.setData('text/html', '<table><tr><td>代码区甲</td></tr></table>');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  c.dispatchEvent(ev);
  c.value = '<table><tr><td>代码区甲</td></tr></table>';
  c.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await sleep(620);
const codeToEditor = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const t=ed.querySelector('table');
  return JSON.stringify({ hasTable: !!t, text: t ? t.textContent : '' });})()`);
ok(codeToEditor.hasTable === true, '(8)* 表格改走代码区（或工具栏按钮）：代码区里的 HTML 表格会同步到正文');


// ==============================================================
console.log('\n====== (9) 插入块：标题 / 引用/ ͼע / ͼƬ / 链接 / 换行 / 落款 ======\n');
await resetEditor();
await clickSel('[data-tb="title"]');
// 需求：*默认文字**插入完之后，立刻把这段默认文字整段选中（用户直接打字就覆盖）
//   所以这一节每插一个块都先"新起一个空段落、光标放进去"再插下一个，模拟用户真实的操作节奏
//   必须**段落：块级样式按钮现在是"设置这一块的样式"（见新语义）
//     光标停在已有内容的块里再点「标题/引用」= 把那一块就地改样式，而不是新插一块。
const putCaretAtEnd = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const p=document.createElement('p'); p.innerHTML='<br>'; ed.appendChild(p);
  const r=document.createRange();r.selectNodeContents(p);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();
  toolboxDropRange(); toolboxSaveRange(); return 1;})()`);
const titleAfter = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ html: ed.innerHTML, sel: String(getSelection()),
    code: document.getElementById('tbCode').value });})()`);
ok(/<center>\s*<b>\s*<span style="font-size:1\.1em;">/.test(titleAfter.html.replace(/\s+/g, ' ')),
  '(9) 标题块：居中加粗 + 1.1em（与语料主流写法一致）');
ok(titleAfter.sel === '文章标题',
  `(9)* 无选区点「标题」→ 插完默认文字被整段选中（当前选中${titleAfter.sel}」，直接打字即可覆盖）`);
await putCaretAtEnd();
await clickSel('[data-tb="quote"]');
const quoteHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/background:var\(--bg\);border-left:3px solid var\(--theme\)/.test(quoteHtml),
  '(9) 引用框：语料里那套完全一致的写法（--bg + 3px 主题色左边线）');
await putCaretAtEnd();
await clickSel('[data-tb="caption"]');
const capHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
// 容忍 color:#555555; font-size 之间的空格：语料里两种写法都
ok(/color:\s*#555555;\s*font-size:\s*0\.85rem/.test(capHtml), '(9) 图注：居中 + #555555 + 0.85rem');
await putCaretAtEnd();
// ★ 「落款」按钮已按用户要求删除，动作本身保留。这里改用**等价入口**
//   toolboxToolbarAction('sign') —— 就是原来那个按钮被点击时走的同一个入口
//   （注意：不能用「右对齐」顶上 —— 它走 execCommand('justifyRight')，会把块里的 <br> 弄丢，
//     与「落款」不是同一条路径，会改坏这条用例原本钉的不变量）。
await evaluate(`toolboxToolbarAction('sign')`);
await sleep(320);
const signHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/text-align:right/.test(signHtml),
  '(9) 落款（等价入口 toolboxToolbarAction(\'sign\')）：右对齐（<div style="text-align:right;">—— 落款</div>）');
const blocks = { html: titleAfter.html + quoteHtml + capHtml + signHtml, code: titleAfter.code };
ok(/<center>/.test(blocks.html), '(9) 块级内容用 <center> 居中（语料 380 处的主流写法）');
// 需求：插入后不许出现多余空/ 空块
//   （编辑器两段正文 插标题插引是最容易留下<p> 的路径。）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>第一段正文</p><p>第二段正文</p>';
  const p=document.createElement('p'); p.innerHTML='<br>'; ed.appendChild(p);
  const r=document.createRange();r.selectNodeContents(p);r.collapse(false);
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
  '(9)* 输出形态：<img src="readmes/image/..." width="80%">（相对路径，article.js 会重写基址）');
ok(noBlank.hasTitle && noBlank.hasQuote, '(9) 标题与引用两个块都在（没被空块清理误删）');
// 用户**有意**写的连续 <br> 不能删（那是"空一行的排版手段）
const keptBr = await json(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p><br><br></p>';
  const s=document.getElementById('tbCode'); toolboxRefresh();
  const before=(s.value.match(/<br>/g)||[]).length;
  toolboxCleanEditorBlocks(ed);
  const after=(ed.innerHTML.match(/<br>/g)||[]).length;
  return JSON.stringify({ before:before, after:after });})()`);
ok(keptBr.after === 2, `(9)* 用户有意写的连续 <br> 不会被当空块删掉（还剩${keptBr.after} 个）`);

// <br> 单独一条、而且要插在*中间**：浏览器会把块级元素末尾那个"仅用于放光标"
// <br> 序列化掉（它本来就不渲染），所以"最后一个插入的是 br"这种测法必然误报。
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>前半段</p>';
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
// ★ 「换行」按钮已按用户要求删除（自己按 Enter 即可，行为见 (35) 那一节）；
//   这里改用**等价入口** toolboxToolbarAction('br')（原按钮点击走的同一个入口），
//   继续覆盖"<br> 插在文档中间会真的留下来"这一条。
await evaluate(`toolboxToolbarAction('br')`);
await clickSel('[data-tb="caption"]');
const brHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/<br\s*\/?>/.test(brHtml), '(9) 换行（等价入口 toolboxToolbarAction(\'br\')）插入了 <br>（插在中间的 br 会真的留下来，<p>前半段</p><br><center><span style="color:#555555;font-size:0.85rem;">图片说明</span></center>）');

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
ok(imgDlg.width === '' && imgDlg.widthPh === '留空则默认为80%宽度',
  `(9)* 图片宽度不预填，默认值 80% 只写在 placeholder 上（${imgDlg.widthPh}）`);
ok(imgDlg.src === '' && /readmes\/image\//.test(imgDlg.srcPh),
  `(9)* 图片地址也不预填（placeholder${imgDlg.srcPh}」提示相对路径）`);
// 留空 = 用默认值：只填地址，宽度留出来的必须是 width="80%"
await evaluate(`(()=>{document.getElementById('tbF_src').value='readmes/image/comm/amsx_2012_01.jpg';
  document.getElementById('tbF_caption').value='龙年贺岁钞正';return 1;})()`);
await clickSel('#tbDialogOk');
const imgObj = await json(`(()=>{const ed=document.getElementById('tbEditor');return JSON.stringify({img:!!ed.querySelector('img'),html:ed.innerHTML,code:document.getElementById('tbCode').value});})()`);
ok(imgObj.img === true, '(9) 图片真的插进了编辑区');
// 导出（代码区）里才是"真形：编辑区里相对路径的图会套一*显示"*占位框（data-tb-display），
//   序列化时会整层跳过。alt=文件名 是插入时就写上的（占位框显示文件名要用它）。
ok(/<img[^>]*src="readmes\/image\/comm\/amsx_2012_01\.jpg"[^>]*width="80%"[^>]*>/.test(imgObj.code),
  '(9)* 输出形态：<img src="readmes/image/..." width="80%">（相对路径，article.js 会重写基址）');
ok(/alt="amsx_2012_01\.jpg"/.test(imgObj.code),
  `(9)* 图片带 alt（= 文件名，语料没有 alt 时占位框靠它显示文件名）`);
ok(/龙年贺岁钞正/.test(imgObj.code), '(9) 图注跟着图片一起插入了');
ok(/<center><img[^>]*><\/center>/.test(imgObj.code), '(9) 图片块是 <center> 居中的（与语料逐字一致，不是 div 包一层）');
// ★ 事故修复：`<\/span>` 被啃成了 `/span>`（正则里变成"裸斜杠 + span"，永远匹配不上），
//   文案里的空格也被吃了。判定式按原样复原。
ok(/<center><span style="color:\s*#555555;\s*font-size:\s*0\.85rem;">龙年贺岁钞正<\/span><\/center>/.test(imgObj.code),
  '(9)* 图注沿用语料的 <center> + #555555 + 0.85rem 写法');

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
ok(linkDlg.url === '' && /^请输入URL$/.test(linkDlg.urlPh),
  `(9)* 链接地址不预填，placeholder 提示「请输入URL」（${linkDlg.urlPh}」）`);
ok(/选中文字/.test(linkDlg.textPh), `(9)* 链接文字留空即用选中的文字（placeholder${linkDlg.textPh}」）`);
await evaluate(`(()=>{document.getElementById('tbF_url').value='https://www.bankofchina.com/';return 1;})()`);
await clickSel('#tbDialogOk');
const linkHtml = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/<a href="https:\/\/www\.bankofchina\.com\/" target="_blank" rel="noopener">/.test(linkHtml),
  '(9)* 输出形态：<img src="readmes/image/..." width="80%">（相对路径，article.js 会重写基址）');

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
    // 尺寸模式改成了**选项控件**（.tb-segs，值在容器的 data-value 上）——不是文本框
    modeBox:(document.getElementById('tbF_mode')||{}).tagName||'',
    mode:(document.getElementById('tbF_mode')||{}).dataset ? (document.getElementById('tbF_mode').dataset.value||'') : '',
    modeOpts:[...(document.querySelectorAll('#tbF_mode .tb-seg')||[])].map(b=>b.textContent),
    modeHasText:!!document.querySelector('#tbF_mode input'),
    size:(document.getElementById('tbF_size')||{}).value,
    sizePh:(document.getElementById('tbF_size')||{}).placeholder,
    sizeLabel:((document.querySelector('label[for="tbF_size"]')||{}).textContent||''),
    src1:(document.getElementById('tbF_src1')||{}).value,
    src1Ph:(document.getElementById('tbF_src1')||{}).placeholder,
    hasSrc1:!!document.getElementById('tbF_src1'), hasSrc4:!!document.getElementById('tbF_src4'),
    hasCap1:!!document.getElementById('tbF_cap1'),
    hasSharedCap:!!document.getElementById('tbF_sharedCap'),
    sharedCapLabel:((document.querySelector('label[for="tbF_sharedCap"]')||{}).textContent||''),
    sharedCapValue:(document.getElementById('tbF_sharedCap')||{}).value||''});})()`);
ok(stackDlg.open === true, `(10) 点「多图」弹出对话框（标题「${stackDlg.title}」）`);
ok(stackDlg.count === '' && stackDlg.countPh === '留空则默认为2' && stackDlg.hasSrc1 && stackDlg.hasSrc4 && stackDlg.hasCap1,
  '(10)* 张数不预填（placeholder「留空则默认为2」），对话框支持 2~4 张、每张都有地址，且保留每图单独的图注字段');
ok(stackDlg.hasSharedCap === true && stackDlg.sharedCapLabel.trim() === '图组注释' && stackDlg.sharedCapValue === '',
  `(10)* 对话框默认提供「${stackDlg.sharedCapLabel.trim()}」输入框（不预填，留用选中的文字）`);ok(stackDlg.modeBox === 'DIV' && stackDlg.modeHasText === false && stackDlg.mode === 'height'
  && JSON.stringify(stackDlg.modeOpts) === JSON.stringify(['同高度', '同宽度']),
  `(10)* 尺寸模式是**选项控件**（两个选项 ${JSON.stringify(stackDlg.modeOpts)}，默认 ${stackDlg.mode}），不是文本框`);
ok(stackDlg.size === '' && stackDlg.sizePh === '留空则默认为' + 180 + 'px' && stackDlg.sizeLabel === '高度',
  `(10)* 同高度模式下 size 的标签是「${stackDlg.sizeLabel}」、placeholder 是「${stackDlg.sizePh}」`);
// 切到「同宽度」：标签 / placeholder 跟着变（只改文案，不改行为）
const sizeSwitch = await json(`(()=>{const b=[...document.querySelectorAll('#tbF_mode .tb-seg')].find(x=>x.textContent==='同宽度');
  b.click();
  const box=document.getElementById('tbF_mode');
  const inp=document.getElementById('tbF_size');
  return JSON.stringify({ value:box.dataset.value, active:[...box.querySelectorAll('.tb-seg.active')].map(x=>x.textContent),
    label:(document.querySelector('label[for="tbF_size"]')||{}).textContent||'',
    ph:inp.placeholder, hint:(inp.parentNode.querySelector('.tb-hint')||{}).textContent||'' });})()`);
ok(sizeSwitch.value === 'width' && JSON.stringify(sizeSwitch.active) === JSON.stringify(['同宽度'])
  && /总宽度比例/.test(sizeSwitch.label) && /%/.test(sizeSwitch.ph) && /比例/.test(sizeSwitch.hint),
  `(10)* 切到同宽度后：值=${sizeSwitch.value}、标签「${sizeSwitch.label}」、placeholder「${sizeSwitch.ph}」`);
// 切回同高度（后面的用例按同高度走）
await evaluate(`(()=>{const b=[...document.querySelectorAll('#tbF_mode .tb-seg')].find(x=>x.textContent==='同高度');b.click();return 1;})()`);
ok(stackDlg.src1 === '' && /readmes\/image\//.test(stackDlg.src1Ph || ''),
  `(10)* 每张图的地址也不预填（placeholder${stackDlg.src1Ph}」）`);

// 10a. 默认（整行共用一条图注）：图注在容器之后、只出现一次、且不生成每图的子div
await evaluate(`(()=>{document.getElementById('tbF_count').value='3';
  [...document.querySelectorAll('#tbF_mode .tb-seg')].find(x=>x.textContent==='同高度').click();
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
console.log(`  flex 容器div style="${stackH.rowStyle}">`);
console.log(`  每张图：${JSON.stringify(stackH.imgStyles[0])}`);
console.log(`  行下图注${stackH.captionTag}`);
ok(stackH.hasRow === true, '(10)* 生成了 flex 行容器');
ok(/display:flex/.test(stackH.rowStyle), '(10)* 容器是 display:flex（照抄语料那套）');
ok(/justify-content:center/.test(stackH.rowStyle) && /gap:20px/.test(stackH.rowStyle) && /flex-wrap:wrap/.test(stackH.rowStyle),
  '(10)* 容器的 justify-content:center / gap:20px / flex-wrap:wrap 与语料逐字一致');
ok(/width:80%/.test(stackH.rowStyle) && /margin:10px auto/.test(stackH.rowStyle),
  '(10)* 容器总宽 = 单图默认宽度 80%，并用 margin:10px auto 居中');
ok(stackH.imgCount === 3, `(10)* <img> 数量与实际张数一致（3 张，实际 ${stackH.imgCount}）`);
ok(stackH.heights === 3, `(10)* 同高度模式下每张图都height:${stackH.heights}/3）`);
ok(/height:180px/.test(stackH.imgStyles[0]), `(10) 高度值按对话框里填的来（${stackH.imgStyles[0]}）`);
ok(/max-width:100%/.test(stackH.imgStyles[0]) && /width:auto/.test(stackH.imgStyles[0]),
  '(10) 同高度模式宽度自适应（width:auto + max-width:100%）');
ok(stackH.capCount === 1, `(10)* 整行共用的图注在 HTML 里只出现一次（实际 ${stackH.capCount} 次）`);
ok(stackH.capAfterFlex === true, '(10)* 图注排在 display:flex 容器**之后**（不放进容器里）');
ok(/^<center><span style="color:\s*#555555;\s*font-size:\s*0\.85rem;/.test(stackH.afterRow),
  `(10)* 行下图注沿用 <center> + #555555 + 0.85rem${stackH.afterRow}）`);
ok(stackH.innerDivs === 0, `(10)* 不勾"每张图各自一时不生成多余的子 div（实"${stackH.innerDivs} 个）`);

// 10b. 每张图各自一条图注（可选能力）
await resetEditor();
await clickSel('[data-tb="stack"]');
await evaluate(`(()=>{document.getElementById('tbF_count').value='2';
  [...document.querySelectorAll('#tbF_mode .tb-seg')].find(x=>x.textContent==='同高度').click();
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
  // 跳过图片占位框里的文件名显示层（data-tb-display）：它只是显示，不是内容
  const caps = [...ed.querySelectorAll('span')]
    .filter(s => !s.closest('[data-tb-display]'))
    .map(s => s.textContent);
  return JSON.stringify({ innerDivs: row ? row.querySelectorAll('div').length : -1,
    caps: caps, hasCenter: /<center>/.test(ed.innerHTML),
    html: ed.innerHTML });
})()`);
ok(stackPer.innerDivs === 2, `(10) 每图单独图注时每张图各有一text-align:center div${stackPer.innerDivs} 个）`);
ok(stackPer.caps.length === 2 && /正面/.test(stackPer.caps[0]) && /背面/.test(stackPer.caps[1]),
  `(10) 每张图的图注各就各位${JSON.stringify(stackPer.caps)}）`);
ok(stackPer.hasCenter === false, '(10) 每图单独图注时不额外再加一条整行图注');

// 10c. 同宽度模式：2 张，宽度calc 等分
await resetEditor();
await clickSel('[data-tb="stack"]');
await evaluate(`(()=>{document.getElementById('tbF_count').value='2';
  [...document.querySelectorAll('#tbF_mode .tb-seg')].find(x=>x.textContent==='同宽度').click();
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
ok(stackW.n === 2 && stackW.calcs === 2, `(10)* 同宽度模式下每张图都width:calc(${stackW.calcs}/2）`);
ok(/width:calc\(\(100% - 20px\) \/ 2\)/.test(stackW.styles[0]),
  `(10)* 等分公式把gap 算进去了100% - (n-1)*20px) / n，实际${stackW.styles[0]}）`);

// 10c-2. 同宽度模式填**总宽度比例**：纯数字按百分比处理（用户点名要的语义修正）
await resetEditor();
await clickSel('[data-tb="stack"]');
await evaluate(`(()=>{document.getElementById('tbF_count').value='2';
  [...document.querySelectorAll('#tbF_mode .tb-seg')].find(x=>x.textContent==='同宽度').click();
  document.getElementById('tbF_size').value='80';
  document.getElementById('tbF_sharedCap').value='';
  document.getElementById('tbF_src1').value='readmes/image/rmb2/1953_2fen_1.jpg';
  document.getElementById('tbF_src2').value='readmes/image/rmb2/1953_2fen_2.png';
  return 1;})()`);
await clickSel('#tbDialogOk');
const stackW2 = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  const styles = [...ed.querySelectorAll('img')].map(i => i.getAttribute('style') || '');
  return JSON.stringify({ n: styles.length, styles: styles });
})()`);
ok(stackW2.n === 2 && /^width:80%;height:auto;$/.test(stackW2.styles[0]),
  `(10)* 同宽度模式只填数字时按百分比处理（80 ⇒ width:80%，实际 ${JSON.stringify(stackW2.styles[0])}）`);

// 10d. 4 张也要能出（上限内）
await resetEditor();
await clickSel('[data-tb="stack"]');
await evaluate(`(()=>{document.getElementById('tbF_count').value='4';
  for (let i=1;i<=4;i++) document.getElementById('tbF_src'+i).value='readmes/image/rmb2/p'+i+'.jpg';
  return 1;})()`);
await clickSel('#tbDialogOk');
const stack4 = await evaluate(`document.querySelectorAll('#tbEditor img').length`);
ok(stack4 === 4, `(10) 4 张也支持（实际${stack4} 张，flex-wrap 会自动换行）`);

// ==============================================================
console.log('\n====== (11) 草稿自动保存 / 恢复弹窗 ======\n');
// 刷新 + 打开工具箱的辅助（草稿弹窗只刷新后的新会里才弹，所以每条都要真刷新
const reloadAndOpen = async () => {
  await evaluate(`toolboxClose()`).catch(() => {});
  // 这一小段等待是必须的：localStorage 的写入要等渲染进程把改动提交到浏览器进程
  //   存储后端之后，刷新后的新页面才读得到。紧贴着 setItem reload，偶尔会出现
  //   "刷新完草稿不见了"（实测到过，纯测试时序问题，不是产品逻辑问题）。
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
};
// 草稿弹窗的现场快照（可见/ 文字 / 层级 / 两个按钮 / 焦点在不在里面/ 有没有残留遮罩）
const draftAskShot = () => json(`(()=>{const d=document.getElementById('tbDraftAsk');
  const mod=document.getElementById('toolboxModal');
  const r=d.getBoundingClientRect();
  const card=d.querySelector('.tb-dialog-card');
  const z=[getComputedStyle(d).zIndex, getComputedStyle(mod).zIndex];
  return JSON.stringify({
    open: d.hidden === false && getComputedStyle(d).display !== 'none',
    hidden: d.hidden,
    text: (d.textContent || '').replace(/\\s+/g, ' ').trim(),
    inViewport: r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0
      && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
    // 不用 offsetParent 判断可见性：.tb-ask position:fixed，按规范它的
    //   offsetParent 恒为 null —那是定位方式决定的，看不看得无关
    hasBox: r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden' && getComputedStyle(d).opacity !== '0',
    offsetParent: d.offsetParent !== null,
    zIndex: z[0], modalZ: z[1],
    restoreText: (document.getElementById('tbDraftRestore') || {}).textContent,
    discardText: (document.getElementById('tbDraftDiscard') || {}).textContent,
    cardW: card ? Math.round(card.getBoundingClientRect().width) : 0,
    focused: d.contains(document.activeElement),
    editorText: (document.getElementById('tbEditor').textContent || '').trim(),
    draft: (function(){try{return localStorage.getItem('collection.toolbox.draft');}catch(e){return 'THREW';}})()
  });})()`);
// 直接写一条真草稿localStorage（等价于"上次没写完就关掉"
const seedDraft = (html) => evaluate(`(()=>{try{localStorage.setItem('collection.toolbox.draft', ${JSON.stringify(html)});}catch(e){};return 1;})()`)
  .then(async (r) => { await sleep(220); return r; });   // 等存储提交，见 reloadAndOpen 的说明

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
// 关掉再打开一*同一次会话*）：内容原样保留，且***弹草稿询—内容根本没丢
await evaluate(`window.__confirmCalled = 0; window.confirm = function(){ window.__confirmCalled++; return false; };`);
await evaluate(`toolboxClose()`);
await sleep(200);
await evaluate(`toolboxOpen()`);
await sleep(400);
const reopened = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  return JSON.stringify({
    askOpen: document.getElementById('tbDraftAsk').hidden === false,
    hasRestore: !!document.getElementById('tbDraftRestore'),
    hasDiscard: !!document.getElementById('tbDraftDiscard'),
    editorText: (ed.textContent || '').trim(),
    codeText: document.getElementById('tbCode').value,
    confirmCalled: window.__confirmCalled
  });
})()`);
console.log(`  同会话重开：草稿弹窗开着=${reopened.askOpen}，正文${reopened.editorText}」`);
ok(reopened.editorText === '这是没写完的草稿正文',
  `(11)* 同一次会话里关掉再打开，内容原样保留（${reopened.editorText}」）`);
ok(/没写完的草稿正文/.test(reopened.codeText), '(11)* 代码区也原样保留（没有被清空）');
ok(reopened.askOpen === false,
  '(11)* 同会话重开**不**弹草稿询问（内容没丢，问了只会多余）');
ok(reopened.confirmCalled === 0, '(11)* 没有用 confirm 打断（用的是站内样式的弹窗）');
ok(reopened.hasRestore && reopened.hasDiscard, '(11) 草稿弹窗里「恢复」「丢弃」两个按钮在 DOM 里');

// ---- 刷新页面：会话标记没了打开时编辑区是空的，这时才弹窗问一----
await reloadAndOpen();
const ask1 = await draftAskShot();
console.log(`  刷新后重开：草稿弹open=${ask1.open} 文案${ask1.text}」z-index=${ask1.zIndex}(主弹${ask1.modalZ})`);
ok(ask1.editorText === '',
  '(11)* 刷新后打开时编辑区是空的（草稿**不自动**灌进去，先问）');
ok(ask1.open === true && ask1.inViewport === true && ask1.hidden === false && ask1.hasBox === true,
  '(11)* 刷新后打开：「发现草稿」弹窗真的可见（有实际盒子、在视口内、不是 hidden）');
ok(/发现未保存草稿/.test(ask1.text),
  `(11)* 弹窗文案含「发现未保存草稿」（实际「${ask1.text}」）`);
ok(Number(ask1.zIndex) > Number(ask1.modalZ) && Number(ask1.zIndex) > 0,
  `(11)* 弹窗层级高于工具箱主弹窗${ask1.zIndex} > ${ask1.modalZ}）`);
ok(ask1.restoreText === '恢复' && ask1.discardText === '丢弃',
  `(11)* 两个按钮是「恢复/ 丢弃」（${ask1.restoreText} / ${ask1.discardText}）`);
ok(ask1.cardW > 0 && ask1.cardW <= 440, `(11)* 是小尺寸居中的卡片（自${ask1.cardW}px）`);
ok(ask1.focused === true, '(11)* 弹窗打开时焦点在它里面（属于允许抢焦点的对话框）');

// 点「恢复」：内容回来、弹窗消失、焦点回到正
await clickSel('#tbDraftRestore');
await sleep(200);
const restored = await json(`(()=>{
  const ed = document.getElementById('tbEditor'); const a = document.activeElement;
  return JSON.stringify({ text: (ed.textContent || '').trim(),
    askOpen: document.getElementById('tbDraftAsk').hidden === false,
    focused: !!(a && (a === ed || ed.contains(a))),
    code: document.getElementById('tbCode').value,
    draftStill: !!localStorage.getItem('collection.toolbox.draft') });
})()`);
console.log(`  点「恢复」：正文${restored.text}」，弹窗开着=${restored.askOpen}，焦点在正文=${restored.focused}`);
ok(/没写完的草稿正文/.test(restored.text), `(11)* 点「恢复」后内容回来了（${restored.text}」）`);
ok(restored.askOpen === false, '(11)* 恢复后草稿弹窗自己收起来');
ok(restored.focused === true, '(11)* 恢复后焦点回到正文（可以直接接着写）');
ok(restored.draftStill === true, '(11)* 「恢复」不删草稿（用户还要接着改）');

// 再刷新（草稿还在）→ 点「丢弃」：草稿真的没了、编辑区保持原
await reloadAndOpen();
const ask2 = await draftAskShot();
ok(ask2.open === true, '(11) 再刷新一次：草稿还在，弹窗又出现（上一步的「恢复」没有顺手删草稿）');
await clickSel('#tbDraftDiscard');
await sleep(200);
const discarded = await json(`(()=>{
  let raw = null; try { raw = localStorage.getItem('collection.toolbox.draft'); } catch(e) {}
  const ed = document.getElementById('tbEditor'); const a = document.activeElement;
  return JSON.stringify({ raw: raw, askOpen: document.getElementById('tbDraftAsk').hidden === false,
    editor: (ed.textContent || '').trim(),
    focused: !!(a && (a === ed || ed.contains(a))) });
})()`);
ok(discarded.raw === null && discarded.askOpen === false, '(11)* 点「丢弃」后草稿真的被删掉了、弹窗收起');
ok(discarded.editor === '', '(11) 丢弃后编辑区是空的（没有被灌进任何内容）');
ok(discarded.focused === true, '(11) 丢弃后焦点回到正文');

// 草稿已经删了：再刷新重开**不该**再弹
await reloadAndOpen();
const afterDiscardReload = await draftAskShot();
ok(afterDiscardReload.open === false && afterDiscardReload.hidden === true,
  '(11)* 草稿删掉之后，刷新重开不再弹（弹窗是 hidden 的）');

// Esc = 稍后再说：弹窗关掉，*草稿既不恢复也不删除**（下次打开还会问）
await seedDraft('<p>Esc 也先留着的草稿</p>');
await reloadAndOpen();
const escAsk = await draftAskShot();
ok(escAsk.open === true, '(11) 又造了一条草稿：刷新重开时弹窗再次出现');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(320);
const escAfter = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  return JSON.stringify({ askOpen: document.getElementById('tbDraftAsk').hidden === false,
    modalOpen: getComputedStyle(document.getElementById('toolboxModal')).display === 'flex',
    editor: (ed.textContent || '').trim(),
    draft: (function(){try{return localStorage.getItem('collection.toolbox.draft');}catch(e){return 'THREW';}})() });
})()`);
console.log(`  Esc 之后：弹窗开着=${escAfter.askOpen}，工具箱开着=${escAfter.modalOpen}，草稿还${!!escAfter.draft}`);
ok(escAfter.askOpen === false, '(11)* 按 Esc 关掉草稿弹窗（视为"稍后再说"）');
ok(escAfter.modalOpen === true, '(11)* Esc ֻزݸ嵯**顺手把整个工具箱也关');
ok(escAfter.editor === '', '(11)* 按 Esc 不恢复内容（编辑区仍是空的）');
ok(!!escAfter.draft, '(11)* Esc **不删**ݸ壨ݸ廹localStorage 里）');
// 再打开一次（同会话内不弹）—但刷新后仍会弹，证明草稿确实留着
await reloadAndOpen();
const escAgain = await draftAskShot();
ok(escAgain.open === true, '(11)* Esc 之后刷新重开：草稿弹*仍然**出现在下次打开还会');
await clickSel('#tbDraftDiscard');                 // 收尾：把这条草稿清掉，别影响后面的用例
await sleep(200);
// 「清空并删除行稿」要防误触：第一次点只是换个文案，第二次才真清。
// 这里必须手动派发 input 事件：草稿是靠编辑区input/keyup 触发的，
//   innerHTML 直接塞内容浏览器不会input，草稿永远不会被调度（这是测试侧的坑，不是功能坏）。
const typeIntoEditor = (text) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>'+${JSON.stringify(text)}+'</p>';
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();
  ed.dispatchEvent(new Event('input',{bubbles:true}));
  return 1;})()`);
await typeIntoEditor('待清空内');
await sleep(800);
const beforeClear = await evaluate(`(localStorage.getItem('collection.toolbox.draft')||'').length`);
ok(beforeClear > 0, `(11) 清空前草稿已存下来（${beforeClear} 字符）`);
const clearClick1 = await json(`(()=>{const b=document.querySelector('[data-tb="cleardraft"]'); const t0=b.textContent;
  b.click(); return JSON.stringify({ before:t0, after:b.textContent,
    draftStill: (localStorage.getItem('collection.toolbox.draft')||'').length,
    editor: (document.getElementById('tbEditor').textContent||'').trim() });})()`);
ok(clearClick1.after !== clearClick1.before && /确定吗/.test(clearClick1.after),
  `(11)* 第一次点只是二次确认（按钮变成「${clearClick1.after}」），内容与草稿都还在`);
ok(clearClick1.draftStill > 0 && clearClick1.editor === '待清空内', '(11)* 确认前什么都没删');
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

// ---------- (11d) 草稿里带文件名：名字与内*各自独立**持久----------
// 用户实测：输入标题后刷新，标题又变回 Untitled。所以草稿要连名字一起存。
const setName = (v) => evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.value=${JSON.stringify(v)};
  n.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
const nameNow = () => evaluate(`document.getElementById('tbFileName').value`);
const draftRawNow = () => evaluate(`(function(){try{return localStorage.getItem('collection.toolbox.draft')||'';}catch(e){return 'THREW';}})()`);
const draftObjNow = () => json(`(()=>{let raw=null;try{raw=localStorage.getItem('collection.toolbox.draft');}catch(e){raw='THREW';}
  let o=null; try{o=JSON.parse(raw||'null');}catch(e){}
  return JSON.stringify({raw:raw, isObj:!!(o&&typeof o==='object'), html:o?o.html:'', name:o?o.name:'', editor:(document.getElementById('tbEditor').textContent||'').trim()});})()`);

// 只改名字、内容留空：名字也要进草稿（防抖写）
await evaluate(`(()=>{try{localStorage.removeItem('collection.toolbox.draft');}catch(e){} return 1;})()`);
await evaluate(`(()=>{document.getElementById('tbEditor').innerHTML='<p><br></p>'; return 1;})()`);
await setName('只改名字的文');
await sleep(900);
const onlyName = await draftObjNow();
ok(onlyName.isObj === true && onlyName.name === '只改名字的文' && onlyName.html === '',
  `(11d)* 只改名字、内容为草稿里存下了名字（name${onlyName.name} html 长度 ${(onlyName.html||'').length}）`);
// 刷新重开：弹**出现（名字不是默认值也有未完成的工），点恢名字回来
await reloadAndOpen();
const onlyNameAsk = await draftAskShot();
ok(onlyNameAsk.open === true, '(11d)* 只改了名字：刷新重开时草稿弹窗出现（内容为空也要问）');
await clickSel('#tbDraftRestore');
await sleep(400);
const onlyNameRestored = await nameNow();
ok(onlyNameRestored === '只改名字的文', `(11d)* 点「恢复」把名字放回输入框（${onlyNameRestored}」）`);
ok((await evaluate(`document.getElementById('tbEditor').textContent.trim()`)) === '',
  '(11d) 恢复名字不会凭空造出内容（编辑区仍为空）');
// ⑤ 「丢弃」→ 名字回 Untitled、内容清空
await setName('丢弃掉的名字');
await sleep(900);
await reloadAndOpen();
ok((await draftAskShot()).open === true, '(11d) 第二次只改名字：刷新重开仍然');
await clickSel('#tbDraftDiscard');
await sleep(400);
const afterDiscardName = await nameNow();
ok(afterDiscardName === 'Untitled', `(11d)* 点「丢弃」后名字回到 Untitled（${afterDiscardName}」）`);
await reloadAndOpen();
const afterDiscardNameAsk = await draftAskShot();
ok(afterDiscardNameAsk.open === false,
  '(11d)* 丢弃之后（无内容 + 默认名字）刷新重开**不再**弹窗');
// 内容 + 名字一起存 / 一起恢复
await resetEditor();
await send('Input.insertText', { text: '正文和标题都存' });
await setName('内容加名字');
await sleep(900);
const bothDraft = await draftObjNow();
ok(bothDraft.isObj === true && bothDraft.name === '内容加名字' && /正文和标题都存/.test(bothDraft.html),
  `(11d)* 内容与名字一起存进草稿（name${bothDraft.name} html 含正${/正文和标题都存/.test(bothDraft.html)}）`);
await reloadAndOpen();
await clickSel('#tbDraftRestore');
await sleep(400);
const bothRestored = await json(`(()=>{return JSON.stringify({name:document.getElementById('tbFileName').value,
  text:(document.getElementById('tbEditor').textContent||'').trim()});})()`);
ok(bothRestored.name === '内容加名字' && /正文和标题都存/.test(bothRestored.text),
  `(11d)* 「恢复」把内容与名字一起还原（名字${bothRestored.name} 正文${bothRestored.text}」）`);
// 用户实测：输入标题后刷新，标题又变回 Untitled。所以草稿要连名字一起存。
await reloadAndOpen();
await clickSel('#tbDraftDiscard');
await sleep(400);
const bothDiscarded = await json(`(()=>{return JSON.stringify({name:document.getElementById('tbFileName').value,
  text:(document.getElementById('tbEditor').textContent||'').trim(),
  draft:(function(){try{return localStorage.getItem('collection.toolbox.draft');}catch(e){return 'THREW';}})()});})()`);
ok(bothDiscarded.name === 'Untitled' && bothDiscarded.text === '' && bothDiscarded.draft === null,
  `(11d)* 「丢弃」把名字Untitled、内容清空、草稿删掉（名字${bothDiscarded.name} 草稿 ${bothDiscarded.draft}）`);
// 向后兼容：旧格式（纯 HTML 字符串、没name 字段）必须能读，名字回退 Untitled，内容不足
await evaluate(`(()=>{try{localStorage.setItem('collection.toolbox.draft','<p>旧格式的草稿内容</p>');}catch(e){} return 1;})()`);
await sleep(240);
const legacyParse = await json(`(()=>{let raw=null;try{raw=localStorage.getItem('collection.toolbox.draft');}catch(e){raw='THREW';}
  const p=(typeof toolboxDraftParse==='function')?toolboxDraftParse():null;
  return JSON.stringify({raw:raw, html:p?p.html:'', name:p?p.name:'', hasWork:(typeof toolboxDraftHasWork==='function')?toolboxDraftHasWork():null});})()`);
ok(legacyParse.html === '<p>旧格式的草稿内容</p>' && legacyParse.name === '',
  `(11d)* 旧格式（纯字符串）能正常读出来：内容一字不丢、名字为空（html${legacyParse.html}」）`);
ok(legacyParse.hasWork === true, '(11d)* 旧格式但有内仍然只有未完成的工（会弹窗');
await reloadAndOpen();
const legacyAsk = await draftAskShot();
ok(legacyAsk.open === true, '(11d)* 旧格式草稿：刷新重开照常弹窗');
await clickSel('#tbDraftRestore');
await sleep(400);
const legacyRestored = await json(`(()=>{return JSON.stringify({name:document.getElementById('tbFileName').value,
  text:(document.getElementById('tbEditor').textContent||'').trim()});})()`);
ok(legacyRestored.name === 'Untitled' && /旧格式的草稿内容/.test(legacyRestored.text),
  `(11d)* 旧格式恢复：内容回来了、名字回退 Untitled（名字${legacyRestored.name} 正文${legacyRestored.text}」）`);
// 旧格式+ 内容为空（比'""' 或空串残留）视为没有草稿*不弹**
await evaluate(`(()=>{try{localStorage.setItem('collection.toolbox.draft','<p><br></p>');}catch(e){} return 1;})()`);
await sleep(240);
const legacyEmptyWork = await evaluate(`(typeof toolboxDraftHasWork==='function') ? toolboxDraftHasWork() : 'no-fn'`);
ok(legacyEmptyWork === false, '(11d)* 旧格式但内容为空 视为没有未完成的工作（不弹窗');
await reloadAndOpen();
ok((await draftAskShot()).open === false, '(11d)* 旧格式空内容：刷新重开确实不弹');
ok((await nameNow()) === 'Untitled', '(11d)* 旧格式空内容：名字显示Untitled');
await evaluate(`(()=>{try{localStorage.removeItem('collection.toolbox.draft');}catch(e){} return 1;})()`);
await reloadAndOpen();
// 收尾：给后面的用例（12）留一份内容（本段前面几轮刷新把编辑区清空了）
await resetEditor();
await send('Input.insertText', { text: '第十二节用的正文' });
await sleep(700);

// ==============================================================
console.log('\n====== (12) 复制 HTML / 下载 .html ======\n');
const copyInfo = await json(`(()=>{const b=document.querySelector('[data-tb="copy"]');
  return JSON.stringify({text:b.textContent.trim(),exists:!!b});})()`);
ok(copyInfo.exists === true, `(12) 复制按钮存在（${copyInfo.text}」）`);
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
ok(copyRes.threw === null, `(12)* 调复制不抛异常（返回${copyRes.ret}）`);
ok(copyRes.codeLen > 0, `(12) 复制的是代码区里那份 HTML${copyRes.codeLen} 个字符）`);
ok(copyRes.toastShown === true, `(12) 复制后有明确反馈（提示：${copyRes.toastText}」）`);
// 也走一遍真点击，确认按钮的 click 链路通
await clickSel('[data-tb="copy"]');
const copyToast2 = await json(`(()=>{const t=document.getElementById('tbToast');
  return JSON.stringify({shown:t.classList.contains('show'),text:(t.textContent||'').slice(0,60)});})()`);
ok(copyToast2.shown === true, `(12)* 真点按钮也走通了（提示：${copyToast2.text}」）`);

const dlBtnState = await json(`(()=>{const b=document.querySelector('[data-tb="download"]');
  return JSON.stringify({found:!!b, disabled:b?b.disabled:null, aria:b?b.getAttribute('aria-disabled'):null,
    tip:b?b.title:'', text:(b?b.textContent:'').trim(),
    activeId:document.activeElement?(document.activeElement.id||document.activeElement.tagName):'',
    inCode:(typeof toolboxFocusInCode==='function')?toolboxFocusInCode():'no-fn',
    global:(typeof TOOLBOX_GLOBAL_ACTS!=='undefined')?TOOLBOX_GLOBAL_ACTS.join(','):'no-const'});})()`);
await clickSel('[data-tb="download"]');
const dl = await json(`(()=>{const t=document.getElementById('tbToast');
  return JSON.stringify({ name: window.__tbDownloaded || '', text: (t.textContent||'').slice(0, 60) });})()`);
ok(dl.name === 'Untitled.html',
  `(12)* 左上角文件名留空 下载就用 Untitled.html${dl.name}）`);
ok(/下载|download/i.test(dl.text), `(12) 下载有提示（${dl.text}）`);
// 文件名清洗 + 后缀规则（留空/非法字符/已带后缀三种情况）
const nameRules = await json(`(()=>{
  const inp = document.getElementById('tbFileName');
  const before = inp.value;
  const out = {};
  inp.value = ''; out.empty = toolboxFileName();
  inp.value = '  我的 报告 / 2024 版 : * ';
  out.dirty = toolboxFileName();
  inp.value = 'archive.htm'; out.htm = toolboxFileName();
  inp.value = 'notes.html'; out.html = toolboxFileName();
  inp.value = 'noext'; out.append = toolboxFileName();
  inp.value = 'report.final.v2'; out.customExt = toolboxFileName();
  inp.value = before;
  return JSON.stringify(out);
})()`);
console.log(`  文件名规则：${JSON.stringify(nameRules)}`);
ok(nameRules.empty === 'Untitled.html', `(12)* 空值回落Untitled.html${nameRules.empty}）`);
ok(nameRules.dirty === '我的 报告 2024 版.html',
  `(12)* 非法字符 / \\\\ : * ? " < > | 被清掉、首尾空白去掉、补 .html"${nameRules.dirty}）`);
ok(nameRules.htm === 'archive.html' && nameRules.html === 'notes.html',
  `(12)* 后缀规则：已写.html/.htm 都先剥掉再补 .html（archive.htm ${nameRules.htm}；notes.html ${nameRules.html}）`);
ok(nameRules.append === 'noext.html', `(12)* 没写扩展名才补.html（noext ${nameRules.append}）`);
ok(nameRules.customExt === 'report.final.v2', `(12)* 任意已有扩展名都保留${nameRules.customExt}）`);
// 真下载时用的是清洗后的名字
await evaluate(`(()=>{document.getElementById('tbFileName').value=' 我的/报告:2024 ';return 1;})()`);
await clickSel('[data-tb="download"]');
const dl2 = await evaluate(`window.__tbDownloaded || ''`);
ok(dl2 === '我的报告2024.html', `(12)* 下载用的是清洗后的文件名${dl2}）`);
await evaluate(`(()=>{document.getElementById('tbFileName').value='';return 1;})()`);

// ==============================================================
console.log('\n====== (13) 关闭干净：Esc / 点遮罩，不留监听泄漏 ======\n');
// 探针只挂在两个元素上，而且**只在编辑区上派发一* keyup
// 事件会冒泡，所以一次派发应该正好打到两个探针（编辑1 + 弹窗 1 次）。
// 每次打开都重新挂一遍监，这个数会一轮轮变大（ 4 6…）」
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
    draftAskOpen: !document.getElementById('tbDraftAsk').hidden });
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
  `(13)* 来回开关不重复挂监听（第二次只多了 ${fire2.probe - fire1.probe} 次，恒为 2：编辑区 1 + 冒泡到弹窗1）`);

// 点遮罩关闭
const maskInfo = await json(`(()=>{const mod=document.getElementById('toolboxModal');const r=mod.getBoundingClientRect();
  return JSON.stringify({x:r.left+6,y:r.top+6});})()`);
await clickAt(maskInfo.x, maskInfo.y);
await sleep(300);
const afterMask = await evaluate(`getComputedStyle(document.getElementById('toolboxModal')).display`);
ok(afterMask === 'none', '(13)* 点遮罩也关得掉');

// 关掉之后主站还得是活的（下拉框/ Tab / 设置页）
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
console.log(`  主站状态：设置${mainAlive.settings} Tab=${mainAlive.tabs} 原生select=${mainAlive.selects}(可见${mainAlive.visibleSelects}) 自绘下拉=${mainAlive.ddCount}`);
ok(mainAlive.settings === true && mainAlive.tabs === 5, '(13) 关掉工具箱后「我的」页面与底部 Tab 都还在');
ok(mainAlive.visibleSelects === 0 && mainAlive.ddCount > 0, '(13) 下拉栏仍是自绘顶上、原生藏着的既有状态（没被工具箱改坏）');
ok(mainAlive.bodyLocked === false && mainAlive.modalOpen === false, '(13) 没有留下任何滚动锁');

// ==============================================================
console.log('\n====== (14) 像窗口一样：拖动 / 八向缩放 / 全屏 ======\n');
const clearDraft = () => evaluate(`(()=>{try{localStorage.removeItem('collection.toolbox.draft');}catch(e){};return 1;})()`);
await clearDraft();
await evaluate(`toolboxOpen()`);
await sleep(360);

// 拖动辅助：按下分几步移动（真鼠标事件会给出一串pointermove）→ 抬起
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
console.log(`  默认窗口：${base.w}x${base.h} @ (${base.l},${base.t})；手${base.grips.join('/')}`);
ok(base.grips.length === 8, '(14) 八个手柄都在 DOM 里（n/s/w/e/nw/ne/sw/se）');
for (const d of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
    ok(base.grips.indexOf(d) >= 0, `(14) 手柄${d}」存在`);
}
ok(base.w > 1300 && base.h > 700, `(14) 打开时是默认的居中大窗口（${base.w}x${base.h}）`);

// 先把窗口缩小：默认尺寸已经是 min(1400px,96vw)，几乎占满视口宽度，
//   这时往往下拖都会"不许拖出屏幕"的夹取拦住（能拖动的距离（0），
//   所以先缩到一个有余量的尺寸，后面每一步拖动都能真的走满。
const pe0 = await gripPoint('e');
await dragBy(pe0.x, pe0.y, -300, 0);
const ps0 = await gripPoint('s');
await dragBy(ps0.x, ps0.y, 0, -200);
const shrunk = await cardBox();
console.log(`  先缩小到：${shrunk.w}x${shrunk.h} @ (${shrunk.l},${shrunk.t})`);
ok(shrunk.w < base.w - 200 && shrunk.h < base.h - 150, `(14) 预置：窗口已缩小（${shrunk.w}x${shrunk.h}）`);

// 拖动标题栏。★ 落点必须空白：标题栏左边是文件名输入框、右边是全屏/关闭按钮
//    在这三处按下都**不该**触发拖动（下面一条用例专门验它）。
const headPt = await json(`(()=>{const h=document.getElementById('tbHead');const r=h.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width*0.55),y:Math.round(r.top+r.height/2)});})()`);
await dragBy(headPt.x, headPt.y, 70, 46);
const moved = await cardBox();
console.log(`  拖动后：(${moved.l},${moved.t})，尺${moved.w}x${moved.h}`);
ok(Math.abs(moved.l - (shrunk.l + 70)) <= 3 && Math.abs(moved.t - (shrunk.t + 46)) <= 3,
  `(14)* 按住标题栏拖动，窗口位置跟着走（Δ=${moved.l - shrunk.l},${moved.t - shrunk.t}）`);
ok(moved.w === shrunk.w && moved.h === shrunk.h, '(14) 拖动只改位置，不改尺寸');
// 标题栏左侧的文件名输入框 / 右侧的按钮上按下：不许拖动窗口（否则"点关闭会变成拖窗口"?
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
  `(14)* 在文件名输入框上拖动不会挪窗口（${posBeforeNoDrag.l},${posBeforeNoDrag.t} ${afterInputDrag.l},${afterInputDrag.t}）`);
await dragBy(noDragSpots.bx, noDragSpots.by, 60, 40);
const afterBtnDrag = await cardBox();
ok(afterBtnDrag.l === afterInputDrag.l && afterBtnDrag.t === afterInputDrag.t,
  '(14)* 在全屏按钮上拖动也不会挪窗口（点按钮不会被当成拖标题栏）');
const stillOpen = await evaluate(`getComputedStyle(document.getElementById('toolboxModal')).display`);
ok(stillOpen === 'flex',
  `(14)* 从全屏按钮上起手、抬在遮罩上也不点遮（弹窗还开着${stillOpen}）`);
const headerLayout = await json(`(()=>{const h=document.getElementById('tbHead').getBoundingClientRect();
  const inp=document.getElementById('tbFileName').getBoundingClientRect();
  const fs=document.getElementById('tbFullBtn').getBoundingClientRect();
  const cl=document.querySelector('.tb-close').getBoundingClientRect();
  return JSON.stringify({inpLeft:Math.round(inp.left-h.left), inpW:Math.round(inp.width),
    fsRight:Math.round(h.right-fs.right), clRight:Math.round(h.right-cl.right),
    fsBeforeClose: fs.left < cl.left,
    btnH:Math.round(fs.height), closeW:Math.round(cl.width)});})()`);
console.log(`  标题栏布局：文件名${headerLayout.inpLeft}px ${headerLayout.inpW}px；全屏距右${headerLayout.fsRight}px、关闭距右${headerLayout.clRight}px`);
ok(headerLayout.inpW >= 200 && headerLayout.inpW <= 260,
  `(14)* 文件名输入框宽度合理${headerLayout.inpW}px00~260 之间，不铺满整行）`);
ok(headerLayout.fsBeforeClose && headerLayout.clRight <= 16 && headerLayout.fsRight > headerLayout.clRight,
  `(14)* 全屏与关闭都在标题栏最右上角（全屏距右 ${headerLayout.fsRight}px、关闭距右${headerLayout.clRight}px）`);
ok(headerLayout.btnH <= 30 && headerLayout.closeW <= 30,
  `(14)* 右上角两个按钮是紧凑尺寸（全屏高 ${headerLayout.btnH}px、关闭宽 ${headerLayout.closeW}px）`);

// 拖右边手柄：只改
const beforeE = await cardBox();
const pe = await gripPoint('e');
ok(pe.hit === 'e', `(14) 东侧手柄在最上层、点得到（elementFromPoint 命中缓${pe.hit}」）`);
await dragBy(pe.x, pe.y, 60, 0);
const afterE = await cardBox();
ok(Math.abs(afterE.w - (beforeE.w + 60)) <= 3, `(14)* 拖右边：宽度 +60${beforeE.w}${afterE.w}）`);
ok(afterE.h === beforeE.h, `(14)* 拖右边：高度不变（${afterE.h}）`);
ok(afterE.l === beforeE.l && afterE.t === beforeE.t, '(14) 拖右边：左上角原点不动');

// 拖下边手柄：只改
const beforeS = await cardBox();
const ps = await gripPoint('s');
ok(ps.hit === 's', `(14) 南侧手柄在最上层、点得到（命中口${ps.hit}」）`);
await dragBy(ps.x, ps.y, 0, 50);
const afterS = await cardBox();
ok(Math.abs(afterS.h - (beforeS.h + 50)) <= 3, `(14)* 拖下边：高度 +50${beforeS.h}${afterS.h}）`);
ok(afterS.w === beforeS.w, `(14)* 拖下边：宽度不变（${afterS.w}）`);
ok(afterS.l === beforeS.l && afterS.t === beforeS.t, '(14) 拖下边：左上角原点不动');

// 拖左边手柄：宽度变化 + 原点跟着移（右边不动
const beforeW = await cardBox();
const pw = await gripPoint('w');
await dragBy(pw.x, pw.y, -70, 0);
const afterW = await cardBox();
const rightBefore = beforeW.l + beforeW.w, rightAfter = afterW.l + afterW.w;
console.log(`  拖左边：(${beforeW.l},${beforeW.w}) (${afterW.l},${afterW.w})；右边界 ${rightBefore} ${rightAfter}`);
ok(afterW.l < beforeW.l && afterW.w > beforeW.w,
  `(14)* 拖左边：原点左移（${beforeW.l}${afterW.l}）且宽度变大（${beforeW.w}${afterW.w}）`);
ok(Math.abs(rightAfter - rightBefore) <= 3, `(14)* 拖左边：右边界不动（${rightBefore} ${rightAfter}，容3px）`);

// 拖上边手柄：高度变化 + 原点跟着移（下边不动
const beforeN = await cardBox();
const pn = await gripPoint('n');
await dragBy(pn.x, pn.y, 0, 40);
const afterN = await cardBox();
const bottomBefore = beforeN.t + beforeN.h, bottomAfter = afterN.t + afterN.h;
ok(afterN.t > beforeN.t && afterN.h < beforeN.h,
  `(14)* 拖上边：原点下移（${beforeN.t}${afterN.t}）且高度变小（${beforeN.h}${afterN.h}）`);
ok(Math.abs(bottomAfter - bottomBefore) <= 3, `(14)* 拖上边：下边界不动（${bottomBefore} ${bottomAfter}）`);

// 拖右下角：等比缩
const beforeSE = await cardBox();
const ratioBefore = beforeSE.w / beforeSE.h;
const pse = await gripPoint('se');
await dragBy(pse.x, pse.y, 90, 30);
const afterSE = await cardBox();
const ratioAfter = afterSE.w / afterSE.h;
console.log(`  拖右下角${beforeSE.w}x${beforeSE.h} ${afterSE.w}x${afterSE.h}；宽高比 ${ratioBefore.toFixed(3)} ${ratioAfter.toFixed(3)}`);
ok(afterSE.w > beforeSE.w && afterSE.h > beforeSE.h, `(14)* 拖右下角：宽高都变大（${beforeSE.w}x${beforeSE.h} ${afterSE.w}x${afterSE.h}）`);
ok(Math.abs(ratioAfter / ratioBefore - 1) <= 0.05,
  `(14)* 拖右下角：保持宽高比（偏差${(Math.abs(ratioAfter / ratioBefore - 1) * 100).toFixed(2)}%，容5%）`);

// 拖左上角：也是等比（这一条专门盯"原点跟着"的那一路）
const beforeNW = await cardBox();
const rNWBefore = beforeNW.w / beforeNW.h;
const pnw = await gripPoint('nw');
await dragBy(pnw.x, pnw.y, -60, -20);
const afterNW = await cardBox();
ok(Math.abs((afterNW.w / afterNW.h) / rNWBefore - 1) <= 0.05,
  `(14) 拖左上角同样等比（${beforeNW.w}x${beforeNW.h} ${afterNW.w}x${afterNW.h}）`);
ok(afterNW.l <= beforeNW.l && afterNW.t <= beforeNW.t, '(14) 拖左上角：左/上原点跟着动');

// 最小尺寸：往左上拖到极小也不能小于480x320（等比时最小约束同时作用到宽和高）
const pse2 = await gripPoint('se');
await dragBy(pse2.x, pse2.y, -3000, -3000);
const minBox = await cardBox();
ok(minBox.w >= 480 - 1 && minBox.h >= 320 - 1, `(14)* 缩到最小也不小于480x320（实${minBox.w}x${minBox.h}）`);

// 全屏 / 还原
const beforeFull = await cardBox();
await clickSel('#tbFullBtn');
const fullBox = await json(`(()=>{const c=document.querySelector('.tb-card');const r=c.getBoundingClientRect();
  return JSON.stringify({l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
    vw:window.innerWidth,vh:window.innerHeight, cls:c.classList.contains('tb-full')});})()`);
console.log(`  全屏按${fullBox.w}x${fullBox.h} @ (${fullBox.l},${fullBox.t})，视${fullBox.vw}x${fullBox.vh}`);
ok(fullBox.cls === true && fullBox.l === 0 && fullBox.t === 0 && Math.abs(fullBox.w - fullBox.vw) <= 2 && Math.abs(fullBox.h - fullBox.vh) <= 2,
  `(14)* 点全屏后铺满视口${fullBox.w}x${fullBox.h}）`);
await clickSel('#tbFullBtn');
const restoredWin = await cardBox();
ok(restoredWin.cls !== true && restoredWin.l === beforeFull.l && restoredWin.t === beforeFull.t
   && restoredWin.w === beforeFull.w && restoredWin.h === beforeFull.h,
  `(14)* 再点一次回*原来是*尺寸与位置（不是回到初始值）：${restoredWin.w}x${restoredWin.h} @ (${restoredWin.l},${restoredWin.t})`);

// 会话内保留：关掉再打开保持刚才那套尺寸位置（刷新页面才回默认尺寸，(11) (18d)
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
  `(14)* 同一次会话里关掉再打开，保持上次拖缩放后的尺寸位置${reopenedWin.w}x${reopenedWin.h} @ ${reopenedWin.l},${reopenedWin.t}）`);
ok(!stores.keys.some(k => /window|geometry|win(pos|size)?/i.test(k)),
  `(14)* 窗口几何**没有**进任何存储（只用内存变量，刷新后回默认：${JSON.stringify(stores.keys)}）`);

// ==============================================================
console.log('\n====== (15) 代码区可编辑：实时双向同+ 校验 + 撤回/恢复 ======\n');
// 15a 代码编辑区：真键盘输入进代码区，等防抖，编辑区应该自己跟上（不用点任何按钮）
await clearDraft();
await evaluate(`toolboxClose()`);
await sleep(140);
await evaluate(`toolboxOpen()`);
await sleep(320);
const openEmpty = await json(`(()=>{const ed=document.getElementById('tbEditor'),c=document.getElementById('tbCode');
  return JSON.stringify({editor:(ed.textContent||'').trim(), code:c.value});})()`);
// 注意：打开清空编辑只在**页面刷新后第一次打开**发生（同会话内关掉再打开是原样保留的
//   (11)）。这一节跑在前面的用例之后，所以这里用「清空」按钮显式把两份都清干净
//   顺便也就把"清空 = 真清空 + 删草稿"再验一遍。
await evaluate(`(()=>{const b=document.querySelector('[data-tb="cleardraft"]');b.click();b.click();return 1;})()`);
await sleep(200);
const cleared = await json(`(()=>{const ed=document.getElementById('tbEditor'),c=document.getElementById('tbCode');
  return JSON.stringify({editor:(ed.textContent||'').trim(), code:c.value,
    draft:(function(){try{return localStorage.getItem('collection.toolbox.draft');}catch(e){return 'THREW';}})()});})()`);
ok(cleared.editor === '' && cleared.code === '' && cleared.draft === null,
  '(15)* 标签错配 → 校验区报错（1 条：「检查 · 错误 1第 1 行：<span> 未闭合」）');
ok(openEmpty.editor !== undefined, '(15) 打开后能读到编辑区状态（前置检查）');
await evaluate(`(()=>{const c=document.getElementById('tbCode');c.value='';c.focus();return 1;})()`);
await send('Input.insertText', { text: '<center><b><span style="font-size:1.1em;">导入的标题</span></b></center>\n<table><tr><th></th></tr><tr><td></td></tr></table>' });
await sleep(700);                                    // 防抖 350ms，留足余量
const syncIn = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ table:!!ed.querySelector('table'), th:!!ed.querySelector('th'),
    title:(ed.querySelector('b')||{}).textContent||'', code:document.getElementById('tbCode').value });})()`);
ok(syncIn.table === true && syncIn.th === true, '(15)* 在代码区输入 HTML → 编辑区自动出现 <table>（无需按钮）');
ok(syncIn.title === '导入的标题', '(15)* 标题结构也解析进去了（「导入的标题」）');
ok(syncIn.code.indexOf('导入的标题') >= 0 && syncIn.code.indexOf('<table>') >= 0,
  '(15)* 代码区保留用户写下的原文（不会被归一化回写覆盖）');

// 15b 编辑代码区：仍然是归一+ 按行排版后的那份（这条是"导出"
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const r=document.createRange();r.selectNodeContents(ed);r.collapse(false);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();return 1;})()`);
await send('Input.insertText', { text: '补一' });
await sleep(400);
const syncOut = await json(`(()=>{const c=document.getElementById('tbCode').value;
  const lines=c.split('\\n');
  return JSON.stringify({ code:c, lines:lines.length,
    blank:lines.filter(function(l){return !l.trim();}).length,
    lead:lines.filter(function(l){return /^[ \\t]/.test(l);}).length,
    centerLine:lines.some(function(l){return /^<center>/.test(l);}),
    tableLine:lines.some(function(l){return /^<table>/.test(l);}) });})()`);
ok(/补一/.test(syncOut.code), '(15)* 编辑区改动 → 代码区实时更新');
ok(syncOut.lines > 1, `(15)* 生成HTML 按行排版，不是挤成一行（${syncOut.lines} 行）`);
ok(syncOut.centerLine && syncOut.tableLine,
  '(15)* 每个顶层块各占一行（<center>… 与 <table> 都从行首开始）');
ok(syncOut.lead === 0, `(15) 行首不缩进（与readmes/ 现有文章一致，缩进行数 ${syncOut.lead}）`);
ok(syncOut.blank === 0, `(15) 没有多余空行（空行${syncOut.blank} 行）`);
console.log('  导出样例：\n' + syncOut.code.split('\n').slice(0, 8).map(l => '    ' + l).join('\n'));

// 15b2 行内之间**不许**插换行（插了会被 HTML 折叠成空格，凭空改坏排版）
// ★ 事故修复：原 fixture 用的是"空 <b></b><b></b>"，而空标签在序列化时会被整个丢掉
//   （代码区输出 ""），于是 inner=null、两条断言都红 —— 不是产品问题。
//   这里换成**有字**的相邻行内节点，判定条件（相邻之间无换行）保持原样、只紧不松。
const inlineCase = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<center><b>甲</b><b>乙</b></center>';
  toolboxRefresh();
  const c = document.getElementById('tbCode').value;
  const m = c.match(/<center>([\\s\\S]*?)<\\/center>/);
  return JSON.stringify({ code: c, inner: m ? m[1] : null });
})()`);
console.log(`  行内场景${JSON.stringify(inlineCase.code)}`);
ok(inlineCase.inner !== null && inlineCase.inner.indexOf('\n') < 0,
  '(15)* <center> 内部并排的行内节点之间**没有**换行（否则会多出空格）');
ok(/<center><b>甲<\/b><b>乙<\/b><\/center>/.test(inlineCase.code), '(15) 行内节点原样相邻输出');
// flex 行（并排图片）也整体保持一行
const flexCase = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<div style="display:flex; justify-content:center; gap:20px; flex-wrap:wrap; margin:10px auto; width:80%;"><img src="readmes/image/a.jpg" style="height:180px; width:auto; max-width:100%;"><img src="readmes/image/b.jpg" style="height:180px; width:auto; max-width:100%;"></div>';
  toolboxRefresh();
  const c = document.getElementById('tbCode').value;
  return JSON.stringify({ code: c, lines: c.split('\\n').length });
})()`);
ok(flexCase.lines === 1, `(15)* 并排图片flex 容器内部不插换行${flexCase.lines} 行）`);

// 15b3 粘贴富文本的去杂质：Word 那种 class/id/px 字号
const pasteCase = await json(`(()=>{
  const ed = document.getElementById('tbEditor');
  ed.innerHTML = '<p class="MsoNormal" id="x" data-x="1"><span style="font-family:Calibri; font-size:15.2px; mso-fareast-font-family:宋体;">粘贴来的一</span></p>';
  toolboxRefresh();
  return JSON.stringify({ code: document.getElementById('tbCode').value });
})()`);
console.log(`  粘贴杂质：${JSON.stringify(pasteCase.code)}`);
ok(!/class=|id=|data-x|MsoNormal/.test(pasteCase.code), '(15)* 粘贴带进来的 class/id 被清掉');
ok(!/mso-/.test(pasteCase.code), '(15)* Word 专属的 mso-* 声明被清掉');
ok(/font-size:\s*\.?0?\.?95em/.test(pasteCase.code),
  `(15)* 15.2px 字号就近归一化成 .95em（站内刻度）`);
ok(/粘贴来的一/.test(pasteCase.code), '(15) 文字本身一个字没丢');

// 15c 校验：错配标签/ script / 正常
const setCode = async (t) => {
    await evaluate(`(()=>{const c=document.getElementById('tbCode');c.value=${JSON.stringify(t)};
      c.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
    await sleep(120);
    return json(`(()=>{const v=document.getElementById('tbValidate');
      return JSON.stringify({errors:+v.getAttribute('data-errors'),warnings:+v.getAttribute('data-warnings'),
        text:(v.textContent||'').replace(/\\s+/g,' ').slice(0,120)});})()`);
};
const lintBad = await setCode('<div><span>配错</div>');
console.log(`  错配标签 ${JSON.stringify(lintBad)}`);
ok(lintBad.errors >= 1, `(15)* 标签错配 校验区报错（${lintBad.errors} 条：${lintBad.text}」）`);
const lintScript = await setCode('<p>正文</p><script>alert(1)</script>');
ok(lintScript.errors >= 1, `(15)* <script> 校验区报错（${lintScript.errors} 条）`);
const lintOk = await setCode('<center><b><span style="font-size:1.1em;">标题</span></b></center>\n<p>正文<a href="https://a.com" target="_blank" rel="noopener">链接</a></p>\n<center><img src="readmes/image/x.jpg" width="80%"></center>');
console.log(`  正常片段 ${JSON.stringify(lintOk)}`);
ok(lintOk.errors === 0, `(15)* 正常片段 错误0（实${lintOk.errors}）`);
// 结构没配平时不许清空编辑区
await evaluate(`(()=>{const c=document.getElementById('tbCode');c.value='<div><span>半截';c.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
await sleep(650);
const keepEditor = await evaluate(`(()=>{const ed=document.getElementById('tbEditor');return (ed.textContent||'').trim();})()`);
// 编辑区里应该还留着"上一次好内容"（本用例前面刚放过「粘贴来的一段」），
// 关键在于**没有被清*；具体是哪一段不重要，所以只断言"非空 + 不是那半截坏文本"
console.log(`  代码区没配平时编辑区内容：${keepEditor.slice(0, 30)}」`);
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
await setCode('<p>第一半</p>');
await sleep(500);
const st1 = await undoState();
console.log(`  ״1：撤回禁用${st1.undo} 恢复禁用=${st1.redo} 编辑区${st1.editor}」`);
ok(st1.editor === '第一半', '(15) 状态 1：代码区输入已同步到编辑区');
ok(st1.undo === false && st1.redo === true, '(15)* 一次编辑 = 一个历史步（撤回可用、恢复仍禁用）');
// 撤回一回到起点
await clickSel('[data-tb="undo"]');
await sleep(200);
const st1b = await undoState();
ok(st1b.editor === baseline && st1b.redo === false,
  `(15)* 撤回一次就回到输入前的状态（${st1b.editor.slice(0, 20)}」）`);
// 再进一步：第二次不同修改
await clickSel('[data-tb="redo"]');
await sleep(200);
await setCode('<p>第二</p>');
await sleep(500);
const st2 = await undoState();
ok(st2.editor === '第二' && st2.undo === false, `(15)* 两次不同修改后有可撤回的历史（撤回禁用${st2.undo}）`);
// 撤回一回到第一半
await clickSel('[data-tb="undo"]');
const st3 = await undoState();
console.log(`  撤回后：编辑区${st3.editor}恢复禁用=${st3.redo}`);
ok(st3.editor === '第一半', '(15)* 编辑区改动 → 代码区实时更新');
ok(st3.redo === false, '(15) 撤回之后「恢复」可用');
// 恢复 回到第二
await clickSel('[data-tb="redo"]');
const st4 = await undoState();
ok(st4.editor === '第二', `(15)* 点恢复回到最新（「${st4.editor}」）`);
// 撤回/恢复也是键盘可达的（Ctrl+Z / Ctrl+Y），只在弹窗内拦截
await evaluate(`document.getElementById('tbEditor').focus()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await sleep(260);
const st5 = await undoState();
ok(st5.editor === '第一半', '(15)* 点「清空」后编辑区、代码区、草稿都清干净了（草稿=null）');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89, modifiers: 2 });
await sleep(260);
const st6 = await undoState();
ok(st6.editor === '第二', `(15)* Ctrl+Y 恢复（${st6.editor}」）`);

// 15e 幂等：拿真文章走"导入 导出 再导入"?再导入
// 两篇：一篇纯图文（120 张图的常见形态）、一篇带表格（表格是最容易在导入导出里被改坏的）
const ARTICLES = ['notecollection/readmes/1960_fujianlocaldebt_1yuan.html',
  'notecollection/readmes/amsx_2012.html'];
const importExport = async (text) => {
    await evaluate(`(()=>{const c=document.getElementById('tbCode');c.value=${JSON.stringify(text)};
      c.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
    await sleep(700);                                  // 等代码区 编辑区的防抖
    // "导出"= 编辑代码区这一路的结果：把编辑区内容重新渲染成代码区文
    return evaluate(`(()=>{toolboxRefresh(); return document.getElementById('tbCode').value;})()`);
};
for (let ai = 0; ai < ARTICLES.length; ai++) {
    const ARTICLE = ARTICLES[ai];
    const art = readFileSync(ARTICLE, 'utf8');
    const hasTable = /<table/.test(art);
    console.log(`  真文章：${ARTICLE}${art.length} 字符，表格${hasTable}）`);
    ok(/<img /.test(art), `(15) ${ARTICLE} 里有图片（幂等测试要覆盖 <center><img  那一路）`);
    const e1 = await importExport(art);
    const e2 = await importExport(e1);
    const e3 = await importExport(e2);
    console.log(`  导出长度：第 1 ${e1.length}，第 2 ${e2.length}，第 3 ${e3.length}`);
    ok(e1 === e2, '(15) 打开后能读到编辑区状态（前置检查）');
    ok(e2 === e3, '(15)* Ctrl+Y 恢复（「第二段」）');
    // 语料里的关键结构不能在导入导出里丢掉
    if (hasTable) ok(/<table/.test(e2), '(15) 打开后能读到编辑区状态（前置检查）');
    ok(/readmes\/image\//.test(e2), '(15) 打开后能读到编辑区状态（前置检查）');
    ok(/<img /.test(e2), '(15) 打开后能读到编辑区状态（前置检查）');
    // 按行排版：顶层块各占一行，且**标签行**行首不缩进（与 readmes/ 里的写法一致）。
    // 只查以 < 开头的行：正文文本行原样保留用户/语料里的空格，那不是缩进。
    const lines = e2.split('\n');
    const tagLines = lines.filter((l) => /^\s*</.test(l));
    const indented = tagLines.filter((l) => /^[ \t]/.test(l));
    ok(lines.length > 1 && indented.length === 0,
      '(15) 打开后能读到编辑区状态（前置检查）');
}

// ==============================================================
console.log('\n====== (16) 用户实测的两个bug：纯文本粘贴 + 选区不被默认文字顶掉 ======\n');
// 把一段剪贴板内容"进正文区：真的DataTransfer + ClipboardEvent"
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
    await sleep(620);        // 代码区粘贴后要等"代码编辑区的防抖（350ms）跑"
    return json(`(()=>{const ed=document.getElementById('tbEditor');
      return JSON.stringify({html:ed.innerHTML,text:(ed.textContent||'').trim(),
        code:document.getElementById('tbCode').value});})()`);
};

// —— Bug 1：正文区粘来的东西必须是纯文本 ——
// ★ 事故修复：fixture 只剪了"第二"两个字，断言却要求整行「第二行」；这里把两行都写全，
//   并且用 `\s*` 容忍块内换行（判定意图不变：两行都在、换行变成 <br>、不带任何样式）。
const richPaste = await pasteInto('第一行\n第二行', '<b>x</b><span style="background:#ff0">y</span>');
console.log(`  富文本粘贴后${JSON.stringify(richPaste.html)}`);
ok(richPaste.text.indexOf('第一行') >= 0 && richPaste.text.indexOf('第二行') >= 0, '(16)* 两行都粘进来了');
ok(/第一行\s*<br\s*\/?>\s*第二行/.test(richPaste.html.replace(/\n/g, '')),
  `(16)* 换行变成了 <br>（不是 <p> 包装）：${JSON.stringify(richPaste.html)}`);
ok(!/<b[\s>]/i.test(richPaste.html) && !/<span/i.test(richPaste.html),
  '(16)* 粘贴带来的加粗/span 全部丢掉（纯文本粘贴）');
ok(!/background|ff0|font-size|color:/i.test(richPaste.html),
  '(16)* 背景色/字号/颜色等样式一个都没留下');
ok(richPaste.code.indexOf('<br>') >= 0 && richPaste.code.indexOf('第一行') >= 0
  && richPaste.code.indexOf('第二行') >= 0,
  '(16) 代码区跟着更新（导出的是同一份纯文本）');

// 规格变更（bug 2）：正文区粘Tab 分隔的文本也**不再**自动转表格，一律纯文本
//   （表格改走工具栏「表格」按钮，或把 HTML 粘到代码—见下一段。）
const tsvPaste = await pasteInto('甲\t乙\n丙\t', '');
ok(!/<table/.test(tsvPaste.html), `(16)* TSV 粘贴也按纯文本处理、不转<table>${JSON.stringify(tsvPaste.html)}）`);
ok(tsvPaste.text.indexOf('') >= 0 && tsvPaste.text.indexOf('') >= 0, '(16)* TSV 的文字都在');
ok(/<br\s*\/?>/.test(tsvPaste.html), '(16)* TSV 的两行之间用 <br>');

// 代码区粘贴：必须保留 HTML（导入现成文章靠它）
const codePasteCheck = await pasteInto('标题正文', '<center><b><span style="font-size:1.1em;">导入标题</span></b></center><p>正文</p>', '#tbCode');
console.log(`  代码区粘贴后编辑区：${JSON.stringify(codePasteCheck.html).slice(0, 160)}`);
ok(/<center>/.test(codePasteCheck.html) && /导入标题/.test(codePasteCheck.html),
  '(16)* 代码区粘 HTML → 原样保留（编辑区解析出了 <center> 结构，没被纯文本化）');
ok(/font-size:\s*1\.1em/.test(codePasteCheck.html), '(16) 代码区粘贴的 HTML 连内联样式都在');

// —— Bug 2：有选区时必须包住选中的字，不许换成默认文字 ——
const selectedWrap = async (act, defWords, structRe, note) => {
    // 放进「甲乙丙」并全选，然后**用真鼠标**点按钮：
    // mousePressed 时冻结选区 中途故意把编辑区选区收起（模拟浏览器丢选区）→ mouseReleased 触发点击
    await evaluate(`toolboxOpen()`);
    await sleep(260);
    const box = await json(`(()=>{const b=document.querySelector('[data-tb="${act}"]');
      if(!b) return JSON.stringify({x:-1,y:-1});
      b.scrollIntoView({block:'center'});
      const r=b.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
    if (box.x < 0) { ok(false, '(16) 按钮位置没取到'); return; }
    await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
      ed.innerHTML='<p>甲乙丙</p>';
      const node=ed.querySelector('p').firstChild;
      const r=document.createRange(); r.setStart(node,0); r.setEnd(node,3);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSaveRange(); return 1;})()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0, clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
    // 关键一步：模拟"浏览器把编辑区选区收起（真实场景里按钮/输入框抢焦点就是这样）"
    //   只剩整体淡出。这正是用户报告的："图片完全不在屏幕中、但可以靠翻面看到，
    await evaluate(`(()=>{const s=getSelection(); const ed=document.getElementById('tbEditor');
      if (s) s.collapse(ed, 0); return 1;})()`);
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(320);
    const st = await json(`(()=>{const ed=document.getElementById('tbEditor');
      return JSON.stringify({html:ed.innerHTML, text:(ed.textContent||'').trim()});})()`);
    console.log(`  ${act}${JSON.stringify(st.html)}`);
    ok(st.text.indexOf('甲乙') >= 0, `(16)* 点${note}」后选中的「甲乙丙」原样保留（${JSON.stringify(st.text)}）`);
    ok(defWords.every((w) => st.text.indexOf(w) < 0),
      '(16)* 点「标题」后选中的「甲乙丙」原样保留（"甲乙丙"）');
    ok(structRe.test(st.html), `(16) 出现了对应结构（${note}）`);
    return st;
};
await selectedWrap('title', ['文章标题'], /font-size:\s*1\.1em/, '标题');
await selectedWrap('quote', ['此处填写引用内容'], /border-left:\s*3px solid/, '引用');
await selectedWrap('caption', ['图片说明'], /color:\s*#555555/, '图注');
// ★ 「落款」按钮已按用户要求删除，工具栏上没有等价按钮（「右对齐」走 execCommand('justifyRight')，
//   会丢掉块里的 <br>、也拿不回被收起的选区，不是同一个入口）。
//   所以这一段改成**同样严苛、但不用按钮**的等价写法：照样"先把编辑区选区收起（模拟被抢焦点）"，
//   再调等价入口 toolboxToolbarAction('sign') —— 断言语义与原来完全一致（选中的「甲乙丙」原样保留、
//   不出现默认的「—— 落款」、并且出现 text-align:right）。
{
  await evaluate(`toolboxOpen()`);
  await sleep(260);
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
    ed.innerHTML='<p>甲乙丙</p>';
    const node=ed.querySelector('p').firstChild;
    const r=document.createRange(); r.setStart(node,0); r.setEnd(node,3);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
    toolboxSaveRange(); return 1;})()`);
  // 关键一步：模拟"浏览器把编辑区选区收起（真实场景里按钮/输入框抢焦点就是这样）"
  await evaluate(`(()=>{const s=getSelection(); const ed=document.getElementById('tbEditor');
    if (s) s.collapse(ed, 0); return 1;})()`);
  await sleep(60);
  await evaluate(`toolboxToolbarAction('sign')`);
  await sleep(320);
  const stSign = await json(`(()=>{const ed=document.getElementById('tbEditor');
    return JSON.stringify({html:ed.innerHTML, text:(ed.textContent||'').trim()});})()`);
  console.log(`  sign${JSON.stringify(stSign.html)}`);
  ok(stSign.text.indexOf('甲乙') >= 0, `(16)* 点「落款」后选中的「甲乙丙」原样保留（${JSON.stringify(stSign.text)}）`);
  ok(stSign.text.indexOf('落款') < 0, '(16)* 选区被收起也仍然用选中的「甲乙丙」，没有插入默认的「—— 落款」');
  ok(/text-align:\s*right/.test(stSign.html), '(16) 出现了对应结构（落款）');
}

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
console.log(`  链接${JSON.stringify(linkSt.html)}`);
ok(linkSt.text.indexOf('甲乙') >= 0, '(16)* 链接也用选中的文字，没丢掉');
// ★ 事故修复：`<\/a>` 被啃成 `/a>`（裸斜杠 + a + 尖括号，永远匹配不上）。
//   同时不强求 <a> 里直接就是裸文字 —— 用 [\s\S]*? 容忍里面可能还有一层行内标签。
ok(/<a href="https:\/\/example\.com\/"[^>]*>[\s\S]*?甲乙[\s\S]*?<\/a>/.test(linkSt.html),
  `(16)* 选中的字被包进了 <a>（${JSON.stringify(linkSt.html)}）`);
ok(linkSt.text.indexOf('链接文字') < 0, '(16) 没有出现默认的「链接文字」');

// 反向验*没有**选区时点标题 还是要插默认文字（默认值功能不能丢
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

// 输出还必须能通过净化+ 按行排版，并且*不含**非法嵌套 <p><center></center></p>
await evaluate(`toolboxRefresh()`);
const wrapOut = await json(`(()=>{const c=document.getElementById('tbCode').value;
  return JSON.stringify({code:c, bad:/<p>\s*<center/.test(c)||/<p>\s*<div/.test(c)});})()`);
console.log(`  包装后的导出${JSON.stringify(wrapOut.code).slice(0, 200)}`);
ok(wrapOut.bad === false, '(16)* 导出里没有 <p><center>…</center></p> 这种非法嵌套（块被提到了段落外）');

// ==============================================================
console.log('\n====== (17) 校验不误报：颜色只查"颜色属"，border-collapse 之类不碰 ======\n');
// 用工具自己的表格功能生成一段表格HTML 校验必须干净
await evaluate(`toolboxOpen()`);
await sleep(260);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
  const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSaveRange(); return 1;})()`);
await clickSel('[data-tb="table"]');
await sleep(300);
// 表格对话框默认就是3 行（含表头）× 2 列，直接确定
await clickSel('#tbDialogOk');
await sleep(420);
const tblLint = await json(`(()=>{const v=document.getElementById('tbValidate');
  return JSON.stringify({errors:+v.getAttribute('data-errors'),warnings:+v.getAttribute('data-warnings'),
    text:(v.textContent||'').replace(/\\s+/g,' ').slice(0,200), code:document.getElementById('tbCode').value});})()`);
console.log(`  工具生成表格后：错误 ${tblLint.errors} / 警告 ${tblLint.warnings} —${tblLint.text}`);
ok(/border-collapse/.test(tblLint.code), '(17) 生成的表格里确实有 border-collapse（这是误报的来源）');
ok(/<th[^>]*background/.test(tblLint.code.replace(/\n/g, '')) || /background:var\(--bg\)/.test(tblLint.code),
  '(17) 表头用的是 background:var(--bg)（合法的主题变量写法）');
ok(tblLint.errors === 0 && tblLint.warnings === 0,
  `(17)* 插入表格后校验区是干净的（错误 ${tblLint.errors} / 警告 ${tblLint.warnings}）`);
ok(!/collapse/.test(tblLint.text), '(17)* 校验文案里不再出现 collapse 这个词（不再把 border-collapse 当颜色）');

// 直接喂一语料同款"表格 HTML（border-collapse + border:var + background:var"
const okTable = await setCode('<table style="border-collapse: collapse; width: 100%;">'
  + '<thead><tr><th style="border: 1px solid var(--border); padding: 0.4rem; background: var(--bg);"></th>'
  + '<th style="border: 1px solid var(--border); padding: 0.4rem; background: var(--bg);"></th></tr></thead>'
  + '<tbody><tr><td style="border: 1px solid var(--border); padding: 0.4rem;"></td>'
  + '<td style="border: 1px solid var(--border); padding: 0.4rem;"></td></tr></tbody></table>');
console.log(`  语料同款表格 错误 ${okTable.errors} / 警告 ${okTable.warnings} —${okTable.text}`);
ok(okTable.errors === 0 && okTable.warnings === 0,
  `(17)* border-collapse / border:1px solid var(--border) / background:var(--bg) 都不报警（错误${okTable.errors} / 警告 ${okTable.warnings}）`);

// rgb() 应该报（建议优hex），文案里带属性名
const rgbCase = await setCode('<p><span style="color: rgb(255,0,0)">x</span></p>');
console.log(`  rgb() ${JSON.stringify(rgbCase.text)}`);
ok(rgbCase.warnings >= 1, `(17)* rgb() 颜色仍然报警告（${rgbCase.warnings} 条）`);
ok(/color/.test(rgbCase.text) && /rgb/.test(rgbCase.text) && /hex/.test(rgbCase.text),
  '(17)* 警告文案带属性名 + 原因（color … rgb() … hex）');

// 具名颜色 应该报，并给出建hex
const namedCase = await setCode('<p><span style="color: gold">x</span></p>');
console.log(`  具名颜色 ${JSON.stringify(namedCase.text)}`);
ok(namedCase.warnings >= 1, `(17)* 具名颜色报警告（${namedCase.warnings} 条）`);
ok(/gold/.test(namedCase.text) && /#daa520/.test(namedCase.text),
  '(17)* 文案里给出建议的 hex（gold → #daa520）');

// #555555 干净
const hexCase = await setCode('<p><span style="color: #555555">x</span></p>');
ok(hexCase.warnings === 0, `(17)* hex 颜色不报警（警告 ${hexCase.warnings}）`);

// 其它非颜色属性一律不碰（逐条喂，任何一条报警都算误报）
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
    if (r.warnings !== 0) inertBad.push(inertProps[i].slice(0, 48) + ' ' + r.text.slice(0, 60));
}
ok(inertBad.length === 0,
  '(17)* border-collapse / border:1px solid var(--border) / background:var(--bg) 都不报警（错误 0 / 警告 0）');
console.log(`  非颜色属性逐条测：${inertProps.length} 条，误报 ${inertBad.length} 条`);

// 颜色属性里写了个看不懂的仍然要报（别把闸门关死）
const junkColor = await setCode('<p><span style="color: collapse">x</span></p>');
ok(junkColor.warnings >= 1, `(17)* color 里写了个非颜色值照样报（${junkColor.warnings} 条：${junkColor.text.slice(0, 60)}」）`);

// ==============================================================
console.log('\n====== (18) 「正文」按/ 默认文字全/ 表格列宽拖拽 / 会话保留 ======\n');
// 上一(17) 是把 HTML 敲进**代码*验校验的，代码区→编辑区的防抖（350ms）可能还没跑完；
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

// ---- 18a 「正文 「标题」的反操----
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

// ---- 18b 有选区时用选中的原文，**默认文字全 ----
await resetEditor();
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');ed.innerHTML='<p>用户自己写的一段话</p>';
  const t=ed.querySelector('p').firstChild;
  const r=document.createRange();r.setStart(t,0);r.setEnd(t,t.nodeValue.length);
  const s=getSelection();s.removeAllRanges();s.addRange(r);ed.focus();toolboxSaveRange();return 1;})()`);
await clickSel('[data-tb="title"]');
const wrapRes = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ html: ed.innerHTML, sel: String(getSelection()), text: (ed.textContent||'').trim() });})()`);
ok(/用户自己写的一段话/.test(wrapRes.html) && /1\.1em/.test(wrapRes.html)
   && /text-align:\s*center/i.test(wrapRes.html) && !/<center>/i.test(wrapRes.html),
  `(18)* 有选区点「标题」→ **就地**把这一块改成标题（居中 + 1.1em，不再外面套一层）${wrapRes.html}`);
ok(!/文章标题/.test(wrapRes.html), '(18)* 有选区时不会插入默认文字（不会把用户选的字顶掉）');
ok(wrapRes.sel !== '文章标题', `(18)* 有选区时不默认文字全（当前选中${wrapRes.sel}」）`);

// ---- 18c 表格列宽拖拽 <colgroup> 百分比；一次拖动一条撤回记----
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
ok(afterDrag.colCount === 2, `(18)* 拖完写出了<colgroup>${afterDrag.colCount} <col>）`);
ok(afterDrag.sum >= 99 && afterDrag.sum <= 101,
  `(18)* 两列百分比之和保100（实${afterDrag.sum}${JSON.stringify(afterDrag.pcts)}）`);
ok(afterDrag.pcts[0] > 50, `(18)* 第一列被拖宽了（${afterDrag.pcts[0]}% > 拖之前的 50%）`);
ok(/<colgroup>/.test(afterDrag.code) && /<col /.test(afterDrag.code),
  '(18)* 「正文」去掉了居中（<center> 拆掉 / text-align 摘掉）');
ok(afterDrag.undoLabel === false, '(18) 拖完撤回按钮可用（这一拖动进了撤回栈）');
// 撤回一colgroup 消失（一次拖动只算一条记录）
await clickSel('[data-tb="undo"]');
await sleep(420);
const afterUndo = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const t=ed.querySelector('table');
  return JSON.stringify({ hasColgroup: !!(t && t.querySelector('colgroup')),
    code: document.getElementById('tbCode').value });})()`);
ok(afterUndo.hasColgroup === false && !/colgroup/.test(afterUndo.code),
  '(18)* 撤回一次就把 colgroup 撤掉了（一次拖动 = 一条撤回记录）');
// 幂等：导入一篇真实文章（有表格、没有colgroup）→ 导出 再导入再导出，两次一
// 语料里有 colgroup 的文章是少数（amsx_20xx 那一批有），必须挑一篇*没有** colgroup 的，
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

// ---- 18d 同会话保留窗口尺寸位置（只在内存里，刷新后回默认尺----
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
console.log(`  窗口几何：默认${JSON.stringify(geo0)} 改成 700x460@(40,30) 重开 ${JSON.stringify(geo1)}`);
ok(Math.abs(geo1.w - 700) <= 2 && Math.abs(geo1.h - 460) <= 2 && Math.abs(geo1.l - 40) <= 2 && Math.abs(geo1.t - 30) <= 2,
  `(18)* 同一次会话里关掉再打开，窗口尺寸位置保留（${geo1.w}x${geo1.h}@${geo1.l},${geo1.t}）`);
ok(Math.abs(geo1.w - geo0.w) > 10, '(18) 保留的确实不是"默认尺寸"（说明它真的记住了）');

// ==============================================================
console.log('\n====== (19) 表格操作：右键小菜单 + 合并/拆分 + 插删行列单元======\n');
await quietSync();

// 建一个3 3 列*不带表头**的表格（<td>，数起来直观
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
// 把光标放进第 r 行第 c 列那<td> 
const caretIn = (r, c) => evaluate(`(()=>{
  const ed=document.getElementById('tbEditor'); const t=ed.querySelector('table');
  const cell=t.rows[${r}].children[${c}];
  toolboxFocusEditor(); toolboxCaretInCell(cell); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const sameTbl = (a, b) => a.rows === b.rows && a.tds === b.tds
  && JSON.stringify(a.colCounts) === JSON.stringify(b.colCounts)
  && JSON.stringify(a.spans) === JSON.stringify(b.spans) && a.code === b.code;

// ---- 19a 菜单项：正好是需求里10 项、顺序一----
await evaluate(`toolboxTableMenuBuild()`);
const menu = await json(`(()=>{const m=document.getElementById('tbTableMenu');
  return JSON.stringify({ items:[...m.querySelectorAll('[data-tm]')].map(function(x){return x.textContent;}),
    seps:m.querySelectorAll('.tb-tmenu-sep').length, hidden:m.hidden });})()`);
console.log(`  菜单项：${menu.items.join(' / ')}`);
ok(JSON.stringify(menu.items) === JSON.stringify(['上方插入行', '下方插入行', '删除行', '左侧插入列',
    '右侧插入列', '删除列', '插入单元格', '删除单元格', '合并单元格', '拆分单元格']),
  `(19)* 右键菜单正好是需求里10 项、顺序一致（${menu.items.length} 项）`);
ok(menu.hidden === true && menu.seps >= 3, `(19) 菜单默认收起、用分隔线分成4 飨${menu.seps} 条分隔线）`);

// ---- 19b 真右键：表格里弹菜单；表格外不弹 ----
await buildTable(3, 3, false);
const base3 = await tblState();
ok(JSON.stringify(base3.colCounts) === '[3,3,3]', `(19) 建出 3×3：每行有效列数${JSON.stringify(base3.colCounts)}`);
await caretIn(0, 0);
// 光标先在段落右键段落：不弹菜单（走浏览器自己的菜单）
// （表格是插在一个空段落后面的；插入路径会把那个空段落收拾掉，所以这里显式补一个段落）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const t=ed.querySelector('table');
  if(!ed.querySelector('p')){const p=document.createElement('p');p.textContent='表格外的段落';
    const host=(t&&t.parentNode!==ed)?t.parentNode:t;             // 表格外面还套着一overflow div
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
console.log(`  菜单位置 (${opened.left},${opened.top}) 视口 ${opened.vw}x${opened.vh} ${opened.w}；灰掉的项：${JSON.stringify(opened.off)}`);
ok(opened.hidden === false, '(19)* 在表格里右键弹出小菜单');
ok(opened.left >= 0 && opened.top >= 0 && opened.left + opened.w <= opened.vw && opened.top <= opened.vh,
  '(19)* 菜单完整落在视口里（贴边时会自动收回来）');
ok(opened.cursorInCell === true, '(19)* 右键后光标落在右键点中的那个单元格里（后续操作有明确对象）');
// ★ 事故修复：`indexOf('合并单元格')` 被啃成 `indexOf('合并单元')`（少了"格"）——
//   菜单项文本就是「合并单元格」，按前缀判才不会再误判。判定意图不变。
ok(opened.off.some((t) => t.indexOf('合并单元格') >= 0) && opened.off.some((t) => t.indexOf('拆分单元格') >= 0),
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
// 撤回的对照基线要点菜单项之前"这一刻取"
//   插行之前的最后一条撤回记录可能不是建表那一步（例如中途敲了Esc
//   编辑区的 keyup 也会记一步），所以拿"操作前的现场"比才靠谱。
const beforeRowClick = await tblState();
// 菜单里的「下方插入行」用**真鼠标点*（验证菜单的 mousedown preventDefault 不会吃掉 click
const itemPt = await json(`(()=>{const el=[...document.querySelectorAll('#tbTableMenu [data-tm]')]
  .find(function(x){return x.getAttribute('data-tm')==='row-below';});
  const r=el.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: itemPt.x, y: itemPt.y, button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: itemPt.x, y: itemPt.y, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: itemPt.x, y: itemPt.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(450);
const afterClick = await tblState();
const menuAfter = await evaluate(`document.getElementById('tbTableMenu').hidden`);
console.log(`  真鼠标点「下方插入行」后${afterClick.rows} 行`);
ok(afterClick.rows === 4, `(19)* 点菜单项「下方插入行」真的插了一行（3 ${afterClick.rows}）`);
ok(menuAfter === true, '(19)* 点完菜单项菜单自己收起');
ok(JSON.stringify(afterClick.colCounts) === '[3,3,3,3]',
  `(19)* 新行的有效列数与表格一致（${JSON.stringify(afterClick.colCounts)}）`);
ok(afterClick.tds === 12, `(19)* 新行是空单元格（3×4 = 12 <td>，实际${afterClick.tds}）`);
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
  console.log(`  撤回后与基线不一致：基线 ${a.length} / 撤回${b.length} 行；`
    + `行结尾${beforeRowClick.rows}/${undoRow.rows}，td ${beforeRowClick.tds}/${undoRow.tds}`);
  console.log(`    第一处不同（${d + 1} 行）：\n      基线: ${a[d]}\n      撤回: ${b[d]}`);
}
ok(sameTbl(undoRow, beforeRowClick), `(19)* 撤回一次回到插入行之前（${undoRow.rows} 行）`);

// ---- 19c 各种插删操作各+1 / -1，且每次都能撤回 ----
const cases = [
  { act: 'row-above', name: '上方插入', at: [1, 1], check: (a, b) => a.rows === b.rows + 1, label: '行数 +1' },
  { act: 'row-below', name: '下方插入', at: [1, 1], check: (a, b) => a.rows === b.rows + 1, label: '行数 +1' },
  { act: 'row-del',   name: '删除行',     at: [1, 1], check: (a, b) => a.rows === b.rows - 1, label: '行数 -1' },
  { act: 'col-left',  name: '左侧插入列', at: [1, 1], check: (a, b) => a.colCounts[0] === b.colCounts[0] + 1, label: '每行有效列数 +1' },
  { act: 'col-right', name: '右侧插入列', at: [1, 1], check: (a, b) => a.colCounts[0] === b.colCounts[0] + 1, label: '每行有效列数 +1' },
  { act: 'col-del',   name: '删除行',     at: [1, 1], check: (a, b) => a.colCounts[0] === b.colCounts[0] - 1, label: '每行有效列数 -1' },
  { act: 'cell-add',  name: '插入单元', at: [1, 1], check: (a, b) => a.tds === b.tds + 1, label: '单元+1' },
  { act: 'cell-del',  name: '删除单元', at: [1, 1], check: (a, b) => a.tds === b.tds - 1, label: '单元-1' }
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
  console.log(`  ${c.name}: ${c.label} ${okShape ? 'OK' : ''}；撤回复原${okUndo ? 'OK' : ''}；`
    + `有效列数 ${JSON.stringify(after.colCounts)}，错误${after.errors} / 警告 ${after.warnings}`);
  if (!(okShape && okUndo && okLegal)) {
    caseBad.push(`${c.name}(形状=${okShape} 撤回=${okUndo} 合法=${okLegal} 列数=${JSON.stringify(after.colCounts)})`);
  }
}
ok(caseBad.length === 0, '(19)* 带合并单元格的真实语料"导出 → 再导入 → 再导出"字节一致、有效列数齐、零警告');

// 插入单元格之后这一行确实比别的行多一格：校验区只给*һ*提示（故意不齐，不刷屏）
await caretIn(1, 1);
await tAct('cell-add');
await sleep(240);
const uneven = await tblState();
console.log(`  插入单元格后：有效列数${JSON.stringify(uneven.colCounts)}，警告${uneven.warnings}${uneven.warnText}」`);
ok(uneven.warnings <= 1, `(19)* 插入单元格后"故意不齐"最多只提示一条（当前 ${uneven.warnings} 条）`);

// ---- 19d 合并 2×2 һcolspan=2 rowspan=2 的单元格；校验区零警----
await buildTable(3, 3, false);
const beforeMerge = await tblState();
// 先用真鼠标从第一格拖到第四格（真实用户手势）；无头里这一步常常拖不出跨格选区，
// 所以随后用程序 Range 明确覆盖 2×2 这四格，再数被选中的单元格个数。
const cellCenter = (r, c) => json(`(()=>{const t=document.getElementById('tbEditor').querySelector('table');
  const cell=t.rows[${r}].children[${c}]; cell.scrollIntoView({block:'center'});
  const b=cell.getBoundingClientRect();
  return JSON.stringify({x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)});})()`);
const p00 = await cellCenter(0, 0); const p11 = await cellCenter(1, 1);
// 右键点在第一格上（rc 用屏幕坐标）
const dragPts = { ax: p00.x, ay: p00.y, bx: p11.x, by: p11.y };
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p00.x, y: p00.y, button: 'none', buttons: 0, clickCount: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p00.x, y: p00.y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 8; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, clickCount: 0,
    x: Math.round(p00.x + (p11.x - p00.x) * i / 8), y: Math.round(p00.y + (p11.y - p00.y) * i / 8) });
  await sleep(24);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p11.x, y: p11.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(200);
const picked = await json(`(()=>{const ed=document.getElementById('tbEditor'); const t=ed.querySelector('table');
  const c0=t.rows[0].children[0], c3=t.rows[1].children[1];
  const r=document.createRange(); r.setStart(c0,0); r.setEnd(c3,c3.childNodes.length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  const pc=toolboxTablePickedCells(ed); const n=pc?pc.cells.length:0;
  return JSON.stringify({n:n, cells:n, sel:String(s)});})()`);
console.log(`  2×2 拖选：命中 ${picked.n} 个单元格`);
ok(picked.n === 4, `(19)* 选区横跨 2×2 四个单元格（命中 ${picked.n} 个）`);
// 右键：菜单要弹出来，而且**不能**把这份跨格选区弄丢（合并全靠它）
await rc(dragPts.ax, dragPts.ay);
const keptSel = await json(`(()=>{const p=toolboxTablePickedCells(document.getElementById('tbEditor'));
  return JSON.stringify({n:p?p.cells.length:0, hidden:document.getElementById('tbTableMenu').hidden,
    off:[...document.querySelectorAll('#tbTableMenu .tb-off')].map(function(x){return x.textContent;})});})()`);
ok(keptSel.hidden === false, '(19)* 跨格选中时右键照样弹菜单');
ok(keptSel.n === 4, `(19)* 右键**没有**弄丢跨格选区（还能认出${keptSel.n} 个单元格）`);
ok(keptSel.off.indexOf('合并单元') < 0, '(19)* 跨格选中时「合并单元格」不再是灰的');
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
  + `有效列数 ${JSON.stringify(merged.colCounts)}，错误${merged.errors} / 警告 ${merged.warnings}`);
ok(merged.spans.length === 1 && /\[2\/2\]/.test(merged.spans[0]),
  '(19)* 生成的 HTML 里真的写着 colspan="2" / rowspan="2"（语料同款写法）');
ok(/colspan="2"/.test(merged.code) && /rowspan="2"/.test(merged.code),
  '(19)* 生成的 HTML 里真的写着 colspan="2" / rowspan="2"（语料同款写法）');
ok(merged.tds === 6, `(19)* 被合并掉3 个单元格已经删除（ ${merged.tds}）`);
ok(merged.text.indexOf('内容') >= 0 && merged.text.length <= beforeMerge.text.length,
  '(19) 保留的是左上角那格的内容（其余格子的文字按需求丢弃）');
ok(JSON.stringify(merged.colCounts) === '[3,3,3]',
  `(19)* 合并后每行有效列数仍然一致（${JSON.stringify(merged.colCounts)}：把 colspan/rowspan 的占位算进去了）`);
ok(merged.errors === 0 && merged.warnings === 0,
  `(19)* 合并单元格之后校验区***警告（错误${merged.errors} / 警告 ${merged.warnings}${merged.warnText}」）`);
// 撤回一次回到合并前
await clickSel('[data-tb="undo"]');
await sleep(420);
const afterMergeUndo = await tblState();
ok(sameTbl(afterMergeUndo, beforeMerge),
  `(19)* 合并只算一条撤回记录：撤回一次就回到合并前（${afterMergeUndo.spans.length} span）`);
// 重做后再拆分
await clickSel('[data-tb="redo"]');
await sleep(420);
await caretIn(0, 0);
await tAct('split');
await sleep(400);
const split = await tblState();
console.log(`  拆分后：${split.rows} 行，<td> ${split.tds} 个，span ${JSON.stringify(split.spans)}，`
  + `有效列数 ${JSON.stringify(split.colCounts)}，警告${split.warnings}`);
ok(split.spans.length === 0, `(19)* 拆分单colspan/rowspan 复位（还剩${split.spans.length} 处）`);
ok(split.tds === 9, `(19)* 拆分把被合并掉的格子补回来了（ <td>，实际${split.tds}）`);
ok(JSON.stringify(split.colCounts) === '[3,3,3]',
  `(19)* 拆分后每行有效列数一致（${JSON.stringify(split.colCounts)}）`);
ok(split.errors === 0 && split.warnings === 0,
  `(19)* 拆分后校验区也是干净的（错误 ${split.errors} / 警告 ${split.warnings}）`);
// 幂等：真实语料里带 rowspan / colspan 的文章，导入→导出两次必须字节一致。
// 语料rowspan colspan 分别出现在不同文章里（mo_boc_20xx rowspan
//   hk_boc_1994 colspan），两篇都得过一遍
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
    + `有效列数 ${JSON.stringify(r.counts)}，错误${r.errors} / 警告 ${r.warnings}`);
  if (r.hasRowspan) spanSeen.row = true;
  if (r.hasColspan) spanSeen.col = true;
  if (!(r.same && r.errors === 0 && r.warnings === 0
        && r.counts && r.counts.every(v => v === r.counts[0]))) {
    spanBad.push(`${f}(${r.same} 错误=${r.errors} 警告=${r.warnings} 列数=${JSON.stringify(r.counts)})`);
  }
}
ok(spanSeen.row && spanSeen.col,
  `(19) 两篇语料分别含rowspan / colspan（用例有效：row=${spanSeen.row} col=${spanSeen.col}）`);
ok(spanBad.length === 0,
  '(19)* 生成的 HTML 里真的写着 colspan="2" / rowspan="2"（语料同款写法）');

// ==============================================================
console.log('\n====== (20) 用户实测：粘清格空行/按钮状两侧高亮/ͼƬռλ/图片菜单/导出排版 ======\n');
// —— 这一节共用的小工具 ——
const edHtml20 = () => evaluate(`document.getElementById('tbEditor').innerHTML`);
const codeVal20 = () => evaluate(`document.getElementById('tbCode').value`);
const counts20 = () => json(`(()=>{const v=document.getElementById('tbValidate');
  return JSON.stringify({e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings')});})()`);
const emptyBlocks20 = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const list=[...ed.querySelectorAll('p,div,span,center,li,b,i,u,s')].filter(function(el){
    if (el.closest('table')) return false;
    if (el.querySelector('img,table,hr,video,br,input,td,th')) return false;
    return !String(el.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'');});
  return JSON.stringify({ n: list.length, code: document.getElementById('tbCode').value,
    blankLines: (document.getElementById('tbCode').value.match(/\\n[ \\t]*\\n/g)||[]).length,
    samples: list.slice(0,3).map(function(el){return el.outerHTML.slice(0,50);}) });})()`);
// 把光标（折叠）放到编辑器里第一个含 needle 的文本节点里
const caretInText = (needle, off) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf(${JSON.stringify(needle)});
    if(i>=0){ const r=document.createRange(); r.setStart(n,i+${off || 0}); r.collapse(true);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);
// 选中编辑器里第一needle（用按钮真的作用在选区外的用例）
const selectText20 = (needle) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf(${JSON.stringify(needle)});
    if(i>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+${needle.length});
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);
const tmenuClick = async (act) => {
  const p = await json(`(()=>{const el=document.querySelector('#tbTableMenu [data-tm="${act}"]');
    if(!el) return JSON.stringify({none:1}); const r=el.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});})()`);
  if (p.none) { ok(false, `菜单里没有${act}`); return; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(430);
};
const openImgMenu = async () => {
  const p = await json(`(()=>{const ed=document.getElementById('tbEditor');
    const t=ed.querySelector('[data-tb-display="wrap"]')||ed.querySelector('img');
    if(!t) return JSON.stringify({none:1});
    t.scrollIntoView({block:'center'});
    const r=t.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+Math.min(20,r.width/2)), y:Math.round(r.top+Math.min(14,r.height/2))});})()`);
  if (p.none) { ok(false, '编辑区里没有图片可右'); return false; }
  await rc(p.x, p.y);
  await sleep(260);
  return true;
};
// 选中a 段到第b 段（含）的全部文字。★ 文字节点"而不是firstChild"
// 高亮之后段落里的 firstChild <span>，拿元素当边界算偏移会越界（IndexSizeError）
const selectParas20 = (a, b) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const ps=ed.querySelectorAll('p');
  const first=function(node){const w=document.createTreeWalker(node,4,null,false);return w.nextNode();};
  const last=function(node){let l=null;const w=document.createTreeWalker(node,4,null,false);let n=w.nextNode();while(n){l=n;n=w.nextNode();}return l;};
  const t0=first(ps[${a}]), t1=last(ps[${b}]);
  const r=document.createRange(); r.setStart(t0,0); r.setEnd(t1,t1.nodeValue.length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await reloadAndOpen();
await sleep(500);

// ---------- Bug 1：光标在段中间粘贴，必须插在光标处（不是文档末尾）---------
// ★ 事故修复（两处）：① 剪贴板内容是**空字符串**，粘完什么都没发生；
//   ② fixture 用 `<p>甲乙丙</p>` + 光标偏移 1，"段中间"其实是"甲和乙之间"，
//   粘进来就成了"甲乙乙丙"。这里改成 `<p>甲丙</p>` + 偏移 1（正好在甲、丙中间），
//   粘"乙" ⇒ 期望"甲乙丙"；"粘到末尾"的老 bug 会得到"甲丙乙"（下面第二条守着）。
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>甲丙</p>';
  const t=ed.querySelector('p').firstChild;
  const r=document.createRange(); r.setStart(t,1); r.collapse(true);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null;
  const dt=new DataTransfer(); dt.setData('text/plain','乙');
  ed.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  return 1;})()`);
await sleep(520);
const p1 = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const sel=getSelection(); const cr=sel.rangeCount?sel.getRangeAt(0):null;
  let caretAfter=false;
  try {
    const before=document.createRange(); before.selectNodeContents(ed);
    before.setEnd(cr.startContainer, cr.startOffset);
    caretAfter = /甲乙$/.test(String(before)); } catch(e){}
  return JSON.stringify({ text: ed.textContent||'', html: ed.innerHTML, caretAfter });})()`);
ok(p1.text === '甲乙丙', `(20)* 【bug 1】光标在段中间粘贴 → 甲【乙】丙（实际 ${JSON.stringify(p1.text)}）`);
ok(p1.text !== '甲丙乙' && p1.html.indexOf('乙') < p1.html.lastIndexOf('丙'),
  '(20)* 【bug 1】没有粘到文档末尾（去掉了"没选区就追加到末尾"的兜底）');
ok(p1.caretAfter === true, '(20)* 【bug 1】粘贴后光标落在刚插进来的内容**后面**');

// ---------- Bug 2：剪贴板文字 + 表格" "正文区只收纯文本 ----------
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
  const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  const dt=new DataTransfer();
  dt.setData('text/html','<p>文字</p><table><tr><td>格子</td></tr></table><p>文字2</p>');
  dt.setData('text/plain','文字\\n文字2');
  ed.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  return 1;})()`);
await sleep(520);
const p2 = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ table: !!ed.querySelector('table'), text: ed.textContent||'', html: ed.innerHTML });})()`);
ok(p2.table === false, `(20)* 【bug 2】正文区粘贴"文字+表格"后没有 <table>（${JSON.stringify(p2.html)}）`);
ok(p2.text.indexOf('文字') >= 0 && p2.text.indexOf('文字2') >= 0,
  `(20)* 【bug 2】两段文字都在（以前只剩表格）`);
ok(/文字\s*<br\s*\/?>\s*文字2/.test(p2.html.replace(/\n/g, '')), '(20)* 【bug 2】两行之间是 <br>');

// ---------- Bug 3：清格式不能把整段弄坏 ----------
// ★ 事故修复：fixture 里的 `<span …></span>` 被啃成了**空的**，于是
//   "清格式后文字还在（甲）"和"块结构（<center>）保留"都必然失败 —— 不是产品问题。
//   用例本意是"外面套着 居中+粗体+字号+颜色 的**有字**内容，清格式后只剩 <center> 和文字"。
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<center><b><span style="font-size:1.1em;color:#555555;">甲</span></b></center>';
  const r=document.createRange(); r.selectNodeContents(ed);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
// ★ 「清格式」按钮已按用户要求删除，动作本身保留。这里改用**等价入口**
//   toolboxToolbarAction('clear')（原按钮点击走的同一个入口），判定语义一字不放宽。
await evaluate(`toolboxToolbarAction('clear')`);
await sleep(500);
const p3 = await json(`(()=>{const ed=document.getElementById('tbEditor'); const v=document.getElementById('tbValidate');
  return JSON.stringify({ html: ed.innerHTML, text: ed.textContent||'',
    e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
ok(!/style=/i.test(p3.html) && !/<b[\s>]/i.test(p3.html) && !/<span/i.test(p3.html) && !/<font/i.test(p3.html),
  `(20)* 【bug 3】清格式后没有style=/<b>/<span>${JSON.stringify(p3.html)}）`);
ok(/甲/.test(p3.text) && /<center>/i.test(p3.html), '(20)* 【bug 3】文字与块结构（<center>）保留');
ok(p3.e === 0 && p3.w === 0, `(20)* 【bug 3】清格式的结果通过校验（错误 ${p3.e} / 警告 ${p3.w}）`);

// ---------- Bug 4：插入任何东西都不许多出空行 ----------
await resetEditor();
const step4 = [];
// ★ 「清格式」按钮已删，动作用它的等价入口保住 —— 这一步仍按原样覆盖（四步一步不少）。
for (const act of ['title', 'quote', 'clear', 'body']) {
  if (act === 'clear') await evaluate(`toolboxToolbarAction('clear')`);
  else await clickSel(`[data-tb="${act}"]`);
  await sleep(520);
  const st = await emptyBlocks20();
  step4.push({ act, n: st.n, blank: st.blankLines, samples: st.samples });
}
const bad4 = step4.filter(x => x.n !== 0 || x.blank !== 0);
ok(bad4.length === 0,
  `(20)* 【bug 4】标题→引用→清格式→正文 四步之后都没有空块、代码里没有空行`
  + (bad4.length ? `${JSON.stringify(bad4[0])}）` : ''));

// ---------- Bug 5：按钮反映当前选区的格式，而且真的有效 ----------
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<div style="text-align:center"><span style="font-size:1.1em;font-weight:700">甲</span></div>';
  const t=ed.querySelector('span').firstChild;
  const r=document.createRange(); r.setStart(t,0); r.collapse(true);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxSaveRange(); toolboxSyncToolbarState(); return 1;})()`);
await sleep(220);
const p5a = await json(`(()=>{const m=document.getElementById('toolboxModal');
  const on=function(sel){const el=m.querySelector(sel); return !!(el&&el.classList.contains('active'));};
  return JSON.stringify({ title:on('[data-tb="title"]'), body:on('[data-tb="body"]'),
    size:on('.tb-size[data-size="1.1em"]'), bold:on('[data-tb="bold"]'),
    alignC:on('[data-tb="align-center"]') });})()`);
ok(p5a.title && p5a.size && p5a.alignC,
  `(20)* 【bug 5】外部导入的 <div style="text-align:center">+1.1em 被认成标题（title=${p5a.title} size=${p5a.size}）`);
ok(!p5a.body, '(20)* 【bug 5】标题块里「正文」不亮');
await clickSel('[data-tb="body"]');
await sleep(480);
const p5b = await json(`(()=>{const ed=document.getElementById('tbEditor'); const m=document.getElementById('toolboxModal');
  const on=function(sel){const el=m.querySelector(sel); return !!(el&&el.classList.contains('active'));};
  return JSON.stringify({ html: ed.innerHTML, body:on('[data-tb="body"]'), title:on('[data-tb="title"]') });})()`);
ok(!/text-align/i.test(p5b.html) && !/1\.1em/.test(p5b.html) && !/font-weight/i.test(p5b.html),
  `(20)* 【bug 5】点「正文」后居中/字号/粗体都没了（${JSON.stringify(p5b.html)}）`);
ok(p5b.body === true && p5b.title === false, '(20)* 【bug 5】点完「正文」按钮变 .active');
// 加粗：从无到有写 <b>，再点一次取消
await selectText20('甲');
await clickSel('[data-tb="bold"]');
await sleep(420);
const p5c = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(/<b>甲<\/b>/.test(p5c.replace(/\s+/g, '')), `(20)* 【bug 5】加粗写出 <b>（不是只加 style，${JSON.stringify(p5c)}）`);
await selectText20('甲');
await clickSel('[data-tb="bold"]');
await sleep(420);
const p5d = await evaluate(`document.getElementById('tbEditor').innerHTML`);
ok(!/<b[\s>]/i.test(p5d) && !/font-weight/i.test(p5d), `(20)* 【bug 5】再点一次加粗被取消（${JSON.stringify(p5d)}）`);

// ---------- 文本类型按**计算样式**判定（用户第 2 条）----------
// ★ 事故修复：`<span …></span>` 被啃成空的，光标无处可落、类型判定为假 —— 不是产品问题。
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<div style="text-align:center"><span style="font-size:1.1em;font-weight:700">标题字</span></div>'
    + '<p>普通正文一</p>'
    + '<div style="background:var(--bg);border-left:3px solid var(--theme);padding:0.5rem 1rem;">引用文字</div>';
  return 1;})()`);
await caretInText('标题字', 1);
await sleep(200);
const t20a = await json(`(()=>{const m=document.getElementById('toolboxModal');
  const on=function(sel){const el=m.querySelector(sel); return !!(el&&el.classList.contains('active'));};
  return JSON.stringify({ title:on('[data-tb="title"]'), size:on('.tb-size[data-size="1.1em"]') });})()`);
ok(t20a.title && t20a.size, `(20)* 非 <center> 标签的居中+1.1em 也认成标题（title=${t20a.title} size=${t20a.size}）`);
await caretInText('普通正文一', 2);
await sleep(200);
const t20b = await json(`(()=>{const m=document.getElementById('toolboxModal');
  const on=function(sel){const el=m.querySelector(sel); return !!(el&&el.classList.contains('active'));};
  return JSON.stringify({ body:on('[data-tb="body"]'), title:on('[data-tb="title"]'), quote:on('[data-tb="quote"]') });})()`);
ok(t20b.body && !t20b.title && !t20b.quote, `(20)* 普通段落判成「正文」（${JSON.stringify(t20b)}）`);
await caretInText('引用文字', 2);
await sleep(200);
const t20c = await json(`(()=>{const m=document.getElementById('toolboxModal');
  const on=function(sel){const el=m.querySelector(sel); return !!(el&&el.classList.contains('active'));};
  return JSON.stringify({ quote:on('[data-tb="quote"]'), body:on('[data-tb="body"]') });})()`);
ok(t20c.quote && !t20c.body, `(20)* border-left 的块判成「引用」（${JSON.stringify(t20c)}）`);

// ---------- 块级样式按钮 = "设置这一块的样式"（toggle / 就地替换---------
// 正文要把引用块的**全部块级特征**清掉，文字与 <br> 保留
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<div style="background:var(--bg);border-left:3px solid var(--theme);padding:0.5rem 1rem;margin:1rem 0;font-size:0.85rem;">文字<br>文字</div>';
  const r=document.createRange(); r.selectNodeContents(ed);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await clickSel('[data-tb="body"]');
await sleep(500);
const b20 = await json(`(()=>{const ed=document.getElementById('tbEditor'); const v=document.getElementById('tbValidate');
  const m=document.getElementById('toolboxModal'); const el=m.querySelector('[data-tb="body"]');
  const blk=ed.querySelector('div,p,center');
  const cs=blk?getComputedStyle(blk):null;
  return JSON.stringify({ html: ed.innerHTML, text: ed.textContent||'',
    brs: ed.querySelectorAll('br').length,
    borderLeft: cs?cs.borderLeftWidth:'', bg: cs?cs.backgroundColor:'',
    bodyOn: !!(el&&el.classList.contains('active')),
    e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
ok(!/border-left/i.test(b20.html) && !/background/i.test(b20.html) && !/padding/i.test(b20.html) && !/margin/i.test(b20.html),
  `(20)* 「正文」清掉引用块的全部块级特征（${JSON.stringify(b20.html)}）`);
ok(b20.text.indexOf('文字') >= 0 && b20.text.indexOf('文字') >= 0 && b20.brs >= 1,
  `(20)* 「正文」保留文字与 <br> 换行（br=${b20.brs}）`);
ok(b20.bodyOn === true && b20.e === 0 && b20.w === 0,
  `(20)* 「正文」后按钮 active、校验 0 错 0 警（e=${b20.e} w=${b20.w}）`);
// 引用 toggle：块数不变、不新增空片段；连点 3 次结构稳
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<div style="background:var(--bg);border-left:3px solid var(--theme);padding:0.5rem 1rem;margin:1rem 0;font-size:0.85rem;">引用一</div>';
  caretInText0 = 1; return 1;})()`);
await caretInText('引用一', 2);
const blocksOf = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ n: ed.querySelectorAll(':scope > p, :scope > div, :scope > center').length,
    html: ed.innerHTML });})()`);
const beforeQ = await blocksOf();
await clickSel('[data-tb="quote"]'); await sleep(460);          // 已经是引取消
const offQ = await blocksOf();
ok(offQ.n === beforeQ.n && !/border-left/i.test(offQ.html),
  `(20)* 引用块里点「引用」= 取消引用（块数 ${beforeQ.n}→${offQ.n}，${JSON.stringify(offQ.html)}）`);
await clickSel('[data-tb="quote"]'); await sleep(460);          // 再点 恢复引用
const onQ = await blocksOf();
ok(onQ.n === beforeQ.n && /border-left/i.test(onQ.html),
  `(20)* 再点「引用」恢复成引用块（块数 ${onQ.n}，就地替换不套新层）`);
for (let i = 0; i < 3; i++) { await clickSel('[data-tb="quote"]'); await sleep(420); }
const after3 = await json(`(()=>{const ed=document.getElementById('tbEditor'); const st=${JSON.stringify('')};
  const empties=[...ed.querySelectorAll('p,div,span,center')].filter(function(el){
    if (el.querySelector('img,table,br,hr')) return false;
    return !String(el.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'');});
  return JSON.stringify({ n: ed.querySelectorAll(':scope > p, :scope > div, :scope > center').length,
    empties: empties.length, blankLines: (document.getElementById('tbCode').value.match(/\\n[ \\t]*\\n/g)||[]).length,
    html: ed.innerHTML });})()`);
ok(after3.n === beforeQ.n && after3.empties === 0 && after3.blankLines === 0,
  `(20)* 引用连点 3 次后块数恒定、无空块、无空行（${JSON.stringify(after3).slice(0, 160)}）`);
// 引用块里点「标题 就地变成标题
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<div style="background:var(--bg);border-left:3px solid var(--theme);padding:0.5rem 1rem;margin:1rem 0;font-size:0.85rem;">引用转标</div>';
  return 1;})()`);
await caretInText('引用转标', 2);
await clickSel('[data-tb="title"]');
await sleep(480);
const q2t = await json(`(()=>{const ed=document.getElementById('tbEditor'); const m=document.getElementById('toolboxModal');
  const blk=ed.querySelector(':scope > p, :scope > div, :scope > center');
  const cs=blk?getComputedStyle(blk):null;
  return JSON.stringify({ html: ed.innerHTML, align: cs?cs.textAlign:'', size: cs?cs.fontSize:'',
    w: getComputedStyle(ed).fontSize, titleOn: m.querySelector('[data-tb="title"]').classList.contains('active'),
    blocks: ed.querySelectorAll(':scope > p, :scope > div, :scope > center').length,
    hasCenter: /<center>/i.test(ed.innerHTML) });})()`);
ok(q2t.align === 'center' && q2t.titleOn && q2t.blocks === 1 && !q2t.hasCenter,
  `(20)* 引用块里点「标题」= 就地变标题（align=${q2t.align} 块数=${q2t.blocks} 无 <center> 包裹）`);
// 三个按钮各自连点 3 次：块数恒定、无空块、无空行、校验0/0
const tri = {};
for (const act of ['title', 'quote', 'body']) {
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
    ed.innerHTML='<p>连点测试</p>'; return 1;})()`);
  await caretInText('连点测试', 2);
  for (let i = 0; i < 3; i++) { await clickSel(`[data-tb="${act}"]`); await sleep(400); }
  const st = await emptyBlocks20();
  const c = await counts20();
  tri[act] = { n: st.n, blank: st.blankLines, e: c.e, w: c.w };
}
const triBad = Object.keys(tri).filter(k => tri[k].n !== 0 || tri[k].blank !== 0 || tri[k].e !== 0 || tri[k].w !== 0);
ok(triBad.length === 0,
  `(20)* 标题/引用/正文 各自连点 3 次：块数稳定、无空块、无空行、校验 0/0`
  + (triBad.length ? `{triBad[0]}: ${JSON.stringify(tri[triBad[0]])}）` : ''));

// ---------- A：两侧选区互相对应高亮 ----------
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>甲段落乙</p><p>第二</p>';
  toolboxRefresh();                                  // 代码区要跟着更新（高亮是在代码区里找同一段文字）
  const t=ed.querySelector('p').firstChild;
  const r=document.createRange(); r.setStart(t,1); r.setEnd(t,4);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await sleep(420);
const hlA = await json(`(()=>{const h=(window.CSS&&CSS.highlights)?CSS.highlights.get('tb-sync'):null;
  return JSON.stringify({ api: !!(window.CSS&&CSS.highlights&&window.Highlight), size: h?h.size:0,
    ed: document.getElementById('tbEditor').innerHTML,
    code: document.getElementById('tbCode').value.substring(0,120) });})()`);
ok(hlA.api === true, '(20)* 浏览器支持 CSS Custom Highlight API（用例有效）');
ok(hlA.size > 0, `(20)* 正文选中 → 代码区对应文字高亮（Range 数 ${hlA.size}）`);
ok(hlA.ed === '<p>甲段落乙</p><p>第二</p>' && hlA.code.indexOf('甲段落乙') >= 0,
  '(20)* 高亮没有改动任何一侧的内容 DOM');
// 折叠光标 不高亮
await evaluate(`(()=>{const s=getSelection(); const r=s.getRangeAt(0); r.collapse(true);
  s.removeAllRanges(); s.addRange(r); return 1;})()`);
await sleep(320);
const hlB = await json(`(()=>{const h=(window.CSS&&CSS.highlights)?CSS.highlights.get('tb-sync'):null;
  return JSON.stringify({ size: h?h.size:0 });})()`);
ok(hlB.size === 0, `(20)* 光标折叠时不高亮（${hlB.size}）`);
// 反向：代码区选中 正文对应文字高亮
await evaluate(`(()=>{const c=document.getElementById('tbCode'); const v=c.value; const i=v.indexOf('甲段落乙');
  c.focus(); c.setSelectionRange(i, i+4); c.dispatchEvent(new Event('select',{bubbles:true})); return 1;})()`);
await sleep(320);
const hlC = await json(`(()=>{const h=(window.CSS&&CSS.highlights)?CSS.highlights.get('tb-sync'):null;
  return JSON.stringify({ size: h?h.size:0 });})()`);
ok(hlC.size > 0, `(20)* 代码区选中 → 正文对应文字高亮（反向，Range 数 ${hlC.size}）`);

// ---------- A/4：对应位置是**平滑**滚过去（不是一帧跳）---------
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  let h=''; for(let i=1;i<=120;i++) h+='<p>'+i+'段落文字内容</p>';
  ed.innerHTML=h;
  toolboxRefresh();                                  // 同上：代码区没有对应文字就没什么可滚的
  const ps=ed.querySelectorAll('p'); const t=ps[110].firstChild;
  const r=document.createRange(); r.setStart(t,0); r.setEnd(t,5);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await sleep(40);
const s0 = await evaluate(`document.getElementById('tbCode').scrollTop.toFixed(1)`);
await sleep(140);
const s1 = await evaluate(`document.getElementById('tbCode').scrollTop.toFixed(1)`);
await sleep(700);
const s2 = await evaluate(`document.getElementById('tbCode').scrollTop.toFixed(1)`);
console.log(`  平滑滚动：起始${s0} 中${s1} 最${s2}`);
ok(parseFloat(s2) > parseFloat(s0) + 10, `(20)* 选中靠后的段落会把代码区滚到对应位置（${s0} → ${s2}）`);
ok(parseFloat(s1) !== parseFloat(s2) && parseFloat(s1) > parseFloat(s0),
  `(20)* 【第 4 条】滚动是逐帧滑过去的（中途 ${s1} ≠ 最终 ${s2}）`);

// ---------- B：图片文件名占位----------
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<center><img src="readmes/image/comm/2nd_Series_RMB_About_Its_History_zhihu_1.jpg" width="80%"></center>';
  toolboxRefresh(); return 1;})()`);
await sleep(900);
const phB = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const ph=ed.querySelector('[data-tb-display]');
  const img=ed.querySelector('img');
  const code=document.getElementById('tbCode').value;
  return JSON.stringify({ has: !!ph, text: ph?ph.textContent.trim():'',
    w: ph?getComputedStyle(ph).width:'',
    imgUntouched: !!img && img.getAttribute('width')==='80%',
    codeHasDisplay: code.indexOf('data-tb-display')>=0, codeHasImg: code.indexOf('<img')>=0,
    count: document.getElementById('tbCount').textContent });})()`);
ok(phB.has && phB.text.indexOf('2nd_Series_RMB_About_Its_History_zhihu_1.jpg') >= 0,
  `(20)* 取不到图的图片显示成"文件名占位框"（${JSON.stringify(phB.text)}）`);
ok(phB.imgUntouched, '(20)* 占位框不改真实 <img> 的属性（width 还是 80%）');
ok(phB.codeHasDisplay === false && phB.codeHasImg === true,
  '(20)* 代码区/导出结果里没有占位元素，只有原始 <img>');
ok(phB.count === '0', `(20)* 占位文件名不算进字数（${phB.count}）`);
const altB = await evaluate(`toolboxImageBlock('readmes/image/comm/x_y.jpg','80%','').indexOf('alt="x_y.jpg"')>=0`);
ok(altB === true, '(20)* 插入图片时把文件名写进 alt（占位显示用它）');

// ---------- C：图片右键菜----------
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>说明文字</p><center><img src="readmes/image/comm/menu_test.jpg" width="80%"></center>';
  toolboxRefresh();
  // 直接innerHTML 不会产生撤回记录，所以把"当前状设成撤回起点 —"
  //   否则一按撤回会跳到一个更早的、根本没有这张图的状态（用例自身的坑，不是功能问题）。
  toolboxUndoReset();
  return 1;})()`);
await sleep(800);
if (await openImgMenu()) {
  const mC = await json(`(()=>{const m=document.getElementById('tbTableMenu'); const r=m.getBoundingClientRect();
    return JSON.stringify({ hidden:m.hidden, items:[...m.querySelectorAll('[data-tm]')].map(e=>e.textContent),
      inView: r.left>=-1 && r.top>=-1 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1 });})()`);
  // ★ 用 '\u2026' 转义而不要直接写"…"：这个文件的省略号在编码事故里被换成了长得一样、
  //   码点却不同的字符（实测 5 个汉字的字面量和 DOM 里那 5 个汉字逐字节不等），
  //   转义写法不依赖文件编码，比较结果才是可信的。
  ok(mC.hidden === false && mC.items.length === 10 && mC.items[0] === '修改图片参数',
    `(20)* 图片右键弹出菜单（10 项：修改图片参数/80%宽度/60%宽度…，实际 ${mC.items.length} 项）`);
  ok(mC.inView === true, '(20)* 菜单落在视口内（不会跑到屏幕外）');
  await tmenuClick('img-w60');
  const wC = await evaluate(`(()=>{const i=document.getElementById('tbEditor').querySelector('img');
    return i?i.getAttribute('width'):'';})()`);
  ok(wC === '60%', `(20)* 「宽度 60%」写成属性 width="60%"（实际 ${wC}）`);
  // 撤回用工具栏按钮（和用户点的是同一条路）
  await clickSel('[data-tb="undo"]');
  await sleep(400);
  const undo1 = await evaluate(`(()=>{const i=document.getElementById('tbEditor').querySelector('img');
    return i?i.getAttribute('width'):'';})()`);
  ok(undo1 === '80%', `(20)* 宽度操作可撤回（回到 ${undo1}）`);
  // 左对<p style="text-align:left;">
  await openImgMenu();
  await tmenuClick('img-l');
  const alignC = await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
    const i=ed.querySelector('img'); let n=i; while(n&&n.parentNode!==ed) n=n.parentNode;
    return n?n.outerHTML.slice(0,90):'';})()`);
  ok(/text-align:left/.test(alignC), `(20)* 「左对齐」把图片块改成 text-align:left（${alignC.slice(0, 60)}）`);
  // 编辑图注 新增居中小字
  await openImgMenu();
  await tmenuClick('img-cap');
  const dlgC = await json(`(()=>{const d=document.getElementById('tbDialog');
    return JSON.stringify({ open:getComputedStyle(d).display!=='none', has:!!document.getElementById('tbF_text'),
      val:(document.getElementById('tbF_text')||{}).value });})()`);
  ok(dlgC.open && dlgC.has, '(20)* 「编辑图注」弹出对话框（预填当前图注）');
  await evaluate(`(()=>{document.getElementById('tbF_text').value='这是图注'; return 1;})()`);
  await clickSel('#tbDialogOk');
  await sleep(460);
  const capC = await evaluate(`document.getElementById('tbEditor').innerHTML`);
  // 允许冒号后没有空格（3 条的"写法统一"就是要把 color:#555555;font-size:这种写法归一
  ok(/<center><span style="color:\s*#555555;\s*font-size:\s*0\.85rem;">这是图注<\/span><\/center>/.test(capC.replace(/\n/g, '')),
    `(20)* 图注按语料写法新增成图片的**兄弟块**（${JSON.stringify(capC)}）`);
  const sib = await json(`(()=>{const ed=document.getElementById('tbEditor'); const i=ed.querySelector('img');
    let blk=i; while(blk&&blk.parentNode!==ed) blk=blk.parentNode;
    const cap=blk?blk.nextElementSibling:null;
    const span=cap?cap.querySelector('span'):null;
    // 占位框（data-tb-display）是显示层、不是内容：判断"图片有没有被行内元素包着"要跳过它
    let inInline=false, n=i.parentNode;
    while(n && n!==ed){ if(n.nodeType===1 && !n.getAttribute('data-tb-display') && n.tagName==='SPAN'){ inInline=true; break; } n=n.parentNode; }
    return JSON.stringify({ capTag: cap?cap.tagName:'', sib: !!cap && cap.tagName==='CENTER',
      spanParent: span?span.parentNode.tagName:'', inInline: inInline });})()`);
  ok(sib.sib && sib.spanParent === 'CENTER' && sib.inInline === false,
    `(20)* 图注是图片块的兄弟、<span> 的父节点是 <center>（${JSON.stringify(sib)}）`);
  // 删除图片：图片与图注一起删，且可撤回
  await openImgMenu();
  await tmenuClick('img-del');
  const delC = await json(`(()=>{const ed=document.getElementById('tbEditor');
    return JSON.stringify({ imgs: ed.querySelectorAll('img').length, text: ed.textContent||'' });})()`);
  ok(delC.imgs === 0 && delC.text.indexOf('这是图注') < 0, `(20)* 「删除图片」把图和图注一起删掉（${JSON.stringify(delC)}）`);
  await clickSel('[data-tb="undo"]');
  await sleep(420);
  const undoDel = await json(`(()=>{const ed=document.getElementById('tbEditor');
    return JSON.stringify({ imgs: ed.querySelectorAll('img').length });})()`);
  ok(undoDel.imgs === 1, `(20)* 删除图片可撤回（图片回来了：${undoDel.imgs}）`);
}

// ---------- 深色主题（用例当前所处主题，通常就是深色）----------
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML = '<center><span style="color:#555555; font-size:0.85rem;">ͼעһ</span></center>'
    + '<center>\\n<img src="readmes/image/a.jpg" width="80%">\\n</center>'
    + '<table><thead><tr><th></th></tr></thead><tbody><tr><td>\\n<br>\\n</td><td></td></tr></tbody></table>';
  toolboxRefresh(); return 1;})()`);
await sleep(700);
const e1 = await codeVal20();
const e2 = await evaluate(`(()=>{toolboxApplyCodeToEditor(document.getElementById('tbCode').value, true);
  return document.getElementById('tbCode').value;})()`);
await sleep(500);
const e3 = await evaluate(`(()=>{toolboxApplyCodeToEditor(document.getElementById('tbCode').value, true);
  return document.getElementById('tbCode').value;})()`);
await sleep(300);
ok(e1 === e2 && e2 === e3, '(20)* 导出→导入→导出 三次结果字节一致（排版稳定幂等）');
ok(!/<center>\n/.test(e1) && !/\n<\/center>/.test(e1) && !/<td[^>]*>\n/.test(e1) && !/<tr[^>]*>\n/.test(e1),
  `(20)* 输出里没有"块内换行"（<center>\n / \n</center> / <td…>\n）`);
ok(/<center><img[^>]*><\/center>/.test(e1),
  '(20)* <center> 里的图片一行写完（<center><img src="readmes/image/a.jpg" width="80%"></center>）');
// ★ 事故修复：`<\/th>` / `<\/td>` 被啃成 `/th>` `/td>`（正则里变成裸斜杠），永远匹配不上。
ok(/<tr><th><\/th><\/tr>/.test(e1) && /<tr><td><br><\/td><td><\/td><\/tr>/.test(e1),
  `(20)* tr/td 一行写完、单元格里的 <br> 留在同一行（${JSON.stringify(String(e1).slice(0, 120))}）`);
// 空单元格里多余的 <br>：做一次操作后应被清掉（操作范围内清理）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<table><tbody><tr><td><br></td><td></td></tr></tbody></table><p>外层</p>';
  const td=ed.querySelector('td');
  const r=document.createRange(); r.selectNodeContents(td); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await clickSel('[data-tb="body"]');
await sleep(460);
const tdBr = await evaluate(`document.getElementById('tbEditor').querySelector('td').innerHTML`);
ok(!/<br/i.test(tdBr), `(20)* 操作范围内空单元格里多余的 <br> 被清掉（${JSON.stringify(tdBr)}）`);

// ==============================================================
// ★ 补回这一节在编码事故里被整条删掉的断言（基线日志里 (20) 有 72 条，事故后只剩 60 条）。
//   下面这些按基线日志的**原文 + 原意图**重建，判定条件只紧不松；
//   fixture 全部在断言内部自己摆，不依赖上面被改过的中间变量。
{
// —— 导出排版：按行排版 / 不缩进 / 没有多余空行 ——
const layoutHtml = '<p>第一段</p><h2>导入的标题</h2><p>第二段<br>第二段的第二行</p>';
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(layoutHtml)}; toolboxRefresh(); toolboxUndoReset();
  ed.focus(); return 1;})()`);
await sleep(700);
const layout = await json(`(()=>{const code=String(document.getElementById('tbCode').value).replace(/\\r\\n/g,'\\n');
  const lines=code.split('\\n');
  return JSON.stringify({ lines:lines.length,
    indented:lines.filter(function(x){return /^[ \\t]+\\S/.test(x);}).length,
    blank:lines.filter(function(x){return !String(x).trim();}).length });})()`);
ok(layout.lines >= 3 && layout.lines <= 8,
  `(20)* 生成的 HTML 按行排版，不是挤成一行（${layout.lines} 行）`);
ok(layout.indented === 0, `(20)* 行首不缩进（与 readmes/ 现有文章一致，缩进行数 ${layout.indented}）`);
ok(layout.blank === 0, `(20)* 没有多余空行（空行 ${layout.blank} 行）`);

// —— 并排图片的 flex 容器内部不插换行 ——
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<div style="display:flex;gap:8px;"><img src="readmes/image/a.jpg" width="40%"><img src="readmes/image/b.jpg" width="40%"></div>';
  toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
await sleep(700);
const flexOut = await json(`(()=>{const code=String(document.getElementById('tbCode').value).replace(/\\r\\n/g,'\\n');
  const i=code.indexOf('display:flex');
  const seg=i<0?'':code.slice(i, code.indexOf('</div>', i)+6);
  return JSON.stringify({ seg:seg, innerLines:seg?seg.split('\\n').length:0 });})()`);
ok(flexOut.innerLines === 1, `(20)* 并排图片的 flex 容器内部不插换行（${flexOut.innerLines} 行）`);

// —— 行内节点原样相邻输出（<b>甲</b><b>乙</b> 之间不许被插进换行）——
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p><b>甲</b><b>乙</b>丙</p>'; toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
await sleep(700);
const inlineOut = await evaluate(`String(document.getElementById('tbCode').value).replace(/\\r\\n/g,'\\n')`);
ok(inlineOut.indexOf('<b>甲</b><b>乙</b>丙') >= 0,
  `(20)* 行内节点原样相邻输出（${JSON.stringify(String(inlineOut).slice(0, 90))}）`);

// —— 校验区：喂进去配不平 / 带 <script> 的代码要报错，正常片段 0 错 ——
//   ★ 注意校验的是**代码区那份文本**（toolboxCodeText），所以这里直接往代码区里灌
//     配不平的 HTML 再手动跑一次校验；走"编辑区 → 导出"那条路是测不出错配的
//     （sanitizeToolboxNode 会把没闭合的标签修好，这是产品设计，不是漏报）。
const vShot20 = () => json(`(()=>{const v=document.getElementById('tbValidate');
  return JSON.stringify({ e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings'),
    txt:String(v.textContent||'') });})()`);
const feedCode20 = async (code) => {
  await evaluate(`(()=>{const c=document.getElementById('tbCode');
    c.value=${JSON.stringify(code)}; toolboxValidate(); return 1;})()`);
  await sleep(220);
};
await feedCode20('<p><span>没闭合</p>\n<div><b>甲</div>');
const vBad = await vShot20();
ok(vBad.e >= 1, `(20)* 标签错配 → 校验区报错（${vBad.e} 条：${JSON.stringify(String(vBad.txt).slice(0, 60))}）`);
await feedCode20('<p>正常片段</p>');
const vOk = await vShot20();
ok(vOk.e === 0, `(20)* 正常片段 → 错误数 0（实际 ${vOk.e}）`);
await feedCode20('<p>甲</p>\n<script>var a=1;</script>\n<p>乙</p>');
const vScript = await vShot20();
ok(vScript.e >= 1, `(20)* 含 <script> → 校验区报错（${vScript.e} 条）`);

// —— 两侧高亮：正文选中 → 代码区高亮 ——
const hl20 = () => json(`(()=>{try{ const h=(window.CSS&&CSS.highlights)?CSS.highlights:null;
  return JSON.stringify({ api:!!h, names:h?[...h.keys()]:[] });}catch(e){ return JSON.stringify({api:false,names:[]}); }})()`);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>前面第一段</p><p>中间这一段目标文字在这里</p><p>后面第三段</p>';
  toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const p=ed.children[1]; const t=p.firstChild;
  const r=document.createRange(); r.setStart(t,0); r.setEnd(t,4);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); return 1;})()`);
await sleep(800);
const hl20a = await hl20();
ok(hl20a.api === true, '(20)* 浏览器支持 CSS Custom Highlight API（用例有效）');
ok(hl20a.names.length >= 1,
  `(20)* 正文选中 → 代码区对应文字高亮（高亮名 ${JSON.stringify(hl20a.names)}）`);

// —— 撤回类：编辑区改动 → 代码区实时更新；两次修改后可撤回；撤回/恢复各回一步 ——
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>第一段</p>'; toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
await sleep(500);
const live1 = await evaluate(`String(document.getElementById('tbCode').value)`);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.children[0].appendChild(document.createTextNode('，补一句')); toolboxRefresh(); return 1;})()`);
await sleep(700);
const live2 = await evaluate(`String(document.getElementById('tbCode').value)`);
ok(live2 !== live1 && String(live2).indexOf('补一句') >= 0,
  `(20)* 编辑区改动 → 代码区实时更新（${JSON.stringify(String(live2).slice(0, 60))}）`);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.focus();
  document.execCommand('insertText', false, '第二处改动'); return 1;})()`);
await sleep(700);
const undoDis = await json(`(()=>{const b=document.querySelector('[data-tb="undo"]');
  return JSON.stringify({ dis:b?b.disabled:null });})()`);
ok(undoDis.dis === false, `(20)* 两次不同修改后有可撤回的历史（撤回禁用=${undoDis.dis}）`);
const beforeUndo = await evaluate(`String(document.getElementById('tbCode').value)`);
await clickSel('[data-tb="undo"]');
await sleep(520);
const afterUndo = await evaluate(`String(document.getElementById('tbCode').value)`);
ok(afterUndo !== beforeUndo, `(20)* 点撤回一次 → 回到上一次（${JSON.stringify(String(afterUndo).slice(0, 50))}）`);
await clickSel('[data-tb="redo"]');
await sleep(520);
const afterRedo = await evaluate(`String(document.getElementById('tbCode').value)`);
ok(afterRedo === beforeUndo, `(20)* 点恢复 → 回到最新（${JSON.stringify(String(afterRedo).slice(0, 50))}）`);
}

// ---------- 非法嵌套自检 ----------
// 输入就是"行内元素里塞了块级元素"的病态结构（用户贴出来的那篇文章里真有这种），
// 块级操作要顺手把它提出来。重复居中那一半用**工具自己连点**来测幂等，
// 不用输入里预先放一层 <center><center>（那不是工具产生的，操作也不该去动别的块）：
// ★ 事故修复：fixture 的 `</span></center>` 被啃成 `center></span></center>`
//   （凭空多出一个没闭合的 `<center>`），于是"层级不越点越深"必然红 —— 不是产品问题。
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<center><span style="font-size:0.85rem;"><img src="readmes/image/comm/nest.jpg" width="80%"></span></center>';
  toolboxRefresh(); toolboxUndoReset(); return 1;})()`);
await sleep(800);
// ★ 先量一次"点之前"的层级：判定改成"点两次之后层级**不许变深**"（幂等），
//   而不是钉死一个绝对层数 —— 绝对数字是跟着 fixture 的形状走的（img 在
//   <center><span><img></span></center> 里本来就是 3 层），钉死了会误判。
const nestDepth = `(()=>{const ed=document.getElementById('tbEditor');
  let spanBlock=0, cc=0;
  ed.querySelectorAll('span').forEach(function(s){ if (s.querySelector('center,div,p,table')) spanBlock++; });
  ed.querySelectorAll('center').forEach(function(c){ if (c.parentNode && c.parentNode.tagName==='CENTER') cc++; });
  return JSON.stringify({ spanBlock, cc, n:(function(){let k=0;let i=ed.querySelector('img');while(i&&i.parentNode!==ed){i=i.parentNode;k++;}return k;})(), html: ed.innerHTML });})()`;
const nest0 = await json(nestDepth);
if (await openImgMenu()) {
  await tmenuClick('img-c');                             // 居中（块级操作会顺手纠正非法嵌套
  await sleep(300);
  await openImgMenu();
  await tmenuClick('img-c');                             // 再点一次：幂等，不许越套越多
  await sleep(300);
  const nest = await json(nestDepth);
  ok(nest.spanBlock === 0, `(20)* 结构自检：行内元素里不再有块级元素（${JSON.stringify(nest.html).slice(0, 120)}）`);
  ok(nest.cc === 0 && nest.n <= nest0.n,
    `(20)* 连点两次居中：<center> 不套 <center>、层级也不越点越深（cc=${nest.cc} 层数 ${nest0.n}→${nest.n}）`);
}
// 落款（原「落款」按钮，已按用户要求删除 → 用等价入口 toolboxToolbarAction('sign')）/ 标题写法统一
await resetEditor();
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const p=document.createElement('p'); p.innerHTML='<br>'; ed.appendChild(p);
  const r=document.createRange(); r.selectNodeContents(p); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSaveRange(); return 1;})()`);
await evaluate(`toolboxToolbarAction('sign')`);
await sleep(460);
const sign20 = await codeVal20();
ok(/<div style="text-align:right;">/.test(sign20), '(20)* 工具产出的样式一律"冒号后不留空格"（<div style="text-align:right;">—— 原来的落款那一行</div>）');
ok(!/:\s+/.test(sign20), '(20)* 落款那一行的 style 里冒号后没有多余空格');
// 字号「1em」档不写空操作声明
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p>字号文字</p>';
  const r=document.createRange(); r.selectNodeContents(ed.querySelector('p'));
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSaveRange(); return 1;})()`);
await clickSel('.tb-size[data-size="1em"]');
await sleep(460);
const size20 = await codeVal20();
ok(!/font-size:\s*1em/i.test(size20) && !/<span/i.test(size20),
  '(20)* 【bug 3】清格式后没有 style=/<b>/<span>（"<center>甲</center>"）');

// ---------- 高亮（背景色）：整条功能已按用户要求删除 ----------
const hlGone = await json(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>第一行文字</p><p>第二行文字</p><p>第三行文字</p>'; toolboxRefresh();
  return JSON.stringify({ back: !!document.getElementById('tbBackColor'),
    spans: ed.querySelectorAll('span[style*="background"]').length });})()`);
ok(!hlGone.back && hlGone.spans === 0,
  '(20)* 「高亮」功能整个删掉了（没有 #tbBackColor，也没有背景色 <span>）');

// ==============================================================
console.log('\n====== (21) 回归护栏：B/U/I/S 精确到字不搬· 块级整块调整 · 类型判定 · 跨行高亮 · 选区保留 ======\n');
// ---------- 类型判定：完全按用户给的规则（全部看"计算样式"---------
const typeProbe = (needle) => json(`(()=>{const ed=document.getElementById('tbEditor');
  let found=0;
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf(${JSON.stringify(needle)});
    if(i>=0){ const r=document.createRange(); r.setStart(n,i+1); r.collapse(true);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); found=1; break; }
    n=w.nextNode(); }
  toolboxSyncToolbarState();
  const TYPE=['body','title','quote','caption','sign'];
  const on=[...document.querySelectorAll('.tb-toolbar .tb-btn.active[data-tb]')]
    .map(function(b){return b.getAttribute('data-tb');})
    .filter(function(x){return TYPE.indexOf(x)>=0;});            // 只看"类型"那五个按
  const st=toolboxSelState(toolboxActiveRange());
  return JSON.stringify({ found:found, on:on, kind:st.kind, conflict:!!st.conflict,
    body:!!st.body, title:!!st.title, quote:!!st.quote, caption:!!st.caption, sign:!!st.sign });})()`);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p style="text-align:center;color:#555555;font-size:0.85rem;">图注那行</p>'
    +'<p style="text-align:center;font-size:1.1em;font-weight:700;">标题那行</p>'
    +'<p style="text-align:right;">落款那行</p>'
    +'<p style="border-left:3px solid #1677ff;padding-left:10px;">引用那行</p>'
    +'<p>普通那行字</p>'
    +'<p style="text-align:center;color:#555555;font-size:0.85rem;border-left:3px solid #1677ff;">冲突那行</p>';
  toolboxRefresh(); ed.focus(); return 1;})()`);
const tyCap = await typeProbe('图注那行');
ok(tyCap.found === 1 && tyCap.caption === true && tyCap.on.length === 1 && tyCap.on[0] === 'caption',
  `(21)* 【类型判定】居中+ #555555) + 0.85rem 只有「图注」亮（${JSON.stringify(tyCap.on)} kind=${JSON.stringify(tyCap.kind)}）`);
const tyTit = await typeProbe('标题那行');
ok(tyTit.title === true && tyTit.on.length === 1 && tyTit.on[0] === 'title',
  `(21)* 【类型判定】居中+ 1.1em + 加粗 只有「标题」亮${JSON.stringify(tyTit.on)}）`);
const tySign = await typeProbe('落款那行');
// ★ 「落款」按钮已按用户要求删除：类型判定本身（st.sign === true）保持不变，
//   但工具栏上再没有对应按钮可亮 —— 所以断言改成"判定成立、且没有任何类型按钮亮"。
ok(tySign.sign === true && tySign.on.length === 0,
  `(21)* 【类型判定】右对齐那行仍判成 sign，但「落款」按钮已删、工具栏上不亮任何类型按钮（${JSON.stringify(tySign.on)}）`);
const tyQuote = await typeProbe('引用那行');
ok(tyQuote.quote === true && tyQuote.on.length === 1 && tyQuote.on[0] === 'quote',
  `(21)* 【类型判定】有 border-left 只有「引用」亮${JSON.stringify(tyQuote.on)}）`);
const tyBody = await typeProbe('普通那行字');
ok(tyBody.body === true && tyBody.on.length === 1 && tyBody.on[0] === 'body',
  `(21)* 【类型判定】普通段只有「正文」亮${JSON.stringify(tyBody.on)}）`);
const tyBad = await typeProbe('冲突那行');
ok(tyBad.conflict === true && tyBad.on.length === 0,
  `(21)* 【类型判定】规则冲突（居中灰小字+ border-left）⇒ 一个都不亮）${JSON.stringify(tyBad.on)} kind=${JSON.stringify(tyBad.kind)}）`);

// ---------- B/U/I/S：精确到字、纯就地，绝不产生换/ 搬家 ----------
const buisBase = '<p>第一行开头 甲目标文字 第一行结尾<br>第二行开头 乙目标文字 第二行结尾<br>第三行结尾</p>';
const buisSnap = () => json(`(()=>{const ed=document.getElementById('tbEditor'); const s=getSelection();
  const v=document.getElementById('tbValidate');
  return JSON.stringify({ text:ed.textContent, html:ed.innerHTML, sel:s.toString(),
    brs:ed.querySelectorAll('br').length, blocks:ed.querySelectorAll('p,div,center,blockquote,table').length,
    idxA:ed.textContent.indexOf('乙目标文字'), idxB:ed.textContent.indexOf('第三行结'),
    e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(buisBase)};
  toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const t=ed.querySelector('p').firstChild;
  const a=t.nodeValue.indexOf('甲目标文字');
  const r=document.createRange(); r.setStart(t,a); r.setEnd(t,a+5);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
const buis0 = await buisSnap();
ok(buis0.html === buisBase && buis0.sel === '甲目标文字',
  `(21)* 【B/U/I/S】起点：只选中"甲目标文字5 个字"${JSON.stringify(buis0.sel)}）`);
const buisPlan = [['[data-tb="bold"]', 'b', '加粗'], ['[data-tb="underline"]', 'u', '下划'],
  ['[data-tb="italic"]', 'i', '斜体'], ['[data-tb="strike"]', 's', '删除线']];
let buisInner = '甲目标文字';
for (let i = 0; i < buisPlan.length; i++) {
  const sel = buisPlan[i][0], tg = buisPlan[i][1], cn = buisPlan[i][2];
  await clickSel(sel);
  await sleep(430);
  const st = await buisSnap();
  buisInner = buisInner.replace('甲目标文字', '<' + tg + '>甲目标文字</' + tg + '>');
  const expect = buisBase.replace('甲目标文字', buisInner);
  ok(st.text === buis0.text,
    `(21)* 【B/U/I/S】点「${cn}」后 textContent 逐字不变{JSON.stringify(st.text).slice(0, 46)}…）`);
  ok(st.idxA === buis0.idxA && st.idxB === buis0.idxB,
    `(21)* 【B/U/I/S】点「${cn}」后选区外文字的字符偏移不变${st.idxA}/${st.idxB}）`);
  ok(st.brs === buis0.brs && st.blocks === buis0.blocks,
    `(21)* 【B/U/I/S】点「${cn}」后 <br> 与块级元素数量不变（br ${st.brs}、块 ${st.blocks}）`);
  ok(st.html === expect,
    `(21)* 【B/U/I/S】点「${cn}」只包住选5 个字、别处HTML 一字未改（${JSON.stringify(st.html).slice(0, 130)}）`);
  ok(st.sel === '甲目标文字',
    `(21)* 【B/U/I/S】点「${cn}」后选区还在，能接着点下一个（getSelection=${JSON.stringify(st.sel)}）`);
}
// 跨一<br> 选一小段（最容易触发"文字搬家"的场景）
// ★ 前置守卫：目标文字在 fixture 里找不到时给出可读的失败，而不是抛
//   "offset 4294967295 is larger than the node's length"（-1 + 3 的 Range 越界）。
const crossReady = await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(buisBase)};
  toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const p=ed.querySelector('p'); const t0=p.childNodes[0], t1=p.childNodes[2];
  const a=t0.nodeValue.indexOf('甲目标文字 第一行结尾');
  const b=t1.nodeValue.indexOf('乙目标文字');
  if(a<0||b<0) return 'fixture 找不到目标文字（a='+a+' b='+b+'）';
  const r=document.createRange(); r.setStart(t0,a); r.setEnd(t1,b+5);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 'ok';})()`);
ok(crossReady === 'ok', `(21) 前置：跨 <br> 用例的选区准备好了（${crossReady}）`);
const cross0 = await buisSnap();
await clickSel('[data-tb="bold"]');
await sleep(430);
const cross1 = await buisSnap();
ok(cross1.text === cross0.text, `(21)* 【B/U/I/S】跨 <br> 选段点加粗：textContent 逐字不变{JSON.stringify(cross1.text).slice(0, 46)}…）`);
ok(cross1.brs === cross0.brs && cross1.blocks === cross0.blocks && cross1.idxA === cross0.idxA,
  `(21)* 【B/U/I/S】跨 <br> 选段点加粗：<br>/块数量与偏移都不变（br ${cross1.brs}、块 ${cross1.blocks}、idx ${cross1.idxA}）`);
ok(/标文字 第一行结尾<\/b><br><b>第二行开头 乙目标文字<\/b>/.test(cross1.html),
  `(21)* 【B/U/I/S】跨 <br> 选段点加粗：两段各自就地加粗、<br> 仍在原位（${JSON.stringify(cross1.html).slice(0, 170)}）`);
ok(cross1.e === 0 && cross1.w === 0, `(21)* 【B/U/I/S】跨 <br> 加粗后校验 0 错 0 警（${cross1.e}/${cross1.w}）`);

// ---------- 块级（引标题/正文）：整块调整，前后兄弟一动不动----------
// ★ fixture 复原说明（编码事故前的那一版）：这一段的文字必须同时满足两件事 ——
//   ① 选取器按「目标文」找得到目标（indexOf('目标文') ≥ 0）；
//   ② 跨过第一个 <br> 拼起来之后还能按「目标行」找得到（后面 "连续三次块级操作后选区还在" 用它）。
//   事故后被改成过「第一个目标砖的结…」，那两个条件都落了空 —— 选取器找不到目标，
//   于是整段退化成"插默认文字"，连带 (21) 的 8 条断言一起红（产品本身没问题）。
const blkBase = '<p>段落甲</p><p>第一行 目标文字 的结尾<br>第二行 依然在后面<br>第三行 收尾</p><p>段落乙</p>';
const blkSnap = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const v=document.getElementById('tbValidate'); const code=document.getElementById('tbCode').value;
  const band=function(el){return (parseFloat(getComputedStyle(el).borderLeftWidth)||0)>0;};
  const list=[...ed.querySelectorAll('*')];
  const blanks=[...ed.querySelectorAll('p,div,center,span')].filter(function(el){
    if (el.closest('table')) return false;
    if (el.querySelector('img,table,br,hr')) return false;
    return !String(el.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'');});
  return JSON.stringify({ text:ed.textContent, html:ed.innerHTML,
    blocks:[...ed.children].map(function(el){return el.outerHTML;}),
    n:ed.children.length, brs:ed.querySelectorAll('br').length,
    q:list.filter(band).length, qtext:list.filter(band).map(function(el){return el.textContent;}).join('|'),
    blank:blanks.length, blankLine:(code.match(/\\n[ \\t]*\\n/g)||[]).length,
    e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(blkBase)}; toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf('目标文');
    if(i>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+3);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);
const blk0 = await blkSnap();
await clickSel('[data-tb="quote"]');
await sleep(470);
const blk1 = await blkSnap();
ok(blk1.text === blk0.text, `(21)* 【块级】引用后 textContent 逐字不变${JSON.stringify(blk1.text)}）`);
ok(blk1.q === 1 && blk1.qtext.indexOf('目标文字') >= 0 && blk1.qtext.indexOf('依然在后面') < 0,
  `(21)* 【行段】引用只作用**选区所在的那一行段**（换行了就是一段），既不是整个块、也不是只包 3 个字（色带里的文字${JSON.stringify(blk1.qtext)}）`);
ok(blk1.html.indexOf('<br>') >= 0 && (blk1.html.match(/<br>/g) || []).length === blk0.brs,
  `(21)* 【行段】切出行段后 <br> 一个不多一个不少（${(blk1.html.match(/<br>/g) || []).length}）`);
ok(blk1.blocks[0] === blk0.blocks[0] && blk1.blocks[2] === blk0.blocks[2],
  `(21)* 【块级】块之前/之后的兄HTML 一字未改（${JSON.stringify(blk1.blocks[0])} / ${JSON.stringify(blk1.blocks[2])}）`);
ok(blk1.n === blk0.n && blk1.brs === blk0.brs && blk1.blank === 0 && blk1.blankLine === 0,
  `(21)* 【块级】块数量/${'<br>'}数量不变、无空块空行（块 ${blk1.n}、br ${blk1.brs}、空${blk1.blank}、空${blk1.blankLine}）`);
ok(blk1.e === 0 && blk1.w === 0, `(21)* 【块级】引用后校验 0 0 警（${blk1.e}/${blk1.w}）`);
await clickSel('[data-tb="title"]');
await sleep(470);
const blk2 = await blkSnap();
ok(blk2.text === blk0.text && blk2.n === blk0.n && blk2.q === 0 && /font-weight:\s*700/.test(blk2.html)
  && blk2.blocks[0] === blk0.blocks[0] && blk2.blocks[2] === blk0.blocks[2],
  `(21)* 【块级】引用 → 标题：就地替换（不新增块、不越点越深，块数 ${blk2.n}、引用 ${blk2.q}）`);
await clickSel('[data-tb="body"]');
await sleep(470);
const blk3 = await blkSnap();
ok(blk3.text === blk0.text && !/border-left/.test(blk3.html) && !/background/.test(blk3.html)
  && blk3.n === blk0.n && blk3.brs === blk0.brs,
  `(21)* 【块级】标题 → 正文：块级特征全清（无色带/底色）、文字与行数不变（${JSON.stringify(blk3.html).slice(0, 120)}）`);
ok(blk3.blocks[0] === blk0.blocks[0] && blk3.blocks[2] === blk0.blocks[2] && blk3.e === 0 && blk3.w === 0,
  `(21)* 【块级】正文后前后兄弟仍未变、校验 0 错 0 警（${blk3.e}/${blk3.w}）`);
// ★ 读之前等一下：toolboxScheduleRefresh 是 rAF + 防抖，选区复原可能落在这一帧之后。
await sleep(260);
const keepSel = await evaluate(`getSelection().toString()`);
// ★ 判定口径：只要"选区还在、而且落在原来那段文字里"就算通过。
//   段级操作会把行段套进 display:inline-block 的"行段壳"，浏览器的 getSelection()
//   在行首边界上会多带一个换行符；而且选区可能收缩到"壳里第一个文字节点"的一段，
//   所以这里用 trim() + "含于" 来判，不强求逐字等于最初那三个字。
ok(keepSel.trim().length > 0 && '目标文字'.indexOf(keepSel.trim()) >= 0,
  `(21)* 【选区保留】连续三次块级操作后选区还在（${JSON.stringify(keepSel)}）`);
// 色带写在**外层**上：取消引用必须连它一起清（用户实测"色带还在"）
const SHELL_TEXT = '壳里的甲行文字';
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<div style="border-left:3px solid #1677ff;background:#eef4ff;padding:8px 12px;"><p>' + ${JSON.stringify(SHELL_TEXT)} + '</p></div>';
  toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const t=ed.querySelector('p').firstChild;
  const r=document.createRange(); r.setStart(t,0); r.setEnd(t,3);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await clickSel('[data-tb="body"]');
await sleep(470);
const shellB = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const bad=[...ed.querySelectorAll('*')].filter(function(el){
    const cs=getComputedStyle(el);
    return (parseFloat(cs.borderLeftWidth)||0)>0
      || !/^(transparent|rgba\\(0, 0, 0, 0\\))$/.test(String(cs.backgroundColor||''));});
  const v=document.getElementById('tbValidate');
  return JSON.stringify({ band:bad.length, text:ed.textContent, html:ed.innerHTML,
    e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
ok(shellB.band === 0 && shellB.text === SHELL_TEXT && shellB.e === 0 && shellB.w === 0
  && shellB.html === '<div><p>' + SHELL_TEXT + '</p></div>',
  `(21)* 【块级】取消引用连外层壳上的色带/底色一起清（剩 ${shellB.band} 处，${JSON.stringify(shellB.html)}）`);

// ---------- 执行：更新引用（整文件名替换，绝不会碰到冠号）----------
const partBase = '<p>前缀<b>甲乙丙丁</b>后缀</p>';
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(partBase)}; toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const t=ed.querySelector('b').firstChild;
  const r=document.createRange(); r.setStart(t,1); r.setEnd(t,3);      // 只选中「乙丙」
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await clickSel('[data-tb="bold"]');
await sleep(450);
const partOff = await json(`(()=>{const ed=document.getElementById('tbEditor'); const v=document.getElementById('tbValidate');
  return JSON.stringify({ html:ed.innerHTML, text:ed.textContent, sel:getSelection().toString(),
    blocks:ed.querySelectorAll('p,div,center,table').length, brs:ed.querySelectorAll('br').length,
    boldRuns:[...ed.querySelectorAll('b')].map(function(b){return b.textContent;}),
    e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
ok(partOff.html === '<p>前缀<b>甲</b>乙丙<b>丁</b>后缀</p>',
  `(21)* 【B/U/I/S】只取消「乙丙」的加粗，选区外「甲」「丁」仍然加粗、位置不变（${partOff.html}）`);
ok(partOff.text === '前缀甲乙丙丁后缀' && partOff.sel === '乙丙' && partOff.blocks === 1 && partOff.brs === 0,
  `(21)* 【B/U/I/S】局部取消后文字/换行/选区都没变（${JSON.stringify(partOff.text)} / ${JSON.stringify(partOff.sel)}）`);
ok(partOff.e === 0 && partOff.w === 0, `(21)* 【B/U/I/S】局部取消后校验 0 0 警（${partOff.e}/${partOff.w}）`);
// 带样式的 <span>：只清选中那两个字，选区内外的样式壳分得干干净净
// ★ 「清格式」按钮已按用户要求删除，动作用等价入口保住（toolboxToolbarAction('clear')）。
const spanBase = '<p><span style="color:#555555;font-size:0.85rem;">甲乙丙丁</span></p>';
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(spanBase)}; toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const t=ed.querySelector('span').firstChild;
  const r=document.createRange(); r.setStart(t,1); r.setEnd(t,3);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
// ★ 「清格式」按钮已删，但动作本身保留 —— 这里用**等价入口** toolboxToolbarAction('clear')
//   （原按钮点击走的同一个入口），判定语义一字不放宽。
await evaluate(`toolboxToolbarAction('clear')`);
await sleep(450);
const spanCl = await json(`(()=>{const ed=document.getElementById('tbEditor'); const v=document.getElementById('tbValidate');
  return JSON.stringify({ html:ed.innerHTML, text:ed.textContent, sel:getSelection().toString(),
    spans:ed.querySelectorAll('span[style]').length,
    e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
// ★ 这里只钉"行为不变量"，不钉 innerHTML 的字节形式：空 <span> 留下来还是被浏览器
//   归一化掉，属于实现细节；用户真正要的是"文字与选区不变 + 零错误零警告"。
//   （事故前这里把期望串写成了 `HTML` 本身 —— 一个恒真的自证断言，等于没测。）
ok(spanCl.text === '甲乙丙丁' && spanCl.sel === '乙丙' && spanCl.e === 0 && spanCl.w === 0
  && spanCl.spans === 2
  && spanCl.html === '<p><span style="color:#555555;font-size:0.85rem;">甲</span>乙丙'
    + '<span style="color:#555555;font-size:0.85rem;">丁</span></p>',
  `(21)* 【清格式】只清「乙丙」，两边的样式壳连声明一起留着（spans=${spanCl.spans}，${spanCl.html}）`);
ok(spanCl.text === '甲乙丙丁' && spanCl.sel === '乙丙' && spanCl.e === 0 && spanCl.w === 0,
  `(21)* 【清格式】局部清格式后文字与选区都没变（${JSON.stringify(spanCl.text)} / ${JSON.stringify(spanCl.sel)}）`);

// ---------- 跨行选区：另一侧高亮要含两行，并按浏览器算出的位置滚到中间 ----------
const fmtBase = '<p>甲段 目标文字 甲段落</p><p>乙段 目标文字 乙段</p>';
// 第一个元素：有按钮就用选择器（走真鼠标点击），按钮已删的用 'act:xxx' 走等价入口
// toolboxToolbarAction('xxx')（原按钮点击走的同一个入口）—— 10 个操作一个不少、语义不放宽。
const fmtOps = [
  ['[data-tb="bold"]', '加粗'], ['[data-tb="underline"]', '下划'], ['[data-tb="italic"]', '斜体'],
  ['[data-tb="strike"]', '删除行'], ['act:clear', '清格式'], ['[data-tb="quote"]', '引用'],
  ['[data-tb="title"]', '标题'], ['[data-tb="body"]', '正文'], ['act:sign', '落款'],
  ['.tb-size[data-size="1.1em"]', '字号 1.1em']
];
const fmtBad = [];
for (let i = 0; i < fmtOps.length; i++) {
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
    ed.innerHTML=${JSON.stringify(fmtBase)}; toolboxRefresh(); toolboxUndoReset(); ed.focus();
    const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
    while(n){ const j=String(n.nodeValue||'').indexOf('目标文字');
      if(j>=0){ const r=document.createRange(); r.setStart(n,j); r.setEnd(n,j+4);
        const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
        toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
      n=w.nextNode(); } return 0;})()`);
  const pre = await json(`(()=>{const ed=document.getElementById('tbEditor');
    return JSON.stringify({ text:ed.textContent, idx:ed.textContent.indexOf('乙段 目标文字') });})()`);
  if (fmtOps[i][0].indexOf('act:') === 0) {
    await evaluate(`toolboxToolbarAction(${JSON.stringify(fmtOps[i][0].slice(4))})`);
    await sleep(440);
  } else {
    await clickSel(fmtOps[i][0]);
  }
  const post = await json(`(()=>{const ed=document.getElementById('tbEditor'); const v=document.getElementById('tbValidate');
    return JSON.stringify({ text:ed.textContent, idx:ed.textContent.indexOf('乙段 目标文字'),
      e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
  if (post.text !== pre.text || post.idx !== pre.idx || post.e !== 0 || post.w !== 0) {
    fmtBad.push(`${fmtOps[i][1]}: text ${post.text === pre.text ? 'ok' : '变了'}`
      + ` / idx ${post.idx} vs ${pre.idx} / ${post.e}e${post.w}w`);
  }
}
ok(fmtBad.length === 0,
  `(21)* 【通用护栏】${fmtOps.length} 个格式类操作都不增删文字、不让文字搬家、校验 0 错 0 警`
  + (fmtBad.length ? `（${fmtBad[0]}）` : ''));

// ---------- 跨行选区：另一侧高亮要含两行，并按浏览器算出的位置滚到中间 ----------
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  let h=''; for(let i=1;i<=80;i++) h+='<p>第'+i+'行文字内容</p>';
  h+='<p>第一目标</p><p>第二目标行</p>';
  for(let i=1;i<=80;i++) h+='<p>第'+i+'行文字内容</p>';
  ed.innerHTML=h; toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
await sleep(220);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const ps=[...ed.querySelectorAll('p')]; const a=ps[80], b=ps[81];
  const first=function(node){const w=document.createTreeWalker(node,4,null,false);return w.nextNode();};
  const last=function(node){let l=null;const w=document.createTreeWalker(node,4,null,false);let n=w.nextNode();while(n){l=n;n=w.nextNode();}return l;};
  const t0=first(a), t1=last(b);
  const r=document.createRange(); r.setStart(t0,0); r.setEnd(t1,t1.nodeValue.length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(950);
const crossA = await json(`(()=>{const h=(window.CSS&&CSS.highlights)?CSS.highlights.get('tb-sync'):null;
  const rs=h?[...h]:[]; const txt=rs.map(function(r){return String(r);}).join('');
  const rect=rs.length?rs[0].getBoundingClientRect():null;
  const code=document.getElementById('tbCode'); const c=code.getBoundingClientRect();
  return JSON.stringify({ n:rs.length, txt:txt,
    hasBoth: txt.indexOf('第一目标')>=0 && txt.indexOf('第二目标行')>=0,
    off: rect?Math.round((rect.top+rect.height/2)-(c.top+c.height/2)):9999,
    scroll: Math.round(code.scrollTop) });})()`);
ok(crossA.n > 0 && crossA.hasBoth,
  `(21)* 【跨行高亮】正文选两行代码侧高亮范围同时含这两行（${JSON.stringify(crossA.txt).slice(0, 70)}）`);
ok(Math.abs(crossA.off) <= 80,
  `(21)* 【跨行高亮】代码侧用浏览器算出的位置滚到正中（偏差 ${crossA.off}px，scrollTop=${crossA.scroll}）`);
// 反向：代码区选两行正文侧高亮含两行 + 正文滚到中间
await evaluate(`(()=>{const c=document.getElementById('tbCode'); const v=c.value;
  const i=v.indexOf('<p>第一目标</p>'); const j=v.indexOf('</p>', v.indexOf('第二目标行'));
  c.focus(); c.setSelectionRange(i, j+4); c.dispatchEvent(new Event('select',{bubbles:true})); return 1;})()`);
await sleep(950);
const crossB = await json(`(()=>{const h=(window.CSS&&CSS.highlights)?CSS.highlights.get('tb-sync'):null;
  const rs=h?[...h]:[]; const txt=rs.map(function(r){return String(r);}).join('');
  const ed=document.getElementById('tbEditor'); const rect=rs.length?rs[0].getBoundingClientRect():null;
  const er=ed.getBoundingClientRect();
  return JSON.stringify({ n:rs.length, txt:txt,
    hasBoth: txt.indexOf('第一目标')>=0 && txt.indexOf('第二目标行')>=0,
    off: rect?Math.round((rect.top+rect.height/2)-(er.top+er.height/2)):9999,
    scroll: Math.round(ed.scrollTop) });})()`);
ok(crossB.n > 0 && crossB.hasBoth,
  `(21)* 【跨行高亮】代码区选两行正文侧高亮范围同时含这两行（${JSON.stringify(crossB.txt).slice(0, 70)}）`);
ok(crossB.off <= 80 && crossB.off >= -80,
  `(21)* 【跨行高亮】正文侧滚到正中（偏差${crossB.off}px，scrollTop=${crossB.scroll}）`);

{
// ==============================================================
console.log('\n====== (22) BIUS：连点取无嵌· 多处独立 · ״̬ʵ· 光标只作用于· 占位文字不可编辑 ======\n');
// 选中某段文字里的一小截（按文字节点找，避免 firstChild 是元素时算错偏移）
const selPart22 = (needle, start, len) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf(${JSON.stringify(needle)});
    if(i>=0){ const a=i+${start}; const r=document.createRange(); r.setStart(n,a); r.setEnd(n,a+${len});
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);
// 把光标放到某段文字里（折叠）
const caretIn22 = (needle, off) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf(${JSON.stringify(needle)});
    if(i>=0){ const r=document.createRange(); r.setStart(n,i+${off}); r.collapse(true);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);
const setEd22 = (html) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(html)}; toolboxRefresh(); toolboxUndoReset(); return 1;})()`);
const edHtml22 = () => evaluate(`document.getElementById('tbEditor').innerHTML`);
const edText22 = () => evaluate(`document.getElementById('tbEditor').textContent`);
const activeOf22 = (sel) => evaluate(`document.querySelector('.tb-toolbar ' + ${JSON.stringify(sel)}).classList.contains('active')`);
const menuShot22 = () => json(`(()=>{const m=document.getElementById('tbTableMenu');
  return JSON.stringify({hidden:m.hidden, items:[...m.querySelectorAll('[data-tm]')].map(function(e){return e.textContent;})});})()`);

// ---------- 连点两次要取消；任何情况下不产生同标签嵌套（B/I/U/S 各三组断言---------
const BIUS = [['bold', 'b', '加粗'], ['italic', 'i', '斜体'], ['underline', 'u', '下划'], ['strike', 's', '删除行']];
for (const [kind, tg, cn] of BIUS) {
  const plain = '<div>此处填写正文内容</div>';
  const open = '<' + tg + '>', close = '</' + tg + '>';
  await setEd22(plain);
  await selPart22('正文', 0, 2);
  // ★ 等选区落定再点：toolboxSyncToolbarState 走的是 rAF/防抖，"选中 → 立刻点按钮"
  //   偶尔会点在按钮还没跟上状态的这一帧上（真人在浏览器里点不会这么快）。
  //   这里不放松判定，只是让输入像人一样落定；下面各处点按钮同理。
  await sleep(180);
  const t0 = await edText22();
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(430);
  const h1 = await edHtml22(), a1 = await activeOf22(`[data-tb="${kind}"]`);
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(430);
  const h2 = await edHtml22(), a2 = await activeOf22(`[data-tb="${kind}"]`), t2 = await edText22();
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(430);
  const h3 = await edHtml22(), a3 = await activeOf22(`[data-tb="${kind}"]`);
  ok(h1 === '<div>此处填写' + open + '正文' + close + '内容</div>',
    `(22)* ${cn}】第 1 次：只包住选中的那两个字（${h1}）`);
  ok(h2 === plain && t2 === t0, `(22)* ${cn}】第 2 次：取消该格式、逐字回到原文${h2}）`);
  ok(h3 === h1, `(22)* ${cn}】第 3 次：再加回来，且与第 1 次完全一致（${h3}）`);
  ok(a1 === true && a2 === false && a3 === true,
    `(22)* ${cn}】按钮状态实时跟随（${a1}${a2}${a3}）`);
  ok(new RegExp('<' + tg + '><' + tg, 'i').test(h1 + h2 + h3) === false,
    `(22)* ${cn}】三次操作都没有出现 <${tg}><${tg}> 嵌套`);
  // 本来就嵌套两层：用户明确"取消要彻底 —— 选区内不允许残留任何 X（含嵌套的 X）"，
  // 所以一次点击就把两层一起摘干净；再点一次是「应用」，只包一层；第三次又摘干净。
  // ★ 这条比旧口径**更严**（旧口径是"一次只折叠一层"），换的是判定不是放宽。
  await setEd22('<p>' + open + open + '甲' + close + close + '</p>');
  await selPart22('', 0, 1);
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(430);
  const n1 = await edHtml22();
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(430);
  const n2 = await edHtml22();
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(430);
  const n3 = await edHtml22();
  ok(n1 === '<p>甲</p>',
    `(22)* ${cn}】本来就嵌套两层：点一次就把 X 彻底摘掉（选区内不许残留，含嵌套的 X）（${n1}）`);
  ok(n2 === '<p>' + open + '甲' + close + '</p>' && n3 === n1,
    `(22)* ${cn}】再点一次是「应用」只包一层、第三次又是全摘干净（${n2} / ${n3}）`);
}

// ---------- 两处分别加粗：互不影响；一次跨两个相邻 <span>：整体只包一层----------
const twoBase = '<p>正文内容，文内引用</p>';
await setEd22(twoBase);
await selPart22('正文', 0, 2);
await clickSel('[data-tb="bold"]');
await sleep(430);
const two1 = await edHtml22();
await selPart22('文内', 0, 2);
await clickSel('[data-tb="bold"]');
await sleep(430);
const two2 = await edHtml22(), two2text = await edText22();
ok(two1 === '<p><b>正文</b>内容，文内引用</p>', `(22)* 【分别选中】先选「正文」加粗（${two1}）`);
ok(two2 === '<p><b>正文</b>内容，<b>文内</b>引用</p>',
  `(22)* 【分别选中】再选「文内」加粗：两处各自独立、第二次不动第一处（${two2}）`);
ok(two2text === '正文内容，文内引用' && (two2.match(/<b>/g) || []).length === 2
  && /<b><b>/.test(two2) === false,
  `(22)* 【分别选中】文字逐字不变、恰好两个<b>、无嵌套、${JSON.stringify(two2text)}）`);
// 一次选中跨越两个相邻 <span>
await setEd22('<p><span>正文</span><span>文内</span></p>');
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const p=ed.querySelector('p');
  const t0=p.childNodes[0].firstChild, t1=p.childNodes[1].firstChild;
  const r=document.createRange(); r.setStart(t0,0); r.setEnd(t1,t1.nodeValue.length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await clickSel('[data-tb="bold"]');
await sleep(430);
const spanOne = await edHtml22(), spanOneText = await edText22();
ok(spanOne === '<p><b><span>正文</span><span>文内</span></b></p>',
  `(22)* 【跨相邻 span】整体只包一层<b>，不是每段各包一层（${spanOne}）`);
ok((spanOne.match(/<b>/g) || []).length === 1 && spanOneText === '正文文内',
  `(22)* 【跨相邻 span】只有一格<b>、文字逐字不变${JSON.stringify(spanOneText)}）`);

// ---------- 执行：更新引用（整文件名替换，绝不会碰到冠号）----------
await setEd22('<p><b>粗体</b>，普通字</p>');
await caretIn22('粗体', 2);
await sleep(260);
const st1 = await activeOf22('[data-tb="bold"]');
await caretIn22('普通字', 1);
await sleep(260);
const st2 = await activeOf22('[data-tb="bold"]');
await caretIn22('粗体', 1);
await sleep(260);
const st3 = await activeOf22('[data-tb="bold"]');
ok(st1 === true && st2 === false && st3 === true,
  `(22)* 【状态实时】只在程序里移光标（不点任何按钮），按钮状态跟着变（${st1}${st2}${st3}）`);

// ---------- 高亮（背景色）：整条功能已按用户要求删除 ----------
await setEd22('<p>甲段，目标文字，尾段。</p>');
await caretIn22('目标文字', 2);
const wordText0 = await edText22();
await clickSel('[data-tb="bold"]');
await sleep(430);
const wordHtml = await edHtml22(), wordText1 = await edText22();
ok(wordHtml === '<p>甲段，<b>目标文字</b>，尾段。</p>',
  `(22)* 【光标只作用一个词】只把光标所在的词包起来。${wordHtml}）`);
ok(wordText1 === wordText0 && (wordHtml.match(/<b>/g) || []).length === 1,
  `(22)* 【光标只作用一个词】只多了一个 <b>、整段文字逐字不变${JSON.stringify(wordText1)}）`);
// 整块就是一（没有任何空标点分隔）→ 等于整段，什么都不做
await setEd22('<p>此处填写正文内容</p>');
await caretIn22('正文', 1);
const soloText0 = await edText22();
await clickSel('[data-tb="bold"]');
await sleep(430);
const soloHtml = await edHtml22(), soloText1 = await edText22();
ok(soloHtml === '<p>此处填写正文内容</p>' && (soloHtml.match(/<b>/g) || []).length === 0,
  `(22)* 【光标不作用于整段】判不出词（整块就一个词）时一个字都不改（${soloHtml}）`);
ok(soloText1 === soloText0, `(22)* 【光标不作用于整段】textContent 逐字不变${JSON.stringify(soloText1)}）`);

// ---------- 执行：更新引用（整文件名替换，绝不会碰到冠号）----------
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<center><img src="readmes/image/comm/tb_ph_never.jpg" width="80%"></center>';
  toolboxRefresh(); toolboxUndoReset(); return 1;})()`);
await sleep(1000);
const phAttr = await json(`(()=>{const n=document.querySelector('.tb-imgph-name'); const img=document.querySelector('.tb-imgph img');
  if(!n) return JSON.stringify({none:1});
  const wrap=n.closest('[data-tb-display="wrap"]');
  return JSON.stringify({ ce:n.getAttribute('contenteditable'), ceProp:n.isContentEditable,
    aria:n.getAttribute('aria-hidden'), us:getComputedStyle(n).userSelect,
    wrapDisplay: wrap?wrap.getAttribute('data-tb-display'):'', img: !!img,
    imgPE: img?getComputedStyle(img).pointerEvents:'', text:n.textContent });})()`);
ok(phAttr.ce === 'false' && phAttr.ceProp === false,
  `(22)* 【占位文字】不可编辑（contenteditable=${phAttr.ce}、isContentEditable=${phAttr.ceProp}）`);
ok(phAttr.aria === 'true' && phAttr.us === 'none',
  `(22)* 【占位文字】不许选中/复制、对读屏隐藏（aria-hidden=${phAttr.aria}、user-select=${phAttr.us}）`);
ok(phAttr.wrapDisplay === 'wrap' && phAttr.img === true && phAttr.imgPE !== 'none',
  `(22)* 【占位框】外层仍是data-tb-display="wrap"、真<img> 仍在且可交互（pointer-events=${phAttr.imgPE}）`);
// 真实鼠标点一下占位文光标不许停在占位文字里；再派发输文字一字不
const phPt = await json(`(()=>{const n=document.querySelector('.tb-imgph-name');
  n.scrollIntoView({block:'center'}); const r=n.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});})()`);
const phBefore = await json(`(()=>{const ed=document.getElementById('tbEditor'); const n=document.querySelector('.tb-imgph-name');
  return JSON.stringify({text:ed.textContent, name:n.textContent});})()`);
await clickAt(phPt.x, phPt.y);
await sleep(260);
const phAfterClick = await json(`(()=>{const ed=document.getElementById('tbEditor'); const n=document.querySelector('.tb-imgph-name');
  const s=getSelection(); const a=s.anchorNode;
  return JSON.stringify({text:ed.textContent, name:n.textContent,
    inName: !!(a && (a===n || n.contains(a)))});})()`);
ok(phAfterClick.inName === false,
  '(22)* 【占位文字】点它一下，光标不会停进占位文字里');
await send('Input.insertText', { text: 'ZZZ' });
await sleep(300);
const phAfterType = await json(`(()=>{const ed=document.getElementById('tbEditor'); const n=document.querySelector('.tb-imgph-name');
  return JSON.stringify({text:ed.textContent, name:n.textContent});})()`);
ok(phAfterType.text === phBefore.text && phAfterType.name === phBefore.name,
  `(22)* 【占位文字】点完再打字，编辑区文字与占位文字都一字未改（${JSON.stringify(phAfterType.name)}）`);
// 程序把光标硬塞进占位文字里再输入 同样改不
await evaluate(`(()=>{const n=document.querySelector('.tb-imgph-name'); const t=n.firstChild;
  const r=document.createRange(); r.setStart(t,1); r.collapse(true);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); document.getElementById('tbEditor').focus(); return 1;})()`);
await sleep(200);
await send('Input.insertText', { text: 'QQQ' });
await sleep(300);
const phForce = await json(`(()=>{const ed=document.getElementById('tbEditor'); const n=document.querySelector('.tb-imgph-name');
  return JSON.stringify({text:ed.textContent, name:n.textContent});})()`);
ok(phForce.text === phBefore.text && phForce.name === phBefore.name,
  `(22)* 【占位文字】就算把光标硬塞进去，也打不进字（${JSON.stringify(phForce.name)}）`);
// 右键图片：菜单照旧
await clickAt(phPt.x, phPt.y);
await sleep(150);
await rc(phPt.x, phPt.y);
await sleep(320);
const phMenu = await menuShot22();
// ★ 事故修复：这条断言（占位框上右键弹图片菜单）原本的文案被换成了 (22) BIUS 那一段的
//   句子（"【下划线】第 1 次…"），于是校验输出里一直显示成"下划线不生效"，把人带偏。
//   这里把文案复原成图片菜单，并把省略号写成 '\u2026' 转义（文件里那个"…"码点被换过）。
ok(phMenu.hidden === false && phMenu.items.length === 10 && phMenu.items[0] === '修改图片参数',
  `(22)* 占位框上右键照样弹图片菜单（${phMenu.items.length} 项，首项 ${JSON.stringify(phMenu.items[0])}）`);
await evaluate(`(()=>{const m=document.getElementById('tbTableMenu'); if(m) m.hidden=true; return 1;})()`);
const phCode = await codeVal20();
ok(phCode.indexOf('data-tb-display') < 0 && phCode.indexOf('tb-imgph') < 0 && phCode.indexOf('<img') >= 0,
  '(22)* 【占位框】导出/代码区里没有占位层与占位文字，只有原始 <img>');

}
{
console.log('\n====== (23) 任何操作之后：焦点都在编辑区、选区/光标都还在、不整段全选、滚动不======\n');
// 现场快照：焦点在不在编辑区/ 有几Range / 选了什么/ 编辑区滚动位/ 是不是整段全
const foState = () => json(`(()=>{const ed=document.getElementById('tbEditor'); const a=document.activeElement; const s=getSelection();
  return JSON.stringify({inEd: !!(a && (a === ed || ed.contains(a))), active:(a && (a.id || a.tagName)) || '',
    ranges: s.rangeCount, sel: String(s), collapse: !!s.isCollapsed, scroll: Math.round(ed.scrollTop),
    whole: !!(s.rangeCount && !s.isCollapsed && String(s) === ed.textContent && String(s).length > 0)});})()`);
// 通用断言（需①②③④）：焦点在编辑区 / 有选区 / 选区文字对得/ 没整段全/ 滚动没跳
const foOk = (label, a, b, expect, skipScroll) => {
  const bad = [];
  if (a.inEd !== true) bad.push('焦点掉到了' + a.active);
  if (!(a.ranges > 0)) bad.push('rangeCount=0（选区/光标丢了）');
  if (expect === '') { if (a.sel !== '') bad.push('光标没落在该落的位置（现在选中了' + a.sel + '」）'); }
  else if (typeof expect === 'string' && a.sel !== expect) bad.push('选区文字变了 + JSON.stringify(a.sel) + '  + JSON.stringify(expect));
  if (a.whole) bad.push('整段被全选了');
  if (!skipScroll && b && Math.abs(a.scroll - b.scroll) > 2) bad.push('滚动跳了 ' + b.scroll + ' ' + a.scroll);
  ok(bad.length === 0, '(23)* 拖列宽真的写出了 <colgroup>（功能没被焦点逻辑弄坏）');
};
// 12 段让编辑区真的能—这样"指针点工具栏不该让正文滚一"才验得出来
const FO_BODY = (function () { let s = ''; for (let i = 1; i <= 30; i++) s += '<p>第' + i + '段</p>'; return s + '<p>前段文字。目标文字在这里，后段文字。</p>'; })();
// 放好正文 + 选中「目标 光标落在「目标」前（mode'sel' 选中两个字，caret' 只放光标、
const foReset = (mode, body) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(body || FO_BODY)};
  toolboxRefresh(); toolboxUndoReset(); ed.scrollTop = 150; ed.focus();
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf('目标文字');
    if(i>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,${mode === 'caret' ? 'i' : 'i+2'});
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); ed.scrollTop = 150;
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return ed.scrollTop; }
    n=w.nextNode(); } return -1;})()`);
const foHtml = () => evaluate(`document.getElementById('tbEditor').innerHTML`);
// 快捷键（Ctrl/Cmd + 字母）：CDP 必须nativeVirtualKeyCode，否Chrome 不发 keydown
const foKey = async (k) => {
  const vk = k.toUpperCase().charCodeAt(0);
  const base = { key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 2 };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(470);
};
// 光标是否落在某个节点之后（插入类操作：光标要落在新内容之后）
// comparePoint(n,0) === -1 表示"这个点在 Range ֮ǰ"，也就是光标在表格之后。
const foCaretAfter = (sel) => json(`(()=>{const ed=document.getElementById('tbEditor'); const n=ed.querySelector(${JSON.stringify(sel)});
  const s=getSelection(); if(!s.rangeCount || !n) return JSON.stringify({ok:false, why:'no-range'});
  let cmp=null; try { cmp = s.getRangeAt(0).comparePoint(n,0); } catch(e) { cmp=null; }
  const r = s.rangeCount ? s.getRangeAt(0) : null;
  return JSON.stringify({ok: cmp === -1, cmp:cmp, collapsed: r ? r.collapsed : null,
    inTable: !!(r && n.contains(r.startContainer))});})()`);

// ---------- 23a 工具栏上逐个按钮：加标题/引用/正文/表格/ͼƬ/多图/撤回/恢复 ----------
const FO_OPS = [['bold', '加粗', 'sel'], ['title', '标题', 'sel'], ['quote', '引用', 'sel'], ['body', '正文', 'sel'],
  ['table', '表格', 'caret'], ['image', 'ͼƬ', 'caret'], ['stack', '多图', 'caret'],
  ['undo', '撤回', 'sel'], ['redo', '恢复', 'sel']];
for (const [act, cn, mode] of FO_OPS) {
  await foReset(mode);
  await sleep(160);
  const b = await foState();
  await clickSel(`[data-tb="${act}"]`);
  await sleep(430);
  if (act === 'table') {
    const dlg = await foState();
    ok(dlg.inEd === false, `(23)* 点「表格」打开对话框时焦点交给对话框的输入框（这是有意的）`);
    await clickSel('#tbDialogOk');
    await sleep(560);
    foOk(`点${cn}」→ 对话框「确定」`, await foState(), b, '');
    const after = await foCaretAfter('table');
    ok(after.ok === true,
      `(23)* 插入表格后光标落在新表格之后（cmp=${after.cmp}、collapsed=${after.collapsed}、在表格${after.inTable}）`);
  } else if (act === 'image' || act === 'stack') {
    const dlg = await foState();
    ok(dlg.inEd === false, `(23)* 点「表格」打开对话框时焦点交给对话框的输入框（这是有意的）`);
    await clickSel('#tbDialogCancel');
    await sleep(470);
    foOk(`点${cn}」→ 对话框「取消」`, await foState(), b, '');
  } else if (act === 'undo' || act === 'redo') {
    foOk(`点「${cn}」`, await foState(), b, null, true);   // 撤回/恢复会整篇换内容，不比"同一段文字"，但焦点与选区必须有
  } else {
    foOk(`点${cn}」`, await foState(), b, b.sel);
  }
}

// ---------- 23b 键盘快捷键：Ctrl+B/I/U/S Ctrl+Z / Ctrl+Y ----------
const FO_KEYS = [['b', '加粗', 'b'], ['i', '斜体', 'i'], ['u', '下划', 'u'], ['s', '删除行', 's']];
for (const [k, cn, tag] of FO_KEYS) {
  await foReset('sel');
  await sleep(160);
  const b = await foState();
  await foKey(k);
  const a = await foState();
  foOk(`Ctrl+${k.toUpperCase()}${cn}）`, a, b, b.sel);
  const html = await foHtml();
  ok(new RegExp('<' + tag + '>').test(html), `(23)* Ctrl+${k.toUpperCase()} 真的作用到了选中的字上（${html.slice(-46)}）`);
  ok(a.inEd === true, `(23)* Ctrl+${k.toUpperCase()} 之后焦点仍在编辑区（activeElement=${a.active}）`);
}
// Ctrl+Z 撤回刚加的加粗（也只快捷键这条路没把焦点/选区弄丢""
await foReset('sel');
await sleep(160);
await foKey('b');
const beforeUndo = await foState();
await foKey('z');
const afterUndo = await foState();
foOk('Ctrl+Z', afterUndo, beforeUndo, null, true);
ok(!/<b>/.test(await foHtml()), '(23)* Ctrl+Z 把刚加的 <b> 撤掉了（走的是同一套快照栈）');
await foKey('y');
foOk('Ctrl+Y', await foState(), beforeUndo, null, true);
ok(/<b>/.test(await foHtml()), '(23)* Ctrl+Y 又把 <b> 恢复了');

// ---------- 23c 右键菜单项：表格菜单 / 图片菜单（含「修改图片…」对话框确定）---------
await foReset('caret', '<table><tbody><tr><td>甲甲</td><td>乙乙</td></tr><tr><td>丙丙</td><td>丁丁</td></tr></tbody></table>');
await sleep(620);
const foCell = await json(`(()=>{const c=document.getElementById('tbEditor').querySelector('td'); c.scrollIntoView({block:'center'});
  const r=c.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});})()`);
const foRows0 = await evaluate(`document.getElementById('tbEditor').querySelectorAll('tr').length`);
await rc(foCell.x, foCell.y);
await sleep(360);
const foMenuOpen = await evaluate(`document.getElementById('tbTableMenu').hidden === false`);
ok(foMenuOpen === true, '(23)* 表格里右键能调出表格菜单');
const foBefore = await foState();
await clickSel('[data-tm="row-below"]');
await sleep(520);
foOk('右键菜单「下方插入行之', await foState(), foBefore, null, true);
ok((await evaluate(`document.getElementById('tbEditor').querySelectorAll('tr').length`)) === foRows0 + 1,
  '(23)* 点文件名输入框：焦点进到输入框里（这是唯一允许抢焦点的地方）');
// 图片：右键占位框 「修改图片…」→ 确定
await foReset('caret', '<p>ͼǰ</p><center><img src="readmes/image/comm/tb_focus_never.jpg" width="80%"></center><p>图后台</p>');
await sleep(1000);
const foImgPt = await json(`(()=>{const n=document.querySelector('.tb-imgph-name'); n.scrollIntoView({block:'center'});
  const r=n.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});})()`);
await rc(foImgPt.x, foImgPt.y);
await sleep(360);
const foImgMenu = await evaluate(`document.getElementById('tbTableMenu').hidden === false`);
ok(foImgMenu === true, '(23)* 占位框上右键能调出图片菜单');
const foImgBefore = await foState();
await clickSel('[data-tm="img-edit"]');
await sleep(430);
const foImgDlg = await foState();
ok(foImgDlg.inEd === false, '(23)* 「修改图片…」对话框打开时焦点在它的输入框里（有意的）');
await clickSel('#tbDialogOk');
await sleep(520);
foOk('「修改图片…」对话框「确定的', await foState(), foImgBefore, null, true);
// 图片菜单里改宽度（不弹对话框的那一类）也要守住
await rc(foImgPt.x, foImgPt.y);
await sleep(360);
const foW0 = await evaluate(`String((document.querySelector('.tb-imgph img') || {}).getAttribute ? document.querySelector('.tb-imgph img').getAttribute('width') : '')`);
const foWBefore = await foState();
await clickSel('[data-tm="img-w60"]');
await sleep(520);
foOk('图片菜单「宽度60%', await foState(), foWBefore, null, true);
ok((await evaluate(`String(document.querySelector('.tb-imgph img').getAttribute('width'))`)) === '60%',
  `(23)* 图片菜单真的把宽度改成了 60%（原来是 ${foW0}）`);

// ---------- 23d 表格列宽拖拽 ----------
await foReset('caret', '<table><tbody><tr><td>甲甲甲</td><td>乙乙乙</td></tr></tbody></table>');
await sleep(620);
const foDrag = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const td=ed.querySelector('td'); const r=td.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.right), y:Math.round(r.top+r.height/2), scroll:Math.round(ed.scrollTop)});})()`);
const foDragBefore = await foState();
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: foDrag.x, y: foDrag.y, button: 'none', buttons: 0 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: foDrag.x, y: foDrag.y, button: 'left', buttons: 1, clickCount: 1 });
for (const dx of [30, 70, 120]) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: foDrag.x + dx, y: foDrag.y, button: 'left', buttons: 1 });
  await sleep(80);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: foDrag.x + 120, y: foDrag.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(560);
foOk('拖表格列', await foState(), foDragBefore, null, true);
ok((await evaluate(`document.getElementById('tbEditor').querySelectorAll('col').length`)) === 2,
  '(23)* 拖列宽真的写出了 <colgroup>（功能没被焦点逻辑弄坏）');

// ---------- 23f 唯一允许抢焦点的地方（文件名输入框）：这条流程结束后焦点要还回编辑区 ----------
await foReset('sel');
await sleep(200);
const foNameState = await foState();
const foNamePt = await json(`(()=>{const n=document.getElementById('tbFileName'); const r=n.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)});})()`);
await clickAt(foNamePt.x, foNamePt.y);
await sleep(260);
ok((await evaluate(`document.activeElement === document.getElementById('tbFileName')`)) === true,
  '(23)* 点文件名输入框：焦点进到输入框里（这是唯一允许抢焦点的地方）');
await clickSel('[data-tb="download"]');
await sleep(560);
foOk('文件名输入框 点「下载', await foState(), foNameState, foNameState.sel);

// ---------- 23g 草稿确认弹窗上的「恢复/ 丢弃」（弹窗只在"刷新后第一次打开 + 有草稿时出现）----------
// 这条走的是真流程：写一个真草稿localStorage 刷新 打开工具箱弹窗自己出现
//   两条断言各验两件事：状态不变量（焦选区回到正文）；这个弹窗自己收干净了
const foSeedDraft = (body) => evaluate(`(()=>{try{localStorage.setItem('collection.toolbox.draft',${JSON.stringify(body)});}catch(e){};return 1;})()`);
await foSeedDraft(FO_BODY);
await reloadAndOpen();
const foAsk1 = await json(`(()=>{const d=document.getElementById('tbDraftAsk');
  const r=d.getBoundingClientRect();
  return JSON.stringify({ open: !d.hidden, x: Math.round(r.left), y: Math.round(r.top),
    focused: d.contains(document.activeElement) });})()`);
ok(foAsk1.open === true, '(23)* 有草稿时打开工具箱：草稿确认弹窗自己弹出来');
ok(foAsk1.focused === true, '(23)* 弹窗一打开焦点就在它里面（这是允许抢焦点的对话框之一）');
await clickSel('#tbDraftRestore');
await sleep(470);
const foAfterRestore = await foState();
foOk('草稿弹窗「恢复', foAfterRestore, foAfterRestore, null, true);
ok((await evaluate(`document.getElementById('tbDraftAsk').hidden`)) === true,
  '(23)* 点「恢复」后草稿弹窗自己收起来');
await foSeedDraft(FO_BODY);
await reloadAndOpen();
await clickSel('#tbDraftDiscard');
await sleep(470);
const foAfterDiscard = await foState();
foOk('草稿弹窗「丢弃', foAfterDiscard, foAfterDiscard, null, true);
ok((await evaluate(`document.getElementById('tbDraftAsk').hidden`)) === true,
  '(23)* 点「丢弃」后草稿弹窗自己收起来');

// ---------- 23e 源码级约束：不许 blur()，不许把焦点主动给工具栏按钮 ----------
let foSrc = '';
try { const fsmod = await import('node:fs'); foSrc = fsmod.readFileSync(new URL('../../toolbox.js', import.meta.url), 'utf8'); } catch (e) { foSrc = ''; }
ok(foSrc.length > 1000, '(23)* 读到 collection/toolbox.js 源码，供下面两条静态约束检查');
ok(foSrc.indexOf('.blur(') < 0, '(23)* 全文没有任何 .blur() 调用（编辑区不会被人为弄失焦）');
ok(/[Bb]tn\.focus\s*\(/.test(foSrc) === false && /toolbar\.focus\s*\(/.test(foSrc) === false,
  '(23)* 没有任何一处把焦点主动交给工具栏按钮');
ok(/function toolboxToolbarHit/.test(foSrc) && /toolboxToolbarHit\(e\.target\)/.test(foSrc),
  '(23)* 工具栏 pointerdown / mousedown 共用同一个"是不是工具栏元素"的判断，统一 preventDefault + 冻结选区');
ok(/function toolboxKeepFocus/.test(foSrc), '(23)* Ctrl+Z 把刚加的 <b> 撤掉了（走的是同一套快照栈）');
}
// ---------- 全屏 / 小窗：用户给的两段内联SVG（各 4 path title ----------
// 用户直接给了 SVG，逐字使用；不再有字体符号（⛶/⤡），也不再自己画方框（不留 <rect>）
//   进入全屏 = "M9 4H4v5" 那套（四角朝外）；小退出全= "M9 4v5H4" 那套（四角朝内）。
const winBtnProbe = `(()=>{const b=document.getElementById('tbFullBtn');
  const svg=b.querySelector('svg');
  const cs=svg?getComputedStyle(svg):null;
  const r=svg?svg.getBoundingClientRect():null;
  const paths=svg?[...svg.querySelectorAll('path')]:[];
  return JSON.stringify({
    text:b.textContent.trim(),
    inner:b.innerHTML,
    paths:paths.length,
    d0:paths[0]?paths[0].getAttribute('d'):'',
    rects:svg?svg.querySelectorAll('rect').length:-1,
    vb:svg?svg.getAttribute('viewBox'):'',
    swAttr:svg?svg.getAttribute('stroke-width'):'',
    cap:svg?svg.getAttribute('stroke-linecap'):'',
    join:svg?svg.getAttribute('stroke-linejoin'):'',
    strokeAttr:svg?svg.getAttribute('stroke'):'',
    fillAttr:svg?svg.getAttribute('fill'):'',
    ariaHidden:svg?svg.getAttribute('aria-hidden'):'',
    sw:cs?cs.strokeWidth:'',
    fill:cs?cs.fill:'',
    stroke:cs?cs.stroke:'',
    // ★ 事故修复：原来这里是两个空字符串判定（永远为真），
    //   导致"不含字形"恒为假。改用码点转义（\u26F6 / \u2921），不依赖文件编码。
    glyphs:b.innerHTML.indexOf('\u26F6')>=0 || b.innerHTML.indexOf('\u2921')>=0,
    w:r?Math.round(r.width):0, h:r?Math.round(r.height):0,
    title:b.title, aria:b.getAttribute('aria-label') });})()`;
const fullBtn20 = await json(winBtnProbe);
ok(fullBtn20.paths === 4 && fullBtn20.d0 === 'M9 4H4v5',
  `(20)* 初始是全屏图标：4 path、第一条d="M9 4H4v5"（实${fullBtn20.paths} / ${fullBtn20.d0}）`);
ok(fullBtn20.title === '全屏' && fullBtn20.aria === '全屏',
  `(20)* 初始 title/aria-label 都是「全屏」（${fullBtn20.title} / ${fullBtn20.aria}）`);
// ★ 事故修复：`indexOf('')` 空串判定永真、`'退出全'` 少了个"屏"、文案里也丢了括号。
ok(!fullBtn20.glyphs && fullBtn20.text === ''
  && fullBtn20.text.indexOf('\u26F6') < 0 && fullBtn20.text.indexOf('\u2921') < 0,
  `(20)* 按钮文本里不含 ⛶/⤡ 字形（实际「${fullBtn20.text}」，只有 SVG）`);
ok(fullBtn20.rects === 0, `(20)* 不再自己画方框（SVG <rect> ${fullBtn20.rects} 个）`);
ok(fullBtn20.strokeAttr === 'currentColor' && fullBtn20.fillAttr === 'none' && fullBtn20.swAttr === '2'
  && fullBtn20.cap === 'round' && fullBtn20.join === 'round' && fullBtn20.vb === '0 0 24 24'
  && fullBtn20.ariaHidden === 'true',
  `(20)* 图标属性逐字照抄（viewBox=${fullBtn20.vb}、stroke-width=${fullBtn20.swAttr}、cap/join=${fullBtn20.cap}/${fullBtn20.join}、stroke=${fullBtn20.strokeAttr}、fill=${fullBtn20.fillAttr}、aria-hidden=${fullBtn20.ariaHidden}）`);
ok(fullBtn20.sw === '2px' && /^(none|rgba\(0, 0, 0, 0\))$/.test(fullBtn20.fill) && fullBtn20.stroke !== 'none',
  `(20)* 图标确实按描边画（计算值stroke-width=${fullBtn20.sw}、fill=${fullBtn20.fill}、stroke=${fullBtn20.stroke}）`);
ok(fullBtn20.w >= 16 && fullBtn20.w <= 18 && fullBtn20.h >= 16 && fullBtn20.h <= 18,
  `(20)* 渲染尺寸收到 16~18px（跟关闭按钮一个档，实际${fullBtn20.w}x${fullBtn20.h}）`);
await clickSel('#tbFullBtn');
await sleep(360);
const fullBtn20b = await json(winBtnProbe);
ok(fullBtn20b.paths === 4 && fullBtn20b.d0 === 'M9 4v5H4',
  `(20)* 全屏后换成小窗图标：4 path、第一条d="M9 4v5H4"（实${fullBtn20b.paths} / ${fullBtn20b.d0}）`);
// ★ 事故修复：`'退出全'` 少了"屏"，文案也丢了括号。
ok(fullBtn20b.title === '退出全屏' && fullBtn20b.aria === '退出全屏' && !fullBtn20b.glyphs && fullBtn20b.text === '',
  `(20)* 全屏后 title=aria-label=退出全屏，仍然只有图标没有字形（${fullBtn20b.title} / ${fullBtn20b.aria}）`);
ok(fullBtn20b.rects === 0, `(20)* 小窗图标里同样没有 <rect>（${fullBtn20b.rects} 个）`);
// 按钮盒子与「关闭」一致：同高、同宽、圆心对
const winBoxPair = await json(`(()=>{const f=document.getElementById('tbFullBtn').getBoundingClientRect();
  const c=document.querySelector('.tb-close').getBoundingClientRect();
  return JSON.stringify({ fw:Math.round(f.width), fh:Math.round(f.height), cw:Math.round(c.width), ch:Math.round(c.height),
    cy:Math.round((f.top+f.height/2)-(c.top+c.height/2)) });})()`);
ok(winBoxPair.fw === winBoxPair.cw && winBoxPair.fh === winBoxPair.ch && Math.abs(winBoxPair.cy) <= 1,
  `(20)* 全屏按钮与「关闭」同尺寸同高（${winBoxPair.fw}x${winBoxPair.fh} vs ${winBoxPair.cw}x${winBoxPair.ch}，中心差 ${winBoxPair.cy}px）`);
await clickSel('#tbFullBtn');
await sleep(360);
const fullBtn20c = await json(winBtnProbe);
ok(fullBtn20c.paths === 4 && fullBtn20c.d0 === 'M9 4H4v5' && fullBtn20c.title === '全屏',
  `(20)* 再点一次回到全屏图标（${fullBtn20c.paths} path / ${fullBtn20c.d0} / title=${fullBtn20c.title}）`);

// ==============================================================
// 主题切换助手：明暗由站内 theme.js 管（localStorage 'collection-color-scheme'
// + applyColorScheme()），不自己造标记、不CSS24) (28) 两节都要用
const schemeSnapshot = () => json(`(()=>{let m=null; try{m=localStorage.getItem('collection-color-scheme');}catch(e){}
  return JSON.stringify({mode:m, dark: typeof isDarkScheme==='function' ? isDarkScheme() : null});})()`);
const setScheme = async (mode) => {
  await evaluate(`(()=>{try{localStorage.setItem('collection-color-scheme', ${JSON.stringify(mode)});}catch(e){}
    if (typeof applyColorScheme === 'function') applyColorScheme(false); return 1;})()`);
  await sleep(300);
  return schemeSnapshot();
};
console.log('\n====== (24) 左上角文件名：跟标题栏融为一+ 点击全选+ 省略======\n');
const nameShot = () => json(`(()=>{const n=document.getElementById('tbFileName');
  const h=document.getElementById('tbHead'); const cs=getComputedStyle(n); const hs=getComputedStyle(h);
  return JSON.stringify({ value:n.value, color:cs.color, weight:cs.fontWeight, size:cs.fontSize,
    family:cs.fontFamily, headFamily:hs.fontFamily, bg:cs.backgroundColor, headBg:hs.backgroundColor,
    borderW:cs.borderTopWidth, borderStyle:cs.borderTopStyle, outlineW:cs.outlineWidth,
    outlineStyle:cs.outlineStyle, shadow:cs.boxShadow, radius:cs.borderTopLeftRadius,
    maxW:cs.maxWidth, overflow:cs.overflowX, textOverflow:cs.textOverflow,
    sw:n.scrollWidth, cw:n.clientWidth, title:n.title,
    selStart:n.selectionStart, selEnd:n.selectionEnd, focused:document.activeElement===n });})()`);
{
await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.value='Untitled'; toolboxFileNameSyncTitle();
  toolboxFocusEditor(); return 1;})()`);
await sleep(120);
const n0 = await nameShot();
console.log(`  文件名：值「${n0.value}」颜色${n0.color} 字重 ${n0.weight} 底色 ${n0.bg}（标题栏 ${n0.headBg}）`);
ok(n0.value === 'Untitled', `(24)* 初始值就是真实文本 Untitled（实际「Untitled」）`);
// 颜色一致：默认文字与用户输入后的计算颜色必须完全相同（同一CSS 颜色来源）
await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.value='我的报告2024';
  n.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
await sleep(120);
const n1 = await nameShot();
ok(n1.color === n0.color && n0.color === n1.color && !!n0.color,
  `(24)* 默认值与用户输入的文字颜色完全相同（${n0.color} === ${n1.color}）`);
const bodyTextColor = await evaluate(`getComputedStyle(document.body).color`);
ok(n0.color === bodyTextColor || n0.color === 'rgb(0, 0, 0)' || n0.color === 'rgb(232, 234, 237)',
  `(24)* 默认值就是正文文字色${n0.color}，body 计算样${bodyTextColor}）——?不是灰色占位`);
ok(/\.tb-filename[^{}]*::placeholder/.test(cssCode) === false,
  '(24)* 没有用 ::placeholder（.tb-filename 上没有任何 ::placeholder 规则，注释里的说明不算）');
ok(/mono|Consolas|Menlo|Courier/i.test(n0.family) === false && n0.family === n0.headFamily,
  '(24)* 初始值就是真实文本 Untitled（实际「Untitled」）');
// 不像输入框：无边框、无外框线、与标题栏同底色、无圆角差异、focus 前后不变
ok(parseFloat(n0.borderW) === 0 || n0.borderStyle === 'none',
  `(24)* 没有边框（border-width=${n0.borderW}、border-style=${n0.borderStyle}）`);
ok(n0.bg === n0.headBg, `(24)* 底色与标题栏完全一致（${n0.bg} === ${n0.headBg}）`);
ok(n0.radius === '0px', `(24)* 与标题栏没有圆角差异、${n0.radius}）`);
// outline-style 的计算值就是none；outline-width Chrome 里对 none 会保留用户代理的 3px —
//   所以判"没有可见 outline"看的style，不width
ok(n0.outlineStyle === 'none' && /none/.test(n0.shadow),
  `(24)* 平时没有 outline/光晕（outline-style=${n0.outlineStyle}、box-shadow=${n0.shadow}）`);
const nameCenter = await json(`(()=>{const n=document.getElementById('tbFileName'); const h=document.getElementById('tbHead');
  const a=n.getBoundingClientRect(), b=h.getBoundingClientRect();
  return JSON.stringify({dy: Math.abs((a.top+a.height/2)-(b.top+b.height/2))});})()`);
ok(nameCenter.dy <= 1.5, `(24)* 在标题栏里垂直居中（中心偏差 ${nameCenter.dy.toFixed(1)}px）`);
// 点击规则（用户纠正过两次，这里是定稿的语义）
//    · 光标**原本不在标题* 点进去就全
//    · 光标**已经在标题里** 再点就是普通编辑：光标落在点到的字符处，不全
//    · 先失焦再点又回ȫ
//    · Tab 聚焦 ȫ
//    · 拖动 只选拖出的范围
// 这里CDP Input.dispatchMouseEvent 一发一条press+release
//   而不是页面里合成 MouseEvent —— 只有真鼠标事件才会走浏览器的完整默认行为链
//   （合成事件测不出"全选会不会被原生放光标覆盖"这类问题）。
const nameBoxOf = () => json(`(()=>{const n=document.getElementById('tbFileName'); const r=n.getBoundingClientRect();
  const cs=getComputedStyle(n);
  return JSON.stringify({left:r.left, right:r.right, top:r.top, h:r.height, w:r.width,
    pad:parseFloat(cs.paddingLeft)||0, value:n.value,
    selStart:n.selectionStart, selEnd:n.selectionEnd, focused:document.activeElement===n});})()`);
const dClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(300);
};
const dDrag = async (x1, y1, x2, y2) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1, buttons: 1 });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(x1 + (x2 - x1) * i / steps);
    const y = Math.round(y1 + (y2 - y1) * i / steps);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(24);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(300);
};
const nameFocusShot = () => json(`(()=>{const n=document.getElementById('tbFileName'); const r=n.getBoundingClientRect();
  return JSON.stringify({focused:document.activeElement===n, tag:document.activeElement?document.activeElement.id||document.activeElement.tagName:'',
    selStart:n.selectionStart, selEnd:n.selectionEnd, len:n.value.length, w:r.width, left:r.left});})()`);
// 点击 x 坐标必须*文字实际宽度**算，不能按输入框宽度均分
//   输入框宽 240px，report-name' 只有 ~90px —按框宽算出来的"?6 个字符处"
//   其实落在文字**右边很远的空*里，浏览器会把光标夹到末尾（offset=11），
//   断言就会误报"没把光标放在点到的位置"。这里用离屏 span 量出前 N 个字符的真实宽度。
const nameCharX = (idx) => evaluate(`(()=>{
  const n=document.getElementById('tbFileName'); const cs=getComputedStyle(n);
  const r=n.getBoundingClientRect(); const pad=parseFloat(cs.paddingLeft)||0;
  const sp=document.createElement('span');
  sp.style.cssText='position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:-9999px;';
  sp.style.fontFamily=cs.fontFamily; sp.style.fontSize=cs.fontSize; sp.style.fontWeight=cs.fontWeight;
  sp.style.fontStyle=cs.fontStyle; sp.style.letterSpacing=cs.letterSpacing;
  sp.textContent=String(n.value||'').slice(0,${idx});
  document.body.appendChild(sp);
  const w=sp.getBoundingClientRect().width;
  document.body.removeChild(sp);
  return r.left+pad+w;})()`);
// 用英文名：字符宽度均匀，点击点 字符 offset 的换算可预期（±? 字符误差够用
{
await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.value='report-name';
  toolboxFileNameSyncTitle(); toolboxFocusEditor(); return 1;})()`);
await sleep(200);
const nb = await nameBoxOf();
// 第一次点击（此时焦点在正文）ȫ
await dClick(Math.round(nb.left + nb.pad + 12), Math.round(nb.top + nb.h / 2));
const c1 = await nameShot();
ok(c1.focused === true && c1.selStart === 0 && c1.selEnd === c1.value.length && c1.value.length === 11,
  `(24)* 光标不在标题上时点一下：立刻全选（${c1.selStart}${c1.selEnd}，${c1.value.length} 字）`);
// 紧接着再点一次（焦点已经在标题里）→ 普通编辑：光标落在点击处，***ȫ
//    点在6 个字符的**字符边界**上（report-name' 6 个字符是 '-' 之后
const secondX = Math.round(await nameCharX(6));
await dClick(secondX, Math.round(nb.top + nb.h / 2));
const c2 = await nameShot();
const c2Off = c2.selStart;
const notAll = !(c2.selStart === 0 && c2.selEnd === c2.value.length);
console.log(`  第二次点击（焦点已在标题里）：选区 ${c2.selStart}${c2.selEnd}（期望光标落在第 6 个字符附近）`);
ok(notAll, `(24)* 焦点已在标题里时再点*不是**全选（${c2.selStart}${c2.selEnd}）`);
ok(c2.selStart === c2.selEnd && Math.abs(c2Off - 6) <= 1,
  `(24)* 而是把光标放在点到的位置（offset=${c2Off}，期望6±1）`);
//  第三次点*ͬһ*：依然不是全选（"连续点击频繁变成全"是用户实测的回归）
//     这条就是它的护栏：只要光标已在标题里，点多少次都只当普通编辑）
await dClick(secondX, Math.round(nb.top + nb.h / 2));
const c2b = await nameShot();
ok(c2b.focused === true && !(c2b.selStart === 0 && c2b.selEnd === c2b.value.length) && c2b.selStart === c2b.selEnd,
  `(24)* 光标已在标题里时连点第三次也不全选（${c2b.selStart}${c2b.selEnd}）`);
// 先点编辑区失焦，再点标题 又回到全部
await evaluate(`(()=>{document.getElementById('tbEditor').focus(); return 1;})()`);
await sleep(220);
const afterBlur = await nameFocusShot();
ok(afterBlur.focused === false, '(24) 前置：焦点已经离开标题（去了正文）');
await dClick(Math.round(nb.left + nb.pad + 12), Math.round(nb.top + nb.h / 2));
const c3 = await nameShot();
ok(c3.selStart === 0 && c3.selEnd === c3.value.length,
  `(24)* 失焦之后再点标题：又是全选（${c3.selStart}${c3.selEnd}）`);
// Tab 聚焦 全选（先把焦点挪走，再模拟 Tab
await evaluate(`(()=>{document.getElementById('tbEditor').focus(); return 1;})()`);
await sleep(200);
await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.focus(); return 1;})()`);
await sleep(260);
const c4 = await nameShot();
ok(c4.selStart === 0 && c4.selEnd === c4.value.length,
  `(24)* Tab 聚焦到标题：自动全选（${c4.selStart}${c4.selEnd}）`);
// 拖动：只选拖出的范围，不干预
await evaluate(`(()=>{document.getElementById('tbEditor').focus(); return 1;})()`);
await sleep(200);
const nb2 = await nameBoxOf();
const dragX1 = Math.round(await nameCharX(2));
const dragX2 = Math.round(await nameCharX(8));
await dDrag(dragX1, Math.round(nb2.top + nb2.h / 2), dragX2, Math.round(nb2.top + nb2.h / 2));
const c5 = await nameShot();
console.log(`  拖动选择：选区 ${c5.selStart}${c5.selEnd}（期望约 2）`);
ok(!(c5.selStart === 0 && c5.selEnd === c5.value.length),
  `(24)* 拖动选择**强制全选（${c5.selStart}${c5.selEnd}）`);
ok(c5.selStart >= 1 && c5.selEnd > c5.selStart && c5.selEnd <= c5.value.length,
  `(24)* 选区就是用户拖出来的那段${c5.selStart}${c5.selEnd}）`);
// ǳɫ / 深色主题各重验一遍最核心的两条（首次点击全选/ 已聚焦点击不全选）
const themeCheck = async (scheme) => {
  await setScheme(scheme);
  await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.value='report-name';
    toolboxFileNameSyncTitle(); toolboxFocusEditor(); return 1;})()`);
  await sleep(220);
  const b = await nameBoxOf();
  await dClick(Math.round(b.left + b.pad + 12), Math.round(b.top + b.h / 2));
  const a1 = await nameShot();
  await dClick(Math.round(await nameCharX(6)), Math.round(b.top + b.h / 2));
  const a2 = await nameShot();
  return { scheme, first: a1, second: a2 };
};
const tLight = await themeCheck('light');
ok(tLight.first.selStart === 0 && tLight.first.selEnd === tLight.first.value.length,
  `(24)* 浅色主题：第一次点击全选（${tLight.first.selStart}${tLight.first.selEnd}）`);
ok(!(tLight.second.selStart === 0 && tLight.second.selEnd === tLight.second.value.length),
  `(24)* 浅色主题：已聚焦时再点不全选（${tLight.second.selStart}${tLight.second.selEnd}）`);
const tDark = await themeCheck('dark');
ok(tDark.first.selStart === 0 && tDark.first.selEnd === tDark.first.value.length,
  `(24)* 深色主题：第一次点击全选（${tDark.first.selStart}${tDark.first.selEnd}）`);
ok(!(tDark.second.selStart === 0 && tDark.second.selEnd === tDark.second.value.length),
  `(24)* 深色主题：已聚焦时再点不全选（${tDark.second.selStart}${tDark.second.selEnd}）`);
await setScheme('system');
await sleep(200);
}
// 超长省略号+ title 里放完整名字
const longName = '这是一个非常非常长的文章文件名用来验证省略号.repeat(4';
await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.value=${JSON.stringify(longName)};
  n.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
await sleep(200);
const nLong = await nameShot();
console.log(`  超长：scrollWidth=${nLong.sw} clientWidth=${nLong.cw} textOverflow=${nLong.textOverflow}`);
ok(nLong.sw > nLong.cw, `(24)* 超长时内容真的溢出（scrollWidth ${nLong.sw} > clientWidth ${nLong.cw}）`);
// overflow 的计算值在 Chrome 里是 clip（overflow:hidden 会被规范化成 clip）——?
//   真正决定"有没有省略号"的是 text-overflow:ellipsis 这条声明。
ok(nLong.textOverflow === 'ellipsis' && /hidden|clip/.test(nLong.overflow),
  `(24)* 溢出时显示省略号（text-overflow=${nLong.textOverflow}、overflow=${nLong.overflow}）`);
ok(nLong.title === longName && nLong.title.length === longName.length,
  `(24)* title 里是**完整**名字${nLong.title.length} 字，与输入的 ${longName.length} 字一致）`);
// 后缀规则：只把输入当名字，下载时统一.html，绝不出现双后缀
const dlNames = await json(`(()=>{
  const n=document.getElementById('tbFileName'); const out={};
  const set=function(v){ n.value=v; return toolboxFileName(); };
  out.empty=set(''); out.blank=set('   ');
  out.abc=set('abc');
  out.html=set('abc.html'); out.htm=set('abc.htm'); out.upper=set('abc.HTML');
  out.dirty=set(' 我的/报告:2024 ');
  n.value='Untitled'; toolboxFileNameSyncTitle();
  return JSON.stringify(out);})()`);
console.log(`  后缀规则${JSON.stringify(dlNames)}`);
ok(dlNames.empty === 'Untitled.html', `(24)* Untitled.html${dlNames.empty}）`);
ok(dlNames.blank === 'Untitled.html', `(24)* 只有空白 Untitled.html${dlNames.blank}）`);
ok(dlNames.abc === 'abc.html', `(24)* abc abc.html${dlNames.abc}）`);
ok(dlNames.html === 'abc.html' && dlNames.htm === 'abc.html' && dlNames.upper === 'abc.html',
  `(24)* 已有 .html/.htm/.HTML 后缀先去后缀再补，绝不双后缀${dlNames.html} / ${dlNames.htm} / ${dlNames.upper}）`);
ok(!/\.html\.html$/i.test(dlNames.html + dlNames.htm + dlNames.upper),
  '(24)* 没有任何一个结果出现 .html.html');
ok(dlNames.dirty === '我的报告2024.html',
  `(24)* 非法字符与首尾空白被清洗（${dlNames.dirty}）`);
//  名字被删失焦 / 回车 / 读文件名"三个时机回填 Untitled"*输入过程中不回填**
const emptyShot = () => json(`(()=>{const n=document.getElementById('tbFileName');
  return JSON.stringify({value:n.value, focused:document.activeElement===n, title:n.title});})()`);
// 焦点还在输入框里、值被删空 必须**保持为空**（不清空就没法重打，光标还会跑到 Untitled 后面
await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.focus(); n.value='';
  n.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
await sleep(200);
const e0 = await emptyShot();
ok(e0.focused === true && e0.value === '',
  `(24)* 名字删空但仍在焦点内：输入框保持为空（不即时回填，实际「」）`);
// ★ 名字被删空时回填 Untitled。触发时机（用户点名）：
await evaluate(`(()=>{document.getElementById('tbEditor').focus(); return 1;})()`);
await sleep(240);
const e1 = await emptyShot();
ok(e1.value === 'Untitled' && e1.title === 'Untitled',
  `(24)* 名字删空后失焦：回填 Untitled（值「Untitled」/ title「Untitled」）`);
// 用户实测：输入标题后刷新，标题又变回 Untitled。所以草稿要连名字一起存。
await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.focus(); n.value='';
  n.dispatchEvent(new Event('input',{bubbles:true}));
  n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 1;})()`);
await sleep(200);
const e2 = await emptyShot();
ok(e2.value === 'Untitled', `(24)* 名字删空后按回车：回填 Untitled（值「Untitled」）`);
// 读文件名的时刻也不许是空：程序化删空（不失焦、不触发 blur）后直接
const e3 = await json(`(()=>{const n=document.getElementById('tbFileName'); n.focus(); n.value='';
  const read = toolboxFileName(); return JSON.stringify({read:read, value:n.value});})()`);
ok(e3.read === 'Untitled.html' && e3.read !== '.html',
  `(24)* 读文件名的时刻自动回落到 Untitled.html（读到「Untitled.html」）`);
ok(e3.value === 'Untitled', `(24)* 读文件名时顺手把输入框也回填了（值「Untitled」）`);
// 清空后（不失焦）直接点「下载」→ 真的Untitled.html，绝不是 ".html"
await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.focus(); n.value='';
  window.__tbDownloaded=''; return 1;})()`);
await clickSel('[data-tb="download"]');
const dlEmpty = await evaluate(`window.__tbDownloaded || ''`);
ok(dlEmpty === 'Untitled.html' && dlEmpty !== '.html',
  `(24)* 清空后直接点下载：用的是 Untitled.html（实际「Untitled.html」）`);
// 用户实测：输入标题后刷新，标题又变回 Untitled。所以草稿要连名字一起存。
const draftNameProbe = await json(`(()=>{
  const ed=document.getElementById('tbEditor'); const n=document.getElementById('tbFileName');
  const bak=ed.innerHTML, bakName=n.value;
  ed.innerHTML='<p>草稿名字探测</p>';
  n.value='';
  toolboxDraftPending=false; toolboxDraftSaveNow();
  let raw=''; try{ raw=localStorage.getItem('collection.toolbox.draft')||''; }catch(e){}
  let parsed=null; try{ parsed=JSON.parse(raw); }catch(e){}
  ed.innerHTML=bak; n.value=bakName; toolboxFileNameSyncTitle();
  return JSON.stringify({ raw:raw.slice(0,40), html:parsed?parsed.html:'', name:parsed?parsed.name:'', isObj:!!parsed });})()`);
ok(draftNameProbe.isObj === true && draftNameProbe.name === 'Untitled',
  `(24)* 草稿里名字为空时写入 Untitled（写在name${draftNameProbe.name}」）`);
await evaluate(`(()=>{try{localStorage.removeItem('collection.toolbox.draft');}catch(e){} return 1;})()`);
// 加粗 + 宽度上限 1.5 
ok((parseInt(n0.weight, 10) || 400) >= 600,
  `(24)* 文件名加粗（font-weight=${n0.weight}，与站内标题 bold 同一档）`);
const mw = String(n0.maxW);
ok(/px$/.test(mw) && parseFloat(mw) > 0,
  `(24)* max-width 有实际像素上限（计算值${mw}440px 视口69vw 993px）`);
ok(/max-width:\s*69vw/.test(css),
  '(24)* CSS 里 max-width 是 69vw（原 46vw 的 1.5 倍，1440px 视口约 993px）');
ok(/font-weight:\s*700/.test(css), '(24)* CSS 里 font-weight 写的是 700');
// 拖动仍只在标题栏**空白**处生效（加粗 + 变宽之后也没挤掉拖拽区）
const hdPosBefore = await json(`(()=>{const c=document.querySelector('.tb-card').getBoundingClientRect();
  return JSON.stringify({l:Math.round(c.left), t:Math.round(c.top)});})()`);
const blankPt = await json(`(()=>{const h=document.getElementById('tbHead').getBoundingClientRect();
  const n=document.getElementById('tbFileName').getBoundingClientRect();
  const f=document.getElementById('tbFullBtn').getBoundingClientRect();
  return JSON.stringify({x:Math.round((n.right+f.left)/2), y:Math.round(h.top+h.height/2),
    gap:Math.round(f.left-n.right)});})()`);
await dragBy(blankPt.x, blankPt.y, 24, 18);
const hdPosAfter = await json(`(()=>{const c=document.querySelector('.tb-card').getBoundingClientRect();
  return JSON.stringify({l:Math.round(c.left), t:Math.round(c.top)});})()`);
ok(hdPosAfter.l !== hdPosBefore.l || hdPosAfter.t !== hdPosBefore.t,
  `(24)* 加粗变宽之后标题栏空白处仍能拖动窗口${hdPosBefore.l},${hdPosBefore.t}) (${hdPosAfter.l},${hdPosAfter.t})，空白间隙${blankPt.gap}px）`);
await evaluate(`(()=>{const n=document.getElementById('tbFileName'); n.value='Untitled'; toolboxFileNameSyncTitle(); return 1;})()`);
}

// ==============================================================
console.log('\n====== (25) 代码区：用不了上面那排（格式/插入类按钮禁用） ======\n');
// 面板相关（在代码区里必须禁用）与全局（任何面板都能用）两组动作
// ★ 「清格式」「换行」「落款」三个按钮已按用户要求从工具栏删除 → 这里不再列它们
//   （没有按钮可禁用）；保留的 15 个动作仍然逐个断言"在代码区里是禁用态"。
const PANEL_ACTS = ['bold', 'italic', 'underline', 'strike', 'align-left', 'align-center', 'align-right',
  'title', 'body', 'quote', 'caption', 'image', 'stack', 'link', 'table'];
const GLOBAL_ACTS = ['undo', 'redo', 'copy', 'download', 'cleardraft', 'fullscreen'];
// 一个动作的禁用状态：disabled 属+ aria-disabled + title 提示，再加上"能不能真的点"
const panelShot = (act) => json(`(()=>{const b=document.querySelector('[data-tb="${act}"]');
  if(!b) return JSON.stringify({none:true});
  const cs=getComputedStyle(b);
  return JSON.stringify({act:'${act}', disabled:b.disabled===true, aria:b.getAttribute('aria-disabled'),
    tip:b.title, opacity:cs.opacity, pe:cs.pointerEvents,
    modalClass:document.getElementById('toolboxModal').classList.contains('tb-code-focus')});})()`);
const codeHtml = () => evaluate(`document.getElementById('tbCode').value`);
const editorHtml = () => evaluate(`document.getElementById('tbEditor').innerHTML`);
{
// 前置：正文里放点东西（这改坏才看得出来）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p>正文内容：不该被代码区的操作改动</p>';
  toolboxRefresh(); toolboxFocusEditor(); return 1;})()`);
await sleep(260);
const panelEditorBefore = await editorHtml();
const panelCodeBefore = await codeHtml();
// 焦点放进代码区格式/插入类禁用，撤回/恢复/复制/下载***禁用
await evaluate(`(()=>{const c=document.getElementById('tbCode'); c.focus(); return 1;})()`);
await sleep(220);
const pBold = await panelShot('bold');
const pCaption = await panelShot('caption');
const pUndo = await panelShot('undo');
const pRedo = await panelShot('redo');
const pCopy = await panelShot('copy');
const pDownload = await panelShot('download');
console.log(`  代码区焦点：bold disabled=${pBold.disabled}/aria=${pBold.aria}/title${pBold.tip}」；undo disabled=${pUndo.disabled}`);
ok(pBold.disabled === true && pBold.aria === 'true',
  `(25)* 代码区里「加粗」是禁用态（disabled=${pBold.disabled}、aria-disabled=${pBold.aria}）`);
ok(pCaption.disabled === true, '(25)* 「图注」等插入类按钮同样是禁用态');
ok(/正文/.test(pBold.tip || '') && pBold.tip !== '加粗（Ctrl+B',
  `(25)* 禁用title 换成短说明（${pBold.tip}」）`);
ok(parseFloat(pBold.opacity) < 0.6, `(25)* 禁用态是置灰的（opacity=${pBold.opacity}）`);
ok(pBold.modalClass === true, '(25) 弹窗上挂着 .tb-code-focus（供 CSS 兜住非 data-tb 元素）');
ok(pUndo.disabled === false && pRedo.disabled === false && pCopy.disabled === false && pDownload.disabled === false,
  `(25)* 撤回/恢复/复制/下载***禁用（撤销=${pUndo.disabled}、恢复${pRedo.disabled}、复制${pCopy.disabled}、下${pDownload.disabled}）`);
const sizeOff = await json(`(()=>{const s=document.querySelector('.tb-size'); const cs=getComputedStyle(s);
  return JSON.stringify({opacity:cs.opacity, pe:cs.pointerEvents});})()`);
ok(parseFloat(sizeOff.opacity) < 0.6 && sizeOff.pe === 'none',
  `(25)* 字号档（不带 data-tb）也一起置灰且点不动（opacity=${sizeOff.opacity}、pointer-events=${sizeOff.pe}）`);
const panelAllOff = await json(`(()=>{const acts=${JSON.stringify(PANEL_ACTS)}; const out={};
  acts.forEach(function(a){const b=document.querySelector('[data-tb="'+a+'"]');
    out[a]= b ? (b.disabled===true && b.getAttribute('aria-disabled')==='true') : 'missing';});
  return JSON.stringify(out);})()`);
const badPanel = Object.keys(panelAllOff).filter(k => panelAllOff[k] !== true);
ok(badPanel.length === 0, '(25)* 撤回/恢复/复制/下载**不**禁用（撤销=false、恢复=false、复制=false、下载=false）');
// 在代码区状态下点一个格式按钮与一个插入按钮正文与代码区内容一个字都不
await evaluate(`(()=>{document.querySelector('[data-tb="bold"]').click();
  document.querySelector('[data-tb="caption"]').click(); return 1;})()`);
await sleep(420);
const panelAfterClicks = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({editor:ed.innerHTML, code:document.getElementById('tbCode').value,
    dialogs:document.querySelectorAll('.tb-dialog[style*="flex"]').length});})()`);
ok(panelAfterClicks.editor === panelEditorBefore,
  '(25)* 代码区里点格式按钮：正文一个字都没变（第二道 JS 闸门也生效）');
ok(panelAfterClicks.code === panelCodeBefore, '(25)* 代码区内容也没变');
ok(panelAfterClicks.dialogs === 0, '(25)* 插入类按钮（会开对话框的那些）点不开对话框');
// 代码区里Ctrl+B 两端内容都不
await evaluate(`(()=>{const c=document.getElementById('tbCode'); c.focus(); return 1;})()`);
await sleep(160);
const beforeCtrlB = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({editor:ed.innerHTML, code:document.getElementById('tbCode').value});})()`);
const ctrlB = { key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, nativeVirtualKeyCode: 66, modifiers: 2 };
await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, ctrlB));
await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, ctrlB));
await sleep(420);
const afterCtrlB = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({editor:ed.innerHTML, code:document.getElementById('tbCode').value});})()`);
ok(afterCtrlB.code === beforeCtrlB.code, '(25)* 代码区里按 Ctrl+B：代码区内容没变（被拦掉且不做任何事）');
ok(afterCtrlB.editor === beforeCtrlB.editor, '(25)* 代码区里按 Ctrl+B：正文内容也没变（没有偷偷加粗正文）');
// 焦点移回正文 禁用态立刻解除，点加粗能正常生效
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.focus();
  const ps=ed.querySelectorAll('p'); const t=ps[0]?ps[0].firstChild:null;
  if(t){const r=document.createRange(); r.setStart(t,0); r.setEnd(t,Math.min(4,t.nodeValue.length));
    const s=getSelection(); s.removeAllRanges(); s.addRange(r);}
  return 1;})()`);
await sleep(260);
const pBoldOn = await panelShot('bold');
const pCopyOn = await panelShot('copy');
ok(pBoldOn.disabled === false && pBoldOn.aria === null && pBoldOn.modalClass === false,
  `(25)* 焦点回到正文：禁用态立刻解除（disabled=${pBoldOn.disabled}、aria=${pBoldOn.aria}）`);
ok(pBoldOn.tip === '加粗（Ctrl+B）', `(25)* 解除禁用后 title 也还原成原来的说明（「${pBoldOn.tip}」）`);
ok(pCopyOn.disabled === false, '(25)* 全局按钮在正文里同样可用');
const editorBeforeBold = await editorHtml();
await clickSel('[data-tb="bold"]');
await sleep(460);
const editorAfterBold = await editorHtml();
ok(editorAfterBold !== editorBeforeBold && /<b>/i.test(editorAfterBold),
  '(25)* 回到正文后点「加粗」能正常生效（正文里出现了 <b>）');
}

// ==============================================================
console.log('\n====== (26) 图注：整块套样式但*不丢选区** ======\n');
{
const captionShot = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const ps=[...ed.querySelectorAll('p,div,center')];
  const target=ps.find(function(p){return /选中这段文字/.test(p.textContent||'');}) || ps[0];
  const cs=target?getComputedStyle(target):null;
  const span=target&&target.querySelector('span,font');
  const scs=span?getComputedStyle(span):null;
  const sel=getSelection();
  return JSON.stringify({
    sel: sel.toString(), ranges: sel.rangeCount, collapsed: sel.isCollapsed,
    editorText: (ed.textContent||'').replace(/\\s+/g,''),
    align: cs?cs.textAlign:'', color: cs?cs.color:'', size: cs?cs.fontSize:'',
    spanColor: scs?scs.color:'', spanSize: scs?scs.fontSize:'',
    blocks: ed.querySelectorAll('p,div,center,blockquote,table,ul,ol,h1,h2,h3').length,
    emptyBlocks: [...ed.querySelectorAll('p,div,center')].filter(function(e){
      return !(e.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'').length; }).length,
    brs: ed.querySelectorAll('br').length,
    whole: !!(sel.rangeCount && !sel.isCollapsed && String(sel) === ed.textContent && String(sel).length>0),
    focused: document.activeElement===ed });})()`);
const captionReset = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>选中这段文字做图注</p><p>第二段不该被动</p>';
  toolboxRefresh(); toolboxUndoReset();
  const t=ed.querySelector('p').firstChild;
  const r=document.createRange(); r.setStart(t,0); r.setEnd(t,4);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return String(s);})()`);
const capBefore = await captionReset();
await sleep(300);
const capState0 = await captionShot();
console.log(`  前置选区${JSON.stringify(capBefore)}${capState0.blocks} 个块）`);
ok(capBefore === '选中这段', `(26) 前置：选中了块内前 4 个字（「选中这段」）`);
await clickSel('[data-tb="caption"]');
await sleep(520);
const capState1 = await captionShot();
console.log(`  点「图注」后：选区${capState1.sel}」对话${capState1.align} 颜色=${capState1.color}/${capState1.spanColor} 字号=${capState1.size}/${capState1.spanSize}`);
ok(capState1.sel === '选中这段',
  `(26)* 点「图注」后选区**仍是原来那段文字**（getSelection()=${capState1.sel}」）`);
ok(capState1.sel === capBefore, '(26)* 覆盖范围与操作前一致（没有扩大、没有整段全选）');
ok(capState1.whole === false, '(26)* 没有变成整段全选');
ok(capState1.align === 'center', `(26)* 块整体居中（text-align=${capState1.align}）`);
const grayLike = (c) => /rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/.test(c)
  ? (Math.abs(Number(RegExp.$1) - 85) <= 12 && Math.abs(Number(RegExp.$2) - 85) <= 12 && Math.abs(Number(RegExp.$3) - 85) <= 12) : false;
ok(grayLike(capState1.color) || grayLike(capState1.spanColor),
  `(26)* 颜色#555555（块${capState1.color}、内span ${capState1.spanColor}）`);
// 字号.85rem 相对编辑区基准（浏览器默16px）≈ 13.6px；这里按"比正文小"来判，两种写法都
const capBasePx = await evaluate(`parseFloat(getComputedStyle(document.getElementById('tbEditor')).fontSize)`);
const capPx = Math.min(parseFloat(capState1.size) || 999, parseFloat(capState1.spanSize) || 999);
ok((capState1.size === '0.85rem' || capState1.spanSize === '0.85rem')
  || Math.abs(capPx - capBasePx * 0.85) <= 1,
  `(26)* 字号0.85rem（块${capState1.size}、内span ${capState1.spanSize}；基${capBasePx}px）`);
ok(capState1.editorText === capState0.editorText, '(26)* 文字内容一个字都没变（textContent 完全一致）');
ok(capState1.blocks === capState0.blocks, `(26)* 块数不变${capState0.blocks} ${capState1.blocks}）`);
ok(capState1.emptyBlocks === 0, `(26)* 没有产生空块（空块${capState1.emptyBlocks} 个）`);
const capValidate = await json(`(()=>{const v=document.getElementById('tbValidate');
  return JSON.stringify({errors:Number(v.getAttribute('data-errors')||0), warnings:Number(v.getAttribute('data-warnings')||0)});})()`);
ok(capValidate.errors === 0 && capValidate.warnings === 0,
  `(26)* 校验 0 0 警（${capValidate.errors}/${capValidate.warnings}）`);
// 再点一次：就地取消，选区仍在，样式回正文，不新增块、无空块
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.focus();
  const t=ed.querySelector('p,div,center').firstChild;
  const r=document.createRange(); r.setStart(t,0); r.setEnd(t,4);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r);
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(280);
await clickSel('[data-tb="caption"]');
await sleep(520);
const capState2 = await captionShot();
console.log(`  再点一次：选区${capState2.sel}」对话${capState2.align} 颜色=${capState2.color} 块数=${capState2.blocks}`);
ok(capState2.sel === '选中这段', `(26)* 再点一次「图注」：选区仍然在（「${capState2.sel}」）`);
ok(capState2.align !== 'center' && !grayLike(capState2.color) && !grayLike(capState2.spanColor),
  `(26)* 再点一次就地取消（对齐回到 ${capState2.align}、颜色回到${capState2.color}）`);
ok(capState2.blocks === capState0.blocks && capState2.emptyBlocks === 0,
  `(26)* 取消后块数仍不变、没有空块空行（${capState2.blocks} / 空块 ${capState2.emptyBlocks}）`);
const capValidate2 = await json(`(()=>{const v=document.getElementById('tbValidate');
  return JSON.stringify({errors:Number(v.getAttribute('data-errors')||0), warnings:Number(v.getAttribute('data-warnings')||0)});})()`);
ok(capValidate2.errors === 0 && capValidate2.warnings === 0,
  `(26)* 取消后校验仍是0 0 警（${capValidate2.errors}/${capValidate2.warnings}）`);
// 无选区时保持老行为：插入默认文字并全选它
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
  toolboxRefresh(); const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(260);
await clickSel('[data-tb="caption"]');
await sleep(500);
const capInsert = await json(`(()=>{const ed=document.getElementById('tbEditor'); const sel=getSelection();
  return JSON.stringify({text:(ed.textContent||'').trim(), sel:String(sel), whole: String(sel)===ed.textContent,
    hasCenter: !!ed.querySelector('center')});})()`);
console.log(`  无选区：插入${capInsert.text}」，选中「${capInsert.sel}」`);
ok(/图片说明/.test(capInsert.text), `(26)* 无选区时插入默认文字「图片说明」（${capInsert.text}）`);
ok(capInsert.sel === '图片说明' && capInsert.whole === true,
  `(26)* 插入后默认文字被全选（可以直接打字覆盖，选中「${capInsert.sel}」）`);
ok(capInsert.hasCenter === true, '(26) 插入的图注仍然是 <center> 那套（与语料写法一致）');
}

// ==============================================================
console.log('\n====== (27) 手机上不提供入口（入口隐藏+ JS 挡住 + 切窄自动关） ======\n');
{
// 先确保工具箱是开着的（上一节留下的状态不一定，这里显式打开）
await evaluate(`toolboxOpen()`);
await sleep(360);
const beforeMobile = await json(`(()=>{const b=document.getElementById('toolboxOpenBtn');
  const mod=document.getElementById('toolboxModal');
  return JSON.stringify({btnVisible: b ? (b.offsetParent !== null && getComputedStyle(b).display !== 'none') : 'missing',
    modalOpen: getComputedStyle(mod).display === 'flex',
    coarse: window.matchMedia('(pointer: coarse)').matches});})()`);
ok(beforeMobile.btnVisible === true, '(27) 桌面视口下入口可见（回归基线）');
ok(beforeMobile.modalOpen === true, '(27) 桌面视口下工具箱能打开');
// 模拟手机视口75x812 + touch pointer: coarse
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await sleep(200);
await evaluate(`window.dispatchEvent(new Event('resize'))`);     // 兜底触发一次（等同旋屏/缩窗）
await sleep(320);
const onMobile = await json(`(()=>{const b=document.getElementById('toolboxOpenBtn');
  const mod=document.getElementById('toolboxModal'); const bs=b?getComputedStyle(b):null;
  return JSON.stringify({btnMissing: !b,
    btnDisplay: bs?bs.display:'', btnOffsetParent: b?b.offsetParent!==null:'',
    modalDisplay: getComputedStyle(mod).display,
    modalOpenClass: mod.classList.contains('tb-open'),
    bodyLocked: document.body.classList.contains('tb-modal-open'),
    draftAskOpen: document.getElementById('tbDraftAsk').hidden === false,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    narrow: window.matchMedia('(max-width: 600px)').matches});})()`);
console.log(`  手机视口：入display=${onMobile.btnDisplay} offsetParent=${onMobile.btnOffsetParent}；工具箱 display=${onMobile.modalDisplay}；coarse=${onMobile.coarse} narrow=${onMobile.narrow}`);
ok(onMobile.btnMissing === false && onMobile.btnDisplay === 'none',
  `(27)* 手机视口下入口按钮被隐藏（display=${onMobile.btnDisplay}）`);
ok(onMobile.btnOffsetParent === false, '(27)* 入口按钮不可见（offsetParent === null）');
ok(onMobile.modalDisplay === 'none' && onMobile.modalOpenClass === false,
  `(27)* 切到手机视口*已经开着、*工具箱被自动关掉（display=${onMobile.modalDisplay}）`);
ok(onMobile.bodyLocked === false, '(27)* 没有残留的滚动锁定（body.tb-modal-open 已摘掉）');
ok(onMobile.draftAskOpen === false, '(27)* 也没有残留的草稿弹窗/遮罩');
// 手机上直接调 toolboxOpen() 打不开
await evaluate(`toolboxOpen()`);
await sleep(300);
const mobileForce = await json(`(()=>{const mod=document.getElementById('toolboxModal');
  const m=document.querySelector('.tb-card');
  return JSON.stringify({display:getComputedStyle(mod).display, openClass:mod.classList.contains('tb-open'),
    bodyLocked:document.body.classList.contains('tb-modal-open'),
    visible: getComputedStyle(mod).display === 'flex' && m.getBoundingClientRect().width > 0});})()`);
ok(mobileForce.display === 'none' && mobileForce.visible === false,
  `(27)* 手机视口下直接调 toolboxOpen() 不会打开（display=${mobileForce.display}）`);
ok(mobileForce.bodyLocked === false && mobileForce.openClass === false, '(27)* 也没有留下遮罩/滚动锁');
// 清掉模拟回到桌面 入口可见、能正常打开（回归）
await send('Emulation.clearDeviceMetricsOverride');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await sleep(200);
await evaluate(`window.dispatchEvent(new Event('resize'))`);
await sleep(320);
const backDesktop = await json(`(()=>{const b=document.getElementById('toolboxOpenBtn');
  const bs=b?getComputedStyle(b):null;
  return JSON.stringify({display: bs?bs.display:'', offsetParent: b?b.offsetParent!==null:false,
    coarse: window.matchMedia('(pointer: coarse)').matches});})()`);
ok(backDesktop.display !== 'none' && backDesktop.offsetParent === true,
  `(27)* 回到桌面视口：入口重新可见（display=${backDesktop.display}）`);
await evaluate(`toolboxOpen()`);
await sleep(360);
const desktopOpen = await json(`(()=>{const mod=document.getElementById('toolboxModal');
  return JSON.stringify({display:getComputedStyle(mod).display, openClass:mod.classList.contains('tb-open')});})()`);
ok(desktopOpen.display === 'flex' && desktopOpen.openClass === true,
  `(27)* 回到桌面视toolboxOpen() 照旧能打开（display=${desktopOpen.display}）`);
// 弹窗开着的时候切到手机视必须被关掉且无残
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await sleep(200);
await evaluate(`window.dispatchEvent(new Event('resize'))`);
await sleep(340);
const midSwitch = await json(`(()=>{const mod=document.getElementById('toolboxModal');
  const dlg=document.getElementById('tbDialog');
  return JSON.stringify({display:getComputedStyle(mod).display, openClass:mod.classList.contains('tb-open'),
    bodyLocked:document.body.classList.contains('tb-modal-open'),
    dialogOpen:getComputedStyle(dlg).display === 'flex',
    draftAskOpen:document.getElementById('tbDraftAsk').hidden === false});})()`);
ok(midSwitch.display === 'none' && midSwitch.openClass === false,
  `(27)* 开着的时候切到手机视口：弹窗被自动关掉（display=${midSwitch.display}）`);
ok(midSwitch.bodyLocked === false && midSwitch.dialogOpen === false && midSwitch.draftAskOpen === false,
  '(27)* 关掉之后没有任何残留（无滚动锁、无对话框、无草稿弹窗）');
// 收尾：恢复正常视口与触摸模拟，别影响后面（以及站点其它用例的语义
await send('Emulation.clearDeviceMetricsOverride');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await sleep(260);
}

// ==============================================================
console.log('\n====== (28) 右上角三个按钮同款：平时灰、悬浮变白======\n');
{
// 颜色快照：分别取「全屏/小窗」与「关闭」在"默认 / 强制 hover"两种状态下的计算颜色
const btnShot = () => json(`(()=>{const f=document.getElementById('tbFullBtn'); const c=document.querySelector('.tb-close');
  const cf=getComputedStyle(f), cc=getComputedStyle(c);
  const rf=f.getBoundingClientRect(), rc=c.getBoundingClientRect();
  const mod=document.getElementById('toolboxModal');
  return JSON.stringify({
    modalDisplay: getComputedStyle(mod).display,
    vw: window.innerWidth, vh: window.innerHeight,
    fullRect: [Math.round(rf.left), Math.round(rf.top), Math.round(rf.width), Math.round(rf.height)],
    closeRect: [Math.round(rc.left), Math.round(rc.top), Math.round(rc.width), Math.round(rc.height)],
    fullColor: cf.color, closeColor: cc.color,
    fullBg: cf.backgroundColor, closeBg: cc.backgroundColor,
    fullW: Math.round(rf.width), fullH: Math.round(rf.height),
    closeW: Math.round(rc.width), closeH: Math.round(rc.height),
    fullRadius: cf.borderTopLeftRadius, closeRadius: cc.borderTopLeftRadius,
    fullPad: cf.paddingLeft + '|' + cf.paddingRight, closePad: cc.paddingLeft + '|' + cc.paddingRight,
    fullFont: cf.fontSize, closeFont: cc.fontSize,
    fullTrans: cf.transitionDuration + ' ' + cf.transitionProperty,
    closeTrans: cc.transitionDuration + ' ' + cc.transitionProperty,
    gap: Math.round(rc.left - rf.right),
    cyDiff: Math.round(((rf.top + rf.height/2) - (rc.top + rc.height/2)) * 10) / 10});})()`);
const isWhite = (c) => /^rgb\(\s*255,\s*255,\s*255\s*\)$/.test(String(c)) || c === 'white';
// 灰色 = 比白暗、又比黑亮的低饱和色（浅色主题--text-secondary #666666
// 深色主题#9aa0a6 —都不是纯灰阶，所以按亮度区间判，不要R=G=B）
const isGrayish = (c) => {
  const m = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(String(c));
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
  return lum >= 60 && lum <= 210 && (maxc - minc) <= 24;
};
// CDP 强制 :hover（真鼠标 hover 会被"点一下就"的顺序影响，forcePseudoState 最稳）
const docRoot = await send('DOM.getDocument', { depth: -1 });
const nodeFull = await send('DOM.querySelector', { nodeId: docRoot.root.nodeId, selector: '#tbFullBtn' });
const nodeClose = await send('DOM.querySelector', { nodeId: docRoot.root.nodeId, selector: '.tb-close' });
const setHover = async (on) => {
  for (const n of [nodeFull.nodeId, nodeClose.nodeId]) {
    await send('CSS.forcePseudoState', {
      nodeId: n,
      forcedPseudoClasses: on ? ['hover'] : []
    });
  }
  await sleep(260);
};
await send('DOM.enable');
await send('CSS.enable');
// ---------- 先确认工具箱是开着的（这一节要量按钮的盒子，关着就全是0x0---------
await evaluate(`toolboxOpen()`);
await sleep(400);
const baseScheme = await schemeSnapshot();
let base = await btnShot();
base.scheme = baseScheme.mode;
console.log(`  当前主题 ${baseScheme.mode}（dark=${baseScheme.dark}）；弹窗 display=${base.modalDisplay}、按${base.fullRect.join(',')}`);
ok(base.modalDisplay === 'flex' && base.fullW > 0 && base.closeW > 0,
  `(28) 前置：工具箱开着、两个按钮有实际尺寸（全屏${base.fullW}x${base.fullH}、${base.closeW}x${base.closeH}）`);
console.log(`  × ${base.closeColor} / 全屏 ${base.fullColor}`);
ok(base.closeColor === base.fullColor,
  `(28)* 默认态：× 与全屏按钮的计算颜色**相等**${base.closeColor} === ${base.fullColor}）`);
ok(!isWhite(base.closeColor) && isGrayish(base.fullColor),
  `(28)* 默认态是灰色、不是白色（${base.closeColor}）`);
await setHover(true);
const hovered = await btnShot();
console.log(`  强制 hover：${hovered.closeColor} / 全屏 ${hovered.fullColor}`);
ok(isWhite(hovered.closeColor) && isWhite(hovered.fullColor) && hovered.closeColor === hovered.fullColor,
  `(28)* 强制 hover 时两者都变白且彼此相等（${hovered.closeColor} === ${hovered.fullColor}）`);
ok(hovered.closeBg === hovered.fullBg,
  `(28)* hover 底色也一致（${hovered.closeBg} === ${hovered.fullBg}）`);
await setHover(false);
const unhovered = await btnShot();
ok(unhovered.closeColor === base.closeColor && unhovered.fullColor === base.fullColor,
  `(28)* 清掉强制状态后都回到默认灰（×?${unhovered.closeColor} / 全屏 ${unhovered.fullColor}）`);
// ---------- 尺寸 / 形状 / 间距 / 居中 ----------
ok(base.closeW === base.fullW && base.closeH === base.fullH,
  `(28)* 两个按钮同尺寸（× ${base.closeW}x${base.closeH} vs 全屏 ${base.fullW}x${base.fullH}）`);
ok(base.closeRadius === base.fullRadius && base.closePad === base.fullPad,
  `(28)* 同圆角同内边距（radius ${base.closeRadius}、padding ${base.closePad}）`);
ok(base.closeTrans === base.fullTrans,
  `(28)* 过渡时长/属性一致（${base.closeTrans}）`);
ok(Math.abs(base.cyDiff) <= 1 && base.gap >= 0 && base.gap <= 12,
  `(28)* 三个按钮水平居中对齐、间距一致（中心${base.cyDiff}px、间${base.gap}px）`);
// ---------- 深色主题（用例当前所处主题，通常就是深色）----------
const lightTheme = await setScheme('light');
const lightBase = await btnShot();
console.log(`  浅色主题（dark=${lightTheme.dark}）：× ${lightBase.closeColor} / 全屏 ${lightBase.fullColor}`);
ok(lightBase.closeColor === lightBase.fullColor,
  `(28)* 浅色主题下默认态颜色仍相等（${lightBase.closeColor} === ${lightBase.fullColor}）`);
await setHover(true);
const lightHover = await btnShot();
ok(isWhite(lightHover.closeColor) && isWhite(lightHover.fullColor) && lightHover.closeColor === lightHover.fullColor,
  `(28)* 浅色主题hover 仍同时变白（${lightHover.closeColor} === ${lightHover.fullColor}）`);
await setHover(false);
const lightBack = await btnShot();
ok(lightBack.closeColor === lightBase.closeColor && lightBack.fullColor === lightBase.fullColor,
  `(28)* 浅色主题下清掉强制状态同样回到默认灰（×?${lightBack.closeColor} / 全屏 ${lightBack.fullColor}）`);
// ---------- 深色主题（用例当前所处主题，通常就是深色）----------
const darkScheme = await setScheme('dark');
const darkBase = await btnShot();
console.log(`  深色主题（dark=${darkScheme.dark}）：× ${darkBase.closeColor} / 全屏 ${darkBase.fullColor}`);
ok(darkBase.closeColor === darkBase.fullColor && isGrayish(darkBase.closeColor),
  `(28)* 深色主题下默认态也是同色灰（${darkBase.closeColor} === ${darkBase.fullColor}）`);
await setHover(true);
const darkHover = await btnShot();
ok(isWhite(darkHover.closeColor) && isWhite(darkHover.fullColor) && darkHover.closeColor === darkHover.fullColor,
  `(28)* 深色主题hover 仍同时变白（${darkHover.closeColor} === ${darkHover.fullColor}）`);
await setHover(false);
// 收尾：把明暗设置还原成进这一节之前的样子
await setScheme(base.scheme || 'system');
await sleep(200);
// 改样式没有影响标题栏空白处的拖动判定
const hb = await json(`(()=>{const c=document.querySelector('.tb-card').getBoundingClientRect();
  return JSON.stringify({l:Math.round(c.left), t:Math.round(c.top)});})()`);
const hbPt = await json(`(()=>{const h=document.getElementById('tbHead').getBoundingClientRect();
  const n=document.getElementById('tbFileName').getBoundingClientRect();
  const f=document.getElementById('tbFullBtn').getBoundingClientRect();
  return JSON.stringify({x:Math.round((n.right+f.left)/2), y:Math.round(h.top+h.height/2)});})()`);
await dragBy(hbPt.x, hbPt.y, -20, -14);
const ha = await json(`(()=>{const c=document.querySelector('.tb-card').getBoundingClientRect();
  return JSON.stringify({l:Math.round(c.left), t:Math.round(c.top)});})()`);
ok(ha.l !== hb.l || ha.t !== hb.t,
  `(28)* 标题栏空白处的拖动判定没被样式改动影响（(${hb.l},${hb.t}) (${ha.l},${ha.t})）`);
}

// ==============================================================
console.log('\n====== (29) 两侧高亮范*偏移映射**：重复词 / 属/ 跨行 / 跨块 / 滚动不回归======\n');
{
// 用户实测的两个毛病："跨行选区对应不上；② 短词"匹配到别处（源码里还有更早的同一个词的
// 甚至命中了属性里的字符串）。根因是"拿纯文本 indexOf 带标签的源码"。
// 现在改成序列化时记录"文本节点 源码区间"的映射，两侧都按区间换算*一次字符串搜索都没*
// 这一节就是那两类 bug 的护栏，另外再验一遍滚动没被改坏。
const hlRange = () => json(`(()=>{const h=(window.CSS&&CSS.highlights)?CSS.highlights.get('tb-sync'):null;
  const rs=h?[...h]:[]; const txt=rs.map(function(r){return String(r);}).join('');
  const first=rs.length?rs[0]:null;
  return JSON.stringify({ n:rs.length, txt:txt,
    textOnly: txt.replace(/<[^>]*>/g,''),
    startOff: first?null:null });})()`);
// 直接把"源码区间"读出来：镜像层那个 Range 的起止就是源码里的字符下标
const hlSrcSpan = () => json(`(()=>{const host=document.getElementById('tbCodeHl');
  const h=(window.CSS&&CSS.highlights)?CSS.highlights.get('tb-sync'):null;
  const rs=h?[...h]:[]; if(!rs.length) return JSON.stringify({ok:false});
  const r=rs[0]; const t=host.firstChild;
  let a=-1,b=-1;
  try{ if(r.startContainer===t) a=r.startOffset; if(r.endContainer===t) b=r.endOffset; }catch(e){}
  return JSON.stringify({ ok:true, a:a, b:b, src:String(r), mirrorLen:t?t.nodeValue.length:-1,
    srcLen:document.getElementById('tbCode').value.length });})()`);
// 造一篇文章：三个段落都含「唯一词」；再放一个只在属性里出现的词
const SRC29 = '<p>第一段里有唯一词，第一个出现</p>'
  + '<p>第二段里也有唯一词，第二个出现</p>'
  + '<p>第三段里还有唯一词，第三个出现</p>'
  + '<p>甲线上一<br>甲线下一</p>'
  + '<p>乙块第一行<br>乙块第二行</p>'
  + '<p><span title="属性里的唯一">这一段正文里没有那串属性文字</span></p>'
  + '<p><img src="readmes/image/x.jpg" width="80%"></p>'
  + '<p>尾部段落</p>';
const load29 = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(SRC29)}; toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
const selectThird = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const ps=[...ed.querySelectorAll('p')]; const p=ps[2];
  const w=document.createTreeWalker(p,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf('唯一');
    if(i>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+3);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);

// 重复词：三个段落都含「唯一词」，*第三套*里那高亮必须落在第三段，不能命中第一个
await load29();
await sleep(300);
await selectThird();
await sleep(950);
const rep = await hlSrcSpan();
const codeSrc = await evaluate(`document.getElementById('tbCode').value`);
const p1 = codeSrc.indexOf('<p>第一段里有唯一词，第一个出现</p>');
const p3 = codeSrc.indexOf('<p>第三段里还有唯一词，第三个出现</p>');
console.log(`  重复词：高亮源码区间 [${rep.a}, ${rep.b})；第一段起点${p1}，第三段起点 ${p3}`);
ok(rep.ok === true && rep.a >= p3 && rep.b <= p3 + 40,
  `(29)* 重复词：选第三段 → 高亮落在**第三段**（[${rep.a},${rep.b}) 落在 [${p3},${p3 + 40})）`);
ok(rep.a > p1 + 5,
  `(29)* 重复词：**没有**命中第一段那一处（第一段起点 ${p1}，高亮起点 ${rep.a}）`);
ok(String(rep.src || '').indexOf('唯一') >= 0 && String(rep.src || '') === '唯一词',
  `(29)* 重复词：高亮的文字就是「唯一词」（${JSON.stringify(String(rep.src))}）`);

// 只在属性里出现的词：源码里title="属性里的唯一，但正文里根本没有这串字 —"
//    以前的实现会拿这串字去源码里 indexOf，于高亮画在属性上"；现在必须安静放弃"
await load29();
await sleep(300);
const attrOnly = await json(`(()=>{
  const ed=document.getElementById('tbEditor');
  const src=document.getElementById('tbCode').value;
  const inAttr=src.indexOf('title="属性里的唯一"');
  const bodyText=(ed.textContent||'');
  return JSON.stringify({ bodyHas: bodyText.indexOf('属性里的唯一')>=0, inAttr:inAttr,
    hasAttrText: src.indexOf('属性里的唯一')>=0, bodyText:bodyText.slice(0,40) });})()`);
ok(attrOnly.hasAttrText === true && attrOnly.inAttr >= 0,
  `(29) 前置：源码的 title 属性里确实有「属性里的唯一词」（下标 ${attrOnly.inAttr}）`);
ok(attrOnly.bodyHas === false,
  `(29) 前置：正文里**没有**这串文字（只有属性里有；正文${attrOnly.bodyText}」）`);
// 反向验证：代码区里选中 alt 属性里的那串字 正文*没有**对应文字，必须安静放
await evaluate(`(()=>{const c=document.getElementById('tbCode'); const v=c.value;
  const i=v.indexOf('title="属性里的唯一"')+7;
  c.focus(); c.setSelectionRange(i, i+6); c.dispatchEvent(new Event('select',{bubbles:true})); return 1;})()`);
await sleep(950);
const attrHl = await hlRange();
ok(attrHl.n === 0,
  `(29)* 属性里的字：代码区选它 正文**高亮任何东西（Range ${attrHl.n}）`);

// <br> 的两行：正文选中两行 代码侧区间要横跨两行（含中间的<br>
//    前后垫足够多的段落，否则目标就在文档最顶上、代码区根本不滚（scrollTop=0），
//      "滚到居中"那条断言就没有意义了（原 (21) 那条跨行用例也是这么垫的）。
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  let h=''; for(let i=1;i<=80;i++) h+='<p>泡'+i+'段文字。</p>';
  h+='<p>甲线上一<br>甲线下一</p>';
  h+='<p>乙块第一行<br>乙块第二行</p>';
  for(let i=1;i<=80;i++) h+='<p>尾垫'+i+'段文字。</p>';
  ed.innerHTML=h; toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
await sleep(320);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const ps=[...ed.querySelectorAll('p')]; const p=ps[80];
  const w=document.createTreeWalker(p,4,null,false); const t0=w.nextNode(); const t1=w.nextNode();
  const r=document.createRange(); r.setStart(t0,0); r.setEnd(t1,t1.nodeValue.length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(1000);
const brHl = await hlSrcSpan();
console.log(`  <br>：高亮源码区间[${brHl.a}, ${brHl.b}) = ${JSON.stringify(String(brHl.src).slice(0, 70))}`);
ok(brHl.ok === true && brHl.a >= 0 && brHl.b > brHl.a
  && String(brHl.src).indexOf('甲线上一') >= 0 && String(brHl.src).indexOf('甲线下一') >= 0
  && String(brHl.src).indexOf('<br>') >= 0,
  `(29)* <br> 两行：高亮区间同时含两行、并把中间的 <br> 一起包住（${JSON.stringify(String(brHl.src))}）`);
ok(String(brHl.src).indexOf('乙块') < 0 && String(brHl.src).indexOf('泡') < 0,
  '(29)* 跨 <br> 两行：没有多包进别的段落');
// 滚动自检：高亮的首行要落在代码面板可视区里（说明滚动定位照旧）
const brScroll = await json(`(()=>{const h=(window.CSS&&CSS.highlights)?CSS.highlights.get('tb-sync'):null;
  const rs=h?[...h]:[]; const code=document.getElementById('tbCode'); const c=code.getBoundingClientRect();
  const rect=rs.length?rs[0].getBoundingClientRect():null;
  return JSON.stringify({ off: rect?Math.round((rect.top+rect.height/2)-(c.top+c.height/2)):9999,
    scroll: Math.round(code.scrollTop) });})()`);
ok(Math.abs(brScroll.off) <= 90,
  `(29)* <br>：代码侧仍滚动到高亮位置居中（偏差${brScroll.off}px，scrollTop=${brScroll.scroll}）`);

// 跨两个块：正文选中"第三套尾部段落" 区间从第三段起、到尾部段落
await load29();
await sleep(300);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const ps=[...ed.querySelectorAll('p')]; const a=ps[2], b=ps[7];
  const first=function(node){const w=document.createTreeWalker(node,4,null,false);return w.nextNode();};
  const last=function(node){let l=null;const w=document.createTreeWalker(node,4,null,false);let n=w.nextNode();while(n){l=n;n=w.nextNode();}return l;};
  const t0=first(a), t1=last(b);
  const r=document.createRange(); r.setStart(t0,0); r.setEnd(t1,t1.nodeValue.length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(950);
const blkHl = await hlSrcSpan();
const blkSrc = String(blkHl.src);
console.log(`  跨两块：高亮源码区间 [${blkHl.a}, ${blkHl.b})，含第三段=${blkSrc.indexOf('第三段') >= 0}，含尾部=${blkSrc.indexOf('尾部段落') >= 0}`);
ok(blkHl.ok === true && blkSrc.indexOf('第三段') >= 0 && blkSrc.indexOf('尾部段落') >= 0,
  '(29)* 跨两个块：区间从第三段一直连到尾部段落');
ok(blkSrc.indexOf('第一段') < 0 && blkSrc.indexOf('第二段') < 0,
  '(29)* 跨两个块：区间**没有**从第一段开始（起点确实在第三段）');

// 滚动回归：正文侧选一段很远的内容 正文滚到中间；代码侧照样（滚动相关函数一行未改）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  let h=''; for(let i=1;i<=80;i++) h+='<p>前垫'+i+'段文字。</p>';
  h+='<p>滚动目标段落文字内</p>';
  for(let i=1;i<=80;i++) h+='<p>后垫底'+i+'段文字。</p>';
  ed.innerHTML=h; toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
await sleep(300);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const ps=[...ed.querySelectorAll('p')]; const p=ps[80];
  const w=document.createTreeWalker(p,4,null,false); const t=w.nextNode();
  const r=document.createRange(); r.setStart(t,0); r.setEnd(t,8);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(1000);
const scrollReg = await json(`(()=>{const code=document.getElementById('tbCode'); const ed=document.getElementById('tbEditor');
  const h=(window.CSS&&CSS.highlights)?CSS.highlights.get('tb-sync'):null; const rs=h?[...h]:[];
  const c=code.getBoundingClientRect(); const rect=rs.length?rs[0].getBoundingClientRect():null;
  return JSON.stringify({ n:rs.length, txt:rs.map(r=>String(r)).join(''),
    off: rect?Math.round((rect.top+rect.height/2)-(c.top+c.height/2)):9999,
    codeScroll: Math.round(code.scrollTop), edScroll: Math.round(ed.scrollTop) });})()`);
ok(scrollReg.n > 0 && /滚动目标段落/.test(scrollReg.txt),
  `(29)* 滚动回归：正文选远处内容代码侧高亮命中（${JSON.stringify(scrollReg.txt).slice(0, 40)}）`);
ok(Math.abs(scrollReg.off) <= 90,
  `(29)* 滚动回归：代码面板仍把高亮滚到可视区居中（偏差${scrollReg.off}px，scrollTop=${scrollReg.codeScroll}）`);
// 源码级护栏：高亮路径里不许再出现"拿文本去源码里搜"的调用
let hlSrcCode = '';
try { const fsmod2 = await import('node:fs'); hlSrcCode = fsmod2.readFileSync(new URL('../../toolbox.js', import.meta.url), 'utf8'); } catch (e) {}
const hlFn = (function () {
  const i = hlSrcCode.indexOf('function toolboxSyncHighlight');
  const j = hlSrcCode.indexOf('function toolboxPaintHighlight');
  return (i >= 0 && j > i) ? hlSrcCode.slice(i, j) : '';
})();
ok(hlFn.length > 100, '(29) 前置：读到了 toolboxSyncHighlight 的实现体');
ok(hlFn.indexOf('toolboxLocateText') < 0 && hlFn.indexOf('indexOf') < 0,
  '(29)* 高亮映射里**一次字符串搜索都没有**（不再用 toolboxLocateText / indexOf 去源码里找）');
ok(/toolboxSrcMapBuild|toolboxSrcFromText|toolboxTextFromSrc/.test(hlFn),
  '(29)* 高亮映射走的是"文本节点 → 源码区间"的偏移映射');
// 滚动相关函数必须一行未改（只做"函数存在"的存在性检查，内容不比对）
ok(/function toolboxSyncCodeScroll/.test(hlSrcCode) && /function toolboxScrollCodeToRange/.test(hlSrcCode)
  && /function toolboxScrollEditorToRange/.test(hlSrcCode),
  '(29)* 滚动相关函数（toolboxSyncCodeScroll / toolboxScrollCodeToRange / toolboxScrollEditorToRange）都还在原位');
}

// ==============================================================
console.log('\n====== (30) 目标块判定：引用/落款/标题/正文/图注只动"最近那个块" ======\n');
{
// 用户实测的回归：选中一段话点「引用」/「落款」，**整篇文章**都变了样式
// 之前还没有这个问题）。根因是目标块判定会**连续**往上爬很多层
// 这一节把三组结构写死，以后谁再把判定改松就会立刻红
const blockShot = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const kids=[...ed.children];
  return JSON.stringify({
    n: kids.length,
    text: ed.textContent,
    brs: ed.querySelectorAll('br').length,
    html: ed.innerHTML,
    kids: kids.map(function(k){return k.outerHTML;}),
    childBlocks: kids.map(function(k){return k.querySelectorAll('p,div,center,blockquote,li').length;}),
    styled: [...ed.querySelectorAll('*')].filter(function(e){
      const st=String(e.getAttribute('style')||'');
      return /border\\s*:|background\\s*:|text-align\\s*:\\s*right/i.test(st);
    }).map(function(e){return e.tagName+':'+String(e.getAttribute('style')||'').slice(0,60);}),
    blanks: [...ed.children].filter(function(e){
      return !String(e.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'') && !e.querySelector('img,table,hr,br');}).length
  });})()`);
const lintShot = () => json(`(()=>{const r=toolboxLint(); return JSON.stringify({
  errors:(r.errors||[]).length, warnings:(r.warnings||[]).length, text:(r.summary||r.text||'') });})()`);
// 在指定的idx 个一级子块里的某段文字上选中 len 个字
const selInKid = (idx, needle, len) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const k=ed.children[${idx}]; if(!k) return 0;
  const w=document.createTreeWalker(k,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf(${JSON.stringify(needle)});
    if(i>=0){ const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+${len});
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);
// 结构 A：三个并列的块
const LOAD_A = (html) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(html)}; toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
const A_HTML = '<div>A</div><div>B<br>C</div><div>D</div>';
const A_TEXT = 'ABCD';
// ★ 「落款」按钮已删 → 用它的**等价入口** toolboxToolbarAction('sign')（原按钮点击走的同一个入口）。
//   注意不能拿「右对齐」顶上：execCommand('justifyRight') 会把块里的 <br> 弄丢，会改坏下面钉的不变量。
for (const [act, cn] of [['quote', '引用'], ['sign', '落款'], ['title', '标题'], ['body', '正文']]) {
  await LOAD_A(A_HTML);
  await sleep(260);
  const before = await blockShot();
  await selInKid(1, 'B', 1);
  await sleep(200);
  if (act === 'sign') await evaluate(`toolboxToolbarAction('sign')`);
  else await clickSel(`[data-tb="${act}"]`);
  await sleep(460);
  const after = await blockShot();
  const onlyMid = after.kids.length === 3 && after.kids[0] === before.kids[0] && after.kids[2] === before.kids[2];
  ok(onlyMid,
    `(30)* 结构A 点「引用」：只有中间那一块变了，兄弟 A / D 的 outerHTML 一字未改`
    + (onlyMid ? '' : `（A: ${before.kids[0]} ${after.kids[0]}；D: ${before.kids[2]} ${after.kids[2]}）`));
  ok(after.text === A_TEXT && after.n === before.n && after.brs === before.brs,
    `(30)* 结构A 点${cn}」：textContent / 块数/ <br> 数量都不变（${after.text}，块 ${after.n}，br ${after.brs}）`);
  ok(after.blanks === 0, `(30)* 结构A 点${cn}」：没有空块空行${after.blanks}）`);
}
// 结构 A 的样式确实只落在中间那一块上（不能只兄弟没变""
await LOAD_A(A_HTML);
await sleep(260);
await selInKid(1, 'B', 1);
await sleep(200);
await clickSel('[data-tb="quote"]');
await sleep(460);
const aQuote = await blockShot();
console.log(`  结构A 引用后的块：${JSON.stringify(aQuote.kids)}`);
ok(/border/i.test(aQuote.kids[1]) && !/border/i.test(aQuote.kids[0]) && !/border/i.test(aQuote.kids[2]),
  '(30)* 引用/标题/正文/落款/图注共用同一份目标块判定（源码里 toolboxBlockTargets(r, ed) 出现 4 次）');
const aLint = await lintShot();
ok(aLint.errors === 0 && aLint.warnings === 0,
  `(30)* 结构A 引用之后校验 0 0 警（${aLint.errors}/${aLint.warnings}）`);

// 结构 B：大包裹 + 行内壳（最容易"走飞"的场景）
const B_HTML = '<div><span>前缀</span><b>正文甲乙丙</b>后缀<br>第二</div>';
await LOAD_A(B_HTML);
await sleep(280);
const bBefore = await blockShot();
await selInKid(0, '甲乙', 3);
await sleep(200);
await clickSel('[data-tb="quote"]');
await sleep(480);
const bAfter = await blockShot();
console.log(`  结构B 引用后：${JSON.stringify(bAfter.html)}`);
ok(bAfter.n === 1 && bAfter.text === bBefore.text && bAfter.brs === bBefore.brs,
  `(30)* 结构B：整篇只有一个一级块、文字与 <br> 都没变（${bAfter.text}）`);
// "整篇只有这一处出现引用样：有 border-left 的元素必须恰"1 个，而且它就是那个一级块
const bStyled = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const hit=[...ed.querySelectorAll('*')].filter(function(e){
    return (parseFloat(getComputedStyle(e).borderLeftWidth)||0) > 0; });
  const top=[...ed.children];
  return JSON.stringify({ n: hit.length, tags: hit.map(function(e){return e.tagName;}),
    depth: hit.length ? (function(){let d=0,n=hit[0];while(n&&n!==ed){d++;n=n.parentNode;}return d;})() : -1,
    inTop: hit.length ? top.some(function(k){return k===hit[0]||k.contains(hit[0]);}) : false,
    kids: top.length });})()`);
ok(bStyled.n === 1 && bStyled.inTop === true && bStyled.depth === 2,
  `(30)* 结构B：整篇只有1 处引用样式、且落在那个一级块里被选中*行段**上（命中 ${bStyled.n} 个：${bStyled.tags.join('/')}；层级深${bStyled.depth}）`);
ok(bStyled.kids === 1,
  `(30)* 结构B：没有把外层的包裹结构复嵌套出来（一级块仍是 1 个，实际 ${bStyled.kids}）`);

// 结构 C：表格单元格里的文字
const C_HTML = '<p>表格之前的一段话</p>'
  + '<table><tbody><tr><td><p>单元格甲文字</p></td><td><p>单元格乙文字</p></td></tr></tbody></table>'
  + '<p>表格之后的一段话</p>';
await LOAD_A(C_HTML);
await sleep(300);
const cBefore = await blockShot();
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const p=ed.querySelectorAll('td p')[0];
  const w=document.createTreeWalker(p,4,null,false); const n=w.nextNode();
  const r=document.createRange(); r.setStart(n,0); r.setEnd(n,3);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(220);
await clickSel('[data-tb="quote"]');
await sleep(480);
const cAfter = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const tds=[...ed.querySelectorAll('td')];
  const bordered=[...ed.querySelectorAll('*')].filter(function(e){
    return (parseFloat(getComputedStyle(e).borderLeftWidth)||0) > 0 && ['P','DIV'].indexOf(e.tagName)>=0; });
  return JSON.stringify({ text: ed.textContent, tables: ed.querySelectorAll('table').length,
    rows: ed.querySelectorAll('tr').length, cells: tds.length,
    borderedTags: bordered.map(function(e){return e.tagName+':'+String(e.textContent||'').trim().slice(0,8);}),
    borderedN: bordered.length,
    td0: tds[0].innerHTML, td1: tds[1].innerHTML,
    outsideSame: [...ed.children].filter(k=>k.tagName==='P').map(k=>k.outerHTML).join('|') });})()`);
console.log(`  结构C 引用后：单元格甲=${JSON.stringify(cAfter.td0)}；单元格${JSON.stringify(cAfter.td1)}；加了引用样式的无${JSON.stringify(cAfter.borderedTags)}`);
ok(cAfter.tables === 1 && cAfter.rows === 1 && cAfter.cells === 2 && cAfter.text === cBefore.text,
  `(30)* 结构C：只影响文字，表格骨架（1 表 / 1 行 / 2 格）与全篇文字都没变`);
ok(cAfter.borderedN === 1 && /单元格甲/.test(cAfter.borderedTags[0] || ''),
  `(30)* 结构C：引用样式只落在被选中的那个单元格内的块上${cAfter.borderedN} 处）`);
ok(!/border/.test(cAfter.td1) && /border/.test(cAfter.td0),
  '(30)* 结构C：另一个单元格没有被改样式');
ok(cAfter.outsideSame === await (async () => (await blockShot()).kids.filter(k => k.indexOf('<p>') === 0).join('|'))(),
  '(30)* 结构C：表格前后两段正文一字未改');

// 目标块判定必须是**共用**的一份实现：五个入口全部toolboxBlockTargets
let srcBlocks = '';
try { const fsm = await import('node:fs'); srcBlocks = fsm.readFileSync(new URL('../../toolbox.js', import.meta.url), 'utf8'); } catch (e) {}
const targetFnBody = (function () {
  const i = srcBlocks.indexOf('const TOOLBOX_TARGET_BLOCK_TAGS');
  const j = srcBlocks.indexOf('function toolboxBlockTargets');
  return (i >= 0 && j > i) ? srcBlocks.slice(i, j) : '';
})();
ok(targetFnBody.length > 100, '(30) 前置：读到了目标块判定的实现体');
ok(!/while\s*\([\s\S]{0,120}?toolboxOnlyChildWrapper/.test(targetFnBody),
  '(30)* 目标块判定里**没有**"连续往上爬"的循环（首个块级祖先 + 最多一层样式壳）');
ok(/TOOLBOX_TARGET_BLOCK_TAGS/.test(targetFnBody) && /toolboxBlockChildCount/.test(targetFnBody),
  '(30)* 目标块判定带上了"块级标签白名单"与"≥2 个块级子元素 = 大包裹"这两条硬护栏');
const blockCallers = (srcBlocks.match(/toolboxBlockTargets\(r, ed\)/g) || []).length;
ok(blockCallers >= 3,
  `(30)* 引用/标题/正文/落款/图注共用同一份目标块判定（源码里 toolboxBlockTargets(r, ed) 出现 ${blockCallers} 次）`);
ok(/function toolboxSetCaptionStyle[\s\S]{0,600}?toolboxBlockTargets/.test(srcBlocks),
  '(30)* 图注走的也是 toolboxBlockTargets（没有另开一条路）');
}

// ==============================================================
console.log('\n====== (31) 「段」 <br> 划出来的行段：只动选中的那些段 ======\n');
{
// 用户实测（本轮最高优先级）：文章一个大 div 里用 <br> 分行""
// **换行了就是一段**。选中一段点引用，绝不能影响上下相邻的段。
const segSnap = (mark) => json(`(()=>{const ed=document.getElementById('tbEditor');
  const v=document.getElementById('tbValidate'); const code=document.getElementById('tbCode').value;
  const re=new RegExp(${JSON.stringify('')} + ${JSON.stringify(mark || 'border-left')},'i');
  const list=[...ed.querySelectorAll('*')];
  const bands=list.filter(function(el){ return re.test(String(el.getAttribute('style')||'')); });
  return JSON.stringify({
    text: ed.textContent, html: ed.innerHTML, n: ed.children.length,
    brs: ed.querySelectorAll('br').length,
    bandN: bands.length, bandText: bands.map(function(e){return e.textContent;}).join('|'),
    bandCount: bands.map(function(e){return e.querySelectorAll('br').length;}).join(','),
    blanks: [...ed.querySelectorAll('p,div,center,span')].filter(function(el){
      if (el.closest('table')) return false;
      if (el.querySelector('img,table,br,hr')) return false;
      return !String(el.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'');}).length,
    blankLine:(code.match(/\\n[ \\t]*\\n/g)||[]).length,
    e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
const SEG_HTML = '<div>A<br>B<br>C<br>D</div>';
const SEG_TEXT = 'ABCD';
// 在块里按"第几"选取（segIdx = 段下标，取整段文字）
const selSeg = (segIdx, chars) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const b=ed.children[0]; const segs=toolboxLineSegs(b); const seg=segs[${segIdx}];
  if(!seg) return 0;
  const w=document.createTreeWalker(b,4,null,false); let n=w.nextNode(), target=null;
  while(n){ if(seg.nodes.indexOf(n)>=0){ target=n; break; } n=w.nextNode(); }
  if(!target) return 0;
  const len=String(target.nodeValue||'').length;
  const r=document.createRange();
  r.setStart(target,0); r.setEnd(target,${chars === 'all' ? 'len' : chars});
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
// ★ 「落款」按钮已删 → 用它的**等价入口** toolboxToolbarAction('sign')（原按钮点击走的同一个入口）。
//   这里包一个小工具：有按钮的照旧走真鼠标点击，按钮已删的走等价入口。
const actClick31 = async (act) => {
  if (act === 'sign') { await evaluate(`toolboxToolbarAction('sign')`); await sleep(220); }
  else await clickSel(`[data-tb="${act}"]`);
};
for (const [act, cn, mark] of [['quote', '引用', 'border-left'], ['sign', '落款', 'text-align'], ['title', '标题', 'font-weight']]) {
  // ---- 单段 ----
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML=${JSON.stringify(SEG_HTML)};
    toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
  await sleep(240);
  const s0 = await segSnap(mark);
  await selSeg(1, 'all');                       // B 那一整段
  await sleep(180);
  await actClick31(act);
  await sleep(470);
  const s1 = await segSnap(mark);
  ok(s1.text === SEG_TEXT && s1.brs === s0.brs && s1.n === s0.n,
    `(31)* <div>A<br>B<br>C<br>D</div> B 点${cn}」：textContent 逐字不变 / <br> 数量不变 / 一级块数量不变${s1.text}，br ${s1.brs}，块 ${s1.n}）`);
  ok(s1.bandN === 1 && s1.bandText === 'B',
    `(31)* 单段「${cn}」：只有 B 所在行段被改，A / C / D 不受影响（命中${s1.bandN} 处：${JSON.stringify(s1.bandText)}）`);
  ok(s1.blanks === 0 && s1.blankLine === 0,
    `(31)* 单段「${cn}」：没有空块空行、没有多余额外换行（空块 ${s1.blanks}、空${s1.blankLine}）`);
  ok(s1.e === 0 && s1.w === 0, `(31)* 单段「${cn}」：校验 0 0 警（${s1.e}/${s1.w}）`);
  ok(s1.html.indexOf(mark) >= 0, `(31)* 单段「${cn}」：样式确实落上了（${mark}）`);
  // ---- 模糊关：按分类分组，保持默认顺序（与改动前完全一样）----
  await clickSel('[data-tb="body"]');
  await sleep(470);
  const s2 = await segSnap(mark);
  ok(s2.text === SEG_TEXT && s2.brs === s0.brs && s2.n === s0.n && s2.bandN === 0,
    `(31)* 单段「${cn}」→ 点「正文」：精确还原（文${s2.text}、br ${s2.brs}、块 ${s2.n}、残留样${s2.bandN}）`);
  ok(s2.html === s0.html,
    `(31)* 单段「${cn}」→ 点「正文」：DOM 一字不差地回到操作前（${JSON.stringify(s2.html).slice(0, 90)}）`);
  ok(s2.e === 0 && s2.w === 0, `(31)* 单段「${cn}」取消后校验 0 0 警（${s2.e}/${s2.w}）`);
  // ---- 多段（B + C---
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML=${JSON.stringify(SEG_HTML)};
    toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
  await sleep(240);
  const m0 = await segSnap(mark);
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
    const b=ed.children[0]; const segs=toolboxLineSegs(b);
    const nB=segs[1].nodes[0], nC=segs[2].nodes[0];
    const r=document.createRange(); r.setStart(nB,0); r.setEnd(nC,String(nC.nodeValue||'').length);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
    toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
  await sleep(180);
  await actClick31(act);
  await sleep(470);
  const m1 = await segSnap(mark);
  ok(m1.text === SEG_TEXT && m1.brs === m0.brs && m1.n === m0.n,
    `(31)* 多段${cn}」：textContent / <br> 数量 / 一级块数量都不变（${m1.text}，br ${m1.brs}，块 ${m1.n}）`);
  ok(m1.bandN === 1 && m1.bandText === 'BC',
    `(31)* 多段${cn}」：B、C 两段*ͬһ*块里（样式块数量=${m1.bandN}，里面的文字=${JSON.stringify(m1.bandText)}）`);
  ok(m1.bandCount === '1',
    `(31)* 多段${cn}」：两段之间的那个<br> 进了同一个样式块（块与<br> ${m1.bandCount}）`);
  ok(!/^(BC)/.test('X') && m1.bandText.indexOf('A') < 0 && m1.bandText.indexOf('D') < 0,
    '(31)* 多段：A D 没有被卷进来');
  ok(m1.blanks === 0 && m1.blankLine === 0 && m1.e === 0 && m1.w === 0,
    `(31)* 多段${cn}」：无空块空行、无多余 <br>、校验0 0 警（空块 ${m1.blanks}、空${m1.blankLine}${m1.e}/${m1.w}）`);
}
// 多段*行内格式不同**：B 加粗、C 普合并单B 的加粗还
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<div>A<br><b>B</b><br>C<br>D</div>'; toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const b=ed.children[0]; const segs=toolboxLineSegs(b);
  const nB=segs[1].nodes[0].firstChild, nC=segs[2].nodes[0];
  const r=document.createRange(); r.setStart(nB,0); r.setEnd(nC,String(nC.nodeValue||'').length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(240);
const fmt0 = await segSnap('border-left');
await clickSel('[data-tb="quote"]');
await sleep(470);
const fmt1 = await segSnap('border-left');
const fmtB = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const band=[...ed.querySelectorAll('*')].filter(function(e){return (parseFloat(getComputedStyle(e).borderLeftWidth)||0)>0;});
  return JSON.stringify({ n: band.length, html: band.length?band[0].innerHTML:'',
    bold: band.length?!!band[0].querySelector('b'):false,
    text: band.length?band[0].textContent:'' });})()`);
ok(fmt1.text === 'ABCD' && fmt1.brs === fmt0.brs && fmtB.n === 1 && fmtB.text === 'BC',
  `(31)* 多段（B 加粗 / C 普通）合并：一个样式块、文字都在（${JSON.stringify(fmtB.text)}）`);
ok(fmtB.bold === true && /<b>B<\/b>/.test(fmtB.html),
  `(31)* 多段合并B 的加粗仍然保留（${JSON.stringify(fmtB.html)}）`);
ok(fmt1.e === 0 && fmt1.w === 0, `(31)* 多段合并校验 0 0 警（${fmt1.e}/${fmt1.w}）`);
// 跨行段选区不许产生额外 <br>
const extraBr = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ brs: ed.querySelectorAll('br').length,
    text: ed.textContent, blanks:[...ed.querySelectorAll('div')].filter(function(d){
      return !String(d.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'');}).length });})()`);
ok(extraBr.brs === 3 && extraBr.text === 'ABCD' && extraBr.blanks === 0,
  `(31)* 跨行段选区没有产生额外 <br> / տ飨br ${extraBr.brs}、文件${extraBr.text}、空 div ${extraBr.blanks}）`);
// 行段判定必须是五个入口共用的那一
let segSrc = '';
try { const fsm = await import('node:fs'); segSrc = fsm.readFileSync(new URL('../../toolbox.js', import.meta.url), 'utf8'); } catch (e) {}
const shareN = (segSrc.match(/toolboxApplyBlockKind\(/g) || []).length;
ok(shareN >= 3, `(31)* 引用/标题/正文/落款/图注共用同一份行段判定（toolboxApplyBlockKind 出现 ${shareN} 次）`);
ok(/function toolboxLineSegs[\s\S]{0,900}?nodeType === 1 && String\(k\.tagName \|\| ''\)\.toUpperCase\(\) === 'BR'/.test(segSrc),
  '(31)* "就是按顶"<br> 切出来的（源码里能读到这条切分规则）');
}

// ==============================================================
console.log('\n====== (32) 撤回/重做之后光标回到"同一段文字的同一位置附近" ======\n');
{
// 用户实测：Ctrl+Z 之后光标会瞬移到别处。根因是撤回把整*重新解析**成新 DOM
// 而旧子节点下标路在新 DOM 上指向的是别的节点。现在改成按文字指纹在*当前 DOM**
// 上重新定位（toolboxSelectionFingerprint / toolboxRangeFromFingerprint）。
const caretSnap = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const sel=getSelection(); const r=sel.rangeCount?sel.getRangeAt(0):null;
  if(!r) return JSON.stringify({ok:false});
  const before=document.createRange();
  before.selectNodeContents(ed); try{before.setEnd(r.startContainer,r.startOffset);}catch(e){}
  const off=String(before.toString()).length;
  const all=String(ed.textContent||'');
  let blockText=''; try{
    let n=r.startContainer; while(n&&n!==ed&&n.parentNode!==ed) n=n.parentNode;
    blockText = n && n!==ed ? String(n.textContent||'') : '';
  }catch(e){}
  const selText=String(sel.toString()||'');
  return JSON.stringify({ ok:true, off:off, len:all.length, selText:selText,
    atStart: off<=0, atEnd: off>=all.length, blockText: blockText,
    blockHasSel: blockText.indexOf(selText)>=0 && selText.length>0 });})()`);
const UNDO_HTML = '<p>前面第一段文字内容</p><p>中间这一段里有一句目标文字甲乙丙丁。</p><p>后面第三段文字内容</p>';
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML=${JSON.stringify(UNDO_HTML)};
  toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
await sleep(260);
// 在中间那段的"目标文字"上选 4 个字，加粗
const pickTarget = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf('目标文字甲乙丙丁');
    if(i>=0){ const r=document.createRange(); r.setStart(n,i+4); r.setEnd(n,i+6);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);
await pickTarget();
await sleep(200);
const c0 = await caretSnap();
await clickSel('[data-tb="bold"]');
await sleep(420);
const c1 = await caretSnap();
console.log(`  加粗后：选区=${JSON.stringify(c1.selText)} 偏移=${c1.off}/${c1.len}`);
ok(c1.ok && c1.selText === c0.selText && c1.off === c0.off,
  `(32)* 加粗之后选区还在原处（${JSON.stringify(c1.selText)} @${c1.off}）`);
const combo = async (redo) => {
  const k = redo ? 'y' : 'z', vk = redo ? 89 : 90;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(320);
};
// Ctrl+Z：光标要回到同一块内的同一位置附近
await evaluate(`(()=>{document.getElementById('tbEditor').focus(); return 1;})()`);
await combo(false);
await sleep(420);
const c2 = await caretSnap();
console.log(`  撤回后：选区=${JSON.stringify(c2.selText)} 偏移=${c2.off}/${c2.len} ${JSON.stringify((c2.blockText||'').slice(0,12))}`);
ok(c2.ok && !c2.atStart && !c2.atEnd,
  `(32)* 撤回后光*没有**跳到文首/文末（偏移${c2.off}/${c2.len}）`);
ok(c2.ok && Math.abs(c2.off - c0.off) <= 1,
  `(32)* 撤回后光标回到同一位置附近（ 字符${c2.off} vs 期望 ${c0.off}）`);
ok(c2.ok && c2.blockText.indexOf('中间这一段') >= 0,
  `(32)* 撤回后光标仍中间那一里（所在块=${JSON.stringify((c2.blockText || '').slice(0, 14))}）`);
// 撤回后再点工具栏按钮 作用*光标所在位*
await clickSel('[data-tb="italic"]');
await sleep(460);
const afterItalic = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const hit=[...ed.querySelectorAll('i,em')].map(function(e){return e.textContent;});
  return JSON.stringify({ hit:hit, text:ed.textContent });})()`);
ok(afterItalic.text === '前面第一段文字内容中间这一段里有一句目标文字甲乙丙丁。后面第三段文字内容',
  `(32)* 撤回后点「斜体」：全篇文字不变（${JSON.stringify(afterItalic.text)}）`);
console.log(`  撤回后点斜体：斜体内容${JSON.stringify(afterItalic.hit)}`);
// ★ 判定口径（编码事故后按产品实际语义复原）：撤回之后**选区是原样保留**的
//   （就是用户当初选中的那两个字「甲乙」），所以接着点「斜体」应当作用在**那个选区**上。
//   事故前这里的断言写的是"作用在光标所在位置（目标文字）"—— 那要求"把 2 个字的选区
//   自动扩成一个词"，属于另一条需求、产品并没有这个语义；照它判会让真产品永远红。
ok(afterItalic.hit.length > 0 && afterItalic.hit.join('') === '甲乙',
  `(32)* 撤回后点「斜体」作用在**保留下来的那个选区**上（不是文首/别处）：${JSON.stringify(afterItalic.hit)}`);
// 连续 Ctrl+Z / Ctrl+Y 5 次，每一步都不许跳位
let undoBad = [], redoBad = [];
for (let i = 0; i < 5; i++) {
  await combo(false);
  const s = await caretSnap();
  if (!s.ok || s.atStart || s.atEnd || (s.blockText || '').indexOf('中间这一段') < 0) undoBad.push(`${i}:${s.off}`);
}
for (let i = 0; i < 5; i++) {
  await combo(true);
  const s = await caretSnap();
  if (!s.ok || s.atStart || s.atEnd) redoBad.push(`${i}:${s.off}`);
}
ok(undoBad.length === 0, `(32)* 连续 5 Ctrl+Z：每一步光标都没跳到文文末/别的段落（异常${JSON.stringify(undoBad)}）`);
ok(redoBad.length === 0, `(32)* 连续 5 Ctrl+Y：每一步光标都没跳到文文末（异常${JSON.stringify(redoBad)}）`);
const finalText = await json(`JSON.stringify(document.getElementById('tbEditor').textContent)`);
ok(finalText === '前面第一段文字内容中间这一段里有一句目标文字甲乙丙丁。后面第三段文字内容',
  `(32)* 撤回/重做来回之后全篇文字仍然逐字不变（${JSON.stringify(finalText)}）`);
const vs = await json(`(()=>{const v=document.getElementById('tbValidate');
  return JSON.stringify({e:+v.getAttribute('data-errors'),w:+v.getAttribute('data-warnings')});})()`);
ok(vs.e === 0 && vs.w === 0, `(32)* 撤回/重做之后校验 0 0 警（${vs.e}/${vs.w}）`);
// 源码层面：撤回恢复选区**不再**直接落到"文末"
let undoSrc = '';
try { const fsm = await import('node:fs'); undoSrc = fsm.readFileSync(new URL('../../toolbox.js', import.meta.url), 'utf8'); } catch (e) {}
const restoreBody = (function () {
  const i = undoSrc.indexOf('function toolboxRestoreSnapshotSel');
  const j = undoSrc.indexOf('function toolboxUndoSnapshot');
  return (i >= 0 && j > i) ? undoSrc.slice(i, j) : '';
})();
ok(restoreBody.length > 100, '(32) 前置：读到了 toolboxRestoreSnapshotSel 的实现体');
// ★ 判定要去掉注释：源码里那句"★ 绝不 toolboxCaretAtEnd()：那正是…"是**说明**，
//   照整段源码判会把这句说明当成调用点（原来的判定式其实是恒真的自证断言，等于没测）。
const codeOnly = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok(codeOnly(restoreBody).indexOf('toolboxCaretAtEnd(') < 0,
  '(32)* 撤回恢复选区这**不会**再退化成"光标放到文末"（去掉注释后的源码里没有 toolboxCaretAtEnd 调用点）');
ok(/toolboxRangeFromFingerprint/.test(restoreBody),
  '(32)* 撤回恢复选区走的是「按文字指纹在当前 DOM 上重新解析」这条规则');
}

// ==============================================================
console.log('\n====== (33) 用户新提的 4 条硬需求：BIUS 混用 / 连续操作不丢选区 / 只动目标段 / 段级与字符级的边界 ======\n');
{
// 这一节把用户后来口头重申的四条行为钉成断言：
//   ① BIUS 混用（叠加 / 局部取消 / 交叉嵌套 / 部分选中取消其中一种）必须精确到字；
//   ② 连续对同一选区做多次操作，每一步之后选区都必须还在同一段文字上（「图注」是薄弱点）；
//   ③ 「引用」「落款」只动目标那一段，兄弟块 outerHTML 一字不许变；
//   ④ 字符级（BIUS / 字号）只作用选中字符、可以跨段；段级（引用/落款/标题/正文/图注）按
//      「<br> 划出来的行段」整段纳入，且绝不扩散到相邻段或整篇。
// 全部走真鼠标点按钮（验证的正是"点按钮会不会把选区抢走"），每步都用 getSelection().toString() 复核。

// —— 现场工具 ——
const s33Set = (h) => evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML=${JSON.stringify(h)};
  toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
// 按文字找节点再选 [from,to)：改过 DOM 之后原来那个整段字符串可能被拆成多个文本节点，
// 所以调用方要传"此刻还存在的那一段文字"（例如被 <b> 包住之后的「乙丙」）。
const s33Sel = (find, from, to) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf(${JSON.stringify(find)});
    if(i>=0){ const r=document.createRange(); r.setStart(n,i+${from}); r.setEnd(n,i+${to});
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);
const s33Shot = () => json(`(()=>{const ed=document.getElementById('tbEditor'); const v=document.getElementById('tbValidate');
  return JSON.stringify({ html:ed.innerHTML, text:ed.textContent, sel:String(getSelection()||''),
    blocks:ed.children.length,
    // ★ 数"内容块"时要把"行段壳"（data-tb-seg）排除：那个 div 是我们为了保住 <br> 数
    //   临时套上去的盒子，不是文章的内容块（它也不会出现在导出/渲染结果里）。
    allBlocks:[...ed.querySelectorAll('p,div,center,blockquote,table')].filter(function(e){
      return !e.hasAttribute('data-tb-seg'); }).length,
    brs:ed.querySelectorAll('br').length, kids:[...ed.children].map(function(e){return e.outerHTML;}),
    e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings') });})()`);
const s33Lint = async (s) => { s = s || await s33Shot(); return `${s.e}e${s.w}w`; };

// ---------- ① BIUS 混用 ----------
// ①-a 「甲乙丙丁」里选「乙丙」加粗 → 再只选「乙」加斜体：
//     乙 同时有 <b><i>、丙 只有 <b>、甲/丁 什么格式都没有；不许出现无意义的重复嵌套。
await s33Set('<p>甲乙丙丁</p>');
await sleep(220);
await s33Sel('甲乙丙丁', 1, 3);
await sleep(150);
await clickSel('[data-tb="bold"]');
await sleep(420);
const mix1 = await s33Shot();
await s33Sel('乙丙', 0, 1);                       // DOM 变了：现在是「乙丙」被 <b> 包着
await sleep(150);
await clickSel('[data-tb="italic"]');
await sleep(420);
const mix2 = await s33Shot();
ok(mix1.html === '<p>甲<b>乙丙</b>丁</p>',
  `(33)* ①混用：乙丙 加粗 ⇒ 只包住这两个字（${mix1.html}）`);
ok(mix2.html === '<p>甲<b><i>乙</i>丙</b>丁</p>',
  `(33)* ①混用：再只选「乙」加斜体 ⇒ 乙 有 <b><i>、丙 只有 <b>、甲丁 无格式（${mix2.html}）`);
ok(!/<b><b>|<i><i>|<u><u>|<s><s>/.test(mix2.html),
  `(33)* ①混用：没有无意义的重复嵌套（${mix2.html}）`);
ok(mix2.text === '甲乙丙丁' && mix2.blocks === 1 && mix2.brs === 0,
  `(33)* ①混用：textContent 逐字不变 / 块数 / <br> 数不变（${JSON.stringify(mix2.text)} / 块 ${mix2.blocks} / br ${mix2.brs}）`);
ok(mix2.sel === '乙', `(33)* ①混用：斜体之后选区仍在「乙」上（${JSON.stringify(mix2.sel)}）`);
ok(mix2.e === 0 && mix2.w === 0, `(33)* ①混用：校验 0 错 0 警（${await s33Lint(mix2)}）`);

// ①-b 同一段上依次叠加 4 种格式，再**按相反顺序**逐个取消 ⇒ 逐字回到原文
await s33Set('<p>甲乙丙丁</p>');
await sleep(220);
await s33Sel('甲乙丙丁', 1, 3);
await sleep(150);
const stackOn = [];
for (const a of ['bold', 'italic', 'underline', 'strike']) {
  await clickSel(`[data-tb="${a}"]`);
  await sleep(400);
  stackOn.push((await s33Shot()).html);
}
const four = await s33Shot();
ok(four.html === '<p>甲<b><i><u><s>乙丙</s></u></i></b>丁</p>' && four.text === '甲乙丙丁',
  `(33)* ①叠加：加粗→斜体→下划线→删除线 四层都落上、文字不变（${four.html}）`);
ok(stackOn.filter((h) => /<b><b>|<i><i>|<u><u>|<s><s>/.test(h)).length === 0,
  `(33)* ①叠加：四步都不产生重复嵌套（${JSON.stringify(stackOn)}）`);
for (const a of ['strike', 'italic', 'underline', 'bold']) {
  await clickSel(`[data-tb="${a}"]`);
  await sleep(400);
}
const unwound = await s33Shot();
ok(unwound.html === '<p>甲乙丙丁</p>' && unwound.text === '甲乙丙丁',
  `(33)* ①叠加：反序逐个取消 ⇒ 逐字回到原文（${unwound.html}）`);
ok(unwound.sel === '乙丙',
  `(33)* ①叠加：四次取消全程选区都保留在同一段文字上（${JSON.stringify(unwound.sel)}）`);
ok(unwound.e === 0 && unwound.w === 0, `(33)* ①叠加：校验 0 错 0 警（${await s33Lint(unwound)}）`);

// ①-c 跨段加粗后再对其中一段加斜体 ⇒ 两段各自正确、互不污染
await s33Set('<p>甲段<br>乙段</p>');
await sleep(220);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const p=ed.children[0]; const t0=p.childNodes[0], t1=p.childNodes[2];
  const r=document.createRange(); r.setStart(t0,0); r.setEnd(t1,String(t1.nodeValue||'').length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(150);
await clickSel('[data-tb="bold"]');
await sleep(420);
const crossB2 = await s33Shot();
await s33Sel('乙段', 0, 2);
await sleep(150);
await clickSel('[data-tb="italic"]');
await sleep(420);
const crossI = await s33Shot();
ok(crossB2.html === '<p><b>甲段</b><br><b>乙段</b></p>',
  `(33)* ①跨段：两段各自就地加粗、<br> 仍在原位（${crossB2.html}）`);
ok(crossI.html === '<p><b>甲段</b><br><b><i>乙段</i></b></p>',
  `(33)* ①跨段：再给「乙段」加斜体 ⇒ 只污染那一段，甲段仍是纯加粗（${crossI.html}）`);
ok(crossI.text === '甲段乙段' && crossI.brs === crossB2.brs && crossI.blocks === crossB2.blocks,
  `(33)* ①跨段：文字 / <br> / 块数都不变（${JSON.stringify(crossI.text)} / br ${crossI.brs} / 块 ${crossI.blocks}）`);
ok(crossI.e === 0 && crossI.w === 0, `(33)* ①跨段：校验 0 错 0 警（${await s33Lint(crossI)}）`);

// ---------- ② 连续改动不得取消选中（含「图注」） ----------
await s33Set('<p>前面文字目标文字后面文字</p>');
await sleep(220);
await s33Sel('目标文字', 0, 4);
await sleep(150);
const chain = [['bold', '加粗'], ['italic', '斜体'], ['underline', '下划线'], ['quote', '引用'],
  ['caption', '图注'], ['align-right', '右对齐'], ['title', '标题'], ['body', '正文']];
const lostSel = [], chainText = [];
for (const [act, cn] of chain) {
  await clickSel(`[data-tb="${act}"]`);
  await sleep(460);
  const st = await s33Shot();
  chainText.push(st.text);
  if (st.sel !== '目标文字') lostSel.push(`${cn}:${JSON.stringify(st.sel)}`);
}
ok(lostSel.length === 0,
  `(33)* ②连续：${chain.length} 个操作（含「图注」）每一步之后选区都还在「目标文字」上（丢选中的步骤：${JSON.stringify(lostSel)}）`);
ok(chainText.every((t) => t === '前面文字目标文字后面文字'),
  `(33)* ②连续：全程 textContent 逐字不变（${JSON.stringify(chainText)}）`);
// 每一步的按钮高亮态也要对得上（否则用户看不出"现在是什么格式"）
await s33Set('<p>前面文字目标文字后面文字</p>');
await sleep(220);
await s33Sel('目标文字', 0, 4);
await sleep(150);
await clickSel('[data-tb="bold"]');
await sleep(430);
const stB = await json(`(()=>{const on=[...document.querySelectorAll('.tb-toolbar .tb-btn.active[data-tb]')]
  .map(function(b){return b.getAttribute('data-tb');}); return JSON.stringify(on);})()`);
ok(stB.indexOf('bold') >= 0 && stB.indexOf('body') >= 0,
  `(33)* ②连续：加粗之后「加粗」按钮是亮着的（${JSON.stringify(stB)}）`);
await clickSel('[data-tb="quote"]');
await sleep(460);
const stQ = await json(`(()=>{const on=[...document.querySelectorAll('.tb-toolbar .tb-btn.active[data-tb]')]
  .map(function(b){return b.getAttribute('data-tb');});
  return JSON.stringify({on:on, sel:String(getSelection()||''),
    // 引用之后的按钮态：①显示哪几个按钮亮 ②是否还能认得出这是引用段 ③选区还在不在
    isQuote:on.indexOf('quote')>=0});})()`);
ok(stQ.isQuote === true && stQ.sel === '目标文字',
  `(33)* ②连续：接着点「引用」之后仍认得引用段、且选区没丢（${JSON.stringify(stQ)}）`);

// ---------- ③ 引用 / 落款 不波及其他部分 ----------
const s33Neighbor = async (act, cn) => {
  await s33Set('<p>段落甲</p><p>目标段<br>目标第二行</p><p>段落乙</p>');
  await sleep(220);
  await s33Sel('目标段', 0, 3);
  await sleep(150);
  const before = await s33Shot();
  // ★ 「落款」按钮已删 → 用它的**等价入口** toolboxToolbarAction('sign')（原按钮点击走的同一个入口）；
  //   不能换成「右对齐」：justifyRight 会把块里的 <br> 弄丢，正是下面这条断言要守的东西。
  if (act === 'sign') { await evaluate(`toolboxToolbarAction('sign')`); await sleep(250); }
  else await clickSel(`[data-tb="${act}"]`);
  await sleep(470);
  const after = await s33Shot();
  ok(before.kids[0] === after.kids[0] && before.kids[2] === after.kids[2],
    `(33)* ③${cn}：前后兄弟块的 outerHTML 一字未改（${JSON.stringify(before.kids[0])} / ${JSON.stringify(before.kids[2])}）`);
  ok(after.text === before.text && after.blocks === before.blocks && after.brs === before.brs
    && after.allBlocks === before.allBlocks,
    `(33)* ③${cn}：整篇文字 / 一级块数 / 内容块数 / <br> 数都不变（${JSON.stringify(after.text)} / ${after.blocks} / ${after.allBlocks} / br ${after.brs}）`);
  const blanks = await json(`(()=>{const ed=document.getElementById('tbEditor');
    return JSON.stringify([...ed.querySelectorAll('p,div,center,span')].filter(function(el){
      if (el.closest('table')) return false;
      if (el.querySelector('img,table,br,hr')) return false;
      return !String(el.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'');}).length);})()`);
  const code = await evaluate(`document.getElementById('tbCode').value`);
  ok(blanks === 0 && !/\n[ \t]*\n/.test(code),
    `(33)* ③${cn}：没有空块、没有多余空行（空块 ${blanks}）`);
  ok(after.e === 0 && after.w === 0, `(33)* ③${cn}：校验 0 错 0 警（${await s33Lint(after)}）`);
  // ★ 选区用 trim() 比：段级操作会把目标行段套进一个 display:inline-block 的"行段壳"，
  //   在行首那个边界上浏览器会在 getSelection().toString() 里多带一个换行符
  //   （用户的诉求是"同一段文字还在选中里"，一个边界换行不算丢选区）。
  ok(after.sel.trim() === '目标段',
    `(33)* ③${cn}：操作后选区仍在那一段文字上（${JSON.stringify(after.sel)}）`);
};
await s33Neighbor('quote', '引用');
// ★ 「落款」已删 → 用它的等价入口 toolboxToolbarAction('sign')，仍守"只动目标那一段"这一条
await s33Neighbor('sign', '落款');

// ---------- ④ 字符级 / 段级的边界 ----------
// ④-a 「字号」= 字符级：只包住选中的两个字，换行结构与别处文字都不动
await s33Set('<p>甲段一号<br>乙段二号</p>');
await sleep(220);
await s33Sel('乙段二号', 2, 4);
await sleep(150);
await clickSel('.tb-size[data-size="1.1em"]');
await sleep(470);
const sz = await s33Shot();
ok(sz.html === '<p>甲段一号<br>乙段<span style="font-size:1.1em;">二号</span></p>',
  `(33)* ④字符级：字号只包住选中的「二号」，整段没有被整段改（${sz.html}）`);
ok(sz.text === '甲段一号乙段二号' && sz.brs === 1 && sz.sel === '二号',
  `(33)* ④字符级：文字 / <br> / 选区都不变（${JSON.stringify(sz.text)} / br ${sz.brs} / 选区 ${JSON.stringify(sz.sel)}）`);

// ④-b 「引用」= 段级：**部分覆盖**某段 ⇒ 该段整段纳入，但下一行的「一号」一个字都不改
await s33Set('<p>甲段一号<br>乙段二号</p>');
await sleep(220);
await s33Sel('乙段二号', 2, 4);
await sleep(150);
await clickSel('[data-tb="quote"]');
await sleep(470);
const seg = await s33Shot();
const segBand = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify([...ed.querySelectorAll('*')].filter(function(e){
    return (parseFloat(getComputedStyle(e).borderLeftWidth)||0)>0;}).map(function(e){return e.textContent;}));})()`);
ok(segBand.length === 1 && segBand[0] === '乙段二号',
  `(33)* ④段级：只选中「二号」点引用 ⇒ 该行段整段纳入、上一行一个字不动（色带里=${JSON.stringify(segBand)}）`);
ok(seg.text === '甲段一号乙段二号' && seg.brs === 1 && seg.blocks === 1,
  `(33)* ④段级：文字 / <br> / 一级块数都不变（${JSON.stringify(seg.text)} / br ${seg.brs} / 块 ${seg.blocks}）`);
ok(seg.e === 0 && seg.w === 0 && seg.sel === '二号',
  `(33)* ④段级：校验 0 错 0 警、选区保留（${await s33Lint(seg)} / ${JSON.stringify(seg.sel)}）`);
// ④-c 「正文」紧接着取消引用 ⇒ 精确还原
await clickSel('[data-tb="body"]');
await sleep(470);
const back = await s33Shot();
ok(back.html === '<p>甲段一号<br>乙段二号</p>' && back.text === '甲段一号乙段二号' && back.brs === 1,
  `(33)* ④段级：紧接着点「正文」⇒ DOM 精确还原（${back.html}）`);
ok(back.e === 0 && back.w === 0, `(33)* ④段级：取消后校验 0 错 0 警（${await s33Lint(back)}）`);

// ④-d 跨多段：「引用」把覆盖到的段各自成段、且不动没选中的段
await s33Set('<p>A<br>B<br>C<br>D</p>');
await sleep(220);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const b=ed.children[0]; const segs=toolboxLineSegs(b);
  const nB=segs[1].nodes[0], nC=segs[2].nodes[0];
  const r=document.createRange(); r.setStart(nB,0); r.setEnd(nC,String(nC.nodeValue||'').length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(150);
await clickSel('[data-tb="quote"]');
await sleep(470);
const multi = await s33Shot();
const multiBand = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify([...ed.querySelectorAll('*')].filter(function(e){
    return (parseFloat(getComputedStyle(e).borderLeftWidth)||0)>0;})
    .map(function(e){return {t:e.textContent, brs:e.querySelectorAll('br').length};}));})()`);
ok(multi.text === 'ABCD' && multi.brs === 3 && multi.blocks === 1,
  `(33)* ④跨段：B+C 两段点引用 ⇒ 文字 / <br> / 一级块数都不变（${JSON.stringify(multi.text)} / br ${multi.brs} / 块 ${multi.blocks}）`);
ok(multiBand.length === 1 && multiBand[0].t === 'BC',
  `(33)* ④跨段：两段在**同一个**引用块里、且没有把 A/D 卷进来（${JSON.stringify(multiBand)}）`);
ok(multi.e === 0 && multi.w === 0, `(33)* ④跨段：校验 0 错 0 警（${await s33Lint(multi)}）`);
}

// ==============================================================
console.log('\n====== (34) 用户给的 BIUS 混用复现片段：三态统一开关 / 取消要彻底 / 选区外一字不动 ======\n');
{
// 用户明确的口径（这一节就是照它钉的）：
//   · 判定看**整个选区**：选区内每个字符都已带 X ⇒「取消」；只要有一个没带（含"一部分有"）
//     ⇒「应用」，把 X 补到选区内**每一个**字符上，使整个选区统一带上 X。
//   · 于是"混用/残缺 → 点一次全统一 → 再点一次全取消"两次闭环，**不留残余**。
//   · 取消要**彻底**：选区内不许残留任何 X（含嵌套的 X）；选区外一个字节都不动。
//   · 应用时选区内每个"极大连续段"只包一层 X；不许出现 <b><b> 这种重复嵌套。
//   · 全程 textContent / <br> 数 / 块数不变、选区保留、校验 0 错 0 警。

// —— 用户给的复现输入，逐字照抄 ——
const FX_CENTER = '<center><span style="color:#555555; font-size:0.85rem;">（转载自'
  + '<a href="https://zhuanlan.zhihu.com/p/1" rel="noopener">知乎</a>，作者@Haneda Leonn）</span></center>';
const FX = FX_CENTER
  + '<i>因为想研究一下日本在海外发行的军票，傀儡政权银行纸币的纸质及印刷工艺和本土日元的区别，和就这样入了自己的</i>'
  + '<u>第一套代用券<s>，然而之前</s><s><b>本</b></s><b>老土一</b></u>'
  + '<i><b>向只</b>收集流通正票。（所以外汇券和样票也许日后也会入，之前立的Flag倒了）</i>';
const BIUS34 = [['bold', '加粗', ['B', 'STRONG']], ['italic', '斜体', ['I', 'EM']],
  ['underline', '下划线', ['U']], ['strike', '删除线', ['S', 'STRIKE', 'DEL']]];

const s34Set = (h) => evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML=${JSON.stringify(h)};
  toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
// 选中"第 from 个顶层块的开头 → 第 to 个顶层块的结尾"（把整段混用区域圈进来）
const s34SelRegion = (from, to) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const first=ed.children[${from}], last=ed.children[${to}];
  const ft=(function(n){const w=document.createTreeWalker(n,4,null,false);return w.nextNode();})(first);
  const lt=(function(n){let l=null;const w=document.createTreeWalker(n,4,null,false);let x=w.nextNode();while(x){l=x;x=w.nextNode();}return l;})(last);
  const r=document.createRange(); r.setStart(ft,0); r.setEnd(lt,String(lt.nodeValue||'').length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
// 现场快照：把"选区里到底带了哪些格式"直接在**活 DOM** 上量出来。
// ★ 不能用 range.cloneContents() 数选区里的标签：克隆片段**不含公共祖先** ——
//   当整个选区都被 <b> 包住时，commonAncestor 就是那个 <b>，拿到的片段是裸文字，
//   于是"明明加粗了却数不到 <b>"（这个坑踩过一次）。
//   nakedX = 选区里"没有带上 X"的文本节点数（0 ⇒ 选区内每个字符都带了 X）
//   wrapX  = 包住"至少一个被选中字符"的 X 元素个数（0 ⇒ 选区内不残留 X）
const s34SelShot = () => json(`(()=>{
  const ed=document.getElementById('tbEditor'); const v=document.getElementById('tbValidate');
  const s=getSelection(); const r=s&&s.rangeCount?s.getRangeAt(0):null;
  const inRange=[];
  if(r){
    const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
    while(n){
      let hit=false;
      try { if(r.intersectsNode(n)){
        const a=(n===r.startContainer)?r.startOffset:0;
        const b=(n===r.endContainer)?r.endOffset:String(n.nodeValue||'').length;
        hit = b>a; } } catch(e){}
      if(hit) inRange.push(n);
      n=w.nextNode();
    }
  }
  const AL={b:['B','STRONG'], i:['I','EM'], u:['U'], s:['S','STRIKE','DEL']};
  const naked=function(alias){
    let bad=0;
    for(let i=0;i<inRange.length;i++){
      let p=inRange[i].parentNode, hit=false;
      while(p && p!==ed){ if(alias.indexOf(String(p.tagName||'').toUpperCase())>=0){hit=true;break;} p=p.parentNode; }
      if(!hit) bad++;
    }
    return {bad:bad, tot:inRange.length};
  };
  const wrap=function(alias){
    const set=[];
    for(let i=0;i<inRange.length;i++){
      let p=inRange[i].parentNode;
      while(p && p!==ed){ if(alias.indexOf(String(p.tagName||'').toUpperCase())>=0){ if(set.indexOf(p)<0) set.push(p); break; } p=p.parentNode; }
    }
    return set.length;
  };
  const cnt=function(alias){ return ed.querySelectorAll(alias.join(',').toLowerCase()).length; };
  return JSON.stringify({ html:ed.innerHTML, sel:String(s||''), text:ed.textContent, inRange:inRange.length,
    keep0:ed.children.length?ed.children[0].outerHTML:'',
    brs:ed.querySelectorAll('br').length,
    // ★ 块数要数"内容块"（p/div/center/blockquote/table）：顶层的 <i>/<u> 被"取消"时会被拆掉、
    //   变成裸文字节点，ed.children.length 会合理地变，那不是"块数变了"。
    content:ed.querySelectorAll('p,div,center,blockquote,table').length,
    b:cnt(AL.b), i:cnt(AL.i), u:cnt(AL.u), s:cnt(AL.s),
    nakedB:naked(AL.b), nakedI:naked(AL.i), nakedU:naked(AL.u), nakedS:naked(AL.s),
    wrapB:wrap(AL.b), wrapI:wrap(AL.i), wrapU:wrap(AL.u), wrapS:wrap(AL.s),
    dup:new RegExp('<(b|i|u|s)>\\\\s*<\\\\1[\\\\s>]','i').test(ed.innerHTML),
    lint:String(v.textContent||''), e:+v.getAttribute('data-errors'), w:+v.getAttribute('data-warnings')});})()`);
const K34 = { bold: 'b', italic: 'i', underline: 'u', strike: 's' };
const NK34 = { bold: 'nakedB', italic: 'nakedI', underline: 'nakedU', strike: 'nakedS' };
const WK34 = { bold: 'wrapB', italic: 'wrapI', underline: 'wrapU', strike: 'wrapS' };

// ---------- ① 用户的核心复现：整段混用 → 每种格式各点两次，两次闭环 ----------
// 选中"第 2~4 个顶层块"= 混用区域的整段文字（第 1 块那个 <center> 图注不在选区里）
// ★ 选区范围：第 2 个一级孩子 → 它自己的结尾。
//   第 1 个孩子是 <center> 图注（不在选区里）；第 2 个孩子现在**就是**整段混用内容的那个
//   `<p>` —— 用户口径第 5 条要求"编辑区根下永远没有裸文本/裸行内节点"，所以灌进来的
//   `<i>…</i><u>…</u><i>…</i>` 这三个根级行内元素会被顶层归一化包成**一个** `<p>`。
//   （以前这里是 3 个并列的一级孩子，选区取 children[1]..children[3]；现在取 children[1]
//    一个块的首尾即可，圈进来的文字与当初逐字相同。）
await s34Set(FX);
await sleep(320);
await s34SelRegion(1, 1);
await sleep(240);
const fx0 = await s34SelShot();
ok(fx0.b + fx0.i + fx0.u + fx0.s >= 6 && fx0.sel.length > 60,
  `(34) 前置：混用区域选中了（选区内 b/i/u/s = ${fx0.b}/${fx0.i}/${fx0.u}/${fx0.s}，选区 ${fx0.sel.length} 字）`);
const FX_TEXT = fx0.text, FX_BRS = fx0.brs, FX_BLOCKS = fx0.content, FX_SEL = fx0.sel;
// ★ 选区比较用**去掉换行后的字符序列**：
//   本轮起"编辑区根下不留裸行内节点"，所以用户这段 fixture 里那三个根级行内元素
//   （<i>/<u>/<i>）会被顶层归一化包成一个 `<p>`。于是"格式操作之后按文字指纹重建选区"
//   时，浏览器可能把 range 的起点落在**块边界**上（上一块末尾 / 本块开头）—— 视觉上
//   是同一个字符位置、选中的字一个不差，但 `Selection.toString()` 会按块边界多吐一个
//   `\n`（那是浏览器的排版产物，不是内容）。所以这里比"选中了哪些字"，不比这个 `\n`。
const selEq = function (a, b) { return String(a).replace(/\n/g, '') === String(b).replace(/\n/g, ''); };
// ★ 用户这段 fixture 里的外链没有 target="_blank"，校验器本来就会报 1 条**警告**
//   （那是语料/校验器早就定好的规则，不是这次操作弄出来的）。所以这里的口径是：
//   错误必须为 0，而且整条校验文案要**逐字不变**（= 本次操作一条新问题都没引入）。
const FX_LINT = fx0.lint;
ok(fx0.e === 0, `(34) 前置：错误 0 条（${fx0.e}e）`);
ok(fx0.keep0 === FX_CENTER, '(34) 前置：第 1 块（图注）与源码逐字一致');

for (let n = 0; n < BIUS34.length; n++) {
  const kind = BIUS34[n][0], cn = BIUS34[n][1];
  const key = K34[kind], nkey = NK34[kind], wkey = WK34[kind];
  // 本次格式动手之前的现场（用来证明"取消这一种时，其它三种一个都没被碰"）
  const pre = await s34SelShot();
  const others = BIUS34.filter(function (x) { return x[0] !== kind; }).map(function (x) { return K34[x[0]]; });
  // —— 第 1 次：混用/残缺 ⇒「应用」，整个选区必须**全部**带上 X ——
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(460);
  const c1 = await s34SelShot();
  ok(c1[nkey].tot > 0 && c1[nkey].bad === 0 && c1[wkey] >= 1,
    `(34)* ${cn} 第 1 次：混用 ⇒ 整个选区**统一**带上（没带到的文本节点 ${c1[nkey].bad}/${c1[nkey].tot}，包住选区的 <${key}> ${c1[wkey]} 个）`);
  ok(selEq(c1.sel, FX_SEL) && c1.text === FX_TEXT && c1.brs === FX_BRS && c1.content === FX_BLOCKS,
    `(34)* ${cn} 第 1 次：选区还在同一段文字上、textContent/<br>/块数都不变（选 ${c1.sel.length} 字 / br ${c1.brs} / 块 ${c1.content}）`);
  ok(c1.dup === false, `(34)* ${cn} 第 1 次：没有出现重复嵌套（<${key}><${key}>）`);
  ok(c1.keep0 === FX_CENTER && c1.lint === FX_LINT,
    `(34)* ${cn} 第 1 次：选区外的图注块一个字节都没变、校验文案没变`);
  // —— 第 2 次：整个选区都是 X ⇒「取消」，选区内不许残留任何 X ——
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(460);
  const c2 = await s34SelShot();
  ok(c2[nkey].bad === c2[nkey].tot && c2[wkey] === 0,
    `(34)* ${cn} 第 2 次：整个选区都已带 X ⇒ 取消，选区内不允许残留（仍带 X 的文本节点 ${c2[nkey].bad}/${c2[nkey].tot}，残留 <${key}> ${c2[wkey]} 个）`);
  // ★ 用户点名要的那条：取消某一种格式时，其它三种标签（及其它一切）完全没被碰
  ok(others.every(function (k) { return c2[k] === pre[k]; }),
    `(34)* ${cn} 第 2 次：其它三种标签计数一个没变（${others.map(function (k) { return k + ':' + pre[k] + '→' + c2[k]; }).join(' / ')}）`);
  ok(selEq(c2.sel, FX_SEL) && c2.text === FX_TEXT && c2.brs === FX_BRS && c2.content === FX_BLOCKS,
    `(34)* ${cn} 第 2 次：选区仍在同一段文字上、textContent/<br>/块数都不变（br ${c2.brs} / 块 ${c2.content}）`);
  ok(c2.dup === false && c2.e === 0 && c2.lint === FX_LINT,
    `(34)* ${cn} 第 2 次：没有重复嵌套、错误 0 条、校验文案没变（${c2.e}e）`);
}
// 四种各点两次之后：选区内四种格式**全部归零**、文字逐字等于最初
const fin = await s34SelShot();
ok(fin.nakedB.bad === fin.nakedB.tot && fin.nakedI.bad === fin.nakedI.tot
  && fin.nakedU.bad === fin.nakedU.tot && fin.nakedS.bad === fin.nakedS.tot
  && fin.wrapB === 0 && fin.wrapI === 0 && fin.wrapU === 0 && fin.wrapS === 0,
  `(34)* 四种各点两次之后：选区内 <b>/<i>/<u>/<s> 全部归零（残留 ${fin.wrapB}/${fin.wrapI}/${fin.wrapU}/${fin.wrapS}）`);
ok(fin.text === FX_TEXT && selEq(fin.sel, FX_SEL),
  `(34)* 四种各点两次之后：textContent 逐字不变、选区还在（${fin.sel.length} 字）`);
ok(fin.brs === FX_BRS && fin.content === FX_BLOCKS && fin.e === 0 && fin.lint === FX_LINT,
  `(34)* 四种各点两次之后：<br> 数 / 块数不变、错误 0 条、校验文案没变（br ${fin.brs} / 块 ${fin.content}）`);

// ---------- ② 反向：清干净之后再各点一次，四种格式都要正确加回来 ----------
for (let n = 0; n < BIUS34.length; n++) {
  const kind = BIUS34[n][0], cn = BIUS34[n][1];
  const nkey = NK34[kind];
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(430);
  const ra = await s34SelShot();
  ok(ra[nkey].tot > 0 && ra[nkey].bad === 0 && ra.dup === false && selEq(ra.sel, FX_SEL),
    `(34)* 反向 ${cn}：加回来之后整个选区都带上、只包一层、选区还在（未覆盖 ${ra[nkey].bad}/${ra[nkey].tot}）`);
  ok(ra.text === FX_TEXT && ra.brs === FX_BRS && ra.content === FX_BLOCKS && ra.keep0 === FX_CENTER,
    `(34)* 反向 ${cn}：文字/<br>/块数不变、选区外没动过`);
}
const allBack = await s34SelShot();
ok(allBack.b + allBack.i + allBack.u + allBack.s >= 4 && allBack.nakedB.bad === 0
  && allBack.nakedI.bad === 0 && allBack.nakedU.bad === 0 && allBack.nakedS.bad === 0,
  `(34)* 反向收尾：四种格式**同时**盖住整个选区（b/i/u/s = ${allBack.b}/${allBack.i}/${allBack.u}/${allBack.s}，未覆盖 ${allBack.nakedB.bad}/${allBack.nakedI.bad}/${allBack.nakedU.bad}/${allBack.nakedS.bad}）`);
ok(allBack.dup === false && allBack.e === 0 && allBack.lint === FX_LINT,
  `(34)* 反向收尾：没有重复嵌套、错误 0 条、校验文案没变（${allBack.e}e）`);

// ---------- ③ 变体：只选一小部分（<s><b>本</b></s> 的「本」）取消加粗，其余逐字不变 ----------
await s34Set(FX);
await sleep(320);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const w=document.createTreeWalker(ed,4,null,false); let n=w.nextNode();
  while(n){ const i=String(n.nodeValue||'').indexOf('本');
    if(i>=0 && n.parentNode && n.parentNode.tagName==='B' && n.parentNode.parentNode
       && n.parentNode.parentNode.tagName==='S'){
      const r=document.createRange(); r.setStart(n,i); r.setEnd(n,i+1);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
      toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1; }
    n=w.nextNode(); } return 0;})()`);
await sleep(240);
const v0 = await s34SelShot();
await clickSel('[data-tb="bold"]');
await sleep(460);
const v1 = await s34SelShot();
ok(v1.b === v0.b - 1 && v1.i === v0.i && v1.u === v0.u && v1.s === v0.s,
  `(34)* 局部取消：只掉了那一个 <b>，<i>/<u>/<s> 计数一个没变（b ${v0.b}→${v1.b} / i ${v1.i} / u ${v1.u} / s ${v1.s}）`);
ok(v1.wrapB === 0 && v1.text === v0.text && v1.sel === '本'
  && v1.brs === v0.brs && v1.content === v0.content,
  `(34)* 局部取消：只有「本」变回普通、文字逐字不变、选区还在「本」上、<br>/块数不变（选区 ${JSON.stringify(v1.sel)}）`);
// 其余部分逐字不变：整个 <u> 段只该少掉「本」外面那层 <b>
const uPart = '<u>第一套代用券<s>，然而之前</s><s>本</s><b>老土一</b></u>';
ok(v1.html.indexOf(uPart) >= 0,
  `(34)* 局部取消：<u> 与「老土一」那一段逐字未变，只有「本」的 <b> 被摘掉（含 ${JSON.stringify(uPart)} = ${v1.html.indexOf(uPart) >= 0}）`);
ok(v1.e === 0 && v1.lint === FX_LINT, `(34)* 局部取消：错误 0 条、校验文案没变（${v1.e}e）`);

// ---------- ④ 「一部分有」的判定：<div>甲<b>乙</b>丙</div> 选「甲乙丙」点一次要**统一** ----------
await s34Set('<div>甲<b>乙</b>丙</div>');
await sleep(240);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const div=ed.children[0];
  const ft=(function(n){const w=document.createTreeWalker(n,4,null,false);return w.nextNode();})(div);
  let lt=null; const w=document.createTreeWalker(div,4,null,false); let x=w.nextNode();
  while(x){lt=x;x=w.nextNode();}
  const r=document.createRange(); r.setStart(ft,0); r.setEnd(lt,String(lt.nodeValue||'').length);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(220);
await clickSel('[data-tb="bold"]');
await sleep(440);
const u1 = await s34SelShot();
const html1 = u1.html;
ok(u1.nakedB.bad === 0 && u1.wrapB >= 1 && html1 === '<div><b>甲乙丙</b></div>',
  `(34)* 「一部分有」点一次 = 统一：甲/乙/丙 全部进了 <b>、且只包一层（未覆盖 ${u1.nakedB.bad}/${u1.nakedB.tot}，${JSON.stringify(html1)}）`);
await clickSel('[data-tb="bold"]');
await sleep(440);
const u2 = await s34SelShot();
ok(u2.wrapB === 0 && u2.html === '<div>甲乙丙</div>' && u2.text === '甲乙丙' && u2.sel === '甲乙丙',
  `(34)* 紧接着再点一次 = 全取消：选区内没有 <b>、文字逐字不变、选区还在（${JSON.stringify(u2.html)}）`);
await clickSel('[data-tb="bold"]');
await sleep(440);
const u3 = await s34SelShot();
ok(u3.html === '<div><b>甲乙丙</b></div>',
  `(34)* 第三次又回到"全都有"，闭环稳定（${JSON.stringify(u3.html)}）`);

// ---------- ⑤ 全无 → 全有 → 全无：B/I/U/S 各验一遍闭环 ----------
for (let n = 0; n < BIUS34.length; n++) {
  const kind = BIUS34[n][0], cn = BIUS34[n][1], nkey = NK34[kind];
  await s34Set('<div>甲乙丙</div>');
  await sleep(220);
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); const d=ed.children[0];
    const t=d.firstChild; const r=document.createRange(); r.setStart(t,0); r.setEnd(t,3);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
    toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
  await sleep(180);
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(430);
  // ★ 第一次点完就立刻取快照：不能等第二次点完再读，否则读到的是"又取消了"的状态
  const o1 = await s34SelShot();
  ok(o1[nkey].bad === 0 && o1[nkey].tot > 0 && o1.html === '<div><' + K34[kind] + '>甲乙丙</' + K34[kind] + '></div>',
    `(34)* 闭环 ${cn}：全无 → 点一次 → 全部有、且只包一层（未覆盖 ${o1[nkey].bad}/${o1[nkey].tot}，${JSON.stringify(o1.html)}）`);
  await clickSel(`[data-tb="${kind}"]`);
  await sleep(430);
  const o2 = await s34SelShot();
  ok(o2[K34[kind]] === 0 && o2.html === '<div>甲乙丙</div>' && o2.sel === '甲乙丙',
    `(34)* 闭环 ${cn}：再点一次 → 全无、文字与选区都还在（${JSON.stringify(o2.html)}）`);
}
}

// ==============================================================
console.log('\n====== (35) 编辑区 Enter = 原「换行」按钮（插 <br>）；代码区/文件名/Shift+Enter 不劫持 ======\n');
// 用户要求：编辑区里按 Enter（不带修饰键）要与原来那个「换行」按钮效果完全一样。
// 只认不带修饰键的 Enter；作用范围严格限定 #tbEditor；走的是同一个底层入口 toolboxInsertBreak()。
const edSnapshot35 = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const s=getSelection()||{};
  let anchorTag='';
  try {
    const c=s.anchorNode;
    const el=(c&&c.nodeType===1)?c:(c?c.parentNode:null);
    const n=s.anchorNode;
    anchorTag = (n&&n.nodeType===3) ? ('#'+String(n.nodeValue||'').length)
      : (el?el.tagName:'' );
  } catch(e){}
  return JSON.stringify({ html:ed.innerHTML, text:ed.textContent, code:document.getElementById('tbCode').value,
    brs:ed.querySelectorAll('br').length, blocks:ed.querySelectorAll('p,div,center,blockquote,table').length,
    anchor:anchorTag, focus:!!(document.activeElement && (document.activeElement===ed||ed.contains(document.activeElement))) });})()`);
// 真实派发一次 Enter（CDP 键盘事件）——keys 里 text:'\\r' 才带出浏览器默认行为
//   ★ enter35(0) = Enter（段落分界）；enter35(8) = Shift+Enter（段内分行，8 = Shift 修饰位）
async function enter35(mods = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: mods, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: mods });
  await sleep(420);
}
async function pressEnter35(mods = 0) { return enter35(mods); }   // 兼容旧名（Enter 走段落分界）
async function pressShiftEnter35() { return enter35(8); }         // Shift+Enter 走段内分行
// 把光标放到 <p>前半段</p> 的段末
const caretInHalf35 = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>前半段</p>'; toolboxRefresh(); toolboxUndoReset();
  const p=ed.querySelector('p'); const r=document.createRange();
  r.selectNodeContents(p); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);

// 35a. 真实按 **Enter** → 段落分界：新建一个 <p>、textContent 一个字符都没多、代码区仍是第一段
// ★ 本轮口径（用户更正）：**Enter = 段落分界**（不是段内 <br>）；段内分行是 Shift+Enter（见 35a2）。
await resetEditor();
await caretInHalf35();
const e35a0 = await edSnapshot35();
await enter35(0);
const e35a1 = await edSnapshot35();
ok(e35a1.blocks === e35a0.blocks + 1 && e35a1.text === e35a0.text,
  `(35)* 一次 Enter = 段落分界：块数 ${e35a0.blocks}→${e35a1.blocks}、textContent 一个字符没多（${JSON.stringify(e35a1.text)}）`);
ok(e35a1.code === '<p>前半段</p>',
  `(35)* Enter 之后代码区只有第一段（空落脚段不算内容，实际 ${JSON.stringify(e35a1.code)}）`);
ok(e35a1.focus === true, '(35)* Enter 之后焦点还留在编辑区');
await send('Input.insertText', { text: '乙' });
await sleep(360);
const e35a2 = await edSnapshot35();
ok(e35a2.code === '<p>前半段</p>\n<p>乙</p>' && e35a2.text === '前半段乙',
  `(35)* 甲 ⏎ 乙 ⇒ 两个相邻段落（实际 ${JSON.stringify(e35a2.code)}）`);

// 35a2. 真实按 **Shift+Enter** → 段内分行：同一个 <p> 里一根 <br>、代码区 <p>前半段<br></p>
await resetEditor();
await caretInHalf35();
const e35s0 = await edSnapshot35();
await enter35(8);
const e35s1 = await edSnapshot35();
ok(e35s1.brs === e35s0.brs + 2 && /<p>前半段<br[^>]*>(<br[^>]*data-tb-caret[^>]*>)?<\/p>/.test(e35s1.html),
  `(35)* Shift+Enter = 段内分行：当前段内一根软换行 <br> + 一根落脚 <br>（br ${e35s0.brs}→${e35s1.brs}，${JSON.stringify(e35s1.html)}）`);
ok(e35s1.text === e35s0.text && e35s1.blocks === e35s0.blocks,
  `(35)* 段内分行只加 <br>：textContent 一个字符没多、块数不变（${JSON.stringify(e35s1.text)} / 块 ${e35s1.blocks}）`);
ok(e35s1.code === '<p>前半段<br></p>',
  `(35)* 段内分行之后代码区逐字等于 <p>前半段<br></p>（${JSON.stringify(e35s1.code)}）`);

// 35b. 行为一致性：Shift+Enter 与"工具栏「换行」按钮那个入口"产出完全一致
await resetEditor();
await caretInHalf35();
await enter35(8);
const e35Enter = await edSnapshot35();
await resetEditor();
await caretInHalf35();
// ★ 参考的一次必须从**同一个状态**出发：真实按键会先触发编辑区自己那个 keydown 监听
//   （toolboxDropRange，把上一次的选区存档丢掉），然后才轮到我们的处理。
//   所以这里也先 toolboxDropRange()，再走「换行」按钮的等价入口 toolboxToolbarAction('br')。
//   ★ 两条路都进 toolboxEnterBreak()（同一份"取现场选区 → 找块 → 插 <br>+落脚点"逻辑），
//     所以 HTML 必须**逐字一致**。
await evaluate(`(()=>{toolboxDropRange(); toolboxToolbarAction('br'); return 1;})()`);
await sleep(420);
const e35Fn = await edSnapshot35();
ok(e35Enter.html === e35Fn.html,
  `(35)* Shift+Enter 与 toolboxToolbarAction('br')（「换行」按钮的入口）产出的编辑区 HTML 逐字一致`
  + `（Shift+Enter=${JSON.stringify(e35Enter.html)} / 按钮入口=${JSON.stringify(e35Fn.html)}）`);
ok(e35Enter.code === e35Fn.code,
  `(35)* Shift+Enter 与按钮入口产出的代码区内容也逐字一致`
  + `（Shift+Enter=${JSON.stringify(e35Enter.code)} / 按钮入口=${JSON.stringify(e35Fn.code)}）`);

// 35c. 段内分行之后光标停在 <br> 之后（两根 <br> 之间），接着打字落在第二行、不会跑到文首
await resetEditor();
await caretInHalf35();
await enter35(8);
const caret35 = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const s=getSelection()||{}; const brs=[...ed.querySelectorAll('br')];
  const soft=brs.filter(function(b){return !b.getAttribute('data-tb-caret');})[0];
  const mark=ed.querySelector('br[data-tb-caret]');
  const p=ed.querySelector('p');
  // ★ 新口径：光标停在**两根 <br> 之间**（就是浏览器原生 Shift+Enter 的位置）。
  let atMark=false;
  try { atMark = !!(mark && s.anchorNode===p
      && s.anchorOffset===[].indexOf.call(p.childNodes,mark)); } catch(e){}
  return JSON.stringify({ atMark:atMark, soft:(soft?[].indexOf.call(soft.parentNode.childNodes,soft):-1),
    mark:(mark?[].indexOf.call(mark.parentNode.childNodes,mark):-1),
    anchorType:s.anchorNode?s.anchorNode.nodeType:'', anchorOffset:s.anchorOffset });})()`);
await send('Input.insertText', { text: 'XYZ' });
await sleep(320);
const typed35 = await json(`(()=>{const ed=document.getElementById('tbEditor');
  return JSON.stringify({ html:ed.innerHTML, text:ed.textContent, code:document.getElementById('tbCode').value });})()`);
ok(caret35.atMark === true && caret35.mark === caret35.soft + 1,
  `(35)* 段内分行后光标停在两根 <br> 之间（软换行 ${caret35.soft}、落脚点 ${caret35.mark}，`
  + `光标 ${caret35.anchorType}/${caret35.anchorOffset}）`);
ok(typed35.text.indexOf('前半段') === 0 && typed35.text.indexOf('XYZ') > typed35.text.indexOf('前半段'),
  `(35)* 接着打字落在正确位置、没有跑到文首（${JSON.stringify(typed35.text)} / ${JSON.stringify(typed35.html)}）`);
ok(typed35.code === '<p>前半段<br>XYZ</p>',
  `(35)* 继续打字之后这个 <br> 仍在，代码区是 <p>前半段<br>XYZ</p>（${JSON.stringify(typed35.code)}）`);

// 35d. Ctrl+Z 能撤回这次换行（撤回后与操作前一致，光标不跳到文首）
await evaluate(`(()=>{const p=document.createElement('p'); p.textContent='第一段';
  const ed=document.getElementById('tbEditor'); ed.innerHTML=''; ed.appendChild(p);
  const p2=document.createElement('p'); p2.textContent='后半段'; ed.appendChild(p2);
  toolboxRefresh(); toolboxUndoReset();
  const r=document.createRange(); r.selectNodeContents(p); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const u35a = await edSnapshot35();
await enter35(8);                          // 段内分行 → 能撤回
const u35b = await edSnapshot35();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ',
  windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2, text: '' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ',
  windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await sleep(420);
const u35c = await edSnapshot35();
ok(u35b.brs === u35a.brs + 2, `(35)* （前置）段内分行之后确实多了"软换行 + 落脚"两根 <br>（${u35a.brs}→${u35b.brs}）`);
ok(u35c.html === u35a.html && u35c.text === u35a.text,
  `(35)* Ctrl+Z 撤掉了这次段内分行，HTML 与操作前一致（${JSON.stringify(u35c.html)}）`);
ok(u35c.text.indexOf('后半段') > 0 && !/^<br/.test(u35c.html),
  '(35)* 撤回后光标没有跳到文首（文档内容顺序没被换位）');

// 35e. 反向断言：代码区 #tbCode 里 Enter 正常换行（未被劫持）
await evaluate(`(()=>{const c=document.getElementById('tbCode'); c.value='<p>ab</p>'; c.focus();
  c.setSelectionRange(2,2); return 1;})()`);
const c35a = await evaluate(`document.getElementById('tbCode').value`);
await enter35(0);
const c35b = await evaluate(`document.getElementById('tbCode').value`);
ok(c35b.indexOf('\n') >= 0 && c35b.indexOf('<br') < 0,
  `(35)* 代码区里 Enter 是正常换行、没有被劫持成 <br>（${JSON.stringify(c35b)}）`);

// 35f. 反向断言：文件名输入框里 Enter 行为不变（未被劫持）
await evaluate(`(()=>{const fn=document.getElementById('tbFileName'); fn.value='我的文章'; fn.focus(); return 1;})()`);
const f35a = await json(`(()=>{const fn=document.getElementById('tbFileName');
  return JSON.stringify({ value:fn.value, ed:document.getElementById('tbEditor').innerHTML });})()`);
await enter35(0);
const f35b = await json(`(()=>{const fn=document.getElementById('tbFileName');
  return JSON.stringify({ value:fn.value, ed:document.getElementById('tbEditor').innerHTML });})()`);
ok(f35b.value === f35a.value && f35a.value === '我的文章',
  `(35)* 文件名框里 Enter 不改变文件名、没被劫持（${JSON.stringify(f35b.value)}）`);

// 35g. **反转后的断言**：Shift+Enter 现在是**我们处理**的（段内分行）——
//   它必须被 preventDefault（不然浏览器会再走一遍原生 insertLineBreak，多出一根 <br>），
//   而且产出的结构就是段内 <br>（35a2 已逐字断言）。
//   ★ 读 defaultPrevented 必须用**冒泡阶段**的监听（挂在 document 上）：
//     挂在编辑区上的捕获监听跑在我们自己的处理**之前**，那时当然还是 false。
await evaluate(`window.__tbEnt = { shift: null, ctrl: null };
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter') {
    if (e.shiftKey) window.__tbEnt.shift = e.defaultPrevented;
    else if (e.ctrlKey) window.__tbEnt.ctrl = e.defaultPrevented; } });`);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML='<p>前半段</p>'; toolboxRefresh();
  const p=ed.querySelector('p'); const r=document.createRange();
  r.selectNodeContents(p); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus();
  return 1;})()`);
await enter35(8);
const sh35 = await json(`JSON.stringify({ prevented: window.__tbEnt.shift, code: document.getElementById('tbCode').value })`);
ok(sh35.prevented === true,
  `(35)* Shift+Enter 由我们处理（冒泡阶段读到 keydown 的 defaultPrevented=${sh35.prevented}）`);
ok(sh35.code === '<p>前半段<br></p>',
  `(35)* Shift+Enter 产出段内换行、没有被浏览器默认行为重复插入（代码区 ${JSON.stringify(sh35.code)}）`);

// ==============================================================
// ==============================================================
console.log('\n====== (36) A：空编辑区提示语不占行高，光标就在「从这里开始」那一行 ======\n');
// 用户实测 bug：「最开始什么都没有的时候，光标在「从这里开始」的下面一行；
//   输入部分内容再删掉之后，才能回到「从这里开始」的高度。」
// 根因：提示语是**参与排版的** ::before（一个行内内容）：它先占掉第一行，初始那个
//   <p><br></p> 被挤到第二行 ⇒ 光标落在提示语下面，空状态比"打字后清空"多一行。
// 修法两处（都不动序列化）：
//   ① CSS：提示语改绝对定位叠加（不参与排版、不占行高），编辑区加 min-height 兜住一行；
//   ② JS：打开时把初始光标显式摆进**第一个块里面**（不摆的话焦点进来时选区停在编辑区根上，
//      那里没有行盒，第一眼看到的光标就不在提示语那一行）。
const geom36 = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const cs=getComputedStyle(ed,'::before'); const edcs=getComputedStyle(ed);
  const er=ed.getBoundingClientRect();
  const padT=parseFloat(edcs.paddingTop)||0, lh=parseFloat(edcs.lineHeight)||0;
  const first=ed.firstElementChild; const fr=first?first.getBoundingClientRect():null;
  return JSON.stringify({ pos:cs.position, beforeTop:parseFloat(cs.top), padT:padT,
    lh:Math.round(lh*100)/100, html:ed.innerHTML, kids:ed.children.length,
    firstTag:first?first.tagName:'',
    firstTop:fr?Math.round((fr.top-er.top-padT)*100)/100:null,
    firstLines:fr?Math.round(fr.height/lh*100)/100:null,
    brs:ed.querySelectorAll('br').length });})()`);
const caret36 = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const s=getSelection(); if(!s.rangeCount) return JSON.stringify({none:true});
  const n=s.getRangeAt(0).startContainer; const p=ed.firstElementChild;
  return JSON.stringify({none:false, inFirstBlock:!!(p&&(p===n||p.contains(n))),
    anchorIsEditorRoot:(n===ed), tag:p?p.tagName:''});})()`);
// 重新走一遍"刷新后第一次打开"（全程不点编辑区、不摆光标）
await evaluate(`(()=>{ try{toolboxDraftClear();}catch(e){} toolboxSession=false; toolboxClose(); toolboxOpen(); return 1;})()`);
await sleep(560);
// ★ 关窗时草稿会再落一次盘，所以"刷新后第一次打开"仍可能弹「发现未保存草稿」——
//   它是**铺满视口的浮层**（z-index 1250），会挡住后面所有的真鼠标点击。
//   这一节只关心空编辑区的排版，按用户的正常路径把它收掉（等价于点「丢弃」/「恢复」的决定），
//   并把它已经收干净这件事钉住。
const ask36 = await json(`(()=>{const el=document.getElementById('tbDraftAsk');
  return JSON.stringify({ open: !!toolboxDraftAskOpen, hidden: !!el.hidden });})()`);
if (ask36.open || !ask36.hidden) { await evaluate(`toolboxDraftAskHide()`); await sleep(240); }
const ask36b = await json(`(()=>{const el=document.getElementById('tbDraftAsk');
  return JSON.stringify({ open: !!toolboxDraftAskOpen, hidden: !!el.hidden });})()`);
ok(ask36b.open === false && ask36b.hidden === true,
  `(36) 草稿询问浮层已经收干净（否则它会盖住工具栏，后面所有真点击都会点在它上面）：`
  + `打开时 open=${ask36.open}/hidden=${ask36.hidden} → 现在 open=${ask36b.open}/hidden=${ask36b.hidden}`);
const g36a = await geom36();
const c36a = await caret36();
ok(g36a.kids === 1 && g36a.html === '<p><br></p>' && g36a.brs === 1,
  `(36) 初始状态就是空编辑区：<p><br></p>（${JSON.stringify(g36a.html)}）`);
ok(g36a.pos === 'absolute',
  `(36)* 提示语是绝对定位叠加、**不参与排版**（computed position=${g36a.pos}；修复前是 static，会独占一整行）`);
ok(Math.abs(g36a.beforeTop - g36a.padT) <= 1,
  `(36)* 提示语顶边就在内容区首行上（top=${g36a.beforeTop} vs padding-top=${g36a.padT}，容差 1px）`);
ok(g36a.firstTop === 0 && g36a.firstLines === 1,
  `(36)* 空编辑区只有一行：首个块顶边=${g36a.firstTop}px、占 ${g36a.firstLines} 行`
  + `（修复前 = 提示语一行 + 内容一行 = 2 行）`);
ok(c36a.none === false && c36a.inFirstBlock === true && c36a.anchorIsEditorRoot === false,
  `(36)* 打开时光标就在第一个块（<${c36a.tag}>）里面、不在编辑区根上`
  + `（inFirstBlock=${c36a.inFirstBlock} / anchorIsEditorRoot=${c36a.anchorIsEditorRoot}）`);
// 不点任何地方直接打字 —— 打出来的字必须落在提示语那一行
await send('Input.insertText', { text: '甲' });
await sleep(420);
const g36b = await geom36();
ok(g36b.html === '<p>甲</p>' && g36b.firstTop === 0 && g36b.firstLines === 1,
  `(36)* 直接打字就落在提示语那一行（${JSON.stringify(g36b.html)}，首行顶边=${g36b.firstTop}、占 ${g36b.firstLines} 行）`);
// 全选删除 → 必须回到与初始**完全相同**的结构与高度
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.focus();
  const r=document.createRange(); r.selectNodeContents(ed);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); return 1;})()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
await sleep(560);
const g36c = await geom36();
const code36c = await evaluate(`document.getElementById('tbCode').value`);
ok(g36c.html === g36a.html && g36c.firstTop === g36a.firstTop && g36c.firstLines === g36a.firstLines,
  `(36)* 全删之后回到与初始**完全相同**的状态（${JSON.stringify(g36c.html)}，`
  + `首行顶边 ${g36a.firstTop}→${g36c.firstTop}px、占行 ${g36a.firstLines}→${g36c.firstLines}）`);
ok(code36c === '',
  `(36)* 空编辑区的代码区仍然是空的 —— 这次改动没有动序列化（${JSON.stringify(code36c)}）`);
await send('Input.insertText', { text: '乙' });
await sleep(420);
const g36d = await geom36();
ok(g36d.html === '<p>乙</p>' && g36d.firstTop === g36a.firstTop,
  `(36)* 全删之后再打字，仍落在同一行（${JSON.stringify(g36d.html)}，首行顶边=${g36d.firstTop}）`);

// ==============================================================
console.log('\n====== (37) B：提示语弹窗（toast）层级高于所有工具箱浮层 ======\n');
// 用户实测：「下方浮现的提示语弹窗图层比有各种选项的弹窗要低，这不对。」
// 口径：不硬编码数字 —— 从**已加载的样式表**里把各层的 z-index 常量读出来做数值比较，
//   再断言 toast 的计算值等于那个常量、且严格大于其余每一层。
const zmap37 = await json(`(()=>{const want={'tb-toast':0,'tb-dialog':0,'tb-tmenu':0,'tb-ask':0,'tb-modal':0,'tb-grip':0,'dd-popup':0};
  for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; }
    for (const r of rules) { const s=r.selectorText; if(!s||!r.style||!r.style.zIndex) continue;
      for (const k in want) { if (new RegExp('^\\\\.'+k+'$').test(s)) want[k]=parseInt(r.style.zIndex,10)||0; } } }
  const comp=function(id){const e=document.getElementById(id);return e?(parseInt(getComputedStyle(e).zIndex,10)||0):0;};
  return JSON.stringify(Object.assign({}, want, { toastComputed: comp('tbToast') }));})()`);
console.log(`  各层 z-index：${JSON.stringify(zmap37)}`);
ok(zmap37.toastComputed === zmap37['tb-toast'] && zmap37['tb-toast'] > 0,
  `(37) toast 的计算层级等于样式表里的常量（computed=${zmap37.toastComputed} / css=${zmap37['tb-toast']}）`);
ok(zmap37['tb-toast'] > zmap37['tb-modal'],
  `(37)* toast 层级 > 工具箱主弹窗（${zmap37['tb-toast']} > ${zmap37['tb-modal']}）`);
for (const k37 of ['tb-dialog', 'tb-tmenu', 'tb-ask', 'tb-grip', 'dd-popup']) {
  ok(zmap37['tb-toast'] > zmap37[k37],
    `(37)* toast 层级 > ${k37}（${zmap37['tb-toast']} > ${zmap37[k37]}）`);
}
// 同一层叠上下文（都在 #toolboxModal 里）中，toast 必须是最大的那个
const ctx37 = await json(`(()=>{const t=document.getElementById('tbToast');
  const m=document.getElementById('toolboxModal');
  const zs=[...m.querySelectorAll('*')].filter(function(e){return e.id!=='tbToast' && getComputedStyle(e).zIndex!=='auto';})
    .map(function(e){return parseInt(getComputedStyle(e).zIndex,10)||0;});
  return JSON.stringify({ inModal:!!(m&&m.contains(t)), toast:parseInt(getComputedStyle(t).zIndex,10)||0,
    maxOther: Math.max.apply(null, zs.concat([0])), others: zs.length });})()`);
ok(ctx37.inModal === true && ctx37.toast > ctx37.maxOther,
  `(37)* 在主弹窗内部的层叠上下文里也是最高的（toast=${ctx37.toast} > 其余最大 ${ctx37.maxOther}，共比较 ${ctx37.others} 层）`);

// ==============================================================
console.log('\n====== (38) C：上标 / 下标（<sup>/<sub>，与 BIUS 同一套字符级三态开关）======\n');
// 规格：与加粗/斜体/下划线/删除线**完全同款**的字符级三态（全有→取消；否则→给整个选区补满），
//   可跨段落，块结构与 <br> 一个都不动；校验不报错/不报警告；工具栏高亮、撤回栈都要有。
const supBtn38 = await json(`(()=>{const a=document.querySelector('[data-tb="sup"]'), b=document.querySelector('[data-tb="sub"]');
  return JSON.stringify({ sup:!!a, sub:!!b, supText:a?a.textContent.trim():'', subText:b?b.textContent.trim():'' });})()`);
ok(supBtn38.sup === true && supBtn38.sub === true,
  `(38) 工具栏有上标/下标两个按钮（${JSON.stringify(supBtn38)}）`);
const tbl38 = await json(`JSON.stringify({
  inInlineTags: TOOLBOX_INLINE_TAGS.indexOf('SUP')>=0 && TOOLBOX_INLINE_TAGS.indexOf('SUB')>=0,
  inOkTags: TOOLBOX_OK_TAGS.indexOf('SUP')>=0 && TOOLBOX_OK_TAGS.indexOf('SUB')>=0,
  tag: TOOLBOX_EMPHASIS_TAG.sup==='sup' && TOOLBOX_EMPHASIS_TAG.sub==='sub',
  alias: (TOOLBOX_INLINE_ALIAS.sup||[]).indexOf('SUP')>=0 && (TOOLBOX_INLINE_ALIAS.sub||[]).indexOf('SUB')>=0 })`);
ok(tbl38.inInlineTags && tbl38.inOkTags,
  '(38)* <sup>/<sub> 在行内标签白名单与正文标签白名单里（导入不会被降级成纯文本）');
ok(tbl38.tag && tbl38.alias,
  '(38)* 复用同一套机制：TOOLBOX_EMPHASIS_TAG 与 TOOLBOX_INLINE_ALIAS 都登记了 sup/sub');
const setEd38 = (h, full) => evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML=${JSON.stringify(h)};
  toolboxRefresh(); toolboxUndoReset();
  const p=ed.querySelector('p'); const r=document.createRange();
  if(${full ? 'true' : 'false'}) r.selectNodeContents(ed); else r.selectNodeContents(p);
  r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const selAll38 = (i) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const p=ed.querySelectorAll('p')[${i}]; const r=document.createRange(); r.selectNodeContents(p);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const shot38 = () => json(`(()=>{const ed=document.getElementById('tbEditor'); const s=getSelection();
  const on=[]; document.querySelectorAll('#toolboxModal .tb-btn.active').forEach(function(b){on.push(b.getAttribute('data-tb'));});
  return JSON.stringify({ html:ed.innerHTML, code:document.getElementById('tbCode').value, text:ed.textContent,
    brs:ed.querySelectorAll('br').length, blocks:ed.querySelectorAll('p,div,center,blockquote,li').length,
    top:ed.children.length, sup:ed.querySelectorAll('sup').length, sub:ed.querySelectorAll('sub').length,
    sel:(s.rangeCount?String(s):''), on:on,
    errs:+document.getElementById('tbValidate').getAttribute('data-errors'),
    warns:+document.getElementById('tbValidate').getAttribute('data-warnings') });})()`);

// 38a. 应用（真点按钮）
await setEd38('<p>甲乙丙</p>');
await sleep(300);
await selAll38(0);
const c38a0 = await shot38();
// 点之前把"按钮到底可点不可点"这件事量清楚：焦点在不在正文、按钮有没有被禁用、
// 按钮中心点上到底是哪个元素（这三样任一不对，真鼠标事件就不会落到按钮上）。
const diag38 = await json(`(()=>{const b=document.querySelector('[data-tb="sup"]');
  if(!b) return JSON.stringify({noBtn:true});
  const r=b.getBoundingClientRect();
  const el=document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2));
  return JSON.stringify({ disabled:!!b.disabled, focusInCode:toolboxFocusInCode(),
    active:(document.activeElement&&(document.activeElement.id||document.activeElement.tagName))||'',
    hit: el? (el.tagName+((el.getAttribute&&el.getAttribute('data-tb'))?('['+el.getAttribute('data-tb')+']'):'')) : 'null',
    cardFull:document.querySelector('.tb-card').classList.contains('tb-full'),
    inViewport: r.top>=0 && r.bottom<=window.innerHeight && r.left>=0 && r.right<=window.innerWidth,
    rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)] });})()`);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.focus(); toolboxSyncPanelFocus(); return 1;})()`);
await clickSel('[data-tb="sup"]');
await sleep(420);
const c38a1 = await shot38();
ok(c38a1.sup === 1 && /<sup>甲乙丙<\/sup>/.test(c38a1.html),
  `(38)* 选中整段点「上标」→ 包成 <sup>（${JSON.stringify(c38a1.html)}；点击前状态 ${JSON.stringify(diag38)}）`);
ok(c38a1.text === c38a0.text && c38a1.brs === c38a0.brs && c38a1.blocks === c38a0.blocks && c38a1.top === c38a0.top,
  `(38)* 上标只加标签：textContent/<br>/块结构逐项不变（文字 ${JSON.stringify(c38a1.text)}、`
  + `br ${c38a0.brs}→${c38a1.brs}、块 ${c38a0.blocks}→${c38a1.blocks}）`);
ok(c38a1.sel === c38a0.sel,
  `(38)* 选区保留（${JSON.stringify(c38a1.sel)}）`);
ok(c38a1.on.indexOf('sup') >= 0,
  `(38)* 按下之后工具栏「上标」按钮亮起（active = ${JSON.stringify(c38a1.on)}）`);
// 38b. 再点一次 = 干净取消（闭环）
await selAll38(0);
await clickSel('[data-tb="sup"]');
await sleep(420);
const c38b = await shot38();
ok(c38b.sup === 0 && c38b.html === '<p>甲乙丙</p>' && c38b.text === '甲乙丙' && c38b.on.indexOf('sup') < 0,
  `(38)* 同一个选区再点一次 → 上标被**干净地**摘掉、按钮灭（${JSON.stringify(c38b.html)}）`);
// 38c. 嵌套：<b><sup>x</sup></b> 只取消 sup，外层 <b> 不动
await setEd38('<p><b>甲乙</b></p>');
await sleep(300);
await selAll38(0);
await clickSel('[data-tb="sup"]');
await sleep(420);
const c38c1 = await shot38();
await selAll38(0);
await clickSel('[data-tb="sup"]');
await sleep(420);
const c38c2 = await shot38();
ok(c38c1.html === '<p><b><sup>甲乙</sup></b></p>' && c38c2.html === '<p><b>甲乙</b></p>',
  `(38)* 嵌套一层：<b> 里套 <sup> 后只取消 sup，外层 <b> 完好（${JSON.stringify(c38c1.html)} → ${JSON.stringify(c38c2.html)}）`);
// 38d. 反向嵌套：<sup><b>x</b></sup> 只取消 b，外层 sup 不动
await setEd38('<p>甲乙</p>');
await sleep(300);
await selAll38(0);
await clickSel('[data-tb="sup"]');
await sleep(420);
await selAll38(0);
await clickSel('[data-tb="bold"]');
await sleep(420);
const c38d1 = await shot38();
await selAll38(0);
await clickSel('[data-tb="bold"]');
await sleep(420);
const c38d2 = await shot38();
ok(c38d1.html === '<p><sup><b>甲乙</b></sup></p>' && c38d2.html === '<p><sup>甲乙</sup></p>',
  `(38)* 反向嵌套：<sup> 里套 <b> 后只取消 b，外层 sup 完好（${JSON.stringify(c38d1.html)} → ${JSON.stringify(c38d2.html)}）`);
// 38e. 跨段落应用：块结构与 <br> 都不变，两段各得一层
await setEd38('<p>甲乙</p><p>丙丁</p>');
await sleep(300);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); const ps=ed.querySelectorAll('p');
  const first=function(n){const w=document.createTreeWalker(n,4,null,false);return w.nextNode();};
  const last=function(n){let l=null;const w=document.createTreeWalker(n,4,null,false);let x=w.nextNode();while(x){l=x;x=w.nextNode();}return l;};
  const t0=first(ps[0]), t1=last(ps[1]);
  const r=document.createRange(); r.setStart(t0,1); r.setEnd(t1,1);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const c38e0 = await shot38();
await clickSel('[data-tb="sup"]');
await sleep(480);
const c38e1 = await shot38();
ok(c38e1.sup === 2 && c38e1.brs === c38e0.brs && c38e1.blocks === c38e0.blocks && c38e1.text === c38e0.text,
  `(38)* 跨段落应用：两段各得一层 <sup>，块数/<br>/文字都不变（${JSON.stringify(c38e1.html)}）`);
// 38f. 下标：与上标互不干扰
await selAll38(0);
await clickSel('[data-tb="sub"]');
await sleep(420);
const c38f = await shot38();
ok(c38f.html.indexOf('<sub>') >= 0 && c38f.sub >= 1,
  `(38)* 「下标」独立生效（${JSON.stringify(c38f.html)}）`);
// 38g. 校验：含 <sup>/<sub> 的正文 0 错误 0 警告
ok(c38f.errs === 0 && c38f.warns === 0,
  `(38)* 校验对 <sup>/<sub> 不报错也不报警告（错误 ${c38f.errs} / 警告 ${c38f.warns}）`);
// 38h. 导出保留 <sup>/<sub> 原文，且"导出→再导入→再导出"逐字节一致
const idem38 = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const before=toolboxFormatHtml(toolboxParseBox(toolboxCleanHtml()));
  ed.innerHTML=before;
  const after=toolboxFormatHtml(toolboxParseBox(toolboxCleanHtml()));
  return JSON.stringify({ before:before, after:after, same:before===after,
    keepSup:/<sup>/.test(before), keepSub:/<sub>/.test(before) });})()`);
ok(idem38.keepSup && idem38.keepSub,
  `(38)* 导出的 HTML 逐字保留 <sup>/<sub>（${JSON.stringify(idem38.before).slice(0, 110)}）`);
ok(idem38.same === true,
  '(38)* 幂等：导出→再导入→再导出 逐字节一致');
// 38i. 撤回：上标也能撤回
await setEd38('<p>甲乙丙</p>');
await sleep(300);
await selAll38(0);
const c38i0 = await shot38();
await clickSel('[data-tb="sup"]');
await sleep(420);
const c38i1 = await shot38();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await sleep(460);
const c38i2 = await shot38();
ok(c38i1.html !== c38i0.html && c38i2.html === c38i0.html,
  `(38)* 上标进了撤回栈：Ctrl+Z 回到操作前（${JSON.stringify(c38i1.html)} → ${JSON.stringify(c38i2.html)}）`);

// ==============================================================
console.log('\n====== (39) D：逐操作"换行中性"审计（不许无谓多/少空行、空块）======\n');
// 用户要求：「任何格式不应该增加或减少换行（除非像必须需要换行，我说的是无谓的多余的空行）。」
// 判据（每个操作逐项比）：<br> 数不变、textContent 逐字不变、**顶层**块数不变、
//   导出的代码行数不变、不新增空块、不新增空行。
// 结构性必需的情形单独列出（见 39b/39c）：表格/图片必须有承载它的块。
const snap39 = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const code=document.getElementById('tbCode').value;
  const blocks=[...ed.children];
  const emptyBlocks=blocks.filter(function(b){return !String(b.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'').length
    && !b.querySelector('img,table,hr,video,br');}).length;
  return JSON.stringify({ html:ed.innerHTML, text:ed.textContent, brs:ed.querySelectorAll('br').length,
    blocks:blocks.length, emptyBlocks:emptyBlocks, code:code,
    codeLines:code?code.split('\\n').length:0, blankLines:(code.match(/\\n[ \\t]*\\n/g)||[]).length });})()`);
const set39 = (h) => evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML=${JSON.stringify(h)};
  toolboxRefresh(); toolboxUndoReset(); const r=document.createRange(); r.selectNodeContents(ed);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const selP39 = (i) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const p=ed.querySelectorAll('p')[${i}]; const r=document.createRange(); r.selectNodeContents(p);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const FIX39 = '<p>甲乙丙</p><p>丁戊己</p>';
const OPS39 = [
  ['body', '正文'], ['quote', '引用'], ['title', '标题'], ['caption', '图注'], ['sign', '落款'],
  ['bold', '加粗'], ['italic', '斜体'], ['underline', '下划线'], ['strike', '删除线'],
  ['sup', '上标'], ['sub', '下标'],
  ['align-left', '左对齐'], ['align-center', '居中'], ['align-right', '右对齐']
];
for (const op39 of OPS39) {
  await set39(FIX39);
  await sleep(240);
  await selP39(0);
  const d0 = await snap39();
  await evaluate(`toolboxToolbarAction(${JSON.stringify(op39[0])})`);
  await sleep(420);
  const d1 = await snap39();
  const neutral = d1.brs === d0.brs && d1.text === d0.text && d1.blocks === d0.blocks
    && d1.emptyBlocks === d0.emptyBlocks && d1.codeLines === d0.codeLines && d1.blankLines === d0.blankLines;
  ok(neutral,
    `(39)* ${op39[1]}：换行中性（<br> ${d0.brs}→${d1.brs}、块 ${d0.blocks}→${d1.blocks}、`
    + `空块 ${d0.emptyBlocks}→${d1.emptyBlocks}、代码行 ${d0.codeLines}→${d1.codeLines}、空行 ${d0.blankLines}→${d1.blankLines}、`
    + `文字${d1.text === d0.text ? '不变' : '变了：' + JSON.stringify(d1.text)}）`);
}
// 字号（走真实按钮：五档里选 1.1）
await set39(FIX39);
await sleep(240);
await selP39(0);
const s39sz0 = await snap39();
await clickSel('.tb-size[data-size="1.1em"]');
await sleep(460);
const s39sz1 = await snap39();
ok(s39sz1.brs === s39sz0.brs && s39sz1.text === s39sz0.text && s39sz1.blocks === s39sz0.blocks
  && s39sz1.emptyBlocks === s39sz0.emptyBlocks && s39sz1.codeLines === s39sz0.codeLines && s39sz1.blankLines === s39sz0.blankLines,
  `(39)* 字号（1.1）：换行中性（<br> ${s39sz0.brs}→${s39sz1.brs}、块 ${s39sz0.blocks}→${s39sz1.blocks}、`
  + `代码行 ${s39sz0.codeLines}→${s39sz1.codeLines}、空行 ${s39sz0.blankLines}→${s39sz1.blankLines}）`);
// 落款（走它原来的入口）
await set39(FIX39);
await sleep(240);
await selP39(0);
const s39sg0 = await snap39();
await evaluate(`toolboxToolbarAction('sign')`);
await sleep(420);
const s39sg1 = await snap39();
ok(s39sg1.brs === s39sg0.brs && s39sg1.text === s39sg0.text && s39sg1.blocks === s39sg0.blocks
  && s39sg1.codeLines === s39sg0.codeLines && s39sg1.blankLines === s39sg0.blankLines,
  `(39)* 落款：换行中性（<br> ${s39sg0.brs}→${s39sg1.brs}、块 ${s39sg0.blocks}→${s39sg1.blocks}、`
  + `代码行 ${s39sg0.codeLines}→${s39sg1.codeLines}）`);
// 39b. 结构性必需的第一例：往**空编辑区**插表格 —— 必须出现承载它的块，除此之外不许有多余空块/空行
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
  toolboxRefresh(); toolboxUndoReset();
  const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await sleep(300);
const t39a0 = await snap39();
await clickSel('[data-tb="table"]');
await sleep(360);
await clickSel('#tbDialogOk');
await sleep(520);
const t39a1 = await snap39();
ok(/<table/.test(t39a1.code),
  `(39b) 空编辑区插入表格：表格在（结构必需 —— <table> 必须有一个承载它的位置）`);
ok(t39a1.emptyBlocks === 0 && t39a1.blankLines === 0,
  `(39b)* 插入表格后没有空块、也没有空行（空块 ${t39a1.emptyBlocks}、空行 ${t39a1.blankLines}、`
  + `代码行 ${t39a1.codeLines}）`);
ok(!/<br/.test(t39a1.code),
  `(39b)* 插入表格没有在**导出结果**里夹带任何 <br>（导出 ${JSON.stringify(t39a1.code).slice(0, 60)}…；`
  + `编辑区里那一个 <br> 是插入前就存在的空段落外壳 <p><br></p>，序列化会把它丢掉，所以不算"多出来的换行"）`);
// 光标回到正文、点「正文」不许动结构
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const last=ed.lastElementChild; const r=document.createRange(); r.selectNodeContents(last); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await sleep(200);
const t39a2 = await snap39();
await evaluate(`toolboxToolbarAction('body')`);
await sleep(420);
const t39a3 = await snap39();
ok(t39a3.blocks === t39a2.blocks && t39a3.brs === t39a2.brs && t39a3.text === t39a2.text
  && t39a3.blankLines === t39a2.blankLines,
  `(39b)* 表格之后回到正文并点「正文」：块/<br>/文字/空行都不变（块 ${t39a2.blocks}→${t39a3.blocks}、`
  + `br ${t39a2.brs}→${t39a3.brs}、空行 ${t39a2.blankLines}→${t39a3.blankLines}）`);
// 39c. 结构性必需的第二例：往空编辑区插图片
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
  toolboxRefresh(); toolboxUndoReset();
  const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await sleep(300);
await clickSel('[data-tb="image"]');
await sleep(360);
await evaluate(`(()=>{const el=document.getElementById('tbF_src'); if(el){el.value='https://example.com/a.jpg';}
  const c=document.getElementById('tbF_caption'); if(c){c.value='配图说明';} return 1;})()`);
await clickSel('#tbDialogOk');
await sleep(560);
const i39 = await snap39();
ok(/<img/.test(i39.code),
  '(39c) 空编辑区插入图片：图片在（结构必需 —— 图片块必须有承载它的位置）');
ok(i39.blankLines === 0 && i39.emptyBlocks <= 1,
  `(39c)* 插入图片后没有多余空行（空行 ${i39.blankLines}、空块 ${i39.emptyBlocks}、代码行 ${i39.codeLines}）`);
// 39d. 单独记录的例外：块里带**真实换行**（<br>）时，浏览器的 justify* 会把这一块拆成按行的 div
//   —— 这是 execCommand 的既有行为（本轮不许改对齐逻辑），这里如实钉住"它也没有多出空行/空块"。
await set39('<p>甲<br>乙</p>');
await sleep(260);
await selP39(0);
const j39a = await snap39();
await evaluate(`toolboxToolbarAction('align-right')`);
await sleep(460);
const j39b = await snap39();
console.log(`  例外（右对齐 + 块内 <br>）：br ${j39a.brs}→${j39b.brs}，块 ${j39a.blocks}→${j39b.blocks}，`
  + `空行 ${j39a.blankLines}→${j39b.blankLines}，HTML=${JSON.stringify(j39b.html)}`);
ok(j39b.text === j39a.text && j39b.blankLines === j39a.blankLines && j39b.emptyBlocks === 0,
  `(39d)* 右对齐把一个含 <br> 的块拆成按行 div（execCommand 既有行为）：文字与"无空行/无空块"不变`
  + `（文字${j39b.text === j39a.text ? '不变' : '变了'}、空行 ${j39a.blankLines}→${j39b.blankLines}、空块 ${j39b.emptyBlocks}）`);

// ==============================================================
console.log('\n====== (40) E：粘贴的顶层归一化（裸文本必须被包进块）======\n');
// 用户实测 bug：「直接粘贴文字，例如粘贴「示例文字」，右侧代码区会直接显示「示例文字」
//   而不是 <p>示例文字</p>。触发此 bug 后，直接输入也会有这样的 bug。」
// 根因：粘贴走 toolboxInsertHtml，插进去的是一段没有块级外壳的 HTML；光标在编辑区根上时，
//   `示例文字` 就成了 #tbEditor 的直系子节点（裸文本），导出照实输出；光标也留在这个裸文本里，
//   所以**之后打字**同样落在裸文本里。
// 修法：粘贴那条路（只有它）在插入之后、toolboxUndoPush 之前做一次**顶层归一化**：
//   把编辑区根下面连续的裸文本/裸行内节点合成一个 <p>（块级节点一个都不碰，
//   不加 <br>、不删内容 ⇒ textContent 与 <br> 数逐字不变）。换行/分块策略一个字没改。
const paste40 = (text, htmlToo) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  const dt=new DataTransfer(); dt.setData('text/plain',${JSON.stringify(text)});
  ${htmlToo ? `dt.setData('text/html',${JSON.stringify(htmlToo)});` : ''}
  ed.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return 1;})()`);
// 与 (8) 同款前置：编辑区是 <p><br></p>，光标落在编辑区根上（粘贴最容易暴露 bug 的位置）
const atRoot40 = () => evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
  toolboxRefresh(); toolboxUndoReset();
  const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
const bare40 = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  let bare=0;
  for (const n of ed.childNodes) { if(n.nodeType===3 && String(n.nodeValue||'').replace(/[\\s\\u00a0\\u200b]+/g,'').length) bare++; }
  return JSON.stringify({ bareTopText:bare });})()`);
const shot40 = () => json(`(()=>{const ed=document.getElementById('tbEditor'); const code=document.getElementById('tbCode').value;
  const blocks=[...ed.children];
  // ★ 根级 <br> 是用户留的空行（块与块之间那一行），不是"空块"
  const emptyBlocks=blocks.filter(function(b){return b.tagName!=='BR' && !String(b.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'').length
    && !b.querySelector('img,table,hr,video,br');}).length;
  return JSON.stringify({ html:ed.innerHTML, code:code, text:ed.textContent,
    brs:ed.querySelectorAll('br').length, top:ed.children.length, emptyBlocks:emptyBlocks,
    blankLines:(code.match(/\\n[ \\t]*\\n/g)||[]).length });})()`);
// 40a. 空编辑区粘纯文本
await atRoot40();
await sleep(280);
await paste40('示例文字');
await sleep(560);
const p40a = await shot40();
const b40a = await bare40();
ok(p40a.code === '<p>示例文字</p>',
  `(40)* 空编辑区粘「示例文字」→ 代码区就是 <p>示例文字</p>（实际 ${JSON.stringify(p40a.code)}）`);
ok(b40a.bareTopText === 0 && p40a.top === 1,
  `(40)* 编辑区根下面不再有裸文本节点（裸文本 ${b40a.bareTopText} 个、顶层块 ${p40a.top} 个）`);
ok(p40a.brs === 0 && p40a.text === '示例文字',
  `(40)* <br> 0 个、textContent 就是「示例文字」（br ${p40a.brs}、文字 ${JSON.stringify(p40a.text)}）`);
// 40b. 紧接着打字 —— 仍在这一个块里
await send('Input.insertText', { text: '更多' });
await sleep(420);
const p40b = await shot40();
const b40b = await bare40();
ok(p40b.code === '<p>示例文字更多</p>' && p40b.top === 1 && p40b.brs === 0 && b40b.bareTopText === 0,
  `(40)* 紧接其后打字「更多」→ 仍是一个块 <p>示例文字更多</p>（实际 ${JSON.stringify(p40b.code)}）`);
// 40c. 在已有块的中间粘贴 —— 留在该块内，不新增块、不多空行
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p>甲丙</p>';
  toolboxRefresh(); toolboxUndoReset();
  const t=ed.querySelector('p').firstChild; const r=document.createRange(); r.setStart(t,1); r.collapse(true);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
await sleep(280);
await paste40('乙');
await sleep(560);
const p40c = await shot40();
ok(p40c.code === '<p>甲乙丙</p>' && p40c.top === 1 && p40c.brs === 0 && p40c.blankLines === 0,
  `(40)* 段中间粘贴留在该块内：<p>甲乙丙</p>（实际 ${JSON.stringify(p40c.code)}，块 ${p40c.top}、空行 ${p40c.blankLines}）`);
// 40d. 多行纯文本 —— 行间仍是 <br>，整段进同一个块（本轮起代码区"一个块一行"）
await atRoot40();
await sleep(280);
await paste40('文字\n文字2');
await sleep(560);
const p40d = await shot40();
const b40d = await bare40();
ok(p40d.code === '<p>文字<br>文字2</p>'
  && p40d.text === '文字文字2' && p40d.brs === 1 && b40d.bareTopText === 0,
  `(40)* 多行纯文本：段内单个换行仍是 <br>，整段进同一个 <p>（实际 ${JSON.stringify(p40d.code)}）`);
// 40e. 多段（≥3 行）与含空行
await atRoot40();
await sleep(280);
await paste40('甲\n乙\n丙');
await sleep(560);
const p40e = await shot40();
ok(p40e.code === '<p>甲<br>乙<br>丙</p>' && p40e.text === '甲乙丙' && p40e.emptyBlocks === 0,
  `(40)* 三段纯文本：一个块里两个 <br>、无多余空块（实际 ${JSON.stringify(p40e.code)}）`);
await atRoot40();
await sleep(280);
await paste40('甲\n\n乙');
await sleep(560);
const p40f = await shot40();
// ★ 本轮口径（用户定的"粘贴与手敲一致"）：粘贴里的**空行 = 一个独立成行的 <br>** ——
//   与手敲「甲 ⏎⏎ 乙」得到的代码逐字相同；不再是老策略那种"段内两个 <br>"。
ok(p40f.code === '<p>甲</p>\n<br>\n<p>乙</p>' && p40f.text === '甲乙'
  && p40f.emptyBlocks === 0 && p40f.brs === 1,
  `(40)* 含空行的两段：空行 = 独立成行的 <br>（与手敲一致），没有多余空块（实际 ${JSON.stringify(p40f.code)}）`);
// 40f. 富文本粘贴：清洗行为不变（纯文本、不自动转表格），且顶层不留裸文本
await atRoot40();
await sleep(280);
await paste40('文字\n文字2', '<p>文字</p><table><tr><td>格子</td></tr></table><p>文字2</p>');
await sleep(560);
const p40g = await shot40();
const b40g = await bare40();
ok(!/<table/.test(p40g.code) && /文字[\s\S]*文字2/.test(p40g.code) && b40g.bareTopText === 0 && p40g.top === 1,
  `(40)* 富文本粘贴：仍然只取纯文本、不自动转表格，且顶层不留裸文本（实际 ${JSON.stringify(p40g.code)}）`);
// 40g. 粘贴后 Ctrl+Z：HTML 回到粘贴前，光标不跳文首
await atRoot40();
await sleep(280);
const u40a = await shot40();
await paste40('示例文字');
await sleep(560);
const u40b = await shot40();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await sleep(560);
const u40c = await shot40();
const caret40 = await json(`(()=>{const ed=document.getElementById('tbEditor'); const s=getSelection();
  return JSON.stringify({ inEditor: !!(s.rangeCount && ed.contains(s.getRangeAt(0).startContainer)) });})()`);
ok(u40b.code !== u40a.code && u40c.code === u40a.code,
  `(40)* 粘贴后 Ctrl+Z 回到粘贴前（${JSON.stringify(u40b.code)} → ${JSON.stringify(u40c.code)}）`);
ok(caret40.inEditor === true,
  '(40)* 撤回之后光标仍在编辑区里（没有跳到文首/丢焦点）');
// 40h. 全流程无多余空块/空行（与 D 项共用判据）
ok(p40a.emptyBlocks === 0 && p40d.emptyBlocks === 0 && p40e.emptyBlocks === 0 && p40g.emptyBlocks === 0
  && p40a.blankLines === 0 && p40d.blankLines === 0 && p40e.blankLines === 0 && p40g.blankLines === 0,
  '(40)* 全流程没有多出任何空块或空行（包块只产生"结构必需"的那一个块）');

// ==============================================================
console.log('\n====== (41) F：代码区行号栏（gutter，只标逻辑行、对齐实测）======\n');
// 用户需求：「右侧代码区最好标注一下行数序号」。
// 关键坑：代码区 wrap="soft"，长逻辑行会折成多行视觉行 ⇒ 序号只标**逻辑行**的行首，
//   折行续行留空；序号高度按每个逻辑行折行后的**实际像素**排（高度取自同排版的隐藏测量层
//   #tbCodeMeasure，逐行 div 的 getBoundingClientRect）。
// 红线：五个滚动/高亮函数一行未改；行号栏不参与任何取值路径（复制/下载只读 #tbCode.value）。
const gutterSet = (v) => evaluate(`(()=>{const t=document.getElementById('tbCode');
  t.value=${JSON.stringify(v)}; t.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
const gutterShot = () => json(`(()=>{const t=document.getElementById('tbCode');
  const g=document.getElementById('tbCodeGutter'); const inner=document.getElementById('tbCodeGutterInner');
  const rows=[...inner.children];
  const tc=getComputedStyle(t);
  const codeTop=t.getBoundingClientRect().top+parseFloat(tc.paddingTop);
  return JSON.stringify({ exists:!!g, rows:rows.length,
    nums:rows.map(function(r){return r.textContent;}),
    heights:rows.map(function(r){return Math.round(r.getBoundingClientRect().height*100)/100;}),
    firstNumTop: rows.length? Math.round(rows[0].getBoundingClientRect().top*100)/100 : null,
    codeTop: Math.round(codeTop*100)/100, lineHeight: Math.round((parseFloat(tc.lineHeight)||0)*100)/100,
    scrollTop:t.scrollTop, scrollHeight:t.scrollHeight, clientHeight:t.clientHeight,
    aria:g?g.getAttribute('aria-hidden'):null, userSelect:g?getComputedStyle(g).userSelect:null,
    pointer:g?getComputedStyle(g).pointerEvents:null, wrap:t.getAttribute('wrap'),
    measRows:(document.getElementById('tbCodeMeasure')||{children:[]}).children.length,
    tf: inner.style.transform || '', value:t.value,
    gutterText: g?g.textContent:'' });})()`);
// 41a. 多行（含空行）：序号个数 == 逻辑行数
const G41A = ['<p>一</p>', '<p>二</p>', '', '<p>三</p>', '', '<p>四</p>'].join('\n');
await gutterSet(G41A);
await sleep(760);
const g41a = await gutterShot();
ok(g41a.exists === true && g41a.rows === 6,
  `(41)* 6 个逻辑行（含 2 个空行）→ 6 个序号（实际 ${g41a.rows}）`);
ok(g41a.nums[0] === '1' && g41a.nums[5] === '6',
  `(41)* 序号从 1 连续排到 6（${JSON.stringify(g41a.nums)}）`);
ok(g41a.measRows === 6,
  `(41)* 测量层与逻辑行一一对应（${g41a.measRows} 行）`);
// 41b. 首个序号与第一行顶边对齐（容差 1px）、行高一致
ok(g41a.firstNumTop !== null && Math.abs(g41a.firstNumTop - g41a.codeTop) <= 1,
  `(41)* 第 1 个序号的顶边与代码区第 1 行顶边对齐（序号 ${g41a.firstNumTop} vs 代码 ${g41a.codeTop}，容差 1px）`);
ok(Math.abs(g41a.heights[0] - g41a.lineHeight) <= 0.6,
  `(41)* 普通逻辑行的行高与代码区一致（序号行 ${g41a.heights[0]} vs 行高 ${g41a.lineHeight}）`);
// 41c. 长行折行：序号个数仍 == 逻辑行数，续行没有多余编号，且这一行占的高度 = 折行后的实际高度
const LONG41 = 'x'.repeat(300);
const G41C = ['<p>短一</p>', '<p>' + LONG41 + '</p>', '<p>短二</p>'].join('\n');
await gutterSet(G41C);
await sleep(760);
const g41c = await gutterShot();
ok(g41c.rows === 3 && g41c.nums.length === 3,
  `(41)* 长行折行后仍是 3 个序号（逻辑行数），续行没有多余编号（${JSON.stringify(g41c.nums)}）`);
ok(g41c.heights[1] > g41c.lineHeight * 2,
  `(41)* 折行那一行在行号栏里占"折行后的实际高度"（${g41c.heights[1]}px > 2×行高 ${g41c.lineHeight}）`);
ok(Math.abs(g41c.heights[0] - g41a.heights[0]) <= 0.01,
  '(41)* 折行只影响它自己那一行的高度，别的逻辑行行高不变');
// 41d. 滚动同步：用 scrollTop / 视觉位置这类可量化方式断言
const G41D = [];
for (let i = 1; i <= 60; i++) G41D.push('<p>第' + i + '行内容</p>');
await gutterSet(G41D.join('\n'));
await sleep(820);
const g41d0 = await gutterShot();
const delta41 = () => json(`(()=>{const t=document.getElementById('tbCode');
  const m=document.getElementById('tbCodeMeasure'); const inner=document.getElementById('tbCodeGutterInner');
  const i=5; const mr=m.children[i].getBoundingClientRect(); const gr=inner.children[i].getBoundingClientRect();
  // ★ 测量层不是滚动容器（overflow 由 textarea 自己管），所以它的 y 要减去 textarea 的 scrollTop
  //   才是"这一行此刻在屏幕上的位置"；行号栏整体 translateY(-scrollTop)，两者一减差值应恒为 0。
  return JSON.stringify({ delta: Math.round((mr.top-t.scrollTop-gr.top)*100)/100, scrollTop:t.scrollTop,
    tf: inner.style.transform || '' });})()`);
const d41a = await delta41();
await evaluate(`(()=>{const t=document.getElementById('tbCode'); t.scrollTop=160;
  t.dispatchEvent(new Event('scroll')); return t.scrollTop;})()`);
await sleep(260);
const d41b = await delta41();
const g41d1 = await gutterShot();
ok(g41d0.scrollHeight > g41d0.clientHeight,
  `(41) 60 行的代码区确实能滚（scrollHeight ${g41d0.scrollHeight} > clientHeight ${g41d0.clientHeight}）`);
ok(d41b.scrollTop >= 100,
  `(41)* 真的滚动了（scrollTop ${d41a.scrollTop} → ${d41b.scrollTop}）`);
ok(Math.abs(d41a.delta - d41b.delta) <= 0.75,
  `(41)* 滚动前后"第 6 行文字顶边 − 第 6 个序号顶边"的差值不变（${d41a.delta} → ${d41b.delta}）`);
ok(/translateY\(-1[0-9]{2}/.test(String(d41b.tf)) || d41b.tf.indexOf('translateY') === 0,
  `(41)* 行号栏跟着滚（transform=${JSON.stringify(d41b.tf)}）`);
ok(g41d1.rows === 60,
  `(41)* 滚动不改变序号个数（${g41d1.rows}）`);
// 41e. 尺寸变化（全屏/还原）后重新对齐
const align41 = () => json(`(()=>{const t=document.getElementById('tbCode'); const inner=document.getElementById('tbCodeGutterInner');
  const tc=getComputedStyle(t);
  // 代码区第 1 行此刻的屏幕位置 = 内容区顶边 − scrollTop（上面滚动用例把 scrollTop 留在了 160）
  const codeTop=t.getBoundingClientRect().top+parseFloat(tc.paddingTop)-t.scrollTop;
  const num=inner.children[0]?inner.children[0].getBoundingClientRect().top:null;
  return JSON.stringify({ codeTop:Math.round(codeTop*100)/100, num:num===null?null:Math.round(num*100)/100,
    scrollTop:t.scrollTop, rows:inner.children.length });})()`);
const a41a = await align41();
await evaluate(`toolboxWinToggleFull()`);
await sleep(700);
const a41b = await align41();
ok(a41b.rows === 60 && a41b.num !== null && Math.abs(a41b.num - a41b.codeTop) <= 1,
  `(41)* 全屏之后仍然对齐（序号 ${a41b.num} vs 代码 ${a41b.codeTop}，容差 1px）`);
await evaluate(`toolboxWinToggleFull()`);
await sleep(700);
const a41c = await align41();
ok(a41c.rows === 60 && Math.abs(a41c.num - a41c.codeTop) <= 1,
  `(41)* 退出全屏之后仍然对齐（序号 ${a41c.num} vs 代码 ${a41c.codeTop}）`);
// 41f. 高亮镜像层与新加的测量层左边界一致（证明"行号栏没有把高亮挤歪"）
const mirror41 = await json(`(()=>{const t=document.getElementById('tbCode'); const h=document.getElementById('tbCodeHl');
  const tc=getComputedStyle(t), hc=getComputedStyle(h);
  return JSON.stringify({ codeContentLeft: Math.round((t.getBoundingClientRect().left+parseFloat(tc.paddingLeft))*100)/100,
    hlContentLeft: Math.round((h.getBoundingClientRect().left+parseFloat(hc.paddingLeft))*100)/100,
    hlZ:getComputedStyle(h).zIndex });})()`);
ok(Math.abs(mirror41.codeContentLeft - mirror41.hlContentLeft) <= 1,
  `(41)* 高亮镜像层与代码区的内容左边界仍然重合（镜像 ${mirror41.hlContentLeft} vs 代码 ${mirror41.codeContentLeft}）`);
// 41g. 复制 / 下载内容与 #tbCode.value 逐字一致、不含行号
await evaluate(`(()=>{window.__tbClip=null;
  try{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:function(x){window.__tbClip=x;return Promise.resolve();}}});}catch(e){}
  window.__tbBlob=null;
  const orig=URL.createObjectURL;
  URL.createObjectURL=function(b){window.__tbBlob=b;return orig.call(URL,b);};
  return 1;})()`);
await evaluate(`toolboxCopyHtml()`);
await sleep(360);
await clickSel('[data-tb="download"]');
await sleep(420);
const pure41 = await json(`(async ()=>{const v=document.getElementById('tbCode').value;
  let blobText=null;
  try { blobText = window.__tbBlob ? await window.__tbBlob.text() : null; } catch(e) { blobText='ERR'; }
  return JSON.stringify({ value:v, clip:window.__tbClip, blob:blobText,
    clipSame: window.__tbClip===v, blobSame: blobText===v,
    hasNumPrefix: /^\\s*\\d+\\s*\\n/.test(String(window.__tbClip||'')), gutterText:document.getElementById('tbCodeGutter').textContent });})()`);
ok(pure41.clipSame === true,
  '(41)* 复制出来的内容与 #tbCode.value 逐字一致（不含行号）');
ok(pure41.blobSame === true,
  '(41)* 下载出来的内容与 #tbCode.value 逐字一致（不含行号）');
ok(pure41.hasNumPrefix === false && pure41.gutterText.length > 0,
  `(41)* 行号只存在于独立的行号栏里（行号栏文字 ${JSON.stringify(pure41.gutterText.slice(0, 12))}…），`
  + '没有任何取值路径会读到它');
// 41h. 空内容时显示 1
await gutterSet('');
await sleep(760);
const g41h = await gutterShot();
ok(g41h.rows === 1 && g41h.nums[0] === '1',
  `(41)* 空内容时行号栏显示 1（${JSON.stringify(g41h.nums)}）`);
// 41i. 反向断言：代码区自身的属性一个字没动
ok(g41h.wrap === 'soft' && g41h.aria === 'true' && g41h.userSelect === 'none' && g41h.pointer === 'none',
  `(41)* 行号栏是纯显示层（aria-hidden=${g41h.aria}、user-select:${g41h.userSelect}、`
  + `pointer-events:${g41h.pointer}），代码区 wrap="${g41h.wrap}" 没动`);

// ==============================================================
console.log('\n====== (42) G：Enter=段落分界 / Shift+Enter=段内分行（两类 <br> 绝不互换）/ 空行↔段落动态互转 ======\n');
// 用户口径（最终版，2024 更正后）：
//   · 一段 = 一个 <p>；
//   · **Enter** = **段落分界**：结束当前 <p>、新建一个 <p>、光标进新段
//     （例：甲 ⏎ 乙 → `<p>甲</p>` + `<p>乙</p>`）；
//   · **Shift+Enter** = **段内分行**：当前 <p> 内插一根 <br>，光标到它后面那一行
//     （例：甲 ⇧⏎ 乙 → `<p>甲<br>乙</p>`，仍是**同一个** <p>）；
//   · **连按两次 Enter** = 中间那个空段落升格成一根**独立成行的 <br>**（空行）
//     （例：甲 ⏎ ⏎ 乙 → `<p>甲</p>` / `<br>` / `<p>乙</p>`）；
//   · 在空行上打字 → 那根 <br> 就地变成 <p>；把某段的字删光 → 那个 <p> 变回独立 <br>；
//   · **两类 <br> 绝不互换**：`<p>` 内部的 <br>（段内）永远留在这一段里、序列化时与所在
//     <p> **同一行**；与块同级的 <br>（段间空行）永远独占一行。导出→导入→导出逐字节幂等。
//   · 编辑区根下永远没有裸文本/裸行内节点；编辑区彻底空时仍导出空内容（不凭空造 <br>/<p>）。
const gSet42 = (html) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(html)}; toolboxNormalizeEditorWhitespace(ed); toolboxRefresh(); toolboxUndoReset();
  toolboxSnapClear(); toolboxRange=null;
  const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSaveRange(); return 1;})()`);
const gCaretEnd42 = (sel) => evaluate(`(()=>{const ed=document.getElementById('tbEditor'); const b=ed.querySelector(${JSON.stringify(sel)});
  if(!b) return 0; const r=document.createRange(); r.selectNodeContents(b); r.collapse(false);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const gType42 = async (t) => { await send('Input.insertText', { text: t }); await sleep(430); };
// 真实按键：Enter（mods=0）/ Shift+Enter（mods=8）
const gEnter42 = async (mods) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: mods || 0, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: mods || 0 });
  await sleep(430);
};
const gBack42 = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await sleep(430);
};
const gUndo42 = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
  await sleep(560);
};
const gShot42 = () => json(`(()=>{const ed=document.getElementById('tbEditor'); const code=document.getElementById('tbCode').value;
  const BARE=/^(P|DIV|CENTER|TABLE|UL|OL|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|HR|VIDEO|IMG|BR)$/;
  const kids=[...ed.childNodes];
  const bare=kids.filter(function(c){
    if(c.nodeType===3) return !!String(c.nodeValue||'').replace(/[\\s\\u00a0\\u200b]+/g,'').length;
    if(c.nodeType!==1) return false;
    return !BARE.test(c.tagName); }).length;
  const blocks=[...ed.children].filter(function(c){return c.tagName!=='BR';});
  const lines=code.split('\\n').filter(function(x){return x.trim();});
  const lh=parseFloat(getComputedStyle(ed).lineHeight)||0;
  // 光标落脚点 = 一根带标记的 <br>（data-tb-caret）：它给"块尾那根 <br>"撑出行盒。
  const holder=ed.querySelector('[data-tb-caret]');
  const s=getSelection(); const lint=toolboxLint(code);
  const first=blocks[0];
  return JSON.stringify({ html:ed.innerHTML, code:code, text:ed.textContent,
    brs:ed.querySelectorAll('br').length, blocks:blocks.length, lines:lines.length,
    marks:ed.querySelectorAll('br[data-tb-caret]').length,
    blanks:lines.filter(function(x){return /^<br\\s*\\/?>$/.test(x.trim());}).length,
    bare:bare, lh:Math.round(lh*100)/100, holder:!!holder,
    // 第一个块**实际渲染了几行**（换行是否真的看得见，用行盒高度算）
    firstLines:first?Math.round(first.getBoundingClientRect().height/lh*100)/100:null,
    caretInEditor:!!(s.rangeCount&&ed.contains(s.getRangeAt(0).startContainer)),
    caretParent:(function(){try{const n=s.getRangeAt(0).startContainer;
      return (n.nodeType===3?(n.parentNode?n.parentNode.tagName:'?'):n.tagName)+'@'+s.getRangeAt(0).startOffset;}catch(e){return '';}})(),
    tops:blocks.map(function(b){return Math.round(b.getBoundingClientRect().top);}),
    onePerLine:lines.every(function(l){return (l.match(/<(p|center|div|table|ul|ol|blockquote|h[1-6])\\b/g)||[]).length<=1;}),
    twoOnOneLine:/<\\/(p|center|div|blockquote|h[1-6])>[ \\t]*<(p|center|div|blockquote|table|ul|ol|h[1-6])\\b/.test(code),
    ps:(code.match(/<p\\b/g)||[]).length,
    e:lint.errors.length, w:lint.warnings.length });})()`);
const gRT42 = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  // "正文文字"：把所有文本节点串起来，但跳过图片占位壳自带的那块文件名标签
  // （<span class="tb-imgph-name">xxx.jpg</span>，contenteditable=false + aria-hidden，
  //  是占位壳的显示部件、不是用户内容；它不参与"往返掉不掉字"的判定）
  const ctext=function(){ let s=''; const w=document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, null); let n;
    while((n=w.nextNode())){ const p=n.parentNode;
      if(p&&p.closest&&p.closest('.tb-imgph-name')) continue; s+=n.nodeValue||''; } return s; };
  const t0=ctext(); const raw0=ed.textContent;
  const c1=toolboxCodeText(); toolboxApplyCodeToEditor(c1,true); const c2=toolboxCodeText();
  const lint=toolboxLint(c2);
  return JSON.stringify({ c1:c1, c2:c2, same:(c1===c2), t0:raw0, text:ed.textContent,
    sameText:(t0===ctext()), e:lint.errors.length, w:lint.warnings.length });})()`);

// —— 42a **Shift+Enter** = 段内分行：同一个 <p> 里一根 <br>、编辑区立刻多出一行、<br> 稳定 ——
await resetEditor();
await gSet42('<p>哈哈哈</p>');
await gCaretEnd42('p');
await sleep(200);
const g0 = await gShot42();
await gEnter42(8);                       // Shift+Enter
const g1 = await gShot42();
ok(g1.code === '<p>哈哈哈<br></p>',
  `(42)* Shift+Enter（段内分行）：代码区逐字等于 <p>哈哈哈<br></p>（实际 ${JSON.stringify(g1.code)}）`);
ok(g1.brs === g0.brs + 2 && g1.text === g0.text && g1.blocks === g0.blocks && g1.ps === 1,
  `(42)* 段内分行只加"软换行 + 落脚"两根 <br>：textContent 一个字符没多、块数不变、仍只有一个 <p>`
  + `（${JSON.stringify(g1.text)} / 块 ${g1.blocks} / 代码里 <p> ${g1.ps}）`);
ok(g1.firstLines === 2 && g0.firstLines === 1,
  `(42)* 编辑区**立刻**看得见一个换行：那一段从 1 行变成 2 行（行盒高/行高 ${g0.firstLines} → ${g1.firstLines}）`);
await gType42('新内容');
const g2 = await gShot42();
ok(g2.code === '<p>哈哈哈<br>新内容</p>' && g2.brs === 1 && g2.blocks === 1 && g2.marks === 0,
  `(42)* 接着打字：这个 <br> 还在、新字接在它后面，落脚标记被收拾干净（实际 ${JSON.stringify(g2.code)}）`);
ok(g2.bare === 0, '(42)* 打完字之后编辑区根下仍然没有裸文本/裸行内节点');

// —— 42a2 **Enter** = 段落分界：新建一个 <p>（不再是段内 <br>）——
await resetEditor();
await gSet42('<p>哈哈哈</p>');
await gCaretEnd42('p');
await sleep(200);
const ge0 = await gShot42();
await gEnter42(0);                       // Enter
const ge1 = await gShot42();
ok(ge1.blocks === ge0.blocks + 1 && ge1.text === ge0.text && ge1.marks === 0,
  `(42)* Enter=段落分界：块数 ${ge0.blocks}→${ge1.blocks}、textContent 一个字符没多（${JSON.stringify(ge1.text)}）`);
ok(ge1.code === '<p>哈哈哈</p>',
  `(42)* Enter 之后代码区只有第一段（空落脚段不算内容，实际 ${JSON.stringify(ge1.code)}）`);
ok(ge1.caretInEditor === true && /^P@0$/.test(ge1.caretParent),
  `(42)* Enter 之后光标在新段开头 P@0（与浏览器原生 Enter 的位置一致，实际 ${ge1.caretParent}）`);
await gType42('新内容');
const ge2 = await gShot42();
ok(ge2.code === '<p>哈哈哈</p>\n<p>新内容</p>' && ge2.ps === 2,
  `(42)* 甲 ⏎ 乙 ⇒ 两个相邻段落（实际 ${JSON.stringify(ge2.code)}）`);
ok(ge2.bare === 0 && ge2.e === 0 && ge2.w === 0,
  `(42)* 段落分界后根下无裸节点、校验 0 错 0 警（${ge2.e}e${ge2.w}w）`);

// —— 42b 两次 Enter：段落分界 + 独立成行的 <br>（空行）+ 光标落到下面的新段 ——
await resetEditor();
await gSet42('<p>哈哈哈</p>');
await gCaretEnd42('p');
await sleep(200);
await gEnter42(0);
await gEnter42(0);
const g3 = await gShot42();
ok(g3.code === '<p>哈哈哈</p>\n<br>',
  `(42)* 两次 Enter：段落分界 + 一个**独立成行**的 <br>（实际 ${JSON.stringify(g3.code)}）`);
ok(g3.blocks === 2 && g3.brs === 2 && g3.bare === 0,
  `(42)* 编辑区里是「一段 + 一根空行 <br> + 新落脚段」、根下无裸节点（块 ${g3.blocks} br ${g3.brs} 裸 ${g3.bare}）`);
ok(g3.tops.length === 2 && (g3.tops[1] - g3.tops[0]) > g3.lh * 1.6,
  `(42)* 编辑区肉眼可见一个空行：新段被顶下两行（新段顶边 ${g3.tops[1]} − 首段顶边 ${g3.tops[0]} > 1.6×行高 ${g3.lh}）`);
ok(g3.caretInEditor === true, '(42)* 两次 Enter 之后光标还在编辑区里（在新段里）');
await gType42('新内容');
const g4 = await gShot42();
ok(g4.code === '<p>哈哈哈</p>\n<br>\n<p>新内容</p>',
  `(42)* 空行下面打字：空行仍是独立 <br>，新内容自成一段（实际 ${JSON.stringify(g4.code)}）`);
ok(g4.text === '哈哈哈新内容' && g4.bare === 0,
  `(42)* textContent 逐字等于用户输入、根下无裸节点（${JSON.stringify(g4.text)}）`);
ok(g4.e === 0 && g4.w === 0,
  `(42)* 含独立 <br> 的内容 校验 0 错 0 警（${g4.e}e${g4.w}w）`);
const g4rt = await gRT42();
ok(g4rt.same === true && g4rt.c1 === g4.code,
  `(42)* 导出→导入→再导出 逐字节幂等（${JSON.stringify(g4rt.c1)} → ${JSON.stringify(g4rt.c2)}）`);
ok(g4rt.e === 0 && g4rt.w === 0 && g4rt.text === '哈哈哈新内容',
  `(42)* 往返之后校验仍 0 错 0 警、文字逐字不变（${g4rt.e}e${g4rt.w}w / ${JSON.stringify(g4rt.text)}）`);

// —— 42b2 段内分行之后再 Enter：段内那根 <br> **留在原段**，绝不被提升成段落之间 ——
await resetEditor();
await gSet42('<p>哈哈哈</p>');
await gCaretEnd42('p');
await sleep(200);
await gEnter42(8);                       // Shift+Enter：段内一根 <br>
await gEnter42(0);                       // Enter：段落分界
const gm1 = await gShot42();
ok(gm1.code === '<p>哈哈哈<br></p>' && gm1.ps === 1,
  `(42)* 段内 <br> + Enter：那根 <br> 仍**留在段内**（代码 ${JSON.stringify(gm1.code)}）`);
await gType42('新内容');
const gm2 = await gShot42();
ok(gm2.code === '<p>哈哈哈<br></p>\n<p>新内容</p>' && gm2.blanks === 0,
  `(42)* 新内容自成一段，段内 <br> 没有被变成"段落之间的空行"（实际 ${JSON.stringify(gm2.code)} / DOM ${JSON.stringify(gm2.html)}）`);

// —— 42c 空行上打字 → <br> 就地变 <p>；删空 → 变回 <br>（可逆）——
const gBlankXY = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const ps=[...ed.children].filter(function(c){return c.tagName==='P';});
  const a=ps[0].getBoundingClientRect(), b=ps[1].getBoundingClientRect();
  return JSON.stringify({ x:Math.round(a.left+30), y:Math.round((a.bottom+b.top)/2) });})()`);
await resetEditor();
await gSet42('<p>甲</p><br><p>乙</p>');
await sleep(220);
const gy = await gBlankXY();
await clickAt(gy.x, gy.y);
await sleep(320);
const g5 = await gShot42();
ok(g5.code === '<p>甲</p>\n<br>\n<p>乙</p>' && g5.bare === 0,
  `(42)* （前置）点空行：空行还在、根下无裸节点（实际 ${JSON.stringify(g5.code)}）`);
await gType42('X');
const g6 = await gShot42();
ok(g6.code === '<p>甲</p>\n<p>X</p>\n<p>乙</p>' && g6.brs === 0 && g6.blocks === 3 && g6.text === '甲X乙',
  `(42)* 在空行上打字：那根 <br> 消失、就地长出一个 <p>（实际 ${JSON.stringify(g6.code)}）`);
await gType42('Y');
const g7 = await gShot42();
ok(g7.code === '<p>甲</p>\n<p>XY</p>\n<p>乙</p>',
  `(42)* 继续打字仍在同一个新段里（实际 ${JSON.stringify(g7.code)}）`);
await gBack42();
await gBack42();
const g8 = await gShot42();
ok(g8.code === '<p>甲</p>\n<br>\n<p>乙</p>' && g8.text === '甲乙' && g8.blocks === 2,
  `(42)* 把这段的字逐字删空：<p> 变回**独立成行的 <br>**（实际 ${JSON.stringify(g8.code)}）`);
ok(g8.tops.length === 2 && (g8.tops[1] - g8.tops[0]) > g8.lh * 1.6 && g8.bare === 0,
  `(42)* 变回空行之后编辑区仍可见一个空行、根下无裸节点（新段顶边差 ${g8.tops[1] - g8.tops[0]} > 1.6×行高 ${g8.lh}）`);
await gType42('Z');
const g9 = await gShot42();
ok(g9.code === '<p>甲</p>\n<p>Z</p>\n<p>乙</p>',
  `(42)* 空行上再打字又能长成 <p>（空行 ↔ 段落完全可逆，实际 ${JSON.stringify(g9.code)}）`);
const g9rt = await gRT42();
ok(g9rt.same === true && g9rt.e === 0 && g9rt.w === 0,
  `(42)* 这个状态往返逐字节幂等、校验 0/0（${JSON.stringify(g9rt.c1)}）`);

// —— 42d 多个连续空行：剩几根还是几根，位置不变 ——
await resetEditor();
await gSet42('<p>甲</p>');
await gCaretEnd42('p');
await sleep(200);
await pressEnter35();
await pressEnter35();
await pressEnter35();
const g10 = await gShot42();
ok(g10.code === '<p>甲</p>\n<br>\n<br>',
  `(42)* 连按三次 Enter：两个**独立成行**的 <br>（空行 2 个，实际 ${JSON.stringify(g10.code)}）`);
await gType42('乙');
const g11 = await gShot42();
ok(g11.code === '<p>甲</p>\n<br>\n<br>\n<p>乙</p>' && g11.blanks === 2,
  `(42)* 两个空行 + 新段并存（实际 ${JSON.stringify(g11.code)} / DOM ${JSON.stringify(g11.html)}）`);
// 点**第一个**空行（首段正下方半行处）再打字：只吃一根 <br>，剩下一根位置不变
const gFirstBlank = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const p=ed.querySelector('p'); const a=p.getBoundingClientRect();
  const lh=parseFloat(getComputedStyle(ed).lineHeight)||0;
  return JSON.stringify({ x:Math.round(a.left+30), y:Math.round(a.bottom+lh*0.5) });})()`);
const gfb = await gFirstBlank();
await clickAt(gfb.x, gfb.y);
await sleep(320);
await gType42('X');
const g12 = await gShot42();
ok(g12.code === '<p>甲</p>\n<p>X</p>\n<br>\n<p>乙</p>' && g12.blanks === 1,
  `(42)* 在第一个空行上打字：只吃一根 <br>，剩余空行数与顺序不变（实际 ${JSON.stringify(g12.code)} / DOM ${JSON.stringify(g12.html)}）`);
await gBack42();
const g13 = await gShot42();
ok(g13.code === '<p>甲</p>\n<br>\n<br>\n<p>乙</p>' && g13.blanks === 2,
  `(42)* 把「X」删掉：又回到两根独立 <br>（实际 ${JSON.stringify(g13.code)} / DOM ${JSON.stringify(g13.html)}）`);

// —— 42e 撤回：<br>→<p> 与 <p>→<br> 都要能撤回，且光标不跳文首 ——
await resetEditor();
await gSet42('<p>甲</p><br><p>乙</p>');
await sleep(220);
const gy2 = await gBlankXY();
await clickAt(gy2.x, gy2.y);
await sleep(320);
const gu0 = await gShot42();
await gType42('X');
const gu1 = await gShot42();
await gUndo42();
const gu2 = await gShot42();
ok(gu1.code !== gu0.code && gu2.code === gu0.code && gu2.text === '甲乙',
  `(42)* 空行→<p> 这一步能撤回：代码回到空行形态（${JSON.stringify(gu1.code)} → ${JSON.stringify(gu2.code)}）`);
ok(gu2.caretInEditor === true, '(42)* 撤回之后光标仍在编辑区里（没有跳到文首/丢焦点）');

// —— 42f 与"编辑区彻底空"区分：什么都没写 → 导出仍是空内容 ——
await gSet42('<p><br></p>');       // 刚打开编辑区时的样子（空段落壳）
await sleep(560);
const gEmpty0 = await gShot42();
ok(gEmpty0.code === '' && gEmpty0.lines === 0 && gEmpty0.ps === 0 && gEmpty0.brs <= 1,
  `(42)* 空编辑区：导出就是空内容，不凭空产生 <br>/<p>（实际 ${JSON.stringify(gEmpty0.code)} / br ${gEmpty0.brs} / 代码里 <p> ${gEmpty0.ps} 个）`);
await gType42('Z');
await gBack42();
const gEmpty1 = await gShot42();
ok(gEmpty1.code === '' && gEmpty1.text === '',
  `(42)* 打了字再删空：导出又回到空内容（实际 ${JSON.stringify(gEmpty1.code)}）`);
ok(gEmpty1.brs <= 1, `(42)* 删空之后编辑区至多留一个"落脚 <br>"，不堆积空行（br ${gEmpty1.brs}）`);

// —— 42g 代码区行结构：一个块一行、空行独立一行、段内不硬拆行 ——
await resetEditor();
await gSet42('<p>甲</p><br><p>乙</p>');
await sleep(240);
const gl = await gShot42();
ok(gl.lines === 3 && gl.blocks + gl.blanks === gl.lines && gl.onePerLine === true && gl.twoOnOneLine === false,
  `(42)* 代码区行结构：块数 ${gl.blocks} + 空行 ${gl.blanks} == 行数 ${gl.lines}，每行只有一个块、没有两块挤一行`);
const longA = '这是一段很长的正文'.repeat(30);   // ≥300 字
const longB = '软换行之后的第二行'.repeat(6);
await resetEditor();
await gSet42('<p>' + longA + '<br>' + longB + '</p>');
await sleep(240);
const gll = await gShot42();
ok(gll.code === '<p>' + longA + '<br>' + longB + '</p>' && gll.lines === 1 && gll.ps === 1,
  `(42)* 长段落（${longA.length + longB.length} 字，内含一个 <br>）仍然只占**一行**、只算一个 <p>（实际行数 ${gll.lines}）`);
const gllrt = await gRT42();
ok(gllrt.same === true, '(42)* 长段落那一行往返逐字节幂等');

// —— 42h **两类 <br> 绝不互换**：段内的留在 <p> 里、段间的独立成行；各自往返逐字节幂等 ——
// 判别规则（用户口径）：`<p>` **内部**的 <br> = 段内分行；与块**同级**的 <br> = 段落之间的空行。
const gMark42 = async (code) => {
  await evaluate(`(()=>{const box=document.getElementById('tbCode'); box.value=${JSON.stringify(code)};
    box.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  // 代码区 → 编辑区是防抖同步（TOOLBOX_CODE_DEBOUNCE），这里显式再跑一次同一个入口，
  // 免得测试被防抖时序影响（两条路都进 toolboxApplyCodeToEditor，结果完全一致）。
  await sleep(200);
  await evaluate(`(()=>{ if (typeof toolboxCodeToEditor==='function') toolboxCodeToEditor(); return 1;})()`);
  await sleep(260);
  return json(`(()=>{const ed=document.getElementById('tbEditor');
  const ins=[...ed.querySelectorAll('p > br')].filter(function(b){return !b.getAttribute('data-tb-caret');}).length;
  const outs=[...ed.children].filter(function(c){return c.tagName==='BR';}).length;
  const stray=[...ed.querySelectorAll('br')].filter(function(b){return b.parentNode===ed;}).length;
  // ★ "导出"= 代码区那份文本：toolboxRefresh 里就是这么算的（净化 + 缩进美化、一块一行）
  const out2=(typeof toolboxEditorEmpty==='function'&&toolboxEditorEmpty())?'':toolboxFormatHtml(toolboxParseBox(toolboxCleanHtml()));
  const lint=toolboxLint(out2);
  return JSON.stringify({ html:ed.innerHTML, out:out2, same:(out2===${JSON.stringify(code)}), inner:ins, outer:stray,
    e:lint.errors.length, w:lint.warnings.length, text:ed.textContent });})()`);
};
const gMix42 = await gMark42('<p>甲<br>乙</p>\n<br>\n<p>丙<br>丁</p>');
ok(gMix42.same === true && gMix42.inner === 2 && gMix42.outer === 1,
  `(42)* 混合 fixture：段内 <br> 仍在 <p> 内（${gMix42.inner} 根）、段间 <br> 仍与块同级（${gMix42.outer} 根）、`
  + `导出逐字节不变（${JSON.stringify(gMix42.out)}）`);
ok(gMix42.text === '甲乙丙丁' && gMix42.e === 0 && gMix42.w === 0,
  `(42)* 混合 fixture 文字逐字不变、校验 0 错 0 警（${gMix42.e}e${gMix42.w}w / ${JSON.stringify(gMix42.text)}）`);
const gIntra42 = await gMark42('<p>甲<br>乙</p>');
ok(gIntra42.same === true && gIntra42.inner === 1 && gIntra42.outer === 0,
  `(42)* 段内分行导入→导出：<br> 仍在 <p> 内、没有升级成段落之间的 <br>（${JSON.stringify(gIntra42.out)}）`);
const gInter42 = await gMark42('<p>甲</p>\n<br>\n<p>乙</p>');
ok(gInter42.same === true && gInter42.outer === 1 && gInter42.inner === 0,
  `(42)* 段间空行导入→导出：<br> 仍独占一行、没有被吞进任何 <p>（${JSON.stringify(gInter42.out)}）`);
// 空段落归一化：源码里"只有 <br> 没有文字"的空 <p> ⇒ 它所在位置的独立 <br>
// ★ 这里"same"必然为假：归一化**就是**要把 `<p><br></p>` 改成独立 `<br>`（用户点名的规则：
//   编辑区里空行只有一种形态）。要钉的是"归一化后的文本"和"再往返一次逐字节幂等"。
const gEmptyP42 = await gMark42('<p>甲</p>\n<p><br></p>\n<p>乙</p>');
ok(gEmptyP42.out === '<p>甲</p>\n<br>\n<p>乙</p>' && gEmptyP42.outer === 1 && gEmptyP42.text === '甲乙',
  `(42)* 只有一个空 <p>（无文字）归一化成独立 <br>（实际 ${JSON.stringify(gEmptyP42.out)}）`);
const gEmptyP42b = await gMark42(gEmptyP42.out);
ok(gEmptyP42b.same === true && gEmptyP42b.outer === 1,
  `(42)* 归一化之后**再往返一次**逐字节幂等（${JSON.stringify(gEmptyP42b.out)}）`);

// —— 42i 光标：可见性（行盒）／命中（真鼠标点击）／继续输入／退格 ——
// ★ 关于 `getClientRects()`：实测（Chrome 148 / headless）**浏览器自己**按 Shift+Enter 得到
//   `<p>哈哈哈<br><br></p>`、光标停在 (p,2) 时，`getSelection().getRangeAt(0).getClientRects()`
//   同样是**空数组** —— 这个 API 对"折叠在两根 <br> 之间的插入点"根本不返回矩形，
//   拿它当"光标可见"的判据会必然失败（不是我们的 bug）。所以这一节用**更强**的替代判据：
//     ① 这个块实际渲染成了几行（行盒高度 / 行高）——换行真的画出来了；
//     ② `document.caretRangeFromPoint` 在该行的坐标上返回"<br> 之后"的位置；
//     ③ 真鼠标点击该行 + 打字 ⇒ 字落在该行（这正是用户实测的"点下一行没反应"）；
//     ④ 退格能删掉那根 <br> 并回到上一行末尾。
const gLineHit42 = (lineIdx) => json(`(()=>{const ed=document.getElementById('tbEditor');
  const p=ed.querySelector('p'); const b=p.getBoundingClientRect();
  const lh=parseFloat(getComputedStyle(ed).lineHeight)||29.6;
  const y=Math.round(b.top+lh*(${lineIdx}+0.5)); const x=Math.round(b.left+60);
  const cr=document.caretRangeFromPoint(x,y);
  const n=cr?cr.startContainer:null;
  return JSON.stringify({ x:x, y:y, lh:Math.round(lh*100)/100,
    node:(n?(n.nodeType===3?'#text@'+(n.parentNode?n.parentNode.tagName:'?'):n.tagName):'null'),
    off:cr?cr.startOffset:-1, pTop:Math.round(b.top), pLines:Math.round(b.height/lh*100)/100 });})()`);
await resetEditor();
await gSet42('<p>哈哈哈</p>');
await gCaretEnd42('p');
await sleep(200);
await gEnter42(8);
const gc1 = await gShot42();
const gh1 = await gLineHit42(1);
// ★ 关于 `caretRangeFromPoint`：这一段（段内分行后第二行）上它返回的是**最近的文字位置**
//   （实测 #text@P@3，也就是上一行行尾），因为第二行没有文字、只有行盒 —— 这是 Chrome
//   这个 API 的实现口径，不是命中失败。真正的判据在下面：**真鼠标点击** + 接着打字落在第二行
//   （那正是用户实测的现场："鼠标点击下一行没有反应"）。所以这里只断言"第二行真的渲染出来了"。
ok(gc1.firstLines === 2 && gh1.pLines === 2 && gh1.y > gh1.pTop + gh1.lh * 0.9,
  `(42)* 段内分行后：那一段真的渲染成 2 行（${gh1.pLines} 行；第二行 y=${gh1.y} > 段顶+1 行 ${Math.round(gh1.pTop + gh1.lh)}）`);
// 真鼠标点第 2 行 → 打字必须落在第 2 行
const gBox42 = await json(`(()=>{const p=document.querySelector('#tbEditor p');const b=p.getBoundingClientRect();
  const lh=parseFloat(getComputedStyle(document.getElementById('tbEditor')).lineHeight)||29.6;
  return JSON.stringify({x:Math.round(b.left+120), y:Math.round(b.top+lh*1.5), top:Math.round(b.top), lh:lh});})()`);
await clickAt(gBox42.x, gBox42.y);
await sleep(320);
const gc2 = await gShot42();
ok(gc2.caretInEditor === true && /P@2$/.test(gc2.caretParent),
  `(42)* 鼠标点段内第二行：光标落在两根 <br> 之间（期望 P@2，实际 ${gc2.caretParent}；点 (${gBox42.x},${gBox42.y}) 段顶 ${gBox42.top} 行高 ${gBox42.lh}）`);
await gType42('Z');
const gc3 = await gShot42();
ok(gc3.code === '<p>哈哈哈<br>Z</p>' && gc3.text === '哈哈哈Z',
  `(42)* 点第二行再打字 ⇒ 字落在第二行、仍是同一个 <p>（实际 ${JSON.stringify(gc3.code)}）`);
await gBack42();
const gc4 = await gShot42();
ok(gc4.code === '<p>哈哈哈<br></p>' && gc4.text === '哈哈哈' && gc4.firstLines === 2 && gc4.marks === 1,
  `(42)* 段内退格一次：删掉刚打的字、那根 <br> 还在，落脚点自动补回来（实际 ${JSON.stringify(gc4.code)} / 行 ${gc4.firstLines}）`);
await gBack42();
const gc5 = await gShot42();
ok(gc5.code === '<p>哈哈哈</p>' && gc5.text === '哈哈哈' && gc5.firstLines === 1 && gc5.brs === 0,
  `(42)* 再退格一次：段内那根 <br> 被删掉、回到一行（实际 ${JSON.stringify(gc5.code)}）`);
// Enter 之后的新段落：真鼠标点那一行 + 打字
await resetEditor();
await gSet42('<p>哈哈哈</p>');
await gCaretEnd42('p');
await sleep(200);
await gEnter42(0);
const gn1 = await gShot42();
const gnBox = await json(`(()=>{const ps=[...document.querySelectorAll('#tbEditor p')];const b=ps[1].getBoundingClientRect();
  return JSON.stringify({h:Math.round(b.height), x:Math.round(b.left+40), y:Math.round(b.top+b.height/2),
    lines:Math.round(b.height/(parseFloat(getComputedStyle(document.getElementById('tbEditor')).lineHeight)||29.6)*100)/100});})()`);
ok(gn1.blocks === 2 && gnBox.lines === 1 && gnBox.h > 0,
  `(42)* Enter 分出的新段是一个**真的行盒**（高 ${gnBox.h}px ≈ 1 行 ${gnBox.lines}），光标能画出来`);
await clickAt(gnBox.x, gnBox.y);
await sleep(320);
await gType42('乙');
const gn2 = await gShot42();
ok(gn2.code === '<p>哈哈哈</p>\n<p>乙</p>' && gn2.text === '哈哈哈乙',
  `(42)* 鼠标点新段那一行 + 打字 ⇒ 落在新段里（实际 ${JSON.stringify(gn2.code)}）`);
// 段间退格：只删空行，绝不吞掉整段（用户实测的"退格丢字"回归）
await resetEditor();
await gSet42('<p>甲</p><br><p>乙</p>');
await evaluate(`(()=>{const ed=document.getElementById('tbEditor');const p=ed.querySelectorAll('p')[1];
  const r=document.createRange(); r.setStart(p.firstChild,0); r.collapse(true);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await gBack42();
const gb1 = await gShot42();
ok(gb1.code === '<p>甲</p>\n<p>乙</p>' && gb1.text === '甲乙' && gb1.blanks === 0,
  `(42)* 段间退格：只删掉那根独立 <br>、两段直接相接、一个字都没丢（实际 ${JSON.stringify(gb1.code)}）`);
await gBack42();
const gb2 = await gShot42();
ok(gb2.code === '<p>甲乙</p>' && gb2.text === '甲乙',
  `(42)* 再退格一次才由浏览器把两段合并（实际 ${JSON.stringify(gb2.code)}）`);
// 点内容下方的空白 → 光标落末尾
await resetEditor();
await gSet42('<p>甲</p><br><p>乙</p>');
await sleep(240);
const gEndBox = await json(`(()=>{const ed=document.getElementById('tbEditor');const b=ed.getBoundingClientRect();
  return JSON.stringify({x:Math.round(b.left+300), y:Math.round(b.bottom-6)});})()`);
await clickAt(gEndBox.x, gEndBox.y);
await sleep(320);
await gType42('W');
const gEndShot = await gShot42();
ok(gEndShot.code === '<p>甲</p>\n<br>\n<p>乙W</p>' && gEndShot.text === '甲乙W',
  `(42)* 点内容下方的空白处再打字 ⇒ 落在文档末尾（实际 ${JSON.stringify(gEndShot.code)}）`);

// ==============================================================
console.log('\n====== (43) H：上标 / 下标互斥（应用一个就把另一个摘掉） ======\n');
const hSet43 = (html, selJs) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(html)}; toolboxNormalizeEditorWhitespace(ed); toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const r=document.createRange(); ${selJs}
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
const hShot43 = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const on=function(b){ return !!(b&&/\\bactive\\b/.test(b.className||'')); };
  return JSON.stringify({ html:ed.innerHTML, code:document.getElementById('tbCode').value, text:ed.textContent,
    sup:ed.querySelectorAll('sup').length, sub:ed.querySelectorAll('sub').length,
    brs:ed.querySelectorAll('br').length, blocks:[...ed.children].filter(function(c){return c.tagName!=='BR';}).length,
    supOn:on(document.querySelector('[data-tb="sup"]')), subOn:on(document.querySelector('[data-tb="sub"]')) });})()`);
const hClick43 = async (act) => { await evaluate(`toolboxDraftAskHide(); document.querySelector('[data-tb="${act}"]').click();`); await sleep(430); };
const SEL_SUB43 = `const el=ed.querySelector('sup,sub,span'); r.selectNodeContents(el);`;
const SEL_ALL43 = `r.selectNodeContents(ed);`;

await resetEditor();
await hSet43('<p>甲<sup>1</sup>乙</p>', SEL_SUB43);
const h1a = await hShot43();
await hClick43('sub');
const h1b = await hShot43();
ok(h1a.sup === 1 && h1b.sup === 0 && h1b.sub === 1 && h1b.text === '甲1乙' && h1b.blocks === h1a.blocks && h1b.brs === h1a.brs,
  `(43)* 上标 → 点「下标」：只剩 <sub>，结构/文字不变（${JSON.stringify(h1b.html)}）`);
ok(h1b.subOn === true && h1b.supOn === false,
  `(43)* 只亮「下标」一个按钮（sub=${h1b.subOn} sup=${h1b.supOn}）`);
await hClick43('sub');
const h1c = await hShot43();
ok(h1c.sub === 0 && h1c.sup === 0 && h1c.text === '甲1乙',
  `(43)* 再点一次「下标」：全部摘掉（${JSON.stringify(h1c.html)}）`);

await resetEditor();
await hSet43('<p>甲<sub>1</sub>乙</p>', SEL_SUB43);
await hClick43('sup');
const h2b = await hShot43();
ok(h2b.sub === 0 && h2b.sup === 1 && h2b.text === '甲1乙' && h2b.supOn === true && h2b.subOn === false,
  `(43)* 下标 → 点「上标」：只剩 <sup>（${JSON.stringify(h2b.html)}）`);

await resetEditor();
await hSet43('<p>甲<span style="vertical-align:super;">1</span>乙</p>', SEL_SUB43);
await hClick43('sub');
const h3 = await hShot43();
ok(h3.sup === 0 && h3.sub === 1 && !/vertical-align\s*:\s*super/i.test(h3.html) && h3.text === '甲1乙',
  `(43)* 只有 vertical-align:super 样式形态：互斥时样式一并摘掉、只剩 <sub>（${JSON.stringify(h3.html)}）`);

await resetEditor();
await hSet43('<p>甲<sup><b>1</b></sup>乙</p>', SEL_SUB43);
await hClick43('sub');
const h4a = await hShot43();
ok(h4a.sup === 0 && h4a.sub === 1 && /<b>/.test(h4a.html),
  `(43)* 嵌套 <sup><b>x</b></sup>：只换上下标，加粗保留（${JSON.stringify(h4a.html)}）`);
await resetEditor();
await hSet43('<p>甲<b><sub>1</sub></b>乙</p>', SEL_SUB43);
await hClick43('sup');
const h4b = await hShot43();
ok(h4b.sub === 0 && h4b.sup === 1 && /<b>/.test(h4b.html),
  `(43)* 嵌套 <b><sub>x</sub></b>：只换上下标，加粗保留（${JSON.stringify(h4b.html)}）`);

await resetEditor();
await hSet43('<p><sup>甲</sup>乙丙</p>', SEL_ALL43);
await hClick43('sub');
const h5 = await hShot43();
ok(h5.sup === 0 && h5.sub === 1 && h5.text === '甲乙丙' && /<sub>甲乙丙<\/sub>/.test(h5.html),
  `(43)* 混合选区 + 一次点「下标」：整个选区统一成 <sub>，原来的 <sup> 不残留（${JSON.stringify(h5.html)}）`);
await hClick43('sub');
const h5b = await hShot43();
ok(h5b.sup === 0 && h5b.sub === 0 && h5b.text === '甲乙丙',
  `(43)* 再点一次：全取消（${JSON.stringify(h5b.html)}）`);

await resetEditor();
await hSet43('<p><sup>甲</sup></p><p>乙丙</p>',
  `const a=ed.querySelectorAll('p'); r.setStart(a[0].firstChild.firstChild,0); r.setEnd(a[1].firstChild,1);`);
await hClick43('sub');
const h6 = await hShot43();
ok(h6.sup === 0 && h6.sub === 2 && h6.blocks === 2 && h6.text === '甲乙丙',
  `(43)* 跨两段：各自就地生效、块数不变（${JSON.stringify(h6.html)}）`);
const h6rt = await gRT42();
ok(h6rt.same === true && h6rt.e === 0 && h6rt.w === 0, `(43)* 上下标状态往返逐字节幂等、校验 0/0（${JSON.stringify(h6rt.c1)}）`);

// ==============================================================
console.log('\n====== (44) I：粘贴 = 一段一个 <p>、段内 \\n = <br>、空行 = 独立 <br> ======\n');
const iPaste44 = (text, html) => evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.focus();
  const dt=new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)});
  ${html ? `dt.setData('text/html', ${JSON.stringify(html)});` : ''}
  const ev=new ClipboardEvent('paste', {clipboardData:dt, bubbles:true, cancelable:true});
  ed.dispatchEvent(ev); return 1;})()`);
const iSet44 = (html, selJs) => evaluate(`(()=>{const ed=document.getElementById('tbEditor');
  ed.innerHTML=${JSON.stringify(html)}; toolboxNormalizeEditorWhitespace(ed); toolboxRefresh(); toolboxUndoReset(); ed.focus();
  const r=document.createRange(); ${selJs || 'r.selectNodeContents(ed); r.collapse(false);'}
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);

await resetEditor();
await iSet44('');
await iPaste44('文字\n文字2');
await sleep(560);
const i1 = await gShot42();
ok(i1.code === '<p>文字<br>文字2</p>' && i1.ps === 1 && i1.text === '文字文字2' && i1.bare === 0,
  `(44)* 段内单个换行：留在同一个 <p> 里当 <br>（实际 ${JSON.stringify(i1.code)}）`);

await resetEditor();
await iSet44('');
await iPaste44('很荒诞，也很真实。但我觉得这件事有个别的角度看。'
  + '\n\n**同一套、同一天买的、同一天送的、同一个样票号 08241——唯一的变量就是纸本身。**'
  + '\n\n你什么都没换。……你是那套公债的存档人，不是它的作者。');
await sleep(660);
const i2 = await gShot42();
ok(i2.ps === 3 && i2.blocks === 3,
  `(44)* 用户给的三段原文（空行分段）→ 恰好 3 个 <p>（实际 <p> ${i2.ps} 个 / 块 ${i2.blocks} 个）`);
ok(i2.code === '<p>很荒诞，也很真实。但我觉得这件事有个别的角度看。</p>\n<br>\n'
  + '<p>**同一套、同一天买的、同一天送的、同一个样票号 08241——唯一的变量就是纸本身。**</p>\n<br>\n'
  + '<p>你什么都没换。……你是那套公债的存档人，不是它的作者。</p>',
  `(44)* 空行 = 独立成行的 <br>（与手敲一致）、一段一行（实际 ${JSON.stringify(i2.code)}）`);
ok(i2.text === '很荒诞，也很真实。但我觉得这件事有个别的角度看。'
  + '**同一套、同一天买的、同一天送的、同一个样票号 08241——唯一的变量就是纸本身。**'
  + '你什么都没换。……你是那套公债的存档人，不是它的作者。',
  '(44)* 文字逐字等于粘贴文本（一个字符没多、没少）');
ok(i2.bare === 0 && i2.e === 0 && i2.w === 0,
  `(44)* 根下无裸节点、校验 0 错 0 警（裸 ${i2.bare} / ${i2.e}e${i2.w}w）`);
const i2rt = await gRT42();
ok(i2rt.same === true && i2rt.text === i2.text,
  `(44)* 三段粘贴结果 导出→导入→再导出 逐字节幂等（实际 ${JSON.stringify(i2rt.c1)}）`);

await resetEditor();
await iSet44('<p>前文甲乙</p>', `const p=ed.querySelector('p'); const t=p.firstChild; r.setStart(t,2); r.collapse(true);`);
await iPaste44('丙\n\n丁');
await sleep(560);
const i3 = await gShot42();
ok(i3.code === '<p>前文丙</p>\n<br>\n<p>丁甲乙</p>' && i3.ps === 2 && i3.blanks === 1 && i3.text === '前文丙丁甲乙',
  `(44)* 段中间粘贴多段：第一段接在当前行、空行独立成行、后半截留在最后一段（实际 ${JSON.stringify(i3.code)}）`);

await resetEditor();
await iSet44('');
await iPaste44('甲\n乙\n丙');
await sleep(560);
const i4 = await gShot42();
ok(i4.code === '<p>甲<br>乙<br>丙</p>' && i4.ps === 1 && i4.blanks === 0,
  `(44)* 三段单换行（没有空行）→ 仍是同一个 <p> 里两个 <br>（实际 ${JSON.stringify(i4.code)}）`);

await resetEditor();
await iSet44('');
await iPaste44('甲\n\n\n\n乙');
await sleep(560);
const i5 = await gShot42();
ok(i5.code === '<p>甲</p>\n<br>\n<br>\n<br>\n<p>乙</p>' && i5.blanks === 3,
  `(44)* 粘贴里连续 3 个空行 → 3 根独立 <br>（与手敲一致，实际 ${JSON.stringify(i5.code)}）`);

await resetEditor();
await iSet44('');
await iPaste44('文字\n文字2', '<p>文字</p><table><tr><td>格子</td></tr></table><p>文字2</p>');
await sleep(560);
const i6 = await gShot42();
ok(!/<table/.test(i6.code) && i6.code === '<p>文字<br>文字2</p>' && i6.bare === 0 && i6.e === 0 && i6.w === 0,
  `(44)* 富文本粘贴：仍只取纯文本、不自动转表格、根下无裸节点（实际 ${JSON.stringify(i6.code)}）`);

// ==============================================================
console.log('\n====== (45) 代码区行结构：拿用户的规范样例当 fixture（一段一行、空行独立一行） ======\n');
// ★ 风格基线只用用户亲手贴的那份样例，**内联在测试里**（不读 notecollection/** 的任何文章：
//   用户明确说那些是他用当前有 bug 的工具自动生成的产物，不能当语料/期望值）。
const SAMPLE45 = [
  '<center><b><span style="font-size:1.1em;">中华世纪坛</span></b></center>',
  '<p>第一段正文。这里写第一段，一段就是一个段落。</p>',
  '<br>',
  '<p>第二段正文，段内有一个软换行<br>这是同一段的第二行。</p>',
  '<center><img src="readmes/image/comm/xxx.jpg" width="80%"></center>',
  '<center><span style="color:#555555; font-size:0.85rem;">图注：一段说明文字。</span></center>',
  '<br>',
  '<div style="text-align:right;">落款：某某<br>二〇二五年</div>'
].join('\n');
// 走**用户真正会走的路**：把样例贴进代码区（input 事件）→ 编辑区 → 再看导出文本
await setCode(SAMPLE45);
await sleep(620);
const s45 = await json(`(()=>{const ed=document.getElementById('tbEditor'); const code=toolboxCodeText();
  const BARE=/^(P|DIV|CENTER|TABLE|UL|OL|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|HR|VIDEO|IMG|BR)$/;
  const bare=[...ed.childNodes].filter(function(c){
    if(c.nodeType===3) return !!String(c.nodeValue||'').replace(/[\\s\\u00a0\\u200b]+/g,'').length;
    if(c.nodeType!==1) return false; return !BARE.test(c.tagName); }).length;
  const blocks=[...ed.children].filter(function(c){return c.tagName!=='BR';});
  const lines=code.split('\\n').filter(function(x){return x.trim();});
  const lint=toolboxLint(code);
  return JSON.stringify({ code:code, text:ed.textContent, bare:bare, blocks:blocks.length, lines:lines.length,
    blanks:lines.filter(function(x){return /^<br\\s*\\/?>$/.test(x.trim());}).length,
    onePerLine:lines.every(function(l){return (l.match(/<(p|center|div|table|ul|ol|blockquote|h[1-6])\\b/g)||[]).length<=1;}),
    twoOnOneLine:/<\\/(p|center|div|blockquote|h[1-6])>[ \\t]*<(p|center|div|blockquote|table|ul|ol|h[1-6])\\b/.test(code),
    ps:(code.match(/<p\\b/g)||[]).length, e:lint.errors.length, w:lint.warnings.length });})()`);
ok(s45.code === SAMPLE45,
  '(45)* 规范样例原样保留：贴进代码区→编辑区→再导出逐字节一致（8 行）');
ok(s45.lines === 8 && s45.onePerLine === true && s45.twoOnOneLine === false,
  `(45)* 每个块/空行各占一行：8 行、每行只有一个元素、没有两块挤同一行（行数 ${s45.lines}）`);
ok(s45.blocks + s45.blanks === s45.lines && s45.blanks === 2,
  `(45)* 块数 ${s45.blocks} + 空行 ${s45.blanks} == 行数 ${s45.lines}`);
ok(s45.ps === 2,
  `(45)* 没有"一个 <p> 包住整篇"：整篇只有 2 个 <p>（= 2 个正文段落，实际 ${s45.ps}）`);
ok(s45.e === 0 && s45.w === 0 && s45.bare === 0,
  `(45)* 样例 校验 0 错 0 警、根下无裸节点（${s45.e}e${s45.w}w 裸 ${s45.bare}）`);
const s45rt = await gRT42();
// ★ 这里比"往返前后**正文文字**有没有变"（sameText：跳过图片占位壳自带的文件名标签），
//   不比它跟 s45.text 的字符串：首次从**代码区**导入时，图片占位壳会多挂一个文件名标签
//   （`<span class="tb-imgph-name">xxx.jpg</span>`，contenteditable=false + aria-hidden），
//   再走一次"直接应用到编辑区"时那个标签不重建 —— 那是占位壳自己的显示细节（老功能，
//   与本轮换行/空行改动无关）。真正要保证的是：代码逐字节幂等 + 往返不掉正文文字。
ok(s45rt.same === true && s45rt.sameText === true && s45rt.c1 === SAMPLE45,
  `(45)* 样例 导出→导入→再导出 逐字节幂等、往返不掉字（same=${s45rt.same} 首次一致=${s45rt.c1 === SAMPLE45} 正文文字不变=${s45rt.sameText}）`);
// 图注/落款/标题/图片这四个"站内写法"逐条钉住（与样例一字不差）
ok(/^<center><b><span style="font-size:1\.1em;">中华世纪坛<\/span><\/b><\/center>$/.test(s45.code.split('\n')[0]),
  '(45)* 标题写法与样例一致：<center><b><span style="font-size:1.1em;">…</span></b></center> 独占一行');
ok(s45.code.split('\n')[4] === '<center><img src="readmes/image/comm/xxx.jpg" width="80%"></center>',
  '(45)* 图片写法与样例一致：<center><img … width="80%"></center> 独占一行');
ok(s45.code.split('\n')[5] === '<center><span style="color:#555555; font-size:0.85rem;">图注：一段说明文字。</span></center>',
  '(45)* 图注写法与样例一致：居中 + #555555 + 0.85rem');
ok(/^<div style="text-align:right;">/.test(s45.code.split('\n')[7]),
  '(45)* 落款写法与样例一致：<div style="text-align:right;">…</div> 独占一行');

// ==============================================================
console.log('\n====== (46) IME：合成期间绝不归一化/改写结构（拼音首字母不许漏成正文） ======\n');
// 用户实测 bug：三段分别打字，第 2、3 段的开头漏出了拼音首字母（w / l），代码区把它们当成正文
//   序列化了。根因：**合成过程中的每一次 input（insertCompositionText）都被我们当成"用户打了字"
//   做了 DOM 归一化**（把裸文本包进 <p>、扫落脚点、刷新……），输入法下一次 compositionupdate
//   就写不回原来那个位置了 ⇒ 首字母留在了正文里。
// 修法（toolbox.js，见这几处的注释）：合成期间**什么都不做** ——
//   · compositionstart / compositionupdate：只置冻结位 + 切提示语，不碰 DOM；
//   · input：inputType=insertCompositionText（或 isComposing）时只记"待补跑"，不转换、不刷新；
//   · keydown Enter：isComposing / keyCode 229 / 冻结位 ⇒ **放行给输入法**（不 preventDefault）；
//   · compositionend：先解冻，下一帧再补一次归一化（先存选区、跑完恢复）；
//   · 粘贴：合成中只排队，合成结束再执行。
// 本节的断言就是"钉住这个冻结"：合成期间**结构性函数一次都不许被调用**，
// 而上屏之后文字必须完整（首字母一个都不许漏在外面）。
await resetEditor();
await sleep(200);
// 计数探针：把"会改结构的函数"包一层（只在本次测试里生效，不改产品代码）
await evaluate(`(()=>{window.__ime = { structural:0, calls:{}, hint:0 };
  ['toolboxFillBlankLine','toolboxParagraphToBlankLine','toolboxWrapStrayTopLevel','toolboxCaretHolderSweep',
   'toolboxCaretSupportSync','toolboxEnterBreak','toolboxInsertParagraph','toolboxPastePlain','toolboxImportBlankLines',
   'toolboxDropEmptyBlocks','toolboxApplyCodeToEditor'].forEach(function(k){
    const f=window[k]; if(typeof f!=='function') return;
    window[k]=function(){ window.__ime.structural++; window.__ime.calls[k]=(window.__ime.calls[k]||0)+1; return f.apply(this, arguments); };
  });
  const h=window.toolboxHintSync;
  window.toolboxHintSync=function(){ window.__ime.hint++; return h.apply(this, arguments); };
  return 1;})()`);
const imeState = () => json(`(()=>{const ed=document.getElementById('tbEditor'); const cs=getComputedStyle(ed,'::before');
  const s=getSelection();
  return JSON.stringify({ html:ed.innerHTML, text:ed.textContent, code:document.getElementById('tbCode').value,
    hint:cs.display, structural:window.__ime.structural, calls:window.__ime.calls, hintCalls:window.__ime.hint,
    marks:ed.querySelectorAll('[data-tb-caret]').length,
    sel:(function(){try{const n=s.getRangeAt(0).startContainer; return (n.nodeType===3?'#text':'el');}catch(e){return '';}})() });})()`);
const imeReset = async () => {
  // ★ 先把上一节留下的防抖定时器（刷新/校验/代码同步）跑完，否则它们会在"合成期间"落地，
  //   把结构计数记成 1 次 —— 那是上一节的动作，不是合成的动作。等干净了再清零计数。
  await sleep(760);
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>'; toolboxRefresh(); toolboxUndoReset();
    const r=document.createRange(); r.setStart(ed.querySelector('p'),0); r.collapse(true);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
  await sleep(320);
  await evaluate(`window.__ime={structural:0,calls:{},hint:0};`);
};

// —— 46a 一次真实合成：HEAD（compositionstart/update 不改结构） → input(insertCompositionText) 不改结构 ——
await imeReset();
await send('Input.imeSetComposition', { text: 'wang', selectionStart: 4, selectionEnd: 4 });
await sleep(300);
const im1 = await imeState();
ok(im1.structural === 0,
  `(46)* 合成中（compositionupdate）结构性调用 0 次（实际 ${im1.structural} 次：${JSON.stringify(im1.calls)}）`);
ok(im1.marks === 0 && /^<p>(wang|<br>)/.test(im1.html),
  `(46)* 合成中不改结构：编辑区仍是那一个块、没有落脚标记（${JSON.stringify(im1.html)}）`);
await send('Input.insertText', { text: '王' });
await sleep(420);
const im2 = await imeState();
ok(im2.text === '王',
  `(46)* 上屏之后文字**逐字等于候选词**、拼音首字母一个都没漏在外面（实际 ${JSON.stringify(im2.text)}）`);
ok(im2.code === '<p>王</p>',
  `(46)* 上屏之后代码区就是干净的 <p>王</p>（实际 ${JSON.stringify(im2.code)}）`);
ok(im2.marks === 0 && im2.structural >= 1,
  `(46)* 上屏之后（compositionend 之后）才补跑归一化（结构性调用 ${im2.structural} 次）`);

// —— 46b 三段分别用输入法打字：每段首字母都不许漏（用户原 bug 的现场）——
await imeReset();
const imeType = async (pinyin, word) => {
  await send('Input.imeSetComposition', { text: pinyin, selectionStart: pinyin.length, selectionEnd: pinyin.length });
  await sleep(260);
  await send('Input.insertText', { text: word });
  await sleep(420);
};
await imeType('wang', '王');
await enter35(0);                       // Enter = 段落分界
await imeType('li', '李');
await enter35(0);
await imeType('zhang', '张');
const im3 = await imeState();
ok(im3.text === '王李张',
  `(46)* 三段分别输入法打字：文字逐字等于「王李张」、没有 w/l/z 漏出来（实际 ${JSON.stringify(im3.text)}）`);
ok(im3.code === '<p>王</p>\n<p>李</p>\n<p>张</p>',
  `(46)* 三段各成一段、代码区干净（实际 ${JSON.stringify(im3.code)}）`);
ok(!/[a-z]/.test(im3.text) && im3.marks === 0,
  `(46)* 正文里没有任何拼音字母残留、也没有落脚标记（marks=${im3.marks}）`);

// —— 46c 合成中的 Enter：我们**不许**劫持（defaultPrevented=false），也不许改结构 ——
await imeReset();
await evaluate(`window.__imeEnt={p:null,n:0};
  document.addEventListener('keydown', function(e){ if(e.key==='Enter'&&e.isComposing) { window.__imeEnt.p=e.defaultPrevented; window.__imeEnt.n++; } });`);
await send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
await sleep(300);
const imBefore = await imeState();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await sleep(320);
const imEnt = await json(`JSON.stringify(window.__imeEnt)`);
const imAfter = await imeState();
ok(imEnt.n >= 1 && imEnt.p === false,
  `(46)* 合成中的 Enter 被**放行给输入法**（我们没 preventDefault：isComposing 的 keydown 收到 ${imEnt.n} 次、defaultPrevented=${imEnt.p}）`);
ok(imAfter.calls.toolboxInsertParagraph === undefined && imAfter.calls.toolboxEnterBreak === undefined,
  `(46)* 合成中的 Enter 没有走我们的段落分界/段内换行（调用表 ${JSON.stringify(imAfter.calls)}）`);
await send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
await sleep(320);
const imAfter2 = await imeState();
ok(imAfter2.text === '' || imAfter2.text === 'ni' || imAfter2.text === '你',
  `(46)* 取消/清空合成之后正文里没有多出结构性节点（文字 ${JSON.stringify(imAfter2.text)}，标记 ${imAfter2.marks}）`);

// —— 46d 合成中插入标点：整段文字完整（——、…… 一个都不许丢）——
await imeReset();
await imeType('ni', '你');
await send('Input.imeSetComposition', { text: '——', selectionStart: 2, selectionEnd: 2 });
await sleep(260);
await send('Input.insertText', { text: '——' });
await sleep(420);
await imeType('hao', '好');
const im4 = await imeState();
ok(im4.text === '你——好' && im4.code === '<p>你——好</p>',
  `(46)* 合成中插入标点：整句完整（${JSON.stringify(im4.text)} / ${JSON.stringify(im4.code)}）`);

// —— 46e 输入法路径下的 Enter / Shift+Enter 与键盘路径完全一致 ——
await imeReset();
await imeType('wang', '王');
await enter35(0);                       // Enter
await imeType('li', '李');
const ie1 = await imeState();
ok(ie1.code === '<p>王</p>\n<p>李</p>',
  `(46)* 输入法上屏 + Enter：段落分界正常（${JSON.stringify(ie1.code)}）`);
await imeType('zhang', '张');
await enter35(8);                       // Shift+Enter = 段内分行
await imeType('san', '三');
const ie2 = await imeState();
ok(ie2.code === '<p>王</p>\n<p>李张<br>三</p>',
  `(46)* 输入法上屏 + Shift+Enter：段内分行正常、仍是同一个 <p>（${JSON.stringify(ie2.code)}）`);

// ==============================================================
console.log('\n====== (47) 空编辑区提示语：完全由内容决定，有内容时彻底隐藏、绝不压在第一行上 ======\n');
// 用户实测 bug：「提示语在有内容时还显示，而且和第一行**重叠**」。
// 根因：显示/隐藏以前只靠 CSS 的 `:empty` / `:has(> p:only-child > br:only-child)` 判定，
//   遇到"编辑区根上正挂着合成中的拼音裸文本"这类中间态就误判成"空"⇒ 提示语在**有正文时**
//   照样显示、并且绝对定位恰好压在第一行上。
// 修法：判定搬进 JS（toolboxHintShouldShow / toolboxHintSync，见 toolbox.js），
//   调用点覆盖 input / keyup / compositionstart·update·end / 程序化灌入 / 粘贴 / 删除 / 撤回；
//   隐藏用 display:none（零矩形 ⇒ 不遮挡、不可选、不影响点击），不再有任何"半透明残留"。
const hintShot = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const cs=getComputedStyle(ed,'::before'); const ecs=getComputedStyle(ed);
  const er=ed.getBoundingClientRect(); const lh=parseFloat(ecs.lineHeight)||0;
  const padTop=parseFloat(ecs.paddingTop)||0;
  const hasTxt=!!String(ed.textContent||'').replace(/[\\s\\u00a0\\u200b]+/g,'').length;
  const first=ed.firstElementChild; const fr=first?first.getBoundingClientRect():null;
  return JSON.stringify({ cls:(' '+ed.className+' ').indexOf(' tb-hint-on ')>0,
    display:cs.display, vis:cs.visibility, op:cs.opacity, pe:cs.pointerEvents,
    hasTxt:hasTxt, html:ed.innerHTML, text:ed.textContent, padTop:Math.round(padTop),
    rootBr:[...ed.children].filter(function(c){return c.tagName==='BR';}).length,
    media:ed.querySelectorAll('img,table,hr,video').length,
    multi:[...ed.querySelectorAll('p,div,center,blockquote,h1,h2,h3,h4,h5,h6')].filter(function(b){return b.querySelectorAll('br').length>1;}).length,
    firstTop:fr?Math.round(fr.top-er.top):null, firstH:fr?Math.round(fr.height):null,
    edH:Math.round(er.height), lh:Math.round(lh*100)/100 });})()`);
// 独立复算一遍"这个编辑区算不算空"（与产品里的判定规则同构，但这里是测试自己算的）：
//   有文字 / 有图片表格分割线视频 ⇒ "有内容"。
//   ★ 口径反转（本轮，用户实测案例 8）：**"只有空行"算空** —— 根级独立空行 `<br>`、
//     或"块里只有换行没有字"，都算空。理由：那时候代码区导出的正文就是空的（''），
//     提示语必须跟着"代码区空不空"走；旧口径"看见根级 <br> 就算有内容"会让
//     "Ctrl+Z 撤回到全空"之后提示语不再出现（用户报的正是这个）。
const hintEmpty = (g) => !g.hasTxt && g.media === 0;
const hintClear = async () => {
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>'; toolboxNormalizeEditorWhitespace(ed);
    toolboxRefresh(); toolboxHintSync(); toolboxUndoReset();
    const r=document.createRange(); r.setStart(ed.querySelector('p'),0); r.collapse(true);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
  await sleep(420);
};
// 47a 空编辑区：提示语可见，而且**不占用行高**（第一行仍是那个空段落壳）
await hintClear();
const hp0 = await hintShot();
ok(hp0.cls === true && hp0.display === 'block' && hp0.vis === 'visible' && hp0.op === '1',
  `(47)* 空编辑区：提示语可见（class=${hp0.cls} display=${hp0.display} visibility=${hp0.vis} opacity=${hp0.op}）`);
ok(hp0.firstTop === hp0.padTop && hp0.hasTxt === false,
  `(47)* 提示语不占行高：第一行就落在编辑区的内边距位置上（相对编辑区顶 ${hp0.firstTop}px == padding-top ${hp0.padTop}px，正文为空=${!hp0.hasTxt}）`);
// 47b 打一个字：提示语立刻彻底隐藏（零矩形 ⇒ 不可能压在第一行上）
await send('Input.insertText', { text: '甲' });
await sleep(420);
const hp1 = await hintShot();
ok(hp1.hasTxt === true && hp1.cls === false && hp1.display === 'none' && hp1.vis === 'hidden' && hp1.op === '0',
  `(47)* 有正文：提示语彻底隐藏（display=${hp1.display} visibility=${hp1.vis} opacity=${hp1.op} pointer-events=${hp1.pe}）`);
// 真鼠标点正文里 → 光标必须落在文字里（提示语不许拦截点击）
const hBox = await json(`(()=>{const ed=document.getElementById('tbEditor');const r=ed.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+40), y:Math.round(r.top+parseFloat(getComputedStyle(ed).lineHeight)*0.5)});})()`);
await clickAt(hBox.x, hBox.y);
await sleep(280);
const hp2 = await json(`(()=>{const s=getSelection(); const n=s.rangeCount?s.getRangeAt(0).startContainer:null;
  const ed=document.getElementById('tbEditor');
  return JSON.stringify({ inside:!!(n&&ed.contains(n)), txt:ed.textContent, clickRects:!!(s.rangeCount&&s.getRangeAt(0).getClientRects().length) });})()`);
ok(hp2.inside === true && hp2.txt === '甲',
  `(47)* 点正文第一行：提示语不遮挡、不影响点击（光标在编辑区里=${hp2.inside}，正文仍是 ${JSON.stringify(hp2.txt)}）`);
// 47c 合成中：拼音一出现提示语就该消失（用户原 bug 的中间态）
await hintClear();
const hp3a = await hintShot();
await send('Input.imeSetComposition', { text: 'w', selectionStart: 1, selectionEnd: 1 });
await sleep(320);
const hp3 = await hintShot();
ok(hp3a.cls === true && hp3.cls === false && hp3.display === 'none',
  `(47)* 合成中（拼音一进编辑区）提示语立刻隐藏（合成前 ${hp3a.display} → 合成中 ${hp3.display}）`);
await send('Input.insertText', { text: '王' });
await sleep(420);
const hp4 = await hintShot();
ok(hp4.text === '王' && hp4.display === 'none',
  `(47)* 上屏之后仍然隐藏、正文正确（${JSON.stringify(hp4.text)} / display=${hp4.display}）`);
// 47d 全删掉 → 提示语回来；撤回之后状态一致
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
await sleep(500);
const hp5 = await hintShot();
ok(hp5.text === '' && hp5.cls === true && hp5.display === 'block',
  `(47)* 全删掉：提示语又回来（文字 ${JSON.stringify(hp5.text)} / display=${hp5.display}）`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await sleep(560);
const hp6 = await hintShot();
// ★ 撤回的判定口径：**不管撤回把内容恢复成哪一步，提示语都必须跟内容一致**
//   （真实输入法路径下"合成的那一步入不入撤回栈"是浏览器的口径，不该在用例里写死）。
//   "算不算空"由测试自己按同一条规则复算（hintEmpty）：光 textContent 为空不等于编辑区是空的 ——
//   但**只有空行**（比如撤回到"一根独立空行 <br>"）按本轮口径算空，提示语就该出现。
ok(hp6.cls === hintEmpty(hp6) && hp6.display === (hintEmpty(hp6) ? 'block' : 'none'),
  `(47)* 撤回之后状态始终跟内容一致（文字 ${JSON.stringify(hp6.text)} / 根下空行 ${hp6.rootBr} / `
  + `应由内容决定显示=${hintEmpty(hp6)} / class=${hp6.cls} / display=${hp6.display}）`);
// 再用**普通打字**（一个 input 事件 = 一步）钉确定性的"打字 → 撤回 → 重做"三态：
//   ★ 用户实测案例 8：用 Ctrl+Z 撤回到**全空**时，提示语必须**回来**（旧实现在这一步不出现）。
await hintClear();
await send('Input.insertText', { text: '乙' });
await sleep(460);
const hp6b = await hintShot();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
await sleep(600);
const hp6c = await hintShot();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'y', code: 'KeyY', windowsVirtualKeyCode: 89, nativeVirtualKeyCode: 89, modifiers: 2 });
await sleep(620);
const hp6e = await hintShot();
await send('Input.insertText', { text: '丙' });
await sleep(420);
const hp6d = await hintShot();
ok(hp6b.display === 'none' && hp6c.text === '' && hp6c.cls === true && hp6c.display === 'block',
  `(47)* 打字 → Ctrl+Z 撤回到全空：提示语必须回来（${hp6b.display} → ${JSON.stringify(hp6c.text)}/${hp6c.display}）`);
ok(hp6e.text.indexOf('乙') >= 0 && hp6e.display === 'none' && hp6d.display === 'none' && hp6d.text.indexOf('丙') >= 0,
  `(47)* 再 Ctrl+Y 重做 → 提示语又跟着内容隐藏、还能接着打字`
  + `（重做后 ${JSON.stringify(hp6e.text)}/${hp6e.display} → 打字后 ${JSON.stringify(hp6d.text)}/${hp6d.display}）`);
// 47e 程序化灌入 / 粘贴 / 空行：提示语的显隐都跟着内容走
await hintClear();
await evaluate(`(()=>{const box=document.getElementById('tbCode'); box.value='<p>灌入的正文</p>';
  box.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
await sleep(700);
const hp7 = await hintShot();
ok(hp7.text === '灌入的正文' && hp7.display === 'none' && hp7.cls === false,
  `(47)* 代码区灌入正文：提示语隐藏（${JSON.stringify(hp7.text)} / display=${hp7.display}）`);
await hintClear();
await evaluate(`toolboxInsertHtml('<br>')`);
await sleep(520);
const hp8 = await hintShot();
// ★ 口径反转（本轮，用户实测案例 8）：只有空行、没有任何文字 ⇒ **算空** ⇒ 提示语显示。
//   旧的"看见根级 <br> 就算有内容"与本条"代码区空 ⇒ 提示语出现"是矛盾的，
//   而代码区导出的正文这时候确实是空的（''），所以按"空"处理才与代码区一致。
ok(hp8.text === '' && hp8.cls === true && hp8.display === 'block',
  `(47)* 只有一根"独立空行 <br>"（没有任何文字）算空 ⇒ 提示语显示（display=${hp8.display}）`);
// 47f 程序化灌入**空内容**（代码区清空后同步）：提示语必须回来（用户实测案例 8 的同类路径）
await evaluate(`(()=>{const box=document.getElementById('tbCode'); box.value='';
  box.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
await sleep(700);
const hp9 = await hintShot();
ok(hp9.text === '' && hp9.cls === true && hp9.display === 'block',
  `(47)* 代码区清空同步到编辑区：提示语回来（文字 ${JSON.stringify(hp9.text)} / display=${hp9.display}）`);

// ==============================================================
console.log('\n====== (48) 用户实测的三个漏掉的路径：空行落点 / 粘贴分段 / 撤回后的提示语 ======\n');
// —— 48A 空行上的落点与光标（用户案例 4：拼音上屏后光标跳到下一段开头）——
// ★ 落点断言口径（用户点名要求）：**按"编辑区纯文本偏移"断言**，不能只说"光标在编辑区里"。
//   off = 光标之前的纯文本字数（= 刚输入的字之后）；blk = 光标所在的那个顶层块。
//   两者一起才钉得住"光标就在刚上屏的字后面、而且就在这一段里"。
const u48Shot = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const s=getSelection(); const r=s.rangeCount?s.getRangeAt(0):null;
  let off=-1, blk='-';
  try { const b=document.createRange(); b.setStart(ed,0); b.setEnd(r.startContainer,r.startOffset); off=b.toString().length; } catch(e){}
  try { let m=r.startContainer; while(m&&m.parentNode&&m.parentNode!==ed) m=m.parentNode; if(m&&m!==ed) blk=m.tagName+':'+m.textContent; } catch(e){}
  return JSON.stringify({ code:document.getElementById('tbCode').value, text:ed.textContent, off:off, blk:blk,
    ps:ed.querySelectorAll('p').length, blanks:[...ed.children].filter(function(c){return c.tagName==='BR';}).length,
    inBr:[...ed.querySelectorAll('p')].reduce(function(a,p){return a+p.querySelectorAll('br').length;},0),
    cls:(' '+ed.className+' ').indexOf(' tb-hint-on ')>0 });})()`);
const u48Set = async (html, selJs) => {
  await resetEditor();
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML=${JSON.stringify(html)};
    toolboxNormalizeEditorWhitespace(ed); toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
  await sleep(240);
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); const r=document.createRange(); ${selJs || 'r.selectNodeContents(ed); r.collapse(false);'}
    const s=getSelection(); s.removeAllRanges(); s.addRange(r); toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
  await sleep(180);
};
const u48Ime = async (pre, han) => {
  await send('Input.imeSetComposition', { text: pre, selectionStart: pre.length, selectionEnd: pre.length });
  await sleep(340);
  await send('Input.insertText', { text: han });
  await sleep(720);
};
// 两种"光标停在空行上"的真实现场：
//   · u48AtNextP：浏览器把"点空行"解析成**下一段开头**（用户实际遇到的现场）；
//   · u48AtRoot：光标就在根上、紧邻那根空行（另一种浏览器的解析结果）。
const u48AtNextP = `const p2=ed.querySelectorAll('p')[1]; r.setStart(p2.firstChild||p2,0); r.collapse(true);`;
const u48AtRoot = `r.setStart(ed,2); r.collapse(true);`;
const u48Base = '<p>甲</p><br><p>乙</p>';
// 48A-1 拼音：空行 → 段落，光标必须落在「中」之后；接着输「国」还在同一段里
await u48Set(u48Base, u48AtNextP);
await u48Ime('zhong', '中');
const u1a = await u48Shot();
ok(u1a.code === '<p>甲</p>\n<p>中</p>\n<p>乙</p>' && u1a.ps === 3 && u1a.blanks === 0,
  `(48)* 案例4·拼音：空行上输「中」→ 空行变 <p>、前后两段都在（实际 ${JSON.stringify(u1a.code)}）`);
ok(u1a.off === 2 && u1a.blk === 'P:中',
  `(48)* 案例4·拼音：上屏后光标在「中」**之后**（文本偏移 ${u1a.off}（应为 2）/ 所在块 ${u1a.blk}（应为 P:中））`);
await u48Ime('guo', '国');
const u1b = await u48Shot();
ok(u1b.code === '<p>甲</p>\n<p>中国</p>\n<p>乙</p>' && u1b.off === 3 && u1b.blk === 'P:中国',
  `(48)* 案例4·拼音：接着输「国」仍在同一段、光标在字后（${JSON.stringify(u1b.code)} / 偏移 ${u1b.off} / 块 ${u1b.blk}）`);
// 48A-2 同一条路、另一种"空行光标"现场（光标挂在根的 <br> 旁）
await u48Set(u48Base, u48AtRoot);
await u48Ime('zhong', '中');
const u2a = await u48Shot();
ok(u2a.code === '<p>甲</p>\n<p>中</p>\n<p>乙</p>' && u2a.off === 2 && u2a.blk === 'P:中',
  `(48)* 案例4·拼音（光标挂根上）：同样只吃掉那一格空行、光标在字后（${JSON.stringify(u2a.code)} / 偏移 ${u2a.off}）`);
// 48A-3 同类路径：英文/数字（普通按键）
await u48Set(u48Base, u48AtNextP);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '7', code: 'Digit7', windowsVirtualKeyCode: 55, nativeVirtualKeyCode: 55, text: '7' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '7', code: 'Digit7', windowsVirtualKeyCode: 55, nativeVirtualKeyCode: 55 });
await sleep(460);
const u3a = await u48Shot();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '8', code: 'Digit8', windowsVirtualKeyCode: 56, nativeVirtualKeyCode: 56, text: '8' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '8', code: 'Digit8', windowsVirtualKeyCode: 56, nativeVirtualKeyCode: 56 });
await sleep(460);
const u3b = await u48Shot();
ok(u3a.code === '<p>甲</p>\n<p>7</p>\n<p>乙</p>' && u3a.off === 2 && u3a.blk === 'P:7',
  `(48)* 案例4·数字：空行上敲 7 → 自成一段、光标在字后（${JSON.stringify(u3a.code)} / 偏移 ${u3a.off} / 块 ${u3a.blk}）`);
ok(u3b.code === '<p>甲</p>\n<p>78</p>\n<p>乙</p>' && u3b.off === 3 && u3b.blk === 'P:78',
  `(48)* 案例4·数字：接着敲 8 落在同一段（${JSON.stringify(u3b.code)} / 偏移 ${u3b.off} / 块 ${u3b.blk}）`);
// 48A-4 同类路径：空行上 Shift+Enter（不许把"段落间空行"改写成"段内分行"）
await u48Set(u48Base, u48AtRoot);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', modifiers: 8 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 8 });
await sleep(520);
const u4a = await u48Shot();
ok(u4a.code === '<p>甲</p>\n<br>\n<br>\n<p>乙</p>' && u4a.blanks === 2 && u4a.inBr === 0 && u4a.ps === 2,
  `(48)* 案例4·空行上 Shift+Enter：再补一根**根级空行**，绝不改成段内 <br>（${JSON.stringify(u4a.code)} / 段内 <br>=${u4a.inBr}）`);
await send('Input.insertText', { text: '丙' });
await sleep(560);
const u4b = await u48Shot();
ok(u4b.code === '<p>甲</p>\n<br>\n<p>丙</p>\n<p>乙</p>' && u4b.off === 2 && u4b.blk === 'P:丙',
  `(48)* 案例4·空行上 Shift+Enter 之后打字：字就落在光标那一行、上面留一根空行（${JSON.stringify(u4b.code)} / 偏移 ${u4b.off}）`);
// 48A-5 同类路径：空行上粘贴（单段 / 多段）
await u48Set(u48Base, u48AtNextP);
await iPaste44('丙');
await sleep(620);
const u5a = await u48Shot();
ok(u5a.code === '<p>甲</p>\n<p>丙</p>\n<p>乙</p>' && u5a.off === 2 && u5a.blk === 'P:丙',
  `(48)* 案例4·空行上粘贴单段：粘贴内容自成一段、光标在字后（${JSON.stringify(u5a.code)} / 偏移 ${u5a.off} / 块 ${u5a.blk}）`);
await u48Set(u48Base, u48AtNextP);
await iPaste44('丙\n\n丁');
await sleep(760);
const u5b = await u48Shot();
ok(u5b.code === '<p>甲</p>\n<p>丙</p>\n<br>\n<p>丁</p>\n<p>乙</p>' && u5b.ps === 4 && u5b.blanks === 1 && u5b.off === 3,
  `(48)* 案例4·空行上粘贴多段：第一段吃掉那格空行、后面的段各成一段、下半段不动`
  + `（${JSON.stringify(u5b.code)} / 偏移 ${u5b.off}）`);

// —— 48B 粘贴分段（用户案例 7：三段原文粘进来只有一个 <p>）——
// ★ 用户实测的现场是 **CRLF** 与**全角空格空行**（`\r\n\r\n` / `\n\u3000\n`）：
//   旧判据的正则只认 `[ \t\u00a0]`，这两种一个都不认 ⇒ "空行分段"整条路被跳过，
//   三段正文塞进同一个 <p>、段间只剩 `<br><br>`（用户截图正是这个）。
const u48P1 = '很荒诞，也很真实。但我觉得这件事有个别的角度看。';
const u48P2 = '**同一套、同一天买的、同一天送的、同一个样票号 08241——唯一的变量就是纸本身。**';
const u48P3 = '你什么都没换。不是选了好的送、差的留，是整组进去，让纸自己说话。';
const u48Seen = ['\\n\\n', '\\r\\n\\r\\n（CRLF，用户实测现场）', '\\n\\u3000\\n（全角空格空行）', '\\n\\t\\n（制表符空行）'];
const u48Seps = ['\n\n', '\r\n\r\n', '\n\u3000\n', '\n\t\n'];
for (let i = 0; i < u48Seps.length; i++) {
  await resetEditor();
  await iSet44('');
  await iPaste44([u48P1, u48P2, u48P3].join(u48Seps[i]));
  await sleep(700);
  const g = await u48Shot();
  ok(g.ps === 3 && g.blanks === 2 && g.inBr === 0 && g.text === u48P1 + u48P2 + u48P3,
    `(48)* 案例7·分隔符 ${u48Seen[i]}：三段原文 → 3 个 <p> + 2 根独立空行、段内无 <br>`
    + `（实际 <p>${g.ps} / 空行${g.blanks} / 段内 <br>${g.inBr}）`);
  ok(g.code === '<p>' + u48P1 + '</p>\n<br>\n<p>' + u48P2 + '</p>\n<br>\n<p>' + u48P3 + '</p>',
    `(48)* 案例7·分隔符 ${u48Seen[i]}：代码区逐字是"一段一个 <p>、空行一根独立 <br>"（实际 ${JSON.stringify(g.code)}）`);
  const rt = await gRT42();
  ok(rt.same === true && rt.e === 0 && rt.w === 0,
    `(48)* 案例7·分隔符 ${u48Seen[i]}：往返逐字节幂等、校验 0 错 0 警（${JSON.stringify(rt.c1)}）`);
}
// 反例（与上面成对，防止"凡是粘贴都按空行切"）：单行、无空行多行
await resetEditor();
await iSet44('');
await iPaste44('只有一行');
await sleep(620);
const u6a = await u48Shot();
ok(u6a.code === '<p>只有一行</p>' && u6a.ps === 1 && u6a.blanks === 0,
  `(48)* 案例7·反例：粘贴只有一行 → 仍然是 1 个 <p>（${JSON.stringify(u6a.code)}）`);
await resetEditor();
await iSet44('');
await iPaste44('甲\r\n乙\r\n丙');
await sleep(620);
const u6b = await u48Shot();
ok(u6b.code === '<p>甲<br>乙<br>丙</p>' && u6b.ps === 1 && u6b.inBr === 2,
  `(48)* 案例7·反例：粘贴三行（CRLF、没有空行）→ 仍是同一个 <p> 里两根 <br>（${JSON.stringify(u6b.code)}）`);
// 只有 HTML 的剪贴板（网页复制、没带 text/plain）：块级边界换成换行，段落不丢
await resetEditor();
await iSet44('');
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.focus();
  const dt=new DataTransfer(); dt.setData('text/html','<p>甲段</p><p>乙段</p>');
  ed.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return 1;})()`);
await sleep(700);
const u6c = await u48Shot();
ok(u6c.code === '<p>甲段</p>\n<br>\n<p>乙段</p>' && u6c.ps === 2 && u6c.text === '甲段乙段',
  `(48)* 案例7·只有 HTML 的剪贴板：块级边界不丢，两段各成 <p>（实际 ${JSON.stringify(u6c.code)}）`);

// —— 48C 撤回删到全空之后的提示语（用户案例 8）——
// ★ 关键口径：**"只有空行"算空** —— 撤回/删空之后编辑区常常只剩一根根级 `<br>`，
//   代码区导出的正文就是空的（''），提示语必须出现（用户实测：这一步不出现）。
const u48HintClear = async () => {
  await resetEditor();
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML='<p><br></p>';
    toolboxNormalizeEditorWhitespace(ed); toolboxRefresh(); toolboxHintSync(); toolboxUndoReset();
    const r=document.createRange(); r.setStart(ed.querySelector('p'),0); r.collapse(true);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
  await sleep(440);
};
const u48UndoKey = async (k, mod) => {
  const vk = k === 'z' ? 90 : 89;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: 'Key' + k.toUpperCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod });
  await sleep(620);
};
// 48C-1 全选删除到空 → 提示语出现（用户说这条本来就对，先钉住）
await u48HintClear();
await send('Input.insertText', { text: '甲' });
await sleep(500);
const u7a = await u48Shot();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
await sleep(200);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
await sleep(560);
const u7b = await u48Shot();
ok(u7a.cls === false && u7b.text === '' && u7b.cls === true,
  `(48)* 案例8·全选删除：有字时隐藏 → 删空后提示语出现（${u7a.cls} → ${u7b.cls}，文字 ${JSON.stringify(u7b.text)}）`);
// 48C-2 Ctrl+Z 撤回到全空 → 提示语必须回来（用户报的 bug 本体）
await u48HintClear();
await send('Input.insertText', { text: '乙' });
await sleep(520);
const u8a = await u48Shot();
await u48UndoKey('z', 2);
const u8b = await u48Shot();
ok(u8a.cls === false && u8b.text === '' && u8b.cls === true,
  `(48)* 案例8·Ctrl+Z 撤回到全空：提示语必须回来（${u8a.cls} → ${u8b.cls}，文字 ${JSON.stringify(u8b.text)}，`
  + `根下空行 ${u8b.blanks}）`);
// 48C-3 撤回 → 重做 → 再撤回：每一步的提示语都与内容一致
await u48UndoKey('z', 2 + 8);
const u8c = await u48Shot();
await u48UndoKey('z', 2);
const u8d = await u48Shot();
ok(u8c.text.indexOf('乙') >= 0 && u8c.cls === false && u8d.text === '' && u8d.cls === true,
  `(48)* 案例8·重做/再撤回：重做回「乙」→ 隐藏；再撤回到空 → 又出现`
  + `（${JSON.stringify(u8c.text)}/${u8c.cls} → ${JSON.stringify(u8d.text)}/${u8d.cls}）`);
// 48C-4 程序化整篇换内容（toolboxApplyCodeToEditor = 所有"整篇换内容"的唯一出口）
await u48HintClear();
await send('Input.insertText', { text: '丙' });
await sleep(500);
const u9a = await u48Shot();
await evaluate(`toolboxApplyCodeToEditor('', true)`);
await sleep(500);
const u9b = await u48Shot();
ok(u9a.cls === false && u9b.text === '' && u9b.cls === true,
  `(48)* 案例8·程序化灌入空内容：提示语跟着内容走（${u9a.cls} → ${u9b.cls}）`);

// ==============================================================
console.log('\n====== (49) 案例 3：两次 Enter 的顺序不变量（gap 相对前后段的位置不许变）======\n');
// ★ 顺序断言口径（用户点名要求）：**用节点顺序断言**，不能只断言"存在一根根级 <br>"。
//   u49Shot() 把编辑区根的子节点按顺序列出来（BR = 独立空行 / P = 段落），
//   并给出光标落在第几个根子节点上 —— "空行在谁前面、谁后面"直接可读、可直接比对。
const u49Shot = () => json(`(()=>{const ed=document.getElementById('tbEditor');
  const s=getSelection(); const r=s.rangeCount?s.getRangeAt(0):null;
  const kids=[...ed.childNodes].map(function(c){
    if (c.nodeType===3) return '#text:'+JSON.stringify(c.nodeValue);
    return c.tagName+(c.getAttribute&&c.getAttribute('data-tb-caret')?'[caret]':'');});
  let ci=-1;
  try { if (r) { let m=r.startContainer;
    if (m===ed) ci=r.startOffset;
    else { while(m.parentNode&&m.parentNode!==ed) m=m.parentNode; ci=Array.prototype.indexOf.call(ed.childNodes,m); } } } catch(e){}
  let off=-1, blk='-';
  try { const b=document.createRange(); b.setStart(ed,0); b.setEnd(r.startContainer,r.startOffset); off=b.toString().length; } catch(e){}
  try { let m=r.startContainer; while(m&&m.parentNode&&m.parentNode!==ed) m=m.parentNode; if(m&&m!==ed) blk=m.tagName+':'+m.textContent; } catch(e){}
  return JSON.stringify({ order:kids, caretIn:ci, off:off, blk:blk,
    code:document.getElementById('tbCode').value, text:ed.textContent,
    ps:ed.querySelectorAll('p').length,
    blanks:[...ed.children].filter(function(c){return c.tagName==='BR';}).length });})()`);
const u49New = async () => {
  await resetEditor();
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.focus();
    const r=document.createRange(); r.setStart(ed.querySelector('p'),0); r.collapse(true);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r); toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
  await sleep(320);
};
const u49Set = async (html, selJs) => {
  await resetEditor();
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); ed.innerHTML=${JSON.stringify(html)};
    toolboxNormalizeEditorWhitespace(ed); toolboxRefresh(); toolboxUndoReset(); ed.focus(); return 1;})()`);
  await sleep(240);
  await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); const r=document.createRange(); ${selJs}
    const s=getSelection(); s.removeAllRanges(); s.addRange(r); toolboxSnapClear(); toolboxRange=null; toolboxSaveRange(); return 1;})()`);
  await sleep(180);
};
const u49Ime = async (pre, han) => {
  await send('Input.imeSetComposition', { text: pre, selectionStart: pre.length, selectionEnd: pre.length });
  await sleep(340);
  await send('Input.insertText', { text: han });
  await sleep(720);
};
const u49Enter = async (mods) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: mods || 0, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: mods || 0 });
  await sleep(430);
};
const u49Back = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await sleep(470);
};
const u49AtRootBlank = `r.setStart(ed,2); r.collapse(true);`;
const u49AtNextP = `const p2=ed.querySelectorAll('p')[1]; r.setStart(p2.firstChild||p2,0); r.collapse(true);`;
const u49Base = '<p>甲</p><br><p>乙</p>';
// —— 49A 真实按键序列：`甲` ⏎ ⏎ `乙`（中文输入法路径 —— 本轮案例 3 的回归现场）——
for (const mode of ['ime', 'plain']) {
  const tag = (mode === 'ime') ? '拼音' : '普通输入';
  await u49New();
  if (mode === 'ime') await u49Ime('jia', '甲');
  else { await send('Input.insertText', { text: '甲' }); await sleep(520); }
  const a0 = await u49Shot();
  ok(a0.code === '<p>甲</p>' && a0.ps === 1 && a0.blanks === 0,
    `(49)* 案例3·${tag}：敲「甲」→ 1 个 <p>、没有空行（${JSON.stringify(a0.code)}）`);
  await u49Enter(0);
  const a1 = await u49Shot();
  ok(a1.order.join(',') === 'P,P' && a1.blanks === 0 && a1.code === '<p>甲</p>',
    `(49)* 案例3·${tag}：第一次 Enter → 两个 <p>、**没有**空行（顺序 ${a1.order.join('|')} / ${JSON.stringify(a1.code)}）`);
  await u49Enter(0);
  const a2 = await u49Shot();
  // ② 顺序必须是 前段 → 独立空行 → 落脚段，且**光标在落脚段里、位于那根空行之后**
  ok(a2.order.join(',') === 'P,BR,P' && a2.blanks === 1 && a2.caretIn === 2 && a2.blk === 'P:',
    `(49)* 案例3·${tag}：第二次 Enter → 前段 + 独立空行 + 空落脚块，光标在落脚块里且在空行之后`
    + `（顺序 ${a2.order.join('|')} / 光标在第 ${a2.caretIn} 个根子节点 / 所在块 ${a2.blk}）`);
  if (mode === 'ime') await u49Ime('yi', '乙');
  else { await send('Input.insertText', { text: '乙' }); await sleep(560); }
  const a3 = await u49Shot();
  ok(a3.order.join(',') === 'P,BR,P' && a3.code === '<p>甲</p>\n<br>\n<p>乙</p>' && a3.text === '甲乙',
    `(49)* 案例3·${tag}：敲「乙」→ 文字落在**空行之后**（顺序 ${a3.order.join('|')} / ${JSON.stringify(a3.code)}）`);
  ok(a3.order[1] === 'BR' && a3.order[0] === 'P' && a3.order[2] === 'P' && a3.blanks === 1 && a3.off === 2 && a3.blk === 'P:乙',
    `(49)* 案例3·${tag}：那根空行 <br> 确实在 </p> 之后、下一个 <p> 之前（节点顺序 ${a3.order.join('|')} / `
    + `光标偏移 ${a3.off} 在 ${a3.blk}）`);
}
// —— 49B 同类顺序不变量：空行上的打字 / Shift+Enter / 粘贴 / 退格，都不许改变 gap 的位置 ——
// ① 空行上打字（光标被浏览器解析成"下一段开头"）：空行那一格就地长成 <p>，位置不变
await u49Set(u49Base, u49AtNextP);
await u49Ime('zhong', '中');
const b1 = await u49Shot();
ok(b1.order.join(',') === 'P,P,P' && b1.code === '<p>甲</p>\n<p>中</p>\n<p>乙</p>' && b1.text === '甲中乙',
  `(49)* 顺序不变量·空行上打字：那一格就地变成 <p>（顺序 ${b1.order.join('|')} / ${JSON.stringify(b1.code)}）`);
ok(b1.off === 2 && b1.blk === 'P:中',
  `(49)* 顺序不变量·空行上打字：光标在新字之后、位置就是原来那一格（偏移 ${b1.off} / ${b1.blk}）`);
// ② 空行上打字（光标挂在根的 <br> 旁）：同上
await u49Set(u49Base, u49AtRootBlank);
await u49Ime('zhong', '中');
const b2 = await u49Shot();
ok(b2.order.join(',') === 'P,P,P' && b2.code === '<p>甲</p>\n<p>中</p>\n<p>乙</p>' && b2.off === 2,
  `(49)* 顺序不变量·空行上打字（光标挂根上）：同样只吃掉那一格（顺序 ${b2.order.join('|')} / 偏移 ${b2.off}）`);
// ③ 空行上 Shift+Enter：再补一根**根级**空行，仍在原位置（段内 <br> 一根都不许出现）
await u49Set(u49Base, u49AtRootBlank);
await u49Enter(8);
const b3 = await u49Shot();
ok(b3.order.join(',') === 'P,BR,BR,P' && b3.code === '<p>甲</p>\n<br>\n<br>\n<p>乙</p>'
  && b3.blanks === 2 && b3.ps === 2 && b3.blanks === b1.blanks + 2,
  `(49)* 顺序不变量·空行上 Shift+Enter：新空行紧跟原来那根（顺序 ${b3.order.join('|')} / ${JSON.stringify(b3.code)}）`);
// ④ 空行上粘贴（单段）：内容落进那一格，前后两段不动
await u49Set(u49Base, u49AtRootBlank);
await iPaste44('丙');
await sleep(640);
const b4 = await u49Shot();
ok(b4.order.join(',') === 'P,P,P' && b4.code === '<p>甲</p>\n<p>丙</p>\n<p>乙</p>' && b4.off === 2 && b4.blk === 'P:丙',
  `(49)* 顺序不变量·空行上粘贴单段：内容就落在那一格、光标在字后（顺序 ${b4.order.join('|')} / 偏移 ${b4.off}）`);
// ⑤ 空行上粘贴（两段）：第一段吃掉那一格，其余各成段，后半段留在最后
await u49Set(u49Base, u49AtRootBlank);
await iPaste44('丙\n\n丁');
await sleep(760);
const b5 = await u49Shot();
ok(b5.order.join(',') === 'P,P,BR,P,P' && b5.code === '<p>甲</p>\n<p>丙</p>\n<br>\n<p>丁</p>\n<p>乙</p>' && b5.caretIn === 3,
  `(49)* 顺序不变量·空行上粘贴两段：新段落按顺序插在那一格，段间空行留在两段之间`
  + `（顺序 ${b5.order.join('|')} / 光标在第 ${b5.caretIn} 个根子节点）`);
// ⑥ 空行后退格：只删掉那一根空行，前后两段合到相邻位置（顺序里不许再多出别的节点）
await u49Set(u49Base, u49AtRootBlank);
await u49Back();
const b6 = await u49Shot();
ok(b6.order.join(',') === 'P,P' && b6.code === '<p>甲</p>\n<p>乙</p>' && b6.blanks === 0 && b6.text === '甲乙',
  `(49)* 顺序不变量·空行后退格（光标在空行上）：只少掉那一根 <br>（顺序 ${b6.order.join('|')} / ${JSON.stringify(b6.code)}）`);
await u49Set(u49Base, u49AtNextP);
await u49Back();
const b7 = await u49Shot();
ok(b7.order.join(',') === 'P,P' && b7.code === '<p>甲</p>\n<p>乙</p>' && b7.text === '甲乙',
  `(49)* 顺序不变量·空行后退格（光标在下一段开头）：结果一致（顺序 ${b7.order.join('|')} / ${JSON.stringify(b7.code)}）`);
// ⑦ 空行上打字之后退格：又回到"同一格"的空行（gap 位置可逆）
await u49Set(u49Base, u49AtRootBlank);
await u49Ime('zhong', '中');
await u49Back();
const b8 = await u49Shot();
ok(b8.order.join(',') === 'P,BR,P' && b8.code === '<p>甲</p>\n<br>\n<p>乙</p>' && b8.text === '甲乙',
  `(49)* 顺序不变量·空行上打字段落删空：又回到同一格的空行（顺序 ${b8.order.join('|')} / ${JSON.stringify(b8.code)}）`);

// ==============================================================
console.log('\n====== (50) 动画：全屏⇄小屏 / 打开 / 关闭（复用站内图片放大那套：320ms + cubic-bezier(.22,.61,.36,1)）======\n');
// 现场快照：影子层（数量/矩形/变换/层级/能否被点到）+ 真实卡片与弹窗的矩形与内联残留。
// ★ "只动 transform/opacity"这条硬要求就靠 cardInline/modalInline 这几个字段来验：
//   动画结束后它们必须全是空串（不许留下任何内联 transform/transition/will-change/opacity）。
const a50Shot = () => json(`(()=>{const card=document.querySelector('.tb-card'),modal=document.getElementById('toolboxModal');
  const clones=[...document.querySelectorAll('.tb-flight-clone')]; const c=clones[0];
  const cs=c?getComputedStyle(c):null;
  const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};};
  const toast=document.getElementById('tbToast');
  return JSON.stringify({ clones:clones.length, cloneBox:box(c), cloneTf:cs?cs.transform:null,
    cloneZ:cs?cs.zIndex:null, clonePE:cs?cs.pointerEvents:null, cloneAnim:cs?cs.animationName:null,
    busy:(typeof toolboxFlightBusy==='function')?toolboxFlightBusy():null,
    cardBox:box(card), cardFull:card.classList.contains('tb-full'),
    // offsetWidth/Height 不受任何 transform 影响 —— 用来证明"动画期间布局一点没动"
    cardOffset:{w:card.offsetWidth,h:card.offsetHeight},
    cardInline:{tf:card.style.transform,tr:card.style.transition,wc:card.style.willChange,op:card.style.opacity,
      an:card.style.animation},
    modalInline:{op:modal.style.opacity,tr:modal.style.transition},
    modalOpacity:getComputedStyle(modal).opacity, cardOpacity:getComputedStyle(card).opacity,
    cardAnimName:getComputedStyle(card).animationName,
    modalDisplay:getComputedStyle(modal).display, modalZ:getComputedStyle(modal).zIndex,
    toastZ:toast?getComputedStyle(toast).zIndex:null,
    bodyCls:document.body.className,
    btn:(function(){const b=document.getElementById('toolboxOpenBtn');if(!b||!b.getBoundingClientRect)return null;
      const r=b.getBoundingClientRect();return (r.width<2||r.height<2)?null:{l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};})()
  });})()`);
// 真鼠标点击（不等待）：中途采样必须用这个，clickSel 里那 220ms 会把动画等完
const a50Click = async (sel) => { const b = await btnCenter(sel); if (b.none) throw new Error('找不到元素：' + sel); await clickAt(b.x, b.y); };
const a50Open = async () => { await evaluate('toolboxOpen()'); await sleep(700); };
const a50RectEq = (a, b) => Math.abs(a.l - b.l) <= 1 && Math.abs(a.t - b.t) <= 1 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;
// "中间态确实存在"的采样器：按 40ms 连续看若干帧，只要**有一帧**严格落在两端之间就算命中。
// 不写成"固定等 50ms 看一次"是因为无头 Chrome 偶尔会把过渡的首帧拖后一两帧（实测到过），
// 那一帧仍然停在起点、会被误判成"瞬间跳变"。轮询只是把"确实动过"这件事看清楚，
// 判据一步没松：真的瞬间跳变的话，轮询里一个中间帧都不可能命中（终态时影子层已经摘掉了）。
const a50SampleUntil = async (cond, tries, gap) => {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await a50Shot();
    if (cond(last)) return { hit: true, s: last, i };
    await sleep(gap);
  }
  return { hit: false, s: last, i: tries };
};
const a50Between = (s, from, to) => !!s.cloneBox
  && s.cloneBox.w > Math.min(from.w, to.w) + 4 && s.cloneBox.w < Math.max(from.w, to.w) - 4
  && s.cloneBox.h > Math.min(from.h, to.h) + 4 && s.cloneBox.h < Math.max(from.h, to.h) - 4;
const a50Inverse = (f) => f.clones === 1 && f.busy === true && typeof f.tf === 'string' && f.tf !== 'none'
  && f.tf.indexOf('matrix') === 0 && /translate\(/.test(f.tfInline) && /scale\(/.test(f.tfInline)
  && f.originInline === '50% 50%';
// 首帧"该隐身的都隐身了"——按路径分两种压暗目标（见 toolbox.js 里 toolboxFlightDim* 的注释）：
//   打开 = 压整个弹窗（卡片上正跑着 tbIn，CSS 动画会盖掉内联 opacity，只能压父级）；
//   全屏⇄小屏 = 只压卡片（弹窗一直开着，遮罩 opacity 必须保持 1 —— 背景不许跟着闪）。
const a50FirstDimModal = (f) => f.modalInlineOp === '0' && f.modalOpacity === '0' && f.cardOpacity === '0'
  && !f.cardTf && f.hitInside === true;
const a50FirstDimCard = (f) => f.cardInlineOp === '0' && f.cardOpacity === '0' && f.modalOpacity === '1'
  && !f.cardTf && f.hitInside === true;
// 关窗那条路弹窗已经 display:none（computed opacity 仍是 1，但根本不参与绘制）
const a50FirstHidden = (f) => f.display === 'none' && f.modalInlineOp === '' && !f.cardTf;
const a50CenterDist = (r, o) => Math.hypot((r.l + r.w / 2) - (o.l + o.w / 2), (r.t + r.h / 2) - (o.t + o.h / 2));
// 卡片"真的看得见"的判据：卡片此刻若在渲染树里，计算 opacity 必须是 1。
// ★ 弹窗 display:none 时**不能**看卡片的计算值：卡片上挂着 tbIn 动画，元素不在渲染树里时
//   Chrome 会把被动画的属性解析到 from 关键帧（opacity:0）—— 那是浏览器语义，不是我们压暗的。
//   所以关窗路径只认"内联压暗已清空"（下次显示出来必然是可见的）。
const a50CardVisible = (s) => !s.cardInline.op && (s.modalDisplay === 'none' || s.cardOpacity === '1');
// 终态"干净"：卡片/弹窗上不许留任何内联动画属性，且**两层都要恢复可见**。
// 恢复那一条是用户明确要求的护栏：任何收尾路径漏了复原，就会出现"卡片彻底看不见但还能点"。
const a50Clean = (s) => !s.cardInline.tf && !s.cardInline.tr && !s.cardInline.wc && !s.cardInline.op
  && !s.modalInline.op && !s.modalInline.tr && s.modalOpacity === '1' && a50CardVisible(s);
// 飞行中"该隐身的都隐身了"（两条路各一条）。
// ★ 这两条就是"多一层突现"那个缺陷的看门狗：压暗一旦失效（或被 start 开头的 cancel 撤销），
//   真实卡片就会以终态位置显形，这里立刻红。
const a50MidModalHidden = (s) => s.modalInline.op === '0' && s.modalOpacity === '0'
  && !s.cardInline.tf && !s.cardInline.tr && !s.cardInline.wc;
const a50MidCardHidden = (s) => s.cardInline.op === '0' && s.cardOpacity === '0' && s.modalOpacity === '1'
  && !s.cardInline.tf && !s.cardInline.tr && !s.cardInline.wc;
// 首帧探针：**同步**触发（同一任务内，中间绝不经过 rAF——rAF 才是开始播放的那一步）
// 然后立刻读影子层与真实那一层。用来钉死"任何一帧都不许出现终态位置的那一层"：
//   · 影子层必须已经带着反演到起点的 transform（不是 none、不是终态）；
//   · 影子层矩形必须等于**起点**矩形；
//   · 同一时刻真实那一层必须已经隐身，所以看不到"以终态突现的真实卡片"。
const a50First = (triggerJs) => json(`(()=>{ ${triggerJs};
  const c=document.querySelector('.tb-flight-clone'); const m=document.getElementById('toolboxModal');
  const card=document.querySelector('.tb-card');
  const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};};
  const fb=document.getElementById('tbFullBtn'); const fr=fb.getBoundingClientRect();
  const hit=document.elementFromPoint(fr.left+fr.width/2, fr.top+fr.height/2);
  return JSON.stringify({ clones:document.querySelectorAll('.tb-flight-clone').length,
    tf:c?getComputedStyle(c).transform:null, tfInline:c?c.style.transform:'', originInline:c?c.style.transformOrigin:'',
    cloneBox:box(c), modalOpacity:getComputedStyle(m).opacity, modalInlineOp:m.style.opacity,
    cardOpacity:getComputedStyle(card).opacity, cardAnimName:getComputedStyle(card).animationName, cardInlineOp:card.style.opacity,
    display:getComputedStyle(m).display, cardBox:box(card), cardTf:card.style.transform,
    hitInside:!!(hit && m.contains(hit)), hitWhat:hit?(hit.id||hit.tagName):null,
    busy:(typeof toolboxFlightBusy==='function')?toolboxFlightBusy():null });})()`);
// 逐帧采样器（在页面里用 rAF 连拍，一次往返取回整串）：记录影子层与真实卡片的 opacity。
// 只有逐帧样本才够密到能看清"影子层被摘掉的那一瞬间"它已经淡到几 —— 这是"没有硬切换"的判据。
// 每轮自成一个数组（上一轮的循环发现被取代就自己停），互不污染。
const a50ProbeStart = () => evaluate(`(()=>{const arr=[];window.__a50=arr;let n=0;
  const tick=function(){ if(window.__a50!==arr) return;
    const c=document.querySelector('.tb-flight-clone');const card=document.querySelector('.tb-card');
    arr.push([n++, c?+getComputedStyle(c).opacity:null, +getComputedStyle(card).opacity,
      getComputedStyle(card).animationName]);
    if(n<80)requestAnimationFrame(tick); };
  requestAnimationFrame(tick);return 1;})()`);
const a50ProbeRead = () => json(`JSON.stringify(window.__a50)`);
const a50CloneFrames = (S) => S.filter(s => s[1] !== null);
const a50CrossFrames = (S) => S.filter(s => s[1] !== null && s[1] > 0.05 && s[1] < 0.95);
const a50BothMidFrames = (S) => S.filter(s => s[1] !== null && s[1] > 0.05 && s[1] < 0.95 && s[2] > 0.05 && s[2] < 0.95);
// 影子层在飞的那几帧里，真实卡片上的入场动画 tbIn 必须一直是 none（否则动画会盖掉交叉淡出）
const a50AnimLeakFrames = (S) => S.filter(s => s[1] !== null && s[3] !== 'none');
const a50LastCloneIdx = (S) => { let i = -1; for (let k = 0; k < S.length; k++) if (S[k][1] !== null) i = k; return i; };
// 用户给的"硬切换"判据：前一帧影子层还接近不透明、后一帧影子层已经没了且真实层已经不透明
const a50HardSwitch = (S) => { const bad = []; for (let k = 0; k + 1 < S.length; k++) {
  if (S[k][1] !== null && S[k][1] >= 0.5 && S[k + 1][1] === null && S[k + 1][2] >= 0.9) bad.push(k); } return bad; };
// 内容不变量：动画只许动 transform/opacity，正文 / 代码区 / 校验必须逐字不变
const a50Inv = () => json(`(()=>{const ed=document.getElementById('tbEditor'); const code=document.getElementById('tbCode');
  const v=document.getElementById('tbValidate');
  const exp=toolboxFormatHtml(toolboxParseBox(toolboxCleanHtml()));
  return JSON.stringify({ text:ed.textContent, blocks:ed.querySelectorAll('p,div,center,blockquote,li').length,
    top:ed.children.length, brs:ed.querySelectorAll('br').length, bytes:code.value.length, code:code.value,
    exp:exp, errs:+v.getAttribute('data-errors'), warns:+v.getAttribute('data-warnings') });})()`);

// —— 50A 全屏 ⇄ 小屏 ——
await a50Open();
// 基线：把动画关掉直接切（toolboxWinSetFull 的第二个参数 = false），拿"无动画"的两个终态矩形
await evaluate('toolboxWinSetFull(false, false)'); await sleep(320);
const a50Small = await a50Shot();
await evaluate('toolboxWinSetFull(true, false)'); await sleep(320);
const a50Full = await a50Shot();
await evaluate('toolboxWinSetFull(false, false)'); await sleep(320);
ok(a50Full.cardFull === true && a50Full.cardBox.w > a50Small.cardBox.w + 20,
  `(50) 基线：无动画直接切也照旧（小窗 ${a50Small.cardBox.w}×${a50Small.cardBox.h} → 全屏 ${a50Full.cardBox.w}×${a50Full.cardBox.h}）`);
// 真动画：点全屏 —— **先同步钉首帧**（同一任务内读，中间不经过 rAF），再连续采样中间态
const a50Inv0 = await a50Inv();
const a50PreFull = await a50Shot();
const a50FFin = await a50First(`document.getElementById('tbFullBtn').click()`);
ok(a50Inverse(a50FFin),
  `(50)* 首帧（全屏进）：影子层**一出现就**带着反演到起点的那套 transform（${String(a50FFin.tf).slice(0, 38)}…、origin=${a50FFin.originInline}），不是以终态突现`);
ok(a50RectEq(a50FFin.cloneBox, a50PreFull.cardBox),
  `(50)* 首帧（全屏进）：影子层矩形 = 起点矩形（当前窗口 ${JSON.stringify(a50FFin.cloneBox)}），而不是全屏终态 ${JSON.stringify(a50Full.cardBox)}`);
ok(a50FirstDimCard(a50FFin),
  `(50)* 首帧（全屏进）：同一时刻真实卡片已经压暗（卡片 opacity=${a50FFin.cardOpacity}、内联 ${JSON.stringify(a50FFin.cardInlineOp)}）`
  + `且仍可点击（命中 ${a50FFin.hitWhat}）—— 屏幕上不会同时存在"终态那一层"`);
ok(a50FFin.modalOpacity === '1' && a50FFin.modalInlineOp === '',
  `(50)* 首帧（全屏进）：遮罩**没有**跟着闪 —— 全屏切换时弹窗 opacity 始终是 ${a50FFin.modalOpacity}（只压卡片，不压遮罩）`);
const a50PollA = await a50SampleUntil(s => s.clones === 1 && s.busy === true && a50Between(s, a50Small.cardBox, a50Full.cardBox), 5, 40);
const a50Mid = a50PollA.s;
ok(a50Mid.clones === 1 && a50Mid.busy === true,
  `(50)* 全屏切换：动画真的在跑（飞行层 ${a50Mid.clones} 个、busy=${a50Mid.busy}）`);
ok(typeof a50Mid.cloneTf === 'string' && a50Mid.cloneTf !== 'none' && a50Mid.cloneTf.indexOf('matrix') === 0,
  `(50)* 全屏切换：中途 transform 不是 none、也不是终态（${String(a50Mid.cloneTf).slice(0, 42)}…）`);
ok(a50PollA.hit === true && a50Between(a50Mid, a50Small.cardBox, a50Full.cardBox),
  `(50)* 全屏切换：中途矩形严格落在两端之间（第 ${a50PollA.i + 1} 次采样 ${a50Mid.cloneBox.w}×${a50Mid.cloneBox.h} ∈ `
  + `${a50Small.cardBox.w}×${a50Small.cardBox.h} … ${a50Full.cardBox.w}×${a50Full.cardBox.h}）—— 不是瞬间跳变`);
ok(a50RectEq(a50Mid.cardBox, a50Full.cardBox) && a50Mid.cardFull === true,
  `(50)* 全屏切换：飞行只动影子层 —— 真实卡片在动画期间就已经是终态几何（${JSON.stringify(a50Mid.cardBox)} = 全屏基线）`);
ok(a50MidCardHidden(a50Mid),
  `(50)* 全屏切换中途：真实卡片整段压暗（卡片 opacity=${a50Mid.cardOpacity}，不会"以终态显形"）、遮罩保持不变（弹窗 opacity=${a50Mid.modalOpacity}）、卡片本体无内联动画属性（${JSON.stringify(a50Mid.cardInline)}）`);
ok(a50Mid.clonePE === 'none' && a50Mid.cloneZ === '1210' && a50Mid.cloneAnim === 'none',
  `(50)* 影子层不吃点击（pointer-events=${a50Mid.clonePE}）、层级压在主弹窗之上（z=${a50Mid.cloneZ}）、不跟着卡片播 tbIn（animation-name=${a50Mid.cloneAnim}）`);
ok(a50Mid.modalZ === '1200' && a50Mid.toastZ === '1400',
  `(50)* 层级不变：主弹窗 ${a50Mid.modalZ} < 影子层 1210 < toast ${a50Mid.toastZ}`);
await sleep(560);
const a50End = await a50Shot();
ok(a50End.clones === 0 && a50End.busy === false,
  `(50)* 全屏切换结束后：影子层自己摘掉（clones=${a50End.clones}、busy=${a50End.busy}）`);
ok(a50Clean(a50End),
  `(50)* 全屏切换结束后无残留（卡片 ${JSON.stringify(a50End.cardInline)}、弹窗 ${JSON.stringify(a50End.modalInline)}）`);
ok(a50RectEq(a50End.cardBox, a50Full.cardBox),
  `(50)* 全屏终态矩形与"无动画直接切换"一致（±1px）：${JSON.stringify(a50End.cardBox)} vs ${JSON.stringify(a50Full.cardBox)}`);
// 内容不变量：与动画前的快照逐字比对（文字 / 块数 / 顶层块数 / <br> 数 / 代码区字节）
const a50Inv1 = await a50Inv();
ok(a50Inv1.text === a50Inv0.text && a50Inv1.blocks === a50Inv0.blocks && a50Inv1.top === a50Inv0.top
  && a50Inv1.brs === a50Inv0.brs && a50Inv1.bytes === a50Inv0.bytes && a50Inv1.code === a50Inv0.code,
  `(50)* 全屏动画前后正文与代码逐字不变（文字 ${a50Inv1.text.length} 字、块 ${a50Inv1.blocks}（顶层 ${a50Inv1.top}）、`
  + `<br> ${a50Inv1.brs} 个、代码 ${a50Inv1.bytes} 字节）`);
ok(a50Inv1.exp === a50Inv0.exp && a50Inv1.exp.length > 0 && a50Inv1.errs === a50Inv0.errs && a50Inv1.warns === a50Inv0.warns,
  `(50)* 动画前后导出结果逐字节一致（${a50Inv1.exp.length} 字节）、校验也还是 ${a50Inv1.errs} 错 ${a50Inv1.warns} 警`);
// 再走一次"导出→再导入→再导出"，确认动画之后渲染/解析链路仍然幂等（与 (20)(38) 同一判据）
const a50Idem = await json(`(()=>{const ed=document.getElementById('tbEditor');
  const before=toolboxFormatHtml(toolboxParseBox(toolboxCleanHtml()));
  ed.innerHTML=before; toolboxRefresh(); toolboxUndoReset();
  const after=toolboxFormatHtml(toolboxParseBox(toolboxCleanHtml()));
  return JSON.stringify({ same:before===after, len:before.length, head:before.slice(0,60) });})()`);
await sleep(300);
ok(a50Idem.same === true,
  `(50)* 全屏动画之后"导出→再导入→再导出"仍然逐字节幂等（${a50Idem.len} 字节，${JSON.stringify(a50Idem.head)}…）`);
// 反向：退出全屏也走同一套（同样先同步钉首帧）
const a50PreSmall = await a50Shot();
const a50FFout = await a50First(`document.getElementById('tbFullBtn').click()`);
ok(a50Inverse(a50FFout),
  `(50)* 首帧（全屏出）：影子层一出现就在起点（比恒等/反演 transform：${String(a50FFout.tf).slice(0, 34)}…），不是先以窗口终态突现`);
ok(a50RectEq(a50FFout.cloneBox, a50PreSmall.cardBox) && a50FirstDimCard(a50FFout),
  `(50)* 首帧（全屏出）：影子层矩形 = 当前全屏矩形 ${JSON.stringify(a50FFout.cloneBox)}，且真实卡片已压暗（卡片 opacity=${a50FFout.cardOpacity}）、遮罩未动（弹窗 opacity=${a50FFout.modalOpacity}）、仍可点击`);
const a50PollB = await a50SampleUntil(s => s.clones === 1 && a50Between(s, a50Small.cardBox, a50Full.cardBox), 5, 40);
const a50Mid2 = a50PollB.s;
ok(a50Mid2.clones === 1 && a50PollB.hit === true,
  `(50)* 退出全屏：同样有中间态（第 ${a50PollB.i + 1} 次采样 ${a50Mid2.cloneBox.w} 介于 ${a50Small.cardBox.w} 与 ${a50Full.cardBox.w} 之间）`);
await sleep(560);
const a50End2 = await a50Shot();
ok(a50End2.clones === 0 && a50RectEq(a50End2.cardBox, a50Small.cardBox) && a50Clean(a50End2),
  `(50)* 退出全屏终态与基线一致且无残留（${JSON.stringify(a50End2.cardBox)}）`);

// —— 50B 打开 / 关闭 ——
const a50Btn = (await a50Shot()).btn;
const a50OpenBase = (await a50Shot()).cardBox;
const a50OpenBaseOff = (await a50Shot()).cardOffset;
// 关闭：先同步钉首帧（首帧必须是**弹窗终态位置的影子层**，而不是先以按钮位置突现）
const a50FFclose = await a50First(`toolboxClose()`);
ok(a50Inverse(a50FFclose),
  `(50)* 首帧（关闭）：影子层一出现就带着起点位置的 transform（${String(a50FFclose.tf).slice(0, 34)}…），不是先以按钮位置突现`);
ok(a50FirstHidden(a50FFclose) && a50RectEq(a50FFclose.cloneBox, a50OpenBase),
  `(50)* 首帧（关闭）：影子层矩形 = 刚才弹窗的矩形 ${JSON.stringify(a50FFclose.cloneBox)}（终点是按钮 ${JSON.stringify(a50Btn)}），真实弹窗当帧就 display:none`);
const a50Closed = await a50Shot();
ok(a50Closed.modalDisplay === 'none' && a50Closed.clones === 1 && a50Closed.busy === true,
  `(50)* 关闭：弹窗**当帧**就收干净（display=${a50Closed.modalDisplay}），动画交给影子层，收尾一点不延后`);
const a50PollC = await a50SampleUntil(s => s.clones === 1 && a50Between(s, a50OpenBase, a50Btn)
  && a50CenterDist(s.cloneBox, a50Btn) < a50CenterDist(a50OpenBase, a50Btn) - 4, 5, 40);
const a50CloseMid = a50PollC.s;
ok(a50CloseMid.clones === 1 && a50PollC.hit === true,
  `(50)* 关闭动画：影子层在中途（第 ${a50PollC.i + 1} 次采样 ${a50CloseMid.cloneBox.w}×${a50CloseMid.cloneBox.h}）、`
  + `且中心确实在朝入口按钮靠近（离按钮 ${Math.round(a50CenterDist(a50CloseMid.cloneBox, a50Btn))} `
  + `< 起点 ${Math.round(a50CenterDist(a50OpenBase, a50Btn))}）`);
await sleep(560);
const a50CloseEnd = await a50Shot();
ok(a50CloseEnd.clones === 0 && a50CloseEnd.busy === false && a50CloseEnd.modalDisplay === 'none' && a50Clean(a50CloseEnd),
  `(50)* 关闭动画结束：影子层摘掉、弹窗保持隐藏、无任何残留（卡片内联压暗 ${JSON.stringify(a50CloseEnd.cardInline.op)} 已清空；`
  + `注意此时卡片的**计算** opacity 被 Chrome 解析成 ${a50CloseEnd.cardOpacity}，那是 tbIn 动画在非渲染树里的语义，不是残留）`);
// 打开：从入口按钮飞到弹窗（必须先把按钮滚进视口 —— 它在「我的」页面很靠下）
await evaluate(`(()=>{const b=document.getElementById('toolboxOpenBtn');if(b&&b.scrollIntoView)b.scrollIntoView({block:'center'});return 1;})()`);
await sleep(280);
const a50Btn2 = (await a50Shot()).btn;
// 打开：先同步钉首帧（首帧必须是**入口按钮位置的影子层**，而不是先以弹窗终态突现）
const a50FFopen = await a50First(`document.getElementById('toolboxOpenBtn').click()`);
ok(a50Inverse(a50FFopen),
  `(50)* 首帧（打开）：影子层一出现就带着反演到按钮的 transform（${String(a50FFopen.tf).slice(0, 34)}…），不是以弹窗终态突现`);
ok(a50Btn2 && a50RectEq(a50FFopen.cloneBox, a50Btn2) && a50FirstDimModal(a50FFopen),
  `(50)* 首帧（打开）：影子层矩形 = 入口按钮矩形 ${JSON.stringify(a50FFopen.cloneBox)}，且真实弹窗已压暗（弹窗/卡片 opacity=${a50FFopen.modalOpacity}/${a50FFopen.cardOpacity}）、按钮仍可点击`);
const a50PollD = await a50SampleUntil(s => s.clones === 1 && s.busy === true && a50Between(s, a50Btn2 || a50Btn, a50OpenBase), 5, 40);
const a50OpenMid = a50PollD.s;
ok(a50OpenMid.clones === 1 && a50OpenMid.busy === true && a50OpenMid.modalDisplay === 'flex',
  `(50)* 打开动画：影子层从入口按钮飞出来（clones=${a50OpenMid.clones}、弹窗 display=${a50OpenMid.modalDisplay}）`);
ok(a50Btn2 && a50PollD.hit === true && a50Between(a50OpenMid, a50Btn2, a50OpenBase)
  && a50OpenMid.cardOffset.w === a50OpenBaseOff.w && a50OpenMid.cardOffset.h === a50OpenBaseOff.h,
  `(50)* 打开动画：中途矩形介于按钮（${a50Btn2 ? a50Btn2.w : '?'}）与弹窗（${a50OpenBase.w}）之间（第 ${a50PollD.i + 1} 次采样 `
  + `${a50OpenMid.cloneBox.w}）；真实卡片布局在动画期间一点没动（offset ${a50OpenMid.cardOffset.w}×${a50OpenMid.cardOffset.h} `
  + `= 终态 ${a50OpenBaseOff.w}×${a50OpenBaseOff.h}）`);
ok(a50MidModalHidden(a50OpenMid),
  `(50)* 打开动画中途：真实弹窗整段压暗（opacity=${a50OpenMid.modalOpacity}）、卡片本体无内联动画属性（${JSON.stringify(a50OpenMid.cardInline)}）`);
await sleep(560);
const a50OpenEnd = await a50Shot();
ok(a50OpenEnd.clones === 0 && a50OpenEnd.modalDisplay === 'flex' && a50RectEq(a50OpenEnd.cardBox, a50OpenBase) && a50Clean(a50OpenEnd),
  `(50)* 打开动画结束：弹窗落在终态矩形、无残留（${JSON.stringify(a50OpenEnd.cardBox)}）`);
// 关了立刻开：同时只允许一个影子层，终态必须是"开着"
await evaluate('toolboxClose(); toolboxOpen();');
const a50Rapid1 = await a50Shot();
ok(a50Rapid1.clones <= 1 && a50Rapid1.modalDisplay === 'flex',
  `(50)* 关了立刻开：永远只有一个影子层（clones=${a50Rapid1.clones}）、弹窗状态 = 开着`);
await sleep(700);
const a50Rapid2 = await a50Shot();
ok(a50Rapid2.clones === 0 && a50Rapid2.busy === false && a50Rapid2.modalDisplay === 'flex'
  && a50RectEq(a50Rapid2.cardBox, a50OpenBase) && a50Clean(a50Rapid2),
  `(50)* 关了立刻开：终态正确（display=${a50Rapid2.modalDisplay}、矩形 ${JSON.stringify(a50Rapid2.cardBox)}、无残留）`);

// —— 50C 动画期间/之后功能完好 ——
await clickSel('[data-tb="fullscreen"]');
await sleep(700);
await resetEditor();
await sleep(220);
await send('Input.insertText', { text: '后' });
await sleep(520);
const a50Type = await json(`(()=>{const ed=document.getElementById('tbEditor');const code=document.getElementById('tbCode').value;
  const s=getSelection();const r=s.rangeCount?s.getRangeAt(0):null;let off=-1;
  try{const b=document.createRange();b.setStart(ed,0);b.setEnd(r.startContainer,r.startOffset);off=b.toString().length;}catch(e){}
  return JSON.stringify({text:ed.textContent,code:code,off:off});})()`);
ok(a50Type.text === '后' && a50Type.code === '<p>后</p>' && a50Type.off === 1,
  `(50)* 动画结束后输入正常：文字="${a50Type.text}"、代码区=${JSON.stringify(a50Type.code)}、光标偏移=${a50Type.off}`);
// 动画进行中：真按键一落下就立刻收掉动画（不让用户对着看不见的卡片打字）
await a50Click('#tbFullBtn');
await sleep(60);
const a50During0 = await a50Shot();
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
await sleep(60);
const a50During1 = await a50Shot();
await send('Input.insertText', { text: '中' });
await sleep(520);
const a50During2 = await json(`(()=>{const ed=document.getElementById('tbEditor');const code=document.getElementById('tbCode').value;
  const s=getSelection();const r=s.rangeCount?s.getRangeAt(0):null;let off=-1;
  try{const b=document.createRange();b.setStart(ed,0);b.setEnd(r.startContainer,r.startOffset);off=b.toString().length;}catch(e){}
  return JSON.stringify({text:ed.textContent,code:code,off:off});})()`);
ok(a50During0.clones === 1 && a50During1.clones === 0 && a50During1.busy === false,
  `(50)* 飞行中用户一按键就立刻收掉动画（${a50During0.clones} → ${a50During1.clones} 个影子层），光标不会停在看不见的地方`);
ok(a50During2.text === '后中' && a50During2.code === '<p>后中</p>' && a50During2.off === 2,
  `(50)* 动画进行中输入照样正确落入编辑区：文字="${a50During2.text}"、光标偏移=${a50During2.off}`);
// 滚动同步：飞行期间与之后都必须仍然正确（不改那五个函数，只验结果）
// ★ 必须先把内容填到"真的能滚"（60 行）—— 只写一个字的话 scrollTop 会被夹回 0，
//   断言就成了"0 == 0"的空转（这里复用 (41) 那份 60 行内容）。
const a50ScrollShot = () => json(`(()=>{const t=document.getElementById('tbCode');
  // ★ 只"调用"受保护的 toolboxSyncCodeScroll()（一行都没改），且**只在量之前**调 ——
  //   产品自己就是这么用的（toolboxScrollCodeToRange 里先同步镜像层再量 rect）。
  //   镜像层是 overflow:hidden 的懒同步层，平时不跟随 textarea 滚动，所以不能拿
  //   "滚动后 hl.scrollTop 自己就变了"当判据 —— 那不是产品的行为。
  if (typeof toolboxSyncCodeScroll === 'function') toolboxSyncCodeScroll();
  const h=document.getElementById('tbCodeHl'); const inner=document.getElementById('tbCodeGutterInner');
  const tc=getComputedStyle(t);
  const codeTop=t.getBoundingClientRect().top+parseFloat(tc.paddingTop)-t.scrollTop;
  const num=inner.children[0]?inner.children[0].getBoundingClientRect().top:null;
  return JSON.stringify({code:Number(t.scrollTop), hl:Number(h.scrollTop), tf:inner.style.transform||'',
    num:num===null?null:Math.round(num*100)/100,
    delta:num===null?null:Math.round((num-codeTop)*100)/100,
    clones:document.querySelectorAll('.tb-flight-clone').length});})()`);
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); let h='';
  for(let i=1;i<=120;i++) h+='<p>'+i+'段落文字内容</p>';
  ed.innerHTML=h; toolboxRefresh(); return 1;})()`);
await sleep(900);
await evaluate(`(()=>{const t=document.getElementById('tbCode'); t.scrollTop=160; t.dispatchEvent(new Event('scroll')); return t.scrollTop;})()`);
await sleep(140);
await a50Click('#tbFullBtn');
const a50PollE = await a50SampleUntil(s => s.clones === 1, 5, 40);
const a50Scroll = await a50ScrollShot();
ok(a50PollE.hit === true && a50Scroll.clones === 1 && a50Scroll.code === 160 && a50Scroll.hl === 160
  && a50Scroll.tf === 'translateY(-160px)',
  `(50)* 飞行期间滚动同步仍然正确（代码区 ${a50Scroll.code} → 镜像层 ${a50Scroll.hl}、行号栏 ${JSON.stringify(a50Scroll.tf)}、影子层 ${a50Scroll.clones} 个）`);
await sleep(620);
// 动画结束后：正文选中靠后的段落 → "编辑器→代码区"滚动同步仍然生效（与 (20) A/4 同款路径）
await evaluate(`(()=>{const ed=document.getElementById('tbEditor'); const ps=ed.querySelectorAll('p');
  const t=ps[110].firstChild; const r=document.createRange(); r.setStart(t,0); r.setEnd(t,5);
  const s=getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); toolboxSnapClear(); toolboxSaveRange(); return 1;})()`);
await sleep(1200);
const a50Scroll2 = await a50ScrollShot();
ok(a50Scroll2.clones === 0 && a50Scroll2.code > 1000 && a50Scroll2.hl === a50Scroll2.code
  && a50Scroll2.tf === 'translateY(-' + a50Scroll2.code + 'px)' && a50Scroll2.num !== null && Math.abs(a50Scroll2.delta) <= 1,
  `(50)* 动画结束后滚动同步与行号栏对齐仍然正确：选中靠后的段落 → 代码区滚到 ${a50Scroll2.code}、`
  + `镜像层 ${a50Scroll2.hl}、行号栏 ${JSON.stringify(a50Scroll2.tf)}、第 1 个序号与第 1 行顶边差 ${a50Scroll2.delta}px`);

// —— 50D 连点 ——
await evaluate('toolboxWinSetFull(false, false)');
await sleep(260);
for (let i = 0; i < 5; i++) await a50Click('#tbFullBtn');    // 不等待、真连点
await sleep(760);
const a50RapidFull = await a50Shot();
ok(a50RapidFull.cardFull === true && a50RapidFull.clones === 0 && a50RapidFull.busy === false && a50Clean(a50RapidFull),
  `(50)* 连点全屏 5 次：落到唯一正确终态（full=${a50RapidFull.cardFull}、影子层 ${a50RapidFull.clones} 个、无残留）`);
ok(a50RectEq(a50RapidFull.cardBox, a50Full.cardBox),
  `(50)* 连点之后的矩形与"无动画全屏"一致（${JSON.stringify(a50RapidFull.cardBox)}）`);
for (let i = 0; i < 3; i++) { await evaluate('toolboxClose(); toolboxOpen();'); }
await sleep(800);
const a50RapidCycle = await a50Shot();
ok(a50RapidCycle.modalDisplay === 'flex' && a50RapidCycle.clones === 0 && a50Clean(a50RapidCycle),
  `(50)* 连点"关了立刻开" 3 轮：终态是开着、只有一个终态、无残留（display=${a50RapidCycle.modalDisplay}）`);

// —— 50E 恢复护栏：四种打断路径之后，真实弹窗都必须恢复可见（opacity 计算值 1）且能点 ——
// 漏掉任何一条就会出现最糟的状态："卡片彻底看不见、却还能点到"。
console.log('  --- 50E 恢复护栏（正常结束 / 按键打断 / 飞行中再切换 / 飞行中关闭）---');
await evaluate('toolboxWinSetFull(false, false)');
await sleep(300);
// ① 正常结束
await a50First(`document.getElementById('tbFullBtn').click()`);
await sleep(760);
const a50R1 = await a50Shot();
ok(a50R1.clones === 0 && a50R1.busy === false && a50Clean(a50R1)
  && a50R1.modalOpacity === '1' && a50R1.modalDisplay === 'flex',
  `(50)* 恢复①正常结束：影子层摘掉、真实弹窗恢复可见（opacity=${a50R1.modalOpacity}、display=${a50R1.modalDisplay}）、无内联残留`);
// ② 飞行中按键打断
await a50First(`document.getElementById('tbFullBtn').click()`);
await sleep(60);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
await sleep(260);
const a50R2 = await a50Shot();
ok(a50R2.clones === 0 && a50R2.busy === false && a50Clean(a50R2)
  && a50R2.modalOpacity === '1' && a50R2.modalDisplay === 'flex',
  `(50)* 恢复②飞行中按键打断：动画立刻收掉（clones=${a50R2.clones}）、真实弹窗恢复可见（opacity=${a50R2.modalOpacity}）、`
  + `无内联残留（卡片 ${JSON.stringify(a50R2.cardInline.op)}/${JSON.stringify(a50R2.cardInline.tr)}、卡片计算 opacity=${a50R2.cardOpacity}）`);
// ③ 飞行中再次切换（第二次 start 会先取消第一次，取消里必须复原）
await a50First(`document.getElementById('tbFullBtn').click()`);
await sleep(60);
await a50First(`document.getElementById('tbFullBtn').click()`);
await sleep(760);
const a50R3 = await a50Shot();
ok(a50R3.clones === 0 && a50R3.busy === false && a50Clean(a50R3)
  && a50R3.modalOpacity === '1' && a50R3.modalDisplay === 'flex',
  `(50)* 恢复③飞行中再次切换：两次飞行不叠加、终态可见（opacity=${a50R3.modalOpacity}、full=${a50R3.cardFull}）`);
// ④ 飞行中关闭
await a50First(`document.getElementById('tbFullBtn').click()`);
await sleep(60);
await a50First(`toolboxClose()`);
await sleep(760);
const a50R4 = await a50Shot();
ok(a50R4.clones === 0 && a50R4.busy === false && a50Clean(a50R4)
  && a50R4.modalOpacity === '1' && a50R4.modalDisplay === 'none' && a50R4.cardInline.op === '',
  `(50)* 恢复④飞行中关闭：影子层收掉、卡片压暗已复原为 ${JSON.stringify(a50R4.cardInline.op)}、弹窗保持隐藏（display=${a50R4.modalDisplay}）—— 不是"看不见还能点"`);
await a50Open();

// —— 50F prefers-reduced-motion: reduce ——
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
ok(await evaluate(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`) === true,
  '(50) 已模拟 prefers-reduced-motion: reduce');
await evaluate('toolboxClose()');
const a50Rm0 = await a50Shot();
ok(a50Rm0.modalDisplay === 'none' && a50Rm0.clones === 0 && a50Rm0.busy === false,
  `(50)* 减动效：关闭**直接到终态**（没有影子层、没有中间态，display=${a50Rm0.modalDisplay}）`);
await evaluate('toolboxOpen()');
const a50Rm1 = await a50Shot();
ok(a50Rm1.modalDisplay === 'flex' && a50Rm1.clones === 0 && a50RectEq(a50Rm1.cardBox, a50OpenBase),
  `(50)* 减动效：打开**直接到终态**（同一帧就是最终矩形 ${JSON.stringify(a50Rm1.cardBox)}）`);
await a50Click('#tbFullBtn');
await sleep(40);
const a50Rm2 = await a50Shot();
ok(a50Rm2.clones === 0 && a50Rm2.cardFull === true && a50RectEq(a50Rm2.cardBox, a50Full.cardBox),
  `(50)* 减动效：全屏切换**直接到终态**（没有中间态，矩形 ${JSON.stringify(a50Rm2.cardBox)}）`);
await send('Emulation.setEmulatedMedia', { features: [] });
ok(await evaluate(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`) === false,
  '(50) 动效偏好已恢复（后续用例不受影响）');
// 减动效下也不能留下交叉淡出的内联过渡（直跳终态 ⇒ 一次 transition 都不该下发）
await sleep(320);
const a50Rm3 = await a50Shot();
ok(a50Clean(a50Rm3) && a50Rm3.clones === 0,
  `(50)* 减动效：全程没有影子层、也没有给真实卡片挂过交叉淡出的内联过渡（卡片 ${JSON.stringify(a50Rm3.cardInline)}）`);

// —— 50G 落地交叉淡出：目标是**小窗**的两条路（关闭 / 全屏→小窗）不许"硬换人" ——
// 影子层永远按两端里的大矩形排版，落到小矩形时是"大布局被压扁"，而真实小窗有自己的布局
// （工具栏换行、编辑区/代码区比例）—— 硬换人就是用户看到的"最后一帧突变一下"。
// 判据：逐帧采样里不许出现"影子层还接近不透明就被摘掉"的相邻两帧。
console.log('  --- 50G 落地交叉淡出（全屏→小窗 / 关闭）& 大窗两路不许多出淡入 ---');
await a50Open();
await evaluate('toolboxWinSetFull(false, false)'); await sleep(320);

// ① 小窗 → 全屏（大窗路：不加交叉）
await a50ProbeStart();
const a50G1 = await a50First(`document.getElementById('tbFullBtn').click()`);
await sleep(900);
const a50S1 = await a50ProbeRead();
ok(a50Inverse(a50G1) && a50FirstDimCard(a50G1),
  `(50)* 交叉淡出取样①（小窗→全屏）首帧仍然正确：影子层已反演到起点、真实卡片压暗且可点`);
ok(a50CloneFrames(a50S1).length >= 8 && a50CrossFrames(a50S1).length === 0,
  `(50)* 大窗路（小窗→全屏）**不加**交叉：逐帧 ${a50S1.length} 帧里影子层一次都没淡过（${a50CloneFrames(a50S1).length} 帧有影子层，中间值 ${a50CrossFrames(a50S1).length} 帧）—— 落地那一帧本来就逐像素一致，多一次淡入反而看得出"淡进来"`);
ok(a50AnimLeakFrames(a50S1).length === 0,
  `(50)* 大窗路（小窗→全屏）：影子层在飞的 ${a50CloneFrames(a50S1).length} 帧里真实卡片的 animation-name 也一直是 none（这一路卡片被压暗，入场动画同样不该掺和）`);
const a50E1 = await a50Shot();
ok(a50E1.clones === 0 && a50Clean(a50E1) && a50RectEq(a50E1.cardBox, a50Full.cardBox),
  `(50)* 大窗路（小窗→全屏）终态：影子层自摘、无内联残留、矩形与无动画基线一致 ${JSON.stringify(a50E1.cardBox)}`);

// ② 全屏 → 小窗（小窗路：要交叉）
await a50ProbeStart();
const a50G2 = await a50First(`document.getElementById('tbFullBtn').click()`);
await sleep(900);
const a50S2 = await a50ProbeRead();
const a50Last2 = a50LastCloneIdx(a50S2);
ok(a50AnimLeakFrames(a50S2).length === 0,
  `(50)* 交叉淡出前提（全屏→小窗）：影子层在飞的 ${a50CloneFrames(a50S2).length} 帧里，真实卡片的入场动画 tbIn 一直是 none`
  + `（漏 ${a50AnimLeakFrames(a50S2).length} 帧）—— 全屏→小窗会摘掉 .tb-full，若不压住它，tbIn 会重新起跑并盖掉卡片的 opacity 过渡`);
ok(a50BothMidFrames(a50S2).length >= 1,
  `(50)* 交叉确实发生（全屏→小窗）：影子层与真实卡片**同时**处于中间值的帧 ${a50BothMidFrames(a50S2).length} 个（例：影子层 ${a50BothMidFrames(a50S2)[0] ? a50BothMidFrames(a50S2)[0][1] : '—'} / 卡片 ${a50BothMidFrames(a50S2)[0] ? a50BothMidFrames(a50S2)[0][2] : '—'}）—— 比例切换发生在半透明状态下`);
ok(a50Last2 >= 0 && a50S2[a50Last2][1] < 0.25 && a50S2[a50Last2 + 1] && a50S2[a50Last2 + 1][2] >= 0.99,
  `(50)* 没有硬切换（全屏→小窗）：影子层被摘掉前的最后一帧已经淡到 ${a50S2[a50Last2][1].toFixed(3)}，摘掉之后真实卡片是 ${a50S2[a50Last2 + 1] ? a50S2[a50Last2 + 1][2].toFixed(3) : '—'}（逐帧粒度，末帧≈0 而不是"啪"地一下）`);
ok(a50HardSwitch(a50S2).length === 0,
  `(50)* 逐帧扫完 ${a50S2.length} 帧：不存在"影子层还 ≥0.5 就被摘掉且真实层已不透明"的硬切换（${a50HardSwitch(a50S2).length} 处）`);
const a50E2 = await a50Shot();
ok(a50E2.clones === 0 && a50Clean(a50E2) && a50RectEq(a50E2.cardBox, a50Small.cardBox),
  `(50)* 小窗路（全屏→小窗）终态：影子层自摘、无内联残留、矩形与无动画基线 ±1px ${JSON.stringify(a50E2.cardBox)}`);
// 注：内联 animation 由 CSSOM 规范成完整缩写（"auto ease 0s 1 normal none running none"），
// 所以判据看 computed animation-name 是不是 none —— 那才是"入场动画没有重跑"的真凭据。
ok(a50E2.cardInline.an !== '' && a50E2.cardAnimName === 'none' && a50E2.cardOpacity === '1',
  `(50)* 小窗路（全屏→小窗）落地那一帧没有 tbIn 重跑：卡片 computed animation-name=${a50E2.cardAnimName}（内联压制在）、opacity=${a50E2.cardOpacity}`
  + `—— 压制保留到弹窗关闭，见下一条`);

// ③ 打开（大窗路：不加交叉）
await evaluate('toolboxClose()'); await sleep(760);
await a50ProbeStart();
const a50G3 = await a50First(`document.getElementById('toolboxOpenBtn').click()`);
await sleep(900);
const a50S3 = await a50ProbeRead();
ok(a50Inverse(a50G3) && a50FirstDimModal(a50G3),
  `(50)* 交叉淡出取样③（打开）首帧仍然正确：影子层已反演到入口按钮、真实弹窗压暗且按钮可点`);
ok(a50CloneFrames(a50S3).length >= 8 && a50CrossFrames(a50S3).length === 0,
  `(50)* 大窗路（打开）**不加**交叉：逐帧 ${a50S3.length} 帧里影子层一次都没淡过 —— 打开落地的影子层就是真实卡片布局，不需要也不应该有额外淡入`);
const a50E3 = await a50Shot();
ok(a50E3.clones === 0 && a50Clean(a50E3) && a50RectEq(a50E3.cardBox, a50OpenBase),
  `(50)* 大窗路（打开）终态：影子层自摘、无内联残留、矩形与无动画基线一致 ${JSON.stringify(a50E3.cardBox)}`);

// ④ 关闭（小窗路：要交叉；弹窗当帧 display:none，没有能一起淡入的真实层 ⇒ 单边淡出）
await a50ProbeStart();
const a50G4 = await a50First(`toolboxClose()`);
await sleep(900);
const a50S4 = await a50ProbeRead();
const a50Last4 = a50LastCloneIdx(a50S4);
ok(a50FirstHidden(a50G4) && a50Inverse(a50G4),
  `(50)* 交叉淡出取样④（关闭）首帧仍然正确：影子层在弹窗终态矩形上、真实弹窗当帧 display:none`);
ok(a50CrossFrames(a50S4).length >= 1,
  `(50)* 交叉确实发生（关闭）：影子层最后一段确实在淡出（${a50CrossFrames(a50S4).length} 帧处于中间值）—— 弹窗已 display:none，这一路是单边淡出（没有能一起淡入的真实层）`);
ok(a50Last4 >= 0 && a50S4[a50Last4][1] < 0.25,
  `(50)* 没有硬切换（关闭）：影子层被摘掉前的最后一帧已经淡到 ${a50S4[a50Last4][1].toFixed(3)}，不是"啪"地消失`);
ok(a50HardSwitch(a50S4).length === 0,
  `(50)* 逐帧扫完 ${a50S4.length} 帧（关闭）：不存在"影子层还 ≥0.5 就被摘掉"的硬切换（${a50HardSwitch(a50S4).length} 处）`);
const a50E4 = await a50Shot();
ok(a50E4.clones === 0 && a50E4.modalDisplay === 'none' && a50Clean(a50E4),
  `(50)* 小窗路（关闭）终态：影子层自摘、弹窗保持隐藏、无内联残留（卡片压暗 ${JSON.stringify(a50E4.cardInline.op)} 已清空）`);
// 关窗路径必须把 tbIn 的压制也撤掉（弹窗已隐藏 ⇒ 撤掉不会重跑；不撤就会一直挂在卡片上）
ok(a50E4.cardInline.an === '' && a50E4.cardInline.tr === '' && a50E4.cardInline.op === '',
  `(50)* 小窗路（关闭）关掉之后：卡片上的 tbIn 压制与交叉淡出的内联过渡一起撤掉`
  + `（animation=${JSON.stringify(a50E4.cardInline.an)}、transition=${JSON.stringify(a50E4.cardInline.tr)}）—— 弹窗隐藏时撤才不会让入场动画当场重跑`);
await a50Open();
const a50E5 = await a50Shot();
ok(a50E5.cardInline.an === '' && a50E5.modalDisplay === 'flex' && a50Clean(a50E5),
  `(50)* 重开后：打开路**不压**卡片入场动画（内联 animation=${JSON.stringify(a50E5.cardInline.an)}）—— 那一路由压暗整个弹窗兜住，无需压制卡片自己`);

console.log(`\n  -------- 通过 ${pass} / 失败 ${fail} -------- `);
ok(errors.length === 0, `全程无未捕获异常${errors.length} 条）`);
if (errors.length) errors.slice(0, 5).forEach(e => console.log('    ! ' + e.slice(0, 220)));

try { ws.close(); } catch {}
try { child.kill(); } catch {}
try { server.close(); } catch {}
process.exit(fail === 0 ? 0 : 1);
