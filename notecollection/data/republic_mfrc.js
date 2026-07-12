// data/republic_mfrc.js
const republic_mfrcData = {
    name: "民国财政部",
    icon: null,
    desc: "Ministry of Finance of the Republic of China",
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
            seriesName: "中华民国八年（1919年） 财政部定期有利国库券",
            year: "1949",
            readme: {
                title: "定期有利国库券章程",
                content: "file:readmes/mfrc_ibtn.txt"
            },
            varieties: [
                {
                    varietyName: "1919年 1/2元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1919,
                            version: "1479029",
                            bank: "中华民国财政部/Ministry of Finance of the Republic of China",
                            print: "财政部印刷局/BEPP",
                            issueDate: "1919年12月",
                            withdrawnDate: "1920年6月",
                            size: "",
                            condition: "暂未评级",
                            price: "530元",
                            purchaseDate: "2026年7月11日",
                            krause: "626a",
                            remark: "印刷机构“BEPP”是Bureau of Engraving and Printing, Peking (China)的缩写；定期有利国库券的英文全称是Interest Bearing Treasury Note",
                            img1: "image/republic_mfrc/1479029-1.jpg",
                            img2: "image/republic_mfrc/1479029-2.jpg"
                        }
                    ]
                },{
                    varietyName: "1919年 1元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1919,
                            version: "1152926",
                            bank: "中华民国财政部/Ministry of Finance of the Republic of China",
                            print: "财政部印刷局/BEPP",
                            issueDate: "1919年12月",
                            withdrawnDate: "1920年6月",
                            size: "",
                            condition: "暂未评级",
                            price: "530元",
                            purchaseDate: "2026年7月11日",
                            krause: "627a",
                            remark: "",
                            img1: "image/republic_mfrc/1152926-1.jpg",
                            img2: "image/republic_mfrc/1152926-2.jpg"
                        }
                    ]
                },{
                    varietyName: "1919年 5元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1919,
                            version: "",
                            bank: "中华民国财政部/Ministry of Finance of the Republic of China",
                            print: "财政部印刷局/BEPP",
                            issueDate: "1919年0月",
                            withdrawnDate: "1920年0月",
                            size: "",
                            condition: "暂未评级",
                            price: "530元",
                            purchaseDate: "2026年7月11日",
                            krause: "626a",
                            remark: "",
                            img1: "image/republic_mfrc/AK-1.jpg",
                            img2: "image/republic_mfrc/AK-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
