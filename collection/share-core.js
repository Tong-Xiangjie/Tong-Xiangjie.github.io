/* ============================================================================
   分享令牌（L2 · 软限制）—— 纯函数层
   ----------------------------------------------------------------------------
   生成端（share.js）与校验端（gate.js）**共用这一份**，避免"生成按一套规则、
   校验按另一套规则"这种最难查的漂移。

   ★ 必须说清它的边界（不要假装它是安全机制）：L2 **不验签**。
     payload 是 base64url 的明文 JSON，任何人都能把 e（过期时间）改成 9999999999999、
     把 p（范围）改成别的分类。所以 L2 的本质是「**防误转**」——
     让随手转发的人只能看到、也只能分享你指定的那一页；它挡不住懂技术的人。
     真签名在 L3（站主本机用私钥签，网页里只有公钥验签），到那时 e 才改不动。

   ★ 链接形态（query 归门禁、hash 归路由，顺序不能反）：
       https://…/collection/?share=<payload>[.<sig>]#notes/rmb3/s1/v1.0
     为什么令牌放 query 不放 hash：router.js 的 syncRoute 是
     `location.pathname + location.search + '#' + route`，query 会被**原样带着**走；
     而 hash 里已经有路由段（c-/q-/sm-/fz-/view-/order-/y-/m-…），再塞令牌要加一堆分支。
   ============================================================================ */

var SHARE_PARAM = 'share';                  // 查询参数名
var SHARE_SESSION_KEY = 'collection-share'; // sessionStorage 键（关标签页即失效）

