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

function darkenColor(color, ratio) {
    let rgb;
    if (color.startsWith('#')) {
        rgb = hexToRgb(color);
    } else if (color.startsWith('rgb')) {
        rgb = rgbStrToRgb(color);
    } else {
        return '#2c2418';
    }
    if (!rgb) return '#2c2418';
    const nr = Math.round(rgb.r * (1 - ratio));
    const ng = Math.round(rgb.g * (1 - ratio));
    const nb = Math.round(rgb.b * (1 - ratio));
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function applyTheme(color) {
    document.documentElement.style.setProperty('--theme', color);

    // 背景色系
    const lightBg = lightenColor(color, 0.92);
    document.documentElement.style.setProperty('--bg', lightBg);

    const lighterBg = lightenColor(color, 0.96);
    document.documentElement.style.setProperty('--bg-light', lighterBg);

    const sidebarBg = lightenColor(color, 0.86);
    document.documentElement.style.setProperty('--sidebar-bg', sidebarBg);

    const cardBg = '#ffffff';
    document.documentElement.style.setProperty('--card-bg', cardBg);

    // 边框
    const borderColor = lightenColor(color, 0.78);
    document.documentElement.style.setProperty('--border', borderColor);

    // 缩略图占位背景
    const thumbBg = lightenColor(color, 0.82);
    document.documentElement.style.setProperty('--thumb-bg', thumbBg);

    // 主题色变亮版本（搜索模式按钮等）
    const themeLight = lightenColor(color, 0.4);
    document.documentElement.style.setProperty('--theme-light', themeLight);

    // 文字颜色
    // 主文字：根据主题色亮度决定深色还是近似黑色
    const rgb = hexToRgb(color);
    const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    if (brightness < 128) {
        // 深色主题 -> 文字用浅色
        document.documentElement.style.setProperty('--text', '#f0ebe3');
        // 次要文字用更浅的
        document.documentElement.style.setProperty('--text-secondary', '#c4b8a8');
    } else {
        // 浅色主题 -> 文字用深色
        document.documentElement.style.setProperty('--text', '#2c2418');
        // 次要文字用中等深度（基于主题色混合）
        const secColor = lightenColor(darkenColor(color, 0.3), 0.3);
        document.documentElement.style.setProperty('--text-secondary', secColor);
    }
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
