"""Reliable bubble detection.

A bubble is a closed coloured outline with exactly one large hole.
Text glyphs either have no hole or many small ones.
"""
import os, sys
from collections import Counter, defaultdict
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

def cc(w, h, pred):
    seen = [[False]*w for _ in range(h)]
    out = []
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or not pred(sx, sy):
                continue
            st=[(sx,sy)]; seen[sy][sx]=True
            x0=x1=sx; y0=y1=sy; n=0
            while st:
                x,y=st.pop(); n+=1
                x0=min(x0,x); x1=max(x1,x); y0=min(y0,y); y1=max(y1,y)
                for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx,ny=x+dx,y+dy
                    if 0<=nx<w and 0<=ny<h and not seen[ny][nx] and pred(nx,ny):
                        seen[ny][nx]=True; st.append((nx,ny))
            out.append((x0,y0,x1,y1,n))
    return out

def analyse(label, png):
    if not os.path.exists(os.path.join(HERE, png)):
        print(f'{label}: missing'); return
    w, h, g = load(png)
    ink = lambda x, y: g[y][x] is not None
    white = lambda x, y: g[y][x] is None

    shapes = cc(w, h, ink)
    bubbles = []
    for (x0,y0,x1,y1,n) in shapes:
        ww=(x1-x0+1)*MM; hh=(y1-y0+1)*MM
        if not (2.5 <= ww <= 8 and 1.5 <= hh <= 8):
            continue
        # find holes inside this bbox: white components not touching the bbox border
        sub = {}
        holes = 0; hole_area = 0
        seen = set()
        for yy in range(y0, y1+1):
            for xx in range(x0, x1+1):
                if (xx,yy) in seen or not white(xx,yy):
                    continue
                st=[(xx,yy)]; seen.add((xx,yy)); comp=[]; touch=False
                while st:
                    a,b=st.pop(); comp.append((a,b))
                    if a in (x0,x1) or b in (y0,y1):
                        touch=True
                    for da,db in ((1,0),(-1,0),(0,1),(0,-1)):
                        na,nb=a+da,b+db
                        if x0<=na<=x1 and y0<=nb<=y1 and (na,nb) not in seen and white(na,nb):
                            seen.add((na,nb)); st.append((na,nb))
                if not touch and len(comp) > 0:
                    holes += 1; hole_area += len(comp)
        if holes == 1:
            box = (x1-x0+1)*(y1-y0+1)
            fill = hole_area / box
            bubbles.append((round(x0*MM,2), round(y0*MM,2), round(ww,2), round(hh,2), round(fill,3)))

    print(f'\n{"="*74}\n{label} ({png}) — 单孔闭合框: {len(bubbles)}\n{"="*74}')
    if not bubbles: return
    cnt = Counter((b[2],b[3]) for b in bubbles)
    print('  尺寸直方图:')
    for k,v in cnt.most_common(8):
        print(f'     {k[0]:6.2f} x {k[1]:6.2f}  x{v}')
    dom = cnt.most_common(1)[0][0]
    sel = sorted([b for b in bubbles if (b[2],b[3])==dom], key=lambda b:(b[1],b[0]))
    print(f'\n  主尺寸 {dom[0]}x{dom[1]}mm  n={len(sel)}')
    # rows
    rows=defaultdict(list)
    for b in sel:
        for k in list(rows):
            if abs(k-b[1])<1.2: rows[k].append(b); break
        else: rows[b[1]].append(b)
    ks=sorted(rows)
    print(f'  行 y: {[round(k,2) for k in ks]}')
    if len(ks)>1:
        print(f'  行距: {[round(ks[i+1]-ks[i],2) for i in range(len(ks)-1)]}')
    d=max(rows.values(), key=len)
    xs=sorted(round(b[0],2) for b in d)
    print(f'  最密行 n={len(xs)}  x: {xs[:14]}')
    if len(xs)>1:
        print(f'  列距: {[round(xs[i+1]-xs[i],2) for i in range(len(xs)-1)][:14]}')

for lab, png in [('A4 math p1','a1-1.png'), ('A3 math p1','m1-1.png'), ('A3 physics p1','p1-1.png')]:
    analyse(lab, png)
