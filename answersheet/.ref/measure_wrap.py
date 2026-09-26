"""量参考件 A4 第 1 面：
  ① 左侧定位点的全部行心（看换行处有没有额外空档）
  ② 气泡行的行心（按 A/B/C/D 字母的 y）
  ③ 黑框上下沿、选择题红框上下沿
用来定「换行处该空多少」。
"""
import sys
import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')
MM = 150 / 25.4
a = np.asarray(Image.open('.ref/a1-1.png').convert('L'))
H, W = a.shape
DARK = 170


def runs(mask, minlen=1):
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            if i - s >= minlen:
                out.append((s, i - 1))
            s = None
    if s is not None and len(mask) - s >= minlen:
        out.append((s, len(mask) - 1))
    return out


print('=== ① 左侧定位点（x 5.4~9.5）全部行心 ===')
c0, c1 = int(5.4 * MM), int(9.5 * MM)
sub = a[:, c0:c1]
rm = (sub < DARK).any(axis=1)
prev = None
for (r0, r1) in runs(rm):
    h = (r1 + 1 - r0) / MM
    if h < 1.0:
        continue
    cy = (r0 + r1 + 1) / 2 / MM
    d = '' if prev is None else '   Δ=%+.3f' % (cy - prev)
    print('   y %7.2f-%7.2f  高 %.2f  心 %7.3f%s' % (r0 / MM, (r1 + 1) / MM, h, cy, d))
    prev = cy

print('\n=== ② 气泡行：按 A/B/C/D 字母位置找（x 16.5~20）===')
c0, c1 = int(16.5 * MM), int(20.2 * MM)
sub = a[:, c0:c1]
rm = (sub < DARK).any(axis=1)
prev = None
for (r0, r1) in runs(rm):
    h = (r1 + 1 - r0) / MM
    if h < 1.0:
        continue
    cy = (r0 + r1 + 1) / 2 / MM
    d = '' if prev is None else '   Δ=%+.3f' % (cy - prev)
    print('   y %7.2f-%7.2f  高 %.2f  心 %7.3f%s' % (r0 / MM, (r1 + 1) / MM, h, cy, d))
    prev = cy

print('\n=== ③ 红框/黑框竖线（x 12.5~17 扫）===')
for xmm in [12.53, 12.7, 13.55, 16.93, 17.1, 195.92, 196.09, 196.93, 197.1]:
    col = a[:, int(xmm * MM)]
    rs = [(r0, r1) for (r0, r1) in runs(col < DARK) if r1 - r0 >= 2]
    if rs:
        print('   x %6.2f: %s' % (xmm, ', '.join('%.2f-%.2f' % (r0 / MM, (r1 + 1) / MM) for r0, r1 in rs[:6])))
