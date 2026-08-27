// data/ukarine.js
const ukarineData = {
    name: "乌克兰",
    icon: null,
    desc: "Ukraine",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行方" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "issueQuantity", label: "发行量" },
        { key: "size", label: "标准尺寸" },
        { key: "watermark", label: "水印" },
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],
    series: [
        {
            seriesName: "纪念钞",
            year: "2023～2024",
            varieties: [
                {
                    varietyName: "2023年 20格里夫纳（Hryven） 俄乌战争1周年纪念钞",
                    year: "2023",
                    copies: [
                        {
                            copyId: 23595613,
                            year: 2023,
                            version: "ЗС0230855",
                            bank: "乌克兰国家银行/National Bank of Ukraine",
                            condition: "ACG67E",
                            price: "158元",
                            purchaseDate: "2026年1月29日",
                            krause: "133",
                            size: "165mm*80mm",
                            remark: "PMG评级标签上Wmk字段的“Arms”并非“手臂”之意，而是“Coat of Arms”（国徽）的缩写",
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/ukarine/0230855-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/ukarine/0230855-2.jpg",
                            issueDate: "2023年2月23日",
                            issueQuantity: "30万",
                            watermark: "葡萄、叶子底纹之上的电印国徽（三叉戟）/Electrotype coat of arms on leaves and grapes"
                        }
                    ]
                },
                {
                    varietyName: "2024年 50格里夫纳（Hryven） 俄乌战争2周年纪念钞",
                    year: "2024",
                    copies: [
                        {
                            copyId: 26626187,
                            year: 2024,
                            version: "ЄС0244876",
                            bank: "乌克兰国家银行/National Bank of Ukraine",
                            condition: "ACG68E",
                            price: "132元",
                            purchaseDate: "2026年3月1日",
                            krause: "134",
                            size: "165mm*80mm",
                            remark: "草台班子爱藏，这张标签上漏了“Commemorative”标识。冠号“ЄС”的转写，PMG为“YES”，爱藏为“ES”。",
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/ukarine/0244876-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/ukarine/0244876-2.jpg",
                            issueDate: "2024年2月23日",
                            issueQuantity: "30万",
                            watermark: "交握双手/Joined Hands"
                        }
                    ]
                }
            ]
        }
    ]
};