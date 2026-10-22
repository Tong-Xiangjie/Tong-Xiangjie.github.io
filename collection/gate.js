/* ============================================================================
 * collection/gate.js —— collection 站的「链接令牌门禁」
 *
 * 目标**不是安全认证**，只是提高门槛：挡住不懂技术的游客误入、挡住链接被随手转发。
 * 明确接受的边界：会用开发者工具的人可以直接读源码 / 直接下载数据文件 —— 这里不防。
 * 未授权页上的口令输入框**不增加任何安全性**，它只是省掉"链接里的 #k= 被聊天软件
 * 吃掉"的麻烦；真正的门槛仍然只是"提高摩擦"。
 *
 * 它做什么：
 *   ① head 里的同步内联脚本（`<!-- gate:begin -->` 那一段，由
 *      `node collection/tools/gate.mjs apply` 注入）先跑：
 *      **本地开发与本地文件打开一律放行** —— file: 协议（双击打开本地 HTML）、
 *      localhost / 127.0.0.1 / ::1；localStorage 里的「标记」等于
 *      **当前令牌哈希的前 16 位**也直接放行 —— 这几条路都不发任何请求，用户零延迟。
 *      本地两条只加类，不写标记。
 *   ② 本文件（同步 <script>，同样在 <head>、紧随其后）只在①没放行时干活：
 *      取令牌（`#k=` 优先，兼容 `?k=`）→ 同步把 k 参数从地址栏抹掉
 *      （**只删 k，其余 hash 深链路由原样保留**）→ 异步 SHA-256 →
 *      与配置区里的哈希做**恒定时间比较** → 对就加 `gate-ok` 并写标记；
 *      不对就把提示盒（图标 + 「暂无访问权限」+ 口令输入框）写进文档。
 *
 * 为什么这样写：
 *   · 隐藏开关是 html 上的 `gate-ok` 类，兜底 CSS 写在 HTML 的 <head> 里，
 *     所以**关掉 JavaScript 也进不去**（而且还能看到那句提示，见 ::before 规则）。
 *   · 放行者不会被"先闪一下隐藏态"：内联脚本是同步的，在首次绘制前就把类加上了。
 *   · 令牌只以 SHA-256 十六进制形式存在仓库里，明文令牌永远不进仓库
 *     （`node collection/tools/gate.mjs check` 会扫描整个仓库确认这件事）。
 *   · 标记与当前哈希绑定 → `gate.mjs new` 换令牌后，所有老设备自动失效。
 *   · 被拒时**干净地同归于尽**：`document.open()` + `write(整份最小提示文档)` +
 *     `document.close()`。open() 会把插入点交给我们、close() 会**停掉解析器**，
 *     于是原页面后面那些还没执行的站点 <script> 一条都不跑 —— 浏览器控制台里
 *     不会出现任何"站点脚本查询 null"的未捕获异常（既难看，也是情报泄漏：
 *     报错栈会暴露站点结构）。这比 `body.innerHTML = …` 彻底：后者只清 DOM，
 *     页面后续的 <script> 照跑照报错。
 *   · 控制台**默认一声不响**：门禁自己的日志只有 URL 带 `gatedebug=1` 时才打。
 *   · 不做任何反调试（debugger 死循环 / 检测 devtools 就卡死之类）：那会把 46 个
 *     回归套件（无头 CDP）打挂、也会弄坏站点主自己按 F12 调试，而对手在 DevTools
 *     里关掉断点就绕过了 —— 收益为零、代价很大。
 *
 * 配置区（GATE_HASHES）由 `node collection/tools/gate.mjs new` 写入，别手改格式。
 * ==========================================================================*/
