// data/republic_cbc.js
const republic_cbcData = {
    name: "民国中央银行",
    icon: null,
    desc: "The Central Bank of China",
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
        { key: "krause", label: "克劳斯目录编码" }
    ],
    series: [
        {
            seriesName: "1941年 10元",
            year: "1941",
            copies: [
                {
                    copyId: 1,
                    year: 1941,
                    version: "FJ772552",
                    bank: "中央银行",
                    print: "美商保安钞票公司/SBNC",
                    issueDate: "",
                    withdrawnDate: "",
                    size: "79mm*162mm",
                    condition: "ACG63E",
                    price: "108元",
                    purchaseDate: "2026年2月23日",
                    krause: "239a",
                    remark: "",
                    img1: "image/republic_cbc/FJ772552-1.jpg",
                    img2: "image/republic_cbc/FJ772552-2.jpg"
                }
            ]
        },
        {
            seriesName: "1941年 100元",
            year: "1941",
            copies: [
                {
                    copyId: 1,
                    year: 1941,
                    version: "IO038655",
                    bank: "中央银行",
                    print: "美商保安钞票公司/SBNC",
                    issueDate: "",
                    withdrawnDate: "",
                    size: "79mm*162mm",
                    condition: "PMG65E",
                    price: "298元",
                    purchaseDate: "2026年2月25日",
                    krause: "243a",
                    remark: "",
                    img1: "image/republic_cbc/IO038655-1.jpg",
                    img2: "image/republic_cbc/IO038655-2.jpg"
                }
            ]
        }
    ]
};
