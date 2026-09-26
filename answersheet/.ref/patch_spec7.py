import io
import sys

sys.stdout.reconfigure(encoding='utf-8')

p = '答题卡排版规格.md'
s = io.open(p, encoding='utf-8').read()

# ── 6.2 之后补「黑框内边距」 ──
old = """`columnsPerLine` 的可用宽度要**减去 `max(gridShiftX, markShiftX)`**，
否则右移后最右一列会捅出红框。A4 因此从 32 列变成 **30 列**。"""
new = """`columnsPerLine` 的可用宽度要**减去 `max(gridShiftX, markShiftX)`**，
否则右移后最右一列会捅出红框。A4 因此从 32 列变成 **30 列**（30 个定标块
与 30 列气泡一一对应）。

## 6.2.1 黑框的内边距（上下 3mm，左右 3mm）

用户指定四处都是固定 3mm：

| 位置 | 值 | 实现在哪 |
|---|---|---|
| 黑框外缘 ← 红框内缘（左右） | 3mm | `PRESETS.*.boxGap` |
| 第一行题号 → 黑框顶边 | 3mm | `PRESETS.*.innerPadTop` |
| 末行选项 → 黑框底边 | 3mm | `PRESETS.*.innerPadBottom` |

上下两个是**黑框内**的空档，所以做成黑框的 `padding` 并计入
`choiceChromeH` / `choiceFootH`：

```
choiceChromeH = 红框线 + outerPadY + headerH + headerGap + 黑框线 + innerPadTop
choiceFootH   = innerPadBottom + 黑框线 + outerPadYBottom + 红框线
```

⚠️ 不能靠调红框的内边距来做 —— 调红框只会让黑框和红框一起挪，
黑框内的空档一点不变。

⚠️ 左右两侧的 3mm 还有一个盒模型陷阱：红框在 CSS 里是
`box-sizing:border-box`，所以红框的**边框盒**宽必须是
`contentBox.width + 2×红框线`（`geometry.outerBoxW`），
否则它的内容盒会少掉两道线，黑框按 `contentBox.width − 2×boxGap`
撑满就往右溢出 0.6mm。

⚠️ `innerPadTop/Bottom` 是**实测校准值**，不是标称 3：网格与气泡都带
半行/半格的居中偏移，padding 要减掉这些固有偏移才能得到**视觉** 3mm。
改 CSS 结构后必须用 `.ref/pad2.mjs` 重测。"""
assert old in s, 'a1'
s = s.replace(old, new, 1)

# ── 6.7 文本位置 补「只出现一次」与页内语句 ──
old2 = """## 6.7 文本位置"""
new2 = """## 6.6.9 两处提示语句的出现次数与位置

| 语句 | 出现次数 | 位置 |
|---|---|---|
| `(提示：请用2B铅笔在正确答案上填涂…)` | **全卡 1 次** | 选择题栏目头（仅第一行所在面） |
| `(提示：请用0.5毫米黑色签字笔作答…)` | **全卡 1 次** | 非选择题栏目头（仅第一题所在面） |
| `请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效` | **每面非选择题各 1 次** | 非选择题**红框与黑框之间** |

「红框与黑框之间」的空档在两种情形下方向不同，由 `subject.render` 决定：

```
本面印了栏目头（第一题所在面） → 语句放黑框**下方**
本面没印栏目头（续排面）        → 语句放黑框**上方**
```

这样无论哪种情形，语句都夹在红黑两框之间。

- 栏目头只印一次：`itemHeight(lines, lineH, withHeader)` 只有第一题摊
  栏目头的高度；`app.js` 用 `subjItems.some(b => b.first)` 决定
  `showHeader`。分页器的 `SUBJ_BOX_CHROME` 取「栏目头」与「语句」
  两种占高的**较大者**（续排面用语句顶替栏目头）。
- 页内语句的字体/字号/颜色取自原稿 `.subject-page-tip`：
  **宋体 10pt 红色居中**（`TYPE.pageTip`）。栏目头提示取自原稿
  `.choice-tip` / `.subject-tip`：**宋体 9pt 红色**（`TYPE.sectionTip`）。
- 语句的行高与间距是 `SUBJ_CHROME.tipH / tipGap`，由 `theme.js` 写成
  `--subj-tip-h` / `--subj-tip-gap`，与分页器同源。

## 6.7 文本位置"""
assert old2 in s, 'a2'
s = s.replace(old2, new2, 1)

# ── 6.5.4 常量速查补新项 ──
old3 = """| `--subj-box-gap` | `css/card.css` | 1mm |"""
new3 = """| `--subj-box-gap` | `css/card.css` | 1mm |
| `innerPadTop` / `innerPadBottom` | `PRESETS.*` | 3.0 / 2.62（实测校准） |
| `SUBJ_CHROME.tipH` / `tipGap` | `js/paginator.js` | 4.0 / 1.0 |
| `TYPE.pageTip` | `js/config.js` | 宋体 10pt accent |"""
assert old3 in s, 'a3'
s = s.replace(old3, new3, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('spec updated')
