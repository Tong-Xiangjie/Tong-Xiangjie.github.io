# -*- coding: utf-8 -*-
"""从矢量 PDF 里把绘图操作还原出来，用于核对几何。

jsPDF 的内容流是**未压缩**的，可以直接正则捞 Tm/Td/re/Tj 等操作符。
单位是 mm 建实例（MediaBox 595.276pt = 210mm），PDF 的 y 轴向上，
所以「距纸顶 = PH − pdfY」。

用法：
    python .ref/pdfops.py .ref/out/vector.pdf            # 汇总
    python .ref/pdfops.py .ref/out/vector.pdf text       # 文字位置
    python .ref/pdfops.py .ref/out/vector.pdf rect       # 矩形位置
"""
import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')

path = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/vector.pdf'
mode = sys.argv[2] if len(sys.argv) > 2 else 'summary'
b = io.open(path, 'rb').read()

streams = []
for m in re.finditer(rb'stream\r?\n', b):
    start = m.end()
    end = b.find(b'endstream', start)
    if end < 0:
        continue
    raw = b[start:end].rstrip(b'\r\n')
    try:
        txt = zlib.decompress(raw).decode('latin-1')
    except Exception:
        txt = raw.decode('latin-1')
    if re.search(r'\bTd\b|\bre\b|\bTj\b', txt):
        streams.append(txt)

mb = re.search(rb'/MediaBox\s*\[([^\]]+)\]', b)
media = [float(x) for x in mb.group(1).split()] if mb else [0, 0, 595.2756, 841.8898]
PH = media[3]
MM = 72.0 / 25.4                      # pt per mm

# ⚠ jsPDF 以 mm 建实例，但写进内容流的坐标是 **pt**（每页开头有一段
#   `0.75 0 0 -0.75 … cm` 把单位从 mm 缩到 pt，同时翻转 y 轴）。
#   所以流里的 x/y 都要 /2.8346 才是 mm。忘了这一步会看到「偏差 300mm」。
def toMM(v):
    return v / MM

print('文件 %s  %d B  内容流 %d 个' % (path, len(b), len(streams)))
print('MediaBox = %s  → %.3f × %.3f mm' % (media, media[2] / MM, media[3] / MM))
print('位图对象 /Subtype /Image =', len(re.findall(rb'/Subtype\s*/Image', b)))
print('FontFile2 =', len(re.findall(rb'/FontFile2', b)),
      ' Type0 =', len(re.findall(rb'/Type0', b)),
      ' ToUnicode =', len(re.findall(rb'/ToUnicode', b)))
print('字体 =', sorted(set(x.decode() for x in re.findall(rb'/BaseFont\s*/([^\s/>]+)', b))))

NUM = r'-?[\d.]+'
# 显式列出操作符 —— 用 `[A-Za-z]+` 之类去猜很容易把 `re` 漏掉或切错，
# 一旦漏掉，它的操作数就会残留到下一个操作符上，坐标整体错位。
OPS = ['re', 'Tf', 'Td', 'TD', 'Tj', 'TJ', 'Tc', 'TL', 'Tw', 'Tz', 'Ts', 'Tr',
       'cm', 'w', 'd', 'J', 'j', 'M', 'ri', 'i', 'gs', 'rg', 'RG', 'g', 'G',
       'k', 'K', 'cs', 'CS', 'sc', 'SC', 'scn', 'SCN', 'sh',
       'm', 'l', 'c', 'v', 'y', 'h', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*',
       'S', 's', 'n', 'W', 'W*', 'BT', 'ET', 'BI', 'ID', 'EI', 'Do', 'q', 'Q']
TOK = re.compile(
    r'(?P<op>' + '|'.join(re.escape(o) for o in
                          sorted(OPS, key=len, reverse=True)) + r')(?![A-Za-z0-9*])'
    r'|(?P<operand><[0-9A-Fa-f\s]*>|/[A-Za-z0-9_.+-]+|\[[^\]]*\]|-?[\d.]+)')

