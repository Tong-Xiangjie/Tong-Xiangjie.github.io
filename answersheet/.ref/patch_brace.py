import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()
old = """        offs.forEach(function (d) { rows.push(r3(base + d)); });
      }
    }
    }

    /* ── 角标：中心 x = cornerX"""
new = """        offs.forEach(function (d) { rows.push(r3(base + d)); });
      }
    }

    /* ── 角标：中心 x = cornerX"""
assert old in s, 'stray brace pattern not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
