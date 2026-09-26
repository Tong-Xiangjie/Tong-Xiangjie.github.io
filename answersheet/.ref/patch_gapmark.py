import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

# 1) 抽出「气泡行节距」为单一来源
old_bh = """  function bubbleH(p) {"""
idx = s.index(old_bh)
# 在 rowOffsets 之前插入 rowPitch helper
anchor = "  function rowOffsets(p) {"
assert anchor in s
helper = """  /** 气泡行之间的**行节距**（行心到行心，mm）= colGap + bubbleH。
   *  「行间空档」定位点必须按**同一个节距**接在上一行末气泡之后 ——
   *  用户指出「空出来的高度对应的那一行与上下定位点高度不均匀，
   *  比正常的高度要低」，就是因为原先把它放在两行正中间，
   *  与上下各差了约 0.55mm。 */
  function rowPitch(p) {
    return r3(p.colGap + bubbleH(p));
  }

"""
s = s.replace(anchor, helper + anchor, 1)

# 2) gapMarkOffset 改成「延续上一行节距」
old_gm = s.index("  function lineGapMarkOffset(p) {")
old_gm_end = s.index("  }", old_gm) + len("  }")
s = s[:old_gm] + """  function lineGapMarkOffset(p) {
    /* 空档定位点按**与气泡行相同的节距**接在上一行末气泡行之后：
         空档块心 = 下一行题号块心 − rowOffsets[0] − rowPitch
       其中 rowOffsets[0] 是下一行行顶到下一行题号块心的距离。
       相对**下一行行顶**即为 rowOffsets[0] − rowOffsets[0] − rowPitch
       = −rowPitch。
       ⚠ 不要放「上一行末气泡」与「下一行题号」的正中间：那样空档行与
         上下两行的间距各约 2.67mm，而正常节距是 4.29mm，看起来就是
         「这一行比正常高度低」（用户实测指出）。 */
    return r3(-rowPitch(p));
  }""" + s[old_gm_end:]

# 3) 导出 rowPitch
s = s.replace("    lineGapMarkOffset: lineGapMarkOffset,",
              "    lineGapMarkOffset: lineGapMarkOffset,\n    rowPitch: rowPitch,", 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
