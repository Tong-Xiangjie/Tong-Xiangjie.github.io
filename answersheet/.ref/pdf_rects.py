"""抽参考 PDF 的所有矩形（re 操作符）+ 其描边/填充色，换算成 mm（y 从上）。"""
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

def stream_of(body):
    m = re.search(rb'stream\r?\n', body)
    if not m:
        return None
    s = m.end(); e = body.rfind(b'endstream')
    blob = body[s:e]
    for c in (blob, blob.rstrip(b'\r\n'), blob.lstrip(b'\r\n')):
        try:
            return zlib.decompress(c)
        except Exception:
            pass
    return blob

PT = 72.0 / 25.4
PAGE_H = 841.92
pages = sorted(n for n, b in objs.items() if re.search(rb'/Type\s*/Page[^s]', b))
WHICH = int(sys.argv[1]) if len(sys.argv) > 1 else 1
pnum = pages[WHICH - 1]
body = objs[pnum]
cm = re.search(rb'/Contents\s+(\d+)\s+\d+\s+R', body)
d = stream_of(objs[int(cm.group(1))])

# 跟踪颜色与线宽，遇到 re 就记录。用「逐个 token 扫描」避免分组编号出错。
TOKEN = re.compile(rb'''
    ([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(rg|RG)
  | ([\d.]+)\s+(g|G)
  | ([\d.]+)\s+w\b
  | ([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+re\b
  | \b(f\*|f|S|s|W\*|n|B\*|B)\b
''', re.X)

cur = {'stroke': None, 'fill': None, 'lw': 1.0}
rects = []
pending = None
for m in TOKEN.finditer(d):
    g = m.groups()
    if g[3] is not None:                       # rg / RG
        v = (float(g[0]), float(g[1]), float(g[2]))
        if g[3] == b'rg':
            cur['fill'] = v
        else:
            cur['stroke'] = v
    elif g[5] is not None:                     # g / G
        v = float(g[4])
        if g[5] == b'g':
            cur['fill'] = (v, v, v)
        else:
            cur['stroke'] = (v, v, v)
    elif g[6] is not None:                     # w
        cur['lw'] = float(g[6])
    elif g[10] is not None:                    # re
        pending = (float(g[7]), float(g[8]), float(g[9]), float(g[10]))
    elif g[11] is not None:                    # 绘制算子
        if pending:
            x, y, w, h = pending
            rects.append({
                'op': g[11].decode(), 'x': x, 'y': y, 'w': w, 'h': h,
                'stroke': cur['stroke'], 'fill': cur['fill'], 'lw': cur['lw'],
                'x0mm': x / PT, 'x1mm': (x + w) / PT,
                'y0mm': (PAGE_H - y - h) / PT, 'y1mm': (PAGE_H - y) / PT,
            })
            pending = None

print('第 %d 页，矩形数 %d' % (WHICH, len(rects)))
def fmt(c):
    if c is None:
        return '—'
    return '(' + ','.join('%g' % v for v in c) + ')'
print('%5s %-6s %-16s %-16s %8s %8s %8s %8s' %
      ('#', 'op', 'stroke', 'fill', 'x0mm', 'x1mm', 'y0mm', 'y1mm'))
big = [r for r in rects if r['w'] / PT > 20 or r['h'] / PT > 20]
for i, r in enumerate(big):
    print('%5d %-6s %-16s %-16s %8.2f %8.2f %8.2f %8.2f  (lw=%g)' %
          (i, r['op'], fmt(r['stroke']), fmt(r['fill']),
           r['x0mm'], r['x1mm'], r['y0mm'], r['y1mm'], r['lw']))
print('\n(只列宽或高 > 20mm 的 %d 个)' % len(big))
