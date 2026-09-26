import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

old_gm = s.index("  function lineGapMarkOffset(p) {")
old_gm_end = s.index("  }", old_gm) + len("  }")
new_gm = """  function lineGapMarkOffset(p) {
    /* 空档定位点按**与气泡行相同的节距**接在上一行末气泡行之后：
         空档块心 = 上一行末气泡块心 + rowPitch
       即相对**上一行行顶** = rowOffsets[last] + rowPitch。
       由于调用方是把它加到**下一行**的 base 上，所以这里再减掉行高：
         相对下一行行顶 = rowOffsets[last] + rowPitch − lineHeight
       化简：lineHeight = columnHeight + lineGapH，
             columnHeight = rowOffsets[last] + bubbleH/2，
             rowPitch = colGap + bubbleH
       ⇒ = rowPitch − (bubbleH/2 + lineGapH)
          = colGap + bubbleH − bubbleH/2 − lineGapH
          = colGap + bubbleH/2 − lineGapH
       ⚠ 不要放在「上一行末气泡」与「下一行题号」的正中间：那样空档行与
         上下两行的间距只有 ~2.67mm，而正常节距是 4.288mm，看起来就是
         「空出来的那一行比正常高度低、与上下定位点不均匀」（用户实测指出）。 */
    return r3(p.colGap + bubbleH(p) / 2 - lineGapH(p));
  }"""
s = s[:old_gm] + new_gm + s[old_gm_end:]

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
