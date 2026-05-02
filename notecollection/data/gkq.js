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
        // ==================== 1982年 ====================
        {
            seriesName: "1982年",
            year: "1982",
            // 新增 readme：显示在品种列表页（与各个面额并列，在上方）
            readme: {
                title: "中华人民共和国一九八二年国库券条例",
                content: "file:readmes/gkq_1982_ordinance.txt"
            },
            varieties: [
                {
                    varietyName: "1元",
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
                            remark: "",
                            img1: "image/gkq/ⅣⅩ148437-1.jpg",
                            img2: "image/gkq/ⅣⅩ148437-2.jpg"
                        }
                    ]
                },{
                    varietyName: "5元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1982,
                            version: "ⅩⅦ813772",
                            condition: "----",
                            price: "裸票115元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/-1.jpg",
                            img2: "image/gkq/-2.jpg"
                        }
                    ]
                }
            ]
        },{
            seriesName: "1989年",
            year: "1989",
            varieties: [
                {
                    varietyName: "5元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1982,
                            version: "ⅢⅡ00000000",
                            condition: "----",
                            price: "裸票19元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/-1.jpg",
                            img2: "image/gkq/-2.jpg"
                        }
                    ]
                }
            ]
        },{
            seriesName: "1991年",
            year: "1991",
            varieties: [
                {
                    varietyName: "5元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1991,
                            version: "ⅩⅡ83410889",
                            condition: "ACG65E",
                            price: "55元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/ⅩⅡ83410889-1.jpg",
                            img2: "image/gkq/ⅩⅡ83410889-2.jpg"
                        }
                    ]
                },{
                    varietyName: "10元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1991,
                            version: "ⅩⅠ61258426",
                            condition: "----",
                            price: "裸票50元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/-1.jpg",
                            img2: "image/gkq/-2.jpg"
                        }
                    ]
                },{
                    varietyName: "50元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1991,
                            version: "ⅩⅠ40955834",
                            condition: "----",
                            price: "裸票188元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/-1.jpg",
                            img2: "image/gkq/-2.jpg"
                        }
                    ]
                }
            ]
        }
        // 可继续添加：1983年、1984年等年份
    ]
};
