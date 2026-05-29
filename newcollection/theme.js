const defaultTheme = '#1677ff';

function loadTheme() {
    const saved = localStorage.getItem('app-theme') || defaultTheme;
    document.documentElement.style.setProperty('--theme', saved);
}

function setTheme(color) {
    document.documentElement.style.setProperty('--theme', color);
    localStorage.setItem('app-theme', color);
}

document.addEventListener('DOMContentLoaded', loadTheme);
