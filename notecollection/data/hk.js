const hkData = {
    name: "港币",
    icon: "𝟘𝟚",
    desc: "中国银行（香港）、香港上海汇丰银行、渣打银行",
    // 港币板块的详情页字段配置
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "signature", label: "签名" },           // 港币特有：签名
        { key: "faceDate", label: "票面日期" },        // 港币特有：票面日期
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯编号" }
    ],
    series: [
        {
            seriesName: "汇丰银行1000元",
            year: 2018,
            copies: [
                {
                    copyId: 1,
                    version: "AB123456",
                    bank: "汇丰银行",
                    condition: "PMG66E",
                    price: "1200元",
                    purchaseDate: "2026年1月15日",
                    krause: "",
                    signature: "陈德霖",           // 港币特有
                    faceDate: "2018年1月1日",      // 港币特有
                    remark: "首发冠",
                    img1: "comm/xxx-1.jpg",
                    img2: "comm/xxx-2.jpg"
                }
            ]
        },
        {
            seriesName: "中国银行500元",
            year: 2019,
            copies: [
                {
                    copyId: 1,
                    version: "CD789012",
                    bank: "中国银行（香港）",
                    condition: "ACG67E",
                    price: "680元",
                    purchaseDate: "2026年2月20日",
                    krause: "",
                    signature: "岳毅",
                    faceDate: "2019年7月1日",
                    remark: "",
                    img1: "comm/xxx-1.jpg",
                    img2: "comm/xxx-2.jpg"
                }
            ]
        }
    ]
};