// data/circulating.js
const circulatingData = {
    name: "流通币",
    icon: null,  // 自动编码，无需手动填写
    desc: "Circulating",
    detailFields: [
        { key: "country", label: "发行国家/地区" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "mint", label: "造币厂" },
        { key: "material", label: "材质" },
        { key: "diameter", label: "直径" },
        { key: "weight", label: "重量" },
        { key: "edge", label: "边齿" },
        { key: "design", label: "设计元素" },
        { key: "gradingCompany", label: "评级公司" },
        { key: "grade", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "catalogNumber", label: "目录编号" }
    ],
    series: [
        // 示例系列（请在此添加您的流通币藏品）
        {
            seriesName: "1955～2018年 1分",
            year: "1955～2018",
            copies: [
                {
                    copyId: 1,
                    country: "中华人民共和国",
                    year: 2018,
                    issueDate: "---",
                    mint: "---",
                    material: "铝镁合金",
                    diameter: "18mm",
                    weight: "0.67g",
                    edge: "连续丝齿",
                    design: "",
                    grade: "MS68",
                    gradingCompany: "ACG",
                    price: "18元",
                    purchaseDate: "2026年6月19日",
                    catalogNumber: "",
                    remark: "发行分币的最后一年，关门币。",
                    img1: "image/circulating/2018-001-1.jpg",
                    img2: "image/circulating/2018-001-2.jpg"
                }
            ]
        }
    ]
};
