/* ============================================================================
   分享窗口 —— Ctrl+Shift+S
   ----------------------------------------------------------------------------
   · 范围：**按下快捷键那一刻的深链**（buildRoute()）折算成"到分类为止"的前缀，
     窗口里会同时显示「当前深链」和「放行范围」两行，复制前可以核对。
   · 时效：1 小时 / 1 天（默认）/ 7 天 / 30 天 / 自定义到某天某时某分 /
     跟随站点令牌（不写 e，靠 gate.mjs 轮换撤销）。
   · 链接：{origin}{pathname}?share=<payload>#<当前深链>
     —— query 归门禁、hash 归路由（顺序不能反，URL 规范里 query 必须在 hash 前）。

   ★ 快捷键为什么在**捕获阶段**、并且 stopPropagation：
     toolbox.js 的 Ctrl+B/I/U/S 分支**没有检查 shiftKey**（toolbox.js:8507），
     所以工具箱里按 Ctrl+Shift+S 会被它当成「删除线」吃掉。toolbox.js 在保护名单上，
     不去改它；改用 window 捕获阶段注册 —— 捕获比目标/冒泡都早，先一步 stopPropagation，
     事件根本到不了工具箱那层。这样「Ctrl+Shift+S = 分享」在任何界面里语义都成立。
   ============================================================================ */

// 档位（相邻跨度约 ×24 / ×7 / ×4，足够大 ⇒ 用户不用纠结"3 天还是 5 天"）
var SHARE_TIERS = [
    { id: 'h1',     label: '1 小时',        ms: 3600e3,        hint: '随手发一下，看完就完' },
    { id: 'd1',     label: '1 天',          ms: 86400e3,       hint: '今天之内看（默认）' },
    { id: 'd7',     label: '7 天',          ms: 7 * 86400e3,   hint: '你抽空看看' },
    { id: 'd30',    label: '30 天',         ms: 30 * 86400e3,  hint: '给固定的人（小圈子、家人）' },
    { id: 'custom', label: '自定义',        ms: 0,             hint: '自己选到某天某时某分' },
    { id: 'site',   label: '跟随站点令牌',  ms: -1,            hint: '不设过期；换站点令牌即全部作废' }
];
var SHARE_DEFAULT_TIER = 'd1';

var shareDialogEl = null;
var shareTier = SHARE_DEFAULT_TIER;
var shareStyleDone = false;

