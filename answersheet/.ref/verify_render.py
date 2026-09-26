"""Verify the generated PDF's actual geometry against the JS-computed geometry.

Renders the PDF to PNG, detects the positioning marks and bubbles, and reports
centre-to-centre deltas in mm.
"""
import os, re, subprocess, sys, io, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pix2

PDF = os.path.join(HERE, 'render_a4.pdf')
BASE = os.path.join(HERE, 'render_a4')
DPI = 150
MM = 25.4 / DPI

# ---- 1. render ----
if not os.path.exists(BASE + '-1.png'):
    subprocess.run(['pdftoppm', '-r', str(DPI), '-png', PDF, BASE], check=False, capture_output=True)

pages = sorted(f for f in os.listdir(HERE) if re.match(r'^render_a4-\d+\.png$', f))
print(f'rendered pages: {pages}')

def load(name):
    w, h, ch, ct, px = pix2.read_png(os.path.join(HERE, name))
    grid = [[None] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * ch
            grid[y][x] = pix2.classify(px[i], px[i+1], px[i+2])
    return w, h, grid

def components(w, h, grid, pred):
    """2D connected components of pixels satisfying pred."""
    seen = [[False] * w for _ in range(h)]
    out = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or not pred(grid[sy][sx]):
                continue
            stack = [(sx, sy)]; seen[sy][sx] = True
            x0 = x1 = sx; y0 = y1 = sy; n = 0
            while stack:
                x, y = stack.pop(); n += 1
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and pred(grid[ny][nx]):
                        seen[ny][nx] = True; stack.append((nx, ny))
            out.append({'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'n': n,
                        'w': (x1-x0+1)*MM, 'h': (y1-y0+1)*MM,
                        'cx': (x0+x1+1)/2*MM, 'cy': (y0+y1+1)/2*MM})
    return out

def show(title, comps, limit=40):
    print(f'\n--- {title}  (n={len(comps)}) ---')
    for c in comps[:limit]:
        print(f"    x={c['x0']*MM:8.2f} y={c['y0']*MM:8.2f}  {c['w']:5.2f}x{c['h']:5.2f}"
              f"  center=({c['cx']:7.2f},{c['cy']:7.2f})  px={c['n']}")

for name in pages:
    w, h, grid = load(name)
    print(f'\n{"="*80}\n{name}: {w}x{h}px = {w*MM:.1f}x{h*MM:.1f}mm\n{"="*80}')

    # 黑色实心块 = 定位块/角标
    black = components(w, h, grid, lambda c: c == 'BLACK')
    # 只保留实心块（面积/包围盒比高）
    solid = [c for c in black if c['n'] > 0.75 * (c['w']/MM) * (c['h']/MM)]
    big = [c for c in solid if c['w'] >= 5.5]
    small = [c for c in solid if 2.0 <= c['w'] < 5.5]
    show('角标（大方块 >=5.5mm）', sorted(big, key=lambda c: (c['y0'], c['x0'])))
    show('小定位块（2.0~5.5mm）', sorted(small, key=lambda c: (c['y0'], c['x0'])), 50)

    # 红色 = 气泡/框线
    red = components(w, h, grid, lambda c: c == 'RED')
    print(f'\n--- 红色连通块 (n={len(red)}) 尺寸分布 ---')
    from collections import Counter
    sizes = Counter((round(c['w'],1), round(c['h'],1)) for c in red)
    for k, v in sizes.most_common(10):
        print(f'    {k[0]:6.1f} x {k[1]:6.1f}   x{v}')
