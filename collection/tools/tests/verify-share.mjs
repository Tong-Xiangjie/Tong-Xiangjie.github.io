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
// ⑤c 用的短别名（不动上面那组名字，避免碰到已有断言）
const sbEncode = encode, sbDecode = decode, sbCheck = checkToken;

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
    // ★ 本条原来写的是"文章 → 整块 articles"（旧行为：分享一篇 = 放行整个文章区）。
    //   用户要求精确到篇/小板块后，这里改成新语义：带序号 ⇒ 精确到那一篇。
    check(scopeOf({ mode: 'articles', articleIndex: 12 }) === 'articles/12', '文章 → 精确到那一篇（articles/12）');
    check(scopeOf({ mode: 'special', configId: 'shanhe', shanheView: 'list' }) === 'special/shanhe', '山河列表视图 → special/shanhe');
    check(scopeOf(null) === '', '空 route → 空范围（调用方据此禁用复制）');

    // ★★ 分类分支的字段名是 **catId**（router.js:293），不是 categoryId ✗ ——
    //    这条线上真错过一次：只读 categoryId ⇒ 纸币/硬币的 p 退化成整个板块，
    //    "只放行一页"静默失效。两个名字都读，并盯住 router.js 的字段不漂移。
    check(scopeOf({ mode: 'notes', catId: 'rmb3' }) === 'notes/rmb3', '★ 真实字段名 catId → notes/rmb3');
    check(scopeOf({ mode: 'coins', catId: 'commemorative_coins' }) === 'coins/commemorative_coins', '★ 硬币也要带分类，不能塌成 coins');
    check(scopeOf({ mode: 'notes', categoryId: 'rmb3' }) === 'notes/rmb3', 'categoryId 也认（文章分支用的就是它）');
    const ROUTER = read('collection/router.js');
    const routerCatId = /catId:\s*safeDecode\(rest\[0\]\)/.test(ROUTER);
    check(routerCatId && /route\.catId/.test(CORE),
        '★ 漂移守门：router.js 仍返回 catId、share-core.js 仍读它（任何一边改名都会红）');
    check(/configId:\s*parts\.length/.test(ROUTER) && /route\.configId/.test(CORE),
        '专题分支 configId 两边对齐（#special/years → special/years）');
}

section('③ 前缀匹配必须落在 / 边界上');
{
    check(match('notes/rmb3', 'notes/rmb3') === true, '同路径放行');
    check(match('notes/rmb3', 'notes/rmb3/s1/v1.0') === true, '深一层放行（点开系列不失效）');
    check(match('notes/rmb3', '#notes/rmb3/s1/v1.0') === true, '带 # 前缀也认');
    check(match('notes/rmb3', 'notes/rmb3/s1/v1.0&k=xxx') === true, 'hash 里残留 &k= 时先切掉再比');
    check(match('notes/rmb3', 'notes/rmb3x') === false, '★ rmb3x 不放行（不能靠字符串前缀蒙混）');
    check(match('notes/rmb3', 'notes/rmb4') === false, '别的分类不放行');
    // ★ 用户要求「可以看概览页，但只显示部分数据」⇒ 范围的**祖先路由**（板块概览 notes、
    //   父分组 notes/rmb）要放行；内容那半由应用层过滤兜住（范围外的藏品直接不渲染）。
    //   但只有"沿范围往上、且落在 / 边界上"的才算祖先 —— 兄弟分类、非边界前缀仍不放行。
    check(match('notes/rmb3', 'notes') === true, '板块概览放行（能看概览，内容由应用层裁）');
    check(match('notes/rmb/rmb3', 'notes/rmb') === true, '父分组概览放行（回概览要走这条路）');
    check(match('notes/rmb/rmb3', 'notes/rmb/rmb3') === true, '自己当然放行');
    check(match('notes/rmb/rmb3', 'notes/rmb/rmb4') === false, '兄弟子分类不放行');
    check(match('notes/rmb/rmb3', 'notes/rm') === false, '非边界前缀（notes/rm）不算祖先');
    check(match('notes/rmb/rmb3', 'coin') === false, '别的板块不算祖先');
    // ★ 用户要求「搜索功能打开，但只在展示的部分内搜索」⇒ 本板块的 search 路由要放行，
    //   否则结果算得出来、视图却切不过去（什么都看不到）。安全性靠 search.js 那份过滤。
    check(match('notes/rmb/rmb3', 'notes/search/人民币') === true, '本板块的搜索路由放行');
    check(match('notes/rmb/rmb3', 'notes/search') === true, '空关键词的搜索路由也放行');
    check(match('notes/rmb/rmb3', 'coins/search/x') === false, '别的板块的搜索路由不放行');
    check(match('notes/rmb/rmb3', 'notes/rmb/rmb3/search/x') === true, '范围内路径下的 search 段本来就合法（前缀规则放行）');
    check(match('', 'notes/rmb3') === false, '空范围一律不放行');
    // ★ 文章分享精确到"篇 / 小板块"（原来 shareScopeOf 对 articles 写死返回 'articles'
    //   ⇒ 分享一篇文章等于把整个文章区都放行；用户要求收窄）。
    check(scopeOf({ mode: 'articles', articleIndex: -1, categoryId: null }) === 'articles', '文章板块（全部分类）→ articles');
    check(scopeOf({ mode: 'articles', articleIndex: 12, categoryId: null }) === 'articles/12', '某一篇 → articles/12（精确到篇）');
    check(scopeOf({ mode: 'articles', articleIndex: -1, categoryId: 'water' }) === 'articles/c-water', '小板块 → articles/c-water');
    check(scopeOf({ mode: 'articles', articleIndex: 12, categoryId: 'water' }) === 'articles/12/c-water',
        '小板块里的某一篇 → 序号在前、c- 在后（必须是 hash 的前缀）');
    check(match('articles/12', 'articles/12') === true && match('articles/12', 'articles/13') === false,
        '只放行那一篇，别的篇不放行');
    check(match('articles/c-water', 'articles/c-water') === true && match('articles/c-water', 'articles/c-ink') === false,
        '只放行那个小板块，兄弟小板块不放行');
    check(match('articles/12', 'articles/12/q-水印/sm-title') === true,
        '该篇里的搜索状态（q-/sm- 段排在后面）不影响放行');
    check(match('articles/c-water', 'articles/12') === false, '小板块范围不放行"不带分类"的裸篇号');
    check(match('articles/12', 'articles') === true, '板块列表仍可看（祖先放行），别篇会被锁灰/点不动');
}

