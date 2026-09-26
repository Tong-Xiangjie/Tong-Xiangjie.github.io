"""One-shot: pixel-analyse every reference page and consolidate each into a layout spec."""
import sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pix2, consolidate2

REF = os.path.dirname(os.path.abspath(__file__))

jobs = []
for png in sorted(glob.glob(os.path.join(REF, '*.png'))):
    base = os.path.basename(png)
    if base.startswith('math_a4b-'):
        jobs.append((png, 150, os.path.join(REF, f'spec_a4_p{base.split("-")[1].split(".")[0]}.txt')))
    elif base.startswith('phys_sim2b-'):
        jobs.append((png, 150, os.path.join(REF, f'spec_phys_p{base.split("-")[1].split(".")[0]}.txt')))
    elif base == 'math_sim1-1.png':
        jobs.append((png, 150, os.path.join(REF, 'spec_math_p1.txt')))
    elif base == 'math_sim1-2.png':
        jobs.append((png, 150, os.path.join(REF, 'spec_math_p2.txt')))

for png, dpi, outp in jobs:
    raw = os.path.join(REF, '_raw.txt')
    res = pix2.analyze(png, dpi, minrun=30)
    open(raw, 'w', encoding='utf-8').write(res)
    consolidate2.main(raw, outp)
    print(f'{os.path.basename(png)} -> {os.path.basename(outp)}  ({os.path.getsize(outp)} bytes)')
