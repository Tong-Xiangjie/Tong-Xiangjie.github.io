# -*- coding: utf-8 -*-
"""直接从原始字节里抠 `re` 矩形，不经过 token 扫描器。

为什么单拎出来：token 扫描器一旦漏认某个操作符（比如 `re` 本身），
它的操作数就会残留到下一个操作符上，坐标整体错位几百 mm。
用一个**只认数字 + re** 的正则最不容易出错，也便于对照。

矩形语义（已验证）：
    `x y w h re` 中 h 是负数，PDF 的 y 轴向上，
    所以 距纸顶 = (PH − y)/MM，底边 = (PH − y − h)/MM。
    例如首条 `15.843 816.707 19.185 −11.988 re`
      → 距顶 8.884mm、左 5.589mm、宽 6.768mm、高 4.229mm
      = 左上角定位点，与 measure 的 8.884/5.589/6.768/4.229 完全一致。
"""
import io, re, sys, json, zlib, os
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

pdf = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/vector.pdf'
b = io.open(pdf, 'rb').read()
mb = re.search(rb'/MediaBox\s*\[([^\]]+)\]', b)
media = [float(x) for x in mb.group(1).split()]
PH, MM = media[3], 72.0 / 25.4

streams = []
for m in re.finditer(rb'stream\r?\n', b):
    s, e = m.end(), b.find(b'endstream', m.end())
    raw = b[s:e].rstrip(b'\r\n')
    try:
        t = zlib.decompress(raw).decode('latin-1')
    except Exception:
        t = raw.decode('latin-1')
    if ' re' in t:
        streams.append(t)

RE_RE = re.compile(r'(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+re\b')
rects = []
for si, s in enumerate(streams):
    for m in RE_RE.finditer(s):
        x, y, w, h = (float(g) for g in m.groups())
        top, bot = (PH - y) / MM, (PH - y - h) / MM
        rects.append({'s': si, 'x': x / MM, 'top': top, 'bot': bot,
                      'w': abs(w) / MM, 'h': abs(h) / MM})

print('%s：找到 %d 个 re 矩形（%d 个内容流）' % (pdf, len(rects), len(streams)))
p0 = [r for r in rects if r['s'] == 0]
print('第 1 页 %d 个' % len(p0))

mj = pdf.replace('.pdf', '.measure.json')
if not os.path.exists(mj):
    print('（没有 %s，只做自检）' % mj)
    for r in p0[:6]:
        print('   x=%8.3f 距顶=%8.3f w=%8.3f h=%8.3f' % (r['x'], r['top'], r['w'], r['h']))
    sys.exit(0)

M = json.load(io.open(mj, encoding='utf-8'))
st = M['pages'][0]['strokes']
fl = M['pages'][0]['fills']

# 清单：填充直接取；描边要向内收 lw/2（draw.js 就是这么发的）
want = [(o['x'], o['y'], o['w'], o['h']) for o in fl]
for o in st:
    lw = o['lw'] or 0.3
    want.append((o['x'] + lw / 2, o['y'] + lw / 2,
                 max(0.0, o['w'] - lw), max(0.0, o['h'] - lw)))
got = [(r['x'], r['top'], r['w'], r['h']) for r in p0]

print('清单矩形 %d 条（填充 %d + 描边 %d） / PDF %d 条'
      % (len(want), len(fl), len(st), len(got)))

# ── 逐条配对 ────────────────────────────────────────────────────────────
# ⚠ 不能用 round(x,1) 当桶键：x=77.15 这类.05 尾数受浮点表示影响，
#   round() 会一半进到 77.1、一半进到 77.2，同一处的两批条目被分到不同桶，
#   报出一堆假的「条数不一致」（最大偏差其实还是 0.0000）。
# ⚠ 也不能「遍历所有桶找第一个包含 best 的表再删」—— 按值相等去找会命中
#   另一个坐标恰好相同的桶，把别人的条目摘掉，后面全部配不上。
#   干脆不进桶：直接从候选池里挑距离最小的那个并按下标删除。
pool = list(got)
taken = [False] * len(pool)

dmax = [0.0, 0.0, 0.0, 0.0]
bad, used = [], 0
for u in want:
    bi, bd = -1, None
    for j, cand in enumerate(pool):
        if taken[j]:
            continue
        d = max(abs(u[i] - cand[i]) for i in range(4))
        if bd is None or d < bd:
            bi, bd = j, d
            if d == 0.0:
                break
    if bi < 0 or bd > 0.02:
        bad.append(('未匹配', tuple(round(v, 3) for v in u),
                    None if bi < 0 else tuple(round(v, 3) for v in pool[bi]),
                    None if bd is None else round(bd, 4)))
        continue
    taken[bi] = True
    used += 1
    for i in range(4):
        dmax[i] = max(dmax[i], abs(u[i] - pool[bi][i]))

print('清单 %d 条 → 匹配上 %d 条，未匹配 %d 条' % (len(want), used, len(bad)))
print('逐条最大偏差： x %.4f  top %.4f  w %.4f  h %.4f  mm' % tuple(dmax))
if bad:
    print('⚠ 超出 0.02mm 的 %d 处：' % len(bad))
    for x in bad[:12]:
        print('  ', x)
else:
    print('✅ 全部 %d 条都在 0.02mm 以内' % len(want))
