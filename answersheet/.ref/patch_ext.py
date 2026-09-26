import io, sys
sys.stdout.reconfigure(encoding='utf-8')

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ═══════════════════════════════════════════════════════════════════════
# geometry.js —— 红框超出答题区的量（0.7 个定位点高）
# ═══════════════════════════════════════════════════════════════════════
P = 'js/geometry.js'
s = rd(P)

anchor = "  function frameGap(preset) {"
i = s.find(anchor)
assert i > 0, 'frameGap'
j = s.find('\n  }', i) + 4
print('--- frameGap 原文 ---')
print(s[i:j])

new = """  /* 红框允许超出答题区上下界的量 —— 用户 2026 指定：
     「红色边框上缘可以往上拉 0.7 个黑色定位点高度，下缘可以往下拉 0.7 个」。
     A4: cornerH = 4.23 → 0.7 × 4.23 = 2.961mm。

     ⇒ 红框可覆盖的纵向范围（不是答题区，答题区仍是 answerTop..answerBottom）：
          红框上缘上限 = answerTop  − frameExtend(p)
          红框下缘下限 = answerBottom + frameExtend(p)
     这两条是**硬边界**：分页器不得把红框推出去，否则会压到角落定位点。 */
  var FRAME_EXTEND_K = 0.7;
  function frameExtend(preset) {
    var p = preset || PRESETS.A4;
    return r3(FRAME_EXTEND_K * p.cornerH);
  }
  /** 红框上缘能达到的最高位置 */
  function frameTopLimit(preset) {
    return r3(answerTop(preset) - frameExtend(preset));
  }
  /** 红框下缘能达到的最低位置 */
  function frameBottomLimit(preset, paperH) {
    return r3(answerBottom(preset, paperH) + frameExtend(preset));
  }

""" + s[i:j]
s = s[:i] + new + s[j:]

# 导出
old_exp = "    frameGap: frameGap,"
assert old_exp in s, 'export frameGap'
s = s.replace(old_exp,
"""    frameGap: frameGap,
    frameExtend: frameExtend,
    frameTopLimit: frameTopLimit,
    frameBottomLimit: frameBottomLimit,""", 1)

wr(P, s)
print('geometry.js ok')
