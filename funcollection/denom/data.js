// ==================== funcollection/denom/data.js ====================
// 面额大观数据

const denomItems = [
    { year: 2024, denom: '1元', name: '2024年一元纪念币', krause: 'KM# 123', yearImg: 'image/denom/1yuan.jpg' },
    { year: 2024, denom: '½元', name: '2024年五角纪念币', krause: 'KM# 124', yearImg: 'image/denom/5jiao.jpg' },
    { year: 2023, denom: '1角', name: '2023年一角纪念币', krause: 'KM# 101', yearImg: 'image/denom/1jiao.jpg' },
    { year: 2023, denom: '1元', name: '2023年一元纪念币', krause: 'KM# 102', yearImg: 'image/denom/1yuan_2023.jpg' },
    { year: 2024, denom: '5万元', name: '2024年五万元纪念币', krause: 'KM# 125', yearImg: 'image/denom/5wan.jpg' },
    { year: 2024, denom: '1亿元', name: '2024年一亿元纪念币', krause: 'KM# 126', yearImg: 'image/denom/1yi.jpg' }
];

const specialDenomMeta = {
    id: 'denom',
    name: '面额大观',
    dataKey: 'denomData',
    slogan: '各面额精品一览',
    groupBy: 'denom'
};
