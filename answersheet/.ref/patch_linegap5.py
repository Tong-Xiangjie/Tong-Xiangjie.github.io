import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

old_lg = """  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p) + rowOffsets(p)[0]);
  }"""
new_lg = """  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p));
  }"""
assert old_lg in s
s = s.replace(old_lg, new_lg, 1)

old_doc_start = s.index("   * 关键：题号行是 flex 居中")
old_doc_end = s.index("   */", old_doc_start) + len("   */")
new_doc = """   * ⚠ **实测标定**（`.ref/cal_gap.cjs`）：把网格 `row-gap` 强制成 4mm / 8mm，
   *   「上行末气泡**底缘** → 下行题号**盒顶缘**」的净空正好等于该 row-gap
   *   （斜率 1、截距 0）。也就是说这段净空**就是** `lineGapH` 本身，
   *   不需要任何补偿项 —— `columnHeight` 恰好停在末气泡底缘，
   *   而题号盒顶缘恰好落在下一行块顶。
   *
   * 所以「空出一个定位点的宽度」⇒ `lineGapH = n·bubbleH`。
   *
   * ⚠ 曾误把 `.as-choice-nums` 的**外层盒**（含 transform 前的 top）
   *   当成题号上缘，量出 3.69mm 的假净空，于是加了 −rowOffsets[0] 的
   *   「修正」，反而把行距压到 1.979mm、净空只剩 0.377mm。
   *   要量就量 `.as-choice-num`（span）的 rect，别量父盒。
   */"""
s = s[:old_doc_start] + new_doc + s[old_doc_end:]

old_gm = """    var offs = rowOffsets(p);
    /* 下一行题号行心 = 下一行行顶 + rowOffsets[0]
       上一行末气泡底缘 = 下一行行顶 − lineGapH − bubbleH/2
       空档中点 = 上行末气泡底缘 + 净空/2，净空 = n·bubbleH
       ⇒ 相对下一行行顶 = −lineGapH − bubbleH/2 + n·bubbleH/2 + offs[0] */
    return r3(offs[0] - lineGapH(p) - bubbleH(p) / 2 + n * bubbleH(p) / 2);"""
new_gm = """    var offs = rowOffsets(p);
    /* 空档中点 = 上一行末气泡底缘 + 净空/2，净空 = lineGapH = n·bubbleH。
       相对**下一行行顶**：
         下一行行顶 = 上一行行顶 + columnHeight + lineGapH
         上一行末气泡底缘 = 上一行行顶 + columnHeight − bubbleH/2
       ⇒ 空档中点 = 下一行行顶 − lineGapH − bubbleH/2 + lineGapH/2
                   = 下一行行顶 − bubbleH/2 − n·bubbleH/2 */
    return r3(-bubbleH(p) / 2 - n * bubbleH(p) / 2);"""
assert old_gm in s, 'lineGapMarkOffset body not found'
s = s.replace(old_gm, new_gm, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
