import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = '.ref/grid_face.cjs'
s = io.open(p, encoding='utf-8').read()

old_grid = """    const grids = Array.from(page.querySelectorAll('.as-choice-grid')).map(function (g, i) {
      const b = g.getBoundingClientRect();
      return { i: i, left: mm(b.left - pr.left), right: mm(b.right - pr.left),
               w: mm(b.width), chain: chainOf(g).join(' < ') };
    });"""
new_grid = """    const grids = Array.from(page.querySelectorAll('.as-choice-grid')).map(function (g, i) {
      const b = g.getBoundingClientRect();
      const cs = getComputedStyle(g);
      return { i: i, left: mm(b.left - pr.left), right: mm(b.right - pr.left),
               w: mm(b.width), pos: cs.position, ml: cs.marginLeft,
               chain: chainOf(g).join(' < ') };
    });
    const inners = Array.from(page.querySelectorAll('.as-choice-inner')).map(function (g) {
      const b = g.getBoundingClientRect();
      const cs = getComputedStyle(g);
      return { left: mm(b.left - pr.left), right: mm(b.right - pr.left),
               w: mm(b.width), pos: cs.position, ml: cs.marginLeft };
    });
    const lines = Array.from(page.querySelectorAll('.as-choice-line')).map(function (g) {
      const b = g.getBoundingClientRect();
      const cs = getComputedStyle(g);
      return { left: mm(b.left - pr.left), right: mm(b.right - pr.left),
               w: mm(b.width), pos: cs.position, disp: cs.display };
    });"""
assert old_grid in s
s = s.replace(old_grid, new_grid, 1)

old_ret = """    return { faceW: FACEW, pageW: mm(pr.width), faces: faces,
             grids: grids, outers: others };"""
new_ret = """    return { faceW: FACEW, pageW: mm(pr.width), faces: faces,
             grids: grids, outers: others, inners: inners, lines: lines };"""
assert old_ret in s
s = s.replace(old_ret, new_ret, 1)

old_log = "    console.log('\\n.as-choice-grid:');"
new_log = """    console.log('\\n.as-choice-inner:');
    d.inners.forEach(function (o) {
      console.log('   %s -> %s (w %s) pos=%s ml=%s', o.left, o.right, o.w, o.pos, o.ml);
    });
    console.log('\\n.as-choice-line:');
    d.lines.forEach(function (o) {
      console.log('   %s -> %s (w %s) pos=%s disp=%s', o.left, o.right, o.w, o.pos, o.disp);
    });
    console.log('\\n.as-choice-grid:');"""
assert old_log in s
s = s.replace(old_log, new_log, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
