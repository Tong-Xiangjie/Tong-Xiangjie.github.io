/* ============================================================================
   分享窗口 —— Ctrl+Shift+S（Edge/Firefox 用 Alt+Shift+S）
   ----------------------------------------------------------------------------
   · 范围：**按下快捷键那一刻的深链**（buildRoute()）折算成"到分类为止"的前缀，
     窗口里会同时显示「当前所在深链」和「分享可见范围」两行，复制前可以核对。
   · 时效：1 小时 / 1 天（默认）/ 7 天 / 30 天 / 自定义到某天某时某分 / 永久
     （永久 = 不写 e，靠 gate.mjs new 轮换站点令牌来撤销）。
   · 链接：{origin}{pathname}?share=<payload>#<当前所在深链>
     —— query 归门禁、hash 归路由（顺序不能反，URL 规范里 query 必须在 hash 前）。

   ★ 快捷键为什么在**捕获阶段**、并且 stopPropagation：
     toolbox.js 的 Ctrl+B/I/U/S 分支**没有检查 shiftKey**（toolbox.js:8507），
     所以工具箱里按 Ctrl+Shift+S 会被它当成「删除线」吃掉。toolbox.js 在保护名单上，
     不去改它；改用 window 捕获阶段注册 —— 捕获比目标/冒泡都早，先一步 stopPropagation，
     事件根本到不了工具箱那层。这样「Ctrl+Shift+S = 分享」在任何界面里语义都成立。

   ★ 视觉（本轮按用户要求做的五件事）：
     1) 弹窗出现/退出都有动画（遮罩淡入淡出 + 面板轻微上浮/回落），
        prefers-reduced-motion 下全部关掉；
     2) 「链接复制成功！」淡入，3 秒后自动淡出（不是一直挂着）；
     3) 档位按钮排成**一排**（六个等宽，窄屏自动缩字号，仍是一排）；
     4) 「跟随站点令牌」改名「永久」（机制没变，还是不写 e）；
     5) 自定义时间不再用浏览器原生 datetime-local，改成自己画的
        「月历 + 时分步进」——原生控件在深色模式下会突然变白、样式也不受控。
   ============================================================================ */

// 档位（相邻跨度约 ×24 / ×7 / ×4，足够大 ⇒ 用户不用纠结"3 天还是 5 天"）
// ★ 只留档位名，不再写"随手发一下 / 你抽空看看"这类说明（用户要求全部删掉）。
// ★ 'site' 的文案按用户要求从「跟随站点令牌」改成「永久」（它的 ms 是 -1 = 不写 e，
//   机制一点没变，仍靠轮换站点令牌撤销）。
var SHARE_TIERS = [
    { id: 'h1',     label: '1 小时', ms: 3600e3 },
    { id: 'd1',     label: '1 天',   ms: 86400e3 },
    { id: 'd7',     label: '7 天',   ms: 7 * 86400e3 },
    { id: 'd30',    label: '30 天',  ms: 30 * 86400e3 },
    { id: 'custom', label: '自定义', ms: 0 },
    { id: 'site',   label: '永久',   ms: -1 }
];
var SHARE_DEFAULT_TIER = 'd1';

var shareDialogEl = null;
var shareTier = SHARE_DEFAULT_TIER;
var shareStyleDone = false;
var shareClosing = false;
var shareCustomMs = 0;          // 自定义档的当前值（时间戳；0 = 还没初始化）
var shareCalMonth = 0;          // 月历当前显示的月份（该月 1 号的时间戳）
var shareMsgOnTimer = null;     // 「复制成功」3 秒后触发淡出
var shareMsgOffTimer = null;    // 淡出动画结束后把类清干净

