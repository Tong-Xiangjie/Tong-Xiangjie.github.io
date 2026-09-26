# -*- coding: utf-8 -*-
"""把第 2 面的内容流原样打印（含换行），看那条 11 字的 Tj 是怎么排的。"""
import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')
b = io.open('.ref/out/vector.pdf', 'rb').read()
streams = []
for m in re.finditer(rb'stream\r?\n', b):
    s, e = m.end(), b.find(b'endstream', m.end())
    raw = b[s:e].rstrip(b'\r\n')
    try:
        streams.append(zlib.decompress(raw).decode('latin-1'))
    except Exception:
        streams.append(raw.decode('latin-1'))
t = streams[-1]
print('--- 最后一面内容流（repr，避免控制字符吃掉输出）---')
for i, line in enumerate(t.split('\n')):
    print('%3d| %s' % (i, repr(line)))
