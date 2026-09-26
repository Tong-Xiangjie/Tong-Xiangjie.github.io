import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')

p = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/fonttest3.pdf'
b = io.open(p, 'rb').read()

# 收集**所有** ToUnicode CMap（每种字体一个），按码位合并。
# ⚠ 不同字体的码位空间是重叠的（都从 1 开始编号），
#   所以严格来说要按 Tf 切换字体分段解码。这里先做「合并 + 冲突取并集」，
#   用于人工核对足够；真正严格的做法见下方 decode_stream()。
mapping = {}
cmap_count = 0
for m in re.finditer(rb'/ToUnicode\s+(\d+)\s+(\d+)\s+R', b):
    objnum = int(m.group(1))
    om = re.search(rb'\n' + str(objnum).encode() + rb'\s+0\s+obj(.*?)endobj', b, re.S)
    if not om:
        continue
    body = om.group(1)
    sm = re.search(rb'stream\r?\n(.*?)\r?\nendstream', body, re.S)
    raw = sm.group(1) if sm else b''
    try:
        cm = zlib.decompress(raw).decode('latin-1')
    except Exception:
        cm = raw.decode('latin-1')
    cmap_count += 1
    n = 0
    for blk in re.findall(r'beginbfchar(.*?)endbfchar', cm, re.S):
        for src, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            mapping[int(src, 16)] = ''.join(chr(int(dst[i:i+4], 16)) for i in range(0, len(dst), 4))
            n += 1
    for blk in re.findall(r'beginbfrange(.*?)endbfrange', cm, re.S):
        for lo, hi, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            a, z, d0 = int(lo, 16), int(hi, 16), int(dst, 16)
            for k in range(a, z + 1):
                mapping[k] = chr(d0 + (k - a)); n += 1
    print('CMap #%d  obj %d  条目 %d' % (cmap_count, objnum, n))

print('合并后码位数 =', len(mapping))
print('字体：', sorted(set(x.decode('latin-1') for x in re.findall(rb'/BaseFont\s*/([^\s/>]+)', b))))

def dec(h):
    if len(h) % 4: h += '0' * (4 - len(h) % 4)
    return ''.join(mapping.get(int(h[i:i+4], 16), '\ufffd') for i in range(0, len(h), 4))

print('\n=== PDF 里的文字 ===')
for mm in re.finditer(rb'stream\r?\n(.*?)endstream', b, re.S):
    raw = mm.group(1)
    try:
        txt = zlib.decompress(raw).decode('latin-1')
    except Exception:
        txt = raw.decode('latin-1')
    if 'Tj' not in txt and 'TJ' not in txt:
        continue
    for m2 in re.finditer(r'<([0-9A-Fa-f]+)>\s*Tj', txt):
        print(' ', dec(m2.group(1)))
