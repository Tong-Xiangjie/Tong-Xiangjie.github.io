// ==================== data-loader.js ====================
// 从分类树收集数据文件 → 动态加载 → 自动桥接到 DATA_MAP / COIN_DATA_MAP / FUN_DATA_MAP

// ★ 通用入口：给"自己带分类树"的独立小页面用（coincollection / notecollection /
//   newcollection）。它们以前在 index.html 里一条条列 <script src="data/xxx.js">，
//   于是每加一个数据文件都要改 HTML，还很容易漏（这次硬币拆成 circulating_2/3/4/5
//   就是三个页面里两个没跟上）。现在统一成：文件名只写在分类树的 dataFile 里，
//   由这里动态注入 —— 代码里不再出现任何数据文件名。
//
//   spec = {
//     trees: [{ tree, mapName }],   // 每棵树收集到的 dataKey/dataVar 放进哪个全局 map
//     specials: { mapName } | true, // 再按 window.SPECIAL_CONFIGS 收一份（专题数据）
//     onProgress: fn({loaded,total,current})
//   }
//   ★ 数据是并发注入的，页面必须 await 之后再渲染（主站也是这么做的：
//     collection/main.js 里 await loadAllData() 之后才 applyInitialRoute）。
//   ★ 注意边界：**定义分类树的那些 meta 文件**（如 funcollection/years/data.js 里的
//     specialYearsMeta）必须在配置期就存在，它们仍以 <script> 引入；这里加载的
//     只是**藏品数据**文件。

// ==================== 数据模块的加载并发 ====================
// ★ 这个常量就是加载屏上"正在加载 xxx.js · k/N"背后那批 <script> 的并发上限
//   （用户问的"一次加载 6 个"）。verify-ocrb-init.mjs 会断言它的值 + 行为。
//
// ★ 为什么从 6 提到 24 —— 全是本机实测（HTTP/2 over TLS，80ms RTT，各 3 次取中位数，
//   指标 = 导航开始 → 全部数据文件 responseEnd）：
//       并发  6 → 1491ms（加载屏消失 1930ms）      并发 12 →  960ms
//       并发 16 →  847ms                         并发 24 →  656ms（加载屏消失 1095ms）
//       并发 32 →  685ms                         并发 48 →  580ms
//       并发 70 →  458ms
//   另一轮同条件复核（只看 6 / 24）：下载完 1463 → 688ms，加载屏消失 1897 → 1125ms。
//   同机换成 HTTP/1.1 再测同一批并发：6/12/24/48 **全是 ~1990ms**，一点不动 ——
//   Chrome 对每个源只开 6 条 TCP 连接，写多大都只是排队。所以"提到多少"只能在
//   HTTP/2 下量（GitHub Pages 就是 h2）；在 HTTP/1.1 上测会得到"并发根本没用"的假结论。
//   轮数模型 dlEnd ≈ FCP + ceil(N/并发) × RTT 与实测吻合（N=72 个数据文件，
//   实测值来自加载屏的 k/N 与动态插入计数，两者一致；注意别拿"配置里 dataFile:
//   出现次数"去数——那是 73，多出来的一个没有 dataKey，walkTree 根本不收它）。
//
// ★ 为什么停在 24、不取 48/70：
//   ① 轮数已经压到 ceil(72/24)=3，再往上（48/70）下载只再快 76~200ms；
//   ② 同发越多，"下载完 → 脚本全部执行完"的尾段越长（70 路时从 ~3ms 涨到 ~114ms）——
//      585KB 数据 JS 的解析+执行是主线程的固定成本，一次涌进来的脚本更多、
//      更容易堆成一个长任务，收益被吃掉大半；
//   ③ 进度条一跳一大格，观感更差；
//   ④ 24 路同发只多占**同一条 h2 连接**上的 24 个 stream（GitHub Pages/Fastly 的
//      SETTINGS_MAX_CONCURRENT_STREAMS 是 100），不新增 TCP 连接；峰值内存增量
//      约 24 × 9KB ≈ 0.2MB。
//   实测长任务总量在 6/12/16/24/32/48/70 下都是 182~207ms（每次恰好 1 个长任务，
//   且它是数据加载完后的首屏渲染，不随并发变化）—— 没有"并发越高越卡"。
//
// ★ 顺序语义完全没变：这些数据文件互相独立（各自只定义自己那个全局变量），
//   加载顺序本来就无所谓；worker 池的取号 `next++` 是同步的，不存在取重/漏取。
const DATA_LOAD_CONCURRENCY = 24;