texts, rects = [], []
for si, s in enumerate(streams):
    lw, dashes, cursize, curfont = 0.3, None, None, None
    stack = []
    for m in TOK.finditer(s):
        if m.lastgroup == 'operand':
            stack.append(m.group('operand'))
            continue
        op = m.group('op')
        if op == 're' and len(stack) >= 4:
            w, h, y, x = (float(stack[-1]), float(stack[-2]),
                          float(stack[-3]), float(stack[-4]))
            top, bot = toMM(PH) - toMM(y), toMM(PH) - toMM(y + h)
            if bot < top:
                top, bot = bot, top
            rects.append({'s': si, 'x': toMM(x), 'y': toMM(y),
                          'w': toMM(abs(w)), 'h': toMM(abs(h)),
                          'rawW': w, 'rawH': h,
                          'top': top, 'bot': bot, 'lw': lw, 'dash': dashes})
        elif op == 'w' and len(stack) >= 1:
            lw = toMM(float(stack[-1]))
        elif op == 'd' and len(stack) >= 2:
            dashes = (stack[-2], toMM(float(stack[-1])))
        elif op == 'Tf' and len(stack) >= 2:
            curfont = stack[-2].lstrip('/')
            cursize = float(stack[-1])
        elif op == 'Td' and len(stack) >= 2:
            texts.append({'s': si, 'x': toMM(float(stack[-2])),
                          'ptY': PH - float(stack[-1]),
                          'top': toMM(PH - float(stack[-1])),
                          'size': cursize, 'font': curfont, 'hex': None})
        elif op == 'Tj' and stack and stack[-1].startswith('<'):
            if texts:
                texts[-1]['hex'] = stack[-1][1:-1]
        stack = []          # ← 关键：任何操作符之后都清空

print('\n文字 %d 条，矩形 %d 条' % (len(texts), len(rects)))

if mode == 'text':
    for t in texts[:220]:
        print('  s%d %-5s %5spt  x=%8.3f  距顶=%8.3f' %
              (t['s'], t['font'], t['size'], t['x'], t['top']))
elif mode == 'rect':
    for r in rects[:220]:
        print('  s%d x=%8.3f 距顶=%8.3f w=%8.3f h=%8.3f lw=%.3f dash=%s' %
              (r['s'], r['x'], r['top'], r['w'], r['h'], r['lw'], r['dash']))
else:
    from collections import defaultdict
    g = defaultdict(lambda: [0, 0])
    for t in texts:
        g[t['s']][0] += 1
    for r in rects:
        g[r['s']][1] += 1
    for k in sorted(g):
        ts = [t['top'] for t in texts if t['s'] == k]
        rs = [r['top'] for r in rects if r['s'] == k]
        rl = [r['bot'] for r in rects if r['s'] == k]
        print('  流 %d：文字 %3d 条（距顶 %.2f..%.2f）  矩形 %3d 条（距顶 %.2f..%.2f）'
              % (k, g[k][0], min(ts) if ts else -1, max(ts) if ts else -1,
                 g[k][1], min(rs) if rs else -1, max(rl) if rl else -1))
    fs = sorted(set((t['font'], round(t['size'], 2)) for t in texts if t['font']))
    print('\n用到的字体/字号：')
    for f, s in fs:
        print('   %-6s %s pt' % (f, s))

