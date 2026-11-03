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

function applyColorScheme(animate) {
    const dark = isDarkScheme();
    const el = document.documentElement;
    withThemeAnim(function () {
        el.setAttribute('data-color-scheme', dark ? 'dark' : 'light');
        el.style.colorScheme = dark ? 'dark' : 'light';   // 让原生控件/滚动条跟着变
        // 底色变了，整套调色板要重算
        applyTheme(localStorage.getItem('app-theme') || defaultTheme);
    }, animate);
}

// ★ 明暗/主题色切换的"补间窗口"。
//   整套配色是 CSS 变量，变量换值是**瞬间**的，所以吃变量的地方（背景、边框、
//   文字、柱状图底色）会一起跳 —— 用户报的"切换白天黑夜时有些框的背景色突变"。
//   layout.css 里用 @property 把这些颜色变量注册成可插值类型并加了过渡，
//   这里只负责在切换的那一小段时间挂上 .theme-anim，切完摘掉。
//   常驻不行：会让以后每次改这些变量都变慢，hover 反馈也会发糊。
//   减弱动效时不挂（CSS 那边也有 @media 兜底），直接到位。
const THEME_ANIM_CLASS = 'theme-anim';
const THEME_ANIM_MS = 320;          // 比 --dur-3(0.3s) 略长，保证过渡跑完再摘类
let themeAnimTimer = 0;

