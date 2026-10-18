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
    var WRONG_TEXT = '口令不正确';          // 输入错口令时唯一的中性提示（不透露"接近/不接近"）
    var SUBMIT_TEXT = '提交';
    var DEBUG = /(?:^|[?&])gatedebug=1(?:&|$)/.test(location.search);  // 只有显式打开才打日志
    // ───────────────────────────────────────────────────────────────────────

    var html = document.documentElement;

    // 门禁自己的日志：默认**一声不响**（被拒时控制台里不该有我们主动打的东西）
    function log() {
        if (!DEBUG) return;
        try { console.log.apply(console, Array.prototype.slice.call(arguments)); } catch (e) { }
    }

    // ── 被拒页：整份最小文档 ────────────────────────────────────────────────
    // ★★ 主题来源只有一处：下面五组 --gate-* 变量块。背景与图标**由同一组选择器
    //    决定**（同一块里既有 --gate-bg 也有 --gate-icon），组件层只消费变量 ——
    //    这样"背景判成浅色、图标却带着暗色的 invert"这类**白底白画**在结构上
    //    不可能再发生（用户实测过这个 bug：背景写在两套来源里、图标只写一套）。
    //    注意：这份和 gate.mjs 注入到 <head> 的那份（GUARD_STYLE）必须口径一致。
    var DENIED_CSS = [
        ':root{--gate-bg:#f6f7f9;--gate-fg:#1f2328;--gate-icon:brightness(0);--gate-in-bg:#ffffff;--gate-in-fg:#1f2328;--gate-in-bd:#9aa3ad;--gate-btn-bg:#1f2328;--gate-btn-fg:#f6f7f9;--gate-err:#b3261e;}',
        '@media (prefers-color-scheme: light){:root{--gate-bg:#f6f7f9;--gate-fg:#1f2328;--gate-icon:brightness(0);--gate-in-bg:#ffffff;--gate-in-fg:#1f2328;--gate-in-bd:#9aa3ad;--gate-btn-bg:#1f2328;--gate-btn-fg:#f6f7f9;--gate-err:#b3261e;}}',
        '@media (prefers-color-scheme: dark){:root{--gate-bg:#14171c;--gate-fg:#e8eaed;--gate-icon:brightness(0) invert(1);--gate-in-bg:#1b1f26;--gate-in-fg:#e8eaed;--gate-in-bd:#5b6673;--gate-btn-bg:#e8eaed;--gate-btn-fg:#14171c;--gate-err:#ff8a80;}}',
        'html[data-color-scheme="dark"]{--gate-bg:#14171c;--gate-fg:#e8eaed;--gate-icon:brightness(0) invert(1);--gate-in-bg:#1b1f26;--gate-in-fg:#e8eaed;--gate-in-bd:#5b6673;--gate-btn-bg:#e8eaed;--gate-btn-fg:#14171c;--gate-err:#ff8a80;}',
        'html[data-color-scheme="light"]{--gate-bg:#f6f7f9;--gate-fg:#1f2328;--gate-icon:brightness(0);--gate-in-bg:#ffffff;--gate-in-fg:#1f2328;--gate-in-bd:#9aa3ad;--gate-btn-bg:#1f2328;--gate-btn-fg:#f6f7f9;--gate-err:#b3261e;}',
        'html,body{margin:0;padding:0;}',
        '.gate-denied-box{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;',
        'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1.5rem;text-align:center;',
        'visibility:visible !important;background:var(--gate-bg);color:var(--gate-fg);',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans CJK SC","Microsoft YaHei",sans-serif;',
        'font-size:16px;line-height:1.6;-webkit-user-select:text;user-select:text;}',
        '.gate-denied-box *{visibility:visible !important;}',
        '.gate-denied-icon{display:block;width:160px;max-width:60vw;height:auto;margin:0 0 1.1rem;filter:var(--gate-icon);}',
        '.gate-denied-text{margin:0;max-width:100%;}',
        '.gate-denied-form{display:flex;gap:.5rem;width:100%;max-width:20rem;margin:1.25rem 0 0;}',
        '.gate-denied-input{flex:1 1 auto;min-width:0;padding:.5rem .6rem;font:inherit;border-radius:.375rem;',
        'border:1px solid var(--gate-in-bd);background:var(--gate-in-bg);color:var(--gate-in-fg);}',
        '.gate-denied-submit{flex:0 0 auto;padding:.5rem .9rem;font:inherit;border-radius:.375rem;',
        'border:1px solid var(--gate-btn-bg);background:var(--gate-btn-bg);color:var(--gate-btn-fg);cursor:pointer;}',
        '.gate-denied-error{margin:.75rem 0 0;color:var(--gate-err);}',
        '.gate-denied-error[hidden],[hidden]{display:none !important;}'
    ].join('');

    var DENIED_INNER = '<img class="gate-denied-icon" src="' + ICON_SRC + '" alt="" aria-hidden="true">'
        + '<p class="gate-denied-text">' + DENIED_TEXT + '</p>'
        // onsubmit="return false"：万一下面那段脚本没绑上（脚本被禁等），按回车也**不会**把
        // 表单当 GET 提交走（否则地址栏会变成 ...index.html?，既难看又像"泄漏了参数"）
        + '<form class="gate-denied-form" autocomplete="off" onsubmit="return false">'
        + '<input class="gate-denied-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="访问口令">'
        + '<button class="gate-denied-submit" type="submit">' + SUBMIT_TEXT + '</button>'
        + '</form>'
        + '<p class="gate-denied-error" hidden>' + WRONG_TEXT + '</p>';

    // 输入框路径与链接路径共用同一套算法常量（哈希表 / 存储键 / 标记长度）
    var SUBMIT_JS = '(function(){'
        + 'var H=' + JSON.stringify(GATE_HASHES) + ';'
        + 'var K=' + JSON.stringify(STORAGE_KEY) + ';'
        + 'var L=' + MARK_LEN + ';'
        + 'function hex(u8){var o="",i;for(i=0;i<u8.length;i++)o+=(u8[i]<16?"0":"")+u8[i].toString(16);return o;}'
        + 'function ct(a,b){if(typeof a!=="string"||typeof b!=="string")return false;'
        + 'var n=a.length>b.length?a.length:b.length,d=a.length^b.length,i;'
        + 'for(i=0;i<n;i++){d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);}return d===0;}'
        + 'function run(){'
        + 'var f=document.querySelector(".gate-denied-form"),inp=document.querySelector(".gate-denied-input"),'
        + 'err=document.querySelector(".gate-denied-error"),sub=window.crypto&&window.crypto.subtle,busy=false;'
        // 拿不到 crypto.subtle（非安全上下文）就**不显示输入框**：没法校验，给了只会误导
        + 'if(!f||!inp||!sub||typeof sub.digest!=="function"||typeof window.TextEncoder!=="function"){if(f)f.hidden=true;return;}'
        + 'f.addEventListener("submit",function(ev){'
        + 'ev.preventDefault();if(busy)return;var v=inp.value;if(!v)return;busy=true;err.hidden=true;'
        + 'var bytes;try{bytes=new TextEncoder().encode(v);}catch(e){busy=false;err.hidden=false;return;}'
        + 'sub.digest("SHA-256",bytes).then(function(d){'
        + 'var h=hex(new Uint8Array(d)),m=null,i;'
        + 'for(i=0;i<H.length;i++){if(ct(h,H[i])&&m===null)m=H[i];}'
        + 'if(m===null){busy=false;err.hidden=false;inp.select();return;}'
        + 'try{localStorage.setItem(K,m.slice(0,L));}catch(e){}'
        + 'var clean=location.pathname+location.search+location.hash;'
        + 'try{location.replace(clean);}catch(e){location.reload();}'
        + '},function(){busy=false;err.hidden=false;});'
        + '});}'
        // ★ 这段脚本放在 body 末尾（提示盒之后），所以元素一定已经在了，直接 run() 就行。
        //   不能等 DOMContentLoaded：document.close() 之后那个事件不一定还会来 ——
        //   实测（DOMContentLoaded 版本）表单根本没绑上，回车会走浏览器原生 GET 提交。
        + 'run();'
        + '})();';

    function deniedDoc(scheme) {
        // ★ 结构：<head> 只有 meta/title/style，脚本放 <body> 末尾。
        //   ⚠ 这里**不写 <html> 上的 class 由外层负责**：写出来的 <html> 起始标签会被
        //     解析器并到"当前那个 html 元素"上（属性合并），所以 class="gate-denied"
        //     与 data-color-scheme 都会落到同一个根元素上 —— 正是我们要的。
        return '<html lang="zh-CN" class="gate-denied"' + (scheme ? ' data-color-scheme="' + scheme + '"' : '') + '><head>'
            + '<meta charset="UTF-8">'
            + '<meta name="robots" content="noindex,nofollow">'
            + '<title>' + DENIED_TITLE + '</title>'
            + '<style>' + DENIED_CSS + '</style>'
            + '</head><body><div class="gate-denied-box" role="alert">' + DENIED_INNER + '</div>'
            + '<script>' + SUBMIT_JS + '</' + 'script>'
            + '</body></html>';
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
        var scheme = null;
        try {
            var s = html.getAttribute('data-color-scheme');
            if (s === 'dark' || s === 'light') scheme = s;
        } catch (e) { }
        // 兜底 CSS 里那条 ::before 提示（给"关 JS"用的）在这里要关掉：提示盒自己就是提示，
        // 不关的话两句话会叠在一起。
        try { html.classList.add('gate-denied'); } catch (e) { }
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
            bindForm(box);
        } catch (e2) { }
    }

    // 兜底路径用：给已经塞进 DOM 的提示盒绑上同一个提交行为
    function bindForm(root) {
        var img = root.querySelector('.gate-denied-icon');
        if (img) img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
        var f = root.querySelector('.gate-denied-form');
        if (!f) return;
        var inp = root.querySelector('.gate-denied-input');
        var err = root.querySelector('.gate-denied-error');
        var subtle = (window.crypto && window.crypto.subtle) || null;
        if (!subtle || typeof subtle.digest !== 'function' || typeof window.TextEncoder !== 'function') {
            f.hidden = true;
            return;
        }
        f.addEventListener('submit', function (ev) {
            ev.preventDefault();
            if (!inp.value) return;
            err.hidden = true;
            verifyToken(inp.value, subtle, function (mark) {
                if (!mark) { err.hidden = false; inp.select(); return; }
                allow(mark);
                var cleanUrl = location.pathname + location.search + location.hash;
                try { location.replace(cleanUrl); } catch (e2) { location.reload(); }
            });
        });
    }

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
