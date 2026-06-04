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
        return '#f5f0e8';
    }
    if (!rgb) return '#f5f0e8';
    const nr = Math.round(rgb.r + (255 - rgb.r) * ratio);
    const ng = Math.round(rgb.g + (255 - rgb.g) * ratio);
    const nb = Math.round(rgb.b + (255 - rgb.b) * ratio);
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function applyTheme(color) {
    // 主色调
    document.documentElement.style.setProperty('--theme', color);

    // 背景淡色（混合 92% 白色）
    const lightBg = lightenColor(color, 0.92);
    document.documentElement.style.setProperty('--bg', lightBg);

    // 更淡的背景（卡片、搜索栏用）
    const lighterBg = lightenColor(color, 0.96);
    document.documentElement.style.setProperty('--bg-light', lighterBg);

    // 侧边栏背景（比主背景略深）
    const sidebarBg = lightenColor(color, 0.86);
    document.documentElement.style.setProperty('--sidebar-bg', sidebarBg);

    // 边框色
    const borderColor = lightenColor(color, 0.78);
    document.documentElement.style.setProperty('--border', borderColor);
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
