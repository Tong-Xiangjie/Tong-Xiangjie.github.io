const commemorativeData = {
    name: "纪念钞",
    icon: "𝟘𝟙",
    desc: "包含央行以及港澳台地区的所有纪念钞",
    // 详情页字段配置
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "issueQuantity", label: "发行量" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯编号" }
    ],
    series: [
        { 
            seriesName: "澳门格兰披治大奖赛35周年纪念钞", 
            copies: [{ 
                copyId: 1, 
                year: 1988,
                purchaseDate: "2026年2月19日", 
                price: "925元", 
                bank: "大西洋银行", 
                version: "KP04057", 
                condition: "ACG65E", 
                krause: "64",
                issueDate: "1988年11月",
                issueQuantity: "1.5万张",
                remark: "纪念钞的鼻祖，发行量最少的一张", 
                img1: "comm/KP04057-1.jpg", 
                img2: "comm/KP04057-2.jpg" 
            }] 
        },
        { 
            seriesName: "新台币发行50周年纪念钞", 
            copies: [
                { 
                    copyId: 1, 
                    year: 1999,
                    purchaseDate: "2025年10月2日", 
                    price: "56元", 
                    bank: "台湾银行", 
                    version: "A179021G", 
                    condition: "ACG67E", 
                    krause: "1990",
                    issueDate: "1999年6月",
                    issueQuantity: "3000万张",
                    remark: "", 
                    img1: "comm/A179021G-1.jpg", 
                    img2: "comm/A179021G-2.jpg" 
                },
                { 
                    copyId: 2, 
                    year: 1999,
                    purchaseDate: "2026年", 
                    price: "278元", 
                    bank: "中国人民银行", 
                    version: "J51665987", 
                    condition: "ACG67E", 
                    krause: "KL003",
                    issueDate: "1999年6月",
                    issueQuantity: "3000万张",
                    remark: "顺子号", 
                    img1: "comm/J51665987-1.jpg", 
                    img2: "comm/J51665987-2.jpg" 
                }
            ] 
        },
        { 
            seriesName: "庆祝中华人民共和国成立50周年纪念钞", 
            copies: [
                { 
                    copyId: 1, 
                    year: 1999,
                    purchaseDate: "2025年8月30日", 
                    price: "203元", 
                    bank: "中国人民银行", 
                    version: "J07529257", 
                    condition: "ACG65E", 
                    krause: "891",
                    issueDate: "1999年9月20日",
                    issueQuantity: "6000万张",
                    remark: "刚好是我的生日号", 
                    img1: "comm/J07529257-1.jpg", 
                    img2: "comm/J07529257-2.jpg" 
                },
                { 
                    copyId: 2, 
                    year: 1999,
                    purchaseDate: "2026年2月1日", 
                    price: "278元", 
                    bank: "中国人民银行", 
                    version: "J51665987", 
                    condition: "ACG67E", 
                    krause: "891",
                    issueDate: "1999年9月20日",
                    issueQuantity: "6000万张",
                    remark: "顺子号", 
                    img1: "comm/J51665987-1.jpg", 
                    img2: "comm/J51665987-2.jpg" 
                }
            ] 
        },
        { 
            seriesName: "迎接新世纪纪念钞", 
            copies: [
                { 
                    copyId: 1, 
                    year: 2000,
                    purchaseDate: "2025年9月25日", 
                    price: "1225元", 
                    bank: "中国人民银行", 
                    version: "J00344985", 
                    condition: "ACG65E", 
                    krause: "902",
                    issueDate: "2000年11月28日",
                    issueQuantity: "1000万张",
                    remark: "普通冠号", 
                    img1: "comm/J00344985-1.jpg", 
                    img2: "comm/J00344985-2.jpg" 
                },
                { 
                    copyId: 2, 
                    year: 2000,
                    purchaseDate: "2025年11月1日", 
                    price: "2050元", 
                    bank: "中国人民银行", 
                    version: "I00181114", 
                    condition: "PMG67E", 
                    krause: "902*",
                    issueDate: "2000年11月28日",
                    issueQuantity: "1000万张",
                    remark: "补号", 
                    img1: "comm/I00181114-1.jpg", 
                    img2: "comm/I00181114-2.jpg" 
                }
            ] 
        },
        { 
            seriesName: "第29届奥林匹克运动会纪念钞", 
            copies: [{ 
                copyId: 1, 
                year: 2008,
                purchaseDate: "2025年10月12日", 
                price: "2360元", 
                bank: "中国人民银行", 
                version: "J04266645", 
                condition: "PMG67E", 
                krause: "908",
                issueDate: "2008年7月8日",
                issueQuantity: "600万张",
                remark: "钞王！传家宝级别", 
                img1: "comm/J04266645-1.jpg", 
                img2: "comm/J04266645-2.jpg" 
            }] 
        },
        { 
            seriesName: "第29届奥林匹克运动会纪念钞（香港）", 
            copies: [{ 
                copyId: 1, 
                year: 2008,
                purchaseDate: "2025年10月7日", 
                price: "176元", 
                bank: "中国银行（香港）", 
                version: "762965", 
                condition: "ACG66E", 
                krause: "340b",
                issueDate: "2008年7月",
                issueQuantity: "400万张",
                remark: "", 
                img1: "comm/762965-1.jpg", 
                img2: "comm/762965-2.jpg" 
            }] 
        },
        { 
            seriesName: "第29届奥林匹克运动会纪念钞（澳门）", 
            copies: [{ 
                copyId: 1, 
                year: 2008,
                purchaseDate: "2025年10月7日", 
                price: "245元", 
                bank: "中国银行", 
                version: "MO239989", 
                condition: "ACG66E", 
                krause: "107a",
                issueDate: "2008年7月",
                issueQuantity: "400万张",
                remark: "", 
                img1: "comm/MO239989-1.jpg", 
                img2: "comm/MO239989-2.jpg" 
            }] 
        },
        { 
            seriesName: "渣打银行成立150周年纪念钞", 
            copies: [] 
        },
        { 
            seriesName: "中华民国成立100年纪念钞", 
            copies: [{ 
                copyId: 1, 
                year: 2011,
                purchaseDate: "2025年10月12日", 
                price: "61元", 
                bank: "中央银行", 
                version: "JP578968ZB", 
                condition: "ACG67E", 
                krause: "1998",
                issueDate: "2011年1月6日",
                issueQuantity: "4亿张",
                remark: "", 
                img1: "comm/JP578968ZB-1.jpg", 
                img2: "comm/JP578968ZB-2.jpg" 
            }] 
        },
        { 
            seriesName: "纪念中国银行成立100周年纪念钞（香港）", 
            copies: [{ 
                copyId: 1, 
                year: 2012,
                purchaseDate: "2026年1月30日", 
                price: "198元", 
                bank: "中国银行（香港）", 
                version: "357185", 
                condition: "ACG67E", 
                krause: "346",
                issueDate: "2012年2月",
                issueQuantity: "200万张",
                remark: "", 
                img1: "comm/357185-1.jpg", 
                img2: "comm/357185-2.jpg" 
            }] 
        },
        { 
            seriesName: "纪念中国银行成立100周年纪念钞（澳门）", 
            copies: [{ 
                copyId: 1, 
                year: 2012,
                purchaseDate: "2025年12月5日", 
                price: "458元", 
                bank: "中国银行", 
                version: "AA709609", 
                condition: "PMG66E", 
                krause: "114",
                issueDate: "2012年2月",
                issueQuantity: "200万张",
                remark: "传说中的最美荷花钞", 
                img1: "comm/AA709609-1.jpg", 
                img2: "comm/AA709609-2.jpg" 
            }] 
        },
        { 
            seriesName: "澳门生肖钞", 
            copies: [] 
        },
        { 
            seriesName: "中国航天纪念钞", 
            copies: [
                { 
                    copyId: 1, 
                    year: 2015,
                    purchaseDate: "2025年12月1日", 
                    price: "160元", 
                    bank: "中国人民银行", 
                    version: "J8301922333", 
                    condition: "ACG68E", 
                    krause: "910a",
                    issueDate: "2015年11月26日",
                    issueQuantity: "3亿张",
                    remark: "普通荧光", 
                    img1: "comm/J8301922333-1.jpg", 
                    img2: "comm/J8301922333-2.jpg" 
                },
                { 
                    copyId: 2, 
                    year: 2015,
                    purchaseDate: "2026年2月18日", 
                    price: "218元", 
                    bank: "中国人民银行", 
                    version: "J5252197777", 
                    condition: "ACG67E", 
                    krause: "910a",
                    issueDate: "2015年11月26日",
                    issueQuantity: "3亿张",
                    remark: "宇宙之眼", 
                    img1: "comm/J5252197777-1.jpg", 
                    img2: "comm/J5252197777-2.jpg" 
                },
                { 
                    copyId: 3, 
                    year: 2015,
                    purchaseDate: "2025年11月7日", 
                    price: "134元", 
                    bank: "中国人民银行", 
                    version: "J9069497791", 
                    condition: "PMG66E", 
                    krause: "910a",
                    issueDate: "2015年11月26日",
                    issueQuantity: "3亿张",
                    remark: "流浪地球", 
                    img1: "comm/J9069497791-1.jpg", 
                    img2: "comm/J9069497791-2.jpg" 
                }
            ] 
        },
        { 
            seriesName: "汇丰银行成立150周年纪念钞", 
            copies: [{ 
                copyId: 1, 
                year: 2015,
                purchaseDate: "2026年1月8日", 
                price: "285元", 
                bank: "香港上海汇丰银行", 
                version: "AB140236", 
                condition: "ACG67E", 
                krause: "217d",
                issueDate: "2015年3月",
                issueQuantity: "200万张",
                remark: "补号", 
                img1: "comm/AB140236-1.jpg", 
                img2: "comm/AB140236-2.jpg" 
            }] 
        },
        { 
            seriesName: "中国银行在港服务100周年纪念钞", 
            copies: [{ 
                copyId: 1, 
                year: 2017,
                purchaseDate: "2026年2月18日", 
                price: "192元", 
                bank: "中国银行（香港）", 
                version: "HY583251", 
                condition: "ACG67E", 
                krause: "347",
                issueDate: "2017年9月",
                issueQuantity: "500万张",
                remark: "HY = Hundred Years百年", 
                img1: "comm/HY583251-1.jpg", 
                img2: "comm/HY583251-2.jpg" 
            }] 
        },
        { 
            seriesName: "人民币发行70周年纪念钞", 
            copies: [
                { 
                    copyId: 1, 
                    year: 2018,
                    purchaseDate: "2025年12月1日", 
                    price: "798元", 
                    bank: "中国人民银行", 
                    version: "J000009987", 
                    condition: "PMG66E", 
                    krause: "911",
                    issueDate: "2018年11月23日",
                    issueQuantity: "1.2亿张",
                    remark: "最引以为傲的一张藏品之一了，大开门号+顺子号，号码清晰漂亮。这也开创了我配号的新思路：尾顺子", 
                    img1: "comm/J000009987-1.jpg", 
                    img2: "comm/J000009987-2.jpg" 
                },
                { 
                    copyId: 2, 
                    year: 2018,
                    purchaseDate: "2025年8月5日", 
                    price: "79元", 
                    bank: "中国人民银行", 
                    version: "J191756567", 
                    condition: "ACG68E", 
                    krause: "911",
                    issueDate: "2018年11月23日",
                    issueQuantity: "1.2亿张",
                    remark: "补号，虽然PMG没有特殊标注", 
                    img1: "comm/J191756567-1.jpg", 
                    img2: "comm/J191756567-2.jpg" 
                }
            ] 
        },
        { 
            seriesName: "澳门回归20周年纪念钞", 
            copies: [
                { 
                    copyId: 1, 
                    year: 2019,
                    purchaseDate: "2025年12月5日", 
                    price: "34元", 
                    bank: "中国银行", 
                    version: "MA3518209", 
                    condition: "ACG66E", 
                    krause: "123",
                    issueDate: "2019年7月",
                    issueQuantity: "500万对",
                    remark: "", 
                    img1: "comm/MA3518209-1.jpg", 
                    img2: "comm/MA3518209-2.jpg" 
                },
                { 
                    copyId: 2, 
                    year: 2019,
                    purchaseDate: "2025年12月5日", 
                    price: "34元", 
                    bank: "大西洋银行", 
                    version: "MA0500209", 
                    condition: "ACG66E", 
                    krause: "89",
                    issueDate: "2019年7月",
                    issueQuantity: "500万对",
                    remark: "算不算是半个生日号？总感觉这张与我挺有缘的", 
                    img1: "comm/MA0500209-1.jpg", 
                    img2: "comm/MA0500209-2.jpg" 
                }
            ] 
        },
        { 
            seriesName: "第24届冬季奥林匹克运动会纪念钞（冰上运动）", 
            copies: [{ 
                copyId: 1, 
                year: 2022,
                purchaseDate: "2025年11月7日", 
                price: "40元", 
                bank: "中国人民银行", 
                version: "J180000183", 
                condition: "ACG68E", 
                krause: "916a",
                issueDate: "2021年12月21日",
                issueQuantity: "2亿张",
                remark: "", 
                img1: "comm/J180000183-1.jpg", 
                img2: "comm/J180000183-2.jpg" 
            }] 
        },
        { 
            seriesName: "第24届冬季奥林匹克运动会纪念钞（雪上运动）", 
            copies: [
                { 
                    copyId: 1, 
                    year: 2022,
                    purchaseDate: "2025年11月16日", 
                    price: "120元", 
                    bank: "中国人民银行", 
                    version: "J333686866", 
                    condition: "ACG68E", 
                    krause: "917a",
                    issueDate: "2021年12月21日",
                    issueQuantity: "2亿张",
                    remark: "普通版本", 
                    img1: "comm/J333686866-1.jpg", 
                    img2: "comm/J333686866-2.jpg" 
                },
                { 
                    copyId: 2, 
                    year: 2022,
                    purchaseDate: "2026年3月6日", 
                    price: "32元", 
                    bank: "中国人民银行", 
                    version: "J208213254", 
                    condition: "ACG68E", 
                    krause: "917a",
                    issueDate: "2021年12月21日",
                    issueQuantity: "2亿张",
                    remark: "绿奥之星", 
                    img1: "comm/J208213254-1.jpg", 
                    img2: "comm/J208213254-2.jpg" 
                },
                { 
                    copyId: 3, 
                    year: 2022,
                    purchaseDate: "2025年11月16日", 
                    price: "45元", 
                    bank: "中国人民银行", 
                    version: "J207861101", 
                    condition: "ACG67E", 
                    krause: "917a",
                    issueDate: "2021年12月21日",
                    issueQuantity: "2亿张",
                    remark: "绿奥之王", 
                    img1: "comm/J207861101-1.jpg", 
                    img2: "comm/J207861101-2.jpg" 
                }
            ] 
        },
        { 
            seriesName: "第24届冬季奥林匹克运动会纪念钞（香港）", 
            copies: [
                { 
                    copyId: 1, 
                    year: 2022,
                    purchaseDate: "2026年2月21日", 
                    price: "170元", 
                    bank: "中国银行（香港）", 
                    version: "545654", 
                    condition: "ACG68E", 
                    krause: "353a",
                    issueDate: "2021年12月",
                    issueQuantity: "200万张",
                    remark: "这张的号码其实非常值得玩味", 
                    img1: "comm/545654-1.jpg", 
                    img2: "comm/545654-2.jpg" 
                },
                { 
                    copyId: 2, 
                    year: 2022,
                    purchaseDate: "2026年2月17日", 
                    price: "188元", 
                    bank: "中国银行（香港）", 
                    version: "AA537379", 
                    condition: "ACG68E", 
                    krause: "353b",
                    issueDate: "2021年12月",
                    issueQuantity: "200万张",
                    remark: "", 
                    img1: "comm/AA537379-1.jpg", 
                    img2: "comm/AA537379-2.jpg" 
                }
            ] 
        },
        { 
            seriesName: "第24届冬季奥林匹克运动会纪念钞（澳门）", 
            copies: [{ 
                copyId: 1, 
                year: 2022,
                purchaseDate: "2025年10月26日", 
                price: "69元", 
                bank: "中国银行", 
                version: "BC0838287", 
                condition: "ACG66E", 
                krause: "124a",
                issueDate: "2021年12月",
                issueQuantity: "200万张",
                remark: "", 
                img1: "comm/BC0838287-1.jpg", 
                img2: "comm/BC0838287-2.jpg" 
            }] 
        },
        { 
            seriesName: "龙年贺岁纪念钞", 
            copies: [{ 
                copyId: 1, 
                year: 2024,
                purchaseDate: "2026年1月21日", 
                price: "158元", 
                bank: "中国人民银行", 
                version: "J005003567", 
                condition: "ACG67E", 
                krause: "920",
                issueDate: "2024年1月",
                issueQuantity: "1亿张",
                remark: "", 
                img1: "comm/J005003567-1.jpg", 
                img2: "comm/J005003567-2.jpg" 
            }] 
        },
        { 
            seriesName: "蛇年贺岁纪念钞", 
            copies: [{ 
                copyId: 1, 
                year: 2025,
                purchaseDate: "2026年1月22日", 
                price: "60元", 
                bank: "中国人民银行", 
                version: "J006206654", 
                condition: "ACG67E", 
                krause: "921",
                issueDate: "2024年12月",
                issueQuantity: "1亿张",
                remark: "", 
                img1: "comm/J006206654-1.jpg", 
                img2: "comm/J006206654-2.jpg" 
            }] 
        },
        { 
            seriesName: "马年贺岁纪念钞", 
            copies: [
                { 
                    copyId: 1, 
                    year: 2026,
                    purchaseDate: "2026年2月26日", 
                    price: "88元", 
                    bank: "中国人民银行", 
                    version: "J005516765", 
                    condition: "ACG67E", 
                    krause: "922",
                    issueDate: "2025年12月",
                    issueQuantity: "1亿张",
                    remark: "就是凑个品种，太丑了", 
                    img1: "comm/J005516765-1.jpg", 
                    img2: "comm/J005516765-2.jpg" 
                },
                { 
                    copyId: 2, 
                    year: 2026,
                    purchaseDate: "2026年1月20日", 
                    price: "272元", 
                    bank: "中国人民银行", 
                    version: "J037241561-70", 
                    condition: "ACG68E", 
                    krause: "922",
                    issueDate: "2025年12月",
                    issueQuantity: "1亿张",
                    remark: "", 
                    img1: "comm/J037241561-70-1.jpg", 
                    img2: "comm/J037241561-70-2.jpg" 
                }
            ] 
        }
    ]
};