// ★ 暗色适配：弹窗挂在 body 下，颜色都走站点自己的 CSS 变量，根元素上的
//   html[data-color-scheme="dark"]（见 layout.css）会把这套变量整体换掉。
//   注意变量名必须用站点真实的那些：卡片是 --card-bg，**不是** --bg-card ——
//   写错名字时 var() 会一直取兜底的 #fff，于是"深色模式下弹窗还是白的"。
//   另外 color-scheme 已经由站点在根元素上设了，输入框/滚动条会跟着变深色。
function shareEnsureStyle() {
    if (shareStyleDone) return;
    shareStyleDone = true;
    var css = [
        // ── 遮罩与面板：出现/退出动画 ──────────────────────────────────────
        '.share-mask{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .18s ease;}',
        '.share-mask.on{opacity:1;}',
        '.share-mask.closing{opacity:0;}',
        '.share-box{width:min(94vw,560px);max-height:88vh;overflow:auto;background:var(--card-bg,#fff);color:var(--text,#222);border:1px solid var(--border,#ddd);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:18px 18px 14px;font-size:.9rem;opacity:0;transform:translateY(10px) scale(.985);transition:opacity .18s ease,transform .22s cubic-bezier(.22,.9,.28,1.06);}',
        '.share-mask.on .share-box{opacity:1;transform:none;}',
        '.share-mask.closing .share-box{opacity:0;transform:translateY(6px) scale(.985);transition-duration:.15s;}',
        '.share-title{font-size:1.05rem;font-weight:700;margin:0 0 10px;}',
        '.share-row{display:flex;gap:8px;align-items:baseline;margin:4px 0;line-height:1.5;}',
        '.share-k{flex:0 0 auto;color:var(--text-secondary,#666);}',
        '.share-v{flex:1 1 auto;word-break:break-all;font-family:ui-monospace,Consolas,monospace;}',
        // ── 档位：六个排成一排（等宽、不换行，窄屏缩字号） ─────────────────
        '.share-tiers{display:flex;gap:6px;margin:12px 0 6px;}',
        '.share-tier{flex:1 1 0;min-width:0;border:1px solid var(--border,#ddd);border-radius:8px;padding:6px 2px;cursor:pointer;background:transparent;color:inherit;text-align:center;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.share-tier.on{border-color:var(--theme,#1677ff);box-shadow:inset 0 0 0 1px var(--theme,#1677ff);}',
        '@media (max-width:430px){.share-tier{font-size:.72rem;padding:6px 1px;}.share-tiers{gap:4px;}}',
        // ── 自定义时间：主窗只显示"已选时间 + 选择按钮"，选择器是**第二个弹窗** ──
        //   （用户要求：日历时间选择单独做成一个弹窗，不再塞在主窗里撑高它。）
        // ★ 第二轮反馈：主窗里单占一行会让整个框变高 ⇒ 把「选择时间」小按钮**并到
        //   "失效时间"那一行的右端**（行高不变 ⇒ 弹窗高度不随档位变化）。
        '.share-exp-line{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin:8px 0;}',
        '.share-mini{font:inherit;font-size:.76rem;line-height:1.25;padding:0 6px;border:1px solid var(--border,#ddd);border-radius:6px;background:transparent;color:inherit;cursor:pointer;flex:0 0 auto;}',
        '.share-mini:hover{border-color:var(--theme,#1677ff);}',
        // 第二个弹窗：挂在 .share-mask 之下（不是 .share-box 里 —— 那个盒子有 transform
        // + overflow:auto，fixed 子元素会被它当包含块并裁掉），z-index 更高一层。
        '.share-sub-mask{position:fixed;inset:0;z-index:3100;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .18s ease;}',
        '.share-sub-mask.on{opacity:1;}',
        '.share-sub-mask.closing{opacity:0;}',
        '.share-sub-box{width:min(94vw,380px);max-height:88vh;overflow:auto;background:var(--card-bg,#fff);color:var(--text,#222);border:1px solid var(--border,#ddd);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);padding:16px 16px 12px;font-size:.9rem;opacity:0;transform:translateY(10px) scale(.985);transition:opacity .18s ease,transform .22s cubic-bezier(.22,.9,.28,1.06);}',
        '.share-sub-mask.on .share-sub-box{opacity:1;transform:none;}',
        '.share-sub-mask.closing .share-sub-box{opacity:0;transform:translateY(6px) scale(.985);transition-duration:.15s;}',
        '.share-sub-title{font-size:.98rem;font-weight:700;margin:0 0 10px;}',
        // ── 月历 ───────────────────────────────────────────────────────────
        '.share-cal{border:1px solid var(--border,#ddd);border-radius:10px;padding:8px;}',
        '.share-cal-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;}',
        '.share-cal-nav{font:inherit;width:26px;height:26px;line-height:1;border:1px solid var(--border,#ddd);border-radius:6px;background:transparent;color:inherit;cursor:pointer;flex:0 0 auto;}',
        '.share-cal-nav:hover{border-color:var(--theme,#1677ff);}',
        // ★ 站点在 layout.css 里写了 `@media (pointer:fine){ select{display:none} }`
        //   （它用自绘下拉替换原生 select）⇒ 我们的 select 必须显式写 display，
        //   否则计算出来就是 display:none（探针实测：#shareHour 宽 0px、整行塌成 4 行）。
        //   类选择器的优先级高于元素选择器，不需要 !important。
        '.share-sub-box .share-cal-sel{display:inline-block !important;font:inherit;font-size:.82rem;padding:3px 4px;border:1px solid var(--border,#ddd);border-radius:6px;background:transparent;color:inherit;min-width:0;cursor:pointer;}',
        // ★ 行高写死 + 永远 5 行日期格 ⇒ 4 行 / 5 行 / 6 行的月份，格子区高度完全一样
        '.share-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:30px;gap:2px;}',
        '.share-cal-w{color:var(--text-secondary,#666);text-align:center;font-size:.72rem;line-height:30px;}',
        '.share-cal-x{display:block;}',
        '.share-cal-d{font:inherit;font-size:.8rem;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;text-align:center;}',
        '.share-cal-d:hover:not(:disabled){background:rgba(22,119,255,.14);}',
        '.share-cal-d.on{background:var(--theme,#1677ff);color:#fff;}',
        '.share-cal-d:disabled{opacity:.3;cursor:not-allowed;}',
        // ── 时分：改成下拉栏（用户要求：不要 +/- 步进） ─────────────────────
        '.share-time{display:flex;align-items:center;gap:4px;margin-top:8px;flex-wrap:nowrap;}',
        '.share-time-k{color:var(--text-secondary,#666);flex:0 0 auto;}',
        '.share-sub-box .share-time-sel{display:inline-block !important;font:inherit;font-size:.82rem;padding:2px 2px;border:1px solid var(--border,#ddd);border-radius:6px;background:transparent;color:inherit;width:3.6em;flex:0 0 auto;text-align:center;cursor:pointer;}',
        '.share-hint{color:var(--text-secondary,#666);font-size:.72rem;white-space:nowrap;}',
        '.share-exp{margin:0;color:var(--text-secondary,#666);}',
        '.share-exp.bad{color:#ff7875;}',
        '.share-link{width:100%;box-sizing:border-box;font-family:ui-monospace,Consolas,monospace;font-size:.75rem;padding:6px;border:1px solid var(--border,#ddd);border-radius:6px;background:transparent;color:inherit;resize:none;overflow:auto;}',
        // ★ 用户要求：整排靠右（复制链接/关闭、确定/取消），而「链接复制成功！」就贴在
        //   「复制链接」**左边**（所以它必须排在按钮之前，且**不能**给 auto 外边距 ——
        //   探针实测：auto 挂在最后一个兄弟上会把按钮一起顶到左边缘）。
        '.share-acts{display:flex;gap:8px;align-items:center;margin-top:10px;justify-content:flex-end;}',
        '.share-btn{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid var(--theme,#1677ff);background:var(--theme,#1677ff);color:#fff;cursor:pointer;}',
        '.share-btn.ghost{background:transparent;color:inherit;border-color:var(--border,#ddd);}',
        // ── 复制成功：淡入，3 秒后淡出 ─────────────────────────────────────
        '.share-msg{color:var(--text-secondary,#666);opacity:0;transition:opacity .18s ease;}',
        '.share-msg.on{opacity:1;}',
        '.share-msg.out{opacity:0;transition:opacity .5s ease;}',
        // 深色下把遮罩压得更实、阴影更沉，并给"危险/过期"那句换一个在深底上够亮的红。
        'html[data-color-scheme="dark"] .share-mask{background:rgba(0,0,0,.62);}',
        'html[data-color-scheme="dark"] .share-box{box-shadow:0 12px 40px rgba(0,0,0,.6);}',
        'html[data-color-scheme="dark"] .share-exp.bad{color:#ff9c8f;}',
        // 站点还没跑起来（theme.js 未执行）时按系统偏好兜一层。
        '@media (prefers-color-scheme: dark){html:not([data-color-scheme="light"]) .share-mask{background:rgba(0,0,0,.62);}}',
        // 谁关掉了动画就别给他动画（前庭敏感）。
        '@media (prefers-reduced-motion: reduce){.share-mask,.share-box,.share-msg,.share-sub-mask,.share-sub-box{transition:none !important;}}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'shareStyle';
    s.textContent = css;
    document.head.appendChild(s);
}

// 当前所在深链 / 范围（都以"按下快捷键那一刻"为准）
// ★ 生成链接的 base 一律落到"目录"上。
//   从 /collection/index.html 打开时 location.pathname 带着 index.html —— 直接拼进去，
//   链接就成了 .../index.html?share=…（能开，但难看，也和"分享的是这个站"不符）。
//   统一剥掉 index.html 并补尾部斜杠；/collection 由 Pages 301 补斜杠，这里也兜住。
function shareBaseUrl() {
    var p = String(location.pathname || '/').replace(/index\.html?$/i, '');
    if (p.charAt(p.length - 1) !== '/') p += '/';
    return location.origin + p;
}

// ★ 分享可见范围怎么算（用户定稿的三档，这里做**自动识别**）：
//   · 当前所在深链里有选择段（如 notes/commemorative/s0,4,8）⇒ 只放行"选中的这几张"：
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
    return scope + '中选定的几件藏品';
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
// customValue 是自定义档的时间戳（shareCustomMs）。
function shareExpForTier(tierId, customValue) {
    var t = SHARE_TIERS.filter(function (x) { return x.id === tierId; })[0];
    if (!t || t.ms < 0) return null;
    if (t.ms > 0) return Date.now() + t.ms;
    if (!customValue) return NaN;                 // 自定义但没填 → 无效
    var ms = new Date(customValue).getTime();
    return isFinite(ms) ? ms : NaN;
}

// ── 自绘日历（月视图）与时分下拉 ──────────────────────────────────────────
// 为什么不用 <input type="datetime-local">：深色模式下原生控件会突然变白、
// 样式完全不受站点控制，而且各浏览器长相差别很大；自己画也更符合本站的观感。
// ★ 用户要求：日期格**永远 5 行**（大多数月份正好 5 行），上下高度必须恒定
//   · 6 行的月份（如 2027-01）：把最后一行多出来的格子**平移到第一行**的空位上
//     —— 本月初的空位数量必然 ≥ 多出来的格子数（offset ≥ (offset+天数)-35 恒成立），
//     而且这几格落在"它本来就该在的星期列"上（列的语义不会错）；
//   · 4 行的月份（如 2026-02）：末尾补一整行空。
//   这样翻月时窗口不会一跳一跳。
var SHARE_CAL_ROWS = 5;                       // 日期格固定行数
var sharePickPrevMs = 0;                      // 打开第二个弹窗时的值（取消要回滚）
var sharePickClosing = false;

function shareHourOpts() {
    var a = [];
    for (var i = 0; i < 24; i++) a.push({ v: i, t: sharePad2(i) });
    return a;
}
function shareMinOpts() {
    var a = [];
    for (var i = 0; i < 60; i++) a.push({ v: i, t: sharePad2(i) });
    return a;
}
// 填下拉栏并选中（重建 option 再设 value —— 简单可靠，60 个 option 的开销可忽略）
function shareFillSelect(el, list, sel) {
    if (!el) return;
    var cur = String(sel);
    var html = '';
    for (var i = 0; i < list.length; i++) html += '<option value="' + list[i].v + '">' + list[i].t + '</option>';
    el.innerHTML = html;
    el.value = cur;
    if (el.value !== cur && el.options.length) el.selectedIndex = 0;
}
function shareCalRender(mask) {
    if (!mask) return;
    var grid = mask.querySelector('#shareCalGrid');
    if (!grid) return;
    var base = new Date(shareCalMonth);
    var y = base.getFullYear(), m = base.getMonth();
    // 年份、月份各一个下拉栏（用户要求「年份月份最好也要分别多设计一个下拉栏」），
    // ‹ › 翻月按钮保留，两条路都能用。
    var ySel = mask.querySelector('#shareCalYear');
    if (ySel) {
        var years = [], thisYear = new Date().getFullYear();
        for (var yy = thisYear - 1; yy <= thisYear + 20; yy++) years.push({ v: yy, t: yy + ' 年' });
        shareFillSelect(ySel, years, y);
    }
    var mSel = mask.querySelector('#shareCalMonth');
    if (mSel) {
        var months = [];
        for (var mm = 1; mm <= 12; mm++) months.push({ v: mm, t: mm + ' 月' });
        shareFillSelect(mSel, months, m + 1);
    }
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var startWeekday = new Date(y, m, 1).getDay();
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var sel = new Date(shareCustomMs); sel.setHours(0, 0, 0, 0);
    var week = ['日', '一', '二', '三', '四', '五', '六'];
    var days = [];
    for (var b = 0; b < startWeekday; b++) days.push({ blank: 1 });
    for (var d = 1; d <= daysInMonth; d++) {
        var day = new Date(y, m, d);
        days.push({ d: d, past: day.getTime() < today.getTime(), on: day.getTime() === sel.getTime() });
    }
    var cap = 7 * SHARE_CAL_ROWS;
    var over = days.length - cap;
    if (over > 0) {
        // 6 行的月份：把最后 over 格**平移到第一行的那几个空位上**（空位被它们占掉，
        // 总格数正好回到 35）。第一版写成"拼在前面 + 保留原数组"⇒ 变成 36 格、又多出一行，
        // 用例（n===42）当场抓住。列仍然是对的：这几格落在它们本来该在的星期列上。
        days = days.slice(cap).concat(days.slice(over, cap));
    } else {
        for (var p = 0; p < -over; p++) days.push({ blank: 1 });
    }
    var html = '';
    for (var w = 0; w < 7; w++) html += '<span class="share-cal-w">' + week[w] + '</span>';
    for (var j = 0; j < days.length; j++) {
        var c = days[j];
        if (c.blank) { html += '<span class="share-cal-x"></span>'; continue; }
        html += '<button type="button" class="share-cal-d' + (c.on ? ' on' : '') + '" data-day="' + c.d + '"'
            + (c.past ? ' disabled' : '') + '>' + c.d + '</button>';
    }
    grid.innerHTML = html;
}

// 把 shareCustomMs 同步到界面（已选时间文字 + 时分下拉 + 日历高亮 + 年/月下拉）
function shareSyncCustom(mask) {
    if (!mask) return;
    var dt = new Date(shareCustomMs);
    shareFillSelect(mask.querySelector('#shareHour'), shareHourOpts(), dt.getHours());
    shareFillSelect(mask.querySelector('#shareMin'), shareMinOpts(), dt.getMinutes());
    // 失效时间的文字由 shareRefresh 写在 #shareExp 上（不再有单独的 #sharePickVal 行）
    shareCalMonth = new Date(dt.getFullYear(), dt.getMonth(), 1).getTime();
    shareCalRender(mask);
}

// ── 第二个弹窗：选择失效时间（确定 = 保留，取消 = 回到打开前的值） ──────────
function sharePickShow(mask) {
    if (!mask) return;
    var pick = mask.querySelector('#sharePickMask');
    if (!pick) return;
    sharePickPrevMs = shareCustomMs;
    sharePickClosing = false;
    shareSyncCustom(mask);
    pick.style.display = '';
    void pick.offsetWidth;                    // 先落一次 opacity:0，动画才起得来
    pick.className = 'share-sub-mask on';
}
function sharePickHide(mask, revert) {
    if (!mask) return;
    var pick = mask.querySelector('#sharePickMask');
    if (!pick || sharePickClosing || pick.style.display === 'none') return;
    sharePickClosing = true;
    if (revert) { shareCustomMs = sharePickPrevMs; shareSyncCustom(mask); shareRefresh(); }
    pick.className = 'share-sub-mask closing';
    setTimeout(function () {
        pick.style.display = 'none';
        pick.className = 'share-sub-mask';
        sharePickClosing = false;
    }, 150);
}

function shareOpenDialog() {
    shareEnsureStyle();
    if (shareDialogEl) { shareRefresh(); return; }
    shareClosing = false;

    var mask = document.createElement('div');
    mask.className = 'share-mask';
    mask.innerHTML = [
        '<div class="share-box" role="dialog" aria-label="分享这一页">',
        '<div class="share-title">分享这一页</div>',
        '<div class="share-row"><span class="share-k">当前所在深链</span><span class="share-v" id="shareHash"></span></div>',
        '<div class="share-row"><span class="share-k">分享可见范围</span><span class="share-v" id="shareScope"></span></div>',
        '<div class="share-tiers" id="shareTiers"></div>',
        '<div class="share-exp-line">',
        '<div class="share-exp" id="shareExp"></div>',
        '<button type="button" class="share-mini" id="sharePickOpen" style="display:none;">选择时间</button>',
        '</div>',
        '<textarea class="share-link" id="shareLink" rows="3" readonly></textarea>',
        '<div class="share-acts">',
        // ★ 提示放在两个按钮**之前**：那一排是 justify-content:flex-end（按钮统统靠右），
        //   「链接复制成功！」靠 margin-right:auto 顶到最左。放在按钮后面的话，auto 外边距
        //   会把按钮一起顶到左边去（探针实测：按钮贴着左边缘、右边空 359px）。
        '<span class="share-msg" id="shareMsg"></span>',
        '<button class="share-btn" id="shareCopy">复制链接</button>',
        '<button class="share-btn ghost" id="shareClose">关闭</button>',
        '</div>',
        '</div>',
        // ── 第二个弹窗：选择失效时间（用户要求"日历时间单独再做一个弹窗"） ──
        '<div class="share-sub-mask" id="sharePickMask" style="display:none;">',
        '<div class="share-sub-box" role="dialog" aria-label="选择失效时间">',
        '<div class="share-sub-title">选择失效时间</div>',
        '<div class="share-cal">',
        '<div class="share-cal-head">',
        '<button type="button" class="share-cal-nav" data-move="-1" aria-label="上个月">‹</button>',
        '<select class="share-cal-sel" id="shareCalYear" aria-label="年份"></select>',
        '<select class="share-cal-sel" id="shareCalMonth" aria-label="月份"></select>',
        '<button type="button" class="share-cal-nav" data-move="1" aria-label="下个月">›</button>',
        '</div>',
        '<div class="share-cal-grid" id="shareCalGrid"></div>',
        '</div>',
        '<div class="share-time">',
        '<select class="share-time-sel" id="shareHour" aria-label="小时"></select>',
        '<span class="share-time-k">:</span>',
        '<select class="share-time-sel" id="shareMin" aria-label="分钟"></select>',
        '<span class="share-hint">（不允许早于当前系统时间）</span>',
        '</div>',
        '<div class="share-acts">',
        '<button class="share-btn" id="sharePickOk">确定</button>',
        '<button class="share-btn ghost" id="sharePickCancel">取消</button>',
        '</div>',
        '</div>',
        '</div>'
    ].join('');
    document.body.appendChild(mask);
    shareDialogEl = mask;
    void mask.offsetWidth;                              // 先落一次 opacity:0 的样式，动画才起得来
    mask.className = 'share-mask on';

    // 档位按钮（一排六个）
    var tiersHost = mask.querySelector('#shareTiers');
    SHARE_TIERS.forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'share-tier';
        b.setAttribute('data-tier', t.id);
        b.innerHTML = '<span></span>';
        b.querySelector('span').textContent = t.label;
        b.addEventListener('click', function () {
            shareTier = t.id;
            if (t.id === 'custom' && !shareCustomMs) shareCustomMs = Date.now() + 86400e3;
            shareRefresh();
            if (t.id === 'custom') sharePickShow(mask);   // 直接开第二个弹窗，省一次点击
            else sharePickHide(mask, false);              // 离开自定义档就把选择器收掉
        });
        tiersHost.appendChild(b);
    });

    // 月历：翻月 + 选日
    Array.prototype.forEach.call(mask.querySelectorAll('.share-cal-nav'), function (b) {
        b.addEventListener('click', function () {
            var dir = Number(b.getAttribute('data-move'));
            var d = new Date(shareCalMonth);
            shareCalMonth = new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime();
            shareCalRender(mask);
        });
    });
    mask.querySelector('#shareCalGrid').addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.share-cal-d') : null;
        if (!btn || btn.disabled) return;
        var d = new Date(shareCalMonth);
        var old = new Date(shareCustomMs);
        shareCustomMs = new Date(d.getFullYear(), d.getMonth(), Number(btn.getAttribute('data-day')),
            old.getHours(), old.getMinutes(), 0, 0).getTime();
        shareSyncCustom(mask);
        shareRefresh();
    });
    // 年 / 月下拉栏：换月时保留"日"，超出当月天数就夹到月末
    var onYm = function () {
        var yEl = mask.querySelector('#shareCalYear'), mEl = mask.querySelector('#shareCalMonth');
        var y = Number(yEl && yEl.value) || new Date().getFullYear();
        var m = (Number(mEl && mEl.value) || 1) - 1;
        var old = new Date(shareCustomMs);
        var last = new Date(y, m + 1, 0).getDate();
        shareCustomMs = new Date(y, m, Math.min(old.getDate(), last), old.getHours(), old.getMinutes(), 0, 0).getTime();
        shareSyncCustom(mask);
        shareRefresh();
    };
    if (mask.querySelector('#shareCalYear')) mask.querySelector('#shareCalYear').addEventListener('change', onYm);
    if (mask.querySelector('#shareCalMonth')) mask.querySelector('#shareCalMonth').addEventListener('change', onYm);

    // 时 / 分下拉栏（用户要求：不要 +/- 步进）
    //   ★ 这里**不**调 shareSyncCustom：那会把下拉的 option 重建一遍，正在操作的元素
    //     会被换掉（焦点/滚动位置全丢）。只更新主窗上那行"已选时间"文字。
    var onTime = function () {
        var hEl = mask.querySelector('#shareHour'), mEl = mask.querySelector('#shareMin');
        var dt = new Date(shareCustomMs);
        dt.setHours(Number(hEl && hEl.value) || 0);
        dt.setMinutes(Number(mEl && mEl.value) || 0);
        dt.setSeconds(0, 0);
        shareCustomMs = dt.getTime();
        shareRefresh();          // 失效时间显示在 #shareExp 那一行上，由它统一刷新
    };
    if (mask.querySelector('#shareHour')) mask.querySelector('#shareHour').addEventListener('change', onTime);
    if (mask.querySelector('#shareMin')) mask.querySelector('#shareMin').addEventListener('change', onTime);

    // 第二个弹窗的开关
    mask.querySelector('#sharePickOpen').addEventListener('click', function () { sharePickShow(mask); });
    mask.querySelector('#sharePickOk').addEventListener('click', function () { sharePickHide(mask, false); });
    mask.querySelector('#sharePickCancel').addEventListener('click', function () { sharePickHide(mask, true); });
    mask.querySelector('#sharePickMask').addEventListener('click', function (e) {
        if (e.target === mask.querySelector('#sharePickMask')) sharePickHide(mask, true);
    });

    mask.querySelector('#shareCopy').addEventListener('click', shareCopyLink);
    mask.querySelector('#shareClose').addEventListener('click', shareCloseDialog);
    mask.addEventListener('click', function (e) { if (e.target === mask) shareCloseDialog(); });

    mask.querySelector('#shareHash').textContent = '#' + shareCurrentHash();
    mask.querySelector('#shareScope').textContent = shareScopeLabel();
    if (!shareCustomMs) shareCustomMs = Date.now() + 86400e3;   // 自定义档默认 = 现在 + 1 天
    shareRefresh();
    // ★ 用户要求：快捷键打开时**什么都不选中**。原来把焦点给了「复制链接」，
    //   按钮上留一个焦点框，看着就像"被选中了"。这里把焦点和文字选区一起清干净。
    try {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        var sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) { }
}

