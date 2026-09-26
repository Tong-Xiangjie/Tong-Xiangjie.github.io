import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

old_gm = s.index("  function lineGapMarkOffset(p) {")
old_gm_end = s.index("  }", old_gm) + len("  }")
new_gm = """  function lineGapMarkOffset(p) {
    /* 空档定位点必须落在**两行之间的空隙里**，否则会与相邻块**重叠**。
       实测过两次翻车（块高 2.435，间距小于块高就是叠在一起）：
         ① 延续上一行节距（+0.634）：块心 122.122，距下一行题号块 1.042 → 重叠
         ② 取两行中点（−0.989）    ：块心 120.501，与上下各 2.67/2.66  → 不匀

       正解 = 「上一行末气泡**底缘**」与「下一行题号**上缘**」的中点。
       这两个位置由 DOM 实测口径给出（题号按 rowOffsets[0] 定位、行盒被
       Chrome 吸附到整像素，所以题号上缘 = base + rowOffsets[0] − NUM_BIAS）：
         上一行末气泡底缘 = base + columnHeight
         下一行题号上缘   = base + rowOffsets[0] − NUM_BIAS
       相对**下一行行顶**：
         上一行末气泡底缘 = −lineGapH
         下一行题号上缘   = rowOffsets[0] − NUM_BIAS
       ⇒ 中点 = (rowOffsets[0] − NUM_BIAS − lineGapH) / 2
       调用方把它加到**下一行**的 base 上。 */
    var offs = rowOffsets(p);
    return r3((offs[0] - NUM_BIAS - lineGapH(p)) / 2);
  }"""
s = s[:old_gm] + new_gm + s[old_gm_end:]

# 声明 NUM_BIAS（题号行盒被 Chrome 吸附造成的固定偏差）
anchor = "  /** 题号行高度：字号 × 行高倍数（css 里 .as-choice-num 是 line-height:1） */"
assert anchor in s
bias = """  /**
   * 题号行盒的**渲染偏差**（mm）。
   *
   * `.as-choice-num` 的 `line-height` 由 builder 写成 `numRowH`（A4 = 3.351mm），
   * 但 Chrome 会把行高**吸附到整设备像素**（12px = 3.1755mm），所以题号盒的
   * 实际渲染高度比 `numRowH` 矮 0.176mm；题号又用 `translateY(-50%)` 居中，
   * 于是**渲染行心**比几何算出的 `rowOffsets[0]` 低约 2.0mm。
   *
   * 实测（A4，`.ref/markrows.cjs`）：块心 100.227 vs 题号行心 100.142，
   * 差 0.085 —— 这个 0.085 就是「块心按 rowOffsets[0] 放、题号按渲染行心放」
   * 之间的残差。NUM_BIAS 取「题号盒渲染高的一半 − rowOffsets[0]」的绝对值，
   * 用于把「题号上缘」从几何坐标换算到渲染坐标。
   *
   * ⚠ 只要题号字号或 `--fs-num` 变了，这个值就要跟着重标（见 .ref/markrows.cjs）。
   */
  var NUM_BIAS = 2.015;

"""
s = s.replace(anchor, bias + anchor, 1)
s = s.replace("    rowPitch: rowPitch,", "    rowPitch: rowPitch,\n    NUM_BIAS: NUM_BIAS,", 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
