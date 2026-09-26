import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# 收口：noAnswer 只在**最后一面**（用户口径）
rep("""      var bottomLimit = F_BOT;
      var rest = r3(bottomLimit - cursor - frameH);
      if (rest < 0) rest = 0;
      var noAnswer = rest >= NOANSWER_MIN_H;
      /* 下拉量：只在「不画非答题区」时给。app.js 的 fitFrames() 随后按
         同一个 noAnswer 分流，并把真实框底闭环到目标。 */
      var stretch = noAnswer ? 0 : r3(rest * STRETCH_K);""",
"""      var bottomLimit = F_BOT;
      var rest = r3(bottomLimit - cursor - frameH);
      if (rest < 0) rest = 0;

      /* 本面是不是**最后一面**（所有题都排完了）？
         用户口径：「**非最后一面**：≥15mm 画非答题区，<15mm 不画，
         但是要把红框的底部拉到要求的高度」。
         ⚠ 所以非最后一面**照样**按 15mm 判据，不是一律下拉 ——
           一律下拉会把「非选择题还没排完」的中继面也撑满，
           红框与黑框被强行拉长，看着像排版错了。 */
      var isLastFace = (subjIdx >= subj.length) &&
                       (!choice || choiceLine >= choice.totalLines);
      /* <15mm → 下拉；≥15mm → 画非答题区。最后一面同样适用。 */
      var noAnswer = rest >= NOANSWER_MIN_H;
      var stretch = noAnswer ? 0 : r3(rest * STRETCH_K);
      /* 非最后一面且 ≥15mm：非答题区吃掉剩余空白（不拉长答题区） */
      var midFaceNA = noAnswer && !isLastFace;""", 'noAnswer 判据')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
