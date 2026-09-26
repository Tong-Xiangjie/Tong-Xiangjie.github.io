import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

# ── 1) 间距行：把「行间空档定位点」声明成一个正式的行型 ──────────────
old_gm = """  function lineGapMarkOffset(p) {
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
  }"""
new_gm = """  function lineGapMarkOffset(p) {
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
assert old_gm in s, 'lineGapMarkOffset not found'
s = s.replace(old_gm, new_gm, 1)

# ── 2) 左侧定标带：逐行「块 → gap → 下一行块」，gap 挂在下一行上 ────
old_rows = """    var rows = [];
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
new_rows = """    var rows = [];
    if (hasGrid) {
      var gapOff = lineGapMarkOffset(p);
      for (var li = 0; li < nLines; li++) {
        /* ⚠ gapOff 是**相对本行（下一行）行顶**的负偏移，
           所以它必须加在本行 base 上、并排在行首 —— 加在上一行 base 上
           会把空档点压到上一行末气泡那一格里去。 */
        if (li > 0) rows.push(r3(r3(o.gridTop + li * lineHeight(p)) + gapOff));
        var base = r3(o.gridTop + li * lineHeight(p));
        offs.forEach(function (d) { rows.push(r3(base + d)); });
      }
    }"""
assert old_rows in s, 'rows block not found'
s = s.replace(old_rows, new_rows, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
