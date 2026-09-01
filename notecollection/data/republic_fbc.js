// data/republic_fbc.js
const republic_fbcData = {
    name: "民国农民银行",
    icon: null,
    desc: "The Farmers Bank of China",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "print", label: "印刷机构" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "withdrawnDate", label: "停止流通日期" },
        { key: "size", label: "标准尺寸" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],

    series: [
        {
            seriesName: "中华民国二十六年（1937年） 大业版 法币券",
            year: "1949",
            varieties: [
                {
                    varietyName: "1937年 1角",
                    copies: [
                        {
                            copyId: 17236602,
                            year: 1937,
                            version: "MP024556",
                            bank: "中国农民银行/The Farmers Bank of China",
                            print: "中国大业公司/TYPC",
                            issueDate: "",
                            withdrawnDate: "",
                            size: "",
                            condition: "ACG 64E",
                            price: "200元",
                            purchaseDate: "2026年9月1日",
                            krause: "461",
                            remark: "",
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/republic_fbc/MP024556-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/republic_fbc/MP024556-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
