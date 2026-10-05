// ========== 硬币分类树 ==========
const coinCategoryTree = [
    {
        id: 'commemorative_coins',
        name: '纪念币',
        // ★ 这里原来是 'commemorativeData'，和纸币的纪念钞（config.js）撞了同一个 dataKey：
        //   两个 key 分别落在 COIN_DATA_MAP 与 DATA_MAP 里，所以"能用"，但任何只拿到
        //   dataKey、没拿到 source 的代码都会指错板块，价格列表按分类筛选也得靠
        //   (dataKey, source) 两字段一起比才不串。改成全局唯一的名字，这类隐患从根上没了。
        //   dataVar 仍是 coincommData（数据文件里的变量名不变），data-loader 用它取变量。
        dataKey: 'coinCommemorativeData',
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
// ★ 以前这里是**手写**的：['commemorativeData','circulatingData','gold_silverData']。
//   硬币 tree 一改（circulatingData → circulating_5/4/3/2Data、金银币整个注释掉），
//   这张表就静默失联了 —— 流通硬币整类没接上：硬币板块少了这四个分类、
//   价格列表的筛选里看不到它们、computeStats() 的硬币数也少算，"我的"页面凭空少一块。
//   现在照 config.js 里 allDataKeys 的同一套做法，从 coinCategoryTree 推导：
//   以后改 tree（增删分类、改 dataKey、注释掉一段）这张表自动跟着走。
//   反向的一致性由 collection/tools/check-data.mjs 的双向检查守着。
const coinAllDataKeys = [];
(function collectCoinKeys() {
    for (const cat of coinCategoryTree) {
        if (cat.children) {
            for (const sub of cat.children) {
                if (sub.dataKey) coinAllDataKeys.push(sub.dataKey);
            }
            // ★ 与 config.js 的 allDataKeys 同构：父分类自己也可能挂数据文件（只放文章）。
            if (cat.dataKey) coinAllDataKeys.push(cat.dataKey);
        } else if (cat.dataKey) {
            coinAllDataKeys.push(cat.dataKey);
        }
    }
})();

// ★ 图片路径由 CDN_BASE 统一处理（core.js 中定义）
// COIN_IMAGE_BASE 已废弃删除