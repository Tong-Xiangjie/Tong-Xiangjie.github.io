// ==================== scrollbar.js ====================
// 自绘滚动条（**只做纵向**，悬浮在内容上方）。
//
// 为什么要自己写（用户提的）：
//   浏览器默认滚动条**占布局宽度**。主滚动区一出现纵向滚动条，可用宽度就少掉约 15px
//   （Windows Chrome），整页内容横向缩一下 —— 用户原话："总是容易把整个网站横向
//   变窄一点点"。
//   所以：① 原生纵向条在 **CSS 里提前**收成 0 宽（不等 JS，否则首屏会先按"有原生条"
//   的宽度排版、JS 再收回，宽度要弹一下，见 layout.css 的自绘滚动条一节）；
//   ② 这里浮一个自绘滑块上去，position: fixed、绝对不参与布局 → 宽度永远不变。
//
// 交互（用户定的）：
//   · 悬浮在内容上方（overlay，不占位、不推挤任何东西）；
//   · 滚动时出现，停手一段时间自动淡出；
//   · **鼠标移到滚动条那一带又出来**（贴边 20px 都算，不用精确压在几像素上）；
//   · 滑块可拖、点轨道翻页；滚轮/触控板/键盘一律仍是原生行为。
//
// 为什么用 position: fixed 而不是"塞进容器里绝对定位"：absolute 要求容器是
// containing block，而容器里有 .tl-heatmap-tip 这类绝对定位的后代，把容器变成
// 定位基准会把它们带偏。fixed 只浮在上层，每次量一下容器 rect，不动现有布局。
//
// 只在精确指针（桌面鼠标）上启用：触屏原生滚动条本来就是浮层、不占宽度。
//
// ★ 横向不做（用户确认：本站没有需要横向滚动的地方）。但要注意：
//   `scrollbar-width: none` / `::-webkit-scrollbar { width: 0 }` 会把两个方向的
//   原生条一起收掉。所以留了一道保险：真的能横向滚（overflow-x 允许且确实超出）
//   的容器**不接**自绘条、保持原生 —— 万一以后真有这种地方，它的横向指示不会消失。
//
// ★ 哪些元素是滚动容器，不写死清单，两条腿走路：
//   ① 快速通道：样式表里声明了 overflow(-y/-x): auto|scroll 的选择器；
//   ② 真值扫描：谁真的超出、且 computed 允许滚，就挂谁。
//   必须有 ②：视图容器的 overflow 是 core.js/main.js 用内联样式给的
//   （#view-xxx_container 就是），只认样式表字面量会漏 —— 一开始正是漏了它，
//   自绘条挂在没人滚的 .content 上空转。

