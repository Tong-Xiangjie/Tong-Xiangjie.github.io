# -*- coding: utf-8 -*-
"""从矢量 PDF 里把文字抠出来（用于核对可选中/可搜索 + 内容正确）。

⚠ 关键点：**ToUnicode 是按字体分的，不能合并。**
  SimHei 和 SimSun 各自从 1 开始编号自己的字形码，同一码位在两张表里
  指向完全不同的字。早先版本把所有 CMap 合并成一个 dict，后读的覆盖先读的，
  于是「第」被解成「线」、「生」被解成「真」—— 那是**工具的锅，不是导出的锅**。
  正确做法：先解出 /F15 /F16 … 各自对应的字体对象 → 再各自取 ToUnicode，
  然后按内容流里的 `Tf` 切换当前映射表。
"""
import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')

p = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/vector.pdf'
b = io.open(p, 'rb').read()


def stream_of(objnum):
    """取某个对象号的内容流（已解压）"""
    om = re.search(rb'(?<![\d])' + str(objnum).encode() + rb'\s+0\s+obj(.*?)endobj', b, re.S)
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


def parse_cmap(txt):
    mp = {}
    for blk in re.findall(r'beginbfchar(.*?)endbfchar', txt, re.S):
        for src, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            mp[int(src, 16)] = ''.join(chr(int(dst[i:i + 4], 16))
                                       for i in range(0, len(dst), 4))
    for blk in re.findall(r'beginbfrange(.*?)endbfrange', txt, re.S):
        for lo, hi, dst in re.findall(
                r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            a, z, d0 = int(lo, 16), int(hi, 16), int(dst, 16)
            for k in range(a, z + 1):
                mp[k] = chr(d0 + (k - a))
    return mp


# ── /F15 → 字体对象 → ToUnicode（每个字体一张表）──────────────────────
by_name = {}
for nm, num in re.findall(rb'/(F\d+)\s+(\d+)\s+0\s+R', b):
    by_name[nm.decode('latin-1')] = int(num)

fonts = {}          # F15 → {base, cmap}
for nm, num in by_name.items():
    om = re.search(rb'(?<![\d])' + str(num).encode() + rb'\s+0\s+obj(.*?)endobj', b, re.S)
    base = ''
    if om:
        bm = re.search(rb'/BaseFont\s*/([^\s/>]+)', om.group(1))
        base = bm.group(1).decode('latin-1') if bm else ''
    # 该字体对象里引用的 ToUnicode
    mp = {}
    if om:
        tm = re.search(rb'/ToUnicode\s+(\d+)\s+0\s+R', om.group(1))
        if tm:
            cm = stream_of(int(tm.group(1)))
            if cm:
                mp = parse_cmap(cm)
    fonts[nm] = {'base': base, 'cmap': mp}
    print('%-5s → %-22s ToUnicode 条目 %d' % (nm, base, len(mp)))

# 同一个字体可能被多个别名引用（每页一份资源字典），全部展开
print('\n码位表大小：%s' % {k: len(v['cmap']) for k, v in fonts.items()})


def dec(hexs, cmap):
    if len(hexs) % 4:
        hexs += '0' * (4 - len(hexs) % 4)
    return ''.join(cmap.get(int(hexs[i:i + 4], 16), '\ufffd')
                   for i in range(0, len(hexs), 4))


print('\n=== PDF 里的文字 ===')
TOK = re.compile(r'/(F\d+)\s+([\d.]+)\s+Tf|<([0-9A-Fa-f]+)>\s*Tj|(-?[\d.]+)\s+(-?[\d.]+)\s+Td')
for mm in re.finditer(rb'stream\r?\n(.*?)endstream', b, re.S):
    raw = mm.group(1)
    try:
        txt = zlib.decompress(raw).decode('latin-1')
    except Exception:
        txt = raw.decode('latin-1')
    if 'Tj' not in txt:
        continue
    cur, x, y = None, None, None
    for m2 in TOK.finditer(txt):
        if m2.group(1):
            cur = fonts.get(m2.group(1), {}).get('cmap', {})
        elif m2.group(3):
            s = dec(m2.group(3), cur or {})
            if s.strip():
                print('  %s' % s)
        elif m2.group(4):
            x, y = float(m2.group(4)), float(m2.group(5))
