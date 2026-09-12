const defaultTheme = '#1677ff';

function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
    };
}

function rgbStrToRgb(rgb) {
    const m = rgb.match(/\d+/g);
    if (!m) return null;
    return { r: parseInt(m[0]), g: parseInt(m[1]), b: parseInt(m[2]) };
}

function lightenColor(color, ratio) {
    let rgb;
    if (color.startsWith('#')) {
        rgb = hexToRgb(color);
    } else if (color.startsWith('rgb')) {
        rgb = rgbStrToRgb(color);
    } else {
        return '#f0ebe3';
    }
    if (!rgb) return '#f0ebe3';
    const nr = Math.round(rgb.r + (255 - rgb.r) * ratio);
    const ng = Math.round(rgb.g + (255 - rgb.g) * ratio);
    const nb = Math.round(rgb.b + (255 - rgb.b) * ratio);
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

// 暗色模式的底色：把主题色往黑里混，保持"整套配色都带主题色倾向"的既有观感
function darkenColor(color, ratio) {
    let rgb;
    if (color.startsWith('#')) {
        rgb = hexToRgb(color);
    } else if (color.startsWith('rgb')) {
        rgb = rgbStrToRgb(color);
    } else {
        return '#14161a';
    }
    if (!rgb) return '#14161a';
    const f = 1 - ratio;
    const nr = Math.round(rgb.r * f), ng = Math.round(rgb.g * f), nb = Math.round(rgb.b * f);
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

// ========== 明暗外观（跟随系统 / 亮 / 暗） ==========
// ★ 注意：整套配色是 applyTheme() 用**内联样式**写到 documentElement 上的，
//   内联优先级高于任何样式表规则 —— 所以暗色不能只靠 CSS 覆盖变量，必须也在这里算。
//   layout.css 里那份 html[data-color-scheme="dark"] 只是"JS 跑起来之前的底色"，
//   用来避免暗色下先闪一下白屏。
const COLOR_SCHEME_KEY = 'collection-color-scheme';
const COLOR_SCHEME_MODES = ['system', 'light', 'dark'];

function getColorSchemeMode() {
    try {
        const m = localStorage.getItem(COLOR_SCHEME_KEY);
        return COLOR_SCHEME_MODES.indexOf(m) >= 0 ? m : 'system';
    } catch (e) {
        return 'system';
    }
}

function isDarkScheme() {
    const mode = getColorSchemeMode();
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyColorScheme() {
    const dark = isDarkScheme();
    const el = document.documentElement;
    el.setAttribute('data-color-scheme', dark ? 'dark' : 'light');
    el.style.colorScheme = dark ? 'dark' : 'light';   // 让原生控件/滚动条跟着变
    // 底色变了，整套调色板要重算
    applyTheme(localStorage.getItem('app-theme') || defaultTheme);
}

function setColorSchemeMode(mode) {
    if (COLOR_SCHEME_MODES.indexOf(mode) < 0) return;
    try { localStorage.setItem(COLOR_SCHEME_KEY, mode); } catch (e) {}
    applyColorScheme();
    // 山河地图的颜色是 JS 算出来写进 SVG 的，得让它重算
    if (typeof window.refreshShanheColors === 'function') {
        window.refreshShanheColors();
    }
}

// 跟随系统时，系统切换了要跟着变
function watchSystemColorScheme() {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () {
        if (getColorSchemeMode() === 'system') applyColorScheme();
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
}

function applyTheme(color) {
    const dark = isDarkScheme();
    const el = document.documentElement;

    // 强调色本身不变：变了会让「主题色实心按钮 + 白字」的对比度掉下来
    el.style.setProperty('--theme', color);
    // 悬停/描边用的浅强调色，暗色下要更亮才看得见
    el.style.setProperty('--theme-light', dark ? lightenColor(color, 0.35) : lightenColor(color, 0.4));

    if (dark) {
        // 暗色：底色往黑里压（保留主题色倾向），文字反过来
        el.style.setProperty('--bg', darkenColor(color, 0.94));
        el.style.setProperty('--bg-light', darkenColor(color, 0.90));
        el.style.setProperty('--sidebar-bg', darkenColor(color, 0.92));
        el.style.setProperty('--card-bg', darkenColor(color, 0.90));
        el.style.setProperty('--border', darkenColor(color, 0.70));
        el.style.setProperty('--thumb-bg', darkenColor(color, 0.80));
        el.style.setProperty('--text', '#e8eaed');
        el.style.setProperty('--text-secondary', '#9aa0a6');
    } else {
        el.style.setProperty('--bg', lightenColor(color, 0.92));
        el.style.setProperty('--bg-light', lightenColor(color, 0.96));
        el.style.setProperty('--sidebar-bg', lightenColor(color, 0.86));
        el.style.setProperty('--card-bg', '#ffffff');
        el.style.setProperty('--border', lightenColor(color, 0.78));
        el.style.setProperty('--thumb-bg', lightenColor(color, 0.82));
        el.style.setProperty('--text', '#000000');
        el.style.setProperty('--text-secondary', '#666666');
    }
}

function loadTheme() {
    applyColorScheme();
}

// ★ 修改：切换主题后主动刷新地图颜色
function setTheme(color) {
    applyTheme(color);
    localStorage.setItem('app-theme', color);

    // 若地图颜色刷新函数已定义，则调用它
    if (typeof window.refreshShanheColors === 'function') {
        window.refreshShanheColors();
    }
}

// ========== 自定义颜色管理 ==========
function getCustomColors() {
    try {
        const stored = localStorage.getItem('custom-theme-colors');
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function addCustomColor(color) {
    const colors = getCustomColors();
    if (colors.includes(color)) return;   // 已经有了就当作无事发生（幂等）
    // 不设数量上限：本站就自己用，几个色块而已。
    // （原先上限 20 个、超了弹 alert()，既打断操作又和全站风格断裂，已去掉）
    colors.push(color);
    localStorage.setItem('custom-theme-colors', JSON.stringify(colors));
}

function removeCustomColor(index) {
    const colors = getCustomColors();
    if (index < 0 || index >= colors.length) return;
    colors.splice(index, 1);
    localStorage.setItem('custom-theme-colors', JSON.stringify(colors));
    if (typeof renderSettingsPage === 'function') {
        renderSettingsPage();
    }
}

document.addEventListener('DOMContentLoaded', function () {
    watchSystemColorScheme();
    loadTheme();
});