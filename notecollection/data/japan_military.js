const japanMilitaryData = {
    name: "大日本帝国政府军用手票",
    icon: null,
    desc: "Japanese Imperial Government Military Note",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行单位" },
        { key: "print", label: "印刷地区" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "withdrawnDate", label: "退出流通" },
        { key: "size", label: "标准尺寸" },
        { key: "wmk", label: "水印" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯编号" }
    ],

    series: [
        // 甲号【1937，无百元，只有小面额：10钱/50钱/1/5/10圆】
        {
            seriesName: "甲号券",
            year: "1937",
            varieties: [
                { varietyName: "1937年 10钱", copies: [] },
                { varietyName: "1937年 50钱", copies: [] },
                { varietyName: "1937年 1圆", copies: [] },
                { varietyName: "1937年 5圆", copies: [] },
                { varietyName: "1937年 10圆", copies: [] }
            ]
        },

        // 乙号【1938，5/10/100圆；原版改票、涂黑日本银行、本土凤凰水印】
        {
            seriesName: "乙号券",
            year: "1938",
            varieties: [
                { varietyName: "1938年 5圆", copies: [] },
                { varietyName: "1938年 10圆", copies: [] },
                { varietyName: "1938年 100圆", copies: [] }
            ]
        },

        // 丙号【全套：1/5/10/100圆，分：日本本土水印版、沦陷区现地无水印版（你藏品在此）】
        {
            seriesName: "丙号券",
            year: "1938",
            varieties: [
                { varietyName: "1938年 1圆", copies: [] },
                { varietyName: "1938年 5圆", copies: [] },
                { varietyName: "1938年 10圆", copies: [] },
                { varietyName: "1938年 100圆", copies: [
                  {
                            copyId: 1,
                            year: 1938,
                            version: "1",
                            bank: "日本帝国政府",
                            condition: "ACG65E",
                            price: "78元",
                            purchaseDate: "2026年6月6日",
                            krause: "M29",
                            print: "大日本帝国印刷局",
                            issueDate: "",
                            withdrawnDate: "",
                            size: "",
                            wmk: "无水印/Without watermark",
                            remark: "",
                            img1: "image/japan_military/1-1.jpg",
                            img2: "image/japan_military/1-2.jpg"
                        }
                ] }
            ]
        },

        // 丁号【龙凤无圣德人像：1/5/10/100圆】
        {
            seriesName: "丁号券",
            year: "1939",
            varieties: [
                { varietyName: "1939年 1圆", copies: [] },
                { varietyName: "1939年 5圆", copies: [] },
                { varietyName: "1939年 10圆", copies: [] },
                { varietyName: "1939年 100圆", copies: [] }
            ]
        },

        // 戊号【无红字“军用手票”、单凤：1/5/10/100圆】
        {
            seriesName: "戊号券",
            year: "1939",
            varieties: [
                { varietyName: "1939年 1圆", copies: [] },
                { varietyName: "1939年 5圆", copies: [] },
                { varietyName: "1939年 10圆", copies: [] },
                { varietyName: "1939年 100圆", copies: [] }
            ]
        }
    ]
};