function shareEnsureStyle() {
    if (shareStyleDone) return;
    shareStyleDone = true;
    var css = [
        '.share-mask{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;}',
        '.share-box{width:min(94vw,560px);max-height:88vh;overflow:auto;background:var(--bg-card,#fff);color:var(--text,#222);border:1px solid var(--border,#ddd);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:18px 18px 14px;font-size:.9rem;}',
        '.share-title{font-size:1.05rem;font-weight:700;margin:0 0 10px;}',
        '.share-row{display:flex;gap:8px;align-items:baseline;margin:4px 0;line-height:1.5;}',
        '.share-k{flex:0 0 auto;color:var(--text-secondary,#666);}',
        '.share-v{flex:1 1 auto;word-break:break-all;font-family:ui-monospace,Consolas,monospace;}',
        '.share-tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:6px;margin:12px 0 6px;}',
        '.share-tier{border:1px solid var(--border,#ddd);border-radius:8px;padding:6px 8px;cursor:pointer;background:transparent;color:inherit;text-align:left;font-size:.85rem;}',
        '.share-tier.on{border-color:var(--theme,#1677ff);box-shadow:inset 0 0 0 1px var(--theme,#1677ff);}',
        '.share-tier small{display:block;color:var(--text-secondary,#666);font-size:.7rem;margin-top:2px;}',
        '.share-custom{margin:6px 0 2px;}',
        '.share-custom input{font:inherit;padding:4px 6px;border:1px solid var(--border,#ddd);border-radius:6px;background:transparent;color:inherit;}',
        '.share-exp{margin:8px 0;color:var(--text-secondary,#666);}',
        '.share-exp.bad{color:#d4380d;}',
        '.share-link{width:100%;box-sizing:border-box;font-family:ui-monospace,Consolas,monospace;font-size:.75rem;padding:6px;border:1px solid var(--border,#ddd);border-radius:6px;background:transparent;color:inherit;resize:vertical;}',
        '.share-acts{display:flex;gap:8px;align-items:center;margin-top:10px;}',
        '.share-btn{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid var(--theme,#1677ff);background:var(--theme,#1677ff);color:#fff;cursor:pointer;}',
        '.share-btn.ghost{background:transparent;color:inherit;border-color:var(--border,#ddd);}',
        '.share-msg{color:var(--text-secondary,#666);}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'shareStyle';
    s.textContent = css;
    document.head.appendChild(s);
}

// 当前深链 / 范围（都以"按下快捷键那一刻"为准）
// ★ 生成链接的 base 一律落到"目录"上。
//   从 /collection/index.html 打开时 location.pathname 带着 index.html —— 直接拼进去，
//   链接就成了 .../index.html?share=…（能开，但难看，也和"分享的是这个站"不符）。
//   统一剥掉 index.html 并补尾部斜杠；/collection 由 Pages 301 补斜杠，这里也兜住。
function shareBaseUrl() {
    var p = String(location.pathname || '/').replace(/index\.html?$/i, '');
    if (p.charAt(p.length - 1) !== '/') p += '/';
    return location.origin + p;
}

// ★ 放行范围怎么算（用户定稿的三档，这里先做**自动识别**，手动改选是下一步）：
//   · 当前深链里有选择段（如 notes/commemorative/s0,4,8）⇒ 只放行"选中的这几张"：
//     范围 = 到分类为止，另带一个选择段签名 a（列表页仍可看，点别的那张会被拨回）；
//   · 没选任何东西 ⇒ 只按前缀放行（板块级 / 分类级 —— 分类里含子分类时收得更紧，见 shareScopeOf）。
// 判断"有几张"只为窗口里给人看，不参与安全判定（判定在 share-core.js 的 shareScopeMatch）。
function shareSelectedCount() {
    var segs = String(shareSelSig(shareCurrentHash())).split('|');
    var n = 0;
    for (var i = 0; i < segs.length; i++) {
        if (!segs[i]) continue;
        n += segs[i].slice(1).split(',').length;
    }
    return n;
}

function shareScopeLabel() {
    var scope = shareCurrentScope();
    var n = shareSelectedCount();
    if (!n) return scope;
    return scope + '，且仅选中的 ' + n + ' 张';
}

function shareCurrentHash() {
    try { if (typeof buildRoute === 'function') return String(buildRoute() || ''); } catch (e) { }
    return String(location.hash || '').replace(/^#/, '');
}
function shareCurrentScope() {
    try {
        if (typeof parseRoute === 'function' && typeof buildRoute === 'function') {
            return shareScopeOf(parseRoute('#' + buildRoute()));
        }
    } catch (e) { }
    return shareCurrentHash().split('/').slice(0, 2).join('/');
}

function sharePad2(n) { return (n < 10 ? '0' : '') + n; }
function shareLocalInputValue(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + sharePad2(d.getMonth() + 1) + '-' + sharePad2(d.getDate())
        + 'T' + sharePad2(d.getHours()) + ':' + sharePad2(d.getMinutes());
}
function shareHumanTime(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + sharePad2(d.getMonth() + 1) + '-' + sharePad2(d.getDate())
        + ' ' + sharePad2(d.getHours()) + ':' + sharePad2(d.getMinutes());
}
function shareHumanLeft(ms) {
    var left = ms - Date.now();
    if (left <= 0) return '已过期';
    var min = Math.floor(left / 60000);
    if (min < 60) return '还有 ' + min + ' 分钟';
    var hour = Math.floor(min / 60);
    if (hour < 24) return '还有 ' + hour + ' 小时';
    return '还有 ' + Math.floor(hour / 24) + ' 天';
}

// 档位 → 过期时间戳（null = 不设过期）
function shareExpForTier(tierId, customValue) {
    var t = SHARE_TIERS.filter(function (x) { return x.id === tierId; })[0];
    if (!t || t.ms < 0) return null;
    if (t.ms > 0) return Date.now() + t.ms;
    if (!customValue) return NaN;                 // 自定义但没填 → 无效
    var ms = new Date(customValue).getTime();
    return isFinite(ms) ? ms : NaN;
}

function shareOpenDialog() {
    shareEnsureStyle();
    if (shareDialogEl) { shareRefresh(); return; }

    var mask = document.createElement('div');
    mask.className = 'share-mask';
    mask.innerHTML = [
        '<div class="share-box" role="dialog" aria-label="分享这一页">',
        '<div class="share-title">分享这一页</div>',
        '<div class="share-row"><span class="share-k">当前深链</span><span class="share-v" id="shareHash"></span></div>',
        '<div class="share-row"><span class="share-k">放行范围</span><span class="share-v" id="shareScope"></span></div>',
        '<div class="share-tiers" id="shareTiers"></div>',
        '<div class="share-custom" id="shareCustom" style="display:none;">过期时间：',
        '<input type="datetime-local" step="60" id="shareCustomInput"> ',
        '<span style="color:var(--text-secondary,#666);">（到分钟；必须晚于现在）</span></div>',
        '<div class="share-exp" id="shareExp"></div>',
        '<textarea class="share-link" id="shareLink" rows="3" readonly></textarea>',
        '<div class="share-acts">',
        '<button class="share-btn" id="shareCopy">复制链接</button>',
        '<button class="share-btn ghost" id="shareClose">关闭</button>',
        '<span class="share-msg" id="shareMsg"></span>',
        '</div>',
        '<div style="margin-top:8px;color:var(--text-secondary,#666);font-size:.75rem;">',
        '范围内可自由浏览；跳到范围外会被挡回分享页。有效期由浏览器判定（软限制）。</div>',
        '</div>'
    ].join('');
    document.body.appendChild(mask);
    shareDialogEl = mask;

    // 档位按钮
    var tiersHost = mask.querySelector('#shareTiers');
    SHARE_TIERS.forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'share-tier';
        b.setAttribute('data-tier', t.id);
        b.innerHTML = '<span></span><small></small>';
        b.querySelector('span').textContent = t.label;
        b.querySelector('small').textContent = t.hint;
        b.addEventListener('click', function () {
            shareTier = t.id;
            mask.querySelector('#shareCustom').style.display = (t.id === 'custom') ? '' : 'none';
            shareRefresh();
        });
        tiersHost.appendChild(b);
    });

    var input = mask.querySelector('#shareCustomInput');
    input.value = shareLocalInputValue(Date.now() + 86400e3);   // 自定义的默认值 = 现在 + 1 天
    input.addEventListener('input', shareRefresh);

    mask.querySelector('#shareCopy').addEventListener('click', shareCopyLink);
    mask.querySelector('#shareClose').addEventListener('click', shareCloseDialog);
    mask.addEventListener('click', function (e) { if (e.target === mask) shareCloseDialog(); });

    mask.querySelector('#shareHash').textContent = '#' + shareCurrentHash();
    mask.querySelector('#shareScope').textContent = shareScopeLabel();
    shareRefresh();
    setTimeout(function () { mask.querySelector('#shareCopy').focus(); }, 0);
}

