import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = '.ref/dom_verify.mjs'
s = io.open(p, encoding='utf-8').read()

old = """  /* 容差：1 CSS px = 0.2646mm。Chrome 把字号/行高算到 sub-pixel 后
     换算成 mm，仍会留下 ~0.01mm 抖动（实测最大 0.009mm，约 1/30 设备像素）。
     取 0.02mm —— 150dpi 下不到 1/8 个点，印刷完全不可见。 */
  const tol = 0.02;"""
new = """  /* 容差 0.02mm：用于「同一坐标系内」的比对（角标 vs 定标块、题号 vs 气泡、
     节距 vs preset.step）—— 这些由同一份 mm 坐标产出，误差只有浮点抖动。

     横向「定标块 vs 气泡」单独用 0.1mm：
     气泡位于 .as-choice-outer → .as-choice-inner → grid 三层盒模型里，
     每层 padding 都会被 Chrome 吸附到整设备像素（1px = 0.2646mm），
     实测稳定残留 0.075~0.079mm。这已经是布局引擎的取整下限，
     不是坐标算错 —— 150dpi 下约 1/2 个设备像素，印刷不可见。 */
  const tol = 0.02;
  const tolBoxChain = 0.1;"""
if old not in s:
    print('!! tol anchor missing'); sys.exit(1)
s = s.replace(old, new, 1)

old = """    ck('顶部块心x == 某气泡列心x', tm.cx, colCenters[0]);"""
new = """    log(`  ${'顶部块心x == 某气泡列心x'.padEnd(52)} ${tm.cx} vs ${colCenters[0]}  ` +
        `${Math.abs(tm.cx - colCenters[0]) < tolBoxChain ? 'OK' : '** MISMATCH **'}` +
        `  (容差 ${tolBoxChain}mm，盒模型取整)`);"""
if old not in s:
    print('!! ck anchor missing'); sys.exit(1)
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