(function () {
    'use strict';

    if (window.__noCustomScrollbar) return;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;   // 触屏走原生

    var HOST_CLASS = 'cscroll-host';
    var MIN_THUMB = 24;          // 滑块最短像素（再短就没法拖）
    var TRACK = 10;              // 轨道宽 = 命中带（视觉上的滑块更细，见 CSS）
    var HOT_ZONE = 20;           // 贴边多少 px 算"鼠标滑到滚动条位置"
    var IDLE_HIDE_MS = 900;      // 停手多久淡出
    var LEAVE_HIDE_MS = 500;     // 鼠标移出热区后多久淡出
    var FULL_SCAN_MS = 800;      // 真值扫描的最低间隔（读 scrollHeight 很便宜，但别每帧扫）

    var hosts = [];
    var lastFullScan = 0;

    function reduceMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // ---------- ① 快速通道：样式表里声明了可滚的选择器 ----------
    function collectSelectors(rules, out) {
        for (var i = 0; i < rules.length; i++) {
            var r = rules[i];
            if (r.cssRules && typeof r.conditionText === 'string') { collectSelectors(r.cssRules, out); continue; }   // @media
            if (!r.selectorText || !r.style) continue;
            var oy = (r.style.getPropertyValue('overflow-y') || '').trim();
            var ox = (r.style.getPropertyValue('overflow-x') || '').trim();
            var o = (r.style.getPropertyValue('overflow') || '').trim().split(/\s+/);   // 简写：overflow: hidden auto
            var autoish = function (v) { return /^(auto|scroll|overlay)$/.test(v); };
            if (autoish(oy) || autoish(ox) ||
                (o.length === 1 && autoish(o[0])) ||                                     // overflow: auto
                (o.length === 2 && (autoish(o[0]) || autoish(o[1])))) {
                out.push(r.selectorText);
            }
        }
        return out;
    }

    function scrollableSelectors() {
        var out = [], sheets = document.styleSheets;
        for (var i = 0; i < sheets.length; i++) {
            var rules = null;
            try { rules = sheets[i].cssRules; } catch (e) { continue; }   // 跨域表读不到就跳过
            if (rules) collectSelectors(rules, out);
        }
        return out;
    }

    // 纵向需要滚动？横向是"用户真的能滚"的二维滚动容器吗？
    function verticalNeed(el) {
        return el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1;
    }
    function realHorizontalScroller(el, cs) {
        return /auto|scroll|overlay/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
    }

    // ---------- ② 真值扫描 ----------
    function fullScan(force) {
        var now = Date.now();
        if (!force && now - lastFullScan < FULL_SCAN_MS) return;
        lastFullScan = now;
        var all = document.body.getElementsByTagName('*');
        var cand = [];
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.__cscroll) continue;
            if (el === document.body || el === document.documentElement) continue;
            // 先读几何（很便宜；中间不写样式，不会反复触发重排），真正超出的才去读 computed
            if (verticalNeed(el)) cand.push(el);
        }
        for (var k = 0; k < cand.length; k++) {
            var c = cand[k];
            if (!verticalNeed(c)) continue;
            var cs = getComputedStyle(c);
            if (!/auto|scroll|overlay/.test(cs.overflowY)) continue;
            if (realHorizontalScroller(c, cs)) continue;      // 保险：真能横滚的，保持原生
            attach(c);
        }
    }

    function discover() {
        var sels = scrollableSelectors();
        for (var i = 0; i < sels.length; i++) {
            var found = null;
            try { found = document.querySelectorAll(sels[i]); } catch (e) { continue; }   // ::-webkit- 之类会抛
            for (var j = 0; j < found.length; j++) {
                var el = found[j];
                if (el.__cscroll || !verticalNeed(el)) continue;
                if (realHorizontalScroller(el, getComputedStyle(el))) continue;
                attach(el);
            }
        }
        fullScan(false);
        for (var k = hosts.length - 1; k >= 0; k--) refresh(hosts[k]);
    }

    // ---------- 挂载 ----------
    function attach(el) {
        var bar = document.createElement('div');
        bar.className = 'cscroll-bar';
        var thumb = document.createElement('div');
        thumb.className = 'cscroll-thumb';
        bar.appendChild(thumb);
        document.body.appendChild(bar);
        var rec = { el: el, bar: bar, thumb: thumb, dragging: false, hideTimer: 0, hot: false, seen: false, m: null };
        el.__cscroll = rec;
        hosts.push(rec);

        // 兜底再挂一次类（CSS 已经提前收掉了常见滚动容器的原生条，见 layout.css）
        el.classList.add(HOST_CLASS);

        el.addEventListener('scroll', function () { layout(rec); flash(rec); }, { passive: true });
        el.addEventListener('pointermove', function (e) { onPointerMove(rec, e); }, { passive: true });
        el.addEventListener('pointerenter', function () { rec.seen = true; layout(rec); show(rec); });
        el.addEventListener('pointerleave', function () { rec.hot = false; scheduleHide(rec, LEAVE_HIDE_MS); });
        if (typeof ResizeObserver === 'function') {
            try { new ResizeObserver(function () { layout(rec); }).observe(el); } catch (e) {}
        }
        bar.addEventListener('pointerdown', function (e) { onBarDown(rec, e); });
        bar.addEventListener('pointerenter', function () { show(rec); });                 // 压在条上就一直显示
        bar.addEventListener('pointerleave', function () { scheduleHide(rec, LEAVE_HIDE_MS); });
        thumb.addEventListener('pointerdown', function (e) { onThumbDown(rec, e); });
        layout(rec);
    }

    function unmount(rec) {
        try { rec.bar.remove(); } catch (e) {}
        try { rec.el.classList.remove(HOST_CLASS); } catch (e) {}
        if (rec.el && rec.el.__cscroll === rec) rec.el.__cscroll = null;
        var i = hosts.indexOf(rec);
        if (i >= 0) hosts.splice(i, 1);
    }

    function refresh(rec) {
        if (!rec.el || !rec.el.isConnected) { unmount(rec); return; }
        layout(rec);
    }

    // ---------- 几何 ----------
    function layout(rec) {
        var el = rec.el, bar = rec.bar;
        var view = el.clientHeight, full = el.scrollHeight;
        if (view <= 0 || full <= view + 1) {          // 不需要滚：收起来（host 留着，宽度才不会跳）
            bar.style.display = 'none';
            rec.m = null;
            return;
        }
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) { bar.style.display = 'none'; rec.m = null; return; }
        bar.style.display = '';

        var thumbLen = Math.max(MIN_THUMB, Math.round(view * view / full));
        var maxScroll = full - view;
        var maxThumb = Math.max(0, view - thumbLen);
        var pos = maxScroll > 0 ? Math.round(el.scrollTop / maxScroll * maxThumb) : 0;

        bar.style.top = rect.top + 'px';
        bar.style.left = (rect.right - TRACK) + 'px';
        bar.style.width = TRACK + 'px';
        bar.style.height = view + 'px';
        rec.thumb.style.height = thumbLen + 'px';
        rec.thumb.style.transform = 'translateY(' + pos + 'px)';

        rec.m = { view: view, full: full, thumbLen: thumbLen, maxScroll: maxScroll, maxThumb: maxThumb, pos: pos, rect: rect };
    }

    function layoutAll() { for (var i = hosts.length - 1; i >= 0; i--) refresh(hosts[i]); }

    // ---------- 显示 / 隐藏 ----------
    function show(rec) {
        if (rec.hideTimer) { clearTimeout(rec.hideTimer); rec.hideTimer = 0; }
        rec.bar.classList.add('cscroll-on');
    }
    function hide(rec) { rec.bar.classList.remove('cscroll-on'); }
    function flash(rec) {
        show(rec);
        if (rec.dragging) return;
        scheduleHide(rec, IDLE_HIDE_MS);
    }
    function scheduleHide(rec, ms) {
        if (rec.dragging) return;
        if (rec.hideTimer) clearTimeout(rec.hideTimer);
        rec.hideTimer = setTimeout(function () {
            rec.hideTimer = 0;
            if (rec.dragging || rec.hot) return;      // 鼠标还在滚动条那一带：不隐藏
            hide(rec);
        }, ms);
    }

    // ---------- 「鼠标滑到滚动条的位置就又出来」 ----------
    function inHotZone(rec, x, y) {
        if (!rec.m || !rec.m.rect) return false;
        var r = rec.m.rect;
        return x >= r.right - HOT_ZONE && x <= r.right + 4 && y >= r.top - 2 && y <= r.bottom + 2;
    }
    function onPointerMove(rec, e) {
        if (rec.dragging) return;
        // ★ 页面加载时鼠标**可能本来就在内容区里**（刷新页面、从别的视图切过来），
        //   这时 pointerenter 永远不会触发，滚动条就一直不出来。
        //   所以把"第一次在容器内移动"也当作一次进入：显示一次，之后照旧自动隐藏。
        if (!rec.seen) {
            rec.seen = true;
            show(rec);
            scheduleHide(rec, IDLE_HIDE_MS);
            return;
        }
        var hot = inHotZone(rec, e.clientX, e.clientY);
        if (hot === rec.hot) return;
        rec.hot = hot;
        if (hot) show(rec);
        else if (rec.hideTimer === 0) scheduleHide(rec, LEAVE_HIDE_MS);
    }

    // ---------- 拖动 / 点轨道 ----------
    function onThumbDown(rec, e) {
        if (!rec.m) return;
        e.preventDefault();
        e.stopPropagation();
        rec.dragging = true;
        rec.hot = true;
        rec.dragStart = e.clientY;
        rec.dragScroll = rec.el.scrollTop;
        show(rec);
        rec.bar.classList.add('cscroll-drag');
        try { rec.thumb.setPointerCapture(e.pointerId); } catch (err) {}
        rec.thumb.addEventListener('pointermove', onDragMove);
        rec.thumb.addEventListener('pointerup', onDragEnd);
        rec.thumb.addEventListener('pointercancel', onDragEnd);
    }
    function onDragMove(e) {
        for (var i = 0; i < hosts.length; i++) {
            var rec = hosts[i];
            if (!rec.dragging || !rec.m || rec.m.maxThumb <= 0) continue;
            var scroll = rec.dragScroll + (e.clientY - rec.dragStart) / rec.m.maxThumb * rec.m.maxScroll;
            rec.el.scrollTop = Math.max(0, Math.min(rec.m.maxScroll, scroll));
        }
    }
    function onDragEnd(e) {
        for (var i = 0; i < hosts.length; i++) {
            var rec = hosts[i];
            if (!rec.dragging) continue;
            rec.dragging = false;
            rec.thumb.removeEventListener('pointermove', onDragMove);
            rec.thumb.removeEventListener('pointerup', onDragEnd);
            rec.thumb.removeEventListener('pointercancel', onDragEnd);
            rec.bar.classList.remove('cscroll-drag');
            try { rec.thumb.releasePointerCapture(e.pointerId); } catch (err) {}
            layout(rec);
            rec.hot = inHotZone(rec, e.clientX, e.clientY);
            scheduleHide(rec, LEAVE_HIDE_MS);
        }
    }
    function onBarDown(rec, e) {
        if (!rec.m || e.target === rec.thumb) return;
        var m = rec.m;
        var rect = rec.bar.getBoundingClientRect();
        var back = (e.clientY - rect.top) < m.pos;         // 点在滑块上方 = 往回翻
        var target = Math.max(0, Math.min(m.maxScroll, rec.el.scrollTop + (back ? -1 : 1) * rec.el.clientHeight));
        if (reduceMotion()) {
            rec.el.scrollTop = target;
        } else {
            try { rec.el.scrollTo({ top: target, behavior: 'smooth' }); } catch (err) { rec.el.scrollTop = target; }
        }
        flash(rec);
    }

    // ---------- 触发时机 ----------
    var raf = 0;
    function scheduleSync() {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; discover(); });
    }
    window.addEventListener('resize', function () { layoutAll(); scheduleSync(); });
    window.addEventListener('hashchange', function () { layoutAll(); scheduleSync(); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { layoutAll(); scheduleSync(); });
    if (typeof MutationObserver === 'function') {
        var mo = new MutationObserver(function () {
            if (mo.__t) return;
            mo.__t = setTimeout(function () { mo.__t = 0; scheduleSync(); }, 150);
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }
    function boot() { scheduleSync(); setTimeout(function () { fullScan(true); }, 400); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    // 兜底：几何也会因为"不是 DOM 变化"的原因变（侧边栏折叠、字体晚到、视图容器移位），
    // 低频校正几何 + 顺带跑真值扫描（读 scrollHeight 很便宜，内部还有间隔节流）。
    setInterval(function () {
        if (!hosts.length) { fullScan(true); return; }
        layoutAll();
        fullScan(false);
    }, 800);

    window.refreshCustomScrollbars = function () { fullScan(true); scheduleSync(); };
})();
