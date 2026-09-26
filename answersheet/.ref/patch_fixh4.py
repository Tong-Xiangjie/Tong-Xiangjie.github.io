import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/app.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, tag
    s = s.replace(old, new, 1)
    n += 1
    print('  ok:', tag)

# ── 把框体高度写死 ─────────────────────────────────────────────────────
rep("""    if (subjItems.length) {""",
"""    /* ── 框体高度写死 ────────────────────────────────────────────────
       用户 2026：「你不如把这个高度写死了」。
       分页器给出的 subjBoxBottom 是本面非选择题红框的**目标框底**，
       这里把它换算成框体高度写死在 .as-subject-outer 上。

       为什么必须写死：黑框表格每多一行，浏览器按 device px（0.2646mm）
       吸附盒高，累计误差让红框底短 0.5~1.4mm（实测 12 选择+2 题短 0.854、
       0 选择+2 题短 1.337）。定高之后框底由构造保证，空白落在黑框内部底部
       —— 用户明确允许「答题区可以留白」。 */
    var subjFrameH = 0;
    if (subjItems.length && face.subjBoxBottom > 0) {
      subjFrameH = G.r3(face.subjBoxBottom - subjItems[0].boxTop);
      if (subjFrameH < 0) subjFrameH = 0;
    }
    if (subjItems.length) {""", 'subjFrameH 计算')

rep("""      html += '<div class="as-subjective" style="top:' + subjItems[0].boxTop + 'mm">' +
              Subject.render(subjItems.map(function (b) {""",
"""      html += '<div class="as-subjective" style="top:' + subjItems[0].boxTop + 'mm">' +
              Subject.render(subjItems.map(function (b) {""", 'noop')

# 给 Subject.render 传 frameH
rep("""                /* 下拉量加在最后一行的答题区上（黑框内变高） */
                tailExtra: stretch
              }) +
              '</div>';""",
"""                /* 下拉量加在最后一行的答题区上（黑框内变高） */
                tailExtra: stretch,
                /* 框体定高（mm）。0 表示不写死，交给内容撑。 */
                frameH: subjFrameH
              }) +
              '</div>';""", 'Subject.render frameH')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
