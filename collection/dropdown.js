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
        box.__rec = rec;            // ★ 反向引用：重渲染后认领要用它（见 adoptCustomDropdowns）
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
        // ★ e.target 可能是 window 之类**不是 Node** 的目标（window 上派发的 pointerdown）。
        //   这时 contains 会抛 TypeError（"parameter 1 is not of type 'Node'"），
        //   而 window 显然不在弹层里 —— 按"点了外面"处理即可。下一行的 onAnyScroll 早有这个守卫。
        const t = e && e.target;
        if (!t || !t.nodeType || !openOne.box.contains(t)) close(openOne, false);
    }
    function onAnyScroll(e) {
        if (!openOne) return;
        // ★ 守卫：e.target 可能是 window 这类**不是 Node** 的目标，此时 contains 会抛
        //   TypeError（"parameter 1 is not of type 'Node'"）—— 这就是 CI 上那条间歇性
        //   "全程无未捕获异常（1 条）" 的真凶（上面那段注释原写"onAnyScroll 早有这个守卫"
        //   是我记错了，它当时没有，所以坑留了很久）。
        //   ★ 非 Node 一律**直接返回、不关弹层**：这不是"随便选一个"，而是要跟改动前的
        //   **实际效果**完全一致 —— 那时 contains 抛异常，close() 也就没执行、弹层留着。
        //   改成"按滚在弹层外处理"虽也说得通，但会凭空多出一次关闭（本地 CI=true 复跑时
        //   出现过 65/5 的偶发失败），为了不动既有行为，这里只去掉异常本身。
        const t = e && e.target;
        if (!t || !t.nodeType) return;
        if (openOne.popup.contains(t)) return;
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

    // ============================================================
    // ★★★ 保壳复用（adopt）：让"整块 innerHTML 重渲染"不再把下拉拆掉重建
    //
    // 背景（用户实测）：拾年专题切一次时间范围，`renderTimelineContent` 会
    //   `app.innerHTML = html` 整块换掉 —— 而 `.dd` 就写在那段 html 里，
    //   于是老壳连同一个 `.dd-trigger` / `.dd-label-text` 一起被丢弃；
    //   新 `<select>` 是全新节点、身上没有 `__dd`，建壳又要等 rAF / 32ms 去抖
    //   ⇒ 中间那一帧被**真的画了出来**：控件区域两个下拉凭空消失、
    //     `.timeline-top-right` 从 422.77px 塌到 214.77px（"共N件"和两个排序按钮
    //     整排横移），下一帧再弹回来。用户原话："换时间段时下拉栏像要重建一下、闪动一下"。
    //
    // 做法（**只增不改**，不改任何既有调用点与既有行为）：
    //   ① 重渲染前 `captureCustomDropdowns(root)` 把 .dd 摘到游离容器（节点身份、
    //      事件监听、`__dd` 记录、压扁用的 transform 全部保留）；
    //   ② 重渲染后 `adoptCustomDropdown(root, pen)` 按 `data-dd-for` ↔ `select.id`
    //      把壳认领给新 `<select>`（挂回它前面），并 `rebuild` 弹层选项、刷新文字。
    //   `.dd` / `.dd-trigger` / `.dd-label-text` 三个节点的身份**全程不变**，
    //   只有弹层子选项按新 options 重建（年份集合本来就会随筛选变）。
    //
    // 为什么必须是"认领"而不是"再 enhance 一次"：`enhance()` 见到 `select.__dd` 就
    //   return，所以只要由这里负责把 `__dd` 挂到新 select 上，既有的 enhance 就自动跳过，
    //   两条路不会打架。
    // ============================================================

    // 清掉指向"已脱离文档"的旧记录：`all` 原来只增不减，每切一次范围就多两条
    // 指向废弃 select 的记录（同一次重渲染的副产物）。这里在每次 scan 前顺手清一次。
    function pruneDetached() {
        if (all.length < 16) return;                 // 量小就不扫，避免每帧都过一遍
        var kept = [];
        for (var i = 0; i < all.length; i++) {
            var rec = all[i];
            if (rec.select && rec.select.isConnected) kept.push(rec);
            else if (rec.select && rec.select.__dd === rec) { try { delete rec.select.__dd; } catch (e) { rec.select.__dd = null; } }
        }
        all.length = 0;
        for (var j = 0; j < kept.length; j++) all.push(kept[j]);
    }

    // 把一个 select 的 value setter 包成"写入即同步自绘层"（与 enhance 里那段逐字等价）
    function bindValueWatcher(rec, select) {
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
        } catch (e) { /* 包不上就算了，change 那条路仍然能同步 */ }
    }

    // ★ 重渲染前调用：把 root 里所有自绘壳摘到游离容器 pen 里，返回 pen。
    //   摘下来而不是删掉 —— 节点身份、监听器、__dd 记录全在。
    function captureCustomDropdowns(root, pen) {
        if (!root || !root.querySelectorAll) return pen || null;
        pen = pen || document.createElement('div');
        var boxes = [].slice.call(root.querySelectorAll('.dd'));
        for (var i = 0; i < boxes.length; i++) {
            var box = boxes[i];
            var key = box.getAttribute('data-dd-for');
            // 认领用的钥匙：select 的 id。没有 data-dd-for 的壳（理论上不会有）就不动它，
            // 留给 enhance 的老路处理。
            if (key && box.parentNode) pen.appendChild(box);
        }
        return pen;
    }

    // ★ 重渲染后调用：把 pen 里的壳认领给 root 里新一批同 id 的 <select>。
    //   认领成功后 enhance() 会因为 `select.__dd` 已存在而跳过它 ⇒ 不会重复建壳、不会闪。
    function adoptCustomDropdowns(root, pen) {
        if (!root || !root.querySelectorAll || !pen) return 0;
        var boxes = [].slice.call(pen.querySelectorAll('.dd'));
        if (!boxes.length) return 0;
        var pool = {};
        for (var i = 0; i < boxes.length; i++) {
            var k = boxes[i].getAttribute('data-dd-for');
            if (k) (pool[k] || (pool[k] = [])).push(boxes[i]);
        }
        var sels = [].slice.call(root.querySelectorAll('select'));
        var n = 0;
        for (var j = 0; j < sels.length; j++) {
            var s = sels[j];
            if (!s.id || !pool[s.id] || !pool[s.id].length) continue;   // 没有可认领的壳 → 留给 enhance
            var old = s.__dd;
            if (old && old.select === s) continue;                      // 已经是它自己的壳了
            var box = pool[s.id].shift();
            var rec = box.__rec;
            if (!rec) continue;
            // ① 记录改指新 select；② 新 select 挂上同一个 rec，enhance 便会跳过它
            rec.select = s;
            s.__dd = rec;
            // ③ 把 enhance() 当初给这个 select 打的三样东西照原样补齐（**不能少**）：
            //    · `.dd-native` 带着 layout.css 里 `display:none !important`；
            //    · `tabindex="-1"` / `aria-hidden="true"` 让原生控件不进 Tab 序列、
            //      对读屏隐藏（无障碍交给自绘那层的 role="listbox"/aria-*）。
            //    少了这套，新的 select 就只剩 `@media (pointer: fine) { select { display:none } }`
            //    那一条兜着 —— 触屏/放宽媒体特性时就会冒出两个原生控件。
            try {
                s.classList.add('dd-native');
                s.setAttribute('tabindex', '-1');
                s.setAttribute('aria-hidden', 'true');
            } catch (e) { }
            // ④ value setter 要重新包到**新** select 实例上（旧实例已经不在文档里）
            bindValueWatcher(rec, s);
            // ⑤ 事件监听按元素重新挂（监听器是挂在旧 select 上的，新 select 没有）
            s.addEventListener('change', function () { sync(rec); });
            // ⑥ 挂回它该在的位置：新 select 之前（与 enhance 的插入位置一致）
            if (s.parentNode) s.parentNode.insertBefore(box, s);
            // ⑦ 弹层选项按新 select 重建 + 刷文字与选中态（.dd/.dd-trigger/.dd-label-text
            //    三个节点本身不动，所以不会闪；重建的只有 .dd-popup 的子选项）
            try { rebuild(rec); } catch (e) { try { sync(rec); } catch (e2) { } }
            n++;
        }
        return n;
    }

    // ---------- 自动接管全部 <select> ----------
    function scan() {
        pruneDetached();
        var list = document.querySelectorAll('select');
        for (var i = 0; i < list.length; i++) {
            // ★ 兜底：增强中途抛错时，这个 select 没有 .dd-native，会被 CSS 里那条
            //   "细指针环境提前藏掉原生 select"的规则藏起来 —— 那就是"什么都没有"。
            //   所以失败时显式放它出来（.dd-fail 在 layout.css 里）。
            try { enhance(list[i]); }
            catch (e) { try { list[i].classList.add('dd-fail'); } catch (e2) { } }
        }
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
    // ★ 同步建壳：`schedule()` 只排一帧 rAF（`if (raf) return` 还会被别的 rAF 吞掉），
    //   于是"整块重渲染后到建壳之间"那一帧会被画成空白。整块重渲染的调用方
    //   （special.js 的 renderTimelineContent）在写完 innerHTML 后同步调这个，
    //   壳与内容就在**同一个任务**里建好，那一帧根本不存在。
    //   （认领路径走通时其实不需要它，留作没有旧壳可认领时的兜底 —— 例如首次渲染。）
    window.refreshCustomDropdownsNow = scan;
    // ★ 保壳复用的一对入口，见上方长注释。只增不改：不传参/没壳时是彻底的空操作。
    window.captureCustomDropdowns = captureCustomDropdowns;
    window.adoptCustomDropdowns = adoptCustomDropdowns;
    // ★ 只读自检：`all` 实例表的长度。修内存泄漏前后都要能观察到这个数，
    //   verify-heatmap 用它断言"连续切换 20 次后不增长"。纯读，不影响任何行为。
    window.customDropdownStats = function () {
        return { instances: all.length, boxes: document.querySelectorAll('.dd').length };
    };
})();
