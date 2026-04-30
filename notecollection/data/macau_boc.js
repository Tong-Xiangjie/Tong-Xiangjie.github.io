// data/macau_boc.js
const macau_bocData = {
    name: "澳门中国银行",
    icon: null,
    desc: "Banco da China",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "signature", label: "签名" },
        { key: "faceDate", label: "票面日期" },
        { key: "size", label: "标准尺寸" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],

    series: [
        // ==================== 1995～2003年版 ====================
        {
            seriesName: "1995～2003年版",
            year: "1995～2003",
            varieties: [
                {
                    varietyName: "澳门币10元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1995,
                            version: "AK09086",
                            bank: "中国银行",
                            condition: "ACG66E",
                            price: "",
                            purchaseDate: "",
                            krause: "90",
                            signature: "澳门分行总经理：王振钧",
                            faceDate: "1995年10月16日",
                            size: "138mm*69mm",
                            remark: "正面：东望洋灯塔；背面：澳门中银大厦、莲花图案",
                            img1: "image/macau_boc/AK09086-1.jpg",
                            img2: "image/macau_boc/AK09086-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "澳门币100元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2003,
                            version: "HB11154",
                            bank: "中国银行",
                            condition: "ACG68E",
                            price: "",
                            purchaseDate: "",
                            krause: "104",
                            signature: "澳门分行总经理：张鸿义",
                            faceDate: "2003年12月8日",
                            size: "153mm*76.5mm",
                            remark: "正面：外港客运码头；背面：澳门中银大厦、莲花图案",
                            img1: "image/macau_boc/HB11154-1.jpg",
                            img2: "image/macau_boc/HB11154-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 2008～2017年版 ====================
        {
            seriesName: "2008～2017年版",
            year: "2008～2017",
            varieties: [
                {
                    varietyName: "澳门币10元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2013,
                            version: "BA118169",
                            bank: "中国银行",
                            condition: "ACG67E",
                            price: "",
                            purchaseDate: "",
                            krause: "108b.1",
                            signature: "澳门分行行长：叶一新",
                            faceDate: "2013年7月1日",
                            size: "138mm*69mm",
                            remark: "正面：妈阁庙；背面：澳门中银大厦、莲花图案",
                            img1: "image/macau_boc/BA118169-1.jpg",
                            img2: "image/macau_boc/BA118169-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "澳门币20元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2008,
                            version: "AR921648",
                            bank: "中国银行",
                            condition: "ACG68E",
                            price: "元",
                            purchaseDate: "2026年月日",
                            krause: "109a",
                            signature: "澳门分行总经理：叶一新",
                            faceDate: "2008年8月8日",
                            size: "140mm*69mm",
                            remark: "正面：大三巴牌坊；背面：澳门中银大厦、莲花图案",
                            img1: "image/macau_boc/AR921648-1.jpg",
                            img2: "image/macau_boc/AR921648-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 2013,
                            version: "AJ008699",
                            bank: "中国银行",
                            condition: "ACG67E",
                            price: "48元",
                            purchaseDate: "2026年4月16日",
                            krause: "109b.1",
                            signature: "澳门分行行长：叶一新",
                            faceDate: "2013年7月1日",
                            size: "140mm*69mm",
                            remark: "正面：大三巴牌坊；背面：澳门中银大厦、莲花图案",
                            img1: "image/macau_boc/AJ008699-1.jpg",
                            img2: "image/macau_boc/AJ008699-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 2020年版 ====================
        {
            seriesName: "2020年版",
            year: "2020",
            // 新增 readme
            readme: {
                title: "中国银行新款澳门元宣传片",
                content: "file:readmes/macau_boc_2020_promo.txt"
            },
            varieties: [
                {
                    varietyName: "澳门元20元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2020,
                            version: "AN090100",
                            bank: "中国银行",
                            condition: "ACG66E",
                            price: "",
                            purchaseDate: "",
                            krause: "130",
                            signature: "澳门分行行长：李光",
                            faceDate: "2020年5月18日",
                            size: "143mm*71.5mm",
                            remark: "正面：大三巴牌坊；背面：澳门中银大厦、莲花图案",
                            img1: "image/macau_boc/AN090100-1.jpg",
                            img2: "image/macau_boc/AN090100-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "澳门元50元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2020,
                            version: "AB235738",
                            bank: "中国银行",
                            condition: "ACG68E",
                            price: "",
                            purchaseDate: "",
                            krause: "131",
                            signature: "澳门分行行长：贾元兵",
                            faceDate: "2020年5月18日",
                            size: "148mm*74mm",
                            remark: "正面：岗顶剧院；背面：澳门中银大厦、莲花图案",
                            img1: "image/macau_boc/AB235738-1.jpg",
                            img2: "image/macau_boc/AB235738-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
