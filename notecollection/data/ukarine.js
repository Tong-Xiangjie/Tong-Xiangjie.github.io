// data/ukarine.js
const ukarineData = {
    name: "乌克兰",
    icon: null,
    desc: "Ukraine",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "size", label: "标准尺寸" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],
    series: [
        {
            seriesName: "2023年版 20格里夫纳 俄乌战争1周年纪念钞",
            year: "2023",
            copies: [
                {
                    copyId: 1,
                    year: 2023,
                    version: "ЗС0230855",
                    bank: "乌克兰国家银行/National Bank of Ukraine",
                    condition: "ACG67E",
                    price: "158元",
                    purchaseDate: "2026年1月29日",
                    krause: "133",
                    size: "80mm*165mm",
                    remark: "发行量30万张。",
                    img1: "image/ukarine/0230855-1.jpg",
                    img2: "image/ukarine/0230855-2.jpg"
                }
            ]
        },
        {
            seriesName: "2024年版 50格里夫纳 俄乌战争2周年纪念钞",
            year: "2024",
            copies: [
                {
                    copyId: 1,
                    year: 2024,
                    version: "ЄС0244876",
                    bank: "乌克兰国家银行/National Bank of Ukraine",
                    condition: "ACG68E",
                    price: "132元",
                    purchaseDate: "2026年3月1日",
                    krause: "134",
                    size: "80mm*165mm",
                    remark: "发行量30万张。",
                    img1: "image/ukarine/0244876-1.jpg",
                    img2: "image/ukarine/0244876-2.jpg"
                }
            ]
        }
    ]
};
