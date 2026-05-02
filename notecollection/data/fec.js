// data/fec.js
const fecData = {
    name: "外汇兑换券",
    icon: null,
    desc: "Foreign Exchange Certificate",
    // 详情页字段配置
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "wmk", label: "水印" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],
    series: [
        {
            seriesName: "1角",
            year: "1979",
            varieties: [
                {
                    varietyName: "五星火炬水印",
                    copies: [
                        {
                            copyId: 1,
                            year: 1979,
                            purchaseDate: "2026年5月2日",
                            price: "280元",
                            bank: "中国银行",
                            version: "ZA000000 17064",
                            condition: "ACG65E",
                            krause: "FX1s",
                            wmk: "五星火炬/Star&Torch",
                            remark: "在孔网上面捡漏！",
                            img1: "image/fec/17064-1.jpg",
                            img2: "image/fec/17064-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "五星水印",
                    copies: [
                        {
                            copyId: 1,
                            year: 1979,
                            purchaseDate: "2025年10月20日",
                            price: "76元",
                            bank: "中国银行",
                            version: "AI172872",
                            condition: "ACG67E",
                            krause: "FX1a",
                            wmk: "五星/Stars",
                            remark: "无荧光",
                            img1: "image/fec/AI172872-1.jpg",
                            img2: "image/fec/AI172872-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 1979,
                            purchaseDate: "2025年12月31日",
                            price: "66元",
                            bank: "中国银行",
                            version: "DL832836",
                            condition: "ACG66E",
                            krause: "FX1a",
                            wmk: "五星/Stars",
                            remark: "有荧光",
                            img1: "image/fec/DL832836-1.jpg",
                            img2: "image/fec/DL832836-2.jpg"
                        }
                    ]
                }
            ]
        },
        {
            seriesName: "1979年 5角",
            year: "1979",
            copies: [
                {
                    copyId: 1,
                    year: 1979,
                    purchaseDate: "2025年12月31日",
                    price: "67元",
                    bank: "中国银行",
                    version: "ZN611794",
                    condition: "ACG66E",
                    krause: "FX2",
                    wmk: "五星火炬/Star&Torch",
                    remark: "",
                    img1: "image/fec/ZN611794-1.jpg",
                    img2: "image/fec/ZN611794-2.jpg"
                }
            ]
        },
        {
            seriesName: "1979年 1元",
            year: "1979",
            copies: [
                {
                    copyId: 1,
                    year: 1979,
                    purchaseDate: "2025年12月31日",
                    price: "67元",
                    bank: "中国银行",
                    version: "DN598149",
                    condition: "ACG67E",
                    krause: "FX3",
                    wmk: "五星火炬/Star&Torch",
                    remark: "",
                    img1: "",
                    img2: ""
                }
            ]
        },
        {
            seriesName: "1979年 5元",
            year: "1979",
            copies: [
                {
                    copyId: 1,
                    year: 1979,
                    purchaseDate: "2025年12月31日",
                    price: "168元",
                    bank: "中国银行",
                    version: "ZZ756837",
                    condition: "ACG67E",
                    krause: "FX4",
                    wmk: "五星火炬/Star&Torch",
                    remark: "",
                    img1: "image/fec/ZZ756837-1.jpg",
                    img2: "image/fec/ZZ756837-2.jpg"
                }
            ]
        },
        {
            seriesName: "1979年 10元",
            year: "1979",
            copies: [
                {
                    copyId: 1,
                    year: 1979,
                    purchaseDate: "2025年11月16日",
                    price: "650元",
                    bank: "中国银行",
                    version: "ZA000000 19589",
                    condition: "PMG66E",
                    krause: "FX5s",
                    wmk: "五星火炬/Star&Torch",
                    remark: "",
                    img1: "image/fec/19589-1.jpg",
                    img2: "image/fec/19589-2.jpg"
                }
            ]
        },
        {
            seriesName: "1979年 50元",
            year: "1979",
            copies: [
                {
                    copyId: 1,
                    year: 1979,
                    purchaseDate: "2025年12月31日",
                    price: "850元",
                    bank: "中国银行",
                    version: "ZA000000 17376",
                    condition: "ACG67E",
                    krause: "FX6s",
                    wmk: "国徽/National Badge",
                    remark: "",
                    img1: "image/fec/17376-1.jpg",
                    img2: "image/fec/17376-2.jpg"
                }
            ]
        },
        {
            seriesName: "1979年 100元",
            year: "1979",
            copies: [
                {
                    copyId: 1,
                    year: 1979,
                    purchaseDate: "2025年12月31日",
                    price: "850元",
                    bank: "中国银行",
                    version: "ZA000000 11376",
                    condition: "ACG66E",
                    krause: "FX7s",
                    wmk: "国徽/National Badge",
                    remark: "",
                    img1: "image/fec/11376-1.jpg",
                    img2: "image/fec/11376-2.jpg"
                }
            ]
        }
    ]
};
