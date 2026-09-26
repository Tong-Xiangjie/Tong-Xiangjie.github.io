"""Compare the big corner marks against the top/left small marks on every
reference page, to see how far off the intended alignment actually is (mm).

Data from .ref/blocks.txt (2D connected-component detection, mm):
(x0, y0, w, h)
"""
import io

DATA = {
 'A3 math p1': {
   'corners': [(138.85, 8.13, 6.77, 4.23), (5.59, 8.30, 6.77, 4.23),
               (139.02, 283.97, 6.77, 4.06), (407.08, 283.97, 6.77, 4.06),
               (5.59, 284.14, 6.77, 4.06), (273.13, 284.14, 6.60, 4.23),
               (272.97, 8.30, 6.77, 4.06), (407.08, 8.30, 6.77, 4.06)],
   'top':   [(15.41,9.82,3.73,2.20),(21.34,9.82,3.73,2.20),(27.43,9.82,3.56,2.20),
             (33.36,9.82,3.56,2.20),(39.29,9.82,3.56,2.20),(45.21,9.82,3.73,2.20),
             (51.14,9.82,3.73,2.20),(57.07,9.82,3.73,2.20),(62.99,9.82,3.73,2.20),
             (69.09,9.82,3.56,2.20),(75.01,9.82,3.56,2.20),(80.94,9.82,3.56,2.20),
             (86.87,9.82,3.73,2.20),(92.79,9.82,3.73,2.20),(98.72,9.82,3.73,2.20),
             (104.65,9.82,3.73,2.20),(110.74,9.82,3.56,2.20),(116.67,9.82,3.56,2.20),
             (122.60,9.82,3.56,2.20),(128.52,9.82,3.73,2.20)],
   'left':  [(8.13,87.55,3.56,2.20),(8.30,110.74,3.56,2.20),(8.30,114.98,3.73,2.20),
             (8.47,118.53,3.56,2.20),(8.47,122.43,3.56,2.20),(8.47,125.98,3.56,2.20)],
 },
 'A4 math p1': {
   'corners': [(5.59,13.55,6.77,4.23),(197.10,13.72,6.77,4.23),
               (5.59,279.57,6.77,4.23),(197.10,279.91,6.77,4.23)],
   'top':   [(17.78,14.73,3.56,2.20),(23.71,14.73,3.56,2.20),(29.63,14.73,3.56,2.20),
             (35.56,14.73,3.73,2.20),(41.49,14.73,3.73,2.20),(47.41,14.73,3.73,2.20),
             (53.51,14.73,3.56,2.20),(59.44,14.73,3.56,2.20),(65.36,14.73,3.56,2.20),
             (71.29,14.73,3.56,2.20),(77.22,14.73,3.73,2.20),(83.14,14.73,3.73,2.20),
             (89.07,14.73,3.73,2.20),(95.17,14.73,3.56,2.20),(101.09,14.73,3.56,2.20),
             (107.02,14.73,3.56,2.20),(112.95,14.73,3.56,2.20),(118.87,14.73,3.73,2.20),
             (124.80,14.73,3.73,2.20),(130.73,14.73,3.73,2.20),(136.82,14.73,3.56,2.20),
             (142.75,14.73,3.56,2.20),(148.67,14.73,3.56,2.20),(154.60,14.73,3.56,2.20),
             (160.53,14.73,3.73,2.20),(166.45,14.73,3.73,2.20),(172.38,14.73,3.73,2.20),
             (178.48,14.73,3.56,2.20),(184.40,14.73,3.56,2.20)],
   'left':  [(5.25,68.24,3.73,2.20),(5.59,90.09,3.56,2.20),(5.76,93.64,3.39,2.20),
             (5.76,97.54,3.39,2.20),(5.76,101.09,3.39,2.20)],
 },
}

def cx(b): return b[0] + b[2] / 2
def cy(b): return b[1] + b[3] / 2

out = io.StringIO()
def P(*a): print(*a, file=out)

for name, d in DATA.items():
    P('=' * 88)
    P(name)
    P('=' * 88)
    corners = d['corners']
    top = sorted(d['top'], key=lambda b: b[0])
    left = sorted(d['left'], key=lambda b: b[1])
    tl = min(corners, key=lambda b: b[0] + b[1])

    P('')
    P(f'  top-left-most corner:  x={tl[0]:.2f} y={tl[1]:.2f} w={tl[2]:.2f} h={tl[3]:.2f}'
      f'   center=({cx(tl):.3f}, {cy(tl):.3f})')
    P('')
    pitch = (top[1][0] - top[0][0]) if len(top) > 1 else 0
    P(f'  TOP marks  n={len(top)}  pitch={pitch:.2f}')
    P(f'      first mark center x = {cx(top[0]):.3f}   (left edge x={top[0][0]:.2f})')
    P(f'      last  mark center x = {cx(top[-1]):.3f}')
    P(f'      mark center y       = {cy(top[0]):.3f}')
    P(f'  LEFT marks n={len(left)}')
    P(f'      first mark center y = {cy(left[0]):.3f}   (top edge y={left[0][1]:.2f})')
    P(f'      mark center x       = {cx(left[0]):.3f}')
    P('')
    P('  --- DELTAS (corner center vs mark center) ---')
    P(f'      corner.centerX - top[0].centerX  = {cx(tl) - cx(top[0]):+7.3f} mm')
    P(f'      corner.centerX - left[0].centerX = {cx(tl) - cx(left[0]):+7.3f} mm')
    P(f'      corner.centerY - left[0].centerY = {cy(tl) - cy(left[0]):+7.3f} mm')
    P(f'      corner.centerY - top[0].centerY  = {cy(tl) - cy(top[0]):+7.3f} mm')
    P('')
    P('  --- alt reading: corner EDGE vs first top mark EDGE ---')
    P(f'      corner right edge {tl[0]+tl[2]:8.3f}  vs top[0] left edge {top[0][0]:8.3f}'
      f'   delta {tl[0]+tl[2]-top[0][0]:+7.3f} mm')
    P(f'      corner left  edge {tl[0]:8.3f}  vs top[0] centerX   {cx(top[0]):8.3f}'
      f'   delta {tl[0]-cx(top[0]):+7.3f} mm')
    P('')

open(r'.ref\corner_out.txt', 'w', encoding='utf-8').write(out.getvalue())
print('wrote corner_out.txt')
