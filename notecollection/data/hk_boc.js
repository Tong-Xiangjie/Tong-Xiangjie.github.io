// data/hk_boc.js
const hk_bocData = {
    name: "香港中国银行",
    icon: null,
    desc: "Bank of China (Hong Kong Limited)",
    // 港币板块的详情页字段配置
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "signature", label: "签名" },
        { key: "faceDate", label: "票面日期" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],
    series: [
        // ==================== 1994～2001年版 ====================
        {
            seriesName: "1994～2001年版",
            year: "1994～2001",
            varieties: [
                {
                    varietyName: "港币20元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1994,
                            version: "AA775221",
                            bank: "中国银行",
                            condition: "ACG67E",
                            price: "",
                            purchaseDate: "",
                            krause: "329a",
                            signature: "香港分行总经理：周振兴",
                            faceDate: "1994年5月1日",
                            remark: "首发冠",
                            img1: "image/hk_boc/AA775221-1.jpg",
                            img2: "image/hk_boc/AA775221-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "港币50元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1996,
                            version: "AF724347",
                            bank: "中国银行",
                            condition: "ACG66E",
                            price: "88元",
                            purchaseDate: "2026年2月19日",
                            krause: "330b",
                            signature: "香港分行总经理：羊子林",
                            faceDate: "1996年1月1日",
                            remark: "",
                            img1: "image/hk_boc/AF724347-1.jpg",
                            img2: "image/hk_boc/AF724347-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 1999,
                            version: "AZ261561",
                            bank: "中国银行",
                            condition: "ACG67E",
                            price: "88元",
                            purchaseDate: "2026年2月19日",
                            krause: "330e",
                            signature: "香港分行总经理：刘金宝",
                            faceDate: "1999年1月1日",
                            remark: "",
                            img1: "image/hk_boc/AZ261561-1.jpg",
                            img2: "image/hk_boc/AZ261561-2.jpg"
                        },
                        {
                            copyId: 3,
                            year: 2000,
                            version: "AT691569",
                            bank: "中国银行",
                            condition: "ACG66E",
                            price: "88元",
                            purchaseDate: "2026年2月19日",
                            krause: "330f",
                            signature: "香港分行总经理：刘金宝",
                            faceDate: "2000年1月1日",
                            remark: "",
                            img1: "image/hk_boc/AT691569-1.jpg",
                            img2: "image/hk_boc/AT691569-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "港币100元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2000,
                            version: "CA253979",
                            bank: "中国银行",
                            condition: "ACG67E",
                            price: "145元",
                            purchaseDate: "2026年2月19日",
                            krause: "331f",
                            signature: "香港分行总经理：刘金宝",
                            faceDate: "2000年1月1日",
                            remark: "",
                            img1: "image/hk_boc/CA253979-1.jpg",
                            img2: "image/hk_boc/CA253979-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 2003～2009年版 ====================
        {
            seriesName: "2003～2009年版",
            year: "2003～2009",
            varieties: [
                {
                    varietyName: "港币20元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2008,
                            version: "HB778596",
                            bank: "中国银行（香港）",
                            condition: "ACG68E",
                            price: "",
                            purchaseDate: "",
                            krause: "335e",
                            signature: "总裁：和广北",
                            faceDate: "2008年1月1日",
                            remark: "",
                            img1: "image/hk_boc/HB778596-1.jpg",
                            img2: "image/hk_boc/HB778596-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "港币50元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2009,
                            version: "DB198972",
                            bank: "中国银行（香港）",
                            condition: "ACG67E",
                            price: "",
                            purchaseDate: "",
                            krause: "336f",
                            signature: "总裁：和广北",
                            faceDate: "2009年1月1日",
                            remark: "",
                            img1: "image/hk_boc/DB198972-1.jpg",
                            img2: "image/hk_boc/DB198972-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 2010～2015年版 ====================
        {
            seriesName: "2010～2015年版",
            year: "2010～2015",
            varieties: [
                {
                    varietyName: "港币20元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2015,
                            version: "JF775298",
                            bank: "中国银行（香港）",
                            condition: "ACG68E",
                            price: "",
                            purchaseDate: "",
                            krause: "341e",
                            signature: "总裁：岳毅",
                            faceDate: "2015年7月1日",
                            remark: "",
                            img1: "image/hk_boc/JF775298-1.jpg",
                            img2: "image/hk_boc/JF775298-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 2018～至今版 ====================
        {
            seriesName: "2018～至今版",
            year: "2018～至今",
            // 新增 readme：显示在品种列表页（与各个面额并列，在上方）
            readme: {
                title: "中国银行（香港）2018年新版港币宣传片",
                content: "video:https://streamtape.com/v/84Xlq4AaK0UowZK/hk_boc_1.mp4"
            },
            varieties: [
                {
                    varietyName: "港币20元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2018,
                            version: "AW102222",
                            bank: "中国银行（香港）",
                            condition: "ACG66E",
                            price: "",
                            purchaseDate: "",
                            krause: "348a",
                            signature: "总裁：高迎欣",
                            faceDate: "2018年1月1日",
                            remark: "",
                            img1: "image/hk_boc/AW102222-1.jpg",
                            img2: "image/hk_boc/AW102222-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 2021,
                            version: "FQ880098",
                            bank: "中国银行（香港）",
                            condition: "ACG67E",
                            price: "49元",
                            purchaseDate: "2026年4月18日",
                            krause: "348b",
                            signature: "总裁：孙煜",
                            faceDate: "2021年1月1日",
                            remark: "",
                            img1: "image/hk_boc/FQ880098-1.jpg",
                            img2: "image/hk_boc/FQ880098-2.jpg"
                        },
                        {
                            copyId: 3,
                            year: 2023,
                            version: "JA601300",
                            bank: "中国银行（香港）",
                            condition: "ACG66E",
                            price: "",
                            purchaseDate: "",
                            krause: "348c",
                            signature: "总裁：孙煜",
                            faceDate: "2023年1月1日",
                            remark: "",
                            img1: "image/hk_boc/JA601300-1.jpg",
                            img2: "image/hk_boc/JA601300-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "港币50元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2023,
                            version: "BR046520",
                            bank: "中国银行（香港）",
                            condition: "ACG68E",
                            price: "",
                            purchaseDate: "",
                            krause: "349",
                            signature: "总裁：孙煜",
                            faceDate: "2023年1月1日",
                            remark: "",
                            img1: "image/hk_boc/BR046520-1.jpg",
                            img2: "image/hk_boc/BR046520-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "港币100元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2018,
                            version: "AA739695",
                            bank: "中国银行（香港）",
                            condition: "ACG67E",
                            price: "",
                            purchaseDate: "",
                            krause: "350a",
                            signature: "总裁：高迎欣",
                            faceDate: "2018年1月1日",
                            remark: "",
                            img1: "image/hk_boc/AA739695-1.jpg",
                            img2: "image/hk_boc/AA739695-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 2023,
                            version: "EX015191",
                            bank: "中国银行（香港）",
                            condition: "ACG68E★",
                            price: "",
                            purchaseDate: "",
                            krause: "350",
                            signature: "总裁：孙煜",
                            faceDate: "2023年1月1日",
                            remark: "",
                            img1: "image/hk_boc/EX015191-1.jpg",
                            img2: "image/hk_boc/EX015191-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