async function loadDataFromTrees(spec) {
    const { trees = [], specials, onProgress } = spec || {};
    const byMap = new Map();
    const files = [];
    const seen = new Set();
    const push = (mapName, sources) => {
        if (!byMap.has(mapName)) byMap.set(mapName, []);
        for (const s of sources) {
            byMap.get(mapName).push(s);
            if (!s.file || seen.has(s.file)) continue;
            seen.add(s.file);
            files.push(s.file);
        }
    };
    for (const t of trees) push(t.mapName, walkTree(t.tree || [], []));
    if (specials) {
        const mapName = (specials === true) ? 'FUN_DATA_MAP' : (specials.mapName || 'FUN_DATA_MAP');
        const srcs = [];
        for (const config of (window.SPECIAL_CONFIGS || [])) {
            if (config.dataFile && config.dataKey) {
                srcs.push({ key: config.dataKey, file: config.dataFile, var: config.dataVar || config.dataKey });
            }
        }
        push(mapName, srcs);
    }

    const total = files.length;
    const failed = [];
    let done = 0;
    let next = 0;
    async function worker() {
        while (next < files.length) {
            const file = files[next++];
            if (onProgress) onProgress({ loaded: done, total, current: file });
            try {
                await loadScript(file);
            } catch (err) {
                console.warn('[data-loader] 跳过加载失败的文件:', file, err);
                failed.push(file);
            }
            done++;
            if (onProgress) onProgress({ loaded: done, total, current: file });
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(DATA_LOAD_CONCURRENCY, files.length)) }, worker));

    for (const [mapName, sources] of byMap) {
        window[mapName] = {};
        for (const s of sources) window[mapName][s.key] = resolveGlobal(s.var);
    }
    if (failed.length > 0) {
        console.warn('[data-loader] 共 ' + failed.length + ' 个文件加载失败:', failed);
        window.__dataLoadFailures = failed;
    }
    return { total, failed };
}

function walkTree(cats, out) {
    for (const cat of cats) {
        if (cat.dataKey && cat.dataFile) {
            out.push({ key: cat.dataKey, file: cat.dataFile, var: cat.dataVar || cat.dataKey });
        }
        if (cat.children) walkTree(cat.children, out);
    }
    return out;
}

// ★ 分享模式：收件人只要分享范围那一份数据，范围外的**根本不下载**。
//   背景（实测）：收件人打开分享链接时，这个加载器照样把 73 个数据文件全下下来
//   （约 595KB），而分享范围之外的内容他既看不到、也点不动（gate.js 会灰化锁定）。
//   保守边界（宁可不省也不许省错）：
//     · 只在"范围落到具体分类"（p 至少两段，如 notes/commemorative）时生效；
//       板块级分享（notes / coins）、以及非分享访问一律照旧全下；
//     · 只过滤数据文件，且匹配方式很松：路径里命中本范围的分类名或板块名就保留
//       （文件名就带分类 id，如 commemorative ⇒ ../notecollection/data/commemorative.js），
//       多留无害、少留才会出事；
//     · 与门禁的范围判定天然一致：范围外的深层链接会被拒（连页面都进不去），
//       所以不存在"页面在范围外却需要它那份数据"的情况。
//   行为由 verify-share-e2e.mjs 兜底（裁剪后仍要求 21 灰 / 2 亮）。
function shareScopeSegments() {
    try {
        const rec = JSON.parse(sessionStorage.getItem('collection-share') || 'null');
        const seg = String((rec && rec.p) || '').split('/').filter(Boolean);
        return seg.length >= 2 ? seg : null;
    } catch (e) { return null; }
}

