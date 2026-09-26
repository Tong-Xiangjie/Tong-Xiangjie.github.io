import io
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
s = io.open('.ref/index.original.backup.html', encoding='utf-8').read()

i = s.find('choice-section')
# 找 HTML 里的（不是 CSS 里的）那处
while i >= 0 and s[max(0, i - 40):i].strip().endswith('{'):
    i = s.find('choice-section', i + 1)
j = s.find('subject-section', i)
if j < 0:
    j = i + 9000
frag = s[i - 60:min(j, i + 9000)]
print('=== 原始 HTML 的选择题区（前 6500 字）===')
print(frag[:6500])
