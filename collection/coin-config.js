// ========== 硬币分类树 ==========
const coinCategoryTree = [
    {
        id: 'commemorative_coins',
        name: '纪念币',
        dataKey: 'commemorativeData',
        dataVar: 'coincommData',
        dataFile: '../coincollection/data/commemorative_coins.js',
        children: null
    },
    {
        id: 'circulating_coins',
        name: '人民币流通硬币',
        children: [
            { id: 'circulating_5', name: '第五套人民币硬币（新三花）', dataKey: 'circulating_5Data', dataFile: '../coincollection/data/circulating_5.js' },
            { id: 'circulating_4', name: '第四套人民币硬币（老三花）', dataKey: 'circulating_4Data', dataFile: '../coincollection/data/circulating_4.js' },
            { id: 'circulating_3', name: '第三套人民币硬币（长城币）', dataKey: 'circulating_3Data', dataFile: '../coincollection/data/circulating_3.js' },
            { id: 'circulating_2', name: '第二套人民币硬币（硬分币）', dataKey: 'circulating_2Data', dataFile: '../coincollection/data/circulating_2.js' }
        ]
    }/*,
    {
        id: 'gold_silver_coins',
        name: '金银币',
        dataKey: 'gold_silverData',
        dataFile: '../coincollection/data/gold_silver.js',
        children: null
    }*/
];

// 所有硬币 dataKey 列表
const coinAllDataKeys = ['commemorativeData', 'circulatingData', 'gold_silverData'];

// ★ 图片路径由 CDN_BASE 统一处理（core.js 中定义）
// COIN_IMAGE_BASE 已废弃删除