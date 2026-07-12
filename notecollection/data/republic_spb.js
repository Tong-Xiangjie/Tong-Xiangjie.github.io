// data/republic_spb.js
const republic_spbData = {
    name: "民国南方人民银行",
    icon: null,
    desc: "Southern People's Bank",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "print", label: "印刷机构" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "withdrawnDate", label: "停止流通日期" },
        { key: "size", label: "标准尺寸" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编码" }
    ],

    series: [
        {
            seriesName: "中华民国三十八年（1949年） 区票",
            year: "1949",
            varieties: [
                {
                    varietyName: "1949年 10元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1949,
                            version: "AN097206",
                            bank: "南方人民银行/Southern People's Bank",
                            print: "未知",
                            issueDate: "",
                            withdrawnDate: "",
                            size: "",
                            condition: "暂未评级",
                            price: "244元",
                            purchaseDate: "2026年7月10日",
                            krause: "S3489",
                            remark: "",
                            img1: "image/republic_spb/AN097206-1.jpg",
                            img2: "image/republic_spb/AN097206-2.jpg"
                        }
                    ]
                },{
                    varietyName: "1949年 10元 改作闽粤赣边区银行（Fujian-Guangdong-Jiangxi Border District Bank）",
                    copies: [
                        {
                            copyId: 1,
                            year: 1949,
                            version: "BN332503",
                            bank: "闽粤赣边区银行/Fujian-Guangdong-Jiangxi Border District Bank",
                            print: "未知",
                            issueDate: "",
                            withdrawnDate: "",
                            size: "",
                            condition: "暂未评级",
                            price: "244元",
                            purchaseDate: "2026年7月10日",
                            krause: "S3482",
                            remark: "",
                            img1: "image/republic_spb/BN332503-1.jpg",
                            img2: "image/republic_spb/BN332503-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
