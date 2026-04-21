// data/venezuela.js
const venezuelaData = {
    name: "委内瑞拉",
    icon: null,
    desc: "Venezuela",
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
            seriesName: "2018年版 50玻利瓦尔",
            year: "2018",
            copies: [
                {
                    copyId: 1,
                    year: 2018,
                    version: "D16911198",
                    bank: "委内瑞拉中央银行/Central Bank of Venezuela",
                    condition: "ACG67E",
                    price: "25元",
                    purchaseDate: "2026年4月1日",
                    krause: "105",
                    size: "",
                    watermark: "",
                    remark: "",
                    img1: "image/venezuela/D16911198-1.jpg",
                    img2: "image/venezuela/D16911198-2.jpg"
                }
            ]
        },
        {
            seriesName: "2017年版 10000玻利瓦尔",
            year: "2017",
            copies: [
                {
                    copyId: 1,
                    year: 2017,
                    version: "B91918681",
                    bank: "委内瑞拉中央银行/Central Bank of Venezuela",
                    condition: "ACG67E",
                    price: "22元",
                    purchaseDate: "2026年4月18日",
                    krause: "98b",
                    size: "",
                    watermark: "",
                    remark: "",
                    img1: "image/venezuela/B91918681-1.jpg",
                    img2: "image/venezuela/B91918681-2.jpg"
                }
            ]
        }
    ]
};