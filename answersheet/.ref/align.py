"""Compare the black positioning marks against the choice-bubble rows, in mm.

Text-row positions come from pdftotext -bbox-layout (measured); mark blocks come
from the pixel analysis. Both are on the same page coordinate system.
"""

# --- measured mark blocks (x0,x1,y0,y1) from .ref/marks_out.txt ---
marks = [
    (8.13, 11.68, 87.55, 89.75, 'left, 缺考行'),
    (8.30, 11.85, 110.74, 112.95, 'left #1'),
    (8.30, 12.02, 114.98, 117.18, 'left #2'),
    (8.47, 12.02, 118.53, 120.73, 'left #3'),
    (8.47, 12.02, 122.43, 124.63, 'left #4'),
    (8.47, 12.02, 125.98, 128.19, 'left #5'),
    (130.05, 133.60, 81.28, 83.48, 'right, 正确填涂样例'),
    (130.89, 134.79, 114.98, 117.18, 'right #1'),
    (131.06, 134.79, 125.48, 127.68, 'right #2'),
]

# --- measured choice grid (A3 math p1), from text bbox in mm ---
num_row = (109.69, 112.86)                 # 题号行 1..11
opt_rows = {'A': (115.66, 117.05), 'B': (119.17, 120.57),
            'C': (122.73, 124.12), 'D': (126.24, 127.64)}
bubble_x0, bubble_x1 = 17.36, 43.79         # 第1组 1-5 气泡整体跨度
mark_x0, mark_x1 = 8.30, 12.02

def mid(t): return (t[0] + t[1]) / 2

print('=== 左侧定位块 vs 选择题行 ===')
print(f'{"标记":<16}{"块 y0..y1":<20}{"块心":>7}   {"对齐到":<10}{"该行心":>7}{"偏移":>8}')
rows = [('题号行', num_row)] + [(f'{k} 行', v) for k, v in opt_rows.items()]
for x0, x1, y0, y1, name in marks:
    if not name.startswith('left'):
        continue
    cm = mid((y0, y1))
    best = min(rows, key=lambda r: abs(mid(r[1]) - cm))
    off = cm - mid(best[1])
    print(f'{name:<16}{y0:7.2f}..{y1:7.2f}   {cm:7.2f}   {best[0]:<10}{mid(best[1]):7.2f}{off:+8.2f}')

print('\n=== 右侧定位块 vs 选择题行 ===')
for x0, x1, y0, y1, name in marks:
    if not name.startswith('right'):
        continue
    cm = mid((y0, y1))
    best = min(rows, key=lambda r: abs(mid(r[1]) - cm))
    off = cm - mid(best[1])
    print(f'{name:<16}{y0:7.2f}..{y1:7.2f}   {cm:7.2f}   {best[0]:<10}{mid(best[1]):7.2f}{off:+8.2f}')

print('\n=== 水平方向 ===')
print(f'第1组气泡(1-5) 整体 x {bubble_x0}..{bubble_x1}   第1个气泡心 x={(17.36+21.69)/2:.2f}  (每个气泡宽 4.33)')
print(f'左侧定位块      x {mark_x0}..{mark_x1}   宽 {mark_x1-mark_x0:.2f}')
print(f'→ 块右缘 {mark_x1} 与 气泡左缘 {bubble_x0} 相距 {bubble_x0-mark_x1:.2f}mm')

print('\n=== 定位块自身间距 (左侧 #1..#5) ===')
left = [m for m in marks if m[4].startswith('left #')]
prev = None
for x0, x1, y0, y1, name in left:
    pitch = '' if prev is None else f'{y0-prev:6.2f}'
    print(f'  {name:<10} y0={y0:7.2f}  h={y1-y0:5.2f}  pitch={pitch}')
    prev = y0

print('\n=== 气泡行间距（参考基准）===')
prev = mid(num_row)
for k, v in opt_rows.items():
    print(f'  {k} 行心 {mid(v):7.2f}   pitch={mid(v)-prev:5.2f}')
    prev = mid(v)

print('\n=== 块高 vs 气泡高 ===')
print(f'  定位块高   {marks[1][3]-marks[1][2]:.2f}mm')
print(f'  气泡高     {opt_rows["A"][1]-opt_rows["A"][0]:.2f}mm')
print(f'  差         {(marks[1][3]-marks[1][2]) - (opt_rows["A"][1]-opt_rows["A"][0]):+.2f}mm')
