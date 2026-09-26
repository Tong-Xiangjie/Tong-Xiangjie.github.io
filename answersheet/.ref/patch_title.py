import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── 1) page.js：把页眉高度做成可变，SPECIAL 随之重算 ────────────────────────
p = 'js/builders/page.js'
s = io.open(p, encoding='utf-8').read()

old = """  function r3(v) { return Math.round(v * 1000) / 1000; }

  CHROME.firstBottom = r3(CHROME.rowTitle + CHROME.rowInfo + CHROME.rowNote);

  /* 缺考框的**行心** y（页面坐标）
   * 它落在「注意事项框」底栏内，需要一块与之对齐的左侧定标块。
   * boxTop 也一并给出，让框体与定标块共用同一个 y，不做二次运算。 */
  var SPECIAL = (function () {
    var bh = 4.06 * 3 / 5;               // 方框高 = blockW × 3/5
    var noteTop = r3(CHROME.rowTitle + CHROME.rowInfo);
    var absentCy = r3(noteTop + CHROME.rowNote - 3.7);
    return {
      noteTop: noteTop,
      absentCy: absentCy,
      absentBoxTop: r3(absentCy - bh / 2)
    };
  })();
"""

new = """  function r3(v) { return Math.round(v * 1000) / 1000; }

  /* 标题行的**实际**高度。默认 rowTitle（一行标题的高度）；
     标题换行时由 setTitleHeight 写入实测值，整条页眉跟着变高。
     页眉变高会让注意事项框下移，所以 SPECIAL（缺考框行心）必须同步重算 ——
     否则缺考框会脱开左侧定标块。 */
  var titleH = CHROME.rowTitle;
  var SPECIAL = null;

  function recomputeSpecial() {
    var bh = 4.06 * 3 / 5;               // 方框高 = blockW × 3/5
    var noteTop = r3(titleH + CHROME.rowInfo);
    var absentCy = r3(noteTop + CHROME.rowNote - 3.7);
    CHROME.noteTop = noteTop;
    CHROME.firstBottom = r3(titleH + CHROME.rowInfo + CHROME.rowNote);
    SPECIAL = {
      noteTop: noteTop,
      absentCy: absentCy,
      absentBoxTop: r3(absentCy - bh / 2)
    };
  }
  recomputeSpecial();

  /** 由 app 在「测出真实标题行高」后调用；同时更新 CSS 变量里的网格行高 */
  function setTitleHeight(mm) {
    if (!(mm > 0)) return CHROME.firstBottom;
    titleH = r3(mm);
    recomputeSpecial();
    return CHROME.firstBottom;
  }
"""
if old not in s:
    print('!! page.js anchor 1 not found')
    sys.exit(1)
s = s.replace(old, new, 1)

# 把 SPECIAL 的引用改成 getter（它现在是可变的）
s = s.replace("SPECIAL.absentBoxTop - SPECIAL.noteTop", "SPECIAL.absentBoxTop - SPECIAL.noteTop")

# 导出 setTitleHeight 和 SPECIAL 的取值
old2 = """  global.AS.page = {
    CHROME: CHROME,
    SPECIAL: SPECIAL,"""
new2 = """  global.AS.page = {
    CHROME: CHROME,
    setTitleHeight: setTitleHeight,
    get SPECIAL() { return SPECIAL; },"""
if old2 not in s:
    print('!! page.js anchor 2 not found')
    sys.exit(1)
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('page.js ok')
