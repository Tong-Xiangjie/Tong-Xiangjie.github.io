// 分享令牌（L2）验证：把 collection/share-core.js 的真实代码装进 vm 沙箱逐条核对。
// 不写报告文件（route-report.txt 那种往仓库里落文件的做法已经坑过一次），只打印 + 退出码。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

let problems = 0;
function check(cond, label, detail) {
    if (!cond) problems++;
    console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
}
function section(t) { console.log(`\n══════ ${t} ══════\n`); }

const read = (p) => readFileSync(path.join(...p.split('/')), 'utf8');
const CORE = read('collection/share-core.js');

// ---------- 沙箱：share-core.js 是纯函数层（不碰 DOM/location）----------
const sandbox = {
    TextEncoder, TextDecoder, Uint8Array, JSON, Date, Math, isFinite, Number, Object, Array, String, Boolean,
    btoa: (typeof btoa === 'function') ? btoa : undefined,
    atob: (typeof atob === 'function') ? atob : undefined,
    Buffer,
    crypto: globalThis.crypto,
};
sandbox.window = { crypto: globalThis.crypto };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(CORE, sandbox);

const {
    shareB64UrlEncode: enc, shareB64UrlDecode: dec,
    shareScopeOf: scopeOf, shareScopeMatch: match,
    shareBuildPayload: buildPayload, shareEncode: encode, shareDecode: decode,
    shareCheck: checkToken, shareFromQuery: fromQuery, shareStripQuery: stripQuery,
    shareBuildUrl: buildUrl, SHARE_PARAM: PARAM, SHARE_SESSION_KEY: SESSION_KEY,
} = sandbox;

section('① base64url 往返（URL 里不能出现 + / =）');
{
    const s = '{"p":"notes/rmb3","e":1767225600000,"i":"a1b2c3"}';
    check(dec(enc(s)) === s, `ASCII 往返一致（${enc(s).slice(0, 24)}…）`);
    const zh = '{"p":"专题/山河","note":"中文与 emoji 🪙"}';
    check(dec(enc(zh)) === zh, '非 ASCII（中文 + emoji）往返一致');
    const out = enc(zh + s + '####');
    check(!/[+/=]/.test(out), `输出里没有 + / =（长度 ${out.length}）`, out.slice(-6));
    let threw = false;
    let bad = null;
    try { bad = dec('!!!!'); } catch (e) { threw = true; }
    check(!threw && bad === '', '解脏 base64 不抛异常、返回空串（门禁里不能因为脏链接炸掉）');
    check(decode('!!!!') === null, 'shareDecode 对脏串返回 null（统一落到 badformat）');
}

section('② 范围折算：字段名必须用 parseRoute 的真实字段');
{
    check(scopeOf({ mode: 'notes', categoryId: 'rmb3' }) === 'notes/rmb3', '分类树板块 → notes/rmb3');
    check(scopeOf({ mode: 'coins', categoryId: 'commemorative_coins' }) === 'coins/commemorative_coins', '硬币分类');
    check(scopeOf({ mode: 'notes', categoryId: null, view: 'overview' }) === 'notes', '板块总览 → 只有板块名');
    check(scopeOf({ mode: 'special', configId: 'denom', groupId: '10000元' }) === 'special/denom', '专题 → 到 configId 为止（不写子类）');
    check(scopeOf({ mode: 'articles', articleIndex: 12 }) === 'articles', '文章 → 整块 articles');
    check(scopeOf({ mode: 'special', configId: 'shanhe', shanheView: 'list' }) === 'special/shanhe', '山河列表视图 → special/shanhe');
    check(scopeOf(null) === '', '空 route → 空范围（调用方据此禁用复制）');
}

