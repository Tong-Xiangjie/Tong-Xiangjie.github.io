// data/vietnam.js
const vietnamData = {
    name: "越南",
    icon: null,
    desc: "Viet Nam",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "watermark", label: "水印" },
        { key: "size", label: "标准尺寸" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],
    series: [
        {
            seriesName: "2016年 100越南盾 越南国家银行成立65周年纪念钞",
            year: "2016",
            copies: [
                {
                    copyId: 1,
                    year: 2016,
                    version: "NH00115545",
                    bank: "越南国家银行/State Bank of Vietnam",
                    condition: "ACG67E",
                    price: "19元",
                    purchaseDate: "2026年5月12日",
                    krause: "125",
                    size: "163 × 83 mm",
                    watermark: "花卉和数字“65”/Flower & 65",
                    remark: "捡漏哈哈哈！",
                    img1: "image/vietnam/NH00115545-1.jpg",
                    img2: "image/vietnam/NH00115545-2.jpg"
                }
            ]
        }
    ]
};
