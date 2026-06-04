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

function applyTheme(color) {
    document.documentElement.style.setProperty('--theme', color);

    const lightBg = lightenColor(color, 0.92);
    document.documentElement.style.setProperty('--bg', lightBg);

    const lighterBg = lightenColor(color, 0.96);
    document.documentElement.style.setProperty('--bg-light', lighterBg);

    const sidebarBg = lightenColor(color, 0.86);
    document.documentElement.style.setProperty('--sidebar-bg', sidebarBg);

    const borderColor = lightenColor(color, 0.78);
    document.documentElement.style.setProperty('--border', borderColor);

    const thumbBg = lightenColor(color, 0.82);
    document.documentElement.style.setProperty('--thumb-bg', thumbBg);

    // 主题色变亮版本（用于搜索模式切换按钮等）
    const themeLight = lightenColor(color, 0.3);
    document.documentElement.style.setProperty('--theme-light', themeLight);
}

function loadTheme() {
    const saved = localStorage.getItem('app-theme') || defaultTheme;
    applyTheme(saved);
}

function setTheme(color) {
    applyTheme(color);
    localStorage.setItem('app-theme', color);
}

document.addEventListener('DOMContentLoaded', loadTheme);