section('③ 前缀匹配必须落在 / 边界上');
{
    check(match('notes/rmb3', 'notes/rmb3') === true, '同路径放行');
    check(match('notes/rmb3', 'notes/rmb3/s1/v1.0') === true, '深一层放行（点开系列不失效）');
    check(match('notes/rmb3', '#notes/rmb3/s1/v1.0') === true, '带 # 前缀也认');
    check(match('notes/rmb3', 'notes/rmb3/s1/v1.0&k=xxx') === true, 'hash 里残留 &k= 时先切掉再比');
    check(match('notes/rmb3', 'notes/rmb3x') === false, '★ rmb3x 不放行（不能靠字符串前缀蒙混）');
    check(match('notes/rmb3', 'notes/rmb4') === false, '别的分类不放行');
    check(match('notes/rmb3', 'notes') === false, '更浅的路径不放行');
    check(match('', 'notes/rmb3') === false, '空范围一律不放行');
}

section('④ 校验：格式 / 有效期 / 范围');
{
    const now = 1767225600000;                       // 固定"现在"，避免依赖真实时钟
    const future = { p: 'notes/rmb3', e: now + 86400e3, i: 'aa11bb22' };
    const noExp = { p: 'notes/rmb3', i: 'aa11bb22' };
    const past = { p: 'notes/rmb3', e: now - 1000, i: 'aa11bb22' };
    const wrong = { p: 'notes/rmb4', e: now + 86400e3, i: 'aa11bb22' };

    let r = checkToken(encode(future), 'notes/rmb3/s1/v1.0', now);
    check(r.ok === true, '未过期 + 范围内 → 放行');
    r = checkToken(encode(past), 'notes/rmb3', now);
    check(r.ok === false && r.reason === 'expired', '★ 过期 → 拒绝（reason=expired）', r.reason);
    r = checkToken(encode(noExp), 'notes/rmb3', now);
    check(r.ok === true, '不写 e（跟随站点令牌）→ 不放过期，只看范围');
    r = checkToken('这不是令牌', 'notes/rmb3', now);
    check(r.ok === false && r.reason === 'badformat', '垃圾令牌 → badformat', r.reason);
    r = checkToken(encode(wrong), 'notes/rmb3', now);
    check(r.ok === false && r.reason === 'outofscope', '范围不符 → outofscope', r.reason);

    // ★ L2 的已知边界，用例里**明写**成"必然通过"，免得后人以为它能防篡改：
    const forged = { p: 'notes/rmb4', e: 9999999999999, i: 'aa11bb22' };
    r = checkToken(encode(forged), 'notes/rmb4');
    check(r.ok === true, 'L2 不验签：改 p/e 后照样通过（这是设计边界，真防伪在 L3 签名）');
    const reDecoded = decode(enc(JSON.stringify(forged)));
    check(reDecoded.p === 'notes/rmb4' && reDecoded.e === 9999999999999, 'payload 是 base64url 明文，谁都能解开改（同上）');
}

section('⑤ 查询串读写（摘参时不能碰别的参数）');
{
    check(fromQuery('?t=1&share=ABC&z=2') === 'ABC', '从中间取出 share=');
    const st = stripQuery('?t=1&share=ABC&z=2');
    check(st.hit === true && st.search === '?t=1&z=2', `摘掉 share 后其余参数原序保留（${st.search}）`);
    const st2 = stripQuery('?t=1');
    check(st2.hit === false && st2.search === '?t=1', '没有 share 时原样返回且 hit=false');
    const st3 = stripQuery('?share=ABC');
    check(st3.hit === true && st3.search === '', '只有 share 时摘成空串（不是 "?"）');
    check(PARAM === 'share' && SESSION_KEY === 'collection-share', '参数名与会话键就是这两个');
}

section('⑥ 拼链接：query 归门禁、hash 归路由');
{
    const url = buildUrl('notes/rmb3', 1767225600000, 'notes/rmb3/s1/v1.0', 'https://x/collection/');
    const q = url.indexOf('?share='), h = url.indexOf('#');
    check(q > 0 && h > q, `query 在 hash 前面（?share=… 的位置 ${q} < # 的位置 ${h}）`);
    check(/^https:\/\/x\/collection\/\?share=[A-Za-z0-9\-_]+#notes\/rmb3\/s1\/v1\.0$/.test(url),
        '链接形态：{base}?share=<base64url>#<深链>', url.slice(0, 60) + '…');
    check(decode(url.slice(q + 7, h)).p === 'notes/rmb3', '拼出来的令牌能解回同一个范围');
}

