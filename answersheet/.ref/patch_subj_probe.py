import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
p = '.ref/subj_probe.mjs'
s = io.open(p, encoding='utf-8').read()

old1 = "          nRows: fc.querySelectorAll('.as-subj-head').length,"
new1 = """          nRows: fc.querySelectorAll('.as-subj-head').length,
          detail: (() => {
            const out = {};
            const g = (sel, k) => { const e = fc.querySelector(sel); if (e) out[k] = rel(e); };
            g('.as-subject-outer', 'outer'); g('.as-subject-header', 'hdr');
            g('.as-subject-inner-table', 'tbl');
            const b = fc.querySelector('.as-subj-body'); if (b) out.body = rel(b);
            const td = fc.querySelector('.as-subject-inner-table td'); if (td) out.td = rel(td);
            const tr = fc.querySelector('.as-subject-inner-table tr'); if (tr) out.tr = rel(tr);
            const tb = fc.querySelector('.as-subject-inner-table tbody'); if (tb) out.tbody = rel(tb);
            return out;
          })(),"""
assert old1 in s, 'a1'
s = s.replace(old1, new1, 1)

old2 = "      f.heads.forEach(h => console.log('     y %8s → %8s   %s', h.t, h.b, h.txt));"
new2 = """      f.heads.forEach(h => console.log('     head    ' + h.t + ' → ' + h.b + '   ' + h.txt));
      if (f.detail) Object.keys(f.detail).forEach(k => {
        const v = f.detail[k];
        console.log('     ' + k.padEnd(7) + ' ' + String(v.t).padStart(8) + ' → ' +
                    String(v.b).padStart(8) + '  (高 ' + (v.b - v.t).toFixed(3) + ')');
      });"""
assert old2 in s, 'a2'
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
