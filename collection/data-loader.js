// ==================== data-loader.js ====================
// 数据文件动态加载器

let dataReadyPromise = null;

/**
 * 加载所有数据文件
 * @param {Function} onProgress 进度回调：{ loaded, total, current }
 */
function loadAllData(onProgress) {
    if (dataReadyPromise) return dataReadyPromise;
    dataReadyPromise = (async () => {
        const noteSources = walkTree(categoryTree, []);
        const coinSources = walkTree(coinCategoryTree, []);

        // 去重后得到实际要加载的文件列表
        const files = [];
        const seen = new Set();
        for (const s of [...noteSources, ...coinSources]) {
            if (seen.has(s.file)) continue;
            seen.add(s.file);
            files.push(s.file);
        }

        const total = files.length;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            // 加载前上报：当前文件 + 已完成数/总数
            if (onProgress) onProgress({ loaded: i, total, current: file });
            await loadScript(file);
        }
        // 全部完成
        if (onProgress) onProgress({ loaded: files.length, total, current: '' });

        // 桥接到全局 DATA_MAP / COIN_DATA_MAP
        window.DATA_MAP = {};
        window.COIN_DATA_MAP = {};
        for (const s of noteSources) window.DATA_MAP[s.key] = resolveGlobal(s.var);
        for (const s of coinSources) window.COIN_DATA_MAP[s.key] = resolveGlobal(s.var);

        // ★ 触发专题数据加载（如果有 FUN_DATA_MAP 且尚未加载）
        if (typeof loadSpecialData === 'function') {
            await loadSpecialData();
        }
    })();
    return dataReadyPromise;
}

function walkTree(tree, acc) {
    for (const node of tree) {
        if (node.dataKey) {
            // 叶子节点：dataKey 对应一个数据文件
            acc.push({ key: node.dataKey, file: node.file, var: node.var });
        }
        if (node.children) {
            walkTree(node.children, acc);
        }
    }
    return acc;
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`加载失败: ${src}`));
        document.head.appendChild(script);
    });
}

function resolveGlobal(varName) {
    try {
        const parts = varName.split('.');
        let obj = window;
        for (const p of parts) {
            if (obj === undefined || obj === null) return null;
            obj = obj[p];
        }
        return obj || null;
    } catch (_) {
        return null;
    }
}
