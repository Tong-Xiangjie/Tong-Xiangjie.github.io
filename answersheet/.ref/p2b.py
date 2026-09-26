# -*- coding: utf-8 -*-
"""解码第 2 面那条 11 字的 Tj：逐码位查 ToUnicode，看最后两个是不是缺映射。"""
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


# /F15 → 字体对象 → ToUnicode
fonts = {}
for nm, num in re.findall(rb'/(F\d+)\s+(\d+)\s+0\s+R', b):
    nm = nm.decode('latin-1')
    om = re.search(rb'(?<![\d])' + num + rb'\s+0\s+obj(.*?)endobj', b, re.S)
    if not om:
        continue
    tm = re.search(rb'/ToUnicode\s+(\d+)\s+0\s+R', om.group(1))
    mp = {}
    if tm:
        cm = stream_of(int(tm.group(1)))
        if cm:
            for blk in re.findall(r'beginbfchar(.*?)endbfchar', cm, re.S):
                for src, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
                    mp[int(src, 16)] = ''.join(chr(int(dst[i:i + 4], 16))
                                               for i in range(0, len(dst), 4))
            for blk in re.findall(r'beginbfrange(.*?)endbfrange', cm, re.S):
                for lo, hi, d0 in re.findall(
                        r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
                    a, z, dd = int(lo, 16), int(hi, 16), int(d0, 16)
                    for k in range(a, z + 1):
                        mp[k] = chr(dd + (k - a))
    fonts[nm] = mp
    print('%s 映射数 %d' % (nm, len(mp)))

# 抓那条 11 字的 Tj
hexs = None
for m in re.finditer(rb'<([0-9A-Fa-f]*)>\s*Tj', b):
    if len(m.group(1)) // 4 == 11:
        hexs = m.group(1).decode('latin-1')
        break
print('\n11 字的 Tj 十六进制：%s' % hexs)
mp = fonts.get('F15', {})
print('\n逐码位：')
for i in range(0, len(hexs), 4):
    code = int(hexs[i:i + 4], 16)
    ch = mp.get(code, '⟨无映射⟩')
    print('  code=%5d (0x%04X) → %s' % (code, code, ch))

print('\n拼出来：%s' % ''.join(mp.get(int(hexs[i:i + 4], 16), '\ufffd')
                              for i in range(0, len(hexs), 4)))