function shareDataKeep(file) {
    const seg = shareScopeSegments();
    if (!seg) return true;
    // ★ 文章板块**不裁剪**：文章数据文件名按**分类 id** 命名，而分享范围可能是"父类"
    //   （#articles/c-prcAidPrinted），它的数据散在一堆**子类**文件里 ⇒ 拿父类 id 去比
    //   文件名必然比不中 ⇒ 用户实测"分享父类的一篇都看不到"。文章那边的越界由门禁 +
    //   锁定那套负责（范围外的入口点不动），所以这里整块放行（"多留无害"）。
    if (String(seg[0] || '').toLowerCase() === 'articles') return true;
    const path = String(file || '').toLowerCase();
    if (path.indexOf('/data/') < 0) return true;
    // ★ 范围段可能**带前缀**：小板块是 c-<分类 id>（#articles/c-macau_boc）、搜索是 q-/sm-。
    //   数据文件是按**分类 id**命名的（…/data/…/macau_boc.js），拿 'c-macau_boc' 去比文件名
    //   永远比不中 ⇒ 分享某个小板块时文章数据被整段丢掉。线上实测：范围 articles 时
    //   70 篇 / 分类树 10 条；范围 articles/c-macau_boc 时 0 篇 / 分类树 0 条（"还没有文章哦"）。
    //   所以比之前先把前缀去掉，并且"任一段命中即保留"（本文件开头就写了"多留无害"）。
    const toks = [];
    for (const s of seg) {
        const t = String(s || '').toLowerCase();
        if (!t) continue;
        toks.push(t);
        toks.push(t.replace(/^(c|q|sm)-/, ''));
    }
    for (const t of toks) if (t && path.indexOf(t) >= 0) return true;
    return false;
}

function loadScript(file) {
    return new Promise((resolve, reject) => {
        if (!file) { reject(new Error('loadScript 收到空文件路径')); return; }
        const s = document.createElement('script');
        s.src = file;
        s.onload = resolve;
        s.onerror = () => reject(new Error('数据文件加载失败: ' + file));
        document.head.appendChild(s);
    });
}

function resolveGlobal(name) {
    try { return (0, eval)(name); } catch (e) { return null; }
}

let dataReadyPromise = null;

function loadAllData(onProgress) {
    if (dataReadyPromise) return dataReadyPromise;
    dataReadyPromise = (async () => {
        const noteSources = walkTree(categoryTree, []);
        const coinSources = walkTree(coinCategoryTree, []);
        const specialConfigs = window.SPECIAL_CONFIGS || [];
        const specialSources = [];
        for (const config of specialConfigs) {
            if (config.dataFile && config.dataKey) {
                specialSources.push({
                    key: config.dataKey,
                    file: config.dataFile,
                    var: config.dataVar || config.dataKey
                });
            }
        }

        const allSources = [...noteSources, ...coinSources, ...specialSources];
        const files = [];
        const seen = new Set();
        for (const s of allSources) {
            if (!s.file || seen.has(s.file)) continue;
            if (!shareDataKeep(s.file)) continue;    // ★ 分享模式：范围外的数据不下
            seen.add(s.file);
            files.push(s.file);
        }

        const total = files.length;
        const failed = [];
        // ★ 并发数改由文件顶部的 DATA_LOAD_CONCURRENCY 统一提供（原来是写死的 6）。
        //   取 24 的实测依据与取舍见那个常量上方的注释 —— 一句话：
        //   GitHub Pages 走 HTTP/2，70 个数据文件在同一条连接上多路复用，
        //   并发 6→24 把往返轮数从 12 压到 3，本机 80ms RTT 下 1491ms → 656ms。
        //   各数据文件互相独立（各自只定义自己的那个变量），加载顺序无所谓。
        let done = 0;
        let next = 0;
        async function worker() {
            while (next < files.length) {
                const file = files[next++];
                if (onProgress) onProgress({ loaded: done, total, current: file });
                try {
                    await loadScript(file);
                } catch (err) {
                    console.warn('[data-loader] 跳过加载失败的文件:', file, err);
                    failed.push(file);
                }
                done++;
                if (onProgress) onProgress({ loaded: done, total, current: file });
            }
        }
        await Promise.all(Array.from({ length: Math.min(DATA_LOAD_CONCURRENCY, files.length) }, worker));
        if (onProgress) onProgress({ loaded: files.length, total, current: '' });

        if (failed.length > 0) {
            console.warn('[data-loader] 共 ' + failed.length + ' 个文件加载失败:', failed);
            window.__dataLoadFailures = failed;
        }

        window.DATA_MAP = {};
        window.COIN_DATA_MAP = {};
        window.FUN_DATA_MAP = {};

        for (const s of noteSources) window.DATA_MAP[s.key] = resolveGlobal(s.var);
        for (const s of coinSources) window.COIN_DATA_MAP[s.key] = resolveGlobal(s.var);
        for (const s of specialSources) window.FUN_DATA_MAP[s.key] = resolveGlobal(s.var);

        for (const key of Object.keys(window.FUN_DATA_MAP)) {
            if (window.FUN_DATA_MAP[key] === null) delete window.FUN_DATA_MAP[key];
        }
    })();
    return dataReadyPromise;
}