import io, sys
sys.stdout.reconfigure(encoding='utf-8')

# ── 1) page.js：标题内上留白 13 → 14mm；后续页标题行顶位常量 ──────────────
p = 'js/builders/page.js'
s = io.open(p, encoding='utf-8').read()
old = """   *   titlePadTop 13   ≈ 初版 .title-section 的 padding-top: 18mm 减去主标题行高
   *                      （初版标题文字落在 18mm，但顶部还有 13mm 的定标带，
   *                       文字会被压住；这里把文字放到定标带下缘 13mm 处）
   *   rowTitle    19   标题行最小高 = titlePadTop + 主/副标题各一行
   *   rowInfo     8.267 初版 .zk-table td 高 8mm + 边框
   *   rowNote     33   注意事项框（初版 140mm 宽、约 30mm 高）+ 缺考框底栏 9mm */
  var CHROME = {
    rowTitle: 19,
    rowInfo: 8.267,
    rowNote: 33,
    titlePadTop: 13,
    barcodeW: 63,
    otherTop: 14,
    otherBottom: 20
  };"""
new = """   *   titlePadTop 14   标题文字的上留白。顶部定标带（含角标）占 9.78–12.22mm，
   *                    文字从 14mm 起排，与定标带留 1.78mm 净空，不会压住第一行。
   *   rowTitle    19   标题行最小高 = titlePadTop + 主/副标题各一行
   *   rowInfo     8.267 初版 .zk-table td 高 8mm + 边框
   *   rowNote     33   注意事项框（初版 140mm 宽、约 30mm 高）+ 缺考框底栏 9mm
   *   otherTop    14   后续页「xx答题卡」提示行的顶位（绝对定位，见 css .as-title） */
  var CHROME = {
    rowTitle: 19,
    rowInfo: 8.267,
    rowNote: 33,
    titlePadTop: 14,
    barcodeW: 63,
    otherTop: 14,
    otherBottom: 20
  };"""
if old not in s:
    print('!! page anchor 1 missing'); sys.exit(1)
s = s.replace(old, new, 1)

old = """           '--head-title-pad-top:' + CHROME.titlePadTop + 'mm;' +
           '--barcode-w:' + CHROME.barcodeW + 'mm';"""
new = """           '--head-title-pad-top:' + CHROME.titlePadTop + 'mm;' +
           '--head-other-title-top:' + CHROME.otherTop + 'mm;' +
           '--barcode-w:' + CHROME.barcodeW + 'mm';"""
if old not in s:
    print('!! page anchor 2 missing'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('page ok')

# ── 2) app.js：顶部定标带（与角标同心）整体上移到 11mm ────────────────────
p = 'js/app.js'
s = io.open(p, encoding='utf-8').read()
old = """    /* 几何：顶部定标带行心 y —— 取自角标上边距 + 角标半高 */
    var topBandY = G.r3(preset.cornerH / 2 + 13.55);
    if (opt.format === 'A3') topBandY = G.r3(preset.cornerH / 2 + 8.3);"""
new = """    /* 几何：顶部定标带行心 y（角标与它同心，规则③）。
       定标带整条高 = 填涂框高（A4 2.435 / A3 2.398），行心 11mm 时
       占 9.78–12.22mm；标题文字从 14mm 起排，两者留 1.78mm 净空。
       原来放在 15.66mm，正好压住标题第一行。 */
    var TOP_BAND_CY = 11;
    var topBandY = TOP_BAND_CY;"""
if old not in s:
    print('!! app anchor missing'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('app ok')

# ── 3) css：补回后续页 .as-title 的定位（原来这条规则随 .as-title 一起被删了） ──
p = 'css/card.css'
s = io.open(p, encoding='utf-8').read()
old = """/* ── 页眉：标题 ──────────────────────────────────────────────────────── */"""
new = """/* 后续页的「xx答题卡」提示行。
   ⚠ 必须绝对定位：它一旦落进文档流，就会把 .as-face-body 往下推，
     而且自己也会被正文盖住。原来这条规则和首页 .as-title 一起被删掉了，
     导致后续页的提示行飘在 14mm 处、与正文重叠。 */
.as-title {
  position: absolute;
  left: var(--pad-x);
  right: var(--pad-x);
  top: var(--head-other-title-top, 14mm);
  text-align: center;
}

/* ── 页眉：标题 ──────────────────────────────────────────────────────── */"""
if old not in s:
    print('!! css anchor missing'); sys.exit(1)
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('css ok')