(function () {
    'use strict';

    // ── 配置区 ──────────────────────────────────────────────────────────────
    // 只放 SHA-256 的十六进制（64 位小写），永不放明文令牌。
    // 只支持**一个**生效令牌（换令牌 = 用 gate.mjs new 替换），
    // 因为 head 内联脚本里的标记字面量来自 GATE_HASHES[0]。
    var GATE_HASHES = [
        /* gate:hashes:begin */
        '63bccacf1f6ddf9a833652ea6f37f3c5c0cf8d33838e27fd5e84b917729945ff',
        /* gate:hashes:end */
    ];
    var STORAGE_KEY = 'collection-gate';   // 带命名空间，避开站点既有键
    var MARK_LEN = 16;                     // 标记 = 当前哈希的前 16 位十六进制
    var PARAM = 'k';                       // 令牌参数名：#k=<令牌> / ?k=<令牌>
    var DENIED_TEXT = '暂无访问权限';       // 未授权页上那句提示（逐字）
    var DENIED_TITLE = '无法访问';          // 未授权时的 document.title（逐字，故意不带句号）
    var ICON_SRC = '/collection/block.svg'; // 未授权页的图标（站点主人自己的画；加载失败就藏掉）
    // 输错口令时的提示走**原生 alert**，页面上**不放任何错误文本节点**：
    // 内联一行字会把 flex 居中的整块内容顶偏 —— 实测（改前）图标/文案/输入框/按钮
    // 整体位移 18.8px，用户明确要求"防止出现一排字导致图片整体移位"。
    // 文案逐字由 CDP 在对话框上核对（对话框文案不进 DOM、不占版面）。
    var WRONG_TEXT = '非法密钥！';          // 逐字，全角感叹号
    var SUBMIT_TEXT = '验证';
    // 占位提示（逐字，六个汉字）：只说"做什么"，不含长度/格式/示例 —— 不能透露口令的形态。
    var INPUT_PLACEHOLDER = '请输入通行密钥';
    // 解锁成功那一刻的反馈文案（只在"正临走"的这一页上短暂出现）。
    // 为什么必须有：用户实测「输入正确密钥按回车 / 点验证都没反应，其实已经开锁」
    // —— 根因是解锁后没能真的重新加载（见 enterAfterUnlock），屏幕上毫无变化，
    //   于是看起来像"没反应"。有这行字，至少能区分"在处理"和"没收到"。
    var UNLOCK_TEXT = '已解锁，正在进入…';
    var UNLOCK_SLOW_TEXT = '已解锁，但这一页没能自动跳转 ——';
    var ENTER_TEXT = '点这里进入';
    // ── 明暗：必须与**站点主题同一套语义** ─────────────────────────────────
    // ★ 下面这两个字面量必须与 collection/theme.js:58-59 的
    //   COLOR_SCHEME_KEY / COLOR_SCHEME_MODES **完全一致**
    //   （verify-gate.mjs 里有"漂移守门"断言：谁改了 theme.js 的键名或取值集合就会红）。
    //   为什么门禁要**自己再读一遍** localStorage：站点真正的判定在 theme.js 里，
    //   而 theme.js 是**被门禁挡在后面的站点脚本** —— 一旦拒绝，文档立刻被
    //   document.write 换掉，theme.js 根本没机会跑，也就不会留下
    //   html[data-color-scheme]。早先这里只读那个属性 ⇒ 属性通常不存在 ⇒
    //   被拒页只能退回 @media 跟随系统 ⇒ 用户在站内选过亮色、系统是暗色时，
    //   会看到"锁住的页是暗的、进去以后是亮的"（用户提的就是这个缺口）。
    var COLOR_SCHEME_KEY = 'collection-color-scheme';      // ★ 必须与 theme.js:58 一致
    var COLOR_SCHEME_MODES = ['system', 'light', 'dark'];  // ★ 必须与 theme.js:59 一致
    var DEBUG = /(?:^|[?&])gatedebug=1(?:&|$)/.test(location.search);  // 只有显式打开才打日志
    // ───────────────────────────────────────────────────────────────────────

    var html = document.documentElement;

    // 门禁自己的日志：默认**一声不响**（被拒时控制台里不该有我们主动打的东西）
    function log() {
        if (!DEBUG) return;
        try { console.log.apply(console, Array.prototype.slice.call(arguments)); } catch (e) { }
    }

    // ── 明暗语义：逐条照抄 theme.js:61-76，不另立一套 ───────────────────────
    //   存的是 'dark' ⇒ 暗色；'light' ⇒ 亮色；'system' / 其它值 / 没有 /
    //   读 localStorage 抛异常 ⇒ **跟随系统**（matchMedia）。
    function storedColorSchemeMode() {
        try {
            var m = localStorage.getItem(COLOR_SCHEME_KEY);
            return COLOR_SCHEME_MODES.indexOf(m) >= 0 ? m : 'system';
        } catch (e) {
            return 'system';
        }
    }
    function systemPrefersDark() {
        try {
            return typeof window.matchMedia === 'function'
                && window.matchMedia('(prefers-color-scheme: dark)').matches;
        } catch (e) { return false; }
    }
    function deniedIsDark() {
        var mode = storedColorSchemeMode();
        if (mode === 'dark') return true;    // ★ 用户存过的显式选择**优先**，不被系统偏好覆盖
        if (mode === 'light') return false;
        return systemPrefersDark();          // 只有 system（含非法值/读不到）才跟随系统
    }
    // 应用方式与 theme.js:82-83 保持一致：**根元素上同时**设
    //   data-color-scheme（让上面那两组 html[data-color-scheme] 变量块生效）
    //   与 style.colorScheme（让输入框、滚动条等原生控件也跟着变）。
    function applyDeniedScheme(scheme) {
        try {
            html.setAttribute('data-color-scheme', scheme);
            html.style.colorScheme = scheme;
        } catch (e) { }
    }
    // 系统偏好在页面打开期间变了 ⇒ **只在我们处于 system 模式时**跟着变（与 theme.js:138-146 一致）。
    // 用户显式选过 light/dark 就不跟 —— 否则"我明明选了亮色，系统一换它就变暗了"。
    function watchSystemColorScheme() {
        if (typeof window.matchMedia !== 'function') return;
        var mq;
        try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { return; }
        if (!mq) return;
        var onChange = function () {
            if (storedColorSchemeMode() !== 'system') return;
            applyDeniedScheme(systemPrefersDark() ? 'dark' : 'light');
        };
        try {
            if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
            else if (typeof mq.addListener === 'function') mq.addListener(onChange);
        } catch (e) { }
    }

    // ── 被拒页：整份最小文档 ────────────────────────────────────────────────
    // ★★ 主题来源只有一处：下面五组 --gate-* 变量块。背景与图标**由同一组选择器
    //    决定**（同一块里既有 --gate-bg 也有 --gate-icon），组件层只消费变量 ——
    //    这样"背景判成浅色、图标却带着暗色的 invert"这类**白底白画**在结构上
    //    不可能再发生（用户实测过这个 bug：背景写在两套来源里、图标只写一套）。
    //    注意：这份和 gate.mjs 注入到 <head> 的那份（GUARD_STYLE）必须口径一致。
    var DENIED_CSS = [
        ':root{--gate-bg:#f6f7f9;--gate-fg:#1f2328;--gate-icon:brightness(0);--gate-in-bg:#ffffff;--gate-in-fg:#1f2328;--gate-in-bd:#9aa3ad;--gate-btn-bg:#1f2328;--gate-btn-fg:#f6f7f9;}',
        '@media (prefers-color-scheme: light){:root{--gate-bg:#f6f7f9;--gate-fg:#1f2328;--gate-icon:brightness(0);--gate-in-bg:#ffffff;--gate-in-fg:#1f2328;--gate-in-bd:#9aa3ad;--gate-btn-bg:#1f2328;--gate-btn-fg:#f6f7f9;}}',
        '@media (prefers-color-scheme: dark){:root{--gate-bg:#14171c;--gate-fg:#e8eaed;--gate-icon:brightness(0) invert(1);--gate-in-bg:#1b1f26;--gate-in-fg:#e8eaed;--gate-in-bd:#5b6673;--gate-btn-bg:#e8eaed;--gate-btn-fg:#14171c;}}',
        'html[data-color-scheme="dark"]{--gate-bg:#14171c;--gate-fg:#e8eaed;--gate-icon:brightness(0) invert(1);--gate-in-bg:#1b1f26;--gate-in-fg:#e8eaed;--gate-in-bd:#5b6673;--gate-btn-bg:#e8eaed;--gate-btn-fg:#14171c;}',
        'html[data-color-scheme="light"]{--gate-bg:#f6f7f9;--gate-fg:#1f2328;--gate-icon:brightness(0);--gate-in-bg:#ffffff;--gate-in-fg:#1f2328;--gate-in-bd:#9aa3ad;--gate-btn-bg:#1f2328;--gate-btn-fg:#f6f7f9;}',
        'html,body{margin:0;padding:0;}',
        '.gate-denied-box{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5rem;text-align:center;',
        'visibility:visible !important;background:var(--gate-bg);color:var(--gate-fg);',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans CJK SC","Microsoft YaHei",sans-serif;',
        'font-size:16px;line-height:1.6;-webkit-user-select:text;user-select:text;}',
        '.gate-denied-box *{visibility:visible !important;}',
        // ⚠ 组件规则必须与 gate.mjs 注入到 <head> 的那份（GUARD_STYLE）**选择器写法完全一致**
        //   （都带 .gate-denied-box 前缀）。原因：_被拒文档自己那份样式**排在 head 那份后面**，
        //   只有两者**特异度相同**时才能由"后写的赢"来决定结果；早先这里写成
        //   .gate-denied-icon / .gate-denied-input（0,1,0），而 head 那份是
        //   .gate-denied-box .gate-denied-icon（0,2,0）—— 于是 head 那份永远赢，
        //   只改这份 CSS 在页面上**一点效果都没有**（实测：把 height 改成 44px，量出来还是 32px）。
        '.gate-denied-box .gate-denied-icon{display:block;width:160px;max-width:60vw;height:auto;margin:0 0 1.1rem;filter:var(--gate-icon);}',
        '.gate-denied-box .gate-denied-text{margin:0;max-width:100%;}',
        '.gate-denied-box .gate-denied-form{display:flex;gap:.5rem;width:100%;max-width:20rem;margin:1.25rem 0 0;}',
        // 输入框与按钮**等高**（都 2rem = 32px，box-sizing:border-box 让边框也算进去）、
        // **同圆角**、内边距收紧（左右 .55rem / .8rem、上下 0）——
        // 改前是 padding .5rem + font 1rem ⇒ 实测 43.59px 高，现在压到 32px。
        // ★ 用户要的"矮一点"指的是**高度**，不是字号。
        '.gate-denied-box .gate-denied-input,.gate-denied-box .gate-denied-submit{box-sizing:border-box;height:2rem;line-height:1;border-radius:.375rem;font-family:inherit;}',
        // ★ 输入框字号**必须 ≥16px**：iOS Safari 对 font-size < 16px 的输入框，
        //   聚焦时会**自动放大整页**（页面跳一下、还得手动缩回去）—— 所以固定 1rem。
        '.gate-denied-box .gate-denied-input{flex:1 1 auto;min-width:0;padding:0 .55rem;font-size:1rem;',
        'border:1px solid var(--gate-in-bd);background:var(--gate-in-bg);color:var(--gate-in-fg);}',
        // 按钮不可聚焦、不触发 iOS 自动放大，所以可以比输入框小一号（高度仍与输入框一致）
        '.gate-denied-box .gate-denied-submit{flex:0 0 auto;padding:0 .8rem;font-size:.875rem;',
        'border:1px solid var(--gate-btn-bg);background:var(--gate-btn-bg);color:var(--gate-btn-fg);cursor:pointer;}',
        // 注意：这里**没有** .gate-denied-error 之类的错误文本样式 —— 错误提示走 alert()。
        // [hidden] 只留给"拿不到 crypto.subtle 就把整个表单藏起来"那条路。
        '.gate-denied-box [hidden]{display:none !important;}',
        // ★ 解锁成功后的"正在进入…"与兜底入口（见 enterAfterUnlock）。
        //   只在这一页"临走前"出现 ⇒ 不属于"失败尝试零位移"那条约束
        //   （零位移只管**输错口令**那条路径：那里仍然一个文本节点都不加）。
        '.gate-denied-box .gate-denied-status{margin:.9rem 0 0;font-size:.9rem;opacity:.85;}',
        '.gate-denied-box .gate-denied-enter{display:inline-block;margin:.7rem 0 0;padding:.3rem .9rem;',
        'border-radius:.375rem;border:1px solid var(--gate-btn-bg);background:var(--gate-btn-bg);',
        'color:var(--gate-btn-fg);text-decoration:none;font-size:.9rem;}'
    ].join('');

    var DENIED_INNER = '<img class="gate-denied-icon" src="' + ICON_SRC + '" alt="" aria-hidden="true">'
        + '<p class="gate-denied-text">' + DENIED_TEXT + '</p>'
        // onsubmit="return false"：万一下面那段绑定没挂上（比如 document.open 被禁），
        // 按回车也**不会**把表单当 GET 提交走（否则地址栏会变成 ...index.html?，既难看又像"泄漏了参数"）
        + '<form class="gate-denied-form" autocomplete="off" onsubmit="return false">'
        + '<input class="gate-denied-input" type="text" placeholder="' + INPUT_PLACEHOLDER + '"'
        + ' autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="通行密钥">'
        + '<button class="gate-denied-submit" type="submit">' + SUBMIT_TEXT + '</button>'
        + '</form>';
    // ★ 提示盒里**没有**错误文本节点：输错口令走 wrAlert()（原生对话框）。
    //   这样一次失败尝试**零版面变化**（图片/文案/输入框/按钮的 rect 逐值不变）。

    // ★ 这里**不再**往被拒文档里内联一段提交脚本：写进去的文档里一个 <script> 都没有。
    //   为什么：那段脚本的源码文本会算进 document.body.textContent（"非法密钥！"这类
    //   字面量会被当成页面文本），而且等于把"哈希表 + 比较算法"又抄了第二份。
    //   现在提交行为由**本文件**的 bindForm() 在 document.close() 之后**同步**绑上：
    //     · 元素此时一定已经在了（同一段代码里紧接着就重新触发过图标的 src）；
    //     · 不用等 DOMContentLoaded（document.close() 之后那个事件不一定还会来，
    //       早先的版本就是因此没绑上、回车走了浏览器原生 GET 提交）；
    //     · 链接路径与输入框路径共用**同一份** verifyToken()/ctEqual()，不再有第二份实现。
    //   安全网：DENIED_INNER 的表单上留着 onsubmit="return false"。

    function deniedDoc(scheme) {
        // ★ 结构：<head> 只有 meta/title/style，<body> 只有提示盒 —— 零脚本。
        //   ⚠ 这里**不写 <html> 上的 class 由外层负责**：写出来的 <html> 起始标签会被
        //     解析器并到"当前那个 html 元素"上（属性合并），所以 class="gate-denied"
        //     与 data-color-scheme 都会落到同一个根元素上 —— 正是我们要的。
        return '<html lang="zh-CN" class="gate-denied"' + (scheme ? ' data-color-scheme="' + scheme + '"' : '') + '><head>'
            + '<meta charset="UTF-8">'
            + '<meta name="robots" content="noindex,nofollow">'
            + '<title>' + DENIED_TITLE + '</title>'
            + '<style>' + DENIED_CSS + '</style>'
            + '</head><body><div class="gate-denied-box" role="alert">' + DENIED_INNER + '</div></body></html>';
    }

    // ── 入口判定：**必须在所有定义之后调用** ────────────────────────────────
    // （早期版本把判定写在常量赋值之前，同步拒绝时 DENIED_INNER 还是 undefined，
    //   页面正文就成了字面量 "undefined" —— 所以这里放在文件最后统一启动。）
    function run() {
        // ① head 的同步内联脚本已经放行（本地开发 / 本地文件 / 已授权标记）→ 收工
        if (html.classList.contains('gate-ok')) return;

        // ①b 本地开发与"本地文件打开"一律放行，与 head 里那份判定完全一致：
        //     file: 协议的 location.hostname 是空串，既不在 localhost 白名单里、
        //     也不是安全上下文（crypto.subtle 不可用），不特判的话双击打开本地 HTML
        //     会直接看到「暂无访问权限」—— 站点主人就是这么用的，必须放行。
        //     这里只加类、**不写 localStorage 标记**（本地放行不污染线上判定）。
        if (location.protocol === 'file:') { html.classList.add('gate-ok'); return; }
        var hostName = location.hostname.replace(/^\[|\]$/g, '');
        if (hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '::1') {
            html.classList.add('gate-ok');
            return;
        }

        // ② 解析令牌：片段优先，查询串兜底（少数客户端会把 # 吃掉）
        var fromHash = stripParamFromHash(location.hash);
        var fromSearch = stripParamFromSearch(location.search);
        var token = fromHash.token || fromSearch.token;

        // ③ 只要出现了 k 参数就**同步**抹掉它。为什么必须同步、且必须在这里做：
        //    站内路由大量使用 location.hash（#coins/... 、#coins/...&k=xxx 这种形态），
        //    router.js 在 DOMContentLoaded 读 location.hash。若等异步摘要回来再清，
        //    路由可能已经读到带 k 的脏 hash。这里只摘掉 k 段，其余段**原样拼接**。
        if (fromHash.hit || fromSearch.hit) {
            var clean = location.pathname
                + (fromSearch.hit ? fromSearch.search : location.search)
                + (fromHash.hit ? fromHash.hash : location.hash);
            try {
                history.replaceState(history.state, '', clean);
            } catch (e) { /* replaceState 失败就留着，功能优先于整洁 */ }
        }

        // ④ 标记兜底：值必须等于某个授权哈希的前 MARK_LEN 位。
        //    换过令牌的旧标记（对不上当前哈希）直接清掉 —— 老设备从此失效。
        var stored = null;
        try {
            stored = localStorage.getItem(STORAGE_KEY);
            if (stored && !markMatches(stored)) {
                localStorage.removeItem(STORAGE_KEY);
                stored = null;
            }
        } catch (e) { /* 隐私模式下 localStorage 会抛，当成没有标记 */ }
        if (stored) { allow(stored); return; }

        // ⑤ 没有令牌 → 拒绝（把提示文档写进去）
        if (!token) { deny('no-token'); return; }

        // ⑥ 算令牌的 SHA-256 再比。crypto.subtle **只在安全上下文可用**：
        //    线上 https、本地 http://localhost / http://127.0.0.1 都是安全上下文，
        //    拿不到就别放行（宁可挡错，不可放过）。
        var subtle = (window.crypto && window.crypto.subtle) || null;
        if (!subtle || typeof subtle.digest !== 'function') { deny('no-subtle'); return; }

        verifyToken(token, subtle, function (mark) {
            if (mark) { allow(mark); return; }
            deny('bad-token');
        });
    }

    // ── 拒绝 ────────────────────────────────────────────────────────────────
    // ★ 顺序有讲究：**先 open/write/close，再 window.stop()**。
    //   先 stop() 的话文档会被冻在半路，open() 变成空操作、write() 也落不下去 ——
    //   实测结果是"没有提示、没有标题的一片白"，比不改还糟。
    //   document.open() 把插入点交给我们、document.close() 停掉解析器 ⇒ 原页面
    //   后面还没执行的站点 <script> 一条都不跑（控制台里因此没有任何未捕获异常）。
    function deny(reason) {
        log('[collection-gate] denied:', reason);
        // ★ 明暗：**用户在站内选过的选择优先**，没存过才跟随系统（语义照抄 theme.js）。
        //   必须在 document.write 之前算好并应用：写进去的 <html> 起始标签虽然也会
        //   带上 data-color-scheme，但先把根元素设好可以避免"写文档那一瞬间"闪一下。
        var scheme = deniedIsDark() ? 'dark' : 'light';
        // 兜底 CSS 里那条 ::before 提示（给"关 JS"用的）在这里要关掉：提示盒自己就是提示，
        // 不关的话两句话会叠在一起。
        try { html.classList.add('gate-denied'); } catch (e) { }
        applyDeniedScheme(scheme);
        // 注意：**不要**在这里 document.title = DENIED_TITLE —— 文档里还没有 <title>，
        // 这一句会凭空造一个，写进去的那句又造一个，结果页面里有两个 <title>。
        // 标题由写进去的 <title> 负责。
        try {
            document.open();
            document.write(deniedDoc(scheme));
            document.close();
            // 文档已经就位，这时候掐掉"原页面还在飞的资源"才是安全的（见上面那段注释）。
            // ⚠ document.close() 会顺带把**我们自己图标的请求**也停掉（实测 naturalWidth=0），
            //   所以停完要重新触发一次（重新赋值 src 即可）。
            try { window.stop(); } catch (e3) { }
            try {
                var iconEl = document.querySelector('.gate-denied-icon');
                if (iconEl) iconEl.src = iconEl.getAttribute('src');
            } catch (e4) { }
            // 写完再应用一次（幂等）：保证根元素上 data-color-scheme 与
            // style.colorScheme **两个都在**（原生控件颜色靠后者）。
            applyDeniedScheme(scheme);
            // 系统偏好变化时只在 system 模式跟随（见 watchSystemColorScheme）。
            watchSystemColorScheme();
            // 表单在这里**同步**绑上（写进去的文档里没有脚本，见 deniedDoc 上面那段注释）。
            // 元素此刻一定已经在了：上面刚查过图标元素就是因为这个。
            try { bindForm(document.querySelector('.gate-denied-box')); } catch (e5) { }
            return;
        } catch (e) { log('[collection-gate] document.write failed', e); }
        // 兜底（document.open/write 被环境禁掉时）：清空 DOM + 塞进同一份提示盒。
        // 这条路上站点脚本可能已经跑过，所以它只是"最后一道"，不是主路径。
        try {
            try { document.title = DENIED_TITLE; } catch (e5) { }
            var body = document.body || document.documentElement;
            while (body.firstChild) body.removeChild(body.firstChild);
            if (body !== document.body) {
                var b2 = document.createElement('body');
                document.documentElement.appendChild(b2);
                body = b2;
            }
            var box = document.createElement('div');
            box.className = 'gate-denied-box';
            box.setAttribute('role', 'alert');
            box.innerHTML = DENIED_INNER;
            body.appendChild(box);
            applyDeniedScheme(scheme);
            watchSystemColorScheme();
            bindForm(box);
        } catch (e2) { }
    }

    // ── 给提示盒里的表单绑提交行为（主路径与兜底路径共用这一个实现）──────────
    // ★ 失败提示走**原生 alert**，页面上不放错误文本 ⇒ 一次失败尝试**零版面变化**
    //   （用户实测过内联那行字会把整块内容顶偏 18.8px）。
    // ★ 校验走 verifyToken()：与链接令牌**同一条路径**（同一份 SHA-256 + 同一份
    //   恒定时间比较），不存在"输入框那条路更松"的可能。
    function bindForm(root) {
        if (!root) return;
        var img = root.querySelector('.gate-denied-icon');
        if (img) img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
        var f = root.querySelector('.gate-denied-form');
        var inp = root.querySelector('.gate-denied-input');
        if (!f || !inp) return;
        var subtle = (window.crypto && window.crypto.subtle) || null;
        // 拿不到 crypto.subtle（非安全上下文）就**不显示输入框**：没法校验，给了只会误导
        if (!subtle || typeof subtle.digest !== 'function' || typeof window.TextEncoder !== 'function') {
            f.hidden = true;
            return;
        }
        var busy = false;
        // ★ 看门狗：verifyToken 的 promise 正常必有回调，但"文档被换过 / 上下文被中断"
        //   这类场合可能既不 resolve 也不 reject ⇒ busy 会永久停在 true ⇒ 之后**每一次**
        //   提交都被上面的 `if (busy) return;` 静默吞掉（用户实测"按回车/点验证没反应"）。
        //   3 秒兜底释放，绝不长期闩死；正常路径上 release() 会立刻把它清掉。
        var busyTimer = 0;
        var release = function () {
            busy = false;
            if (busyTimer) { clearTimeout(busyTimer); busyTimer = 0; }
        };
        var submitOnce = function (ev) {
            if (ev) ev.preventDefault();
            if (busy) return;
            if (!inp.value) return;
            busy = true;
            busyTimer = setTimeout(release, 3000);
            var typed = inp.value;
            verifyToken(typed, subtle, function (mark) {
                release();
                if (!mark) {
                    inp.select();
                    try { wrAlert(); } catch (e) { }
                    return;
                }
                allow(mark);
                enterAfterUnlock(typed);
            });
        };
        f.addEventListener('submit', function (ev) { submitOnce(ev); });
        // ★ 再显式绑一次 Enter：表单的隐式提交在个别状态下不触发（焦点在按钮上、
        //   文档是 document.write 出来的、或浏览器把 Enter 交给了别的默认行为）。
        //   requestSubmit() 走的还是同一条 submit 事件路径 ⇒ 校验逻辑只有一份。
        inp.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Enter' || ev.isComposing) return;
            ev.preventDefault();
            if (typeof f.requestSubmit === 'function') f.requestSubmit();
            else submitOnce(null);
        });
    }

    // ── 解锁成功之后：**一定要真的离开这一页** ──────────────────────────────
    // ★★ 用户实测的症状：「输入正确密钥按回车（或点「验证」）没反应，但实际上已经开锁」。
    //    两者走的是同一个 submit 处理 ⇒ 卡的地方在这一步，不在输入/按钮。
    //    旧实现是 `location.replace(location.pathname + location.search + location.hash)`，
    //    也就是**重新打开当前这个完全相同的 URL**：
    //      · 标记此时已经写进 localStorage（所以"其实已经开锁"是对的）；
    //      · 但"同 URL 导航"在浏览器里可能被当成同文档导航、**根本不发生重新加载**
    //        ⇒ 屏幕上还是这份被拒文档 ⇒ 看上去就是"没反应"。
    //    现在按"一定会离开"的次序来，并且每一步都给可见反馈：
    //      ① location.reload()：任何浏览器都必然重新加载当前文档（标记已写好 ⇒ 放行）；
    //      ② 700ms 后还在这一页 ⇒ 用 `?k=<口令>` 那一次导航（查询变了就不可能是同文档
    //         导航）；这条路不依赖 localStorage，进站后由门禁自己把 k 参数抹掉；
    //      ③ 再 900ms 还在 ⇒ 摆出一个「点这里进入」的链接：用户**手动点击**发起导航，
    //         连"脚本发起的导航被拦"这种极端情况也兜住了。
    function enterAfterUnlock(token) {
        var box = document.querySelector('.gate-denied-box');
        var form = box && box.querySelector('.gate-denied-form');
        var status = null;
        try {
            if (form) form.hidden = true;          // 已经在走了，藏掉表单免得重复提交
            if (box) {
                status = document.createElement('p');
                status.className = 'gate-denied-status';
                status.textContent = UNLOCK_TEXT;
                box.appendChild(status);
            }
        } catch (e) { }
        var hash = location.hash || '';
        var tokenUrl = location.pathname + '?' + PARAM + '=' + encodeURIComponent(token) + hash;
        // ② 带查询参数的导航（与当前 URL 的查询不同 ⇒ 必然是真正的新导航）
        setTimeout(function () {
            try { location.replace(tokenUrl); } catch (e2) { }
        }, 700);
        // ③ 兜底：给一个可点的入口（用户点击 ⇒ 一定能走）
        setTimeout(function () {
            try {
                if (!status || !status.parentNode) return;
                status.textContent = UNLOCK_SLOW_TEXT;
                var a = document.createElement('a');
                a.className = 'gate-denied-enter';
                a.textContent = ENTER_TEXT;
                a.setAttribute('href', tokenUrl);
                status.parentNode.appendChild(a);
            } catch (e3) { }
        }, 1600);
        // ① 首选：reload 是最可靠的（页面一旦真的卸载，上面两个定时器自然不会触发）
        try { location.reload(); } catch (e4) { }
    }

    // 输错口令的唯一反馈：原生对话框（不进 DOM ⇒ 不占版面、零位移）。
    // 文案中性：不透露"接近 / 不接近"，也不给次数、长度之类的暗示。
    function wrAlert() { window.alert(WRONG_TEXT); }

    // ── 校验一条口令 ────────────────────────────────────────────────────────
    // 链接路径与输入框路径**走的是同一个函数**：同一次 SHA-256 + 同一次
    // 恒定时间比较（全部哈希都比一遍，不提前退出）。cb(mark|null)
    function verifyToken(candidate, subtleApi, cb) {
        var bytes;
        try {
            bytes = new TextEncoder().encode(candidate);
        } catch (e) { cb(null); return; }
        subtleApi.digest('SHA-256', bytes).then(function (digest) {
            var hex = toHex(new Uint8Array(digest));
            var matched = null;
            for (var i = 0; i < GATE_HASHES.length; i++) {
                if (ctEqual(hex, GATE_HASHES[i]) && matched === null) matched = GATE_HASHES[i];
            }
            cb(matched ? matched.slice(0, MARK_LEN) : null);
        }, function () { cb(null); });
    }

    // ── 放行 ────────────────────────────────────────────────────────────────
    function allow(mark) {
        try { localStorage.setItem(STORAGE_KEY, mark); } catch (e) { /* 隐私模式，忽略 */ }
        html.classList.add('gate-ok');
    }

    // ── 工具函数 ────────────────────────────────────────────────────────────

    // 恒定时间比较：长度差异折进 diff，同长度时逐字符异或累积，不看内容提前退出。
    function ctEqual(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string') return false;
        var n = a.length > b.length ? a.length : b.length;
        var diff = a.length ^ b.length;
        for (var i = 0; i < n; i++) {
            // 越界时 charCodeAt 是 NaN，`NaN ^ 0 === 0`，长度差异已经由 diff 记着了
            diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
        }
        return diff === 0;
    }

    function toHex(u8) {
        var out = '';
        for (var i = 0; i < u8.length; i++) out += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
        return out;
    }

    function markMatches(mark) {
        for (var i = 0; i < GATE_HASHES.length; i++) {
            if (GATE_HASHES[i].slice(0, MARK_LEN) === mark) return true;
        }
        return false;
    }

    function decodeSafe(s) {
        try { return decodeURIComponent(s); } catch (e) { return s; }
    }

    // 从 '#k=xxx' / '#k=xxx&coins/...' / '#coins/...&k=xxx' 里摘掉 k 段，
    // **其余段原序原样保留**（路由不能丢）。
    function stripParamFromHash(hash) {
        if (!hash || hash.length < 2) return { token: '', hash: hash, hit: false };
        var body = hash.charAt(0) === '#' ? hash.slice(1) : hash;
        var segs = body.split('&');
        var token = '', rest = [], hit = false;
        for (var i = 0; i < segs.length; i++) {
            var s = segs[i];
            if (!hit && s.slice(0, PARAM.length + 1) === PARAM + '=') {
                token = decodeSafe(s.slice(PARAM.length + 1));
                hit = true;
                continue;
            }
            rest.push(s);
        }
        if (!hit) return { token: '', hash: hash, hit: false };
        var tail = rest.join('&');
        return { token: token, hash: tail ? '#' + tail : '', hit: true };
    }

    // 查询串同理：只摘 k，其余参数（含站内各种 cache-buster，如 ?t=…）保留。
    function stripParamFromSearch(search) {
        if (!search || search.length < 2) return { token: '', search: search, hit: false };
        var body = search.charAt(0) === '?' ? search.slice(1) : search;
        var segs = body.split('&');
        var token = '', rest = [], hit = false;
        for (var i = 0; i < segs.length; i++) {
            var s = segs[i];
            if (!hit && s.slice(0, PARAM.length + 1) === PARAM + '=') {
                token = decodeSafe(s.slice(PARAM.length + 1));
                hit = true;
                continue;
            }
            if (s !== '') rest.push(s);
        }
        if (!hit) return { token: '', search: search, hit: false };
        return { token: token, search: rest.length ? '?' + rest.join('&') : '', hit: true };
    }

    // ★ 所有定义都就位之后再启动判定
    run();
})();
