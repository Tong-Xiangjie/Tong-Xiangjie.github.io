"""Extract the A4 reference card's question-number positions from the PDF text
layer, to determine the choice-block row structure."""
import re, subprocess, os

HERE = os.path.dirname(os.path.abspath(__file__))
ATT = r'C:\Users\57891\.dsh\attachments\v1\files'
PDF = os.path.join(ATT, r'e9\e963589d5c753654c772f2745dc95a2bba940d6494de445b0ade08691a3e9990\数学答题卡A4（6）.pdf')
XML = os.path.join(HERE, 'a4_bbox.xml')

if not os.path.exists(XML):
    subprocess.run(['pdftotext', '-bbox-layout', '-f', '1', '-l', '1', PDF, XML], check=False, capture_output=True)

raw = open(XML, 'rb').read().decode('utf-8', 'replace')
m = re.search(r'<page width="([\d.]+)" height="([\d.]+)"', raw)
print('page pt:', m.group(1), m.group(2),
      '-> mm:', round(float(m.group(1)) * 25.4 / 72, 2), round(float(m.group(2)) * 25.4 / 72, 2))

words = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', raw)
print('total words:', len(words))

def mm(v): return round(float(v) * 25.4 / 72, 2)

toks = [(mm(a), mm(b), mm(c), mm(d), t) for a, b, c, d, t in words]
nums = [t for t in toks if re.fullmatch(r'\d{1,2}', t[4])]
nums.sort(key=lambda x: (round(x[1], 0), x[0]))

print('\n--- numeric tokens (likely question numbers) ---')
for n in nums[:100]:
    print(f'   x={n[0]:7.2f}..{n[2]:7.2f}  yc={(n[1]+n[3])/2:7.2f}  "{n[4]}"')

# group into rows
rows = {}
for n in nums:
    key = round((n[1] + n[3]) / 2, 0)
    rows.setdefault(key, []).append(n)
print('\n--- grouped rows ---')
for k in sorted(rows):
    xs = sorted(round(v[0], 2) for v in rows[k])
    labs = [v[4] for v in sorted(rows[k], key=lambda v: v[0])]
    print(f'   yc~{k:6.1f}  n={len(xs):3d}  x={xs[:16]}')
    print(f'              labels={labs[:16]}')
