"""参考 PDF 的干净几何表：所有矩形按 y 排序、合并重复、换算 mm。"""
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
WHICH = int(sys.argv[1]) if len(sys.argv) > 1 else 1
body = objs[pages[WHICH - 1]]
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

def key(r):
    return (round(r['x0'], 2), round(r['x1'], 2), round(r['y0'], 2), round(r['y1'], 2),
            r['op'], r['s'], r['lw'])

seen = {}
for r in rects:
    k = key(r)
    seen[k] = seen.get(k, 0) + 1

def nn(c):
    return '—' if c is None else ('#%02x%02x%02x' % tuple(min(255, max(0, round(v * 255))) for v in c))

print('第 %d 页 · 去重后矩形 %d 个（原 %d）\n' % (WHICH, len(seen), len(rects)))
print('%9s %9s %9s %9s %-3s %-8s %-6s %4s' %
      ('x0', 'x1', 'y0', 'y1', 'op', 'stroke', 'lw', 'x'))
# 只显示「不是整页大背景」的
for (x0, x1, y0, y1, op, s, lw), n in sorted(seen.items(), key=lambda kv: (kv[0][2], kv[0][0])):
    if (x1 - x0) > 205 and (y1 - y0) > 290:
        continue
    if (x1 - x0) < 0.6 and (y1 - y0) < 0.6:
        continue
    print('%9.2f %9.2f %9.2f %9.2f %-3s %-8s %-6.2f %4d' %
          (x0, x1, y0, y1, op, nn(s), lw, n))
