// ==================== 方寸山河数据（样例） ====================
// province 必须填 SVG 地图里的拼音 class（如 hunan / guangdong）
// scene/denom/year 为示例，请替换为真实纸币主景；img 为占位路径，请填真实图片 URL
const shanheScenes = [
    // ===== 安徽 =====
    { province: 'anhui',      city: '安庆（皖H）', scene: '振风塔', denom: '中央银行金圆券1角', year: 1946, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/aqzft-1946.jpg' },
    { province: 'anhui',      city: '黄山（皖J）', scene: '黄山', denom: '外汇兑换券5元', year: 1979, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hs-fec5.jpg' },

    // ===== 澳门 =====
    { province: 'aomen',     city: '风顺堂区', scene: '妈祖阁', denom: '中国银行澳门币10元', year: "2008/2013", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/mzg-am20.jpg' },
    { province: 'aomen',     city: '大堂区', scene: '澳门科学馆', denom: '中国银行澳门元20元', year: 2020, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/amkxg-am20.jpg' },
    { province: 'aomen',     city: '大堂区', scene: '镜湖医院历史纪念馆', denom: '中国银行澳门元50元', year: 2020, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/jhyy-am50.jpg' },

    // ===== 北京 =====
    { province: 'beijing',   city: '朝阳区', scene: '国家体育场（鸟巢）', denom: '奥运纪念钞', year: 2008, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/nc-2008ay.jpg' },
    { province: 'beijing',   city: '朝阳区', scene: '国家速滑馆（冰丝带）', denom: '冬奥纪念钞（澳门）', year: 2022, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/bsd-2022am.jpg' },
    { province: 'beijing',   city: '朝阳区', scene: '国家游泳中心（冰立方）', denom: '冬奥纪念钞（冰上运动）', year: 2022, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/blf-2022bsyd.jpg' },
    { province: 'beijing',   city: '海淀区', scene: '中华世纪坛', denom: '迎接新世纪纪念钞', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zhsjt-2000.jpg' },
    { province: 'beijing',   city: '西城区', scene: '人民大会堂', denom: '第五套人民币100元', year: "1999/2005", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/rmdht-99100.jpg' },
    { province: 'beijing',   city: '西城区', scene: '人民大会堂', denom: '第五套人民币100元', year: 2015, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/rmdht-15100.jpg' },
    { province: 'beijing',   city: '西城区', scene: '中国人民银行总部大楼', denom: '人民币发行70周年纪念钞', year: 2018, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zgrmyh-2018.jpg' },
    { province: 'beijing',   city: '东城区', scene: '天坛祈年殿', denom: '中国银行法币10元', year: 1940, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/tt-zgyh1940-10.jpg' },
    { province: 'beijing',   city: '东城区', scene: '天坛祈年殿', denom: '外汇兑换券5角', year: 1979, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/tt-fec05.jpg' },
    { province: 'beijing',   city: '延庆区', scene: '万里长城', denom: '外汇兑换券100元', year: 1979, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/cc-fec100.jpg' },
    { province: 'beijing',   city: '延庆区', scene: '万里长城', denom: '第四套人民币1元', year: "1980/1990/1996", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/cc-961.jpg' },

    // ===== 重庆 =====
    { province: 'chongqing', city: '奉节县', scene: '长江三峡-夔门', denom: '外汇兑换券10元', year: 1979, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/sx-fec10.jpg' },
    { province: 'chongqing', city: '奉节县', scene: '长江三峡-夔门', denom: '第五套人民币10元', year: "1999/2005", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/sx-9910.jpg' },
    { province: 'chongqing', city: '奉节县', scene: '长江三峡-夔门', denom: '第五套人民币10元', year: 2019, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/sx-1910.jpg' },

    // ===== 福建 =====
    { province: 'fujian',    city: '莆田市（闽B）', scene: '东圳水库', denom: '地方经济建设公债1元', year: 1960, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/dzsk-1960-1.jpg' },

    // ===== 广东 =====
    { province: 'guangdong',   city: '广州（粤A）', scene: '广州中山纪念堂', denom: '广东省银行大洋票1角', year: 1949, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsjnt-dyp01.jpg' },
    { province: 'guangdong',   city: '广州（粤A）', scene: '广州中山纪念堂', denom: '广东省银行大洋票5角', year: 1949, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsjnt-dyp05.jpg' },
    { province: 'guangdong',   city: '广州（粤A）', scene: '广州中山纪念堂', denom: '广东省银行大洋票1元', year: 1949, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsjnt-dyp1.jpg' },
    { province: 'guangdong',   city: '广州（粤A）', scene: '广州中山纪念堂', denom: '广东省银行大洋票5元', year: 1949, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsjnt-dyp5.jpg' },
    { province: 'guangdong',   city: '广州（粤A）', scene: '广州中山纪念堂', denom: '广东省银行大洋票10元', year: 1949, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsjnt-dyp10.jpg' },
    { province: 'guangdong',   city: '广州（粤A）', scene: '广州中山纪念堂', denom: '广东省银行大洋票100元', year: 1949, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsjnt-dyp100.jpg' },
    { province: 'guangdong',   city: '深圳（粤B）', scene: '深圳火车站', denom: '国库券100元（三年期）', year: 1993, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/szhcz-100-3.jpg' },

    // ===== 广西 =====
    { province: 'guangxi',   city: '桂林（桂C）', scene: '象鼻山', denom: '外汇兑换券50元', year: 1979, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xbs-fec50.jpg' },
    { province: 'guangxi',   city: '桂林（桂C）', scene: '桂林山水', denom: '国库券100元', year: 1991, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/glss-100.jpg' },

    // ===== 贵州 =====
    { province: 'guizhou',   city: '贵阳（贵A）', scene: '贵州省银行旧址', denom: '贵州省银行银元辅币券1分', year: 1949, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/gzsyh-1949-001.jpg' },
    { province: 'guizhou',   city: '安顺（贵G）', scene: '黄果树瀑布', denom: '外汇兑换券1角', year: 1979, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hgspb-fec01.jpg' },

    // ===== 河北 =====
    { province: 'hebei',     city: '秦皇岛（冀C）', scene: '山海关', denom: '中央银行东北九省流通券100元', year: 1945, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/shg-dbjs100.jpg' },
    { province: 'hebei',     city: '张家口（冀G）', scene: '国家跳台滑雪中心（雪如意）', denom: '冬奥纪念钞（雪上运动）', year: 2022, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xry-2022xsyd.jpg' },

    // ===== 湖北 =====
    { province: 'hubei',     city: '武汉（鄂A）', scene: '黄鹤楼', denom: '中央银行法币券5元', year: 1936, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zyyh-hhl-5.jpg', remark: "另有说法认为图中是湖南岳阳楼或现已损毁的重庆（原四川万县）钟鼓楼（望江楼）。" },

    // ===== 吉林 =====
    { province: 'jilin',   city: '吉林（吉B）', scene: '丰满水电站', denom: '第二套人民币5角', year: 1953, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/fmsdz-1953-05.jpg', remark: "币面上为老坝，于2018年12月开始爆破拆除，现仅遗留有老坝左右岸各一段坝体作为历史遗迹永久矗立在原址。" },
    
    // ===== 江苏 =====
    { province: 'jiangsu',   city: '南京（苏A）', scene: '中山陵', denom: '中央储备银行国币1角', year: 1940, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/njzsl-1940-01.jpg' },
    { province: 'jiangsu',   city: '南京（苏A）', scene: '中山陵', denom: '中央储备银行国币10元', year: 1940, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/njzsl-1940-10.jpg' },
    { province: 'jiangsu',   city: '南京（苏A）', scene: '中山陵', denom: '中央储备银行国币1元', year: 1943, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/njzsl-1943-1.jpg' },

    // ===== 江西 =====
    { province: 'jiangxi',   city: '吉安（赣D）', scene: '井冈山', denom: '第四套人民币100元', year: "1980/1990", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/jgs-90100.jpg' },

    // ===== 山西 =====
    { province: 'shanxi',    city: '临汾（晋L）', scene: '壶口瀑布-东岸', denom: '第四套人民币50元', year: "1980/1990", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hkpb-9050.jpg' },

    // ===== 陕西 =====
    { province: 'shanxiHZ',  city: '延安（陕J）', scene: '壶口瀑布-西岸', denom: '第四套人民币50元', year: "1980/1990", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/hkpb-9050.jpg' },

    // ===== 台湾 =====
    { province: 'taiwan',    city: '台北', scene: '台北总统府', denom: '台湾省10元', year: 1960, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/ztf-1960-10.jpg' },
    { province: 'taiwan',    city: '台北', scene: '阳明山中山楼', denom: '台湾省10元', year: 1969, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsl-1969-10.jpg' },
    { province: 'taiwan',    city: '台北', scene: '阳明山中山楼', denom: '台湾省50元', year: 1970, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsl-1970-50.jpg' },
    { province: 'taiwan',    city: '台北', scene: '阳明山中山楼', denom: '台湾省100元', year: 2000, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsl-5-100.jpg' },
    { province: 'taiwan',    city: '台北', scene: '阳明山中山楼', denom: '台湾省50元', year: 1972, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsl-1972-50.jpg' },
    { province: 'taiwan',    city: '台北', scene: '台湾中央银行大楼', denom: '新台币发行50周年纪念钞', year: 1999, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zyyh-1999.jpg' },
    { province: 'taiwan',    city: '花莲县', scene: '象鼻隧道', denom: '台湾省1元', year: 1961, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xbsd-1961-1.jpg', remark: "象鼻隧道位于旧苏花公路（台9丁线）的姑姑子断崖上，属于清水断崖的最北段，行政区划上隶属于花莲县秀林乡。该路段因1971年和平隧道开通后废弃，现属高风险区域。" },
    { province: 'taiwan',    city: '云林县', scene: '北港净水厂', denom: '台湾省5元', year: 1961, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/bgjsc-1961-5.jpg', remark: "准确来说是云林县北港镇自来水厂（北港净水厂）水塔建筑。"},
    { province: 'taiwan',    city: '云林县-彰化县', scene: '西螺大桥（浊水溪大桥）', denom: '台湾省10元', year: 1960, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xldq-1960-10.jpg' },


    // ===== 西藏 =====
    { province: 'xizang',    city: '拉萨（藏A）', scene: '布达拉宫', denom: '第五套人民币50元', year: "1999/2005", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/bdlg-0550.jpg' },
    { province: 'xizang',    city: '日喀则（藏D）', scene: '珠穆朗玛峰', denom: '第四套人民币10元', year: 1980, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zmlmf-8010.jpg' },

    // ===== 山东 =====
    { province: 'shandong',  city: '济宁（鲁H）', scene: '杏坛', denom: '中央银行兑换券1角', year: 1931, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xt-zyyh01.jpg' },
    { province: 'shandong',  city: '济宁（鲁H）', scene: '洙水桥', denom: '中央银行兑换券2角', year: 1931, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zsq-zyyh02.jpg' },
    { province: 'shandong',  city: '泰安（鲁J）', scene: '泰山', denom: '第五套人民币5元', year: 2020, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/ts-205.jpg' },

    // ===== 上海 =====
    { province: 'shanghai',  city: '黄浦区', scene: '上海中国银行总行大厦', denom: '中国银行法币10元', year: 1937, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/zgyhdl-1937-10.jpg' },

    // ===== 云南 =====
    { province: 'yunnan',    city: '昆明（云A）', scene: '云南石林', denom: '国库券10元', year: 1991, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/ynsl-10.jpg' },

    // ===== 浙江 =====
    { province: 'zhejiang',  city: '杭州（浙A）', scene: '西湖-三潭印月', denom: '外汇兑换券1元', year: 1979, img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xh-fec1.jpg' },
    { province: 'zhejiang',  city: '杭州（浙A）', scene: '西湖-三潭印月', denom: '第五套人民币1元', year: "1999/2019", img: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/shanhe/images/xh-191.jpg' }
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
    slogan: '一枚纸币，千里江山',
    dataKey: 'shanheData',
    view: 'map',
    mapFile: 'china_map.svg',
    categories: []
};
