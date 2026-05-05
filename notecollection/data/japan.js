// data/japan.js
const japanData = {
    name: "日本",
    icon: null,
    desc: "Japan",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },  
        { key: "print", label: "印刷机构" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },  
        { key: "withdrawnDate", label: "退出流通日期" },
        { key: "size", label: "标准尺寸" },
        { key: "wmk", label: "水印" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],

    series: [
        // ==================== A序列 ====================
        {
            seriesName: "A序列",
            year: "1946",
            varieties: [
                {
                    varietyName: "1946年 10銭 政府纸币",
                    copies: []
                },
                {
                    varietyName: "1946年 5円 政府纸币",
                    copies: []
                },
                {
                    varietyName: "1946年 10円 政府纸币",
                    copies: []
                },
                {
                    varietyName: "1946年 100円 圣德太子",
                    copies: []
                },
                {
                    varietyName: "1946年 1円 二宫尊德",
                    copies: []
                },
                {
                    varietyName: "1946年 5円 一円兑换券",
                    copies: []
                },
                {
                    varietyName: "1946年 20円 政府纸币",
                    copies: []
                },
                {
                    varietyName: "1946年 100円 圣德太子",
                    copies: []
                }
            ]
        },
        // ==================== B序列 ====================
        {
            seriesName: "B序列",
            year: "1950~1953",
            varieties: [
                {
                    varietyName: "1951年 50円 高桥是清",
                    copies: []
                },
                {
                    varietyName: "1953年 100円 板垣退助",
                    copies: [
                        {
                            copyId: 1,
                            year: 1953,
                            version: "XP807592G",
                            bank: "日本银行/Bank of Japan",
                            condition: "ACG68E",
                            price: "36元",
                            purchaseDate: "2026年3月1日",
                            krause: "90b",
                            print: "大藏省印刷局",
                            issueDate: "1953年12月1日",
                            withdrawnDate: "1974年8月1日",
                            size: "148mm*76mm",
                            wmk: "桐花图案&100/Turkey Oak Pattern&100",
                            remark: "B号券，双字母冠字前缀。正面：板垣退助，背面：日本国会议事堂。",
                            img1: "image/japan/XP807592G-1.jpg",
                            img2: "image/japan/XP807592G-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "1951年 500円 岩仓具视",
                    copies: []
                },
                {
                    varietyName: "1950年 1000円 圣德太子",
                    copies: []
                }
            ]
        },
        // ==================== C序列 ====================
        {
            seriesName: "C序列",
            year: "1957~1963",
            varieties: [
                {
                    varietyName: "1957年 500円 岩仓具视",
                    copies: []
                },
                {
                    varietyName: "1963年 1000円 伊藤博文",
                    copies: []
                },
                {
                    varietyName: "1957年 5000円 圣德太子",
                    copies: []
                },
                {
                    varietyName: "1958年 10000円 圣德太子",
                    copies: []
                }
            ]
        },
        // ==================== D序列 ====================
        {
            seriesName: "D序列",
            year: "1984",
            varieties: [
                {
                    varietyName: "1984年 1000円 夏目漱石",
                    copies: []
                },
                {
                    varietyName: "1984年 5000円 新渡户稻造",
                    copies: []
                },
                {
                    varietyName: "1984年 10000円 福泽谕吉",
                    copies: []
                }
            ]
        },
        // ==================== E序列 ====================
        {
            seriesName: "E序列",
            year: "2004",
            varieties: [
                {
                    varietyName: "2004年 1000円 野口英世",
                    copies: []
                },
                {
                    varietyName: "2004年 5000円 樋口一叶",
                    copies: []
                },
                {
                    varietyName: "2004年 10000円 福泽谕吉",
                    copies: []
                }
            ]
        },
        // ==================== F序列 ====================
        {
            seriesName: "F序列",
            year: "2024",
            varieties: [
                {
                    varietyName: "2024年 1000円 北里柴三郎",
                    copies: [
                        {
                            copyId: 1,
                            year: 2024,
                            version: "AA229466RM",
                            bank: "日本银行/Bank of Japan",
                            condition: "ACG67E",
                            price: "83元",
                            purchaseDate: "2026年1月11日",
                            krause: "107a",
                            print: "国立印刷局",
                            issueDate: "2024年7月3日",
                            withdrawnDate: "正在流通",
                            size: "150mm*76mm",
                            wmk: "北里柴三郎肖像/S.Kitasato",
                            remark: "F号券，新版纸币。正面：北里柴三郎（细菌学家），背面：神奈川冲浪里（葛饰北斋画作）。",
                            img1: "image/japan/AA229466RM-1.jpg",
                            img2: "image/japan/AA229466RM-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "2024年 5000円 津田梅子",
                    copies: []
                },
                {
                    varietyName: "2024年 10000円 涩泽荣一",
                    copies: []
                }
            ]
        },{
            seriesName: "纪念钞",
            year: "2000",
            varieties: [
                {
                    varietyName: "D序列 2000年 2000円 守礼门",
                    copies: [
                        {
                            copyId: 1,
                            year: 2000,
                            version: "SA586830V",
                            bank: "日本银行/Bank of Japan",
                            condition: "ACG68E",
                            price: "172元",
                            purchaseDate: "2026年2月19日",
                            krause: "103b",
                            print: "大藏省印刷局",
                            issueDate: "2000年7月19日",
                            withdrawnDate: "正在流通",
                            size: "154mm*76mm",
                            wmk: "守礼门/Shureimon Gate",
                            remark: "D号券，为纪念第26届八国集团首脑会议和千禧年发行。正面：守礼门，背面：源氏物语绘卷与紫式部。2003年后未再印制。",
                            img1: "image/japan/SA586830V-1.jpg",
                            img2: "image/japan/SA586830V-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
