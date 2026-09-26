import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = '答题卡排版规格.md'
s = io.open(p, encoding='utf-8').read()

start = s.index('### 6.5 纵向骨架与版块间距')
end = s.index('### 6.6 定位块')

new = '''### 6.5 纵向骨架与版块间距

**共 5 处纵向间距**，全部由两个参数控制：

| 参数 | 位置 | 值 | 管哪几处 |
|---|---|---|---|
| `CHROME.rowGap` | `js/builders/page.js` | 5 | 页眉内部：标题→信息、信息→注意事项 |
| `SECTION_GAP` | `js/config.js` | 5 | 正文版块：注意事项→选择题、选择题→非选择题 |

```
页顶 0
├─ 标题行                              0 → 31.68
│      ← rowGap 5.00
├─ 信息行（姓名/班级/准考证号）      36.68 → 44.94
│      ← rowGap 5.00
├─ 注意事项 + 条形码                 49.94 → 82.94
│      ← SECTION_GAP 5.01
├─ 选择题红框                        87.95 → 117.57
│      ← SECTION_GAP 5.09
├─ 非选择题红框                     122.65 → 276.30
│      ← 自动（页脚前的剩余空间）
└─ 页脚                             283.16 → 293.00
```

> ⚠️ **页眉三行间距用 CSS grid 的 `row-gap`**（`--head-row-gap`，由
> `Page.headVars()` 内联写到 `.as-page`）。行高本身不用改，但
> `CHROME.firstBottom` **必须把两道 gap 加进去** —— 它是正文起点的唯一来源，
> 漏加正文会压住注意事项框。
>
> ⚠️ **`SECTION_GAP` 的判定条件是「本面最后一个块不是 subj」**，不是
> 「本面为空」。原来的写法只在本面第一个块前留间距，于是选择题和非选择题
> 同面时（最常见的情况）**间距恒为 0**（实测 0.086mm）。正确规则：
>
> | 本面情况 | 是否留间距 |
> |---|---|
> | 页眉 + 选择题 | 留（body 为空） |
> | 页眉 + 非选择题 | 留（body 为空） |
> | 选择题 + 非选择题（同面） | 留（末块是 choice） |
> | 续排的选择题行 | 不留（上一行下沿自然给出） |
> | 续排的非选择题题 | 不留（上一题下沿自然给出） |

### 6.5.1 选择题红/黑框的纵向量

| 量 | 值 | 由什么决定 |
|---|---|---|
| `border` | 0.3 | 红/黑框线宽 |
| `outerPadY` / `outerPadYBottom` | 1 / 1 | 红框上下内边距 |
| `outerPadX` | **0** | 红框左右不留内边距，黑框位置由 `boxGap` 的 margin 给出 |
| `headerH` / `headerGap` | 5 / 1 | 栏目头及其下间距 |
| `choiceHeadH` | 6.3 | 红框顶 → **黑框边框盒**上缘 |
| `choiceChromeH` | 6.6 | 红框顶 → **网格顶**上缘 |
| `choiceFootH` | 1.6 | 网格底 → **红框外缘底** |

> ⚠️ `choiceHeadH` 与 `choiceChromeH` 现在只差**一道黑框线**（黑框已无内边距）。
> 分页器用后者把网格排在 `boxTop + choiceChromeH`；
> builder 由 `gridTop` 反推黑框的 `margin-top`。
>
> ⚠️ 分页器游标要推到 **`choiceFootH`（红框外缘底）**，不能停在网格底，
> 否则非选择题会压住红框下沿（实测重叠 896.6mm²）。

'''

s = s[:start] + new + s[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('spec 6.5 updated')
