import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/app.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# paper 只在 renderAll 里，renderFaceBody 取不到 —— 用 C.PAPER 现取，
# 并从 preset 的键反查版式（preset 是 C.PRESETS.A4 / .A3 的同一个对象引用）。
rep("""      var subjBot = Math.min(face.subjBoxBottom,
                             G.frameBottomLimit(preset, paper.h));""",
"""      /* 纸高从 C.PAPER 现取（renderFaceBody 拿不到 renderAll 的 paper 局部量） */
      var paperH = (preset === C.PRESETS.A3) ? C.PAPER.A3.h : C.PAPER.A4.h;
      var subjBot = Math.min(face.subjBoxBottom,
                             G.frameBottomLimit(preset, paperH));""", 'paperH 取自 config')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
