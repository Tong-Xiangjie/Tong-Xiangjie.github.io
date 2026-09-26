"""Extract precise layout geometry (in mm) from pdftotext -bbox-layout XML.

A3 landscape reference: 1190.52 x 841.92 pt = 420 x 297 mm.
Reports every text line/word position so the hand-made layout can be measured.
"""
import sys, re, html
from xml.etree import ElementTree as ET

PT2MM = 25.4 / 72.0
NS = '{http://www.w3.org/1999/xhtml}'

def mm(v):
    return round(float(v) * PT2MM, 2)

def main(path, page_filter=None):
    tree = ET.parse(path)
    root = tree.getroot()
    pages = root.iter(f'{NS}page')
    for pno, page in enumerate(pages, 1):
        if page_filter and pno != page_filter:
            continue
        W, H = mm(page.get('width')), mm(page.get('height'))
        print(f'\n{"="*100}')
        print(f'PAGE {pno}   {W} x {H} mm   ({page.get("width")} x {page.get("height")} pt)')
        print('='*100)
        blocks = list(page.iter(f'{NS}block'))
        for b in blocks:
            bx0, by0, bx1, by1 = mm(b.get('xMin')), mm(b.get('yMin')), mm(b.get('xMax')), mm(b.get('yMax'))
            lines = list(b.iter(f'{NS}line'))
            print(f'\n  BLOCK  x[{bx0:7.2f} .. {bx1:7.2f}]  y[{by0:7.2f} .. {by1:7.2f}]   w={bx1-bx0:6.2f} h={by1-by0:6.2f}')
            for ln in lines:
                lx0, ly0, lx1, ly1 = mm(ln.get('xMin')), mm(ln.get('yMin')), mm(ln.get('xMax')), mm(ln.get('yMax'))
                words = [ (w.text or '') for w in ln.iter(f'{NS}word') ]
                text = ''.join(words)
                text = text.replace('\n', ' ')
                print(f'    line x[{lx0:7.2f} .. {lx1:7.2f}] y[{ly0:7.2f} .. {ly1:7.2f}] h={ly1-ly0:5.2f}  | {text[:120]}')

if __name__ == '__main__':
    if len(sys.argv) > 3:
        with open(sys.argv[3], 'w', encoding='utf-8') as fh:
            old = sys.stdout
            sys.stdout = fh
            try:
                main(sys.argv[1], int(sys.argv[2]) if sys.argv[2] != '-' else None)
            finally:
                sys.stdout = old
    else:
        main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else None)
