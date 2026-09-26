import io
import sys

sys.stdout.reconfigure(encoding='utf-8')

# ── subj_probe: 加上横向测量 ──
p = '.ref/subj_probe.mjs'
s = io.open(p, encoding='utf-8').read()
old = """    const rel = e => { const r = e.getBoundingClientRect();
      return { t: mm(r.top - pr.top), b: mm(r.bottom - pr.top) }; };"""
new = """    const rel = e => { const r = e.getBoundingClientRect();
      return { l: mm(r.left - pr.left), r: mm(r.right - pr.left),
               t: mm(r.top - pr.top), b: mm(r.bottom - pr.top) }; };"""
assert old in s, 'subj a1'
s = s.replace(old, new, 1)
old2 = """        console.log('     ' + k.padEnd(7) + ' ' + String(v.t).padStart(8) + ' → ' +
                    String(v.b).padStart(8) + '  (高 ' + (v.b - v.t).toFixed(3) + ')');"""
new2 = """        console.log('     ' + k.padEnd(7) + ' x ' + String(v.l).padStart(7) + '-' +
                    String(v.r).padStart(7) + '   y ' + String(v.t).padStart(8) + ' → ' +
                    String(v.b).padStart(8) + '  (高 ' + (v.b - v.t).toFixed(3) + ')');"""
assert old2 in s, 'subj a2'
s = s.replace(old2, new2, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('subj_probe patched')
