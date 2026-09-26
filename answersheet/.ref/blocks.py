"""Accurate 2D block detector: find true solid black rectangles (positioning marks,
corner marks, bubbles) via connected components, in mm."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pix2

PAGES = [
    ('A3 数学仿真1  p1', 'm1-1.png'),
    ('A3 数学仿真1  p2', 'm1-2.png'),
    ('A3 物理仿真2  p1', 'p1-1.png'),
    ('A3 物理仿真2  p2', 'p1-2.png'),
    ('A4 数学答题卡 p1', 'a1-1.png'),
    ('A4 数学答题卡 p2', 'a1-2.png'),
]
DPI = 150
MM = 25.4 / DPI

def components(path):
    w, h, ch, ct, px = pix2.read_png(path)
    lab = [[pix2.classify(px[(y*w+x)*ch], px[(y*w+x)*ch+1], px[(y*w+x)*ch+2]) for x in range(w)] for y in range(h)]
    black = [[lab[y][x] == 'BLACK' for x in range(w)] for y in range(h)]
    seen = [[False]*w for _ in range(h)]
    comps = []
    for sy in range(h):
        for sx in range(w):
            if not black[sy][sx] or seen[sy][sx]:
                continue
            stack = [(sx, sy)]
            seen[sy][sx] = True
            x0 = x1 = sx; y0 = y1 = sy; n = 0
            while stack:
                x, y = stack.pop(); n += 1
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h and black[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            comps.append((x0, y0, x1, y1, n))
    return comps

out = open(os.path.join(HERE, 'blocks.txt'), 'w', encoding='utf-8')
def P(*a): print(*a, file=out)

for label, png in PAGES:
    p = os.path.join(HERE, png)
    if not os.path.exists(p):
        P(f'--- {label}: missing'); continue
    comps = components(p)
    blocks = []
    for x0, y0, x1, y1, n in comps:
        wmm = (x1-x0+1)*MM; hmm = (y1-y0+1)*MM
        fill = n / ((x1-x0+1)*(y1-y0+1))
        if wmm >= 1.0 and hmm >= 1.0 and fill > 0.85:
            blocks.append((round(x0*MM,2), round(y0*MM,2), round(wmm,2), round(hmm,2), round(fill,2)))
    P('')
    P('='*100)
    P(f'{label}   实心黑块 {len(blocks)} 个')
    P('='*100)
    # corner marks: w>=6
    corner = [b for b in blocks if b[2] >= 6]
    marks  = [b for b in blocks if 1.0 <= b[2] < 6]
    P('  【大角标 w>=6mm】')
    for x, y, ww, hh, f in sorted(corner, key=lambda b: (b[1], b[0])):
        P(f'      x={x:7.2f} y={y:7.2f}  w={ww:5.2f} h={hh:5.2f}')
    P(f'  【小定位块 1<=w<6mm】 共 {len(marks)} 个')
    for x, y, ww, hh, f in sorted(marks, key=lambda b: (b[1], b[0])):
        P(f'      x={x:7.2f} y={y:7.2f}  w={ww:5.2f} h={hh:5.2f}  fill={f}')
    # group small marks into vertical columns
    cols = {}
    for x, y, ww, hh, f in marks:
        key = round(x/3.0)
        cols.setdefault(key, []).append((x, y, ww, hh))
    if cols:
        P('  【小定位块按列分组】')
        for k in sorted(cols):
            items = sorted(cols[k], key=lambda b: b[1])
            xs = [i[0] for i in items]; ws = [i[2] for i in items]
            P(f'      列 x≈{min(xs):7.2f}..{max(xs)+max(ws):7.2f}  n={len(items)}')
            prev = None
            for x, y, ww, hh in items:
                pit = '' if prev is None else f'  pitch={y-prev:6.2f}'
                P(f'          y={y:7.2f}  h={hh:5.2f}  w={ww:5.2f}{pit}')
                prev = y
out.close()
print('wrote blocks.txt')
