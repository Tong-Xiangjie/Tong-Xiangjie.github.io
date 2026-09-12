// data/albania.js
const albaniaData = {
    name: "阿尔巴尼亚",
    icon: null,
    desc: "Albania",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行方" },  
        { key: "print", label: "印刷机构" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },  
        { key: "withdrawnDate", label: "停止流通日期" },
        { key: "size", label: "标准尺寸" },
        { key: "wmk", label: "水印" },
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],

    readme: {
        title: "中国代印之阿尔巴尼亚列克",
        content: "file:readmes/albania_zhihu_Haneda_Leonn.html"
    },
    series: [
        {
            seriesName: "第二批（1976年版）",
            year: "1976",
            varieties: [
                {
                    varietyName: "1976年 3列克（Lekë） 摘葡萄",
                    copies: [
                        {
                            copyId: 11387399,
                            year: 1976,
                            version: "JU677775",
                            bank: "阿尔巴尼亚国家银行/Banka e Shtetit Shqiptar",
                            condition: "ACG 67E",
                            price: "45元",
                            purchaseDate: "2026年9月4日",
                            krause: "41a",
                            print: "北京印钞厂/CBPM",
                            issueDate: "",
                            withdrawnDate: "",
                            size: "110mm*60mm",
                            wmk: "银行名称首字母/Bank Initials",
                            remark: "共印刷3975万张。",
                            img1: "https://tong-xiangjie.github.io/notecollection/image/albania/JU677775-1.jpg",
                            img2: "https://tong-xiangjie.github.io/notecollection/image/albania/JU677775-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
