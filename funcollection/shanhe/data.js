// ==================== 方寸山河数据（样例） ====================
// province 必须填 SVG 地图里的拼音 class（如 hunan / guangdong）
// scene/denom/year 为示例，请替换为真实纸币主景；img 为占位路径，请填真实图片 URL
const shanheScenes = [
    // ===== 直辖市 =====
    { province: 'beijing',   city: '朝阳区', scene: '国家体育场（鸟巢）', denom: '奥运纪念钞', year: 2008, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/beijing-1.jpg' },
    { province: 'beijing',   city: '朝阳区', scene: '国家速滑馆（冰丝带）', denom: '冬奥纪念钞（澳门）', year: 2022, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/beijing-2.jpg' },
    { province: 'beijing',   city: '朝阳区', scene: '国家游泳中心（冰立方）', denom: '冬奥纪念钞（冰上运动）', year: 2022, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/beijing-2.jpg' },
    { province: 'beijing',   city: '海淀区', scene: '中华世纪坛', denom: '迎接新世纪纪念钞', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/beijing-2.jpg' },
    { province: 'beijing',   city: '西城区', scene: '中国人民银行总部', denom: '人民币发行70周年纪念钞', year: 2018, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/beijing-2.jpg' },

    // ===== 华北 =====
    { province: 'hebei',     city: '秦皇岛（冀C）', scene: '山海关', denom: '东北九省流通券100元', year: 1945, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hebei-1.jpg' },
    { province: 'hebei',     city: '张家口（冀G）', scene: '国家跳台滑雪中心（雪如意）', denom: '冬奥纪念钞（雪上运动）', year: 2022, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hebei-1.jpg' },
    { province: 'shandong',  city: '济宁（鲁H）', scene: '杏坛', denom: '中央银行1角', year: 1931, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hebei-1.jpg' },
    { province: 'shandong',  city: '济宁（鲁H）', scene: '洙水桥', denom: '中央银行2角', year: 1931, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hebei-1.jpg' },
    

    // ===== 东北 =====
    

    // ===== 华东 =====
    { province: 'jiangxi',   city: '吉安（赣D）', scene: '井冈山', denom: '第四套人民币100元', year: "1980/1990", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/jiangxi-1.jpg' },

    // ===== 华中 =====


    // ===== 华南 =====

    { province: 'guangxi',   city: '桂林（桂C）', scene: '象鼻山', denom: '外汇兑换券50元', year: 1979, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/guangxi-1.jpg' },


    // ===== 西南 =====
    { province: 'guizhou',   city: '安顺（贵G）', scene: '黄果树瀑布', denom: '外汇兑换券1角', year: 1979, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/guizhou-1.jpg' },
    { province: 'xizang',    city: '拉萨（藏A）', scene: '布达拉宫', denom: '第五套人民币50元', year: "1999/2005", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xizang-1.jpg' },

    // ===== 西北 =====


    // ===== 港澳台 =====
    { province: 'xianggang', city: '香港', scene: '维多利亚港', denom: '港币20元', year: 2003, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xianggang-1.jpg' },
    { province: 'xianggang', city: '香港', scene: '中银大厦', denom: '港币100元', year: 2010, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xianggang-2.jpg' },
    { province: 'aomen',     city: '澳门', scene: '大三巴牌坊', denom: '澳门币10元', year: 1996, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/aomen-1.jpg' },
    { province: 'aomen',     city: '澳门', scene: '妈阁庙', denom: '澳门币20元', year: 2003, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/aomen-2.jpg' },
    { province: 'taiwan',    city: '台北', scene: '阿里山', denom: '新台币100元', year: 2001, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/taiwan-1.jpg' }
];

// 省份拼音 → 中文简称（地图标注用）
window.SHANHE_PROVINCE_NAMES = {
    jiangxi: '江西', xianggang: '香港', shanghai: '上海', heilongjiang: '黑龙江',
    hubei: '湖北', shandong: '山东', anhui: '安徽', shanxi: '山西', jilin: '吉林',
    hunan: '湖南', jiangsu: '江苏', fujian: '福建', henan: '河南', liaoning: '辽宁',
    zhejiang: '浙江', guangdong: '广东', tianjin: '天津', beijing: '北京', hebei: '河北',
    neimenggu: '内蒙古', shanxiHZ: '陕西', chongqing: '重庆', guangxi: '广西',
    yunnan: '云南', qinghai: '青海', xizang: '西藏', xinjiang: '新疆', ningxia: '宁夏',
    gansu: '甘肃', sichuan: '四川', guizhou: '贵州', aomen: '澳门', taiwan: '台湾', hainan: '海南'
};

// 专题元信息
const specialShanheMeta = {
    id: 'shanhe',
    name: '方寸山河',
    slogan: '方寸纸币，山河万里',
    dataKey: 'shanheData',
    view: 'map',
    mapFile: 'china_map.svg',
    categories: []
};
