// data/gkq.js
const gkqData = {
    name: "国库券",
    icon: null,
    desc: "Treasury Bond",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "year", label: "发行年份" },
        { key: "wmk", label: "水印" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],
    readmes: [
        { title: "一、概述和市场情况", content: "file:readmes/gkq_1.txt" },
        { title: "二、早期的分析（1981-1984）", content: "file:readmes/gkq_2.txt" },
        { title: "三、中期的分析（1985-1989）", content: "file:readmes/gkq_3.txt" },
        { title: "四、后期（1990-1991）", content: "file:readmes/gkq_4.txt" },
        { title: "五、大面值国库券（1992-1994）", content: "file:readmes/gkq_5.txt" },
        { title: "六、最后的国库券（1995-1997）", content: "file:readmes/gkq_6.txt" }
    ],
    series: [
        // ==================== 1982年 ====================
        {
            seriesName: "1982年",
            year: "1982",
            readme: {
                title: "中华人民共和国一九八二年国库券条例",
                content: "file:readmes/gkq_1982_ordinance.txt"
            },
            varieties: [
                {
                    varietyName: "1元 挖煤机",
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
                },
                {
                    varietyName: "5元 挖煤机",
                    copies: [
                        {
                            copyId: 1,
                            year: 1982,
                            version: "ⅩⅦ813772",
                            condition: "ACG63E",
                            price: "169元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/ⅩⅦ813772-1.jpg",
                            img2: "image/gkq/ⅩⅦ813772-2.jpg"
                        }
                    ]
                }
            ]
        }, 
        // ==================== 1983年 ====================
        {
            seriesName: "1983年",
            year: "1983",
            varieties: [
                {
                    varietyName: "5元 炼油厂",
                    copies: [
                        {
                            copyId: 1,
                            year: 1983,
                            version: "ⅩⅦ9103374",
                            condition: "暂未评级",
                            price: "40元",
                            purchaseDate: "2026年7月11日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/ⅩⅦ9103374-1.jpg",
                            img2: "image/gkq/ⅩⅦ9103374-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 1989年 ====================
        {
            seriesName: "1989年",
            year: "1989",
            varieties: [
                {
                    varietyName: "5元 上海桑塔纳",
                    copies: [
                        {
                            copyId: 1,
                            year: 1989,
                            version: "ⅢⅡ09191201",
                            condition: "ACG62E",
                            price: "73元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/ⅢⅡ09191201-1.jpg",
                            img2: "image/gkq/ⅢⅡ09191201-2.jpg"
                        }
                    ]
                },{
                    varietyName: "10元 海南橡胶林",
                    copies: [
                        {
                            copyId: 1,
                            year: 1989,
                            version: "ⅡⅤ7501722",
                            condition: "ACG62E",
                            price: "70元",
                            purchaseDate: "2026年7月16日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/ⅡⅤ7501722-1.jpg",
                            img2: "image/gkq/ⅡⅤ7501722-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 1991年 ====================
        {
            seriesName: "1991年",
            year: "1991",
            varieties: [
                {
                    varietyName: "5元 江南水乡",
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
                    varietyName: "10元 云南石林",
                    copies: [
                        {
                            copyId: 1,
                            year: 1991,
                            version: "ⅩⅠ64357754",
                            condition: "暂未评级",
                            price: "40元",
                            purchaseDate: "2026年7月11日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "image/gkq/ⅩⅠ64357754-1.jpg",
                            img2: "image/gkq/ⅩⅠ64357754-2.jpg"
                        }
                    ]
                },{
                    varietyName: "20元 黄果树瀑布",
                    copies: [
                        
                    ]
                },{
                    varietyName: "50元 云南风光",
                    copies: [
                        {
                            copyId: 1,
                            year: 1991,
                            version: "ⅩⅠ40955834",
                            condition: "ACG60E",
                            price: "242元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "满版古币水印/Pu Coin(Pants&Coins)",
                            remark: "",
                            img1: "image/gkq/ⅩⅠ40955834-1.jpg",
                            img2: "image/gkq/ⅩⅠ40955834-2.jpg"
                        }
                    ]
                },{
                    varietyName: "100元 桂林山水",
                    copies: [
                        {
                            copyId: 1,
                            year: 1991,
                            version: "ⅩⅠ38182121",
                            condition: "暂未评级",
                            price: "379元",
                            purchaseDate: "2026年7月16日",
                            krause: "Unlisted",
                            wmk: "满版古币水印/Pu Coin(Pants&Coins)",
                            remark: "",
                            img1: "image/gkq/ⅩⅠ38182121-1.jpg",
                            img2: "image/gkq/ⅩⅠ38182121-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
