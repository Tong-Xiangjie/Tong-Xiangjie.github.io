"""Consolidate the pixel run analysis into a clean, de-duplicated layout spec (mm).

pix2.py emits, for every run:  <cross-axis letter> <cross0..cross1> (t=..) <run-axis letter> <run0..run1> len=..
For horizontal rules the cross axis is y and the run axis is x; for vertical rules it is the reverse.
"""
import re, sys

def parse(path):
    txt = open(path, encoding='utf-8').read()
    page = re.search(r'-> ([\d.]+) x ([\d.]+) mm', txt)
    W, H = float(page.group(1)), float(page.group(2))
    sections = {}
    cur = axis = None
    for ln in txt.splitlines():
        m = re.match(r'#+ (RED|NAVY|BLACK) #+', ln)
        if m:
            cur = m.group(1); sections[cur] = {'h': [], 'v': []}; continue
        if ln.startswith('-- horizontal'):
            axis = 'h'; continue
        if ln.startswith('-- vertical'):
            axis = 'v'; continue
        m = re.match(r'\s+(y|x)\s+([\d.]+)\s*\.\.\s*([\d.]+)\s+\(t=\s*([\d.]+)mm\)\s+(x|y)\s+([\d.]+)\s*\.\.\s*([\d.]+)\s+len=\s*([\d.]+)mm', ln)
        if m and cur:
            # cross axis = group1, run axis = group5
            cross0, cross1, t = float(m.group(2)), float(m.group(3)), float(m.group(4))
            run0, run1 = float(m.group(6)), float(m.group(7))
            assert m.group(1) != m.group(5)
            sections[cur][axis].append((cross0, cross1, t, run0, run1))
    return W, H, sections

def merge(items, tol=1.0):
    """Merge runs that overlap along the run axis and are close along the cross axis."""
    groups = []
    for cross0, cross1, t, run0, run1 in sorted(items, key=lambda r: (r[0], r[3])):
        hit = None
        for g in groups:
            if (cross0 - g['cross1']) <= tol and run0 <= g['run1'] + 1.0 and run1 >= g['run0'] - 1.0:
                if hit is None or abs(cross0 - g['cross1']) < abs(cross0 - hit['cross1']):
                    hit = g
        if hit:
            hit['cross1'] = max(hit['cross1'], cross1)
            hit['run0'] = min(hit['run0'], run0)
            hit['run1'] = max(hit['run1'], run1)
            hit['n'] += 1
        else:
            groups.append({'cross0': cross0, 'cross1': cross1, 'run0': run0, 'run1': run1, 'n': 1})
    return groups

def main(src, out):
    W, H, sec = parse(src)
    L = [f'PAGE: {W} x {H} mm', '']
    for color in ('RED', 'NAVY', 'BLACK'):
        if color not in sec:
            continue
        L += ['=' * 100, f'  {color}', '=' * 100]
        for axis, lab in (('h', 'HORIZONTAL rules/bars'), ('v', 'VERTICAL rules/bars')):
            gs = merge(sec[color][axis])
            L.append('')
            L.append(f'--- {lab}  ({len(gs)} merged) ---')
            for g in sorted(gs, key=lambda g: (g['cross0'], g['run0'])):
                thick = g['cross1'] - g['cross0']
                if axis == 'h':
                    kind = 'FILLED BAR' if thick >= 0.8 else ('thin rule' if thick <= 0.3 else 'thick rule')
                    L.append(f'   y={g["cross0"]:7.2f}  x={g["run0"]:7.2f}..{g["run1"]:7.2f}  len={g["run1"]-g["run0"]:7.2f}  thick={thick:5.2f}  rows={g["n"]:3d}  {kind}')
                else:
                    kind = 'FILLED BAR' if thick >= 0.8 else ('thin rule' if thick <= 0.3 else 'thick rule')
                    L.append(f'   x={g["cross0"]:7.2f}  y={g["run0"]:7.2f}..{g["run1"]:7.2f}  len={g["run1"]-g["run0"]:7.2f}  thick={thick:5.2f}  cols={g["n"]:3d}  {kind}')
    open(out, 'w', encoding='utf-8').write('\n'.join(L))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

