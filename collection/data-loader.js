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
    const CONCURRENCY = 6;
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
    await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, files.length)) }, worker));

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
            seen.add(s.file);
            files.push(s.file);
        }

        const total = files.length;
        const failed = [];
        // ★ 并发加载（原来是一个个 await）。
        //   50 个数据文件合计只有 465KB，串行却要付 50 次网络往返 —— 按 100ms RTT
        //   算就是约 5 秒纯粹耗在排队上，手机上更久。并发 6 路后只剩约 9 次往返。
        //   各数据文件互相独立（各自只定义自己的那个变量），加载顺序无所谓。
        const CONCURRENCY = 6;
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
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
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