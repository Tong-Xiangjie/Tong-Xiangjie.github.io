// data/grading_fee.js
// ==================== 评 级 费 批 次 台 账 ====================
// 数据来源：用户"自己送评级公司(ACG)"的 5 份《爱藏评级费用清单》xlsx
//   （Desktop/word文件/ACG/PJ*.xlsx）。
//
// ★★ 支出判据：**匹配不到 copyId 的行视为已售出，不计入评级费** ★★
//   规则来自用户：卖出的藏品已从藏品数据里移除，且售价里已经含了评级费，
//   所以那笔评级费通过售价回收了，不再算作支出。
//   ⇒ 判据只有一条：台账某行的 cert 在藏品 copyId 里**找不到匹配** = 已售出。
//   含以下 4 个编码（已从 items[] 移除，仅在此留档以便追溯）：
//     26011872（1990年壹佰圆）/ 26288328（2026年贰拾圆 马年贺岁纪念钞 标十）
//     26626174（2009年壹佰伍拾圆 港币纪念钞）/ 27104088（1918年拾圆 兑换券）
//   ★ 已知取舍：以后若出现"刚买、还没录入藏品数据"的送评行，也会被同样排除 ——
//     这是用户确认过的口径（"一切以录入的数据为准"，不用"现在还在不在手上"去猜）。
//
// ★ 本文件只存**无法从藏品记录推导**的东西，其余一律复用藏品数据：
//     · items[].cert 就是 ACG 评级证书编号 = 藏品里的 copyId（一一对应），
//       名称/冠号/分数/EPQ/版别/尺寸/数量都不再重复存 —— 展示时按 cert 去藏品记录取；
//     · items[] 只保留 listFee / paidFee（这两个只有台账有）；
//     · 批次只保留 pj / sentDate / paidDate / items / 合计。
//   ★ 不要把表格的全字段抄进来：那是同一份信息的第二副本，迟早会与藏品对不上。
//
// ★ 两个"合计"要分清（每批都各有其一）：
//     · itemCount / listFee / paidFee = 该批**支出**（= 未售出行之和）→ 统计与时间轴用这个；
//     · sheet* 那一组 = xlsx 表格上的**实收留档值**（含已售出行），不参与统计。
//   两者之差就是被排除的已售出行金额，每批另有 soldCount / soldPaidFee。
//
// ★ 按【付款日期】paidDate 计入支出，不是送评日期（sentDate 只留档，不参与统计）。
//   5 个付款日期：2025-12-17 / 2026-01-29 / 2026-04-01 / 2026-07-01 / 2026-10-01。
//
// ★ 金额口径：表格"评级费原价"与"实际费用"两列，折扣固定"代理折扣9折"，
//   即 paidFee = listFee × 0.9（逐行成立，无例外）。**支出用 paidFee**。
//   两者都保留人类可读字符串（"297元"、"1615.5元"），与藏品 price: "18元" 风格一致。
//
// ★ 批次 4（PJ20260615262532）：xlsx 汇总块字面写作"1,615元"，但同块算术 1795-179.5
//   = 1615.5、且行级合计也是 1615.5，经用户裁定以 1615.5 为准（字面视为显示舍入）。
//   该批没有已售出行，所以支出 = 留档值 = 1615.5元。
//
// ★ 重复编码 26626187：批次 3 与批次 4 各出现一次（同一枚 Pick#134 2024 50 Hryven）。
//   用户裁定"只算第一次"—— 批次 3 计 30/27 元，批次 4 计 0/0 元，总计不受影响。
//
// ★ 换壳行：冠号 FJ772552 的 1941年壹圆（批次 4 最后一行）是半价换壳，
//   原价 15、实际费用 13.5（= 常规 30 的一半再打 9 折）。标 reholder: true，照录入计。
//
// ★ 台账性质：不写 series/copies，因此不进 collectAllCopies()；
//   藏品总数仍 396 件，均价/评级/年代统计/价格清单都不受影响。
//
// ★ 已剔除：xlsx 汇总块里属于客户的那一块（姓名、电话、聊天软件号码、订单编号）。
// ============================================================