section('⑦ 集成守门：脚本顺序与快捷键');
{
    const IDX = read('collection/index.html');
    // ★ 锚点必须落在**门禁块内的 script 标签**上：块里的注释（bootScript / GUARD_STYLE）
    //   本身就写着 "gate.js" 字样，用 indexOf('gate.js') 会命中注释、把顺序判反。
    const block = (/<!-- gate:begin[\s\S]*?<!-- gate:end -->/.exec(IDX) || [''])[0];
    const iCore = block.indexOf('src="./share-core.js"');
    const iGate = block.indexOf('src="./gate.js"');
    const iRouter = IDX.indexOf('src="router.js"');
    const iShare = IDX.indexOf('src="share.js"');
    check(iCore > 0 && iGate > 0 && iCore < iGate,
        '★ index.html：share-core.js **排在 gate.js 之前**（门禁在 head 里同步用它）', `core@${iCore} gate@${iGate}`);
    check(iRouter > 0 && iShare > iRouter, 'share.js 排在 router.js 之后（要用 buildRoute）', `router@${iRouter} share@${iShare}`);

    const SHARE = read('collection/share.js');
    // ★ 这条是"快捷键语义永远等于分享"的保证：捕获阶段 + 先一步 stopPropagation，
    //   否则 toolbox.js:8507（Ctrl+B/I/U/S，不检查 shiftKey）会把 Ctrl+Shift+S 当删除线。
    check(/window\.addEventListener\('keydown', shareShortcutHandler, true\)/.test(SHARE),
        '★ 快捷键在 window **捕获阶段**注册（先于工具箱那层拿到事件）');
    const handler = /function shareShortcutHandler\(e\)[\s\S]*?\n\}/.exec(SHARE);
    check(!!handler, 'shareShortcutHandler 存在');
    const H = handler ? handler[0] : '';
    check(/e\.preventDefault\(\)/.test(H) && /e\.stopPropagation\(\)/.test(H),
        '处理器里 preventDefault + stopPropagation 都在（既不吃浏览器默认行为，也不让工具箱抢）');
    check(/k !== 's'\) return/.test(H) && /e\.shiftKey/.test(H) && /e\.ctrlKey \|\| e\.metaKey/.test(H),
        '只认 Ctrl/Cmd+Shift+S，其它组合一律放过');
    check(/shareDialogEl\) shareCloseDialog\(\); else shareOpenDialog\(\)/.test(H),
        '再按一次是关闭（同一个组合永远只表示分享）');

    const ids = ['h1', 'd1', 'd7', 'd30', 'custom', 'site'];
    check(ids.every(id => SHARE.includes(`id: '${id}'`)), '六个档位齐全：1 小时 / 1 天 / 7 天 / 30 天 / 自定义 / 跟随站点令牌');
    check(/SHARE_DEFAULT_TIER = 'd1'/.test(SHARE), '默认档是 1 天');
    check(/ms: 3600e3/.test(SHARE) && /ms: 86400e3/.test(SHARE) && /ms: 7 \* 86400e3/.test(SHARE) && /ms: 30 \* 86400e3/.test(SHARE),
        '四档毫秒值与约定一致（3600e3 / 86400e3 / 7*86400e3 / 30*86400e3）');
    check(/type="datetime-local" step="60"/.test(SHARE), '自定义档用 datetime-local，粒度到分钟');
    check(/请选一个晚于现在的时间/.test(SHARE) && /btn\.disabled = true/.test(SHARE),
        '自定义选了过去的时间 → 提示并禁用复制（不让发出一个已过期的链接）');
    check(/shareScopeOf\(parseRoute\('#' \+ buildRoute\(\)\)\)/.test(SHARE),
        '★ 范围取自"按下快捷键那一刻的深链"（buildRoute → parseRoute → shareScopeOf）');
}

