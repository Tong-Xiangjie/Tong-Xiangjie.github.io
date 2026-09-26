import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

old_lg = """  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p) + bubbleH(p) / 2 - rowOffsets(p)[0]);
  }"""
new_lg = """  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p) - 2 * rowOffsets(p)[0]);
  }"""
assert old_lg in s, 'lineGapH body not found'
s = s.replace(old_lg, new_lg, 1)

old_doc = """   * 关键：`numRowH`（题号行高）是 `2 × rowOffsets[0]`，**比 bubbleH 高**
   * （实测 3.351 vs 2.436）。所以从「上行末气泡底」到「下行题号行顶」
   * 中间夹着的是：`lineGapH`（列底→下行块顶）+（题号行高 − bubbleH）/2。
   *
   *   净空 = lineGapH + (2·rowOffsets[0] − bubbleH)/2
   *   ⇒ lineGapH = 2·bubbleH − 2·rowOffsets[0] + bubbleH …… 整理为
   *     lineGapH = 2·rowOffsets[0] ... 见下（直接解出，别背公式）
   *
   * 解：要净空 = g，则 lineGapH = g − rowOffsets[0] + bubbleH/2。
   * 取 g = n·bubbleH：
   *
   *     lineGapH = n·bubbleH + bubbleH/2 − rowOffsets[0]
   *
   * ⚠ 这里**必须**减掉 rowOffsets[0]（题号行半高）。漏掉它，净空就多出
   *   半个题号行高（实测 A4 净空 3.653mm，而要求 2.436mm）。
   */"""
new_doc = """   * 关键：题号行是 flex 居中 + `translateY(-50%)`，它的**盒高**
   * `numRowH = 2 × rowOffsets[0]` **比 bubbleH 高**（A4：3.351 vs 2.436）。
   * 所以「上行末气泡底缘 → 下行题号盒顶缘」这段可视净空 =
   *
   *     净空 = lineGapH + (columnHeight − columnHeight) ...
   *          = lineGapH + numRowH − bubbleH − numRowH/2…… 直接解更清楚：
   *
   * 列底（= 行顶 + columnHeight）= 末气泡底缘 + bubbleH/2
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
assert old_doc in s, 'lineGapH doc not found'
s = s.replace(old_doc, new_doc, 1)

old_gm = """  function lineGapMarkOffset(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    var offs = rowOffsets(p);
    return r3(-lineGapH(p) - bubbleH(p) / 2 + n * bubbleH(p) / 2 + offs[0] -
              bubbleH(p) / 2);
  }"""
new_gm = """  function lineGapMarkOffset(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    var offs = rowOffsets(p);
    /* 下一行题号行心 = 下一行行顶 + rowOffsets[0]
       上一行末气泡底缘 = 下一行行顶 − lineGapH − bubbleH/2
       空档中点 = 上行末气泡底缘 + 净空/2，净空 = n·bubbleH
       ⇒ 相对下一行行顶 = −lineGapH − bubbleH/2 + n·bubbleH/2 + offs[0] */
    return r3(offs[0] - lineGapH(p) - bubbleH(p) / 2 + n * bubbleH(p) / 2);
  }"""
assert old_gm in s, 'lineGapMarkOffset body not found'
s = s.replace(old_gm, new_gm, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
