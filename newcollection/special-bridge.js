// special-bridge.js
// 收集各专题的元信息，供 main.js 使用
window.SPECIAL_CONFIGS = [];

if (typeof specialYearsMeta !== 'undefined') {
    window.SPECIAL_CONFIGS.push(specialYearsMeta);
}

// 未来新专题在此添加：
// if (typeof specialXXXMeta !== 'undefined') {
//     window.SPECIAL_CONFIGS.push(specialXXXMeta);
// }
