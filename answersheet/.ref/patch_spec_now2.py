import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = '答题卡排版规格.md'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# ── §6.5.2 ─────────────────────────────────────────────────────────────────
rep("""```
itemHeight = HEAD_H + lines × lineH + 2 × cellPad + ROW_OVERHEAD
           = 5.0    + lines × 7.7   + 2 × 2.5    + 1.039
```

| 项 | 值 | 说明 |
|---|---|---|
| `HEAD_H` | 5.0 | 题头行固定高（CSS `--subj-head-h`） |
| `lineH` | 7.7 | 每条作答线高（`--answer-line-h`） |
| `cellPad` | 2.5 | 单元格上下内边距（CSS `--inner-pad-x`） |
| `ROW_OVERHEAD` | 1.039 | **实测标定**的表格排版余量 |

`ROW_OVERHEAD` 的来历：用 `.ref/subj_fit.mjs` 在 4 / 8 / 12 行三档上回归，
斜率恰好 **7.700 mm/行**（= `lineH`，完全吻合），截距恒为 **11.039mm**，
而模型的固定项只有 10.000mm —— 差额 1.039mm 与行数无关，是 Chrome
在表格行里排块级子元素时行盒本身的开销。补上它之后模型与 DOM 差 **0.003mm**。

> ⚠️ 这个数改了要重跑 `.ref/subj_fit.mjs` 校验；它随字体/行盒策略变。
> 不补这一项，分页器算出的红框比真实渲染矮 1mm/题，最后一题压到页脚上。""",
"""```
itemHeight = HEAD_H + lines × lineH + 2 × cellPad + ROW_OVERHEAD
           = 5.0    + lines × 7.7   + 2 × 2.5    + 1.3
           = 11.3   + 7.7 × lines
```

| 项 | 值 | 说明 |
|---|---|---|
| `HEAD_H` | 5.0 | 题头行固定高（CSS `--subj-head-h`） |
| `lineH` | 7.7008 | 每条作答线高（`--answer-line-h: 7.7mm` ⇒ 浏览器 29.1px） |
| `cellPad` | 2.5 | 单元格上下内边距（CSS `--inner-pad-x`） |
| `ROW_OVERHEAD` | **1.3** | **实测标定**的表格行盒余量 |

**标定方法**（`.ref/cal.cjs`、`.ref/cal2.cjs`，2026 重做）：
在**真实卡片**里渲染 1 / 2 / 3 / 4 / 5 / 6 / 8 / 10 / 12 / 16 行十档，
用 `offsetHeight`（**不用** `getBoundingClientRect()`）量表格高：

```
lines    1      3      4      5      6      8     10     12     16
tableH  25.929 33.602 41.275 48.948 56.621 72.231 87.577 102.923 133.615
拟合    tableH = 11.30 + 7.7008 × lines       残差 ≤ 0.02mm
```

> ⚠️ **历史坑（这一项错了整整一个 session）**：
> 早期在「脱离文档流的隐藏容器」里量，那个容器没有舞台缩放，
> 量出的表格高比真实卡片**矮 6.04mm**，于是 `itemHeight` 每题少 6mm。
> 分页器据此定框高 → 黑框整条溢出红框（实测溢出 10.8mm）→ 又触发
> 「非选择题还没排完就换页」。`ROW_OVERHEAD` 先后被误标成
> `1.039 / 1.881 / 0.9 / 2.7 / −5.0`，都是在补偿这个错误。
>
> ⚠️ 量测纪律：舞台 `.preview-stage` 上有 `transform: scale()`，
> `getBoundingClientRect()` 会被缩放污染（实测 3.3095 px/mm 而非 3.7795）。
> **一律用 `offsetHeight` / `offsetTop` ÷ (96/25.4)**，或先把
> `stage.style.transform = 'none'` 再量。

**每段对分页器游标的推进量** = `itemHeight + SUBJ_ITEM_PITCH`：

```
SUBJ_ITEM_PITCH = 6.3mm
```

`itemHeight` 是**表格行盒**的高；真实渲染里「上一段表格顶 → 下一段表格顶」
还多 6.3mm（单元格里 `.as-subj-head` 是 flex、`.as-subj-body` 是 block，
两者的盒模型叠出来的固定量）。实测 `.ref/layout.cjs`：12 选择 + 2 题，
首题上缘 124.475、次题上缘 193.199，差 68.724 = itemHeight(6) 61.5 + 6.3 ✓。

不补这一项，分页器会以为本面还能再排一段 → 红框容量算多、黑框溢出。""",
    '§6.5.2')

