import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')

p = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/fonttest.pdf'
b = io.open(p, 'rb').read()

print('=== 字体 ===')
for m in re.finditer(rb'/BaseFont\s*/([^\s/>]+)', b):
    print('  BaseFont', m.group(1).decode('latin-1'))
for m in re.finditer(rb'/Subtype\s*/(TrueType|Type0|Type1|CIDFontType\w*)', b):
    print('  Subtype', m.group(1).decode('latin-1'))
print('  FontFile2 出现', len(re.findall(rb'/FontFile2', b)), '次')
print('  ToUnicode 出现', len(re.findall(rb'/ToUnicode', b)), '次')

print('\n=== 文本内容（解 ToUnicode CMap 反查）===')
# 收集所有 ToUnicode CMap
cmaps = []
for m in re.finditer(rb'stream\r?\n(.*?)endstream', b, re.S):
    raw = m.group(1)
    if b'beginbfchar' in raw or b'beginbfrange' in raw:
        try:
            cmaps.append(zlib.decompress(raw).decode('latin-1'))
        except Exception:
            cmaps.append(raw.decode('latin-1'))
print('  ToUnicode CMap 数 =', len(cmaps))

mapping = {}
for cm in cmaps:
    for blk in re.findall(r'beginbfchar(.*?)endbfchar', cm, re.S):
        for src, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            mapping[int(src, 16)] = ''.join(
                chr(int(dst[i:i+4], 16)) for i in range(0, len(dst), 4))
    for blk in re.findall(r'beginbfrange(.*?)endbfrange', cm, re.S):
        for lo, hi, dst in re.findall(
                r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            a, z, d0 = int(lo, 16), int(hi, 16), int(dst, 16)
            for k in range(a, z + 1):
                mapping[k] = chr(d0 + (k - a))
print('  可映射码位数 =', len(mapping))

# 解内容流里的 Tj / TJ
out = []
for m in re.finditer(rb'stream\r?\n(.*?)endstream', b, re.S):
    raw = m.group(1)
    try:
        txt = zlib.decompress(raw).decode('latin-1')
    except Exception:
        txt = raw.decode('latin-1')
    if 'BT' not in txt and 'Tj' not in txt and 'TJ' not in txt:
        continue
    out.append(txt)

def decode_hex(h):
    h = h.strip()
    if len(h) % 4:
        h = h + '0' * (4 - len(h) % 4)
    s = ''
    for i in range(0, len(h), 4):
        code = int(h[i:i+4], 16)
        s += mapping.get(code, '\ufffd')
    return s

shown = 0
for txt in out:
    for m in re.finditer(r'<([0-9A-Fa-f]+)>\s*Tj', txt):
        print('  Tj :', decode_hex(m.group(1)))
        shown += 1
    for m in re.finditer(r'\[(.*?)\]\s*TJ', txt, re.S):
        parts = re.findall(r'<([0-9A-Fa-f]+)>', m.group(1))
        print('  TJ :', ''.join(decode_hex(x) for x in parts))
        shown += 1
if not shown:
    print('  （没找到 Tj/TJ，内容流片段：）')
    for txt in out:
        print(txt[:400])
