# -*- coding: utf-8 -*-
"""独立测两张位图的墨迹包围盒（不做任何缩放假设），
用来判断「预览截图」和「矢量渲染」到底是不是同一块纸、同一比例。
"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
from PIL import Image

def bbox(path, th=200):
    im = Image.open(path).convert('L')
    W, H = im.size
    px = im.load()
    x0, y0, x1, y1 = W, H, -1, -1
    for y in range(H):
        for x in range(W):
            if px[x, y] < th:
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    return W, H, x0, y0, x1, y1

for p in sys.argv[1:]:
    W, H, x0, y0, x1, y1 = bbox(p)
    w_mm = W / (300 / 25.4)
    print('%s' % p)
    print('   位图 %dx%d  （若 300dpi 则 %.2f × %.2f mm）' % (W, H, w_mm, H / (300 / 25.4)))
    print('   墨迹包围盒 x %d..%d  y %d..%d' % (x0, x1, y0, y1))
    print('   → 以 300dpi 换算：左 %.2f 右 %.2f 上 %.2f 下 %.2f mm；宽 %.2f 高 %.2f mm'
          % (x0 / (300 / 25.4), x1 / (300 / 25.4), y0 / (300 / 25.4), y1 / (300 / 25.4),
             (x1 - x0) / (300 / 25.4), (y1 - y0) / (300 / 25.4)))
    # 估算自身 px/mm：假设墨迹左右边界对应纸的 5.558..204.442（角标外缘）
    print('   墨迹宽/高 比 = %.4f' % ((x1 - x0) / max(1, y1 - y0)))