const gradingFeeData = {
    name: "评级费批次",
    icon: null,
    desc: "ACG Grading Fee Batches（费用台账，不参与藏品统计）",
    remark: "评级费单独登记，按【付款日期】计入支出；匹配不到 copyId 的行视为已售出、不计入；不是藏品，不计入藏品总数与均价。",
    // ★ 显式空数组：本文件不是藏品，永远为空（显式写出来，避免被当成"忘了写"）。
    series: [],
    // ★ 故意不声明 detailFields：没有 copies，页面不会渲染任何详情弹窗。
    // ★ 汇总（**支出口径** = 未售出行 paidFee 之和；已售出的 4 行不计）
    totals: {
        itemCount: 119,
        listFee: "4485元",
        paidFee: "4036.5元",
        // 留档：xlsx 表格上的实收（含已售出行），不参与统计
        sheetItemCount: 123,
        sheetListFee: "4665元",
        sheetPaidFee: "4198.5元",
        // 被排除的已售出行（匹配不到 copyId）
        soldCount: 4,
        soldPaidFee: "162元"
    },
    // 5 个批次，按【付款日期】升序
    batches: [
        {
            pj: "PJ20251125235158",
            sentDate: "2025-11-25",        // 送评日期（取自文件名，只留档）
            paidDate: "2025-12-17",        // ★ 付款日期：支出口径按它落位
            // ★ 支出（= 未售出行之和）：统计与时间轴用这三个
            itemCount: 11,
            listFee: "310元",
            paidFee: "279元",
            // 留档：xlsx 表格上的实收（含该批已售出行），不参与统计
            sheetItemCount: 12,
            sheetListFee: "330元",
            sheetPaidFee: "297元",
            soldCount: 1,
            soldPaidFee: "18元",
            // 每行只留 cert + 两个金额（名称/冠号/分数等一律按 cert 去藏品记录取）
            items: [
                { cert: "26011870", listFee: "20元", paidFee: "18元" },
                { cert: "26011871", listFee: "20元", paidFee: "18元" },
                { cert: "26011873", listFee: "20元", paidFee: "18元" },
                { cert: "26011874", listFee: "50元", paidFee: "45元" },
                { cert: "26011875", listFee: "20元", paidFee: "18元" },
                { cert: "26011876", listFee: "20元", paidFee: "18元" },
                { cert: "26011877", listFee: "20元", paidFee: "18元" },
                { cert: "26011878", listFee: "20元", paidFee: "18元" },
                { cert: "26011879", listFee: "20元", paidFee: "18元" },
                { cert: "26011880", listFee: "20元", paidFee: "18元" },
                { cert: "26011881", listFee: "80元", paidFee: "72元" }
            ]
        },
        {
            pj: "PJ20260125243493",
            sentDate: "2026-01-25",        // 送评日期（取自文件名，只留档）
            paidDate: "2026-01-29",        // ★ 付款日期：支出口径按它落位
            // ★ 支出（= 未售出行之和）：统计与时间轴用这三个
            itemCount: 14,
            listFee: "470元",
            paidFee: "423元",
            // 留档：xlsx 表格上的实收（含该批已售出行），不参与统计
            sheetItemCount: 15,
            sheetListFee: "550元",
            sheetPaidFee: "495元",
            soldCount: 1,
            soldPaidFee: "72元",
            // 每行只留 cert + 两个金额（名称/冠号/分数等一律按 cert 去藏品记录取）
            items: [
                { cert: "26288329", listFee: "80元", paidFee: "72元" },
                { cert: "26288330", listFee: "30元", paidFee: "27元" },
                { cert: "26288331", listFee: "30元", paidFee: "27元" },
                { cert: "26288332", listFee: "30元", paidFee: "27元" },
                { cert: "26288333", listFee: "30元", paidFee: "27元" },
                { cert: "26288334", listFee: "30元", paidFee: "27元" },
                { cert: "26288335", listFee: "30元", paidFee: "27元" },
                { cert: "26288336", listFee: "30元", paidFee: "27元" },
                { cert: "26288337", listFee: "30元", paidFee: "27元" },
                { cert: "26288338", listFee: "30元", paidFee: "27元" },
                { cert: "26288339", listFee: "30元", paidFee: "27元" },
                { cert: "26288340", listFee: "30元", paidFee: "27元" },
                { cert: "26288341", listFee: "30元", paidFee: "27元" },
                { cert: "26288342", listFee: "30元", paidFee: "27元" }
            ]
        },
        {
            pj: "PJ20260310253570",
            sentDate: "2026-03-10",        // 送评日期（取自文件名，只留档）
            paidDate: "2026-04-01",        // ★ 付款日期：支出口径按它落位
            // ★ 支出（= 未售出行之和）：统计与时间轴用这三个
            itemCount: 33,
            listFee: "1010元",
            paidFee: "909元",
            // 留档：xlsx 表格上的实收（含该批已售出行），不参与统计
            sheetItemCount: 34,
            sheetListFee: "1040元",
            sheetPaidFee: "936元",
            soldCount: 1,
            soldPaidFee: "27元",
            // 每行只留 cert + 两个金额（名称/冠号/分数等一律按 cert 去藏品记录取）
            items: [
                { cert: "26626154", listFee: "50元", paidFee: "45元" },
                { cert: "26626155", listFee: "30元", paidFee: "27元" },
                { cert: "26626156", listFee: "30元", paidFee: "27元" },
                { cert: "26626157", listFee: "30元", paidFee: "27元" },
                { cert: "26626158", listFee: "30元", paidFee: "27元" },
                { cert: "26626159", listFee: "30元", paidFee: "27元" },
                { cert: "26626160", listFee: "30元", paidFee: "27元" },
                { cert: "26626161", listFee: "30元", paidFee: "27元" },
                { cert: "26626162", listFee: "30元", paidFee: "27元" },
                { cert: "26626163", listFee: "30元", paidFee: "27元" },
                { cert: "26626164", listFee: "30元", paidFee: "27元" },
                { cert: "26626165", listFee: "30元", paidFee: "27元" },
                { cert: "26626166", listFee: "30元", paidFee: "27元" },
                { cert: "26626167", listFee: "30元", paidFee: "27元" },
                { cert: "26626168", listFee: "30元", paidFee: "27元" },
                { cert: "26626169", listFee: "30元", paidFee: "27元" },
                { cert: "26626170", listFee: "30元", paidFee: "27元" },
                { cert: "26626171", listFee: "30元", paidFee: "27元" },
                { cert: "26626172", listFee: "30元", paidFee: "27元" },
                { cert: "26626173", listFee: "30元", paidFee: "27元" },
                { cert: "26626175", listFee: "30元", paidFee: "27元" },
                { cert: "26626176", listFee: "30元", paidFee: "27元" },
                { cert: "26626177", listFee: "30元", paidFee: "27元" },
                { cert: "26626178", listFee: "30元", paidFee: "27元" },
                { cert: "26626179", listFee: "30元", paidFee: "27元" },
                { cert: "26626180", listFee: "30元", paidFee: "27元" },
                { cert: "26626181", listFee: "30元", paidFee: "27元" },
                { cert: "26626182", listFee: "30元", paidFee: "27元" },
                { cert: "26626183", listFee: "30元", paidFee: "27元" },
                { cert: "26626184", listFee: "30元", paidFee: "27元" },
                { cert: "26626185", listFee: "30元", paidFee: "27元" },
                { cert: "26626186", listFee: "30元", paidFee: "27元" },
                { cert: "26626187", listFee: "30元", paidFee: "27元" }
            ]
        },
        {
            pj: "PJ20260615262532",
            sentDate: "2026-06-15",        // 送评日期（取自文件名，只留档）
            paidDate: "2026-07-01",        // ★ 付款日期：支出口径按它落位
            // ★ 支出（= 未售出行之和）：统计与时间轴用这三个
            itemCount: 35,
            listFee: "1795元",
            paidFee: "1615.5元",
            // 留档：xlsx 表格上的实收（含该批已售出行），不参与统计
            sheetItemCount: 35,
            sheetListFee: "1795元",
            sheetPaidFee: "1615.5元",
            soldCount: 0,
            soldPaidFee: "0元",
            // 每行只留 cert + 两个金额（名称/冠号/分数等一律按 cert 去藏品记录取）
            items: [
                { cert: "26626187", listFee: "0元", paidFee: "0元" },
                { cert: "26992531", listFee: "60元", paidFee: "54元" },
                { cert: "26992532", listFee: "60元", paidFee: "54元" },
                { cert: "26992533", listFee: "60元", paidFee: "54元" },
                { cert: "26992534", listFee: "60元", paidFee: "54元" },
                { cert: "26992535", listFee: "30元", paidFee: "27元" },
                { cert: "26992536", listFee: "30元", paidFee: "27元" },
                { cert: "26992537", listFee: "30元", paidFee: "27元" },
                { cert: "26992538", listFee: "30元", paidFee: "27元" },
                { cert: "26992539", listFee: "30元", paidFee: "27元" },
                { cert: "26992540", listFee: "50元", paidFee: "45元" },
                { cert: "26992541", listFee: "50元", paidFee: "45元" },
                { cert: "26992542", listFee: "50元", paidFee: "45元" },
                { cert: "26992543", listFee: "50元", paidFee: "45元" },
                { cert: "26992544", listFee: "50元", paidFee: "45元" },
                { cert: "26992545", listFee: "60元", paidFee: "54元" },
                { cert: "26992546", listFee: "60元", paidFee: "54元" },
                { cert: "26992547", listFee: "60元", paidFee: "54元" },
                { cert: "26992548", listFee: "60元", paidFee: "54元" },
                { cert: "26992549", listFee: "60元", paidFee: "54元" },
                { cert: "26992550", listFee: "60元", paidFee: "54元" },
                { cert: "26992551", listFee: "60元", paidFee: "54元" },
                { cert: "26992552", listFee: "60元", paidFee: "54元" },
                { cert: "26992553", listFee: "60元", paidFee: "54元" },
                { cert: "26992554", listFee: "60元", paidFee: "54元" },
                { cert: "26992555", listFee: "60元", paidFee: "54元" },
                { cert: "26992556", listFee: "60元", paidFee: "54元" },
                { cert: "26992557", listFee: "60元", paidFee: "54元" },
                { cert: "26992558", listFee: "60元", paidFee: "54元" },
                { cert: "26992559", listFee: "60元", paidFee: "54元" },
                { cert: "26992560", listFee: "60元", paidFee: "54元" },
                { cert: "26992561", listFee: "60元", paidFee: "54元" },
                { cert: "26992562", listFee: "60元", paidFee: "54元" },
                { cert: "26992563", listFee: "60元", paidFee: "54元" },
                { cert: "19006336", reholder: true, listFee: "15元", paidFee: "13.5元" }
            ]
        },
        {
            pj: "PJ20260906266166",
            sentDate: "2026-09-06",        // 送评日期（取自文件名，只留档）
            paidDate: "2026-10-01",        // ★ 付款日期：支出口径按它落位
            // ★ 支出（= 未售出行之和）：统计与时间轴用这三个
            itemCount: 26,
            listFee: "900元",
            paidFee: "810元",
            // 留档：xlsx 表格上的实收（含该批已售出行），不参与统计
            sheetItemCount: 27,
            sheetListFee: "950元",
            sheetPaidFee: "855元",
            soldCount: 1,
            soldPaidFee: "45元",
            // 每行只留 cert + 两个金额（名称/冠号/分数等一律按 cert 去藏品记录取）
            items: [
                { cert: "27104067", listFee: "30元", paidFee: "27元" },
                { cert: "27104068", listFee: "30元", paidFee: "27元" },
                { cert: "27104069", listFee: "30元", paidFee: "27元" },
                { cert: "27104070", listFee: "30元", paidFee: "27元" },
                { cert: "27104071", listFee: "30元", paidFee: "27元" },
                { cert: "27104072", listFee: "30元", paidFee: "27元" },
                { cert: "27104073", listFee: "30元", paidFee: "27元" },
                { cert: "27104074", listFee: "30元", paidFee: "27元" },
                { cert: "27104075", listFee: "30元", paidFee: "27元" },
                { cert: "27104076", listFee: "30元", paidFee: "27元" },
                { cert: "27104077", listFee: "30元", paidFee: "27元" },
                { cert: "27104078", listFee: "30元", paidFee: "27元" },
                { cert: "27104079", listFee: "30元", paidFee: "27元" },
                { cert: "27104080", listFee: "30元", paidFee: "27元" },
                { cert: "27104081", listFee: "30元", paidFee: "27元" },
                { cert: "27104082", listFee: "30元", paidFee: "27元" },
                { cert: "27104083", listFee: "30元", paidFee: "27元" },
                { cert: "27104084", listFee: "30元", paidFee: "27元" },
                { cert: "27104085", listFee: "30元", paidFee: "27元" },
                { cert: "27104086", listFee: "50元", paidFee: "45元" },
                { cert: "27104087", listFee: "50元", paidFee: "45元" },
                { cert: "27104089", listFee: "50元", paidFee: "45元" },
                { cert: "27104090", listFee: "50元", paidFee: "45元" },
                { cert: "27104091", listFee: "50元", paidFee: "45元" },
                { cert: "27104092", listFee: "50元", paidFee: "45元" },
                { cert: "27104093", listFee: "30元", paidFee: "27元" }
            ]
        }
    ]
};
