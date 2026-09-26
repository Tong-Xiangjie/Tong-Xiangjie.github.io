import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

old = """/** 行间空档（mm） */
  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p));
  }"""

new = """/** 行间空档（mm）—— **行顶到行顶**的增量里、扣掉列高之后的那部分。
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

assert old in s, 'lineGapH block not found'
s = s.replace(old, new, 1)

old_exp = "    lineGapH: lineGapH,"
if old_exp in s:
    s = s.replace(old_exp, "    lineGapH: lineGapH,\n    lineGapMarkOffset: lineGapMarkOffset,", 1)
    print('exported lineGapMarkOffset')
else:
    print('WARN: lineGapH export not found')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
