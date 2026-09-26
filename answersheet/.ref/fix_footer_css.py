import io
import sys

sys.stdout.reconfigure(encoding='utf-8')
p = 'css/card.css'
s = io.open(p, encoding='utf-8').read()

# 645 行结尾多了一个 */，把后面那段本该属于注释的文字变成了无效 CSS，
# 直接导致 .as-footer 规则整条被丢弃（页脚因此没有绝对定位，跑到纸顶 y=0）。
bad = '     放这里会全卡重复印。那句话在非选择题红框与黑框之间（.as-subject-page-tip）。 */\n'
assert bad in s, 'bad marker not found'
s = s.replace(bad, '     放这里会全卡重复印。那句话在非选择题红框与黑框之间（.as-subject-page-tip）。\n', 1)

# 顺带把已经不再成立的描述改掉：页脚现在只剩页码行
old = '       该句            y 274.28 → 278.17   （在**非选择题红框下沿 273.30 下方 1mm**）\n'
assert old in s, 'old sentence line not found'
s = s.replace(old, '', 1)

old2 = '     所以页脚块的**首行文字顶** = 274.28mm，整块底 ≈ 284.1mm。\n'
assert old2 in s, 'old2 not found'
s = s.replace(old2, '     页脚现在只剩页码行，整块底 ≈ 284.1mm。\n', 1)

old3 = "     原来 bottom:4mm 把首行推到 283.16mm —— 比参照件低 9mm，\n     和页码挤在一起，看着就像「这句话跑到页脚最底下去了」。\n"
assert old3 in s, 'old3 not found'
s = s.replace(old3, '     原来 bottom:4mm 把文字推到 283.16mm —— 比参照件低 9mm。\n', 1)

old4 = '     bottom = 纸高 − 284.1 ≈ 12.9mm（A4/A3 同值，两行高度一样）。 */\n'
assert old4 in s, 'old4 not found'
s = s.replace(old4, '     bottom = 纸高 − 284.1 ≈ 12.9mm（A4/A3 同值）。 */\n', 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('css comment repaired')
