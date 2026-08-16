// ==================== 方寸山河数据（样例） ====================
// province 必须填 SVG 地图里的拼音 class（如 hunan / guangdong）
// scene/denom/year 为示例，请替换为真实纸币主景；img 为占位路径，请填真实图片 URL
const shanheScenes = [
    // ===== 直辖市 =====
    { province: 'beijing',   city: '北京', scene: '人民大会堂', denom: '100元', year: 1999, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/beijing-1.jpg' },
    { province: 'beijing',   city: '北京', scene: '天坛祈年殿', denom: '外汇券1元', year: 1988, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/beijing-2.jpg' },
    { province: 'tianjin',   city: '天津', scene: '海河解放桥', denom: '20元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/tianjin-1.jpg' },
    { province: 'shanghai',  city: '上海', scene: '外滩万国建筑', denom: '50元', year: 1980, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/shanghai-1.jpg' },
    { province: 'chongqing', city: '重庆', scene: '瞿塘峡', denom: '10元', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/chongqing-1.jpg' },

    // ===== 华北 =====
    { province: 'hebei',     city: '张家口', scene: '长城', denom: '1元', year: 1980, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hebei-1.jpg' },
    { province: 'shanxi',    city: '大同', scene: '云冈石窟', denom: '5元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/shanxi-1.jpg' },
    { province: 'neimenggu', city: '呼伦贝尔', scene: '呼伦贝尔草原', denom: '10元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/neimenggu-1.jpg' },

    // ===== 东北 =====
    { province: 'liaoning',  city: '沈阳', scene: '沈阳故宫', denom: '50元', year: 1980, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/liaoning-1.jpg' },
    { province: 'jilin',     city: '延边', scene: '长白山天池', denom: '5元', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/jilin-1.jpg' },
    { province: 'heilongjiang', city: '哈尔滨', scene: '圣索菲亚教堂', denom: '20元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/heilongjiang-1.jpg' },

    // ===== 华东 =====
    { province: 'jiangsu',   city: '南京', scene: '南京长江大桥', denom: '1元', year: 1972, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/jiangsu-1.jpg' },
    { province: 'zhejiang',  city: '杭州', scene: '西湖三潭印月', denom: '1元', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zhejiang-1.jpg' },
    { province: 'anhui',     city: '黄山', scene: '黄山迎客松', denom: '外汇券10元', year: 1988, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/anhui-1.jpg' },
    { province: 'fujian',    city: '武夷山', scene: '武夷山玉女峰', denom: '20元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/fujian-1.jpg' },
    { province: 'jiangxi',   city: '吉安', scene: '井冈山', denom: '1角', year: 1980, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/jiangxi-1.jpg' },
    { province: 'shandong',  city: '泰安', scene: '泰山', denom: '5元', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/shandong-1.jpg' },

    // ===== 华中 =====
    { province: 'henan',     city: '洛阳', scene: '龙门石窟', denom: '10元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/henan-1.jpg' },
    { province: 'hubei',     city: '宜昌', scene: '长江三峡', denom: '10元', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hubei-1.jpg' },
    { province: 'hunan',     city: '岳阳', scene: '岳阳楼', denom: '20元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hunan-1.jpg' },

    // ===== 华南 =====
    { province: 'guangdong', city: '广州', scene: '珠江新城', denom: '10元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/guangdong-1.jpg' },
    { province: 'guangxi',   city: '桂林', scene: '桂林山水', denom: '20元', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/guangxi-1.jpg' },
    { province: 'guangxi',   city: '桂林', scene: '漓江渔火', denom: '外汇券5元', year: 1988, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/guangxi-2.jpg' },
    { province: 'hainan',    city: '三亚', scene: '南天一柱', denom: '2角', year: 1980, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hainan-1.jpg' },

    // ===== 西南 =====
    { province: 'sichuan',   city: '乐山', scene: '乐山大佛', denom: '5元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/sichuan-1.jpg' },
    { province: 'guizhou',   city: '安顺', scene: '黄果树瀑布', denom: '20元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/guizhou-1.jpg' },
    { province: 'xizang',    city: '拉萨', scene: '布达拉宫', denom: '50元', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xizang-1.jpg' },

    // ===== 西北 =====
    { province: 'shanxiHZ',  city: '延安', scene: '延安宝塔山', denom: '1元', year: 1953, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/shanxiHZ-1.jpg' },
    { province: 'shanxiHZ',  city: '西安', scene: '大雁塔', denom: '外汇券2元', year: 1988, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/shanxiHZ-2.jpg' },
    { province: 'gansu',     city: '敦煌', scene: '敦煌莫高窟', denom: '10元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/gansu-1.jpg' },
    { province: 'qinghai',   city: '西宁', scene: '青海湖', denom: '5元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/qinghai-1.jpg' },
    { province: 'ningxia',   city: '中卫', scene: '沙坡头', denom: '1元', year: 2005, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/ningxia-1.jpg' },
    { province: 'xinjiang',  city: '伊犁', scene: '天山牧场', denom: '1元', year: 1962, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xinjiang-1.jpg' },

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
