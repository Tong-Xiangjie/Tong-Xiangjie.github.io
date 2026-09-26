import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

rep("""      var subjBoxTop = null;
      body.forEach(function (b) {
        if (b.kind === 'subj' && subjBoxTop === null) subjBoxTop = b.boxTop;
      });
      var subjBoxBottom = F_BOT;
      if (noAnswer && subjBoxTop !== null) {
        subjBoxBottom = r3(Math.max(subjBoxTop, F_BOT - rest));
      }
""",
"""      var subjBoxTop = null;
      body.forEach(function (b) {
        if (b.kind === 'subj' && subjBoxTop === null) subjBoxTop = b.boxTop;
      });
      /* 非选择题内容的**自然底** = 各段内容高之和 + 已定的下拉量。
         ⚠ 不能直接拿 F_BOT 当框底：框一旦被撑到比内容高，黑框表格会被
           一起撑高并溢出红框（实测 40 选择+2 题：黑框 282.555 > 红框 280.926）。
         两条限制同时成立才对：
           · 红框底 = min(内容自然底, F_BOT)              ← 不越过固定下缘
           · 非答题区顶 = 红框底，高 = F_BOT − 红框底      ← 吃掉剩下的
         这样「≥15mm 就画非答题区」与「红框拉高」不再互斥：
         内容短 → 框拉高后仍有剩余 → 剩下的就是非答题区。 */
      var subjNaturalBottom = null;
      if (subjBoxTop !== null) {
        var subjCH = 0;
        body.forEach(function (b) {
          if (b.kind === 'subj') subjCH = r3(subjCH + b.h);
        });
        subjNaturalBottom = r3(subjBoxTop + subjCH + stretch);
      }
""", '自然底')

rep("""        stretch: stretch,
        subjBoxBottom: subjBoxBottom,
        rest: rest,""",
"""        stretch: stretch,
        subjBoxBottom: subjNaturalBottom,
        rest: rest,""", 'face 记录改自然底')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