// 关闭：先播退出动画，再摘掉节点（150ms 后，和 CSS 里的时长对齐）
function shareCloseDialog() {
    if (!shareDialogEl || shareClosing) return;
    var el = shareDialogEl;
    shareClosing = true;
    clearTimeout(shareMsgOnTimer);
    clearTimeout(shareMsgOffTimer);
    el.className = 'share-mask closing';
    setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        if (shareDialogEl === el) shareDialogEl = null;
        shareClosing = false;
    }, 150);
}

// 档位 → 过期状态（bad = 时间无效/已过期）
function shareExpState() {
    var exp = shareExpForTier(shareTier, shareCustomMs);
    var bad = (typeof exp === 'number' && !isFinite(exp)) || (exp !== null && exp <= Date.now());
    return { exp: exp, bad: bad };
}
// 失效时间那一行该显示什么（"现在是 …" / "还有 …" 都来自这里）
function shareExpText(st) {
    if (st.bad) return '链接失效时间不能早于当前系统时间（' + shareHumanTime(Date.now()) + '）！';
    if (st.exp === null) return '分享链接将永久有效，请谨慎选择此项';
    return '距离失效时间 ' + shareHumanTime(st.exp) + ' ' + shareHumanLeft(st.exp);
}
// ★ 用户要求：句子里那个"系统时间"要**实时刷新**。所以单独抽一个"只更新这一行"的函数，
//   挂一个 1 秒的定时器反复调它。为什么不能直接每秒跑 shareRefresh()：那会把
//   「链接复制成功！」那句一起清掉（它靠 #shareMsg，shareRefresh 每次都会重置它），
//   也会白白重排整个弹窗。这里只在文字真的变了才写 DOM，开销可以忽略。
function shareUpdateExpLine() {
    if (!shareDialogEl) return null;
    var el = shareDialogEl.querySelector('#shareExp');
    if (!el) return null;
    var st = shareExpState();
    var txt = shareExpText(st);
    if (el.textContent !== txt) el.textContent = txt;
    var cls = 'share-exp' + (st.bad ? ' bad' : '');
    if (el.className !== cls) el.className = cls;
    return st;
}
setInterval(function () { if (shareDialogEl) shareUpdateExpLine(); }, 1000);

