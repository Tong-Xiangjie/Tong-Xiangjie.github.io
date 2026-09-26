import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
p = '答题卡排版规格.md'
s = io.open(p, encoding='utf-8').read()

old = """| 语句 | 出现次数 | 位置 |
|---|---|---|
| `(提示：请用2B铅笔在正确答案上填涂…)` | **全卡 1 次** | 选择题栏目头（仅第一行所在面） |
| `(提示：请用0.5毫米黑色签字笔作答…)` | **全卡 1 次** | 非选择题栏目头（仅第一题所在面） |
| `请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效` | **每面非选择题各 1 次** | 非选择题**红框与黑框之间** |

「红框与黑框之间」的空档在两种情形下方向不同，由 `subject.render` 决定：

```
本面印了栏目头（第一题所在面） → 语句放黑框**下方**
本面没印栏目头（续排面）        → 语句放黑框**上方**
```

这样无论哪种情形，语句都夹在红黑两框之间。"""

new = """| 语句 | 出现次数 | 位置 |
|---|---|---|
| `(提示：请用2B铅笔在正确答案上填涂…)` | **全卡 1 次** | 选择题栏目头（仅第一行所在面） |
| `(提示：请用0.5毫米黑色签字笔作答…)` | **全卡 1 次** | 非选择题栏目头（仅第一题所在面） |
| `请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效` | **每面非选择题各 1 次** | 非选择题**黑框下方、红框内缘上方**那段空档 |

**这句话不在页脚。** 页脚（`.as-footer`）由 `page.js` 对**每个面**渲染一次，
放页脚会全卡重复印；页脚只印「科目　第 N 面（共 M 面）」。

语句的位置固定是「黑框**下方**」那一段 —— 不是「有栏目头就放下、没有就放上」。
放上面的话续排面会挤在栏目头本来的位置上，视觉上跟第一面不一致：

```
第 1 面（印栏目头）              第 2 面（续排）
红框 128.269 ────────────       红框  24.999 ────────────
  上内边距 2.5                    上内边距 2.5
  栏目头   131.031（全卡唯一）    黑框    27.761 ────
  黑框     137.025 ────            ... 
  黑框     209.145 ────          黑框   171.735 ────
  语句     211.142 ← 下空档       语句   173.732 ← 下空档
红框 223.499 ────────────       红框  186.089 ────────────
```

两面的「黑框外缘 → 红框内缘」都是 **3.728mm**（= `SUBJ_CHROME.padYBottom` 6.1 − 常量校准），
语句（4mm 行高）正好落在里面。

红框的下内边距因此比上内边距大（`SUBJ_CHROME.padYBottom` 6.1 vs `padY` 2.5），
`SUBJ_BOX_CHROME` = `padY + headerH + headerGap + padYBottom`；
`--subj-pad-y-bottom` 由 `theme.js` 写入，和分页器同源。"""

assert old in s, 'gap block not found'
s = s.replace(old, new, 1)

old2 = """| `SUBJ_CHROME.tipH` / `tipGap` | `js/paginator.js` | 4.0 / 1.0 |"""
new2 = """| `SUBJ_CHROME.tipH` / `tipGap` | `js/paginator.js` | 4.0 / 1.0 |
| `SUBJ_CHROME.padYBottom` | `js/paginator.js` | 6.1（红框下内边距，装页内语句） |"""
assert old2 in s, 'const table not found'
s = s.replace(old2, new2, 1)

old3 = """- 栏目头只印一次：`itemHeight(lines, lineH, withHeader)` 只有第一题摊
  栏目头的高度；`app.js` 用 `subjItems.some(b => b.first)` 决定
  `showHeader`。分页器的 `SUBJ_BOX_CHROME` 取「栏目头」与「语句」
  两种占高的**较大者**（续排面用语句顶替栏目头）。"""
new3 = """- 栏目头只印一次：`itemHeight(lines, lineH, withHeader)` 只有第一题摊
  栏目头的高度；`app.js` 用 `subjItems.some(b => b.first)` 决定
  `showHeader`。语句是每面都印的**恒定**占位，所以 `SUBJ_BOX_CHROME`
  直接把 `padYBottom` 算进去，不再取 max。"""
assert old3 in s, 'note not found'
s = s.replace(old3, new3, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('spec updated (patch8)')
