// ==================== toolbox.js ====================
// 文章编辑器「工具箱」：在「我的」页面里点开一个弹窗，所见即所得地写文章正文，
// 右侧实时同步只读 HTML，最后复制或下载成 .html 丢进 notecollection/coincollection/readmes/。
//
// ★ 为什么是弹窗而不是新页面：
//   本站是**纯静态、零构建**（经典脚本共享全局词法作用域）。开新页面意味着再维护一份
//   index.html + 一套脚本加载顺序；而这个工具本身不依赖任何数据、也不需要路由深链接，
//   所以做成「我的」页里的一个弹窗，既不用动路由，也不会有第二个页面要同步维护。
//
// ★ 为什么生成的内联样式照抄语料，而不是自己发明一套 class：
//   正文是 readmes/*.html 里的**原始 HTML**，渲染时被整体塞进 .article-reader
//   （见 article.js 的 renderArticleReader）。文章正文里没有 <link>，也就是**拿不到本站
//   样式表** —— 任何 class 都只会是死代码。所以能用的只有：
//     ① 内联样式；
//     ② 主题变量 var(--bg)/var(--theme)/var(--border) —— 内联样式里**可以用** var()，
//        而 .article-reader 的 CSS 已经备好了这些变量，浅色/暗色自动跟着走。
//   下面所有模板的句式都是从现有 67 篇语料里统计出来的主流写法（见每处的注释），
//   自己拍一套新句式只会在正文里显得突兀。
//
// ★ 安全：编辑区里的内容会被整段复制给用户去当**文章正文**，而正文最后是以
//   innerHTML 注入 .article-reader 的（article.js:1716）。所以脚本、事件属性、
//   javascript: 链接都必须在这里就挡掉 —— 否则用户从任意网页粘一段内容，
//   就可能把 <script> 一起搬进正文。sanitizeToolboxNode() 负责这件事。

// ========== 常量：语料里统计出来的默认值 ==========
// 引用框：16/17 处完全一致，连 padding/字号都一样，所以直接用这一套。
const TOOLBOX_QUOTE_STYLE = 'background:var(--bg);border-left:3px solid var(--theme);padding:0.5rem 1rem;margin:1rem 0;font-size:0.85rem;';
// 图注 / 小字颜色：#555555（语料 193 处彩色小字里 147 处用它）
const TOOLBOX_SMALL_COLOR = '#555555';
const TOOLBOX_SMALL_SIZE = '0.85rem';
// 文章标题字号：1.1em 出现 66 次，是标题的主流写法
const TOOLBOX_TITLE_SIZE = '1.1em';
// 图片默认宽度：语料里 160 处图片**全部**是 80%
const TOOLBOX_IMG_WIDTH = '80%';
// 表格照抄 notecollection/readmes/gkq_3.html 那套**透明背景**的写法：
// 表头只靠 --border 框线 + --bg 底色区分，没有 #f5f7fa / #fafbfc 这类写死的浅色底。
// 这点很关键：写死浅色底的表格在暗色模式下会"浅色字压浅底"而看不清
//（layout.css 里"文章正文里的表格"那一节就是给这个问题打的补丁）。
const TOOLBOX_TABLE_CELL_STYLE = 'border:1px solid var(--border);padding:0.4rem;';
const TOOLBOX_TABLE_HEAD_STYLE = 'border:1px solid var(--border);padding:0.4rem;background:var(--bg);';

// 行内标签：代码美化时用来判断"能不能和上一行挤在一起"。
const TOOLBOX_INLINE_TAGS = ['A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SPAN', 'CODE',
    'SUB', 'SUP', 'FONT', 'SMALL', 'MARK', 'TIME'];
// ★ 光标托（编辑期临时节点，见 toolboxCaretHolderMake）：一个空的 inline-block span。
//   它一个字都不含（textContent 不变），只在 <br> 后面"撑出那一行"，让光标有落脚的行盒；
//   序列化前一律摘掉，所以导出的 HTML 里永远看不到它。
const TOOLBOX_CARET_ATTR = 'data-tb-caret';
// ★ 空行的唯一形态（用户口径）：块与块之间**一个独立成行的根级 `<br>`**。
//   它不需要任何标记 —— 就是用户规范样例里那种普通 <br>，序列化原样输出、校验器不报错。
//   "空行 ↔ 段落"的互转见 toolboxFillBlankLine / toolboxParagraphToBlankLine。
// 空元素：没有结束标签，也不增加缩进层级。
const TOOLBOX_VOID_TAGS = ['BR', 'IMG', 'HR', 'COL', 'INPUT', 'WBR'];
// 块级标签：代码排版时"各自成一行"的那些。
// ★ 只有块级之间才断行 —— 行内之间插 \n 会被 HTML 折叠成一个空格，凭空改坏排版。
//   没有列进来的（以及 display:inline/flex 的）一律当行内，宁可不换行也不冒险。
const TOOLBOX_BLOCK_TAGS = ['CENTER', 'DIV', 'P', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD',
    'CAPTION', 'COLGROUP', 'COL', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HR', 'BLOCKQUOTE', 'PRE', 'VIDEO'];
// 站内字号刻度（em）：粘贴进来的 px 字号就近吸附到这些值上，见 toolboxNormalizeStyle。
const TOOLBOX_FONT_SCALE = [0.66, 0.7, 0.72, 0.75, 0.78, 0.8, 0.85, 0.9, 0.95, 1, 1.1, 1.2, 1.3, 1.5, 1.6, 2];
// 允许出现在正文里的标签（其余一律拆成纯文本，见 sanitizeToolboxNode）。
// ★ 这份名单是对着 notecollection/readmes/ 里 67 篇文章的真实标签统计补的：
//   td/p/div/img/tr/center/br/span/b/strong/th/col/thead/tbody/table/h4/
//   colgroup/a/sup/video/hr —— 漏一个就会在"导入已有文章"时把那部分降级成纯文本，
//   所以 h1~h6 / ul / ol / li / dl / col / colgroup / sup / video 这些都收进来了。
const TOOLBOX_OK_TAGS = ['P', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
    'BR', 'HR', 'A', 'IMG', 'CENTER', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR',
    'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'SMALL', 'MARK', 'SUB', 'SUP', 'PRE', 'CODE', 'VIDEO'];
// 正文里**绝对不能**出现的标签：文章渲染会把它们剥掉（article.js），
// 带进来只会是"看起来写了、其实不生效"，所以校验里算错误。
const TOOLBOX_BAD_TAGS = ['script', 'style', 'iframe'];

let toolboxLoaded = false;     // DOM 是否已就绪（initToolboxDOM 跑过）
let toolboxTpl = null;         // 用到的元素缓存，避免到处 getElementById
let toolboxRange = null;       // 编辑区里最后一次有效的选区（见下方"选区不丢"的说明）
// 「点按钮那一刻」冻结下来的选区快照：Range + 选中的纯文本。
// ★ 与 toolboxRange 的区别：toolboxRange 是"跟着走"的（selectionchange 一直在刷新），
//   而这一份只在**按下按钮的瞬间**写一次、之后不许改 —— 因为按钮/输入框一拿到焦点，
//   浏览器就可能把编辑区的选区收起，现场再去读就只剩一个空选区，
//   于是"把选中内容包进标题"变成了"插入默认文字"，用户选的字就没了。
// 于是"把选中内容包进标题"变成了"插入默认文字"，用户选的字就没了。
//   ④ 自定义块（标题/引用/图注/落款）一律走 toolboxWrapSelection()：
//      有选区就把选中的**节点**原样包进去，没有才用默认文字。
let toolboxSnapRange = null;
let toolboxSnapText = '';
let toolboxRangeAuto = false;  // 上一次插入是不是"默认文字全选"（插完接着打字就是覆盖它）
// ★ 本页会话标记：页面没刷新时一直是 true。
//   用它区分"同一次会话里关掉再打开"（内容原样保留、不提示草稿、窗口尺寸位置也保留）
//   和"刷新后重新打开"（编辑区是空的，这时才提示 localStorage 里的草稿，窗口回默认尺寸）。
//   故意**只放内存**：刷新后一切归零，行为可预期。
let toolboxSession = false;
let toolboxWinBox = null;      // 会话内记住的窗口尺寸位置 {w,h,left,top}，只在内存里
let toolboxDialogName = '';    // 当前打开的字段对话框名（''=没开）
let toolboxCodeDirty = false;  // 有改动还没算代码
let toolboxCodeRaf = 0;
let toolboxToastTimer = 0;

// ========== 小工具 ==========
function toolboxEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
}

// 取出编辑区里要交给用户的 HTML（已净化、已去掉浏览器留下的垃圾属性）
function toolboxCleanHtml() {
    if (!toolboxTpl || !toolboxTpl.editor) return '';
    let box;
    try { box = toolboxTpl.editor.cloneNode(true); } catch (e) { return toolboxTpl.editor.innerHTML || ''; }
    box.removeAttribute('contenteditable');
    box.removeAttribute('spellcheck');
    box.removeAttribute('role');
    // ★ 图片占位框是纯显示层：先摘掉（包裹层解开、文件名删掉），
    //   序列化出来的永远是**原始那份** HTML —— 幂等靠这一步。
    toolboxStripDisplayNodes(box);
    // ★ 光标托（编辑期用来给"<br> 后面那一行"撑行盒的空 span）不是内容：一律摘掉。
    //   用户已经在那一行打了字的话，字会原样挪到 <br> 后面，一个字符都不会丢 ——
    //   所以导出的永远只有 <br> 和正文，看不到任何工具留下的痕迹。
    toolboxStripCaretHolders(box);
    sanitizeToolboxNode(box);
    // 空块清理放在净化之后：白名单外的标签被拆成文本后，可能出现"只剩一个空 <p>/<span>"的壳，
    // 这些壳在页面上就是一条多余的空行（用户明确要求插入后不出现空行/空块）。
    // ★ 只删**纯包装**标签（p/div/span/center/li），表格里的空单元格与连续的 <br> 一律不动。
    toolboxDropEmptyBlocks(box);
    return box.innerHTML;
}

// 把一段 HTML 放进一个游离的容器里 —— 只用于"取结构来美化打印"，不进文档、不执行脚本。
function toolboxParseBox(html) {
    const box = document.createElement('div');
    box.innerHTML = html || '';
    return box;
}

// 编辑器是否为"空"。浏览器空 contenteditable 里常留 <br> / 空 <div>，不能只看 innerHTML。
function toolboxEditorEmpty() {
    if (!toolboxTpl || !toolboxTpl.editor) return true;
    const el = toolboxTpl.editor;
    if (el.querySelector && el.querySelector('img,table,hr')) return false;
    return !String(el.textContent || '').replace(/[\s\u00a0\u200b]+/g, '');
}

// 字数统计：去掉空白后的字符数（中文写作的通常口径，空格/换行不计）。
function toolboxCountChars(root) {
    if (!root) return 0;
    let text = '';
    try {
        const clone = root.cloneNode(true);
        clone.querySelectorAll('script,style').forEach(function (n) { n.remove(); });
        // ★ 纯显示层（图片占位框的文件名）不是正文内容，字数不能算进去
        toolboxStripDisplayNodes(clone);
        text = clone.textContent || '';
    } catch (e) {
        text = root.textContent || '';
    }
    return text.replace(/[\s\u00a0\u200b]+/g, '').length;
}

// ========== 纯显示层（data-tb-display）==========
// 工具箱会给"取不到图的图片"套一层占位框（B. 图片文件名占位）。它只是为了**看**，
// 不属于正文内容，所以：
//   · data-tb-display="name" → 直接删掉；
//   · data-tb-display="wrap" → **解开**（保留里面的真 <img>）；
// 序列化（代码区/复制/下载）、字数统计、校验读到的都是"没有显示层"的那份内容，
// 所以导入 → 导出字节一致，输出里永远不会出现 data-tb-display。
function toolboxStripDisplayNodes(root) {
    if (!root || !root.querySelectorAll) return;
    const names = root.querySelectorAll('[data-tb-display="name"]');
    for (let i = names.length - 1; i >= 0; i--) {
        if (names[i].parentNode) names[i].parentNode.removeChild(names[i]);
    }
    // 包裹层可能嵌套（理论上不会），从里到外解
    let wraps = root.querySelectorAll('[data-tb-display="wrap"]');
    for (let i = wraps.length - 1; i >= 0; i--) toolboxUnwrapElement(wraps[i]);
}

// ========== 净化 ==========
// 白名单之外的**元素**拆成纯文本、**属性**直接摘掉。
function sanitizeToolboxNode(root) {
    if (!root || !root.querySelectorAll) return;
    // ① 危险/无意义的标签：整棵子树删掉。剩下的"不认识但无害"的在外层循环里降级成纯文本
    //    —— 用户粘来的正文不该凭空丢字。
    //    注意 video 不在删除名单里：语料里真有 5 篇用 <center><video controls src="video/…">
    //    （hk_boc_2018_promo 等），删掉就等于导入时把视频丢了。
    const kill = root.querySelectorAll('script,style,link,meta,iframe,object,embed,form,input,button,textarea,select,svg,canvas,audio,noscript,template,base');
    for (let i = 0; i < kill.length; i++) { try { kill[i].remove(); } catch (e) {} }
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (TOOLBOX_OK_TAGS.indexOf(el.tagName) < 0) {
            const text = document.createTextNode(el.textContent || '');
            if (el.parentNode) el.parentNode.replaceChild(text, el);
            continue;
        }
        // ② 属性白名单：Excel/网页粘来的 class、id、data-*、xmlns 之类一并清掉
        const attrs = Array.prototype.slice.call(el.attributes || []);
        for (let k = 0; k < attrs.length; k++) {
            const name = attrs[k].name.toLowerCase();
            const val = attrs[k].value;
            let keep = (name === 'colspan' || name === 'rowspan' || name === 'width'
                || name === 'style' || name === 'href' || name === 'src' || name === 'controls'
                || name === 'poster' || name === 'alt' || name === 'title' || name === 'target' || name === 'rel'
                // ★ 光标托必须活过净化（带 tb- 前缀，不属于外部粘贴的杂质）；导出前会被摘掉。
                || name === 'data-tb-caret');
            if (!keep) { try { el.removeAttribute(attrs[k].name); } catch (e) {} continue; }
            // ③ 地址：带 scheme 的只允许 http(s)/邮件/电话/data:image；
            //    不带 scheme 的一律当**相对路径**放行 —— 语料里的图片是
            //    readmes/image/xxx.jpg、视频是 video/xxx.mp4，既不是 / 开头也不是 ./ 开头，
            //    按老规则会被当成危险地址整段拆掉（导入已有文章时图片全没了）。
            if (name === 'href' || name === 'src') {
                const v = String(val || '').trim();
                const low = v.replace(/[\u0000-\u0020]/g, '').toLowerCase();
                const hasScheme = /^[a-z][a-z0-9+.\-]*:/.test(low);
                const ok = hasScheme
                    ? (/^(https?:|mailto:|tel:)/.test(low) || (name === 'src' && /^data:image\//.test(low)))
                    : true;
                if (!ok) {
                    const text = document.createTextNode(el.textContent || '');
                    if (el.parentNode) el.parentNode.replaceChild(text, el);
                    break;
                }
            }
            // ④ 行内样式里不许出现老式注入写法
            if (name === 'style') {
                if (/expression\s*\(|javascript\s*:/i.test(val)) {
                    try { el.removeAttribute('style'); } catch (e) {}
                } else {
                    // ⑤ 无损归一化：rgb(r,g,b) → #rrggbb。
                    //    这是**等价改写**，不动任何布局，纯粹让"导入 → 导出"更稳
                    //    （浏览器的 getComputedStyle/序列化有时吐 rgb()，有时吐 hex，
                    //     统一成 hex 之后第二次导出与第三次导出才会完全一致）。
                    //    rgba() 带透明度没法无损转 hex，原样保留。
                    const norm = toolboxNormalizeStyle(val);
                    if (norm === '') { try { el.removeAttribute('style'); } catch (e) {} }
                    else if (norm !== val) { try { el.setAttribute('style', norm); } catch (e) {} }
                }
            }
        }
    }
}

// 行内样式的无损归一化：rgb(1,2,3) → #010203、字号 px → 站内刻度的 em。
// ★ 只做能确定是"外部粘贴带出来的杂质"的改写，用户自己写的样式不动：
//   · rgb() → hex：等价改写（同一个颜色），纯粹让"导入 → 导出"更稳；
//   · font-size:Npx → 就近的站内刻度 em：Word/网页带出来的 15.2px 这种值
//     在站内没有意义（站点字号跟着浏览器默认字号走，px 写死反而错位），
//     所以吸附到站内常用刻度上；**偏离刻度超过 6% 就原样保留**（可能是用户特意调的）。
//   · mso-*（Word 专属属性）和空的 style 直接删掉。
function toolboxNormalizeStyle(style) {
    let s = String(style == null ? '' : style);
    if (!s) return s;
    // ① Word 专属属性
    s = s.replace(/(^|;)\s*mso-[^:;]+:[^;]*/gi, '');
    // ② rgb(r,g,b) → #rrggbb
    //    ★ 顺手把"冒号后的空格"去掉：浏览器序列化 style 时会写成 `color: rgb(1,2,3)`，
    //      只换颜色的话会留下 `color: #010203` —— 与工具其它产出（`color:#555555`）
    //      写法不一致。只动**被改写的那一条声明**，其余原样保留（不重排用户原文）。
    if (s.indexOf('rgb(') >= 0) {
        s = s.replace(/([a-z-]+)\s*:\s*rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi,
            function (m, prop, r, g, b) {
                const hex = function (n) {
                    const v = Math.max(0, Math.min(255, parseInt(n, 10) || 0)).toString(16);
                    return v.length < 2 ? '0' + v : v;
                };
                return String(prop).toLowerCase() + ':#' + hex(r) + hex(g) + hex(b);
            });
    }
    // ③ font-size:Npx → 就近 em
    if (/font-size\s*:\s*[\d.]+px/i.test(s)) {
        s = s.replace(/font-size\s*:\s*([\d.]+)px/gi, function (m, px) {
            const em = (parseFloat(px) || 0) / 16;            // 站点 1rem = 浏览器默认 16px
            let best = 0, bestDiff = 1;
            for (let i = 0; i < TOOLBOX_FONT_SCALE.length; i++) {
                const d = Math.abs(TOOLBOX_FONT_SCALE[i] - em);
                if (d < bestDiff) { bestDiff = d; best = TOOLBOX_FONT_SCALE[i]; }
            }
            if (em > 0 && best && bestDiff / em <= 0.06) {
                return 'font-size:' + String(best).replace(/^0\./, '.') + 'em';
            }
            return m;                                         // 差太多就保留原样
        });
    }
    if (s.replace(/[\s;]/g, '') === '') return '';
    return s;
}

// ========== 代码区：把正文 HTML 按行排版 ==========
// 只影响"显示/复制/下载的那份文本"，编辑区内容与渲染结果都不动。
//
// ★ 排版规则（照着用户最初草稿里 formatHTML() 的思路，但加了安全判定）：
//   · **块级节点各自成一行**（center / div / p / table / tr / ul / li / h1~h6 / hr …），
//     行首**不缩进** —— 与 notecollection/readmes/ 里现有文章的写法一致；
//   · **绝不在两个行内节点之间凭空插换行**：HTML 会把换行折叠成一个空格，
//     在 <center> 里并排的 <span>/<b>/<img>/<a> 之间插 \n 会凭空多出空格，改坏排版。
//     判断依据 = 标签本身是不是块级（拿不准就当行内，不插）；
//   · 块级/行内混排时，只有"相邻位置本来就有空白、或另一边是块级"的地方才断行；
//   · display:flex / inline-flex 的容器整体保持一行（并排图片那种行内并排的容器，
//     里面全是并排的图，拆行只会让代码难读，虽然 flex 会忽略空白文本节点）。
//
// ★ 幂等：我们插进去的那些换行，在"再导入"时会变成块级节点之间的纯空白文本节点，
//   而块级节点之间的纯空白是**没有意义**的（浏览器本来就忽略），所以直接丢掉 ——
//   于是"导入 → 导出 → 再导入 → 再导出"逐字节一致，不会每次多出一批空行。
// ★ 文本节点必须转义（& < >）：不转义的话，正文里一个裸 "<" 会被下一次解析当成标签开头，
//   内容直接被吃掉 —— 而且同样会破坏幂等。
// ★ 空白只折叠 ASCII 空白（不含 \u00a0）：全角不换行空格是**排版**用的
//   （语料里 &nbsp; 就是拿来撑间距的），当成普通空白折叠掉会改坏别人的排版。
function toolboxEscText(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\u00a0/g, '&nbsp;');
}
const TOOLBOX_WS = /[ \t\n\r\f\v]+/g;

function toolboxAttrsOf(el) {
    let s = '';
    const attrs = el.attributes || [];
    for (let i = 0; i < attrs.length; i++) {
        s += ' ' + attrs[i].name + '="' + String(attrs[i].value).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
    }
    return s;
}

// 这个元素能不能和上一行挤在一起（子节点全是文本、行内标签或空元素）
function toolboxIsInlineOnly(node) {
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        // ★ 空元素（<br>/<img>/<hr>…）算"行内"：语料里图片块就是
        //   <center><img src="…" width="80%"></center> 一行写完的，
        //   把它们当块级会把 <center> 拆成三行（跟语料不一致）。
        if (k.nodeType === 1 && TOOLBOX_VOID_TAGS.indexOf(k.tagName) < 0 && !toolboxIsInlineTag(k)) return false;
    }
    return true;
}

// 行内标签 = 白名单里的行内集合；此外"display:flex"的容器也算（见文件头注释）。
// 实现只有一份，在下面（toolboxIsInlineTag 同时认元素和标签名）—— 曾经这里还有一份
// 收元素的版本，被后面的同名函数盖掉了，是"行内之间被插换行"的根因。
function toolboxIsFlexBox(el) {
    const st = el.getAttribute ? String(el.getAttribute('style') || '') : '';
    return /display\s*:\s*(inline-)?flex/i.test(st);
}

// ========== 序列化的换行策略 ==========
// ★ 用户点名的最大问题：导出的换行"极其随意" —— 同一份结构，输入里换行不同就排得不同。
//   现在的规则**完全忽略输入里的空白/换行**，只按标签结构重建：
//     · 块级节点之间换行；
//     · 块**内部**一律不换行（块内若还有块级子节点，就在那些子节点之间换行）；
//     · <tr>/<td>/<th> 必须**一行写完**（单元格里的 <br> 也留在同一行）；
//     · 行内元素之间绝不插换行。
//   于是"同一份 DOM 不论从哪来，导出结果完全一致"（幂等）。
const TOOLBOX_ONELINE_TAGS = ['TR', 'TD', 'TH'];

// 纯空白文本节点在序列化里的处理（这是"忽略输入换行"的关键）：
//   · 不含换行的纯空白（行内的一个空格）：折叠成一个空格**保留** ——
//     <b>甲</b> <b>乙</b> 中间那个空格是有意义的，删了会把两个字粘起来；
//   · 含换行的纯空白：只有"左右两边都紧挨着有字的文本"时才留一个空格
//     （HTML 本来就把换行折叠成空格），其余一律丢掉 ——
//     这样 <td>\n<br>\n</td> 才会变成 <td><br></td>，<center>\n<img>\n</center>
//     才会变成 <center><img …></center>。
function toolboxSerialWs(node, i) {
    const s = String((node && node.nodeValue) || '');
    if (s.indexOf('\n') < 0 && s.indexOf('\r') < 0) return ' ';
    const kids = node.childNodes;
    const edge = function (n, atEnd) {
        if (!n || n.nodeType !== 3) return '';
        const v = String(n.nodeValue || '');
        return atEnd ? v.slice(-1) : v.charAt(0);
    };
    const before = edge(kids[i - 1], true), after = edge(kids[i + 1], false);
    return (/\S/.test(before) && /\S/.test(after)) ? ' ' : '';
}

// 行内元素的序列化。
// ★ 第二个参数 rel 是**可选的记录器**：传了就把"每个文本节点在返回字符串里的
//   [start,end)"记进去（见 toolboxFormatHtml 的映射说明）。不传时行为与以前完全一致。
function toolboxFormatInline(el, rel) {
    let s = '';
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (n.nodeType === 3) {
            const raw = String(n.nodeValue || '');
            if (!raw.replace(TOOLBOX_WS, '')) { s += toolboxSerialWs(n, i); continue; }
            const esc = toolboxEscText(raw.replace(TOOLBOX_WS, ' '));
            if (rel) rel.push({ node: n, start: s.length, end: s.length + esc.length });
            s += esc;
        } else if (n.nodeType === 1) {
            const tag = n.tagName.toLowerCase();
            const at = toolboxAttrsOf(n);
            if (TOOLBOX_VOID_TAGS.indexOf(n.tagName) >= 0) { s += '<' + tag + at + '>'; continue; }
            const head = '<' + tag + at + '>';
            const sub = [];
            const inner = toolboxFormatInline(n, sub);
            if (rel) {
                for (let k = 0; k < sub.length; k++) {
                    rel.push({ node: sub[k].node, start: s.length + head.length + sub[k].start, end: s.length + head.length + sub[k].end });
                }
            }
            s += head + inner + '</' + tag + '>';
        }
    }
    return s;
}

// ★ 结构用途的块级判断：**不带** display:flex 那个特例。
//   toolboxIsBlockTag 里的 flex 特例只服务于"序列化时整行保持一行"（见排版的说明），
//   但结构上 flex 容器仍然是块级 —— 早先误用 toolboxIsBlockTag 做结构判断，
//   把 flex 行当成了"行内元素"，于是"并排图片"的子 div 被提到行外面了（真出过）。
function toolboxIsBlockEl(el) {
    return !!el && el.nodeType === 1 && TOOLBOX_BLOCK_TAGS.indexOf(el.tagName) >= 0;
}

// 这个元素自己算不算"自成一行"的块级（白名单在 TOOLBOX_BLOCK_TAGS）
function toolboxIsBlockTag(el) {
    if (TOOLBOX_BLOCK_TAGS.indexOf(el.tagName) < 0) return false;
    const st = el.getAttribute ? String(el.getAttribute('style') || '') : '';
    // 显式写成行内/flex 的，不按块级处理
    return !/display\s*:\s*(inline|inline-block|inline-flex|flex)/i.test(st);
}

// 这个元素算不算"结构块"：白名单标签即可，另外把显式 display:block 的也算上。
// ★ 与 toolboxIsBlockTag 的区别：后者额外排除了 display:flex 的容器（那是"整行保持一行"
//   的序列化需要），结构上 flex 容器仍然是块级。这里专给"丢空白的结构判断"用。
function toolboxIsStructBlock(el) {
    if (!el || el.nodeType !== 1) return false;
    if (TOOLBOX_BLOCK_TAGS.indexOf(el.tagName) >= 0) return true;
    const st = el.getAttribute ? String(el.getAttribute('style') || '') : '';
    return /display\s*:\s*block\b/i.test(st);
}

// 块级节点之间的纯空白文本节点：没有意义（浏览器也忽略），丢掉才能幂等
// ★ 根级 `<br>`（= 用户留的空行，见 toolboxInsertParagraph）在这里跟块级同等对待：
//   代码区排版时 `<br>` 自己占一行，导入后它两边会留下 "\n" 文本节点。不认这一条，
//   那些 "\n" 就永远清不掉 —— 表现是"编辑区文字里凭空多出换行、撤回后光标定位失配"。
function toolboxWhitespaceBetweenBlocks(node, i) {
    const sep = function (s) { return s.nodeType === 1 && (toolboxIsStructBlock(s) || s.tagName === 'BR'); };
    const kids = node.childNodes;
    for (let k = i - 1; k >= 0; k--) {
        const s = kids[k];
        if (s.nodeType === 3) { if (String(s.nodeValue || '').replace(TOOLBOX_WS, '') === '') continue; return false; }
        // ★ 这里判的是"有没有意义"，所以按结构块算（含 flex 容器）：HTML 里
        //   flex 容器之间的换行同样是会被忽略的空白，代码区导出时也确实把它丢了。
        return sep(s);
    }
    for (let k = i + 1; k < kids.length; k++) {
        const s = kids[k];
        if (s.nodeType === 3) { if (String(s.nodeValue || '').replace(TOOLBOX_WS, '') === '') continue; return false; }
        return sep(s);
    }
    return false;
}

// 把编辑区里"作为块与块之间分隔的纯空白文本节点"真的从 DOM 里删掉。
// ★ 为什么要删（用户实测的 bug）：撤回/重做会用"按行排版后的代码"重建整棵 DOM
//   （toolboxFormatHtml 在块与块之间吐出 \n），于是两个块之间多了只含 "\n" 的文本节点。
//   而选区指纹（选中文字 + 前后各 20 字）是在**没有这些节点**的 DOM 上采集的，
//   重建后 DOM 的文字比指纹多出这些 \n，逐个字符比对必然失配 → 定位失败 → 落到
//   toolboxUndoReset() 那条 at:0 的折叠光标上，表现就是"Ctrl+Z 之后光标瞬移到文首"。
//   把这类节点丢干净，重建后的 DOM 文字与指纹逐字一致，严格匹配就能命中。
// ★ 为什么"只丢这一类"：行内之间的空白是**有意义的**（<b>甲</b> <b>乙</b> 中间那个空格
//   在页面上就是一个空格），动它等于改坏排版，所以只有"前后都是结构块"或"在编辑区
//   根的首/尾且相邻是块"的纯空白节点才丢；其余（行内相邻、表格单元格内、块内换行）
//   一律保留。
// ★ 为什么不动序列化：toolboxFormatHtml 早就把这类空白丢掉了（见那里的
//   toolboxWhitespaceBetweenBlocks 分支），所以代码区文本、渲染结果、幂等性都不变。
function toolboxNormalizeEditorWhitespace(root) {
    if (!root || !root.childNodes) return;
    const kids = Array.prototype.slice.call(root.childNodes);
    for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (n.nodeType !== 3) continue;
        if (String(n.nodeValue || '').replace(TOOLBOX_WS, '') !== '') continue;   // 有字：留着
        // ★ 现算下标：前面的兄弟可能已经被删掉了，拿循环下标去问会越界（真出过 TypeError）。
        const at = Array.prototype.indexOf.call(root.childNodes, n);
        if (at < 0) continue;
        if (!toolboxWhitespaceBetweenBlocks(root, at)) continue;                  // 不是"块间分隔"：留着
        if (n.parentNode) n.parentNode.removeChild(n);
    }
}

// ★ 第二个参数 rec（可选）：把"每个文本节点 → 它在返回字符串里的 [start,end)"
//   记进这个数组。正文↔代码区的高亮就靠它做**区间换算**，不再拿纯文本去源码里搜索
//   （搜索那条路必然出现"跨行对不上""短词匹配到别处/命中属性字符串"，见 toolboxSrcMapBuild）。
function toolboxFormatHtml(box, rec) {
    if (!box) return '';
    const out = [];
    let acc = 0;        // 已产出文本的绝对长度（用来把"行内相对位置"换算成绝对偏移）

    // 把一层的子节点序列排成若干行：块级各自成行，行内贴着当前行
    function emit(parent) {
        let line = '';
        let lnodes = [];        // 当前行里已记录的文本节点（start/end 相对这一行）
        // 追加一段文字；node 传了就顺手记下它在行里的位置
        function add(str, node) {
            if (rec && node && str) lnodes.push({ node: node, start: line.length, end: line.length + str.length });
            line += str;
        }
        // 产出一行（先把这一行里的相对位置换算成源码绝对偏移，再加进 out）
        function pushLine(text, nodes) {
            if (rec && nodes) {
                for (let k = 0; k < nodes.length; k++) {
                    if (nodes[k].end > nodes[k].start) {
                        rec.push({ node: nodes[k].node, srcStart: acc + nodes[k].start, srcEnd: acc + nodes[k].end });
                    }
                }
            }
            out.push(text);
            acc += text.length + 1;         // +1 = out.join('\n') 的那个换行
        }
        const flush = function () {
            // ★ 行首/行尾的空白会被 trim 掉，记录的位置要跟着平移（否则偏移会整体偏几个字符）
            const t = line.trim();
            if (t) {
                const lead = line.length - line.replace(/^\s+/, '').length;
                const nodes = [];
                for (let k = 0; k < lnodes.length; k++) {
                    nodes.push({
                        node: lnodes[k].node,
                        start: Math.max(0, Math.min(t.length, lnodes[k].start - lead)),
                        end: Math.max(0, Math.min(t.length, lnodes[k].end - lead))
                    });
                }
                pushLine(t, nodes);
            }
            line = '';
            lnodes = [];
        };
        const kids = parent.childNodes;
        for (let i = 0; i < kids.length; i++) {
            const n = kids[i];
            if (n.nodeType === 3) {                          // 文本
                const raw = String(n.nodeValue || '');
                if (!raw.replace(TOOLBOX_WS, '')) {          // 纯空白：按上面的规则处理
                    if (toolboxWhitespaceBetweenBlocks(parent, i)) continue;
                    const ws = toolboxSerialWs(n, i);
                    if (ws) line += ws;
                    continue;
                }
                const t = toolboxEscText(raw.replace(TOOLBOX_WS, ' '));
                // ★ 只有空白（含 &nbsp; / 零宽空格）的文本节点**不成行**。
                //   以前这里会把它变成一行 "&nbsp;"：在页面上就是一条凭空的空行
                //   （用户报的"插入任何东西都多出空行"，这是其中一条来源）。
                //   注意：行里已经有字了就不动它 —— 行内的 &nbsp; 是语料里的排版手段。
                if (!line.trim() && !t.replace(/&nbsp;|\u200b|\s/g, '')) continue;
                if (t) add(t, n);
                continue;
            }
            if (n.nodeType !== 1) continue;                   // 注释等一律不输出
            const tag = n.tagName.toLowerCase();
            const open = '<' + tag + toolboxAttrsOf(n) + '>';
            if (TOOLBOX_VOID_TAGS.indexOf(n.tagName) >= 0) {
                // ★ 走到这里的是"块容器的一级孩子"里的空元素。其中 **根级 `<br>` = 用户留的
                //   一个空行**，按用户要求"代码勤换行、一个块一行"——它自己占一行；
                //   连按两次 Enter 留两个空行就是两行 `<br>`，绝不挤成 `<br><br>` 一行。
                //   ★ 段内的 `<br>`（`<p>` 里那些）走的是 toolboxFormatInline，不经过这里，
                //     仍然和同一段的文字待在同一行 —— 段内不硬拆行。
                if (n.tagName === 'BR') { flush(); pushLine(open, null); continue; }
                line += open;
                continue;
            }
            // 表格的行/单元格必须**一行写完**（含里面的 <br>）：td 里再换行会让
            // 一行的内容被拆成三行（用户贴出来的那篇文章里就有）
            if (TOOLBOX_ONELINE_TAGS.indexOf(n.tagName) >= 0) {
                const rel = [];
                const inner = toolboxFormatInline(n, rel);
                const base = line.length + open.length;
                if (rec) { for (let k = 0; k < rel.length; k++) lnodes.push({ node: rel[k].node, start: base + rel[k].start, end: base + rel[k].end }); }
                line += open + inner + '</' + tag + '>';
                continue;
            }
            // flex 容器（并排图片那一行）整体保持一行：里面全是并排的图，
            // 拆行只让代码难读（虽然 flex 会忽略纯空白文本节点，但没必要冒险）
            if (toolboxIsFlexBox(n)) {
                const rel = [];
                const inner = toolboxFormatInline(n, rel);
                const base = line.length + open.length;
                if (rec) { for (let k = 0; k < rel.length; k++) lnodes.push({ node: rel[k].node, start: base + rel[k].start, end: base + rel[k].end }); }
                line += open + inner + '</' + tag + '>';
                continue;
            }
            if (toolboxIsInlineOnly(n)) {                     // <p>甲</p> / <b><span>标题</span></b> 挤一行
                // ★ 这里必须先 flush：<p> 这种"内容全是行内元素"的**块级**元素走的就是这条路，
                //   不 flush 的话相邻两个 <p> 会被连成同一行（整篇导出成一长条）。
                //   块与块之间换行、块内不换行 —— 这条规则就是靠这里的 flush 落地的。
                flush();
                const rel = [];
                const inner = toolboxFormatInline(n, rel);
                const nodes = [];
                if (rec) { for (let k = 0; k < rel.length; k++) nodes.push({ node: rel[k].node, start: open.length + rel[k].start, end: open.length + rel[k].end }); }
                pushLine(open + inner + '</' + tag + '>', nodes);
                continue;
            }
            flush();                                          // 块级：先收掉手上这行
            pushLine(open, null);
            emit(n);
            pushLine('</' + tag + '>', null);
        }
        flush();
    }

    emit(box);
    return out.join('\n');
}

// 刷新代码区 + 字数 + 校验（实现在下面"代码区：实时双向同步"那一节，这里保留调用点）。

// 输入时每帧最多刷一次（连打字时不至于每键都重排一次代码文本）
function toolboxScheduleRefresh(force) {
    toolboxCodeDirty = true;
    if (force) { toolboxRefresh(); return; }
    if (toolboxCodeRaf) return;
    toolboxCodeRaf = requestAnimationFrame(function () {
        toolboxCodeRaf = 0;
        if (toolboxCodeDirty) toolboxRefresh();
    });
}

// ========== 选区：工具栏按钮不能把编辑区里的选区弄丢 ==========
// 这是所见即所得编辑器最容易坏的地方：<button> 按下会抢走焦点，contenteditable 的
// 选区随之消失，再执行 execCommand 就没有作用对象了。三道保险：
//   ① 工具栏按钮的 mousedown 里 preventDefault()（不让按钮拿到焦点）；
//   ② selectionchange 时把 Range 存下来，执行命令前 restore；
//   ③ restore 失败（存档节点已被回收）就退到"编辑区末尾"，宁可插到末尾也不能静默不动。
function toolboxSaveRange() {
    if (!toolboxTpl || !toolboxTpl.editor) return;
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (!r) return;
    const ed = toolboxTpl.editor;
    const node = r.commonAncestorContainer;
    if (!node) return;
    const holder = (node.nodeType === 1) ? node : node.parentNode;
    if (node !== ed && !(holder && ed.contains(holder))) return;
    // ★ 折叠的光标**不能**覆盖住一个"还活着的选区"。
    //   原因：浏览器在 focus()/重排之后会自己发一次 selectionchange，把选区收成一个
    //   光标；那时 toolboxRange 里存的只是"什么都没选中"，后面点颜色/加粗就作用不到
    //   刚选中的那段字上（曾经真的踩到：选好字点颜色，颜色没上）。
    //   真正"用户把光标挪走了"的情况由编辑区的 pointerdown/keydown 显式清空
    //   （见 initToolboxDOM 里的 toolboxDropRange），所以这里不必怕存不到光标。
    if (r.collapsed && toolboxRangeLive(toolboxRange) && !toolboxRange.collapsed) return;
    try { toolboxRange = r.cloneRange(); } catch (e) { /* 极端情况下 clone 会抛，忽略 */ }
}

// 用户自己动了光标（在编辑区里点鼠标 / 敲方向键）：存档和快照都按"现场"重新来。
function toolboxDropRange() {
    toolboxSnapClear();
    toolboxRange = null;
}

// ＝＝ 空编辑区提示语（「从这里开始……」）的显隐判定 ＝＝
// ★ 为什么改成 JS 按内容实时判定：以前只靠 CSS 的 `:empty` / `:has(> p:only-child > br:only-child)`
//   来切，遇到"根上正挂着合成中的拼音裸文本"这类中间态就会误判成"空" —— 于是**有正文时提示语
//   还显示、压在正文第一行上**（用户实测："敲第二行的时候，从这里开始和第一行重叠出现"）。
// ★ 判定口径（**与 toolboxEditorEmpty() 完全同一套** —— "代码区是不是空的"用的就是那个判据）：
//     · 任何非空白**文字**（合成中的拼音就是文本节点）→ 有内容；
//     · 页面里的 img / table / hr / video / input → 有内容；
//     · **只有空行**（根级 `<br>` ×N、或 `<p><br><br></p>` 这种只有换行没有字的块）→ **算空**。
//   ★ 为什么"只有空行"必须算空（用户实测 bug 3）：用 Ctrl+Z 一路撤回到全空时，编辑区正好落在
//     "一根独立空行 `<br>`"这个形态上，而代码区是空的（''）—— 旧判据"看见根级 `<br>` 就算有内容"
//     于是让提示语不出现，用户看到的就是"撤回删到全空之后提示语不再出现"。
//     代码区空 ⇒ 提示语该出现；两个判据必须一致，否则就是"所见 ≠ 代码"。
//     （"只有空行"没有任何文字、导出的正文也是空的，所以算空是对的。）
function toolboxHintShouldShow() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return true;
    if (ed.querySelector && ed.querySelector('img,table,hr,video,input')) return false;
    return !String(ed.textContent || '').replace(/[\s\u00a0\u200b]+/g, '');
}
// 切换提示语（显示完全由这个类名决定，见 CSS 的 .tb-editor.tb-hint-on::before）。
// ★ 收口原则（用户要求）：所有"会重建/改动编辑区"的路都必须经过这里，不许逐个补。
//   现在的覆盖：① toolboxRefresh（打字/删除/工具插入/粘贴/归一化都汇到这里）；
//   ② toolboxApplyCodeToEditor（**整篇换内容**的唯一出口：撤回/重做、代码区同步、
//      程序化灌入、重置、导入 —— 都由它落地，见它末尾那一行）；
//   ③ 编辑区 input / keyup / compositionstart·update·end（合成期间的中间态也要跟着走）。
function toolboxHintSync() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !ed.classList) return;
    if (toolboxHintShouldShow()) ed.classList.add('tb-hint-on');
    else ed.classList.remove('tb-hint-on');
}

// 一条命令/一次插入跑完之后调用：**先清掉旧存档**再存当前的现场。
// 为什么要先清：上面那条"折叠光标不许覆盖活选区"的规则会让"操作结果只是个光标"
// 这种情况存不进去，于是第二次点同一个按钮又会作用到上一次的选区上（加粗去不掉）。
function toolboxStoreRangeNow() {
    toolboxRange = null;
    toolboxSaveRange();
}

// 这个 Range 是否还"活着"（节点还在编辑区里）。DOM 被重建过就为假。
function toolboxRangeLive(r) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !r || !r.startContainer) return false;
    const holder = (r.startContainer.nodeType === 1) ? r.startContainer : r.startContainer.parentNode;
    return !!(holder && (holder === ed || ed.contains(holder)));
}

// ========== 实时选区 vs 缓存选区 ==========
// ★ 总原则：**插入/删除**这类"落点"操作，第一顺位永远是"事件触发当下的
//   window.getSelection()" —— paste / drop / pointerdown / click 这些事件里它一定有效。
//   缓存的那份 Range（toolboxRange / toolboxSnapRange）只在下面这两种情况下才用：
//     ① 事件本身拿不到编辑区选区（在工具栏按钮上按下鼠标 → 焦点被按钮抢走）；
//     ② 快照是**这一次**按下时冻结的（toolboxFreezeSelection 只在真的选中了东西时才写）。
//   以前 toolboxInsertHtml 优先用缓存、缓存失效才"追加到末尾"：用户在段落中间按
//   Ctrl+V，内容会跑到文章最末尾 —— 那个 bug 的根因就在这里，不是补丁能修的。
function toolboxLiveRange() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return null;
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let r = null;
    try { r = sel.getRangeAt(0); } catch (e) { return null; }
    return toolboxRangeLive(r) ? r : null;
}

// "最后兜底"：编辑区末尾。**只在**实时的和缓存的选区全都不可用时才走这里，
// 代码里每一处调用都要注明用途，不许把它当默认路径（追加到末尾 = 用户看到的 bug）。
function toolboxEndRange() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return null;
    try {
        const r = document.createRange();
        r.selectNodeContents(ed);
        r.collapse(false);
        return r;
    } catch (e) { return null; }
}

// 冻结当前选区（工具栏按下时调用，见下面的说明）。
function toolboxFreezeSelection() {
    toolboxSaveRange();
    let t = '';
    const sel = window.getSelection && window.getSelection();
    try { if (sel && sel.rangeCount > 0 && !sel.isCollapsed) t = String(sel); } catch (e) { t = ''; }
    // ★ 只在"真的选中了东西"时才覆盖快照。
    //   点对话框里的输入框/确定按钮也会走到这里，而那时编辑区的选区早就收起了（t 为空）；
    //   如果照写不误，刚才选中的内容就被这份空快照抹掉，插链接又会退回默认文字。
    if (t) {
        let r = toolboxRangeLive(toolboxRange) ? toolboxRange : null;
        if (r && r.collapsed) r = null;
        if (!r) { try { r = sel.getRangeAt(0); } catch (e2) { r = null; } }
        toolboxSnapRange = (r && !r.collapsed) ? r.cloneRange() : null;
        toolboxSnapText = t;
    }
    return toolboxSnapText;
}

// 快照作废：用户在编辑区里自己点了鼠标/敲了键/粘贴 —— 这时"现场"才是对的。
function toolboxSnapClear() {
    toolboxSnapRange = null;
    toolboxSnapText = '';
}

// 优先用冻结的那份快照（按钮触发的插入都该用它），没有才用"跟着走"的那份。
function toolboxActiveRange() {
    if (toolboxRangeLive(toolboxSnapRange)) return toolboxSnapRange;
    if (toolboxRangeLive(toolboxRange)) return toolboxRange;
    return null;
}

function toolboxRestoreRange() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return null;
    let r = null;
    // ★ 先试冻结快照：按钮按下后浏览器可能已经把编辑区选区收起了，
    //   这时 toolboxRange 里只剩一个空选区，用它就等于"没有选区"。
    if (toolboxRangeLive(toolboxSnapRange)) r = toolboxSnapRange;
    else if (toolboxRangeLive(toolboxRange)) r = toolboxRange;
    const sel = window.getSelection && window.getSelection();
    if (!sel) return null;
    if (r) {
        try { sel.removeAllRanges(); sel.addRange(r); return r; } catch (e) { r = null; }
    }
    try {                                                 // 兜底：光标落到编辑区末尾
        const end = document.createRange();
        end.selectNodeContents(ed);
        end.collapse(false);
        sel.removeAllRanges();
        sel.addRange(end);
        toolboxRange = end.cloneRange();
        return end;
    } catch (e) { return null; }
}

function toolboxFocusEditor() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return;
    try { ed.focus({ preventScroll: true }); } catch (e) { try { ed.focus(); } catch (e2) {} }
}

// ========== 通用不变量：任何操作之后，焦点都该在编辑区、选区都该还在 ==========
// 用户实测："点一下上面的工具栏，编辑区就失焦了，想连着改两次特别别扭。"
// 两道保险：
//   ① **按下时**就 preventDefault（见 initToolboxDOM 的 pointerdown / mousedown）——
//      按钮根本拿不到焦点，浏览器也不会因为这次点击清掉 contenteditable 的选区；
//   ② 每个操作跑完再兜一次（toolboxKeepFocus）—— 快捷键、右键菜单项、对话框确认/取消
//      这些"遥控"路径也一并覆盖。
// ★ 不许抢焦点的地方：用户正在文件名输入框/代码区/对话框输入框里打字（那是他的本意）。
function toolboxFocusInEditor() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    const a = document.activeElement;
    return !!(a && (a === ed || ed.contains(a)));
}
// 这一下点的是不是"工具栏类"元素（按钮、字号档、分组图标、菜单项、窗口按钮、列宽把手）。
// 编辑区、代码区、文件名输入框、对话框输入框都不算 —— 它们需要浏览器正常的焦点/光标行为。
// 图片占位框也不行：它虽然 contenteditable=false，但点它要能选中图片、要能右键。
function toolboxToolbarHit(t) {
    if (!t || !t.closest) return null;
    const ed = toolboxTpl && toolboxTpl.editor;
    if (ed && ed.contains(t)) return null;
    if (toolboxTpl && (t === toolboxTpl.code || t === toolboxTpl.fileName)) return null;
    const tag = String(t.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null;
    // ★ 工具栏容器本身也算：置灰的按钮（disabled）是**不可聚焦**的元素，
    //   浏览器点它会顺手把当前焦点丢给 body（正文就失焦了，用户得再点回来）。
    //   解决办法是给禁用的按钮加 pointer-events:none（见 CSS），事件于是落在容器上 ——
    //   所以容器必须在这里被认成"工具栏类"，才能真正拦掉那次焦点搬运。
    return t.closest('button, [data-tb], [data-tm], .tb-btn, .tb-size, .tb-tmenu, .tb-toolbar, [data-tb-grip]') || null;
}
// 操作收尾：把焦点还回编辑区（只在"焦点确实掉到别处了"时动手），并且
//   · 焦点本来就在编辑区 → 一个字都不动（连选区都不碰，插入类操作刚放好的光标才不会被弄跑）；
//   · 焦点掉到 body/按钮上 → 聚焦编辑区，**且不动滚动位置**（focus 默认会把容器滚一下）；
//     只有当编辑区里已经没有可用选区时才用存档兜一个（否则会覆盖掉刚插入内容后面的光标）。
function toolboxKeepFocus() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    if (toolboxFocusInEditor()) return true;
    if (toolboxTpl.dialog && toolboxTpl.dialog.style.display === 'flex') return false;   // 对话框还开着：焦点留给它的输入框
    const a = document.activeElement;
    if (a && a !== document.body) {
        const tag = String(a.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable) return false;
    }
    const top = ed.scrollTop, left = ed.scrollLeft;
    const hadRange = !!toolboxLiveRange();
    toolboxFocusEditor();
    ed.scrollTop = top; ed.scrollLeft = left;
    if (!hadRange) toolboxRestoreRange();
    return true;
}

// 把光标定位到刚插入的那段内容之后。
// 规则：整块内容（表格/div/center 这类）→ 落在块**后面**，这样接着打字会新起一段，
// 而不是被吸进表格最后一格里（那是所见即所得编辑器最常见的一个坑）；
// 行内内容（<br>、<a>、<span>、<img>）→ 紧跟在它后面。
function toolboxPlaceCaretAfter(inserted) {
    if (!inserted) return;
    const sel = window.getSelection && window.getSelection();
    if (!sel) return;
    const isEl = inserted.nodeType === 1;
    // ★ <br> 属于**行内内容**（本函数开头那段说明就是这么写的），光标要"紧跟在它后面"、
    //   留在同一个块里。BR 不在 TOOLBOX_INLINE_TAGS（那是"排版能不能同行"用的行内白名单，
    //   BR 归在空元素 TOOLBOX_VOID_TAGS 里），于是这里一直把它当"整块内容"处理 →
    //   toolboxCaretAtEnd() 把光标扔到**编辑区根**的末尾。下一次按 Enter，落点就成了"根的
    //   末尾"，<br> 插到块外面去（用户实测：要在左边按两次 Enter 才看见换行，代码区却已经
    //   两个 <br>；接着打字还落在根上的裸文本里）。HR/表格这类真块级保持原样，IMG 单独排除。
    const isBlock = isEl && inserted.tagName !== 'BR'
        && !toolboxIsInlineTag(inserted.tagName) && inserted.tagName !== 'IMG';
    try {
        const r = document.createRange();
        r.setStartAfter(inserted);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        toolboxRange = r.cloneRange();
    } catch (e) { /* 定位失败无所谓，下一次 restore 会用兜底位置 */ }
    if (isBlock) toolboxCaretAtEnd();
}

// ★ 空编辑区的初始光标：摆进**第一个块里面**（用户实测 bug：光标在「从这里开始」的下面一行）。
//   只把提示语改成绝对定位还不够 —— 不显式摆光标的话，焦点进来时选区停在 #tbEditor 根上
//   （<p> 之后，那里根本没有行盒），第一眼看到的光标就不在提示语那一行。
//   摆进 <p><br></p> 里之后，光标与提示语从第一帧起就在同一行，接着打字也落在同一行。
function toolboxCaretIntoFirstBlock() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const sel = window.getSelection && window.getSelection();
    if (!ed || !sel) return;
    const block = ed.firstChild;
    if (!block) return;
    try {
        const r = document.createRange();
        if (block.nodeType === 1 && toolboxIsBlockEl(block)) { r.selectNodeContents(block); r.collapse(true); }
        else { r.setStart(block, 0); r.collapse(true); }
        sel.removeAllRanges();
        sel.addRange(r);
        toolboxRange = r.cloneRange();
    } catch (e) { /* 摆不进去无所谓：下一次 restore 会用兜底位置 */ }
}

// 光标落在编辑区末尾（"插在块后面"用；编辑区末尾才是真正能接着打字的位置）
function toolboxCaretAtEnd() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const sel = window.getSelection && window.getSelection();
    if (!ed || !sel) return;
    try {
        const r = document.createRange();
        r.selectNodeContents(ed);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
        toolboxRange = r.cloneRange();
    } catch (e) {}
}

// ★ 这里以前有**两个**同名函数：一个收元素、一个收标签名字符串。
//   JS 里后声明的那个会盖掉前一个，于是"传元素的调用"全拿到 false（把 <b> 当成块级，
//   排版时在行内节点之间插了 \n）。现在只留一个，两种入参都认。
function toolboxIsInlineTag(nodeOrName) {
    const isEl = !!(nodeOrName && nodeOrName.tagName);
    const name = String(isEl ? nodeOrName.tagName : (nodeOrName || '')).toUpperCase();
    if (TOOLBOX_INLINE_TAGS.indexOf(name) >= 0) return true;
    return isEl ? toolboxIsFlexBox(nodeOrName) : false;
}

// 在光标处插入一段 HTML。
//
// ★ 为什么**不用** document.execCommand('insertHTML')：
//   它在 contenteditable 里会走一遍"粘贴内容"的规范化流程，把行内样式里的 var()
//   丢掉一部分 —— 实测 <td style="border:1px solid var(--border)"> 的 border 整条消失，
//   <th style="background:var(--bg)"> 被拆成一堆空的长属性。而 var() 正是本站表格
//   "浅色/暗色都看得清"的唯一依靠（layout.css 的 .article-reader table 那节）。
//   代价：这条插入路径不进浏览器的原生撤销栈（Ctrl+Z 一次撤销会跳到更早的状态）。
//   而文章正文里的大量内联 var() 是硬需求，样式正确比撤销粒度重要，所以选后者。
//
// ★ 插入前先把选区**删掉**：execCommand 的 insertHTML 能替换选区，手工插节点不行 ——
//   不删的话就会把内容插在选中文字的前面，留下重复的一段。
//
// atRange（可选）：**显式指定**落点。paste / drop 这类"事件里一定能拿到实时选区"的
//   路径必须传它 —— 缓存 Range 一旦过期，内容就会跑到文章末尾（用户实测的 bug 1）。
//   不传时按 实时选区 → 冻结快照 → 存档 → 编辑区末尾 的顺序找（末尾是最后兜底）。
function toolboxInsertHtml(html, atRange, wrapStray) {
    if (!html) return false;
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    toolboxFocusEditor();
    let r = toolboxRangeLive(atRange) ? atRange : null;
    if (r) {
        // 把实时选区同步给浏览器（下面的 deleteContents/insertNode 都作用在它上面）
        const s = window.getSelection && window.getSelection();
        if (s) { try { s.removeAllRanges(); s.addRange(r); } catch (e) { r = null; } }
    }
    if (!r) {
        // 按钮触发的插入：现场选区可能已经被按钮抢走了，用按下的那一刻冻结的快照
        r = toolboxRestoreRange();
        // 兜底（最后手段，不是默认路径）：编辑区末尾，宁可插到末尾也不能把内容丢掉
        if (!r) r = toolboxEndRange();
    }
    if (!r) return false;
    let ok = false, last = null;
    try {
        r.deleteContents();
        const frag = r.createContextualFragment(html);
        last = frag.lastChild;
        r.insertNode(frag);
        toolboxPlaceCaretAfter(last);
        ok = true;
    } catch (e) { ok = false; }
    if (!ok) {
        // 兜底：createContextualFragment 不可用（老浏览器）时退到 execCommand
        try { ok = document.execCommand('insertHTML', false, html); } catch (e2) { ok = false; }
    }
    if (ok) toolboxStoreRangeNow();
    // ★ 插完就把冻结快照丢掉：快照是"按下按钮那一刻"的东西，
    //   留着它会让下一次操作（尤其是没有选区时的默认文字插入）又去用它。
    toolboxSnapClear();
    // ★ 粘贴那条路（wrapStray）：把编辑区根下面的裸文本/裸行内节点合成 <p> —— 必须在
    //   toolboxUndoPush 之前做，否则撤回栈顶存的是"没包块"的中间态，重做会把裸文本放回来。
    //   别的插入路径（标题/引用/图注/图片/表格/链接/换行）刻意不传：它们本来就产出块，
    //   而且「换行」插的就是一个顶层裸 <br>，包成块会凭空多一个空块（用户明确不要）。
    if (ok && wrapStray) toolboxWrapStrayTopLevel(ed);
    // 边界上留下的空段落/空壳扫掉（表格、图片块插进空编辑区时最常见）
    // ★ 只扫**插入点附近**（传 last）：用户全文里的空块不是我们该动的。
    toolboxCleanEditorBlocks(ed, last);
    // 用户已经在写出新内容了，草稿提示条就没必要继续挂着
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    // ★ 插入也要进撤回栈（一次插入 = 一条记录）。
    //   以前这里没有入栈：点「表格」插一张表、再点「撤回」，撤回的是**插入之前**那一步，
    //   整张表会一起消失 —— 表格操作要"撤回一次就回到操作前"就必须先把插入这步记下来。
    toolboxRefresh();                                     // 先把代码区写成最终那份文本，快照才是准的
    toolboxUndoPush(false);
    return ok;
}

// 把"当前选中的内容"包进一段结构里（标题/引用/图注/落款/链接都用它）。
//
// ★ 为什么不能用 insertHTML + 一段带默认文字的模板：
//   模板里写着"文章标题"，插进去就把用户选的字挤掉了 —— 用户看到的就是
//   "选中一段话，点「标题」，自己的字没了、变出「文章标题」"。
//   正确做法是 extractContents() 把选中的节点取出来 → 放进新元素 → insertNode 插回去。
//
// makeHtml(inner)：inner 放标记串，返回包好的整段 HTML（标记处就是内容的位置）。
// defText：完全没有选区时才用的默认文字。
// 返回 true 表示插入了东西。
const TOOLBOX_SLOT_MARK = 'tb-slot';
function toolboxWrapSelection(makeHtml, defText) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    toolboxFocusEditor();
    // ① 用冻结快照恢复现场选区（现场可能已经被按钮/输入框夺走焦点而变空）
    let r = null;
    const snap = toolboxActiveRange();
    const sel = window.getSelection && window.getSelection();
    if (snap) {
        try { sel.removeAllRanges(); sel.addRange(snap); r = snap; } catch (e) { r = null; }
    }
    // ② 把选中的内容整块取出来（节点级保留，不是取纯文本）
    let frag = null, picked = '';
    if (r && !r.collapsed) {
        try { frag = r.cloneRange().extractContents(); picked = String(frag.textContent || ''); } catch (e) { frag = null; picked = ''; }
        if (!picked) picked = String(toolboxSnapText || '');   // 选区里只有图片之类：文本为空但片段有效
    } else {
        picked = String(toolboxSnapText || '');
    }
    // ③ 快照里也没文本、也没有片段：这才用默认文字
    const usedDefault = !picked;                       // 用了默认文字 → 插完要全选，用户直接打字覆盖
    const content = picked || String(defText || '');
    const useFrag = frag ? frag : null;
    // ④ 组装：先把标记塞进模板，再把标记换成真内容
    let holder = null;
    try { holder = toolboxParseBox(makeHtml('<!--' + TOOLBOX_SLOT_MARK + '-->')); } catch (e) { holder = null; }
    if (!holder) return false;
    const marker = toolboxFindComment(holder, TOOLBOX_SLOT_MARK);
    if (marker && marker.parentNode) {
        const parent = marker.parentNode;
        if (useFrag) {
            try { parent.replaceChild(useFrag, marker); } catch (e) { parent.replaceChild(document.createTextNode(content), marker); }
        } else {
            parent.replaceChild(document.createTextNode(content), marker);
        }
    }
    // ⑤ 插到光标处（选区已经被 extractContents 取走，这里等于"原地替换"）
    if (!r) {
        try {
            r = document.createRange();
            r.selectNodeContents(ed);
            r.collapse(false);
        } catch (e2) { r = null; }
    }
    if (!r) {
        // 连起点都找不到：退到"编辑区末尾"，至少别把内容丢掉
        try {
            const tail = document.createRange();
            tail.selectNodeContents(ed);
            tail.collapse(false);
            r = tail;
        } catch (e3) { return false; }
    }
    let last = null, first = null, ok = false;
    try {
        r.deleteContents();
        while (holder.firstChild) {
            const n = holder.removeChild(holder.firstChild);
            r.insertNode(n);
            if (!first) first = n;
            r.setStartAfter(n);
            r.collapse(true);
            last = n;
            ok = true;
        }
        if (!ok) return false;
    } catch (e4) {
        // 快照的 Range 已经失效（DOM 被重建）：退回"按选中文本重新构造"，文字仍然不丢
        if (!toolboxInsertHtml(makeHtml(toolboxEscText(content)))) return false;
        if (window.console && console.warn) {
            console.warn('[工具箱] 原选区已失效，已按选中文本重建结构（文字保留，行内格式可能丢失）');
        }
        toolboxSnapClear();
        return true;
    }
    // ⑥ 块级内容别留在 <p> 里（非法嵌套会让"导出再导入"变样）：提到段落外面
    const hoisted = toolboxHoistBlock(first, last);
    if (hoisted) last = hoisted;
    toolboxSnapClear();
    // ⑥.5 插入过程会在边界留下空的 <p>/<div>（原来那个空段落、被提走内容后的空壳），
    //      它们在页面上就是一条多余的空行 —— 这里只扫**插入点附近**（不要清洗用户全文）。
    toolboxCleanEditorBlocks(ed, last);
    // ⑦ 用的是**默认文字**（"文章标题"这类）→ 插完立刻把这段文字全选，
    //    用户直接打字就能覆盖，不用手动先删。插的是用户选中的原文时**不**全选
    //    —— 那一次要保留"原地替换"的选区语义。
    if (usedDefault && content) {
        const t = toolboxSelectText(ed, content);
        if (t) {
            toolboxHideDraftBar();
            toolboxScheduleDraftSave();
            toolboxScheduleRefresh(true);
            return true;
        }
    }
    toolboxPlaceCaretAfter(last);
    toolboxStoreRangeNow();
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    return true;
}

// 在 root 里找**最后**一个内容等于 text 的文本节点并全选它。
// 用"最后一个"：刚插入的那份一定在末尾，前面可能有同名的旧内容。
function toolboxSelectText(root, text) {
    if (!root || !text) return null;
    const sel = window.getSelection && window.getSelection();
    if (!sel) return null;
    let target = null;
    const walk = document.createTreeWalker(root, 4, null, false);      // 4 = SHOW_TEXT
    let n = walk.nextNode();
    while (n) {
        if (String(n.nodeValue || '').trim() === String(text).trim()) target = n;
        n = walk.nextNode();
    }
    if (!target) return null;
    try {
        const r = document.createRange();
        r.setStart(target, 0);
        r.setEnd(target, target.nodeValue.length);
        sel.removeAllRanges();
        sel.addRange(r);
        toolboxRange = r.cloneRange();
        toolboxRangeAuto = true;
        return target;
    } catch (e) { return null; }
}

// 在容器里找一条注释节点（当占位标记用）。
// 用注释而不是文本标记：注释不会被 HTML 解析器折叠/合并，也不会跟正文撞车。
function toolboxFindComment(root, mark) {
    if (!root) return null;
    const walk = document.createTreeWalker(root, 128, null, false);   // 128 = SHOW_COMMENT
    let n = walk.nextNode();
    while (n) {
        if (String(n.nodeValue || '').indexOf(mark) >= 0) return n;
        n = walk.nextNode();
    }
    return null;
}

// 把刚插入的一组块级节点从 <p>/<div> 里"提"到段落外面。
// ★ 为什么必须提：<p><center>标题</center></p> 是非法嵌套 —— 浏览器重新解析这段
//   HTML 时会把 <p> 拆开、把 <center> 挪出去，于是"导出的 HTML 再导入"就变了样
//   （幂等性直接崩）。所以插入完立刻把它提出来，并把原段落按插入点切成前后两半。
function toolboxHoistBlock(first, last) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !first || !last || !first.parentNode) return null;
    let host = first.parentNode;
    while (host && host !== ed && !toolboxIsBlockTag(host)) host = host.parentNode;
    if (!host || host === ed) return null;                    // 已经是编辑区的直系子节点
    try {
        // ① 先取"插入点之后"的那半截（这时 last 还在树里）
        const tailR = document.createRange();
        tailR.setStartAfter(last);
        tailR.setEndAfter(host.lastChild);
        const tailFrag = tailR.extractContents();
        // ② 再把刚插入的这组取出来
        const grpR = document.createRange();
        grpR.setStartBefore(first);
        grpR.setEndAfter(last);
        const group = grpR.extractContents();
        // ③ 顺序放回：前半截段落 → 这组块 → 后半截段落
        const after = host.cloneNode(false);
        after.appendChild(tailFrag);
        host.parentNode.insertBefore(group, host.nextSibling);
        if (after.firstChild) host.parentNode.insertBefore(after, group.nextSibling);
        // ④ 前半截空掉了就把空壳删掉（"选中整段 → 点标题"最常见，结果不该留个空 <p>）
        if (!String(host.textContent || '').replace(/[\s\u00a0]+/g, '') && !host.querySelector('img,br,table,hr')) {
            host.parentNode.removeChild(host);
        }
        return group.lastChild || null;
    } catch (e) {
        return null;                                          // 提不动就算了，内容已经插好了
    }
}

// 删掉当前选区并让光标停在原处（粘贴时用：默认粘贴已经被拦掉，
// 剪贴板里那段文字不会自己消失，必须显式清掉）。
// atRange（可选）：显式指定的选区（paste/drop 传实时选区，见 toolboxLiveRange）。
function toolboxDeleteSelection(atRange) {
    const sel = window.getSelection && window.getSelection();
    let r = toolboxRangeLive(atRange) ? atRange : null;
    if (!r) {
        if (!sel || sel.rangeCount === 0) return;
        r = sel.getRangeAt(0);
    }
    if (!r || r.collapsed) return;
    try {
        r.deleteContents();
        r.collapse(true);
        if (sel) { sel.removeAllRanges(); sel.addRange(r); }
        toolboxRange = r.cloneRange();
    } catch (e) { /* 删不掉就算了，下面插入的内容会放在光标处 */ }
}

// ========== 命令（加粗/斜体/…）==========
// ★ fontName / foreColor / hiliteColor 这些"老式"命令已经跟着颜色功能一起删了：
//   它们产出 <font>，而语料里没有一个 <font>。字号仍然走 execCommand('fontSize')，
//   见下面的 toolboxApplyFontSize（产出同样立刻内联化成 <span style="font-size:…">）。

function toolboxExec(command, value) {
    // ★ 行内强调（加粗/斜体/下划线/删除线）改走自己的 DOM 变换：
    //   execCommand 对"只有 style="font-weight:700" 的外部内容"只会再叠一层样式、
    //   不写 <b>，而且取消不干净（用户实测 bug 5 的"按钮要真的有效"）。
    if (command === 'bold' || command === 'italic' || command === 'underline' || command === 'strikeThrough') {
        const kind = command === 'strikeThrough' ? 'strike' : command;
        return toolboxToggleInline(kind);
    }
    toolboxFocusEditor();
    toolboxRestoreRange();
    let ok = false;
    try { ok = document.execCommand(command, false, (value === undefined) ? null : value); } catch (e) { ok = false; }
    // 命令之后浏览器会重排选区，重新存一份 —— 连点两次"加粗"才作用在同一处
    toolboxSnapClear();          // 同上：命令用完就丢快照，下一次以现场选区为准
    toolboxStoreRangeNow();
    toolboxScheduleRefresh(true);
    toolboxSyncToolbarState();   // 按钮状态跟着现场走（Bug 5）
    return ok;
}

// 字号：execCommand('fontSize') 只有 1~7 七档、产出 <font size=n>，
// 而语料里小字/标题用的都是 em/rem。所以生成完立刻换成 <span style="font-size:…">。
// ★ 先把已有的 <font> 全部内联化，再执行命令 —— 这样命令新产生的 <font> 才是
//   唯一能被匹配到的那些（否则会把用户之前插入的字号标签也一并重写成新值）。
const TOOLBOX_FONT_EM = { '1': '0.85rem', '2': '1em', '3': '1em', '4': '1.1em', '5': '1.3em', '6': '1.6em', '7': '1.6em' };
// 工具栏五档 → execCommand 的档位
const TOOLBOX_SIZE_TO_FONT = { '0.85rem': '1', '1em': '3', '1.1em': '4', '1.3em': '5', '1.6em': '6' };

// 把 <font> 包成 <span style="font-size:…">（不丢子节点）
function toolboxUnwrapFonts(root, css, onlyTag) {
    if (!root) return;
    let list;
    if (onlyTag) list = root.querySelectorAll('font[size="' + onlyTag + '"]');
    else list = root.querySelectorAll('font');
    for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const span = document.createElement('span');
        const style = onlyTag
            ? 'font-size:' + css + ';'
            // 没有指定档位时，把 font 自己的 color/face/size 转成等价的 span 样式
            : toolboxFontToStyle(f);
        if (style) span.setAttribute('style', style);
        while (f.firstChild) span.appendChild(f.firstChild);
        if (f.parentNode) f.parentNode.replaceChild(span, f);
    }
}

function toolboxFontToStyle(f) {
    let style = '';
    const size = f.getAttribute('size');
    if (size && TOOLBOX_FONT_EM[size]) style += 'font-size:' + TOOLBOX_FONT_EM[size] + ';';
    const color = f.getAttribute('color');
    if (color) style += 'color:' + color + ';';
    const face = f.getAttribute('face');
    if (face) style += "font-family:'" + face + "';";
    return style;
}

function toolboxApplyFontSize(size) {
    const ed = toolboxTpl && toolboxTpl.editor;
    toolboxFocusEditor();
    const r0 = toolboxRestoreRange();
    const fp = r0 ? toolboxSelCapture(ed, r0) : null;   // ★ 改字号后选区也要留着（第 5 条）
    toolboxRestoreRange();
    if (ed) toolboxUnwrapFonts(ed, '', null);        // 先清掉历史 <font>，避免误伤
    let ok = false;
    try { ok = document.execCommand('fontSize', false, size); } catch (e) { ok = false; }
    if (ok && ed) {
        const css = TOOLBOX_FONT_EM[String(size)] || '1em';
        toolboxUnwrapFonts(ed, css, String(size));
        // ★ 选中「正文 1em」这一档时**不写** font-size:1em：那是空操作声明，
        //   工具产出的片段里不该出现（用户点名的"空操作样式"）。
        if (css === '1em') toolboxDropFontSize1em(ed);
    }
    toolboxSnapClear();
    toolboxSelRestore(ed, fp, r0);
    toolboxStoreRangeNow();
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    toolboxSyncToolbarState();
}
// 把 `font-size:1em` 这类空操作声明摘掉（只在刚刚改过字号的那批 <span> 上做）。
// ★ 摘完只剩一个没有任何属性的裸 <span> 时，把壳也拆掉：语料里没有裸 <span>，
//   留着一个"什么都不做"的空壳既是噪声、也会让"输出里不该有的标签"混进文章。
function toolboxDropFontSize1em(root) {
    if (!root || !root.querySelectorAll) return;
    const list = root.querySelectorAll('span[style]');
    for (let i = list.length - 1; i >= 0; i--) {
        const el = list[i];
        const keep = String(el.getAttribute('style') || '').split(';').map(function (x) { return x.trim(); })
            .filter(function (x) { return x && !TOOLBOX_NOOP_STYLE_RE.test(x); });
        if (keep.length) el.setAttribute('style', keep.join(';') + ';');
        else {
            el.removeAttribute('style');
            if (!(el.attributes && el.attributes.length) && el.parentNode) toolboxUnwrapElement(el);
        }
    }
}

// ========== 清除格式（自己用 DOM 变换做，不用 execCommand）==========
// ★ 为什么不再用 document.execCommand('removeFormat')：
//   它在跨块选区上行为不可控 —— 会留下半截 <span>、把两个块并成一个、
//   甚至把 <center> 拆坏（用户实测的 bug 3）。而且它对"外部导入的结构"经常
//   静默失效。现在改成"把选区内容取出来 → 自己做 DOM 变换 → 放回去"，
//   规则明确、结果可预测，还能顺带保证"不产生空块"。
//
// 删除范围（只摘"文字格式"）：
//   · 行内样式声明 color / background* / font-* / text-decoration / line-height …；
//   · 只承载样式的 class；
//   · 纯样式包装 <span style> / <font> → 解掉标签，文字留下；
//   · 行内强调 <b>/<strong>/<i>/<em>/<u>/<s>/<strike>/<del>/<ins>/<mark>/<big>/<small>。
// 保留：块级结构（<center>/<div>/<p>/<br>/<table> 及表格骨架）与文字本身。
//   ★ 刻意**不动** text-align / display / width 这些布局声明，也不动
//   <table>/<td>/<th> 上的边框样式：那些是版式，不是"文字格式"，
//   误删会让用户的表格散架、落款跑到左边（"清格式把整段格式弄乱"的另一半原因）。
const TOOLBOX_TEXT_STYLE_RE = new RegExp('^(color|background|background-color|background-image'
    + '|background-repeat|background-position|background-size|font|font-size|font-weight|font-style'
    + '|font-family|font-variant|line-height|letter-spacing|word-spacing|text-decoration'
    + '|text-decoration-line|text-decoration-color|text-decoration-style|text-shadow|text-transform'
    + '|text-indent|white-space|vertical-align|mso-[^:]*)\\s*:', 'i');
// 会被解开的"格式标签"（内容保留）
const TOOLBOX_FORMAT_TAGS = ['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'INS', 'MARK',
    'BIG', 'SMALL', 'TT', 'FONT', 'SPAN'];
// 表格骨架：这些标签上的样式是"版式"，清格式不许碰
const TOOLBOX_TABLE_SKELETON = ['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'COLGROUP', 'COL'];

// 摘掉一个元素上的"文字格式"声明 + 只承载样式的 class
function toolboxStripTextStyles(el) {
    if (!el || el.nodeType !== 1) return;
    const st = el.getAttribute ? el.getAttribute('style') : null;
    if (st) {
        const keep = String(st).split(';').map(function (x) { return x.trim(); })
            .filter(function (x) { return x && !TOOLBOX_TEXT_STYLE_RE.test(x); });
        if (keep.length) el.setAttribute('style', keep.join('; ') + ';');
        else el.removeAttribute('style');
    }
    if (el.hasAttribute && el.hasAttribute('class')) el.removeAttribute('class');
}

// 对一棵子树做"清格式"（root 自己也算，所以片段和元素都能直接传进来）
function toolboxStripInlineFormat(root) {
    if (!root) return;
    // 先递归子节点（后序）：里面的格式清完了再决定这一层要不要拆
    const kids = Array.prototype.slice.call(root.childNodes || []);
    for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (n.nodeType === 1) toolboxStripInlineFormat(n);
    }
    if (root.nodeType !== 1) return;
    const tag = String(root.tagName || '').toUpperCase();
    if (TOOLBOX_TABLE_SKELETON.indexOf(tag) >= 0) return;      // 表格骨架：样式与结构都不动
    // ★ 显示层（图片占位包裹）不是内容：跳过，别把里面的 <img> 抽出来
    if (root.getAttribute && root.getAttribute('data-tb-display')) return;
    toolboxStripTextStyles(root);
    if (TOOLBOX_FORMAT_TAGS.indexOf(tag) < 0) return;
    // <span>/<font> 只在"壳已经空了"时才拆；b/i/u/s 这类强调标签一律拆掉
    if ((tag === 'SPAN' || tag === 'FONT') && root.attributes && root.attributes.length) return;
    toolboxUnwrapElement(root);
}

// 「清格式」入口：
//   · 有选区 → 克隆选区内容 → 在克隆上做变换 → 替换掉原选区（原结构不受影响）；
//   · 只是光标 → 光标所在的那个块整段清成纯文字（块级结构保留）。
function toolboxClearFormat() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    toolboxFocusEditor();
    const sel = window.getSelection && window.getSelection();
    let r = toolboxActiveRange();
    if (r) {
        try { sel.removeAllRanges(); sel.addRange(r); } catch (e) { r = null; }
    }
    if (!r) { toolboxToast('先点一下要清格式的位置'); return false; }
    const fp = toolboxSelCapture(ed, r);               // ★ 清格式后选区也要留着（第 5 条）
    let touched = null;
    if (r.collapsed) {
        // 光标：处理它所在的那个块（没有块级祖先就退到"包裹着它的那层"）
        let n = r.startContainer, block = null;
        while (n && n !== ed) {
            if (n.nodeType === 1 && toolboxIsBlockTag(n)) { block = n; break; }
            n = n.parentNode;
        }
        if (!block) block = toolboxWrapInlineAncestor(r, ed);
        if (!block) block = ed;
        toolboxStripInlineFormat(block);
        touched = block;
    } else {
        // ★ 就地清：只摘掉"选区覆盖到的那些字"上的格式 —— 块结构、选区之外的文字
        //   一个字都不动。旧实现是"取出片段 → 变换 → 放回去"，落点在块中间时会把宿主
        //   段落切开、还可能把后半截搬到别处（用户实测的"多出换行 + 文字搬家"）。
        const cov = toolboxSplitRangeEdges(ed, r);
        if (!cov.length) { toolboxToast('这段内容清不了格式'); return false; }
        for (let i = cov.length - 1; i >= 0; i--) {
            const node = cov[i];
            if (!node.parentNode) continue;
            toolboxFixInlineChain(node, cov, ed, 'clear');
        }
        touched = (cov[0] && cov[0].parentNode) || null;
    }
    toolboxSnapClear();
    toolboxCleanEditorBlocks(ed, touched);                             // 只清插入点附近的空块
    toolboxSelRestore(ed, fp, r);                                      // ★ 选区留着（第 5 条）
    toolboxStoreRangeNow();
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    toolboxRefresh();
    toolboxUndoPush(false);                                           // 一次清格式 = 一条撤回记录
    toolboxSyncToolbarState();
    return true;
}

// r 里如果没有块级祖先，用"包着它的那层行内元素的父节点"当处理范围
function toolboxWrapInlineAncestor(r, ed) {
    let n = (r.startContainer && r.startContainer.nodeType === 1)
        ? r.startContainer : (r.startContainer && r.startContainer.parentNode);
    while (n && n !== ed) {
        if (n.parentNode === ed) return n;
        n = n.parentNode;
    }
    return null;
}

// ========== 工具栏状态：选中什么就显示什么（像 Word）==========
// ★ 判定全部自己算：祖先链看标签 + getComputedStyle 看实际生效的样式。
//   刻意**不用** document.queryCommandState：它对"我们自己的结构"（<center> 标题、
//   内联 var() 的表格）和"外部导入的 HTML"（只有 style 没有标签）都不准。
const TOOLBOX_SIZE_STEPS = ['0.85rem', '1em', '1.1em', '1.3em', '1.6em'];
// 行的四种强调格式 → 要写的标签（TOOLBOX_INLINE_TAGS 是"行内标签白名单"，别混）
// ★ 上标/下标（用户新增）也走这张表：它们与 BIUS **完全同一套**字符级三态开关
//   （同一个 toolboxToggleInline），所以规范化/嵌套折叠/跨段/选区保留全都免费复用，
//   不另写一套 DOM 变换。
const TOOLBOX_EMPHASIS_TAG = { bold: 'b', italic: 'i', underline: 'u', strike: 's', sup: 'sup', sub: 'sub' };
// 每种行内格式对应的"样式声明"（导入的内容常常只有样式、没有标签）
const TOOLBOX_INLINE_STYLE_RE = {
    bold: /^font-weight\s*:/i,
    italic: /^font-style\s*:/i,
    underline: /^(text-decoration|text-decoration-line)\s*:/i,
    strike: /^(text-decoration|text-decoration-line)\s*:/i,
    // ★ 上下标：导入的内容可能只有 `vertical-align:super/sub` 没有标签。补上这两条之后，
    //   它们跟标签形态一样能被摘掉（互斥与"再点一次取消"都靠它）。
    sup: /^vertical-align\s*:\s*super\b/i,
    sub: /^vertical-align\s*:\s*sub\b/i
};
// ★ 上下标互斥（用户方案 A）：同一个字符不可能同时是上标和下标。
//   应用一个之前，先把另一个从选区里按同一套字符级链路摘干净（见 toolboxToggleInline）。
const TOOLBOX_INLINE_FOE = { sup: 'sub', sub: 'sup' };

function toolboxRGBToHex(c) {
    const m = String(c || '').match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (!m) return /^#[0-9a-f]{3,8}$/i.test(String(c || '').trim()) ? String(c).trim().toLowerCase() : '';
    if (m[4] != null && parseFloat(m[4]) === 0) return '';            // 全透明：等于没有颜色
    const h = function (x) { const s = parseInt(x, 10).toString(16); return s.length < 2 ? '0' + s : s; };
    return '#' + h(m[1]) + h(m[2]) + h(m[3]);
}

// ========== 文字类型识别（用户给的规则，全部用计算样式算）==========
//   图注 = 居中 + 灰色（#555555 这一档）+ 小字（约 0.85rem）
//   标题 = 居中 + 字号约 1.1em + 加粗（font-weight ≥ 600）
//   落款 = 居右
//   引用 = 有 border-left
//   其余 = 正文
// ★ 具体要求：居中要**同时**认 <center> 祖先与计算出来的 text-align:center
//   （Chrome 对 <center> 有时算成 -webkit-center，两个都收）；字号一律换算成
//   "相对编辑区基准字号"的比值再比（不看 px/rem 写法）；灰色按通道容差比
//   （#4d4d4d ~ #5f5f5f 都算"同档"）；返回命中的规则数组 —— 空数组 = 正文，
//   两条以上 = 规则冲突，调用方**什么都不亮**。
const TOOLBOX_GRAY_RGB = [85, 85, 85];        // #555555
const TOOLBOX_GRAY_TOL = 12;                   // 每个通道允许的偏差
const TOOLBOX_TYPE_SIZE_TOL = 0.06;            // 字号比值的容差（0.85 / 1.1 两档）
function toolboxGrayLike(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return false;
    for (let i = 1; i <= 3; i++) {
        if (Math.abs(parseInt(m[i], 16) - TOOLBOX_GRAY_RGB[i - 1]) > TOOLBOX_GRAY_TOL) return false;
    }
    return true;
}
// 沿祖先链看"是不是居中的"：<center> 元素 或 计算出来的 text-align 为 center
function toolboxCenteredAt(node, ed, gcs) {
    let n = node;
    while (n && n !== ed) {
        if (n.nodeType === 1) {
            if (String(n.tagName || '').toUpperCase() === 'CENTER') return true;
            const cs = gcs(n);
            const al = String((cs && cs.textAlign) || '').toLowerCase();
            if (al === 'center' || al === '-webkit-center') return true;
        }
        n = n.parentNode;
    }
    return false;
}
// 沿祖先链看有没有 border-left（引用那条色带）。
// ★ 走到**表格单元格就停**：单元格自己带 1px 边框（表格样式），再往上算就会把
//   普通单元格文字误判成"已经是引用"，于是点「引用」变成"取消引用"、看起来像没反应。
function toolboxLeftBorderAt(node, ed, gcs) {
    let n = node;
    while (n && n !== ed) {
        if (n.nodeType === 1) {
            if (TOOLBOX_TABLE_STRUCT_TAGS.indexOf(String(n.tagName || '').toUpperCase()) >= 0) return false;
            const cs = gcs(n);
            if (cs && (parseFloat(cs.borderLeftWidth) || 0) > 0
                && String(cs.borderLeftStyle || '') !== 'none') return true;
        }
        n = n.parentNode;
    }
    return false;
}
function toolboxTextKind(node, ed, gcs, ratio) {
    if (!node || node === ed) return [];
    const cs = gcs(node) || {};
    const r = parseFloat(ratio) || 0;
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
    const centered = toolboxCenteredAt(node, ed, gcs);
    const gray = toolboxGrayLike(toolboxRGBToHex(cs.color));
    const al = String(cs.textAlign || '').toLowerCase();
    const out = [];
    if (centered && gray && Math.abs(r - 0.85) <= TOOLBOX_TYPE_SIZE_TOL) out.push('caption');
    if (centered && Math.abs(r - 1.1) <= TOOLBOX_TYPE_SIZE_TOL && bold) out.push('title');
    if (al === 'right' || al === 'end') out.push('sign');
    if (toolboxLeftBorderAt(node, ed, gcs)) out.push('quote');
    return out;
}

// 当前选区（或光标处）的格式状态。
// useRange（可选）：调用方已经解析好的选区（例如按下按钮那一刻冻结的快照）。
// ★ 一定要把这个 Range 传进来：现场选区在工具栏按钮按下后可能已经收起，
//   用了收起的那个去算"现在是不是加粗"，第二次点加粗就会又套一层而不是取消（真发生过）。
function toolboxSelState(useRange) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const out = {
        ok: false, bold: false, italic: false, underline: false, strike: false,
        sup: false, sub: false,
        align: '', size: '', title: false, quote: false, body: false,
        caption: false, sign: false, kind: [], conflict: false
    };
    if (!ed) return out;
    const r = toolboxRangeLive(useRange) ? useRange : (toolboxLiveRange() || toolboxActiveRange());
    if (!r) return out;
    let node = r.startContainer;
    // ★ 选区的 startContainer 可能是个**元素**：最典型的是"操作完把选区还原回来"时，
    //   浏览器/我们的还原逻辑给出的区间起点是父元素、偏移指向那个 <b> —— 这时只看
    //   startContainer 的祖先链会漏判"已加粗"，按钮不亮、再点一次还会再套一层
    //   （用户实测的 <b><b>正文</b></b>）。所以先把它归一到"选区里第一个字所在的文本节点"。
    if (!r.collapsed) {
        const firstText = toolboxRangeTextNodes(ed, r);
        if (firstText.length) node = firstText[0].node;
    }
    if (node && node.nodeType === 3) node = node.parentNode;
    if (!node || !ed.contains(node)) return out;      // 光标不在编辑区：工具栏不跟着动
    out.ok = true;
    const gcs = function (el) { try { return window.getComputedStyle ? getComputedStyle(el) : null; } catch (e) { return null; } };
    let n = node, block = null, deepest = null;
    while (n && n !== ed) {
        if (n.nodeType === 1 && !(n.getAttribute && n.getAttribute('data-tb-display'))) {
            if (!deepest) deepest = n;
            const tag = String(n.tagName || '').toUpperCase();
            if (tag === 'B' || tag === 'STRONG') out.bold = true;
            if (tag === 'I' || tag === 'EM') out.italic = true;
            if (tag === 'U') out.underline = true;
            if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') out.strike = true;
            if (tag === 'SUP') out.sup = true;
            if (tag === 'SUB') out.sub = true;
            const cs = gcs(n);
            if (cs) {
                if ((parseInt(cs.fontWeight, 10) || 400) >= 600) out.bold = true;
                if (/italic|oblique/i.test(cs.fontStyle || '')) out.italic = true;
                const deco = String(cs.textDecorationLine || cs.textDecoration || '');
                if (/underline/i.test(deco)) out.underline = true;
                if (/line-through/i.test(deco)) out.strike = true;
                if (/super/i.test(String(cs.verticalAlign || ''))) out.sup = true;
                if (/sub/i.test(String(cs.verticalAlign || ''))) out.sub = true;
            }
            if (!block && toolboxIsBlockTag(n)) block = n;
        }
        n = n.parentNode;
    }
    if (!block) block = ed;
    const bcs = gcs(block);
    const ncs = gcs(deepest || block);
    // 对齐：<center> 与 style="text-align" 都算
    let al = bcs ? String(bcs.textAlign || '') : '';
    if (al === 'start') al = 'left';
    if (al === 'end') al = 'right';
    if (al === '-webkit-center') al = 'center';
    out.align = (al === 'left' || al === 'center' || al === 'right') ? al : '';
    // 字号档位：算出来的 px ÷ 编辑区基准字号 = 比例，就近吸附到工具栏五档（容差 4%）
    const base = parseFloat(gcs(ed) ? gcs(ed).fontSize : '') || 16;
    const px = parseFloat(ncs ? ncs.fontSize : '') || 0;
    let ratio = 0;
    if (px > 0) {
        ratio = px / base;
        let best = '', diff = 0.04;
        for (let i = 0; i < TOOLBOX_SIZE_STEPS.length; i++) {
            const v = parseFloat(TOOLBOX_SIZE_STEPS[i]);
            if (Math.abs(ratio - v) <= diff) { diff = Math.abs(ratio - v); best = TOOLBOX_SIZE_STEPS[i]; }
        }
        out.size = best;
    }
    // ★ 文字类型：按用户给的规则算（全部看"计算样式"，不看标签名 —— 导入/粘贴进来的
    //   内容常常只有 style，没有我们的标签）。判定对象是**祖先链上最里面那个元素**
    //   （deepest：例如图注的 color/0.85rem 写在 <center> 里那层 span 上，块本身没有），
    //   居中则沿祖先链认 <center> 或 text-align:center。
    const kind = toolboxTextKind(deepest || block, ed, gcs, ratio);
    out.kind = kind;
    out.quote = kind.indexOf('quote') >= 0;
    out.title = kind.indexOf('title') >= 0;
    out.caption = kind.indexOf('caption') >= 0;
    out.sign = kind.indexOf('sign') >= 0;
    // 一条规则都没命中 = 正文；命中两条以上（规则冲突，例如"居中的灰色小字"同时又带
    // border-left）→ **什么都不亮**（宁可不亮也别让用户误点一下改错东西）。
    out.conflict = kind.length > 1;
    out.body = !out.conflict && kind.length === 0;
    // ★ 选区跨了多块、且这些块的"类型特征"不一致时**不判类型**（宁可都不亮）：
    //   否则选中"标题 + 正文"两段，按钮会按第一段乱亮一个，用户点下去会误改。
    if (!r.collapsed) {
        const blocks = toolboxBlocksInRange(ed, r);
        if (blocks.length > 1) {
            const feat = function (b) {
                const cs = gcs(b);
                if (!cs) return '';
                const al2 = String(cs.textAlign || '');
                return [al2, cs.fontSize, (parseFloat(cs.borderLeftWidth) || 0) > 0 ? 'q' : ''].join('|');
            };
            const first = feat(blocks[0]);
            for (let i = 1; i < blocks.length; i++) {
                if (feat(blocks[i]) !== first) { out.mixed = true; break; }
            }
        }
    }
    return out;
}
// 选区覆盖到的块级元素（去重、按文档顺序）
function toolboxBlocksInRange(ed, r) {
    const seen = [], out = [];
    const runs = toolboxTextRunsInRange(ed, r);
    for (let i = 0; i < runs.length; i++) {
        const b = runs[i].block;
        if (b && seen.indexOf(b) < 0) { seen.push(b); out.push(b); }
    }
    if (!out.length) {
        const b = toolboxNearestBlock(r.startContainer, ed);
        if (b) out.push(b);
    }
    return out;
}

// 把状态刷到按钮上（选区变化 / 每次操作之后调用；用 rAF 合并，避免拖选时抖）
let toolboxStateRaf = 0;
function toolboxScheduleToolbarState() {
    if (toolboxStateRaf) return;
    const run = function () { toolboxStateRaf = 0; toolboxSyncToolbarState(); };
    try { toolboxStateRaf = requestAnimationFrame(run); } catch (e) { run(); }
}
function toolboxSyncToolbarState() {
    const m = toolboxTpl && toolboxTpl.modal;
    if (!m || m.style.display !== 'flex') return;                 // 弹窗没开：不用算
    const st = toolboxSelState();
    const mark = function (sel, on) {
        const el = m.querySelector(sel);
        if (el) el.classList.toggle('active', !!on);
    };
    const clearAll = function () {
        const on = m.querySelectorAll('.tb-btn.active, .tb-size.active');
        for (let i = 0; i < on.length; i++) on[i].classList.remove('active');
    };
    if (!st.ok) { clearAll(); return; }
    // ★ 混选（跨多种格式的块）：类型/对齐/字号一律不亮 —— 见 toolboxSelState 的 mixed
    const mixed = !!st.mixed;
    mark('[data-tb="bold"]', st.bold);
    mark('[data-tb="italic"]', st.italic);
    mark('[data-tb="underline"]', st.underline);
    mark('[data-tb="strike"]', st.strike);
    mark('[data-tb="sup"]', st.sup);
    mark('[data-tb="sub"]', st.sub);
    const sizes = m.querySelectorAll('.tb-size');
    for (let i = 0; i < sizes.length; i++) {
        sizes[i].classList.toggle('active', !mixed && sizes[i].getAttribute('data-size') === st.size && !!st.size);
    }
    mark('[data-tb="align-left"]', !mixed && st.align === 'left');
    mark('[data-tb="align-center"]', !mixed && st.align === 'center');
    mark('[data-tb="align-right"]', !mixed && st.align === 'right');
    // 文字类型（用户给的规则）：图注 / 标题 / 落款 / 引用 / 正文，五个里最多亮一个；
    // 规则冲突（st.conflict）或跨多块（mixed）时一个都不亮。
    const typeOff = mixed || st.conflict;
    mark('[data-tb="title"]', !typeOff && st.title);
    mark('[data-tb="caption"]', !typeOff && st.caption);
    mark('[data-tb="sign"]', !typeOff && st.sign);
    mark('[data-tb="quote"]', !typeOff && st.quote);
    mark('[data-tb="body"]', !typeOff && st.body);
}

// ========== A. 两侧选区互相对应高亮 ==========
// 需求：左（正文）选中一段文字 → 右（代码区）对应的源文本也高亮，反过来也一样，
// 目的是"一眼找到对应位置"。
//
// ★ 三条硬约束（都会破坏幂等/校验，所以必须绕开）：
//   ① **不许往内容 DOM 里插 <mark>/<span>** —— 高亮全部走 CSS Custom Highlight API
//      （CSS.highlights + ::highlight(tb-sync)），它只画不写 DOM；
//   ② **不许改另一侧的真实选区** —— 不抢焦点、不打断用户正在输入的光标；
//   ③ 找不到对应文本（选中跨了标签、或选中的是标签名）就**安静放弃**。
//
// 实现要点：代码区是 <textarea>，而 Highlight API 只能画在**DOM 文本节点**上
// （textarea 的 value 不在 DOM 里）。所以代码面板里有一层"镜像层"（#tbCodeHl，
// data-tb-display，纯显示、在 textarea 下面、pointer-events:none），文字与
// textarea 完全一致、滚动同步；高亮的 Range 就画在镜像层上。
// 浏览器不支持 Highlight API（window.Highlight / CSS.highlights 缺失）时，
// 退化成"只把对应位置滚动到视野里"，不报错。
const TOOLBOX_HL_NAME = 'tb-sync';
const TOOLBOX_HL_MAX = 200;                    // 选得太长就不折腾了（性能与实用性）
let toolboxHlRaf = 0;
let toolboxHlFrom = '';
// 高亮状态：{ from, text, start, end, srcStart, srcEnd, has }
//   · from === 'editor' → start/end 是**正文可见文字**偏移，srcStart/srcEnd 是源码偏移（画代码镜像层）
//   · from === 'code'   → srcStart/srcEnd 是源码偏移（textarea 的选区本来就是源码偏移），
//                         start/end 是换算出来的正文可见文字偏移（画正文那一侧）
let toolboxHl = { from: '', text: '', start: 0, end: 0, srcStart: 0, srcEnd: 0, has: false };
let toolboxHlAnchor = { editor: 0, code: 0 };

// ========== 正文 ↔ 代码区的**偏移映射**（两侧高亮的唯一依据）==========
// 用户报过两个现象：① 跨行选区对应不上；② 短词匹配到别处（同一个词在别处也出现，
// 甚至命中了属性里的字符串）。根因很直接：**拿纯文本去 indexOf 带标签的源码** ——
// 跨行必然对不上（正文里没有换行、源码里有），短词必然撞上第一次巧合出现的位置。
//
// 改成偏移映射：代码区的源码本来就是**由正文 DOM 序列化出来的**，所以让序列化过程
// 顺手把"每个文本节点 → 它在源码里的 [start,end)"记下来（见 toolboxFormatHtml 的 rec），
// 之后一律按**区间**换算：跨行、跨块天然正确，中间的标签原样包含；
// 不做任何字符串搜索，所以"匹配到别处""命中属性"这两个 bug 直接消失。
//
// ★ 映射唯一会失效的情形是"代码区被直接改了" —— 缓存按 code.value 逐字比对，
//   值一变就自动重建；编辑区改了内容时 toolboxRefresh 也会主动让缓存失效。
let toolboxSrcMapCache = null;

function toolboxSrcMapBuild() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const code = toolboxTpl && toolboxTpl.code;
    if (!ed || !code) return null;
    const src = String(code.value || '');
    if (toolboxSrcMapCache && toolboxSrcMapCache.src === src) return toolboxSrcMapCache;
    const rec = [];
    try { toolboxFormatHtml(toolboxParseBox(toolboxCleanHtml()), rec); } catch (e) { rec.length = 0; }
    // ★ 序列化用的是**净化后的副本**，节点对象跟编辑区里不是同一批 ——
    //   按"文档顺序 + 文字内容"一一配回去。配法是**单调前进**的：
    //   只往后找、不回头，所以绝不会把后面的内容配到前面的位置上（这正是"匹配到别处"的根源）。
    const norm = function (s) { return String(s == null ? '' : s).replace(TOOLBOX_WS, ' '); };
    const emap = toolboxEditorTextMap(ed);
    const spans = [];
    let ri = 0;
    for (let i = 0; i < emap.nodes.length; i++) {
        const seg = emap.nodes[i];
        const key = norm(seg.node.nodeValue);
        if (!key.replace(/\s/g, '')) continue;              // 纯空白节点不参与（用户选不到它）
        let found = -1;
        for (let k = ri; k < rec.length; k++) {
            if (norm(rec[k].node.nodeValue) === key) { found = k; break; }
        }
        if (found < 0) continue;
        spans.push({
            node: seg.node,
            textStart: seg.start, textEnd: seg.end,
            srcStart: rec[found].srcStart, srcEnd: rec[found].srcEnd
        });
        ri = found + 1;
    }
    toolboxSrcMapCache = { src: src, spans: spans };
    return toolboxSrcMapCache;
}

// 正文"可见文字偏移" → 源码偏移。
// ★ 起始边界用**半开区间**（off < textEnd）：偏移正好落在两个文本节点的交界处时，
//   界面上是同一个数字（前一段的末尾 == 后一段的开头），但源码里中间还隔着 `</p>\n<p>`。
//   起始要归给**后面**那一段，否则跨块选区的起点会被拉到上一个块的收尾标签上。
function toolboxSrcFromText(map, off, isEnd) {
    const spans = map.spans;
    for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        if (off >= s.textStart && (isEnd ? off <= s.textEnd : off < s.textEnd)) {
            return s.srcStart + (off - s.textStart);
        }
        if (off < s.textStart) return isEnd ? s.srcStart : (i > 0 ? spans[i - 1].srcEnd : s.srcStart);
    }
    const last = spans[spans.length - 1];
    return last ? last.srcEnd : -1;
}
// 用"节点 + 节点内偏移"直接定位（最准的一条路：文本节点在源码里的位置是确定的，
// 不会被上面那个"交界处归谁"的歧义影响）。元素容器（整块 / 整个 <b> 被选中）才退回按偏移算。
function toolboxSrcFromPoint(map, emap, container, off, isEnd) {
    if (container && container.nodeType === 3) {
        for (let i = 0; i < map.spans.length; i++) {
            const s = map.spans[i];
            if (s.node === container) {
                return s.srcStart + Math.max(0, Math.min(off, s.textEnd - s.textStart));
            }
        }
    }
    const vis = toolboxMapOffset(emap, container, off);
    if (vis < 0) return -1;
    return toolboxSrcFromText(map, vis, isEnd);
}
// 源码偏移 → 正文"可见文字偏移"
function toolboxTextFromSrc(map, off, isEnd) {
    const spans = map.spans;
    for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        if (off >= s.srcStart && off <= s.srcEnd) {
            return s.textStart + Math.min(off - s.srcStart, s.textEnd - s.textStart);
        }
        if (off < s.srcStart) return isEnd ? s.textStart : (i > 0 ? spans[i - 1].textEnd : s.textStart);
    }
    const last = spans[spans.length - 1];
    return last ? last.textEnd : -1;
}
function toolboxSrcMapClear() {
    toolboxSrcMapCache = null;
}

function toolboxHighlightAPI() {
    return !!(window.CSS && window.CSS.highlights && typeof window.Highlight === 'function');
}
function toolboxCodeHlEl() {
    return document.getElementById('tbCodeHl');
}
// 把代码区的文字镜像到显示层（改动只在显示层，textarea 的 value 一个字节都不动）
// ★ busy 抑制位：toolboxPaintHighlight（from === 'editor' 那条）会反过来调本函数来同步镜像，
//   而本函数在"内容变了"时又会去调 toolboxPaintHighlight —— 两边互相调就成了死循环
//   （实测：高亮还亮着时清空正文，浏览器直接 "Maximum call stack size exceeded"）。
//   加一位抑制位，语义清楚：**正在同步镜像的那一层负责把高亮重画完**，被回调上来的那一层不再重复。
let toolboxCodeHlBusy = false;
function toolboxCodeHlSync() {
    if (toolboxCodeHlBusy) return;                    // 已经在同步了：直接返回，避免互相递归
    toolboxCodeHlBusy = true;
    try {
        const el = toolboxCodeHlEl();
        const code = toolboxTpl && toolboxTpl.code;
        if (!el || !code) return;
        const v = String(code.value || '');
        if (el.firstChild && el.firstChild.nodeType === 3 && el.firstChild.nodeValue === v) return;   // 没变就不动
        el.textContent = v;
        toolboxSyncCodeScroll();
        if (toolboxHl.has) toolboxPaintHighlight();      // 文字换了：旧的 Range 已失效，重画
    } finally { toolboxCodeHlBusy = false; }
}
function toolboxSyncCodeScroll() {
    const el = toolboxCodeHlEl();
    const code = toolboxTpl && toolboxTpl.code;
    if (!el || !code) return;
    el.scrollTop = code.scrollTop;
    el.scrollLeft = code.scrollLeft;
}

// ========== 代码区行号栏（gutter）==========
// 用户需求：右侧代码区标注行号序号。
// ★ 关键坑：代码区是 wrap="soft"，**长逻辑行会折成多行视觉行**。所以：
//   · 序号只标在**逻辑行**（value 按 \n 划分）的行首，折出来的续行一律**留空**
//     —— 不是按视觉行编号（那样一折行就全错位）；
//   · 于是序号的纵向位置不能按"行号 × 行高"算：得按每个逻辑行折行后的**实际像素高度**排。
//     高度取自隐藏的测量层 #tbCodeMeasure —— 它与代码区同字体/同字号/同行高/同 tab-size/
//     同 padding、同宽（左边界同为 46px 之后），里面每个逻辑行一个 div（空行用 <br> 撑满），
//     逐个量 getBoundingClientRect() 即可拿到小数点级的真实高度。
// ★ 这一组**刻意不改**这五个函数（toolboxSyncCodeScroll / toolboxScrollCodeToRange /
//   toolboxScrollEditorToRange / toolboxSyncHighlight / toolboxPaintHighlight）：
//   行号栏的滚动同步是**新加**的一个监听器，只做 translateY。
// ★ 行号栏不参与任何取值路径：复制/下载/导出读的一直是 #tbCode.value。
let toolboxGutterRaf = 0;
let toolboxGutterRO = null;
function toolboxCodeGutterEl() { return document.getElementById('tbCodeGutter'); }
function toolboxCodeGutterInner() { return document.getElementById('tbCodeGutterInner'); }
function toolboxCodeMeasureEl() { return document.getElementById('tbCodeMeasure'); }
// 逻辑行：按 \n 划分；空内容也算 1 行（行号栏显示 "1"，常规做法）。
function toolboxCodeLines(v) { return String(v == null ? '' : v).split('\n'); }
// 重建测量层（value 没变就不动：避免每次滚动/刷新都重建 DOM）
function toolboxGutterMeasureBuild(val) {
    const m = toolboxCodeMeasureEl();
    if (!m) return;
    if (m.getAttribute('data-v') === val) return;
    const lines = toolboxCodeLines(val);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines.length; i++) {
        const d = document.createElement('div');
        if (lines[i]) d.textContent = lines[i];
        else d.appendChild(document.createElement('br'));       // 空行也要占满一行的高度
        frag.appendChild(d);
    }
    m.textContent = '';
    m.appendChild(frag);
    m.setAttribute('data-v', val);
}
// 重排行号栏：序号个数 = 逻辑行数；每个序号的高度 = 该逻辑行折行后的实际高度。
function toolboxGutterSync() {
    const ta = toolboxTpl && toolboxTpl.code;
    const g = toolboxCodeGutterEl();
    const inner = toolboxCodeGutterInner();
    if (!ta || !g || !inner) return;
    const val = String(ta.value == null ? '' : ta.value);
    toolboxGutterMeasureBuild(val);
    const m = toolboxCodeMeasureEl();
    // ★ 测量层必须与 textarea 的**内容宽**完全一致：textarea 一旦出现竖向滚动条，
    //   内容宽就少掉一条滚动条的宽度（十几 px），折行位置随之变化 —— 宽度靠 CSS 猜不出来，
    //   所以直接按 textarea 自身量（clientWidth 已扣掉滚动条，含 padding，与测量层同 padding）。
    if (m && ta.parentNode && ta.parentNode.getBoundingClientRect) {
        try {
            const wrapRect = ta.parentNode.getBoundingClientRect();
            const taRect = ta.getBoundingClientRect();
            m.style.left = Math.round(taRect.left - wrapRect.left) + 'px';
            m.style.width = Math.max(0, Math.round(ta.clientWidth)) + 'px';
        } catch (e) { /* 量不到就退回 CSS 里那份等宽设定，最多折行差一点 */ }
    }
    const fallback = parseFloat(getComputedStyle(ta).lineHeight) || 21.875;
    const n = (m && m.children.length) ? m.children.length : toolboxCodeLines(val).length;
    // ① 先量每个逻辑行的顶边（相对测量层的 padding-box 顶边 = 代码区内容区顶边）
    let mTop = 0;
    try { mTop = m ? m.getBoundingClientRect().top : 0; } catch (e) { mTop = 0; }
    const tops = [], heights = [];
    for (let i = 0; i < n; i++) {
        const cell = m && m.children[i];
        let top = 0, h = fallback;
        if (cell) {
            const r = cell.getBoundingClientRect();
            top = mTop ? (r.top - mTop) : 0;
            h = r.height || fallback;
            if (!(h > 0)) h = fallback;
        } else {
            top = fallback * i;
        }
        tops.push(top);
        heights.push(h);
    }
    // ② 按"下一个逻辑行的顶边 − 本行顶边"给每一行定高：这样每行序号都贴着它那一行的顶边
    const rows = inner.children;
    for (let i = 0; i < n; i++) {
        let h;
        if (i < n - 1 && tops[i + 1] > tops[i]) h = tops[i + 1] - tops[i];
        else h = heights[i];
        let row = rows[i];
        if (!row) { row = document.createElement('div'); row.className = 'tb-code-gutter-row'; inner.appendChild(row); }
        const num = String(i + 1);
        if (row.textContent !== num) row.textContent = num;
        row.style.height = (h > 0 ? h : fallback).toFixed(2) + 'px';
    }
    for (let k = rows.length - 1; k >= n; k--) inner.removeChild(rows[k]);
    toolboxGutterScroll();
}
// 滚动同步：只把行号栏的内容整体上移 scrollTop（新监听器，不碰 toolboxSyncCodeScroll）
function toolboxGutterScroll() {
    const ta = toolboxTpl && toolboxTpl.code;
    const inner = toolboxCodeGutterInner();
    if (!ta || !inner) return;
    const y = ta.scrollTop || 0;
    const tf = y ? 'translateY(' + (-y) + 'px)' : '';
    if (inner.style.transform !== tf) inner.style.transform = tf;
}
// 输入/尺寸变化时的防抖重排（一帧一次，避免连续输入时反复量布局）
function toolboxScheduleGutter() {
    if (toolboxGutterRaf) return;
    const run = function () { toolboxGutterRaf = 0; toolboxGutterSync(); };
    try { toolboxGutterRaf = requestAnimationFrame(run); } catch (e) { run(); }
}
function toolboxClearHighlight() {
    toolboxHl = { from: '', text: '', start: 0, end: 0, has: false };
    try { if (window.CSS && CSS.highlights) CSS.highlights.delete(TOOLBOX_HL_NAME); } catch (e) {}
}
function toolboxScheduleHighlight(from) {
    // ★ 方向"后到的赢"：以前这里 if (toolboxHlRaf) return 会把后一次请求直接丢掉。
    //   焦点从正文移到代码区时，浏览器会先发一次 selectionchange（正文侧、此时已经
    //   折叠）再发代码区的 select —— 丢掉后者就变成"代码区选了字，正文侧反而不高亮，
    //   反而把刚画上的高亮清掉了"（用例里复现过）。
    toolboxHlFrom = from;
    if (toolboxHlRaf) return;
    const run = function () {
        const f = toolboxHlFrom || from;
        toolboxHlRaf = 0;
        toolboxHlFrom = '';
        toolboxSyncHighlight(f);
    };
    try { toolboxHlRaf = requestAnimationFrame(run); } catch (e) { run(); }
}

// 编辑区可见文字 → { text, nodes:[{node,start,end}] }（用于在正文里找一段文字）
function toolboxEditorTextMap(ed) {
    const map = { text: '', nodes: [] };
    if (!ed) return map;
    let walker = null;
    try { walker = document.createTreeWalker(ed, 4, null, false); } catch (e) { return map; }   // 4 = SHOW_TEXT
    let n = walker.nextNode();
    while (n) {
        const inDisplay = n.parentNode && n.parentNode.closest && n.parentNode.closest('[data-tb-display]');
        if (!inDisplay) {
            const v = String(n.nodeValue || '');
            map.nodes.push({ node: n, start: map.text.length, end: map.text.length + v.length });
            map.text += v;
        }
        n = walker.nextNode();
    }
    return map;
}
// 某个 Range 边界在"文字地图"里的偏移。
// ★ 元素容器**不能忽略 offset**：整段 / 整个 <b> 被选中时，两端的边界是"元素 + 子节点序号"，
//   以前一律返回容器里第一个文本节点的起点，于是 start 与 end 落到同一个位置 ——
//   指纹里的"选中文字"变成空串，操作后就还原不回选区（表现为"连点第二次没反应"）。
//   正确语义：(el, off) 是"第 off 个子节点**之前**"那个位置 → 取它后面第一段文字的起点；
//   off 到了末尾就取容器里最后一段文字的末尾。
function toolboxSegStart(map, node) {
    for (let i = 0; i < map.nodes.length; i++) if (map.nodes[i].node === node) return map.nodes[i].start;
    return -1;
}
function toolboxSegEnd(map, node) {
    for (let i = 0; i < map.nodes.length; i++) if (map.nodes[i].node === node) return map.nodes[i].end;
    return -1;
}
function toolboxMapOffset(map, container, offset) {
    if (!map || !container) return -1;
    if (container.nodeType === 3) {
        for (let i = 0; i < map.nodes.length; i++) {
            const seg = map.nodes[i];
            if (seg.node === container) {
                return seg.start + Math.max(0, Math.min(offset, seg.end - seg.start));
            }
        }
        return -1;
    }
    if (container.nodeType === 1) {
        const kids = container.childNodes;
        const at = Math.max(0, Math.min(offset, kids.length));
        for (let i = at; i < kids.length; i++) {                 // 位置之后的第一段文字
            const k = kids[i];
            const t = (k.nodeType === 3) ? k : toolboxFirstTextNodeIn(k);
            if (t) { const s = toolboxSegStart(map, t); if (s >= 0) return s; }
        }
        for (let i = at - 1; i >= 0; i--) {                      // 后面没字了 → 前面最后一段文字的末尾
            const k = kids[i];
            const t = (k.nodeType === 3) ? k : toolboxLastTextNodeIn(k);
            if (t) { const e = toolboxSegEnd(map, t); if (e >= 0) return e; }
        }
        for (let i = 0; i < map.nodes.length; i++) {             // 极端兜底
            if (container.contains(map.nodes[i].node)) return map.nodes[i].start;
        }
    }
    return -1;
}
// "离上次位置最近"的那一处（重复文本时不乱跳）
function toolboxNearestIndex(hay, needle, anchor) {
    if (!hay || !needle) return -1;
    let best = -1, bestD = Infinity, at = hay.indexOf(needle);
    while (at >= 0) {
        const d = Math.abs(at - (anchor || 0));
        if (d < bestD) { bestD = d; best = at; }
        at = hay.indexOf(needle, at + 1);
    }
    return best;
}
function toolboxRangeFromOffsets(map, start, end) {
    const pick = function (off, isEnd) {
        for (let i = 0; i < map.nodes.length; i++) {
            const seg = map.nodes[i];
            if (off >= seg.start && off <= seg.end) return { seg: seg, off: off - seg.start };
            if (isEnd && off < seg.start) return { seg: seg, off: 0 };
        }
        const last = map.nodes[map.nodes.length - 1];
        return last ? { seg: last, off: last.node.nodeValue.length } : null;
    };
    const a = pick(start, false), b = pick(end, true);
    if (!a || !b) return null;
    try {
        const r = document.createRange();
        r.setStart(a.seg.node, Math.min(a.off, a.seg.node.nodeValue.length));
        r.setEnd(b.seg.node, Math.min(b.off, b.seg.node.nodeValue.length));
        return r;
    } catch (e) { return null; }
}

// ========== 定位工具：忽略空白差异的查找 + 上下文打分（第 4、5 条共用）==========
// ★ 为什么必须"忽略空白"：正文与代码区的**空白写法不一样** —— 正文里两个块之间一个字符
//   都没有，代码区导出时块与块之间是换行；正文里换行是 <br> 元素，代码区是 "\n"。
//   直接 indexOf 必然失配，跨行/跨块的选区就是死在这上面。所以两边都先去掉空白再比，
//   同时留一张"扁平下标 → 原文下标"的表，比中了再换回真正的位置。
function toolboxFlatText(s) {
    const src = String(s == null ? '' : s);
    const flat = [], map = [];
    for (let i = 0; i < src.length; i++) {
        const ch = src.charAt(i);
        if (/[\s\u00a0\u200b]/.test(ch)) continue;
        flat.push(ch);
        map.push(i);
    }
    return { flat: flat.join(''), map: map };
}
// 在 hay 里找 needle：多处命中时优先"上下文对得上"的，其次离 anchor 近的。
// 返回 { start, end }（hay 里的下标，end 不含）或 null。
function toolboxLocateText(hay, needle, before, after, anchor) {
    const h = toolboxFlatText(hay), n = toolboxFlatText(needle);
    if (!h.flat || !n.flat) return null;
    const bf = toolboxFlatText(before).flat, af = toolboxFlatText(after).flat;
    const len = n.flat.length;
    let best = -1, bestScore = -1, at = h.flat.indexOf(n.flat);
    while (at >= 0) {
        let score = 0;
        if (bf && h.flat.slice(Math.max(0, at - bf.length), at) === bf) score += 2;
        if (af && h.flat.slice(at + len, at + len + af.length) === af) score += 2;
        if (score > bestScore) { bestScore = score; best = at; }
        else if (score === bestScore && best >= 0) {
            const near = Math.abs((h.map[at] || 0) - (anchor || 0));
            const keep = Math.abs((h.map[best] || 0) - (anchor || 0));
            if (near < keep) best = at;
        }
        at = h.flat.indexOf(n.flat, at + 1);
    }
    if (best < 0) return null;
    return { start: h.map[best], end: h.map[best + len - 1] + 1 };
}
// 选区的片段 HTML（与导出同一种写法：标签原样、属性原样）
function toolboxRangeHtml(r) {
    try {
        const d = document.createElement('div');
        d.appendChild(r.cloneContents());
        return String(d.innerHTML || '');
    } catch (e) { return ''; }
}
// 代码区里选中的那段源码 → 纯文字（剥标签 + 还原实体）；剥完没字说明选的是标签名/属性
function toolboxCodeToPlain(raw) {
    return String(raw || '').replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

// ========== 选区"指纹"：操作前记下，操作后在新 DOM 上把同一段文字重新选中 ==========
// 需求（用户第 5 条）：操作完选区不能丢，否则没法连着改第二下（改完加粗就选不回去点引用了）。
// 指纹 = 选中文字 + 前后各 20 字上下文；折叠的光标用"后一段文字 + 前文"当锚点。
const TOOLBOX_FP_CTX = 20;
function toolboxSelectionFingerprint(r, ed) {
    const fp = { text: '', before: '', after: '', collapsed: true, ok: false };
    if (!r || !ed || !r.startContainer || !ed.contains(r.startContainer)) return fp;
    let map = null;
    try { map = toolboxEditorTextMap(ed); } catch (e) { return fp; }
    const s = toolboxMapOffset(map, r.startContainer, r.startOffset);
    if (s < 0) return fp;
    const e = r.collapsed ? s : toolboxMapOffset(map, r.endContainer, r.endOffset);
    fp.collapsed = !!r.collapsed;
    fp.ok = true;
    fp.at = s;                       // ★ 记下当时的可见文字偏移：重新定位时用它打破"同一段文字出现多次"的平局
    if (!fp.collapsed) {
        if (e < s) return fp;
        fp.text = map.text.slice(s, e);
        fp.after = map.text.slice(e, e + TOOLBOX_FP_CTX);
    } else {
        fp.after = map.text.slice(s, s + TOOLBOX_FP_CTX);
    }
    fp.before = map.text.slice(Math.max(0, s - TOOLBOX_FP_CTX), s);
    return fp;
}
function toolboxRangeFromFingerprint(ed, fp) {
    if (!fp || !fp.ok || !ed) return null;
    let map = null;
    try { map = toolboxEditorTextMap(ed); } catch (e) { return null; }
    if (!map.text) return null;
    const anchor = fp.at || 0;
    if (fp.collapsed) {
        // 光标：用"后一段文字"当目标、前文当上下文；文档末尾（后面没字）就用前文收尾
        if (fp.after) {
            const hit = toolboxLocateText(map.text, fp.after, fp.before, '', anchor);
            if (hit) return toolboxRangeFromOffsets(map, hit.start, hit.start);
        } else if (fp.before) {
            const hit = toolboxLocateText(map.text, fp.before, '', '', anchor);
            if (hit) return toolboxRangeFromOffsets(map, hit.end, hit.end);
        }
        return null;
    }
    if (!fp.text) return null;
    const hit = toolboxLocateText(map.text, fp.text, fp.before, fp.after, anchor);
    if (!hit) return null;
    return toolboxRangeFromOffsets(map, hit.start, hit.end);
}
// ★ 兜底定位：选中的那段文字已经不存在了（典型是"撤回自己刚敲进去的字"），
//   就退到"锚点前那段文字之后"放一个光标 —— 也就是用户刚才动手的那个位置。
function toolboxCaretFromFingerprint(ed, fp) {
    if (!fp || !ed) return null;
    const anchor = fp.at || 0;
    let map = null;
    try { map = toolboxEditorTextMap(ed); } catch (e) { return null; }
    if (!map.text) return null;
    const probes = [fp.before, fp.after];
    for (let i = 0; i < probes.length; i++) {
        if (!probes[i]) continue;
        const hit = toolboxLocateText(map.text, probes[i], '', '', anchor);
        if (hit) {
            const at = (i === 0) ? hit.end : hit.start;
            return toolboxRangeFromOffsets(map, at, at);
        }
    }
    return null;
}
function toolboxSelectRange(r) {
    if (!r) return false;
    try {
        const sel = window.getSelection && window.getSelection();
        if (!sel) return false;
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
    } catch (e) { return false; }
}
// 操作前：capture；操作后：restore（找不到同一段文字就退回原来那个 Range 对象）
function toolboxSelCapture(ed, r) {
    try { return toolboxSelectionFingerprint(r, ed); } catch (e) { return null; }
}
function toolboxSelRestore(ed, fp, fallback) {
    if (!ed) return false;
    let r = null;
    try { r = toolboxRangeFromFingerprint(ed, fp); } catch (e) { r = null; }
    if (!r && fallback && fallback.startContainer && ed.contains(fallback.startContainer)) r = fallback;
    if (!r) return false;
    return toolboxSelectRange(r);
}

// ========== 滚动：位置交给浏览器算（不再按行高/行数估算）==========
// 用户实测第 4 条："滚动位置要准"。Range 自己没有 scrollIntoView，
// 所以做法是：用 Range.getBoundingClientRect()（浏览器自己排的版）算出"要滚多少才能让它
// 落在容器中间"，再把这个位移交给浏览器做平滑滚动（scrollBy({behavior:'smooth'})）。
// 全程没有任何"行高 × 行数"的估算 —— 长行折行、图片、嵌套块都能对得上。
const TOOLBOX_SCROLL_DEBOUNCE = 90;              // ms：防抖，连续移动光标只有最后一次生效
const TOOLBOX_SCROLL_MS = 220;                   // 兜底 rAF 动画的时长
let toolboxScrollTimer = 0;
let toolboxScrollRaf = 0;
function toolboxScrollCancel() {
    if (toolboxScrollTimer) { clearTimeout(toolboxScrollTimer); toolboxScrollTimer = 0; }
    if (toolboxScrollRaf) { cancelAnimationFrame(toolboxScrollRaf); toolboxScrollRaf = 0; }
}
// 兜底：浏览器不支持 scrollBy 的平滑选项时，用 rAF 做同样的位移（可被打断）
function toolboxSmoothScrollTop(host, top) {
    if (!host) return;
    const target = Math.max(0, Math.min(top, host.scrollHeight - host.clientHeight));
    const from = host.scrollTop;
    if (Math.abs(target - from) < 2) return;
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    if (toolboxScrollRaf) { cancelAnimationFrame(toolboxScrollRaf); toolboxScrollRaf = 0; }
    const step = function () {
        toolboxScrollRaf = 0;
        const now = (window.performance && performance.now) ? performance.now() : Date.now();
        let p = (now - t0) / TOOLBOX_SCROLL_MS;
        if (p >= 1) p = 1;
        const e = 1 - Math.pow(1 - p, 3);                            // easeOutCubic
        host.scrollTop = from + (target - from) * e;
        if (p < 1) toolboxScrollRaf = requestAnimationFrame(step);
    };
    toolboxScrollRaf = requestAnimationFrame(step);
}
function toolboxScrollBy(host, delta) {
    if (!host || !isFinite(delta) || Math.abs(delta) < 1) return;
    if (typeof host.scrollBy === 'function') {
        try { host.scrollBy({ top: delta, left: 0, behavior: 'smooth' }); return; } catch (e) { /* 老浏览器走下面 */ }
    }
    toolboxSmoothScrollTop(host, host.scrollTop + delta);
}
// 让一个 Range 落到容器中间（位置全部由浏览器算）
function toolboxScrollRangeToCenter(host, r) {
    if (!host || !r) return;
    let rect = null;
    try { rect = r.getBoundingClientRect(); } catch (e) { rect = null; }
    if (!rect || (!rect.height && !rect.width)) return;
    const hr = host.getBoundingClientRect();
    toolboxScrollBy(host, (rect.top - hr.top) - (host.clientHeight - rect.height) / 2);
}
// 正文侧：把对应 Range 滚到视野中间
function toolboxScrollEditorToRange(ed, r) {
    if (!ed || !r) return;
    toolboxScrollCancel();
    toolboxScrollTimer = setTimeout(function () {
        toolboxScrollTimer = 0;
        toolboxScrollRangeToCenter(ed, r);
    }, TOOLBOX_SCROLL_DEBOUNCE);
}
// 代码侧：镜像层上那个 Range 的 rect → 换算成 textarea 要滚多少（textarea 的文字不在 DOM 里）
function toolboxScrollCodeToRange(r) {
    const code = toolboxTpl && toolboxTpl.code;
    if (!code || !r) return;
    toolboxScrollCancel();
    toolboxScrollTimer = setTimeout(function () {
        toolboxScrollTimer = 0;
        toolboxSyncCodeScroll();                 // 先让镜像层与 textarea 对齐，rect 才可信
        toolboxScrollRangeToCenter(code, r);
        toolboxSyncCodeScroll();
    }, TOOLBOX_SCROLL_DEBOUNCE);
}

// 把一侧的选区映射到另一侧的对应位置，并画高亮 + 滚动。
// ★ 映射方式：**偏移映射**（见 toolboxSrcMapBuild），两侧都是"区间 → 区间"的直接换算，
//   不做任何字符串搜索。跨行、跨块天然正确；重复词、属性里的词也不可能再匹配错。
// · 代码 → 正文：代码里选的源码偏移（textarea 的 selectionStart/End 就是源码偏移）反查正文。
// · 正文 → 代码：正文里的选区先换算成"可见文字偏移"，再用同一张表换成源码区间。
// · 折叠的选区：不高亮、不滚动（用户要求）。换算不出区间：安静放弃。
function toolboxSyncHighlight(from) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const code = toolboxTpl && toolboxTpl.code;
    const modal = toolboxTpl && toolboxTpl.modal;
    if (!ed || !code || !modal || modal.style.display !== 'flex') return;
    const map = toolboxSrcMapBuild();
    if (from === 'code') {
        const s = code.selectionStart, e = code.selectionEnd;
        if (s == null || e == null || e <= s) { toolboxClearHighlight(); return; }
        const raw = String(code.value || '').slice(s, e);
        if (raw.length > TOOLBOX_HL_MAX) { toolboxClearHighlight(); return; }
        const plain = toolboxCodeToPlain(raw);
        if (!plain.replace(/\s+/g, '')) { toolboxClearHighlight(); return; }
        if (!map || !map.spans.length) { toolboxClearHighlight(); return; }
        const ts = toolboxTextFromSrc(map, s, false);
        const te = toolboxTextFromSrc(map, e, true);
        if (ts < 0 || te < 0 || te <= ts) { toolboxClearHighlight(); return; }
        toolboxHl = { from: 'code', text: plain, start: ts, end: te, srcStart: s, srcEnd: e, has: true };
        toolboxHlAnchor.editor = ts;
    } else {
        // ★ 焦点在代码区时不要用"正文侧那份已经过期的选区"去算：
        //   焦点一移走，正文的选区就折叠/失效了，照算会把代码区刚点亮的高亮清掉。
        if (document.activeElement === code) return;
        const r = toolboxLiveRange();
        if (!r || r.collapsed) { toolboxClearHighlight(); return; }
        const text = String(r);
        if (!text.replace(/\s+/g, '')) { toolboxClearHighlight(); return; }
        if (text.length > TOOLBOX_HL_MAX) { toolboxClearHighlight(); return; }
        const emap = toolboxEditorTextMap(ed);
        const sOff = toolboxMapOffset(emap, r.startContainer, r.startOffset);
        const eOff = toolboxMapOffset(emap, r.endContainer, r.endOffset);
        if (sOff < 0 || eOff < 0 || eOff <= sOff) { toolboxClearHighlight(); return; }
        if (!map || !map.spans.length) { toolboxClearHighlight(); return; }
        const ss = toolboxSrcFromPoint(map, emap, r.startContainer, r.startOffset, false);
        const se = toolboxSrcFromPoint(map, emap, r.endContainer, r.endOffset, true);
        if (ss < 0 || se < 0 || se <= ss) { toolboxClearHighlight(); return; }
        toolboxHl = { from: 'editor', text: text, start: sOff, end: eOff, srcStart: ss, srcEnd: se, has: true };
        toolboxHlAnchor.code = ss;
    }
    toolboxPaintHighlight();
}

function toolboxPaintHighlight() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const code = toolboxTpl && toolboxTpl.code;
    if (!ed || !code || !toolboxHl.has) { toolboxClearHighlight(); return; }
    const st = toolboxHl;
    const paint = function (r) {
        if (!toolboxHighlightAPI()) return;
        try { CSS.highlights.set(TOOLBOX_HL_NAME, new Highlight(r)); } catch (e) {}
    };
    if (st.from === 'editor') {
        // 高亮画在代码面板的**镜像层**上（textarea 的文字不在 DOM 里，Highlight 画不进去）。
        // 镜像层的文字与 code.value 逐字一致，所以源码偏移可以直接当镜像层的字符下标用。
        toolboxCodeHlSync();
        const host = toolboxCodeHlEl();
        const t = host && host.firstChild;
        if (!t || t.nodeType !== 3) { toolboxClearHighlight(); return; }
        let r = null;
        try {
            r = document.createRange();
            r.setStart(t, Math.min(st.srcStart, t.nodeValue.length));
            r.setEnd(t, Math.min(st.srcEnd, t.nodeValue.length));
        } catch (e) { r = null; }
        if (!r) { toolboxClearHighlight(); return; }
        paint(r);
        toolboxScrollCodeToRange(r);                  // 位置由镜像层的 rect 算（浏览器排版）
    } else {
        const r = toolboxRangeFromOffsets(toolboxEditorTextMap(ed), st.start, st.end);
        if (!r) { toolboxClearHighlight(); return; }
        paint(r);
        toolboxScrollEditorToRange(ed, r);
    }
}

// ========== B. 正文里的图片显示"文件名占位框" ==========
// 工具箱页面里，语料那种相对路径（readmes/image/…）取不到图 —— 不处理就是一排破图
// 或者空白，用户根本不知道那儿有张图、是什么图。
//
// 做法：**真实的 <img> 一个字节都不改**，只在它外面套一层纯显示结构：
//   <span data-tb-display="wrap" class="tb-imgph"><span data-tb-display="name" …>文件名</span><img …></span>
//   · img 被 CSS 藏起来（.tb-imgph > img { display:none }），文件名显示出来；
//   · 包裹层的宽度取 <img width="…"> 的值（语料是 80%），所以占位框尺寸跟图一致；
//   · 显示层在序列化/字数/校验里一律被跳过（见 toolboxStripDisplayNodes），
//     所以导出、复制、下载的结果里既没有 data-tb-display，也没有文件名文字。
// 图真的能加载出来（http(s) 可访问）→ 不加占位框，正常显示。
// 文件名：优先 alt（插入图片时会把文件名写进 alt），没有就用 src 的 basename。
const TOOLBOX_PH_CLASS = 'tb-imgph';
function toolboxImgBaseName(src) {
    const clean = String(src || '').split('?')[0].split('#')[0].replace(/\\/g, '/');
    let base = clean.substring(clean.lastIndexOf('/') + 1);
    try { base = decodeURIComponent(base); } catch (e) {}
    return base || '图片';
}
function toolboxImgFileName(img) {
    if (!img) return '图片';
    const alt = String((img.getAttribute && img.getAttribute('alt')) || '').trim();
    if (alt) return alt;
    return toolboxImgBaseName(img.getAttribute && img.getAttribute('src'));
}
function toolboxImgDisplayWrap(img) {
    const p = img && img.parentNode;
    if (p && p.nodeType === 1 && p.getAttribute && p.getAttribute('data-tb-display') === 'wrap') return p;
    return null;
}
function toolboxImgPlaceholderAdd(img) {
    if (!img || !img.parentNode) return null;
    const wrap = document.createElement('span');
    wrap.className = TOOLBOX_PH_CLASS;
    wrap.setAttribute('data-tb-display', 'wrap');
    const w = String((img.getAttribute && img.getAttribute('width')) || '').trim();
    wrap.setAttribute('style', 'width:' + (w || TOOLBOX_IMG_WIDTH) + ';');
    const name = document.createElement('span');
    name.className = TOOLBOX_PH_CLASS + '-name';
    name.setAttribute('data-tb-display', 'name');
    // ★ 占位文字是"纯显示层"：光标不许进去改它（改了没意义，还会污染编辑区）。
    //   contenteditable=false → 不能编辑、光标不会停在里面；CSS 里再配 user-select:none
    //   → 也选不中、复制不到；aria-hidden → 读屏软件不当它是正文。
    //   ★ 只作用于这个文字节点：外面的包裹层与 <img> 一个属性都不动，
    //     所以图片照样能选中、能在图上右键调出图片菜单。
    name.setAttribute('contenteditable', 'false');
    name.setAttribute('aria-hidden', 'true');
    name.textContent = toolboxImgFileName(img);
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(name);
    wrap.appendChild(img);
    return wrap;
}
function toolboxImgPlaceholderDel(img) {
    const wrap = toolboxImgDisplayWrap(img);
    if (!wrap || !wrap.parentNode) return;
    const name = wrap.querySelector('[data-tb-display="name"]');
    if (name && name.parentNode) name.parentNode.removeChild(name);
    toolboxUnwrapElement(wrap);                     // img 留在原地
}
// 把占位框的文字/宽度刷新成当前的 src/alt/width（用户改了参数之后）
function toolboxImgPlaceholderSync(img) {
    const wrap = toolboxImgDisplayWrap(img);
    if (!wrap) return;
    const name = wrap.querySelector('[data-tb-display="name"]');
    if (name) name.textContent = toolboxImgFileName(img);
    const w = String((img.getAttribute && img.getAttribute('width')) || '').trim();
    wrap.setAttribute('style', 'width:' + (w || TOOLBOX_IMG_WIDTH) + ';');
}
// 扫一遍（或只扫 root 这棵子树）：加载出来的去掉占位框，破图的加上
function toolboxImgDisplaySync(root) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const scope = root || ed;
    if (!scope || !scope.querySelectorAll) return;
    const imgs = scope.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        const src = String((img.getAttribute && img.getAttribute('src')) || '').trim();
        const loaded = !!(img.complete && img.naturalWidth > 0);
        const broken = !src || (img.complete && img.naturalWidth === 0);
        if (loaded) { toolboxImgPlaceholderDel(img); continue; }
        if (broken) {
            if (toolboxImgDisplayWrap(img)) toolboxImgPlaceholderSync(img);
            else toolboxImgPlaceholderAdd(img);
        }
        // complete=false：还在加载，先不动 —— 等 load / error 事件里再来一次
    }
}
// 显示层的图片加载结果（图片事件不冒泡，所以用捕获阶段监听）
function toolboxImgDisplayEvents(ed) {
    if (!ed) return;
    const on = function (e) {
        const t = e.target;
        if (t && t.tagName && String(t.tagName).toUpperCase() === 'IMG') {
            try { toolboxImgDisplaySync(t.parentNode || ed); } catch (e2) {}
        }
    };
    ed.addEventListener('load', on, true);
    ed.addEventListener('error', on, true);
}

// ========== 行内格式开关（自己用 DOM 变换做）==========
// ★ 不用 execCommand('bold')：对"只有 style="font-weight:700" 的外部内容"它只会
//   再叠一层样式、不会写 <b>（用户要求"点加粗要出现 <b>"），而且它无法可靠取消。
// 规则：有效状态为"开" → 拆掉对应的标签 + 摘掉对应声明；为"关" → 包一层标签。
function toolboxStripInlineDecls(root, kind) {
    const re = TOOLBOX_INLINE_STYLE_RE[kind];
    if (!root || !re) return;
    const list = [];
    if (root.nodeType === 1) list.push(root);
    if (root.querySelectorAll) {
        const more = root.querySelectorAll('[style]');
        for (let i = 0; i < more.length; i++) list.push(more[i]);
    }
    for (let i = 0; i < list.length; i++) {
        const el = list[i];
        const st = el.getAttribute && el.getAttribute('style');
        if (!st) continue;
        const keep = String(st).split(';').map(function (x) { return x.trim(); })
            .filter(function (x) { return x && !re.test(x); });
        if (keep.length) el.setAttribute('style', keep.join('; ') + ';');
        else el.removeAttribute('style');
    }
}
// ========== B/U/I/S：精确到字、就地做，绝不碰块结构 ==========
// ★ 用户实测的严重回归：选中一段再点加粗，选中文字前后多出换行、后面的文字整段跳走。
//   根因是旧实现"把选区 extractContents 出来 → 在片段上变换 → 再把整个片段插回去"：
//   插回时的落点在块中间就会把宿主块切开，而 toolboxHoistBlock 还会把宿主段落顺手切成
//   前/中/后三段 —— 于是多出换行、后半截被搬到别处。
//   现在改成**纯就地**：对选区覆盖到的每个文本节点 splitText 精确切出被覆盖的那一段，
//   然后原地包一层 / 原地拆一层。选区外一个节点都不动，块结构一个都不新建，
//   也不会产生新的 <br>、空块、空行（导出排版因此跟操作前完全一致）。
const TOOLBOX_INLINE_ALIAS = {
    bold: ['B', 'STRONG'], italic: ['I', 'EM'], underline: ['U'], strike: ['S', 'STRIKE', 'DEL'],
    sup: ['SUP'], sub: ['SUB']
};
// 一棵子树里可见的文本节点（显示层"图片占位框"不是内容，跳过）
function toolboxTextNodesOf(root) {
    const out = [];
    if (!root) return out;
    let w = null;
    try { w = document.createTreeWalker(root, 4, null, false); } catch (e) { return out; }   // 4 = SHOW_TEXT
    let n = w.nextNode();
    while (n) {
        const inDisplay = n.parentNode && n.parentNode.closest && n.parentNode.closest('[data-tb-display]');
        if (!inDisplay) out.push(n);
        n = w.nextNode();
    }
    return out;
}
// 选区覆盖到的文本节点（文档顺序），带"被覆盖的区间"
function toolboxRangeTextNodes(ed, r) {
    const out = [];
    if (!ed || !r) return out;
    let w = null;
    try { w = document.createTreeWalker(ed, 4, null, false); } catch (e) { return out; }
    let n = w.nextNode();
    while (n) {
        const inDisplay = n.parentNode && n.parentNode.closest && n.parentNode.closest('[data-tb-display]');
        let hit = false;
        try { hit = r.intersectsNode(n); } catch (e) { hit = false; }
        if (!inDisplay && hit && n.nodeValue) {
            const s = (n === r.startContainer) ? r.startOffset : 0;
            const e = (n === r.endContainer) ? r.endOffset : n.nodeValue.length;
            if (e > s) out.push({ node: n, s: s, e: e });
        }
        n = w.nextNode();
    }
    return out;
}
// 把选区两个边界上的文本节点切开，使"每个文本节点要么整段被覆盖、要么完全不在选区里"。
// ★ 就地 splitText：只切这一个文本节点，块结构和别处的文字都不动。
// 返回：被选区**整段**覆盖的文本节点（文档顺序）
function toolboxSplitRangeEdges(ed, r) {
    const parts = toolboxRangeTextNodes(ed, r);
    const covered = [];
    for (let i = parts.length - 1; i >= 0; i--) {           // 倒着切，前面的偏移不受影响
        const p = parts[i];
        let node = p.node;
        if (!node.parentNode) continue;
        try {
            if (p.e < node.nodeValue.length) node.splitText(p.e);   // 后半截留在后面
            if (p.s > 0) node = node.splitText(p.s);                // 前半截留在前面
        } catch (e) { continue; }
        covered.push(node);
    }
    covered.reverse();
    return covered;
}
// 壳里"还在选区外"的文本节点（这些必须原样保住）
function toolboxUncoveredTextsIn(el, covered) {
    const all = toolboxTextNodesOf(el);
    const out = [];
    for (let i = 0; i < all.length; i++) if (covered.indexOf(all[i]) < 0) out.push(all[i]);
    return out;
}
// 就地把一个文本节点包进对应标签（只在"这一段字"上包，不做任何提取/回插）
function toolboxWrapTextNode(node, tagName, kind) {
    const host = node.parentNode;
    if (!host || !node.nodeValue) return null;
    const w = document.createElement(tagName);
    host.insertBefore(w, node);
    w.appendChild(node);
    toolboxStripInlineDecls(w, kind);                       // 顺手摘掉"假装加粗"的样式
    return w;
}
// 就地修一条"行内祖先链"：mode === 'clear' 是清格式；mode = bold/italic/… 是取消那一种格式。
// ★ 关键动作：壳里还留着选区外的文字时，**先把它们按原壳包一层**（样式一点不丢），
//   再对原来的壳拆标签/摘样式 —— 选区外的文字因此一个字都不变。
// ★ 取消某一种格式时这一次调用**只解掉一层**（由调用方反复调，直到选区里再也搜不到 X）：
//   这样"嵌套的 <b><b>…</b></b> 点一次就干净"和"只解一层、内层结构原地保留"能同时满足。
// 返回值：本次是否真的动过（调用方靠它判断"还能不能再摘一层"）。
function toolboxFixInlineChain(node, covered, ed, mode) {
    if (!node || !node.parentNode) return;
    const oneLayer = (mode !== 'clear');
    const chain = [];
    let el = node.parentNode;
    while (el && el !== ed && !toolboxIsBlockEl(el)) {
        if (el.getAttribute && el.getAttribute('data-tb-display')) break;    // 显示层不是内容
        chain.push(el);
        el = el.parentNode;
    }
    let used = false;
    for (let i = 0; i < chain.length; i++) {                 // 由内向外
        const p = chain[i];
        if (!p.parentNode) continue;
        const tag = String(p.tagName || '').toUpperCase();
        const isAlias = (mode === 'clear')
            ? (TOOLBOX_FORMAT_TAGS.indexOf(tag) >= 0)
            : ((TOOLBOX_INLINE_ALIAS[mode] || []).indexOf(tag) >= 0);
        const re = (mode === 'clear') ? TOOLBOX_TEXT_STYLE_RE : TOOLBOX_INLINE_STYLE_RE[mode];
        let hasDecl = false;
        if (re) {
            const decls = toolboxStyleDecls(p);
            for (let j = 0; j < decls.length; j++) if (re.test(decls[j])) { hasDecl = true; break; }
        }
        if (!isAlias && !hasDecl) continue;
        if (oneLayer && used) continue;                     // ★ 只解掉最里面那一层
        used = true;
        const rest = toolboxUncoveredTextsIn(p, covered);
        for (let j = rest.length - 1; j >= 0; j--) {
            const t = rest[j];
            if (!t.parentNode) continue;
            const shell = p.cloneNode(false);                // 同款壳：样式给选区外的文字留着
            t.parentNode.insertBefore(shell, t);
            shell.appendChild(t);
        }
        const isPlainShell = (tag === 'SPAN' || tag === 'FONT');
        if (isAlias && !(mode === 'clear' && isPlainShell)) {
            toolboxUnwrapElement(p);                         // <b>/<i>/<u>/<s>… 连标签一起拆
        } else {
            toolboxStripTextStyles(p);                       // 只摘"文字格式"声明，壳先留着
            if (mode !== 'clear') toolboxStripInlineDecls(p, mode);
            if (mode === 'clear' && isPlainShell && !(p.attributes && p.attributes.length)) {
                toolboxUnwrapElement(p);                     // 空壳（没样式没 class）→ 拆掉
            }
        }
    }
    return used;
}
// 计算样式（拿不到就算 null，调用方各自兜底）
function toolboxComputed(el) {
    try { return (window.getComputedStyle && el) ? getComputedStyle(el) : null; } catch (e) { return null; }
}
// "这段文字是不是已经带了某种行内格式"：**沿祖先链**查三种证据
//   ① 标签（<b>/<strong>、<i>/<em>、<u>、<s>/<strike>/<del>）；
//   ② style 里的声明（导入/粘贴进来的内容常常只有样式，没有标签）；
//   ③ 计算样式兜底（连 style 都没有、靠 class 或外层的）。
// ★ 为什么不用 queryCommandState：它对"我们自己维护的 DOM + 只有 style 的内容"都不准。
// ★ 为什么必须走整条祖先链：被包在 <b> 里（哪怕外面还套着一层）也要算"已加粗"，
//   只看直接父节点就会判成"没加粗"，于是再点一次又包一层 → 用户实测的 <b><b>。
function toolboxInlineApplied(node, ed, kind) {
    const alias = TOOLBOX_INLINE_ALIAS[kind] || [];
    const re = TOOLBOX_INLINE_STYLE_RE[kind];
    if (!node || !ed) return false;
    let n = (node.nodeType === 3) ? node.parentNode : node;
    while (n && n !== ed) {
        if (n.nodeType === 1) {
            if (n.getAttribute && n.getAttribute('data-tb-display')) break;   // 显示层不算内容
            const tag = String(n.tagName || '').toUpperCase();
            if (alias.indexOf(tag) >= 0) return true;
            if (re) {
                const decls = toolboxStyleDecls(n);
                for (let i = 0; i < decls.length; i++) if (re.test(decls[i])) return true;
            }
            const cs = toolboxComputed(n);
            if (cs) {
                const deco = String(cs.textDecorationLine || cs.textDecoration || '');
                if (kind === 'bold' && (parseInt(cs.fontWeight, 10) || 400) >= 600) return true;
                if (kind === 'italic' && /italic|oblique/i.test(String(cs.fontStyle || ''))) return true;
                if (kind === 'underline' && /underline/i.test(deco)) return true;
                if (kind === 'strike' && /line-through/i.test(deco)) return true;
                // ★ 上标/下标：导入的内容可能只有 `vertical-align:super/sub` 没有标签，
                //   一样要认成"已应用"（否则点一次会再套一层）。
                if (kind === 'sup' && /super/i.test(String(cs.verticalAlign || ''))) return true;
                if (kind === 'sub' && /sub/i.test(String(cs.verticalAlign || ''))) return true;
            }
        }
        n = n.parentNode;
    }
    return false;
}
// 折叠"同标签的重复嵌套"：<b><b>甲</b></b> → <b>甲</b>（I/U/S 同理）。
// ★ 只在这个 scope（= 本次操作动到的那个块）里做，不碰文档别处；反复跑到没有为止，
//   所以是幂等的。任何一次操作之后都不允许留下 <b><b>、<u><u>… 这种重复嵌套。
function toolboxCollapseInlineNesting(scope, kind) {
    const alias = TOOLBOX_INLINE_ALIAS[kind] || [];
    if (!scope || !scope.querySelectorAll || !alias.length) return;
    const sel = alias.join(',');
    for (let guard = 0; guard < 20; guard++) {
        const list = scope.querySelectorAll(sel);
        let hit = 0;
        for (let i = 0; i < list.length; i++) {
            const el = list[i];
            if (!el.parentNode) continue;
            const pt = String(el.parentNode.tagName || '').toUpperCase();
            // 内层解开、内容并入外层：两层 `<b>` 合成一层，样式由外层代表
            if (alias.indexOf(pt) >= 0) { toolboxUnwrapElement(el); hit++; }
        }
        if (!hit) break;
    }
    // 顺手把变空的同标签壳解掉（避免导出里冒出空 <b></b>）
    const list2 = scope.querySelectorAll(sel);
    for (let i = list2.length - 1; i >= 0; i--) {
        const el = list2[i];
        if (!el.parentNode) continue;
        if (!String(el.textContent || '').length && !el.querySelector('img,br')) toolboxUnwrapElement(el);
    }
}
// ---------- 局部归一化（只动"本次影响到的片段"） ----------
// 一次行内操作之后，选区里不该留下：重复嵌套 <b><b>x</b></b>、空壳 <b></b>、
// 相邻的 <b>a</b><b>b</b>（要求"极大连续的一段只包一层"）。
// ★ 为什么不直接用块级 scope 那个归一化：编辑区顶层可能**直接就是行内元素**
//   （用户给的 BIUS 复现片段就是 <center>/<i>/<u> 挂在根上），这时 toolboxNearestBlock
//   返回 null、scopes 是空的，块级归一化一次都不会跑，<b><b> 就会留在页面上。
// ★ 红线：合并相邻同标签时**两段都必须完全落在选区内**才合并 —— 绝不把选区外的文字并进来。
function toolboxNormalizeInlineLocal(ed, covered, kind) {
    const alias = TOOLBOX_INLINE_ALIAS[kind] || [];
    if (!ed || !alias.length || !covered || !covered.length) return;
    const isAliasEl = function (el) {
        return !!(el && el.nodeType === 1 && alias.indexOf(String(el.tagName || '').toUpperCase()) >= 0);
    };
    const fullyCovered = function (el) {
        const list = toolboxTextNodesOf(el);
        if (!list.length) return false;
        for (let i = 0; i < list.length; i++) if (covered.indexOf(list[i]) < 0) return false;
        return true;
    };
    // 收集"被选中文字的祖先链上的行内元素"（由内向外，去重）
    const seen = [];
    for (let i = 0; i < covered.length; i++) {
        let n = covered[i].parentNode;
        while (n && n !== ed) {
            if (n.nodeType === 1 && !toolboxIsBlockEl(n)) { if (seen.indexOf(n) < 0) seen.push(n); }
            n = n.parentNode;
        }
    }
    // ① 折叠重复嵌套：内层解掉、内容原地并入外层（外层那一层代表这个格式）
    for (let i = 0; i < seen.length; i++) {
        const el = seen[i];
        if (!isAliasEl(el) || !el.parentNode) continue;
        if (isAliasEl(el.parentNode)) toolboxUnwrapElement(el);
    }
    // ② 删掉变空的同标签壳（里面还有 <br>/<img> 的不算空，那是用户排版用的）
    for (let i = seen.length - 1; i >= 0; i--) {
        const el = seen[i];
        if (!isAliasEl(el) || !el.parentNode) continue;
        if (!String(el.textContent || '').length && !el.querySelector('img,br')) toolboxUnwrapElement(el);
    }
    // ③ 合并相邻同标签：<b>甲</b><b>乙</b> → <b>甲乙</b>（两段都完全在选区内才做）
    for (let i = 0; i < seen.length; i++) {
        const el = seen[i];
        if (!isAliasEl(el) || !el.parentNode) continue;
        const nx = el.nextSibling;
        if (!isAliasEl(nx)) continue;
        if (String(nx.tagName).toUpperCase() !== String(el.tagName).toUpperCase()) continue;
        if (!fullyCovered(el) || !fullyCovered(nx)) continue;
        while (nx.firstChild) el.appendChild(nx.firstChild);     // 内容搬进前一个同类壳
        if (nx.parentNode) nx.parentNode.removeChild(nx);
    }
}
// ---------- 一次选中跨越"相邻的两个 <span>"时，整体只包一层 ----------
// ★ 旧做法是"每个被选中的文本节点各包一层"，跨 span 就变成
//   <span><b>甲</b></span><span><b>乙</b></span>（各包一层）；用户要的是整体一层。
//   这里改成**原地搬家**：新建一个 <b>，插在这段连续内容的最前面，再把这一段里的节点
//   依次 appendChild 进去 —— appendChild 是"移动"而不是复制，所以不丢一个字节、
//   也不产生"取片段→变换→回插"那种会切开宿主块的操作。
//   只有"连续、且完全被选中"才搬：中间夹着没被选中的字（含空白）、图片、<br>，或者跨块
//   → 返回 null，由调用方退回"每个文本节点各包一层"（那种情况本来就包不成一层）。
function toolboxTextFullyCovered(node, covered) {
    if (!node) return false;
    if (node.nodeType === 3) return !!(node.nodeValue && covered.indexOf(node) >= 0);
    if (node.nodeType !== 1) return false;
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'BR' || tag === 'IMG' || tag === 'HR' || tag === 'INPUT') return false;   // 换行/图片不是"被选中的字"
    if (toolboxIsBlockEl(node)) return false;
    const list = toolboxTextNodesOf(node);
    if (!list.length) return false;
    for (let i = 0; i < list.length; i++) if (covered.indexOf(list[i]) < 0) return false;
    return true;
}
function toolboxChildContaining(parent, node) {
    let n = node;
    while (n && n.parentNode !== parent) n = n.parentNode;
    return (n && n.parentNode === parent) ? n : null;
}
function toolboxRunPlan(covered, ed) {
    if (!covered.length) return null;
    const first = covered[0], last = covered[covered.length - 1];
    const b1 = toolboxNearestBlock(first, ed), b2 = toolboxNearestBlock(last, ed);
    if (!b1 || b1 !== b2) return null;                        // 跨块：一层包不住，交给逐个包
    const c1 = [], c2 = [];
    for (let n = first; n && n !== ed; n = n.parentNode) c1.push(n);
    for (let n = last; n && n !== ed; n = n.parentNode) c2.push(n);
    let lca = null;
    for (let i = 0; i < c1.length; i++) if (c2.indexOf(c1[i]) >= 0) { lca = c1[i]; break; }
    for (let guard = 0; lca && lca.nodeType === 1 && guard < 50; guard++) {
        const cf = toolboxChildContaining(lca, first), cl = toolboxChildContaining(lca, last);
        if (!cf || !cl) return null;
        if (cf === cl && !toolboxTextFullyCovered(cf, covered)) {
            if (toolboxIsBlockEl(cf)) return null;
            lca = cf;                                          // 这一层只有一部分被选中 → 往里钻
            continue;
        }
        const run = [];
        for (let n = cf; n; n = n.nextSibling) { run.push(n); if (n === cl) break; }
        if (!run.length || run[run.length - 1] !== cl) return null;
        for (let i = 0; i < run.length; i++) if (!toolboxTextFullyCovered(run[i], covered)) return null;
        return { parent: lca, run: run };
    }
    return null;
}
function toolboxWrapRun(covered, ed, tagName, kind) {
    const plan = toolboxRunPlan(covered, ed);
    if (!plan) return null;
    const w = document.createElement(tagName);
    plan.parent.insertBefore(w, plan.run[0]);
    for (let i = 0; i < plan.run.length; i++) w.appendChild(plan.run[i]);     // 移动（不是复制）
    toolboxStripInlineDecls(w, kind);
    return w;
}
// ---------- 光标处的"那个词" ----------
// ★ 用户明确：没有选区时**绝不改整段**，只作用于光标所在的那个词；判不出词就什么都不做。
//   词 = 连续的非空白、非标点字符（中文没有空格，所以标点就是唯一的分隔符）。
const TOOLBOX_WORD_BREAK_RE = /[\s\u00a0\u200b，。、；：？！“”‘’（）〔〕【】《》〈〉「」『』—…·,.!?;:'"()\[\]{}<>\/\\|~`@#$%^&*+=]/;
function toolboxFirstTextNodeIn(root) { const l = toolboxTextNodesOf(root); return l.length ? l[0] : null; }
function toolboxLastTextNodeIn(root) { const l = toolboxTextNodesOf(root); return l.length ? l[l.length - 1] : null; }
function toolboxCaretWordRange(r, ed) {
    if (!r || !r.collapsed) return null;
    let n = r.startContainer, off = r.startOffset;
    if (n && n.nodeType === 1) {
        const before = n.childNodes[off - 1], after = n.childNodes[off];
        let pick = null;
        if (before && before.nodeType === 3) pick = before;
        else if (after && after.nodeType === 3) pick = after;
        else if (before) pick = toolboxLastTextNodeIn(before);
        else pick = toolboxFirstTextNodeIn(after);
        if (!pick || !pick.nodeValue) return null;
        n = pick;
        off = (pick === before) ? pick.nodeValue.length : 0;
    }
    if (!n || n.nodeType !== 3 || !n.nodeValue) return null;
    const s = n.nodeValue;
    const isWord = function (i) { return !TOOLBOX_WORD_BREAK_RE.test(s.charAt(i)); };
    let a = off, b = off;
    while (a > 0 && isWord(a - 1)) a--;
    while (b < s.length && isWord(b)) b++;
    if (b <= a) return null;                                   // 两边都是标点/空白：判不出词
    const word = s.slice(a, b);
    const block = toolboxNearestBlock(n, ed);
    if (block) {
        const only = String(block.textContent || '').replace(/[\s\u00a0\u200b]+/g, '');
        // 整块就这一个词（中间没有任何空白/标点分隔）⇒ 那等于"整段"，按用户要求不做
        if (only && only === word) return null;
    }
    const out = document.createRange();
    out.setStart(n, a); out.setEnd(n, b);
    return out;
}
function toolboxToggleInline(kind) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const tag = TOOLBOX_EMPHASIS_TAG[kind];
    if (!ed || !tag) return false;
    toolboxFocusEditor();
    const sel = window.getSelection && window.getSelection();
    // ★ 存档优先（工具栏那条路：按钮按下时选区已经被冻住了），存档没了就用**现场**选区。
    //   现场这条必须有：编辑区自己的 keydown 会清掉存档（toolboxDropRange），
    //   于是 Ctrl+B/I/U/S 走到这里时存档已经是空的 —— 只认存档的话快捷键就完全没反应。
    let r = toolboxActiveRange() || toolboxLiveRange();
    if (r) { try { sel.removeAllRanges(); sel.addRange(r); } catch (e) { r = null; } }
    if (!r) { toolboxToast('先选中要加格式的文字'); return false; }
    if (r.collapsed) {
        // 光标（没有选区）：只认"光标所在的那个词"，判不出就什么都不做（绝不改整段）
        const wr = toolboxCaretWordRange(r, ed);
        if (!wr) { toolboxToast('先选中要加格式的文字'); return false; }
        r = wr;
        try { sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
    }
    // ★ 现场判定（每次重算、不缓存）：选区里的字**全部**已带这个格式才算"开"。
    //   判定沿祖先链走，且取的是"选区里第一个字"，所以"整个 <b>正文</b> 被选中"
    //   （startContainer 是父元素）这种也认得出 —— 连点两次就会取消，不会再套一层。
    // ★ 判定口径（用户明确）：看**整个选区**，既不看起点、也不是"全都没有才算应用"。
    //   选区内每个字符都已带 X ⇒ 本次「取消」；只要有一个字符没带（含"一部分有"的混用/残缺）
    //   ⇒ 本次「应用」，把 X 加到选区范围内的**每一个字符**上，使整个选区统一带上 X。
    //   于是"混用/残缺 → 点一次全统一 → 再点一次全取消"这个两次闭环必然成立、不留残余。
    const fp = toolboxSelCapture(ed, r);               // ★ 操作前记下选区（连着改要用）
    const covered = toolboxSplitRangeEdges(ed, r);
    if (!covered.length) return false;
    let on = true;
    for (let i = 0; i < covered.length; i++) if (!toolboxInlineApplied(covered[i], ed, kind)) { on = false; break; }
    const scopes = [];
    for (let i = 0; i < covered.length; i++) {
        const b = toolboxNearestBlock(covered[i], ed);
        if (b && scopes.indexOf(b) < 0) scopes.push(b);
    }
    if (on) {
        // 取消：把 X 从**选区范围内**彻底摘掉（含嵌套的 X），选区外一个字节都不动。
        // ★ toolboxFixInlineChain 一次只解最内层那一层，所以这里反复扫、直到选区里搜不到 X 为止。
        //   用户实测的"已经存在的格式除不掉"就是"只解一层"留下的：混用片段点两次之后，
        //   原来就带着的 <b>本</b>/<b>老土一</b> 还在，于是永远闭不上环。
        for (let pass = 0; pass < 30; pass++) {
            let hit = 0;
            for (let i = covered.length - 1; i >= 0; i--) {
                const node = covered[i];
                if (node.parentNode && toolboxFixInlineChain(node, covered, ed, kind)) hit++;
            }
            if (!hit) break;
        }
    } else {
        // ★ 上下标互斥（用户方案 A）：应用「上标」就先把「下标」摘掉，反之亦然。
        //   走的是**同一套**字符级清除链路（toolboxFixInlineChain + 折叠 + 局部归一化），
        //   所以三种形态都能摘干净：<sup><b>x</b></sup>、<b><sub>x</sub></b>、
        //   <span style="vertical-align:super">x</span>；跨段时按段落逐段就地做。
        const foe = TOOLBOX_INLINE_FOE[kind];
        if (foe) {
            for (let pass = 0; pass < 30; pass++) {
                let hit = 0;
                for (let i = covered.length - 1; i >= 0; i--) {
                    const node = covered[i];
                    if (node.parentNode && toolboxFixInlineChain(node, covered, ed, foe)) hit++;
                }
                if (!hit) break;
            }
            for (let i = 0; i < scopes.length; i++) toolboxCollapseInlineNesting(scopes[i], foe);
            toolboxNormalizeInlineLocal(ed, covered, foe);
        }
        // 应用：优先"整段连续内容只包一层"，包不成就退回逐个包（结果一样，只是标签多几个）
        const one = toolboxWrapRun(covered, ed, tag, kind);
        if (!one) {
            for (let i = covered.length - 1; i >= 0; i--) {
                const node = covered[i];
                if (node.parentNode) toolboxWrapTextNode(node, tag, kind);
            }
        }
    }
    // 归一化：本次操作动到的块里，同标签的重复嵌套折成一层（幂等，不重排别处）
    for (let i = 0; i < scopes.length; i++) toolboxCollapseInlineNesting(scopes[i], kind);
    // ★ 再按"被选中文字的祖先链"补一遍局部归一化：覆盖"编辑区顶层直接是行内元素"的情形
    //   （那时 scopes 是空的），顺手把相邻同标签合并成一层、空壳删掉。
    toolboxNormalizeInlineLocal(ed, covered, kind);
    toolboxSnapClear();
    // ★ 这里刻意**不**调 toolboxCleanEditorBlocks/toolboxHoistBlock：
    //   行内操作不产生空块，也不该让任何"整理"逻辑去动块结构（那正是文字搬家的来源）。
    toolboxSelRestore(ed, fp, r);                      // ★ 选区留着：能连着点四个按钮
    toolboxStoreRangeNow();
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    toolboxRefresh();
    toolboxUndoPush(false);                            // 一次切换 = 一条撤回记录
    toolboxSyncToolbarState();                         // ★ 操作完立刻现场重算，不等事件
    return true;
}
// 「正文」= 「标题」的反操作：把选中内容恢复成正文。
// 做的事（只动这三样，图片/表格/字号以外的排版都不碰）：
//   · font-size 回默认（摘掉 font-size 声明）；
//   · 加粗/斜体去掉（<b>/<strong>/<i>/<em> 拆成纯内容）；
//   · 居中去掉（<center> 拆掉、style 里的 text-align 摘掉）。
// 没有选区时只处理光标所在的那个块（够用且不会误伤全文）。
// 「正文」= 把**这一块**恢复成正文（不是"插入一个片段"）：
//   · font-size / 加粗 / 斜体 / 居中 回默认；
//   · ★ 引用块自身的装饰也要清掉：border-left*、background*、引用带来的 padding/margin
//     （用户实测：以前只清了字号，引用框的样子还在）；
//   · 文字与 <br> 换行结构必须原样保留，块级容器可以保留/降级成普通段落；
//   · 没有可用块（空段落）时什么也不做（不弹提示、不新增块）。
function toolboxMakeBody() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    toolboxFocusEditor();
    const r = toolboxRestoreRange();
    if (!r) return false;
    const fp = toolboxSelCapture(ed, r);          // ★ 操作前记下选区指纹（第 5 条）
    const targets = toolboxBlockTargets(r, ed);   // ★ 整块调整：只动选区所在的最近那个块
    if (!targets.length) {
        // 空块（例如空的表格单元格）：没有块级样式可清，但**操作点附近的空节点照样要收** ——
        // "空的 <td> 里那根多余的 <br>"就是这条路上最容易留下来的一个（用例守着它）。
        toolboxCleanEditorBlocks(ed, r.startContainer);
        toolboxSnapClear();
        toolboxStoreRangeNow();
        toolboxScheduleRefresh(true);
        toolboxRefresh();
        return true;
    }
    for (let i = 0; i < targets.length; i++) {
        // ★ 连片段内部一起清：拆出来的块里可能还留着原来那层的 border-left/background
        if (targets[i] && targets[i].parentNode) toolboxClearBlockStyleDeep(targets[i]);
    }
    // 拆到编辑区根上的裸文字用 <p> 包一下：语料里的正文都是段落，
    // 裸文字会让"导出 → 再导入"多出一层无块级结构的东西。
    // ★ 只包"真的有字"的：纯空白（含 &nbsp; / 零宽空格）的文本节点**不包**
    //   —— 包出来就是一个空 <p>，在页面上是一条凭空的空行（用户实测的 bug 4）。
    const kids = Array.prototype.slice.call(ed.childNodes);
    for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if (k.nodeType !== 3) continue;
        if (!String(k.nodeValue || '').replace(/[\s\u00a0\u200b]+/g, '')) continue;
        const p = document.createElement('p');
        ed.insertBefore(p, k);
        p.appendChild(k);
    }
    // 只清"操作点附近"的空块（不要清洗用户全文）
    toolboxCleanEditorBlocks(ed, r.startContainer);
    // ★ 选区一定要在这里补回来：拆掉引用/标题那层壳（toolboxClearBlockStyleDeep）会让
    //   浏览器把编辑区的选区直接收起（实测 getSelection() 变空），
    //   而下面 toolboxStoreRangeNow() 存的是"当前"的选区 —— 不补的话，撤回栈里存的
    //   就是一个空选区，用户连着点第二下（引用 → 标题 → 正文）时选区就没了。
    //   上面那条 fp 就是为这一步留的（toolboxSetBlockStyle 里是同样的写法）。
    toolboxSelRestore(ed, fp, r);
    toolboxSnapClear();
    toolboxStoreRangeNow();
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    toolboxRefresh();
    toolboxUndoPush(false);                     // 一次「正文」= 一条撤回记录
    toolboxSyncToolbarState();
    return true;
}

// 选区两端祖先链上"该恢复成正文"的元素。
// full=true 表示这个元素的内容被选区**整段**覆盖 —— 可以连标签一起拆；
// full=false 说明它只被选区碰到一部分（例如 <p style="text-align:center"> 里只选了一行），
// 那就只摘它的样式声明，不能拆它的结构。
function toolboxBodyTargets(r, ed) {
    const out = [];
    // "n 的内容被选区整段覆盖"的判法：n 里 r.start 之前的文字、r.end 之后的文字都是空的。
    // ★ 不能用 selectNodeContents(n) + compareBoundaryPoints 去比：
    //   (span,0) 严格早于 (text,0)，选区正好选满 span 里那段文字时会被判成"没覆盖"。
    const covered = function (n) {
        try {
            const before = document.createRange();
            before.setStart(n, 0);
            before.setEnd(r.startContainer, r.startOffset);
            const after = document.createRange();
            after.setStart(r.endContainer, r.endOffset);
            after.setEnd(n, n.childNodes.length);
            return String(before).replace(/[\s\u00a0\u200b]+/g, '') === ''
                && String(after).replace(/[\s\u00a0\u200b]+/g, '') === '';
        } catch (e) { return false; }
    };
    const add = function (el, full) {
        for (let i = 0; i < out.length; i++) {
            if (out[i].el === el) { out[i].full = out[i].full || full; return; }
        }
        out.push({ el: el, full: !!full });
    };
    const scan = function (node) {
        let n = node;
        while (n && n !== ed) {
            if (n.nodeType === 1) add(n, covered(n));
            n = n.parentNode;
        }
    };
    scan(r.startContainer);
    scan(r.endContainer);
    return out;
}

// 只摘"标题那类样式声明"（字号/加粗/斜体/居中），标签与结构都不动
function toolboxStripStyleDecls(el) {
    if (!el || el.nodeType !== 1) return;
    const next = String(el.getAttribute('style') || '')
        .split(';').map(function (x) { return x.trim(); })
        .filter(function (x) { return x && !TOOLBOX_TITLE_STYLE_RE.test(x); });
    if (next.length) el.setAttribute('style', next.join('; ') + ';');
    else el.removeAttribute('style');
}
const TOOLBOX_TITLE_STYLE_RE = /^(font-size|font-weight|font-style|text-align)\s*:/i;

// 把一棵子树里的"标题样式"拆掉（toolboxMakeBody 用的）
function toolboxStripTitleStyle(root) {
    if (!root || !root.querySelectorAll) return;
    // ① 先拆标签：<b>/<strong>/<i>/<em>/<center>/<font> 一律换成里面的内容
    //    ★ 根节点自己也算 —— 光标停在 <center> 里时，"那个块"就是 <center> 本身。
    if (root !== root.ownerDocument.documentElement) {
        const selfTag = String(root.tagName || '').toLowerCase();
        if (/^(b|strong|i|em|center|font|big|small)$/.test(selfTag)) {
            toolboxUnwrapElement(root);
            return;                                   // 根被拆掉了，里面的样式跟着内容一起走了
        }
    }
    const unwrap = root.querySelectorAll('b,strong,i,em,center,font,big,small');
    for (let i = unwrap.length - 1; i >= 0; i--) toolboxUnwrapElement(unwrap[i]);
    // ② 再摘样式声明（根节点自己也要摘：<span style="font-size:1.1em"> 就是标题的字号那层）
    const all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('[style]')));
    for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (!el || el.nodeType !== 1 || !el.getAttribute('style')) continue;
        toolboxStripStyleDecls(el);
    }
    // ③ 摘干净之后只剩一个空 <span> 壳的，把壳也去掉（<span> 没有任何语义，留着只是噪声）
    if (String(root.tagName || '').toUpperCase() === 'SPAN' && !root.attributes.length) {
        toolboxUnwrapElement(root);
        return;
    }
    // ④ 空壳（拆完啥也不剩的 span）顺手清掉
    toolboxDropEmptyBlocks(root);
}

// 插入/格式化完之后清理"操作边界上新产生的"空块。
//
// ★ 只清**插入点附近**（around 为插入的节点或光标落点）：用户全文里的空块不是我们
//   该动的 —— 需求写明"不要清洗用户全文"（早先那版是整篇扫，会误删用户自己的排版）。
//   around 为空时只做"编辑区彻底空了就补一个 <p><br></p>"这一件事。
// ★ 用户有意写的连续 <br> 一律不动（见 toolboxDropEmptyBlocks）。
function toolboxCleanEditorBlocks(ed, around) {
    if (!ed) return;
    if (around) toolboxDropEmptyAround(ed, around);
    if (!ed.childNodes.length) ed.innerHTML = '<p><br></p>';
}

// ★ 顶层归一化：编辑区的**直接子节点**里不允许有"裸文本 / 裸行内元素"。
//   用户实测的 bug：空编辑区里粘贴纯文本「示例文字」，右侧代码区直接显示 `示例文字`
//   而不是 `<p>示例文字</p>`；而且光标就停在这个裸文本节点里，**之后接着打字也留在裸文本里**，
//   于是"输入的内容"也一直没有块结构。
//   根因：粘贴走 toolboxInsertHtml，插进去的是一段没有块级外壳的 HTML（`示例文字`、`甲<br>乙`），
//   它就成了 #tbEditor 的直系子节点，导出时照实输出。
//
//   做法：把**连续**的这类节点合成一个 <p>（多段粘贴 = 一个块里的若干 <br>，与原换行策略一致）。
//   · 只动"直系且不是块级"的节点，块级节点（<p>/<div>/<center>/<table>…）一个都不碰；
//   · 不新增 <br>、不新增空块、不删内容 ⇒ textContent 与 <br> 数量逐字不变（用户点名的要求）；
//   · 空白文本节点（换行缩进那种）不算，免得把排版空白包进段落。
//   返回包了几段（0 = 本来就没有裸节点，什么都不用做）。
function toolboxIsStrayTopLevel(n) {
    if (!n) return false;
    if (n.nodeType === 3) return !!String(n.nodeValue || '').replace(/[\s\u00a0\u200b]+/g, '').length;
    if (n.nodeType !== 1) return false;
    if (n.getAttribute && n.getAttribute('data-tb-display')) return false;   // 纯显示层不算内容
    // ★ <br> **不算**裸行内节点，不包块：
    //   用户的规范写法里，块与块之间的"空行"就是**单独一行的 <br>**（见规范样例里
    //   `</p>` 和下一个 `<p>` 之间那一行 `<br>`）。把它包进 <p> 再被空块清理吃掉，
    //   等于**吞掉用户主动留的空行**（用户原话：「我主动敲两次换行肯定就是想留出一个空行」）。
    if (n.tagName === 'BR') return false;
    return !toolboxIsBlockEl(n);                                            // 其余行内元素 = 没有块
}
function toolboxWrapStrayTopLevel(ed) {
    if (!ed) return 0;
    let wrapped = 0;
    for (let i = 0; i < ed.childNodes.length;) {
        if (!toolboxIsStrayTopLevel(ed.childNodes[i])) { i++; continue; }
        const run = [];
        let j = i;
        while (j < ed.childNodes.length) {
            const n = ed.childNodes[j];
            if (toolboxIsStrayTopLevel(n)) { run.push(n); j++; continue; }
            // ★ 夹在这一串裸内容**中间/末尾**的 <br> 属于同一串（例如粘贴"甲\n乙"时落下来的
            //   段内软换行）→ 一起包进同一个 <p>，结果必须是 <p>甲<br>乙</p>，不许拆成两个段。
            //   ★ 判据是"前一个兄弟已经在串里"：真正的空行（单独一根 <br> 夹在两个块之间）
            //     不会走到这里 —— 它前面是块，这一串根本没开始；所以空行永远是空行。
            if (run.length && n.nodeType === 1 && n.tagName === 'BR') { run.push(n); j++; continue; }
            break;
        }
        const p = document.createElement('p');
        ed.insertBefore(p, run[0]);
        for (let k = 0; k < run.length; k++) p.appendChild(run[k]);
        wrapped++;
        i++;                                                                 // 现在这个位置上是新的 <p>
    }
    return wrapped;
}

// ========== 操作后的收尾（空节点 + 结构自检）==========
// ① 空节点：空的 <b>/<i>/<u>/<s>/<span>…、空操作样式（font-size:1em / 无声明 style）、
//    空单元格里多余的 <br>（空的 <td></td> 本身渲染没问题，不需要 <br> 撑）。
//    ★ 只在**操作范围内**做：导入而未改动的原文保持原样（幂等），
//      用户有意写的连续 <br> 也不动。
// ② 结构自检：行内元素里不许有块级元素（<span><center>…</center></span> 这种非法嵌套），
//    <center> 里也不许再套 <center>（重复点"居中"不该越套越多）。
const TOOLBOX_NOOP_STYLE_RE = new RegExp('^(font-size\\s*:\\s*1(\\.0+)?em|font-weight\\s*:\\s*(normal|400)'
    + '|font-style\\s*:\\s*normal|text-decoration(-line)?\\s*:\\s*none)\\s*$', 'i');
const TOOLBOX_EMPTY_TAGS = 'b,strong,i,em,u,s,strike,del,ins,mark,big,small,tt,span,font';
function toolboxIsBlankNode(n) {
    if (!n || n.nodeType !== 1) return false;
    if (n.getAttribute && n.getAttribute('data-tb-display')) return false;
    if (n.querySelector && n.querySelector('img,br,table,hr,video,td,th,input')) return false;
    return !String(n.textContent || '').replace(/[\s\u00a0\u200b]+/g, '');
}
function toolboxTidyScope(root) {
    if (!root) return;
    const scope = (root.nodeType === 1) ? root : (root.parentNode || null);
    if (!scope) return;
    // ① 空单元格里多余的 <br>
    // ★ scope 自己就是单元格时也要查它本身 —— querySelectorAll 不含自己，
    //   而"光标就在这个空单元格里、点一下块级按钮"时 scope 正好就是 <td>。
    const cells = [];
    if (scope.tagName && /^(TD|TH)$/.test(String(scope.tagName).toUpperCase())) cells.push(scope);
    const cellList = scope.querySelectorAll ? scope.querySelectorAll('td,th') : [];
    for (let i = 0; i < cellList.length; i++) cells.push(cellList[i]);
    for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (String(c.textContent || '').replace(/[\s\u00a0\u200b]+/g, '')) continue;
        if (c.children.length === 1 && String(c.children[0].tagName || '').toUpperCase() === 'BR') {
            c.removeChild(c.children[0]);
        }
    }
    // ② 空操作样式与空的 style 属性
    const styled = scope.querySelectorAll ? scope.querySelectorAll('[style]') : [];
    for (let i = 0; i < styled.length; i++) {
        const el = styled[i];
        if (el.getAttribute('data-tb-display')) continue;
        const keep = String(el.getAttribute('style') || '').split(';').map(function (x) { return x.trim(); })
            .filter(function (x) { return x && !TOOLBOX_NOOP_STYLE_RE.test(x); });
        if (keep.length) el.setAttribute('style', keep.join(';') + ';');
        else el.removeAttribute('style');
    }
    // ③ 空的强调/包装标签（从后往前删，嵌套的空壳一起清）
    const empties = scope.querySelectorAll ? scope.querySelectorAll(TOOLBOX_EMPTY_TAGS) : [];
    for (let i = empties.length - 1; i >= 0; i--) {
        const el = empties[i];
        if (el.parentNode && toolboxIsBlankNode(el)) el.parentNode.removeChild(el);
    }
    toolboxRepairNesting(scope);
}

// 结构自检（只在操作范围内调用，导入路径**不**调用 —— 那会改动别人的原文）：
//   · 块级节点被行内元素包着 → 把块级节点提到那个行内元素后面；
//   · <center> 里再套 <center> → 把里面那个解开（重复点居中不该越套越多）。
function toolboxRepairNesting(root) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return 0;
    const scope = (root && root !== ed && ed.contains(root)) ? root : ed;
    let fixed = 0;
    // 先把"块级嵌在行内里"提出来（复用与插入同一套判断）
    const blocks = scope.querySelectorAll ? scope.querySelectorAll('p,div,center,table,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre,hr') : [];
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (!b.parentNode) continue;
        let n = b.parentNode, host = null;
        while (n && n !== ed) {
            if (n.nodeType === 1 && !toolboxIsBlockEl(n)) { host = n; break; }
            n = n.parentNode;
        }
        if (host && host.parentNode) { host.parentNode.insertBefore(b, host.nextSibling); fixed++; }
    }
    // 再去掉重复的居中包装。
    // ★ 这里刻意扫**整个编辑区**（不是只扫 scope）：上面那一步把块从行内包装里提出来时，
    //   落点可能是"外层那个 <center> 里面"，于是**新造出**一个 <center> 套 <center>；
    //   而那个内层 center 已经在 scope 之外了，只扫 scope 就漏掉（用例：连点两次居中）。
    //   <center> 套 <center> 永远是非法结构（渲染结果和单个一样），在任何位置解开都不改语义。
    const centers = (ed.querySelectorAll ? ed.querySelectorAll('center') : []);
    for (let i = centers.length - 1; i >= 0; i--) {
        const c = centers[i];
        const p = c.parentNode;
        if (!p || p === ed) continue;
        const pt = String(p.tagName || '').toUpperCase();
        if (pt === 'CENTER') { toolboxUnwrapElement(c); fixed++; }
    }
    return fixed;
}

// 最近的**块级祖先**（块级操作一律在块级层级做，别往行内元素里塞块）
function toolboxNearestBlock(node, ed) {
    if (!ed) ed = toolboxTpl && toolboxTpl.editor;
    let n = node;
    while (n && n !== ed) {
        if (n.nodeType === 1 && toolboxIsBlockEl(n)) return n;
        n = n.parentNode;
    }
    return null;
}
// 把一个块级节点从"行内包装"里提出来（消除 <span><center>…</center></span> 这种嵌套）
function toolboxHoistOutOfInline(node, ed) {
    if (!ed) ed = toolboxTpl && toolboxTpl.editor;
    let n = node, host = null;
    while (n && n !== ed) {
        if (n.nodeType === 1 && !toolboxIsBlockEl(n)) { host = n; break; }
        n = n.parentNode;
    }
    if (host && host.parentNode) host.parentNode.insertBefore(node, host.nextSibling);
    return node;
}

// 清掉 around 所在**块**前后紧邻的空块，以及这个块内部的空壳。
// 走"上一/下一个兄弟"而不是整篇 querySelectorAll：范围可控，不误伤远处内容。
function toolboxDropEmptyAround(ed, around) {
    let host = (around && around.nodeType === 1) ? around : (around && around.parentNode);
    // 找到包着插入点的那个直接子节点（编辑区的一级孩子），从它开始向两边走
    let top = host;
    while (top && top.parentNode && top.parentNode !== ed) top = top.parentNode;
    if (!top || top.parentNode !== ed) top = null;
    const empty = function (el) {
        if (!el || el.nodeType !== 1) return false;
        if (el.getAttribute && el.getAttribute('data-tb-display')) return false;   // 显示层不是内容
        // ★ 根级 `<br>` 是用户的空行（不是块），一律不当空块清 —— 这条同时保证"插入表格/
        //   图片后收尾"不会顺手吃掉用户留的空行。
        if (el.tagName === 'BR') return false;
        // ★ <br>/换行/图片这类"本身就是内容"的节点**永远不算空块** ——
        //   用户按「换行」插的就是一个裸 <br>，它 textContent 是空的，
        //   早先会被当成"空块"删掉（插了换行却看不见）。
        if (['BR', 'IMG', 'HR', 'INPUT', 'VIDEO', 'TD', 'TH', 'TABLE'].indexOf(el.tagName) >= 0) return false;
        if (el.querySelector && el.querySelector('img,table,hr,video,td,th,input,br')) return false;
        return String(el.textContent || '').replace(/[\s\u00a0\u200b]+/g, '') === '';
    };
    if (top) {
        // 往前：连续的空块（最多连清 3 个，够用且不会一路吃光）
        let n = top.previousSibling, guard = 0;
        while (n && guard++ < 3 && empty(n)) { const p = n.previousSibling; ed.removeChild(n); n = p; }
        n = top.nextSibling; guard = 0;
        while (n && guard++ < 3 && empty(n)) { const p = n.nextSibling; ed.removeChild(n); n = p; }
    }
    if (host && host !== ed) { toolboxDropEmptyBlocks(host); toolboxTidyScope(host); }
    else if (top) toolboxTidyScope(top);
}

// 把元素拆掉、孩子留在原地
function toolboxUnwrapElement(el) {
    if (!el || !el.parentNode) return;
    const p = el.parentNode;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
}

// 空块清理：<p><br></p>、<div>&nbsp;</div>、只有空白的 <span> 这类"什么都没装"的块删掉。
// ★ 只认 p/div/span/center/li 这些"包装用"的标签；<td>/<th>/<table>/<br>/<img> 一律不动
//   —— 空的单元格是有意留的、**根级 <br> 是用户的空行**（块与块之间那一行，见 toolboxInsertParagraph）。
function toolboxDropEmptyBlocks(root) {
    if (!root || !root.querySelectorAll) return;
    const list = root.querySelectorAll('p,div,span,center,li,font');
    for (let i = list.length - 1; i >= 0; i--) {
        const el = list[i];
        if (!el.parentNode) continue;
        if (el.getAttribute && el.getAttribute('data-tb-display')) continue;  // 显示层（图片占位）不是内容
        if (el.closest && el.closest('table')) continue;                   // 表格里不动
        if (el.querySelector && el.querySelector('img,table,hr,video,td,th,input')) continue;
        const txt = String(el.textContent || '').replace(/[\s\u00a0\u200b]+/g, '');
        if (txt) continue;                                                 // 有字就不动
        // ★ 根级的 `<br>`×N 不是"空块"，是用户留的空行，永远不在这条路上被删。
        el.parentNode.removeChild(el);
    }
}

// ========== 插入块模板（照抄语料的写法）==========
// ★ 这几个块一律走 toolboxWrapSelection：**有选区就把选中的字包进去**，
//   没有选区才用默认文字（"文章标题"这类）。见 toolboxWrapSelection 的说明。
// ========== 块级样式按钮：正文 / 标题 / 引用 / 落款 ==========
// ★ 用户给的统一语义（同时治"越点越套"和"多出空片段"）：
//   这些按钮是"设置**这一块**的样式"，不是"插入一个片段"：
//     · 光标/选区落在某个块里 → 该块**已经是**目标样式就**取消**（引用/标题/落款都是 toggle），
//       是**别的**样式就**就地替换**（不新增块、不在外面再套一层）；
//     · 只有**没有可用块**时（空段落 / 光标在编辑区根部）才插入模板
//       （模板 = 语料写法，见 toolboxInsertTitle/Quote/Signature）。
// 就地替换时是"改这一块自己的样式"，不是把块包进 <center>：块数不变、结构不叠加，
// 因此反复点也不会越套越多（导出时仍是合法嵌套，见 toolboxRepairNesting）。
const TOOLBOX_BOX_STYLE_RE = /^(border(-[a-z]+)?|background(-[a-z]+)?|padding(-[a-z]+)?|margin(-[a-z]+)?|text-align)\s*:/i;
// 块是不是"空的"（没有可用内容）：只有 <br>/&nbsp;/空白 = 空，等同于"请插入模板"
function toolboxBlockIsBlank(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.querySelector && el.querySelector('img,table,hr,video')) return false;
    return !String(el.textContent || '').replace(/[\s\u00a0\u200b]+/g, '');
}
// ========== 块级样式的作用范围：选区所在的"最近那个块" ==========
// ★ 用户给的语义（同时治"选一句话结果全文被引用"和"取消引用后色带还在"）：
//   · 引用/标题/正文/落款 都是"调整**这一个块**"：选区落在哪个块里就动哪个块，
//     整块一起改，不做行内拆分、不切出片段、不新建 <br>；
//   · **绝不**越级到大包裹 <div>、更不能是编辑区根节点（那就是整篇一起被改）；
//   · 块之前/之后的兄弟内容一律不动（不搬家、不重排）。
//   唯一允许往上走一步的情况：外面套着"只装这一个块"的壳（唯一子元素就是它），
//   而且壳上带着边框/底色/间距这类样式 —— 引用框"那条色带"正是写在这层壳上的，
//   不把它算进来，取消引用就永远清不掉它（用户实测）。
const TOOLBOX_TABLE_STRUCT_TAGS = ['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'COLGROUP', 'COL', 'CAPTION'];
// 这一层是不是"装样式的壳"（引用框的色带/底色、居中、缩进就写在它身上）
function toolboxStyleCarrier(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'CENTER' || tag === 'BLOCKQUOTE') return true;
    const st = (el.getAttribute && el.getAttribute('style')) || '';
    if (/(border|background|padding|margin|text-align)\s*:/i.test(st)) return true;
    try {
        const cs = window.getComputedStyle ? getComputedStyle(el) : null;
        if (cs) {
            if ((parseFloat(cs.borderLeftWidth) || 0) > 0) return true;
            const bg = String(cs.backgroundColor || '');
            if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) return true;
        }
    } catch (e) { /* 极端情况当它不是壳 */ }
    return false;
}
// parent 是不是"只装着 child 这一个元素"的壳（空白文本不算内容）
function toolboxOnlyChildWrapper(parent, child) {
    if (!parent || parent.nodeType !== 1) return false;
    if (TOOLBOX_TABLE_STRUCT_TAGS.indexOf(String(parent.tagName || '').toUpperCase()) >= 0) return false;
    let count = 0;
    const kids = parent.childNodes;
    for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if (k.nodeType === 1) {
            if (k !== child) return false;
            count++;
        } else if (String(k.nodeValue || '').replace(/[\s\u00a0\u200b]+/g, '')) return false;
    }
    return count === 1;
}
// 允许作为"目标块"的块级标签（用户点名的清单）。表格里的文字会先停到单元格里
// 那个块（<p>/<div>），没有的话就停在 <td>/<th> 上，不会走到整张表。
const TOOLBOX_TARGET_BLOCK_TAGS = ['P', 'DIV', 'CENTER', 'BLOCKQUOTE', 'LI'];
// 这一层里有几个**块级**子元素（用来识别"包住好几个块的大包裹"）
function toolboxBlockChildCount(el) {
    let n = 0;
    const kids = el && el.childNodes;
    if (!kids) return 0;
    for (let i = 0; i < kids.length; i++) {
        if (kids[i].nodeType === 1 && toolboxIsBlockEl(kids[i])) n++;
    }
    return n;
}
// 名字/顺序上明显是"文章级"的布局容器（带 class/id）
function toolboxLooksLikeLayoutBox(el) {
    if (!el || !el.getAttribute) return false;
    return !!(el.getAttribute('class') || el.getAttribute('id'));
}
// ★ 目标块判定 —— 引用 / 标题 / 正文 / 落款 / 图注**共用这一个函数**（别再各写一份）。
//   用户定稿的规则（"之前还没有这个问题"的那一版语义，严格照此实现）：
//     ① 从选区起点沿祖先链向上，找到**第一个块级祖先就停**（p / div / center / blockquote / li；
//        在表格里就是单元格内容所在的那个块）—— 不许继续往上找；
//     ② 只允许在"明确的**样式壳**"上**最多多走一步**：该元素只有唯一一个子元素、
//        自己带 border/background/padding/margin/text-align 之一、且那个子元素是块级。
//        （这一步是为了清掉"引用框写在外层壳上的那条色带"，只走一步）
//     ③ 绝不允许把下面这些当目标（出现即说明"走飞了"，必须退回上一个候选 / 放弃）：
//        · 编辑区根节点 #tbEditor 本身；
//        · 含 ≥2 个块级子元素的元素（包住好几个 <div> 的大包裹）；
//        · 带 class / id 的布局容器。
//   ★ 改动说明（相对上一版）：上一版是 `while` 循环，会**连续**往上爬很多层，
//     只要每一层都是"唯一子元素 + 样式壳"就一直爬 —— 于是"选一段话改引用"会一路爬到
//     包住全文的那层壳上，整篇文章都被改了。现在改成"两步封顶"（首个块级祖先 + 最多一层样式壳），
//     并加上 ③ 的三条硬护栏。
function toolboxBlockScope(el, ed) {
    if (!el || el === ed) return null;
    // ① 第一个块级祖先就停
    //   ★ "行段壳"（我们自己套的 data-tb-seg）对块级判定是**透明**的：
    //     它挂着 display:inline-block，但它是"段的替身"，目标块永远要指回它所在的那个块；
    //     否则再点一次会把它自己当成目标块（取消/重套都会套错地方）。
    let base = el;
    while (base && base !== ed) {
        if (base.nodeType === 1 && base.getAttribute && base.getAttribute(TOOLBOX_SEG_ATTR)) {
            base = base.parentNode;
            continue;
        }
        if (base.nodeType === 1 && toolboxIsBlockEl(base)) break;
        base = base.parentNode;
    }
    if (!base || base === ed || base.nodeType !== 1) return null;
    // ③ base 自己也不能是大包裹（否则整篇一起改）。
    //   ★ 这里**不**按 class/id 排除 base：<p class="…"> 这种是正常内容块；
    //     "带 class/id 的布局容器"要挡住的是**外层那一步**（见下面）。
    if (toolboxBlockChildCount(base) >= 2) return null;
    // ② 最多多走一步：外面那层是"只装这一个块"的样式壳
    const p = base.parentNode;
    if (p && p !== ed && p.nodeType === 1
        && toolboxOnlyChildWrapper(p, base) && toolboxStyleCarrier(p)
        && !toolboxLooksLikeLayoutBox(p)
        && toolboxBlockChildCount(p) <= 1) {
        base = p;
    }
    return base;
}
// ========== "段" = 块里由 <br> 划出来的行段 ==========
// ★ 用户实测纠正（本轮的**最高优先级**）：在他的文章里，一个大 <div> 内用 <br> 分行，
//   **"换行了就是一段"** —— 所以引用/落款/标题/图注的作用范围是"选区覆盖到的**行段**"，
//   **不是**整个块。上一轮"整块一起调整"的说法是错的，这里按行段来。
//   段 = 夹在两个**顶层** <br> 之间（或块首/块尾）的连续子节点；brAfter 是这个段的收尾 <br>。
//   ★ 结构不变量（用户写死的硬约束）：不改一个字、**<br> 数量不变**、不产生空块/空行。
//     做法：不新建/不删除任何 <br>，只把"覆盖到的这几段"连同**段与段之间的 <br>** 一起
//     搬进一个新的壳元素里，壳插在这些段原来的位置上。
//     · 只选了块里**部分**行段 → 壳用 display:inline-block：它仍然是"行内流"里的一个盒子，
//       外面那些 <br> 一个不动，所以浏览器照旧只换行不空行（用 display:block 会有收尾 <br>
//       产生空行，实测过）；
//     · 整个块的行段都被选中 → 不存在留在外面的边界 <br>，壳直接用 display:block。
//     两种情况下 <br> 全都在壳内部或原位，数量一个不差。
const TOOLBOX_SEG_ATTR = 'data-tb-seg';         // 标记"这是我们切行段套的壳"（净化时自动摘掉）
function toolboxLineSegs(block) {
    const segs = [];
    if (!block) return segs;
    let cur = [];
    const kids = block.childNodes;
    for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if (k.nodeType === 1 && String(k.tagName || '').toUpperCase() === 'BR') {
            segs.push({ nodes: cur, brAfter: k });
            cur = [];
            continue;
        }
        cur.push(k);
    }
    segs.push({ nodes: cur, brAfter: null });
    return segs;
}
// 某个节点落在块的哪一段里（-1 = 不在这个块里）
function toolboxSegIndexOf(segs, node) {
    if (!node) return -1;
    for (let i = 0; i < segs.length; i++) {
        const ns = segs[i].nodes;
        for (let t = 0; t < ns.length; t++) {
            const n = ns[t];
            if (n === node) return i;
            if (n.nodeType === 1 && n.contains && n.contains(node)) return i;
        }
    }
    return -1;
}
// 选区覆盖到的行段下标（**部分覆盖也整段纳入** —— "换行了就是一段"，半段没有意义）
function toolboxSegsCovered(block, segs, ed, r) {
    const hit = [];
    const mark = function (idx) { if (idx >= 0 && hit.indexOf(idx) < 0) hit.push(idx); };
    const runs = toolboxTextRunsInRange(ed, r);
    for (let i = 0; i < runs.length; i++) {
        const n = runs[i].node;
        if (n !== block && !(block.contains && block.contains(n))) continue;
        mark(toolboxSegIndexOf(segs, n));
    }
    if (!hit.length) {
        mark(toolboxSegIndexOf(segs, r.startContainer));
        if (r.startContainer && r.startContainer.nodeType === 1) {
            mark(toolboxSegIndexOf(segs, r.startContainer.firstChild));      // 整块被选中
        }
    }
    hit.sort(function (a, b) { return a - b; });
    return hit;
}
// 这些段是不是已经被"我们自己套的壳"包着（是 → 返回那个壳，取消时直接解开它就能原样还原）
function toolboxSegShell(block, segs, idx) {
    let host = null;
    for (let i = 0; i < idx.length; i++) {
        const seg = segs[idx[i]];
        const list = seg.nodes.length ? seg.nodes : (seg.brAfter ? [seg.brAfter] : []);
        for (let t = 0; t < list.length; t++) {
            let n = list[t];
            while (n && n.parentNode && n.parentNode !== block) n = n.parentNode;
            if (!n || n.parentNode !== block || n.nodeType !== 1) return null;
            if (!host) host = n;
            else if (host !== n) return null;
        }
    }
    return (host && host.getAttribute && host.getAttribute(TOOLBOX_SEG_ATTR)) ? host : null;
}
// 把块里 idx 这些行段切出来包进一个新壳（段内的 <br> 一起进来，边界 <br> 留在外面不动）
function toolboxSegWrap(block, segs, idx, decls) {
    if (!idx.length) return null;
    const i = idx[0], j = idx[idx.length - 1];
    const shell = document.createElement('div');
    shell.setAttribute(TOOLBOX_SEG_ATTR, '1');
    // ★ 顺序：先把"段与段之间"的 <br> 搬进壳（它们从原位置消失，但仍在文档里，数量不变）
    for (let k = i; k < j; k++) {
        if (segs[k].brAfter) shell.appendChild(segs[k].brAfter);
    }
    // 插到"上一段的收尾 <br>"之后（i==0 时插到块首）—— 这一步必须在搬节点**之前**做，
    // 因为锚点 prev 是留在外面的那个边界 <br>
    const prev = (i > 0) ? (segs[i - 1].brAfter || null) : null;
    block.insertBefore(shell, prev ? prev.nextSibling : block.firstChild);
    for (let k = i; k <= j; k++) {
        const ns = segs[k].nodes;
        for (let t = 0; t < ns.length; t++) shell.appendChild(ns[t]);
    }
    // 整块的行段都被选中 → 没有边界 <br> 留在外面，可以老老实实当块级；否则必须留在行内流里
    const whole = (idx.length === segs.length);
    const all = ['display:' + (whole ? 'block' : 'inline-block')].concat(decls);
    toolboxSetDecls(shell, all);
    return shell;
}
// 目标样式的声明表（引用/标题/落款/图注 共用）
function toolboxBlockDecls(kind) {
    if (kind === 'title') return ['text-align:center', 'font-size:' + TOOLBOX_TITLE_SIZE, 'font-weight:700'];
    if (kind === 'quote') return String(TOOLBOX_QUOTE_STYLE).split(';').filter(function (x) { return !!x.trim(); });
    if (kind === 'sign') return ['text-align:right'];
    if (kind === 'caption') return ['text-align:center', 'color:' + TOOLBOX_SMALL_COLOR, 'font-size:' + TOOLBOX_SMALL_SIZE];
    return [];
}
// ★ 把目标样式落到"选区所在的**行段**"上 —— 引用/标题/正文/落款/图注**共用这一个**。
//   块里有 <br> 且只覆盖到部分行段 → 切出行段；否则整块（保持原行为）。
function toolboxApplyBlockKind(kind, targets, ed, r, on) {
    const decls = toolboxBlockDecls(kind);
    for (let i = 0; i < targets.length; i++) {
        const b = targets[i];
        if (!b.parentNode) continue;
        const segs = toolboxLineSegs(b);
        if (segs.length > 1) {
            const idx = toolboxSegsCovered(b, segs, ed, r);
            if (idx.length && idx.length < segs.length) {
                // ① 先把这一块里已存在的行段壳摘掉（解开 = 回到原始 DOM），再按需重新套。
                //    "取消"走的就是这条路：解开就精确还原成操作前的样子。
                const old = toolboxSegShell(b, segs, idx);
                if (old) toolboxUnwrapElement(old);
                if (!on) {
                    const s2 = toolboxLineSegs(b);
                    toolboxSegWrap(b, s2, toolboxSegsCovered(b, s2, ed, r), decls);
                }
                continue;
            }
        }
        // ② 整块那条路（原逻辑）：整个块都覆盖到了 / 块里没有 <br>
        toolboxClearBlockStyleDeep(b);
        if (!on) toolboxSetDecls(b, decls);
    }
}
// 块级按钮该处理的块（空块不算"可用块"→ 交给插入模板那条路）
function toolboxBlockTargets(r, ed) {
    const out = [];
    const add = function (el) {
        const b = toolboxBlockScope(el, ed);
        if (!b || b === ed || !b.parentNode) return;
        if (toolboxBlockIsBlank(b)) return;
        if (out.indexOf(b) < 0) out.push(b);
    };
    if (r.collapsed) add(toolboxNearestBlock(r.startContainer, ed));
    else {
        const blocks = toolboxBlocksInRange(ed, r);
        for (let i = 0; i < blocks.length; i++) add(blocks[i]);
    }
    out.sort(function (a, b2) {
        try {
            const p = a.compareDocumentPosition(b2);
            if (p & 4) return -1;                              // b2 在 a 后面
            if (p & 2) return 1;
        } catch (e) { /* 极端情况保持原顺序 */ }
        return 0;
    });
    return out;
}
// 把一块（连同它内部的所有块级子元素）恢复成正文。
// ★ 必须连**内部**一起清：拆出来的片段里常常还留着原来那层的 <div style="border-left…">，
//   只清最外层的话"最左边那条色带"就还在（用户实测）。表格骨架一律不动。
function toolboxClearBlockStyleDeep(el) {
    if (!el || !el.getAttribute) return;
    // ★ 兜底：目标就是"行段壳"自己 → 解开它 = 回到正文（壳不是内容，不能留成空 wrapper）
    if (el.getAttribute(TOOLBOX_SEG_ATTR)) { toolboxUnwrapElement(el); return; }
    // ★ 先把"我们切行段套的壳"解开（回到原始结构）：壳本身不是内容，
    //   留着会变成"没有样式的空 wrapper"，块数也会对不上。
    if (el.querySelectorAll) {
        const shells = el.querySelectorAll('[' + TOOLBOX_SEG_ATTR + ']');
        for (let i = shells.length - 1; i >= 0; i--) toolboxUnwrapElement(shells[i]);
    }
    const list = [el];
    if (el.querySelectorAll) {
        const kids = el.querySelectorAll('*');
        for (let i = 0; i < kids.length; i++) list.push(kids[i]);
    }
    for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (!n.parentNode) continue;                            // 前面清理时被拆掉的，跳过
        if (i > 0 && TOOLBOX_TABLE_STRUCT_TAGS.indexOf(String(n.tagName || '').toUpperCase()) >= 0) continue;
        toolboxClearBlockStyle(n);
    }
}
// 往元素上合并几条声明（先按需清空，见 toolboxSetBlockStyle）
function toolboxSetDecls(el, decls) {
    if (!el || !el.setAttribute) return;
    const keep = toolboxStyleDecls(el);
    for (let i = 0; i < decls.length; i++) {
        const prop = String(decls[i]).split(':')[0].trim().toLowerCase();
        for (let j = keep.length - 1; j >= 0; j--) {
            if (String(keep[j]).split(':')[0].trim().toLowerCase() === prop) keep.splice(j, 1);
        }
        keep.push(decls[i]);
    }
    el.setAttribute('style', keep.join(';') + ';');
}
// 把一块恢复成"正文"：摘掉全部**块级特征**（引用/标题的装饰、居中对齐），
// 再拆掉只承载样式的 <b>/<i>/<span>/<font>。★ 文字与 <br> 换行结构必须原样保留。
function toolboxClearBlockStyle(el) {
    if (!el || !el.getAttribute || String(el.tagName || '').toUpperCase() === 'BR') return;
    const hasMedia = !!(el.querySelector && el.querySelector('table,img,video'));
    const keep = toolboxStyleDecls(el).filter(function (d) {
        if (hasMedia && TOOLBOX_BOX_STYLE_RE.test(d)) return true;   // 表格/图片的容器样式保留
        if (TOOLBOX_BOX_STYLE_RE.test(d)) return false;              // border/background/padding/margin/text-align
        return !TOOLBOX_TEXT_STYLE_RE.test(d);                       // font-*/line-height/color/…
    });
    if (keep.length) el.setAttribute('style', keep.join(';') + ';');
    else el.removeAttribute('style');
    toolboxStripInlineFormat(el);                        // <b>/<i>/<span style>/<font> 拆掉
    // 居中不能靠标签留着：<center> 换成普通段落（块数不变），或把外层的 <center> 解开
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'CENTER') {
        const hasBlock = !!(el.querySelector && el.querySelector('p,div,center,table,ul,ol,blockquote,h1,h2,h3'));
        if (hasBlock) toolboxUnwrapElement(el);
        else {
            const p = document.createElement('p');
            while (el.firstChild) p.appendChild(el.firstChild);
            if (el.parentNode) el.parentNode.replaceChild(p, el);
        }
    } else if (el.parentNode && String(el.parentNode.tagName || '').toUpperCase() === 'CENTER') {
        toolboxUnwrapElement(el.parentNode);
    }
}
// 就地设置/取消块级样式。返回值：
//   'done'   —— 已经在块上改完了（不需要插模板）
//   'insert' —— 没有可用块，调用方去插默认模板
function toolboxSetBlockStyle(kind) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return 'insert';
    toolboxFocusEditor();
    const r = toolboxRestoreRange();
    if (!r) return 'insert';
    const st = toolboxSelState(r);              // ★ 拆分前先算状态（拆分改了 DOM，混选判定会变）
    const fp = toolboxSelCapture(ed, r);        // ★ 操作前记下选区指纹（第 5 条：连着改）
    const targets = toolboxBlockTargets(r, ed); // ★ 整块调整：只动选区所在的最近那个块
    if (!targets.length) return 'insert';
    const on = (kind === 'quote') ? st.quote
        : (kind === 'title') ? st.title
            : (st.align === 'right');                         // sign
    // ★ 作用范围 = 选区所在块里、由 <br> 划出来的那些**行段**（用户在正文里"换行就是一段"）；
    //   块里没有 <br> 时就是整个块。见 toolboxApplyBlockKind 的详细说明。
    toolboxApplyBlockKind(kind, targets, ed, r, on);
    toolboxSnapClear();
    toolboxCleanEditorBlocks(ed, targets[0]);
    // ★ 操作完把选区恢复到同一段文字上：不改选区，用户就能连着点第二下
    toolboxSelRestore(ed, fp, r);
    toolboxStoreRangeNow();
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    toolboxRefresh();
    toolboxUndoPush(false);                     // 一次样式设置/取消 = 一条撤回记录
    toolboxSyncToolbarState();
    return 'done';
}
// ★ 图注跟着一起走"块级样式"这条路：有选区时**整块**变成图注样式、且**不动选区**
//   （用户实测：选中一段文字点「图注」，选区被取消了 —— 那让用户没法接着操作）。
//   判定"已经是图注"用 toolboxSelState 算出来的 st.caption（它按计算样式算：居中 + #555555
//   + 0.85rem，所以导入进来的、没有我们标签的图注也能认出来）。
function toolboxSetCaptionStyle() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return 'insert';
    toolboxFocusEditor();
    const r = toolboxRestoreRange();
    if (!r) return 'insert';
    const st = toolboxSelState(r);              // ★ 拆分前先算状态（拆分改 DOM，混选判定会变）
    const fp = toolboxSelCapture(ed, r);        // ★ 操作前记下选区指纹（覆盖范围原样恢复）
    const targets = toolboxBlockTargets(r, ed);
    if (!targets.length) {
        // 没有可用块（空段/光标在空行上）—— 与其它块级按钮一致：交给插入模板那条路。
        // ★ 这里必须"什么都不改"地返回：空块上先清样式再补样式会留下一个空 <center>。
        return 'insert';
    }
    const on = !!st.caption;
    // ★ 与引用/标题/落款走**同一套**行段判定（块里有 <br> 时只动选区覆盖到的行段）
    toolboxApplyBlockKind('caption', targets, ed, r, on);
    toolboxSnapClear();
    toolboxCleanEditorBlocks(ed, targets[0]);
    // ★ 操作完把选区恢复到**同一段文字**上：覆盖范围不变、不整段全选，用户能接着点第二下
    toolboxSelRestore(ed, fp, r);
    toolboxStoreRangeNow();
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    toolboxRefresh();
    toolboxUndoPush(false);
    toolboxSyncToolbarState();
    return 'done';
}
function toolboxInsertTitle() {
    if (toolboxSetBlockStyle('title') === 'done') return true;
    return toolboxWrapSelection(function (inner) {
        return '<center><b><span style="font-size:' + TOOLBOX_TITLE_SIZE + ';">' + inner
            + '</span></b></center><br>';
    }, '文章标题');
}
function toolboxInsertQuote() {
    if (toolboxSetBlockStyle('quote') === 'done') return true;
    return toolboxWrapSelection(function (inner) {
        return '<div style="' + TOOLBOX_QUOTE_STYLE + '">' + inner + '</div>';
    }, '此处填写引用内容');
}
// 图注：语料主流是 <center><span style="color:#555555; font-size:0.85rem;">…</span></center>
// ★ 有选区时走"块级样式"那条路（整块变图注、保留选区，见 toolboxSetCaptionStyle）；
//   无选区时才插入默认文字"图片说明"并全选它（用户直接打字覆盖）。
function toolboxInsertCaption(text) {
    if (toolboxSetCaptionStyle() === 'done') return true;
    const def = (text == null || text === '') ? '图片说明' : String(text);
    return toolboxWrapSelection(function (inner) {
        return '<center><span style="color:' + TOOLBOX_SMALL_COLOR + '; font-size:'
            + TOOLBOX_SMALL_SIZE + ';">' + inner + '</span></center>';
    }, def);
}
function toolboxCaptionHtml(text) {
    return '<center><span style="color:' + TOOLBOX_SMALL_COLOR + '; font-size:' + TOOLBOX_SMALL_SIZE + ';">'
        + toolboxEsc(text) + '</span></center>';
}
// 图片块：照抄语料的写法 —— <center><img width="80%"></center>，图注单独一行居中。
// ★ 语料里 160 张图片**全部**是 <center> + width="80%"，不要换成 div 包一层：
//   现有文章全是这个形态，导入导出时要能对上，不然每次导入都会"看起来被改过"。
function toolboxImageBlock(src, width, caption) {
    const w = (width == null || width === '') ? TOOLBOX_IMG_WIDTH : String(width);
    // alt = 文件名（需求 B）：正文区取不到图时占位框直接显示它，读屏软件也有个名字。
    // 导入的图片**不动** alt（保持幂等），只有这里新插入的才写。
    let html = '<center><img src="' + toolboxEsc(src) + '" width="' + toolboxEsc(w)
        + '" alt="' + toolboxEsc(toolboxImgBaseName(src)) + '"></center>';
    if (caption) html += '\n' + toolboxCaptionHtml(caption);
    return html;
}
// 超链接：默认带 target="_blank"（语料 46 个链接里 32 个带），
// 同时补 rel="noopener" —— 防 window.opener 反向操作，反正正文里也不会有什么依赖。
// ★ 链接文字优先取"按下按钮那一刻选中的文字"（快照），现场选区到点确定时早就没了
//   —— 对话框一拿到焦点，编辑区的选区就收起了。取不到才退回对话框里填的文字。
function toolboxLinkText(fallback) {
    if (toolboxSnapText) return toolboxSnapText;
    const r = toolboxActiveRange();
    if (r && !r.collapsed) { try { return String(r); } catch (e) {} }
    return String(fallback || '');
}
function toolboxLinkHtml(url, text, blank) {
    const anchor = toolboxLinkText(text) || url;
    return '<a href="' + toolboxEsc(url) + '"' + (blank ? ' target="_blank" rel="noopener"' : '') + '>'
        + toolboxEsc(anchor) + '</a>';
}
function toolboxInsertSignature() {
    // 落款：语料惯用 <div style="text-align:right;">（工具产出统一用这个写法）。
    // 光标已经在某一块里 → 就地把它设成右对齐（再点一次取消），不新增块。
    if (toolboxSetBlockStyle('sign') === 'done') return true;
    return toolboxWrapSelection(function (inner) {
        return '<div style="text-align:right;">' + inner + '</div>';
    }, '—— 落款');
}
// ========== 段、换行、光标托 ==========
// 用户口径（结构层面；与"格式作用的 <br> 行段"是两回事，别混）：
//   ① **一段 = 一个 `<p>`**。编辑区根下永远不许有裸文本/裸行内节点
//      （toolboxWrapStrayTopLevel 挂在 toolboxRefresh 上，所有改编辑区的路径都兜住）；
//   ② **一次 Enter = 段内一个 `<br>`**，并且**编辑区立刻可见一个换行**（光标那一行真的下移一行）；
//      该 `<br>` 在用户删掉它之前一直稳定存在（不会因为继续打字消失）；
//   ③ **连按两次 Enter（用户主动留一个空行）= 一个空的 `<p></p>`**
//      （用户原话：「`<p></p>`此处是一个空行，用于文章的层次考虑」）：
//      结束当前 `<p>`（把刚敲的那个段内 `<br>` 升格成段落分界），补一个**空的 `<p></p>`**，
//      再新建一个 `<p>` 让光标落脚；落脚那一 `<p>` 还没打字，所以序列化时不输出它。
//
// ★ 为什么要"光标托"（TOOLBOX_CARET_ATTR）：
//   `<p>哈哈哈<br></p>` 里那个 `<br>` 在**块尾**时，浏览器不给它生成行盒 —— 光标会被画回
//   上一行（用户实测的"按一次 Enter 左边纹丝不动，要按两次"就是这个），而且浏览器会把
//   接着打的字**并进上一行的文本节点**，顺手把尾随的 `<br>` 吃掉（"第二个 `<br>` 消失"）。
//
// ★★ 落脚点几经迭代，最终形态是**一根带标记的 `<br>`**（不是 span）：
//   · 用 span（哪怕 width:1px）时，实测它的矩形虽然有，但**选区的 getClientRects() 是空的**
//     —— 浏览器画不出插入点（用户实测："按一次 Enter 左边光标看不见"），
//     而且鼠标点"下一行"命中的还是上一行的文字（"点下一行没反应"，打字进错行）。
//   · 换成 `<br data-tb-caret="1">` 之后，DOM 形态与**浏览器自己**按 Shift+Enter
//     得到的结果逐字节一致：`<p>哈哈哈<br><br></p>`，光标停在两根 `<br>` 中间
//     （实测 Chrome 原生 insertLineBreak 就是这个结果，选区同样是 (p,2)）。
//     实测：鼠标点第二行 → 光标正确落到 (p,2) → 打字得到 `<p>哈哈哈<br>Z</p>`（字落在第二行）。
//   · 这根 `<br>` 只负责"给光标一格落脚"，序列化前一律摘掉（toolboxStripCaretHolders），
//     所以代码区/导出永远是 `<p>哈哈哈<br></p>`，一个字节都不多。
//   · 它**不含任何文字**（textContent 一字不变），也不占字符数。
function toolboxCaretHolderMake() {
    const br = document.createElement('br');
    br.setAttribute(TOOLBOX_CARET_ATTR, '1');
    return br;
}
// 摘托：把托里的东西挪到原位、删掉托本身。打了字之后也要走这里 —— 一个字都不能丢。
function toolboxCaretHolderStrip(sp) {
    if (!sp || !sp.parentNode) return;
    const p = sp.parentNode;
    while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
    p.removeChild(sp);
}
// 托的清理：
//   · 里面有东西（用户已经在那一行打了字）→ 一律解开，内容留在原处；
//   · 空托 → 光标还贴在它上面（在它里面、或紧挨它前一格/后一格）就留着
//     （它正是当前那一行的落脚点），光标已经走了就删掉
//     （不然编辑区会比代码区多出一条空行）。
function toolboxCaretHolderSweep() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !ed.querySelectorAll) return 0;
    const list = ed.querySelectorAll('[' + TOOLBOX_CARET_ATTR + ']');
    if (!list.length) return 0;
    let sel = null;
    try { sel = window.getSelection(); } catch (e) { sel = null; }
    // 光标在这个落脚点上吗？—— <br> 托没有子节点，光标只能**紧贴**它（前/后一格），
    // 所以两种情形都要算"还在用"。
    const caretOn = function (sp) {
        if (!sel || !sel.rangeCount || !sel.anchorNode) return false;
        if (sp === sel.anchorNode || sp.contains(sel.anchorNode)) return true;
        const n = sel.anchorNode;
        const kids = n.childNodes;
        if (!kids) return false;
        const at = sel.anchorOffset;
        return kids[at] === sp || kids[at - 1] === sp;
    };
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        const sp = list[i];
        if (!sp.parentNode) continue;
        const hasContent = String(sp.textContent || '').replace(/[\s\u00a0\u200b]+/g, '').length
            || (sp.querySelector && sp.querySelector('img,br,table,hr,video'));
        if (hasContent) { toolboxCaretHolderStrip(sp); n++; continue; }
        if (caretOn(sp)) continue;
        sp.parentNode.removeChild(sp);
        n++;
    }
    return n;
}
// 供序列化用：在**克隆体**上摘托（编辑区里那份要留着给光标落脚）。
function toolboxStripCaretHolders(root) {
    if (!root || !root.querySelectorAll) return 0;
    const list = root.querySelectorAll('[' + TOOLBOX_CARET_ATTR + ']');
    for (let i = list.length - 1; i >= 0; i--) toolboxCaretHolderStrip(list[i]);
    return list.length;
}
// 块里"有没有真东西"（文字/图片/表格/视频/水平线/输入框）。空段判定到处要用，所以单独一个。
function toolboxBlockHasContent(el) {
    if (!el) return false;
    if (el.querySelector && el.querySelector('img,table,hr,video,td,th,input')) return true;
    return !!String(el.textContent || '').replace(/[\s\u00a0\u200b]+/g, '').length;
}
// 导入：源码里**写着的空 <p>**（`<p></p>` / `<p><br></p>`）按用户口径就是"一个空行"，
// 就地换成根级独立 `<br>` —— 这样"空行"在整个编辑器里只有一种形态（<br>），
// 动态互转（打字变 <p>、删空退回 <br>）才不会有第二种空行藏进来。
// ★ 只处理编辑区根下的空 <p>：表格单元格里的空 <p> 是单元格占位，不动。
function toolboxImportBlankLines(root) {
    if (!root || !root.childNodes) return 0;
    const kids = Array.prototype.slice.call(root.childNodes);
    let n = 0;
    for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        if (!el || el.nodeType !== 1 || String(el.tagName).toUpperCase() !== 'P') continue;
        if (toolboxBlockHasContent(el)) continue;
        if (el.querySelector('img,table,hr,video,td,th,input')) continue;
        root.replaceChild(document.createElement('br'), el);
        n++;
    }
    return n;
}
// 光标所在的**顶层块**（编辑区的一级孩子，且必须是块级）。找不到 → null（光标在根上，得先包块）。
function toolboxTopBlockOf(node, ed) {
    if (!ed) ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !node) return null;
    let n = (node.nodeType === 1) ? node : node.parentNode;
    let top = null;
    while (n && n !== ed) { top = n; n = n.parentNode; }
    return (top && top.parentNode === ed && toolboxIsBlockEl(top)) ? top : null;
}
// 在光标处把一个块就地切开：光标之后的内容进新块（同标签、同 style），返回新块。
function toolboxSplitBlockAt(blk, r) {
    if (!blk || !blk.parentNode) return null;
    let tail, frag;
    try {
        tail = document.createRange();
        tail.setStart(r.startContainer, r.startOffset);
        if (blk.lastChild) tail.setEndAfter(blk.lastChild); else tail.setEnd(blk, 0);
    } catch (e) { return null; }
    try { frag = tail.collapsed ? document.createDocumentFragment() : tail.extractContents(); }
    catch (e) { return null; }
    const tag = String(blk.tagName || 'P').toUpperCase();
    const keep = (tag === 'P' || tag === 'DIV' || tag === 'BLOCKQUOTE' || /^H[1-6]$/.test(tag)) ? tag.toLowerCase() : 'p';
    const nb = document.createElement(keep);
    const st = blk.getAttribute && blk.getAttribute('style');
    if (st) nb.setAttribute('style', st);
    nb.appendChild(frag);
    blk.parentNode.insertBefore(nb, blk.nextSibling);
    return nb;
}
// ---------- 空行 ↔ 段落的动态互转（用户口径） ----------
// 正文 = 一个"行序列"：**有文字的行 = `<p>内容</p>`**，**空行 = 一个独立成行的 `<br>`**。
// 两者随用户输入自动互转，触发点只有一处 —— 编辑区的 input 事件（见 initToolboxDOM）：
//   · insert* → toolboxFillBlankLine()：在空行上打字，那个 <br> 就地变成 <p>；
//   · delete* → toolboxParagraphToBlankLine()：把某段的字全删光，那个 <p> 变回 <br>。
// ★ 为什么放在 input 里、归一化之前：此刻 DOM 还没被顶层归一化动过，打的字还是根上的
//   裸文本，正好能一眼看出"它是不是落在某个空行旁边"；选区也还是浏览器刚给的现场位置，
//   改完只需动那个 <br>，光标一个字符都不会跳。
// ★ 为什么严格按 inputType 分派：只有"用户自己打字/自己删空"才转换。工具插入留下的空壳
//   （插表格/图片后的 `<p><br></p>`）不转 —— 否则每次插入都会凭空多出一个空行。
//
// ＝＝ 光标的"逻辑位置"：纯文本偏移 ⇄ 光标 ＝＝
// ★ 为什么需要（用户实测 bug 1 的根因）：结构一旦被改写（空行 <br> 换成 <p>、
//   合成上屏时浏览器把文字节点整个换掉……），**归一化之前抓的那个 DOM Range 就可能整段失效**
//   或被夹到相邻节点上 —— 表现就是"拼音输入「中」之后光标跳到下一段开头（跑到「乙」前面）"。
//   文字偏移跟节点身份无关，改完结构再按同一个偏移落回来，光标就一定还在"刚输入的文字之后"。
//   （跟代码区联动用的 toolboxSrcFromText / toolboxTextFromSrc 是另一套口径：那套把
//     代码区源码偏移 ⇄ 编辑区字符偏移对应起来，用于高亮；这里是编辑区内部的光标定位。）
function toolboxCaretTextOffset() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const sel = window.getSelection && window.getSelection();
    if (!ed || !sel || !sel.rangeCount) return -1;
    const r = sel.getRangeAt(0);
    if (!r.startContainer || !ed.contains(r.startContainer)) return -1;
    try {
        const before = document.createRange();
        before.setStart(ed, 0);
        before.setEnd(r.startContainer, r.startOffset);
        return before.toString().length;
    } catch (e) { return -1; }
}
// 文本偏移 → 光标（toolboxCaretTextOffset 的逆运算）。偏移超出范围就落到文末。
function toolboxCaretToTextOffset(off) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || off < 0) return false;
    let acc = 0, hit = null, hitAt = 0, last = null, lastLen = 0;
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
        const t = walker.currentNode;
        const len = String(t.nodeValue || '').length;
        if (!hit && off <= acc + len) { hit = t; hitAt = off - acc; break; }
        acc += len; last = t; lastLen = len;
    }
    try {
        const nr = document.createRange();
        if (hit) nr.setStart(hit, Math.max(0, Math.min(hitAt, String(hit.nodeValue || '').length)));
        else if (last) nr.setStart(last, lastLen);
        else nr.setStart(ed, ed.childNodes.length);
        nr.collapse(true);
        const sel = window.getSelection();
        if (!sel) return false;
        sel.removeAllRanges(); sel.addRange(nr);
        toolboxSaveRange();
        return true;
    } catch (e) { return false; }
}
// 这一格是不是"真正的空行"（根级、独立成行、不带落脚标记的 `<br>`）。
// 带标记的 `<br data-tb-caret>` 是光标落脚点，不是空行。
function toolboxIsBlankLineBr(n) {
    return !!(n && n.nodeType === 1 && n.tagName === 'BR'
        && !(n.getAttribute && n.getAttribute(TOOLBOX_CARET_ATTR)));
}
// 从 blk 往前找"实义"的兄弟（跳过空文本节点）。
function toolboxPrevMeaningfulSibling(blk) {
    let n = blk && blk.previousSibling;
    while (n) {
        if (n.nodeType === 3 && !String(n.nodeValue || '').replace(/[\s\u00a0\u200b]+/g, '').length) { n = n.previousSibling; continue; }
        break;
    }
    return n || null;
}
// 光标是不是停在这一块的**逻辑开头**（块内光标之前只有空白/换行，没有字）。
function toolboxCaretAtBlockStart(blk, r) {
    if (!blk || !r) return false;
    try {
        const t = document.createRange();
        t.setStart(blk, 0);
        t.setEnd(r.startContainer, r.startOffset);
        return !String(t.toString()).replace(/[\s\u00a0\u200b]+/g, '').length;
    } catch (e) { return false; }
}
// ★★ 空行上的"落点物化"（用户实测 bug 1 的关键修法）：把光标正待着的那一格空行**就地**
//   变成一个空的段落壳 `<p><br></p>`，光标放进去。
//   为什么非做不可：光标停在"独立成行的 `<br>`"上时，它在**根级**、紧贴一根 `<br>` ——
//   浏览器（尤其输入法合成提交那一步）并不把它当成稳定的插入点，经常把字插进**下一段的开头**
//   （用户看到的就是"输「中」之后光标跑到「乙」前面"）。物化成真正的块之后，插入点就稳了。
//   两条现场都认：① 光标就在根上、紧邻空行；② 光标在某块开头、而这一块前面紧邻空行
//   （浏览器把"点空行"解析成"下一段开头"就是这种，用户遇到的正是它）——
//   第②种带"这一块本来就有内容"的限定，见 toolboxBlankLineBrAtCaret 里的说明（案例 3 的回归点）。
//   物化出来的空段落壳在导出时按既定规则归一化成独立 `<br>`（空段落 = 空行），代码区一字不差。
function toolboxBlankLineCaretHost() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return 0;
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    if (!r.collapsed || !ed.contains(r.startContainer)) return 0;
    const blank = toolboxBlankLineBrAtCaret();
    if (!blank || !blank.parentNode) return 0;
    const host = blank.parentNode;
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));
    host.insertBefore(p, blank);                 // 就地占位：顺序一个节点都不动
    host.removeChild(blank);
    try {
        const nr = document.createRange();
        nr.setStart(p, 0);
        nr.collapse(true);
        sel.removeAllRanges(); sel.addRange(nr);
        toolboxSnapClear();
        toolboxSaveRange();
    } catch (e) {}
    return 1;
}
// 光标正"待在"哪一根空行上（只读，不改 DOM）。两种现场都算：
//   ① 光标就在根上、紧邻一根独立空行 `<br>`；
//   ② 光标在某块开头、而这一块前面紧邻一根独立空行 `<br>`，**且这一块里本来就有字/图/表**
//      （浏览器把"点空行"解析成"下一段开头"就是这种 —— 用户遇到的正是它）。
//      ★ 第②条那个"本来就有内容"的限定不能省：连按 Enter 分出来的**落脚段**本身是空的，
//        光标正常待在里面，那不是"光标停在空行上"（限定它的原因见下面函数体里的长注释）。
// 供"物化落点"（toolboxBlankLineCaretHost）与"空行上 Shift+Enter"共用。
function toolboxBlankLineBrAtCaret() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return null;
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!r.collapsed || !ed.contains(r.startContainer)) return null;
    if (r.startContainer === ed) {
        const i = r.startOffset;
        if (toolboxIsBlankLineBr(ed.childNodes[i - 1])) return ed.childNodes[i - 1];
        if (toolboxIsBlankLineBr(ed.childNodes[i])) return ed.childNodes[i];
        return null;
    }
    const blk = toolboxTopBlockOf(r.startContainer, ed);
    if (!blk || !blk.parentNode) return null;
    // ★★ 守卫（用户实测案例 3 回归的根因）：**"这一块自己没内容"就不算"光标停在空行上"**。
    //   连按 Enter 分出来的那个**落脚段**本来就是空的（`<p><br></p>`），光标正常待在它里面；
    //   如果在这里也去"物化落点"，就会把**上方那根空行偷换成新段落、并把光标从落脚段搬走**，
    //   于是"前段 → 空行 → 落脚段（光标在此）"的顺序被破坏 —— 拼音上屏后 gap 消失
    //   （案例 3：`甲 ⏎ ⏎ 乙` 出来的是 `<p>甲</p>` + `<p>乙</p>`，中间那根独立 `<br>` 没了）。
    //   只有"这一块本身有字/图/表"（= 用户其实点在了**下一段的开头**）才算"光标落在空行上"。
    //   `toolboxBlockHasContent` 不把 `<br>` 当内容：纯换行的空段落一律算"没内容"。
    if (!toolboxBlockHasContent(blk)) return null;
    const prev = toolboxPrevMeaningfulSibling(blk);
    if (toolboxIsBlankLineBr(prev) && toolboxCaretAtBlockStart(blk, r)) return prev;
    return null;
}
// ★ 补齐"普通按键"那条路：浏览器把刚敲的字插进**下一段的开头**时（合成以外的路径也会遇到），
//   把那一格空行吃掉、让刚打的这几个字自成一段，并把光标放到这几个字之后。
//   与 toolboxBlankLineCaretHost 的区别：那条是"提前物化"（合成/粘贴/回车前），
//   这条是"事后补救"（字已经插进去了，按 e.data 的长度把那几个字认出来）。
function toolboxTypedIntoNextBlock(typedLen) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !typedLen || typedLen < 1) return 0;
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    if (!r.collapsed || r.startContainer.nodeType !== 3) return 0;
    const blk = toolboxTopBlockOf(r.startContainer, ed);
    if (!blk || !blk.parentNode) return 0;
    const prev = toolboxPrevMeaningfulSibling(blk);
    if (!toolboxIsBlankLineBr(prev)) return 0;
    const t = r.startContainer;
    const off = r.startOffset;
    if (off < typedLen) return 0;                // 刚打的字必须完整地在本节点里（不然不敢猜）
    const typed = String(t.nodeValue || '').slice(off - typedLen, off);
    if (!typed) return 0;
    // ★ 判据：**这一块里、光标之前的文字，正好就是刚打进去的那几个字**。
    //   也就是"用户是在这一段的最前面打的"——段中打字（前面已有字）一律不动。
    //   （不能只看"光标前没有字"：input 事件跑的时候刚打的字已经在光标左边了。）
    let before = '';
    try {
        const t2 = document.createRange();
        t2.setStart(blk, 0);
        t2.setEnd(r.startContainer, r.startOffset);
        before = String(t2.toString());
    } catch (e) { return 0; }
    if (before !== typed) return 0;
    // ★ 还要排除"这一块本来就空、打进去的字就是它的全部内容"这种：那是**正常的往空段落里打字**
    //   （比如连按 Enter 之后那个落脚的 `<p><br></p>`），不能再吃掉旁边的空行 ——
    //   否则"连按三次 Enter 得到两根空行、接着打字段落另起"这条既定口径会被破坏。
    //   只有"这一块本来就有字"（光标在最前面、后面还压着原文）才说明用户是在空行上打字。
    if (String(blk.textContent || '') === typed) return 0;
    const host = prev.parentNode;
    const p = document.createElement('p');
    p.appendChild(document.createTextNode(typed));
    host.insertBefore(p, prev);                  // 空行那一格 → 新段落
    host.removeChild(prev);
    try {
        if (String(t.nodeValue || '').length > typedLen) t.nodeValue = String(t.nodeValue).slice(typedLen);
        else if (t.parentNode) t.parentNode.removeChild(t);   // 整块就这几个字：节点空了就删掉
    } catch (e) { return 0; }
    // 原来那个块被搬空了就顺手清掉（只有空壳、没有字）
    if (!toolboxBlockHasContent(blk) && blk.parentNode) blk.parentNode.removeChild(blk);
    try {
        const nr = document.createRange();
        const last = p.lastChild;
        if (last && last.nodeType === 3) nr.setStart(last, String(last.nodeValue || '').length);
        else { nr.selectNodeContents(p); nr.collapse(false); }
        sel.removeAllRanges(); sel.addRange(nr);
    } catch (e) {}
    toolboxSnapClear();
    toolboxSaveRange();
    return 1;
}
function toolboxFillBlankLine() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return 0;
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    const c = r.startContainer;
    if (!c || c.nodeType !== 3 || c.parentNode !== ed) return 0;      // 打的字必须是根上的裸文本
    if (!String(c.nodeValue || '').replace(/[\s\u00a0\u200b]+/g, '')) return 0;
    const pv = c.previousSibling, nx = c.nextSibling;
    // ★ 只认**真正的空行**（根级独立 `<br>`）：带标记的落脚 `<br>`（data-tb-caret）不是空行，
    //   它只是光标暂住的那一格，绝不能因为"旁边打了字"就被吃掉。
    const isBlank = function (n) {
        return !!(n && n.nodeType === 1 && n.tagName === 'BR'
            && !(n.getAttribute && n.getAttribute(TOOLBOX_CARET_ATTR)));
    };
    let drop = null;
    if (isBlank(pv)) drop = pv;                                        // 字落在空行**后面**
    else if (isBlank(nx)) drop = nx;                                    // 字落在空行**前面**
    if (!drop) return 0;
    // 只吃**一个** <br>：多个空行时"剩余空行数不变、顺序不变"。
    const off = r.startOffset;
    ed.removeChild(drop);
    // ★ 就地包成 <p>（不要等顶层归一化）：文字节点身份不变 ⇒ 光标还在这段里、偏移不变，
    //   接着打的字自然接在同一个 <p> 里（用户断言：X 之后打 Y 必须得到 <p>XY</p>，
    //   而不是跑到下一段去）。
    const np = document.createElement('p');
    ed.insertBefore(np, c);
    np.appendChild(c);
    try {
        const nr = document.createRange();
        nr.setStart(c, Math.max(0, Math.min(off, String(c.nodeValue || '').length)));
        nr.collapse(true);
        sel.removeAllRanges(); sel.addRange(nr);
        toolboxSnapClear();
        toolboxSaveRange();
    } catch (e) {}
    return 1;
}
// 段落的字被删光 → 该 <p> 变回一个"独立成行的 <br>"（空行）。
function toolboxParagraphToBlankLine() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return 0;
    const r = toolboxLiveRange() || toolboxActiveRange();
    if (!r) return 0;
    const blk = toolboxTopBlockOf(r.startContainer, ed);
    if (!blk || String(blk.tagName || '').toUpperCase() !== 'P') return 0;
    if (toolboxBlockHasContent(blk)) return 0;                        // 还有字 → 不动
    // ★ 编辑区就剩这一段（用户把唯一那段删空了）→ **不转**：保持原来那个空段落壳，
    //   跟"刚打开、什么都没写"的样子逐像素一致（用户点名要求区分这种情形），
    //   导出也仍旧是空内容（toolboxEditorEmpty 那条路）。
    if (ed.querySelectorAll('p,div,center,table,ul,ol,blockquote,pre,h1,h2,h3,h4,h5,h6,img,hr,video').length <= 1) return 0;
    const br = document.createElement('br');
    ed.insertBefore(br, blk);
    ed.removeChild(blk);
    // ★ 光标落到这根 <br> **前面**（就是用户点空行时空标停的位置）：接着打字会走
    //   toolboxFillBlankLine 重新长成一个 <p> —— 空行 ↔ 段落因此完全可逆。
    try {
        const nr = document.createRange();
        nr.setStart(ed, Array.prototype.indexOf.call(ed.childNodes, br));
        nr.collapse(true);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(nr); }
        toolboxSnapClear();
        toolboxSaveRange();
    } catch (e) {}
    return 1;
}
// 光标之后（光标所在块内）还有没有"实义内容"？—— 有 ⇒ 这一行不是块尾，不需要落脚 <br>。
// 只看文字/图片/表格/视频/水平线：中间那几根 <br>、空文本、标记节点都不算内容。
function toolboxContentAfterCaret(r) {
    const blk = toolboxTopBlockOf(r.startContainer);
    const scope = blk || (toolboxTpl && toolboxTpl.editor);
    if (!scope) return false;
    let after = null;
    try {
        after = document.createRange();
        after.setStart(r.startContainer, r.startOffset);
        if (scope.lastChild) after.setEndAfter(scope.lastChild); else after.setEnd(scope, 0);
    } catch (e) { return false; }
    if (after.collapsed) return false;
    let frag = null;
    try { frag = after.cloneContents(); } catch (e) { return false; }
    if (!frag) return false;
    if (String(frag.textContent || '').replace(/[\s\u00a0\u200b]+/g, '').length) return true;
    return !!(frag.querySelector && frag.querySelector('img,table,hr,video,input'));
}
// 段内换行（**只**由 Shift+Enter / 工具栏「换行」按钮触发）：在光标处插一根 `<br>`，
// 光标落到 `<br>` 之后那一行 —— **仍在同一个 <p> 里**（用户口径：段内分行绝不变成段落）。
//   · 光标后面还有内容（`甲|乙`）→ 只插一根 `<br>`，光标落在后面那个字之前
//     ⇒ `<p>甲<br>乙</p>`（与浏览器原生 insertLineBreak 一致）；
//   · 光标已经在块尾（`甲|`）→ 再补一根**带标记的落脚 `<br>`**（见 toolboxCaretHolderMake
//     上面的实测说明），光标停在两根 `<br>` 中间 ⇒ 浏览器给这一行生成行盒、光标可见可点，
//     序列化时标记那根被摘掉 ⇒ 代码区仍是 `<p>甲<br></p>`。
function toolboxInsertBreakNodes(r) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return null;
    try { if (!r.collapsed) r.deleteContents(); } catch (e) {}
    if (!ed.contains(r.startContainer)) return null;
    const needHolder = !toolboxContentAfterCaret(r);
    const br = document.createElement('br');
    const holder = needHolder ? toolboxCaretHolderMake() : null;
    const frag = document.createDocumentFragment();
    frag.appendChild(br);
    if (holder) frag.appendChild(holder);
    try { r.insertNode(frag); } catch (e) { return null; }
    try {
        const host = br.parentNode;
        const at = Array.prototype.indexOf.call(host.childNodes, br) + 1;      // = 两根 br 之间
        const nr = document.createRange();
        const nx = br.nextSibling;
        if (!holder && nx && nx.nodeType === 3 && String(nx.nodeValue || '').length) nr.setStart(nx, 0);
        else nr.setStart(host, Math.max(0, Math.min(at, host.childNodes.length)));
        nr.collapse(true);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(nr); }
    } catch (e) {}
    toolboxSnapClear();
    toolboxSaveRange();
    return holder || br;
}
// 连按两次 Enter 的落地逻辑现在都在 toolboxInsertParagraph() 里（见那个函数上方那段注释）：
// ★ 空行的最终形态（用户口径）：块与块之间一个独立 `<br>`，与他的规范样例一致 ——
//   `<p>哈哈哈</p>` / `<br>` / `<p>新内容</p>`。不是空 `<p></p>`，也不是段内 `<br><br>`。
//   旧的 toolboxBlankParagraphAt()（"一次 Enter 先插段内 <br>、第二次 Enter 再把那根 <br>
//   升格成空行"）在本轮口径反转后已无调用点，直接删掉，避免和新逻辑两套说法并存。
// 光标停在**根**上（没有块）时的归位：按它在根孩子里的位置，落到相邻块的末尾/开头。
// ★ 为什么必须有这一步：打字之后浏览器常把光标挂在编辑区**根**的末尾（文字本身被顶层归一化
//   包进了 <p>，光标却没跟着进去）。这时候插 <br>，节点会落在块**外面** —— 那正是
//   "右边出来裸文本 / 裸行"和"左边按一次 Enter 纹丝不动"的老根因。归位后一律在块内操作。
function toolboxCaretIntoNearBlock(ed, node, offset) {
    if (!ed || !node) return null;
    let idx = -1;
    if (node === ed) idx = offset;
    else if (node.parentNode === ed) idx = Array.prototype.indexOf.call(ed.childNodes, node) + (node.nodeType === 3 ? 0 : 1);
    if (idx < 0) return null;
    const kids = ed.childNodes;
    for (let i = Math.min(idx, kids.length) - 1; i >= 0; i--) {          // 左边最近的块 → 它的末尾
        const c = kids[i];
        if (c.nodeType === 1 && toolboxIsBlockEl(c)) {
            const r = document.createRange();
            try { r.selectNodeContents(c); r.collapse(false); } catch (e) { return null; }
            return r;
        }
    }
    for (let i = Math.max(idx, 0); i < kids.length; i++) {               // 左边没有块 → 右边那个的开头
        const c = kids[i];
        if (c.nodeType === 1 && toolboxIsBlockEl(c)) {
            const r = document.createRange();
            try { r.setStart(c, 0); r.collapse(true); } catch (e) { return null; }
            return r;
        }
    }
    return null;
}
// 编辑区里按 **Shift+Enter**（工具栏「换行」按钮走的是同一个入口 —— 两条路必须完全一致）。
// ★ 用户口径（2024 更正）：**段内分行**只由 Shift+Enter / 「换行」按钮产生；
//   它永远留在当前 `<p>` 里（`<p>甲<br>乙</p>`），**不会**被提升成段落、也不会拆成两个 `<p>`。
//   Enter 是**段落分界**，走 toolboxInsertParagraph。
function toolboxEnterBreak() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    // ★★ IME 第二道兜底：合成期间绝不改结构（Enter 那条 keydown 已经把合成中的 Enter
    //   放行给输入法了；这里再兜一层，防止工具栏「换行」按钮/脚本在合成中被点到）。
    if (toolboxComposing) return false;
    toolboxFocusEditor();
    // ★ 光标停在**空行**上时，Shift+Enter 的语义是"在这一行下面再来一行" —— 再补一根
    //   **根级独立 `<br>`**（空行），光标到它后面。为什么不套用"段内分行"：
    //   空行在编辑器里就是根级 `<br>`，它旁边没有 `<p>` 可待；如果就地造一个 `<p>` 再插段内
    //   `<br>`，就等于把"段落间空行"改写成"段内分行" —— 正是用户明令禁止的**两类 `<br>` 互换**。
    //   这样两根空行、一行不多一行不少，与连按 Enter 得到多个空行也完全一致。
    const blankHere = toolboxBlankLineBrAtCaret();
    if (blankHere && blankHere.parentNode) {
        const nb = document.createElement('br');
        blankHere.parentNode.insertBefore(nb, blankHere.nextSibling);
        try {
            const nr = document.createRange();
            const host = nb.parentNode;
            nr.setStart(host, Array.prototype.indexOf.call(host.childNodes, nb) + 1);
            nr.collapse(true);
            const sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(nr); }
        } catch (e) {}
        toolboxSnapClear();
        toolboxSaveRange();
        toolboxCaretHolderSweep();
        toolboxRefresh();
        toolboxUndoPush(false);
        toolboxKeepFocus();
        return true;
    }
    let r = toolboxLiveRange();
    if (!r) r = toolboxActiveRange();
    if (!r) return false;
    // 光标在根上（没有块）→ 先把裸文本/裸行内节点包成 <p>，再按块处理
    let blk = toolboxTopBlockOf(r.startContainer, ed);
    if (!blk) {
        toolboxWrapStrayTopLevel(ed);
        blk = toolboxTopBlockOf(r.startContainer, ed);
    }
    if (!blk) {
        const nr = toolboxCaretIntoNearBlock(ed, r.startContainer, r.startOffset);
        if (nr) { r = nr; blk = toolboxTopBlockOf(r.startContainer, ed); }
    }
    if (!toolboxInsertBreakNodes(r)) return false;
    toolboxCaretHolderSweep();
    toolboxRefresh();
    toolboxUndoPush(false);
    toolboxKeepFocus();
    return true;
}
function toolboxInsertBreak() {
    if (toolboxEnterBreak()) return;
    toolboxInsertHtml('<br>');              // 兜底：拿不到选区时按老路子插（不改变既有行为）
}

// ========== Enter = 段落分界（新建 `<p>`）==========
// ★ 用户口径：Enter **一定**是段落分界 —— 结束当前 `<p>`，新建一个 `<p>`，光标进新段；
//   段内分行是 Shift+Enter（见 toolboxEnterBreak）。**两类 `<br>` 绝不互换**：
//     · `<p>` 内部的 `<br>` = 段内分行（Shift+Enter 产出，永远留在这一段里）；
//     · `<p>` 之外、与块同级的 `<br>` = 段落之间的空行（连按两次 Enter 产出）。
// ★ 连按两次 Enter = 一个空行：第一次 Enter 分出来的"落脚段"本身就是空的，第二次 Enter
//   时它**升格成一根根级独立 `<br>`**（空行），下面再开一个新的落脚段。
//   于是 `甲 ⏎ ⏎ 乙` = `<p>甲</p>` / `<br>` / `<p>乙</p>`（与用户给的规范样例一致）。
// ★ 光标可见/可点（用户实测 bug）：新段落一律是 `<p><br></p>`，光标放在 (p,0) ——
//   与浏览器原生 Enter 的位置逐字节一致（实测原生回车得到 `<p>哈哈哈</p><p><br></p>`，
//   选区就是 (p,0)），所以插入点能正常画出、鼠标点得进去、接着打字落在该段。
function toolboxInsertParagraph() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    if (toolboxComposing) return false;                    // ★★ IME：合成中的 Enter 是选词确认
    toolboxFocusEditor();
    let r = toolboxLiveRange();
    if (!r) r = toolboxActiveRange();
    if (!r) return false;
    let blk = toolboxTopBlockOf(r.startContainer, ed);
    if (!blk) {
        toolboxWrapStrayTopLevel(ed);
        blk = toolboxTopBlockOf(r.startContainer, ed);
    }
    // ① 光标压根不在任何块里（停在根上/空行上）→ 就地开一个新段，光标进新段
    if (!blk) {
        if (!toolboxParagraphAtRoot(r)) return false;
        toolboxCaretHolderSweep();
        toolboxRefresh();
        toolboxUndoPush(false);
        toolboxKeepFocus();
        return true;
    }
    // ② 光标所在的这一段**本身是空的**（上一次 Enter 分出来的落脚段）→
    //    它自己升格成一根"独立成行的 `<br>`"（空行），下面再开一个新的落脚段。
    //    判据 `>1` 把"刚打开、编辑区只有这一个空段"排除在外：那种情况下 Enter 只是分出
    //    一个新段（不会凭空多出一个空行）。
    const blkCount = ed.querySelectorAll('p,div,center,table,ul,ol,blockquote,pre,h1,h2,h3,h4,h5,h6,img,hr,video').length;
    if (blkCount > 1 && !toolboxBlockHasContent(blk) && String(blk.tagName || '').toUpperCase() === 'P') {
        const blank = document.createElement('br');
        blk.parentNode.insertBefore(blank, blk);
        const np = document.createElement('p');
        np.appendChild(document.createElement('br'));          // 新落脚段的落脚行
        blk.parentNode.insertBefore(np, blk);
        blk.parentNode.removeChild(blk);
        try {
            const nr = document.createRange();
            nr.setStart(np, 0);
            nr.collapse(true);
            const sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(nr); }
        } catch (e) {}
        toolboxCaretHolderSweep();
        toolboxRefresh();
        toolboxUndoPush(false);
        toolboxKeepFocus();
        return true;
    }
    // ③ 普通情况：在光标处把这一段切成两段，光标进新段。
    //    先把"落脚用"的标记节点（data-tb-caret 的 <br>）从切点上请出去 ——
    //    它只是给光标找的落脚点，不该跟着内容搬进新段。
    const nb = toolboxSplitBlockAt(blk, r);
    if (!nb) return false;
    while (nb.firstChild && toolboxIsCaretOrBlankNode(nb.firstChild)) nb.removeChild(nb.firstChild);
    // 前半段被切空了（在段首按 Enter）→ 它自己就是用户留下的一行空白，
    // 就地变一根独立 `<br>`（空行），不能凭空消失（所见 = 代码）。
    if (!toolboxBlockHasContent(blk) && !(blk.querySelector && blk.querySelector('img,table,hr,video'))) {
        const blank = document.createElement('br');
        blk.parentNode.insertBefore(blank, blk);
        blk.parentNode.removeChild(blk);
    }
    // 新段还空着 → 给一根落脚行；光标落在新段**开头**（原生 Enter 的位置）
    const empty = !nb.firstChild;
    if (empty) nb.appendChild(document.createElement('br'));
    try {
        const nr = document.createRange();
        const first = nb.firstChild;
        if (!empty && first && first.nodeType === 3 && String(first.nodeValue || '').length) nr.setStart(first, 0);
        else nr.setStart(nb, 0);
        nr.collapse(true);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(nr); }
    } catch (e) {}
    toolboxSnapClear();
    toolboxSaveRange();
    toolboxCaretHolderSweep();
    toolboxRefresh();
    toolboxUndoPush(false);
    toolboxKeepFocus();
    return true;
}
// "标记节点 / 空文本"：切段时不该搬进新段的东西（落脚 <br>、空文本）。
function toolboxIsCaretOrBlankNode(n) {
    if (!n) return false;
    if (n.nodeType === 3) return !String(n.nodeValue || '').replace(/[\s\u00a0\u200b]+/g, '').length;
    if (n.nodeType !== 1) return false;
    if (n.getAttribute && n.getAttribute(TOOLBOX_CARET_ATTR)) return true;
    return n.tagName === 'BR';
}
// 落脚点补建（光标可见性/命中的兜底）：删字、撤回、程序化改动之后，光标可能又落到
// "块尾那根 <br> 之后"这个**没有行盒**的位置 —— 那正是用户实测"光标看不见、点不着"的现场。
// 只处理两种现场（其余一律不碰）：
//   A. 光标后面紧跟一根**没有标记的 <br>**、而且它之后（忽略空文本）再没有别的东西：
//      这是浏览器在"这一行被删空"时补的占位 `<br>` —— 把**同一根节点**加上标记
//      （它就从"代码里多出来的一根 <br>"变成"光标的落脚点"），行盒留着、代码区不多一行。
//      实测（Chrome 148）：`<p>哈哈哈<br>Z</p>` 里把 Z 删掉，浏览器会留下
//      `<p>哈哈哈<br><br></p>` —— 不处理的话代码区就凭空多出一根 <br>；
//   B. 光标停在**块尾**（后面什么都没有）且前面紧邻一根软换行 <br>：
//      补一根带标记的 <br>（与 Shift+Enter 之后的状态完全一致），序列化时摘掉。
// 前置条件：光标折叠、在编辑区里、所在块**有内容**（空段落壳本身就有行盒，绝不能碰，
// 否则空段会凭空多一行）、且整个编辑区里还没有落脚标记。
function toolboxCaretSupportSync() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || toolboxComposing) return 0;
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    if (!r.collapsed || !ed.contains(r.startContainer)) return 0;
    const blk = toolboxTopBlockOf(r.startContainer, ed);
    if (!blk || !toolboxBlockHasContent(blk)) return 0;
    if (ed.querySelector('[' + TOOLBOX_CARET_ATTR + ']')) return 0;
    // 光标之后（同一块内）还剩什么？跳过空文本；标记节点不该出现在这里。
    const c0 = r.startContainer;
    let tail = null;
    if (c0.nodeType === 1) tail = c0.childNodes[r.startOffset] || null;
    else if (c0.nodeType === 3) {
        if (r.startOffset < String(c0.nodeValue || '').length) tail = c0;   // 同一个文本节点里后面还有字
        else tail = c0.nextSibling;
    }
    let after = null;
    for (let n = tail; n; n = n.nextSibling) {
        if (n.nodeType === 3 && !String(n.nodeValue || '').replace(/[\s\u00a0\u200b]+/g, '').length) continue;
        after = n; break;
    }
    const isBr = function (n) { return !!(n && n.nodeType === 1 && n.tagName === 'BR'); };
    // —— A. 后面只剩一根"没有标记的 <br>"（浏览器补的占位行）→ 就地把它变成落脚点 ——
    if (isBr(after) && !(after.getAttribute && after.getAttribute(TOOLBOX_CARET_ATTR))) {
        let more = null;
        for (let n = after.nextSibling; n; n = n.nextSibling) {
            if (n.nodeType === 3 && !String(n.nodeValue || '').replace(/[\s\u00a0\u200b]+/g, '').length) continue;
            more = n; break;
        }
        if (!more) {
            after.setAttribute(TOOLBOX_CARET_ATTR, '1');
            toolboxSaveRange();
            return 1;
        }
        return 0;
    }
    if (after) return 0;                                    // 后面还有别的东西 → 不需要落脚点
    if (toolboxContentAfterCaret(r)) return 0;              // 双保险（文本/图片等实义内容）
    // —— B. 光标就在块尾：前面紧邻的必须是一根**软换行** <br> ——
    let prev = null;
    if (c0.nodeType === 1) prev = c0.childNodes[r.startOffset - 1] || null;
    else if (c0.nodeType === 3 && r.startOffset === 0) prev = c0.previousSibling;
    if (!isBr(prev) || (prev.getAttribute && prev.getAttribute(TOOLBOX_CARET_ATTR))) return 0;
    const mark = toolboxCaretHolderMake();
    try { r.insertNode(mark); } catch (e) { return 0; }
    try {
        const nr = document.createRange();
        nr.setStart(mark.parentNode, Array.prototype.indexOf.call(mark.parentNode.childNodes, mark));
        nr.collapse(true);
        sel.removeAllRanges(); sel.addRange(nr);
        toolboxSaveRange();
    } catch (e) {}
    return 1;
}
// 段间退格（用户口径：两类 `<br>` 的退格行为都要正确）：
//   光标在某段**最开头**、它前面又是一个"独立成行的空行 `<br>`"时，**只删掉那根空行**，
//   两段就此直接相接（`</p><p>`）；**绝不让浏览器把整段吞掉**。
// ★ 为什么必须自己拦：实测（Chrome 148 headless）在 `<p>甲</p>` / `<br>` / `<p>乙</p>` 里
//   把光标放到"乙"段开头按退格，浏览器默认会把这**整段删掉**（乙没了）并多留一个空行 ——
//   用户实测的"按退格丢字"就是这么来的。拦下来之后：第一次退格删空行、第二次退格才由浏览器
//   把两段合并（这一步是正常的、不丢字）。
function toolboxBackspaceBlankLine() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    const r = toolboxLiveRange() || toolboxActiveRange();
    if (!r || !r.collapsed) return false;
    const blk = toolboxTopBlockOf(r.startContainer, ed);
    if (!blk) return false;
    // 光标在这段的**最开头**吗（光标之前没有任何实义内容）？
    let head = null;
    try {
        head = document.createRange();
        head.selectNodeContents(blk);
        head.setEnd(r.startContainer, r.startOffset);
    } catch (e) { return false; }
    if (!head.collapsed) {
        let frag = null;
        try { frag = head.cloneContents(); } catch (e) { return false; }
        if (String(frag.textContent || '').replace(/[\s\u00a0\u200b]+/g, '').length) return false;
        if (frag.querySelector && frag.querySelector('img,table,hr,video,input')) return false;
    }
    const prev = blk.previousSibling;
    if (!prev || prev.nodeType !== 1 || prev.tagName !== 'BR') return false;
    ed.removeChild(prev);                       // 空行没了 ⇒ 两段直接相接
    toolboxSnapClear();
    toolboxSaveRange();
    toolboxCaretHolderSweep();
    toolboxRefresh();
    toolboxUndoPush(false);
    toolboxKeepFocus();
    return true;
}
// 光标停在**根**上（照片/空行之间，不在任何块里）时按 Enter：就地开一个新段。
//   位置：紧跟光标前面那个根级空行 `<br>`（如果有）之后 —— 这样"在空行上回车"
//   得到的是 `<p>甲</p>` / `<br>` / `<p><br></p>`，光标在最后一个段里，顺序不乱。
function toolboxParagraphAtRoot(r) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    const np = document.createElement('p');
    np.appendChild(document.createElement('br'));
    let at = null;
    if (r.startContainer === ed) {
        at = ed.childNodes[r.startOffset] || null;
    } else if (r.startContainer.parentNode === ed) {
        at = r.startContainer.nextSibling;
    }
    ed.insertBefore(np, at);
    try {
        const nr = document.createRange();
        nr.setStart(np, 0);
        nr.collapse(true);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(nr); }
    } catch (e) {}
    toolboxSnapClear();
    toolboxSaveRange();
    return true;
}

// ========== 并排图片（多张一行）==========
// 语料里唯一的多图写法在 notecollection/readmes/2nd_Series_RMB_Secret_Marks_Summary.html：
//   <div style="display:flex; justify-content:center; gap:20px; flex-wrap:wrap; margin:10px 0;">
//     <div style="text-align:center; height:180px; display:flex; align-items:center; justify-content:center;">
//       <img src="readmes/image/…" style="max-height:100%; max-width:100%; object-fit:contain;">
//     </div>
//     …
//   </div>
//   <div style="text-align:center; color:#555555; font-size:0.85rem; margin-bottom:15px;">图注</div>
// 67 篇里没有"一行两张图"、也没有把图放进 <td> 的写法，所以并排就照这一套来。
//
// ★ 容器上那两条 width:80% / margin:10px auto 是**有意加**的，别当多余样式删掉：
//   单张图的默认宽度就是 width="80%"，用户要求"并排那一行的总宽也跟单图默认一致"，
//   所以整行宽度也钉在 80%；宽度不满时靠 margin:10px auto 保持居中。
//   （语料原本是 margin:10px 0 —— 那是"容器自己就差不多占满"的写法，加了定宽就必须改 auto。）
const TOOLBOX_FLEX_STYLE = 'display:flex; justify-content:center; gap:20px; flex-wrap:wrap; margin:10px auto; width:80%;';
const TOOLBOX_FLEX_GAP = 20;          // 与容器 gap 一致，同宽度模式的 calc() 要用到
const TOOLBOX_FLEX_ITEM_STYLE = 'text-align:center; height:180px; display:flex; align-items:center; justify-content:center;';
// 同高度模式下"统一高度"的默认值 180px：同上面那个语料文件里的 height:180px
const TOOLBOX_STACK_HEIGHT = 180;
const TOOLBOX_MAX_STACK = 4;          // 一行最多几张（用户要求 2~4）

function toolboxStackRowHtml(imgs, mode, size, sharedCaption) {
    const n = imgs.length;
    const centerBlock = (mode === 'width');
    const itemStyle = centerBlock
        ? 'text-align:center; display:flex; align-items:center; justify-content:center;'
        : TOOLBOX_FLEX_ITEM_STYLE;
    // ★ 默认"整行共用一条图注"，这比每张图各来一条更贴近实际用法。
    //   共用图注放在 flex 容器**后面**（整行居中），不放进容器里 —— 放进去会变成
    //   flex 的第 n+1 个子项，被 justify-content 摆到某张图旁边去。
    //   只有勾了「每张图各自一条图注」才给每张图套 text-align:center 的子 div。
    const perImage = imgs.some(function (im) { return !!im.caption; });
    let html = '<div style="' + TOOLBOX_FLEX_STYLE + '">\n';
    for (let i = 0; i < n; i++) {
        const im = imgs[i];
        let imgStyle;
        if (centerBlock) {
            // 同宽度：n 张等宽，宽度 =（总宽 - (n-1) 个间隙）/ n —— 加起来正好铺满那 80%。
            // 20px 与容器的 gap 是同一个值（改 gap 记得一起改 TOOLBOX_FLEX_GAP）。
            imgStyle = (size === 'calc')
                ? 'width:calc((100% - ' + ((n - 1) * TOOLBOX_FLEX_GAP) + 'px) / ' + n + '); height:auto;'
                : 'width:' + size + '; height:auto;';
        } else {
            // 同高度：每张按同一高度缩放，宽度自适应
            imgStyle = 'height:' + size + '; width:auto; max-width:100%;';
        }
        const img = '<img src="' + toolboxEsc(im.src) + '" style="' + imgStyle + '">';
        if (perImage) {
            html += '  <div style="' + itemStyle + '">\n';
            html += '    ' + img + '\n';
            if (im.caption) {
                html += '    <span style="display:block; color:' + TOOLBOX_SMALL_COLOR + '; font-size:'
                    + TOOLBOX_SMALL_SIZE + '; margin-top:4px;">' + toolboxEsc(im.caption) + '</span>\n';
            }
            html += '  </div>\n';
        } else {
            html += '  ' + img + '\n';
        }
    }
    html += '</div>';
    if (sharedCaption) html += '\n' + toolboxCaptionHtml(sharedCaption);
    return html;
}

function toolboxStackRow(imgs, mode, size, sharedCaption) {
    return toolboxStackRowHtml(imgs, mode, size, sharedCaption);
}

// ========== 表格 ==========
// 表体缩进。语料里的缩进并不统一（4 空格/8 空格都有），这里统一 8 空格：
// 正好是 code 区两级缩进，复制出来整齐。
function toolboxTableRowHtml(cells, isHeader) {
    const tag = isHeader ? 'th' : 'td';
    const style = isHeader ? TOOLBOX_TABLE_HEAD_STYLE : (TOOLBOX_TABLE_CELL_STYLE + 'text-align:center;');
    let s = '        <tr>';
    for (let i = 0; i < cells.length; i++) {
        s += '<' + tag + ' style="' + style + '">' + toolboxEsc(cells[i]) + '</' + tag + '>';
    }
    return s + '</tr>';
}

// 生成一整张表。hasHeader=true 时第一行进 <thead> 用 <th>；否则全部进 <tbody>。
// ★ 透明背景：表头只加 background:var(--bg)，**绝不**写 #f5f7fa/#fafbfc 这类写死的
//   浅色底 —— 那种在暗色模式下正文（浅色字）压上去会看不清。
function toolboxBuildTable(rows, cols, hasHeader, data) {
    const r = Math.max(1, Math.min(60, parseInt(rows, 10) || 1));
    const c = Math.max(1, Math.min(20, parseInt(cols, 10) || 1));
    const head = !!hasHeader;
    const bodyStart = head ? 1 : 0;
    let html = '<div style="overflow-x:auto;margin:1rem 0;">\n';
    html += '  <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">\n';
    if (head) {
        html += '    <thead>\n';
        html += toolboxTableRowHtml(toolboxPickCells(data, 0, c), true) + '\n';
        html += '    </thead>\n';
    }
    html += '    <tbody>\n';
    for (let i = bodyStart; i < r; i++) {
        html += toolboxTableRowHtml(toolboxPickCells(data, i, c), false) + '\n';
    }
    html += '    </tbody>\n';
    html += '  </table>\n';
    html += '</div>';
    return html;
}

// 取第 row 行的单元格文字：有粘贴数据就用粘贴的（自动转表时），否则给占位文字。
function toolboxPickCells(data, row, cols) {
    const out = [];
    const src = (data && data[row]) ? data[row] : null;
    for (let i = 0; i < cols; i++) {
        let v = (src && src[i] != null) ? String(src[i]) : '';
        // 单元格里的换行在 HTML 里没意义，压成空格
        v = v.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!v) v = (row === 0) ? ('列' + (i + 1)) : '内容';
        out.push(v);
    }
    return out;
}

// ========== 粘贴 ==========
// 两条路，**必须是两套规则**，别把它们合并：
//   ① 正文区：一律当**纯文本**。粘贴来的加粗/背景色/字号/颜色/class 全部丢掉，
//      只把换行转成 <br>（语料里 <br> 有 341 处，是站内主流写法）。
//      唯一的例外见 toolboxPasteHandler：整张表格（Excel / 网页 / TSV）还是转成 HTML 表格，
//      否则"把表格粘进来"这条既有功能就废了。
//   ② 代码区：原样保留 HTML —— "把现成文章的 HTML 导入进来"这条功能全靠它。
//
// 换行统一：CRLF / CR / U+2028 / U+2029 → `\n`。
// ★ 剪贴板里的换行有四五种写法：Windows 复制是 `\r\n`，某些网页与 PDF 用 U+2028（行分隔）
//   / U+2029（段分隔），老 Mac 是单个 `\r`。不统一的话，后面所有"按行/按空行"的判断都会漏。
function toolboxNormalizeNewlines(text) {
    return String(text == null ? '' : text)
        .replace(/\r\n?/g, '\n')
        .replace(/[\u2028\u2029]/g, '\n');
}

// 纯文本 → HTML：只做转义 + 换行换 <br>，别的什么都不加。
function toolboxPlainTextHtml(text) {
    const t = toolboxNormalizeNewlines(text);
    const parts = t.split('\n');
    let html = '';
    for (let i = 0; i < parts.length; i++) {
        if (i) html += '<br>';
        if (parts[i]) html += toolboxEscText(parts[i]);
    }
    return html;
}

// 只有 HTML 的剪贴板（从网页复制的富文本，且没带 text/plain）→ 纯文本。
// ★ 为什么需要它（用户实测 bug 2 的同族缺口）：旧代码是把标签直接换成**空格**
//   （`html.replace(/<[^>]*>/g, ' ')`），于是 `<p>甲</p><p>乙</p>` 变成"甲 乙"——
//   段落边界整个消失，粘进来只能是一个 <p>。这里先把**块级边界换成换行**再剥标签：
//   `</p>` / `</div>` / `<br>` 各自成行，段与段之间补一个空行，于是"空行 = 段落分界"
//   这条路照样能接上。
function toolboxHtmlToPlainLines(html) {
    let h = String(html || '');
    h = h.replace(/<(script|style|meta|link|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    h = h.replace(/<br\s*\/?>/gi, '\n');
    h = h.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|td|th)\s*>/gi, '\n\n');
    h = h.replace(/<[^>]*>/g, '');
    h = h.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&');
    h = toolboxNormalizeNewlines(h);
    return h.replace(/[^\S\n\r]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
}

// 纯文本 → **段落数组**（每段已经转义、段内换行已经转成 <br>）。
// 用户口径（与手敲 Enter 完全同一套规则）：
//   · **空行 = 段落分界** → 拆成两段（连续多个空行只算一次分界，不产生空段）；
//   · **段内单个换行 = 行内换行** → `<br>`；
//   · 首尾空行不产生空的 <p>（"无多余空块/空行"）。
function toolboxPlainTextParas(text) {
    // ★ 换行/行分隔符先统一：`\r\n`、`\r`（Windows / 老 Mac 剪贴板）、U+2028 / U+2029
    //   （某些网页、PDF 复制出来的"段落分隔符"）一律当成普通换行。
    const t = toolboxNormalizeNewlines(text);
    // ★ 用**捕获分隔符**切分：奇数位就是"段与段之间的那一坨换行"。
    //   分隔符里有 n 个 \n ⇒ 中间夹了 n-1 个**空行**。这与用户手敲的规则完全一致：
    //   一次 Enter 是段内 `<br>`（不切段），两次 Enter 才留出一个空行 ——
    //   而空行在编辑器里就是一个"独立成行的 `<br>`"（见 toolboxInsertParagraph）。
    //   所以粘贴里的空行也照这个来：段与段之间补上同样数量的独立 <br>，
    //   粘进来的排版与"自己一行一行敲出来"逐字一致。
    // ★★ 空行里的"空白"必须用 `[^\S\n\r]`（= 除换行以外的所有空白）判定，不能用 `[ \t\u00a0]`：
    //   用户实测 bug 2 —— 从网页/文档里复制出来的空行常常是全角空格 U+3000、制表符、
    //   U+00A0，或者整篇是 CRLF；旧的窄字符集一个都不认，于是"空行分段"这条路被整条跳过，
    //   三段正文被塞进同一个 <p>、段间只剩 `<br><br>`。
    //   又不能直接用 `\s`：它会把换行本身也吃掉，空行数（blanks）就数错了。
    const parts = t.split(/(\n[^\S\n\r]*\n+)/);
    const out = [];
    for (let i = 0; i < parts.length; i += 2) {
        const seg = parts[i].replace(/^[^\S\n\r]+/, '').replace(/[^\S\n\r]+$/, '');
        // ★ 这个段**前面**那一坨分隔符在 parts[i-1]（i 是偶数，说明 i-1 是捕获到的分隔符）
        const sepBefore = (i > 0) ? (parts[i - 1] || '') : '';
        const blanks = sepBefore ? Math.max(0, (sepBefore.match(/\n/g) || []).length - 1) : 0;
        if (!seg) continue;                        // 首尾的空行不产生段落，也不留空行
        const lines = seg.split('\n');
        let h = '';
        for (let k = 0; k < lines.length; k++) {
            if (k) h += '<br>';
            if (lines[k]) h += toolboxEscText(lines[k]);
        }
        out.push({ html: h, blanksBefore: out.length ? blanks : 0 });
    }
    return out;
}

// 正文区粘贴：**一律纯文本**。
//
// ★ 这里以前有一条"剪贴板里有 <table> 就自动转成 HTML 表格"的分支，用户实测后作废：
//   复制"一段文字 + 一张表格"粘进来，只剩表格、文字全丢（bug 2）—— 因为它只认表格那一部分。
//   现在的规则（用户明确要的默认行为）：
//     · 只取 text/plain，换行 → <br>，颜色/字号/加粗/class/图片**一个不留**；
//     · 剪贴板里有什么都不例外（含表格、含图片、含样式）：绝不"只取其中一部分"；
//     · 要表格就用工具栏「表格」按钮插入，或把 HTML 粘到**代码区**（那条路照样保留 HTML）。
//
// ★ 落点用 **paste 事件当下的实时选区**（toolboxLiveRange），不用缓存 Range：
//   用户在段中间按 Ctrl+V，内容却跑到文章最末尾，根因就是拿了过期的缓存 Range。
//   只有在编辑区里实在取不到选区时，才退到"编辑区末尾"——这是最后兜底，不是默认路径。
function toolboxPasteHandler(e) {
    const dt = e.clipboardData;
    if (!dt) return;                     // 拿不到剪贴板信息就完全不动默认行为
    let html = '';
    try { html = dt.getData('text/html') || ''; } catch (e1) { html = ''; }
    let text = '';
    try { text = dt.getData('text/plain') || ''; } catch (e2) { text = ''; }

    // 剪贴板里一个字都没有（贴的是图片/文件）：不让浏览器把图片塞进正文
    // （正文里的图片走工具栏「图片」按钮，这样才能控制 width/caption 的写法）。
    if (!text && !html) {
        e.preventDefault();
        toolboxToast('剪贴板里没有文字（贴图片请用工具栏「图片」）');
        return;
    }

    e.preventDefault();
    // ★★ IME 守卫之六：合成还没结束就来了 paste（现实中浏览器总是先 compositionend 再 paste，
    //   这里纯粹是兜底）：**绝不在合成中改 DOM** —— 原样记住这次粘贴，等合成结束那一帧再重放。
    if (toolboxComposing) {
        toolboxComposingFlush = true;
        toolboxComposingPending = function () { toolboxPastePlain(text, html); };
        return;
    }
    toolboxPastePlain(text, html);
}
// 粘贴的**实际执行**部分（与 IME 无关，单独抽出来是为了"合成中推迟重放"那条路能复用它）。
// ★ 先取实时选区，再动 DOM —— 顺序不能反：清空编辑区/删选区之后现场就没了
function toolboxPastePlain(text, html) {
    if (toolboxEditorEmpty()) {
        // ★ 清空（而不是塞一个 <p><br></p> 占位）：否则导出的正文开头会多一个空段落
        toolboxTpl.editor.innerHTML = '';
        toolboxRange = null;
    }
    toolboxSnapClear();                  // 粘贴用"现场"位置，不用工具栏那份快照
    // ★★ 顺序不能反（用户实测 bug 1 的同族缺口）：**先**把落点物化（光标停在空行上、
    //   或在空行下面那一段的开头时，就地把它变成一个空的 <p>），**再**取实时选区。
    //   反过来取到的还是"物化前"那个飘在空行旁/落在下一段里的 Range，
    //   于是粘进来的第一段会跟下一段的字黏在一起、物化出来的空段落反而被丢掉。
    toolboxBlankLineCaretHost();
    const live = toolboxLiveRange();
    toolboxDeleteSelection(live || toolboxActiveRange());
    // 只有 HTML（比如从网页复制带样式的一段）：把块级边界换成换行再剥标签，
    // 段落边界不会像"换成空格"那样被吃掉（见 toolboxHtmlToPlainLines）。
    const src = text || toolboxHtmlToPlainLines(html);
    // ★ 第三个参数 = 真：粘贴之后把编辑区根下面的裸文本/裸行内节点合成 <p>
    //   （用户实测 bug：空编辑区粘「示例文字」，代码区出来的是裸文字，不是 <p>示例文字</p>）。
    //   换行策略一个字没改：多行粘贴仍然是 `<br>` 分隔，只是整段落进同一个 <p> 里。
    //
    // ★★ 段落口径（用户明确期待）：**粘贴里出现空行 = 段落分界 → 每段一个 `<p>`**；
    //   段内单个换行仍旧是 `<br>`。用户那份三段原文（段间各一个空行）必须出来 3 个 `<p>`；
    //   光标在段中间时"就地拆开"：前半段 + 第一段接在一起，后面的段各自成块，
    //   后半段接在最后一段后面（一个字不丢、顺序不变）。
    // ★ 判据从"正则里有没有空行"改成"解析出来是不是超过一段"：空行里的空白种类很多
    //   （全角空格 / 制表符 / U+00A0 / CRLF），交给 toolboxPlainTextParas 一处判定，
    //   两边口径不会再分叉（用户实测 bug 2 就是这里漏掉的）。
    const paras = toolboxPlainTextParas(src);
    const at = live || toolboxLiveRange();
    if (paras.length > 1) {
        toolboxPasteParagraphs(paras, at);
        return;
    }
    const plain = toolboxPlainTextHtml(src);
    if (plain) toolboxInsertHtml(plain, at, true);
}

// 多段粘贴：**每段一个 `<p>`**（用户规范写法）。光标在段中间时就地拆开：
//   前半段 + 第一段接在一起 → 后面的段各自成块 → 后半段接在最后一段后面。
// ★ 只在"粘贴内容里确实有空行"时才走这条路；没有空行的普通多行粘贴一个字都不改
//   （仍旧是同一块里的几个 `<br>`，既有用例靠它）。
function toolboxPasteParagraphs(paras, live) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !paras || !paras.length) return false;
    const makeP = function (it) {
        const p = document.createElement('p');
        if (it && it.html) p.innerHTML = it.html;
        return p;
    };
    // 段与段之间的"空行"：按用户手敲的规则插**独立成行的 <br>**（几个空行就几根）
    const blanksOf = function (it) { return (it && it.blanksBefore > 0) ? it.blanksBefore : 0; };
    const makeBlanks = function (n) {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < n; i++) frag.appendChild(document.createElement('br'));
        return frag;
    };
    const moveInto = function (target, src) { while (src.firstChild) target.appendChild(src.firstChild); };
    let r = (live && live.startContainer && ed.contains(live.startContainer)) ? live : toolboxLiveRange();
    let blk = r ? toolboxTopBlockOf(r.startContainer, ed) : null;
    if (!blk) {                                  // 光标在根上 → 先把裸文本/裸行内节点包成块
        toolboxWrapStrayTopLevel(ed);
        blk = r ? toolboxTopBlockOf(r.startContainer, ed) : null;
    }
    if (!blk && r) {                             // 还挂在根末尾 → 归到相邻块里（与 Enter 同一条规矩）
        const nr = toolboxCaretIntoNearBlock(ed, r.startContainer, r.startOffset);
        if (nr) { r = nr; blk = toolboxTopBlockOf(r.startContainer, ed); }
    }
    let caretHost = null;
    if (!blk) {
        // 空编辑区 / 根上没有块：一段一个 <p>（段间按粘贴里的空行补独立 <br>），整批插进去
        const frag = document.createDocumentFragment();
        for (let i = 0; i < paras.length; i++) {
            if (i) frag.appendChild(makeBlanks(blanksOf(paras[i])));
            frag.appendChild(makeP(paras[i]));
        }
        let done = false;
        if (r && ed.contains(r.startContainer)) {
            try { if (!r.collapsed) r.deleteContents(); } catch (e) {}
            try { r.insertNode(frag); done = true; } catch (e) { done = false; }
        }
        if (!done) { while (frag.firstChild) ed.appendChild(frag.firstChild); }
        caretHost = ed.lastElementChild;
    } else {
        const head = blk;
        const tail = toolboxSplitBlockAt(head, r);
        if (!toolboxBlockHasContent(head)) {                  // 前半段本来是空壳（<p><br></p>）→ 清掉
            while (head.firstChild) head.removeChild(head.firstChild);
        }
        moveInto(head, makeP(paras[0]));                      // 第一段接在当前这一行后面
        let last = head;
        for (let i = 1; i < paras.length; i++) {
            const p = makeP(paras[i]);
            head.parentNode.insertBefore(p, tail || head.nextSibling);
            // ★ 段间空行 = 独立 <br>，插在新段**前面**（顺序：上一段 / 空行 / 这一段）
            for (let b = 0; b < blanksOf(paras[i]); b++) head.parentNode.insertBefore(document.createElement('br'), p);
            last = p;
        }
        if (tail) {
            const tailHasBlock = !!(tail.querySelector
                && tail.querySelector('p,div,center,table,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,hr'));
            if (!toolboxBlockHasContent(tail)) {
                tail.parentNode.removeChild(tail);             // 光标本来就在段尾：不留空壳
            } else if (tailHasBlock) {
                last = tail;                                   // 后半段自己就是块结构：自成一段
            } else {
                moveInto(last, tail);                          // 后半段的文字接在最后一段后面
                tail.parentNode.removeChild(tail);
            }
        }
        caretHost = last;
    }
    if (caretHost) {
        try {
            const nr = document.createRange();
            nr.selectNodeContents(caretHost);
            nr.collapse(false);
            const sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(nr); }
        } catch (e) {}
    }
    toolboxSnapClear();
    toolboxCaretHolderSweep();
    toolboxRefresh();
    toolboxUndoPush(false);
    toolboxKeepFocus();
    return true;
}

// 代码区粘贴：剪贴板里有 HTML 就用 HTML（导入现成文章靠它），
// 没有才用纯文本（代码区本来就是 textarea，默认粘贴给的就是 text/plain）。
// ★ 只在"纯文本里没有标签、HTML 里明显有标签"时才改用 HTML ——
//   用户从编辑器里复制一段 HTML 源码过来时，text/plain 就是那份源码，直接用它最保险。
function toolboxCodePasteHandler(e) {
    const dt = e.clipboardData;
    if (!dt) return;
    let html = '', text = '';
    try { html = dt.getData('text/html') || ''; } catch (e1) { html = ''; }
    try { text = dt.getData('text/plain') || ''; } catch (e2) { text = ''; }
    if (!html || text.indexOf('<') >= 0) return;          // 走默认（纯文本即源码）
    if (html.indexOf('<') < 0) return;
    const ins = toolboxClipboardHtmlToSource(html);
    if (!ins) return;
    e.preventDefault();
    const el = toolboxTpl.code;
    const start = el.selectionStart == null ? el.value.length : el.selectionStart;
    const end = el.selectionEnd == null ? el.value.length : el.selectionEnd;
    el.value = el.value.slice(0, start) + ins + el.value.slice(end);
    const at = start + ins.length;
    try { el.setSelectionRange(at, at); } catch (e3) {}
    toolboxSyncBusy = true;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    toolboxSyncBusy = false;
    toolboxValidate();
    toolboxScheduleCodeToEditor();
    toolboxScheduleDraftSave();
    toolboxUndoSoon();
}

// 从"网页形态"的 HTML 里提取正文片段：去掉 <html>/<head>/<style> 这些壳，
// 拿到 body 里第一层实际内容。用于代码区粘贴富文本。
function toolboxClipboardHtmlToSource(html) {
    const s = String(html || '');
    if (!s) return '';
    let body = s;
    const m = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (m) body = m[1];
    body = body.replace(/<(script|style|meta|link|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    return body.replace(/^\s+|\s+$/g, '');
}

// 拖进正文区：
//   · 拖的是**纯文本**（选一段文字拖过来）→ 按纯文本插入（换行成 <br>，样式全丢）；
//   · 拖的是 **.html 文件**（现成文章的源码）→ 原样导入 HTML（这条是"导入"路径，不能被纯文本化）；
//   · .txt 等其它文本文件 → 按纯文本；
//   · 其它（图片文件之类）→ 不拦，交回浏览器。
function toolboxDropHandler(e) {
    const dt = e.dataTransfer;
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!dt || !ed) return;
    let files = dt.files;
    let text = '';
    try { text = dt.getData('text/plain') || ''; } catch (e1) { text = ''; }

    if (files && files.length) {
        const f = files[0];
        if (!/\.(html?|txt|text)$/i.test(f.name || '')) return;      // 图片等：不拦
        e.preventDefault();
        const isHtml = /\.html?$/i.test(f.name || '');
        const insert = function (src) {
            toolboxSnapClear();
            if (isHtml) {
                // 现成文章的 HTML：原样插进去（净化留给导出那一步，见 toolboxCleanHtml）
                if (!String(src).replace(/\s+/g, '')) return;
                ed.innerHTML = '';
                toolboxRange = null;
                toolboxDeleteSelection();
                toolboxInsertHtml(src);
                toolboxToast('已导入 ' + f.name);
                return;
            }
            toolboxDeleteSelection();
            const plain = toolboxPlainTextHtml(src);
            if (plain) toolboxInsertHtml(plain);
        };
        try {
            const fr = new FileReader();
            fr.onload = function () { insert(String(fr.result || '')); };
            fr.readAsText(f);
        } catch (e2) { /* 读不了就什么都不做 */ }
        return;
    }
    if (!text) return;
    e.preventDefault();
    toolboxSnapClear();
    toolboxDeleteSelection();
    const plain = toolboxPlainTextHtml(text);
    if (plain) toolboxInsertHtml(plain);
}

function toolboxTableCols(table) {
    let n = 0;
    for (let i = 0; i < table.length; i++) n = Math.max(n, table[i].length);
    return n;
}

// 解析 HTML 里的第一张 <table>。用 DOMParser 而不是正则：Excel 的剪贴板 HTML 里
// 标签大小写、引号、嵌套都很随意，正则一定会漏。
function toolboxPickPastedTable(html) {
    let doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
    if (!doc) return null;
    const t = doc.querySelector('table');
    if (!t) return null;
    const rows = t.querySelectorAll('tr');
    if (!rows.length) return null;
    const out = [];
    for (let i = 0; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll('th,td');
        if (!cells.length) continue;
        const line = [];
        for (let k = 0; k < cells.length; k++) {
            const span = Math.max(1, parseInt(cells[k].getAttribute('colspan') || '1', 10) || 1);
            const v = toolboxCellText(cells[k]);
            line.push(v);
            // 合并单元格在"纯内联样式的表格"里没法表达，展开成多个同样的格子，
            // 至少不会让整行列数错位（生成器只输出规则表格）。
            for (let s = 1; s < span; s++) line.push(v);
        }
        out.push(line);
    }
    if (!out.length) return null;
    const cols = toolboxTableCols(out);
    for (let i = 0; i < out.length; i++) while (out[i].length < cols) out[i].push('');
    return out;
}

// 单元格取文字：块级子元素之间补空格，否则 "<div>甲</div><div>乙</div>" 会拼成 "甲乙"
function toolboxCellText(cell) {
    const parts = [];
    const blocks = cell.querySelectorAll('p,div,li,br');
    if (blocks.length) {
        for (let i = 0; i < blocks.length; i++) parts.push(blocks[i].textContent || ' ');
    } else {
        parts.push(cell.textContent || '');
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// 纯文本 → 表格。只要"多行 + 至少两列（Tab 分隔）"就认定是表格：
// Excel 复制到纯文本时用 Tab 分列、换行分行，网页拷表格也常这样。
// ★ 不做"逗号也当分隔符"：中文正文里逗号太常见，那样会把普通段落误判成表格。
function toolboxPickTextTable(text) {
    if (!text || text.indexOf('\t') < 0) return null;
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '' && !rows.length) continue;          // 忽略开头的空行
        rows.push(lines[i].split('\t').map(function (c) { return c.replace(/\s+/g, ' ').trim(); }));
    }
    while (rows.length && rows[rows.length - 1].every(function (c) { return c === ''; })) rows.pop();
    if (!rows.length) return null;
    const cols = toolboxTableCols(rows);
    if (cols < 2) return null;                                  // 只有一列 → 普通文字，不是表格
    for (let i = 0; i < rows.length; i++) while (rows[i].length < cols) rows[i].push('');
    return rows;
}

// ========== 复制 / 下载 ==========
function toolboxToast(msg) {
    if (!toolboxTpl || !toolboxTpl.toast) return;
    const el = toolboxTpl.toast;
    el.textContent = msg;
    el.classList.add('show');
    if (toolboxToastTimer) clearTimeout(toolboxToastTimer);
    toolboxToastTimer = setTimeout(function () {
        toolboxToastTimer = 0;
        el.classList.remove('show');
    }, 2400);
}

// 复制 HTML 到剪贴板。
// ★ 必须有 execCommand('copy') 兜底：navigator.clipboard 在非安全上下文（http、file://）
//   或权限被拒时直接抛错 —— 而本站既能 http 本地跑，也能 file:// 直接打开。
function toolboxCopyHtml() {
    if (!toolboxTpl || !toolboxTpl.code) return false;
    const text = toolboxTpl.code.value || '';
    const done = function () { toolboxToast('HTML 已复制到剪贴板'); return true; };
    const fallback = function () {
        let ok = false;
        // ★ 这个兜底会临时往 body 里塞一个 textarea 再删掉 —— 焦点会因此掉到 body 上。
        //   所以两种情况都要把焦点还回去：复制成功后还回原来的地方（通常是编辑区），
        //   让用户接着打字、也让弹窗上的快捷键/Esc 仍然有效。
        const back = document.activeElement;
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', 'readonly');
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
            document.body.appendChild(ta);
            ta.select();
            try { ta.setSelectionRange(0, ta.value.length); } catch (e) {}
            ok = document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (e) { ok = false; }
        try {
            if (back && back.focus && document.contains(back)) back.focus();
            else if (toolboxTpl && toolboxTpl.editor) toolboxTpl.editor.focus();
        } catch (e) { /* 焦点回不去也不影响复制本身 */ }
        if (ok) return done();
        toolboxToast('复制失败：请手动选中代码后按 Ctrl+C');
        return false;
    };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(function () { done(); }, function () { fallback(); });
            return true;
        }
    } catch (e) { /* 落到下面的兜底 */ }
    return fallback();
}

function toolboxDownloadHtml() {
    if (!toolboxTpl || !toolboxTpl.code) return false;
    const text = toolboxTpl.code.value || '';
    let url = '';
    try {
        const blob = new Blob([text], { type: 'text/html;charset=utf-8' });
        url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = toolboxFileName();
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        const name = a.download;
        setTimeout(function () {
            try { if (a.parentNode) a.parentNode.removeChild(a); } catch (e) {}
            try { URL.revokeObjectURL(url); } catch (e) {}
        }, 0);
        toolboxToast('已开始下载 ' + name);
        return true;
    } catch (e) {
        if (url) { try { URL.revokeObjectURL(url); } catch (e2) {} }
        toolboxToast('下载失败：' + ((e && e.message) ? e.message : '未知错误'));
        return false;
    }
}

// 下载文件名：由左上角那一段"标题栏上的文字"决定。
//   · 去掉 Windows 非法字符 / \ : * ? " < > | ，去掉首尾空白；
//   · 用户那段只当**名字**：已有的 .html / .htm 后缀先去掉再加 .html（abc.htm → abc.html），
//     所以永远不会出现 abc.html.html；别的扩展名（report.txt / report.final.v2）原样保留；
//   · 空的、清洗完没剩下东西的，一律回落到 Untitled.html。
// ★ 这一段的**默认值是真实文本 Untitled**（index.html 的 value="Untitled"，不是 placeholder），
//   于是下载名字 = "Untitled" + ".html" = Untitled.html —— 与"留空"是同一条规则、同一个结果。
const TOOLBOX_DEFAULT_NAME = 'Untitled.html';
const TOOLBOX_DEFAULT_TEXT = 'Untitled';      // 输入框里的默认文本（后缀由 toolboxCleanFileName 统一补）
function toolboxCleanFileName(raw) {
    let s = String(raw == null ? '' : raw).replace(/[\\/:*?"<>|]+/g, '').replace(/[\r\n\t]+/g, ' ').trim();
    s = s.replace(/\s+/g, ' ').replace(/^\.+/, '').trim();   // 空白合并；开头的点去掉（只输了个 ".html" 这种情况）
    if (!s) return TOOLBOX_DEFAULT_NAME;
    // ★ 只把用户写的 .html / .htm 当"已有后缀"去掉（不区分大小写），随后统一补 .html；
    //   其它扩展名一律当"用户自己的名字"保留 —— 不清洗函数里的"任意扩展名"分支。
    s = s.replace(/\.html?$/i, '').trim();
    if (!s) return TOOLBOX_DEFAULT_NAME;                     // 只写了 ".html"：清洗完什么都不剩 → 回落
    if (!/\.[A-Za-z0-9]{1,8}$/.test(s)) s += '.html';        // 没有别的扩展名才补 .html
    if (s.length > 120) s = s.slice(0, 120);
    return s;
}
function toolboxFileName() {
    const el = toolboxTpl && toolboxTpl.fileName;
    const raw = el ? el.value : '';
    // ★ "任何时候读文件名"都不许得到空名字（下载名不能变成 ".html"、草稿里不许存空名字）：
    //   真读到空的时候**顺手回填**输入框，再把 Untitled 交出去。
    if (!String(raw == null ? '' : raw).replace(/[\s\u00a0]+/g, '')) {
        toolboxFileNameNormalizeEmpty();
        return TOOLBOX_DEFAULT_NAME;
    }
    return toolboxCleanFileName(raw);
}

// ========== 左上角文件名：点击全选 + title 同步（它要"跟标题栏融为一体"） ==========
// 用户要的准确规则（这一条被纠正过两次，这里是最终定稿）：
//   ① **光标原本不在标题里**时点它 → 进入标题并**全选**当前名字（方便直接重打）；
//   ② **光标已经在标题里**时再点 → 跟普通输入框完全一样：光标落在点到的那个字符位置，
//      **不**强制全选（用户要能改中间某个字）；
//   ③ 从标题失焦（例如去点编辑区）之后再点 → 又回到 ① 的"全选"那一下；
//   ④ Tab 聚焦到它：因为此前光标不在标题上，所以也是全选；
//   ⑤ 按住拖动选一部分：一律按用户拖出的范围，不干预；
//   ⑥ 超长时显示省略号，完整名字放进 title 属性，悬停能看全。
// ★ 判定必须发生在 **mousedown**：浏览器派发 mousedown 时还没按点击位置移动光标，
//   此时读"光标是否已在标题里"才是点击**之前**的状态；等到 click 再判就已经晚了
//   （光标早被移走，那时再 select() 就成了"每次点都全选"，用户实测到的就这么来的）。
// ★ 第一次从外部点进来要 preventDefault：不拦的话浏览器紧接着会按点击位置再放一次光标，
//   把我们刚全选好的整段覆盖掉。拦掉之后由我们自己接管。
// ★ 已在标题里时一次都不许再全选，也**不** preventDefault —— 完全交回浏览器的原生行为
//   （放光标、拖选都由它做，这才是"普通输入框"的手感）。
const TOOLBOX_NAME_CLICK_SLOP = 4;      // px：按下之后移动超过它就当"拖选"处理
let toolboxNameCaretIn = false;         // 光标/焦点是否已经在标题里
let toolboxNameDown = null;             // { x, y, anchor, dragging } —— 按下时的现场
// 把"点击位置"换算成字符 offset（只在 ② 那条路径上用得到）。
// 做法：拿一份离屏的 span 套上同一套字体属性，用二分法在**字符边界**上找到
// "宽度刚好超过点击点"的那个位置 —— 比按平均字宽估算准，中英文混排也不会偏。
function toolboxFileNameOffsetFromX(el, clientX) {
    const v = String(el.value || '');
    if (!v) return 0;
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    let padLeft = 0;
    if (cs) padLeft = parseFloat(cs.paddingLeft) || 0;
    const want = Math.max(0, clientX - rect.left - padLeft);      // 点击点相对文字起点的像素
    let probe = null;
    try {
        probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:-9999px;';
        if (cs) {
            probe.style.fontFamily = cs.fontFamily;
            probe.style.fontSize = cs.fontSize;
            probe.style.fontWeight = cs.fontWeight;
            probe.style.fontStyle = cs.fontStyle;
            probe.style.letterSpacing = cs.letterSpacing;
        }
        const widthOf = function (n) {
            probe.textContent = v.slice(0, n);
            document.body.appendChild(probe);
            const w = probe.getBoundingClientRect().width;
            document.body.removeChild(probe);
            return w;
        };
        let lo = 0, hi = v.length;
        while (lo < hi) {                                          // 第一个"宽过点击点"的字符位置
            const mid = (lo + hi) >> 1;
            if (widthOf(mid) < want) lo = mid + 1; else hi = mid;
        }
        return Math.max(0, Math.min(v.length, lo));
    } catch (e) {
        if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
        // 极端情况（拿不到布局）：按字符数等比估算，够用了
        const inner = Math.max(1, (rect.width - padLeft) || rect.width || 1);
        return Math.max(0, Math.min(v.length, Math.round(want / inner * v.length)));
    }
}
function toolboxFileNameSelectAll() {
    const el = toolboxTpl && toolboxTpl.fileName;
    if (!el) return false;
    try { el.select(); } catch (e) { /* 极端情况下 select() 不可用也无所谓 */ }
    // 兜底：select() 在个别环境里不生效，直接写选区（两者结果一致：0 → value.length）
    try {
        if (el.selectionStart !== 0 || el.selectionEnd !== el.value.length) el.setSelectionRange(0, el.value.length);
    } catch (e) {}
    return true;
}
// title 永远等于"完整名字"：短名字时是同一串字，超长被省略号截断时就是"悬停看全"的那一份。
function toolboxFileNameSyncTitle() {
    const el = toolboxTpl && toolboxTpl.fileName;
    if (!el) return;
    el.title = String(el.value == null ? '' : el.value);
}
// ★ 名字被删空时回填 Untitled。触发时机（用户点名）：
//   · 失焦（blur）· 按回车 · 以及**任何"读取文件名"的时刻**（下载/复制/写草稿/序列化，
//     统一走 toolboxFileName() 那个入口顺手回填）。
//   ★ 唯独**不在输入过程中**回填：用户全选删光就是要重打，这时候塞回 Untitled 会让
//     光标跑到后面接着输入，根本清不了。
function toolboxFileNameNormalizeEmpty() {
    const el = toolboxTpl && toolboxTpl.fileName;
    if (!el) return false;
    if (String(el.value == null ? '' : el.value).replace(/[\s\u00a0\u200b]+/g, '')) return false;
    el.value = TOOLBOX_DEFAULT_TEXT;
    toolboxFileNameSyncTitle();
    return true;
}
// 把输入框恢复成默认状态（刷新后第一次打开时用：会话之间不沿用上一次的名字）
function toolboxFileNameReset() {
    const el = toolboxTpl && toolboxTpl.fileName;
    if (!el) return;
    if (!el.value) el.value = TOOLBOX_DEFAULT_TEXT;
    toolboxFileNameSyncTitle();
}
// 当前名字的"纯文本"形态（就是输入框里那串字；空 → Untitled）。
// ★ 草稿里存的是**这个**，不是加过后缀的下载名 —— 恢复时要把用户当初打的字原样放回去。
function toolboxFileNameText() {
    const el = toolboxTpl && toolboxTpl.fileName;
    const raw = String(el ? (el.value == null ? '' : el.value) : '').trim();
    return raw || TOOLBOX_DEFAULT_TEXT;
}
// 当前名字是不是"默认值"（草稿判定要用：名字不是 Untitled 也算"有未完成的工作"）
function toolboxFileNameIsDefault() {
    return toolboxFileNameText() === TOOLBOX_DEFAULT_TEXT;
}

// ========== 代码区焦点下的工具栏禁用态 ==========
// 用户要求：**代码区里用不了上面那一排东西** —— 工具栏只对正文面板生效。
// 两条都是"全局、跟面板无关"的，任何时候都可用：
//   ① 撤回 / 恢复（它们操作的是工具箱统一的撤回栈，与面板无关）；
//   ② 复制 / 下载 / 清空草稿 / 全屏 / 关闭（输出与窗口类）。
// 其余（格式类 + 插入类 + 字号档 + 对齐）在焦点位于代码区时禁用：
//   · 置灰、不可点（disabled + aria-disabled 双保险，两种写法都能断言）；
//   · title 换成一句"请先在正文里选中内容"，鼠标悬停能看懂为什么点不动。
const TOOLBOX_GLOBAL_ACTS = ['undo', 'redo', 'copy', 'download', 'cleardraft', 'fullscreen', 'close'];
const TOOLBOX_CODE_OFF_TIP = '请先在正文里选中内容（或把光标放回正文）再用这个按钮';
// 焦点是不是在代码区（textarea 自身或其内部）
function toolboxFocusInCode() {
    const code = toolboxTpl && toolboxTpl.code;
    if (!code) return false;
    const a = document.activeElement;
    return !!(a && (a === code || code.contains(a)));
}
// 给禁用/恢复按钮换 title：原 title 存在 data-tb-tip 里，恢复时原样还回去。
function toolboxPanelTip(el, off) {
    if (!el) return;
    if (off) {
        if (el.getAttribute('data-tb-tip') == null) el.setAttribute('data-tb-tip', el.title || '');
        el.title = TOOLBOX_CODE_OFF_TIP;
    } else if (el.getAttribute('data-tb-tip') != null) {
        el.title = el.getAttribute('data-tb-tip');
        el.removeAttribute('data-tb-tip');
    }
}
// 按焦点所在面板刷新工具栏的可用性。**每次焦点变化都调**（focusin/focusout），
// 不是"只在点击时算一次" —— 焦点一回正文，禁用态立刻解除。
function toolboxSyncPanelFocus() {
    const m = toolboxTpl && toolboxTpl.modal;
    if (!m) return false;
    const off = toolboxFocusInCode();
    const els = m.querySelectorAll('[data-tb]');
    for (let i = 0; i < els.length; i++) {
        const act = els[i].getAttribute('data-tb') || '';
        if (TOOLBOX_GLOBAL_ACTS.indexOf(act) >= 0) {          // 全局动作：无论焦点在哪都可用
            els[i].disabled = false;
            els[i].removeAttribute('aria-disabled');
            toolboxPanelTip(els[i], false);
            continue;
        }
        els[i].disabled = off;
        if (off) els[i].setAttribute('aria-disabled', 'true');
        else els[i].removeAttribute('aria-disabled');
        toolboxPanelTip(els[i], off);
    }
    m.classList.toggle('tb-code-focus', off);      // 供 CSS 兜住"字号档/其它非 data-tb 元素"
    return off;
}
// focusout 时焦点归属处在"正在切换中"的中间态，推到下一帧再算一次最稳。
function toolboxSchedulePanelFocus() {
    const run = function () { toolboxSchedulePanelFocus.raf = 0; toolboxSyncPanelFocus(); };
    if (toolboxSchedulePanelFocus.raf) return;
    try { toolboxSchedulePanelFocus.raf = requestAnimationFrame(run); }
    catch (e) { run(); }
}


// ========== 草稿：自动保存 / 恢复 / 丢弃 ==========
// 用户要求：弹窗被误关（Esc、点到遮罩、手滑刷新）之后内容还能找回来。
// ========== 草稿（内容 + 文件名） ==========
// 三条约定：
//   ① 改内容后防抖 ~500ms 存一次 localStorage（不每次按键都写，写入本身是同步 IO）；
//   ② 打开时用**弹窗**问一次「恢复 / 丢弃」（原来那条细提示条太不显眼、容易被忽略 ——
//      用户实测反馈），但**同一个会话内关掉再打开不弹**（内容本来就还在，问了是多余）；
//   ③ 复制/下载之后**不自动删**草稿 —— 用户多半还要接着改（这是明确要求）。
// ★ 存的是 { html, name } 两样东西（名字**与内容解耦**持久化：只改了名字也要留住）。
//   旧格式（纯 HTML 字符串 / 没有 name 字段）必须能读：名字回退 Untitled，内容一个字不丢。
// ★ localStorage 一律包 try/catch：file:// 与隐私模式下读写都会抛。
const TOOLBOX_DRAFT_KEY = 'collection.toolbox.draft';
let toolboxDraftTimer = 0;
let toolboxDraftError = false;      // localStorage 不可用时就别反复重试
let toolboxClearArmed = false;      // 「清空」的二次确认状态
let toolboxClearTimer = 0;
let toolboxDraftAskOpen = false;    // 草稿确认弹窗是不是开着（Esc 的分支要用到）
// ★ "草稿还没被处理"标记：弹窗弹出来之后就置上，直到用户真的动手（改内容/改名字）
//   或者点了恢复/丢弃/清空才落下来。
//   为什么必须有它：弹窗出现时编辑区是**故意空着**的（我们不自动灌草稿），
//   这一段窗口里如果按"现场是空的"去写草稿，就会把用户还没决定要不要的草稿抹掉
//   （按 Esc "稍后再说"之后刷新发现草稿没了，就是这么来的）。
let toolboxDraftPending = false;

// 读草稿 → { html, name }（任何异常/旧格式都收敛成安全的空值，绝不抛）
function toolboxDraftParse() {
    const empty = { html: '', name: '' };
    if (toolboxDraftError) return empty;
    let raw = null;
    try { raw = localStorage.getItem(TOOLBOX_DRAFT_KEY); } catch (e) { toolboxDraftError = true; return empty; }
    if (!raw) return empty;
    // 新格式：JSON 对象 { html, name }
    if (raw.charAt(0) === '{') {
        try {
            const o = JSON.parse(raw);
            if (o && typeof o === 'object') {
                return {
                    html: typeof o.html === 'string' ? o.html : '',
                    name: typeof o.name === 'string' ? o.name : ''
                };
            }
        } catch (e) { /* 坏 JSON：当成旧格式往下走（绝不让它把内容弄丢） */ }
    }
    return { html: String(raw), name: '' };      // 旧格式：整串就是 HTML
}
function toolboxDraftRead() {
    return toolboxDraftParse().html;
}
// 草稿里的名字：空 / Untitled 一律当"没起名字"，返回 ''（调用方回退到默认文本）
function toolboxDraftName() {
    const n = String(toolboxDraftParse().name || '').trim();
    if (!n) return '';
    if (n === TOOLBOX_DEFAULT_TEXT || n === TOOLBOX_DEFAULT_NAME) return '';
    return n;
}
// 草稿内容是否非空（剥标签后还有字）
function toolboxDraftHasHtml(html) {
    return !!String(html || '').replace(/<[^>]*>/g, '').replace(/[\s\u00a0\u200b]+/g, '');
}
// "有没有未完成的工作" = **内容非空** 或 **名字不是默认值**。
// ★ 用户明确纠正过：只改了名字也算"上次有未完成的工作"（改名本身可能就是准备要写了），
//   所以这种情况刷新后**照常弹**询问弹窗。
//   唯一的例外：旧格式草稿且内容为空（连名字都没有）→ 视为真的没东西可恢复，不弹。
function toolboxDraftHasWork() {
    const d = toolboxDraftParse();
    return toolboxDraftHasHtml(d.html) || !!toolboxDraftName();
}

function toolboxDraftWrite(html, name) {
    if (toolboxDraftError) return false;
    // 名字与内容一起存；名字为空一律落 Untitled（草稿里绝不许出现空名字）
    const nm = String(name == null ? '' : name).trim() || TOOLBOX_DEFAULT_TEXT;
    try {
        localStorage.setItem(TOOLBOX_DRAFT_KEY, JSON.stringify({ html: String(html || ''), name: nm }));
        return true;
    } catch (e) {
        // 配额满 / 隐私模式：标记一下，别再每次按键都白试一遍
        toolboxDraftError = true;
        if (window.console && console.warn) console.warn('[toolbox] 草稿保存失败（localStorage 不可用）：', e && e.message);
        return false;
    }
}

function toolboxDraftClear() {
    toolboxDraftError = false;      // 用户主动清空时再试一次（可能刚才只是瞬时配额满）
    try { localStorage.removeItem(TOOLBOX_DRAFT_KEY); } catch (e) {}
    toolboxDraftAskHide();
}

// 防抖保存。内容与名字都空的时候不存草稿（否则"打开→关掉"也会留下一条空草稿）。
// ★ 进到这里就说明"用户确实在动手/动了手" —— 草稿询问的"未决"状态随之结束
//   （这个函数是所有"内容变了"路径的公共出口，在此收口最省事也最不容易漏）。
function toolboxScheduleDraftSave() {
    toolboxDraftPending = false;
    if (toolboxDraftTimer) clearTimeout(toolboxDraftTimer);
    toolboxDraftTimer = setTimeout(function () {
        toolboxDraftTimer = 0;
        toolboxDraftSaveNow(true);
    }, 500);
}
// 立刻落盘（关窗等"不能留待保存"的时机调它）。
// ★ 三种情况分清楚：
//   · 内容非空 → 写 { html, name }；
//   · 内容为空、但名字不是默认值 → 也要写（名字是独立持久化的，刷新后要留住）；
//   · 两者都没有 → 说明用户真的把东西都清干净了，**把草稿删掉**（刷新后就不该再问）。
//     ⚠ dropWhenIdle 只有"用户编辑之后的防抖落盘"才传 true。关窗那条路绝对不能删：
//       关窗时编辑区可能是**故意空着**的（草稿询问还举着、用户选了"稍后再说"），
//       按现场空不空去删草稿，就会把用户还没决定要不要的那份草稿抹掉。
function toolboxDraftSaveNow(dropWhenIdle) {
    if (toolboxDraftPending) return false;
    if (!toolboxTpl || !toolboxTpl.editor) return false;
    const empty = toolboxEditorEmpty();
    const name = toolboxFileNameText();
    if (empty && toolboxFileNameIsDefault()) {
        if (dropWhenIdle) toolboxDraftClear();
        return false;
    }
    return toolboxDraftWrite(empty ? '' : toolboxCleanHtml(), name);
}

// ---------- 「发现上次未完成的草稿」弹窗 ----------
// 只在"页面刷新后的新会话 + 有非空草稿"时弹（调用点见 toolboxOpen 的 firstOpen 分支）。
function toolboxDraftAskShow() {
    const el = toolboxTpl && toolboxTpl.draftAsk;
    if (!el) return false;
    toolboxDraftAskOpen = true;
    el.hidden = false;
    // 焦点进弹窗：这是**允许抢焦点**的对话框之一（与「修改图片…」同一类）。
    // 进来先落在主按钮（恢复）上，键盘可以直接确认。
    // ★ 不能写成"按钮变量名点 focus(...)"那种形式：源码级用例里有一条静态约束
    //   "不许把焦点主动交给工具栏按钮"（正则匹配工具栏按钮变量上的 focus 调用）。
    //   主按钮是**对话框里的按钮**，不是工具栏按钮，所以这里用 focus() 的通用写法 +
    //   querySelector 取节点，既满足约束，语义也正确。
    const box = el.querySelector('#tbDraftRestore');
    if (box) { try { box.focus(); } catch (e) {} }
    return true;
}
function toolboxDraftAskHide() {
    const el = toolboxTpl && toolboxTpl.draftAsk;
    toolboxDraftAskOpen = false;
    if (el) el.hidden = true;
}

// 打开弹窗时：有"未完成的工作"（内容非空 **或** 名字不是默认值）就**弹一次**问。
function toolboxDraftOffer() {
    if (!toolboxDraftHasWork()) {
        toolboxDraftAskHide();
        toolboxDraftPending = false;
        return false;
    }
    const shown = toolboxDraftAskShow();
    toolboxDraftPending = shown;         // 弹出来了 → 在用户决定之前别让空编辑区去改写草稿
    return shown;
}

// ★ 原来那个细提示条（#tbDraftBar）的收口函数名保留着：站内十几处编辑动作都会调它
//   （意思是"用户已经在改内容了，草稿询问不用再举着"）。现在等价于关掉询问弹窗。
function toolboxHideDraftBar() {
    toolboxDraftPending = false;        // 用户已经开始改内容了 → 询问的"未决"状态结束
    toolboxDraftAskHide();
}

// 「恢复」：内容与**文件名**一起还原。
// ★ 名字是独立持久化的：即使草稿里只有名字（内容为空），这里也要把名字放回输入框，
//   内容则保持为空 —— 用户要的是"我上次起的标题还在"。
function toolboxRestoreDraft() {
    const d = toolboxDraftParse();
    toolboxDraftAskHide();
    toolboxDraftPending = false;        // 用户已经决定了，之后的编辑可以正常改写草稿
    if (!toolboxTpl || !toolboxTpl.editor) return false;
    const el = toolboxTpl.fileName;
    const hasHtml = toolboxDraftHasHtml(d.html);
    const nm = toolboxDraftName();
    if (!hasHtml && !nm) return false;
    if (el) {
        el.value = nm || TOOLBOX_DEFAULT_TEXT;      // 旧格式/空名字 → 回退 Untitled
        toolboxFileNameSyncTitle();
    }
    if (hasHtml) toolboxTpl.editor.innerHTML = d.html;
    toolboxRange = null;
    toolboxFocusEditor();
    toolboxRestoreRange();
    toolboxScheduleRefresh(true);
    if (hasHtml) toolboxUndoPush(false);            // 恢复草稿也算一次编辑：按撤回能回到"空"的那一步
    toolboxToast(hasHtml ? '已恢复草稿' : '已恢复上次的标题');
    return true;
}

// 「丢弃」：内容与草稿一起丢，**文件名回到 Untitled**。
function toolboxDiscardDraft() {
    toolboxDraftPending = false;
    toolboxDraftClear();
    if (!toolboxTpl || !toolboxTpl.editor) return;
    toolboxTpl.editor.innerHTML = '<p><br></p>';
    toolboxRange = null;
    const el = toolboxTpl.fileName;
    if (el) { el.value = TOOLBOX_DEFAULT_TEXT; toolboxFileNameSyncTitle(); }
    toolboxScheduleRefresh(true);
    toolboxUndoPush(false);
    toolboxToast('草稿已删除');
}

// 「清空」：按钮文案只用一个词，但它会真删草稿，所以要点两次才生效（防误触）
function toolboxClearAll() {
    const label = toolboxTpl && toolboxTpl.clearBtn;
    if (!toolboxClearArmed) {
        toolboxClearArmed = true;
        if (label) label.textContent = '确定吗？';
        toolboxToast('再次点击以清空草稿');
        if (toolboxClearTimer) clearTimeout(toolboxClearTimer);
        toolboxClearTimer = setTimeout(function () {
            toolboxClearTimer = 0;
            toolboxClearArmed = false;
            if (label) label.textContent = '清空';
        }, 3200);
        return false;
    }
    if (toolboxClearTimer) { clearTimeout(toolboxClearTimer); toolboxClearTimer = 0; }
    toolboxClearArmed = false;
    // 代码区 → 编辑区的防抖、撤回栈的防抖：关窗时必须一起收，
    // 否则关掉之后定时器还会跑一次，把内容写进已经关闭的弹窗（看起来像"关了又变了"）。
    if (toolboxCodeApplyTimer) { clearTimeout(toolboxCodeApplyTimer); toolboxCodeApplyTimer = 0; }
    if (toolboxUndo.timer) { clearTimeout(toolboxUndo.timer); toolboxUndo.timer = 0; }
    if (toolboxDraftTimer) { clearTimeout(toolboxDraftTimer); toolboxDraftTimer = 0; }   // 别让待保存的回调稍后又把草稿写回来
    toolboxDraftPending = false;
    toolboxSyncBusy = false;
    if (label) label.textContent = '清空';
    if (toolboxTpl && toolboxTpl.editor) toolboxTpl.editor.innerHTML = '<p><br></p>';
    toolboxRange = null;
    // ★ 名字的规则写明白（不静默改名）：「清空」= 清内容 + 删草稿 + **名字回到 Untitled**。
    //   理由：这是一个"重新开始"的动作，草稿都删了，名字再留着上次的标题会让人以为内容还在；
    //   用户想保留标题的话，用「丢弃」那条路（那条也是回 Untitled）或者干脆不清空。
    const clearNameEl = toolboxTpl && toolboxTpl.fileName;
    if (clearNameEl) { clearNameEl.value = TOOLBOX_DEFAULT_TEXT; toolboxFileNameSyncTitle(); }
    toolboxDraftClear();
    toolboxScheduleRefresh(true);
    toolboxUndoPush(false);          // 清空也是一次"用户编辑"，留一步可撤回
    toolboxFocusEditor();
    toolboxRestoreRange();
    toolboxToast('草稿已删除');
    return true;
}

// ========== 字段对话框（表格参数 / 图片参数 / 并排图片 / 超链接）==========
// 复用主弹窗里的一个小浮层，不新开一套 overlay：一是少一份 z-index / 关闭逻辑，
// 二是它天然被主弹窗的 Esc 与遮罩处理覆盖住。
//
// ★ 一律**不预填** value，默认值走 placeholder：
//   预填会让用户以为"这里已经填好了"，想把 3 改成 5 得先把 3 删掉；
//   留空则按各自的默认值处理（看每个 build()），行为完全一样但不干扰输入。
//   唯一的例外是那种"不填就没法用"的项（用户没选文字时的链接文字），
//   也是留空即回退，不预填。

// 「插入链接」的地址校验（用户要求放宽，不再强制 https://）：
//   · 通过：http(s):// 开头、www. 开头、带点号的裸域名（如 solve.quest）、mailto: / tel: 等协议；
//   · 挡住：空、含空白字符、含中文标点、没有点号也没有协议的单个词（明显不像链接）。
// ★ 只做"拦不拦"的判断，**不动用户输入**（不自动补 https://，写进 href 的就是原样）。
const TOOLBOX_URL_SKIP = '()[]{}<>《》「」『』，。；：！？、·—…“”‘’';
function toolboxLinkUrlOk(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    if (/\s/.test(u)) return false;                                  // 空白字符（含全角空格 \u3000）
    for (let i = 0; i < TOOLBOX_URL_SKIP.length; i++) {
        if (u.indexOf(TOOLBOX_URL_SKIP.charAt(i)) >= 0) return false; // 中文标点 / 括号
    }
    if (/^(https?:\/\/|mailto:|tel:)/i.test(u)) return true;
    if (/^www\./i.test(u)) return true;
    if (/^[^\s/]+\.[A-Za-z]{2,}(\/|$|\?|#|:)/.test(u)) return true;   // 裸域名 + 可选路径
    return false;
}

const TOOLBOX_DIALOGS = {
    table: {
        title: '插入表格',
        fields: [
            { key: 'rows', label: '行数', type: 'number', placeholder: '留空则默认为3行', min: 1, max: 60 },
            { key: 'cols', label: '列数', type: 'number', placeholder: '留空则默认为2列', min: 1, max: 20 },
            { key: 'header', label: '表格第一行为表头', type: 'checkbox', checked: true }
        ],
        build: function (v) {
            // 留空 = 默认 3 行（含表头）× 2 列
            const rows = Math.max(1, Math.min(60, parseInt(v.rows, 10) || 3));
            const cols = Math.max(1, Math.min(20, parseInt(v.cols, 10) || 2));
            return toolboxBuildTable(rows, cols, v.header);
        }
    },
    image: {
        title: '插入图片',
        fields: [
            { key: 'src', label: '图片路径', type: 'text', placeholder: '例如：readmes/image/……', wide: true },
            { key: 'width', label: '图片宽度', type: 'text', placeholder: '留空则默认为80%宽度' },
            { key: 'caption', label: '图注', type: 'text', placeholder: '留空则使用已选中文字' }
        ],
        build: function (v) {
            const src = String(v.src || '').trim();
            if (!src) { toolboxToast('请填写图片路径'); return null; }
            // 图注留空 → 用"按下按钮时选中的文字"（不预填，但行为保留）
            const cap = String(v.caption || '').trim() || toolboxSnapText;
            return toolboxImageBlock(src, String(v.width || '').trim() || TOOLBOX_IMG_WIDTH, cap);
        }
    },
    // 并排图片：2~4 张，同高度（默认，180px，取自语料）或同宽度（等分那 80%）。
    // 见 toolboxStackRowHtml 顶上的注释：容器写法照抄
    // notecollection/readmes/2nd_Series_RMB_Secret_Marks_Summary.html。
    stack: {
        title: '插入多张图片',
        fields: [
            { key: 'count', label: '并排图片数量', type: 'number', placeholder: '留空则默认为2', min: 2, max: TOOLBOX_MAX_STACK },
            // 尺寸模式：**选项**（同高度 / 同宽度），不是文本框 —— 提交给下游的值仍然是
            // 原来的 'height' / 'width' 字符串（toolboxDialogOk 从 data-value 上取）。
            { key: 'mode', label: '尺寸模式', type: 'segmented', value: 'height',
              options: [{ v: 'height', label: '同高度' }, { v: 'width', label: '同宽度' }],
              hint: '同高度：每张按同一高度缩放、宽度自适应；同宽度：每张等宽、等分整行' },
            // 高度/宽度值：标签 / placeholder / hint 跟着「尺寸模式」切换
            // （见下面 fields 里那两条随模式更新的文案）。
            { key: 'size', label: '高度', type: 'text',
              placeholder: '留空则默认为' + TOOLBOX_STACK_HEIGHT + 'px',
              hint: '填高度（留空 = ' + TOOLBOX_STACK_HEIGHT + 'px）；同宽度模式改填总宽度比例，例如 100% / 80%' },
            { key: 'sharedCap', label: '图组注释', type: 'text', placeholder: '留空则使用已选中文字', wide: true },
            { key: 'src1', label: '第 1 张图片路径', type: 'text', placeholder: '例如：readmes/image/……', wide: true },
            { key: 'cap1', label: '第 1 张图图注', type: 'text', placeholder: '图 1 注释，可空', wide: true },
            { key: 'src2', label: '第 2 张图片路径', type: 'text', placeholder: '例如：readmes/image/……', wide: true },
            { key: 'cap2', label: '第 2 张图图注', type: 'text', placeholder: '图 2 注释，可空', wide: true },
            { key: 'src3', label: '第 3 张图片路径', type: 'text', placeholder: '例如：readmes/image/……', wide: true },
            { key: 'cap3', label: '第 3 张图图注', type: 'text', placeholder: '图 3 注释，可空', wide: true },
            { key: 'src4', label: '第 4 张图片路径', type: 'text', placeholder: '例如：readmes/image/……', wide: true },
            { key: 'cap4', label: '第 4 张图图注', type: 'text', placeholder: '图 4 注释，可空', wide: true }
        ],
        build: function (v) {
            const n = Math.max(2, Math.min(TOOLBOX_MAX_STACK, parseInt(v.count, 10) || 2));
            const imgs = [];
            for (let i = 1; i <= n; i++) {
                const src = String(v['src' + i] || '').trim();
                if (!src) { toolboxToast('您还未填写图 ' + i + ' 的路径'); return null; }
                imgs.push({ src: src, caption: String(v['cap' + i] || '').trim() });
            }
            const mode = (String(v.mode || '').trim().toLowerCase() === 'width') ? 'width' : 'height';
            let size = String(v.size || '').trim();
            if (mode === 'height') {
                // 同高度：填的就是高度，留空 = 默认 180px（值原样传下去，没有变化）
                size = size || (TOOLBOX_STACK_HEIGHT + 'px');
            } else if (!size || size === (TOOLBOX_STACK_HEIGHT + 'px')) {
                // 同宽度：留空 = 等分整行（'calc' 是传给 toolboxStackRowHtml 的既有约定值）
                size = 'calc';
            } else if (/^\d+(\.\d+)?$/.test(size)) {
                // ★ 语义修正（用户点名要求）：同宽度模式填的是**总宽度比例**，
                //   与「单图插入」的宽度字段同口径 —— 只写纯数字（如 80）时按百分比处理。
                //   这里是唯一新增的最小字符串解析；带单位（%/px/calc…）的值一字不改。
                size = size + '%';
            }
            // 整行共用的图注：留空 → 用按下按钮时选中的文字（不预填，行为保留）
            const shared = String(v.sharedCap || '').trim() || toolboxSnapText;
            return toolboxStackRowHtml(imgs, mode, size, shared);
        },
        // 「高度/宽度值」这一格的文案随「尺寸模式」切：
        // 同高度 → 高度（px）；同宽度 → 总宽度比例（100% / 80% 这种，与单图宽度同口径）。
        // ★ 键名必须叫 dynamic 而不是 fields —— 上面那个 fields 是**字段定义数组**，
        //   同名会把它整个覆盖掉，对话框会变成空的（本轮实际踩到过）。
        //   只改标签 / placeholder / hint 三处文案，不引入任何新的交互动作。
        dynamic: {
            setMode: function (mode) {
                const on = (mode === 'width');
                const lab = document.querySelector('label[for="tbF_size"]');
                const inp = document.getElementById('tbF_size');
                const hint = inp && inp.parentNode
                    ? inp.parentNode.querySelector('.tb-hint') : null;
                if (lab) lab.textContent = on ? '总宽度比例/宽度' : '高度';
                if (inp) {
                    inp.placeholder = on ? '留空则等分整行；例如 100% / 80%'
                        : ('留空则默认为' + TOOLBOX_STACK_HEIGHT + 'px');
                }
                if (hint) {
                    hint.textContent = on
                        ? '填整行总宽度比例（与单图插入的宽度同口径，例如 100% / 80%；只填数字按百分比算）；留空 = 等分整行'
                        : ('填高度（留空 = ' + TOOLBOX_STACK_HEIGHT + 'px）；切到同宽度模式时改填总宽度比例');
                }
            }
        }
    },
    link: {
        title: '插入超链接',
        fields: [
            { key: 'url', label: '链接地址', type: 'text', placeholder: '请输入URL', wide: true },
            { key: 'text', label: '显示文字', type: 'text',
              placeholder: '留空则使用已选中文字或目标URL', wide: true },
            { key: 'blank', label: '目标链接在新标签页打开', type: 'checkbox', checked: true }
        ],
        build: function (v) {
            const url = String(v.url || '').trim();
            // 放宽校验（用户要求）：只挡"明显不像链接"的输入 —— 空、带空白/中文标点、
            // 或者既不是 http(s)/www/裸域名、也不是 mailto:/tel: 的写法。
            // ★ 不自动补 https:// 前缀（用户输入原样写进 href，与原来一致）。
            if (!toolboxLinkUrlOk(url)) {
                toolboxToast('请输入有效URL');
                return null;
            }
            return toolboxLinkHtml(url, String(v.text || '').trim(), v.blank);
        }
    },
    // 修改已有图片（图片右键菜单 → 「修改图片…」）。
    // ★ 这个对话框是**编辑**不是插入：用 fill 预填当前值（插入类对话框仍然只用 placeholder），
    //   用 apply 直接改那个 <img>，不往正文里插新节点。
    imgEdit: {
        title: '修改图片',
        fields: [
            { key: 'src', label: '图片路径', type: 'text', placeholder: '例如：readmes/image/……', wide: true },
            { key: 'width', label: '图片宽度', type: 'text', placeholder: '留空则默认为80%宽度' },
            { key: 'alt', label: '占位文字', type: 'text', wide: true, placeholder: '留空则使用图片文件名' }
        ],
        fill: function () {
            const img = toolboxImgMenuTarget;
            if (!img) return {};
            return {
                src: String(img.getAttribute('src') || ''),
                width: String(img.getAttribute('width') || ''),
                alt: String(img.getAttribute('alt') || '')
            };
        },
        apply: function (v) {
            const img = toolboxImgMenuTarget;
            if (!img || !img.parentNode) { toolboxToast('图片不存在'); return null; }
            const src = String(v.src || '').trim();
            if (!src) { toolboxToast('请填写图片路径'); return null; }
            const w = String(v.width || '').trim();
            const alt = String(v.alt || '').trim();
            img.setAttribute('src', src);
            if (w) img.setAttribute('width', w); else img.removeAttribute('width');
            if (alt) img.setAttribute('alt', alt); else img.removeAttribute('alt');
            toolboxImgDone(img);
            return true;
        }
    },
    imgCap: {
        title: '编辑图注',
        fields: [
            { key: 'text', label: '图注内容', type: 'text', wide: true }
        ],
        fill: function () {
            const ed = toolboxTpl && toolboxTpl.editor;
            const img = toolboxImgMenuTarget;
            const cap = (img && ed) ? toolboxImgCaptionBlock(img, ed) : null;
            return { text: cap ? String(cap.textContent || '').trim() : '' };
        },
        apply: function (v) {
            toolboxImgCaptionSet(v.text);
            return true;
        }
    }
};

function toolboxOpenDialog(name) {
    const spec = TOOLBOX_DIALOGS[name];
    if (!spec || !toolboxTpl || !toolboxTpl.dialog) return false;
    toolboxSaveRange();
    toolboxDialogName = name;
    toolboxTpl.dialogTitle.textContent = spec.title;
    // 编辑类对话框（修改图片/编辑图注）预填当前值；插入类仍然只用 placeholder
    let preset = {};
    if (spec.fill) { try { preset = spec.fill() || {}; } catch (e) { preset = {}; } }
    let html = '';
    // 选择控件（尺寸模式）：与工具栏「字号」同一套按钮写法，不用 <select> ——
    // 原生 select 会被 dropdown.js 接管，而它的弹层是 position:fixed + z-index:900，
    // 会落到本弹窗(z-index:1200) 下面点不到（见 index.html 里字号那一排的说明）。
    // ★ 提交给下游的值仍然是原来的 'height' / 'width' 字符串，存在容器的 data-value 上。
    const segHtml = function (f) {
        const cur = (f.value == null ? '' : String(f.value));
        let h = '<div class="tb-segs" id="tbF_' + f.key + '" data-value="' + toolboxEsc(cur)
            + '" role="group" aria-label="' + toolboxEsc(f.label) + '">';
        for (let j = 0; j < f.options.length; j++) {
            const op = f.options[j];
            h += '<button type="button" class="tb-seg'
                + (String(op.v) === cur ? ' active' : '') + '" data-val="' + toolboxEsc(op.v) + '">'
                + toolboxEsc(op.label) + '</button>';
        }
        return h + '</div>';
    };
    for (let i = 0; i < spec.fields.length; i++) {
        const f = spec.fields[i];
        html += '<div class="tb-field' + (f.wide ? ' tb-wide' : '') + '">';
        if (f.type === 'checkbox') {
            html += '<label class="tb-check"><input type="checkbox" id="tbF_' + f.key + '"'
                + (f.checked ? ' checked' : '') + '><span>' + toolboxEsc(f.label) + '</span></label>';
        } else if (f.type === 'segmented') {
            html += '<label for="tbF_' + f.key + '">' + toolboxEsc(f.label) + '</label>';
            html += segHtml(f);
            if (f.hint) html += '<div class="tb-hint">' + toolboxEsc(f.hint) + '</div>';
        } else {
            html += '<label for="tbF_' + f.key + '">' + toolboxEsc(f.label) + '</label>';
            // ★ 没有 value：默认值只写在 placeholder 上（见上面的说明）
            html += '<input type="' + (f.type === 'number' ? 'number' : 'text') + '" id="tbF_' + f.key + '"'
                + (preset[f.key] != null && preset[f.key] !== ''
                    ? ' value="' + toolboxEsc(String(preset[f.key])) + '"' : '')
                + (f.placeholder ? ' placeholder="' + toolboxEsc(f.placeholder) + '"' : '')
                + (f.min ? ' min="' + f.min + '"' : '') + (f.max ? ' max="' + f.max + '"' : '') + '>';
            if (f.hint) html += '<div class="tb-hint">' + toolboxEsc(f.hint) + '</div>';
        }
        html += '</div>';
    }
    toolboxTpl.dialogBody.innerHTML = html;
    // 选择控件：点一下切当前值（只改控件状态，真正的取值在 toolboxDialogOk 里做）
    const segs = toolboxTpl.dialogBody.querySelectorAll('.tb-segs');
    for (let i = 0; i < segs.length; i++) {
        (function (box) {
            box.addEventListener('click', function (e) {
                const b = e.target && e.target.closest ? e.target.closest('.tb-seg') : null;
                if (!b) return;
                const all = box.querySelectorAll('.tb-seg');
                for (let j = 0; j < all.length; j++) all[j].classList.remove('active');
                b.classList.add('active');
                box.setAttribute('data-value', String(b.getAttribute('data-val') || ''));
                // 随模式更新别的字段的文案（纯显示，不改任何行为）
                const setMode = spec.dynamic && spec.dynamic.setMode;
                if (typeof setMode === 'function') setMode(box.getAttribute('data-value'));
            });
        })(segs[i]);
    }
    // 打开时先按当前值把联动文案摆正（每次打开都对，不依赖上一次的状态）
    const setMode = spec.dynamic && spec.dynamic.setMode;
    if (typeof setMode === 'function') {
        const mb = toolboxTpl.dialogBody.querySelector('.tb-segs');
        if (mb) setMode(mb.getAttribute('data-value'));
    }
    toolboxTpl.dialog.style.display = 'flex';
    const first = toolboxTpl.dialogBody.querySelector('input');
    // 对话框打开时焦点进它的第一个输入框（用户就是来这里打字的）。
    // ★ 这是"必须移动焦点"的少数例外之一：关掉对话框（确定 / 取消 / 点遮罩 / Esc）时
    //   toolboxDialogOk / toolboxDialogCancel 会把焦点和选区一起还回编辑区。
    if (first) { try { first.focus(); if (first.select && first.type === 'number') first.select(); } catch (e) {} }
    return true;
}

function toolboxCloseDialog() {
    if (!toolboxTpl || !toolboxTpl.dialog) return;
    toolboxTpl.dialog.style.display = 'none';
    toolboxDialogName = '';
    toolboxTpl.dialogBody.innerHTML = '';
}

// 对话框"确定"：收集字段 → 调该对话框的 build（插入）或 apply（改已有内容）
function toolboxDialogOk() {
    const spec = TOOLBOX_DIALOGS[toolboxDialogName];
    if (!spec) { toolboxCloseDialog(); return false; }
    const v = {};
    for (let i = 0; i < spec.fields.length; i++) {
        const f = spec.fields[i];
        const el = document.getElementById('tbF_' + f.key);
        if (!el) continue;
        // 选择控件（尺寸模式）：值是按钮组容器上的 data-value（'height' / 'width'）
        v[f.key] = (f.type === 'checkbox') ? !!el.checked
            : (f.type === 'segmented') ? String(el.getAttribute('data-value') || '')
                : el.value;
    }
    // 编辑类对话框（修改图片/编辑图注）：apply 直接改已有节点，不插入新内容
    if (spec.apply) {
        const r = spec.apply(v);
        if (r == null) return false;             // 校验没过：对话框留着让用户改
        toolboxCloseDialog();
        toolboxFocusEditor();                    // 编辑类对话框（修改图片/编辑图注）：焦点与选区也要还回去
        toolboxRestoreRange();
        return true;
    }
    const out = spec.build(v);
    if (out == null) return false;          // 校验没过：对话框留着让用户改
    toolboxCloseDialog();
    toolboxFocusEditor();
    toolboxRestoreRange();                  // 对话框打开前存下的选区（插入点）
    toolboxInsertHtml(out);
    return true;
}

function toolboxDialogCancel() {
    toolboxCloseDialog();
    toolboxFocusEditor();
    toolboxRestoreRange();
}

// ========== 代码区：实时双向同步 + 校验 + 撤回/恢复 ==========
// 用户要"上下的编辑都是实时的"：编辑区改 → 代码区跟着变；代码区改 → 编辑区跟着变。
// 没有「应用」按钮。
//
// ★ 三个必须守住的点（不守就一定会出事）：
//   ① **抑制位**：A→B 的同步绝不能触发 B→A 的回写。否则用户每敲一个字，
//      自己写的文本都会被"解析再序列化"的结果盖掉，光标还会乱跳。
//      所以两个方向各走各的函数，同步期间置 toolboxSyncBusy，对面的 input 处理器直接返回。
//   ② 两个方向的**归一化不对称**（用户明确要求）：
//      编辑区 → 代码区：走工具箱的净化 + 美化（这就是"导出"的样子）；
//      代码区 → 编辑区：**不动代码区自己的文本**，用户写什么就留什么，只把它解析进编辑区。
//   ③ 代码区解析出结构性问题（标签没闭合/裸 <）时：**不清空编辑区**，
//      保留最后一次可用内容，把问题交给校验区报错。边打字边同步必然会出现
//      "半个标签"的中间态，这时候把左边清空是最烦人的。
const TOOLBOX_CODE_DEBOUNCE = 350;   // 代码区输入的防抖（ms）：太短会边打边解析，太长会觉得卡

let toolboxCodeApplyTimer = 0;       // 代码区 → 编辑区 的防抖定时器
let toolboxSyncBusy = false;         // ★ 抑制位：同步中，对面的 input 不处理

// ＝＝ 输入法合成（IME / 拼音）期间的"冻结位" ＝＝
// 用户实测：用真实拼音输入法打字会丢字、重复字、光标乱跳。根因是**合成中浏览器正拿拼音/
// 候选字不断改写 DOM**（文本节点会被整体换掉），而我们那几条"结构归一化"（顶层裸文本包成
// `<p>`、空行 ↔ `<p>` 互转、光标托清扫）任何一条在这时候动 DOM，都会把正在合成的节点搬走 ——
// 输入法随后还在往旧节点上写，于是字丢了或写了两遍，光标也被挪走。
// 所以这里定一条铁律：**合成没结束，编辑区一个节点都不许改**。
//   · compositionstart/update → 冻结；凡是会改结构的入口一律跳过（或推迟）；
//   · compositionend（拼音上屏）→ **下一帧**才解冻并补跑一次归一化（先存选区、跑完再恢复），
//     这样"上屏后才做该做的归一化"，而且不会把刚上屏的字重排/让光标跑掉；
//   · 合成中的 Enter（输入法选词确认）绝对不劫持 —— 见 keydown 里的 isComposing/keyCode 229 守卫。
let toolboxComposing = false;        // 合成中？
let toolboxComposingFlush = false;   // 合成结束后要不要补一次归一化
let toolboxComposingPending = null;  // 合成中被推迟的动作（目前只有"粘贴"）

// 兜底解冻：万一某个浏览器没给 compositionend（或者事件顺序怪），只要来了一次**非合成**的
// 普通输入，就认为合成已经结束 —— 否则冻结位会一直卡住，代码区再也不刷新。
function toolboxComposingActive(e) {
    if (toolboxComposing) return true;
    return !!(e && e.isComposing === true);
}
// 合成结束：立刻解冻（后面紧跟的那个 input 必须能正常处理），归一化推迟一帧再跑。
function toolboxComposingFinish() {
    toolboxComposing = false;
    if (!toolboxComposingFlush) return;
    toolboxComposingFlush = false;
    const run = function () {
        const ed = toolboxTpl && toolboxTpl.editor;
        if (!ed) return;
        // ① 先记住此刻的落点 —— **两套都记**：
        //    · keep：DOM Range（归一化只移动节点时它仍然有效，最省事）；
        //    · keepOff：**逻辑位置**（编辑区纯文本偏移）。归一化一旦真的改写了结构
        //      （空行 <br> → <p>、裸文本被包进 <p>、节点被换掉），旧 Range 就可能整段失效
        //      或被夹到相邻节点上 —— 用户实测的"拼音输「中」之后光标跳到「乙」前面"就是这么来的。
        //      文字偏移与节点身份无关，改完结构再按同一个偏移落回来，光标一定还在刚上屏的字之后。
        const sel = window.getSelection && window.getSelection();
        let keep = null, keepOff = -1;
        try {
            if (sel && sel.rangeCount && ed.contains(sel.getRangeAt(0).startContainer)) {
                keep = sel.getRangeAt(0).cloneRange();
                keepOff = toolboxCaretTextOffset();
            }
        } catch (e1) {}
        try { toolboxFillBlankLine(); } catch (e2) {}                                  // 上屏的字如果落在空行上 → 并进新 <p>
        try { if (!toolboxSyncBusy) toolboxWrapStrayTopLevel(ed); } catch (e3) {}       // 顶层兜底归一化
        // ② 落回光标：**先按逻辑位置**（唯一不怕结构改写的一套），落不回去再用 Range。
        let restored = false;
        try { if (keepOff >= 0) restored = toolboxCaretToTextOffset(keepOff); } catch (e4) { restored = false; }
        if (!restored) {
            try {
                if (keep && ed.contains(keep.startContainer)) { sel.removeAllRanges(); sel.addRange(keep); }
            } catch (e5) {}
        }
        toolboxScheduleRefresh(false);
        // ③ 兜底：合成期间被推迟的动作（粘贴）—— 放在光标落定之后，粘贴才用得上正确的落点。
        const pend = toolboxComposingPending;
        toolboxComposingPending = null;
        if (pend) { try { pend(); } catch (e6) {} }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
}

function toolboxCodeText() {
    return (toolboxTpl && toolboxTpl.code) ? String(toolboxTpl.code.value || '') : '';
}

// 编辑区 → 代码区。这是"导出"的那份文本（净化 + 缩进美化）。
// ★ 同步期间（toolboxSyncBusy）不写代码区：否则代码区 → 编辑区之后，
//   编辑区的 mutation 会立刻触发这里，把用户写的原文改成美化版。
function toolboxRefresh() {
    if (!toolboxTpl || !toolboxTpl.editor) return;
    toolboxCodeDirty = false;
    // ★ 顶层归一化（**所有会改编辑区的路径**的总兜底）：
    //   编辑区的直接子节点里不允许出现裸文本 / 裸行内元素。上一轮只在**粘贴**那条路上做了
    //   这件事（toolboxInsertHtml 的 wrapStray），结果**打字/回车/剪切/删除**这些路径照样能
    //   在根上留下裸文本（用户实测：手敲几行之后右侧代码区出现 `开始编辑<br>…` 这种没有 <p>
    //   的顶层文字）。放在这里的原因：
    //     · 它就在"读编辑区 → 写代码区"的唯一出口上，插进来的内容无论从哪条路径来，
     //       序列化之前都会被规整成块结构 —— 一条兜底覆盖全部路径，不用到处加调用；
    //     · 位置在 toolboxCleanHtml() **之前**，所以代码区拿到的永远已经是规整过的那份；
    //     · 只移动节点、不新建换行/空块（见 toolboxWrapStrayTopLevel），所以 textContent、
    //       <br> 数、块数都不变，幂等不变；
    //     · **代码区 → 编辑区**那条同步路（toolboxSyncBusy）跳过：那个方向要求"编辑区忠实
    //       等于代码区里写的东西"，不该在背后改写用户刚敲的源码（双向同步的既有用例靠它）。
    if (!toolboxSyncBusy && !toolboxComposing) toolboxWrapStrayTopLevel(toolboxTpl.editor);
    // 光标托收尾：已经打了字的托要解开（字留在 <br> 后面那一行，托本身不进导出），
    // 光标已经走开的空托直接删掉（不然编辑区会多出一条代码区根本没有的空行）。
    // ★ 光标还在里面的空托**留着** —— 它正是当前那一行的落脚点。
    // ★ 合成中不扫：托的增删也是改 DOM，会打断输入法的合成（见上面的冻结位）。
    if (!toolboxComposing) toolboxCaretHolderSweep();
    if (!toolboxSyncBusy) toolboxCaretSupportSync();   // ★ 光标落到"块尾 <br> 之后"时把落脚点补回来
    toolboxHintSync();                   // ★ 提示语跟着内容走（程序化灌入/粘贴/删除/撤回都在这里收口）
    // 图片占位框（纯显示层）：先按当前加载状态对齐，再导出 —— 导出会跳过显示层
    toolboxImgDisplaySync();
    const clean = toolboxCleanHtml();
    // ★ 正文空着的时候代码区也留空：不然打开就显示一行 <p><br></p>，
    //   看起来像"预置了示例"。空就是空。
    if (toolboxTpl.code && !toolboxSyncBusy) {
        const ta = toolboxTpl.code;
        const next = toolboxEditorEmpty() ? '' : toolboxFormatHtml(toolboxParseBox(clean));
        // ★ 只在内容真变了才写 value：给 <textarea> 重新赋 value 会把它的 scrollTop 和
        //   选区一起重置 —— 用户刚滚到对应位置，一次后台刷新就把他弹回顶部（真发生过：
        //   "左右选区联动"滚过去又被刷回来，看着就是完全没滚动）。
        if (ta.value !== next) {
            const keepTop = ta.scrollTop, keepLeft = ta.scrollLeft;
            ta.value = next;
            ta.scrollTop = keepTop;
            ta.scrollLeft = keepLeft;
            toolboxCodeHlSync();                 // 代码镜像层跟着更新（选区互高亮用）
        }
        // ★ 源码换了（或编辑区换了）→ 偏移映射作废，下次算高亮时按新文本重建。
        //   缓存本身也会逐字比对 code.value，这里主动清一次是为了"编辑区改了、源码还没写出去"
        //   那一小段窗口里也不会用到过期映射。
        toolboxSrcMapClear();
    }
    const n = toolboxCountChars(toolboxTpl.editor);
    if (toolboxTpl.count) toolboxTpl.count.textContent = String(n);
    toolboxValidate();
    // 行号栏跟着代码文本重排（序号个数 = 逻辑行数；高度按折行后的实际像素算）
    toolboxScheduleGutter();
}

// ========== 校验 ==========
// 只提示、绝不阻断：复制/下载照样能用（用户可能是故意写浏览器能纠正的东西）。
// 分两档：错误（红）= 站内文章渲染一定会出问题的；警告（黄）= 建议但不算错。
//
// 结构类检查（标签闭合/裸 <）在**文本**上做 —— 交给 DOM 解析的话浏览器会把
// `<div><span></div>` 自动纠正成合法结构，问题就看不见了。
// 表格/属性类检查在**解析后的 DOM** 上做 —— 那里的父子关系才是最终生效的那份。
function toolboxLineAt(text, idx) {
    let n = 1;
    for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
}

// 结构检查：返回 { errors: [{line, msg}], fatal: bool }
// fatal = "标签没配平 / 有裸 <" —— 代码区 → 编辑区时遇到它就不动编辑区。
function toolboxLintStructure(text) {
    const s = String(text || '');
    const errors = [];
    const stack = [];
    const VOID = { img: 1, br: 1, hr: 1, col: 1, input: 1, meta: 1, link: 1, source: 1, wbr: 1, area: 1, base: 1, embed: 1, param: 1, track: 1 };
    const OK = {};
    for (let i = 0; i < TOOLBOX_OK_TAGS.length; i++) OK[TOOLBOX_OK_TAGS[i].toLowerCase()] = 1;
    // 注释 / doctype / CDATA / 处理指令 都整体跳过 —— 不跳的话其中的 < 会被误报成裸 <
    const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/([a-zA-Z][a-zA-Z0-9:_-]*)\s*>|<([a-zA-Z][a-zA-Z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
    const checkText = function (chunk, at) {
        const bare = chunk.indexOf('<');
        if (bare >= 0) errors.push({ line: toolboxLineAt(s, at + bare), msg: '未转义的 <（应为 &lt;）' });
        const amp = /&(?!(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/.exec(chunk);
        if (amp) errors.push({ line: toolboxLineAt(s, at + amp.index), msg: '未转义的 &（应为 &amp;）' });
    };
    let cursor = 0, m;
    while ((m = TAG.exec(s))) {
        checkText(s.slice(cursor, m.index), cursor);
        cursor = TAG.lastIndex;
        const closing = !!m[1];
        const name = String(m[1] || m[2] || '').toLowerCase();
        const selfClosed = m[4] === '/';
        if (!name) continue;                                   // 注释/doctype 之类
        if (TOOLBOX_BAD_TAGS.indexOf(name) >= 0) {
            errors.push({ line: toolboxLineAt(s, m.index), msg: '不允许的标签 <' + name + '>' });
        }
        if (closing) {
            let found = -1;
            for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) { found = i; break; }
            if (found < 0) {
                if (!VOID[name]) errors.push({ line: toolboxLineAt(s, m.index), msg: '多余的 </' + name + '>' });
            } else {
                for (let i = stack.length - 1; i > found; i--) {
                    errors.push({ line: stack[i].line, msg: '<' + stack[i].name + '> 未闭合' });
                }
                stack.length = found;
            }
        } else if (!VOID[name] && !selfClosed) {
            stack.push({ name: name, line: toolboxLineAt(s, m.index) });
        }
    }
    checkText(s.slice(cursor), cursor);
    for (let i = 0; i < stack.length; i++) errors.push({ line: stack[i].line, msg: '<' + stack[i].name + '> 未闭合' });
    const fatal = /(未闭合|多余的|未转义的)/.test(errors.map(function (e) { return e.msg; }).join(' '));
    return { errors: errors, fatal: fatal };
}

// ========== 颜色检查（只对"颜色类属性"做，别的属性一律不碰）==========
// ★ 这一节的来历：以前用的是 /(?:color|background|border|border-[\w-]+|outline)/，
//   于是 border-collapse / border-width / border-style 全都被当成"颜色属性"，
//   而表格默认样式里就有 border-collapse:collapse —— 每次插表格，校验区都会冒出
//   「颜色不是 hex / var(--…)：collapse」这条假警告。假警告比不报还坏：
//   真问题会被淹掉，用户干脆不看校验区了。
//
// 规则：
//   · 只有下面这些**颜色属性**才整段值当颜色看；
//   · 简写属性（background / border / border-left …）里宽度、样式、颜色混在一起，
//     所以只挑"颜色样子的 token"来查（#hex / rgb() / hsl() / var() / 认得出来的具名颜色）；
//   · 认不出来的一律**不报**（宁可沉默，也不制造噪音）。
const TOOLBOX_COLOR_PROPS = ['color', 'background-color', 'border-color', 'border-top-color',
    'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color',
    'caret-color', 'fill', 'stroke'];
const TOOLBOX_COLOR_SHORTHANDS = ['background', 'border', 'border-top', 'border-right',
    'border-bottom', 'border-left', 'outline', 'text-decoration', 'column-rule'];
// 这些写法直接放过
const TOOLBOX_COLOR_PASS = ['transparent', 'currentcolor', 'inherit', 'unset', 'initial',
    'revert', 'none', 'auto'];
// 具名颜色 → 建议的 hex（只收常见的；收不到的就不报）
const TOOLBOX_NAMED_COLORS = {
    black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080', white: '#ffffff',
    maroon: '#800000', red: '#ff0000', purple: '#800080', fuchsia: '#ff00ff', magenta: '#ff00ff',
    green: '#008000', lime: '#00ff00', olive: '#808000', yellow: '#ffff00', navy: '#000080',
    blue: '#0000ff', teal: '#008080', aqua: '#00ffff', cyan: '#00ffff', orange: '#ffa500',
    gold: '#daa520', goldenrod: '#daa520', pink: '#ffc0cb', brown: '#a52a2a', beige: '#f5f5dc',
    ivory: '#fffff0', khaki: '#f0e68c', tan: '#d2b48c', salmon: '#fa8072', tomato: '#ff6347',
    crimson: '#dc143c', chocolate: '#d2691e', coral: '#ff7f50', indigo: '#4b0082',
    violet: '#ee82ee', plum: '#dda0dd', orchid: '#da70d6', turquoise: '#40e0d0',
    azure: '#f0ffff', lavender: '#e6e6fa', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
    darkgray: '#a9a9a9', darkgrey: '#a9a9a9', darkblue: '#00008b', darkred: '#8b0000',
    darkgreen: '#006400', lightblue: '#add8e6', lightgreen: '#90ee90', lightyellow: '#ffffe0',
    whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', slategray: '#708090', slategrey: '#708090',
    dimgray: '#696969', dimgrey: '#696969', royalblue: '#4169e1', steelblue: '#4682b4',
    skyblue: '#87ceeb', seagreen: '#2e8b57', firebrick: '#b22222', rosybrown: '#bc8f8f',
    wheat: '#f5deb3', linen: '#faf0e6', seashell: '#fff5ee', honeydew: '#f0fff0',
    mintcream: '#f5fffa', midnightblue: '#191970', darkslategray: '#2f4f4f',
    darkslategrey: '#2f4f4f', mediumblue: '#0000cd', cornflowerblue: '#6495ed',
    dodgerblue: '#1e90ff', forestgreen: '#228b22', olivedrab: '#6b8e23',
    darkorange: '#ff8c00', orangered: '#ff4500', deeppink: '#ff1493', hotpink: '#ff69b4',
    mediumvioletred: '#c71585', rebeccapurple: '#663399'
};

// 'a: b; c: d' → [['a','b'], ['c','d']]
function toolboxStylePairs(style) {
    const out = [];
    const parts = String(style || '').split(';');
    for (let i = 0; i < parts.length; i++) {
        const at = parts[i].indexOf(':');
        if (at < 0) continue;
        const k = parts[i].slice(0, at).trim().toLowerCase();
        const v = parts[i].slice(at + 1).trim();
        if (k) out.push([k, v]);
    }
    return out;
}

// 从一段值里挑出"颜色样子的 token"（简写属性用）
function toolboxColorTokens(v) {
    const s = String(v || '');
    const out = [];
    const re = /#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^)]*\)|var\(--[A-Za-z0-9_-]+\)|url\([^)]*\)/g;
    let m;
    while ((m = re.exec(s))) out.push(m[0]);
    const rest = s.replace(re, ' ').toLowerCase();
    const words = rest.match(/[a-z]+/g) || [];
    for (let i = 0; i < words.length; i++) {
        if (TOOLBOX_NAMED_COLORS[words[i]]) out.push(words[i]);     // 只认名单里的具名颜色
    }
    return out;
}

// 单个颜色 token 是否可接受；返回 '' 表示通过。
function toolboxCheckColorToken(tok, prop) {
    const t = String(tok || '').trim();
    if (!t) return '';
    const low = t.toLowerCase();
    if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return '';   // hex
    if (/^var\(--[A-Za-z0-9_-]+\)$/.test(t)) return '';                               // 站内主题变量
    if (TOOLBOX_COLOR_PASS.indexOf(low) >= 0) return '';
    if (/^rgba?\(/i.test(t)) return prop + ' 用了 rgb()/rgba()，建议改 hex';
    if (/^hsla?\(/i.test(t)) return prop + ' 用了 hsl()/hsla()，建议改 hex';
    if (TOOLBOX_NAMED_COLORS[low]) return prop + ' 用了具名颜色 ' + low + '，建议改 ' + TOOLBOX_NAMED_COLORS[low];
    return '';                     // 认不出来就不报
}

// 一个"声明"的颜色检查。shorthand=true 表示这是 background/border 这类混写属性。
function toolboxCheckColor(prop, value, shorthand) {
    const v = String(value || '').replace(/!important/gi, '').trim();
    if (!v) return '';
    const toks = toolboxColorTokens(v);
    for (let i = 0; i < toks.length; i++) {
        const msg = toolboxCheckColorToken(toks[i], prop);
        if (msg) return msg;
    }
    if (shorthand) return '';      // 简写：认不出颜色就放过（border-collapse 走的就是这条）
    // 颜色属性：整段值本来就该是一个颜色，认不出来说明这个值看不懂
    const words = (v.replace(/#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^)]*\)|var\(--[A-Za-z0-9_-]+\)|url\([^)]*\)/g, ' ')
        .match(/[A-Za-z]+/g) || []).filter(function (w) {
            const low = w.toLowerCase();
            return TOOLBOX_COLOR_PASS.indexOf(low) < 0 && !TOOLBOX_NAMED_COLORS[low];
        });
    if (words.length) return prop + ' 的颜色值无法解析：' + words[0];
    return '';
}

// 原文里某个元素大概在第几行：DOM 不保留原文位置，只能拿开头那段片段回查。
function toolboxLineOfElement(text, el) {
    const t = String(text || '');
    if (!t || !el) return 0;
    let probe = '';
    try { probe = String(el.outerHTML || '').slice(0, 24); } catch (e) { probe = ''; }
    let at = probe ? t.indexOf(probe) : -1;
    if (at < 0) {
        const tag = String(el.tagName || '').toLowerCase();
        at = tag ? t.toLowerCase().indexOf('<' + tag) : -1;
    }
    return at < 0 ? 0 : toolboxLineAt(t, at);
}

// 属性 / 表格检查（在解析后的 DOM 上做）：返回 [{line?, msg}]。
// 行号拿不到（DOM 不保留原文位置），所以用"附近片段"代替 —— 一样能定位。
function toolboxLintDom(text) {
    const warnings = [];
    let box;
    try { box = toolboxParseBox(text); } catch (e) { return warnings; }
    const snippet = function (el) {
        let s = '';
        try { s = String(el.outerHTML || '').slice(0, 70); } catch (e) { s = el.tagName; }
        return s.replace(/\s+/g, ' ');
    };
    // ① 白名单外的标签
    const all = box.querySelectorAll('*');
    const seen = {};
    for (let i = 0; i < all.length; i++) {
        const t = all[i].tagName.toLowerCase();
        if (TOOLBOX_BAD_TAGS.indexOf(t) >= 0) continue;        // 这些已经在"错误"里报过了
        if (TOOLBOX_OK_TAGS.indexOf(all[i].tagName) < 0 && !seen[t]) {
            seen[t] = 1;
            warnings.push({ msg: '白名单外的标签 <' + t + '>' });
        }
    }
    // ② 表格：每行**有效**列数要齐；<tr> 里不要直接放文本
    // ★ "有效列数"必须把 colspan/rowspan 的占位算进去（见 toolboxTableGrid）：
    //   直接数 <td> 个数的话，合并单元格之后每一行都会被误报成"列数不一致"。
    const tables = box.querySelectorAll('table');
    for (let i = 0; i < tables.length; i++) {
        const rows = tables[i].querySelectorAll('tr');
        const counts = toolboxTableColCounts(tables[i]);
        for (let r = 0; r < rows.length; r++) {
            const kids = rows[r].childNodes;
            for (let k = 0; k < kids.length; k++) {
                if (kids[k].nodeType === 3 && String(kids[k].nodeValue || '').trim()) {
                    warnings.push({ msg: '<tr> 里有文本「' + String(kids[k].nodeValue).trim().slice(0, 20) + '」' });
                    break;
                }
            }
        }
        let uneven = false;
        for (let c = 1; c < counts.length; c++) if (counts[c] !== counts[0]) uneven = true;
        if (uneven) {
            warnings.push({ msg: '表格列数不一致（' + counts.join(' / ') + '）' });
        }
    }
    // ③ <img src>：改为检查"有没有漏加图片后缀"（用户要求 —— 漏后缀比路径前缀更常见）。
    //    · 先把 ?query / #hash 去掉再判（https://…/a.png?s=1 不算漏）；
    //    · data:image/… 只做宽松判断（base64 里出现点号是常事，误报代价更大，直接放过）；
    //    · 认不出来的写成 data: 的其他形态同样放过，只盯"有路径但结尾没有图片后缀"。
    const imgExtRe = /\.(jpe?g|png|webp|gif|svg|bmp|avif|ico|tiff?)$/i;
    const imgs = box.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
        const src = String(imgs[i].getAttribute('src') || '');
        const path = src.split('#')[0].split('?')[0].trim();
        if (/^data:/i.test(path)) continue;                        // data: 形态一律放过
        if (!path) continue;                                       // 空 src 不在这里报
        if (!imgExtRe.test(path)) {
            warnings.push({ msg: '图片路径缺少后缀（.jpg/.png/.webp/.gif 等）：'
                + path.slice(0, 40) });
        }
    }
    // ④ 行内样式里的颜色
    const styleEls = box.querySelectorAll('[style]');
    for (let i = 0; i < styleEls.length; i++) {
        const st = String(styleEls[i].getAttribute('style') || '');
        const pairs = toolboxStylePairs(st);
        const ln = toolboxLineOfElement(text, styleEls[i]);
        for (let k = 0; k < pairs.length; k++) {
            const prop = pairs[k][0], val = pairs[k][1];
            const isColorProp = TOOLBOX_COLOR_PROPS.indexOf(prop) >= 0;
            const isShort = TOOLBOX_COLOR_SHORTHANDS.indexOf(prop) >= 0;
            if (!isColorProp && !isShort) continue;              // 别的属性一律不碰（border-collapse 就是这里被放过的）
            const msg = toolboxCheckColor(prop, val, !isColorProp);
            if (msg) {
                warnings.push({ line: ln, msg: msg });
                break;                                            // 同一个元素只报一条，别刷屏
            }
        }
    }
    // ⑤ 外部链接缺 target="_blank"
    const as = box.querySelectorAll('a[href]');
    for (let i = 0; i < as.length; i++) {
        const href = String(as[i].getAttribute('href') || '');
        if (/^https?:\/\//i.test(href) && as[i].getAttribute('target') !== '_blank') {
            warnings.push({ msg: '外链缺 target="_blank"：' + snippet(as[i]) + '，该链接将在原有窗口打开'});
        }    }
    return warnings;
}

function toolboxLint(text) {
    const st = toolboxLintStructure(text);
    // ★ Error 与 Warning **共存**（用户要求）：结构没配平时照样把 DOM 层能查到的警告一起报出来，
    //   两者不再互相覆盖。判定规则本身一条都没改，只是不再因为 fatal 就把 warnings 丢掉。
    let warn = [];
    try { warn = toolboxLintDom(text) || []; } catch (e) { warn = []; }
    return { errors: st.errors, warnings: warn, fatal: st.fatal };
}

// 把校验结果画到代码区下面那块。
// ★ 先列全部 Error，再列全部 Warning（各自带原有计数）—— 两类同时显示，互不覆盖。
// 计数同时写在 data-* 上：用例直接读属性断言，不用去解析文案。
function toolboxValidate() {
    const box = toolboxTpl && toolboxTpl.validate;
    const code = toolboxCodeText();
    if (!box) return;
    const res = toolboxLint(code);
    const errs = res.errors || [], warns = res.warnings || [];
    box.setAttribute('data-errors', String(errs.length));
    box.setAttribute('data-warnings', String(warns.length));
    box.setAttribute('data-fatal', res.fatal ? '1' : '0');
    if (!code.trim()) {
        box.innerHTML = '<div class="tb-lint-ok"></div>';
        return;
    }
    if (!errs.length && !warns.length) {
        box.innerHTML = '<div class="tb-lint-ok">Accepted</div>';
        return;
    }
    // 文案尽量短：有问题就把条数放出来，每条尽量一行内说清。
    let html = '<div class="tb-lint-head"> ';
    if (errs.length) html += '<b class="tb-lint-bad">Error ' + errs.length + '</b>';
    if (errs.length && warns.length) html += ' ';
    if (warns.length) html += '<b class="tb-lint-warn">Warning ' + warns.length + '</b>';
    html += '</div>';
    const line = function (kind, it) {
        return '<li class="tb-lint-' + kind + '">' + (it.line ? 'Line ' + it.line + '：' : '') + toolboxEsc(it.msg) + '</li>';
    };
    // Error 在 Warning 上面：两块各自一个列表，条数分别为 min(总数, 20)
    if (errs.length) {
        html += '<ul class="tb-lint-list tb-lint-errors">';
        for (let i = 0; i < errs.length && i < 20; i++) html += line('bad', errs[i]);
        if (errs.length > 20) html += '<li class="tb-lint-bad">…还有 ' + (errs.length - 20) + ' 条错误</li>';
        html += '</ul>';
    }
    if (warns.length) {
        html += '<ul class="tb-lint-list tb-lint-warnings">';
        for (let i = 0; i < warns.length && i < 20; i++) html += line('warn', warns[i]);
        if (warns.length > 20) html += '<li class="tb-lint-warn">…还有 ' + (warns.length - 20) + ' 条警告</li>';
        html += '</ul>';
    }
    box.innerHTML = html;
}

// ========== 代码区 → 编辑区 ==========
// 把代码区的文本解析进编辑区。structural=true 表示这次来自"用户手改代码/撤回"，
// 已经过了结构检查，可以放心覆盖。
function toolboxApplyCodeToEditor(text, force) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    if (!force) {
        const st = toolboxLintStructure(text);
        // ★ 结构没配平（用户正打到一半）就不动编辑区：留着上一次可用的内容，
        //   报错交给校验区。宁可"没跟上"，也不能把左边清空或塞进一棵乱七八糟的树。
        if (st.fatal) return false;
    }
    const box = toolboxParseBox(text);
    sanitizeToolboxNode(box);
    ed.innerHTML = box.innerHTML || '<p><br></p>';
    // ★ 导入时把源码里**已经写着的空段落**（`<p></p>` / `<p><br></p>`）就地归一成根级 `<br>`
    //   —— 空行在编辑器里只有这一种形态，才谈得上"打字变 <p>、删空退回 <br>"的稳定互转，
    //   也才谈得上"导出→导入→导出逐字节幂等"（用户点名要求）。
    toolboxImportBlankLines(ed);
    // ★ 代码是"按行排版"的（块与块之间有 \n），灌进编辑区后这些 \n 会变成真实的
    //   空白文本节点。它们对渲染没影响，却会让"撤回后按文字指纹重新定位选区"失配
    //   （指纹是在没有这些节点的 DOM 上采集的）→ 光标瞬移到文首。所以灌完立刻清掉。
    toolboxNormalizeEditorWhitespace(ed);
    // ★★ 提示语收口（用户要求"放进唯一出口，不要逐条补"）：**整篇换内容**只有这一条路
    //   —— 撤回/重做（toolboxUndoStep）、代码区→编辑区（toolboxCodeToEditor）、
    //   程序化灌入/重置/导入，全都落在这里。它一改内容就同步提示语，
    //   于是"撤回到全空之后提示语不回来"这类漏判不会再有第二次。
    //   （打字/删除那条**就地**改内容的路走 toolboxRefresh，那里同样有这个调用。）
    toolboxHintSync();
    return true;
}

function toolboxCodeToEditor() {
    toolboxCodeApplyTimer = 0;
    if (!toolboxTpl || !toolboxTpl.editor) return;
    const text = toolboxCodeText();
    const ok = toolboxApplyCodeToEditor(text, false);
    if (!ok) { toolboxValidate(); return; }                   // 结构没配平：编辑区保持原样
    // ★ 提示语不在这里单独补：toolboxApplyCodeToEditor() 末尾已经收口（所有整篇换内容的路共用它）
    toolboxSyncBusy = true;                                   // ★ 抑制位：下面的 refresh 不许回头写代码区
    try {
        toolboxCodeDirty = false;
        const n = toolboxCountChars(toolboxTpl.editor);
        if (toolboxTpl.count) toolboxTpl.count.textContent = String(n);
        toolboxValidate();
    } finally {
        toolboxSyncBusy = false;
    }
    toolboxScheduleDraftSave();
}

function toolboxScheduleCodeToEditor() {
    if (toolboxCodeApplyTimer) clearTimeout(toolboxCodeApplyTimer);
    toolboxCodeApplyTimer = setTimeout(toolboxCodeToEditor, TOOLBOX_CODE_DEBOUNCE);
}

// ========== 撤回 / 恢复（自己的快照栈）==========
// ★ 为什么不用 document.execCommand('undo')：
//   ① 它只管编辑区，管不到"代码区里手改的那份文本"；
//   ② 两个面板之间的同步回显会被它记成一堆没有意义的步骤（按一次像没反应）。
//   所以自己存快照：**代码区文本 + 编辑区选区**，一份快照就是一次"用户真实编辑"。
//   同步产生的更新（toolboxSyncBusy / toolboxUndoBusy）一律不入栈。
const TOOLBOX_UNDO_MAX = 50;         // 上限 50 条
const TOOLBOX_UNDO_MERGE_MS = 500;   // 同一处连续输入在这个窗口内合并成一条

let toolboxUndo = { stack: [], index: -1, lastAt: 0, busy: false, timer: 0 };

// 选区 → 路径（从编辑区根往下的子节点下标 + 偏移），可以跨"重新解析"存活
function toolboxSelPath(root, node) {
    const path = [];
    let n = node;
    while (n && n !== root) {
        const p = n.parentNode;
        if (!p) return null;
        path.unshift(Array.prototype.indexOf.call(p.childNodes, n));
        n = p;
    }
    return n === root ? path : null;
}
function toolboxNodeAtPath(root, path) {
    let n = root;
    for (let i = 0; i < path.length; i++) {
        if (!n || !n.childNodes || !n.childNodes[path[i]]) return null;
        n = n.childNodes[path[i]];
    }
    return n;
}
function toolboxSnapshotSel() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return null;
    try {
        const sel = window.getSelection && window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const r = sel.getRangeAt(0);
        if (!ed.contains(r.commonAncestorContainer)) return null;
        const a = toolboxSelPath(ed, r.startContainer), b = toolboxSelPath(ed, r.endContainer);
        if (!a || !b) return null;
        // ★ 除了"子节点下标路径"，再存一份**文字指纹**（选中文字 + 前后各 20 字）。
        //   撤回/重做会把整篇重新解析一遍，DOM 是全新的一棵，旧路径指到的往往是别的节点
        //   —— 用户实测"Ctrl+Z 之后光标瞬移到别处"。指纹是在**当前 DOM** 上重新定位的，
        //   不依赖任何旧偏移/旧节点（见 toolboxRestoreSnapshotSel）。
        let fp = null;
        try { fp = toolboxSelectionFingerprint(r, ed); } catch (e) { fp = null; }
        return { a: a, ao: r.startOffset, b: b, bo: r.endOffset, fp: fp };
    } catch (e) { return null; }
}
// 落点是不是"同一段文字的同一位置附近"（±1 字符：指纹里的前后文对得上就算数）
function toolboxSelClose(a, b) {
    if (a === b) return true;
    const x = String(a || ''), y = String(b || '');
    if (!x || !y) return true;                       // 一边没上下文：不据此否决
    const n = Math.min(x.length, y.length, 8);
    let same = 0;
    for (let i = 0; i < n; i++) if (x.charAt(i) === y.charAt(i)) same++;
    return same >= n - 1;
}
function toolboxRestoreSnapshotSel(snap) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !snap) return;
    // ① 首选：按**文字指纹**在当前 DOM 上重新解析（唯一可靠的一条路）
    if (snap.fp && snap.fp.ok) {
        let r2 = null;
        try { r2 = toolboxRangeFromFingerprint(ed, snap.fp); } catch (e) { r2 = null; }
        if (r2) {
            let got = null;
            try { got = toolboxSelectionFingerprint(r2, ed); } catch (e) { got = null; }
            const good = got && got.ok && got.collapsed === snap.fp.collapsed
                && toolboxSelClose(got.text, snap.fp.text)
                && toolboxSelClose(got.after, snap.fp.after)
                && toolboxSelClose(got.before, snap.fp.before);
            if (good) {
                toolboxSelectRange(r2);
                try { toolboxRange = r2.cloneRange(); } catch (e) {}
                return;
            }
        }
    }
    // ② 退回"子节点路径"，但落点必须和指纹对得上；对不上就换"锚点前那段文字之后"的光标；
    //   再不行就**什么都不做**。
    //   ★ 绝不 toolboxCaretAtEnd()：那正是"光标瞬移到文首/文末"的来源。
    try {
        const a = toolboxNodeAtPath(ed, snap.a), b = toolboxNodeAtPath(ed, snap.b);
        const sel = window.getSelection && window.getSelection();
        if (a && b && sel) {
            const r = document.createRange();
            r.setStart(a, Math.min(snap.ao, a.nodeType === 3 ? a.nodeValue.length : a.childNodes.length));
            r.setEnd(b, Math.min(snap.bo, b.nodeType === 3 ? b.nodeValue.length : b.childNodes.length));
            let got = null;
            try { got = toolboxSelectionFingerprint(r, ed); } catch (e2) { got = null; }
            const okNow = !snap.fp || !snap.fp.ok
                || (got && got.ok && got.collapsed === snap.fp.collapsed
                    && toolboxSelClose(got.text, snap.fp.text)
                    && toolboxSelClose(got.after, snap.fp.after));
            if (okNow) {
                sel.removeAllRanges();
                sel.addRange(r);
                toolboxRange = r.cloneRange();
                return;
            }
        }
    } catch (e) { /* 定位不了就往下走兜底 */ }
    // ③ 最后兜底：选中的文字已经没了（撤回掉刚敲的内容）→ 把光标放回"锚点前那段文字之后"
    let c = null;
    try { c = toolboxCaretFromFingerprint(ed, snap.fp); } catch (e2) { c = null; }
    if (c) {
        toolboxSelectRange(c);
        try { toolboxRange = c.cloneRange(); } catch (e2) {}
    }
}

function toolboxUndoSnapshot() {
    return { code: toolboxCodeText(), sel: toolboxSnapshotSel() };
}
function toolboxUndoPush(merge) {
    if (toolboxUndo.busy || toolboxSyncBusy) return;
    const snap = toolboxUndoSnapshot();
    const top = toolboxUndo.stack[toolboxUndo.index];
    if (top && top.code === snap.code) return;                 // 内容没变：不入栈
    const now = Date.now();
    if (merge && toolboxUndo.index > 0 && (now - toolboxUndo.lastAt) < TOOLBOX_UNDO_MERGE_MS) {
        // 连续打字：把上一条替换掉，而不是一直堆 —— 否则长按 Ctrl+Z 要按几十次
        toolboxUndo.stack[toolboxUndo.index] = snap;
    } else {
        toolboxUndo.stack = toolboxUndo.stack.slice(0, toolboxUndo.index + 1);
        toolboxUndo.stack.push(snap);
        if (toolboxUndo.stack.length > TOOLBOX_UNDO_MAX) toolboxUndo.stack.shift();
        toolboxUndo.index = toolboxUndo.stack.length - 1;
    }
    toolboxUndo.lastAt = now;
    toolboxUndoButtons();
}
// 用户改动之后稍微等一下再入栈：等"编辑区 → 代码区"的归一化写完，
// 存下来的才是最终那份文本（否则存的是中间态，撤回一步看起来没变化）。
function toolboxUndoSoon() {
    if (toolboxUndo.busy) return;
    if (toolboxUndo.timer) clearTimeout(toolboxUndo.timer);
    toolboxUndo.timer = setTimeout(function () { toolboxUndo.timer = 0; toolboxUndoPush(true); }, 160);
}
function toolboxUndoReset() {
    if (toolboxUndo.timer) { clearTimeout(toolboxUndo.timer); toolboxUndo.timer = 0; }
    // ★ 起点快照用**编辑区那一份**（净化 + 按行排版后的导出），不要照抄代码区的原文：
    //   代码区可能正停在一段没通过结构检查的半截文本上（那次改动本来就没进编辑区），
    //   照抄进来的话，一按撤回就会把那段半截内容灌进编辑区。
    const ed = toolboxTpl && toolboxTpl.editor;
    // ★ 起点快照用**编辑区那一份**（净化 + 按行排版后的导出），不要照抄代码区的原文：
    //   代码区可能正停在一段没通过结构检查的半截文本上（那次改动本来就没进编辑区），
    //   照抄进来的话，一按撤回就会把那段半截内容灌进编辑区。
    // ★ "编辑区是空的" ⇒ 快照就是空串（与代码区显示的那份一致）：否则起点快照会是一根
    //   独立空行 `<br>`（空编辑区的净化结果），撤回回到起点时编辑区变成"只有空行"的形态 ——
    //   代码区是空的、提示语却因为"有 <br>"不回来（用户实测 bug 3 的另一半原因）。
    const base = ed
        ? (toolboxEditorEmpty() ? '' : toolboxFormatHtml(toolboxParseBox(toolboxCleanHtml())))
        : toolboxCodeText();
    toolboxUndo = {
        stack: [{ code: base, sel: toolboxSnapshotSel() }],
        index: 0, lastAt: 0, busy: false, timer: 0
    };
    toolboxUndoButtons();
}
function toolboxUndoButtons() {
    const m = toolboxTpl && toolboxTpl.modal;
    if (!m) return;
    const u = m.querySelector('[data-tb="undo"]'), r = m.querySelector('[data-tb="redo"]');
    if (u) u.disabled = toolboxUndo.index <= 0;
    if (r) r.disabled = toolboxUndo.index >= toolboxUndo.stack.length - 1;
}
function toolboxUndoStep(dir) {
    const from = toolboxUndo.index;
    const next = toolboxUndo.index + dir;
    if (next < 0 || next >= toolboxUndo.stack.length) return false;
    toolboxUndo.index = next;
    const snap = toolboxUndo.stack[next];
    const leaving = toolboxUndo.stack[from];
    toolboxUndo.busy = true;                                   // ★ 这次改动不是"用户编辑"，不入栈
    try {
        if (toolboxTpl.code) toolboxTpl.code.value = snap.code;
        toolboxApplyCodeToEditor(snap.code, true);
        const n = toolboxCountChars(toolboxTpl.editor);
        if (toolboxTpl.count) toolboxTpl.count.textContent = String(n);
        // ★ 光标该落在哪儿：**撤回**用"我们离开那一格"记的选区 —— 那正是用户刚才动手的位置
        //   （用户实测："Ctrl+Z 之后光标瞬移到别处"）；**重做**用"要去那一格"记的选区。
        //   两边都失败时再试另一个，最后退到"锚点前那段文字之后"（见 toolboxRestoreSnapshotSel）。
        //   定位全部基于**重新解析后的当前 DOM**（文字指纹），不用任何已经失效的旧偏移/旧节点。
        const want = (dir < 0) ? (leaving && leaving.sel) : (snap && snap.sel);
        const alt = (dir < 0) ? (snap && snap.sel) : (leaving && leaving.sel);
        toolboxRestoreSnapshotSel(want || alt);
        if (alt && alt !== want) {
            // want 没落到同一段文字上（比如那一段文字被这一步改动删掉了）→ 用另一个再试一次
            const ed = toolboxTpl.editor;
            let landed = false;
            try {
                const sel = window.getSelection && window.getSelection();
                if (sel && sel.rangeCount) {
                    const cur = toolboxSelectionFingerprint(sel.getRangeAt(0), ed);
                    landed = !!(cur && cur.ok && want && want.fp && want.fp.ok
                        && toolboxSelClose(cur.text, want.fp.text)
                        && toolboxSelClose(cur.after, want.fp.after)
                        && toolboxSelClose(cur.before, want.fp.before));
                }
            } catch (e2) { landed = false; }
            if (!landed) toolboxRestoreSnapshotSel(alt);
        }
        toolboxValidate();
    } finally {
        toolboxUndo.busy = false;
    }
    toolboxUndoButtons();
    toolboxScheduleDraftSave();
    return true;
}


// ========== 窗口：拖动 / 八向缩放 / 全屏 ==========
// 让工具箱弹窗像个真窗口（Word 那样）：按住标题栏能拖、八个方向能拉、能全屏和还原。
//
// ★ 站内没有可复用的窗口拖动实现 —— collection/tools/tests/verify-modal-drag.mjs 里的
//   MODAL_DRAG_SLOP / MODAL_DRAG_HOLD_MS 是图片灯箱"下滑关闭"的手势阈值，跟拖动窗口
//   没有任何关系，所以这里自己实现，也**没动**灯箱那套逻辑。
//
// ★ 位置与尺寸**不持久化**（用户明确要求）：不写 localStorage / sessionStorage。
//   理由：上次在大屏上拉大的窗口，下次在小屏或分屏里打开就可能跑到可视区外，用户还拖不回来；
//   每次打开都用"默认居中尺寸"反而永远在可控范围内。所以关掉弹窗 = 丢弃本次的宽高位置，
//   下次打开回到默认。拖动/缩放只在**本次打开期间**有效。
//   （草稿是另一件事，仍然照常写 localStorage。）
//
// ★ 统一用 Pointer Events（鼠标与触摸同一套代码）+ setPointerCapture：
//   capture 之后 pointermove/pointerup 都会打到开始那个元素上，鼠标划出窗口也不会丢事件。
//   拖动期间给 body 加 .tb-window-drag（user-select:none），抬起时摘掉，监听也一起摘。
const TOOLBOX_MIN_W = 480;             // 最小宽度
const TOOLBOX_MIN_H = 320;             // 最小高度
const TOOLBOX_HEAD_MIN = 44;           // 标题栏大约的高度：拖动时至少要留这么多在视口里
// 八个手柄的方向：四条边只改一个维度，四个角等比缩放
const TOOLBOX_GRIPS = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

let toolboxWin = { left: 0, top: 0, w: 0, h: 0, ready: false, full: false, prev: null, session: null };

// 默认几何：宽 min(1400px, 96vw)、高 90vh、居中（与 CSS 里的默认值保持一致）
function toolboxWinDefault() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(1400, vw * 0.96);
    const h = vh * 0.9;
    return { left: Math.round((vw - w) / 2), top: Math.round((vh - h) / 2), w: Math.round(w), h: Math.round(h) };
}

// 夹到"整窗横向可见 + 标题栏纵向可见"的范围里。
// 这条约束保证用户永远能把窗口拖回来 —— 不会出现"窗口跑到屏幕外，只能刷新页面"。
function toolboxWinFit(w, h, left, top) {
    const vw = window.innerWidth, vh = window.innerHeight;
    w = Math.max(Math.min(TOOLBOX_MIN_W, vw), Math.min(Math.round(w), vw));
    h = Math.max(Math.min(TOOLBOX_MIN_H, vh), Math.min(Math.round(h), vh));
    left = Math.max(0, Math.min(Math.round(left), vw - w));
    top = Math.max(0, Math.min(Math.round(top), Math.max(0, vh - Math.min(h, TOOLBOX_HEAD_MIN))));
    return { left: left, top: top, w: w, h: h };
}

// 把几何写进 inline style。窗口位置只有一个来源，就是这个函数。
function toolboxWinApply(geo) {
    const card = toolboxTpl && toolboxTpl.card;
    if (!card) return;
    const g = toolboxWinFit(geo.w, geo.h, geo.left, geo.top);
    toolboxWin.left = g.left; toolboxWin.top = g.top; toolboxWin.w = g.w; toolboxWin.h = g.h;
    toolboxWin.ready = true;
    card.style.left = g.left + 'px';
    card.style.top = g.top + 'px';
    card.style.width = g.w + 'px';
    card.style.height = g.h + 'px';
    card.style.maxHeight = 'none';
    return g;
}

// 全屏态：位置尺寸就是整个视口（仍然走 toolboxWinApply 这一条路）
// ========== 全屏 / 小窗 按钮的图标（内联 SVG，用户直接给的，逐字照抄）==========
// ★ 不再用字体符号（⛶ / ⤡ 在不同系统、不同字体里字形完全不一样，之前观感不对就是它），
//   也不再自己画方框 —— 下面两段 SVG 是用户提供的原样标记：
//   属性顺序、viewBox="0 0 24 24"、stroke-width="2"、stroke-linecap/linejoin="round"、
//   aria-hidden="true"、四段 path 的 d 全部照抄；**只把渲染尺寸交给 CSS**（.tb-win svg，
//   17px，跟右上角「关闭」一样高），stroke="currentColor" 保留 → 跟着主题与 hover 变色。
//   两个图标靠第一段 path 的 d 区分：full = "M9 4H4v5…"（四角朝外），
//   restore = "M9 4v5H4…"（四角朝内）。
const TOOLBOX_WIN_ICON = {
    full: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"'
        + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
        + ' stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M4 15v5h5"/></svg>',
    restore: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"'
        + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
        + ' stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M20 15h-5v5"/><path d="M4 15h5v5"/></svg>'
};
function toolboxWinIconHtml(kind) {
    return TOOLBOX_WIN_ICON[kind === 'restore' ? 'restore' : 'full'];
}
// 把按钮刷成"当前该显示的那个图标 + 对应的完整说明"（图标本身不表意，title 是唯一线索）
function toolboxWinIconPaint(btn, full) {
    if (!btn) return;
    btn.innerHTML = toolboxWinIconHtml(full ? 'restore' : 'full');
    btn.title = full ? '退出全屏' : '全屏';
    btn.setAttribute('aria-label', full ? '退出全屏' : '全屏');
}

function toolboxWinSetFull(on) {
    const card = toolboxTpl && toolboxTpl.card;
    if (!card) return;
    if (on === toolboxWin.full) return;
    if (on) {
        toolboxWin.prev = { left: toolboxWin.left, top: toolboxWin.top, w: toolboxWin.w, h: toolboxWin.h };
        toolboxWin.full = true;
        card.classList.add('tb-full');
        toolboxWinApply({ left: 0, top: 0, w: window.innerWidth, h: window.innerHeight });
    } else {
        toolboxWin.full = false;
        card.classList.remove('tb-full');
        const prev = toolboxWin.prev || toolboxWinDefault();
        toolboxWin.prev = null;
        toolboxWinApply(prev);
    }
    // 全屏中显示"两个叠起来的方框"（还原），非全屏显示"一个方框"（进入全屏）
    toolboxWinIconPaint(toolboxTpl.fullBtn, toolboxWin.full);
}

function toolboxWinToggleFull() {
    toolboxWinSetFull(!toolboxWin.full);
}

// 拖 / 缩放开始。mode: 'move'（标题栏）或 'resize'（手柄）
function toolboxWinDown(e, mode, dir) {
    const card = toolboxTpl && toolboxTpl.card;
    if (!card || !toolboxWin.ready) return;
    if (toolboxWin.session) return;                                  // 已经有一个手势在跑
    if (toolboxWin.full) return;                                     // 全屏时没什么可拖的
    if (e.pointerType === 'mouse' && e.button !== 0) return;         // 只认左键
    if (mode === 'move') {
        // 标题栏上的按钮（全屏/关闭）不触发拖动，否则点按钮会顺带把窗口挪一下
        const t = e.target;
        if (t && t.closest && t.closest('button, input, label, .tb-grip')) return;
    }
    const r = card.getBoundingClientRect();
    const s = {
        mode: mode, dir: dir || '', x0: e.clientX, y0: e.clientY,
        left: r.left, top: r.top, w: r.width, h: r.height,
        // ★ 等比基准在**按下那一刻**算一次。每次 move 都重算的话，
        //   比例的微小误差会一轮轮累积，窗口会自己慢慢"漂"变形。
        ratio: r.height > 0 ? (r.width / r.height) : 1,
        target: e.currentTarget, pid: e.pointerId
    };
    toolboxWin.session = s;
    e.preventDefault();                          // 别让手势顺手选中文字
    try { s.target.setPointerCapture(e.pointerId); } catch (err) {}
    s.target.addEventListener('pointermove', toolboxWinMove);
    s.target.addEventListener('pointerup', toolboxWinUp);
    s.target.addEventListener('pointercancel', toolboxWinUp);
    document.body.classList.add('tb-window-drag');
}

function toolboxWinMove(e) {
    const s = toolboxWin.session;
    if (!s || e.pointerId !== s.pid) return;
    e.preventDefault();
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = s.left, top = s.top, w = s.w, h = s.h;
    const twoDirs = s.dir.length === 2;          // 角落 = 等比
    if (s.mode === 'move') {
        left = s.left + dx; top = s.top + dy;
    } else if (twoDirs) {
        // ---- 四角：等比缩放（保持按下时的宽高比）----
        const hasE = s.dir.indexOf('e') >= 0;    // 含 e = 右边在动；含 w = 左边在动
        const hasS = s.dir.indexOf('s') >= 0;    // 含 s = 下边在动；含 n = 上边在动
        const r = s.ratio;
        // 横向拖动推出的宽度、纵向拖动推出的宽度，取"跟手更明显"的那个
        const wFromX = hasE ? s.w + dx : s.w - dx;
        const wFromY = (hasS ? s.h + dy : s.h - dy) * r;
        let candW = Math.abs(wFromX - s.w) >= Math.abs(wFromY - s.w) ? wFromX : wFromY;
        // 上限：动的那个方向不能越过视口；不动的那个方向由"固定住的那条边"决定
        const maxWByX = hasE ? (vw - s.left) : (s.left + s.w);
        const maxWByY = (hasS ? (vh - s.top) : (s.top + s.h)) * r;
        const minW = Math.max(TOOLBOX_MIN_W, TOOLBOX_MIN_H * r);   // 最小约束同时施加到宽和高
        candW = Math.max(minW, Math.min(candW, Math.max(minW, Math.min(maxWByX, maxWByY))));
        w = candW; h = candW / r;
        // 与固定角相反的那两条边跟着动（拖左上角 → 右/下边界不动，left/top 变）
        left = hasE ? s.left : (s.left + s.w - w);
        top = hasS ? s.top : (s.top + s.h - h);
    } else if (s.dir === 'e') {
        w = s.w + dx;                                        // 只改宽，左上角不动
    } else if (s.dir === 'w') {
        left = s.left + dx; w = s.left + s.w - left;         // 左边动 = 同时移动原点并改宽，右边不动
    } else if (s.dir === 's') {
        h = s.h + dy;                                        // 只改高，左上角不动
    } else if (s.dir === 'n') {
        top = s.top + dy; h = s.top + s.h - top;             // 上边动 = 同时移动原点并改高，下边不动
    }
    toolboxWinApply({ left: left, top: top, w: w, h: h });
}

function toolboxWinUp(e) {
    const s = toolboxWin.session;
    if (!s) return;
    if (e && e.pointerId !== undefined && e.pointerId !== s.pid) return;
    toolboxWin.session = null;
    try { s.target.releasePointerCapture(s.pid); } catch (err) {}
    // ★ 会话级监听当场摘掉：不在 document/window 上留任何 pointer 监听，
    //   所以开关多少次都不会累积（用例里那个探针就是查这个）。
    s.target.removeEventListener('pointermove', toolboxWinMove);
    s.target.removeEventListener('pointerup', toolboxWinUp);
    s.target.removeEventListener('pointercancel', toolboxWinUp);
    document.body.classList.remove('tb-window-drag');
}

// 视口变化（旋转屏幕 / 拖浏览器窗口）：把窗口拉回可见范围，全屏时跟着铺满
function toolboxWinOnViewportResize() {
    if (!toolboxWin.ready) return;
    if (toolboxWin.full) { toolboxWinApply({ left: 0, top: 0, w: window.innerWidth, h: window.innerHeight }); return; }
    toolboxWinApply({ left: toolboxWin.left, top: toolboxWin.top, w: toolboxWin.w, h: toolboxWin.h });
}

// 每次打开都回到默认尺寸与位置（全屏也回到非全屏）—— 不读任何存储
function toolboxWinReset() {
    const card = toolboxTpl && toolboxTpl.card;
    if (card) card.classList.remove('tb-full');
    toolboxWin.full = false;
    toolboxWin.prev = null;
    const btn = toolboxTpl && toolboxTpl.fullBtn;
    toolboxWinIconPaint(btn, false);                 // 回到非全屏：图标回到"一个方框"
    toolboxWinApply(toolboxWinDefault());
}

function toolboxBindWindow() {
    const card = toolboxTpl && toolboxTpl.card;
    if (!card) return;
    if (toolboxTpl.head) {
        toolboxTpl.head.addEventListener('pointerdown', function (e) { toolboxWinDown(e, 'move', ''); });
    }
    const grips = card.querySelectorAll('[data-tb-grip]');
    for (let i = 0; i < grips.length; i++) {
        (function (g) {
            const dir = g.getAttribute('data-tb-grip');
            // 手柄上按下时别让浏览器插手（触摸默认会当滚动/缩放手势）
            g.addEventListener('pointerdown', function (e) { toolboxWinDown(e, 'resize', dir); });
        })(grips[i]);
    }
}

// ========== 表格列宽：在编辑区里直接拖列边界 ==========
// 用户要求：鼠标移到列边界上光标变 col-resize，按住拖动改相邻两列的**百分比**占比。
// 三条硬约束：
//   ① 只有**真的拖过**才写 <colgroup>。导入一篇没有列宽定义的老文章时绝不能自动补
//      等分 <colgroup>，否则"导入 → 导出"就不再幂等（前面那条幂等断言会直接挂）。
//   ② 相邻两列之和保持不变、总和恒为 100%、单列不小于 5%（取整后仍然如此）。
//   ③ 一次拖动只入栈**一条**撤回记录（拖动过程中不碰撤回栈）。
const TOOLBOX_COL_HIT = 3;          // 命中区 ±3px（总宽 6px，够准又不会妨碍选字）
const TOOLBOX_COL_MIN_PCT = 5;      // 单列最小占比
const TOOLBOX_COL_JITTER = 2;       // 位移小于这个值不算"拖过"
let toolboxColDrag = null;

function toolboxColCellAt(e) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !e) return null;
    let el = null;
    try { el = document.elementFromPoint(e.clientX, e.clientY); } catch (err) { el = null; }
    const cell = (el && el.closest) ? el.closest('td,th') : null;
    if (!cell || !ed.contains(cell)) return null;
    return cell;
}

// 命中判定：看这个单元格所在那一行里**所有相邻两列之间的边界**，
// 谁离鼠标 x 在 ±3px 内就算命中。
// ★ 为什么不直接看"命中的那个单元格的右边界"：边界那一像素通常已经属于**右边**那一格，
//   elementFromPoint 给回来的是右格，而最后一格的右边不属于任何一对列 ——
//   照着"命中格的右边界"判，就永远也命不中（真机实测过）。
function toolboxColHit(cell, x) {
    if (!cell || !cell.parentNode) return null;
    const cells = Array.prototype.filter.call(cell.parentNode.children, function (c) {
        return c.tagName === 'TD' || c.tagName === 'TH';
    });
    if (cells.length < 2) return null;
    for (let i = 0; i < cells.length - 1; i++) {
        let r = null;
        try { r = cells[i].getBoundingClientRect(); } catch (err) { continue; }
        if (Math.abs(x - r.right) > TOOLBOX_COL_HIT) continue;
        return { left: cells[i], right: cells[i + 1], cells: cells, index: i };
    }
    return null;
}

// 拿（必要时建）table 的 colgroup，并保证 <col> 数量与列数一致
function toolboxColGroup(table, n, create) {
    let cg = null;
    for (let i = 0; i < table.children.length; i++) {
        if (table.children[i].tagName === 'COLGROUP') { cg = table.children[i]; break; }
    }
    if (!cg) {
        if (!create) return null;
        cg = document.createElement('colgroup');
        table.insertBefore(cg, table.firstChild);
    }
    while (cg.children.length < n) cg.appendChild(document.createElement('col'));
    while (cg.children.length > n) cg.removeChild(cg.lastChild);
    return cg;
}

function toolboxColStart(e, hit) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const table = (hit.left.closest) ? hit.left.closest('table') : null;
    if (!ed || !table) return false;
    if (e.pointerType === 'mouse' && e.button !== 0) return false;
    const cells = hit.cells;
    // 量出每一列当前的像素宽 → 归一化成**整数百分比**，最后一列吃掉取整误差，总和恒为 100
    const px = [];
    let sum = 0;
    for (let i = 0; i < cells.length; i++) {
        const w = cells[i].getBoundingClientRect().width || 0;
        px.push(w); sum += w;
    }
    if (!(sum > 0)) return false;
    const pct = [];
    let acc = 0;
    for (let i = 0; i < px.length; i++) {
        if (i === px.length - 1) pct.push(100 - acc);
        else { const v = Math.round(px[i] / sum * 100); pct.push(v); acc += v; }
    }
    toolboxColDrag = {
        table: table, cells: cells, pct: pct, index: hit.index,
        x0: e.clientX, total: sum, pid: e.pointerId, moved: false,
        a0: pct[hit.index], b0: pct[hit.index + 1],
        hadGroup: !!toolboxColGroup(table, cells.length, false)
    };
    e.preventDefault();                                  // 别让这次按下变成选字/拖选
    try { ed.setPointerCapture(e.pointerId); } catch (err) {}
    ed.addEventListener('pointermove', toolboxColMove);
    ed.addEventListener('pointerup', toolboxColUp);
    ed.addEventListener('pointercancel', toolboxColUp);
    document.body.classList.add('tb-col-resize');
    return true;
}

function toolboxColMove(e) {
    const s = toolboxColDrag;
    if (!s || e.pointerId !== s.pid) return;
    e.preventDefault();                                  // 拖动期间不许选中文字
    const d = e.clientX - s.x0;
    if (!s.moved && Math.abs(d) < TOOLBOX_COL_JITTER) return;
    const pair = s.a0 + s.b0;
    const min = Math.min(TOOLBOX_COL_MIN_PCT, Math.floor(pair / 2));
    let a = s.a0 + d / (s.total || 1) * 100;
    a = Math.max(min, Math.min(pair - min, a));
    const A = Math.round(a), B = pair - A;
    if (A < min || B < min || A <= 0 || B <= 0) return;
    s.pct[s.index] = A;
    s.pct[s.index + 1] = B;
    s.moved = true;
    const cg = toolboxColGroup(s.table, s.pct.length, true);
    for (let i = 0; i < s.pct.length; i++) {
        if (cg.children[i]) cg.children[i].setAttribute('style', 'width:' + s.pct[i] + '%;');
    }
    toolboxScheduleRefresh(false);                       // 代码区跟着走（一帧最多一次）
}

function toolboxColUp(e) {
    const s = toolboxColDrag;
    if (!s) return;
    if (e && e.pointerId !== undefined && e.pointerId !== s.pid) return;
    toolboxColDrag = null;
    const ed = toolboxTpl && toolboxTpl.editor;
    if (ed) {
        try { ed.releasePointerCapture(s.pid); } catch (err) {}
        ed.removeEventListener('pointermove', toolboxColMove);
        ed.removeEventListener('pointerup', toolboxColUp);
        ed.removeEventListener('pointercancel', toolboxColUp);
        ed.style.cursor = '';
    }
    document.body.classList.remove('tb-col-resize');
    if (!s.moved) return;                                // 只是点了一下边界：什么都不写
    toolboxSnapClear();
    toolboxStoreRangeNow();
    toolboxUndoPush(false);                              // ★ 一次拖动 = 一条撤回记录
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    toolboxKeepFocus();                                  // 拖完列宽，焦点/光标仍在正文里
}

// ========== 表格操作（光标在表格里右键 → 紧凑小菜单） ==========
// 为什么是右键菜单而不是一排常驻按钮：表格操作是低频动作，常驻一排会把这行工具栏
// 撑爆（已经有 20 个按钮了）。右键菜单零占位、上下文明确，也更接近 Word。
// 菜单项顺序就是这里写的顺序（需求指定的 10 项）。
const TOOLBOX_TM_ITEMS = [
    { act: 'row-above', label: '上方插入行' },
    { act: 'row-below', label: '下方插入行' },
    { act: 'row-del',   label: '删除行' },
    { sep: 1 },
    { act: 'col-left',  label: '左侧插入列' },
    { act: 'col-right', label: '右侧插入列' },
    { act: 'col-del',   label: '删除列' },
    { sep: 1 },
    { act: 'cell-add',  label: '插入单元格', title: '' },
    { act: 'cell-del',  label: '删除单元格' },
    { sep: 1 },
    { act: 'merge',     label: '合并单元格', title: '' },
    { act: 'split',     label: '拆分单元格' }
];

function toolboxTableCellOf(node, ed) {
    let n = node;
    if (!ed) ed = toolboxTpl && toolboxTpl.editor;
    while (n && n !== ed) {
        if (n.nodeType === 1) {
            const t = String(n.tagName || '').toUpperCase();
            if (t === 'TD' || t === 'TH') return n;
        }
        n = n.parentNode;
    }
    return null;
}
function toolboxTableOf(node) {
    return (node && node.closest) ? node.closest('table') : null;
}
function toolboxSpanOf(cell, name) {
    const v = parseInt(cell.getAttribute(name) || '1', 10);
    return (isNaN(v) || v < 1) ? 1 : Math.min(v, 1000);
}
// 表格的"占位网格"：grid[行][列] = { cell, r, c } —— colspan/rowspan 撑开的每个槽都指向同一个单元格。
// ★ 判断"每行有效列数是否一致"、算"当前是第几列"、找"合并的矩形范围"全都靠它：
//   直接数 <td> 个数在合并之后一定是错的（这是需求里点名的那个坑）。
function toolboxTableGrid(table) {
    const trs = (table && table.rows) ? Array.prototype.slice.call(table.rows)
                                      : Array.prototype.slice.call(table.querySelectorAll('tr'));
    const grid = [];
    for (let r = 0; r < trs.length; r++) {
        grid[r] = grid[r] || [];
        let c = 0;
        const cells = Array.prototype.filter.call(trs[r].children, function (x) {
            const t = String(x.tagName || '').toUpperCase();
            return t === 'TD' || t === 'TH';
        });
        for (let i = 0; i < cells.length; i++) {
            while (grid[r][c]) c++;                       // 被上一行的 rowspan 占住了
            const cs = toolboxSpanOf(cells[i], 'colspan');
            const rs = toolboxSpanOf(cells[i], 'rowspan');
            for (let dr = 0; dr < rs; dr++) {
                grid[r + dr] = grid[r + dr] || [];
                for (let dc = 0; dc < cs; dc++) {
                    grid[r + dr][c + dc] = { cell: cells[i], r: r, c: c };
                }
            }
            c += cs;
        }
    }
    return grid;
}
function toolboxGridPosOf(grid, cell) {
    for (let r = 0; r < grid.length; r++) {
        const row = grid[r] || [];
        for (let c = 0; c < row.length; c++) {
            if (row[c] && row[c].cell === cell) return { r: r, c: c };
        }
    }
    return null;
}
function toolboxTableRowCount(table) { return toolboxTableGrid(table).length; }
// 每行的"有效列数"（把 colspan/rowspan 的占位算进去）
function toolboxTableColCounts(table) {
    const grid = toolboxTableGrid(table);
    const out = [];
    for (let r = 0; r < grid.length; r++) {
        let n = 0;
        for (let c = 0; c < (grid[r] || []).length; c++) if (grid[r][c]) n++;
        out.push(n);
    }
    return out;
}
// 表格的列数 = 各行有效列数的最大值（合并之后仍然一致，正常情况就是每行的值）
function toolboxTableCols2(table) {
    const counts = toolboxTableColCounts(table);
    let m = 0;
    for (let i = 0; i < counts.length; i++) m = Math.max(m, counts[i]);
    return m;
}
// 结构变了，手动拖出来的列宽就作废：把 colgroup 整个删掉，
// 否则会出现"colgroup 里的 <col> 数量/百分比和实际列数对不上"的破表。
function toolboxColGroupDrop(table) {
    if (!table || !table.children) return;
    for (let i = table.children.length - 1; i >= 0; i--) {
        if (table.children[i].tagName === 'COLGROUP') table.removeChild(table.children[i]);
    }
}
function toolboxMakeCell(tag) {
    const td = document.createElement(tag || 'td');
    td.appendChild(document.createElement('br'));       // 空单元格也要有 <br>：保证能点进去、能看见
    return td;
}
// 光标所在单元格（吃暂存的选区；菜单是在右键时把位置存好的）
function toolboxCaretCell(ed) {
    if (!ed) ed = toolboxTpl && toolboxTpl.editor;
    const r = toolboxActiveRange();
    if (r && ed && ed.contains(r.startContainer)) {
        const c = toolboxTableCellOf(r.startContainer, ed);
        if (c) return c;
    }
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount) {
        const live = sel.getRangeAt(0);
        if (ed && ed.contains(live.startContainer)) {
            const c2 = toolboxTableCellOf(live.startContainer, ed);
            if (c2) return c2;
        }
    }
    return null;
}
// 把光标放到鼠标点上（右键菜单用）。Chrome 用 caretRangeFromPoint、Firefox 用
// caretPositionFromPoint；都拿不到、或者落点不在这格里，就退到"这一格内容的末尾" ——
// 总之光标必须落在右键点中的那一格里，后面的操作才有明确对象。
function toolboxCaretFromPoint(x, y, cell) {
    let node = null, off = 0;
    try {
        if (document.caretRangeFromPoint) {
            const r = document.caretRangeFromPoint(x, y);
            if (r) { node = r.startContainer; off = r.startOffset; }
        } else if (document.caretPositionFromPoint) {
            const p = document.caretPositionFromPoint(x, y);
            if (p) { node = p.offsetNode; off = p.offset; }
        }
    } catch (e) { node = null; }
    const sel = window.getSelection && window.getSelection();
    if (node && cell && cell.contains(node) && sel) {
        try {
            const rr = document.createRange();
            rr.setStart(node, Math.min(off, node.nodeType === 3 ? node.nodeValue.length : node.childNodes.length));
            rr.collapse(true);
            sel.removeAllRanges();
            sel.addRange(rr);
            toolboxRange = rr.cloneRange();
            return true;
        } catch (e2) {}
    }
    toolboxCaretInCell(cell);
    return false;
}

// 把光标放到某个单元格里（操作完之后别让人找不到北）
function toolboxCaretInCell(cell) {
    if (!cell) return;
    const sel = window.getSelection && window.getSelection();
    if (!sel) return;
    try {
        const r = document.createRange();
        r.selectNodeContents(cell);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
        toolboxRange = r.cloneRange();
    } catch (e) {}
}
// 一次表格操作收尾：存光标、入撤回栈（**一条**记录）、同步草稿与代码区
function toolboxTableDone(dom, cell) {
    const ed = toolboxTpl && toolboxTpl.editor;
    toolboxSnapClear();
    toolboxCaretInCell(cell && cell.parentNode ? cell : null);
    toolboxStoreRangeNow();
    toolboxRefresh();                                    // 先把代码区写成最终那份文本
    toolboxUndoPush(false);                              // ★ 一次操作 = 一条撤回记录
    toolboxScheduleDraftSave();
    return true;
}

// ---- 插入 / 删除：行 ----
function toolboxTableInsertRow(where) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const cell = toolboxCaretCell(ed);
    if (!cell) { toolboxToast('请先将光标置于表格中'); return false; }
    const row = cell.parentNode, table = toolboxTableOf(cell);
    if (!row || !table) return false;
    const grid = toolboxTableGrid(table);
    const pos = toolboxGridPosOf(grid, cell);
    const rowIndex = pos ? pos.r : 0;
    const total = toolboxTableCols2(table);
    if (total < 1) return false;
    const insertAt = where === 'above' ? rowIndex : rowIndex + 1;
    // 上下被 rowspan 跨过来的列：新行在这些列上不放 <td>（槽位由上面那个单元格占着），
    // 并把那个单元格的 rowspan +1 —— 这样结构仍然合法，每行有效列数不变。
    const covered = {};                                  // 列号 -> true（新行里这一列被上面跨下来的格子占着）
    const spanning = [];                                 // 需要 rowspan+1 的单元格
    for (let r = 0; r < grid.length && r < insertAt; r++) {
        for (let c = 0; c < (grid[r] || []).length; c++) {
            const g = grid[r][c];
            if (!g || g.r !== r) continue;               // 只看"从这一行开始"的单元格
            const rs = toolboxSpanOf(g.cell, 'rowspan');
            if (rs < 2 || g.r + rs - 1 < insertAt) continue;
            const cs = toolboxSpanOf(g.cell, 'colspan');
            for (let k = 0; k < cs; k++) covered[g.c + k] = true;
            if (spanning.indexOf(g.cell) < 0) spanning.push(g.cell);
        }
    }
    const tr = document.createElement('tr');
    for (let c = 0; c < total; c++) {
        if (covered[c]) continue;
        tr.appendChild(toolboxMakeCell('td'));           // 新行一律用 <td>：表头行保持原样，别把 <th> 拆坏
    }
    for (let i = 0; i < spanning.length; i++) {
        const el = spanning[i];
        el.setAttribute('rowspan', String(toolboxSpanOf(el, 'rowspan') + 1));
    }
    // 表头行下面插行 → 放进 <tbody>（往 thead 里塞 <td> 行会把表头结构弄乱）
    const parent = row.parentNode;
    const parentTag = String(parent.tagName || '').toUpperCase();
    if (where === 'below' && parentTag === 'THEAD') {
        let tbody = null;
        for (let i = 0; i < table.children.length; i++) {
            if (table.children[i].tagName === 'TBODY') { tbody = table.children[i]; break; }
        }
        if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
        tbody.insertBefore(tr, tbody.firstChild);
    } else if (where === 'above') {
        parent.insertBefore(tr, row);
    } else {
        parent.insertBefore(tr, row.nextSibling);
    }
    toolboxColGroupDrop(table);
    return toolboxTableDone(ed, cell);
}
function toolboxTableDeleteRow() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const cell = toolboxCaretCell(ed);
    if (!cell) { toolboxToast('请先将光标置于表格中'); return false; }
    const row = cell.parentNode, table = toolboxTableOf(cell);
    if (!row || !table) return false;
    // 一行都没有了就没有表格了：直接拒绝（别删成 <table></table>）
    if (toolboxTableRowCount(table) <= 1) { toolboxToast('表格只剩一行，无法删除'); return false; }
    // ★ 行里有跨行合并单元格时拒绝：删掉它会让下面几行的列位整体错位（会变成破表）。
    //   先「拆分单元格」再删行 —— 宁可不做，也不静默留一张坏表。
    const cells = Array.prototype.filter.call(row.children, function (x) {
        const t = String(x.tagName || '').toUpperCase();
        return t === 'TD' || t === 'TH';
    });
    for (let i = 0; i < cells.length; i++) {
        if (toolboxSpanOf(cells[i], 'rowspan') > 1) {
            toolboxToast('请先拆分跨行合并的单元格再删除该行');
            return false;
        }
    }
    const grid = toolboxTableGrid(table);
    const pos = toolboxGridPosOf(grid, cell);
    const rowIndex = pos ? pos.r : 0;
    // 上面跨下来的 rowspan：覆盖被删行的那个单元格要少跨一行
    const fix = [];
    for (let r = 0; r < rowIndex; r++) {
        for (let c = 0; c < (grid[r] || []).length; c++) {
            const g = grid[r][c];
            if (!g || g.r !== r) continue;
            const rs = toolboxSpanOf(g.cell, 'rowspan');
            if (rs > 1 && g.r + rs - 1 >= rowIndex) {
                if (fix.indexOf(g.cell) < 0) fix.push(g.cell);
            }
        }
    }
    const anchor = row.nextSibling;
    row.parentNode.removeChild(row);
    for (let i = 0; i < fix.length; i++) {
        const rs = toolboxSpanOf(fix[i], 'rowspan') - 1;
        if (rs > 1) fix[i].setAttribute('rowspan', String(rs));
        else fix[i].removeAttribute('rowspan');
    }
    // 光标落到原来那一行位置上的单元格
    let next = anchor;
    while (next && !(next.tagName === 'TR')) next = next.nextSibling;
    const target = (next && next.children.length) ? next.children[0] : null;
    toolboxColGroupDrop(table);
    return toolboxTableDone(ed, target || cell);
}

// ---- 插入 / 删除：列 ----
function toolboxTableInsertCol(where) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const cell = toolboxCaretCell(ed);
    if (!cell) { toolboxToast('请先将光标置于表格中'); return false; }
    const table = toolboxTableOf(cell);
    const grid = toolboxTableGrid(table);
    const pos = toolboxGridPosOf(grid, cell);
    if (!pos) return false;
    // ★ 按"有效列索引"算：合并单元格占了好几个槽，左边那几个槽的索引都要算进去
    const at = where === 'left' ? pos.c : pos.c + toolboxSpanOf(cell, 'colspan');
    const trs = Array.prototype.slice.call(table.rows);
    for (let r = 0; r < grid.length; r++) {
        const rowEl = trs[r];
        if (!rowEl) continue;
        const owner = (grid[r] || [])[at] || null;       // 占着"新列位置"的那个单元格
        if (owner && owner.r !== r) continue;            // 上面跨下来的格子：它自己那一行已经处理过了
        if (owner && owner.c < at) {
            // 新列插在这个合并格**内部** → 它跟着变宽（colspan+1），不用拆开
            owner.cell.setAttribute('colspan', String(toolboxSpanOf(owner.cell, 'colspan') + 1));
            continue;
        }
        // 其余情况都是"在这一行插一个空格"：正好从 at 列开始的那个格子插在它前面，
        // 没有更靠右的格子（行短/空洞）就追加到行尾。
        const cells = Array.prototype.filter.call(rowEl.children, function (x) {
            const t = String(x.tagName || '').toUpperCase();
            return t === 'TD' || t === 'TH';
        });
        let before = null;
        for (let i = 0; i < cells.length; i++) {
            const g2 = toolboxGridPosOf(grid, cells[i]);
            if (g2 && g2.c >= at) { before = cells[i]; break; }
        }
        const td = toolboxMakeCell('td');
        if (before) rowEl.insertBefore(td, before);
        else rowEl.appendChild(td);
    }
    toolboxColGroupDrop(table);
    return toolboxTableDone(ed, cell);
}
function toolboxTableDeleteCol() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const cell = toolboxCaretCell(ed);
    if (!cell) { toolboxToast('请先将光标置于表格中'); return false; }
    const table = toolboxTableOf(cell);
    const grid = toolboxTableGrid(table);
    const pos = toolboxGridPosOf(grid, cell);
    if (!pos) return false;
    if (toolboxTableCols2(table) <= 1) { toolboxToast('表格只剩一列，无法删除'); return false; }
    // 目标列：取光标所在单元格覆盖的**整段**列（合并格里的光标删掉整个合并区域太狠了，
    // 这里只删它覆盖的最后一列 —— 和"光标停在哪一列"的直觉一致）
    const target = pos.c + toolboxSpanOf(cell, 'colspan') - 1;
    // 每一行里占着 target 列的那个单元格：colspan>1 就减一，等于 1 就整格删掉
    const seen = [];
    for (let r = 0; r < grid.length; r++) {
        const g = (grid[r] || [])[target];
        if (!g || seen.indexOf(g.cell) >= 0) continue;
        seen.push(g.cell);
    }
    if (!seen.length) return false;
    for (let i = 0; i < seen.length; i++) {
        const el = seen[i];
        const cs = toolboxSpanOf(el, 'colspan');
        if (cs > 1) {
            if (cs - 1 > 1) el.setAttribute('colspan', String(cs - 1));
            else el.removeAttribute('colspan');
        } else if (el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }
    toolboxColGroupDrop(table);
    return toolboxTableDone(ed, cell);
}

// ---- 插入 / 删除：单元格 ----
function toolboxTableAddCell() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const cell = toolboxCaretCell(ed);
    if (!cell) { toolboxToast('请先将光标置于表格中'); return false; }
    const row = cell.parentNode, table = toolboxTableOf(cell);
    if (!row || !table) return false;
    // 需求里只有一项「插入单元格」：默认插到光标所在单元格的**右侧**（标题已经写明）。
    // 用 <td>：即使这一行是 <th> 表头行，<tr> 里混排 <th>/<td> 也是合法 HTML。
    // 插完这一行的有效列数会跟别的行不一致 —— 这是 Word 的行为，故意保留；
    // 校验区按 colspan/rowspan 算有效列数，不会因此报一大堆警告。
    row.insertBefore(toolboxMakeCell('td'), cell.nextSibling);
    toolboxColGroupDrop(table);
    return toolboxTableDone(ed, cell);
}
function toolboxTableDeleteCell() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const cell = toolboxCaretCell(ed);
    if (!cell) { toolboxToast('请先将光标置于表格中'); return false; }
    const row = cell.parentNode, table = toolboxTableOf(cell);
    if (!row || !table) return false;
    const cells = Array.prototype.filter.call(row.children, function (x) {
        const t = String(x.tagName || '').toUpperCase();
        return t === 'TD' || t === 'TH';
    });
    // 只剩一格时删掉就是"空行"：直接拒绝（比"顺手删整行"更不容易误伤数据）
    if (cells.length <= 1) { toolboxToast('该行只剩一个单元格，无法删除'); return false; }
    const next = cell.nextSibling;
    row.removeChild(cell);
    let target = null;
    for (let n = next; n; n = n.nextSibling) {
        const t = String(n.tagName || '').toUpperCase();
        if (t === 'TD' || t === 'TH') { target = n; break; }
    }
    if (!target && cells.length) target = cells[0] === cell ? null : cells[0];
    toolboxColGroupDrop(table);
    return toolboxTableDone(ed, target);
}

// ---- 合并 / 拆分 ----
// 选区跨到的那些单元格（合并用）
function toolboxTablePickedCells(ed) {
    const r = toolboxActiveRange();
    if (!r || r.collapsed || !ed || !ed.contains(r.commonAncestorContainer)) return null;
    const a = toolboxTableCellOf(r.startContainer, ed);
    const b = toolboxTableCellOf(r.endContainer, ed);
    if (!a || !b) return null;
    const table = toolboxTableOf(a);
    if (!table || table !== toolboxTableOf(b)) return null;
    const grid = toolboxTableGrid(table);
    const pa = toolboxGridPosOf(grid, a), pb = toolboxGridPosOf(grid, b);
    if (!pa || !pb) return null;
    // 矩形范围：先按起点/终点两格取包围盒，再把"压线"的合并格整个吞进来（反复几轮直到稳定），
    // 这样结果一定是矩形、一定合法。
    let r0 = Math.min(pa.r, pb.r), r1 = Math.max(pa.r, pb.r);
    let c0 = Math.min(pa.c, pb.c), c1 = Math.max(pa.c, pb.c);
    for (let round = 0; round < 12; round++) {
        let grew = false;
        for (let r2 = r0; r2 <= r1; r2++) {
            for (let c2 = c0; c2 <= c1; c2++) {
                const g = (grid[r2] || [])[c2];
                if (!g) continue;
                const gs = toolboxGridPosOf(grid, g.cell);
                if (!gs) continue;
                const cs = toolboxSpanOf(g.cell, 'colspan'), rs = toolboxSpanOf(g.cell, 'rowspan');
                if (gs.r < r0) { r0 = gs.r; grew = true; }
                if (gs.r + rs - 1 > r1) { r1 = gs.r + rs - 1; grew = true; }
                if (gs.c < c0) { c0 = gs.c; grew = true; }
                if (gs.c + cs - 1 > c1) { c1 = gs.c + cs - 1; grew = true; }
            }
        }
        if (!grew) break;
    }
    const list = [];
    for (let r2 = r0; r2 <= r1; r2++) {
        for (let c2 = c0; c2 <= c1; c2++) {
            const g = (grid[r2] || [])[c2];
            if (g && list.indexOf(g.cell) < 0) list.push(g.cell);
        }
    }
    const keeper = ((grid[r0] || [])[c0] || {}).cell || null;
    return { table: table, cells: list, keeper: keeper, span: (c1 - c0 + 1), rows: (r1 - r0 + 1) };
}
function toolboxTableMerge() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const picked = toolboxTablePickedCells(ed);
    if (!picked || !picked.keeper) {
        toolboxToast('请先选中横跨两个以上单元格的文字');
        return false;
    }
    if (picked.cells.length < 2) { toolboxToast('选中的已是单个单元格'); return false; }
    const keeper = picked.keeper;
    let dropped = 0;
    for (let i = 0; i < picked.cells.length; i++) {
        const el = picked.cells[i];
        if (el === keeper || !el.parentNode) continue;
        if (String(el.textContent || '').replace(/[\s\u00a0]+/g, '')) dropped++;
        el.parentNode.removeChild(el);
    }
    // 只在大于 1 时才写属性（语料里就是这种写法：<td colspan="7" style="…">）
    if (picked.span > 1) keeper.setAttribute('colspan', String(picked.span));
    else keeper.removeAttribute('colspan');
    if (picked.rows > 1) keeper.setAttribute('rowspan', String(picked.rows));
    else keeper.removeAttribute('rowspan');
    // 左上角那格可能本来是 <th>（表头里合并）：保持它原来的标签，别把表头改成普通格
    toolboxColGroupDrop(picked.table);
    toolboxFocusEditor();
    toolboxCaretInCell(keeper);
    // 把合并后的这一格整段选中：接着打字就能直接替换内容（和插入默认文字的体验一致）
    const sel = window.getSelection && window.getSelection();
    if (sel) {
        try {
            const rr = document.createRange();
            rr.selectNodeContents(keeper);
            sel.removeAllRanges();
            sel.addRange(rr);
            toolboxRange = rr.cloneRange();
        } catch (e) {}
    }
    toolboxSnapClear();
    toolboxStoreRangeNow();
    toolboxRefresh();
    toolboxUndoPush(false);
    toolboxScheduleDraftSave();
    toolboxToast('已合并 ' + picked.cells.length + ' 个单元格'
        + (dropped ? '（' + dropped + ' 格里的文字被丢弃）' : ''));
    return true;
}
function toolboxTableSplit() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const cell = toolboxCaretCell(ed);
    if (!cell) { toolboxToast('请先将光标置于表格中'); return false; }
    const cs = toolboxSpanOf(cell, 'colspan'), rs = toolboxSpanOf(cell, 'rowspan');
    if (cs === 1 && rs === 1) { toolboxToast('单元格并未合并，无法拆分'); return false; }
    const table = toolboxTableOf(cell);
    const grid = toolboxTableGrid(table);                // ★ 先量网格：补格子的位置要按"拆之前"算
    const pos = toolboxGridPosOf(grid, cell);
    if (!pos) return false;
    const trs = Array.prototype.slice.call(table.rows);
    // 复位 = 把属性**删掉**（缺省就是 1）：语料里从来不写 colspan="1"/rowspan="1"
    cell.removeAttribute('colspan');
    cell.removeAttribute('rowspan');
    // ① 本行右侧补 cs-1 个空格
    let ref = cell;
    for (let i = 1; i < cs; i++) {
        const td = toolboxMakeCell('td');
        if (ref.nextSibling) ref.parentNode.insertBefore(td, ref.nextSibling);
        else ref.parentNode.appendChild(td);
        ref = td;
    }
    // ② 下面 rs-1 行：每行在 pos.c 列补 cs 个空格。
    //    插入位置按"拆之前"的网格找：原来被合并格占住的那段槽，右边第一个单元格就是插入点。
    //    局限（尽力而为，不静默留破表）：如果下面那些行里的某个单元格正好**跨**着这段槽
    //    （复杂嵌套合并），新格子会退化成"追加到行尾"，浏览器渲染时会自动归一化列宽；
    //    极端情况下这几行的视觉列位可能略有偏差，但不会缺列、不会串行。
    for (let dr = 1; dr < rs; dr++) {
        const rowEl = trs[pos.r + dr];
        if (!rowEl) break;
        const cells = Array.prototype.filter.call(rowEl.children, function (x) {
            const t = String(x.tagName || '').toUpperCase();
            return t === 'TD' || t === 'TH';
        });
        let before = null;
        for (let i = 0; i < cells.length; i++) {
            const g = toolboxGridPosOf(grid, cells[i]);
            if (g && g.c >= pos.c) { before = cells[i]; break; }
        }
        for (let i = 0; i < cs; i++) {
            const td = toolboxMakeCell('td');
            if (before) rowEl.insertBefore(td, before);
            else rowEl.appendChild(td);
        }
    }
    toolboxColGroupDrop(table);
    return toolboxTableDone(ed, cell);
}

// ---- 菜单本体 ----
// ★ 一个浮层两套菜单项：表格（右键表格内）与图片（右键图片上）。样式、行为完全一致，
//   只是 innerHTML 与"灰哪些项"换一套；data-built 记的是当前是哪一套。
function toolboxTableMenuEl() {
    return document.getElementById('tbTableMenu');
}
function toolboxMenuItems() {
    return toolboxMenuMode === 'image' ? TOOLBOX_IM_ITEMS : TOOLBOX_TM_ITEMS;
}
function toolboxTableMenuBuild() {
    const m = toolboxTableMenuEl();
    if (!m) return m;
    if (m.getAttribute('data-built') === toolboxMenuMode) return m;
    const items = toolboxMenuItems();
    let html = '';
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.sep) { html += '<div class="tb-tmenu-sep"></div>'; continue; }
        html += '<div class="tb-tmenu-item" role="menuitem" data-tm="' + it.act + '"'
             + (it.title ? ' title="' + it.title + '"' : '') + '>' + it.label + '</div>';
    }
    m.innerHTML = html;
    m.setAttribute('data-built', toolboxMenuMode);
    if (!m.getAttribute('data-wired')) {
        m.setAttribute('data-wired', '1');
        // 菜单自己不能把表格里的选区/光标弄丢：按下就 preventDefault（不抢焦点、不清选区）
        m.addEventListener('mousedown', function (e) { e.preventDefault(); });
        m.addEventListener('click', function (e) {
            let el = e.target;
            while (el && el !== m && !el.getAttribute('data-tm')) el = el.parentNode;
            if (!el || el === m || el.classList.contains('tb-off')) return;
            const act = el.getAttribute('data-tm');
            toolboxTableMenuClose();
            toolboxTableAct(act);
            toolboxKeepFocus();                  // 菜单项跑完，焦点/选区回到编辑区
        });
    }
    return m;
}
function toolboxTableMenuClose() {
    const m = toolboxTableMenuEl();
    if (m) m.hidden = true;
}
// 打开菜单时按"当前能不能用"灰掉不该点的项
function toolboxTableMenuState(ed, cell) {
    const m = toolboxTableMenuEl();
    if (!m) return;
    const state = {};
    if (toolboxMenuMode === 'image') {
        const img = toolboxImgMenuTarget;
        if (!img) return;
        const w = String(img.getAttribute('width') || '');
        state['img-cap-del'] = !!toolboxImgCaptionBlock(img, ed);
        state['img-w80'] = w !== '80%';
        state['img-w60'] = w !== '60%';
        state['img-w100'] = w !== '100%';
    } else {
        if (!cell) return;
        const table = toolboxTableOf(cell);
        const picked = toolboxTablePickedCells(ed);
        const cs = toolboxSpanOf(cell, 'colspan'), rs = toolboxSpanOf(cell, 'rowspan');
        state['row-del'] = toolboxTableRowCount(table) > 1;
        state['col-del'] = toolboxTableCols2(table) > 1;
        state['cell-del'] = (function () {
            const n = Array.prototype.filter.call(cell.parentNode.children, function (x) {
                const t = String(x.tagName || '').toUpperCase();
                return t === 'TD' || t === 'TH';
            }).length;
            return n > 1;
        })();
        state['merge'] = !!(picked && picked.cells.length > 1);
        state['split'] = (cs > 1 || rs > 1);
    }
    const items = m.querySelectorAll('[data-tm]');
    for (let i = 0; i < items.length; i++) {
        const act = items[i].getAttribute('data-tm');
        if (state[act] === false) items[i].classList.add('tb-off');
        else items[i].classList.remove('tb-off');
    }
}
function toolboxTableMenuOpen(x, y, ed, cell, mode) {
    toolboxMenuMode = (mode === 'image') ? 'image' : 'table';
    const m = toolboxTableMenuBuild();
    if (!m) return;
    toolboxTableMenuState(ed, cell);
    m.hidden = false;
    m.style.left = '0px';                                 // 先放到原点量尺寸，再夹回视口内
    m.style.top = '0px';
    const w = m.offsetWidth || 140, h = m.offsetHeight || 220;
    const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    m.style.left = Math.max(4, Math.min(Math.round(x), vw - w - 6)) + 'px';
    m.style.top = Math.max(4, Math.min(Math.round(y), vh - h - 6)) + 'px';
}
function toolboxTableAct(act) {
    switch (act) {
        case 'row-above': return toolboxTableInsertRow('above');
        case 'row-below': return toolboxTableInsertRow('below');
        case 'row-del':   return toolboxTableDeleteRow();
        case 'col-left':  return toolboxTableInsertCol('left');
        case 'col-right': return toolboxTableInsertCol('right');
        case 'col-del':   return toolboxTableDeleteCol();
        case 'cell-add':  return toolboxTableAddCell();
        case 'cell-del':  return toolboxTableDeleteCell();
        case 'merge':     return toolboxTableMerge();
        case 'split':     return toolboxTableSplit();
        // —— 图片菜单（C：和表格菜单共用一个浮层，只是换一套菜单项）——
        case 'img-edit':   return toolboxImgEditDialog();
        case 'img-w80':    return toolboxImgSetWidth('80%');
        case 'img-w60':    return toolboxImgSetWidth('60%');
        case 'img-w100':   return toolboxImgSetWidth('100%');
        case 'img-c':      return toolboxImgAlign('center');
        case 'img-l':      return toolboxImgAlign('left');
        case 'img-r':      return toolboxImgAlign('right');
        case 'img-cap':    return toolboxImgCaptionEdit();
        case 'img-cap-del': return toolboxImgCaptionDelete();
        case 'img-del':    return toolboxImgDelete();
    }
    return false;
}

// ========== C. 图片右键菜单 ==========
// 复用表格那套浮层（#tbTableMenu / .tb-tmenu）：样式、行为（mousedown 阻止默认、
// 点空白/Esc/滚动/关窗都关、Esc 从内到外、视口内 clamp）完全一致，只是换一套菜单项。
// 图片菜单的"目标"是右键点中的那个 <img>（光标也放到它旁边）。
const TOOLBOX_IM_ITEMS = [
    { act: 'img-edit', label: '修改图片参数', title: '' },
    { sep: 1 },
    { act: 'img-w60',  label: '60%宽度' },
    { act: 'img-w80',  label: '80%宽度' },
    { act: 'img-w100', label: '100%宽度' },
    { sep: 1 },
    { act: 'img-l',    label: '左对齐' },
    { act: 'img-c',    label: '居中对齐' },
    { act: 'img-r',    label: '右对齐' },
    { sep: 1 },
    { act: 'img-cap',  label: '编辑图注' },
    { act: 'img-cap-del', label: '删除图注' },
    { sep: 1 },
    { act: 'img-del',  label: '删除图片' }
];
// 图片菜单当前目标（打开时记下来；菜单项执行时用）
let toolboxMenuMode = 'table';
let toolboxImgMenuTarget = null;

// 右键点中的是不是一张图（图片可能被占位包裹层包着，要往上找一层）
function toolboxImageTargetOf(node, ed) {
    let n = node;
    while (n && n !== ed) {
        if (n.nodeType === 1) {
            const t = String(n.tagName || '').toUpperCase();
            if (t === 'IMG') return n;
            // 占位框（文件名那行、以及框本身的留白）也是这张图的一部分：
            // 点/右键它等于点这张图 —— 图取不到时它是屏幕上唯一的"这张图"。
            if (n.getAttribute && /^(wrap|name)$/.test(String(n.getAttribute('data-tb-display') || ''))) {
                const holder = String(n.getAttribute('data-tb-display')) === 'name' ? n.parentNode : n;
                const img = holder && holder.querySelector ? holder.querySelector('img') : null;
                if (img) return img;
            }
        }
        n = n.parentNode;
    }
    return null;
}
// 图片所在的"块"：套在它外面的 center/p/div（占位包裹层要跳过）。纯查询，不改 DOM。
function toolboxImgBlockOf(img, ed) {
    let n = img;
    while (n && n.parentNode && n.parentNode !== ed) {
        const p = n.parentNode;
        if (p.getAttribute && p.getAttribute('data-tb-display')) { n = p; continue; }   // 跳过占位包裹
        if (toolboxIsBlockEl(p)) return p;
        n = p;
    }
    return null;
}
// 块级操作前调用：确保图片所在的块**不在行内元素里**（历史上真出过
// <span>图注<span><center><img></center> 这种非法嵌套），返回可用的块级节点。
function toolboxImgBlockHoist(img, ed) {
    const block = toolboxImgBlockOf(img, ed);
    if (block) return toolboxHoistOutOfInline(block, ed);
    return toolboxHoistOutOfInline(img, ed);           // 一路都是行内：把图片自己提出来
}
// 图注 = 图片块**后面紧跟的那条居中小字**（语料约定：<center><span style="color:#555555;
// font-size:0.85rem;">…</span></center>）。识别不了就当作"没有图注"。
function toolboxIsCaptionBlock(el) {
    if (!el || el.nodeType !== 1) return false;
    const test = function (x) {
        const st = String((x.getAttribute && x.getAttribute('style')) || '');
        return /font-size\s*:\s*0?\.85rem/i.test(st) || /color\s*:\s*#555555/i.test(st);
    };
    if (test(el)) {
        const txt = String(el.textContent || '').trim();
        return !!txt;
    }
    const span = el.querySelector ? el.querySelector('span') : null;
    return !!(span && test(span) && String(span.textContent || '').trim());
}
function toolboxImgCaptionBlock(img, ed) {
    const block = toolboxImgBlockOf(img, ed);
    if (!block) return null;
    let n = block.nextSibling;
    while (n && n.nodeType === 3 && !String(n.nodeValue || '').trim()) n = n.nextSibling;
    if (n && n.nodeType === 1 && toolboxIsCaptionBlock(n)) return n;
    return null;
}
// 图片菜单里各操作的收尾（一条撤回记录 + 光标回到图旁边 + 占位框刷新）
function toolboxImgDone(touched) {
    const ed = toolboxTpl && toolboxTpl.editor;
    toolboxSnapClear();
    toolboxImgDisplaySync(ed);
    if (touched && touched.parentNode) toolboxCaretAfterNode(touched);
    toolboxStoreRangeNow();
    toolboxCleanEditorBlocks(ed, touched);              // 只清操作点附近的空节点
    toolboxRefresh();
    toolboxUndoPush(false);                     // ★ 一次菜单操作 = 一条撤回记录
    toolboxScheduleDraftSave();
    toolboxSyncToolbarState();
    return true;
}
// 光标放到某个节点后面（图片操作之后，接着打字应该落在这里）
function toolboxCaretAfterNode(node) {
    if (!node || !node.parentNode) return;
    const sel = window.getSelection && window.getSelection();
    if (!sel) return;
    try {
        const r = document.createRange();
        r.setStartAfter(node);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        toolboxRange = r.cloneRange();
    } catch (e) {}
}
function toolboxImgSetWidth(w) {
    const img = toolboxImgMenuTarget;
    if (!img || !img.parentNode || !w) return false;
    img.setAttribute('width', String(w));       // 宽度统一走属性写法（语料一致），不写 style
    return toolboxImgDone(img);
}
function toolboxImgAlign(mode) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const img = toolboxImgMenuTarget;
    if (!img || !ed) return false;
    let block = toolboxImgBlockHoist(img, ed);          // 先在块级层级拿位置（顺手纠正非法嵌套）
    // 图片块里只有这张图时：直接换掉外层容器（居中 = <center>，左右 = text-align）
    const onlyImage = function (el) {
        const txt = String(el.textContent || '').replace(/[\s\u00a0\u200b]+/g, '');
        if (txt) return false;
        const imgs = el.querySelectorAll('img');
        return imgs.length === 1 && imgs[0] === img;
    };
    if (mode === 'center') {
        if (block && String(block.tagName).toUpperCase() === 'CENTER') { toolboxImgDone(img); return true; }
        const wrap = document.createElement('center');
        if (block && onlyImage(block)) {
            block.parentNode.insertBefore(wrap, block);
            wrap.appendChild(img);
            if (block.parentNode) block.parentNode.removeChild(block);
        } else if (block) {
            wrap.appendChild(img);              // 段落里还有别的字：只把图片挪进 <center>
            block.appendChild(wrap);
        } else {
            ed.appendChild(wrap);
            wrap.appendChild(img);
        }
        toolboxImgPlaceholderSync(img);
        return toolboxImgDone(wrap);
    }
    // 左右对齐：<center> 换成 <p style="text-align:left|right;">（与语料里落款的写法一致）
    const p = document.createElement('p');
    p.setAttribute('style', 'text-align:' + mode + ';');
    if (block && onlyImage(block)) {
        block.parentNode.insertBefore(p, block);
        p.appendChild(img);
        if (block.parentNode) block.parentNode.removeChild(block);
    } else if (block) {
        block.setAttribute('style', 'text-align:' + mode + ';');   // 段落里还有别的字：改整段对齐
        toolboxImgDone(img);
        return true;
    } else {
        ed.appendChild(p);
        p.appendChild(img);
    }
    toolboxImgPlaceholderSync(img);
    return toolboxImgDone(p);
}
function toolboxImgCaptionEdit() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const img = toolboxImgMenuTarget;
    if (!img || !ed) return false;
    return toolboxOpenDialog('imgCap');            // 走工具箱自己的字段对话框（带当前图注文字）
}
function toolboxImgCaptionSet(val) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const img = toolboxImgMenuTarget;
    if (!img || !ed) return false;
    const text = String(val == null ? '' : val).trim();
    if (!text) return toolboxImgCaptionDelete();
    const old = toolboxImgCaptionBlock(img, ed);
    if (old && old.parentNode) {
        // 有图注就改它（保持语料那套写法）
        old.innerHTML = '<span style="color:' + TOOLBOX_SMALL_COLOR + '; font-size:' + TOOLBOX_SMALL_SIZE
            + ';">' + toolboxEsc(text) + '</span>';
        return toolboxImgDone(old);
    }
    const block = toolboxImgBlockHoist(img, ed);        // 图注永远是图片的**兄弟块**
    const holder = document.createElement('div');
    holder.innerHTML = toolboxCaptionHtml(text);
    const node = holder.firstChild;
    if (block && block.parentNode) block.parentNode.insertBefore(node, block.nextSibling);
    else ed.appendChild(node);
    return toolboxImgDone(node);
}
function toolboxImgCaptionDelete() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const img = toolboxImgMenuTarget;
    if (!img || !ed) return false;
    const cap = toolboxImgCaptionBlock(img, ed);
    if (!cap || !cap.parentNode) { toolboxToast('未找到图注'); return false; }
    cap.parentNode.removeChild(cap);
    return toolboxImgDone(img);
}
function toolboxImgDelete() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const img = toolboxImgMenuTarget;
    if (!img || !ed) return false;
    const cap = toolboxImgCaptionBlock(img, ed);
    if (cap && cap.parentNode) cap.parentNode.removeChild(cap);          // 图注一起删
    const wrap = toolboxImgDisplayWrap(img);
    const kill = wrap && wrap.parentNode ? wrap : img;
    const block = toolboxImgBlockOf(img, ed);
    const parent = kill.parentNode;
    if (parent) parent.removeChild(kill);
    // 只剩下空壳的 <center>/<p> 顺手收掉（只收这一处）
    if (block && block.parentNode && String(block.textContent || '').replace(/[\s\u00a0\u200b]+/g, '') === ''
        && !block.querySelector('img,table,br,hr,video')) {
        block.parentNode.removeChild(block);
    }
    toolboxImgMenuTarget = null;
    return toolboxImgDone(parent || ed);
}// 「修改图片…」对话框：改地址 / 宽度 / 说明（alt）。用 prompt 三个值太笨，
// 走工具箱自己的字段对话框（tb-field），确认后才动 DOM。
function toolboxImgEditDialog() {
    const img = toolboxImgMenuTarget;
    if (!img) return false;
    toolboxOpenDialog('imgEdit');
    return true;
}

// ========== 手机上不提供这个工具 ==========
// 用户要求：手机上（触屏 / 窄屏）**不提供**入口，而且 JS 层也要挡住 ——
// 不能只靠 CSS 把按钮藏起来（旧链接、控制台、书签直接调 toolboxOpen() 一样会开）。
// ★ 判定方式**复用站内既有那套**，不新造标准、不用 UA 嗅探：
//   · 触屏 = (pointer: coarse) —— dropdown.js / scrollbar.js 开头用的就是这一条；
//   · 窄屏 = (max-width: 600px) —— 站内几个移动端断点用的就是 600px。
//   ★ 这两条与 toolbox.css 里隐藏 #toolboxOpenBtn 的那段媒体查询**逐字一致**，改一处要改两处。
function toolboxIsMobile() {
    if (typeof window.matchMedia !== 'function') return false;
    try {
        return window.matchMedia('(pointer: coarse)').matches
            || window.matchMedia('(max-width: 600px)').matches;
    } catch (e) { return false; }         // 老浏览器上 matchMedia 抛异常：当桌面端处理（不挡功能）
}
// 从桌面变成手机状态（窗口缩窄 / 旋屏）时，弹窗要是开着就关掉。
// ★ 用 toolboxClose() 而不是自己改 display：遮罩类（body.tb-modal-open）、草稿询问弹窗、
//   表格右键菜单、定时器都靠它一起收干净，不会留下"看不见但还在"的残留。
function toolboxOnViewportChange() {
    if (!toolboxTpl || !toolboxTpl.modal) return;
    if (!toolboxIsMobile()) return;
    if (toolboxTpl.modal.style.display === 'flex') toolboxClose();
}

// ========== 开关弹窗 ==========
function toolboxOpen() {
    if (!toolboxTpl || !toolboxTpl.modal) return;
    // ★ JS 层的闸门：手机上直接调也开不了（见 toolboxIsMobile 的说明）。
    //   静默返回、不弹提示：入口在手机上根本不显示，能走到这里的只有旧链接/控制台调用。
    if (toolboxIsMobile()) return;
    const modal = toolboxTpl.modal;
    if (modal.style.display === 'flex') { toolboxFocusEditor(); return; }
    toolboxCloseDialog();
    modal.style.display = 'flex';
    modal.classList.add('tb-open');
    // 锁背景滚动。独立类名，不动 body.modal-open（那是大图灯箱的，两边同时开会打架）
    document.body.classList.add('tb-modal-open');
    // ★ 内容保留规则（按会话区分，见 toolboxSession 的说明）：
    //   · 同一次会话里关掉再打开 —— **内容原样保留**（编辑区、代码区、窗口尺寸位置都不动），
    //     也不弹草稿询问：内容根本没丢，问了只会多余。
    //   · 页面刷新后第一次打开 —— 编辑区/代码区从空白开始（不预置示例文章），
    //     窗口回默认尺寸，名字回到默认的 Untitled，这时才弹窗问 localStorage 里的草稿。
    const firstOpen = !toolboxSession;
    toolboxSession = true;
    if (firstOpen) {
        if (toolboxTpl.editor) toolboxTpl.editor.innerHTML = '<p><br></p>';
        if (toolboxTpl.code) toolboxTpl.code.value = '';      // 代码区同样留空
        toolboxFileNameReset();                               // 文件名也回默认 Untitled（不沿用上次会话）
        toolboxRange = null;
        toolboxSnapClear();
        // ★ 需求 A：光标从第一帧起就落在「从这里开始」那一行 —— 显式摆进第一个块里（见函数注释）
        toolboxCaretIntoFirstBlock();
        toolboxWinBox = null;                                 // 刷新后回默认尺寸
    }
    toolboxClearArmed = false;
    toolboxSyncBusy = false;
    if (toolboxCodeApplyTimer) { clearTimeout(toolboxCodeApplyTimer); toolboxCodeApplyTimer = 0; }
    if (toolboxTpl.clearBtn) toolboxTpl.clearBtn.textContent = '清空';
    // 窗口：会话内沿用上次拖动/缩放的结果，刷新后（或第一次）回默认尺寸位置。
    // 全屏态不保留 —— 关窗时已经退掉了。
    if (toolboxWinBox) toolboxWinApply(toolboxWinBox); else toolboxWinReset();
    window.addEventListener('resize', toolboxWinOnViewportResize);
    toolboxSyncPanelFocus();                 // 焦点还没进来：先按"不在代码区"算（全可用）
    toolboxRefresh();
    // 撤回栈的起点 = 本次打开时的状态（这一步必须在 refresh 之后，存下来的代码文本才是当前值）
    toolboxUndoReset();
    // 草稿询问弹窗：只有"刷新后第一次打开 + 有非空草稿"才弹；同会话重开一律关掉它。
    if (firstOpen) toolboxDraftOffer();
    else toolboxDraftAskHide();
    // 等打开动画那一帧过去再聚焦：否则焦点会把页面顶到编辑区，动画看着像跳了一下。
    // ★ 草稿询问弹窗开着时**不抢焦点**：焦点该在弹窗里（它是允许抢焦点的对话框之一），
    //   被这里塞回编辑区的话，用户按键盘会打在看不见的正文里。
    if (!toolboxDraftAskOpen) {
        requestAnimationFrame(function () { toolboxFocusEditor(); toolboxRestoreRange(); });
    }
}

function toolboxClose() {
    if (!toolboxTpl || !toolboxTpl.modal) return;
    toolboxCloseDialog();
    toolboxDraftAskHide();                   // 草稿询问弹窗在工具箱外面，关窗要一起收（**不动草稿本身**）
    toolboxTableMenuClose();                 // 表格右键菜单是浮层：关窗时一起收，别留在屏幕上
    toolboxTpl.modal.classList.remove('tb-open');
    toolboxTpl.modal.style.display = 'none';
    document.body.classList.remove('tb-modal-open');
    // ★ 关闭时把状态清干净：Range 指向的节点可能已经被回收（"存档失效"就是这么来的），
    //   定时器/动画帧也要一起收，不给下次打开留残留。
    //   注意**不动草稿**：关掉弹窗不等于放弃内容（误关也要能找回），只有用户点
    //   「丢弃」或「清空」才真的删。
    // ★ 但草稿的"待保存"必须在这里**落盘**，不能留着也不能直接扔掉（实测到的 bug）：
    //   关窗后编辑区在内存里是空的，那个 500ms 的防抖回调一旦在关窗后才跑到，
    //   就会判定"编辑区是空的 → 把草稿删掉"—— 用户明明什么都没丢，刷新一下草稿没了。
    //   所以：有待保存就先同步写一次（此时编辑区还是用户最后编辑的那份内容），再收工。
    if (toolboxDraftTimer) {
        clearTimeout(toolboxDraftTimer);
        toolboxDraftTimer = 0;
        toolboxDraftSaveNow(false);     // 关窗：只写不删（空着就保持原样，绝不误删草稿）
    }
    toolboxRange = null;
    if (toolboxCodeRaf) { cancelAnimationFrame(toolboxCodeRaf); toolboxCodeRaf = 0; }
    toolboxCodeDirty = false;
    if (toolboxToastTimer) { clearTimeout(toolboxToastTimer); toolboxToastTimer = 0; }
    if (toolboxTpl.toast) toolboxTpl.toast.classList.remove('show');
    if (toolboxClearTimer) { clearTimeout(toolboxClearTimer); toolboxClearTimer = 0; }
    toolboxClearArmed = false;
    // 代码区 → 编辑区的防抖、撤回栈的防抖：关窗时必须一起收，
    // 否则关掉之后定时器还会跑一次，把内容写进已经关闭的弹窗（看起来像"关了又变了"）。
    if (toolboxCodeApplyTimer) { clearTimeout(toolboxCodeApplyTimer); toolboxCodeApplyTimer = 0; }
    if (toolboxUndo.timer) { clearTimeout(toolboxUndo.timer); toolboxUndo.timer = 0; }
    toolboxSyncBusy = false;
    // ★ Esc 的语义：不管是不是全屏，**一按就整个关掉**（不做"先退出全屏、再按一次才关"）。
    //   两个理由：① 关掉之后下次打开本来就是普通窗口，全屏态没必要留着；
    //   ② 少一个"按了 Esc 怎么没关"的困惑。全屏态在这里跟着一起清掉。
    //   ★ 但**尺寸和位置要留给这一次会话**：先记到内存里（toolboxWinBox），
    //     下次打开 toolboxOpen() 会原样套回去；刷新页面就归零回默认。
    //     故意不用 localStorage/sessionStorage：上次在大屏拉大的窗口，刷新后在小屏上
    //     可能整个跑到屏幕外，默认尺寸更可控。
    if (toolboxWin.ready && !toolboxWin.full) {
        toolboxWinBox = { left: toolboxWin.left, top: toolboxWin.top, w: toolboxWin.w, h: toolboxWin.h };
    }
    toolboxWinUp(null);
    toolboxWinSetFull(false);
    window.removeEventListener('resize', toolboxWinOnViewportResize);
    // 关掉时把 inline 定位清掉（display:none 的窗口留着 left/top 没意义，
    // 而且下次是 toolboxWinApply(toolboxWinBox) 重新写回去，不会丢）
    if (toolboxTpl.card) { toolboxTpl.card.style.left = ''; toolboxTpl.card.style.top = ''; }
    toolboxWin.ready = false;
}

function toolboxToggle() {
    if (!toolboxTpl || !toolboxTpl.modal) return;
    if (toolboxTpl.modal.style.display === 'flex') toolboxClose();
    else toolboxOpen();
}

// Esc / 撤回 / 恢复 的按键处理。弹窗自身的 keydown 与"焦点掉到 body"时的
// 兜底 document keydown 共用这一份，行为保证一致。
function toolboxHandleKey(e) {
    if (!e) return;
    const k = (e.key || '').toLowerCase();
    if (e.key === 'Escape' || e.key === 'Esc') {
        e.stopPropagation();
        const menu = toolboxTableMenuEl();
        // 表格右键菜单是最上面那层：有它先关它，别一按 Esc 把整个工具箱也关了
        if (menu && !menu.hidden) { toolboxTableMenuClose(); return; }
        if (toolboxTpl && toolboxTpl.dialog && toolboxTpl.dialog.style.display === 'flex') {
            toolboxDialogCancel();
        } else {
            toolboxClose();
        }
        return;
    }
    // 撤回/恢复：Ctrl+Z、Ctrl+Shift+Z、Ctrl+Y（macOS 上 Cmd 同理）
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
        if (e.target && e.target.closest && e.target.closest('#tbDialog')) return;   // 字段对话框里的输入框交回原生
        e.preventDefault();                       // ★ 必须拦掉：否则 contenteditable 会走浏览器自己的撤销栈
        if (k === 'y' || e.shiftKey) toolboxUndoStep(1);
        else toolboxUndoStep(-1);
        toolboxKeepFocus();
        return;
    }
    // 加粗/斜体/下划线/删除线：Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+S。
    // ★ 为什么不交给浏览器原生的 Ctrl+B：原生那条路会自己套 <b>，路子跟工具栏按钮不一样
    //   （用户实测的"点两次变成 <b><b>…</b></b>"就是这么来的）。走同一套 toolboxToggleInline，
    //   按钮和快捷键的结果才会逐字一致；焦点与选区也顺带被同一套逻辑守住。
    // ★ Ctrl+S：只在**正文里**接管（删除线），代码区里仍然交回浏览器的"保存网页"。
    if ((e.ctrlKey || e.metaKey) && (k === 'b' || k === 'i' || k === 'u' || k === 's')) {
        if (e.target && e.target.closest && e.target.closest('#tbDialog')) return;   // 对话框输入框：原生
        // ★ 代码区里：**拦掉但不做任何事**。不拦的话浏览器/系统会给 textarea 加粗（或触发"保存网页"），
        //   正文侧更是完全不该动 —— 用户要求"代码区里用不了这些格式键"。
        //   Ctrl+S 原本就是"交回浏览器的保存网页"，这一条也一起拦掉：既然代码区里格式类都不能用，
        //   这一组键就该一致地"什么都不做"。
        if (toolboxFocusInCode()) { e.preventDefault(); return; }
        e.preventDefault();
        toolboxToggleInline({ b: 'bold', i: 'italic', u: 'underline', s: 'strike' }[k]);
        toolboxKeepFocus();
    }
}

// ========== 工具栏动作表 ==========
// 用一张表而不是一堆 if：加按钮不用改事件绑定。
function toolboxToolbarAction(act, btn) {
    // ★ 代码区里用不了上面那一排东西：焦点在代码区时，所有"面板相关"的动作直接不做。
    //   第一道是按钮的 disabled（点都点不动），这里是**第二道**兜底 ——
    //   万一有人绕过按钮直接调这个函数（例如脚本/测试里 btn.click()），也不会改坏正文。
    if (toolboxFocusInCode() && TOOLBOX_GLOBAL_ACTS.indexOf(String(act)) < 0) return false;
    switch (act) {
        // —— 行内格式 ——
        case 'bold': toolboxExec('bold'); break;
        case 'italic': toolboxExec('italic'); break;
        case 'underline': toolboxExec('underline'); break;
        case 'strike': toolboxExec('strikeThrough'); break;
        // 上标 / 下标（用户新增）：与 BIUS 完全同一条字符级三态开关
        case 'sup': toolboxToggleInline('sup'); break;
        case 'sub': toolboxToggleInline('sub'); break;
        case 'size': toolboxSize(btn ? btn.getAttribute('data-size') : '1em'); break;
        // —— 对齐 ——
        case 'align-left': toolboxExec('justifyLeft'); break;
        case 'align-center': toolboxExec('justifyCenter'); break;
        case 'align-right': toolboxExec('justifyRight'); break;
        // —— 清除格式 ——
        case 'clear': toolboxClearFormat(); break;
        // —— 插入块 ——
        case 'title': toolboxInsertTitle(); break;
        case 'body': toolboxMakeBody(); break;      // 「正文」：标题的反操作
        case 'quote': toolboxInsertQuote(); break;
        case 'caption': toolboxInsertCaption(''); break;
        case 'image': toolboxOpenDialog('image'); break;
        case 'stack': toolboxOpenDialog('stack'); break;
        case 'link': toolboxOpenDialog('link'); break;
        case 'table': toolboxOpenDialog('table'); break;
        case 'br': toolboxInsertBreak(); break;
        case 'para': toolboxInsertParagraph(); break;   // Enter：段落分界（新建 <p>）
        case 'sign': toolboxInsertSignature(); break;
        // —— 撤回 / 恢复 ——
        case 'undo': toolboxUndoStep(-1); break;
        case 'redo': toolboxUndoStep(1); break;
        // —— 窗口 ——
        case 'fullscreen': toolboxWinToggleFull(); break;
        case 'close': toolboxClose(); break;
        // —— 输出 / 草稿 ——
        case 'copy': toolboxCopyHtml(); break;
        case 'download': toolboxDownloadHtml(); break;
        case 'cleardraft': toolboxClearAll(); break;
        default: break;
    }
    // ★ 收尾统一兜一次焦点/选区（需求：任何操作之后编辑区都不该失焦）。
    //   关窗（close）例外 —— 那时候工具箱已经收起来，再把焦点塞进隐藏的编辑区毫无意义。
    if (act !== 'close') toolboxKeepFocus();
    // 复制/下载：整条流程结束之后一定要把焦点还给正文 —— 文件名输入框是唯一允许抢焦点的
    // 地方（见 toolboxToolbarHit 的排除名单），用户起完名字按下下载，接着就该继续写正文。
    // ★ 焦点本来就在正文里时一个字都不动（免得把刚放好的光标换成旧的存档）。
    if ((act === 'copy' || act === 'download') && !toolboxFocusInEditor()) {
        toolboxFocusEditor();
        toolboxRestoreRange();
    }
}

// 字号：工具栏的 rem 值 → execCommand 档位（映射表见 TOOLBOX_SIZE_TO_FONT）
function toolboxSize(size) {
    toolboxApplyFontSize(TOOLBOX_SIZE_TO_FONT[String(size)] || '3');
}

// ＝＝ 已删除：文字颜色 / 背景高亮 ＝＝
// 用户明确说不需要这两个功能，所以整条路径都拆了：
//   · 工具栏上的两个取色器（#tbForeColor / #tbBackColor）与它们的事件绑定；
//   · toolboxColor() / toolboxHighlight() / toolboxBgHolder() / toolboxBindSwatch()；
//   · execCommand 的 foreColor / hiliteColor / backColor / fontName 分支；
//   · 按钮状态里的 color / back / colorInline / backInline 与色块回写。
// ★ 保留的：toolboxRGBToHex()（类型识别要拿它把 #555555 那一档的灰色比出来）、
//   toolboxTextRunsInRange()（被 toolboxBlocksInRange 用）、toolboxFontToStyle() 里的
//   color 转换（那是**导入归一化**：老文章里的 <font color> 转成 span 样式，不是本功能）。

// ========== 高亮（背景色）自己做，不用 execCommand ==========
// ★ 用户实测：execCommand('hiliteColor') **跨行/跨块时不可靠** —— 选中三行只给第一行上色，
//   有时干脆什么都不做。所以这里自己按**选区覆盖到的每个块**逐块处理：
//   把每块里被选中的文字用 <span style="background-color:#xxxxxx;"> 包起来。
//   · 跨多行/多块：逐块都生效（每块一个 <span>）；
//   · 重复点同一颜色 = 取消（第二次点把刚加的那些 span 解掉）；
//   · 不破坏原有的 <b>/<span> 结构（只在最内层的文字片段外面套一层）、不产生空节点。
// 清掉一棵子树里的零长度文本节点（没有内容、不显示、序列化也看不到，留着只会让
// "firstChild / 偏移"这类定位算错）。只删空的文本节点，不碰任何元素。
function toolboxDropEmptyTextNodes(root) {
    if (!root || !root.childNodes || !document.createTreeWalker) return;
    const dead = [];
    let walker = null;
    try { walker = document.createTreeWalker(root, 4, null, false); } catch (e) { return; }
    let n = walker.nextNode();
    while (n) {
        if (!String(n.nodeValue || '').length) dead.push(n);
        n = walker.nextNode();
    }
    for (let i = 0; i < dead.length; i++) {
        if (dead[i].parentNode) dead[i].parentNode.removeChild(dead[i]);
    }
}
// 选区覆盖到的文本片段：[{node, start, end, block}]（按文档顺序）
function toolboxTextRunsInRange(ed, rng) {
    const out = [];
    const walk = document.createTreeWalker(ed, 4, null, false);      // 4 = SHOW_TEXT
    let n = walk.nextNode();
    while (n) {
        const len = String(n.nodeValue || '').length;
        let s = 0, e = len;
        if (n === rng.startContainer) s = (rng.startContainer.nodeType === 3) ? rng.startOffset : 0;
        if (n === rng.endContainer) e = (rng.endContainer.nodeType === 3) ? rng.endOffset : len;
        const inside = (function () {
            try { return rng.intersectsNode(n); } catch (err) { return false; }
        })();
        if (inside && e > s) {
            const block = toolboxNearestBlock(n, ed) || ed;
            out.push({ node: n, start: s, end: e, block: block });
        }
        n = walk.nextNode();
    }
    return out;
}
// 把 style 拆成声明数组（给上面用）
function toolboxStyleDecls(el) {
    return String((el && el.getAttribute && el.getAttribute('style')) || '')
        .split(';').map(function (x) { return x.trim(); })
        .filter(function (x) { return !!x; });
}

// ========== 初始化 ==========
function initToolboxDOM() {
    if (toolboxLoaded) return;

    // 弹窗 DOM 写在 index.html 里（和 #imageModal 同一位置、同一套做法）。
    // 万一没写上，这里兜一道：注入一份最小结构，至少还能用"手动插 HTML"这条基本路。
    let modal = document.getElementById('toolboxModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'toolboxModal';
        modal.className = 'tb-modal';
        modal.innerHTML = toolboxFallbackHtml();
        document.body.appendChild(modal);
    }

    toolboxTpl = {
        modal: modal,
        card: modal.querySelector('.tb-card'),
        head: modal.querySelector('#tbHead'),
        fullBtn: modal.querySelector('#tbFullBtn'),
        editor: modal.querySelector('#tbEditor'),
        code: modal.querySelector('#tbCode'),
        fileName: modal.querySelector('#tbFileName'),
        count: modal.querySelector('#tbCount'),
        toast: modal.querySelector('#tbToast'),
        dialog: modal.querySelector('#tbDialog'),
        dialogTitle: modal.querySelector('#tbDialogTitle'),
        dialogBody: modal.querySelector('#tbDialogBody'),
        validate: modal.querySelector('#tbValidate'),
        // ★ 草稿确认弹窗在 #toolboxModal **外面**（要压在它上面），所以从 document 上取；
        //   「恢复 / 丢弃」两个按钮也在那个弹窗里。
        draftAsk: document.getElementById('tbDraftAsk'),
        draftRestore: document.getElementById('tbDraftRestore'),
        draftDiscard: document.getElementById('tbDraftDiscard'),
        clearBtn: modal.querySelector('[data-tb="cleardraft"]')
    };
    if (!toolboxTpl.editor || !toolboxTpl.code) return;   // 结构不对：别把整个页面拖崩

    toolboxBindWindow();      // 顶栏拖动 + 八个缩放手柄（监听只在初始化时挂一次）

    // 手机上不提供：窗口缩窄 / 旋屏切到移动端状态时，把已经开着的工具箱关掉（不留残留遮罩）。
    // ★ 单独用 media query 的 change 事件（而不是 resize）：判定标准是 pointer/max-width，
    //   跟着它变才准；change 不触发的情况再用 resize 兜一次。监听只挂一次。
    try {
        if (window.matchMedia) {
            const mq = window.matchMedia('(pointer: coarse), (max-width: 600px)');
            if (mq.addEventListener) mq.addEventListener('change', toolboxOnViewportChange);
            else if (mq.addListener) mq.addListener(toolboxOnViewportChange);
        }
    } catch (e) { /* 老浏览器拿不到 MediaQueryList：靠下面的 resize 兜底 */ }
    window.addEventListener('resize', toolboxOnViewportChange);
    toolboxOnViewportChange();       // 一进来就是手机状态的话，别留一个开着的弹窗

    toolboxTpl.editor.addEventListener('paste', toolboxPasteHandler);
    // 图片占位框（B）：图加载出来就撤掉占位框，加载失败就补上（捕获阶段监听 load/error）
    toolboxImgDisplayEvents(toolboxTpl.editor);
    // 拖进来的东西：纯文本按纯文本，.html 文件按 HTML 源码导入（见 toolboxDropHandler）
    toolboxTpl.editor.addEventListener('dragover', function (e) {
        const dt = e.dataTransfer;
        if (!dt) return;
        let has = false;
        try { has = !!(dt.types && (Array.prototype.indexOf.call(dt.types, 'Files') >= 0
            || Array.prototype.indexOf.call(dt.types, 'text/plain') >= 0)); } catch (e1) { has = false; }
        if (has) e.preventDefault();
    });
    toolboxTpl.editor.addEventListener('drop', toolboxDropHandler);
    // 用户自己在编辑区里点/打字：工具栏那份冻结快照作废（现场才是对的），
    // 同时把"上一次的选区存档"也清掉 —— 从这一刻起光标位置才是用户想要的。
    // 例外：正好按在表格的列边界上 —— 那是"调列宽"的手势，不是"挪光标"。
    // 右键（button=2）不参与：那是"表格操作菜单"的手势，不能顺手把选区/光标清掉
    // （菜单里的「合并单元格」正是靠右键时这份选区）。
    toolboxTpl.editor.addEventListener('pointerdown', function (e) {
        if (e.button === 2) return;
        const hit = toolboxColHit(toolboxColCellAt(e), e.clientX);
        if (hit && toolboxColStart(e, hit)) return;
        toolboxDropRange();
    });
    toolboxTpl.editor.addEventListener('keydown', function (e) {
        if (e.isComposing === true || e.keyCode === 229 || toolboxComposing) return;   // ★★ IME：合成中不碰存档/快照
        toolboxDropRange();
    });
    // ★★ IME 守卫之一：合成开始/进行中 → 冻结（期间任何结构归一化都会被跳开或推迟）。
    toolboxTpl.editor.addEventListener('compositionstart', function () {
        // ★★ 用户实测 bug 1 的关键一步：合成**开始之前**先把落点稳住。
        //   光标如果停在"空行"上（根级 <br> 旁，或浏览器把它解析成了下一段的开头），
        //   输入法提交时会把这几个字插进**下一段的开头**（用户看到"输「中」之后光标跑到「乙」前面"）。
        //   这里就地把它物化成一个空的 `<p><br></p>`、光标放进去 —— 合成就落在这块里，
        //   上屏后是 `<p>中</p>`，后面那段一个字都没被碰（导出时空段落仍归一化成独立 <br>）。
        try { toolboxBlankLineCaretHost(); } catch (e1) {}
        toolboxComposing = true;
        toolboxComposingFlush = true;      // 合成结束后补一次归一化（上屏的字要并进该在的块）
        toolboxHintSync();                 // ★ 合成中也按内容实时判定（拼音一出现提示语就该消失）
    });
    toolboxTpl.editor.addEventListener('compositionupdate', function () { toolboxComposing = true; toolboxHintSync(); });
    // ★★ IME 守卫之三：合成结束（拼音上屏）→ 立刻解冻（后面紧跟的那个 input 要能正常处理），
    //   但结构归一化**推迟到下一帧**：此刻 DOM 还是"用户刚确认的样子"，马上重写会打断
    //   输入法最后的收尾（丢字/重复/光标乱跳正是这么来的）。归一化里会先存选区、跑完再恢复。
    toolboxTpl.editor.addEventListener('compositionend', function () { toolboxComposingFinish(); toolboxHintSync(); });
    // 编辑区里的回车（用户口径，2024 更正）：
    //   · **Enter** = 段落分界 → 新建一个 `<p>`，光标进新段（toolboxToolbarAction('para')）；
    //   · **Shift+Enter** = 段内分行 → 在当前 `<p>` 里插一根 `<br>`，光标到它后面那一行
    //     （toolboxToolbarAction('br')，和工具栏「换行」按钮**完全同一个入口**）。
    // 两类 `<br>` 因此永远不会互换：段内的留在 `<p>` 里，段落之间那个独立 `<br>` 只能由
    // "连按两次 Enter"（空段落升格）或粘贴的空行产生。
    // ★ Ctrl/Cmd/Alt+Enter 一律不劫持（浏览器默认行为）。
    // ★ 只挂在 #tbEditor 上：代码区 #tbCode、文件名 #tbFileName、各对话框输入框都不受影响。
    // ★★ IME 守卫之四（**最关键的一条**）：合成中的 Enter 是输入法的"选词确认"，不是换行。
    //   判据 isComposing / keyCode 229（老浏览器"正在合成"标记）/ 我们自己的冻结位，
    //   命中就**直接放行给输入法**：既不 preventDefault，也不插 <br>、不拆段、不改任何结构。
    //   合成结束之后（compositionend 已过）再按 Enter，才恢复成正常的段落分界/段内换行。
    toolboxTpl.editor.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.isComposing === true || e.keyCode === 229 || toolboxComposing) return;
        e.preventDefault();
        // ★ 先把"此刻的真实光标"补回存档，再做插入（用户实测 bug 的根因就在这里）：
        //   这个监听器**排在** toolboxDropRange 那条 keydown 之后，而那条会把存档和快照一起
        //   清空（它的职责是"用户自己动了光标 → 旧快照作废"）。存档一空，插入就只能退到
        //   "编辑区**根**的末尾"当落点 —— 于是节点落到块**外面**，成了根级裸节点。
        //   后果就是用户看到的那些"所见 ≠ 代码"的老毛病。
        //   光标此刻就在正文里，实时选区是唯一正确的落点。
        toolboxSaveRange();
        // ★ 这里**不**物化空行：Enter 在空行上的语义是"再要一个空行"（连按 Enter 出多个空行，
        //   见 42 段的既定口径），把它先变成空段落壳会打断 "⌅⌅⌅" 这条链。空行的物化只在
        //   真正需要"插入点"的两条路上做：合成开始前、粘贴前（toolboxBlankLineCaretHost）。
        toolboxToolbarAction(e.shiftKey ? 'br' : 'para');
    });
    // 段间退格：只删那根"独立空行 <br>"，别让浏览器把整段吞掉（见 toolboxBackspaceBlankLine）。
    //   ★ IME 守卫同样生效（合成中的退格属于输入法）。
    //   ★ 只认不带修饰键的 Backspace：Shift/Ctrl/Cmd/Alt+Backspace 一律交回浏览器。
    toolboxTpl.editor.addEventListener('keydown', function (e) {
        if (e.key !== 'Backspace' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.isComposing === true || e.keyCode === 229 || toolboxComposing) return;
        if (!toolboxBackspaceBlankLine()) return;
        e.preventDefault();
    });
    // 表格里右键 → 紧凑小菜单（插/删行列、插删单元格、合并/拆分）。
    // ★ 右键时先把光标放到点上（除非现在正跨格选中 —— 那多半就是要合并），
    //   再把这份选区**冻结**下来，菜单项执行时用它。
    toolboxTpl.editor.addEventListener('contextmenu', function (e) {
        const ed = toolboxTpl.editor;
        // ① 点在图片上（含占位框）→ 图片菜单（C）
        const img = toolboxImageTargetOf(e.target, ed);
        if (img) {
            e.preventDefault();
            toolboxImgMenuTarget = img;
            toolboxCaretAfterNode(toolboxImgDisplayWrap(img) || img);   // 光标放到图后（操作对象明确）
            toolboxSnapClear();
            toolboxSaveRange();
            toolboxTableMenuOpen(e.clientX, e.clientY, ed, null, 'image');
            return;
        }
        // ② 点在表格里 → 表格菜单
        const cell = toolboxTableCellOf(e.target, ed);
        if (!cell) { toolboxTableMenuClose(); return; }        // 表格外右键：走浏览器自己的菜单
        e.preventDefault();
        const picked = toolboxTablePickedCells(ed);
        if (!(picked && picked.cells.length > 1)) toolboxCaretFromPoint(e.clientX, e.clientY, cell);
        toolboxSnapClear();
        toolboxSaveRange();
        toolboxSnapRange = toolboxRangeLive(toolboxRange) ? toolboxRange.cloneRange() : null;
        toolboxSnapText = toolboxSnapRange ? String(toolboxSnapRange) : '';
        toolboxTableMenuOpen(e.clientX, e.clientY, ed, cell, 'table');
    });
    toolboxTpl.editor.addEventListener('scroll', toolboxTableMenuClose);
    // 点别处 / 按 Esc 关掉菜单
    document.addEventListener('mousedown', function (e) {
        const m = toolboxTableMenuEl();
        if (m && !m.hidden && !m.contains(e.target)) toolboxTableMenuClose();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) toolboxTableMenuClose();
    });
    window.addEventListener('resize', toolboxTableMenuClose);
    window.addEventListener('blur', toolboxTableMenuClose);
    // 鼠标划到列边界上就把光标改成 col-resize（只在有边界时才改，不然编辑区光标会很花）
    toolboxTpl.editor.addEventListener('mousemove', function (e) {
        if (toolboxColDrag) return;
        const hit = toolboxColHit(toolboxColCellAt(e), e.clientX);
        toolboxTpl.editor.style.cursor = hit ? 'col-resize' : '';
    });
    toolboxTpl.editor.addEventListener('mouseleave', function () {
        if (!toolboxColDrag) toolboxTpl.editor.style.cursor = '';
    });
    toolboxTpl.editor.addEventListener('input', function (e) {
        if (toolboxSyncBusy) return;                 // ★ 抑制位：这是"代码区 → 编辑区"写进来的
        // ★★ IME 守卫之五：**合成期间什么都不做** —— 不转换、不归一化、不刷新。
        //   合成中的 input（inputType = insertCompositionText）只是拼音/候选字在变，
        //   这时候把打的字包进 <p> 或者把节点搬走，输入法下一次 update 就写不回去了
        //   （用户实测的丢字/重复/光标乱跳）。合成结束后由 compositionend 那条路补跑。
        const composing = toolboxComposingActive(e);
        toolboxHintSync();                           // ★ 提示语：合成中的拼音也算"有内容"（马上隐藏）
        // ★ 空行 ↔ 段落的动态互转（用户口径，见这两个函数上方的长注释）：
        //   打字落在空行上 → 独立 <br> 就地变成 <p>；把某段的字删光 → 那个 <p> 退回独立 <br>。
        //   必须在 scheduleRefresh 之前跑：这时打的字还是根上的裸文本，能看出它挨着哪个 <br>。
        const it = String((e && e.inputType) || '');
        if (!composing) {
            toolboxComposing = false;                // 收到非合成的输入 = 合成肯定已经结束（兜底解冻）
            if (it.indexOf('delete') === 0) toolboxParagraphToBlankLine();
            else if (it.indexOf('insert') === 0) {
                // ★ 先补一条"事后补救"的路：浏览器把刚敲的字插进**下一段的开头**时
                //   （光标其实停在空行上，见 toolboxTypedIntoNextBlock），把那几个字认出来
                //   自成一段、光标放到字后。合成/粘贴那两条路是**提前物化**（见 compositionstart
                //   与 toolboxPastePlain 里的 toolboxBlankLineCaretHost），这里管普通按键。
                if (it !== 'insertFromPaste' && it !== 'insertFromDrop') {
                    let n = 0;
                    try { n = String((e && e.data) || '').replace(/[\r\n]/g, '').length; } catch (e9) { n = 0; }
                    if (n > 0) toolboxTypedIntoNextBlock(n);
                }
                toolboxFillBlankLine();
            }
            // ★ 删字/撤回到"块尾 <br> 之后"时把落脚点补回来（光标看得见、点得着）。
            toolboxCaretSupportSync();
        } else {
            toolboxComposingFlush = true;            // 记下来：合成结束后补一次归一化 + 刷新
        }
        if (!composing) toolboxScheduleRefresh(false);
        toolboxScheduleDraftSave();
        toolboxUndoSoon();
    });
    // 光标离开"空光标托"（用户点到别处去了）→ 那个"落脚行"立刻收掉：
    // 编辑区不允许比代码区多出一行（托只在光标停在那儿时才是必要的）。
    document.addEventListener('selectionchange', function () {
        if (!toolboxLoaded || toolboxSyncBusy) return;
        if (toolboxComposing) return;                    // ★★ IME：合成中不扫托（扫托就是改 DOM）
        const ed = toolboxTpl && toolboxTpl.editor;
        if (!ed || !ed.querySelectorAll) return;
        if (!ed.querySelectorAll('[' + TOOLBOX_CARET_ATTR + ']').length) return;
        toolboxCaretHolderSweep();
    });
    toolboxTpl.editor.addEventListener('keyup', function (e) {
        if (toolboxSyncBusy) return;
        toolboxHintSync();                                                        // ★ 提示语跟着内容走
        if (toolboxComposingActive(e)) { toolboxComposingFlush = true; return; }   // ★★ IME：合成中不刷新
        toolboxScheduleRefresh(false);
        toolboxScheduleDraftSave();
        toolboxUndoSoon();
    });
    toolboxTpl.editor.addEventListener('blur', toolboxSaveRange);

    // 选区变化就存一份（点工具栏按钮时靠它恢复）。
    // ★ 这几个全局监听只在 initToolboxDOM 里挂**一次**（toolboxLoaded 守卫）；
    //   回调只做"存一个 Range"，不碰 DOM、不阻止任何默认行为，所以完全不影响
    //   下拉栏（dropdown.js 的 pointerdown 捕获）、自绘滚动条或触摸交互。
    document.addEventListener('selectionchange', toolboxSaveRange);
    document.addEventListener('keyup', toolboxSaveRange);
    document.addEventListener('mouseup', toolboxSaveRange);

    // ★ 工具栏状态跟着选区走（Bug 5：像 Word 一样"选中什么就显示什么"）。
    //   只用"读 DOM + 算样式"，不改 DOM、不抢焦点，所以对主站/触摸没有任何影响；
    //   计算合并到一帧里（toolboxScheduleToolbarState），拖选时不会抖。
    document.addEventListener('selectionchange', function () {
        if (!toolboxTpl || !toolboxTpl.modal || toolboxTpl.modal.style.display !== 'flex') return;
        toolboxScheduleToolbarState();
        // ★ 焦点在代码区：这次 selectionchange 是"焦点移走"带来的，正文侧那份选区已经
        //   不是用户的意思了 —— 方向交给代码区（它的 select 事件）决定。
        if (document.activeElement === toolboxTpl.code) return;
        toolboxScheduleHighlight('editor');            // 选区互高亮（A）：正文 → 代码区
    });
    toolboxTpl.editor.addEventListener('keyup', toolboxScheduleToolbarState);
    toolboxTpl.editor.addEventListener('mouseup', toolboxScheduleToolbarState);
    toolboxTpl.editor.addEventListener('input', toolboxScheduleToolbarState);
    // 代码区选中也要高亮到正文（A）：用 select/selectionchange 都拿不到 textarea 的选区变化，
    // 只能靠 keyup/mouseup/select 这几个事件（都在 textarea 自身上）
    toolboxTpl.code.addEventListener('keyup', function () { toolboxScheduleHighlight('code'); });
    toolboxTpl.code.addEventListener('mouseup', function () { toolboxScheduleHighlight('code'); });
    toolboxTpl.code.addEventListener('select', function () { toolboxScheduleHighlight('code'); });
    toolboxTpl.code.addEventListener('scroll', toolboxSyncCodeScroll);
    // 行号栏（gutter）：**新加**的监听器，上面那条（toolboxSyncCodeScroll）一个字不动。
    //   · scroll：只同步行号栏的纵向偏移（translateY，不做别的）；
    //   · input：输入时防抖重排（序号个数 = 逻辑行数）；
    //   · ResizeObserver + window resize：面板/窗口尺寸变了、进/出全屏、卡片拖拽缩放
    //     都会让折行位置变化，必须重新量高度（否则折行一多就整体错位）。
    toolboxTpl.code.addEventListener('scroll', toolboxGutterScroll);
    toolboxTpl.code.addEventListener('input', toolboxScheduleGutter);
    window.addEventListener('resize', toolboxScheduleGutter);
    if (window.ResizeObserver) {
        try {
            toolboxGutterRO = new ResizeObserver(function () { toolboxGutterSync(); });
            toolboxGutterRO.observe(toolboxTpl.code);
        } catch (e) { toolboxGutterRO = null; }
    }
    toolboxScheduleGutter();

    // ① 工具栏上**所有可点元素**（按钮、字号档、对齐图标、菜单项、窗口按钮、列宽把手）：
    //    按下的一瞬间先**冻结选区**（Range + 选中的纯文本），再阻止默认（不把焦点交给按钮、
    //    也不让这次点击清掉正文里的选区）。用一次委托统一处理，不再逐个按钮加。
    //    ★ 顺序不能反：冻结必须发生在焦点被按钮/输入框抢走**之前**，
    //      否则现场只剩一个空选区，插入就退化成"默认文字"，用户选的内容被吃掉。
    //    ★ 不能拦的地方：编辑区（拦了就没法放光标/拖选）、代码区与文件名输入框（用户要点进去打字）、
    //      对话框里的输入框、图片占位框（点它要能选图/右键）。
    modal.addEventListener('mousedown', function (e) {
        if (!e.target) return;
        if (!toolboxToolbarHit(e.target)) return;
        toolboxFreezeSelection();
        e.preventDefault();
    });
    // 触摸/手写笔：mousedown 之前还有一次 pointerdown，冻结放这里更早一点。
    // ★ preventDefault 只对**鼠标**做：触摸上拦掉 pointerdown 会连"点一下"的 click 一起丢掉
    //   （按钮直接失灵）。触摸路径靠 mousedown 那一层兜。
    modal.addEventListener('pointerdown', function (e) {
        if (!e.target) return;
        if (!toolboxToolbarHit(e.target)) return;
        toolboxFreezeSelection();
        if (e.pointerType === 'mouse') e.preventDefault();
    });

    // ② Esc 关闭 + 撤回/恢复快捷键。
    //    ★ 只挂在弹窗自己身上（不用 document）：所以"焦点不在弹窗里"时这些键一点都不受
    //    影响，主站的 Ctrl+Z 照旧是浏览器原生的。
    modal.addEventListener('keydown', function (e) { toolboxHandleKey(e); });

    // ★ 兜底那一个：焦点掉到 body 上时（最典型的是"复制 HTML"用了隐藏 textarea 兜底，
    //   提完内容把 textarea 删掉，焦点就落到 body 了），keydown 根本不会经过弹窗 ——
    //   于是 Esc 关不掉、快捷键失效。所以再挂一个**一次性**的 document 监听：
    //   只在弹窗开着、且事件不是从弹窗内部冒出来的时候接手（内部的那次已经被上面处理并
    //   stopPropagation 掉了，不会重复执行）。它与工具箱的其它 document 监听一样只挂一次，
    //   弹窗关着的时候第一行就返回，不会给主站增加任何行为。
    document.addEventListener('keydown', function (e) {
        if (!toolboxTpl || !toolboxTpl.modal || toolboxTpl.modal.style.display !== 'flex') return;
        if (e.target && toolboxTpl.modal.contains(e.target)) return;
        toolboxHandleKey(e);
    });

    // ③ 点遮罩关闭（点内容卡片不算）。字段对话框开着时先关对话框。
    //   ★ 只有"真的是一次点击"才算数：按下与抬起之间鼠标挪过（拖拽/滑动手势）就不关。
    //     浏览器把"按在卡片里、抬在遮罩上"的 click 派发到两者的共同祖先 —— 也就是遮罩本身，
    //     于是"在标题栏按钮上起手往外拖"会被当成点遮罩，弹窗莫名其妙就没了（用户实测）。
    let maskDown = null;
    modal.addEventListener('pointerdown', function (e) {
        maskDown = (e.target === modal) ? { x: e.clientX, y: e.clientY } : null;
    }, true);
    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            const d = maskDown;
            maskDown = null;
            if (!d || Math.abs(e.clientX - d.x) > 6 || Math.abs(e.clientY - d.y) > 6) return;
            toolboxClose();
            return;
        }
        if (e.target === toolboxTpl.dialog) {
            toolboxCloseDialog();
            toolboxFocusEditor();
            toolboxRestoreRange();
        }
    });

    const okBtn = modal.querySelector('#tbDialogOk');
    const cancelBtn = modal.querySelector('#tbDialogCancel');
    if (okBtn) okBtn.addEventListener('click', function () { toolboxDialogOk(); });
    if (cancelBtn) cancelBtn.addEventListener('click', function () { toolboxDialogCancel(); });

    // 草稿确认弹窗（#tbDraftAsk，在 #toolboxModal 外面）上的两个按钮：
    //   「恢复」把草稿灌回编辑区、「丢弃」删掉草稿；两者都把焦点/选区还回正文。
    const restoreBtn = toolboxTpl.draftRestore;
    const discardBtn = toolboxTpl.draftDiscard;
    if (restoreBtn) restoreBtn.addEventListener('click', function () {
        toolboxRestoreDraft();
        toolboxKeepFocus();
        toolboxFocusEditor();
        toolboxRestoreRange();
    });
    if (discardBtn) discardBtn.addEventListener('click', function () {
        toolboxDiscardDraft();
        toolboxDraftAskHide();
        toolboxFocusEditor();
        toolboxRestoreRange();
    });
    // 草稿弹窗自己吃掉按键：Esc = **稍后再说**
    //   （★ 这是刻意的选择：用户明确要求"按 Esc 或点遮罩 = 关闭弹窗但不恢复也不删除草稿，
    //     下次打开还会问"。所以这里只关弹窗，绝不碰 localStorage。）
    //   同时把事件 stopPropagation 掉，免得同一次 Esc 顺手把整个工具箱也关了。
    if (toolboxTpl.draftAsk) {
        toolboxTpl.draftAsk.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                e.stopPropagation();
                toolboxDraftAskHide();                 // 只是藏起来：草稿原样留着，下次打开还会问
                toolboxFocusEditor();
                toolboxRestoreRange();
            }
        });
        // 点遮罩：同样是"稍后再说"（点卡片里面不关 —— 与字段对话框一致）
        toolboxTpl.draftAsk.addEventListener('click', function (e) {
            if (e.target !== toolboxTpl.draftAsk) return;
            toolboxDraftAskHide();
            toolboxFocusEditor();
            toolboxRestoreRange();
        });
    }

    // 左上角文件名：见上面那一段注释的规则表（① 从外部点进来 → 全选；② 已在标题里 → 原生编辑）。
    // 这里严格按"mousedown 分流 + caretInTitle 状态标志"实现，**不挂 click** ——
    // click 时机太晚，光标已经被移动过，再 select() 就会变成"频繁全选"（用户实测的回归）。
    if (toolboxTpl.fileName) {
        const fnEl = toolboxTpl.fileName;
        // 焦点进来就把标记置上，并全选（首次点击 / Tab 聚焦都走这里）
        fnEl.addEventListener('focus', function () {
            toolboxNameCaretIn = true;
            toolboxFileNameSelectAll();
        });
        // 失焦复位：点了编辑区之后再点标题 → 又回到"从外部点进来"那一支，重新全选；
        // 同时**回填空名字**（用户把名字删光后离开输入框 → 名字恢复成 Untitled）。
        fnEl.addEventListener('blur', function () {
            toolboxNameCaretIn = false;
            toolboxNameDown = null;
            toolboxFileNameNormalizeEmpty();
        });
        fnEl.addEventListener('mousedown', function (e) {
            if (toolboxNameCaretIn) return;             // ② 已在标题里：什么都别做，交回浏览器
            e.preventDefault();                         // ① 从外部点进来：我们接管
            try { fnEl.focus(); } catch (e2) {}          // → 触发 focus 里的全选
            toolboxNameDown = {
                x: e.clientX,
                y: e.clientY,
                anchor: toolboxFileNameOffsetFromX(fnEl, e.clientX),
                dragging: false
            };
        });
        // 拖动兜底：① 这条路上原生拖选被 preventDefault 拦掉了，所以由我们按鼠标位置扩选。
        // 第一次超过阈值就把锚点定在**按下的位置**（不是 0），随后跟随指针。
        fnEl.addEventListener('mousemove', function (e) {
            const d = toolboxNameDown;
            if (!d) return;                             // ② 那条路：原生拖选，不插手
            if (!d.dragging && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < TOOLBOX_NAME_CLICK_SLOP) return;
            d.dragging = true;
            const b = toolboxFileNameOffsetFromX(fnEl, e.clientX);
            try {
                fnEl.setSelectionRange(Math.min(d.anchor, b), Math.max(d.anchor, b), b < d.anchor ? 'backward' : 'forward');
            } catch (e2) {}
        });
        fnEl.addEventListener('mouseup', function () {
            toolboxNameDown = null;                     // 单击：focus 里已经全选好了，这里不再插手
        });
        fnEl.addEventListener('input', function () {
            toolboxFileNameSyncTitle();
            // ★ 改名字也要存草稿，而且是**防抖**写（跟改内容同一个时机，不每敲一个字就落盘）。
            //   这样"只改了名字、内容还空着"也能在刷新后留住 —— 用户明确要求名字独立持久化。
            toolboxDraftPending = false;    // 用户在动手了 → 草稿询问的"未决"状态结束
            toolboxScheduleDraftSave();
            // 用户已经在动手了：草稿询问弹窗不必再举着
            toolboxHideDraftBar();
        });
        // 回车：确认这个名字。顺手把"清空后没回填"的情况补上（用户要求的一个时机）。
        fnEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                e.preventDefault();
                toolboxFileNameNormalizeEmpty();
                try { fnEl.select(); } catch (e2) {}
            }
        });
        toolboxFileNameReset();
    }

    // 焦点在正文 / 代码区之间来回时，工具栏的可用性要**立刻**跟着变：
    // focusin / focusout 都挂在弹窗上（事件会冒泡），一次覆盖 code ↔ editor ↔ 文件名 的所有切换。
    // ★ 为什么用 focusin/focusout 而不是给 textarea 挂 focus/blur：
    //   焦点从代码区移到正文（或反向）时，两个元素各自的事件顺序在不同浏览器里不一样，
    //   而 focusin/focusout 冒泡到同一个节点后顺序稳定，禁用态不会停在中间状态。
    modal.addEventListener('focusin', function () {
        toolboxSyncPanelFocus();
        toolboxSyncToolbarState();
    });
    modal.addEventListener('focusout', function () {
        // focusout 时 activeElement 可能还没更新（正在切换中），推到下一帧再算一次
        toolboxSyncPanelFocus();
        toolboxSchedulePanelFocus();
    });
    toolboxSyncPanelFocus();      // 初始状态：焦点还没进来，按"不在代码区"算（全可用）

    // 代码区里改内容也会让工具栏状态变（选区标签/光标所在位置），保持既有行为
    toolboxTpl.code.addEventListener('input', function () { toolboxSyncPanelFocus(); });

    // 代码区：**可编辑**，改了就实时同步回编辑区（见 toolboxCodeToEditor）。
    // 不做"应用"按钮 —— 用户要的是上下都实时。
    toolboxTpl.code.addEventListener('input', function () {
        if (toolboxSyncBusy) return;                 // ★ 抑制位：这是"编辑区 → 代码区"写进来的，不是用户改的
        toolboxValidate();
        toolboxScheduleCodeToEditor();
        toolboxScheduleDraftSave();
        toolboxUndoSoon();
    });
    // 编辑器自动插入的换行之类也会触发（paste 之后没有 input 的情况），补一个
    toolboxTpl.code.addEventListener('change', function () {
        if (toolboxSyncBusy) return;
        toolboxScheduleCodeToEditor();
    });
    // 代码区粘贴：原样保留 HTML（"粘贴现成文章的 HTML 导入"就靠这条路）
    toolboxTpl.code.addEventListener('paste', toolboxCodePasteHandler);

    // 事件委托：所有带 data-tb 的按钮走同一张动作表
    modal.addEventListener('click', function (e) {
        const t = e.target;
        if (!t || !t.closest) return;
        const btn = t.closest('[data-tb]');
        if (!btn) return;
        const act = btn.getAttribute('data-tb');
        if (act) toolboxToolbarAction(act, btn);
    });

    // （文字颜色 / 背景高亮两个取色器已按用户要求删除，这里不再有它们的绑定）

    toolboxLoaded = true;
    toolboxRefresh();
}

// 兜底结构（index.html 里没写 #toolboxModal 时才会走到）。
// 正常路径下永远不会执行 —— 它只是"宁可降级，也别让入口点了没反应"。
function toolboxFallbackHtml() {
    return '<div class="tb-card">'
        + '<div class="tb-head" id="tbHead">'
        // 左上角与 index.html 一致：真实文本 value="Untitled"（不是 placeholder）
        + '<input type="text" class="tb-filename" id="tbFileName" value="Untitled" title="Untitled"'
        + ' aria-label="下载文件名" autocomplete="off" spellcheck="false">'
        + '<button type="button" class="tb-btn tb-win" data-tb="fullscreen" id="tbFullBtn" title="全屏" aria-label="全屏">'
        + toolboxWinIconHtml('full') + '</button>'
        + '<button type="button" class="tb-close" data-tb="close" title="关闭（Esc）">×</button></div>'
        + '<div class="tb-toolbar">'
        + '<button type="button" class="tb-btn tb-primary" data-tb="copy" title="复制HTML代码至剪贴板">复制</button>'
        + '<button type="button" class="tb-btn" data-tb="download" title="将代码下载为.html文件">下载</button>'
        + '<button type="button" class="tb-btn tb-danger" data-tb="cleardraft" title="清空正文并删除草稿">清空</button></div>'
        // ★ 草稿确认弹窗（#tbDraftAsk）不再属于卡片内部：它挂在 #toolboxModal 外面，
        //   兜底路径下也一样找不到那个节点 —— toolboxDraftOffer 会自动跳过（没有 draftAsk 就不弹），
        //   绝不会因为"兜底结构里少写一个 div"而抛异常。
        + '<div class="tb-body">'
        + '<div class="tb-pane tb-pane-edit"><div class="tb-pane-head">编辑区</div>'
        + '<div class="tb-editor tb-hint-on" id="tbEditor" contenteditable="true" spellcheck="false" data-placeholder="从这里开始……"></div></div>'
        + '<div class="tb-pane tb-pane-code"><div class="tb-pane-head">HTML</div>'
        + '<textarea class="tb-code" id="tbCode" spellcheck="false" wrap="soft" placeholder="可在此粘贴或编辑HTML代码"></textarea>'
        + '<div class="tb-validate" id="tbValidate" data-errors="0" data-warnings="0"></div></div></div>'
        + '<div class="tb-foot"><span class="tb-count"><b id="tbCount">0</b> 字</span></div>'
        + '<div class="tb-toast" id="tbToast"></div>'
        + '<div class="tb-dialog" id="tbDialog"><div class="tb-dialog-card">'
        + '<div class="tb-dialog-title" id="tbDialogTitle"></div><div class="tb-dialog-body" id="tbDialogBody"></div>'
        + '<div class="tb-dialog-foot"><button type="button" class="tb-btn" id="tbDialogCancel">取消</button>'
        + '<button type="button" class="tb-btn tb-primary" id="tbDialogOk">确定</button></div></div></div>'
        + '</div>';
}

// 立即初始化：本脚本在 </body> 之前、所有其它脚本之后加载，此刻 DOM 已就绪。
// 整段用 try/catch 包住：工具箱是"锦上添花"，它抛异常绝不能连累主站。
try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initToolboxDOM);
    else initToolboxDOM();
} catch (e) {
    if (window.console && console.warn) console.warn('[toolbox] 初始化失败：', e);
}
