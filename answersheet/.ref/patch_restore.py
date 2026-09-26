import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── geometry：恢复「红框 padding 吸附到整像素 + innerPadX 参与定位」 ──────
p = 'js/geometry.js'
s = io.open(p, encoding='utf-8').read()
old = """    /* ⚠ 红框的**左右**内边距一律为 0，黑框的水平位置改由它自己的
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
new = """    /* ⚠ 红框左右内边距吸附到**整设备像素**。
       3.725mm = 14.0787px，浏览器布局时会吸附到 14px，红框内容盒因此比
       计算值窄 0.075mm，里面的黑框、网格、每个气泡都跟着左移。
       先吸附到整像素再交给 CSS，误差从 0.075mm 降到 0.02mm 量级。
       彻底归零需要在渲染后回读实测偏移做一次补偿，见 app.js 的
       alignChoiceGrid()（若后续要做像素级归零，从那里下手）。 */
    var outerPadXSnap = snapMM(outerPadX);
    return {
      border: BORDER,
      innerPadX: innerPadX,
      outerPadX: outerPadXSnap,
      /* 黑框**边框盒**左缘（相对面左缘） */
      innerBorderLeft: r3(outerLeft + BORDER + outerPadXSnap),
      outerPadXNominal: outerPadXSnap,
      outerPadXRaw: outerPadX,"""
if old not in s:
    print('!! geo anchor missing'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('geometry ok')

# ── theme：恢复黑框内边距 ────────────────────────────────────────────────
p = 'js/theme.js'
s = io.open(p, encoding='utf-8').read()
old = """    /* 黑框左右内边距置 0：网格水平位置改由 margin-left 给（见 builders/choice.js）。
       padding 会被浏览器吸附到整设备像素，两层 padding 叠加会把网格推偏
       ~0.08mm，与绝对定位的定标块错开。margin 不吸附，可以精确落位。 */
    el.style.setProperty('--inner-pad-x', '0mm');
    el.style.setProperty('--inner-pad-y', off.innerPadY + 'mm');"""
new = """    el.style.setProperty('--inner-pad-x', off.innerPadX + 'mm');
    el.style.setProperty('--inner-pad-y', off.innerPadY + 'mm');"""
if old not in s:
    print('!! theme anchor missing'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('theme ok')

# ── builder：恢复 padding 链 + 相对 margin ──────────────────────────────
p = 'js/builders/choice.js'
s = io.open(p, encoding='utf-8').read()
old = """    /* 横向定位全走 margin（不吸附）：
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
    /* 网格用**绝对定位 + left** 精确落位：left 写的是精确 mm，
       而 margin/padding 会被 Chrome 吸附到整设备像素（实测残留 0.075mm）。
       .as-choice-inner 是 position:relative，left 相对它的内边距盒。 */
    var gridLeftExact = G.r3(firstColCx - p.blockW / 2);"""
new = """    /* 横向：黑框内边距由 CSS 变量给出（--inner-pad-x），
       网格左缘 = 首列列心 − 半格，故 margin-left = 两者之差。
       这里**不**做 snapMM：Chrome 对 margin 按小数生效，
       吸附反而会引入 ~0.13mm 偏移。 */
    var colCenters = o.colCenters || [];
    var firstColCx = colCenters.length
      ? colCenters[0]
      : G.r3(off.gridLeft + p.blockW / 2);
    var gridMarginLeft = G.r3(firstColCx - p.blockW / 2 - off.innerBorderLeft - off.border);"""
if old not in s:
    print('!! builder anchor 1 missing'); sys.exit(1)
s = s.replace(old, new, 1)

old2 = """    var innerStyle = ' style="height:' + innerH + 'mm;padding:0;margin-left:' +
                     innerMarginLeft + 'mm"';"""
new2 = """    var innerStyle = ' style="height:' + innerH + 'mm;padding:0"';"""
if old2 not in s:
    print('!! builder anchor 2 missing'); sys.exit(1)
s = s.replace(old2, new2, 1)

old3 = ("    var gridStyle = ' style=\"position:absolute;left:' + gridLeftExact +\n"
        "                    'mm;top:0\"';")
new3 = "    var gridStyle = ' style=\"margin:' + gridMarginTop + 'mm 0 0 ' + gridMarginLeft + 'mm\"';"
if old3 not in s:
    print('!! builder anchor 3 missing'); sys.exit(1)
s = s.replace(old3, new3, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('builder ok')
