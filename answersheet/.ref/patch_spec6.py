import io
import sys

sys.stdout.reconfigure(encoding='utf-8')

p = '答题卡排版规格.md'
s = io.open(p, encoding='utf-8').read()

# ── 在 6.2 的链里补 gridShiftX / markShiftX ──
old2 = """红框**外缘右** = `面宽 − 红框外缘左`（与左边对称）。"""
new2 = """红框**外缘右** = `面宽 − 红框外缘左`（与左边对称）。

**两个横向位移量**（用户指定「最左边那一列往右移动一个定位点的宽度」）：

| 参数 | 值 | 作用 |
|---|---|---|
| `gridShiftX` | 5.6 | 气泡网格整体右移（加在黑框 `margin-left` 上） |
| `markShiftX` | 5.6 | 顶部定标带整体右移 |

两者取同值 → 网格列心与顶部定标块心仍然共线。
**左侧定位点是竖向的带子**，其 x 由 `boxOffsets.leftBandX` 决定，不参与横向位移。

`columnsPerLine` 的可用宽度要**减去 `max(gridShiftX, markShiftX)`**，
否则右移后最右一列会捅出红框。A4 因此从 32 列变成 **30 列**。

> ⚠️ 只改 `gridShiftX` 而不改 `markShiftX`（或反之）会让顶部定标块
> 与气泡列心错开一个身位。`dom_verify.mjs` 断言的是「顶部块心与**最近的**
> 气泡列心共线」，所以只改一个它仍会通过 —— 改之前想清楚。"""
assert old2 in s, 'a2'
s = s.replace(old2, new2, 1)

# ── 6.4 补行间空档 ──
old4 = """**块间空列**：块与块之间空 **`gap` 列**（`GROUPS[fmt].gap = 1`），
即空出**一道选择题的宽度** = `gap × step` = 5.6mm。
行与行之间同样空出一行的高度（`lineH = columnHeight + ROW_GAP`）。"""
new4 = """**块间空列**：块与块之间空 **`gap` 列**（`GROUPS[fmt].gap = 1`），
即空出**一道选择题的宽度** = `gap × step` = 5.6mm。

**行间空档（换行处）**：上一行最后一个选项与下一行题号之间空出
**一个定位点的高度**（用户指定）：

```
lineGapH  = LINE_GAP_BUBBLES × bubbleH   （LINE_GAP_BUBBLES = 1）
lineHeight = columnHeight + lineGapH     （A4: 20.503 + 2.436 = 22.939）
```

`n` 行占高 = `n × columnHeight + (n−1) × lineGapH`（末行下面不再留空档）。
CSS 用 `.as-choice-grid { display:flex; flex-direction:column; row-gap:… }`
实现 —— flex 的 `gap` 不参与外边距合并，高度可加、可预测。

**左侧定位点按行生成**：换行后**每一行**都有自己的
「题号行 + 各选项行」一列定位点（`rowOffsets().length = 5` 个/行）。
`layoutFace` 按 `o.choiceLines` 逐行递推，行与行之间同样用 `lineHeight`。
只画第一行的话，换行后第二行左边就空着 —— 这是用户报过的缺陷。"""
assert old4 in s, 'a4'
s = s.replace(old4, new4, 1)

# ── 6.5.1 补非选择题左右 1mm ──
old5 = """**非选择题红框** —— 这三个量必须三处同源，否则红框会压到页脚上："""
new5 = """**非选择题黑框左右各内缩 1mm**（用户指定）：`.as-subject-inner-table`
用 `margin: 0 1mm; width: calc(100% - 2mm)`，即红框内缘到黑框外缘
左右各 1mm。⚠️ 用 `margin` 而不是给红框加 `padding` —— 红框的横向
内边距必须保持 0，否则盒模型又变成两套口径。

**非选择题红框纵向量** —— 这三个量必须三处同源，否则红框会压到页脚上："""
assert old5 in s, 'a5'
s = s.replace(old5, new5, 1)

# ── 6.5.4 常量表补新项 ──
old6 = """| `HEAD_H` | `js/builders/subject.js` | 5.0 |
| `ROW_OVERHEAD` | `js/builders/subject.js` | 1.039 |
| `.as-footer bottom` | `css/card.css` | 12.9mm |"""
new6 = """| `HEAD_H` | `js/builders/subject.js` | 5.0 |
| `ROW_OVERHEAD` | `js/builders/subject.js` | 1.039 |
| `.as-footer bottom` | `css/card.css` | 12.9mm |
| `LINE_GAP_BUBBLES` | `js/config.js` | 1（× `bubbleH`） |
| `gridShiftX` / `markShiftX` | `PRESETS.A4/A3` | 5.6 / 5.6 |
| `--subj-box-gap` | `css/card.css` | 1mm |"""
assert old6 in s, 'a6'
s = s.replace(old6, new6, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('spec updated')
