import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0

def rep(old, new, tag):
    global s, n
    assert old in s, tag
    s = s.replace(old, new, 1)
    n += 1
    print('  ok:', tag)

rep("""  function footReserve() {
    return r3(frameBottomH() + FOOTER_H + FOOTER_PAD);
  }""",
"""  function footReserve() {
    /* ⚠ 用户 2026 把页脚从红框解耦（固定在下方定位点中心的高度），
       所以这里**不再**预留 FOOTER_H / FOOTER_PAD —— 红框可以一直长到
       geometry.frameBottomLimit() = answerBottom + 0.7×cornerH。
       历史口径是 frameBottomH() + FOOTER_H + FOOTER_PAD = 11.0。 */
    return frameBottomH();
  }""", 'footReserve')

rep("""    var A_TOP = G.answerTop(p);
    var A_BOT = G.answerBottom(p, PAGE_H);""",
"""    var A_TOP = G.answerTop(p);
    var A_BOT = G.answerBottom(p, PAGE_H);
    /* 红框可覆盖范围 —— 用户 2026 指定「上缘可往上拉 0.7 个定位点高、
       下缘可往下拉 0.7 个」。A_TOP/A_BOT 仍是**答题区**（内容不许越过），
       F_TOP/F_BOT 是**红框**的硬边界（框可以比内容区多出 0.7×cornerH）。 */
    var F_TOP = G.frameTopLimit(p);
    var F_BOT = G.frameBottomLimit(p, PAGE_H);""", 'F_TOP/F_BOT')

rep("        var gridRoom = r3(A_BOT - cursor - chromeTop - footTop - footReserve() - EPS_MM);",
    "        var gridRoom = r3(F_BOT - cursor - chromeTop - footTop - footReserve() - EPS_MM);",
    'gridRoom')

rep("          var availH = r3(A_BOT - cursor - footReserve());",
    "          var availH = r3(F_BOT - cursor - footReserve());",
    'availH')

rep("""          var fitsNext = r3(baseH + segLines * it.lineH) <=
                         r3(A_BOT - A_TOP - footReserve());""",
"""          var fitsNext = r3(baseH + segLines * it.lineH) <=
                         r3(F_BOT - F_TOP - footReserve());""", 'fitsNext')

rep("      var bottomLimit = r3(A_BOT - FOOTER_H - FOOTER_PAD);",
"""      /* 红框下缘的目标位置 = 红框可达的最低点（= 答题区下界 + 0.7×cornerH）。
         ⚠ 这里**不再**减页脚 —— 页脚已固定在下方定位点中心的高度，
           与红框无关。 */
      var bottomLimit = F_BOT;""", 'bottomLimit')

rep("""      answerTop: A_TOP,
      answerBottom: A_BOT,""",
"""      answerTop: A_TOP,
      answerBottom: A_BOT,
      frameTopLimit: F_TOP,
      frameBottomLimit: F_BOT,""", 'lastDebug')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('paginator:', n, 'replacements')
