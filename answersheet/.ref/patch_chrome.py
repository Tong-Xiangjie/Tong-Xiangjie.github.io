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

# ── ① 续排面不再印「xx　yy答题卡」整行标题 ────────────────────────────
rep('js/builders/page.js',
"""function chromeOther(meta, blank) {
    if (blank) return '';
    var line = [meta.title, meta.subject ? meta.subject + '答题卡' : '']
      .filter(Boolean).join('　');
    if (!line) return '';
    return '<div class="as-title" style="margin-top:' + CHROME.otherTop + 'mm">' +
           '<div class="as-title-sub" style="font-size:3.4mm">' +
           esc(line) + '</div>' +
           '</div>';
  }""",
"""function chromeOther(meta, blank) {
    /* 续排面（第 2 面起）的页眉 —— **什么都不印**。
     *
     * ⚠ 2026 修正：原来这里会印一行「xx　yy答题卡」，占掉 14+6 = 20mm
     *   （CHROME.otherTop / otherBottom）。而红框上缘现在可以上拉到
     *   frameTopLimit（A4 = 10.154），红框就直接盖住了那行字 ——
     *   实测面 2/3 的标题在 27.997..32.470，红框从 10.154 起，整行被吞。
     *
     *   用户在「凑偶数页 → 整面一个非答题区」时已经定了口径：
     *   空白面「页眉只留「第 N 面」」，而「第 N 面」就在**页脚**里
     *   （见 footer()：`科目　第 N 面（共 M 面）`）。
     *   ⇒ 续排面和空白面的页眉都应该是空的，所以这里统一返回 ''。
     *   整行标题只在**第 1 面**的 chromeFirst() 里印一次。 */
    return '';
  }""", 'chromeOther 清空')

# ── ② 空白凑偶面：非答题区也要顶到红框上限 ───────────────────────────
rep('js/app.js',
"""      var p0 = C.PRESETS[opt.format];
      var A_TOP0 = G.answerTop(p0);
      var A_BOT0 = G.answerBottom(p0, C.PAPER[opt.format].h);
      var contentH0 = G.r3(A_BOT0 - A_TOP0);""",
"""      var p0 = C.PRESETS[opt.format];
      var H0 = C.PAPER[opt.format].h;
      /* ⚠ 用**红框可达范围**，不是答题区上下界 —— 用户 2026 允许红框
         上下各外扩 0.7 个定位点高（frameTopLimit / frameBottomLimit），
         非答题区就是一块红框，所以它也该顶到这个范围。
         历史口径是 answerTop（13.114），比红框上限低 2.961mm。 */
      var F_TOP0 = G.frameTopLimit(p0);
      var F_BOT0 = G.frameBottomLimit(p0, H0);
      var contentH0 = G.r3(F_BOT0 - F_TOP0);""", '空白面常量')

rep('js/app.js',
"""        cursor: A_TOP0,
        frameBot: A_BOT0,
        stretch: 0,
        /* 整面一个非答题区：从答题区上界一直铺到答题区下界 */
        noAnswer: true,
        noAnswerTop: A_TOP0,
        noAnswerH: contentH0,""",
"""        cursor: F_TOP0,
        frameBot: F_BOT0,
        stretch: 0,
        /* 整面一个非答题区：从红框上限一直铺到红框下限 */
        noAnswer: true,
        noAnswerTop: F_TOP0,
        noAnswerH: contentH0,""", '空白面字段')

print('total', n)
