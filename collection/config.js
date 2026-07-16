// ========== 新站分类树定义 ==========

const categoryTree = [
    {
        id: 'commemorative',
        name: '纪念钞',
        dataKey: 'commemorativeData',
        children: null
    },
    {
        id: 'uncut',
        name: '连体钞',
        dataKey: 'uncutData',
        children: null
    },
    {
        id: 'rmb',
        name: '人民币',
        children: [
            { id: 'rmb5', name: '第五套人民币', dataKey: 'rmb5Data' },
            { id: 'rmb4', name: '第四套人民币', dataKey: 'rmb4Data' },
            { id: 'rmb3', name: '第三套人民币', dataKey: 'rmb3Data' },
            { id: 'rmb2', name: '第二套人民币', dataKey: 'rmb2Data' },
            { id: 'rmb1', name: '第一套人民币', dataKey: 'rmb1Data' }
        ]
    },
    {
        id: 'hk',
        name: '港币',
        children: [
            { id: 'hk_boc', name: '中国银行（香港）', dataKey: 'hk_bocData' },
            { id: 'hk_hsbc', name: '香港上海汇丰银行', dataKey: 'hk_hsbcData' },
            { id: 'hk_sc', name: '渣打银行（香港）', dataKey: 'hk_scData' },
            { id: 'hk_gov', name: '香港政府', dataKey: 'hk_govData' }
        ]
    },
    {
        id: 'macau',
        name: '澳门币（澳门元）',
        children: [
            { id: 'macau_boc', name: '中国银行', dataKey: 'macau_bocData' },
            { id: 'macau_bnu', name: '大西洋银行', dataKey: 'macau_bnuData' }
        ]
    },
    {
        id: 'taiwan',
        name: '台币',
        dataKey: 'taiwanData',
        children: null
    },
    {
        id: 'foreign',
        name: '外币',
        children: [
            { id: 'japan', name: '日本', dataKey: 'japanData' },
            { id: 'indonesia', name: '印度尼西亚', dataKey: 'indonesiaData' },
            { id: 'venezuela', name: '委内瑞拉', dataKey: 'venezuelaData' },
            { id: 'ukarine', name: '乌克兰', dataKey: 'ukarineData' },
            { id: 'russia', name: '俄罗斯', dataKey: 'russiaData' },
            //{ id: 'vietnam', name: '越南', dataKey: 'vietnamData' }
        ]
    },
    {
        id: 'republic',
        name: '民国纸币',
        children: [
            { id: 'republic_cbc', name: '中央银行', dataKey: 'republic_cbcData' },
            { id: 'republic_boc', name: '中国银行', dataKey: 'republic_bocData' },
            { id: 'republic_communications', name: '交通银行', dataKey: 'republic_communicationsData' },
            { id: 'republic_fbc', name: '中国农民银行', dataKey: 'republic_fbcData' },
            { id: 'republic_kpb', name: '广东省银行', dataKey: 'republic_kpbData' },
            { id: 'republic_crbc', name: '中央储备银行', dataKey: 'republic_crbcData' },
            { id: 'republic_aib', name: '厦门劝业银行', dataKey: 'republic_aibData' },
            { id: 'japanMilitary', name: '大日本帝国政府军用手票', dataKey: 'japanMilitaryData' },
            { id: 'republic_spb', name: '南方人民银行', dataKey: 'republic_spbData' },
            { id: 'republic_mfrc', name: '中华民国财政部', dataKey: 'republic_mfrcData' }
        ]
    },
    {
        id: 'ticket',
        name: '票证',
        children: [
            { id: 'pvpb', name: '人民胜利折实公债券', dataKey: 'pvpbData' },
            { id: 'nedb', name: '国家经济建设公债', dataKey: 'nedbData' },
            { id: 'lecb', name: '地方经济建设公债', dataKey: 'lecbData' },
            { id: 'dscc', name: '复员军人兑取现金券', dataKey: 'dsccData' },
            { id: 'fec', name: '外汇兑换券', dataKey: 'fecData' },
            { id: 'gkq', name: '国库券', dataKey: 'gkqData' }
        ]
    }
];

// 子分类查找映射
const subCategoryMap = {};
(function buildMap() {
    for (const cat of categoryTree) {
        if (cat.children) {
            for (const sub of cat.children) {
                subCategoryMap[sub.id] = {
                    parentId: cat.id,
                    name: sub.name,
                    dataKey: sub.dataKey
                };
            }
        }
    }
})();

// 所有 dataKey 列表
const allDataKeys = [];
(function collectKeys() {
    for (const cat of categoryTree) {
        if (cat.children) {
            for (const sub of cat.children) {
                if (sub.dataKey) allDataKeys.push(sub.dataKey);
            }
        } else if (cat.dataKey) {
            allDataKeys.push(cat.dataKey);
        }
    }
})();

// 图片路径前缀（旧站图片相对于新站的位置）
const IMAGE_BASE = '../notecollection/';

// 获取数据（通过 DATA_MAP 桥接）
function getData(dataKey) {
    return window.DATA_MAP && window.DATA_MAP[dataKey] ? window.DATA_MAP[dataKey] : null;
}
