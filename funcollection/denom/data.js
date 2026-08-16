// 面额大观数据：每项含 year、denom（面额）、name、krause、yearImg
const denomItems = [
    // { year: 1999, denom: "1元", name: "建国钞 1元", krause: "Pick# 891", yearImg: "https://cdn.jsdelivr.net/gh/.../funcollection/denom/images/1yuan-1999.jpg" },
];

// 专题元信息
const specialDenomMeta = {
    id: 'denom',
    name: '面额大观',
    slogan: '同一张面额，走过不同时代；指尖翻页，看尽货币变迁。',
    dataKey: 'denomData',
    groupBy: 'denom',        // ★ 按面额分组（区别于年份的 year）
    categories: []
};
