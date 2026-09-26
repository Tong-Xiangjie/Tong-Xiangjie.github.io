"""列出参考 PDF 里所有「非黑非灰」的颜色及其矩形，找红框 / 定位点。"""
import re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')
P = (r'C:\Users\57891\.dsh\attachments\v1\files\e9'
     r'\e963589d5c753654c772f2745dc95a2bba940d6494de445b0ade08691a3e9990'
     r'\数学答题卡A4（6）.pdf')
raw = open(P, 'rb').read()
objs = {}
for m in re.finditer(rb'(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b', raw):
    s = m.end(); e = raw.find(b'endobj', s)
    if e >= 0:
        objs[int(m.group(1))] = raw[s:e]

def stream_of(b):
    m = re.search(rb'stream\r?\n', b)
    if not m:
        return None
    s = m.end(); e = b.rfind(b'endstream')
    blob = b[s:e]
    for c in (blob, blob.rstrip(b'\r\n'), blob.lstrip(b'\r\n')):
        try:
            return zlib.decompress(c)
        except Exception:
            pass
    return blob

PT = 72.0 / 25.4
PH = 841.92
pages = sorted(n for n, b in objs.items() if re.search(rb'/Type\s*/Page[^s]', b))
body = objs[pages[0]]
d = stream_of(objs[int(re.search(rb'/Contents\s+(\d+)\s+\d+\s+R', body).group(1))])

TOKEN = re.compile(rb'''
    ([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(rg|RG)
  | ([\d.]+)\s+(g|G)
  | ([\d.]+)\s+w\b
  | ([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+re\b
  | \b(f\*|f|S|s|W\*|n|B\*|B)\b
''', re.X)
cur = {'s': None, 'f': None, 'lw': 1.0}
pend = None
rects = []
for m in TOKEN.finditer(d):
    g = m.groups()
    if g[3] is not None:
        v = (float(g[0]), float(g[1]), float(g[2]))
        cur['f' if g[3] == b'rg' else 's'] = v
    elif g[5] is not None:
        v = float(g[4]); cur['f' if g[5] == b'g' else 's'] = (v, v, v)
    elif g[6] is not None:
        cur['lw'] = float(g[6])
    elif g[10] is not None:
        pend = (float(g[7]), float(g[8]), float(g[9]), float(g[10]))
    elif g[11] is not None and pend:
        x, y, w, h = pend
        rects.append({'op': g[11].decode(), 'lw': cur['lw'], 's': cur['s'], 'f': cur['f'],
                      'x0': x / PT, 'x1': (x + w) / PT,
                      'y0': (PH - y - h) / PT, 'y1': (PH - y) / PT})
        pend = None

def isgray(c):
    if c is None:
        return True
    # 黑/白/灰：三通道相等
    return abs(c[0] - c[1]) < 0.02 and abs(c[1] - c[2]) < 0.02

def hx(c):
    return '—' if c is None else '#%02x%02x%02x' % tuple(min(255, max(0, round(v * 255))) for v in c)

print('=== 非灰颜色（描边或填充）===')
seen = set()
for r in rects:
    for which in ('s', 'f'):
        c = r[which]
        if not isgray(c):
            k = (hx(c), which, round(r['x0'], 2), round(r['x1'], 2),
                 round(r['y0'], 2), round(r['y1'], 2))
            if k in seen:
                continue
            seen.add(k)
            print('  %-8s %-2s x %7.2f..%7.2f  y %7.2f..%7.2f  w=%6.2f h=%6.2f lw=%g'
                  % (hx(c), which, r['x0'], r['x1'], r['y0'], r['y1'],
                     r['x1'] - r['x0'], r['y1'] - r['y0'], r['lw']))
print('共 %d 条' % len(seen))

print('\n=== 全页最大的描边矩形（可能是红框）===')
stroked = [r for r in rects if r['op'] in ('S', 's', 'B', 'B*') and r['s'] is not None]
seen2 = set()
for r in sorted(stroked, key=lambda r: -((r['x1'] - r['x0']) * (r['y1'] - r['y0']))):
    k = (round(r['x0'], 2), round(r['x1'], 2), round(r['y0'], 2), round(r['y1'], 2), hx(r['s']))
    if k in seen2:
        continue
    seen2.add(k)
    if (r['x1'] - r['x0']) * (r['y1'] - r['y0']) < 2000:
        break
    print('  %-8s x %7.2f..%7.2f  y %7.2f..%7.2f  w=%6.2f h=%6.2f lw=%g'
          % (hx(r['s']), r['x0'], r['x1'], r['y0'], r['y1'],
             r['x1'] - r['x0'], r['y1'] - r['y0'], r['lw']))
