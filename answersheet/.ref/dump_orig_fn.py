import io
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
s = io.open('.ref/index.original.backup.html', encoding='utf-8').read()

print('=== 函数定义清单 ===')
for m in re.finditer(r'(?m)^\s*function\s+(\w+)\s*\(', s):
    print('  ', m.group(1))

print('\n=== generateChoice / buildChoice 之类的实现 ===')
for fn in ['generateChoice', 'buildChoice', 'renderChoice', 'generateCard', 'buildCard']:
    i = s.find('function ' + fn)
    if i >= 0:
        j = s.find('\n    function ', i + 10)
        print('--- %s ---' % fn)
        print(s[i:j if j > 0 else i + 4000])
        print()
