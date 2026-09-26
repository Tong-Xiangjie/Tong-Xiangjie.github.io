import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
p = '.ref/measure_wrap.py'
s = io.open(p, encoding='utf-8').read()
s = s.replace('DARK = 170', 'DARK = 200')
s = s.replace("if h < 1.0:", "if h < 0.8:")
s = s.replace("if h < 1.0:\n        continue", "if h < 0.8:\n        continue")
io.open('.ref/measure_wrap2.py', 'w', encoding='utf-8', newline='').write(s)
print('ok')
