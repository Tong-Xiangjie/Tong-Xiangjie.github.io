import io, sys
sys.stdout.reconfigure(encoding='utf-8')
p = 'css/card.css'
s = io.open(p, encoding='utf-8').read()

old_comment = """/* 缺考框：左缘与左侧定标带列心对齐。
   ⚠ 包含块是 .as-note-bottom（left: 8mm，即相对注意事项框 8mm），
     不是 .as-note。要让框心落在定标带列心（相对版心左缘 = −3.725mm），
     相对底栏左缘的偏移就是 −3.725 − 8 = −11.725mm。
     写成 −3"""
i = s.find(old_comment)
print('comment found at', i)
if i > 0:
    j = s.find('*/', i)
    print('----- existing block -----')
    print(s[i:j+2])

old_rule_comment = """/* .as-check-box 是 .as-note 的直接子层，包含块 = .as-note 的**内边距盒**，
   内边距盒左缘 = padX + 1px（12.7 + 0.2646 = 12.9646mm）。
   红框外缘左 = cornerInsetX + blockW/2 + markGap = 14.005mm，故
     left = 14.005 − 12.9646 = 1.0404mm
   ⚠ 改 preset 的 markGap / blockW / cornerInsetX / padX 时这里要跟着改。
   纵向 top 由 builder 按同一套行心算出，与左侧定标块共线。 */"""
k = s.find(old_rule_comment)
print('\nrule comment found at', k)