// 重算链接/预览（档位、自定义时间任何变化都走这里）
function shareRefresh() {
    if (!shareDialogEl) return;
    var mask = shareDialogEl;
    var exp = shareExpState().exp;
    var t = SHARE_TIERS.filter(function (x) { return x.id === shareTier; })[0];
    Array.prototype.forEach.call(mask.querySelectorAll('.share-tier'), function (b) {
        b.className = 'share-tier' + (b.getAttribute('data-tier') === shareTier ? ' on' : '');
    });

    var expEl = mask.querySelector('#shareExp');
    var st = shareUpdateExpLine() || shareExpState();
    var bad = st.bad;
    // 「选择时间」小按钮只在自定义档露出来。它和失效时间同处一行（.share-exp-line），
    // 高度只有 .76rem + 1px 边框 ⇒ 比这行文字还矮 ⇒ 弹窗总高度不随档位变化。
    var pickBtn = mask.querySelector('#sharePickOpen');
    if (pickBtn) pickBtn.style.display = (shareTier === 'custom') ? '' : 'none';
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
    // 重算时把上一次的"复制成功"收掉（连类一起清干净，避免留下半透明状态）
    clearTimeout(shareMsgOnTimer); clearTimeout(shareMsgOffTimer);
    var msgEl = mask.querySelector('#shareMsg');
    msgEl.className = 'share-msg';
    msgEl.textContent = '';
}

