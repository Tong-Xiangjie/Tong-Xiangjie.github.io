"""从参考件 PNG 里量出：
  ① 顶部定标带的每一块（列心）
  ② 第一行气泡的列心
  ③ 左侧定位点的行心
  ④ 选择题黑框（内层黑矩形）的左右边缘
用来判定「最左列 vs 最左定位点」的相对关系，以及黑框左右间距。
"""
import sys
import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')
MM = 150 / 25.4
a = np.asarray(Image.open('.ref/a1-1.png').convert('L'))
H, W = a.shape
DARK = 170


def runs(mask):
    out, s = [], None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            out.append((s, i - 1))
            s = None
    if s is not None:
        out.append((s, len(mask) - 1))
    return out


def blocks_on_row(y0mm, y1mm, min_w_mm=1.0):
    """在 y 带里找横向的暗块（每块 = 一个定位块/气泡/字符）"""
    r0, r1 = int(y0mm * MM), int(y1mm * MM)
    band = a[r0:r1]
    cm = (band < DARK).any(axis=0)
    out = []
    for (c0, c1) in runs(cm):
        if (c1 - c0 + 1) / MM >= min_w_mm:
            out.append((c0 / MM, (c1 + 1) / MM))
    return out


print('页 %.1f x %.1f mm' % (W / MM, H / MM))

print('\n=== ① 顶部定标带 (y 9.78~12.22) ===')
tb = blocks_on_row(9.9, 12.1, 2.0)
for (x0, x1) in tb:
    print('   x %7.2f-%7.2f  宽 %.2f  心 %.3f' % (x0, x1, x1 - x0, (x0 + x1) / 2))
if len(tb) > 1:
    d = [(tb[i + 1][0] + tb[i + 1][1]) / 2 - (tb[i][0] + tb[i][1]) / 2 for i in range(len(tb) - 1)]
    print('   节距: %s' % ', '.join('%.3f' % v for v in d[:8]))

print('\n=== ② 第 1 行气泡 / 题号 (y 86.5~89.5 题号行) ===')
for (y0, y1, lab) in [(86.5, 89.5, '题号行'), (91.0, 93.5, 'A 行'), (94.5, 97.0, 'B 行')]:
    bs = blocks_on_row(y0, y1, 2.0)
    print(' %s: %d 个' % (lab, len(bs)))
    for (x0, x1) in bs[:6]:
        print('   x %7.2f-%7.2f  宽 %.2f  心 %.3f' % (x0, x1, x1 - x0, (x0 + x1) / 2))

print('\n=== ③ 左侧定位点列 (x 5.5~9.5) 的暗竖段 ===')
c0, c1 = int(5.5 * MM), int(9.5 * MM)
sub = a[:, c0:c1]
rm = (sub < DARK).any(axis=1)
for (r0, r1) in runs(rm):
    if (r1 - r0 + 1) / MM >= 1.0:
        print('   y %7.2f-%7.2f  高 %.2f  心 %.3f' % (r0 / MM, (r1 + 1) / MM,
                                                    (r1 + 1 - r0) / MM, (r0 + r1 + 1) / 2 / MM))

print('\n=== ④ 选择题黑框左右边缘（在 y 90~100 之间扫竖线）===')
y0, y1 = int(90 * MM), int(100 * MM)
band = a[y0:y1]
col_ink = (band < DARK).sum(axis=0)
# 找「整列几乎全黑」的竖线
cand = [(i / MM, int(col_ink[i])) for i in range(W) if col_ink[i] >= (y1 - y0) * 0.85]
print('   竖线候选（x, 暗像素数）:', [(round(x, 2), n) for x, n in cand][:20])
