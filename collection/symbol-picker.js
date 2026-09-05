// ==================== symbol-picker.js ====================
// 特殊字符面板：点击插入符号到搜索框（面板保持打开，支持连续输入）
// 关闭面板时自动恢复输入框焦点

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

    // 构建面板内容
    let html = '';
    for (const cat of SYMBOL_CATEGORIES) {
        html += `<div class="symbol-category">`;
        html += `<div class="symbol-category-title">${cat.name}</div>`;
        html += `<div class="symbol-grid">`;
        for (const ch of cat.chars) {
            html += `<span class="symbol-char" data-char="${ch}">${ch}</span>`;
        }
        html += `</div></div>`;
    }
    panel.innerHTML = html;

    // 切换面板
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('open');
        // 打开面板后，保持输入框焦点
        input.focus();
    });

    // 点击字符：插入到光标位置，触发搜索，保持面板打开
    panel.addEventListener('click', (e) => {
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

        // ★ 不关闭面板，让用户连续输入多个符号
        // panel.classList.remove('open');
    });

    // ★ 点击面板空白区域：阻止默认行为，防止输入框失去焦点
    panel.addEventListener('mousedown', (e) => {
        e.preventDefault();   // 避免点击面板空白处导致输入框失焦
        e.stopPropagation();
    });

    // 点击外部关闭面板，并聚焦输入框
    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && e.target !== toggleBtn) {
            panel.classList.remove('open');
            input.focus();   // 关闭后聚焦输入框
        }
    });

    // ESC 键关闭，并聚焦输入框
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel.classList.contains('open')) {
            panel.classList.remove('open');
            input.focus();
        }
    });
}