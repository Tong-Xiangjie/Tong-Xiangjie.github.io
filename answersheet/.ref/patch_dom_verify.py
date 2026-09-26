import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
p = '.ref/dom_verify.mjs'
s = io.open(p, encoding='utf-8').read()

old = """  if (tm && gridBubbles.length) {
    const colCenters = [...new Set(gridBubbles.map(b => b.cx))].sort((a,b)=>a-b);
    log(`  ${'顶部块心x == 某气泡列心x'.padEnd(52)} ${tm.cx} vs ${colCenters[0]}  ` +
        `${Math.abs(tm.cx - colCenters[0]) < tolBoxChain ? 'OK' : '** MISMATCH **'}` +
        `  (容差 ${tolBoxChain}mm，盒模型取整)`);"""
new = """  if (tm && gridBubbles.length) {
    const colCenters = [...new Set(gridBubbles.map(b => b.cx))].sort((a,b)=>a-b);
    /* 顶部定标块心必须与**某个**气泡列心共线（不再假定是第一个 ——
       preset.markShiftX/gridShiftX 会把整列右移若干个身位）。
       取最近的列心比。 */
    const nearest = colCenters.reduce((a,b) =>
      Math.abs(b-tm.cx) < Math.abs(a-tm.cx) ? b : a, colCenters[0]);
    log(`  ${'顶部块心x == 某气泡列心x'.padEnd(52)} ${tm.cx} vs ${nearest}  ` +
        `${Math.abs(tm.cx - nearest) < tolBoxChain ? 'OK' : '** MISMATCH **'}` +
        `  (容差 ${tolBoxChain}mm，盒模型取整)`);"""
assert old in s, 'a1'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
