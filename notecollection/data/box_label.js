// data/box_label.js
const box_labelData = {
    name: "封箱单",
    icon: null,
    desc: "box Label",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行方" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "maxIssueQuantity", label: "理论最大发行量" },
        { key: "wmk", label: "水印" },
        { key: "size", label: "标准尺寸" },
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],
    series: [
        {
            seriesName: "纪念钞封箱单",
            year: "",
            varieties: [
                {
                    varietyName: "2026年贺岁纪念钞",
                    copies: [
                        {
                            copyId: 26279291,
                            year: 2026,
                            version: "无字冠",
                            bank: "中国人民银行",
                            condition: "ACG 真品",
                            price: "108元",
                            purchaseDate: "2026年9月16日",
                            krause: "Unlisted",
                            issueDate: "2026年1月20日",
                            maxIssueQuantity: "5000张",
                            size: "",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/box_label/26279291-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/box_label/26279291-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};