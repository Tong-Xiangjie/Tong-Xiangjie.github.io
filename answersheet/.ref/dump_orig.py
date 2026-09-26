import io
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')
s = io.open('.ref/index.original.backup.html', encoding='utf-8').read()
print('文件长度', len(s))

print('\n=== 所有 class 名 ===')
names = set()
for m in re.finditer(r'class="([^"]+)"', s):
    for n in m.group(1).split():
        names.add(n)
for n in sorted(names):
    print('  ', n)

print('\n=== 含「选择」的文本片段 ===')
for m in re.finditer(r'选择', s):
    a = max(0, m.start() - 200)
    print('---')
    print(s[a:m.start() + 300].replace('\n', ' ')[:460])
