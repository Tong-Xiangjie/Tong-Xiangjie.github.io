// ==================== data-loader.js ====================
// 从分类树收集数据文件 → 动态加载 → 自动桥接到 DATA_MAP / COIN_DATA_MAP
// 数据文件保持 const 声明不动，这里用间接 eval 解析全局变量

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
        const s = document.createElement('script');
        s.src = file;
        s.onload = resolve;
        s.onerror = () => reject(new Error('数据文件加载失败: ' + file));
        document.head.appendChild(s);
    });
}

// 间接 eval：读取顶层 const 声明的全局变量（const 不会挂到 window 上）
function resolveGlobal(name) {
    try { return (0, eval)(name); } catch (e) { return null; }
}

let dataReadyPromise = null;
function loadAllData() {
    if (dataReadyPromise) return dataReadyPromise;
    dataReadyPromise = (async () => {
        const noteSources = walkTree(categoryTree, []);
        const coinSources = walkTree(coinCategoryTree, []);

        // 按文件去重后逐个加载
        const seen = new Set();
        for (const s of [...noteSources, ...coinSources]) {
            if (seen.has(s.file)) continue;
            seen.add(s.file);
            await loadScript(s.file);
        }

        // 桥接（纸币/硬币分开，避免同名 dataKey 冲突）
        window.DATA_MAP = {};
        window.COIN_DATA_MAP = {};
        for (const s of noteSources) window.DATA_MAP[s.key] = resolveGlobal(s.var);
        for (const s of coinSources) window.COIN_DATA_MAP[s.key] = resolveGlobal(s.var);
    })();
    return dataReadyPromise;
}