function shareCloseDialog() {
    if (!shareDialogEl) return;
    shareDialogEl.remove();
    shareDialogEl = null;
}

// 重算链接/预览（档位、自定义时间任何变化都走这里）
function shareRefresh() {
    if (!shareDialogEl) return;
    var mask = shareDialogEl;
    var exp = shareExpForTier(shareTier, mask.querySelector('#shareCustomInput').value);
    var bad = (typeof exp === 'number' && !isFinite(exp)) || (exp !== null && exp <= Date.now());
    var t = SHARE_TIERS.filter(function (x) { return x.id === shareTier; })[0];
    Array.prototype.forEach.call(mask.querySelectorAll('.share-tier'), function (b) {
        b.className = 'share-tier' + (b.getAttribute('data-tier') === shareTier ? ' on' : '');
    });

    var expEl = mask.querySelector('#shareExp');
    if (bad) {
        expEl.className = 'share-exp bad';
        expEl.textContent = '请选一个晚于现在的时间（现在是 ' + shareHumanTime(Date.now()) + '）';
    } else if (exp === null) {
        expEl.className = 'share-exp';
        expEl.textContent = '不设过期：靠 gate.mjs new 轮换站点令牌来撤销（换了令牌，所有旧链接一起作废）。';
    } else {
        expEl.className = 'share-exp';
        expEl.textContent = '失效：' + shareHumanTime(exp) + '（' + shareHumanLeft(exp) + '）'
            + (t && t.ms > 30 * 86400e3 ? '　提示：更长期建议用「跟随站点令牌」。' : '');
    }

    var linkEl = mask.querySelector('#shareLink');
    var btn = mask.querySelector('#shareCopy');
    if (bad) {
        linkEl.value = '';
        btn.disabled = true;
        btn.style.opacity = '.5';
    } else {
        btn.disabled = false;
        btn.style.opacity = '';
        linkEl.value = shareBuildUrl(shareCurrentScope(), exp, shareCurrentHash(), shareBaseUrl(),
            shareSelSig(shareCurrentHash()));
    }
    mask.querySelector('#shareMsg').textContent = '';
}

function shareCopyLink() {
    if (!shareDialogEl) return;
    var url = shareDialogEl.querySelector('#shareLink').value;
    if (!url) return;
    var done = function (okText) {
        if (shareDialogEl) shareDialogEl.querySelector('#shareMsg').textContent = okText;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done('已复制 ✓'); }, function () { done(shareFallbackCopy(url)); });
    } else {
        done(shareFallbackCopy(url));
    }
}

// 非安全上下文（file:// 或 http 且非 localhost）拿不到 clipboard API，
// 退回"选中 + execCommand"这条老路；再不行就提示手动复制（textarea 本来就是只读可选的）。
function shareFallbackCopy(url) {
    var el = shareDialogEl && shareDialogEl.querySelector('#shareLink');
    try {
        if (el) { el.focus(); el.select(); }
        if (document.execCommand && document.execCommand('copy')) return '已复制 ✓';
    } catch (e) { }
    return '请手动复制（已全选）';
}

// ── 快捷键：window 捕获阶段，先于工具箱那层 ────────────────────────────────
function shareShortcutHandler(e) {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    var k = String(e.key || '').toLowerCase();
    if (k !== 's') return;                      // 只认 Ctrl/Cmd+Shift+S，别的组合一律放过
    // ★ 抢在所有人之前：toolbox.js:8507 的 Ctrl+B/I/U/S 分支不检查 shiftKey，
    //   不 stopPropagation 的话在工具箱里会同时触发"删除线"。
    e.preventDefault();
    e.stopPropagation();
    if (shareDialogEl) shareCloseDialog(); else shareOpenDialog();
}
window.addEventListener('keydown', shareShortcutHandler, true);
