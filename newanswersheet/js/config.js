// ============================================================
// config.js — 全局配置常量（单一定源）
// 修改任何尺寸参数只需修改此处，CSS 和 JS 自动联动
// ============================================================

export const CARD = {
    width: 210,          // mm
    height: 297,         // mm
    margin: {
        top: 13,
        bottom: 13,
        left: 10,
        right: 10,
    },
};

export const BLOCK = {
    width: 4.5,          // 填涂块宽度 mm
    step: 6.5,           // 相邻块中心距 mm
    optionHeight: 2.7,   // 选项框高度 = width * 3/5
};

export const CHOICE = {
    groupSize: 5,        // 每组题数
    groupsPerRow: 4,     // 每行组数
    lineGap: 1.845,      // 行间距 mm
    get rowHeight() {    // 每行总高（计算属性）
        return this.groupSize * BLOCK.optionHeight + this.lineGap;
    },
    options: ['A', 'B', 'C', 'D'],  // 可扩展为传入参数
};

export const PADDING = {
    outer: 1.5,          // 红框内边距 mm
    inner: 2.5,          // 黑框内边距 mm
};

export const QUESTION = {
    baseHeight: 12,      // 解答题基准高度 mm
    perScoreHeight: 1.8, // 每分增量高度 mm
    fillHeight: 12,      // 填空题高度 mm
};

export const PAGE_EXTRA = {
    first: 160,          // 首页标题+信息+注意事项占用的额外高度 mm
    other: 8,            // 非首页顶部提示占用的高度 mm
};

// 默认表单值
export const DEFAULTS = {
    title: '2025年普通高等学校招生全国统一考试',
    subject: '数学',
    zkLength: 9,
    choiceTotal: 10,
    fillRule: '1-2,2-2,3-2',
    ansCount: 3,
    ansScores: '12 12 14',
};

// 输入约束
export const CONSTRAINTS = {
    zkLength: { min: 4, max: 11 },
    choiceTotal: { min: 0, max: 200 },
    ansCount: { min: 0, max: 20 },
};
