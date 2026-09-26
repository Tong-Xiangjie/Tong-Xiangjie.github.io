import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = '.ref/dom_verify.mjs'
s = io.open(p, encoding='utf-8').read()

old = """  const allRowCenters = [...new Set(rowCenters.concat(numRowCenters))].sort((a,b)=>a-b);"""
new = """  /* 缺考框所在的行也必须有左侧定标块，它不算「题号/气泡」行，
     但一样是合法的对齐目标 —— 漏掉它会把正确的块报成 MISMATCH。 */
  const specialRowCenters = (D.checkBoxes || []).map(cb => cb.cy);
  const allRowCenters = [...new Set(
    rowCenters.concat(numRowCenters).concat(specialRowCenters))].sort((a,b)=>a-b);"""
if old not in s:
    print('!! anchor not found'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
