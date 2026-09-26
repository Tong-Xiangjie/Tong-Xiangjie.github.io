import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')

P = r'C:\Users\57891\.dsh\attachments\v1\files\e9\e963589d5c753654c772f2745dc95a2bba940d6494de445b0ade08691a3e9990\数学答题卡A4（6）.pdf'
raw = open(P, 'rb').read()
print('size', len(raw))
print('header', raw[:16])
print('/Font', raw.count(b'/Font'), ' /Image', raw.count(b'/Image'),
      ' /Page', len(re.findall(rb'/Type\s*/Page[^s]', raw)),
      ' ObjStm', raw.count(b'/ObjStm'), ' XRef', raw.count(b'/XRef'))

# 全部流解压，找文本算子
streams = []
for m in re.finditer(rb'stream\r?\n', raw):
    start = m.end()
    end = raw.find(b'endstream', start)
    if end < 0:
        continue
    blob = raw[start:end]
    for cand in (blob, blob.rstrip(b'\r\n')):
        try:
            streams.append(zlib.decompress(cand)); break
        except Exception:
            pass
print('解压出 stream 数:', len(streams))

def texts(d):
    out = []
    for m in re.finditer(rb'\((?:[^()\\]|\\.)*\)', d):
        out.append(m.group(0))
    return out

allT = []
for d in streams:
    if b'Tj' in d or b'TJ' in d:
        allT.append(d)

print('含文本算子的 stream 数:', len(allT))
seen = set()
for d in allT:
    for t in texts(d):
        s = t[1:-1]
        try:
            s = s.decode('utf-16-be') if s.startswith(b'\xfe\xff') else s.decode('latin-1')
        except Exception:
            continue
        s = s.replace('\\', '')
        s = re.sub(r'\s+', '', s)
        if s and s not in seen:
            seen.add(s)
print('文本片段数:', len(seen))
for s in list(seen)[:80]:
    print(repr(s))

# 找 ToUnicode CMap
cmaps = [d for d in streams if b'beginbfchar' in d or b'beginbfrange' in d]
print('\nCMap 数:', len(cmaps))
