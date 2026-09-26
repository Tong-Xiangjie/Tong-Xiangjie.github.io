import io, re, sys
sys.stdout.reconfigure(encoding='utf-8')

s = io.open('.ref/a4_bbox.xml', encoding='utf-8', errors='replace').read()
f = lambda v: round(float(v) * 25.4 / 72, 2)

print('--- all blocks (mm) ---')
for m in re.finditer(r'<block xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"', s):
    x0, y0, x1, y1 = map(f, m.groups())
    print('x %6.2f-%6.2f (w=%6.2f)  y %6.2f-%6.2f (h=%6.2f)'
          % (x0, x1, round(x1 - x0, 2), y0, y1, round(y1 - y0, 2)))
