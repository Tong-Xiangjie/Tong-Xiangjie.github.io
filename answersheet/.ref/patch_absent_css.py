import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'css/card.css'
s = io.open(p, encoding='utf-8').read()

old = """/* 缺考框：左缘与左侧定标带列心对齐。
   ⚠ 包含块是 .as-note-bottom（left: 8mm，即相对注意事项框 8mm），
     不是 .as-note。要让框心落在定标带列心（相对版心左缘 = −3.725mm），
     相对底栏左缘的偏移就是 −3.725 − 8 = −11.725mm。
     写成 −3.725 会让缺考框右移 8mm，与左侧定标块错开一整个身位。 */"""

new = """/* 缺考框：**横向**对齐顶部定标带的第 3 个小方块（用户指定）。
   ⚠ left / top 都由 js/builders/page.js 的 notesBox() **内联**写入
     （见 absentBoxLeft()），下面这条只是没有 JS 时的兜底值。
     改 preset 的 blockW / cornerInsetX / cornerW / topBandCount / padX，
     或改 TOP_BAND_ABSENT_INDEX 时，兜底值会失效 —— 别依赖它，
     要看实测请跑 `node .ref\\absent_probe.cjs A4`。
   ⚠ 包含块是 .as-note 的**内边距盒**，不是 .as-note-bottom；
     把框放进底栏会让水平基准变成底栏（多偏 8mm 且越出红框）。 */"""

assert old in s, 'comment not found'
s = s.replace(old, new, 1)

# 兜底 left 从 1.0404 改成第 3 块对应的值（A4: 16.297）
s = s.replace("  left: 1.0404mm;\n  width: var(--block-w);",
              "  left: 16.297mm;   /* A4 兜底：第 3 个顶部小方块块心 29.262 − blockW/2 − 12.9646 */\n  width: var(--block-w);", 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
