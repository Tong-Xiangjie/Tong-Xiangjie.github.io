// ========== 硬币分类树 ==========
const coinCategoryTree = [
    {
        id: 'commemorative_coins',
        name: '纪念币',
        dataKey: 'commemorativeData',
        children: null
    },
    {
        id: 'circulating_coins',
        name: '流通币',
        dataKey: 'circulatingData',
        children: null
    },
    {
        id: 'gold_silver_coins',
        name: '金银币',
        dataKey: 'gold_silverData',
        children: null
    }
];

// 所有硬币 dataKey 列表
const coinAllDataKeys = ['commemorativeData', 'circulatingData', 'gold_silverData'];

// 硬币图片路径前缀
const COIN_IMAGE_BASE = '../coincollection/';
