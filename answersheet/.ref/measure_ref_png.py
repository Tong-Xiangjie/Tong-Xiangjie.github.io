"""从参考件 PNG 里量出「左侧定位块」与「红框」的像素位置，换算成 mm。

参考件 p1-1.png / a1-1.png 是 150dpi 渲染的整页（A4 210×297mm）。
150dpi 下 1mm = 150/25.4 = 5.9055 px。
"""
import sys
import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

MM = 150 / 25.4


def load(path):
    im = Image.open(path).convert('L')
    a = np.asarray(im)
    return a, a.shape[1], a.shape[0]


def dark_cols(a, y0, y1, thresh=128):
    """在 y0..y1 行范围内，找出所有「暗像素」列的连续区间"""
    band = a[y0:y1]
    colmask = (band < thresh).any(axis=0)
    runs = []
    s = None
    for i, v in enumerate(colmask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            runs.append((s, i - 1))
            s = None
    if s is not None:
        runs.append((s, len(colmask) - 1))
    return runs


def dark_rows(a, x0, x1, thresh=128):
    band = a[:, x0:x1]
    rowmask = (band < thresh).any(axis=1)
    runs = []
    s = None
    for i, v in enumerate(rowmask):
        if v and s is None:
            s = i
        elif not v and s is not None:
            runs.append((s, i - 1))
            s = None
    if s is not None:
        runs.append((s, len(rowmask) - 1))
    return runs


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else '.ref/p1-1.png'
    a, W, H = load(path)
    print('%s  %dx%d px  -> %.1f x %.1f mm @150dpi' % (path, W, H, W / MM, H / MM))

    # 左侧定位块：x 在 5~14mm 之间，y 在 60~110mm 之间
    x0, x1 = int(4 * MM), int(15 * MM)
    y0, y1 = int(60 * MM), int(110 * MM)
    print('\n--- 左侧定位块（x 4~15mm, y 60~110mm）---')
    for (ry0, ry1) in dark_rows(a, x0, x1):
        if ry1 - ry0 < 2:
            continue
        ymid0, ymid1 = ry0, ry1 + 1
        cols = dark_cols(a, ymid0, ymid1)
        cols = [c for c in cols if c[1] - c[0] >= 2]
        if not cols:
            continue
        print('  y %7.2f-%7.2f mm   x runs: %s' % (
            ry0 / MM, (ry1 + 1) / MM,
            ', '.join('%.2f-%.2f(w=%.2f)' % (c[0] / MM, (c[1] + 1) / MM,
                                             (c[1] + 1 - c[0]) / MM) for c in cols[:6])))

    # 红框：找整页里最外层的红色/暗色长竖线
    print('\n--- 竖直长线（在 y 75~100mm 行范围内，找连续竖线）---')
    band = a[int(75 * MM):int(100 * MM)]
    colmask = (band < 160).mean(axis=0)
    runs = []
    s = None
    for i, v in enumerate(colmask > 0.9):
        if v and s is None:
            s = i
        elif not v and s is not None:
            runs.append((s, i - 1)); s = None
    if s is not None:
        runs.append((s, len(colmask) - 1))
    for (c0, c1) in runs:
        print('  x %7.2f-%7.2f mm  (w=%.2f)' % (c0 / MM, (c1 + 1) / MM, (c1 + 1 - c0) / MM))


main()
