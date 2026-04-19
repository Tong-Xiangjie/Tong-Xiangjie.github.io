// data/nedb.js
const nedbData = {
    name: "国家经济建设公债",
    icon: null,
    desc: "National Economic Development Bond",
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
            {
            seriesName: "1957年版 国家经济建设公债1元",
            year: "1957",
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
                    remark: "",
                    img1: "image/nedb/ⅢⅩⅩ3307203-1.jpg",
                    img2: "image/nedb/ⅢⅩⅩ3307203-2.jpg"
                }
            ]
        }
    ]
};
