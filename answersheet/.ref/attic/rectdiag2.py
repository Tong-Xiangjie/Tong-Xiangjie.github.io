# -*- coding: utf-8 -*-
"""诊断：为什么矩形配不上。打印前若干条「清单」与「PDF」的坐标，并给每条
清单条目找最近邻，看差在哪一维。"""
import io, re, sys, json, zlib
sys.stdout.reconfigure(encoding='utf-8')

pdf = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/vector.pdf'
b = io.open(pdf, 'rb').read()
mb = re.search(rb'/MediaBox\s*\[([^\]]+)\]', b)
media = [float(x) for x in mb.group(1).split()]
PH, MM = media[3], 72.0 / 25.4

streams = []
for m in re.finditer(rb'stream\r?\n', b):
    s, e = m.end(), b.find(b'endstream', m.end())
    raw = b[s:e].rstrip(b'\r\n')
    try:
        t = zlib.decompress(raw).decode('latin-1')
    except Exception:
        t = raw.decode('latin-1')
    if ' re' in t:
        streams.append(t)
RE_RE = re.compile(r'(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\b')
got = []
for si, s in enumerate(streams):
    for m in RE_RE.finditer(s):
        x, y, w, h = (float(g) for g in m.groups())
        if si != 0:
            continue
        got.append((x / MM, (PH - y) / MM, abs(w) / MM, abs(h) / MM))

M = json.load(io.open(pdf.replace('.pdf', '.measure.json'), encoding='utf-8'))
fl = M['pages'][0]['fills']
st = M['pages'][0]['strokes']
want = [(o['x'], o['y'], o['w'], o['h']) for o in fl]
for o in st:
    lw = o['lw'] or 0.3
    want.append((o['x'] + lw / 2, o['y'] + lw / 2,
                 max(0.0, o['w'] - lw), max(0.0, o['h'] - lw)))

print('want %d  got %d' % (len(want), len(got)))
print('\n--- want 前 8 ---')
for u in want[:8]:
    print('   %9.4f %9.4f %9.4f %9.4f' % u)
print('\n--- got 前 8 ---')
for g in got[:8]:
    print('   %9.4f %9.4f %9.4f %9.4f' % g)

# 给每条 want 找最近邻，按最近邻距离分类
import collections
hist = collections.Counter()
worst = []
for u in want:
    bd, bg = None, None
    for g in got:
        d = max(abs(u[i] - g[i]) for i in range(4))
        if bd is None or d < bd:
            bd, bg = d, g
    k = '0' if bd == 0 else ('<0.02' if bd < 0.02 else ('<1' if bd < 1 else '>=1'))
    hist[k] += 1
    if bd >= 1:
        worst.append((bd, u, bg))
print('\n最近邻距离分布：', dict(hist))
worst.sort(reverse=True)
print('\n--- 差得最远的 8 条 ---')
for bd, u, g in worst[:8]:
    print('  d=%8.3f  want=(%8.3f %8.3f %8.3f %8.3f)  got=(%8.3f %8.3f %8.3f %8.3f)'
          % ((bd,) + u + g))
