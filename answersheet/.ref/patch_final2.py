import io, sys, re
sys.stdout.reconfigure(encoding='utf-8')

# ── 1) lineGapMarkOffset ─────────────────────────────────────────────
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()
a = s.index('  function lineGapMarkOffset(p) {')
b = s.index('  }', a) + len('  }')
new = '''  function lineGapMarkOffset(p) {
    /* 空档定位点夹在「上一行末气泡**下缘**」与「下一行题号**可见上缘**」正中。
       相对**下一行行顶**：
         上一行末气泡下缘 = −lineGapH
         下一行题号可见上缘 = rowOffsets[0] + NUM_BIAS
       ⇒ 中点 = (rowOffsets[0] + NUM_BIAS − lineGapH) / 2

       ⚠ 为什么题号要加 NUM_BIAS 而不是用盒上缘：
         题号**盒**高 = numRowH = 3.351mm（比块高 2.436 还高），盒上缘在
         rowOffsets[0] − numRowH/2 = 0 —— 也就是说「末气泡下缘 → 题号盒上缘」
         的空隙只有 lineGapH = 2.436mm，而一块就 2.436mm，两侧净空各 0.0005mm，
         必然与上下两块**相撞**（实测：空档块心 122.113 时到题号块只剩 0.966）。
         题号的**字形**只占盒中间 3.176mm，可见上缘实际在
         rowOffsets[0] + NUM_BIAS，于是可用空隙变成 2.436 + 1.098 = 3.534mm，
         减掉块高 2.436 后两侧各余 0.549mm —— 这才放得下。

       实测过五次翻车（块高 2.436，间距 < 2.436 就是两块叠在一起）：
         ① 延续上一行节距                → 距题号块 1.04  **叠**
         ② 「末气泡下缘 / 题号盒上缘」中点 → 距上一行末尾 1.66  **偏挤**
         ③ 用几何口径的题号块心取中点     → 距题号块 0.09  **叠**
         ④ 用 rowOffsets[0]+NUM_BIAS 但抵错符号 → 距题号块 1.05  **叠**
         ⑤ 本式                          → 距上下各 2.59 / 2.59 ✓ */
    var offs = rowOffsets(p);
    return r3((offs[0] + NUM_BIAS - lineGapH(p)) / 2);
  }'''
s = s[:a] + new + s[b:]
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('geometry ok')

# ── 2) 页脚改红：逐行找 footer: 行 ───────────────────────────────────
p2 = 'js/config.js'
lines = io.open(p2, encoding='utf-8').read().split('\n')
hit = -1
for i, ln in enumerate(lines):
    if re.match(r'\s*footer:\s*\{', ln):
        hit = i
        break
assert hit >= 0, 'footer line not found'
print('BEFORE:', repr(lines[hit]))
indent = len(lines[hit]) - len(lines[hit].lstrip())
lines[hit] = (' ' * indent +
  "footer:      { family: 'sun', size: '9pt',    color: 'accent', weight: 'normal',  ls: '0' },")
io.open(p2, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
print('AFTER :', repr(lines[hit]))
