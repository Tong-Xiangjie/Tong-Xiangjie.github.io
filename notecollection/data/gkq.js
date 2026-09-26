const gkqData = {
    name: "国库券",
    icon: null,
    desc: "Treasury Bond",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "year", label: "发行年份" },
        { key: "wmk", label: "水印" },
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],
    readmes: [
        { title: "浅谈国库券 | 一、概述和市场情况", content: "file:readmes/gkq_1.txt" },
        { title: "浅谈国库券 | 二、早期的分析（1981-1984）", content: "file:readmes/gkq_2.txt" },
        { title: "浅谈国库券 | 三、中期的分析（1985-1989）", content: "file:readmes/gkq_3.txt" },
        { title: "浅谈国库券 | 四、后期（1990-1991）", content: "file:readmes/gkq_4.txt" },
        { title: "浅谈国库券 | 五、大面值国库券（1992-1994）", content: "file:readmes/gkq_5.txt" },
        { title: "浅谈国库券 | 六、最后的国库券（1995-1997）", content: "file:readmes/gkq_6.txt" }
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
                            copyId: 19859839,
                            year: 1982,
                            version: "ⅣⅩ148437",
                            condition: "ACG 65E",
                            price: "52元",
                            purchaseDate: "2026年3月29日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅣⅩ148437-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅣⅩ148437-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "5元 挖煤机",
                    copies: [
                        {
                            copyId: 26992538,
                            year: 1982,
                            version: "ⅩⅦ813772",
                            condition: "ACG 63E",
                            price: "169元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅦ813772-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅦ813772-2.jpg"
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
                            copyId: 27104068,
                            year: 1983,
                            version: "ⅩⅦ9103374",
                            condition: "ACG 60E",
                            price: "67元",
                            purchaseDate: "2026年7月11日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅦ9103374-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅦ9103374-2.jpg"
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
                            copyId: 26992536,
                            year: 1989,
                            version: "ⅢⅡ09191201",
                            condition: "ACG 62E",
                            price: "73元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅢⅡ09191201-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅢⅡ09191201-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "10元 海南橡胶林",
                    copies: [
                        {
                            copyId: 25315373,
                            year: 1989,
                            version: "ⅡⅤ7501722",
                            condition: "ACG 62E",
                            price: "70元",
                            purchaseDate: "2026年7月16日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅡⅤ7501722-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅡⅤ7501722-2.jpg"
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
                            copyId: 17258767,
                            year: 1991,
                            version: "ⅩⅡ83410889",
                            condition: "ACG 65E",
                            price: "55元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅡ83410889-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅡ83410889-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "10元 云南石林",
                    copies: [
                        {
                            copyId: 27104069,
                            year: 1991,
                            version: "ⅩⅠ64357754",
                            condition: "ACG 65E",
                            price: "67元",
                            purchaseDate: "2026年7月11日",
                            krause: "Unlisted",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅠ64357754-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅠ64357754-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "20元 黄果树瀑布",
                    copies: []
                },
                {
                    varietyName: "50元 云南风光",
                    copies: [
                        {
                            copyId: 26992537,
                            year: 1991,
                            version: "ⅩⅠ40955834",
                            condition: "ACG 60E",
                            price: "242元",
                            purchaseDate: "2026年5月2日",
                            krause: "Unlisted",
                            wmk: "满版古币水印/Pu Coin(Pants&Coins)",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅠ40955834-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅠ40955834-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "100元 桂林山水",
                    copies: [
                        {
                            copyId: 27104070,
                            year: 1991,
                            version: "ⅩⅠ38182121",
                            condition: "ACG 66E",
                            price: "406元",
                            purchaseDate: "2026年7月16日",
                            krause: "Unlisted",
                            wmk: "满版古币水印/Pu Coin(Pants&Coins)",
                            remark: "这个分数我非常满意。还记得当时买的时候问老板“有没有折”结果老板已读不回，（当时其实我根据老板拍的图片已经初步判断是没有问题的了），但是这张价格确实还可以，于是即便老板已读不回我也是直接拍下了。没想到拍下后老板就发来各种详细的实拍图（印证了之前我的初步判断），并且从老板的个人信息以及发过来的语音判断老板应该是一个老头子。后来收到快递，居然是挂号信，并且似乎依稀记得这张甚至没有用硬夹子包着……这种情况下还能评上这个分也是奇迹了，况且在老板那里就被老板摸来摸去很多次。不过这张到手后确实发现品质优于其他。",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅠ38182121-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅠ38182121-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 1993年 ====================
        {
            seriesName: "1993年",
            year: "1993",
            readme: {
                title: "跟着纸币游中国 | 深圳火车站",
                content: "file:readmes/20260807_shenzhenzhan.txt"
            },
            varieties: [
                {
                    varietyName: "100元 三年期 深圳火车站",
                    copies: [
                        {
                            copyId: 27104071,
                            year: 1993,
                            version: "ⅩⅠ30102812",
                            condition: "ACG 55",
                            price: "223元",
                            purchaseDate: "2026年7月20日",
                            krause: "Unlisted",
                            wmk: "GKQ五星水印/Stars & Letters",
                            remark: "这个分数早有预料。从今往后再也不对保粹纸币抱有任何幻想。",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅠ30102812-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/gkq/ⅩⅠ30102812-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};