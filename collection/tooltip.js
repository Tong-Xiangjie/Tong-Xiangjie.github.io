// 自定义悬浮提示：替换浏览器原生那个 title 气泡（用户："鼠标悬浮的时候有时会出现一个框框
// 显示文字，那个东西叫什么来着，能不能也自己写一个，原生的有点丑"，
// 以及"那个框框出现和消失的时候可以考虑加一点动画"）。
//
// 那个东西的正式名字是 **tooltip**：浏览器读到元素的 title 属性，悬停一会儿（约 1 秒）就
// 画一个系统样式的小方块 —— 字体、圆角、延迟、位置全由浏览器决定，样式改不了，所以只能自己画。
//
// 做法（一个自包含模块，不改任何现有元素的 HTML）：
//   · 鼠标移上去（mouseover 冒泡 / 键盘 focusin）找到最近的 [title]，**立刻把 title 挪走**
//     存进 data-tip —— 原生气泡就不会再弹了；离开时再挪回去（留着给读屏软件和测试用）。
//   · 悬停 380ms 才显示（原生约 1s，太慢）；显示/隐藏都走 CSS 过渡（进 140ms、退 180ms，
//     用户要求"出现和消失都可以加一点动画"）。
//   · 默认显示在元素正上方、水平居中；上面放不下就翻到下方；横向夹在视口里；小三角指向元素。
//   · 滚动 / 点击 / Esc / 失焦 / 改窗口大小 都收起（气泡是 fixed 定位，不跟着滚会飘）。
//   · 样式在下面一段 <style> 里注入：这是唯一一处"CSS 不在 layout.css"的地方 —— 为了让整个
//     功能只动一个新文件，不和那份 4000 行的样式表打架。
(function () {
    'use strict';
    var SHOW_DELAY = 380;     // 悬停多久才弹
    var HIDE_WAIT = 200;      // 退场动画时长（要大略等于 CSS 里那条 0.18s）
    var tipEl = null;
    var cur = null;           // 当前挂着的元素
    var showTimer = 0;
    var hideTimer = 0;
    var rafId = 0;
    // 鼠标位置（用户："有时候出现的地方会距离鼠标有点远" —— 原来按**元素矩形**居中，
    // 元素一宽（整行、整块卡片），鼠标在左边、气泡却跑到中间去了）。改成贴着鼠标放。
    var mouse = { x: 0, y: 0, ok: false };

    function onMove(e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.ok = true;
        // 已经弹出来的：跟着鼠标走（rAF 合并，别每个 mousemove 都排版）
        if (!cur || !tipEl || !tipEl.classList.contains('tip-in')) return;
        if (rafId) return;
        rafId = requestAnimationFrame(function () {
            rafId = 0;
            if (cur && tipEl && tipEl.classList.contains('tip-in')) place(cur, tipEl);
        });
    }

    var CSS = [
        '.dsh-tip {',
        '  position: fixed;',
        '  z-index: 99999;',
        '  max-width: 360px;',
        '  padding: 6px 10px;',
        '  border-radius: 8px;',
        '  background: var(--bg-light, rgba(26, 26, 30, 0.96));',
        '  color: var(--text, #f4f4f7);',
        '  border: 1px solid var(--border, rgba(255, 255, 255, 0.14));',
        '  font-size: 0.78rem;',
        '  line-height: 1.45;',
        '  white-space: normal;',
        '  word-break: break-word;',
        '  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);',
        '  pointer-events: none;',
        '  opacity: 0;',
        '  visibility: hidden;',
        '  transform: translateY(4px) scale(0.97);',
        '  transition: opacity 0.18s ease, transform 0.18s ease, visibility 0s linear 0.18s;',
        '}',
        '.dsh-tip.tip-in {',
        '  opacity: 1;',
        '  visibility: visible;',
        '  transform: translateY(0) scale(1);',
        '  transition: opacity 0.14s ease, transform 0.14s ease, visibility 0s linear 0s;',
        '}',
        '.dsh-tip::after {',
        '  content: "";',
        '  position: absolute;',
        '  width: 8px;',
        '  height: 8px;',
        '  background: inherit;',
        '  border: 1px solid var(--border, rgba(255, 255, 255, 0.14));',
        '  transform: rotate(45deg);',
        '  border-radius: 1px;',
        '}',
        // 小三角只留朝着外面那两条边（用户："小三角目前缺了主题色描边"）：
        // 气泡在上方 → 箭头朝下 → 留右下两条边；气泡在下方 → 箭头朝上 → 留左上两条边。
        // 边长 = 8px + 两边各 1px 描边 = 10px，所以偏移用 -5px 才能正好骑在气泡边上。
        '.dsh-tip.tip-above::after { bottom: -5px; left: var(--tip-ax, 50%); margin-left: -5px; border-top: 0; border-left: 0; }',
        '.dsh-tip.tip-below::after { top: -5px; left: var(--tip-ax, 50%); margin-left: -5px; border-bottom: 0; border-right: 0; }'
    ].join('\n');

    function injectStyle() {
        if (document.getElementById('dsh-tip-style')) return;
        var s = document.createElement('style');
        s.id = 'dsh-tip-style';
        s.textContent = CSS;
        (document.head || document.documentElement).appendChild(s);
    }

    function ensureEl() {
        if (tipEl) return tipEl;
        tipEl = document.createElement('div');
        tipEl.className = 'dsh-tip';
        tipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(tipEl);
        return tipEl;
    }

    function textOf(el) {
        if (!el || !el.getAttribute) return '';
        var t = el.getAttribute('data-tip');
        if (t == null) t = el.getAttribute('title');
        return String(t || '').trim();
    }

    // 把 title 藏进 data-tip：原生气泡就不会弹了（离开时挪回去）
    function stash(el) {
        if (!el || !el.getAttribute) return;
        if (el.hasAttribute('title')) {
            el.setAttribute('data-tip', el.getAttribute('title'));
            el.removeAttribute('title');
        }
    }
    function unstash(el) {
        if (!el || !el.getAttribute) return;
        if (el.hasAttribute('data-tip') && !el.hasAttribute('title')) {
            // 只有"是我们挪走的"才挪回去：自带 data-tip 的元素保持原样
            el.setAttribute('title', el.getAttribute('data-tip'));
            el.removeAttribute('data-tip');
        }
    }

    function place(el, tip) {
        var r = el.getBoundingClientRect();
        var tw = tip.offsetWidth;
        var th = tip.offsetHeight;
        var vw = window.innerWidth || document.documentElement.clientWidth;
        var vh = window.innerHeight || document.documentElement.clientHeight;
        // 锚点：有鼠标就用**鼠标位置**；键盘 focus 进来的没有鼠标，退回元素中心/上沿。
        var ax0 = mouse.ok ? mouse.x : (r.left + r.width / 2);
        var ay0 = mouse.ok ? mouse.y : r.top;
        var above = ay0 - th - 14 >= 6;
        var top = above ? (ay0 - th - 14) : (ay0 + 20);
        var left = ax0 - tw / 2;
        var minLeft = 8;
        var maxLeft = vw - tw - 8;
        if (left < minLeft) left = minLeft;
        if (left > maxLeft) left = maxLeft;
        if (top + th > vh - 6) top = Math.max(6, vh - th - 6);
        if (top < 6) top = 6;
        tip.style.top = Math.round(top) + 'px';
        tip.style.left = Math.round(left) + 'px';
        // 小三角对准锚点（在气泡内部的坐标）
        var ax = Math.round(ax0 - left);
        if (ax < 8) ax = 8;
        if (ax > tw - 8) ax = tw - 8;
        tip.style.setProperty('--tip-ax', ax + 'px');
        tip.classList.toggle('tip-above', above);
        tip.classList.toggle('tip-below', !above);
    }

    function show(el) {
        var txt = textOf(el);
        if (!txt) return;
        injectStyle();
        var tip = ensureEl();
        tip.textContent = txt;
        tip.style.display = 'block';
        place(el, tip);
        // 先量再开过渡：新节点直接加 .tip-in 有时不触发（同一帧内样式合并）
        void tip.offsetWidth;
        tip.classList.add('tip-in');
        cur = el;
    }

    function hide() {
        if (showTimer) { clearTimeout(showTimer); showTimer = 0; }
        if (!tipEl) return;
        tipEl.classList.remove('tip-in');
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            hideTimer = 0;
            if (tipEl && !tipEl.classList.contains('tip-in')) tipEl.style.display = 'none';
        }, HIDE_WAIT);
        if (cur) { unstash(cur); cur = null; }
    }

    function findTarget(node) {
        var el = node;
        while (el && el.nodeType === 1) {
            if (el.hasAttribute && (el.hasAttribute('title') || el.hasAttribute('data-tip'))) {
                return textOf(el) ? el : null;
            }
            el = el.parentNode;
        }
        return null;
    }

    function onOver(e) {
        var el = findTarget(e.target);
        if (!el || el === cur) return;
        hide();
        stash(el);
        if (showTimer) clearTimeout(showTimer);
        showTimer = setTimeout(function () {
            showTimer = 0;
            if (!el.isConnected) return;
            show(el);
        }, SHOW_DELAY);
    }

    function onOut(e) {
        var el = findTarget(e.target);
        if (!el) return;
        // 移到子元素上不算离开
        var to = e.relatedTarget;
        if (to && el.contains && el.contains(to)) return;
        hide();
    }

    injectStyle();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onOver, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('click', hide, true);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) hide();
    }, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    // 给测试/控制台一个显式入口
    window.dshTooltip = {
        show: function (el) { stash(el); show(el); },
        hide: hide,
        get el() { return tipEl; }
    };
})();
