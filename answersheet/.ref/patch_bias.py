import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()
a = s.index('  function lineGapMarkOffset(p) {')
b = s.index('  }', a) + len('  }')
new = '''  function lineGapMarkOffset(p) {
    /* 空档定位点夹在「上一行末气泡**下缘**」与「下一行题号**可见上缘**」正中。
       相对**下一行行顶**：
         上一行末气泡下缘   = −lineGapH
         下一行题号可见上缘 = rowOffsets[0] + NUM_BIAS
       ⇒ 中点 = (rowOffsets[0] + NUM_BIAS − lineGapH) / 2

       ⚠ 为什么题号要加 NUM_BIAS、不能用盒上缘：
         题号**盒**高 = numRowH = 3.351mm，比块高 2.436 还高，盒上缘落在
         rowOffsets[0] − numRowH/2 = 0 —— 于是「末气泡下缘 → 题号盒上缘」的
         可用空隙只有 lineGapH = 2.436mm，而一块就 2.436mm，两侧净空各
         0.0005mm，必然与上下两块**相撞**（实测空档块心 122.113 时距题号块 0.966）。
         题号**字形**只占盒中间 3.176mm，可见上缘在 rowOffsets[0] + NUM_BIAS，
         可用空隙变成 2.436 + 1.095 = 3.531mm，减掉块高后两侧各余 0.548mm。

       实测过五次翻车（块高 2.436，间距 < 2.436 就是两块叠在一起）：
         ① 延续上一行节距                     → 距题号块 1.04  **叠**
         ② 「末气泡下缘 / 题号盒上缘」中点      → 距上一行末尾 1.66  **偏挤**
         ③ 用几何口径的题号块心取中点          → 距题号块 0.09  **叠**
         ④ NUM_BIAS 取 2.015（错值）          → 距题号块 0.97  **叠**
         ⑤ 本式（NUM_BIAS = 1.095）           → 距上下各 2.620 / 2.618 ✓ */
    var offs = rowOffsets(p);
    return r3((offs[0] + NUM_BIAS - lineGapH(p)) / 2);
  }'''
s = s[:a] + new + s[b:]

# NUM_BIAS 改成正确推导：题号可见上缘相对 rowOffsets[0] 的偏移
a2 = s.index('  var NUM_BIAS = ')
b2 = s.index('\n', a2)
old_line = s[a2:b2]
new_line = '  var NUM_BIAS = r3((numRowH(C.PRESETS.A4) - r3(C.PRESETS.A4.blockW * 3 / 5)) / 2);'
s = s[:a2] + new_line + s[b2:]

# 重写那段注释
doc_start = s.rindex('  /**', 0, a2)
new_doc = '''  /**
   * 题号**可见上缘**相对 `rowOffsets[0]` 的偏移（mm）—— 正值表示可见上缘更低。
   *
   * 题号盒高 = `numRowH`（A4 = 3.351mm），而题号**字形**只占盒中间
   * 一个块高（`bubbleH` = 2.436mm）那么多，所以可见上缘比盒上缘低半个差值：
   *
   *     NUM_BIAS = (numRowH − bubbleH) / 2
   *
   * 又因为 `rowOffsets[0] = numRowH / 2`，可见上缘实际落在
   * `rowOffsets[0] − bubbleH/2 + NUM_BIAS` = `rowOffsets[0] + NUM_BIAS`（A4 = 2.7715）。
   *
   * 用法：把「题号盒上缘 = rowOffsets[0] − numRowH/2 = 0」换算成可见上缘。
   * 主要用于 `lineGapMarkOffset` —— 行间那个空档块只能塞进
   * 「末气泡下缘 → 题号可见上缘」这段空隙，用盒上缘会不够放。
   *
   * ⚠ 只要题号字号（`TYPE.num.size`）或气泡尺寸变了，这里会自动跟着变，
   *   不需要手改；但改完必须用 `.ref/gapwindow.cjs` 复核一次。
   */
'''
s = s[:doc_start] + new_doc + s[a2:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
