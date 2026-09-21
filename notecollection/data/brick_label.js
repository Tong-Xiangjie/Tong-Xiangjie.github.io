// data/brick_label.js
const brick_labelData = {
    name: "捆签",
    icon: null,
    desc: "Brick Label",
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
            seriesName: "第五套人民币",
            year: "",
            varieties: [
                {
                    varietyName: "2005年 5元",
                    copies: [
                        {
                            copyId: 0,
                            year: 2005,
                            version: "SQ 170",
                            bank: "中国人民银行",
                            condition: "暂未评级",
                            price: "10元",
                            purchaseDate: "2026年9月21日",
                            krause: "Unlisted",
                            issueDate: "2010年7月2日",
                            maxIssueQuantity: "",
                            size: "",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/box_label/-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/box_label/-2.jpg"
                        }
                    ]
                },{
                    varietyName: "2005年 10元",
                    copies: [
                        {
                            copyId: 0,
                            year: 2005,
                            version: "BU 12047",
                            bank: "中国人民银行",
                            condition: "暂未评级",
                            price: "10元",
                            purchaseDate: "2026年9月21日",
                            krause: "Unlisted",
                            issueDate: "2009年8月8日",
                            maxIssueQuantity: "",
                            size: "",
                            wmk: "无水印/Without Watermark",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/box_label/-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/box_label/-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};