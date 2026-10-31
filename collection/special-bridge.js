// special-bridge.js
// 直接定义专题配置数组，不依赖外部变量
window.SPECIAL_CONFIGS = [
    {
        id: 'years',
        name: '年份图鉴',
        slogan: '一钞一年号，一纸一春秋',
        dataKey: 'yearsData',
        dataFile: '../funcollection/years/data.js',
        dataVar: 'banknoteYears',
        groupBy: 'year'
    },
    {
        id: 'denom',
        name: '面额大观',
        slogan: '元角分厘，各载风华',
        dataKey: 'denomData',
        dataFile: '../funcollection/denom/data.js',
        dataVar: 'denomItems',
        groupBy: 'denom'
    },
    {
        id: 'shanhe',
        name: '方寸山河',
        slogan: '方寸纸币，山河万里',
        dataKey: 'shanheData',
        dataFile: '../funcollection/shanhe/data.js',
        dataVar: 'shanheScenes',
        view: 'map',
        mapFile: 'china_map.svg'
    },
    // ===== 新增：币海拾年 · 时间轴 =====
    {
        id: 'timeline',
        name: '币海拾年',
        slogan: '集藏历岁，鉴物观心',
        view: 'timeline'
    },
    // ===== 新增：泉行纪胜 · 活动中得到的赠品 =====
    //   外层是"活动赠品"这个大类；里面的每一次活动（如 2026 北京国际钱币博览会）
    //   作为**内层一层**列在侧边栏里，**不再**按门票/纸币/邮票细分子类（用户口径）；
    //   右侧列表照旧按数据里的 group 分组显示。
    //   每一件都有唯一 copyId（号段 26BICExx）；将来录进正式藏品时照抄同一个
    //   copyId ⇒ 全站认作同一件，不会重复计数（见 funcollection/expo2026/data.js 头注）。
    {
        id: 'expo2026',
        name: '泉行纪胜',
        slogan: '踏会寻珍，以币留痕',
        dataKey: 'expo2026Data',
        dataFile: '../funcollection/expo2026/data.js',
        dataVar: 'expo2026Items',
        groupBy: 'group',              // 选中某次活动后，右侧按它分组（右边不变）
        // ★ 侧边栏列"每一次活动"：数据里每条写 event: "2026年第30届北京国际钱币博览会"，
        //   将来别的会就自动多一条（不会混到一起）。没写 event 时退回下面那条 singleGroupName。
        eventField: 'event',
        singleGroupName: '2026年第30届北京国际钱币博览会',   // 兼容：数据还没写 event 时的唯一一条
        itemStyle: 'overview',     // ★ 内部用"纸币/硬币概览页"那套条目 UI
        // ★ 详情卡片的字段表放在**数据文件里**（用户口径）：
        //   funcollection/expo2026/data.js 末尾的 expo2026Meta.detailFields。
        //   这里只声明变量名；解析逻辑见 special.js 的 specialDetailFields()。
        detailFieldsVar: 'expo2026Meta'
    }
];