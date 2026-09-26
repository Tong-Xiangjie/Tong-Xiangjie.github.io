import io, re, sys, zlib
sys.stdout.reconfigure(encoding='utf-8')

p = sys.argv[1] if len(sys.argv) > 1 else '.ref/out/测试卷_物理答题卡.pdf'
b = io.open(p, 'rb').read()
print('file size', len(b), 'header', b[:9])

# ── 页数：找 /Type /Page（不含 /Pages） ──
pages = len(re.findall(rb'/Type\s*/Page[^s]', b))
print('/Type /Page 出现次数 =', pages)

# ── MediaBox ──
boxes = re.findall(rb'/MediaBox\s*\[([^\]]*)\]', b)
print('MediaBox 数 =', len(boxes))
for i, x in enumerate(boxes[:8]):
    v = [float(t) for t in re.split(rb'\s+', x.strip()) if t]
    if len(v) == 4:
        w, h = v[2] - v[0], v[3] - v[1]
        print('  页%d  %.2f × %.2f pt  = %.2f × %.2f mm'
              % (i + 1, w, h, w * 25.4 / 72, h * 25.4 / 72))

# ── 每页的图像 XObject ──
imgs = re.findall(rb'/Subtype\s*/Image', b)
print('/Subtype /Image 数 =', imgs.__len__())
for m in re.finditer(rb'/Subtype\s*/Image[^>]{0,200}?/Width\s+(\d+)[^>]{0,120}?/Height\s+(\d+)', b, re.S):
    print('  image %s x %s' % (m.group(1).decode(), m.group(2).decode()))

# ── 内容流大小（粗看每页有没有东西） ──
streams = re.findall(rb'stream\r?\n(.*?)endstream', b, re.S)
sizes = sorted((len(s) for s in streams), reverse=True)[:8]
print('前 8 大 stream 字节 =', sizes)
