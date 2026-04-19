// data/republic_communications.js
const republic_communicationsData = {
    name: "民国交通银行",
    icon: null,
    desc: "Bank of Communications",
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
            seriesName: "1914年 5元 橄色火车头 加盖黑上海",
            year: "1914",
            copies: [
                {
                    copyId: 1,
                    year: 1914,
                    version: "SB648728R",
                    bank: "交通银行",
                    print: "美国钞票公司/ABNC",
                    issueDate: "",
                    withdrawnDate: "",
                    size: "79mm*162mm",
                    condition: "ACG64E",
                    price: "188元",
                    purchaseDate: "2026年2月4日",
                    krause: "117n",
                    remark: "",
                    img1: "image/republic_communications/SB648728R-1.jpg",
                    img2: "image/republic_communications/SB648728R-2.jpg"
                }
            ]
        },
        {
            seriesName: "1914年 10元 红色大楼 加盖蓝上海",
            year: "1914",
            copies: [
                {
                    copyId: 1,
                    year: 1914,
                    version: "SB052887D",
                    bank: "交通银行",
                    condition: "ACG64E",
                    price: "198元",
                    purchaseDate: "2026年2月15日",
                    krause: "118q",
                    print: "美国钞票公司/ABNC",
                    issueDate: "",
                    withdrawnDate: "",
                    size: "79mm*162mm",
                    remark: "",
                    img1: "image/republic_communications/SB052887D-1.jpg",
                    img2: "image/republic_communications/SB052887D-2.jpg"
                }
            ]
        }
    ]
};
