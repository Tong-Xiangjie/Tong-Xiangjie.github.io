import io, sys, re
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

# ── 1) lineGapH 恢复为 n·bubbleH（实测标定：净空 = lineGapH）────────────
start = s.index("  function lineGapH(p) {")
end = s.index("  }", start) + len("  }")
s = s[:start] + """  function lineGapH(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    return r3(n * bubbleH(p));
  }""" + s[end:]

# 注释里把上一轮的推导换成实测结论
doc_start = s.rindex("  /**", 0, start)
doc_end = len(s[:start][:start]) if False else start
old_doc = s[doc_start:start]
new_doc = """  /** 行间空档（mm）—— 上下两行**块顶到块顶**之间、扣掉列高之后的那部分。
   *
   * 用户要求：「上一行最后一个选项和下一行题号之间留出一个定位点的宽度」
   * —— 说的是**净空**：上行末气泡**底缘** → 下行题号**上缘** = bubbleH。
   *
   * ⚠ **实测标定**（`.ref/cal_gap.cjs`）：把网格 `row-gap` 强制成
   *   4mm / 8mm 各量一次，「上行末气泡底缘 → 下行题号上缘」的净空正好
   *   等于该 row-gap（斜率 1、截距 **0**）。也就是说这段净空就**等于**
   *   `lineGapH`，不需要任何补偿项：`columnHeight` 恰好停在末气泡底缘，
   *   而题号上缘恰好落在下一行块顶。
   *
   * 所以取 `lineGapH = n·bubbleH` 就满足要求。
   *
   * ⚠ 不要再往这里塞 `rowOffsets[0]`、`bubbleH/2` 之类的「修正」：
   *   上一轮就是把 `.as-choice-nums` 的**外层盒**（transform 之前的位置）
   *   误当成题号上缘，量出 3.69mm 的假净空，于是加了 −2·rowOffsets[0]，
   *   把行距压到 −0.915mm、两行叠在一起、左侧定位点全乱。
   *   要量就量 `.as-choice-num`（span）自己的 rect。
   */
"""
s = s[:doc_start] + new_doc + s[start:]

# ── 2) lineGapMarkOffset 改成「相对本行行顶」的干净定义 ────────────────
gm_start = s.index("  function lineGapMarkOffset(p) {")
gm_end = s.index("  }", gm_start) + len("  }")
s = s[:gm_start] + """  function lineGapMarkOffset(p) {
    var n = (C.LINE_GAP_BUBBLES === undefined) ? 1 : C.LINE_GAP_BUBBLES;
    /* 空档定位点 = 夹在「上一行末气泡底缘」与「下一行题号上缘」正中间。
       两者相距恰好 lineGapH = n·bubbleH，所以相对**上一行行顶**：
         末气泡底缘     = columnHeight
         空档中点       = columnHeight + lineGapH/2
       ⇒ 相对上一行行顶 = columnHeight + n·bubbleH/2
       相对**下一行行顶** = 上式 − lineHeight
                          = columnHeight + n·bubbleH/2 − columnHeight − lineGapH
                          = −n·bubbleH/2
       这里返回「相对本行行顶」的值，由调用方加到本行 base 上。 */
    return r3(columnHeight(p) + n * bubbleH(p) / 2);
  }""" + s[gm_end:]

# ── 3) 左侧定标带：按「数量」先算出来 ──────────────────────────────────
old_rows = """    var rows = [];
    if (hasGrid) {
      var gapOff = lineGapMarkOffset(p);
      for (var li = 0; li < nLines; li++) {
        var base = r3(o.gridTop + li * lineHeight(p));
        if (li > 0) {
          /* 空档定位点：夹在上一行末气泡与这一行题号之间 */
          rows.push(r3(base + gapOff));
        }
        offs.forEach(function (d) { rows.push(r3(base + d)); });
      }
      rows.sort(function (a, b) { return a - b; });
    }"""
new_rows = """    /* 左侧定标带**先按数量算出来**，右边（题号行/气泡行）只是跟它对齐。
       数量：
         每行 = offs.length 个（题号行 + A/B/C/D）
         行间 = 每两个相邻行之间 1 个（用户要求「左侧相应也要定位点」）
         ⇒ 合计 nLines·offs.length + (nLines − 1)
       顺序严格自上而下，不排序、不去重 —— 排序会让「哪个块属于哪一行」
       看不出来，一旦某个偏移算错，整列就全乱（上一轮的教训）。 */
    var rows = [];
    if (hasGrid) {
      var gapOff = lineGapMarkOffset(p);
      for (var li = 0; li < nLines; li++) {
        var base = r3(o.gridTop + li * lineHeight(p));
        offs.forEach(function (d) { rows.push(r3(base + d)); });
        /* 本行末尾的「行间空档」定位点（最后一行没有下一行，不加） */
        if (li < nLines - 1) {
          rows.push(r3(base + gapOff));
        }
      }
    }"""
assert old_rows in s, 'rows block not found'
s = s.replace(old_rows, new_rows, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
