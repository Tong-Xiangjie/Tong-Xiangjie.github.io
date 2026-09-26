import io, sys
sys.stdout.reconfigure(encoding='utf-8')
P = 'js/paginator.js'
s = io.open(P, encoding='utf-8').read()

old = """  var SUBJ_BOX_CHROME = r3(SUBJ_CHROME.padY + SUBJ_CHROME.headerH +
                           SUBJ_CHROME.headerGap + SUBJ_CHROME.tipGap +
                           SUBJ_CHROME.tipH + SUBJ_CHROME.tipGap +
                           SUBJ_CHROME.padYBottom);"""
assert old in s, 'SUBJ_BOX_CHROME'
new = old + """

  /* 单题的**固定**占高修正（mm/题）。
     paginator 拿到的 it.h 是 subject.itemHeight() 算的，实测比 DOM 矮
     1.048mm（ROW_OVERHEAD 1.039 与实际渲染的差）；再加上红框上提示/下提示/
     下内边距在真实渲染里是**叠加**的，合计每题少算约 1.88mm。
     ⚠ 这个数是 .ref/newmodel.cjs 反查出来的：16 行时游标 267.553，
       要让红框下缘正好落在 283.885 需要 269.447，差 1.894，扣掉行高那
       16×0.0008=0.013，取 1.881。
     ⚠ 不要凭感觉改；改完必须用探针核对「下角标上缘 − 红框下缘 ≈ 0」。 */
  var SUBJ_ITEM_FIX = 1.881;"""
s = s.replace(old, new, 1)

old_f = "          var fixedH = r3(it.h - it.lines * it.lineH);"
assert old_f in s, 'fixedH'
s = s.replace(old_f,
"""          /* 每题固定占高 = itemHeight − 行数×行高，再补上实测修正 */
          var fixedH = r3(it.h - it.lines * it.lineH + SUBJ_ITEM_FIX);""", 1)

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('paginator calibrated')
