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
        { key: "mintage", label: "发行量" },
        { key: "gradingCompany", label: "评级公司" },
        { key: "grade", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "catalogNumber", label: "目录编号" }
    ],
    series: [
        // 示例系列（请在此添加您的流通币藏品）
        {
            seriesName: "示例流通币系列",
            year: 2000,
            copies: [
                {
                    copyId: 1,
                    country: "中华人民共和国",
                    year: 2000,
                    issueDate: "2000年10月16日",
                    mint: "南京造币厂",
                    material: "钢芯镀镍",
                    diameter: "25mm",
                    weight: "6.05g",
                    edge: "连续丝齿",
                    design: "正面：国徽、国名、年号；背面：面额、花卉图案",
                    mintage: "1000万",
                    grade: "MS66",
                    gradingCompany: "PCGS",
                    price: 50,
                    purchaseDate: "2026-04-01",
                    catalogNumber: "SUN-001",
                    remark: "示例备注",
                    img1: "image/circulating/example_front.jpg",
                    img2: "image/circulating/example_back.jpg"
                }
            ]
        }
    ]
};