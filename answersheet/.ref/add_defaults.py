import io, re, sys
sys.stdout.reconfigure(encoding='utf-8')

p = 'index.html'
s = io.open(p, encoding='utf-8').read()

FIDS = ['cardTitle', 'cardSubject', 'zkLength', 'cardFooter', 'choiceTotal',
        'choiceStart', 'subjStart', 'subjCount', 'subjScore', 'subjLines']

for fid in FIDS:
    pat = re.compile(r'<input class="input" id="' + fid + r'"([^>]*)>')
    m = pat.search(s)
    if not m:
        print('MISS', fid)
        continue
    attrs = m.group(1)
    if 'data-default' in attrs:
        print('skip', fid)
        continue
    dm = re.search(r'value="([^"]*)"', attrs)
    dv = dm.group(1) if dm else ''
    if dm:
        newattrs = attrs[:dm.start()] + 'value="' + dv + '" data-default="' + dv + '"' + attrs[dm.end():]
    else:
        newattrs = attrs.rstrip() + ' data-default="' + dv + '"'
    s = s[:m.start(1)] + newattrs + s[m.end(1):]
    print('ok', fid, repr(dv))

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('written')
