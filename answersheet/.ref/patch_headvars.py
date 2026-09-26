import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── 1) CSS：标题行改用 height（不再 min-height，避免实测值回灌成正反馈） ──────
p = 'css/card.css'
s = io.open(p, encoding='utf-8').read()
old = """  text-align: center;
  /* 用 min-height 而不是 height：一行标题时保持原来的观感（占位 19mm），
     标题换行时这一行自动长高，把信息行整体往下推。 */
  min-height: var(--head-title-h);
  padding-top: var(--head-title-pad-top);
  box-sizing: border-box;
}"""
new = """  text-align: center;
  /* 高度 = --head-title-h（由 app 实测标题内容后写回）。
     ⚠ 不要用 min-height：那样量到的行高会包含这个下限，把实测值当输入
       喂回去会形成正反馈，每渲染一次页眉就长高一点。
       行高固定后，行内用 justify-content:flex-end 把标题贴底，观感不变。 */
  height: var(--head-title-h);
  padding-top: var(--head-title-pad-top);
  box-sizing: border-box;
}"""
if old not in s:
    print('!! css anchor not found'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('css ok')

# ── 2) theme.js：不再在这里写页眉网格变量 ────────────────────────────────
p = 'js/theme.js'
s = io.open(p, encoding='utf-8').read()
old = """    /* 首页页眉网格（与 page.js 的 CHROME 同源，改一处即可）。
       ⚠ 属性名是 CHROME（大写）—— 写成 chrome 会静默取到 undefined，
         下面整块不执行，页眉各行的行高/上留白就全退回 CSS 兜底值。 */
    var Ch = (global.AS.page && global.AS.page.CHROME) || null;
    if (Ch) {
      el.style.setProperty('--head-title-h', Ch.rowTitle + 'mm');
      el.style.setProperty('--head-info-h', Ch.rowInfo + 'mm');
      el.style.setProperty('--head-note-h', Ch.rowNote + 'mm');
      el.style.setProperty('--head-title-pad-top', Ch.titlePadTop + 'mm');
      el.style.setProperty('--barcode-w', Ch.barcodeW + 'mm');
    }
"""
new = """    /* ⚠ 页眉网格变量（--head-title-h / --head-info-h / --head-note-h /
       --head-title-pad-top / --barcode-w）**不在这里设置**。
       原因：applyPreset 会在渲染之后再次执行，把 app 实测出来的标题行高
       覆盖回默认值，页眉的 JS 几何（缺考框行心等）就与 DOM 差开 1.9mm。
       这些变量统一由 Page.render 内联写在 .as-page 上，只有一个真源。 */
"""
if old not in s:
    print('!! theme anchor not found'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('theme ok')

# ── 3) page.js：render 内联写全部页眉变量；titleH 的语义改为「行高」 ────────
p = 'js/builders/page.js'
s = io.open(p, encoding='utf-8').read()

old = """  /** 由 app 在「测出真实标题行高」后调用；同时更新 CSS 变量里的网格行高 */
  function setTitleHeight(mm) {
    if (!(mm > 0)) return CHROME.firstBottom;
    titleH = r3(mm);
    recomputeSpecial();
    return CHROME.firstBottom;
  }"""
new = """  /** 由 app 在「测出真实标题行高」后调用。mm 就是标题行的**总高**。 */
  function setTitleHeight(mm) {
    if (!(mm > 0)) return CHROME.firstBottom;
    titleH = r3(mm);
    recomputeSpecial();
    return CHROME.firstBottom;
  }

  /** 页眉网格的 CSS 变量（唯一真源，内联写到 .as-page 上） */
  function headVars() {
    return '--head-title-h:' + titleH + 'mm;' +
           '--head-info-h:' + CHROME.rowInfo + 'mm;' +
           '--head-note-h:' + CHROME.rowNote + 'mm;' +
           '--head-title-pad-top:' + CHROME.titlePadTop + 'mm;' +
           '--barcode-w:' + CHROME.barcodeW + 'mm';
  }"""
if old not in s:
    print('!! page anchor 1 not found'); sys.exit(1)
s = s.replace(old, new, 1)

old = """    var html = '<div class="as-page" data-format="' + o.format + '"' +
               ' style="--head-title-h:' + titleH + 'mm">';"""
new = """    var html = '<div class="as-page" data-format="' + o.format + '"' +
               ' style="' + headVars() + '">';"""
if old not in s:
    print('!! page anchor 2 not found'); sys.exit(1)
s = s.replace(old, new, 1)

old = """    CHROME: CHROME,
    setTitleHeight: setTitleHeight,"""
new = """    CHROME: CHROME,
    setTitleHeight: setTitleHeight,
    headVars: headVars,"""
if old not in s:
    print('!! page anchor 3 not found'); sys.exit(1)
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('page ok')
