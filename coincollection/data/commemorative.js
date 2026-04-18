// data/commemorative.js
const commemorativeData = {
    name: "纪念币",
    icon: null,
    desc: "Commemorative",
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
        { key: "variety", label: "品种" },
        { key: "mintage", label: "发行量" },
        { key: "gradingCompany", label: "评级公司" },
        { key: "grade", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "catalogNumber", label: "目录编号" }
    ],
    series: [
        // ==================== 1986 ====================
        {
            seriesName: "国际和平年普通纪念币",
            year: 1986,
            copies: [
                {
                    copyId: 1,
                    country: "中华人民共和国",
                    year: 1986,
                    issueDate: "1986年9月20日",
                    mint: "上海造币厂、沈阳造币厂",
                    material: "铜镍合金",
                    diameter: "30mm",
                    weight: "9.32g",
                    edge: "连续丝齿",
                    design: "正面国徽，背面和平少女与和平鸽",
                    variety: "",
                    mintage: "2704.8万",
                    grade: "MS67",
                    gradingCompany: "ACG",
                    price: 69,
                    purchaseDate: "2026年4月3日",
                    catalogNumber: "KM# 130",
                    remark: "",
                    img1: "image/commemorative/1986gjhpn1-1.jpg",
                    img2: "image/commemorative/1986gjhpn1-2.jpg"
                }
            ]
        },

        // ==================== 1989 ====================
        {
            seriesName: "中华人民共和国成立四十周年普通纪念币",
            year: 1989,
            copies: [
                {
                    copyId: 1,
                    country: "中华人民共和国",
                    year: 1989,
                    issueDate: "1989年9月28日",
                    mint: "上海造币厂",
                    material: "铜镍合金",
                    diameter: "30mm",
                    weight: "9.32g",
                    edge: "连续丝齿",
                    design: "正面国徽，背面人民大会堂及'1949-1989'",
                    variety: "",
                    mintage: "2100万",
                    grade: "MS67",
                    gradingCompany: "ACG",
                    price: 74,
                    purchaseDate: "2025年12月14日",
                    catalogNumber: "KM# 220",
                    remark: "",
                    img1: "image/commemorative/1989gj40-1.jpg",
                    img2: "image/commemorative/1989gj40-2.jpg"
                }
            ]
        },
    // ==================== 珍稀动物系列 (1993-1999) ====================
        {
            seriesName: "珍稀动物普通纪念币",
            year: 1993,
            copies: [
                {
                    copyId: 1,
                    country: "中华人民共和国",
                    year: 1993,
                    issueDate: "1993年",
                    mint: "沈阳造币厂",
                    material: "紫铜",
                    diameter: "32mm",
                    weight: "13.2g",
                    edge: "连续丝齿",
                    design: "大熊猫",
                    variety: "大熊猫",
                    mintage: "600万",
                    grade: "MS67",
                    gradingCompany: "ACG",
                    price: 118,
                    purchaseDate: "2025年12月16日",
                    catalogNumber: "KM# 469",
                    remark: "",
                    img1: "image/commemorative/1993panda-1.jpg",
                    img2: "image/commemorative/1993panda-2.jpg"
                }
            ]
        },

        // ==================== 1995 ====================
        {
            seriesName: "中国抗日战争和世界反法西斯战争胜利五十周年普通纪念币",
            year: 1995,
            copies: [
                {
                    copyId: 3,
                    country: "中华人民共和国",
                    year: 1995,
                    issueDate: "1995年8月31日",
                    mint: "上海造币厂",
                    material: "钢芯镀镍",
                    diameter: "25mm",
                    weight: "6.05g",
                    edge: "ZHONGGUO与五角星滚字",
                    design: "正面长城，背面战士与百姓杀敌场景",
                    variety: "",
                    mintage: "1000万",
                    grade: "MS68",
                    gradingCompany: "ACG",
                    price: 33,
                    purchaseDate: "2026年4月7日",
                    catalogNumber: "KM# 711",
                    remark: "",
                    img1: "image/commemorative/1995fxs1-1.jpg",
                    img2: "image/commemorative/1995fxs1-2.jpg"
                }
            ]
        },

        // ==================== 2000 ====================
        {
            seriesName: "迎接新世纪普通纪念币",
            year: 2000,
            copies: [
                {
                    copyId: 4,
                    country: "中华人民共和国",
                    year: 2000,
                    issueDate: "2000年11月28日",
                    mint: "上海造币厂",
                    material: "双色铜合金",
                    diameter: "25.5mm",
                    weight: "6.05g",
                    edge: "连续丝齿",
                    design: "正面历史车轮与建筑，背面抽象眼睛与'2'字",
                    variety: "",
                    mintage: "1000万",
                    grade: "MS66",
                    gradingCompany: "ACG",
                    price: 15,
                    purchaseDate: "2026年3月2日",
                    catalogNumber: "KM#1300",
                    remark: "",
                    img1: "image/commemorative/2000xsj1-1.jpg",
                    img2: "image/commemorative/2000xsj1-2.jpg"
                }
            ]
        },

        
        // ==================== 世界文化遗产系列 (2019-2022) ====================
        {
            seriesName: "世界文化遗产普通纪念币",
            year: 2019,
            copies: [
                {
                    copyId: 8,
                    country: "中华人民共和国",
                    year: 2023,
                    issueDate: "2023年",
                    mint: "沈阳造币厂",
                    material: "铜合金",
                    diameter: "外接圆直径30mm",
                    weight: "11.56g",
                    edge: "交替丝齿",
                    design: "峨眉山-乐山大佛",
                    variety: "峨眉山-乐山大佛",
                    mintage: "1.2亿",
                    grade: "MS69",
                    gradingCompany: "ACG",
                    price: 22.5,
                    purchaseDate: "2026年4月8日",
                    catalogNumber: "Unlisted",
                    remark: "世界文化和自然遗产",
                    img1: "image/commemorative/2019emei-1.jpg",
                    img2: "image/commemorative/2019emei-2.jpg"
                },
                {
                    copyId: 9,
                    country: "中华人民共和国",
                    year: 2023,
                    issueDate: "2023年",
                    mint: "沈阳造币厂",
                    material: "铜合金",
                    diameter: "外接圆直径30mm",
                    weight: "11.56g",
                    edge: "交替丝齿",
                    design: "黄山",
                    variety: "黄山",
                    mintage: "1.2亿",
                    grade: "MS69",
                    gradingCompany: "ACG",
                    price: 22.5,
                    purchaseDate: "2026年4月8日",
                    catalogNumber: "Unlisted",
                    remark: "世界文化和自然遗产",
                    img1: "image/commemorative/2022huangshan-1.jpg",
                    img2: "image/commemorative/2022huangshan-2.jpg"
                }
            ]
        },

        // ==================== 国家公园系列 (2023-2026) ====================
        {
            seriesName: "国家公园普通纪念币",
            year: 2023,
            copies: [
                {
                    copyId: 10,
                    country: "中华人民共和国",
                    year: 2023,
                    issueDate: "2023年",
                    mint: "沈阳造币厂",
                    material: "双金属",
                    diameter: "27mm",
                    weight: "9.2g",
                    edge: "交替丝齿",
                    design: "三江源国家公园",
                    variety: "三江源国家公园",
                    mintage: "8000万",
                    grade: "MS69",
                    gradingCompany: "ACG",
                    price: 20,
                    purchaseDate: "2026年4月8日",
                    catalogNumber: "Unlisted",
                    remark: "",
                    img1: "image/commemorative/2023sanjiangyuan-1.jpg",
                    img2: "image/commemorative/2023sanjiangyuan-2.jpg"
                },
                {
                    copyId: 11,
                    country: "中华人民共和国",
                    year: 2024,
                    issueDate: "2024年",
                    mint: "沈阳造币厂",
                    material: "双金属",
                    diameter: "27mm",
                    weight: "9.2g",
                    edge: "交替丝齿",
                    design: "大熊猫国家公园",
                    variety: "大熊猫国家公园",
                    mintage: "8000万",
                    grade: "MS69",
                    gradingCompany: "ACG",
                    price: 20,
                    purchaseDate: "2026年4月8日",
                    catalogNumber: "Unlisted",
                    remark: "",
                    img1: "image/commemorative/2024pandaNP-1.jpg",
                    img2: "image/commemorative/2024pandaNP-2.jpg"
                }
            ]
        }
    ]
};
