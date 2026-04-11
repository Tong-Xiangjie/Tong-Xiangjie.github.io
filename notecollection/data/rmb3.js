// data/rmb3.js
const rmb3Data = {
    name: "第三套人民币",
    icon: "𝟙𝟙",
    desc: "Third Series of the Renminbi",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "depositOnlyDate", label: "只收不付日期" },
        { key: "withdrawnDate", label: "停止流通日期" },
        { key: "wmk", label: "水印" },
        { key: "size", label: "标准尺寸" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],

    series: [
        // ==================== 1角系列（按发行时间排序）====================
        // 1. 枣红1角（1960）- 1962年4月20日发行
        {
            seriesName: "1960年版 1角 枣红",
            year: "1960",
            copies: [
                {
                    copyId: 1,
                    year: 1960,
                    version: "",
                    bank: "中国人民银行",
                    condition: "",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "空心五角星水印/Hollow Stars",
                    issueDate: "1962年4月20日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "114×52mm",
                    remark: "第三套人民币首发品种",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        // 2. 背绿水印1角 - 1966年1月10日发行
        {
            seriesName: "1962年版 1角 红三冠背绿水印",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "空心五角星水印/Hollow Stars",
                    issueDate: "1966年1月10日",
                    depositOnlyDate: "1967年12月",
                    withdrawnDate: "2000年7月1日",
                    size: "105×50mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        // 3. 背绿无水印1角 - 1966年10月1日发行
        {
            seriesName: "1962年版 1角 红三冠背绿无水印",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "无水印/Without Watermark",
                    issueDate: "1966年10月1日",
                    depositOnlyDate: "1967年12月",
                    withdrawnDate: "2000年7月1日",
                    size: "105×50mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        // 4. 红三冠凸版水印 - 1967年12月15日发行
        {
            seriesName: "1962年版 1角 红三冠凸版水印",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "空心五角星水印/Hollow Stars",
                    issueDate: "1967年12月15日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "105×50mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        // 5. 红三冠平版 - 1967年12月15日发行
        {
            seriesName: "1962年版 1角 红三冠平版",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "无水印/Without Watermark",
                    issueDate: "1967年12月15日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "105×50mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        // 6. 红二冠凸版（ⅤⅡ08686382 → 52-08686382）
        {
            seriesName: "1962年版 1角 红二冠凸版",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "ⅤⅡ08686382",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "",
                    purchaseDate: "",
                    krause: "877g",
                    wmk: "无水印/Without Watermark",
                    issueDate: "",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "105×50mm",
                    remark: "",
                    img1: "image/rmb3/52-08686382-1.jpg",
                    img2: "image/rmb3/52-08686382-2.jpg"
                }
            ]
        },
        // 7. 红二冠平版（ⅨⅦ86510421 → 97-86510421）
        {
            seriesName: "1962年版 1角 红二冠平版",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "ⅨⅦ86510421",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "",
                    purchaseDate: "",
                    krause: "877f",
                    wmk: "无水印/Without Watermark",
                    issueDate: "",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "105×50mm",
                    remark: "",
                    img1: "image/rmb3/97-86510421-1.jpg",
                    img2: "image/rmb3/97-86510421-2.jpg"
                }
            ]
        },
        // 8. 蓝三冠（ⅣⅦⅣ6018867 → 474-6018867）
        {
            seriesName: "1962年版 1角 蓝三冠",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "ⅣⅦⅣ6018867",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "",
                    purchaseDate: "",
                    krause: "877c",
                    wmk: "无水印/Without Watermark",
                    issueDate: "",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "105×50mm",
                    remark: "",
                    img1: "image/rmb3/474-6018867-1.jpg",
                    img2: "image/rmb3/474-6018867-2.jpg"
                }
            ]
        },
        // 9. 蓝二冠（ⅢⅧ86989663 → 38-86989663）
        {
            seriesName: "1962年版 1角 蓝二冠",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "ⅢⅧ86989663",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "",
                    purchaseDate: "",
                    krause: "877d",
                    wmk: "无水印/Without Watermark",
                    issueDate: "",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "105×50mm",
                    remark: "",
                    img1: "image/rmb3/38-86989663-1.jpg",
                    img2: "image/rmb3/38-86989663-2.jpg"
                }
            ]
        },

        // ==================== 2角系列 ====================
        {
            seriesName: "1962年版 2角 三冠凸版",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "无水印/Without Watermark",
                    issueDate: "1964年4月15日",
                    depositOnlyDate: "1967年12月",
                    withdrawnDate: "2000年7月1日",
                    size: "110×50mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        {
            seriesName: "1962年版 2角 三冠平版",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "无水印/Without Watermark",
                    issueDate: "1964年4月15日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "110×50mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        // 二冠平版（ⅢⅧ52000924 → 38-52000924）
        {
            seriesName: "1962年版 2角 二冠平版",
            year: "1962",
            copies: [
                {
                    copyId: 1,
                    year: 1962,
                    version: "ⅢⅧ52000924",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "",
                    purchaseDate: "",
                    krause: "878c",
                    wmk: "无水印/Without Watermark",
                    issueDate: "",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "110×50mm",
                    remark: "",
                    img1: "image/rmb3/38-52000924-1.jpg",
                    img2: "image/rmb3/38-52000924-2.jpg"
                }
            ]
        },

        // ==================== 5角系列 ====================
        // 凸版水印（ⅧⅩⅡ1621789 → 802-1621789，注意Ⅹ=0，Ⅱ=2）
        {
            seriesName: "1972年版 5角 凸版水印",
            year: "1972",
            copies: [
                {
                    copyId: 1,
                    year: 1972,
                    version: "ⅧⅩⅡ1621789",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "",
                    purchaseDate: "",
                    krause: "880a",
                    wmk: "五星水印/Stars",
                    issueDate: "1974年1月5日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "115×50mm",
                    remark: "",
                    img1: "image/rmb3/802-1621789-1.jpg",
                    img2: "image/rmb3/802-1621789-2.jpg"
                }
            ]
        },
        {
            seriesName: "1972年版 5角 平版水印",
            year: "1972",
            copies: [
                {
                    copyId: 1,
                    year: 1972,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "五星水印/Stars",
                    issueDate: "1974年1月5日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "115×50mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        // 平版无水印（ⅤⅨⅡ1923455 → 592-1923455）
        {
            seriesName: "1972年版 5角 平版无水印",
            year: "1972",
            copies: [
                {
                    copyId: 1,
                    year: 1972,
                    version: "ⅤⅨⅡ1923455",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "",
                    purchaseDate: "",
                    krause: "880c",
                    wmk: "无水印/Without Watermark",
                    issueDate: "1974年1月5日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "115×50mm",
                    remark: "",
                    img1: "image/rmb3/592-1923455-1.jpg",
                    img2: "image/rmb3/592-1923455-2.jpg"
                }
            ]
        },

        // ==================== 1元系列 ====================
        {
            seriesName: "1960年版 1元 古币水印",
            year: "1960",
            copies: [
                {
                    copyId: 1,
                    year: 1960,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "古币/空心五星水印/Ancient Coin/Hollow Stars",
                    issueDate: "1969年10月20日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "131×57mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        {
            seriesName: "1960年版 1元 三冠",
            year: "1960",
            copies: [
                {
                    copyId: 1,
                    year: 1960,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "五星水印/Stars",
                    issueDate: "1969年10月20日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "131×57mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        // 二冠（ⅥⅨ34050009 → 69-34050009）
        {
            seriesName: "1960年版 1元 二冠",
            year: "1960",
            copies: [
                {
                    copyId: 1,
                    year: 1960,
                    version: "ⅥⅨ34050009",
                    bank: "中国人民银行",
                    condition: "ACG66E",
                    price: "",
                    purchaseDate: "",
                    krause: "874c",
                    wmk: "五星水印/Stars",
                    issueDate: "1969年10月20日",
                    depositOnlyDate: "",
                    withdrawnDate: "2000年7月1日",
                    size: "131×57mm",
                    remark: "",
                    img1: "image/rmb3/69-34050009-1.jpg",
                    img2: "image/rmb3/69-34050009-2.jpg"
                }
            ]
        },

        // ==================== 2元系列 ====================
        {
            seriesName: "1960年版 2元 古币水印",
            year: "1960",
            copies: [
                {
                    copyId: 1,
                    year: 1960,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "古币/空心五星水印/Ancient Coin/Hollow Stars",
                    issueDate: "1964年4月15日",
                    depositOnlyDate: "1991年3月1日",
                    withdrawnDate: "2000年7月1日",
                    size: "135×57mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        {
            seriesName: "1960年版 2元 五星水印",
            year: "1960",
            copies: [
                {
                    copyId: 1,
                    year: 1960,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "五星水印/Stars",
                    issueDate: "1964年4月15日",
                    depositOnlyDate: "1991年3月1日",
                    withdrawnDate: "2000年7月1日",
                    size: "135×57mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },

        // ==================== 5元系列 ====================
        {
            seriesName: "1960年版 5元 三冠",
            year: "1960",
            copies: [
                {
                    copyId: 1,
                    year: 1960,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "五星水印/Stars",
                    issueDate: "1969年10月20日",
                    depositOnlyDate: "1991年3月1日",
                    withdrawnDate: "2000年7月1日",
                    size: "142×63mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        {
            seriesName: "1960年版 5元 二冠",
            year: "1960",
            copies: [
                {
                    copyId: 1,
                    year: 1960,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "五星水印/Stars",
                    issueDate: "1969年10月20日",
                    depositOnlyDate: "1991年3月1日",
                    withdrawnDate: "2000年7月1日",
                    size: "142×63mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },

        // ==================== 10元系列 ====================
        {
            seriesName: "1965年版 10元 三冠",
            year: "1965",
            copies: [
                {
                    copyId: 1,
                    year: 1965,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "五星水印/Stars",
                    issueDate: "1966年1月10日",
                    depositOnlyDate: "1996年3月1日",
                    withdrawnDate: "2000年7月1日",
                    size: "157×72mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        },
        {
            seriesName: "1965年版 10元 二冠",
            year: "1965",
            copies: [
                {
                    copyId: 1,
                    year: 1965,
                    version: "",
                    bank: "中国人民银行",
                    condition: "ACG00E",
                    price: "",
                    purchaseDate: "",
                    krause: "",
                    wmk: "五星水印/Stars",
                    issueDate: "1966年1月10日",
                    depositOnlyDate: "1996年3月1日",
                    withdrawnDate: "2000年7月1日",
                    size: "157×72mm",
                    remark: "",
                    img1: "image/rmb3/-1.jpg",
                    img2: "image/rmb3/-2.jpg"
                }
            ]
        }
    ]
};
