// data/mpc.js
const mpcData = {
    name: "军用代金券",
    icon: null,
    desc: "Military Payment Certificate",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行方" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "wmk", label: "水印" },
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],
    series: [
        {
            seriesName: "1965年 1分",
            year: "1979",
            copies: [
                {
                    copyId: 0,
                    year: 1965,
                    issueDate:"1965年4月24日",
                    purchaseDate: "2026年10月1日",
                    price: "200元",
                    bank: "中国人民银行",
                    version: "〈AD〉",
                    condition: "暂未评级",
                    krause: "M41",
                    wmk: "无水印/Without watermark",
                    remark: "中国人民银行受中国人民解放军中央军委委托，于1965年4月24日印发军用代金券一套六张。",
                    img1: "https://tong-xiangjie.github.io/notecollection/image/fec/copyId-1.jpg",
                    img2: "https://tong-xiangjie.github.io/notecollection/image/fec/copyId-2.jpg"
                }
            ]
        }
    ]
};
