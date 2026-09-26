import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = '答题卡排版规格.md'
s = io.open(P, encoding='utf-8').read()
old = """| `BOTTOM_RESERVE` | `js/paginator.js` | 23.7 |
| `SUBJ_CHROME` | `js/paginator.js` | `{padY:2.0, padYBottom:2.0, headerH:5.0, headerGap:1.0, tipH:4.0, tipGap:1.0}` |
| `SUBJ_BOX_CHROME` | `js/paginator.js` | 16.0（红框「框体装饰」总高，一面只加一次） |
| `SPLIT_MIN_LINES` | `js/paginator.js` | 3（切开一题时本面至少留几行） |
| `HEAD_H` | `js/builders/subject.js` | 5.0 |
| `ROW_OVERHEAD` | `js/builders/subject.js` | 1.039 |
| 页脚 `bottom` | `js/builders/page.js` `footerBottom()` | 8.885mm（A4，内联；底边对齐下角标） |"""
new = """| `SUBJ_CHROME` | `js/paginator.js` | `{padY:0.5, padYBottom:0.5, headerH:5.0, headerGap:1.0, tipH:4.0, tipGap:0.5}` |
| `SUBJ_BOX_CHROME` | `js/paginator.js` | 6.879（红框顶 → 黑框顶的实测距离；只用于自检与探针） |
| `SUBJ_ITEM_PITCH` | `js/paginator.js` | **6.3**（每段非选择题对游标的额外推进量） |
| `SPLIT_MIN_LINES` | `js/paginator.js` | 2（切开一题时本面至少留几行） |
| `NOANSWER_MIN_H` | `js/paginator.js` | 15（低于此值不画非答题区，改拉长答题区） |
| `FRAME_TOP_GAP` | `js/paginator.js` | 2.0（首页页眉底 → 红框顶） |
| `STRETCH_K` | `js/paginator.js` | 1.3327 |
| `HEAD_H` | `js/builders/subject.js` | 5.0 |
| `ROW_OVERHEAD` | `js/builders/subject.js` | **1.3** ⇒ `itemHeight = 11.3 + 7.7 × lines` |
| 页脚 `top` | `js/builders/page.js` `footerBottom()` | 286mm = `H − TOP_BAND_CY`，配 `transform:translateY(-50%)`（块心钉在下定位点行心） |"""
assert old in s
s = s.replace(old, new, 1)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('§6.5.4 速查表已更新')
