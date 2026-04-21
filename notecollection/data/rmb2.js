// data/rmb2.js
const rmb2Data = {
    name: "第二套人民币",
    icon: null,
    desc: "Second Series of the Renminbi",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行银行" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "withdrawnDate", label: "停止流通日期" },
        { key: "wmk", label: "水印" },
        { key: "size", label: "标准尺寸" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编码" }
    ],

    series: [
        // ==================== 1分系列 ====================
        {
            seriesName: "1953年版 1分 长号",
            year: "1953",
            copies: [
                {
                    copyId: 1,
                    year: 1953,
                    version: "",
                    bank: "中国人民银行",
                    condition: "",
                    price: "",
                    purchaseDate: "",
                    issueDate: "1955年3月1日",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "90mm*42.5mm",
                    krause: "860a",
                    remark: "三位罗马冠字+七位阿拉伯数字，有'儿'版和无'儿'版两种暗记",
                    img1: "image/rmb2/-1.jpg",
                    img2: "image/rmb2/-2.jpg"
                }
            ]
        },
        {
            seriesName: "1953年版 1分 短号",
            year: "1953",
            copies: [
                {
                    copyId: 1,
                    year: 1953,
                    version: "ⅦⅡⅡ",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "17元",
                    purchaseDate: "2026年2月18日",
                    issueDate: "1981年",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "90mm*42.5mm",
                    krause: "860b.1",
                    remark: "只有罗马冠字（三位或二位），无阿拉伯数字。按冠字大小分为小三冠(4mm)、大三冠(5mm)、大二冠。这一张为小三冠。",
                    img1: "image/rmb2/722-1.jpg",
                    img2: "image/rmb2/722-2.jpg"
                },{
                    copyId: 2,
                    year: 1953,
                    version: "ⅠⅡⅡ",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "25元",
                    purchaseDate: "2026年3月2日",
                    issueDate: "1981年",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "90mm*42.5mm",
                    krause: "860b.2",
                    remark: "只有罗马冠字（三位或二位），无阿拉伯数字。按冠字大小分为小三冠(4mm)、大三冠(5mm)、大二冠。这一张为大三冠。",
                    img1: "image/rmb2/122-1.jpg",
                    img2: "image/rmb2/122-2.jpg"
                },{
                    copyId: 3,
                    year: 1953,
                    version: "ⅤⅩ",
                    bank: "中国人民银行",
                    condition: "ACG66E",
                    price: "30元",
                    purchaseDate: "2026年2月7日",
                    issueDate: "1981年",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "90mm*42.5mm",
                    krause: "860c",
                    remark: "只有罗马冠字（三位或二位），无阿拉伯数字。按冠字大小分为小三冠(4mm)、大三冠(5mm)、大二冠。这一张为大二冠。",
                    img1: "image/rmb2/50-1.jpg",
                    img2: "image/rmb2/50-2.jpg"
                }
            ]
        },

        // ==================== 2分系列 ====================
        {
            seriesName: "1953年版 2分 长号",
            year: "1953",
            copies: [
                {
                    copyId: 1,
                    year: 1953,
                    version: "ⅦⅣⅠ7004155",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "238元",
                    purchaseDate: "2026年1月8日",
                    issueDate: "1955年3月1日",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "95mm*45mm",
                    krause: "861a",
                    remark: "三位罗马冠字+七位阿拉伯数字。暗记：正面飞机头有白点；背面右侧藏文下有党徽图案；背面行名字左方有倒斜'古'",
                    img1: "image/rmb2/741-7004155-1.jpg",
                    img2: "image/rmb2/741-7004155-2.jpg"
                }
            ]
        },
        {
            seriesName: "1953年版 2分 短号",
            year: "1953",
            copies: [
                {
                    copyId: 1,
                    year: 1953,
                    version: "ⅡⅠⅡ",
                    bank: "中国人民银行",
                    condition: "ACG66E",
                    price: "28元",
                    purchaseDate: "2026年3月2日",
                    issueDate: "1981年",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "95mm*45mm",
                    krause: "861c",
                    remark: "三位罗马冠字，无阿拉伯数字。按冠字大小分为小三冠(4mm)和大三冠(5mm)：小三冠飞机头无白点，大三冠飞机头有白点。这一张为小三冠。",
                    img1: "image/rmb2/212-1.jpg",
                    img2: "image/rmb2/212-2.jpg"
                },{
                    copyId: 2,
                    year: 1953,
                    version: "ⅠⅤⅤ",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "17元",
                    purchaseDate: "2026年2月4日",
                    issueDate: "1981年",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "95mm*45mm",
                    krause: "861b",
                    remark: "三位罗马冠字，无阿拉伯数字。按冠字大小分为小三冠(4mm)和大三冠(5mm)：小三冠飞机头无白点，大三冠飞机头有白点。这一张为小三冠。",
                    img1: "image/rmb2/155-1.jpg",
                    img2: "image/rmb2/155-2.jpg"
                }
            ]
        },

        // ==================== 5分系列 ====================
        {
            seriesName: "1953年版 5分 长号",
            year: "1953",
            copies: [
                {
                    copyId: 1,
                    year: 1953,
                    version: "",
                    bank: "中国人民银行",
                    condition: "",
                    price: "",
                    purchaseDate: "",
                    issueDate: "1955年3月1日",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "100mm*47.5mm",
                    krause: "862a",
                    remark: "三位罗马冠字+七位阿拉伯数字。暗记：正面轮船尾部有字母'P'和'H'；底纹偏浅草绿色",
                    img1: "image/rmb2/-1.jpg",
                    img2: "image/rmb2/-2.jpg"
                }
            ]
        },
        {
            seriesName: "1953年版 5分 短号",
            year: "1953",
            copies: [
                {
                    copyId: 1,
                    year: 1953,
                    version: "ⅢⅤⅢ",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "17元",
                    purchaseDate: "2026年2月4日",
                    issueDate: "1981年",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "100mm*47.5mm",
                    krause: "862c",
                    remark: "三位罗马冠字，无阿拉伯数字。按冠字大小分为小三冠(4mm)和大三冠(5mm)；底纹为橄榄绿色。这一张为小三冠。",
                    img1: "image/rmb2/353-1.jpg",
                    img2: "image/rmb2/353-2.jpg"
                },{
                    copyId: 2,
                    year: 1953,
                    version: "ⅩⅤⅤ",
                    bank: "中国人民银行",
                    condition: "ACG67E",
                    price: "30元",
                    purchaseDate: "2026年2月18日",
                    issueDate: "1981年",
                    withdrawnDate: "2007年4月1日",
                    wmk: "无水印/Without Watermark",
                    size: "100mm*47.5mm",
                    krause: "862b",
                    remark: "三位罗马冠字，无阿拉伯数字。按冠字大小分为小三冠(4mm)和大三冠(5mm)；底纹为橄榄绿色。这一张为小三冠。",
                    img1: "image/rmb2/055-1.jpg",
                    img2: "image/rmb2/055-2.jpg"
                }
            ]
        }
    ]
};
