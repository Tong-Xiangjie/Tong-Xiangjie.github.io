// data/taiwan_readme.js
// ★ 台币在分类树里是**父分类**（藏品分散在 taiwan_old.js / taiwan_1.js … 里），
//   本来没有自己的数据文件，于是它顶层想挂一篇文章也无处可挂。
//   data-loader 的 walkTree 是"先收节点自己的 dataKey/dataFile，再递归 children"，
//   所以父节点带数据文件是被支持的 —— 这里就是台币父级自己的那一个。
//
//   ★ series 必须是空数组而不是省略：article.js 的 collectFromSource 只处理
//     `data.series` 存在的来源，缺了它整篇 readme 会被静默跳过（第一版就栽在这）。
//   ★ 这里只放文章，不放藏品；藏品仍然只在各自的子文件里，不会重复。
const taiwanReadmeData = {
    name: "台币",
    series: [],
    readmes: [
        { title: "台钞图录", content: "file:readmes/taiwan_index_of_taiwan_dollar.html" }
    ]
};
