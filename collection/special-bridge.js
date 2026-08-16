// ==================== special-bridge.js ====================
// 专题配置桥接

window.SPECIAL_CONFIGS = [];

if (typeof specialYearsMeta !== 'undefined') {
    window.SPECIAL_CONFIGS.push(specialYearsMeta);
}
if (typeof specialDenomMeta !== 'undefined') {
    window.SPECIAL_CONFIGS.push(specialDenomMeta);
}
if (typeof specialShanheMeta !== 'undefined') {
    window.SPECIAL_CONFIGS.push(specialShanheMeta);
}
