import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# ① 三处 subj push 都补上内容高 h
rep("""              lines: 1, last: false
            });""",
"""              lines: 1, h: subjSegH(it, baseH, 1), last: false
            });""", 'push-1 带 h')

rep("""            lines: segLines, last: subjIdx === subj.length - 1
          });""",
"""            lines: segLines, h: subjSegH(it, baseH, segLines),
            last: subjIdx === subj.length - 1
          });""", 'push-2 带 h')

rep("""          lines: availLines, last: false
        });""",
"""          lines: availLines, h: subjSegH(it, baseH, availLines), last: false
        });""", 'push-3 带 h')

# ② 小工具
rep("""  /* 红框上缘与页眉之间必须留的净空 */
  var FRAME_TOP_GAP = 2.0;""",
"""  /* 红框上缘与页眉之间必须留的净空 */
  var FRAME_TOP_GAP = 2.0;

  /** 一段非选择题的内容高（mm）= 框体装饰（含栏目头/题头修正）+ 行数×行高。
   *  ⚠ 收口求「内容自然底」时必须读这个字段；三处 push 漏写 h 会让
   *    subjCH 恒为 0、subjBoxBottom 恒为 null，红框就永远拿不到定高（踩过）。 */
  function subjSegH(it, baseH, lines) {
    return r3(baseH + (lines || 0) * (it.lineH || 7.7));
  }""", 'subjSegH')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