// 「链接复制成功！」淡入 → 停 3 秒 → 淡出（反复点会重置计时）
function shareSay(text) {
    if (!shareDialogEl) return;
    var el = shareDialogEl.querySelector('#shareMsg');
    if (!el) return;
    el.textContent = text;
    el.className = 'share-msg on';
    clearTimeout(shareMsgOnTimer); clearTimeout(shareMsgOffTimer);
    shareMsgOnTimer = setTimeout(function () {
        el.className = 'share-msg out';
        shareMsgOffTimer = setTimeout(function () { el.className = 'share-msg'; }, 550);
    }, 3000);
}

function shareCopyLink() {
    if (!shareDialogEl) return;
    var url = shareDialogEl.querySelector('#shareLink').value;
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { shareSay('链接复制成功！'); },
            function () { shareSay(shareFallbackCopy(url)); });
    } else {
        shareSay(shareFallbackCopy(url));
    }
}

// 非安全上下文（file:// 或 http 且非 localhost）拿不到 clipboard API，
// 退回"选中 + execCommand"这条老路；再不行就提示手动复制（textarea 本来就是只读可选的）。
function shareFallbackCopy(url) {
    var el = shareDialogEl && shareDialogEl.querySelector('#shareLink');
    try {
        if (el) { el.focus(); el.select(); }
        if (document.execCommand && document.execCommand('copy')) return '链接复制成功！';
    } catch (e) { }
    return '请手动复制（已全选）';
}

