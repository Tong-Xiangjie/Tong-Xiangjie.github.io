// data/taiwan.js
const taiwanData = {
    name: "台币",
    icon: null,
    desc: "Taiwan Currency",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],

    series: [
        {
            seriesName: "战后旧台币",
            year: "1946～1949",
            varieties: [
                {
                    varietyName: "第一批 中华民国三十五年（1946年） 10元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1946,
                            version: "CA609471",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "86元",
                            purchaseDate: "2026年7月11日",
                            krause: "1937",
                            remark: "",
                            img1: "image/taiwan/CA609471-1.jpg",
                            img2: "image/taiwan/CA609471-2.jpg"
                        }
                    ]
                }
            ]
        },{
            seriesName: "第三套横式新台币",
            year: "1972～1976",
            varieties: [
                {
                    varietyName: "中华民国六十五年（1976年） 10元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1976,
                            version: "SW377511AN",
                            bank: "台湾银行",
                            condition: "ACG67E",
                            price: "57元",
                            purchaseDate: "2026年3月1日",
                            krause: "1984",
                            remark: "民国65年版，正面为孙中山像，背面为中山楼。",
                            img1: "image/taiwan/SW377511AN-1.jpg",
                            img2: "image/taiwan/SW377511AN-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国六十一年（1972年） 100元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1972,
                            version: "X587444W",
                            bank: "台湾银行",
                            condition: "ACG67E",
                            price: "102元",
                            purchaseDate: "2026年3月1日",
                            krause: "1983",
                            remark: "民国61年版，正面为孙中山像，背面为中山楼。",
                            img1: "image/taiwan/X587444W-1.jpg",
                            img2: "image/taiwan/X587444W-2.jpg"
                        }
                    ]
                }
            ]
        },{
            seriesName: "第五套横式新台币",
            year: "1999～2004",
            varieties: [
                {
                    varietyName: "中华民国八十九年（2000年） 100元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2000,
                            version: "XC501317PW",
                            bank: "中央银行",
                            condition: "ACG67E",
                            price: "58元",
                            purchaseDate: "2025年10月13日",
                            krause: "1991",
                            remark: "新版100元，正面为孙中山像，背面为中山楼。",
                            img1: "image/taiwan/XC501317PW-1.jpg",
                            img2: "image/taiwan/XC501317PW-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国九十年（2001年） 200元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2001,
                            version: "EP007165YC",
                            bank: "中央银行",
                            condition: "ACG68E",
                            price: "85元",
                            purchaseDate: "2026年1月7日",
                            krause: "1992",
                            remark: "正面为蒋中正像，背面为总统府。",
                            img1: "image/taiwan/EP007165YC-1.jpg",
                            img2: "image/taiwan/EP007165YC-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国八十九年（2000年） 安一版 500元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2000,
                            version: "JP677873VB",
                            bank: "中央银行",
                            condition: "ACG67E",
                            price: "262元",
                            purchaseDate: "2026年2月14日",
                            krause: "1993",
                            remark: "正面为棒球运动图案，背面为梅花鹿。",
                            img1: "image/taiwan/JP677873VB-1.jpg",
                            img2: "image/taiwan/JP677873VB-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国九十三年（2001年） 安二版 500元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2004,
                            version: "HN723051XB",
                            bank: "中央银行",
                            condition: "ACG68E",
                            price: "165元",
                            purchaseDate: "2026年3月1日",
                            krause: "1996",
                            remark: "新版500元，正面为棒球运动图案，背面为梅花鹿。",
                            img1: "image/taiwan/HN723051XB-1.jpg",
                            img2: "image/taiwan/HN723051XB-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国八十八年（1999年） 安一版 1000元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1999,
                            version: "BR727635YJ",
                            bank: "中央银行",
                            condition: "ACG68E",
                            price: "394元",
                            purchaseDate: "2026年2月14日",
                            krause: "1994",
                            remark: "正面为小学生观察昆虫图案，背面为帝雉。",
                            img1: "image/taiwan/BR727635YJ-1.jpg",
                            img2: "image/taiwan/BR727635YJ-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国九十三年（2004年） 安二版 1000元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2004,
                            version: "WJ052676RZ",
                            bank: "中央银行",
                            condition: "ACG67E",
                            price: "287元",
                            purchaseDate: "2026年3月1日",
                            krause: "1997",
                            remark: "新版1000元，正面为小学生观察昆虫图案，背面为帝雉。",
                            img1: "image/taiwan/WJ052676RZ-1.jpg",
                            img2: "image/taiwan/WJ052676RZ-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国九十年（2001年） 2000元",
                    copies: [
                        {
                            copyId: 1,
                            year: 2001,
                            version: "BQ899363YE",
                            bank: "中央银行",
                            condition: "ACG67E",
                            price: "557元",
                            purchaseDate: "2026年3月1日",
                            krause: "1995",
                            remark: "正面为福尔摩沙卫星一号图案，背面为樱花钩吻鲑。",
                            img1: "image/taiwan/BQ899363YE-1.jpg",
                            img2: "image/taiwan/BQ899363YE-2.jpg"
                        }
                    ]
                }
            ]
        },{
            seriesName: "金门地区专用钞券",
            year: "1949～1981",
            varieties: [
                {
                    varietyName: "中华民国三十八年（1949年） 中央印制厂 1元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1949,
                            version: "A779086K",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "146元",
                            purchaseDate: "2026年7月11日",
                            krause: "R101",
                            remark: "平3版（可惜了这张的冠号没带3）",
                            img1: "image/taiwan/A779086K-1.jpg",
                            img2: "image/taiwan/A779086K-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
