# -*- coding: utf-8 -*-
"""看第 2 面内容流里竖排那条 Tj 到底写了什么、在哪。"""
import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')
MM = 72 / 25.4

b = io.open('.ref/out/vector.pdf', 'rb').read()
streams = []
for m in re.finditer(rb'stream\r?\n', b):
    s, e = m.end(), b.find(b'endstream', m.end())
    raw = b[s:e].rstrip(b'\r\n')
    try:
        streams.append(zlib.decompress(raw).decode('latin-1'))
    except Exception:
        streams.append(raw.decode('latin-1'))

# 只挑「有 Td 的」流
cand = [i for i, s in enumerate(streams) if 'Td' in s]
print('含 Td 的流：%s' % cand)
si = cand[-1]
t = streams[si]
print('（最后一页流 %d，长度 %d）\n' % (si, len(t)))

# 逐条 Tj：打出 Tf 字号、Td 坐标、Tj 的十六进制长度
TOK = re.compile(r'/(F\d+)\s+([\d.]+)\s+Tf'
                 r'|(-?[\d.]+)\s+(-?[\d.]+)\s+Td'
                 r'|<([0-9A-Fa-f]*)>\s*Tj'
                 r'|(-?[\d.]+)\s+Tc')
cur_f, cur_s, x, y, tc = None, None, None, None, None
for m in TOK.finditer(t):
    if m.group(1):
        cur_f, cur_s = m.group(1), m.group(2)
    elif m.group(3):
        x, y = float(m.group(3)), float(m.group(4))
    elif m.group(6) is not None:
        tc = float(m.group(6))
    elif m.group(5) is not None:
        hexs = m.group(5)
        n = len(hexs) // 4
        page = 841.8898
        print('  字体 %s %spt  Td=(%.3f, %.3f) → x=%.3fmm 距顶=%.3fmm  Tc=%s  %d 个字'
              % (cur_f, cur_s, x, y, x / MM, (page - y) / MM, tc, n))
