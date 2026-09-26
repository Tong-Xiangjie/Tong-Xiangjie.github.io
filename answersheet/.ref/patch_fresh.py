"""
给 .ref/ 下所有校验脚本的 URL 加上 &fresh=1 —— 让页面不读也不写 localStorage。

校验脚本共用一个 Chrome profile，参数存档会互相污染。加这个参数后
每个脚本都拿到干净的出厂状态，且不会把自己的填表内容写进存档。
幂等：已加过的跳过。
"""
import io, os, re, sys
sys.stdout.reconfigure(encoding='utf-8')

REF = '.ref'
changed, skipped = [], []

for fn in sorted(os.listdir(REF)):
    if not fn.endswith('.mjs'):
        continue
    p = os.path.join(REF, fn)
    s = io.open(p, encoding='utf-8').read()
    if fn == 'persist_check.mjs':
        continue                      # 它专门验存档，不能加
    if 'fresh=1' in s:
        skipped.append(fn)
        continue
    m = re.search(r"^(const URL = 'http://127\.0\.0\.1:8137/index\.html)([^']*)';", s, re.M)
    if not m:
        # 形如 '...index.html?cb=' + Date.now();  —— 字符串后面还接了别的表达式
        m = re.search(r"^(const URL = 'http://127\.0\.0\.1:8137/index\.html)([^']*)'", s, re.M)
        if not m:
            skipped.append(fn)
            continue
        q = m.group(2)
        newq = (q + '&fresh=1') if q else '?fresh=1'
        s = s[:m.start()] + m.group(1) + newq + "'" + s[m.end():]
        io.open(p, 'w', encoding='utf-8', newline='').write(s)
        changed.append(fn)
        continue
    q = m.group(2)
    newq = (q + '&fresh=1') if q else '?fresh=1'
    s = s[:m.start()] + m.group(1) + newq + "';" + s[m.end():]
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    changed.append(fn)

print('patched:', len(changed))
for c in changed:
    print('  ', c)
print('skipped:', len(skipped))
for c in skipped:
    print('  ', c)
