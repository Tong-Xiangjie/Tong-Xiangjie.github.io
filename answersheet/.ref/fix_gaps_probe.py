import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = '.ref/gaps_check.mjs'
s = io.open(p, encoding='utf-8').read()

old1 = """    console.log('  %s  %8s → %8s   (高 %s)', k.padEnd(8), d[k].t, d[k].b,
                Math.round((d[k].b - d[k].t) * 1000) / 1000);"""
new1 = """    console.log('  ' + k.padEnd(8) + '  ' + String(d[k].t).padStart(8) + ' → ' +
                String(d[k].b).padStart(8) + '   (高 ' +
                (Math.round((d[k].b - d[k].t) * 1000) / 1000) + ')');"""
assert old1 in s, 'a1'
s = s.replace(old1, new1, 1)

old2 = """    console.log('  %s  %s%s', label.padEnd(20), v, flag);"""
new2 = """    console.log('  ' + label.padEnd(20) + '  ' + String(v).padStart(8) + flag);"""
assert old2 in s, 'a2'
s = s.replace(old2, new2, 1)

old3 = "间距为 0 的处数: %d', zero);"
new3 = "间距为 0 的处数: ' + zero);"
assert old3 in s, 'a3'
s = s.replace(old3, new3, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
