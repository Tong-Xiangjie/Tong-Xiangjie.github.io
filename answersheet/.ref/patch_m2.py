import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()
n = 0
def rep(old, new, tag):
    global s, n
    assert old in s, 'MISS: ' + tag
    s = s.replace(old, new, 1); n += 1; print('  ok:', tag)

# ① planBlocks：h 由「整段高」改成「段的行盒开销」，语义与分页器一致
rep("""        lines: it.lines,
        lineH: it.lineH,
        h: Subject.itemHeight(it.lines, it.lineH)
      });""",
"""        lines: it.lines,
        lineH: it.lineH,
        /* 一段非选择题的**行盒开销**（不含答案行本身）= itemHeight − lines×lineH
           = HEAD_H + 2×cellPad + ROW_OVERHEAD。分页器按 h + lines×lineH 算段高。 */
        h: Subject.headOverhead()
      });""", 'planBlocks h 语义')

# ② 本面第一段还要加「红框顶 → 表格顶」的固定装饰
rep("""        /* 本段占高：itemHeight 已经是「题头 + 作答区 + 上下内边距 + 表格余量」
           的**整段**高（含表格自己的边框），所以这里就是它本身，不再加
           SUBJ_BOX_CHROME（那会重复计数 6.879mm/段）。 */
        var baseH = r3(it.h + SUBJ_ITEM_PITCH);""",
"""        /* 段高 = 行盒开销 + 答案行 + 每段固定的块级推进量。
           baseH 里再加一次 SUBJ_BOX_CHROME 当且仅当这是本面第一段
           （表格顶从「红框顶 + 装饰」开始；后续段紧接上一段）。 */
        var baseH = r3(it.h + SUBJ_ITEM_PITCH +
                       (boxTopSeg ? SUBJ_BOX_CHROME : 0));""", 'baseH 含 per-face chrome')

# ③ 自然底不再单独加 BOX_CHROME（已在 subjCH 里）
rep("""        subjNaturalBottom = r3(subjBoxTop + subjCH + stretch);""",
"""        subjNaturalBottom = r3(subjBoxTop + subjCH + stretch);""", '自然底确认')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('paginator', n)

# ④ subject.js 增加 headOverhead()
P2 = 'js/builders/subject.js'
s2 = io.open(P2, encoding='utf-8').read()
old = """  /** 「非选择题（提示：…）」栏目头占高（mm）= 自身高 + 下间距 */"""
new = """  /** 一段非选择题的**行盒开销**（不含答案行）= 题头 + 上下单元格内边距 + 行盒余量。
   *  ⚠ 分页器按 `headOverhead() + 行数 × lineH` 算段高；它与 itemHeight 必须
   *    同源，否则容量会漂。 */
  function headOverhead() {
    return round(HEAD_H + 2 * cellPad() + ROW_OVERHEAD);
  }

  /** 「非选择题（提示：…）」栏目头占高（mm）= 自身高 + 下间距 */"""
assert old in s2
s2 = s2.replace(old, new, 1)
s2 = s2.replace("""    itemHeight: itemHeight,""", """    itemHeight: itemHeight,
    headOverhead: headOverhead,""", 1)
io.open(P2, 'w', encoding='utf-8', newline='').write(s2)
print('  ok: headOverhead')
