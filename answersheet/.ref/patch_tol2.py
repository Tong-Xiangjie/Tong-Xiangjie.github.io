import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = '.ref/dom_verify.mjs'
s = io.open(p, encoding='utf-8').read()

old = """  const rowMatch = lmYs.every(y => allRowCenters.some(rc => Math.abs(rc-y)<tol));
  log(`     每个左侧块心都落在某个行心(题号/气泡)上: ${rowMatch ? 'OK' : '** MISMATCH **'}`);"""
new = """  /* 纵向同样受盒模型取整影响：A3 的面是按 faceW 缩放排版的（块宽 4.0→3.998mm），
     网格行心与绝对定位的定标块会差 0.04mm 量级。用同一个盒链容差。 */
  const rowMatch = lmYs.every(y => allRowCenters.some(rc => Math.abs(rc-y)<tolBoxChain));
  const worstRow = lmYs.length ? Math.max.apply(null, lmYs.map(y =>
    Math.min.apply(null, allRowCenters.map(rc => Math.abs(rc - y))))) : 0;
  log(`     每个左侧块心都落在某个行心(题号/气泡)上: ${rowMatch ? 'OK' : '** MISMATCH **'}` +
      `  (最大偏差 ${Math.round(worstRow*1000)/1000}mm，容差 ${tolBoxChain}mm)`);"""
if old not in s:
    print('!! rowMatch anchor missing'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
