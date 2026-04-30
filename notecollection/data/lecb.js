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
        // ==================== 四川省 1959年 ====================
        {
            seriesName: "四川省 1959年",
            year: "1959",
            // 新增 readme：显示在品种列表页（与各个面额并列，在上方）
            readme: {
                title: "四川省一九五九年地方经济建设公债发行办法",
                content: "file:readmes/lecb_sichuan_1959_ordinance.txt"
            },
            varieties: [
                {
                    varietyName: "1元",
                    copies: [
                        {
                            copyId: 1,
                            year: 1959,
                            version: "ⅠⅡⅢ06173849",
                            bank: "四川省人民委员会",
                            condition: "未评级",
                            price: "裸票85元",
                            purchaseDate: "2026年4月24日",
                            krause: "Unlisted",
                            remark: "",
                            img1: "image/lecb/ⅠⅡⅢ06173849-1.jpg",
                            img2: "image/lecb/ⅠⅡⅢ06173849-2.jpg"
                        }
                    ]
                }
                // 可继续添加：2元、5元、10元、50元等面值
            ]
        }
        // 可继续添加：其他省份或年份，如四川省1960年、北京市1959年等
    ]
};
