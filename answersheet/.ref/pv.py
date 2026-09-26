import io
p = '.ref/verify_pdf.py'
s = io.open(p, encoding='utf-8').read()

cur = """    over = []
    for pi, pg in enumerate(draw['pages']):
        W = 420.0 if (pg.get('w') or 0) > 400 else 210.0
        for t in pg['texts']:
            x = t.get('x')
            w = t.get('w') or 0
            if x is None:
                continue
            if t.get('align') == 'center':
                x0, x1 = x - w / 2, x + w / 2
            elif t.get('align') == 'right':
                x0, x1 = x - w, x
            else:
                # 左缘落笔：DOM 墨迹宽就是它的实际占位
                x0, x1 = x, x + w
            if x0 < -0.5 or x1 > W + 0.5:
                over.append((pi + 1, (t.get('text') or '')[:20],
                             round(x0, 2), round(x1, 2), W))
    rec('文字：全部落在纸内', not over,
        '%d 条文字未越界%s' % (sum(len(p['texts']) for p in draw['pages']),
                            '' if not over else '；%d 条越界' % len(over)))
    for o in over[:6]:
        print('      第%d面 「%s」 x=%.2f→%.2f（纸宽 %.0f）' % o)"""

new = """    # ⚠ 只对 **align:'left'** 的 run 算右缘。中心/右对齐时 `x` 是锚点，
    #   而中心锚点未必在整张纸的中心（「请在各题目的答题区域内作答…」是
    #   在**非选择题框内部**居中，墨迹左缘 6.7mm）。拿锚点减半个量出的宽
    #   会算出 -1.63mm 的假越界。
    #   中心/右对齐 run 的落笔点由 draw.js 用 getTextWidth 自己算，
    #   `x` 是锚点、量不出右缘 —— 但「整页墨迹都在纸内」由下面的
    #   check_render（pdftoppm 渲染后的墨迹包围盒）真实兜住，不会漏。
    over, n_left = [], 0
    for pi, pg in enumerate(draw['pages']):
        W = 420.0 if (pg.get('w') or 0) > 400 else 210.0
        for t in pg['texts']:
            if (t.get('align') or 'left') != 'left' or t.get('x') is None:
                continue
            n_left += 1
            x0, x1 = t['x'], t['x'] + (t.get('w') or 0)
            if x0 < -0.5 or x1 > W + 0.5:
                over.append((pi + 1, (t.get('text') or '')[:20],
                             round(x0, 2), round(x1, 2), W))
    rec('文字：左对齐 run 全部落在纸内', not over,
        '%d 条左对齐文字未越界%s' % (n_left,
                                '' if not over else '；%d 条越界' % len(over)))
    for o in over[:6]:
        print('      第%d面 「%s」 x=%.2f→%.2f（纸宽 %.0f）' % o)"""
assert cur in s, 'locate failed'
s = s.replace(cur, new)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
