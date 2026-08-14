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
        // ==================== 政府纸币 ====================
        {
            seriesName: "政府纸币",
            year: "1946",
            varieties: [
                {
                    varietyName: "昭和20年（1945年） 50銭（Sen） 靖国神社",
                    copies: [
                        {
                            copyId: 1,
                            year: 1947,
                            version: "{51}",
                            bank: "日本帝国政府/The Japanese Imperial Government",
                            condition: "ACG66E",
                            price: "58元",
                            purchaseDate: "2026年8月14日",
                            krause: "60a",
                            print: "",
                            issueDate: "",
                            withdrawnDate: "",
                            size: "",
                            wmk: "无水印/Without Wmk",
                            remark: "",
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/1945-50-51-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/1945-50-51-2.jpg"
                        }
                    ]
                }
            ]
        },// ==================== A序列 ====================
        {
            seriesName: "A序列",
            year: "1946",
            varieties: [
                {
                    varietyName: "昭和21年（1946年） 5銭（Sen） 梅花",
                    copies: []
                },
                {
                    varietyName: "昭和22年（1947年） 10銭（Sen） 和平鸽",
                    copies: [
                        {
                            copyId: 1,
                            year: 1947,
                            version: "18113",
                            bank: "日本银行/Bank of Japan",
                            condition: "ACG64E",
                            price: "34元",
                            purchaseDate: "2026年6月6日",
                            krause: "84",
                            print: "印刷局",
                            issueDate: "",
                            withdrawnDate: "",
                            size: "",
                            wmk: "",
                            remark: "",
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/18113-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/18113-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "昭和21年（1946年） 50銭（Sen） 板垣退助",
                    copies: []
                },
                {
                    varietyName: "昭和21年（1946年） 1円（Yen） 二宫尊德",
                    copies: [
                        {
                            copyId: 1,
                            year: 1946,
                            version: "1114922",
                            bank: "日本银行/Bank of Japan",
                            condition: "ACG64E",
                            price: "30元",
                            purchaseDate: "2026年6月6日",
                            krause: "85a.3",
                            print: "",
                            issueDate: "",
                            withdrawnDate: "",
                            size: "",
                            wmk: "",
                            remark: "",
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/1114922-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/1114922-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "昭和21年（1946年） 5円（Yen）",
                    copies: []
                },
                {
                    varietyName: "昭和21年（1946年） 10円（Yen） 国会议事堂",
                    copies: []
                },
                {
                    varietyName: "昭和21年（1946年） 100円（Yen） 圣德太子",
                    copies: []
                }
            ]
        },
        // ==================== B序列 ====================
        {
            seriesName: "B序列",
            year: "1950～1953",
            varieties: [
                {
                    varietyName: "昭和26年（1951年） 50円（Yen） 高桥是清",
                    copies: []
                },
                {
                    varietyName: "昭和28年（1953年） 100円（Yen） 板垣退助",
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
                            remark: "浅棕色纸张（Light Brown Paper）版本",
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/XP807592G-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/XP807592G-2.jpg"
                        },{
                            copyId: 1,
                            year: 1953,
                            version: "ZP514663G",
                            bank: "日本银行/Bank of Japan",
                            condition: "ACG67E",
                            price: "39元",
                            purchaseDate: "2026年7月12日",
                            krause: "90c",
                            print: "大藏省印刷局",
                            issueDate: "1953年12月1日",
                            withdrawnDate: "1974年8月1日",
                            size: "148mm*76mm",
                            wmk: "桐花图案&100/Turkey Oak Pattern&100",
                            remark: "白色纸张（White Paper）版本",
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/ZP514663G-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/ZP514663G-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "昭和26年（1951年） 500円（Yen） 岩仓具视",
                    copies: []
                },
                {
                    varietyName: "昭和25年（1950年） 1000円（Yen） 圣德太子",
                    copies: []
                }
            ]
        },
        // ==================== C序列 ====================
        {
            seriesName: "C序列",
            year: "1957～1963",
            varieties: [
                {
                    varietyName: "昭和32年（1957年） 500円（Yen） 岩仓具视",
                    copies: []
                },
                {
                    varietyName: "昭和38年（1963年） 1000円（Yen） 伊藤博文",
                    copies: []
                },
                {
                    varietyName: "昭和32年（1957年） 5000円（Yen） 圣德太子",
                    copies: []
                },
                {
                    varietyName: "昭和33年（1958年） 10000円（Yen） 圣德太子",
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
                    varietyName: "昭和59年（1984年） 1000円（Yen） 夏目漱石",
                    copies: []
                },
                {
                    varietyName: "昭和59年（1984年） 5000円（Yen） 新渡户稻造",
                    copies: []
                },
                {
                    varietyName: "昭和59年（1984年） 10000円（Yen） 福泽谕吉",
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
                    varietyName: "平成16年（2004年） 1000円（Yen） 野口英世",
                    copies: []
                },
                {
                    varietyName: "平成16年（2004年） 5000円（Yen） 樋口一叶",
                    copies: []
                },
                {
                    varietyName: "平成16年（2004年） 10000円（Yen） 福泽谕吉",
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
                    varietyName: "令和6年（2024年） 1000円（Yen） 北里柴三郎",
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
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/AA229466RM-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/AA229466RM-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "令和6年（2024年） 5000円（Yen） 津田梅子",
                    copies: []
                },
                {
                    varietyName: "令和6年（2024年） 10000円（Yen） 涩泽荣一",
                    copies: []
                }
            ]
        },{
            seriesName: "纪念钞",
            year: "2000",
            varieties: [
                {
                    varietyName: "平成12年（2000年） 2000円（Yen） 守礼门",
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
                            img1: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/SA586830V-1.jpg",
                            img2: "https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/notecollection/image/japan/SA586830V-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
