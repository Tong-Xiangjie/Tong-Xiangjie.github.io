import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# ── 收口：rest 判据 + noAnswer 只在最后一面 + fill 用真实剩余量 ─────────────
rep("""      /* ── 收口 ────────────────────────────────────────────────────────
         红框下缘 = 红框固定下缘 F_BOT。
         判据用**未下拉**的红框底 = cursor + frameH（恒等式，不是估计）。 */
      var bottomLimit = F_BOT;
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

      /* ── 剩余空白的去向（用户 2026 选定）─────────────────────────────
         用户：「把空白摊进作答行，让答题区填满整面」。
         所以这里不再用旧的 `stretch`（只拉长最后一段），改成算一个
         **每行增量**，平均摊给本面**所有**非选择题段的所有作答行。

         fill.pitch = 每行增量（mm），fill.segs = {段序号: 该段的增量}
         app.js 的 renderFaceBody 按段把 lineH 加高；
         subject.itemHeight(lines, lineH) 会跟着变，所以红框/黑框同步长高。 */
      var stretch = 0;
      var fill = null;
      if (!noAnswer && subj.length) {
        /* 能吃的空间 = 红框下界 − 本面游标 − 页脚预留 */
        var gap = r3(F_BOT - cursor - footReserve());""",
"""      /* ── 收口 ────────────────────────────────────────────────────────
         红框下缘 = 红框固定下缘 F_BOT。
         `rest` = 本面排完正文后、**红框还能往下走多少**。

         ⚠ 判据必须是 `F_BOT − cursor`，**不是** `F_BOT − cursor − frameH`。
           后者把「整段红框高度常量」当成了「本面已占高」——
           一面同时有选择框 + 非选择框时（12 选择 + 2 题），
           `cursor + frameH` 远超 F_BOT，`rest` 恒被夹成 0，
           于是每次收口判 `noAnswer = false`，非答题区永远不画。 */
      var bottomLimit = F_BOT;
      var rest = r3(bottomLimit - cursor);
      if (rest < 0) rest = 0;

      /* 本面是不是**最后一面**（所有题都排完了）？ */
      var isLastFace = (subjIdx >= subj.length) &&
                       (!choice || choiceLine >= choice.totalLines);

      /* ── 剩余空白的去向（用户 2026 定稿）────────────────────────────
         用户：「现在整面都是非答题区的红框高度和位置非常好，就以这个为标准」
             「把空白摊进作答行，让答题区填满整面」。

         所以分流是**按面的角色**，不是按 rest 大小：

         · 非最后一面（正文还没排完，后面还有面）
             → 把剩余空白**摊进本面非选择题的作答行**（fill）。
               一面非选择题红框正好被填到 F_BOT，
               「答题卡应该优先填满全部区域再换页」由构造满足。
         · 最后一面（正文已排完）
             → rest ≥ NOANSWER_MIN_H(15mm)：画**非答题区**，钉到 F_BOT
               （用户认可的标准框：top = frameTopLimit、h = frameHeight）；
               rest < 15mm：把剩余空白摊进作答行。
         · 一面只有选择题、没有非选择题（没有作答行可摊）
             → 红框靠 fitFrames 量测收口到 F_BOT（答题区底部留白，用户允许）。

         fill.pitch = 每行增量（mm），fill.segs = {段序号: 该段的增量}
         app.js 的 renderFaceBody 按段把 lineH 加高；
         subject.itemHeight(lines, lineH) 会跟着变，所以红框/黑框同步长高。 */
      var stretch = 0;
      var fill = null;
      var noAnswer = false;
      if (isLastFace && rest >= NOANSWER_MIN_H) {
        noAnswer = true;
      } else if (subj.length) {
        /* 能吃的空间 = 红框下界 − 本面游标 − 页脚预留 */
        var gap = r3(F_BOT - cursor - footReserve());""", '收口判据 + 分流')

# 收尾：去掉 midFaceNA（已不需要）
rep("""      var midFaceNA = noAnswer && !isLastFace;""",
"""      /* 非最后一面不再画非答题区 —— 它的空白由 fill 吃掉。 */""", '去掉 midFaceNA')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
