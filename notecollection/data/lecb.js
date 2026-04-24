// data/lecb.js
const lecbData = {
    name: "地方经济建设公债",
    icon: null,
    desc: "Local Economic Construction Bonds",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行部门" },
        { key: "year", label: "发行年份" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "克劳斯目录编号" }
    ],

    series: [
        // ==================== 四川省 ====================
        {
            seriesName: "四川省",
            year: "1959",
            varieties: [
                {
                    varietyName: "1959年",
                    varieties: [
                        {
                            varietyName: "1元",
                            copies: [
                                {
                                    copyId: 1,
                                    year: 1959,
                                    version: "ⅠⅡⅢ00000000",
                                    bank: "四川省人民委员会",
                                    condition: "未评级",
                                    price: "裸票85元",
                                    purchaseDate: "2026年4月24日",
                                    krause: "Unlisted",
                                    remark: "",
                                    img1: "image/lecb/ⅠⅡⅢ00000000-1.jpg",
                                    img2: "image/lecb/ⅠⅡⅢ00000000-2.jpg"
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
};
