# -*- coding: utf-8 -*-
"""把 pdftoppm 渲染出来的矢量 PDF 页面与预览截图逐行比墨迹。

两者是完全独立的渲染路径：
  · 矢量 PDF  → pdftoppm（Poppler，用嵌入的 SimHei/SimSun 子集）
  · 预览      → Chrome 截图（用系统 SimHei/SimSun）
所以行墨迹分布对得上，就说明导出件与预览在几何上一致。

⚠ 96dpi 下 1px = 0.2646mm，所以行级比对的分辨率就是这个量级；
   要看更细的偏差就把 dpi 提到 300（1px = 0.0847mm）。
"""
import io, os, sys
sys.stdout.reconfigure(encoding='utf-8')

try:
    from PIL import Image
except ImportError:
    print('需要 Pillow：python -m pip install Pillow')
    sys.exit(2)

def row_ink(path, w, h):
    im = Image.open(path).convert('L').resize((w, h), Image.LANCZOS)
    px = im.load()
    rows = [0] * h
    for y in range(h):
        n = 0
        for x in range(w):
            if px[x, y] < 245:
                n += 1
        rows[y] = n
    return rows

def ink_range(rows, ppm):
    f = next((y for y, v in enumerate(rows) if v > 3), -1)
    l = next((y for y in range(len(rows) - 1, -1, -1) if rows[y] > 3), -1)
    return f / ppm, l / ppm

def main(pdf_png, prev_png, paper_mm=(210.0, 297.0)):
    DPI = 96.0
    ppm = DPI / 25.4
    W, H = int(round(paper_mm[0] * ppm)), int(round(paper_mm[1] * ppm))
    a = row_ink(pdf_png, W, H)      # 矢量 PDF 渲染
    b = row_ink(prev_png, W, H)     # 预览截图
    ra, rb = ink_range(a, ppm), ink_range(b, ppm)
    print('矢量 PDF 墨迹范围   %.2f .. %.2f mm' % ra)
    print('预览截图 墨迹范围   %.2f .. %.2f mm' % rb)
    print('        首行差 %.2f mm   末行差 %.2f mm' % (ra[0] - rb[0], ra[1] - rb[1]))

    mmN = int(round(paper_mm[1]))
    A = [0.0] * mmN
    B = [0.0] * mmN
    for y in range(H):
        i = min(mmN - 1, int(y / ppm))
        A[i] += a[y]; B[i] += b[y]
    tot_a, tot_b = sum(A), sum(B)
    print('墨迹总量比（矢量/预览）= %.3f' % (tot_a / max(1, tot_b)))

    diff, worst, worst_mm = [], 0.0, -1
    for s in range(mmN):
        if B[s] < 80:
            continue
        rel = abs(A[s] - B[s]) / B[s]
        if rel > worst:
            worst, worst_mm = rel, s
        if rel > 0.5:
            diff.append((s, round(A[s]), round(B[s]), round(rel * 100)))
    print('1mm 分段里墨量相差 >50%% 的：%d 段（共 %d 段有墨）' % (len(diff), sum(1 for v in B if v >= 80)))
    print('最差段 %.0f%% 在第 %d mm' % (worst * 100, worst_mm))
    for d in sorted(diff, key=lambda t: -abs(t[1] - t[2]))[:14]:
        print('   %3d mm：矢量 %5d  预览 %5d  差 %3d%%' % d)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
