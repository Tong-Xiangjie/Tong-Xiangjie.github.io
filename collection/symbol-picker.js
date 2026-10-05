// ==================== symbol-picker.js ====================
// 特殊字符面板

const SYMBOL_CATEGORIES = [
    {
        name: '特殊字符',
        chars: '{}〈〉〔〕★*'
    },
    {
        name: '罗马数字',
        chars: 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ'
    },
    {
        name: '分数',
        chars: '½¼¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞'
    },
    {
        name: '西里尔字母（大写）',
        chars: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯҐЄІЇЎ'
    },
    {
        name: '西里尔字母（小写）',
        chars: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяґєіїў'
    },
    {
        name: '希腊字母（大写）',
        chars: 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'
    },
    {
        name: '希腊字母（小写）',
        chars: 'αβγδεζηθικλμνξοπρστυφχψω'
    },
    {
        name: '注音符号',
        chars: 'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄧㄨㄩㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ'
    }
];

let panelOpen = false;
let panelHideTimer = 0;   // "收掉 display"的定时器，见 closePanel()

function initSymbolPicker() {
    const toggleBtn = document.getElementById('symbolToggle');
    const panel = document.getElementById('symbolPanel');
    const input = document.getElementById('searchInput');

    if (!toggleBtn || !panel || !input) return;

    // 透明遮罩层
    const overlay = document.createElement('div');
    overlay.id = 'symbolOverlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 49;
        background: transparent;
        pointer-events: none;
        display: none;
    `;
    document.body.appendChild(overlay);

    // 构建面板
    let html = '';
    for (const cat of SYMBOL_CATEGORIES) {
        html += `<div class="symbol-category">`;
        html += `<div class="symbol-category-title">${cat.name}</div>`;
        html += `<div class="symbol-grid">`;
        for (const ch of cat.chars) {
            const escaped = ch.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m));
            html += `<span class="symbol-char" data-char="${escaped}">${escaped}</span>`;
        }
        html += `</div></div>`;
    }
    panel.innerHTML = html;
    panel.style.zIndex = '50';

    function openPanel() {
        // 关到一半又被打开：把"收掉 display"的定时器清掉，否则会先隐后显闪一下
        clearTimeout(panelHideTimer);
        panel.classList.add('shown');
        // ★ 先让 display:block 结算一次，再挂 .open。否则"从 display:none 直接到目标样式"
        //   会在同一次样式计算里完成，浏览器拿不到 before-change style，动画根本不会播（硬切）。
        void panel.offsetHeight;
        panel.classList.add('open');
        overlay.style.display = 'block';
        overlay.style.pointerEvents = 'auto';
        panelOpen = true;
        input.focus();
    }

    function closePanel() {
        panel.classList.remove('open');   // 触发退出动画
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
        panelOpen = false;
        // ★ 动画期间面板还在布局里（还是 display:block），要等它跑完再真正收掉 ——
        //   留着它会继续被当成滚动容器（自绘滚动条会给它挂滑块）、继续吃点击。
        //   收掉的时机取动画时长（--dur-1 = 0.14s）再留一点余量。
        clearTimeout(panelHideTimer);
        panelHideTimer = setTimeout(function () {
            if (!panelOpen) panel.classList.remove('shown');
        // "减少动态效果"下 transition 是 none，退出是瞬时的，不用等
        }, (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) ? 0 : 180);
    }

    window.closeSymbolPanel = function() {
        if (panelOpen) closePanel();
    };

    toggleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (panelOpen) closePanel();
        else openPanel();
    });

    panel.addEventListener('click', function(e) {
        const target = e.target.closest('.symbol-char');
        if (!target) return;
        const char = target.dataset.char;
        if (!char) return;

        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        input.value = input.value.substring(0, start) + char + input.value.substring(end);
        input.setSelectionRange(start + char.length, start + char.length);
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    overlay.addEventListener('mousedown', function(e) {
        if (panelOpen) {
            e.stopPropagation();
            e.preventDefault();
            closePanel();
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && panelOpen) {
            closePanel();
            e.preventDefault();
        }
    });
}