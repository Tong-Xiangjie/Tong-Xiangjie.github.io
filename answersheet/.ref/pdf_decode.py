"""手工解 PDF：把内容流的文本 + 位置算出来，用 ToUnicode CMap 还原中文。
不依赖任何第三方库。"""
import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')

P = r'C:\Users\57891\.dsh\attachments\v1\files\e9\e963589d5c753654c772f2745dc95a2bba940d6494de445b0ade08691a3e9990\数学答题卡A4（6）.pdf'
raw = open(P, 'rb').read()

# ── 收集所有间接对象 ────────────────────────────────────────────────
objs = {}
for m in re.finditer(rb'(\d+)\s+(\d+)\s+obj\b', raw):
    num = int(m.group(1))
    start = m.end()
    e = raw.find(b'endobj', start)
    objs[num] = raw[start:e if e >= 0 else len(raw)]
print('对象数:', len(objs))

def get_stream(body):
    m = re.search(rb'stream\r?\n', body)
    if not m:
        return None
    s = m.end()
    e = body.find(b'endstream', s)
    blob = body[s:e]
    try:
        return zlib.decompress(blob)
    except Exception:
        try:
            return zlib.decompress(blob.rstrip(b'\r\n'))
        except Exception:
            return blob

# ── 展开 ObjStm（对象流）────────────────────────────────────────────
extra = {}
for num, body in list(objs.items()):
    if b'/ObjStm' not in body:
        continue
    d = get_stream(body)
    if not d:
        continue
    mn = re.search(rb'/N\s+(\d+)', body)
    mf = re.search(rb'/First\s+(\d+)', body)
    if not (mn and mf):
        continue
    n, first = int(mn.group(1)), int(mf.group(1))
    header = d[:first].split()
    pairs = [(int(header[i]), int(header[i + 1])) for i in range(0, 2 * n, 2)]
    for k, (onum, off) in enumerate(pairs):
        end = pairs[k + 1][1] + first if k + 1 < len(pairs) else len(d)
        extra[onum] = d[first + off:end]
objs.update(extra)
print('展开后对象数:', len(objs))

# ── 解析 ToUnicode CMap ────────────────────────────────────────────
def parse_cmap(d):
    cmap = {}
    for m in re.finditer(rb'beginbfchar(.*?)endbfchar', d, re.S):
        for a, b in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', m.group(1)):
            src = int(a, 16)
            dst = bytes.fromhex(b.decode()).decode('utf-16-be', 'replace')
            cmap[src] = dst
    for m in re.finditer(rb'beginbfrange(.*?)endbfrange', d, re.S):
        for a, b, c in re.findall(
                rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', m.group(1)):
            lo, hi, base = int(a, 16), int(b, 16), int(c, 16)
            for i in range(hi - lo + 1):
                cmap[lo + i] = chr(base + i)
    return cmap

cmaps = {}
for num, body in objs.items():
    if b'/ToUnicode' in body:
        pass
for num, body in objs.items():
    if b'beginbfchar' in body or b'beginbfrange' in body:
        d = get_stream(body) if b'stream' in body else body
        if d:
            cmaps[num] = parse_cmap(d)
print('CMap 数:', len(cmaps))
for k, v in list(cmaps.items())[:2]:
    print('  cmap', k, '条目', len(v), list(v.items())[:6])

# ── 找出每个字体的 ToUnicode 引用 ──────────────────────────────────
def find_ref(body, key):
    m = re.search(key + rb'\s+(\d+)\s+\d+\s+R', body)
    return int(m.group(1)) if m else None

# 页对象
pages = []
for num, body in objs.items():
    if re.search(rb'/Type\s*/Page[^s]', body):
        pages.append(num)
print('页对象:', pages)

# 解析资源里的字体表： /F1 12 0 R
def page_fonts(body):
    fonts = {}
    for m in re.finditer(rb'/(F\d+)\s+(\d+)\s+\d+\s+R', body):
        fonts[m.group(1).decode()] = int(m.group(2))
    # 也可能是 /Font << ... >> 里嵌的
    m = re.search(rb'/Font\s*<<(.*?)>>', body, re.S)
    if m:
        for a, b in re.findall(rb'/([A-Za-z0-9]+)\s+(\d+)\s+\d+\s+R', m.group(1)):
            fonts[a.decode()] = int(b)
    return fonts

def font_tounicode(fnum):
    body = objs.get(fnum, b'')
    m = re.search(rb'/ToUnicode\s+(\d+)\s+\d+\s+R', body)
    if m:
        return cmaps.get(int(m.group(1)))
    # Type0 → DescendantFonts
    m = re.search(rb'/DescendantFonts\s*\[\s*(\d+)\s+\d+\s+R', body)
    return None

out_lines = []
for pnum in pages:
    body = objs[pnum]
    fonts = page_fonts(body)
    print('\n=== 页对象 %d 的字体: %s ===' % (pnum, fonts))
    # 内容流
    cm = re.search(rb'/Contents\s+(\d+)\s+\d+\s+R', body)
    if not cm:
        continue
    cnum = int(cm.group(1))
    d = get_stream(objs.get(cnum, b''))
    if not d:
        continue
    print('内容流字节:', len(d))
    # 逐行解析 BT..ET 块里的 Tf / Td / TD / Tm / Tj / TJ
    cur_font = None
    for blk in re.finditer(rb'BT(.*?)ET', d, re.S):
        seg = blk.group(1)
        f = re.search(rb'/([A-Za-z0-9]+)\s+[\d.]+\s+Tf', seg)
        if f:
            cur_font = f.group(1).decode()
        cmap = font_tounicode(fonts.get(cur_font, -1)) or {}
        txt = []
        for t in re.finditer(rb'\((?:[^()\\]|\\.)*\)', seg):
            s = t.group(0)[1:-1]
            s = re.sub(rb'\\([()\\])', rb'\1', s)
            if cmap:
                txt.append(''.join(cmap.get(c, chr(c) if c < 128 else '?') for c in s))
            else:
                txt.append(s.decode('latin-1'))
        joined = ''.join(txt)
        if joined.strip():
            out_lines.append((pnum, cur_font, joined))

print('\n\n════════ 文本 ════════')
for pnum, f, t in out_lines:
    print('[p%d %s] %s' % (pnum, f, t))
