// ========== coincollection 的硬币分类树 ==========
// ★ 这里只声明"有哪些数据、各自的文件和变量叫什么"，具体加载由
//   ../collection/data-loader.js 的 loadDataFromTrees() 动态完成 ——
//   index.html 里不再一条条列 <script src="data/xxx.js">。
//   这么改是因为：以前每加一个数据文件都要改 HTML，而且很容易漏
//   （硬币拆成 circulating_2/3/4/5 时，本页和 newcollection 就都没跟上，
//    一个直接 ReferenceError 白屏、一个静默少一整类）。
// ★ dataKey 就是本页 coinsData 用的那个 key（main.js 里按它取数据），
//   dataVar 是该文件里定义的全局变量名，dataFile 相对本页 index.html。
const coinCategoryTree = [
    {
        id: 'commemorative',
        name: '纪念币',
        dataKey: 'commemorative',
        dataVar: 'coincommData',
        dataFile: 'data/commemorative_coins.js'
    },
    {
        id: 'circulating_5',
        name: '第五套人民币硬币（新三花）',
        dataKey: 'circulating_5',
        dataVar: 'circulating_5Data',
        dataFile: 'data/circulating_5.js'
    },
    {
        id: 'circulating_4',
        name: '第四套人民币硬币（老三花）',
        dataKey: 'circulating_4',
        dataVar: 'circulating_4Data',
        dataFile: 'data/circulating_4.js'
    },
    {
        id: 'circulating_3',
        name: '第三套人民币硬币（长城币）',
        dataKey: 'circulating_3',
        dataVar: 'circulating_3Data',
        dataFile: 'data/circulating_3.js'
    },
    {
        id: 'circulating_2',
        name: '第二套人民币硬币（硬分币）',
        dataKey: 'circulating_2',
        dataVar: 'circulating_2Data',
        dataFile: 'data/circulating_2.js'
    },
    {
        id: 'gold_silver',
        name: '金银币',
        dataKey: 'gold_silver',
        dataVar: 'gold_silverData',
        dataFile: 'data/gold_silver.js'
    }
];

// 分类展示顺序（由树上推导，别再手写第二份）
const coinCategoryOrder = coinCategoryTree.map(c => c.dataKey);
