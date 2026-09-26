# -*- coding: utf-8 -*-
"""把绘制清单里「请在各题目的答题区域内作答…」那条打出来，判断是真溢出还是估算太粗。"""
import io, json, sys
sys.stdout.reconfigure(encoding='utf-8')
d = json.load(io.open('.ref/out/vector.measure.json', encoding='utf-8'))
for pi, pg in enumerate(d['pages']):
    for t in pg['texts']:
        if '请在各题' in t.get('text', ''):
            n = len(t['text'])
            est = n * t['size'] * 25.4 / 72.0
            print('第 %d 面' % (pi + 1))
            print('  文本      : %s' % t['text'])
            print('  字数      : %d' % n)
            print('  字号      : %.4f pt' % t['size'])
            print('  x (锚点)  : %.4f mm' % t['x'])
            print('  w (量出)  : %.4f mm' % t['w'])
            print('  align     : %s' % t.get('align'))
            print('  按 1em 估 : %.4f mm' % est)
            print('  估算 vs 量出: %+.4f mm（%.2f%%）' % (est - t['w'], (est / t['w'] - 1) * 100))
            if t.get('align') == 'center':
                print('  居中锚点 → 左边 x0 = %.4f，右边 x1 = %.4f'
                      % (t['x'] - est / 2, t['x'] + est / 2))
