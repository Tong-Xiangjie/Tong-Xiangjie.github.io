// special-bridge.js
// 直接定义专题配置数组，不依赖外部变量
window.SPECIAL_CONFIGS = [
    {
        id: 'years',
        name: '年份图鉴',
        slogan: '岁月如梭，纸币如歌',
        dataKey: 'yearsData',
        dataFile: '../funcollection/years/data.js',
        dataVar: 'banknoteYears',
        groupBy: 'year'
    },
    {
        id: 'denom',
        name: '面额大观',
        slogan: '元角分厘，方寸之间',
        dataKey: 'denomData',
        dataFile: '../funcollection/denom/data.js',
        dataVar: 'denomItems',
        groupBy: 'denom'
    },
    {
        id: 'shanhe',
        name: '方寸山河',
        slogan: '一枚纸币，千里江山',
        dataKey: 'shanheData',
        dataFile: '../funcollection/shanhe/data.js',
        dataVar: 'shanheScenes',
        view: 'map',
        mapFile: 'china_map.svg'
    }
];