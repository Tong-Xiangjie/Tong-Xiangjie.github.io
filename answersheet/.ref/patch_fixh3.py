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

# ── paginator：去掉刚才塞进去的 boxBottoms 草稿 ───────────────────────
rep('js/paginator.js',
"""    /* 每面每条框的 boxTop（供 app.js 写死框体高度用）。
       一个面可能有两条框：选择题一条、非选择题一条，它们各自独立计算
       —— 高度不是全局一个数，而是「本面该条框的下缘」。 */
    var boxBottoms = {};""", '', '去掉 boxBottoms 草稿')

rep('js/paginator.js',
"""      var base = Math.max(F_TOP, r3((o.chromeFirst || 0) + FRAME_TOP_GAP));""",
"""      var base = !isFirst ? F_TOP
        : Math.max(F_TOP, r3((o.chromeFirst || 0) + FRAME_TOP_GAP));""",
    'paginator base 收紧')

# ── 非选择题块：给出「框底」—— app.js 用它写死 .as-subject-outer 高度 ──
rep('js/paginator.js',
"""      faces.push({
        first: isFirst,
        body: body,""",
"""      /* 本面非选择题红框的**框底**（mm，从纸顶量）。
         = 滚到红框固定下缘 F_BOT；
         = 若本面还要画非答题区，则框底收到非答题区顶（两条框首尾相接）。
         app.js 拿它减 boxTop 得到框体高度，**写死**在 .as-subject-outer 上
         —— 这样框底不会因为表格 sub-pixel 取整而短半毫米到一毫米，
         多出来的空白自然落在黑框内部底部（用户明确允许「答题区可以留白」）。 */
      var subjBoxTop = null;
      body.forEach(function (b) { if (b.kind === 'subj' && subjBoxTop === null) subjBoxTop = b.boxTop; });
      var subjBoxBottom = F_BOT;
      if (noAnswer && subjBoxTop !== null) {
        subjBoxBottom = r3(Math.max(subjBoxTop, F_BOT - rest));
      }

      faces.push({
        first: isFirst,
        body: body,""", 'subjBoxBottom')

rep('js/paginator.js',
"""        stretch: stretch,
        rest: rest,""",
"""        stretch: stretch,
        subjBoxBottom: subjBoxBottom,
        rest: rest,""", 'face 记录 subjBoxBottom')

io.open('js/paginator.js', 'w', encoding='utf-8', newline='').write(
    io.open('js/paginator.js', encoding='utf-8').read())
print('total', n)
