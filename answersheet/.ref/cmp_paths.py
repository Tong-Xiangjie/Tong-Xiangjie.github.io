# -*- coding: utf-8 -*-
"""矢量件 vs 位图件：先看是不是整体平移，再用「膨胀容差」比结构。

⚠ 第一版直接比 <200 的二值墨迹得到 IoU 0.18，那多半是两条管线的
   抗锯齿阈值不同（位图是 html2canvas 画的细笔画，矢量是 poppler 填的
   实心笔画），不是内容错位。所以这里分三步查：
     ① 各自的墨迹包围盒 / 质心 —— 看有没有整体平移或缩放
     ② 逐行、逐列投影的相关系数 —— 对阈值不敏感
     ③ 互相膨胀 1.5px 后的覆盖率 —— 位置对了就该接近 1
"""
import io, os, subprocess, sys, glob
sys.stdout.reconfigure(encoding='utf-8')
from PIL import Image
import numpy as np

PP = r'E:\texlive\2025\bin\windows\pdftoppm.exe'
TMP = '.ref/out/cmp'
VEC = '.ref/out/reg/a4-color-12+2.pdf'
RAS = '.ref/out/fallback.pdf'
DPI = 200


def render(tag, path):
    for f in glob.glob(os.path.join(TMP, tag + '-*.png')):
        os.remove(f)
    subprocess.run([PP, '-r', str(DPI), '-png', '-gray', path,
                    os.path.join(TMP, tag)], capture_output=True)
    return sorted(glob.glob(os.path.join(TMP, tag + '-*.png')))


os.makedirs(TMP, exist_ok=True)
vp, rp = render('vec', VEC), render('ras', RAS)
print('矢量 %d 页 / 位图 %d 页' % (len(vp), len(rp)))

PT = 72.0


def bbox(m):
    ys, xs = np.where(m)
    if not len(ys):
        return None
    return xs.min(), ys.min(), xs.max(), ys.max()


def dilate(m, r):
    out = m.copy()
    for _ in range(r):
        o = out.copy()
        o[1:, :] |= out[:-1, :]
        o[:-1, :] |= out[1:, :]
        o[:, 1:] |= out[:, :-1]
        o[:, :-1] |= out[:, 1:]
        out = o
    return out


for i, (a, b) in enumerate(zip(vp, rp), 1):
    ia = np.asarray(Image.open(a).convert('L')).astype(np.int16)
    ib = np.asarray(Image.open(b).convert('L')).astype(np.int16)
    if ia.shape != ib.shape:
        print('第 %d 页尺寸不同 %s vs %s' % (i, ia.shape, ib.shape)); continue
    print('\n── 第 %d 页  %s ──' % (i, ia.shape))

    # ① 墨迹包围盒（阈值取得宽松一致，只看整体位置）
    for lbl, im in [('矢量', ia), ('位图', ib)]:
        m = im < 200
        bb = bbox(m)
        mmd = DPI / 25.4
        if bb:
            print('  %s 墨迹包围盒  左 %.2f 上 %.2f 右 %.2f 下 %.2f mm'
                  % (lbl, bb[0] / mmd, bb[1] / mmd, bb[2] / mmd, bb[3] / mmd))

    # ② 投影相关（对阈值不敏感）
    for axis, name in [(0, '逐列'), (1, '逐行')]:
        pa = (255 - ia).sum(axis=axis).astype(float)
        pb = (255 - ib).sum(axis=axis).astype(float)
        pa -= pa.mean(); pb -= pb.mean()
        c = float((pa * pb).sum() / (np.sqrt((pa * pa).sum()) * np.sqrt((pb * pb).sum())))
        print('  %s 投影相关系数 %.5f' % (name, c))

    # ③ 互相膨胀 1.5px 后的覆盖率
    ma, mb = ia < 200, ib < 200
    da, db = dilate(ma, 3), dilate(mb, 3)
    cov_b = (mb & da).sum() / max(1, mb.sum())   # 位图的墨有多少落在矢量墨附近
    cov_a = (ma & db).sum() / max(1, ma.sum())
    print('  位图墨被矢量覆盖 %.4f   矢量墨被位图覆盖 %.4f' % (cov_b, cov_a))
    print('  → %s' % ('位置一致（差异只是笔画粗细/抗锯齿）'
                     if min(cov_a, cov_b) > 0.9 else '有结构性差异，需要查'))
