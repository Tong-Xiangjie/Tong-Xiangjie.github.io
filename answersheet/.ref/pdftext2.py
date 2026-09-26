import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')

p = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/fonttest.pdf'
b = io.open(p, 'rb').read()

# 定位 ToUnicode 那个 stream 对象
m = re.search(rb'/ToUnicode\s+(\d+)\s+(\d+)\s+R', b)
print('ToUnicode ref =', m.groups() if m else None)
cmaps = []
if m:
    objnum = int(m.group(1))
    om = re.search(rb'\n' + str(objnum).encode() + rb'\s+0\s+obj(.*?)endobj', b, re.S)
    print('obj found =', bool(om))
    if om:
        body = om.group(1)
        sm = re.search(rb'stream\r?\n(.*?)\r?\nendstream', body, re.S)
        raw = sm.group(1) if sm else b''
        print('cmap raw bytes =', len(raw), 'filter =',
              re.search(rb'/Filter\s*/(\w+)', body).group(1).decode() if b'/Filter' in body else 'none')
        try:
            cmaps.append(zlib.decompress(raw).decode('latin-1'))
        except Exception as e:
            print('  zlib fail:', e)
            cmaps.append(raw.decode('latin-1'))

mapping = {}
for cm in cmaps:
    for blk in re.findall(r'beginbfchar(.*?)endbfchar', cm, re.S):
        for src, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            mapping[int(src, 16)] = ''.join(chr(int(dst[i:i+4], 16)) for i in range(0, len(dst), 4))
    for blk in re.findall(r'beginbfrange(.*?)endbfrange', cm, re.S):
        for lo, hi, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            a, z, d0 = int(lo, 16), int(hi, 16), int(dst, 16)
            for k in range(a, z + 1):
                mapping[k] = chr(d0 + (k - a))
print('映射码位数 =', len(mapping))
if mapping:
    print('CMap 头 300 字：'); print(cmaps[0][:300])

out = []
for mm in re.finditer(rb'stream\r?\n(.*?)endstream', b, re.S):
    raw = mm.group(1)
    try:
        txt = zlib.decompress(raw).decode('latin-1')
    except Exception:
        txt = raw.decode('latin-1')
    if 'Tj' in txt or 'TJ' in txt:
        out.append(txt)

def dec(h):
    if len(h) % 4: h += '0' * (4 - len(h) % 4)
    return ''.join(mapping.get(int(h[i:i+4], 16), '\ufffd') for i in range(0, len(h), 4))

print('\n=== PDF 里的文字 ===')
for txt in out:
    for mm in re.finditer(r'<([0-9A-Fa-f]+)>\s*Tj', txt):
        print(' ', dec(mm.group(1)))
