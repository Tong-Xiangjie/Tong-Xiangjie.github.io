import io
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
s = io.open('.ref/index.original.backup.html', encoding='utf-8').read()

print('=== CSS: 选择题区相关规则 ===')
for sel in ['choice-section', 'left-marks-container', 'left-mark', 'top-mark-container',
            'top-mark', 'choice-outer', 'choice-inner', 'choice-header', 'choice-col',
            'choice-content-wrap', 'choice-group-spacer', 'invisible-col',
            'invisible-num-cell', 'num-row', 'num-item', 'opt-row', 'opt-box',
            'choice-example-block']:
    for m in re.finditer(r'(?m)^\s*\.' + re.escape(sel) + r'[^{]*\{', s):
        j = s.index('}', m.start())
        print(s[m.start():j + 1].strip())
        print()
