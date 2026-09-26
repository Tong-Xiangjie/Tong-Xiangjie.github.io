import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── geometry：红框左右内边距置 0，改用「黑框 margin-left」定位 ────────────
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()
old = """    /* 红框左右内边距：吸附到整设备像素，减少一次吸附误差。
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
new = """    /* ⚠ 红框的**左右**内边距一律为 0，黑框的水平位置改由它自己的
       margin-left 给出（builder 内联）。
       原因：padding 会被浏览器吸附到整设备像素，红框 + 黑框两层 padding
       叠起来能把网格推偏 0.08~0.22mm，而顶部定标块是绝对定位的精确 mm，
       两者就错开了。margin **不**吸附（实测按小数生效），可以精确落位。
       纵向仍用 padding：纵向位置由分页器按精确 mm 算好，且没有这一层的对齐要求。 */
    var outerPadXSnap = snapMM(outerPadX);
    return {
      border: BORDER,
      innerPadX: innerPadX,
      outerPadX: 0,
      /* 黑框**边框盒**左缘（相对面左缘）—— builder 用 margin-left 把黑框推到这里 */
      innerBorderLeft: r3(outerLeft + BORDER + outerPadX),
      /* 原来的内边距数值，仅作诊断/兜底 */
      outerPadXNominal: outerPadXSnap,
      outerPadXRaw: outerPadX,"""
if old not in s:
    print('!! geo anchor not found'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('geometry ok')

# ── builders/choice.js：黑框加 margin-left；网格 margin-left 重新反推 ─────
p = 'js/builders/choice.js'
s = io.open(p, encoding='utf-8').read()
old = """    /* 横向：黑框的左右内边距已置 0（见 theme.js），
       所以网格左边框盒 = 黑框边框盒左缘 + margin-left。
       网格左缘 = 首列列心 − 半格，故 margin-left = 两者之差。
       这里**不**做 snapMM：Chrome 对 margin 不吸附到整像素（实测按小数生效），
       吸附反而会引入 ~0.13mm 偏移。 */
    var cbLeft = G.r3(off.innerBorderLeft);
    var colCenters = o.colCenters || [];
    var firstColCx = colCenters.length
      ? colCenters[0]
      : G.r3(off.gridLeft + p.blockW / 2);
    var gridMarginLeft = G.r3(firstColCx - p.blockW / 2 - cbLeft);"""
new = """    /* 横向定位全走 margin（不吸附）：
         黑框边框盒左缘 = 红框边框盒左缘 + 红框线 + 黑框 margin-left
       红框左右 padding 为 0（见 geometry.boxOffsets），所以
         黑框 margin-left = innerBorderLeft − outerLeft − 红框线
       网格左边框盒 = 黑框边框盒左缘 + 黑框线 + 网格 margin-left
       网格左缘 = 首列列心 − 半格，故
         网格 margin-left = (首列列心 − 半格) − innerBorderLeft − 黑框线
       这里**不**做 snapMM：Chrome 对 margin 不吸附（实测按小数生效），
       吸附反而会引入 ~0.13mm 偏移。 */
    var colCenters = o.colCenters || [];
    var firstColCx = colCenters.length
      ? colCenters[0]
      : G.r3(off.gridLeft + p.blockW / 2);
    var innerMarginLeft = G.r3(off.innerBorderLeft - off.outerLeft - off.border);
    var gridMarginLeft = G.r3(firstColCx - p.blockW / 2 - off.innerBorderLeft - off.border);"""
if old not in s:
    print('!! builder anchor 1 not found'); sys.exit(1)
s = s.replace(old, new, 1)

old = """    var innerStyle = ' style="height:' + innerH + 'mm;padding:0"';"""
new = """    var innerStyle = ' style="height:' + innerH + 'mm;padding:0;margin-left:' +
                     innerMarginLeft + 'mm"';"""
if old not in s:
    print('!! builder anchor 2 not found'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('builder ok')
