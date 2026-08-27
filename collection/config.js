// ========== 新站分类树定义 ==========

const categoryTree = [
    {
        id: 'commemorative',
        name: '纪念钞',
        dataKey: 'commemorativeData',
        dataFile: '../notecollection/data/commemorative.js',
        children: null
    },
    {
        id: 'uncut',
        name: '连体钞',
        dataKey: 'uncutData',
        dataFile: '../notecollection/data/uncut.js',
        children: null
    },
    {
        id: 'rmb',
        name: '人民币',
        children: [
            { id: 'rmb5', name: '第五套人民币', dataKey: 'rmb5Data', dataFile: '../notecollection/data/rmb5.js' },
            { id: 'rmb4', name: '第四套人民币', dataKey: 'rmb4Data', dataFile: '../notecollection/data/rmb4.js' },
            { id: 'rmb3', name: '第三套人民币', dataKey: 'rmb3Data', dataFile: '../notecollection/data/rmb3.js' },
            { id: 'rmb2', name: '第二套人民币', dataKey: 'rmb2Data', dataFile: '../notecollection/data/rmb2.js' },
            { id: 'rmb1', name: '第一套人民币', dataKey: 'rmb1Data', dataFile: '../notecollection/data/rmb1.js' }
        ]
    },
    {
        id: 'hk',
        name: '港币',
        children: [
            { id: 'hk_boc', name: '中国银行（香港）', dataKey: 'hk_bocData', dataFile: '../notecollection/data/hk_boc.js' },
            { id: 'hk_hsbc', name: '香港上海汇丰银行', dataKey: 'hk_hsbcData', dataFile: '../notecollection/data/hk_hsbc.js' },
            { id: 'hk_sc', name: '渣打银行（香港）', dataKey: 'hk_scData', dataFile: '../notecollection/data/hk_sc.js' },
            { id: 'hk_gov', name: '香港政府', dataKey: 'hk_govData', dataFile: '../notecollection/data/hk_gov.js' }
        ]
    },
    {
        id: 'macau',
        name: '澳门币（澳门元）',
        children: [
            { id: 'macau_boc', name: '中国银行', dataKey: 'macau_bocData', dataFile: '../notecollection/data/macau_boc.js' },
            { id: 'macau_bnu', name: '大西洋银行', dataKey: 'macau_bnuData', dataFile: '../notecollection/data/macau_bnu.js' }
        ]
    },
    {
        id: 'taiwan',
        name: '台币',
        dataKey: 'taiwanData',
        dataFile: '../notecollection/data/taiwan.js',
        children: null
    },
    {
        id: 'foreign',
        name: '外币',
        children: [
            { id: 'japan', name: '日本', dataKey: 'japanData', dataFile: '../notecollection/data/japan.js' },
            { id: 'indonesia', name: '印度尼西亚', dataKey: 'indonesiaData', dataFile: '../notecollection/data/indonesia.js' },
            { id: 'venezuela', name: '委内瑞拉', dataKey: 'venezuelaData', dataFile: '../notecollection/data/venezuela.js' },
            { id: 'ukarine', name: '乌克兰', dataKey: 'ukarineData', dataFile: '../notecollection/data/ukarine.js' },
            { id: 'russia', name: '俄罗斯', dataKey: 'russiaData', dataFile: '../notecollection/data/russia.js' }
        ]
    },
    {
        id: 'republic',
        name: '民国纸币',
        children: [
            { id: 'republic_cbc', name: '中央银行', dataKey: 'republic_cbcData', dataFile: '../notecollection/data/republic_cbc.js' },
            { id: 'republic_boc', name: '中国银行', dataKey: 'republic_bocData', dataFile: '../notecollection/data/republic_boc.js' },
            { id: 'republic_communications', name: '交通银行', dataKey: 'republic_communicationsData', dataFile: '../notecollection/data/republic_communications.js' },
            { id: 'republic_fbc', name: '中国农民银行', dataKey: 'republic_fbcData', dataFile: '../notecollection/data/republic_fbc.js' },
            { id: 'republic_crbc', name: '中央储备银行', dataKey: 'republic_crbcData', dataFile: '../notecollection/data/republic_crbc.js' },
            { id: 'republic_kpb', name: '广东省银行', dataKey: 'republic_kpbData', dataFile: '../notecollection/data/republic_kpb.js' },
            { id: 'republic_pbkc', name: '贵州省银行', dataKey: 'republic_pbkcData', dataFile: '../notecollection/data/republic_pbkc.js' },
            { id: 'republic_thnb', name: '海南银行', dataKey: 'republic_thnbData', dataFile: '../notecollection/data/republic_thnb.js' },
            { id: 'republic_aib', name: '厦门劝业银行', dataKey: 'republic_aibData', dataFile: '../notecollection/data/republic_aib.js' },
            { id: 'republic_spb', name: '南方人民银行', dataKey: 'republic_spbData', dataFile: '../notecollection/data/republic_spb.js' },
            { id: 'republic_mfrc', name: '中华民国财政部', dataKey: 'republic_mfrcData', dataFile: '../notecollection/data/republic_mfrc.js' }
        ]
    },
    {
        id: 'military',
        name: '军票',
        children: [
            { id: 'japanMilitary', name: '侵华日军军用手票', dataKey: 'japanMilitaryData', dataFile: '../notecollection/data/japan_military.js' },
            { id: 'jp_burma', name: '日占缅甸', dataKey: 'jp_burmaData', dataFile: '../notecollection/data/jp_burma.js' }
        ]
    },
    {
        id: 'ticket',
        name: '票证',
        children: [
            { id: 'pvpb', name: '人民胜利折实公债券', dataKey: 'pvpbData', dataFile: '../notecollection/data/pvpb.js' },
            { id: 'nedb', name: '国家经济建设公债', dataKey: 'nedbData', dataFile: '../notecollection/data/nedb.js' },
            { id: 'lecb', name: '地方经济建设公债', dataKey: 'lecbData', dataFile: '../notecollection/data/lecb.js' },
            { id: 'dscc', name: '复员军人兑取现金券', dataKey: 'dsccData', dataFile: '../notecollection/data/dscc.js' },
            { id: 'fec', name: '外汇兑换券', dataKey: 'fecData', dataFile: '../notecollection/data/fec.js' },
            { id: 'gkq', name: '国库券', dataKey: 'gkqData', dataFile: '../notecollection/data/gkq.js' }
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

// ★ 图片路径由 CDN_BASE 统一处理（core.js 中定义）
// IMAGE_BASE 已废弃删除

// 获取数据（通过 DATA_MAP 桥接）
function getData(dataKey) {
    return window.DATA_MAP && window.DATA_MAP[dataKey] ? window.DATA_MAP[dataKey] : null;
}