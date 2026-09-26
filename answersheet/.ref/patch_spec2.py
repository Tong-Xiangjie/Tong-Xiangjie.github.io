import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = '答题卡排版规格.md'
s = io.open(P, encoding='utf-8').read()

old = """### 7.11 已知未解决

| 项 | 说明 |
|---|---|
| 12 选择 + 1 题时非答题区与上方红框重叠 | 实测红框底 191.5、非答题区顶 186.894，重叠 4.6mm。分页器在「剩余 ≥ 15mm」的分支里仍会给最后一块红框加 `stretch`，两处叠加。修法：`noAnswer` 为真时把该面的 `stretch` 强制归零并重排。 |
| A3 | 本轮只针对 A4（用户指定「先专注于 a4」）。A3 的 `answerTop/Bottom` 已同源，但未做探针验证。 |
| `fitFrames()` 未进入 `renderAll` 的纯函数路径 | 它是渲染后修正，`renderAll()` 的返回值里不含这个修正量，所以 `.ref/` 里若直接读 `AS.__faces` 得到的仍是未修正的坐标。 |
"""

new = """### 7.11 收口分流（`noAnswer` 二选一）

`paginator` 在收口处只做**一次**判定，`app.js` 的 `fitFrames()` 按同一个
标志分流，**不允许两处叠加**：

```
rest = bottomLimit − cursor − frameTail(subjRows)     // 用未下拉的红框底估计
if (rest >= 15) { 画非答题区；该面 stretch = 0 }
else            { 不画；stretch = rest × 1/0.75 }
```

`fitFrames()`：
- 本面有 `.as-noanswer` → 拉**非答题区**的高度到 `bottomLimit`；
- 本面没有 → 拉**最后一行 `.as-subj-body`** 的高度到 `bottomLimit`。

> ⚠️ **踩过的两个坑**：
> ① 在 `rest` 里又加了一份已决定的 `stretch`（想把闭环的位移算进去）——
>    结果红框底被估得过高、`rest` 偏小，12 选择 + 1 题（真实剩余 86mm）
>    被误判成「不够 15mm」，本该画非答题区却去拉大答题区。
>    `rest` 的判据必须是**未下拉**的估计。
> ② `fitFrames()` 早期版本对「有非答题区的面」也去拉最后一行答题区，
>    导致非答题区顶（186.894）低于红框底（191.5），重叠 4.6mm。

### 7.12 `var` 提升导致的「只渲染 1 面」

`renderAll()` 里 `perSheet` / `paper` 原本声明在
`var sheetCount = Math.ceil(faces.length / perSheet) || 1;` **之后**。
`var` 会提升，于是那行读到的是 `undefined`，
`faces.length / undefined` = `NaN`，`NaN || 1` = **1** ——
4 面只渲染出第 1 面（`html.length` 也从 301233 掉到 137011）。

必须写成：

```js
var perSheet = opt.format === 'A3' ? C.A3_COLUMNS : 1;
var paper = C.PAPER[opt.format];
var sheetCount = Math.ceil(faces.length / perSheet) || 1;   // 补齐 faces 之后
```

### 7.13 收口收敛实测（目标下界 278.385）

| 配置 | 红框底 / 非答题区底 | 该面用什么填 |
|---|---|---|
| 12 选择 + 2 题 | 278.425 | 拉大最后一行答题区 |
| 0 选择 + 2 题 | 非答题区 278.384 | 非答题区（h 28.9） |
| 40 选择 + 2 题 | 278.483 | 拉大最后一行答题区 |
| 0 选择 + 3 题 | 278.317 | 拉大最后一行答题区 |
| 12 选择 + 1 题 | 非答题区 278.384 | 非答题区（h 91.5） |
| 40 选择 + 1 题 | 非答题区 278.388 | 非答题区（h 68.6） |
| 0 选择 + 1 题 | 非答题区 278.384 | 非答题区（h 118.8） |

凑偶验证（300 选择题 + 2 题）：`共 4 张 / 4 面 · 含 1 面非答题区（凑偶数）`，
面 4 整面一个非答题区（顶 13.114、底 278.384）。
选择题续页提示与非选择题提示字号一致（都是 `13.3333px` = 10pt）。

### 7.14 已知未解决

| 项 | 说明 |
|---|---|
| A3 | 本轮只针对 A4（用户指定「先专注于 a4」）。A3 的 `answerTop/Bottom` 已同源，但未做探针验证。总面数凑偶目前按「面数」补，A3 一页三面，`3` 的倍数关系未特别处理。 |
| `fitFrames()` 不进 `renderAll` 的返回值 | 它是渲染后修正，`renderAll()` 的返回值里不含这个修正量，`.ref/` 里直接读 `AS.__faces` 得到的是未修正坐标。要复核收口结果必须量 DOM（`.ref/newmodel.cjs` 就是这么做的）。 |
| 竖排非答题区未实测 | `fitStyle()` 的竖排分支（`h > w` 时 `writing-mode: vertical-rl`）在 A4 上几乎不会触发（框宽恒 182mm），只在人工构造的极窄高框上才会用到。逻辑在，但没跑过实例。 |

---

## 8. 本轮改动清单（文件 → 改了什么）

| 文件 | 改动 |
|---|---|
| `js/geometry.js` | 新增 `TOP_BAND_CY / TIP_GAP / TIP_H / answerTop / answerBottom / answerHeight / frameGap / contentChrome`；`outerPadY/outerPadYBottom` 由 1 改为 `TIP_GAP`(0.5) |
| `js/paginator.js` | 全量重写 `paginate`：答题区模型、版块间距、`footReserve`、`frameTail(rows)` 回归式、`STRETCH_K`、`noAnswer` 分流、凑偶面 |
| `js/builders/noanswer.js` | **新增**：非答题区 builder（`fitStyle` / `render`） |
| `js/builders/subject.js` | `renderRow` 支持 `extraBottom`；`render` 只给最后一行；`frameTopH` 只管 `padY`（不再重复加栏目头） |
| `js/builders/page.js` | 删掉「班级」；`footerBottom` 改由 `answerBottom − FOOTER_PAD` 反推；`chromeOther(meta, blank)` 支持空白面 |
| `js/app.js` | 渲染非答题区；`fitNoAnswer()` 字号自适应；`fitFrames()` 闭环收口；凑偶面；`perSheet/sheetCount` 提升顺序修正；`lineH` 7.7 → 7.7008 |
| `js/theme.js` | 写 `--na-*`、`--answer-top/bottom` |
| `css/card.css` | 删掉重复的 `.as-subject-page-tip{margin:2mm 0}`；净空改 `--subj-tip-gap`；选择题续页提示字号 `--fs-noteBody` → `--fs-pageTip`；新增 `.as-noanswer` / `.as-noanswer-text` |
| `index.html` | 加载 `js/builders/noanswer.js`（在 `page.js` 之后） |
| `.ref/参照件实测骨架.md` | **新增**：参照件 PDF 的 mm 坐标解剖 |
| `.ref/newmodel.cjs`、`calib_subj.cjs`、`calib_stretch.cjs`、`fit2.cjs`、`even_check.cjs`、`facecount.cjs` 等 | **新增**：本节所有实测数字的来源探针 |
"""
assert old in s, '7.11'
s = s.replace(old, new, 1)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('spec updated, bytes', len(s.encode('utf-8')))
