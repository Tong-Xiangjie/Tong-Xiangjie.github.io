// data/taiwan_km.js
const taiwanKmData = {
    name: "金门地区专用钞券",
    icon: null,
    desc: "Kinmen Area Notes",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行方" },
        { key: "year", label: "发行年份" },
        { key: "print", label: "印刷机构" },
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],

    series: [
        {
            seriesName: "中华民国三十八年（1949年） 1元",
            copies: [
                {
                    copyId: 27104072,
                    year: 1949,
                    version: "A779086K",
                    bank: "台湾银行",
                    condition: "ACG 64E",
                    price: "173元",
                    purchaseDate: "2026年7月11日",
                    krause: "R101",
                    print:"中央印制厂/CEPP",
                    remark: "平3版（可惜了这张的冠号没带3）",
                    img1: "https://tong-xiangjie.github.io/notecollection/image/taiwan/A779086K-1.jpg",
                    img2: "https://tong-xiangjie.github.io/notecollection/image/taiwan/A779086K-2.jpg"
                }
            ]
        }
    ]
};

