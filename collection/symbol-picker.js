// ==================== symbol-picker.js ====================
// 特殊字符面板：面板打开时，点击任何地方关闭面板都保持输入框焦点

const SYMBOL_CATEGORIES = [
    {
        name: '特殊字符',
        chars: '{}〈〉★*'
    },
    {
        name: '罗马数字',
        chars: 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ'
    },
    {
        name: '分数',
        chars: '½¼¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞'
    },
    {
        name: '西里尔字母（大写）',
        chars: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
    },
    {
        name: '西里尔字母（小写）',
        chars: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
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

function initSymbolPicker() {
    const toggleBtn = document.getElementById('symbolToggle');
    const panel = document.getElementById('symbolPanel');
    const input = document.getElementById('searchInput');

    if (!toggleBtn || !panel || !input) return;

    // 判断面板是否打开
    function isPanelOpen() {
        return panel.classList.contains('open');
    }

    // 构建面板内容
    let html = '';
    for (const cat of SYMBOL_CATEGORIES) {
        html += `<div class="symbol-category">`;
        html += `<div class="symbol-category-title">${cat.name}</div>`;
        html += `<div class="symbol-grid">`;
        for (const ch of cat.chars) {
            const escaped = ch.replace(/[&<>]/g, function(m) {
                if (m === '&') return '&amp;';
                if (m === '<') return '&lt;';
                if (m === '>') return '&gt;';
                return m;
            });
            html += `<span class="symbol-char" data-char="${escaped}">${escaped}</span>`;
        }
        html += `</div></div>`;
    }
    panel.innerHTML = html;

    // 切换面板
    toggleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        panel.classList.toggle('open');
        // 打开面板后，输入框保持焦点
        input.focus();
    });

    // 点击符号：插入到光标位置，触发搜索，保持面板打开
    panel.addEventListener('click', function(e) {
        const target = e.target.closest('.symbol-char');
        if (!target) return;
        const char = target.dataset.char;
        if (!char) return;

        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const value = input.value;
        const newValue = value.substring(0, start) + char + value.substring(end);
        input.value = newValue;

        const newPos = start + char.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();

        // 触发 input 事件（适配实时搜索和点击搜索）
        input.dispatchEvent(new Event('input', { bubbles: true }));

        // 不关闭面板，让用户连续输入多个符号
    });

    // 点击面板空白区域：阻止失焦
    panel.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
    });

    // ★ 关键：点击任何地方，只要面板开着，关闭面板后都要保持输入框焦点
    document.addEventListener('mousedown', function(e) {
        // 如果面板没打开，不做任何干预
        if (!isPanelOpen()) return;

        // 如果点击的是面板内部 或 toggle 按钮，不处理（面板内部由上面的逻辑处理）
        if (panel.contains(e.target) || e.target === toggleBtn) return;

        // ★ 点击外部任何地方：关闭面板，然后强制保持输入框焦点
        panel.classList.remove('open');

        // 阻止浏览器默认的焦点转移行为
        e.preventDefault();

        // 手动将焦点还给输入框（用 setTimeout 确保在所有事件处理完成后执行）
        setTimeout(function() {
            input.focus();
        }, 0);
    });

    // ESC 键关闭并保持焦点
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isPanelOpen()) {
            panel.classList.remove('open');
            input.focus();
            e.preventDefault();
        }
    });
}