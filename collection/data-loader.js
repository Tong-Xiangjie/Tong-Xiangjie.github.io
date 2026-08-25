// ==================== data-loader.js ====================
// 从分类树收集数据文件 → 动态加载 → 自动桥接到 DATA_MAP / COIN_DATA_MAP / FUN_DATA_MAP

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
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (onProgress) onProgress({ loaded: i, total, current: file });
            try {
                await loadScript(file);
            } catch (err) {
                console.warn('[data-loader] 跳过加载失败的文件:', file, err);
                failed.push(file);
            }
        }
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