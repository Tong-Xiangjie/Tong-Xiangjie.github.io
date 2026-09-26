import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()

# 删掉刚才那个「备查」草稿函数
ds = s.index('  /**\n   * 空档定位点（实际采用）')
de = s.index('  function lineGapMarkOffsetReal(p) {\n    return 0;\n  }') + len('  function lineGapMarkOffsetReal(p) {\n    return 0;\n  }')
s = s[:ds] + s[de:]

# lineGapMarkOffset 改为「不在行间放块」
a = s.index('  function lineGapMarkOffset(p) {')
b = s.index('  }', a) + len('  }')
new = '''  function lineGapMarkOffset(p) {
    /* 左列每行 **只有 5 块**（rowOffsets 那 5 个：题号 + A/B/C/D）。
       行与行之间**不再放额外的块** —— 用户画的结构图：
           【】1 2 3 ……      ← 题号行
           【】A A A ……      ← A 选项行
           【】B B B ……
           【】C C C ……
           【】D D D ……
           【】21 22 23 ……   ← 下一行紧接（中间那段空隙来自 lineGapH，不是块）
           【】A A A ……
       行与行之间的「空出来的高度」在左列**没有对应方块**，所以
       本函数不再被 layoutFace 使用（保留只为记录推导）。

       ⚠ 曾反复在行间塞一块，结果无论放哪都会与相邻块**重叠或挤成一团**
         （块高 2.436，而可用的最大间隙也只有 2.4 左右）：
           延续上一行节距            → 距下一行题号块 1.04  **叠**
           「末气泡下缘 / 题号盒上缘」中点 → 距上一行末尾 1.66  **挤**
           几何口径题号块心取中点      → 距题号块 0.09  **叠**
         用户的原话就是「你怎么方块融合在一起了」。
       正确做法：**行间不放块**，行距靠 lineGapH 拉开。 */
    return null;
  }'''
s = s[:a] + new + s[b:]

# layoutFace：不再插空档块
old_rows = """        if (li > 0) rows.push(r3(r3(o.gridTop + li * lineHeight(p)) + gapOff));
        var base = r3(o.gridTop + li * lineHeight(p));"""
new_rows = """        var base = r3(o.gridTop + li * lineHeight(p));"""
assert old_rows in s, 'rows block not found'
s = s.replace(old_rows, new_rows, 1)

# 删掉 gapOff 变量声明
s = s.replace("      var gapOff = lineGapMarkOffset(p);\n", "", 1)
s = s.replace("""        /* ⚠ gapOff 是**相对本行（下一行）行顶**的负偏移，
           所以它必须加在本行 base 上、并排在行首 —— 加在上一行 base 上
           会把空档点压到上一行末气泡那一格里去。 */
""", "", 1)

# 数量公式注释更新
old_c = """    /* 左侧定标带**先按数量算出来**，右边（题号行/气泡行）只是跟它对齐。
       数量：
         每行 = offs.length 个（题号行 + A/B/C/D）
         行间 = 每两个相邻行之间 1 个（用户要求「左侧相应也要定位点」）
         ⇒ 合计 nLines·offs.length + (nLines − 1)
       顺序严格自上而下，不排序、不去重 —— 排序会让「哪个块属于哪一行」
       看不出来，一旦某个偏移算错，整列就全乱（上一轮的教训）。 */"""
new_c = """    /* 左侧定标带**先按数量算出来**，右边（题号行/气泡行）只是跟它对齐。
       数量 = nLines · offs.length（每行：题号行 + A/B/C/D），
       **行间不放块** —— 用户画的结构图里行与行之间只有一个方块宽的间隙，
       没有额外的方块；那段空隙来自 lineGapH。
       顺序严格自上而下，不排序、不去重：排序会让「哪个块属于哪一行」
       看不出来，一旦某个偏移算错整列就全乱（上一轮的教训）。 */"""
assert old_c in s, 'count comment not found'
s = s.replace(old_c, new_c, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
