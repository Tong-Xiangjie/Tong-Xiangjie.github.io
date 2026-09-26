"""Render reference pages to PNG (if missing) and measure bubble geometry."""
import os, subprocess, sys, io, runpy

HERE = os.path.dirname(os.path.abspath(__file__))
ATT = r'C:\Users\57891\.dsh\attachments\v1\files'

SRC = {
    'm1': os.path.join(ATT, r'c0\c01fb94cb72232588fb683adf594b61c47e40c9e145b28997703f38a514e22c1\高考仿真1数学.pdf'),
    'p1': os.path.join(ATT, r'46\469e26ce242346b37e0332a745fb579f77a94663ebaef169f3b5ce7dcd5d3f4a\高考仿真2物理.pdf'),
    'a1': os.path.join(ATT, r'e9\e963589d5c753654c772f2745dc95a2bba940d6494de445b0ade08691a3e9990\数学答题卡A4（6）.pdf'),
}

for key, pdf in SRC.items():
    if not os.path.exists(pdf):
        print(f'MISSING source pdf: {pdf}')
        continue
    out1 = os.path.join(HERE, key + '-1.png')
    if not os.path.exists(out1):
        subprocess.run(['pdftoppm', '-r', '150', '-png', pdf, os.path.join(HERE, key)],
                       check=False, capture_output=True)
        print(f'rendered {key}')

# now run the bubble measurement
buf = io.StringIO()
old = sys.stdout
sys.stdout = buf
try:
    runpy.run_path(os.path.join(HERE, 'bubbles.py'), run_name='__main__')
finally:
    sys.stdout = old
open(os.path.join(HERE, 'bubbles_out.txt'), 'w', encoding='utf-8').write(buf.getvalue())
print('wrote bubbles_out.txt,', len(buf.getvalue()), 'chars')
