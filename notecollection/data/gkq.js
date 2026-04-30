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
                }
                // 可继续添加：5元、10元等面值
            ]
        }
        // 可继续添加：1983年、1984年等年份
    ]
};
