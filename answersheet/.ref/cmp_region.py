# -*- coding: utf-8 -*-
"""两条件在关键区域的墨量：非答题区内部、以及页脚带。

第 2 面 DOM 实测只有：
  .as-noanswer       x 14.0-196.0  y  54.6-280.9
  .as-noanswer-text  x 95.9-114.1  y  80.4-255.1
其余都是空白纸。所以「非答题区内部、竖排文字那一条以外」的墨都值得怀疑。
"""
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


def ink(img, x0, y0, x1, y1):
    a = np.asarray(Image.open(img).convert('L')).astype(float)
    s = int(y0 * mmd), int(y1 * mmd), int(x0 * mmd), int(x1 * mmd)
    return (255 - a[s[0]:s[1], s[2]:s[3]]).sum()


print('第 2 面 · 非答题区内部（x 14-196, y 54.6-280.9）')
print('  矢量 %12.0f' % ink(vp[1], 14, 54.6, 196, 280.9))
print('  位图 %12.0f' % ink(rp[1], 14, 54.6, 196, 280.9))
print()
print('第 2 面 · 非答题区内部但**竖排文字条以外**（x 14-95 与 115-196）')
for lbl, x0, x1 in [('左半边 x 14-95', 14, 95), ('右半边 x 115-196', 115, 196)]:
    print('  %-16s 矢量 %10.0f   位图 %10.0f'
          % (lbl, ink(vp[1], x0, 54.6, x1, 280.9), ink(rp[1], x0, 54.6, x1, 280.9)))
print()
print('第 2 面 · 可疑横带（x 105-189, y 244-255）')
print('  矢量 %12.0f' % ink(vp[1], 105, 244, 189, 255))
print('  位图 %12.0f' % ink(rp[1], 105, 244, 189, 255))
