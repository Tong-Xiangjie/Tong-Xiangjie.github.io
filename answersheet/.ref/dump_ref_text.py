import io, re, sys
sys.stdout.reconfigure(encoding='utf-8')

s = io.open('.ref/a4_bbox.xml', encoding='utf-8', errors='replace').read()
f = lambda v: round(float(v) * 25.4 / 72, 1)

pat = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', re.S)
rows = []
for m in pat.finditer(s):
    x0, y0, x1, y1, inner = m.groups()
    txt = ''.join(re.findall(r'>([^<]*)</word>', inner))
    if not txt.strip():
        continue
    rows.append((float(y0), f(x0), f(y0), f(x1), f(y1), txt))

rows.sort()
for _, x0, y0, x1, y1, txt in rows:
    print('y=%6.1f-%6.1f  x=%6.1f-%6.1f  %s' % (y0, y1, x0, x1, txt))
