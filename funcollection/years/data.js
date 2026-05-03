// 年份图鉴数据
// 每张纸币只需要：年份、名称、克劳斯编号、年份实拍图路径
const banknoteYears = [

    // ==================== 外汇兑换券 1979 ====================
    { year: 1979, name: "外汇兑换券 1角", krause: "FX1a/b", yearImg: "images/1979-fec01.jpg" },
    { year: 1979, name: "外汇兑换券 5角", krause: "FX2", yearImg: "images/1979-fec05.jpg" },
    { year: 1979, name: "外汇兑换券 1元", krause: "FX3", yearImg: "images/1979-fec1.jpg" },
    { year: 1979, name: "外汇兑换券 5元", krause: "FX4", yearImg: "images/1979-fec5.jpg" },
    { year: 1979, name: "外汇兑换券 10元", krause: "FX5", yearImg: "images/1979-fec10.jpg" },
    { year: 1979, name: "外汇兑换券 50元", krause: "FX6", yearImg: "images/1979-fec50.jpg" },
    { year: 1979, name: "外汇兑换券 100元", krause: "FX7", yearImg: "images/1979-fec100.jpg" },

    // ==================== 第二套人民币 1953 ====================
    { year: 1953, name: "第二套人民币 1分", krause: "Pick# 860a/b/c", yearImg: "images/1953-001.jpg" },
    { year: 1953, name: "第二套人民币 2分", krause: "Pick# 861a/b/c", yearImg: "images/1953-002.jpg" },
    { year: 1953, name: "第二套人民币 5分", krause: "Pick# 862a/b/c", yearImg: "images/1953-005.jpg" },

    // ==================== 第三套人民币 ====================
    { year: 1962, name: "第三套人民币 1角", krause: "Pick# 877", yearImg: "images/1962-01.jpg" },
    { year: 1962, name: "第三套人民币 2角", krause: "Pick# 878", yearImg: "images/1962-02.jpg" },
    { year: 1972, name: "第三套人民币 5角", krause: "Pick# 879", yearImg: "images/1972-05.jpg" },
    { year: 1960, name: "第三套人民币 1元", krause: "Pick# 880", yearImg: "images/1960-1.jpg" },

    // ==================== 纪念钞 ====================
    { year: 1999, name: "庆祝中华人民共和国成立50周年纪念钞", krause: "Pick# 891", yearImg: "images/1999-jg.jpg" },
    { year: 2000, name: "迎接新世纪纪念钞", krause: "Pick# 902", yearImg: "images/2000-xsj.jpg" },
    { year: 2008, name: "第29届奥林匹克运动会纪念钞", krause: "Pick# 908", yearImg: "images/2008-ay.jpg" },
    { year: 2000, name: "航天纪念钞", krause: "Pick# 910a", yearImg: "images/2015-ht.jpg" },
    { year: 2000, name: "人民币发行70周年纪念钞", krause: "Pick# 911", yearImg: "images/2018-rmb70.jpg" },
    { year: 2024, name: "龙年贺岁纪念钞", krause: "Pick# 920", yearImg: "images/2024-long.jpg" },
    { year: 2025, name: "蛇年贺岁纪念钞", krause: "Pick# 921", yearImg: "images/2025-she.jpg" },
    { year: 2026, name: "马年贺岁纪念钞", krause: "Pick# 922", yearImg: "images/2026-ma.jpg" },

    // ==================== 乌克兰战争纪念钞 ====================
    { year: 2023, name: "俄乌战争一周年纪念钞", krause: "Pick# 133", yearImg: "images/2023-wkl.jpg" },
    { year: 2024, name: "俄乌战争二周年纪念钞", krause: "Pick# 134", yearImg: "images/2024-wkl.jpg" },

    // ==================== 国库券 ====================    
    { year: 1982, name: "1982年国库券 1元", krause: "Pick# Unlisted", yearImg: "images/1982-gkq1y.jpg" },

    // ==================== 民国纸币 ====================
    // 交通银行 1914年
    { year: 1914, name: "交通银行 5元", krause: "Pick# 117", yearImg: "images/1914-jtyh5y.jpg" },
    { year: 1914, name: "交通银行 10元", krause: "Pick# 118", yearImg: "images/1914-jtyh10y.jpg" },

    // 中国银行 1937年
    { year: 1937, name: "中国银行 10元", krause: "Pick# 81", yearImg: "images/1937-zgyh10y.jpg" },

    // 中央银行 1941年
    { year: 1941, name: "中央银行 10元", krause: "Pick# -", yearImg: "images/1941-zyyh10.jpg" },
    { year: 1941, name: "中央银行 100元", krause: "Pick# -", yearImg: "images/1941-zyyh100.jpg" },

    // 大洋票 1949年（全套）
    { year: 1949, name: "大洋票 1角", krause: "Pick# S2454", yearImg: "images/1949-dyp01.jpg" },
    { year: 1949, name: "大洋票 5角", krause: "Pick# S2455", yearImg: "images/1949-dyp05.jpg" }, 
    { year: 1949, name: "大洋票 1元", krause: "Pick# S2456", yearImg: "images/1949-dyp1.jpg" }, 
    { year: 1949, name: "大洋票 5元", krause: "Pick# S2457", yearImg: "images/1949-dyp5.jpg" },
    { year: 1949, name: "大洋票 10元", krause: "Pick# S2458", yearImg: "images/1949-dyp10.jpg" },
    { year: 1949, name: "大洋票 100元", krause: "Pick# S2459", yearImg: "images/1949-dyp100.jpg" } 
];
