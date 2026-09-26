# -*- coding: utf-8 -*-
"""按元素类型分类比较矩形，定位「气泡整体下移 2.047mm」出在哪一类。"""
import io, re, sys, json, zlib
sys.stdout.reconfigure(encoding='utf-8')

pdf = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/vector.pdf'
b = io.open(pdf, 'rb').read()
mb = re.search(rb'/MediaBox\s*\[([^\]]+)\]', b)
PH, MM = float(mb.group(1).split()[3]), 72.0 / 25.4
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
got = [(float(a) / MM, (PH - float(c)) / MM, abs(float(b2)) / MM, abs(float(d)) / MM)
       for a, c, b2, d in (m.groups() for m in RE_RE.finditer(streams[0]))]

M = json.load(io.open(pdf.replace('.pdf', '.measure.json'), encoding='utf-8'))
P = M['pages'][0]
want = []
for o in P['fills']:
    want.append((o['x'], o['y'], o['w'], o['h'], 'fill:' + str(o.get('cls', ''))[:26]))
for o in P['strokes']:
    lw = o['lw'] or 0.3
    want.append((o['x'] + lw / 2, o['y'] + lw / 2, max(0.0, o['w'] - lw),
                 max(0.0, o['h'] - lw), 'stroke:' + str(o.get('cls', ''))[:26]))

used = [False] * len(got)
buckets = {}
for u in want:
    bi, bd = -1, None
    for j, g in enumerate(got):
        if used[j]:
            continue
        d = max(abs(u[i] - g[i]) for i in range(4))
        if bd is None or d < bd:
            bi, bd = j, d
            if d == 0.0:
                break
    if bi >= 0:
        used[bi] = True
    dy = None if bi < 0 else round(got[bi][1] - u[1], 4)
    dx = None if bi < 0 else round(got[bi][0] - u[0], 4)
    k = (u[4], dx, dy)
    buckets[k] = buckets.get(k, 0) + 1

print('%-34s %9s %9s %5s' % ('类型', 'Δx', 'Δy', '条数'))
for (cls, dx, dy), n in sorted(buckets.items(), key=lambda t: -t[1]):
    print('%-34s %9s %9s %5d' % (cls, dx, dy, n))
