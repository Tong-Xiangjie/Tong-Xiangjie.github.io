# -*- coding: utf-8 -*-
"""量化位图兜底的「每张纸高度取 o = ph*2 − 1」这个偏差是怎么累积的。"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

for name, pw, ph in [('A4', 210, 297), ('A3', 420, 297)]:
    for scale in (2,):
        ph_px = round(ph / 25.4 * 96)          # 纸张高（CSS px）
        pad = 0                                 # 单张纸 canvas 高 = ph_px*scale + pad?
        single = ph_px * scale
        o = ph_px * scale - 1
        print('%s scale=%d：单张纸 canvas 高 %d px，切页高 o = %d px，每张少 %d px'
              % (name, scale, single, o, single - o))
        for n in (1, 2, 4):
            H = n * o
            need = n * single
            loss = need - H
            print('   %d 张纸：拼合画布 %d px（应为 %d），累计截掉 %d px = %.2f mm'
                  % (n, H, need, loss, loss / scale / 96 * 25.4))
        print()
