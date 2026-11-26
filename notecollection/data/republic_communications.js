// data/republic_communications.js
const republic_communicationsData = {
    name: "民国交通银行",
    icon: null,
    desc: "Bank of Communications",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行方" },
        { key: "print", label: "印刷机构" },
        { key: "signature1", label: "签名1"},
        { key: "signature2", label: "签名2"},
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "withdrawnDate", label: "停止流通日期" },
        { key: "size", label: "标准尺寸" },
        { key: "wmk", label: "水印" },
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],
series: [
        {
            seriesName: "中华民国三年（1914年） 美钞版 国币券",
            year: "1914",
            varieties: [
                {
                    varietyName: "1914年 5元 火车头",
                    readmes: [
                        { title: "民国三年版交通银行伍圆券精制版假钞分析", content: "file:readmes/republic_1914_5_yuan_fake_note_zhihu_lee.html" }
                    ],
                    copies: [
                        {
                            copyId: 26073358,
                            year: 1914,
                            version: "SB648728R",
                            bank: "交通银行",
                            print: "美国钞票公司/ABNC",
                            signature1: "董事长：王子崧（J.S. Wong）",
                            signature2: "总经理：唐寿民（S.M. Tang）",
                            issueDate: "1914年10月1日",
                            withdrawnDate: "",
                            size: "79mm*162mm",
                            condition: "ACG 64E",
                            price: "188元",
                            purchaseDate: "2026年2月4日",
                            krause: "117n",
                            remark: "火车头（橄色） 加盖黑上海；关于背面建筑的考证，见https://zhuanlan.zhihu.com/p/578041345",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/SB648728R-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/SB648728R-2.jpg"
                        }
                    ]
                },{
                    varietyName: "1914年 10元 上海海关大楼",
                    copies: [
                        {
                            copyId: 16866863,
                            year: 1914,
                            version: "SB052887D",
                            bank: "交通银行",
                            condition: "ACG 64E",
                            price: "198元",
                            purchaseDate: "2026年2月15日",
                            krause: "118q",
                            print: "美国钞票公司/ABNC",
                            signature1: "董事长：王子崧（J.S. Wong）",
                            signature2: "总经理：唐寿民（S.M. Tang）",
                            issueDate: "1914年10月1日",
                            withdrawnDate: "",
                            size: "79mm*162mm",
                            remark: "大楼（红色） 加盖蓝上海",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/SB052887D-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/SB052887D-2.jpg"
                        }
                    ]
                }
            ]
        },{
            seriesName: "中华民国二十四年（1935年） 德纳罗版 法币券",
            year: "1914",
            varieties: [
                {
                    varietyName: "1935年 5元 帆船",
                    copies: [
                        {
                            copyId: "2232983-007",
                            year: 1935,
                            version: "D495407M",
                            bank: "交通银行",
                            print: "德纳罗印钞公司/TDLR",
                            signature1: "董事长：王子崧（J.S. Wong）",
                            signature2: "总经理：许敬甫（T.Y. Hsu）",
                            issueDate: "1914年10月1日",
                            withdrawnDate: "",
                            size: "",
                            condition: "PMG 64E",
                            price: "228元",
                            purchaseDate: "2026年11月7日",
                            krause: "154a",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/PMG2232983-007_REV.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/PMG2232983-007_OBV.jpg"
                        }
                    ]
                }
            ]
        }/*,{
            seriesName: "中华民国三十一年（1942年） 京华版 美金节约建国储蓄券",
            year: "1914",
            varieties: [
                {
                    varietyName: "1942年 美金50元",
                    copies: [
                        {
                            copyId: 27171412,
                            year: 1942,
                            version: "0017545",
                            bank: "交通银行",
                            print: "京华印书馆/CHPH",
                            signature1: "",
                            signature2: "",
                            issueDate: "1942年12月1日",
                            withdrawnDate: "",
                            size: "",
                            condition: "假币退回",
                            // ★ 价格口径（用户 2026-11 更正）：115 元**已经含了那 45 元评级费**
                            //   （站点口径本来就是"录入价含评级费"）⇒ 裸币 70 元/枚，两枚裸币合计 140 元；
                            //   评级费 90 元在台账里单列（按用户口径"当作售出"，不进总价）。
                            //   ★ 上一版这里写成 160（115 + 45）是**重复计费**，已改回 115。
                            //   整段是注释掉的 ⇒ 既不进藏品总数，也不进页面"一共花了"的总价。
                            price: "115元",
                            purchaseDate: "2026年10月1日",
                            krause: "",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/27171412-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/27171412-2.jpg"
                        }
                    ]
                },{
                    varietyName: "1942年 美金100元",
                    copies: [
                        {
                            copyId: 27171413,
                            year: 1942,
                            version: "0003309",
                            bank: "交通银行",
                            print: "京华印书馆/CHPH",
                            signature1: "",
                            signature2: "",
                            issueDate: "1942年12月1日",
                            withdrawnDate: "",
                            size: "",
                            condition: "假币退回",
                            // ★ 价格口径（用户 2026-11 更正）：115 元**已经含了那 45 元评级费**
                            //   （站点口径本来就是"录入价含评级费"）⇒ 裸币 70 元/枚，两枚裸币合计 140 元；
                            //   评级费 90 元在台账里单列（按用户口径"当作售出"，不进总价）。
                            //   ★ 上一版这里写成 160（115 + 45）是**重复计费**，已改回 115。
                            //   整段是注释掉的 ⇒ 既不进藏品总数，也不进页面"一共花了"的总价。
                            price: "115元",
                            purchaseDate: "2026年10月1日",
                            krause: "",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/27171413-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/republic_communications/27171413-2.jpg"
                        }
                    ]
                }
            ]
        }*/
    ]
};
