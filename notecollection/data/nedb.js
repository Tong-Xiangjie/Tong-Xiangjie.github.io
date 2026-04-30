// data/nedb.js
const nedbData = {
    name: "国家经济建设公债",
    icon: null,
    desc: "State Economic Construction Bonds",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行部门" },
        { key: "year", label: "发行年份" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],

    series: [
        // ==================== 1955年版 ====================
        {
            seriesName: "1955年版",
            year: "1955",
            // 新增 readme：显示在品种列表页（与各个面值并列，在上方）
            readme: {
                title: "1955年国家经济建设公债条例",
                content: "file:readmes/nedb_1955_ordinance.md"
            },
            varieties: [
                {
                    varietyName: "10000元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1955,
                            version: "00000000 00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-10000-1-1.jpg",
                            img2: "image/nedb/1955-10000-1-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 1955,
                            version: "00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-10000-2-1.jpg",
                            img2: "image/nedb/1955-10000-2-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "20000元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1955,
                            version: "00000000 00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-20000-1-1.jpg",
                            img2: "image/nedb/1955-20000-1-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 1955,
                            version: "00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-20000-2-1.jpg",
                            img2: "image/nedb/1955-20000-2-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "50000元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1955,
                            version: "00000000 00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-50000-1-1.jpg",
                            img2: "image/nedb/1955-50000-1-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 1955,
                            version: "00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-50000-2-1.jpg",
                            img2: "image/nedb/1955-50000-2-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "100000元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1955,
                            version: "〈123〉00000000 00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-100000-1-1.jpg",
                            img2: "image/nedb/1955-100000-1-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 1955,
                            version: "00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-100000-2-1.jpg",
                            img2: "image/nedb/1955-100000-2-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "500000元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1955,
                            version: "〈123〉00000000 00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-500000-1-1.jpg",
                            img2: "image/nedb/1955-500000-1-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 1955,
                            version: "00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-500000-2-1.jpg",
                            img2: "image/nedb/1955-500000-2-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "1000000元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1955,
                            version: "〈123〉00000000 00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-1000000-1-1.jpg",
                            img2: "image/nedb/1955-1000000-1-2.jpg"
                        },
                        {
                            copyId: 2,
                            year: 1955,
                            version: "00887",
                            bank: "中华人民共和国财政部",
                            condition: "暂未评级",
                            price: "138元",
                            purchaseDate: "2026年4月30日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/nedb/1955-1000000-2-1.jpg",
                            img2: "image/nedb/1955-1000000-2-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 1957年版 ====================
        {
            seriesName: "1957年版",
            year: "1957",
            // 新增 readme：显示在品种列表页（与各个面值并列，在上方）
            readme: {
                title: "1957年国家经济建设公债条例",
                content: "file:readmes/nedb_1957_ordinance.md"
            },
            varieties: [
                {
                    varietyName: "1元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1957,
                            version: "ⅢⅩⅩ3307203",
                            bank: "中华人民共和国财政部",
                            condition: "ACG63E",
                            price: "587元",
                            purchaseDate: "2026年4月16日",
                            krause: "Unlisted",
                            // 原来的 remark 文件已移到 series 级别的 readme 中
                            remark: "",
                            img1: "image/nedb/ⅢⅩⅩ3307203-1.jpg",
                            img2: "image/nedb/ⅢⅩⅩ3307203-2.jpg"
                        }
                    ]
                }
                // 可继续添加：2元、5元、10元、50元、100元等面值
            ]
        }
        // 可继续添加：1955年版、1956年版、1958年版等
    ]
};
