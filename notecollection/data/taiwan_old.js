// data/taiwan_old.js
const taiwanOldData = {
    name: "战后旧台币",
    icon: null,
    desc: "Post-war Old Taiwan Dollar",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行方" },
        { key: "year", label: "发行年份" },
        { key: "print", label: "印刷机构" },
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],

    series: [
        {
            seriesName: "第一批 中华民国三十五年（1946年） 1元",
            copies: [
                {
                    copyId: 27104086,
                    year: 1946,
                    version: "AU972508",
                    bank: "台湾银行",
                    condition: "ACG 66E",
                    price: "153元",
                    purchaseDate: "2026年7月18日",
                    krause: "1935",
                    remark: "",
                    img1: "https://tong-xiangjie.github.io/notecollection/image/taiwan/AU972508-1.jpg",
                    img2: "https://tong-xiangjie.github.io/notecollection/image/taiwan/AU972508-2.jpg",
                    // 完整八面图：正/背之外的六张（-3/-4 侧光、-5/-6 透光、-7/-8 荧光）
                    imgExtra: {
                        sideLight: ["https://tong-xiangjie.github.io/notecollection/image/taiwan/AU972508-3.jpg", "https://tong-xiangjie.github.io/notecollection/image/taiwan/AU972508-4.jpg"],
                        transmit:  ["https://tong-xiangjie.github.io/notecollection/image/taiwan/AU972508-5.jpg", "https://tong-xiangjie.github.io/notecollection/image/taiwan/AU972508-6.jpg"],
                        uv:        ["https://tong-xiangjie.github.io/notecollection/image/taiwan/AU972508-7.jpg", "https://tong-xiangjie.github.io/notecollection/image/taiwan/AU972508-8.jpg"]
                    },
                }
            ]
        },
        {
            seriesName: "第一批 中华民国三十五年（1946年） 10元",
            copies: [
                {
                    copyId: 27104087,
                    year: 1946,
                    version: "CA609471",
                    bank: "台湾银行",
                    condition: "ACG 66E",
                    price: "131元",
                    purchaseDate: "2026年7月11日",
                    krause: "1937",
                    remark: "",
                    img1: "https://tong-xiangjie.github.io/notecollection/image/taiwan/CA609471-1.jpg",
                    img2: "https://tong-xiangjie.github.io/notecollection/image/taiwan/CA609471-2.jpg",
                    // 完整八面图：正/背之外的六张（-3/-4 侧光、-5/-6 透光、-7/-8 荧光）
                    imgExtra: {
                        sideLight: ["https://tong-xiangjie.github.io/notecollection/image/taiwan/CA609471-3.jpg", "https://tong-xiangjie.github.io/notecollection/image/taiwan/CA609471-4.jpg"],
                        transmit:  ["https://tong-xiangjie.github.io/notecollection/image/taiwan/CA609471-5.jpg", "https://tong-xiangjie.github.io/notecollection/image/taiwan/CA609471-6.jpg"],
                        uv:        ["https://tong-xiangjie.github.io/notecollection/image/taiwan/CA609471-7.jpg", "https://tong-xiangjie.github.io/notecollection/image/taiwan/CA609471-8.jpg"]
                    },
                }
            ]
        }
    ]
};

