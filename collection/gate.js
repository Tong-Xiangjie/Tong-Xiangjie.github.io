/* ============================================================================
 * collection/gate.js —— collection 站的「链接令牌门禁」
 *
 * 目标**不是安全认证**，只是提高门槛：挡住不懂技术的游客误入、挡住链接被随手转发。
 * 明确接受的边界：会用开发者工具的人可以直接读源码 / 直接下载数据文件 —— 这里不防。
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
 *      不对就保持隐藏、把页面内容整个换掉，只显示「暂无访问权限」。
 *
 * 为什么这样写：
 *   · 隐藏开关是 html 上的 `gate-ok` 类，兜底 CSS 写在 HTML 的 <head> 里，
 *     所以**关掉 JavaScript 也进不去**（而且还能看到那句提示，见 ::before 规则）。
 *   · 放行者不会被"先闪一下隐藏态"：内联脚本是同步的，在首次绘制前就把类加上了。
 *   · 令牌只以 SHA-256 十六进制形式存在仓库里，明文令牌永远不进仓库
 *     （`node collection/tools/gate.mjs check` 会扫描整个仓库确认这件事）。
 *   · 标记与当前哈希绑定 → `gate.mjs new` 换令牌后，所有老设备自动失效。
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
    var DENIED_TEXT = '暂无访问权限';       // 未授权时页面里唯一可见的文字（逐字）
    var DENIED_TITLE = '无法访问';          // 未授权时的 document.title（逐字，故意不带句号）
    var ICON_SRC = '/collection/block.svg'; // 未授权页的图标（站点主人自己的画；加载失败就藏掉）
    // ───────────────────────────────────────────────────────────────────────

    var html = document.documentElement;

    // ① head 的同步内联脚本已经放行（本地开发 / 本地文件 / 已授权标记）→ 收工，一个字节都不多花
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

    // ⑤ 没有令牌 → 拒绝（保持隐藏，页面内容换成提示）
    if (!token) { deny('no-token'); return; }

    // ⑥ 算令牌的 SHA-256 再比。crypto.subtle **只在安全上下文可用**：
    //    线上 https、本地 http://localhost / http://127.0.0.1 都是安全上下文，
    //    拿不到就别放行（宁可挡错，不可放过）。
    var subtle = (window.crypto && window.crypto.subtle) || null;
    if (!subtle || typeof subtle.digest !== 'function') { deny('no-subtle'); return; }
    var bytes;
    try {
        bytes = new TextEncoder().encode(token);
    } catch (e) { deny('no-textencoder'); return; }

    subtle.digest('SHA-256', bytes).then(function (digest) {
        var hex = toHex(new Uint8Array(digest));
        // 全部哈希都走一次恒定时间比较，不提前 break（免得比较次数本身泄露信息）
        var matched = null;
        for (var i = 0; i < GATE_HASHES.length; i++) {
            if (ctEqual(hex, GATE_HASHES[i]) && matched === null) matched = GATE_HASHES[i];
        }
        if (!matched) { deny('bad-token'); return; }
        allow(matched.slice(0, MARK_LEN));
    }, function () { deny('digest-failed'); });

    // ── 放行 ────────────────────────────────────────────────────────────────
    function allow(mark) {
        try { localStorage.setItem(STORAGE_KEY, mark); } catch (e) { /* 隐私模式，忽略 */ }
        html.classList.add('gate-ok');
    }

    // ── 拒绝 ────────────────────────────────────────────────────────────────
    function deny(reason) {
        try { console.warn('[collection-gate] ' + reason); } catch (e) { }
        html.classList.add('gate-denied');
        try { document.title = DENIED_TITLE; } catch (e) { }
        // 必须等解析结束再动 DOM：本文件在 <head> 里同步执行，此刻还没有 body；
        // 解析中途把 body 清空会把解析器搞乱。
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mountDenied, { once: true });
        } else {
            mountDenied();
        }
    }

    function mountDenied() {
        var body = document.body;
        if (!body) return;
        var box = document.createElement('div');
        box.className = 'gate-denied-box';
        box.setAttribute('role', 'alert');

        // 图标在上、文案在下。alt="" + aria-hidden：纯装饰，别让读屏重复播报。
        var icon = document.createElement('img');
        icon.className = 'gate-denied-icon';
        icon.setAttribute('src', ICON_SRC);
        icon.setAttribute('alt', '');
        icon.setAttribute('aria-hidden', 'true');
        // 加载失败就把它拿掉，别留一个破图占位符（文案仍然在）
        icon.onerror = function () {
            if (icon.parentNode) icon.parentNode.removeChild(icon);
        };

        var text = document.createElement('span');
        text.className = 'gate-denied-text';
        text.textContent = DENIED_TEXT;

        box.appendChild(icon);
        box.appendChild(text);
        // ★ 从 **DOM** 上把原内容清干净（不是只靠 CSS 藏）：
        //   ① 让"未授权时内容不可见"这条断言不依赖 CSS 是否生效；
        //   ② 连标志性文本（含 <title>）也一并消失。
        while (body.firstChild) body.removeChild(body.firstChild);
        body.appendChild(box);
        forceTitle();
        keepClean(body, box);
    }

    function forceTitle() {
        try { if (document.title !== DENIED_TITLE) document.title = DENIED_TITLE; } catch (e) { }
    }

    // ★ 光清一次不够：站点自己的脚本会在 DOMContentLoaded 之后又把内容挂回来
    //   （toolbox.js 就会把整只编辑器的 DOM 重新 append 到 body 上，里面连
    //   <title>铜の币纪主站</title> 和 coincollection 的图片路径都有）。
    //   所以这里用 MutationObserver 守住：body 下除提示盒子外一律删掉，
    //   documentElement 下除 head / body 外一律删掉，标题也拉回「无法访问」。
    //   这样"未授权时 DOM 里没有原站内容"就不只是一层 CSS。
    function keepClean(body, box) {
        forceTitle();
        if (typeof MutationObserver !== 'function') return;
        var sweep = function () {
            try {
                forceTitle();
                var i, n;
                for (i = body.childNodes.length - 1; i >= 0; i--) {
                    n = body.childNodes[i];
                    if (n !== box) body.removeChild(n);
                }
                var roots = document.documentElement.childNodes;
                for (i = roots.length - 1; i >= 0; i--) {
                    n = roots[i];
                    if (n !== document.head && n !== body) document.documentElement.removeChild(n);
                }
                // 站点脚本还会往 head 里塞第二个 <title>（原站名就藏在里头），
                // 留着的话 document.title 之外仍能读到原站标题 —— 一律收敛回一个。
                if (document.head) {
                    var titles = document.head.getElementsByTagName('title');
                    for (i = titles.length - 1; i >= 1; i--) titles[i].parentNode.removeChild(titles[i]);
                    if (titles[0] && titles[0].textContent !== DENIED_TITLE) titles[0].textContent = DENIED_TITLE;
                }
            } catch (e) { /* 删不动就算了，CSS 那层还挡着 */ }
        };
        try {
            var mo = new MutationObserver(sweep);
            mo.observe(body, { childList: true });
            mo.observe(document.documentElement, { childList: true });
            if (document.head) mo.observe(document.head, { childList: true, subtree: true });
        } catch (e) { /* 老浏览器没有 MutationObserver：CSS 那层仍然生效 */ }
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
})();
