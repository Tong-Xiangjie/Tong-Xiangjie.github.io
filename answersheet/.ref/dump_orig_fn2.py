import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
s = io.open('.ref/index.original.backup.html', encoding='utf-8').read()

for fn in ['generateQuestionColumn', 'generateInvisibleColumn', 'calculateAlignmentOffset',
           'genPageShell']:
    i = s.find('function ' + fn)
    if i < 0:
        print('!! %s not found' % fn)
        continue
    j = s.find('\n    function ', i + 10)
    print('=== %s ===' % fn)
    print(s[i:j if j > 0 else i + 3000])
    print()
