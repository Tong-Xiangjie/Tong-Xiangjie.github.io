// data/republic_frbc.js
const republic_frbcData = {
    name: "民国中国联合准备银行",
    icon: null,
    desc: "The Federal Reserve Bank of China",
    detailFields: [
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行方" },
        { key: "print", label: "印刷机构" },
        { key: "signature1", label: "签名1"},
        { key: "signature2", label: "签名2"},
        { key: "year", label: "发行年份" },
        { key: "issueDate", label: "发行日期" },
        { key: "withdrawnDate", label: "停止流通日期" },
        { key: "size", label: "标准尺寸" },
        { key: "copyId", label: "评级证书编号" },
        { key: "condition", label: "评级分数" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" },
        { key: "krause", label: "纸币目录编号" }
    ],

    // ★ 本分类暂无藏品。不要在这里放「啥都木有」这类占位文字 —— 那个字符串会被
    //   当成真实系列名，渲染出一个可点击却点不开的系列头（详见 category-view.js
    //   的空系列处理）。留空数组即可：渲染层会显示统一的空状态提示。
    series: []
};
