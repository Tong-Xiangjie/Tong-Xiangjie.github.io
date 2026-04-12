// data/taiwan.js
const taiwanData = {
    name: "新台币",
    icon: "𝟘𝟠",
    desc: "New Taiwan Currency",
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
        // 第一版100元（民国61年版）
        {
            seriesName: "1972年版 新台币100元",
            year: "1972",
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
        },
        // 第一版10元（民国65年版）
        {
            seriesName: "1976年版 新台币10元",
            year: "1976",
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
        },
        // 2000年版100元（千禧年纪念版）
        {
            seriesName: "2000年版 新台币100元",
            year: "2000",
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
        },
        // 2001年版200元
        {
            seriesName: "2001年版 新台币200元",
            year: "2001",
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
        },
        // 2000年版500元
        {
            seriesName: "2000年版 新台币500元",
            year: "2000",
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
        },
        // 2004年版500元
        {
            seriesName: "2004年版 新台币500元",
            year: "2004",
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
        },
        // 1999年版1000元
        {
            seriesName: "1999年版 新台币1000元",
            year: "1999",
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
        },
        // 2004年版1000元
        {
            seriesName: "2004年版 新台币1000元",
            year: "2004",
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
        },
        // 2001年版2000元
        {
            seriesName: "2001年版 新台币2000元",
            year: "2001",
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
};
