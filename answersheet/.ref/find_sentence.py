"""列出参考件文字层里所有含「答题区域 / 黑色矩形 / 黑色边框 / 超出」的 word。
目的：确认「请在各题目的答题区域内作答，超出黑色矩形边框限定区域的答案无效」
在参考件里究竟出现几次、分别在哪。
"""
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

PT2MM = 25.4 / 72
s = open('.ref/a4_bbox.xml', encoding='utf-8', errors='replace').read()
ws = re.findall(
    r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', s)

KEYS = ['答题区域', '黑色矩形', '黑色边框', '超出']
print('=== 含关键词的 word（y 单位 mm，页高 297）===')
n = 0
for (a, b, c, d, t) in ws:
    if any(k in t for k in KEYS):
        n += 1
        print('  y %7.2f-%7.2f  x %7.2f-%7.2f  %s' % (
            float(b) * PT2MM, float(d) * PT2MM,
            float(a) * PT2MM, float(c) * PT2MM, t))
print('  命中 %d 条 / 共 %d 条' % (n, len(ws)))

print('\n=== 该句出现的次数 ===')
for (a, b, c, d, t) in ws:
    if '请在各题目的答题区域内作答' in t:
        print('  y %7.2f-%7.2f  x %7.2f-%7.2f' % (
            float(b) * PT2MM, float(d) * PT2MM,
            float(a) * PT2MM, float(c) * PT2MM))

print('\n=== 非选择题栏目头那行（y 110~122）===')
for (a, b, c, d, t) in ws:
    y = float(b) * PT2MM
    if 108 <= y <= 122:
        print('  y %7.2f-%7.2f  x %7.2f-%7.2f  %s' % (
            y, float(d) * PT2MM, float(a) * PT2MM, float(c) * PT2MM, t))
