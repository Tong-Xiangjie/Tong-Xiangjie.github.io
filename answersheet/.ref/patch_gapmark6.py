import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

# 1) 左侧块心：题号块**不动**，回到 rowOffsets[0]（DOM 实测残差仅 0.085mm，
#    不能拿 NUM_BIAS 去改，否则会和下一行的题号块叠在一起）
old_rows = """        /* ⚠ 题号那一块要落在**渲染**行心上：题号盒被 Chrome 把 line-height
           吸附到整像素，渲染行心比 rowOffsets[0] 低 NUM_BIAS。
           气泡块的 rowOffsets[i] (i≥1) 与渲染行心一致，不用补偿。 */
        rows.push(r3(base + offs[0] - NUM_BIAS));
        for (var oi = 1; oi < offs.length; oi++) rows.push(r3(base + offs[oi]));"""
new_rows = """        /* 左侧块心一律用 rowOffsets（题号块 = rowOffsets[0]，气泡块 = 后四项）。
           实测题号块心与题号渲染行心仅差 0.085mm（见 .ref/markrows.cjs），
           属盒模型取整残差，不要去「修」—— 用 NUM_BIAS 去改会让题号块
           下移 2mm，与下一行的题号块叠在一起（已实测翻车）。 */
        offs.forEach(function (d) { rows.push(r3(base + d)); });"""
assert old_rows in s, 'rows block not found'
s = s.replace(old_rows, new_rows, 1)

# 2) lineGapMarkOffset：夹在「上一行末气泡块」与「下一行题号块」正中间
a = s.index('  function lineGapMarkOffset(p) {')
b = s.index('  }', a) + len('  }')
new = '''  function lineGapMarkOffset(p) {
    /* 空档定位点 = 「上一行末气泡块心」与「下一行题号块心」的正中间。
       两个基准都是**左侧块心**（不是气泡/文字的行心），这样它与上下两块
       严格等距，块高 2.435，间距 2.665 > 2.435，不会叠。

       相对**下一行行顶**：
         下一行题号块心 = rowOffsets[0]
         上一行末气泡块心 = rowOffsets[last] + rowPitch − lineHeight
                          = columnHeight + rowPitch − lineHeight
       中点 = (rowOffsets[0] + columnHeight + rowPitch − lineHeight) / 2
            = (rowOffsets[0] − lineGapH + rowPitch) / 2      ← columnHeight+rowPitch−lineHeight = rowPitch−lineGapH

       实测过三次翻车（块高 2.435，间距 < 2.435 就是两块叠在一起）：
         ① 延续上一行节距（末气泡 + rowPitch）→ 122.122，距题号块 1.042 **叠**
         ② 取「末气泡底缘 / 题号上缘」中点 → 119.492，距上一行末尾 1.657 **偏挤**
         ③ 与「下一行题号块」等距（本式）  → 120.5，两侧各 2.665 ✓ */
    var offs = rowOffsets(p);
    return r3((offs[0] + columnHeight(p) + rowPitch(p) - lineHeight(p)) / 2);
  }'''
s = s[:a] + new + s[b:]

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('geometry ok')
