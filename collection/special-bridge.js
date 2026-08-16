// special-bridge.js
// 收集各专题的元信息，供 main.js 使用
window.SPECIAL_CONFIGS = [];

if (typeof specialYearsMeta !== 'undefined') {
    window.SPECIAL_CONFIGS.push(specialYearsMeta);
}

// ★ 面额大观
if (typeof specialDenomMeta !== 'undefined') {
    window.SPECIAL_CONFIGS.push(specialDenomMeta);
}

// ★ 方寸山河
if (typeof specialShanheMeta !== 'undefined') {
    window.SPECIAL_CONFIGS.push(specialShanheMeta);
}

// 未来新专题在此添加：
// if (typeof specialXXXMeta !== 'undefined') {
//     window.SPECIAL_CONFIGS.push(specialXXXMeta);
// }
