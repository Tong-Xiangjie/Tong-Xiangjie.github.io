import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/builders/subject.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

OLD = """  /* 表格排版余量（mm/题）。
     \u26a0 这是**实测标定**出来的，不是随手加的：Chrome 在表格行里排
     「块级子元素」时，行的实际高度比「子元素高度之和 + 单元格内边距 + 线宽」
     多出一个**与行数无关**的常数。
     用 .ref/subj_fit.mjs 在 4/8/12 行三档上回归：斜率恰好是 7.700mm/行
     （= lineH，完全吻合），截距恒为 11.039mm，而模型的固定项是 10.000mm，
     所以每题的固定偏差 = 1.039mm。
     不补这一项，分页器算出的红框就比真实渲染的矮 1mm/题，
     最后一题会压到页脚上。border-collapse 已改成 separate（盒模型可加），
     剩下的这一项是行盒本身的开销，改不掉，只能标定。 */
  var ROW_OVERHEAD = 1.039;"""

NEW = """  /* 黑框表格的「固定开销」（mm/题），与行数无关。
     \u26a0\u26a0 2026 重测（.ref/pitch2.cjs，在**真实卡片**里量单题表格）：
        表格实测高 = **6.700 + 7.700 × 行数**（1/2/3/4/6/8/10/12/16 行九档
        逐档吻合到 0.002mm）。
        其中 6.700 = 题头 5.000 + 1.700。
        1.700 的来历：黑框上边框 0.3（表格 border-top 摊到首行）
                        + 题头盒与首行作答区之间的行盒开销 1.4。
        ⚠ 表格**没有**单元格内边距参与：CSS 写的是
          `padding: var(--inner-pad-x)`，而 --inner-pad-x 是**长度**不是
          上下两值，Chrome 解析后 td 实测 padding-top/bottom 都是 2.5mm，
          但它们被 `box-sizing: border-box` 吃进了行高 —— 不能再单独加。
        ⚠ 旧值 1.039 是在**脱离文档流的隐藏容器**里标定的，那个容器没有
          舞台缩放，量出来的表格高比真实卡片**矮 6.04mm**（实测九档全部
          -6.04）。结果 itemHeight 每题**多算 6.04mm**，分页器据此把
          非选择题红框定得比黑框矮 → 黑框整条溢出红框（实测溢出 16~20mm，
          且「非选择题还没排完就换页」）。这就是那个回归的根源。 */
  var ROW_OVERHEAD = 1.7;"""
rep(OLD, NEW, 'ROW_OVERHEAD 1.039 -> 1.7')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
