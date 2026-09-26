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

rep('js/builders/page.js',
"""function chromeHeight(isFirst) {
    return isFirst ? CHROME.firstBottom : CHROME.otherBottom;
  }""",
"""function chromeHeight(isFirst) {
    return isFirst ? CHROME.firstBottom : CHROME.otherBottom;
  }

  /** 本面页眉（.as-head / .as-title）的底边（mm，从纸顶量）。
   *  首页 = 标题 + 信息 + 注意事项三行网格的底（CHROME.firstBottom 实测 82.95）；
   *  续排面 = 0 —— 现在 chromeOther() 返回空串，页眉什么都没有。
   *  app.js 用它把红框**上缘**写死在「页眉底 + 2mm 净空」，
   *  这样红框既不会压住页眉，高度也不会跟着页眉漂。 */
  function headBottom(isFirst) {
    return isFirst ? CHROME.firstBottom : 0;
  }""", 'page.headBottom')

rep('js/builders/page.js',
"""    chromeHeight: chromeHeight,""",
"""    chromeHeight: chromeHeight,
    headBottom: headBottom,""", 'page 导出 headBottom')

print('total', n)
