// ==================== funcollection/denom/data.js ====================
// 面额大观数据

const denomItems = [
  { year: 1949, denom: '1分', name: '中华民国三十八年（1949年） 中华书局版 大洋票 - 1949年 1分', krause: 'S2452', yearImg: '' },
  { year: 1949, denom: '5分', name: '中华民国三十八年（1949年） 香港版 银元券 - 1949年 5分', krause: 'S1453', yearImg: '' },
  { year: 1947, denom: '10钱', name: 'A序列 - 昭和22年（1947年） 10銭（Sen） 和平鸽', krause: '84', yearImg: '' },
  { year: 1947, denom: '50钱', name: '政府纸币 - 昭和20年（1945年） 50銭（Sen） 靖国神社', krause: '60a', yearImg: '' },
  { year: 1931, denom: '1角', name: '中华民国二十年（1931年） 中华书局版 兑换券·辅币券 - 1931年 1角 杏坛', krause: '202', yearImg: '' },
  { year: 1931, denom: '2角', name: '中华民国二十年（1931年） 中华书局版 兑换券·辅币券 - 1931年 2角 洙水桥', krause: '203', yearImg: '' },
  { year: 1949, denom: '5角', name: '中华民国三十八年（1949年） 中华书局版 大洋票 - 1949年 5角 广州中山纪念堂', krause: 'S2455', yearImg: '' },
  { year: 1919, denom: '½元', name: '中华民国八年（1919年） 财政部定期有利国库券 - 1919年 ½元', krause: '626a', yearImg: '' },
  { year: 2019, denom: '1元', name: '1元 - 2019年版', krause: '912a', yearImg: '' },
  { year: 1990, denom: '2元', name: '2元 - 1990年版', krause: '885b', yearImg: '' },
  { year: 2020, denom: '5元', name: '5元 - 2020年版', krause: '913*', yearImg: '' },
  { year: 2020, denom: '10元', name: '2020年版 - 澳门元10元', krause: '90', yearImg: '' },
  { year: 2023, denom: '20元', name: '2018～至今版 - 港币20元', krause: '348c', yearImg: '' },
  { year: 2023, denom: '50元', name: '2018～至今版 - 港币50元', krause: '349', yearImg: '' },
  { year: 2023, denom: '100元', name: '2018～至今版 - 港币100元', krause: '350', yearImg: '' },
  { year: 2001, denom: '200元', name: '第五套横式新台币 - 中华民国九十年（2001年） 200元', krause: '1992', yearImg: '' },
  { year: 2004, denom: '500元', name: '第五套横式新台币 - 中华民国九十三年（2004年） 安二版 500元', krause: '1996', yearImg: '' },
  { year: 2004, denom: '1000元', name: '第五套横式新台币 - 中华民国九十三年（2004年） 安二版 1000元', krause: '1997', yearImg: '' },
  { year: 2001, denom: '2000元', name: '第五套横式新台币 - 中华民国九十年（2001年） 2000元', krause: '1995', yearImg: '' },
  { year: 1955, denom: '10000元', name: '国家经济建设公债', krause: '', yearImg: '' },
  { year: 1955, denom: '20000元', name: '国家经济建设公债', krause: '', yearImg: '' },
  { year: 1955, denom: '50000元', name: '国家经济建设公债', krause: '', yearImg: '' },
  { year: 1955, denom: '100000元', name: '国家经济建设公债', krause: '', yearImg: '' },
  { year: 1955, denom: '500000元', name: '国家经济建设公债', krause: '', yearImg: '' },
  { year: 1955, denom: '1000000元', name: '国家经济建设公债', krause: '', yearImg: '' },
  { year: 2023, denom: '500元', name: '2018～至今版 - 港币500元 六角岩柱', krause: '221', yearImg: '' },
  { year: 1953, denom: '100円', name: 'B序列 - 昭和28年（1953年） 100円（Yen） 板垣退助', krause: '90b', yearImg: '' },
  { year: 2024, denom: '1000円', name: 'F序列 - 令和6年（2024年） 1000円（Yen） 北里柴三郎', krause: '107a', yearImg: '' },
  { year: 2000, denom: '2000円', name: '纪念钞 - 平成12年（2000年） 2000円（Yen） 守礼门', krause: '103b', yearImg: '' },
  { year: 2024, denom: '1000卢比', name: '2022年版 1000卢比', krause: '162a', yearImg: '' },
  { year: 2017, denom: '2000卢比', name: '2016年版 2000卢比', krause: '155b', yearImg: '' },
  { year: 2020, denom: '75000卢比', name: '2020年独立75周年纪念版 75000卢比', krause: '161', yearImg: '' },
  { year: 2024, denom: '100000卢比', name: '2016年版 100000卢比', krause: '160g', yearImg: '' },
  { year: 2014, denom: '100卢布', name: '2014年版 100卢布 索契冬奥会纪念钞', krause: '274c', yearImg: '' },
  { year: 2024, denom: '20格里夫纳', name: '2023年版 20格里夫纳 俄乌战争1周年纪念钞', krause: '133', yearImg: '' },
  { year: 2024, denom: '50格里夫纳', name: '2024年版 50格里夫纳 俄乌战争2周年纪念钞', krause: '134', yearImg: '' },
  { year: 2018, denom: '50玻利瓦尔', name: '2018年版 50玻利瓦尔', krause: '105', yearImg: '' },
  { year: 2017, denom: '10000玻利瓦尔', name: '2017年版 10000玻利瓦尔', krause: '98b', yearImg: '' }
];

const specialDenomMeta = {
    id: 'denom',
    name: '面额大观',
    dataKey: 'denomData',
    slogan: '元角分厘，方寸之间',
    groupBy: 'denom'
};
