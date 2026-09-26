# -*- coding: utf-8 -*-
"""把两条竖排的 Tj 完整解出来，看 11 个字是不是都在、顺序对不对。"""
import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')
b = io.open('.ref/out/vector.pdf', 'rb').read()

def stream_of(num):
    om = re.search(rb'(?<![\d])' + str(num).encode() + rb'\s+0\s+obj(.*?)endobj', b, re.S)
    if not om:
        return None
    sm = re.search(rb'stream\r?\n(.*?)\r?\nendstream', om.group(1), re.S)
    if not sm:
        return None
    raw = sm.group(1)
    try:
        return zlib.decompress(raw).decode('latin-1')
    except Exception:
        return raw.decode('latin-1')

fonts = {}
for nm, num in re.findall(rb'/(F\d+)\s+(\d+)\s+0\s+R', b):
    nm = nm.decode('latin-1')
    om = re.search(rb'(?<![\d])' + num + rb'\s+0\s+obj(.*?)endobj', b, re.S)
    mp = {}
    if om:
        tm = re.search(rb'/ToUnicode\s+(\d+)\s+0\s+R', om.group(1))
        if tm:
            cm = stream_of(int(tm.group(1)))
            if cm:
                for blk in re.findall(r'beginbfchar(.*?)endbfchar', cm, re.S):
                    for src, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
                        mp[int(src, 16)] = ''.join(chr(int(dst[i:i+4], 16))
                                                   for i in range(0, len(dst), 4))
                for blk in re.findall(r'beginbfrange(.*?)endbfrange', cm, re.S):
                    for lo, hi, d0 in re.findall(
                            r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
                        a, z, dd = int(lo, 16), int(hi, 16), int(d0, 16)
                        for k in range(a, z + 1):
                            mp[k] = chr(dd + (k - a))
    fonts[nm] = mp

# 所有 Tj：按 (字号, 内容) 打出来
TOK = re.compile(r'/(F\d+)\s+([\d.]+)\s+Tf'
                 r'|(-?[\d.]+)\s+(-?[\d.]+)\s+Td'
                 r'|<([0-9A-Fa-f\s]*)>\s*Tj')
for si, m in enumerate(re.finditer(rb'stream\r?\n', b)):
    s, e = m.end(), b.find(b'endstream', m.end())
    raw = b[s:e].rstrip(b'\r\n')
    try:
        t = zlib.decompress(raw).decode('latin-1')
    except Exception:
        t = raw.decode('latin-1')
    if 'Tj' not in t:
        continue
    cur = size = None
    for q in TOK.finditer(t):
        if q.group(1):
            cur, size = q.group(1), q.group(2)
        elif q.group(5) is not None:
            hx = re.sub(r'\s', '', q.group(5))
            mp = fonts.get(cur, {})
            txt = ''.join(mp.get(int(hx[i:i+4], 16), '\ufffd')
                          for i in range(0, len(hx), 4))
            if len(txt) > 4:      # 只看竖排那种长串
                print('字号 %-6s  %2d 字：%s' % (size, len(txt), txt))
