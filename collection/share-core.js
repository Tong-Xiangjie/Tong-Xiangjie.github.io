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
// ★ 字段名以 router.js 的 parseRoute 实际返回为准：分类树板块是 categoryId，
//   专题是 configId/groupId —— **没有** catId/subId 这两个字段（写了会静默退化，
//   范围会大出一整块，等于多放行一大片）。
function shareScopeOf(route) {
    if (!route || !route.mode) return '';
    if (route.mode === 'special') return route.configId ? 'special/' + route.configId : 'special';
    if (route.mode === 'articles') return 'articles';
    if (route.mode === 'settings') return 'settings';
    return route.categoryId ? route.mode + '/' + route.categoryId : route.mode;
}

// 前缀匹配必须落在 '/' 边界上：notes/rmb3 放行 notes/rmb3 与 notes/rmb3/s1/v1.0，
// 但**不放行** notes/rmb3x / notes/rmb4 / notes。hash 里可能还挂着 &k= 之类，先切掉。
function shareScopeMatch(scope, hash) {
    var clean = function (s) {
        return String(s || '').replace(/^#/, '').split('&')[0].replace(/^\/+/, '').replace(/\/+$/, '');
    };
    var h = clean(hash), p = clean(scope);
    if (!p) return false;
    if (h === p) return true;
    return h.slice(0, p.length + 1) === p + '/';
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

function shareBuildPayload(scope, expMs) {
    var payload = { p: String(scope || '') };
    if (expMs) payload.e = Math.floor(expMs);
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
        return o;
    } catch (e) { return null; }
}

// ── 校验：格式 / 有效期 / 范围 三件事 ───────────────────────────────────────
// 返回值带 reason，便于门禁给出区分的日志（badformat / expired / outofscope）。
function shareCheck(token, hash, nowMs) {
    var payload = shareDecode(token);
    if (!payload) return { ok: false, reason: 'badformat' };
    var now = (typeof nowMs === 'number') ? nowMs : Date.now();
    if (payload.e && now > payload.e) return { ok: false, reason: 'expired', payload: payload };
    if (!shareScopeMatch(payload.p, hash)) return { ok: false, reason: 'outofscope', payload: payload };
    return { ok: true, payload: payload };
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
function shareBuildUrl(scope, expMs, routeHash, base) {
    var token = shareEncode(shareBuildPayload(scope, expMs));
    return String(base || '') + '?' + SHARE_PARAM + '=' + token + '#' + String(routeHash || '');
}
