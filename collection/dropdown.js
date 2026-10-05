// ==================== dropdown.js ====================
// 自绘下拉栏（把页面上的原生 <select> 换成自己画的外观）。
//
// 用户要求：
//   · "你可以自己写下下拉栏，不用默认的了" —— 不要系统默认那个下拉；
//   · "下拉栏其实也可以设置为固定某宽度，对于写不下的可以像侧边栏那样压扁宽度"
//     —— 触发器固定宽度，放不下的文字压扁 + 省略号；
//   · "下拉栏弹出的时候可以有一定动画" —— 弹出/收起有补间。
//
// ★ 为什么原生 <select> 不删掉、只是隐藏起来：
//   .value / .options / .selectedIndex / change 事件是**既有契约**，全站代码和十几个
//   用例都在用（stats.js 读 priceSortSelect.value、router.js 写 timelineYearFilter.value、
//   special.js 读两个筛选器的值，verify-4issues / verify-heatmap / verify-years-timeline
//   直接 `s.value='desc'; s.dispatchEvent(new Event('change'))`）。
//   把它们全改成自定义 API，等于在一个"已经正确"的链路上到处动刀 —— 风险远大于收益。
//   所以这里：
//     · 原生 select 留在 DOM 里（display:none，不占位、不进布局），继续持有真实状态；
//     · 自绘的只有"看得见的那一层"：触发器 + 弹出列表；
//     · 用户在选择时，我们写回 select.value 并 dispatch change —— 既有逻辑一字不改照常跑。
//   display:none 的元素依然可以 programmatic 设值、可以被 dispatchEvent、inline onchange
//   也照常执行，所以契约完好；无障碍交给自绘那层的 role="listbox"/aria-* 承担。
//
// ★ 同步方向有两个，缺一不可：
//   ① 自绘 → 原生：用户点选项时写回 value + 派发 change；
//   ② 原生 → 自绘：外部代码 programmatic 改 select.value（router.js 就常这么干）、
//      或重填 options（stats.js 会重建筛选项）时，自绘那一层必须跟着更新。
//      改 value 不会改 DOM 属性、MutationObserver 看不到，所以这里在**实例上**用
//      Object.defineProperty 包一层 value setter（只包 select 实例，不动原型），
//      并监听 options 的 childList 变化。
//
// ★ 不写死"哪几个下拉"：扫描文档里所有 <select> 自动接管；视图切换产生的新下拉
//   由 MutationObserver 兜住。以后新增下拉不用回来改这个文件。

