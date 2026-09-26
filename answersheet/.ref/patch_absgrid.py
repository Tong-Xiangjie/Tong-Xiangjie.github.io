import io, sys
sys.stdout.reconfigure(encoding='utf-8')

p = 'js/builders/choice.js'
s = io.open(p, encoding='utf-8').read()

old = """    /* 两个 margin 都吸附到整设备像素：Chrome 会把非整像素的 margin 吸附，
       不吸附就会留下 0.075mm 的系统偏移（实测）。吸附后误差归零。 */
    var innerMarginLeft = G.snapMM(off.innerBorderLeft - off.outerLeft - off.border);
    var gridMarginLeft = G.snapMM(firstColCx - p.blockW / 2 - off.innerBorderLeft - off.border);"""
new = """    var innerMarginLeft = G.r3(off.innerBorderLeft - off.outerLeft - off.border);
    /* 网格用**绝对定位 + left** 精确落位：left 写的是精确 mm，
       而 margin/padding 会被 Chrome 吸附到整设备像素（实测残留 0.075mm）。
       .as-choice-inner 是 position:relative，left 相对它的内边距盒。 */
    var gridLeftExact = G.r3(firstColCx - p.blockW / 2);"""
if old not in s:
    print('!! anchor 1 missing'); sys.exit(1)
s = s.replace(old, new, 1)

old2 = "    var gridStyle = ' style=\"margin:' + gridMarginTop + 'mm 0 0 ' + gridMarginLeft + 'mm\"';"
new2 = ("    var gridStyle = ' style=\"position:absolute;left:' + gridLeftExact +\n"
        "                    'mm;top:0\"';")
if old2 not in s:
    print('!! anchor 2 missing'); sys.exit(1)
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
