import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── geometry：innerPadX 不再用作 CSS 内边距，改为「黑框线到网格」的几何量 ──
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()
old = """    var innerPadX = r3(p.blockW / 2);                    // 黑框内边距
    var outerPadX = r3(p.padX - outerLeft - 2 * BORDER - innerPadX);  // 红框内边距"""
new = """    /* 黑框线 → 网格左缘的几何量。**不用作 CSS padding**：
       padding 会被浏览器吸附到整设备像素，红框/黑框两层叠起来能把网格
       推偏 0.08mm，而顶部定标块是绝对定位的精确 mm，于是两者错开。
       网格的水平位置统一由 margin-left 给出（margin 不吸附）。 */
    var innerPadX = r3(p.blockW / 2);
    var outerPadX = r3(p.padX - outerLeft - 2 * BORDER - innerPadX);  // 红框内边距"""
if old not in s:
    print('!! geo anchor 1 not found'); sys.exit(1)
s = s.replace(old, new, 1)

# 网格左边框盒 = outerLeft + 红框线 + 红框内边距 + 黑框线
old = """    /* ⚠ 红框左右内边距必须落在**整设备像素**上。
       3.725mm = 14.0787px，浏览器布局时会把它吸附到 14px，
       于是红框内容盒比计算值窄 0.075mm，里面的黑框、网格、
       进而每一个气泡都跟着左移 0.075mm —— 顶部定标块（绝对定位、
       用精确 mm）就与气泡列心错开这 0.075mm。
       先把 mm 吸附到整像素，再让 CSS 与 builder 都用这个值，
       两者就一致了（误差归零，而不是留在容差里）。 */
    var outerPadXSnap = snapMM(outerPadX);
    return {
      border: BORDER,
      innerPadX: innerPadX,
      outerPadX: outerPadXSnap,
      /* 未吸附的原值，仅供诊断对照 */
      outerPadXRaw: outerPadX,"""
new = """    /* 红框左右内边距：吸附到整设备像素，减少一次吸附误差。
       它只影响红框到黑框这一段（黑框内容不参与定位），
       真正的「网格 ↔ 定标块」对齐由 builder 的 margin-left 保证。 */
    var outerPadXSnap = snapMM(outerPadX);
    return {
      border: BORDER,
      innerPadX: innerPadX,
      outerPadX: outerPadXSnap,
      /* 黑框**边框盒**左缘（相对面左缘）。网格的 margin-left 由它反推。 */
      innerBorderLeft: r3(outerLeft + BORDER + outerPadXSnap),
      /* 未吸附的原值，仅供诊断对照 */
      outerPadXRaw: outerPadX,"""
if old not in s:
    print('!! geo anchor 2 not found'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('geometry ok')

# ── theme：黑框不再用 padding 定位 ──────────────────────────────────────
p = 'js/theme.js'
s = io.open(p, encoding='utf-8').read()
old = """    el.style.setProperty('--inner-pad-x', off.innerPadX + 'mm');
    el.style.setProperty('--inner-pad-y', off.innerPadY + 'mm');"""
new = """    /* 黑框左右内边距置 0：网格水平位置改由 margin-left 给（见 builders/choice.js）。
       padding 会被浏览器吸附到整设备像素，两层 padding 叠加会把网格推偏
       ~0.08mm，与绝对定位的定标块错开。margin 不吸附，可以精确落位。 */
    el.style.setProperty('--inner-pad-x', '0mm');
    el.style.setProperty('--inner-pad-y', off.innerPadY + 'mm');"""
if old not in s:
    print('!! theme anchor not found'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('theme ok')
