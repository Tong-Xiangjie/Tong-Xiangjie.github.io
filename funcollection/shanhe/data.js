// 方寸山河数据：一条 = 一张纸币上的一个主景
const shanheScenes = [
     { province: 'hunan', provinceName: '湖南', city: '长沙', plate: '湘A',
      scene: '橘子洲头', denom: '20元', year: 1999, img: 'https://cdn.jsdelivr.net/gh/.../funcollection/shanhe/images/xxx.jpg' },
];

// 省份拼音 → 中文（用于地图悬停提示和页面标题）
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
    slogan: '方寸纸币，山河万里。',
    dataKey: 'shanheData',
    view: 'map',            // ★ 地图交互模式
    mapFile: 'china_map.svg',
    categories: []
};
