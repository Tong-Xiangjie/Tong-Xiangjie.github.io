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

d = stream_of(objs[4]) or b''
print('obj4 len', len(d))
print('BT 出现次数:', d.count(b'BT'), ' Tj:', d.count(b'Tj'), ' TJ:', d.count(b'TJ'))
i = d.find(b'Tj')
print('--- 第一处 Tj 附近 ---')
print(d[max(0, i - 500):i + 60].decode('latin-1'))
print()
print('--- 前 400 字节 ---')
print(d[:400].decode('latin-1'))
