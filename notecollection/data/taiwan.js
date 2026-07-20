// data/taiwan.js
const taiwanData = {
    name: "台币",
    icon: null,
    desc: "Taiwan Currency",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "print", label: "印刷机构" },
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
                    varietyName: "第一批 中华民国三十五年（1946年） 1元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1946,
                            version: "AU972508",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "108元",
                            purchaseDate: "2026年7月18日",
                            krause: "1935",
                            remark: "",
                            img1: "image/taiwan/AU972508-1.jpg",
                            img2: "image/taiwan/AU972508-2.jpg"
                        }
                    ]
                },{
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
            seriesName: "第一套横式新台币",
            year: "1960～1968",
            varieties: [
                {
                    varietyName: "中华民国五十年（1961年） 1元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1961,
                            version: "H310826F",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "33元",
                            purchaseDate: "2026年7月18日",
                            krause: "1971a",
                            print:"台湾银行印刷所/PFBT",
                            remark: "中央水印",
                            img1: "image/taiwan/H310826F-1.jpg",
                            img2: "image/taiwan/H310826F-2.jpg"
                        },{
                            copyId: 1,
                            year: 1961,
                            version: "K435010S",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "35元",
                            purchaseDate: "2026年7月18日",
                            krause: "1971a",
                            print:"台湾银行印刷所/PFBT",
                            remark: "无水印",
                            img1: "image/taiwan/K435010S-1.jpg",
                            img2: "image/taiwan/K435010S-2.jpg"
                        },{
                            copyId: 1,
                            year: 1961,
                            version: "G823517F",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "25元",
                            purchaseDate: "2026年7月18日",
                            krause: "1971b",
                            print:"台湾银行印刷所/PFBT",
                            remark: "有“H”记；平版印刷，辅币荒期间（1970～1973）发行",
                            img1: "image/taiwan/G823517F-1.jpg",
                            img2: "image/taiwan/G823517F-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国五十年（1961年） 5元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1961,
                            version: "N482792K",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "158元",
                            purchaseDate: "2026年7月18日",
                            krause: "1972",
                            print:"中央印制厂/CEPP",
                            remark: "平3版，布币水印",
                            img1: "image/taiwan/N482792K-1.jpg",
                            img2: "image/taiwan/N482792K-2.jpg"
                        },{
                            copyId: 1,
                            year: 1961,
                            version: "V136765K",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "85元",
                            purchaseDate: "2026年7月18日",
                            krause: "1972",
                            print:"中央印制厂/CEPP",
                            remark: "圆3版，布币水印",
                            img1: "image/taiwan/V136765K-1.jpg",
                            img2: "image/taiwan/V136765K-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国四十九年（1960年） 红10元 中华民国五十七年（1968年）发行",
                    copies: [
                        {
                            copyId: 1,
                            year: 1968,
                            version: "Z565788R",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "88元",
                            purchaseDate: "2026年7月18日",
                            krause: "1970",
                            print:"",
                            remark: "",
                            img1: "image/taiwan/Z565788R-1.jpg",
                            img2: "image/taiwan/Z565788R-2.jpg"
                        }
                    ]
                }
            ]
        },{
            seriesName: "第二套横式新台币",
            year: "1969～1970",
            varieties: [
                {
                    varietyName: "中华民国五十八年（1969年） 10元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1969,
                            version: "E348986F",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "46元",
                            purchaseDate: "2026年7月18日",
                            krause: "1979a",
                            print: "中央印制厂/CEPP",
                            remark: "正常版式",
                            img1: "image/taiwan/E348986F-1.jpg",
                            img2: "image/taiwan/E348986F-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国五十九年（1970年） 50元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1970,
                            version: "K606546R",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "180元",
                            purchaseDate: "2026年7月18日",
                            krause: "1980",
                            remark: "",
                            img1: "image/taiwan/K606546R-1.jpg",
                            img2: "image/taiwan/K606546R-2.jpg"
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
                            remark: "",
                            img1: "image/taiwan/SW377511AN-1.jpg",
                            img2: "image/taiwan/SW377511AN-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国六十一年（1972年） 50元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1972,
                            version: "H296773C",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "39元",
                            purchaseDate: "2026年7月18日",
                            krause: "1982",
                            remark: "组记D字",
                            img1: "image/taiwan/H296773C-1.jpg",
                            img2: "image/taiwan/H296773C-2.jpg"
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
                            remark: "组记G字",
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
                            remark: "",
                            img1: "image/taiwan/XC501317PW-1.jpg",
                            img2: "image/taiwan/XC501317PW-2.jpg"
                        },{
                            copyId: 2,
                            year: 2000,
                            version: "BB494156NZ",
                            bank: "中央银行",
                            condition: "暂未评级",
                            price: "48元",
                            purchaseDate: "2026年7月18日",
                            krause: "1991*",
                            remark: "补号",
                            img1: "image/taiwan/BB494156NZ-1.jpg",
                            img2: "image/taiwan/BB494156NZ-2.jpg"
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
                            remark: "",
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
                            remark: "",
                            img1: "image/taiwan/JP677873VB-1.jpg",
                            img2: "image/taiwan/JP677873VB-2.jpg"
                        }
                    ]
                },{
                    varietyName: "中华民国九十三年（2004年） 安二版 500元",
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
                            remark: "",
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
                            remark: "",
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
                            remark: "",
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
                    varietyName: "中华民国三十八年（1949年） 1元",
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
                            print:"中央印制厂/CEPP",
                            remark: "平3版（可惜了这张的冠号没带3）",
                            img1: "image/taiwan/A779086K-1.jpg",
                            img2: "image/taiwan/A779086K-2.jpg"
                        }
                    ]
                }
            ]
        },{
            seriesName: "马祖地区专用钞券",
            year: "1950～1981",
            varieties: [
                {
                    varietyName: "中华民国四十三年（1954年） 1元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1949,
                            version: "A795950C",
                            bank: "台湾银行",
                            condition: "暂未评级",
                            price: "260元",
                            purchaseDate: "2026年7月18日",
                            krause: "R120",
                            print:"中央印制厂/CEPP",
                            remark: "英文前后字轨版",
                            img1: "image/taiwan/A795950C-1.jpg",
                            img2: "image/taiwan/A795950C-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
