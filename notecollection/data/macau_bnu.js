// data/macau_bnu.js
const macau_bnuData = {
    name: "澳门大西洋银行",
    icon: null,
    desc: "Banco Nacional Ultramarino",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "signature", label: "签名" },
        { key: "faceDate", label: "票面日期" },
        { key: "size", label: "标准尺寸" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],
    series: [
        {
            seriesName: "2020年版 澳门元10元",
            year: "2020",
            copies: [
                {
                    copyId: 1,
                    year: 2020,
                    version: "AA109943",
                    bank: "大西洋银行",
                    condition: "ACG66E",
                    price: "",
                    purchaseDate: "",
                    krause: "90",
                    signature: "董事会：António José Félix de Carvalho，José João de Deus Duarte",
                    faceDate: "2020年5月18日",
                    size: "138mm*69mm",
                    remark: "",
                    img1: "image/macau_bnu/AA109943-1.jpg",
                    img2: "image/macau_bnu/AA109943-2.jpg"
                }
            ]
        }
    ]
};
