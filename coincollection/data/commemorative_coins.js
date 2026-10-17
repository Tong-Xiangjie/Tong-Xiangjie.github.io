// data/commemorative_coins.js
const coincommData = {
    name: "普通纪念币",
    icon: null,
    desc: "Circulating Commemorative Coin",
    detailFields: [
        { key: "country", label: "发行国家/地区" },
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "mint", label: "造币厂" },
        { key: "denomination", label: "面值" },
        { key: "material", label: "材质" },
        { key: "diameter", label: "直径" },
        { key: "weight", label: "重量" },
        { key: "edge", label: "边齿" },
        { key: "mintage", label: "发行量" },
        { key: "gradingCompany", label: "评级公司" },
        { key: "copyId", label: "评级证书编号" },
        { key: "grade", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "catalogNumber", label: "目录编号" }
    ],
    series: [
        // ==================== 建国35周年（5层） ====================
        {
            seriesName: "中华人民共和国成立三十五周年纪念币",
            year: 1984,
            varieties: [
                {
                    varietyName: "舞者欢庆",
                    copies: [
                        {
                            copyId: 89387685,
                            country: "中华人民共和国",
                            year: 1984,
                            issueDate: "1984年10月1日",
                            denomination: "1元",
                            mint: "上海造币厂",
                            material: "铜镍合金",
                            diameter: "30mm",
                            weight: "9.32g",
                            edge: "连续丝齿",
                            mintage: "879.3万",
                            grade: "MS67",
                            gradingCompany: "PCGS",
                            price: "198元",
                            purchaseDate: "2026年5月30日",
                            catalogNumber: "Sun-J2a1",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1984-jg1-1.png",
                            img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1984-jg1-2.png"
                        }
                    ]
                }
                // 可继续添加：金丝猴、白鳍豚、华南虎等
            ]
        },
        // ==================== 国际和平年（4层） ====================
        {
            seriesName: "国际和平年纪念币",
            year: 1986,
            copies: [
                {
                    copyId: 20912587,
                    country: "中华人民共和国",
                    year: 1986,
                    issueDate: "1986年9月20日",
                    denomination: "1元",
                    mint: "上海造币厂、沈阳造币厂",
                    material: "铜镍合金",
                    diameter: "30mm",
                    weight: "9.32g",
                    edge: "连续丝齿",
                    mintage: "2704.8万",
                    grade: "MS67",
                    gradingCompany: "ACG",
                    price: "69元",
                    purchaseDate: "2026年4月3日",
                    catalogNumber: "Sun-J6a",
                    remark: "该币的正面图案为中华人民共和国国名、国徽和1986年的年号；其背面图案为“和平”雕像、“和平”及“国际和平年”的中文主题文字和“壹圆”等字样，一个少女坐在一块石头上，回首伸臂召唤着身边栖息和飞翔的和平鸽，旁边是邓小平手书的行书“和平”二字，少女身上飘逸顺滑的长裙和身后刀劈斧削般的巨石形成的刚与柔、轻盈与凝重、粗砺与顺滑等强烈对比，极具美感。",
                    img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1986gjhpn1-1.jpg",
                    img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1986gjhpn1-2.jpg"
                }
            ]
        },
        // ==================== 内蒙古40周年 ====================
        {
            seriesName: "内蒙古自治区成立四十周年纪念币",
            year: 1987,
            copies: [
                {
                    copyId: 17389898,
                    country: "中华人民共和国",
                    year: 1987,
                    issueDate: "1987年7月30日",
                    denomination: "1元",
                    mint: "沈阳造币厂",
                    material: "铜镍合金",
                    diameter: "30mm",
                    weight: "9.3g",
                    edge: "连续丝齿",
                    mintage: "905.4万",
                    grade: "MS67",
                    gradingCompany: "ACG",
                    price: "60元",
                    purchaseDate: "2026年9月4日",
                    catalogNumber: "Sun-J7a",
                    remark: "内蒙古自治区成立于1947年5月1日，是我国最早设立的省级民族自治地方。该枚纪念币正面图案为内蒙古自治区人大常委会办公楼图景及“内蒙古自治区成立四十周年”字样，并刊国名、年号；背面图案为放牧图及“内蒙古自治区成立四十周年”的蒙古文字及“1947－1987”字样并刊面额。",
                    img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/17389898-1.jpg",
                    img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/17389898-2.jpg"
                }
            ]
        },
        // ==================== 建国40周年（4层） ====================
        {
            seriesName: "中华人民共和国成立四十周年纪念币",
            year: 1989,
            copies: [
                {
                    copyId: 20908817,
                    country: "中华人民共和国",
                    year: 1989,
                    issueDate: "1989年9月28日",
                    denomination: "1元",
                    mint: "上海造币厂",
                    material: "铜镍合金",
                    diameter: "30mm",
                    weight: "9.32g",
                    edge: "连续丝齿",
                    mintage: "2100万",
                    grade: "MS67",
                    gradingCompany: "ACG",
                    price: "74元",
                    purchaseDate: "2025年12月14日",
                    catalogNumber: "Sun-J14a",
                    remark: "",
                    img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1989gj40-1.jpg",
                    img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1989gj40-2.jpg"
                }
            ]
        },
        // ==================== 亚运会系列（5层，有多品种） ====================
        {
            seriesName: "第十一届亚洲运动会纪念币",
            year: 1990,
            varieties: [
                {
                    varietyName: "舞剑",
                    copies: [
                        {
                            copyId: 19065610,
                            country: "中华人民共和国",
                            year: 1990,
                            issueDate: "1990年8月22日",
                            denomination: "1元",
                            mint: "上海造币厂",
                            material: "钢芯镀镍",
                            diameter: "30mm",
                            weight: "8.5g",
                            edge: "",
                            mintage: "1280.4万",
                            grade: "MS67",
                            gradingCompany: "ACG",
                            price: "25元",
                            purchaseDate: "2026年9月4日",
                            catalogNumber: "Sun-J15a",
                            remark: "该套纪念币上首次使用英文。正面图案为中华人民共和国国名、第十一届亚运会会徽及北京工人体育场，背面图案为男舞剑运动员与吉祥物熊猫盼盼。",
                            img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/19065610-1.jpg",
                            img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/19065610-2.jpg"
                        }
                    ]
                },{
                    varietyName: "射箭",
                    copies: [
                        {
                            copyId: 19065585,
                            country: "中华人民共和国",
                            year: 1990,
                            issueDate: "1990年8月22日",
                            denomination: "1元",
                            mint: "上海造币厂",
                            material: "钢芯镀镍",
                            diameter: "30mm",
                            weight: "8.5g",
                            edge: "",
                            mintage: "1280.4万",
                            grade: "MS67",
                            gradingCompany: "ACG",
                            price: "25元",
                            purchaseDate: "2026年9月4日",
                            catalogNumber: "Sun-J16a",
                            remark: "该套纪念币上首次使用英文。正面图案为中华人民共和国国名、第十一届亚运会会徽及北京工人体育场，背面图案为女射箭运动员与吉祥物熊猫盼盼。",
                            img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/19065585-1.jpg",
                            img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/19065585-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 伟人系列（5层，有多品种） ====================
        {
            seriesName: "伟人系列纪念币",
            year: 1993,
            varieties: [
                {
                    varietyName: "朱德诞辰110周年",
                    copies: [
                        {
                            copyId: 15777876,
                            country: "中华人民共和国",
                            year: 1996,
                            issueDate: "1996年11月27日",
                            denomination: "1元",
                            mint: "",
                            material: "钢芯镀镍",
                            diameter: "25mm",
                            weight: "6.05g",
                            edge: "“ZHONGGUO”与三枚五角星滚字（共两组）",
                            mintage: "1000万",
                            grade: "MS66",
                            gradingCompany: "ACG",
                            price: "30元",
                            purchaseDate: "2026年8月26日",
                            catalogNumber: "",
                            remark: "正面主景为朱德故居并刊国名及年号，背面为朱德素描像及纪念字样。",
                            img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1996zd-1.jpg",
                            img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1996zd-2.jpg"
                        }
                    ]
                }
                // 可继续添加
            ]
        },
        // ==================== 珍稀动物系列（5层，有多品种） ====================
        {
            seriesName: "珍稀动物纪念币",
            year: 1993,
            varieties: [
                {
                    varietyName: "大熊猫",
                    copies: [
                        {
                            copyId: 21535931,
                            country: "中华人民共和国",
                            year: 1993,
                            issueDate: "1993年6月15日",
                            denomination: "5元",
                            mint: "沈阳造币厂",
                            material: "紫铜",
                            diameter: "32mm",
                            weight: "13.2g",
                            edge: "连续丝齿",
                            mintage: "600万",
                            grade: "MS67",
                            gradingCompany: "ACG",
                            price: "118元",
                            purchaseDate: "2025年12月16日",
                            catalogNumber: "Sun-J27b1",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1993panda-1.jpg",
                            img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1993panda-2.jpg"
                        }
                    ]
                }
                // 可继续添加：金丝猴、白鳍豚、华南虎等
            ]
        },
        // ==================== 抗战胜利50周年（4层） ====================
        {
            seriesName: "中国抗日战争和世界反法西斯战争胜利五十周年纪念币",
            year: 1995,
            copies: [
                {
                    copyId: 19128535,
                    country: "中华人民共和国",
                    year: 1995,
                    issueDate: "1995年8月31日",
                    denomination: "1元",
                    mint: "上海造币厂",
                    material: "钢芯镀镍",
                    diameter: "25mm",
                    weight: "6.05g",
                    edge: "“ZHONGGUO”与三枚五角星滚字（共两组）",
                    mintage: "1000万",
                    grade: "MS68",
                    gradingCompany: "ACG",
                    price: "33元",
                    purchaseDate: "2026年4月7日",
                    catalogNumber: "Sun-J31a",
                    remark: "",
                    img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1995fxs1-1.jpg",
                    img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/1995fxs1-2.jpg"
                }
            ]
        },
        // ==================== 迎接新世纪（4层） ====================
        {
            seriesName: "迎接新世纪纪念币",
            year: 2000,
            copies: [
                {
                    copyId: 86931613,
                    country: "中华人民共和国",
                    year: 2000,
                    issueDate: "2000年11月28日",
                    denomination: "10元",
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
                    catalogNumber: "Sun-J53a",
                    remark: "",
                    img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2000xsj1-1.jpg",
                    img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2000xsj1-2.jpg"
                }
            ]
        },
        // ==================== 世界文化遗产系列（5层，有多品种） ====================
        {
            seriesName: "世界文化遗产系列纪念币",
            year: 2022,
            varieties: [
                {
                    varietyName: "峨眉山-乐山大佛",
                    copies: [
                        {
                            copyId: 90152939,
                            country: "中华人民共和国",
                            year: 2023,
                            issueDate: "2023年4月7日",
                            denomination: "5元",
                            mint: "沈阳造币厂",
                            material: "铜合金",
                            diameter: "外接圆直径30mm",
                            weight: "11.56g",
                            edge: "交替丝齿",
                            mintage: "1.2亿",
                            grade: "MS69",
                            gradingCompany: "ACG",
                            price: "22.5元",
                            purchaseDate: "2026年4月8日",
                            catalogNumber: "Unlisted",
                            remark: "2022年1月21日，2022年普通纪念币发行计划发布，中国人民银行计划发行世界文化和自然遗产——峨眉山-乐山大佛普通纪念币。受疫情影响，该枚纪念币未能如期发行。2023年1月12日，2023年普通纪念币发行计划发布，世界文化和自然遗产——峨眉山-乐山大佛普通纪念币由2022年调整为2023年发布。纪念币正面所标注年号记为“2022”。",
                            img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2023emei-1.jpg",
                            img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2023emei-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "黄山",
                    copies: [
                        {
                            copyId: 90158034,
                            country: "中华人民共和国",
                            year: 2023,
                            issueDate: "2023年4月7日",
                            denomination: "5元",
                            mint: "沈阳造币厂",
                            material: "铜合金",
                            diameter: "外接圆直径30mm",
                            weight: "11.56g",
                            edge: "交替丝齿",
                            mintage: "1.2亿",
                            grade: "MS69",
                            gradingCompany: "ACG",
                            price: "22.5元",
                            purchaseDate: "2026年4月8日",
                            catalogNumber: "Unlisted",
                            remark: "2022年1月21日，2022年普通纪念币发行计划发布，中国人民银行计划发行世界文化和自然遗产——黄山普通纪念币。受疫情影响，该枚纪念币未能如期发行。2023年1月12日，2023年普通纪念币发行计划发布，世界文化和自然遗产——黄山普通纪念币由2022年调整为2023年发布。纪念币正面所标注年号记为“2022”。",
                            img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2023huangshan-1.jpg",
                            img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2023huangshan-2.jpg"
                        }
                    ]
                }
            ]
        },
        // ==================== 国家公园系列（5层，有多品种） ====================
        {
            seriesName: "国家公园系列纪念币",
            year: 2023,
            varieties: [
                {
                    varietyName: "三江源国家公园",
                    readme: {
                        title: "三江源国家公园纪念币发行公告",
                        content: "file:readmes/2023_sanjiangyuan_giantpanda_release.html"
                    },
                    copies: [
                        {
                            copyId: 90195487,
                            country: "中华人民共和国",
                            year: 2023,
                            issueDate: "2023年8月29日",
                            denomination: "10元",
                            mint: "沈阳造币厂",
                            material: "双金属",
                            diameter: "27mm",
                            weight: "9.2g",
                            edge: "交替丝齿",
                            mintage: "8000万",
                            grade: "MS69",
                            gradingCompany: "ACG",
                            price: "20元",
                            purchaseDate: "2026年4月8日",
                            catalogNumber: "Unlisted",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2023sanjiangyuan-1.jpg",
                            img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2023sanjiangyuan-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "大熊猫国家公园",
                    readme: {
                        title: "大熊猫国家公园纪念币发行公告",
                        content: "file:readmes/2023_sanjiangyuan_giantpanda_release.html"
                    },
                    copies: [
                        {
                            copyId: 90185483,
                            country: "中华人民共和国",
                            year: 2023,
                            issueDate: "2023年8月29日",
                            denomination: "10元",
                            mint: "沈阳造币厂",
                            material: "双金属",
                            diameter: "27mm",
                            weight: "9.2g",
                            edge: "交替丝齿",
                            mintage: "8000万",
                            grade: "MS69",
                            gradingCompany: "ACG",
                            price: "20元",
                            purchaseDate: "2026年4月8日",
                            catalogNumber: "Unlisted",
                            remark: "",
                            img1: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2023pandaNP-1.jpg",
                            img2: "https://tong-xiangjie.github.io/coincollection/image/commemorative/2023pandaNP-2.jpg"
                        }
                    ]
                },
                {
                    varietyName: "东北虎豹国家公园",
                    readme: {
                        title: "东北虎豹国家公园纪念币发行公告",
                        content: "file:readmes/2024_northeast_tiger_leopard_release.html"
                    },
                    copies: []
                },
                {
                    varietyName: "海南热带雨林国家公园",
                    readme: {
                        title: "海南热带雨林国家公园纪念币发行公告",
                        content: "file:readmes/2025_hainan_rainforest_release.html"
                    },
                    copies: []
                },
                {
                    varietyName: "武夷山国家公园",
                    readme: {
                        title: "武夷山国家公园纪念币发行公告",
                        content: "file:readmes/2026_wuyishan_release.html"
                    },
                    copies: []
                }
            ]
        }
    ]
};
