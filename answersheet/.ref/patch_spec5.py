import io
import sys

sys.stdout.reconfigure(encoding='utf-8')

p = '答题卡排版规格.md'
s = io.open(p, encoding='utf-8').read()

start = s.index('### 6.5.1 选择题红/黑框的纵向量')
end = s.index('### 6.6 定位块')

new = '''### 6.5.1 红/黑框的纵向量

**选择题红框**

| 量 | 值 | 由什么决定 |
|---|---|---|
| `border` | 0.3 | 红/黑框线宽 |
| `outerPadY` / `outerPadYBottom` | 1 / 1 | 选择题红框上下内边距 |
| `outerPadX` | **0** | 红框左右不留内边距，黑框位置由 `boxGap` 的 margin 给出 |
| `headerH` / `headerGap` | 5 / 1 | 栏目头及其下间距 |
| `choiceHeadH` | 6.3 | 红框顶 → **黑框边框盒**上缘 |
| `choiceChromeH` | 6.6 | 红框顶 → **网格顶**上缘 |
| `choiceFootH` | 1.6 | 网格底 → **红框外缘底** |

> ⚠️ 分页器游标要推到 **`choiceFootH`（红框外缘底）**，不能停在网格底，
> 否则非选择题会压住红框下沿（实测重叠 896.6mm²）。

**非选择题红框** —— 这三个量必须三处同源，否则红框会压到页脚上：

| 量 | 值 | 真源 | CSS 变量 |
|---|---|---|---|
| `padY` | 2.5 | `paginator.SUBJ_CHROME` | `--subj-pad-y` |
| `headerH` | 5.0 | 同上 | `--subj-header-h` |
| `headerGap` | 1.0 | 同上 | `--subj-header-mb` |

`SUBJ_BOX_CHROME = padY × 2 + headerH + headerGap = 11.0`
（红框比第一题的内容高出这么多）

> ⚠️ **不要借用 `--outer-pad-y`**。那是选择题红框的（1mm），
> 两者量级不同，共用会让选择题红框变高。
>
> ⚠️ 栏目头用 `height` 固定高，不用 `auto`；表格用
> `border-collapse: separate`，不用 `collapse` —— collapse 会把边框摊到行上，
> 表格总高比「各行高之和」多约 1.04mm，且这个偏差与行数无关。

### 6.5.2 非选择题单题高（分页器的关键输入）

```
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
> 不补这一项，分页器算出的红框比真实渲染矮 1mm/题，最后一题压到页脚上。

### 6.5.3 页脚位置

页脚是**两行**，位置照参照件定，不是「贴纸底 4mm」：

| 参照件实测（`.ref/a4_bbox.xml`） | y |
|---|---|
| 非选择题红框下沿 | 273.30 |
| 「请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效」 | **274.28 → 278.17** |
| 「xx 第 N 面（共 M 面）」 | 279.57 → 283.90 |

因此 `BOTTOM_RESERVE = 23.7`（= 297 − 273.3）：正文红框最多到 273.3mm，
往下就是页脚的地盘。CSS `.as-footer { bottom: 12.9mm }`
（= 297 − 284.1，块底约 284.1mm）。

> ⚠️ 这句话在参照件里**只出现一次**，就在这个位置 —— 不是每题都印。
> 之前 `BOTTOM_RESERVE = 14` + `.as-footer { bottom: 4mm }`，
> 该句落在 283.16mm，比参照件低 9mm，还和红框重叠。

### 6.5.4 纵向常量速查

| 常量 | 位置 | 值 |
|---|---|---|
| `CHROME.rowGap` | `js/builders/page.js` | 5 |
| `SECTION_GAP` | `js/config.js` | 5 |
| `BOTTOM_RESERVE` | `js/paginator.js` | 23.7 |
| `SUBJ_CHROME` | `js/paginator.js` | `{padY:2.5, headerH:5.0, headerGap:1.0}` |
| `HEAD_H` | `js/builders/subject.js` | 5.0 |
| `ROW_OVERHEAD` | `js/builders/subject.js` | 1.039 |
| `.as-footer bottom` | `css/card.css` | 12.9mm |

'''

s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('spec 6.5.x updated')
