// data/uncut.js
const uncutData = {
    name: "连体钞",
    icon: null,
    desc: "Uncut Sheet",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "number", label: "发行量" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],
    series: [
        // ==================== 2001年 澳门双错四连体 ====================
        {
            seriesName: "澳门币十元券连体钞四连张",
            year: "2001",
            varieties: [
                {
                    varietyName: "中国银行",
                    copies: [
                        {
                            copyId: 1,
                            year: 2001,
                            version: "DQ6/7/8/98397",
                            bank: "中国银行",
                            number: "10万",
                            condition: "ACG66E",
                            price: "344元",
                            purchaseDate: "2026年4月8日",
                            krause: "",
                            remark: "",
                            img1: "image/uncut/DQ67898397-1.jpg",
                            img2: "image/uncut/DQ67898397-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "大西洋银行",
                    copies: [
                        {
                            copyId: 1,
                            year: 2001,
                            version: "BH00/2/4/68397",
                            bank: "大西洋银行",
                            number: "10万",
                            condition: "ACG65E",
                            price: "344元",
                            purchaseDate: "2026年4月8日",
                            krause: "",
                            remark: "",
                            img1: "image/uncut/BH002468397-1.jpg",
                            img2: "image/uncut/BH002468397-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "证书",
                    copies: [
                        {
                            copyId: 1,
                            year: 2001,
                            version: "048397",
                            bank: "中国长城硬币投资有限公司",
                            number: "10万",
                            condition: "ACG真品",
                            price: "27元",
                            purchaseDate: "2026年4月8日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/uncut/048397-1.jpg",
                            img2: "image/uncut/048397-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 2011年 台湾辛亥三连体 ====================
        {
            seriesName: "庆祝中华民国建国一百年纪念钞（三连体）",
            year: "2011",
            copies: [
                {
                    copyId: 1,
                    year: 2011,
                    version: "JQ47754/5/6ZA",
                    bank: "中央银行",
                    number: "30万",
                    condition: "ACG66E",
                    price: "294元",
                    purchaseDate: "2026年4月1日",
                    krause: "",
                    remark: "",
                    img1: "image/uncut/JQ47754456ZA-1.jpg",
                    img2: "image/uncut/JQ47754456ZA-2.jpg"
                }
            ]
        },{
            seriesName: "纪念中国银行成立100周年纪念钞（香港）（三连体）",
            year: "2012",
            copies: [
                {
                    copyId: 1,
                    year: 2012,
                    version: "54/5/65788",
                    bank: "中国银行（香港）",
                    number: "",
                    condition: "ACG67E",
                    price: "534元",
                    purchaseDate: "2026年5月25日",
                    krause: "346a",
                    remark: "",
                    img1: "image/uncut/54565788-1.jpg",
                    img2: "image/uncut/54565788-2.jpg"
                }
            ]
        }
    ]
};