function themeAnimAllowed() {
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function withThemeAnim(fn, animate) {
    const el = document.documentElement;
    const on = (animate !== false) && themeAnimAllowed();
    if (on) {
        el.classList.add(THEME_ANIM_CLASS);
        // ★ 强制一次样式结算：让浏览器把"变量带过渡"这件事记进变化前的样式。
        //   不加这一下，挂类和改变量发生在同一个任务里，Chrome 有可能直接给出
        //   最终值（视作"没有过渡"），补间就时有时无。
        void el.offsetWidth;
    }
    try {
        return fn();
    } finally {
        if (on) {
            if (themeAnimTimer) clearTimeout(themeAnimTimer);
            themeAnimTimer = setTimeout(function () {
                themeAnimTimer = 0;
                el.classList.remove(THEME_ANIM_CLASS);
            }, THEME_ANIM_MS);
        }
    }
}

function setColorSchemeMode(mode) {
    if (COLOR_SCHEME_MODES.indexOf(mode) < 0) return;
    try { localStorage.setItem(COLOR_SCHEME_KEY, mode); } catch (e) {}
    applyColorScheme(true);
    // 山河地图的颜色是 JS 算出来写进 SVG 的，得让它重算
    if (typeof window.refreshShanheColors === 'function') {
        window.refreshShanheColors();
    }
}

function setUIStyle(style) {
    if (UI_STYLE_MODES.indexOf(style) < 0) return;
    try { localStorage.setItem(UI_STYLE_KEY, style); } catch (e) {}
    if (style === 'glass') ensureGlassOrbs(true); else stopGlassOrbDrift();
    // 和明暗/主题色一样走补间窗口：整套变量一起变，不补间页面会"跳"
    withThemeAnim(function () { applyTheme(localStorage.getItem('app-theme') || defaultTheme); });
    if (typeof window.refreshShanheColors === 'function') {
        window.refreshShanheColors();
    }
}

// 跟随系统时，系统切换了要跟着变
function watchSystemColorScheme() {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () {
        if (getColorSchemeMode() === 'system') applyColorScheme(true);
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
}

// ========== 界面风格（标准 / 透明玻璃） ==========
// ★ 和「明暗」「主题色」并列的第三个正交维度：明暗管亮/暗，主题色管色相，
//   界面风格管"面板是实色还是磨砂玻璃"。三者互不影响（11 预设色 × 明暗 × 风格）。
//   玻璃模式的变量必须**分层**：只有 body 有实色底纹，面板是半透明 + blur；
//   若把 --bg 也直接半透明，两层半透明叠加会发浑，而且后面没有东西可"磨砂"。
const UI_STYLE_KEY = 'collection-ui-style';
const UI_STYLE_MODES = ['standard', 'glass'];

function getUIStyle() {
    try {
        const v = localStorage.getItem(UI_STYLE_KEY);
        return UI_STYLE_MODES.indexOf(v) >= 0 ? v : 'standard';
    } catch (e) {
        return 'standard';
    }
}

function isGlassStyle() { return getUIStyle() === 'glass'; }

// hex → rgba（玻璃模式专用）。只处理 #rgb / #rrggbb，和 head 里那份镜像保持一致；
// 用 rgba(x,y,z,0) 而不是字面量 transparent：部分引擎对 hex→transparent 的插值会"渐隐成黑"。
function withAlpha(hex, a) {
    const h = String(hex).replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

// ★ 背景层（液体玻璃的底），三件事必须说清楚：
//   1) 尺寸/位置/浓淡/形状只能由 JS 生成 —— CSS 随机不了；
//   2) 轨迹**不能用 CSS 关键帧**：关键帧路径固定， alternate 来回跑必然可预测。
//      改成 JS 逐帧：朝随机目标点缓动，到达后重新随机 ⇒ 轨迹是永不重复的折线；
//      同时**平移 + 旋转 + 缩放**（所以球有圆/椭圆/条三种形状，条的旋转才看得出）；
//   3) **数量也在变**：每个球有随机寿命，到点淡出移除、同时补一个新的。
function orbRnd(a, b) { return a + Math.random() * (b - a); }

function spawnGlassOrb() {
    try {
        var host = window.__glassOrbHost;
        if (!host) return;
        var o = document.createElement('i');
        var r = Math.random(), w, h;
        if (r < 0.45) { w = orbRnd(22, 60); h = w * orbRnd(0.9, 1.1); }        // 圆
        else if (r < 0.8) { w = orbRnd(34, 78); h = w * orbRnd(0.26, 0.5); }   // 横条（旋转看得见）
        else { w = orbRnd(16, 32); h = w * orbRnd(1.6, 2.6); }                 // 竖条
        o.style.left = orbRnd(-15, 95).toFixed(1) + '%';
        o.style.top = orbRnd(-15, 95).toFixed(1) + '%';
        o.style.width = w.toFixed(1) + 'vmin';
        o.style.height = h.toFixed(1) + 'vmin';
        o.style.background = (Math.random() < 0.5)
            ? 'radial-gradient(closest-side, var(--theme), transparent 72%)'
            : 'radial-gradient(closest-side, var(--theme-light), transparent 72%)';
        o.style.opacity = '0';
        o.style.transition = 'opacity ' + orbRnd(3, 7).toFixed(1) + 's ease-in-out';
        o.style.transform = 'translate3d(0,0,0) rotate(0deg) scale(1)';
        host.appendChild(o);
        var st = {
            el: o, x: 0, y: 0, tx: orbRnd(-20, 20), ty: orbRnd(-20, 20), k: orbRnd(0.0012, 0.005),
            rot: orbRnd(0, 360), vr: orbRnd(-0.09, 0.09),
            sc: 1, ts: orbRnd(0.85, 1.25), ks: orbRnd(0.002, 0.006),
            life: orbRnd(9000, 26000), born: Date.now()
        };
        window.__glassOrbState.push(st);
        requestAnimationFrame(function () { try { o.style.opacity = String(Math.round(orbRnd(22, 46)) / 100); } catch (e) { } });
    } catch (e) { }
}

function recycleGlassOrb(st) {
    try {
        st.el.style.opacity = '0';
        var el = st.el;
        setTimeout(function () { try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) { } }, 7000);
        var arr = window.__glassOrbState, i = arr.indexOf(st);
        if (i >= 0) arr.splice(i, 1);
        spawnGlassOrb();   // 补一个新的 ⇒ 死掉一个、生一个，数量在波动
    } catch (e) { }
}

function ensureGlassOrbs(rebuild) {
    try {
        var host = document.getElementById('glassOrbs');
        if (host && !rebuild) return;
        if (host) { while (host.firstChild) host.removeChild(host.firstChild); }
        else {
            host = document.createElement('div');
            host.id = 'glassOrbs';
            host.setAttribute('aria-hidden', 'true');
            document.body.appendChild(host);
        }
        window.__glassOrbHost = host;
        window.__glassOrbState = [];
        var n = 4 + Math.floor(Math.random() * 4);   // 起始 4~7 个
        for (var i = 0; i < n; i++) spawnGlassOrb();
        startGlassOrbDrift();
    } catch (e) { }
}

var __orbRaf = 0;
function startGlassOrbDrift() {
    if (__orbRaf) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (document.hidden) return;
    var step = function () {
        var orbs = window.__glassOrbState || [];
        var now = Date.now();
        for (var i = orbs.length - 1; i >= 0; i--) {
            var o = orbs[i];
            if (now - o.born > o.life) { o.life = Infinity; recycleGlassOrb(o); continue; }
            if (Math.abs(o.tx - o.x) < 0.6 && Math.abs(o.ty - o.y) < 0.6) {
                o.tx = (Math.random() * 2 - 1) * 22;      // 到了就换下一个随机目标
                o.ty = (Math.random() * 2 - 1) * 22;
                o.k = 0.0012 + Math.random() * 0.0045;
                o.vr = (Math.random() * 2 - 1) * 0.09;    // 角速度也随机变
            }
            o.x += (o.tx - o.x) * o.k;
            o.y += (o.ty - o.y) * o.k;
            o.rot += o.vr;
            if (o.rot > 360) o.rot -= 360;
            if (o.rot < 0) o.rot += 360;
            if (Math.random() < 0.004) o.ts = 0.85 + Math.random() * 0.4;
            o.sc += (o.ts - o.sc) * o.ks;
            o.el.style.transform = 'translate3d(' + o.x.toFixed(2) + 'vmax,' + o.y.toFixed(2) + 'vmax,0) rotate(' + o.rot.toFixed(1) + 'deg) scale(' + o.sc.toFixed(3) + ')';
        }
        __orbRaf = requestAnimationFrame(step);
    };
    __orbRaf = requestAnimationFrame(step);
}
function stopGlassOrbDrift() {
    if (__orbRaf) { cancelAnimationFrame(__orbRaf); __orbRaf = 0; }
}
// ★ 减弱动效可能在**运行中**被打开（系统设置里改、或省的 API 切），所以不能只在启动时判断一次：
//   媒体查询一变就停/启。用户实测报过"开了减弱动效球还在动"。
try {
    var mqReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var onReduceMotionChange = function () {
        if (mqReduceMotion.matches) stopGlassOrbDrift();
        else if (document.documentElement.getAttribute('data-ui-style') === 'glass') startGlassOrbDrift();
    };
    if (typeof mqReduceMotion.addEventListener === 'function') mqReduceMotion.addEventListener('change', onReduceMotionChange);
    else if (typeof mqReduceMotion.addListener === 'function') mqReduceMotion.addListener(onReduceMotionChange);
} catch (e) { }

document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopGlassOrbDrift();
    else if (document.documentElement.getAttribute('data-ui-style') === 'glass') startGlassOrbDrift();
});

