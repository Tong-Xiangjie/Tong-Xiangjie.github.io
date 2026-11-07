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

// ★ 这一次 applyTheme 是"初始化落值"还是"用户改主题"。
//   区分它是因为底下的溶解遮罩是**整屏不透明**的：开屏时铺上去，盖的正好是加载屏，
//   实测（screencast 逐帧）t≈120ms 铺上 --bg-solid、360ms 才淡完，加载文字
//   在"正在准备 → 进度条"那一下整整消失 100ms 以上再淡回来 —— 用户报的"文字闪一下"。
//   只有用户主动改主题才该看到溶解，初始化这一趟本来就该一步到位
//   （loadTheme() 的注释也是这个意思：初始化不补间）。
let themeInitCall = false;

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
    // ★ animate === false 就是"初始化"（loadTheme → applyColorScheme(false)）。
    //   存旧值再还原，别把嵌套调用里的用户操作也一起误判成初始化。
    const prevInitCall = themeInitCall;
    themeInitCall = (animate === false);
    try {
        return fn();
    } finally {
        themeInitCall = prevInitCall;
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
    // ★ 玻璃开关的"突变"：模糊/透明是瞬间换的（CSS 变量本身不会过渡）。
    //   这里在切换期间挂一个 glass-switching 类，由 CSS 给出 backdrop-filter / 背景 / 阴影 的过渡，
    //   350ms 后摘掉，避免影响其它交互。
    var root = document.documentElement;
    try { root.classList.add('glass-switching'); } catch (e) { }
    setTimeout(function () { try { root.classList.remove('glass-switching'); } catch (e) { } }, 380);
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

// ★ 背景层（液态玻璃的底），三件事必须说清楚：
//   1) 尺寸/位置/浓淡/形状只能由 JS 生成 —— CSS 随机不了；
//   2) 轨迹**不能用 CSS 关键帧**：关键帧路径固定， alternate 来回跑必然可预测。
//      改成 JS 逐帧：朝随机目标点缓动，到达后重新随机 ⇒ 轨迹是永不重复的折线；
//      同时**平移 + 旋转 + 缩放**（所以球有圆/椭圆/条三种形状，条的旋转才看得出）；
//   3) **数量也在变**：每个球有随机寿命，到点淡出移除、同时补一个新的。
function orbRnd(a, b) { return a + Math.random() * (b - a); }

// ★ 背景风格（仅液态玻璃下生效）：同一套生成器，只换参数。
//   无论哪种风格，运动都是 JS 逐帧的随机目标漂移（不用 CSS 关键帧，避免固定路径来回跑）。
const GLASS_BG_KEY = 'collection-glass-bg';
const GLASS_BG_MODES = ['orbs', 'nebula', 'grid', 'sheen'];
const GLASS_BG_PRESETS = {
    // 彩球：正圆、数量多、比星云小（用户要求与星云区分：“数量多一点、是正圆形、大小比星云小一点”）
    orbs:   { n: [9, 14], size: [8, 22],  blur: 40, op: [20, 40], life: [9000, 24000], circle: true },
    nebula: { n: [3, 6], size: [55, 118], blur: 92, op: [16, 34], life: [20000, 48000] },
    grid:   { n: [0, 0], size: [30, 70],  blur: 70, op: [14, 24], life: [15000, 30000] },
    // 光带 = 背景里几条拉长的柔和光晕（不是浮在界面上的白线：那就是用户说的"浮在上面有点丑"）
    // 条带细、模糊小于厚度才看得出是"带"：之前 72px 模糊配 100~490px 厚度，直接糊成球（实测像星云）
    // 用户要的是"一条条直线"：厚度 1.2%~4%（约 10~40px），模糊 8px 以免糊成块
    sheen:  { n: [5, 8], size: [50, 125], blur: 42, op: [10, 22], life: [18000, 42000], streak: true, thick: [4, 24] }
};
function getGlassBg() {
    try {
        var v = localStorage.getItem(GLASS_BG_KEY);
        if (v === 'minimal') v = 'grid';
        return GLASS_BG_MODES.indexOf(v) >= 0 ? v : 'nebula';
    } catch (e) { return 'nebula'; }
}
function glassBgPreset() { return GLASS_BG_PRESETS[getGlassBg()] || GLASS_BG_PRESETS.nebula; }
function setGlassBg(v) {
    if (GLASS_BG_MODES.indexOf(v) < 0) return;
    try { localStorage.setItem(GLASS_BG_KEY, v); } catch (e) { }
    if (isGlassStyle()) {
        // 换背景也给一层过渡：新球是淡入的（各自 inline opacity transition），不至于"啪"地替换
        try { document.documentElement.classList.add('glass-switching'); } catch (e) { }
        setTimeout(function () { try { document.documentElement.classList.remove('glass-switching'); } catch (e) { } }, 380);
        ensureGlassOrbs(true);   // background switched
    }
}

// ★ 流动光感：一条大斜向光带，JS 缓慢漂移（随机目标，不可预测）。
// ★ 光带不再是独立浮层：之前它是一条白色斜线盖在界面上（用户：“浮在上面有点丑”、
//   “三个都有的洞动白线去掉”、“光带线条也应该是背景里面的”）。
//   现在光带档 = 背景里几条拉长的柔和光晕（见上面的 streak 预设），跟球同一套 JS 漂移。
// \u2605 \u7ed9\u56db\u4e2a\u5927\u5bb9\u5668\u6302 .glass-blur-host\uff1a\u6a21\u7cca\u7531\u4f2a\u5143\u7d20\u505a\uff08opacity \u53ef\u63d2\u503c\uff09\uff0c
//   \u9762\u677f\u81ea\u5df1\u4e0d\u518d\u5e26 backdrop-filter\u3002\u53ea\u5728 position \u4e3a static \u65f6\u8865 relative\uff0c
//   \u907f\u514d\u628a\u539f\u672c fixed/sticky \u7684\u5143\u7d20\u6539\u6389\u3002
function ensureGlassBlurHosts() {
    try {
        ['.sidebar', '.top-search-container', '.bottom-tabbar', '.content', 'main'].forEach(function (sel) {
            var el = document.querySelector(sel);
            if (!el) return;
            if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';
            el.classList.add('glass-blur-host');
        });
    } catch (e) { }
}

function ensureGlassSheen(host) {
    try { var old = host.querySelector('b.glass-sheen'); if (old && old.parentNode) old.parentNode.removeChild(old); } catch (e) { }
    window.__glassSheen = null;
}
// ★ 网格风格：一层细线格，一样由 JS 漂移（平移 + 轻微旋转）。
function ensureGlassGrid(host) {
    try {
        var want = getGlassBg() === 'grid';
        var g = host.querySelector('u.glass-grid');
        if (want && !g) {
            g = document.createElement('u');
            g.className = 'glass-grid';
            g.setAttribute('aria-hidden', 'true');
            host.appendChild(g);
        } else if (!want && g) { g.parentNode.removeChild(g); }
        if (want && g) window.__glassGrid = { el: g, x: 0, y: 0, tx: orbRnd(-14, 14), ty: orbRnd(-14, 14), rot: orbRnd(-6, 6), vr: orbRnd(-0.006, 0.006), k: 0.0008 };
        else window.__glassGrid = null;
    } catch (e) { }
}

// ★ 设置页里的三个“动态小预览”：用 CSS 动画（每个盒子随机时长/延迟，不会同步），
//   零 JS 开销。它只是缩略图，真正的背景仍然是上面那套 JS 漂移。
function initGlassPreviews() {
    var boxes = document.querySelectorAll('[data-glass-preview]');
    if (!boxes.length) return;
    for (var bi = 0; bi < boxes.length; bi++) {
        (function (box) {
            var kind = box.getAttribute('data-glass-preview');
            box.innerHTML = '';   // ★ 先清空：否则重复调用会叠加两份场景
            var scene = document.createElement('span'); scene.className = 'gfx';
            // 彩球=8 个小正圆，星云=3 个大的，光带=6 条直线，网格=只有网格
            var n = kind === 'orbs' ? 8 : (kind === 'nebula' ? 3 : (kind === 'sheen' ? 6 : 0));
            for (var i = 0; i < n; i++) {
                var o = document.createElement('i');
                o.className = 'gfx-orb';
                var size = Math.round(kind === 'orbs' ? orbRnd(8, 16) : orbRnd(kind === 'nebula' ? 40 : 22, kind === 'nebula' ? 90 : 62));
                o.style.left = Math.round(orbRnd(-10, 80)) + '%';
                o.style.top = Math.round(orbRnd(-10, 80)) + '%';
                o.style.width = size + '%';
                o.style.height = kind === 'sheen' ? (Math.max(3, Math.round(size * 0.09)) + '%') : 'auto';   // 非光带：高度交给 aspect-ratio，否则正圆被压扁
                if (kind === 'sheen') { o.style.width = '135%'; o.style.left = orbRnd(-28, -6).toFixed(1) + '%'; o.style.height = orbRnd(22, 58).toFixed(1) + '%'; }   // 预览里也做成无限延伸 + 粗细不一
                if (kind === 'sheen') { o.style.borderRadius = '999px'; o.style.filter = 'blur(2px)'; o.style.opacity = '0.85'; o.style.width = Math.min(96, Math.round(size * 1.5)) + '%'; }
                // ★ 预览盒是扁的，width/height 都用 % 时高度按盒高算，正圆会被压扁 ⇒ 用 aspect-ratio 锁正圆
                o.style.aspectRatio = (kind === 'sheen' ? 'auto' : '1 / 1');
                o.style.opacity = String(Math.round(orbRnd(30, 55)) / 100);
                o.style.background = (i % 2 === 0) ? 'radial-gradient(closest-side, var(--theme), transparent 72%)' : 'radial-gradient(closest-side, var(--theme-light), transparent 72%)';
                o.style.animationDuration = orbRnd(6, 13).toFixed(1) + 's';
                o.style.animationDelay = '-' + orbRnd(0, 8).toFixed(1) + 's';
                scene.appendChild(o);
            }
            if (kind === 'grid') {
                var g = document.createElement('u');
                g.className = 'gfx-grid';
                g.style.animationDuration = orbRnd(7, 15).toFixed(1) + 's';
                g.style.animationDelay = '-' + orbRnd(0, 9).toFixed(1) + 's';
                g.style.setProperty('--gr', orbRnd(-3, 3).toFixed(2) + 'deg');
                scene.appendChild(g);
            }
            // ★ 白色线条只在「光带」卡里出现：真实背景里它也只在光带档存在，预览不能骗人
            box.innerHTML = '';
            box.appendChild(scene);
        })(boxes[bi]);
    }
}


function spawnGlassOrb() {
    try {
        var host = window.__glassOrbHost;
        if (!host) return;
        var P = glassBgPreset();
        var o = document.createElement('i');
        var r = Math.random(), w, h;
        if (P.streak) { w = 260; h = orbRnd(P.thick[0], P.thick[1]); o.classList.add('glass-streak'); }   // 光带档：宽度稍后强制 260vw（左右都伸出屏外 = 无限延伸），粗细随机 0.8~6vmin
        else if (P.circle) { w = orbRnd(P.size[0], P.size[1]); h = w; }   // 彩球档：一律正圆（宽高相等）
        else if (r < 0.45) { w = orbRnd(P.size[0], P.size[1] * 0.85); h = w * orbRnd(0.9, 1.1); }   // 圆
        else if (r < 0.8) { w = orbRnd(P.size[0] * 1.2, P.size[1] * 1.25); h = w * orbRnd(0.26, 0.5); }   // 横条（旋转看得见）
        else { w = orbRnd(P.size[0] * 0.6, P.size[1] * 0.6); h = w * orbRnd(1.6, 2.6); }                 // 竖条
        o.style.left = orbRnd(-15, 95).toFixed(1) + '%';
        o.style.top = orbRnd(-15, 95).toFixed(1) + '%';
        o.style.width = w.toFixed(1) + 'vmin';
        o.style.height = h.toFixed(1) + 'vmin';
        // ★ 用户要求：光带要"无限延伸、可以粗一点、粗细不一"
        //   ① 宽度给 260vw（远超视口）② left 收在 -160%~-60%（整条线永远横跨屏幕，看不到两端）
        //   ③ 粗细由 preset.thick 随机（0.8~6vmin），所以每条线粗细不同；漂移逻辑本身没动。
        if (P.streak) { o.style.width = '260vw'; o.style.left = orbRnd(-160, -60).toFixed(1) + '%'; }
        // ★ 用 background-color 而不是 radial-gradient：渐变里的颜色不可插值，
        //   主题色一变就是"啪"地跳（用户：没有中间态、还是突变）。纯色 + 已有的 blur() 一样柔和，但能过渡。
        o.style.backgroundColor = (Math.random() < 0.5) ? 'var(--theme)' : 'var(--theme-light)';
        o.style.transition = 'background-color 0.34s ease, opacity ' + orbRnd(3, 7).toFixed(1) + 's ease-in-out';
        o.style.filter = 'blur(' + P.blur + 'px)';
        if (P.streak) o.style.borderRadius = '999px';
        o.style.opacity = '0';
        o.style.transform = 'translate3d(0,0,0) rotate(0deg) scale(1)';
        host.appendChild(o);
        var st = {
            el: o, x: 0, y: 0, tx: orbRnd(-20, 20), ty: orbRnd(-20, 20), k: orbRnd(0.0012, 0.005),
            rot: orbRnd(0, 360), vr: orbRnd(-0.09, 0.09),
            sc: 1, ts: orbRnd(0.85, 1.25), ks: orbRnd(0.002, 0.006),
            life: orbRnd(P.life[0], P.life[1]), born: Date.now()
        };
        window.__glassOrbState.push(st);
        // 光带档固定高一点的透明度：预览里要看得清（实测随机 0.36~0.52 太淡）
        requestAnimationFrame(function () { try { o.style.opacity = String(P.streak ? 0.9 : Math.round(orbRnd(P.op[0], P.op[1])) / 100); } catch (e) { } });
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
        if (host) host.classList.remove('glass-orbs-out');   // 重新打开玻璃：先取消淡出
        if (host && !rebuild) { ensureGlassBlurHosts(); return; }
        if (host) { while (host.firstChild) host.removeChild(host.firstChild); }
        else {
            host = document.createElement('div');
            host.id = 'glassOrbs';
            host.setAttribute('aria-hidden', 'true');
            document.body.appendChild(host);
        }
        window.__glassOrbHost = host;
        window.__glassOrbState = [];
        ensureGlassBlurHosts();
        ensureGlassSheen(host);
        ensureGlassGrid(host);
        var P0 = glassBgPreset();
        var n = P0.n[0] + Math.floor(Math.random() * (P0.n[1] - P0.n[0] + 1));   // 按风格取数量
        for (var i = 0; i < n; i++) spawnGlassOrb();
        startGlassOrbDrift();
    } catch (e) { }
}

var __orbRaf = 0;

function stepOrb(o, now) {
    if (now - o.born > o.life) { o.life = Infinity; recycleGlassOrb(o); return; }
    if (Math.abs(o.tx - o.x) < 0.6 && Math.abs(o.ty - o.y) < 0.6) {
        o.tx = (Math.random() * 2 - 1) * 22;
        o.ty = (Math.random() * 2 - 1) * 22;
        o.k = 0.0012 + Math.random() * 0.0045;
        o.vr = (Math.random() * 2 - 1) * 0.09;
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

// 光带：自己也是一套随机目标漂移（跟球同一个循环，省一个 rAF）
function stepSheen() {
    var sh = window.__glassSheen;
    if (!sh) return;
    if (Math.abs(sh.tx - sh.x) < 0.8 && Math.abs(sh.ty - sh.y) < 0.8) {
        sh.tx = (Math.random() * 2 - 1) * 30;
        sh.ty = (Math.random() * 2 - 1) * 16;
        sh.vr = (Math.random() * 2 - 1) * 0.014;
        sh.k = 0.0006 + Math.random() * 0.0012;
    }
    sh.x += (sh.tx - sh.x) * sh.k;
    sh.y += (sh.ty - sh.y) * sh.k;
    sh.rot += sh.vr;
    sh.el.style.transform = 'translate3d(' + sh.x.toFixed(2) + 'vmax,' + sh.y.toFixed(2) + 'vmax,0) rotate(' + sh.rot.toFixed(2) + 'deg)';
}

// 网格：平移 + 轻微旋转，同样随机目标
function stepGrid() {
    var g = window.__glassGrid;
    if (!g) return;
    if (Math.abs(g.tx - g.x) < 0.5 && Math.abs(g.ty - g.y) < 0.5) {
        g.tx = (Math.random() * 2 - 1) * 16;
        g.ty = (Math.random() * 2 - 1) * 16;
        g.vr = (Math.random() * 2 - 1) * 0.008;
    }
    g.x += (g.tx - g.x) * g.k;
    g.y += (g.ty - g.y) * g.k;
    g.rot += g.vr;
    g.el.style.transform = 'translate3d(' + g.x.toFixed(2) + 'vmax,' + g.y.toFixed(2) + 'vmax,0) rotate(' + g.rot.toFixed(2) + 'deg)';
}

function startGlassOrbDrift() {
    if (__orbRaf) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (document.hidden) return;
    var step = function () {
        var orbs = window.__glassOrbState || [];
        var now = Date.now();
        for (var i = orbs.length - 1; i >= 0; i--) stepOrb(orbs[i], now);
        stepSheen();
        stepGrid();
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
        // ★ 只在这里（用户点开关）开闸，切完调一次溶解，然后关闸。
    //   页面重绘不会经过这里 ⇒ 不可能再闪。
    var __prevBg = null;
    try {
        var __cs = window.getComputedStyle(document.documentElement);
        __prevBg = (__cs.getPropertyValue('--bg-solid') || __cs.getPropertyValue('--bg') || '').trim() || null;
    } catch (e) { }
    window.__glassUserAction = true;
    el.setAttribute('data-ui-style', glass ? 'glass' : 'standard');
    // ★ 注意：动画由 applyTheme 包装在开闸后统一调用，这里不能再调一次（否则会铺两层遮罽）。
    setTimeout(function () { window.__glassUserAction = false; }, 700);
    if (glass) ensureGlassOrbs(false); else { stopGlassOrbDrift(); fadeOutGlassOrbs(); }

// ★ 背景层的样式全部绑在 html[data-ui-style="glass"] 上，属性一翻、球就没有任何定位/滤镜了，
//   于是"啪"地消失（用户反复说"还是突变"）。这里先加一层淡出类、等过渡完再把整层移除。
function fadeOutGlassOrbs() {
    try {
        var host = document.getElementById('glassOrbs');
        if (!host) return;
        host.classList.add('glass-orbs-out');
        setTimeout(function () {
            try { if (host.parentNode) host.parentNode.removeChild(host); } catch (e) { }
        }, 340);
    } catch (e) { }
}

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

// ★★ 一处修好“开关 + 主题色卡片 + 背景”三件事的突变 ★★
//   实测证据：开关后 150ms，body 底色已经从实色变成透明、
//   模糊层的 ::before opacity 也已经是 1 —— 没有任何过渡在跑。
//   这和 main.js 里入场动画的结论一致：CSS 过渡在这套层叠里靠不住
//   （“removing !important rules alone did not animate”），得用 Web Animations API。
//   所以在 applyTheme 外包一层：任何主题/风格变化后，给 #app 做一次 0.34s 的淡入，
//   把所有内部瞬变（底色、卡片、模糊、背景层）都包成一次平滑的交叉淡入。
function themeCrossFade() {
    try {
        if (!window.__glassUserAction) return;   // ★ 只有用户点开关时才放行；页面重绘一律不动
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var el = document.getElementById('app') || document.body;
        if (!el || !el.animate) return;
        el.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 340, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
    } catch (e) { }
}
// ★★ 真正稳的做法：旧底色遮罩 + 淡出（溶解式过渡）★★
//   为什么之前那么多次都没用：
//   ① CSS 过渡在这套层叠里不可靠（main.js 已经写过这个结论）；
//   ② 给 #app 做 WAAPI 淡入也盖不住**整页底色**——底色是画在 html/视口画布上的，
//      元素的 opacity 管不到它，所以底色仍然是一帧翻转（用户：还是突变）。
//   现在：切换前先记下旧的实色底（--bg-solid 始终是不透明色），切换后在最上层
//   铺一块同色遮罩并 WAAPI 淡出 0.36s。遮罩下面发生什么都无所谓，
//   用户看到的是“旧样子溶解成新样子”——这是唯一不受层叠影响的保证。
function themeFadeOverlay(prevBg) {
    try {
        if (!window.__glassUserAction) return;   // ★ 只有用户点开关时才放行；页面重绘一律不动
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (!prevBg) return;
        var d = document.createElement('div');
        d.className = 'theme-fade-overlay';
        d.setAttribute('aria-hidden', 'true');
        d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;background:' + prevBg + ';';
        (document.body || document.documentElement).appendChild(d);
        var anim = null;
        if (d.animate) anim = d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
        var kill = function () { try { if (d.parentNode) d.parentNode.removeChild(d); } catch (e) { } };
        if (anim) anim.onfinish = kill;
        setTimeout(kill, 900);
        return d;
    } catch (e) { }
}
// ★★ 关键修正：只有“真的变了”才淡 ★★
//   上一版把淡入挂在 applyTheme 上，而“我的”每次重绘都会调用 applyTheme
//   （同步调色板/卡片状态）⇒ 每渲染一次就铺一层遮罩 = 整个页面在闪。
//   现在先取签名（界面风格 + 明暗 + 主题色），只有签名真变了才跑淡入/遮罩。
//
//   ★ 签名必须读**内联样式**（el.style），不能读 getComputedStyle：
//     layout.css 用 @property 把 --theme/--theme-light 注册成了可过渡的颜色，
//     又给 html.theme-anim 挂了 transition —— 于是改完变量的**同一帧**里
//     getComputedStyle 拿到的还是过渡起点（旧值），前后一比永远"没变"，
//     用户真的换了主题反而不会溶解（实测：换铜色后签名仍是 rgb(22,119,255)）。
//     内联样式是"写进去就是什么"，不受过渡影响。
//   ★ --bg-solid 也要算进去：明暗是靠 applyColorScheme 先翻 data-color-scheme、
//     再调 applyTheme 的，签名前后取的都是新 scheme，光靠 --theme-light 分辨不出
//     黑白切换 —— 像 #ffffff 这种色，L(0.35) 和 L(0.4) 都是 #ffffff，
//     切日夜就漏了。--bg-solid 由主题色按明暗分别派生（暗：压暗 / 亮：提亮），
//     任何颜色下两个模式都不相等。
function themeSignature() {
    try {
        var el = document.documentElement;
        var st = el.style;
        return [el.getAttribute('data-ui-style'), el.getAttribute('data-color-scheme'),
            (st.getPropertyValue('--theme') || '').trim(), (st.getPropertyValue('--theme-light') || '').trim(),
            (st.getPropertyValue('--bg-solid') || '').trim()].join('|');
    } catch (e) { return 'no-sig'; }
}
(function () {
    try {
        var origApplyTheme = applyTheme;
        applyTheme = function () {
            var prev = null;
            try {
                var cs = window.getComputedStyle(document.documentElement);
                prev = (cs.getPropertyValue('--bg-solid') || cs.getPropertyValue('--bg') || '').trim() || null;
            } catch (e) { }
            // ★ 签名必须**前后各取一次**再比。原先这里是"变之前存一份 themeSignature()、
            //   变之后只取 data-ui-style"，两边根本不是一个东西 ⇒ 永远不相等 ⇒
            //   连开机那一趟 applyTheme 都被当成"主题变了"，于是首屏盖了一层整屏遮罩，
            //   把加载屏的"正在准备 / 进度"整块字抹掉再淡回来。
            var before = themeSignature();
            var r = origApplyTheme.apply(this, arguments);
            var after = themeSignature();
            if (after !== before) {         // ★ 真的变了才淡；重复调用同一主题完全不动
                // ★ 初始化那一趟只落值，不铺遮罩（themeInitCall 见 withThemeAnim）：
                //   这时首屏还压在加载屏上，铺上去等于把加载文字藏起来。
                if (!themeInitCall) {
                    themeCrossFade();
                    themeFadeOverlay(prev);  // 保底关闭：先保证不闪
                }
            }
            return r;
        };
    } catch (e) { }
})();

// ================= LIQUID-GLASS-DISABLED =================
// 用户决定：液态玻璃整体停用。原因是它会让整页闪（覆盖整页的背景层带入场动画，重播时整页淡入）。
// 这里做四件事，保证任何入口都回不到玻璃模式：
//   1) 启动即强制 data-ui-style=standard，并清掉本地残留；
//   2) 把 setUIStyle 换成空实现（设置页的开关即使被程序化点到也不会生效）；
//   3) 移除已存在的背景层元素；
//   4) 挂一个"已封存"判据给「我的」，让设置页**整块不渲染**（见下面 isLiquidGlassShelved）。
// 想恢复这个功能：删掉本段 + 删掉 settings.js 里那一处 if 即可（其余玻璃代码都还在，互不影响）。
(function () {
    function forceStandard() {
        try { document.documentElement.setAttribute('data-ui-style', 'standard'); } catch (e) { }
        try { localStorage.setItem('collection-ui-style', 'standard'); } catch (e) { }
        try {
            var h = document.getElementById('glassOrbs');
            if (h && h.parentNode) h.parentNode.removeChild(h);
        } catch (e) { }
    }
    forceStandard();
    try {
        setUIStyle = function () { forceStandard(); return false; };
    } catch (e) { }
    try { document.addEventListener('DOMContentLoaded', forceStandard); } catch (e) { }

    // ★ 「我的」用的判据：为真时设置页不渲染「界面风格」（液态玻璃开关）与「背景风格」两节。
    //
    //   为什么必须有个显式判据，而不是继续靠 CSS 藏：上一版就是 CSS 藏的
    //   （layout.css 末尾三条 display:none），但 renderToggleRow() 生成的行是
    //   `.toggle-card`，那条 `.settings-row:has(#uiStyleSwitch)` **永远匹配不上** ⇒
    //   只藏掉了小开关，标题「界面风格」+ 标签「液态玻璃」+ 那段说明照旧显示在
    //   「我的」里（用户实测："封存了，界面风格还是显示在我的"）。
    //   用 CSS 藏的另一个毛病：元素还在 DOM 里，任何人读一下 DOM/无障碍树都能看见
    //   一个"没有开关的开关说明"。
    window.isLiquidGlassShelved = function () { return true; };
})();
