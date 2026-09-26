"""Measure the actual choice-bubble rectangles (outlined, not filled) on the
reference cards, by finding enclosed white regions whose border is coloured.

This gives the true bubble width/height, which the positioning marks must equal.
"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pix2

PAGES = [
    ('A3 math p1', 'm1-1.png'),
    ('A4 math p1', 'a1-1.png'),
]
DPI = 150
MM = 25.4 / DPI

def analyse(label, png):
    path = os.path.join(HERE, png)
    w, h, ch, ct, px = pix2.read_png(path)
    def lab(x, y):
        i = (y * w + x) * ch
        return pix2.classify(px[i], px[i+1], px[i+2])
    grid = [[lab(x, y) for x in range(w)] for y in range(h)]

    # flood fill white regions that are NOT connected to the page background
    seen = [[False] * w for _ in range(h)]
    comps = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or grid[sy][sx] is not None:
                continue
            stack = [(sx, sy)]
            seen[sy][sx] = True
            x0 = x1 = sx; y0 = y1 = sy; n = 0
            edge = set()
            big = False
            while stack:
                x, y = stack.pop(); n += 1
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
                if x == 0 or y == 0 or x == w-1 or y == h-1:
                    big = True
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if not (0 <= nx < w and 0 <= ny < h):
                        continue
                    c = grid[ny][nx]
                    if c is None:
                        if not seen[ny][nx]:
                            seen[ny][nx] = True
                            stack.append((nx, ny))
                    else:
                        edge.add(c)
            if big or n < 4:
                continue
            comps.append((x0, y0, x1, y1, n, edge))

    # keep small enclosed regions (bubbles): roughly 2-8mm square, filled mostly
    cand = []
    for x0, y0, x1, y1, n, edge in comps:
        ww = (x1 - x0 + 1) * MM
        hh = (y1 - y0 + 1) * MM
        if 1.5 <= ww <= 9 and 1.5 <= hh <= 9:
            cand.append((round(x0*MM,2), round(y0*MM,2), round(ww,2), round(hh,2), sorted(edge)))
    print(f'\n=== {label}: {len(cand)} enclosed small regions (candidate bubbles) ===')
    from collections import Counter
    sizes = Counter((c[2], c[3]) for c in cand)
    print('  size histogram (w x h mm):')
    for k, v in sizes.most_common(12):
        print(f'    {k[0]:6.2f} x {k[1]:6.2f}   x{v}')
    # column pitch of the most common size
    if sizes:
        common = sizes.most_common(1)[0][0]
        sel = sorted([c for c in cand if (c[2], c[3]) == common], key=lambda c: (c[1], c[0]))
        print(f'  positions of the {common[0]}x{common[1]} bubbles (first 20):')
        for c in sel[:20]:
            print(f'      x={c[0]:7.2f} y={c[1]:7.2f}  {c[2]}x{c[3]}  edge={c[4]}')
        xs = sorted(set(round(c[0],1) for c in sel if abs(c[1]-sel[0][1]) < 1))
        if len(xs) > 1:
            d = [round(xs[i+1]-xs[i],2) for i in range(len(xs)-1)]
            print(f'  same-row x positions: {xs[:14]}')
            print(f'  x pitches: {d[:14]}')
        ys = sorted(set(round(c[1],1) for c in sel if abs(c[0]-sel[0][0]) < 1))
        if len(ys) > 1:
            d = [round(ys[i+1]-ys[i],2) for i in range(len(ys)-1)]
            print(f'  same-col y positions: {ys[:8]}')
            print(f'  y pitches: {d[:8]}')

for label, png in PAGES:
    if os.path.exists(os.path.join(HERE, png)):
        analyse(label, png)