section('④ 校验：格式 / 有效期 / 范围');
{
    const now = 1767225600000;                       // 固定"现在"，避免依赖真实时钟
    const future = { p: 'notes/rmb3', e: now + 86400e3, i: 'aa11bb22' };
    const noExp = { p: 'notes/rmb3', i: 'aa11bb22' };
    const past = { p: 'notes/rmb3', e: now - 10 * 60e3, i: 'aa11bb22' };
    const justPast = { p: 'notes/rmb3', e: now - 60e3, i: 'aa11bb22' };
    const wrong = { p: 'notes/rmb4', e: now + 86400e3, i: 'aa11bb22' };

    let r = checkToken(encode(future), 'notes/rmb3/s1/v1.0', now);
    check(r.ok === true, '未过期 + 范围内 → 放行');
    r = checkToken(encode(past), 'notes/rmb3', now);
    check(r.ok === false && r.reason === 'expired', '★ 过期 → 拒绝（reason=expired）', r.reason);
    // ★ 时钟宽限：收件人本机时间比发送方快几分钟是常态，没有宽限的话"1 小时"档
    //   可能刚发出就打不开（用户反馈的"有时看不了"）。但宽限要按令牌本来的生命期算：
    //   固定 5 分钟会把"自定义 1 分钟"这种短档整个吞掉（用户实测的 bug）。
    const hourAgo = { p: 'notes/rmb3', s: now - 3600e3, e: now - 60e3, i: 'x' };   // 1 小时档，过期 1 分钟
    const gracePayload = encode(hourAgo);
    r = checkToken(gracePayload, 'notes/rmb3', now);
    check(r.ok === true, '1 小时档刚过期 1 分钟 ⇒ 仍在按生命期算的宽限内 → 放行');
    const minAgo = { p: 'notes/rmb3', s: now - 60e3, e: now - 10e3, i: 'x' };      // 1 分钟档，过期 10 秒
    r = checkToken(encode(minAgo), 'notes/rmb3', now);
    check(r.ok === false && r.reason === 'expired', '★ 1 分钟档过期 10 秒 ⇒ 拒绝（宽限只有 3 秒）', r.reason);
    r = checkToken(encode(justPast), 'notes/rmb3', now);
    check(r.ok === false && r.reason === 'expired',
        '★ 签发时就已过期的令牌 ⇒ 拒绝（不再被固定 5 分钟宽限救活）', r.reason);
    check(sandbox.SHARE_CLOCK_GRACE_MS === 5 * 60e3, '宽限上限仍是 5 分钟（长档最多多活 5 分钟）');
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

section('⑤b hash 形态令牌 + "深链丢了"的判断');
{
    const { shareFromHash: fromHash, shareStripHash: stripHash, shareLooksLikeRoute: looks } = sandbox;
    check(fromHash('#notes/rmb3&share=ABC') === 'ABC', '从 hash 里也能取出 share=（客户端把 query 挪到 # 之后）');
    check(fromHash('#notes/rmb3') === '', 'hash 里没有 share 时返回空串');
    const st = stripHash('#notes/rmb3&share=ABC');
    check(st.hit === true && st.hash === '#notes/rmb3', `摘掉后 hash 仍是合法深链（${st.hash}）`);
    check(stripHash('#notes/rmb3').hit === false, '没有 share 就原样返回、hit=false');
    check(looks('notes/rmb3') === true && looks('special/years/shanhe') === true, '认得出站内路由');
    check(looks('wechat_redirect') === false && looks('') === false && looks('notesx') === false,
        '★ 客户端塞的锚点 / 空 / 形近词都不算路由（按"深链丢了"处理）');
    const COREJS = read('collection/core.js');
    const modesBlock = (/MODE_URL_SEGMENTS\s*=\s*\{[\s\S]*?\n\s*\}/.exec(COREJS) || [''])[0];
    check(['notes', 'coins', 'special', 'articles', 'settings'].every(m => modesBlock.includes(m)),
        '★ 漂移守门：SHARE_MODES 的 5 个板块名在 core.js 的 MODE_URL_SEGMENTS 里都有');
}

section('⑤c 单张 / 选定多张（选择段白名单 a）');
{
    const { shareSelSig: sig, shareScopeMatch: match3 } = sandbox;
    const M = (s, h, a) => match3(s, h, a);
    // 用户给的例子：file:///…/index.html#notes/commemorative/s0,4,8 就是在"纪念钞"里选了 3 张
    check(sig('#notes/commemorative/s0,4,8') === 's0,4,8', '从路由里取出选择段签名（s0,4,8）');
    check(sig('#notes/commemorative/s0,8,4') === 's0,4,8', '★ 段内排序归一化：s0,8,4 与 s0,4,8 视为同一组');
    check(sig('#notes/commemorative') === '', '没有选择段 ⇒ 空签名（= 列表页）');
    check(sig('#coins/x/s1/v2.0') === 's1|v2.0', 's 与 v 段一起出现时都能取到');

    const P = 'notes/commemorative';
    check(M(P, '#notes/commemorative/s0,4,8', 's0,4,8') === true, '选中的这几张 ⇒ 放行');
    check(M(P, '#notes/commemorative', 's0,4,8') === true, '★ 所在列表页 ⇒ 放行（用户定稿：能看列表）');
    check(M(P, '#notes/commemorative/s1', 's0,4,8') === false, '★ 点开别的那一张 ⇒ 拒绝');
    // ★ 子集语义（用户实测 C 的 bug：全等判定下"打开其中一张"会被拨回，那几张反而点不开）
    check(M(P, '#notes/commemorative/s0', 's0,4,8') === true, '★ 列表里点开白名单里的某一张 ⇒ 放行（子集）');
    check(M(P, '#notes/commemorative/s4,8', 's0,4,8') === true, '★ 其中几张的组合 ⇒ 放行');
    check(M(P, '#notes/commemorative/s0/v0.1', 's0,4,8') === true, '★ 进到白名单某一张的图片 ⇒ 放行');
    check(M(P, '#notes/commemorative/s0,4,9', 's0,4,8') === false, '★ 掺进白名单外的系列 ⇒ 拒绝');
    check(M(P, '#notes/commemorative/s0,4', 's0,4,8') === true, '少选一张（子集）⇒ 放行');
    check(M(P, '#notes/other/s0,4,8', 's0,4,8') === false, '别的分类照旧被前缀挡掉');
    check(M(P, '#notes/commemorative/s1', '') === true, '没有 a 时行为逐条不变（老链接向后兼容）');
    check(M('notes', '#notes/commemorative/s1') === true, '板块级分享不受选择段影响');

    const t = encode(buildPayload(P, 0, 's0,4,8'));
    check(decode(t).a === 's0,4,8', 'payload 里带上 a（生成 → 解码一致）');
    check(checkToken(t, '#notes/commemorative/s0,4,8', 0).ok === true, 'shareCheck 认这一组选中项');
    check(checkToken(t, '#notes/commemorative/s1', 0).reason === 'outofscope', '★ shareCheck 会把"改成别的张"判成越界');
    check(checkToken(encode(buildPayload(P, 0, 's0,4,8')), '#notes/commemorative', 0).ok === true, 'shareCheck 对列表页放行');

    // 子分类也要收进范围（否则从子分类分享出去会静默放宽到整个分类）
    check(scopeOf({ mode: 'notes', catId: 'rmb3', subId: 's2' }) === 'notes/rmb3/s2', '★ 带 subId 时范围收到子分类');
    check(scopeOf({ mode: 'notes', catId: 'rmb3', subId: null }) === 'notes/rmb3', '没有 subId 时仍是分类');
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
    // 注意：两个门禁脚本现在带版本戳（src="./share-core.js?v=<内容哈希>"），
    // 所以只比到文件名，不要带结尾引号。
    const iCore = block.indexOf('src="./share-core.js');
    const iGate = block.indexOf('src="./gate.js');
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
    check(ids.every(id => SHARE.includes(`id: '${id}'`)), '六个档位齐全：1 小时 / 1 天 / 7 天 / 30 天 / 自定义 / 永久');
    check(/label: '永久'/.test(SHARE) && /ms: -1/.test(SHARE),
        '★ 第六档文案是「永久」（机制没变：ms=-1 ⇒ 不写 e，靠轮换站点令牌撤销）');
    check(/SHARE_DEFAULT_TIER = 'd1'/.test(SHARE), '默认档是 1 天');
    check(/ms: 3600e3/.test(SHARE) && /ms: 86400e3/.test(SHARE) && /ms: 7 \* 86400e3/.test(SHARE) && /ms: 30 \* 86400e3/.test(SHARE),
        '四档毫秒值与约定一致（3600e3 / 86400e3 / 7*86400e3 / 30*86400e3）');
    // ★ 自定义时间改成自己画的月历 + 时分步进：原生 datetime-local 在深色模式下会变白、
    //   样式不受控。断言时**先剥掉行注释**——文件里那句"为什么不用 <input type=
    //   datetime-local>"的说明本身就会误伤正则（这个坑踩过一次了）。
    const SHARE_CODE = SHARE.replace(/^\s*\/\/.*$/gm, '');
    check(!/<input type="datetime-local"/.test(SHARE_CODE), '自定义档不再用原生 datetime-local（改成自绘控件）');
    check(/share-cal-grid/.test(SHARE) && /shareCalRender/.test(SHARE), '自绘月历：有日历网格与渲染函数');
    // ★ 用户要求：时/分改成下拉栏（不要 +/- 步进）；日历时间选择做成独立的第二个弹窗；
    //   日期格永远 5 行（4 行/6 行的月份高度也必须一样）；链接栏不可拉伸；年/月各一个下拉。
    check(/id="shareHour"/.test(SHARE) && /id="shareMin"/.test(SHARE) && /shareHourOpts/.test(SHARE) && /shareMinOpts/.test(SHARE) && !/data-step=/.test(SHARE),
        '时/分改成下拉栏（24 / 60 项），不再有 +/- 步进按钮');
    check(/share-sub-mask/.test(SHARE) && /id="sharePickMask"/.test(SHARE) && /sharePickShow/.test(SHARE) && /sharePickHide/.test(SHARE),
        '日历时间选择是独立的第二个弹窗（取消会回滚）');
    check(/SHARE_CAL_ROWS = 5/.test(SHARE) && /days\.slice\(cap\)\.concat\(days\.slice\(over, cap\)\)/.test(SHARE),
        '日期格固定 5 行：6 行的月份把多出的格子平移到第一行（占掉第一行的空位）');
    check(/shareCalYear/.test(SHARE) && /shareCalMonth/.test(SHARE) && /share-cal-sel/.test(SHARE),
        '年、月各有一个下拉栏');
    check(/\.share-link\{[^}]*resize:none/.test(SHARE), '链接展示栏不可拉伸（resize:none）');
    check(/用户要求：快捷键打开时\*\*什么都不选中\*\*/.test(SHARE) && !/shareCopy'\)\.focus\(\)/.test(SHARE),
        '快捷键打开时不选中任何东西（不再把焦点丢给「复制链接」）');
    check(/链接失效时间不能早于当前系统时间/.test(SHARE) && /btn\.disabled = true/.test(SHARE),
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
        '门禁读 ?share=（shareStripQuery 用来算"摘掉 k 之后"的那份 query，据此取出令牌）');
    check(/function tryShareOrDeny\(/.test(GATE) && /shareCheck\(shareTok, location\.hash, Date\.now\(\)\)/.test(GATE),
        '用 share-core.js 的 shareCheck 判"格式/有效期/范围"');
    check(/function readShareRec\(/.test(GATE) && /sessionStorage\.getItem\(SHARE_SESSION_KEY\)/.test(GATE),
        '会话状态放 **sessionStorage**（关标签页即失效）');

    const allowShare = pull('allowShare');
    check(allowShare.length > 0 && !/localStorage/.test(allowShare),
        '★ 分享放行**不写** localStorage 全站标记（那是 k= 的待遇）');
    check(/sessionStorage\.setItem\(SHARE_SESSION_KEY/.test(allowShare), '只在 sessionStorage 记一条会话');

    const watch = pull('watchShareScope');
    check(/addEventListener\('popstate', onScope, true\)/.test(watch) && /addEventListener\('hashchange', onScope, true\)/.test(watch),
        '★ 守门同时听 popstate 与 hashchange、都在**捕获阶段**：改 fragment 时浏览器先派发 popstate，router.js 正是在那一阶段把不认识的路由当场归一化掉');
    const guard = watch.slice(watch.indexOf('shareScopeMatch(rec.p, location.hash, rec.a)) return;'));
    check(/denyShare\('outofscope'\)/.test(guard),
        '★ 越界（手改深链/后退）⇒ 直接给"被挡页面"，不再拨回：用户实测地址被拨回时应用已按旧 hash 渲染过，等于能卡进「我的」');
    check(!/history\.replaceState/.test(guard) && !/shareToast\(/.test(watch),
        '★ 守门里不再保留"拨回地址 + 提示"那套（那套只留给 syncRoute 那层，用于站内点击）');
    check(/shareHashIsLostDeepLink/.test(watch),
        '空 hash（深链被删）与客户端改写的锚点（#wechat_redirect 之类）不算越界：落到范围首页即可');

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
    check(/lostDeepLink/.test(denyFn) && /!bareHash/.test(denyFn) && /history\.replaceState/.test(denyFn),
        '★ hash 被客户端吃掉（空 hash）时把深链补回范围首页再放行，而不是直接拒绝');

    // ★★ 管理员与分享必须分开、且分享优先（用户明确要求：
    //    管理员点开过期的分享链接也看不到；管理员也不该越出分享范围）。
    const iShareTok = GATE.indexOf('if (shareTok) { tryShareOrDeny(');
    const iStored = GATE.indexOf('if (stored) { allow(stored); return; }');
    check(iShareTok > 0 && iStored > 0 && iShareTok < iStored,
        '★ 分享令牌的判定排在"本机管理员标记"**之前**（否则管理员会被自己的标记放过）',
        `share@${iShareTok} stored@${iStored}`);
    const iRec = GATE.indexOf('var shareRec = readShareRec();');
    check(iRec > 0 && iRec < iStored,
        '★ 分享会话（sessionStorage）也优先于管理员标记（管理员刷新不许跑出范围）');
    check(/if \(shareRec\.e && Date\.now\(\) > shareRec\.e\) \{[\s\S]{0,120}denyShare\('expired'\)/.test(GATE),
        '★ 会话过期 ⇒ 拒绝（管理员同样被拒，不会因为本地标记放行）');
    // ★ 这里必须用字符串包含而不是正则：文案里有 (´･_･`) 这种括号，塞进正则会变成分组。
    check(/function hasAdminMark\(/.test(GATE)
        && GATE.includes("shareToast('当前页面暂未开放分享哦(´･_･`)', hasAdminMark())"),
        '管理员被困在分享范围时有「退出分享模式」出口（清会话记录后重载）');
    check(/sessionStorage\.removeItem\(SHARE_SESSION_KEY\)/.test(GATE),
        '退出分享模式 = 清掉本标签页的会话记录');

    // ── 审计确认的三条"有时看不了"根因（都已核实是我这边的真问题）──
    check(/shareFromHash\(location\.hash\)/.test(GATE) && /shareStripHash\(/.test(GATE),
        '★ share 也有 hash 兜底（客户端把 query 丢到 # 之后，或整段重排时仍能取到令牌）');    check(/shareLooksLikeRoute\(bareHash\)/.test(GATE) && /lostDeepLink/.test(GATE),
        '★ fragment 被改写成 #wechat_redirect 这类锚点时按"深链丢了"放行，而不是硬拒');
    check(/\+ SHARE_PARAM \+ '=' \+ shareTok/.test(GATE),
        '★ 拒绝前把令牌放回地址栏（摘参数在判定之前，不补回来刷新就没法重试）');
    check(/sessionStorage\.removeItem\(SHARE_SESSION_KEY\)/.test(pull('allow')),
        '★ 用 k= 明确登录一次即结束分享模式（否则管理员在同一标签点主令牌链接会被拨回分享页）');
    const SHARE_SRC = read('collection/share.js');
    check(SHARE_SRC.includes('function shareBaseUrl(') && SHARE_SRC.includes(".replace(/index\\.html?$/i, '')"),
        '生成链接的 base 剥掉 index.html（从 /collection/index.html 打开也生成目录链接）');

    // ★ 用户要求：弹窗里那些说明文字全部删掉（档位只留名字）。
    check(!/hint:/.test(SHARE_SRC) && !/<small>/.test(SHARE_SRC),
        '★ 档位说明（"随手发一下 / 你抽空看看"这类）已全部删除，只留档位名');
    check(!/范围内可自由浏览|软限制|挡回分享页/.test(SHARE_SRC),
        '★ 弹窗里那段"范围内可自由浏览…有效期由浏览器判定"的说明也已删除');

    // ★ 用户要求：弹窗要适配黑夜模式。
    //   变量名必须用站点真实的那套（layout.css: --card-bg/--text/--border/--text-secondary）；
    //   写成 --bg-card 会一直取兜底 #fff ⇒ 深色下弹窗还是白的。
    check(SHARE_SRC.includes('background:var(--card-bg,#fff)') && !/var\(--bg-card/.test(SHARE_SRC),
        '★ 弹窗底色走站点真实的 --card-bg（深色模式下自动变深）');
    check(/html\[data-color-scheme="dark"\] \.share-mask/.test(SHARE_SRC)
        && /html\[data-color-scheme="dark"\] \.share-exp\.bad/.test(SHARE_SRC),
        '★ 有 html[data-color-scheme="dark"] 分支（遮罩更实、过期那句换成深底上够亮的红）');
    check(/@media \(prefers-color-scheme: dark\)/.test(SHARE_SRC) && /html:not\(\[data-color-scheme="light"\]\)/.test(SHARE_SRC),
        '主题还没跑起来时按系统偏好兜一层（且不覆盖用户显式选的浅色）');

    // ★ 用户两条定稿：share 必须一直留在地址栏；分享页标题是"铜の币纪主站 | 来自分享"。
    check(!/shareStrip\.search/.test(GATE),
        '★ 不再把 ?share= 从地址栏摘掉（只摘 k）—— 否则同标签开过管理员页后，刷新分享页会变成管理员');
    check(GATE.includes("'?share='") || /SHARE_PARAM \+ '=' \+ shareTok/.test(GATE),
        '被拒时也把 share 放回地址栏（与"一直可见"一致）');
    check(GATE.includes('铜の币纪主站 | 来自分享'),
        '★ 分享模式的标题逐字为「铜の币纪主站 | 来自分享」（文案由用户定稿）');
    check(/new MutationObserver\(/.test(pull('allowShare')),
        '标题有人守：站内视图改写 document.title 后会被改回分享标题');

    // ★ 越界回拨不许重播入场动画（用户要求：点不能看的地方不该像刷新一样再入场一次）。
    const inst = pull('shareInstant');
    check(inst.length > 0 && /animation:none !important/.test(inst) && /transition:none !important/.test(inst),
        '★ 回拨期间按住 CSS 动画/过渡（各板块入场动画就是 CSS 动画，重渲染会再播一遍）');
    check(GATE.includes("'gate-share-instant'") && /classList\.add\(SHARE_NOANIM_CLASS\)/.test(inst)
        && /classList\.remove\(SHARE_NOANIM_CLASS\)/.test(inst),
        '按住动画用的是 html 上的临时类，且会自动摘掉（不能一直按住）');
    // ★★ 手改深链的兜底：不看事件、只看地址栏（CDP 实测：router.js 会抢先把非法路由
    //   replaceState 归一化掉，靠 hashchange 只能挡住它不认得的那部分）。
    check(/history\[name\]/.test(GATE) && /'replaceState', 'pushState'/.test(GATE) && /__gateShareHistoryWatched/.test(GATE),
        '★ 包住 history.replaceState / pushState：谁往地址栏写范围外的 hash 就直接给拒绝页，且这次写入不执行');
    check(/__gateShareArmed/.test(GATE),
        '拦写入前先"见过一次合法地址"（__gateShareArmed）—— 站内启动期的中间态路由不能误判成越界');
    check(/shareScopeMatch\(r\.p, hh, r\.a\)/.test(GATE) && /setInterval\(function \(\) \{\s*var r = shareRecNow\(\);/.test(GATE),
        '★ 另外还有 500ms 心跳直接盯 address bar（与事件顺序、与"是谁写的"都无关）');
    check(pull('watchShareNavigation').indexOf('shareInstant();') > 0,
        '★ syncRoute 收口：站内点击越界时先按住动画再拨回（这条路径保留，用于点击而不是手改地址）');

    // ★ 用户实测 A/B：「我的」这类入口是普通 <a href>，浏览器直接换页 ⇒ 刷新一次。
    //   必须"先判断再决定放不放走"，而且要在 window 捕获阶段（比 document 捕获更早）。
    const GATE_SRC = read('collection/gate.js');
    const GATE_IDX_SHARE_TAG = GATE_SRC.indexOf('shareBlockReshare');
    const GATE_IDX_SHAREJS_TAG = GATE_SRC.length;   // gate.js 内部无所谓，加载顺序看 index.html
    const HTML_SRC = read('collection/index.html');
    check(HTML_SRC.indexOf('gate.js?v=') < HTML_SRC.indexOf('share.js'),
        'index.html 里 gate.js 排在 share.js 之前（Ctrl+Shift+S 的拦截才能先注册）');
    const clickGuard = pull('shareBlockClick');
    check(/window\.addEventListener\('click', shareBlockClick, true\)/.test(GATE)
        && /window\.addEventListener\('pointerdown', shareBlockClick, true\)/.test(GATE)
        && /window\.addEventListener\('mousedown', shareBlockClick, true\)/.test(GATE),
        '★ 在 window 捕获阶段拦 pointerdown/mousedown/click（有入口在更早的阶段就跳走了）');
    check(/e\.preventDefault\(\)/.test(clickGuard) && /stopImmediatePropagation/.test(clickGuard)
        && /shareScopeMatch\(rec\.p, target, rec\.a\)/.test(clickGuard),
        '★ 越界点击整条按死：页面不动、地址栏不动、不刷新');
    check(/e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/.test(clickGuard)
        && /target'\) === '_blank'/.test(clickGuard),
        '新标签打开（修饰键 / target=_blank）不拦，交还浏览器');
    check(/u\.pathname !== location\.pathname/.test(GATE),
        '★ 换到站内另一个页面也算越界（分享的是这一套 SPA）');
    // ★ 用户要求"把点不了的按键锁住"：越界的链接灰掉 + 禁点
    check(/gate-share-locked/.test(GATE) && /cursor:not-allowed/.test(GATE)
        && /document\.querySelectorAll\(SHARE_LOCK_SEL\)/.test(pull('shareLockAnchors')),
        '★ 分享模式下把越界的入口灰掉（.gate-share-locked / not-allowed）');
    // ★ 用户实测"我的"锁不住：它不是 a[href]。改成按元素上的路由线索判断，并且
    //   只认"像站内路由"的值（多段路径，或正好是站点模式名），免得把页面自己的 UI 锁坏。
    check(/a\[href\],\[data-mode\],\[data-route\]/.test(GATE)
        && /SHARE_MODES\.indexOf\(v\.split\('\/'\)\[0\]\)/.test(GATE),
        '★ 无 href 的入口（data-mode/data-route…）也纳入判定，且只认真正的路由值');
    check(/new MutationObserver\(/.test(pull('SHARE_LOCK_SEL')) === false && /new MutationObserver\(/.test(GATE),
        '★ 盯着 DOM 变化：晚渲染出来的导航也会被锁（1.2s/2.6s 定时扫会漏）');
    check(/shareLockAnchors\(\)/.test(pull('watchShareNavigation')) && /setTimeout\(shareLockAnchors/.test(GATE),
        '每次路由变化后重算一次，另外首屏异步渲染后补扫两次');
    // ★ 用户要求：分享链接不能再被分享
    check(/window\.addEventListener\('pointerup', shareBlockClick, true\)/.test(GATE)
        && /window\.addEventListener\('mouseup', shareBlockClick, true\)/.test(GATE)
        && /window\.addEventListener\('touchstart', shareBlockClick, true\)/.test(GATE),
        '★ 指针全阶段都拦（用户实测"等更长时间才刷新" ⇒ 有入口绑在 pointerup/mouseup 上）');
    check(/\.gate-share-locked\{[^}]*pointer-events:none !important/.test(GATE)
        && /\.gate-share-locked \*\{pointer-events:none !important/.test(GATE),
        '★ 越界链接直接 pointer-events:none（浏览器根本不把事件交给它，连它子元素一起锁）');

    // ★ 时钟宽限必须按生命期算（用户实测：自定义 1 分钟的链接过期后还能开）
    const graceMs = sandbox.shareGraceMs;
    check(graceMs({ e: 1, s: 0 }) === 30000, '老令牌（没写签发时刻）⇒ 30 秒');
    check(graceMs({ e: 60000, s: 0 + 1 }) === 3000, '★ 1 分钟档 ⇒ 只给 3 秒（原来固定 5 分钟把它吞了）');
    check(graceMs({ e: 3600000, s: 1 }) === 180000, '1 小时档 ⇒ 3 分钟');
    check(graceMs({ e: 86400000, s: 1 }) === 300000, '1 天档 ⇒ 顶到 5 分钟');
    check(graceMs({ e: 0, s: 0 }) === 0 && graceMs(null) === 0, '不设过期（跟随站点令牌）⇒ 无宽限');
    check(sandbox.shareEncode(sandbox.shareBuildPayload('notes/x', 60000)).length > 0
        && sandbox.shareDecode(sandbox.shareEncode(sandbox.shareBuildPayload('notes/x', 60000))).s > 0,
        '★ 生成的令牌带上签发时刻 s（宽限才能按生命期算）');
    check(/window\.addEventListener\('keydown', shareBlockReshare, true\)/.test(GATE)
        && /if \(!shareRecNow\(\)\) return;/.test(pull('shareBlockReshare')),
        '★ 分享模式下 Ctrl+Shift+S 被吃掉（分享链接不能再分享）');
    // 生效还依赖"gate.js 先于 share.js 注册同一个 keydown"，静态确认一下加载顺序。
    check(HTML_SRC.indexOf('gate.js?v=') < HTML_SRC.indexOf('share.js'),
        'gate.js 的脚本标签排在 share.js 之前（同级同阶段：先注册先执行）');

    // 档位按钮文字居中（用户要求）
    check(/\.share-tier\{[^}]*text-align:center/.test(SHARE_SRC), '★ 档位按钮文字居中');

    // ★★ 分享被拒必须用**专属页面**，不能复用"暂无访问权限 + 输入通行密钥"那页
    //    （用户明确要求：不应该用通用的那个）。收分享链接的人手里没有密钥，
    //    给输入框只会误导；而且"过期"和"范围外"是两种要说清楚的不同原因。
    check(/function denyShare\(/.test(GATE) && /denyShare\(r\.reason\)/.test(GATE),
        '★ 分享被拒走 denyShare()，不再落到通用 deny()');
    check(!/deny\('share-'/.test(GATE), '旧写法 deny(\'share-…\') 已经全部换掉');
    const shareInner = pull('shareDeniedInner');
    check(shareInner.length > 0, 'shareDeniedInner 存在');
    check(!/<input/.test(shareInner) && !/gate-denied-form/.test(shareInner) && !/验证/.test(shareInner),
        '★ 专属页里**没有输入框、没有验证按钮**（收链接的人没有密钥，给了只会误导）');
    // ★ 用户要求：**统一一句**，不分支说明"过期"还是"范围外"。
    const clauses = shareInner.match(/gate-denied-text/g) || [];
    check(clauses.length === 1,
        `★ 只有**一句**提示文案（gate-denied-text 出现 ${clauses.length} 次，应为 1）`);
    check(GATE.includes('分享链接错误或已失效'),
        '★ 这句统一文案同时覆盖"过期"和"范围外"两种原因（文案由用户定稿）');
    check(!/SHARE_DENIED\.(expired|outofscope|badformat)/.test(GATE),
        '没有按原因分支的文案表（原因只写进日志，不写进页面）');
    check(/以管理员身份进入/.test(shareInner) && /href="\.\/"/.test(shareInner),
        '管理员落到这里时有出口（进入全站，靠本机标记；仅在有有效标记时出现）');
    // 通用页一个字都不许动（verify-gate 有逐字断言：暂无访问权限 / 请输入通行密钥 / 验证）
    check(/var DENIED_TEXT = '暂无访问权限'/.test(GATE) && /请输入通行密钥/.test(GATE)
        && /class="gate-denied-form"/.test(GATE),
        '通用拒绝页保持原样（暂无访问权限 + 输入框 + 验证，逐字不变）');
}

console.log('');
if (problems === 0) console.log('✅ 分享令牌（L2）验证全部通过');
else console.log(`⚠ ${problems} 处失败`);
process.exit(problems === 0 ? 0 : 1);