# ── §7.6 ───────────────────────────────────────────────────────────────────
i = s.find('### 7.6 为什么收口必须用**闭环**而不是公式')
j = s.find('### 7.7 ')
assert i > 0 and j > i, 'MISS §7.6'
s = s[:i] + """### 7.6 收口：红框高度是**量**出来的，不是算出来的

**用户口径**：「你不如把这个高度写死了」。

写死是必须的，但写死的必须是**渲染后的真实框高** —— 黑框表格每多一行，
Chrome 按整设备像素（`1/3.7795 = 0.2646mm`）吸附行盒，模型（`itemHeight`）
与 DOM 会漂开。`js/app.js` 的 `fitFrames()` 因此改成**量测闭环**：

```
① renderFaceBody() 先**不**给 .as-subject-outer 写高（frameH = 0），
   让浏览器把红框按内容自然撑开；
② 渲染落地后 fitFrames() 量出
      contentBottom = max(黑框表格底, 下提示底)
      target        = contentBottom + 下内边距 + 下边框
      target        = min(target, frameBottomLimit)
③ 把 target 换算成 outer 的 inline height 写回，迭代 ≤3 轮（收敛即停）。
```

这样「红框底恰好包住黑框，只多一个下内边距」是**由构造保证**的，
与行数、字体、device px 吸附都无关。

**实测（`.ref/layout.cjs`，7 组关键配置，全部通过）：**

| 配置 | 红框 top..bot | 黑框 top..bot | 结论 |
|---|---|---|---|
| 12 选择 + 2 题 | 124.354 .. 249.766 | 131.233 .. 244.475 | 包住 |
| 0 选择 + 2 题 | 84.931 .. 210.343 | 91.810 .. 205.052 | 包住 |
| 40 选择 + 2 题 | 147.108 .. 272.520 | 153.987 .. 267.229 | 包住 |
| 0 选择 + 3 题 | 84.931 .. 259.027 | 91.810 .. 253.735 | 包住 |
| 12 选择 + 1 题 | 124.354 .. 193.146 | 131.233 .. 187.854 | 包住 |
| 0 选择 + 1 题 | 84.931 .. 153.723 | 91.810 .. 148.431 | 包住 |
| 20 选择 + 4 题 | 124.354 .. 249.766 | 131.233 .. 244.475 | 包住 |

> ⚠️ 历史坑：
> ① 曾让红框高度**随内容长**，于是红框底只能靠线性回归猜 —— device px
>    吸附让「红框底 − 游标」跨度 17mm（`.ref/fit2.cjs` 36 组配置），
>    三元回归最大残差 12.8mm，怎么也拟合不出来；
> ② 曾用 `subjBoxBottom`（分页器算的）当 target —— 那是**估计值**，
>    模型偏低时红框比黑框矮，黑框整条露在外面；
> ③ 曾在 fitFrames 里读 `state.faces` —— 它在 `generate()` 里是渲染**之后**
>    才赋值的，首次生成读到的是上一轮的值，闭环成了空转。
>    现在 `fitFrames(facesArr)` 显式接收刚渲染的 faces。
>
> ⚠️ 非答题区单独处理：它是本面最后一条框，直接钉到 `F_BOT`
>    （`target = frameBottomLimit`）。

""" + s[j:]
n += 1

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
