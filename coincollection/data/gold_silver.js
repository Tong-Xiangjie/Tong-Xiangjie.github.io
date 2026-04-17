// data/gold_silver.js
const gold_silverData = {
    name: "金银币",
    icon: null,  // 自动编码，无需手动填写
    desc: "Gold & Silver",
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
        // 示例系列（请在此添加您的金银币藏品）
        {
            seriesName: "示例金银币系列",
            year: 2020,
            copies: [
                {
                    copyId: 1,
                    country: "中华人民共和国",
                    year: 2020,
                    issueDate: "2020年8月3日",
                    mint: "深圳国宝造币厂",
                    material: "999足金",
                    diameter: "22mm",
                    weight: "8g",
                    edge: "连续丝齿",
                    design: "正面：国徽、国名、年号；背面：生肖图案、面额",
                    mintage: "30000",
                    grade: "PF69",
                    gradingCompany: "NGC",
                    price: 4800,
                    purchaseDate: "2026-04-01",
                    catalogNumber: "SUN-001",
                    remark: "精制币，带证书",
                    img1: "image/gold_silver/example_front.jpg",
                    img2: "image/gold_silver/example_back.jpg"
                }
            ]
        }
    ]
};