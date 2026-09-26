import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
p = '.ref/dom_verify.mjs'
s = io.open(p, encoding='utf-8').read()

old = """      log(`     气泡列心(前6): ${colCenters.slice(0,6).join(', ')}`);
      const d = colCenters.slice(1,8).map((v,i)=>Math.round((v-colCenters[i])*1000)/1000);
      log(`     气泡列距: ${d.join(', ')}`);
    }"""

new = """      log(`     气泡列心(前6): ${colCenters.slice(0,6).join(', ')}`);
      const d = colCenters.slice(1,8).map((v,i)=>Math.round((v-colCenters[i])*1000)/1000);
      log(`     气泡列距: ${d.join(', ')}`);

      /* ── 顶部定标带的两条硬要求（用户指定）─────────────────────────
         ① 带子 = 气泡列 + 左右各多一个 → 块数 = 列数 + 2
         ② 第一列对齐**第二个**定位点                                        */
      const uniqueMarkX = [...new Set(D.topMarks.map(m => m.cx))].sort((a,b)=>a-b);
      ck('顶部定标块数 == 气泡列数 + 2', uniqueMarkX.length, colCenters.length + 2);
      log(`  ${'第一列 == 第二个定标块'.padEnd(52)} ` +
          `${colCenters[0]} vs ${uniqueMarkX[1]}  ` +
          `${Math.abs(colCenters[0] - uniqueMarkX[1]) < tolBoxChain ? 'OK' : '** MISMATCH **'}` +
          `  (容差 ${tolBoxChain}mm)`);
      log(`  ${'定标带最左块 < 第一列'.padEnd(52)} ` +
          `${uniqueMarkX[0]} < ${colCenters[0]}  ` +
          `${uniqueMarkX[0] < colCenters[0] ? 'OK' : '** MISMATCH **'}`);
      log(`  ${'定标带最右块 > 最后一列'.padEnd(52)} ` +
          `${uniqueMarkX.at(-1)} > ${colCenters.at(-1)}  ` +
          `${uniqueMarkX.at(-1) > colCenters.at(-1) ? 'OK' : '** MISMATCH **'}`);
    }"""

assert old in s, 'block not found'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('dom_verify updated')
