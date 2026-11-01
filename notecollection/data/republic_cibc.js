// data/republic_cibc.js
const republic_cibcData = {
    name: "民国震义银行",
    icon: null,
    desc: "The Chinese Italian Banking Corporation",
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
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],
    series: 
    [
        {
            seriesName: "中华民国十年（1921年） 美钞版 兑换券",
            year: "1921",
            varieties: [
                {
                    varietyName: "1921年 1元 知春亭",
                    copies: [
                        {
                            copyId: 0,
                            year: 1921,
                            version: "385166",
                            bank: "震义银行",
                            print: "美国钞票公司/ABNC",
                            signature1: "经理（Manager）：---",
                            signature2: "副总裁（President）：---",
                            issueDate: "民国十年九月十五日（1921年9月15日）",
                            withdrawnDate: "实际未发行",
                            size: "",
                            condition: "暂未评级",
                            price: "650元",
                            purchaseDate: "2026年11月1日",
                            krause: "S253r",
                            remark: "库存票（Remainder），无签名、印章以及加盖地名。",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/republic_cibc/385166-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/republic_cibc/385166-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