(function () {
    'use strict';

    if (window.__noCustomDropdown) return;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;   // 触屏就用系统原生的（更好用）

    var OPEN_CLASS = 'dd-open';
    var SEQ = 0;
    var all = [];              // 所有已接管的实例
    var openOne = null;        // 当前展开的那个
    var closeTimer = 0;

    function reduceMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ---------- 接管一个 select ----------
    function enhance(select) {
        if (select.__dd || select.multiple || select.size > 1) return;
        if (select.closest('.dd')) return;                 // 已经在自己画的壳里
        var id = select.id || ('dd-native-' + (++SEQ));
        var box = document.createElement('div');
        box.className = 'dd';
        box.setAttribute('data-dd-for', id);      // 方便 CSS 按上下文调固定宽度（--dd-w）
        box.innerHTML =
            '<button type="button" class="dd-trigger" aria-haspopup="listbox" aria-expanded="false">' +
            '<span class="dd-label"><span class="dd-label-text"></span></span>' +
            '<span class="dd-caret" aria-hidden="true"></span>' +
            '</button>' +
            '<div class="dd-popup" role="listbox" tabindex="-1" hidden></div>';
        // 插在 select 原来的位置，保持父容器的排列顺序
        select.parentNode.insertBefore(box, select);
        select.classList.add('dd-native');
        select.setAttribute('tabindex', '-1');
        select.setAttribute('aria-hidden', 'true');

        var rec = {
            select: select, box: box, id: id,
            trigger: box.querySelector('.dd-trigger'),
            label: box.querySelector('.dd-label'),
            labelText: box.querySelector('.dd-label-text'),
            popup: box.querySelector('.dd-popup'),
            active: -1, opened: false
        };
        select.__dd = rec;
        all.push(rec);

        // ② 原生 → 自绘：包一层 value setter（只包实例）
        try {
            var proto = Object.getPrototypeOf(select);
            var desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) {
                Object.defineProperty(select, 'value', {
                    configurable: true,
                    get: function () { return desc.get.call(this); },
                    set: function (v) { desc.set.call(this, v); sync(rec); }
                });
            }
        } catch (e) { /* 包不上就算了，下面 mutation/change 两条路仍然能同步 */ }
        // ② 原生 → 自绘：选项被重建时（stats.js 会重填筛选项）跟着重建
        if (typeof MutationObserver === 'function') {
            try {
                new MutationObserver(function () { rebuild(rec); }).observe(select, { childList: true });
            } catch (e) {}
        }
        select.addEventListener('change', function () { sync(rec); });

        // ① 自绘 → 原生
        rec.trigger.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            rec.opened ? close(rec, true) : open(rec);
        });
        rec.trigger.addEventListener('keydown', function (e) { onKey(rec, e); });
        rec.popup.addEventListener('click', function (e) {
            var opt = e.target.closest ? e.target.closest('.dd-opt') : null;
            if (!opt) return;
            e.stopPropagation();
            pick(rec, Number(opt.dataset.index));
        });
        rec.popup.addEventListener('mousemove', function (e) {
            var opt = e.target.closest ? e.target.closest('.dd-opt') : null;
            if (opt) setActive(rec, Number(opt.dataset.index), false);
        });
        // ★ 鼠标离开弹层就把悬停高亮清掉（用户实测：不清的话那一行会一直亮着，
        //   看着像"选中了它"，其实只是鼠标以前路过）。键盘的 rec.active 保留着，
        //   所以清掉之后再按方向键是从原位置继续走，不会跳回开头。
        //   当前选中项本身由 .dd-opt-on（主题色 + 加粗）表示，不靠这条高亮，所以不会丢信息。
        rec.popup.addEventListener('pointerleave', function () { clearActive(rec); });

        rebuild(rec);
    }

    function optionsOf(rec) {
        var out = [];
        var opts = rec.select.options;
        for (var i = 0; i < opts.length; i++) {
            out.push({ value: opts[i].value, text: (opts[i].textContent || '').trim(), disabled: !!opts[i].disabled });
        }
        return out;
    }

    // ★ Word 式文字比例压缩 —— 和 sidebar.js 的 fitSidebarLabels() 同一套做法：
    //   算得出可用宽度，就把整段文字横向 scaleX 压到刚好放得下（**不截断、不加省略号**）。
    //   用户原话："不是省略号！是横向压扁。你看看侧边栏的实现"。
    //   ★ 前提（踩过才知道）：被压的元素必须是"收缩到内容宽度"的盒子（inline-block）。
    //     如果它是个被容器钉死宽度的块，scrollWidth 只是被裁掉的那部分，scaleX 会压过头
    //     还留一条空白 —— 侧边栏父级那种 `flex:1;min-width:0` 的写法就有这个问题，
    //     所以这里统一用 .dd-label-text / .dd-opt-text 两个 inline-block 来量、来压。
    function squeezeText(el, avail) {
        if (!el) return 1;
        el.style.transform = '';
        var full = el.offsetWidth || el.scrollWidth;      // inline-block：盒子宽就是文字宽
        if (!(avail > 0) || full <= avail + 0.5) return 1;  // 放得下就不压
        var ratio = avail / full;
        el.style.transformOrigin = 'left center';
        el.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
        return ratio;
    }

    // 触发器上的文字：可用宽 = .dd-label 的实际宽（它被固定宽度夹住，caret 已经占掉了）
    function fitLabel(rec) {
        if (!rec || !rec.labelText) return;
        squeezeText(rec.labelText, rec.label.clientWidth);
    }

    // 弹层里的每个选项：可用宽 = 选项盒子宽 - 左右 padding
    function fitOptions(rec) {
        if (!rec || !rec.popup) return;
        var kids = rec.popup.children;
        for (var i = 0; i < kids.length; i++) {
            var opt = kids[i], tx = opt.firstChild;
            if (!tx || tx.nodeType !== 1) continue;
            var cs = getComputedStyle(opt);
            var avail = opt.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
            squeezeText(tx, avail);
        }
    }

    // 重建弹出列表 + 同步触发器上的文字
    function rebuild(rec) {
        var opts = optionsOf(rec);
        var html = '';
        for (var i = 0; i < opts.length; i++) {
            // 文字包一层 inline-block，压扁才有准确的可量宽度（见 squeezeText 的注释）。
            // title 仍留着：压得很扁时字会很难认，鼠标停一下能看全（信息不丢）。
            html += '<div class="dd-opt' + (opts[i].disabled ? ' dd-opt-disabled' : '') + '"' +
                ' role="option" data-index="' + i + '" data-value="' + escapeHtml(opts[i].value) + '"' +
                ' id="' + rec.id + '-opt-' + i + '" aria-selected="false"' +
                ' title="' + escapeHtml(opts[i].text) + '">' +
                '<span class="dd-opt-text">' + escapeHtml(opts[i].text) + '</span></div>';
        }
        rec.popup.innerHTML = html;
        rec.opts = opts;
        sync(rec);
        if (rec.opened) fitOptions(rec);      // 弹层开着时重建（stats.js 重填筛选）要立刻重压
    }

    // 把 select 的当前值反映到自绘那一层
    function sync(rec) {
        var i = rec.select.selectedIndex;
        var text = (i >= 0 && rec.opts && rec.opts[i]) ? rec.opts[i].text : '';
        if (!text && rec.select.value) text = rec.select.value;      // options 还没建好时兜底
        if (rec.labelText.textContent !== text) rec.labelText.textContent = text;
        // 文字太长时给个 title，鼠标停一下能看全（压扁之后仍能读到完整值）
        if (rec.label.title !== text) rec.label.title = text;
        fitLabel(rec);
        var nodes = rec.popup.children;
        for (var k = 0; k < nodes.length; k++) {
            var on = (k === i);
            nodes[k].classList.toggle('dd-opt-on', on);
            nodes[k].setAttribute('aria-selected', on ? 'true' : 'false');
        }
        if (rec.opened) place(rec);
    }

    // ---------- 展开 / 收起 ----------
    function open(rec) {
        if (openOne && openOne !== rec) close(openOne, false);
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
        rec.opened = true;
        openOne = rec;
        rec.popup.hidden = false;
        // ★ 先让 display:block 结算一次，再挂 .dd-open。否则"从 display:none 直接到目标样式"
        //   在同一次样式计算里完成，浏览器拿不到 before-change style，弹出动画不会播（硬切）。
        void rec.popup.offsetHeight;
        place(rec);
        rec.box.classList.add(OPEN_CLASS);
        rec.trigger.setAttribute('aria-expanded', 'true');
        setActive(rec, Math.max(0, rec.select.selectedIndex), false);
        document.addEventListener('pointerdown', onDocDown, true);
        window.addEventListener('scroll', onAnyScroll, true);
        window.addEventListener('resize', onAnyScroll);
    }

    function close(rec, focusBack) {
        if (!rec.opened) return;
        rec.opened = false;
        if (openOne === rec) openOne = null;
        rec.box.classList.remove(OPEN_CLASS);
        rec.trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onDocDown, true);
        window.removeEventListener('scroll', onAnyScroll, true);
        window.removeEventListener('resize', onAnyScroll);
        // 动画放完再 hidden，不然收起动画看不到（减弱动效时立刻收）
        var done = function () { if (!rec.opened) rec.popup.hidden = true; };
        if (reduceMotion()) done();
        else { if (closeTimer) clearTimeout(closeTimer); closeTimer = setTimeout(done, 200); }
        if (focusBack) { try { rec.trigger.focus(); } catch (e) {} }
    }

    function onDocDown(e) {
        if (!openOne) return;
        // ★ 自绘滚动条挂在 body 下，不在弹层里 —— 点它/拖它不能被当成"点了外面"，
        //   否则一按滑块弹层就关，弹层里根本滚不动（用户实测报告："一旦点击滚动条就会关闭"）。
        if (typeof window.customScrollbarHit === 'function' && window.customScrollbarHit(e.target)) return;
        if (typeof window.customScrollbarBusy === 'function' && window.customScrollbarBusy()) return;
        if (!openOne.box.contains(e.target)) close(openOne, false);
    }
    function onAnyScroll(e) {
        if (!openOne) return;
        if (e && e.target && openOne.popup.contains(e.target)) return;
        close(openOne, false);
    }

    // 弹出层用 position: fixed 定位：这样不会被 .price-list-body / .timeline-header
    // 那些 overflow 容器裁掉（原生 select 的弹层是浏览器画的，所以没这个问题）。
    function place(rec) {
        var r = rec.trigger.getBoundingClientRect();
        var pop = rec.popup;
        // ★ 弹层宽度**钉成和触发器一模一样**，不随选项文字变宽：
        //   长选项靠比例压缩（scaleX）横向压扁，跟触发器上的文字一致。
        //   原来写的是 minWidth，于是"人民币流通硬币 - 第二套人民币硬币（硬分币）"这种长选项
        //   会把弹层撑到 320px，比触发器宽一截、错位。
        pop.style.width = Math.round(r.width) + 'px';
        var h = pop.offsetHeight;
        fitLabel(rec);              // 增强时容器若还隐藏着（可用宽 0）压不了，打开时补一次
        fitOptions(rec);            // 宽度定了才能算每个选项的可用宽（弹层隐藏时量不到）
        var below = window.innerHeight - r.bottom - 8;
        var above = r.top - 8;
        var top = (h <= below || below >= above) ? (r.bottom + 4) : (r.top - h - 4);
        pop.style.left = Math.round(r.left) + 'px';
        pop.style.top = Math.round(Math.max(8, Math.min(top, window.innerHeight - h - 8))) + 'px';
    }

    function setActive(rec, i, scroll) {
        if (!rec.opts || i < 0 || i >= rec.opts.length) return;
        rec.active = i;
        var nodes = rec.popup.children;
        for (var k = 0; k < nodes.length; k++) nodes[k].classList.toggle('dd-opt-active', k === i);
        rec.trigger.setAttribute('aria-activedescendant', rec.id + '-opt-' + i);
        if (scroll && nodes[i] && nodes[i].scrollIntoView) {
            try { nodes[i].scrollIntoView({ block: 'nearest' }); } catch (e) {}
        }
    }

    // 只清"高亮"这个视觉状态，不动 rec.active（键盘还记得走到哪了）
    function clearActive(rec) {
        if (!rec || !rec.opts) return;
        var nodes = rec.popup.children;
        for (var k = 0; k < nodes.length; k++) nodes[k].classList.remove('dd-opt-active');
        rec.trigger.removeAttribute('aria-activedescendant');
    }

    function pick(rec, i) {
        if (!rec.opts || !rec.opts[i] || rec.opts[i].disabled) return;
        var v = rec.opts[i].value;
        if (rec.select.value !== v) {
            rec.select.value = v;                                  // 会触发上面包的 setter → sync
            rec.select.dispatchEvent(new Event('change', { bubbles: true }));   // 既有 onchange 照常跑
        }
        sync(rec);
        close(rec, true);
    }

    function onKey(rec, e) {
        var k = e.key;
        if (!rec.opened) {
            if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') {
                e.preventDefault();
                open(rec);
            }
            return;
        }
        if (k === 'Escape') { e.preventDefault(); close(rec, true); return; }
        if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(rec, rec.active); return; }
        if (k === 'ArrowDown' || k === 'ArrowUp') {
            e.preventDefault();
            var n = rec.opts.length;
            var i = rec.active + (k === 'ArrowDown' ? 1 : -1);
            // 跳过分组标题之类的禁用项
            var guard = 0;
            while (guard++ < n && rec.opts[(i + n) % n] && rec.opts[(i + n) % n].disabled) i += (k === 'ArrowDown' ? 1 : -1);
            setActive(rec, (i + n) % n, true);
            return;
        }
        if (k === 'Home') { e.preventDefault(); setActive(rec, 0, true); return; }
        if (k === 'End') { e.preventDefault(); setActive(rec, rec.opts.length - 1, true); return; }
        if (k === 'Tab') { close(rec, false); return; }
        // 首字母跳转（原生 select 的老习惯，成本很低）
        if (k.length === 1) {
            var ch = k.toLowerCase();
            for (var j = 1; j <= rec.opts.length; j++) {
                var idx = (rec.active + j) % rec.opts.length;
                if ((rec.opts[idx].text || '').toLowerCase().indexOf(ch) === 0) { setActive(rec, idx, true); break; }
            }
        }
    }

    // ---------- 自动接管全部 <select> ----------
    function scan() {
        var list = document.querySelectorAll('select');
        for (var i = 0; i < list.length; i++) enhance(list[i]);
    }
    var raf = 0;
    function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; scan(); });
    }
    if (typeof MutationObserver === 'function') {
        var mo = new MutationObserver(function () {
            if (mo.__t) return;
            // ★ 防抖从 120ms 收到 32ms：拾年专题切一次时间就会重建一批 <select>，
            //   等 120ms 才增强的话，新控件会先以原生样子露脸一瞬（用户报的"闪现老的下拉栏"）。
            //   原生控件的隐藏已经交给 CSS（select{display:none}），这里再把窗口收小到一两帧。
            mo.__t = setTimeout(function () { mo.__t = 0; schedule(); }, 32);
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }
    // 窗口/容器宽度变了要重新压一遍：窄屏断点会改触发器的固定宽度，
    // 而增强那一刻容器可能是隐藏的（量到的可用宽是 0，压不了）—— 侧边栏也有同样的钩子。
    function refitAll() {
        for (var i = 0; i < all.length; i++) {
            fitLabel(all[i]);
            if (all[i].opened) fitOptions(all[i]);
        }
    }
    window.addEventListener('resize', function () { refitAll(); schedule(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
    else schedule();

    window.refreshCustomDropdowns = schedule;
})();
