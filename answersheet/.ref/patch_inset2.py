import io, sys
sys.stdout.reconfigure(encoding='utf-8')
n = 0
def rep(path, old, new, tag):
    global n
    s = io.open(path, encoding='utf-8').read()
    assert old in s, tag + ' :: ' + path
    io.open(path, 'w', encoding='utf-8', newline='').write(s.replace(old, new, 1))
    n += 1
    print('  ok:', tag)

# paginator 注释口径更新（内缩）
s = io.open('js/paginator.js', encoding='utf-8').read()
old = """    /* 红框可覆盖范围 —— 用户 2026 指定「上缘可往上拉 0.7 个定位点高、
       下缘可往下拉 0.7 个」。A_TOP/A_BOT 仍是**答题区**（内容不许越过），
       F_TOP/F_BOT 是**红框**的硬边界（框可以比内容区多出 0.7×cornerH）。 */"""
new = """    /* 红框的固定上下缘 —— 用户 2026 最终口径：
       「上面往下 0.7 个定位点高度，下面往上 0.7」，即相对答题区**内缩**
       0.7×cornerH（A4 = 2.961）。
         F_TOP = A_TOP + 2.961 = 16.076
         F_BOT = A_BOT − 2.961 = 280.924
         frameHeight = F_BOT − F_TOP = 264.848（常量，与页眉/题量无关） */"""
assert old in s
io.open('js/paginator.js', 'w', encoding='utf-8', newline='').write(s.replace(old, new, 1))
n += 1
print('  ok: paginator 注释')

# app.js fitFrames 目标下界
rep('js/app.js',
"""    /* 红框下缘的目标位置 = 红框可达的最低点。
       ⚠ 用户 2026：红框下缘可以再往下拉 0.7 个定位点高
         （= geometry.frameBottomLimit = answerBottom + 0.7×cornerH），
         而页脚已固定在下方定位点中心的高度、与红框无关，所以这里**不再**
         扣页脚块。历史口径是 answerBottom − 5.0 − 0.5 = 278.385。 */
    var bottomLimit = G.frameBottomLimit(preset, paper.h);""",
"""    /* 红框下缘的目标位置 —— 用户 2026 最终口径：
       红框相对答题区**内缩** 0.7 个定位点高，
         frameBottomLimit = answerBottom − 0.7×cornerH = 280.924（A4）。
       高度写死（geometry.frameHeight = 264.848），不随页眉/题量变。
       历史口径：answerBottom − 5.0 − 0.5 = 278.385（扣页脚），
                 之后一度改成 answerBottom + 0.7×cornerH = 286.846（外扩）。 */
    var bottomLimit = G.frameBottomLimit(preset, paper.h);""", 'app 目标下界')

# app.js 空白面注释里的「外扩」措辞
rep('js/app.js',
"""      /* ⚠ 用**红框可达范围**，不是答题区上下界 —— 用户 2026 允许红框
         上下各外扩 0.7 个定位点高（frameTopLimit / frameBottomLimit），
         非答题区就是一块红框，所以它也该顶到这个范围。
         历史口径是 answerTop（13.114），比红框上限低 2.961mm。 */""",
"""      /* ⚠ 用**红框的固定上下缘**，不是答题区上下界 —— 红框相对答题区
         内缩 0.7 个定位点高（frameTopLimit / frameBottomLimit），
         非答题区就是一块红框，所以它也用这个范围。 */""", 'app 空白面注释')

print('total', n)
