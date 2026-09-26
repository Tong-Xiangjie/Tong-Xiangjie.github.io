import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

old = """/** 行间空档（mm）—— **行顶到行顶**的增量里、扣掉列高之后的那部分。
   *
   * 用户要求：「上一行最后一个选项和下一行题号之间要空出一个定位点的宽度」
   * —— 这里说的是**净空**，即「上行末气泡**底缘** → 下行题号行**顶缘**」
   * = n 个气泡高（= n 个定位点尺寸）。
   *
   * 但 `columnHeight` 只到「末气泡**底缘**」，而行顶到「题号行**顶缘**」
   * 还差 `rowOffsets[0]`（= 题号行半高）。所以：
   *
   *   净空 = (columnHeight + lineGapH) − columnHeight
   *          − rowOffsets[0] + (rowOffsets[0] − bubbleH/2)
   *        = lineGapH − bubbleH/2
   *   ⇒ lineGapH = n·bubbleH + bubbleH/2
   *
   * ⚠ 少加这半个 bubbleH，净空就是 1.5 个气泡高
   *   （实测 3.69mm，而要求 2.436mm）。
   */
  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3((n + 0.5) * bubbleH(p));
  }

  /** 行间空档**中点**相对**下一行行顶**的偏移（mm）—— 左侧也要一个定位点。
   *
   *  推导（从下一行 baseline 往回量）：
   *    下一行题号行顶 = baseline + rowOffsets[0]
   *    上行末气泡底缘 = baseline − n·bubbleH + rowOffsets[0] − bubbleH/2
   *    （因为 lineGapH = n·bubbleH + bubbleH/2）
   *    空档中点 = 上行末气泡底缘 + n·bubbleH/2
   *            = baseline + rowOffsets[0] − bubbleH/2 − n·bubbleH/2
   *  用户指定「左侧相应也要定位点」——就是这个点，夹在两行之间。
   */
  function lineGapMarkOffset(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(rowOffsets(p)[0] - (n / 2 + 0.5) * bubbleH(p));
  }"""

new = """/** 行间空档（mm）—— **行顶到行顶**的增量里、扣掉列高之后的那部分。
   *
   * 用户要求：「上一行最后一个选项和下一行题号之间要空出一个定位点的宽度」
   * —— 说的是**净空**：上行末气泡**底缘** → 下行题号行**顶缘** = bubbleH。
   *
   * 关键：`numRowH`（题号行高）是 `2 × rowOffsets[0]`，**比 bubbleH 高**
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
   */
  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p) + bubbleH(p) / 2 - rowOffsets(p)[0]);
  }

  /** 行间空档**中点**相对**下一行行顶**的偏移（mm）—— 左侧也要一个定位点。
   *
   *  下一行题号行顶 = 下一行行顶 + (rowOffsets[0] − bubbleH/2)
   *  上行末气泡底缘 = 下一行行顶 − lineGapH − bubbleH/2
   *    （列底 = 行顶 + columnHeight，末气泡底缘 = 列底 − bubbleH/2）
   *  空档中点 = 上行末气泡底缘 + 净空/2 = 上行末气泡底缘 + n·bubbleH/2
   *
   *  用户指定「左侧相应也要定位点」——就是这个点，夹在两行之间。
   */
  function lineGapMarkOffset(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    var offs = rowOffsets(p);
    return r3(-lineGapH(p) - bubbleH(p) / 2 + n * bubbleH(p) / 2 + offs[0] -
              bubbleH(p) / 2);
  }"""

assert old in s, 'lineGapH block not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
