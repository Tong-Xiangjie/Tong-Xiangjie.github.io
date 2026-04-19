// data/republic_boc.js
const republic_bocData = {
    name: "民国中国银行",
    icon: null,
    desc: "Bank of China",
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
            seriesName: "1937年 10元",
            year: "1937",
            copies: [
                {
                    copyId: 1,
                    year: 1937,
                    version: "AH799383",
                    bank: "中国银行",
                    print: "德纳罗印钞公司/TDLR",
                    issueDate: "",
                    withdrawnDate: "",
                    size: "79mm*162mm",
                    condition: "ACG64E",
                    price: "90元",
                    purchaseDate: "2026年1月24日",
                    krause: "81",
                    remark: "水印/Wmk：天坛祈年殿/Pagoda",
                    img1: "image/republic_boc/AH799383-1.jpg",
                    img2: "image/republic_boc/AH799383-2.jpg"
                }
            ]
        }
    ]
};
