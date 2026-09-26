"""解参考 PDF 的可见文字（含中文），按阅读顺序输出。纯手工，无第三方库。"""
import re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')

P = (r'C:\Users\57891\.dsh\attachments\v1\files\e9'
     r'\e963589d5c753654c772f2745dc95a2bba940d6494de445b0ade08691a3e9990'
     r'\数学答题卡A4（6）.pdf')
raw = open(P, 'rb').read()

# ── 只取顶层对象：用 xref 更稳，这里用「行首数字 数字 obj」 ──────────
objs = {}
for m in re.finditer(rb'(?:^|[\r\n])(\d+)\s+(\d+)\s+obj\b', raw):
    num = int(m.group(1))
    start = m.end()
    e = raw.find(b'endobj', start)
    if e < 0:
        continue
    objs[num] = raw[start:e]
print('顶层对象数:', len(objs))

def stream_of(body):
    m = re.search(rb'stream\r?\n', body)
    if not m:
        return None
    s = m.end()
    e = body.rfind(b'endstream')
    blob = body[s:e]
    for c in (blob, blob.rstrip(b'\r\n'), blob.lstrip(b'\r\n')):
        try:
            return zlib.decompress(c)
        except Exception:
            pass
    return blob

# ── 展开对象流 ──────────────────────────────────────────────────────
extra = {}
for num, body in objs.items():
    if b'/ObjStm' not in body:
        continue
    d = stream_of(body)
    if not d:
        continue
    mn = re.search(rb'/N\s+(\d+)', body)
    mf = re.search(rb'/First\s+(\d+)', body)
    if not (mn and mf):
        continue
    n, first = int(mn.group(1)), int(mf.group(1))
    hdr = d[:first].split()
    pairs = [(int(hdr[i]), int(hdr[i + 1])) for i in range(0, 2 * n, 2)]
    for k, (onum, off) in enumerate(pairs):
        end = (pairs[k + 1][1] + first) if k + 1 < len(pairs) else len(d)
        extra[onum] = d[first + off:end]
objs.update(extra)
print('展开后:', len(objs))

# ── 所有 CMap（code → unicode）合成一张大表 ────────────────────────
def parse_cmap(d):
    cm = {}
    for blk in re.finditer(rb'beginbfchar(.*?)endbfchar', d, re.S):
        for a, b in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk.group(1)):
            try:
                cm[int(a, 16)] = bytes.fromhex(b.decode()).decode('utf-16-be')
            except Exception:
                pass
    for blk in re.finditer(rb'beginbfrange(.*?)endbfrange', d, re.S):
        for a, b, c in re.findall(
                rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk.group(1)):
            lo, hi, base = int(a, 16), int(b, 16), int(c, 16)
            for i in range(hi - lo + 1):
                try:
                    cm[lo + i] = chr(base + i)
                except Exception:
                    pass
    return cm

BIG = {}
ncm = 0
for num, body in objs.items():
    d = stream_of(body) if b'stream' in body else body
    if d and (b'beginbfchar' in d or b'beginbfrange' in d):
        BIG.update(parse_cmap(d)); ncm += 1
print('CMap 数:', ncm, ' 映射条目:', len(BIG))

def dec(s):
    """按 2 字节解码 CID；能用 BIG 就用，否则按 ASCII 兜。"""
    out = []
    for i in range(0, len(s) - 1, 2):
        c = (s[i] << 8) | s[i + 1]
        if c in BIG:
            out.append(BIG[c])
        elif c < 128:
            out.append(chr(c))
        else:
            out.append('')
    return ''.join(out)

# ── 页面 ────────────────────────────────────────────────────────────
pages = sorted(n for n, b in objs.items() if re.search(rb'/Type\s*/Page[^s]', b))
print('页:', pages)

def content_of(pbody):
    m = re.search(rb'/Contents\s+(\d+)\s+\d+\s+R', pbody)
    if m:
        return stream_of(objs.get(int(m.group(1)), b''))
    m = re.search(rb'/Contents\s*\[(.*?)\]', pbody, re.S)
    if m:
        parts = []
        for r in re.findall(rb'(\d+)\s+\d+\s+R', m.group(1)):
            parts.append(stream_of(objs.get(int(r), b'')) or b'')
        return b'\n'.join(parts)
    return None

for pno, pnum in enumerate(pages, 1):
    d = content_of(objs[pnum])
    print('\n\n════════════ 第 %d 页 ════════════' % pno)
    if not d:
        print('(无内容流)'); continue
    y = x = 0.0
    for blk in re.finditer(rb'BT(.*?)ET', d, re.S):
        seg = blk.group(1)
        # 位置：最后的 Tm 或 Td
        pos = None
        for pm in re.finditer(rb'([-\d.]+)\s+([-\d.]+)\s+(?:Td|TD)', seg):
            pos = (float(pm.group(1)), float(pm.group(2)))
        for pm in re.finditer(rb'([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm', seg):
            pos = (float(pm.group(5)), float(pm.group(6)))
        if pos:
            x, y = pos
        txt = []
        for t in re.finditer(rb'\((?:[^()\\]|\\.)*\)', seg):
            s = t.group(0)[1:-1]
            s = re.sub(rb'\\([()\\])', rb'\1', s)
            txt.append(dec(s))
        j = ''.join(txt)
        if j.strip():
            print('  y=%8.2f x=%7.2f  %s' % (y, x, j))
