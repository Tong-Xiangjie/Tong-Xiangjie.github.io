import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# ① 新增常量
rep("""  var SUBJ_ITEM_PITCH = 6.3;""",
"""  var SUBJ_ITEM_PITCH = 6.3;

  /* 作答行**单行最多能长到天然行高的几倍**（用户选定「把空白摊进作答行」）。
     ⚠ 必须有上限：A4 一面的红框能装 260mm 内容，而「0 选择 + 1 题」
       这种极端配置只剩一行段要吃掉 175mm 空白 —— 不封顶会得到 40mm
       高的「一行」，看着不像答题卡。封顶后剩余空白留给 fitFrames 收口
       （红框照样拉到下界，只是黑框不跟着长，是「答题区底部留白」，用户允许）。 */
  var FILL_LINE_MAX_K = 2.2;""", 'FILL_LINE_MAX_K')

# ② 收口：用 fill 取代 stretch
rep("""      var noAnswer = rest >= NOANSWER_MIN_H;
      var stretch = noAnswer ? 0 : r3(rest * STRETCH_K);
      /* 非最后一面且 ≥15mm：非答题区吃掉剩余空白（不拉长答题区） */
      var midFaceNA = noAnswer && !isLastFace;""",
"""      var noAnswer = rest >= NOANSWER_MIN_H;

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
        var gap = r3(F_BOT - cursor - footReserve());
        var totalLines = 0;
        var segIdx = 0;
        var idxOf = [];
        body.forEach(function (b) {
          if (b.kind !== 'subj') return;
          idxOf.push(segIdx);
          totalLines += b.lines;
          segIdx++;
        });
        if (gap > 0.05 && totalLines > 0) {
          /* 每行增量：先按平均分，再按 FILL_LINE_MAX_K 封顶 */
          var natH = (subj[0] && subj[0].lineH) || 7.7;
          var perLine = gap / totalLines;
          var cap = r3(natH * (FILL_LINE_MAX_K - 1));
          if (perLine > cap) perLine = cap;
          perLine = Math.floor(perLine * 1000) / 1000;
          if (perLine > 0.001) {
            fill = { pitch: perLine, segs: {} };
            var si = 0;
            body.forEach(function (b) {
              if (b.kind !== 'subj') return;
              fill.segs[si] = r3(perLine * b.lines);
              si++;
            });
          }
        }
      }
      var midFaceNA = noAnswer && !isLastFace;""", 'fill 计算')

# ③ 自然底带上 fill
rep("""        var subjCH = 0;
        body.forEach(function (b) {
          if (b.kind === 'subj') subjCH = r3(subjCH + b.h + SUBJ_ITEM_PITCH);
        });
        subjNaturalBottom = r3(subjBoxTop + subjCH + stretch);""",
"""        var subjCH = 0;
        var si2 = 0;
        body.forEach(function (b) {
          if (b.kind !== 'subj') return;
          var extra = (fill && fill.segs[si2]) || 0;
          subjCH = r3(subjCH + b.h + extra + SUBJ_ITEM_PITCH);
          si2++;
        });
        subjNaturalBottom = r3(subjBoxTop + subjCH);""", '自然底带 fill')

# ④ 面记录带上 fill
rep("""        stretch: stretch,""", """        stretch: stretch,
        fill: fill,""", '面记录 fill')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('paginator', n)
