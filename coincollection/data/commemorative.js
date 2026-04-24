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
        { key: "mintage", label: "发行量" },
        { key: "gradingCompany", label: "评级公司" },
        { key: "grade", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "catalogNumber", label: "目录编号" },
        { key: "design", label: "设计元素" },
    ],
    series: [
        // ==================== 国际和平年（4层） ====================
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
                    material: "铜镍合金（75%铜，25%镍）",
                    diameter: "30mm",
                    weight: "9.32g",
                    edge: "连续丝齿",
                    design: "正面为中华人民共和国国徽（1950年9月20日启用版本），上方刊“中华人民共和国”国名，下方刊“1986”年号；背面主图为一位坐姿少女面朝右方伸展右臂，身旁环绕四只和平鸽，下方刊“国际和平年”主题字样，左侧有邓小平同志手书的“和平”二字，右下方标注“壹圆”面值。",
                    mintage: "2704.8万",
                    grade: "MS67",
                    gradingCompany: "ACG",
                    price: "69元",
                    purchaseDate: "2026年4月3日",
                    catalogNumber: "KM# 130",
                    remark: "",
                    img1: "image/commemorative/1986gjhpn1-1.jpg",
                    img2: "image/commemorative/1986gjhpn1-2.jpg"
                }
            ]
        },
        // ==================== 建国40周年（4层） ====================
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
                    design: "正面为中华人民共和国国徽，上方刊“中华人民共和国”国名，下方刊“1989”年号；背面主图为人民大会堂，上方刊“中华人民共和国成立四十周年”字样，下方刊“1949-1989”及“壹圆”面值。",
                    mintage: "2100万",
                    grade: "MS67",
                    gradingCompany: "ACG",
                    price: "74元",
                    purchaseDate: "2025年12月14日",
                    catalogNumber: "KM# 220",
                    remark: "",
                    img1: "image/commemorative/1989gj40-1.jpg",
                    img2: "image/commemorative/1989gj40-2.jpg"
                }
            ]
        },
        // ==================== 珍稀动物系列（5层，有多品种） ====================
        {
            seriesName: "珍稀动物普通纪念币",
            year: 1993,
            varieties: [
                {
                    varietyName: "大熊猫",
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
                            design: "正面为中华人民共和国国徽，上方刊“中华人民共和国”国名，下方刊“1993”年号；背面主图为一对嬉戏的大熊猫，上方刊“中国珍稀野生动物”字样，下方刊“大熊猫”及“5元”面值。",
                            mintage: "600万",
                            grade: "MS67",
                            gradingCompany: "ACG",
                            price: "118元",
                            purchaseDate: "2025年12月16日",
                            catalogNumber: "KM# 469",
                            remark: "",
                            img1: "image/commemorative/1993panda-1.jpg",
                            img2: "image/commemorative/1993panda-2.jpg"
                        }
                    ]
                }
                // 可继续添加：金丝猴、白鳍豚、华南虎等
            ]
        },
        // ==================== 抗战胜利50周年（4层） ====================
        {
            seriesName: "中国抗日战争和世界反法西斯战争胜利五十周年普通纪念币",
            year: 1995,
            copies: [
                {
                    copyId: 1,
                    country: "中华人民共和国",
                    year: 1995,
                    issueDate: "1995年8月31日",
                    mint: "上海造币厂",
                    material: "钢芯镀镍（约91%铁，1.2%碳，8%镍）",
                    diameter: "25mm",
                    weight: "6.05g",
                    edge: "“ZHONGGUO”与三枚五角星滚字（共两组）",
                    design: "正面为长城、“中华人民共和国”国名及“1995”年号；背面为战士握枪与百姓挥刀杀敌的场景，背景有旗帜和地球，并刊面额、“1945-1995”字样、“中国人民抗日战争和世界反法西斯战争胜利五十周年”主题文字。",
                    mintage: "1000万",
                    grade: "MS68",
                    gradingCompany: "ACG",
                    price: "33元",
                    purchaseDate: "2026年4月7日",
                    catalogNumber: "KM# 711",
                    remark: "",
                    img1: "image/commemorative/1995fxs1-1.jpg",
                    img2: "image/commemorative/1995fxs1-2.jpg"
                }
            ]
        },
        // ==================== 迎接新世纪（4层） ====================
        {
            seriesName: "迎接新世纪普通纪念币",
            year: 2000,
            copies: [
                {
                    copyId: 1,
                    country: "中华人民共和国",
                    year: 2000,
                    issueDate: "2000年11月28日",
                    mint: "上海造币厂",
                    material: "双色铜合金（外环黄铜，内芯白铜）",
                    diameter: "25.5mm",
                    weight: "6.05g",
                    edge: "连续丝齿",
                    design: "正面（外环）上方刊“中华人民共和国”国名，下方刊“2000”年号，主图为滚滚向前的历史车轮，左侧衬以火箭，右侧衬以现代高层建筑；背面（外环）刊“迎接新世纪”主题字样，下方标注“10元”面值，内芯主图为一只抽象的眼睛，以太阳光芒为底纹，前方为丝带状的“2”字，衬以亚洲地图及中国区域。",
                    mintage: "1000万",
                    grade: "MS66",
                    gradingCompany: "ACG",
                    price: "15元",
                    purchaseDate: "2026年3月2日",
                    catalogNumber: "KM# 1300",
                    remark: "",
                    img1: "image/commemorative/2000xsj1-1.jpg",
                    img2: "image/commemorative/2000xsj1-2.jpg"
                }
            ]
        },
        // ==================== 世界文化遗产系列（5层，有多品种） ====================
        {
            seriesName: "世界文化遗产系列普通纪念币",
            year: 2022,
            varieties: [
                {
                    varietyName: "峨眉山-乐山大佛",
                    copies: [
                        {
                            copyId: 1,
                            country: "中华人民共和国",
                            year: 2022,
                            issueDate: "2022年",
                            mint: "沈阳造币厂",
                            material: "铜合金",
                            diameter: "外接圆直径30mm",
                            weight: "11.56g",
                            edge: "交替丝齿",
                            design: "正面主图为中华人民共和国国徽，内缘上方刊“中华人民共和国”国名，下方刊“2019”年号；背面主图为峨眉山-乐山大佛风景，刊“世界文化和自然遗产”字样及“5元”面值。",
                            mintage: "1.2亿",
                            grade: "MS69",
                            gradingCompany: "ACG",
                            price: "22.5元",
                            purchaseDate: "2026年4月8日",
                            catalogNumber: "Unlisted",
                            remark: "",
                            img1: "image/commemorative/2023emei-1.jpg",
                            img2: "image/commemorative/2023emei-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "黄山",
                    copies: [
                        {
                            copyId: 1,
                            country: "中华人民共和国",
                            year: 2022,
                            issueDate: "2022年",
                            mint: "沈阳造币厂",
                            material: "铜合金",
                            diameter: "外接圆直径30mm",
                            weight: "11.56g",
                            edge: "交替丝齿",
                            design: "正面主图为中华人民共和国国徽，内缘上方刊“中华人民共和国”国名，下方刊“2022”年号；背面主图为黄山风景（迎客松），刊“世界文化和自然遗产”字样及“5元”面值。",
                            mintage: "1.2亿",
                            grade: "MS69",
                            gradingCompany: "ACG",
                            price: "22.5元",
                            purchaseDate: "2026年4月8日",
                            catalogNumber: "Unlisted",
                            remark: "",
                            img1: "image/commemorative/2023huangshan-1.jpg",
                            img2: "image/commemorative/2023huangshan-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 国家公园系列（5层，有多品种） ====================
        {
            seriesName: "国家公园系列普通纪念币",
            year: 2023,
            varieties: [
                {
                    varietyName: "三江源国家公园",
                    copies: [
                        {
                            copyId: 1,
                            country: "中华人民共和国",
                            year: 2023,
                            issueDate: "2023年",
                            mint: "沈阳造币厂",
                            material: "双金属",
                            diameter: "27mm",
                            weight: "9.2g",
                            edge: "交替丝齿",
                            design: "正面主图为中华人民共和国国徽，上方刊“中华人民共和国”国名，下方刊“2023”年号；背面主图为三江源国家公园自然景观，刊“三江源国家公园”字样及“10元”面值。",
                            mintage: "8000万",
                            grade: "MS69",
                            gradingCompany: "ACG",
                            price: "20元",
                            purchaseDate: "2026年4月8日",
                            catalogNumber: "Unlisted",
                            remark: "",
                            img1: "image/commemorative/2023sanjiangyuan-1.jpg",
                            img2: "image/commemorative/2023sanjiangyuan-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "大熊猫国家公园",
                    copies: [
                        {
                            copyId: 1,
                            country: "中华人民共和国",
                            year: 2023,
                            issueDate: "2023年",
                            mint: "沈阳造币厂",
                            material: "双金属",
                            diameter: "27mm",
                            weight: "9.2g",
                            edge: "交替丝齿",
                            design: "正面主图为中华人民共和国国徽，上方刊“中华人民共和国”国名，下方刊“2024”年号；背面主图为大熊猫国家公园自然景观，刊“大熊猫国家公园”字样及“10元”面值。",
                            mintage: "8000万",
                            grade: "MS69",
                            gradingCompany: "ACG",
                            price: "20元",
                            purchaseDate: "2026年4月8日",
                            catalogNumber: "Unlisted",
                            remark: "",
                            img1: "image/commemorative/2023pandaNP-1.jpg",
                            img2: "image/commemorative/2023pandaNP-2.jpg"
                        }
                    ]
                }
            ]
        }
    ]
};
