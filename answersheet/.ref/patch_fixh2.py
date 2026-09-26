import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, tag
    s = s.replace(old, new, 1)
    n += 1
    print('  ok:', tag)

# ① 常量 FRAME_TOP_GAP
rep("""    var frameH = G.frameHeight(p, PAGE_H);""",
"""    /* 红框上缘与页眉之间必须留的净空（mm）。首页页眉底 ≈ 82.95，
       加上它就是首页红框上缘 84.95。 */
    var FRAME_TOP_GAP = 2.0;
    var frameH = G.frameHeight(p, PAGE_H);""", 'FRAME_TOP_GAP')

# ② base：首页 max(几何下限, 页眉底+净空)；续排面 = 几何下限
rep("""      var base = F_TOP;""",
"""      var base = !isFirst ? F_TOP
        : Math.max(F_TOP, r3((o.chromeFirst || 0) + FRAME_TOP_GAP));""",
    'base 收紧')

# ③ subjBoxBottom
rep("""      faces.push({
        first: isFirst,
        body: body,""",
"""      /* 本面非选择题红框的**框底**（mm，从纸顶量）：
         · 没有非答题区 → 滚到红框固定下缘 F_BOT；
         · 要画非答题区 → 收到非答题区顶（两条框首尾相接）。
         app.js 拿它减 boxTop 得到框体高度，**写死**在 .as-subject-outer 上
         —— 这样框底不会因为表格 sub-pixel 取整而短 0.5~1.4mm，
         多出来的空白自然落在黑框内部底部（用户明确允许「答题区可以留白」）。 */
      var subjBoxTop = null;
      body.forEach(function (b) {
        if (b.kind === 'subj' && subjBoxTop === null) subjBoxTop = b.boxTop;
      });
      var subjBoxBottom = F_BOT;
      if (noAnswer && subjBoxTop !== null) {
        subjBoxBottom = r3(Math.max(subjBoxTop, F_BOT - rest));
      }

      faces.push({
        first: isFirst,
        body: body,""", 'subjBoxBottom')

rep("""        stretch: stretch,
        rest: rest,""",
"""        stretch: stretch,
        subjBoxBottom: subjBoxBottom,
        rest: rest,""", 'face 记录')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
