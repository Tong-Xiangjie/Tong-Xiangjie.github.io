import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = '.ref/persist_check.mjs'
s = io.open(p, encoding='utf-8').read()

if 'clearBtn' not in s:
    old = "  let raw = null; try { raw = localStorage.getItem('as.form.v1'); } catch(e) { raw = 'ERR'; }"
    new = old + "\n  const cb = document.getElementById('btnClear');\n  const cbs = cb ? getComputedStyle(cb) : null;"
    assert old in s, 'a1'
    s = s.replace(old, new, 1)

    old2 = """    hasCard: !!document.querySelector('#stage .as-page'),
    stored: raw"""
    new2 = """    hasCard: !!document.querySelector('#stage .as-page'),
    clearBtn: cb ? { text: cb.textContent.trim(), bg: cbs.backgroundColor,
                     display: cbs.display, w: Math.round(cb.getBoundingClientRect().width) } : null,
    stored: raw"""
    assert old2 in s, 'a2'
    s = s.replace(old2, new2, 1)

tail = "pass %d / fail %d"
assert tail in s, 'a3'
s = s.replace(tail, "pass %d / fail %d ===', '清空按钮: ' + JSON.stringify(reloaded.clearBtn) + ' |", 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
