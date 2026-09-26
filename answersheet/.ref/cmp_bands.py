# -*- coding: utf-8 -*-
"""逐 5mm 横带比墨量：看矢量件与位图件的内容是不是整体错位。"""
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
    ia = 255 - np.asarray(Image.open(vp[pi - 1]).convert('L')).astype(float)
    ib = 255 - np.asarray(Image.open(rp[pi - 1]).convert('L')).astype(float)
    h = ia.shape[0]
    band = int(5 * mmd)
    print('\n══ 第 %d 面：每 5mm 横带的墨量（只列两边有墨的带）══' % pi)
    print('    y(mm)      矢量        位图       Δ')
    for y in range(0, h, band):
        sa = ia[y:y + band].sum() / 1000
        sb = ib[y:y + band].sum() / 1000
        if sa < 1 and sb < 1:
            continue
        mark = '  <<<' if abs(sa - sb) > max(sa, sb) * 0.5 else ''
        print('  %5.1f-%5.1f  %9.0f  %9.0f  %+9.0f%s'
              % (y / mmd, min(297, (y + band) / mmd), sa, sb, sa - sb, mark))
