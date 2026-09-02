// ==================== funcollection/denom/data.js ====================
// 面额大观数据

const denomItems = [
  { year: 1949, denom: '2分', name: '海南银行1949年银元券（香港版）', krause: 'Pick# S1452', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/002-thnb1949.jpg' },
  { year: 1949, denom: '5分', name: '海南银行1949年银元券（香港版）', krause: 'Pick# S1453', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/005-thnb1949.jpg' },
  { year: 1979, denom: '1角', name: '1979年外汇兑换券', krause: 'Pick# FX1', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/01-fec.jpg' },
  { year: 1960, denom: '1元', name: '第三套人民币', krause: 'Pick# 874', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1-1960rmb.jpg' },
  { year: 1982, denom: '1元', name: '1982年国库券', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/1-1982gkq.jpg' },
  { year: 1982, denom: '5元', name: '1982年国库券', krause: 'Pick# Unlisted', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-1982gkq.jpg' },
  { year: 1949, denom: '5元', name: '广东省银行1949年大洋票', krause: 'Pick# S2457', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/5-kpb1949.jpg' },
  { year: 1980, denom: '10元', name: '渣打银行港币10元', krause: 'Pick# 77', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/hk10-sc1981.jpg' },
  { year: 1981, denom: '10元', name: '大西洋银行澳门币10元', krause: 'Pick# 59', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/am10-bnu1984.jpg' },
  { year: 2001, denom: '10元', name: '中国银行澳门币10元', krause: 'Pick# 101', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/am10-boc2001.jpg' },
  { year: 2001, denom: '10元', name: '大西洋银行澳门币10元', krause: 'Pick# 76', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/am10-bnu2001.jpg' },
  { year: 1999, denom: '50元', name: '新台币发行五十周年纪念钞', krause: 'Pick# 1990', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/tw50-1999.jpg' },
  { year: 1999, denom: '50元', name: '庆祝中华人民共和国成立50周年纪念钞', krause: 'Pick# 891', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/50-1999jg.jpg' },
  { year: 1936, denom: '100元', name: '中央银行1936年法币券（华德路版）', krause: 'Pick# 350', yearImg: 'https://cdn.jsdelivr.net/gh/Tong-Xiangjie/Tong-Xiangjie.github.io@main/funcollection/denom/images/100-zyyh1936-w&s.jpg' },
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
