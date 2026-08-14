// ==================== data-loader.js ====================
// 从分类树收集数据文件 → 动态加载 → 自动桥接到 DATA_MAP / COIN_DATA_MAP
// 数据文件内已包含自注册代码（末尾有 window.DATA_MAP[key] = data）

function walkTree(cats, out) {
    for (const cat of cats) {
        if (cat.dataKey && cat.dataFile) out.push({ key: cat.dataKey, file: cat.dataFile });
        if (cat.children) walkTree(cat.children, out);
    }
    return out;
}

function loadScript(file) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = file;
        s.onload = resolve;
        s.onerror = () => reject(new Error('数据文件加载失败: ' + file));
        document.head.appendChild(s);
    });
}

let dataReadyPromise = null;

function loadAllData() {
    if (dataReadyPromise) return dataReadyPromise;

    dataReadyPromise = (async () => {
        // 从分类树收集所有需要加载的数据文件
        const noteSources = walkTree(categoryTree, []);
        const coinSources = walkTree(coinCategoryTree, []);
        const all = [...noteSources, ...coinSources];

        // 去重（按文件路径）
        const seen = new Set();
        const uniqueFiles = [];
        for (const s of all) {
            if (seen.has(s.file)) continue;
            seen.add(s.file);
            uniqueFiles.push(s);
        }

        // 初始化 DATA_MAP / COIN_DATA_MAP（数据文件的自注册会填充它们）
        if (!window.DATA_MAP) window.DATA_MAP = {};
        if (!window.COIN_DATA_MAP) window.COIN_DATA_MAP = {};

        // 逐个加载数据文件（每个文件加载后会自动注册到 window.DATA_MAP / COIN_DATA_MAP）
        for (const s of uniqueFiles) {
            await loadScript(s.file);
        }

        // 检查所有 dataKey 是否都已成功加载（可选，便于排查）
        const allKeys = [...noteSources, ...coinSources];
        const missing = allKeys.filter(s => {
            return !window.DATA_MAP[s.key] && !window.COIN_DATA_MAP[s.key];
        });
        if (missing.length > 0) {
            console.warn('以下数据未成功加载（可能缺少自注册代码）:', missing.map(s => s.key).join(', '));
        }
    })();

    return dataReadyPromise;
}
