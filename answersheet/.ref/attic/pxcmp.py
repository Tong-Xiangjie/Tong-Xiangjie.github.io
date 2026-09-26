# -*- coding: utf-8 -*-
"""逐像素核对：矢量 PDF 的 300dpi 渲染 vs 预览的 300dpi 截图。

两张图都是 0.0847mm/px、都是 210×297mm 整页、白底，
所以可以直接按「每 1mm 段墨量」和「横线位置」比。

差异来源（预期内的）：
  · 字形不同渲染器（Poppler vs Chrome）会有细微抗锯齿差；
  · 预览的黑框是 CSS border（画在盒内），矢量是路径描边（线宽居中），
    差半个线宽 = 0.13mm，在 300dpi 下约 1.5px。
所以判据不是「像素相同」，而是：
  · 每 1mm 段的墨量分布形状一致（相关性强、无明显缺失段）；
  · 关键横线的位置差 < 0.15mm。
"""
import io, sys
sys.stdout.reconfigure(encoding='utf-8')
from PIL import Image

pdf_png, prev_png = sys.argv[1], sys.argv[2]

def load(path, w, h):
    im = Image.open(path).convert('L')
    if im.size != (w, h):
        im = im.resize((w, h), Image.LANCZOS)
    return im.load()

# ⚠ 不要假定两张图同分辨率 —— 分别按自己的宽度推 px/mm，
#   再统一重采样到同一栅格。差一点点分辨率就会让横线整体偏移 2mm。
ia, ib = Image.open(pdf_png), Image.open(prev_png)
print('矢量渲染 %s  %.2f px/mm' % (ia.size, ia.size[0] / 210.0))
print('预览截图 %s  %.2f px/mm' % (ib.size, ib.size[0] / 210.0))
TARGET = 300.0
PPM = TARGET / 25.4
W, H = int(round(210 * PPM)), int(round(297 * PPM))
A = load(pdf_png, W, H)
B = load(prev_png, W, H)
print('统一重采样到 %dx%d  (%.4f mm/px, 等价 %.0f dpi)' % (W, H, 25.4 / TARGET, TARGET))

def dark(p, x, y, th=160):
    return p[x, y] < th

# ── 每 1mm 段墨量 ──────────────────────────────────────────────────
mmN = 297
sa = [0] * mmN
sb = [0] * mmN
for y in range(H):
    s = min(mmN - 1, int(y / PPM))
    ca = cb = 0
    for x in range(0, W, 2):
        if A[x, y] < 160: ca += 1
        if B[x, y] < 160: cb += 1
    sa[s] += ca
    sb[s] += cb

ta, tb = sum(sa), sum(sb)
print('总墨量：矢量 %d   预览 %d   比值 %.3f' % (ta, tb, ta / max(1, tb)))

ink_a = [i for i, v in enumerate(sa) if v > 20]
ink_b = [i for i, v in enumerate(sb) if v > 20]
miss_a = sorted(set(ink_b) - set(ink_a))
miss_b = sorted(set(ink_a) - set(ink_b))
print('有墨的 1mm 段：矢量 %d，预览 %d' % (len(ink_a), len(ink_b)))
print('  预览有墨而矢量没有的段：%s' % (miss_a if miss_a else '无'))
print('  矢量有墨而预览没有的段：%s' % (miss_b if miss_b else '无'))

# 相关性
import math
n = len(ink_b)
if n > 2:
    ma, mb = sum(sa) / mmN, sum(sb) / mmN
    cov = sum((sa[i] - ma) * (sb[i] - mb) for i in range(mmN))
    va = math.sqrt(sum((sa[i] - ma) ** 2 for i in range(mmN)))
    vb = math.sqrt(sum((sb[i] - mb) ** 2 for i in range(mmN)))
    print('每毫米墨量相关系数 r = %.4f  （1.0 = 完全一致）' % (cov / (va * vb + 1e-9)))

# 最差的段
diffs = [(abs(sa[i] - sb[i]) / max(1, sb[i]), i, sa[i], sb[i])
         for i in range(mmN) if sb[i] >= 80]
diffs.sort(reverse=True)
print('\n偏差最大的 12 段：')
for rel, i, a, b in diffs[:12]:
    print('   %3d mm  矢量 %6d  预览 %6d  差 %3.0f%%' % (i, a, b, rel * 100))

# ── 横线位置 ───────────────────────────────────────────────────────
def hlines(p):
    out = []
    y = 0
    while y < H:
        c = sum(1 for x in range(0, W, 4) if dark(p, x, y))
        if c / (W / 4) > 0.55:
            y0 = y
            while y < H:
                c2 = sum(1 for x in range(0, W, 4) if dark(p, x, y))
                if c2 / (W / 4) <= 0.55:
                    break
                y += 1
            out.append((y0 + y - 1) / 2 / PPM)
        y += 1
    return out

ha, hb = hlines(A), hlines(B)
print('\n横线：矢量 %d 条，预览 %d 条' % (len(ha), len(hb)))
print('  矢量：%s' % ' '.join('%.2f' % v for v in ha))
print('  预览：%s' % ' '.join('%.2f' % v for v in hb))
if len(ha) == len(hb):
    d = [abs(a - b) for a, b in zip(ha, hb)]
    print('  逐条最大位置差 %.3f mm' % max(d))
else:
    # 用最近邻配对
    worst = 0
    for a in ha:
        if hb:
            worst = max(worst, min(abs(a - b) for b in hb))
    print('  条数不同；矢量每条到最近预览线的最大距离 %.3f mm' % worst)
