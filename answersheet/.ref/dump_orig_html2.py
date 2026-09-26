import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
s = io.open('.ref/index.original.backup.html', encoding='utf-8').read()

for key in ['left-marks-container', 'choice-content-wrap', 'top-mark-container',
            'choice-group-spacer']:
    print('=== HTML 中的 <%s> 出现处 ===' % key)
    i = 0
    n = 0
    while True:
        i = s.find(key, i)
        if i < 0 or n >= 3:
            break
        # 判断是不是 HTML（前面有 < 而不是 . 或 #）
        st = s.rfind('<', max(0, i - 200), i)
        print('--- offset %d ---' % i)
        print(s[max(0, i - 300):i + 1200])
        print()
        i += 1
        n += 1
