// ==================== funcollection/denom/data.js ====================
// 面额大观数据

const denomItems = [
  { year: 1939, denom: '1分', name: '中央银行1939年法币券', krause: 'Pick# 224', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/001-zyyh1939.jpg' },
  { year: 1940, denom: '1分', name: '厦门劝业银行1940年', krause: 'Pick# S1655', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/001-aib1940.jpg' },
  { year: 1949, denom: '1分', name: '广东省银行1949年大洋票', krause: 'Pick# S2452', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/001-kpb1949.jpg' },
  
  { year: 1949, denom: '2分', name: '海南银行1949年银元券（香港版）', krause: 'Pick# S1452', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/002-thnb1949.jpg' },
  
  { year: 1939, denom: '5分', name: '中央银行1939年法币券', krause: 'Pick# 225', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/005-zyyh1939.jpg' },
  { year: 1949, denom: '5分', name: '海南银行1949年银元券（香港版）', krause: 'Pick# S1453', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/005-thnb1949.jpg' },
  
  { year: 1931, denom: '1角', name: '中央银行1931年兑换券', krause: 'Pick# 202', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/01-zyyh1931.jpg' },
  { year: 1940, denom: '1角', name: '中央储备银行1940年中储券', krause: 'Pick# J3', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/01-crbc1940.jpg' },
  { year: 1946, denom: '1角', name: '中央银行1946年金圆券', krause: 'Pick# 395', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/01-zyyh1946.jpg' },
  { year: 1979, denom: '1角', name: '1979年外汇兑换券', krause: 'Pick# FX1', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/01-fec.jpg' },
  
  { year: 1931, denom: '2角', name: '中央银行1931年兑换券', krause: 'Pick# 203', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/02-zyyh1931.jpg' },
  { year: 1980, denom: '2角', name: '第四套人民币', krause: 'Pick# 882', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/02-rmb4.jpg' },
  
  { year: 1949, denom: '5角', name: '广东省银行1949年大洋票', krause: 'Pick# S2455', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/05-kpb1949.jpg' },
  
  { year: 1936, denom: '1元', name: '中央银行1936年法币券（德纳罗版）', krause: 'Pick# 212', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1-zyyh1936-tdlr.jpg' },
  { year: 1943, denom: '1元', name: '中央储备银行1943年中储券', krause: 'Pick# J19', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1-crbc1943.jpg' },
  { year: 1946, denom: '1元', name: '旧台币', krause: 'Pick# 1935', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/tw1-1946.jpg' },
  { year: 1949, denom: '1元', name: '金门地区专用钞券', krause: 'Pick# R101', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/twjm1-1949.jpg' },
  { year: 1949, denom: '1元', name: '广东省银行1949年大洋票', krause: 'Pick# S2456', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1-kpb1949.jpg' },
  { year: 1959, denom: '1元', name: '1959年四川省地方经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1-1959sichuan.jpg' },
  { year: 1960, denom: '1元', name: '第三套人民币', krause: 'Pick# 874', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1-1960rmb.jpg' },
  { year: 1961, denom: '1元', name: '新台币', krause: 'Pick# 1971', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/tw1-1961.jpg' },
  { year: 1982, denom: '1元', name: '1982年国库券', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1-1982gkq.jpg' },
  
  { year: 1914, denom: '5元', name: '交通银行1914年国币券', krause: 'Pick# 117', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-jtyh1914.jpg' },
  { year: 1936, denom: '5元', name: '中央银行1936年法币券（德纳罗版）', krause: 'Pick# 213', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-zyyh1936-tdlr.jpg' },
  { year: 1937, denom: '5元', name: '中国银行1937年法币券', krause: 'Pick# 80', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-boc1937.jpg' },
  { year: 1940, denom: '5元', name: '中央储备银行1940年中储券', krause: 'Pick# J10', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-crbc1940.jpg' },
  { year: 1941, denom: '5元', name: '中央银行1941年法币券（德纳罗版背黄鹤楼）', krause: 'Pick# 235', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-zyyh1941-tdlr-hhl.jpg' },
  { year: 1949, denom: '5元', name: '广东省银行1949年大洋票', krause: 'Pick# S2457', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-kpb1949.jpg' },
  { year: 1961, denom: '5元', name: '新台币', krause: 'Pick# 1972', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/tw5-1961.jpg' },
  { year: 1982, denom: '5元', name: '1982年国库券', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-1982gkq.jpg' },
  { year: 1983, denom: '5元', name: '1983年国库券', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-1983gkq.jpg' },
  { year: 1991, denom: '5元', name: '1991年国库券', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-1991gkq.jpg' },
  
  { year: 1914, denom: '10元', name: '交通银行1914年国币券', krause: 'Pick# 118', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10-jtyh1914.jpg' },
  { year: 1936, denom: '10元', name: '中央银行1936年法币券（华德路版）', krause: 'Pick# 218', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10-zyyh1936-w&s.jpg' },
  { year: 1937, denom: '10元', name: '中国银行1937年法币券', krause: 'Pick# 81', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10-boc1937.jpg' },
  { year: 1940, denom: '10元', name: '中国银行1940年法币券', krause: 'Pick# 85', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10-boc1940.jpg' },
  { year: 1940, denom: '10元', name: '中央储备银行1940年中储券', krause: 'Pick# J12', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10-crbc1940.jpg' },
  { year: 1943, denom: '10元', name: '中央储备银行1943年中储券', krause: 'Pick# J20', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10-crbc1943.jpg' },
  { year: 1968, denom: '10元', name: '新台币', krause: 'Pick# 1970', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/tw10-1968.jpg' },
  { year: 1980, denom: '10元', name: '渣打银行港币', krause: 'Pick# 77', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/hk10-sc1981.jpg' },
  { year: 1981, denom: '10元', name: '大西洋银行澳门币', krause: 'Pick# 59', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/am10-bnu1984.jpg' },
  { year: 1989, denom: '10元', name: '1989年国库券', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10-1989gkq.jpg' },
  { year: 1991, denom: '10元', name: '1991年国库券', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10-1991gkq.jpg' },
  { year: 2001, denom: '10元', name: '中国银行澳门币', krause: 'Pick# 101', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/am10-boc2001.jpg' },
  { year: 2001, denom: '10元', name: '大西洋银行澳门币', krause: 'Pick# 76', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/am10-bnu2001.jpg' },
  { year: 2012, denom: '10元', name: '澳门生肖贺岁钞', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/am10-amsx.jpg' },
  
  { year: 1972, denom: '50元', name: '新台币', krause: 'Pick# 1982', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/tw50-1972.jpg' },
  { year: 1999, denom: '50元', name: '新台币发行五十周年纪念钞', krause: 'Pick# 1990', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/tw50-1999.jpg' },
  { year: 1999, denom: '50元', name: '庆祝中华人民共和国成立50周年纪念钞', krause: 'Pick# 891', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/50-1999jg.jpg' },
  
  { year: 1936, denom: '100元', name: '中央银行1936年法币券（华德路版）', krause: 'Pick# 350', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/100-zyyh1936-w&s.jpg' },
  { year: 1938, denom: '100元', name: '侵华日军军用手票1938年丙号券', krause: 'Pick# M29', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/100-ww2-jp-cn-1938.jpg' },
  { year: 1949, denom: '100元', name: '广东省银行1949年大洋票', krause: 'Pick# S2459', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/100-kpb1949.jpg' },
  { year: 1991, denom: '100元', name: '1991年国库券', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/100-1991gkq.jpg' },
  { year: 2000, denom: '100元', name: '新台币', krause: 'Pick# 1993', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/tw100-2000.jpg' },
  { year: 2012, denom: '100元', name: '香港纪念中国银行成立一百周年纪念钞', krause: 'Pick# 346', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/hk100-boc2012comm.jpg' },
  
  { year: 1954, denom: '10000元', name: '1954年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1w-1954.jpg' },
  { year: 1955, denom: '10000元', name: '1955年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1w-1955.jpg' },
  
  { year: 1954, denom: '20000元', name: '1954年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/2w-1954.jpg' },
  { year: 1955, denom: '20000元', name: '1955年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/2w-1955.jpg' },
  
  { year: 1954, denom: '50000元', name: '1954年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5w-1954.jpg' },
  { year: 1955, denom: '50000元', name: '1955年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5w-1955.jpg' },
  
  { year: 1954, denom: '100000元', name: '1954年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10w-1954.jpg' },
  { year: 1955, denom: '100000元', name: '1955年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/10w-1955.jpg' },
  
  { year: 1954, denom: '500000元', name: '1954年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/50w-1954.jpg' },
  { year: 1955, denom: '500000元', name: '1955年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/50w-1955.jpg' },
  
  { year: 1955, denom: '1000000元', name: '1955年国家经济建设公债', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/100w-1955.jpg' }
];

const specialDenomMeta = {
    id: 'denom',
    name: '面额大观',
    dataKey: 'denomData',
    slogan: '元角分厘，方寸之间',
    groupBy: 'denom'
};
