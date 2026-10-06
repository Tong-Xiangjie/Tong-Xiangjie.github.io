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
                || name === 'poster' || name === 'alt' || name === 'title' || name === 'target' || name === 'rel');
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
    if (s.indexOf('rgb(') >= 0) {
        s = s.replace(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi, function (m, r, g, b) {
            const hex = function (n) {
                const v = Math.max(0, Math.min(255, parseInt(n, 10) || 0)).toString(16);
                return v.length < 2 ? '0' + v : v;
            };
            return '#' + hex(r) + hex(g) + hex(b);
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

// 这个元素能不能和上一行挤在一起（子节点全是文本或行内标签）
function toolboxIsInlineOnly(node) {
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if (k.nodeType === 1 && !toolboxIsInlineTag(k)) return false;
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

function toolboxFormatInline(el) {
    let s = '';
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (n.nodeType === 3) s += toolboxEscText(String(n.nodeValue || '').replace(TOOLBOX_WS, ' '));
        else if (n.nodeType === 1) {
            const tag = n.tagName.toLowerCase();
            const at = toolboxAttrsOf(n);
            if (TOOLBOX_VOID_TAGS.indexOf(n.tagName) >= 0) s += '<' + tag + at + '>';
            else s += '<' + tag + at + '>' + toolboxFormatInline(n) + '</' + tag + '>';
        }
    }
    return s;
}

// 这个元素自己算不算"自成一行"的块级（白名单在 TOOLBOX_BLOCK_TAGS）
function toolboxIsBlockTag(el) {
    if (TOOLBOX_BLOCK_TAGS.indexOf(el.tagName) < 0) return false;
    const st = el.getAttribute ? String(el.getAttribute('style') || '') : '';
    // 显式写成行内/flex 的，不按块级处理
    return !/display\s*:\s*(inline|inline-block|inline-flex|flex)/i.test(st);
}

// 块级节点之间的纯空白文本节点：没有意义（浏览器也忽略），丢掉才能幂等
function toolboxWhitespaceBetweenBlocks(node, i) {
    const kids = node.childNodes;
    for (let k = i - 1; k >= 0; k--) {
        const s = kids[k];
        if (s.nodeType === 3) { if (String(s.nodeValue || '').replace(TOOLBOX_WS, '') === '') continue; return false; }
        return s.nodeType === 1 && toolboxIsBlockTag(s);
    }
    for (let k = i + 1; k < kids.length; k++) {
        const s = kids[k];
        if (s.nodeType === 3) { if (String(s.nodeValue || '').replace(TOOLBOX_WS, '') === '') continue; return false; }
        return s.nodeType === 1 && toolboxIsBlockTag(s);
    }
    return false;
}

function toolboxFormatHtml(box) {
    if (!box) return '';
    const out = [];

    // 把一层的子节点序列排成若干行：块级各自成行，行内贴着当前行
    function emit(parent) {
        let line = '';
        const flush = function () {
            const t = line.trim();
            if (t) out.push(t);
            line = '';
        };
        const kids = parent.childNodes;
        for (let i = 0; i < kids.length; i++) {
            const n = kids[i];
            if (n.nodeType === 3) {                          // 文本
                const raw = String(n.nodeValue || '');
                if (raw.replace(TOOLBOX_WS, '') === '' && toolboxWhitespaceBetweenBlocks(parent, i)) continue;
                const t = toolboxEscText(raw.replace(TOOLBOX_WS, ' '));
                // ★ 只有空白（含 &nbsp; / 零宽空格）的文本节点**不成行**。
                //   以前这里会把它变成一行 "&nbsp;"：在页面上就是一条凭空的空行
                //   （用户报的"插入任何东西都多出空行"，这是其中一条来源）。
                //   注意：行里已经有字了就不动它 —— 行内的 &nbsp; 是语料里的排版手段。
                if (!line.trim() && !t.replace(/&nbsp;|\u200b|\s/g, '')) continue;
                if (t) line += t;
                continue;
            }
            if (n.nodeType !== 1) continue;                   // 注释等一律不输出
            const tag = n.tagName.toLowerCase();
            const open = '<' + tag + toolboxAttrsOf(n) + '>';
            if (TOOLBOX_VOID_TAGS.indexOf(n.tagName) >= 0) { line += open; continue; }
            // flex 容器（并排图片那一行）整体保持一行：里面全是并排的图，
            // 拆行只让代码难读（虽然 flex 会忽略纯空白文本节点，但没必要冒险）
            if (toolboxIsFlexBox(n)) {
                line += open + toolboxFormatInline(n) + '</' + tag + '>';
                continue;
            }
            if (toolboxIsInlineOnly(n)) {                     // <b><span>标题</span></b> 挤一行
                line += open + toolboxFormatInline(n) + '</' + tag + '>';
                continue;
            }
            flush();                                          // 块级：先收掉手上这行
            out.push(open);
            emit(n);
            out.push('</' + tag + '>');
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

// 把光标定位到刚插入的那段内容之后。
// 规则：整块内容（表格/div/center 这类）→ 落在块**后面**，这样接着打字会新起一段，
// 而不是被吸进表格最后一格里（那是所见即所得编辑器最常见的一个坑）；
// 行内内容（<br>、<a>、<span>、<img>）→ 紧跟在它后面。
function toolboxPlaceCaretAfter(inserted) {
    if (!inserted) return;
    const sel = window.getSelection && window.getSelection();
    if (!sel) return;
    const isEl = inserted.nodeType === 1;
    const isBlock = isEl && !toolboxIsInlineTag(inserted.tagName) && inserted.tagName !== 'IMG';
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
function toolboxInsertHtml(html, atRange) {
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
    //      它们在页面上就是一条多余的空行 —— 这里统一扫掉。
    toolboxCleanEditorBlocks(ed);
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
// 这些命令会把结果写成 <font>（老式标签）：foreColor / hiliteColor 产出
// <font color="#555555">，fontSize 产出 <font size="4">。语料里没有一个 <font>，
// 所以执行完立刻把 <font> 内联化成 <span style="…">，和现有文章的写法对齐。
const TOOLBOX_FONT_COMMANDS = ['foreColor', 'hiliteColor', 'backColor', 'fontName'];

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
    if (ok && TOOLBOX_FONT_COMMANDS.indexOf(command) >= 0) {
        const ed = toolboxTpl && toolboxTpl.editor;
        if (ed) toolboxUnwrapFonts(ed, '', null);
    }
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
    toolboxRestoreRange();
    if (ed) toolboxUnwrapFonts(ed, '', null);        // 先清掉历史 <font>，避免误伤
    let ok = false;
    try { ok = document.execCommand('fontSize', false, size); } catch (e) { ok = false; }
    if (ok && ed) toolboxUnwrapFonts(ed, TOOLBOX_FONT_EM[String(size)] || '1em', String(size));
    toolboxSnapClear();
    toolboxStoreRangeNow();
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    toolboxSyncToolbarState();
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
        let frag = null;
        try { frag = r.cloneContents(); } catch (e) { frag = null; }   // 克隆：出问题也不会丢原文
        if (!frag) { toolboxToast('这段内容清不了格式'); return false; }
        toolboxStripInlineFormat(frag);
        let first = null, last = null, ok = false;
        try {
            r.deleteContents();
            while (frag.firstChild) {
                const nd = frag.removeChild(frag.firstChild);
                r.insertNode(nd);
                if (!first) first = nd;
                r.setStartAfter(nd);
                r.collapse(true);
                last = nd;
                ok = true;
            }
        } catch (e2) { ok = false; }
        if (!ok) {
            // 极端情况（DOM 在中途被改）：把纯文字补回去，绝不静默丢内容
            try { r.insertNode(document.createTextNode(String(frag.textContent || ''))); } catch (e3) {}
        } else {
            const hoisted = toolboxHoistBlock(first, last);            // 块级别留在 <p> 里
            if (hoisted) last = hoisted;
            touched = last;
        }
    }
    toolboxSnapClear();
    toolboxCleanEditorBlocks(ed, touched);                             // 只清插入点附近的空块
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
const TOOLBOX_EMPHASIS_TAG = { bold: 'b', italic: 'i', underline: 'u', strike: 's' };
// 每种行内格式对应的"样式声明"（导入的内容常常只有样式、没有标签）
const TOOLBOX_INLINE_STYLE_RE = {
    bold: /^font-weight\s*:/i,
    italic: /^font-style\s*:/i,
    underline: /^(text-decoration|text-decoration-line)\s*:/i,
    strike: /^(text-decoration|text-decoration-line)\s*:/i
};

function toolboxRGBToHex(c) {
    const m = String(c || '').match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (!m) return /^#[0-9a-f]{3,8}$/i.test(String(c || '').trim()) ? String(c).trim().toLowerCase() : '';
    if (m[4] != null && parseFloat(m[4]) === 0) return '';            // 全透明：等于没有颜色
    const h = function (x) { const s = parseInt(x, 10).toString(16); return s.length < 2 ? '0' + s : s; };
    return '#' + h(m[1]) + h(m[2]) + h(m[3]);
}

// 当前选区（或光标处）的格式状态
function toolboxSelState() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const out = {
        ok: false, bold: false, italic: false, underline: false, strike: false,
        align: '', size: '', color: '', back: '', title: false, quote: false, body: false
    };
    if (!ed) return out;
    const r = toolboxLiveRange() || toolboxActiveRange();
    if (!r) return out;
    let node = r.startContainer;
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
            const cs = gcs(n);
            if (cs) {
                if ((parseInt(cs.fontWeight, 10) || 400) >= 600) out.bold = true;
                if (/italic|oblique/i.test(cs.fontStyle || '')) out.italic = true;
                const deco = String(cs.textDecorationLine || cs.textDecoration || '');
                if (/underline/i.test(deco)) out.underline = true;
                if (/line-through/i.test(deco)) out.strike = true;
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
    out.align = (al === 'left' || al === 'center' || al === 'right') ? al : '';
    // 字号档位：算出来的 px ÷ 编辑区基准字号 = 比例，就近吸附到工具栏五档（容差 4%）
    const base = parseFloat(gcs(ed) ? gcs(ed).fontSize : '') || 16;
    const px = parseFloat(ncs ? ncs.fontSize : '') || 0;
    if (px > 0) {
        const ratio = px / base;
        let best = '', diff = 0.04;
        for (let i = 0; i < TOOLBOX_SIZE_STEPS.length; i++) {
            const v = parseFloat(TOOLBOX_SIZE_STEPS[i]);
            if (Math.abs(ratio - v) <= diff) { diff = Math.abs(ratio - v); best = TOOLBOX_SIZE_STEPS[i]; }
        }
        out.size = best;
    }
    if (ncs) {
        out.color = toolboxRGBToHex(ncs.color);
        const bg = toolboxRGBToHex(ncs.backgroundColor);
        out.back = bg;
    }
    const bleft = bcs ? (parseFloat(bcs.borderLeftWidth) || 0) : 0;
    out.quote = bleft > 0;
    out.title = (out.align === 'center' && out.size === TOOLBOX_TITLE_SIZE);
    out.body = !out.title && !out.quote;
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
    mark('[data-tb="bold"]', st.bold);
    mark('[data-tb="italic"]', st.italic);
    mark('[data-tb="underline"]', st.underline);
    mark('[data-tb="strike"]', st.strike);
    const sizes = m.querySelectorAll('.tb-size');
    for (let i = 0; i < sizes.length; i++) {
        sizes[i].classList.toggle('active', sizes[i].getAttribute('data-size') === st.size && !!st.size);
    }
    mark('[data-tb="align-left"]', st.align === 'left');
    mark('[data-tb="align-center"]', st.align === 'center');
    mark('[data-tb="align-right"]', st.align === 'right');
    mark('[data-tb="title"]', st.title);
    mark('[data-tb="body"]', st.body);
    mark('[data-tb="quote"]', st.quote);
    // 颜色 / 高亮：显示"当前选中文字"的值（取不到就留空 = 色块不涂色）
    const paintSwatch = function (id, inputId, hex) {
        const sw = m.querySelector(id);
        if (sw) {
            if (hex) {
                sw.style.backgroundImage = 'linear-gradient(' + hex + ',' + hex + ')';
                sw.style.backgroundColor = 'transparent';
            } else {
                sw.style.backgroundImage = '';
                sw.style.backgroundColor = 'transparent';
            }
        }
        const inp = m.querySelector(inputId);
        // ★ 不抢正在拖色盘的输入框：只有它没被聚焦时才回写
        if (inp && hex && document.activeElement !== inp) inp.value = hex;
    };
    paintSwatch('#tbForeSwatch', '#tbForeColor', st.color);
    paintSwatch('#tbBackSwatch', '#tbBackColor', st.back);
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
let toolboxHl = { from: '', text: '', start: 0, end: 0, has: false };
let toolboxHlAnchor = { editor: 0, code: 0 };

function toolboxHighlightAPI() {
    return !!(window.CSS && window.CSS.highlights && typeof window.Highlight === 'function');
}
function toolboxCodeHlEl() {
    return document.getElementById('tbCodeHl');
}
// 把代码区的文字镜像到显示层（改动只在显示层，textarea 的 value 一个字节都不动）
function toolboxCodeHlSync() {
    const el = toolboxCodeHlEl();
    const code = toolboxTpl && toolboxTpl.code;
    if (!el || !code) return;
    const v = String(code.value || '');
    if (el.firstChild && el.firstChild.nodeType === 3 && el.firstChild.nodeValue === v) return;   // 没变就不动
    el.textContent = v;
    toolboxSyncCodeScroll();
    if (toolboxHl.has) toolboxPaintHighlight();      // 文字换了：旧的 Range 已失效，重画
}
function toolboxSyncCodeScroll() {
    const el = toolboxCodeHlEl();
    const code = toolboxTpl && toolboxTpl.code;
    if (!el || !code) return;
    el.scrollTop = code.scrollTop;
    el.scrollLeft = code.scrollLeft;
}
function toolboxClearHighlight() {
    toolboxHl = { from: '', text: '', start: 0, end: 0, has: false };
    try { if (window.CSS && CSS.highlights) CSS.highlights.delete(TOOLBOX_HL_NAME); } catch (e) {}
}
function toolboxScheduleHighlight(from) {
    if (toolboxHlRaf) return;
    const run = function () { toolboxHlRaf = 0; toolboxSyncHighlight(from); };
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

function toolboxSyncHighlight(from) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const code = toolboxTpl && toolboxTpl.code;
    const modal = toolboxTpl && toolboxTpl.modal;
    if (!ed || !code || !modal || modal.style.display !== 'flex') return;
    let raw = '', anchor = 0;
    if (from === 'code') {
        const s = code.selectionStart, e = code.selectionEnd;
        if (s == null || e == null || e <= s) { toolboxClearHighlight(); return; }        // 折叠：不高亮、不滚动
        raw = String(code.value || '').slice(s, e);
        anchor = toolboxHlAnchor.code;
    } else {
        const r = toolboxLiveRange();
        if (!r || r.collapsed) { toolboxClearHighlight(); return; }                      // 折叠：不高亮、不滚动
        try { raw = String(r); } catch (e) { raw = ''; }
        anchor = toolboxHlAnchor.editor;
    }
    if (!raw || !String(raw).replace(/\s+/g, '')) { toolboxClearHighlight(); return; }
    if (raw.length > TOOLBOX_HL_MAX) { toolboxClearHighlight(); return; }
    let text = raw, map = null, hay = '', at = -1;
    if (from === 'code') {
        // 代码 → 正文：把标签剥掉，剩下的文字拿去正文里找；剥完没字就放弃
        // （选中的是标签名/属性时正是这种情况）
        text = String(raw).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
        if (!text.replace(/\s+/g, '')) { toolboxClearHighlight(); return; }
        map = toolboxEditorTextMap(ed);
        hay = map.text;
        at = toolboxNearestIndex(hay, text, anchor);
        if (at < 0) {
            // 文字里可能有换行/连续空白差异：折叠空白后再试一次
            const flat = hay.replace(/\s+/g, ' ');
            const needle = text.replace(/\s+/g, ' ');
            const flatAt = toolboxNearestIndex(flat, needle, anchor);
            if (flatAt < 0) { toolboxClearHighlight(); return; }
            at = flatAt;                                  // 位置一致（空白折叠不改长度时最准）
        }
    } else {
        hay = String(code.value || '');
        at = toolboxNearestIndex(hay, text, anchor);
        if (at < 0) {
            // 正文里的 & < > 在代码里是实体：换个写法再找一次
            const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/\u00a0/g, '&nbsp;');
            at = toolboxNearestIndex(hay, esc, anchor);
            if (at >= 0) text = esc;
        }
        if (at < 0) { toolboxClearHighlight(); return; }
    }
    toolboxHl = { from: from, text: text, start: at, end: at + text.length, has: true };
    if (from === 'code') toolboxHlAnchor.editor = at; else toolboxHlAnchor.code = at;
    toolboxPaintHighlight();
}

function toolboxPaintHighlight() {
    const ed = toolboxTpl && toolboxTpl.editor;
    const code = toolboxTpl && toolboxTpl.code;
    if (!ed || !code || !toolboxHl.has) { toolboxClearHighlight(); return; }
    const st = toolboxHl;
    if (!toolboxHighlightAPI()) {
        // ★ 退化路径：不支持 Highlight API 时只把对应位置滚到视野里（不改 DOM、不动选区）
        if (st.from === 'editor') toolboxScrollCodeTo(st.start);
        else {
            const map = toolboxEditorTextMap(ed);
            const r = toolboxRangeFromOffsets(map, st.start, st.end);
            const host = r && r.startContainer && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode);
            if (host && host.scrollIntoView) { try { host.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
        }
        return;
    }
    try {
        if (st.from === 'editor') {
            // 高亮代码区：画在镜像层上（textarea 本身画不了）
            toolboxCodeHlSync();
            const host = toolboxCodeHlEl();
            const t = host && host.firstChild;
            if (!t || t.nodeType !== 3) { toolboxClearHighlight(); return; }
            const r = document.createRange();
            r.setStart(t, Math.min(st.start, t.nodeValue.length));
            r.setEnd(t, Math.min(st.end, t.nodeValue.length));
            CSS.highlights.set(TOOLBOX_HL_NAME, new Highlight(r));
            toolboxScrollCodeTo(st.start);
        } else {
            const map = toolboxEditorTextMap(ed);
            const r = toolboxRangeFromOffsets(map, st.start, st.end);
            if (!r) { toolboxClearHighlight(); return; }
            CSS.highlights.set(TOOLBOX_HL_NAME, new Highlight(r));
            const host = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
            if (host && host.scrollIntoView) { try { host.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
        }
    } catch (e) {
        // 极端情况（节点被换掉等）：安静放弃，绝不抛到外面
        toolboxClearHighlight();
    }
}
// 代码区滚到某个字符偏移所在的那一行（用行高估算，不做精确排版计算）
function toolboxScrollCodeTo(offset) {
    const code = toolboxTpl && toolboxTpl.code;
    if (!code) return;
    try {
        const before = String(code.value || '').slice(0, offset);
        const line = (before.match(/\n/g) || []).length;
        let lh = parseFloat(window.getComputedStyle ? getComputedStyle(code).lineHeight : '') || 0;
        if (!lh) lh = (parseFloat(getComputedStyle(code).fontSize) || 13) * 1.7;
        const target = line * lh - code.clientHeight / 2 + lh;
        code.scrollTop = Math.max(0, Math.min(target, code.scrollHeight - code.clientHeight));
        toolboxSyncCodeScroll();
    } catch (e) {}
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
function toolboxToggleInline(kind) {
    const ed = toolboxTpl && toolboxTpl.editor;
    const tag = TOOLBOX_EMPHASIS_TAG[kind];
    if (!ed || !tag) return false;
    toolboxFocusEditor();
    const sel = window.getSelection && window.getSelection();
    let r = toolboxActiveRange();
    if (r) { try { sel.removeAllRanges(); sel.addRange(r); } catch (e) { r = null; } }
    if (!r) { toolboxToast('先把光标放到要加格式的地方'); return false; }
    const on = !!toolboxSelState()[kind];             // 有效状态（标签或样式）为"开"就去掉
    // 这一种格式对应的"标签别名"（强调语义在多份语料里写法不一，都要认）
    const ALIAS = {
        bold: ['B', 'STRONG'], italic: ['I', 'EM'], underline: ['U'], strike: ['S', 'STRIKE', 'DEL']
    };
    const alias = ALIAS[kind] || [tag.toUpperCase()];
    const wantedTag = function (t) { return alias.indexOf(String(t || '').toUpperCase()) >= 0; };
    const unwrapIn = function (root) {
        if (!root) return;
        const list = root.querySelectorAll
            ? root.querySelectorAll('b,strong,i,em,u,s,strike,del') : [];
        for (let i = list.length - 1; i >= 0; i--) {
            if (wantedTag(list[i].tagName)) toolboxUnwrapElement(list[i]);
        }
        if (root.nodeType === 1 && wantedTag(root.tagName)) toolboxUnwrapElement(root);
        toolboxStripInlineDecls(root, kind);
    };
    let touched = null;
    if (r.collapsed) {
        // 光标：整段切换（Word 是"后续输入生效"；我们做整段，用户看得见、可撤回）
        let n = r.startContainer, block = null;
        while (n && n !== ed) {
            if (n.nodeType === 1 && toolboxIsBlockTag(n)) { block = n; break; }
            n = n.parentNode;
        }
        if (!block) block = toolboxWrapInlineAncestor(r, ed) || ed;
        if (on) {
            unwrapIn(block);
        } else if (block === ed) {
            // 编辑区根上直接放文本：包一层块再包标签，别让裸文本飘着
            const p = document.createElement('p');
            while (ed.firstChild) p.appendChild(ed.firstChild);
            ed.appendChild(p);
            const w = document.createElement(tag);
            while (p.firstChild) w.appendChild(p.firstChild);
            p.appendChild(w);
        } else {
            const w = document.createElement(tag);
            const kids = Array.prototype.slice.call(block.childNodes);
            if (kids.length) {
                block.insertBefore(w, kids[0]);
                for (let i = 0; i < kids.length; i++) w.appendChild(kids[i]);   // 连 <br> 一起包（换行也要在这段格式里）
            } else {
                block.appendChild(w);
            }
        }
        touched = block;
    } else {
        let frag = null;
        try { frag = r.cloneContents(); } catch (e) { frag = null; }
        if (!frag) return false;
        if (on) {
            unwrapIn(frag);
        } else {
            toolboxStripInlineDecls(frag, kind);       // 先摘掉"假装加粗"的样式，再包标签
            const w = document.createElement(tag);
            while (frag.firstChild) w.appendChild(frag.firstChild);
            frag.appendChild(w);
        }
        const wrap = document.createElement('span');   // 中转容器：片段先塞进它，再原样搬回文档
        while (frag.firstChild) wrap.appendChild(frag.firstChild);
        let first = null, last = null, ok = false;
        try {
            r.deleteContents();
            const kids = Array.prototype.slice.call(wrap.childNodes);
            for (let i = 0; i < kids.length; i++) {
                r.insertNode(kids[i]);
                if (!first) first = kids[i];
                r.setStartAfter(kids[i]);
                r.collapse(true);
                last = kids[i];
            }
            ok = true;
        } catch (e2) { ok = false; }
        if (!ok && wrap.firstChild) { try { r.insertNode(wrap); } catch (e3) {} }
        else touched = last;
        if (ok) {
            const hoisted = toolboxHoistBlock(first, last);
            if (hoisted) last = hoisted;
            touched = last;
        }
    }
    toolboxSnapClear();
    toolboxCleanEditorBlocks(ed, touched);
    toolboxStoreRangeNow();
    toolboxHideDraftBar();
    toolboxScheduleDraftSave();
    toolboxScheduleRefresh(true);
    toolboxRefresh();
    toolboxUndoPush(false);                            // 一次切换 = 一条撤回记录
    toolboxSyncToolbarState();
    return true;
}

// 「正文」= 「标题」的反操作：把选中内容恢复成正文。
// 做的事（只动这三样，图片/表格/字号以外的排版都不碰）：
//   · font-size 回默认（摘掉 font-size 声明）；
//   · 加粗/斜体去掉（<b>/<strong>/<i>/<em> 拆成纯内容）；
//   · 居中去掉（<center> 拆掉、style 里的 text-align 摘掉）。
// 没有选区时只处理光标所在的那个块（够用且不会误伤全文）。
function toolboxMakeBody() {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed) return false;
    toolboxFocusEditor();
    const r = toolboxRestoreRange();
    if (!r) return false;
    let targets = [];
    if (r.collapsed) {
        // 光标停在标题里点「正文」：整段（最近的块级祖先）都该恢复成正文
        let n = r.startContainer, block = null;
        while (n && n !== ed) {
            if (n.nodeType === 1 && toolboxIsBlockTag(n)) { block = n; break; }
            n = n.parentNode;
        }
        if (block) {
            targets = [{ el: block, full: true }];
        } else {
            let m = r.startContainer;                       // 没有块级祖先：把行内包装当"整段"
            while (m && m !== ed) {
                if (m.nodeType === 1) targets.push({ el: m, full: true });
                m = m.parentNode;
            }
        }
    } else {
        targets = toolboxBodyTargets(r, ed);
    }
    if (!targets.length) { toolboxToast('先把要恢复成正文的内容选中'); return false; }
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (!t.el || !t.el.parentNode) continue;
        if (t.full) toolboxStripTitleStyle(t.el);
        else toolboxStripStyleDecls(t.el);                  // 只摘样式，不动别人的结构
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
    if (host && host !== ed) toolboxDropEmptyBlocks(host);
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
//   —— 空的单元格是有意留的、连续 <br> 是用户排版空一行的手段。
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
        el.parentNode.removeChild(el);
    }
}

// ========== 插入块模板（照抄语料的写法）==========
// ★ 这几个块一律走 toolboxWrapSelection：**有选区就把选中的字包进去**，
//   没有选区才用默认文字（"文章标题"这类）。见 toolboxWrapSelection 的说明。
function toolboxInsertTitle() {
    return toolboxWrapSelection(function (inner) {
        return '<center><b><span style="font-size:' + TOOLBOX_TITLE_SIZE + ';">' + inner
            + '</span></b></center><br>';
    }, '文章标题');
}
function toolboxInsertQuote() {
    return toolboxWrapSelection(function (inner) {
        return '<div style="' + TOOLBOX_QUOTE_STYLE + '">' + inner + '</div>';
    }, '此处填写引用内容');
}
// 图注：语料主流是 <center><span style="color:#555555; font-size:0.85rem;">…</span></center>
function toolboxInsertCaption(text) {
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
    return toolboxWrapSelection(function (inner) {
        return '<p style="text-align:right;">' + inner + '</p>';
    }, '—— 落款');
}
function toolboxInsertBreak() {
    toolboxInsertHtml('<br>');
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
// 纯文本 → HTML：只做转义 + 换行换 <br>，别的什么都不加。
function toolboxPlainTextHtml(text) {
    const t = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const parts = t.split('\n');
    let html = '';
    for (let i = 0; i < parts.length; i++) {
        if (i) html += '<br>';
        if (parts[i]) html += toolboxEscText(parts[i]);
    }
    return html;
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
    // ★ 先取实时选区，再动 DOM —— 顺序不能反：清空编辑区/删选区之后现场就没了
    const live = toolboxLiveRange();
    if (toolboxEditorEmpty()) {
        // ★ 清空（而不是塞一个 <p><br></p> 占位）：否则导出的正文开头会多一个空段落
        toolboxTpl.editor.innerHTML = '';
        toolboxRange = null;
    }
    toolboxSnapClear();                  // 粘贴用"现场"位置，不用工具栏那份快照
    toolboxDeleteSelection(live || toolboxLiveRange());
    // 只有 HTML（比如从网页复制带样式的一段）：把标签剥掉，文字照样一个字不丢
    const src = text || String(html).replace(/<[^>]*>/g, ' ');
    const plain = toolboxPlainTextHtml(src);
    if (plain) toolboxInsertHtml(plain, live || toolboxLiveRange());
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

// 下载文件名：由左上角那个输入框决定（默认 Untitled.html）。
//   · 去掉 Windows 非法字符 / \ : * ? " < > | ，去掉首尾空白；
//   · **用户写了扩展名就原样用**（.html / .htm / .txt 都不改写）；
//     没写扩展名才补 .html（abc → abc.html）；
//   · 空的、清洗完没剩下东西的，一律回落到 Untitled.html。
// ★ 输入框里**不预填**这个值（用 placeholder 显示），所以"留空 = Untitled.html"是常态。
const TOOLBOX_DEFAULT_NAME = 'Untitled.html';
function toolboxCleanFileName(raw) {
    let s = String(raw == null ? '' : raw).replace(/[\\/:*?"<>|]+/g, '').replace(/[\r\n\t]+/g, ' ').trim();
    s = s.replace(/\s+/g, ' ').replace(/^\.+/, '').trim();   // 空白合并；开头的点去掉（只输了个 ".html" 这种情况）
    if (!s) return TOOLBOX_DEFAULT_NAME;
    if (!/\.[A-Za-z0-9]{1,8}$/.test(s)) s += '.html';       // 有扩展名就一点不动
    if (s.length > 120) s = s.slice(0, 120);
    return s;
}
function toolboxFileName() {
    const el = toolboxTpl && toolboxTpl.fileName;
    return toolboxCleanFileName(el ? el.value : '');
}

// ========== 草稿：自动保存 / 恢复 / 丢弃 ==========
// 用户要求：弹窗被误关（Esc、点到遮罩、手滑刷新）之后内容还能找回来。
// 三条约定：
//   ① 改内容后防抖 ~500ms 存一次 localStorage（不每次按键都写，写入本身是同步 IO）；
//   ② 打开时**不弹 confirm 打断**，只在弹窗里显示一条不显眼的提示条，
//      用户点「恢复」才覆盖当前内容，点「丢弃」才清掉；
//   ③ 复制/下载之后**不自动删**草稿 —— 用户多半还要接着改（这是明确要求）。
// ★ localStorage 一律包 try/catch：file:// 与隐私模式下读写都会抛。
const TOOLBOX_DRAFT_KEY = 'collection.toolbox.draft';
let toolboxDraftTimer = 0;
let toolboxDraftError = false;      // localStorage 不可用时就别反复重试
let toolboxClearArmed = false;      // 「清空」的二次确认状态
let toolboxClearTimer = 0;

function toolboxDraftRead() {
    if (toolboxDraftError) return '';
    try { return localStorage.getItem(TOOLBOX_DRAFT_KEY) || ''; } catch (e) { toolboxDraftError = true; return ''; }
}

function toolboxDraftWrite(html) {
    if (toolboxDraftError) return false;
    try { localStorage.setItem(TOOLBOX_DRAFT_KEY, html || ''); return true; }
    catch (e) {
        // 配额满 / 隐私模式：标记一下，别再每次按键都白试一遍
        toolboxDraftError = true;
        if (window.console && console.warn) console.warn('[toolbox] 草稿保存失败（localStorage 不可用）：', e && e.message);
        return false;
    }
}

function toolboxDraftClear() {
    toolboxDraftError = false;      // 用户主动清空时再试一次（可能刚才只是瞬时配额满）
    try { localStorage.removeItem(TOOLBOX_DRAFT_KEY); } catch (e) {}
    toolboxHideDraftBar();
}

// 防抖保存。空编辑区不存草稿（否则"打开→关掉"也会留下一条空草稿）。
function toolboxScheduleDraftSave() {
    if (toolboxDraftTimer) clearTimeout(toolboxDraftTimer);
    toolboxDraftTimer = setTimeout(function () {
        toolboxDraftTimer = 0;
        if (!toolboxTpl || !toolboxTpl.editor) return;
        if (toolboxEditorEmpty()) { toolboxDraftClear(); return; }
        toolboxDraftWrite(toolboxCleanHtml());
    }, 500);
}

// 打开弹窗时：有非空草稿就把提示条露出来（不自动覆盖当前内容）
function toolboxDraftOffer() {
    const draft = toolboxDraftRead();
    if (!draft || !String(draft).replace(/<[^>]*>/g, '').replace(/[\s\u00a0]+/g, '')) {
        toolboxHideDraftBar();
        return;
    }
    if (toolboxTpl && toolboxTpl.draftBar) toolboxTpl.draftBar.hidden = false;
}

function toolboxHideDraftBar() {
    if (toolboxTpl && toolboxTpl.draftBar) toolboxTpl.draftBar.hidden = true;
}

function toolboxRestoreDraft() {
    const draft = toolboxDraftRead();
    toolboxHideDraftBar();
    if (!draft || !toolboxTpl || !toolboxTpl.editor) return false;
    toolboxTpl.editor.innerHTML = draft;
    toolboxRange = null;
    toolboxFocusEditor();
    toolboxRestoreRange();
    toolboxScheduleRefresh(true);
    toolboxUndoPush(false);          // 恢复草稿也算一次编辑：按撤回能回到"空"的那一步
    toolboxToast('已恢复草稿');
    return true;
}

function toolboxDiscardDraft() {
    toolboxDraftClear();
    toolboxToast('草稿已删除');
}

// 「清空」：按钮文案只用一个词，但它会真删草稿，所以要点两次才生效（防误触）
function toolboxClearAll() {
    const label = toolboxTpl && toolboxTpl.clearBtn;
    if (!toolboxClearArmed) {
        toolboxClearArmed = true;
        if (label) label.textContent = '再点一次清空';
        toolboxToast('再点一次：清空并删草稿');
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
    toolboxSyncBusy = false;
    if (label) label.textContent = '清空';
    if (toolboxTpl && toolboxTpl.editor) toolboxTpl.editor.innerHTML = '<p><br></p>';
    toolboxRange = null;
    toolboxDraftClear();
    toolboxScheduleRefresh(true);
    toolboxUndoPush(false);          // 清空也是一次"用户编辑"，留一步可撤回
    toolboxFocusEditor();
    toolboxRestoreRange();
    toolboxToast('已清空，草稿也删掉了');
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
const TOOLBOX_DIALOGS = {
    table: {
        title: '插入表格',
        fields: [
            { key: 'rows', label: '行数（含表头）', type: 'number', placeholder: '3', min: 1, max: 60 },
            { key: 'cols', label: '列数', type: 'number', placeholder: '2', min: 1, max: 20 },
            { key: 'header', label: '第一行是表头', type: 'checkbox', checked: true }
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
            { key: 'src', label: '图片地址', type: 'text', placeholder: 'readmes/image/…', wide: true,
              hint: '相对路径，例如 readmes/image/comm/amsx_2012_01.jpg' },
            { key: 'width', label: '宽度', type: 'text', placeholder: TOOLBOX_IMG_WIDTH,
              hint: '留空就是 ' + TOOLBOX_IMG_WIDTH + '（语料里 160 张图片全用这个值）' },
            { key: 'caption', label: '图注（可空）', type: 'text', placeholder: '留空则用选中的文字',
              hint: '留空 = 不写图注；如果正文里选中了文字，就用选中的那段' }
        ],
        build: function (v) {
            const src = String(v.src || '').trim();
            if (!src) { toolboxToast('请填写图片地址'); return null; }
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
            { key: 'count', label: '图片张数', type: 'number', placeholder: '2', min: 2, max: TOOLBOX_MAX_STACK },
            { key: 'mode', label: '尺寸模式', type: 'text', placeholder: 'height',
              hint: 'height = 同高度（每张按同一高度缩放，宽度自适应）；width = 同宽度（等分整行）' },
            { key: 'size', label: '高度或宽度值', type: 'text',
              placeholder: TOOLBOX_STACK_HEIGHT + 'px',
              hint: '同高度模式填高度（留空 = ' + TOOLBOX_STACK_HEIGHT + 'px）；同宽度模式填宽度（留空即等分整行）' },
            { key: 'sharedCap', label: '图注（整行共用）', type: 'text', placeholder: '留空则用选中的文字', wide: true,
              hint: '填在这里 = 整行下面一条居中图注（默认这样做）；要每张图各写一条，就填下面的"每张图图注"' },
            { key: 'src1', label: '第 1 张地址', type: 'text', placeholder: 'readmes/image/…', wide: true },
            { key: 'cap1', label: '第 1 张图注（可空）', type: 'text', wide: true },
            { key: 'src2', label: '第 2 张地址', type: 'text', placeholder: 'readmes/image/…', wide: true },
            { key: 'cap2', label: '第 2 张图注（可空）', type: 'text', wide: true },
            { key: 'src3', label: '第 3 张地址（张数 ≥ 3 时用）', type: 'text', placeholder: 'readmes/image/…', wide: true },
            { key: 'cap3', label: '第 3 张图注（可空）', type: 'text', wide: true },
            { key: 'src4', label: '第 4 张地址（张数 = 4 时用）', type: 'text', placeholder: 'readmes/image/…', wide: true },
            { key: 'cap4', label: '第 4 张图注（可空）', type: 'text', wide: true }
        ],
        build: function (v) {
            const n = Math.max(2, Math.min(TOOLBOX_MAX_STACK, parseInt(v.count, 10) || 2));
            const imgs = [];
            for (let i = 1; i <= n; i++) {
                const src = String(v['src' + i] || '').trim();
                if (!src) { toolboxToast('第 ' + i + ' 张的图片地址还没填'); return null; }
                imgs.push({ src: src, caption: String(v['cap' + i] || '').trim() });
            }
            const mode = (String(v.mode || '').trim().toLowerCase() === 'width') ? 'width' : 'height';
            let size = String(v.size || '').trim();
            if (mode === 'height') size = size || (TOOLBOX_STACK_HEIGHT + 'px');
            else size = (!size || size === (TOOLBOX_STACK_HEIGHT + 'px')) ? 'calc' : size;
            // 整行共用的图注：留空 → 用按下按钮时选中的文字（不预填，行为保留）
            const shared = String(v.sharedCap || '').trim() || toolboxSnapText;
            return toolboxStackRowHtml(imgs, mode, size, shared);
        }
    },
    link: {
        title: '插入超链接',
        fields: [
            { key: 'url', label: '链接地址', type: 'text', placeholder: 'https://…', wide: true },
            { key: 'text', label: '链接文字（留空则用选中的文字）', type: 'text',
              placeholder: '留空则用选中的文字', wide: true },
            { key: 'blank', label: '新标签页打开（target="_blank"）', type: 'checkbox', checked: true }
        ],
        build: function (v) {
            const url = String(v.url || '').trim();
            if (!/^https?:\/\//i.test(url) && !/^(mailto:|tel:)/i.test(url)) {
                toolboxToast('地址要以 https:// 开头');
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
            { key: 'src', label: '图片地址', type: 'text', wide: true,
              hint: '相对路径，例如 readmes/image/comm/amsx_2012_01.jpg' },
            { key: 'width', label: '宽度', type: 'text',
              hint: '与语料一致写成属性值，例如 80% / 60% / 600px' },
            { key: 'alt', label: '说明（alt，正文占位框显示的就是它）', type: 'text', wide: true,
              hint: '留空 = 自动用地址里的文件名' }
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
            if (!img || !img.parentNode) { toolboxToast('这张图片已经不在了'); return null; }
            const src = String(v.src || '').trim();
            if (!src) { toolboxToast('请填写图片地址'); return null; }
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
            { key: 'text', label: '图注文字', type: 'text', wide: true,
              hint: '留空 = 删除这条图注；没有图注时填了就新增一条居中小字' }
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
    for (let i = 0; i < spec.fields.length; i++) {
        const f = spec.fields[i];
        html += '<div class="tb-field' + (f.wide ? ' tb-wide' : '') + '">';
        if (f.type === 'checkbox') {
            html += '<label class="tb-check"><input type="checkbox" id="tbF_' + f.key + '"'
                + (f.checked ? ' checked' : '') + '><span>' + toolboxEsc(f.label) + '</span></label>';
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
    toolboxTpl.dialog.style.display = 'flex';
    const first = toolboxTpl.dialogBody.querySelector('input');
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
        v[f.key] = (f.type === 'checkbox') ? !!el.checked : el.value;
    }
    // 编辑类对话框（修改图片/编辑图注）：apply 直接改已有节点，不插入新内容
    if (spec.apply) {
        const r = spec.apply(v);
        if (r == null) return false;             // 校验没过：对话框留着让用户改
        toolboxCloseDialog();
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

function toolboxCodeText() {
    return (toolboxTpl && toolboxTpl.code) ? String(toolboxTpl.code.value || '') : '';
}

// 编辑区 → 代码区。这是"导出"的那份文本（净化 + 缩进美化）。
// ★ 同步期间（toolboxSyncBusy）不写代码区：否则代码区 → 编辑区之后，
//   编辑区的 mutation 会立刻触发这里，把用户写的原文改成美化版。
function toolboxRefresh() {
    if (!toolboxTpl || !toolboxTpl.editor) return;
    toolboxCodeDirty = false;
    // 图片占位框（纯显示层）：先按当前加载状态对齐，再导出 —— 导出会跳过显示层
    toolboxImgDisplaySync();
    const clean = toolboxCleanHtml();
    // ★ 正文空着的时候代码区也留空：不然打开就显示一行 <p><br></p>，
    //   看起来像"预置了示例"。空就是空。
    if (toolboxTpl.code && !toolboxSyncBusy) {
        toolboxTpl.code.value = toolboxEditorEmpty() ? '' : toolboxFormatHtml(toolboxParseBox(clean));
        toolboxCodeHlSync();                 // 代码镜像层跟着更新（选区互高亮用）
    }
    const n = toolboxCountChars(toolboxTpl.editor);
    if (toolboxTpl.count) toolboxTpl.count.textContent = String(n);
    toolboxValidate();
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
    if (words.length) return prop + ' 的颜色值看不懂：' + words[0];
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
    // ③ <img src> 的写法
    const imgs = box.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
        const src = String(imgs[i].getAttribute('src') || '');
        if (!/^readmes\/image\//.test(src) && !/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) {
            warnings.push({ msg: '<img src> 不是 readmes/image/… 或 http(s)://：' + src.slice(0, 40) });
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
            warnings.push({ msg: '外链缺 target="_blank"：' + snippet(as[i]) });
        }    }
    return warnings;
}

function toolboxLint(text) {
    const st = toolboxLintStructure(text);
    const warn = st.fatal ? [] : toolboxLintDom(text);   // 结构都坏了，DOM 警告没意义
    return { errors: st.errors, warnings: warn, fatal: st.fatal };
}

// 把校验结果画到代码区下面那块。
// 计数同时写在 data-* 上：用例直接读属性断言，不用去解析文案。
function toolboxValidate() {
    const box = toolboxTpl && toolboxTpl.validate;
    const code = toolboxCodeText();
    if (!box) return;
    const res = toolboxLint(code);
    box.setAttribute('data-errors', String(res.errors.length));
    box.setAttribute('data-warnings', String(res.warnings.length));
    box.setAttribute('data-fatal', res.fatal ? '1' : '0');
    if (!code.trim()) {
        box.innerHTML = '<div class="tb-lint-ok">检查</div>';
        return;
    }
    if (!res.errors.length && !res.warnings.length) {
        box.innerHTML = '<div class="tb-lint-ok">检查 · 无问题</div>';
        return;
    }
    // 文案尽量短：有问题就把条数放出来（标题用"检查"），每条尽量一行内说清。
    let html = '<div class="tb-lint-head">检查 · ';
    if (res.errors.length) html += '<b class="tb-lint-bad">错误 ' + res.errors.length + '</b>';
    if (res.errors.length && res.warnings.length) html += ' ';
    if (res.warnings.length) html += '<b class="tb-lint-warn">警告 ' + res.warnings.length + '</b>';
    html += '</div><ul class="tb-lint-list">';
    const line = function (kind, it) {
        return '<li class="tb-lint-' + kind + '">' + (it.line ? '第 ' + it.line + ' 行：' : '') + toolboxEsc(it.msg) + '</li>';
    };
    for (let i = 0; i < res.errors.length && i < 20; i++) html += line('bad', res.errors[i]);
    for (let i = 0; i < res.warnings.length && i < 20; i++) html += line('warn', res.warnings[i]);
    html += '</ul>';
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
    return true;
}

function toolboxCodeToEditor() {
    toolboxCodeApplyTimer = 0;
    if (!toolboxTpl || !toolboxTpl.editor) return;
    const text = toolboxCodeText();
    const ok = toolboxApplyCodeToEditor(text, false);
    if (!ok) { toolboxValidate(); return; }                   // 结构没配平：编辑区保持原样
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
        return { a: a, ao: r.startOffset, b: b, bo: r.endOffset };
    } catch (e) { return null; }
}
function toolboxRestoreSnapshotSel(snap) {
    const ed = toolboxTpl && toolboxTpl.editor;
    if (!ed || !snap) return;
    try {
        const a = toolboxNodeAtPath(ed, snap.a), b = toolboxNodeAtPath(ed, snap.b);
        const sel = window.getSelection && window.getSelection();
        if (!a || !b || !sel) { toolboxCaretAtEnd(); return; }
        const r = document.createRange();
        r.setStart(a, Math.min(snap.ao, a.nodeType === 3 ? a.nodeValue.length : a.childNodes.length));
        r.setEnd(b, Math.min(snap.bo, b.nodeType === 3 ? b.nodeValue.length : b.childNodes.length));
        sel.removeAllRanges();
        sel.addRange(r);
        toolboxRange = r.cloneRange();
    } catch (e) { toolboxCaretAtEnd(); }
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
    const base = ed ? toolboxFormatHtml(toolboxParseBox(toolboxCleanHtml())) : toolboxCodeText();
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
    const next = toolboxUndo.index + dir;
    if (next < 0 || next >= toolboxUndo.stack.length) return false;
    toolboxUndo.index = next;
    const snap = toolboxUndo.stack[next];
    toolboxUndo.busy = true;                                   // ★ 这次改动不是"用户编辑"，不入栈
    try {
        if (toolboxTpl.code) toolboxTpl.code.value = snap.code;
        toolboxApplyCodeToEditor(snap.code, true);
        const n = toolboxCountChars(toolboxTpl.editor);
        if (toolboxTpl.count) toolboxTpl.count.textContent = String(n);
        toolboxRestoreSnapshotSel(snap.sel);
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
    const btn = toolboxTpl.fullBtn;
    if (btn) {
        // 文案用短词（用户要求"文案要短"）：全屏 ⇄ 还原，别用图标字符
        btn.textContent = toolboxWin.full ? '还原' : '全屏';
        btn.title = toolboxWin.full ? '还原' : '全屏';
    }
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
    if (btn) { btn.textContent = '⛶'; btn.title = '全屏'; }
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
    { act: 'cell-add',  label: '插入单元格', title: '在光标所在单元格的右侧插入一个空单元格' },
    { act: 'cell-del',  label: '删除单元格' },
    { sep: 1 },
    { act: 'merge',     label: '合并单元格', title: '先在表格里选中横跨多格的文字，再点这里' },
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
    if (!cell) { toolboxToast('先把光标放到表格里'); return false; }
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
    if (!cell) { toolboxToast('先把光标放到表格里'); return false; }
    const row = cell.parentNode, table = toolboxTableOf(cell);
    if (!row || !table) return false;
    // 一行都没有了就没有表格了：直接拒绝（别删成 <table></table>）
    if (toolboxTableRowCount(table) <= 1) { toolboxToast('只剩一行了，删掉就没有表格了'); return false; }
    // ★ 行里有跨行合并单元格时拒绝：删掉它会让下面几行的列位整体错位（会变成破表）。
    //   先「拆分单元格」再删行 —— 宁可不做，也不静默留一张坏表。
    const cells = Array.prototype.filter.call(row.children, function (x) {
        const t = String(x.tagName || '').toUpperCase();
        return t === 'TD' || t === 'TH';
    });
    for (let i = 0; i < cells.length; i++) {
        if (toolboxSpanOf(cells[i], 'rowspan') > 1) {
            toolboxToast('这一行里有跨行合并的单元格，先拆分再删行');
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
    if (!cell) { toolboxToast('先把光标放到表格里'); return false; }
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
    if (!cell) { toolboxToast('先把光标放到表格里'); return false; }
    const table = toolboxTableOf(cell);
    const grid = toolboxTableGrid(table);
    const pos = toolboxGridPosOf(grid, cell);
    if (!pos) return false;
    if (toolboxTableCols2(table) <= 1) { toolboxToast('只剩一列了，删掉就没有表格了'); return false; }
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
    if (!cell) { toolboxToast('先把光标放到表格里'); return false; }
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
    if (!cell) { toolboxToast('先把光标放到表格里'); return false; }
    const row = cell.parentNode, table = toolboxTableOf(cell);
    if (!row || !table) return false;
    const cells = Array.prototype.filter.call(row.children, function (x) {
        const t = String(x.tagName || '').toUpperCase();
        return t === 'TD' || t === 'TH';
    });
    // 只剩一格时删掉就是"空行"：直接拒绝（比"顺手删整行"更不容易误伤数据）
    if (cells.length <= 1) { toolboxToast('这一行只剩一个单元格了，删掉会变成空行'); return false; }
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
        toolboxToast('先在表格里选中横跨两个以上单元格的文字');
        return false;
    }
    if (picked.cells.length < 2) { toolboxToast('选中的已经是一个单元格了'); return false; }
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
    if (!cell) { toolboxToast('先把光标放到表格里'); return false; }
    const cs = toolboxSpanOf(cell, 'colspan'), rs = toolboxSpanOf(cell, 'rowspan');
    if (cs === 1 && rs === 1) { toolboxToast('这个单元格没有合并，不用拆'); return false; }
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
    { act: 'img-edit', label: '修改图片…', title: '改地址、宽度、说明' },
    { sep: 1 },
    { act: 'img-w80',  label: '宽度 80%' },
    { act: 'img-w60',  label: '宽度 60%' },
    { act: 'img-w100', label: '宽度 100%' },
    { sep: 1 },
    { act: 'img-c',    label: '居中' },
    { act: 'img-l',    label: '左对齐' },
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
            // 占位框里的"文件名"也是这张图的一部分：点它等于点这张图
            if (n.getAttribute && n.getAttribute('data-tb-display') === 'name') {
                const wrap = n.parentNode;
                const img = wrap && wrap.querySelector ? wrap.querySelector('img') : null;
                if (img) return img;
            }
        }
        n = n.parentNode;
    }
    return null;
}
// 图片所在的"块"：套在它外面的 center/p/div（占位包裹层要跳过）
function toolboxImgBlockOf(img, ed) {
    let n = img;
    while (n && n.parentNode && n.parentNode !== ed) {
        const p = n.parentNode;
        if (p.getAttribute && p.getAttribute('data-tb-display')) { n = p; continue; }   // 跳过占位包裹
        if (toolboxIsBlockTag(p)) return p;
        n = p;
    }
    return null;
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
    let block = toolboxImgBlockOf(img, ed);
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
    const block = toolboxImgBlockOf(img, ed);
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
    if (!cap || !cap.parentNode) { toolboxToast('这张图后面没有图注'); return false; }
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
}
// 「修改图片…」对话框：改地址 / 宽度 / 说明（alt）。用 prompt 三个值太笨，
// 走工具箱自己的字段对话框（tb-field），确认后才动 DOM。
function toolboxImgEditDialog() {
    const img = toolboxImgMenuTarget;
    if (!img) return false;
    toolboxOpenDialog('imgEdit');
    return true;
}

// ========== 开关弹窗 ==========
function toolboxOpen() {
    if (!toolboxTpl || !toolboxTpl.modal) return;
    const modal = toolboxTpl.modal;
    if (modal.style.display === 'flex') { toolboxFocusEditor(); return; }
    toolboxCloseDialog();
    modal.style.display = 'flex';
    modal.classList.add('tb-open');
    // 锁背景滚动。独立类名，不动 body.modal-open（那是大图灯箱的，两边同时开会打架）
    document.body.classList.add('tb-modal-open');
    // ★ 内容保留规则（按会话区分，见 toolboxSession 的说明）：
    //   · 同一次会话里关掉再打开 —— **内容原样保留**（编辑区、代码区、窗口尺寸位置都不动），
    //     也不提示草稿：内容根本没丢，提示条只会多余。
    //   · 页面刷新后第一次打开 —— 编辑区/代码区从空白开始（不预置示例文章），
    //     窗口回默认尺寸，这时才提示 localStorage 里的草稿让用户决定恢复还是丢弃。
    const firstOpen = !toolboxSession;
    toolboxSession = true;
    if (firstOpen) {
        if (toolboxTpl.editor) toolboxTpl.editor.innerHTML = '<p><br></p>';
        if (toolboxTpl.code) toolboxTpl.code.value = '';      // 代码区同样留空
        toolboxRange = null;
        toolboxSnapClear();
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
    toolboxRefresh();
    // 撤回栈的起点 = 本次打开时的状态（这一步必须在 refresh 之后，存下来的代码文本才是当前值）
    toolboxUndoReset();
    if (firstOpen) toolboxDraftOffer();      // 同会话内不提示草稿
    else toolboxHideDraftBar();
    // 等打开动画那一帧过去再聚焦：否则焦点会把页面顶到编辑区，动画看着像跳了一下
    requestAnimationFrame(function () { toolboxFocusEditor(); toolboxRestoreRange(); });
}

function toolboxClose() {
    if (!toolboxTpl || !toolboxTpl.modal) return;
    toolboxCloseDialog();
    toolboxTableMenuClose();                 // 表格右键菜单是浮层：关窗时一起收，别留在屏幕上
    toolboxTpl.modal.classList.remove('tb-open');
    toolboxTpl.modal.style.display = 'none';
    document.body.classList.remove('tb-modal-open');
    // ★ 关闭时把状态清干净：Range 指向的节点可能已经被回收（"存档失效"就是这么来的），
    //   定时器/动画帧也要一起收，不给下次打开留残留。
    //   注意**不动草稿**：关掉弹窗不等于放弃内容（误关也要能找回），只有用户点
    //   「丢弃」或「清空」才真的删。
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
    }
}

// ========== 工具栏动作表 ==========
// 用一张表而不是一堆 if：加按钮不用改事件绑定。
function toolboxToolbarAction(act, btn) {
    switch (act) {
        // —— 行内格式 ——
        case 'bold': toolboxExec('bold'); break;
        case 'italic': toolboxExec('italic'); break;
        case 'underline': toolboxExec('underline'); break;
        case 'strike': toolboxExec('strikeThrough'); break;
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
}

// 字号：工具栏的 rem 值 → execCommand 档位（映射表见 TOOLBOX_SIZE_TO_FONT）
function toolboxSize(size) {
    toolboxApplyFontSize(TOOLBOX_SIZE_TO_FONT[String(size)] || '3');
}

// 颜色 / 高亮：由 <input type="color"> 的 change 事件驱动（见 initToolboxDOM）
function toolboxColor(el) {
    if (!el || !el.value) return;
    toolboxExec('foreColor', el.value);
}
function toolboxHighlight(el) {
    if (!el || !el.value) return;
    toolboxExec('hiliteColor', el.value);
}

// 让"当前颜色"的色块跟着选择器走。高亮那个色块底下有棋盘格，所以用背景色**叠加**的方式：
// 直接改 backgroundColor 会把棋盘格盖掉，看不出"当前是高亮色"。
function toolboxBindSwatch(input, swatch) {
    if (!input || !swatch) return;
    const paint = function () {
        try {
            swatch.style.backgroundImage = 'linear-gradient(' + input.value + ',' + input.value + ')';
            swatch.style.backgroundColor = 'transparent';
        } catch (e) { /* 颜色值非法就算了，色块保持原样 */ }
    };
    input.addEventListener('input', paint);
    input.addEventListener('change', paint);
    paint();
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
        draftBar: modal.querySelector('#tbDraftBar'),
        validate: modal.querySelector('#tbValidate'),
        clearBtn: modal.querySelector('[data-tb="cleardraft"]')
    };
    if (!toolboxTpl.editor || !toolboxTpl.code) return;   // 结构不对：别把整个页面拖崩

    toolboxBindWindow();      // 顶栏拖动 + 八个缩放手柄（监听只在初始化时挂一次）

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
    toolboxTpl.editor.addEventListener('keydown', toolboxDropRange);
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
    toolboxTpl.editor.addEventListener('input', function () {
        if (toolboxSyncBusy) return;                 // ★ 抑制位：这是"代码区 → 编辑区"写进来的
        toolboxScheduleRefresh(false);
        toolboxScheduleDraftSave();
        toolboxUndoSoon();
    });
    toolboxTpl.editor.addEventListener('keyup', function () {
        if (toolboxSyncBusy) return;
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

    // ① 工具栏按钮：按下的一瞬间先**冻结选区**（Range + 选中的纯文本），再阻止默认。
    //    ★ 顺序不能反：冻结必须发生在焦点被按钮/输入框抢走**之前**，
    //      否则现场只剩一个空选区，插入就退化成"默认文字"，用户选的内容被吃掉。
    //    （编辑区自己的 mousedown 不能拦 —— 拦了就没法放光标、没法拖选。）
    modal.addEventListener('mousedown', function (e) {
        const t = e.target;
        if (!t || !t.closest) return;
        const btn = t.closest('button, .tb-color-label');
        if (!btn) return;
        if (toolboxTpl.editor && toolboxTpl.editor.contains(btn)) return;
        toolboxFreezeSelection();
        e.preventDefault();
    });
    // 触摸/手写笔：mousedown 之前还有一次 pointerdown，冻结放这里更早一点（同样只冻结、不拦）
    modal.addEventListener('pointerdown', function (e) {
        const t = e.target;
        if (!t || !t.closest) return;
        const btn = t.closest('button, .tb-color-label');
        if (!btn) return;
        if (toolboxTpl.editor && toolboxTpl.editor.contains(btn)) return;
        toolboxFreezeSelection();
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
    modal.addEventListener('click', function (e) {
        if (e.target === modal) { toolboxClose(); return; }
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

    // 草稿提示条上的两个按钮（写在 index.html 里，这里按 id 取）
    const restoreBtn = modal.querySelector('#tbDraftRestore');
    const discardBtn = modal.querySelector('#tbDraftDiscard');
    if (restoreBtn) restoreBtn.addEventListener('click', function () { toolboxRestoreDraft(); });
    if (discardBtn) discardBtn.addEventListener('click', function () { toolboxDiscardDraft(); });

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

    // 颜色 / 高亮：用 change 而不是 input —— 拖色盘时 input 会连发，一次操作执行几十遍命令
    const fore = modal.querySelector('#tbForeColor');
    const back = modal.querySelector('#tbBackColor');
    if (fore) fore.addEventListener('change', function () { toolboxColor(this); });
    if (back) back.addEventListener('change', function () { toolboxHighlight(this); });
    // 两个色块跟着选中的颜色走（否则用户看不出当前用的是哪个颜色）
    toolboxBindSwatch(fore, modal.querySelector('#tbForeSwatch'));
    toolboxBindSwatch(back, modal.querySelector('#tbBackSwatch'));

    toolboxLoaded = true;
    toolboxRefresh();
}

// 兜底结构（index.html 里没写 #toolboxModal 时才会走到）。
// 正常路径下永远不会执行 —— 它只是"宁可降级，也别让入口点了没反应"。
function toolboxFallbackHtml() {
    return '<div class="tb-card">'
        + '<div class="tb-head" id="tbHead"><span class="tb-title">HTML 代码生成工具</span>'
        + '<button type="button" class="tb-btn tb-win" data-tb="fullscreen" id="tbFullBtn" title="全屏 / 还原">⛶</button>'
        + '<button type="button" class="tb-close" data-tb="close" title="关闭（Esc）">×</button></div>'
        + '<div class="tb-toolbar">'
        + '<button type="button" class="tb-btn tb-primary" data-tb="copy" title="复制 HTML 到剪贴板">复制</button>'
        + '<button type="button" class="tb-btn" data-tb="download" title="下载为 .html 文件">下载</button>'
        + '<button type="button" class="tb-btn tb-danger" data-tb="cleardraft" title="清空正文并删掉草稿（点两次确认）">清空</button></div>'
        + '<div class="tb-draftbar" id="tbDraftBar" hidden><span>发现草稿</span>'
        + '<button type="button" class="tb-btn" id="tbDraftRestore">恢复</button>'
        + '<button type="button" class="tb-btn" id="tbDraftDiscard">丢弃</button></div>'
        + '<div class="tb-body">'
        + '<div class="tb-pane tb-pane-edit"><div class="tb-pane-head">正文</div>'
        + '<div class="tb-editor" id="tbEditor" contenteditable="true" spellcheck="false" data-placeholder="在这里写正文"></div></div>'
        + '<div class="tb-pane tb-pane-code"><div class="tb-pane-head">HTML</div>'
        + '<textarea class="tb-code" id="tbCode" spellcheck="false" wrap="soft" placeholder="粘贴或直接编辑 HTML"></textarea>'
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
