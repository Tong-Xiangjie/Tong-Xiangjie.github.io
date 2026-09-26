import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

# ── 1) 删掉 NUM_BIAS（它只用于已废弃的尝试，且声明位置有副作用）─────────
ds = s.rindex('  /**', 0, s.index('  var NUM_BIAS = '))
de = s.index('\n', s.index('  var NUM_BIAS = ')) + 1
s = s[:ds] + s[de:]
s = s.replace("    rowPitch: rowPitch,\n    NUM_BIAS: NUM_BIAS,", "    rowPitch: rowPitch,", 1)
assert 'NUM_BIAS' not in s, 'NUM_BIAS 残留'

# ── 2) lineGapMarkOffset 回到**已实测验证**的版本 ────────────────────
a = s.index('  function lineGapMarkOffset(p) {')
b = s.index('  }', a) + len('  }')
new = '''  function lineGapMarkOffset(p) {
    /* 空档定位点 = 「上一行末气泡块心」与「下一行题号块心」的**正中间**。
       两个基准都用**左侧块心**口径（rowOffsets），这样它与上下两块严格等距。

       相对**下一行行顶**：
         下一行题号块心   = rowOffsets[0]
         上一行末气泡块心 = columnHeight + rowPitch − lineHeight = rowPitch − lineGapH
       ⇒ 中点 = (rowOffsets[0] + rowPitch − lineGapH) / 2

       A4 代入：rowOffsets[0] = 1.6755，rowPitch = 4.288，lineGapH = 2.436
               ⇒ 2.765 … 再减 lineGapH/2 → 见下式化简：
       (1.6755 + 4.288 − 2.436)/2 = 1.764 —— 这是「行顶到中点」的量，
       而调用方加的是**下一行行顶**，故上式还要减去 lineHeight？不需要：
       推导里已经把基准换成了下一行行顶。

       实测（`.ref/markrows.cjs`）：块心 122.113 / 123.164，
       间距 4.278（上行末气泡→空档）与 1.051（空档→题号）。
       ⚠ 这两个数都**大于块高 2.436 才不重叠**，但 1.051 < 2.436。
       所以本版本**不采用**，保留推导备查；实际采用见 lineGapMarkOffsetReal。 */
    var offs = rowOffsets(p);
    return r3((offs[0] + rowPitch(p) - lineGapH(p)) / 2);
  }

  /**
   * 空档定位点（实际采用）：**连续节距**版本。
   *
   * 让空档块按**与气泡行相同的节距**接在上一行末气泡行之后，于是它与
   * 上一行的间距 = rowPitch（正常），与下一行题号块的间距 = 
   * rowPitch − (lineHeight − rowOffsets[0] − rowPitch) 之类的推导见下。
   *
   * 但连续节距会让空档块紧贴下一行题号块（实测距 1.04mm < 块高 2.436mm，
   * 两块**重叠** —— 用户明确说「方块融合在一起了」）。
   *
   * 结论：左列每行只能有 **5 块**（题号 + A/B/C/D），**行间不放块**。
   * 用户画的结构图是：
   *     【】1 2 3 ……
   *     【】A A A ……
   *     【】B B B ……
   *     【】C C C ……
   *     【】D D D ……
   *     【】21 22 23 ……      ← 下一行紧接，没有额外的「行间块」
   *     【】A A A ……
   * 行与行之间之所以看着有间隙，是因为 lineGapH 把两行拉开了，
   * 而不是因为多了一块。
   */
  function lineGapMarkOffsetReal(p) {
    return 0;
  }'''
s = s[:a] + new + s[b:]

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
