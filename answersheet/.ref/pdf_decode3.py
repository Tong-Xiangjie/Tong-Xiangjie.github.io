"""参考 PDF 的文字 + 坐标（PDF pt，原点左下；另给 mm 且 y 从上算）。"""
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

def parse_cmap(d):
    cm = {}
    for blk in re.finditer(rb'beginbfchar(.*?)endbfchar', d, re.S):
        for a, b in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk.group(1)):
            try:
                cm[int(a, 16)] = bytes.fromhex(b.decode()).decode('utf-16-be')
            except Exception:
                pass
    for blk in re.finditer(rb'beginbfrange(.*?)endbfrange', d, re.S):
        for a, b, c in re.findall(
                rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk.group(1)):
            lo, hi, base = int(a, 16), int(b, 16), int(c, 16)
            for i in range(hi - lo + 1):
                cm[lo + i] = chr(base + i)
    return cm

BIG = {}
for num, body in list(objs.items()):
    d = stream_of(body) if b'stream' in body else body
    if d and (b'beginbfchar' in d or b'beginbfrange' in d):
        BIG.update(parse_cmap(d))

PT = 72.0 / 25.4          # pt per mm
PAGE_H = 841.92

def dec_hex(h):
    s = bytes.fromhex(h.decode() if isinstance(h, bytes) else h)
    out = []
    for i in range(0, len(s) - 1, 2):
        c = (s[i] << 8) | s[i + 1]
        out.append(BIG.get(c, chr(c) if c < 128 else ''))
    return ''.join(out)

pages = sorted(n for n, b in objs.items() if re.search(rb'/Type\s*/Page[^s]', b))

for pno, pnum in enumerate(pages, 1):
    body = objs[pnum]
    cm = re.search(rb'/Contents\s+(\d+)\s+\d+\s+R', body)
    d = stream_of(objs[int(cm.group(1))])
    print('\n\n════════════ 第 %d 页 ════════════' % pno)
    rows = []
    for blk in re.finditer(rb'BT(.*?)ET', d, re.S):
        seg = blk.group(1)
        x = y = 0.0
        for pm in re.finditer(
                rb'([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm', seg):
            x, y = float(pm.group(5)), float(pm.group(6))
        for pm in re.finditer(rb'([-\d.]+)\s+([-\d.]+)\s+T[dD]', seg):
            x, y = float(pm.group(1)), float(pm.group(2))
        parts = []
        for arr in re.finditer(rb'\[(.*?)\]\s*TJ', seg, re.S):
            for h in re.findall(rb'<([0-9A-Fa-f]+)>', arr.group(1)):
                parts.append(dec_hex(h))
        for h in re.findall(rb'<([0-9A-Fa-f]+)>\s*Tj', seg):
            parts.append(dec_hex(h))
        for t in re.finditer(rb'\((?:[^()\\]|\\.)*\)\s*Tj', seg):
            parts.append(t.group(0)[:-2].strip(b'()').decode('latin-1'))
        j = ''.join(parts)
        if j.strip():
            rows.append((round(y, 2), round(x, 2), j))
    rows.sort(key=lambda r: (-r[0], r[1]))
    for y, x, j in rows:
        print('  y=%7.2fpt (%6.2fmm)  x=%7.2fpt (%6.2fmm)  %s'
              % (y, (PAGE_H - y) / PT, x, x / PT, j))
