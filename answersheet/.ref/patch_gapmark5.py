import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

# lineGapMarkOffset：与「上一行末气泡」和「下一行首气泡」等距
a = s.index('  function lineGapMarkOffset(p) {')
b = s.index('  }', a) + len('  }')
new = '''  function lineGapMarkOffset(p) {
    /* 空档定位点放在**两行之间空隙的正中**：与「上一行末气泡行心」和
       「下一行首气泡行心」等距，两侧各 rowPitch/2。

       实测过三次翻车（块高 2.435，间距 < 2.435 就是两块叠在一起）：
         ① 延续上一行节距            → 122.122，距下一行题号块 1.042  **重叠**
         ② 取「末气泡底缘/题号上缘」中点 → 119.492，距上一行末尾 1.657  **仍偏挤**
         ③ 本次：与上下气泡行等距     → 119.285 + rowPitch/2

       相对**下一行行顶**：
         上一行末气泡行心 = rowOffsets[optRows] − lineHeight
         空档块心         = 上式 + rowPitch/2
       （上一行行顶 → 下一行行顶 恰好是 lineHeight） */
    var offs = rowOffsets(p);
    return r3(offs[offs.length - 1] - lineHeight(p) + rowPitch(p) / 2);
  }'''
s = s[:a] + new + s[b:]

# 左侧块心：题号那一块改用**渲染**行心（rowOffsets[0] − NUM_BIAS），
# 与气泡块保持一致的口径，避免 0.085mm 的残差。
old_rows = """        if (li > 0) rows.push(r3(r3(o.gridTop + li * lineHeight(p)) + gapOff));
        var base = r3(o.gridTop + li * lineHeight(p));
        offs.forEach(function (d) { rows.push(r3(base + d)); });"""
new_rows = """        if (li > 0) rows.push(r3(r3(o.gridTop + li * lineHeight(p)) + gapOff));
        var base = r3(o.gridTop + li * lineHeight(p));
        /* ⚠ 题号那一块要落在**渲染**行心上：题号盒被 Chrome 把 line-height
           吸附到整像素，渲染行心比 rowOffsets[0] 低 NUM_BIAS。
           气泡块的 rowOffsets[i] (i≥1) 与渲染行心一致，不用补偿。 */
        rows.push(r3(base + offs[0] - NUM_BIAS));
        for (var oi = 1; oi < offs.length; oi++) rows.push(r3(base + offs[oi]));"""
assert old_rows in s, 'rows block not found'
s = s.replace(old_rows, new_rows, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
