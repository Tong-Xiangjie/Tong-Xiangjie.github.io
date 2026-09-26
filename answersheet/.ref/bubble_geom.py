"""Precise bubble geometry: outer box (coloured border) size, column pitch and
option-row pitch, measured from the reference cards."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pix2

DPI = 150
MM = 25.4 / DPI

def load(name):
    w, h, ch, ct, px = pix2.read_png(os.path.join(HERE, name))
    g = [[None] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * ch
            g[y][x] = pix2.classify(px[i], px[i+1], px[i+2])
    return w, h, g

def comps(w, h, g, pred):
    seen = [[False] * w for _ in range(h)]
    out = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or not pred(g[sy][sx]):
                continue
            st = [(sx, sy)]; seen[sy][sx] = True
            x0 = x1 = sx; y0 = y1 = sy; n = 0
            while st:
                x, y = st.pop(); n += 1
                x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y)
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and pred(g[ny][nx]):
                        seen[ny][nx] = True; st.append((nx, ny))
            out.append((x0, y0, x1, y1, n))
    return out

def report(label, png):
    if not os.path.exists(os.path.join(HERE, png)):
        print(f'{label}: missing {png}'); return
    w, h, g = load(png)
    coloured = lambda c: c in ('RED', 'NAVY', 'BLACK', 'OTHER')
    allc = comps(w, h, g, coloured)
    # bubbles: outer box roughly 3-7mm wide, 2-7mm tall, hollow (low fill ratio)
    bub = []
    for x0, y0, x1, y1, n in allc:
        ww = (x1-x0+1)*MM; hh = (y1-y0+1)*MM
        if 3.0 <= ww <= 7.5 and 2.0 <= hh <= 7.5:
            box = (x1-x0+1)*(y1-y0+1)
            if n < 0.75*box:      # hollow
                bub.append((round(x0*MM,2), round(y0*MM,2), round(ww,2), round(hh,2)))
    print(f'\n{"="*76}\n{label}  ({png})\n{"="*76}')
    print(f'  hollow boxes 3-7.5mm: {len(bub)}')
    if not bub: return

    # cluster by width/height
    from collections import Counter, defaultdict
    cnt = Counter((b[2], b[3]) for b in bub)
    print('  size histogram:')
    for k, v in cnt.most_common(8):
        print(f'     {k[0]:6.2f} x {k[1]:6.2f}  x{v}')

    # pick the dominant size, then find its rows
    dom = cnt.most_common(1)[0][0]
    sel = [b for b in bub if (b[2], b[3]) == dom]
    print(f'\n  dominant {dom[0]}x{dom[1]}mm, n={len(sel)}')

    # group into rows by y
    sel.sort(key=lambda b: (b[1], b[0]))
    rows = defaultdict(list)
    for b in sel:
        placed = False
        for key in list(rows.keys()):
            if abs(key - b[1]) < 1.5:
                rows[key].append(b); placed = True; break
        if not placed:
            rows[b[1]].append(b)
    keys = sorted(rows.keys())
    print(f'  detected rows (y of top edge): {[round(k,2) for k in keys]}')
    if len(keys) > 1:
        d = [round(keys[i+1]-keys[i], 2) for i in range(len(keys)-1)]
        print(f'  ROW PITCH (top-edge delta): {d}')

    # column pitch within the densest row
    densest = max(rows.values(), key=len)
    xs = sorted(round(b[0], 2) for b in densest)
    print(f'  densest row n={len(xs)}  x tops: {xs[:12]}')
    if len(xs) > 1:
        d = [round(xs[i+1]-xs[i], 2) for i in range(len(xs)-1)]
        print(f'  COL PITCH (left-edge delta): {d[:12]}')

report('A4 math p1', 'a1-1.png')
report('A3 math p1', 'm1-1.png')
report('A3 physics p1', 'p1-1.png')
