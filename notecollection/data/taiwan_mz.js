// data/taiwan_mz.js
const taiwanMzData = {
    name: "马祖地区专用钞券",
    icon: null,
    desc: "Matsu Area Notes",
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
            seriesName: "中华民国四十三年（1954年） 1元",
            copies: [
                {
                    copyId: 27104073,
                    year: 1954,
                    version: "A795950C",
                    bank: "台湾银行",
                    condition: "ACG 65E",
                    price: "287元",
                    purchaseDate: "2026年7月18日",
                    krause: "R120",
                    print:"中央印制厂/CEPP",
                    remark: "英文前后字轨版",
                    img1: "https://tong-xiangjie.github.io/notecollection/image/taiwan/A795950C-1.jpg",
                    img2: "https://tong-xiangjie.github.io/notecollection/image/taiwan/A795950C-2.jpg"
                }
            ]
        }
    ]
};

