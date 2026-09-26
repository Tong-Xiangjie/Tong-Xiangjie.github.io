import io, sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')
rev = '6cd4de91'
raw = subprocess.run(['git', 'show', rev + ':answersheet/index.html'],
                     capture_output=True)
html = raw.stdout.decode('utf-8', 'replace')
lines = html.split('\n')
print('总行数', len(lines))
for a, b in [(280, 300), (350, 375), (478, 500), (555, 600), (620, 660)]:
    print('\n════════ L%d–L%d ════════' % (a, b))
    for i in range(a - 1, min(b, len(lines))):
        print('%4d %s' % (i + 1, lines[i]))
