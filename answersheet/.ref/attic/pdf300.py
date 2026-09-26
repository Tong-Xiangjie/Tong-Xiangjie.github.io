# -*- coding: utf-8 -*-
"""在 300dpi 下核对矢量 PDF 渲染件：找横线/竖线、找文字块。

96dpi 太低，0.265mm 的发丝线（黑框）会被 Poppler 直接抹掉，
所以必须在 300dpi（1px = 0.0847mm）下看。
"""
import io, sys
sys.stdout.reconfigure(encoding='utf-8')
from PIL import Image

path = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/png/vec300-1.png'
DPI = 300.0
PPM = DPI / 25.4
im = Image.open(path).convert('L')
W, H = im.size
px = im.load()
print('%s  %dx%d  %.3f px/mm' % (path, W, H, PPM))


def dark(x, y, th=160):
    return px[x, y] < th


# ── 1. 横线：某一行里连续深色像素占总宽 60% 以上 ──────────────────
print('\n=== 横线（宽度 >60%）===')
hlines = []
y = 0
while y < H:
    n = sum(1 for x in range(0, W, 3) if dark(x, y))
    frac = n / (W / 3)
    if frac > 0.6:
        y0 = y
        while y < H:
            n2 = sum(1 for x in range(0, W, 3) if dark(x, y))
            if n2 / (W / 3) <= 0.6:
                break
            y += 1
        hlines.append((y0, y - 1, frac))
    y += 1
for a, b2, f in hlines[:40]:
    print('  y=%8.3f..%8.3f mm   (%.0f%%)' % (a / PPM, b2 / PPM, f * 100))
print('  共 %d 条' % len(hlines))

# ── 2. 竖线：某一列里连续深色像素占总高 40% 以上 ──────────────────
print('\n=== 竖线（高度 >40%）===')
vlines = []
x = 0
while x < W:
    n = sum(1 for y in range(0, H, 3) if dark(x, y))
    if n / (H / 3) > 0.4:
        x0 = x
        while x < W:
            n2 = sum(1 for y in range(0, H, 3) if dark(x, y))
            if n2 / (H / 3) <= 0.4:
                break
            x += 1
        vlines.append((x0, x - 1))
    x += 1
for a, b2 in vlines[:40]:
    print('  x=%8.3f..%8.3f mm' % (a / PPM, b2 / PPM))
print('  共 %d 条' % len(vlines))

# ── 3. 墨迹行分布（1mm 分段），确认文字块都在 ──────────────────────
print('\n=== 每 1mm 的墨迹量（只列有墨的段，前 60 段）===')
mmN = 297
seg = [0] * mmN
for y in range(H):
    s = min(mmN - 1, int(y / PPM))
    seg[s] += sum(1 for x in range(0, W, 2) if dark(x, y))
ink = [(i, v) for i, v in enumerate(seg) if v > 20]
print('  有墨的 1mm 段数 = %d，总墨量 = %d' % (len(ink), sum(seg)))
for i, v in ink[:60]:
    print('   %3d mm  %6d' % (i, v))
