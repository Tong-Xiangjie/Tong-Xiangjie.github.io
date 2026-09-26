"""修掉 patch_fresh.py 造出来的坏 URL：
   '...?cb=&fresh=1' + Date.now()   →   '...?cb=' + Date.now() + '&fresh=1'
（前一次替换把拼接表达式吃进了字符串字面量，cb 变成空值、fresh 也失效。）
"""
import io, os, re, sys
sys.stdout.reconfigure(encoding='utf-8')

REF = '.ref'
BAD = re.compile(r"^(const URL = 'http://127\.0\.0\.1:8137/index\.html)\?cb=&fresh=1' \+ Date\.now\(\);",
                 re.M)
GOOD = r"\1?cb=' + Date.now() + '&fresh=1';"

fixed = []
for fn in sorted(os.listdir(REF)):
    if not fn.endswith('.mjs'):
        continue
    p = os.path.join(REF, fn)
    s = io.open(p, encoding='utf-8').read()
    if not BAD.search(s):
        continue
    s = BAD.sub(GOOD, s)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    fixed.append(fn)

print('fixed:', len(fixed))
for f in fixed:
    print('  ', f)

# 复查所有 URL 行
print('--- verify ---')
bad2 = 0
for fn in sorted(os.listdir(REF)):
    if not fn.endswith('.mjs'):
        continue
    s = io.open(os.path.join(REF, fn), encoding='utf-8').read()
    for m in re.finditer(r"^const URL = .*$", s, re.M):
        line = m.group(0)
        if 'index.html' not in line:
            continue
        ok = ("fresh=1" in line and "cb=' + Date.now()" in line) or \
             ("fresh=1" not in line and fn in ('dbg_paginate.mjs', 'gap_probe.mjs',
                                               'minimal.mjs', 'test_geometry.mjs',
                                               'test_pipeline.mjs', 'persist_check.mjs'))
        if not ok:
            bad2 += 1
            print('  STILL BAD', fn, '->', line)
print('bad remaining:', bad2)