function applyTheme(color) {
    const dark = isDarkScheme();
    const glass = isGlassStyle();
    const el = document.documentElement;

    // 让 CSS 能按风格分流（玻璃模式的规则全部挂在 html[data-ui-style="glass"] 上）
    el.setAttribute('data-ui-style', glass ? 'glass' : 'standard');
    if (glass) ensureGlassOrbs(false); else stopGlassOrbDrift();

    // 强调色本身不变：变了会让「主题色实心按钮 + 白字」的对比度掉下来
    el.style.setProperty('--theme', color);
    // 悬停/描边用的浅强调色，暗色下要更亮才看得见
    el.style.setProperty('--theme-light', dark ? lightenColor(color, 0.35) : lightenColor(color, 0.4));

    // ★ "整行悬停底色"必须按模式**反着来**：浅色加深、深色提亮。
    //   原来 CSS 里统一写 rgba(0,0,0,0.04~0.05)，深色下等于
    //   rgb(1,7,15) → rgb(0,6,14)，实测对比度 1.005 —— 完全没有反馈。
    //
    //   这里是**半透明 overlay**而不是按主题色派生的实色，原因是实测出来的：
    //   实色是按某一个基色（如 --bg）算出来的，铺到别的底色上变化会变小 ——
    //   按 --bg 派生的实色在页面上有 1.40，落到侧边栏底色上只剩 1.11。
    //   半透明 overlay 铺在四种真实底色（--bg / --bg-light / --sidebar-bg /
    //   --card-bg）上的实测对比度：
    //     深色 白色 0.14 → 1.39 ~ 1.47
    //     浅色 黑色 0.10 → 1.25 ~ 1.25
    //   四种底色几乎一致，所以不需要按元素分别算，也不需要跟着主题色重算。
    el.style.setProperty('--row-hover-bg', dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)');

    if (dark) {
        // 暗色：底色往黑里压（保留主题色倾向），文字反过来
        // ★ --bg-solid 是玻璃模式的"兜底实色"（--bg 在玻璃下是 rgba(...,0)，很多地方还需要一个实色）
        el.style.setProperty('--bg-solid', darkenColor(color, 0.94));
        el.style.setProperty('--bg', glass ? withAlpha(darkenColor(color, 0.94), 0) : darkenColor(color, 0.94));
        el.style.setProperty('--bg-light', glass ? withAlpha(darkenColor(color, 0.90), 0.55) : darkenColor(color, 0.90));
        el.style.setProperty('--sidebar-bg', glass ? withAlpha(darkenColor(color, 0.92), 0.50) : darkenColor(color, 0.92));
        // ★ 卡片/次级底：比 --bg 亮一档，否则卡片和背景对比度只有 1.03:1（几乎分不开）
        el.style.setProperty('--card-bg', glass ? withAlpha(darkenColor(color, 0.86), 0.55) : darkenColor(color, 0.86));
        // ★ 边界色：纯乘法压暗会把 --border 压到和 --bg 只差 1.3:1（11 个预设色全部如此），
        //   输入框、卡片、返回按钮的边框在暗色下全部"消失"。
        //   实测：darken(0.70) 后再提亮 0.30，全色板才够 WCAG 1.4.11 要求的 3:1
        //   （只提亮 0.18 只有 2.0~2.6:1，仍不达标）。
        el.style.setProperty('--border', glass ? 'rgba(255,255,255,0.14)' : lightenColor(darkenColor(color, 0.70), 0.30));
        el.style.setProperty('--thumb-bg', glass ? withAlpha(darkenColor(color, 0.80), 0.45) : darkenColor(color, 0.80));
        el.style.setProperty('--text', '#e8eaed');
        el.style.setProperty('--text-secondary', '#9aa0a6');
    } else {
        el.style.setProperty('--bg-solid', lightenColor(color, 0.92));
        el.style.setProperty('--bg', glass ? withAlpha(lightenColor(color, 0.92), 0) : lightenColor(color, 0.92));
        el.style.setProperty('--bg-light', glass ? withAlpha(lightenColor(color, 0.96), 0.60) : lightenColor(color, 0.96));
        el.style.setProperty('--sidebar-bg', glass ? withAlpha(lightenColor(color, 0.86), 0.55) : lightenColor(color, 0.86));
        el.style.setProperty('--card-bg', glass ? 'rgba(255,255,255,0.62)' : '#ffffff');
        el.style.setProperty('--border', glass ? 'rgba(255,255,255,0.80)' : lightenColor(color, 0.78));
        el.style.setProperty('--thumb-bg', glass ? withAlpha(lightenColor(color, 0.82), 0.50) : lightenColor(color, 0.82));
        el.style.setProperty('--text', '#000000');
        el.style.setProperty('--text-secondary', '#666666');
    }
}

function loadTheme() {
    // ★ 初始化不补间：这时候 head 里的内联脚本已经把同样的值写好了，
    //   补间不但没意义，还会在首屏多挂一个类。
    applyColorScheme(false);
}

// ★ 修改：切换主题后主动刷新地图颜色
function setTheme(color) {
    // 换主题色也是一整套配色在换，同样补间（不然色块点了之后页面是跳的）
    withThemeAnim(function () { applyTheme(color); });
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