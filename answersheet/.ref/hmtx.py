# -*- coding: utf-8 -*-
"""看子集字体的 hmtx 推进宽度 —— 判断竖排「一列一条 run」为什么跑出纸外。"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
from fontTools.ttLib import TTFont

for p in ['fonts/SimSun.subset.ttf', 'fonts/SimHei.subset.ttf']:
    f = TTFont(p)
    upm = f['head'].unitsPerEm
    hmtx = f['hmtx']
    cmap = f.getBestCmap()
    print('%s  upm=%d  字形数=%d' % (p, upm, len(hmtx.metrics)))
    ws = sorted(set(v[0] for v in hmtx.metrics.values()))
    print('   推进宽度取值（前 8）：%s ... 共 %d 种' % (ws[:8], len(ws)))
    # 找几个具体字
    for ch in '考生请不要在此区域作答注意事项':
        gn = cmap.get(ord(ch))
        if gn and gn in hmtx.metrics:
            adv = hmtx.metrics[gn][0]
            print('   %s → 字形 %-12s 推进 %d (%.3f em)' % (ch, gn, adv, adv / upm))
        else:
            print('   %s → 不在子集里！' % ch)
    print()
