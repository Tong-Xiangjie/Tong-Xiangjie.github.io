"""定位参考件 A4 第 1 面的：非选择题红框下沿、页脚文字行。
用来判定「请在各题目的答题区域内作答…」到底在页脚还是别处。
"""
import re
import sys
import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')
MM = 150 / 25.4

# ── 1) 文字层 bbox（单位 pt）→ mm ──
s = open('.ref/a4_bbox.xml', encoding='utf-8', errors='replace').read()
ws = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', s)
print('--- 文字层最后 12 条（pt → mm）---')
for (a, b, c, d, t) in ws[-12:]:
    print('  y %7.2f-%7.2f  x %7.2f-%7.2f  %s' % (
        float(b) * 25.4 / 72, float(d) * 25.4 / 72,
        float(a) * 25.4 / 72, float(c) * 25.4 / 72, t[:48]))
print('  文字层 word 总数 =', len(ws))

# ── 2) 参考 PNG：扫红框左右边缘的竖线，找红框上下沿 ──
a = np.asarray(Image.open('.ref/a1-1.png').convert('L'))
H, W = a.shape


def runs_on(col, thresh=160):
    out = []
    s0 = None
    for i in range(len(col)):
        v = col[i] < thresh
        if v and s0 is None:
            s0 = i
        elif not v and s0 is not None:
            out.append((s0, i - 1))
            s0 = None
    if s0 is not None:
        out.append((s0, len(col) - 1))
    return out


for xmm, label in [(12.53, '红框左边缘'), (197.27, '红框右边缘')]:
    col = a[:, int(xmm * MM)]
    rs = [(r0, r1) for (r0, r1) in runs_on(col) if r1 - r0 >= 1]
    print('\n--- %s (x=%.2fmm) 上的暗竖段 y (mm) ---' % (label, xmm))
    for (r0, r1) in rs:
        print('  y %7.2f-%7.2f  (长 %.2f)' % (r0 / MM, (r1 + 1) / MM, (r1 + 1 - r0) / MM))

# ── 3) 页脚带（y 265..297）逐行文本块的 x 范围 ──
print('\n--- 页脚带 y 265..297mm 的暗行 ---')
y0, y1 = int(265 * MM), H
band = a[y0:y1]
rowmask = (band < 128).any(axis=1)
for (r0, r1) in [(r0, r1) for (r0, r1) in runs_on(255 - rowmask.astype(np.uint8) * 0, 999)
                 if False]:
    pass
runs = []
s0 = None
for i, v in enumerate(rowmask):
    if v and s0 is None:
        s0 = i
    elif not v and s0 is not None:
        runs.append((s0, i - 1))
        s0 = None
if s0 is not None:
    runs.append((s0, len(rowmask) - 1))
for (r0, r1) in runs:
    if r1 - r0 < 1:
        continue
    sub = band[r0:r1 + 1]
    cm = (sub < 128).any(axis=0)
    c0 = int(np.argmax(cm))
    c1 = len(cm) - 1 - int(np.argmax(cm[::-1]))
    print('  y %7.2f-%7.2f   x %7.2f-%7.2f   ink=%d' % (
        (y0 + r0) / MM, (y0 + r1 + 1) / MM, c0 / MM, (c1 + 1) / MM, int((sub < 128).sum())))
