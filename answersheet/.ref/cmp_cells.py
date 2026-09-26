# -*- coding: utf-8 -*-
"""定位矢量件与位图件到底哪一块不一样（把纸分成格子比墨量）。"""
import os, subprocess, sys, glob
sys.stdout.reconfigure(encoding='utf-8')
from PIL import Image
import numpy as np

PP = r'E:\texlive\2025\bin\windows\pdftoppm.exe'
TMP = '.ref/out/cmp'
DPI = 200
mmd = DPI / 25.4


def render(tag, path):
    for f in glob.glob(os.path.join(TMP, tag + '-*.png')):
        os.remove(f)
    subprocess.run([PP, '-r', str(DPI), '-png', '-gray', path,
                    os.path.join(TMP, tag)], capture_output=True)
    return sorted(glob.glob(os.path.join(TMP, tag + '-*.png')))


vp = render('vec', '.ref/out/reg/a4-color-12+2.pdf')
rp = render('ras', '.ref/out/fallback.pdf')

for pi in (1, 2):
    ia = np.asarray(Image.open(vp[pi - 1]).convert('L')).astype(float)
    ib = np.asarray(Image.open(rp[pi - 1]).convert('L')).astype(float)
    ink_a, ink_b = 255 - ia, 255 - ib
    print('\n══ 第 %d 面 ══' % pi)
    print('  总墨量  矢量 %.0f  位图 %.0f  （比 %.3f）'
          % (ink_a.sum(), ink_b.sum(), ink_a.sum() / max(1, ink_b.sum())))

    # 20 x 28 格 ≈ 10.5mm x 10.5mm
    R, C = 28, 20
    h, w = ia.shape
    print('  按 10.5mm 格子比（只列差异最大的 10 格）：')
    rows = []
    for r in range(R):
        for c in range(C):
            sa = ink_a[r * h // R:(r + 1) * h // R, c * w // C:(c + 1) * w // C].sum()
            sb = ink_b[r * h // R:(r + 1) * h // R, c * w // C:(c + 1) * w // C].sum()
            d = abs(sa - sb)
            rows.append((d, r, c, sa, sb))
    rows.sort(reverse=True)
    for d, r, c, sa, sb in rows[:10]:
        print('    y %5.1f-%5.1f mm  x %5.1f-%5.1f mm   矢量 %8.0f  位图 %8.0f  Δ %8.0f'
              % (r * h / R / mmd, (r + 1) * h / R / mmd,
                 c * w / C / mmd, (c + 1) * w / C / mmd, sa, sb, d))
