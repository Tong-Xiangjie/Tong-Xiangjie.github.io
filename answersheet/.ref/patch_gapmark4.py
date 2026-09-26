import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()
a = s.index('    var offs = rowOffsets(p);\n    return r3((offs[0] - NUM_BIAS - lineGapH(p)) / 2);')
b = s.index('  }', a)
new = '''    var offs = rowOffsets(p);
    /* 用**渲染**口径：题号行心 = rowOffsets[0] − NUM_BIAS。
       下一行题号上缘 = 下一行行顶 + (rowOffsets[0] − NUM_BIAS) − bubbleH/2，
       换成相对下一行行顶的量即 (rowOffsets[0] − NUM_BIAS) − bubbleH/2；
       上一行末气泡底缘相对下一行行顶 = −lineGapH。取两者中点。 */
    return r3(((offs[0] - NUM_BIAS) - bubbleH(p) / 2 - lineGapH(p)) / 2);'''
s = s[:a] + new + s[b:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