# ── 与预览测量结果对照 ──────────────────────────────────────────────
# 把 .ref/out/measure.json（由 cmp.html 导出）里的清单读进来，
# 逐条比 PDF 与「绘制清单」的位置，确认 draw.js 没写错坐标。
mj = path.replace('.pdf', '.measure.json')
import os, json
if os.path.exists(mj):
    M = json.load(io.open(mj, encoding='utf-8'))
    print('\n=== 对照 %s ===' % mj)
    ptxt = [t for t in texts if t['s'] == 0]
    mrect = M['pages'][0]['strokes']
    mfill = M['pages'][0]['fills']
    print('PDF 第 1 页文字 %d 条 / 清单文字 %d 条' %
          (len(ptxt), len(M['pages'][0]['texts'])))
    print('PDF 第 1 页矩形 %d 条 / 清单 框 %d + 填充 %d = %d' %
          (len([r for r in rects if r['s'] == 0]), len(mrect), len(mfill),
           len(mrect) + len(mfill)))
    # 矩形：描边与填充在 PDF 流里是同一个 re 操作符。
    # 不猜哪条是描边哪条是填充 —— 直接把两份清单都归一化成
    # （左缘, 顶边, 宽, 高）的有序元组，排序后逐条相减。
    # 描边要向内收 lw/2，所以先按此修正清单值。
    def canon(o):
        return (round(o[0], 2), round(o[1], 2), round(o[2], 2), round(o[3], 2))

    mrect = M['pages'][0]['strokes']
    mfill = M['pages'][0]['fills']
    want = []
    for o in mfill:
        want.append((o['x'], o['y'], o['w'], o['h'], 'fill'))
    for o in mrect:
        lw = o['lw'] or 0.3
        want.append((o['x'] + lw / 2, o['y'] + lw / 2,
                     max(0.0, o['w'] - lw), max(0.0, o['h'] - lw), 'stroke'))
    got = []
    clips = 0
    for r in rects:
        if r['s'] != 0:
            continue
        w, h = r['w'], abs(r['h'])
        x, top = r['x'], r['top']
        # ⚠ jsPDF 会为每一页写一个**裁剪矩形**，该矩形带负的宽高
        #   （`re` 的 x/y 是左下角，jsPDF 传的是 w<0,h<0 的形式）。
        #   它不是内容，比对时要剔掉。
        if r['w'] < 0 or r['h'] < 0:
            clips += 1
            continue
        got.append((x, top, w, h))
    print('（已剔除裁剪矩形 %d 条）' % clips)
    if len(want) != len(got):
        print('⚠ 矩形条数不一致：清单 %d，PDF %d' % (len(want), len(got)))
    want.sort(key=lambda t: (round(t[1], 1), round(t[0], 1)))
    got.sort(key=lambda t: (round(t[1], 1), round(t[0], 1)))
    n = min(len(want), len(got))
    dx = dy = dw = dh = 0.0
    bad = []
    for i in range(n):
        a, z = want[i], got[i]
        ex = abs(a[0] - z[0]); ey = abs(a[1] - z[1])
        ew = abs(a[2] - z[2]); eh = abs(a[3] - z[3])
        if max(ex, ey, ew, eh) > 0.02:
            bad.append((a[4], a[:4], z, round(ex, 3), round(ey, 3), round(ew, 3), round(eh, 3)))
        dx = max(dx, ex); dy = max(dy, ey); dw = max(dw, ew); dh = max(dh, eh)
    print('矩形 %d 条逐条对照：最大偏差  x %.4f  top %.4f  w %.4f  h %.4f mm'
          % (n, dx, dy, dw, dh))
    if bad:
        print('  超出 0.02mm 的 %d 条：' % len(bad))
        for b in bad[:10]:
            print('   [%s] 清单=%s PDF=%s  差 x%.3f top%.3f w%.3f h%.3f'
                  % (b[0], b[1], b[2], b[3], b[4], b[5], b[6]))
    else:
        print('  ✅ 全部在 0.02mm 以内')

    pt = sorted([t['top'] for t in texts if t['s'] == 0])
    mt = sorted([t['y'] for t in M['pages'][0]['texts']])
    if len(pt) == len(mt):
        d = [abs(a - b) for a, b in zip(pt, mt)]
        print('文字基线：清单 %d 条 / PDF %d 条，逐条最大偏差 %.4f mm'
              % (len(mt), len(pt), max(d)))
    else:
        print('⚠ 文字条数不一致：清单 %d，PDF %d' % (len(mt), len(pt)))
