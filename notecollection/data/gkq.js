// data/gkq.js
const gkqData = {
    name: "国库券",
    icon: null,
    desc: "Treasury Bond",
    // 国库券板块的详情页字段配置
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "year", label: "发行年份" },
        { key: "wmk", label: "水印" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],
    series: [
        {
            seriesName: "1982年版 1元",
            year: "1982",
            copies: [
                {
                    copyId: 1,
                    year: 1982,
                    version: "ⅣⅩ148437",
                    condition: "ACG65E",
                    price: "52元",
                    purchaseDate: "2026年3月29日",
                    krause: "Unlisted",
                    wmk: "无水印/Without Watermark",
                    remark: "file:remarks/gkq_1982_1yuan.txt",
                    img1: "image/gkq/ⅣⅩ148437-1.jpg",
                    img2: "image/gkq/ⅣⅩ148437-2.jpg"
                }
            ]
        }
    ]
};
