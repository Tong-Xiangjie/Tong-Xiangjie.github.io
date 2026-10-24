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
    // ★ 分享令牌必须是 **IIFE 级**变量：run() 里从 ?share= 读出来（随后地址栏就被抹掉了），
    //   而真正用它的 tryShareOrDeny() 是 IIFE 级的独立函数 —— 写成 run() 的局部变量会
    //   ReferenceError（verify-gate 就是这么把这个 bug 抓住的：整份被拒文档都没写出来）。
    var shareTok = '';

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

    // ── 分享被拒的**专属**页面 ─────────────────────────────────────────────
    // 为什么不复用 deny() 那一页：那一页是"站主自己没拿到授权"的场景 —— 文案是
    // 「暂无访问权限」+ 一个让你**输入通行密钥**的输入框。收分享链接的人手里没有密钥，
    // 给输入框只会让他以为"输点什么就能进"；而"链接过期了"和"这一页不在范围内"
    // 是两种完全不同、都需要说清楚的原因（用户要求：不要用通用的那一页）。
    // 所以这里另起一页：图标 + 一句结论 + 一句怎么办，**没有输入框、没有验证按钮**。
    // 结构照旧保持"零脚本 + 单提示盒"，守门 CSS（gate-denied 类）同样要挂上，
    // 否则 CSS 兜底那句 ::before 会和提示盒叠在一起。
    // ★ 文案用**统一一句**（用户要求）：不区分"过期"还是"范围外"。
    //   附带的两个好处：① 收链接的人无法据此判断"这一页到底存不存在"；
    //   ② 将来加新原因（签名坏了、被撤销…）不用再加一份文案，也不会漏掉某条分支。
    //   具体原因只写进控制台日志（?gatedebug=1 才看得到），不写进页面。
    var SHARE_DENIED_TITLE = '分享链接失效';
    var SHARE_DENIED_TEXT = '分享链接错误或已失效';

    function shareDeniedInner() {
        var inner = '<img class="gate-denied-icon" src="' + ICON_SRC + '" alt="" aria-hidden="true">'
            + '<p class="gate-denied-text">' + SHARE_DENIED_TEXT + '</p>';
        // 管理员落到这里时也给一条出路（仅在有有效本机标记时出现）。
        if (hasAdminMark()) {
            inner += '<a class="gate-denied-enter" href="./">以管理员身份进入</a>';
        }
        return inner;
    }

    function shareDeniedDoc(scheme) {
        return '<html lang="zh-CN" class="gate-denied"' + (scheme ? ' data-color-scheme="' + scheme + '"' : '') + '><head>'
            + '<meta charset="UTF-8">'
            + '<meta name="robots" content="noindex,nofollow">'
            + '<title>' + SHARE_DENIED_TITLE + '</title>'
            + '<style>' + DENIED_CSS + '</style>'
            + '</head><body><div class="gate-denied-box" role="alert">' + shareDeniedInner() + '</div></body></html>';
    }

    function denyShare(kind) {
        log('[collection-gate] share denied:', kind);
        var scheme = deniedIsDark() ? 'dark' : 'light';
        try { html.classList.add('gate-denied'); } catch (e) { }
        applyDeniedScheme(scheme);
        try {
            document.open();
            document.write(shareDeniedDoc(scheme));
            document.close();
            try { window.stop(); } catch (e3) { }
            try {
                var iconEl = document.querySelector('.gate-denied-icon');
                if (iconEl) iconEl.src = iconEl.getAttribute('src');
            } catch (e4) { }
            applyDeniedScheme(scheme);
            watchSystemColorScheme();
            return;
        } catch (e) { log('[collection-gate] share document.write failed', e); }
        // 兜底（document.open/write 被环境禁掉）：清空 DOM，塞进同一份提示盒。
        try {
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
            box.innerHTML = shareDeniedInner();
            body.appendChild(box);
            applyDeniedScheme(scheme);
            watchSystemColorScheme();
        } catch (e2) { }
    }

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

        // ②b 分享令牌 ?share=…（L2）。读取与摘除都和 k= 同一时机、同样**同步**：
        //     摘晚了 router.js 会从 location.search 里读到它（虽然它不解析，但没必要留着）；
        //     顺带把令牌从地址栏拿掉，免得留在历史记录/截图里。
        var shareStripBase = fromSearch.hit ? fromSearch.search : location.search;
        shareTok = (typeof shareFromQuery === 'function') ? shareFromQuery(shareStripBase) : '';
        var shareStrip = (typeof shareStripQuery === 'function') ? shareStripQuery(shareStripBase) : { search: shareStripBase, hit: false };
        // ★ hash 形态兜底：k= 一直是"片段优先、查询串兜底"，share 早先只有查询串一条路
        //   ⇒ 客户端重排/丢弃 query、或把它挪到 '#' 之后时，shareTok 恒为空，收件人
        //   只会看到"暂无访问权限"。这里补上同一条兜底（'#notes/rmb3&share=XXX'）。
        var hashShare = { hash: '', hit: false };
        if (!shareTok && typeof shareFromHash === 'function') {
            var hashTok = shareFromHash(location.hash);
            if (hashTok) {
                shareTok = hashTok;
                if (typeof shareStripHash === 'function') hashShare = shareStripHash(location.hash);
            }
        }

        // ③ 只要出现了 k（或 share）参数就**同步**抹掉它。为什么必须同步、且必须在这里做：
        //    站内路由大量使用 location.hash（#coins/... 、#coins/...&k=xxx 这种形态），
        //    router.js 在 DOMContentLoaded 读 location.hash。若等异步摘要回来再清，
        //    路由可能已经读到带 k 的脏 hash。这里只摘掉这两段，其余段**原样拼接**。
        // ③ 只摘 k：**share 一律留在地址栏**（用户要求）。
        //    为什么 share 不能摘：摘掉之后"这一趟是分享来的"这个事实只剩下 sessionStorage
        //    一份记录 —— 一旦同标签里开过管理员页面（?k= 会按设计清掉分享会话），
        //    回头刷新分享页就变成管理员了，正是用户遇到的那个坑。令牌留在 URL 里，
        //    刷新/后退/书签都还会按分享规则判。
        //    hash 形态的 share（#notes/rmb3&share=…）仍然要摘：router.js 是按 '/' 切 hash 的，
        //    留着会把 catId 读成 "rmb3&share=…"。
        if (fromHash.hit || fromSearch.hit || hashShare.hit) {
            var cleanHash = fromHash.hit ? fromHash.hash : location.hash;
            if (hashShare.hit) {
                cleanHash = (typeof shareStripHash === 'function') ? shareStripHash(cleanHash).hash : cleanHash;
            }
            try {
                // 注意这里用 fromSearch.search（k 已被摘掉的版本），而不是整段丢掉 query ——
                // share 参数留在原地，k 消失。
                history.replaceState(history.state, '',
                    location.pathname + (fromSearch.hit ? fromSearch.search : location.search) + cleanHash);
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
        // ★★ 分享令牌与管理员标记**必须分开、且分享优先**（用户明确要求）。
        //   带着 share 进站 ⇒ 这一趟一律按分享规则判，管理员也不例外：
        //     · 有效 ⇒ 放行，但只在这个范围里（管理员也出不去）；
        //     · 过期 / 范围不符 ⇒ 拒绝，连管理员也看不到这一页。
        //   所以这段必须排在下面"本机管理员标记"**之前** —— 否则管理员一点开过期链接，
        //   就被自己 localStorage 里的全站标记放过去了，分享的语义就没了。
        //   （管理员要回全站：关掉这个标签页，或点提示里的「退出分享模式」。）
        if (shareTok) { tryShareOrDeny('no-token'); return; }

        // ④b 本标签页已有的分享会话（sessionStorage）：**同样优先于**管理员标记，
        //     否则管理员刷新一下就跑到分享范围外面去了。关标签页即失效（临时分享的寿命）。
        var shareRec = readShareRec();
        if (shareRec) {
            if (shareRec.e && Date.now() > shareRec.e) {
                try { sessionStorage.removeItem(SHARE_SESSION_KEY); } catch (e2) { }
                denyShare('expired'); return;
            }
            if (!shareStillOk(shareRec)) {
                // 越界（例如手改地址栏后刷新）：先把 hash 拨回范围首页再放行。
                // **不调用 deny()** —— 那是 document.write，会把 SPA 换掉，人就回不去了。
                try {
                    history.replaceState(history.state, '', location.pathname + location.search + '#' + shareRec.p);
                } catch (e3) { }
            }
            allowShare(shareRec);
            return;
        }

        // ④ 管理员标记兜底：值必须等于某个授权哈希的前 MARK_LEN 位。
        if (stored) { allow(stored); return; }

        // ⑤ 没有 k 令牌 → 看有没有分享令牌，都没有才拒绝（提示文档）
        if (!token) { tryShareOrDeny('no-token'); return; }

        // ⑥ 算令牌的 SHA-256 再比。crypto.subtle **只在安全上下文可用**：
        //    线上 https、本地 http://localhost / http://127.0.0.1 都是安全上下文，
        //    拿不到就别放行（宁可挡错，不可放过）。
        var subtle = (window.crypto && window.crypto.subtle) || null;
        if (!subtle || typeof subtle.digest !== 'function') { deny('no-subtle'); return; }

        verifyToken(token, subtle, function (mark) {
            if (mark) { allow(mark); return; }
            // k 不对时**再看一眼分享令牌**：两个参数同时出现（例如从分享链接跳回总入口）
            // 不该因为其中一个坏掉就整页拒绝。
            tryShareOrDeny('bad-token');
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
        // ★ 用 k= 明确登录一次 ⇒ 当场结束本标签页的分享模式。
        //   否则"分享优先"会让管理员在同一标签里点主令牌链接时又被拨回分享页，
        //   看起来像"怎么点都跳回去"。刷新（没有 k=）仍然受分享范围约束 —— 那条不变。
        try { sessionStorage.removeItem(SHARE_SESSION_KEY); } catch (e) { /* 隐私模式，忽略 */ }
        html.classList.add('gate-ok');
    }

    // ── 分享令牌（L2 软限制，Ctrl+Shift+S 生成）─────────────────────────────
    // 与 k= 的三点不同：
    //  ① 通过后**不写** localStorage 全站标记（那是 k= 的待遇），只写 sessionStorage
    //     —— 关掉标签页就失效，符合"临时分享"的直觉；
    //  ② 只放行 payload.p 这个前缀范围内的路由（范围 = 按下快捷键那一刻的深链）；
    //  ③ L2 不验签（边界见 share-core.js 顶部），所以这里判的是"格式 / 有效期 / 范围"。
    // 纯函数共用 share-core.js：门禁只管"怎么用"，不管"怎么算"。
    function readShareRec() {
        try {
            var raw = sessionStorage.getItem(SHARE_SESSION_KEY);
            if (!raw) return null;
            var o = JSON.parse(raw);
            if (!o || typeof o.p !== 'string' || !o.p) return null;
            return o;
        } catch (e) { return null; }
    }

    // 会话是否仍然可用：没过期，且**当前 hash** 仍在范围内（含"仅选中这几张"的白名单）。
    function shareStillOk(rec) {
        if (!rec) return false;
        if (rec.e && Date.now() > rec.e) return false;
        return shareScopeMatch(rec.p, location.hash, rec.a);
    }

    // 分享模式下的标题（用户定稿）。被拒文档的标题由 denyShare 自己那份 <title> 负责，
    // 与这里无关；这里只管"放行之后的 SPA"。
    var SHARE_TITLE = '铜の币纪主站 | 来自分享';

    function allowShare(rec) {
        html.classList.add('gate-ok');
        try {
            if (document.title !== SHARE_TITLE) document.title = SHARE_TITLE;
            // ★ 站内各视图会按自己的需要改写 document.title（router/main 那几处），
            //   不守一下的话"来自分享"这个标题几秒后就被覆盖了。用 MutationObserver 盯着
            //   <title> 的文本，只在被改走时改回来（相同就不动 ⇒ 不会自激循环）。
            var titleEl = document.querySelector('title');
            if (titleEl && !window.__gateShareTitleWatch) {                window.__gateShareTitleWatch = true;
                try {
                    new MutationObserver(function () {
                        if (document.title !== SHARE_TITLE) document.title = SHARE_TITLE;
                    }).observe(titleEl, { childList: true, characterData: true, subtree: true });
                } catch (e2) { /* 老浏览器没有 MutationObserver：至少第一次设置生效 */ }
            }
        } catch (e) { }
        try {
            sessionStorage.setItem(SHARE_SESSION_KEY, JSON.stringify({ p: rec.p, a: rec.a || '', e: rec.e || 0 }));
        } catch (e) { /* 隐私模式，忽略 */ }
        watchShareScope();
        if (DEBUG) console.log('[gate] 分享令牌通过：范围 ' + rec.p
            + (rec.e ? '，到 ' + new Date(rec.e).toLocaleString() : '，不过期'));
    }

    function tryShareOrDeny(reason) {
        if (shareTok && typeof shareCheck === 'function') {
            var r = shareCheck(shareTok, location.hash, Date.now());
            if (r.ok) { allowShare(r.payload); return; }
            // ★ 一条真实的失败路径（用户实测"有时分享链接也看不了"）：
            //   ① 微信/QQ 之类客户端会把 URL 里 '#' 之后整段吃掉 ⇒ hash 为空；
            //   ② 有些客户端/中转还会把 fragment 改写成 '#wechat_redirect' 这类锚点 ⇒
            //      hash 非空但根本不是站内路由。
            //   两种都不是"越界"，而是"深链丢了"：按范围首页放行，别让人对着拒绝页发呆。
            //   （用 replaceState，不新增历史记录、也不触发 hashchange。）
            var bareHash = String(location.hash || '').replace(/^#/, '').trim();
            var lostDeepLink = !bareHash
                || (typeof shareLooksLikeRoute === 'function' && !shareLooksLikeRoute(bareHash));
            if (r.reason === 'outofscope' && lostDeepLink) {
                allowShare(r.payload);
                try {
                    history.replaceState(history.state, '', location.pathname + location.search + '#' + r.payload.p);
                } catch (e) { }
                return;
            }
            if (DEBUG) console.log('[gate] 分享令牌被拒：' + r.reason);
            // ★ 把令牌放回地址栏再写拒绝页：摘参数发生在判定之前，不补回来的话，
            //   刷新/后退之后连"拿原链接重试一次"都做不到（地址栏已经干净了）。
            try {
                history.replaceState(history.state, '',
                    location.pathname + '?' + SHARE_PARAM + '=' + shareTok + location.hash);
            } catch (e0) { }
            denyShare(r.reason);
            return;
        }
        deny(reason || 'no-token');
    }

    // ★ 越界导航的处理方式：**绝不调用 deny()**。
    //   deny() 是 document.open/write/close，会把整个 SPA 换掉 —— 用户就回不去分享页了
    //   （只能手动刷新），体验上等于"点一下就崩"。这里改成：
    //   在**捕获阶段**（早于 router.js 自己挂的 hashchange）把 hash 拨回范围首页，
    //   用 history.replaceState —— 它**不触发** hashchange，所以 router 稍后读到的
    //   就是拨回后的 hash，越界那一页根本不会被渲染（连一帧闪都不会有）。
    function watchShareScope() {
        window.addEventListener('hashchange', function () {
            var rec = readShareRec();
            if (!rec) return;
            if (rec.e && Date.now() > rec.e) {          // 会话期间到期：按过期处理
                try { sessionStorage.removeItem(SHARE_SESSION_KEY); } catch (e) { }
                deny('share-expired');
                return;
            }
            if (shareScopeMatch(rec.p, location.hash, rec.a)) return;
            shareInstant();
            try {
                history.replaceState(history.state, '', location.pathname + location.search + '#' + rec.p);
            } catch (e) { /* 拨不回去也只能算了，至少提示到位 */ }
            shareToast('当前页面暂未开放分享哦(´･_･`)', hasAdminMark());
        }, true);
        watchShareNavigation();
    }

    // ★★ 站内导航**根本不走 hashchange**。
    //   collection/router.js 的 syncRoute() 用的是 history.**replaceState**（它自己的注释里
    //   也写着"只用 replaceState，永不 pushState"），而 replaceState 不触发 hashchange
    //   ⇒ 只挂 hashchange 的话，收链接的人点侧边栏/标签栏就能逛全站 —— 用户实测的原话是
    //   "相当于给了全部的门户密钥"。站内所有导航最终都会调 syncRoute()，所以把那一层包住：
    //   越界时不放行原来那次同步，改为把地址与内容一起拨回分享范围（并给提示）。
    function watchShareNavigation() {
        var tries = 0;
        var wrap = function () {
            if (typeof window.syncRoute !== 'function') {
                // router.js 在文档末尾加载，gate.js 在 head 里 —— 所以这里要等它出现。
                if (++tries <= 40) setTimeout(wrap, 100);
                return;
            }
            if (window.__gateShareSynced) return;
            window.__gateShareSynced = true;
            var orig = window.syncRoute;
            window.syncRoute = function (replace) {
                var rec = readShareRec();
                if (rec) {
                    var target = '';
                    try { target = (typeof buildRoute === 'function') ? String(buildRoute() || '') : ''; } catch (e) { target = ''; }
                    if (!shareScopeMatch(rec.p, target, rec.a)) {
                        shareToast('当前页面暂未开放分享哦(´･_･`)', hasAdminMark());
                        shareInstant();
                        var back = location.pathname + location.search + '#' + rec.p;
                        try { history.replaceState(history.state, '', back); } catch (e2) { }
                        // 越界那一页此时通常已经被渲染了（侧边栏是"先改状态+渲染，再 syncRoute"），
                        // 所以再把范围内的路由应用一次，把内容和地址栏一起拨回去。
                        if (typeof applyRoute === 'function') {
                            try { applyRoute('#' + rec.p); } catch (e3) { }
                            shareLockAnchors();
                        }
                        return undefined;
                    }
                }
                return orig.apply(window, arguments);
            };
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { setTimeout(wrap, 0); });
        } else {
            setTimeout(wrap, 0);
        }
    }

    // 顶部小提示，自动消失。它只出现在"已放行的 SPA"里，与被拒文档无关，
    // 所以不进 DENIED_CSS（那份 CSS 要求逐条镜像 gate.mjs 的 GUARD_STYLE）。
    // canExit：管理员在本标签页里被困在分享范围时，给一个显式出口
    //（清掉会话记录并重载 ⇒ 回到全站；不是管理员的人看到也没有意义，故按凭据控制）。
    function shareToast(text, canExit) {
        try {
            var old = document.getElementById('gateShareToast');
            if (old && old.parentNode) old.parentNode.removeChild(old);
            var d = document.createElement('div');
            d.id = 'gateShareToast';
            d.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:4000;'
                + 'background:rgba(0,0,0,.82);color:#fff;padding:8px 14px;border-radius:999px;'
                + 'font-size:.85rem;max-width:92vw;text-align:center;pointer-events:none;';
            var span = document.createElement('span');
            span.textContent = text;
            d.appendChild(span);
            if (canExit) {
                var b = document.createElement('button');
                b.type = 'button';
                b.textContent = '退出分享模式';
                b.style.cssText = 'margin-left:8px;pointer-events:auto;cursor:pointer;font:inherit;'
                    + 'border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;'
                    + 'border-radius:999px;padding:2px 10px;';
                b.addEventListener('click', function () {
                    try { sessionStorage.removeItem(SHARE_SESSION_KEY); } catch (e) { }
                    location.reload();
                });
                d.appendChild(b);
            }
            document.body.appendChild(d);
            setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, canExit ? 6000 : 2600);
        } catch (e) { /* 提示失败不影响放行 */ }
    }

    // ★ 越界回拨时**不要看动画**（用户要求：点不能看的地方不应该像刷新一样重播入场动画）。
    //   为什么会有动画：侧边栏/标签栏是"先改状态 + 渲染，再 syncRoute"，等我们发现越界时
    //   界面已经换过去了；要拨回来就得再渲染一次（applyRoute），而各板块的入场动画是
    //   CSS 动画 ⇒ 元素一重渲染就又播一遍，观感就是"点一下，整页又入场了一次"。
    //   这里在回拨的那一小段时间把 animation/transition 整体按住（加一个 html 类，
    //   结束后摘掉），页面结构与地址栏照旧拨回，只是过程中没有动画。
    var SHARE_NOANIM_CLASS = 'gate-share-instant';
    function shareInstant(ms) {
        try {
            if (!document.getElementById('gateShareInstantStyle')) {
                var st = document.createElement('style');
                st.id = 'gateShareInstantStyle';
                st.textContent = '.' + SHARE_NOANIM_CLASS + ' *,.' + SHARE_NOANIM_CLASS + ' *::before,'
                    + '.' + SHARE_NOANIM_CLASS + ' *::after{animation:none !important;transition:none !important;}';
                (document.head || document.documentElement).appendChild(st);
            }
            html.classList.add(SHARE_NOANIM_CLASS);
            setTimeout(function () {
                try { html.classList.remove(SHARE_NOANIM_CLASS); } catch (e) { }
            }, ms || 400);
        } catch (e) { /* 按不住动画也不能让回拨失败 */ }
    }

    // ★ 用户实测：分享模式里点"范围外的入口"（例如「我的」）会**真的跳进去、整页刷新一次**。
    //   原因：那些入口是普通 <a href>，浏览器直接换页，既不经过 syncRoute 也不走 hashchange，
    //   我们只能在事后才发现越界 ⇒ 观感就是"点一下又刷新了"。
    //   做法（用户原话："建议先判断而不是先刷新"）：在**捕获阶段拦下点击**，先判范围；
    //   越界就 preventDefault/stopPropagation —— 页面不动、地址栏也不动、也不播放任何动画。
    //   放走的情形：外站链接、新标签打开（target=_blank / 带修饰键 / 中键）、非 http(s) 协议、
    //   纯锚点（那是 hashchange 那条路管的）、以及判定在范围内的链接。
    function shareClickTarget(a) {
        try {
            var href = a.getAttribute('href') || '';
            if (!href) return null;
            if (/^(javascript|mailto|tel|blob|data):/i.test(href)) return null;
            var u = new URL(href, location.href);
            if (u.origin !== location.origin) return null;
            var h = u.hash || '';
            // 纯锚点（href="#xxx"）：只判"看起来像站内路由"的那些。像 <a href="#"> 这种
            // 拿来做纯 JS 按钮的写法不能被误伤，非路由锚点（#、#wechat_redirect…）直接放走。
            if (href.charAt(0) === '#' && u.pathname === location.pathname) {
                var bare = h.replace(/^#/, '');
                if (!bare) return null;
                if (typeof shareLooksLikeRoute === 'function' && !shareLooksLikeRoute(bare)) return null;
                return h;
            }
            // 换到站内**另一个页面**（不只是换 hash）也算越界：分享的是这一套 SPA。
            if (u.pathname !== location.pathname) return '';
            return h || null;
        } catch (e) {
            return null;
        }
    }

    // 分享模式下的会话记录（点击守门、"锁按钮"、禁再分享都要用）
    function shareRecNow() {
        try {
            var raw = sessionStorage.getItem(SHARE_SESSION_KEY);
            var rec = raw ? JSON.parse(raw) : null;
            return (rec && rec.p) ? rec : null;
        } catch (e) { return null; }
    }

    var shareLockStyleDone = false;
    function shareEnsureLockStyle() {
        if (shareLockStyleDone) return;
        shareLockStyleDone = true;
        try {
            var st = document.createElement('style');
            st.id = 'gateShareLockStyle';
            st.textContent = '.gate-share-locked{opacity:.45;cursor:not-allowed;pointer-events:none !important;}'
                + '.gate-share-locked *{pointer-events:none !important;}';
            (document.head || document.documentElement).appendChild(st);
        } catch (e) { }
    }

    // 候选元素：带 href 的链接 + 任何"看着像站内入口"的元素（站内导航常写成
    // <a data-mode="mine"> 或 <div data-route="notes/x">，没有 href，光靠 a[href] 抓不到）。
    var SHARE_LOCK_SEL = 'a[href],[data-mode],[data-route],[data-href],[data-hash],'
        + '[data-view],[data-target],[data-nav]';

    // 尽力猜"点这个会去哪"：先信 <a href>，再看元素上的路由线索。
    // ★ 只认"像站内路由"的值 —— 多段路径，或者正好是站点的一个模式名（SHARE_MODES）。
    //   否则会把普通 UI 上的 data-view="table" 这类误判成越界、把页面自己锁坏。
    function shareRouteOf(el) {
        if (!el || !el.getAttribute) return null;
        var t = shareClickTarget(el);
        if (t !== null) return t;
        var keys = ['data-href', 'data-route', 'data-hash', 'data-target', 'data-nav', 'data-mode', 'data-view'];
        for (var i = 0; i < keys.length; i++) {
            var v = el.getAttribute(keys[i]);
            if (!v) continue;
            v = String(v).trim().replace(/^#/, '').replace(/^\/+/, '');
            if (!v) continue;
            if (v.indexOf('/') >= 0) return '#' + v;
            if (typeof SHARE_MODES !== 'undefined' && SHARE_MODES.indexOf(v.split('/')[0]) >= 0) return '#' + v;
        }
        return null;
    }

    // ★ 用户要求："把这些点不了的按键锁住"。
    //   分享模式下扫一遍候选入口，点了会越界的就灰掉 + 禁点（cursor:not-allowed）。
    //   锁上之后浏览器**根本不把指针事件交给它**，所以不依赖拦截时机。
    function shareLockAnchors() {
        var rec = shareRecNow();
        if (!rec) return;
        shareEnsureLockStyle();
        try {
            var list = document.querySelectorAll(SHARE_LOCK_SEL);
            for (var i = 0; i < list.length; i++) {
                var a = list[i];
                var t = shareRouteOf(a);
                if (t === null) continue;
                if (shareScopeMatch(rec.p, t, rec.a)) a.classList.remove('gate-share-locked');
                else a.classList.add('gate-share-locked');
            }
        } catch (e) { }
    }

    var shareLastBlockAt = 0;
    function shareBlockClick(e) {
        var rec = shareRecNow();
        if (!rec) return;
        if (e.defaultPrevented || (e.button !== undefined && e.button !== 0)) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var t = e.target;
        var el = (t && t.closest) ? t.closest(SHARE_LOCK_SEL) : null;
        if (!el || el.getAttribute('target') === '_blank') return;
        var target = shareRouteOf(el);
        if (target === null) return;
        if (shareScopeMatch(rec.p, target, rec.a)) return;
        // 越界：把这次事件整条按死。pointerdown / mousedown / click 都拦 ——
        // 用户实测"点了还是进得去"，就是有入口在 pointerdown/mousedown 阶段就动手了。
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        var now = Date.now();
        if (now - shareLastBlockAt > 500) {          // 一次点击会来三个事件，只提示一次
            shareLastBlockAt = now;
            shareToast('当前页面暂未开放分享哦(´･_･`)', hasAdminMark());
        }
    }

    // ★ 分享链接不能再被分享：Ctrl+Shift+S 在分享模式下直接吃掉。
    //   gate.js 在 share.js 之前加载，所以这个 window 捕获监听比 share.js 的先注册，
    //   同级同阶段下先跑，stopImmediatePropagation 就能让分享弹窗根本不出现。
    function shareBlockReshare(e) {
        if (!shareRecNow()) return;
        var k = e.key || '';
        if (!(e.ctrlKey && e.shiftKey && (k === 'S' || k === 's'))) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }

    // ★ 装在 **window** 的捕获阶段：比 document 上的捕获更早，
    //   站内任何委托处理器（哪怕它自己也注册在捕获阶段）都抢不到这次点击。
    try {
        window.addEventListener('pointerdown', shareBlockClick, true);
        window.addEventListener('mousedown', shareBlockClick, true);
        window.addEventListener('pointerup', shareBlockClick, true);
        window.addEventListener('mouseup', shareBlockClick, true);
        window.addEventListener('touchstart', shareBlockClick, true);
        window.addEventListener('click', shareBlockClick, true);
        window.addEventListener('keydown', shareBlockReshare, true);
    } catch (e) { }

    // 站内导航是异步渲染的（首屏可能还没建好），分享模式下隔一会儿补扫两次，把该灰的链接灰掉。
    try {
        setTimeout(shareLockAnchors, 1200);
        setTimeout(shareLockAnchors, 2600);
    } catch (e) { }

    // ★ 定时补扫会漏：导航可能是数据加载完之后（3 秒、5 秒…）才渲染出来的，扫早了就没有它。
    //   改成盯着 DOM：只要有新增节点就重算一次（节流 300ms，避免大规模渲染时反复全量扫描）。
    try {
        var shareLockTimer = 0;
        new MutationObserver(function () {
            if (!shareRecNow()) return;
            if (shareLockTimer) return;
            shareLockTimer = setTimeout(function () {
                shareLockTimer = 0;
                shareLockAnchors();
            }, 300);
        }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { }

    // 本机是否有有效的管理员标记（给「退出分享模式」按钮用：分享模式对管理员也生效，
    // 但管理员总得有个显式出路）。
    function hasAdminMark() {
        try {
            var s = localStorage.getItem(STORAGE_KEY);
            return !!(s && markMatches(s));
        } catch (e) { return false; }
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
