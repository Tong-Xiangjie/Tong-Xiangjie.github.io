# -*- coding: utf-8 -*-
"""定位文字基线偏差来自哪几条。"""
import io, re, sys, json, zlib
sys.stdout.reconfigure(encoding='utf-8')
pdf = '.ref/out/vector.pdf'
b = io.open(pdf, 'rb').read()
MM = 72 / 25.4
media = [float(x) for x in re.search(rb'/MediaBox\s*\[([^\]]+)\]', b).group(1).split()]
streams = []
for m in re.finditer(rb'stream\r?\n', b):
    s, e = m.end(), b.find(b'endstream', m.end())
    raw = b[s:e].rstrip(b'\r\n')
    try:
        streams.append(zlib.decompress(raw).decode('latin-1'))
    except Exception:
        streams.append(raw.decode('latin-1'))
D = json.load(io.open('.ref/out/vector.measure.json', encoding='utf-8'))
for pi, page in enumerate(D['pages']):
    cand = [i for i, s in enumerate(streams) if len(re.findall(r'Td\b', s)) == len(page['texts'])]
    print('第 %d 面：清单文字 %d，候选流 %s' % (pi + 1, len(page['texts']), cand))
    if not cand:
        continue
    s = streams[cand[0]]
    got = [(float(a) / MM, (media[3] - float(c)) / MM)
           for a, c in re.findall(r'(-?[\d.]+)\s+(-?[\d.]+)\s+Td', s)]
    rows = []
    for t, g in zip(page['texts'], got):
        d = max(abs(t['x'] - g[0]), abs(t['y'] - g[1]))
        rows.append((d, t.get('text', '?'), t['x'], t['y'], g[0], g[1], t.get('vertical', False),
                     str(t.get('cls', ''))[:24]))
    rows.sort(reverse=True)
    print('  偏差最大的 10 条：')
    for d, txt, x, y, gx, gy, vert, cls in rows[:10]:
        print('    d=%7.3f  %-10s 清单(%8.3f %8.3f) PDF(%8.3f %8.3f) vert=%s %s'
              % (d, txt[:10], x, y, gx, gy, vert, cls))
    n = sum(1 for r in rows if r[0] > 0.02)
    print('  超过 0.02mm 的 %d 条；其中 vertical=True 的 %d 条'
          % (n, sum(1 for r in rows if r[0] > 0.02 and r[6])))
