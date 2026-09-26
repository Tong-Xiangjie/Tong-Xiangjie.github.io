import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'css/card.css'
s = io.open(p, encoding='utf-8').read()

old = """  /* ⚠ 这里以前写的是 `gap: -3mm`。flex 的 gap 不接受负值，浏览器把整条
     声明判为无效（computed value = normal），于是元素之间**一点空隙都没有**
     —— 用户看到的就是「姓名横线和班级贴在一起」。负间距其实一直是由
     .as-info-fill 的 `margin-bottom:-5mm` 在「假装」承担，而那只是把下划线
     往下拽，并没有制造水平空隙。
     现在用正的 gap = 5mm：用户要求「姓名的横线和班级之间要留一定空隙，
     班级的横线与准考证号同理」。 */
  gap: 5mm;"""
new = """  /* ⚠ 这里**不要**用 flex 的 `gap`。以前写的是 `gap: -3mm`，而 flex 的 gap
     不接受负值，浏览器把整条声明判为无效（computed value = normal），
     于是元素之间一点空隙都没有 —— 用户看到的「姓名横线和班级贴在一起」。
     改用 `gap` 又走到了另一个极端：**每一处**相邻元素都被撑开 5mm，连
     「姓名：」和它自己的横线之间也多了 5mm，用户明确说这不对
     ——「我只要求姓名横线与班级间距大一点，没有说和姓名的间距也要拉大」。
     所以空隙只加在**标签之前**：给 .as-info-label 一个 margin-left，
     该标签自己的横线（前一个元素）贴着它，标签到横线不留缝。 */
  gap: 0;"""
assert old in s, 'gap block not found'
s = s.replace(old, new, 1)

old2 = """.as-info-label { font-weight: 500; white-space: nowrap; }"""
new2 = """.as-info-label {
  font-weight: 500;
  white-space: nowrap;
  /* 「姓名：」前面没有横线，margin-left 由下面按需覆盖。
     「班级：」「准考证号」前面的 margin-left 就是用户要的空隙：
         [姓名横线] 5mm [班级：] 0 [班级横线] 5mm [准考证号]
       即横线紧贴它自己的标签，空隙只出现在「横线 → 下一个标签」之间。 */
  margin-left: 5mm;
}
/* 行首的「姓名：」前不需要空隙 */
.as-info-row > .as-info-label:first-child { margin-left: 0; }"""
assert old2 in s, 'label rule not found'
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
