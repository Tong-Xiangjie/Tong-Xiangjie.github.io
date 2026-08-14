// ========== 硬币分类树 ==========
const coinCategoryTree = [
    {
        id: 'commemorative_coins',
        name: '纪念币',
        dataKey: 'commemorativeData',
        dataFile: '../coincollection/data/commemorative_coins.js',
        children: null
    },
    {
        id: 'circulating_coins',
        name: '流通币',
        dataKey: 'circulatingData',
        dataFile: '../coincollection/data/circulating.js',
        children: null
    },
    {
        id: 'gold_silver_coins',
        name: '金银币',
        dataKey: 'gold_silverData',
        dataFile: '../coincollection/data/gold_silver.js',
        children: null
    }
];

// 所有硬币 dataKey 列表
const coinAllDataKeys = ['commemorativeData', 'circulatingData', 'gold_silverData'];

// 硬币图片路径前缀
const COIN_IMAGE_BASE = '../coincollection/';
