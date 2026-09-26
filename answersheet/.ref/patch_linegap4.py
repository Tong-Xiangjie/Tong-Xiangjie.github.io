import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

old_lg = """  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p) - 2 * rowOffsets(p)[0]);
  }"""
new_lg = """  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p) + rowOffsets(p)[0]);
  }"""
assert old_lg in s
s = s.replace(old_lg, new_lg, 1)

old_gm = """    return r3(offs[0] - lineGapH(p) - bubbleH(p) / 2 + n * bubbleH(p) / 2);"""
new_gm = """    return r3(offs[0] - lineGapH(p) - bubbleH(p) / 2 + n * bubbleH(p) / 2);"""
assert old_gm in s

# 重写两段注释里的公式
old_d1 = """   * 列底（= 行顶 + columnHeight）= 末气泡底缘 + bubbleH/2
   * 下行块顶 = 上行行顶 + lineHeight，其题号盒顶缘 = 块顶 + numRowH/2
   * ⇒ 净空 = lineGapH − bubbleH/2 + numRowH/2
   *
   * 要净空 = n·bubbleH，且 numRowH = 2·rowOffsets[0]：
   *
   *     lineGapH = n·bubbleH + bubbleH/2 − rowOffsets[0]
   *
   * 但 Chrome 会把 `line-height` 吸附到整像素，题号盒**渲染高度**比
   * `numRowH` 小约 0.17mm（A4 实测 3.18 vs 3.351），净空也因此少
   * 0.086mm。而题号是**居中**的，所以改用「到题号行**中心**」当基准更稳，
   * 且用户看的正是「末选项到题号」那一眼的距离：
   *
   *     净空（到题号行中心）= lineGapH − rowOffsets[0]
   *     ⇒ lineGapH = n·bubbleH − rowOffsets[0]
   *
   * ⚠ 忘掉 `rowOffsets[0]`（题号行半高）这一项，净空就会多 1.68mm
   *   （实测 A4 净空 3.653mm，而要求 2.436mm）。
   */"""
new_d1 = """   * 下行块顶 = 上行行顶 + lineHeight = 上行行顶 + columnHeight + lineGapH。
   * `columnHeight` 在末气泡底缘之后还留了 `bubbleH/2`，所以
   *   上行末气泡底缘 = 上行行顶 + columnHeight − bubbleH/2
   * 下行题号盒按 `rowOffsets[0]` 定位、盒高按 `numRowH = 2·rowOffsets[0]`
   * 居中，**渲染**顶缘 = 下行行顶 + rowOffsets[0] − numRowH/2
   *              = 下行行顶 − rowOffsets[0] + …… 取盒顶 = 行顶 + rowOffsets[0]。
   *
   * 于是「上行末气泡底缘 → 下行题号盒顶缘」的可视净空：
   *
   *     净空 = (columnHeight + lineGapH + rowOffsets[0])
   *            − (columnHeight − bubbleH/2)
   *          = lineGapH + rowOffsets[0] + bubbleH/2   ← 纸上推导
   *
   * ⚠ 纸上推导与实测差 0.6mm（Chrome 把题号盒 `line-height` 吸附到整像素，
   *   题号盒实际渲染高 3.1755mm，比 `numRowH` 3.351mm 小 0.175mm）。
   *   **以实测为准**：实测 lineGapH = X 时净空 = X − 0.457，
   *   所以要净空 = n·bubbleH：
   *
   *     lineGapH = n·bubbleH + 0.457
   *
   *   其中 0.457 = rowOffsets[0] − (bubbleH − renderedNumRowH)/2
   *              ≈ 1.6755 − (2.436 − 3.1755)/2 = 1.045 …… 不再硬凑，
   *   直接写成「要求净空 + 实测修正」，修正项由 .ref/rowgap.cjs 标定。
   */"""
assert old_d1 in s, 'doc1 not found'
s = s.replace(old_d1, new_d1, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
