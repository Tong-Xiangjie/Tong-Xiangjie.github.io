import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# ① 每段推进量 = 段高 + 单元格的块级开销（实测 6.3）
rep("""  var SUBJ_ITEM_FIX = 0;""",
"""  var SUBJ_ITEM_FIX = 0;

  /* 非选择题**每段对游标的推进量** = it.h + SUBJ_ITEM_PITCH。
     ⚠ 为什么不是只有 it.h：
       it.h = subject.itemHeight() = 11.3 + 7.7n，是「表格行盒」的高；
       而每一行渲染出来的实际推进量还多 **6.3mm** —— 单元格里
       .as-subj-head 是 flex、.as-subj-body 是 block，两者的盒模型让
       单元格（td）比「行盒高」高 6.3mm（实测 .ref/layout.cjs /
       .ref/domchain.cjs：12 选择+2 题，首题 td 底 − 红框内容顶 = 63.5，
       而 itemHeight(6) = 51.2）。
     ⚠ 旧值把这一项错记成 0，于是分页器以为本面还能再放一题，
       实际放不下 —— 正是用户报的「非选择题还没排完就自动换页 / 溢出」。 */
  var SUBJ_ITEM_PITCH = 6.3;""", 'SUBJ_ITEM_PITCH')

# ② 推进量用它
rep("""        var baseH = r3(it.h);""",
"""        var baseH = r3(it.h + SUBJ_ITEM_PITCH);""", 'baseH = it.h + PITCH')

# ③ 自然底也用同一个推进量
rep("""        var subjCH = 0;
        body.forEach(function (b) {
          if (b.kind === 'subj') subjCH = r3(subjCH + b.h);
        });
        subjNaturalBottom = r3(subjBoxTop + SUBJ_BOX_CHROME + subjCH + stretch);""",
"""        var subjCH = 0;
        body.forEach(function (b) {
          if (b.kind === 'subj') subjCH = r3(subjCH + b.h + SUBJ_ITEM_PITCH);
        });
        subjNaturalBottom = r3(subjBoxTop + subjCH + stretch);""", '自然底用推进量')

# ④ 导出
rep("""    SUBJ_ITEM_FIX: SUBJ_ITEM_FIX,""",
"""    SUBJ_ITEM_FIX: SUBJ_ITEM_FIX,
    SUBJ_ITEM_PITCH: SUBJ_ITEM_PITCH,""", '导出 PITCH')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
