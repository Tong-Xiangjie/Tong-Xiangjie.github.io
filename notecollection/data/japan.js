// data/japan.js
const japanData = {
    name: "日本",
    icon: "𝟚𝟚",
    desc: "日本纸币",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },  
        { key: "print", label: "印刷机构" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },  
        { key: "withdrawnDate", label: "退出流通日期" },
        { key: "size", label: "标准尺寸" },
        { key: "wmk", label: "水印" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],

    series: [
        // B序列 100円 板垣退助（1953年12月1日发行）
        {
            seriesName: "B序列 1953年 100円 板垣退助",
            year: "1953",
            copies: [
                {
                    copyId: 1,
                    year: 1953,
                    version: "XP807592G",
                    bank: "日本银行/Bank of Japan",
                    condition: "ACG68E",
                    price: "36元",
                    purchaseDate: "2026年3月1日",
                    krause: "90b",
                    print: "大藏省印刷局",
                    issueDate: "1953年12月1日",
                    withdrawnDate: "1974年8月1日",
                    size: "148mm*76mm",
                    wmk: "桐花图案&100/Turkey Oak Pattern&100",
                    remark: "B号券，双字母冠字前缀。正面：板垣退助，背面：日本国会议事堂。",
                    img1: "image/japan/XP807592G-1.jpg",
                    img2: "image/japan/XP807592G-2.jpg"
                }
            ]
        },
        // D序列 2000円 守礼门（2000年7月19日发行）
        {
            seriesName: "D序列 2000年 2000円 守礼门",
            year: "2000",
            copies: [
                {
                    copyId: 1,
                    year: 2000,
                    version: "SA586830V",
                    bank: "日本银行/Bank of Japan",
                    condition: "ACG68E",
                    price: "172元",
                    purchaseDate: "2026年2月19日",
                    krause: "103b",
                    print: "大藏省印刷局",
                    issueDate: "2000年7月19日",
                    withdrawnDate: "正在流通",
                    size: "154mm*76mm",
                    wmk: "守礼门/Shureimon Gate",
                    remark: "D号券，为纪念第26届八国集团首脑会议和千禧年发行。正面：守礼门，背面：源氏物语绘卷与紫式部。2003年后未再印制。",
                    img1: "image/japan/SA586830V-1.jpg",
                    img2: "image/japan/SA586830V-2.jpg"
                }
            ]
        },
        // F序列 1000円 北里柴三郎（2024年7月3日发行）
        {
            seriesName: "F序列 2024年 1000円 北里柴三郎",
            year: "2024",
            copies: [
                {
                    copyId: 1,
                    year: 2024,
                    version: "AA229466RM",
                    bank: "日本银行/Bank of Japan",
                    condition: "ACG67E",
                    price: "83元",
                    purchaseDate: "2026年1月11日",
                    krause: "107a",
                    print: "国立印刷局",
                    issueDate: "2024年7月3日",
                    withdrawnDate: "正在流通",
                    size: "150mm*76mm",
                    wmk: "北里柴三郎肖像&条形水印/S.Kitasato&Bar Pattern",
                    remark: "F号券，新版纸币。正面：北里柴三郎（细菌学家），背面：神奈川冲浪里（葛饰北斋画作）。",
                    img1: "image/japan/AA229466RM-1.jpg",
                    img2: "image/japan/AA229466RM-2.jpg"
                }
            ]
        }
    ]
};
