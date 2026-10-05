// ========== 硬币分类树 ==========
// ★ 跟着数据走：流通硬币已经拆成 circulating_2/3/4/5 四份（原来是单个 circulating.js），
//   这里原来还写着 dataKey: 'circulatingData'，而 coin-data-bridge.js 用
//   `typeof circulatingData !== 'undefined' ? ... : null` 保护着 —— 所以**不报错**，
//   只是流通币那一整类静默变空（比崩掉更难发现）。现在四份各成一类，
//   名字与主站 collection/ 的硬币 tree 保持一致。
//   纪念币的 dataKey 也顺手改成全局唯一的 coinCommemorativeData（原来和纸币的纪念钞
//   撞名 commemorativeData），理由见 collection/coin-config.js 的注释。
const coinCategoryTree = [
    {
        id: 'commemorative_coins',
        name: '纪念币',
        dataKey: 'coinCommemorativeData',
        dataVar: "coincommData",
        dataFile: "../coincollection/data/commemorative_coins.js",
        children: null
    },
    {
        id: 'circulating_5',
        name: '第五套人民币硬币（新三花）',
        dataKey: 'circulating_5Data',
        dataVar: "circulating_5Data",
        dataFile: "../coincollection/data/circulating_5.js",
        children: null
    },
    {
        id: 'circulating_4',
        name: '第四套人民币硬币（老三花）',
        dataKey: 'circulating_4Data',
        dataVar: "circulating_4Data",
        dataFile: "../coincollection/data/circulating_4.js",
        children: null
    },
    {
        id: 'circulating_3',
        name: '第三套人民币硬币（长城币）',
        dataKey: 'circulating_3Data',
        dataVar: "circulating_3Data",
        dataFile: "../coincollection/data/circulating_3.js",
        children: null
    },
    {
        id: 'circulating_2',
        name: '第二套人民币硬币（硬分币）',
        dataKey: 'circulating_2Data',
        dataVar: "circulating_2Data",
        dataFile: "../coincollection/data/circulating_2.js",
        children: null
    },
    {
        id: 'gold_silver_coins',
        name: '金银币',
        dataKey: 'gold_silverData',
        dataVar: "gold_silverData",
        dataFile: "../coincollection/data/gold_silver.js",
        children: null
    }
];

// 所有硬币 dataKey 列表
// ★ 和 collection/coin-config.js 一样从树上推导，不再手写（手写的那版就是这次
//   流通币静默消失的原因）。
const coinAllDataKeys = [];
(function collectCoinKeys() {
    for (const cat of coinCategoryTree) {
        if (cat.children) {
            for (const sub of cat.children) {
                if (sub.dataKey) coinAllDataKeys.push(sub.dataKey);
            }
        } else if (cat.dataKey) {
            coinAllDataKeys.push(cat.dataKey);
        }
    }
})();

// 硬币图片路径前缀
const COIN_IMAGE_BASE = '../coincollection/';