// ── 快捷键：window 捕获阶段，先于工具箱那层 ────────────────────────────────
// ★ 两套组合键：Ctrl/Cmd+Shift+S（Chrome/Chromium 可用）与 Alt+Shift+S（备用）。
//   为什么必须有第二套：Edge 把 Ctrl+Shift+S 绑给了浏览器自带的「网页捕获」、
//   Firefox 绑给了「截图」—— 那是**浏览器级**快捷键，网页 side 的 preventDefault
//   挡不住（用户实测：Edge 里按 Ctrl+Shift+S 弹的是截图，不是我们的分享窗）。
//   Alt+Shift+S 三家浏览器都没占用，也不与 Windows 输入法切换（Alt+Shift 松开才切）打架。
//   想改组合键就改这里 + gate.js 里 shareBlockReshare 的两处判定，两边必须一致，
//   否则分享模式下会出现"按了没反应但也没被拦住"的缝。
function shareShortcutHandler(e) {
    var k = String(e.key || '').toLowerCase();
    if (k !== 's') return;                                   // 只认 S，别的组合一律放过
    var ctrlCombo = (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
    var altCombo = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
    if (!ctrlCombo && !altCombo) return;
    // ★ 抢在所有人之前：toolbox.js:8507 的 Ctrl+B/I/U/S 分支不检查 shiftKey，
    //   不 stopPropagation 的话在工具箱里会同时触发"删除线"。
    e.preventDefault();
    e.stopPropagation();
    if (shareDialogEl) shareCloseDialog(); else shareOpenDialog();
}
window.addEventListener('keydown', shareShortcutHandler, true);
