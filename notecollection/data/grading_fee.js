// data/grading_fee.js
// ==================== 评 级 费 批 次 台 账 ====================
// 数据来源：用户"自己送评级公司(ACG)"的 6 份《爱藏评级费用清单》xlsx
//   （Desktop/word文件/ACG/PJ*.xlsx）。
//
// ★★ 支出判据：**匹配不到 copyId 的行视为已售出，不计入评级费** ★★
//   规则来自用户：卖出的藏品已从藏品数据里移除，且售价里已经含了评级费，
//   所以那笔评级费通过售价回收了，不再算作支出。
//   ⇒ 判据只有一条：台账某行的 cert 在藏品 copyId 里**找不到匹配** = 已售出。
//   含以下 6 个编码（已从 items[] 移除，仅在此留档以便追溯）：
//     26011872（1990年壹佰圆）/ 26288328（2026年贰拾圆 马年贺岁纪念钞 标十）
//     26626174（2009年壹佰伍拾圆 港币纪念钞）/ 27104088（1918年拾圆 兑换券）
//     27171412 / 27171413（1942年 美金50元 / 100元 京华版 —— 低仿印刷**假币退回**，
//       用户口径"台账当作是售出的"：45 元/枚照收，但亏损不计进总价，
//       那 90 元摊在它们注释段里的 price 上留档）
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
//   6 个付款日期：2025-12-17 / 2026-01-29 / 2026-04-01 / 2026-07-01 / 2026-10-01 / 2026-12-01。
//   ★ 批次 6（PJ20261109268425，送评 2026-11-09）按用户口径先落 **2026-12-01**（准备付款日）。
//     实际付款日有变动时只改这一批的 paidDate：批次合计与页面上那个总支出都是**逐批现算**的，
//     没有任何手抄数字需要跟着改。
//
// ★ 金额口径：表格"评级费原价"与"实际费用"两列，折扣固定"代理折扣9折"，
//   即 paidFee = listFee × 0.9（逐行成立，无例外）。**支出用 paidFee**。
//   两者都保留人类可读字符串（"297元"、"1615.5元"），与藏品 price: "18元" 风格一致。
//
// ★ 批次 4（PJ20260615262532）：xlsx 汇总块字面写作"1,615元"，但同块算术 1795-179.5
//   = 1615.5、且行级合计也是 1615.5，经用户裁定以 1615.5 为准（字面视为显示舍入）。
//   ★ 该批**有一行换壳行**（13.5 元）不计入支出（见下条）⇒ 支出 = 1615.5 − 13.5 = 1602 元。
//
// ★ 重复编码 26626187：批次 3 与批次 4 各出现一次（同一枚 Pick#134 2024 50 Hryven）。
//   用户裁定"只算第一次"—— 批次 3 计 30/27 元，批次 4 计 0/0 元，总计不受影响。
//
// ★★ 换壳（reholder）行：冠号 FJ772552 的 1941年壹圆（批次 4 最后一行）是半价换壳，
//   原价 15、实际费用 13.5（= 常规 30 的一半再打 9 折）。
//   ★ 用户裁定（推翻了早先"换壳也算评级费"的口径）：
//     **换壳当作原始价格处理 —— 不减费、不计入评级费。**
//   理由："凡是自己送评的一律视为裸币送评，除了换壳的当作原始价格，也不算进评级费"。
//   ⇒ 这一行标 reholder: true，**不参与 paidFee 汇总**，也不参与"裸币价"折算。
//   ⇒ 支出 = Σ（未售出 且 非换壳 行）= 4603.5 − 13.5 − 90 = **4500 元**。
//     （4603.5 = 台账各行实收之和；减 13.5 换壳，再减 90 —— 批次 6 那两枚"假币退回"
//      按用户口径**当作售出**：ACG 照样按 45 元/枚收费，但它们不在藏品里（数据被整段注释掉、
//      连图片都没有）⇒ 不摊进任何藏品的费、也不进总价，只把 90 元的亏损记在那两枚的价格里。）
//
// ★ 台账性质：不写 series/copies，因此不进 collectAllCopies()；
//   藏品总数（现为 432 件）不受台账影响，均价/评级/年代统计/价格清单都不受影响。
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
    // ★ 汇总（**支出口径** = 未售出 **且非换壳** 行的 paidFee 之和）
    totals: {
        itemCount: 131,
        listFee: "5015元",
        paidFee: "4500元",
        // 留档：xlsx 表格上的实收（含已售出行、含换壳行），不参与统计
        sheetItemCount: 138,
        sheetListFee: "5295元",
        sheetPaidFee: "4765.5元",
        // 被排除的行：已售出（匹配不到 copyId）4 行 + 换壳 1 行
        soldCount: 6,
        soldPaidFee: "252元",
        // ★ 换壳行（reholder: true）也不计入：FJ772552 / 13.5 元
        reholderCount: 1,
        reholderPaidFee: "13.5元"
    },
    // 5 个批次，按【付款日期】升序
    batches: [
        {
            pj: "PJ20251125235158",
            // ★ 评级公司：**从数据读，渲染里不写死**（以后送 PMG/PCGS 只改这里）
            grader: "爱藏评级",
            // ★ 圆角标签里的**短名**（"ACG"），同样只从数据来：渲染端不写死，缺了就省略标签。
            graderShort: "ACG",
            // ★ 该批清单文件（xlsx）。渲染出「查看清单」链接；
            //   路径是**从 collection/ 页面出发的相对路径**（../ 上一级 = 仓库根）。
            //   哪天没有这份清单，把这一行删掉即可 —— 渲染端缺字段就不出链接。
            listUrl: "../notecollection/readmes/image/grading_fee/PJ20251125235158.xlsx",
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
            // ★ 评级公司：**从数据读，渲染里不写死**（以后送 PMG/PCGS 只改这里）
            grader: "爱藏评级",
            // ★ 圆角标签里的**短名**（"ACG"），同样只从数据来：渲染端不写死，缺了就省略标签。
            graderShort: "ACG",
            // ★ 该批清单文件（xlsx）。渲染出「查看清单」链接；
            //   路径是**从 collection/ 页面出发的相对路径**（../ 上一级 = 仓库根）。
            //   哪天没有这份清单，把这一行删掉即可 —— 渲染端缺字段就不出链接。
            listUrl: "../notecollection/readmes/image/grading_fee/PJ20260125243493.xlsx",
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
            // ★ 评级公司：**从数据读，渲染里不写死**（以后送 PMG/PCGS 只改这里）
            grader: "爱藏评级",
            // ★ 圆角标签里的**短名**（"ACG"），同样只从数据来：渲染端不写死，缺了就省略标签。
            graderShort: "ACG",
            // ★ 该批清单文件（xlsx）。渲染出「查看清单」链接；
            //   路径是**从 collection/ 页面出发的相对路径**（../ 上一级 = 仓库根）。
            //   哪天没有这份清单，把这一行删掉即可 —— 渲染端缺字段就不出链接。
            listUrl: "../notecollection/readmes/image/grading_fee/PJ20260310253570.xlsx",
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
            // ★ 评级公司：**从数据读，渲染里不写死**（以后送 PMG/PCGS 只改这里）
            grader: "爱藏评级",
            // ★ 圆角标签里的**短名**（"ACG"），同样只从数据来：渲染端不写死，缺了就省略标签。
            graderShort: "ACG",
            // ★ 该批清单文件（xlsx）。渲染出「查看清单」链接；
            //   路径是**从 collection/ 页面出发的相对路径**（../ 上一级 = 仓库根）。
            //   哪天没有这份清单，把这一行删掉即可 —— 渲染端缺字段就不出链接。
            listUrl: "../notecollection/readmes/image/grading_fee/PJ20260615262532.xlsx",
            sentDate: "2026-06-15",        // 送评日期（取自文件名，只留档）
            paidDate: "2026-07-01",        // ★ 付款日期：支出口径按它落位
            // ★ 支出（= 未售出 **且非换壳** 行之和）：统计与时间轴用这三个
            //   ★ 换壳那行 13.5 元已从支出里剔除 ⇒ 1615.5 − 13.5 = 1602
            //   ★ 注意 listFee 仍写成 1795（= **全部 35 行**原价之和），
            //     这样"逐批 listFee"与"逐行 listFee 之和"、与 sheetListFee 三者仍然自洽；
            //     换壳只影响 **paidFee（支出）** 口径，不影响原价留档。
            itemCount: 34,                 // 支出口径的件数：35 行里有 1 行是换壳
            listFee: "1795元",
            paidFee: "1602元",
            // 留档：xlsx 表格上的实收（含该批已售出行与换壳行），不参与统计
            sheetItemCount: 35,
            sheetListFee: "1795元",
            sheetPaidFee: "1615.5元",
            soldCount: 0,
            soldPaidFee: "0元",
            reholderCount: 1,
            reholderPaidFee: "13.5元",
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
                // ★ 换壳行：**不计入评级费**（用户裁定："换壳的当作原始价格，也不算进评级费"），
                //   所以它不进 paidFee 汇总、也不参与"裸币价"折算（藏品那边显示原价）。
                { cert: "19006336", reholder: true, listFee: "15元", paidFee: "13.5元" }
            ]
        },
        {
            pj: "PJ20260906266166",
            // ★ 评级公司：**从数据读，渲染里不写死**（以后送 PMG/PCGS 只改这里）
            grader: "爱藏评级",
            // ★ 圆角标签里的**短名**（"ACG"），同样只从数据来：渲染端不写死，缺了就省略标签。
            graderShort: "ACG",
            // ★ 该批清单文件（xlsx）。渲染出「查看清单」链接；
            //   路径是**从 collection/ 页面出发的相对路径**（../ 上一级 = 仓库根）。
            //   哪天没有这份清单，把这一行删掉即可 —— 渲染端缺字段就不出链接。
            listUrl: "../notecollection/readmes/image/grading_fee/PJ20260906266166.xlsx",
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
        },
        {
            pj: "PJ20261109268425",
            // ★ 评级公司：**从数据读，渲染里不写死**（以后送 PMG/PCGS 只改这里）
            grader: "爱藏评级",
            // ★ 圆角标签里的**短名**（"ACG"），同样只从数据来：渲染端不写死，缺了就省略标签。
            graderShort: "ACG",
            // ★ 该批清单文件（xlsx）。渲染出「查看清单」链接；
            //   路径是**从 collection/ 页面出发的相对路径**（../ 上一级 = 仓库根）。
            listUrl: "../notecollection/readmes/image/grading_fee/PJ20261109268425.xlsx",
            sentDate: "2026-11-09",        // 送评日期（取自文件名，只留档）
            paidDate: "2026-12-01",        // ★ 付款日期（用户口径：准备付款日）：支出口径按它落位
            // ★ 支出（= 未售出行之和）；★ listFee 的口径与 paidFee 不同：它是**留在 items 里**
            //   那些行的折前原价之和（已售/退回的行不在其中），batch 5 就是这么记的。
            itemCount: 13,
            listFee: "530元",
            paidFee: "477元",
            // 留档：xlsx 表格上的实收（15 行全部）
            sheetItemCount: 15,
            sheetListFee: "630元",
            sheetPaidFee: "567元",
            // ★ 那 2 行"低仿印刷假币退回"（27171412/27171413）按用户口径**当作售出**：
            //   已从 items[] 移除、计进这里（详见文件顶部那串"已从 items[] 移除"的编码）。
            soldCount: 2,
            soldPaidFee: "90元",
            // 每行只留 cert + 两个金额（名称/冠号/分数等一律按 cert 去藏品记录取）
            //   ★ 于是本批支出 = 477 元（567 实收 − 90 那两行），页面总额里没有这笔亏损；
            //     亏损本身摊在那两枚注释段里的 price 上（115 → 160，见 republic_communications.js）。
            items: [
                { cert: "27171399", listFee: "30元", paidFee: "27元" },
                { cert: "27171400", listFee: "30元", paidFee: "27元" },
                { cert: "27171401", listFee: "30元", paidFee: "27元" },
                { cert: "27171402", listFee: "30元", paidFee: "27元" },
                { cert: "27171403", listFee: "30元", paidFee: "27元" },
                { cert: "27171404", listFee: "30元", paidFee: "27元" },
                { cert: "27171405", listFee: "50元", paidFee: "45元" },
                { cert: "27171406", listFee: "50元", paidFee: "45元" },
                { cert: "27171407", listFee: "50元", paidFee: "45元" },
                { cert: "27171408", listFee: "50元", paidFee: "45元" },
                { cert: "27171409", listFee: "50元", paidFee: "45元" },
                { cert: "27171410", listFee: "50元", paidFee: "45元" },
                { cert: "27171411", listFee: "50元", paidFee: "45元" }
            ]
        }
    ]
};
