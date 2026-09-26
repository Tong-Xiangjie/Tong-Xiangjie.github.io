import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

rep("""          choiceLine += rows;
          cursor = r3(cursor + chromeTop + rows * choice.colH +
                      Math.max(0, rows - 1) * choice.lineGap + footTop);""",
"""          choiceLine += rows;
          /* 选择红框**真实**高度 = gridTop（红框顶→网格顶）
                                    + 网格高（含行间空档）
                                    + footTop（网格底→红框底）
             ⚠ 别用 chromeTop + gridH + footTop 去近似 chromeTop：
               chromeTop 与 footTop 里各含一道黑框线，而 footTop 已经
               含了「网格底→红框底」的全部量，重复加会把游标多推 3.9mm
               （实测 300 选择：游标 284.846 而红框底只有 280.062）。 */
          var gridH = r3(rows * choice.colH +
                         Math.max(0, rows - 1) * choice.lineGap);
          cursor = r3(cursor + chromeTop + gridH + footTop);""", 'choice 游标')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('total', n)
