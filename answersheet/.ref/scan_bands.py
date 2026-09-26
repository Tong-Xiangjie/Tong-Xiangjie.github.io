"""全页扫描：找出所有「顶部定标带」候选行（一行里有多个等距小方块），
并量出第一行气泡的列心，用来定「最左列 vs 最左定位点」的关系。
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


# 逐行统计「暗块个数」，找出那些一行里有 10+ 个小方块的行（= 定标带）
print('=== 全页「一行里有 >=8 个横向暗块」的 y 段 ===')
row_counts = []
for y in range(H):
    cm = a[y] < DARK
    bl = runs(cm, 3)
    row_counts.append(len(bl))
row_counts = np.array(row_counts)
mask = row_counts >= 8
for (r0, r1) in runs(mask, 2):
    y0, y1 = r0 / MM, (r1 + 1) / MM
    if y1 - y0 < 0.5:
        continue
    # 取中间一行量块心
    ymid = (r0 + r1) // 2
    cm = a[ymid] < DARK
    bl = runs(cm, 3)
    xs = [((c0 + c1 + 1) / 2) / MM for (c0, c1) in bl]
    print('  y %6.2f-%6.2f  块数 %2d   前6心: %s' % (
        y0, y1, len(bl), ', '.join('%.2f' % v for v in xs[:6])))
