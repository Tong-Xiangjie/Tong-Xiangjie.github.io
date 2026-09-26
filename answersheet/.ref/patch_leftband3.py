import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

old = """  function lineGapMarkOffset(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    /* 空档定位点 = 夹在「上一行末气泡底缘」与「下一行题号上缘」正中间，
       两者相距恰好 lineGapH = n·bubbleH，中点距两端各 n·bubbleH/2。
       相对**下一行行顶**（本行 baseline）：
         下一行题号上缘 = baseline + rowOffsets[0] − numRowH/2
                        = baseline                    （盒顶就在块顶）
         末气泡底缘     = 上一行行顶 + columnHeight
                        = baseline − lineHeight + columnHeight
                        = baseline − lineGapH
       中点 = baseline − lineGapH + n·bubbleH/2 = baseline − n·bubbleH/2
       ⇒ 返回 −n·bubbleH/2。符号为负 = 落在下一行块顶**之上**。 */
    return r3(-n * bubbleH(p) / 2);
  }"""
new = """  function lineGapMarkOffset(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    /* 空档定位点 = 夹在「上一行末气泡**底缘**」与「下一行题号**上缘**」
       正中间，两者相距恰好 lineGapH = n·bubbleH，中点距两端各 n·bubbleH/2。
       相对**下一行行顶**（下一行 baseline）：
         下一行题号上缘 = baseline + rowOffsets[0] − bubbleH/2
         末气泡底缘     = baseline − lineGapH
       ⇒ 中点 = baseline − n·bubbleH + n·bubbleH/2
              = baseline − n·bubbleH/2
       但上面那个「题号上缘」用的是**渲染**位置：题号盒按 rowOffsets[0] 定位、
       盒高吸附成 bubbleH，所以渲染上缘 = baseline + rowOffsets[0] − bubbleH/2。
       两者取中点：
         中点 = baseline + [ (rowOffsets[0] − bubbleH/2) + (−n·bubbleH) ] / 2
              = baseline + (rowOffsets[0] − bubbleH/2 − n·bubbleH)/2
       ⇒ 返回值相对下一行行顶。符号为负 = 落在下一行块顶**之上**。 */
    var offs = rowOffsets(p);
    return r3((offs[0] - bubbleH(p) / 2 - n * bubbleH(p)) / 2);
  }"""
assert old in s, 'lineGapMarkOffset not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