// ── base64url ───────────────────────────────────────────────────────────────
// 标准 base64 会产出 + / =，直接塞进 URL 会被当成保留字符，必须替换掉。
// btoa 只吃"二进制字符串"，所以中文等非 ASCII 要先过 TextEncoder。
// Node 侧没有 btoa/atob 的旧版本用 Buffer 兜底（用例在 node 沙箱里跑这份代码）。
function shareB64UrlEncode(text) {
    var bytes = new TextEncoder().encode(String(text));
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = (typeof btoa === 'function')
        ? btoa(bin)
        : (typeof Buffer !== 'undefined' ? Buffer.from(bin, 'binary').toString('base64') : '');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function shareB64UrlDecode(text) {
    var b = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = '';
    try {
        bin = (typeof atob === 'function')
            ? atob(b)
            : (typeof Buffer !== 'undefined' ? Buffer.from(b, 'base64').toString('binary') : '');
    } catch (e) {
        // ★ 脏 base64（比如别人手改了 URL）不许把门禁搞崩 —— 这里安静地返回空串，
        //   由上层 shareDecode 的 JSON.parse 抛错 → 统一落到 badformat。
        return '';
    }
    var bytes = new Uint8Array(bin.length);
    for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    return new TextDecoder().decode(bytes);
}

// ── 范围（scope）────────────────────────────────────────────────────────────
// 取"到分类为止"的前缀，**不是**完整深链：
//   #notes/rmb3/s1/v1.0        → notes/rmb3        （点开系列/版别不失效）
//   #notes/rmb3                → notes/rmb3
//   #articles/12               → articles
//   #special/denom/g10000元    → special/denom     （子类不写进范围）
// ★ 字段名以 router.js 的 parseRoute **真实返回值**为准，而且它有两条分支用了不同的名字：
//   · 分类分支（#notes/rmb3、#coins/commemorative_coins）返回 **catId / subId**（router.js:293）；
//   · 文章分支返回 categoryId（router.js:229），专题分支返回 configId（router.js:249）。
//   早先这里只读 categoryId ⇒ 纸币/硬币的 p 永远退化成整个板块（notes / coins），
//   "只放行一页"静默失效。现在两个都读 ⇒ 任何一边改名都不会再静默放宽。
//   （verify-share 里有对 router.js 字段的漂移守门：router 换了名字会红。）
function shareScopeOf(route) {
    if (!route || !route.mode) return '';
    if (route.mode === 'special') return route.configId ? 'special/' + route.configId : 'special';
    if (route.mode === 'articles') return 'articles';
    if (route.mode === 'settings') return 'settings';
    var cat = route.categoryId || route.catId || null;
    if (!cat) return route.mode;
    var scope = route.mode + '/' + cat;
    // ★ 选了子分类 ⇒ 范围收到子分类（"分享人民币下面的某个系列"就是这一档）；
    //   想放宽到整个分类，在分享窗口里改选"当前分类"即可（那是手动覆盖要做的事）。
    //   不带上 subId 的话，从子分类分享出去会静默放宽到整个分类。
    if (route.subId) return scope + '/' + route.subId;
    return scope;
}

// ★ 选择段签名（"单张 / 选定多张"这一档靠它）。
//   背景：多选**本来就在路由里** —— #notes/commemorative/s0,4,8 表示在这个分类里选了
//   第 0、4、8 个系列（router.js:300 把它解析成 sIdxList）。所以"仅分享选中的这几张"
//   不需要另造界面，只要把 hash 里的选择段(s/v/c)取出来、归一化成一个签名即可。
//   归一化：段内按逗号拆开、排序后拼回，这样 s0,4,8 与 s0,8,4 视为同一个签名。
//   没有选择段 ⇒ 返回空串（= 列表页），调用方据此判断"是不是列表页"。
function shareSelSig(hash) {
    var h = String(hash || '').replace(/^#/, '').split('&')[0];
    if (!h) return '';
    var parts = h.split('/');
    var segs = [];
    for (var i = 0; i < parts.length; i++) {
        if (!/^[svc][\d.,]+$/.test(parts[i])) continue;
        var head = parts[i].charAt(0);
        var body = parts[i].slice(1).split(',').filter(function (x) { return x !== ''; });
        body.sort();
        segs.push(head + body.join(','));
    }
    segs.sort();
    return segs.join('|');
}

// 从签名里取"用到了哪些系列下标"：s 段的数字 + v 段的 si 部分。
// 例：s0,4,8 → [0,4,8]；s0|v0.1 → [0]；v2.0 → [2]；空 ⇒ []。
function shareSelIdx(sig) {
    var out = [];
    var segs = String(sig || '').split('|');
    for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (!s) continue;
        if (s.charAt(0) === 's') {
            var nums = s.slice(1).split(',');
            for (var j = 0; j < nums.length; j++) if (nums[j] !== '') out.push(nums[j]);
        } else if (s.charAt(0) === 'v') {
            var pairs = s.slice(1).split(',');
            for (var k = 0; k < pairs.length; k++) {
                var si = String(pairs[k]).split('.')[0];
                if (si !== '') out.push(si);
            }
        }
    }
    return out;
}

// ★ 单张/多张那一档到底放行什么 —— 这里按"**子集**"判，不是全等。
//   为什么改（用户实测 C 的问题）：分享 s0,4,8 之后，收件人在列表页点开第 0 张，
//   hash 会变成 notes/commemorative/s0 —— 全等判定下这是"不一致"⇒ 被拨回，
//   结果"那几张反而点不开了"。用户的本意是"只有这几张能看"，那子集才是对的：
//     · 列表页（没有选择段）⇒ 放行；
//     · 只用到白名单里的系列（s0、s4,s8、s0/v0.1 这类）⇒ 放行；
//     · 用到任何白名单外的系列（s1、s0,9 …）⇒ 拒绝。
//   白名单里没有 s 段（极少数、只有 v 段的情况）⇒ 退回全等，保持旧语义。
function shareSelAllowed(allowSel, hash) {
    var want = shareSelIdx(allowSel);
    var got = shareSelIdx(shareSelSig(hash));
    if (!want.length) return shareSelSig(hash) === allowSel;
    if (!got.length) return true;
    for (var i = 0; i < got.length; i++) if (want.indexOf(got[i]) < 0) return false;
    return true;
}

// 前缀匹配必须落在 '/' 边界上：notes/rmb3 放行 notes/rmb3 与 notes/rmb3/s1/v1.0，
// 但**不放行** notes/rmb3x / notes/rmb4 / notes。hash 里可能还挂着 &k= 之类，先切掉。
//
// 第三个参数 allowSel = 令牌里的选择段签名（payload.a，可缺省）：
//   · 缺省 ⇒ 老行为：只看前缀（板块级 / 小板块级都是这一档）；
//   · 存在 ⇒ **单张/多张**那一档，按用户定稿的规则：
//       - 当前 hash 没有选择段 ⇒ 放行（**列表页可以看**，用户明确选了这一条）；
//       - 有选择段 ⇒ 必须与签名完全一致（点别的那张 / 改选别的组合都被拨回）。
function shareScopeMatch(scope, hash, allowSel) {
    var clean = function (s) {
        return String(s || '').replace(/^#/, '').split('&')[0].replace(/^\/+/, '').replace(/\/+$/, '');
    };
    var h = clean(hash), p = clean(scope);
    if (!p) return false;
    var inPrefix = (h === p) || (h.slice(0, p.length + 1) === p + '/');
    if (!inPrefix) return false;
    if (!allowSel) return true;
    // allowSel 存在 ⇒ 单张/多张那一档：列表页放行，选择段必须是白名单的子集（见 shareSelAllowed）。
    return shareSelAllowed(allowSel, hash);
}

// ── payload 组装 / 解析 ─────────────────────────────────────────────────────
function shareRandId() {
    var bytes = new Uint8Array(4);
    try {
        (window.crypto || crypto).getRandomValues(bytes);
    } catch (e) {
        for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var hex = '';
    for (var j = 0; j < bytes.length; j++) hex += ('0' + bytes[j].toString(16)).slice(-2);
    // ★ i 只是"这是哪一条链接"的调试标记：纯静态下**没有服务端**，
    //   它既不能用来吊销、也不能用来统计，别当成 id 之外的用途。
    return hex.slice(0, 8);
}

function shareBuildPayload(scope, expMs, allowSel) {
    var payload = { p: String(scope || '') };
    if (expMs) {
        payload.e = Math.floor(expMs);
        // s = 签发时刻：有了它才能按"这个令牌本来多长命"来算时钟宽限。
        payload.s = Date.now();
    }
    // a = 只放行这几个选中项的签名（缺省 ⇒ 整块放行）。见 shareScopeMatch 的说明。
    if (allowSel) payload.a = String(allowSel);
    payload.i = shareRandId();
    return payload;
}

function shareEncode(payload) {
    return shareB64UrlEncode(JSON.stringify(payload));
}

// 解析（L2 只看 '.' 前面那一段；L3 的签名段在 share.js 之外的 CLI 侧生成）
function shareDecode(token) {
    try {
        var head = String(token || '').split('.')[0];
        if (!head) return null;
        var o = JSON.parse(shareB64UrlDecode(head));
        if (!o || typeof o !== 'object' || typeof o.p !== 'string' || !o.p) return null;
        if (o.e !== undefined && o.e !== null && !(typeof o.e === 'number' && isFinite(o.e))) return null;
        // a（选择段签名）若出现必须是字符串；类型不对就整条判为坏令牌。
        if (o.a !== undefined && o.a !== null && typeof o.a !== 'string') return null;
        return o;
    } catch (e) { return null; }
}

// ── 校验：格式 / 有效期 / 范围 三件事 ───────────────────────────────────────
// 返回值带 reason，便于门禁给出区分的日志（badformat / expired / outofscope）。
//
// ★ 允许量：`e` 是**发送方**写死的绝对时间戳，判过期却是拿**收件人**的本机时钟比，
//   两边差几分钟很常见（手机时间没同步、跨时区、发送方时钟快）。没有宽限的话，
//   选"1 小时"的链接可能刚发出就在对方手机上打不开，换台设备又能开 —— 正是用户
//   反馈的"有时分享链接也看不了"。这里给 5 分钟宽限：只影响"刚好卡在边界"的链接，
//   不会让过期链接长期有效。
// ★ 时钟宽限：收件人本机时间和发送者不可能完全一致，卡在 e 那一毫秒会"明明没过期却打不开"。
//   但固定 5 分钟是错的（用户实测：自定义 1 分钟的链接，过期后还能开 —— 5 分钟的宽限把
//   1 分钟档整个吞掉了）。改成**按这个令牌本来的生命期**算，并夹在 3 秒 ~ 5 分钟之间：
//     1 分钟档 ⇒ 3 秒；1 小时档 ⇒ 3 分钟；1 天 / 30 天 ⇒ 顶到 5 分钟。
//   老令牌（payload 里没有 s，签发时刻未知）退一个 30 秒的中庸值。
var SHARE_CLOCK_GRACE_MS = 5 * 60 * 1000;
function shareGraceMs(payload) {
    var e = payload && typeof payload.e === 'number' ? payload.e : 0;
    if (!e) return 0;                                   // 跟随站点令牌（不设过期）⇒ 没有宽限一说
    var s = payload && typeof payload.s === 'number' ? payload.s : 0;
    if (!s || s >= e) return 30000;
    var g = Math.round((e - s) * 0.05);
    if (g > SHARE_CLOCK_GRACE_MS) g = SHARE_CLOCK_GRACE_MS;
    if (g < 3000) g = 3000;
    return g;
}

function shareCheck(token, hash, nowMs) {
    var payload = shareDecode(token);
    if (!payload) return { ok: false, reason: 'badformat' };
    var now = (typeof nowMs === 'number') ? nowMs : Date.now();
    if (payload.e && now > payload.e + shareGraceMs(payload)) {
        return { ok: false, reason: 'expired', payload: payload };
    }
    if (!shareScopeMatch(payload.p, hash, payload.a)) return { ok: false, reason: 'outofscope', payload: payload };
    return { ok: true, payload: payload };
}

// ── hash 形态的令牌 ────────────────────────────────────────────────────────
// 为什么需要：k= 一直有"片段优先、查询串兜底"两条路（stripParamFromHash / stripParamFromSearch），
// 而 share 只有查询串一条 ⇒ 有些客户端会重排/丢弃 query、或把它挪到 '#' 之后，
// 于是 shareTok 恒为空，收件人只会看到"暂无访问权限"。
// 这里把 hash 当查询串看（'#notes/rmb3&share=XXX' → 取 XXX），补上同一条兜底。
function shareFromHash(hash) {
    var h = String(hash || '').replace(/^#/, '');
    if (!h || h.indexOf(SHARE_PARAM + '=') < 0) return '';
    return shareFromQuery('?' + h);
}

function shareStripHash(hash) {
    var raw = String(hash || '');
    var h = raw.replace(/^#/, '');
    if (!h) return { hash: raw, hit: false };
    var st = shareStripQuery('?' + h);
    if (!st.hit) return { hash: raw, hit: false };
    return { hash: '#' + st.search.replace(/^\?/, ''), hit: true };
}

// ── 这段 hash 像不像站内路由 ────────────────────────────────────────────────
// 用途：客户端把 fragment 改写成 '#wechat_redirect' 这类东西时，深链其实丢了，
// 但也不能因此就把人挡在门外（那不是"越界"，是"没拿到地址"）。
// 名单必须与 collection/core.js 的 MODE_URL_SEGMENTS 一致 —— verify-share 会比对，
// 那边加了板块这里忘了改，用例会红。
var SHARE_MODES = ['notes', 'coins', 'special', 'articles', 'settings'];

function shareLooksLikeRoute(hash) {
    var h = String(hash || '').replace(/^#/, '').split('&')[0].replace(/\/+$/, '');
    if (!h) return false;
    var first = h.split('/')[0];
    // 认不出来的首段一律视为"不是路由"—— 宁可当作深链丢失、按范围首页放行，
    // 也不要因为客户端加了个锚点就把整条分享链接废掉。
    return SHARE_MODES.indexOf(first) >= 0;
}

// ── 查询串读写（gate.js 读令牌 / 摘参数都用这两个）──────────────────────────
function shareFromQuery(search) {
    var body = String(search || '').replace(/^\?/, '');
    if (!body) return '';
    var segs = body.split('&');
    for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (s.slice(0, SHARE_PARAM.length + 1) === SHARE_PARAM + '=') {
            var raw = s.slice(SHARE_PARAM.length + 1);
            try { return decodeURIComponent(raw); } catch (e) { return raw; }
        }
    }
    return '';
}

// 摘掉 share= 段，其余参数（含站内各种 cache-buster）原序保留。
// 与 gate.js 里 stripParamFromSearch 是同一套写法，但那个写死了 k，这里要自己的参数名。
function shareStripQuery(search) {
    if (!search || search.length < 2) return { search: search, hit: false };
    var body = search.charAt(0) === '?' ? search.slice(1) : search;
    var segs = body.split('&');
    var rest = [], hit = false;
    for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (!hit && s.slice(0, SHARE_PARAM.length + 1) === SHARE_PARAM + '=') { hit = true; continue; }
        if (s !== '') rest.push(s);
    }
    if (!hit) return { search: search, hit: false };
    return { search: rest.length ? '?' + rest.join('&') : '', hit: true };
}

// ── 拼链接（base / hash 由调用方给，保持本文件与 DOM、location 无关）────────
function shareBuildUrl(scope, expMs, routeHash, base, allowSel) {
    var token = shareEncode(shareBuildPayload(scope, expMs, allowSel));
    return String(base || '') + '?' + SHARE_PARAM + '=' + token + '#' + String(routeHash || '');
}