section('⑧ 集成守门：门禁侧行为');
{
    const GATE = read('collection/gate.js');
    const pull = (name) => {
        const start = GATE.indexOf(`function ${name}(`);
        if (start < 0) return '';
        const open = GATE.indexOf('{', start);
        let depth = 0;
        for (let i = open; i < GATE.length; i++) {
            if (GATE[i] === '{') depth++;
            else if (GATE[i] === '}') { depth--; if (depth === 0) return GATE.slice(start, i + 1); }
        }
        return '';
    };
    check(/shareFromQuery\(/.test(GATE) && /shareStripQuery\(/.test(GATE),
        '门禁读 ?share= 并**同步**摘掉它（与 k= 同一时机）');
    check(/function tryShareOrDeny\(/.test(GATE) && /shareCheck\(shareTok, location\.hash, Date\.now\(\)\)/.test(GATE),
        '用 share-core.js 的 shareCheck 判"格式/有效期/范围"');
    check(/function readShareRec\(/.test(GATE) && /sessionStorage\.getItem\(SHARE_SESSION_KEY\)/.test(GATE),
        '会话状态放 **sessionStorage**（关标签页即失效）');

    const allowShare = pull('allowShare');
    check(allowShare.length > 0 && !/localStorage/.test(allowShare),
        '★ 分享放行**不写** localStorage 全站标记（那是 k= 的待遇）');
    check(/sessionStorage\.setItem\(SHARE_SESSION_KEY/.test(allowShare), '只在 sessionStorage 记一条会话');

    const watch = pull('watchShareScope');
    check(/addEventListener\('hashchange',[\s\S]*?\}, true\)/.test(watch),
        '★ hashchange 守门在**捕获阶段**（早于 router.js 自己挂的那个）');
    const guard = watch.slice(watch.indexOf('shareScopeMatch(rec.p, location.hash)) return;'));
    check(/history\.replaceState/.test(guard) && !/deny\(/.test(guard.replace(/deny\('share-expired'\)/g, '')),
        '★ 越界时用 history.replaceState 拨回 + 提示，**不调用 deny()**（deny 是 document.write，会把 SPA 换掉）');
    check(/这一页不在分享范围内/.test(watch), '越界会给出可见提示（用户知道为什么被拨回）');

    // ★★ 站内导航用的是 history.replaceState（不触发 hashchange），所以光挂 hashchange
    //   等于没挂 —— 用户实测"相当于给了全部的门户密钥"。必须把 syncRoute 也包住。
    const wrapNav = pull('watchShareNavigation');
    check(wrapNav.length > 0 && /window\.syncRoute = function/.test(wrapNav),
        '★ 包住了 window.syncRoute（站内导航的唯一出口）—— 否则收链接的人点侧边栏就能逛全站');
    check(/__gateShareSynced/.test(wrapNav) && /setTimeout\(wrap, 100\)/.test(wrapNav),
        '包装只做一次，并且会等 router.js 加载完（它在文档末尾、gate.js 在 head）');
    check(/applyRoute\('\#' \+ rec\.p\)/.test(wrapNav),
        '越界时连内容一起拨回（侧边栏是"先渲染、再 syncRoute"，只改地址栏会留下越界画面）');
    check(/watchShareNavigation\(\)/.test(watch), 'watchShareScope 里确实去装了这层包装');

    // ★ "有时分享链接看不了"：客户端吃掉 # 之后整段 ⇒ hash 为空 ⇒ 范围校验必然失败。
    const denyFn = pull('tryShareOrDeny');
    check(/reason === 'outofscope' && !bareHash/.test(denyFn) && /history\.replaceState/.test(denyFn),
        '★ hash 被客户端吃掉（空 hash）时把深链补回范围首页再放行，而不是直接拒绝');
}

console.log('');
if (problems === 0) console.log('✅ 分享令牌（L2）验证全部通过');
else console.log(`⚠ ${problems} 处失败`);
process.exit(problems === 0 ? 0 : 1);
