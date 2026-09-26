import io, sys
sys.stdout.reconfigure(encoding='utf-8')
n = 0
def rep(path, old, new, tag):
    global n
    s = io.open(path, encoding='utf-8').read()
    assert old in s, tag + ' :: ' + path
    io.open(path, 'w', encoding='utf-8', newline='').write(s.replace(old, new, 1))
    n += 1
    print('  ok:', tag)

s = io.open('js/paginator.js', encoding='utf-8').read()
i = s.find('function frameTail')
j = s.find('\n  }', i) + 4
print('--- 旧 frameTail ---')
print(s[max(0, i - 700):j])

rep('js/paginator.js',
"""  var FRAME_TAIL_A = 5.922;
  var FRAME_TAIL_R = 0.960;""",
"""  /* ⚠ 2026 已作废：FRAME_TAIL_A / FRAME_TAIL_R 是「红框底 − 游标」的
     线性回归系数，当年之所以要回归，是因为**红框高度跟着内容变**，
     浏览器又按 device px 吸附每行盒高，导致偏移量跨度 17mm、拟合不出。
     现在红框高度写成常量（G.frameHeight = 264.848），
     「红框底 = 游标 + FRAME_H」是恒等式，回归式彻底不需要了。 */
  var FRAME_TAIL_A = 5.922;
  var FRAME_TAIL_R = 0.960;""", 'frameTail 注释')

rep('js/paginator.js',
"""      var rest = r3(bottomLimit - cursor - frameTail(subjRows));""",
"""      /* ⚠ 红框高度已是常量 ⇒ 红框底 = 本面红框起点 + frameH，**不需要**
         subjRows 回归。用差式就能精确判「还剩多少」。 */
      var rest = r3(bottomLimit - cursor - frameH);""", 'rest 用常量')

rep('js/paginator.js',
"""      var subjRows = 0;
      body.forEach(function (b) { if (b.kind === 'subj') subjRows++; });
      /* ⚠ 判据用**未下拉**的红框底估计（cursor + frameTail）：
           「剩余够不够放一个非答题区」。""",
"""      /* ⚠ 判据用**未下拉**的红框底：cursor + frameH。
           「剩余够不够放一个非非答题区」。""", '删 subjRows')

print('total', n)
