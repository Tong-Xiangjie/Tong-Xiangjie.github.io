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
        // ★ 原来是一个文件 data/taiwan.js（7 个系列 457 行），现按系列拆成多个文件，
        //   台币从"叶子分类"变成"父分类"，与人民币按套、港币按银行同一个结构。
        //   前 7 条是有藏品的系列（顺序沿用原文件里 series 的书写顺序）；
        //   后面几条是**尚未录入藏品**的占位系列（series: []），按时间顺序插在对应位置：
        //     三十八年直式(1949)、四十三年直式(1954) 在旧台币之后、第一套横式之前；
        //     第四套横式补在第三套与第五套之间（原文件里就没有第四套，不是漏拆）；
        //     大陈地区专用钞券按用户要求放在最后。
        children: [
            { id: 'taiwanOld', name: '战后旧台币', dataKey: 'taiwanOldData', dataFile: '../notecollection/data/taiwan_old.js' },
            { id: 'taiwan38V', name: '三十八年直式新台币', dataKey: 'taiwan38VData', dataFile: '../notecollection/data/taiwan_38v.js' },
            { id: 'taiwan43V', name: '四十三年直式新台币', dataKey: 'taiwan43VData', dataFile: '../notecollection/data/taiwan_43v.js' },
            { id: 'taiwan1', name: '第一套横式新台币', dataKey: 'taiwan1Data', dataFile: '../notecollection/data/taiwan_1.js' },
            { id: 'taiwan2', name: '第二套横式新台币', dataKey: 'taiwan2Data', dataFile: '../notecollection/data/taiwan_2.js' },
            { id: 'taiwan3', name: '第三套横式新台币', dataKey: 'taiwan3Data', dataFile: '../notecollection/data/taiwan_3.js' },
            { id: 'taiwan4', name: '第四套横式新台币', dataKey: 'taiwan4Data', dataFile: '../notecollection/data/taiwan_4.js' },
            { id: 'taiwan5', name: '第五套横式新台币', dataKey: 'taiwan5Data', dataFile: '../notecollection/data/taiwan_5.js' },
            { id: 'taiwanKm', name: '金门地区专用钞券', dataKey: 'taiwanKmData', dataFile: '../notecollection/data/taiwan_km.js' },
            { id: 'taiwanMz', name: '马祖地区专用钞券', dataKey: 'taiwanMzData', dataFile: '../notecollection/data/taiwan_mz.js' },
            { id: 'taiwanDc', name: '大陈地区专用钞券', dataKey: 'taiwanDcData', dataFile: '../notecollection/data/taiwan_dc.js' }
        ]
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
        id: 'prcAidPrinted',
        name: '中国代印系列',
        children: [
            { id: 'albania', name: '阿尔巴尼亚', dataKey: 'albaniaData', dataFile: '../notecollection/data/albania.js' },
        ]
    },
    {
        id: 'republic',
        name: '民国纸币',
        children: [
            // —— 国家银行（四大行） ——
            { id: 'republic_cbc', name: '中央银行', dataKey: 'republic_cbcData', dataFile: '../notecollection/data/republic_cbc.js' },
            { id: 'republic_boc', name: '中国银行', dataKey: 'republic_bocData', dataFile: '../notecollection/data/republic_boc.js' },
            { id: 'republic_communications', name: '交通银行', dataKey: 'republic_communicationsData', dataFile: '../notecollection/data/republic_communications.js' },
            { id: 'republic_fbc', name: '中国农民银行', dataKey: 'republic_fbcData', dataFile: '../notecollection/data/republic_fbc.js' },
            // —— 伪政权银行（按成立时间排序） ——
            { id: 'republic_cbm', name: '满洲中央银行', dataKey: 'republic_cbmData', dataFile: '../notecollection/data/republic_cbm.js' },
            { id: 'republic_tmb', name: '蒙疆银行', dataKey: 'republic_tmbData', dataFile: '../notecollection/data/republic_tmb.js' },
            { id: 'republic_frbc', name: '中国联合准备银行', dataKey: 'republic_frbcData', dataFile: '../notecollection/data/republic_frbc.js' },
            { id: 'republic_aib', name: '厦门劝业银行', dataKey: 'republic_aibData', dataFile: '../notecollection/data/republic_aib.js' },
            { id: 'republic_crbc', name: '中央储备银行', dataKey: 'republic_crbcData', dataFile: '../notecollection/data/republic_crbc.js' },
            // —— 省级银行 ——
            { id: 'republic_kpb', name: '广东省银行', dataKey: 'republic_kpbData', dataFile: '../notecollection/data/republic_kpb.js' },
            { id: 'republic_pbkc', name: '贵州省银行', dataKey: 'republic_pbkcData', dataFile: '../notecollection/data/republic_pbkc.js' },
            { id: 'republic_thnb', name: '海南银行', dataKey: 'republic_thnbData', dataFile: '../notecollection/data/republic_thnb.js' },
            // —— 特殊/其他 ——
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
            { id: 'mpc', name: '军用代金券', dataKey: 'mpcData', dataFile: '../notecollection/data/mpc.js' },
            { id: 'fec', name: '外汇兑换券', dataKey: 'fecData', dataFile: '../notecollection/data/fec.js' },
            { id: 'gkq', name: '国库券', dataKey: 'gkqData', dataFile: '../notecollection/data/gkq.js' }
        ]
    },
    {
        id: 'test_note',
        name: '纪念券',
        dataKey: 'test_noteData',
        dataFile: '../notecollection/data/test_note.js',
        children: null
    },{
        id: 'packaging_label',
        name: '纸币包装封签',
        children: [
            { id: 'brick_label', name: '捆签', dataKey: 'brick_labelData', dataFile: '../notecollection/data/brick_label.js' },
            { id: 'packet_label', name: '封包单', dataKey: 'packet_labelData', dataFile: '../notecollection/data/packet_label.js' },
            { id: 'box_label', name: '封箱单', dataKey: 'box_labelData', dataFile: '../notecollection/data/box_label.js' },
            { id: 'box_manifest', name: '箱券明细表', dataKey: 'box_manifestData', dataFile: '../notecollection/data/box_manifest.js' }
        ]
    }
];

// ★ 原 subCategoryMap（子分类查找映射）已删除：
//   它只被 core.js:getSubCategoryMap() 使用，而那个函数全站零调用；
//   而且 coin-config.js 里从来没有对应定义，一旦在硬币模式下被调用就是 ReferenceError。
//   category-view.js 早已改用 findDataKeyByCategory()，这里不再需要第二份索引。

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

// ★ getData 统一放在 core.js 里（那份是按当前模式查 DATA_MAP / COIN_DATA_MAP / FUN_DATA_MAP 的）。
//   这里以前还有一份只查 DATA_MAP 的实现，因为它后面才加载、会被 core.js 静默覆盖，
//   所以那份从来没生效过，而且对硬币本来就是错的 —— 已删除，别再往回加。
//   查顶层重名：node collection/tools/check-data.mjs