// fun-data-bridge.js
// 收集趣味收藏数据到 window.FUN_DATA_MAP，供专题使用
window.FUN_DATA_MAP = {
    yearsData: typeof banknoteYears !== 'undefined' ? banknoteYears : null,
    denomData: typeof denomItems !== 'undefined' ? denomItems : null,
    shanheData: typeof shanheScenes !== 'undefined' ? shanheScenes : null
};
